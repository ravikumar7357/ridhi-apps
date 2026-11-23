/* R-ONE ON ERP DATA — the build step that switches a page from Firebase to ERP data (Supabase).
 *
 * THE SWITCH is one file: shared/erp-data/mode.json   { "data": "supabase" }   or   { "data": "firebase" }
 *   "firebase" → the pages are deployed exactly as they are (the old way).  "supabase" → this step changes the DEPLOYED COPY
 *   only (src/ and public/ are never edited):
 *     1. layer.js goes first on the page (reads + saves of the registers → ERP data, live updates every 5 s)
 *     2. the Firestore import: getDoc / getDocs / onSnapshot / setDoc / addDoc / deleteDoc / updateDoc → ERP data
 *        (config/* — the API keys — stays in Firebase: read AND saved there; keys are never copied into Supabase)
 *     3. the factory ERP: the live Firebase connection is not opened, and the old mirror to ERP TEST is off
 *   WAY BACK: set "firebase" and push — the next release is the Firebase ERP again (the server copies ERP data's saves
 *   back to Firebase, so nothing is lost).
 *
 * Mode of the page: on main → 'live' (everything works); on any other branch (preview/…) → 'preview' (saves go to ERP data,
 * but nothing that changes the outside world — MCF parcels, Shopify, mails, login changes — leaves the test link).
 *
 * Used by Replenish-App/tests/build-dist.js (factory ERP) and by the Sellora workflow:
 *   node shared/erp-data/build.js sellora Pricing-App/public/index.html      (rewrites that file — in CI only)
 * The build STOPS if any change cannot be made exactly: a page half on Firebase and half on ERP data is worse than none. */
const fs = require('fs'), path = require('path');

const SB = { url: 'https://xkpktnsdmpkwaingvdbd.supabase.co', key: 'sb_publishable_niq2DDjeCaqJl3_ccv0vtQ_BS8bqQ2Q' };   // publishable key, made for browsers

function mode() {
  const f = path.join(__dirname, 'mode.json');
  const m = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { data: 'firebase' };
  if (m.data !== 'supabase' && m.data !== 'firebase') throw new Error('shared/erp-data/mode.json: "data" must be "supabase" or "firebase"');
  return m.data;
}
const isLive = () => process.env.GITHUB_REF === 'refs/heads/main';

function must(text, find, repl, count, label) {
  let n = 0;
  const re = find instanceof RegExp ? find : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const out = text.replace(re, (...m) => { n++; return typeof repl === 'function' ? repl(...m) : repl.replace(/\$(\d)/g, (_, i) => (m[Number(i)] == null ? '' : m[Number(i)])); });
  if (count != null && n !== count) throw new Error(`ERP data build — ${label}: expected ${count} change(s), made ${n}. The page changed; update shared/erp-data/build.js.`);
  return out;
}

/* ---- Firestore → ERP data (in the page's own module, where the Firestore names live) ---- */
const FS_HELPERS = `/* R1 ON ERP DATA: Firestore → ERP data (shared/erp-data/build.js) */
const __r1Tok = async () => (typeof auth !== 'undefined' && auth && auth.currentUser) ? await auth.currentUser.getIdToken() : '';
const __r1IsKeyDoc = ref => String(ref && ref.path || '').split('/')[0] === 'config';
const __r1Plain = v => { if (v === null || v === undefined) return null; if (v instanceof Date) return v.toISOString(); if (Array.isArray(v)) return v.map(__r1Plain);
  if (typeof v === 'object') { if (typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (e) { return null; } }
    if (v._methodName === 'deleteField') return null;
    const n = v.constructor && v.constructor.name; if (v._methodName || (n && n !== 'Object')) return new Date().toISOString();
    const o = {}; for (const k of Object.keys(v)) o[k] = __r1Plain(v[k]); return o; }
  return v; };
const __r1Leaves = (o, pre, out, t) => { for (const k of Object.keys(o)) { const v = o[k], p = pre + '/' + k;
  if (v && typeof v === 'object' && !Array.isArray(v) && !v._methodName && !(v.constructor && v.constructor.name !== 'Object') && Object.keys(v).length) __r1Leaves(v, p, out, t);
  else out.push({ k: 'patch', p, v: __r1Plain(v), t }); } return out; };
async function __r1FsSave(changes) {
  await window.__R1.sbSave(changes, null, await __r1Tok()).catch(e => { if (/permission denied|not an ERP sign-in|only an admin/.test(String(e && e.message))) e.code = 'permission-denied'; throw e; });
}
async function __r1Rpc(fn, body) {
  const r = await window.__R1.rpc(fn, body, await __r1Tok(), window.__R1.origFetch).catch(e => { if (/permission denied|not an ERP sign-in/.test(String(e && e.message))) e.code = 'permission-denied'; throw e; });
  window.__R1.reads++; return r;
}
const __r1Ts = s => { const d = new Date(s); return { toDate: () => new Date(d), toMillis: () => d.getTime(), seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0, toJSON: () => s, toString: () => s, valueOf: () => d.getTime() }; };
const __r1Doc = (ref, v) => { const out = v == null ? undefined : JSON.parse(JSON.stringify(v));
  if (out && typeof out === 'object') for (const f of ['at', 'dataAt', 'saved', 'updatedAt']) if (typeof out[f] === 'string' && /^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d(\\.\\d+)?Z$/.test(out[f])) out[f] = __r1Ts(out[f]);
  return { id: ref.id, ref, exists: () => v != null, data: () => out, get: f => (out || {})[f] }; };
const __r1Field = (o, f) => String(f).split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const __r1Cmp = (a, b) => { const v = x => (x && typeof x.toMillis === 'function') ? x.toMillis() : x; a = v(a); b = v(b); return a === b ? 0 : a === undefined || a === null ? -1 : b === undefined || b === null ? 1 : a < b ? -1 : 1; };
const __r1NewRef = col => { const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 12); return { id, path: String(col.path || col.id) + '/' + id, parent: col }; };`;

