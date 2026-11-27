/* ================= LISTING · FIX ALL SEARCH TERMS: one click for "Search terms over the limit", many children at once =================
 * Screens: Listing Health → Workspace (a parent's "Search terms over the limit" row in the Fix all block, fix-all.js) and Listing Errors
 *          (a card above its list: per family, and Select all). Same look and flow as the other Fix all rows.
 * HOW THE NEW SEARCH TERMS ARE MADE — automatic (kfShorten). From each child's current search terms, shortened to the limit by THE ONE
 * SEARCH-TERMS RULE (listing-rules.js lrKwCheck: 249 bytes, spaces and ; , . not counted), and the words chosen by THE ONE SUGGESTION-WORDS
 * RULE (listing-rules.js lrSuggestWords — the same for every screen). OUR WORD RULES (27 Nov 2026): our brands (Ridhi, Whimsical Corner,
 * CPC, Cotton Print Club) and the important words (hand, block print, its product, its real shape, its material, its own colour, its
 * size, use words) are never taken out the first time they appear; always out: every word said again (the first stays; plural = the
 * same word), other brands' names, ASINs; then WINNING WORDS are added (listing/kw-win.js: words of the searches other brands win for
 * this product type — never one the title already says, never another brand's name); then, one at a time until it fits: a shape or
 * colour that is not the product's, low-value and joining words, the weakest winning word added, then other words (the ones the title
 * says first). Only important words left and still over: nothing is cut — "Only important words left — edit by hand". No winning-keyword
 * data (or older than 45 days): nothing is added — said in the popup.
 * RISKY WORDS ALSO GO (IP & Trademark Guard, 18 Nov 2026 — ip-guard.js ipgKwRisk): another brand's name ("Pottery Barn", also as "Pottery
 *   Barn style") and a restricted claim ("organic") are taken out of every text this popup fixes — except a word the team marked "Allowed
 *   on purpose" for that listing or its family. A text WITHIN the limit that holds a risky word can be fixed here too (the Guard screen's
 *   Fix opens this same popup): then ONLY the risky words go — nothing else is touched.
 * PREVIEW (kfPreview, one popup for the whole family, the existing #spModal): every child — SKU, colour · size, bytes before → after, the
 *   removed words struck through, its new text editable — a search box, Select all and a tick per child; the total on top ("38 children ·
 *   all will be ≤ 249 bytes"). Check with Amazon & send → THE ONE SEND PATH (listing-send-check.js sqSendWithCheck: Amazon's check →
 *   Approve & send, one by one with progress → read again → "36 accepted · 2 rejected (reason)"). Every change goes to Listing History
 *   (screen "Search terms · Fix all") and to fix-all.js's change log (the block's History, Put back). The test site sends nothing.
 * The full text: Sellora keeps a listing's search terms cut short (300 letters in a live read, 500 a value in the ListingMatch cache); a
 *   child whose kept text may be cut is read from Amazon (?lfix=get) when the preview opens, so no word is ever dropped unseen.
 * No backend change: ?lfix=get and POST lfix=patch as they are.
 * Main functions: kfShorten, kfItemOf, kfPlan, kfStartGroup (Workspace), kfLeCardHtml / kfLeStart (Listing Errors), kfPreview, kfGo, kfReport.
 * Pricing-App/tests/kw-fix-test.js runs it with the rules, the Workspace, Fix all and the send path in a stub page. */

const KF_STOP = ['a', 'an', 'and', 'the', 'for', 'with', 'of', 'in', 'on', 'to'];
const KF_SCREEN = 'Search terms · Fix all';
const KF_LM_CUT = 500;         // the ListingMatch cache keeps a search-terms value up to this many letters (ListingMatch.gs vals(…, 500))
let KF = { run: null, full: new Map(), last: new Map(), memo: null, hLoading: false };   // full: "brand|sku" → { kw, pt, at } read whole

