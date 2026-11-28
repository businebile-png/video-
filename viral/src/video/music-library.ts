import fs from 'node:fs';
import path from 'node:path';
import {ROOT, ensureDir} from '../core/paths.js';
import {sha256} from '../core/util.js';
import type {MusicMood} from './types.js';

/**
 * Licensed tracks (data/assets/music/manifest.json). A track enters only with its licence and a proof, and states
 * on which networks it may be published; the factory never picks a track whose licence does not cover commercial
 * use AND the network of the account. Tracks registered for Content ID are refused (they get videos claimed).
 * Without licensed tracks, the machine composes original music (no rights to clear).
 */

export interface LicensedTrack {
  id: string;
  title: string;
  artist: string;
  file: string;
  license: string;
  licenseUrl?: string;
  proof: string;
  commercial: boolean;
  platforms: string[];
  contentId: boolean;
  moods: MusicMood[];
  attribution?: string;
  sha256?: string;
  addedAt: string;
}

/** Licences accepted as such; anything else needs a purchase or subscription proof naming the networks. */
const OPEN_LICENSES = [/^cc0/i, /^cc[- ]by( 4\.0)?$/i, /pixabay/i, /domaine public|public domain/i];
const REFUSED = [/\bnc\b|non[- ]commercial/i, /\bnd\b|no[- ]?deriv/i, /cc[- ]by[- ]sa/i];

const DIR = path.join(ROOT, 'data', 'assets', 'music');
const MANIFEST = path.join(DIR, 'manifest.json');

export function loadTracks(): LicensedTrack[] {
  if (!fs.existsSync(MANIFEST)) return [];
  return (JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).tracks ?? []) as LicensedTrack[];
}

export function checkTrack(t: Omit<LicensedTrack, 'addedAt' | 'sha256'>): string[] {
  const problems: string[] = [];
  if (REFUSED.some((r) => r.test(t.license))) problems.push(`licence « ${t.license} » : usage commercial ou modification interdits`);
  if (!t.commercial) problems.push('usage commercial non autorisé');
  if (!t.proof?.trim()) problems.push('preuve de licence manquante (page, facture ou certificat)');
  if (!OPEN_LICENSES.some((r) => r.test(t.license)) && !t.platforms.length) problems.push('licence payante : préciser les réseaux couverts');
  if (/cc[- ]by/i.test(t.license) && !t.attribution) problems.push('licence CC BY : le crédit à afficher est obligatoire');
  if (t.contentId) problems.push('piste déclarée à Content ID : les vidéos seraient revendiquées');
  return problems;
}

export function addTrack(src: string, meta: Omit<LicensedTrack, 'addedAt' | 'sha256' | 'file'>): LicensedTrack {
  if (!fs.existsSync(src)) throw new Error(`Fichier introuvable : ${src}`);
  const problems = checkTrack({...meta, file: src});
  if (problems.length) throw new Error(`Piste refusée : ${problems.join(' ; ')}`);
  ensureDir(DIR);
  const file = `${meta.id}${path.extname(src)}`;
  fs.copyFileSync(src, path.join(DIR, file));
  const track: LicensedTrack = {...meta, file, sha256: sha256(fs.readFileSync(src)), addedAt: new Date().toISOString()};
  const tracks = loadTracks().filter((t) => t.id !== meta.id);
  tracks.push(track);
  fs.writeFileSync(MANIFEST, JSON.stringify({tracks}, null, 2) + '\n');
  return track;
}

/** A licensed track for this mood and network, if one is allowed there. */
export function pickTrack(mood: MusicMood, platform: string, rand: () => number): LicensedTrack | null {
  const ok = loadTracks().filter((t) => !checkTrack(t).length && (!t.platforms.length || t.platforms.includes(platform)) && fs.existsSync(path.join(DIR, t.file)));
  const fit = ok.filter((t) => t.moods.includes(mood));
  const pool = fit.length ? fit : ok;
  return pool.length ? pool[Math.floor(rand() * pool.length)] : null;
}

export const trackPath = (t: LicensedTrack) => path.join(DIR, t.file);
