/* ================= LISTING · B / F: Backend (Seller Central) and Frontend (amazon.com) for each child of a problem row =================
 * Screens: the Workspace parent panel (Listing Health) — one small grey line under each problem row, tiny dots on each child under
 *          "› Show all N"; the child side panel (listing-kid.js, both Child listings and the Workspace) — the same dots beside each error.
 * Does: for ONE child and ONE problem, two answers, each 🟢 g (fine) · 🔴 r (the problem is there) · ○ u (not read yet) · – n (that side
 *       has no such value):
 *   B = BACKEND, what we have in Seller Central: the content read (our submitted title, bullets, description, search words) and
 *       ?lfix=get (our own picture slots, specs, Amazon's issues on our listing), the listings report (price, status).
 *   F = FRONTEND, what shoppers see on amazon.com: the catalogue (?limg=get / ?lfix=get: its picture slots and the title it shows),
 *       A+ live, buyable.
 *   The problem's OWN rule (LR_DET, listing-rules.js) is run once over the backend values and once over the frontend values — no
 *   second copy of any rule. Data not read yet is ○ — never a guess.
 *   B🟢 F🟢 fixed and showing → the child leaves the row (fix-all.js) · B🟢 F🔴 Amazon's side (false error, Amazon not showing yet) ·
 *   B🔴 F🔴 our team (true error) · B🔴 F🟢 shoppers see it fine, but our Seller Central value is wrong.
 * DISPLAY ONLY: it tags, it never moves a problem between levels — Listing Health's / the Workspace's counts are healthOf's, untouched.
 * AUTO RE-CHECK: every BF_RECHECK_MS while Sellora is open, only the B🟢 F🔴 children are read again on the frontend side (the catalogue,
 *   A+ or the status), at most BF_INFLIGHT calls at a time, through the Workspace's read queue. When Amazon shows the fix the child
 *   leaves its row by itself. Still B🟢 F🔴 BF_MAX_DAYS after it was first seen: no more re-checks, "open a case with Amazon".
 * DATA: the reads already held (the saved copy and this browser's copy, listing-saved.js / listing-workspace.js) — nothing is read
 *   from Amazon to draw this. The one new thing kept, when each child was first seen B🟢 F🔴, goes through lsGet / lsSave: THE ONE
 *   small data door for new reads and writes (Firestore today; one place to change for another database). Document
 *   /history/bfwait_<brand> (kind "bfwait", no `day` field, so Listing History never lists it; /history is canAny — no rule change).
 * Main functions: lsGet, lsSave, bfOf, bfSpec, bfWho, bfLineHtml, bfKidHtml, bfEnsure, bfTick, bfDue, bfPump.
 * Pricing-App/tests/bf-test.js runs it with the real rules, Workspace and Fix all in a stub page. */
const BF_RECHECK_MS = 10 * 60 * 1000;      // the re-check of the B🟢 F🔴 children: every 10 minutes
const BF_INFLIGHT = 2;                     // …at most two calls out at a time
const BF_MAX_DAYS = 3;                     // still not showing after 3 days: open a case with Amazon
const BF_COLL = 'history';
const BF = {
  kept: new WeakMap(),     // child record → { ctx, map: problem key → answer } (the child record is replaced when its data changes)
  first: { SP: {}, CPC: {} },   // brand → "sku|problem" → { a: first seen B🟢 F🔴 (ms), l: last seen (ms) }
  ready: { SP: false, CPC: false },   // the saved first-seen dates are in (nothing is written before)
  loading: {},
  dirty: { SP: {}, CPC: {} },   // brand → "sku|problem" → record waiting to be written
  saveT: 0,
  timer: 0,                // the 10-minute re-check
  q: [],                   // re-check reads waiting
  queued: new Set(),       // "brand|sku|kind" waiting or out
  inflight: 0,
  reads: 0,                // re-check reads done (tests, console)
};

/* ----- THE ONE DATA DOOR for new reads and writes (easy switch to another database later) ----- */
const lsOff = () => typeof window !== 'undefined' && !!window.__TEST_ERP;   // the test site saves nothing
/** One document, or null when there is none (or on the test site). */
async function lsGet(coll, id) {
  if (lsOff()) return null;
  const snap = await getDoc(doc(db, coll, id));
  return snap && snap.exists() ? snap.data() : null;
}
/** Merge `data` into one document (only the fields given are touched). False on the test site. */
async function lsSave(coll, id, data) {
  if (lsOff()) return false;
  await setDoc(doc(db, coll, id), data, { merge: true });
  return true;
}

