import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Db} from '../src/core/db.js';
import {loadConfig} from '../src/core/config.js';
import {syncAccountsFromConfig} from '../src/core/accounts.js';

export function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viral-test-'));
  const db = new Db(path.join(dir, 'test.db'));
  const cfg = loadConfig();
  syncAccountsFromConfig(db, cfg);
  // The live accounts publish videos now; the carousel engine is still tested, on every account but YouTube.
  db.run("UPDATE accounts SET slideshows_enabled = 1 WHERE id != 'youtube-zzetu'");
  return {db, cfg, dir};
}

export const SAMPLE_TIKTOK = [
  {id: '1', desc: '5 erreurs qui sabotent ton tunnel de vente #tunneldevente', t: 1795000000, views: 12000, likes: 900, comments: 40, shares: 30, saves: 200, author: 'alpha', followers: 5000},
  {id: '2', desc: 'C’est quoi un tunnel de vente ? #business', t: 1795100000, views: 3000, likes: 120, comments: 4, shares: 2, saves: 20, author: 'alpha', followers: 5000},
  {id: '3', desc: 'Comment créer ta page de capture en 3 étapes', t: 1795200000, views: 800, likes: 30, comments: 2, shares: 1, saves: 10, author: 'beta', followers: 200},
  {id: '4', desc: 'Commente TUNNEL pour le tutoriel', t: 1795300000, views: 9000, likes: 400, comments: 300, shares: 60, saves: 300, author: 'beta', followers: 200},
  {id: '5', desc: 'Avant / après : ma page de vente', t: 1795400000, views: 200, likes: 5, comments: 0, shares: 0, saves: 1, author: 'gamma', followers: 50},
  {id: '6', desc: 'Il y a un an je ne savais pas ce qu’était un tunnel', t: 1795450000, views: 450, likes: 20, comments: 1, shares: 0, saves: 2, author: 'gamma', followers: 50},
];
