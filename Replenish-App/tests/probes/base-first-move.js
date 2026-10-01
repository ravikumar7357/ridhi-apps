/* THE FIRST MOVE OF COMPLETED JOB WORK ENTRIES (Ravi, 2026-10-01: "haan aaj raat step 1-3 kar do").
 *
 *   node tests/probes/base-first-move.js          plan only: what would move, nothing written
 *   node tests/probes/base-first-move.js go       backup, move, verify
 *
 * The same rules as the app's baseArchivePlan / baseArchiveRun (src/app/core/job-work-split.js): an entry moves when it
 * is complete (frozen === true, nothing pending), came back BEFORE TODAY, and has no correction request waiting. Each
 * day's entries go in ONE write per batch of 400: the copy into pt_baseDone/<day>/<id>, the original out of
 * pt_baseData/<id>, and pt_baseDone/_ver/<day> — all or nothing. pt_baseDone/_auto is left switched OFF.
 *
 * Before: the whole of pt_baseData to C:/AMAZON/backups. After: everything read back and compared — every entry still
 * there exactly once, every moved entry identical to its backup, every order's issued/received/rejected unchanged. */
const fs = require('fs'), https = require('https'), path = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const GO = process.argv[2] === 'go', BATCH = 400;

const ptNum = v => { const n = Number(v); return isFinite(n) ? n : 0; };
function ptDtMs(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime() : 0;
}
const dayOf = s => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s || '').trim()); return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : ''; };
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => (o[kk] = x[kk], o), {}) : x));
const totals = rows => { const t = {}; rows.forEach(r => { const k = String(r.orderNo || '') + '|' + String(r.sku || '').toUpperCase();
  t[k] = t[k] || [0, 0, 0, 0]; t[k][0] += ptNum(r.issuePieces); t[k][1] += ptNum(r.receivedPieces); t[k][2] += ptNum(r.rejectionPieces); t[k][3]++; }); return t; };

(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, p, body) => new Promise((res, rej) => {
    const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => (x.statusCode < 300 ? res(JSON.parse(d || 'null')) : rej(new Error(method + ' ' + p + ' ' + x.statusCode + ' ' + d.slice(0, 200))))); });
    r.on('error', rej); if (body !== undefined) r.write(JSON.stringify(body)); r.end(); });

  const before = (await req('GET', 'pt_baseData')) || {};
  const corr = (await req('GET', 'pt_jwCorrReqs')) || {};
  const doneVer = await req('GET', 'pt_baseDone/_ver');
  const waiting = new Set(Object.values(corr).filter(q => q && q.status === 'pending').map(q => q.rowId || q.row || q.id));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ids = Object.keys(before);
  const take = ids.filter(id => { const r = before[id];
    return r && typeof r === 'object' && r.frozen === true && ptNum(r.pendingPieces) <= 0 && dayOf(r.receivingDate)
      && ptDtMs(r.receivingDate) && ptDtMs(r.receivingDate) < today.getTime() && !waiting.has(id); });
  const byDay = {};
  take.forEach(id => { const d = dayOf(before[id].receivingDate); (byDay[d] = byDay[d] || []).push(id); });
  const kb = o => (Buffer.byteLength(JSON.stringify(o)) / 1024).toFixed(0) + ' KB';
  console.log(`pt_baseData: ${ids.length} entries (${kb(before)}); pt_baseDone/_ver now: ${JSON.stringify(doneVer)}; corrections waiting: ${waiting.size}`);
  console.log(`would move ${take.length} entries in ${Object.keys(byDay).length} days; ${ids.length - take.length} stay`);
  if (!GO) { console.log('plan only — run with "go" to move'); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bdir = 'C:/AMAZON/backups'; fs.mkdirSync(bdir, { recursive: true });
  const bfile = `${bdir}/pt_baseData-before-first-move-${stamp}.json`;
  fs.writeFileSync(bfile, JSON.stringify(before));
  if (fs.statSync(bfile).size !== Buffer.byteLength(JSON.stringify(before))) throw new Error('backup not written whole');
  console.log('backup', bfile);

  let moved = 0;
  for (const d of Object.keys(byDay).sort()) {
    const list = byDay[d];
    for (let i = 0; i < list.length; i += BATCH) {
      const up = {};
      list.slice(i, i + BATCH).forEach(id => { up['pt_baseDone/' + d + '/' + id] = before[id]; up['pt_baseData/' + id] = null; });
      up['pt_baseDone/_ver/' + d] = Date.now();
      await req('PATCH', '', up);
      moved += Math.min(BATCH, list.length - i);
    }
  }
  await req('PATCH', '', { 'pt_baseDone/_auto/enabled': false, 'pt_baseDone/_auto/firstMoveAt': new Date().toISOString(), 'pt_baseDone/_auto/firstMoveCount': moved });
  console.log('moved', moved);

  /* ---- read everything back and compare ---- */
  const open = (await req('GET', 'pt_baseData')) || {};
  const ver = (await req('GET', 'pt_baseDone/_ver')) || {};
  const done = {};
  for (const d of Object.keys(ver)) Object.assign(done, (await req('GET', 'pt_baseDone/' + d)) || {});
  const both = Object.keys(open).filter(id => id in done);
  const merged = Object.assign({}, done, open);
  const missing = ids.filter(id => !(id in merged));
  const changed = take.filter(id => canon(done[id]) !== canon(before[id]));
  const tb = totals(Object.values(before)), ta = totals(Object.values(merged).filter((r, i, a) => ids.includes(Object.keys(merged)[i])));
  const tdiff = Object.keys(tb).filter(k => canon(tb[k]) !== canon(totals(ids.map(id => merged[id]).filter(Boolean))[k]));
  console.log(`after: open ${Object.keys(open).length} (${kb(open)}), completed ${Object.keys(done).length} in ${Object.keys(ver).length} days`);
  console.log(`entries from before missing now: ${missing.length}; moved entries not identical: ${changed.length}; in both places: ${both.length}; orders whose totals changed: ${tdiff.length}`);
  console.log(missing.length || changed.length || tdiff.length ? 'CHECK FAILED — restore with the backup above' : 'ALL CHECKS PASSED');
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
