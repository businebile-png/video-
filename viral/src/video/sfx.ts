import fs from 'node:fs';
import path from 'node:path';
import {PATHS, ensureDir} from '../core/paths.js';
import {rng} from '../core/util.js';
import type {MusicMood, Transition, VideoFormatId, WordTiming} from './types.js';
import {writeWav} from './wav.js';

/**
 * Sound effects, all synthesised here (no third-party file, nothing to license): whooshes and swooshes for
 * transitions and movement, light and cinematic impacts, riser, shimmer, tick, heartbeat, glitch, pop, and
 * three ambiences (air, tension, city). Placement keeps them out of the narration: cuts fall in the pauses,
 * effects are spaced, softened when they touch a word, and never stacked.
 */

export const SFX_NAMES = ['whoosh-up', 'whoosh-down', 'swoosh', 'impact-light', 'impact-cine', 'riser-cine', 'shimmer', 'tick-soft', 'heartbeat', 'glitch', 'pop-soft', 'amb-air', 'amb-tension', 'amb-city'] as const;
export type SfxName = (typeof SFX_NAMES)[number];

export const SFX_LABELS: Record<SfxName, string> = {
  'whoosh-up': 'Transition montante',
  'whoosh-down': 'Transition descendante',
  swoosh: 'Mouvement rapide',
  'impact-light': 'Impact léger',
  'impact-cine': 'Impact cinématique',
  'riser-cine': 'Montée de tension',
  shimmer: 'Scintillement (révélation)',
  'tick-soft': 'Tic (compte à rebours)',
  heartbeat: 'Battement de cœur (suspense)',
  glitch: 'Glitch numérique',
  'pop-soft': 'Pop',
  'amb-air': 'Ambiance : air de la pièce',
  'amb-tension': 'Ambiance : tension',
  'amb-city': 'Ambiance : ville au loin',
};

const SR = 48000;

