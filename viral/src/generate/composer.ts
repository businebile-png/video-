import type {Db} from '../core/db.js';
import type {AppConfig, Format} from '../core/config.js';
import {platformSpec} from '../core/config.js';
import type {Account} from '../core/accounts.js';
import {loadFacts, verifiedOnLabel, usableFacts} from '../core/facts.js';
import {rng, shuffle} from '../core/util.js';
import {shingles, jaccard, round} from '../core/text.js';
import {choose, preferences} from '../analytics/learn.js';
import {slideBucket} from '../intel/features.js';
import {TEMPLATES, TEMPLATE_IDS} from '../render/templates.js';
import {capacity, fillTemplate, loadLibrary, matchTopic, type LibItem, type LibTopic} from './library.js';
import {buildCaption, pickHashtags} from './captions.js';
import {STRUCTURES, type GenStructure, type GenerateRequest, type IdeaDraft, type Slide, type SlideshowDraft, type Tone} from './types.js';

/**
 * Offline engine ("composer"): builds original slideshows from the studio's own content library,
 * choosing topic, structure, hook, template and slide count with the learning loop (Thompson sampling),
 * never repeating a near-identical slideshow for the same account. Needs no API key.
 */

const COMPARE_LABELS: Partial<Record<GenStructure, [string, string]>> = {
  erreurs: ['Erreur', 'À faire'],
  'mythe-realite': ['Idée reçue', 'En réalité'],
  'avant-apres': ['Avant', 'Après'],
};

export function slideText(slides: Slide[]): string {
  return slides.map((s) => [s.label, s.title, s.body, s.left, s.right, s.product?.title, s.product?.body].filter(Boolean).join(' ')).join('\n');
}

/** Core content of a slideshow (call-to-action slide left out): what makes two slideshows the same. */
export function coreText(slides: Slide[]): string {
  return slideText(slides.filter((s) => s.kind !== 'cta'));
}

function itemsFor(t: LibTopic, s: GenStructure): LibItem[] {
  switch (s) {
    case 'liste':
      return t.tips ?? [];
    case 'erreurs':
      return t.mistakes ?? [];
    case 'etapes':
      return t.steps ?? [];
    case 'faits':
      return t.factItems ?? [];
    case 'mythe-realite':
      return (t.myths ?? []).map((m) => ({title: m.myth, body: m.reality, factIds: m.factIds}));
    case 'avant-apres':
      return (t.beforeAfter ?? []).map((m) => ({title: m.before, body: m.after, factIds: m.factIds}));
    case 'definition':
      return t.tips ?? t.steps ?? [];
    default:
      return [];
  }
}

/** How many content slides a structure needs to fill `total` slides (cover + content + CTA). */
function contentCount(s: GenStructure, total: number): number {
  if (s === 'histoire') return 4;
  if (s === 'definition') return total - 3;
  return total - 2;
}

export interface ComposeContext {
  db: Db;
  cfg: AppConfig;
  account: Account;
  rand: () => number;
  existing: Array<{account_id: string; hook: string; fp: Set<string>; story?: string}>;
}

