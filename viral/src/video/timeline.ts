import path from 'node:path';
import {PATHS} from '../core/paths.js';
import {wordCount} from '../core/text.js';
import type {VideoFormatDef} from './formats.js';
import type {Aspect, SceneLayout, SceneRole, SceneText, Transition, VideoScene, VoiceTrack, WordTiming} from './types.js';

/**
 * The edit decision list of one video: when each scene starts and ends (on the narration, cuts snapped to the
 * music beat when a beat falls in the pause), which transition, which words to emphasise and when, the
 * captions (2 to 5 words, never across a cut), and the sound effects. Pure data: the page renders it, FFmpeg mixes it.
 */

export interface TimelineScene {
  i: number;
  role: SceneRole;
  layout: SceneLayout;
  start: number;
  end: number;
  /** When this scene's narration starts (text animations wait for it). */
  speechStart: number;
  transition: Transition;
  text: SceneText;
  emphasis: Array<{word: string; t: number}>;
  /** Kinetic text (no voice): one reveal time per word of the title. */
  reveal?: number[];
  media: {kind: 'motion' | 'stock' | 'image' | 'ai'; dir?: string; count?: number; fps?: number; framed?: boolean; image?: string};
}

export interface Caption {
  start: number;
  end: number;
  words: WordTiming[];
}

export interface Timeline {
  fps: number;
  width: number;
  height: number;
  aspect: Aspect;
  duration: number;
  voiceOffset: number;
  scenes: TimelineScene[];
  captions: Caption[];
  sfx: Array<{file: string; at: number; gain: number}>;
  beats: number[];
}

const LEAD = 0.22;
const T_IN = 0.5;
const VOICE_OFFSET = 0.15;

/** Groups the spoken words into short caption lines; a line never runs across a scene cut. */
export function buildCaptions(words: WordTiming[], cuts: number[], style: VideoFormatDef['captions']): Caption[] {
  const maxWords = style === 'bold' ? 3 : style === 'karaoke' ? 4 : 5;
  const maxChars = style === 'bold' ? 18 : style === 'karaoke' ? 24 : 30;
  const out: Caption[] = [];
  let cur: WordTiming[] = [];
  const flush = () => {
    if (cur.length) out.push({start: cur[0].start, end: cur[cur.length - 1].end, words: cur});
    cur = [];
  };
  for (const w of words) {
    const crossesCut = cur.length > 0 && cuts.some((c) => cur[0].start < c && w.start >= c - 0.05);
    const chars = cur.map((x) => x.text).join(' ').length + w.text.length + 1;
    if (crossesCut || cur.length >= maxWords || (cur.length && chars > maxChars)) flush();
    cur.push(w);
    if (/[.!?…:;]$/.test(w.text) || (/,$/.test(w.text) && cur.length >= 2)) flush();
  }
  flush();
  // Hold each line until the next one (short pauses), never more than 0.6 s after its last word.
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1]?.start ?? Infinity;
    out[i].end = Math.round(Math.min(next - 0.02, out[i].end + 0.6) * 1000) / 1000;
  }
  return out;
}

export interface TimelineInput {
  scenes: VideoScene[];
  def: VideoFormatDef;
  transitions: Transition[];
  voice?: VoiceTrack;
  beats: number[];
  fps: number;
  width: number;
  height: number;
  aspect: Aspect;
  targetSeconds: number;
  rand: () => number;
}

