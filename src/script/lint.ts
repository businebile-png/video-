import type {Script, Scene} from '../schemas/script.js';
import type {Category, Editorial, StudioConfig} from '../schemas/config.js';
import type {Fact} from '../schemas/facts.js';
import type {Capture} from '../schemas/assets.js';
import {extractNumbers, normalize, similarity, wordCount} from '../core/text.js';
import {isFresh} from '../facts/facts.js';
import {frenchNumber} from '../voice/speech.js';

export interface LintIssue {
  rule: string;
  where: string;
  message: string;
}

export interface LintResult {
  ok: boolean;
  errors: LintIssue[];
  warnings: LintIssue[];
  estimatedDurationSec: number;
  wordCount: number;
  factIdsUsed: string[];
}

export interface LintContext {
  category: Category;
  editorial: Editorial;
  config: StudioConfig;
  facts: Fact[];
  captures: Capture[];
  recentHooks: string[];
  recentAngles: string[];
  lastHookStyle: string | null;
  now?: Date;
}

/**
 * Speaking rate of the approved voice-over (words per second, pauses inside sentences included).
 * Measured on the free local voice at speed 1.05: about 190 words a minute.
 */
export const WORDS_PER_SECOND = 3.1;

type Pattern = {re: RegExp; rule: string; message: string};

// All patterns run on normalize()d text: lowercase, no accents, punctuation → spaces.
const FORBIDDEN: Pattern[] = [
  {
    re: /\b(gagne[rsz]?|gagnez|generer|generes?|generez|encaisse[rsz]?|toucher|touches?|toucheras?|empoche[rsz]?)\b(\s+\S+){0,6}\s+\d[\d\s]*\s?(k\b|€|\$|euros?\b|dollars?\b)/,
    rule: 'promesse-de-revenus',
    message: 'promesse de gains chiffrés interdite',
  },
  {re: /\brevenus?\s+(garantis?|assures?|passifs?|automatiques?)\b/, rule: 'promesse-de-revenus', message: 'revenus garantis/passifs/automatiques : promesse interdite'},
  {re: /\bargent\s+(facile|rapide)\b|\ben\s+dormant\b|pendant\s+que\s+tu\s+dors/, rule: 'promesse-de-revenus', message: 'promesse d’argent facile interdite'},
  {re: /\b(devenir\s+riche|t\s+enrichir|enrichis\s+toi|liberte\s+financiere|millionnaire|(5|6|7|cinq|six|sept)\s+chiffres)\b/, rule: 'promesse-de-revenus', message: 'promesse d’enrichissement interdite'},
  {re: /\b(secret|cle|clef)s?\s+de\s+(ma|ta|sa|leur|notre|votre)\s+(reussite|richesse|fortune)\b|\bvivre\s+de\s+(ton|mon|son)\s+business\b|\bstyle\s+de\s+vie\s+de\s+reve\b/, rule: 'promesse-de-revenus', message: 'réussite ou train de vie mis en avant : promesse de revenus implicite interdite'},
  {re: /\b(quitter|lacher|remplacer)\s+(ton|ta|votre)\s+(job|travail|salaire|boulot|cdi)\b/, rule: 'promesse-de-revenus', message: 'promesse implicite de revenus (quitter son travail) interdite'},
  {re: /\bsans\s+(aucun\s+)?effort\b|\bresultats?\s+garantis?\b|\bsucces\s+garanti\b/, rule: 'promesse-de-resultat', message: 'résultat garanti / sans effort : promesse interdite'},
  {re: /\bderniere\s+chance\b|\bplus\s+que\s+\d+\s+(places?|jours?|heures?|minutes?)\b|\boffre\s+(limitee|exclusive|qui\s+expire)\b/, rule: 'fausse-urgence', message: 'fausse urgence interdite'},
  {re: /\bexpire\s+(ce\s+soir|demain|bientot|dans)\b|\bdepeche\s+toi\b|\bavant\s+qu\s+il\s+ne\s+soit\s+trop\s+tard\b|\bseulement\s+aujourd\s+hui\b|\bmaintenant\s+ou\s+jamais\b/, rule: 'fausse-urgence', message: 'fausse urgence interdite'},
  {re: /\b(indispensable|obligatoire|essentiel)\s+pour\s+reussir\b|\b(impossible\s+de|tu\s+ne\s+peux\s+pas)\s+reussir\s+sans\b/, rule: 'necessite', message: 'ne pas présenter un abonnement comme indispensable pour réussir'},
  {re: /\b(le|la)\s+meilleure?\b|\bnumero\s+(un|1)\b|\bn\s*1\b|\ble\s+moins\s+cher\b|\bincomparable\b|\bimbattable\b/, rule: 'superlatif', message: 'superlatif non prouvable (« le meilleur », « n°1 »…) interdit'},
  {re: /\bj\s+ai\s+(gagne|genere|vendu|encaisse|fait)\s+\d|\bmes\s+(clients|eleves|abonnes)\s+ont\s+(gagne|genere|fait)\b/, rule: 'faux-temoignage', message: 'résultat personnel / témoignage non vérifiable interdit'},
];

