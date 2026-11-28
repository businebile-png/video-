import fs from 'node:fs';
import {createRequire} from 'node:module';
import {nodeModule} from '../core/paths.js';

const require = createRequire(import.meta.url);

/** Words the French Hunspell dictionary does not know but that are correct in this niche. */
const WHITELIST = new Set(
  `systeme io systeme.io e-mail e-mails email emails e-book e-books ebook checklist checklists newsletter newsletters webinaire webinaires
   tunnel tunnels workflow workflows crm a/b startup illimité upsell upsells order bump bumps replay replays lead magnet tiktok instagram threads youtube
   carrousel carrousels copywriting slide slides swipe pseudo bio liens post posts hashtag hashtags quiz coaching coach coachs freelance freelances
   siwis french speech synthesis database honnet idiap
   inès malik sarah paul léa ttc tva rgpd pdf mp3 ia app apps stories reel reels live lives podcast podcasts template templates kit kits
   pas-à-pas tout-en-un prévends prévendre précommande désinscrire désabonne désabonner mails mail réabonnement préinscription pratico-pratique
   apprendras recevras construiras retrouveras renseigne-toi abonne-toi inscris-toi envoie-le dis-moi pose-la garde-la vends-la facilite-leur`
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean),
);

let speller: {correct: (w: string) => boolean; suggest: (w: string) => string[]} | null = null;

function load() {
  if (speller) return speller;
  const nspell = require('nspell');
  const dir = nodeModule('dictionary-fr');
  const aff = fs.readFileSync(`${dir}/index.aff`);
  const dic = fs.readFileSync(`${dir}/index.dic`);
  speller = nspell({aff, dic});
  return speller!;
}

export interface SpellIssue {
  word: string;
  suggestions: string[];
}

/** Unknown words (French Hunspell dictionary + niche whitelist). Numbers, hashtags, handles and URLs are skipped. */
export function spellCheck(text: string): SpellIssue[] {
  const sp = load();
  const out: SpellIssue[] = [];
  const seen = new Set<string>();
  const cleaned = text.replace(/https?:\/\/\S+/g, ' ').replace(/[#@][\p{L}\p{N}_.]+/gu, ' ');
  for (const raw of cleaned.match(/[\p{L}][\p{L}’'\-]*[\p{L}]|[\p{L}]/gu) ?? []) {
    const word = raw.replace(/’/g, "'");
    const lower = word.toLowerCase();
    if (seen.has(lower) || lower.length < 3 || WHITELIST.has(lower)) continue;
    seen.add(lower);
    const parts = lower.split(/'/);
    const core = parts.length > 1 && parts[0].length <= 2 ? parts.slice(1).join("'") : lower;
    if (!core || WHITELIST.has(core)) continue;
    const ok = [word, lower, core, core.charAt(0).toUpperCase() + core.slice(1)].some((w) => sp.correct(w)) || core.split('-').every((p) => p.length < 3 || WHITELIST.has(p) || sp.correct(p) || sp.correct(p.charAt(0).toUpperCase() + p.slice(1)));
    if (!ok) out.push({word, suggestions: sp.suggest(core).slice(0, 3)});
  }
  return out;
}

/** French grammar and typography heuristics that catch the usual machine-writing slips. */
export function grammarCheck(text: string): string[] {
  const issues: string[] = [];
  const t = ` ${text.replace(/\s+/g, ' ')} `;
  const lower = t.toLowerCase();
  const dbl = lower.match(/(?<![\p{L}-])(\p{L}{2,})\s+\1(?![\p{L}-])/u);
  if (dbl && !['nous', 'vous'].includes(dbl[1])) issues.push(`mot répété : « ${dbl[1]} ${dbl[1]} »`);
  const elision = lower.match(/\s(de|le|la|que|je|me|te|se|ne|ce|jusque|lorsque|puisque)\s+([aeéèêiîoôuh]\p{L}*)/u);
  if (elision && !/^(h[aâeéioôuy]\p{L}*)$/u.test(elision[2]) && !['onze', 'oui', 'ouest'].includes(elision[2]) && elision[1] !== 'ce' && !(elision[1] === 'la' && /^(une?)$/.test(elision[2]))) {
    issues.push(`élision manquante : « ${elision[1]} ${elision[2]} »`);
  }
  if (/\s,/.test(text) || /\s\.(\s|$)/.test(text)) issues.push('espace avant une virgule ou un point');
  const opens = (text.match(/«/g) ?? []).length;
  const closes = (text.match(/»/g) ?? []).length;
  if (opens !== closes) issues.push('guillemets « » non appariés');
  if ((text.match(/\(/g) ?? []).length !== (text.match(/\)/g) ?? []).length) issues.push('parenthèses non appariées');
  if (/!!|\?\?|\.\.\.\./.test(text)) issues.push('ponctuation répétée');
  return issues;
}
