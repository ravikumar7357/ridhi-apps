/* ================= THE DOOR BETWEEN THE ERP AND MEERA (v2 rebuild, 29 Oct 2026) =================
 *
 * Meera used to reach straight into the ERP's own variables (ME, TAB_NOW, showTab, auth, PTE.emp, mobOn, spIsVendor).
 * Now she asks here, and only here — so the ERP can change inside without breaking her, and she can live in her own
 * file (meera.js, plan Phase 1) without knowing how the ERP is built. This file is the ONLY Meera file the ERP keeps.
 *
 *   ERP_MEERA.user()          { email, admin, tabs, vendor }        who is signed in, and what they may open
 *   ERP_MEERA.signedIn()      true once someone is signed in
 *   ERP_MEERA.token()         a promise of their sign-in token (for her router), or null
 *   ERP_MEERA.screen()        the screen open now ('pbase', 'shop' …)
 *   ERP_MEERA.openScreen(t)   open a screen, by the ERP's own rules
 *   ERP_MEERA.people()        the karigars' and staff names (to recognise "Ramesh ko …")
 *   ERP_MEERA.words()         the ERP's own names — SKUs, brands, colours, sizes, parties, every master list (v2, Phase 2):
 *                             only so her spelling step leaves them as typed; she never shows or sends them
 *   ERP_MEERA.phone()         true on the phone layout
 *   ERP_MEERA.on(event, fn)   'screen' — a screen just opened (the ERP calls meeraBridgeEmit('screen', tab))
 *
 * Every answer here is wrapped: if the ERP is half-loaded or something inside it throws, Meera gets a safe default
 * (nobody signed in, no screen, no names) and carries on — and the ERP never sees her errors.
 */
const MEERA_EVENTS = {};
function meeraSafe(fn, otherwise) {
  try { const v = fn(); return v === undefined ? otherwise : v; } catch (e) { return otherwise; }
}
function meeraBridgeEmit(event, ...args) {
  (MEERA_EVENTS[event] || []).forEach(fn => { try { fn(...args); } catch (e) { try { console.warn('Meera:', e); } catch (x) { /* no console */ } } });
}
/* declared in the page (Meera's files inside the page see it, also where there is no real window, e.g. the test
 * suites), and handed to the window for meera.js, which lives in a file of its own */
const ERP_MEERA = {
  v: 2,
  user: () => meeraSafe(() => ({
    email: (ME && ME.email) || '',
    admin: !!(ME && ME.admin),
    tabs: ME && Array.isArray(ME.tabs) ? ME.tabs.slice() : [],
    vendor: typeof spIsVendor === 'function' && !!spIsVendor(),
  }), { email: '', admin: false, tabs: [], vendor: false }),
  signedIn: () => meeraSafe(() => !!(auth && auth.currentUser), false),
  token: () => { try { return auth && auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null); } catch (e) { return Promise.resolve(null); } },
  screen: () => meeraSafe(() => TAB_NOW, '') || '',
  openScreen: tab => meeraSafe(() => { showTab(tab); return true; }, false),
  people: () => meeraSafe(() => (PTE.emp || []).map(e => String(e[1] || '').trim()).filter(Boolean), []),
  phone: () => meeraSafe(() => typeof mobOn === 'function' && !!mobOn(), false),
  words: () => meeraSafe(() => {
    const out = new Set(), add = v => { if (typeof v === 'string' && v.length < 80) out.add(v); };
    Object.values((PTG && PTG.masters) || {}).forEach(list => Object.values(list || {}).forEach(e => { if (e && typeof e === 'object') ['name', 'desc', 'code', 'label'].forEach(k => add(e[k])); else add(e); }));
    ((PTG && PTG.mdb) || []).forEach(r => { if (r) ['sku', 'brand', 'color', 'colour'].forEach(k => add(r[k])); });
    return [...out];
  }, []),
  on: (event, fn) => { (MEERA_EVENTS[event] = MEERA_EVENTS[event] || []).push(fn); },
  switchOn: name => meeraSafe(() => meeraOn(name), false),   // her switches, for meera.js
};
try { window.ERP_MEERA = ERP_MEERA; } catch (e) { /* no window: the page itself still has it */ }

