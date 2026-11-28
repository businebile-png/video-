import crypto from 'node:crypto';

export function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sha256(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Seeded PRNG (mulberry32): reproducible generation batches. */
export function rng(seed: number | string): () => number {
  let s = typeof seed === 'number' ? seed >>> 0 : parseInt(sha256(seed).slice(0, 8), 16);
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

export function shuffle<T>(rand: () => number, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function weightedPick<T>(rand: () => number, items: readonly T[], weight: (t: T) => number): T {
  const ws = items.map((t) => Math.max(0, weight(t)));
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return pick(rand, items);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Wall-clock parts of an instant in a time zone (default Europe/Paris). */
export function zonedParts(date: Date, timeZone = 'Europe/Paris') {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: +p.year,
    month: +p.month,
    day: +p.day,
    hour: +p.hour,
    minute: +p.minute,
    weekday: p.weekday as string,
    dateKey: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Offset in minutes of a time zone at a given instant (e.g. +60 for Paris in winter). */
export function zoneOffsetMinutes(date: Date, timeZone = 'Europe/Paris'): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/** The instant of wall-clock `HH:MM` on `dateKey` (YYYY-MM-DD) in a time zone. */
export function zonedInstant(dateKey: string, hhmm: string, timeZone = 'Europe/Paris'): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off = zoneOffsetMinutes(guess, timeZone);
  const first = new Date(guess.getTime() - off * 60000);
  const off2 = zoneOffsetMinutes(first, timeZone);
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60000);
}

/** ISO string with the zone's offset, e.g. 2026-11-30T12:30:00+01:00. */
export function isoInZone(date: Date, timeZone = 'Europe/Paris'): string {
  const p = zonedParts(date, timeZone);
  const off = zoneOffsetMinutes(date, timeZone);
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.dateKey}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