/**
 * Signs of wealth next to a product (supercars, cash, watches, jets…) tell the viewer it will make them
 * rich: an implicit income promise, banned by French law on influencers and by TikTok's ad rules.
 */
const WEALTH_IMAGERY =
  /\b(lamborghini|ferrari|porsche|bugatti|mclaren|bentley|rolls\s?royce|maserati|supercars?|sports?\s+cars?|luxury|luxe|rolex|cash|money|banknotes?|dollars?|euros?|private\s+jet|jet\s+prive|yacht|mansion|villa|champagne|gold\s+bars?|lingots?|rich|wealth|wealthy|millionaire)\b/;

const COMPETITORS = [
  'clickfunnels',
  'kajabi',
  'mailchimp',
  'shopify',
  'teachable',
  'podia',
  'kartra',
  'thinkific',
  'activecampaign',
  'sendinblue',
  'brevo',
  'learnybox',
  'convertkit',
  'getresponse',
  'wix',
  'wordpress',
  'squarespace',
  'webflow',
  'calendly',
  'zapier',
  'hubspot',
  'leadpages',
  'unbounce',
  'samcart',
  'gumroad',
  'thrivecart',
  'stripe',
  'paypal',
];

const CLAIM_PATTERNS: Pattern[] = [
  {re: /\d[\d\s]*\s?(€|\$|euros?\b|dollars?\b)|(€|\$)\s?\d/, rule: 'prix', message: 'un prix doit s’appuyer sur un fait vérifié'},
  {re: /\d+\s?%|\bpour\s?cent\b/, rule: 'pourcentage', message: 'un pourcentage doit s’appuyer sur un fait vérifié'},
  {re: /\bgratuit(e|s|es|ement)?\b|\bsans\s+carte\s+(bancaire|de\s+credit)\b|\b0\s?(€|euro)/, rule: 'gratuit', message: '« gratuit » doit s’appuyer sur un fait vérifié (plan gratuit)'},
  {re: /\b(plan|formule|offre|abonnement)\s+(startup|webinar|webinaire|unlimited|illimite|gratuit|free|starter)\b/, rule: 'formule', message: 'une formule d’abonnement doit s’appuyer sur un fait vérifié'},
  {re: /\d[\d\s]*\s?(contacts?|tunnels?|formations?|e\s?mails?|communautes?|domaines?|blogs?|workflows?|pages?|go|gb)\b/, rule: 'limite', message: 'une limite chiffrée doit s’appuyer sur un fait vérifié'},
  {re: /\billimite(e|s|es)?\b|\bsans\s+limite\b/, rule: 'illimite', message: '« illimité » doit s’appuyer sur un fait vérifié'},
  {re: /\bcommissions?\b|\bfrais\s+de\s+transaction\b/, rule: 'commission', message: 'commissions / frais doivent s’appuyer sur un fait vérifié'},
];

