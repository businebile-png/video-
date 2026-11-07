import type {Script, Scene} from '../schemas/script.js';
import type {StudioConfig, Phase} from '../schemas/config.js';
import type {Capture} from '../schemas/assets.js';
import type {Fact} from '../schemas/facts.js';
import type {VoiceWord} from '../schemas/records.js';
import {
  SAFE_AREA,
  type ArtDirection,
  type AudioClip,
  type CameraMove,
  type CameraMoveKind,
  type CaptionGroup,
  type CaptureShot,
  type FootageShot,
  type GraphicItem,
  type HeadlineItem,
  type Region,
  type Shot,
  type Timeline,
  type TransitionKind,
  type VolumePoint,
} from '../schemas/timeline.js';
import {Rng} from '../core/rng.js';
import {normalize} from '../core/text.js';

export interface PreparedClip {
  clipId: string;
  pexelsId: number;
  /** Path of the downloaded original, relative to the run directory. */
  file: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  author: string;
}

export interface BuildInput {
  runId: string;
  script: Script;
  words: VoiceWord[];
  voiceDurationSec: number;
  voiceSrc: string;
  clipsByScene: Record<string, PreparedClip[]>;
  captures: Capture[];
  music: {src: string; durationSec: number} | null;
  ad: ArtDirection;
  config: StudioConfig;
  facts: Fact[];
  seed: number;
}

const FPS = 30;
const END_HOLD_SEC = 2.1;
const DISSOLVE_FRAMES = 8;
const WHIP_FRAMES = 6;
const MAX_STYLIZED_TRANSITIONS = 3;

/** Target shot length (seconds) by pacing and narrative phase. */
const TARGET_SHOT: Record<ArtDirection['motion']['pacing'], Record<Phase, number>> = {
  punchy: {hook: 0.95, problem: 1.3, agitation: 1.15, solution: 1.8, demo: 3, benefits: 1.6, proof: 2, objection: 1.8, cta: 2.8},
  balanced: {hook: 1.2, problem: 1.7, agitation: 1.5, solution: 2.2, demo: 3.5, benefits: 2, proof: 2.4, objection: 2.2, cta: 3.2},
  calm: {hook: 1.5, problem: 2.2, agitation: 2, solution: 2.8, demo: 4, benefits: 2.6, proof: 3, objection: 2.6, cta: 3.8},
};

const toF = (sec: number) => Math.round(sec * FPS);

export function targetShotSec(pacing: ArtDirection['motion']['pacing'], phase: Phase): number {
  return TARGET_SHOT[pacing][phase];
}
const endsSentence = (w: string) => /[.,;:!?…»)]$/.test(w);

interface SceneSpan {
  scene: Scene;
  index: number;
  startSec: number;
  endSec: number;
  words: VoiceWord[];
}

export function sceneSpans(script: Script, words: VoiceWord[], voiceDurationSec: number): SceneSpan[] {
  const byScene = new Map<string, VoiceWord[]>();
  for (const w of words) {
    const list = byScene.get(w.sceneId) ?? [];
    list.push(w);
    byScene.set(w.sceneId, list);
  }
  const lastWordEnd = words.length ? Math.max(...words.map((w) => w.end)) : voiceDurationSec;
  const total = Math.max(lastWordEnd + END_HOLD_SEC, voiceDurationSec + 0.4);
  const spans: SceneSpan[] = [];
  script.scenes.forEach((scene, index) => {
    const sw = byScene.get(scene.id) ?? [];
    if (sw.length === 0) throw new Error(`Aucun mot synchronisé pour la scène ${scene.id} : relancer l'étape voix.`);
    spans.push({scene, index, startSec: 0, endSec: 0, words: sw});
  });
  for (let i = 0; i < spans.length; i++) {
    const cur = spans[i]!;
    if (i === 0) cur.startSec = 0;
    else {
      const prev = spans[i - 1]!;
      const prevEnd = prev.words[prev.words.length - 1]!.end;
      const firstStart = cur.words[0]!.start;
      // Cut a hair before the first word of the new scene, never before the previous word ends.
      cur.startSec = Math.min(firstStart, Math.max(prevEnd + 0.02, firstStart - 0.1));
      prev.endSec = cur.startSec;
    }
  }
  spans[spans.length - 1]!.endSec = total;
  return spans;
}

