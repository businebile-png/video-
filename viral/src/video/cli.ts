import type {Db} from '../core/db.js';
import type {AppConfig} from '../core/config.js';
import {getAccount} from '../core/accounts.js';
import {parseJson} from '../core/util.js';
import {loadMedia, providerCosts} from './media.js';
import {voiceStatus} from './voice.js';
import {aiVideoProviders} from './aigen.js';
import {searchStock} from './stock.js';
import {formatList} from './script.js';
import {batchStatus, cancelBatch, createBatch, retryFailed, runBatch, type BatchRequest} from './factory.js';
import {createProject, stepMusic, stepRender, stepVisuals, stepVoice} from './produce.js';
import {runVideoQc} from './qc.js';
import {adaptProject} from './platforms.js';
import {exportVideo} from './export.js';
import type {Aspect, DurationTarget, VideoFormatId} from './types.js';
import type {Slide, SlideshowDraft} from '../generate/types.js';

export const VIDEO_HELP = `
  Vidéos        video:formats · video:providers (essais réels des voix, banques d'images, moteurs IA)
                video:new --account <id> [--format educatif] [--duration 15|30|45|60|90] [--aspect 9:16|1:1|16:9]
                          [--voice auto|claire|siwis|hugo] [--visuals auto|motion|stock|images|ai] [--topic x] [--engine auto|composer]
                factory:run --account <id> --quantity 100 [--formats a,b] [--durations 30,45] [--budget 5] [--draft]
                factory:status [lot] · factory:resume <lot> · factory:retry <lot> · factory:cancel <lot>
                video:from <id> --format <f> --duration 30 (un carrousel devient une vidéo) · video:produce <id…>
                video:render <id> [--aspect 1:1|16:9] [--draft] · video:qc <id> [--aspect] · video:adapt <id> --to <compte>
                video:export <id> (paquet de publication manuelle) · video:costs`;

type Out = (x: unknown) => void;

