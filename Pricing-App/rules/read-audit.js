/* WHICH TAB READS WHICH NODE — worked out from the app's own code, not from memory.
 *
 * Per-node read rules are only safe if this map is right: a node a tab needs and the rules refuse is a
 * screen that will not open. So it is derived mechanically:
 *   1. every top-level function in the Replenish app, and the database nodes it reads directly;
 *   2. the call graph between them, closed transitively — a tab that calls ensureHr() also reads what
 *      ensureVo() reads, because ensureHr calls it;
 *   3. the tab → entry-function table the app itself dispatches on, plus what runs at sign-in.
 * It OVER-approximates on purpose (a call that might happen counts as one that does): the failure it
 * allows is a read somebody did not strictly need; the failure it prevents is a screen that breaks.
 * Readers it cannot trace to any tab or to sign-in are LISTED, never assumed harmless.
 *
 *   node read-audit.js            prints the map and writes read-map.json beside this file
 */
const fs = require('fs'), pathm = require('path');
const APP = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const src = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');
const mod = src.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
/* A NAME IN A COMMENT IS NOT A CALL.
 *
 * The call graph is found by looking for known function names in a body, and a body is every line
 * from one top-level function to the next — so a comment block sitting between two functions belongs
 * to the one above it. `esc` is followed by a note explaining that poQtyMap and INDIA_STOCK "load
 * through ensureRepl/ensureProd", and that alone made esc a caller of ensureProd. esc is used by
 * every render function in the app, so the moment ensureProd read anything, EVERY tab appeared to
 * read it — which is how a Replenishment column came within one deploy of handing the fifteen
 * vendor-portal logins the order book.
 *
 * Whole-line comments are dropped here, before anything is read out of the text: only lines that are
 * nothing but comment. A trailing `// note` after real code is left alone, because erring towards
 * MORE reads is the safe direction and unpicking a // inside a string or a URL is not worth it.
 * Nothing executable is removed, so a real call can never be lost this way — and the lines are
 * blanked rather than deleted, because the handler names are built from their numbers. */
const lines = mod.split('\n').map(l => (/^\s*(?:\/\/|\/?\*)/.test(l) ? '' : l));