/* ----- the answers ----- */
// Rules judged on the title: run over our submitted title (B) and the title Amazon shows (F).
const BF_TITLE = ['title_length', 'size_format', 'dimension_order', 'variation_value_missing', 'variation_naming', 'title_keyword', 'title_contains', 'title_template'];
// Picture rules our own slots can answer (B) as well as the catalogue (F); the others need the catalogue's picture sizes / ids: F only.
const BF_PICS = ['no_main_image', 'images_below', 'images_between'];
const BF_PICS_F = ['images_small', 'main_not_square', 'images_duplicate', 'main_photo_check'];
// Rules on values shoppers never see as such, or the catalogue does not give back: B only.
const BF_B_ONLY = ['bullets_below', 'desc_below', 'keyword_bytes'];
const BF_BUY = ['inactive_with_stock', 'no_price'];

/** Who fixes it, from the two answers: 'team' | 'amazon' | 'scwrong' | 'unread' | 'done' | 'none'. */
function bfWho(b, f) {
  if (b === 'r') return f === 'g' ? 'scwrong' : 'team';
  if (b === 'g') return f === 'r' ? 'amazon' : f === 'u' ? 'unread' : 'done';
  if (b === 'n') return f === 'r' ? 'team' : f === 'g' ? 'done' : f === 'u' ? 'unread' : 'none';
  return 'unread';                                  // B not read yet: whose it is cannot be told
}
// The two answers for one Listing Rules finding on one child (no dates, no side effects).
function bfCalc(kid, hit, ctx) {
  const det = hit && hit.detector;
  const fn = det && LR_DET[det];
  if (!fn) return { b: 'n', f: 'n' };
  const row = lrFresh(Object.assign({}, kid.row, { brand: kid.brand }), ctx);
  const facts = lrFactsOf(row, ctx);
  const live = facts.live;
  const run = view => {
    try { return fn(view, ctx, hit.params || {}) ? 'r' : 'g'; } catch (e) { return 'u'; }
  };
  const withPics = pics => Object.assign({}, row, { _f: Object.assign({}, facts, { pics }) });
  const amz = facts.amz;
  const buy = amz && amz.st != null && amz.st !== '' ? (/BUYABLE/i.test(String(amz.st)) ? 'g' : 'r') : 'u';
  const shownRead = row.titleSrc === 'live' || row.titleSrc === 'snapshot';
  const catPics = facts.pics && (facts.pics.src === 'live' || facts.pics.src === 'iml');
  if (det === 'title_not_live') return { b: row.submittedTitle ? 'g' : 'u', f: row.submittedTitle && shownRead ? run(row) : 'u' };
  if (BF_TITLE.includes(det)) {
    let b = 'u';
    if (live && live.cAt && live.title) {
      const t = String(live.title);
      b = run(Object.assign({}, row, { shownTitle: t, _f: facts, content: Object.assign({}, row.content || {}, { title: t, titleLen: live.titleLen || t.length }) }));
    }
    return { b, f: shownRead ? run(row) : 'u' };
  }
  if (BF_PICS.includes(det)) {
    const own = live && live.gAt && Array.isArray(live.slots) ? lrGallery(live.slots) : null;
    const b = own ? run(withPics({ n: own.length, main: own.includes('MAIN'), at: live.gAt, src: 'own', own, ids: null, px: null, mainId: '' })) : 'u';
    return { b, f: catPics ? run(row) : 'u' };
  }
  if (BF_PICS_F.includes(det)) return { b: 'n', f: catPics || det === 'main_photo_check' ? run(row) : 'u' };
  if (det === 'aplus_missing') return { b: 'n', f: facts.aplus && facts.aplus.v !== undefined ? run(row) : 'u' };
  if (det === 'amazon_error') return { b: amz ? (amz.ie ? 'r' : 'g') : 'u', f: buy };
  if (det === 'amazon_suppressed') return { b: amz ? (amz.ie ? 'r' : 'g') : 'u', f: amz ? run(row) : 'u' };
  if (BF_BUY.includes(det)) return { b: run(row), f: buy };
  if (BF_B_ONLY.includes(det)) return { b: det === 'keyword_bytes' ? (row.kw == null ? 'u' : run(row)) : (row.content ? run(row) : 'u'), f: 'n' };
  return { b: 'n', f: 'n' };                        // a rule a person checks (manual): no B / F
}
// When this child was first seen B🟢 F🔴 for this problem (ms). Seen again after more than a day away: counted from now.
function bfSince(brand, key, now) {
  if (!BF.ready[brand]) return now;                 // the saved dates are not in yet: nothing is written over them
  const map = BF.first[brand];
  let rec = map[key];
  if (!rec || now - (rec.l || rec.a) > LR_DAY) rec = map[key] = { a: now, l: now };
  else if (now - rec.l > LR_DAY / 4) rec.l = now;
  else return rec.a;
  BF.dirty[brand][key] = rec;
  bfSaveSoon();
  return rec.a;
}
function bfSaveSoon() {
  clearTimeout(BF.saveT);
  BF.saveT = setTimeout(bfSave, 5000);
}
async function bfSave() {
  clearTimeout(BF.saveT);
  BF.saveT = 0;
  for (const brand of ['SP', 'CPC']) {
    const items = BF.dirty[brand];
    if (!Object.keys(items).length) continue;
    BF.dirty[brand] = {};
    try { await lsSave(BF_COLL, 'bfwait_' + brand, { kind: 'bfwait', brand, items }); } catch (e) { /* kept in this browser; written with the next change */ }
  }
}
// The saved first-seen dates of one brand, once.
function bfFirstLoad(brand) {
  if (BF.ready[brand] || BF.loading[brand]) return BF.loading[brand];
  BF.loading[brand] = lsGet(BF_COLL, 'bfwait_' + brand).then(data => {
    Object.entries((data && data.items) || {}).forEach(([key, rec]) => {
      const cur = BF.first[brand][key];
      if (rec && rec.a && (!cur || rec.a < cur.a)) BF.first[brand][key] = { a: rec.a, l: rec.l || rec.a };
    });
  }).catch(() => {}).then(() => {
    BF.ready[brand] = true;
    if (typeof faRedraw === 'function') faRedraw();
  });
  return BF.loading[brand];
}
// The answer with its dates: { b, f, who, since, over } — `over`: B🟢 F🔴 for more than BF_MAX_DAYS (open a case; no more re-checks).
function bfDated(kid, key, ans, now) {
  const who = bfWho(ans.b, ans.f);
  const out = { b: ans.b, f: ans.f, who, since: 0, over: false };
  if (who === 'amazon') {
    out.since = bfSince(kid.brand, kid.sku + '|' + key, now);
    out.over = now - out.since > BF_MAX_DAYS * LR_DAY;
  }
  return out;
}
/** B / F for one child and one Listing Rules finding. */
function bfOf(kid, hit, ctx, now) {
  ctx = ctx || hCtx();
  now = now || Date.now();
  if (!kid || !hit) return { b: 'n', f: 'n', who: 'none', since: 0, over: false };
  bfEnsure();
  let kept = BF.kept.get(kid);
  if (!kept || kept.ctx !== ctx) BF.kept.set(kid, kept = { ctx, map: new Map() });
  const key = hit.detector + (hit.id ? ':' + hit.id : '');
  let ans = kept.map.get(key);
  if (!ans) kept.map.set(key, ans = bfCalc(kid, hit, ctx));
  return bfDated(kid, key, ans, now);
}
/** B / F for an empty spec (`attr`; '' = any of them): B from ?lfix=get, F has no such value. */
function bfSpec(kid, attr, now) {
  bfEnsure();
  const lr = kid && kid.lr;
  let b = 'u';
  if (lr && lr.gAt && lr.specs) b = attr ? (attr in lr.specs ? (lr.specs[attr] ? 'g' : 'r') : 'u') : (Object.values(lr.specs).some(v => !v) ? 'r' : 'g');
  return bfDated(kid, 'spec:' + (attr || '*'), { b, f: 'n' }, now || Date.now());
}

