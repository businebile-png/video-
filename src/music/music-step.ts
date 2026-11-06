import fsp from 'node:fs/promises';
import path from 'node:path';
import {PATHS, runPaths} from '../core/paths.js';
import {readJson, writeJson} from '../core/fsx.js';
import {ffmpeg} from '../core/exec.js';
import {durationSec, loudnormArgs} from '../core/audio.js';
import {log} from '../core/log.js';
import {loadHistory, loadTracks} from '../core/stores.js';
import {Rng} from '../core/rng.js';
import {artDirection} from '../edit/art-directions.js';
import type {StudioConfig} from '../schemas/config.js';
import type {Track} from '../schemas/assets.js';
import type {VoiceWord} from '../schemas/records.js';
import type {Plan} from '../editorial/plan.js';
import {composeMusic} from '../voice/elevenlabs.js';

export interface MusicChoice {
  trackId: string | null;
  title: string | null;
  source: string | null;
  license: string | null;
  licenseUrl: string | null;
  proof: string | null;
  file: string | null;
  reason: string;
}

const MOOD_PROMPTS: Record<string, string> = {
  cinematic: 'warm cinematic underscore, soft piano and airy pads, gentle pulse',
  ambient: 'calm modern ambient bed, soft synth pads, subtle rhythm',
  warm: 'warm lo-fi groove, mellow keys, soft kick',
  minimal: 'minimal modern electronic pulse, clean and light',
  'corporate-light': 'light optimistic tech bed, plucked synths, soft claps',
  uplifting: 'uplifting modern pop instrumental, bright but restrained',
  pop: 'modern pop instrumental groove, light and confident',
  lofi: 'lo-fi hip hop beat, warm vinyl texture, relaxed',
  acoustic: 'soft acoustic guitar and light percussion, intimate',
  electronic: 'driving electronic beat, tight and energetic but not aggressive',
  upbeat: 'upbeat instrumental groove, punchy drums, positive energy',
  driving: 'steady driving rhythm, modern synth bass, focused',
};

/**
 * Pick a licensed track (manifest with licence proof) that fits the art direction and was not
 * used recently; or generate one with Eleven Music if enabled; or go without music.
 */
export async function chooseMusic(runId: string, config: StudioConfig): Promise<MusicChoice> {
  const p = runPaths(runId);
  const plan = await readJson<Plan>(p.plan);
  const words = await readJson<VoiceWord[]>(p.voiceWords);
  const needSec = (words[words.length - 1]?.end ?? 30) + 2.5;
  const ad = artDirection(plan.artDirection);
  await fsp.mkdir(p.musicDir, {recursive: true});
  const out = path.join(p.musicDir, 'music.wav');
  let choice: MusicChoice = {trackId: null, title: null, source: null, license: null, licenseUrl: null, proof: null, file: null, reason: 'aucune musique (mode « none »)'};
  if (config.music.mode === 'none') {
    await writeJson(p.musicChoice, choice);
    return choice;
  }
  if (config.music.mode === 'library' || config.music.mode === 'library-then-generate') {
    const tracks = (await loadTracks()).filter((t) => t.license && t.proof);
    const recent = (await loadHistory())
      .sort((a, b) => b.runId.localeCompare(a.runId))
      .slice(0, config.music.recentTrackCooldown)
      .map((h) => h.musicTrack);
    const fitting = tracks.filter((t) => !recent.includes(t.id) && t.moods.some((m) => ad.musicMoods.includes(m)));
    const pool = fitting.length ? fitting : tracks.filter((t) => !recent.includes(t.id));
    if (pool.length) {
      const track = new Rng(plan.seed).pick(pool);
      await prepareBed(path.join(PATHS.musicDir, track.file), out, needSec);
      choice = trackChoice(track, out, `bibliothèque (${track.moods.join(', ')})`);
      await writeJson(p.musicChoice, choice);
      return choice;
    }
  }
  if (config.music.mode === 'generate' || config.music.mode === 'library-then-generate') {
    const mood = ad.musicMoods.find((m) => MOOD_PROMPTS[m]) ?? 'minimal';
    const prompt = `${MOOD_PROMPTS[mood]}, instrumental only, no vocals, suitable under a French voice-over advert, steady, clean mix, ${Math.round(needSec)} seconds`;
    try {
      const mp3 = await composeMusic(prompt, needSec * 1000 + 1000, config.music.generateModelId);
      const raw = path.join(p.musicDir, 'generated.mp3');
      await fsp.writeFile(raw, mp3);
      await prepareBed(raw, out, needSec);
      choice = {
        trackId: `eleven-music-${runId}`,
        title: `Composition générée (${mood})`,
        source: 'ElevenLabs — Eleven Music (API)',
        license: 'Licence commerciale de l’abonnement ElevenLabs payant (voir conditions musique du plan)',
        licenseUrl: 'https://elevenlabs.io/music-terms',
        proof: `générée le ${new Date().toISOString()} — invite : ${prompt}`,
        file: path.relative(p.dir, out),
        reason: 'générée pour cette vidéo',
      };
      await writeJson(p.musicChoice, choice);
      return choice;
    } catch (err) {
      log.warn(`Génération musicale impossible : ${(err as Error).message}`);
    }
  }
  choice.reason = 'aucune piste sous licence disponible : vidéo sans musique (voix + habillage sonore)';
  log.warn(choice.reason);
  await writeJson(p.musicChoice, choice);
  return choice;
}

function trackChoice(t: Track, file: string, reason: string): MusicChoice {
  return {
    trackId: t.id,
    title: `${t.title}${t.artist ? ` — ${t.artist}` : ''}`,
    source: t.source,
    license: t.license,
    licenseUrl: t.licenseUrl ?? null,
    proof: t.proof,
    file,
    reason,
  };
}

/** Bed at −16 LUFS, looped if short, trimmed to length with a soft tail. */
async function prepareBed(src: string, out: string, needSec: number): Promise<void> {
  const len = await durationSec(src);
  const tmp = `${out}.tmp.wav`;
  const loops = len >= needSec ? 0 : Math.ceil(needSec / len);
  await ffmpeg([
    ...(loops ? ['-stream_loop', String(loops)] : []),
    '-i',
    src,
    '-t',
    needSec.toFixed(2),
    '-af',
    `afade=t=in:d=0.15,afade=t=out:st=${Math.max(0, needSec - 1.2).toFixed(2)}:d=1.2`,
    '-ar',
    '48000',
    '-ac',
    '2',
    tmp,
  ]);
  const norm = await loudnormArgs(tmp, -16, -2);
  await ffmpeg(['-i', tmp, '-af', norm, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', out]);
  await fsp.rm(tmp, {force: true});
}
