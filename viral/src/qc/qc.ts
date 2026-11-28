import fs from 'node:fs';
import path from 'node:path';
import type {Db} from '../core/db.js';
import type {AppConfig, Format} from '../core/config.js';
import {platformSpec, sizeSpec} from '../core/config.js';
import {getAccount} from '../core/accounts.js';
import {loadFacts, isFresh, factById} from '../core/facts.js';
import {PATHS} from '../core/paths.js';
import {containment, jaccard, normalize, readabilityFr, shingles, wordCount} from '../core/text.js';
import {nowIso, parseJson} from '../core/util.js';
import type {Slide} from '../generate/types.js';
import {slideText} from '../generate/composer.js';
import {CLAIM_PATTERNS, PRODUCT_CONTEXT, STAT_PATTERN, WEALTH_IMAGERY, claimNumbers, findCompetitors, findForbidden} from './rules.js';
import {grammarCheck, spellCheck} from './spell.js';
import {jpegSize} from '../render/renderer.js';

export interface QcIssue {
  check: string;
  where: string;
  message: string;
}

export interface QcReport {
  ok: boolean;
  score: number;
  errors: QcIssue[];
  warnings: QcIssue[];
  checks: Record<string, 'ok' | 'avertissement' | 'échec' | 'non vérifié'>;
  readability: number;
  at: string;
}

const CHECKS = ['structure', 'promesse-nombre', 'mention-publicite', 'regles-plateforme', 'conformite', 'faits', 'orthographe', 'grammaire', 'lisibilite', 'coherence', 'doublons', 'visuel', 'dimensions'] as const;

/**
 * Automatic quality control before any publication: spelling, grammar, coherence, information quality (facts),
 * readability, visual quality, dimensions, duplicates (own and competitors'), platform rules and misleading content.
 * Errors block publication; warnings are shown to the human reviewer.
 */
