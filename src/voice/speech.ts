import type {Script} from '../schemas/script.js';
import type {VoiceWord} from '../schemas/records.js';
import type {Alignment} from './elevenlabs.js';
import {normalize} from '../core/text.js';

/** One caption word (as displayed) and how it is actually spoken. */
export interface Token {
  display: string;
  spoken: string[];
  sceneId: string;
  index: number;
}

const TRAILING = /^[?!:;»%…,.)]+$/;
const LEADING = /^[«(]+$/;

/** Split a French voice-over into display words, gluing "?", "!", "»"… to their word. */
export function displayWords(text: string): string[] {
  const raw = text.replace(/\s+/g, ' ').trim().split(' ');
  const out: string[] = [];
  let pendingLead = '';
  for (const t of raw) {
    if (!t) continue;
    if (TRAILING.test(t) && out.length) {
      out[out.length - 1] = `${out[out.length - 1]}\u202f${t}`;
    } else if (LEADING.test(t)) {
      pendingLead += `${t}\u202f`;
    } else {
      out.push(pendingLead + t);
      pendingLead = '';
    }
  }
  return out;
}

function core(word: string): {lead: string; body: string; trail: string} {
  const m = word.match(/^([«("'\u202f\s]*)(.*?)([\s\u202f?!:;»%…,.)"']*)$/u);
  return {lead: m?.[1] ?? '', body: m?.[2] ?? word, trail: m?.[3] ?? ''};
}

/** How a display word should be pronounced (brand names, currencies, acronyms). */
export function spokenForm(word: string, pronunciations: Record<string, string>): string[] {
  const {body, trail} = core(word);
  const lower = body.toLowerCase();
  const hit = Object.entries(pronunciations).find(([k]) => k.toLowerCase() === lower);
  let spoken: string;
  if (hit) spoken = hit[1];
  else {
    const money = body.match(/^(\d+(?:[.,]\d+)?)(?:\u202f|\s)?(€|\$)$/);
    if (money) spoken = `${money[1]} ${money[2] === '€' ? 'euros' : 'dollars'}`;
    else if (body === '€') spoken = 'euros';
    else if (body === '$') spoken = 'dollars';
    else spoken = body;
  }
  let trailClean = trail.replace(/[\u202f\s]/g, '');
  if (trailClean.includes('%')) {
    spoken += ' pour cent';
    trailClean = trailClean.replace(/%/g, '');
  }
  const parts = spoken.split(/\s+/).filter(Boolean);
  if (parts.length && trailClean) parts[parts.length - 1] += trailClean;
  return parts;
}

export interface PreparedSpeech {
  text: string;
  tokens: Token[];
}

/** Build the exact text sent to the TTS engine plus the word mapping used to time captions. */
export function prepareSpeech(script: Script, pronunciations: Record<string, string>, sceneBreak: string): PreparedSpeech {
  const tokens: Token[] = [];
  const parts: string[] = [];
  let index = 0;
  for (const scene of script.scenes) {
    const words = displayWords(scene.voiceover);
    const spokenScene: string[] = [];
    for (const w of words) {
      const spoken = spokenForm(w, pronunciations);
      tokens.push({display: w, spoken, sceneId: scene.id, index: index++});
      spokenScene.push(...spoken);
    }
    parts.push(spokenScene.join(' '));
  }
  return {text: parts.join(sceneBreak), tokens};
}

export interface TimedWord {
  text: string;
  start: number;
  end: number;
}

/** Character-level alignment → spoken words with times. Markup such as <break …/> is skipped. */
export function alignmentToWords(al: Alignment): TimedWord[] {
  const words: TimedWord[] = [];
  let cur: TimedWord | null = null;
  let inTag = false;
  for (let i = 0; i < al.characters.length; i++) {
    const ch = al.characters[i]!;
    if (ch === '<') inTag = true;
    if (inTag) {
      if (ch === '>') inTag = false;
      if (cur) {
        words.push(cur);
        cur = null;
      }
      continue;
    }
    const s = al.character_start_times_seconds[i] ?? 0;
    const e = al.character_end_times_seconds[i] ?? s;
    if (/\s/.test(ch)) {
      if (cur) {
        words.push(cur);
        cur = null;
      }
      continue;
    }
    if (!cur) cur = {text: ch, start: s, end: e};
    else {
      cur.text += ch;
      cur.end = e;
    }
  }
  if (cur) words.push(cur);
  return words.filter((w) => normalize(w.text).length > 0);
}

/**
 * Map spoken timings back onto display tokens with a global alignment (edit distance),
 * so a token spoken as several words ("Systeme.io" → "Système I O") gets one span.
 */
export function mapToDisplay(tokens: Token[], spoken: TimedWord[]): VoiceWord[] {
  const expected: Array<{tokenIdx: number; norm: string}> = [];
  tokens.forEach((t, ti) => t.spoken.forEach((s) => expected.push({tokenIdx: ti, norm: normalize(s)})));
  const got = spoken.map((w) => normalize(w.text));
  const n = expected.length;
  const m = got.length;
  const dp: number[][] = Array.from({length: n + 1}, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i]![0] = i;
  for (let j = 0; j <= m; j++) dp[0]![j] = j;
  const same = (a: string, b: string) => a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (same(expected[i - 1]!.norm, got[j - 1]!) ? 0 : 1));
    }
  }
  const match = new Array<number>(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const sub = dp[i - 1]![j - 1]! + (same(expected[i - 1]!.norm, got[j - 1]!) ? 0 : 1);
    if (dp[i]![j] === sub) {
      match[i - 1] = j - 1;
      i--;
      j--;
    } else if (dp[i]![j] === dp[i - 1]![j]! + 1) i--;
    else j--;
  }
  const spans = tokens.map(() => ({start: Number.NaN, end: Number.NaN}));
  expected.forEach((e, k) => {
    const g = match[k]!;
    if (g < 0) return;
    const w = spoken[g]!;
    const span = spans[e.tokenIdx]!;
    span.start = Number.isNaN(span.start) ? w.start : Math.min(span.start, w.start);
    span.end = Number.isNaN(span.end) ? w.end : Math.max(span.end, w.end);
  });
  // Fill tokens the engine did not echo (rare) by interpolating between neighbours.
  for (let k = 0; k < spans.length; k++) {
    if (!Number.isNaN(spans[k]!.start)) continue;
    let a = k - 1;
    while (a >= 0 && Number.isNaN(spans[a]!.start)) a--;
    let b = k + 1;
    while (b < spans.length && Number.isNaN(spans[b]!.start)) b++;
    const from = a >= 0 ? spans[a]!.end : 0;
    const to = b < spans.length ? spans[b]!.start : from + 0.4 * (b - a);
    const slots = b - a;
    const step = (to - from) / Math.max(1, slots);
    spans[k] = {start: from + step * (k - a - 1) + 0.01, end: from + step * (k - a)};
  }
  return tokens.map((t, k) => ({text: t.display, start: round(spans[k]!.start), end: round(Math.max(spans[k]!.end, spans[k]!.start + 0.05)), sceneId: t.sceneId, index: t.index}));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', un: '1', une: '1', deux: '2', trois: '3', quatre: '4', cinq: '5', six: '6', sept: '7', huit: '8', neuf: '9',
  dix: '10', onze: '11', douze: '12', treize: '13', quatorze: '14', quinze: '15', seize: '16', vingt: '20', trente: '30',
  quarante: '40', cinquante: '50', soixante: '60', cent: '100', mille: '1000',
};

/**
 * Comparable form of one word as heard: no accents, numbers as digits, and silent French endings
 * dropped, so homophones the transcriber may pick ("réunis" / "réunies") are not counted as errors.
 */
export function heardForm(word: string): string {
  let w = normalize(word).replace(/\s+/g, '');
  if (NUMBER_WORDS[w]) return NUMBER_WORDS[w]!;
  if (w.length > 3) w = w.replace(/[sx]$/, '');
  if (w.length > 3) w = w.replace(/e$/, '');
  return w;
}

export interface PronunciationCheck {
  /** Errors per spoken caption word (0 = everything heard as written). */
  wer: number;
  substitutions: Array<[string, string]>;
  deletions: string[];
  insertions: string[];
}

/**
 * Compare what the transcriber heard with the script, token by token. A caption word may be heard as
 * up to three words and the reverse ("Systeme.io" → "système IO", "2 000" → "2000"), and either its
 * written form or its spoken respelling ("e-mails" spoken "i-mèles") counts as correct.
 */
export function pronunciationCheck(tokens: Token[], heardText: string): PronunciationCheck {
  const forms = (text: string) => normalize(text).split(' ').filter(Boolean).map(heardForm).join('');
  const alts = tokens.map((t) => [...new Set([forms(t.display), forms(t.spoken.join(' '))].filter(Boolean))]);
  const ref = tokens.map((t, i) => ({display: core(t.display).body, alts: alts[i]!})).filter((r) => r.alts.length > 0);
  const hyp = normalize(heardText).split(' ').filter(Boolean);
  const hypForms = hyp.map(heardForm);
  const n = ref.length;
  const m = hyp.length;
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({length: n + 1}, () => new Array<number>(m + 1).fill(INF));
  const back: Array<Array<[number, number] | null>> = Array.from({length: n + 1}, () => new Array<[number, number] | null>(m + 1).fill(null));
  dp[0]![0] = 0;
  const spanMatches = (i: number, a: number, j: number, b: number): boolean => {
    const heard = hypForms.slice(j, j + b).join('');
    let combos = [''];
    for (let k = i; k < i + a; k++) combos = combos.flatMap((c) => ref[k]!.alts.map((x) => c + x));
    return combos.includes(heard);
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const cur = dp[i]![j]!;
      if (cur === INF) continue;
      const relax = (ni: number, nj: number, cost: number) => {
        if (cur + cost < dp[ni]![nj]!) {
          dp[ni]![nj] = cur + cost;
          back[ni]![nj] = [i, j];
        }
      };
      if (i < n) relax(i + 1, j, 1);
      if (j < m) relax(i, j + 1, 1);
      for (let a = 1; a <= 3 && i + a <= n; a++) {
        for (let b = 1; b <= 3 && j + b <= m; b++) {
          if (spanMatches(i, a, j, b)) relax(i + a, j + b, 0);
          else if (a === 1 && b === 1) relax(i + 1, j + 1, 1);
        }
      }
    }
  }
  const substitutions: Array<[string, string]> = [];
  const deletions: string[] = [];
  const insertions: string[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const prev = back[i]![j];
    if (!prev) break;
    const [pi, pj] = prev;
    const cost = dp[i]![j]! - dp[pi]![pj]!;
    if (cost > 0) {
      if (i - pi === 1 && j - pj === 1) substitutions.push([ref[pi]!.display, hyp[pj]!]);
      else if (i - pi === 1) deletions.push(ref[pi]!.display);
      else insertions.push(hyp[pj]!);
    }
    i = pi;
    j = pj;
  }
  const wer = n === 0 ? (m === 0 ? 0 : 1) : dp[n]![m]! / n;
  return {wer, substitutions: substitutions.reverse(), deletions: deletions.reverse(), insertions: insertions.reverse()};
}
