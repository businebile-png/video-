/**
 * Offline end-to-end check of the edit → render → QC chain with SYNTHETIC media
 * (generated gradients instead of Pexels). The voice is the real free local voice when it is
 * installed (bash scripts/setup-voice.sh), otherwise a robotic flite stand-in.
 * It validates timing, layout, typography, audio mix and the QC tooling; it is never published.
 *
 *   npm run test:render -- [studio-nuit|clarte|editorial|energie]
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import {runPaths} from '../src/core/paths.js';
import {writeJson} from '../src/core/fsx.js';
import {ffmpeg, run} from '../src/core/exec.js';
import {durationSec} from '../src/core/audio.js';
import {loadConfig} from '../src/core/config.js';
import {saveState} from '../src/core/run.js';
import {ART_DIRECTIONS} from '../src/edit/art-directions.js';
import {conformStep} from '../src/edit/edit-step.js';
import {buildTimeline, type PreparedClip} from '../src/edit/timeline.js';
import {renderStep} from '../src/render/render.js';
import {technicalQc} from '../src/qc/technical.js';
import {displayWords} from '../src/voice/speech.js';
import {localVoiceProblems} from '../src/voice/local.js';
import {runVoice} from '../src/voice/voice-step.js';
import type {Script} from '../src/schemas/script.js';
import type {VoiceWord} from '../src/schemas/records.js';

const adId = process.argv[2] ?? 'studio-nuit';
const ad = ART_DIRECTIONS.find((a) => a.id === adId) ?? ART_DIRECTIONS[0]!;
const runId = `test-synthetique-${ad.id}`;
const p = runPaths(runId);

const script: Script = {
  runId,
  category: 'probleme-entrepreneur',
  angle: 'Les ventes qui se perdent entre plusieurs outils qui ne se parlent pas',
  persona: 'Créatrice de contenu qui vend un premier guide en ligne',
  hookStyle: 'question-directe',
  workingTitle: 'Cinq outils pour une seule vente',
  targetDurationSec: 32,
  scenes: [
    {id: 's1', phase: 'hook', voiceover: 'Tu paies cinq outils différents pour vendre un seul produit ?', headline: 'Cinq outils, une vente', emphasis: ['cinq outils'], visual: {kind: 'broll', queries: ['woman laptop stress', 'many browser tabs'], shotIdeas: [], focusRegionIds: []}, claimFactIds: []},
    {id: 's2', phase: 'problem', voiceover: 'Une page ici, les e-mails là-bas, les paiements ailleurs. Et chaque connexion peut casser.', emphasis: ['casser'], visual: {kind: 'graphic', queries: ['desk laptop night'], shotIdeas: [], focusRegionIds: [], graphic: {type: 'stack-merge', items: ['Pages', 'E-mails', 'Paiements', 'Formations'], result: 'Systeme.io'}}, claimFactIds: []},
    {id: 's3', phase: 'solution', voiceover: 'Avec Systeme.io, tout est réuni au même endroit, dans un seul tableau de bord.', headline: 'Tout au même endroit', emphasis: ['même endroit'], visual: {kind: 'broll', queries: ['entrepreneur smiling laptop'], shotIdeas: [], focusRegionIds: []}, claimFactIds: []},
    {id: 's4', phase: 'benefits', voiceover: 'Tu crées ta page, tu prépares tes e-mails, et tu suis tes ventes sans jongler.', emphasis: ['sans jongler'], visual: {kind: 'graphic', queries: ['coffee notebook planning'], shotIdeas: [], focusRegionIds: [], graphic: {type: 'checklist', title: 'Dans le même outil', items: ['Ta page', 'Tes e-mails', 'Tes ventes']}}, claimFactIds: []},
    {id: 's5', phase: 'cta', voiceover: 'Le lien est dans ma bio : regarde comment c’est organisé avant de choisir.', emphasis: ['dans ma bio'], visual: {kind: 'broll', queries: ['phone scrolling hand'], shotIdeas: [], focusRegionIds: []}, claimFactIds: []},
  ],
  cta: {onScreen: 'Découvre Systeme.io', subline: 'Regarde l’organisation avant de choisir', reason: 'Voir concrètement si centraliser convient à son activité'},
  captions: {tiktok: 'Une vente, cinq outils ? Il existe plus simple. Lien en bio.', instagram: 'Une vente, cinq outils ? Il existe plus simple. Lien en bio.', hashtags: ['#entrepreneur', '#businessenligne']},
  author: 'human',
};

async function voice(config: Awaited<ReturnType<typeof loadConfig>>): Promise<{words: VoiceWord[]; total: number}> {
  const approved = config.voice.approvedVoices[0];
  if (config.voice.provider === 'local' && approved && localVoiceProblems(config.voice.local).length === 0) {
    await writeJson(p.plan, {runId, voiceId: approved.id});
    const report = await runVoice(runId, config);
    console.log(`voix locale : ${report.score}/15, ${report.wpm} mots/min, WER ${report.wer}, problèmes : ${report.problems.join(' ; ') || 'aucun'}`);
    const words = JSON.parse(await fsp.readFile(p.voiceWords, 'utf8')) as VoiceWord[];
    return {words, total: await durationSec(p.voiceWav)};
  }
  const dir = path.join(p.voiceDir, 'words');
  await fsp.mkdir(dir, {recursive: true});
  const parts: string[] = [];
  const words: VoiceWord[] = [];
  let t = 0.06;
  let index = 0;
  for (const scene of script.scenes) {
    for (const w of displayWords(scene.voiceover)) {
      const file = path.join(dir, `${String(index).padStart(3, '0')}.wav`);
      const txt = w.replace(/[^\p{L}\p{N}' -]/gu, ' ').replace(/'/g, ' ').trim() || 'mm';
      await ffmpeg(['-f', 'lavfi', '-i', `flite=text='${txt}':voice=slt`, '-ar', '48000', '-ac', '1', '-af', 'atempo=1.25', file]);
      const d = await durationSec(file);
      words.push({text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + d * 0.92) * 1000) / 1000, sceneId: scene.id, index});
      parts.push(file);
      t += d + 0.03;
      index++;
    }
    t += 0.28;
  }
  // Assemble words on a silent bed at their exact start times.
  const total = t + 0.3;
  const inputs = parts.flatMap((f) => ['-i', f]);
  const delays = words.map((w, i) => `[${i + 1}:a]adelay=${Math.round(w.start * 1000)}|${Math.round(w.start * 1000)}[d${i}]`).join(';');
  const mix = `${words.map((_, i) => `[d${i}]`).join('')}[0:a]amix=inputs=${words.length + 1}:normalize=0,volume=1.0[out]`;
  await ffmpeg(['-f', 'lavfi', '-t', total.toFixed(2), '-i', 'anullsrc=r=48000:cl=mono', ...inputs, '-filter_complex', `${delays};${mix}`, '-map', '[out]', '-ar', '48000', '-ac', '1', path.join(p.voiceDir, 'raw.wav')]);
  await ffmpeg(['-i', path.join(p.voiceDir, 'raw.wav'), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '1', p.voiceWav]);
  return {words, total};
}

async function footage(): Promise<Record<string, PreparedClip[]>> {
  const dir = path.join(p.footageDir, 'src');
  await fsp.mkdir(dir, {recursive: true});
  const palettes = [
    ['0x0f1c2e', '0xff8a3d', '0x2a4b7c', '0xf3c178'],
    ['0x101820', '0x3d6bff', '0x89a7ff', '0x0b1a3a'],
    ['0x2b1a12', '0xff5a47', '0xffb070', '0x40261a'],
    ['0x0b0b0b', '0xc8ff3d', '0x2c3e1a', '0x6f8f2a'],
    ['0x1e2a24', '0x7fd1b9', '0x30475e', '0xf2e9e4'],
    ['0x221a2e', '0xd16ba5', '0x86a8e7', '0x5ffbf1'],
  ];
  const clips: PreparedClip[] = [];
  for (let i = 0; i < 8; i++) {
    const [a, b, c, d] = palettes[i % palettes.length]!;
    const file = path.join(dir, `synth-${i}.mp4`);
    await ffmpeg([
      '-f',
      'lavfi',
      '-i',
      `gradients=s=1080x1920:r=30:c0=${a}:c1=${b}:c2=${c}:c3=${d}:n=4:speed=0.012:seed=${i * 7 + 3}:type=radial`,
      '-t',
      '9',
      '-vf',
      'noise=alls=10:allf=t,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      file,
    ]);
    clips.push({clipId: `synth-${i}`, pexelsId: 900000 + i, file: path.relative(p.dir, file), durationSec: 9, width: 1080, height: 1920, fps: 30, author: 'synthétique'});
  }
  const byScene: Record<string, PreparedClip[]> = {};
  script.scenes.forEach((s, i) => (byScene[s.id] = [clips[(i * 2) % 8]!, clips[(i * 2 + 1) % 8]!, clips[(i * 2 + 5) % 8]!]));
  return byScene;
}

async function music(total: number): Promise<void> {
  await fsp.mkdir(p.musicDir, {recursive: true});
  const expr = '0.12*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.25*t))+0.08*sin(2*PI*277.18*t)+0.07*sin(2*PI*329.63*t)+0.05*sin(2*PI*110*t)';
  await ffmpeg(['-f', 'lavfi', '-i', `aevalsrc=${expr}|${expr}:s=48000:d=${(total + 3).toFixed(1)}`, '-af', 'lowpass=f=1800,loudnorm=I=-16:TP=-2', '-ar', '48000', '-ac', '2', path.join(p.musicDir, 'music.wav')]);
}

async function main(): Promise<void> {
  const config = await loadConfig();
  await fsp.rm(p.dir, {recursive: true, force: true});
  await fsp.mkdir(p.dir, {recursive: true});
  await saveState({runId, createdAt: new Date().toISOString(), seed: 4242, steps: {}});
  await writeJson(p.script, script);
  const t0 = Date.now();
  const {words, total} = await voice(config);
  await writeJson(p.voiceWords, words);
  const clipsByScene = await footage();
  await writeJson(path.join(p.footageDir, 'clips.json'), clipsByScene);
  await music(total);
  const timeline = buildTimeline({
    runId,
    script,
    words,
    voiceDurationSec: await durationSec(p.voiceWav),
    voiceSrc: 'voice.wav',
    clipsByScene,
    captures: [],
    music: {src: 'music.wav', durationSec: total + 3},
    ad,
    config: {...config, affiliate: {...config.affiliate}},
    facts: [],
    seed: 4242,
  });
  await writeJson(p.timeline, timeline);
  await conformStep(runId);
  const out = await renderStep(runId, config);
  const qc = await technicalQc(runId, config);
  console.log(JSON.stringify({ad: ad.id, seconds: Math.round((Date.now() - t0) / 1000), final: out.final, preview: out.preview, previewMB: (out.previewBytes / 1e6).toFixed(1), metrics: timeline.metrics, failed: qc.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.value}`), sheet: qc.contactSheet}, null, 2));
  void run;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
