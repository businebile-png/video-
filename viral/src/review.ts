import type {Db} from './core/db.js';
import {nowIso, parseJson} from './core/util.js';

/**
 * Human validation (configurable per account: settings.requireApproval). Approving is only possible after a
 * successful quality control; the reviewer's name and time are kept with the slideshow.
 */
export function approve(db: Db, id: string, by: string): {id: string; status: string} {
  const ss = db.get('SELECT id, status, qc_json FROM slideshows WHERE id = ?', id);
  if (!ss) throw new Error(`Carrousel inconnu : ${id}`);
  const qc = parseJson<any>(ss.qc_json, {}).report;
  if (!qc) throw new Error(`${id} : contrôle qualité pas encore fait (render puis qc)`);
  if (!qc.ok) throw new Error(`${id} : le contrôle qualité a trouvé ${qc.errors.length} problème(s) bloquant(s) — corrige ou régénère avant de valider`);
  if (!['awaiting_approval', 'rendered', 'approved'].includes(ss.status)) throw new Error(`${id} : statut « ${ss.status} », validation impossible`);
  db.run("UPDATE slideshows SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?", by, nowIso(), nowIso(), id);
  db.event('review', `Validé par ${by}`, {ref: id});
  return {id, status: 'approved'};
}

export function reject(db: Db, id: string, reason: string): {id: string; status: string} {
  const ss = db.get('SELECT id, status FROM slideshows WHERE id = ?', id);
  if (!ss) throw new Error(`Carrousel inconnu : ${id}`);
  if (['scheduled', 'publishing', 'published'].includes(ss.status)) throw new Error(`${id} : déjà programmé ou publié — annule la programmation d’abord`);
  db.run("UPDATE slideshows SET status = 'rejected', rejected_reason = ?, updated_at = ? WHERE id = ?", reason, nowIso(), id);
  db.event('review', `Refusé : ${reason}`, {ref: id});
  return {id, status: 'rejected'};
}
