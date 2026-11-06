import fsp from 'node:fs/promises';
import path from 'node:path';
import {PATHS} from '../core/paths.js';
import {mulberry32} from '../core/rng.js';

/**
 * Sound design generated from scratch (filtered noise + sine envelopes): no licence question,
 * deliberately soft so it supports the edit without calling attention to itself.
 */
const SR = 48000;

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function normalizePeak(s: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (const v of s) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < s.length; i++) s[i] = (s[i]! / max) * peak;
  return s;
}

/** Noise through a resonant low-pass whose cutoff sweeps: the classic "whoosh". */
function whoosh(durSec: number, fromHz: number, toHz: number, seed: number): Float32Array {
  const n = Math.round(durSec * SR);
  const out = new Float32Array(n);
  const rnd = mulberry32(seed);
  let low = 0;
  let band = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const cutoff = fromHz * Math.pow(toHz / fromHz, Math.sin((t * Math.PI) / 2));
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff, SR / 6)) / SR);
    const q = 0.55;
    const x = rnd() * 2 - 1;
    low += f * band;
    const high = x - low - q * band;
    band += f * high;
    const env = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 1.6);
    out[i] = band * env;
  }
  return normalizePeak(out, 0.7);
}

function tone(durSec: number, f0: number, f1: number, decay: number, harmonics = [1]): Float32Array {
  const n = Math.round(durSec * SR);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f0 * Math.pow(f1 / f0, i / n);
    phase += (2 * Math.PI * f) / SR;
    const attack = Math.min(1, t / 0.003);
    const env = attack * Math.exp(-t / decay);
    let v = 0;
    harmonics.forEach((h, k) => (v += Math.sin(phase * (k + 1)) * h));
    out[i] = v * env;
  }
  return normalizePeak(out, 0.6);
}

function riser(durSec: number, seed: number): Float32Array {
  const w = whoosh(durSec, 300, 6000, seed);
  const n = w.length;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    w[i] = w[i]! * Math.pow(t, 1.8) * (t > 0.97 ? (1 - t) / 0.03 : 1);
  }
  return normalizePeak(w, 0.55);
}

function impact(seed: number): Float32Array {
  const body = tone(0.55, 110, 48, 0.14, [1, 0.25]);
  const air = whoosh(0.25, 2500, 600, seed);
  const out = new Float32Array(body.length);
  for (let i = 0; i < out.length; i++) out[i] = body[i]! * 0.9 + (air[i] ?? 0) * 0.25;
  return normalizePeak(out, 0.7);
}

export const SFX: Record<string, () => Float32Array> = {
  'whoosh-soft': () => whoosh(0.55, 180, 2200, 11),
  'whoosh-fast': () => whoosh(0.32, 400, 5200, 23),
  'impact-soft': () => impact(31),
  tick: () => tone(0.09, 2400, 2100, 0.018, [1, 0.3]),
  pop: () => tone(0.12, 720, 260, 0.04, [1, 0.2]),
  riser: () => riser(1.2, 47),
};

export async function buildSfx(dir = PATHS.sfxDir): Promise<string[]> {
  await fsp.mkdir(dir, {recursive: true});
  const files: string[] = [];
  for (const [name, make] of Object.entries(SFX)) {
    const file = path.join(dir, `${name}.wav`);
    await fsp.writeFile(file, wav(make()));
    files.push(file);
  }
  return files;
}