function synth(name: SfxName): {data: Float32Array; channels: number} {
  const r = rng(name);
  const len = (s: number) => Math.floor(s * SR);
  const out = (n: number) => new Float32Array(n * 2);
  const put = (buf: Float32Array, i: number, l: number, rr: number) => {
    buf[i * 2] += l;
    buf[i * 2 + 1] += rr;
  };
  // Band-passed noise whose centre frequency follows a curve.
  const sweep = (seconds: number, f0: number, f1: number, env: (x: number) => number, gain: number) => {
    const n = len(seconds);
    const b = out(n);
    let lp1 = 0;
    let lp2 = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      const f = f0 * Math.pow(f1 / f0, x);
      const a = Math.min(0.99, (2 * Math.PI * f) / SR);
      const w = r() * 2 - 1;
      lp1 += a * (w - lp1);
      lp2 += a * (lp1 - lp2);
      const v = (lp1 - lp2) * env(x) * gain;
      const pan = 0.5 + 0.35 * Math.sin(Math.PI * (x - 0.5));
      put(b, i, v * (1 - pan) * 2, v * pan * 2);
    }
    return b;
  };
  switch (name) {
    case 'whoosh-up':
      return {data: sweep(0.7, 300, 5200, (x) => Math.pow(Math.sin(Math.PI * x), 1.6) * (0.3 + x), 3.2), channels: 2};
    case 'whoosh-down':
      return {data: sweep(0.7, 4800, 260, (x) => Math.pow(Math.sin(Math.PI * x), 1.4) * (1.2 - x * 0.6), 3.2), channels: 2};
    case 'swoosh':
      return {data: sweep(0.32, 900, 3600, (x) => Math.sin(Math.PI * x), 3.4), channels: 2};
    case 'impact-light': {
      const n = len(0.55);
      const b = out(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const v = Math.sin(2 * Math.PI * (70 + 90 * Math.exp(-t * 40)) * t) * Math.exp(-t * 11) * 0.8 + (r() * 2 - 1) * Math.exp(-t * 60) * 0.25;
        put(b, i, v, v);
      }
      return {data: b, channels: 2};
    }
    case 'impact-cine': {
      const n = len(2.2);
      const b = out(n);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        lp += 0.05 * (r() * 2 - 1 - lp);
        const v = Math.sin(2 * Math.PI * (36 + 50 * Math.exp(-t * 14)) * t) * Math.exp(-t * 2.1) * 0.9 + lp * Math.exp(-t * 3) * 1.4;
        put(b, i, v, v * 0.96);
      }
      return {data: b, channels: 2};
    }
    case 'riser-cine': {
      const n = len(1.8);
      const b = sweep(1.8, 200, 6000, (x) => Math.pow(x, 2.2), 2.4);
      for (let i = 0; i < n; i++) {
        const x = i / n;
        const v = Math.sin(2 * Math.PI * (110 + 330 * x * x) * (i / SR)) * Math.pow(x, 2) * 0.18;
        put(b, i, v, v);
      }
      return {data: b, channels: 2};
    }
    case 'shimmer': {
      const n = len(1.4);
      const b = out(n);
      for (let k = 0; k < 7; k++) {
        const f = [1568, 1760, 2093, 2349, 2637, 3136, 3520][k];
        const at = len(k * 0.06);
        const pan = k / 6;
        for (let i = 0; i < n - at; i++) {
          const t = i / SR;
          const v = Math.sin(2 * Math.PI * f * t + 1.5 * Math.exp(-t * 4) * Math.sin(2 * Math.PI * f * 2.01 * t)) * Math.exp(-t * 3.2) * 0.12;
          put(b, at + i, v * (1 - pan), v * pan);
        }
      }
      return {data: b, channels: 2};
    }
    case 'tick-soft': {
      const n = len(0.12);
      const b = out(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const v = Math.sin(2 * Math.PI * 2400 * t) * Math.exp(-t * 90) * 0.5 + Math.sin(2 * Math.PI * 1200 * t) * Math.exp(-t * 60) * 0.3;
        put(b, i, v, v);
      }
      return {data: b, channels: 2};
    }
    case 'heartbeat': {
      const n = len(1.0);
      const b = out(n);
      for (const [at, g] of [
        [0, 1],
        [0.26, 0.7],
      ] as const) {
        const s = len(at);
        for (let i = 0; i < len(0.3); i++) {
          const t = i / SR;
          const v = Math.sin(2 * Math.PI * (48 + 20 * Math.exp(-t * 30)) * t) * Math.exp(-t * 16) * g * 0.9;
          if (s + i < n) put(b, s + i, v, v);
        }
      }
      return {data: b, channels: 2};
    }
    case 'glitch': {
      const n = len(0.45);
      const b = out(n);
      let hold = 0;
      for (let i = 0; i < n; i++) {
        if (i % Math.floor(SR / (800 + 3000 * r())) === 0) hold = Math.round((r() * 2 - 1) * 4) / 4;
        const gate = Math.floor((i / n) * 9) % 2 === 0 ? 1 : 0.15;
        const v = hold * gate * Math.exp((-i / n) * 2) * 0.35;
        put(b, i, v, -v * 0.8);
      }
      return {data: b, channels: 2};
    }
    case 'pop-soft': {
      const n = len(0.18);
      const b = out(n);
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const v = Math.sin(2 * Math.PI * (380 + 600 * Math.exp(-t * 50)) * t) * Math.exp(-t * 28) * 0.6;
        put(b, i, v, v);
      }
      return {data: b, channels: 2};
    }
    default: {
      // Ambiences: 12 s loops.
      const n = len(12);
      const b = out(n);
      let p1 = 0;
      let p2 = 0;
      let br = 0;
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const w = r() * 2 - 1;
        p1 = 0.997 * p1 + 0.03 * w;
        p2 += 0.02 * (w - p2);
        br = 0.995 * br + 0.02 * w;
        let v = 0;
        if (name === 'amb-air') v = (p2 * 0.5 + p1 * 0.6) * 0.35;
        else if (name === 'amb-tension') v = (Math.sin(2 * Math.PI * 55 * t) + 0.6 * Math.sin(2 * Math.PI * 55.7 * t) + 0.3 * Math.sin(2 * Math.PI * 82.4 * t)) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.15 * t)) * 0.18 + p1 * 0.2;
        else v = br * 1.6 + (Math.sin(2 * Math.PI * 0.07 * t) > 0.92 ? p2 * 0.8 : 0);
        const edge = Math.min(1, t / 0.5, (12 - t) / 0.5);
        put(b, i, v * edge, v * edge * 0.95);
      }
      return {data: b, channels: 2};
    }
  }
}

