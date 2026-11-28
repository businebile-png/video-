import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import type {Account} from '../core/accounts.js';
import {wordCount} from '../core/text.js';
import {rng} from '../core/util.js';
import {composeBatch} from '../generate/composer.js';
import {aiBatch} from '../generate/llm.js';
import {AiRouter, NoModelAvailable, OfflineFallback} from '../ai/router.js';
import type {GenStructure, Slide, SlideshowDraft} from '../generate/types.js';
import {VIDEO_FORMATS, formatDef, wordBudget, type VideoFormatDef} from './formats.js';
import type {DurationTarget, SceneRole, VideoFormatId, VideoScene, VideoScript, VisualMode} from './types.js';

/**
 * Video scripts written for retention: hook spoken in the first 3 seconds, the subject announced, points that
 * build up (the most useful last, an explicit « mais attention » turn when the content has one), a short
 * conclusion and one honest call to action. The content itself comes from the verified library or from an AI
 * whose facts were validated (same rules as the carousels): nothing is invented to make a video longer —
 * when the verified content is too short for the requested duration, the video gets shorter and says why.
 */

const NUM_WORDS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix'];

/** Text as the voice should read it (symbols spelled out, markup removed); captions show the same words. */
export function speakable(text: string): string {
  return text
    .replace(/\*\*|__|[«»"“”]/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s*→\s*/g, ', ')
    .replace(/(\d)\s?€/g, '$1 euros')
    .replace(/€\s?(\d+)/g, '$1 euros')
    .replace(/(\d)\s?%/g, '$1 pour cent')
    .replace(/\/\s?mois\b/g, ' par mois')
    .replace(/\s&\s/g, ' et ')
    .replace(/\s+([.,!?;:])/g, (m, p) => (p === '?' || p === '!' || p === ':' || p === ';' ? ` ${p}` : p))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const endSentence = (s: string) => {
  const t = s.trim();
  return !t ? '' : /[.!?…:]$/.test(t) ? t : `${t}.`;
};

/** Spoken hook: the first clause when the written hook is too long to be said in about 3 seconds. */
export function spokenHook(hook: string): {hook: string; rest: string} {
  const h = speakable(hook);
  if (wordCount(h) <= 10) return {hook: endSentence(h), rest: ''};
  const m = h.match(/^(.{12,}?[?:!.,])\s+(.+)$/);
  if (m && wordCount(m[1]) >= 4 && wordCount(m[1]) <= 11) return {hook: endSentence(m[1].replace(/,$/, '')), rest: endSentence(m[2])};
  return {hook: endSentence(h), rest: ''};
}

const TOPIC_BROLL: Array<[RegExp, string[]]> = [
  [/mail|newsletter/, ['email laptop', 'inbox screen', 'typing laptop']],
  [/tunnel|vente|page/, ['online shopping laptop', 'website laptop desk', 'checkout phone']],
  [/formation|cours/, ['online course laptop', 'studying notebook', 'video lesson laptop']],
  [/produit|numerique|ebook/, ['tablet reading', 'digital design laptop', 'notebook desk']],
  [/affili/, ['smartphone desk', 'laptop coffee', 'sharing phone']],
  [/blog|contenu/, ['writing notebook', 'blog laptop', 'coffee writing']],
  [/site/, ['web design laptop', 'website screen', 'desk computer']],
  [/automat|workflow/, ['workflow screen', 'gears technology', 'laptop night']],
  [/webinaire|video/, ['video call laptop', 'camera setup', 'microphone desk']],
  [/communaut|membre/, ['chat smartphone', 'community network', 'phone messages']],
];

function brollFor(topic: string, def: VideoFormatDef, i: number, rand: () => number): string {
  const t = topic.toLowerCase();
  const own = TOPIC_BROLL.find(([re]) => re.test(t))?.[1] ?? [];
  // Shots about the subject first; the format's mood shots every third scene, for variety.
  if (own.length && (i % 3 !== 2 || !def.broll.length)) return own[(i + Math.floor(rand() * own.length)) % own.length];
  const pool = def.broll.length ? def.broll : ['laptop desk', 'notebook desk'];
  return pool[(i + Math.floor(rand() * pool.length)) % pool.length];
}

/** How many points fit the duration, at about 17 spoken words per point. */
export function pointsFor(def: VideoFormatDef, duration: number): number {
  if (def.items) return def.items;
  const budget = wordBudget(duration, def.pace);
  return Math.max(2, Math.min(8, Math.round((budget - 26) / 17)));
}

export interface ScriptOptions {
  format: VideoFormatId;
  duration: DurationTarget;
  cta: string;
  linkHint: string;
  seed: string;
  visuals?: VisualMode;
}

/** Carousel wording does not belong in a video (« ce carrousel », « slide par slide », « fais défiler »). */
export function videoWording(text: string): string {
  return text
    .replace(/\b(enregistre|partage|garde|envoie)(-le| le| ce)? carrousel\b/gi, (m, v) => `${v} cette vidéo`)
    .replace(/\bce carrousel\b/gi, 'cette vidéo')
    .replace(/\ble carrousel\b/gi, 'la vidéo')
    .replace(/\bcarrousels?\b/gi, 'vidéo')
    .replace(/\bslide par slide\b/gi, 'point par point')
    .replace(/\b(la )?dernière slide\b/gi, 'la fin de la vidéo')
    .replace(/\bslides?\b/gi, 'points')
    .replace(/\bfais défiler\b/gi, 'regarde jusqu’au bout')
    .replace(/\bswipe\b/gi, 'regarde');
}

/** Link mentions inside a product line: the end card says where the link is, per network (bio, chaîne). */
export function withoutLinkMention(text: string): string {
  return text
    .replace(/\s*[:.,-]?\s*(le )?lien (est )?(dans ma|en|sur ma) (bio|chaîne)\b\.?/gi, '.')
    .replace(/\.\.+/g, '.')
    .replace(/\s*:\s*\.$/, '.')
    .trim();
}

function videoDraft(d: SlideshowDraft): SlideshowDraft {
  const w = (x?: string) => (x === undefined ? x : videoWording(x));
  return {
    ...d,
    hook: videoWording(d.hook),
    title: videoWording(d.title),
    caption: videoWording(d.caption),
    slides: d.slides.map((s) => ({...s, label: w(s.label), title: w(s.title), body: w(s.body), note: w(s.note), left: w(s.left), right: w(s.right), product: s.product ? {title: videoWording(s.product.title), body: videoWording(s.product.body)} : undefined})),
  };
}

/** Turns carousel-shaped content (cover, items, compare, story, call to action) into a narrated video script. */
export function scriptFromDraft(d0: SlideshowDraft, opts: ScriptOptions): VideoScript {
  const d = videoDraft(d0);
  const def = formatDef(opts.format);
  const rand = rng(opts.seed);
  const budget = wordBudget(opts.duration, def.pace);
  const notes: string[] = [];
  const visualMode: VisualMode = opts.visuals ?? def.visuals;
  const scenes: VideoScene[] = [];
  const voice = def.voice === 'voix';
  const vis = (i: number, product = false): VideoScene['visual'] => ({
    mode: product && visualMode !== 'motion' ? 'motion' : visualMode,
    query: visualMode === 'motion' ? undefined : brollFor(d.topic, def, i, rand),
    prompt: visualMode === 'ai' ? `Cinematic vertical shot, ${brollFor(d.topic, def, i, rand)}, soft light, shallow depth of field, no people, no text, no logos` : undefined,
  });
  const push = (role: SceneRole, layout: VideoScene['layout'], narration: string, text: VideoScene['text'], factIds: string[] = [], emphasis: string[] = [], product = false) =>
    scenes.push({role, layout, narration: voice ? speakable(narration) : '', text, emphasis, visual: vis(scenes.length, product), factIds});

  const cover = d.slides[0];
  const hook = spokenHook(d.hook);
  push('hook', 'title', hook.hook, {label: d.topicLabel, title: d.hook}, cover?.factIds ?? [], emphasisOf(d.hook));

  const body = d.slides.slice(1, -1);
  const items = body.filter((s) => s.kind === 'item' || s.kind === 'compare');
  const countdown = def.id === 'top5' || def.id === 'top10';
  const n = items.length;
  if (opts.duration >= 30 && d.structure !== 'histoire') {
    // The carousel subtitle often talks about slides: a video says how many points instead.
    const carousel = /slide|défil|swipe|glisse|carrousel|feuillette/i;
    const kind = d.structure === 'etapes' ? 'étapes' : d.structure === 'erreurs' ? 'erreurs à éviter' : 'points';
    const intro = hook.rest || (cover?.body && !carousel.test(cover.body) ? endSentence(cover.body) : n >= 2 ? `En ${NUM_WORDS[n] ?? n} ${kind}.` : '');
    if (intro) push('intro', 'statement', intro, {title: intro}, [], []);
  }
  body.forEach((s, k) => {
    const last = s === items[items.length - 1];
    const idx = items.indexOf(s);
    const num = countdown ? n - idx : s.number;
    if (s.kind === 'compare') {
      const turn = idx === n - 1 && n >= 3 ? 'Et le plus important. ' : '';
      push(
        'compare',
        'compare',
        `${turn}${endSentence(`${s.leftLabel ?? 'Avant'} : ${s.left ?? ''}`)} ${endSentence(`${s.rightLabel ?? 'Après'} : ${s.right ?? ''}`)}`,
        {number: num, leftLabel: s.leftLabel, left: s.left, rightLabel: s.rightLabel, right: s.right, note: s.note},
        s.factIds ?? [],
        emphasisOf(s.right ?? ''),
      );
    } else if (s.kind === 'item') {
      const lead = countdown ? `Numéro ${NUM_WORDS[num ?? 0] ?? num}. ` : last && n >= 3 ? 'Et le plus important. ' : '';
      const twist = s.label && /erreur/i.test(s.label) ? 'Mais attention. ' : '';
      push('point', 'number', `${lead}${twist}${endSentence(s.title ?? '')} ${endSentence(s.body ?? '')}`, {number: num, label: s.label, title: s.title, body: s.body, note: s.note}, s.factIds ?? [], emphasisOf(s.title ?? ''));
    } else if (s.kind === 'quote') {
      push('story', 'quote', `${s.label ? `${s.label} : ` : ''}${endSentence(s.title ?? '')}`, {label: s.label, title: s.title}, s.factIds ?? [], emphasisOf(s.title ?? ''));
    } else {
      const story = d.structure === 'histoire';
      push(story ? 'story' : 'point', story && def.character ? 'character' : 'statement', `${endSentence(s.title ?? '')} ${endSentence(s.body ?? '')}`, {label: s.label, title: s.title, body: s.body, note: story ? 'Personnage fictif' : s.note}, s.factIds ?? [], emphasisOf(s.title ?? ''));
    }
    void k;
  });

  const cta = d.slides[d.slides.length - 1];
  if (cta?.product) {
    const productText = withoutLinkMention(cta.product.body).replace(/\s*:\s*$/, '').trim();
    const brand = /^systeme\.?io$/i.test(cta.product.title.trim());
    const lead = brand ? '' : cta.product.title.replace(/[.:!]+$/, '').trim();
    const spoken = lead ? `${lead}, ${productText.charAt(0).toLowerCase() === 's' && /^systeme/i.test(productText) ? productText : productText}` : productText;
    push('product', 'product', endSentence(spoken), {label: lead || undefined, product: {title: 'Systeme.io', body: endSentence(productText)}, note: 'Lien affilié'}, cta.factIds ?? [], ['Systeme.io'], true);
  }
  const engagement = [cta?.title, cta?.body].filter(Boolean).map((x) => endSentence(x!)).join(' ');
  push('cta', 'cta', `${endSentence(opts.cta)} ${engagement}`.trim(), {title: opts.cta, body: cta?.title ?? '', label: 'Publicité'}, [], [opts.linkHint], true);

  // Keep inside the word budget without inventing anything: shorten bodies, then drop middle points.
  const words = () => scenes.reduce((a, s) => a + wordCount(s.narration || [s.text.title, s.text.body, s.text.left, s.text.right].filter(Boolean).join(' ')), 0);
  if (voice) {
    let guard = 0;
    while (words() > budget * 1.18 && guard++ < 30) {
      const longBody = scenes.filter((s) => s.role === 'point' && s.text.body && wordCount(s.narration) > 14).sort((a, b) => wordCount(b.narration) - wordCount(a.narration))[0];
      if (longBody) {
        const firstSentence = (longBody.text.body ?? '').split(/(?<=[.!?])\s+/)[0];
        if (firstSentence !== longBody.text.body) {
          longBody.text.body = firstSentence;
          longBody.narration = speakable(longBody.narration.replace(/[^.!?]*[.!?]\s*$/, '').trim() || longBody.narration);
          continue;
        }
        longBody.narration = speakable(longBody.narration.split(/(?<=[.!?])\s+/).slice(0, -1).join(' ') || longBody.narration);
        longBody.text.body = undefined;
        continue;
      }
      const middle = scenes.filter((s) => s.role === 'point' || s.role === 'compare');
      if (middle.length <= 2 || def.items) break;
      scenes.splice(scenes.indexOf(middle[Math.floor(middle.length / 2) - 1] ?? middle[0]), 1);
      notes.push('Un point retiré pour tenir la durée.');
    }
    if (words() < budget * 0.6) notes.push(`Contenu vérifié plus court que ${opts.duration} s : la vidéo sera plus courte (rien n’est inventé pour l’allonger).`);
  }
  const factIds = [...new Set(scenes.flatMap((s) => s.factIds))];
  return {
    format: opts.format,
    duration: opts.duration,
    language: d.language,
    title: d.title,
    hook: d.hook,
    hookType: d.hookType,
    topic: d.topic,
    topicLabel: d.topicLabel,
    structure: d.structure,
    scenes,
    caption: d.caption,
    hashtags: d.hashtags,
    cta: opts.cta,
    factIds,
    engine: d.engine,
    model: d.model,
    words: {target: budget, actual: words()},
    notes,
  };
}

function emphasisOf(text: string): string[] {
  const w = text
    .replace(/[^\p{L}\p{N}' -]/gu, ' ')
    .split(/\s+/)
    .filter((x) => x.length >= 5 && !/^(c'est|avec|pour|dans|cette|leurs|votre|notre|quand|comme|toute|tous|faire|parce)$/i.test(x));
  return w.sort((a, b) => b.length - a.length).slice(0, 2);
}

/** Structures that suit a format and have enough verified content for the number of points. */
export function structuresFor(def: VideoFormatDef): GenStructure[] {
  return def.structures;
}

export interface DraftRequest {
  account: Account;
  format: VideoFormatId;
  duration: DurationTarget;
  quantity: number;
  seed: string;
  topic?: string;
  engine?: 'auto' | 'ai' | 'composer';
}

/**
 * Content for video scripts: the AI writer when one answers (facts validated against the verified registry),
 * otherwise the offline library. Same no-repeat rules per account as the carousels.
 */
export async function draftsForVideos(db: Db, cfg: AppConfig, r: DraftRequest, router?: AiRouter): Promise<{drafts: SlideshowDraft[]; engine: string; notes: string[]}> {
  const def = formatDef(r.format);
  const points = pointsFor(def, r.duration);
  const notes: string[] = [];
  const base = {accountId: r.account.id, quantity: r.quantity, seed: r.seed, topic: r.topic, format: '9:16' as const, template: def.template};
  const tryStructures = def.structures;
  if (r.engine !== 'composer') {
    try {
      const res = await aiBatch(db, cfg, router ?? new AiRouter(db, cfg), r.account, {...base, slides: points + 2, structure: tryStructures[0]});
      if (res.drafts.length) return {drafts: res.drafts.slice(0, r.quantity), engine: 'ai', notes: res.rejected.map((x) => `IA : ${x}`)};
    } catch (e) {
      if (!(e instanceof OfflineFallback || e instanceof NoModelAvailable) && r.engine === 'ai') throw e;
      if (r.engine === 'ai') throw new Error(`Aucune IA disponible : ${(e as Error).message}`);
      notes.push('Aucune IA joignable : bibliothèque vérifiée hors ligne.');
    }
  }
  const drafts: SlideshowDraft[] = [];
  for (const structure of tryStructures) {
    if (drafts.length >= r.quantity) break;
    for (const slides of [points + 2, points + 1, points, points + 3]) {
      if (drafts.length >= r.quantity) break;
      try {
        const got = composeBatch(db, cfg, r.account, {...base, quantity: r.quantity - drafts.length, structure, slides: structure === 'histoire' ? 6 : Math.min(10, slides), seed: `${r.seed}:${structure}:${slides}`});
        drafts.push(...got);
      } catch {
        // structure / slide count without verified content for this account: try the next one
      }
    }
  }
  return {drafts: drafts.slice(0, r.quantity), engine: 'composer', notes};
}

export function formatList() {
  return Object.values(VIDEO_FORMATS).map((f) => ({id: f.id, label: f.label, description: f.description, voice: f.voice, visuals: f.visuals, music: f.music, durations: f.durations, template: f.template, transitions: f.transitions}));
}
