import {describe, expect, it} from 'vitest';
import {lintScript, type LintContext} from '../src/script/lint.js';
import {loadConfig, loadEditorial} from '../src/core/config.js';
import {fact, sampleScript} from './fixtures.js';
import type {Script} from '../src/schemas/script.js';

async function ctx(over: Partial<LintContext> = {}): Promise<LintContext> {
  const editorial = await loadEditorial();
  return {
    category: editorial.categories.find((c) => c.id === 'pub-directe')!,
    editorial,
    config: await loadConfig(),
    facts: [],
    captures: [],
    recentHooks: [],
    recentAngles: [],
    lastHookStyle: null,
    now: new Date('2026-11-06T08:00:00Z'),
    ...over,
  };
}

function withScene(i: number, voiceover: string, claimFactIds: string[] = []): Script {
  const s = sampleScript();
  s.scenes[i] = {...s.scenes[i]!, voiceover, claimFactIds};
  return s;
}

const rules = (r: ReturnType<typeof lintScript>) => r.errors.map((e) => e.rule);

describe('contrôle du script', () => {
  it('accepte un script propre', async () => {
    const r = lintScript(sampleScript(), await ctx());
    expect(r.errors).toEqual([]);
    expect(r.estimatedDurationSec).toBeGreaterThan(20);
  });

  it('refuse les promesses de revenus et la fausse urgence', async () => {
    expect(rules(lintScript(withScene(2, 'Avec Systeme.io tu peux générer 3 000 € par mois sans effort.'), await ctx()))).toEqual(
      expect.arrayContaining(['promesse-de-revenus', 'promesse-de-resultat']),
    );
    expect(rules(lintScript(withScene(3, 'Dernière chance, l’offre expire ce soir.'), await ctx()))).toContain('fausse-urgence');
    expect(rules(lintScript(withScene(3, 'C’est le meilleur outil du marché.'), await ctx()))).toContain('superlatif');
  });

  it('exige un fait vérifié pour un prix, « gratuit » ou une fonctionnalité', async () => {
    const s = withScene(2, 'Le plan Startup coûte 17 $ par mois et le plan gratuit existe aussi.');
    expect(rules(lintScript(s, await ctx()))).toEqual(expect.arrayContaining(['affirmation-prix', 'affirmation-gratuit', 'affirmation-formule']));
    const f = fact('plan.startup.price', 'Le plan Startup coûte 17 $ par mois.', ['pricing', 'plan:startup']);
    const g = fact('plan.free.exists', 'Systeme.io propose un plan gratuit.', ['pricing', 'free-plan']);
    const ok = withScene(2, 'Le plan Startup coûte 17 $ par mois et le plan gratuit existe aussi.', [f.id, g.id]);
    expect(lintScript(ok, await ctx({facts: [f, g]})).errors).toEqual([]);
  });

  it('détecte un chiffre absent des faits cités', async () => {
    const f = fact('plan.free.contacts', 'Le plan gratuit inclut jusqu’à 2 000 contacts.', ['pricing', 'free-plan']);
    const s = withScene(2, 'Le plan gratuit inclut jusqu’à 5 000 contacts.', [f.id]);
    expect(rules(lintScript(s, await ctx({facts: [f]})))).toContain('chiffre-non-source');
  });

  it('refuse un fait périmé', async () => {
    const f = {...fact('plan.startup.price', 'Le plan Startup coûte 17 $ par mois.', ['pricing']), verifiedAt: '2026-10-01T00:00:00.000Z'};
    const s = withScene(2, 'Le plan Startup coûte 17 $ par mois.', [f.id]);
    expect(rules(lintScript(s, await ctx({facts: [f]})))).toContain('fait-non-verifie');
  });

  it('refuse une fonctionnalité non vérifiée et les noms de concurrents', async () => {
    expect(rules(lintScript(withScene(2, 'Crée tes tunnels de vente en quelques clics.'), await ctx()))).toContain('fonctionnalite-non-verifiee');
    const f = fact('feature.funnels', 'Systeme.io permet de créer des tunnels de vente.', ['feature:funnels']);
    expect(lintScript(withScene(2, 'Crée tes tunnels de vente en quelques clics.'), await ctx({facts: [f]})).errors).toEqual([]);
    expect(rules(lintScript(withScene(2, 'Plus simple que Kajabi.'), await ctx()))).toContain('marque-tierce');
  });

  it('bloque une accroche déjà utilisée et une démonstration sans capture réelle', async () => {
    const recent = 'Tu paies cinq outils différents pour vendre un seul produit ?';
    expect(rules(lintScript(sampleScript(), await ctx({recentHooks: [recent]})))).toContain('repetition');
    const s = sampleScript();
    s.scenes[2] = {...s.scenes[2]!, visual: {kind: 'demo', captureId: 'inexistante', queries: [], shotIdeas: [], focusRegionIds: []}};
    expect(rules(lintScript(s, await ctx()))).toContain('demo');
  });

  it('exige un appel à l’action vers le lien en bio en dernière scène', async () => {
    const s = withScene(4, 'Merci d’avoir regardé jusqu’au bout.');
    expect(rules(lintScript(s, await ctx()))).toContain('cta');
  });
});
