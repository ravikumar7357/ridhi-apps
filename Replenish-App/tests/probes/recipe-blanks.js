/* How many SKU fields are blank while their recipe says something — what "fill the blanks" would write.
 * Uses the app's own recipeApplyPlan (fill part only). Read-only unless run with --write, which PATCHes exactly
 * those blank fields through the same field tidying recipeApplyRun does (2026-09-25, the ruffle permanent fix). */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const DB = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const WRITE = process.argv.includes('--write');
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const req = (method, p, body) => new Promise((res, rej) => { const r = https.request(DB + '/' + p + '.json', { method, headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' } },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(new Error(d.slice(0, 200))); } }); }); r.on('error', rej); if (body) r.write(JSON.stringify(body)); r.end(); });
  const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
  const cutAt = src.indexOf('/* ---- real data ---- */');
  const head = src.slice(0, cutAt).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')));
  const A = new Function('require', 'process', 'global', head + '\n;return { A, els, ME, NET };')(require, process, global);
  const [mdb, masters] = await Promise.all([req('GET', 'pt_masterDB'), req('GET', 'pt_masters')]);
  const app = A.A;
  const rows = Object.entries(mdb || {}).map(([k, r]) => Object.assign({ _key: k }, app.mdbYnFix(r)));
  app.setPTG(Object.assign(app.PTG(), { mdb: rows, masters: masters || {} }));
  const plan = app.recipeApplyPlan(rows);
  const by = {}; plan.fill.forEach(x => { by[x.field] = (by[x.field] || 0) + 1; });
  console.log('blank fields a recipe fills:', plan.fill.length, 'on', new Set(plan.fill.map(x => x.sku)).size, 'SKUs', JSON.stringify(by));
  console.log('(values that DIFFER from the recipe, left alone:', plan.change.length + ')');
  const arts = {}; plan.fill.forEach(x => { const m = rows.find(r => r.sku === x.sku); const k = m.articleType + ' | ' + m.subtype; arts[k] = (arts[k] || 0) + 1; });
  Object.entries(arts).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, n]) => console.log('  ' + String(n).padStart(5) + '  ' + k));
  if (!WRITE) return;
  /* Same writer the app uses: recipeApplyRun, fill only, through the harness's network fake pointed at nothing —
   * so build the PATCH from its NET.calls and send that. */
  A.NET.on = true; A.NET.calls.length = 0; A.ME.admin = true;
  const err = await app.recipeApplyRun({ fill: plan.fill, change: [] });
  if (err) throw new Error(err);
  const patch = Object.assign({}, ...A.NET.calls.filter(c => c.method === 'PATCH').map(c => c.body));
  const keys = Object.keys(patch);
  if (!keys.every(k => /^pt_masterDB\/[^/]+\/[A-Za-z]+$/.test(k))) throw new Error('unexpected path in patch');
  const backup = {}; keys.forEach(k => { const [, key, f] = k.split('/'); backup[k] = (mdb[key] || {})[f] === undefined ? null : mdb[key][f]; });
  const bf = pathm.join(__dirname, 'recipe-blanks-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(bf, JSON.stringify(backup));
  const out = {}; keys.forEach(k => { out[k.slice('pt_masterDB/'.length)] = patch[k]; });
  const r = await req('PATCH', 'pt_masterDB', out);
  console.log('WROTE', keys.length, 'fields · backup of the previous (blank) values:', bf, r && r.error ? 'ERROR ' + r.error : 'ok');
})().catch(e => { console.error('FAILED', e.message || e); process.exit(1); });
