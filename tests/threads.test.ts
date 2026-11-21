import {describe, expect, it} from 'vitest';
import {loadConfig} from '../src/core/config.js';
import {condenseForThreads, metricoolInfo, nextSlots, postText} from '../src/publish/publish.js';
import {sampleScript} from './fixtures.js';

const caption = [
  'Publicité · Systeme.io',
  '',
  'Liste e-mail : combien de contacts par formule Systeme.io ? 👇',
  '',
  'Pas encore de produit ? Commence par ta liste : chaque inscrit devient un contact à qui écrire le jour où ton offre est prête.',
  '',
  '🆓 Gratuit : 2 000 contacts, 0 €, sans carte bancaire.',
  '🚀 Startup : 5 000 contacts, 17 €/mois TTC.',
  '🎥 Webinaire : 10 000 contacts, 47 €/mois TTC.',
  '♾️ Illimité : contacts illimités, 97 €/mois TTC.',
  '',
  "Ta liste, elle en est à combien d'inscrits ? Dis-le en commentaire.",
  'Enregistre la vidéo pour comparer plus tard.',
  '👉 Lien en bio.',
  '',
  'Prix vérifiés sur systeme.io le 14/11/2026.',
  '',
  'Voix de synthèse IA, d\'après « SIWIS French Speech Synthesis Database » (Honnet et al., CC BY 4.0), modifiée.',
  '🎵 Musique : « All For Nothing » — Zachariehs',
  '',
  '#listeemail #emailmarketing #systemeio #entrepreneur #businessenligne',
].join('\n');

describe('Threads', () => {
  it('raccourcit la légende sous 500 caractères en gardant Publicité, accroche, question, lien en bio et crédits', () => {
    const t = condenseForThreads(caption, 500);
    expect(t.length).toBeLessThanOrEqual(500);
    expect(t.startsWith('Publicité · Systeme.io')).toBe(true);
    for (const part of ['Liste e-mail : combien de contacts', "Dis-le en commentaire.", '👉 Lien en bio.', 'Prix vérifiés sur systeme.io le 14/11/2026.', 'CC BY 4.0', '« All For Nothing » — Zachariehs', '#listeemail']) expect(t).toContain(part);
    expect(t).not.toContain('#emailmarketing');
    expect(t).not.toMatch(/\n{3,}/);
  });

  it('garde toujours la mention et le crédit de la voix, même avec une limite très courte', () => {
    const t = condenseForThreads(caption, 260);
    expect(t.length).toBeLessThanOrEqual(260);
    expect(t.startsWith('Publicité')).toBe(true);
    expect(t).toContain('CC BY 4.0');
  });

  it('prépare un post Threads sans couverture ni commission dans la légende', async () => {
    const config = await loadConfig();
    const script = sampleScript();
    const slot = nextSlots(config, new Date('2026-11-21T05:00:00Z')).find((s) => s.network === 'threads')!;
    const text = postText(script, 'threads', config);
    expect(text.length).toBeLessThanOrEqual(500);
    expect(text.startsWith('Publicité')).toBe(true);
    expect(text).not.toMatch(/commission/i);
    const info = metricoolInfo('threads', {text, mediaUrl: 'https://exemple.test/v.mp4', slot, coverMs: 1200, config});
    expect(info.providers).toEqual([{network: 'threads'}]);
    expect(info.threadsData).toEqual({});
    expect(info).not.toHaveProperty('videoCoverMilliseconds');
  });
});
