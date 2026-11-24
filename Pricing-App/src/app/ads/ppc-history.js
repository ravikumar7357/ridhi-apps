/* ================= ADS · PPC HISTORY: who changed what in the ads from Sellora, from which device, and when (20 Nov 2026) =================
 * Screen: PPC History (tab 'ppch', pane panePpch; core/nav.js calls ensurePpch when it opens). Whoever has Search Term
 * Analysis sees it (TAB_INHERIT ppch: 'st'): it reads the same documents, gated on 'st' in firestore.rules.
 *
 * THE RECORD. Every change made from Sellora's ads screens (Search Term Analysis, Placement) is one review item in
 * Firestore adsActions/{id} (ST_RL in search-terms.js). Each item keeps a `trail`, one step per move:
 *   { t, act, email, uid, person, dev: { id, label, name } }   (+ batch on a download, note on a failed apply)
 * written by staItem / plxItem ('added'), staRlMove (every status move, inside its transaction), staRedownload
 * ('downloaded-again') and staUndoAdd ('taken-back'); the helpers are here (ppchEvent, ppchMoveEvent) so both screens write
 * the same thing. Items from before the trail are read from their old fields (ppchTrailOf), with the device "not recorded".
 * Changes made in the Amazon Ads console itself are not in this record.
 *
 * WHO. The signed-in email and Firebase uid on every step. A shared login (PPCH_SHARED) also names the person: the first
 * change on a device asks "Who is making this change?" (ppchNeedPerson), kept on that device (localStorage selloraPerson)
 * and changed here. Personal logins: the name from the email (staWho).
 * WHICH DEVICE. A random id made once per browser (selloraDeviceId), a label read from the browser ("Windows · Chrome 131")
 * and an optional name given here (selloraDeviceName).
 *
 * Layout, the same as Search Term Analysis (its classes and helpers): the bar (brand, filter, range, Filters, Export) and the
 * data line; the summary strip; the table card (By change / Every step, the change-type chips, rows per page), the table,
 * the pager. By change: a row opens to its steps as a timeline. Data: adsActions where at ≥ the range start (or this
 * browser's copy when the shared list is refused), with the live review list (ST_RL) folded in.
 * Main functions: ppchEvent, ppchMoveEvent, ppchTrailOf, ppchDevLabel, ppchNeedPerson, ensurePpch, ppchLoad, ppchFilter,
 * ppchStepsOf, ppchSums, renderPpch, ppchCsvLines. */

