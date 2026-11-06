/* HER SEARCH ON THE SERVER: IN USE, AND STOPPED TO STAY FREE (Ravi, 3 Nov) — no internet, no cost.
 *   node meera/tests/search-stop.cjs
 * meera.js with "lazy,serveruse", her browser's questions going to her REAL search service (meera/functions/service.js,
 * run here) through a stand-in for her router:
 *   1. search in use: all 580 recorded answers the same;
 *   2. stopped (the month's meter at half, or the cent alarm): she searches in the browser as today — all 580 the same,
 *      nothing sent to the function, no "server not available" note;
 *   3. the admin page shows "Server search stopped to stay free — back on the 1st";
 *   4. never-break: 30 of 30 with search in use and after it stopped. */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const { load } = require('./harness.cjs');
const ROOT = path.join(__dirname, '..', '..');
/* the record that matches MEERA_V2_ON (her new features all on, or all off) */
const V2 = /^\s*const MEERA_V2_ON = true\b/m.test(fs.readFileSync(path.join(ROOT, 'Replenish-App/src/app/core/meera-bridge.js'), 'utf8'));
/* run with her new features off (only lazy + serveruse: the parked search is checked on its own), so the record without them */
const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'meera/bank/baseline/golden.json'), 'utf8'));
void V2;
const SEARCH = 'https://asia-south1-price-research-48ff3.cloudfunctions.net/meeraSearch';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const res = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

(async () => {
  require(path.join(ROOT, 'meera/functions/build.cjs'));
  const { makeService } = await import('file:///' + path.join(ROOT, 'meera/functions/service.js').replace(/\\/g, '/'));
  const wb = fs.readFileSync(path.join(ROOT, 'meera/functions/data/meera-words.bin'));
  const files = { bank: JSON.parse(fs.readFileSync(path.join(ROOT, 'meera/functions/data/meera-bank.json'), 'utf8')), walks: JSON.parse(fs.readFileSync(path.join(ROOT, 'meera/functions/data/meera-walks.json'), 'utf8')),
    words: wb.buffer.slice(wb.byteOffset, wb.byteOffset + wb.byteLength), version: 'test' };
  /* the service with a stand-in sign-in check and router (tickets always given) */
  const svc = makeService({ files, env: { FIREBASE_PROJECT_ID: 'p', ROUTER_URL: 'https://router.local' }, fetcher: async u => (String(u).endsWith('/search-ticket') ? res(200, { ok: true }) : res(404, {})), deps: { verify: async t => (t === 'test' ? { uid: 'u1', email: 'staff@x.com', admin: false } : null) } });
  const lib = await import('file:///' + path.join(ROOT, 'meera/functions/lib/auth.js').replace(/\\/g, '/'));
  let calls = 0;
  const route = async (url, o) => {
    if (url.startsWith(SEARCH)) {
      calls++;
      const p = url.slice(SEARCH.length) || '/';
      const r = await svc.handle({ method: o.method || 'GET', path: p, origin: 'https://fabricrush-replenish.web.app', authorization: 'Bearer test', body: o.body || '' });
      return res(r.status, JSON.parse(r.body || '{}'));
    }
    return null;
  };
  /* her sign-in, as the ERP gives it (the service's check is told yes for this test token) */
  const run = async stopped => {
    const M = await load({ root: ROOT, bundle: true, handle: true, switches: ['lazy', 'serveruse'], route, only: true });
    M.ctx.auth = { currentUser: { getIdToken: async () => 'test' } };
    M.ctx.__meeraTest(stopped ? "SRV.cfg = { meera: true, ai: true, search: false, stopped: 'free' }" : "SRV.cfg = { meera: true, ai: true, search: true, stopped: '' }");
    return M;
  };
  /* the service's sign-in check, for this test: the token "test" is staff */
  const realVerify = lib.verify;
  void realVerify;

  console.log('1. search in use (her questions answered by the search service)');
  { const M = await run(false); calls = 0; let same = 0; const diff = [];
    for (const [k, want] of Object.entries(golden)) { const [, tab, ...q] = k.split('|'); const got = await M.answer(q.join('|'), tab); if (JSON.stringify(got) === JSON.stringify(want)) same++; else diff.push(k); }
    console.log(`   ${same} of ${Object.keys(golden).length} the same; the search service was asked ${calls} time(s)`);
    ok(calls > 0, 'the questions really went to the search service');
    ok(same === Object.keys(golden).length, 'all recorded answers the same with search in use: ' + diff.slice(0, 5).join(' | ')); }

  console.log('2. stopped to stay free');
  { const M = await run(true); calls = 0; let same = 0, note = 0; const diff = [];
    for (const [k, want] of Object.entries(golden)) { const [, tab, ...q] = k.split('|'); const got = await M.answer(q.join('|'), tab);
      if (/not available right now|उपलब्ध नहीं|available nahi/.test(got.text)) note++;
      if (JSON.stringify(got) === JSON.stringify(want)) same++; else diff.push(k); }
    console.log(`   ${same} of ${Object.keys(golden).length} the same; the search service was asked ${calls} time(s)`);
    ok(same === Object.keys(golden).length, 'all recorded answers the same after it stopped: ' + diff.slice(0, 5).join(' | '));
    ok(calls === 0, 'nothing sent to the search function while stopped');
    ok(note === 0, 'no "server not available" note for staff');

    console.log('3. the admin page');
    const html = M.ctx.__meeraTest(`ML_ADMIN.view = { unanswered: [], spellings: [], down: [], tickets: [], drafts: [], cmp: null,
      cfg: { meera: true, ai: true, search: false, searchStopped: 'free', backOn: '2026-12-01' },
      meter: { month: '2026-11', req: 1000000, sec: 61000, limits: { req: 1000000, sec: 90000 }, stopped: 'free', backOn: '2026-12-01' } };
      ML_ADMIN.tab = 'switches'; mlAdminDraw(''); $('mlAdmin').innerHTML`);
    ok(/Server search stopped to stay free — back on the 1st \(2026-12-01\)/.test(html), 'the admin page says: Server search stopped to stay free — back on the 1st');
    ok(/This month's meter \(2026-11\)/.test(html) && /90,000/.test(html), 'and shows the month\'s meter and its limits'); }

  console.log('4. never-break');
  for (const on of ['lazy,serveruse', 'lazy,server']) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'never-break.cjs'), '--bundle', '--on=' + on], { cwd: ROOT, encoding: 'utf8' });
    const last = (r.stdout || '').trim().split('\n').pop();
    ok(/30 passed, 0 failed/.test(last), `never-break with ${on}: ${last}`);
  }
  console.log(`search-stop: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
