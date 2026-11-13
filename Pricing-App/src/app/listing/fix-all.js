/* ================= LISTING · FIX ALL: one parent's problems grouped by type, on top of its side panel =================
 * Screens: the parent side panel of the Workspace (Listing Health, #lsPanel) and of the Season planner (Listing Optimiser, #spPanel).
 * Does: above the panel's own children list (which stays exactly as it was), three cards — to fix first / need attention / no problem,
 *       Listing Health's own numbers for this parent — then ONE row per problem type in two sections (FIX FIRST, NEEDS ATTENTION):
 *       dot · problem · what we will do · how many children · one button; "› Show all N" lists those children (name · SKU · before →
 *       after) and a click on one opens the panel's own child view. A green line counts the children with no problem.
 * FIX ALL only where the fix is safe and automatic, each child getting ITS OWN fix (its own size, colour, current title):
 *   - season word: the Season planner's own plan for that child (Item Highlights and the hidden search words — never the title);
 *   - title too long: the title template with the brand, product, size and colour (and every part the template requires) kept, ≤ 75;
 *   - an empty spec: only when every sibling that has it uses the SAME value (copied); never a child's own colour or size.
 *   A fix must pass the same checks as a single listing's (spChecks: nothing lost, nothing made up…), must not add a Listing Rules
 *   problem and must clear the problem itself — else that child "needs your OK" with the reason. Pictures, suppressed listings and
 *   Amazon errors have no automatic fix: Open in Image Manager / Listing Errors with those children already picked.
 * Flow: Amazon checks every change first (POST lfix=patch apply:false → VALIDATION_PREVIEW) → "X Amazon will accept · Y Amazon says
 *   no" → To send (X) → Approve & send X / Reject all → each sent child is read again → ✅ Accepted / ❌ Rejected + why / ⏳ Amazon working.
 *   Every change sent is kept with its OLD value in listingrules/fixlog (the backend's own log keeps no old values) — the block's
 *   History lists them and Put back sends the old value again (Amazon's check first). Season changes are also written to the Season
 *   planner's own log (listingrules/seasonlog), so its Put back keeps working. The test site sends nothing: "not sent to Amazon".
 * No backend change: lfix=patch / ?lfix=content / ?lfix=get as they are; the Workspace's read queue (liWsQueue) does the reads.
 * Main functions: faBlockHtml, faGroups, faCards, faPlan, faShortTitle, faStart, faApprove, faVerify, faPutBack, faOpenImg, faOpenLerr.
 * Pricing-App/tests/fix-all-test.js runs this file with the rules, the Workspace and the planner in a stub page. */

const FA_TITLE_MAX = 75;                 // Amazon asks for 75 or less (Item Highlights); the house rule too
const FA_LOG_MAX = 800;                  // change records kept in listingrules/fixlog (old + new titles: well under the 1 MB a document holds)
const FA_WAIT_DAYS = 3;                  // a sent change waits for Amazon this long before the child counts in its row again
const FA_OWN_SPECS = ['color', 'size'];  // every child has its own: never copied from a sibling
const FA_SHOW = 8;                       // children shown under "› Show all N" before "Show more"
let FA = {
  open: new Set(),           // "brand|parent|row" whose children are showing
  more: new Set(),           // …and showing every one of them
  run: null,                 // the Fix all on its way: { brand, parent, row, name, step: check|review|send|sent, items, held, done, total, test }
  log: null,                 // the change records, once read: [{ id, brand, sku, parent, row, name, attr, before, after, at, by, sub, state, why, back }]
  logErr: '',
  logLoading: false,
  vals: { SP: {}, CPC: {} }, // sku → { spec name: { k, text, v } } — the spec values a ?lfix=get brought (kept in memory only)
  valsV: 0,
  reading: new Set(),        // "brand|sku" whose values are being read for a spec copy
  hist: new Set(),           // "brand|parent" whose History is unfolded
  putting: null,             // Put back on its way: { id, step: check|ok|no|send|done, why }
};
const faNf = n => Number(n || 0).toLocaleString('en-US');
const faPl = (n, word) => `${faNf(n)} ${word}${n === 1 ? '' : 's'}`;
const faIsTest = () => typeof window !== 'undefined' && !!window.__TEST_ERP;
const faCut = (text, n) => { const t = String(text == null ? '' : text); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };
const faKidKey = kid => kid.brand + '|' + kid.sku;
const faKidsN = n => (n === 1 ? '1 child' : faNf(n) + ' children');

/* ----- the children and the numbers ----- */
// Every child of one parent, judged exactly as the Workspace and Listing Health judge it (liWsChildKept → healthOf).
function faKids(brand, parent) {
  if (typeof liWsChildKept !== 'function') return [];
  if (!LI_WS.stored) liWsStoreLoad();
  const hc = hCtx();
  const imlMap = liWsImlIndex(brand);
  const now = Date.now();
  return ((HEALTH[brand] && HEALTH[brand].rows) || []).filter(row => (row.parent || row.asin || row.sku || '—') === parent)
    .map(row => liWsChildKept(row, brand, hc, imlMap, now));
}
// The three cards: Listing Health's own numbers for this parent — each child once, by its level (Critical; Needs action + Needs
// review; Healthy + Monitor), over every child, as the parent's header in Listing Health counts them. `unk` = not checked yet.
function faCards(kids) {
  const n = { err: 0, att: 0, ok: 0, unk: 0, all: kids.length };
  kids.forEach(kid => {
    if (kid.bucket === 'critical') n.err++;
    else if (kid.bucket === 'action' || kid.bucket === 'review') n.att++;
    else if (kid.bucket === 'healthy' || kid.bucket === 'monitor') n.ok++;
    else n.unk++;
  });
  return n;
}
// A child as a seller knows it: Colour · Size (from the title Amazon shows), else its SKU.
function faLabel(kid, ctx) {
  const row = lrFresh(Object.assign({}, kid.row, { brand: kid.brand }), ctx || hCtx());
  const size = (hTitleSizes(hTitleText(row))[0] || {}).text || '';
  return [lrColorOf(row), size].filter(Boolean).join(' · ') || kid.sku;
}

