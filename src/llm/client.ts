import fs from 'node:fs';
import {http} from '../core/http.js';

/**
 * Any OpenAI-compatible chat endpoint, so the studio can write and review without Claude:
 * FreeLLMAPI (free tiers of ~30 providers behind one /v1 endpoint), Google AI Studio (Gemini),
 * Groq, OpenRouter… Configured only by environment variables; the key is never logged.
 *
 *   STUDIO_LLM_API_KEY      required
 *   STUDIO_LLM_BASE_URL     default: Google AI Studio's OpenAI-compatible endpoint
 *   STUDIO_LLM_MODEL        default: gemini-2.5-flash (FreeLLMAPI: "auto:smartest"); a comma-separated list
 *                           is tried in order (next model when one hits its free quota)
 *   STUDIO_LLM_VISION_MODEL model(s) that can read images (review of the frames); default: STUDIO_LLM_MODEL
 *
 * In GitHub Actions without any key, the workflow uses GitHub Models (free, ChatGPT and other AIs, with the
 * job's own token): small requests only (about 8 000 tokens in), hence `compact()`.
 */
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
}

/** Free tiers with a small request size (GitHub Models): prompts are trimmed to fit. */
export function compact(cfg: LlmConfig = llmConfig()): boolean {
  return /models\.github\.ai|models\.inference\.ai\.azure\.com|pollinations\.ai/.test(cfg.baseUrl) || process.env.STUDIO_LLM_COMPACT === '1';
}

/** How large a prompt may be: GitHub Models accepts about 8 000 tokens, Pollinations more, others much more. */
export function promptBudget(cfg: LlmConfig = llmConfig()): number {
  if (/models\.github\.ai|models\.inference\.ai\.azure\.com/.test(cfg.baseUrl.split(',')[0] ?? '')) return /pollinations\.ai/.test(cfg.baseUrl) ? 14_000 : 6800;
  if (/pollinations\.ai/.test(cfg.baseUrl)) return 14_000;
  return 60_000;
}

/** Rough token count of a prompt (French text and JSON: about 3 characters per token). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3);

export function llmConfig(): LlmConfig {
  const apiKey = process.env.STUDIO_LLM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'Aucune IA configurée : ajouter le secret STUDIO_LLM_API_KEY (clé gratuite Google AI Studio, ou clé unifiée FreeLLMAPI avec STUDIO_LLM_BASE_URL) — voir docs/production-sans-claude.md.',
    );
  }
  const baseUrl = (process.env.STUDIO_LLM_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, '');
  const model = process.env.STUDIO_LLM_MODEL?.trim() || 'gemini-2.5-flash';
  return {baseUrl, apiKey, model, visionModel: process.env.STUDIO_LLM_VISION_MODEL?.trim() || model};
}

export type ChatPart = {type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string; detail?: 'low' | 'high'}};
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatPart[];
}

export interface ChatOptions {
  vision?: boolean;
  temperature?: number;
  maxTokens?: number;
}

/** Addresses that answered something other than a chat completion: skipped for the rest of the run. */
const brokenBases = new Set<string>();
/** Keyless free tier (Pollinations): one reply every 45 seconds per address, so requests are spaced. */
let lastKeyless = 0;
/** Free models of the keyless address, read once from its own list (names change over time). */
let keylessModels: {text: string[]; vision: string[]} | null = null;

