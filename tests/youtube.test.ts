import {describe, expect, it} from 'vitest';
import {loadConfig} from '../src/core/config.js';
import {metricoolInfo, nextSlots, postText, youtubeTitle} from '../src/publish/publish.js';
import {sampleScript} from './fixtures.js';

describe('YouTube Shorts', () => {
  it('titre le Short avec « Publicité » puis la question de la légende, 100 caractères au plus', () => {
    const script = sampleScript({captions: {tiktok: 'Liste e-mail : combien de contacts par formule Systeme.io ? 👇\n\nPas encore de produit ?', instagram: 'x'.repeat(25), hashtags: ['#systemeio', '#listeemail']}});
    expect(youtubeTitle(script)).toBe('Publicité · Liste e-mail : combien de contacts par formule Systeme.io ?');
    const long = sampleScript({captions: {tiktok: `${'Une question beaucoup trop longue pour tenir dans un titre de Short '.repeat(3)}?`, instagram: 'x'.repeat(25), hashtags: ['#a', '#b']}});
    const t = youtubeTitle(long);
    expect(t.length).toBeLessThanOrEqual(100);
    expect(t.startsWith('Publicité · ')).toBe(true);
    expect(t.endsWith('…')).toBe(true);
  });

  it('prépare un Short public, pas pour enfants, voix de synthèse déclarée, sans image de couverture', async () => {
    const config = await loadConfig();
    config.publish.notBefore = undefined;
    const script = sampleScript();
    const slot = nextSlots(config, new Date('2026-11-16T05:00:00Z')).find((s) => s.network === 'youtube')!;
    expect(slot.local).toBe('2026-11-16T10:00:00');
    const text = postText(script, 'youtube', config);
    expect(text.startsWith('Publicité')).toBe(true);
    const info = metricoolInfo('youtube', {text, mediaUrl: 'https://exemple.test/v.mp4', slot, coverMs: 1200, config, youtubeTitle: youtubeTitle(script), tags: ['#systemeio', '#entrepreneur']});
    expect(info.providers).toEqual([{network: 'youtube'}]);
    expect(info.youtubeData).toEqual({title: youtubeTitle(script), type: 'short', privacy: 'public', tags: ['systemeio', 'entrepreneur'], category: 'HOWTO_STYLE', madeForKids: false, isAiGeneratedContent: true});
    expect(info).not.toHaveProperty('videoCoverMilliseconds');
    expect(info).not.toHaveProperty('tiktokData');
    expect(info.firstCommentText).toBe('');
  });
});
