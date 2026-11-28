/** Text utilities shared by the analysers, the generator and the quality checks (French first, English aware). */

/** Lowercase, strip accents, turn punctuation into spaces, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, ' ')
    .replace(/[^a-z0-9#@%€$\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ').filter((w) => w && !w.startsWith('#') && !w.startsWith('@')) : [];
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function sentences(text: string): string[] {
  return text
    .replace(/\n+/g, '. ')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** First sentence (or first line) of a caption: what the viewer reads first. */
export function firstSentence(text: string, max = 160): string {
  const clean = text.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim();
  const line = text.split('\n').map((l) => l.replace(/#[\p{L}\p{N}_]+/gu, '').trim()).find((l) => l.length > 0) ?? clean;
  const m = line.match(/^(.{4,}?[.!?…])(\s|$)/u);
  const s = (m ? m[1] : line).trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

export function hashtags(text: string): string[] {
  return [...new Set((text.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.toLowerCase()))];
}

export function emojiCount(text: string): number {
  return (text.match(/\p{Extended_Pictographic}/gu) ?? []).length;
}

const STOP_FR_EN = new Set(
  'a au aux avec ce ces cette c ca d de des du elle en et est il ils je j l la le les leur lui ma mais me mes moi mon ne n nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un une vos votre vous y the a an and or of to in on for with is are be it this that you your my me i we our at by from as'.split(
    ' ',
  ),
);

export function contentWords(text: string): string[] {
  return words(text).filter((w) => w.length > 2 && !STOP_FR_EN.has(w));
}

/** Word shingles used for near-duplicate detection. */
export function shingles(text: string, size = 4): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  if (w.length === 0) return out;
  if (w.length < size) {
    out.add(w.join(' '));
    return out;
  }
  for (let i = 0; i + size <= w.length; i++) out.add(w.slice(i, i + size).join(' '));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Share of a's shingles found in b (containment): catches a short text copied inside a long one. */
export function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / a.size;
}

export function similarity(a: string, b: string): number {
  return jaccard(shingles(a, 3), shingles(b, 3));
}

export function slugify(text: string, max = 48): string {
  return normalize(text).replace(/[#@%€$]/g, '').trim().replace(/\s+/g, '-').slice(0, max).replace(/-+$/, '');
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

/** French syllable estimate (vowel groups, mute final e). Good enough for readability scores. */
export function syllablesFr(word: string): number {
  const w = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g)?.length ?? 1;
  const muteE = w.length > 3 && /[^aeiouy]e(s|nt)?$/.test(w) ? 1 : 0;
  return Math.max(1, groups - muteE);
}

/**
 * Kandel & Moles (1958) readability for French: 207 − 1.015 × (words/sentence) − 73.6 × (syllables/word).
 * Above 70: easy; 50–70: standard; below 50: hard.
 */
export function readabilityFr(text: string): number {
  const ws = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (ws.length === 0) return 100;
  const ss = Math.max(1, sentences(text).length);
  const syl = ws.reduce((s, w) => s + syllablesFr(w), 0);
  return 207 - 1.015 * (ws.length / ss) - 73.6 * (syl / ws.length);
}

/** Stable 32-bit FNV-1a hash as hex. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** French typography: narrow no-break space before ; : ! ? and inside « », no-break space in numbers. */
export function frenchTypography(text: string): string {
  return text
    .replace(/\s*([;!?])/g, ' $1')
    .replace(/(\S)\s*:(\s|$)/g, (m, a, b) => (/\d/.test(a) && /^\d/.test(b) ? m : `${a} :${b}`))
    .replace(/«\s*/g, '« ')
    .replace(/\s*»/g, ' »')
    .replace(/(\d)\s(\d{3})\b/g, '$1 $2')
    .replace(/(\d)\s?€/g, '$1 €')
    .replace(/(\d)\s?%/g, '$1 %')
    .replace(/  /g, ' ')
    .replace(/(\p{L})'(\p{L})/gu, '$1’$2')
    .replace(/(https?): \/\//g, '$1://');
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]!);
}

/** Minimal inline markup for slides: **bold** becomes a highlight span. */
export function inlineMarkup(text: string): string {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<mark>$1</mark>').replace(/\n/g, '<br>');
}

export function median(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

export function stdev(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

/** Percentile rank of x within a sorted array (0..1, mid-rank for ties). */
export function percentileRank(sorted: number[], x: number): number {
  if (sorted.length === 0 || !Number.isFinite(x)) return 0.5;
  let lo = 0;
  let hi = 0;
  for (const v of sorted) {
    if (v < x) lo++;
    else if (v === x) hi++;
  }
  return (lo + hi / 2) / sorted.length;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function round(x: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
