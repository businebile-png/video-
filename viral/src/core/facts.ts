import fs from 'node:fs';
import path from 'node:path';
import {PATHS} from './paths.js';

/**
 * Verified facts about Systeme.io, shared with the video studio (data/facts/systeme-io.json).
 * A fact may be used in a slideshow only if status is "verified" and it is still fresh (verifiedAt + ttlDays).
 */
export interface Fact {
  id: string;
  statement: string;
  tags: string[];
  sourceId: string;
  evidence: string | null;
  status: 'verified' | 'unverified' | 'refuted' | string;
  verifiedAt: string | null;
  ttlDays: number;
  notes?: string;
}

export interface FactSource {
  id: string;
  url: string;
  kind: string;
  note?: string;
}

export interface FactBook {
  updatedAt: string;
  facts: Fact[];
  sources: FactSource[];
}

export function loadFacts(dir = PATHS.facts): FactBook {
  const book = JSON.parse(fs.readFileSync(path.join(dir, 'systeme-io.json'), 'utf8')) as {updatedAt: string; facts: Fact[]};
  const src = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8')) as {sources: FactSource[]};
  return {updatedAt: book.updatedAt, facts: book.facts, sources: src.sources};
}

export function isFresh(fact: Fact, now = new Date()): boolean {
  if (fact.status !== 'verified' || !fact.verifiedAt) return false;
  const age = (now.getTime() - new Date(fact.verifiedAt).getTime()) / 86_400_000;
  return age <= fact.ttlDays;
}

export function usableFacts(book: FactBook, now = new Date()): Fact[] {
  return book.facts.filter((f) => isFresh(f, now));
}

export function factById(book: FactBook, id: string): Fact | undefined {
  return book.facts.find((f) => f.id === id);
}

/** Date in French (« 27/11/2026 ») of the most recent verification among the given facts. */
export function verifiedOnLabel(book: FactBook, ids: string[]): string | null {
  const dates = ids
    .map((i) => factById(book, i)?.verifiedAt)
    .filter((d): d is string => !!d)
    .sort();
  const last = dates.at(-1);
  if (!last) return null;
  const d = new Date(last);
  return d.toLocaleDateString('fr-FR', {timeZone: 'Europe/Paris'});
}
