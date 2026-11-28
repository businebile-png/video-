import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {platformSpec} from '../core/config.js';
import {getAccount, listAccounts, type Account} from '../core/accounts.js';
import {addDays, id as newId, isoInZone, nowIso, rng, zonedInstant, zonedParts} from '../core/util.js';
import {choose} from '../analytics/learn.js';

/**
 * Publication calendar. For each account: its own daily and weekly caps (always below the platform's official
 * caps), a minimum gap between posts, an allowed time window, the studio's reserved video slots kept clear,
 * and preferred times learned from results. Never two identical slideshows across accounts at the same time.
 * Nothing here bypasses a limit: a slot that would exceed one is simply not used.
 */

export interface SlotCheck {
  ok: boolean;
  reason?: string;
}

const ACTIVE = "('planned', 'queued_remote', 'publishing', 'published', 'manual_required', 'deferred')";

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function checkSlot(db: Db, cfg: AppConfig, account: Account, at: Date, excludeId?: string): SlotCheck {
  const tz = cfg.accounts.timezone;
  const p = zonedParts(at, tz);
  const minute = p.hour * 60 + p.minute;
  const spec = platformSpec(cfg, account.platform);
  if (!spec.carousel) return {ok: false, reason: `${spec.label} : pas de carrousel`};
  if (account.limits.maxPerDay <= 0) return {ok: false, reason: 'compte sans publication de carrousels (maximum 0 par jour)'};
  if (at.getTime() < Date.now() + 10 * 60_000) return {ok: false, reason: 'créneau passé ou trop proche (moins de 10 minutes)'};
  const [w0, w1] = account.limits.window.map(toMinutes);
  if (minute < w0 || minute > w1) return {ok: false, reason: `hors de la plage ${account.limits.window.join('–')}`};
  const reserved = cfg.accounts.reservedTimes;
  if (reserved) {
    for (const r of reserved.times) {
      if (Math.abs(toMinutes(r) - minute) < reserved.gapMinutes) return {ok: false, reason: `trop près du créneau vidéo de ${r}`};
    }
  }
  const dayStart = zonedInstant(p.dateKey, '00:00', tz).toISOString();
  const dayEnd = zonedInstant(addDays(p.dateKey, 1), '00:00', tz).toISOString();
  const sameDay = db.get<{n: number}>(`SELECT COUNT(*) AS n FROM schedule WHERE account_id = ? AND status IN ${ACTIVE} AND scheduled_for >= ? AND scheduled_for < ? AND id != ?`, account.id, dayStart, dayEnd, excludeId ?? '')!.n;
  const dailyCap = Math.min(account.limits.maxPerDay, spec.dailyCap || Infinity);
  if (sameDay >= dailyCap) return {ok: false, reason: `plafond du jour atteint (${dailyCap})`};
  const weekStart = new Date(at.getTime() - 6 * 86_400_000).toISOString();
  const week = db.get<{n: number}>(`SELECT COUNT(*) AS n FROM schedule WHERE account_id = ? AND status IN ${ACTIVE} AND scheduled_for >= ? AND scheduled_for <= ? AND id != ?`, account.id, weekStart, at.toISOString(), excludeId ?? '')!.n;
  if (week >= account.limits.maxPerWeek) return {ok: false, reason: `plafond sur 7 jours atteint (${account.limits.maxPerWeek})`};
  const gap = account.limits.minGapMinutes * 60_000;
  const near = db.get<{n: number}>(
    `SELECT COUNT(*) AS n FROM schedule WHERE account_id = ? AND status IN ${ACTIVE} AND scheduled_for > ? AND scheduled_for < ? AND id != ?`,
    account.id,
    new Date(at.getTime() - gap).toISOString(),
    new Date(at.getTime() + gap).toISOString(),
    excludeId ?? '',
  )!.n;
  if (near > 0) return {ok: false, reason: `moins de ${account.limits.minGapMinutes} minutes d’une autre publication du compte`};
  return {ok: true};
}

/** Candidate times for one day: preferred times first (learned order), then every half hour of the window. */
function candidateTimes(db: Db, account: Account, rand: () => number): string[] {
  const [w0, w1] = account.limits.window.map(toMinutes);
  const grid: string[] = [];
  for (let m = Math.ceil(w0 / 30) * 30; m <= w1; m += 30) grid.push(hhmm(m));
  const preferred = account.limits.preferredTimes.filter((t) => toMinutes(t) >= w0 && toMinutes(t) <= w1);
  // Learned hour buckets (Thompson sampling) reorder the preferred times.
  const buckets = preferred.map((t) => {
    const h = Number(t.slice(0, 2));
    return h < 9 ? '06-09' : h < 12 ? '09-12' : h < 14 ? '12-14' : h < 17 ? '14-17' : h < 20 ? '17-20' : h < 23 ? '20-23' : '23-06';
  });
  let ordered = preferred;
  if (preferred.length > 1) {
    const {prefs} = choose(db, {dimension: 'hour', values: [...new Set(buckets)], accountId: account.id, platform: account.platform, rand, epsilon: 0});
    const rank = new Map(prefs.map((p) => [p.value, p.sample]));
    ordered = [...preferred].sort((a, b) => (rank.get(buckets[preferred.indexOf(b)]) ?? 0) - (rank.get(buckets[preferred.indexOf(a)]) ?? 0));
  }
  return [...ordered, ...grid.filter((g) => !ordered.includes(g))];
}

