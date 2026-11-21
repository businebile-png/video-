import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {PATHS} from '../core/paths.js';
import {formatLocal} from '../core/time.js';
import type {Editorial} from '../schemas/config.js';
import type {Capture} from '../schemas/assets.js';
import type {HistoryRecord} from '../schemas/records.js';
import type {ProgrammeSlot} from './programme.js';

/**
 * The 60-video series the user asked for on 21/11/2026 (two videos a day, 10:00 and 20:00, from 23/11 to 22/12):
 * one written script per slot (doc « 60 vidéos Systeme.io — noms, scripts et calendrier »). Each production follows
 * the script of its slot; a demo needs the user's own screen recording, otherwise its relief video takes the slot.
 */
export const SERIE_FILE = path.join(PATHS.data, 'serie.json');

const LineSchema = z.object({voice: z.string().min(2), visual: z.string().nullable()});

export const SerieEntrySchema = z.object({
  n: z.number().int().min(1),
  iso: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:00[+-]\d\d:\d\d$/),
  title: z.string().min(4),
  format: z.string().min(2),
  category: z.string().min(2),
  targetSec: z.number().min(10).max(90),
  visuals: z.string(),
  hook: z.object({screen: z.string().min(2), voice: z.string().min(4)}),
  lines: z.array(LineSchema).min(1),
  question: z.string().nullable(),
  facts: z.array(z.string()),
  notes: z.array(z.string()),
  /** A demo shows the user's own screen: the capture feature it needs and the video that takes its slot without it. */
  demo: z.object({feature: z.string(), fallback: z.number().int().min(1)}).nullable(),
});
export type SerieEntry = z.infer<typeof SerieEntrySchema>;

export const SerieSchema = z.object({
  title: z.string(),
  source: z.string(),
  about: z.string(),
  timezone: z.string(),
  generatedAt: z.string(),
  entries: z.array(SerieEntrySchema).min(1),
});
export type Serie = z.infer<typeof SerieSchema>;

