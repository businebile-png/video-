import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {ensureDir} from '../core/paths.js';
import type {Caption, Timeline} from './timeline.js';

const require = createRequire(import.meta.url);

/** FFmpeg, synchronous, with the end of its error output in the exception. */
export function ffmpeg(args: string[], what = 'FFmpeg'): string {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024});
  if (r.status !== 0) throw new Error(`${what} : ${(r.stderr || 'échec').trim().split('\n').slice(-3).join(' ').slice(0, 500)}`);
  return r.stderr ?? '';
}

export function ffprobe(file: string): any {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {encoding: 'utf8'});
  if (r.status !== 0) throw new Error(`ffprobe : ${r.stderr?.slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

/** Frames of the part of a licensed clip a scene uses, cropped to the frame (or framed in a window). */
export function extractFrames(clip: string, opts: {offset: number; seconds: number; fps: number; width: number; height: number; framed: boolean; outDir: string}): number {
  ensureDir(opts.outDir);
  const w = opts.framed ? Math.round(opts.width * 0.92) : opts.width;
  const h = opts.framed ? Math.round((w * 9) / 16) : opts.height;
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},fps=${opts.fps},setsar=1`;
  ffmpeg(['-ss', opts.offset.toFixed(2), '-t', opts.seconds.toFixed(2), '-i', clip, '-vf', vf, '-q:v', '3', '-an', path.join(opts.outDir, 'f%05d.jpg')], 'Extraction des images du plan');
  const n = fs.readdirSync(opts.outDir).filter((f) => f.endsWith('.jpg')).length;
  if (!n) throw new Error('aucune image extraite du plan');
  return n;
}

/** A still from a licensed clip (for the « images animées » format). */
export function extractStill(clip: string, at: number, file: string, width: number, height: number): void {
  ffmpeg(['-ss', at.toFixed(2), '-i', clip, '-frames:v', '1', '-vf', `scale=${Math.round(width * 1.25)}:${Math.round(height * 1.25)}:force_original_aspect_ratio=increase,crop=${Math.round(width * 1.25)}:${Math.round(height * 1.25)}`, '-q:v', '2', file], 'Extraction d’une image fixe');
}

/**
 * Sound, in three buses. Voice: high-pass, gentle compression and de-essing, then its level. Music + ambience
 * beds: their level, ducked under the voice by a side-chain compressor (light / normal / strong). Effects: placed
 * by the timeline. Then a two-pass loudness normalisation to -14 LUFS with true peaks under -1.5 dBTP (the level
 * TikTok, Instagram and YouTube play at), so nothing clips and every video sounds as loud as the next.
 */
export interface MixInput {
  out: string;
  duration: number;
  voice?: string;
  voiceOffset: number;
  music?: string;
  /** Licensed tracks get their fades here (original music is composed with them). */
  musicFades?: {in: number; out: number};
  sfx: Array<{file: string; at: number; gain: number; bed?: boolean}>;
  musicVolume?: number;
  voiceVolume?: number;
  ducking?: 'leger' | 'normal' | 'fort';
}

const DUCK = {leger: {threshold: 0.05, ratio: 3}, normal: {threshold: 0.02, ratio: 6}, fort: {threshold: 0.01, ratio: 10}};

