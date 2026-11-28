import fs from 'node:fs';
import path from 'node:path';
import {zipSync, strToU8} from 'fflate';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {PATHS, ensureDir} from '../core/paths.js';
import {parseJson} from '../core/util.js';
import {loadSpec} from './produce.js';
import {profileFor, rightsCheck, youtubeTitle} from './platforms.js';

/**
 * Manual publication package, for networks without automatic publication (or when it failed): the MP4,
 * its cover, the subtitles, the description to paste, the title (YouTube) and the credits / rights sheet.
 */
export function exportVideo(db: Db, cfg: AppConfig, id: string): {zip: string; files: string[]} {
  const {row, spec, account} = loadSpec(db, id);
  const vids = db.all('SELECT * FROM videos WHERE slideshow_id = ? ORDER BY aspect', id);
  if (!vids.length) throw new Error('Aucune vidéo montée : lancer la production d’abord');
  const profile = profileFor(cfg, account);
  const rights = rightsCheck(db, id);
  const files: Record<string, Uint8Array> = {};
  for (const v of vids) {
    const tag = v.aspect.replace(':', 'x');
    const mp4 = path.join(PATHS.var, v.path);
    if (fs.existsSync(mp4)) files[`video-${tag}.mp4`] = fs.readFileSync(mp4);
    if (v.poster_path && fs.existsSync(path.join(PATHS.var, v.poster_path))) files[`couverture-${tag}.jpg`] = fs.readFileSync(path.join(PATHS.var, v.poster_path));
    if (v.subtitles_path && fs.existsSync(path.join(PATHS.var, v.subtitles_path))) {
      files[`sous-titres-${tag}.srt`] = fs.readFileSync(path.join(PATHS.var, v.subtitles_path));
      const vtt = path.join(PATHS.var, v.subtitles_path).replace(/\.srt$/, '.vtt');
      if (fs.existsSync(vtt)) files[`sous-titres-${tag}.vtt`] = fs.readFileSync(vtt);
    }
  }
  const qc = parseJson<any>(row.qc_json, {}).video;
  files['description.txt'] = strToU8(row.caption ?? '');
  files['titre.txt'] = strToU8(profile.titleMax ? youtubeTitle(spec.script, profile.titleMax) : spec.script.hook);
  files['LISEZMOI.txt'] = strToU8(
    [
      `Vidéo ${id} — ${account.platform} @${account.handle} (${profile.label})`,
      `Format : ${spec.format}, ${spec.aspect}, ${vids.map((v) => `${v.duration_s?.toFixed?.(1)} s`).join(' / ')}`,
      `Contrôle qualité : ${qc ? `${qc.ok ? 'réussi' : 'ÉCHEC'} (${qc.score}/100)` : 'non fait'}`,
      '',
      'À cocher lors de la publication :',
      '- Contenu de marque / partenariat rémunéré (lien affilié Systeme.io).',
      spec.voice.mode === 'voix' ? '- Contenu généré par IA (voix de synthèse).' : '- Aucune voix de synthèse.',
      '- La mention « Publicité » est à l’image pendant toute la vidéo et en tête de la description.',
      '',
      'Droits des médias :',
      ...db
        .all('SELECT a.kind, a.provider, a.license, a.source_url, a.author, sa.role FROM slideshow_assets sa JOIN media_assets a ON a.id = sa.asset_id WHERE sa.slideshow_id = ? ORDER BY sa.role', id)
        .map((a) => `- ${a.role} : ${a.provider}${a.author ? ` (${a.author})` : ''} — ${a.license}${a.source_url ? ` — ${a.source_url}` : ''}`),
      ...(rights.credits.length ? ['', `Crédits : ${rights.credits.join(' · ')}`] : []),
    ].join('\n'),
  );
  const dir = ensureDir(path.join(PATHS.exports, 'videos'));
  const zip = path.join(dir, `${id}.zip`);
  fs.writeFileSync(zip, zipSync(files, {level: 0}));
  db.run('UPDATE slideshows SET export_path = ? WHERE id = ?', path.relative(PATHS.var, zip), id);
  return {zip, files: Object.keys(files)};
}
