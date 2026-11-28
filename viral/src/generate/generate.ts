import fs from 'node:fs';
import path from 'node:path';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {sizeSpec} from '../core/config.js';
import {getAccount, type Account} from '../core/accounts.js';
import {PATHS, ensureDir} from '../core/paths.js';
import {fnv1a, normalize} from '../core/text.js';
import {id as newId, nowIso, sha256, parseJson} from '../core/util.js';
import {AiRouter, NoModelAvailable, OfflineFallback} from '../ai/router.js';
import {composeBatch, ideasFromDrafts, slideText} from './composer.js';
import {aiBatch, buildPrompt, draftsFromAi, SYSTEM_PROMPT} from './llm.js';
import {loadLibrary, matchTopic} from './library.js';
import type {GenerateRequest, SlideshowDraft, IdeaDraft} from './types.js';

export interface GenerateResult {
  batchId: string;
  engine: string;
  requested: number;
  slideshowIds: string[];
  ideaIds: string[];
  notes: string[];
  costUsd: number;
}

export function saveDraft(db: Db, cfg: AppConfig, d: SlideshowDraft, batchId: string, ideaId?: string): string {
  const id = newId('ss');
  const size = sizeSpec(cfg, d.format);
  const text = slideText(d.slides);
  const now = nowIso();
  db.upsert('slideshows', {
    id,
    idea_id: ideaId ?? null,
    batch_id: batchId,
    account_id: d.accountId,
    platform: d.platform,
    title: d.title,
    hook: d.hook,
    hook_type: d.hookType,
    structure: d.structure,
    topic: d.topic,
    template: d.template,
    format: d.format,
    width: size.width,
    height: size.height,
    language: d.language,
    tone: d.tone,
    style: d.style,
    slides_json: JSON.stringify(d.slides),
    caption: d.caption,
    hashtags_json: JSON.stringify(d.hashtags),
    cta: d.cta,
    fact_ids_json: JSON.stringify(d.factIds),
    status: 'draft',
    content_hash: sha256(normalize(text)),
    text_fingerprint: fnv1a(normalize(text)),
    engine: d.engine,
    model: d.model ?? null,
    predicted: d.predicted ?? null,
    created_at: now,
    updated_at: now,
  });
  return id;
}

function saveIdea(db: Db, idea: IdeaDraft, batchId: string): string {
  const id = newId('idea');
  db.upsert('ideas', {
    id,
    batch_id: batchId,
    account_id: idea.accountId,
    niche: null,
    topic: idea.topic,
    angle: idea.angle,
    hook: idea.hook,
    hook_type: idea.hookType,
    structure: idea.structure,
    template: idea.template,
    format: idea.format,
    slide_count: idea.slides,
    tone: idea.tone,
    style: idea.template,
    language: idea.language,
    predicted: idea.predicted,
    rationale: idea.rationale,
    status: 'new',
    engine: idea.engine,
    created_at: nowIso(),
  });
  return id;
}

function needsAi(req: GenerateRequest, account: Account): string | null {
  const lang = req.language ?? account.language;
  if (lang !== 'fr') return `langue « ${lang} » : la bibliothèque hors ligne est en français`;
  if (req.topic && !matchTopic(loadLibrary(), req.topic)) return `sujet libre « ${req.topic} » absent de la bibliothèque`;
  return null;
}

/**
 * Generates ideas or full slideshows for one account.
 * engine "auto": the AI router first (models chosen per role, budget and quotas enforced); if no AI model is
 * usable, the offline composer takes over — unless the request needs the AI (other language, free topic).
 */
