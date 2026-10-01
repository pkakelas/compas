import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';

/**
 * Write a minimal but VALID PCM WAV file (mono, 16-bit, 8kHz) of `seconds`
 * length. Real enough for the importer's audio-extension check and for Howler
 * to load; small enough to keep fixtures cheap. Content is a quiet sine tone so
 * the file isn't pure silence (the loudness pass has something to chew on).
 */
export function writeWav(path: string, seconds = 1): void {
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * seconds);
  const dataSize = numSamples * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataSize);

  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 3000);
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  writeFileSync(path, buf);
}

/** Titles of the lossless fixture tracks, so tests can find them by name. */
export const AIFF_FLAC_TITLES = {flac: 'Milonguero Viejo', aiff: 'El Choclo'} as const;

/**
 * Build a small tango library on disk under `root`, organised the way a DJ
 * would: one folder per style. Returns the per-style file counts so tests can
 * assert against them.
 */
export function makeMusicFixture(root: string): {tango: number; vals: number; total: number} {
  const tangoDir = join(root, 'Di Sarli - Tango');
  const valsDir = join(root, 'Biagi - Vals');
  mkdirSync(tangoDir, {recursive: true});
  mkdirSync(valsDir, {recursive: true});

  const tangoTitles = ['Bahia Blanca', 'Nido Gaucho', 'Verdemar'];
  const valsTitles = ['Lagrimas y Sonrisas', 'Viejo Porton'];

  tangoTitles.forEach(t => writeWav(join(tangoDir, `${t}.wav`)));
  valsTitles.forEach(t => writeWav(join(valsDir, `${t}.wav`)));
  // One lossless track in each of the containers a DJ's rips come in: FLAC
  // plays natively, AIFF only through the app's WAV conversion.
  writeFlac(join(tangoDir, `${AIFF_FLAC_TITLES.flac}.flac`));
  writeAiff(join(tangoDir, `${AIFF_FLAC_TITLES.aiff}.aiff`));

  const tango = tangoTitles.length + 2;
  return {tango, vals: valsTitles.length, total: tango + valsTitles.length};
}

/** Encode a sample rate as the 80-bit IEEE 754 extended float AIFF requires. */
function writeExtended80(buf: Buffer, offset: number, value: number): void {
  // value = mantissa · 2^(exp − 16383 − 63); pick exp so the leading bit is set.
  let e = 0;
  while (2 ** (e + 1) <= value) e++;
  buf.writeUInt16BE(16383 + e, offset);
  buf.writeBigUInt64BE(BigInt(value) << BigInt(63 - e), offset + 2);
}

/**
 * Write a minimal but VALID AIFF file (mono, 16-bit big-endian PCM, 8kHz) of
 * `seconds` length — the same quiet sine tone as `writeWav`, in the container
 * Chromium can't demux (so the app has to convert it before playing).
 */
export function writeAiff(path: string, seconds = 1): void {
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * seconds);
  const dataSize = numSamples * 2; // 16-bit mono
  // FORM(12) + COMM(8+18) + SSND(8+8) + data
  const buf = Buffer.alloc(12 + 26 + 16 + dataSize);

  buf.write('FORM', 0);
  buf.writeUInt32BE(buf.length - 8, 4);
  buf.write('AIFF', 8);
  // COMM chunk
  buf.write('COMM', 12);
  buf.writeUInt32BE(18, 16);
  buf.writeUInt16BE(1, 20); // mono
  buf.writeUInt32BE(numSamples, 22); // sample frames
  buf.writeUInt16BE(16, 26); // bits per sample
  writeExtended80(buf, 28, sampleRate);
  // SSND chunk
  buf.write('SSND', 38);
  buf.writeUInt32BE(8 + dataSize, 42);
  buf.writeUInt32BE(0, 46); // offset
  buf.writeUInt32BE(0, 50); // block size

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 3000);
    buf.writeInt16BE(sample, 54 + i * 2);
  }
  writeFileSync(path, buf);
}

/**
 * Write a FLAC file (mono, 8kHz sine) of `seconds` length using the ffmpeg
 * binary the app bundles, so the fixture is exactly what real encoders produce.
 * `genre`, when given, is written as the file's genre tag.
 */
export function writeFlac(path: string, seconds = 1, genre?: string): void {
  const require = createRequire(new URL('../../packages/main/package.json', import.meta.url));
  const ffmpeg = require('ffmpeg-static') as string;
  execFileSync(ffmpeg, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=8000:duration=${seconds}`,
    ...(genre ? ['-metadata', `genre=${genre}`] : []),
    '-c:a', 'flac', path,
  ]);
}
