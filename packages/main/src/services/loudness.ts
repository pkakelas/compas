// loudness.ts — measures each song's integrated loudness (EBU R128) and its
// leading/trailing silence in a single ffmpeg decode, and runs that work as a
// background, playback-aware worker pool.
//
// We store raw measurements only (LUFS, true peak, content-onset/offset in
// samples); the renderer derives the playback gain and the trim offsets from
// its own settings, so changing the target loudness or trim pad never requires
// re-analysing a file.
import {spawn} from 'node:child_process';
import {cpus} from 'node:os';
import ffmpegStatic from 'ffmpeg-static';
import type {AnalysisResult} from '../modules/Database.js';

// `ffmpeg-static` resolves to a path inside app.asar once packaged; the binary
// is unpacked next to it (see electron-builder asarUnpack), so point at that.
const FFMPEG_PATH = (ffmpegStatic as unknown as string | null)?.replace(
  /app\.asar([\\/])/,
  'app.asar.unpacked$1',
);

// Noise floor that counts as "silence". Tango transfers (vinyl/shellac) carry a
// real noise floor, so a literal-zero threshold would never trigger; -50 dB is
// a safe "this is silence, not music" level. Recorded per song so we know which
// floor produced a given measurement.
const DEFAULT_SILENCE_DB = -50;
// Minimum contiguous silence to bother detecting, so we never clip a soft note.
const MIN_SILENCE_SEC = 0.2;

type SilenceInterval = {start: number; end: number};

/**
 * Parse ffmpeg's stderr for the bits we need: stream sample rate, total
 * duration, the ebur128 summary (integrated loudness + true peak) and the
 * silencedetect intervals.
 */
function parseFfmpegOutput(text: string): {
  sampleRate: number | null;
  durationSec: number | null;
  loudnessLufs: number | null;
  loudnessPeak: number | null;
  silences: SilenceInterval[];
} {
  let sampleRate: number | null = null;
  const srMatch = text.match(/,\s*(\d{4,6})\s*Hz/);
  if (srMatch) sampleRate = parseInt(srMatch[1], 10);

  let durationSec: number | null = null;
  const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (durMatch) {
    durationSec =
      parseInt(durMatch[1], 10) * 3600 +
      parseInt(durMatch[2], 10) * 60 +
      parseFloat(durMatch[3]);
  }

  // The ebur128 end-of-run summary, e.g.  "  Integrated loudness:\n    I:  -22.3 LUFS"
  // and  "  True peak:\n    Peak:  -1.2 dBFS". -inf (silent file) → null.
  let loudnessLufs: number | null = null;
  const iMatch = text.match(/Integrated loudness:[\s\S]*?I:\s*(-?\d+(?:\.\d+)?|-?inf)\s*LUFS/);
  if (iMatch && iMatch[1] !== '-inf' && iMatch[1] !== 'inf') {
    loudnessLufs = parseFloat(iMatch[1]);
  }
  let loudnessPeak: number | null = null;
  const pkMatch = text.match(/True peak:[\s\S]*?Peak:\s*(-?\d+(?:\.\d+)?|-?inf)\s*dBFS/);
  if (pkMatch && pkMatch[1] !== '-inf' && pkMatch[1] !== 'inf') {
    loudnessPeak = parseFloat(pkMatch[1]);
  }

  // silencedetect prints paired lines. A silence_start without a following
  // silence_end means the file ended during silence → close it at duration.
  const silences: SilenceInterval[] = [];
  let openStart: number | null = null;
  const re = /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const val = parseFloat(m[2]);
    if (m[1] === 'start') {
      openStart = val;
    } else if (openStart !== null) {
      silences.push({start: openStart, end: val});
      openStart = null;
    }
  }
  if (openStart !== null && durationSec !== null) {
    silences.push({start: openStart, end: durationSec});
  }

  return {sampleRate, durationSec, loudnessLufs, loudnessPeak, silences};
}

/**
 * Derive the content onset/offset (the first and last audible sample) from the
 * detected silence intervals. We only ever trust silence that touches the very
 * start or the very end — interior silence is left alone — so this can never
 * remove anything but true edge silence.
 */
function contentBounds(
  silences: SilenceInterval[],
  durationSec: number | null,
  sampleRate: number,
): {startSamples: number; endSamples: number} {
  const dur = durationSec ?? 0;
  let startSec = 0;
  let endSec = dur;

  const lead = silences.find(s => s.start <= 0.05 && s.end - s.start >= MIN_SILENCE_SEC);
  if (lead) startSec = lead.end;

  if (dur > 0) {
    const tail = [...silences]
      .reverse()
      .find(s => s.end >= dur - 0.05 && s.end - s.start >= MIN_SILENCE_SEC);
    if (tail) endSec = tail.start;
  }

  // Guard against a fully-silent or mis-parsed file: never invert the range.
  if (!(endSec > startSec)) {
    return {startSamples: 0, endSamples: Math.max(0, Math.round(dur * sampleRate))};
  }
  return {
    startSamples: Math.max(0, Math.round(startSec * sampleRate)),
    endSamples: Math.max(0, Math.round(endSec * sampleRate)),
  };
}