/** Split a scene into shots, preferring cuts at phrase boundaries of the voice-over. */
export function planCuts(span: SceneSpan, targetSec: number, rng: Rng): number[] {
  const {startSec, endSec, words} = span;
  const candidates = words.slice(1).map((w, i) => {
    const prev = words[i]!;
    return {t: Math.max(startSec, w.start - 0.04), strong: endsSentence(prev.text) || w.start - prev.end > 0.12};
  });
  const cuts = [startSec];
  let cur = startSec;
  let guard = 0;
  while (endSec - cur > targetSec * 1.45 && guard++ < 40) {
    const desired = cur + targetSec * rng.float(0.85, 1.15);
    const lo = cur + Math.max(0.55, targetSec * 0.6);
    const hi = Math.min(cur + targetSec * 1.6, endSec - 0.6);
    if (hi <= lo) break;
    const inRange = candidates.filter((c) => c.t >= lo && c.t <= hi);
    let next: number;
    if (inRange.length > 0) {
      next = inRange.reduce((best, c) => {
        const score = Math.abs(c.t - desired) - (c.strong ? targetSec * 0.35 : 0);
        const bestScore = Math.abs(best.t - desired) - (best.strong ? targetSec * 0.35 : 0);
        return score < bestScore ? c : best;
      }).t;
    } else {
      next = Math.min(Math.max(desired, lo), hi);
    }
    if (next <= cur + 0.5) break;
    cuts.push(next);
    cur = next;
  }
  cuts.push(endSec);
  return cuts;
}

const MOVE_SHAPES: Record<CameraMoveKind, (k: number) => Omit<CameraMove, 'kind' | 'ease' | 'handheld'>> = {
  'push-in': (k) => ({fromScale: 1.03, toScale: 1.03 + 0.07 * k, fromX: 0, toX: 0, fromY: 0, toY: 0}),
  'pull-out': (k) => ({fromScale: 1.03 + 0.07 * k, toScale: 1.03, fromX: 0, toX: 0, fromY: 0, toY: 0}),
  'drift-left': (k) => ({fromScale: 1.1, toScale: 1.1, fromX: 2.2 * k, toX: -2.2 * k, fromY: 0, toY: 0}),
  'drift-right': (k) => ({fromScale: 1.1, toScale: 1.1, fromX: -2.2 * k, toX: 2.2 * k, fromY: 0, toY: 0}),
  'drift-up': (k) => ({fromScale: 1.1, toScale: 1.1, fromX: 0, toX: 0, fromY: 2 * k, toY: -2 * k}),
  rise: (k) => ({fromScale: 1.05, toScale: 1.05 + 0.05 * k, fromX: 0, toX: 0, fromY: 1.5 * k, toY: -1.5 * k}),
  hold: () => ({fromScale: 1.05, toScale: 1.07, fromX: 0, toX: 0, fromY: 0, toY: 0}),
};

export function makeMove(kind: CameraMoveKind, shotSec: number, intensity: number, handheld: number): CameraMove {
  const k = Math.min(1.2, Math.max(0.4, intensity));
  return {kind, ...MOVE_SHAPES[kind](k), ease: shotSec > 2.6 ? 'inOut' : 'linear', handheld};
}

function maxScale(m: CameraMove): number {
  return Math.max(m.fromScale, m.toScale);
}

/** Frame upscale factor needed by a shot (1.0 = native pixels). */
export function upscaleOf(source: {width: number; height: number}, move: CameraMove, outH = 1920, outW = 1080): number {
  const effH = Math.min(source.height, (source.width * 16) / 9);
  const effW = Math.min(source.width, (source.height * 9) / 16);
  return Math.max((outH * maxScale(move)) / effH, (outW * maxScale(move)) / effW);
}

const PHASE_GROUP: Record<Phase, string> = {
  hook: 'open',
  problem: 'pain',
  agitation: 'pain',
  objection: 'pain',
  solution: 'answer',
  demo: 'answer',
  benefits: 'answer',
  proof: 'answer',
  cta: 'close',
};

/** Find the time where a phrase is spoken inside a scene (first matching content word). */
export function findSpokenTime(phrase: string, words: VoiceWord[], afterIndex = -1): {time: number; index: number} | null {
  const tokens = normalize(phrase)
    .split(' ')
    .filter((t) => t.length >= 4);
  if (tokens.length === 0) return null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (w.index <= afterIndex) continue;
    const wn = normalize(w.text);
    if (!wn) continue;
    // "s'inscrit" normalizes to "s inscrit": its parts are compared too (French elisions).
    const parts = [wn, ...wn.split(' ').filter((x) => x.length >= 4)];
    const same = (a: string, t: string) => a === t || (a.length >= 5 && t.length >= 5 && (a.startsWith(t.slice(0, 5)) || t.startsWith(a.slice(0, 5))));
    if (tokens.some((t) => parts.some((a) => same(a, t)))) {
      return {time: w.start, index: w.index};
    }
  }
  return null;
}

/** First word where an exact phrase is said (normalized, numbers allowed: "5 000", "17 €"), after a word index. */
export function findCueTime(cue: string, words: VoiceWord[], afterIndex = -1): {time: number; index: number} | null {
  const target = normalize(cue);
  if (!target) return null;
  let text = '';
  const starts: Array<{pos: number; w: VoiceWord}> = [];
  for (const w of words) {
    if (w.index <= afterIndex) continue;
    const n = normalize(w.text);
    if (!n) continue;
    if (text) text += ' ';
    starts.push({pos: text.length, w});
    text += n;
  }
  const at = ` ${text} `.indexOf(` ${target} `);
  if (at < 0) return null;
  const hit = [...starts].reverse().find((s) => s.pos <= at)!;
  return {time: hit.w.start, index: hit.w.index};
}

