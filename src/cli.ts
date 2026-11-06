import fsp from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {PATHS, runPaths} from './core/paths.js';
import {loadDotEnv} from './core/env.js';
import {exists, readJson, readValidated, writeJson} from './core/fsx.js';
import {http} from './core/http.js';
import {affiliateLinkProblems, loadConfig, loadEditorial, saveConfig} from './core/config.js';
import {log} from './core/log.js';
import {run} from './core/exec.js';
import {loadState, step, type StepName} from './core/run.js';
import {loadCaptures, loadHistory, loadTracks, upsertAffiliate, upsertHistory, upsertPublication} from './core/stores.js';
import {ScriptSchema} from './schemas/script.js';
import {FEATURES, type Feature} from './schemas/config.js';
import {TrackSchema} from './schemas/assets.js';
import {createPlan, type Plan} from './editorial/plan.js';
import {lintScript} from './script/lint.js';
import {loadFacts, refreshSnapshots, saveFacts, usableFacts, verifyFacts} from './facts/facts.js';
import {runVoice} from './voice/voice-step.js';
import {listMyVoices, textToSpeechWithTimestamps} from './voice/elevenlabs.js';
import {azureListVoices, azureSynthesize, buildSsml} from './voice/azure.js';
import {localListVoices, localSynthesize, localVoiceProblems} from './voice/local.js';
import {chatterboxProblems, chatterboxSynthesize} from './voice/chatterbox.js';
import {spokenForm} from './voice/speech.js';
import {autoSelection, fetchFootage, searchFootage} from './footage/footage-step.js';
import {chooseMusic} from './music/music-step.js';
import {buildSfx} from './sfx/synth.js';
import {addCapture, addFocusRegion} from './captures/captures.js';
import {buildTimelineStep, conformStep} from './edit/edit-step.js';
import {detectBrowser, renderStep} from './render/render.js';
import {technicalQc} from './qc/technical.js';
import {scoreStep} from './qc/score.js';
import {checkAffiliateLink, preparePublication, pushMedia} from './publish/publish.js';
import {exportFactsState, exportSettingsDoc, exportVideoDoc, importPanelDump} from './panel/panel.js';
import {computeInsights, importStats} from './analytics/analytics.js';
import type {ScoreReport} from './qc/score.js';

const HELP = `Studio pub Systeme.io — commandes (npm run studio -- <commande>)

Préparation
  doctor [--online]            Vérifie que tout est prêt (--online : teste aussi la clé Pexels, et Azure s’il est choisi)
  facts:refresh [--only a,b]   Télécharge les pages officielles Systeme.io (copies datées)
  facts:verify                 Re-vérifie chaque fait contre ces copies
  voice:list                   Liste les voix françaises disponibles (voix locale gratuite, Azure ou ElevenLabs)
  voice:audition [--voices a,b] Génère un même extrait avec chaque voix (à écouter dans le panneau)
  voice:approve <voiceId> --name <nom> [--model <id>]
  captures:add <fichier> --id <id> --feature <fonction> --title <titre> --desc <description> [--public-url <url>] --checked
  captures:region <captureId> --id <id> --x --y --w --h --label <texte>   (valeurs 0..1)
  music:add <fichier> --id <id> --title <titre> --source <source> --license <licence> --proof <preuve> --moods a,b --energy 1-5
  sfx:build                    Régénère l'habillage sonore

Production (dans l'ordre)
  new [--date AAAA-MM-JJ] [--category <id>] [--correction-of <runId> --notes <texte>]
  script:check <runId>         Contrôle le script (promesses, urgence, faits, durée, répétitions)
  voice <runId>                Voix off + vérification de prononciation
  footage:search <runId>       Recherche de séquences (Pixabay ou Pexels) + planches contact par scène
  footage:auto <runId>         Sélection automatique (sinon écrire footage/selection.json)
  footage:fetch <runId>        Téléchargement des séquences choisies + licences
  music <runId>                Musique sous licence (ou générée, ou aucune)
  edit <runId>                 Construit le montage et prépare les plans
  render <runId> [--encode-only]  Rendu final 1080×1920 + aperçu + vignette (--encode-only : réencode depuis le rendu intermédiaire)
  qc <runId>                   Contrôle technique + images pour la relecture
  score <runId>                Note /100 (après qc/review.json écrit par le relecteur indépendant)
  produce <runId> [--force]    Enchaîne voice → footage (auto) → music → edit → render → qc (reprend où il s’était arrêté)

Publication et panneau
  link:check                   Vérifie le lien affilié en ligne (redirections, paramètre sa)
  publish:prepare <runId>      Paquet de publication (légendes, créneaux, charge Metricool)
  media:push <runId>           Publie le MP4 sur la branche média publique
  publish:record <runId> --network tiktok|instagram --response <fichier.json> [--status scheduled|draft]
  panel:export <runId> [--preview-asset <id> --preview-url <url> --cover-asset <id> --cover-url <url>]
  panel:settings               Exporte les réglages vers le panneau
  panel:import <dump.json|dossier>  Applique réglages, idées, décisions, chiffres saisis et mémoire (historique) du panneau
  state:facts                  Prépare la base de faits pour le document state/facts du panneau

Suivi
  stats:import <fichier.json>  Statistiques des publications (Metricool)
  affiliate:add --date AAAA-MM-JJ [--clicks N] [--signups N] [--paid N] [--commission X]
  insights                     Recalcule l'indice de performance par catégorie
  history                      Historique des productions
`;

