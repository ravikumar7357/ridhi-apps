import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/lib/router.ts';
import { ROUTES } from '../src/routes/index.ts';
import { clearTokenCache } from '../src/lib/amazon.ts';
import { AmazonGateway } from '../src/lib/gateway.ts';
import { MemoryLimiter } from '../src/lib/limiter.ts';
import { controlsFrom } from '../src/lib/controls.ts';
import { FakeDb, env, envFrom, ENV, fakeFetch, json, lwa, type FakeRoute } from './fakes.ts';

/* Amazon Ads: /v2/profiles answers only with a bearer token AND the right client id, like the real API. */
const PROFILES: Record<string, object[]> = {
  'Atza|spadsid': [
    { profileId: 111, countryCode: 'US', currencyCode: 'USD',
      accountInfo: { type: 'seller', name: 'Ridhi Home', marketplaceStringId: 'ATVPDKIKX0DER', id: 'A1SELLER' } },
    { profileId: 222, countryCode: 'CA', currencyCode: 'CAD', accountInfo: { type: 'seller', name: 'Ridhi CA' } },
  ],
  'Atza|cpcadsid': [{ profileId: 333 }],
};
const ads: FakeRoute = (url, init) => {
  if (url.hostname !== 'advertising-api.amazon.com') return null;
  const h = new Headers(init.headers);
  const token = (h.get('authorization') || '').replace(/^Bearer /, '');
  const id = h.get('amazon-advertising-api-clientid');
  if (url.pathname !== '/v2/profiles') return json({ code: 'NOT_FOUND' }, 404);
  if (!PROFILES[token] || token !== 'Atza|' + id) return json({ code: 'UNAUTHORIZED', details: 'Not authorized' }, 401);
  return json(PROFILES[token]);
};

const gatewayOwning = (rows: { key: string; value: unknown }[], e = env) => async () =>
  new AmazonGateway({ env: e, limiter: new MemoryLimiter(), controls: controlsFrom(rows), sleep: async () => {} });

const OURS = [{ key: 'owner:ads-profiles', value: 'backend' }];

const ask = (gateway = gatewayOwning(OURS), e = env, db = new FakeDb()) =>
  handle({ env: e, db, routes: ROUTES, gateway }, 'GET', { ads: 'profiles', key: 'secret-key' }, '');

beforeEach(() => clearTokenCache());

test('both brands: every profile, shaped exactly like adsProfilesBoth_', async () => {
  const f = fakeFetch([lwa, ads]);
  try {
    const got = JSON.parse((await ask()).body);
    assert.deepEqual(got, {
      ok: true,
      brands: {
        SP: {
          ok: true, host: 'https://advertising-api.amazon.com', configured: '111',
          profiles: [
            { profileId: '111', country: 'US', currency: 'USD', type: 'seller', name: 'Ridhi Home', marketplace: 'ATVPDKIKX0DER', sellerId: 'A1SELLER' },
            { profileId: '222', country: 'CA', currency: 'CAD', type: 'seller', name: 'Ridhi CA', marketplace: '', sellerId: '' },
          ],
        },
        CPC: {
          ok: true, host: 'https://advertising-api.amazon.com', configured: '',
          profiles: [{ profileId: '333', country: '', currency: '', type: '', name: '', marketplace: '', sellerId: '' }],
        },
      },
    });
  } finally { f.restore(); }
});

test('each brand logs in with its OWN Ads login, not the SP-API one', async () => {
  const f = fakeFetch([lwa, ads]);
  try {
    await ask();
    const logins = f.calls.filter(c => c.url.startsWith('https://api.amazon.com/')).map(c => c.body!);
    assert.equal(logins.length, 2);
    assert.ok(logins.some(b => /client_id=spadsid/.test(b)));
    assert.ok(logins.some(b => /client_id=cpcadsid/.test(b)));
    assert.ok(!logins.some(b => /client_id=spid&|client_id=spid$/.test(b)), 'the SP-API login was used for Ads');
  } finally { f.restore(); }
});

test('one brand failing does not hide the other: ok:true, that brand ok:false with the reason', async () => {
  const f = fakeFetch([lwa, ads]);
  try {
    const e = envFrom({ ...ENV, CPC_ADS_REFRESH_TOKEN: 'expired' });
    const got = JSON.parse((await ask(gatewayOwning(OURS, e), e)).body);
    assert.equal(got.ok, true);
    assert.equal(got.brands.SP.ok, true);
    assert.equal(got.brands.CPC.ok, false);
    assert.match(got.brands.CPC.error, /invalid grant/);
  } finally { f.restore(); }
});

test('missing Ads values: the same message as adsToken_', async () => {
  const f = fakeFetch([lwa, ads]);
  try {
    const e = envFrom({ ...ENV, SP_ADS_CLIENT_SECRET: 'none' });
    const got = JSON.parse((await ask(gatewayOwning(OURS, e), e)).body);
    assert.equal(got.brands.SP.error, 'Missing Script Properties: SP_ADS_CLIENT_ID / SP_ADS_CLIENT_SECRET / SP_ADS_REFRESH_TOKEN');
  } finally { f.restore(); }
});

test('while Apps Script owns ads-profiles, nothing is sent to Amazon', async () => {
  const f = fakeFetch([lwa, ads]);
  try {
    const got = JSON.parse((await ask(gatewayOwning([]))).body);
    assert.equal(got.brands.SP.ok, false);
    assert.match(got.brands.SP.error, /belongs to apps-script/);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test('an Amazon refusal is an error with Amazon\'s words, never an empty list', async () => {
  const bad: FakeRoute = (url) => url.hostname === 'advertising-api.amazon.com' ? json({ code: 'UNAUTHORIZED' }, 401) : null;
  const f = fakeFetch([lwa, bad]);
  try {
    const got = JSON.parse((await ask()).body);
    assert.equal(got.brands.SP.ok, false);
    assert.match(got.brands.SP.error, /ads\.profiles 401/);
  } finally { f.restore(); }
});

test('every Ads call is counted in the call log', async () => {
  const f = fakeFetch([lwa, ads]);
  const db = new FakeDb();
  try {
    await ask(gatewayOwning(OURS), env, db);
    const flushed = db.rpcs.find(r => r.fn === 'count_calls');
    assert.ok(flushed, 'counts were not flushed');
    const rows = (flushed!.args as any).p_rows;
    assert.deepEqual(rows.map((r: any) => `${r.brand} ${r.op} ${r.outcome} ${r.n}`).sort(),
      ['CPC ads.profiles ok 1', 'SP ads.profiles ok 1']);
  } finally { f.restore(); }
});

test('started without a gateway: says so plainly', async () => {
  const got = JSON.parse((await handle({ env, db: new FakeDb(), routes: ROUTES }, 'GET', { ads: 'profiles', key: 'secret-key' }, '')).body);
  assert.deepEqual(got, { ok: false, error: 'This backend cannot call Amazon: no gateway was set up.' });
});
