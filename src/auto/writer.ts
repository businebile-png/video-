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
import {chat, compact, estimateTokens, extractJson, jsonDepth, promptBudget, repairJsonText, type ChatMessage} from '../llm/client.js';
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
                  "shotIdeas": ["ce que montrent les plans (facultatif)"], "mood": "… (facultatif)",
                  "captureId": "<id de capture du brief, scène demo>", "focusRegionIds": ["zones de la capture, 4 max"],
                  "graphic": { "type": "checklist", "title": "…", "items": ["2 à 4 éléments de 34 caractères max"] } },
      "claimFactIds": ["identifiants des faits vérifiés du brief qui prouvent la scène"] } ],
  "cta": { "onScreen": "48 caractères max", "subline": "90 caractères max", "reason": "la vraie raison de cliquer" },
  "captions": { "tiktok": "…", "instagram": "… (facultatif : sinon la légende TikTok est reprise)", "hashtags": ["#mot", "3 à 5"] },
  "author": "api"
}
- 4 à 14 scènes ; la première est « hook », la dernière « cta » et dit « lien en bio ».
- Graphiques possibles : checklist {title?, items}, steps {title?, steps:[{title, detail?}]}, compare {left:{title, items}, right:{title, items}, leftStyle?},
  stat {value, label, factId}, price {plan, price, period, note?, factId}, stack-merge {items (3-6 catégories génériques), result}.
