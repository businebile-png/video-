import fsp from 'node:fs/promises';
import path from 'node:path';
import {PATHS, runPaths} from '../core/paths.js';
import {exists, readJsonIfExists, writeJson, writeText} from '../core/fsx.js';
import {Rng, seedFrom} from '../core/rng.js';
import {daysBetween, isoDateInZone} from '../core/time.js';
import {loadCaptures, loadHistory} from '../core/stores.js';
import {loadFacts, usableFacts} from '../facts/facts.js';
import {ART_DIRECTIONS} from '../edit/art-directions.js';
import type {Category, Editorial, StudioConfig} from '../schemas/config.js';
import type {HistoryRecord} from '../schemas/records.js';
import type {Capture} from '../schemas/assets.js';
import type {Fact} from '../schemas/facts.js';
import {WORDS_PER_SECOND} from '../script/lint.js';
import {saveState} from '../core/run.js';
import {performanceLines, type Insights} from '../analytics/analytics.js';

export interface PanelIdea {
  id: string;
  text: string;
  category?: string | null;
  priority?: boolean;
  status: string;
}

export interface Plan {
  runId: string;
  date: string;
  seed: number;
  category: Category;
  artDirection: string;
  voiceId: string | null;
  voiceName: string | null;
  durationTargetSec: [number, number];
  hookStylesAvoid: string[];
  recentHooks: string[];
  recentAngles: string[];
  rejectedNotes: string[];
  ideas: PanelIdea[];
  captures: Array<Pick<Capture, 'id' | 'feature' | 'title' | 'description' | 'type' | 'durationSec'> & {regions: string[]}>;
  facts: Array<Pick<Fact, 'id' | 'statement' | 'tags' | 'verifiedAt'>>;
  insights: unknown;
  /** Real results of past videos (watch time, shares) worth repeating, one line each; null without data. */
  performance?: string[] | null;
  correction: {runId: string; notes: string} | null;
}

export interface CategoryPrefs {
  [categoryId: string]: 'boost' | 'normal' | 'avoid';
}

export function chooseCategory(
  editorial: Editorial,
  history: HistoryRecord[],
  captures: Capture[],
  date: string,
  rng: Rng,
  prefs: CategoryPrefs = {},
  performance: Record<string, number> = {},
  factTags: Set<string> = new Set(),
): Category {
  const lastByCat = new Map<string, string>();
  for (const h of history) if (!lastByCat.has(h.category) || lastByCat.get(h.category)! < h.date) lastByCat.set(h.category, h.date);
  const captureFeatures = new Set(captures.map((c) => c.feature));
  const scored = editorial.categories.map((c) => {
    const last = lastByCat.get(c.id);
    const since = last ? daysBetween(last, date) : Number.POSITIVE_INFINITY;
    let weight = c.weight;
    if (since < editorial.rules.minDaysBetweenSameCategory) weight = 0;
    if (c.requiresDemo && !c.features.some((f) => captureFeatures.has(f))) weight = 0;
    if (c.requiresFactTags.some((t) => !factTags.has(t))) weight = 0;
    if (prefs[c.id] === 'avoid') weight = 0;
    if (prefs[c.id] === 'boost') weight *= 1.8;
    weight *= performance[c.id] ?? 1;
    weight *= Number.isFinite(since) ? Math.min(2, 1 + since / 14) : 2;
    return {c, weight};
  });
  const eligible = scored.filter((s) => s.weight > 0);
  if (eligible.length === 0) {
    // Everything is on cooldown: take the least recently used category that is feasible.
    const feasible = scored.filter(
      (s) => !(s.c.requiresDemo && !s.c.features.some((f) => captureFeatures.has(f))) && !s.c.requiresFactTags.some((t) => !factTags.has(t)) && prefs[s.c.id] !== 'avoid',
    );
    return (feasible[0] ?? scored[0]!).c;
  }
  return rng.weighted(eligible, (s) => s.weight).c;
}

