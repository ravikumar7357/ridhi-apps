import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ptDay, ptMidnight, isoPT, shiftDay, offsetMin, daysBetween } from '../src/time.ts';
import { parseMetric } from '../src/amazon.ts';
import { foldShop, storeHost } from '../src/shopify.ts';
import { foldAds } from '../src/ads.ts';
import { parseSnapshotCsv, historyRows } from '../src/backfill.ts';
import { brandConfig } from '../src/config.ts';
import { env } from './fakes.ts';

test('Pacific day boundaries, winter and summer', () => {
  assert.equal(new Date(ptMidnight('2026-11-20')).toISOString(), '2026-11-20T08:00:00.000Z');
  assert.equal(new Date(ptMidnight('2026-07-04')).toISOString(), '2026-07-04T07:00:00.000Z');
  assert.equal(offsetMin(Date.parse('2026-11-20T12:00:00Z')), -480);
  assert.equal(offsetMin(Date.parse('2026-07-04T12:00:00Z')), -420);
});

test('the days daylight saving changes start at the right instant', () => {
  // 1 Nov 2026: clocks go back at 2 AM — the day starts in PDT (-7), the next one in PST (-8)
  assert.equal(new Date(ptMidnight('2026-11-01')).toISOString(), '2026-11-01T07:00:00.000Z');
  assert.equal(new Date(ptMidnight('2026-11-02')).toISOString(), '2026-11-02T08:00:00.000Z');
  // 8 Mar 2026: clocks go forward — the day starts in PST, the next one in PDT
  assert.equal(new Date(ptMidnight('2026-03-08')).toISOString(), '2026-03-08T08:00:00.000Z');
  assert.equal(new Date(ptMidnight('2026-03-09')).toISOString(), '2026-03-09T07:00:00.000Z');
});

test('Pacific day of an instant, and the ISO form Amazon reads', () => {
  assert.equal(ptDay(Date.parse('2026-11-21T05:30:00Z')), '2026-11-20');   // 9:30 PM on the 20th in LA
  assert.equal(isoPT(ptMidnight('2026-11-20')), '2026-11-20T00:00:00-08:00');
  assert.equal(shiftDay('2026-11-20', -364), '2025-11-21');                // same weekday last year
  assert.deepEqual(daysBetween('2026-11-28', '2026-12-01'), ['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01']);
});

test('an Amazon metrics bucket is read as Pacific day and instant', () => {
  const r = parseMetric({ interval: '2026-11-19T00:00-08:00--2026-11-20T00:00-08:00', orderCount: 731, unitCount: 948, orderItemCount: 900, totalSales: { amount: 38900.004 } });
  assert.equal(r.day, '2026-11-19');
  assert.equal(r.ms, ptMidnight('2026-11-19'));
  assert.deepEqual([r.orders, r.units, r.items, r.sales], [731, 948, 900, 38900]);
});

test('Shopify orders fold by Pacific hour and day; voided orders are left out', () => {
  const f = foldShop([
    { id: 1, created_at: '2026-11-20T23:30:00-05:00', financial_status: 'paid', line_items: [{ price: '10.00', quantity: 2 }, { price: '5.50', quantity: 1 }] },
    { id: 2, created_at: '2026-11-20T20:59:00-08:00', financial_status: 'paid', line_items: [{ price: '20.00', quantity: 1 }] },
    { id: 3, created_at: '2026-11-20T20:10:00-08:00', financial_status: 'voided', line_items: [{ price: '99.00', quantity: 1 }] },
  ]);
  // order 1 is 8:30 PM Pacific on the 20th; order 2 is 8:59 PM — the same hour
  const h = f.hours.get(Date.parse('2026-11-21T04:00:00Z'))!;
  assert.deepEqual(h, { orders: 2, units: 4, sales: 45.5 });
  assert.deepEqual(f.days.get('2026-11-20'), { orders: 2, units: 4, sales: 45.5 });
  assert.equal(f.days.size, 1);
});

test('store names are cleaned like Apps Script did', () => {
  assert.equal(storeHost('https://admin.shopify.com/store/ridhi-co/orders'), 'ridhi-co.myshopify.com');
  assert.equal(storeHost('ridhi-co'), 'ridhi-co.myshopify.com');
  assert.equal(storeHost('ridhi-co.myshopify.com/'), 'ridhi-co.myshopify.com');
});

test('ad report rows fold to one row per day, with the right attribution column', () => {
  const sp = foldAds([
    { date: '2026-11-19', impressions: 100, clicks: 5, cost: 10.004, purchases7d: 2, sales7d: 60, purchases: 99 },
    { date: '2026-11-19', impressions: 50, clicks: 1, cost: 2, purchases7d: 0, sales7d: 0 },
    { date: '2026-11-20', impressions: 10, clicks: 0, cost: 0.5, purchases7d: 0, sales7d: 0 },
  ], 'sp');
  assert.deepEqual(sp.get('2026-11-19'), { impressions: 150, clicks: 6, spend: 12, orders: 2, sales: 60 });
  const sb = foldAds([{ date: '2026-11-19', impressions: 1, clicks: 1, cost: 3, purchases: 1, sales: 40, purchases7d: 9 }], 'sb');
  assert.equal(sb.get('2026-11-19')!.orders, 1);
});

test('the published sheet is read back into the history', () => {
  const snap = { asOf: '2026-11-21T05:35:24Z', hist: { d: { SP: { '2026-11-19': [35434.85, 1066, 767], '2026-11-21': [1, 1, 1] }, CPC: { '2025-11-20': [32473.19, 726, 585] }, SHOP: { '2026-11-18': [7631.09, 120, 70] }, SHOP_CPC: {} }, ads: { SP: { '2026-11-18': [594450, 6190, 4005.05, 264, 14249.77] } } } };
  const s = JSON.stringify(snap);
  const csv = '"asOf 2026-11-21 · parts 2"\n"' + s.slice(0, 40).replace(/"/g, '""') + '"\n"' + s.slice(40).replace(/"/g, '""') + '"\n';
  const back = parseSnapshotCsv(csv);
  assert.deepEqual(back, snap);
  const rows = historyRows(back, '2026-11-21', Date.parse('2026-11-21T06:00:00Z'));
  assert.equal(rows.daily.length, 3);                                     // today's partial row is left out
  const cpc = rows.daily.find((r: any) => r.brand === 'CPC') as any;
  assert.deepEqual([cpc.channel, cpc.day, cpc.sales, cpc.units, cpc.orders, cpc.final], ['amazon', '2025-11-20', 32473.19, 726, 585, true]);
  const shop = rows.daily.find((r: any) => r.channel === 'shopify') as any;
  assert.deepEqual([shop.brand, shop.final], ['SP', false]);              // within the last 8 days: the API will re-read it
  assert.deepEqual(rows.ads, [{ brand: 'SP', ad_type: 'total', day: '2026-11-18', impressions: 594450, clicks: 6190, spend: 4005.05, orders: 264, sales: 14249.77, day_tz: 'America/Los_Angeles', source: 'apps_script', fetched_at: '2026-11-21T06:00:00.000Z' }]);
});

test('brand settings: Ridhi has no prefix for Shopify and Meta, "none" counts as not set', () => {
  const sp = brandConfig(env, 'SP'), cpc = brandConfig(env, 'CPC');
  assert.equal(sp.shop!.store, 'ridhi.myshopify.com');
  assert.equal(cpc.shop, null);
  assert.equal(sp.meta!.account, 'act_999');
  assert.equal(cpc.meta, null);
  assert.equal(cpc.sales!.clientId, 'cpcid');
  assert.equal(cpc.ads!.profileId, '222');
});
