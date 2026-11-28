import type {AppConfig} from '../core/config.js';
import {platformSpec} from '../core/config.js';
import {truncate} from '../core/text.js';
import type {Slide} from './types.js';

/**
 * Caption per platform. Always starts with the advertising disclosure (« Publicité · Systeme.io »), then the hook,
 * a short summary of the slides, the call to action and a few relevant hashtags. Fits the platform's limits.
 */
export function buildCaption(cfg: AppConfig, opts: {platform: string; hook: string; slides: Slide[]; engagement: string; productSentence: string; hashtags: string[]}): string {
  const spec = platformSpec(cfg, opts.platform);
  const items = opts.slides.filter((s) => s.kind === 'item' || s.kind === 'compare' || s.kind === 'content');
  const summary = items
    .slice(0, 4)
    .map((s) => `→ ${s.title ?? s.right ?? s.left ?? ''}`.trim())
    .filter((l) => l.length > 2);
  const link = spec.linksClickable ? `${opts.productSentence.replace(/\s*:?\s*lien en bio\.?$/i, '')} : ${cfg.compliance.affiliateUrl}` : opts.productSentence;
  const tags = opts.hashtags.slice(0, spec.hashtagsRecommended).join(' ');
  const parts = (withSummary: number) =>
    [cfg.compliance.disclosure.captionPrefix, '', opts.hook, ...(withSummary ? ['', ...summary.slice(0, withSummary)] : []), '', opts.engagement, link, '', tags]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  for (let k = summary.length; k >= 0; k--) {
    const c = parts(k);
    if (c.length <= spec.captionMax) return c;
  }
  // Last resort (Threads, 500 characters): disclosure + hook + link, never dropping the disclosure.
  return truncate(`${cfg.compliance.disclosure.captionPrefix}\n\n${opts.hook}\n\n${link}`, spec.captionMax);
}

/** TikTok photo title: 90 characters, no hashtags or links. */
export function photoTitle(hook: string, max = 90): string {
  return truncate(hook.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/https?:\/\/\S+/g, '').trim(), max);
}

export function pickHashtags(cfg: AppConfig, topicHashtagKey: string, platform: string, product: boolean): string[] {
  const n = cfg.niche.hashtags;
  const spec = platformSpec(cfg, platform);
  const byTopic = n.byTopic[topicHashtagKey] ?? [];
  const list = [...byTopic, ...n.core, ...(product ? n.byTopic['systeme-io'] ?? [] : [])];
  const uniq = [...new Set(list.map((h) => h.toLowerCase()))];
  return uniq.slice(0, Math.max(1, spec.hashtagsRecommended));
}
