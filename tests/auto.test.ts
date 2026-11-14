import {describe, expect, it} from 'vitest';
import {extractJson, jsonDepth, repairJsonText} from '../src/llm/client.js';
import {claimedSlots, nextSlot, pickSlot, reliefNotNeeded} from '../src/auto/auto.js';
import {firstComment} from '../src/publish/publish.js';
import {joinContinuation, normalizeGraphic, repairScript, replyIsCut} from '../src/auto/writer.js';
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
  it('répare les oublis de forme du script sans toucher au contenu', () => {
    const r = repairScript({targetDurationSec: '35', captions: {tiktok: 'Texte #systemeio #emailmarketing', instagram: 'Texte'}, scenes: [{id: 1, voiceover: 'Bonjour', visual: {kind: 'broll', queries: 'woman laptop, office desk'}}]});
    expect(r.targetDurationSec).toBe(35);
    expect((r.captions as {hashtags: string[]}).hashtags).toEqual(['#systemeio', '#emailmarketing']);
    const scene = (r.scenes as Array<{id: string; voiceover: string; emphasis: unknown[]; visual: {queries: string[]}}>)[0]!;
    expect(scene.id).toBe('s1');
    expect(scene.voiceover).toBe('Bonjour');
    expect(scene.visual.queries).toEqual(['woman laptop', 'office desk']);
    expect(scene.emphasis).toEqual([]);
  });

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

describe('réponses imparfaites des IA gratuites', () => {
  it('répare la forme du JSON (guillemets droits, retours à la ligne, virgules) sans changer les mots', () => {
    const reply = '{"voiceover": "Clique sur "Comparer les plans" en bas",\n "caption": "Ligne 1\nLigne 2",\n "tags": ["#a", "#b",],\n "x": "fin"\n "y": 2}';
    expect(() => JSON.parse(reply)).toThrow();
    expect(extractJson(reply)).toEqual({voiceover: 'Clique sur "Comparer les plans" en bas', caption: 'Ligne 1\nLigne 2', tags: ['#a', '#b'], x: 'fin', y: 2});
    expect(repairJsonText('{"a": "b"}')).toBe('{"a": "b"}');
  });

  it('repère une réponse coupée sans jamais la compléter elle-même', () => {
    const cut = '```json\n{"runId": "r", "scenes": [{"id": "s1", "voiceover": "Sur Systeme.io, tu';
    expect(jsonDepth(cut)).toBeGreaterThan(0);
    expect(replyIsCut(cut, 'stop')).toBe(true);
    expect(() => extractJson(cut)).toThrow();
    expect(replyIsCut('{"a": {"b": 1}}', 'length')).toBe(false);
    const joined = joinContinuation(cut, '```json\n peux le faire."}]}\n```');
    expect(extractJson(joined)).toEqual({runId: 'r', scenes: [{id: 's1', voiceover: 'Sur Systeme.io, tu peux le faire.'}]});
    // Un modèle qui recommence depuis le début : sa nouvelle réponse remplace la réponse coupée.
    expect(joinContinuation(cut, '{"runId": "r2"}')).toBe('{"runId": "r2"}');
  });

  it('ramène les graphiques inventés aux six types du studio', () => {
    expect(normalizeGraphic({type: 'comparison', left: {title: 'a', items: []}, right: {title: 'b', items: []}}).type).toBe('compare');
    expect(normalizeGraphic({type: 'Timeline', steps: ['Créer', 'Envoyer']})).toEqual({type: 'steps', steps: [{title: 'Créer'}, {title: 'Envoyer'}]});
    expect(normalizeGraphic({type: 'pricing', plan: 'Startup', price: 17, period: '/mois', factId: 'f'}).price).toBe('17');
    expect(normalizeGraphic({type: 'icons', items: ['a', 'b']}).type).toBe('checklist');
    expect(normalizeGraphic({type: '???', value: '3', label: 'tunnels', factId: 'f'}).type).toBe('stat');
    expect(normalizeGraphic({type: 'checklist', items: ['x', 'y']})).toEqual({type: 'checklist', items: ['x', 'y']});
    const fixed = repairScript({scenes: [{id: 's1', visual: {kind: 'chart', graphic: {type: 'list', items: ['a', 'b']}}}]});
    expect((fixed.scenes as Array<{visual: {kind: string; graphic: {type: string}}}>)[0]!.visual).toMatchObject({kind: 'graphic', graphic: {type: 'checklist'}});
  });

  it('ne prend jamais le créneau que Claude vient de réserver', () => {
    const now = new Date('2026-11-14T07:00:00Z');
    expect(claimedSlots({slot: {iso: '2026-11-14T20:00:00+01:00'}, startedAt: '2026-11-14T06:45:00Z'}, now)).toEqual(['2026-11-14T20:00:00+01:00']);
    expect(claimedSlots({slot: {iso: '2026-11-14T20:00:00+01:00'}, startedAt: '2026-11-14T01:00:00Z'}, now)).toEqual([]);
    expect(claimedSlots(null, now)).toEqual([]);
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
