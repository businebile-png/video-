import type {Db} from '../core/db.js';
import {mean, round} from '../core/text.js';
import {id as newId, parseJson} from '../core/util.js';

export interface Trend {
  platform: string;
  kind: 'hashtag' | 'topic' | 'hook_type';
  label: string;
  recent_n: number;
  previous_n: number;
  recent_share: number;
  previous_share: number;
  growth: number;
  mean_score: number;
  status: 'emergente' | 'en hausse' | 'stable' | 'en baisse' | 'nouvelle';
}

/**
 * Compares the last `recentDays` with the `previousDays` before them: share of posts carrying a hashtag,
 * topic or hook type. A label is "émergente" when it appears in at least 3 recent posts and its share grew by
 * 50 % or more (or did not exist before). Needs dated posts; undated ones are ignored.
 */
export function detectTrends(db: Db, now = new Date(), recentDays = 21, previousDays = 120): Trend[] {
  const rows = db.all("SELECT platform, published_at, topic, hook_type, hashtags_json, score FROM posts WHERE is_own = 0 AND published_at IS NOT NULL");
  const t0 = now.getTime() - recentDays * 86_400_000;
  const t1 = t0 - previousDays * 86_400_000;
  const out: Trend[] = [];
  for (const platform of [...new Set(rows.map((r) => r.platform))]) {
    const list = rows.filter((r) => r.platform === platform);
    const recent = list.filter((r) => new Date(r.published_at).getTime() >= t0);
    const previous = list.filter((r) => {
      const t = new Date(r.published_at).getTime();
      return t >= t1 && t < t0;
    });
    if (recent.length < 5) continue;
    const kinds: Array<[Trend['kind'], (r: any) => string[]]> = [
      ['hashtag', (r) => parseJson<string[]>(r.hashtags_json, [])],
      ['topic', (r) => (r.topic ? [r.topic] : [])],
      ['hook_type', (r) => (r.hook_type ? [r.hook_type] : [])],
    ];
    for (const [kind, get] of kinds) {
      const count = (items: any[]) => {
        const m = new Map<string, any[]>();
        for (const r of items) for (const v of get(r)) m.set(v, [...(m.get(v) ?? []), r]);
        return m;
      };
      const rc = count(recent);
      const pc = count(previous);
      for (const [label, items] of rc) {
        const rn = items.length;
        const pn = pc.get(label)?.length ?? 0;
        if (rn < 2) continue;
        const rs = rn / recent.length;
        const ps = previous.length ? pn / previous.length : 0;
        const growth = ps > 0 ? (rs - ps) / ps : rs > 0 ? 1 : 0;
        const status: Trend['status'] =
          pn === 0 && rn >= 3 ? 'nouvelle' : rn >= 3 && growth >= 0.5 ? 'emergente' : growth >= 0.2 ? 'en hausse' : growth <= -0.3 ? 'en baisse' : 'stable';
        out.push({platform, kind, label, recent_n: rn, previous_n: pn, recent_share: round(rs, 3), previous_share: round(ps, 3), growth: round(growth, 2), mean_score: round(mean(items.map((i) => i.score ?? 50)), 1), status});
      }
    }
  }
  return out.sort((a, b) => b.growth * Math.log(1 + b.recent_n) - a.growth * Math.log(1 + a.recent_n));
}

export function saveTrends(db: Db, trends: Trend[]): void {
  const now = new Date().toISOString();
  db.tx(() => {
    db.run('DELETE FROM trends');
    for (const t of trends) db.upsert('trends', {id: newId('trend'), ...t, detected_at: now});
  });
}

export function loadTrends(db: Db, limit = 50) {
  return db.all("SELECT * FROM trends ORDER BY CASE status WHEN 'emergente' THEN 0 WHEN 'nouvelle' THEN 1 WHEN 'en hausse' THEN 2 ELSE 3 END, growth DESC LIMIT ?", limit);
}
