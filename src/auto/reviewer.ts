import fs from 'node:fs';
import path from 'node:path';
import {PATHS, runPaths} from '../core/paths.js';
import {readJson, readJsonIfExists, writeJson} from '../core/fsx.js';
import {ReviewSchema, type Review} from '../schemas/records.js';
import {chat, extractJson, imagePart, type ChatPart} from '../llm/client.js';
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
  const plan = await readJsonIfExists<{facts?: unknown[]}>(p.plan, {});
  const parts: ChatPart[] = [
    {
      type: 'text',
      text: [
        guide,
        '',
        `Production ${runId}. Tu n’as pas écrit cette vidéo. Voici ses fichiers, puis ses images (dans l’ordre : planche contact, puis ${pick.join(', ')}).`,
        `script.json :\n${read(p.script)}`,
        `Faits vérifiés autorisés :\n${JSON.stringify(plan.facts ?? [], null, 1).slice(0, 12000)}`,
        `voice/report.json :\n${read(p.voiceReport).slice(0, 3000)}`,
        `qc/technical.json :\n${read(p.qcTechnical).slice(0, 6000)}`,
        `script-lint.json :\n${read(p.lint).slice(0, 4000)}`,
        '',
        `Réponds uniquement avec l’objet JSON de la relecture : "runId": "${runId}", "reviewer": "independent-llm", "framesSeen" = les noms de fichiers des images reçues préfixés par « qc/frames/ », chaque justification de 2 à 4 phrases concrètes, les blocs "verdict" (cohérente et de bonne qualité ? dans le doute, false) et "virality" compris.`,
      ].join('\n'),
    },
  ];
  if (fs.existsSync(sheet)) parts.push(imagePart(sheet));
  for (const f of pick) parts.push(imagePart(path.join(framesDir, f)));

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
      raw.framesSeen = seen.length >= 4 ? seen : pick.map((f) => `qc/frames/${f}`);
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