export function mixAudio(m: MixInput): {lufs: number; peak: number} {
  const inputs: string[] = [];
  const filters: string[] = [];
  const mixIn: string[] = [];
  let k = 0;
  const D = m.duration.toFixed(3);
  let voiceKey = '';
  if (m.voice) {
    inputs.push('-i', m.voice);
    const ms = Math.round(m.voiceOffset * 1000);
    filters.push(`[${k}:a]aresample=48000,aformat=channel_layouts=mono,highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=8:release=140:makeup=2,deesser=i=0.35,volume=${(m.voiceVolume ?? 1).toFixed(2)},adelay=${ms}:all=1,apad,atrim=0:${D},asplit=2[voice][vkey]`);
    voiceKey = '[vkey]';
    mixIn.push('[voice]');
    k++;
  }
  const musicBus: string[] = [];
  if (m.music) {
    inputs.push('-i', m.music);
    const fades = m.musicFades ? `,afade=t=in:d=${m.musicFades.in},afade=t=out:st=${Math.max(0, m.duration - m.musicFades.out).toFixed(3)}:d=${m.musicFades.out}` : '';
    filters.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:${D}${fades},volume=${(m.voice ? m.musicVolume ?? 0.3 : Math.min(1, (m.musicVolume ?? 0.3) * 2.6)).toFixed(3)}[mus0]`);
    musicBus.push('[mus0]');
    k++;
  }
  for (const c of m.sfx.filter((x) => x.bed)) {
    if (!fs.existsSync(c.file)) continue;
    inputs.push('-stream_loop', '-1', '-i', c.file);
    filters.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${D},afade=t=in:d=1,afade=t=out:st=${Math.max(0, m.duration - 1.5).toFixed(3)}:d=1.5,volume=${c.gain}[bed${k}]`);
    musicBus.push(`[bed${k}]`);
    k++;
  }
  if (musicBus.length) {
    filters.push(`${musicBus.join('')}amix=inputs=${musicBus.length}:normalize=0:duration=longest[musall]`);
    if (voiceKey) {
      const d = DUCK[m.ducking ?? 'normal'];
      filters.push(`[musall]${voiceKey}sidechaincompress=threshold=${d.threshold}:ratio=${d.ratio}:attack=25:release=450:makeup=1[mus]`);
      voiceKey = '';
    } else filters.push('[musall]anull[mus]');
    mixIn.push('[mus]');
  }
  if (voiceKey) filters.push(`${voiceKey}anullsink`);
  for (const c of m.sfx.filter((x) => !x.bed)) {
    if (!fs.existsSync(c.file) || c.at >= m.duration) continue;
    inputs.push('-i', c.file);
    const ms = Math.round(c.at * 1000);
    filters.push(`[${k}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${c.gain},adelay=${ms}:all=1[s${k}]`);
    mixIn.push(`[s${k}]`);
    k++;
  }
  if (!mixIn.length) {
    inputs.push('-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo`);
    mixIn.push(`[${k}:a]`);
  }
  const mix = m.out.replace(/\.wav$/, '.mix.wav');
  filters.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:duration=longest,atrim=0:${D},aformat=channel_layouts=stereo,alimiter=limit=0.95:level=false,afade=t=out:st=${Math.max(0, m.duration - 0.6).toFixed(3)}:d=0.6[mix]`);
  ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', '[mix]', '-ar', '48000', '-c:a', 'pcm_s16le', mix], 'Mixage du son');
  // Loudness: measure, then apply linearly.
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', mix, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], {encoding: 'utf8'});
  const j0 = /\{[\s\S]*"input_i"[\s\S]*?\}/.exec(probe.stderr ?? '');
  if (j0) {
    const j = JSON.parse(j0[0]);
    const ln = `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
    ffmpeg(['-i', mix, '-af', `${ln},aresample=48000`, '-c:a', 'pcm_s16le', m.out], 'Normalisation du son');
  } else fs.copyFileSync(mix, m.out);
  fs.rmSync(mix, {force: true});
  const meas = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', m.out, '-af', 'ebur128=peak=true', '-f', 'null', '-'], {encoding: 'utf8'}).stderr ?? '';
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(meas.split('Summary:').pop() ?? '')?.[1] ?? NaN);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(meas.split('Summary:').pop() ?? '')?.[1] ?? NaN);
  return {lufs, peak};
}

const ts = (t: number, sep: string) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`;
};

/** Sidecar subtitles (closed captions) for platforms that take them, from the same timings as the burnt-in captions. */
export function writeSubtitles(captions: Caption[], srtFile: string, vttFile: string): void {
  const text = (c: Caption) => c.words.map((w) => w.text).join(' ');
  fs.writeFileSync(srtFile, captions.map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${text(c)}\n`).join('\n'));
  fs.writeFileSync(vttFile, `WEBVTT\n\n${captions.map((c) => `${ts(c.start, '.')} --> ${ts(c.end, '.')}\n${text(c)}\n`).join('\n')}`);
}

