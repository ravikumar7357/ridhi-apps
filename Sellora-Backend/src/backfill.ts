/* THE HISTORY, ONCE. Apps Script already keeps about 800 days per brand (Amazon from the Orders workbooks, both Shopify
 * stores, and daily ad spend) and publishes it with live.html's data as a public CSV. The first run copies it in, so the
 * page has last year from day one — without asking Amazon for two years of data.
 *
 * It never overwrites: rows already there (from the APIs) stay as they are ("ignore duplicates"). The days Apps Script got
 * wrong — its newest day is only part of a day — are within the last week, which the 10-minute run re-reads from the APIs
 * anyway and overwrites. Ad spend comes as the three Amazon types together (ad_type "total"); page_data uses it only for
 * days the backend has no per-type rows for. */

import type { Db } from './supabase.ts';
import { call } from './http.ts';
import { shiftDay, PT } from './time.ts';

/** The published CSV of the sheet Apps Script's liveSnapshotJob writes (the one live.html reads). */
export const LIVE_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTAoVfl2a82IAF3yOi9yOhWTbk7EmRc2BUMtGG5QpFRQh03ccBiku-a46YL3BfM7Yoa73Bhxk-SWLmm/pub?gid=0&single=true&output=csv';

/** Row 1 says when; rows 2… are the JSON in 40,000-character pieces, one quoted cell per line. */
export function parseSnapshotCsv(text: string): any {
  const rows = text.split(/\r?\n/).slice(1).filter(Boolean);
  return JSON.parse(rows.map(l => l.replace(/^"|"$/g, '').replace(/""/g, '"').replace(/^'/, '')).join(''));
}

const AMAZON: Record<string, string> = { SP: 'SP', CPC: 'CPC' };
const SHOP: Record<string, string> = { SHOP: 'SP', SHOP_CPC: 'CPC' };

/** The snapshot's history as sellora rows. Only finished days (before today). */
export function historyRows(snap: any, today: string, at: number) {
  const H = (snap && snap.hist) || {}, d = H.d || {}, ads = H.ads || {}, fetched = new Date(at).toISOString();
  const finalBefore = shiftDay(today, -8), daily: object[] = [], adRows: object[] = [];
  const put = (brand: string, channel: string, src: Record<string, number[]>) => {
    for (const [day, r] of Object.entries(src || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= today || !Array.isArray(r)) continue;
      daily.push({ brand, channel, day, sales: Math.round((Number(r[0]) || 0) * 100) / 100, units: Number(r[1]) || 0, orders: Number(r[2]) || 0,
        items: null, source: 'apps_script', final: day <= finalBefore, fetched_at: fetched });
    }
  };
  for (const [k, brand] of Object.entries(AMAZON)) put(brand, 'amazon', d[k]);
  for (const [k, brand] of Object.entries(SHOP)) put(brand, 'shopify', d[k]);
  for (const [brand, days] of Object.entries(ads as Record<string, Record<string, number[]>>)) {
    if (!AMAZON[brand]) continue;
    for (const [day, r] of Object.entries(days || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= today || !Array.isArray(r)) continue;
      adRows.push({ brand, ad_type: 'total', day, impressions: Number(r[0]) || 0, clicks: Number(r[1]) || 0,
        spend: Math.round((Number(r[2]) || 0) * 100) / 100, orders: Number(r[3]) || 0, sales: Math.round((Number(r[4]) || 0) * 100) / 100,
        day_tz: PT, source: 'apps_script', fetched_at: fetched });
    }
  }
  return { daily, ads: adRows };
}

export async function backfillOnce(db: Db, today: string, at: number, csvUrl = LIVE_CSV): Promise<{ rows: number; details?: unknown }> {
  const key = 'backfill:apps_script';
  const st = await db.getState<{ done?: string }>(key);
  if (st.done) return { rows: 0, details: { skipped: 'done ' + st.done } };
  const r = await call('Apps Script history (published sheet)', csvUrl + '&t=' + at);
  const snap = parseSnapshotCsv(await r.text());
  if (!snap || !snap.hist || !snap.hist.d) throw new Error('the published sheet has no history in it (hist.d)');
  const { daily, ads } = historyRows(snap, today, at);
  let rows = 0;
  rows += await db.upsert('sales_daily', daily, 'brand,channel,day', true);
  rows += await db.upsert('ads_daily', ads, 'brand,ad_type,day', true);
  await db.setState(key, { done: new Date(at).toISOString(), daily: daily.length, ads: ads.length, snapshotAsOf: snap.asOf || '' });
  return { rows, details: { daily: daily.length, ads: ads.length, snapshotAsOf: snap.asOf } };
}