export function composeOne(ctx: ComposeContext, req: GenerateRequest, attempt = 0): SlideshowDraft | null {
  const {db, cfg, account, rand} = ctx;
  const lib = loadLibrary();
  const facts = loadFacts();
  const usable = new Set(usableFacts(facts).map((f) => f.id));
  const spec = platformSpec(cfg, account.platform);
  if (!spec.carousel) throw new Error(`${account.id} : ${spec.label} ne publie pas de carrousel par API`);
  const format: Format = req.format && spec.formats.includes(req.format) ? req.format : (account.brand.defaultFormat ?? spec.defaultFormat);
  const minSlides = Math.max(spec.minSlides, 4);
  const maxSlides = Math.min(spec.maxSlides, 12);

  // 1. Topic: requested (closest library topic) or learned preference, with a penalty for recently used topics.
  const recentTopics = db.all<{topic: string}>('SELECT topic FROM slideshows WHERE account_id = ? ORDER BY created_at DESC LIMIT 6', account.id).map((r) => r.topic);
  const factOk = (ids: string[] | undefined) => (ids ?? []).every((i) => usable.has(i));
  let topic: LibTopic | null = req.topic ? matchTopic(lib, req.topic) : null;
  if (req.topic && !topic) throw new Error(`Sujet « ${req.topic} » absent de la bibliothèque : utilise le moteur IA (engine "ai") pour un sujet libre.`);
  if (!topic) {
    const candidates = lib.topics.filter((t) => (req.structure ? [req.structure] : STRUCTURES).some((s) => capacity(t, s) >= 3 || (s === 'histoire' && capacity(t, s) > 0)));
    if (candidates.length === 0) return null;
    const pick = choose(db, {dimension: 'topic', values: candidates.map((t) => t.id), accountId: account.id, platform: account.platform, rand, penalty: (v) => recentTopics.filter((x) => x === v).length * 6});
    topic = candidates.find((t) => t.id === pick.value)!;
  }

  // 2. Structure available for this topic and slide count.
  const wanted = req.slides ? Math.min(maxSlides, Math.max(minSlides, req.slides)) : null;
  const structures = (req.structure ? [req.structure] : [...STRUCTURES]).filter((s) => {
    const cap = capacity(topic!, s);
    if (cap === 0) return false;
    if (s === 'faits' && !itemsFor(topic!, s).some((i) => factOk(i.factIds))) return false;
    if (wanted === null) return cap >= 3 || s === 'histoire';
    if (s === 'histoire') return wanted === 6;
    if (s === 'etapes') return cap === contentCount(s, wanted);
    return cap >= contentCount(s, wanted);
  });
  if (structures.length === 0) return null;
  const toldStories = new Set(db.all<{topic: string}>("SELECT topic FROM slideshows WHERE account_id = ? AND structure = 'histoire' AND status NOT IN ('rejected', 'qc_failed')", account.id).map((r) => r.topic));
  const allowed = structures.filter((s) => s !== 'histoire' || (!toldStories.has(topic!.id) && !ctx.existing.some((e) => e.account_id === account.id && e.story === topic!.id)));
  if (allowed.length === 0) return attempt < 6 ? composeOne(ctx, req, attempt + 1) : null;
  const structure = choose(db, {dimension: 'structure', values: allowed, accountId: account.id, platform: account.platform, rand}).value as GenStructure;

  // 3. Number of slides: requested, else learned preference among what the topic can fill.
  const cap = capacity(topic, structure);
  let total: number;
  if (structure === 'histoire') total = 6;
  else if (structure === 'etapes') total = cap + 2;
  else if (wanted) total = wanted;
  else {
    let options = [6, 7, 8, 9, 10].filter((n) => n >= minSlides && n <= maxSlides && contentCount(structure, n) <= cap && contentCount(structure, n) >= 3);
    if (options.length === 0) options = [5, 11, 12].filter((n) => n >= minSlides && n <= maxSlides && contentCount(structure, n) <= cap && contentCount(structure, n) >= 3);
    if (options.length === 0) return null;
    const byBucket = new Map<string, number[]>();
    for (const n of options) byBucket.set(slideBucket(n, 'carousel'), [...(byBucket.get(slideBucket(n, 'carousel')) ?? []), n]);
    const b = choose(db, {dimension: 'slides', values: [...byBucket.keys()], accountId: account.id, platform: account.platform, rand}).value;
    const inBucket = byBucket.get(b) ?? options;
    total = inBucket[Math.floor(rand() * inBucket.length)];
  }
  total = Math.min(total, maxSlides);
  const nContent = contentCount(structure, total);

  // 4. Content items (varied subsets; steps keep their order).
  let items = itemsFor(topic, structure).filter((i) => factOk(i.factIds));
  if (structure === 'etapes') items = items.slice(0, nContent);
  else items = shuffle(rand, items).slice(0, structure === 'definition' ? nContent : nContent);
  if (structure !== 'histoire' && items.length < (structure === 'definition' ? nContent : nContent)) return null;

  // 5. Hook: learned hook type among the templates available for the structure.
  const hookTemplates = [...(lib.hooks[structure] ?? []), ...(structure === 'faits' || structure === 'liste' ? lib.topicHooks[topic.id] ?? [] : [])].filter((h) => factOk(h.factIds));
  const n = structure === 'definition' ? items.length : structure === 'histoire' ? 4 : items.length;
  const vars = {...topic.vars, n, storyTitle: topic.story?.title ?? topic.label};
  const usedHooks = new Set(ctx.existing.filter((e) => e.account_id === account.id).map((e) => e.hook.toLowerCase()));
  const hookTypes = [...new Set(hookTemplates.map((h) => h.type))];
  if (hookTypes.length === 0) return null;
  const hookType = choose(db, {dimension: 'hook_type', values: hookTypes, accountId: account.id, platform: account.platform, rand}).value;
  const hookChoices = shuffle(rand, hookTemplates.filter((h) => h.type === hookType));
  const hookTpl = hookChoices.find((h) => !usedHooks.has(fillTemplate(h.t, vars).toLowerCase()));
  if (!hookTpl) return attempt < 6 ? composeOne(ctx, req, attempt + 1) : null;
  const hook = fillTemplate(hookTpl.t, vars);

  // 6. Visual template: requested, else the account's templates suited to the structure, learned.
  let template = req.template && TEMPLATE_IDS.includes(req.template) ? req.template : '';
  if (!template) {
    const own = account.brand.templates.filter((t) => TEMPLATE_IDS.includes(t));
    const pool = own.length ? own : TEMPLATE_IDS;
    const suited = pool.filter((t) => TEMPLATES.find((x) => x.id === t)!.bestFor.includes(structure));
    template = choose(db, {dimension: 'template', values: suited.length ? suited : pool, accountId: account.id, platform: account.platform, rand}).value;
  }

  // 7. Slides.
  const verifiedOn = verifiedOnLabel(facts, topic.facts) ?? '';
  const subtitle = fillTemplate((lib.subtitles[structure] ?? ['Fais défiler'])[Math.floor(rand() * (lib.subtitles[structure]?.length ?? 1))], {...vars, verifiedOn});
  const slides: Slide[] = [{kind: 'cover', title: hook, body: subtitle, factIds: hookTpl.factIds}];
  const labels = COMPARE_LABELS[structure];
  if (structure === 'histoire' && topic.story) {
    const st = topic.story;
    slides.push(
      {kind: 'content', label: 'Le contexte', title: st.setup},
      {kind: 'content', label: 'Le problème', title: st.problem},
      {kind: 'content', label: 'Le déclic', title: st.turn},
      {kind: 'quote', label: 'La leçon', title: st.lesson},
    );
  } else {
    if (structure === 'definition' && topic.definition) slides.push({kind: 'content', label: 'Définition', title: topic.definition.title, body: topic.definition.body});
    items.forEach((it, i) => {
      if (labels) slides.push({kind: 'compare', number: i + 1, leftLabel: labels[0], left: it.title, rightLabel: labels[1], right: it.fix ?? it.body ?? '', factIds: it.factIds});
      else
        slides.push({
          kind: 'item',
          number: i + 1,
          label: structure === 'etapes' ? `Étape ${i + 1}` : undefined,
          title: it.title,
          body: it.body ?? it.fix,
          factIds: it.factIds,
          note: structure === 'faits' && it.factIds?.length ? `Source : systeme.io, vérifié le ${verifiedOnLabel(facts, it.factIds)}` : undefined,
        });
    });
  }

  // 8. Call to action: an engagement line + one honest product mention backed by facts.
  const engagement = lib.ctas.engagement[Math.floor(rand() * lib.ctas.engagement.length)];
  const productOptions = [
    ...(topic.productLine && factOk(topic.productLine.factIds) ? [{title: 'Le bon outil', body: `${topic.productLine.text} Lien en bio.`, factIds: topic.productLine.factIds}] : []),
    ...lib.ctas.product.filter((p) => factOk(p.factIds)),
  ];
  const product = productOptions[Math.floor(rand() * productOptions.length)];
  slides.push({kind: 'cta', title: engagement.title, body: engagement.body, product: product ? {title: product.title, body: product.body} : undefined, factIds: product?.factIds});

  // 9. Near-duplicate guard for this account.
  const fp = shingles(coreText(slides), 4);
  const dup = ctx.existing.find((e) => e.account_id === account.id && jaccard(e.fp, fp) >= 0.6);
  if (dup) return attempt < 6 ? composeOne(ctx, req, attempt + 1) : null;

  const factIds = [...new Set(slides.flatMap((s) => s.factIds ?? []))];
  const isProductTopic = topic.id.startsWith('systeme-io');
  const hashtags = pickHashtags(cfg, topic.hashtagTopic, account.platform, isProductTopic);
  const productSentence = 'Tester Systeme.io (plan gratuit, sans carte bancaire) : lien en bio.';
  const allFacts = [...new Set([...factIds, 'plan.free.exists', 'plan.free.no-card'])];
  const caption = buildCaption(cfg, {platform: account.platform, hook, slides, engagement: `${engagement.title} ${engagement.body}`.replace(/\s+/g, ' ').trim(), productSentence, hashtags});
  const tone: Tone = req.tone ?? 'direct';
  const predicted = predictScore(ctx, {topic: topic.id, structure, hookType, template, slides: slides.length});
  ctx.existing.push({account_id: account.id, hook, fp, story: structure === 'histoire' ? topic.id : undefined});
  return {
    accountId: account.id,
    platform: account.platform,
    topic: topic.id,
    topicLabel: topic.label,
    structure,
    hookType,
    hook,
    title: hook,
    template,
    format,
    tone,
    style: template,
    language: 'fr',
    slides,
    caption,
    hashtags,
    cta: engagement.kind,
    factIds: allFacts,
    engine: 'composer',
    predicted,
    rationale: `Sujet ${topic.label}, structure ${structure}, accroche ${hookType}, modèle ${template}, ${slides.length} slides.`,
  };
}