/** Path of one effect, synthesised once and cached. */
export function sfxFile(name: SfxName): string {
  const dir = ensureDir(path.join(PATHS.var, 'cache', 'sfx'));
  const file = path.join(dir, `${name}.wav`);
  if (!fs.existsSync(file)) {
    const {data, channels} = synth(name);
    let peak = 1e-6;
    for (const x of data) peak = Math.max(peak, Math.abs(x));
    const g = 0.89 / peak;
    for (let i = 0; i < data.length; i++) data[i] *= g;
    writeWav(file, {sampleRate: SR, channels, data});
  }
  return file;
}

export interface SfxSettings {
  enabled: boolean;
  volume: number;
  ambience: boolean;
}

export interface SfxCue {
  file: string;
  at: number;
  gain: number;
  name: string;
  /** Ambience beds run under the whole video and are ducked with the music. */
  bed?: boolean;
  seconds?: number;
}

const TRANSITION_SFX: Record<Transition, SfxName> = {cube: 'whoosh-up', flip: 'whoosh-up', depth: 'whoosh-down', zoom: 'whoosh-down', swing: 'swoosh', whip: 'swoosh'};

/**
 * Where the effects go. Rules: one effect per cut (its peak on the cut, which sits in a pause), reveals get a light
 * impact, the product a shimmer, the call to action a riser then an impact; cinematic formats open on a hit;
 * suspense gets a heartbeat and a tension bed. Effects closer than 0.9 s are dropped; one touching a word is softened.
 */
export function placeSfx(o: {scenes: Array<{start: number; end: number; layout: string; role: string; speechStart: number; transition: Transition}>; words: WordTiming[]; duration: number; format: VideoFormatId; mood: MusicMood; settings: SfxSettings}): SfxCue[] {
  if (!o.settings.enabled) return [];
  const cues: Array<{name: SfxName; at: number; gain: number; bed?: boolean}> = [];
  const cinematic = ['cinematic', 'documentary', 'suspense', 'emotional'].includes(o.mood);
  if (cinematic) cues.push({name: 'impact-cine', at: 0.02, gain: 0.32});
  o.scenes.forEach((s, i) => {
    if (i > 0) cues.push({name: o.format === 'faits' && i % 3 === 0 ? 'glitch' : TRANSITION_SFX[s.transition] ?? 'swoosh', at: Math.max(0, s.start - 0.3), gain: 0.34});
    if (s.layout === 'number') cues.push({name: o.format === 'top5' || o.format === 'top10' ? 'tick-soft' : 'impact-light', at: s.start + 0.2, gain: 0.3});
    if (s.layout === 'compare') cues.push({name: 'pop-soft', at: s.start + 0.25, gain: 0.3});
    if (s.role === 'product') cues.push({name: 'shimmer', at: s.start + 0.45, gain: 0.26});
    if (s.role === 'cta') {
      cues.push({name: 'riser-cine', at: Math.max(0, s.start - 1.7), gain: 0.2});
      cues.push({name: cinematic ? 'impact-cine' : 'impact-light', at: s.start + 0.02, gain: 0.3});
    }
  });
  if (o.mood === 'suspense' && o.scenes[1]) cues.push({name: 'heartbeat', at: Math.max(0.4, o.scenes[1].start - 1.1), gain: 0.35});
  // Spacing: keep the first of two effects closer than 0.9 s (priority to what is already placed in time order).
  cues.sort((a, b) => a.at - b.at);
  const kept: typeof cues = [];
  for (const c of cues) if (!kept.length || c.at - kept[kept.length - 1].at >= 0.9 || c.name === 'riser-cine') kept.push(c);
  const speaking = (t0: number, t1: number) => o.words.some((w) => w.start < t1 && w.end > t0);
  const out: SfxCue[] = kept
    .filter((c) => c.at < o.duration - 0.3)
    .map((c) => ({name: c.name, file: sfxFile(c.name), at: Math.round(c.at * 1000) / 1000, gain: Math.round(c.gain * o.settings.volume * (speaking(c.at, c.at + 0.4) ? 0.6 : 1) * 1000) / 1000}));
  if (o.settings.ambience) {
    const bed: SfxName | null = o.mood === 'suspense' ? 'amb-tension' : ['documentary', 'cinematic'].includes(o.mood) || o.format === 'storytelling' ? 'amb-air' : null;
    if (bed) out.push({name: bed, file: sfxFile(bed), at: 0, gain: Math.round(0.22 * o.settings.volume * 1000) / 1000, bed: true, seconds: o.duration});
  }
  return out;
}
