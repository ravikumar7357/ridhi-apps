/* ?listing=periods — the Brand Analytics periods that can actually be asked for, with their real dates.
 * Apps Script (Code.gs doGet):
 *
 *   if (p.listing === 'periods') return json_(baPeriods_(p.period, p.n));
 *
 * Ported from Pricing-API/BrandAnalytics.gs baPeriods_ + baPeriodWindow_. Pure date arithmetic, no Amazon call.
 *
 * Why periods and not a date picker: Amazon builds these reports per PERIOD — a whole Sunday-to-Saturday week, a
 * whole calendar month, a whole calendar quarter. Ask for 3 to 19 August and it refuses rather than trimming to fit.
 *
 * `back` counts COMPLETE periods backwards: 0 is the most recent finished one, 1 the one before. Never the running
 * period — a month in progress is not a month, and its figures set beside finished ones read as a collapse.
 *
 * The window and the dropdown label come from ONE function here, as they do in Apps Script. Two copies of this date
 * arithmetic, one in the browser and one in the backend, already disagreed by a day once and put a seventh of every
 * week in the wrong bucket. */

import type { Route } from '../lib/router.ts';
import { DAY, dayMonth, monthYear, ymd } from '../lib/dates.ts';

export interface Window { start: number; end: number; label: string }

/** baPeriodWindow_: the most recent COMPLETE window for a period, `back` of them ago. */
export function periodWindow(period: unknown, back: unknown, nowMs: number): Window {
  const n = Math.max(0, Number(back) || 0);
  const now = new Date(nowMs);
  const p = String(period || 'WEEK').toUpperCase();

  if (p === 'MONTH') {
    const s0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n - 1, 1);
    const s = new Date(s0);
    // Day 0 of the next month is the last day of this one.
    const e0 = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0);
    return { start: s0, end: e0, label: monthYear(s0) };
  }

  if (p === 'QUARTER') {
    let q = Math.floor(now.getUTCMonth() / 3) - n - 1;
    let y = now.getUTCFullYear();
    while (q < 0) { q += 4; y -= 1; }
    return { start: Date.UTC(y, q * 3, 1), end: Date.UTC(y, q * 3 + 3, 0), label: 'Q' + (q + 1) + ' ' + y };
  }

  // WEEK. The last COMPLETE week ends on the Saturday before today — and on a Saturday that is the Saturday a week
  // ago, not today, because today's week has not finished. That is what the "or 7" does.
  const d = now.getUTCDay();
  const lastSat = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((d + 1) % 7 || 7) - n * 7);
  const ws = lastSat - 6 * DAY;
  return { start: ws, end: lastSat, label: dayMonth(ws) + ' to ' + dayMonth(lastSat, true) };
}

/** baPeriods_ */
export function baPeriods(period: unknown, howMany: unknown, nowMs: number): object {
  const p = String(period || 'MONTH').toUpperCase();
  const n = Math.min(Math.max(Number(howMany) || 12, 1), 24);
  const periods = [];
  for (let i = 0; i < n; i++) {
    const w = periodWindow(p, i, nowMs);
    periods.push({ back: i, label: w.label, from: ymd(w.start), to: ymd(w.end) });
  }
  return { ok: true, period: p, periods };
}

export const listingPeriods: Route = {
  name: 'listing:periods',
  method: 'GET',
  param: 'listing',
  value: 'periods',
  auth: 'key',
  async run(p, ctx) {
    return baPeriods(p.period, p.n, ctx.now());
  },
};