/* MEERA READS THE ERP'S OWN DATA — READ ONLY (v2 rebuild, Phase 7, 2 Nov 2026; used only with switch "data").
 *
 * Only what this page already holds in memory, worked out by the ERP's own rules (ordLines, ordWaitingAt, ordKarigarsOf,
 * ordEvents, fgiOf, ORD_PIPE_STALE_DAYS). Nothing here reads the database, writes anything or opens a screen by itself:
 * data a screen has not read yet is "not loaded" (she asks the person to open that screen), never fetched — the quota
 * fix stands. Each answer says which screen it comes from and when that screen last read it. A screen the account
 * cannot open answers "not allowed", with no data. open() is called only from a button the person presses. */
const MEERA_DATA_SCREENS = { ord: 'Order Console', pbase: 'Job Work Register', fgi: 'Finished Goods', qc: 'Quality Control' };
const mdMay = tab => (typeof mobMay === 'function' ? !!mobMay(tab) : true);
const mdNum = v => Number(v) || 0;
const mdLeft = r => mdNum(r.issuePieces) - mdNum(r.receivedPieces) - mdNum(r.rejectionPieces);
const mdTime = ms => (ms ? new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const mdToday = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear(); };
const mdDayMs = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
/* where an answer comes from: { tab, name, asOf } — or why there is none */
function mdFrom(tab, loaded, asOf) {
  if (!mdMay(tab)) return { tab, name: MEERA_DATA_SCREENS[tab] || tab, denied: true };
  if (!loaded) return { tab, name: MEERA_DATA_SCREENS[tab] || tab, notLoaded: true };
  return { tab, name: MEERA_DATA_SCREENS[tab] || tab, asOf: asOf || '' };
}
const mdOrdFrom = () => mdFrom('ord', typeof PTG !== 'undefined' && Array.isArray(PTG.ob) && typeof ordLines === 'function', typeof PTG !== 'undefined' ? mdTime(PTG.at) : '');
const mdBaseFrom = () => mdFrom('pbase', typeof PT !== 'undefined' && Array.isArray(PT.base), typeof PT !== 'undefined' && PT.at ? PT.at.base : '');
const mdOrdLines = () => { try { return ordLines() || []; } catch (e) { return []; } };
ERP_MEERA.data = {
  /** the order numbers on the Order Console (for finding the one meant) */
  orders: () => meeraSafe(() => { const f = mdOrdFrom(); return f.denied || f.notLoaded ? [] : [...new Set(mdOrdLines().map(r => r.orderNo))]; }, []),
  /** one order: each line's stage (the Order Console's "Waiting at"), who holds its pieces, its last work, late or not */
  findOrder: no => meeraSafe(() => {
    const from = mdOrdFrom();
    if (from.denied || from.notLoaded) return { from };
    const NO = String(no || '').toUpperCase(), rows = mdOrdLines().filter(r => r.orderNo === NO);
    if (!rows.length) return { from, none: true };
    const ev = typeof ordEvents === 'function' ? ordEvents() : null, last = ev && ev.last ? ev.last.get(NO) || null : null;
    const placed = typeof ptDtMs === 'function' ? ptDtMs(rows[0].orderDate) || 0 : 0;
    const idle = Math.floor((Date.now() - (last ? last.ms : placed || Date.now())) / 864e5);
    const open = rows.some(r => r.open);
    return { from, order: { orderNo: NO, lines: rows.map(r => ({ sku: r.sku, qty: mdNum(r.qty), at: typeof ordWaitingAt === 'function' ? ordWaitingAt(r) : '' })),
      pcs: rows.reduce((a, r) => a + mdNum(r.qty), 0), open,
      karigars: typeof ordKarigarsOf === 'function' ? [...ordKarigarsOf(NO).entries()].sort((a, b) => b[1] - a[1]) : [],
      last: last ? { ms: last.ms, by: last.by || '', kind: last.kind || '' } : null, idle, late: open && idle >= (typeof ORD_PIPE_STALE_DAYS !== 'undefined' ? ORD_PIPE_STALE_DAYS : 5) } };
  }, { from: { tab: 'ord', notLoaded: true } }),
  /** the karigars this page knows (the employee list and the Job Work rows) */
  karigars: () => meeraSafe(() => {
    /* the names only (she already has them, to keep names out of questions): what each holds needs Job Work */
    const s = new Set();
    ((typeof PTE !== 'undefined' && PTE.emp) || []).forEach(e => { const n = String((e && e[1]) || '').trim(); if (n) s.add(n); });
    ((typeof PT !== 'undefined' && PT.base) || []).forEach(r => { const n = String((r && r.empName) || '').trim(); if (n) s.add(n); });
    return [...s];
  }, []),
  /** what one karigar holds: pieces given and not yet back, entry by entry */
  karigarHolding: name => meeraSafe(() => {
    const from = mdBaseFrom();
    if (from.denied || from.notLoaded) return { from };
    const rows = PT.base.filter(r => r && String(r.empName || '').trim() === name && mdLeft(r) > 0);
    return { from, name, pieces: rows.reduce((a, r) => a + mdLeft(r), 0),
      rows: rows.map(r => ({ orderNo: r.orderNo || '', sku: r.sku || '', pcs: mdLeft(r), given: String(r.issueDate || '').slice(0, 10) })).sort((a, b) => b.pcs - a.pcs) };
  }, { from: { tab: 'pbase', notLoaded: true } }),
  /** the SKU codes the Master Database has (for finding the one meant) */
  skus: () => meeraSafe(() => ((typeof PTG !== 'undefined' && PTG.mdb) || []).map(r => String((r && r.sku) || '').toUpperCase()).filter(Boolean), []),
  /** one SKU in the India store (Finished Goods' own count) */
  skuStock: sku => meeraSafe(() => {
    const from = mdFrom('fgi', typeof FGI !== 'undefined' && Array.isArray(FGI.rows) && typeof fgiOf === 'function', typeof FGI !== 'undefined' ? FGI.at : '');
    if (from.denied || from.notLoaded) return { from };
    const s = fgiOf(sku);
    return { from, sku: String(sku).toUpperCase(), current: mdNum(s.current), pending: mdNum(s.pending) };
  }, { from: { tab: 'fgi', notLoaded: true } }),
  /** what is waiting at one stage, by the Order Console's "Waiting at" (Vendor, Cutting, Issue, Karigar, QC) */
  waitingAt: stage => meeraSafe(() => {
    const from = mdOrdFrom();
    if (from.denied || from.notLoaded) return { from };
    const lines = [];
    mdOrdLines().forEach(r => {
      if (!r.open || typeof ordWaitingAt !== 'function') return;
      const at = String(ordWaitingAt(r) || ''), m = at.match(new RegExp('(?:^|· )' + stage + ' — ([\\d,]+)'));
      if (m) lines.push({ orderNo: r.orderNo, sku: r.sku, pcs: Number(m[1].replace(/,/g, '')) || 0 });
    });
    return { from, stage, lines: lines.sort((a, b) => b.pcs - a.pcs), pcs: lines.reduce((a, x) => a + x.pcs, 0) };
  }, { from: { tab: 'ord', notLoaded: true } }),
  /** today so far: pieces issued and received (Job Work Register), pieces passed in QC (Quality Control) */
  today: () => meeraSafe(() => {
    const base = mdBaseFrom(), day = mdToday(), from0 = mdDayMs(), out = { base, qc: mdFrom('qc', typeof QC !== 'undefined' && Array.isArray(QC.checks), typeof QC !== 'undefined' ? QC.at : '') };
    if (!base.denied && !base.notLoaded) {
      const iss = PT.base.filter(r => r && String(r.issueDate || '').slice(0, 10) === day);
      out.issued = { pcs: iss.reduce((a, r) => a + mdNum(r.issuePieces), 0), entries: iss.length };
      let rec = 0, n = 0;
      PT.base.forEach(r => { (typeof repRecvParts === 'function' ? repRecvParts(r) : []).forEach(p => { if (p.ms >= from0) { rec += mdNum(p.pcs); n++; } }); });
      out.received = { pcs: rec, entries: n };
    }
    if (!out.qc.denied && !out.qc.notLoaded) {
      const ok = QC.checks.filter(c => c && c.baseId && String(c.date || '').slice(0, 10) === day);
      out.passed = { pcs: ok.reduce((a, c) => a + mdNum(c.ok), 0), checks: ok.length };
    }
    return out;
  }, { base: { tab: 'pbase', notLoaded: true }, qc: { tab: 'qc', notLoaded: true } }),
  /** late orders, by the Order Console's own rule: not done, and no work for ORD_PIPE_STALE_DAYS days or more */
  late: () => meeraSafe(() => {
    const from = mdOrdFrom();
    if (from.denied || from.notLoaded) return { from };
    const ev = typeof ordEvents === 'function' ? ordEvents() : null, by = new Map(), days = typeof ORD_PIPE_STALE_DAYS !== 'undefined' ? ORD_PIPE_STALE_DAYS : 5;
    mdOrdLines().forEach(r => { if (!r.open) return; if (!by.has(r.orderNo)) by.set(r.orderNo, []); by.get(r.orderNo).push(r); });
    const out = [];
    by.forEach((rows, no) => {
      const last = ev && ev.last ? ev.last.get(no) : null, placed = typeof ptDtMs === 'function' ? ptDtMs(rows[0].orderDate) || 0 : 0;
      const idle = Math.floor((Date.now() - (last ? last.ms : placed || Date.now())) / 864e5);
      if (idle >= days) out.push({ orderNo: no, idle, at: typeof ordWaitingAt === 'function' ? ordWaitingAt(rows[0]) : '' });
    });
    return { from, days, orders: out.sort((a, b) => b.idle - a.idle) };
  }, { from: { tab: 'ord', notLoaded: true } }),
  /** the person pressed the answer's button: the screen, on the line (an order's journey, a karigar's rows, a SKU) */
  open: (kind, key) => meeraSafe(() => {
    if (kind === 'order' && mdMay('ord') && typeof ordJourney === 'function') { ordJourney(key); return true; }
    if (kind === 'karigar' && mdMay('pbase') && typeof mobSearchOpen === 'function') { mobSearchOpen('kar|' + key); return true; }
    if (kind === 'sku' && typeof mobSkuSheet === 'function') { mobSkuSheet(key); return true; }
    if (MEERA_DATA_SCREENS[kind] && mdMay(kind)) { showTab(kind); return true; }
    return false;
  }, false),
};

