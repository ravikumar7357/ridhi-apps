/* PPC History (src/app/ads/ppc-history.js) and the steps Search Term Analysis and Placement write for it, over the real files
 * (ads/search-terms.js, ads/placement-decide.js, ads/ppc-history.js) in a stub page.
 *   node tests/ppc-history-test.js
 * Covers: the device label and id; the trail of a new item (staItem, plxItem) and of every move (staRlMove, in this browser
 * and inside the shared list's transaction); "downloaded again" and "taken back"; the shared login's "Who is making this
 * change?"; items from before the trail (their old fields, no step twice); the filters; the summary; the CSV columns; the
 * page drawn (both views, a row opened, the empty and the this-browser-only states). */
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const SRC = path.join(__dirname, '..', 'src', 'app', 'ads');
const L = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// One element of the stub page. Panes and dialogs start hidden, as in index.html.
function makeEl(id) {
  const cls = new Set(/^pane/.test(id) || ['ppchDlg', 'stDlg', 'stRl', 'ppchMore', 'stMore'].includes(id) ? ['hide'] : []);
  return {
    id, value: id === 'ppchBrand' || id === 'stBrand' || id === 'plcBrand' ? 'ALL' : '', checked: false, innerHTML: '', textContent: '', dataset: {}, style: {},
    disabled: false, title: '', placeholder: '', options: [{ value: 'ALL' }, { value: 'SP' }, { value: 'CPC' }], listeners: {},
    classList: { add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
      toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; } },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, setAttribute() {}, removeAttribute() {},
    querySelector: () => null, querySelectorAll: () => [], focus() {}, closest: () => null, insertAdjacentHTML() {}, scrollIntoView() {}, remove() {},
  };
}