/* ----- drawn ----- */
const bfDot = s => (s === 'n' ? '<span class="fa-bfn" aria-hidden="true">–</span>' : `<i class="fa-bfd is-${s}" aria-hidden="true"></i>`);
const BF_SIDE = { g: 'fine', r: 'the problem is there', u: 'not read yet', n: 'no such value' };
const bfTip = bf => `Seller Central (B): ${BF_SIDE[bf.b]} · What shoppers see (F): ${BF_SIDE[bf.f]}`;
const BF_OVER = 'Amazon still not showing after 3 days — open a case with Amazon';
function bfWords(bf) {
  if (bf.who === 'team') return 'Our team';
  if (bf.who === 'amazon') return bf.over ? BF_OVER : 'Amazon’s side';
  if (bf.who === 'scwrong') return 'Seller Central wrong';
  if (bf.who === 'unread') return 'not read yet';
  if (bf.who === 'done') return 'fixed and showing';
  return '';
}
/** A child's tiny "B ● F ● Our team" (the "Show all" list, the child side panel). '' for a problem with no B / F. */
function bfKidHtml(bf) {
  if (!bf || bf.who === 'none') return '';
  return `<span class="fa-bfk${bf.over ? ' is-old' : ''}" title="${lrEsc(bfTip(bf))}">B${bfDot(bf.b)} F${bfDot(bf.f)} ${lrEsc(bfWords(bf))}</span>`;
}
/** The row's one line: "B🔴F🔴 Our team 14 · B🟢F🔴 Amazon's side 5 · B🔴F🟢 1 · ○ not read yet 2" — only the parts above 0.
 *  `kids` the row's children, `bfs` key → answer. */
