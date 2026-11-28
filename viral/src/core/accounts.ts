import type {Db, Row} from './db.js';
import type {AccountConfig, AppConfig, Brand, Limits, AccountSettings} from './config.js';
import {parseJson} from './util.js';

export interface Account {
  id: string;
  platform: AccountConfig['platform'];
  handle: string;
  displayName: string | null;
  provider: AccountConfig['provider'];
  fallbackProvider: AccountConfig['provider'] | null;
  providerAccountId: string | null;
  providerProfileId: string | null;
  niche: string;
  language: string;
  slideshows: boolean;
  active: boolean;
  notes: string | null;
  brand: Brand;
  limits: Limits;
  settings: AccountSettings;
  health: any;
  syncedAt: string | null;
}

export function rowToAccount(r: Row): Account {
  const settings = parseJson<any>(r.settings_json, {});
  return {
    id: r.id,
    platform: r.platform,
    handle: r.handle,
    displayName: r.display_name,
    provider: r.provider,
    fallbackProvider: settings.__fallbackProvider ?? null,
    providerAccountId: r.provider_account_id,
    providerProfileId: settings.__providerProfileId ?? null,
    niche: r.niche,
    language: r.language,
    slideshows: !!r.slideshows_enabled,
    active: !!r.active,
    notes: settings.__notes ?? null,
    brand: parseJson(r.brand_json, {} as Brand),
    limits: parseJson(r.limits_json, {} as Limits),
    settings,
    health: parseJson(r.health_json, null),
    syncedAt: r.synced_at,
  };
}

/**
 * Seeds / refreshes the accounts table from config/accounts.json.
 * Choices made later in the dashboard (approval, limits, brand) are kept unless `overwrite` is set.
 */
export function syncAccountsFromConfig(db: Db, cfg: AppConfig, overwrite = false): Account[] {
  const now = new Date().toISOString();
  for (const a of cfg.accounts.accounts) {
    const existing = db.get('SELECT * FROM accounts WHERE id = ?', a.id);
    const settings = {
      ...a.settings,
      __fallbackProvider: a.fallbackProvider ?? null,
      __providerProfileId: a.providerProfileId ?? null,
      __notes: a.notes ?? null,
    };
    if (!existing || overwrite) {
      db.upsert('accounts', {
        id: a.id,
        platform: a.platform,
        handle: a.handle,
        display_name: a.displayName ?? a.handle,
        provider: a.provider,
        provider_account_id: a.providerAccountId ?? null,
        niche: a.niche,
        language: a.language,
        brand_json: JSON.stringify(a.brand),
        limits_json: JSON.stringify(a.limits),
        settings_json: JSON.stringify(settings),
        slideshows_enabled: a.slideshows ? 1 : 0,
        active: 1,
        health_json: existing?.health_json ?? null,
        synced_at: existing?.synced_at ?? null,
        created_at: existing?.created_at ?? now,
        updated_at: now,
      });
    } else {
      // Keep user edits; refresh provider identifiers that only the config knows.
      const kept = parseJson<any>(existing.settings_json, {});
      db.run(
        'UPDATE accounts SET provider = ?, provider_account_id = COALESCE(?, provider_account_id), settings_json = ?, updated_at = ? WHERE id = ?',
        a.provider,
        a.providerAccountId ?? null,
        JSON.stringify({...settings, ...kept, __fallbackProvider: settings.__fallbackProvider, __providerProfileId: settings.__providerProfileId, __notes: settings.__notes}),
        now,
        a.id,
      );
    }
  }
  return listAccounts(db);
}

export function listAccounts(db: Db, onlySlideshows = false): Account[] {
  const rows = db.all('SELECT * FROM accounts ORDER BY platform, handle');
  const all = rows.map(rowToAccount);
  return onlySlideshows ? all.filter((a) => a.slideshows && a.active) : all;
}

export function getAccount(db: Db, id: string): Account {
  const r = db.get('SELECT * FROM accounts WHERE id = ?', id);
  if (!r) throw new Error(`Compte inconnu : ${id}`);
  return rowToAccount(r);
}

export function updateAccount(db: Db, id: string, patch: {brand?: Partial<Brand>; limits?: Partial<Limits>; settings?: Partial<AccountSettings>; slideshows?: boolean; active?: boolean}): Account {
  const a = getAccount(db, id);
  const brand = {...a.brand, ...(patch.brand ?? {}), palette: {...a.brand.palette, ...(patch.brand?.palette ?? {})}, fonts: {...a.brand.fonts, ...(patch.brand?.fonts ?? {})}};
  const limits = {...a.limits, ...(patch.limits ?? {})};
  const settings = {...a.settings, ...(patch.settings ?? {})};
  db.run(
    'UPDATE accounts SET brand_json = ?, limits_json = ?, settings_json = ?, slideshows_enabled = ?, active = ?, updated_at = ? WHERE id = ?',
    JSON.stringify(brand),
    JSON.stringify(limits),
    JSON.stringify(settings),
    (patch.slideshows ?? a.slideshows) ? 1 : 0,
    (patch.active ?? a.active) ? 1 : 0,
    new Date().toISOString(),
    id,
  );
  db.event('account', `Réglages du compte ${id} modifiés`, {ref: id, data: patch});
  return getAccount(db, id);
}

/** Stores the health report of connected accounts (Zernio accounts_get_all_accounts_health JSON). */
export function recordHealth(db: Db, report: any): number {
  const accounts: any[] = report?.accounts ?? [];
  let n = 0;
  for (const h of accounts) {
    const r = db.get<{id: string}>('SELECT id FROM accounts WHERE provider_account_id = ? OR (platform = ? AND handle = ?)', h.accountId, h.platform, h.username);
    if (!r) continue;
    db.run('UPDATE accounts SET health_json = ?, synced_at = ? WHERE id = ?', JSON.stringify(h), new Date().toISOString(), r.id);
    n++;
  }
  return n;
}
