import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {runPaths} from '../core/paths.js';
import {ffmpeg, ffprobe, run} from '../core/exec.js';
import {loudnormArgs} from '../core/audio.js';
import {writeJson} from '../core/fsx.js';
import {loadHistory, upsertHistory} from '../core/stores.js';
import {log} from '../core/log.js';
import type {StudioConfig} from '../schemas/config.js';

/**
 * The song the user chose for every video, laid under the voice once the video has been reviewed:
 * a different excerpt each time, ducked under the voice, the whole mix back at the platforms' loudness.
 */

export interface OverlayResult {
  trackId: string;
  title: string;
  artist: string;
  credit: string;
  licence: string;
  start: number;
  end: number;
  gainDb: number;
  mixedAt: string;
}

/**
 * Excerpt to use: the first candidate (in the configured order) not used by a recent video, else the one
 * used longest ago. `used` lists previous starts, most recent first. Only excerpts long enough for the video.
 */
export function pickExcerpt(excerpts: number[], used: number[], songSec: number, videoSec: number): number {
  const fits = excerpts.filter((s) => s + videoSec + 1 <= songSec);
  const pool = fits.length ? fits : [0];
  const lastUse = (s: number) => used.findIndex((u) => Math.abs(u - s) < 0.5);
  const fresh = pool.find((s) => lastUse(s) < 0);
  if (fresh !== undefined) return fresh;
  return pool.reduce((best, s) => (lastUse(s) > lastUse(best) ? s : best), pool[0]!);
}

async function integratedLufs(file: string, start: number, dur: number): Promise<number | null> {
  const res = await run('ffmpeg', ['-hide_banner', '-nostats', '-ss', start.toFixed(2), '-t', dur.toFixed(2), '-i', file, '-af', 'ebur128', '-f', 'null', '-']);
  const m = [...res.stderr.matchAll(/I:\s+(-?[\d.]+) LUFS/g)].pop();
  return m ? Number(m[1]) : null;
}

export async function overlayMusic(runId: string, config: StudioConfig, opts: {file: string; start?: number | null; avoid?: number[]}): Promise<OverlayResult> {
  const track = config.music.userTrack;
  if (!track) throw new Error('Aucune musique choisie par l’utilisateur (config music.userTrack).');
  if (!fs.existsSync(opts.file)) throw new Error(`Fichier de musique introuvable : ${opts.file}`);
  const p = runPaths(runId);
  if (!fs.existsSync(p.final)) throw new Error('Rendu final absent : lancer « render » d’abord.');
  // Always mix from the video without music, so a second pass never stacks two songs.
  const clean = path.join(p.renderDir, 'final-sans-musique.mp4');
  if (!fs.existsSync(clean)) await fsp.copyFile(p.final, clean);
  const videoSec = Number((await ffprobe(clean)).format.duration ?? 0);
  const songSec = Number((await ffprobe(opts.file)).format.duration ?? 0);
  const history = (await loadHistory()).filter((h) => h.runId !== runId).sort((a, b) => b.runId.localeCompare(a.runId));
  const used = [...(opts.avoid ?? []), ...history.map((h) => h.musicStart).filter((x): x is number => typeof x === 'number')];
  const start = opts.start ?? pickExcerpt(track.excerpts, used, songSec, videoSec);
  // The song sits about 5 dB under the voice's level before ducking, then dips further whenever the voice speaks.
  const measured = await integratedLufs(opts.file, start, videoSec);
  const gainDb = Math.round(((measured === null ? -4 : track.targetLufs - measured) as number) * 10) / 10;
  const fadeOut = Math.max(0, videoSec - 1.8);
  const mixWav = path.join(p.renderDir, 'mix-musique.wav');
  await ffmpeg([
    '-i',
    clean,
    '-ss',
    start.toFixed(2),
    '-t',
    (videoSec + 0.5).toFixed(2),
    '-i',
    opts.file,
    '-filter_complex',
    `[1:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,volume=${gainDb}dB,afade=t=in:st=0:d=0.15,afade=t=out:st=${fadeOut.toFixed(2)}:d=1.8[m];` +
      '[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[base][key];' +
      '[m][key]sidechaincompress=threshold=0.03:ratio=3:attack=15:release=400[md];' +
      '[base][md]amix=inputs=2:duration=first:normalize=0[mix]',
    '-map',
    '[mix]',
    '-c:a',
    'pcm_s16le',
    mixWav,
  ]);
  const norm = await loudnormArgs(mixWav, config.qc.loudnessTargetLufs, -1.5);
  await ffmpeg(['-i', clean, '-i', mixWav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', norm, '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', p.final]);
  await fsp.rm(mixWav, {force: true});
  // Light copy for the panel, as the render makes it (asset uploads are capped at 15 MB).
  const kbps = Math.max(700, Math.min(2200, Math.floor((13 * 8 * 1024) / Math.max(1, videoSec)) - 140));
  await ffmpeg(['-i', p.final, '-vf', 'scale=720:1280:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.4)}k`, '-bufsize', `${kbps * 2}k`, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', path.join(p.renderDir, 'preview.mp4')]);
  const result: OverlayResult = {
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    credit: track.credit,
    licence: track.licence,
    start,
    end: Math.round((start + videoSec) * 100) / 100,
    gainDb,
    mixedAt: new Date().toISOString(),
  };
  await fsp.mkdir(path.join(p.dir, 'music'), {recursive: true});
  await writeJson(path.join(p.dir, 'music', 'overlay.json'), result);
  await upsertHistory({runId, musicTrack: track.id, musicStart: start});
  log.ok(`Musique « ${track.title} » posée : extrait ${start.toFixed(1)} → ${result.end.toFixed(1)} s (gain ${gainDb} dB, sous la voix)`);
  return result;
}