async function freeModels(base: string): Promise<{text: string[]; vision: string[]}> {
  if (keylessModels) return keylessModels;
  const fallback = {text: ['openai'], vision: ['openai']};
  try {
    const res = await http(base.replace(/\/openai$/, '/models'), {timeoutMs: 20_000, retries: 1});
    const list = (await res.json()) as Array<{name?: string; id?: string; input_modalities?: string[]; vision?: boolean; tier?: string}>;
    const names = list.filter((m) => !m.tier || /anonymous|free|seed/i.test(m.tier));
    const pick = (ms: typeof list) => ms.map((m) => m.name ?? m.id ?? '').filter(Boolean);
    const text = pick(names);
    const vision = pick(names.filter((m) => m.vision || m.input_modalities?.includes('image')));
    // « openai » first when listed (the steadiest), then the others in the service's order.
    const order = (xs: string[]) => [...new Set([...xs.filter((x) => x === 'openai'), ...xs])].slice(0, 4);
    keylessModels = {text: order(text).length ? order(text) : fallback.text, vision: order(vision).length ? order(vision) : fallback.vision};
  } catch {
    keylessModels = fallback;
  }
  return keylessModels;
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One chat completion; returns the text of the first choice. Models are tried in the configured order: a model
 * out of free quota (429), refusing the request size (413) or failing is replaced by the next one.
 */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}, cfg: LlmConfig = llmConfig()): Promise<{text: string; model: string}> {
  const models = (opts.vision ? cfg.visionModel : cfg.model).split(',').map((m) => m.trim()).filter(Boolean);
  // Several endpoints may be listed (comma-separated): the next one is tried when one does not answer properly.
  const bases = cfg.baseUrl.split(',').map((b) => b.trim().replace(/\/+$/, '')).filter(Boolean);
  const errors: string[] = [];
  for (const base of bases) {
  if (brokenBases.has(base)) continue;
  const github = /models\.github\.ai/.test(base);
  const azure = /inference\.ai\.azure\.com/.test(base);
  // Pollinations: free, no account, several AIs behind one OpenAI-compatible address. Never send it our key.
  const keyless = /pollinations\.ai/.test(base);
  const url = /pollinations\.ai\/openai$/.test(base) ? base : `${base}/chat/completions`;
  const candidates = keyless ? (opts.vision ? (await freeModels(base)).vision : (await freeModels(base)).text) : models;
  for (const listed of candidates) {
    if (brokenBases.has(base)) break;
    // The Azure endpoint of GitHub Models names models without their publisher (« gpt-4.1 »).
    const model = azure ? listed.replace(/^[^/]+\//, '') : listed;
    for (let attempt = 0; attempt < (keyless ? 4 : 2); attempt++) {
      if (keyless) {
        const wait = lastKeyless + 46_000 - Date.now();
        if (wait > 0) await pause(wait);
        lastKeyless = Date.now();
      }
      let res: Awaited<ReturnType<typeof http>>;
      try {
        res = await http(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: github ? 'application/vnd.github+json' : 'application/json',
            ...(github ? {'x-github-api-version': '2022-11-28'} : {}),
            ...(keyless ? {} : {authorization: `Bearer ${cfg.apiKey}`}),
          },
          // Free reasoning models spend tokens thinking before they answer: no output cap and little reasoning there.
          body: JSON.stringify(keyless ? {model, messages, temperature: opts.temperature ?? 0.7, reasoning_effort: 'low'} : {model, messages, temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens ?? (compact(cfg) ? 4000 : 8000)}),
          redirect: 'manual',
          timeoutMs: 240_000,
          retries: 2,
          retryOn: [500, 502, 503, 504],
        });
      } catch (e) {
        errors.push(`${base} ${model} : ${(e as Error).message}`);
        break;
      }
      const raw = await res.text().catch(() => '');
      let body: {choices?: Array<{message?: {content?: string | Array<{text?: string}> | null; refusal?: string | null}; finish_reason?: string}>; model?: string; error?: {message?: string; code?: string} | string} | null = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      if (res.ok) {
        const choice = body?.choices?.[0];
        const content = choice?.message?.content;
        const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : '';
        if (text.trim()) return {text, model: body?.model ?? model};
        // Say exactly what came back, so a broken endpoint or a filter is visible in the job log.
        const why = choice?.finish_reason ? `fin : ${choice.finish_reason}` : choice?.message?.refusal ? `refus : ${choice.message.refusal}` : `corps : ${raw.replace(/\s+/g, ' ').slice(0, 240) || '(vide)'}`;
        errors.push(`${base} ${model} : réponse sans texte (HTTP ${res.status}, ${res.headers.get('content-type') ?? 'type inconnu'}, ${why})`);
        // Not a chat completion at all (e.g. a bare « OK »): this address is not serving the API, skip it.
        if (!body) brokenBases.add(base);
        break;
      }
      // Keyless free tier: « Retry after 45s » means wait, then the same model answers.
      const retryIn = Number(/retry after (\d+)\s*s/i.exec(raw)?.[1]);
      if (keyless && (res.status === 402 || res.status === 429) && Number.isFinite(retryIn) && attempt < 3) {
        lastKeyless = Date.now() + retryIn * 1000 - 46_000 + 1500;
        continue;
      }
      const msg = typeof body?.error === 'string' ? body.error : body?.error?.message ?? raw.replace(/\s+/g, ' ').slice(0, 160);
      const loc = res.headers.get('location');
      errors.push(`${base} ${model} : erreur ${res.status} ${msg}${loc ? ` (redirigé vers ${loc})` : ''}`.trim());
      // A short wait is worth one more try on the same model; a daily quota is not.
      const wait = Number(res.headers.get('retry-after'));
      if (res.status === 429 && attempt === 0 && Number.isFinite(wait) && wait > 0 && wait <= 60) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      break;
    }
  }
  }
  throw new Error(`IA indisponible : ${errors.join(' | ')}`);
}

/** The JSON object in a reply (models sometimes wrap it in ```json fences or a sentence). */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Réponse de l’IA sans objet JSON.');
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

export function imagePart(file: string, detail?: 'low' | 'high'): ChatPart {
  const url = `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`;
  return {type: 'image_url', image_url: detail ? {url, detail} : {url}};
}