export function buildTimeline(inp: TimelineInput): Timeline {
  const n = inp.scenes.length;
  const starts: number[] = [];
  const speech: number[] = [];
  let duration: number;
  const words: WordTiming[] = [];
  if (inp.voice) {
    // Narration parts map 1:1 to scenes (every scene of a voiced format has narration).
    const parts = inp.voice.parts.map((p) => ({start: p.start + VOICE_OFFSET, end: p.end + VOICE_OFFSET}));
    for (const w of inp.voice.words) words.push({text: w.text, start: round(w.start + VOICE_OFFSET), end: round(w.end + VOICE_OFFSET)});
    for (let i = 0; i < n; i++) {
      speech[i] = parts[i]?.start ?? (parts[i - 1]?.end ?? 0) + 0.3;
      if (i === 0) {
        starts[i] = 0;
        continue;
      }
      const prevEnd = parts[i - 1]?.end ?? speech[i] - 0.3;
      let cut = speech[i] - LEAD;
      const beat = inp.beats.find((b) => b > prevEnd + 0.04 && b < speech[i] - 0.04);
      if (beat !== undefined) cut = beat;
      starts[i] = round(Math.max(prevEnd + 0.02, cut));
    }
    const lastEnd = parts[parts.length - 1]?.end ?? 3;
    duration = round(lastEnd + 1.7);
  } else {
    // No voice: reading time, scaled to the requested duration, cuts on the beat.
    const reading = inp.scenes.map((s) => {
      const w = wordCount([s.text.title, s.text.body, s.text.left, s.text.right, s.text.product?.body].filter(Boolean).join(' '));
      return Math.min(5.5, Math.max(2.2, 1.2 + w * 0.3 + (s.layout === 'compare' ? 1 : 0)));
    });
    const total = reading.reduce((a, b) => a + b, 0);
    const k = Math.min(1.35, Math.max(0.75, inp.targetSeconds / total));
    let t = 0;
    for (let i = 0; i < n; i++) {
      let s = t;
      if (i > 0) {
        const near = inp.beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), t);
        if (Math.abs(near - t) < 0.35) s = near;
      }
      starts[i] = round(s);
      speech[i] = round(s + 0.25);
      t = s + reading[i] * k;
    }
    duration = round(t + 0.6);
  }
  const cuts = starts.slice(1);
  const scenes: TimelineScene[] = inp.scenes.map((s, i) => {
    const end = i < n - 1 ? starts[i + 1] : duration;
    const mine = words.filter((w) => w.start >= starts[i] - 0.05 && w.start < end);
    const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const emphasis = s.emphasis
      .map((e) => {
        const hit = mine.find((w) => norm(w.text) === norm(e));
        return hit ? {word: e, t: hit.start} : null;
      })
      .filter(Boolean) as Array<{word: string; t: number}>;
    const titleWords = (s.text.title ?? '').split(/\s+/).filter(Boolean);
    const reveal = inp.voice ? undefined : titleWords.map((_, k) => round(speech[i] + k * Math.min(0.32, (end - speech[i] - 0.8) / Math.max(1, titleWords.length))));
    return {
      i,
      role: s.role,
      layout: s.layout,
      start: starts[i],
      end: round(end),
      speechStart: round(speech[i]),
      transition: i === 0 ? 'depth' : inp.transitions[(i + Math.floor(inp.rand() * inp.transitions.length)) % inp.transitions.length],
      text: s.text,
      emphasis,
      reveal,
      media: {kind: s.visual.mode === 'images' ? 'image' : s.visual.mode},
    };
  });
  const captions = inp.voice && inp.def.captions !== 'kinetic' ? buildCaptions(words, cuts, inp.def.captions) : [];
  const sfx = (name: string) => path.join(PATHS.assets, 'sfx', `${name}.wav`);
  const cues: Timeline['sfx'] = [];
  scenes.forEach((s, i) => {
    if (i > 0) cues.push({file: sfx(i % 2 ? 'whoosh-soft' : 'whoosh-fast'), at: Math.max(0, s.start - T_IN / 2), gain: 0.4});
    if (s.layout === 'number' || s.layout === 'compare') cues.push({file: sfx('pop'), at: s.start + 0.18, gain: 0.32});
    if (s.role === 'cta') {
      cues.push({file: sfx('riser'), at: Math.max(0, s.start - 1.1), gain: 0.25});
      cues.push({file: sfx('impact-soft'), at: s.start + 0.02, gain: 0.38});
    }
  });
  return {fps: inp.fps, width: inp.width, height: inp.height, aspect: inp.aspect, duration, voiceOffset: VOICE_OFFSET, scenes, captions, sfx: cues, beats: inp.beats.filter((b) => b < duration)};
}

const round = (x: number) => Math.round(x * 1000) / 1000;
