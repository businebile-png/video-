/** Date helpers pinned to an IANA zone (default Europe/Paris), independent of the machine TZ. */

export function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

export function isoDateInZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Offset (minutes) of a zone at a given instant, e.g. +60 for Paris in winter. */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Build the instant for a local wall-clock time in a zone (DST-safe for normal hours). */
export function zonedInstant(isoDate: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = new Date(Date.UTC(y!, m! - 1, d!, hh!, mm!, 0));
  const offset = zoneOffsetMinutes(guess, timeZone);
  const first = new Date(guess.getTime() - offset * 60000);
  const offset2 = zoneOffsetMinutes(first, timeZone);
  return offset2 === offset ? first : new Date(guess.getTime() - offset2 * 60000);
}

/** "2026-11-06T19:12:00+01:00" — the format Metricool expects. */
export function formatWithOffset(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const off = zoneOffsetMinutes(date, timeZone);
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Local wall-clock "YYYY-MM-DDTHH:mm:ss" (Metricool publicationDate.dateTime). */
export function formatLocal(date: Date, timeZone: string): string {
  return formatWithOffset(date, timeZone).slice(0, 19);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);
}
