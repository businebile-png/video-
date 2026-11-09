import type {Script} from '../schemas/script.js';
import {normalize, wordCount} from '../core/text.js';
import {estimateDurationSec} from './lint.js';

/**
 * What the platforms say they reward, checked on the script before any voice is recorded (cheap to fix):
 * TikTok ranks on interactions and watch time; Instagram's three main signals are watch time, likes per
 * reach and sends (shares in messages) per reach. So: an idea in the first seconds, a reason to watch to the
 * end, a short video, an end that does not drag, a caption that asks a real question and is worth saving.
 *
 * This is a checklist, not a score: it never changes the 100-point grid nor the publication locks.
 * Every item stays compatible with the honesty rules (no fake mystery, no promise, no pressure).
 */
export interface ViralItem {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** What to change when the item is not met. */
  fix: string;
}

export interface ViralChecklist {
  passed: number;
  total: number;
  items: ViralItem[];
}

/** Minimum the guide asks for before recording the voice. */
export const VIRAL_MIN_PASSED = 10;

const BRAND = /\bsysteme\s?io\b/;
const VIEWER = /\b(tu|ton|ta|tes|toi|t|te|arrete|regarde|imagine|pov)\b/;
// An announced list, a demonstration or a turn that the rest of the video pays off.
const OPEN_LOOP =
  /\b(\d+|deux|trois|quatre|cinq)\s+(choses?|erreurs?|raisons?|astuces?|etapes?|limites?|formules?|fonctions?|outils?|questions?|points?|minutes?|secondes?|clics?)\b|\b(je te montre|regarde|voici|tu vas voir|attends|a la fin|jusqu a la fin|le dernier|la derniere|sauf que|pourtant|personne ne|presque personne|la plupart|en vrai|la difference)\b/;
const COMMENT = /\b(commentaires?|dis moi|reponds|ecris|ton avis|tu preferes|plutot|lequel|laquelle|tu choisis|tu prends)\b/;
const SAVE_SEND = /\b(enregistre\w*|sauvegarde\w*|garde la|garde cette|garde ce|envoie\w*|partage\w*|montre la|identifie\w*|tague\w*)\b/;
const SEARCH_TERMS =
  /\bsysteme\s?io\b|\btunnels?\b|\be\s?mails?\b|\bnewsletters?\b|\bformations?\b|\bautomatis|\bsite\b|\bpages?\s+de\s+vente\b|\bwebinaires?\b|\bproduits?\s+numeriques?\b|\bvendre\b|\bbusiness\b|\bformules?\b|\babonnements?\b|\bgratuit/;

const firstSentence = (text: string) => text.split(/(?<=[.?!…:])\s/)[0] ?? text;