/* ----- the problem types ----- */
// What kind of fix a Listing Rules finding has: season (the planner), title (shorten), img (Image Manager), lerr (Listing Errors).
const FA_IMG = ['no_main_image', 'images_below', 'images_between', 'images_small', 'main_not_square', 'images_duplicate', 'main_photo_check'];
function faKindOf(hit, kid) {
  if (hit.detector === 'title_length' && (parseInt(hit.detail, 10) || 0) > FA_TITLE_MAX) return 'title';
  if (FA_IMG.includes(hit.detector)) return 'img';
  return 'lerr';
}
// The Season planner's to-do for one parent: "brand|sku" → its plan (add a season word, take an old one out, put an old title back).
function faSeasonItems(brand, parent) {
  const out = new Map();
  if (typeof spCompute !== 'function') return out;
  spCompute().forEach(item => {
    if (item.brand !== brand || spParentOf(item) !== parent || item.kind !== 'add' || spSkipped(item)) return;   // a season word missing somewhere
    out.set(item.key, item);
  });
  return out;
}
// One row per problem type over these children: { key, kind, name, sev, stale, kids, hits (key → hit), attr, waiting, why }.
// Listing Rules findings grouped by rule (as "What to fix" groups them; a title over 75 is its own row, "Title too long"), the season
// word from the Season planner, and each empty spec (from the live read) as its own row. A child sent a fix for this row in the last
// FA_WAIT_DAYS days waits in `waiting` (Amazon takes a while to show a change), not in the row's count.
function faGroups(brand, parent, kids) {
  const by = new Map();
  const add = (key, base, kid, hit) => {
    const g = by.get(key) || Object.assign({ key, kids: [], hits: new Map(), waiting: [], stale: true, sev: base.sev }, base);
    if (g.hits.has(faKidKey(kid))) return;
    g.kids.push(kid);
    g.hits.set(faKidKey(kid), hit);
    if (!(hit.sev === 'critical' && hit.stale)) g.stale = false;
    if (((LR_SEV[hit.sev] || {}).rank || 0) > ((LR_SEV[g.sev] || {}).rank || 0)) g.sev = hit.sev;
    by.set(key, g);
  };
  const season = faSeasonItems(brand, parent);
  kids.forEach(kid => {
    kid.found.forEach(hit => {
      const kind = faKindOf(hit, kid);
      if (kind === 'season') return add('season', { kind, name: 'Season word', sev: hit.sev, rule: hit.id }, kid, hit);
      if (kind === 'title') return add('title', { kind, name: 'Title too long', sev: hit.sev, rule: hit.id }, kid, hit);
      add('rule:' + (hit.id || hit.detector), { kind, name: hit.name, sev: hit.sev, rule: hit.id, detector: hit.detector }, kid, hit);
    });
    ((kid.c.spec && kid.c.spec.attrs) || []).forEach(attr => add('spec:' + attr, { kind: 'spec', attr, name: `Empty spec: ${attr.replace(/_/g, ' ')}`, sev: 'action' }, kid,
      { sev: 'action', name: 'Specs', detail: attr, fix: '' }));
    const item = season.get(faKidKey(kid));
    if (item) add('season', { kind: 'season', name: 'Season word', sev: 'action' }, kid, { sev: 'action', name: 'Season word', detail: item.kind });
  });
  // the season row's name: the season most of its children need, or the one to take out
  const sg = by.get('season');
  if (sg) sg.season = season;
  if (sg && typeof spTopSeason === 'function') {
    const items = sg.kids.map(kid => season.get(faKidKey(kid))).filter(Boolean);
    const top = spTopSeason(items);
    sg.name = top ? `Season word missing: “${top.e.ev.name}”` : 'Season word missing';
  }
  // a fix sent lately: the child waits for Amazon, out of the row's count
  const sent = faSentMap(brand);
  by.forEach(g => {
    const keep = [];
    g.kids.forEach(kid => {
      const rec = sent.get(faKidKey(kid) + '|' + g.key);
      if (rec) g.waiting.push({ kid, rec });
      else keep.push(kid);
    });
    g.kids = keep;
  });
  by.forEach(g => { g.all = kids; });
  const rank = g => (g.sev === 'critical' ? (g.stale ? 3 : 4) : 1);
  return [...by.values()].filter(g => g.kids.length || g.waiting.length)
    .sort((a, b) => (rank(b) - rank(a)) || (b.kids.length - a.kids.length) || a.name.localeCompare(b.name));
}
// The fix records still waiting for Amazon, per "brand|sku|row": sent in the last FA_WAIT_DAYS days, not rejected, not put back.
function faSentMap(brand) {
  const out = new Map();
  const cut = Date.now() - FA_WAIT_DAYS * LR_DAY;
  (FA.log || []).forEach(rec => {
    if (rec.brand !== brand || rec.at < cut || rec.state === 'rejected' || rec.back) return;
    const k = rec.brand + '|' + rec.sku + '|' + rec.row;
    if (!out.has(k)) out.set(k, rec);                  // newest first in the log
  });
  return out;
}

