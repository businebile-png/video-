import {describe, expect, it} from 'vitest';
import {classifyHook, classifyCta, stripPreamble, extractFeatures} from '../src/intel/features.js';
import {scorePosts} from '../src/intel/scoring.js';
import {fromScrapeCreators, fromZernioAnalytics, fromGeneric, parseCsv} from '../src/intel/collectors/importers.js';
import {savePosts, analyzePosts, queryPosts} from '../src/intel/store.js';
import {computePatterns, insightsText} from '../src/intel/patterns.js';
import {detectTrends} from '../src/intel/trends.js';
import {listAccounts} from '../src/core/accounts.js';
import {tmpDb, SAMPLE_TIKTOK} from './helpers.js';

describe('lecture des accroches', () => {
  it('classe les accroches courantes', () => {
    expect(classifyHook('5 erreurs qui sabotent ton tunnel de vente')).toBe('liste');
    expect(classifyHook('C’est quoi un tunnel de vente ?')).toBe('definition');
    expect(classifyHook('Comment créer ta page en 3 étapes')).toBe('tutoriel');
    expect(classifyHook('Tu vends des produits digitaux sur ta boutique ?')).toBe('question');
    expect(classifyHook('Tunnel de vente ou Site Web')).toBe('comparaison');
    expect(classifyHook('Arrête de publier sans objectif')).toBe('erreur');
    expect(classifyHook('Il y a un an, je ne savais rien')).toBe('histoire');
    expect(classifyHook('Avant / après : ma page de vente')).toBe('avant-apres');
  });
  it('classe les appels à l’action', () => {
    expect(classifyCta('Commente “Tunnel” pour le tutoriel')).toBe('commentaire');
    expect(classifyCta('Le lien est dans ma bio')).toBe('lien');
    expect(classifyCta('Enregistre ce post')).toBe('enregistrer');
    expect(classifyCta('Rien ici')).toBe('aucun');
  });
  it('ignore la mention publicitaire avant l’accroche', () => {
    expect(stripPreamble('Publicité · Systeme.io Un tunnel de vente, comment on le crée ?')).toBe('Un tunnel de vente, comment on le crée ?');
    expect(stripPreamble("Publicité · Lien affilié : si tu t'abonnes via mon lien, je touche une commission. Le prix reste celui affiché sur systeme.io. Créer une formation ?")).toBe('Créer une formation ?');
  });
});

describe('score de viralité', () => {
  it('ne se contente jamais des vues', () => {
    const base = {platform: 'tiktok', followers: null, saves: 0};
    const scores = scorePosts([
      {...base, key: 'beaucoup-de-vues-sans-reaction', author: 'a', views: 100000, likes: 10, comments: 0, shares: 0},
      {...base, key: 'a2', author: 'a', views: 20000, likes: 2000, comments: 200, shares: 300},
      {...base, key: 'a3', author: 'a', views: 20000, likes: 1500, comments: 100, shares: 100},
      {...base, key: 'b1', author: 'b', views: 5000, likes: 800, comments: 150, shares: 200},
      {...base, key: 'b2', author: 'b', views: 1000, likes: 30, comments: 1, shares: 0},
    ]);
    const s = (k: string) => scores.get(k)!.score;
    expect(s('beaucoup-de-vues-sans-reaction')).toBeLessThan(s('a2'));
    expect(s('b1')).toBeGreaterThan(s('b2'));
    for (const v of scores.values()) {
      expect(v.score).toBeGreaterThanOrEqual(0);
      expect(v.score).toBeLessThanOrEqual(100);
    }
  });
  it('reste prudent quand les preuves manquent', () => {
    const scores = scorePosts([{key: 'x', platform: 'tiktok', author: 'solo', views: 20, likes: 20, comments: 5, shares: 5, saves: 5, followers: null}]);
    expect(Math.abs(scores.get('x')!.score - 50)).toBeLessThan(15);
  });
});

describe('imports', () => {
  it('lit les formats ScrapeCreators, Zernio, CSV', () => {
    const tk = fromScrapeCreators([{search_item_list: [{aweme_id: '9', desc: 'Test', create_time: 1795000000, statistics: {play_count: 10, digg_count: 2, comment_count: 1, share_count: 0, collect_count: 1}, author: {unique_id: 'x', follower_count: 3}, image_post_info: {images: [{}, {}, {}]}}]}]);
    expect(tk[0]).toMatchObject({platform: 'tiktok', externalId: '9', mediaType: 'carousel', slideCount: 3, views: 10});
    const {db} = tmpDb();
    const z = fromZernioAnalytics({posts: [{_id: 'z1', platform: 'tiktok', content: 'Publicité · Systeme.io Hello', publishedAt: '2026-11-20T09:00:00Z', analytics: {views: 100, likes: 3}, platforms: [{platform: 'tiktok', accountId: '6b0162fe81f9f8a5d9dffeb0', platformPostId: 'p1'}]}]}, listAccounts(db));
    expect(z[0]).toMatchObject({isOwn: true, accountId: 'tiktok-12eure21', externalId: 'p1', providerPostId: 'z1', views: 100});
    const csv = parseCsv('platform,id,author,text,views\ntiktok,1,a,"Bonjour, monde",10\n');
    expect(fromGeneric(csv)[0]).toMatchObject({platform: 'tiktok', text: 'Bonjour, monde', views: 10});
  });
});

describe('détecteur de mécanismes viraux', () => {
  it('analyse, note, compare et repère les tendances', () => {
    const {db, cfg} = tmpDb();
    savePosts(db, fromScrapeCreators(SAMPLE_TIKTOK));
    const a = analyzePosts(db, cfg);
    expect(a.posts).toBe(6);
    expect(a.competitors).toBe(3);
    const top = queryPosts(db, {sort: 'score', limit: 1}).items[0];
    expect(top.score).toBeGreaterThan(50);
    const patterns = computePatterns(db);
    expect(patterns.some((p) => p.dimension === 'hook_type')).toBe(true);
    expect(Array.isArray(insightsText(patterns))).toBe(true);
    const trends = detectTrends(db, new Date(1795500000 * 1000));
    expect(Array.isArray(trends)).toBe(true);
    const f = extractFeatures({text: '5 erreurs qui sabotent ton tunnel #tunneldevente', published_at: '2026-11-20T17:30:00Z'}, cfg.niche);
    expect(f).toMatchObject({hookType: 'liste', topic: 'tunnel-de-vente', hashtagCount: 1});
  });
});
