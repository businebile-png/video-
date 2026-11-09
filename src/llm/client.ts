import fs from 'node:fs';
import {http} from '../core/http.js';

/**
 * Any OpenAI-compatible chat endpoint, so the studio can write and review without Claude:
 * FreeLLMAPI (free tiers of ~30 providers behind one /v1 endpoint), Google AI Studio (Gemini),
 * Groq, OpenRouter… Configured only by environment variables; the key is never logged.
 *
 *   STUDIO_LLM_API_KEY      required
 *   STUDIO_LLM_BASE_URL     default: Google AI Studio's OpenAI-compatible endpoint
 *   STUDIO_LLM_MODEL        default: gemini-2.5-flash (FreeLLMAPI: "auto:smartest")
 *   STUDIO_LLM_VISION_MODEL model that can read images (review of the frames); default: STUDIO_LLM_MODEL
 */
export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
}

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

export type ChatPart = {type: 'text'; text: string} | {type: 'image_url'; image_url: {url: string}};
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | ChatPart[];
}

export interface ChatOptions {
  vision?: boolean;
  temperature?: number;
  maxTokens?: number;
}

/** One chat completion; returns the text of the first choice. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}, cfg: LlmConfig = llmConfig()): Promise<{text: string; model: string}> {
  const model = opts.vision ? cfg.visionModel : cfg.model;
  const res = await http(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}`},
    body: JSON.stringify({model, messages, temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens ?? 8000}),
    timeoutMs: 240_000,
    retries: 4,
  });
  const body = (await res.json().catch(() => null)) as {choices?: Array<{message?: {content?: string | Array<{text?: string}>}}>; model?: string; error?: {message?: string}} | null;
  if (!res.ok) throw new Error(`IA (${model}) : erreur ${res.status} ${body?.error?.message ?? ''}`.trim());
  const content = body?.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => c.text ?? '').join('') : '';
  if (!text.trim()) throw new Error(`IA (${model}) : réponse vide`);
  return {text, model: body?.model ?? model};
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

export function imagePart(file: string): ChatPart {
  return {type: 'image_url', image_url: {url: `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`}};
}