/** Expected score (0-100) from the learning loop and the market patterns, before publication. */
export function predictScore(ctx: ComposeContext, d: {topic: string; structure: string; hookType: string; template: string; slides: number}): number {
  const dims: Array<[any, string]> = [
    ['topic', d.topic],
    ['structure', d.structure],
    ['hook_type', d.hookType],
    ['template', d.template],
    ['slides', slideBucket(d.slides, 'carousel')],
  ];
  const vals = dims.map(([dimension, value]) => preferences(ctx.db, {dimension, values: [value], accountId: ctx.account.id, platform: ctx.account.platform, rand: () => 0.5})[0].expected);
  return round(vals.reduce((a, b) => a + b, 0) / vals.length, 1);
}

export function composeBatch(db: Db, cfg: AppConfig, account: Account, req: GenerateRequest): SlideshowDraft[] {
  const rand = rng(req.seed ?? `${account.id}:${Date.now()}`);
  const existing = db
    .all("SELECT account_id, hook, slides_json FROM slideshows WHERE account_id = ? AND status NOT IN ('rejected', 'qc_failed')", account.id)
    .map((r) => ({account_id: r.account_id, hook: r.hook ?? '', fp: shingles(coreText(JSON.parse(r.slides_json)), 4)}));
  const ctx: ComposeContext = {db, cfg, account, rand, existing};
  const out: SlideshowDraft[] = [];
  let misses = 0;
  while (out.length < req.quantity && misses < Math.max(20, req.quantity)) {
    const d = composeOne(ctx, req);
    if (d) out.push(d);
    else misses++;
  }
  return out;
}

export function ideasFromDrafts(drafts: SlideshowDraft[]): IdeaDraft[] {
  return drafts.map((d) => ({
    accountId: d.accountId,
    topic: d.topic,
    angle: `${d.topicLabel} — ${d.structure}`,
    hook: d.hook,
    hookType: d.hookType,
    structure: d.structure,
    template: d.template,
    format: d.format,
    slides: d.slides.length,
    tone: d.tone,
    language: d.language,
    predicted: d.predicted ?? 50,
    rationale: d.rationale ?? '',
    engine: d.engine,
  }));
}
