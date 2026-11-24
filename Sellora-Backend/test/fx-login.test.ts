import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usdRates } from '../src/fx.ts';
import { lwaToken } from '../src/amazon.ts';
import { fakeFetch, json } from './fakes.ts';

test('a weekend, a holiday and today take the latest working-day rate; dollars are 1', async () => {
  const f = fakeFetch([u => u.hostname === 'api.frankfurter.dev'
    ? json({ rates: { '2026-11-13': { USD: 0.0106 }, '2026-11-16': { USD: 0.0108 } } }) : null]);
  try {
    const r = await usdRates('inr', '2026-11-14', '2026-11-17');
    assert.deepEqual([...r], [['2026-11-14', 0.0106], ['2026-11-15', 0.0106], ['2026-11-16', 0.0108], ['2026-11-17', 0.0108]]);
    assert.ok(f.calls[0].url.includes('/2026-11-04..2026-11-17?from=INR&to=USD'));
    const usd = await usdRates('USD', '2026-11-20', '2026-11-21');
    assert.deepEqual([...usd], [['2026-11-20', 1], ['2026-11-21', 1]]);
    assert.equal(f.calls.length, 1, 'no rate lookup for dollars');
  } finally { f.restore(); }
});

test("Amazon's login refusal says why, not just the long error_index", async () => {
  const f = fakeFetch([() => json({ error_index: 'x'.repeat(400), error_description: 'The request has an invalid grant parameter : refresh_token', error: 'invalid_grant' }, 400)]);
  try {
    await assert.rejects(lwaToken({ clientId: 'amzn1.application-oa2-client.abc123', clientSecret: 's', refreshToken: 'Atzr|bad-unique-1' }, 'Amazon Ads login'),
      /^Error: Amazon Ads login 400: invalid_grant — The request has an invalid grant parameter : refresh_token \(client id …abc123\)$/);
  } finally { f.restore(); }
});
