/* MEERA WITHOUT A BROWSER — the test bench for the v2 rebuild (29 Oct 2026).
 *
 * Runs Meera's real files (the ones the ERP page joins, in the page's own order) in a sandbox with a small stand-in for
 * the page: no screen, no sign-in, no network. Her answers, walk-throughs and meaning file are read from public/guide/
 * the way the page would fetch them. Used by the baseline, the golden answers and the no-worse gate, so the same check
 * runs here and in GitHub on every push.
 *
 *   const M = await require('./harness.cjs').load({ root })   // root = the repository folder
 *   const r = await M.answer('karigar ko kaam kaise de', 'pbase')
 */
const fs = require('fs'), path = require('path'), vm = require('vm');

/* The page's own files, as tests/assemble.js would join them: Meera's, in ORDER — or, after Phase 1, whatever the
 * caller names (opts.files). */
function meeraFiles(app) {
  const order = fs.readFileSync(path.join(app, 'src/app/ORDER'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  /* the bridge (inside the ERP) and Meera's own files (meera/client/src, "@meera/…" since Phase 1) */
  return order.filter(f => /^core\/(guide|meera)|^@meera\//.test(f))
    .map(f => (f.startsWith('@meera/') ? path.join(app, '..', 'meera', 'client', 'src', f.slice(7)) : path.join(app, 'src/app', f)));
}

/* A tiny page: enough for Meera's code to start and answer; every box she looks for is simply not there. */
function fakePage(state) {
  const el = () => {
    const e = {
      style: {}, dataset: {}, children: [], childNodes: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      appendChild: c => c, removeChild() {}, insertBefore: c => c, remove() {}, setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      addEventListener() {}, removeEventListener() {}, querySelector: () => el(), querySelectorAll: () => [], closest: () => null, contains: () => false,   // a part inside a box: blank, never on screen
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }), getClientRects: () => [], focus() {}, blur() {}, click() {},
      scrollIntoView() {}, matches: () => false, isConnected: false, offsetParent: null, offsetHeight: 0, offsetWidth: 0, textContent: '', innerHTML: '', value: '',
    };
    return e;
  };
  const body = el();
  /* any box Meera makes or looks up by id: a blank one, kept, so her own buttons and box exist but show nothing */
  const ids = new Map();
  const byId = id => { if (!ids.has(id)) { const e = el(); e.id = id; ids.set(id, e); } return ids.get(id); };
  const document = {
    body, documentElement: el(), head: el(), hidden: false, readyState: 'complete',
    createElement: el, createElementNS: el, createTextNode: () => el(), getElementById: id => byId(id), querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, elementFromPoint: () => null, activeElement: null,
  };
  const store = new Map();
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), key: i => [...store.keys()][i] || null, get length() { return store.size; } };
  return { document, localStorage, el, byId };
}