export function viralChecklist(script: Script): ViralChecklist {
  const items: ViralItem[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string, fix: string) => items.push({id, label, ok, detail, fix});
  const hook = script.scenes[0]!;
  const second = script.scenes[1];
  const last = script.scenes[script.scenes.length - 1]!;
  const hookSentence = firstSentence(hook.voiceover);
  const hookWords = wordCount(hookSentence);
  const hookNorm = normalize(hookSentence);

  add(
    'accroche-courte',
    'L’idée tombe dans les 2 à 3 premières secondes',
    hookWords <= 12,
    `${hookWords} mots dans la première phrase (environ ${(hookWords / 3.1).toFixed(1)} s)`,
    'Couper la première phrase à 12 mots au plus : le problème ou le fait surprenant d’abord, l’explication ensuite.',
  );
  const headline = hook.headline?.trim() ?? '';
  add(
    'accroche-ecrite',
    'Texte d’accroche à l’écran dès la première image',
    headline.length >= 4 && headline.length <= 36,
    headline ? `« ${headline} » (${headline.length} caractères)` : 'aucun titre sur la scène d’accroche',
    'Donner à la scène s1 un titre court (36 caractères au plus) qui dit l’accroche : beaucoup regardent sans le son.',
  );
  add(
    'accroche-spectateur',
    'L’accroche parle au spectateur (tu, une question, un geste)',
    VIEWER.test(hookNorm) || hookSentence.includes('?'),
    hookSentence,
    'Formuler l’accroche avec « tu » ou en question, sur un problème que la cible vit (« Tu envoies encore tes e-mails à la main ? »).',
  );
  add(
    'marque-apres',
    'La marque arrive après l’accroche, pas dans la première phrase',
    !BRAND.test(hookNorm),
    BRAND.test(hookNorm) ? 'Systeme.io est nommé dans la première phrase : la vidéo ressemble tout de suite à une pub' : 'ok',
    'Ouvrir sur le problème ou le fait, puis nommer Systeme.io dans la phrase suivante (le titre à l’écran peut garder le mot-clé).',
  );
  const opening = normalize(`${hook.voiceover} ${hook.headline ?? ''} ${second?.voiceover ?? ''}`);
  add(
    'boucle-ouverte',
    'Une raison de rester jusqu’au bout (liste annoncée, question, démonstration)',
    OPEN_LOOP.test(opening) || hook.voiceover.includes('?') || script.hookStyle === 'liste' || script.hookStyle === 'geste',
    OPEN_LOOP.test(opening) ? 'annonce trouvée au début' : hook.voiceover.includes('?') ? 'question posée dans l’accroche' : 'rien n’annonce la suite',
    'Annoncer ce qui vient et le tenir (« trois limites changent », « je te montre en 20 secondes ») sans mystère trompeur ni « secret ».',
  );
  const estimated = estimateDurationSec(script);
  const perScene = estimated / script.scenes.length;
  add(
    'rythme',
    'Une nouvelle scène toutes les 5,5 s au plus',
    perScene <= 5.5,
    `${script.scenes.length} scènes pour ~${estimated} s (${perScene.toFixed(1)} s par scène)`,
    'Découper les scènes longues : une phrase = une scène, chacune avec son image.',
  );
  add(
    'duree',
    'Vidéo courte (40 s au plus) : plus de gens la regardent en entier',
    estimated <= 40,
    `~${estimated} s estimées`,
    'Retirer une idée secondaire plutôt que d’accélérer la voix : une vidéo, une idée.',
  );
  const lastWords = wordCount(last.voiceover);
  add(
    'fin-courte',
    'Fin courte : l’appel à l’action ne traîne pas',
    lastWords <= 16,
    `${lastWords} mots dans la dernière scène`,
    'Finir en une phrase : la raison de cliquer + « lien en bio ».',
  );
  const caps = [script.captions.tiktok, script.captions.instagram];
  const asks = caps.map((c) => c.includes('?') && COMMENT.test(normalize(c)));
  add(
    'question-commentaire',
    'La légende pose une vraie question facile à commenter',
    asks.every(Boolean),
    asks.every(Boolean) ? 'ok sur TikTok et Instagram' : `manquante sur ${['TikTok', 'Instagram'].filter((_, i) => !asks[i]).join(' et ')}`,
    'Ajouter une question à laquelle on répond en un mot (« Tu automatiserais quoi en premier : les e-mails ou les ventes ? Dis-le en commentaire. »).',
  );
  const saves = caps.map((c) => SAVE_SEND.test(normalize(c)));
  add(
    'enregistrer-envoyer',
    'La légende invite (sans insister) à enregistrer ou envoyer la vidéo',
    saves.every(Boolean),
    saves.every(Boolean) ? 'ok sur TikTok et Instagram' : `manquante sur ${['TikTok', 'Instagram'].filter((_, i) => !saves[i]).join(' et ')}`,
    'Une phrase utile, pas une pression : « Enregistre-la pour comparer plus tard » ou « Envoie-la à quelqu’un qui lance son activité ».',
  );
  const tags = script.captions.hashtags.length;
  add(
    'hashtags',
    '3 à 5 hashtags précis',
    tags >= 3 && tags <= 5,
    `${tags} hashtag(s)`,
    'Garder 3 à 5 hashtags : 1 ou 2 larges (#entrepreneur), 2 ou 3 précis (#tunneldevente, #emailmarketing, #systemeio).',
  );
  const firstLines = caps.map((c) => normalize(c.split('\n').find((l) => l.trim()) ?? ''));
  const searchable = firstLines.map((l) => SEARCH_TERMS.test(l));
  add(
    'mot-cle',
    'La première ligne de la légende contient ce que les gens tapent dans la recherche',
    searchable.every(Boolean),
    searchable.every(Boolean) ? 'ok' : 'première ligne sans mot-clé (outil, besoin, formule)',
    'Mettre le sujet en clair dès la première ligne (« Automatiser ses e-mails gratuitement avec Systeme.io ? »).',
  );
  return {passed: items.filter((i) => i.ok).length, total: items.length, items};
}
