import Anthropic from '@anthropic-ai/sdk';
import type {ProviderCaller} from '../router.js';

/**
 * Claude through the official SDK. Claude Opus 5.5 always thinks: depth is set with output_config.effort
 * (default "medium"). Server-side refusal fallbacks are on ("default" routing), so a policy decline is
 * retried on a fallback model inside the same call; a refusal of the whole chain is reported as an error.
 */
export const callAnthropic: ProviderCaller = async ({model, apiKey, system, prompt, maxTokens}) => {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY absente');
  const client = new Anthropic({apiKey, maxRetries: 2, timeout: 10 * 60_000});
  const params: any = {
    model: model.model,
    max_tokens: Math.max(maxTokens, 8000),
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: {effort: model.effort ?? 'medium'},
    system,
    messages: [{role: 'user', content: prompt}],
  };
  try {
    const response: any = await client.beta.messages.create(params);
    if (response.stop_reason === 'refusal') {
      const cat = response.stop_details?.category ?? 'inconnue';
      throw new Error(`refus du modèle (catégorie ${cat})`);
    }
    const text = (response.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');
    if (!text.trim()) throw new Error(`réponse sans texte (stop_reason ${response.stop_reason})`);
    return {text, tokensIn: Number(response.usage?.input_tokens ?? 0), tokensOut: Number(response.usage?.output_tokens ?? 0)};
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error('clé Anthropic refusée');
    if (error instanceof Anthropic.RateLimitError) throw new Error('limite de débit Anthropic atteinte');
    if (error instanceof Anthropic.BadRequestError) throw new Error(`requête refusée : ${error.message}`);
    if (error instanceof Anthropic.APIError) throw new Error(`erreur Anthropic ${error.status} : ${error.message}`);
    throw error;
  }
};
