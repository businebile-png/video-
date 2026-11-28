import fs from 'node:fs';
import path from 'node:path';
import {openDb} from './core/db.js';
import {loadConfig, ROLES, type Role} from './core/config.js';
import {listAccounts, recordHealth, syncAccountsFromConfig, getAccount} from './core/accounts.js';
import {PATHS} from './core/paths.js';
import {nowIso, parseJson} from './core/util.js';
import {importFile, readAnyJson} from './intel/collectors/importers.js';
import {collectOfficial} from './intel/collectors/official.js';
import {queryPosts, savePosts} from './intel/store.js';
import {insightsText, loadPatterns, crossCompetitorPatterns, patternLabel} from './intel/patterns.js';
import {loadTrends} from './intel/trends.js';
import {generate, ideaToSlideshow, ingest, writeBrief} from './generate/generate.js';
import {renderMany} from './render/renderer.js';
import {exportSlideshow} from './render/export.js';
import {runQc} from './qc/qc.js';
import {verifyFacts} from './qc/facts-verify.js';
import {autoSchedule, cancel, schedule} from './publish/scheduler.js';
import {bridgePlan, recordPublication, retry, runDue, stageMedia} from './publish/runner.js';
import {importAnalyticsFile, refreshIntelligence, syncMeta, syncZernio} from './analytics/sync.js';
import {learningTable} from './analytics/learn.js';
import {AiRouter} from './ai/router.js';
import {processSlideshows, runPipeline} from './pipeline.js';
import {approve, reject} from './review.js';

/** Minimal argument parser: positional args and --flags (--flag value, --flag=value, --bool). */
function parse(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return {pos, flags};
}

const HELP = `Viral Content Machine — commandes (npm run viral -- <commande>)

  Démarrage     init · audit · accounts [--json] · accounts:health <fichier.json>
  Veille        import <fichier> [--kind scrapecreators|zernio-analytics|metricool-competitors|generic] [--platform x] [--query q]
                collect (API officielles : YouTube, Instagram Graph, Threads, selon les clés présentes)
                analyze · patterns [--platform tiktok] [--own] · trends · posts [--own] [--limit 20]
  Création      generate --account <id> [--quantity 10] [--topic <sujet>] [--slides 7] [--template <modèle>]
                         [--structure liste|erreurs|etapes|mythe-realite|avant-apres|histoire|definition|faits]
                         [--format 9:16|4:5|1:1] [--tone direct|bienveillant|expert|enthousiaste] [--language fr]
                         [--mode ideas|slideshows] [--engine auto|ai|composer] [--no-render]
                idea:use <ideaId> · brief --account <id> [--quantity n] · ingest <réponse.json> --brief <batchId>
                render <id…|--batch b|--status draft> · qc <id…|--batch b> · export <id> [--pdf]
  Validation    approve <id…> [--by nom] · reject <id> --reason "…"
  Publication   schedule <id> [--at 2026-12-01T12:30:00+01:00] · schedule:auto [--account id] [--max n] · unschedule <scheduleId>
                publish:run [--dry-run] · publish:plan (pour une session Claude avec Zernio) · publish:retry <scheduleId>
                publish:record <scheduleId> --status published|queued_remote|failed [--post-id x] [--url u] [--error e]
                media:stage <id> [--base-url url] · media:stage-due
  Mesure        analytics:import <fichier.json> · analytics:sync · learn
  IA            ai:status · ai:enable <modèle> · ai:disable <modèle> · ai:test [--role writing]
  Faits         facts:verify (relit les pages officielles de systeme.io)
  Tout-en-un    pipeline [--per-account 3] [--publish] [--dry-run]
  Interface     dashboard [--port 8787] · dashboard:previews · dashboard:snapshot [--out fichier.html]
`;

