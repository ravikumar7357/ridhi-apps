/* THE ERP'S PARTS, SCREENS AND JOBS, read from its code (autobank, 2 Nov 2026; from the 26 Oct catalogue tool,
 * meera/tools/bank-build/extract.js). Only what the screens themselves say is kept: a part's label, its element id, and
 * the help text written on it (its hover note, its box hint). Nothing about how a feature works is worked out here.
 *   parts    every button, tab, column, box, option and hover note, with its screen and where it is (file:line)
 *   screens  every screen (pane) of the page
 *   jobs     every function that saves (writes to the database) — a new one is a new job
 *   const { read } = require('./catalog.cjs'); read(<Replenish-App folder>) → { parts, screens, jobs } */
const fs = require('fs'), path = require('path');
const { tabOfFile } = require('./bank-build/extract-tabs.js');

const clean = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\$\{[^}]*\}/g, '…').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
const PANE = { Repl: 'repl', Article: 'article', Target: 'target', Follow: 'follow', Top: 'top', India: 'india', Shopify: 'shopify', Prod: 'prod', Pack: 'pack', Att: 'att', Pmdb: 'pmdb', Mst: 'mst', Pbase: 'pbase', Pcut: 'pcut', Ppress: 'ppress', Qc: 'qc', Ord: 'ord', So: 'so', Vord: 'vord', Vreq: 'vreq', Rfd: 'rfd', Vend: 'vend', Vlog: 'vlog', Cx: 'cx', Palloc: 'palloc', Fgi: 'fgi', Fba: 'fba', Fab: 'fab', Acc: 'acc', Rep: 'rep', Pa: 'pa', Ka: 'ka', Hr: 'hr', Shop: 'shop', Adj: 'adj', Flow: 'flow', Gdesk: 'gdesk', Dash: 'dash' };
/* the calls that write to the database (core/history.js; the Firestore SDK; the Shopify notes) */
const WRITES = /\b(ptPut|ptPatch|ptCas|ptDelete|setDoc|addDoc|deleteDoc|saveShopMeta)\s*\(/;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => (x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]));
const attr = (a, n) => (String(a || '').match(new RegExp('\\b' + n + '="([^"]*)"')) || [])[1] || '';

function read(app) {
  const parts = [], seen = new Set(), screens = [], jobs = [];
  const add = (kind, label, tab, at, id, help) => {
    label = clean(label).slice(0, 90);
    if (label.length < 2 || !/[a-zऀ-ॿ]/i.test(label)) return;
    const k = kind + '|' + tab + '|' + label.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    help = clean(help).slice(0, 200);
    parts.push({ k, kind, label, tab, id: id || '', help: help && help.toLowerCase() !== label.toLowerCase() ? help : '', at });
  };
  const src = path.join(app, 'src');
  const files = [path.join(src, 'index.html'), ...walk(path.join(src, 'app')).filter(f => f.endsWith('.js') && !/core[\\/](guide|meera)/.test(f))];
  for (const f of files) {
    const rel = path.relative(src, f).replace(/\\/g, '/');
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/), html = f.endsWith('.html');
    let pane = '', fn = '';
    lines.forEach((ln, i) => {
      const at = rel + ':' + (i + 1);
      if (html) { const m = ln.match(/id="pane([A-Z][A-Za-z]+)"/); if (m) { pane = PANE[m[1]] || m[1].toLowerCase(); screens.push({ tab: pane, pane: 'pane' + m[1], at }); } }
      else { const m = ln.match(/^\s*(?:async\s+)?function\s+([\w$]+)\s*\(/); if (m) fn = m[1]; if (fn && WRITES.test(ln) && !jobs.some(j => j.fn === fn)) jobs.push({ fn, tab: tabOfFile(rel), at }); }
      const tab = html ? pane : tabOfFile(rel);
      for (const m of ln.matchAll(/<button\b([^>]*)>([^]*?)<\/button>/g)) {
        const tabBtn = /\bsegbtn\b|role="tab"|data-[\w-]*tab=/.test(m[1]);
        add(tabBtn ? 'tab' : 'button', m[2], tab, at, attr(m[1], 'id'), attr(m[1], 'title'));
      }
      for (const m of ln.matchAll(/<th\b([^>]*)>([^]*?)<\/th>/g)) add('column', m[2], tab, at, attr(m[1], 'id'), attr(m[1], 'title'));
      for (const m of ln.matchAll(/<(input|textarea|select)\b([^>]*)>/g)) { const ph = attr(m[2], 'placeholder'); if (ph) add('box', ph, tab, at, attr(m[2], 'id'), attr(m[2], 'title')); }
      for (const m of ln.matchAll(/<label\b([^>]*)>([^]*?)<\/label>/g)) add('box', m[2], tab, at, attr(m[1], 'for'), attr(m[1], 'title'));
      for (const m of ln.matchAll(/<option\b[^>]*>([^<]{2,70})<\/option>/g)) add('option', m[1], tab, at);
      for (const m of ln.matchAll(/\btitle="([^"]{6,140})"/g)) add('note', m[1], tab, at);
    });
  }
  return { parts, screens, jobs };
}
module.exports = { read, clean };
if (require.main === module) {
  const r = read(process.argv[2] || path.join(__dirname, '..', '..', 'Replenish-App'));
  console.log(`parts ${r.parts.length} · screens ${r.screens.length} · jobs that save ${r.jobs.length}`);
}