/* ================= MEERA'S SWITCHES (v2 rebuild, 29 Oct 2026) =================
 *
 * Plan section 2, rule 4: every new Meera behaviour ships switched OFF, is turned on for testing, and can be turned
 * off again in a minute. One list, here; nothing in it changes anything until a later phase reads it.
 *
 *   meeraOn('lazy')                         is the switch on for this person?
 *
 * How a switch is turned on, first match wins:
 *   1. this browser only:  localStorage 'meera.<name>' = '1' (or '0' to force it off)   — for testing on one computer
 *   2. this visit only:    the page address ends ?meera=<name>[,<name>…]                  — for the test link
 *   3. everyone:           the default below (change it, push — "live karo" first)
 * Later (plan Phase 5) the router can hold the defaults, so a switch flips without a push.
 */
/* ALL OF MEERA'S NEW FEATURES AT ONCE (Ravi, 3 Nov): lazy, spell, design, screenfirst (with the named-screen rule),
 * hindinames, data and learn follow this one line. To turn them ALL off for everyone: set it to false and push to main
 * (or edit this line on GitHub and commit) — the site redeploys in ~5 minutes and Meera is as she was before. Server
 * search (server / serveruse) and autobank are NOT part of it and stay off. */
const MEERA_V2_ON = false;
const MEERA_SWITCHES = {
  /* Phase 1 — Meera loaded as her own file (meera.js) after the ERP is ready, instead of inside the page */
  lazy: MEERA_V2_ON,
  /* Phase 2 — she reads spelling mistakes ("karigr", "maaal", "pakking") and says how she read the question.
   * Works in meera.js only, so it needs "lazy" on too: ?meera=lazy,spell */
  spell: MEERA_V2_ON,
  /* Phase 3 — her new look: answer card, source label, English / हिंदी switch, phone sheets, her own sealed box
   * (Shadow DOM). meera.js only, so it needs "lazy" on too: ?meera=lazy,design */
  design: MEERA_V2_ON,
  /* Phase 4 — learning from staff: missed / not sure / 👎 / spellings go (cleaned, role only) to her router for an
   * admin; "Meera's learning" page for admins. meera.js only: ?meera=lazy,learn */
  learn: MEERA_V2_ON,
  /* Phase 5 — her search on her router: "server" side by side (she answers as before; the router's answer is only
   * compared), "serveruse" answers from the router (no 1.9 MB download; a small list per screen when it is down). */
  server: false,
  serveruse: false,
  /* answer from the open screen first (Ravi, 2 Nov): its own answers before every other screen's; another screen's
   * answer says which screen it is for. Works in the page and in meera.js: ?meera=screenfirst */
  screenfirst: MEERA_V2_ON,
  /* her answers keep up with the screens by themselves (Ravi, 2 Nov): on every push, meera/tools/autobank.cjs adds an
   * answer for a new part (its label and help text only), follows a renamed one, takes out a removed one; a new screen or
   * job becomes a draft on the admin page. Off: it only reports what it would do. Read by the build, not the browser. */
  autobank: false,
  /* a button or column name typed in Hindi letters ("डमी एक्सपोर्ट" → Dummy export), by its sounds (Ravi, 2 Nov).
   * Works in the page and in meera.js: ?meera=hindinames */
  hindinames: MEERA_V2_ON,
  /* Phase 7 — answers from the ERP's own figures (where is an order, what a karigar holds, a SKU's stock, what waits at
   * a stage, today's counts, late orders), READ ONLY from this page's memory (ERP_MEERA.data). meera.js only: ?meera=lazy,data */
  data: MEERA_V2_ON,
};
function meeraOn(name) {
  try {
    const v = localStorage.getItem('meera.' + name);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch (e) { /* storage blocked: the defaults */ }
  try {
    const u = new URLSearchParams(location.search).get('meera');
    if (u && u.split(',').map(s => s.trim()).includes(name)) return true;
  } catch (e) { /* no address: the defaults */ }
  return !!MEERA_SWITCHES[name];
}

/* WHERE MEERA LIVES (Phase 1). Switch "lazy" off — today: her files are part of this page and start with it.
 * On: they stay quiet here, and once the page has loaded and the computer is idle, meera.js (her own file, built from
 * the same files — meera/client/build.cjs) is fetched and starts her. If it cannot be fetched she is simply not there;
 * the ERP is not affected either way. */
function meeraHere() { return !meeraOn('lazy'); }
function meeraLoadFile() {
  if (meeraLoadFile.done) return;
  meeraLoadFile.done = true;
  const add = src => {
    try {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onerror = () => { try { console.warn('Meera: ' + src + ' could not be loaded — the ERP carries on without her'); } catch (e) { /* no console */ } };
      document.head.appendChild(s);
    } catch (e) { /* no page: nothing to load */ }
  };
  /* which meera.<version>.js is current (a tiny file, checked every time); that file the browser keeps for good.
   * If the version cannot be read: meera.js, the same code under a plain name. */
  try {
    fetch('/meera/meera.version.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(j => add(j && /^[0-9a-f]{12}$/.test(j.v) ? '/meera/meera.' + j.v + '.js' : '/meera/meera.js'));
  } catch (e) { add('/meera/meera.js'); }
}
try {
  if (meeraOn('lazy')) {
    const go = () => (typeof requestIdleCallback === 'function' ? requestIdleCallback(meeraLoadFile, { timeout: 4000 }) : setTimeout(meeraLoadFile, 1500));
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
  }
} catch (e) { /* no page (the test suites): Meera stays in the page as before */ }