export const FEATURE_PATTERNS: Array<{feature: string; re: RegExp}> = [
  {feature: 'funnels', re: /\btunnels?\s+de\s+vente\b|\bfunnels?\b/},
  {feature: 'landing-pages', re: /\bpages?\s+de\s+(capture|vente|destination)\b|\blanding\s+pages?\b/},
  {feature: 'email-marketing', re: /\bcampagnes?\s+(d\s+)?e\s?mails?\b|\bnewsletters?\b|\be\s?mailing\b|\bemail\s+marketing\b|\bsequences?\s+(d\s+)?e\s?mails?\b/},
  {feature: 'automations', re: /\bautomatisations?\b|\bautomatise[rsz]?\b|\bworkflows?\b|\bregles?\s+d\s+automatisation\b/},
  {feature: 'courses', re: /\bformations?\s+en\s+ligne\b|\bcours\s+en\s+ligne\b|\bvendre\s+(une|ta|tes|sa|ses)\s+formations?\b|\bheberge[rsz]?\s+(une|ta|tes)\s+formations?\b/},
  {feature: 'community', re: /\bcommunautes?\b/},
  {feature: 'digital-products', re: /\bproduits?\s+(numeriques|digitaux)\b|\be\s?books?\b/},
  {feature: 'physical-products', re: /\bproduits?\s+physiques?\b/},
  {feature: 'payments', re: /\bpaiements?\b|\bencaisse[rsz]?\b|\bpages?\s+de\s+paiement\b|\bbons?\s+de\s+commande\b/},
  {feature: 'website', re: /\bsite\s+(web|internet|vitrine)\b|\bcreer?\s+ton\s+site\b/},
  {feature: 'blog', re: /\bblogs?\b/},
  {feature: 'webinars', re: /\bwebinaires?\b|\bwebinars?\b/},
  {feature: 'affiliate-program', re: /\bprogramme\s+d\s+affiliation\b|\btes\s+propres\s+affilies\b/},
  {feature: 'contacts', re: /\bgestion\s+des\s+contacts\b|\bcrm\b|\bliste\s+de\s+contacts\b/},
  {feature: 'coupons', re: /\bcoupons?\b|\bcodes?\s+promo\b/},
  {feature: 'ab-testing', re: /\btests?\s+a\s?b\b|\bab\s+test/},
];

const NUMBER_TOKENS = new Set([
  'zero', 'un', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze',
  'quinze', 'seize', 'vingt', 'vingts', 'trente', 'quarante', 'cinquante', 'soixante', 'cent', 'cents', 'mille', 'million', 'millions',
]);

/**
 * "cinq mille contacts" → "5000 contacts": amounts said in words are checked exactly like digits.
 * A lone "un"/"une" stays an article, and "pour cent" stays a percentage.
 */
export function wordsToDigits(normalizedText: string): string {
  const toks = normalizedText.split(' ');
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const t = toks[i]!;
    if (!NUMBER_TOKENS.has(t) || ((t === 'cent' || t === 'cents') && toks[i - 1] === 'pour')) {
      out.push(t);
      i++;
      continue;
    }
    const group: string[] = [];
    let j = i;
    while (j < toks.length && (NUMBER_TOKENS.has(toks[j]!) || (toks[j] === 'et' && group.length > 0 && NUMBER_TOKENS.has(toks[j + 1] ?? '')))) {
      if ((toks[j] === 'cent' || toks[j] === 'cents') && toks[j - 1] === 'pour') break;
      group.push(toks[j]!);
      j++;
    }
    const lone = group.length === 1 && (group[0] === 'un' || group[0] === 'une');
    const n = lone ? null : frenchNumber(group);
    out.push(...(n === null ? group : [String(n)]));
    i = j;
  }
  return out.join(' ');
}

