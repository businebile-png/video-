import fsp from 'node:fs/promises';
import path from 'node:path';
import {runPaths} from '../core/paths.js';
import {exists, readJson, readValidated, writeJson} from '../core/fsx.js';
import {ffmpeg, ffprobe, parseRate, run} from '../core/exec.js';
import {measureLoudness, silences} from '../core/audio.js';
import {log} from '../core/log.js';
import {wordErrorRate} from '../core/text.js';
import {ScriptSchema} from '../schemas/script.js';
import type {StudioConfig} from '../schemas/config.js';
import type {Timeline} from '../schemas/timeline.js';
import type {VoiceWord} from '../schemas/records.js';
import {transcribeWords} from '../voice/voice-step.js';
import {prepareSpeech} from '../voice/speech.js';

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  value: string;
  expected: string;
  /** gate = blocks publication whatever the score; visual/editing/audio = lowers that criterion. */
  impact: 'gate' | 'visual' | 'editing' | 'audio';
}

export interface TechnicalReport {
  runId: string;
  checkedAt: string;
  durationSec: number;
  loudnessLufs: number | null;
  truePeakDb: number | null;
  finalWer: number | null;
  checks: Check[];
  frames: string[];
  contactSheet: string | null;
}

async function detect(file: string, filter: string, startRe: RegExp, endRe: RegExp): Promise<Array<{start: number; end: number}>> {
  const res = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', filter, '-an', '-f', 'null', '-']);
  const out: Array<{start: number; end: number}> = [];
  let start: number | null = null;
  for (const line of res.stderr.split('\n')) {
    const s = line.match(startRe);
    const e = line.match(endRe);
    if (s) start = Number(s[1]);
    if (e && start !== null) {
      out.push({start, end: Number(e[1])});
      start = null;
    }
    const both = line.match(/black_start:([\d.]+)\s+black_end:([\d.]+)/);
    if (both) out.push({start: Number(both[1]), end: Number(both[2])});
  }
  return out;
}

/** Frames a reviewer must look at: the hook, one per shot, the end card. */
export async function extractFrames(runId: string, timeline: Timeline): Promise<{frames: string[]; sheet: string}> {
  const p = runPaths(runId);
  const dir = path.join(p.qcDir, 'frames');
  await fsp.rm(dir, {recursive: true, force: true});
  await fsp.mkdir(dir, {recursive: true});
  const fps = timeline.fps;
  const moments: Array<{t: number; label: string}> = [
    {t: 0.1, label: 'ouverture'},
    {t: 1.0, label: 'accroche-1s'},
    {t: 2.5, label: 'accroche-2s5'},
  ];
  for (const s of timeline.shots) moments.push({t: (s.from + s.duration / 2) / fps, label: s.id});
  for (const g of timeline.graphics) moments.push({t: (g.from + g.duration * 0.8) / fps, label: g.id});
  moments.push({t: (timeline.endCard.from + Math.min(45, timeline.endCard.duration - 5)) / fps, label: 'fin'});
  const unique = moments.filter((m, i) => moments.findIndex((o) => Math.abs(o.t - m.t) < 0.2) === i).sort((a, b) => a.t - b.t);
  const frames: string[] = [];
  for (const [i, m] of unique.entries()) {
    const f = path.join(dir, `${String(i).padStart(2, '0')}-${m.label}.jpg`);
    await ffmpeg(['-ss', m.t.toFixed(3), '-i', p.final, '-frames:v', '1', '-vf', 'scale=540:960', '-q:v', '3', f]);
    frames.push(f);
  }
  const listDir = path.join(dir, 'tiles');
  await fsp.mkdir(listDir, {recursive: true});
  for (const [i, f] of frames.entries()) await fsp.copyFile(f, path.join(listDir, `t${String(i).padStart(3, '0')}.jpg`));
  const cols = 6;
  const rows = Math.ceil(frames.length / cols);
  const sheet = path.join(p.qcDir, 'contact-sheet.jpg');
  await ffmpeg(['-framerate', '1', '-i', path.join(listDir, 't%03d.jpg'), '-vf', `scale=270:480,tile=${cols}x${rows}:padding=4:color=0x101010`, '-frames:v', '1', sheet]);
  await fsp.rm(listDir, {recursive: true, force: true});
  return {frames, sheet};
}