- Aucun autre type de graphique. Dans les textes, guillemets français « » uniquement (jamais de guillemets droits).
- Ne pas écrire la mention « Publicité » dans les légendes : elle est ajoutée automatiquement.`;

const GRAPHIC_TYPES = ['checklist', 'steps', 'stack-merge', 'compare', 'stat', 'price'];
/** Names small models give the studio's graphics (« comparison », « timeline », « pricing »…), most specific first. */
const GRAPHIC_SYNONYMS: Array<[RegExp, string]> = [
  [/compar|versus|^vs$|table|avant|before|split/, 'compare'],
  [/step|etape|étape|process|timeline|flow|sequence|séquence|tuto/, 'steps'],
  [/pric|prix|tarif|offre|offer/, 'price'],
  [/stat|chiffre|number|nombre|count|metric|kpi/, 'stat'],
  [/merge|stack|tout-en-un|all-in-one|fusion/, 'stack-merge'],
  [/list|check|bullet|feature|point|icon|grid/, 'checklist'],
];

/** A graphic under another name, or with its items in the other expected shape: same words, studio's form. */
export function normalizeGraphic(g: Record<string, unknown>): Record<string, unknown> {
  const out = {...g};
  const name = String(out.type ?? '').toLowerCase().trim().replace(/[\s_]+/g, '-');
  let type = GRAPHIC_TYPES.includes(name) ? name : GRAPHIC_SYNONYMS.find(([re]) => re.test(name))?.[1];
  // No usable name: its shape says which graphic it is.
  type ??= Array.isArray(out.steps) ? 'steps' : out.left && out.right ? 'compare' : out.price !== undefined ? 'price' : out.value !== undefined ? 'stat' : Array.isArray(out.items) && out.result ? 'stack-merge' : Array.isArray(out.items) ? 'checklist' : name;
  out.type = type;
  const asStep = (s: unknown) => (typeof s === 'string' ? {title: s} : s);
  if (type === 'steps') {
    if (Array.isArray(out.steps)) out.steps = (out.steps as unknown[]).map(asStep);
    else if (Array.isArray(out.items)) out.steps = (out.items as unknown[]).map(asStep);
  }
  if (type === 'checklist' && !Array.isArray(out.items) && Array.isArray(out.steps)) {
    out.items = (out.steps as unknown[]).map((s) => (typeof s === 'string' ? s : String((s as {title?: unknown})?.title ?? '')));
  }
  for (const k of ['value', 'price']) if (typeof out[k] === 'number') out[k] = String(out[k]);
  return out;
}

/** Kinds of visual under another name (« video », « screenshot », « chart »…). */
function normalizeKind(kind: unknown, hasGraphic: boolean): unknown {
  const k = String(kind ?? '').toLowerCase().trim();
  if (['broll', 'demo', 'graphic'].includes(k)) return k;
  if (/capture|screen|écran|ecran|interface/.test(k)) return 'demo';
  if (/graph|chart|infog|schema|schéma/.test(k) || (!k && hasGraphic)) return 'graphic';
  if (/b-?roll|video|vidéo|footage|stock|plan|image|photo/.test(k) || !k) return 'broll';
  return kind;
}

function systemPrompt(): string {
  return [
    'Tu es scénariste de publicités verticales (TikTok, Instagram Reels) en français pour Systeme.io, payées par affiliation.',
    'CONSIGNE N° 1 DE L’UTILISATEUR : la vidéo doit être COHÉRENTE. Un seul sujet du début à la fin ; chaque phrase suit logiquement la précédente ; chaque scène montre exactement ce que dit sa phrase (capture réelle, graphique ou plan filmé en rapport direct) ; chaque chiffre dit est celui affiché à l’écran et celui du fait vérifié ; l’appel à l’action découle de ce qui vient d’être montré.',
    'CONSIGNE N° 2 DE L’UTILISATEUR : inspire-toi ÉNORMÉMENT des scripts du studio donnés en exemple (vidéos déjà publiées) : même ton, même structure, même longueur de phrases, mêmes preuves à l’écran (captures officielles des tarifs, zones de focus), même façon de finir. Change seulement le sujet, l’angle et les mots de l’accroche.',
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

/**
 * Form slips small free models make again and again (hashtags left in the caption text, a list sent as a string,
 * a number as text, scene ids « 1 » instead of « s1 »): fixed before the checks. Content is never touched.
 */
export function repairScript(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {...raw};
  const list = (v: unknown): unknown[] | undefined => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean) : undefined);
  if (typeof out.targetDurationSec === 'string') out.targetDurationSec = Number.parseFloat(out.targetDurationSec);
  const captions = (out.captions && typeof out.captions === 'object' ? {...(out.captions as Record<string, unknown>)} : {}) as Record<string, unknown>;
  if (typeof captions.instagram !== 'string' && typeof captions.tiktok === 'string') captions.instagram = captions.tiktok;
  if (typeof captions.tiktok !== 'string' && typeof captions.instagram === 'string') captions.tiktok = captions.instagram;
  let tags = typeof captions.hashtags === 'string' ? captions.hashtags.split(/\s+/) : Array.isArray(captions.hashtags) ? (captions.hashtags as unknown[]) : undefined;
  if (!tags || tags.length === 0) tags = `${captions.tiktok ?? ''} ${captions.instagram ?? ''} ${out.hashtags ?? ''}`.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const clean = [...new Set(tags.map((t) => String(t).trim()).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`).replace(/[^#\p{L}\p{N}_]/gu, '')))].filter((t) => t.length > 1);
  captions.hashtags = (clean.length >= 2 ? clean : [...clean, '#systemeio', '#entrepreneur', '#businessenligne']).filter((t, i, a) => a.indexOf(t) === i).slice(0, 5);
  out.captions = captions;
  if (Array.isArray(out.scenes)) {
    out.scenes = (out.scenes as Array<Record<string, unknown>>).map((sc, i) => {
      const s = {...sc};
      if (typeof s.id === 'number' || (typeof s.id === 'string' && /^\d+$/.test(s.id))) s.id = `s${s.id}`;
      if (typeof s.id !== 'string') s.id = `s${i + 1}`;
      s.emphasis = list(s.emphasis) ?? [];
      s.claimFactIds = list(s.claimFactIds) ?? [];
      const v = (s.visual && typeof s.visual === 'object' ? {...(s.visual as Record<string, unknown>)} : {kind: 'broll'}) as Record<string, unknown>;
      v.queries = list(v.queries) ?? [];
      v.shotIdeas = list(v.shotIdeas) ?? [];
      v.focusRegionIds = list(v.focusRegionIds) ?? [];
      if (v.graphic && typeof v.graphic === 'object' && !Array.isArray(v.graphic)) v.graphic = normalizeGraphic(v.graphic as Record<string, unknown>);
      v.kind = normalizeKind(v.kind, Boolean(v.graphic));
      s.visual = v;
      return s;
    });
  }
  return out;
}

const withoutFences = (t: string) => t.replace(/```(?:json)?/g, '');

/** True when the reply stops before the end of its JSON (the service's output limit). */
export function replyIsCut(text: string, finish?: string | null): boolean {
  try {
    extractJson(text);
    return false;
  } catch {
    return finish === 'length' || jsonDepth(repairJsonText(withoutFences(text))) > 0;
  }
}

/** Joins the rest of a cut reply to it; a model that starts over sends a whole object, which then replaces it. */
export function joinContinuation(text: string, next: string): string {
  // Only the fence and its line break go: a space that starts the rest is part of the sentence.
  const rest = next.replace(/^\s*```(?:json)?[ \t]*\r?\n?/, '');
  return /^\s*\{\s*"runId"/.test(rest) ? rest : text + rest;
}

/** Asks (twice at most) for the end of a reply the service cut. Nothing is ever completed by the studio itself. */
async function completeReply(messages: ChatMessage[], first: {text: string; finish?: string | null}): Promise<{text: string; cut: boolean}> {
  let {text, finish} = first;
  for (let k = 0; k < 2 && replyIsCut(text, finish); k++) {
    const more = await chat([...messages, {role: 'assistant', content: text}, {role: 'user', content: 'Ta réponse a été coupée. Écris uniquement la suite, exactement à partir du dernier caractère envoyé, sans rien répéter.'}], {temperature: 0.2});
    text = joinContinuation(text, more.text);
    finish = more.finish;
  }
  return {text, cut: replyIsCut(text, finish)};
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
  // Scripts of the studio's published videos: the model to imitate (the user's choice: « prendre énormément exemple »).
  const examplesDir = path.join(PATHS.root, 'docs', 'exemples');
  const examples = fs.existsSync(examplesDir) ? fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => fs.readFileSync(path.join(examplesDir, f), 'utf8')) : [];
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
  // Free tiers with small requests: trimmed facts, then as many examples as fit (GitHub Models about 8 000 tokens).
  const small = compact();
  const budget = promptBudget();
  let request = build(brief);
  if (small && estimateTokens(systemPrompt() + request) > budget - 1500) {
    const words = [...category.features, 'plan', 'pric', 'tarif', 'free', 'gratuit'];
    request = build(trimFacts(brief, (l) => words.some((w) => l.toLowerCase().includes(w))));
  }
  let exampleBlock = '';
  for (const [i, ex] of examples.entries()) {
    const block = `\n\nEXEMPLE ${i + 1} — script d’une vidéo déjà publiée par le studio (le niveau, le ton et le genre de vidéo à imiter énormément ; ne pas copier son accroche) :\n${small ? compactExample(ex) : ex}`;
    if (estimateTokens(systemPrompt() + request + exampleBlock + block) > budget) break;
    exampleBlock += block;
  }
  const withExample = request + exampleBlock;
  const system: ChatMessage = {role: 'system', content: systemPrompt()};
  let messages: ChatMessage[] = [system, {role: 'user', content: withExample}];
  const max = opts.maxAttempts ?? 6;
  let best: WriteResult | null = null;
  let lastProblems = '';
  let model = '';
  // Every reply and what was wrong with it, for the run's report (GitHub artifact « compte-rendu »).
  const attempts: Array<Record<string, unknown>> = [];
  for (let attempt = 1; attempt <= max; attempt++) {
    const first = await chat(messages, {temperature: attempt === 1 ? 0.8 : 0.5});
    model = first.model;
    const reply = {...first, ...(await completeReply(messages, first))};
    let problems: string[] = [];
    let raw: Record<string, unknown> | null = null;
    try {
      raw = extractJson<Record<string, unknown>>(reply.text);
    } catch (e) {
      problems = [`JSON illisible : ${(e as Error).message}`];
    }
    if (!raw && reply.cut) {
      problems = ['Réponse coupée avant la fin du JSON (limite de longueur du service) : renvoie un script plus court (phrases courtes, sans « shotIdeas » ni « mood », légende Instagram omise).'];
    }
    if (raw) {
      raw = repairScript(raw);
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
    attempts.push({attempt, model, finish: reply.finish ?? null, cut: reply.cut, chars: reply.text.length, problems, reply: reply.text.slice(0, 20_000)});
    await writeJson(path.join(p.dir, 'writer-attempts.json'), attempts);
    log.warn(`Script (essai ${attempt}/${max}) à reprendre : ${problems.length} point(s) — ${problems.slice(0, 2).map((x) => x.slice(0, 180)).join(' | ')}`);
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
