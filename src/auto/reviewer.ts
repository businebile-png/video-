import fs from 'node:fs';
import path from 'node:path';
import {PATHS, runPaths} from '../core/paths.js';
import {readJson, readJsonIfExists, writeJson} from '../core/fsx.js';
import {ReviewSchema, type Review} from '../schemas/records.js';
import {chat, compact, extractJson, imagePart, type ChatPart} from '../llm/client.js';
import {log} from '../core/log.js';

/**
 * Independent review by a free AI that sees the frames (vision model), with the same instructions as the
 * human-grade reviewer (docs/relecteur.md). It never writes the score: `score` still caps every criterion
 * with measurements and keeps every publication lock.
 */
export async function reviewWithLlm(runId: string): Promise<Review> {
  const p = runPaths(runId);
  const guide = fs.readFileSync(path.join(PATHS.root, 'docs', 'relecteur.md'), 'utf8');
  const framesDir = path.join(p.qcDir, 'frames');
  const all = fs.existsSync(framesDir) ? fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).sort() : [];
  if (all.length < 4) throw new Error('Moins de 4 images extraites : lancer « qc » avant la relecture.');
  // The opening (hook), a spread of the middle, and the end card: 9 images at most.
  const pick = [...new Set([...all.slice(0, 3), ...all.filter((_, i) => i % Math.max(1, Math.floor(all.length / 5)) === 0), all[all.length - 1]!])].slice(0, 9);
  const sheet = path.join(p.qcDir, 'contact-sheet.jpg');
  const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '(absent)');
  const plan = await readJsonIfExists<{facts?: Array<{id: string; statement: string}>}>(p.plan, {});
  const small = compact();
  const lint = await readJsonIfExists<{factIdsUsed?: string[]; errors?: unknown[]; warnings?: Array<{message: string}>; viral?: {passed: number; total: number}}>(p.lint, {});
  const script = await readJsonIfExists<{scenes?: Array<{id: string; phase: string; voiceover: string; headline?: string; visual?: {kind?: string}}>; captions?: unknown; cta?: unknown}>(p.script, {});
  const technical = await readJsonIfExists<{durationSec?: number; checks?: Array<{label: string; ok: boolean; value: string}>}>(p.qcTechnical, {});
  const voice = await readJsonIfExists<{score?: number; wer?: number; wpm?: number; problems?: string[]}>(p.voiceReport, {});
  // Small free quotas (GitHub Models): the same information, without the raw files.
  const context = small
    ? [
        `Script (scènes) :\n${(script.scenes ?? []).map((s) => `${s.id} [${s.phase}, ${s.visual?.kind ?? ''}] « ${s.voiceover} »${s.headline ? ` — titre : ${s.headline}` : ''}`).join('\n')}`,
        `Appel à l’action et légendes :\n${JSON.stringify({cta: script.cta, captions: script.captions})}`,
        `Faits vérifiés cités :\n${(plan.facts ?? []).filter((f) => (lint.factIdsUsed ?? []).includes(f.id)).map((f) => `${f.id} : ${f.statement}`).join('\n') || '(aucun)'}`,
        `Voix (mesurée) : ${voice.score ?? '?'}/15, écart de transcription ${voice.wer ?? '?'}, ${voice.wpm ?? '?'} mots/min${voice.problems?.length ? `, problèmes : ${voice.problems.join(' ; ')}` : ''}`,
        `Contrôles techniques (${technical.durationSec ?? '?'} s) :\n${(technical.checks ?? []).map((c) => `${c.ok ? 'ok' : 'ÉCHEC'} — ${c.label} : ${c.value}`).join('\n')}`,
        `Contrôleur du script : ${(lint.errors ?? []).length} erreur(s), avertissements : ${(lint.warnings ?? []).map((w) => w.message).join(' ; ') || 'aucun'}${lint.viral ? ` ; checklist viralité ${lint.viral.passed}/${lint.viral.total}` : ''}`,
      ].join('\n\n')
    : [
        `script.json :\n${read(p.script)}`,
        `Faits vérifiés autorisés :\n${JSON.stringify(plan.facts ?? [], null, 1).slice(0, 12000)}`,
        `voice/report.json :\n${read(p.voiceReport).slice(0, 3000)}`,
        `qc/technical.json :\n${read(p.qcTechnical).slice(0, 6000)}`,
        `script-lint.json :\n${read(p.lint).slice(0, 4000)}`,
      ].join('\n');
  const shown = small ? pick.slice(0, 6) : pick;
  const parts: ChatPart[] = [
    {
      type: 'text',
      text: [
        guide,
        '',
        `Production ${runId}. Tu n’as pas écrit cette vidéo. Voici ses données, puis ses images (dans l’ordre : ${small ? '' : 'planche contact, puis '}${shown.join(', ')}).`,
        context,
        '',
        `Réponds uniquement avec l’objet JSON de la relecture : "runId": "${runId}", "reviewer": "independent-llm", "framesSeen" = les noms de fichiers des images reçues préfixés par « qc/frames/ », chaque justification de 2 à 4 phrases concrètes, les blocs "verdict" (cohérente et de bonne qualité ? dans le doute, false) et "virality" compris.`,
      ].join('\n'),
    },
  ];
  if (!small && fs.existsSync(sheet)) parts.push(imagePart(sheet));
  for (const f of shown) parts.push(imagePart(path.join(framesDir, f), small ? 'low' : undefined));

  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    const reply = await chat([{role: 'user', content: parts}, ...(lastError ? [{role: 'user' as const, content: `Ta réponse précédente était invalide (${lastError}). Renvoie l’objet JSON complet et valide.`}] : [])], {vision: true, temperature: 0.2});
    try {
      const raw = extractJson<Record<string, unknown>>(reply.text);
      raw.runId = runId;
      raw.reviewer = 'independent-llm';
      raw.model = reply.model;
      raw.reviewedAt = new Date().toISOString();
      const seen = Array.isArray(raw.framesSeen) ? (raw.framesSeen as string[]) : [];
      raw.framesSeen = seen.length >= 4 ? seen : shown.map((f) => `qc/frames/${f}`);
      const review = ReviewSchema.parse(raw);
      await writeJson(p.review, review);
      const v = review.virality;
      const viral = v ? v.hook.score + v.retention.score + v.shareability.score + v.engagement.score : null;
      log.ok(`Relecture indépendante par l’IA (${reply.model}) : ${Object.values(review.criteria).reduce((n, c) => n + c.score, 0)}/80${viral !== null ? `, potentiel viral ${viral}/20` : ''}`);
      return review;
    } catch (e) {
      lastError = (e as Error).message.slice(0, 600);
      log.warn(`Relecture (essai ${attempt}/3) invalide : ${lastError}`);
    }
  }
  throw new Error(`Relecture par l’IA impossible : ${lastError}`);
}

/** Concrete corrections for the next version of the script, from the review and the score. */
export async function correctionNotes(runId: string): Promise<string> {
  const p = runPaths(runId);
  const review = await readJson<Review>(p.review);
  const score = await readJsonIfExists<{summary?: string; gates?: Array<{ok: boolean; label: string; detail: string}>}>(p.score, {});
  return [
    score.summary ? `Note : ${score.summary}` : '',
    ...(score.gates ?? []).filter((g) => !g.ok).map((g) => `Contrôle en échec : ${g.label} — ${g.detail}`),
    ...review.blockingIssues.map((b) => `Bloquant : ${b}`),
    ...review.factualConcerns.map((f) => `Doute factuel : ${f}`),
    ...review.improvements.map((i) => `À corriger : ${i}`),
    ...(review.virality?.actions ?? []).map((a) => `Viralité : ${a}`),
  ]
    .filter(Boolean)
    .join('\n');
}
