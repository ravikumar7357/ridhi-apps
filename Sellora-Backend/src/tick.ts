/* THE 10-MINUTE RUN. For each brand, one step per source — each step on its own, so one source failing (a token run out,
 * Amazon slow) never stops the others, and every step leaves one row in sellora.fetch_runs saying what it did.
 *
 *   amazon_sales  Sales API: yesterday + today by the hour; the last 8 finished days by day (pending orders settle);
 *                 the comparison days (same weekday last year, last week, 4 weeks ago) by the hour, once each.
 *   shopify       the last 3 days + today by Pacific hour and day; the comparison days once each.
 *   amazon_ads    Products, Brands and Display daily reports for the last 7 days: collect what the last run asked for,
 *                 then ask again.
 *   meta_ads      Meta insights for the last 7 days, in the ad account's own timezone.
 *   backfill      once, ever: the history Apps Script already has (about 800 days), so last year is there from day one.
 *
 * Today is never written as a day row: it lives in sales_hourly until it is over. */

import type { Db } from './supabase.ts';
import { orderMetrics } from './amazon.ts';
import { askReport, reportStatus, downloadReport, foldAds, findProfile, type AdType, type AdDay } from './ads.ts';
import { ordersBetween, foldShop, type Tot } from './shopify.ts';
import { insights, insightsHourly, accountInfo } from './meta.ts';
import { usdRates } from './fx.ts';
import { ordersUpdatedSince, foldBreakdown, totals } from './shopbreakdown.ts';
import { ptDay, ptMidnight, shiftDay, daysBetween, hourStart, dayIn, zonedHour, PT } from './time.ts';
import { BRANDS, brandConfig, type Env, type BrandConfig, type Brand } from './config.ts';
import { backfillOnce } from './backfill.ts';

/** The days the page sets today against: same weekday last year, last week, four weeks ago. */
export const COMPARE_DAYS = [-364, -7, -28];
const AD_TYPES_ORDER: AdType[] = ['sp', 'sb', 'sd'];
const HOUR = 3600000;

export interface StepResult { job: string; brand: Brand | null; ok: boolean; rows: number; ms: number; error?: string; details?: unknown }
type StepOut = { rows: number; details?: unknown };

const msg = (e: unknown) => String((e as Error)?.message || e).slice(0, 500);
const nowIso = (ms: number) => new Date(ms).toISOString();

function hourRow(brand: Brand, channel: 'amazon' | 'shopify', ms: number, t: Tot & { items?: number | null }, at: number) {
  return { brand, channel, hour_start: new Date(ms).toISOString(), orders: t.orders, units: t.units, items: t.items ?? null, sales: t.sales, fetched_at: nowIso(at) };
}
function dayRow(brand: Brand, channel: 'amazon' | 'shopify', day: string, t: Tot & { items?: number | null }, source: string, final: boolean, at: number) {
  return { brand, channel, day, orders: t.orders, units: t.units, items: t.items ?? null, sales: t.sales, source, final, fetched_at: nowIso(at) };
}
function adRow(brand: Brand, adType: string, day: string, a: AdDay, source: string, tz: string, at: number) {
  return { brand, ad_type: adType, day, impressions: a.impressions, clicks: a.clicks, spend: a.spend, orders: a.orders, sales: a.sales, day_tz: tz, source, fetched_at: nowIso(at) };
}
const ZERO: Tot = { orders: 0, units: 0, sales: 0 };

/** Keep a "done" map from growing for ever: only the last 400 days. */
function trimDone(done: Record<string, 1>, today: string): Record<string, 1> {
  const cut = shiftDay(today, -400), out: Record<string, 1> = {};
  for (const d of Object.keys(done)) if (d >= cut) out[d] = 1;
  return out;
}