function fsShim(names) {
  const has = n => names.includes(n), now = 'new Date().toISOString()';
  const L = [FS_HELPERS];
  if (has('getDoc')) L.push(`const getDoc = async ref => __r1IsKeyDoc(ref) ? __real_getDoc(ref) : __r1Doc(ref, await __r1Rpc('fs_get', { p_coll: ref.parent.id, p_id: ref.id }));`);
  if (has('query')) L.push('const query = (col, ...cs) => ({ __sbq: true, col, cs, type: "query" });');
  if (has('orderBy')) L.push('const orderBy = (f, dir) => ({ __ob: String(f), dir: dir === "desc" ? -1 : 1 });');
  if (has('limit')) L.push('const limit = n => ({ __lim: Number(n) });');
  if (has('where')) L.push('const where = (f, op, v) => ({ __wf: String(f), op, v });');
  if (has('getDocs') || has('getDocsFromServer')) L.push(`const __r1GetDocs = async q => { const col = q && q.__sbq ? q.col : q, cs = (q && q.__sbq ? q.cs : []) || [];
  const coll = String(col.path || col.id); if (coll === 'config' && !(q && q.__sbq)) return ${has('getDocs') ? '__real_getDocs(q)' : '__real_getDocsFromServer(q)'};
  const list = await __r1Rpc('fs_list', { p_coll: coll }) || [];
  let docs = list.map(x => __r1Doc({ id: x.id, path: coll + '/' + x.id, parent: col }, x.data));
  for (const c of cs) if (c && c.__wf) docs = docs.filter(d => { const a = __r1Field(d.data(), c.__wf), b = c.v;
    switch (c.op) { case '==': return __r1Cmp(a, b) === 0; case '!=': return __r1Cmp(a, b) !== 0; case '<': return __r1Cmp(a, b) < 0; case '<=': return __r1Cmp(a, b) <= 0;
      case '>': return __r1Cmp(a, b) > 0; case '>=': return __r1Cmp(a, b) >= 0; case 'in': return (b || []).some(x => __r1Cmp(a, x) === 0);
      case 'array-contains': return Array.isArray(a) && a.some(x => __r1Cmp(x, b) === 0); default: return true; } });
  const obs = cs.filter(c => c && c.__ob);
  if (obs.length) docs.sort((x, y) => { for (const o of obs) { const r = o.__ob === '__name__' ? __r1Cmp(x.id, y.id) : __r1Cmp(__r1Field(x.data(), o.__ob), __r1Field(y.data(), o.__ob)); if (r) return r * o.dir; } return 0; });
  const lim = cs.find(c => c && c.__lim); if (lim) docs = docs.slice(0, lim.__lim);
  return { docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) }; };`);
  if (has('getDocs')) L.push('const getDocs = __r1GetDocs;');
  if (has('getDocsFromServer')) L.push('const getDocsFromServer = __r1GetDocs;');
  /* 23 Nov: refused (no rights) → stop asking, as Firestore's own listener stops after a refusal (it asked every 15 s for ever) */
  if (has('onSnapshot')) L.push(`const onSnapshot = (ref, next, err) => { let off = false, t = null; const run = () => getDoc(ref).then(s => { if (!off) next(s); }).catch(e => { if (off) return; if (e && e.code === 'permission-denied') { off = true; if (t) clearInterval(t); } if (typeof err === 'function') err(e); });
  run(); t = setInterval(run, 15000); if (off) clearInterval(t); return () => { off = true; clearInterval(t); }; };   /* asked again every 15 s */`);
  /* saves: to ERP data; config/* (API keys) to Firebase as before */
  if (has('setDoc')) L.push(`const setDoc = async (ref, data, opts) => { if (__r1IsKeyDoc(ref)) return __real_setDoc(ref, data, opts); const t = ${now}, b = 'fs/' + ref.path;
  await __r1FsSave(opts && opts.merge ? __r1Leaves(data || {}, b, [], t) : [{ k: 'put', p: b, v: __r1Plain(data), t }]); };`);
  if (has('addDoc')) L.push(`const addDoc = async (col, data) => { const ref = ${has('doc') ? 'doc(col)' : '__r1NewRef(col)'}; if (__r1IsKeyDoc(ref)) return __real_addDoc(col, data);
  await __r1FsSave([{ k: 'put', p: 'fs/' + ref.path, v: __r1Plain(data), t: ${now} }]); return ref; };`);
  if (has('deleteDoc')) L.push(`const deleteDoc = async ref => __r1IsKeyDoc(ref) ? __real_deleteDoc(ref) : __r1FsSave([{ k: 'delete', p: 'fs/' + ref.path, v: null, t: ${now} }]);`);
  if (has('updateDoc')) L.push(`const updateDoc = async (ref, data) => { if (__r1IsKeyDoc(ref)) return __real_updateDoc(ref, data); const t = ${now};
  await __r1FsSave(Object.keys(data || {}).map(k => ({ k: 'patch', p: 'fs/' + ref.path + '/' + k.split('.').join('/'), v: __r1Plain(data[k]), t }))); };`);
  return L.join('\n');
}
const FS_TAKEN = ['getDoc', 'getDocs', 'getDocsFromServer', 'onSnapshot', 'query', 'orderBy', 'limit', 'where', 'setDoc', 'addDoc', 'deleteDoc', 'updateDoc'];
const FS_NOT_SUPPORTED = ['writeBatch', 'runTransaction'];

