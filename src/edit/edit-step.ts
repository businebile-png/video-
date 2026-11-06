import fsp from 'node:fs/promises';
import path from 'node:path';
import {PATHS, runPaths} from '../core/paths.js';
import {exists, linkOrCopy, readJson, readValidated, writeJson} from '../core/fsx.js';
import {ffmpeg} from '../core/exec.js';
import {durationSec} from '../core/audio.js';
import {log} from '../core/log.js';
import {loadCaptures} from '../core/stores.js';
import {ScriptSchema} from '../schemas/script.js';
import type {StudioConfig} from '../schemas/config.js';
import type {VoiceWord} from '../schemas/records.js';
import type {CaptureShot, FootageShot, Timeline} from '../schemas/timeline.js';
import {loadFacts} from '../facts/facts.js';
import {artDirection} from './art-directions.js';
import {buildTimeline, computeMetrics, type PreparedClip} from './timeline.js';
import type {Plan} from '../editorial/plan.js';
import type {MusicChoice} from '../music/music-step.js';
import {buildSfx} from '../sfx/synth.js';

const MEZZ_W = 1242;
const MEZZ_H = 2208;

export async function buildTimelineStep(runId: string, config: StudioConfig): Promise<Timeline> {
  const p = runPaths(runId);
  const script = await readValidated(p.script, ScriptSchema);
  const plan = await readJson<Plan>(p.plan);
  const words = await readJson<VoiceWord[]>(p.voiceWords);
  const clipsByScene = await readJson<Record<string, PreparedClip[]>>(path.join(p.footageDir, 'clips.json'));
  const music = exists(p.musicChoice) ? await readJson<MusicChoice>(p.musicChoice) : null;
  const timeline = buildTimeline({
    runId,
    script,
    words,
    voiceDurationSec: await durationSec(p.voiceWav),
    voiceSrc: 'voice.wav',
    clipsByScene,
    captures: await loadCaptures(),
    music: music?.file ? {src: 'music.wav', durationSec: 0} : null,
    ad: artDirection(plan.artDirection),
    config,
    facts: (await loadFacts()).facts,
    seed: plan.seed,
  });
  await writeJson(p.timeline, timeline);
  log.ok(
    `Montage : ${timeline.metrics.durationSec} s, ${timeline.metrics.shotCount} plans (moyenne ${timeline.metrics.avgShotSec} s), ${timeline.metrics.distinctClips} séquences, ${timeline.captions.length} groupes de sous-titres`,
  );
  return timeline;
}

/** 9:16 "cover" crop of the source, scaled with headroom for camera moves. */
export function cropFilter(width: number, height: number): string {
  const target = 9 / 16;
  if (width / height > target) {
    const cw = Math.floor((height * target) / 2) * 2;
    return `crop=${cw}:${height}:${Math.floor((width - cw) / 2)}:0`;
  }
  const ch = Math.floor(width / target / 2) * 2;
  return `crop=${width}:${ch}:0:${Math.floor((height - ch) / 2)}`;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({length: Math.min(size, items.length)}, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

/**
 * Prepare everything the renderer reads: one pre-cut, pre-graded "mezzanine" file per shot
 * (fast, frame-accurate playback), the captures, the mastered voice, the music bed and SFX.
 */
export async function conformStep(runId: string): Promise<Timeline> {
  const p = runPaths(runId);
  const timeline = await readJson<Timeline>(p.timeline);
  await fsp.rm(p.publicDir, {recursive: true, force: true});
  await fsp.mkdir(p.publicDir, {recursive: true});
  const footage = timeline.shots.filter((s): s is FootageShot => s.kind === 'footage');
  await pool(footage, 3, async (shot) => {
    const src = path.join(p.dir, shot.source.file);
    const seconds = (shot.duration / timeline.fps) * shot.playbackRate + 0.15;
    const vf = [
      cropFilter(shot.source.width, shot.source.height),
      `scale=${MEZZ_W}:${MEZZ_H}:flags=lanczos`,
      'setsar=1',
      shot.playbackRate !== 1 ? `setpts=PTS/${shot.playbackRate}` : null,
      `fps=${timeline.fps}`,
      shot.layer === 'background' ? 'gblur=sigma=14' : null,
    ]
      .filter(Boolean)
      .join(',');
    const out = `${shot.id}.mp4`;
    await ffmpeg([
      '-ss',
      shot.source.inSec.toFixed(3),
      '-i',
      src,
      '-t',
      (seconds / shot.playbackRate).toFixed(3),
      '-vf',
      vf,
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '15',
      '-g',
      '15',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      path.join(p.publicDir, out),
    ]);
    shot.src = out;
    shot.mezzanine = {width: MEZZ_W, height: MEZZ_H};
  });
  const captures = await loadCaptures();
  for (const shot of timeline.shots.filter((s): s is CaptureShot => s.kind === 'capture')) {
    const cap = captures.find((c) => c.id === shot.captureId);
    if (!cap) throw new Error(`Capture introuvable : ${shot.captureId}`);
    await linkOrCopy(path.join(PATHS.capturesDir, cap.file), path.join(p.publicDir, shot.src));
    if (shot.backgroundSrc) {
      const clipId = shot.backgroundSrc.replace(/^bg-/, '').replace(/\.mp4$/, '');
      const clips = await readJson<Record<string, Array<{clipId: string; file: string; width: number; height: number}>>>(path.join(p.footageDir, 'clips.json'));
      const clip = Object.values(clips)
        .flat()
        .find((c) => c.clipId === clipId);
      if (clip) {
        await ffmpeg([
          '-i',
          path.join(p.dir, clip.file),
          '-t',
          (shot.duration / timeline.fps + 0.2).toFixed(2),
          '-vf',
          `${cropFilter(clip.width, clip.height)},scale=1080:1920,setsar=1,fps=${timeline.fps},gblur=sigma=26`,
          '-an',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          path.join(p.publicDir, shot.backgroundSrc),
        ]);
      } else shot.backgroundSrc = null;
    }
  }
  // Film grain plates (half resolution, upscaled by the renderer).
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x808080:s=540x960:r=8', '-vf', 'noise=alls=38:allf=t+u,format=gray', '-frames:v', '8', '-start_number', '0', path.join(p.publicDir, 'grain-%d.png')]);
  await linkOrCopy(p.voiceWav, path.join(p.publicDir, 'voice.wav'));
  if (timeline.audio.music) await linkOrCopy(path.join(p.musicDir, 'music.wav'), path.join(p.publicDir, 'music.wav'));
  if (!exists(path.join(PATHS.sfxDir, 'whoosh-soft.wav'))) await buildSfx();
  for (const f of await fsp.readdir(PATHS.sfxDir)) {
    if (f.endsWith('.wav')) await linkOrCopy(path.join(PATHS.sfxDir, f), path.join(p.publicDir, `sfx-${f}`));
  }
  timeline.metrics = computeMetrics(timeline);
  await writeJson(p.timeline, timeline);
  log.ok(`Conformation : ${footage.length} plans préparés`);
  return timeline;
}
