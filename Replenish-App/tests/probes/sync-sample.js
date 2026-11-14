/* DELTA SYNC — sort the shadow's mismatch samples into causes (Step 4d). READ ONLY: this script only ever GETs.
 *   node sync-sample.js [days back, default 3] [register]
 * Reads pt_syncAudit/<day> (one line per shadow run, per register: mismatch count, sample keys, the short field diff, upFor)
 * and, for each sampled row, its change note pt_sync/<register>/<row> and the history lines (pt_audit) that touched it.
 * Then names ONE cause per row, by the plan's table (docs/data-reduction/STEP4-5-PLAN.md):
 *   connected under 60 s ........... STALE COPY: the copy was saved just after a reconnect -> the 4d guard (60 s) fixes it
 *   note after the copy + the row differs only in type / key order / number-vs-text -> NORMALISE it in deltaCanon
 *   no note + a history line ....... NOTE LOST: the save happened, its note did not arrive -> 4b (atomic notes)
 *   no note + no history line ...... OUTSIDE WRITER: a script or a console edit -> name it, route it through
 *                                    tests/probes/_noted-write.js, or run sync-reset.js <register> after the edit
 * Needs a firebase-tools login, like the other probes. Ravi runs it, after two working days of the new shadow log. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const H = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app/';
const DAYS = Math.max(1, Number(process.argv[2]) || 3), ONLY = process.argv[3] || '';

/** Name the cause of one differing row. Pure, so the logic can be tested without the database. */
function sortCause(row) {
  if (typeof row.upFor === 'number' && row.upFor < 60) return 'STALE COPY (connected only ' + row.upFor + ' s) -> the 60 s guard';
  const d = row.diffText || '';
  const noteAfter = /\| note \+\d+s vs copy/.test(d) || (row.noteAfterCopy === true);
  const typeDiff = /(\w+)\/(\w+) "/.test(d) && (d.match(/(\w+)\/(\w+) "/) || [])[1] !== (d.match(/(\w+)\/(\w+) "/) || [])[2];
  const sameText = (() => { const m = d.match(/"([^"]*)" vs "([^"]*)"/); return !!m && m[1] === m[2]; })();
  if (noteAfter && (typeDiff || sameText)) return 'NORMALISE in deltaCanon (note after the copy, same data in another shape)';
  if (!row.hasNote && row.hasAudit) return 'NOTE LOST (history line, no note) -> 4b atomic notes';
  if (!row.hasNote && !row.hasAudit) return 'OUTSIDE WRITER (no note, no history line) -> name it; route via _noted-write.js or run sync-reset.js';
  return 'UNSORTED (has a note' + (noteAfter ? ' after the copy' : '') + ') -> look at the diff by hand';
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const t = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = t.access_token || t;
  const get = p => new Promise((res, rej) => https.get(H + p, { headers: { Authorization: 'Bearer ' + at } }, x => {
    let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }).on('error', rej));
  const days = []; for (let i = 0; i < DAYS; i++) days.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10));
  const runs = [];
  for (const day of days) { const o = (await get('pt_syncAudit/' + day + '.json')) || {}; Object.keys(o).forEach(id => runs.push(Object.assign({ id }, o[id]))); }
  const months = new Set(days.map(d => d.slice(0, 7))); let audit = [];
  for (const ym of months) audit = audit.concat(Object.values((await get('pt_audit/' + ym + '.json')) || {}));
  const rows = [];
  for (const run of runs) for (const [reg, r] of Object.entries(run.nodes || {})) {
    if (ONLY && reg !== ONLY) continue;
    for (const key of (r.sample || [])) rows.push({ run, reg, key, r });
  }
  const tally = {};
  console.log(`${runs.length} shadow run(s) in the last ${DAYS} day(s), ${rows.length} sampled mismatching row(s)`);
  for (const x of rows) {
    const noteTs = Number(await get('pt_sync/' + x.reg + '/' + encodeURIComponent(x.key) + '.json')) || 0;
    const runAt = Date.parse(x.run.at) || 0;
    const hit = audit.some(l => l && (l.paths || []).some(p => String(p).split('/').slice(0, 2).join('/') === x.reg + '/' + x.key) && (Date.parse(l.at) || 0) <= runAt + 120000);
    const entry = String(x.r.diff || '').split(' ;; ').find(e => e.startsWith(x.key + '.') || e.startsWith(x.key + ' ') || e.startsWith(x.key + ':')) || '';
    const cause = sortCause({ upFor: x.r.upFor, diffText: entry, hasNote: noteTs > 0, hasAudit: hit });
    const short = cause.split(' (')[0].split(' ->')[0];
    tally[short] = (tally[short] || 0) + 1;
    console.log(`${x.run.at} ${x.run.by || ''} ${x.reg}/${x.key}  ${cause}${entry ? '\n    ' + entry : ''}`);
  }
  console.log('\nBy cause: ' + JSON.stringify(tally));
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { sortCause };
