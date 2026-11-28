import {normalize} from '../core/text.js';

/**
 * Compliance rules shared with the video studio (src/script/lint.ts there): they protect the user legally
 * (French law n° 2023-451 on commercial influence, platform ad policies). Do not soften without an explicit request.
 * Every pattern runs on normalize()d text: lowercase, no accents, punctuation turned into spaces.
 */
export type Pattern = {re: RegExp; rule: string; message: string};

export const FORBIDDEN: Pattern[] = [
  {
    re: /\b(gagne[rsz]?|gagnez|generer|generes?|generez|encaisse[rsz]?|toucher|touches?|toucheras?|empoche[rsz]?)\b(\s+\S+){0,6}\s+\d[\d\s]*\s?(k\b|€|\$|euros?\b|dollars?\b)/,
    rule: 'promesse-de-revenus',
    message: 'promesse de gains chiffrés interdite',
  },
  {re: /\brevenus?\s+(garantis?|assures?|passifs?|automatiques?)\b/, rule: 'promesse-de-revenus', message: 'revenus garantis / passifs / automatiques : promesse interdite'},
  {re: /\bargent\s+(facile|rapide)\b|\ben\s+dormant\b|pendant\s+que\s+tu\s+dors/, rule: 'promesse-de-revenus', message: 'promesse d’argent facile interdite'},
  {re: /\b(devenir\s+riche|t\s+enrichir|enrichis\s+toi|liberte\s+financiere|millionnaire|(5|6|7|cinq|six|sept)\s+chiffres)\b/, rule: 'promesse-de-revenus', message: 'promesse d’enrichissement interdite'},
  {re: /\b(secret|cle|clef)s?\s+de\s+(ma|ta|sa|leur|notre|votre)\s+(reussite|richesse|fortune)\b|\bvivre\s+de\s+(ton|mon|son)\s+business\b|\bstyle\s+de\s+vie\s+de\s+reve\b/, rule: 'promesse-de-revenus', message: 'réussite ou train de vie mis en avant : promesse de revenus implicite'},
  {re: /\b(quitter|lacher|remplacer)\s+(ton|ta|votre)\s+(job|travail|salaire|boulot|cdi)\b/, rule: 'promesse-de-revenus', message: 'promesse implicite de revenus (quitter son travail) interdite'},
  {re: /\bsans\s+(aucun\s+)?effort\b|\bresultats?\s+garantis?\b|\bsucces\s+garanti\b/, rule: 'promesse-de-resultat', message: 'résultat garanti / sans effort : promesse interdite'},
  {re: /\bderniere\s+chance\b|\bplus\s+que\s+\d+\s+(places?|jours?|heures?|minutes?)\b|\boffre\s+(limitee|exclusive|qui\s+expire)\b/, rule: 'fausse-urgence', message: 'urgence non justifiée interdite'},
  {re: /\bexpire\s+(ce\s+soir|demain|bientot|dans)\b|\bdepeche\s+toi\b|\bavant\s+qu\s+il\s+ne\s+soit\s+trop\s+tard\b|\bseulement\s+aujourd\s+hui\b|\bmaintenant\s+ou\s+jamais\b/, rule: 'fausse-urgence', message: 'urgence non justifiée interdite'},
  {re: /\b(indispensable|obligatoire|essentiel)\s+pour\s+reussir\b|\b(impossible\s+de|tu\s+ne\s+peux\s+pas)\s+reussir\s+sans\b/, rule: 'necessite', message: 'ne pas présenter un abonnement comme indispensable pour réussir'},
  {re: /\b(le|la)\s+meilleure?\b|\bnumero\s+(un|1)\b|\bn\s*1\b|\ble\s+moins\s+cher\b|\bincomparable\b|\bimbattable\b|\brevolutionnaire\b|\bunique\s+au\s+monde\b/, rule: 'superlatif', message: 'superlatif non prouvable (« le meilleur », « n°1 »…) interdit'},
  {re: /\bj\s+ai\s+(gagne|genere|vendu|encaisse|fait)\s+\d|\bmes\s+(clients|eleves|abonnes)\s+ont\s+(gagne|genere|fait)\b/, rule: 'faux-temoignage', message: 'résultat personnel / témoignage non vérifiable interdit'},
];

