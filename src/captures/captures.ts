import fsp from 'node:fs/promises';
import path from 'node:path';
import {PATHS} from '../core/paths.js';
import {writeJson} from '../core/fsx.js';
import {ffmpeg, ffprobe, displayDims} from '../core/exec.js';
import {loadCaptures} from '../core/stores.js';
import {CaptureSchema, type Capture} from '../schemas/assets.js';
import type {Feature} from '../schemas/config.js';

/**
 * Register a REAL capture of Systeme.io (screen recording or screenshot made by the user
 * in their own account, or a public page). The studio never draws a fake interface:
 * demos only exist when a capture is registered here.
 */
export async function addCapture(input: {
  file: string;
  id: string;
  feature: Feature;
  title: string;
  description: string;
  source: Capture['source'];
  sourceUrl?: string;
  personalDataChecked: boolean;
}): Promise<Capture> {
  const ext = path.extname(input.file).toLowerCase();
  const isVideo = ['.mp4', '.mov', '.webm', '.mkv'].includes(ext);
  const isImage = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
  if (!isVideo && !isImage) throw new Error('Format non pris en charge (vidéo : mp4/mov/webm ; image : png/jpg/webp).');
  await fsp.mkdir(PATHS.capturesDir, {recursive: true});
  const destName = `${input.id}${isVideo ? '.mp4' : '.png'}`;
  const dest = path.join(PATHS.capturesDir, destName);
  if (isVideo) {
    // Normalise: H.264, 30 fps, no audio, width ≤ 1920, keyframes every 15 frames for smooth zooms.
    await ffmpeg(['-i', input.file, '-an', '-vf', "scale='min(1920,iw)':-2:flags=lanczos,fps=30", '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-g', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dest]);
  } else {
    await ffmpeg(['-i', input.file, '-frames:v', '1', dest]);
  }
  const probe = await ffprobe(dest);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('Capture illisible.');
  const dims = displayDims(v);
  const capture = CaptureSchema.parse({
    id: input.id,
    file: destName,
    type: isVideo ? 'video' : 'image',
    feature: input.feature,
    title: input.title,
    description: input.description,
    capturedAt: new Date().toISOString().slice(0, 10),
    source: input.source,
    sourceUrl: input.sourceUrl,
    width: dims.width,
    height: dims.height,
    durationSec: isVideo ? Number(probe.format.duration) : undefined,
    focusRegions: [],
    personalDataChecked: input.personalDataChecked,
  });
  const all = (await loadCaptures()).filter((c) => c.id !== capture.id);
  all.push(capture);
  await writeJson(PATHS.capturesManifest, {captures: all});
  return capture;
}

export async function addFocusRegion(captureId: string, region: {id: string; x: number; y: number; w: number; h: number; label: string}): Promise<Capture> {
  const all = await loadCaptures();
  const cap = all.find((c) => c.id === captureId);
  if (!cap) throw new Error(`Capture inconnue : ${captureId}`);
  cap.focusRegions = [...cap.focusRegions.filter((r) => r.id !== region.id), region];
  CaptureSchema.parse(cap);
  await writeJson(PATHS.capturesManifest, {captures: all});
  return cap;
}