function bfLineHtml(kids, bfs) {
  const parts = new Map();
  let unread = 0;
  let over = 0;
  kids.forEach(kid => {
    const bf = bfs.get(faKidKey(kid));
    if (!bf || bf.who === 'none' || bf.who === 'done') return;
    if (bf.who === 'unread') { unread++; return; }
    if (bf.over) over++;
    const k = bf.b + bf.f;
    const p = parts.get(k) || { bf, n: 0 };
    p.n++;
    parts.set(k, p);
  });
  const order = ['rr', 'gr', 'rg'];
  const keys = [...parts.keys()].sort((a, b) => ((order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9)) || a.localeCompare(b));
  const out = keys.map(k => {
    const { bf, n } = parts.get(k);
    const words = bf.who === 'scwrong' ? '' : bf.who === 'amazon' ? 'Amazon’s side ' : 'Our team ';
    const tip = bf.who === 'scwrong' ? 'Shoppers see it fine, but our Seller Central value is wrong' : bf.who === 'amazon' ? 'We fixed it; Amazon is not showing it yet' : 'Not fixed yet';
    const late = bf.who === 'amazon' && over ? ` (${faNf(over)} over 3 days — open a case)` : '';
    return `<span class="fa-bfp" title="${lrEsc(tip + ' · ' + bfTip(bf))}">B${bfDot(bf.b)}F${bfDot(bf.f)} ${words}${faNf(n)}${late}</span>`;
  });
  if (unread) out.push(`<span class="fa-bfp" title="Seller Central or the shop page not read yet">${bfDot('u')} not read yet ${faNf(unread)}</span>`);
  return out.length ? `<div class="fa-bf">${out.join(' · ')}</div>` : '';
}

/* ----- the 10-minute re-check of the B🟢 F🔴 children ----- */
// Which frontend read answers a rule again: the catalogue (title, pictures), A+, or the listing's status.
const bfRead = det => (BF_TITLE.includes(det) || BF_PICS.includes(det) || BF_PICS_F.includes(det) || det === 'title_not_live' ? 'limg'
  : det === 'aplus_missing' ? 'aplus' : 'get');
/** Start the re-check (once) and load the saved first-seen dates. */
function bfEnsure() {
  if (BF.timer) return;
  BF.timer = setInterval(() => bfTick(), BF_RECHECK_MS);
  if (BF.timer && typeof BF.timer.unref === 'function') BF.timer.unref();   // never keeps a test run alive
  ['SP', 'CPC'].forEach(bfFirstLoad);
}
/** Every child that is B🟢 F🔴 now and not past BF_MAX_DAYS: { brand, sku, asin, parent, t } per frontend read it needs. */
function bfDue(now) {
  now = now || Date.now();
  const out = [];
  if (typeof LI_WS === 'undefined' || typeof HEALTH === 'undefined') return out;
  const ctx = hCtx();
  const seen = new Set();
  ['SP', 'CPC'].forEach(brand => {
    const live = (LI_WS.live && LI_WS.live[brand]) || {};
    ((HEALTH[brand] && HEALTH[brand].rows) || []).forEach(row => {
      if (!live[row.sku]) return;                     // never read here: its backend cannot be 🟢
      const kid = liWsChildKept(row, brand, ctx, liWsImlIndex(brand), now);
      if (!kid) return;
      kid.found.forEach(hit => {
        const bf = bfOf(kid, hit, ctx, now);
        if (bf.who !== 'amazon' || bf.over) return;
        const t = bfRead(hit.detector);
        const key = brand + '|' + row.sku + '|' + t;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ key, brand, sku: row.sku, asin: kid.asin || '', parent: row.parent || '', t });
      });
    });
  });
  return out;
}
/** One re-check round: queue the frontend reads of the B🟢 F🔴 children (each once), BF_INFLIGHT at a time. */
function bfTick(now) {
  bfDue(now).forEach(item => {
    if (BF.queued.has(item.key)) return;
    BF.queued.add(item.key);
    BF.q.push(item);
  });
  bfPump();
  return BF.q.length + BF.inflight;
}
function bfPump() {
  while (BF.inflight < BF_INFLIGHT && BF.q.length) {
    const item = BF.q.shift();
    const done = () => {
      BF.inflight--;
      BF.reads++;
      BF.queued.delete(item.key);
      bfPump();
    };
    const asins = [item.asin, item.parent].filter(asin => /^[A-Z0-9]{10}$/.test(String(asin || '')));
    if (item.t === 'aplus' && !asins.length) { BF.queued.delete(item.key); continue; }
    BF.inflight++;
    liWsQueue(item.t === 'aplus' ? { t: 'aplus', brand: item.brand, asins, pk: '', units: asins.length, done }
      : { t: item.t, brand: item.brand, sku: item.sku, pk: '', units: 1, done });
  }
}
