import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { AmazonGateway } from '../src/lib/gateway.ts';
import { MemoryLimiter } from '../src/lib/limiter.ts';
import { controlsFrom } from '../src/lib/controls.ts';
import { findOrCreateReport, collectReport } from '../src/lib/reports.ts';
import { clearTokenCache } from '../src/lib/amazon.ts';
import { env, fakeFetch, json, lwa, type FakeRoute } from './fakes.ts';

const SP = 'sellingpartnerapi-na.amazon.com';
const CTX = { dataset: 'orders-report' as const };
const SPEC = {
  reportType: 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL', marketplaceIds: ['ATVPDKIKX0DER'],
  dataStartTime: '2026-11-05T00:00:00Z', dataEndTime: '2026-11-25T00:00:00Z',
};
const NOW = Date.parse('2026-11-25T10:00:00Z');

function gateway() {
  let t = NOW;
  const now = () => t;
  return new AmazonGateway({
    env, now, limiter: new MemoryLimiter(now), sleep: async (ms) => { t += ms; },
    controls: controlsFrom([{ key: 'share', value: 1 }, { key: 'owner:orders-report', value: 'backend' }]),
  });
}
/** A fake Reports API: `list` is what getReports answers; POSTs are recorded. */
function amazon(list: any[], report: any = {}, doc: any = {}) {
  const posts: any[] = [];
  const route: FakeRoute = (url, init) => {
    if (url.hostname === 'files.amazon.test') return new Response(doc.bytes ?? 'sku\tqty\nA\t1\n');
    if (url.hostname !== SP) return null;
    if (init.method === 'POST') { posts.push(JSON.parse(String(init.body))); return json({ reportId: 'NEW-1' }, 202); }
    if (url.pathname.endsWith('/reports')) return json({ reports: list });
    if (url.pathname.includes('/documents/')) return json({ url: 'https://files.amazon.test/doc', compressionAlgorithm: doc.gzip ? 'GZIP' : undefined });
    return json(report);
  };
  return { route, posts };
}

beforeEach(() => clearTokenCache());

test('reuse before asking: a matching report from the last hour is used, and Amazon is not asked for a new one', async () => {
  const a = amazon([
    { reportId: 'OLD-7', dataStartTime: '2026-11-01T00:00:00Z', dataEndTime: '2026-11-25T00:00:00Z' },   // other dates
    { reportId: 'OLD-9', dataStartTime: '2026-11-05T00:00:00+00:00', dataEndTime: '2026-11-25T00:00:00+00:00' },
  ]);
  const f = fakeFetch([lwa, a.route]);
  try {
    const out = await findOrCreateReport(gateway(), 'SP', SPEC, CTX, () => NOW);
    assert.deepEqual(out, { reportId: 'OLD-9', reused: true });
    assert.equal(a.posts.length, 0);
    const asked = new URL(f.calls.find(c => c.url.includes('/reports?'))!.url);
    assert.equal(asked.searchParams.get('createdSince'), '2026-11-25T09:00:00.000Z');
    assert.equal(asked.searchParams.get('reportTypes'), SPEC.reportType);
  } finally { f.restore(); }
});

test('nothing to reuse: one new report is asked for', async () => {
  const a = amazon([]);
  const f = fakeFetch([lwa, a.route]);
  try {
    const out = await findOrCreateReport(gateway(), 'SP', SPEC, CTX, () => NOW);
    assert.deepEqual(out, { reportId: 'NEW-1', reused: false });
    assert.equal(a.posts.length, 1);
    assert.equal(a.posts[0].reportType, SPEC.reportType);
  } finally { f.restore(); }
});

test('a report with options is never reused (Amazon\'s list does not show the options)', async () => {
  const a = amazon([{ reportId: 'OLD-9', dataStartTime: SPEC.dataStartTime, dataEndTime: SPEC.dataEndTime }]);
  const f = fakeFetch([lwa, a.route]);
  try {
    const out = await findOrCreateReport(gateway(), 'SP', { ...SPEC, reportOptions: { dateGranularity: 'DAY' } }, CTX, () => NOW);
    assert.equal(out.reused, false);
    assert.equal(f.calls.some(c => c.url.includes('/reports?')), false);
  } finally { f.restore(); }
});

test('collect: not ready yet gives null, so the job comes back next run', async () => {
  const a = amazon([], { processingStatus: 'IN_PROGRESS' });
  const f = fakeFetch([lwa, a.route]);
  try { assert.equal(await collectReport(gateway(), 'SP', 'R1', CTX), null); } finally { f.restore(); }
});

test('collect: ready gives the document\'s text, unzipped when Amazon zipped it', async () => {
  const a = amazon([], { processingStatus: 'DONE', reportDocumentId: 'D1' }, { gzip: true, bytes: gzipSync(Buffer.from('sku\tqty\nA\t5\n')) });
  const f = fakeFetch([lwa, a.route]);
  try { assert.equal(await collectReport(gateway(), 'SP', 'R1', CTX), 'sku\tqty\nA\t5\n'); } finally { f.restore(); }
});

test('collect: a report Amazon failed or cancelled is an error, never "no rows"', async () => {
  const f1 = fakeFetch([lwa, amazon([], { processingStatus: 'FATAL' }).route]);
  try { await assert.rejects(collectReport(gateway(), 'SP', 'R1', CTX), /failed report R1/); } finally { f1.restore(); }
  const f2 = fakeFetch([lwa, amazon([], { processingStatus: 'CANCELLED' }).route]);
  try { await assert.rejects(collectReport(gateway(), 'SP', 'R1', CTX), /cancelled report R1/); } finally { f2.restore(); }
});
