import fsp from 'node:fs/promises';
import {FormData} from 'undici';
import {http, httpJson, HttpError} from '../core/http.js';

/**
 * Azure AI Speech — free F0 tier (neural voices: 0.5 M characters / month; speech to text:
 * 5 audio hours / month). The key comes from AZURE_SPEECH_KEY when set, otherwise it is
 * injected by the Claude Code environment proxy as the Ocp-Apim-Subscription-Key header.
 */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = {'user-agent': 'studio-pub-systeme-io', ...extra};
  if (process.env.AZURE_SPEECH_KEY) h['ocp-apim-subscription-key'] = process.env.AZURE_SPEECH_KEY;
  return h;
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * SSML for one voice-over: scenes separated by a short breath, speaking rate from the
 * approved voice's settings. Multilingual voices are pinned to French.
 */
export function buildSsml(parts: string[], voice: string, opts: {ratePercent: number; sceneBreakMs: number; locale: string}): string {
  const rate = `${opts.ratePercent >= 0 ? '+' : ''}${Math.round(opts.ratePercent)}%`;
  const body = parts.map((p) => escapeXml(p)).join(`<break time="${opts.sceneBreakMs}ms"/>`);
  const inner = /Multilingual/i.test(voice) ? `<lang xml:lang="${opts.locale}">${body}</lang>` : body;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${opts.locale}"><voice name="${escapeXml(voice)}"><prosody rate="${rate}">${inner}</prosody></voice></speak>`;
}

export async function azureSynthesize(ssml: string, opts: {region: string; outputFormat?: string}): Promise<Buffer> {
  const url = `https://${opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const res = await http(url, {
    method: 'POST',
    headers: headers({'content-type': 'application/ssml+xml', 'x-microsoft-outputformat': opts.outputFormat ?? 'riff-48khz-16bit-mono-pcm'}),
    body: ssml,
    timeoutMs: 120_000,
    retries: 2,
  });
  if (!res.ok) {
    const raw = await res.text();
    throw new HttpError(`Azure Speech (voix) : HTTP ${res.status} ${raw.slice(0, 300)}`, res.status, raw, url);
  }
  return Buffer.from(await res.arrayBuffer());
}

export interface AzureVoice {
  ShortName: string;
  DisplayName: string;
  LocalName?: string;
  Gender: string;
  Locale: string;
  VoiceType: string;
  SecondaryLocaleList?: string[];
  StyleList?: string[];
}

export async function azureListVoices(region: string): Promise<AzureVoice[]> {
  return httpJson<AzureVoice[]>(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {headers: headers(), timeoutMs: 30_000});
}

export interface AzureWord {
  text: string;
  start: number;
  end: number;
}

/** Fast transcription with word timings (used to time captions and to check pronunciation). */
export async function azureTranscribe(file: string, opts: {region: string; locale: string}): Promise<{text: string; words: AzureWord[]}> {
  const url = `https://${opts.region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
  const form = new FormData();
  form.append('audio', new Blob([await fsp.readFile(file)]), file.split('/').pop() ?? 'audio.wav');
  form.append('definition', JSON.stringify({locales: [opts.locale], profanityFilterMode: 'None'}));
  const res = await http(url, {method: 'POST', headers: headers({accept: 'application/json'}), body: form, timeoutMs: 180_000, retries: 2});
  const raw = await res.text();
  if (!res.ok) throw new HttpError(`Azure Speech (transcription) : HTTP ${res.status} ${raw.slice(0, 300)}`, res.status, raw, url);
  const json = JSON.parse(raw) as {
    combinedPhrases?: Array<{text?: string}>;
    phrases?: Array<{words?: Array<{text: string; offsetMilliseconds: number; durationMilliseconds: number}>}>;
  };
  const words: AzureWord[] = [];
  for (const ph of json.phrases ?? []) {
    for (const w of ph.words ?? []) words.push({text: w.text, start: w.offsetMilliseconds / 1000, end: (w.offsetMilliseconds + w.durationMilliseconds) / 1000});
  }
  return {text: (json.combinedPhrases ?? []).map((c) => c.text ?? '').join(' ').trim(), words};
}