/**
 * Analyse a single file. Resolves with raw measurements, or rejects if ffmpeg
 * can't be run / the file can't be decoded.
 */
export function analyzeFile(
  filePath: string,
  silenceDb: number = DEFAULT_SILENCE_DB,
): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    if (!FFMPEG_PATH) {
      reject(new Error('ffmpeg binary not found'));
      return;
    }
    const args = [
      '-hide_banner',
      '-nostats',
      '-i',
      filePath,
      '-map',
      '0:a:0',
      '-af',
      `ebur128=peak=true,silencedetect=noise=${silenceDb}dB:d=${MIN_SILENCE_SEC}`,
      '-f',
      'null',
      '-',
    ];
    const child = spawn(FFMPEG_PATH, args, {windowsHide: true});
    let stderr = '';
    // ebur128/silencedetect write to stderr; cap the buffer defensively.
    child.stderr.on('data', d => {
      stderr += d.toString();
      if (stderr.length > 5_000_000) stderr = stderr.slice(-2_000_000);
    });
    child.on('error', reject);
    child.on('close', code => {
      const parsed = parseFfmpegOutput(stderr);
      // No sample rate means we couldn't even read the stream — treat as failure
      // so the song is marked failed rather than silently mis-trimmed.
      if (parsed.sampleRate == null || (code !== 0 && parsed.loudnessLufs == null)) {
        reject(new Error(`ffmpeg failed (code ${code})`));
        return;
      }
      const sr = parsed.sampleRate;
      const {startSamples, endSamples} = contentBounds(parsed.silences, parsed.durationSec, sr);
      resolve({
        loudnessLufs: parsed.loudnessLufs,
        loudnessPeak: parsed.loudnessPeak,
        sampleRate: sr,
        contentStartSamples: startSamples,
        contentEndSamples: endSamples,
        detectThresholdDb: silenceDb,
      });
    });
  });
}

export type AnalysisState = {
  running: boolean;
  paused: boolean;
  total: number; // enqueued this session
  completed: number; // done + failed
  failed: number;
};

type ManagerDeps = {
  loadPending: () => {id: number; path: string}[];
  saveResult: (id: number, result: AnalysisResult) => void;
  markFailed: (id: number) => void;
  onProgress: (state: AnalysisState) => void;
};

/**
 * Background worker pool. Pulls pending songs from the DB, analyses up to
 * `concurrency` at a time, and writes results back. Pauses entirely while the
 * floor is playing live so ffmpeg never competes with playback for CPU; resumes
 * the moment playback stops. Durable across restarts via the DB status column.
 */
export class AnalysisManager {
  private deps: ManagerDeps;
  private concurrency: number;
  private queue: {id: number; path: string}[] = [];
  private active = 0;
  private paused = false;
  private total = 0;
  private completed = 0;
  private failed = 0;
  // De-dupe ids that are queued or in flight so repeated enqueues are cheap.
  private known = new Set<number>();

  constructor(deps: ManagerDeps) {
    this.deps = deps;
    this.concurrency = Math.max(1, (cpus()?.length || 2) - 1);
  }

  /** Pull every pending song from the DB and start (or extend) the pass. */
  enqueuePending(): void {
    const pending = this.deps.loadPending();
    let added = 0;
    for (const s of pending) {
      if (this.known.has(s.id)) continue;
      this.known.add(s.id);
      this.queue.push(s);
      this.total += 1;
      added += 1;
    }
    if (added > 0) this.emit();
    this.pump();
  }

  /** Suspend starting new jobs (in-flight jobs are allowed to finish). */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.emit();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.emit();
    this.pump();
  }

  getState(): AnalysisState {
    return {
      running: this.active > 0 || this.queue.length > 0,
      paused: this.paused,
      total: this.total,
      completed: this.completed,
      failed: this.failed,
    };
  }

  private emit(): void {
    try {
      this.deps.onProgress(this.getState());
    } catch {
      /* a dead window — ignore */
    }
  }

  private pump(): void {
    if (this.paused) return;
    while (this.active < this.concurrency && this.queue.length > 0) {
      const song = this.queue.shift()!;
      this.active += 1;
      analyzeFile(song.path)
        .then(result => this.deps.saveResult(song.id, result))
        .catch(() => {
          this.failed += 1;
          this.deps.markFailed(song.id);
        })
        .finally(() => {
          this.active -= 1;
          this.completed += 1;
          this.known.delete(song.id);
          this.emit();
          this.pump();
        });
    }
    // Pass finished: reset the session counters so the next batch starts clean.
    if (this.active === 0 && this.queue.length === 0 && this.total > 0) {
      this.total = 0;
      this.completed = 0;
      this.failed = 0;
      this.emit();
    }
  }
}
