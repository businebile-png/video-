import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import {PATHS, ensureDir} from './paths.js';

// node:sqlite is built into Node >= 22.5. Loaded through require so bundlers (vitest) leave it alone.
const require = createRequire(import.meta.url);
const {DatabaseSync} = require('node:sqlite') as typeof import('node:sqlite');

export type Row = Record<string, any>;

/**
 * Schema version history. Each entry runs once, in order, inside a transaction.
 * The schema is plain SQL that also runs on PostgreSQL with minor type changes (see docs/ARCHITECTURE.md).
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    handle TEXT NOT NULL,
    display_name TEXT,
    provider TEXT NOT NULL,
    provider_account_id TEXT,
    niche TEXT,
    language TEXT NOT NULL DEFAULT 'fr',
    brand_json TEXT NOT NULL DEFAULT '{}',
    limits_json TEXT NOT NULL DEFAULT '{}',
    settings_json TEXT NOT NULL DEFAULT '{}',
    slideshows_enabled INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1,
    health_json TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS competitors (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    handle TEXT NOT NULL,
    display_name TEXT,
    followers INTEGER,
    niche TEXT,
    source TEXT,
    posts_count INTEGER NOT NULL DEFAULT 0,
    median_views REAL,
    median_engagement REAL,
    avg_score REAL,
    top_score REAL,
    tracked INTEGER NOT NULL DEFAULT 0,
    first_seen TEXT,
    last_seen TEXT,
    notes TEXT,
    UNIQUE(platform, handle)
  );
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    external_id TEXT NOT NULL,
    author TEXT,
    is_own INTEGER NOT NULL DEFAULT 0,
    account_id TEXT,
    competitor_id TEXT,
    slideshow_id TEXT,
    url TEXT,
    published_at TEXT,
    collected_at TEXT NOT NULL,
    source TEXT NOT NULL,
    query TEXT,
    language TEXT,
    media_type TEXT,
    slide_count INTEGER,
    duration_s REAL,
    text TEXT,
    hook TEXT,
    hashtags_json TEXT,
    views INTEGER,
    likes INTEGER,
    comments INTEGER,
    shares INTEGER,
    saves INTEGER,
    followers INTEGER,
    is_paid INTEGER NOT NULL DEFAULT 0,
    hook_type TEXT,
    structure TEXT,
    cta_type TEXT,
    topic TEXT,
    category TEXT,
    emotions_json TEXT,
    features_json TEXT,
    score REAL,
    relative_perf REAL,
    engagement_rate REAL,
    score_parts_json TEXT,
    UNIQUE(platform, external_id)
  );
  CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(platform, author);
  CREATE INDEX IF NOT EXISTS idx_posts_own ON posts(is_own, account_id);
  CREATE INDEX IF NOT EXISTS idx_posts_score ON posts(score);
  CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at);
  CREATE INDEX IF NOT EXISTS idx_posts_hook ON posts(hook_type);
  CREATE INDEX IF NOT EXISTS idx_posts_topic ON posts(topic);
  CREATE TABLE IF NOT EXISTS post_metrics (
    post_id TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER,
    PRIMARY KEY (post_id, captured_at)
  );
  CREATE TABLE IF NOT EXISTS patterns (
    platform TEXT NOT NULL,
    dimension TEXT NOT NULL,
    value TEXT NOT NULL,
    n INTEGER NOT NULL,
    authors INTEGER NOT NULL,
    mean_score REAL,
    shrunk_score REAL,
    lift REAL,
    ci_low REAL,
    ci_high REAL,
    top_share REAL,
    examples_json TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (platform, dimension, value)
  );
  CREATE TABLE IF NOT EXISTS trends (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    recent_n INTEGER, previous_n INTEGER,
    recent_share REAL, previous_share REAL,
    growth REAL, mean_score REAL,
    status TEXT NOT NULL,
    detected_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ideas (
    id TEXT PRIMARY KEY,
    batch_id TEXT,
    account_id TEXT,
    niche TEXT, topic TEXT, angle TEXT, hook TEXT, hook_type TEXT, structure TEXT,
    template TEXT, format TEXT, slide_count INTEGER, tone TEXT, style TEXT, language TEXT,
    predicted REAL, rationale TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    engine TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ideas_batch ON ideas(batch_id);
  CREATE TABLE IF NOT EXISTS slideshows (
    id TEXT PRIMARY KEY,
    idea_id TEXT,
    batch_id TEXT,
    account_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    title TEXT, hook TEXT, hook_type TEXT, structure TEXT, topic TEXT,
    template TEXT NOT NULL,
    format TEXT NOT NULL,
    width INTEGER, height INTEGER,
    language TEXT, tone TEXT, style TEXT,
    slides_json TEXT NOT NULL,
    caption TEXT, hashtags_json TEXT, cta TEXT, fact_ids_json TEXT,
    status TEXT NOT NULL,
    qc_json TEXT, qc_score REAL,
    content_hash TEXT, text_fingerprint TEXT,
    engine TEXT, model TEXT, predicted REAL,
    approved_by TEXT, approved_at TEXT, rejected_reason TEXT,
    render_dir TEXT, export_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ss_account ON slideshows(account_id, status);
  CREATE INDEX IF NOT EXISTS idx_ss_hash ON slideshows(content_hash);
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    slideshow_id TEXT NOT NULL,
    slide_index INTEGER NOT NULL,
    path TEXT NOT NULL,
    width INTEGER, height INTEGER, bytes INTEGER, sha256 TEXT,
    public_url TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_images_ss ON images(slideshow_id);
  CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    description TEXT,
    config_json TEXT NOT NULL,
    built_in INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS schedule (
    id TEXT PRIMARY KEY,
    slideshow_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    provider TEXT NOT NULL,
    scheduled_for TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_post_id TEXT,
    permalink TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    last_error TEXT,
    next_attempt_at TEXT,
    published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_schedule_account ON schedule(account_id, scheduled_for);
  CREATE INDEX IF NOT EXISTS idx_schedule_status ON schedule(status);
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    data_json TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, at);
  CREATE TABLE IF NOT EXISTS ai_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    role TEXT, provider TEXT, model TEXT, purpose TEXT,
    tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL, latency_ms INTEGER,
    status TEXT NOT NULL,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ai_calls_day ON ai_calls(provider, at);
  CREATE TABLE IF NOT EXISTS learning (
    scope TEXT NOT NULL,
    dimension TEXT NOT NULL,
    value TEXT NOT NULL,
    n INTEGER NOT NULL,
    mean REAL NOT NULL,
    m2 REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope, dimension, value)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    summary_json TEXT
  );
  `,
  `
  ALTER TABLE posts ADD COLUMN provider_post_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_posts_provider ON posts(provider_post_id);
  `,
  `
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    slideshow_id TEXT NOT NULL,
    path TEXT NOT NULL,
    width INTEGER, height INTEGER, fps INTEGER,
    duration_s REAL, bytes INTEGER, sha256 TEXT,
    public_url TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_videos_ss ON videos(slideshow_id);
  `,
  // 4 — video factory: a video project is a content row (kind = 'video') with its script and choices in
  // video_json; renders, media rights, production batches, jobs and paid-provider calls get their own tables.
  `
  ALTER TABLE slideshows ADD COLUMN kind TEXT NOT NULL DEFAULT 'carousel';
  ALTER TABLE slideshows ADD COLUMN video_json TEXT;
  ALTER TABLE slideshows ADD COLUMN parent_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_ss_kind ON slideshows(kind, account_id, status);
  CREATE TABLE videos_v2 (
    id TEXT PRIMARY KEY,
    slideshow_id TEXT NOT NULL,
    aspect TEXT NOT NULL DEFAULT '9:16',
    path TEXT NOT NULL,
    width INTEGER, height INTEGER, fps INTEGER,
    duration_s REAL, bytes INTEGER, sha256 TEXT,
    poster_path TEXT, subtitles_path TEXT,
    public_url TEXT, cover_url TEXT,
    qc_status TEXT, qc_json TEXT,
    render_ms INTEGER, frame_hashes TEXT,
    cost_eur REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  INSERT INTO videos_v2 (id, slideshow_id, path, width, height, fps, duration_s, bytes, sha256, public_url, created_at)
    SELECT id, slideshow_id, path, width, height, fps, duration_s, bytes, sha256, public_url, created_at FROM videos;
  DROP TABLE videos;
  ALTER TABLE videos_v2 RENAME TO videos;
  CREATE INDEX IF NOT EXISTS idx_videos_ss ON videos(slideshow_id);
  CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    source_id TEXT, source_url TEXT, author TEXT, author_url TEXT,
    path TEXT,
    license TEXT NOT NULL, license_url TEXT,
    commercial_ok INTEGER NOT NULL,
    attribution TEXT,
    meta_json TEXT,
    cost_eur REAL NOT NULL DEFAULT 0,
    sha256 TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_assets_source ON media_assets(provider, source_id);
  CREATE TABLE IF NOT EXISTS slideshow_assets (
    slideshow_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY (slideshow_id, asset_id, role)
  );
  CREATE TABLE IF NOT EXISTS video_batches (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    niche TEXT,
    quantity INTEGER NOT NULL,
    params_json TEXT NOT NULL,
    status TEXT NOT NULL,
    budget_eur REAL,
    spent_eur REAL NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS video_jobs (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    slideshow_id TEXT,
    position INTEGER NOT NULL,
    params_json TEXT NOT NULL,
    status TEXT NOT NULL,
    step TEXT,
    progress REAL NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    cost_eur REAL NOT NULL DEFAULT 0,
    log_json TEXT,
    started_at TEXT, finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_batch ON video_jobs(batch_id, position);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON video_jobs(status);
  CREATE TABLE IF NOT EXISTS provider_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    provider TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT,
    ok INTEGER NOT NULL,
    units REAL, unit TEXT,
    cost_eur REAL NOT NULL DEFAULT 0,
    ms INTEGER,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pcalls ON provider_calls(provider, at);
  ALTER TABLE posts ADD COLUMN avg_watch_s REAL;
  ALTER TABLE posts ADD COLUMN completion_rate REAL;
  ALTER TABLE posts ADD COLUMN new_followers INTEGER;
  `,
];

export class Db {
  readonly sql: InstanceType<typeof DatabaseSync>;
  readonly file: string;

  constructor(file: string = PATHS.db) {
    this.file = file;
    if (file !== ':memory:') ensureDir(path.dirname(file));
    this.sql = new DatabaseSync(file);
    this.sql.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate(): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    const row = this.get<{value: string}>("SELECT value FROM meta WHERE key = 'schema_version'");
    let version = row ? Number(row.value) : 0;
    while (version < MIGRATIONS.length) {
      this.tx(() => {
        this.sql.exec(MIGRATIONS[version]);
        version++;
        this.run("INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(version));
      });
    }
  }

  all<T = Row>(query: string, ...params: any[]): T[] {
    return this.sql.prepare(query).all(...params.map(bind)) as T[];
  }

  get<T = Row>(query: string, ...params: any[]): T | undefined {
    return this.sql.prepare(query).get(...params.map(bind)) as T | undefined;
  }

  run(query: string, ...params: any[]): {changes: number; lastInsertRowid: number | bigint} {
    const r = this.sql.prepare(query).run(...params.map(bind));
    return {changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid};
  }

  tx<T>(fn: () => T): T {
    this.sql.exec('BEGIN');
    try {
      const out = fn();
      this.sql.exec('COMMIT');
      return out;
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  /** Insert or replace a row from a plain object (keys = column names). */
  upsert(table: string, row: Row, conflict: string[] = ['id']): void {
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(', ');
    const updates = cols.filter((c) => !conflict.includes(c)).map((c) => `${c} = excluded.${c}`);
    const q = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(${conflict.join(', ')}) ${
      updates.length ? `DO UPDATE SET ${updates.join(', ')}` : 'DO NOTHING'
    }`;
    this.run(q, ...cols.map((c) => row[c]));
  }

  event(kind: string, message: string, opts: {ref?: string; level?: 'info' | 'warn' | 'error'; data?: unknown} = {}): void {
    this.run(
      'INSERT INTO events(at, kind, ref, level, message, data_json) VALUES (?, ?, ?, ?, ?, ?)',
      new Date().toISOString(),
      kind,
      opts.ref ?? null,
      opts.level ?? 'info',
      message,
      opts.data === undefined ? null : JSON.stringify(opts.data),
    );
  }

  setting<T>(key: string, fallback: T): T {
    const r = this.get<{value_json: string}>('SELECT value_json FROM settings WHERE key = ?', key);
    if (!r) return fallback;
    try {
      return JSON.parse(r.value_json) as T;
    } catch {
      return fallback;
    }
  }

  setSetting(key: string, value: unknown): void {
    this.upsert('settings', {key, value_json: JSON.stringify(value), updated_at: new Date().toISOString()}, ['key']);
  }

  close(): void {
    this.sql.close();
  }
}

function bind(v: any): any {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object' && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

let shared: Db | null = null;

export function openDb(file?: string): Db {
  if (file) return new Db(file);
  if (!shared) shared = new Db();
  return shared;
}

export function dbExists(): boolean {
  return fs.existsSync(PATHS.db);
}
