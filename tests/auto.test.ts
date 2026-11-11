import {describe, expect, it} from 'vitest';
import {extractJson} from '../src/llm/client.js';
import {nextSlot, pickSlot, reliefNotNeeded} from '../src/auto/auto.js';
import {firstComment} from '../src/publish/publish.js';
import {viralChecklist} from '../src/script/viral.js';
import {matchPost, metricoolDate, parseTable, postKey} from '../src/analytics/metricool.js';
import {hookStyleIndex, videoPerformance} from '../src/analytics/analytics.js';
import {sampleScript} from './fixtures.js';

describe('production sans Claude', () => {
  it('lit le JSON d’une réponse d’IA, même entouré de texte ou de balises', () => {
    expect(extractJson<{a: number}>('Voici :\n```json\n{"a": 1}\n```')).toEqual({a: 1});
    expect(extractJson<{b: string}>('ok {"b": "x"} fin')).toEqual({b: 'x'});
    expect(() => extractJson('pas de json')).toThrow();
  });

  it('choisit le premier créneau libre à plus de 2 h', () => {
    const now = new Date('2026-11-09T05:00:00Z');
    const slots = [
      {iso: '2026-11-09T10:00:00+01:00', label: 'lundi 10:00'},
      {iso: '2026-11-09T20:00:00+01:00', label: 'lundi 20:00'},
    ];
    expect(pickSlot(slots, [], now)?.label).toBe('lundi 10:00');
    expect(pickSlot(slots, ['2026-11-09T09:00:00Z'], now)?.label).toBe('lundi 20:00');
    expect(pickSlot(slots, [], new Date('2026-11-09T08:30:00Z'))?.label).toBe('lundi 20:00');
  });
});

describe('relève par les IA gratuites', () => {
  it('ne produit que si ni une vidéo prête ni Claude ne tiennent le prochain créneau', () => {
    const now = new Date('2026-11-09T05:47:00Z');
    const slot = nextSlot([{iso: '2026-11-09T20:00:00+01:00', label: '20:00'}, {iso: '2026-11-09T10:00:00+01:00', label: '10:00'}], now)!;
    expect(slot.label).toBe('10:00');
    expect(reliefNotNeeded(slot, [], null, now)).toBeNull();
    expect(reliefNotNeeded(slot, ['2026-11-09T09:00:00Z'], null, now)).toMatch(/déjà prête/);
    expect(reliefNotNeeded(slot, [], {slot: {iso: '2026-11-09T10:00:00+01:00'}, startedAt: '2026-11-09T04:47:00Z'}, now)).toMatch(/Claude/);
    // A claim older than 4 hours (Claude stopped mid-way) no longer blocks the relief.
    expect(reliefNotNeeded(slot, [], {slot: {iso: '2026-11-09T10:00:00+01:00'}, startedAt: '2026-11-09T00:30:00Z'}, now)).toBeNull();
  });
});

describe('viralité', () => {
  it('ouvre les commentaires Instagram avec la question de la légende', () => {
    expect(firstComment('Publicité · Lien affilié\n\nTu paies combien d’outils ? Tu automatiserais quoi en premier : les e-mails ou les ventes ? Dis-le en commentaire.')).toBe('Tu automatiserais quoi en premier : les e-mails ou les ventes ? 👇');
    expect(firstComment('Aucune question ici.')).toBe('');
  });

  it('coche ce que le script respecte et explique le reste', () => {
    const v = viralChecklist(sampleScript());
    expect(v.total).toBe(12);
    const byId = Object.fromEntries(v.items.map((i) => [i.id, i.ok]));
    expect(byId['accroche-courte']).toBe(true);
    expect(byId['marque-apres']).toBe(true);
    expect(byId['question-commentaire']).toBe(false);
    expect(v.items.find((i) => !i.ok)?.fix.length).toBeGreaterThan(10);
  });

  it('rattache les statistiques Metricool à la bonne vidéo et apprend des styles d’accroche', () => {
    expect(metricoolDate('20261108112223')).toBe('2026-11-08T11:22:23Z');
    expect(postKey('https://www.tiktok.com/@a/video/7705759537223011606?x=1')).toBe('7705759537223011606');
    const [post] = parseTable('tiktok', {metrics: ['TKPO02', 'TKPO03', 'TKPO07', 'TKPO13', 'TKPO15'], rows: [['20261108112223', 'https://www.tiktok.com/@nouveau/video/77?x', '91', '0.12', '9']]});
    expect(post!.metrics.views).toBe(91);
    expect(post!.metrics.completionRate).toBe(12);
    expect(matchPost(post!, [{runId: 'r1', publications: {tiktok: {permalink: 'https://www.tiktok.com/@ancien/video/77'}}}])).toBe('r1');
    const perf = videoPerformance(
      [
        {runId: 'a', hook: 'h', hookStyle: 'liste', category: 'c', durationSec: 30},
        {runId: 'b', hook: 'h', hookStyle: 'liste', category: 'c', durationSec: 30},
      ],
      ['a', 'b'].map((runId) => ({runId, network: 'tiktok' as const, permalink: null, collectedAt: '', metrics: {views: 100, reach: null, likes: 1, comments: 1, shares: 2, saves: null, avgWatchTimeSec: 15, completionRate: null, profileVisits: null, linkClicks: null}})),
    );
    expect(perf[0]!.watchPct).toBe(50);
    expect(perf[0]!.sharePer100).toBe(2);
    expect(hookStyleIndex(perf).liste).toBeGreaterThan(1);
  });
});
