import fsp from 'node:fs/promises';
import {FormData} from 'undici';
import {http, httpJson, HttpError} from '../core/http.js';
import type {VoiceSettings} from '../schemas/config.js';

const API = 'https://api.elevenlabs.io';

/**
 * The key comes from ELEVENLABS_API_KEY when set (GitHub Actions, local runs). In a Claude Code
 * cloud environment it can instead be a "network secret" injected by the proxy for
 * api.elevenlabs.io, in which case no header is sent from here.
 */
function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = {accept: 'application/json'};
  if (process.env.ELEVENLABS_API_KEY) h['xi-api-key'] = process.env.ELEVENLABS_API_KEY;
  if (json) h['content-type'] = 'application/json';
  return h;
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface TtsResult {
  audio: Buffer;
  alignment: Alignment | null;
  normalizedAlignment: Alignment | null;
  requestId: string | null;
}

export function supportsLanguageCode(modelId: string): boolean {
  return /turbo_v2_5|flash_v2_5|eleven_v3/.test(modelId);
}

export async function textToSpeechWithTimestamps(
  voiceId: string,
  text: string,
  opts: {modelId: string; outputFormat: string; settings: VoiceSettings; languageCode?: string; seed?: number},
): Promise<TtsResult> {
  const body: Record<string, unknown> = {
    text,
    model_id: opts.modelId,
    voice_settings: opts.settings,
  };
  if (opts.seed !== undefined) body.seed = opts.seed;
  if (opts.languageCode && supportsLanguageCode(opts.modelId)) body.language_code = opts.languageCode;
  const url = `${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${encodeURIComponent(opts.outputFormat)}`;
  const res = await http(url, {method: 'POST', headers: headers(true), body: JSON.stringify(body), timeoutMs: 180_000, retries: 2});
  const raw = await res.text();
  if (!res.ok) throw new HttpError(`ElevenLabs TTS : HTTP ${res.status} — ${raw.slice(0, 400)}`, res.status, raw, url);
  const json = JSON.parse(raw) as {audio_base64?: string; alignment?: Alignment | null; normalized_alignment?: Alignment | null};
  if (!json.audio_base64) throw new Error('ElevenLabs TTS : réponse sans audio');
  return {
    audio: Buffer.from(json.audio_base64, 'base64'),
    alignment: json.alignment ?? null,
    normalizedAlignment: json.normalized_alignment ?? null,
    requestId: res.headers.get('request-id'),
  };
}

export interface SttWord {
  text: string;
  start: number;
  end: number;
  type?: string;
}

export async function speechToText(file: string, opts: {modelId: string; languageCode: string}): Promise<{text: string; words: SttWord[]}> {
  const form = new FormData();
  const data = await fsp.readFile(file);
  form.append('model_id', opts.modelId);
  form.append('language_code', opts.languageCode);
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'false');
  form.append('file', new Blob([data]), file.split('/').pop() ?? 'audio.wav');
  const url = `${API}/v1/speech-to-text`;
  const res = await http(url, {method: 'POST', headers: headers(false), body: form, timeoutMs: 180_000, retries: 2});
  const raw = await res.text();
  if (!res.ok) throw new HttpError(`ElevenLabs STT : HTTP ${res.status} — ${raw.slice(0, 400)}`, res.status, raw, url);
  const json = JSON.parse(raw) as {text?: string; words?: SttWord[]};
  return {text: json.text ?? '', words: (json.words ?? []).filter((w) => !w.type || w.type === 'word')};
}

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
  description?: string | null;
}

export async function listMyVoices(): Promise<VoiceInfo[]> {
  const json = await httpJson<{voices: VoiceInfo[]}>(`${API}/v2/voices?page_size=100`, {headers: headers(false)});
  return json.voices ?? [];
}

/** Generate an instrumental bed with Eleven Music (paid plans; check the music terms of your plan). */
export async function composeMusic(prompt: string, lengthMs: number, modelId?: string): Promise<Buffer> {
  const body: Record<string, unknown> = {prompt, music_length_ms: Math.round(lengthMs), force_instrumental: true};
  if (modelId) body.model_id = modelId;
  const url = `${API}/v1/music?output_format=mp3_44100_128`;
  const res = await http(url, {method: 'POST', headers: {...headers(true), accept: 'audio/mpeg'}, body: JSON.stringify(body), timeoutMs: 300_000, retries: 1});
  if (!res.ok) {
    const raw = await res.text();
    throw new HttpError(`Eleven Music : HTTP ${res.status} — ${raw.slice(0, 400)}`, res.status, raw, url);
  }
  return Buffer.from(await res.arrayBuffer());
}