export function loadSerie(file = SERIE_FILE): Serie | null {
  if (!fs.existsSync(file)) return null;
  return SerieSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** Everything that would make the series unusable: a duplicate slot, an unknown fact or category, a broken relief. */
export function serieProblems(serie: Serie, editorial: Editorial, factIds: Set<string>): string[] {
  const out: string[] = [];
  const byN = new Map(serie.entries.map((e) => [e.n, e]));
  const instants = new Set<number>();
  for (const e of serie.entries) {
    const t = Date.parse(e.iso);
    if (instants.has(t)) out.push(`vidéo ${e.n} : créneau ${e.iso} déjà pris`);
    instants.add(t);
    const cat = editorial.categories.find((c) => c.id === e.category);
    if (!cat) out.push(`vidéo ${e.n} : catégorie inconnue ${e.category}`);
    else if (e.targetSec < cat.durationSec[0] * 0.9 || e.targetSec > cat.durationSec[1] * 1.1) out.push(`vidéo ${e.n} : ${e.targetSec} s hors de la catégorie ${cat.id} (${cat.durationSec.join('–')} s)`);
    for (const f of e.facts) if (!factIds.has(f)) out.push(`vidéo ${e.n} : fait inconnu ${f}`);
    if (e.demo) {
      const relief = byN.get(e.demo.fallback);
      if (!relief) out.push(`vidéo ${e.n} : vidéo de relève ${e.demo.fallback} absente`);
      else if (relief.demo) out.push(`vidéo ${e.n} : la relève ${relief.n} est elle-même une démo`);
      if (!cat?.requiresDemo) out.push(`vidéo ${e.n} : une démo doit aller dans une catégorie avec démonstration`);
    }
  }
  return out;
}

/** The series entry planned at this instant (whatever the offset notation), or null. */
export function serieEntryAt(serie: Serie | null, iso: string): SerieEntry | null {
  const t = Date.parse(iso);
  return serie?.entries.find((e) => Math.abs(Date.parse(e.iso) - t) < 60_000) ?? null;
}

/** Series numbers already made into a video (rendered, scheduled or published), from the studio's history. */
export function producedNumbers(history: Pick<HistoryRecord, 'serie' | 'status'>[]): Set<number> {
  return new Set(history.filter((h) => typeof h.serie === 'number' && ['rendered', 'scheduled', 'published'].includes(h.status)).map((h) => h.serie as number));
}

/** Features for which the user sent a usable screen recording (checked for personal data). */
export function recordedFeatures(captures: Pick<Capture, 'source' | 'feature' | 'personalDataChecked'>[]): Set<string> {
  return new Set(captures.filter((c) => c.source === 'user-recording' && c.personalDataChecked).map((c) => c.feature));
}

export interface SerieChoice {
  /** The script to follow, or null: the slot takes the regular programme (`programme:slot`). */
  entry: SerieEntry | null;
  /** The series video planned at this slot (null outside the series). */
  planned: SerieEntry | null;
  reason: string;
}

/**
 * Which script a slot gets. A demo without the user's recording gives its slot to its relief video; when the
 * relief's own slot comes, the demo takes it if the recording has arrived, otherwise the regular programme does.
 */
export function serieChoice(serie: Serie | null, iso: string, produced: Set<number>, recorded: Set<string>): SerieChoice {
  const planned = serieEntryAt(serie, iso);
  if (!serie || !planned) return {entry: null, planned: null, reason: 'créneau hors de la série : programme du mois'};
  const byN = new Map(serie.entries.map((e) => [e.n, e]));
  if (planned.demo) {
    if (produced.has(planned.n)) return {entry: null, planned, reason: `démo ${planned.n} déjà produite : programme du mois`};
    if (recorded.has(planned.demo.feature)) return {entry: planned, planned, reason: `vidéo ${planned.n}/60, démo avec ton enregistrement (${planned.demo.feature})`};
    const relief = byN.get(planned.demo.fallback);
    if (relief && !produced.has(relief.n)) return {entry: relief, planned, reason: `démo ${planned.n} sans enregistrement (${planned.demo.feature}) : la vidéo ${relief.n} prend ce créneau, la démo prendra celui de la vidéo ${relief.n} si l'enregistrement arrive`};
    return {entry: null, planned, reason: `démo ${planned.n} sans enregistrement et vidéo de relève déjà produite : programme du mois`};
  }
  if (!produced.has(planned.n)) return {entry: planned, planned, reason: `vidéo ${planned.n}/60 de la série`};
  const demo = serie.entries.find((e) => e.demo?.fallback === planned.n && !produced.has(e.n));
  if (demo && recorded.has(demo.demo!.feature)) return {entry: demo, planned, reason: `vidéo ${planned.n} déjà sortie à la place de la démo ${demo.n} : la démo prend ce créneau`};
  return {entry: null, planned, reason: `vidéo ${planned.n} déjà sortie${demo ? ` et démo ${demo.n} toujours sans enregistrement` : ''} : programme du mois`};
}

/** The series replaces the regular programme on its slots (the panel's month table then shows each video's title). */
export function withSerie(slots: ProgrammeSlot[], serie: Serie | null, editorial: Editorial, timezone: string): ProgrammeSlot[] {
  if (!serie || slots.length === 0) return slots;
  const from = Date.parse(slots[0]!.iso);
  const to = Date.parse(slots[slots.length - 1]!.iso) + 86_400_000;
  const fmt = new Intl.DateTimeFormat('fr-FR', {timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'});
  const ours = serie.entries
    .filter((e) => Date.parse(e.iso) >= from && Date.parse(e.iso) < to)
    .map((e): ProgrammeSlot => {
      const cat = editorial.categories.find((c) => c.id === e.category);
      const at = new Date(e.iso);
      const l = formatLocal(at, timezone);
      return {
        iso: e.iso,
        date: l.slice(0, 10),
        time: l.slice(11, 16),
        label: fmt.format(at),
        family: 'serie',
        familyLabel: `Série · ${e.format}`,
        category: e.category,
        categoryLabel: cat?.label ?? e.category,
        durationSec: cat?.durationSec ?? [e.targetSec, e.targetSec],
        theme: `serie-${e.n}`,
        themeLabel: `Vidéo ${e.n}/60 : ${e.title}`,
        angle: `${e.title} — script écrit à suivre : npm run studio -- serie:slot --slot ${e.iso}`,
        formule: 'celle que cite le script, sans en ajouter',
        facts: e.facts,
      };
    });
  const taken = new Set(ours.map((s) => Date.parse(s.iso)));
  const firstSerie = Math.min(...serie.entries.map((e) => Date.parse(e.iso)));
  const lastSerie = Math.max(...serie.entries.map((e) => Date.parse(e.iso)));
  // Inside the series period, its slots are the only ones: no regular programme slot alongside.
  const rest = slots.filter((s) => {
    const t = Date.parse(s.iso);
    return !taken.has(t) && (t < firstSerie || t > lastSerie);
  });
  return [...rest, ...ours].sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso));
}

/** The script as the production brief reads it. */
export function serieBrief(choice: SerieChoice): string {
  const e = choice.entry;
  if (!e) return `Aucun script de la série pour ce créneau (${choice.reason}). Suivre le programme : npm run studio -- programme:slot --slot <iso>.`;
  const lines = [
    `Série de 60 vidéos · vidéo ${e.n}/60${choice.planned && choice.planned.n !== e.n ? ` (créneau prévu pour la vidéo ${choice.planned.n} : ${choice.reason})` : ''}`,
    `Titre : ${e.title}`,
    `Format : ${e.format} · ${e.targetSec} s · visuels : ${e.visuals}`,
    `Catégorie du studio : ${e.category} (npm run studio -- new --category ${e.category} --serie ${e.n})`,
    `Accroche — écran « ${e.hook.screen} » · voix « ${e.hook.voice} »`,
    ...e.lines.map((l, i) => `${i + 1}. « ${l.voice} »${l.visual ? ` → ${l.visual}` : ''}`),
    `Question en commentaire : ${e.question ? `« ${e.question} »` : 'aucune'}`,
    `Faits (claimFactIds) : ${e.facts.join(', ') || 'aucun'}`,
    ...e.notes.map((n) => `Note : ${n}`),
    'Garder le sens, les chiffres et l’ordre du script ; ajuster les mots si la voix les prononce mal ou si le contrôleur le demande. Aucun fait hors de la liste.',
  ];
  return lines.join('\n');
}
