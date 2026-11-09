import fs from 'node:fs';
import path from 'node:path';
import {PATHS, runPaths} from '../core/paths.js';
import {readJson, writeJson} from '../core/fsx.js';
import {loadConfig, loadEditorial} from '../core/config.js';
import {loadCaptures, loadHistory, upsertHistory} from '../core/stores.js';
import {loadFacts} from '../facts/facts.js';
import {lintScript, type LintResult} from '../script/lint.js';
import {viralChecklist, VIRAL_MIN_PASSED, type ViralChecklist} from '../script/viral.js';
import {ScriptSchema, type Script} from '../schemas/script.js';
import {chat, compact, estimateTokens, extractJson, type ChatMessage} from '../llm/client.js';
import {log} from '../core/log.js';
import type {Plan} from '../editorial/plan.js';

/**
 * The script, written by a free AI (any OpenAI-compatible endpoint) instead of Claude, under exactly the
 * same rules: the brief of the plan, then the studio's own checks (schema, legal lint, verified facts,
 * virality checklist). Every problem found is sent back to the AI until the script passes, or the run stops.
 */

const FORMAT = `FORMAT (objet JSON unique, sans texte autour) :
{
  "runId": "<runId>", "category": "<id de la catégorie du brief>", "angle": "…", "persona": "…",
  "hookStyle": "<id d'un style d'accroche du brief>", "workingTitle": "…", "targetDurationSec": <nombre>,
  "scenes": [ { "id": "s1", "phase": "hook|problem|agitation|solution|demo|benefits|proof|objection|cta",
      "voiceover": "texte dit (3 à 320 caractères)", "headline": "titre à l'écran, 42 caractères max (facultatif)",
      "emphasis": ["mots de la voix à surligner, 4 max"],
      "visual": { "kind": "broll|demo|graphic", "queries": ["2 à 4 recherches de séquences en anglais, 2-3 mots filmables"],
                  "shotIdeas": ["ce que montrent les plans"], "mood": "…",
                  "captureId": "<id de capture du brief, scène demo>", "focusRegionIds": ["zones de la capture, 4 max"],
                  "graphic": { "type": "checklist", "title": "…", "items": ["2 à 4 éléments de 34 caractères max"] } },
      "claimFactIds": ["identifiants des faits vérifiés du brief qui prouvent la scène"] } ],
  "cta": { "onScreen": "48 caractères max", "subline": "90 caractères max", "reason": "la vraie raison de cliquer" },
  "captions": { "tiktok": "…", "instagram": "…", "hashtags": ["#mot", "3 à 5"] },
  "author": "api"
}
- 4 à 14 scènes ; la première est « hook », la dernière « cta » et dit « lien en bio ».
- Graphiques possibles : checklist {title?, items}, steps {title?, steps:[{title, detail?}]}, compare {left:{title, items}, right:{title, items}, leftStyle?},
  stat {value, label, factId}, price {plan, price, period, note?, factId}, stack-merge {items (3-6 catégories génériques), result}.
- Ne pas écrire la mention « Publicité » dans les légendes : elle est ajoutée automatiquement.`;

function systemPrompt(): string {
  return [
    'Tu es scénariste de publicités verticales (TikTok, Instagram Reels) en français pour Systeme.io, payées par affiliation.',
    'Tu écris pour l’oreille, en tutoyant, des phrases courtes ; tu ne cites que les faits vérifiés fournis, avec leurs identifiants.',
    'Interdits absolus : promesse de revenus ou de résultat, fausse urgence, superlatif (« le meilleur »), faux témoignage, nom de concurrent, image de richesse, « secret de ma réussite », interface inventée.',
    'Tu réponds uniquement avec l’objet JSON demandé.',
  ].join('\n');
}

/** The script instructions a Claude session follows (guide, section 5), so the free AI writes the same kind of video. */
function studioGuide(): string {
  const file = path.join(PATHS.root, 'docs', 'production-quotidienne.md');
  if (!fs.existsSync(file)) return '';
  const text = fs.readFileSync(file, 'utf8');
  const start = text.indexOf('## 5. Script');
  const end = text.indexOf('\n## 6.', start);
  if (start < 0) return '';
  return text
    .slice(start, end > start ? end : undefined)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^Corriger jusqu.*$/m, '')
    .trim();
}

/** A published script reduced to what shows the expected level: words, titles, proofs, graphics, captions. */
function compactExample(raw: string): string {
  try {
    const s = JSON.parse(raw) as Script;
    return JSON.stringify({
      hookStyle: s.hookStyle,
      targetDurationSec: s.targetDurationSec,
      scenes: s.scenes.map((x) => ({
        id: x.id,
        phase: x.phase,
        voiceover: x.voiceover,
        headline: x.headline,
        emphasis: x.emphasis,
        visual: {kind: x.visual.kind, captureId: x.visual.captureId, captureIds: x.visual.captureIds, captureCues: x.visual.captureCues, focusRegionIds: x.visual.focusRegionIds, focusLabels: x.visual.focusLabels, graphic: x.visual.graphic, queries: x.visual.queries.slice(0, 2)},
        claimFactIds: x.claimFactIds,
      })),
      cta: s.cta,
      captions: {tiktok: s.captions.tiktok.slice(0, 400), hashtags: s.captions.hashtags},
    });
  } catch {
    return raw;
  }
}

/** Small free quotas: keep only the verified facts the category can use (pricing, plans, its own features). */
function trimFacts(brief: string, keep: (line: string) => boolean): string {
  const lines = brief.split('\n');
  let inFacts = false;
  return lines
    .filter((l) => {
      if (l.startsWith('## ')) inFacts = l.startsWith('## Faits vérifiés');
      return !inFacts || !l.startsWith('- `') || keep(l);
    })
    .join('\n');
}

