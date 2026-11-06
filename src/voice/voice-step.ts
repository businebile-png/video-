import fsp from 'node:fs/promises';
import path from 'node:path';
import {runPaths} from '../core/paths.js';
import {readJson, readValidated, writeJson} from '../core/fsx.js';
import {log} from '../core/log.js';
import {durationSec, masterVoice, measureLoudness} from '../core/audio.js';
import {wordErrorRate, wordCount} from '../core/text.js';
import {ScriptSchema, type Script} from '../schemas/script.js';
import type {StudioConfig, VoiceSettings} from '../schemas/config.js';
import type {VoiceReport, VoiceWord} from '../schemas/records.js';
import {speechToText, textToSpeechWithTimestamps} from './elevenlabs.js';
import {alignmentToWords, mapToDisplay, prepareSpeech} from './speech.js';
import type {Plan} from '../editorial/plan.js';

export interface VoiceMetrics {
  durationSec: number;
  speechSec: number;
  wpm: number;
  leadingSilenceSec: number;
  trailingSilenceSec: number;
  maxInternalPauseSec: number;
  pausesOver: Array<{afterWord: string; sec: number}>;
}

/** Pace and pauses from word timings. Scene changes are allowed a slightly longer breath. */
export function voiceMetrics(words: VoiceWord[], totalSec: number, maxPause: number): VoiceMetrics {
  if (words.length === 0) {
    return {durationSec: totalSec, speechSec: 0, wpm: 0, leadingSilenceSec: totalSec, trailingSilenceSec: 0, maxInternalPauseSec: 0, pausesOver: []};
  }
  const first = words[0]!;
  const last = words[words.length - 1]!;
  const speechSec = Math.max(0.1, last.end - first.start);
  let maxGap = 0;
  const over: Array<{afterWord: string; sec: number}> = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i]!.start - words[i - 1]!.end;
    const sceneChange = words[i]!.sceneId !== words[i - 1]!.sceneId;
    const allowed = sceneChange ? maxPause * 1.4 : maxPause;
    if (gap > maxGap) maxGap = gap;
    if (gap > allowed) over.push({afterWord: words[i - 1]!.text, sec: Math.round(gap * 100) / 100});
  }
  return {
    durationSec: Math.round(totalSec * 100) / 100,
    speechSec: Math.round(speechSec * 100) / 100,
    wpm: Math.round((words.length / speechSec) * 60),
    leadingSilenceSec: Math.round(first.start * 100) / 100,
    trailingSilenceSec: Math.round(Math.max(0, totalSec - last.end) * 100) / 100,
    maxInternalPauseSec: Math.round(maxGap * 100) / 100,
    pausesOver: over,
  };
}

/** 15-point "naturalness" score built only from measurements + the human voice approval. */
export function scoreVoice(m: VoiceMetrics, wer: number | null, approved: boolean, cfg: StudioConfig['voice']['targets']): {score: number; problems: string[]; pass: boolean} {
  const problems: string[] = [];
  if (!approved) return {score: 0, problems: ['voix non approuvée par l’utilisateur'], pass: false};
  let score = 0;
  if (wer === null) {
    score += 2;
    problems.push('prononciation non vérifiée (transcription indisponible)');
  } else if (wer <= 0.03) score += 5;
  else if (wer <= 0.06) score += 3;
  else if (wer <= 0.1) score += 1;
  if (wer !== null && wer > cfg.maxWer) problems.push(`mots mal prononcés ou mal compris (WER ${(wer * 100).toFixed(1)} %)`);
  if (m.wpm >= cfg.wpmMin && m.wpm <= cfg.wpmMax) score += 4;
  else if (m.wpm >= cfg.wpmMin * 0.9 && m.wpm <= cfg.wpmMax * 1.1) {
    score += 2;
    problems.push(`débit limite (${m.wpm} mots/min)`);
  } else problems.push(`débit inadapté (${m.wpm} mots/min, attendu ${cfg.wpmMin}–${cfg.wpmMax})`);
  if (m.pausesOver.length === 0) score += 3;
  else if (m.maxInternalPauseSec <= cfg.maxInternalPauseSec * 1.5) {
    score += 1.5;
    problems.push(`pauses un peu longues (${m.pausesOver.length})`);
  } else problems.push(`pause anormale de ${m.maxInternalPauseSec} s`);
  if (m.leadingSilenceSec <= cfg.maxLeadingSilenceSec && m.trailingSilenceSec <= 0.9) score += 3;
  else {
    score += 1;
    problems.push('silence trop long au début ou à la fin');
  }
  const pass =
    (wer === null || wer <= cfg.maxWer) &&
    m.wpm >= cfg.wpmMin * 0.92 &&
    m.wpm <= cfg.wpmMax * 1.08 &&
    m.maxInternalPauseSec <= cfg.maxInternalPauseSec * 1.6;
  return {score: Math.min(15, score), problems, pass};
}

/**
 * Generate the voice-over: TTS with character timings, mastering, then a speech-to-text
 * round trip to catch mispronunciations. Retries with varied settings before giving up.
 */