/* ----- one child's fix: the SAME function for Fix all and for one child alone ----- */
// { key, brand, sku, label, ok, wait, why, before, after, patches, pt, sent: { title, kw, hl, spec }, item }. `ok`: safe to send.
// `wait`: not known yet (reading from Amazon). Nothing here reads or writes; the same inputs always give the same answer.
function faPlan(g, kid, ctx) {
  const base = { key: faKidKey(kid), brand: kid.brand, sku: kid.sku, asin: kid.asin, label: faLabel(kid, ctx), row: g.key, kind: g.kind, attr: g.attr || '', ok: false, wait: false, why: '' };
  if (g.kind === 'season') return Object.assign(base, faSeasonPlan(g, kid));
  if (g.kind === 'title') return Object.assign(base, faTitlePlan(g, kid, ctx));
  if (g.kind === 'spec') return Object.assign(base, faSpecPlan(g, kid));
  return Object.assign(base, { why: g.kind === 'img' ? 'pictures are changed by a person in Image Manager' : 'no safe automatic fix — a person fixes it in Listing Errors' });
}
// Season: exactly the Season planner's plan for the child (what its own Fix button would send): Item Highlights and the hidden search
// words only — the title is never changed.
function faSeasonPlan(g, kid) {
  const item = g.season && g.season.get(faKidKey(kid));
  if (!item) return { why: 'the Season planner has nothing to add here' };
  const out = { item, before: '', after: null, pt: item.pt };
  if (item.status === 'reading') return Object.assign(out, { wait: true, why: 'reading it from Amazon first' });
  if (item.status === 'fix') return Object.assign(out, { why: item.why || 'no safe automatic change' });
  if (item.status !== 'ready' || !item.pt) return Object.assign(out, { why: item.status === 'ok' ? 'already up to date' : 'not read from Amazon yet' });
  if (!spChanges(item)) return Object.assign(out, { why: 'nothing would change' });
  const sent = {};
  if (item.kwAfter != null && item.kwAfter !== item.kw) sent.kw = item.kwAfter;
  if (spHlChanged(item)) sent.hl = item.hlAfter.slice();
  return Object.assign(out, { ok: true, patches: spPatches(item), sent, what: spDoLineWords(item),
    beforeKw: item.kw, beforeHl: item.hl ? item.hl.slice() : null });
}
// The title the template writes for this child at 75 letters or less: every part it REQUIRES kept (brand, product, size, colour…),
// the others left out one by one — the season names first (a shortened title never gains a season word), then the uses, the print,
// whatever else is not required. { before, after } or { before, why }.
function faShortTitle(kid, ctx) {
  const row = lrFresh(Object.assign({}, kid.row, { brand: kid.brand }), ctx);
  const before = hTitleText(row);
  const tpl = lrTemplateFor(row, ctx.cfg);
  if (!tpl) return { before, why: 'no title template for this product in Listing Rules' };
  const parts = lrParts(row, tpl, ctx.cfg, ctx.today);
  const need = lrWords(tpl.required || 'brand,product,size,color');
  const lack = ['brand', 'product', 'size', 'color'].concat(need).filter((key, i, all) => all.indexOf(key) === i && !parts[key]);
  if (lack.length) return { before, why: `the catalogue has no ${lack.map(key => (key === 'color' ? 'colour' : key)).join(' or ')} for it` };
  const tokens = (String(tpl.template || '').match(/\{(\w+)\}/g) || []).map(token => token.slice(1, -1));
  const drop = ['occasions'];
  const fill = () => String(tpl.template || '').replace(/\{(\w+)\}/g, (_, key) => (drop.includes(key) ? '' : (parts[key] || '')))
    .replace(/\s+-\s+(?=-|$)/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+-\s*$/, '').replace(/^\s*-\s+/, '').trim();
  let after = fill();
  const order = ['uses', 'pattern'].concat(tokens.filter(key => !['uses', 'pattern', 'occasions'].includes(key))).filter(key => !need.includes(key) && tokens.includes(key));
  for (const key of order) {
    if (after.length <= FA_TITLE_MAX) break;
    drop.push(key);
    after = fill();
  }
  if (after.length > FA_TITLE_MAX) return { before, why: `even with only the parts the template requires it is ${after.length} letters` };
  return { before, after };
}
// The Listing Rules over a listing as it is, title-wise: rule id → name. Every detector, as healthOf runs them.
function faJudge(row, ctx) {
  const out = new Map();
  (ctx.cfg.issues || []).forEach(rule => {
    if (rule.on === false || !LR_SEV[rule.sev]) return;
    const det = LR_DET[rule.detector];
    if (!det) return;
    let res = '';
    try { res = det(row, ctx, rule.params || {}) || ''; } catch (e) { res = ''; }
    if (res) out.set(rule.id, rule.name);
  });
  return out;
}
// What a new title would do to the Listing Rules: the problems it would ADD, and whether `target` (the rule being fixed) still fires.
function faWorse(kid, ctx, title, target) {
  const was = lrFresh(Object.assign({}, kid.row, { brand: kid.brand }), ctx);
  const now = Object.assign({}, was, { shownTitle: title, submittedTitle: title, content: Object.assign({}, was.content || {}, { title, titleLen: title.length }) });
  delete now._f;
  const a = faJudge(was, ctx);
  const b = faJudge(now, ctx);
  return { added: [...b.keys()].filter(id => !a.has(id)).map(id => b.get(id)), still: !!target && b.has(target) };
}
// Title too long → the template's 75-letter title for this child, through every check a single listing's change passes.
function faTitlePlan(g, kid, ctx) {
  const short = faShortTitle(kid, ctx);
  const out = { before: short.before };
  if (!short.after) return Object.assign(out, { why: short.why });
  out.after = short.after;
  const pt = kid.lr && kid.lr.pt;
  const row = lrFresh(Object.assign({}, kid.row, { brand: kid.brand }), ctx);
  const checks = typeof spChecks === 'function' ? spChecks(short.before, short.after, row, ctx, ctx.today) : [];
  const bad = checks.find(check => check.ok === false);
  if (bad) return Object.assign(out, { checks, why: bad.why || bad.t });
  const warn = checks.find(check => check.ok === 'warn' && !check.pre);
  if (warn) return Object.assign(out, { checks, why: warn.t });
  const hit = g.hits.get(faKidKey(kid));
  const worse = faWorse(kid, ctx, short.after, hit && hit.id);
  if (worse.added.length) return Object.assign(out, { checks, why: 'it would add: ' + worse.added.join(', ') });
  if (worse.still) return Object.assign(out, { checks, why: `the new title is still outside the rule's length (${short.after.length} letters)` });
  if (!pt) return Object.assign(out, { checks, wait: true, why: 'read it from Amazon first (its product type is not known yet)' });
  return Object.assign(out, { ok: true, checks, pt, what: `Shorten to ${short.after.length} letters`, oldTitle: row.submittedTitle || short.before,
    patches: [{ op: 'replace', path: '/attributes/item_name', value: [{ value: short.after, language_tag: 'en_US' }] }], sent: { title: short.after } });
}
// An empty spec → the value every sibling that has it uses, copied as Amazon holds it; only when they ALL use the same one.
function faSpecPlan(g, kid) {
  const attr = g.attr;
  const out = { before: '(empty)' };
  if (FA_OWN_SPECS.includes(attr)) return Object.assign(out, { why: `each child has its own ${attr} — fill it in by hand` });
  const sibs = (g.all || faSiblings(kid)).filter(sib => sib.sku !== kid.sku).filter(sib => sib.lr && sib.lr.specs && sib.lr.specs[attr]);
  if (!sibs.length) return Object.assign(out, { why: 'no other child has it filled' });
  const vals = sibs.map(sib => (FA.vals[sib.brand][sib.sku] || {})[attr]);
  if (vals.some(v => !v)) return Object.assign(out, { wait: true, why: `reading the value from ${faKidsN(vals.filter(v => !v).length).replace('child', 'other child')}`, need: sibs.filter((sib, i) => !vals[i]).map(sib => sib.sku) });
  const distinct = [...new Map(vals.map(v => [v.k, v])).values()];
  if (distinct.length > 1) return Object.assign(out, { why: `the other children use different values (${distinct.slice(0, 3).map(v => '“' + faCut(v.text, 30) + '”').join(', ')}${distinct.length > 3 ? '…' : ''})` });
  const pt = kid.lr && kid.lr.pt;
  if (!pt) return Object.assign(out, { wait: true, why: 'read it from Amazon first (its product type is not known yet)' });
  return Object.assign(out, { ok: true, pt, after: distinct[0].text, what: `Copy “${faCut(distinct[0].text, 40)}” from ${faKidsN(sibs.length).replace('child', 'other child')}`,
    patches: [{ op: 'replace', path: '/attributes/' + attr, value: JSON.parse(JSON.stringify(distinct[0].v)) }], sent: { spec: attr } });
}
// The other children of the same parent (the Workspace's judged records).
function faSiblings(kid) {
  const parent = kid.row.parent || kid.row.asin || kid.row.sku || '—';
  return faKids(kid.brand, parent).filter(other => other.sku !== kid.sku);
}
// A ?lfix=get answer landed (listing-workspace.js calls this): keep the listing's spec values — what the copy reads. Only in memory.
function faOnGet(brand, sku, attributes) {
  if (!FA.vals[brand]) return;
  const keep = {};
  (typeof LI_WS_SPECS !== 'undefined' ? LI_WS_SPECS : []).forEach(name => {
    const entries = (attributes || {})[name];
    if (!Array.isArray(entries) || !entries.length) return;
    const v = JSON.parse(JSON.stringify(entries));
    const canon = JSON.stringify(v.map(e => faCanon(e)));
    if (canon.length > 2000) return;                   // too big to copy safely
    keep[name] = { k: canon, text: faValText(v), v };
  });
  FA.vals[brand][sku] = keep;
  FA.valsV++;
}
// One attribute entry with marketplace and language aside and its keys in order — two children "use the same value" when these match.
function faCanon(entry) {
  if (Array.isArray(entry)) return entry.map(faCanon);
  if (!entry || typeof entry !== 'object') return entry;
  const out = {};
  Object.keys(entry).sort().forEach(key => { if (key !== 'marketplace_id' && key !== 'language_tag') out[key] = faCanon(entry[key]); });
  return out;
}
// The value in words: every leaf value, joined.
function faValText(entries) {
  const leaves = [];
  const walk = x => {
    if (x == null) return;
    if (Array.isArray(x)) return x.forEach(walk);
    if (typeof x === 'object') return Object.keys(x).forEach(key => { if (key !== 'marketplace_id' && key !== 'language_tag') walk(x[key]); });
    leaves.push(String(x));
  };
  walk(entries);
  return leaves.join(' · ');
}
// Read the spec values of these siblings (once each), through the Workspace's queue.
function faNeedVals(brand, skus) {
  if (typeof liWsQueue !== 'function') return;
  skus.forEach(sku => {
    const key = brand + '|' + sku;
    if (FA.reading.has(key) || FA.vals[brand][sku]) return;
    FA.reading.add(key);
    liWsQueue({ t: 'get', brand, sku, units: 1, pk: '', mark: [key], done: () => { FA.reading.delete(key); } });
  });
}
// Every child's plan for one row (the rows' "Fix all N" count, the "Show all" list): kept per child until what it reads changes.
const FA_PLAN_KEEP = new WeakMap();
function faPlans(g, ctx) {
  return g.kids.map(kid => {
    const item = g.season ? g.season.get(faKidKey(kid)) || null : null;
    const sig = [ctx, item, g.key, FA.valsV, g.attr ? LI_WS.liveV : 0, g.attr ? g.all.length : 0];
    let keep = FA_PLAN_KEEP.get(kid);
    if (!keep) FA_PLAN_KEEP.set(kid, keep = new Map());
    const was = keep.get(g.key);
    if (was && was.sig.every((part, i) => part === sig[i])) return was.plan;
    const plan = faPlan(g, kid, ctx);
    keep.set(g.key, { sig, plan });
    return plan;
  });
}

