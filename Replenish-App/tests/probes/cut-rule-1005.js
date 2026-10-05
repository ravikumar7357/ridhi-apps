/* 5 Oct 2026, Ravi's cutting rule, written into pt_masterDB/<id>/cuttingRequired (true/false, never text):
 *   quilt → cut; any embroidery item → no cut; tablecloth → no cut unless scallop / ruffle (those → cut);
 *   table runner → no cut unless scallop (→ cut); border napkin → no cut. Everything else keeps its value; a
 *   "yes"/"no" text left anywhere becomes true/false. Dry run unless WRITE=1; undo file + pt_audit line.
 *   node probes/cut-rule-1005.js */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const cutRule = r => {
  const a = String(r.articleType || '').toLowerCase(), s = String(r.subtype || '').toLowerCase(), h = a + ' ' + s;
  if (/quilt/.test(h)) return true;
  if (/embroider/.test(h)) return false;
  if (/tablecloth/.test(h)) return /scallop|ruffle/.test(s);
  if (/table runner/.test(h)) return /scallop/.test(s);
  if (/border napkin/.test(s)) return false;
  return null;
};
module.exports = { cutRule };
if (require.main === module) (async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const call = (method, p, body) => new Promise((res, rej) => { const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, timeout: 300000 },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { if (x.statusCode >= 300) return rej(new Error(x.statusCode + ' ' + d.slice(0, 200))); res(JSON.parse(d || 'null')); }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const m = await call('GET', 'pt_masterDB') || {};
  const patch = {}, undo = {}, sum = {};
  Object.entries(m).forEach(([id, r]) => {
    if (!r || r.mergedInto) return;
    const was = r.cuttingRequired;
    const asBool = was === false || /^(no|false|n)$/i.test(String(was)) ? false : was === true || /^(yes|true|y)$/i.test(String(was)) ? true : was;
    const rule = cutRule(r);
    const want = rule === null ? asBool : rule;
    if (want === was || typeof want !== 'boolean') return;
    const k = 'pt_masterDB/' + id + '/cuttingRequired';
    patch[k] = want; undo[k] = was === undefined ? null : was;
    const t = (want ? 'cut     ' : 'no cut  ') + (r.articleType || '?') + ' | ' + (r.subtype || '?') + ' (was ' + String(was) + ')';
    sum[t] = (sum[t] || 0) + 1;
  });
  Object.keys(sum).sort().forEach(k => console.log(String(sum[k]).padStart(5) + '  ' + k));
  console.log('SKUs changing: ' + Object.keys(patch).length);
  if (process.env.WRITE !== '1') { console.log('dry run — nothing written'); return; }
  const now = new Date().toISOString(), who = 'ravi@thefabricrush.com (cut rule, by Claude)';
  const undoFile = pathm.join(__dirname, 'cut-rule-undo-' + now.replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(undoFile, JSON.stringify(undo, null, 1));
  const keys = Object.keys(patch);
  for (let i = 0; i < keys.length; i += 500) { const sl = {}; keys.slice(i, i + 500).forEach(k => { sl[k] = patch[k]; }); await call('PATCH', '', sl); }
  await call('PATCH', '', { ['pt_audit/' + now.slice(0, 7) + '/' + Date.now().toString(36) + 'cut']: { at: now, by: who, tab: 'fix', kind: 'patch', n: keys.length, paths: keys.slice(0, 50),
    note: "Ravi's cutting rule (quilt cut; embroidery, plain tablecloth, plain runner, border napkin no cut). Undo: " + pathm.basename(undoFile) } });
  console.log('WRITTEN · undo file ' + undoFile);
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