function graphicLabels(scene: Scene): string[] {
  const g = scene.visual.graphic;
  if (!g) return [];
  switch (g.type) {
    case 'checklist':
      return g.items;
    case 'steps':
      return g.steps.map((s) => s.title);
    case 'stack-merge':
      return [...g.items, g.result];
    case 'compare':
      return [g.left.title, g.right.title];
    case 'stat':
      return [g.label];
    case 'price':
      return [g.plan];
  }
}

function revealTimes(scene: Scene, span: SceneSpan): number[] {
  const labels = graphicLabels(scene);
  if (labels.length === 0) return [0];
  const g = scene.visual.graphic!;
  const usable = Math.max(0.6, span.endSec - span.startSec - 0.8);
  if (g.type === 'stack-merge') {
    const chipsEnd = Math.min(usable * 0.45, 0.25 + g.items.length * 0.18);
    // Each chip appears when the voice names it (evenly spaced if it is not said), in order.
    let after = -1;
    const chips = g.items.map((label, i) => {
      const hit = findSpokenTime(label, span.words, after);
      if (hit) after = hit.index;
      return hit ? Math.max(0.15, hit.time - span.startSec - 0.1) : 0.25 + (i * (chipsEnd - 0.25)) / Math.max(1, g.items.length - 1);
    });
    for (let i = 1; i < chips.length; i++) chips[i] = Math.max(chips[i]!, chips[i - 1]! + 0.25);
    if (after < 0) {
      // None named here (a recap of what was just said): quick entrance, merge after ~1 s, the result holds.
      const quick = g.items.map((_, i) => 0.1 + i * 0.15);
      return [...quick, Math.min(quick[quick.length - 1]! + 0.9, usable)];
    }
    const merge = findSpokenTime(g.result, span.words, after);
    // Chips stay readable (the first one at least 1.5 s, the last one 1 s) before they merge into the result.
    const mergeAt = Math.max(chips[0]! + 1.5, chips[chips.length - 1]! + 1, merge ? merge.time - span.startSec - 0.15 : 0);
    return [...chips, Math.min(mergeAt, usable)];
  }
  // A comparison is read as one card: both columns come in together at the start of the scene.
  if (g.type === 'compare') {
    // Both columns come in together (one card); each line lights up when the voice says it, otherwise
    // shortly after the line before it.
    const lines = (items: string[], from: number, afterIndex: number) => {
      let after = afterIndex;
      let prev = from;
      return items.map((label) => {
        const hit = findSpokenTime(label, span.words, after);
        if (hit) after = hit.index;
        prev = hit ? Math.max(prev + 0.15, hit.time - span.startSec - 0.1) : prev + 0.35;
        return Math.min(prev, usable);
      });
    };
    const right = findSpokenTime(g.right.title, span.words);
    const leftLines = lines(g.left.items, 0.3, -1);
    const rightLines = lines(g.right.items, right ? Math.max(0.6, right.time - span.startSec - 0.1) : leftLines[leftLines.length - 1]! + 0.4, right ? right.index : -1);
    return [0.15, 0.45, ...leftLines, ...rightLines];
  }
  const out: number[] = [];
  let after = -1;
  labels.forEach((label, i) => {
    const hit = findSpokenTime(label, span.words, after);
    const even = 0.3 + (i * (usable - 0.3)) / Math.max(1, labels.length);
    if (hit) {
      after = hit.index;
      out.push(Math.max(0.15, hit.time - span.startSec - 0.12));
    } else out.push(even);
  });
  // Keep reveals ordered and at least 0.35 s apart.
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i]!, out[i - 1]! + 0.35);
  return out.map((t) => Math.min(t, usable));
}

function captionY(kind: Scene['visual']['kind']): number {
  if (kind === 'demo') return 1312;
  if (kind === 'graphic') return 1300;
  return 1244;
}

function isEmphasis(word: string, emphasis: string[]): boolean {
  // A number ("17 €", "5 000") is emphasised when an emphasis phrase holds the same number.
  const num = word.replace(/[^0-9]/g, '');
  if (num) return emphasis.some((phrase) => (phrase.match(/\d[\d\s  ]*/g) ?? []).some((n) => n.replace(/[^0-9]/g, '') === num));
  const wn = normalize(word);
  if (wn.length < 3) return false;
  return emphasis.some((phrase) => normalize(phrase).split(' ').some((t) => t.length >= 3 && (t === wn || (t.length >= 5 && wn.startsWith(t.slice(0, 5))))));
}

/** Words that lean on the next one: a caption group never ends with them. */
const LEANING_WORDS = new Set([
  'le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux', 'a', 'à', 'en', 'et', 'ou', 'dans', 'sur', 'pour', 'par',
  'avec', 'sans', 'ton', 'ta', 'tes', 'mon', 'ma', 'mes', 'son', 'sa', 'ses', 'ce', 'cet', 'cette', 'ces', 'qui', 'que', 'qu', 'tu', 'je',
  'on', 'il', 'elle', 'ne', 'se', 'te', 'me', 'plus', 'très', 'si', 'quand', 'leur', 'leurs', 'notre', 'votre', 'nos', 'vos',
]);

