import fs from 'node:fs';
import path from 'node:path';
import {zipSync, strToU8} from 'fflate';
import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {PATHS, ensureDir} from '../core/paths.js';
import {nowIso, parseJson} from '../core/util.js';
import {photoTitle} from '../generate/captions.js';
import {Renderer} from './renderer.js';

/**
 * Publication-ready export of one slideshow: the JPEG slides, the caption, a metadata file and a short how-to
 * for manual posting (used when a platform refuses automatic publication). Optional PDF for LinkedIn documents.
 */
export async function exportSlideshow(db: Db, cfg: AppConfig, id: string, opts: {pdf?: boolean} = {}): Promise<{zip: string; pdf?: string; files: number}> {
  const ss = db.get('SELECT * FROM slideshows WHERE id = ?', id);
  if (!ss) throw new Error(`Carrousel inconnu : ${id}`);
  const images = db.all('SELECT * FROM images WHERE slideshow_id = ? ORDER BY slide_index', id);
  if (!images.length) throw new Error(`${id} : pas encore rendu (lance « render » d'abord)`);
  const account = db.get('SELECT * FROM accounts WHERE id = ?', ss.account_id);
  const files: Record<string, Uint8Array> = {};
  for (const im of images) files[path.basename(im.path)] = fs.readFileSync(path.join(PATHS.var, im.path));
  const meta = {
    id,
    compte: account ? `${account.platform} @${account.handle}` : ss.account_id,
    titre: ss.hook,
    titrePhotoTikTok: photoTitle(ss.hook),
    modele: ss.template,
    format: ss.format,
    taille: `${ss.width}×${ss.height}`,
    slides: images.length,
    hashtags: parseJson(ss.hashtags_json, []),
    faits: parseJson(ss.fact_ids_json, []),
    mentionPublicite: cfg.compliance.disclosure.badge,
    exporteLe: nowIso(),
  };
  files['legende.txt'] = strToU8(ss.caption ?? '');
  files['infos.json'] = strToU8(JSON.stringify(meta, null, 2));
  files['A-LIRE.txt'] = strToU8(
    [
      'Publication manuelle',
      '',
      `1. Ouvre l'application ${account?.platform ?? ''} sur le compte @${account?.handle ?? ''}.`,
      `2. Crée un carrousel avec les ${images.length} images dans l'ordre (slide-01, slide-02…).`,
      '3. Colle la légende de legende.txt (elle commence par la mention « Publicité » : ne la retire pas).',
      account?.platform === 'tiktok' ? '4. Active « Contenu de marque » (partenariat) dans les réglages de la publication.' : '4. Active le libellé « Partenariat rémunéré » si la plateforme le propose.',
      '5. Publie, puis indique le lien du post dans le tableau de bord (Publications → « Publiée à la main »).',
    ].join('\n'),
  );
  ensureDir(PATHS.exports);
  const zipFile = path.join(PATHS.exports, `${id}.zip`);
  fs.writeFileSync(zipFile, zipSync(files, {level: 6}));
  let pdf: string | undefined;
  if (opts.pdf) {
    const r = new Renderer();
    try {
      await r.open();
      const html = `<!doctype html><html><head><style>@page{size:${ss.width}px ${ss.height}px;margin:0}body{margin:0}img{display:block;width:${ss.width}px;height:${ss.height}px;page-break-after:always}</style></head><body>${images
        .map((im) => `<img src="file://${path.join(PATHS.var, im.path)}">`)
        .join('')}</body></html>`;
      const tmp = path.join(PATHS.exports, `${id}.pdf.html`);
      fs.writeFileSync(tmp, html);
      const page = await (r as any).browser.newPage();
      await page.goto('file://' + tmp, {waitUntil: 'load'});
      pdf = path.join(PATHS.exports, `${id}.pdf`);
      await page.pdf({path: pdf, width: `${ss.width}px`, height: `${ss.height}px`, printBackground: true});
      await page.close();
      fs.rmSync(tmp, {force: true});
    } finally {
      await r.close();
    }
  }
  db.run('UPDATE slideshows SET export_path = ?, updated_at = ? WHERE id = ?', path.relative(PATHS.var, zipFile), nowIso(), id);
  return {zip: zipFile, pdf, files: Object.keys(files).length};
}
