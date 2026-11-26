/* ?weekly=keys — the week keys the PPC & Organic dashboard covers. Apps Script (Code.gs doGet):
 *
 *   if (p.weekly === 'keys') return json_({ ok: true, weeks: weeklyKeys_(p.weeks) });
 *
 * Ported from Pricing-API/WeeklyPpc.gs weeklyKeys_ + weekKeyOf_. No Amazon call, no Supabase read: it is pure date
 * arithmetic, which is why it moves first.
 *
 * The two traps WeeklyPpc.gs was bitten by, both kept here:
 *   1. A week is named by its SUNDAY. Going back `getUTCDay()` days lands on Sunday for every day of the week
 *      INCLUDING Sunday itself (0 days back) — an "or 7" there would file every Sunday under the week before.
 *   2. Which week we are in is a question about the MARKETPLACE's day, not UTC. So "now" becomes the Pacific trading
 *      date first and is then handed over exactly like a stored date. The raw instant would roll the window into the
 *      next week on Saturday evening PT, when UTC has already ticked. */

import type { Route } from '../lib/router.ts';
import { DAY, ptToday, startOfDay, ymd } from '../lib/dates.ts';

/** WeeklyPpc.gs WEEKLY_WEEKS */
export const WEEKLY_WEEKS = 26;

/** weekKeyOf_: the Sunday that owns this instant, as yyyy-MM-dd. */
export function weekKeyOf(ms: number): string {
  const back = new Date(ms).getUTCDay();                 // 0 = Sunday … 6 = Saturday
  return ymd(ms - back * DAY);
}

/** weeklyKeys_: the week keys the dashboard covers, oldest first, ending with the week in progress. */
export function weeklyKeys(weeks: unknown, nowMs: number): string[] {
  const n = Math.min(Math.max(Number(weeks) || WEEKLY_WEEKS, 1), 104);
  const thisWeek = weekKeyOf(startOfDay(ptToday(nowMs)));
  const base = startOfDay(thisWeek);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(ymd(base - i * 7 * DAY));
  return out;
}

export const weeklyKeysRoute: Route = {
  name: 'weekly:keys',
  method: 'GET',
  param: 'weekly',
  value: 'keys',
  auth: 'key',
  async run(p, ctx) {
    return { ok: true, weeks: weeklyKeys(p.weeks, ctx.now()) };
  },
};
