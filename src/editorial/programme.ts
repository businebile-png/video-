import path from 'node:path';
import {z} from 'zod';
import {PATHS} from '../core/paths.js';
import {addDays, daysBetween, formatLocal, formatWithOffset, zonedInstant} from '../core/time.js';
import type {Editorial} from '../schemas/config.js';

/**
 * Programme du mois (demandes de l'utilisateur du 21/11/2026) : chaque heure de publication a sa famille de format
 * (10:00 tutoriel de A à Z, 20:00 quelle formule prendre, 00:00 format court un jour sur deux et erreur ou conseil
 * l'autre jour, `parity`) et chaque créneau reçoit un besoin (tunnel, liste e-mail, formation…). Le besoin d'une famille avance d'un cran par jour et
 * les familles sont décalées entre elles : les quatre vidéos d'une journée traitent quatre besoins différents, et
 * un besoin revient tous les 3 jours dans un autre format. Le calcul part de `epoch` : régénérer le programme plus
 * tard redonne les mêmes sujets aux mêmes dates.
 */

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const AngleSchema = z.object({category: z.string().min(2), angle: z.string().min(10)});

export const ProgrammeConfigSchema = z.object({
  about: z.string().optional(),
  epoch: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  families: z
    .array(
      z.object({
        time: hhmm,
        id: z.string().min(2),
        label: z.string().min(2),
        targetSec: z.tuple([z.number().min(5), z.number().max(120)]),
        offset: z.number().int().min(0),
        /** 0: even days only, 1: odd days only (days counted from `epoch`); absent: every day. */
        parity: z.union([z.literal(0), z.literal(1)]).optional(),
      }),
    )
    .min(1),
  themes: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        label: z.string().min(2),
        formule: z.string().min(10),
        facts: z.array(z.string()).min(1),
        angles: z.record(z.string(), z.array(AngleSchema).min(1)),
      }),
    )
    .min(2),
});
export type ProgrammeConfig = z.infer<typeof ProgrammeConfigSchema>;

export interface ProgrammeSlot {
  iso: string;
  date: string;
  time: string;
  label: string;
  family: string;
  familyLabel: string;
  category: string;
  categoryLabel: string;
  durationSec: [number, number];
  theme: string;
  themeLabel: string;
  angle: string;
  formule: string;
  facts: string[];
}

export interface Programme {
  generatedAt: string;
  from: string;
  to: string;
  timezone: string;
  slots: ProgrammeSlot[];
}

export const PROGRAMME_CONFIG = path.join(PATHS.root, 'config', 'programme.json');
export const PROGRAMME_FILE = path.join(PATHS.data, 'programme.json');

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** Everything that would make a planned slot unusable: unknown category, unknown fact, a family without angles. */
export function programmeProblems(cfg: ProgrammeConfig, editorial: Editorial, factIds: Set<string>): string[] {
  const problems: string[] = [];
  const categories = new Set(editorial.categories.map((c) => c.id));
  for (const parity of [0, 1]) {
    const offsets = new Set<number>();
    const times = new Set<string>();
    for (const f of cfg.families.filter((x) => x.parity === undefined || x.parity === parity)) {
      if (offsets.has(mod(f.offset, cfg.themes.length))) problems.push(`familles ${f.id} : même décalage qu'une autre famille du même jour (deux vidéos auraient le même besoin)`);
      if (times.has(f.time)) problems.push(`familles ${f.id} : deux familles à ${f.time} le même jour`);
      offsets.add(mod(f.offset, cfg.themes.length));
      times.add(f.time);
    }
  }
  for (const t of cfg.themes) {
    for (const id of t.facts) if (!factIds.has(id)) problems.push(`${t.id} : fait inconnu « ${id} »`);
    for (const f of cfg.families) {
      const list = t.angles[f.id];
      if (!list?.length) problems.push(`${t.id} : aucune piste pour la famille ${f.id}`);
      for (const a of list ?? []) if (!categories.has(a.category)) problems.push(`${t.id}/${f.id} : catégorie inconnue « ${a.category} »`);
    }
  }
  return problems;
}

