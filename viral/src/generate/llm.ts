import {z} from 'zod';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {platformSpec} from '../core/config.js';
import type {Account} from '../core/accounts.js';
import {loadFacts, usableFacts} from '../core/facts.js';
import {loadPatterns, insightsText} from '../intel/patterns.js';
import {detectTopic} from '../intel/features.js';
import {TEMPLATES, TEMPLATE_IDS} from '../render/templates.js';
import {choose} from '../analytics/learn.js';
import {rng} from '../core/util.js';
import {buildCaption, pickHashtags} from './captions.js';
import {STRUCTURES, type GenerateRequest, type SlideshowDraft, type Slide} from './types.js';
import type {AiRouter} from '../ai/router.js';

/**
 * AI engine: one prompt per batch of up to 5 slideshows, built from the account, the niche, the patterns the
 * detector found in the market, the verified facts and the legal rules. Also produces "briefs" that a Claude
 * session can answer offline (viral brief → réponse JSON → viral ingest).
 */

const SlideZ = z.object({
  kind: z.enum(['cover', 'content', 'item', 'compare', 'quote', 'cta']),
  label: z.string().max(40).optional(),
  title: z.string().max(140).optional(),
  body: z.string().max(260).optional(),
  number: z.number().int().optional(),
  leftLabel: z.string().max(30).optional(),
  left: z.string().max(180).optional(),
  rightLabel: z.string().max(30).optional(),
  right: z.string().max(180).optional(),
  note: z.string().max(120).optional(),
  product: z.object({title: z.string().max(60), body: z.string().max(220)}).optional(),
  factIds: z.array(z.string()).optional(),
});

export const AiSlideshowZ = z.object({
  topic: z.string(),
  structure: z.enum(STRUCTURES),
  hookType: z.string(),
  hook: z.string().min(8).max(140),
  slides: z.array(SlideZ).min(3).max(20),
  factIds: z.array(z.string()).default([]),
  engagement: z.string().max(200).optional(),
  rationale: z.string().max(400).optional(),
});
export type AiSlideshow = z.infer<typeof AiSlideshowZ>;

export const AiAnswerZ = z.object({slideshows: z.array(AiSlideshowZ).min(1)});

export const SYSTEM_PROMPT = `Tu écris des carrousels (slideshows) pour les réseaux sociaux, en français, tutoiement, pour faire découvrir Systeme.io à des débutants qui veulent vendre en ligne.

Règles impératives (juridiques et de qualité) :
- Contenu 100 % original : ne reprends jamais le texte d'un concurrent. Inspire-toi des mécanismes (type d'accroche, structure, rythme), jamais des mots.
- Aucune promesse de revenus, de résultat garanti ou d'argent facile ; aucun « devenir riche », « revenus passifs », « quitter ton job » ; aucune image ou évocation de richesse.
- Aucun chiffre, prix, pourcentage, statistique, témoignage ou résultat inventé. Une affirmation sur Systeme.io (prix, limites, fonctions) n'est permise que si elle s'appuie sur un fait de la liste fournie : cite son identifiant dans factIds de la slide.
- Pas de superlatif invérifiable (« le meilleur », « n°1 »), pas de fausse urgence, pas de nom de marque concurrente.
- Un exemple de personne doit être annoncé comme « Exemple fictif ».
- Une idée par slide, phrases courtes, lisibles sur téléphone : titre ≤ 12 mots, texte ≤ 30 mots.
- Structure : première slide « cover » (accroche + sous-titre), dernière slide « cta » (une action : enregistrer, commenter, partager ou s'abonner, et une mention honnête de Systeme.io avec « lien en bio » dans product).
- Si l'accroche annonce un nombre (« 5 erreurs »), il y a exactement ce nombre de slides d'éléments.
- Réponds uniquement par un objet JSON valide, sans texte autour.`;

export function buildPrompt(db: Db, cfg: AppConfig, account: Account, req: GenerateRequest, count: number): string {
  const facts = usableFacts(loadFacts()).map((f) => ({id: f.id, fait: f.statement}));
  const patterns = loadPatterns(db, 'market', 'all');
  const insights = insightsText(patterns, 8);
  const own = loadPatterns(db, 'own', 'all');
  const spec = platformSpec(cfg, account.platform);
  const slides = req.slides ?? 7;
  const context = {
    compte: {plateforme: spec.label, pseudo: account.brand.handle, langue: req.language ?? account.language},
    niche: cfg.niche.label,
    public: cfg.niche.audience,
    sujet: req.topic ?? 'au choix parmi les sujets de la niche',
    sujetsDeLaNiche: cfg.niche.topics.map((t) => t.id),
    nombreDeSlides: slides,
    structure: req.structure ?? 'au choix : ' + STRUCTURES.join(', '),
    ton: req.tone ?? 'direct',
    style: req.template ?? 'au choix',
    quantite: count,
    ceQuiMarcheChezLesConcurrents: insights,
    ceQuiMarcheChezNous: insightsText(own, 5),
    faitsVerifies: facts,
    limites: {slidesMax: spec.maxSlides, legendeMax: spec.captionMax},
  };
  return `Écris ${count} carrousel(s) différents. Contexte :\n${JSON.stringify(context, null, 1)}\n\nFormat de réponse :\n${JSON.stringify(
    {
      slideshows: [
        {
          topic: 'tunnel-de-vente',
          structure: 'erreurs',
          hookType: 'erreur',
          hook: '…',
          slides: [
            {kind: 'cover', title: '…', body: '…'},
            {kind: 'compare', leftLabel: 'Erreur', left: '…', rightLabel: 'À faire', right: '…'},
            {kind: 'item', number: 1, title: '…', body: '…', factIds: ['plan.free.contacts']},
            {kind: 'cta', title: '…', body: '…', product: {title: '…', body: '… Lien en bio.'}, factIds: ['plan.free.exists']},
          ],
          factIds: ['…'],
          engagement: '…',
          rationale: 'pourquoi cette accroche et cette structure (1 phrase)',
        },
      ],
    },
    null,
    1,
  )}`;
}

