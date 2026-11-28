import {emojiCount, firstSentence, hashtags, normalize, wordCount} from '../core/text.js';
import type {Niche} from '../core/config.js';

/**
 * Rule-based reading of a post: hook type, structure, call to action, emotions, topic.
 * Works offline on FR / EN / ES captions; an AI model can refine it later (role "research").
 */

export const HOOK_TYPES = [
  'liste',
  'question',
  'tutoriel',
  'erreur',
  'curiosite',
  'contre-pied',
  'avant-apres',
  'histoire',
  'comparaison',
  'chiffre',
  'pov',
  'definition',
  'affirmation',
] as const;
export type HookType = (typeof HOOK_TYPES)[number];

export const HOOK_LABELS: Record<HookType, string> = {
  liste: 'Liste / classement (« 5 erreurs… »)',
  question: 'Question directe',
  tutoriel: 'Tutoriel / « comment… »',
  erreur: 'Erreur / avertissement',
  curiosite: 'Curiosité (« ce que personne… »)',
  'contre-pied': 'Contre-pied / idée reçue',
  'avant-apres': 'Avant / après',
  histoire: 'Histoire / expérience',
  comparaison: 'Comparaison (A vs B)',
  chiffre: 'Chiffre ou fait marquant',
  pov: 'POV / mise en situation',
  definition: 'Définition (« c’est quoi… »)',
  affirmation: 'Affirmation simple',
};

type Rule = {type: HookType; re: RegExp};

