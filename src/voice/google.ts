import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {http, HttpError} from '../core/http.js';
import {PATHS} from '../core/paths.js';
import {escapeXml} from './azure.js';

/**
 * Google Cloud Text-to-Speech (REST v1), the professional version of Google's natural French voices (choice of the
 * user on 15/11/2026, to replace « Claire »). Terms checked on 15/11/2026 (docs/voix-google.md): Text-to-Speech is a
 * « Pre-Trained API » (AI/ML Services), not a Generative AI Service; Google claims no rights on the audio; its output
 * may not be used to build a competing voice model. Free each month: 1 million characters for Neural2 and Chirp 3 HD
 * voices; billing must be enabled on the user's Google Cloud account, so the studio caps its own monthly use.
 *
 * The key comes from GOOGLE_TTS_API_KEY when set (GitHub Actions, local runs). In the Claude Code cloud environment it
 * is a network secret the proxy injects as the X-Goog-Api-Key header for texttospeech.googleapis.com: nothing is sent
 * from here, and the key never appears in the code, the logs or the repository.
 */
const API = 'https://texttospeech.googleapis.com/v1';
const USAGE_FILE = path.join(PATHS.root, 'data', 'voice-usage.json');

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = {accept: 'application/json', 'user-agent': 'studio-pub-systeme-io'};
  if (json) h['content-type'] = 'application/json';
  if (process.env.GOOGLE_TTS_API_KEY) h['x-goog-api-key'] = process.env.GOOGLE_TTS_API_KEY;
  return h;
}

/** Chirp 3 HD voices read plain text only (no SSML): scenes are separated by paragraphs instead of breaks. */
export function isChirp(voiceName: string): boolean {
  return /chirp/i.test(voiceName);
}

/** The request body for one voice-over, and the characters Google will count for it. */
export function googleRequest(
  parts: string[],
  voiceName: string,
  opts: {languageCode: string; speakingRate: number; sceneBreakMs: number; sampleRateHertz: number},
): {body: Record<string, unknown>; characters: number} {
  const chirp = isChirp(voiceName);
  const content = chirp ? parts.join('\n\n') : `<speak>${parts.map((p) => escapeXml(p)).join(`<break time="${opts.sceneBreakMs}ms"/>`)}</speak>`;
  const rate = Math.round(Math.min(1.25, Math.max(0.8, opts.speakingRate)) * 100) / 100;
  const body = {
    input: chirp ? {text: content} : {ssml: content},
    voice: {languageCode: opts.languageCode, name: voiceName},
    audioConfig: {audioEncoding: 'LINEAR16', sampleRateHertz: opts.sampleRateHertz, ...(rate !== 1 ? {speakingRate: rate} : {})},
  };
  // Google counts every character sent, SSML tags included.
  return {body, characters: content.length};
}

/** One voice-over as WAV (LINEAR16 comes with its WAV header). */
export async function googleSynthesize(
  parts: string[],
  voiceName: string,
  opts: {languageCode: string; speakingRate: number; sceneBreakMs: number; sampleRateHertz: number; monthlyCharacterLimit: number},
): Promise<{audio: Buffer; characters: number}> {
  const req = googleRequest(parts, voiceName, opts);
  const used = googleUsage().characters;
  if (used + req.characters > opts.monthlyCharacterLimit) {
    throw new Error(`Quota du studio pour les voix Google atteint ce mois-ci (${used} caractères sur ${opts.monthlyCharacterLimit}) : voix de secours.`);
  }
  const url = `${API}/text:synthesize`;
  let res = await http(url, {method: 'POST', headers: headers(true), body: JSON.stringify(req.body), timeoutMs: 120_000, retries: 2, retryOn: [500, 502, 503, 504]});
  let raw = await res.text();
  // A voice that refuses the speaking rate: the same text at its natural pace (the audio is measured afterwards).
  if (res.status === 400 && /speaking.?rate|speakingRate/i.test(raw) && (req.body.audioConfig as Record<string, unknown>).speakingRate) {
    delete (req.body.audioConfig as Record<string, unknown>).speakingRate;
    res = await http(url, {method: 'POST', headers: headers(true), body: JSON.stringify(req.body), timeoutMs: 120_000, retries: 2, retryOn: [500, 502, 503, 504]});
    raw = await res.text();
  }
  if (!res.ok) throw new HttpError(`Google Text-to-Speech : HTTP ${res.status} ${raw.slice(0, 300)}`, res.status, raw, url);
  const json = JSON.parse(raw) as {audioContent?: string};
  if (!json.audioContent) throw new Error('Google Text-to-Speech : réponse sans audio.');
  await recordGoogleUsage(req.characters);
  return {audio: Buffer.from(json.audioContent, 'base64'), characters: req.characters};
}

export interface GoogleVoice {
  name: string;
  ssmlGender?: string;
  naturalSampleRateHertz?: number;
  languageCodes?: string[];
}

/** French voices of the account (free: listing voices costs no characters). Also proves the key works. */
export async function googleListVoices(languageCode: string): Promise<GoogleVoice[]> {
  const url = `${API}/voices?languageCode=${encodeURIComponent(languageCode)}`;
  const res = await http(url, {headers: headers(false), timeoutMs: 30_000, retries: 1});
  const raw = await res.text();
  if (!res.ok) throw new HttpError(`Google Text-to-Speech (liste des voix) : HTTP ${res.status} ${raw.slice(0, 300)}`, res.status, raw, url);
  return (JSON.parse(raw) as {voices?: GoogleVoice[]}).voices ?? [];
}

/** Can a Google voice speak now: key present (answer of the free voice list) and the studio's monthly cap not reached. */
export async function googleReady(voiceName: string, opts: {languageCode: string; monthlyCharacterLimit: number}): Promise<string | null> {
  const used = googleUsage().characters;
  if (used >= opts.monthlyCharacterLimit * 0.98) return `quota du studio atteint ce mois-ci (${used} caractères)`;
  try {
    const voices = await googleListVoices(opts.languageCode);
    if (!voices.some((v) => v.name === voiceName)) return `voix ${voiceName} introuvable chez Google`;
    return null;
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    return status === 401 || status === 403 ? 'clé Google absente ou refusée' : `Google injoignable (${(e as Error).message.slice(0, 120)})`;
  }
}

/** Characters sent to Google this month (kept in data/voice-usage.json, committed with the studio's history). */
export function googleUsage(now = new Date()): {month: string; characters: number} {
  const month = now.toISOString().slice(0, 7);
  try {
    const data = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')) as {google?: Record<string, number>};
    return {month, characters: data.google?.[month] ?? 0};
  } catch {
    return {month, characters: 0};
  }
}

async function recordGoogleUsage(characters: number, now = new Date()): Promise<void> {
  const month = now.toISOString().slice(0, 7);
  let data: {google?: Record<string, number>} = {};
  try {
    data = JSON.parse(await fsp.readFile(USAGE_FILE, 'utf8'));
  } catch {
    data = {};
  }
  data.google = {...(data.google ?? {}), [month]: (data.google?.[month] ?? 0) + characters};
  await fsp.mkdir(path.dirname(USAGE_FILE), {recursive: true});
  await fsp.writeFile(USAGE_FILE, `${JSON.stringify(data, null, 2)}\n`);
}