/* ---------------- Amazon sales ---------------- */
export async function amazonSales(db: Db, cfg: BrandConfig, now: number): Promise<StepOut> {
  const b = cfg.brand, c = cfg.sales!, today = ptDay(now), yest = shiftDay(today, -1);
  let rows = 0;
  const hrs = (await orderMetrics(c, ptMidnight(yest), now, 'Hour')).filter(r => Number.isFinite(r.ms));
  rows += await db.upsert('sales_hourly', hrs.map(r => hourRow(b, 'amazon', r.ms, r, now)), 'brand,channel,hour_start');
  const from = shiftDay(today, -8);
  const days = (await orderMetrics(c, ptMidnight(from), ptMidnight(today), 'Day')).filter(r => r.day >= from && r.day < today);
  rows += await db.upsert('sales_daily', days.map(r => dayRow(b, 'amazon', r.day, r, 'sales_api', r.day <= shiftDay(today, -7), now)), 'brand,channel,day');
  const key = 'amazon_hours:' + b, st = await db.getState<{ done?: Record<string, 1> }>(key);
  let done = st.done || {}, fetched: string[] = [];
  for (const n of COMPARE_DAYS) {
    const d = shiftDay(today, n);
    if (done[d]) continue;
    const h = (await orderMetrics(c, ptMidnight(d), ptMidnight(shiftDay(d, 1)), 'Hour')).filter(r => Number.isFinite(r.ms));
    rows += await db.upsert('sales_hourly', h.map(r => hourRow(b, 'amazon', r.ms, r, now)), 'brand,channel,hour_start');
    done[d] = 1; fetched.push(d);
  }
  if (fetched.length) await db.setState(key, { done: trimDone(done, today) });
  return { rows, details: { hours: hrs.length, days: days.length, compareFetched: fetched } };
}

/* ---------------- Shopify ---------------- */
function shopRowsFor(b: Brand, fromMs: number, toMs: number, hours: Map<number, Tot>, at: number) {
  const out = [];
  for (let h = hourStart(fromMs); h <= hourStart(toMs); h += HOUR) out.push(hourRow(b, 'shopify', h, hours.get(h) || ZERO, at));
  return out;
}
export async function shopify(db: Db, cfg: BrandConfig, now: number): Promise<StepOut> {
  const b = cfg.brand, s = cfg.shop!, today = ptDay(now), from = shiftDay(today, -3), fromMs = ptMidnight(from);
  let rows = 0;
  const f = foldShop(await ordersBetween(s.store, s.token, fromMs, now));
  rows += await db.upsert('sales_hourly', shopRowsFor(b, fromMs, now, f.hours, now), 'brand,channel,hour_start');
  const finished = daysBetween(from, shiftDay(today, -1));
  rows += await db.upsert('sales_daily', finished.map(d => dayRow(b, 'shopify', d, f.days.get(d) || ZERO, 'shopify_api', false, now)), 'brand,channel,day');
  const key = 'shopify_hours:' + b, st = await db.getState<{ done?: Record<string, 1> }>(key);
  let done = st.done || {}, fetched: string[] = [];
  for (const n of COMPARE_DAYS) {
    const d = shiftDay(today, n);
    if (done[d]) continue;
    const a = ptMidnight(d), z = ptMidnight(shiftDay(d, 1));
    const g = foldShop(await ordersBetween(s.store, s.token, a, z - 1));
    rows += await db.upsert('sales_hourly', shopRowsFor(b, a, z - 1, g.hours, now), 'brand,channel,hour_start');
    rows += await db.upsert('sales_daily', [dayRow(b, 'shopify', d, g.days.get(d) || ZERO, 'shopify_api', true, now)], 'brand,channel,day');
    done[d] = 1; fetched.push(d);
  }
  if (fetched.length) await db.setState(key, { done: trimDone(done, today) });
  return { rows, details: { orders: [...f.days.values()].reduce((t, x) => t + x.orders, 0), compareFetched: fetched } };
}

/* ---------------- Shopify's total sales breakdown (shopbreakdown.ts) ----------------
 * The last 7 Pacific days, today included, read again every run (a refund can come days after its order). */
export const BREAKDOWN_DAYS = 7;
export async function shopifyBreakdown(db: Db, cfg: BrandConfig, now: number): Promise<StepOut> {
  const b = cfg.brand, s = cfg.shop!, today = ptDay(now), from = shiftDay(today, -(BREAKDOWN_DAYS - 1));
  const orders = await ordersUpdatedSince(s.store, s.token, ptMidnight(from));
  const byDay = foldBreakdown(orders, from), at = nowIso(now);
  const rows = daysBetween(from, today).map(d => {
    const x = byDay.get(d) || { orders: 0, gross: 0, discounts: 0, returns: 0, shipping: 0, taxes: 0 }, t = totals(x);
    return { brand: b, day: d, orders: x.orders, gross: x.gross, discounts: x.discounts, returns: x.returns, net: t.net,
      shipping: x.shipping, taxes: x.taxes, total: t.total, fetched_at: at };
  });
  const n = await db.upsert('shop_breakdown', rows, 'brand,day');
  const y = rows.find(r => r.day === shiftDay(today, -1));
  return { rows: n, details: { orders: orders.length, yesterdayTotal: y && y.total } };
}

