/* The walk-throughs (26 Oct): the writers' done-<group>-walks.json → public/guide/meera-walks.json, checked first.
 *   node tools/walks.js <catalog folder> [--check]        (MEERA_APP = the checkout to check against and write into)
 * Checks: every #id lit is in the app; every step has a known screen and English + Hindi; a saving job has its Save
 * step; every answer named exists in the bank; every save function in the app is in a walk or said to need none. */
const fs = require('fs'), path = require('path');
const CAT = process.argv[2], CHECK = process.argv.includes('--check');
const APP = process.env.MEERA_APP || 'C:/AMAZON/Amazon Inventory/Amazon Inventory/Replenish-App';
const TABS = new Set(['', 'dash', 'repl', 'article', 'target', 'follow', 'top', 'india', 'shopify', 'prod', 'pack', 'att', 'pmdb', 'mst', 'pbase', 'pcut', 'ppress', 'qc', 'ord', 'so', 'vord', 'vreq', 'rfd', 'vend', 'vlog', 'cx', 'palloc', 'fgi', 'fba', 'fab', 'acc', 'rep', 'pa', 'ka', 'hr', 'shop', 'adj', 'flow', 'gdesk']);
/* a new walk that takes the place of one of the eight: the qccheck one starts on a button the QC screen now hides */
const REPLACES = { 'w-production-qc-check': 'qccheck', 'w-production-jw-correction': 'correction' };
/* walks to a screen taken off the menu (RFD Requirements, 15 Oct): left out */
const DROP = /^w-flow-rfd-(approve|refuse|mark-sent|store-send)$/;
/* answers written after the walk was (Vendor sent, 26 Oct) */
const FROM_ADD = { 'w-masters-vend-sent': ['vm-vend-vsent', 'vm-vend-vsent-strike', 'vm-vend-vsent-download'] };
const TASKS = new Set(['jobwork', 'qccheck', 'scanpack', 'courier', 'findorder', 'stockin', 'punch', 'correction']);
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]);
const src = [path.join(APP, 'src/index.html'), ...walk(path.join(APP, 'src/app')).filter(f => f.endsWith('.js'))].map(f => fs.readFileSync(f, 'utf8')).join('\n');
const ids = new Set([...src.matchAll(/\bid=\\?["']([\w-]+)\\?["']/g)].map(m => m[1]));
[...src.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)].forEach(m => ids.add(m[1]));   // made in code: el.id = 'x'
const bank = new Set(JSON.parse(fs.readFileSync(path.join(APP, 'public/guide/meera-bank.json'), 'utf8')).map(e => e.id));
const allFns = require(path.join(CAT, 'workflows.json')).map(w => w.fn);

const out = [], problems = [], seen = new Set(), placed = new Set();
const p = (w, m) => problems.push(`${w}: ${m}`);
for (const f of fs.readdirSync(CAT).filter(f => /^done-.*-walks\.json$/.test(f))) {
  const g = JSON.parse(fs.readFileSync(path.join(CAT, f), 'utf8'));
  (g.none || []).forEach(x => placed.add(x.fn));
  for (const w of g.walks || []) {
    (w.fns || []).forEach(fn => placed.add(fn));
    if (DROP.test(w.id || '')) continue;
    if (!w.id || seen.has(w.id)) { p(f, 'missing or repeated id ' + w.id); continue; }
    seen.add(w.id);
    const from = [...new Set((w.from || []).concat(FROM_ADD[w.id] || []))].filter(b => bank.has(b));
    (w.from || []).filter(b => !bank.has(b)).forEach(b => p(w.id, 'no bank answer ' + b));
    if (w.existing) {
      if (!TASKS.has(w.existing)) p(w.id, 'unknown existing task ' + w.existing);
      out.push({ id: w.id, existing: w.existing, from });
      continue;
    }
    if (!w.title || !w.title.en || !w.title.hi) p(w.id, 'title needs en and hi');
    if (!Array.isArray(w.steps) || w.steps.length < 2) { p(w.id, 'fewer than 2 steps'); continue; }
    let bad = 0;
    const steps = w.steps.map((s, i) => {
      if (!TABS.has(s.tab || '')) { p(w.id, `step ${i + 1}: unknown screen ${s.tab}`); bad++; }
      if (!s.en || !s.hi) { p(w.id, `step ${i + 1}: needs en and hi`); bad++; }
      if (s.wait && !['click', 'value'].includes(s.wait)) { p(w.id, `step ${i + 1}: wait ${s.wait}`); bad++; }
      for (const sel of [s.sel, s.skip].filter(Boolean)) {
        for (const m of sel.replace(/\[[^\]]*\]/g, '').matchAll(/#([\w-]+)/g)) if (!ids.has(m[1]) && !(/^ptf_/.test(m[1]) && src.includes("'ptf_' +"))) { // the shared edit form names its boxes 'ptf_' + field
          p(w.id, `step ${i + 1}: #${m[1]} is not in the app`); bad++; }
      }
      if (s.wait && !s.sel) { p(w.id, `step ${i + 1}: waits but lights nothing`); bad++; }
      const o = { tab: s.tab || '', en: s.en, hi: s.hi };
      if (s.hg) o.hg = s.hg;
      for (const k of ['sel', 'wait', 'skip']) if (s[k]) o[k] = s[k];
      if (s.save) o.save = true;
      return o;
    });
    if (bad) continue;   // a walk with a wrong step is left out whole, never half-shown
    if (!steps.some(s => s.save) && (w.fns || []).length) p(w.id, 'note: no Save step (kept)');
    out.push({ id: w.id, ...((REPLACES[w.id] || TASKS.has(w.replaces)) ? { replaces: REPLACES[w.id] || w.replaces } : {}), title: w.title, tab: w.tab || steps[0].tab, ...(w.admin ? { admin: true } : {}), from, steps });
  }
}
const missing = allFns.filter(fn => !placed.has(fn));
console.log(`walks: ${out.filter(w => !w.existing).length} new + ${out.filter(w => w.existing).length} pointing at the 8 existing · steps: ${out.reduce((a, w) => a + (w.steps || []).length, 0)}`);
console.log(`save functions: ${allFns.length} · in a walk or "none": ${allFns.length - missing.length}` + (missing.length ? ` · not placed: ${missing.join(', ')}` : ''));
console.log(`problems: ${problems.filter(x => !/note:/.test(x)).length}` + (problems.length ? '\n  ' + problems.slice(0, 80).join('\n  ') : ''));
if (!CHECK) {
  const OUT = path.join(APP, 'public/guide/meera-walks.json');
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('wrote', OUT, Math.round(fs.statSync(OUT).size / 1024) + ' KB');
}
