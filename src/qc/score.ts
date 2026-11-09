import path from 'node:path';
import {runPaths} from '../core/paths.js';
import {exists, readJson, readJsonIfExists, readValidated, writeJson} from '../core/fsx.js';
import {affiliateLinkProblems} from '../core/config.js';
import {loadCaptures} from '../core/stores.js';
import {ScriptSchema, type Script} from '../schemas/script.js';
import {ReviewSchema, type Review, type VoiceReport} from '../schemas/records.js';
import type {StudioConfig} from '../schemas/config.js';
import type {Timeline} from '../schemas/timeline.js';
import type {LintResult} from '../script/lint.js';
import type {TechnicalReport} from './technical.js';
import type {LicenseRecord} from '../footage/footage-step.js';
import type {MusicChoice} from '../music/music-step.js';

export interface Gate {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface Criterion {
  id: 'visual' | 'voice' | 'editing' | 'script' | 'explanation' | 'conversion' | 'audio';
  label: string;
  max: number;
  score: number;
  basis: string;
}

export interface ScoreReport {
  runId: string;
  scoredAt: string;
  total: number;
  criteria: Criterion[];
  gates: Gate[];
  decision: 'publishable' | 'improve' | 'redo';
  weakest: string[];
  summary: string;
  /** Reviewer's viral potential (/20), shown beside the score, never added to it. */
  virality: Virality | null;
}

export interface Virality {
  total: number;
  max: 20;
  parts: Array<{id: 'hook' | 'retention' | 'shareability' | 'engagement'; label: string; score: number; justification: string}>;
  actions: string[];
}

const VIRAL_LABELS = {hook: 'Accroche (arrêter le pouce)', retention: 'Rétention (rester jusqu’au bout)', shareability: 'Envie d’envoyer ou d’enregistrer', engagement: 'Envie de commenter'} as const;

export function viralityOf(review: Review): Virality | null {
  const v = review.virality;
  if (!v) return null;
  const parts = (['hook', 'retention', 'shareability', 'engagement'] as const).map((id) => ({id, label: VIRAL_LABELS[id], score: half(v[id].score), justification: v[id].justification}));
  return {total: half(parts.reduce((n, p) => n + p.score, 0)), max: 20, parts, actions: v.actions};
}

const LABELS: Record<Criterion['id'], string> = {
  visual: 'Qualité visuelle',
  voice: 'Naturel de la voix',
  editing: 'Qualité du montage',
  script: 'Qualité du script',
  explanation: 'Explication de Systeme.io',
  conversion: 'Potentiel de conversion',
  audio: 'Qualité audio',
};

const half = (n: number) => Math.round(n * 2) / 2;

/**
 * The 100-point grid. Subjective criteria come from an independent review (frames seen,
 * justifications written) but are CAPPED by measurements, and the gates override everything:
 * a high score never compensates a factual, rights, link or audio problem.
 */
export function computeScore(input: {
  runId: string;
  config: StudioConfig;
  script: Script;
  lint: LintResult;
  voice: VoiceReport;
  technical: TechnicalReport;
  timeline: Timeline;
  review: Review;
  licenses: LicenseRecord[];
  music: MusicChoice | null;
  capturesOk: boolean;
}): ScoreReport {
  const {config, lint, voice, technical, review, timeline} = input;
  const failed = (impact: string) => technical.checks.filter((c) => c.impact === impact && !c.ok);

  const audioChecks = technical.checks.filter((c) => c.impact === 'audio');
  const audioScore = audioChecks.length ? (5 * audioChecks.filter((c) => c.ok).length) / audioChecks.length : 0;

  const visualCap = Math.max(6, 20 - 4 * failed('visual').length);
  const editingCap = Math.max(5, 15 - 3 * failed('editing').length);
  const scriptCap = 15 - Math.min(5, lint.warnings.length);
  const conversionCap = /\b(lien|bio)\b/i.test(input.script.scenes[input.script.scenes.length - 1]!.voiceover) && input.script.cta.reason.length >= 15 ? 15 : 9;

  const criteria: Criterion[] = [
    {id: 'visual', label: LABELS.visual, max: 20, score: Math.min(review.criteria.visual.score, visualCap), basis: `relecture ${review.criteria.visual.score}/20, plafond technique ${visualCap}`},
    {id: 'voice', label: LABELS.voice, max: 15, score: voice.score, basis: `mesures : WER ${voice.wer ?? 'n/d'}, ${voice.wpm} mots/min, pause max ${voice.maxInternalPauseSec} s, voix approuvée`},
    {id: 'editing', label: LABELS.editing, max: 15, score: Math.min(review.criteria.editing.score, editingCap), basis: `relecture ${review.criteria.editing.score}/15, plafond rythme ${editingCap}`},
    {id: 'script', label: LABELS.script, max: 15, score: Math.min(review.criteria.script.score, scriptCap), basis: `relecture ${review.criteria.script.score}/15, ${lint.warnings.length} avertissement(s)`},
    {id: 'explanation', label: LABELS.explanation, max: 15, score: Math.min(review.criteria.explanation.score, 15), basis: `relecture ${review.criteria.explanation.score}/15`},
    {id: 'conversion', label: LABELS.conversion, max: 15, score: Math.min(review.criteria.conversion.score, conversionCap), basis: `relecture ${review.criteria.conversion.score}/15, plafond CTA ${conversionCap}`},
    {id: 'audio', label: LABELS.audio, max: 5, score: half(audioScore), basis: `${audioChecks.filter((c) => c.ok).length}/${audioChecks.length} mesures conformes`},
  ].map((c) => ({...c, score: half(c.score)})) as Criterion[];
  const total = half(criteria.reduce((n, c) => n + c.score, 0));

  const linkProblems = affiliateLinkProblems(config.affiliate.url);
  const footageShots = timeline.shots.filter((s) => s.kind === 'footage');
  // Clip ids are "<library>-<id>" (pexels-123, pixabay-456): a licence covers the shot when both match.
  const licensedIds = new Set(input.licenses.map((l) => `${(l.source ?? 'Pexels').toLowerCase()}-${l.pexelsId}`));
  const unlicensed = footageShots.filter((s) => s.kind === 'footage' && !licensedIds.has(s.source.clipId));
  const musicOk = !timeline.audio.music || Boolean(input.music?.license && input.music?.proof);
  const gates: Gate[] = [
    {id: 'lint', label: 'Script conforme (aucune promesse, urgence ou affirmation non sourcée)', ok: lint.errors.length === 0, detail: lint.errors.map((e) => `${e.where} : ${e.message}`).join(' ; ') || 'ok'},
    {id: 'facts', label: 'Faits cités vérifiés sur les pages officielles', ok: !lint.errors.some((e) => e.rule.startsWith('fait') || e.rule.startsWith('affirmation') || e.rule === 'chiffre-non-source' || e.rule === 'fonctionnalite-non-verifiee'), detail: `${lint.factIdsUsed.length} fait(s) utilisé(s)`},
    {id: 'affiliate', label: 'Lien affilié configuré (format Systeme.io, sans « www », avec « sa »)', ok: linkProblems.length === 0, detail: linkProblems.join(' ; ') || 'ok'},
    {id: 'disclosure', label: 'Mention « Publicité » visible toute la vidéo', ok: technical.checks.find((c) => c.id === 'disclosure')?.ok ?? false, detail: timeline.disclosure.text},
    {id: 'rights', label: 'Droits : licences des séquences, de la musique et des captures', ok: unlicensed.length === 0 && musicOk && input.capturesOk && review.rightsConcerns.length === 0, detail: [unlicensed.length ? `${unlicensed.length} plan(s) sans licence` : '', musicOk ? '' : 'musique sans preuve de licence', input.capturesOk ? '' : 'capture non vérifiée', ...review.rightsConcerns].filter(Boolean).join(' ; ') || 'ok'},
    {id: 'voice', label: 'Voix approuvée et prononciation vérifiée', ok: voice.approvedVoice && voice.pass, detail: voice.problems.join(' ; ') || 'ok'},
    {id: 'audio', label: 'Audio techniquement conforme', ok: failed('audio').filter((c) => c.id !== 'final-intelligibility' || c.value !== 'non vérifié').length === 0, detail: failed('audio').map((c) => `${c.label} : ${c.value}`).join(' ; ') || 'ok'},
    {id: 'spec', label: 'Format 1080×1920, 30 i/s, H.264, AAC', ok: failed('gate').filter((c) => ['resolution', 'fps', 'codec', 'audio-codec', 'cta-card'].includes(c.id)).length === 0, detail: failed('gate').map((c) => c.label).join(' ; ') || 'ok'},
    {id: 'sound', label: 'Vidéo sonore : voix off présente et audible', ok: technical.checks.find((c) => c.id === 'voice-present')?.ok ?? false, detail: technical.checks.find((c) => c.id === 'voice-present')?.value ?? 'non mesuré'},
    {id: 'review', label: 'Aucun problème bloquant ni doute factuel relevé à la relecture', ok: review.blockingIssues.length === 0 && review.factualConcerns.length === 0, detail: [...review.blockingIssues, ...review.factualConcerns].join(' ; ') || 'ok'},
  ];
  const coherenceRule = config.publish.decisionRule === 'coherence';
  if (coherenceRule) {
    const v = review.verdict;
    gates.push({
      id: 'coherence',
      label: 'Vidéo cohérente et de bonne qualité (verdict de la relecture)',
      ok: Boolean(v?.coherent && v?.goodQuality),
      detail: v ? (v.coherent && v.goodQuality ? v.justification : `${v.coherent ? '' : 'incohérente'}${!v.coherent && !v.goodQuality ? ' et ' : ''}${v.goodQuality ? '' : 'qualité insuffisante'} : ${v.justification}`) : 'verdict de cohérence absent de la relecture',
    });
  }
  const gatesOk = gates.every((g) => g.ok);
  const onlyCoherenceFails = coherenceRule && gates.filter((g) => !g.ok).every((g) => g.id === 'coherence');
  const decision: ScoreReport['decision'] = coherenceRule
    ? gatesOk ? 'publishable' : onlyCoherenceFails ? 'improve' : 'redo'
    : !gatesOk ? 'redo' : total >= config.publish.minScore ? 'publishable' : total >= config.publish.improveFrom ? 'improve' : 'redo';
  const weakest = [...criteria].sort((a, b) => a.score / a.max - b.score / b.max).slice(0, 2).map((c) => c.label);
  const summary = coherenceRule
    ? decision === 'publishable'
      ? `${total}/100 (note indicative) — publiable : cohérente et de bonne qualité selon la relecture, tous les contrôles obligatoires validés.`
      : decision === 'improve'
        ? `${total}/100 (note indicative) — à corriger : ${gates.find((g) => g.id === 'coherence')!.detail}.`
        : `${total}/100 (note indicative) — bloquée : ${gates.filter((g) => !g.ok).map((g) => g.label).join(' ; ')}.`
    : decision === 'publishable'
      ? `${total}/100 — publiable (tous les contrôles obligatoires sont validés).`
      : decision === 'improve'
        ? `${total}/100 — à améliorer avant publication : ${weakest.join(', ')}.`
        : !gatesOk
          ? `${total}/100 — bloquée : ${gates.filter((g) => !g.ok).map((g) => g.label).join(' ; ')}.`
          : `${total}/100 — sous ${config.publish.improveFrom} : à refaire (points faibles : ${weakest.join(', ')}).`;
  return {runId: input.runId, scoredAt: new Date().toISOString(), total, criteria, gates, decision, weakest, summary, virality: viralityOf(review)};
}

export async function scoreStep(runId: string, config: StudioConfig): Promise<ScoreReport> {
  const p = runPaths(runId);
  if (!exists(p.review)) throw new Error(`Relecture manquante : ${path.relative(process.cwd(), p.review)} (voir la consigne du relecteur indépendant dans le guide).`);
  const review = await readValidated(p.review, ReviewSchema);
  if (review.runId !== runId) throw new Error('La relecture ne correspond pas à cette production.');
  const captures = await loadCaptures();
  const timeline = await readJson<Timeline>(p.timeline);
  const capturesOk = timeline.shots
    .filter((s) => s.kind === 'capture')
    .every((s) => s.kind === 'capture' && captures.some((c) => c.id === s.captureId && c.personalDataChecked));
  const report = computeScore({
    runId,
    config,
    script: await readValidated(p.script, ScriptSchema),
    lint: await readJson<LintResult>(p.lint),
    voice: await readJson<VoiceReport>(p.voiceReport),
    technical: await readJson<TechnicalReport>(p.qcTechnical),
    timeline,
    review,
    licenses: await readJsonIfExists<LicenseRecord[]>(p.footageLicenses, []),
    music: await readJsonIfExists<MusicChoice | null>(p.musicChoice, null),
    capturesOk,
  });
  await writeJson(p.score, report);
  return report;
}
