import type {ProviderCaller} from '../router.js';

/**
 * Any OpenAI-compatible chat endpoint: GitHub Models, Google AI Studio, Groq, OpenRouter, Mistral,
 * Pollinations, a self-hosted FreeLLMAPI. Plain HTTP, no SDK, 90 s timeout.
 */
export const callOpenAiCompatible: ProviderCaller = async ({provider, model, apiKey, baseUrl, system, prompt, maxTokens}) => {
  if (!baseUrl) throw new Error('adresse du fournisseur absente');
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const headers: Record<string, string> = {'Content-Type': 'application/json', ...(provider.headers ?? {})};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model: model.model,
        max_tokens: maxTokens,
        messages: [
          {role: 'system', content: system},
          {role: 'user', content: prompt},
        ],
      }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} : ${body.slice(0, 300)}`);
    let data: any;
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`réponse non JSON (HTTP ${res.status}, ${res.headers.get('content-type') ?? '?'}) : ${body.slice(0, 120)}`);
    }
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw new Error('réponse vide');
    return {
      text,
      tokensIn: Number(data?.usage?.prompt_tokens ?? Math.ceil((system.length + prompt.length) / 4)),
      tokensOut: Number(data?.usage?.completion_tokens ?? Math.ceil(text.length / 4)),
    };
  } finally {
    clearTimeout(timer);
  }
};
