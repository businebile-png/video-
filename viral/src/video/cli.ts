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
                video:convert [<id…>] --account <compte> [--voice claire] [--schedule] (carrousels validés → vidéos → calendrier)
                video:render <id> [--aspect 1:1|16:9] [--draft] · video:qc <id> [--aspect] · video:caption <id> · video:adapt <id> --to <compte>
                video:export <id> (paquet de publication manuelle) · video:costs
                intel:videos <réponses.json…> (analyse des vidéos concurrentes) · intel:video-report
  Audio         audio:voices · audio:previews [--voices claire,hugo] (aperçus d'écoute : voix, musiques, effets)
                audio:preview --voice <id> [--text "…"] [--speed 1.1] [--pitch -2] [--language en-US]
                audio:set <compte> [--voice hugo] [--music-category auto|cinematic|…] [--music-volume 0.3] [--sfx true]
                       [--captions tiktok|mot|phrase|documentaire|minimal|cinematique] [--caption-color #FFF] [--auto true]
                music:list · music:add <fichier> --id x --title t --artist a --license "CC0" --proof <url> [--platforms tiktok,instagram]
                       [--moods cinematic,chill] [--attribution "…"]`;

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
    case 'video:convert': {
      // Approved carousels become videos for one account (format chosen from the structure), then go to the calendar.
      const {getAccount} = await import('../core/accounts.js');
      const {schedule} = await import('../publish/scheduler.js');
      const {runDue} = await import('../publish/runner.js');
      const target = getAccount(db, String(flags.account ?? 'tiktok-12eure21'));
      const ids = pos.length ? pos : db.all("SELECT id FROM slideshows WHERE status = 'approved' OR (kind = 'video' AND status = 'draft') ORDER BY kind DESC, created_at").map((r) => r.id as string);
      const FORMAT: Record<string, VideoFormatId> = {histoire: 'storytelling', erreurs: 'business', etapes: 'educatif', liste: 'educatif', faits: 'faits', 'mythe-realite': 'business', 'avant-apres': 'motivation', definition: 'documentaire'};
      const results: unknown[] = [];
      for (const id of ids) {
        const t0 = Date.now();
        try {
          const row = db.get('SELECT * FROM slideshows WHERE id = ?', id);
          if (!row) throw new Error('contenu inconnu');
          if (row.kind !== 'video') {
            const slides = parseJson<Slide[]>(row.slides_json, []);
            const items = slides.filter((x) => x.kind === 'item').length;
            const format: VideoFormatId = row.structure === 'liste' && items === 5 ? 'top5' : FORMAT[row.structure] ?? 'educatif';
            const duration = (format === 'documentaire' || format === 'storytelling' ? 45 : 30) as DurationTarget;
            const draft: SlideshowDraft = {accountId: target.id, platform: target.platform, topic: row.topic, topicLabel: cfg.niche.topics.find((x) => x.id === row.topic)?.label ?? row.topic, structure: row.structure, hookType: row.hook_type, hook: row.hook, title: row.title, template: row.template, format: '9:16', tone: row.tone ?? 'direct', style: row.style ?? row.template, language: row.language ?? 'fr', slides, caption: row.caption ?? '', hashtags: parseJson<string[]>(row.hashtags_json, []), cta: row.cta ?? '', factIds: parseJson<string[]>(row.fact_ids_json, []), engine: row.engine ?? 'composer'};
            db.run('UPDATE slideshows SET account_id = ?, platform = ? WHERE id = ?', target.id, target.platform, id);
            createProject(db, cfg, draft, {format, duration, voice: (flags.voice as string) ?? 'claire', visuals: format === 'faits' ? 'motion' : 'stock'}, id);
            const steps = await produce(id);
            if (!(steps.controle as any).ok) throw new Error(`contrôle qualité : ${(steps.controle as any).erreurs.map((e: any) => e.message).join(' ; ')}`);
          } else if (!['approved', 'scheduled', 'published'].includes(row.status)) {
            // A video project left unfinished (stopped run): finish its production.
            const steps = await produce(id);
            if (!(steps.controle as any).ok) throw new Error(`contrôle qualité : ${(steps.controle as any).erreurs.map((e: any) => e.message).join(' ; ')}`);
          }
          let planned: unknown = null;
          if (flags.schedule) {
            const sch = schedule(db, cfg, id);
            const rep = await runDue(db, cfg, {only: sch.id, leadMinutes: Number(flags['lead-hours'] ?? 400) * 60});
            const row2 = db.get('SELECT status, provider_post_id, last_error FROM schedule WHERE id = ?', sch.id);
            planned = {creneau: sch.at, statut: row2?.status, zernio: row2?.provider_post_id ?? null, erreur: row2?.last_error ?? null, rapport: {confies: rep.queued, publies: rep.published, manuels: rep.manual, ignores: rep.skipped}};
          }
          results.push({video: id, ok: true, minutes: Math.round((Date.now() - t0) / 6000) / 10, programmation: planned});
          log(`✓ ${id} ${JSON.stringify(planned)}`);
        } catch (e) {
          results.push({video: id, ok: false, erreur: (e as Error).message});
          log(`✗ ${id} : ${(e as Error).message}`);
        }
      }
      out(results);
      return true;
    }
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
    case 'video:caption': {
      // Rebuilds the description of a video for its network, with the credits its media require.
      const {loadSpec} = await import('./produce.js');
      const {profileFor, videoCaption, withCredits, rightsCheck} = await import('./platforms.js');
      const res: Record<string, string> = {};
      for (const id of pos) {
        const {spec, account} = loadSpec(db, id);
        const profile = profileFor(cfg, account);
        const caption = withCredits(videoCaption(cfg, account, spec.script, profile), rightsCheck(db, id).credits, profile.captionMax);
        db.run('UPDATE slideshows SET caption = ?, updated_at = ? WHERE id = ?', caption, new Date().toISOString(), id);
        res[id] = caption;
      }
      out(res);
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
    case 'audio:voices': {
      const rows = [];
      for (const v of loadMedia().voices) {
        const st = await voiceStatus(v, true);
        rows.push({id: v.id, voix: v.label, genre: v.gender, langue: v.language, autres_langues: v.languages ?? [], accent: v.accent, moteur: v.engine, disponible: st.ok, raison: st.reason ?? null});
      }
      out(rows);
      return true;
    }
    case 'audio:previews': {
      const {allPreviews} = await import('./previews.js');
      const {voicePreview} = await import('./voice.js');
      const path = await import('node:path');
      const {PATHS} = await import('../core/paths.js');
      const done: Record<string, unknown> = allPreviews();
      const ids = typeof flags.voices === 'string' ? flags.voices.split(',') : loadMedia().voices.filter((v) => v.engine === 'kokoro').map((v) => v.id);
      const voices: unknown[] = [];
      for (const id of ids) {
        try {
          const r = await voicePreview(db, id, {outDir: path.join(PATHS.var, 'audio', 'previews')});
          voices.push({voix: id, fichier: r.file, secondes: r.seconds});
        } catch (e) {
          voices.push({voix: id, erreur: (e as Error).message});
        }
      }
      out({...done, voix: voices});
      return true;
    }
    case 'audio:preview': {
      const {voicePreview} = await import('./voice.js');
      const path = await import('node:path');
      const {PATHS} = await import('../core/paths.js');
      out(await voicePreview(db, String(flags.voice ?? 'siwis'), {text: flags.text as string | undefined, speed: flags.speed ? Number(flags.speed) : undefined, pitch: flags.pitch ? Number(flags.pitch) : undefined, language: flags.language as string | undefined, outDir: path.join(PATHS.var, 'audio', 'previews')}));
      return true;
    }
    case 'audio:set': {
      const {getAccount, videoSettings, updateAccount} = await import('../core/accounts.js');
      const {VideoAccountSchema} = await import('../core/config.js');
      const a = getAccount(db, pos[0]);
      const v = videoSettings(a);
      const num = (k: string) => (flags[k] !== undefined ? Number(flags[k]) : undefined);
      const bool = (k: string) => (flags[k] !== undefined ? String(flags[k]) !== 'false' : undefined);
      const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined));
      const next = VideoAccountSchema.parse({
        ...v,
        voice: {...v.voice, ...clean({id: flags.voice, gender: flags.gender, speed: num('speed'), intonation: flags.intonation, language: flags.language})},
        audio: {...v.audio, ...clean({auto: bool('auto'), musicCategory: flags['music-category'], musicVolume: num('music-volume'), voiceVolume: num('voice-volume'), ducking: flags.ducking, sfx: bool('sfx'), sfxVolume: num('sfx-volume'), ambience: bool('ambience'), pitch: num('pitch'), fadeIn: num('fade-in'), fadeOut: num('fade-out')})},
        captions: {...v.captions, ...clean({style: flags.captions, font: flags['caption-font'], color: flags['caption-color'], highlight: flags['caption-highlight'], size: num('caption-size'), position: flags['caption-position'], animation: flags['caption-animation'], emphasis: bool('caption-emphasis')})},
        ...(flags.music ? {music: flags.music} : {}),
      });
      updateAccount(db, a.id, {settings: {video: next}});
      out({compte: a.id, video: next});
      return true;
    }
    case 'music:list': {
      const {loadTracks, checkTrack} = await import('./music-library.js');
      const {MUSIC_CATEGORIES} = await import('./music.js');
      out({categories_originales: MUSIC_CATEGORIES, pistes_sous_licence: loadTracks().map((t) => ({...t, problemes: checkTrack(t)}))});
      return true;
    }
    case 'music:add': {
      const {addTrack} = await import('./music-library.js');
      out(
        addTrack(pos[0], {
          id: String(flags.id),
          title: String(flags.title ?? flags.id),
          artist: String(flags.artist ?? ''),
          license: String(flags.license ?? ''),
          licenseUrl: flags['license-url'] as string | undefined,
          proof: String(flags.proof ?? ''),
          commercial: flags.commercial !== 'false',
          platforms: list(flags.platforms) ?? [],
          contentId: flags['content-id'] === 'true',
          moods: (list(flags.moods) ?? []) as any,
          attribution: flags.attribution as string | undefined,
        }),
      );
      return true;
    }
    case 'intel:videos': {
      // Answers of the public data providers (tiktok/video, youtube/video, youtube/search) saved as JSON.
      const fs = await import('node:fs');
      const {importVideoAnalysis} = await import('../intel/video-features.js');
      const {computePatterns, savePatterns} = await import('../intel/patterns.js');
      const res = [];
      for (const f of pos) res.push({fichier: f, ...importVideoAnalysis(db, cfg, JSON.parse(fs.readFileSync(f, 'utf8')))});
      savePatterns(db, computePatterns(db), 'market');
      out(res);
      return true;
    }
    case 'intel:video-report': {
      const {parseJson} = await import('../core/util.js');
      const rows = db.all("SELECT author, platform, views, score, duration_s, features_json FROM posts WHERE is_own = 0 AND media_type = 'video' AND features_json LIKE '%\"video\"%' ORDER BY score DESC");
      out(rows.map((r) => {
        const v = parseJson<any>(r.features_json, {}).video ?? {};
        return {compte: r.author, reseau: r.platform, score: r.score, vues: r.views, duree: r.duration_s, premiere_phrase: v.firstSentence, trois_premieres_secondes: v.first3s, accroche: v.hookType, debit: v.wordsPerSecond, sous_titres: v.captions, musique: v.music, storytelling: v.storytelling, structure: v.structure, conclusion: v.conclusion, appel: v.ctaType, rythme_montage: v.editingRhythm};
      }));
      return true;
    }
    case 'publish:sync-remote': {
      // Posts already scheduled at Zernio (by this machine elsewhere, or by hand) count in the calendar: no double slot.
      const {listAccounts} = await import('../core/accounts.js');
      const {nowIso} = await import('../core/util.js');
      const res = await fetch('https://zernio.com/api/v1/posts?status=scheduled&limit=100', {headers: {Authorization: `Bearer ${process.env.ZERNIO_API_KEY ?? 'proxy'}`}, signal: AbortSignal.timeout(30_000)});
      if (!res.ok) throw new Error(`Zernio : HTTP ${res.status}`);
      const body: any = await res.json();
      const posts: any[] = body.posts ?? body.data ?? [];
      const accounts = listAccounts(db);
      let added = 0;
      for (const p of posts) {
        for (const pl of p.platforms ?? []) {
          const accId = typeof pl.accountId === 'object' ? pl.accountId?._id : pl.accountId;
          const acc = accounts.find((a) => a.providerAccountId && a.providerAccountId === accId);
          if (!acc || !p.scheduledFor) continue;
          if (db.get('SELECT id FROM schedule WHERE provider_post_id = ? AND account_id = ?', p._id, acc.id)) continue;
          db.upsert('schedule', {id: `ext_${p._id}_${acc.id}`, slideshow_id: `externe:${p._id}`, account_id: acc.id, platform: acc.platform, provider: 'zernio', scheduled_for: new Date(p.scheduledFor).toISOString(), status: 'queued_remote', provider_post_id: p._id, attempts: 0, max_attempts: 0, last_error: null, next_attempt_at: null, published_at: null, created_at: nowIso(), updated_at: nowIso()});
          added++;
        }
      }
      out({programmes_chez_zernio: posts.length, ajoutes_au_calendrier: added});
      return true;
    }
    case 'factory:daily': {
      // The daily task: for every account whose videos may be published automatically, make N videos and hand them over.
      const {listAccounts, videoSettings} = await import('../core/accounts.js');
      const {autoSchedule} = await import('../publish/scheduler.js');
      const {runDue} = await import('../publish/runner.js');
      const {ZernioPublisher, MetaPublisher} = await import('../publish/publishers.js');
      const per = Number(flags['per-account'] ?? 1);
      const report: unknown[] = [];
      for (const a of listAccounts(db)) {
        const vs = videoSettings(a);
        if (!a.active || !vs.enabled) continue;
        if (!a.settings.autoPublish) {
          report.push({compte: a.id, ignore: 'publication automatique désactivée pour ce compte'});
          continue;
        }
        const ready = a.provider === 'zernio' ? await new ZernioPublisher(process.env.ZERNIO_API_KEY ?? null, cfg).ready() : a.provider === 'meta' ? await new MetaPublisher().ready() : {ok: false, reason: `pas d’API de publication pour ${a.provider}`};
        if (!ready.ok) {
          report.push({compte: a.id, ignore: ready.reason});
          continue;
        }
        const b = createBatch(db, {accountId: a.id, quantity: per, voice: flags.voice as string | undefined, engine: 'auto', budgetEur: 0});
        const r = await runBatch(db, cfg, b.batchId, {log});
        const planned = autoSchedule(db, cfg, {accountId: a.id});
        report.push({compte: a.id, lot: b.batchId, faites: r.done, echouees: r.failed, programmees: planned.length});
      }
      const handed = await runDue(db, cfg, {leadMinutes: 400 * 60});
      out({comptes: report, publication: {confiees: handed.queued, publiees: handed.published, manuelles: handed.manual, reportees: handed.deferred, echecs: handed.failed}});
      return true;
    }
    case 'state:export': {
      // Starting state for GitHub Actions (public repository): no key is ever in the database; competitors' texts are removed.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const {ROOT} = await import('../core/paths.js');
      const out0 = path.join(ROOT, 'state', 'seed.db');
      fs.mkdirSync(path.dirname(out0), {recursive: true});
      fs.rmSync(out0, {force: true});
      db.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.run('VACUUM INTO ?', out0);
      const {Db} = await import('../core/db.js');
      const seed = new Db(out0);
      seed.run("UPDATE posts SET text = '', hook = NULL WHERE is_own = 0");
      seed.run("DELETE FROM settings WHERE key = 'factory_lock'");
      seed.run('DELETE FROM ai_calls');
      seed.sql.exec('PRAGMA journal_mode = DELETE');
      seed.run('VACUUM');
      seed.close();
      for (const f of [`${out0}-wal`, `${out0}-shm`]) fs.rmSync(f, {force: true});
      out({fichier: out0, octets: fs.statSync(out0).size});
      return true;
    }
    case 'video:costs':
      out({fournisseurs: providerCosts(db), lots: db.all('SELECT id, account_id, quantity, done, failed, budget_eur, spent_eur, status FROM video_batches ORDER BY created_at DESC LIMIT 20')});
      return true;
    default:
      return false;
  }
}