export function chooseArtDirection(history: HistoryRecord[], rng: Rng, allowed?: string[]): string {
  const recent = history
    .filter((h) => h.artDirection)
    .sort((a, b) => b.runId.localeCompare(a.runId))
    .slice(0, 2)
    .map((h) => h.artDirection);
  const pool = allowed?.length ? ART_DIRECTIONS.filter((a) => allowed.includes(a.id)) : ART_DIRECTIONS;
  const base = pool.length ? pool : ART_DIRECTIONS;
  const options = base.filter((a) => !recent.includes(a.id));
  return rng.pick(options.length ? options : base).id;
}

export async function nextRunId(date: string): Promise<string> {
  for (const suffix of 'abcdefghijklmnopqrstuvwxyz') {
    const id = `${date}-${suffix}`;
    if (!exists(runPaths(id).dir)) return id;
  }
  throw new Error(`Trop de productions pour le ${date}.`);
}

export async function createPlan(config: StudioConfig, editorial: Editorial, opts: {date?: string; category?: string; correction?: {runId: string; notes: string}} = {}): Promise<Plan> {
  const date = opts.date ?? isoDateInZone(new Date(), config.metricool.timezone);
  const runId = await nextRunId(date);
  const seed = seedFrom(runId);
  const rng = new Rng(seed);
  const history = await loadHistory();
  const captures = await loadCaptures();
  const facts = usableFacts(await loadFacts());
  const panel = await readJsonIfExists<{ideas?: PanelIdea[]; categoryPrefs?: CategoryPrefs; rejected?: Array<{runId: string; reason: string}>}>(
    path.join(PATHS.panelInbox, 'inbox.json'),
    {},
  );
  const insights = await readJsonIfExists<Partial<Insights>>(PATHS.insights, {});
  const category = opts.category
    ? editorial.categories.find((c) => c.id === opts.category) ?? (() => {
        throw new Error(`Catégorie inconnue : ${opts.category}`);
      })()
    : chooseCategory(editorial, history, captures, date, rng, panel.categoryPrefs ?? {}, insights.categoryIndex ?? {}, new Set(facts.flatMap((f) => f.tags)));
  const recent = [...history].sort((a, b) => b.runId.localeCompare(a.runId)).slice(0, editorial.rules.recentWindow);
  const voice = config.voice.approvedVoices[0] ?? null;
  const plan: Plan = {
    runId,
    date,
    seed,
    category,
    artDirection: chooseArtDirection(history, rng, category.artDirections),
    voiceId: voice?.id ?? null,
    voiceName: voice?.name ?? null,
    durationTargetSec: category.durationSec,
    hookStylesAvoid: recent.slice(0, 2).map((h) => h.hookStyle).filter((s): s is string => Boolean(s)),
    recentHooks: recent.map((h) => h.hook).filter((s): s is string => Boolean(s)),
    recentAngles: recent.map((h) => h.angle).filter((s): s is string => Boolean(s)),
    rejectedNotes: (panel.rejected ?? []).slice(-10).map((r) => `${r.runId} : ${r.reason}`),
    ideas: (panel.ideas ?? []).filter((i) => i.status === 'new'),
    captures: captures.map((c) => ({
      id: c.id,
      feature: c.feature,
      title: c.title,
      description: c.description,
      type: c.type,
      durationSec: c.durationSec,
      regions: c.focusRegions.map((r) => `${r.id} (${r.label})`),
    })),
    facts: facts.map((f) => ({id: f.id, statement: f.statement, tags: f.tags, verifiedAt: f.verifiedAt})),
    insights,
    performance: performanceLines(insights),
    correction: opts.correction ?? null,
  };
  const p = runPaths(runId);
  await fsp.mkdir(p.dir, {recursive: true});
  await saveState({runId, createdAt: new Date().toISOString(), seed, steps: {}});
  await writeJson(p.plan, plan);
  await writeText(p.planMd, renderBrief(plan, editorial));
  return plan;
}

