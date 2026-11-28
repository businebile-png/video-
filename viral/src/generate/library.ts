import fs from 'node:fs';
import path from 'node:path';
import {PATHS} from '../core/paths.js';
import {normalize} from '../core/text.js';
import type {GenStructure} from './types.js';

export interface LibItem {
  title: string;
  body?: string;
  fix?: string;
  factIds?: string[];
}

export interface LibTopic {
  id: string;
  label: string;
  hashtagTopic: string;
  vars: {sujet: string; theme: string; objet: string; action: string; probleme: string; public: string};
  definition?: {title: string; body: string};
  steps?: LibItem[];
  tips?: LibItem[];
  mistakes?: LibItem[];
  myths?: Array<{myth: string; reality: string; factIds?: string[]}>;
  beforeAfter?: Array<{before: string; after: string; factIds?: string[]}>;
  story?: {title: string; setup: string; problem: string; turn: string; lesson: string};
  factItems?: LibItem[];
  facts: string[];
  productLine: {text: string; factIds: string[]} | null;
}

export interface HookTemplate {
  type: string;
  t: string;
  factIds?: string[];
}

export interface Library {
  topics: LibTopic[];
  hooks: Record<GenStructure, HookTemplate[]>;
  topicHooks: Record<string, HookTemplate[]>;
  subtitles: Record<GenStructure, string[]>;
  ctas: {
    engagement: Array<{kind: string; title: string; body: string}>;
    product: Array<{title: string; body: string; factIds: string[]}>;
  };
}

let cached: Library | null = null;

export function loadLibrary(dir = PATHS.library): Library {
  if (cached && dir === PATHS.library) return cached;
  const topics = JSON.parse(fs.readFileSync(path.join(dir, 'topics.json'), 'utf8')).topics as LibTopic[];
  const hooks = JSON.parse(fs.readFileSync(path.join(dir, 'hooks.json'), 'utf8'));
  const ctas = JSON.parse(fs.readFileSync(path.join(dir, 'ctas.json'), 'utf8'));
  const lib: Library = {topics, hooks: hooks.templates, topicHooks: hooks.topicHooks ?? {}, subtitles: hooks.subtitles, ctas};
  if (dir === PATHS.library) cached = lib;
  return lib;
}

/** Number of content items a topic can provide for a structure (0 = structure not available). */
export function capacity(t: LibTopic, s: GenStructure): number {
  switch (s) {
    case 'liste':
      return t.tips?.length ?? 0;
    case 'erreurs':
      return t.mistakes?.length ?? 0;
    case 'etapes':
      return t.steps?.length ?? 0;
    case 'mythe-realite':
      return t.myths?.length ?? 0;
    case 'avant-apres':
      return t.beforeAfter?.length ?? 0;
    case 'histoire':
      return t.story ? 4 : 0;
    case 'definition':
      return t.definition ? 1 + Math.min(5, t.tips?.length ?? t.steps?.length ?? 0) : 0;
    case 'faits':
      return t.factItems?.length ?? 0;
  }
}

/** Closest library topic for free text (topic id, label or keywords). */
export function matchTopic(lib: Library, text: string): LibTopic | null {
  const n = normalize(text);
  const exact = lib.topics.find((t) => t.id === text || normalize(t.label) === n);
  if (exact) return exact;
  let best: {t: LibTopic; s: number} | null = null;
  for (const t of lib.topics) {
    const hay = normalize([t.label, t.vars.theme, t.vars.sujet, t.vars.action].join(' '));
    const s = n.split(' ').filter((w) => w.length > 2 && hay.includes(w)).length;
    if (s > 0 && (!best || s > best.s)) best = {t, s};
  }
  return best?.t ?? null;
}

export function fillTemplate(t: string, vars: Record<string, string | number>): string {
  const out = t.replace(/\{(\w+)\}/g, (_, k: string) => {
    const lower = k.charAt(0).toLowerCase() + k.slice(1);
    const v = vars[k] ?? vars[lower];
    if (v === undefined) return `{${k}}`;
    const s = String(v);
    return k !== lower ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  });
  return out.charAt(0).toUpperCase() + out.slice(1);
}
