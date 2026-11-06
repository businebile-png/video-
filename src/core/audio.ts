import {ffmpeg, run} from './exec.js';

export interface Loudness {
  integratedLufs: number | null;
  truePeakDb: number | null;
  lra: number | null;
}

/** EBU R128 measurement (integrated loudness, true peak, loudness range). */
export async function measureLoudness(file: string): Promise<Loudness> {
  const res = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']);
  const out = res.stderr;
  const summary = out.slice(out.lastIndexOf('Summary:'));
  const num = (re: RegExp) => {
    const m = summary.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    integratedLufs: num(/I:\s+(-?[\d.]+)\s+LUFS/),
    truePeakDb: num(/Peak:\s+(-?[\d.]+|-inf)\s+dBFS/),
    lra: num(/LRA:\s+(-?[\d.]+)\s+LU/),
  };
}

/** Two-pass EBU loudness normalisation (linear when possible, so dynamics are preserved). */
export async function loudnormArgs(input: string, targetI: number, targetTp: number): Promise<string> {
  const res = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-af', `loudnorm=I=${targetI}:TP=${targetTp}:LRA=11:print_format=json`, '-f', 'null', '-']);
  const jsonText = res.stderr.slice(res.stderr.lastIndexOf('{'), res.stderr.lastIndexOf('}') + 1);
  try {
    const m = JSON.parse(jsonText) as Record<string, string>;
    return `loudnorm=I=${targetI}:TP=${targetTp}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  } catch {
    return `loudnorm=I=${targetI}:TP=${targetTp}:LRA=11`;
  }
}

export async function silences(file: string, noiseDb = -45, minSec = 0.9): Promise<Array<{start: number; end: number}>> {
  const res = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=noise=${noiseDb}dB:d=${minSec}`, '-f', 'null', '-']);
  const out: Array<{start: number; end: number}> = [];
  let start: number | null = null;
  for (const line of res.stderr.split('\n')) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    const e = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (s) start = Number(s[1]);
    if (e && start !== null) {
      out.push({start, end: Number(e[1])});
      start = null;
    }
  }
  if (start !== null) out.push({start, end: Number.POSITIVE_INFINITY});
  return out;
}

export async function durationSec(file: string): Promise<number> {
  const res = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  return Number(res.stdout.trim());
}

/** Voice mastering: trim the head, clean low rumble, gentle compression, loudness to target. */
export async function masterVoice(input: string, output: string, trimStartSec: number, targetLufs = -16): Promise<void> {
  const tmp = `${output}.trim.wav`;
  await ffmpeg(['-ss', trimStartSec.toFixed(3), '-i', input, '-ac', '1', '-ar', '48000', '-af', 'highpass=f=70,acompressor=threshold=-20dB:ratio=2.2:attack=8:release=140:makeup=1', tmp]);
  const norm = await loudnormArgs(tmp, targetLufs, -1.5);
  await ffmpeg(['-i', tmp, '-af', norm, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', output]);
  await run('rm', ['-f', tmp]);
}