/* ----- the block ----- */
// One plain line: what we will do for this row.
function faDoLine(g, plans) {
  const safe = plans.filter(p => p.ok);
  if (g.kind === 'season') {
    const top = typeof spTopSeason === 'function' ? spTopSeason(safe.map(p => p.item)) : null;
    return top ? `Add “${top.e.ev.name}” to Item Highlights and the hidden search words where it is missing — the title never changes`
      : 'Each change needs a person to look at it first';
  }
  if (g.kind === 'title') return `Shorten to ${FA_TITLE_MAX} letters with the title template — brand, product, size and colour kept`;
  if (g.kind === 'spec') {
    if (FA_OWN_SPECS.includes(g.attr)) return `Each child has its own ${g.attr} — fill it in by hand in Listing Errors`;
    const one = safe[0];
    return one ? `Copy ${one.what.replace(/^Copy /, '')}` : plans.some(p => p.wait) ? 'Reading the other children’s value from Amazon…' : 'The other children don’t agree on one value — fill it in by hand';
  }
  if (g.kind === 'img') return 'Change the pictures in Image Manager — no automatic fix';
  const fix = new Map();
  g.kids.forEach(kid => { const hit = g.hits.get(faKidKey(kid)); if (hit && hit.fix) fix.set(hit.fix, (fix.get(hit.fix) || 0) + 1); });
  return [...fix.entries()].sort((a, b) => b[1] - a[1]).map(([text]) => text)[0] || 'Fix it in Listing Errors';
}
// The row's ONE button: Fix all N (the safe ones), else where a person fixes it, with those children already picked.
function faRowButton(gk, g, plans) {
  const safe = plans.filter(p => p.ok).length;
  const busy = FA.run && FA.run.step !== 'sent';
  if (safe) return `<button type="button" class="fa-btn fa-main" data-fa-act="fix" data-fa-row="${lrEsc(gk)}"${busy ? ' disabled title="Finish the Fix all that is open first"' : ''}>Fix all ${faNf(safe)}</button>`;
  if (plans.some(p => p.wait)) return '<button type="button" class="fa-btn" disabled>Checking…</button>';
  if (g.kind === 'img') return `<button type="button" class="fa-btn" data-fa-act="img" data-fa-row="${lrEsc(gk)}">Open in Image Manager</button>`;
  return `<button type="button" class="fa-btn" data-fa-act="lerr" data-fa-row="${lrEsc(gk)}">Open in Listing Errors</button>`;
}
// "before → after" for a child under "Show all": the plan's change, or why it needs a person, or the problem itself.
function faKidChange(g, plan, kid) {
  const hit = g.hits.get(faKidKey(kid));
  if (plan.ok) {
    if (plan.after != null && plan.before !== plan.after) return `<span class="fa-was">${lrEsc(faCut(plan.before, 90))}</span> → <span class="fa-new">${lrEsc(faCut(plan.after, 90))}</span>`;
    return `<span class="fa-new">${lrEsc(plan.what || 'Ready')}</span>`;
  }
  if (g.kind === 'title' || g.kind === 'season' || g.kind === 'spec') return `<span class="fa-why">${plan.wait ? '… ' : '⚠ Needs your OK: '}${lrEsc(plan.why)}</span>`;
  return `<span class="fa-why">${lrEsc(hit ? (hit.what || hit.detail || hit.name) : '')}</span>`;
}
function faKidsHtml(gk, g, plans) {
  const all = FA.more.has(gk);
  const shown = all ? g.kids : g.kids.slice(0, FA_SHOW);
  const safeKind = g.kind === 'title' || g.kind === 'season' || g.kind === 'spec';
  const busy = FA.run && FA.run.step !== 'sent';
  const rows = shown.map(kid => {
    const plan = plans[g.kids.indexOf(kid)];
    const one = safeKind && plan.ok ? `<button type="button" class="fa-btn fa-small" data-fa-act="one" data-fa-row="${lrEsc(gk)}" data-fa-sku="${lrEsc(kid.sku)}"${busy ? ' disabled' : ''} title="Fix only this child">Fix</button>` : '';
    return `<div class="fa-kid"><button type="button" class="fa-kid-o" data-fa-act="kid" data-fa-kid="${lrEsc(faKidKey(kid))}"><b>${lrEsc(plan.label)}</b><small>${lrEsc(kid.sku)}</small>`
      + `<span class="fa-chg">${faKidChange(g, plan, kid)}</span></button>${one}</div>`;
  }).join('');
  const more = g.kids.length > shown.length ? `<button type="button" class="fa-link" data-fa-act="kmore" data-fa-row="${lrEsc(gk)}">Show the other ${faNf(g.kids.length - shown.length)}</button>` : '';
  const wait = g.waiting.length ? `<div class="fa-waitl">⏳ ${faKidsN(g.waiting.length)} sent lately — waiting for Amazon to show the change: ${g.waiting.slice(0, 6).map(w => lrEsc(w.kid.sku)).join(', ')}${g.waiting.length > 6 ? '…' : ''}</div>` : '';
  return `<div class="fa-kids">${rows}${more}${wait}</div>`;
}
// The whole block for one parent. `kids`: its judged children when the caller has them (the Workspace), else read here.
function faBlockHtml(brand, parent, kids) {
  try {
    return faBlockInner(brand, parent, kids || faKids(brand, parent));
  } catch (e) {
    return `<div class="fa"><div class="fa-err">Could not group this parent's problems: ${lrEsc((e && e.message) || e)}</div></div>`;
  }
}
function faBlockInner(brand, parent, kids) {
  if (!FA.log && !FA.logLoading) faLogLoad();
  const ctx = hCtx();
  const n = faCards(kids);
  const groups = faGroups(brand, parent, kids);
  const pk = brand + '|' + parent;
  const card = (cls, num, words) => `<div class="fa-card ${cls}${num ? '' : ' is-zero'}"><b>${faNf(num)}</b><span>${words}</span></div>`;
  const cards = `<div class="fa-cards">${card('is-err', n.err, 'problems to fix first')}${card('is-att', n.att, 'need attention')}${card('is-ok', n.ok, n.ok === 1 ? 'child with no problem' : 'children with no problem')}</div>`;
  const row = g => {
    const gk = pk + '|' + g.key;
    const plans = faPlans(g, ctx);
    if (g.kind === 'spec') { const need = [...new Set(plans.flatMap(p => p.need || []))]; if (need.length) faNeedVals(brand, need); }
    const open = FA.open.has(gk);
    const cls = g.sev === 'critical' ? (g.stale ? 'is-chk' : 'is-err') : 'is-att';
    const count = g.kids.length ? faKidsN(g.kids.length) : 'waiting';
    const show = g.kids.length ? `<button type="button" class="fa-link" data-fa-act="more" data-fa-row="${lrEsc(gk)}" aria-expanded="${open}">${open ? '⌄ Hide' : '› Show all ' + faNf(g.kids.length)}</button>` : '';
    return `<div class="fa-row ${cls}"><span class="fa-dot" aria-hidden="true"></span><div class="fa-row-t"><b>${lrEsc(g.name)}</b><small>${lrEsc(faDoLine(g, plans))}</small>${show}</div>`
      + `<span class="fa-n">${count}</span>${g.kids.length ? faRowButton(gk, g, plans) : ''}</div>` + (open || (!g.kids.length && g.waiting.length) ? faKidsHtml(gk, g, plans) : '');
  };
  const first = groups.filter(g => g.sev === 'critical');
  const att = groups.filter(g => g.sev !== 'critical');
  const sec = (title, list) => (list.length ? `<div class="fa-sec"><div class="fa-sec-h">${title}</div>${list.map(row).join('')}</div>` : '');
  const okLine = `<div class="fa-okline"><span aria-hidden="true">✓</span> ${n.ok === 1 ? '1 child has' : faNf(n.ok) + ' children have'} no problem · Nothing to do${n.unk ? ` · ${faNf(n.unk)} not checked yet` : ''}</div>`;
  const run = FA.run && FA.run.brand === brand && FA.run.parent === parent ? faRunHtml(FA.run) : '';
  return `<section class="fa" aria-label="This parent's problems">${cards}${run}${sec('Fix first', first)}${sec('Needs attention', att)}${okLine}${faHistHtml(brand, parent)}</section>`;
}