/* ----- the words ----- */
const kfEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
// SMOOTH (18 Nov 2026): one number format made once — the same text as toLocaleString('en-US'), which makes a new one per number
const KF_NUM = new Intl.NumberFormat('en-US');
const kfNf = n => KF_NUM.format(Number(n || 0));
// A word as compared: lower case, its letters and digits only.
const kfNorm = w => String(w || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
// The text in words, as written: [{ raw, w (the punctuation round it gone), k (compared) }].
function kfTokens(text) {
  return [...String(text || '').matchAll(/[^\s,;|]+/g)].map(m => {
    const raw = m[0];
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    return { raw, w, k: kfNorm(w), at: m.index };                 // at: where the word starts in the text
  });
}
// OUR brand names — KEPT once since 27 Nov 2026 (Listing Rules' "Our brand words" + the brand Amazon shows for the listing; the rule adds
// Ridhi, Whimsical Corner, CPC and Cotton Print Club itself) — each as its words in order ("whimsical corner").
function kfBrands(row, cfg) {
  const ours = typeof lrBrandWords === 'function' ? lrBrandWords(row || {}, cfg) : [];
  return [...new Set(ours.map(p => kfTokens(p).map(t => t.k).filter(Boolean).join(' ')).filter(Boolean))];
}
// OTHER brands' names to take out: the winning-keyword data's brands and the watched ones (kw-win.js kwOthers); the IP & Trademark Guard's
// step takes its own list out when it is there (it knows "Allowed on purpose") — else Listing Rules' list (allow.otherBrands) is used here.
function kfOthers(cfg) {
  if (typeof kwOthers === 'function') return kwOthers(cfg);
  return typeof ipgKwRisk === 'function' ? [] : String(((cfg && cfg.allow) || {}).otherBrands || '').split(',').map(s => s.trim()).filter(Boolean);
}
const KF_ASIN = /^b0[a-z0-9]{8}$/;

/** THE SEARCH TERMS SUGGESTED. kw: the search terms now; o: { title, brands: ['ridhi', 'whimsical corner'] (ours: kept once), others (other
 *  brands' names: out), add (winning words [{ w, why }], best first — kw-win.js kwWinFor), max, risk, riskOnly, facts }. Which words go and
 *  which are added is THE ONE SUGGESTION-WORDS RULE (listing-rules.js lrSuggestWords; o.facts = lrSwFacts of the listing).
 *  o.risk(text) → [{ s, e, why }]: the risky words' places in the text (ip-guard.js) — every word there goes, first. o.riskOnly: a text
 *  within the limit loses ONLY its risky words (the rest is for fitting the limit — nothing is added then).
 *  → { before, after, removed: [{ w, why, i, risk }], added: [{ w, why }], notAdded, bytesBefore, bytesAfter, over (before), fits (after ≤
 *  max), cut (other words went), important (only important words left and still over), risky }. */
function kfShorten(kw, o) {
  o = o || {};
  const max = o.max || (typeof lrKwMax === 'function' ? lrKwMax() : 249);
  const before = String(kw || '');
  const over = lrKwCheck(before, max).over;
  // a text within the limit that is here for its risky words only: they go, the rest is as written (not even its punctuation changes)
  const riskOnly = !!o.riskOnly && !over;
  const r = lrSuggestWords(before, { mode: 'kw', facts: o.facts || null, title: o.title, brands: o.brands || [], others: o.others || [], add: o.add || null, proof: o.proof || null, risk: o.risk, riskOnly,
    fits: text => !lrKwCheck(text, max).over });
  const toks = r.toks;
  // risky words only: the text as the person wrote it (their commas and semicolons too) with those words cut out of it
  const cutOut = () => {
    let t = before;
    toks.filter(x => x.out).sort((a, b) => b.at - a.at).forEach(x => { t = t.slice(0, x.at) + t.slice(x.at + x.raw.length); });
    return t.replace(/\s*([,;|])(?:\s*[,;|])+/g, '$1').replace(/\s+([,;|])/g, '$1').replace(/\s{2,}/g, ' ').replace(/^[\s,;|]+|[\s,;|]+$/g, '');
  };
  const after = riskOnly ? cutOut() : r.after;
  return { before, after, removed: r.removed, added: riskOnly ? [] : (r.added || []), notAdded: riskOnly ? [] : (r.notAdded || []), toks, risky: r.risky, bytesBefore: lrKwBytes(before), bytesAfter: lrKwBytes(after), over,
    fits: !lrKwCheck(after, max).over, cut: r.cut, important: !riskOnly && r.important, max };
}

/* ----- one child: its search terms (whole), title, brand words, product type ----- */
/** { key, brand, sku, asin, parent, label, title, kw, full (the whole text is known), pt, brands } — from the freshest data every screen
 *  judges with (lrFresh: a live read, else the ListingMatch cache, else the snapshot), the cache's longer copy when that one was cut, or a
 *  whole read made for this (KF.full). */
function kfItemOf(brand, row, ctx, kid) {
  const fresh = lrFresh(Object.assign({}, row, { brand }), ctx);
  const key = brand + '|' + row.sku;
  const m = typeof lmGet === 'function' ? lmGet(row.sku, brand) : null;
  const read = KF.full.get(key);
  let kw = fresh.kw == null ? '' : String(fresh.kw);
  const bytes = fresh.kwBytes != null ? fresh.kwBytes : lrKwBytes(kw);   // counted on the whole text when it was read
  const lmKw = m && m.kw ? String(m.kw) : '';
  const lmCut = lmKw.length >= KF_LM_CUT;                                  // the cache's copy may itself be cut
  // whole: the text holds every byte counted, and it is not the cache's possibly cut copy (or is longer than it)
  let full = lrKwBytes(kw) >= bytes && (!lmCut || lrKwBytes(kw) > lrKwBytes(lmKw));
  if (!full && lmKw && !lmCut && lrKwBytes(lmKw) >= bytes) { kw = lmKw; full = true; }   // a live read kept 300 letters; the cache has it whole
  if (read) { kw = read.kw; full = true; }                                 // read whole for this, from Amazon
  const label = kid && typeof faLabel === 'function' ? faLabel(kid, ctx) : [typeof lrColorOf === 'function' ? lrColorOf(fresh) : '', (hTitleSizes(hTitleText(fresh), lrIsRound(fresh))[0] || {}).text || ''].filter(Boolean).join(' · ') || row.sku;
  const pt = (read && read.pt) || (kid && kid.lr && kid.lr.pt) || (m && m.pt) || '';
  const title = hTitleText(fresh);
  // what the suggestion-words rule protects for this listing (its product, real shape, material, own colour, size)
  const facts = lrSwFacts(fresh, ctx.cfg, null, { pt });
  return { key, brand, sku: row.sku, asin: row.asin || '', parent: row.parent || row.asin || row.sku || '—', label, title, kw, full, pt, brands: kfBrands(fresh, ctx.cfg),
    facts, others: kfOthers(ctx.cfg),
    // the winning words this listing may take (kw-win.js: Brand Analytics, its product type), best first — none without fresh data
    // (28 Nov 2026) its family's PROVEN words from our own ads first, by orders — then the Brand Analytics words
    win: typeof kwWinFor === 'function' ? kwWinFor({ brand, sku: row.sku, asin: row.asin || fresh.asin, parent: row.parent || fresh.parent, price: row.price != null ? row.price : fresh.price, title, kw, facts, pt, cfg: ctx.cfg }) : null,
    // the risky words of this listing's search terms (IP & Trademark Guard), the ones allowed on purpose left out
    risk: typeof ipgKwRisk === 'function' ? ipgKwRisk(brand, row.sku, fresh, ctx.cfg) : null };
}
/** One child's fix: { ok, wait, why, before, after, removed, b0, b1, patches, sent, beforeKw, pt } — the same function for every screen. */
function kfPlan(item) {
  const s = kfShorten(item.kw, { title: item.title, brands: item.brands, others: item.others, add: item.win ? item.win.words : null, proof: item.win ? item.win.proof : null, risk: item.risk, riskOnly: true, facts: item.facts });
  const out = { key: item.key, brand: item.brand, sku: item.sku, asin: item.asin, label: item.label, parent: item.parent, kind: 'kw', ok: false, wait: false, why: '',
    before: s.before, after: s.after, removed: s.removed, added: s.added, notAdded: s.notAdded, toks: s.toks, b0: s.bytesBefore, b1: s.bytesAfter, max: s.max, cut: s.cut, beforeKw: s.before, over: s.over, risky: s.risky,
    win: item.win ? { status: item.win.status, ppc: item.win.ppc, type: item.win.type, n: item.win.words.length } : null, skipped: item.win ? item.win.skipped || [] : [] };
  if (!s.over && !s.risky) return Object.assign(out, { why: `already within the limit (${kfNf(s.bytesBefore)} of ${s.max} bytes)${typeof ipgKwRisk === 'function' ? ' and no risky word' : ''}` });
  if (!item.full) return Object.assign(out, { wait: true, why: 'reading the whole search terms from Amazon first' });
  if (!s.fits) return Object.assign(out, { why: s.important ? LR_SW_IMPORTANT : 'could not be made to fit' });
  // nothing but risky words in it: Amazon takes no empty text — a person clears the field in Listing Errors
  if (!s.after.trim()) return Object.assign(out, { why: 'only risky words in it — clear the search terms by hand in Listing Errors' });
  if (!item.pt) return Object.assign(out, { wait: true, why: 'read it from Amazon first (its product type is not known yet)' });
  const riskyWords = s.removed.filter(r => r.risk).length;
  const plus = s.added.length ? ` · + ${s.added.length === 1 ? '1 winning word' : kfNf(s.added.length) + ' winning words'}` : '';
  return Object.assign(out, { ok: true, pt: item.pt, what: (s.over ? `Shorten to ${kfNf(s.bytesAfter)} bytes` : `Take out ${riskyWords === 1 ? '1 risky word' : kfNf(riskyWords) + ' risky words'}`) + plus, sent: { kw: s.after },
    patches: kfPatches(s.after) });
}
const kfPatches = text => [{ op: 'replace', path: '/attributes/generic_keyword', value: [{ value: text, language_tag: 'en_US' }] }];
// The whole search terms of these children from Amazon (?lfix=get), one at a time: what the preview needs for a text Sellora keeps cut.
async function kfReadFull(items, onStep) {
  for (const it of items) {
    try {
      const reply = await baCall({ lfix: 'get', brand: it.brand, sku: it.sku });
      const at = (reply && reply.attributes) || {};
      const kw = (at.generic_keyword || []).map(v => String(v && v.value != null ? v.value : '')).filter(Boolean).join(' ');
      KF.full.set(it.key, { kw, pt: (reply && reply.productType) || it.pt || '', at: Date.now() });
      if (typeof lmNoteLive === 'function') lmNoteLive(it.brand, it.sku, 'get', reply);
    } catch (e) { /* stays "reading": named in the preview with its reason */ }
    if (onStep) onStep();
  }
}

/* ----- the Workspace: the "Search terms over the limit" row of fix-all.js ----- */
// A Workspace child (fix-all.js faKids) → its plan (fix-all.js faPlan calls this for the row's kind 'kw').
function kfPlanOfKid(kid, ctx) {
  const p = kfPlan(kfItemOf(kid.brand, kid.row, ctx, kid));
  return Object.assign(p, { label: p.label });
}
// Fix all on the row (or one child of it): the preview popup over its children.
function kfStartGroup(g, brand, parent, onlySku) {
  const ctx = hCtx();
  const items = g.kids.filter(kid => !onlySku || kid.sku === onlySku).map(kid => kfItemOf(brand, kid.row, ctx, kid));
  const name = typeof faWhoName === 'function' ? faWhoName(brand, parent) : parent;
  return kfPreview(items, { title: (typeof faCut === 'function' ? faCut(name, 60) : name), row: g.key, name: g.name, brand, parent });
}

/* ----- Listing Errors: the card above its list ----- */
// The children of a brand over the limit, as Listing Health judges them (healthOf: the keyword_bytes rule) — not the ones sent lately
// (fix-all.js's log: waiting for Amazon). [{ row, hit }], kept until what they are judged on changes.
function kfOverRows(brand) {
  if (typeof HEALTH === 'undefined' || !HEALTH[brand] || !(HEALTH[brand].rows || []).length) return [];
  const ctx = hCtx();
  const sig = [ctx, brand, typeof LI_WS !== 'undefined' ? LI_WS.liveV : 0, (typeof FA !== 'undefined' && FA.log) ? FA.log.length : -1, HEALTH[brand].rows.length];
  if (KF.memo && KF.memo.sig.every((x, i) => x === sig[i])) return KF.memo.rows;
  const sent = typeof faSentMap === 'function' ? faSentMap(brand) : new Map();
  const rows = [];
  const now = Date.now();
  HEALTH[brand].rows.forEach(row => {
    // SMOOTH (18 Nov 2026): Listing Health's kept checks for this row (the same healthOf behind the same signature), not a second judging
    const scored = Object.assign({}, row, { brand });
    const h = typeof hHealthKept === 'function' ? hHealthKept(row, scored, ctx, now) : healthOf(scored, ctx);
    const hit = h.found.find(x => x.detector === 'keyword_bytes');
    if (hit && !sent.has(brand + '|' + row.sku + '|rule:' + (hit.id || hit.detector))) rows.push({ row, hit });
  });
  KF.memo = { sig, rows };
  return rows;
}
// The card: "Search terms over the limit: N listings in M families [Fix all N]", and per family its own "Fix all n children".
function kfLeCardHtml(brand, only) {
  if (typeof HEALTH === 'undefined' || !(typeof H_LOADED !== 'undefined' && H_LOADED)) {
    if (!KF.hLoading && typeof loadHealthCache === 'function') {
      KF.hLoading = true;
      Promise.resolve(loadHealthCache()).then(() => { KF.hLoading = false; if (typeof leRender === 'function') leRender(); }).catch(() => { KF.hLoading = false; });
    }
    return '';
  }
  if (typeof FA !== 'undefined' && !FA.log && !FA.logLoading && typeof faLogLoad === 'function') faLogLoad().then(() => { if (typeof leRender === 'function') leRender(); });
  const rows = kfOverRows(brand).filter(r => !only || only.has(r.row.sku));
  const last = KF.last.get(brand);
  if (!rows.length) return last ? `<div class="card kf-le"><span class="kf-le-t">Search terms · Fix all: ${kfEsc(last)}</span></div>` : '';
  const fams = new Map();
  rows.forEach(r => { const p = r.row.parent || r.row.asin || r.row.sku || '—'; if (!fams.has(p)) fams.set(p, []); fams.get(p).push(r); });
  const busy = typeof sqIsOpen === 'function' && sqIsOpen();
  const name = p => (typeof parentName === 'function' ? parentName(brand, p, '') : '') || p;
  const list = [...fams.entries()].sort((a, b) => b[1].length - a[1].length || String(name(a[0])).localeCompare(String(name(b[0]))))
    .map(([p, rs]) => `<div class="kf-le-fam"><b>${kfEsc(String(name(p)).slice(0, 80))}</b><small>${kfEsc(p)} · ${rs.length === 1 ? '1 child' : kfNf(rs.length) + ' children'} over the limit</small>`
      + `<button type="button" class="fa-btn" data-kf-le="fam" data-kf-brand="${kfEsc(brand)}" data-kf-parent="${kfEsc(p)}"${busy ? ' disabled' : ''}>Fix all ${rs.length === 1 ? '1 child' : kfNf(rs.length) + ' children'}</button></div>`).join('');
  return `<div class="card kf-le"><div class="kf-le-h"><span class="kf-le-t"><b>Search terms over the limit:</b> ${kfNf(rows.length)} listing${rows.length === 1 ? '' : 's'} in ${kfNf(fams.size)} famil${fams.size === 1 ? 'y' : 'ies'}`
    + ` <span class="muted">— shortened to ${typeof lrKwMax === 'function' ? lrKwMax() : 249} bytes by our word rules; winning words added when they fit</span>${last ? ` <span class="muted">· last Fix all: ${kfEsc(last)}</span>` : ''}</span>`
    + `<button type="button" class="fa-btn fa-main" data-kf-le="all" data-kf-brand="${kfEsc(brand)}"${busy ? ' disabled' : ''}>Select all · Fix all ${kfNf(rows.length)}</button></div>`
    + `<details class="kf-le-list"><summary>› Show the ${kfNf(fams.size)} famil${fams.size === 1 ? 'y' : 'ies'}</summary>${list}</details></div>`;
}
// A Listing Errors button: one family, or every listing over the limit in view.
function kfLeStart(brand, parent, only) {
  const ctx = hCtx();
  const rows = kfOverRows(brand).filter(r => (!only || only.has(r.row.sku)) && (!parent || (r.row.parent || r.row.asin || r.row.sku || '—') === parent));
  if (!rows.length) return null;
  const name = parent ? ((typeof parentName === 'function' ? parentName(brand, parent, '') : '') || parent) : `every ${(typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand} listing over the limit`;
  return kfPreview(rows.map(r => kfItemOf(brand, r.row, ctx, null)), { title: String(name).slice(0, 60), row: 'rule:' + (rows[0].hit.id || rows[0].hit.detector), name: rows[0].hit.name, brand, parent: parent || '' });
}

/* ----- the preview: one popup for the whole family ----- */
/** items: kfItemOf records; o: { title, row (fix-all.js's row key, for the waiting list), name, brand, parent }. Reads the whole text of
 *  the children Sellora keeps cut, then shows the popup. Returns a promise of the send's summary (or null when cancelled). */
async function kfPreview(items, o) {
  if (typeof sqIsOpen === 'function' && sqIsOpen()) return null;
  const run = { items, o: o || {}, plans: [], sel: new Set(), edit: new Map(), q: '', reading: 0, total: 0, closed: false };
  KF.run = run;
  run.promise = new Promise(resolve => { run.resolve = resolve; });
  // the "Allowed on purpose" marks (IP & Trademark Guard) are read before the plans are made: an allowed word is never taken out
  if (typeof ipgOkLoad === 'function' && typeof IPG !== 'undefined' && !IPG.okLoaded) { try { await ipgOkLoad(); } catch (e) { /* the popup shows every word it takes out */ } if (run.closed) return run.promise; }
  // the winning-keyword data (kw-win.js) too: read once per visit, then each child's winning words are worked out again from it
  if (typeof kwLoad === 'function' && typeof KW !== 'undefined' && !KW.loaded) {
    try { await kwLoad(); } catch (e) { /* the popup says "No winning-keyword data" */ }
    if (run.closed) return run.promise;
    const ctx0 = hCtx();
    run.items = items = items.map(it => (it.win && ((it.win.status && it.win.status.loading) || (it.win.ppc && it.win.ppc.loading)) ? Object.assign({}, it, { win: kwWinFor({ brand: it.brand, sku: it.sku, asin: it.asin, parent: it.parent, title: it.title, kw: it.kw, facts: it.facts, pt: it.pt, cfg: ctx0.cfg }) }) : it));
  }
  const need = items.filter(it => !it.full || !it.pt);
  if (need.length) {
    run.total = need.length;
    kfDraw();
    await kfReadFull(need, () => { run.reading++; kfDraw(); });
    if (run.closed) return run.promise;
    const ctx = hCtx();
    run.items = items = items.map(it => (need.includes(it) ? Object.assign({}, it, kfItemOf(it.brand, kfRowOf(it), ctx, null), { label: it.label }) : it));
  }
  run.plans = items.map(kfPlan);
  // a child still not known whole after the read (Amazon did not answer): named with its reason, never sent
  run.plans.forEach(p => { if (p.wait) Object.assign(p, { wait: false, why: /whole search terms/.test(p.why) ? 'its whole search terms could not be read from Amazon — try again' : p.why }); });
  run.plans.forEach(p => { if (p.ok) run.sel.add(p.key); });
  if (typeof aiPreset === 'function') aiPreset('kf', run);          // ✨ AI (listing-ai.js): the IP & Trademark Guard's AI rewrite, as the row's edit
  run.total = 0;
  kfDraw();
  return run.promise;
}
// The Listing Health row of an item (to judge it again after its whole text was read).
const kfRowOf = it => ((HEALTH[it.brand] && HEALTH[it.brand].rows) || []).find(r => r.sku === it.sku) || { sku: it.sku, asin: it.asin, parent: it.parent };
// The new text of a child: the person's edit, else the plan's.
const kfText = (run, p) => (run.edit.has(p.key) ? run.edit.get(p.key) : p.after);
// A reason as the popup says it: duplicate · other brand · low value · limit (kw-win.js kwWhyLabel; the rule's own words without it).
const kfWhy = why => (typeof kwWhyLabel === 'function' ? kwWhyLabel(why) : why);
const KF_LOCK = { brand: 'our brand', identity: 'hand block print', product: 'its product', shape: 'its shape', material: 'its material', colour: 'its colour', size: 'its size', uses: 'a use word', keep: 'a season on now' };
/** The words of the old text: the removed ones struck through with their reason, the protected ones kept 🔒 (our brands and the important
 *  words, once per phrase), the winning words added marked "+ word" with why, and an added word the limit took out again. */
function kfDiffHtml(p) {
  const why = new Map(p.removed.map(r => [r.i, r.why === 'replaced' && r.by ? `replaced by ${r.by} (no orders)` : r.why]));
  let lastCls = '';
  const old = (p.toks || []).filter(t => !t.added).map(t => {
    if (why.has(t.i)) { lastCls = ''; const w = kfWhy(why.get(t.i)); return `<s class="kf-cut${t.risk ? ' is-risk' : ''}" title="${kfEsc(w)}">${kfEsc(t.raw)}</s><small class="kf-why">${kfEsc(w)}</small>`; }
    const lock = t.cls && t.cls !== lastCls && KF_LOCK[t.cls];
    lastCls = t.cls || '';
    return lock ? `<span class="kf-lock" title="protected: ${kfEsc(KF_LOCK[t.cls])}">🔒${kfEsc(t.w || t.raw)}</span>` : kfEsc(t.w || t.raw);
  });
  const added = (p.added || []).map(a => `<ins class="kf-add" title="${kfEsc(a.why)}">+ ${kfEsc(a.w)}</ins>`);
  return old.concat(added).join(' ');
}
// Under a child's words: every winning word added, with its reason; those the limit took out again.
function kfAddedHtml(p) {
  // a proven word that took the room of the listing's own unproven words says which: "replaces elegant, stylish (no orders)"
  const add = (p.added || []).map(a => `<li><ins class="kf-add">+ ${kfEsc(a.w)}</ins> <span class="muted">(${kfEsc(a.why)})</span>${a.replaces && a.replaces.length ? ` <span class="kf-repl">replaces ${kfEsc(a.replaces.join(', '))} (no orders)</span>` : ''}</li>`).join('');
  const not = (p.notAdded || []).length ? `<li class="muted">Not added (no room within the limit): ${kfEsc(p.notAdded.slice(0, 8).map(a => a.w).join(', '))}${p.notAdded.length > 8 ? ` +${kfNf(p.notAdded.length - 8)}` : ''}</li>` : '';
  // (29 Nov 2026) the words of searches Sellora is not sure describe this product: never added, said
  const sk = (p.skipped || []).slice(0, 6).map(x => `<li class="kf-skip muted">${kfEsc(x.why)} (${kfEsc(x.from)} from '${kfEsc(x.term)}')</li>`).join('');
  return add || not || sk ? `<ul class="kf-adds">${add}${not}${sk}</ul>` : '';
}
// The winning-keyword data's line for the popup: where it is from and how old — or that there is none (nothing is added then).
function kfWinLine(run) {
  const p = run.plans.find(x => x.win && x.win.status) || null;
  const st = p ? p.win.status : (typeof kwStatus === 'function' ? kwStatus() : null);
  const pp = p ? p.win.ppc : (typeof kwPpcStatus === 'function' ? kwPpcStatus() : null);
  if (!st && !pp) return '';
  const added = run.plans.flatMap(x => ((x.ok && x.added) ? x.added : []));
  const nP = added.filter(a => /^PPC: /.test(a.why)).length, nB = added.length - nP;
  const line = (s, n, what) => (s ? `<p class="kf-win${s.ok ? '' : ' is-none'}">${what} ${kfEsc(s.text)}${s.ok ? ` · ${n ? `${kfNf(n)} word${n === 1 ? '' : 's'} added` : 'none missing that fits'}` : ''}</p>` : '');
  // our own ads first (they go in first), then Brand Analytics
  return line(pp, nP, '📈') + line(st, nB, '🏆');
}
// What the ticked ones would send: [{ p, text, chk }] (chk: lrKwCheck of the text).
function kfChosen(run) {
  return run.plans.filter(p => p.ok && run.sel.has(p.key)).map(p => { const text = kfText(run, p); return { p, text, chk: lrKwCheck(text, p.max) }; });
}
function kfSumText(run) {
  const ok = run.plans.filter(p => p.ok);
  const chosen = kfChosen(run);
  const bad = chosen.filter(c => c.chk.over || !c.text.trim()).length;
  const kids = n => (n === 1 ? '1 child' : kfNf(n) + ' children');
  const risky = ok.reduce((n, p) => n + (p.removed || []).filter(r => r.risk).length, 0);
  return `${kids(ok.length)} · ${bad ? `${kfNf(chosen.length - bad)} will be ≤ ${ok[0] ? ok[0].max : 249} bytes · ${kfNf(bad)} edited over the limit` : `all will be ≤ ${ok[0] ? ok[0].max : 249} bytes`}`
    + (risky ? ` · ${risky === 1 ? '1 risky word' : kfNf(risky) + ' risky words'} taken out` : '')
    + (chosen.length !== ok.length ? ` · ${kfNf(chosen.length)} ticked` : '') + (run.plans.length > ok.length ? ` · ${kfNf(run.plans.length - ok.length)} not fixed here` : '');
}
function kfGoText(run) {
  const n = kfChosen(run).filter(c => !c.chk.over && c.text.trim()).length;
  return `Check with Amazon &amp; send ${kfNf(n)}`;
}
function kfRowHtml(run, p) {
  const find = kfEsc([p.sku, p.label, p.asin].join(' ').toLowerCase());
  const hide = run.q && !find.includes(run.q) ? ' hide' : '';
  if (!p.ok) {
    return `<div class="sp-m-row sq-row kf-row is-held${hide}" data-kf-find="${find}"><b>${kfEsc(p.label || p.sku)}</b><small>${kfEsc(p.sku)}</small>`
      + `<div class="sq-st">⚠ Not fixed here: ${kfEsc(p.why)}</div>`
      + (typeof aiOn === 'function' && aiOn() && !/^already within/.test(p.why) ? aiBtnHtml('kw', p.brand, p.sku, { use: 'kf', key: p.key, label: 'AI version' }) : '') + '</div>';
  }
  const text = kfText(run, p);
  const chk = lrKwCheck(text, p.max);
  const on = run.sel.has(p.key);
  return `<div class="sp-m-row sq-row kf-row${hide}" data-kf-find="${find}" data-kf-key="${kfEsc(p.key)}">`
    + `<label class="kf-tick"><input type="checkbox" data-kf-tick="${kfEsc(p.key)}"${on ? ' checked' : ''} aria-label="Send ${kfEsc(p.sku)}"></label>`
    + `<div class="kf-body"><div class="kf-top"><b>${kfEsc(p.sku)}</b><small>${kfEsc(p.label && p.label !== p.sku ? p.label : '')}</small>`
    + `<span class="kf-bytes"><span class="${p.b0 > p.max ? 'err' : ''}">${kfNf(p.b0)}</span> → <span class="${chk.over ? 'err' : 'ok'}" data-kf-n="${kfEsc(p.key)}">${kfNf(chk.bytes)}</span> bytes</span></div>`
    + `<div class="kf-text">${kfDiffHtml(p)}</div>${kfAddedHtml(p)}`
    + (typeof aiOn === 'function' && aiOn() ? `<div class="ai-rowb">${aiBtnHtml('kw', p.brand, p.sku, { use: 'kf', key: p.key, label: 'AI version' })}</div>` : '')
    + `<details class="kf-ed"${run.edit.has(p.key) ? ' open' : ''}><summary>Edit the new text</summary><textarea data-kf-edit="${kfEsc(p.key)}" rows="3" spellcheck="false">${kfEsc(text)}</textarea></details></div></div>`;
}
function kfDraw() {
  const run = KF.run;
  if (!run || run.closed || typeof spModal !== 'function') return;
  if (run.total) {
    const pct = Math.round(run.reading * 100 / run.total);
    spModal(`<div class="sq-pop kf-pop"><div class="sp-m-h"><b>Reading the whole search terms from Amazon… ${kfNf(run.reading)} of ${kfNf(run.total)}</b>`
      + '<p>Sellora keeps a long text cut short; Amazon has the whole of it. Nothing changes on Amazon.</p></div>'
      + `<div class="sp-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${run.total}" aria-valuenow="${run.reading}"><span style="width:${pct}%"></span></div>`
      + '<div class="sp-m-a"><button type="button" class="sp-btn" data-kf="cancel">Cancel</button></div></div>', true);
    return;
  }
  const ok = run.plans.filter(p => p.ok);
  const order = run.plans.slice().sort((a, b) => (a.ok === b.ok ? 0 : a.ok ? -1 : 1));
  const all = ok.length && ok.every(p => run.sel.has(p.key));
  spModal(`<div class="sq-pop kf-pop"><div class="sp-m-h sq-top"><b>Fix all search terms — ${kfEsc(run.o.title || '')}</b>`
    + `<p class="sq-sum" data-kf-sum>${kfEsc(kfSumText(run))}</p>`
    + `<p>Always out: every word said twice (the first stays), ${typeof ipgKwRisk === 'function' ? 'risky words (other brands’ names and restricted claims: struck through in red), ' : ''}other brands’ names and ASINs. Then the winning words this product type is missing are added (+, with why). Then, only until it fits: a shape or colour that is not the product’s, low-value and joining words, the weakest Brand Analytics word, then other words (those the title already says first) — a word PROVEN in our ads (2+ orders) may take the place of the listing’s own words with no orders. 🔒 Our brands and its important words — hand, block print, its product, shape, material, colour, size and use words — stay once. A text within the limit loses only its risky words.</p>`
    + kfWinLine(run)
    + `<div class="kf-tools"><input type="search" data-kf-q placeholder="Search SKU, colour, size…" value="${kfEsc(run.q)}" aria-label="Search the children">`
    + `<label class="kf-all"><input type="checkbox" data-kf-all${all ? ' checked' : ''}> Select all</label></div></div>`
    + `<div class="sp-m-list">${order.map(p => kfRowHtml(run, p)).join('') || '<div class="sp-m-row sq-none">Nothing to fix.</div>'}</div>`
    + `<div class="sp-m-a"><button type="button" class="sp-main" data-kf="go"${ok.length ? '' : ' disabled'}>${kfGoText(run)}</button><button type="button" class="sp-btn" data-kf="cancel">Cancel</button></div></div>`, true);
}
// The counts and the button follow a tick or an edit without drawing the popup again (the box being typed in keeps its place).
function kfRefresh() {
  const run = KF.run;
  const box = typeof $ === 'function' ? $('spModalBox') : null;
  if (!run || !box || !box.querySelector) return kfDraw();
  const sum = box.querySelector('[data-kf-sum]');
  const go = box.querySelector('[data-kf="go"]');
  if (!sum || !go) return kfDraw();
  sum.textContent = kfSumText(run);
  go.innerHTML = kfGoText(run);
  const all = box.querySelector('[data-kf-all]');
  if (all) all.checked = run.plans.filter(p => p.ok).every(p => run.sel.has(p.key));
}
function kfClose(summary) {
  const run = KF.run;
  if (!run || run.closed) return;
  run.closed = true;
  if (!summary && typeof spModal === 'function') spModal('', true);
  run.resolve(summary || null);
}
/** Check with Amazon & send: the ticked children's new texts through THE ONE SEND PATH. An edited text over the limit (or empty) is held
 *  back with its reason. Each one sent is kept with its OLD text (fix-all.js's log: History and Put back) and every screen follows. */
function kfGo() {
  const run = KF.run;
  if (!run || run.closed) return null;
  const chosen = kfChosen(run);
  const good = chosen.filter(c => !c.chk.over && c.text.trim());
  const held = chosen.filter(c => c.chk.over || !c.text.trim()).map(c => ({ sku: c.p.sku, label: c.p.label, why: !c.text.trim() ? 'the edited text is empty' : `the edited text is ${kfNf(c.chk.bytes)} bytes, over ${c.p.max}` }))
    .concat(run.plans.filter(p => !p.ok).map(p => ({ sku: p.sku, label: p.label, why: p.why })));
  if (!good.length) return null;
  const o = run.o;
  const rec = { brand: o.brand, parent: o.parent, row: o.row || 'rule:kw_bytes', name: o.name || 'Search terms over the limit', attr: '' };
  const now = Date.now();
  const records = [];
  run.closed = true;          // the send path's popup takes the window over
  const jobs = good.map(c => {
    const p = Object.assign({}, c.p, { after: c.text, sent: { kw: c.text }, patches: kfPatches(c.text) });
    return { brand: p.brand, sku: p.sku, asin: p.asin, label: p.label, plan: p,
      body: { lfix: 'patch', brand: p.brand, sku: p.sku, productType: p.pt, patches: p.patches },
      changes: [{ field: 'Hidden search words', old: p.before, new: c.text, max: p.max, unit: 'bytes', attr: 'generic_keyword', oldV: [{ value: p.before, language_tag: 'en_US' }] }] };
  });
  const sent = sqSendWithCheck(jobs, {
    screen: KF_SCREEN, title: `Fix all search terms — ${o.title || ''}`, held,
    onSent: job => {
      const it = Object.assign(job.plan, { sub: job.sub });
      const r = typeof faRecord === 'function' ? faRecord(it, Object.assign({}, rec, { parent: it.parent || rec.parent }), now, job.sub) : null;
      if (r) { job.rec = r; records.push(r); }
      if (typeof faLiveAfterSend === 'function') faLiveAfterSend(it, now);
    },
    onDone: async sum => {
      sum.jobs.forEach(job => { if (job.rec) { job.rec.state = job.state; job.rec.why = job.why || ''; } });
      if (records.length && typeof faLogAdd === 'function') await faLogAdd(records);
      KF.last.set(o.brand, typeof sqSummaryText === 'function' ? sqSummaryText(sum) : '');
      KF.memo = null;
      if (typeof faRedraw === 'function') faRedraw();
      if (typeof ipgAfterSend === 'function') ipgAfterSend();          // the IP & Trademark Guard follows what was sent
      if (typeof leRender === 'function' && typeof $ === 'function' && $('leList')) { try { leRender(); } catch (e) { /* not on the page */ } }
    } });
  Promise.resolve(sent).then(sum => run.resolve(sum));
  return sent;
}
function kfClick(btn) {
  const act = btn.dataset.kf;
  if (act === 'cancel') return kfClose();
  if (act === 'go') return kfGo();
}
// The popup's ticks, search box and edits; the Listing Errors card's buttons.
function kfInput(el) {
  const run = KF.run;
  if (!run || run.closed) return;
  if (el.dataset.kfQ !== undefined) {
    run.q = String(el.value || '').trim().toLowerCase();
    const box = $('spModalBox');
    if (box && box.querySelectorAll) box.querySelectorAll('.kf-row').forEach(row => row.classList.toggle('hide', !!run.q && !String(row.dataset.kfFind || '').includes(run.q)));
    return;
  }
  if (el.dataset.kfTick !== undefined) {
    if (el.checked) run.sel.add(el.dataset.kfTick); else run.sel.delete(el.dataset.kfTick);
    return kfRefresh();
  }
  if (el.dataset.kfAll !== undefined) {
    const box = $('spModalBox');
    // Select all: every child still shown by the search (all of them with no search)
    const shown = new Set([...((box && box.querySelectorAll) ? box.querySelectorAll('.kf-row:not(.hide)') : [])].map(row => row.dataset.kfKey).filter(Boolean));
    run.plans.filter(p => p.ok && (!run.q || shown.has(p.key))).forEach(p => { if (el.checked) run.sel.add(p.key); else run.sel.delete(p.key); });
    if (box && box.querySelectorAll) box.querySelectorAll('[data-kf-tick]').forEach(t => { t.checked = run.sel.has(t.dataset.kfTick); });
    return kfRefresh();
  }
  if (el.dataset.kfEdit !== undefined) {
    const key = el.dataset.kfEdit;
    const p = run.plans.find(x => x.key === key);
    if (!p) return;
    run.edit.set(key, String(el.value || '').replace(/\s+/g, ' ').trim());
    const chk = lrKwCheck(run.edit.get(key), p.max);
    const n = $('spModalBox') && $('spModalBox').querySelector ? $('spModalBox').querySelector(`[data-kf-n="${CSS && CSS.escape ? CSS.escape(key) : key}"]`) : null;
    if (n) { n.textContent = kfNf(chk.bytes); n.className = chk.over ? 'err' : 'ok'; }
    return kfRefresh();
  }
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('click', e => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-kf],[data-kf-le]') : null;
    if (!btn || btn.disabled) return;
    if (btn.dataset.kf) return kfClick(btn);
    const only = typeof LE_ONLY !== 'undefined' && LE_ONLY ? LE_ONLY.skus : null;
    kfLeStart(btn.dataset.kfBrand, btn.dataset.kfLe === 'fam' ? btn.dataset.kfParent : '', only);
  });
  document.addEventListener('input', e => { if (e.target && e.target.dataset && (e.target.dataset.kfQ !== undefined || e.target.dataset.kfEdit !== undefined)) kfInput(e.target); });
  document.addEventListener('change', e => { if (e.target && e.target.dataset && (e.target.dataset.kfTick !== undefined || e.target.dataset.kfAll !== undefined)) kfInput(e.target); });
}