/* ---------------- Amazon ads ---------------- */
interface AdTypeState { pendingId?: string; askedMs?: number; lastDoneMs?: number; err?: string }
interface AdsState { profileId?: string; t?: Partial<Record<AdType, AdTypeState>> }

export async function amazonAds(db: Db, cfg: BrandConfig, now: number): Promise<StepOut> {
  const b = cfg.brand, a = cfg.ads!, today = ptDay(now), key = 'amazon_ads:' + b;
  const st = await db.getState<AdsState>(key);
  st.t = st.t || {};
  const profileId = a.profileId || st.profileId || await findProfile(a, b);
  if (!a.profileId) st.profileId = profileId;
  const ctx = { cred: a, profileId };
  let rows = 0;
  const collected: string[] = [], errors: string[] = [];
  for (const type of AD_TYPES_ORDER) {
    const x: AdTypeState = st.t[type] || (st.t[type] = {});
    if (x.pendingId) {
      try {
        const s = await reportStatus(ctx, x.pendingId);
        if (s.ready) {
          const days = foldAds(await downloadReport(s.url), type);
          rows += await db.upsert('ads_daily', [...days].map(([d, v]) => adRow(b, type, d, v, 'ads_api', PT, now)), 'brand,ad_type,day');
          x.pendingId = ''; x.lastDoneMs = now; x.err = ''; collected.push(type);
        } else if (s.failed) { x.err = `report ${s.status}${s.reason ? ': ' + s.reason : ''}`; x.pendingId = ''; errors.push(type + ': ' + x.err); }
        else if (now - (x.askedMs || 0) > 90 * 60000) { x.err = 'report never finished; asked again'; x.pendingId = ''; }
        else continue;                                                  // still being built: collect it next run
      } catch (e) { x.err = 'collect: ' + msg(e); x.pendingId = ''; errors.push(type + ': ' + x.err); }
    }
    try { x.pendingId = await askReport(ctx, type, shiftDay(today, -7), today, b); x.askedMs = now; }
    catch (e) { x.err = 'ask: ' + msg(e); errors.push(type + ': ' + x.err); }
  }
  await db.setState(key, st);
  if (errors.length === AD_TYPES_ORDER.length) throw new Error(errors.join(' · '));
  return { rows, details: { collected, errors } };
}

/* ---------------- Meta ads ---------------- */
/* Two things make Meta's figures unlike the rest, and both are put right here:
 *  - CURRENCY: an ad account may report in its own (Ridhi's: rupees). Spend and sales are stored in US dollars at the
 *    day's ECB rate; the account's own figures, its currency and the rate are kept beside them.
 *  - THE DAY: Meta counts a day on the ad account's clock (Ridhi's: India time, 13½ hours ahead of Pacific). Read by the
 *    HOUR on that clock, each hour is turned into the moment it was and counted in its PACIFIC day, like Amazon and Shopify
 *    (21 Nov: Today's TACoS read 247% early in the Pacific morning — a whole India day of Meta against two US hours).
 *    When Meta gives no purchases by the hour, a day's purchases are shared out by each hour's share of that day's spend. */