async function load(opts = {}) {
  const root = opts.root || path.join(__dirname, '..', '..');
  const app = path.join(root, 'Replenish-App');
  const guideDir = path.join(app, 'public', 'guide');
  const state = { tab: opts.tab || 'shop', fetched: [] };
  const page = fakePage(state);
  const timers = [];
  /* a fixed clock (29 Oct 2026, 10:30 IST), so "what time is it" answers the same every run */
  const FIXED = Date.parse('2026-10-29T05:00:00Z');
  class FixedDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(FIXED); }
    static now() { return FIXED; }
    /* the same words on any computer (GitHub's runs on another time zone and another Node) */
    toLocaleTimeString() { return '10:30 am'; }
    toLocaleDateString() { return 'Thursday, 29 October 2026'; }
  }
  const sandbox = {
    console, Math, Date: FixedDate, JSON, Promise, Map, Set, WeakMap, WeakSet, Array, Object, String, Number, Boolean, RegExp, Error, TypeError, Symbol,
    Int8Array, Uint8Array, Uint32Array, Int32Array, Float32Array, Float64Array, DataView, ArrayBuffer, TextDecoder, TextEncoder, Intl, parseFloat, parseInt, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent, escape, unescape, structuredClone,
    document: page.document, localStorage: page.localStorage, sessionStorage: page.localStorage,
    navigator: { userAgent: 'node', language: 'en-IN', clipboard: {}, connection: null, maxTouchPoints: 0 },
    location: { href: 'https://local.test/', hash: '', search: '', pathname: '/', origin: 'https://local.test', reload() {} },
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', bottom: '0px', getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    requestAnimationFrame: fn => 0, cancelAnimationFrame() {}, requestIdleCallback: () => 0,
    MutationObserver: class { observe() {} disconnect() {} }, ResizeObserver: class { observe() {} disconnect() {} }, IntersectionObserver: class { observe() {} disconnect() {} },
    performance: { now: () => Date.now() },
    /* timers never fire: the bench answers one question at a time and does not wait for walks or nudges */
    setTimeout: (fn, ms) => { const t = { fn, ms, unref() {} }; timers.push(t); return t; }, clearTimeout() {},
    setInterval: () => ({ unref() {} }), clearInterval() {},
    /* her files, read from public/guide the way the page would fetch them */
    fetch: async (url) => {
      const u = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      state.fetched.push(u);
      const f = path.join(app, 'public', u.replace(/^\//, ''));
      if (!u.startsWith('/guide/') || !fs.existsSync(f)) return { ok: false, status: 404, json: async () => null, arrayBuffer: async () => null, text: async () => '' };
      const buf = fs.readFileSync(f);
      return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8'),
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    },
    /* what the ERP itself gives Meera today (Phase 1 replaces these with the bridge) */
    ME: { email: 'bench@local', admin: true, tabs: [] }, PTE: { emp: [] }, auth: undefined,
    showTab: t => { state.tab = t; },
    $: id => page.byId(id), esc: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {}; sandbox.scrollBy = () => {}; sandbox.scrollTo = () => {};
  sandbox.open = () => null; sandbox.alert = () => {}; sandbox.confirm = () => false; sandbox.prompt = () => null;
  const ctx = vm.createContext(sandbox);
  /* the screen open now: the page keeps it in TAB_NOW */
  vm.runInContext('var TAB_NOW = "' + state.tab + '";', ctx);
  const run = code => vm.runInContext(code, ctx);
  /* opts.bundle (Phase 1): Meera as her own file — the ERP side is only its bridge (core/meera-bridge.js, which reads
   * the ERP's ME, TAB_NOW, showTab… given above); then public/meera/meera.js, which brings its own $ and esc and talks
   * to the ERP through the bridge alone. Her answers come out through window.MEERA. */
  if (opts.bundle) {
    delete sandbox.$; delete sandbox.esc;
    const bridge = path.join(app, 'src', 'app', 'core', 'meera-bridge.js'), file = path.join(app, 'public', 'meera', 'meera.js');
    vm.runInContext(fs.readFileSync(bridge, 'utf8'), ctx, { filename: 'meera-bridge.js' });
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: 'https://local.test/meera/meera.js' });
    if (!ctx.MEERA) throw new Error('meera.js did not start');
    await ctx.MEERA.ready();
    const tidy = r => ({ text: String(r.html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(),
      acts: (r.acts || []).map(a => a.t + ':' + (a.id || a.tab || '')), bank: r.bank || null, miss: r.miss || null, off: !!r.off });
    return {
      ctx, run, state, bundle: true,
      setTab(t) { state.tab = t; run('TAB_NOW = ' + JSON.stringify(t)); },
      async answer(q, tab) { if (tab) this.setTab(tab); return tidy(await ctx.MEERA.answer(q)); },
      find(q, tab) { if (tab) this.setTab(tab); return ctx.MEERA.find(q); },
    };
  }
  const files = opts.files || meeraFiles(app);
  for (const f of files) {
    const code = fs.readFileSync(f, 'utf8');
    try { vm.runInContext(code, ctx, { filename: path.relative(root, f) }); }
    catch (e) { throw new Error('Meera did not start: ' + path.relative(root, f) + ': ' + e.message); }
  }
  await run('gaBankLoad()');
  await run('gaWordsLoad()');
  run('gaSemIndex()');
  return {
    ctx, run, state,
    setTab(t) { state.tab = t; run('TAB_NOW = ' + JSON.stringify(t)); },
    /** Meera's whole answer to one question, on one screen: the text (no markup), her buttons, and which bank answer. */
    async answer(q, tab) {
      if (tab) this.setTab(tab);
      ctx.__q = q;
      const r = await run('gaAnswer(__q)');
      const plain = String(r.html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      return { text: plain, acts: (r.acts || []).map(a => a.t + ':' + (a.id || a.tab || '')), bank: r.bank || null, miss: r.miss || null, off: !!r.off };
    },
    /** The bank search alone: the top answers with their scores (for the eval scores). */
    find(q, tab) {
      if (tab) this.setTab(tab);
      ctx.__q = q;
      return run('(() => { const r = gaRead(__q); return gaBankFind(r.means, r.words, __q).map(h => ({ id: h.e.id, s: h.s })); })()');
    },
  };
}
module.exports = { load, meeraFiles };
