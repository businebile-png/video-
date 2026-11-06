import fs from 'node:fs';
import path from 'node:path';
import {PATHS} from './paths.js';

/**
 * Load KEY=VALUE lines from the repository's `.env` (git-ignored, local to this machine) into
 * process.env without overriding variables that are already set. Values are never logged.
 */
export function loadDotEnv(file = path.join(PATHS.root, '.env')): string[] {
  if (!fs.existsSync(file)) return [];
  const loaded: string[] = [];
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (process.env[key!] === undefined) {
      process.env[key!] = value!.replace(/^(['"])(.*)\1$/, '$2');
      loaded.push(key!);
    }
  }
  return loaded;
}
