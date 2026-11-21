import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Db } from '../src/supabase.ts';
import { fakeFetch, json } from './fakes.ts';

test('writes go to schema sellora with only the apikey header, in pieces of 500, merging on the key', async () => {
  const seen: { url: string; headers: Record<string, string>; n: number }[] = [];
  const f = fakeFetch([(u, init) => { seen.push({ url: u.toString(), headers: init.headers as Record<string, string>, n: JSON.parse(String(init.body)).length }); return new Response(null, { status: 201 }); }]);
  try {
    const db = new Db('https://x.supabase.co/', 'sb_secret_k');
    const n = await db.upsert('sales_daily', Array.from({ length: 1200 }, (_, i) => ({ i })), 'brand,channel,day');
    assert.equal(n, 1200);
    assert.deepEqual(seen.map(s => s.n), [500, 500, 200]);
    assert.equal(seen[0].url, 'https://x.supabase.co/rest/v1/sales_daily?on_conflict=brand%2Cchannel%2Cday');
    assert.equal(seen[0].headers['Content-Profile'], 'sellora');
    assert.equal(seen[0].headers.apikey, 'sb_secret_k');
    assert.equal(seen[0].headers.Authorization, undefined);
    assert.equal(seen[0].headers.Prefer, 'resolution=merge-duplicates,return=minimal');
    await db.upsert('ads_daily', [{ a: 1 }], 'brand,ad_type,day', true);
    assert.equal(seen[3].headers.Prefer, 'resolution=ignore-duplicates,return=minimal');
  } finally { f.restore(); }
});

test('job state reads back what was saved, and an unknown job is empty', async () => {
  const f = fakeFetch([u => u.pathname.endsWith('/job_state') ? json(u.searchParams.get('job') === 'eq.known' ? [{ state: { done: { '2026-11-19': 1 } } }] : []) : null]);
  try {
    const db = new Db('https://x.supabase.co', 'k');
    assert.deepEqual(await db.getState('known'), { done: { '2026-11-19': 1 } });
    assert.deepEqual(await db.getState('other'), {});
  } finally { f.restore(); }
});

test('a Supabase error is reported with its status, not swallowed', async () => {
  const f = fakeFetch([() => json({ message: 'relation "sellora.sales_daily" does not exist' }, 404)]);
  try {
    await assert.rejects(new Db('https://x.supabase.co', 'k').upsert('sales_daily', [{}], 'day'), /Supabase sales_daily 404: .*does not exist/);
  } finally { f.restore(); }
});