function firestore(html, label) {
  return must(html, /import\s*\{([^}]*)\}\s*from\s*"(https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-firestore\.js)";/g, (all, names, url) => {
    const list = names.split(',').map(s => s.trim()).filter(Boolean);
    const bad = list.filter(n => FS_NOT_SUPPORTED.includes(n));
    if (bad.length) throw new Error(`ERP data build — ${label}: the page uses Firestore ${bad.join(', ')}, which ERP data does not do yet.`);
    const kept = list.map(n => (FS_TAKEN.includes(n) ? `${n} as __real_${n}` : n));
    return `import { ${kept.join(', ')} }\n  from "${url}";\n${fsShim(list.filter(n => FS_TAKEN.includes(n)).concat(list.includes('doc') ? ['doc'] : []))}`;
  }, 1, label + ' Firestore import');
}

function layer(html, app, sha) {
  const at = html.search(/<title[\s>]/i);
  if (at < 0 || at > 20000) throw new Error(`ERP data build — ${app}: no <title> near the top of the page.`);
  if (/<script\b/i.test(html.slice(0, at))) throw new Error(`ERP data build — ${app}: a script runs before <title>; the layer must run first.`);
  const cfg = { url: SB.url, key: SB.key, mode: isLive() ? 'live' : 'preview', app, sha: (process.env.GITHUB_SHA || 'local').slice(0, 7) || sha };
  const js = fs.readFileSync(path.join(__dirname, 'layer.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  return html.slice(0, at) + `<script>window.__R1_DATA = ${JSON.stringify(cfg)};</script>\n<script>${js}</script>\n` + html.slice(at);
}

/* the factory ERP */
function erp(html) {
  html = layer(html, 'erp');
  html = firestore(html, 'factory ERP');
  /* no live Firebase connection (its library is not loaded; every screen reads plainly, which the layer answers) */
  html = must(html, "import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js')", "Promise.reject(new Error('R1 on ERP data: no live Firebase connection'))", null, 'factory ERP no live Firebase connection');
  html = must(html, 'const ptLiveable = node => typeof app', 'const ptLiveable = node => false && typeof app', 1, 'factory ERP no live-copy attempt');
  /* the old mirror (every save also sent to ERP TEST) is off: saves go straight to ERP data */
  html = must(html, /(const MIR = \{\r?\n\s*on: )/, '$1false && ', 1, 'factory ERP old mirror off');
  return html;
}
/* Sellora */
function sellora(html) {
  html = layer(html, 'sellora');
  html = firestore(html, 'Sellora');
  return html;
}

module.exports = { mode, isLive, erp, sellora };

if (require.main === module) {
  const [, , app, file] = process.argv;
  if (mode() !== 'supabase') { console.log('ERP data mode: firebase — ' + (file || '') + ' left as it is'); process.exit(0); }
  if (!['erp', 'sellora'].includes(app) || !file) { console.error('use: node shared/erp-data/build.js erp|sellora <index.html>'); process.exit(1); }
  const out = (app === 'erp' ? erp : sellora)(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, out);
  console.log(`ERP data mode: supabase (${isLive() ? 'live' : 'preview'}) — ${file} switched`);
}