export function runQc(db: Db, cfg: AppConfig, slideshowId: string): QcReport {
  const ss = db.get('SELECT * FROM slideshows WHERE id = ?', slideshowId);
  if (!ss) throw new Error(`Carrousel inconnu : ${slideshowId}`);
  const account = getAccount(db, ss.account_id);
  const spec = platformSpec(cfg, ss.platform);
  const slides = parseJson<Slide[]>(ss.slides_json, []);
  const caption: string = ss.caption ?? '';
  const errors: QcIssue[] = [];
  const warnings: QcIssue[] = [];
  const checks: QcReport['checks'] = Object.fromEntries(CHECKS.map((c) => [c, 'ok'])) as QcReport['checks'];
  const err = (check: (typeof CHECKS)[number], where: string, message: string) => {
    errors.push({check, where, message});
    checks[check] = 'échec';
  };
  const warn = (check: (typeof CHECKS)[number], where: string, message: string) => {
    warnings.push({check, where, message});
    if (checks[check] === 'ok') checks[check] = 'avertissement';
  };
  const where = (i: number) => `slide ${i + 1}`;
  const text = slideText(slides);
  const facts = loadFacts();

  // Structure.
  if (slides[0]?.kind !== 'cover') err('structure', 'slide 1', 'la première slide doit être la couverture (accroche)');
  if (slides.at(-1)?.kind !== 'cta') err('structure', `slide ${slides.length}`, 'la dernière slide doit être l’appel à l’action');
  if (slides.length < spec.minSlides) err('structure', 'carrousel', `${slides.length} slides : minimum ${spec.minSlides} sur ${spec.label}`);
  if (slides.length > spec.maxSlides) err('structure', 'carrousel', `${slides.length} slides : maximum ${spec.maxSlides} sur ${spec.label}`);
  slides.forEach((s, i) => {
    const content = [s.title, s.body, s.left, s.right].filter(Boolean).join(' ').trim();
    if (!content) err('structure', where(i), 'slide vide');
  });
  const numbered = slides.filter((s) => (s.kind === 'item' || s.kind === 'compare') && s.number);
  numbered.forEach((s, k) => {
    if (s.number !== k + 1) err('structure', `slide ${slides.indexOf(s) + 1}`, `numérotation : ${s.number} au lieu de ${k + 1}`);
  });

  // The number announced in the hook matches the number of items.
  const announced = (ss.hook ?? '').match(/(?:^|\s)(\d{1,2})\s(erreurs|conseils|idées|étapes|choses|idées reçues|astuces|points|questions|outils|façons|raisons|règles|leçons|exemples|mythes|réflexes|habitudes)\b/i);
  const nAnnounced = announced ? Number(announced[1]) : null;
  const nItems = slides.filter((s) => s.kind === 'item' || s.kind === 'compare').length;
  if (nAnnounced !== null && nAnnounced !== nItems) err('promesse-nombre', 'accroche', `l’accroche annonce ${nAnnounced} éléments, le carrousel en contient ${nItems}`);

  // Advertising disclosure (caption + every slide badge, enforced by the renderer).
  if (!caption.startsWith(cfg.compliance.disclosure.captionPrefix)) err('mention-publicite', 'légende', `la légende doit commencer par « ${cfg.compliance.disclosure.captionPrefix} »`);
  if (!cfg.compliance.disclosure.everySlide) warn('mention-publicite', 'réglages', 'la mention « Publicité » n’est affichée que sur la première slide');

  // Platform rules.
  if (caption.length > spec.captionMax) err('regles-plateforme', 'légende', `${caption.length} caractères : maximum ${spec.captionMax} sur ${spec.label}`);
  const tags = parseJson<string[]>(ss.hashtags_json, []);
  if (tags.length > spec.hashtagsMax) err('regles-plateforme', 'hashtags', `${tags.length} hashtags : maximum ${spec.hashtagsMax}`);
  if (!spec.carousel) err('regles-plateforme', 'plateforme', `${spec.label} ne publie pas de carrousel`);
  if (!spec.formats.includes(ss.format)) err('regles-plateforme', 'format', `format ${ss.format} non prévu pour ${spec.label}`);
  if (!spec.linksClickable && /https?:\/\//.test(caption)) warn('regles-plateforme', 'légende', `les liens ne sont pas cliquables sur ${spec.label} : préfère « lien en bio »`);

  // Legal compliance and misleading content.
  for (const [i, s] of slides.entries()) {
    const t = [s.label, s.title, s.body, s.left, s.right, s.product?.title, s.product?.body].filter(Boolean).join(' ');
    for (const p of findForbidden(t)) err('conformite', where(i), p.message);
    if (WEALTH_IMAGERY.test(normalize(t))) err('conformite', where(i), 'évocation de richesse (promesse de revenus implicite)');
    for (const b of findCompetitors(t, cfg.compliance.competitorBrands)) err('conformite', where(i), `marque concurrente citée : ${b}`);
    if (STAT_PATTERN.test(normalize(t)) && !(s.factIds?.length)) err('faits', where(i), 'statistique sans source vérifiée');
  }
  for (const p of findForbidden(caption)) err('conformite', 'légende', p.message);
  for (const b of findCompetitors(caption, cfg.compliance.competitorBrands)) err('conformite', 'légende', `marque concurrente citée : ${b}`);
  if (/\b(inès|malik|sarah|paul|léa)\b/i.test(text) && !/exemple fictif/i.test(text)) err('conformite', 'carrousel', 'un exemple de personne doit être annoncé comme « Exemple fictif »');

  // Information quality: product claims need fresh verified facts whose wording carries the same numbers.
  const used = parseJson<string[]>(ss.fact_ids_json, []);
  for (const fid of used) {
    const f = factById(facts, fid);
    if (!f) err('faits', 'carrousel', `fait inconnu : ${fid}`);
    else if (!isFresh(f)) err('faits', 'carrousel', `fait ${fid} non vérifié ou périmé (vérifié le ${f.verifiedAt?.slice(0, 10) ?? 'jamais'}, validité ${f.ttlDays} j) : relance « facts:verify »`);
  }
  slides.forEach((s, i) => {
    const t = [s.title, s.body, s.left, s.right, s.product?.body].filter(Boolean).join(' ');
    const n = normalize(t);
    if (!PRODUCT_CONTEXT.test(n) && !(s.factIds?.length)) return;
    const claims = CLAIM_PATTERNS.filter((p) => p.re.test(n));
    if (claims.length === 0) return;
    const ids = s.factIds?.length ? s.factIds : i === 0 ? used : [];
    if (!ids.length) {
      for (const c of claims) err('faits', where(i), c.message);
      return;
    }
    const factText = ids.map((id) => `${factById(facts, id)?.statement ?? ''} ${factById(facts, id)?.evidence ?? ''}`).join(' ');
    const allowed = new Set(claimNumbers(factText));
    for (const num of claimNumbers(t.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' '))) {
      if (num > 31 && !allowed.has(num)) err('faits', where(i), `le chiffre ${num} ne figure dans aucun des faits cités (${ids.join(', ')})`);
    }
  });

  // Spelling and grammar.
  const spell = spellCheck(`${text}\n${caption.replace(/#[^\s]+/g, '')}`);
  for (const s of spell.slice(0, 12)) warn('orthographe', 'texte', `mot inconnu : « ${s.word} »${s.suggestions.length ? ` (suggestions : ${s.suggestions.join(', ')})` : ''}`);
  if (spell.length > 6) checks.orthographe = 'échec';
  if (spell.length > 6) errors.push({check: 'orthographe', where: 'texte', message: `${spell.length} mots inconnus : relecture nécessaire`});
  slides.forEach((s, i) => {
    for (const g of grammarCheck([s.title, s.body, s.left, s.right].filter(Boolean).join(' '))) warn('grammaire', where(i), g);
    if (s.title && /^\p{Ll}/u.test(s.title)) warn('grammaire', where(i), 'le titre ne commence pas par une majuscule');
  });

  // Readability on a phone.
  slides.forEach((s, i) => {
    const tw = wordCount(s.title ?? '');
    const bw = wordCount([s.body, s.left, s.right].filter(Boolean).join(' '));
    if (s.kind === 'cover' && tw > 16) warn('lisibilite', where(i), `accroche longue (${tw} mots, 16 au plus conseillés)`);
    if (s.kind !== 'cover' && tw > 16) warn('lisibilite', where(i), `titre long (${tw} mots)`);
    if (bw > 45) err('lisibilite', where(i), `texte trop long pour une slide (${bw} mots, 45 au plus)`);
  });
  const readability = Math.round(readabilityFr(text));
  if (readability < 35) warn('lisibilite', 'carrousel', `lecture difficile (indice Kandel-Moles ${readability})`);

  // Coherence.
  const titles = slides.map((s) => normalize(s.title ?? s.left ?? '')).filter(Boolean);
  if (new Set(titles).size !== titles.length) err('coherence', 'carrousel', 'deux slides ont le même titre');
  if (!caption.includes(ss.hook)) warn('coherence', 'légende', 'la légende ne reprend pas l’accroche');

  // Duplicates: our own slideshows, other accounts, and competitors' posts (never copy their text).
  const fp = shingles(text, 4);
  const others = db.all('SELECT id, account_id, template, slides_json, status FROM slideshows WHERE id != ? AND status NOT IN (?, ?)', slideshowId, 'rejected', 'qc_failed');
  for (const o of others) {
    const sim = jaccard(fp, shingles(slideText(parseJson<Slide[]>(o.slides_json, [])), 4));
    if (o.account_id === ss.account_id && sim >= 0.72) err('doublons', 'carrousel', `presque identique au carrousel ${o.id} du même compte (${Math.round(sim * 100)} %)`);
    else if (o.account_id === ss.account_id && sim >= 0.5) warn('doublons', 'carrousel', `proche du carrousel ${o.id} (${Math.round(sim * 100)} %)`);
    else if (o.account_id !== ss.account_id && sim >= 0.9 && o.template === ss.template) err('doublons', 'carrousel', `identique au carrousel ${o.id} d’un autre compte : adapte le modèle, l’accroche ou la légende avant de publier`);
  }
  const competitorTexts = db.all('SELECT id, author, text FROM posts WHERE is_own = 0 AND length(text) > 40');
  for (const c of competitorTexts) {
    const cs = shingles(c.text, 4);
    if (containment(fp, cs) >= 0.2 || containment(cs, fp) >= 0.5) err('doublons', 'carrousel', `texte trop proche d’une publication de @${c.author} (${c.id}) : interdit de copier`);
  }
  const sameHook = db.get<{n: number}>("SELECT COUNT(*) AS n FROM slideshows WHERE account_id = ? AND id != ? AND lower(hook) = lower(?) AND status IN ('approved', 'scheduled', 'published')", ss.account_id, slideshowId, ss.hook);
  if (sameHook && sameHook.n > 0) warn('doublons', 'accroche', 'accroche déjà utilisée sur ce compte (espacer les publications)');

  // Visual quality and dimensions (after rendering).
  const qcPrev = parseJson<any>(ss.qc_json, {});
  const images = db.all('SELECT * FROM images WHERE slideshow_id = ? ORDER BY slide_index', slideshowId);
  if (!images.length) {
    checks.visuel = 'non vérifié';
    checks.dimensions = 'non vérifié';
  } else {
    const size = sizeSpec(cfg, ss.format as Format);
    if (images.length !== slides.length) err('visuel', 'rendu', `${images.length} images pour ${slides.length} slides`);
    for (const im of images) {
      const file = path.join(PATHS.var, im.path);
      if (!fs.existsSync(file)) {
        err('visuel', `slide ${im.slide_index + 1}`, 'image introuvable : refaire le rendu');
        continue;
      }
      const dim = jpegSize(file);
      if (!dim || dim.width !== size.width || dim.height !== size.height) err('dimensions', `slide ${im.slide_index + 1}`, `dimensions ${dim ? `${dim.width}×${dim.height}` : 'illisibles'} au lieu de ${size.width}×${size.height}`);
      if (spec.maxImageBytes && im.bytes > spec.maxImageBytes) err('dimensions', `slide ${im.slide_index + 1}`, `image trop lourde (${Math.round(im.bytes / 1e6)} Mo)`);
    }
    for (const f of qcPrev.render?.fit ?? []) {
      if (f.overflow) err('visuel', `slide ${f.index + 1}`, 'texte coupé : il ne tient pas dans la zone sûre');
      else if (f.minFont < 22) err('visuel', `slide ${f.index + 1}`, `texte trop petit (${f.minFont} px)`);
      else if (f.minFont < 26) warn('visuel', `slide ${f.index + 1}`, `petit texte (${f.minFont} px)`);
    }
    const c = qcPrev.render?.contrast;
    if (c) {
      if (c.text < 4.5) err('visuel', 'couleurs', `contraste du texte insuffisant (${c.text}:1, 4,5:1 minimum)`);
      if (c.onAccent < 4.5) warn('visuel', 'couleurs', `contraste sur la couleur d’accent faible (${c.onAccent}:1)`);
      if (c.badge < 4.5) err('visuel', 'mention', `mention « Publicité » peu lisible (${c.badge}:1)`);
    }
  }

  const score = Math.max(0, 100 - errors.length * 20 - warnings.length * 4);
  const report: QcReport = {ok: errors.length === 0, score, errors, warnings, checks, readability, at: nowIso()};
  const nextStatus = !report.ok ? 'qc_failed' : !images.length ? ss.status : account.settings.requireApproval ? 'awaiting_approval' : 'approved';
  db.run('UPDATE slideshows SET qc_json = ?, qc_score = ?, status = ?, updated_at = ? WHERE id = ?', JSON.stringify({...qcPrev, report}), score, ['scheduled', 'published', 'publishing', 'approved', 'rejected'].includes(ss.status) && report.ok ? ss.status : nextStatus, nowIso(), slideshowId);
  if (!report.ok) db.event('qc', `Contrôle qualité : ${errors.length} problème(s) bloquant(s)`, {ref: slideshowId, level: 'warn', data: errors.slice(0, 5)});
  return report;
}