function bare(word: string): string {
  return word.toLowerCase().replace(/[’']$/u, '').replace(/^[«(\s\u202f]+|[»)\s\u202f?!:;,.…]+$/gu, '');
}

/** "5" + "000" (a number the transcriber split at its thousands) becomes one caption word, "5 000". */
export function joinThousands(words: VoiceWord[]): VoiceWord[] {
  const out: VoiceWord[] = [];
  for (const w of words) {
    const prev = out[out.length - 1];
    if (prev && /^\d{1,3}( \d{3})*$/.test(prev.text) && /^\d{3}(?![\d])/.test(w.text)) {
      out[out.length - 1] = {...prev, text: `${prev.text} ${w.text}`, end: Math.max(prev.end, w.end)};
    } else out.push(w);
  }
  return out;
}

export function buildCaptions(spans: SceneSpan[], ad: ArtDirection, endCardFrom: number): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  for (const span of spans) {
    const y = captionY(span.scene.visual.kind);
    let current: VoiceWord[] = [];
    const flush = () => {
      if (current.length === 0) return;
      groups.push({
        from: toF(current[0]!.start),
        to: toF(current[current.length - 1]!.end + 0.18),
        y,
        words: current.map((w) => ({text: w.text, from: toF(w.start), to: toF(w.end), emphasis: isEmphasis(w.text, span.scene.emphasis)})),
      });
      current = [];
    };
    const words = joinThousands(span.words);
    words.forEach((w, i) => {
      const prev = words[i - 1];
      const chars = current.reduce((n, c) => n + c.text.length + 1, 0) + w.text.length;
      const pause = Boolean(prev && w.start - prev.end > 0.35);
      if (current.length > 0 && (current.length >= ad.caption.maxWords || chars > ad.caption.maxChars || pause)) {
        if (pause) flush();
        else {
          // Carry trailing articles/prepositions over to the next group, where their noun is; a group made only
          // of such words grows by one word instead of being shown alone ("dans un" + "seul").
          let keep = current.length;
          while (keep > 0 && (LEANING_WORDS.has(bare(current[keep - 1]!.text)) || /^[0-9][0-9\u202f]*$/.test(current[keep - 1]!.text))) keep--;
          if (keep > 0) {
            const carried = current.slice(keep);
            current = current.slice(0, keep);
            flush();
            current.push(...carried);
          }
        }
      }
      current.push(w);
      if (endsSentence(w.text)) flush();
    });
    flush();
  }
  // A group on screen for less than 0.4 s cannot be read: it joins the next one when both fit on screen.
  // Its time on screen ends when the next group starts, even if its own last word lingers longer.
  for (let i = 0; i < groups.length - 1; i++) {
    const g = groups[i]!;
    const next = groups[i + 1]!;
    const chars = [...g.words, ...next.words].reduce((n, w) => n + w.text.length + 1, 0);
    if (Math.min(g.to, next.from) - g.from < 12 && next.y === g.y && next.from - g.to <= 6 && chars <= ad.caption.maxChars + 10) {
      groups.splice(i, 2, {...g, to: next.to, words: [...g.words, ...next.words]});
      i--;
    }
  }
  // Chain groups (no flicker between close groups) and stop at the end card.
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    const next = groups[i + 1];
    if (next && next.from - g.to < 12) g.to = next.from;
  }
  return groups
    .filter((g) => g.from < endCardFrom)
    .map((g) => ({...g, to: Math.min(g.to, endCardFrom)}))
    .filter((g) => g.to - g.from >= 4);
}

function focusPlan(capture: Capture, scene: Scene, span: SceneSpan, durationF: number) {
  // Zones of this capture, with their index in the script (for the script's own label text).
  const regions = scene.visual.focusRegionIds
    .map((id, k) => ({r: capture.focusRegions.find((x) => x.id === id), k}))
    .filter((e): e is {r: NonNullable<typeof e.r>; k: number} => Boolean(e.r));
  const keyframes: CaptureShot['keyframes'] = [{at: 0, focus: null}];
  const highlights: CaptureShot['highlights'] = [];
  let after = -1;
  regions.forEach(({r, k}, i) => {
    // The camera moves on the first word that names the zone: its label or one of its cues ("5 000" for Startup).
    const hits = [findSpokenTime(r.label, span.words, after), ...(r.cues ?? []).map((c) => findCueTime(c, span.words, after))].filter(
      (h): h is {time: number; index: number} => h !== null,
    );
    const hit = hits.sort((a, b) => a.time - b.time)[0] ?? null;
    const fallback = 0.3 + (i + 1) * ((span.endSec - span.startSec) / (regions.length + 1)) * 0.8;
    const atSec = hit ? Math.max(0.5, hit.time - span.startSec - 0.2) : fallback;
    if (hit) after = hit.index;
    const at = Math.min(durationF - 20, Math.max(12, toF(atSec)));
    const region: Region = {x: r.x, y: r.y, w: r.w, h: r.h};
    keyframes.push({at, focus: region});
    highlights.push({from: at + 10, duration: 0, region, label: scene.visual.focusLabels?.[k] ?? r.label});
  });
  highlights.forEach((h, i) => {
    const nextAt = keyframes[i + 2]?.at ?? durationF;
    h.duration = Math.max(15, nextAt - h.from - 4);
  });
  return {keyframes, highlights};
}

