import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';
import {PATHS, runPaths} from '../core/paths.js';
import {readJson} from '../core/fsx.js';
import {ffmpeg, ffprobe} from '../core/exec.js';
import {MIN_FINAL_KBPS} from '../qc/limits.js';
import {coverTimeSec} from './cover.js';
import {loudnormArgs} from '../core/audio.js';
import {log} from '../core/log.js';
import type {StudioConfig} from '../schemas/config.js';
import type {Timeline} from '../schemas/timeline.js';

/** Use a locally installed Chrome Headless Shell when available (no download needed). */
export function detectBrowser(config: StudioConfig): string | null {
  if (config.render.browserExecutable && fs.existsSync(config.render.browserExecutable)) return config.render.browserExecutable;
  if (process.env.REMOTION_BROWSER && fs.existsSync(process.env.REMOTION_BROWSER)) return process.env.REMOTION_BROWSER;
  const base = '/opt/pw-browsers';
  if (fs.existsSync(base)) {
    for (const dir of fs.readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell')).sort().reverse()) {
      const candidate = path.join(base, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export interface RenderOutputs {
  final: string;
  cover: string;
  preview: string;
  previewBytes: number;
  renderSeconds: number;
}

export async function renderStep(runId: string, config: StudioConfig, opts: {encodeOnly?: boolean} = {}): Promise<RenderOutputs> {
  const p = runPaths(runId);
  const timeline = await readJson<Timeline>(p.timeline);
  if (timeline.shots.some((s) => s.kind === 'footage' && !s.src)) throw new Error('Montage non conformé : lancer l’étape « conform » avant le rendu.');
  await fsp.mkdir(p.renderDir, {recursive: true});
  const started = Date.now();
  const bundleDir = path.join(p.renderDir, 'bundle');
  if (opts.encodeOnly) {
    // Re-encode the delivered files from the existing intermediate render (no new frames).
    if (!fs.existsSync(p.rawRender)) throw new Error('Rendu intermédiaire absent : lancer « render » sans --encode-only.');
    return finishRender(p, config, timeline, started);
  }
  await fsp.rm(bundleDir, {recursive: true, force: true});
  log.info('Préparation du moteur de rendu…');
  const serveUrl = await bundle({entryPoint: PATHS.remotionEntry, publicDir: p.publicDir, outDir: bundleDir});
  const browserExecutable = detectBrowser(config);
  const inputProps = {timeline};
  const composition = await selectComposition({serveUrl, id: 'AdVideo', inputProps, browserExecutable, chromeMode: 'headless-shell', logLevel: 'error'});
  let lastPct = -10;
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: 'h264',
    // Near-lossless intermediate: the only lossy encode that matters is the final one below.
    crf: 10,
    x264Preset: 'veryfast',
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    audioBitrate: '256k',
    outputLocation: p.rawRender,
    browserExecutable,
    chromeMode: 'headless-shell',
    concurrency: config.render.concurrency ?? Math.max(1, os.cpus().length),
    logLevel: 'error',
    onProgress: ({progress}) => {
      const pct = Math.floor(progress * 100);
      if (pct >= lastPct + 10) {
        lastPct = pct;
        log.info(`Rendu : ${pct} %`);
      }
    },
  });
  await fsp.rm(bundleDir, {recursive: true, force: true});
  return finishRender(p, config, timeline, started);
}

/** Delivered files from the intermediate render: final MP4 (loudness, colour, bitrate floor), cover, light preview. */
async function finishRender(p: ReturnType<typeof runPaths>, config: StudioConfig, timeline: Timeline, started: number): Promise<RenderOutputs> {
  // Final loudness pass: −14 LUFS integrated, −1 dBTP (social platforms' reference level).
  const norm = await loudnormArgs(p.rawRender, config.qc.loudnessTargetLufs, -1.2);
  // Final encode: limited-range BT.709 yuv420p (what TikTok/Instagram expect), H.264 High.
  // Dark or soft footage compresses so well that the CRF alone can land under the bitrate floor
  // the platforms' own re-encode needs: encode finer until it is met.
  let crf = config.render.crf;
  for (;;) {
    await ffmpeg([
      '-i',
      p.rawRender,
      '-vf',
      'scale=in_range=full:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      config.render.x264Preset,
      '-crf',
      String(crf),
      '-profile:v',
      'high',
      '-level:v',
      '4.2',
      '-colorspace',
      'bt709',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-color_range',
      'tv',
      '-af',
      norm,
      '-ar',
      '48000',
      '-c:a',
      'aac',
      '-b:a',
      '256k',
      '-movflags',
      '+faststart',
      p.final,
    ]);
    const kbps = Number((await ffprobe(p.final)).format.bit_rate ?? 0) / 1000;
    if (kbps >= MIN_FINAL_KBPS || crf <= 11) break;
    crf -= 2;
    log.info(`Débit ${Math.round(kbps)} kb/s sous ${MIN_FINAL_KBPS} kb/s (images sombres ou douces) : nouvel encodage plus fin (CRF ${crf}).`);
  }
  const coverAt = coverTimeSec(timeline);
  await ffmpeg(['-ss', coverAt.toFixed(2), '-i', p.final, '-frames:v', '1', '-q:v', '2', p.cover]);
  const preview = path.join(p.renderDir, 'preview.mp4');
  const durSec = timeline.durationInFrames / timeline.fps;
  // Light copy for the validation panel (asset uploads are capped at 15 MB).
  const kbps = Math.max(700, Math.min(2200, Math.floor((13 * 8 * 1024) / durSec) - 140));
  await ffmpeg([
    '-i',
    p.final,
    '-vf',
    'scale=720:1280:flags=lanczos',
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-b:v',
    `${kbps}k`,
    '-maxrate',
    `${Math.round(kbps * 1.4)}k`,
    '-bufsize',
    `${kbps * 2}k`,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    preview,
  ]);
  const previewBytes = (await fsp.stat(preview)).size;
  const renderSeconds = Math.round((Date.now() - started) / 1000);
  log.ok(`Vidéo rendue en ${renderSeconds} s → ${path.relative(PATHS.root, p.final)} (aperçu ${(previewBytes / 1e6).toFixed(1)} Mo)`);
  return {final: p.final, cover: p.cover, preview, previewBytes, renderSeconds};
}
