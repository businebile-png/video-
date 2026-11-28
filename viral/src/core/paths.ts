import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Root of the viral package (the folder that holds package.json). */
export const ROOT = path.resolve(here, '..', '..');

/** Mutable state lives in VIRAL_HOME (default: viral/var), never in the repository. */
export const VAR_DIR = process.env.VIRAL_HOME ? path.resolve(process.env.VIRAL_HOME) : path.join(ROOT, 'var');

export const PATHS = {
  root: ROOT,
  config: path.join(ROOT, 'config'),
  data: path.join(ROOT, 'data'),
  facts: path.join(ROOT, 'data', 'facts'),
  library: path.join(ROOT, 'data', 'library'),
  assets: path.join(ROOT, 'data', 'assets'),
  dashboardPublic: path.join(ROOT, 'src', 'dashboard', 'public'),
  var: VAR_DIR,
  db: process.env.VIRAL_DB ? path.resolve(process.env.VIRAL_DB) : path.join(VAR_DIR, 'viral.db'),
  renders: path.join(VAR_DIR, 'renders'),
  exports: path.join(VAR_DIR, 'exports'),
  imports: path.join(VAR_DIR, 'imports'),
  cache: path.join(VAR_DIR, 'cache'),
  logs: path.join(VAR_DIR, 'logs'),
  briefs: path.join(VAR_DIR, 'briefs'),
};

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, {recursive: true});
  return dir;
}

export function nodeModule(...parts: string[]): string {
  return path.join(ROOT, 'node_modules', ...parts);
}
