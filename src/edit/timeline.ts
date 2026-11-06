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
const END_HOLD_SEC = 1.6;
const DISSOLVE_FRAMES = 8;
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
    if (tokens.some((t) => wn === t || (wn.length >= 5 && t.length >= 5 && (wn.startsWith(t.slice(0, 5)) || t.startsWith(wn.slice(0, 5)))))) {
      return {time: w.start, index: w.index};
    }
  }
  return null;
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
    const chips = g.items.map((_, i) => 0.25 + (i * (chipsEnd - 0.25)) / Math.max(1, g.items.length - 1));
    const merge = findSpokenTime(g.result, span.words);
    const mergeAt = merge ? Math.max(chipsEnd + 0.4, merge.time - span.startSec - 0.15) : usable * 0.6;
    return [...chips, Math.min(mergeAt, usable)];
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
    span.words.forEach((w, i) => {
      const prev = span.words[i - 1];
      const chars = current.reduce((n, c) => n + c.text.length + 1, 0) + w.text.length;
      const pause = Boolean(prev && w.start - prev.end > 0.35);
      if (current.length > 0 && (current.length >= ad.caption.maxWords || chars > ad.caption.maxChars || pause)) {
        if (pause) flush();
        else {
          // Carry trailing articles/prepositions over to the next group, where their noun is; a group made only
          // of such words grows by one word instead of being shown alone ("dans un" + "seul").
          let keep = current.length;
          while (keep > 0 && LEANING_WORDS.has(bare(current[keep - 1]!.text))) keep--;
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
  const regions = scene.visual.focusRegionIds
    .map((id) => capture.focusRegions.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  const keyframes: CaptureShot['keyframes'] = [{at: 0, focus: null}];
  const highlights: CaptureShot['highlights'] = [];
  let after = -1;
  regions.forEach((r, i) => {
    const hit = findSpokenTime(r.label, span.words, after);
    const fallback = 0.3 + (i + 1) * ((span.endSec - span.startSec) / (regions.length + 1)) * 0.8;
    const atSec = hit ? Math.max(0.5, hit.time - span.startSec - 0.2) : fallback;
    if (hit) after = hit.index;
    const at = Math.min(durationF - 20, Math.max(12, toF(atSec)));
    const region: Region = {x: r.x, y: r.y, w: r.w, h: r.h};
    keyframes.push({at, focus: region});
    highlights.push({from: at + 10, duration: 0, region, label: r.label});
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

  const pushFootage = (span: SceneSpan, fromSec: number, toSec: number, opts: {layer: 'full' | 'background'; intensity: number; move?: CameraMoveKind}) => {
    const pool = input.clipsByScene[span.scene.id] ?? [];
    const fallbackPool = Object.values(input.clipsByScene).flat();
    // A lone clip cannot alternate: borrow from other scenes rather than jump-cut inside one clip.
    const candidates = pool.length >= 2 ? pool : [...pool, ...fallbackPool.filter((c) => !pool.some((p) => p.clipId === c.clipId))];
    if (candidates.length === 0) throw new Error(`Aucune séquence vidéo disponible pour la scène ${span.scene.id}.`);
    const durSec = toSec - fromSec;
    const playbackRate = ad.motion.pacing === 'calm' && span.scene.phase !== 'hook' ? 0.9 : 1;
    const neededSec = durSec * playbackRate + 0.35;
    const ordered = [...candidates].sort((a, b) => (clipCursor.get(a.clipId) ?? 0) - (clipCursor.get(b.clipId) ?? 0));
    const clip =
      ordered.find((c) => c.clipId !== lastClipId && c.durationSec - (clipCursor.get(c.clipId) ?? c.durationSec * 0.08) >= neededSec) ??
      ordered.find((c) => c.clipId !== lastClipId && c.durationSec >= neededSec) ??
      ordered.find((c) => c.durationSec >= neededSec) ??
      ordered.reduce((a, b) => (a.durationSec >= b.durationSec ? a : b));
    const startCursor = clipCursor.get(clip.clipId) ?? Math.min(0.5, clip.durationSec * 0.08);
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

  for (const span of spans) {
    const {scene} = span;
    const sceneFrom = toF(span.startSec);
    const sceneTo = toF(span.endSec);
    const target = TARGET_SHOT[ad.motion.pacing][scene.phase];

    if (scene.visual.kind === 'demo' && scene.visual.captureId) {
      const capture = input.captures.find((c) => c.id === scene.visual.captureId);
      if (!capture) throw new Error(`Capture introuvable : ${scene.visual.captureId} (scène ${scene.id}).`);
      const maxF = capture.type === 'video' && capture.durationSec ? toF(capture.durationSec) : Number.POSITIVE_INFINITY;
      const durF = Math.min(sceneTo - sceneFrom, maxF);
      const plan = focusPlan(capture, scene, span, durF);
      const bgClip = (input.clipsByScene[scene.id] ?? [])[0];
      shots.push({
        kind: 'capture',
        id: `shot-${++shotCounter}`,
        sceneId: scene.id,
        from: sceneFrom,
        duration: durF,
        transitionIn: 'cut',
        transitionOut: 'cut',
        src: `capture-${capture.id}${capture.file.slice(capture.file.lastIndexOf('.'))}`,
        mediaType: capture.type,
        width: capture.width,
        height: capture.height,
        keyframes: plan.keyframes,
        highlights: plan.highlights,
        backgroundSrc: bgClip ? `bg-${bgClip.clipId}.mp4` : null,
        captureId: capture.id,
      });
      if (durF < sceneTo - sceneFrom) {
        // The recording is shorter than the narration: finish the scene on real footage.
        pushFootage(span, (sceneFrom + durF) / FPS, span.endSec, {layer: 'full', intensity: 0.7});
      }
    } else if (scene.visual.kind === 'graphic' || scene.phase === 'cta') {
      const own = input.clipsByScene[scene.id] ?? [];
      const sceneSec = span.endSec - span.startSec;
      // Behind a card, one long calm shot reads better than cuts when a single clip covers it.
      const cuts = own.length === 1 && own[0]!.durationSec >= sceneSec + 0.8 ? [span.startSec, span.endSec] : planCuts(span, target * 1.6, rng);
      for (let i = 0; i < cuts.length - 1; i++) {
        pushFootage(span, cuts[i]!, cuts[i + 1]!, {layer: 'background', intensity: 0.6, move: scene.phase === 'cta' ? 'pull-out' : undefined});
      }
      if (scene.visual.kind === 'graphic' && scene.visual.graphic) {
        const reveals = revealTimes(scene, span);
        const g = scene.visual.graphic;
        const factId = g.type === 'price' || g.type === 'stat' ? g.factId : undefined;
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

    if (scene.headline && scene.visual.kind !== 'graphic' && scene.phase !== 'cta') {
      headlines.push({
        id: `headline-${scene.id}`,
        sceneId: scene.id,
        from: sceneFrom + 4,
        duration: Math.max(24, sceneTo - sceneFrom - 6),
        text: scene.headline,
        emphasis: scene.emphasis,
      });
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
    if (t === 'whip-left' || t === 'whip-right' || t === 'whip-up') a.transitionOut = t;
    if (t === 'blur-dissolve') a.duration += DISSOLVE_FRAMES;
    stylized++;
    lastStylizedFrame = b.from;
    const sfxName = t === 'zoom-punch' ? 'sfx-impact-soft.wav' : t === 'blur-dissolve' ? 'sfx-whoosh-soft.wav' : 'sfx-whoosh-fast.wav';
    sfx.push({src: sfxName, from: Math.max(0, b.from - (t === 'zoom-punch' ? 1 : 6)), gainDb: t === 'blur-dissolve' ? -22 : -17});
  }

  const ctaSpan = spans.find((s) => s.scene.phase === 'cta') ?? spans[spans.length - 1]!;
  const endCardFrom = toF(ctaSpan.startSec);
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