/** Turns a validated AI answer into drafts (template, caption, hashtags chosen here, not by the model). */
export function draftsFromAi(db: Db, cfg: AppConfig, account: Account, req: GenerateRequest, answer: unknown, engine: string, model?: string): {drafts: SlideshowDraft[]; rejected: string[]} {
  const parsed = AiAnswerZ.safeParse(answer);
  if (!parsed.success) return {drafts: [], rejected: [`réponse invalide : ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ')}`]};
  const spec = platformSpec(cfg, account.platform);
  const known = new Set(loadFacts().facts.map((f) => f.id));
  const rand = rng(req.seed ?? `${account.id}:${Date.now()}`);
  const drafts: SlideshowDraft[] = [];
  const rejected: string[] = [];
  for (const s of parsed.data.slideshows) {
    let slides = s.slides as Slide[];
    if (slides[0]?.kind !== 'cover') slides = [{kind: 'cover', title: s.hook}, ...slides];
    if (slides.at(-1)?.kind !== 'cta') {
      rejected.push(`« ${s.hook} » : pas de slide d'appel à l'action`);
      continue;
    }
    if (slides.length > spec.maxSlides) {
      rejected.push(`« ${s.hook} » : ${slides.length} slides, plus que les ${spec.maxSlides} permises sur ${spec.label}`);
      continue;
    }
    const unknownFacts = [...new Set([...(s.factIds ?? []), ...slides.flatMap((x) => x.factIds ?? [])])].filter((f) => !known.has(f));
    if (unknownFacts.length) {
      rejected.push(`« ${s.hook} » : faits inconnus ${unknownFacts.join(', ')}`);
      continue;
    }
    const topic = cfg.niche.topics.find((t) => t.id === s.topic)?.id ?? detectTopic(slides.map((x) => `${x.title ?? ''} ${x.body ?? ''}`).join(' '), cfg.niche) ?? 'debuter';
    const own = account.brand.templates.filter((t) => TEMPLATE_IDS.includes(t));
    const suited = (own.length ? own : TEMPLATE_IDS).filter((t) => TEMPLATES.find((x) => x.id === t)!.bestFor.includes(s.structure));
    const template = req.template && TEMPLATE_IDS.includes(req.template) ? req.template : choose(db, {dimension: 'template', values: suited.length ? suited : own.length ? own : TEMPLATE_IDS, accountId: account.id, platform: account.platform, rand}).value;
    const product = /systeme/i.test(s.hook) || s.topic.startsWith('systeme');
    const hashtags = pickHashtags(cfg, cfg.niche.hashtags.byTopic[topic] ? topic : 'debuter', account.platform, product);
    const engagement = s.engagement ?? `${slides.at(-1)?.title ?? ''} ${slides.at(-1)?.body ?? ''}`.trim();
    const caption = buildCaption(cfg, {platform: account.platform, hook: s.hook, slides, engagement, productSentence: 'Tester Systeme.io (plan gratuit, sans carte bancaire) : lien en bio.', hashtags});
    const factIds = [...new Set([...(s.factIds ?? []), ...slides.flatMap((x) => x.factIds ?? []), 'plan.free.exists', 'plan.free.no-card'])];
    drafts.push({
      accountId: account.id,
      platform: account.platform,
      topic,
      topicLabel: cfg.niche.topics.find((t) => t.id === topic)?.label ?? topic,
      structure: s.structure,
      hookType: s.hookType,
      hook: s.hook,
      title: s.hook,
      template,
      format: req.format && spec.formats.includes(req.format) ? req.format : account.brand.defaultFormat,
      tone: req.tone ?? 'direct',
      style: template,
      language: req.language ?? account.language,
      slides,
      caption,
      hashtags,
      cta: 'ia',
      factIds,
      engine,
      model,
      rationale: s.rationale,
    });
  }
  return {drafts, rejected};
}

export async function aiBatch(db: Db, cfg: AppConfig, router: AiRouter, account: Account, req: GenerateRequest): Promise<{drafts: SlideshowDraft[]; rejected: string[]; models: string[]; cost: number}> {
  const drafts: SlideshowDraft[] = [];
  const rejected: string[] = [];
  const models: string[] = [];
  let cost = 0;
  let remaining = req.quantity;
  while (remaining > 0) {
    const count = Math.min(5, remaining);
    const res = await router.complete({role: 'writing', purpose: `slideshows ${account.id} ×${count}`, system: SYSTEM_PROMPT, prompt: buildPrompt(db, cfg, account, req, count), json: true, maxTokens: 6000});
    const got = draftsFromAi(db, cfg, account, req, res.json, `ai:${res.provider}`, res.model);
    drafts.push(...got.drafts);
    rejected.push(...got.rejected);
    models.push(res.modelId);
    cost += res.costUsd;
    remaining -= count;
  }
  return {drafts, rejected, models, cost};
}