/* ---- 1. top-level functions, handlers and the sign-in callback, each with its body ---- */
const starts = [];
lines.forEach((l, i) => {
  let m = l.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
    || l.match(/^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/);
  if (m) return void starts.push({ name: m[1], at: i });
  if (/^onAuthStateChanged\(auth/.test(l)) return void starts.push({ name: '@boot', at: i });
  m = l.match(/^\$\('([\w]+)'\)\.(onclick|onchange|oninput)\s*=/); if (m) return void starts.push({ name: '@' + m[1] + '.' + m[2], at: i });
  m = l.match(/^\$\('([\w]+)'\)\.addEventListener\(/); if (m) starts.push({ name: '@' + m[1] + '.listener' + i, at: i });
});
const fns = {};
starts.forEach((s, k) => { const end = k + 1 < starts.length ? starts[k + 1].at : lines.length;
  fns[s.name] = (fns[s.name] || '') + '\n' + lines.slice(s.at, end).join('\n'); });
const names = Object.keys(fns).filter(n => n[0] !== '@');

/* ---- 2. direct reads, and calls ---- */
const READ = /\b(?:ptGet|skip)\(\s*[`'"](pt_[A-Za-z]+)|\bptLoad\(\s*'\w+'\s*,\s*'(pt_[A-Za-z]+)/g;
const direct = {}, calls = {}, dynamic = [];
const nameRe = new RegExp('\\b(' + names.map(n => n.replace(/\$/g, '\\$')).join('|') + ')\\b', 'g');   // a NAME, called or passed (.then(ensureOrd))
Object.keys(fns).forEach(n => {
  const body = fns[n]; direct[n] = new Set(); calls[n] = new Set(); let m;
  READ.lastIndex = 0; while ((m = READ.exec(body))) direct[n].add(m[1] || m[2]);
  if (n !== 'ptGet' && /\bptGet\(\s*(?![`'"])[A-Za-z_$]/.test(body)) dynamic.push(n);
  nameRe.lastIndex = 0; while ((m = nameRe.exec(body))) if (m[1] !== n) calls[n].add(m[1]);
});
/* THE TAB SWITCHER IS NOT A CALL INTO EVERY TAB. showTab names every loader in the app, so anything that
 * calls it — sign-in, a "go to the order" link inside a pane — would appear to read the whole database.
 * It opens ONE tab, and that tab's own entry accounts for what it reads. */
const SWITCHER = Object.keys(fns).find(n => fns[n].indexOf("if (which === 'hr') ensureHr();") >= 0) || 'showTab';
const closure = {};
const reach = n => { if (closure[n]) return closure[n]; const out = new Set(direct[n] || []); closure[n] = out;
  (calls[n] || []).forEach(c => { if (c !== SWITCHER) reach(c).forEach(x => out.add(x)); }); return out; };

/* ---- 3. the tab table ---- */
const tabFn = {};
lines.forEach(l => { const m = l.match(/^\s*if \(which === '([a-zA-Z]+)'(?: \|\| which === '([a-zA-Z]+)')?\)\s*(.*)$/); if (!m) return;
  const fnsHere = (m[3].match(nameRe) || []);
  [m[1], m[2]].filter(Boolean).forEach(t => fnsHere.forEach(f => (tabFn[t] = tabFn[t] || new Set()).add(f))); });
/* A BUTTON BELONGS TO THE TAB WHOSE PANE IT SITS IN. The dispatch table only says what OPENING a tab reads;
 * Vendor Orders' Reserve button loads the whole order book, and nothing above knew that belonged to vord.
 * showTab carries the tab → pane map; an element's pane is the last pane opened before it in the page. */
const paneOfTab = {}; { const m = mod.match(/const panes = \{([^}]+)\}/); if (m) m[1].split(',').forEach(kv => { const p = kv.match(/(\w+)\s*:\s*'(pane\w+)'/); if (p) paneOfTab[p[1]] = p[2]; }); }
if (Object.keys(paneOfTab).length < 20) throw new Error('the tab → pane map in showTab was not found; buttons cannot be given to tabs');
const tabsOfPane = {}; Object.keys(paneOfTab).forEach(t => (tabsOfPane[paneOfTab[t]] = tabsOfPane[paneOfTab[t]] || []).push(t));
const paneStarts = []; { const re = /<div id="(pane[A-Za-z]+)"/g; let m; while ((m = re.exec(src))) paneStarts.push({ pane: m[1], at: m.index }); }
const firstScript = src.indexOf('<script type="module">');
const paneOfId = id => { const i = src.indexOf('id="' + id + '"'); if (i < 0 || i > firstScript) return ''; let p = ''; paneStarts.forEach(x => { if (x.at < i) p = x.pane; }); return p; };
const handlerTabs = {};
Object.keys(fns).filter(n => n[0] === '@' && n !== '@boot').forEach(h => { const id = h.slice(1).split('.')[0]; const tabs = tabsOfPane[paneOfId(id)] || [];
  handlerTabs[h] = tabs; tabs.forEach(t => (tabFn[t] = tabFn[t] || new Set()).add(h)); });

/* tab keys the Access screen grants that are views of another tab's loader
 *
 * 'ptapp' USED TO BE LISTED HERE, as a view of 'prod'. It is not one: nothing in this page or in
 * Sellora names that key, showTab has no pane for it, and the four accounts that hold it — and hold
 * NOTHING else — see an empty screen. The guess cost nothing while In Production read no RTDB node;
 * the moment it read the order book, those four would have been handed every order, every sales
 * order and all three registers for a screen they cannot open. A key no screen uses reads nothing.
 * If it turns out to mean something, it grants nothing today either, so nothing is lost by waiting
 * to be told what it is. */
[['shopprod', 'ord'], ['qcalt', 'qc'], ['qcret', 'qc']].forEach(([t, parent]) => {
  (tabFn[parent] || []).forEach(f => (tabFn[t] = tabFn[t] || new Set()).add(f)); });

const out = { generatedFrom: APP, tabs: {}, signIn: [], nodes: {}, dynamic, handlersWithNoTab: Object.keys(handlerTabs).filter(h => !handlerTabs[h].length && (reach(h).size > 0)) };
Object.keys(tabFn).sort().forEach(t => { const nodes = new Set(); tabFn[t].forEach(f => reach(f).forEach(x => nodes.add(x)));
  out.tabs[t] = { entry: [...tabFn[t]], nodes: [...nodes].sort() }; });
const bootNodes = fns['@boot'] ? reach('@boot') : new Set();
out.signIn = [...bootNodes].sort();

/* ---- per node: who reaches it, and which readers nothing accounts for ---- */
const covered = new Set(); const walk = f => { if (covered.has(f) || f === SWITCHER) return; covered.add(f); (calls[f] || []).forEach(walk); };
Object.values(tabFn).forEach(s => s.forEach(walk)); if (fns['@boot']) walk('@boot');
const allNodes = [...new Set([].concat(...Object.values(direct).map(x => [...x])))].sort();
allNodes.forEach(n => { const readers = Object.keys(direct).filter(f => direct[f].has(n));
  out.nodes[n] = { tabs: Object.keys(out.tabs).filter(t => out.tabs[t].nodes.indexOf(n) >= 0), signIn: bootNodes.has(n),
    readers, untraced: readers.filter(f => !covered.has(f)) }; });
fs.writeFileSync(pathm.join(__dirname, 'read-map.json'), JSON.stringify(out, null, 2));

console.log('functions ' + names.length + ' · tabs ' + Object.keys(out.tabs).length + ' · nodes read ' + allNodes.length);
console.log('\nREAD AT SIGN-IN, by whoever signs in: ' + (out.signIn.map(x => x.replace('pt_', '')).join(', ') || '—'));
console.log('\n' + 'node'.padEnd(18) + 'tabs whose code can reach it'.padEnd(74) + 'readers traced to NO tab and not to sign-in');
allNodes.forEach(n => { const r = out.nodes[n];
  console.log(n.replace('pt_', '').padEnd(18) + ((r.signIn ? '[sign-in] ' : '') + r.tabs.join(' ')).slice(0, 72).padEnd(74) + r.untraced.join(', ').slice(0, 100)); });
console.log('\nnode names worked out at run time — checked by hand: ' + dynamic.join(', '));

console.log('\nhandlers that read something but sit in no tab\'s pane — checked by hand: ' + (out.handlersWithNoTab.join(', ') || 'none'));