// Shared logins, by the start of the email: on these the person is asked for (once per device).
const PPCH_SHARED = ['it@'];
const PPCH_K = { dev: 'selloraDeviceId', name: 'selloraDeviceName', person: 'selloraPerson' };
const PPCH_NONAME = 'not saved: on a shared login Sellora needs the name of the person making the change';
// An old field's step counts only when it is this many ms older than the item's first trail step (no step counted twice).
const PPCH_GAP = 5000;
// What each step did, as the page says it.
const PPCH_VERB = {
  added: 'Added to the review list', approved: 'Approved', unapproved: 'Un-approved', restored: 'Put back on the list',
  removed: 'Removed', 'taken-back': 'Taken back', 'cancelled-download': 'Download cancelled', downloaded: 'Downloaded in a bulk file',
  'downloaded-again': 'Downloaded again', 'seen-at-amazon': 'Seen at Amazon', 'apply-started': 'Apply started',
  'dry-run': 'Tried at Amazon (dry run)', applied: 'Applied at Amazon', 'apply-failed': 'Apply failed', undone: 'Undone',
};
// Steps made by Amazon's own record, not a person.
const PPCH_SYS = new Set(['seen-at-amazon']);
// The change types (chips and the filter): key, label, the chip colour Search Term Analysis already has.
const PPCH_KINDS = [['bid', 'Bid', 'reduce'], ['neg', 'Negative', 'neg'], ['pause', 'Pause', 'pause'], ['kw', 'New keyword', 'exact'], ['plc', 'Placement', 'review']];
const PPCH_REACHED = ['done', 'applied', 'undone'];
const PPCH_WAITING = ['review', 'approved', 'exported', 'applying', 'failed'];
// Formatters made once.
const PPCH_DT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const PPCH_DTY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const PPCH_THIS_YEAR = new Date().getFullYear();
const ppchWhen = t => t ? (new Date(t).getFullYear() === PPCH_THIS_YEAR ? PPCH_DT : PPCH_DTY).format(t) : '';
const ppchP2 = n => (n < 10 ? '0' : '') + n;
const ppchStamp = t => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${ppchP2(d.getMonth() + 1)}-${ppchP2(d.getDate())} ${ppchP2(d.getHours())}:${ppchP2(d.getMinutes())}`; };

/* ---------- this device, this person ---------- */
// localStorage, with a copy in memory when the browser refuses it (private window): the id then lasts the session.
const PPCH_MEM = {};
function ppchGet(k) {
  try { const v = localStorage.getItem(k); if (v != null) return v; } catch (e) { /* no storage */ }
  return PPCH_MEM[k] || '';
}
function ppchPut(k, v) {
  try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); delete PPCH_MEM[k]; } catch (e) { PPCH_MEM[k] = v || ''; }
}
function ppchDeviceId() {
  let id = ppchGet(PPCH_K.dev);
  if (!id) { id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); ppchPut(PPCH_K.dev, id); }
  return id;
}
// "Windows · Chrome 131": the system and the browser with its main version, from navigator.userAgentData where the browser
// gives it, else read from the user-agent text. nav: for the tests.
const PPCH_UA_OS = [[/Windows NT|Windows/, 'Windows'], [/iPhone/, 'iPhone'], [/iPad/, 'iPad'], [/Android/, 'Android'], [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/, 'macOS'], [/Linux/, 'Linux']];
const PPCH_UA_BR = [[/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'], [/OPR\/(\d+)/, 'Opera'], [/SamsungBrowser\/(\d+)/, 'Samsung Internet'], [/FxiOS\/(\d+)/, 'Firefox'],
  [/Firefox\/(\d+)/, 'Firefox'], [/CriOS\/(\d+)/, 'Chrome'], [/Chrome\/(\d+)/, 'Chrome'], [/Version\/(\d+)[\d.]*.*Safari/, 'Safari']];
let PPCH_LABEL = '';
function ppchDevLabel(nav) {
  if (!nav && PPCH_LABEL) return PPCH_LABEL;
  const n = nav || (typeof navigator !== 'undefined' ? navigator : {}) || {};
  const ua = String(n.userAgent || '');
  const d = n.userAgentData;
  let os = '', br = '';
  if (d && Array.isArray(d.brands) && d.brands.length) {
    os = String(d.platform || '').replace(/^Chrom(e|ium) OS$/i, 'ChromeOS');
    const b = d.brands.find(x => !/not.?a.?brand|chromium/i.test(x.brand)) || d.brands.find(x => /chromium/i.test(x.brand));
    if (b) br = String(b.brand).replace(/^(Google|Microsoft) /, '') + (b.version ? ' ' + String(b.version).split('.')[0] : '');
  }
  if (!os) { const m = PPCH_UA_OS.find(([re]) => re.test(ua)); os = m ? m[1] : ''; }
  if (!br) {
    for (const [re, name] of PPCH_UA_BR) { const m = re.exec(ua); if (m) { br = name + ' ' + m[1]; break; } }
  }
  const label = [os, br].filter(Boolean).join(' · ') || 'Unknown device';
  if (!nav) PPCH_LABEL = label;
  return label;
}
const ppchDevice = () => ({ id: ppchDeviceId(), label: ppchDevLabel(), name: ppchGet(PPCH_K.name).trim() });
const ppchMe = () => String((typeof ME !== 'undefined' && ME && ME.email) || '').toLowerCase();
const ppchShared = email => { const e = String(email || '').toLowerCase(); return !!e && PPCH_SHARED.some(p => e.startsWith(p)); };
// The person behind this session's changes: the name given on this device (shared login), else the name in the email.
const ppchPerson = () => (ppchShared(ppchMe()) ? ppchGet(PPCH_K.person).trim() : staWho(ppchMe()));

/* ---------- the steps ---------- */
// One step by this session, now. extra: more fields (batch, note); empty ones are left out (Firestore refuses undefined).
function ppchEvent(act, extra) {
  const ev = { t: Date.now(), act };
  if (PPCH_SYS.has(act)) Object.assign(ev, { email: '', uid: '', person: 'Amazon record', dev: { id: '', label: '', name: '' }, sys: true });
  else {
    let uid = '';
    try { uid = (typeof auth !== 'undefined' && auth && auth.currentUser && auth.currentUser.uid) || ''; } catch (e) { uid = ''; }
    Object.assign(ev, { email: ppchMe(), uid: String(uid), person: ppchPerson(), dev: ppchDevice() });
  }
  if (extra) Object.keys(extra).forEach(k => { if (extra[k] != null && extra[k] !== '') ev[k] = extra[k]; });
  return ev;
}
// The act of a status move, from the status it leaves and the patch.
function ppchMoveAct(from, patch) {
  const to = patch && patch.status;
  if (to === 'approved') return from === 'applying' ? 'dry-run' : 'approved';
  if (to === 'review') return from === 'removed' ? 'restored' : 'unapproved';
  if (to === 'removed') return from === 'exported' ? 'cancelled-download' : 'removed';
  return { exported: 'downloaded', done: 'seen-at-amazon', applying: 'apply-started', applied: 'applied', failed: 'apply-failed', undone: 'undone' }[to] || 'changed';
}
// The step of one move (staRlMove). extra.act overrides what the move says; a download keeps its bulk file's id.
function ppchMoveEvent(from, patch, extra) {
  const x = Object.assign({}, extra);
  const act = x.act || ppchMoveAct(from, patch);
  delete x.act;
  if (!x.batch && patch && patch.batch) x.batch = patch.batch;
  if (act === 'apply-failed' && patch.err) x.note = String(patch.err).slice(0, 200);
  return ppchEvent(act, x);
}
// Steps this device added before the person was named (shared login, first change) get the name once it is given.
function ppchStampPerson(it) {
  const p = ppchPerson(), id = ppchDeviceId();
  if (p) (it.trail || []).forEach(e => { if (e && !e.sys && !e.person && e.dev && e.dev.id === id) e.person = p; });
}
// The steps of an item from before the trail, from its old fields; the device was not recorded then.
const PPCH_OLD_DEV = { id: '', label: 'not recorded', name: '' };
function ppchOldTrail(x) {
  const ev = (t, act, email, person, more) => (Number(t) > 0 ? Object.assign({ t: Number(t), act, email: String(email || ''), uid: '',
    person: person || staWho(email), dev: PPCH_OLD_DEV, old: true }, more || {}) : null);
  const note = String(x.note || '');
  return [
    ev(x.at, 'added', x.byEmail, x.by || staWho(x.byEmail)),
    ev(x.approvedAt, 'approved', x.approvedBy),
    ev(x.applyAt, 'apply-started', x.applyBy),
    ev(x.exportedAt, 'downloaded', x.exportedBy, '', x.batch ? { batch: x.batch } : null),
    Number(x.doneAt) > 0 ? { t: Number(x.doneAt), act: 'seen-at-amazon', email: '', uid: '', person: 'Amazon record', dev: { id: '', label: '', name: '' }, sys: true, old: true } : null,
    ev(x.appliedAt, 'applied', x.applyBy),
    ev(x.removedAt, /cancel/i.test(note) ? 'cancelled-download' : /taken back/i.test(note) ? 'taken-back' : 'removed', x.removedBy),
    ev(x.undoneAt, 'undone', x.undoneBy),
  ].filter(Boolean);
}
// Every step of an item, oldest first: its trail; for an item from before the trail, the old fields up to where its trail
// begins (an old item moved since has both, and each step is counted once).
function ppchTrailOf(x) {
  const tr = Array.isArray(x && x.trail) ? x.trail.filter(e => e && e.t) : [];
  let out = tr;
  if (!tr.some(e => e.act === 'added')) {
    const t0 = tr.length ? Math.min(...tr.map(e => e.t)) : Infinity;
    out = ppchOldTrail(x || {}).filter(e => e.t < t0 - PPCH_GAP).concat(tr);
  }
  return out.slice().sort((a, b) => a.t - b.t);
}
// The name a step is shown with, and its device.
const ppchName = e => (e && (e.person || staWho(e.email))) || '—';
const ppchDevOf = e => (!e || e.sys ? '' : e.dev ? e.dev.name || e.dev.label || '' : 'not recorded');

/* ---------- "Who is making this change?" (shared login) and "Name this device" ---------- */
let PPCH_DLG = null, PPCH_ASK = null, PPCH_NO = 0;
// Resolves when the person is known; on a shared login with no name on this device, asks once (one dialog, however many
// changes are waiting on it). A "Cancel" refuses the changes of that click (3 seconds), not each one with its own dialog.
function ppchNeedPerson() {
  if (!ppchShared(ppchMe()) || ppchGet(PPCH_K.person).trim()) return Promise.resolve();
  if (Date.now() - PPCH_NO < 3000) return Promise.reject(new Error(PPCH_NONAME));
  if (!PPCH_ASK) PPCH_ASK = new Promise((res, rej) => ppchDlgOpen('person', res, rej)).finally(() => { PPCH_ASK = null; });
  return PPCH_ASK;
}
function ppchDlgOpen(mode, res, rej) {
  const person = mode === 'person';
  PPCH_DLG = { mode, res: res || null, rej: rej || null };
  $('ppchDlgTitle').textContent = person ? 'Who is making this change?' : 'Name this device';
  $('ppchDlgSub').textContent = person ? `${ppchMe()} is a shared login. Sellora keeps your name with every change made from this device.`
    : 'Shown with every change made from this device, in place of "' + ppchDevLabel() + '".';
  $('ppchDlgLbl').textContent = person ? 'Your name' : 'Device name';
  $('ppchDlgIn').value = person ? ppchGet(PPCH_K.person) : ppchGet(PPCH_K.name);
  $('ppchDlgIn').placeholder = person ? 'For example: Ravi' : 'For example: Office PC';
  $('ppchDlgHelp').textContent = person ? 'Remembered on this device. You can change it on PPC History.'
    : 'Kept on this device only. Leave it empty for no name.';
  $('ppchDlgNote').textContent = '';
  $('ppchDlgOk').textContent = person && res ? 'Save and go on' : 'Save';
  $('ppchDlg').classList.remove('hide');
  setTimeout(() => { try { $('ppchDlgIn').focus(); } catch (e) { /* not on screen */ } }, 0);
}
function ppchDlgClose(ok) {
  const d = PPCH_DLG;
  if (!d) return;
  if (ok) {
    const v = String($('ppchDlgIn').value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (d.mode === 'person' && !v) {
      $('ppchDlgNote').innerHTML = '<span class="sta-bad">Type a name to go on.</span>';
      try { $('ppchDlgIn').focus(); } catch (e) { /* not on screen */ }
      return;
    }
    ppchPut(d.mode === 'person' ? PPCH_K.person : PPCH_K.name, v);
  }
  PPCH_DLG = null;
  $('ppchDlg').classList.add('hide');
  if (ok) { if (d.res) d.res(); } else if (d.rej) { PPCH_NO = Date.now(); d.rej(new Error(PPCH_NONAME)); }
  renderPpch();
}

/* ---------- the data ---------- */
let PPCH = { items: [], where: '', err: '', from: 0, days: 90, loadedDays: 0, at: 0, busy: false, loading: null,
  view: 'item', kind: '', pg: 0, size: 100, open: new Set() };
// The rows of the last draw, every page (the export).
let PPCH_LAST = [];
// The items of the range: adsActions where at ≥ its start, newest first; this browser's copy when the shared list is refused.
async function ppchLoad() {
  const days = PPCH.days, from = Date.now() - days * 86400000;
  try {
    const s = await getDocs(query(collection(db, 'adsActions'), where('at', '>=', from), orderBy('at', 'desc')));
    PPCH.items = s.docs.map(d => Object.assign({}, d.data(), { id: d.id }));
    PPCH.where = 'fs';
    PPCH.err = '';
  } catch (e) {
    PPCH.where = 'local';
    PPCH.err = String((e && (e.code || e.message)) || e);
    let xs = [];
    try { xs = JSON.parse(localStorage.getItem(STA_LOCAL) || '[]'); } catch (x) { xs = []; }
    PPCH.items = (Array.isArray(xs) ? xs : []).filter(x => x && (x.at || 0) >= from);
  }
  PPCH.from = from;
  PPCH.loadedDays = days;
  PPCH.at = Date.now();
}
// The items of the range, with the live review list folded in (what anyone changed since the read, within seconds).
function ppchAll() {
  const m = new Map(PPCH.items.map(x => [x.id, x]));
  if (PPCH.where && ST_RL.where === PPCH.where) ST_RL.items.forEach(x => {
    if (!x || (x.at || 0) < PPCH.from) return;
    const was = m.get(x.id);
    if (!was || (x.up || 0) >= (was.up || 0)) m.set(x.id, x);
  });
  return [...m.values()];
}
const ppchKind = x => (x.kind === 'exact' || x.kind === 'asinT' ? 'kw' : x.kind);
const ppchKindLabel = k => (PPCH_KINDS.find(y => y[0] === k) || [k, k || '—'])[1];
function ppchKindName(x) { try { return staKindName(x); } catch (e) { return ppchKindLabel(ppchKind(x)); } }
// What changes, from → to: the words the review list shows (x.what), and the two ends apart for the CSV.
function ppchChange(x) {
  let from = '', to = '';
  if (x.kind === 'bid' && x.bid) { from = x.bid.from ? staMoney(x.bid.from) : x.bid.cpc ? 'CPC ' + staMoney(x.bid.cpc) : ''; to = staMoney(x.bid.to); }
  else if (x.kind === 'plc' && x.plc) { from = plxPct(x.plc.from); to = plxPct(x.plc.to); }
  else if (x.kind === 'pause') { from = 'Enabled'; to = 'Paused'; }
  else if ((x.kind === 'exact' || x.kind === 'asinT') && x.newBid != null) to = staMoney(x.newBid);
  else if (x.kind === 'neg' && x.neg) to = x.what || '';
  return { from, to, text: x.what || (from ? from + ' → ' + to : to) };
}
const ppchStatusWord = x => ({ review: 'Waiting', approved: 'Approved', failed: 'Apply failed', applying: 'Applying', done: 'Seen at Amazon',
  applied: 'Applied', undone: 'Undone', removed: 'Removed' }[x.status] || (x.status === 'exported' ? (staNotSeen(x) ? 'Not seen at Amazon' : 'In bulk file') : x.status || ''));
const ppchChip = x => (x.status === 'applying' ? staBadge('Applying', 'info') : staRlChip(x));
// One change as the page uses it: the item, its steps, the first and last step, and the text the filter looks in.
function ppchModel(x) {
  const trail = ppchTrailOf(x);
  const last = trail[trail.length - 1] || null;
  const add = trail.find(e => e.act === 'added') || trail[0] || null;
  const label = x.neg && x.neg.type === 'na' ? String(x.term || '').toUpperCase() : x.term || x.target || '';
  const ch = ppchChange(x);
  return { x, id: x.id, brand: x.brand, kind: ppchKind(x), kindName: ppchKindName(x), label, sub: x.term && x.kind !== 'neg' ? x.target || '' : '',
    trail, last, add, t: last ? last.t : x.at || 0, ch, reached: PPCH_REACHED.includes(x.status),
    hay: [x.term, x.target, x.kw, x.cn, x.agn, x.what, ch.text, staBrandName(x.brand)].concat(trail.map(e => ppchName(e) + ' ' + (e.email || ''))).join(' ').toLowerCase() };
}

/* ---------- the filters ---------- */
// f: { brand ('ALL' / SP / CPC), q (lower case), person, act, kind, amz (only what reached Amazon) }.
const ppchStepOk = (e, f) => (!f.person || ppchName(e) === f.person) && (!f.act || e.act === f.act);
function ppchItemOk(m, f) {
  return (!f.brand || f.brand === 'ALL' || m.brand === f.brand) && (!f.q || m.hay.includes(f.q)) && (!f.kind || m.kind === f.kind)
    && (!f.amz || m.reached);
}
// By change: the changes that pass, newest step first. A person or action filter keeps a change with a step of that person
// doing that action.
function ppchFilter(models, f) {
  return models.filter(m => ppchItemOk(m, f) && (!(f.person || f.act) || m.trail.some(e => ppchStepOk(e, f)))).sort((a, b) => b.t - a.t);
}
// Every step: each step that passes (its change passing the change filters), newest first.
function ppchStepsOf(models, f) {
  const out = [];
  models.forEach(m => { if (ppchItemOk(m, f)) m.trail.forEach(e => { if (ppchStepOk(e, f) && (!PPCH.from || e.t >= PPCH.from)) out.push({ e, m }); }); });
  return out.sort((a, b) => b.e.t - a.e.t);
}
// The summary strip's numbers, over the changes shown.
function ppchSums(models) {
  const n = models.length, by = new Map();
  let steps = 0;
  models.forEach(m => m.trail.forEach(e => { steps++; if (!e.sys) { const k = ppchName(e); by.set(k, (by.get(k) || 0) + 1); } }));
  const top = [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] || null;
  const st = s => models.filter(m => m.x.status === s).length;
  return { n, steps, reached: models.filter(m => m.reached).length, waiting: models.filter(m => PPCH_WAITING.includes(m.x.status)).length,
    approved: st('approved'), exported: st('exported'), undone: st('undone'), removed: st('removed'), top: top ? { name: top[0], n: top[1] } : null };
}
function ppchFilters() {
  return { brand: $('ppchBrand').value || 'ALL', q: staLow($('ppchFilter').value), person: $('ppchFPerson').value, act: $('ppchFAct').value,
    kind: PPCH.kind, amz: !!$('ppchFAmz').checked };
}

/* ---------- drawing ---------- */
// Called when the tab opens and when the range changes: read again when the range differs or the copy is over a minute old.
// A range picked while a read is running is read right after it.
async function ensurePpch() {
  while (PPCH.loading) { renderPpch(); await PPCH.loading; }
  if (PPCH.at && PPCH.loadedDays === PPCH.days && Date.now() - PPCH.at < 60000) { renderPpch(); return; }
  PPCH.busy = true;
  renderPpch();
  PPCH.loading = ppchLoad().finally(() => { PPCH.loading = null; PPCH.busy = false; });
  await PPCH.loading;
  renderPpch();
}
function renderPpch() {
  if (!$('panePpch') || $('panePpch').classList.contains('hide')) return;
  $('ppchViewSeg').querySelectorAll('[data-v]').forEach(b => {
    b.classList.toggle('on', b.dataset.v === PPCH.view);
    b.setAttribute('aria-selected', b.dataset.v === PPCH.view ? 'true' : 'false');
  });
  $('ppchFKind').value = PPCH.kind;
  const models = ppchAll().map(ppchModel);
  ppchPeople(models);
  const f = ppchFilters();
  const nF = [f.person, f.act, f.kind, f.amz].filter(Boolean).length;
  $('ppchMoreN').textContent = nF;
  $('ppchMoreN').classList.toggle('hide', !nF);
  ppchDataLine(models.filter(m => f.brand === 'ALL' || m.brand === f.brand).length);
  const loading = PPCH.busy && !PPCH.at;
  const base = ppchFilter(models, Object.assign({}, f, { kind: '' }));
  const items = f.kind ? base.filter(m => m.kind === f.kind) : base;
  ppchSummary(loading ? null : ppchSums(items));
  if (PPCH.view === 'step') {
    const baseSteps = ppchStepsOf(models, Object.assign({}, f, { kind: '' }));
    ppchChips(baseSteps.map(s => s.m.kind));
    ppchDrawSteps(f.kind ? baseSteps.filter(s => s.m.kind === f.kind) : baseSteps, models.length, loading);
  } else {
    ppchChips(base.map(m => m.kind));
    ppchDrawItems(items, models.length, loading);
  }
}
// The person filter's choices: everyone with a step in the range (the one picked stays, even with no step now).
function ppchPeople(models) {
  const sel = $('ppchFPerson'), cur = sel.value;
  const names = new Set();
  models.forEach(m => m.trail.forEach(e => names.add(ppchName(e))));
  if (cur) names.add(cur);
  const list = [...names].filter(n => n && n !== '—').sort((a, b) => a.localeCompare(b));
  const html = '<option value="">Every person</option>' + list.map(n => `<option value="${staEsc(n)}">${staEsc(n)}</option>`).join('');
  if (sel.dataset.h !== html) { sel.innerHTML = html; sel.dataset.h = html; sel.value = cur; }
}
// The data line: what this is, where it is kept, this device and person, and what Sellora records.
function ppchDataLine(n) {
  const parts = [];
  parts.push(`Sellora's record · last ${staInt(PPCH.days)} days${PPCH.busy ? ' · loading…' : PPCH.at ? ` · <b>${staInt(n)} change${n === 1 ? '' : 's'}</b>` : ''}`);
  if (PPCH.where === 'fs') parts.push('<span class="sta-ok">✓ Shared: everyone with Search Term Analysis sees the same record</span>');
  else if (PPCH.where === 'local') parts.push(`<span class="sta-bad" title="${staEsc(PPCH.err)}">Kept in this browser only: the shared record needs its database rule (adsActions in firestore.rules)</span>`);
  const d = ppchDevice();
  parts.push(`This device: ${d.name ? `<b>${staEsc(d.name)}</b> (${staEsc(d.label)})` : staEsc(d.label)} · <button type="button" class="sta-linkbtn" data-ppchname="dev">${d.name ? 'Rename' : 'Name it'}</button>`);
  if (ppchShared(ppchMe())) {
    const p = ppchPerson();
    parts.push(`Changes from here are made as ${p ? `<b>${staEsc(p)}</b>` : '<span class="sta-bad">nobody yet</span>'} · <button type="button" class="sta-linkbtn" data-ppchname="person">${p ? 'Change' : 'Set the name'}</button>`);
  }
  parts.push('Sellora records the login and device for every change made here.');
  parts.push('<span class="sta-dash">Changes made in the Amazon Ads console are not in this record.</span>');
  $('ppchMsg').innerHTML = parts.map(p => `<span>${p}</span>`).join('');
}
// The summary strip, in Search Term Analysis's cells.
function ppchSummary(S) {
  const cell = (k, v, tip, sub) => `<div${tip ? ` title="${staEsc(tip)}"` : ''}><small>${k}</small><b>${v}</b>${sub ? `<em class="sta-sumsub">${sub}</em>` : ''}</div>`;
  if (!S) { $('ppchSum').innerHTML = ['Changes', 'Reached Amazon', 'Waiting', 'Undone / removed', 'Most active'].map(k => cell(k, '—')).join(''); return; }
  $('ppchSum').innerHTML = cell('Changes', staInt(S.n), 'Changes made from Sellora in this range, after the filters', `${staInt(S.steps)} step${S.steps === 1 ? '' : 's'}`)
    + cell('Reached Amazon', staInt(S.reached), 'Seen in Amazon\'s own record, applied from Sellora, or undone after that', S.n ? `${Math.round(S.reached / S.n * 100)}% of the changes` : 'none yet')
    + cell('Waiting', staInt(S.waiting), 'Not at Amazon yet: waiting, approved, in a bulk file, being applied, or an apply that failed', `${staInt(S.approved)} approved · ${staInt(S.exported)} in a bulk file`)
    + cell('Undone / removed', staInt(S.undone + S.removed), '', `${staInt(S.undone)} undone · ${staInt(S.removed)} removed`)
    + cell('Most active', S.top ? staEsc(S.top.name) : '—', 'The person with the most steps in these changes', S.top ? `${staInt(S.top.n)} step${S.top.n === 1 ? '' : 's'}` : '');
}
// The change-type chips, counted on the rows of the view before a chip is picked.
function ppchChips(kinds) {
  const n = {};
  kinds.forEach(k => { n[k] = (n[k] || 0) + 1; });
  const chip = (k, t, c, cls) => `<button type="button" class="sta-chip${PPCH.kind === k ? ' on' : ''}${k ? ' a-' + cls : ''}" data-a="${k}" aria-pressed="${PPCH.kind === k}">${t}<span>${staInt(c)}</span></button>`;
  $('ppchActBar').innerHTML = '<span class="sta-actl">Change</span>' + chip('', 'All', kinds.length)
    + PPCH_KINDS.filter(([k]) => n[k] || PPCH.kind === k).map(([k, t, cls]) => chip(k, t, n[k] || 0, cls)).join('');
}
// Who: the name in bold, the login under it (and in By change the device under that).
const ppchPerson1 = (e, withDev) => `<b>${staEsc(ppchName(e))}</b><small class="sta-s ppch-mail"${e && e.email ? ` title="${staEsc(e.email)}"` : ''}>${e && e.sys ? 'Amazon\'s own record' : staEsc((e && e.email) || '—')}</small>`
  + (withDev && e && !e.sys ? ppchDev1(e) : '');
