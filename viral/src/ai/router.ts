import type {Db} from '../core/db.js';
import type {AppConfig, ModelConfig, ProviderConfig, Role} from '../core/config.js';
import {callOpenAiCompatible} from './providers/openai-compat.js';
import {callAnthropic} from './providers/anthropic.js';

export interface ChatRequest {
  role: Role;
  purpose: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Expect a JSON answer: the router extracts and parses it, and treats unparsable output as a failure. */
  json?: boolean;
  /** Restrict to these model ids (e.g. from the dashboard's model picker). */
  only?: string[];
}

export interface ChatResult {
  text: string;
  json?: unknown;
  modelId: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
}

export interface ProviderCallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export type ProviderCaller = (args: {
  provider: ProviderConfig;
  providerId: string;
  model: ModelConfig;
  apiKey: string | null;
  baseUrl: string | null;
  system: string;
  prompt: string;
  maxTokens: number;
}) => Promise<ProviderCallResult>;

export class OfflineFallback extends Error {
  constructor(readonly modelId: string, readonly failures: string[]) {
    super(`Aucun modèle en ligne disponible : bascule sur ${modelId}`);
  }
}

export class NoModelAvailable extends Error {
  constructor(readonly failures: string[]) {
    super(`Aucun modèle disponible : ${failures.join(' | ') || 'aucun candidat'}`);
  }
}

export interface ModelStatus {
  id: string;
  provider: string;
  model: string;
  enabled: boolean;
  configured: boolean;
  free: boolean;
  reason: string | null;
  callsToday: number;
  costToday: number;
  roles: string[];
  inputPerMTok: number;
  outputPerMTok: number;
}

const dayStart = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').toISOString();

/**
 * Picks a model for each task (role), enforces budgets, quotas and a circuit breaker,
 * falls back to the next model on failure and logs every call (tokens, cost, latency, error).
 */
export class AiRouter {
  private callers: Record<string, ProviderCaller>;

  constructor(
    private db: Db,
    private cfg: AppConfig,
    private env: NodeJS.ProcessEnv = process.env,
    callers?: Partial<Record<'openai' | 'anthropic', ProviderCaller>>,
  ) {
    this.callers = {openai: callOpenAiCompatible, anthropic: callAnthropic, ...callers};
  }

  private overrides(): Record<string, {enabled?: boolean}> {
    return this.db.setting<Record<string, {enabled?: boolean}>>('ai.modelOverrides', {});
  }

  setEnabled(modelId: string, enabled: boolean): void {
    const o = this.overrides();
    o[modelId] = {...o[modelId], enabled};
    this.db.setSetting('ai.modelOverrides', o);
  }

  apiKey(providerId: string): string | null {
    const p = this.cfg.ai.providers[providerId];
    if (!p) return null;
    for (const name of p.keyEnv) {
      const v = this.env[name];
      if (v && v.trim()) return v.trim();
    }
    return null;
  }

  baseUrl(providerId: string): string | null {
    const p = this.cfg.ai.providers[providerId];
    if (!p) return null;
    if (p.baseUrlEnv) return this.env[p.baseUrlEnv]?.trim() || null;
    return p.baseUrl ?? null;
  }

  status(): ModelStatus[] {
    const o = this.overrides();
    return this.cfg.ai.models.map((m) => {
      const p = this.cfg.ai.providers[m.provider];
      const enabled = o[m.id]?.enabled ?? m.enabled;
      const reason = this.unavailableReason(m);
      const usage = this.db.get<{n: number; c: number}>(
        "SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS c FROM ai_calls WHERE provider = ? AND model = ? AND at >= ? AND status = 'ok'",
        m.provider,
        m.model,
        dayStart(),
      )!;
      return {
        id: m.id,
        provider: m.provider,
        model: m.model,
        enabled,
        configured: p?.kind === 'offline' || (!!this.baseUrl(m.provider) || p?.kind === 'anthropic') && (p.keyEnv.length === 0 || !!this.apiKey(m.provider)),
        free: !!p?.free,
        reason,
        callsToday: usage.n,
        costToday: usage.c,
        roles: m.roles,
        inputPerMTok: m.inputPerMTok,
        outputPerMTok: m.outputPerMTok,
      };
    });
  }

  /** Why a model cannot be used right now (null = usable). */
  unavailableReason(m: ModelConfig): string | null {
    const p = this.cfg.ai.providers[m.provider];
    if (!p) return 'fournisseur inconnu';
    const enabled = this.overrides()[m.id]?.enabled ?? m.enabled;
    if (!enabled) return 'désactivé';
    if (p.kind === 'offline') return null;
    if (p.keyEnv.length > 0 && !this.apiKey(m.provider)) return `clé absente (${p.keyEnv.join(' ou ')})`;
    if (p.kind === 'openai' && !this.baseUrl(m.provider)) return `adresse absente (${p.baseUrlEnv ?? 'baseUrl'})`;
    const since = dayStart();
    const used = this.db.get<{n: number; c: number}>(
      'SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd), 0) AS c FROM ai_calls WHERE provider = ? AND at >= ?',
      m.provider,
      since,
    )!;
    if (p.dailyCallLimit !== undefined && used.n >= p.dailyCallLimit) return `quota du jour atteint (${p.dailyCallLimit} appels)`;
    if (!p.free) {
      const budget = Math.min(p.dailyBudgetUsd ?? Infinity, this.cfg.ai.dailyBudgetUsd);
      if (used.c >= budget) return `budget du jour atteint (${budget.toFixed(2)} $)`;
      const total = this.db.get<{c: number}>("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_calls WHERE at >= ?", since)!;
      if (total.c >= this.cfg.ai.dailyBudgetUsd) return `budget global du jour atteint (${this.cfg.ai.dailyBudgetUsd.toFixed(2)} $)`;
    }
    const recent = this.db.all<{status: string}>(
      'SELECT status FROM ai_calls WHERE provider = ? AND model = ? AND at >= ? ORDER BY id DESC LIMIT 3',
      m.provider,
      m.model,
      new Date(Date.now() - 10 * 60_000).toISOString(),
    );
    if (recent.length === 3 && recent.every((r) => r.status !== 'ok')) return 'disjoncteur : 3 échecs en 10 minutes';
    return null;
  }