function need<T>(v: T | undefined, msg: string): T {
  if (v === undefined || v === null || v === '') throw new Error(msg);
  return v;
}

type KeyState = 'ok' | 'missing' | 'error';

/** Online check of the free API keys (footage library, Azure if chosen): what the panel's "Démarrage" tab shows. */
async function probeKeys(
  config: Awaited<ReturnType<typeof loadConfig>>,
): Promise<{azure: KeyState; pexels: KeyState; footage: KeyState; footageProvider: string; checkedAt: string}> {
  const probe = async (url: string, headers: Record<string, string> = {}): Promise<KeyState> => {
    try {
      const res = await http(url, {headers, timeoutMs: 20_000, retries: 0});
      await res.body?.cancel();
      if (res.ok) return 'ok';
      return res.status === 401 || res.status === 403 ? 'missing' : 'error';
    } catch {
      return 'missing';
    }
  };
  const azureHeaders: Record<string, string> = process.env.AZURE_SPEECH_KEY ? {'ocp-apim-subscription-key': process.env.AZURE_SPEECH_KEY} : {};
  const pexelsHeaders: Record<string, string> = process.env.PEXELS_API_KEY ? {authorization: process.env.PEXELS_API_KEY} : {};
  const pexels = config.footage.provider === 'pexels' ? await probe('https://api.pexels.com/videos/search?query=office&per_page=1', pexelsHeaders) : ('missing' as KeyState);
  const pixabayKey = process.env.PIXABAY_API_KEY?.trim();
  const pixabay: KeyState =
    config.footage.provider !== 'pixabay' ? 'missing' : pixabayKey ? await probe(`https://pixabay.com/api/videos/?${new URLSearchParams({key: pixabayKey, q: 'office', per_page: '3'})}`) : 'missing';
  const result = {
    azure: config.voice.provider === 'azure' ? await probe(`https://${config.voice.azure.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, azureHeaders) : ('ok' as KeyState),
    pexels,
    footage: config.footage.provider === 'pixabay' ? pixabay : pexels,
    footageProvider: config.footage.provider,
    checkedAt: new Date().toISOString(),
  };
  await writeJson(path.join(PATHS.panelInbox, 'setup.json'), result);
  return result;
}

async function doctor(online = false): Promise<boolean> {
  const config = await loadConfig();
  if (online) {
    const keys = await probeKeys(config);
    if (config.voice.provider === 'azure') (keys.azure === 'ok' ? log.ok : log.error)(`clé de voix Azure Speech : ${keys.azure === 'ok' ? 'valide' : keys.azure === 'missing' ? 'absente ou refusée' : 'erreur du service'}`);
    const lib = config.footage.provider === 'pixabay' ? 'Pixabay' : 'Pexels';
    (keys.footage === 'ok' ? log.ok : log.error)(`clé ${lib} : ${keys.footage === 'ok' ? 'valide' : keys.footage === 'missing' ? 'absente ou refusée' : 'erreur du service'}`);
  }
  let ok = true;
  const line = (good: boolean, label: string, hint?: string, blocking = true) => {
    if (!good && blocking) ok = false;
    (good ? log.ok : blocking ? log.error : log.warn)(`${label}${!good && hint ? ` — ${hint}` : ''}`);
  };
  const ff = await run('ffmpeg', ['-version']).catch(() => ({code: 1}));
  line(ff.code === 0, 'ffmpeg installé');
  line(Boolean(detectBrowser(config)), 'navigateur de rendu détecté', 'Remotion téléchargera Chrome Headless Shell au premier rendu', false);
  const linkProblems = affiliateLinkProblems(config.affiliate.url);
  line(linkProblems.length === 0, 'lien affilié Systeme.io', linkProblems.join(' ; ') + ' (Réglages du panneau ou config/studio.json)');
  line(Boolean(config.affiliate.bioLinkCheckedOn), 'lien en bio confirmé', 'confirmer dans le panneau que le lien en bio TikTok/Instagram est bien le lien affilié', false);
  line(config.voice.approvedVoices.length > 0, 'voix approuvée', 'voice:audition puis validation dans le panneau');
  const facts = usableFacts(await loadFacts());
  line(facts.length > 0, `faits vérifiés utilisables : ${facts.length}`, 'facts:refresh puis facts:verify');
  line(facts.some((f) => f.tags.includes('plan-price')), 'prix des formules vérifiés récemment', 'sans prix vérifiés sur la page officielle, les vidéos ne citeront aucun prix', false);
  const captures = await loadCaptures();
  line(captures.length > 0, `captures réelles de Systeme.io : ${captures.length}`, 'sans captures, pas de démonstration à l’écran (voir assets/systeme/LISEZMOI.md)', false);
  const tracks = await loadTracks();
  line(tracks.length > 0 || config.music.mode !== 'library', `musiques sous licence : ${tracks.length}`, 'ajouter des pistes avec preuve de licence (music:add) ou activer la génération', false);
  if (config.footage.provider === 'pixabay') {
    line(Boolean(process.env.PIXABAY_API_KEY?.trim()), 'clé Pixabay (variable PIXABAY_API_KEY)', 'créer la clé gratuite sur https://pixabay.com/api/docs/ puis l’ajouter aux variables de l’environnement (onglet Démarrage du panneau)');
  } else line(true, `clé Pexels : ${process.env.PEXELS_API_KEY ? 'variable PEXELS_API_KEY' : 'attendue via le proxy de l’environnement'}`);
  if (config.voice.provider === 'chatterbox') {
    const missing = chatterboxProblems(config.voice.chatterbox, config.voice.local.whisperModel);
    line(missing.length === 0, 'voix Claire installée (Chatterbox + transcription)', `manque : ${missing.join(', ')} — lancer « bash scripts/setup-voice.sh »`);
    const backup = localVoiceProblems(config.voice.local);
    line(backup.length === 0, 'voix de secours Siwis installée', `manque : ${backup.join(', ')}`, false);
  } else if (config.voice.provider === 'local') {
    const missing = localVoiceProblems(config.voice.local);
    line(missing.length === 0, 'voix locale gratuite installée (Kokoro + transcription)', `manque : ${missing.join(', ')} — lancer « bash scripts/setup-voice.sh »`);
  } else if (config.voice.provider === 'azure') line(true, `voix : Azure Speech gratuit (région ${config.voice.azure.region}) — clé ${process.env.AZURE_SPEECH_KEY ? 'AZURE_SPEECH_KEY' : 'attendue via le proxy de l’environnement'}`);
  else line(true, `voix : ElevenLabs — clé ${process.env.ELEVENLABS_API_KEY ? 'ELEVENLABS_API_KEY' : 'attendue via le proxy de l’environnement'}`);
  line(config.platforms.tiktok.enabled || config.platforms.instagram.enabled, 'au moins un réseau activé');
  log.info(`Validation : ${config.publish.approval === 'panel' ? 'par vous dans le panneau' : 'automatique si tout est conforme'} · Metricool : ${config.publish.delivery}`);
  return ok;
}

async function main(): Promise<void> {
  loadDotEnv();
  const [command, ...rest] = process.argv.slice(2);
  const {values, positionals} = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: false,
    options: {
      date: {type: 'string'},
      category: {type: 'string'},
      'correction-of': {type: 'string'},
      notes: {type: 'string'},
      voices: {type: 'string'},
      text: {type: 'string'},
      name: {type: 'string'},
      model: {type: 'string'},
      id: {type: 'string'},
      feature: {type: 'string'},
      title: {type: 'string'},
      desc: {type: 'string'},
      'public-url': {type: 'string'},
      checked: {type: 'boolean'},
      x: {type: 'string'},
      y: {type: 'string'},
      w: {type: 'string'},
      h: {type: 'string'},
      label: {type: 'string'},
      source: {type: 'string'},
      license: {type: 'string'},
      'license-url': {type: 'string'},
      proof: {type: 'string'},
      moods: {type: 'string'},
      energy: {type: 'string'},
      network: {type: 'string'},
      response: {type: 'string'},
      status: {type: 'string'},
      'preview-asset': {type: 'string'},
      'preview-url': {type: 'string'},
      'cover-asset': {type: 'string'},
      'cover-url': {type: 'string'},
      clicks: {type: 'string'},
      signups: {type: 'string'},
      paid: {type: 'string'},
      commission: {type: 'string'},
      'skip-link-check': {type: 'boolean'},
      'trigger-id': {type: 'string'},
      online: {type: 'boolean'},
      force: {type: 'boolean'},
      only: {type: 'string'},
      'encode-only': {type: 'boolean'},
    },
  });
  const str = (k: string) => (typeof values[k] === 'string' ? (values[k] as string) : undefined);
  const runId = () => need(positionals[0], 'Identifiant de production manquant (ex. 2026-11-06-a).');
  const num = (k: string) => (str(k) === undefined ? null : Number(str(k)));

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return;
    case 'doctor': {
      const ok = await doctor(values.online === true);
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case 'facts:refresh': {
      const only = str('only')?.split(',').map((x) => x.trim()).filter(Boolean);
      const metas = await refreshSnapshots(only?.length ? only : undefined);
      log.info(`${metas.length} page(s) officielle(s) enregistrée(s).`);
      return;
    }
    case 'facts:verify': {
      const {db, checks} = await verifyFacts(await loadFacts());
      await saveFacts(db);
      for (const c of checks) (c.after === 'verified' ? log.ok : log.warn)(`${c.id} : ${c.after} — ${c.reason}`);
      return;
    }
    case 'voice:list': {
      const config = await loadConfig();
      if (config.voice.provider === 'local') {
        const voices = await localListVoices(config.voice.local);
        for (const v of voices.filter((x) => x.startsWith('f'))) console.log(`${v}  (Kokoro-82M, français, gratuite)`);
        log.info(`${voices.length} voix dans le fichier, dont ${voices.filter((x) => x.startsWith('f')).length} en français`);
      } else if (config.voice.provider === 'azure') {
        const voices = (await azureListVoices(config.voice.azure.region)).filter(
          (v) => v.VoiceType === 'Neural' && (v.Locale === config.voice.azure.locale || (v.SecondaryLocaleList ?? []).includes(config.voice.azure.locale)),
        );
        for (const v of voices) console.log(`${v.ShortName}  ${v.LocalName ?? v.DisplayName}  ${v.Gender}${v.StyleList?.length ? `  styles : ${v.StyleList.join(', ')}` : ''}`);
        log.info(`${voices.length} voix neuronales en ${config.voice.azure.locale} (Azure, région ${config.voice.azure.region})`);
      } else {
        for (const v of await listMyVoices()) console.log(`${v.voice_id}  ${v.name}  ${JSON.stringify(v.labels ?? {})}`);
      }
      return;
    }
    case 'voice:audition': {
      const config = await loadConfig();
      const sample =
        str('text') ??
        'Tu jongles entre cinq outils pour vendre en ligne ? Avec Systeme.io, tes pages, tes e-mails et tes formations sont réunis au même endroit. Tu peux commencer gratuitement, sans carte bancaire. Et quand tu veux aller plus loin, compare les formules : le lien est dans ma bio.';
      const spoken = sample
        .split(/\s+/)
        .map((w) => spokenForm(w, config.voice.pronunciations).join(' '))
        .join(' ');
      const dir = path.join(PATHS.runs, '_audition');
      await fsp.mkdir(dir, {recursive: true});
      const azure = config.voice.provider === 'azure';
      const local = config.voice.provider === 'local';
      const chatterbox = config.voice.provider === 'chatterbox';
      const ids =
        str('voices')?.split(',').map((x) => x.trim()).filter(Boolean) ??
        (chatterbox
          ? ['claire']
          : local
          ? (await localListVoices(config.voice.local)).filter((x) => x.startsWith('f'))
          : azure
            ? ['fr-FR-VivienneMultilingualNeural', 'fr-FR-RemyMultilingualNeural', 'fr-FR-DeniseNeural', 'fr-FR-HenriNeural']
            : (await listMyVoices()).map((v) => v.voice_id));
      for (const id of ids) {
        try {
          // Audio-only MP4 (AAC): the panel's file store accepts mp4/webm, not mp3.
          const out = path.join(dir, `${id}.mp4`);
          if (chatterbox) {
            const wav = path.join(dir, `${id}.wav`);
            const cbSpoken = sample
              .split(/\s+/)
              .map((w) => spokenForm(w, {...config.voice.pronunciations, ...config.voice.chatterbox.pronunciations}).join(' '))
              .join(' ');
            await chatterboxSynthesize([cbSpoken], wav, {seed: 1}, config.voice.chatterbox, config.voice.local.whisperModel);
            await run('ffmpeg', ['-hide_banner', '-y', '-i', wav, '-af', 'highpass=f=70,loudnorm=I=-16:TP=-1.5', '-ar', '44100', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
          } else if (local) {
            const wav = path.join(dir, `${id}.wav`);
            const sentences = spoken.split(/(?<=[?.!])\s+/).filter(Boolean);
            await localSynthesize(sentences, wav, {voice: id, speed: config.voice.defaultSettings.speed}, config.voice.local);
            await run('ffmpeg', ['-hide_banner', '-y', '-i', wav, '-af', 'highpass=f=70,loudnorm=I=-16:TP=-1.5', '-ar', '44100', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
          } else if (azure) {
            const wav = path.join(dir, `${id}.wav`);
            const ssml = buildSsml([spoken], id, {ratePercent: (config.voice.defaultSettings.speed - 1) * 100, sceneBreakMs: 0, locale: config.voice.azure.locale});
            await fsp.writeFile(wav, await azureSynthesize(ssml, {region: config.voice.azure.region, outputFormat: config.voice.azure.outputFormat}));
            await run('ffmpeg', ['-hide_banner', '-y', '-i', wav, '-af', 'loudnorm=I=-16:TP=-1.5', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
          } else {
            const res = await textToSpeechWithTimestamps(id, spoken, {modelId: str('model') ?? config.voice.modelId, outputFormat: config.voice.outputFormat, settings: config.voice.defaultSettings, languageCode: config.voice.languageCode});
            const mp3 = path.join(dir, `${id}.mp3`);
            await fsp.writeFile(mp3, res.audio);
            await run('ffmpeg', ['-hide_banner', '-y', '-i', mp3, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]);
          }
          log.ok(`Essai enregistré : ${path.relative(PATHS.root, out)}`);
        } catch (err) {
          log.warn(`Voix ${id} : ${(err as Error).message}`);
        }
      }
      return;
    }
    case 'voice:approve': {
      const config = await loadConfig();
      const id = need(positionals[0], 'Identifiant de voix manquant.');
      config.voice.approvedVoices = config.voice.approvedVoices.filter((v) => v.id !== id);
      config.voice.approvedVoices.unshift({id, name: need(str('name'), '--name requis'), approvedOn: new Date().toISOString().slice(0, 10), approvedBy: 'utilisateur', settings: {}, ...(str('model') ? {modelId: str('model')} : {})});
      await saveConfig(config);
      log.ok(`Voix approuvée : ${str('name')} (${id})`);
      return;
    }
    case 'captures:add': {
      const feature = need(str('feature'), `--feature requis (${FEATURES.join(', ')})`) as Feature;
      if (!FEATURES.includes(feature)) throw new Error(`Fonction inconnue : ${feature}`);
      const cap = await addCapture({
        file: need(positionals[0], 'Fichier de capture manquant.'),
        id: need(str('id'), '--id requis'),
        feature,
        title: need(str('title'), '--title requis'),
        description: need(str('desc'), '--desc requis'),
        source: str('public-url') ? 'public-page' : 'user-recording',
        sourceUrl: str('public-url'),
        personalDataChecked: values.checked === true,
      });
      log.ok(`Capture ajoutée : ${cap.id} (${cap.width}×${cap.height}${cap.durationSec ? `, ${cap.durationSec.toFixed(1)} s` : ''})`);
      if (!cap.personalDataChecked) log.warn('Ajoutez --checked après avoir vérifié qu’aucune donnée personnelle n’est visible : sinon la capture ne sera pas utilisée.');
      return;
    }
    case 'captures:region': {
      const cap = await addFocusRegion(need(positionals[0], 'Capture manquante.'), {
        id: need(str('id'), '--id requis'),
        x: Number(str('x')),
        y: Number(str('y')),
        w: Number(str('w')),
        h: Number(str('h')),
        label: need(str('label'), '--label requis'),
      });
      log.ok(`Zone ajoutée à ${cap.id} (${cap.focusRegions.length} zone(s))`);
      return;
    }
    case 'music:add': {
      const src = need(positionals[0], 'Fichier audio manquant.');
      const id = need(str('id'), '--id requis');
      await fsp.mkdir(PATHS.musicDir, {recursive: true});
      const dest = `${id}${path.extname(src).toLowerCase()}`;
      await fsp.copyFile(src, path.join(PATHS.musicDir, dest));
      const dur = Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path.join(PATHS.musicDir, dest)])).stdout.trim());
      const track = TrackSchema.parse({
        id,
        file: dest,
        title: need(str('title'), '--title requis'),
        source: need(str('source'), '--source requis'),
        license: need(str('license'), '--license requis'),
        licenseUrl: str('license-url'),
        proof: need(str('proof'), '--proof requis (facture, certificat de licence…)'),
        moods: need(str('moods'), '--moods requis').split(',').map((m) => m.trim()),
        energy: Number(str('energy') ?? 3),
        durationSec: dur,
        addedAt: new Date().toISOString().slice(0, 10),
      });
      const tracks = (await loadTracks()).filter((t) => t.id !== id);
      tracks.push(track);
      await writeJson(PATHS.musicManifest, {tracks});
      log.ok(`Piste ajoutée : ${track.title} (${Math.round(dur)} s)`);
      return;
    }
    case 'sfx:build': {
      const files = await buildSfx();
      log.ok(`${files.length} sons générés dans assets/sfx`);
      return;
    }
    case 'new': {
      const config = await loadConfig();
      const editorial = await loadEditorial();
      const correctionOf = str('correction-of');
      const plan = await createPlan(config, editorial, {
        date: str('date'),
        category: str('category'),
        correction: correctionOf ? {runId: correctionOf, notes: str('notes') ?? ''} : undefined,
      });
      await upsertHistory({runId: plan.runId, date: plan.date, category: plan.category.id, artDirection: plan.artDirection, voiceId: plan.voiceId, status: 'created'});
      log.ok(`Production ${plan.runId} : ${plan.category.label} · ${plan.artDirection}`);
      console.log(`Brief : ${path.relative(PATHS.root, runPaths(plan.runId).planMd)}\nScript attendu : ${path.relative(PATHS.root, runPaths(plan.runId).script)}`);
      return;
    }
    case 'script:check': {
      const id = runId();
      const p = runPaths(id);
      const config = await loadConfig();
      const editorial = await loadEditorial();
      const plan = await readJson<Plan>(p.plan);
      const script = await readValidated(p.script, ScriptSchema);
      const history = (await loadHistory()).filter((h) => h.runId !== id).sort((a, b) => b.runId.localeCompare(a.runId));
      const result = lintScript(script, {
        category: editorial.categories.find((c) => c.id === plan.category.id)!,
        editorial,
        config,
        facts: (await loadFacts()).facts,
        captures: await loadCaptures(),
        recentHooks: plan.recentHooks,
        recentAngles: plan.recentAngles,
        lastHookStyle: history[0]?.hookStyle ?? null,
      });
      await writeJson(p.lint, result);
      for (const e of result.errors) log.error(`${e.where} [${e.rule}] ${e.message}`);
      for (const w of result.warnings) log.warn(`${w.where} [${w.rule}] ${w.message}`);
      (result.ok ? log.ok : log.error)(`Script ${result.ok ? 'conforme' : 'NON conforme'} — ${result.wordCount} mots, ~${result.estimatedDurationSec} s`);
      if (result.ok) {
        await upsertHistory({runId: id, hook: script.scenes[0]!.voiceover, hookStyle: script.hookStyle, angle: script.angle, workingTitle: script.workingTitle});
      }
      process.exitCode = result.ok ? 0 : 1;
      return;
    }
    case 'voice': {
      const id = runId();
      const config = await loadConfig();
      const report = await step(id, 'voice', () => runVoice(id, config), (r) => `${r.score}/15`);
      process.exitCode = report.pass ? 0 : 1;
      return;
    }
    case 'footage:search': {
      const id = runId();
      const config = await loadConfig();
      const res = await step(id, 'footage-search', () => searchFootage(id, config));
      log.info(`Planches contact : ${path.relative(PATHS.root, path.join(runPaths(id).footageDir, 'sheets'))} — besoin par scène : ${JSON.stringify(res.needs)}`);
      return;
    }
    case 'footage:auto': {
      const id = runId();
      const sel = autoSelection(await readJson(runPaths(id).footageCandidates));
      await writeJson(runPaths(id).footageSelection, sel);
      log.ok(`Sélection automatique : ${JSON.stringify(sel.scenes)}`);
      return;
    }
    case 'footage:fetch': {
      const id = runId();
      const clips = await step(id, 'footage-fetch', () => fetchFootage(id));
      log.ok(`${Object.values(clips).flat().length} séquence(s) prête(s)`);
      return;
    }
    case 'music': {
      const id = runId();
      const config = await loadConfig();
      const choice = await step(id, 'music', () => chooseMusic(id, config));
      log.info(`Musique : ${choice.title ?? 'aucune'} — ${choice.reason}`);
      await upsertHistory({runId: id, musicTrack: choice.trackId});
      return;
    }
    case 'edit': {
      const id = runId();
      const config = await loadConfig();
      await step(id, 'timeline', async () => {
        await buildTimelineStep(id, config);
        return conformStep(id);
      });
      return;
    }
    case 'render': {
      const id = runId();
      const config = await loadConfig();
      const out = await step(id, 'render', () => renderStep(id, config, {encodeOnly: values['encode-only'] === true}), (r) => `${r.renderSeconds} s`);
      const timeline = await readJson<{metrics: {durationSec: number}; artDirection: {id: string}}>(runPaths(id).timeline);
      await upsertHistory({runId: id, status: 'rendered', durationSec: timeline.metrics.durationSec, artDirection: timeline.artDirection.id});
      console.log(`Vidéo : ${path.relative(PATHS.root, out.final)}\nAperçu : ${path.relative(PATHS.root, out.preview)}`);
      return;
    }
    case 'qc': {
      const id = runId();
      const config = await loadConfig();
      const rep = await step(id, 'qc', () => technicalQc(id, config));
      console.log(`Planche de relecture : ${rep.contactSheet ? path.relative(PATHS.root, rep.contactSheet) : 'n/d'}`);
      return;
    }
    case 'score': {
      const id = runId();
      const config = await loadConfig();
      const rep = await step(id, 'score', () => scoreStep(id, config), (r) => `${r.total}/100`);
      for (const c of rep.criteria) log.info(`${c.label} : ${c.score}/${c.max} (${c.basis})`);
      for (const g of rep.gates) (g.ok ? log.ok : log.error)(`${g.label}${g.ok ? '' : ` — ${g.detail}`}`);
      (rep.decision === 'publishable' ? log.ok : log.warn)(rep.summary);
      await upsertHistory({runId: id, score: rep.total, decision: rep.decision, status: rep.decision === 'redo' ? 'rejected' : 'rendered', reason: rep.decision === 'publishable' ? null : rep.summary});
      return;
    }
    case 'produce': {
      const id = runId();
      const config = await loadConfig();
      const p = runPaths(id);
      if (!exists(p.lint) || !(await readJson<{ok: boolean}>(p.lint)).ok) throw new Error('Le script doit d’abord passer script:check.');
      // Resume: a step already done for this version of the script (and of everything before it) is kept.
      const state = await loadState(id);
      const scriptTime = (await fsp.stat(p.script)).mtimeMs;
      let dirty = values.force === true;
      const keep = async (name: StepName, output: string): Promise<boolean> => {
        const ok = !dirty && state.steps[name]?.status === 'done' && exists(output) && (await fsp.stat(output)).mtimeMs >= scriptTime;
        if (ok) log.info(`${name} : déjà fait pour ce script, conservé (--force pour tout refaire).`);
        else dirty = true;
        return ok;
      };
      const voice = (await keep('voice', p.voiceReport))
        ? await readJson<{pass: boolean; problems: string[]}>(p.voiceReport)
        : await step(id, 'voice', () => runVoice(id, config), (r) => `${r.score}/15`);
      if (!voice.pass) throw new Error(`Voix insuffisante : ${voice.problems.join(' ; ')}`);
      if (!(await keep('footage-search', p.footageCandidates))) await step(id, 'footage-search', () => searchFootage(id, config));
      if (!exists(p.footageSelection)) await writeJson(p.footageSelection, autoSelection(await readJson(p.footageCandidates)));
      if (!(await keep('footage-fetch', p.footageLicenses))) await step(id, 'footage-fetch', () => fetchFootage(id));
      if (!(await keep('music', p.musicChoice))) {
        const choice = await step(id, 'music', () => chooseMusic(id, config));
        await upsertHistory({runId: id, musicTrack: choice.trackId});
      }
      await step(id, 'timeline', async () => {
        await buildTimelineStep(id, config);
        return conformStep(id);
      });
      await step(id, 'render', () => renderStep(id, config));
      await step(id, 'qc', () => technicalQc(id, config));
      log.ok('Production rendue : place à la relecture indépendante (qc/review.json), puis « score ».');
      return;
    }
    case 'link:check': {
      const config = await loadConfig();
      const res = await checkAffiliateLink(config.affiliate.url);
      res.hops.forEach((h) => log.info(`${h.status} ${h.url}${h.location ? ` → ${h.location}` : ''}`));
      (res.ok ? log.ok : log.error)(res.ok ? 'Lien affilié valide' : `Lien affilié à corriger : ${res.problems.join(' ; ')}`);
      process.exitCode = res.ok ? 0 : 1;
      return;
    }
    case 'publish:prepare': {
      const id = runId();
      const config = await loadConfig();
      await step(id, 'publish-prepare', () => preparePublication(id, config, {skipLinkCheck: values['skip-link-check'] === true}));
      return;
    }
    case 'media:push': {
      const id = runId();
      const config = await loadConfig();
      await pushMedia(id, config);
      return;
    }
    case 'publish:record': {
      const id = runId();
      const network = need(str('network'), '--network requis') as 'tiktok' | 'instagram';
      const response = await readJson<Record<string, unknown>>(need(str('response'), '--response requis'));
      const pkg = await readJson<{media: {sha256: string; publicUrl: string}; posts: Array<{network: string; date: string; text: string}>}>(path.join(runPaths(id).publishDir, 'package.json'));
      const post = pkg.posts.find((x) => x.network === network);
      const flat = JSON.stringify(response);
      const pick = (re: RegExp) => flat.match(re)?.[1] ?? null;
      const config = await loadConfig();
      await upsertPublication({
        runId: id,
        network,
        contentSha256: pkg.media.sha256,
        mediaUrl: pkg.media.publicUrl,
        scheduledFor: post?.date ?? new Date().toISOString(),
        delivery: config.publish.delivery,
        approvedBy: config.publish.approval,
        status: str('status') === 'draft' ? 'draft' : 'scheduled',
        metricoolPostId: pick(/"id"\s*:\s*"?(\d+)/),
        metricoolUuid: pick(/"uuid"\s*:\s*"([^"]+)"/),
        plannerUrl: pick(/"plannerUrl"\s*:\s*"([^"]+)"/),
        permalink: null,
        captionStart: (post?.text ?? '').slice(0, 80),
        confirmedAt: null,
        note: 'programmée via Metricool (publication non encore confirmée par la plateforme)',
        recordedAt: new Date().toISOString(),
      });
      await upsertHistory({runId: id, status: 'scheduled'});
      log.ok(`Programmation enregistrée pour ${network} (statut « programmée », pas encore « publiée »).`);
      return;
    }
    case 'panel:export': {
      const id = runId();
      await exportVideoDoc(id, {previewAssetId: str('preview-asset'), previewUrl: str('preview-url'), coverAssetId: str('cover-asset'), coverUrl: str('cover-url')});
      return;
    }
    case 'panel:settings': {
      const doc = await exportSettingsDoc(await loadConfig(), {triggerId: str('trigger-id') ?? null});
      log.ok(`Réglages exportés : data/panel/settings-export.json (${Object.keys(doc).length} champs)`);
      return;
    }
    case 'state:facts': {
      const out = await exportFactsState();
      log.ok(`Faits prêts pour le panneau : ${path.relative(PATHS.root, out)} (document state/facts)`);
      return;
    }
    case 'panel:import': {
      const summary = await importPanelDump(need(positionals[0], 'Fichier d’export du panneau manquant.'));
      log.ok(`Panneau importé : ${JSON.stringify(summary)}`);
      return;
    }
    case 'stats:import': {
      const res = await importStats(need(positionals[0], 'Fichier de statistiques manquant.'));
      log.ok(`${res.matched.length} publication(s) mises à jour, ${res.unmatched} non rattachée(s)`);
      return;
    }
    case 'affiliate:add': {
      await upsertAffiliate({
        date: need(str('date'), '--date requis'),
        clicks: num('clicks'),
        signups: num('signups'),
        paidSubscriptions: num('paid'),
        commission: num('commission'),
        currency: 'EUR',
        source: 'saisie manuelle (tableau de bord affilié Systeme.io)',
        recordedAt: new Date().toISOString(),
      });
      log.ok('Chiffres d’affiliation enregistrés.');
      return;
    }
    case 'insights': {
      const ins = await computeInsights();
      console.log(JSON.stringify(ins, null, 2));
      return;
    }
    case 'history': {
      for (const h of await loadHistory()) console.log(`${h.runId}  ${h.status.padEnd(9)}  ${String(h.score ?? '–').padStart(5)}  ${h.category}  ${h.workingTitle ?? ''}`);
      return;
    }
    case 'score:show': {
      const rep = await readJson<ScoreReport>(runPaths(runId()).score);
      console.log(JSON.stringify(rep, null, 2));
      return;
    }
    default:
      console.log(HELP);
      throw new Error(`Commande inconnue : ${command}`);
  }
}

main().catch((err) => {
  log.error((err as Error).message);
  process.exitCode = 1;
});