export async function runVoice(runId: string, config: StudioConfig): Promise<VoiceReport> {
  const p = runPaths(runId);
  const script: Script = await readValidated(p.script, ScriptSchema);
  const plan = await readJson<Plan>(p.plan);
  const voiceId = plan.voiceId ?? config.voice.approvedVoices[0]?.id;
  const approved = config.voice.approvedVoices.find((v) => v.id === voiceId);
  if (!voiceId || !approved) {
    throw new Error('Aucune voix approuvée. Lancez « npm run studio -- voice:audition », écoutez les essais dans le panneau, puis validez une voix.');
  }
  await fsp.mkdir(p.voiceDir, {recursive: true});
  const modelId = approved.modelId ?? config.voice.modelId;
  const sceneBreak = config.voice.sceneBreakSec > 0 && !/v3/.test(modelId) ? ` <break time="${config.voice.sceneBreakSec.toFixed(2)}s" /> ` : '\n\n';
  const speech = prepareSpeech(script, config.voice.pronunciations, sceneBreak);
  await fsp.writeFile(path.join(p.voiceDir, 'tts-input.txt'), speech.text);
  const base: VoiceSettings = {...config.voice.defaultSettings, ...approved.settings};
  const variants: VoiceSettings[] = [
    base,
    {...base, stability: Math.min(1, base.stability + 0.1), style: Math.max(0, base.style - 0.05)},
    {...base, stability: Math.max(0, base.stability - 0.08), style: Math.min(1, base.style + 0.08)},
    {...base, speed: Math.min(1.2, base.speed + 0.05)},
    {...base, speed: Math.max(0.7, base.speed - 0.05)},
  ];
  let best: VoiceReport | null = null;
  let bestWords: VoiceWord[] = [];
  for (let attempt = 1; attempt <= config.voice.maxAttempts; attempt++) {
    const settings = variants[(attempt - 1) % variants.length]!;
    log.info(`Voix : essai ${attempt}/${config.voice.maxAttempts} (${approved.name}, ${modelId}, stabilité ${settings.stability}, vitesse ${settings.speed})`);
    const tts = await textToSpeechWithTimestamps(voiceId, speech.text, {
      modelId,
      outputFormat: config.voice.outputFormat,
      settings,
      languageCode: config.voice.languageCode,
      seed: 1000 + attempt,
    });
    const rawFile = path.join(p.voiceDir, `attempt-${attempt}.mp3`);
    await fsp.writeFile(rawFile, tts.audio);
    const alignment = tts.alignment ?? tts.normalizedAlignment;
    if (!alignment) throw new Error('ElevenLabs n’a pas renvoyé de minutage : impossible de synchroniser les sous-titres.');
    await writeJson(path.join(p.voiceDir, `alignment-${attempt}.json`), alignment);
    const spokenWords = alignmentToWords(alignment);
    const rawWords = mapToDisplay(speech.tokens, spokenWords);
    const trim = Math.max(0, (rawWords[0]?.start ?? 0) - 0.06);
    const mastered = path.join(p.voiceDir, `voice-${attempt}.wav`);
    await masterVoice(rawFile, mastered, trim, -16);
    const words = rawWords.map((w) => ({...w, start: Math.max(0, round(w.start - trim)), end: Math.max(0, round(w.end - trim))}));
    const total = await durationSec(mastered);
    const metrics = voiceMetrics(words, total, config.voice.targets.maxInternalPauseSec);
    let wer: number | null = null;
    let sttText: string | null = null;
    let mismatches: string[] = [];
    try {
      const stt = await speechToText(mastered, {modelId: config.voice.sttModelId, languageCode: config.voice.languageCode});
      sttText = stt.text;
      const reference = speech.tokens.map((t) => t.spoken.join(' ')).join(' ');
      const res = wordErrorRate(reference, stt.text);
      wer = Math.round(res.wer * 1000) / 1000;
      mismatches = [...res.substitutions.map(([a, b]) => `${a} → ${b}`), ...res.deletions.map((d) => `manquant : ${d}`)].slice(0, 20);
    } catch (err) {
      log.warn(`Vérification de prononciation impossible : ${(err as Error).message}`);
    }
    const loud = await measureLoudness(mastered);
    const scored = scoreVoice(metrics, wer, true, config.voice.targets);
    const report: VoiceReport = {
      voiceId,
      voiceName: approved.name,
      modelId,
      attempt,
      ...metrics,
      wer,
      sttText,
      mismatches,
      loudnessLufs: loud.integratedLufs,
      truePeakDb: loud.truePeakDb,
      approvedVoice: true,
      pass: scored.pass,
      problems: scored.problems,
      score: scored.score,
      characters: speech.text.length,
      generatedAt: new Date().toISOString(),
    };
    await writeJson(path.join(p.voiceDir, `report-${attempt}.json`), report);
    if (!best || report.score > best.score || (report.pass && !best.pass)) {
      best = report;
      bestWords = words;
      await fsp.copyFile(mastered, p.voiceWav);
    }
    if (report.pass && report.score >= 13) break;
  }
  if (!best) throw new Error('Aucune voix générée.');
  await writeJson(p.voiceWords, bestWords);
  await writeJson(p.voiceReport, best);
  const totalWords = script.scenes.reduce((n, s) => n + wordCount(s.voiceover), 0);
  log[best.pass ? 'ok' : 'warn'](`Voix retenue : essai ${best.attempt}, ${best.score}/15, ${best.wpm} mots/min, ${totalWords} mots, WER ${best.wer ?? 'n/d'}`);
  if (!best.pass) log.warn(`Problèmes : ${best.problems.join(' ; ')}`);
  return best;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
