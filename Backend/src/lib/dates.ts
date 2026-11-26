/* Dates, the way Apps Script does them.
 *
 * Apps Script reaches for Utilities.formatDate(date, zone, pattern) and for the script's own locale. Neither exists
 * here, so the few patterns the routes actually use are written out by hand. They are spelled out rather than taken
 * from Intl month names on purpose: a label that a dropdown shows must not change because a server's locale changed.
 *
 * Every week in this app runs SUNDAY to SATURDAY, and every date handed to Amazon is a UTC date. The one place a
 * different clock matters is "which week are we in", which is a question about the marketplace's day — see ptToday. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const DAY = 86400000;

/** Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd') */
export function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Utilities.formatDate(d, 'UTC', 'MMMM yyyy') → "November 2026" */
export function monthYear(ms: number): string {
  const d = new Date(ms);
  return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

/** Utilities.formatDate(d, 'UTC', 'd MMM') → "15 Nov"; withYear adds " 2026" ('d MMM yyyy'). */
export function dayMonth(ms: number, withYear = false): string {
  const d = new Date(ms);
  const s = d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3);
  return withYear ? s + ' ' + d.getUTCFullYear() : s;
}

/** The marketplace's own date (Pricing-API ORDERS_PT = America/Los_Angeles), as yyyy-MM-dd. */
export function ptToday(nowMs: number): string {
  // en-CA gives yyyy-MM-dd. The zone is what matters: on Saturday evening PT, UTC has already ticked over to
  // Sunday, and taking the raw instant would roll the week window forward a day early.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(nowMs));
}

/** Midnight UTC of a yyyy-MM-dd date. */
export function startOfDay(date: string): number {
  return Date.parse(date + 'T00:00:00Z');
}
