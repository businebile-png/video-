import {Easing, interpolate, spring} from 'remotion';

export const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const easeInOut = Easing.bezier(0.45, 0, 0.55, 1);
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeIn = Easing.bezier(0.55, 0, 1, 0.45);

export function progress(frame: number, start: number, duration: number, easing: (t: number) => number = (t) => t): number {
  return easing(interpolate(frame, [start, start + Math.max(1, duration)], [0, 1], clamp));
}

/** Snappy but not bouncy: the motion language of SaaS ads. */
export function pop(frame: number, fps: number, delay = 0): number {
  return spring({frame: frame - delay, fps, config: {damping: 18, stiffness: 180, mass: 0.7}});
}

export function soft(frame: number, fps: number, delay = 0): number {
  return spring({frame: frame - delay, fps, config: {damping: 200, stiffness: 120, mass: 0.9}});
}

export const dbToGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));

export function gainAt(points: Array<{frame: number; db: number}>, frame: number): number {
  if (points.length === 0) return 1;
  if (frame <= points[0]!.frame) return dbToGain(points[0]!.db);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (frame <= b.frame) {
      const t = (frame - a.frame) / Math.max(1, b.frame - a.frame);
      return dbToGain(lerp(a.db, b.db, t));
    }
  }
  return dbToGain(points[points.length - 1]!.db);
}