function makeEntry(
  cfg: ProgrammeConfig,
  editorial: Editorial,
  tz: string,
  date: string,
  fam: ProgrammeConfig['families'][number],
  themeId?: string,
): ProgrammeSlot | null {
  const count = cfg.themes.length;
  const n = daysBetween(cfg.epoch, date) + fam.offset;
  const theme = themeId ? cfg.themes.find((t) => t.id === themeId) : cfg.themes[mod(n, count)];
  if (!theme) throw new Error(`Programme : besoin inconnu « ${themeId} » (besoins : ${cfg.themes.map((t) => t.id).join(', ')}).`);
  const variants = theme.angles[fam.id] ?? [];
  if (!variants.length) return null;
  const pick = variants[mod(Math.floor(n / count), variants.length)]!;
  const category = editorial.categories.find((c) => c.id === pick.category);
  if (!category) throw new Error(`Programme : catégorie inconnue « ${pick.category} » (${theme.id}/${fam.id}).`);
  const lo = Math.max(fam.targetSec[0], category.durationSec[0]);
  const hi = Math.min(fam.targetSec[1], category.durationSec[1]);
  const instant = zonedInstant(date, fam.time, tz);
  const dayFmt = new Intl.DateTimeFormat('fr-FR', {timeZone: tz, weekday: 'long', day: 'numeric', month: 'long'});
  return {
    iso: formatWithOffset(instant, tz),
    date,
    time: fam.time,
    label: `${dayFmt.format(instant)} à ${fam.time}`,
    family: fam.id,
    familyLabel: fam.label,
    category: category.id,
    categoryLabel: category.label,
    durationSec: lo <= hi ? [lo, hi] : [category.durationSec[0], category.durationSec[1]],
    theme: theme.id,
    themeLabel: theme.label,
    angle: pick.angle,
    formule: theme.formule,
    facts: theme.facts,
  };
}

function familiesOn(cfg: ProgrammeConfig, date: string, times?: string[]) {
  const parity = mod(daysBetween(cfg.epoch, date), 2);
  return cfg.families
    .filter((f) => (!times || times.includes(f.time)) && (f.parity === undefined || f.parity === parity))
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function buildProgramme(cfg: ProgrammeConfig, editorial: Editorial, opts: {from: string; days: number; timezone: string; times?: string[]}): ProgrammeSlot[] {
  const out: ProgrammeSlot[] = [];
  for (let i = 0; i < opts.days; i++) {
    const date = addDays(opts.from, i);
    for (const fam of familiesOn(cfg, date, opts.times)) {
      const entry = makeEntry(cfg, editorial, opts.timezone, date, fam);
      if (entry) out.push(entry);
    }
  }
  return out;
}

/**
 * The entry of one slot, optionally with the need (« besoin ») the user chose for it in the panel's monthly table:
 * same hour, same format family, the chosen need's angle for that family, its recommended plan and its facts.
 */
export function programmeSlot(cfg: ProgrammeConfig, editorial: Editorial, opts: {iso: string; timezone: string; theme?: string; times?: string[]}): ProgrammeSlot | null {
  const local = formatLocal(new Date(opts.iso), opts.timezone);
  const date = local.slice(0, 10);
  const time = local.slice(11, 16);
  const fam = familiesOn(cfg, date, opts.times).find((f) => f.time === time);
  return fam ? makeEntry(cfg, editorial, opts.timezone, date, fam, opts.theme) : null;
}

/** The planned entry for a slot (same instant, whatever the offset notation), or null. */
export function programmeEntry(programme: Pick<Programme, 'slots'> | null, iso: string): ProgrammeSlot | null {
  const t = Date.parse(iso);
  return programme?.slots.find((s) => Math.abs(Date.parse(s.iso) - t) < 60_000) ?? null;
}
