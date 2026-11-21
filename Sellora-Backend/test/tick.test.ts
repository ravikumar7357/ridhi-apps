import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTick } from '../src/tick.ts';
import { FakeDb, fakeFetch, json, gz, metricsAnswer, env } from './fakes.ts';

// 20 Nov 2026, 9:35 PM Pacific
const NOW = Date.parse('2026-11-21T05:35:00Z');

const snapCsv = () => {
  const s = JSON.stringify({ asOf: '2026-11-21T05:30:00Z', hist: { d: { SP: { '2026-11-12': [22000, 500, 400], '2026-11-19': [30000, 900, 700] }, CPC: {}, SHOP: { '2025-11-21': [0, 0, 0] }, SHOP_CPC: {} }, ads: { SP: { '2026-11-01': [1, 1, 3800, 1, 1] } } } });
  return '"asOf"\n"' + s.replace(/"/g, '""') + '"\n';
};

function services(opts: { adsStatus?: string; failSales?: string } = {}) {
  return fakeFetch([
    u => u.hostname === 'api.amazon.com' ? json({ access_token: 'tok', expires_in: 3600 }) : null,
    (u, init) => {
      if (!u.pathname.startsWith('/sales/v1/orderMetrics')) return null;
      const tok = (init.headers as Record<string, string>)['x-amz-access-token'];
      if (opts.failSales && tok) return json({ errors: [{ message: 'Unauthorized' }] }, 403);
      return metricsAnswer(u);
    },
    (u, init) => u.hostname === 'advertising-api.amazon.com' && u.pathname === '/reporting/reports' && init.method === 'POST'
      ? json({ reportId: 'rep-' + JSON.parse(String(init.body)).configuration.reportTypeId }) : null,
    u => u.hostname === 'advertising-api.amazon.com' && u.pathname.startsWith('/reporting/reports/')
      ? json({ status: opts.adsStatus || 'COMPLETED', url: 'https://s3.example/report.gz' }) : null,
    u => u.hostname === 's3.example' ? gz([{ date: '2026-11-19', impressions: 10, clicks: 2, cost: 100, purchases7d: 1, sales7d: 50, purchases: 1, sales: 50 }]) : null,
    u => u.hostname === 'ridhi.myshopify.com' ? json({ orders: [
      { id: 1, created_at: '2026-11-20T08:15:00-08:00', financial_status: 'paid', line_items: [{ price: '30.00', quantity: 2 }] },
      { id: 2, created_at: '2026-11-19T22:00:00-08:00', financial_status: 'paid', line_items: [{ price: '15.00', quantity: 1 }] },
    ] }) : null,
    u => u.hostname === 'graph.facebook.com' && u.pathname === '/v23.0/act_999' ? json({ timezone_name: 'Asia/Kolkata', currency: 'INR' }) : null,
    u => u.hostname === 'graph.facebook.com' && u.pathname === '/v23.0/act_888' ? json({ timezone_name: 'America/Los_Angeles', currency: 'USD' }) : null,
    // ECB rates: working days only (no 14–15 Nov weekend, none yet for 21 Nov)
    u => u.hostname === 'api.frankfurter.dev' ? json({ base: 'INR', rates: { '2026-11-12': { USD: 0.0106 }, '2026-11-13': { USD: 0.0107 }, '2026-11-16': { USD: 0.0108 }, '2026-11-17': { USD: 0.0108 }, '2026-11-18': { USD: 0.0108 }, '2026-11-19': { USD: 0.0109 }, '2026-11-20': { USD: 0.01 } } }) : null,
    (u, init) => {
      if (u.hostname !== 'graph.facebook.com' || !u.pathname.endsWith('/insights')) return null;
      // each account answers only to its own brand's token
      const auth = (init.headers as Record<string, string>).Authorization;
      const cpc = u.pathname.includes('act_888');
      if (auth !== (cpc ? 'Bearer cpcmetatoken' : 'Bearer metatoken')) return json({ error: { message: 'wrong token' } }, 400);
      const hourly = u.searchParams.get('breakdowns') === 'hourly_stats_aggregated_by_advertiser_time_zone';
      if (cpc) {   // CPC: a Pacific, dollar account, purchases given by the hour
        return json({ data: [{ date_start: '2026-11-20', hourly_stats_aggregated_by_advertiser_time_zone: '09:00:00 - 09:59:59', spend: '80.00', clicks: '300', impressions: '9000',
          actions: [{ action_type: 'purchase', value: '4' }], action_values: [{ action_type: 'purchase', value: '210.00' }] }] });
      }
      // Ridhi: India time, rupees, no purchases by the hour — and the hours come on two pages
      if (hourly && !u.searchParams.get('after')) {
        const next = new URL(u.toString()); next.searchParams.set('after', 'p2');
        return json({ data: [{ date_start: '2026-11-20', hourly_stats_aggregated_by_advertiser_time_zone: '12:00:00 - 12:59:59', spend: '100', clicks: '10', impressions: '1000' }], paging: { next: next.toString() } });
      }
      if (hourly) return json({ data: [{ date_start: '2026-11-21', hourly_stats_aggregated_by_advertiser_time_zone: '10:00:00 - 10:59:59', spend: '50', clicks: '5', impressions: '500' }] });
      return json({ data: [
        { date_start: '2026-11-20', spend: '100', clicks: '10', impressions: '1000', actions: [{ action_type: 'purchase', value: '2' }], action_values: [{ action_type: 'purchase', value: '200' }] },
        { date_start: '2026-11-21', spend: '50', clicks: '5', impressions: '500', actions: [{ action_type: 'purchase', value: '1' }], action_values: [{ action_type: 'purchase', value: '90' }] },
      ] });
    },
    u => u.hostname === 'docs.google.com' ? new Response(snapCsv()) : null,
  ]);
}

test('one full run writes every source, and logs one line per step', async () => {
  const db = new FakeDb(), f = services();
  try {
    const out = await runTick(db as any, env, NOW);
    const bad = out.filter(r => !r.ok);
    assert.deepEqual(bad, [], JSON.stringify(bad));
    assert.deepEqual(out.map(r => r.job + ':' + (r.brand || '')), [
      'backfill:', 'amazon_sales:SP', 'shopify:SP', 'amazon_ads:SP', 'meta_ads:SP', 'amazon_sales:CPC', 'amazon_ads:CPC', 'meta_ads:CPC',
    ]);
    assert.equal(db.runs.length, out.length);

    // Amazon by the hour: yesterday's 24 + today's 22 (to 9 PM) for each brand, plus 3 comparison days of 24
    const ah = db.rows('sales_hourly').filter(r => r.channel === 'amazon' && r.brand === 'SP');
    assert.equal(ah.length, 24 + 22 + 3 * 24);
    // Amazon by the day: the 8 finished days before today, never today
    const ad = db.rows('sales_daily').filter(r => r.channel === 'amazon' && r.brand === 'SP' && r.source === 'sales_api').map(r => r.day).sort();
    assert.deepEqual(ad, ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
    // …and the API figure replaced Apps Script's partial 19 Nov (30,000) while the backfill filled what the API does not cover
    const d19 = db.rows('sales_daily').find(r => r.brand === 'SP' && r.channel === 'amazon' && r.day === '2026-11-19');
    assert.equal(d19.source, 'sales_api');
    assert.equal(d19.sales, 50.5);
    assert.ok(db.rows('sales_daily').every(r => r.day < '2026-11-20'));

    // Shopify: every Pacific hour from 17 Nov 00:00 to now, zero where nothing sold; the two orders where they belong
    const sh = db.rows('sales_hourly').filter(r => r.channel === 'shopify');
    const at8 = sh.find(r => r.hour_start === '2026-11-20T16:00:00.000Z');
    assert.deepEqual([at8.orders, at8.units, at8.sales], [1, 2, 60]);
    const s19 = db.rows('sales_daily').find(r => r.channel === 'shopify' && r.day === '2026-11-19');
    assert.deepEqual([s19.orders, s19.sales, s19.source], [1, 15, 'shopify_api']);

    // Ads: first run only asks (nothing to collect yet); Meta in the account's own timezone (India: already 21 Nov)
    assert.equal(db.rows('ads_daily').filter(r => r.source === 'ads_api').length, 0);
    assert.equal(db.state['amazon_ads:SP'].t.sp.pendingId, 'rep-spCampaigns');
    // Ridhi's account: India time and rupees. Its hours land in PACIFIC days, in dollars:
    //   India 20 Nov 12:00 = 19 Nov 22:30 Pacific → 19 Nov;  India 21 Nov 10:00 = 20 Nov 20:30 Pacific → 20 Nov.
    //   No purchases by the hour: each India day's purchases follow its spend (all of it in that one hour here).
    const meta = Object.fromEntries(db.rows('ads_daily').filter(r => r.ad_type === 'meta' && r.brand === 'SP').map(r => [r.day, r]));
    assert.deepEqual(Object.keys(meta).sort(), ['2026-11-19', '2026-11-20']);
    const m19 = meta['2026-11-19'], m20 = meta['2026-11-20'];
    assert.deepEqual([m19.spend, m19.orders, m19.sales, m19.fx_rate, m19.spend_native], [1.09, 2, 2.18, 0.0109, 100]);
    assert.deepEqual([m20.spend, m20.orders, m20.sales, m20.fx_rate, m20.spend_native, m20.sales_native], [0.5, 1, 0.9, 0.01, 50, 90]);
    assert.deepEqual([m20.day_tz, m20.currency], ['America/Los_Angeles', 'INR']);
    // CPC with its own token and account: Pacific and dollars already, purchases straight from the hour
    const cpcMeta = db.rows('ads_daily').find(r => r.ad_type === 'meta' && r.brand === 'CPC');
    assert.deepEqual([cpcMeta.day, cpcMeta.spend, cpcMeta.orders, cpcMeta.sales, cpcMeta.day_tz, cpcMeta.currency, cpcMeta.fx_rate], ['2026-11-20', 80, 4, 210, 'America/Los_Angeles', 'USD', 1]);
    assert.ok(db.rows('ads_daily').some(r => r.ad_type === 'total' && r.source === 'apps_script'));
  } finally { f.restore(); }
});

test('the second run collects the ad reports and asks again; history and comparison days are not fetched twice', async () => {
  const db = new FakeDb(), f = services();
  try {
    await runTick(db as any, env, NOW);
    const before = f.calls.length;
    const out = await runTick(db as any, env, NOW + 10 * 60000);
    assert.ok(out.every(r => r.ok));
    const sp = db.rows('ads_daily').filter(r => r.brand === 'SP' && r.source === 'ads_api');
    assert.deepEqual(sp.map(r => r.ad_type).sort(), ['sb', 'sd', 'sp']);
    assert.equal(sp.find(r => r.ad_type === 'sp').spend, 100);
    const second = f.calls.slice(before);
    assert.equal(second.filter(c => c.url.includes('docs.google.com')).length, 0, 'history read once only');
    // per brand: 2 Sales API calls (hours, days) and no comparison days again
    assert.equal(second.filter(c => c.url.includes('/sales/v1/orderMetrics')).length, 4);
  } finally { f.restore(); }
});

test('one source failing does not stop the others', async () => {
  const db = new FakeDb(), f = services({ failSales: 'yes' });
  try {
    const out = await runTick(db as any, env, NOW);
    const sales = out.filter(r => r.job === 'amazon_sales');
    assert.ok(sales.every(r => !r.ok && /403/.test(r.error!)));
    assert.ok(out.filter(r => r.job !== 'amazon_sales').every(r => r.ok));
    assert.ok(db.rows('sales_hourly').some(r => r.channel === 'shopify'));
    assert.ok(db.runs.some(r => r.job === 'amazon_sales' && r.ok === false && /403/.test(r.error)));
  } finally { f.restore(); }
});

test('a "duplicate" report (Apps Script asked for the same one) is collected instead of failing', async () => {
  const db = new FakeDb();
  const f = fakeFetch([
    u => u.hostname === 'api.amazon.com' ? json({ access_token: 'tok', expires_in: 3600 }) : null,
    (u, init) => u.hostname === 'advertising-api.amazon.com' && u.pathname === '/reporting/reports' && init.method === 'POST'
      ? json({ code: '425', detail: 'The Request is a duplicate of : 635aaaaa-4c7b-4fe4-8136-1e16c382adfc' }, 425) : null,
    u => u.hostname === 'advertising-api.amazon.com' && u.pathname.startsWith('/reporting/reports/')
      ? json({ status: 'COMPLETED', url: 'https://s3.example/dup.gz' }) : null,
    u => u.hostname === 's3.example' ? gz([{ date: '2026-11-19', impressions: 5, clicks: 1, cost: 42, purchases7d: 1, sales7d: 30, purchases: 1, sales: 30 }]) : null,
  ]);
  const { amazonAds } = await import('../src/tick.ts');
  const { brandConfig } = await import('../src/config.ts');
  try {
    const cfg = brandConfig(env, 'CPC');
    const first = await amazonAds(db as any, cfg, NOW) as any;
    assert.deepEqual(first.details.errors, []);
    assert.equal(db.state['amazon_ads:CPC'].t.sp.pendingId, '635aaaaa-4c7b-4fe4-8136-1e16c382adfc');
    await amazonAds(db as any, cfg, NOW + 600000);
    assert.equal(db.rows('ads_daily').find(r => r.brand === 'CPC' && r.ad_type === 'sp').spend, 42);
  } finally { f.restore(); }
});

test('a report still being built is left for the next run', async () => {
  const db = new FakeDb(), f = services({ adsStatus: 'PENDING' });
  try {
    await runTick(db as any, env, NOW);
    await runTick(db as any, env, NOW + 10 * 60000);
    assert.equal(db.rows('ads_daily').filter(r => r.source === 'ads_api').length, 0);
    assert.equal(db.state['amazon_ads:SP'].t.sp.pendingId, 'rep-spCampaigns');
    const asks = f.calls.filter(c => c.url.endsWith('/reporting/reports') && c.method === 'POST');
    assert.equal(asks.length, 6, 'asked once per type and brand, not again while pending');
  } finally { f.restore(); }
});
