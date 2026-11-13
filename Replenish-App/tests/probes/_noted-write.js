/* THE ONE WAY A HAND-RUN SCRIPT WRITES TO A SYNCED REGISTER (Step 4d, 2026-11-10).
 *
 * The factory screens keep a browser copy of eight registers and fetch only the rows that changed, found through the
 * change notes: pt_sync/<register>/<row> = server time (core/history.js ptSyncNote). A script that edits one of those
 * registers without leaving that note makes every copy wrong for that row until the next full download. So every
 * probe / patch script that writes pt_orderBook, pt_masterDB, pt_cuttingData, pt_pressInventory, pt_shopProd,
 * pt_masters, pt_cuttingFreezes or pt_qcChecks goes through noted(), which adds the notes to the SAME request:
 *
 *     const n = NW.noted('PATCH', 'pt_masterDB', patch);      // [method, path, body]
 *     await req(...n);                                        // or call(n[0], n[1], n[2])
 *
 * A write outside those registers comes back unchanged. A whole-register write (PUT / DELETE of the register itself)
 * leaves pt_sync/_reset/<register> instead, which tells every browser to download the register again.
 * tests/probe-writes-test.js checks that every script which writes a synced register uses this file.
 * After a Firebase console edit (no script): node sync-reset.js <register>. */
const fs = require('fs'), https = require('https'), pathm = require('path');

const SYNC_NODES = ['pt_orderBook', 'pt_masterDB', 'pt_cuttingData', 'pt_pressInventory', 'pt_shopProd',
  'pt_masters', 'pt_cuttingFreezes', 'pt_qcChecks'];                         // same list as PT_SYNC_NODES in core/history.js
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB_HOST = 'price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const STAMP = () => ({ '.sv': 'timestamp' });

/** The change-note lines for these written paths (root-relative, as a root PATCH would carry them). */
function noteLines(paths) {
  const out = {};
  (paths || []).forEach(p => {
    const seg = String(p == null ? '' : p).split('/').filter(s => s !== '');
    if (!seg.length || !SYNC_NODES.includes(seg[0])) return;
    if (seg.length === 1) { out['pt_sync/_reset/' + seg[0]] = STAMP(); return; }
    if (!seg[1] || /[.#$[\]]/.test(seg[1])) return;
    out['pt_sync/' + seg[0] + '/' + seg[1]] = STAMP();
  });
  return out;
}

/** method / path / body of a write -> the same write with its change notes added (a root PATCH), or unchanged. */
function noted(method, p, body) {
  const m = String(method || 'GET').toUpperCase(), base = String(p || '').replace(/^\/+|\.json$/g, '').replace(/\/+$/, '');
  if (m === 'GET') return [method, p, body];
  let updates;
  if (m === 'PATCH') {
    if (!body || typeof body !== 'object') return [method, p, body];
    updates = {};
    Object.keys(body).forEach(k => { updates[base ? base + '/' + k : k] = body[k]; });
  } else if (m === 'PUT' || m === 'DELETE') {
    if (!base) return [method, p, body];
    updates = { [base]: m === 'DELETE' ? null : body };
  } else return [method, p, body];
  const lines = noteLines(Object.keys(updates));
  if (!Object.keys(lines).length) return [method, p, body];
  return ['PATCH', '', Object.assign({}, updates, lines)];
}

/** A firebase-tools login, the same way the other probes sign in. */
async function token() {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []);
  return t.access_token || t;
}

/** One request to the database. path has no leading slash and no .json. */
function call(at, method, p, body) {
  return new Promise((res, rej) => {
    const r = https.request({ hostname: DB_HOST, path: '/' + p + '.json', method,
      headers: Object.assign({ Authorization: 'Bearer ' + at }, body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res({ status: x.statusCode, j: JSON.parse(d) }); } catch (e) { res({ status: x.statusCode, j: d }); } }); });
    r.on('error', rej); if (body !== undefined) r.write(JSON.stringify(body)); r.end();
  });
}

module.exports = { SYNC_NODES, noteLines, noted, token, call, DB_HOST };
