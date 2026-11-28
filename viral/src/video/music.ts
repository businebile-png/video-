import type {MusicMood} from './types.js';
import {writeWav} from './wav.js';
import {rng} from '../core/util.js';

/**
 * Original background music, synthesised note by note (no sample, no third-party track, so no rights to
 * clear): chords, plucked arpeggios (Karplus-Strong), FM bells, bass, drums made from sine sweeps and
 * filtered noise, a small stereo reverb and kick side-chain. Every video gets its own variation from its seed,
 * and the beat grid is returned so the editor can cut on the beat.
 */

interface Preset {
  bpm: number;
  root: number; // MIDI note of the key
  progressions: Array<Array<[number, 'M' | 'm' | 'M7' | 'm7']>>;
  pad: number;
  padCutoff: number;
  pluck: number;
  pluckEvery: 2 | 4; // notes per beat
  bell: number;
  bass: number;
  bassEvery: 1 | 2;
  kick: 'none' | 'half' | 'twoFour' | 'four';
  kickGain: number;
  clap: number;
  hat: number;
  hatEvery: 2 | 4;
  boom: number;
  pump: number;
  reverb: number;
}

const PRESETS: Record<MusicMood, Preset> = {
  warm: {bpm: 84, root: 65, progressions: [[[0, 'M7'], [9, 'm7'], [5, 'M7'], [7, 'M']], [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']]], pad: 0.16, padCutoff: 1400, pluck: 0.22, pluckEvery: 2, bell: 0, bass: 0.22, bassEvery: 1, kick: 'half', kickGain: 0.35, clap: 0.06, hat: 0, hatEvery: 2, boom: 0, pump: 0, reverb: 0.3},
  light: {bpm: 100, root: 60, progressions: [[[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']], [[0, 'M'], [5, 'M'], [9, 'm'], [7, 'M']]], pad: 0.1, padCutoff: 1800, pluck: 0.25, pluckEvery: 2, bell: 0.05, bass: 0.2, bassEvery: 2, kick: 'half', kickGain: 0.4, clap: 0.1, hat: 0.05, hatEvery: 2, boom: 0, pump: 0.15, reverb: 0.22},
  uplifting: {bpm: 122, root: 67, progressions: [[[9, 'm'], [5, 'M'], [0, 'M'], [7, 'M']], [[0, 'M'], [7, 'M'], [9, 'm'], [5, 'M']]], pad: 0.17, padCutoff: 2400, pluck: 0.2, pluckEvery: 4, bell: 0, bass: 0.26, bassEvery: 2, kick: 'four', kickGain: 0.55, clap: 0.16, hat: 0.07, hatEvery: 2, boom: 0, pump: 0.55, reverb: 0.2},
  corporate: {bpm: 108, root: 62, progressions: [[[0, 'M'], [4, 'm'], [5, 'M'], [7, 'M']], [[0, 'M'], [9, 'm'], [5, 'M'], [7, 'M']]], pad: 0.11, padCutoff: 1700, pluck: 0.24, pluckEvery: 2, bell: 0.04, bass: 0.22, bassEvery: 2, kick: 'twoFour', kickGain: 0.42, clap: 0.1, hat: 0.05, hatEvery: 4, boom: 0, pump: 0.25, reverb: 0.2},
  mysterious: {bpm: 90, root: 57, progressions: [[[0, 'm'], [8, 'M'], [5, 'm'], [7, 'M']], [[0, 'm'], [5, 'm'], [8, 'M'], [7, 'M']]], pad: 0.15, padCutoff: 900, pluck: 0.08, pluckEvery: 2, bell: 0.16, bass: 0.26, bassEvery: 1, kick: 'half', kickGain: 0.4, clap: 0.05, hat: 0.04, hatEvery: 4, boom: 0, pump: 0.1, reverb: 0.38},
  driving: {bpm: 124, root: 64, progressions: [[[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']], [[0, 'm'], [10, 'M'], [8, 'M'], [7, 'M']]], pad: 0.12, padCutoff: 1600, pluck: 0.14, pluckEvery: 4, bell: 0, bass: 0.3, bassEvery: 2, kick: 'four', kickGain: 0.58, clap: 0.15, hat: 0.08, hatEvery: 4, boom: 0, pump: 0.5, reverb: 0.15},
  cinematic: {bpm: 70, root: 62, progressions: [[[0, 'm'], [8, 'M'], [3, 'M'], [10, 'M']], [[0, 'm'], [5, 'm'], [8, 'M'], [7, 'M']]], pad: 0.22, padCutoff: 1100, pluck: 0.1, pluckEvery: 2, bell: 0.06, bass: 0.2, bassEvery: 1, kick: 'none', kickGain: 0, clap: 0, hat: 0, hatEvery: 2, boom: 0.5, pump: 0, reverb: 0.45},
  playful: {bpm: 112, root: 60, progressions: [[[0, 'M'], [9, 'm'], [2, 'm'], [7, 'M']], [[0, 'M'], [5, 'M'], [7, 'M'], [0, 'M']]], pad: 0.07, padCutoff: 2000, pluck: 0.27, pluckEvery: 2, bell: 0.06, bass: 0.24, bassEvery: 2, kick: 'twoFour', kickGain: 0.4, clap: 0.14, hat: 0.05, hatEvery: 2, boom: 0, pump: 0.2, reverb: 0.18},
  calm: {bpm: 76, root: 65, progressions: [[[0, 'M'], [4, 'm'], [9, 'm'], [5, 'M']], [[0, 'M7'], [5, 'M7'], [9, 'm7'], [7, 'M']]], pad: 0.18, padCutoff: 1200, pluck: 0.14, pluckEvery: 2, bell: 0.04, bass: 0.16, bassEvery: 1, kick: 'none', kickGain: 0, clap: 0, hat: 0, hatEvery: 2, boom: 0, pump: 0, reverb: 0.4},
};

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const INTERVALS = {M: [0, 4, 7], m: [0, 3, 7], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10]};

export interface MusicResult {
  file: string;
  mood: MusicMood;
  bpm: number;
  seconds: number;
  beats: number[];
  bars: number[];
  seed: number;
}

export function composeMusic(file: string, opts: {mood: MusicMood; seconds: number; seed: number; sampleRate?: number}): MusicResult {
  const p = PRESETS[opts.mood];
  const sr = opts.sampleRate ?? 48000;
  const rand = rng(opts.seed);
  const bpm = p.bpm + Math.round((rand() - 0.5) * 6);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const n = Math.ceil(opts.seconds * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const sendL = new Float32Array(n);
  const sendR = new Float32Array(n);
  const prog = p.progressions[Math.floor(rand() * p.progressions.length)];
  const transpose = [0, -2, 2, -3][Math.floor(rand() * 4)];
  const root = p.root + transpose;
  const bars = Math.ceil(opts.seconds / bar);
  const kickEnv = new Float32Array(n);

  const add = (buf: Float32Array, i: number, v: number) => {
    if (i >= 0 && i < n) buf[i] += v;
  };

  // Chords: detuned saws through a one-pole low-pass, slow attack, spread left / right.
  const chordAt = (b: number) => prog[b % prog.length];
  for (let b = 0; b < bars; b++) {
    const [deg, q] = chordAt(b);
    const notes = INTERVALS[q].map((iv, k) => root - 12 + deg + iv + (k === 0 ? 0 : 12));
    const s0 = Math.floor(b * bar * sr);
    const len = Math.floor(bar * sr * 1.08);
    const energy = b < 2 ? 0.7 : 1;
    if (p.pad > 0) {
      notes.forEach((m, k) => {
        for (const side of [-1, 1]) {
          const f = hz(m) * (1 + side * 0.0025);
          let ph = rand();
          let lp = 0;
          const a = Math.exp((-2 * Math.PI * p.padCutoff) / sr);
          for (let i = 0; i < len; i++) {
            ph += f / sr;
            ph -= Math.floor(ph);
            const saw = 2 * ph - 1;
            lp = (1 - a) * saw + a * lp;
            const t = i / sr;
            const env = Math.min(1, t / 0.35) * Math.min(1, (len / sr - t) / 0.3);
            const v = lp * env * p.pad * energy * 0.22;
            const pan = side < 0 ? 0.75 : 0.25;
            add(L, s0 + i, v * (1 - pan) * 2 * (k % 2 ? 0.9 : 1));
            add(R, s0 + i, v * pan * 2 * (k % 2 ? 1 : 0.9));
            if (i % 2 === 0) {
              add(sendL, s0 + i, v * 0.3);
              add(sendR, s0 + i, v * 0.3);
            }
          }
        }
      });
    }
    // Bass: rounded sine, root (and fifth) on the beat grid.
    if (p.bass > 0) {
      const steps = 4 * p.bassEvery;
      for (let s = 0; s < steps; s++) {
        if (b < 1 && s % 2) continue;
        const m = root - 24 + deg + (s % 4 === 3 && rand() < 0.4 ? 7 : 0);
        const f = hz(m);
        const st = s0 + Math.floor((s * bar * sr) / steps);
        const dur = Math.floor((bar / steps) * sr * 0.92);
        for (let i = 0; i < dur; i++) {
          const t = i / sr;
          const env = Math.min(1, t / 0.008) * Math.exp(-t * 3.2);
          const v = Math.tanh(1.6 * Math.sin(2 * Math.PI * f * t)) * env * p.bass * 0.55;
          add(L, st + i, v);
          add(R, st + i, v);
        }
      }
    }
    // Plucked arpeggio (Karplus-Strong string).
    if (p.pluck > 0 && b >= (opts.mood === 'cinematic' ? 2 : 0)) {
      const steps = 4 * p.pluckEvery;
      const arp = [...notes.map((m) => m + 12), notes[0] + 24];
      const pattern = rand() < 0.5 ? [0, 1, 2, 3, 2, 1, 0, 1] : [0, 2, 1, 3, 0, 2, 3, 1];
      for (let s = 0; s < steps; s++) {
        if (rand() < (opts.mood === 'cinematic' ? 0.55 : 0.12)) continue;
        const m = arp[pattern[s % pattern.length] % arp.length];
        const f = hz(m);
        const st = s0 + Math.floor((s * bar * sr) / steps);
        const period = Math.max(2, Math.round(sr / f));
        const ring = new Float32Array(period);
        for (let k = 0; k < period; k++) ring[k] = rand() * 2 - 1;
        const dur = Math.floor(sr * 0.9);
        const vel = (0.7 + rand() * 0.3) * p.pluck * 0.5;
        const pan = 0.3 + rand() * 0.4;
        let idx = 0;
        let prev = 0;
        for (let i = 0; i < dur; i++) {
          const cur = ring[idx];
          const next = 0.5 * (cur + ring[(idx + 1) % period]) * 0.996;
          ring[idx] = next;
          idx = (idx + 1) % period;
          const v = (cur * 0.6 + prev * 0.4) * vel * Math.exp(-i / sr * 2.2);
          prev = cur;
          add(L, st + i, v * (1 - pan));
          add(R, st + i, v * pan);
          add(sendL, st + i, v * 0.35);
          add(sendR, st + i, v * 0.35);
        }
      }
    }
    // FM bells on the chord tones (curiosity, mystery).
    if (p.bell > 0) {
      for (let s = 0; s < 4; s++) {
        if (rand() < 0.35) continue;
        const m = notes[Math.floor(rand() * notes.length)] + 24;
        const f = hz(m);
        const st = s0 + Math.floor(s * beat * sr);
        const dur = Math.floor(sr * 1.6);
        const pan = rand();
        for (let i = 0; i < dur; i++) {
          const t = i / sr;
          const env = Math.exp(-t * 2.6);
          const v = Math.sin(2 * Math.PI * f * t + 2.2 * env * Math.sin(2 * Math.PI * f * 3.5 * t)) * env * p.bell * 0.4;
          add(L, st + i, v * (1 - pan));
          add(R, st + i, v * pan);
          add(sendL, st + i, v * 0.5);
          add(sendR, st + i, v * 0.5);
        }
      }
    }
    // Cinematic boom at the start of every other bar.
    if (p.boom > 0 && b % 2 === 0 && b > 0) {
      const dur = Math.floor(sr * 2.2);
      for (let i = 0; i < dur; i++) {
        const t = i / sr;
        const f = 38 + 30 * Math.exp(-t * 9);
        const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 1.8) * p.boom * 0.7;
        add(L, s0 + i, v);
        add(R, s0 + i, v);
        add(sendL, s0 + i, v * 0.2);
        add(sendR, s0 + i, v * 0.2);
      }
    }
    // Drums.
    const breakBar = bars > 6 && b === Math.floor(bars * 0.6);
    if (!breakBar && b >= 1) {
      for (let s = 0; s < 4; s++) {
        const st = s0 + Math.floor(s * beat * sr);
        const kickHere = p.kick === 'four' || (p.kick === 'twoFour' && (s === 0 || s === 2)) || (p.kick === 'half' && s === 0);
        if (kickHere && p.kickGain > 0) {
          const dur = Math.floor(sr * 0.4);
          let ph = 0;
          for (let i = 0; i < dur; i++) {
            const t = i / sr;
            ph += (48 + 110 * Math.exp(-t * 30)) / sr;
            const v = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7.5) * p.kickGain * 0.8;
            add(L, st + i, v);
            add(R, st + i, v);
            if (st + i < n) kickEnv[st + i] = Math.max(kickEnv[st + i], Math.exp(-t * 6));
          }
        }
        if (p.clap > 0 && (s === 1 || s === 3)) {
          const dur = Math.floor(sr * 0.25);
          let bp1 = 0;
          let bp2 = 0;
          for (let i = 0; i < dur; i++) {
            const t = i / sr;
            const burst = t < 0.03 ? (Math.floor(t / 0.01) % 2 ? 0.6 : 1) : 1;
            const x = rand() * 2 - 1;
            bp1 += 0.35 * (x - bp1);
            bp2 += 0.35 * (bp1 - bp2);
            const v = (bp1 - bp2) * Math.exp(-t * 18) * burst * p.clap * 2.2;
            add(L, st + i, v * 0.9);
            add(R, st + i, v);
            add(sendL, st + i, v * 0.4);
            add(sendR, st + i, v * 0.4);
          }
        }
        if (p.hat > 0) {
          for (let h = 0; h < p.hatEvery; h++) {
            if (p.hatEvery === 2 && h === 0 && p.kick === 'four') continue;
            const hs = st + Math.floor(((h * beat) / p.hatEvery) * sr);
            const dur = Math.floor(sr * 0.05);
            const vel = (0.6 + rand() * 0.4) * p.hat;
            let last = 0;
            for (let i = 0; i < dur; i++) {
              const x = rand() * 2 - 1;
              const v = (x - last) * Math.exp((-i / sr) * 70) * vel;
              last = x;
              add(L, hs + i, v * 0.8);
              add(R, hs + i, v);
            }
          }
        }
      }
    }
  }

  // Side-chain pump, reverb (Schroeder: 4 combs + 2 all-pass per side), master, fades.
  if (p.pump > 0) for (let i = 0; i < n; i++) {
    const g = 1 - p.pump * 0.5 * kickEnv[i];
    L[i] *= g;
    R[i] *= g;
  }
  const reverb = (src: Float32Array, dst: Float32Array, offset: number) => {
    const combs = [1557, 1617, 1491, 1422].map((d) => ({buf: new Float32Array(Math.round(((d + offset) * sr) / 44100)), i: 0, lp: 0}));
    const aps = [225, 556].map((d) => ({buf: new Float32Array(Math.round(((d + offset) * sr) / 44100)), i: 0}));
    for (let k = 0; k < n; k++) {
      let s = 0;
      for (const c of combs) {
        const y = c.buf[c.i];
        c.lp = y * 0.8 + c.lp * 0.2;
        c.buf[c.i] = src[k] + c.lp * 0.82;
        c.i = (c.i + 1) % c.buf.length;
        s += y;
      }
      for (const a of aps) {
        const y = a.buf[a.i];
        const x = s + y * 0.5;
        a.buf[a.i] = x;
        a.i = (a.i + 1) % a.buf.length;
        s = y - x * 0.5;
      }
      dst[k] += s * p.reverb * 0.25;
    }
  };
  reverb(sendL, L, 0);
  reverb(sendR, R, 23);
  let peak = 1e-6;
  for (let i = 0; i < n; i++) {
    L[i] = Math.tanh(L[i] * 1.1);
    R[i] = Math.tanh(R[i] * 1.1);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const fadeIn = Math.floor(sr * 0.4);
  const fadeOut = Math.floor(sr * 1.6);
  const data = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const g = (0.89 / peak) * Math.min(1, i / fadeIn) * Math.min(1, (n - i) / fadeOut);
    data[i * 2] = L[i] * g;
    data[i * 2 + 1] = R[i] * g;
  }
  writeWav(file, {sampleRate: sr, channels: 2, data});
  const beats: number[] = [];
  for (let t = 0; t < opts.seconds; t += beat) beats.push(Math.round(t * 1000) / 1000);
  const barTimes = beats.filter((_, i) => i % 4 === 0);
  return {file, mood: opts.mood, bpm, seconds: opts.seconds, beats, bars: barTimes, seed: opts.seed};
}

export const MUSIC_MOODS = Object.keys(PRESETS) as MusicMood[];
