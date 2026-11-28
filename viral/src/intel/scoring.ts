import {clamp, median, percentileRank, round} from '../core/text.js';

/**
 * Virality score out of 100. Views alone never decide: the score blends
 *  - reach relative to the author's own usual reach (log ratio to the author's median),
 *  - engagement quality (weighted interactions per view, or per follower when views are missing),
 *  - conversation (comments per view) and shareability ((shares + saves) per view),
 *  - absolute scale, with a small weight,
 * each as a percentile within the same platform sample, then shrunk toward 50 when the evidence is thin
 * (few views, or an author with a single post in the sample).
 */

export interface ScoreInput {
  key: string;
  platform: string;
  author: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  followers: number | null;
}

export interface ScoreParts {
  relativeReach: number | null;
  engagement: number | null;
  conversation: number | null;
  shareability: number | null;
  scale: number | null;
  confidence: number;
  authorMedianViews: number | null;
  relativePerf: number | null;
  engagementRate: number | null;
}

export interface ScoreOutput {
  score: number;
  parts: ScoreParts;
}

export const WEIGHTS = {relativeReach: 0.3, engagement: 0.25, conversation: 0.15, shareability: 0.15, scale: 0.15};

const num = (x: number | null | undefined) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function interactions(p: ScoreInput): number {
  return (num(p.likes) ?? 0) + 2 * (num(p.comments) ?? 0) + 3 * (num(p.shares) ?? 0) + 2 * (num(p.saves) ?? 0);
}

export function scorePosts(posts: ScoreInput[]): Map<string, ScoreOutput> {
  const out = new Map<string, ScoreOutput>();
  const byPlatform = new Map<string, ScoreInput[]>();
  for (const p of posts) {
    const list = byPlatform.get(p.platform) ?? [];
    list.push(p);
    byPlatform.set(p.platform, list);
  }
  for (const list of byPlatform.values()) {
    const authorViews = new Map<string, number[]>();
    for (const p of list) {
      const v = num(p.views);
      if (v !== null && p.author) authorViews.set(p.author, [...(authorViews.get(p.author) ?? []), v]);
    }
    const rows = list.map((p) => {
      const v = num(p.views);
      const inter = interactions(p);
      const authorList = p.author ? authorViews.get(p.author) ?? [] : [];
      const authorMedian = authorList.length ? median(authorList) : null;
      const relLog = v !== null && authorMedian && authorMedian > 0 && authorList.length >= 2 ? Math.log2((v + 1) / (authorMedian + 1)) : null;
      const denom = v !== null && v > 0 ? v : num(p.followers) && p.followers! > 0 ? p.followers! : null;
      const er = denom ? inter / denom : null;
      const conv = v && v > 0 ? (num(p.comments) ?? 0) / v : null;
      const share = v && v > 0 ? ((num(p.shares) ?? 0) + (num(p.saves) ?? 0)) / v : null;
      const scaleLog = v !== null ? Math.log10(v + 1) : inter > 0 ? Math.log10(inter + 1) : null;
      return {p, v, authorMedian, authorN: authorList.length, relLog, er, conv, share, scaleLog};
    });
    const sorted = (xs: Array<number | null>) => xs.filter((x): x is number => x !== null).sort((a, b) => a - b);
    const ers = sorted(rows.map((r) => r.er));
    const convs = sorted(rows.map((r) => r.conv));
    const shares = sorted(rows.map((r) => r.share));
    const scales = sorted(rows.map((r) => r.scaleLog));
    for (const r of rows) {
      const parts: ScoreParts = {
        relativeReach: r.relLog === null ? null : 1 / (1 + Math.exp(-r.relLog)),
        engagement: r.er === null ? null : percentileRank(ers, r.er),
        conversation: r.conv === null ? null : percentileRank(convs, r.conv),
        shareability: r.share === null ? null : percentileRank(shares, r.share),
        scale: r.scaleLog === null ? null : percentileRank(scales, r.scaleLog),
        confidence: 0,
        authorMedianViews: r.authorMedian,
        relativePerf: r.v !== null && r.authorMedian ? round(r.v / r.authorMedian, 2) : null,
        engagementRate: r.er === null ? null : round(r.er * 100, 2),
      };
      let wsum = 0;
      let acc = 0;
      for (const [k, w] of Object.entries(WEIGHTS) as Array<[keyof typeof WEIGHTS, number]>) {
        const val = parts[k];
        if (val === null) continue;
        acc += w * val;
        wsum += w;
      }
      const raw = wsum > 0 ? acc / wsum : 0.5;
      // Evidence: views (or interactions) and how many posts we have from this author.
      const evidence = r.v ?? interactions(r.p) * 20;
      const confViews = evidence / (evidence + 300);
      const confAuthor = r.authorN >= 2 ? 1 : 0.6;
      const confidence = clamp(confViews * confAuthor, 0, 1);
      parts.confidence = round(confidence, 2);
      const score = 100 * (0.5 + (raw - 0.5) * confidence);
      out.set(r.p.key, {score: round(score, 1), parts});
    }
  }
  return out;
}

export function scoreLabel(score: number): string {
  if (score >= 80) return 'Très viral';
  if (score >= 65) return 'Performant';
  if (score >= 50) return 'Dans la moyenne';
  if (score >= 35) return 'Faible';
  return 'Très faible';
}