export async function technicalQc(runId: string, config: StudioConfig): Promise<TechnicalReport> {
  const p = runPaths(runId);
  const timeline = await readJson<Timeline>(p.timeline);
  const script = await readValidated(p.script, ScriptSchema);
  const words = await readJson<VoiceWord[]>(p.voiceWords);
  const probe = await ffprobe(p.final);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(probe.format.duration ?? 0);
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const fps = parseRate(v?.avg_frame_rate || v?.r_frame_rate);
  add({id: 'resolution', label: 'Résolution 1080×1920', ok: v?.width === 1080 && v?.height === 1920, value: `${v?.width}×${v?.height}`, expected: '1080×1920', impact: 'gate'});
  add({id: 'fps', label: 'Cadence', ok: Math.abs(fps - 30) < 0.01, value: `${fps.toFixed(2)} i/s`, expected: '30 i/s', impact: 'gate'});
  add({id: 'codec', label: 'Codec vidéo H.264 / yuv420p', ok: v?.codec_name === 'h264' && v?.pix_fmt === 'yuv420p', value: `${v?.codec_name}/${v?.pix_fmt}`, expected: 'h264/yuv420p', impact: 'gate'});
  add({id: 'audio-codec', label: 'Audio AAC 48 kHz', ok: a?.codec_name === 'aac' && a?.sample_rate === '48000', value: `${a?.codec_name}/${a?.sample_rate}`, expected: 'aac/48000', impact: 'gate'});
  const bitrate = Number(probe.format.bit_rate ?? 0) / 1000;
  add({id: 'bitrate', label: 'Débit vidéo suffisant', ok: bitrate >= 4500, value: `${Math.round(bitrate)} kb/s`, expected: '≥ 4 500 kb/s', impact: 'visual'});

  const loud = await measureLoudness(p.final);
  const lufsOk = loud.integratedLufs !== null && Math.abs(loud.integratedLufs - config.qc.loudnessTargetLufs) <= config.qc.loudnessTolerance;
  add({id: 'loudness', label: 'Volume (EBU R128)', ok: lufsOk, value: `${loud.integratedLufs ?? 'n/d'} LUFS`, expected: `${config.qc.loudnessTargetLufs} ± ${config.qc.loudnessTolerance}`, impact: 'audio'});
  add({
    id: 'true-peak',
    label: 'Crêtes (true peak)',
    ok: loud.truePeakDb !== null && loud.truePeakDb <= config.qc.truePeakMaxDb,
    value: `${loud.truePeakDb ?? 'n/d'} dBTP`,
    expected: `≤ ${config.qc.truePeakMaxDb} dBTP`,
    impact: 'audio',
  });
  const voicePresent = words.length >= 10 && loud.integratedLufs !== null && loud.integratedLufs > -24;
  add({
    id: 'voice-present',
    label: 'Voix off présente et audible',
    ok: voicePresent,
    value: `${words.length} mots synchronisés, ${loud.integratedLufs ?? 'n/d'} LUFS`,
    expected: 'voix off sur toute la vidéo',
    impact: 'gate',
  });
  const lastWordEnd = words[words.length - 1]?.end ?? duration;
  const sil = (await silences(p.final, -45, 1.0)).filter((s) => s.start < lastWordEnd - 0.2);
  add({id: 'silence', label: 'Pas de trou de son', ok: sil.length === 0, value: sil.length ? sil.map((s) => `${s.start.toFixed(1)} s`).join(', ') : 'aucun', expected: 'aucun silence > 1 s', impact: 'audio'});
  const black = await detect(p.final, 'blackdetect=d=0.12:pix_th=0.08', /black_start:([\d.]+)/, /black_end:([\d.]+)/);
  add({id: 'black', label: 'Pas d’image noire', ok: black.length === 0, value: black.length ? `${black.length} passage(s)` : 'aucune', expected: 'aucune', impact: 'visual'});
  const frozen = await detect(p.final, 'freezedetect=n=0.002:d=1.8', /freeze_start:\s*([\d.]+)/, /freeze_end:\s*([\d.]+)/);
  add({id: 'freeze', label: 'Pas d’image figée', ok: frozen.length === 0, value: frozen.length ? frozen.map((f) => `${f.start.toFixed(1)} s`).join(', ') : 'aucune', expected: 'aucune > 1,8 s', impact: 'visual'});

  const m = timeline.metrics;
  add({
    id: 'upscale',
    label: 'Netteté des séquences (pas d’agrandissement excessif)',
    ok: m.maxUpscale === null || m.maxUpscale <= config.qc.maxUpscale,
    value: m.maxUpscale === null ? 'n/d' : `×${m.maxUpscale}`,
    expected: `≤ ×${config.qc.maxUpscale}`,
    impact: 'visual',
  });
  add({id: 'safe-zone', label: 'Textes dans la zone sûre TikTok/Reels', ok: m.safeZoneViolations.length === 0, value: m.safeZoneViolations.join(' ; ') || 'ok', expected: 'aucun débordement', impact: 'visual'});
  add({id: 'pacing', label: 'Rythme des plans', ok: m.avgShotSec >= 0.9 && m.avgShotSec <= 3.8 && m.minShotSec >= 0.5, value: `moy. ${m.avgShotSec} s, min ${m.minShotSec} s`, expected: 'moy. 0,9–3,8 s, min ≥ 0,5 s', impact: 'editing'});
  const minClips = Math.max(3, Math.ceil(m.durationSec / 7));
  add({id: 'variety', label: 'Variété des séquences', ok: m.distinctClips >= minClips || timeline.shots.some((s) => s.kind === 'capture'), value: `${m.distinctClips} séquences`, expected: `≥ ${minClips}`, impact: 'editing'});
  add({id: 'transitions', label: 'Transitions sobres', ok: m.stylizedTransitions <= 3, value: `${m.stylizedTransitions} stylisées`, expected: '≤ 3', impact: 'editing'});
  add({id: 'disclosure', label: 'Mention « Publicité » permanente', ok: Boolean(timeline.disclosure.text) && timeline.disclosure.text === config.affiliate.disclosureBadge, value: timeline.disclosure.text, expected: config.affiliate.disclosureBadge, impact: 'gate'});
  add({id: 'cta-card', label: 'Carte d’appel à l’action ≥ 2,5 s', ok: timeline.endCard.duration / timeline.fps >= 2.5, value: `${(timeline.endCard.duration / timeline.fps).toFixed(1)} s`, expected: '≥ 2,5 s', impact: 'gate'});

  let finalWer: number | null = null;
  try {
    const audio = path.join(p.qcDir, 'final-audio.wav');
    await fsp.mkdir(p.qcDir, {recursive: true});
    await ffmpeg(['-i', p.final, '-vn', '-ac', '1', '-ar', '16000', audio]);
    const stt = await transcribeWords(audio, config);
    const ref = prepareSpeech(script, config.voice.pronunciations, ' ').tokens.map((t) => t.spoken.join(' ')).join(' ');
    finalWer = Math.round(wordErrorRate(ref, stt.text).wer * 1000) / 1000;
  } catch (err) {
    log.warn(`Transcription du mixage final impossible : ${(err as Error).message}`);
  }
  add({
    id: 'final-intelligibility',
    label: 'Voix intelligible sur le mixage final',
    ok: finalWer !== null && finalWer <= config.qc.maxFinalWer,
    value: finalWer === null ? 'non vérifié' : `WER ${(finalWer * 100).toFixed(1)} %`,
    expected: `≤ ${config.qc.maxFinalWer * 100} %`,
    impact: 'audio',
  });

  const {frames, sheet} = await extractFrames(runId, timeline);
  const report: TechnicalReport = {
    runId,
    checkedAt: new Date().toISOString(),
    durationSec: Math.round(duration * 100) / 100,
    loudnessLufs: loud.integratedLufs,
    truePeakDb: loud.truePeakDb,
    finalWer,
    checks,
    frames,
    contactSheet: exists(sheet) ? sheet : null,
  };
  await writeJson(p.qcTechnical, report);
  const failed = checks.filter((c) => !c.ok);
  log[failed.length ? 'warn' : 'ok'](`Contrôle technique : ${checks.length - failed.length}/${checks.length} conformes${failed.length ? ` — à revoir : ${failed.map((c) => c.label).join(', ')}` : ''}`);
  return report;
}
