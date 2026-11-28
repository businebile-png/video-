import {placeSfx, type SfxCue, type SfxSettings} from './sfx.js';
import {wordCount} from '../core/text.js';
import type {VideoFormatDef} from './formats.js';
import type {Aspect, MusicMood, SceneLayout, SceneRole, SceneText, Transition, VideoFormatId, VideoScene, VoiceTrack, WordTiming} from './types.js';

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
  sfx: SfxCue[];
  beats: number[];
}

const LEAD = 0.22;
const T_IN = 0.5;
const VOICE_OFFSET = 0.15;

/** Words a caption line should not end on (the line would read as cut in the middle of a phrase). */
const WEAK = /^(le|la|les|l'|un|une|des|du|de|d'|à|au|aux|en|et|ou|mais|pour|par|sur|sous|dans|avec|sans|que|qu'|qui|ce|cet|cette|ces|ton|ta|tes|ton|son|sa|ses|mon|ma|mes|notre|votre|leur|leurs|ne|n'|se|s'|y|tu|je|il|elle|on|nous|vous|ils|elles|est|a|c'est|the|a|an|of|to|and|or|in|on|for|with|el|la|los|las|de|y|il|lo|gli|e|o)$/i;

const LIMITS: Record<string, {words: number; chars: number}> = {
  mot: {words: 1, chars: 40},
  tiktok: {words: 3, chars: 20},
  minimal: {words: 5, chars: 30},
  cinematique: {words: 4, chars: 26},
  phrase: {words: 12, chars: 64},
  documentaire: {words: 14, chars: 72},
  kinetic: {words: 3, chars: 20},
};

/**
 * Groups the spoken words into caption lines for a style: one word, a few words, or a whole sentence (split at
 * a comma when too long). A line never runs across a scene cut or a sentence end, and never ends on a small
 * word (« de », « la », « pour »…) that belongs with the next one.
 */
export function buildCaptions(words: WordTiming[], cuts: number[], style: string): Caption[] {
  const lim = LIMITS[style] ?? LIMITS.tiktok;
  const out: Caption[] = [];
  let cur: WordTiming[] = [];
  const flush = () => {
    if (cur.length) out.push({start: cur[0].start, end: cur[cur.length - 1].end, words: cur});
    cur = [];
  };
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    const crossesCut = cur.length > 0 && cuts.some((c) => cur[0].start < c && w.start >= c - 0.05);
    const chars = cur.map((x) => x.text).join(' ').length + w.text.length + 1;
    if (crossesCut || cur.length >= lim.words || (cur.length && chars > lim.chars)) {
      // Do not leave a small word dangling at the end of the line: carry it over.
      const carry: WordTiming[] = [];
      while (cur.length > 1 && WEAK.test(cur[cur.length - 1].text.replace(/[.,!?;:…]+$/, '')) && !crossesCut) carry.unshift(cur.pop()!);
      flush();
      cur = carry;
    }
    cur.push(w);
    const sentenceEnd = /[.!?…]$/.test(w.text);
    const pause = /[,:;]$/.test(w.text) && (style === 'phrase' || style === 'documentaire' ? chars > lim.chars * 0.55 : cur.length >= 2);
    if (sentenceEnd || pause) flush();
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
  captionStyle: string;
  mood: MusicMood;
  sfx: SfxSettings;
  format: VideoFormatId;
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
  const captions = inp.voice && inp.captionStyle !== 'kinetic' ? buildCaptions(words, cuts, inp.captionStyle) : [];
  const cues = placeSfx({scenes, words, duration, format: inp.format, mood: inp.mood, settings: inp.sfx});
  void T_IN;
  return {fps: inp.fps, width: inp.width, height: inp.height, aspect: inp.aspect, duration, voiceOffset: VOICE_OFFSET, scenes, captions, sfx: cues, beats: inp.beats.filter((b) => b < duration)};
}

const round = (x: number) => Math.round(x * 1000) / 1000;