// Order matters: the first match wins (most specific first). Patterns run on normalize()d text.
const HOOK_RULES: Rule[] = [
  {type: 'pov', re: /^(pov|point de vue)\b/},
  {type: 'tutoriel', re: /^(comment|how to|tuto|tutoriel)\b/},
  {type: 'avant-apres', re: /\bavant\b.*\bapres\b|\bbefore\b.*\bafter\b|\bantes\b.*\bdespues\b|\bplot twist\b/},
  {type: 'comparaison', re: /\b(vs|versus|ou bien)\b|^[a-z0-9 ]{2,40} ou [a-z0-9 ]{2,40}( \?)?$|\bwhich is better\b|\bcomparatif\b|\branking\b|\bmy ranking\b/},
  {type: 'liste', re: /^(\d+|top \d+|tips? #?\d+)\b|\b\d+ (erreurs?|astuces?|outils?|etapes?|facons?|choses?|raisons?|conseils?|idees?|secrets?|methodes?|tips|ways|things|mistakes|tools|steps|reasons|platforms?|plateformes?)\b/},
  {type: 'definition', re: /^(c est quoi|qu est ce qu|qu est ce que|what is|que es)\b|\bc est quoi\b|\bqu est ce qu un\b/},
  {type: 'erreur', re: /\b(erreurs?|arrete[sz]? de|ne fais (pas|jamais)|evite[sz]?|stop|piege|mistakes?|don t|avoid|never|negliger|negligent)\b/},
  {type: 'contre-pied', re: /\b(mythe|idee recue|faux|oublie|contrairement|unpopular opinion|on t a menti|personne ne te dit|isn t sponsored|pas sponsorise)\b/},
  {type: 'curiosite', re: /\b(personne ne|ce que|le secret|la verite|cache|decouvre|tu ne sais pas|you didn t know|nobody|the truth|what they don t|voici reellement|le detail)\b/},
  {type: 'tutoriel', re: /^(comment|how to|tuto|tutoriel|guide|como)\b|\b(etape par etape|pas a pas|step by step|je t explique|je te montre|watch me|tutorial|tutoriel)\b/},
  {type: 'histoire', re: /^(il y a|quand j|j ai|je suis|mon histoire|a \d+ ans|i ve|i had|when i|one thing about me|il avait)\b|\bje me suis lance/},
  {type: 'chiffre', re: /\b\d[\d\s.,]*\s?(%|€|\$|k\b|vues|ventes|clients|abonnes|contacts|minutes)\b/},
  {type: 'question', re: /\?/},
];

export function classifyHook(hook: string): HookType {
  // normalize() drops punctuation: keep the question mark as a token so the rules can see it.
  const n = normalize(hook) + (/[?¿]/.test(hook) ? ' ?' : '');
  for (const r of HOOK_RULES) if (r.re.test(n)) return r.type;
  return 'affirmation';
}

/** Removes what precedes the real hook: ad disclosure, "Replying to @x", "Réponse à @x". */
export function stripPreamble(text: string): string {
  return text
    .replace(/^\s*(publicit[ée]|sponsoris[ée]|#ad|#pub|ad|annonce)\s*([·:|\-–—]\s*(lien affili[ée]\s*:?[^.!?\n]*[.!?]?|systeme\.io)?)?\s*/i, '')
    .replace(/^\s*(replying to|r[ée]ponse [àa])\s+@[\w.\-]+\s*/i, '')
    .replace(/^((?:[^.!?\n]|\.(?=io\b))*(le prix reste|je touche une commission|lien affili[ée])(?:[^.!?\n]|\.(?=io\b))*[.!?]\s*)+/i, '')
    .trim();
}

export const CTA_TYPES = ['commentaire', 'enregistrer', 'partager', 'abonnement', 'lien', 'message', 'aucun'] as const;
export type CtaType = (typeof CTA_TYPES)[number];

const CTA_RULES: Array<{type: CtaType; re: RegExp}> = [
  {type: 'commentaire', re: /\b(commente[sz]?|comment(e|ez)? ["“«]?\w+|dis moi|dis nous|ecris en commentaire|comment below|comenta|reponds)\b|\bcomment ["“«]/},
  {type: 'lien', re: /\b(lien (en|dans (la|ma)) bio|link (in|en) (my )?bio|lien dans ma bio|clique sur le lien|link is in my bio)\b|\blien\b.{0,24}\bbio\b|\blink\b.{0,16}\bbio\b/},
  {type: 'enregistrer', re: /\b(enregistre[sz]?|sauvegarde[sz]?|save this|garde ce|epingle)\b/},
  {type: 'partager', re: /\b(partage[sz]?|envoie (le|la|ca|ce)|tag(ue)? (un|une|quelqu)|share this|send this)\b/},
  {type: 'abonnement', re: /\b(abonne toi|abonnez vous|suis moi|follow (me|for)|sigueme)\b/},
  {type: 'message', re: /\b(ecris moi|envoie moi un message|dm me|en dm|whatsapp|mp moi)\b/},
];

export function classifyCta(text: string): CtaType {
  const n = normalize(text);
  for (const r of CTA_RULES) if (r.re.test(n)) return r.type;
  return 'aucun';
}

export const EMOTIONS: Record<string, RegExp> = {
  curiosite: /\b(secret|personne|verite|cache|decouvre|surprenant|incroyable|plot twist|didn t know|nobody|truth)\b/,
  peur_perte: /\b(erreur|perdre|perds|danger|piege|arnaque|rate|echec|jamais|galere[rsz]?|bloque|mistake|lose|scam)\b/,
  aspiration: /\b(reussir|objectif|liberte|reve|lancer|enfin|grandir|evoluer|grow|dream|success)\b/,
  urgence: /\b(maintenant|aujourd hui|vite|tout de suite|des maintenant|now|today|black friday|vendredi fou)\b/,
  humour: /😂|🤣|😅|\b(humour|mdr|lol|satirique|drole)\b/,
  simplicite: /\b(simple|facile|rapide|en \d+ minutes|sans (code|technique)|beginner|easy|no code|no tech)\b/,
  preuve: /\b(\d+ (vues|ventes|clients|eleves)|resultats?|temoignage|avis|proof|results?)\b/,
};

export function emotions(text: string): string[] {
  const n = normalize(text) + ' ' + text;
  return Object.entries(EMOTIONS)
    .filter(([, re]) => re.test(n))
    .map(([k]) => k);
}

export const STRUCTURES = ['liste', 'etapes', 'histoire', 'comparaison', 'question-reponse', 'mythe-realite', 'avant-apres', 'demonstration', 'simple'] as const;
export type Structure = (typeof STRUCTURES)[number];

export function detectStructure(text: string, hookType: HookType, mediaType: string | null, slideCount: number | null): Structure {
  const n = normalize(text);
  if (/\b(1|un)\b.*\b(2|deux)\b.*\b(3|trois)\b|📌 1\.|\b1\.\s|\b1\)\s/.test(text) || hookType === 'liste') return 'liste';
  if (/\b(etape|step|etapes|steps)\b/.test(n) || hookType === 'tutoriel') return /\b(regarde|watch|live|en temps reel|in real time)\b/.test(n) ? 'demonstration' : 'etapes';
  if (hookType === 'avant-apres') return 'avant-apres';
  if (hookType === 'comparaison') return 'comparaison';
  if (hookType === 'contre-pied') return 'mythe-realite';
  if (hookType === 'histoire') return 'histoire';
  if (hookType === 'question' || hookType === 'definition') return 'question-reponse';
  if (mediaType === 'carousel' && (slideCount ?? 0) >= 4) return 'liste';
  return 'simple';
}

export function detectTopic(text: string, niche: Niche): string | null {
  const n = normalize(text);
  let best: {id: string; hits: number} | null = null;
  for (const t of niche.topics) {
    const hits = t.keywords.reduce((s, k) => s + (n.includes(normalize(k)) ? 1 : 0), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = {id: t.id, hits};
  }
  return best?.id ?? null;
}

export interface PostFeatures {
  hook: string;
  hookType: HookType;
  hookWords: number;
  ctaType: CtaType;
  emotions: string[];
  structure: Structure;
  topic: string | null;
  hashtags: string[];
  hashtagCount: number;
  emojiCount: number;
  captionWords: number;
  hasQuestion: boolean;
  slideBucket: string;
  hourBucket: string | null;
  weekday: string | null;
  formatKind: string;
}

export function slideBucket(n: number | null | undefined, mediaType?: string | null): string {
  if (mediaType && mediaType !== 'carousel') return mediaType;
  if (!n) return 'inconnu';
  if (n <= 3) return '2-3';
  if (n <= 5) return '4-5';
  if (n <= 7) return '6-7';
  if (n <= 10) return '8-10';
  return '11+';
}

export function hourBucket(iso: string | null | undefined, timeZone = 'Europe/Paris'): {hour: string | null; weekday: string | null} {
  if (!iso) return {hour: null, weekday: null};
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return {hour: null, weekday: null};
  const parts = new Intl.DateTimeFormat('fr-FR', {timeZone, hour: '2-digit', hourCycle: 'h23', weekday: 'short'}).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? null;
  const bucket = h < 9 ? '06-09' : h < 12 ? '09-12' : h < 14 ? '12-14' : h < 17 ? '14-17' : h < 20 ? '17-20' : h < 23 ? '20-23' : '23-06';
  return {hour: bucket, weekday: wd};
}

export function extractFeatures(
  post: {text: string; hook?: string | null; media_type?: string | null; slide_count?: number | null; published_at?: string | null},
  niche: Niche,
): PostFeatures {
  const text = post.text ?? '';
  const hook = post.hook?.trim() || firstSentence(stripPreamble(stripPreamble(text)));
  const hookType = classifyHook(hook);
  const tags = hashtags(text);
  const {hour, weekday} = hourBucket(post.published_at);
  return {
    hook,
    hookType,
    hookWords: wordCount(hook),
    ctaType: classifyCta(text),
    emotions: emotions(text),
    structure: detectStructure(text, hookType, post.media_type ?? null, post.slide_count ?? null),
    topic: detectTopic(text, niche),
    hashtags: tags,
    hashtagCount: tags.length,
    emojiCount: emojiCount(text),
    captionWords: wordCount(text.replace(/#[\p{L}\p{N}_]+/gu, '')),
    hasQuestion: /\?/.test(hook),
    slideBucket: slideBucket(post.slide_count, post.media_type),
    hourBucket: hour,
    weekday,
    formatKind: post.media_type ?? 'inconnu',
  };
}