export const META_PT_DAYS = 7;       // Pacific days written each run (today + the 6 before), all wholly inside what is read
export async function metaAds(db: Db, cfg: BrandConfig, now: number): Promise<StepOut> {
  const b = cfg.brand, m = cfg.meta!, key = 'meta:' + b;
  const st = await db.getState<{ tz?: string; currency?: string; account?: string }>(key);
  let tz = st.account === m.account ? st.tz : '', currency = st.account === m.account ? st.currency : '';
  if (!tz || !currency) {
    const info = await accountInfo(m.token, m.account);
    tz = info.tz; currency = info.currency;
    await db.setState(key, { tz, currency, account: m.account });
  }
  // The account's days to read: enough to cover the Pacific days written, whichever side of Pacific its clock is.
  const accToday = dayIn(now, tz!), accFrom = shiftDay(accToday, -(META_PT_DAYS + 1));
  const hours = await insightsHourly(m.token, m.account, accFrom, accToday);
  if (!hours.some(h => h.orders || h.sales)) {
    const daily = await insights(m.token, m.account, accFrom, accToday);
    const spendOn = new Map<string, number>(), countOn = new Map<string, number>();
    for (const h of hours) { spendOn.set(h.day, (spendOn.get(h.day) || 0) + h.spend); countOn.set(h.day, (countOn.get(h.day) || 0) + 1); }
    for (const h of hours) {
      const d = daily.get(h.day); if (!d) continue;
      const share = (spendOn.get(h.day) || 0) > 0 ? h.spend / spendOn.get(h.day)! : 1 / (countOn.get(h.day) || 1);
      h.orders = d.orders * share; h.sales = d.sales * share;
    }
  }
  // Each account hour → its Pacific day.
  const ptToday = ptDay(now), ptFrom = shiftDay(ptToday, -(META_PT_DAYS - 1));
  const byDay = new Map<string, AdDay>();
  for (const h of hours) {
    const d = ptDay(zonedHour(h.day, h.hour, tz!));
    if (d < ptFrom || d > ptToday) continue;
    const t = byDay.get(d) || { impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0 };
    t.impressions += h.impressions; t.clicks += h.clicks; t.spend += h.spend; t.orders += h.orders; t.sales += h.sales;
    byDay.set(d, t);
  }
  const fx = await usdRates(currency!, ptFrom, ptToday);
  const rows = await db.upsert('ads_daily', [...byDay].map(([d, v]) => {
    const rate = fx.get(d);
    if (!rate) throw new Error(`no ${currency} → USD rate for ${d}`);
    const usd = { impressions: v.impressions, clicks: v.clicks, orders: Math.round(v.orders),
      spend: Math.round(v.spend * rate * 100) / 100, sales: Math.round(v.sales * rate * 100) / 100 };
    return { ...adRow(b, 'meta', d, usd, 'meta_api', PT, now), currency, fx_rate: rate,
      spend_native: Math.round(v.spend * 100) / 100, sales_native: Math.round(v.sales * 100) / 100 };
  }), 'brand,ad_type,day');
  return { rows, details: { hours: hours.length, days: byDay.size, accountTz: tz, currency, rate: fx.get(ptToday) } };
}

/* ---------------- the run ---------------- */
export async function runTick(db: Db, env: Env, now = Date.now()): Promise<StepResult[]> {
  const out: StepResult[] = [];
  const step = async (job: string, brand: Brand | null, fn: () => Promise<StepOut>) => {
    const t0 = Date.now();
    let r: StepResult;
    try { const x = await fn(); r = { job, brand, ok: true, rows: x.rows, ms: Date.now() - t0, details: x.details }; }
    catch (e) { r = { job, brand, ok: false, rows: 0, ms: Date.now() - t0, error: msg(e) }; }
    out.push(r);
    try {
      await db.logRun({ job, brand, started_at: nowIso(t0), finished_at: nowIso(Date.now()), ok: r.ok, rows_written: r.rows, error: r.error || null, details: r.details ?? null });
    } catch { /* the figures are in; only the log line is lost */ }
  };

  await step('backfill', null, () => backfillOnce(db, ptDay(now), now));
  const metaSeen = new Set<string>();
  for (const brand of BRANDS) {
    const cfg = brandConfig(env, brand);
    if (cfg.sales) await step('amazon_sales', brand, () => amazonSales(db, cfg, now));
    if (cfg.shop) await step('shopify', brand, () => shopify(db, cfg, now));
    if (cfg.shop) await step('shopify_breakdown', brand, () => shopifyBreakdown(db, cfg, now));
    if (cfg.ads) await step('amazon_ads', brand, () => amazonAds(db, cfg, now));
    // One Meta ad account shared by both brands would be counted twice: only its first brand gets it.
    if (cfg.meta && !metaSeen.has(cfg.meta.account)) { metaSeen.add(cfg.meta.account); await step('meta_ads', brand, () => metaAds(db, cfg, now)); }
  }
  // Once a day (the first run after 03:00 UTC): drop run log rows older than 30 days.
  const d = new Date(now);
  if (d.getUTCHours() === 3 && d.getUTCMinutes() < 10) await step('prune_runs', null, async () => { await db.pruneRuns(30); return { rows: 0 }; });
  return out;
}
