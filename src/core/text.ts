/** Lowercase, strip accents and punctuation: used for comparisons, never for display. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`]/g, ' ')
    .replace(/[^a-z0-9%€$]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function trigrams(text: string): Set<string> {
  const n = ` ${normalize(text)} `;
  const out = new Set<string>();
  for (let i = 0; i < n.length - 2; i++) out.add(n.slice(i, i + 3));
  return out;
}

/** Character-trigram Jaccard similarity in [0,1]; robust to small rewordings. */
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Word error rate between a reference and a hypothesis (both normalized first). */
export function wordErrorRate(reference: string, hypothesis: string): {wer: number; substitutions: Array<[string, string]>; deletions: string[]; insertions: string[]} {
  const r = words(reference);
  const h = words(hypothesis);
  const rows = r.length + 1;
  const cols = h.length + 1;
  const d: number[][] = Array.from({length: rows}, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i]![0] = i;
  for (let j = 0; j < cols; j++) d[0]![j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = r[i - 1] === h[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
    }
  }
  const substitutions: Array<[string, string]> = [];
  const deletions: string[] = [];
  const insertions: string[] = [];
  let i = r.length;
  let j = h.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i]![j] === d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1)) {
      if (r[i - 1] !== h[j - 1]) substitutions.push([r[i - 1]!, h[j - 1]!]);
      i--;
      j--;
    } else if (i > 0 && d[i]![j] === d[i - 1]![j]! + 1) {
      deletions.push(r[i - 1]!);
      i--;
    } else {
      insertions.push(h[j - 1]!);
      j--;
    }
  }
  const wer = r.length === 0 ? (h.length === 0 ? 0 : 1) : d[r.length]![h.length]! / r.length;
  return {wer, substitutions: substitutions.reverse(), deletions: deletions.reverse(), insertions: insertions.reverse()};
}

/** Extract numbers as they appear ("2 000", "17", "0,5") in a comparable digit-only form. */
export function extractNumbers(text: string): string[] {
  const out: string[] = [];
  const re = /\d[\d\s\u202f\u00a0.,]*\d|\d/g;
  for (const m of text.matchAll(re)) {
    const cleaned = m[0].replace(/[\s\u202f\u00a0]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    out.push(cleaned.replace(/\.0+$/, ''));
  }
  return out;
}

export function slugify(text: string, max = 40): string {
  return normalize(text).replace(/[%€$]/g, '').trim().replace(/\s+/g, '-').slice(0, max).replace(/-+$/, '');
}
