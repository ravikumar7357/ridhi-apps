/* Pacific time — Amazon.com's day. Every day and hour the backend stores is a Pacific one, so Amazon, Shopify and the ads
 * line up hour for hour. Daylight saving is handled by asking Intl for the offset at the actual moment. */

export const PT = 'America/Los_Angeles';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: PT, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function parts(ms: number): Record<string, string> {
  const o: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}

/** "2026-11-20" — the Pacific day of an instant. */
export function ptDay(ms: number): string {
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Pacific minus UTC, in minutes, at an instant (−480 in winter, −420 in summer). */
export function offsetMin(ms: number): number {
  const p = parts(ms);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** The instant a Pacific day starts. */
export function ptMidnight(day: string): number {
  const base = Date.parse(day + 'T00:00:00Z');
  let t = base - offsetMin(base) * 60000;
  t = base - offsetMin(t) * 60000;            // a second pass settles the day daylight saving changes
  return t;
}

/** A YYYY-MM-DD moved by n days. */
export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
}

/** "2026-11-20T00:00:00-08:00" — how Amazon's Sales API likes its interval ends. */
export function isoPT(ms: number): string {
  const p = parts(ms), off = offsetMin(ms), a = Math.abs(off);
  const hh = String(Math.floor(a / 60)).padStart(2, '0'), mm = String(a % 60).padStart(2, '0');
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${off < 0 ? '-' : '+'}${hh}:${mm}`;
}

/** The start of the hour an instant falls in. Pacific offsets are whole hours, so this is the Pacific hour too. */
export function hourStart(ms: number): number {
  return Math.floor(ms / 3600000) * 3600000;
}

/** Every day from a to b, both included. */
export function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b; d = shiftDay(d, 1)) out.push(d);
  return out;
}
