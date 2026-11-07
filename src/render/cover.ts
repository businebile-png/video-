import type {Timeline} from '../schemas/timeline.js';

/**
 * Cover frame, in seconds: the hook headline fully drawn and a whole caption line already spoken
 * (no word still greyed out). Used both for cover.jpg and for Metricool's videoCoverMilliseconds,
 * so the panel and the platforms show the same frame.
 */
export function coverTimeSec(t: Timeline): number {
  const head = t.headlines[0];
  // An opening that is complete on image 0 (headline and first shot): the cover is that image, before any
  // caption appears — never a half sentence.
  const firstCaption = t.captions[0]?.from ?? Number.POSITIVE_INFINITY;
  if (head && head.from === 0 && firstCaption >= 2) return Math.round((1 / t.fps) * 100) / 100;
  // Headline words rise one after another (2 frames apart) and settle in about 18 frames.
  const settled = head ? head.from + 2 * head.text.split(' ').filter(Boolean).length + 18 : Math.round(0.6 * t.fps);
  for (const g of t.captions) {
    const last = g.words[g.words.length - 1];
    if (!last || g.words.length < 2) continue; // a lone word ("ICI,") reads as a fragment
    const at = Math.max(settled, last.from + 4);
    if (at < g.to - 2) return Math.round((at / t.fps) * 100) / 100;
  }
  return Math.round(Math.min(1.2, t.durationInFrames / t.fps / 3) * 100) / 100;
}