function ppchDev1(e) {
  const t = ppchDevOf(e);
  if (!t) return staDash;
  const mine = e.dev && e.dev.id && e.dev.id === ppchDeviceId();
  const tip = e.dev ? [e.dev.name && e.dev.label ? e.dev.label : '', e.dev.id ? 'device ' + e.dev.id : ''].filter(Boolean).join(' · ') : '';
  return `<small class="sta-s"${tip ? ` title="${staEsc(tip)}"` : ''}>${staEsc(t)}${mine ? ' · this device' : ''}</small>`;
}
const ppchVerb = e => PPCH_VERB[e.act] || e.act || '';
// The row button: back to the screen the change was made on.
function ppchGoBtn(m) {
  const plc = m.kind === 'plc';
  if (plc ? $('tabPlc').classList.contains('hide') : $('tabSt').classList.contains('hide')) return '';
  return `<button type="button" class="sta-btn sm" data-go="${staEsc(m.id)}" title="${plc ? 'Placement, filtered to this campaign' : 'Search Term Analysis, filtered to this ' + (m.x.term ? 'search term' : 'campaign')}">${plc ? 'Open in Placement' : 'Open in Search Term Analysis'}</button>`;
}
const ppchCampCell = x => staPathCell({ cn: x.cn, cid: x.cid, agn: x.agn, kw: x.kw, mt: x.mt }, true);
// The empty table, in the same quiet line as Search Term Analysis.
function ppchEmpty(cols, loading, total) {
  const t = loading ? 'Loading Sellora\'s record of ad changes…'
    : total ? 'Nothing matches these filters.'
    : PPCH.where === 'local' ? `Nothing in this browser's copy in the last ${PPCH.days} days. The shared record needs its database rule; until then each browser keeps its own.`
    : `No changes in the last ${PPCH.days} days. Changes made from Search Term Analysis and Placement show here.`;
  return `<tr><td colspan="${cols}" class="muted" style="padding:14px">${staEsc(t)}</td></tr>`;
}
const PPCH_DOT = { 'seen-at-amazon': 'ok', applied: 'ok', removed: 'warn', 'taken-back': 'warn', 'cancelled-download': 'warn', undone: 'warn', 'apply-failed': 'bad' };
// By change: one row per change; a row opens to its steps.
function ppchDrawItems(items, total, loading) {
  PPCH_LAST = items;
  $('ppchTitle').textContent = 'Every change made from Sellora';
  $('ppchSub').textContent = loading ? '' : `${staInt(items.length)} change${items.length === 1 ? '' : 's'}, newest step first. Open a row to see every step: who, when and from which device.`;
  const page = ppchPage(items);
  const COLS = 7;
  const body = page.map(m => {
    const x = m.x, open = PPCH.open.has(m.id), last = m.last || {}, add = m.add || {};
    const caret = `<button type="button" class="sta-caret" data-open="${staEsc(m.id)}" aria-expanded="${open}" aria-controls="ppchS-${staEsc(m.id)}" aria-label="${open ? 'Hide' : 'Show'} every step of ${staEsc(m.label)}">${open ? '▾' : '▸'}</button>`;
    const row = `<tr class="ppch-row${open ? ' on' : ''}" data-row="${staEsc(m.id)}">
      <td class="sta-stick"><div class="sta-tc"><div class="sta-term">${caret}${staEsc(m.label || '—')}</div>${m.sub ? `<small class="sta-s">${staEsc(m.sub)}</small>` : ''}
        <div class="sta-under">${staBadge(staBrandName(m.brand), 'brand-' + m.brand)}${staBadge(m.kindName)}</div></div></td>
      <td class="ppch-what">${m.ch.text ? staEsc(m.ch.text) : staDash}</td>
      <td>${ppchChip(x)}<small class="sta-s" title="Added ${staEsc(ppchWhen(add.t || x.at))} by ${staEsc(ppchName(add))}">${staInt(m.trail.length)} step${m.trail.length === 1 ? '' : 's'} since ${staEsc(staDay(add.t || x.at))}</small></td>
      <td>${staEsc(ppchVerb(last))}<small class="sta-s ppch-when">${staEsc(ppchWhen(last.t))}</small></td>
      <td>${ppchPerson1(last, true)}</td>
      ${ppchCampCell(x)}
      <td>${ppchGoBtn(m)}</td></tr>`;
    if (!open) return row;
    const tl = m.trail.map(e => `<li class="${e.sys ? 'sys ' : ''}${e.old ? 'old ' : ''}${PPCH_DOT[e.act] ? 'is-' + PPCH_DOT[e.act] : ''}"><span class="ppch-t">${staEsc(ppchWhen(e.t))}</span> · <b>${staEsc(ppchVerb(e))}</b>`
      + `${e.batch ? ` <span class="sta-dash">(bulk file ${staEsc(e.batch)})</span>` : ''} · ${staEsc(ppchName(e))}${e.email ? ` <span class="sta-dash">${staEsc(e.email)}</span>` : ''}`
      + `${e.sys ? '' : ` · <span class="ppch-dev">${staEsc(ppchDevOf(e) || 'not recorded')}</span>`}${e.note ? ` · <span class="sta-bad">${staEsc(e.note)}</span>` : ''}</li>`).join('');
    return row + `<tr class="ppch-steps" id="ppchS-${staEsc(m.id)}"><td colspan="${COLS}"><ol class="ppch-tl" aria-label="Steps of ${staEsc(m.label)}">${tl}</ol></td></tr>`;
  }).join('');
  $('ppchTable').innerHTML = `<thead><tr><th class="sta-stick">Change</th><th>What changes</th><th>Status</th><th>Last step</th><th title="The person, their login and their device">By · device</th>
    <th>Campaign · ad group</th><th><span class="sta-dash">Open</span></th></tr></thead><tbody>`
    + (body || ppchEmpty(COLS, loading, total)) + '</tbody>';
  ppchFoot(items.length, 'changes', 'newest step first');
}
// Every step: one row per step, newest first.
function ppchDrawSteps(steps, total, loading) {
  PPCH_LAST = steps;
  $('ppchTitle').textContent = 'Every step, newest first';
  $('ppchSub').textContent = loading ? '' : `${staInt(steps.length)} step${steps.length === 1 ? '' : 's'}: each time someone added, approved, downloaded, applied, undid or removed a change, and when Amazon's record showed it.`;
  const page = ppchPage(steps);
  const COLS = 8;
  const body = page.map(({ e, m }) => `<tr>
      <td class="ppch-when">${staEsc(ppchWhen(e.t))}</td>
      <td>${ppchPerson1(e)}</td><td>${ppchDev1(e)}</td>
      <td><b>${staEsc(ppchVerb(e))}</b>${e.batch ? `<small class="sta-s">bulk file ${staEsc(e.batch)}</small>` : ''}${e.note ? `<small class="sta-s sta-bad">${staEsc(e.note)}</small>` : ''}</td>
      <td>${staBadge(staBrandName(m.brand), 'brand-' + m.brand)}</td>
      <td>${staEsc(m.kindName)}<small class="sta-s ppch-cut" title="${staEsc(m.ch.text)}">${m.ch.text ? staEsc(m.ch.text) : '&nbsp;'}</small></td>
      <td><span class="sta-term">${staEsc(m.label || '—')}</span><small class="sta-s ppch-cut" title="${staEsc((m.x.cn || '') + (m.x.agn ? ' · ' + m.x.agn : ''))}">${staEsc(m.x.cn || '')}${m.x.agn ? ' · ' + staEsc(m.x.agn) : ''}</small></td>
      <td>${ppchGoBtn(m)}</td></tr>`).join('');
  $('ppchTable').innerHTML = `<thead><tr><th>When</th><th>Who</th><th>Device</th><th>Action</th><th>Brand</th><th>Change</th><th>Item</th><th><span class="sta-dash">Open</span></th></tr></thead><tbody>`
    + (body || ppchEmpty(COLS, loading, total)) + '</tbody>';
  ppchFoot(steps.length, 'steps', 'newest first');
}
function ppchPage(rows) {
  const pages = Math.max(1, Math.ceil(rows.length / PPCH.size));
  if (PPCH.pg >= pages) PPCH.pg = pages - 1;
  return rows.slice(PPCH.pg * PPCH.size, PPCH.pg * PPCH.size + PPCH.size);
}
function ppchFoot(total, what, note) {
  staPager(total, what, note, { pg: PPCH.pg, size: PPCH.size, foot: h => { $('ppchFoot').innerHTML = h; $('ppchFoot').classList.remove('err'); } });
}