export async function generate(db: Db, cfg: AppConfig, req: GenerateRequest, router = new AiRouter(db, cfg)): Promise<GenerateResult> {
  const account = getAccount(db, req.accountId);
  if (!account.slideshows) throw new Error(`${account.id} : les carrousels sont désactivés pour ce compte (${account.notes ?? 'voir Comptes'})`);
  const quantity = Math.max(1, Math.min(500, Math.round(req.quantity)));
  const batchId = req.batchId ?? newId('batch');
  const notes: string[] = [];
  let drafts: SlideshowDraft[] = [];
  let engine = req.engine ?? 'auto';
  let costUsd = 0;
  const aiReason = needsAi(req, account);

  if (engine !== 'composer') {
    try {
      const r = await aiBatch(db, cfg, router, account, {...req, quantity});
      drafts = r.drafts;
      costUsd = r.cost;
      notes.push(`IA : ${[...new Set(r.models)].join(', ')} (${r.cost.toFixed(4)} $)`);
      if (r.rejected.length) notes.push(...r.rejected.map((x) => `rejeté : ${x}`));
      engine = 'ai';
    } catch (e) {
      if (!(e instanceof OfflineFallback) && !(e instanceof NoModelAvailable)) throw e;
      const failures = (e as OfflineFallback | NoModelAvailable).failures;
      if (engine === 'ai' || aiReason) {
        throw new Error(`Aucune IA disponible pour cette demande${aiReason ? ` (${aiReason})` : ''} : ${failures.join(' | ')}`);
      }
      notes.push(`IA indisponible, moteur hors ligne utilisé (${failures.slice(0, 3).join(' | ')}${failures.length > 3 ? '…' : ''})`);
      engine = 'composer';
    }
  }
  if (engine === 'composer') {
    if (aiReason) throw new Error(`Le moteur hors ligne ne peut pas traiter cette demande : ${aiReason}`);
    drafts = composeBatch(db, cfg, account, {...req, quantity});
    if (drafts.length < quantity) notes.push(`${drafts.length} carrousel(s) distincts possibles sur ${quantity} demandés avec ces critères (bibliothèque épuisée sans doublon).`);
  }

  const slideshowIds: string[] = [];
  const ideaIds: string[] = [];
  db.tx(() => {
    if ((req.mode ?? 'slideshows') === 'ideas') {
      for (const idea of ideasFromDrafts(drafts)) ideaIds.push(saveIdea(db, idea, batchId));
    } else {
      for (const d of drafts) slideshowIds.push(saveDraft(db, cfg, d, batchId));
    }
  });
  db.event('generate', `${slideshowIds.length || ideaIds.length} ${req.mode === 'ideas' ? 'idées' : 'carrousels'} pour ${account.id} (${engine})`, {ref: batchId, data: {req, notes}});
  return {batchId, engine, requested: quantity, slideshowIds, ideaIds, notes, costUsd};
}

/** Turns a stored idea into a full slideshow with the composer (same topic, structure and template). */
export function ideaToSlideshow(db: Db, cfg: AppConfig, ideaId: string): string | null {
  const idea = db.get('SELECT * FROM ideas WHERE id = ?', ideaId);
  if (!idea) throw new Error(`Idée inconnue : ${ideaId}`);
  const account = getAccount(db, idea.account_id);
  const [d] = composeBatch(db, cfg, account, {accountId: account.id, quantity: 1, topic: idea.topic, structure: idea.structure, template: idea.template, slides: idea.slide_count, format: idea.format, seed: ideaId});
  if (!d) return null;
  const id = saveDraft(db, cfg, d, idea.batch_id ?? newId('batch'), ideaId);
  db.run("UPDATE ideas SET status = 'used' WHERE id = ?", ideaId);
  return id;
}

/** Writes a brief (prompt + rules + expected JSON) for a Claude session or any chat AI. */
export function writeBrief(db: Db, cfg: AppConfig, req: GenerateRequest): {file: string; batchId: string} {
  const account = getAccount(db, req.accountId);
  const batchId = req.batchId ?? newId('batch');
  ensureDir(PATHS.briefs);
  const file = path.join(PATHS.briefs, `${batchId}.json`);
  fs.writeFileSync(file, JSON.stringify({batchId, request: {...req, batchId}, system: SYSTEM_PROMPT, prompt: buildPrompt(db, cfg, account, req, Math.min(20, req.quantity))}, null, 2));
  fs.writeFileSync(file.replace(/\.json$/, '.md'), `# Brief ${batchId}\n\n## Consignes\n\n${SYSTEM_PROMPT}\n\n## Demande\n\n${buildPrompt(db, cfg, account, req, Math.min(20, req.quantity))}\n\nRéponse attendue : un fichier JSON, puis \`npm run viral -- ingest <fichier> --brief ${batchId}\`.\n`);
  return {file, batchId};
}

/** Imports the JSON answer to a brief (written by a Claude session) as draft slideshows. */
export function ingest(db: Db, cfg: AppConfig, answerFile: string, briefId: string, engine = 'claude-session'): {slideshowIds: string[]; rejected: string[]} {
  const brief = parseJson<any>(fs.readFileSync(path.join(PATHS.briefs, `${briefId}.json`), 'utf8'), null);
  if (!brief) throw new Error(`Brief introuvable : ${briefId}`);
  const req = brief.request as GenerateRequest;
  const account = getAccount(db, req.accountId);
  const answer = JSON.parse(fs.readFileSync(answerFile, 'utf8'));
  const {drafts, rejected} = draftsFromAi(db, cfg, account, req, answer, engine);
  const ids = drafts.map((d) => saveDraft(db, cfg, d, briefId));
  db.event('generate', `${ids.length} carrousels importés depuis une session (${rejected.length} rejetés)`, {ref: briefId, data: {rejected}});
  return {slideshowIds: ids, rejected};
}