function volumeCurve(words: VoiceWord[], totalF: number, underDb: number, openDb: number): VolumePoint[] {
  const speech: Array<[number, number]> = [];
  for (const w of words) {
    const last = speech[speech.length - 1];
    if (last && w.start - last[1] < 0.6) last[1] = w.end;
    else speech.push([w.start, w.end]);
  }
  const pts: VolumePoint[] = [{frame: 0, db: underDb}];
  for (const [s, e] of speech) {
    const sF = Math.max(0, toF(s - 0.25));
    const eF = toF(e + 0.2);
    const prev = pts[pts.length - 1]!;
    if (sF - prev.frame > 18) {
      pts.push({frame: Math.max(prev.frame + 1, prev.frame + 8), db: openDb});
      pts.push({frame: Math.max(prev.frame + 9, sF - 1), db: openDb});
    }
    pts.push({frame: Math.max(pts[pts.length - 1]!.frame + 1, sF), db: underDb});
    pts.push({frame: Math.max(pts[pts.length - 1]!.frame + 1, eF), db: underDb});
  }
  const lastFrame = pts[pts.length - 1]!.frame;
  if (totalF - lastFrame > 12) pts.push({frame: lastFrame + 8, db: openDb});
  pts.push({frame: Math.max(pts[pts.length - 1]!.frame + 1, totalF - 36), db: openDb});
  pts.push({frame: totalF, db: -60});
  return pts;
}