/** Signs of wealth next to a product imply it will make the viewer rich (implicit income promise). */
export const WEALTH_IMAGERY =
  /\b(lamborghini|ferrari|porsche|bugatti|mclaren|bentley|rolls\s?royce|maserati|supercars?|rolex|liasses?|billets\s+de\s+banque|banknotes?|private\s+jet|jet\s+prive|yacht|villa\s+de\s+luxe|champagne|lingots?|gold\s+bars?|millionaire|wealthy)\b/;

/** Claims that need a verified fact when they are about the product (Systeme.io, its plans or limits). */
export const CLAIM_PATTERNS: Pattern[] = [
  {re: /\d[\d\s]*\s?(€|\$|euros?\b|dollars?\b)|(€|\$)\s?\d/, rule: 'prix', message: 'un prix doit s’appuyer sur un fait vérifié'},
  {re: /\d+\s?%|\bpour\s?cent\b/, rule: 'pourcentage', message: 'un pourcentage doit s’appuyer sur un fait vérifié'},
  {re: /\bgratuit(e|s|es|ement)?\b|\bsans\s+carte\s+(bancaire|de\s+credit)\b|\b0\s?(€|euro)/, rule: 'gratuit', message: '« gratuit » appliqué au produit doit s’appuyer sur un fait vérifié'},
  {re: /\b(plan|formule|offre|abonnement)\s+(startup|webinar|webinaire|unlimited|illimite|gratuit|free|starter)\b|\b(startup|webinaire|illimite)\s*:\s*\d/, rule: 'formule', message: 'une formule d’abonnement doit s’appuyer sur un fait vérifié'},
  {re: /\d[\d\s]*\s?(contacts?|tunnels?|formations?|e\s?mails?|communautes?|domaines?|workflows?|regles?|automatisations?|webinaires?|tests?|codes?)\b/, rule: 'limite', message: 'une limite chiffrée doit s’appuyer sur un fait vérifié'},
  {re: /\billimite(e|s|es)?\b|\bsans\s+limite\b/, rule: 'illimite', message: '« illimité » doit s’appuyer sur un fait vérifié'},
  {re: /\bfrais\s+de\s+transaction\b|\baucun\s+frais\b/, rule: 'frais', message: 'frais / commissions du produit doivent s’appuyer sur un fait vérifié'},
];

/** Statistics are never allowed without a source, whatever the subject. */
export const STAT_PATTERN = /\b\d+\s?%|\b\d+\s?(fois\s+plus|x\s+plus)\b|\b(la\s+plupart|\d+\s+sur\s+\d+)\s+des\s+(gens|entrepreneurs|personnes|visiteurs|clients)\b/;

export const PRODUCT_CONTEXT = /\bsysteme\b|\bsysteme io\b|\b(plan|formule|abonnement)\b|\bstartup\b|\billimite\b|\bwebinaire\s*:/;

export function findForbidden(text: string): Pattern[] {
  const n = normalize(text);
  return FORBIDDEN.filter((p) => p.re.test(n));
}

export function findCompetitors(text: string, brands: string[]): string[] {
  const n = ` ${normalize(text)} `;
  return brands.filter((b) => n.includes(` ${normalize(b)} `));
}

/** Numbers written in a claim (« 2 000 contacts » → 2000) to match against the facts' wording. */
export function claimNumbers(text: string): number[] {
  return [...text.matchAll(/\d[\d\s  .]*/g)].map((m) => Number(m[0].replace(/[\s  .]/g, ''))).filter((n) => Number.isFinite(n));
}