  candidates(role: Role, only?: string[]): ModelConfig[] {
    const order = this.cfg.ai.roles[role]?.order ?? [];
    const byId = new Map(this.cfg.ai.models.map((m) => [m.id, m]));
    const list = order.map((i) => byId.get(i)).filter((m): m is ModelConfig => !!m && m.roles.includes(role));
    return only?.length ? list.filter((m) => only.includes(m.id)) : list;
  }

  /** First usable model for the role, without calling it (used to tell the user what will run). */
  plan(role: Role): {modelId: string | null; skipped: string[]} {
    const skipped: string[] = [];
    for (const m of this.candidates(role)) {
      const r = this.unavailableReason(m);
      if (!r) return {modelId: m.id, skipped};
      skipped.push(`${m.id} : ${r}`);
    }
    return {modelId: null, skipped};
  }

  async complete(req: ChatRequest): Promise<ChatResult> {
    const failures: string[] = [];
    for (const m of this.candidates(req.role, req.only)) {
      const reason = this.unavailableReason(m);
      if (reason) {
        failures.push(`${m.id} : ${reason}`);
        continue;
      }
      const p = this.cfg.ai.providers[m.provider]!;
      if (p.kind === 'offline') throw new OfflineFallback(m.id, failures);
      const caller = this.callers[p.kind];
      let prompt = req.prompt;
      if (p.maxPromptChars && req.system.length + prompt.length > p.maxPromptChars) {
        failures.push(`${m.id} : consigne trop longue pour ce fournisseur (${req.system.length + prompt.length} > ${p.maxPromptChars} caractères)`);
        continue;
      }
      const t0 = Date.now();
      try {
        const r = await caller({
          provider: p,
          providerId: m.provider,
          model: m,
          apiKey: this.apiKey(m.provider),
          baseUrl: this.baseUrl(m.provider),
          system: req.system,
          prompt,
          maxTokens: req.maxTokens ?? 4000,
        });
        const latencyMs = Date.now() - t0;
        const costUsd = (r.tokensIn * m.inputPerMTok + r.tokensOut * m.outputPerMTok) / 1_000_000;
        let json: unknown;
        if (req.json) {
          json = extractJson(r.text);
          if (json === undefined) throw new Error('réponse sans JSON exploitable');
        }
        this.log(req, m, {tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd, latencyMs, status: 'ok'});
        return {text: r.text, json, modelId: m.id, provider: m.provider, model: m.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd, latencyMs};
      } catch (e) {
        const msg = (e as Error).message?.slice(0, 400) ?? String(e);
        this.log(req, m, {tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: Date.now() - t0, status: 'error', error: msg});
        failures.push(`${m.id} : ${msg}`);
      }
    }
    throw new NoModelAvailable(failures);
  }

  private log(req: ChatRequest, m: ModelConfig, r: {tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number; status: string; error?: string}) {
    this.db.run(
      'INSERT INTO ai_calls(at, role, provider, model, purpose, tokens_in, tokens_out, cost_usd, latency_ms, status, error) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      new Date().toISOString(),
      req.role,
      m.provider,
      m.model,
      req.purpose,
      r.tokensIn,
      r.tokensOut,
      r.costUsd,
      r.latencyMs,
      r.status,
      r.error ?? null,
    );
  }

  costSummary(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    return {
      byModel: this.db.all(
        "SELECT provider, model, COUNT(*) AS calls, SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) AS ok, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out, ROUND(SUM(cost_usd), 4) AS cost_usd FROM ai_calls WHERE at >= ? GROUP BY provider, model ORDER BY cost_usd DESC",
        since,
      ),
      byRole: this.db.all('SELECT role, COUNT(*) AS calls, ROUND(SUM(cost_usd), 4) AS cost_usd FROM ai_calls WHERE at >= ? GROUP BY role', since),
      byDay: this.db.all('SELECT substr(at, 1, 10) AS day, COUNT(*) AS calls, ROUND(SUM(cost_usd), 4) AS cost_usd FROM ai_calls WHERE at >= ? GROUP BY day ORDER BY day', since),
      last: this.db.all('SELECT at, role, provider, model, purpose, tokens_in, tokens_out, cost_usd, latency_ms, status, error FROM ai_calls ORDER BY id DESC LIMIT 50'),
    };
  }
}

/** Pull the first JSON object/array out of a model answer (code fences and prose tolerated). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const trimmed = c.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      /* keep looking */
    }
    for (const [open, close] of [
      ['{', '}'],
      ['[', ']'],
    ] as const) {
      const start = trimmed.indexOf(open);
      const end = trimmed.lastIndexOf(close);
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          /* next */
        }
      }
    }
  }
  return undefined;
}
