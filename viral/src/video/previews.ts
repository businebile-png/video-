import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {PATHS, ensureDir} from '../core/paths.js';
import {MUSIC_CATEGORIES, composeMusic} from './music.js';
import {SFX_NAMES, sfxFile, type SfxName} from './sfx.js';
import type {MusicMood} from './types.js';

/** Listening samples for the Audio Studio: one clip per music category and per sound effect (MP3). */
const dir = () => ensureDir(path.join(PATHS.var, 'audio', 'previews'));

function mp3(src: string, out: string): void {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:a', 'libmp3lame', '-b:a', '128k', out]);
  if (r.status !== 0) throw new Error(`conversion MP3 impossible : ${r.stderr?.toString().slice(0, 200)}`);
}

export function previewMusic(mood: string, seconds = 20): string {
  if (!(mood in MUSIC_CATEGORIES)) throw new Error(`Ambiance inconnue : ${mood}`);
  const out = path.join(dir(), `music-${mood}.mp3`);
  const wav = out.replace(/\.mp3$/, '.wav');
  // Cuts every 4 s, like a real edit, so the preview shows how the music follows the scenes.
  const cuts = Array.from({length: Math.floor(seconds / 4) - 1}, (_, i) => (i + 1) * 4);
  composeMusic(wav, {mood: mood as MusicMood, seconds, seed: 2026, cues: {drop: 2, cuts: cuts.slice(1, -1), outro: seconds - 4}});
  mp3(wav, out);
  fs.rmSync(wav, {force: true});
  return out;
}

export function previewSfx(name: SfxName): string {
  const out = path.join(dir(), `sfx-${name}.mp3`);
  mp3(sfxFile(name), out);
  return out;
}

export function allPreviews(): {music: string[]; sfx: string[]} {
  return {music: Object.keys(MUSIC_CATEGORIES).map((m) => previewMusic(m)), sfx: SFX_NAMES.map((n) => previewSfx(n))};
}