/* ----- Fix all: Amazon's check, the review, the send, the re-read ----- */
// Start a Fix all on one row (or one child of it): plan each child, keep the safe ones, ask Amazon about each (nothing is sent yet).
async function faStart(gk, onlySku) {
  if (FA.run && FA.run.step !== 'sent') return;
  const [brand, parent, ...rest] = gk.split('|');
  const rowKey = rest.join('|');
  const kids = faKids(brand, parent);
  const g = faGroups(brand, parent, kids).find(each => each.key === rowKey);
  if (!g) return;
  const ctx = hCtx();
  const plans = faPlans(g, ctx).filter(p => !onlySku || p.sku === onlySku);
  const run = { brand, parent, row: rowKey, gk, name: g.name, kind: g.kind, attr: g.attr || '', step: 'check', items: plans.filter(p => p.ok).map(p => Object.assign({}, p, { state: 'checking' })),
    held: plans.filter(p => !p.ok), done: 0, total: 0, test: faIsTest(), at: Date.now() };
  run.total = run.items.length;
  FA.run = run;
  faRedraw();
  if (!run.items.length) { run.step = 'review'; return faRedraw(); }
  if (run.test) {
    run.items.forEach(it => { it.state = 'test'; });
    run.step = 'review';
    return faRedraw();
  }
  for (const it of run.items) {
    if (FA.run !== run) return;                        // Reject all pressed meanwhile
    const reply = await faPost(it, false);
    it.state = reply.ok ? 'ok' : 'no';
    it.why = reply.ok ? '' : faReason(reply);
    run.done++;
    faRedraw();
  }
  run.step = 'review';
  faRedraw();
}
// One call to the backend's patch: apply false = Amazon's check only (VALIDATION_PREVIEW), true = the real change (checked again first).
async function faPost(it, apply) {
  try {
    return await imPost({ lfix: 'patch', brand: it.brand, sku: it.sku, productType: it.pt, patches: it.patches, apply, by: (typeof ME !== 'undefined' && ME.email) || '' });
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}
// Amazon's reason in plain words (the planner's wording when it is there).
function faReason(reply) {
  const errs = (reply.issues || []).filter(issue => String(issue.severity || '').toUpperCase() === 'ERROR').map(issue => issue.message);
  const raw = String(reply.error || errs[0] || 'Amazon did not accept it').replace(/^Amazon would reject this:\s*/i, '');
  return typeof spPlainReason === 'function' ? spPlainReason(raw) : faCut(raw, 220);
}
// Approve & send: the ones Amazon accepted, one by one; each kept with its old value; then each is read again from Amazon.
async function faApprove() {
  const run = FA.run;
  if (!run || run.step !== 'review') return;
  const todo = run.items.filter(it => it.state === 'ok');
  if (run.test) {
    run.items.forEach(it => { it.state = 'notsent'; });
    run.step = 'sent';
    return faRedraw();
  }
  if (!todo.length) return;
  run.step = 'send';
  run.done = 0;
  run.total = todo.length;
  faRedraw();
  const records = [];
  const seasonRecs = [];
  const now = Date.now();
  for (const it of todo) {
    const reply = await faPost(it, true);
    if (reply.ok && !reply.previewOnly) {
      it.state = 'working';
      it.sub = reply.submissionId || '';
      it.sentAt = Date.now();
      const rec = faRecord(it, run, now, it.sub);
      records.push(rec);
      it.rec = rec.id;
      if (it.item) seasonRecs.push(faSeasonRecord(it, now));
      faLiveAfterSend(it, now);
    } else {
      it.state = 'rejected';
      it.why = faReason(reply);
    }
    run.done++;
    faRedraw();
  }
  run.logErr = records.length ? await faLogAdd(records) : '';
  if (seasonRecs.length && typeof spLogAdd === 'function') {
    const err = await spLogAdd(seasonRecs);
    if (err && !run.logErr) run.logErr = err;
    if (typeof spRedrawAll === 'function') SP.itemsKey = '';
  }
  run.step = 'sent';
  faReread(run.items.filter(it => it.state === 'working'));
  faRedraw();
}
// What a sent change is kept as: the OLD value of every field it changed, so Put back can send it again.
function faRecord(it, run, now, sub) {
  const before = {};
  const after = {};
  if (it.sent.title != null) { before.title = it.oldTitle || it.before; after.title = it.sent.title; }   // our own submitted title, when it was read
  if (it.sent.kw != null) { before.kw = it.beforeKw == null ? '' : it.beforeKw; after.kw = it.sent.kw; }
  if (it.sent.hl != null) { before.hl = it.beforeHl || []; after.hl = it.sent.hl; }
  if (it.sent.spec) { before.spec = null; after.spec = it.patches[0].value; }
  return { id: `${it.brand}|${it.sku}|${now}|${run.row}`, brand: it.brand, sku: it.sku, parent: run.parent, row: run.row, name: run.name, attr: run.attr,
    label: it.label, pt: it.pt, before, after, at: now, by: (typeof ME !== 'undefined' && ME.email) || '', sub: sub || '', state: 'working', why: '' };
}
// The Season planner's own record for a season change (its Put back reads listingrules/seasonlog).
function faSeasonRecord(it, now) {
  const item = it.item;
  return { brand: item.brand, sku: item.sku, asin: item.asin, kind: item.kind, seasons: item.seasons.slice(), at: now, by: (typeof ME !== 'undefined' && ME.email) || '',
    before: Object.assign({ title: item.title, kw: item.kw }, item.hl ? { hl: item.hl.slice() } : {}),
    after: Object.assign({ title: item.after, kw: item.kwAfter != null ? item.kwAfter : item.kw }, item.hl ? { hl: (item.hlAfter || item.hl).slice() } : {}), sub: it.sub || '' };
}
// What was sent is now what the listing holds, as far as every screen knows (our submitted values; the title Amazon SHOWS stays
// as read until Amazon shows the new one).
function faLiveAfterSend(it, now) {
  if (typeof liWsEntry !== 'function') return;
  const entry = liWsEntry(it.brand, it.sku);
  const s = it.sent;
  Object.assign(entry, { at: now, err: '', cErr: '' });
  if (s.title != null) Object.assign(entry, { title: s.title.slice(0, 220), titleLen: s.title.length }, entry.cAt ? { cAt: now } : {});
  if (s.kw != null) Object.assign(entry, { kw: s.kw.slice(0, 300), kwBytes: lrKwBytes(s.kw) });
  if (s.hl != null) Object.assign(entry, { hl: s.hl.slice(), hlAt: now });
  if (s.spec) entry.specs = Object.assign({}, entry.specs || {}, { [s.spec]: true });
  LI_WS.liveV++;
  if (typeof liWsStoreSave === 'function') liWsStoreSave();
}
// Read the sent children again from Amazon (content: title and search words; get: issues, Item Highlights, specs); when both reads of
// a child are in, say what Amazon did with it.
function faReread(items) {
  if (typeof liWsQueue !== 'function' || !items.length) return;
  const by = { SP: [], CPC: [] };
  items.forEach(it => { it.left = 2; by[it.brand].push(it); });
  const landed = it => () => {
    it.left--;
    if (it.left <= 0) faVerify(it);
    faRedraw();
  };
  ['SP', 'CPC'].forEach(brand => {
    for (let i = 0; i < by[brand].length; i += LI_WS_BATCH) {
      const batch = by[brand].slice(i, i + LI_WS_BATCH);
      const done = batch.map(landed);
      liWsQueue({ t: 'content', brand, skus: batch.map(it => it.sku), units: batch.length, pk: '', mark: batch.map(it => it.key), done: () => done.forEach(fn => fn()) });
    }
    by[brand].forEach(it => liWsQueue({ t: 'get', brand, sku: it.sku, units: 1, pk: '', mark: [it.key], done: landed(it) }));
  });
}
// After the re-read: ❌ Rejected when Amazon now reports an ERROR on a field we changed, ✅ Accepted when the listing holds what was
// sent, else ⏳ Amazon is still working on it. The record follows.
function faVerify(it) {
  const entry = (LI_WS.live[it.brand] || {})[it.sku];
  if (!entry) return;
  const attrs = it.patches.map(p => p.path.replace('/attributes/', ''));
  const err = (entry.iss || []).find(issue => issue.s === 'E' && (issue.a || []).some(a => attrs.includes(a)));
  const s = it.sent;
  const same = (s.title == null || lrSameTitle(entry.title, s.title)) && (s.kw == null || String(entry.kw || '') === s.kw.slice(0, 300))
    && (s.hl == null || JSON.stringify(entry.hl || []) === JSON.stringify(s.hl.map(v => v.slice(0, 300)))) && (!s.spec || !!(entry.specs && entry.specs[s.spec]));
  if (err) { it.state = 'rejected'; it.why = typeof spPlainReason === 'function' ? spPlainReason(err.m) : err.m; }
  else it.state = same ? 'accepted' : 'working';
  const rec = (FA.log || []).find(each => each.id === it.rec);
  if (rec && rec.state !== it.state) {
    rec.state = it.state;
    rec.why = it.why || '';
    faLogSave();
  }
}
// Reject all: nothing is sent; the plan is dropped.
function faReject() {
  FA.run = null;
  faRedraw();
}
// The run, in plain words: Amazon's check (progress), its answer and To send, the send (progress), each child's outcome.
function faRunHtml(run) {
  const st = { checking: '… Asking Amazon', ok: '✓ Amazon will accept', no: '✕ Amazon says no', test: 'Test site — not sent to Amazon', working: '⏳ Amazon working',
    accepted: '✅ Accepted', rejected: '❌ Rejected', notsent: 'Not sent to Amazon (test site)' };
  const line = it => `<div class="fa-item is-${it.state}"><button type="button" class="fa-kid-o" data-fa-act="kid" data-fa-kid="${lrEsc(it.key)}"><b>${lrEsc(it.label)}</b><small>${lrEsc(it.sku)}</small>`
    + `<span class="fa-chg">${it.after != null && it.before !== it.after ? `<span class="fa-was">${lrEsc(faCut(it.before, 80))}</span> → <span class="fa-new">${lrEsc(faCut(it.after, 80))}</span>` : `<span class="fa-new">${lrEsc(it.what || '')}</span>`}</span></button>`
    + `<span class="fa-st">${st[it.state] || ''}${it.why ? ` <span class="fa-why">${lrEsc(it.why)}</span>` : ''}</span></div>`;
  const held = run.held.length ? `<details class="fa-held"><summary>⚠ ${faKidsN(run.held.length)} need${run.held.length === 1 ? 's' : ''} your OK</summary>`
    + run.held.map(p => `<div class="fa-item"><button type="button" class="fa-kid-o" data-fa-act="kid" data-fa-kid="${lrEsc(p.key)}"><b>${lrEsc(p.label)}</b><small>${lrEsc(p.sku)}</small><span class="fa-chg"><span class="fa-why">${lrEsc(p.why)}</span></span></button></div>`).join('') + '</details>' : '';
  const okN = run.items.filter(it => it.state === 'ok').length;
  const noN = run.items.filter(it => it.state === 'no').length;
  const heldWhy = run.held.length ? ` · ${faNf(run.held.length)} need your OK (${lrEsc(faCut([...new Set(run.held.map(p => p.why))].slice(0, 2).join('; '), 120))})` : '';
  let head;
  let body = '';
  let bar = '';
  if (run.step === 'check') {
    head = `Asking Amazon about ${faPl(run.total, 'change')}… ${faNf(run.done)} of ${faNf(run.total)}`;
    body = `<div class="fa-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${run.total}" aria-valuenow="${run.done}"><span style="width:${run.total ? Math.round(run.done * 100 / run.total) : 0}%"></span></div>`;
    bar = '<button type="button" class="fa-btn" data-fa-act="reject">Stop</button>';
  } else if (run.step === 'review') {
    if (run.test) head = `Test site — not sent to Amazon. ${faPl(run.items.length, 'change')} would go to Amazon's check${heldWhy}`;
    else if (!run.items.length) head = `Nothing can be fixed automatically here${heldWhy}`;
    else head = `${faNf(okN)} Amazon will accept · ${faNf(noN)} Amazon says no${heldWhy}`;
    const go = run.items.filter(it => it.state === 'ok' || it.state === 'test');
    const no = run.items.filter(it => it.state === 'no');
    body = (go.length ? `<div class="fa-sub">To send (${faNf(go.length)})</div>${go.map(line).join('')}` : '') + (no.length ? `<div class="fa-sub">Amazon says no (${faNf(no.length)})</div>${no.map(line).join('')}` : '') + held;
    bar = run.test ? '<button type="button" class="fa-btn fa-main" data-fa-act="approve">Close — not sent to Amazon</button>'
      : (okN ? `<button type="button" class="fa-btn fa-main" data-fa-act="approve">Approve &amp; send ${faNf(okN)}</button>` : '') + `<button type="button" class="fa-btn" data-fa-act="reject">${okN ? 'Reject all' : 'Close'}</button>`;
  } else if (run.step === 'send') {
    head = `Sending ${faNf(run.done)} of ${faNf(run.total)}… Amazon checks each one again first.`;
    body = `<div class="fa-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${run.total}" aria-valuenow="${run.done}"><span style="width:${run.total ? Math.round(run.done * 100 / run.total) : 0}%"></span></div>`;
  } else {
    const c = k => run.items.filter(it => it.state === k).length;
    head = run.test ? 'Test site — not sent to Amazon.' : [c('accepted') ? `✅ ${faNf(c('accepted'))} accepted` : '', c('working') ? `⏳ ${faNf(c('working'))} Amazon working` : '',
      c('rejected') ? `❌ ${faNf(c('rejected'))} rejected` : '', c('no') ? `✕ ${faNf(c('no'))} Amazon said no` : ''].filter(Boolean).join(' · ') + heldWhy;
    const reading = run.items.some(it => it.left > 0);
    body = run.items.map(line).join('') + held + (run.logErr ? `<div class="fa-err">⚠ Sent, but the note of the old values could not be saved (${lrEsc(run.logErr)}) — keep a copy.</div>` : '');
    bar = (run.test ? '' : `<button type="button" class="fa-btn" data-fa-act="recheck"${reading ? ' disabled' : ''}>${reading ? 'Reading from Amazon…' : 'Check again'}</button>`)
      + '<button type="button" class="fa-btn" data-fa-act="close">Close</button>';
  }
  return `<div class="fa-run" role="status"><div class="fa-run-h"><b>Fix all: ${lrEsc(run.name)}</b><span>${head}</span></div>${body}<div class="fa-run-a">${bar}</div></div>`;
}

/* ----- the change records: listingrules/fixlog — History and Put back ----- */
async function faLogLoad() {
  if (FA.log || FA.logLoading) return FA.log;
  FA.logLoading = true;
  try {
    const snap = await getDoc(doc(db, 'listingrules', 'fixlog'));
    FA.log = snap.exists() ? (snap.data().rows || []) : [];
    FA.logErr = '';
  } catch (e) {
    FA.log = [];
    FA.logErr = String((e && e.message) || e);
  }
  FA.logLoading = false;
  faRedraw();
  return FA.log;
}
async function faLogAdd(rows) {
  if (!FA.log) await faLogLoad();
  FA.log = rows.concat(FA.log).slice(0, FA_LOG_MAX);
  return faLogSave();
}
async function faLogSave() {
  try {
    await setDoc(doc(db, 'listingrules', 'fixlog'), { rows: FA.log, at: serverTimestamp() });
    return '';
  } catch (e) {
    return String((e && e.message) || e);
  }
}
// History: the changes sent from this block for this parent, newest first, each with its state and Put back.
function faHistHtml(brand, parent) {
  const recs = (FA.log || []).filter(rec => rec.brand === brand && rec.parent === parent);
  if (!recs.length) return '';
  const pk = brand + '|' + parent;
  const open = FA.hist.has(pk);
  const st = { working: '⏳ Amazon working', accepted: '✅ Accepted', rejected: '❌ Rejected', sent: 'Sent' };
  const day = at => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const text = (rec, side) => { const v = rec[side] || {}; return v.title != null ? v.title : v.kw != null ? 'Search words: ' + v.kw : v.hl ? 'Item Highlights: ' + v.hl.join(' · ') : v.spec ? faValText(v.spec) : '(empty)'; };
  const put = rec => {
    const p = FA.putting && FA.putting.id === rec.id ? FA.putting : null;
    if (rec.back) return `<span class="fa-st">↺ Put back ${day(rec.back)}</span>`;
    if (!p) return `<button type="button" class="fa-btn fa-small" data-fa-act="putback" data-fa-id="${lrEsc(rec.id)}"${FA.putting ? ' disabled' : ''}>Put back</button>`;
    if (p.step === 'check') return '<span class="fa-st">… Asking Amazon</span>';
    if (p.step === 'send') return '<span class="fa-st">Sending…</span>';
    if (p.step === 'no') return `<span class="fa-st">✕ Amazon says no <span class="fa-why">${lrEsc(p.why)}</span></span><button type="button" class="fa-btn fa-small" data-fa-act="putcancel">Close</button>`;
    if (p.step === 'test') return '<span class="fa-st">Test site — not sent to Amazon</span><button type="button" class="fa-btn fa-small" data-fa-act="putcancel">Close</button>';
    return `<span class="fa-st">✓ Amazon will accept</span><button type="button" class="fa-btn fa-small fa-main" data-fa-act="putsend">Send put back</button><button type="button" class="fa-btn fa-small" data-fa-act="putcancel">Cancel</button>`;
  };
  return `<details class="fa-hist"${open ? ' open' : ''}><summary data-fa-act="hist" data-fa-g="${lrEsc(pk)}">History · ${faPl(recs.length, 'change')} sent from here</summary>`
    + recs.slice(0, 40).map(rec => `<div class="fa-item"><div class="fa-kid-o"><b>${lrEsc(rec.label || rec.sku)}</b><small>${lrEsc(rec.sku)} · ${lrEsc(rec.name)} · ${day(rec.at)}${rec.by ? ' · ' + lrEsc(String(rec.by).split('@')[0]) : ''}</small>`
      + `<span class="fa-chg"><span class="fa-was">${lrEsc(faCut(text(rec, 'before'), 80))}</span> → <span class="fa-new">${lrEsc(faCut(text(rec, 'after'), 80))}</span></span></div>`
      + `<span class="fa-st">${st[rec.state] || ''}${rec.why ? ` <span class="fa-why">${lrEsc(rec.why)}</span>` : ''}</span>${put(rec)}</div>`).join('') + '</details>';
}
// The patches that put a record's old values back.
function faBackPatches(rec) {
  const b = rec.before || {};
  const out = [];
  if (b.title != null) out.push({ op: 'replace', path: '/attributes/item_name', value: [{ value: b.title, language_tag: 'en_US' }] });
  if (b.kw != null) out.push(b.kw ? { op: 'replace', path: '/attributes/generic_keyword', value: [{ value: b.kw, language_tag: 'en_US' }] } : { op: 'delete', path: '/attributes/generic_keyword' });
  if (b.hl != null) out.push(b.hl.length ? { op: 'replace', path: '/attributes/' + SP_HL_ATTR, value: b.hl.map(value => ({ value, language_tag: 'en_US' })) } : { op: 'delete', path: '/attributes/' + SP_HL_ATTR });
  if ('spec' in b && rec.attr) out.push({ op: 'delete', path: '/attributes/' + rec.attr });
  return out;
}
// Put back, step 1: Amazon's check of the old values (nothing is sent yet).
async function faPutBack(id) {
  const rec = (FA.log || []).find(each => each.id === id);
  if (!rec || FA.putting) return;
  FA.putting = { id, step: 'check', why: '' };
  faRedraw();
  if (faIsTest()) { FA.putting.step = 'test'; return faRedraw(); }
  const reply = await faPost({ brand: rec.brand, sku: rec.sku, pt: rec.pt, patches: faBackPatches(rec) }, false);
  if (!FA.putting || FA.putting.id !== id) return;
  FA.putting.step = reply.ok ? 'ok' : 'no';
  FA.putting.why = reply.ok ? '' : faReason(reply);
  faRedraw();
}
// …step 2: send it, mark the record, and the listing holds the old values again as far as every screen knows.
async function faPutSend() {
  const p = FA.putting;
  const rec = p && (FA.log || []).find(each => each.id === p.id);
  if (!rec || p.step !== 'ok') return;
  p.step = 'send';
  faRedraw();
  const reply = await faPost({ brand: rec.brand, sku: rec.sku, pt: rec.pt, patches: faBackPatches(rec) }, true);
  if (reply.ok && !reply.previewOnly) {
    rec.back = Date.now();
    rec.backBy = (typeof ME !== 'undefined' && ME.email) || '';
    const b = rec.before || {};
    faLiveAfterSend({ brand: rec.brand, sku: rec.sku, sent: { title: b.title, kw: b.kw, hl: b.hl } }, rec.back);
    if ('spec' in b && rec.attr && typeof liWsEntry === 'function') { const entry = liWsEntry(rec.brand, rec.sku); entry.specs = Object.assign({}, entry.specs || {}, { [rec.attr]: false }); }
    FA.putting = null;
    await faLogSave();
  } else {
    p.step = 'no';
    p.why = faReason(reply);
  }
  faRedraw();
}

/* ----- where a person fixes it: Image Manager / Listing Errors, those children already picked ----- */
function faRowKids(gk) {
  const [brand, parent, ...rest] = gk.split('|');
  const g = faGroups(brand, parent, faKids(brand, parent)).find(each => each.key === rest.join('|'));
  return g ? { brand, parent, g, skus: g.kids.map(kid => kid.sku) } : null;
}
const faWhoName = (brand, parent) => (typeof parentName === 'function' ? parentName(brand, parent, '') : parent) || parent;
function faOpenImg(gk) {
  const r = faRowKids(gk);
  if (!r) return;
  $('imBrand').value = r.brand;
  if (typeof IM_SEL !== 'undefined') { IM_SEL.clear(); r.skus.forEach(sku => IM_SEL.add(sku)); }
  if (typeof imOnly === 'function') imOnly(r.skus, `${faCut(faWhoName(r.brand, r.parent), 50)} · ${r.g.name}`);
  showTab('img');
  if (typeof imListRender === 'function') imListRender();
  window.scrollTo(0, 0);
}
function faOpenLerr(gk) {
  const r = faRowKids(gk);
  if (!r) return;
  $('leBrand').value = r.brand;
  if (typeof leOnly === 'function') leOnly(r.skus, `${faCut(faWhoName(r.brand, r.parent), 50)} · ${r.g.name}`);
  showTab('lerr');
  if (typeof leShow === 'function') leShow(false);
  if (typeof leListEnsure === 'function') leListEnsure();
  window.scrollTo(0, 0);
}

/* ----- drawing again, and the one click listener ----- */
// Redraw whichever panel shows a block: the Workspace's and the Season planner's.
function faRedraw() {
  if (typeof LI_WS !== 'undefined' && LI_WS.panel && typeof liWsPanelRender === 'function') liWsPanelRender();
  if (typeof SP !== 'undefined' && SP.panel && typeof spPanelsRender === 'function') spPanelsRender();
}
// A child clicked in the block opens the panel's own child view: the Workspace's child component, or the Season planner's child panel.
function faOpenKid(btn, key) {
  const inSp = btn && btn.closest && btn.closest('#spPanel');
  if (inSp && typeof spOpenKid === 'function') return spOpenKid(key);
  if (typeof liWsPanelKid === 'function' && LI_WS.panel) return liWsPanelKid(key);
  if (typeof spOpenKid === 'function' && SP.panel) spOpenKid(key);
}
function faClick(btn) {
  const act = btn.dataset.faAct;
  const gk = btn.dataset.faRow || '';
  if (act === 'more') { if (FA.open.has(gk)) FA.open.delete(gk); else FA.open.add(gk); return faRedraw(); }
  if (act === 'kmore') { FA.more.add(gk); return faRedraw(); }
  if (act === 'fix') return faStart(gk);
  if (act === 'one') return faStart(gk, btn.dataset.faSku);
  if (act === 'kid') return faOpenKid(btn, btn.dataset.faKid);
  if (act === 'img') return faOpenImg(gk);
  if (act === 'lerr') return faOpenLerr(gk);
  if (act === 'approve') return faApprove();
  if (act === 'reject' || act === 'close') return faReject();
  if (act === 'recheck') return FA.run && faReread(FA.run.items.filter(it => !!it.rec));
  if (act === 'hist') { const pk = btn.dataset.faG; if (FA.hist.has(pk)) FA.hist.delete(pk); else FA.hist.add(pk); return faRedraw(); }
  if (act === 'putback') return faPutBack(btn.dataset.faId);
  if (act === 'putsend') return faPutSend();
  if (act === 'putcancel') { FA.putting = null; return faRedraw(); }
}
if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', e => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-fa-act]') : null;
  if (!btn || btn.disabled) return;
  if (btn.tagName === 'SUMMARY') e.preventDefault();   // the History fold opens through the redraw (FA.hist), not twice
  faClick(btn);
});
