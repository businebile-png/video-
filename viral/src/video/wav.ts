import fs from 'node:fs';

/** Minimal PCM WAV reader / writer (16-bit or 32-bit float in, 16-bit out). */
export interface Pcm {
  sampleRate: number;
  channels: number;
  /** Interleaved samples in [-1, 1]. */
  data: Float32Array;
}

export function readWav(file: string): Pcm {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`Fichier WAV illisible : ${file}`);
  let pos = 12;
  let fmt: {format: number; channels: number; sampleRate: number; bits: number} | null = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14)};
    } else if (id === 'data' && fmt) {
      const end = Math.min(buf.length, body + size);
      const bytes = fmt.bits / 8;
      const n = Math.floor((end - body) / bytes);
      const data = new Float32Array(n);
      const float = fmt.format === 3 || (fmt.format === 0xfffe && fmt.bits === 32);
      for (let i = 0; i < n; i++) {
        const o = body + i * bytes;
        data[i] = float ? buf.readFloatLE(o) : fmt.bits === 16 ? buf.readInt16LE(o) / 32768 : fmt.bits === 24 ? buf.readIntLE(o, 3) / 8388608 : buf.readInt32LE(o) / 2147483648;
      }
      return {sampleRate: fmt.sampleRate, channels: fmt.channels, data};
    }
    pos = body + size + (size % 2);
  }
  throw new Error(`Aucune donnée audio dans ${file}`);
}

export function writeWav(file: string, pcm: Pcm): void {
  const n = pcm.data.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(pcm.channels, 22);
  buf.writeUInt32LE(pcm.sampleRate, 24);
  buf.writeUInt32LE(pcm.sampleRate * pcm.channels * 2, 28);
  buf.writeUInt16LE(pcm.channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm.data[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

export function wavSeconds(file: string): number {
  const p = readWav(file);
  return p.data.length / p.channels / p.sampleRate;
}

/** Loudness envelope per video frame (0..1), used to move a drawn character's mouth with the voice. */
export function envelope(file: string, fps: number, frames: number, offsetS = 0): number[] {
  const p = readWav(file);
  const per = p.sampleRate / fps;
  const out: number[] = [];
  let peak = 1e-6;
  const raw: number[] = [];
  for (let f = 0; f < frames; f++) {
    const t = f / fps - offsetS;
    const a = Math.floor(t * p.sampleRate);
    if (t < 0 || a >= p.data.length / p.channels) {
      raw.push(0);
      continue;
    }
    let sum = 0;
    let n = 0;
    for (let i = a; i < Math.min(a + per, p.data.length / p.channels); i++) {
      const v = p.data[i * p.channels];
      sum += v * v;
      n++;
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    raw.push(rms);
    peak = Math.max(peak, rms);
  }
  for (const r of raw) out.push(Math.round(Math.min(1, Math.pow(r / peak, 0.6)) * 100) / 100);
  return out;
}