async function main() {
  const [cmd = 'help', ...rest] = process.argv.slice(2);
  const {pos, flags} = parse(rest);
  const out = (x: unknown) => console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
  if (cmd === 'help' || cmd === '--help') return out(HELP);
  const cfg = loadConfig();
  const db = openDb();
  syncAccountsFromConfig(db, cfg);
  const ids = async (): Promise<string[]> => {
    if (flags.batch) return db.all('SELECT id FROM slideshows WHERE batch_id = ? ORDER BY created_at', flags.batch).map((r) => r.id);
    if (flags.status) return db.all('SELECT id FROM slideshows WHERE status = ? ORDER BY created_at', flags.status).map((r) => r.id);
    return pos;
  };

  switch (cmd) {
    case 'init':
      return out({base: PATHS.db, comptes: listAccounts(db).map((a) => a.id)});
    case 'audit': {
      const router = new AiRouter(db, cfg);
      const counts = db.get('SELECT (SELECT COUNT(*) FROM posts WHERE is_own = 0) AS concurrents, (SELECT COUNT(*) FROM posts WHERE is_own = 1) AS nos_posts, (SELECT COUNT(*) FROM slideshows) AS carrousels, (SELECT COUNT(*) FROM schedule) AS programmations');
      const env = (k: string) => (process.env[k] ? 'présente' : 'absente');
      return out({
        comptes: listAccounts(db).map((a) => ({id: a.id, fournisseur: a.provider, carrousels: a.slideshows, validationHumaine: a.settings.requireApproval, publicationAuto: a.settings.autoPublish, sante: a.health?.status ?? 'inconnue'})),
        cles: {ZERNIO_API_KEY: env('ZERNIO_API_KEY'), INSTAGRAM_ACCESS_TOKEN: env('INSTAGRAM_ACCESS_TOKEN'), THREADS_ACCESS_TOKEN: env('THREADS_ACCESS_TOKEN'), YOUTUBE_API_KEY: env('YOUTUBE_API_KEY'), META_GRAPH_TOKEN: env('META_GRAPH_TOKEN'), PIXABAY_API_KEY: env('PIXABAY_API_KEY')},
        ia: Object.fromEntries(ROLES.map((r) => [r, router.plan(r)])),
        donnees: counts,
      });
    }
    case 'accounts':
      return out(flags.json ? listAccounts(db) : listAccounts(db).map((a) => `${a.id.padEnd(22)} ${a.provider.padEnd(9)} carrousels:${a.slideshows ? 'oui' : 'non'} validation:${a.settings.requireApproval ? 'oui' : 'non'} auto:${a.settings.autoPublish ? 'oui' : 'non'} ${a.limits.maxPerDay}/jour`).join('\n'));
    case 'accounts:health':
      return out({comptesMisAJour: recordHealth(db, readAnyJson(pos[0]))});
    case 'import': {
      const r = importFile(pos[0], listAccounts(db), (flags.kind as any) ?? 'auto', {platform: flags.platform as string, query: flags.query as string});
      const saved = savePosts(db, r.posts);
      const refreshed = refreshIntelligence(db, cfg);
      return out({source: r.kind, ...saved, analyse: refreshed});
    }
    case 'collect': {
      const q = cfg.niche.searchQueries;
      const r = await collectOfficial({youtube: q.youtube, instagramHandles: cfg.niche.competitorSeeds.instagram, instagramHashtags: q.instagram, threads: q.threads});
      const saved = savePosts(db, r.posts);
      refreshIntelligence(db, cfg);
      return out({journal: r.log, ...saved});
    }
    case 'analyze':
      return out(refreshIntelligence(db, cfg));
    case 'patterns': {
      const scope = flags.own ? 'own' : 'market';
      const p = loadPatterns(db, scope, (flags.platform as string) ?? 'all');
      return out({
        ceQuiMarche: insightsText(p, 10),
        formatsPartages: crossCompetitorPatterns(p).slice(0, 10).map((x) => `${patternLabel(x)} — ×${x.lift} (${x.authors} comptes)`),
        detail: p.filter((x) => x.n >= 3).slice(0, Number(flags.limit ?? 40)).map((x) => ({dimension: x.dimension, valeur: x.value, n: x.n, comptes: x.authors, score: x.mean_score, ajuste: x.shrunk_score, lift: x.lift})),
      });
    }
    case 'trends':
      return out(loadTrends(db, Number(flags.limit ?? 30)));
    case 'posts':
      return out(queryPosts(db, {own: flags.own ? true : flags.market ? false : undefined, platform: flags.platform as string, limit: Number(flags.limit ?? 20), sort: (flags.sort as any) ?? 'score'}).items.map((p) => `${String(p.score).padStart(5)}  ${p.platform.padEnd(9)} @${(p.author ?? '').padEnd(22)} ${String(p.views ?? '-').padStart(8)} vues  ${p.hook_type?.padEnd(12)} ${String(p.hook ?? '').slice(0, 70)}`).join('\n'));
    case 'generate': {
      if (!flags.account) throw new Error('--account requis (voir « accounts »)');
      const r = await generate(db, cfg, {
        accountId: String(flags.account),
        quantity: Number(flags.quantity ?? 5),
        topic: flags.topic as string,
        slides: flags.slides ? Number(flags.slides) : undefined,
        template: flags.template as string,
        structure: flags.structure as any,
        format: flags.format as any,
        tone: flags.tone as any,
        language: flags.language as string,
        mode: (flags.mode as any) ?? 'slideshows',
        engine: (flags.engine as any) ?? 'auto',
        seed: flags.seed as string,
      });
      if (r.slideshowIds.length && !flags['no-render']) {
        const p = await processSlideshows(db, cfg, r.slideshowIds, (m) => process.stderr.write(`\r${m}   `));
        process.stderr.write('\n');
        return out({...r, rendus: p.rendered, controleOk: p.passed, controleKo: p.failed, problemes: Object.entries(p.qc).filter(([, q]) => !q.ok).map(([id, q]) => ({id, erreurs: q.errors.map((e) => e.message)}))});
      }
      return out(r);
    }
    case 'idea:use':
      return out({carrousel: ideaToSlideshow(db, cfg, pos[0])});
    case 'brief':
      return out(writeBrief(db, cfg, {accountId: String(flags.account), quantity: Number(flags.quantity ?? 5), topic: flags.topic as string, slides: flags.slides ? Number(flags.slides) : undefined, structure: flags.structure as any, tone: flags.tone as any, language: flags.language as string}));
    case 'ingest': {
      const r = ingest(db, cfg, pos[0], String(flags.brief));
      const p = r.slideshowIds.length ? await processSlideshows(db, cfg, r.slideshowIds) : null;
      return out({...r, controleOk: p?.passed, controleKo: p?.failed});
    }
    case 'render': {
      const list = await ids();
      const r = await renderMany(db, cfg, list, (d, t) => process.stderr.write(`\rrendu ${d}/${t}`));
      process.stderr.write('\n');
      return out(r.map((x) => ({id: x.slideshowId, images: x.images.length, dossier: x.dir, ms: x.ms})));
    }
    case 'qc':
      return out((await ids()).map((id) => ({id, ...runQc(db, cfg, id)})));
    case 'export':
      return out(await exportSlideshow(db, cfg, pos[0], {pdf: !!flags.pdf}));
    case 'approve':
      return out((await ids()).map((id) => approve(db, id, String(flags.by ?? 'cli'))));
    case 'reject':
      return out(reject(db, pos[0], String(flags.reason ?? 'refusé')));
    case 'schedule':
      return out(schedule(db, cfg, pos[0], flags.at ? new Date(String(flags.at)) : undefined));
    case 'schedule:auto':
      return out(autoSchedule(db, cfg, {accountId: flags.account as string, max: flags.max ? Number(flags.max) : undefined}));
    case 'unschedule':
      cancel(db, pos[0], String(flags.reason ?? 'annulé à la main'));
      return out('annulé');
    case 'publish:run':
      return out(await runDue(db, cfg, {dryRun: !!flags['dry-run']}));
    case 'publish:plan':
      return out(bridgePlan(db, cfg, Number(flags.hours ?? 36)));
    case 'publish:record':
      recordPublication(db, pos[0], {status: flags.status as any, providerPostId: flags['post-id'] as string, permalink: flags.url as string, error: flags.error as string});
      return out('enregistré');
    case 'publish:retry':
      retry(db, pos[0]);
      return out('remis en file');
    case 'media:stage':
      return out(stageMedia(db, pos[0], flags['base-url'] as string | undefined));
    case 'media:stage-due': {
      // Images of everything scheduled in the next 48 h that has no public address yet.
      const due = db.all("SELECT DISTINCT s.slideshow_id AS id FROM schedule s JOIN images i ON i.slideshow_id = s.slideshow_id WHERE s.status IN ('planned', 'deferred') AND s.scheduled_for <= ? AND i.public_url IS NULL", new Date(Date.now() + 48 * 3_600_000).toISOString());
      return out(due.map((d) => ({id: d.id, ...stageMedia(db, d.id, flags['base-url'] as string | undefined)})));
    }
    case 'analytics:import':
      return out(importAnalyticsFile(db, cfg, pos[0]));
    case 'analytics:sync':
      return out({zernio: await syncZernio(db, cfg).catch((e) => ({erreur: (e as Error).message})), meta: await syncMeta(db, cfg)});
    case 'learn': {
      const r = refreshIntelligence(db, cfg);
      return out({...r.learning, global: learningTable(db, 'global')});
    }
    case 'ai:status':
      return out(new AiRouter(db, cfg).status());
    case 'ai:enable':
    case 'ai:disable':
      new AiRouter(db, cfg).setEnabled(pos[0], cmd === 'ai:enable');
      return out('ok');
    case 'ai:test': {
      const role = (flags.role as Role) ?? 'qc';
      const r = await new AiRouter(db, cfg).complete({role, purpose: 'test', system: 'Réponds en un mot.', prompt: 'Dis bonjour en français.', maxTokens: 50}).catch((e) => ({erreur: e.message, details: (e as any).failures}));
      return out(r);
    }
    case 'facts:verify':
      return out(await verifyFacts());
    case 'pipeline':
      return out(await runPipeline(db, cfg, {perAccount: Number(flags['per-account'] ?? 3), publish: !!flags.publish, dryRun: !!flags['dry-run'], log: (m) => console.error(m)}));
    case 'dashboard': {
      const {startServer} = await import('./dashboard/server.js');
      return startServer(db, cfg, Number(flags.port ?? process.env.PORT ?? 8787));
    }
    case 'dashboard:previews': {
      const {renderPreviews} = await import('./dashboard/snapshot.js');
      return out(await renderPreviews(db, cfg));
    }
    case 'dashboard:snapshot': {
      const {writeSnapshot} = await import('./dashboard/snapshot.js');
      return out(await writeSnapshot(db, cfg, (flags.out as string) ?? path.join(PATHS.exports, 'tableau-de-bord.html'), {artifact: !!flags.artifact}));
    }
    default:
      out(HELP);
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`Erreur : ${(e as Error).message}`);
  process.exitCode = 1;
});

export {getAccount, nowIso};
