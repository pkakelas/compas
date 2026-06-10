import {writeFileSync, mkdirSync} from 'node:fs';
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

  return {tango: tangoTitles.length, vals: valsTitles.length, total: tangoTitles.length + valsTitles.length};
}