export interface FrameRenderResult {
  frames: number;
  ms: number;
  coverFile: string;
}

/**
 * Films the page: several browser tabs seek and screenshot interleaved frames in parallel; the frames are
 * reordered and piped straight into FFmpeg (no frame ever written to disk), muxed with the mixed sound.
 */
export async function renderFrames(opts: {html: string; timeline: Timeline; pageOpt: unknown; audio: string; out: string; workers: number; preset: string; crf: number; coverAt: number; coverFile: string; onProgress?: (done: number, total: number) => void}): Promise<FrameRenderResult> {
  const t0 = Date.now();
  const {chromium} = require('playwright') as any;
  const tl = opts.timeline;
  const total = Math.max(1, Math.round(tl.duration * tl.fps));
  const browser = await chromium.launch({args: ['--disable-dev-shm-usage', '--font-render-hinting=none', '--disable-lcd-text']});
  const enc = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(tl.fps), '-c:v', 'mjpeg', '-i', '-', '-i', opts.audio, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', opts.preset, '-crf', String(opts.crf), '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(tl.fps), '-g', String(tl.fps * 2), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', '-shortest', opts.out]);
  let encErr = '';
  enc.stderr.on('data', (d) => (encErr += d));
  const encDone = new Promise<void>((resolve, reject) => enc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Encodage : ${encErr.trim().slice(-400) || `code ${code}`}`)))));
  const ready = new Map<number, Buffer>();
  let next = 0;
  let waiters: Array<() => void> = [];
  const wake = () => {
    const w = waiters;
    waiters = [];
    w.forEach((f) => f());
  };
  const writer = (async () => {
    while (next < total) {
      const buf = ready.get(next);
      if (!buf) {
        await new Promise<void>((r) => waiters.push(r));
        continue;
      }
      ready.delete(next);
      if (!enc.stdin.write(buf)) await new Promise<void>((r) => enc.stdin.once('drain', () => r()));
      next++;
      opts.onProgress?.(next, total);
      wake();
    }
    enc.stdin.end();
  })();
  const workers = Math.max(1, Math.min(opts.workers, 6));
  const htmlFile = opts.html;
  let failed: Error | null = null;
  try {
    const pages = await Promise.all(
      Array.from({length: workers}, async () => {
        const page = await browser.newPage({viewport: {width: tl.width, height: tl.height}, deviceScaleFactor: 1});
        await page.goto('file://' + htmlFile, {waitUntil: 'load'});
        await page.evaluate(() => (document as any).fonts.ready);
        await page.evaluate(() => (window as any).__video((window as any).__TL, (window as any).__OPT));
        return page;
      }),
    );
    await Promise.all(
      pages.map(async (page: any, k: number) => {
        for (let f = k; f < total && !failed; f += workers) {
          while (f - next > workers * 6) await new Promise<void>((r) => waiters.push(r));
          await page.evaluate((t: number) => (window as any).__seek(t), f / tl.fps);
          const buf = await page.screenshot({type: 'jpeg', quality: 90, clip: {x: 0, y: 0, width: tl.width, height: tl.height}});
          ready.set(f, buf);
          wake();
        }
      }),
    ).catch((e) => {
      failed = e;
      throw e;
    });
    // Cover: the hook fully on screen.
    await pages[0].evaluate((t: number) => (window as any).__seek(t), opts.coverAt);
    await pages[0].screenshot({path: opts.coverFile, type: 'jpeg', quality: 92, clip: {x: 0, y: 0, width: tl.width, height: tl.height}});
    await writer;
    await encDone;
  } catch (e) {
    enc.kill('SIGKILL');
    throw e;
  } finally {
    await browser.close();
  }
  return {frames: total, ms: Date.now() - t0, coverFile: opts.coverFile};
}