export async function videoCommand(cmd: string, pos: string[], flags: Record<string, string | boolean>, db: Db, cfg: AppConfig, out: Out): Promise<boolean> {
  const list = (v: unknown) => (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined);
  const log = (l: string) => console.error(l);
  const produce = async (id: string) => {
    const steps: Record<string, unknown> = {};
    steps.voix = await stepVoice(db, id);
    steps.visuels = await stepVisuals(db, cfg, id);
    steps.musique = stepMusic(db, id);
    const r = await stepRender(db, cfg, id, {fps: flags.fps ? Number(flags.fps) : undefined, workers: flags.workers ? Number(flags.workers) : undefined, draft: !!flags.draft, onProgress: (d, t) => d % 150 === 0 && log(`  rendu ${d}/${t}`)});
    steps.montage = {fichier: r.file, duree: r.duration, images: r.frames, secondes: Math.round(r.ms / 1000), lufs: r.lufs};
    const q = runVideoQc(db, cfg, id);
    steps.controle = {ok: q.ok, score: q.score, erreurs: q.errors, remarques: q.warnings, mesures: q.measures};
    return steps;
  };
  switch (cmd) {
    case 'video:formats':
      out(formatList());
      return true;
    case 'video:providers': {
      const voices = [];
      for (const v of loadMedia().voices) {
        const st = await voiceStatus(v, true);
        voices.push({voix: v.label, moteur: v.engine, langue: v.language, genre: v.gender, licence: v.license, disponible: st.ok, raison: st.reason ?? null, detail: st.detail ?? null});
      }
      let stock: unknown;
      try {
        const r = await searchStock(db, 'laptop desk', {perPage: 3, ref: 'video:providers'});
        stock = {ok: true, resultats: r.length};
      } catch (e) {
        stock = {ok: false, erreur: (e as Error).message};
      }
      out({voix: voices, banques: {essai: stock, sources: loadMedia().stock.map((s) => ({id: s.id, cle: s.keyEnv ? !!process.env[s.keyEnv] : null, desactivee: s.disabled ?? null, licence: s.license}))}, videoIA: aiVideoProviders().map((p) => ({id: p.id, moteur: p.label, cle: p.configured, deja_teste: p.tested, prix_eur_s: p.eurPerSecond})), musique: loadMedia().music});
      return true;
    }
    case 'video:new':
    case 'factory:run': {
      const accountId = (flags.account as string) ?? pos[0];
      if (!accountId) throw new Error('--account requis');
      const req: BatchRequest = {
        accountId,
        quantity: cmd === 'video:new' ? Number(flags.quantity ?? 1) : Number(flags.quantity ?? 10),
        formats: (list(flags.formats) ?? list(flags.format)) as VideoFormatId[] | undefined,
        durations: (list(flags.durations) ?? list(flags.duration))?.map(Number) as DurationTarget[] | undefined,
        aspect: flags.aspect as Aspect | undefined,
        voice: flags.voice as string | undefined,
        visuals: flags.visuals as any,
        music: flags.music as any,
        engine: (flags.engine as any) ?? 'auto',
        budgetEur: flags.budget ? Number(flags.budget) : 0,
        topic: flags.topic as string | undefined,
        draft: !!flags.draft,
      };
      const b = createBatch(db, req);
      log(`Lot ${b.batchId} : ${b.plan.map((p) => `${p.format} ${p.duration} s`).join(', ')}`);
      const r = await runBatch(db, cfg, b.batchId, {fps: flags.fps ? Number(flags.fps) : undefined, workers: flags.workers ? Number(flags.workers) : undefined, log});
      const s = batchStatus(db, b.batchId)[0];
      out({lot: b.batchId, ...r, videos: s.jobs.map((j: any) => ({position: j.position + 1, video: j.slideshow_id, statut: j.status, erreur: j.error, journal: j.log}))});
      return true;
    }
    case 'factory:status':
      out(batchStatus(db, pos[0]).map((b: any) => ({lot: b.id, compte: b.account_id, statut: b.status, faites: b.done, echouees: b.failed, quantite: b.quantity, depense_eur: b.spent_eur, budget_eur: b.budget_eur, videos: b.jobs.map((j: any) => ({n: j.position + 1, video: j.slideshow_id, statut: j.status, etape: j.step, progression: Math.round(j.progress * 100), erreur: j.error}))})));
      return true;
    case 'factory:resume':
      out(await runBatch(db, cfg, pos[0], {log}));
      return true;
    case 'factory:retry':
      out({relancees: retryFailed(db, pos[0]), ...(await runBatch(db, cfg, pos[0], {log}))});
      return true;
    case 'factory:cancel':
      cancelBatch(db, pos[0]);
      out({annule: pos[0]});
      return true;
    case 'video:from': {
      const id = pos[0];
      const row = db.get('SELECT * FROM slideshows WHERE id = ?', id);
      if (!row) throw new Error(`Contenu inconnu : ${id}`);
      const draft: SlideshowDraft = {
        accountId: row.account_id,
        platform: row.platform,
        topic: row.topic,
        topicLabel: cfg.niche.topics.find((t) => t.id === row.topic)?.label ?? row.topic,
        structure: row.structure,
        hookType: row.hook_type,
        hook: row.hook,
        title: row.title,
        template: row.template,
        format: '9:16',
        tone: row.tone ?? 'direct',
        style: row.style ?? row.template,
        language: row.language ?? 'fr',
        slides: parseJson<Slide[]>(row.slides_json, []),
        caption: row.caption ?? '',
        hashtags: parseJson<string[]>(row.hashtags_json, []),
        cta: row.cta ?? '',
        factIds: parseJson<string[]>(row.fact_ids_json, []),
        engine: row.engine ?? 'composer',
      };
      db.run("DELETE FROM schedule WHERE slideshow_id = ? AND status = 'cancelled'", id);
      createProject(db, cfg, draft, {format: (flags.format as VideoFormatId) ?? 'educatif', duration: Number(flags.duration ?? 30) as DurationTarget, aspect: flags.aspect as Aspect | undefined, voice: flags.voice as string | undefined, visuals: flags.visuals as any}, id);
      out({video: id, ...(flags['no-produce'] ? {} : await produce(id))});
      return true;
    }
    case 'video:produce': {
      const res: Record<string, unknown> = {};
      for (const id of pos) res[id] = await produce(id);
      out(res);
      return true;
    }
    case 'video:render': {
      const r = await stepRender(db, cfg, pos[0], {aspect: flags.aspect as Aspect | undefined, draft: !!flags.draft, fps: flags.fps ? Number(flags.fps) : undefined});
      const q = runVideoQc(db, cfg, pos[0], (flags.aspect as string) ?? undefined);
      out({...r, controle: {ok: q.ok, score: q.score, erreurs: q.errors, remarques: q.warnings}});
      return true;
    }
    case 'video:qc':
      out(runVideoQc(db, cfg, pos[0], flags.aspect as string | undefined));
      return true;
    case 'video:adapt': {
      const target = flags.to as string;
      getAccount(db, target);
      const a = adaptProject(db, cfg, pos[0], target);
      const steps: Record<string, unknown> = {};
      if (a.revoice) steps.voix = await stepVoice(db, a.id);
      steps.musique = stepMusic(db, a.id);
      const r = await stepRender(db, cfg, a.id, {});
      const q = runVideoQc(db, cfg, a.id);
      out({copie: a.id, revoix: a.revoice, ...steps, fichier: r.file, controle: {ok: q.ok, score: q.score, erreurs: q.errors}});
      return true;
    }
    case 'video:export':
      out(exportVideo(db, cfg, pos[0]));
      return true;
    case 'video:costs':
      out({fournisseurs: providerCosts(db), lots: db.all('SELECT id, account_id, quantity, done, failed, budget_eur, spent_eur, status FROM video_batches ORDER BY created_at DESC LIMIT 20')});
      return true;
    default:
      return false;
  }
}