/** Numbers attached to a price, percentage or quota ("17 $", "2 000 contacts"), in digit-only form. */
export function claimNumbers(normalizedText: string): string[] {
  const re = /(\d[\d ]*)\s?(€|\$|%|euros?\b|dollars?\b|contacts?\b|tunnels?\b|formations?\b|e ?mails?\b|communautes?\b|domaines?\b|go\b|gb\b)/g;
  return [...normalizedText.matchAll(re)].map((m) => m[1]!.replace(/\s/g, ''));
}

function sceneText(scene: Scene): string {
  const g = scene.visual.graphic;
  const graphicText = !g
    ? ''
    : g.type === 'checklist'
      ? `${g.title ?? ''} ${g.items.join(' ')}`
      : g.type === 'steps'
        ? `${g.title ?? ''} ${g.steps.map((s) => `${s.title} ${s.detail ?? ''}`).join(' ')}`
        : g.type === 'stack-merge'
          ? `${g.items.join(' ')} ${g.result}`
          : g.type === 'compare'
            ? `${g.left.title} ${g.left.items.join(' ')} ${g.right.title} ${g.right.items.join(' ')}`
            : g.type === 'stat'
              ? `${g.value} ${g.label}`
              : `${g.plan} ${g.price} ${g.period} ${g.note ?? ''}`;
  return `${scene.voiceover} ${scene.headline ?? ''} ${graphicText}`;
}

export function estimateDurationSec(script: Script): number {
  const words = script.scenes.reduce((n, s) => n + wordCount(s.voiceover), 0);
  return Math.round((words / WORDS_PER_SECOND + script.scenes.length * 0.25 + 1.6) * 10) / 10;
}