/** The writer's brief: everything the script author needs, in French, in one page. */
export function renderBrief(plan: Plan, editorial: Editorial): string {
  const c = plan.category;
  const [minD, maxD] = c.durationSec;
  const words = (s: number) => Math.round(s * WORDS_PER_SECOND);
  const lines: string[] = [];
  lines.push(`# Brief de production — ${plan.runId}`);
  lines.push('');
  lines.push(`**Catégorie** : ${c.label} — ${c.description}`);
  lines.push(`**Durée** : ${minD}–${maxD} s, soit environ ${words(minD)}–${words(maxD)} mots de voix off au total.`);
  lines.push(`**Direction artistique** : ${plan.artDirection} · **Voix** : ${plan.voiceName ?? 'AUCUNE VOIX APPROUVÉE (bloquant)'}`);
  lines.push(`**Structure conseillée** : ${c.phases.join(' → ')}`);
  lines.push(`**Fonctionnalités pertinentes** : ${c.features.join(', ')}`);
  lines.push('');
  lines.push('## Pistes d’angle (à réinventer, jamais à copier)');
  c.angleSeeds.forEach((a) => lines.push(`- ${a}`));
  lines.push('');
  lines.push('## Styles d’accroche');
  editorial.hookStyles.forEach((h) => lines.push(`- \`${h.id}\` — ${h.label} : ${h.principle}${plan.hookStylesAvoid.includes(h.id) ? ' (**utilisé récemment, à éviter**)' : ''}`));
  lines.push('');
  if (plan.correction) {
    lines.push('## Correction demandée par l’utilisateur');
    lines.push(`Vidéo ${plan.correction.runId} : ${plan.correction.notes}`);
    lines.push('');
  }
  if (plan.ideas.length) {
    lines.push('## Idées proposées dans le panneau');
    plan.ideas.forEach((i) => lines.push(`- (${i.id}) ${i.text}${i.priority ? ' — **prioritaire**' : ''}`));
    lines.push('');
  }
  if (plan.rejectedNotes.length) {
    lines.push('## Vidéos refusées récemment (ne pas reproduire)');
    plan.rejectedNotes.forEach((r) => lines.push(`- ${r}`));
    lines.push('');
  }
  lines.push('## Accroches récentes (interdit de les répéter ou paraphraser)');
  (plan.recentHooks.length ? plan.recentHooks : ['(aucune)']).forEach((h) => lines.push(`- ${h}`));
  lines.push('');
  lines.push('## Faits vérifiés utilisables (et seulement ceux-là)');
  if (plan.facts.length === 0) lines.push('- AUCUN fait vérifié : ne citer ni prix, ni chiffre, ni fonctionnalité précise. Lancer facts:refresh + facts:verify.');
  plan.facts.forEach((f) => lines.push(`- \`${f.id}\` — ${f.statement} (vérifié le ${f.verifiedAt?.slice(0, 10)})`));
  lines.push('');
  lines.push('## Captures réelles de Systeme.io disponibles pour une démonstration');
  if (plan.captures.length === 0) lines.push('- Aucune : pas de scène « demo » (ne jamais inventer d’interface).');
  plan.captures.forEach((cp) => lines.push(`- \`${cp.id}\` [${cp.feature}] ${cp.title} — ${cp.description} — zones : ${cp.regions.join(', ') || 'aucune'}`));
  const pricing = plan.captures.find((cp) => cp.feature === 'pricing');
  if (pricing) {
    lines.push(
      `- Quand la voix cite un prix ou une limite de formule, montrer la preuve : scène \`demo\` avec \`${pricing.id}\` (la caméra va sur chaque formule au mot qui la nomme).`,
    );
  }
  lines.push('');
  lines.push('## Objectif commercial');
  lines.push('- Le but est l’abonnement payant à Systeme.io via le lien affilié (commission récurrente), pas les vues.');
  lines.push('- Quand c’est pertinent, montrer ce que débloquent les formules payantes (limites plus hautes, domaine personnalisé, automatisations…) en citant les faits tarifaires vérifiés ci-dessus.');
  lines.push('- Le plan gratuit peut servir de porte d’entrée honnête (« commence gratuitement, passe à une formule payante quand ton activité grandit »), sans jamais le dénigrer.');
  lines.push('- Appel à l’action concret : donner une raison de cliquer (comparer les formules, voir ce qui est inclus, tester sur son propre projet).');
  lines.push('- Interdit : présenter un abonnement comme indispensable pour réussir, cacher un prix ou une condition, inventer une offre ou une urgence.');
  lines.push('');
  lines.push('## Pour que la vidéo soit vue jusqu’au bout, commentée et partagée');
  lines.push('Ce que les plateformes disent récompenser : TikTok classe les vidéos selon les interactions (temps de visionnage, partages, commentaires, j’aime) ; Instagram cite d’abord le temps de visionnage, les j’aime et les envois en message rapportés à la portée. Personne ne peut garantir qu’une vidéo devienne virale : on met toutes les chances de son côté, honnêtement.');
  lines.push('- **0–2 s, arrêter le pouce** : première phrase de 12 mots au plus, sur le problème ou un fait vérifié surprenant, avec « tu » ou en question ; titre court (36 caractères au plus) à l’écran dès la première image. La marque vient après, pas dans la première phrase.');
  lines.push('- **Une raison de rester** : annoncer ce qui vient (« trois limites changent », « je te montre en 20 secondes ») et le tenir. Jamais de mystère trompeur, de « secret » ni de « la suite va te choquer ».');
  lines.push('- **Rythme** : une phrase = une scène = une image, une nouvelle scène toutes les 5 s au plus ; aucune phrase de remplissage.');
  lines.push('- **Court** : 40 s au plus quand le sujet le permet ; enlever une idée plutôt qu’accélérer la voix.');
  lines.push('- **Fin qui ne traîne pas** : une phrase d’appel à l’action. Idéalement, la dernière phrase répond à l’accroche, pour que la vidéo s’enchaîne naturellement si elle repart au début.');
  lines.push('- **Légende** : première ligne = le sujet en clair avec les mots que les gens tapent (« automatiser ses e-mails », « tunnel de vente gratuit ») ; une vraie question facile à commenter ; une phrase honnête pour enregistrer ou envoyer la vidéo (« Enregistre-la pour comparer plus tard ») ; 3 à 5 hashtags précis.');
  lines.push('- **Contrôle** : `script:check` affiche la « checklist viralité » (12 points) ; viser 10 points au moins avant la voix.');
  if (plan.performance) {
    lines.push('');
    lines.push('### Ce qui a marché chez ton audience (statistiques réelles)');
    plan.performance.forEach((l) => lines.push(`- ${l}`));
  }
  lines.push('');
  lines.push('## Écrire pour l’oreille (voix naturelle)');
  lines.push('- Français parlé, tutoiement, phrases courtes (8 à 16 mots), une idée par phrase.');
  lines.push('- Rythme de conversation : virgules et points là où un humain respire ; pas de parenthèses, pas d’abréviations, pas de listes à rallonge.');
  lines.push('- Chiffres écrits comme ils se disent (« dix-sept euros par mois » peut s’écrire « 17 € par mois », la prononciation est gérée) ; éviter les sigles.');
  lines.push('- Pas de formules publicitaires creuses (« révolutionnaire », « incroyable ») : un ton d’ami qui s’y connaît.');
  lines.push('');
  lines.push('## Règles non négociables');
  lines.push('- Aucune promesse de revenus, de résultat ou de facilité ; aucune fausse urgence ; pas de « le meilleur ».');
  lines.push('- Chaque prix, chiffre, formule, « gratuit », « illimité » ou fonctionnalité cité s’appuie sur un fait vérifié listé ci-dessus (champ `claimFactIds`).');
  lines.push('- Pas de nom de concurrent. Pas de faux témoignage. Tutoiement constant.');
  lines.push('- Images : jamais de signes de richesse (voitures de luxe, billets, montres, jets, villas) ni de « secret de ma réussite » : ce serait une promesse de revenus implicite. Montrer le travail, la création, l’outil.');
  lines.push('- Accroche : l’idée doit tomber dans les 3 premières secondes. Dernière scène : appel à l’action vers le lien en bio, avec une vraie raison de cliquer.');
  lines.push('- Recherches de séquences en anglais, 2 à 3 mots-clés simples et filmables (« woman laptop », « typing keyboard », « city night »), 2 à 4 par scène : les bibliothèques indexent des mots-clés, pas des phrases.');
  lines.push('- Format attendu : `script.json` conforme à `src/schemas/script.ts`, puis `npm run studio -- script:check ' + plan.runId + '`.');
  return lines.join('\n') + '\n';
}