/* ---------- export ---------- */
const PPCH_CSV_ITEM = ['Added', 'Brand', 'Change type', 'Change', 'Search term / target', 'Campaign', 'Ad group', 'From', 'To', 'What changes',
  'Status', 'Added by', 'Added by email', 'Last step', 'Last step at', 'Last step by', 'Last step by email', 'Last step device', 'Steps',
  'Reached Amazon', 'Item ID'];
const PPCH_CSV_STEP = ['When', 'Person', 'Email', 'Device', 'Device ID', 'Action', 'Brand', 'Change type', 'Change', 'Search term / target',
  'Campaign', 'Ad group', 'From', 'To', 'Bulk file', 'Status now', 'Item ID'];
// The rows of the view as CSV lines, heading first. view: 'item' (models) or 'step' ({ e, m }).
function ppchCsvLines(view, rows) {
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const line = a => a.map(cell).join(',');
  if (view === 'step') {
    return [line(PPCH_CSV_STEP)].concat(rows.map(({ e, m }) => line([ppchStamp(e.t), ppchName(e), e.email || '', ppchDevOf(e), (e.dev && e.dev.id) || '', ppchVerb(e),
      staBrandName(m.brand), ppchKindLabel(m.kind), m.kindName, m.label, m.x.cn || '', m.x.agn || '', m.ch.from, m.ch.to, e.batch || '', ppchStatusWord(m.x), m.id])));
  }
  return [line(PPCH_CSV_ITEM)].concat(rows.map(m => {
    const l = m.last || {}, a = m.add || {};
    return line([ppchStamp(a.t || m.x.at), staBrandName(m.brand), ppchKindLabel(m.kind), m.kindName, m.label, m.x.cn || '', m.x.agn || '', m.ch.from, m.ch.to, m.ch.text,
      ppchStatusWord(m.x), ppchName(a), a.email || '', ppchVerb(l), ppchStamp(l.t), ppchName(l), l.email || '', ppchDevOf(l), m.trail.length, m.reached ? 'yes' : 'no', m.id]);
  }));
}
function ppchCsv() {
  if (!PPCH_LAST.length) { $('ppchFoot').innerHTML = '<span>Nothing to export.</span>'; $('ppchFoot').classList.add('err'); return; }
  const lines = ppchCsvLines(PPCH.view, PPCH_LAST);
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ppc-history-${PPCH.view === 'step' ? 'steps' : 'changes'}-${PPCH.days}d-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- back to the screen a change was made on ---------- */
function ppchGo(id) {
  const x = ppchAll().find(y => y.id === id);
  if (!x) return;
  const pickBrand = (sel, b) => { const el = $(sel); if (el && [...el.options].some(o => o.value === b)) el.value = b; };
  if (x.kind === 'plc') {
    pickBrand('plcBrand', x.brand);
    $('plxFilter').value = x.cn || '';
    PLX_ACT = '';
    PLX_PG = 0;
    showTab('plc');
    return;
  }
  ST_VIEW = 'all';
  ST_SUB = 'term';
  ST_PG = 0;
  ST_ACT = '';
  pickBrand('stBrand', x.brand);
  $('stFilter').value = x.term || x.cn || '';
  STM = null;
  showTab('st');
}

/* ---------- events ---------- */
// The filter choices that come from this file's words.
$('ppchFAct').innerHTML = '<option value="">Every action</option>' + Object.keys(PPCH_VERB).map(k => `<option value="${k}">${staEsc(PPCH_VERB[k])}</option>`).join('');
$('ppchFKind').innerHTML = '<option value="">Every change type</option>' + PPCH_KINDS.map(([k, t]) => `<option value="${k}">${staEsc(t)}</option>`).join('');
try {
  const z = Number(localStorage.getItem('ppchSize'));
  if ([50, 100, 250].includes(z)) { PPCH.size = z; $('ppchSize').value = String(z); }
} catch (e) { /* no storage */ }
const ppchRe = () => { PPCH.pg = 0; renderPpch(); };
let PPCH_FT = 0;
$('ppchFilter').addEventListener('input', () => { clearTimeout(PPCH_FT); PPCH_FT = setTimeout(ppchRe, 250); });
$('ppchBrand').addEventListener('change', ppchRe);
['ppchFPerson', 'ppchFAct', 'ppchFAmz'].forEach(id => $(id).addEventListener('change', ppchRe));
$('ppchFKind').addEventListener('change', () => { PPCH.kind = $('ppchFKind').value; ppchRe(); });
$('ppchRange').addEventListener('change', () => { PPCH.days = Number($('ppchRange').value) || 90; PPCH.pg = 0; PPCH.open.clear(); ensurePpch(); });
$('ppchFClear').addEventListener('click', () => {
  ['ppchFPerson', 'ppchFAct', 'ppchFKind'].forEach(id => { $(id).value = ''; });
  $('ppchFAmz').checked = false;
  PPCH.kind = '';
  ppchRe();
});
$('ppchMoreBtn').addEventListener('click', () => {
  const off = $('ppchMore').classList.toggle('hide');
  $('ppchMoreBtn').setAttribute('aria-expanded', off ? 'false' : 'true');
});
$('ppchCsv').addEventListener('click', ppchCsv);
$('ppchViewSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-v]');
  if (!b || b.dataset.v === PPCH.view) return;
  PPCH.view = b.dataset.v;
  ppchRe();
});
$('ppchActBar').addEventListener('click', e => {
  const c = e.target.closest('[data-a]');
  if (!c) return;
  PPCH.kind = PPCH.kind === c.dataset.a ? '' : c.dataset.a;
  ppchRe();
});
$('ppchSize').addEventListener('change', () => {
  PPCH.size = Number($('ppchSize').value) || 100;
  PPCH.pg = 0;
  try { localStorage.setItem('ppchSize', String(PPCH.size)); } catch (e) { /* no storage */ }
  renderPpch();
});
$('ppchMsg').addEventListener('click', e => {
  const b = e.target.closest('[data-ppchname]');
  if (b) ppchDlgOpen(b.dataset.ppchname === 'person' ? 'person' : 'dev');
});
// The table: the copy buttons, Open in…, and a row (or its chevron) opens to its steps.
$('ppchTable').addEventListener('click', e => {
  const cp = e.target.closest('button[data-copy]');
  if (cp) { staCopyText(cp.dataset.copy, cp); return; }
  const go = e.target.closest('button[data-go]');
  if (go) { ppchGo(go.dataset.go); return; }
  const op = e.target.closest('[data-open]') || (e.target.closest('a,button,input,select,label') ? null : e.target.closest('tr[data-row]'));
  if (!op) return;
  if (!op.dataset.open && typeof window.getSelection === 'function' && String(window.getSelection() || '')) return;   // selecting text, not opening
  const id = op.dataset.open || op.dataset.row;
  if (PPCH.open.has(id)) PPCH.open.delete(id); else PPCH.open.add(id);
  renderPpch();
  const btn = $('ppchTable').querySelector(`[data-open="${CSS.escape(id)}"]`);
  if (btn && op.dataset.open) btn.focus();
});
$('ppchFoot').addEventListener('click', e => {
  const b = e.target.closest('[data-pg]');
  if (!b) return;
  PPCH.pg = Math.max(0, PPCH.pg + (b.dataset.pg === 'next' ? 1 : -1));
  renderPpch();
  $('ppchTable').closest('.sta-wrap').scrollTop = 0;
});
// The name dialog: Save (or Enter), Cancel, ✕, a click outside, Escape — Escape closes only this dialog, not the review
// list it may sit over (Search Term Analysis closes its own dialogs on Escape).
$('ppchDlgOk').addEventListener('click', () => ppchDlgClose(true));
$('ppchDlgCancel').addEventListener('click', () => ppchDlgClose(false));
$('ppchDlgX').addEventListener('click', () => ppchDlgClose(false));
$('ppchDlg').addEventListener('click', e => { if (e.target === $('ppchDlg')) ppchDlgClose(false); });
$('ppchDlgIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ppchDlgClose(true); } });
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !PPCH_DLG) return;
  e.stopPropagation();
  ppchDlgClose(false);
}, true);