function setup(opts) {
  opts = opts || {};
  const els = {};
  const $ = id => els[id] || (els[id] = makeEl(id));
  const store = {};                                   // localStorage
  const docs = opts.docs || {};                       // Firestore adsActions/{id}
  const sets = [];
  const ME = Object.assign({ email: 'asha.verma@example.com', admin: false, tabs: ['st', 'plc'] }, opts.me || {});
  const ctx = {
    $, ME, auth: { currentUser: { uid: 'uid-123' } }, db: {},
    document: { addEventListener() {}, querySelectorAll: () => [], createElement: () => ({ click() {}, set href(v) {}, get href() { return 'blob:x'; } }) },
    window: { addEventListener() {}, getSelection: () => '' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    navigator: opts.navigator || { userAgentData: { platform: 'Windows', mobile: false, brands: [{ brand: 'Not_A Brand', version: '24' }, { brand: 'Chromium', version: '131' }, { brand: 'Google Chrome', version: '131' }] }, userAgent: '' },
    setTimeout: (f, ms) => { if (!(ms > 1000)) Promise.resolve().then(f); return 0; }, clearTimeout() {},
    CSS: { escape: s => s }, Blob: class { constructor(p) { this.p = p; } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    lcZip: () => new Uint8Array(0), lcXml: s => s, lcColName: i => String.fromCharCode(65 + i),
    doc: (d, c, id) => ({ c, id }), collection: (d, c) => ({ c }), where: (...a) => ({ where: a }), orderBy: () => ({}), query: (...a) => a,
    getDocs: opts.getDocs || (async () => { throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); }),
    getDoc: async () => ({ exists: () => false, data: () => ({}) }), setDoc: async (ref, data) => { docs[ref.id] = JSON.parse(JSON.stringify(data)); },
    onSnapshot: () => () => {},
    runTransaction: async (d, fn) => fn({
      get: async ref => ({ exists: () => !!docs[ref.id], data: () => JSON.parse(JSON.stringify(docs[ref.id])) }),
      set: (ref, data) => { sets.push(data); docs[ref.id] = JSON.parse(JSON.stringify(data)); },
    }),
    baCall: async () => ({}), showTab: t => { ctx.tabs.push(t); }, tabs: [],
    plcColor: () => '#000', PLC: { d: {}, at: '' }, plcMsg() {}, plcAgg: () => ({ names: [], place: {} }), COST: {}, PF_MODEL: { oh: 0, sal: 0 },
  };
  Object.assign(ctx, opts.ctx || {});   // a test's own stubs (ngram-test: a backend that fails, then answers; timers that run at once)
  // opts.plc: the real ads/placement.js too (placement-test: the chart, the lower tables), in place of its stubs.
  if (opts.plc) ['plcColor', 'PLC', 'plcMsg', 'plcAgg'].forEach(k => delete ctx[k]);
  const names = ['staItem', 'staNegItem', 'staBidItem', 'staRlMove', 'staRlSave', 'staRedownload', 'staUndoAdd', 'staRlChip', 'staPager', 'staWho', 'plxItem',
    'ppchEvent', 'ppchMoveEvent', 'ppchMoveAct', 'ppchTrailOf', 'ppchOldTrail', 'ppchDevLabel', 'ppchDeviceId', 'ppchDevice', 'ppchPerson', 'ppchNeedPerson',
    'ppchDlgClose', 'ppchModel', 'ppchFilter', 'ppchStepsOf', 'ppchSums', 'ppchCsvLines', 'ppchLoad', 'ppchAll', 'ensurePpch', 'renderPpch', 'ppchGo',
    'PPCH_CSV_ITEM', 'PPCH_CSV_STEP', 'PPCH_SHARED', 'PPCH_VERB'];
  // opts.stText: search-terms.js from another commit (ngram-test: By word before the shared pattern index); opts.ngram: also
  // load ads/ngram.js, where src/app/ORDER puts it (right after search-terms.js).
  // opts.ngText: ngram.js from another commit (ngram-test: the negate plan before the per-campaign evidence check).
  const src = (opts.stText || L('search-terms.js')) + (opts.ngram ? '\n' + (opts.ngText || L('ngram.js')) : '') + (opts.plc ? '\n' + L('placement.js') : '') + '\n' + L('placement-decide.js') + '\n' + L('ppc-history.js')
    + '\n;return { ' + names.concat(opts.names || []).join(', ') + ', ST_RL, PPCH, setJust: v => { STA_JUST = v; } };';
  const C = new Function(...Object.keys(ctx), src)(...Object.values(ctx));
  C.ST_RL.where = opts.where || 'local';
  return { C, $, els, store, docs, sets, ctx, ME };
}
const acts = x => (x.trail || []).map(e => e.act).join(',');
const tick = () => new Promise(r => setImmediate(r));

// Run as a test; required, it only hands over the stub page (a preview script draws the screen with it).
module.exports = { setup };
if (require.main === module) (async () => {
  console.log('== this device ==');
  {
    const { C, store } = setup();
    ok('label from userAgentData: "Windows · Chrome 131"', C.ppchDevLabel() === 'Windows · Chrome 131', C.ppchDevLabel());
    const UA = {
      'Windows · Edge 131': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.86',
      'macOS · Safari 18': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
      'Windows · Firefox 133': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
      'Android · Chrome 130': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      'iPhone · Chrome 131': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
    };
    Object.entries(UA).forEach(([want, ua]) => ok('fallback from the user-agent text: ' + want, C.ppchDevLabel({ userAgent: ua }) === want, C.ppchDevLabel({ userAgent: ua })));
    ok('Edge through userAgentData drops "Microsoft"', C.ppchDevLabel({ userAgentData: { platform: 'Windows', brands: [{ brand: 'Microsoft Edge', version: '131' }, { brand: 'Chromium', version: '131' }] } }) === 'Windows · Edge 131');
    ok('nothing to read: "Unknown device"', C.ppchDevLabel({ userAgent: '' }) === 'Unknown device');
    const id = C.ppchDeviceId();
    ok('a device id is made once and kept in selloraDeviceId', /^d[a-z0-9]{8,}$/.test(id) && store.selloraDeviceId === id && C.ppchDeviceId() === id, id);
    store.selloraDeviceName = 'Office PC';
    ok('the device name given on PPC History goes with it', C.ppchDevice().name === 'Office PC' && C.ppchDevice().label === 'Windows · Chrome 131');
  }

  console.log('== a new item and every move (this browser) ==');
  const A = setup();
  {
    const { C } = A;
    const r = { type: 'term', key: 'k1', brand: 'SP', term: 'red table runner', kw: 'table runner', mt: 'BROAD', cid: 'c1', ag: 'a1', cn: 'SP - Runner - Broad', agn: 'Runners', c: 40, sp: 21.5, o: 0, s: 0, kind: 'none' };
    const it = C.staNegItem(r, 'negativeExact', 'ag');
    const e0 = it.trail[0];
    ok('staItem starts the trail with one "added" step', it.trail.length === 1 && e0.act === 'added', JSON.stringify(it.trail));
    ok('the step names the login, the uid, the person (from the email) and this device',
      e0.email === 'asha.verma@example.com' && e0.uid === 'uid-123' && e0.person === 'Asha' && e0.dev.label === 'Windows · Chrome 131' && !!e0.dev.id && e0.dev.name === '' && e0.t > 0, JSON.stringify(e0));
    ok('no undefined anywhere in a step (Firestore refuses it)', JSON.stringify(e0) === JSON.stringify(JSON.parse(JSON.stringify(e0))) && Object.values(e0).every(v => v !== undefined));
    await C.staRlSave(it);
    const x = C.ST_RL.items[0];
    const move = async (from, patch, extra) => C.staRlMove(x, from, patch, extra);
    ok('review → approved: "approved"', (await move(['review'], { status: 'approved', approvedBy: 'v@x', approvedAt: Date.now() })) === '' && x.trail.at(-1).act === 'approved');
    ok('approved → review: "unapproved"', (await move(['approved', 'removed'], { status: 'review', approvedBy: '', approvedAt: 0 })) === '' && x.trail.at(-1).act === 'unapproved');
    await move(['review', 'approved'], { status: 'removed', removedBy: 'v@x', removedAt: Date.now() });
    ok('→ removed: "removed"', x.trail.at(-1).act === 'removed');
    await move(['approved', 'removed'], { status: 'review' });
    ok('removed → review: "restored"', x.trail.at(-1).act === 'restored');
    await move(['review'], { status: 'approved' });
    await move(['approved'], { status: 'exported', exportedAt: Date.now(), batch: 'fABC' });
    ok('→ exported: "downloaded", with the bulk file', x.trail.at(-1).act === 'downloaded' && x.trail.at(-1).batch === 'fABC');
    await move(['exported'], { status: 'done', doneAt: Date.now() });
    const sys = x.trail.at(-1);
    ok('→ done: "seen-at-amazon" by Amazon\'s record, no login', sys.act === 'seen-at-amazon' && sys.email === '' && sys.person === 'Amazon record' && sys.sys === true);
    await move(['done', 'applied'], { status: 'undone', undoneAt: Date.now() });
    ok('→ undone: "undone"', x.trail.at(-1).act === 'undone');
    ok('the whole trail, in order', acts(x) === 'added,approved,unapproved,removed,restored,approved,downloaded,seen-at-amazon,undone', acts(x));
    ok('a move that is not allowed adds no step', (await move(['review'], { status: 'approved' })) !== '' && x.trail.length === 9);
    ok('saved in this browser with its trail', JSON.parse(A.store.staReview)[0].trail.length === 9);
    // exported → removed is a cancelled download; the apply route's moves.
    const y = Object.assign(C.staNegItem(r, 'negativeExact', 'ag'), { status: 'exported' });
    await C.staRlSave(y);
    await C.staRlMove(y, ['exported'], { status: 'removed', note: 'Downloaded, never seen at Amazon: cancelled' });
    ok('exported → removed: "cancelled-download"', y.trail.at(-1).act === 'cancelled-download');
    const z = Object.assign(C.staNegItem(r, 'negativeExact', 'ag'), { status: 'approved' });
    await C.staRlSave(z);
    await C.staRlMove(z, ['approved'], { status: 'applying' });
    await C.staRlMove(z, ['applying'], { status: 'failed', err: 'Amazon said no' });
    ok('→ applying "apply-started", → failed "apply-failed" with Amazon\'s answer', acts(z) === 'added,apply-started,apply-failed' && z.trail.at(-1).note === 'Amazon said no', acts(z));
    const w = Object.assign(C.staNegItem(r, 'negativeExact', 'ag'), { status: 'approved' });
    await C.staRlSave(w);
    await C.staRlMove(w, ['approved'], { status: 'applying' });
    await C.staRlMove(w, ['applying'], { status: 'approved', dryRunAt: Date.now() });
    await C.staRlMove(w, ['approved'], { status: 'applying' });
    await C.staRlMove(w, ['applying'], { status: 'applied', appliedAt: Date.now() });
    ok('a dry run, then applied', acts(w) === 'added,apply-started,dry-run,apply-started,applied', acts(w));
    ok('move acts: the table of moves', C.ppchMoveAct('review', { status: 'approved' }) === 'approved' && C.ppchMoveAct('approved', { status: 'review' }) === 'unapproved'
      && C.ppchMoveAct('removed', { status: 'review' }) === 'restored' && C.ppchMoveAct('exported', { status: 'removed' }) === 'cancelled-download'
      && C.ppchMoveAct('review', { status: 'removed' }) === 'removed' && C.ppchMoveAct('approved', { status: 'exported' }) === 'downloaded'
      && C.ppchMoveAct('exported', { status: 'done' }) === 'seen-at-amazon' && C.ppchMoveAct('approved', { status: 'applying' }) === 'apply-started'
      && C.ppchMoveAct('applying', { status: 'applied' }) === 'applied' && C.ppchMoveAct('applying', { status: 'failed' }) === 'apply-failed'
      && C.ppchMoveAct('applied', { status: 'undone' }) === 'undone');
    // "Undo" in the footer: taken back.
    const u = C.staNegItem(r, 'negativePhrase', 'cp');
    await C.staRlSave(u);
    C.setJust({ ids: [u.id], t: Date.now() });
    await C.staUndoAdd();
    ok('Undo right after adding: "taken-back"', u.status === 'removed' && u.trail.at(-1).act === 'taken-back', acts(u));
    // Download again: one step on each item of the file, the status left as it is.
    const b1 = Object.assign(C.staNegItem(r, 'negativeExact', 'ag'), { status: 'exported', batch: 'fB', bulk: { 'Entity': 'Negative Keyword' } });
    const b2 = Object.assign(C.staNegItem(r, 'negativeExact', 'cp'), { status: 'done', batch: 'fB', bulk: { 'Entity': 'Campaign Negative Keyword' } });
    await C.staRlSave(b1); await C.staRlSave(b2);
    await C.staRedownload('fB');
    ok('Download again: "downloaded-again" on each item of the file, saved, status unchanged',
      b1.trail.at(-1).act === 'downloaded-again' && b2.trail.at(-1).act === 'downloaded-again' && b1.trail.at(-1).batch === 'fB'
      && b1.status === 'exported' && b2.status === 'done' && JSON.parse(A.store.staReview).find(q => q.id === b2.id).trail.length === 2);
    // Placement's item.
    const camp = { cn: 'SP - Auto', strategy: 'LEGACY_FOR_SALES', ent: ['SP - Auto', 'enabled', 50, 'LEGACY_FOR_SALES', 10, 0, 0] };
    const p = C.plxItem({ key: 'plc|SP|c9|tos', brand: 'SP', cid: 'c9', pk: 'tos', camp, cur: 10, to: 20, c: 100, sp: 50, o: 10, s: 300, why: 'ACoS low' });
    ok('plxItem starts the trail with "added"', acts(p) === 'added' && p.trail[0].dev.label === 'Windows · Chrome 131');
    ok('the review list chip is the same words as before', /Waiting/.test(C.staRlChip({ status: 'review' })) && /Done · seen at Amazon/.test(C.staRlChip({ status: 'done' }))
      && /is-warn/.test(C.staRlChip({ status: 'removed' })) && /Apply failed/.test(C.staRlChip({ status: 'failed' })));
  }

  console.log('== the shared list: the step goes inside the transaction ==');
  {
    const docs = {};
    const { C, sets } = setup({ where: 'fs', docs });
    const r = { type: 'term', key: 'k2', brand: 'CPC', term: 'floral napkins', kw: 'napkins', mt: 'PHRASE', cid: 'c2', ag: 'a2', cn: 'CPC - Napkins', agn: 'Napkins', c: 30, sp: 12, o: 0, s: 0, kind: 'none' };
    const it = C.staNegItem(r, 'negativeExact', 'cp');
    await C.staRlSave(it);
    ok('saved with its first step', docs[it.id] && docs[it.id].trail.length === 1);
    docs[it.id].trail.push({ t: Date.now(), act: 'approved', email: 'ravi@example.com', uid: 'u9', person: 'Ravi', dev: { id: 'dX', label: 'macOS · Safari 18', name: '' } });
    docs[it.id].status = 'approved';
    const res = await C.staRlMove(it, ['approved'], { status: 'exported', exportedAt: Date.now(), batch: 'fZ' });
    const saved = sets.at(-1);
    ok('the transaction adds the step to the trail it read, not to this browser\'s copy', res === '' && saved.trail.length === 3 && saved.trail[1].person === 'Ravi' && saved.trail[2].act === 'downloaded' && saved.trail[2].batch === 'fZ', JSON.stringify(saved && saved.trail));
    ok('this browser\'s copy gets the same trail', it.trail.length === 3 && it.trail[1].person === 'Ravi');
    const res2 = await C.staRlMove(it, ['review'], { status: 'approved' });
    ok('someone else\'s move meanwhile: no step added', /meanwhile/.test(res2) && docs[it.id].trail.length === 3);
  }

  console.log('== a shared login names the person, once per device ==');
  {
    const S = setup({ me: { email: 'it@example.com' } });
    const { C, $, store } = S;
    ok('it@ is a shared login', C.PPCH_SHARED.includes('it@'));
    const r = { type: 'term', key: 'k3', brand: 'SP', term: 'linen napkins', kw: 'linen', mt: 'BROAD', cid: 'c3', ag: 'a3', cn: 'SP - Linen', agn: 'Linen', c: 30, sp: 12, o: 0, s: 0, kind: 'none' };
    const it = C.staNegItem(r, 'negativeExact', 'ag');
    ok('before a name, the step has no person', it.trail[0].person === '' && it.trail[0].email === 'it@example.com');
    const p = C.staRlSave(it);
    await tick();
    ok('the first change asks "Who is making this change?"', !$('ppchDlg').classList.contains('hide') && $('ppchDlgTitle').textContent === 'Who is making this change?');
    $('ppchDlgIn').value = '   ';
    C.ppchDlgClose(true);
    ok('a name is required', !$('ppchDlg').classList.contains('hide') && /Type a name/.test($('ppchDlgNote').innerHTML));
    $('ppchDlgIn').value = '  Ravi  ';
    C.ppchDlgClose(true);
    await p;
    ok('saved as Ravi, remembered on this device (selloraPerson)', it.trail[0].person === 'Ravi' && store.selloraPerson === 'Ravi' && C.ST_RL.items[0] === it);
    await C.staRlMove(it, ['review'], { status: 'approved' });
    ok('the next change does not ask again', $('ppchDlg').classList.contains('hide') && it.trail.at(-1).person === 'Ravi');
    // Cancel: nothing saved, and the rest of that click is refused without a dialog each.
    delete store.selloraPerson;
    const it2 = C.staNegItem(r, 'negativePhrase', 'ag');
    const p2 = C.staRlSave(it2).then(() => 'saved', e => e.message);
    await tick();
    C.ppchDlgClose(false);
    const why = await p2;
    ok('Cancel: not saved, and says why', /not saved/.test(why) && !C.ST_RL.items.includes(it2), why);
    const why2 = await C.staRlMove(it, ['approved'], { status: 'review' });
    ok('…and the same click\'s next change is refused without a second dialog', /not saved/.test(why2) && $('ppchDlg').classList.contains('hide'));
    ok('Amazon\'s own record never asks', (await C.staRlMove(Object.assign(it, { status: 'exported' }), ['exported'], { status: 'done' })) === '');
  }

  console.log('== names: the first part of the email, and who added it in the review list (21 Nov) ==');
  {
    const { C, $, store } = setup({ me: { email: 'it@example.com' }, names: ['staRlDraw'] });
    ok('staWho: the first part, capitalised, cut at . _ + or @', C.staWho('asha.verma@example.com') === 'Asha' && C.staWho('ravi_kumar@x.com') === 'Ravi'
      && C.staWho('meera+ads@x.com') === 'Meera' && C.staWho('it@example.com') === 'It' && C.staWho('') === '' && C.staWho('solo') === 'Solo');
    store.selloraPerson = 'Meera';
    const r = { type: 'term', key: 'k9', brand: 'SP', term: 'blue napkins', kw: 'napkins', mt: 'BROAD', cid: 'c9', ag: 'a9', cn: 'SP - Napkins', agn: 'Napkins', c: 30, sp: 12, o: 0, s: 0, kind: 'none' };
    const it = C.staNegItem(r, 'negativeExact', 'ag');
    ok('a new item still keeps the login\'s own name in "by"', it.by === 'It' && it.trail[0].person === 'Meera');
    const old = Object.assign(C.staNegItem(r, 'negativeExact', 'cp'), { id: 'old9', trail: undefined, by: 'It', byEmail: 'it@example.com' });
    const pers = Object.assign(C.staNegItem(r, 'negativePhrase', 'cp'), { id: 'per9', trail: [{ t: 1, act: 'added', email: 'asha.verma@x.com', person: '' }], by: 'Asha.verma' });
    C.ST_RL.items = [it, old, pers];
    C.ST_RL.tab = 'open';
    C.staRlDraw();
    const html = $('stRlTable').innerHTML;
    const added = id => { const i = html.indexOf('data-rl="' + id + '"'); const row = html.slice(i, html.indexOf('</tr>', i)); return strip(row); };
    ok('review list "Added": the person of the first "added" step on the shared login (Meera, not It)', / Meera /.test(added(it.id)) && !/ It /.test(added(it.id)), added(it.id));
    ok('review list "Added": an item without a trail keeps by / byEmail', / It /.test(added('old9')));
    ok('review list "Added": a step with no person reads the email\'s first name', / Asha /.test(added('per9')) && !/verma/.test(added('per9')), added('per9'));
  }

  console.log('== items from before the trail ==');
  const T0 = Date.UTC(2026, 9, 10, 9, 0);
  const H = 3600000;
  const OLD = { id: 'old1', v: 2, brand: 'SP', kind: 'bid', term: '', target: 'table runner (broad)', kw: 'table runner', mt: 'BROAD', cid: 'c1', ag: 'a1', cn: 'SP - Runner', agn: 'Runners',
    bid: { from: 0.95, to: 0.6, dir: 'down', base: 'bid' }, what: '$0.95 → $0.60', status: 'done', by: 'Asha', byEmail: 'asha@example.com', at: T0,
    approvedBy: 'ravi@example.com', approvedAt: T0 + H, exportedBy: 'ravi@example.com', exportedAt: T0 + 2 * H, batch: 'fOLD', doneAt: T0 + 30 * H, ev: { c: 10, sp: 5, o: 0, s: 0 } };
  {
    const { C } = setup();
    const tr = C.ppchTrailOf(OLD);
    ok('old fields → added, approved, downloaded, seen at Amazon', tr.map(e => e.act).join(',') === 'added,approved,downloaded,seen-at-amazon', tr.map(e => e.act).join(','));
    ok('who from the old fields, device "not recorded"', tr[0].person === 'Asha' && tr[0].email === 'asha@example.com' && tr[1].person === 'Ravi' && tr[1].dev.label === 'not recorded' && tr[2].batch === 'fOLD');
    ok('Amazon\'s step from doneAt', tr[3].sys && tr[3].person === 'Amazon record' && tr[3].t === T0 + 30 * H);
    const rem = C.ppchTrailOf({ id: 'o2', at: T0, by: 'It', byEmail: 'it@example.com', status: 'removed', removedAt: T0 + H, removedBy: 'it@example.com', note: 'Downloaded, never seen at Amazon: cancelled', exportedAt: T0 + 0.5 * H, exportedBy: 'it@example.com' });
    ok('an old cancelled download reads as "cancelled-download"', rem.map(e => e.act).join(',') === 'added,downloaded,cancelled-download');
    const tb = C.ppchTrailOf({ id: 'o3', at: T0, byEmail: 'a@b.c', status: 'removed', removedAt: T0 + 1000, removedBy: 'a@b.c', note: 'Taken back right after adding' });
    ok('an old Undo reads as "taken-back"', tb.at(-1).act === 'taken-back' && tb[0].person === 'A');
    // An old item moved since: the old fields up to its first trail step, then the trail; no step twice.
    const moved = Object.assign({}, OLD, { status: 'undone', undoneAt: T0 + 40 * H, undoneBy: 'ravi@example.com',
      trail: [{ t: T0 + 40 * H, act: 'undone', email: 'ravi@example.com', uid: 'u', person: 'Ravi', dev: { id: 'd1', label: 'Windows · Chrome 131', name: 'Office PC' } }] });
    const tm = C.ppchTrailOf(moved);
    ok('an old item moved since: old steps, then the new one, none twice', tm.map(e => e.act).join(',') === 'added,approved,downloaded,seen-at-amazon,undone' && tm.at(-1).dev.name === 'Office PC', tm.map(e => e.act).join(','));
    const neu = C.ppchTrailOf({ id: 'n1', at: T0, approvedAt: T0 + H, byEmail: 'x@y.z', trail: [{ t: T0, act: 'added', email: 'x@y.z', person: 'X', dev: { id: 'd', label: 'L', name: '' } }] });
    ok('an item with a trail is read from its trail only', neu.map(e => e.act).join(',') === 'added');
  }

  console.log('== the filters, the summary, the CSV ==');
  {
    const { C } = setup();
    C.PPCH.from = 0;
    const ev = (t, act, person, email, more) => Object.assign({ t, act, person, email, uid: 'u', dev: { id: 'd-' + person, label: 'Windows · Chrome 131', name: '' } }, more || {});
    const items = [
      { id: 'i1', brand: 'SP', kind: 'bid', target: 'runner (exact)', cn: 'SP - Runner', agn: 'Exact', bid: { from: 0.95, to: 0.6 }, what: '$0.95 → $0.60', status: 'done', at: T0,
        trail: [ev(T0, 'added', 'Asha', 'v@x.com'), ev(T0 + H, 'approved', 'Ravi', 'r@x.com'), ev(T0 + 2 * H, 'downloaded', 'Ravi', 'r@x.com', { batch: 'f1' }), { t: T0 + 20 * H, act: 'seen-at-amazon', email: '', person: 'Amazon record', sys: true, dev: { id: '', label: '', name: '' } }] },
      { id: 'i2', brand: 'CPC', kind: 'neg', term: 'cheap, "red" napkins', target: 'napkins (broad)', neg: { type: 'negativeExact', level: 'cp' }, cn: 'CPC - Napkins', agn: '', what: 'Negative exact · campaign level', status: 'review', at: T0 + 3 * H,
        trail: [ev(T0 + 3 * H, 'added', 'Asha', 'v@x.com')] },
      { id: 'i3', brand: 'SP', kind: 'exact', term: 'linen runner', target: 'runner (broad)', dest: { ag: 'a', cid: 'c', cn: 'SP - Exact', agn: 'E' }, newBid: 0.8, cn: 'SP - Runner', agn: 'Broad', what: 'New exact keyword at $0.80 in E', status: 'removed', at: T0 + 4 * H,
        trail: [ev(T0 + 4 * H, 'added', 'Ravi', 'r@x.com'), ev(T0 + 5 * H, 'removed', 'Ravi', 'r@x.com')] },
      { id: 'i4', brand: 'SP', kind: 'plc', target: 'Top of Search', cn: 'SP - Auto', agn: '', plc: { name: 'Top of Search', from: 10, to: 20 }, what: 'Top of Search +10% → +20%', status: 'applied', appliedAt: T0 + 7 * H, at: T0 + 6 * H,
        trail: [ev(T0 + 6 * H, 'added', 'Asha', 'v@x.com'), ev(T0 + 7 * H, 'applied', 'Asha', 'v@x.com')] },
    ];
    const M = items.map(C.ppchModel);
    const F = o => Object.assign({ brand: 'ALL', q: '', person: '', act: '', kind: '', amz: false }, o);
    const ids = xs => xs.map(m => m.id).join(',');
    ok('no filter: every change, newest step first (i1: the Amazon step is the newest)', ids(C.ppchFilter(M, F())) === 'i1,i4,i3,i2', ids(C.ppchFilter(M, F())));
    ok('brand', ids(C.ppchFilter(M, F({ brand: 'CPC' }))) === 'i2');
    ok('search finds a person', ids(C.ppchFilter(M, F({ q: 'ravi' }))) === 'i1,i3');
    ok('search finds a campaign', ids(C.ppchFilter(M, F({ q: 'sp - auto' }))) === 'i4');
    ok('change type: "New keyword" is exact and ASIN targets', ids(C.ppchFilter(M, F({ kind: 'kw' }))) === 'i3' && C.ppchModel({ id: 'z', kind: 'asinT', term: 'b0abcdefgh', trail: [] }).kind === 'kw');
    ok('only what reached Amazon (seen, applied, undone)', ids(C.ppchFilter(M, F({ amz: true }))) === 'i1,i4');
    ok('person: changes with a step by that person', ids(C.ppchFilter(M, F({ person: 'Ravi' }))) === 'i1,i3');
    ok('person and action on the same step', ids(C.ppchFilter(M, F({ person: 'Ravi', act: 'approved' }))) === 'i1' && ids(C.ppchFilter(M, F({ person: 'Asha', act: 'approved' }))) === '');
    const steps = C.ppchStepsOf(M, F());
    ok('every step, newest first', steps.length === 9 && steps[0].e.act === 'seen-at-amazon' && steps.at(-1).e.act === 'added' && steps.at(-1).m.id === 'i1');
    ok('every step: a person filter keeps only that person\'s steps', C.ppchStepsOf(M, F({ person: 'Ravi' })).map(s => s.e.act).join(',') === 'removed,added,downloaded,approved');
    const S = C.ppchSums(M);
    ok('summary: changes, steps, reached Amazon, waiting, undone / removed, most active (a tie: the first name)',
      S.n === 4 && S.steps === 9 && S.reached === 2 && S.waiting === 1 && S.removed === 1 && S.undone === 0 && S.top.name === 'Asha' && S.top.n === 4, JSON.stringify(S));
    const S2 = C.ppchSums(M.filter(m => m.id !== 'i3'));
    ok('most active: the person with the most steps, the Amazon record not counted', S2.top.name === 'Asha' && S2.top.n === 4 && S2.steps === 7, JSON.stringify(S2));
    const csv = C.ppchCsvLines('item', C.ppchFilter(M, F()));
    ok('CSV by change: the heading', csv[0] === C.PPCH_CSV_ITEM.join(',') && C.PPCH_CSV_ITEM.length === 21);
    ok('CSV by change: the columns of the agreed list', ['Added', 'Brand', 'Change type', 'Change', 'Search term / target', 'Campaign', 'Ad group', 'From', 'To', 'What changes', 'Status',
      'Added by', 'Added by email', 'Last step', 'Last step at', 'Last step by', 'Last step by email', 'Last step device', 'Steps', 'Reached Amazon', 'Item ID'].join(',') === csv[0]);
    const bid = csv.find(l => l.endsWith(',i1')).split(',');
    const col = name => bid[C.PPCH_CSV_ITEM.indexOf(name)];
    ok('CSV: a bid change from → to, status, who, steps', col('From') === '$0.95' && col('To') === '$0.60' && col('Status') === 'Seen at Amazon' && col('Added by') === 'Asha'
      && col('Last step') === 'Seen at Amazon' && col('Last step by') === 'Amazon record' && col('Steps') === '4' && col('Reached Amazon') === 'yes' && col('Brand') === 'Ridhi' && col('Change type') === 'Bid', bid.join(' | '));
    ok('CSV: quotes and commas kept in one cell', csv.some(l => l.includes('"cheap, ""red"" napkins"')));
    const plc = csv.find(l => l.endsWith(',i4'));
    ok('CSV: a placement change from → to', plc.includes(',+10%,+20%,') && plc.includes('Applied'));
    const sc = C.ppchCsvLines('step', steps);
    ok('CSV every step: the heading and one line per step', sc[0] === C.PPCH_CSV_STEP.join(',') && sc.length === 10);
    ok('CSV every step: the columns of the agreed list', C.PPCH_CSV_STEP.join(',') === 'When,Person,Email,Device,Device ID,Action,Brand,Change type,Change,Search term / target,Campaign,Ad group,From,To,Bulk file,Status now,Item ID');
    const dl = sc.find(l => l.includes('Downloaded in a bulk file')).split(',');
    ok('CSV every step: who, device, the bulk file', dl[1] === 'Ravi' && dl[2] === 'r@x.com' && dl[3] === 'Windows · Chrome 131' && dl[4] === 'd-Ravi' && dl[C.PPCH_CSV_STEP.indexOf('Bulk file')] === 'f1' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(dl[0]), dl.join(' | '));
  }

  console.log('== the page ==');
  {
    // The shared list refused: this browser's copy, said so.
    const { C, $, store } = setup();
    const now = Date.now();
    store.staReview = JSON.stringify([
      { id: 'p1', brand: 'SP', kind: 'bid', target: 'runner (exact)', cn: 'SP - Runner', agn: 'Exact', cid: 'c1', bid: { from: 0.95, to: 0.6 }, what: '$0.95 → $0.60', status: 'approved', at: now - 3600000,
        trail: [{ t: now - 3600000, act: 'added', email: 'v@x.com', person: 'Asha', uid: 'u', dev: { id: 'd1', label: 'Windows · Chrome 131', name: '' } },
          { t: now - 1800000, act: 'approved', email: 'r@x.com', person: 'Ravi', uid: 'u2', dev: { id: 'd2', label: 'macOS · Safari 18', name: 'Ravi laptop' } }] },
      Object.assign({}, OLD, { id: 'p2', at: now - 2 * 86400000, approvedAt: now - 2 * 86400000 + 1000, exportedAt: now - 86400000, doneAt: now - 3600000 }),
      Object.assign({}, OLD, { id: 'p3', at: now - 200 * 86400000 }),
    ]);
    $('panePpch').classList.remove('hide');
    await C.ensurePpch();
    ok('rules not deployed: read from this browser, in range only', C.PPCH.where === 'local' && C.PPCH.items.map(x => x.id).join(',') === 'p1,p2');
    ok('the data line says where it is kept, and this device', /Kept in this browser only/.test($('ppchMsg').innerHTML) && /This device: Windows · Chrome 131/.test(strip($('ppchMsg').innerHTML))
      && /Name it/.test($('ppchMsg').innerHTML) && /Sellora records the login and device for every change made here\./.test($('ppchMsg').innerHTML) && /last 90 days · 2 changes/.test(strip($('ppchMsg').innerHTML)), strip($('ppchMsg').innerHTML));
    const t = $('ppchTable').innerHTML;
    ok('By change: one row per change, with its chevron, status chip, person and device', (t.match(/class="ppch-row/g) || []).length === 2 && /class="sta-caret"/.test(t)
      && /Approved/.test(t) && /<b>Ravi<\/b>/.test(t) && /Ravi laptop/.test(t) && /\$0\.95 → \$0\.60/.test(t) && /Open in Search Term Analysis/.test(t), t.slice(0, 400));
    ok('the summary strip: five cells', ($('ppchSum').innerHTML.match(/<small>/g) || []).length === 5 && /Reached Amazon/.test($('ppchSum').innerHTML) && /Most active/.test($('ppchSum').innerHTML));
    ok('the chips: All first, then the change types with counts', /^<span class="sta-actl">Change<\/span><button type="button" class="sta-chip on" data-a=""/.test($('ppchActBar').innerHTML) && /Bid<span>2<\/span>/.test($('ppchActBar').innerHTML));
    ok('the pager: "1–2 of 2 changes"', /1–2 of 2 changes/.test($('ppchFoot').innerHTML));
    C.PPCH.open.add('p2');
    C.renderPpch();
    const t2 = $('ppchTable').innerHTML;
    ok('an opened row shows its steps as a timeline, old ones "not recorded"', /<ol class="ppch-tl"/.test(t2) && /Seen at Amazon/.test(t2) && /not recorded/.test(t2) && /aria-expanded="true"/.test(t2));
    C.PPCH.view = 'step';
    C.renderPpch();
    const t3 = $('ppchTable').innerHTML;
    ok('Every step: When · Who · Device · Action · Brand · Change · Item', /<th>When<\/th><th>Who<\/th><th>Device<\/th><th>Action<\/th><th>Brand<\/th><th>Change<\/th><th>Item<\/th>/.test(t3)
      && (t3.match(/<tr>/g) || []).length === 7 && /6 steps/.test(strip($('ppchFoot').innerHTML)), strip($('ppchFoot').innerHTML));
    C.ppchGo('p1');
    ok('Open in Search Term Analysis', $('stFilter').value === 'runner (exact)' || $('stFilter').value === 'SP - Runner');
  }
  {
    // The shared list, empty: the quiet empty line.
    const { C, $ } = setup({ getDocs: async () => ({ docs: [] }) });
    $('panePpch').classList.remove('hide');
    await C.ensurePpch();
    ok('shared and empty: "No changes in the last 90 days."', C.PPCH.where === 'fs' && /No changes in the last 90 days\./.test($('ppchTable').innerHTML) && /✓ Shared/.test($('ppchMsg').innerHTML));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