export interface WriteResult {
  script: Script;
  lint: LintResult;
  viral: ViralChecklist;
  attempts: number;
  model: string;
}

export async function writeScript(runId: string, opts: {notes?: string; maxAttempts?: number} = {}): Promise<WriteResult> {
  const p = runPaths(runId);
  const plan = await readJson<Plan>(p.plan);
  const brief = fs.readFileSync(p.planMd, 'utf8');
  const examplePath = path.join(PATHS.root, 'docs', 'exemple-script.json');
  const example = fs.existsSync(examplePath) ? fs.readFileSync(examplePath, 'utf8') : '';
  const config = await loadConfig();
  const editorial = await loadEditorial();
  const category = editorial.categories.find((c) => c.id === plan.category.id)!;
  const facts = (await loadFacts()).facts;
  const captures = await loadCaptures();
  const history = (await loadHistory()).filter((h) => h.runId !== runId).sort((a, b) => b.runId.localeCompare(a.runId));
  const ctx = {category, editorial, config, facts, captures, recentHooks: plan.recentHooks, recentAngles: plan.recentAngles, lastHookStyle: history[0]?.hookStyle ?? null};

  const guide = studioGuide();
  const build = (b: string) =>
    [
      `Écris le script de la production ${runId} en suivant ce brief à la lettre.`,
      '',
      b,
      '',
      guide ? `CONSIGNES DU STUDIO (les mêmes que pour les vidéos déjà publiées) :\n${guide}\n` : '',
      FORMAT,
      opts.notes ? `\nCORRECTIONS DEMANDÉES par la relecture de la version précédente (à appliquer toutes) :\n${opts.notes}` : '',
    ].join('\n');
  // Free tiers with small requests (GitHub Models, about 8 000 tokens): trimmed facts, then the example only if it fits.
  const small = compact();
  const budget = 6800;
  let request = build(brief);
  if (small && estimateTokens(systemPrompt() + request) > budget - 1500) {
    const words = [...category.features, 'plan', 'pric', 'tarif', 'free', 'gratuit'];
    request = build(trimFacts(brief, (l) => words.some((w) => l.toLowerCase().includes(w))));
  }
  const exampleBlock = example ? `\n\nEXEMPLE d’un script déjà publié par le studio (le niveau et le genre de vidéo attendus ; ne pas le copier, ne pas reprendre son accroche) :\n${small ? compactExample(example) : example}` : '';
  const withExample = !small || estimateTokens(systemPrompt() + request + exampleBlock) <= budget ? request + exampleBlock : request;
  const system: ChatMessage = {role: 'system', content: systemPrompt()};
  let messages: ChatMessage[] = [system, {role: 'user', content: withExample}];
  const max = opts.maxAttempts ?? 6;
  let best: WriteResult | null = null;
  let lastProblems = '';
  let model = '';
  for (let attempt = 1; attempt <= max; attempt++) {
    const reply = await chat(messages, {temperature: attempt === 1 ? 0.8 : 0.5});
    model = reply.model;
    let problems: string[] = [];
    let raw: Record<string, unknown> | null = null;
    try {
      raw = extractJson<Record<string, unknown>>(reply.text);
    } catch (e) {
      problems = [`JSON illisible : ${(e as Error).message}`];
    }
    if (raw) {
      raw.runId = runId;
      raw.category = plan.category.id;
      raw.author = 'api';
      const parsed = ScriptSchema.safeParse(raw);
      if (!parsed.success) {
        problems = parsed.error.issues.slice(0, 12).map((i) => `${i.path.join('.') || 'racine'} : ${i.message}`);
      } else {
        const script = parsed.data;
        const lint = lintScript(script, ctx);
        const viral = viralChecklist(script);
        if (!lint.ok) problems = lint.errors.map((e) => `${e.where} [${e.rule}] ${e.message}`);
        else {
          const candidate = {script, lint, viral, attempts: attempt, model};
          if (!best || viral.passed > best.viral.passed) best = candidate;
          if (viral.passed >= VIRAL_MIN_PASSED || attempt >= max - 1) break;
          problems = viral.items.filter((i) => !i.ok).map((i) => `[viralité] ${i.label} (${i.detail}) → ${i.fix}`);
          problems.push(...lint.warnings.slice(0, 5).map((w) => `[avertissement] ${w.where} : ${w.message}`));
        }
      }
    }
    lastProblems = problems.join('\n');
    log.warn(`Script (essai ${attempt}/${max}) à reprendre : ${problems.length} point(s)`);
    // Only the last exchange is sent back (small free quotas): the brief, the last script, what to fix.
    messages = [
      system,
      {role: 'user', content: request},
      {role: 'assistant', content: reply.text},
      {role: 'user', content: `Le contrôleur du studio refuse ou demande d’améliorer ce script :\n${lastProblems}\n\nRenvoie le script complet corrigé (objet JSON seul), sans rien inventer.`},
    ];
  }
  if (!best) throw new Error(`L’IA n’a pas produit de script conforme après ${max} essais. Derniers problèmes :\n${lastProblems}`);
  await writeJson(p.script, best.script);
  await writeJson(p.lint, {...best.lint, viral: best.viral});
  await upsertHistory({runId, hook: best.script.scenes[0]!.voiceover, hookStyle: best.script.hookStyle, angle: best.script.angle, workingTitle: best.script.workingTitle});
  log.ok(`Script écrit par l’IA (${best.model}) en ${best.attempts} essai(s) : conforme, viralité ${best.viral.passed}/${best.viral.total}, ~${best.lint.estimatedDurationSec} s`);
  return best;
}
