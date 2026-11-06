import {PATHS} from './paths.js';
import {readJsonIfExists, writeJson} from './fsx.js';
import {
  AffiliateDaySchema,
  HistoryRecordSchema,
  PublicationSchema,
  type AffiliateDay,
  type HistoryRecord,
  type Publication,
} from '../schemas/records.js';
import {CapturesManifestSchema, MusicManifestSchema, type Capture, type Track} from '../schemas/assets.js';
import {readValidated} from './fsx.js';
import {exists} from './fsx.js';

/** Small JSON "tables" committed to the repo: the memory of the studio across daily runs. */

export async function loadHistory(): Promise<HistoryRecord[]> {
  const raw = await readJsonIfExists<{records: unknown[]}>(PATHS.history, {records: []});
  return raw.records.map((r) => HistoryRecordSchema.parse(r));
}

export async function upsertHistory(patch: Partial<HistoryRecord> & {runId: string}): Promise<HistoryRecord> {
  const records = await loadHistory();
  const i = records.findIndex((r) => r.runId === patch.runId);
  const base: HistoryRecord =
    i >= 0
      ? records[i]!
      : {
          runId: patch.runId,
          date: patch.date ?? new Date().toISOString().slice(0, 10),
          category: patch.category ?? 'inconnue',
          hookStyle: null,
          hook: null,
          angle: null,
          workingTitle: null,
          artDirection: null,
          musicTrack: null,
          voiceId: null,
          durationSec: null,
          score: null,
          decision: null,
          status: 'created',
          reason: null,
          pexelsIds: [],
          updatedAt: new Date().toISOString(),
        };
  const next = HistoryRecordSchema.parse({...base, ...patch, updatedAt: new Date().toISOString()});
  if (i >= 0) records[i] = next;
  else records.push(next);
  records.sort((a, b) => a.runId.localeCompare(b.runId));
  await writeJson(PATHS.history, {records});
  return next;
}

export async function loadPublications(): Promise<Publication[]> {
  const raw = await readJsonIfExists<{records: unknown[]}>(PATHS.publications, {records: []});
  return raw.records.map((r) => PublicationSchema.parse(r));
}

export async function upsertPublication(pub: Publication): Promise<void> {
  const records = await loadPublications();
  const i = records.findIndex((r) => r.runId === pub.runId && r.network === pub.network);
  const next = PublicationSchema.parse(pub);
  if (i >= 0) records[i] = next;
  else records.push(next);
  await writeJson(PATHS.publications, {records});
}

export async function loadAffiliate(): Promise<AffiliateDay[]> {
  const raw = await readJsonIfExists<{days: unknown[]}>(PATHS.affiliate, {days: []});
  return raw.days.map((d) => AffiliateDaySchema.parse(d));
}

export async function upsertAffiliate(day: AffiliateDay): Promise<void> {
  const days = await loadAffiliate();
  const i = days.findIndex((d) => d.date === day.date);
  if (i >= 0) days[i] = AffiliateDaySchema.parse(day);
  else days.push(AffiliateDaySchema.parse(day));
  days.sort((a, b) => a.date.localeCompare(b.date));
  await writeJson(PATHS.affiliate, {days});
}

/** Pexels ids already used, with the date of last use (anti-repetition of footage). */
export async function loadFootageUsage(): Promise<Record<string, string>> {
  return readJsonIfExists<Record<string, string>>(PATHS.footageUsage, {});
}

export async function recordFootageUsage(ids: number[], date: string): Promise<void> {
  const usage = await loadFootageUsage();
  for (const id of ids) usage[String(id)] = date;
  await writeJson(PATHS.footageUsage, usage);
}

export async function loadCaptures(): Promise<Capture[]> {
  if (!exists(PATHS.capturesManifest)) return [];
  return (await readValidated(PATHS.capturesManifest, CapturesManifestSchema)).captures;
}

export async function loadTracks(): Promise<Track[]> {
  if (!exists(PATHS.musicManifest)) return [];
  return (await readValidated(PATHS.musicManifest, MusicManifestSchema)).tracks;
}