export function buildTimeline(input: BuildInput): Timeline {
  const {script, words, ad, config, seed} = input;
  const rng = new Rng(seed);
  const spans = sceneSpans(script, words, input.voiceDurationSec);
  const totalF = toF(spans[spans.length - 1]!.endSec);
  const shots: Shot[] = [];
  const graphics: GraphicItem[] = [];
  const headlines: HeadlineItem[] = [];
  const sfx: AudioClip[] = [];
  const clipCursor = new Map<string, number>();
  let lastClipId: string | null = null;
  let lastMove: CameraMoveKind | null = null;
  let shotCounter = 0;
  const factById = new Map(input.facts.map((f) => [f.id, f]));

  const nextMove = (preferred?: CameraMoveKind): CameraMoveKind => {
    if (preferred) return preferred;
    const options = ad.motion.moves.filter((m) => m !== lastMove);
    return rng.pick(options.length ? options : ad.motion.moves);
  };

  const pushFootage = (
    span: SceneSpan,
    fromSec: number,
    toSec: number,
    opts: {layer: 'full' | 'background'; intensity: number; move?: CameraMoveKind; continueClip?: boolean},
  ) => {
    const pool = input.clipsByScene[span.scene.id] ?? [];
    const fallbackPool = Object.values(input.clipsByScene).flat();
    // A lone clip cannot alternate: borrow from other scenes rather than jump-cut inside one clip.
    const candidates = pool.length >= 2 ? pool : [...pool, ...fallbackPool.filter((c) => !pool.some((p) => p.clipId === c.clipId))];
    if (candidates.length === 0) throw new Error(`Aucune séquence vidéo disponible pour la scène ${span.scene.id}.`);
    const durSec = toSec - fromSec;
    const playbackRate = ad.motion.pacing === 'calm' && span.scene.phase !== 'hook' ? 0.9 : 1;
    const neededSec = durSec * playbackRate + 0.35;
    const ordered = [...candidates].sort((a, b) => (clipCursor.get(a.clipId) ?? 0) - (clipCursor.get(b.clipId) ?? 0));
    const continued = opts.continueClip ? candidates.find((c) => c.clipId === lastClipId && c.durationSec - (clipCursor.get(c.clipId) ?? 0) + 0.3 >= neededSec) : undefined;
    const clip =
      continued ??
      ordered.find((c) => c.clipId !== lastClipId && c.durationSec - (clipCursor.get(c.clipId) ?? c.durationSec * 0.08) >= neededSec) ??
      ordered.find((c) => c.clipId !== lastClipId && c.durationSec >= neededSec) ??
      ordered.find((c) => c.durationSec >= neededSec) ??
      ordered.reduce((a, b) => (a.durationSec >= b.durationSec ? a : b));
    // A continued shot picks up exactly where the previous one stopped (the cursor keeps a 0.3 s gap otherwise).
    const startCursor = continued ? (clipCursor.get(clip.clipId) ?? 0.3) - 0.3 : clipCursor.get(clip.clipId) ?? Math.min(0.5, clip.durationSec * 0.08);
    let inSec = startCursor;
    if (inSec + neededSec > clip.durationSec - 0.15) inSec = Math.max(0.1, clip.durationSec - 0.15 - neededSec);
    const outSec = Math.min(clip.durationSec - 0.05, inSec + neededSec);
    clipCursor.set(clip.clipId, outSec + 0.3);
    const kind = nextMove(opts.move);
    lastMove = kind;
    lastClipId = clip.clipId;
    const shot: FootageShot = {
      kind: 'footage',
      id: `shot-${++shotCounter}`,
      sceneId: span.scene.id,
      from: toF(fromSec),
      duration: toF(toSec) - toF(fromSec),
      transitionIn: 'cut',
      transitionOut: 'cut',
      src: '',
      source: {clipId: clip.clipId, file: clip.file, inSec: round3(inSec), outSec: round3(outSec), width: clip.width, height: clip.height, fps: clip.fps},
      playbackRate,
      camera: makeMove(kind, durSec, opts.intensity, opts.layer === 'background' ? 0 : ad.motion.handheld),
      layer: opts.layer,
      mezzanine: null,
    };
    shots.push(shot);
    return shot;
  };

  // The end card arrives with the last clause of the call to action ("… le lien est dans ma bio"):
  // before it, the CTA's own shot plays sharp under the captions, so the close is not a still card,
  // and every word said before the link is captioned.
  const ctaSpan = spans.find((s) => s.scene.phase === 'cta') ?? spans[spans.length - 1]!;
  const lienAt = findSpokenTime('lien', ctaSpan.words) ?? findSpokenTime('formule', ctaSpan.words);
  const cardSec = lienAt ? Math.max(ctaSpan.startSec, Math.min(ctaSpan.endSec - 2.2, lienAt.time - 0.2)) : ctaSpan.startSec;

  for (const span of spans) {
    const {scene} = span;
    const sceneFrom = toF(span.startSec);
    const sceneTo = toF(span.endSec);
    const target = TARGET_SHOT[ad.motion.pacing][scene.phase];

    const demoIds = scene.visual.captureIds?.length ? scene.visual.captureIds : scene.visual.captureId ? [scene.visual.captureId] : [];
    if (scene.visual.kind === 'demo' && demoIds.length) {
      const caps = demoIds.map((id) => {
        const c = input.captures.find((x) => x.id === id);
        if (!c) throw new Error(`Capture introuvable : ${id} (scène ${scene.id}).`);
        return c;
      });
      // Several captures play one after the other, each from the word that names it (evenly spaced otherwise).
      const starts = caps.map((_, i) => {
        if (i === 0) return span.startSec;
        const cue = scene.visual.captureCues?.[i];
        const hit = cue ? findCueTime(cue, span.words) ?? findSpokenTime(cue, span.words) : null;
        return hit ? hit.time - 0.12 : span.startSec + (i * (span.endSec - span.startSec)) / caps.length;
      });
      for (let i = 1; i < starts.length; i++) starts[i] = Math.min(span.endSec - 0.6, Math.max(starts[i]!, starts[i - 1]! + 0.8));
      caps.forEach((capture, i) => {
        const segStart = starts[i]!;
        const segEnd = i + 1 < caps.length ? starts[i + 1]! : span.endSec;
        const fromF = toF(segStart) === toF(span.startSec) ? sceneFrom : toF(segStart);
        const endF = i + 1 < caps.length ? toF(starts[i + 1]!) : sceneTo;
        const maxF = capture.type === 'video' && capture.durationSec ? toF(capture.durationSec) : Number.POSITIVE_INFINITY;
        const durF = Math.min(endF - fromF, maxF);
        const segSpan: SceneSpan = {...span, startSec: segStart, endSec: segEnd, words: span.words.filter((w) => w.start >= segStart - 0.05 && w.start < segEnd)};
        const plan = focusPlan(capture, scene, segSpan, durF);
        shots.push({
          kind: 'capture',
          id: `shot-${++shotCounter}`,
          sceneId: scene.id,
          from: fromF,
          duration: durF,
          transitionIn: 'cut',
          transitionOut: 'cut',
          src: `capture-${capture.id}${capture.file.slice(capture.file.lastIndexOf('.'))}`,
          mediaType: capture.type,
          width: capture.width,
          height: capture.height,
          keyframes: plan.keyframes,
          highlights: plan.highlights,
          // Clean studio background: blurred unrelated footage behind the capture distracted from it.
          backgroundSrc: null,
          captureId: capture.id,
          // A public page (prices…) always shows where and when it was captured.
          stamp:
            capture.source === 'public-page' && capture.sourceUrl
              ? `${capture.sourceUrl.replace(/^https?:\/\//, '')} · capture du ${capture.capturedAt.slice(8, 10)}/${capture.capturedAt.slice(5, 7)}/${capture.capturedAt.slice(0, 4)}`
              : undefined,
        });
        if (durF < endF - fromF) {
          // The recording is shorter than the narration: finish its part of the scene on real footage.
          pushFootage(span, (fromF + durF) / FPS, endF / FPS, {layer: 'full', intensity: 0.7});
        }
      });
    } else if (scene.visual.kind === 'graphic' || scene.phase === 'cta') {
      const own = input.clipsByScene[scene.id] ?? [];
      const bgFrom = span === ctaSpan ? cardSec : span.startSec;
      const sharpLead = bgFrom - span.startSec >= 0.5;
      if (sharpLead) pushFootage(span, span.startSec, bgFrom, {layer: 'full', intensity: 0.8});
      const sceneSec = span.endSec - bgFrom;
      const stepsCuts = (() => {
        // A path told step by step: each step brings its own sharp shot, cut on the word that names it.
        if (scene.visual.graphic?.type !== 'steps' || own.length < 2 || sharpLead) return null;
        const at = revealTimes(scene, span)
          .slice(1)
          .map((t) => span.startSec + 3 / FPS + t)
          .filter((t) => t > bgFrom + 0.6 && t < span.endSec - 0.6);
        return at.length ? [bgFrom, ...at, span.endSec] : null;
      })();
      // Behind a card, one long calm shot reads better than cuts when a single clip covers it.
      const cuts =
        stepsCuts ??
        (sharpLead || (own.length === 1 && own[0]!.durationSec >= sceneSec + 0.8) ? [bgFrom, span.endSec] : planCuts({...span, startSec: bgFrom}, target * 1.6, rng));
      // Chips that merge carry their own dark backing: the shot behind them stays sharp (a card keeps the blur);
      // steps cut with the voice stay sharp too.
      const sharp = scene.visual.graphic?.type === 'stack-merge' || stepsCuts !== null;
      for (let i = 0; i < cuts.length - 1; i++) {
        pushFootage(span, cuts[i]!, cuts[i + 1]!, {
          layer: sharp ? 'full' : 'background',
          intensity: 0.6,
          move: scene.phase === 'cta' ? 'pull-out' : undefined,
          continueClip: sharpLead && i === 0,
        });
      }
      if (scene.visual.kind === 'graphic' && scene.visual.graphic) {
        const reveals = revealTimes(scene, span);
        const g = scene.visual.graphic;
        // A price on screen always carries its verification date (cards, comparisons).
        const factId = g.type === 'price' || g.type === 'stat' ? g.factId : scene.claimFactIds.find((id) => id.includes('price'));
        graphics.push({
          id: `graphic-${scene.id}`,
          sceneId: scene.id,
          from: sceneFrom + 3,
          duration: Math.max(20, sceneTo - sceneFrom - 3),
          graphic: g,
          revealAt: reveals.map((t) => toF(t)),
          verifiedOn: factId ? factById.get(factId)?.verifiedAt?.slice(0, 10) ?? undefined : undefined,
        });
        reveals.forEach((t, i) => {
          sfx.push({src: g.type === 'stack-merge' && i === reveals.length - 1 ? 'sfx-whoosh-soft.wav' : 'sfx-tick.wav', from: sceneFrom + 3 + toF(t), gainDb: -21});
        });
      }
    } else {
      const intensity = scene.phase === 'hook' ? 1.15 : 0.9;
      const cuts = planCuts(span, target, rng);
      for (let i = 0; i < cuts.length - 1; i++) {
        const first = span.index === 0 && i === 0;
        pushFootage(span, cuts[i]!, cuts[i + 1]!, {layer: 'full', intensity: first ? 1.2 : intensity, move: first ? 'push-in' : undefined});
      }
    }

    if (scene.headline && scene.phase !== 'cta') {
      // Over a graphic scene the headline only fills the wait before the card, which then answers it.
      const card = scene.visual.kind === 'graphic' ? graphics.find((g) => g.sceneId === scene.id) : undefined;
      const untilCard = card ? card.from + (card.revealAt[0] ?? 0) + 6 - (sceneFrom + 4) : 0;
      if (scene.visual.kind !== 'graphic' || untilCard >= 24) {
        headlines.push({
          id: `headline-${scene.id}`,
          sceneId: scene.id,
          // The opening headline starts on the very first frame: the hook is readable at once.
          from: sceneFrom + (span.index === 0 ? 0 : 4),
          duration: card ? untilCard : Math.max(24, sceneTo - sceneFrom - (span.index === 0 ? 2 : 6)),
          text: scene.headline,
          emphasis: scene.emphasis,
        });
      }
    }
  }

  // Signature transitions at narrative turns (hook → pain → answer → close), capped.
  let stylized = 0;
  let lastStylizedFrame = -1000;
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1]!;
    const b = shots[i]!;
    if (a.sceneId === b.sceneId) continue;
    const pa = script.scenes.find((s) => s.id === a.sceneId)!.phase;
    const pb = script.scenes.find((s) => s.id === b.sceneId)!.phase;
    if (PHASE_GROUP[pa] === PHASE_GROUP[pb]) continue;
    if (stylized >= MAX_STYLIZED_TRANSITIONS || b.from - lastStylizedFrame < 120) continue;
    const t: TransitionKind = ad.motion.signature;
    b.transitionIn = t;
    if (t === 'whip-left' || t === 'whip-right' || t === 'whip-up') {
      a.transitionOut = t;
      // The incoming shot starts under the outgoing one: a push with no black frame between them.
      b.from -= WHIP_FRAMES;
      b.duration += WHIP_FRAMES;
    }
    if (t === 'blur-dissolve') a.duration += DISSOLVE_FRAMES;
    stylized++;
    lastStylizedFrame = b.from;
    const sfxName = t === 'zoom-punch' ? 'sfx-impact-soft.wav' : t === 'blur-dissolve' ? 'sfx-whoosh-soft.wav' : 'sfx-whoosh-fast.wav';
    sfx.push({src: sfxName, from: Math.max(0, b.from - (t === 'zoom-punch' ? 1 : 6)), gainDb: t === 'blur-dissolve' ? -22 : -17});
  }

  const endCardFrom = toF(cardSec);
  if (ad.motion.riserBeforeCta && endCardFrom > 60) sfx.push({src: 'sfx-riser.wav', from: endCardFrom - 36, gainDb: -24});
  sfx.push({src: 'sfx-whoosh-soft.wav', from: Math.max(0, endCardFrom - 4), gainDb: -23});

  const captions = buildCaptions(spans, ad, endCardFrom);

  const music: AudioClip | null = input.music
    ? {src: input.music.src, from: 0, gainDb: volumeCurve(words, totalF, config.music.underVoiceDb, config.music.openDb)}
    : null;

  const timeline: Timeline = {
    version: 1,
    runId: input.runId,
    fps: FPS,
    width: config.render.width,
    height: config.render.height,
    durationInFrames: totalF,
    seed,
    artDirection: ad,
    shots,
    graphics,
    headlines,
    captions,
    endCard: {
      from: endCardFrom,
      duration: totalF - endCardFrom,
      kicker: config.brand.name,
      headline: script.cta.onScreen,
      subline: script.cta.subline,
      // A price in the end card carries its verification date.
      verifiedOn: /€/.test(script.cta.subline)
        ? (() => {
            const ids = ctaSpan.scene.claimFactIds.filter((id) => id.includes('price'));
            return ids.map((id) => factById.get(id)?.verifiedAt?.slice(0, 10)).find(Boolean) ?? undefined;
          })()
        : undefined,
      cta: 'Lien en bio',
      disclosure: `${config.affiliate.disclosureBadge} · lien affilié`,
    },
    disclosure: {text: config.affiliate.disclosureBadge},
    audio: {voice: {src: input.voiceSrc, from: 0, gainDb: 0}, music, sfx: sfx.filter((s) => s.from < totalF - 6)},
    scenes: spans.map((s) => ({id: s.scene.id, phase: s.scene.phase, from: toF(s.startSec), to: toF(s.endSec)})),
    metrics: {} as Timeline['metrics'],
  };
  timeline.metrics = computeMetrics(timeline);
  return timeline;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function computeMetrics(t: Timeline): Timeline['metrics'] {
  const footage = t.shots.filter((s): s is FootageShot => s.kind === 'footage');
  const visible = footage.filter((s) => s.layer === 'full');
  const lens = (visible.length ? visible : footage).map((s) => s.duration / t.fps);
  const violations: string[] = [];
  const lineH = (size: number) => size * 1.12;
  for (const c of t.captions) {
    const text = c.words.map((w) => w.text).join(' ');
    const size = t.artDirection.caption.size;
    const lines = Math.ceil((text.length * size * 0.56) / (SAFE_AREA.right - SAFE_AREA.left));
    const half = (lines * lineH(size)) / 2;
    if (lines > 2) violations.push(`sous-titre sur ${lines} lignes : « ${text} »`);
    if (c.y - half < SAFE_AREA.top || c.y + half > SAFE_AREA.bottom) violations.push(`sous-titre hors zone sûre : « ${text} »`);
  }
  for (const h of t.headlines) {
    if (h.text.length > 42) violations.push(`titre trop long : « ${h.text} »`);
  }
  const ups = footage.map((s) => upscaleOf({width: s.source.width, height: s.source.height}, s.camera, t.height, t.width));
  return {
    durationSec: Math.round((t.durationInFrames / t.fps) * 100) / 100,
    shotCount: t.shots.length,
    footageShotCount: footage.length,
    avgShotSec: lens.length ? Math.round((lens.reduce((a, b) => a + b, 0) / lens.length) * 100) / 100 : 0,
    minShotSec: lens.length ? Math.round(Math.min(...lens) * 100) / 100 : 0,
    maxShotSec: lens.length ? Math.round(Math.max(...lens) * 100) / 100 : 0,
    distinctClips: new Set(footage.map((s) => s.source.clipId)).size,
    stylizedTransitions: t.shots.filter((s) => s.transitionIn !== 'cut').length,
    captionGroups: t.captions.length,
    maxCaptionChars: Math.max(0, ...t.captions.map((c) => c.words.map((w) => w.text).join(' ').length)),
    maxUpscale: ups.length ? Math.round(Math.max(...ups) * 100) / 100 : null,
    safeZoneViolations: violations,
  };
}