/** CONSOLE: `kfReport()` (or `kfReport('RTC14-1')`) in a signed-in Sellora tab, Listing Health loaded: per brand, the children and families
 *  "Search terms over the limit" would fix, how many need their whole text read first, and one SKU's before → after. */
function kfReport(sku) {
  const ctx = hCtx();
  const out = {};
  let example = null;
  ['SP', 'CPC'].forEach(brand => {
    const rows = kfOverRows(brand);
    const plans = rows.map(r => kfPlan(kfItemOf(brand, r.row, ctx, null)));
    out[(typeof BRAND_NAME !== 'undefined' && BRAND_NAME[brand]) || brand] = { childrenOver: rows.length, families: new Set(rows.map(r => r.row.parent || r.row.asin || r.row.sku)).size,
      readyNow: plans.filter(p => p.ok).length, readFirst: plans.filter(p => p.wait).length, notFixed: plans.filter(p => !p.ok && !p.wait).length };
    if (sku && !example) {
      const row = ((HEALTH[brand] && HEALTH[brand].rows) || []).find(r => r.sku === sku);
      if (row) { const p = kfPlan(kfItemOf(brand, row, ctx, null)); example = { sku, bytes: `${p.b0} → ${p.b1}`, before: p.before, after: p.after, removed: p.removed.map(r => `${r.w} (${r.why})`).join(', '), ready: p.ok || p.why }; }
    }
  });
  console.table(out);
  if (example) console.log(example);
  return sku ? Object.assign({}, out, { example }) : out;
}