export function lintScript(script: Script, ctx: LintContext): LintResult {
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];
  const err = (rule: string, where: string, message: string) => errors.push({rule, where, message});
  const warn = (rule: string, where: string, message: string) => warnings.push({rule, where, message});
  const now = ctx.now ?? new Date();
  const factById = new Map(ctx.facts.map((f) => [f.id, f]));
  const verifiedFeatures = new Set<string>();
  for (const f of ctx.facts) if (isFresh(f, now)) for (const t of f.tags) if (t.startsWith('feature:')) verifiedFeatures.add(t.slice(8));
  const used = new Set<string>();

  if (script.category !== ctx.category.id) err('categorie', 'script', `catégorie « ${script.category} » différente de celle du plan (« ${ctx.category.id} »)`);
  if (!ctx.editorial.hookStyles.some((h) => h.id === script.hookStyle)) err('accroche', 'script', `style d’accroche inconnu : ${script.hookStyle}`);
  else if (script.hookStyle === ctx.lastHookStyle) warn('accroche', 'script', 'même style d’accroche que la vidéo précédente');

  const ids = new Set<string>();
  script.scenes.forEach((s) => {
    if (ids.has(s.id)) err('structure', s.id, 'identifiant de scène en double');
    ids.add(s.id);
  });
  const first = script.scenes[0]!;
  const last = script.scenes[script.scenes.length - 1]!;
  if (first.phase !== 'hook') err('structure', first.id, 'la première scène doit être l’accroche (phase « hook »)');
  if (last.phase !== 'cta') err('structure', last.id, 'la dernière scène doit être l’appel à l’action (phase « cta »)');
  if (!/\b(lien|bio)\b/.test(normalize(last.voiceover))) err('cta', last.id, 'l’appel à l’action doit mentionner le lien (en bio)');
  if (script.cta.reason.length < 15) warn('cta', 'cta', 'raison de cliquer trop vague');

  const hookFirstSentence = first.voiceover.split(/(?<=[.?!…])\s/)[0] ?? first.voiceover;
  const hookWords = wordCount(hookFirstSentence);
  if (hookWords > 24) err('accroche', first.id, `accroche trop longue (${hookWords} mots) : l’idée doit tomber en moins de 3 secondes`);
  else if (hookWords > 16) warn('accroche', first.id, `accroche longue (${hookWords} mots)`);

  for (const recent of ctx.recentHooks) {
    const sim = similarity(first.voiceover, recent);
    if (sim > ctx.editorial.rules.hookSimilarityMax) {
      err('repetition', first.id, `accroche trop proche d’une accroche récente (${Math.round(sim * 100)} %) : « ${recent} »`);
      break;
    }
  }
  for (const recent of ctx.recentAngles) {
    const sim = similarity(script.angle, recent);
    if (sim > ctx.editorial.rules.angleSimilarityMax) {
      err('repetition', 'angle', `angle trop proche d’un angle récent (${Math.round(sim * 100)} %) : « ${recent} »`);
      break;
    }
  }

  let tu = 0;
  let vous = 0;
  for (const scene of script.scenes) {
    const raw = sceneText(scene);
    const text = wordsToDigits(normalize(raw));
    tu += (text.match(/\b(tu|ton|ta|tes|toi|t)\b/g) ?? []).length;
    vous += (text.match(/\b(vous|votre|vos)\b/g) ?? []).length;

    for (const p of FORBIDDEN) if (p.re.test(text)) err(p.rule, scene.id, p.message);
    for (const name of COMPETITORS) {
      if (new RegExp(`\\b${name}\\b`).test(text)) err('marque-tierce', scene.id, `nom de marque tierce « ${name} » : ne pas citer de concurrent ou partenaire sans fait vérifié et accord explicite`);
    }

    const referenced = scene.claimFactIds.map((id) => ({id, fact: factById.get(id)}));
    for (const r of referenced) {
      if (!r.fact) err('fait-inconnu', scene.id, `fait inconnu : ${r.id}`);
      else if (!isFresh(r.fact, now)) err('fait-non-verifie', scene.id, `fait non vérifié ou périmé : ${r.id} (${r.fact.status})`);
      else used.add(r.id);
    }
    const factText = referenced
      .filter((r) => r.fact)
      .map((r) => `${r.fact!.statement} ${r.fact!.evidence ?? ''}`)
      .join(' ');
    for (const p of CLAIM_PATTERNS) {
      if (p.re.test(text) && referenced.filter((r) => r.fact && isFresh(r.fact, now)).length === 0) err(`affirmation-${p.rule}`, scene.id, p.message);
    }
    if (referenced.length > 0) {
      const factNumbers = new Set(extractNumbers(factText));
      for (const n of claimNumbers(text)) {
        if (!factNumbers.has(n)) err('chiffre-non-source', scene.id, `le chiffre « ${n} » n’apparaît dans aucun des faits cités`);
      }
    }
    for (const fp of FEATURE_PATTERNS) {
      if (fp.re.test(text) && !verifiedFeatures.has(fp.feature)) {
        err('fonctionnalite-non-verifiee', scene.id, `fonctionnalité « ${fp.feature} » citée sans fait vérifié dans la base`);
      }
    }

    const visualText = normalize([...scene.visual.queries, ...scene.visual.shotIdeas, scene.visual.mood ?? ''].join(' '));
    const wealth = visualText.match(WEALTH_IMAGERY);
    if (wealth) err('imagerie-richesse', scene.id, `image de richesse (« ${wealth[0]} ») : promesse de revenus implicite interdite, montrer le travail et l’outil plutôt que l’argent`);

    const g = scene.visual.graphic;
    if (scene.visual.kind === 'broll' && scene.phase !== 'cta' && scene.visual.queries.length < 2) err('visuel', scene.id, 'au moins 2 recherches de séquences sont nécessaires');
    if ((scene.visual.kind === 'graphic' || scene.phase === 'cta') && scene.visual.queries.length < 1) err('visuel', scene.id, 'une recherche de séquence de fond est nécessaire');
    if (scene.visual.kind === 'graphic' && !g) err('visuel', scene.id, 'scène « graphic » sans graphique');
    if (scene.visual.kind !== 'graphic' && g) warn('visuel', scene.id, 'graphique ignoré : la scène n’est pas de type « graphic »');
    if (g && (g.type === 'stat' || g.type === 'price')) {
      const fact = factById.get(g.factId);
      if (!fact || !isFresh(fact, now)) err('fait-non-verifie', scene.id, `le graphique ${g.type} s’appuie sur un fait non vérifié : ${g.factId}`);
      else {
        used.add(g.factId);
        const nums = new Set(extractNumbers(`${fact.statement} ${fact.evidence ?? ''}`));
        for (const n of extractNumbers(g.type === 'stat' ? g.value : g.price)) {
          if (!nums.has(n)) err('chiffre-non-source', scene.id, `le chiffre « ${n} » du graphique n’apparaît pas dans le fait ${g.factId}`);
        }
      }
    }
    if (scene.visual.kind === 'demo') {
      const cap = ctx.captures.find((c) => c.id === scene.visual.captureId);
      if (!cap) err('demo', scene.id, `capture réelle introuvable : ${scene.visual.captureId ?? '(aucune)'} — ne jamais inventer d’interface`);
      else {
        if (!cap.personalDataChecked) err('demo', scene.id, `capture ${cap.id} : absence de données personnelles non confirmée`);
        for (const fid of scene.visual.focusRegionIds) {
          if (!cap.focusRegions.some((r) => r.id === fid)) err('demo', scene.id, `zone « ${fid} » absente de la capture ${cap.id}`);
        }
      }
    }
    for (const e of scene.emphasis) {
      if (!normalize(scene.voiceover).includes(normalize(e))) warn('emphase', scene.id, `mot mis en avant absent de la voix off : « ${e} »`);
    }
    for (const sentence of scene.voiceover.split(/(?<=[.?!…])\s/)) {
      const n = wordCount(sentence);
      if (n > 24) warn('phrase-longue', scene.id, `phrase de ${n} mots (moins naturelle à l’oral)`);
    }
  }
  if (tu > 0 && vous > 0) warn('tutoiement', 'script', 'mélange de tutoiement et de vouvoiement');
  const allText = normalize(script.scenes.map((s) => s.voiceover).join(' '));
  const paidFactUsed = [...used].some((id) => (factById.get(id)?.tags ?? []).some((t) => t === 'pricing' || (t.startsWith('plan:') && t !== 'plan:free')));
  if (!paidFactUsed && !/\b(formules?|abonnements?|payante?s?|offres?\s+payantes?)\b/.test(allText)) {
    warn('conversion-abonnement', 'script', 'aucune mention des formules / abonnements payants : l’objectif est l’abonnement, pas seulement l’inscription gratuite');
  }

  const captionText = wordsToDigits(normalize(`${script.captions.tiktok} ${script.captions.instagram}`));
  for (const p of FORBIDDEN) if (p.re.test(captionText)) err(p.rule, 'légendes', p.message);
  for (const p of CLAIM_PATTERNS) {
    if (p.re.test(captionText) && used.size === 0) err(`affirmation-${p.rule}`, 'légendes', `${p.message} (légende)`);
  }
  if (!/\bbio\b|\blien\b/.test(captionText)) warn('legende', 'légendes', 'la légende devrait indiquer où se trouve le lien (bio)');
  if (script.captions.hashtags.length > 6) warn('legende', 'légendes', 'plus de 6 hashtags');

  const estimated = estimateDurationSec(script);
  const [minD, maxD] = ctx.category.durationSec;
  if (estimated < minD * 0.9 || estimated > maxD * 1.1) err('duree', 'script', `durée estimée ${estimated} s hors de la fourchette de la catégorie (${minD}–${maxD} s)`);
  if (Math.abs(estimated - script.targetDurationSec) > script.targetDurationSec * 0.2) warn('duree', 'script', `durée estimée ${estimated} s éloignée de la cible ${script.targetDurationSec} s`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    estimatedDurationSec: estimated,
    wordCount: script.scenes.reduce((n, s) => n + wordCount(s.voiceover), 0),
    factIdsUsed: [...used],
  };
}
