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
  return /models\.github\.ai|models\.inference\.ai\.azure\.com/.test(cfg.baseUrl) || process.env.STUDIO_LLM_COMPACT === '1';
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

/**
 * One chat completion; returns the text of the first choice. Models are tried in the configured order: a model
 * out of free quota (429), refusing the request size (413) or failing is replaced by the next one.
 */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}, cfg: LlmConfig = llmConfig()): Promise<{text: string; model: string}> {
  const models = (opts.vision ? cfg.visionModel : cfg.model).split(',').map((m) => m.trim()).filter(Boolean);
  const errors: string[] = [];
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await http(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}`},
        body: JSON.stringify({model, messages, temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens ?? (compact(cfg) ? 4000 : 8000)}),
        timeoutMs: 240_000,
        retries: 3,
        retryOn: [500, 502, 503, 504],
      });
      const body = (await res.json().catch(() => null)) as {choices?: Array<{message?: {content?: string | Array<{text?: string}>}}>; model?: string; error?: {message?: string} | string} | null;
      if (res.ok) {
        const content = body?.choices?.[0]?.message?.content;
        const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : '';
        if (text.trim()) return {text, model: body?.model ?? model};
        errors.push(`${model} : réponse vide`);
        break;
      }
      const msg = typeof body?.error === 'string' ? body.error : body?.error?.message ?? '';
      errors.push(`${model} : erreur ${res.status} ${msg}`.trim());
      // A short wait is worth one more try on the same model; a daily quota is not.
      const wait = Number(res.headers.get('retry-after'));
      if (res.status === 429 && attempt === 0 && Number.isFinite(wait) && wait > 0 && wait <= 60) {
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      break;
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