export function nextSlot(db: Db, cfg: AppConfig, account: Account, from = new Date(), horizonDays = 30, rand = rng(Date.now())): Date | null {
  const tz = cfg.accounts.timezone;
  const startKey = zonedParts(from, tz).dateKey;
  for (let d = 0; d <= horizonDays; d++) {
    const key = addDays(startKey, d);
    for (const t of candidateTimes(db, account, rand)) {
      const at = zonedInstant(key, t, tz);
      if (at.getTime() <= from.getTime()) continue;
      if (checkSlot(db, cfg, account, at).ok) return at;
    }
  }
  return null;
}

export function providerFor(account: Account): string {
  return account.provider;
}

export function schedule(db: Db, cfg: AppConfig, slideshowId: string, at?: Date): {id: string; at: string} {
  const ss = db.get('SELECT * FROM slideshows WHERE id = ?', slideshowId);
  if (!ss) throw new Error(`Carrousel inconnu : ${slideshowId}`);
  if (ss.status !== 'approved') throw new Error(`${slideshowId} : statut « ${ss.status} » — seul un carrousel approuvé (contrôle qualité réussi${getAccount(db, ss.account_id).settings.requireApproval ? ' et validation humaine' : ''}) peut être programmé`);
  const account = getAccount(db, ss.account_id);
  const when = at ?? nextSlot(db, cfg, account);
  if (!when) throw new Error(`${account.id} : aucun créneau libre dans les 30 prochains jours (limites atteintes)`);
  const check = checkSlot(db, cfg, account, when);
  if (!check.ok) throw new Error(`Créneau refusé : ${check.reason}`);
  // Same text at the same moment on two accounts is mass posting: refuse.
  const twin = db.get<{id: string}>(
    "SELECT s.id FROM schedule s JOIN slideshows x ON x.id = s.slideshow_id WHERE x.content_hash = ? AND s.account_id != ? AND abs(julianday(s.scheduled_for) - julianday(?)) < 1 AND s.status != 'cancelled'",
    ss.content_hash,
    account.id,
    when.toISOString(),
  );
  if (twin) throw new Error('Le même carrousel est déjà prévu sur un autre compte à moins de 24 h : adapte-le (modèle, accroche, légende) avant de le reprogrammer');
  const id = newId('sch');
  const now = nowIso();
  db.tx(() => {
    db.upsert('schedule', {id, slideshow_id: slideshowId, account_id: account.id, platform: account.platform, provider: providerFor(account), scheduled_for: when.toISOString(), status: 'planned', attempts: 0, max_attempts: 3, created_at: now, updated_at: now});
    db.run("UPDATE slideshows SET status = 'scheduled', updated_at = ? WHERE id = ?", now, slideshowId);
  });
  db.event('schedule', `${slideshowId} programmé pour ${isoInZone(when, cfg.accounts.timezone)} sur ${account.id}`, {ref: id});
  return {id, at: isoInZone(when, cfg.accounts.timezone)};
}

/** Fills free slots with approved slideshows, best predicted first, account by account. */
export function autoSchedule(db: Db, cfg: AppConfig, opts: {accountId?: string; max?: number; horizonDays?: number} = {}): Array<{slideshowId: string; scheduleId: string; at: string}> {
  const out: Array<{slideshowId: string; scheduleId: string; at: string}> = [];
  const accounts = opts.accountId ? [getAccount(db, opts.accountId)] : listAccounts(db, true);
  for (const account of accounts) {
    const approved = db.all("SELECT id FROM slideshows WHERE account_id = ? AND status = 'approved' ORDER BY COALESCE(predicted, 50) DESC, qc_score DESC, created_at", account.id);
    for (const s of approved) {
      if (opts.max && out.length >= opts.max) return out;
      const at = nextSlot(db, cfg, account, new Date(), opts.horizonDays ?? 14);
      if (!at) break;
      try {
        const r = schedule(db, cfg, s.id, at);
        out.push({slideshowId: s.id, scheduleId: r.id, at: r.at});
      } catch (e) {
        db.event('schedule', (e as Error).message, {ref: s.id, level: 'warn'});
      }
    }
  }
  return out;
}

export function cancel(db: Db, scheduleId: string, reason = 'annulé'): void {
  const s = db.get('SELECT * FROM schedule WHERE id = ?', scheduleId);
  if (!s) throw new Error(`Programmation inconnue : ${scheduleId}`);
  if (['published', 'publishing'].includes(s.status)) throw new Error('Publication déjà partie : supprime-la sur la plateforme si besoin');
  db.run("UPDATE schedule SET status = 'cancelled', last_error = ?, updated_at = ? WHERE id = ?", reason, nowIso(), scheduleId);
  db.run("UPDATE slideshows SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'scheduled'", nowIso(), s.slideshow_id);
}

export function calendar(db: Db, cfg: AppConfig, fromIso: string, toIso: string) {
  return db
    .all(
      `SELECT s.id, s.slideshow_id, s.account_id, s.platform, s.provider, s.scheduled_for, s.status, s.provider_post_id, s.permalink, s.last_error, x.hook, x.template
         FROM schedule s JOIN slideshows x ON x.id = s.slideshow_id
        WHERE s.scheduled_for >= ? AND s.scheduled_for < ? AND s.status != 'cancelled' ORDER BY s.scheduled_for`,
      fromIso,
      toIso,
    )
    .map((r) => ({...r, local: isoInZone(new Date(r.scheduled_for), cfg.accounts.timezone)}));
}
