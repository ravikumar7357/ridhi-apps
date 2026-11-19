/* ================= LISTING · IP & TRADEMARK GUARD — other brands' names and restricted claims in our listings =================
 * Screens: Listing → 2 · Check → IP & Trademark Guard (#paneIpg / #ipgPane, drawn whole here). Same look as Family & Category Check
 *       and A+ Content: the same cards, chips, arrows, rows and buttons (fc-* / cc-* classes; styles.css gives them to the three panes).
 * WHAT IT CHECKS — every listing's title, bullets, description, search terms and Item Highlights, as ListingMatch read them (listing-
 *       match.js lmGet; a change Sellora itself sent or read since that pass is newer and wins for its field). THE SCREEN MAKES NO
 *       AMAZON CALL — not on opening, not while showing. Only a person's Fix does (through the existing popups).
 * THE WORDS — two lists the team edits in Listing Rules → "What people may write" (lrAllow: otherBrands, claims):
 *   Trademark         another brand's or a licensed name ("Pottery Barn", "Disney")                      red
 *   Restricted claim  a word that needs proof or a certificate ("organic", "antibacterial", "#1")        amber
 *   Whole words or phrases only ("Disneyland" and "inorganic" are not matched), any case, accents folded (Hermès), written together
 *   or with a hyphen (PotteryBarn, eco friendly), with 's or s after it; "Crate & Barrel" = "Crate and Barrel". A brand name with
 *   "style" / "inspired" / "like" … before or after it is the same finding, shown as written ("Pottery Barn style"). OUR OWN brands are
 *   never a finding: Listing Rules' "Our brand words", Fabricrush, and the brand Amazon shows for the listing.
 * NOT A LISTING HEALTH RULE: nothing here adds a finding, a count or a level to Listing Health or the Workspace.
 * ALLOWED ON PURPOSE — per word per listing, or per word for a whole family, with who and when (listingrules/ipok_<brand>, kind 'ipok',
 *       through lsGet / lsSave — the way "Removed on purpose" is kept). An allowed word does not count and no Fix takes it out. Undo.
 * FIX — nothing new: search terms → the existing "Fix all search terms" popup (kw-fix.js, which now also takes risky words out; Amazon's
 *       check → send → read again → Listing History → Put back); title → the existing "Fix all titles" popup (title-fix.js; the person
 *       approves every new title); bullets / description / Item Highlights → the listing in Listing Errors, edited there by a person.
 * TWO VIEWS: By listing (families, closed, red first then the most 30-day sales) and By word (each risky word as a card).
 * SCREEN = DOWNLOAD: the snippet lines on the screen and the sheet's rows are made from the same records (ipgFindView).
 * Console: ipReport() — per brand: listings, risky (with stock), per type, per field, and 10 example findings with their snippet.
 * Main functions: ipgWords, ipgFind, ipgTexts, ipgScan, ipgBuild, ipgGroups, ipgDraw, ipgAllow, ipgAllowFam, ipgUndo, ipgFixKw,
 *       ipgFixTitle, ipgCsv, ipReport — and for the other files: ipgKwRisk (kw-fix.js), ipgTitleRisk (title-fix.js).
 *       Every name starts with ipg / IPG (and the console name). */

const IPG_STEP = 60;                 // family lines drawn at a time; more as the list scrolls
const IPG_STEP_OPEN = 15;            // …when families are open (their rows are drawn too)
const IPG_WORD_STEP = 30;            // word cards drawn at a time
const IPG_ROWS_FIRST = 40;           // rows of an open family drawn at once; the rest follow in the next frames
const IPG_ROWS_STEP = 80;
const IPG_COLS = 7;
const IPG_OK_DOC = brand => 'ipok_' + brand;
const IPG_OURS = ['Fabricrush'];     // ours too, beside Listing Rules' "Our brand words"
// cls: the colour — r red, y amber, g grey, ok green
const IPG_TYPE = {
  tm: { t: 'Trademark', csv: 'trademark', cls: 'r', why: "another brand's trademark — Amazon can remove the listing" },
  claim: { t: 'Restricted claim', csv: 'claim', cls: 'y', why: 'restricted claim — needs proof/certificate' },
};
const IPG_FIELD = { title: 'Title', bullets: 'Bullets', desc: 'Description', kw: 'Search terms', hl: 'Item Highlights' };
const IPG_FIELDS = ['title', 'bullets', 'desc', 'kw', 'hl'];
const IPG_ST = {
  tm: { t: 'Trademark words', one: "another brand's name", cls: 'r', tip: "Listings that hold another brand's or a licensed name: Amazon can remove the listing." },
  claim: { t: 'Restricted claims', one: 'needs proof', cls: 'y', tip: 'Listings that hold a claim Amazon wants proof or a certificate for.' },
  allowed: { t: 'Allowed on purpose', one: 'not counted', cls: 'g', tip: 'Listings with a word the team allowed on purpose: not counted, never taken out by a Fix.' },
  clean: { t: 'Clean', one: 'nothing risky', cls: 'ok', tip: 'Listings whose title, bullets, description, search terms and Item Highlights hold no word of the lists.' },
  unchecked: { t: 'Not checked', one: 'no Amazon read', cls: 'g', tip: 'Sellora holds no Amazon read of these listings: not an error, not counted, never called clean.' },
};
const IPG_CARDS = ['tm', 'claim', 'allowed', 'clean'];
let IPG = { view: 'list', brand: 'ALL', stock: true, f: '', q: '', open: new Set(), limit: IPG_STEP, words: IPG_WORD_STEP,
  ok: { SP: {}, CPC: {} }, okLoaded: false, okLoading: null, okV: 0, okNote: '',
  built: false, loaded: false, loading: false, err: '', model: null, order: null, orderKey: '', fam: null, rowsOf: null,
  io: null, qT: 0, sideV: 0, stickT: 0, later: new Map(), laterV: 0, need: '', scan: new Map(), wordsKept: null, wordsV: 0, warm: null, warmN: 0 };

/* ----- small words ----- */
const ipgId = c => c.asin || 'sku:' + c.sku;                                // a product's id (one row per ASIN, as Family check counts)
const IPG_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const ipgDate = ms => (ms ? IPG_DATE.format(new Date(ms)) : '');
const IPG_TIME = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const ipgTime = ms => (ms ? IPG_TIME.format(new Date(ms)) : '');
const ipgN = (n, one, many) => fcNf(n) + ' ' + (n === 1 ? one : many || one + 's');

/* ============================================================================================
 * 1. THE WORDS AND THE MATCHER — pure: the same text and lists always give the same findings
 * ============================================================================================ */
const IPG_ASCII = /^[\x00-\x7f]*$/;
/** A text as it is compared: lower case, accents folded — and EXACTLY as long as the text (so a place in it is the place in the text). */
function ipgFold(text) {
  const s = String(text == null ? '' : text);
  if (IPG_ASCII.test(s)) return s.toLowerCase();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 128) { out += s[i].toLowerCase(); continue; }
    if (code >= 0xD800 && code <= 0xDFFF) { out += s[i]; continue; }          // half of a pair (an emoji): as it is
    const base = s[i].normalize('NFD')[0].toLowerCase();
    out += base.length === 1 ? base : s[i];
  }
  return out;
}
// The parts of a phrase: its words (letters and digits, an apostrophe inside allowed) and the signs # & + %.
const ipgAtoms = phrase => ipgFold(phrase).match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[#&+%]/gu) || [];
const IPG_SIGN = { '#': 'no', '+': 'plus', '%': 'pct' };
/** A phrase's key: its words joined by "_" ("Crate & Barrel" → crate_barrel, "Amazon's Choice" → amazons_choice, "#1" → no_1). */
const ipgKeyOf = phrase => ipgAtoms(phrase).filter(a => a !== '&').map(a => IPG_SIGN[a] || a.replace(/['’]/g, '')).join('_');
const ipgRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const IPG_SEP = '[\\s\\-\\u2010-\\u2015_]*';             // between the words of a phrase: spaces, hyphens, dashes — or nothing ("potterybarn")
// A phrase as a pattern: its words in order with IPG_SEP between; an apostrophe optional; "&" = "&", "and" or nothing.
function ipgPhraseRx(phrase) {
  let out = '';
  ipgAtoms(phrase).forEach(a => {
    if (a === '&') { if (out) out += `(?:${IPG_SEP}(?:&|and))?`; return; }
    out += (out ? IPG_SEP : '') + a.split(/['’]/).map(ipgRx).join("['’]?");
  });
  return out;
}
const IPG_EDGE_L = '(?<![\\p{L}\\p{N}])', IPG_EDGE_R = '(?![\\p{L}\\p{N}])';
// One pattern for a list of phrases: whole words only, an optional 's / s after ("Disney's", "best sellers"). One group per phrase.
const ipgListRe = rxs => (rxs.length ? new RegExp(`${IPG_EDGE_L}(?:${rxs.map(rx => '(' + rx + ')').join('|')})(?:['’]?s)?${IPG_EDGE_R}`, 'gu') : null);
/** The lists in force (Listing Rules → What people may write): { v, list: [{ k, word, type }], re, byKey, ours (keys), oursRe, tm, claim } —
 *  made once per text of the lists. A word that is one of OUR brands is left out of the list. */
function ipgWords(cfg) {
  const a = lrAllow(cfg || (typeof LR !== 'undefined' && LR) || LR_DEFAULT);
  const sig = a.otherBrands + '\u0001' + a.claims + '\u0001' + a.ourBrands;
  if (IPG.wordsKept && IPG.wordsKept.sig === sig) return IPG.wordsKept;
  const own = lrWords(a.ourBrands).concat(IPG_OURS);
  const ours = new Set(own.map(ipgKeyOf).filter(Boolean));
  const seen = new Set(), list = [];
  [['tm', a.otherBrands], ['claim', a.claims]].forEach(([type, text]) => lrWords(text).forEach(word => {
    const k = ipgKeyOf(word);
    if (!k || seen.has(k) || ours.has(k)) return;
    seen.add(k);
    list.push({ k, word, type, n: ipgAtoms(word).length, rx: ipgPhraseRx(word) });
  }));
  list.sort((x, y) => y.n - x.n || y.word.length - x.word.length || x.k.localeCompare(y.k));     // the longer phrase first ("#1 best seller" before "best seller")
  IPG.wordsKept = { sig, v: ++IPG.wordsV, list, re: ipgListRe(list.map(w => w.rx)), byKey: new Map(list.map(w => [w.k, w])), ours,
    oursRe: ipgListRe(own.map(ipgPhraseRx).filter(Boolean)), tm: list.filter(w => w.type === 'tm').length, claim: list.filter(w => w.type === 'claim').length };
  return IPG.wordsKept;
}
// "style" / "inspired" / "like" … after a brand name, and before it — the same finding, shown as written.
const IPG_Q_AFTER = /^[\s\-‐-―]*(?:styles?|styled|inspired|like|type|look|esque|dupes?|alternative)(?![\p{L}\p{N}])/u;
const IPG_Q_BEFORE = /[^\p{L}\p{N}]((?:in the )?style of|styled after|inspired by|similar to|compared? to|alternative to|dupes? (?:of|for)|like|inspired|style)([\s\-‐-―]+)$/u;
/** THE MATCHER. Every word of the lists in a text: [{ k, word (as the list writes it), type 'tm' | 'claim', s, e (its place in the text,
 *  the "style" / "inspired by" beside a brand name included), text (exactly as written), q (true with such a word beside it) }].
 *  o.ours: more names that are ours for this listing (the brand Amazon shows). Nothing here knows about "Allowed on purpose". */
function ipgFind(text, cfg, o) {
  const W = ipgWords(cfg);
  if (!W.re || !text) return [];
  const src = String(text);
  const low = ipgFold(src);
  let out = [], m;
  W.re.lastIndex = 0;
  while ((m = W.re.exec(low))) {
    if (!m[0].length) { W.re.lastIndex++; continue; }
    let i = 1;
    while (i <= W.list.length && m[i] === undefined) i++;
    const w = W.list[i - 1];
    if (!w) continue;
    let s = m.index, e = m.index + m[0].length, q = false;
    const cs = s, ce = e;                                    // the word itself (what is compared with our own brand names)
    if (w.type === 'tm') {
      const after = low.slice(e, e + 16).match(IPG_Q_AFTER);
      if (after) { e += after[0].length; q = true; }
      const from = Math.max(0, s - 28);
      const before = ((from === 0 ? ' ' : '') + low.slice(from, s)).match(IPG_Q_BEFORE);
      if (before) { s -= before[1].length + before[2].length; q = true; }
    }
    out.push({ k: w.k, word: w.word, type: w.type, s, e, cs, ce, text: src.slice(s, e), q });
  }
  if (!out.length) return out;
  // a word inside one of OUR brand names is ours ("Ridhi", "Whimsical Corner", the brand Amazon shows for the listing)
  const own = [];
  const take = re => { if (!re) return; re.lastIndex = 0; let x; while ((x = re.exec(low))) { if (!x[0].length) { re.lastIndex++; continue; } own.push([x.index, x.index + x[0].length]); } };
  take(W.oursRe);
  const extra = ((o && o.ours) || []).filter(Boolean);
  if (extra.length) {
    const keys = new Set(extra.map(ipgKeyOf));
    out = out.filter(x => !keys.has(x.k));
    take(ipgListRe(extra.map(ipgPhraseRx).filter(Boolean)));
  }
  return own.length ? out.filter(x => !own.some(sp => sp[0] <= x.cs && sp[1] >= x.ce)) : out;
}
/** A short piece of the text round a finding: { a (before), hit, b (after) } — cut at whole words, "…" where it was cut. */
function ipgSnip(text, s, e) {
  const src = String(text);
  const R = 48;
  let a = Math.max(0, s - R), b = Math.min(src.length, e + R);
  if (a > 0) { const sp = src.indexOf(' ', a); if (sp >= 0 && sp < s) a = sp + 1; }
  if (b < src.length) { const sp = src.lastIndexOf(' ', b); if (sp > e) b = sp; }
  const flat = t => t.replace(/\s+/g, ' ');
  return { a: (a > 0 ? '…' : '') + flat(src.slice(a, s)), hit: flat(src.slice(s, e)), b: flat(src.slice(e, b)) + (b < src.length ? '…' : '') };
}

/* ============================================================================================
 * 2. ONE LISTING'S TEXTS AND FINDINGS
 * ============================================================================================ */
/** The texts of one listing: [{ f, label, text, at }] — title (the one Amazon shows; and ours when a read holds a different one), each
 *  bullet, the description, the search terms, Item Highlights — from the ListingMatch record; a field Sellora read or sent since that
 *  pass is newer and wins. Null when Sellora holds no Amazon read of the listing (it is then "Not checked", never "Clean"). */
function ipgTexts(brand, sku) {
  const m = typeof lmGet === 'function' ? lmGet(sku, brand) : null;
  const lr = typeof LI_WS !== 'undefined' && LI_WS.live && LI_WS.live[brand] ? LI_WS.live[brand][sku] || null : null;
  if (!m) return null;
  const mAt = m.readAt || 0;
  const out = [];
  // --- the title shoppers see, and ours when it is another one ---
  const shownLive = lr && lr.catTitle && (lr.tAt || 0) > mAt ? String(lr.catTitle) : '';
  const shown = shownLive || String((m.cat && m.cat.t) || m.t || '');
  if (shown) out.push({ f: 'title', label: 'Title', text: shown, at: shownLive ? lr.tAt : mAt });
  const subAt = lr ? Math.max(lr.cAt || 0, lr.tSentAt || 0) : 0;
  const sub = lr && lr.title && subAt > 0 ? String(lr.title) : '';
  if (sub && !(shown && typeof lrSameTitle === 'function' && lrSameTitle(sub, shown))) out.push({ f: 'title', label: shown ? 'Title you submitted (Amazon shows another)' : 'Title', text: sub, at: subAt, sub: !!shown });
  // --- bullets and description: the ListingMatch read ---
  (m.bl || []).forEach((b, i) => { if (b) out.push({ f: 'bullets', label: 'Bullet ' + (i + 1), text: String(b), at: mAt }); });
  if (m.d) out.push({ f: 'desc', label: 'Description', text: String(m.d), at: mAt });
  // --- search terms: a read or a send since the pass wins; a read kept cut (300 letters) of the very text the cache holds whole does not ---
  let kw = String(m.kw || ''), kwAt = mAt;
  const lrKwAt = lr && typeof lr.kw === 'string' ? Math.max(lr.cAt || 0, lr.kwAt || 0) : 0;
  if (lrKwAt > mAt && !(lr.kw.length >= 300 && kw.startsWith(lr.kw))) { kw = lr.kw; kwAt = lrKwAt; }
  const whole = typeof KF !== 'undefined' && KF.full ? KF.full.get(brand + '|' + sku) : null;       // read whole for a Fix (kw-fix.js)
  if (whole && whole.at > kwAt) { kw = String(whole.kw || ''); kwAt = whole.at; }
  if (kw) out.push({ f: 'kw', label: 'Search terms', text: kw, at: kwAt });
  // --- Item Highlights ---
  const hlLive = lr && Array.isArray(lr.hl) && (lr.hlAt || 0) > mAt;
  const hl = hlLive ? lr.hl : m.hl || [];
  hl.forEach((h, i) => { if (h) out.push({ f: 'hl', label: hl.length > 1 ? 'Item Highlights ' + (i + 1) : 'Item Highlights', text: String(h), at: hlLive ? lr.hlAt : mAt }); });
  return out;
}
// What a listing's kept findings rest on (compared item by item).
function ipgScanSig(brand, sku, W) {
  const m = typeof lmGet === 'function' ? lmGet(sku, brand) : null;
  const lr = typeof LI_WS !== 'undefined' && LI_WS.live && LI_WS.live[brand] ? LI_WS.live[brand][sku] || null : null;
  return [m, W.v, lr ? [lr.at, lr.cAt, lr.tAt, lr.hlAt, lr.kwAt, lr.tSentAt, lr.title, lr.catTitle, lr.kw, lr.brand, (lr.hl || []).join('\u0002')].join('\u0001') : '',
    typeof KF !== 'undefined' && KF.full ? KF.full.get(brand + '|' + sku) || null : null];
}
/** One listing's findings: { checked, at (the oldest read among its texts), finds: [{ sku, f, label, k, word, type, text, q, n (times in
 *  that text), snip, at, sub, subClean }] } — one finding per word per text. Kept until the listing's data or the lists change. */
function ipgScan(brand, sku, cfg) {
  const W = ipgWords(cfg);
  const key = brand + '|' + sku;
  const sig = ipgScanSig(brand, sku, W);
  const kept = IPG.scan.get(key);
  if (kept && kept.sig.length === sig.length && kept.sig.every((x, i) => x === sig[i])) return kept.res;
  const texts = ipgTexts(brand, sku);
  const res = { checked: !!texts, at: 0, finds: [] };
  if (texts) {
    const m = lmGet(sku, brand);
    const lr = typeof LI_WS !== 'undefined' && LI_WS.live && LI_WS.live[brand] ? LI_WS.live[brand][sku] || null : null;
    const ours = [lr && lr.brand, m && m.cat && m.cat.brand].filter(Boolean);
    res.at = texts.length ? Math.min(...texts.map(t => t.at || 0)) : m.readAt || 0;
    texts.forEach(t => {
      const by = new Map();
      ipgFind(t.text, cfg, { ours }).forEach(x => { const fd = by.get(x.k); if (fd) fd.n++; else by.set(x.k, Object.assign({ sku, f: t.f, label: t.label, n: 1, snip: ipgSnip(t.text, x.s, x.e), at: t.at, sub: !!t.sub }, x)); });
      by.forEach(fd => res.finds.push(fd));
    });
    // the title Amazon shows still has a word that ours no longer has: nothing more to do but wait (said in "What to do")
    const subText = texts.find(t => t.sub);
    if (subText) {
      const inSub = new Set(res.finds.filter(fd => fd.sub).map(fd => fd.k));
      res.finds.forEach(fd => { if (fd.f === 'title' && !fd.sub && !inSub.has(fd.k)) fd.subClean = true; });
    }
  }
  if (IPG.scan.size > 30000) IPG.scan.clear();
  IPG.scan.set(key, { sig, res });
  return res;
}

/* ============================================================================================
 * 3. ALLOWED ON PURPOSE — listingrules/ipok_<brand>: "<sku>~<word key>" (one listing) or "F~<family>~<word key>" (a whole family)
 * ============================================================================================ */
function ipgOkLoad() {
  if (IPG.okLoaded || IPG.okLoading) return IPG.okLoading;
  IPG.okLoading = (async () => {
    for (const b of ['SP', 'CPC']) {
      try {
        const data = typeof lsGet === 'function' ? await lsGet(FC_OK_COLL, IPG_OK_DOC(b)) : null;
        if (data && data.items) IPG.ok[b] = Object.assign({}, data.items, IPG.ok[b]);
      } catch (e) { IPG.okNote = 'Could not read the "Allowed on purpose" marks: ' + ((e && e.message) || e); }
    }
    IPG.okLoaded = true;
    IPG.okLoading = null;
    IPG.okV++;
    if (ipgPaneOn()) ipgDraw();                              // (read for a Fix elsewhere while this screen is closed: nothing is checked or drawn here)
    if (typeof faRedraw === 'function') faRedraw();          // a Fix all row counted before the marks were read counts again
  })();
  return IPG.okLoading;
}
/** The mark that allows this word on this listing — its own, else its family's — or null. */
function ipgMarkOf(brand, sku, famId, k) {
  const o = IPG.ok[brand];
  if (!o) return null;
  const own = o[sku + '~' + k];
  if (own && own.on) return own;
  const fam = famId ? o['F~' + famId + '~' + k] : null;
  return fam && fam.on ? fam : null;
}
async function ipgOkWrite(brand, entries) {
  Object.assign(IPG.ok[brand], entries);
  IPG.okV++;
  IPG.okNote = '';
  ipgDrawKeep();
  try {
    const saved = typeof lsSave === 'function' ? await lsSave(FC_OK_COLL, IPG_OK_DOC(brand), { kind: 'ipok', items: entries }) : false;
    if (!saved) IPG.okNote = fcIsTest() ? 'Test site — the mark is kept on this page only, not saved.' : 'Not saved — the mark is kept on this page only.';
  } catch (e) {
    IPG.okNote = 'Could not save the mark (' + ((e && e.message) || e) + ') — it is kept on this page only and will show again after a reload.';
  }
  if (IPG.okNote) ipgDrawKeep();
  if (typeof faRedraw === 'function') faRedraw();
  return entries;
}
/** Allowed on purpose: this word on this listing (every SKU of the product that has it). It stops counting and no Fix takes it out. */
function ipgAllow(key, k) {
  const p = ipgBuild().rows.find(x => x.key === key);
  if (!p) return null;
  const by = fcWho(), at = Date.now(), entries = {};
  p.finds.forEach(fd => { if (fd.k === k && !fd.mark) entries[fd.sku + '~' + k] = { on: true, id: fd.sku + '~' + k, by, name: fcName(by), at, word: fd.word, type: fd.type, sku: fd.sku, asin: p.c.asin || '' }; });
  return Object.keys(entries).length ? ipgOkWrite(p.c.brand, entries) : null;
}
/** Allowed on purpose for the whole family: this word on every listing of it, now and later. */
function ipgAllowFam(fk, k) {
  const g = ipgBuild().groups.find(x => x.f.fk === fk);
  const w = ipgWords().byKey.get(k);
  if (!g || !g.f.famId || !w) return null;
  const by = fcWho(), id = 'F~' + g.f.famId + '~' + k;
  return ipgOkWrite(g.f.brand, { [id]: { on: true, id, by, name: fcName(by), at: Date.now(), word: w.word, type: w.type, fam: g.f.famId, famName: String(g.f.name || '').slice(0, 80) } });
}
/** Undo: the word counts again on this listing (a family's mark: on the whole family). Who undid it is kept beside the first mark. */
function ipgUndo(key, k) {
  const p = ipgBuild().rows.find(x => x.key === key);
  if (!p) return null;
  const by = fcWho(), entries = {};
  p.finds.forEach(fd => { if (fd.k === k && fd.mark && fd.mark.id) entries[fd.mark.id] = Object.assign({}, fd.mark, { on: false, undoneBy: by, undoneName: fcName(by), undoneAt: Date.now() }); });
  return Object.keys(entries).length ? ipgOkWrite(p.c.brand, entries) : null;
}

/* ============================================================================================
 * 4. THE PICTURE: families (Family check's own), one row per product, its findings
 * ============================================================================================ */
// 30-day sales of one ASIN — Listing Audit's figure, read through A+ Content's reader (null: never pulled).
const ipgSales = asin => (typeof apcSales === 'function' ? apcSales(asin) : null);
const ipgSalesAt = () => (typeof apcSalesAt === 'function' ? apcSalesAt() : '');
/** What to do about one finding, in plain words (the screen's column and the sheet's). */
function ipgFindWhat(fd) {
  if (fd.mark) return 'Nothing to do — allowed on purpose';
  const proof = fd.type === 'claim' ? ' — or keep it only with proof / a certificate, then mark it Allowed on purpose' : '';
  if (fd.f === 'kw') return 'Remove it from the search terms — Fix search terms does it (Amazon checks first)' + proof;
  if (fd.f === 'title') return fd.subClean ? 'Your own title no longer has it — wait for Amazon to show your title (Listing Health says when it is not live)'
    : 'Take it out of the title — Fix title shows the new title for your OK' + proof;
  if (fd.f === 'hl') return 'Edit Item Highlights in Listing Errors and take it out' + proof;
  return `Edit the ${fd.f === 'desc' ? 'description' : 'bullet'} in Listing Errors and take it out` + proof;
}
/** One product (a child of Family check) as this screen shows it: { c, key, g, checked, at, finds (each with its mark), tm, claim, okN,
 *  bucket 'tm' | 'claim' | 'allowed' | 'clean' | 'unchecked', sales }. */
function ipgProduct(c, g, cfg) {
  const finds = [];
  let checked = false, at = 0;
  (c.skus || [c.sku]).forEach(sku => {
    const r = ipgScan(c.brand, sku, cfg);
    if (r.checked) { checked = true; at = at ? Math.min(at, r.at) : r.at; }
    r.finds.forEach(fd => { const mark = ipgMarkOf(c.brand, sku, g.f.famId, fd.k); finds.push(Object.assign({}, fd, { mark })); });
  });
  // ONE ORDER, for the screen's blocks and the sheet's rows: the ones that count first, trademark before claim, by word, then as the
  // listing's fields come (title, bullets, description, search terms, Item Highlights)
  finds.forEach((fd, i) => { fd.i = i; });
  finds.sort((x, y) => (x.mark ? 1 : 0) - (y.mark ? 1 : 0) || (x.type === y.type ? 0 : x.type === 'tm' ? -1 : 1) || String(x.word).localeCompare(String(y.word)) || x.i - y.i);
  const live = finds.filter(fd => !fd.mark);
  const tm = new Set(live.filter(fd => fd.type === 'tm').map(fd => fd.k)).size, claim = new Set(live.filter(fd => fd.type === 'claim').map(fd => fd.k)).size;
  return { c, key: fcKey(c.brand, ipgId(c)), g, checked, at, finds, tm, claim, okN: finds.length - live.length,
    bucket: !checked ? 'unchecked' : tm ? 'tm' : claim ? 'claim' : finds.length ? 'allowed' : 'clean', sales: ipgSales(c.asin) };
}
const IPG_RANK = { tm: 0, claim: 1, allowed: 2, unchecked: 3, clean: 4 };
/** { groups: [{ f, rows }], rows, famOf ("brand|sku" → family id, for the marks), salesAt, notes, words } — every product, in stock or
 *  not (`c.live` says which): the toggle only chooses what is shown. Families: Family check's (fcBuild); a listing with no family is a
 *  line of its own. */
function ipgBuild() {
  const lmV = (typeof lmVersion === 'function' ? lmVersion() : 0) + ':' + (typeof LM !== 'undefined' && LM ? LM.ov || 0 : 0);
  const src = [typeof HEALTH !== 'undefined' ? HEALTH.SP : null, typeof HEALTH !== 'undefined' ? HEALTH.CPC : null, typeof IML !== 'undefined' ? IML.SP : null, typeof IML !== 'undefined' ? IML.CPC : null,
    typeof SALES30 !== 'undefined' ? SALES30 : null, typeof LI_WS !== 'undefined' ? LI_WS.liveV : 0];
  const cfg = (typeof LR !== 'undefined' && LR) || LR_DEFAULT;
  const W = ipgWords(cfg);
  const key = [lmV, IPG.okV, W.v, IPG.sideV, typeof KF !== 'undefined' && KF.full ? KF.full.size : 0].join('|');
  const m = IPG.model;
  if (m && m.key === key && m.src.length === src.length && m.src.every((x, i) => x === src[i])) return m;
  // Family check's picture of the families (fcBuild: one row per ASIN, who is live) — worked out once while the data is the same
  if (!IPG.fam || IPG.fam.lmV !== lmV || IPG.fam.src.length !== src.length || !IPG.fam.src.every((x, i) => x === src[i])) IPG.fam = { lmV, src, v: fcBuild() };
  const v = IPG.fam.v;
  const famId = f => f.pa || (f.psku ? 'S:' + f.psku : '');
  const fams = v.families.map(f => ({ f: { fk: f.fk, brand: f.brand, name: f.name, psku: f.psku, pa: f.pa, solo: false, famId: famId(f) }, kids: f.kids }))
    .concat((v.loose || []).map(c => ({ f: { fk: c.brand + '|L:' + ipgId(c), brand: c.brand, name: c.title || c.sku, psku: '', pa: '', solo: true, famId: '' }, kids: [c] })));
  // a listing with no family that is not live (Family check lists only the live ones): a line of its own here too — every listing is checked
  const have = new Set();
  fams.forEach(x => x.kids.forEach(c => (c.skus || [c.sku]).forEach(sku => have.add(fcKey(c.brand, sku)))));
  ['SP', 'CPC'].forEach(brand => {
    const rowOf = new Map(((typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows) || []).map(r => [r.sku, r]));
    ((typeof IML !== 'undefined' && IML[brand] && IML[brand].items) || []).forEach(it => {
      if (!it || !it.sku || /^parent$/i.test(it.lvl || '') || FC_RESALE.test(it.sku) || have.has(fcKey(brand, it.sku))) return;
      have.add(fcKey(brand, it.sku));
      const row = rowOf.get(it.sku) || null;
      const c = { brand, sku: it.sku, skus: [it.sku], asin: it.asin || (row && row.asin) || '', title: it.t || (row && row.title) || '', stock: row && row.qty != null ? Number(row.qty) : null, live: false };
      fams.push({ f: { fk: brand + '|L:' + ipgId(c) + ':' + it.sku, brand, name: c.title || c.sku, psku: '', pa: '', solo: true, famId: '' }, kids: [c] });
    });
  });
  const rows = [], famOf = new Map();
  const groups = fams.filter(x => x.kids.length).map(x => {
    const g = { f: x.f, rows: [] };
    g.rows = x.kids.map(c => ipgProduct(c, g, cfg));
    g.rows.sort((a, b) => IPG_RANK[a.bucket] - IPG_RANK[b.bucket] || (b.sales || 0) - (a.sales || 0) || String(a.c.sku).localeCompare(String(b.c.sku), undefined, { numeric: true }));
    g.rows.forEach(p => { rows.push(p); (p.c.skus || [p.c.sku]).forEach(sku => famOf.set(fcKey(p.c.brand, sku), x.f.famId)); });
    return g;
  });
  // red first, then the most 30-day sales among its risky listings, then the most risky listings, then by name — kept while the data is
  // the same, so a mark never moves a line
  const stat = g => { const risky = g.rows.filter(p => p.bucket === 'tm' || p.bucket === 'claim'); return { red: risky.some(p => p.bucket === 'tm') ? 1 : 0, sales: risky.reduce((s, p) => s + (p.sales || 0), 0), n: risky.length }; };
  const orderKey = [lmV, W.v, groups.length, ipgSalesAt()].join('|');
  if (!IPG.order || IPG.orderKey !== orderKey) {
    const st = new Map(groups.map(g => [g.f.fk, stat(g)]));
    IPG.order = new Map(groups.slice().sort((a, b) => { const x = st.get(a.f.fk), y = st.get(b.f.fk); return y.red - x.red || y.sales - x.sales || y.n - x.n || String(a.f.name).localeCompare(String(b.f.name)) || a.f.fk.localeCompare(b.f.fk); }).map((g, i) => [g.f.fk, i]));
    IPG.orderKey = orderKey;
  }
  groups.sort((a, b) => (IPG.order.has(a.f.fk) ? IPG.order.get(a.f.fk) : 1e9) - (IPG.order.has(b.f.fk) ? IPG.order.get(b.f.fk) : 1e9));
  IPG.model = { key, src, groups, rows, famOf, salesAt: ipgSalesAt(), notes: v.notes || [], words: W, now: Date.now() };
  return IPG.model;
}
// Does this product belong under the chip? '' = risky (trademark or claim, not allowed); a card's name; 'f:<field>' = risky in that field.
function ipgRowIn(p, f) {
  if (!f) return p.bucket === 'tm' || p.bucket === 'claim';
  if (f === 'tm') return p.tm > 0;
  if (f === 'claim') return p.claim > 0;
  if (f === 'allowed') return p.okN > 0;
  if (f === 'clean' || f === 'unchecked') return p.bucket === f;
  if (f.startsWith('f:')) return p.finds.some(fd => !fd.mark && fd.f === f.slice(2));
  return false;
}
const ipgHit = (p, q) => (p.c.skus || [p.c.sku]).some(x => fcNorm(x).includes(q)) || fcNorm(p.c.asin).includes(q) || fcNorm(p.c.title).includes(q)
  || p.finds.some(fd => fcNorm(fd.word).includes(q) || fcNorm(fd.text).includes(q));
/** The families the brand, the toggle, the search and the chip keep, each with the rows they keep. `o.all`: in stock or not. */
function ipgGroups(model, f, o) {
  const q = fcNorm(IPG.q);
  const filter = f === undefined ? IPG.f : f;
  const stock = o && o.all ? false : IPG.stock;
  return model.groups.filter(g => IPG.brand === 'ALL' || g.f.brand === IPG.brand).map(g => {
    const famHit = q && (fcNorm(g.f.name).includes(q) || fcNorm(g.f.psku).includes(q) || fcNorm(g.f.pa).includes(q));
    const inView = g.rows.filter(p => !stock || p.c.live);
    const rows = inView.filter(p => ipgRowIn(p, filter) && (!q || famHit || ipgHit(p, q)));
    return rows.length ? { f: g.f, g, inView, rows } : null;
  }).filter(Boolean);
}
const ipgCount = (model, k) => ipgGroups(model, k).reduce((sum, x) => sum + x.rows.length, 0);
/** The rows the By-listing screen shows now, in its order. */
const ipgShownRows = model => ipgGroups(model).flatMap(x => x.rows);
/** The numbers of the top summary — the brand and the search in use; "with stock" beside every listing, whatever the toggle says. */
function ipgSummary(model) {
  const every = model.groups.filter(g => IPG.brand === 'ALL' || g.f.brand === IPG.brand).flatMap(g => g.rows);
  const risky = every.filter(p => p.bucket === 'tm' || p.bucket === 'claim');
  const inView = risky.filter(p => !IPG.stock || p.c.live);
  const fields = {};
  let finds = 0;
  inView.forEach(p => p.finds.forEach(fd => { if (!fd.mark) { fields[fd.f] = (fields[fd.f] || 0) + 1; finds++; } }));
  const top = IPG_FIELDS.filter(k => fields[k]).sort((a, b) => fields[b] - fields[a])[0] || '';
  return { total: every.length, shown: every.filter(p => !IPG.stock || p.c.live).length, risky: risky.length, withStock: risky.filter(p => p.c.live).length, tm: inView.filter(p => p.tm > 0).length, claim: inView.filter(p => p.claim > 0).length,
    fields, finds, top, unchecked: every.filter(p => p.bucket === 'unchecked').length, brands: IPG.brand === 'ALL' ? ['SP', 'CPC'] : [IPG.brand] };
}
/** By word: each risky word over the listings in view (brand, toggle, search): [{ w, rows (products), live, fams (fk → name), fields,
 *  finds: [{ p, fd }], kw: [{ brand, sku }], allowed (listings where it is allowed on purpose) }] — trademark first, then the most listings. */
function ipgWordCards(model) {
  const by = new Map();
  const q = fcNorm(IPG.q);
  model.groups.filter(g => IPG.brand === 'ALL' || g.f.brand === IPG.brand).forEach(g => {
    const famHit = q && (fcNorm(g.f.name).includes(q) || fcNorm(g.f.psku).includes(q) || fcNorm(g.f.pa).includes(q));
    g.rows.forEach(p => {
      if ((IPG.stock && !p.c.live) || (q && !famHit && !ipgHit(p, q))) return;
      // a search that names the family or the listing keeps all its words; one that names a word keeps that word
      const rowHit = !q || famHit || (p.c.skus || [p.c.sku]).some(x => fcNorm(x).includes(q)) || fcNorm(p.c.asin).includes(q) || fcNorm(p.c.title).includes(q);
      p.finds.forEach(fd => {
        if (!rowHit && !fcNorm(fd.word).includes(q) && !fcNorm(fd.text).includes(q)) return;
        let card = by.get(fd.k);
        if (!card) by.set(fd.k, card = { w: model.words.byKey.get(fd.k) || { k: fd.k, word: fd.word, type: fd.type }, rows: new Set(), fams: new Map(), fields: {}, finds: [], kw: new Map(), allowed: new Set() });
        if (fd.mark) { card.allowed.add(p.key); return; }
        card.rows.add(p);
        card.fams.set(g.f.fk, g.f.name);
        card.fields[fd.f] = (card.fields[fd.f] || 0) + 1;
        card.finds.push({ p, fd });
        if (fd.f === 'kw') card.kw.set(fcKey(p.c.brand, fd.sku), { brand: p.c.brand, sku: fd.sku });
      });
    });
  });
  return [...by.values()].map(card => Object.assign(card, { live: [...card.rows].filter(p => p.c.live).length }))
    .sort((a, b) => (a.w.type === b.w.type ? 0 : a.w.type === 'tm' ? -1 : 1) || b.rows.size - a.rows.size || b.allowed.size - a.allowed.size || String(a.w.word).localeCompare(String(b.w.word)));
}
const ipgCardIn = (card, f) => (!f ? card.rows.size > 0 : f === 'allowed' ? card.allowed.size > 0 : card.w.type === f && card.rows.size > 0);
const ipgCardsShown = model => ipgWordCards(model).filter(card => ipgCardIn(card, IPG.f));

/* ============================================================================================
 * 5. SCREEN = DOWNLOAD: one finding's words, used by the screen's snippet line and by the sheet's row
 * ============================================================================================ */
const ipgMarkText = mark => (mark ? `Yes — ${mark.name || fcName(mark.by)}${mark.at ? ' on ' + ipgDate(mark.at) : ''}${mark.fam ? ' (whole family)' : ''}` : 'No');
/** One finding of one product in words. `fd` null = a product with nothing to show under it (Clean / Not checked): one line of its own. */
function ipgFindView(p, fd) {
  const c = p.c;
  const base = { brand: fcBrandName(c.brand), family: p.g.f.solo ? '' : String(p.g.f.name || ''), sku: fd ? fd.sku : (c.skus || [c.sku]).join(' / '), asin: c.asin || '', stock: c.stock == null ? '' : c.stock,
    link: c.asin ? 'https://www.amazon.com/dp/' + c.asin : '', time: p.at ? ipgTime(p.at) : 'not read' };
  if (!fd) return Object.assign(base, { field: '', word: '', type: '', snippet: '', why: '', what: p.bucket === 'unchecked' ? 'Not checked — Sellora holds no Amazon read of this listing yet' : 'Nothing to do — no risky word', allowed: '' });
  return Object.assign(base, { field: fd.label, word: fd.word, type: IPG_TYPE[fd.type].csv, snippet: fd.snip.a + fd.snip.hit + fd.snip.b, why: IPG_TYPE[fd.type].why, what: ipgFindWhat(fd), allowed: ipgMarkText(fd.mark),
    time: fd.at ? ipgTime(fd.at) : base.time });
}
/** The sheet's lines for the view in use, in the screen's order: By listing — every finding of every row shown (a Clean / Not checked row:
 *  one line); By word — the findings of the cards shown. */
function ipgShownFinds(model) {
  if (IPG.view === 'word') return ipgCardsShown(model).flatMap(card => card.finds.map(x => ipgFindView(x.p, x.fd)));
  return ipgShownRows(model).flatMap(p => (p.finds.length ? p.finds.map(fd => ipgFindView(p, fd)) : [ipgFindView(p, null)]));
}
const IPG_CSV_COLS = ['Brand', 'Family', 'SKU', 'ASIN', 'Stock', 'Field', 'Risky word', 'Type', 'Snippet', 'Why', 'What to do', 'Allowed on purpose', 'Amazon link', 'Data time'];
const ipgCsvQ = val => { const s = String(val == null ? '' : val); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
/** The sheet: the lines on the screen (view, toggle, brand, chip, search), Excel-ready (UTF-8 BOM, CRLF). */
function ipgCsv(model) {
  const rows = ipgShownFinds(model || ipgBuild());
  const lines = rows.map(r => [r.brand, r.family, r.sku, r.asin, r.stock, r.field, r.word, r.type, r.snippet, r.why, r.what, r.allowed, r.link, r.time].map(ipgCsvQ).join(','));
  return { n: lines.length, rows, text: '﻿' + [IPG_CSV_COLS.join(',')].concat(lines).join('\r\n') + '\r\n' };
}
function ipgDownload() {
  const out = ipgCsv();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.text], { type: 'text/csv;charset=utf-8' }));
  a.download = `Sellora-ip-trademark-guard-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return out;
}

/* ============================================================================================
 * 6. FIX — the existing popups, nothing new
 * ============================================================================================ */
// The Listing Health row of a listing (what the existing fixes are worked out from).
function ipgHealthRow(brand, sku, c) {
  const rows = (typeof HEALTH !== 'undefined' && HEALTH[brand] && HEALTH[brand].rows) || [];
  if (!IPG.rowsOf || IPG.rowsOf[brand + 'src'] !== rows) IPG.rowsOf = Object.assign(IPG.rowsOf || {}, { [brand]: new Map(rows.map(r => [r.sku, r])), [brand + 'src']: rows });
  return IPG.rowsOf[brand].get(sku) || { sku, asin: (c && c.asin) || '', parent: '' };
}
// The listings (SKUs) of these products with a risky word (not allowed) in this field: [{ brand, sku, p }].
function ipgSkusWith(rows, f, k) {
  const out = new Map();
  rows.forEach(p => p.finds.forEach(fd => { if (!fd.mark && fd.f === f && !fd.subClean && (!k || fd.k === k)) out.set(fcKey(p.c.brand, fd.sku), { brand: p.c.brand, sku: fd.sku, p }); }));
  return [...out.values()];
}
/** Fix search terms: the existing "Fix all search terms" popup (kw-fix.js) over these listings — it takes the risky words out (and
 *  shortens a text over the limit, as always); Amazon's check → Approve & send → read again → Listing History → Put back. */
function ipgFixKw(list, o) {
  if (!list.length || typeof kfPreview !== 'function' || typeof kfItemOf !== 'function') return null;
  const ctx = hCtx();
  const items = list.map(x => kfItemOf(x.brand, ipgHealthRow(x.brand, x.sku, x.p && x.p.c), ctx, null));
  return kfPreview(items, { title: o.title, row: 'ipkw', name: 'Risky words in search terms', brand: list[0].brand, parent: o.parent || '' });
}
/** Fix title: the existing "Fix all titles" popup (title-fix.js) over these listings — one new title each from the title template, and
 *  the person approves (or edits) every one. A listing it cannot make a title for is named there with "Edit by hand in Listing Errors". */
async function ipgFixTitle(list, o) {
  if (!list.length || typeof ttStartList !== 'function') return null;
  if (typeof lcEnsureRules === 'function') { try { await lcEnsureRules(); } catch (e) { /* the popup says what it could not make */ } }
  const brand = list[0].brand;
  const extra = new Map();
  list.filter(x => x.brand === brand).forEach(x => extra.set(x.sku, [...new Set(x.p.finds.filter(fd => !fd.mark && fd.f === 'title' && fd.sku === x.sku).map(fd => `Risky word: ${fd.word}`))]));
  return ttStartList(brand, [...extra.keys()], { title: o.title, parent: o.parent || '', extra });
}
// Bullets, the description, Item Highlights: the listing in Listing Errors, where a person edits it (Amazon checks before it is sent).
function ipgEdit(brand, sku, hl) {
  if (typeof lrFixOpen === 'function') lrFixOpen('lerr', brand, sku, hl ? ['title_differentiation'] : []);
}
// A Fix popup finished (kw-fix.js / title-fix.js call this): the page follows what was sent.
function ipgAfterSend() {
  IPG.sideV++;
  if (ipgPaneOn()) ipgDrawKeep();
}
/** FOR kw-fix.js: the risky words of one listing's search terms as places in the text — [{ s, e, why }] — the ones allowed on purpose
 *  left out. kfShorten takes the words there out. */
function ipgKwRisk(brand, sku, row, cfg) {
  if (!IPG.okLoaded && !IPG.okLoading) ipgOkLoad();
  const famId = IPG.model && IPG.model.famOf.has(fcKey(brand, sku)) ? IPG.model.famOf.get(fcKey(brand, sku)) : (row && row.parent && row.parent !== row.asin ? row.parent : '');
  const ours = [row && row.amzBrand].filter(Boolean);
  return text => ipgFind(text, cfg, { ours }).filter(x => !ipgMarkOf(brand, sku, famId, x.k))
    .map(x => ({ s: x.s, e: x.e, why: x.type === 'tm' ? "risky: another brand's name" : 'risky: restricted claim' }));
}
/** FOR title-fix.js: what a new title still holds that it must not: ['risky word “Pottery Barn” (another brand's name)'] — allowed words left out. */
function ipgTitleRisk(brand, sku, row, title, cfg) {
  const famId = IPG.model && IPG.model.famOf.has(fcKey(brand, sku)) ? IPG.model.famOf.get(fcKey(brand, sku)) : (row && row.parent && row.parent !== row.asin ? row.parent : '');
  return ipgFind(title, cfg, { ours: [row && row.amzBrand].filter(Boolean) }).filter(x => !ipgMarkOf(brand, sku, famId, x.k))
    .map(x => `risky word “${x.text}” (${x.type === 'tm' ? "another brand's name" : 'a restricted claim'})`);
}

/* ============================================================================================
 * 7. DRAWING
 * ============================================================================================ */
function ipgShell() {
  const box = $('ipgPane');
  if (!box || IPG.built) return;
  const seg = [['list', 'By listing'], ['word', 'By word']].map(([k, t]) => `<button type="button" class="segbtn${IPG.view === k ? ' on' : ''}" data-ipg="view" data-ipg-v="${k}" aria-pressed="${IPG.view === k}">${t}</button>`).join('');
  box.innerHTML = `<div class="card fc-tb ipg-tb" id="ipgTb"><div class="toolbar"><div class="seg" role="group" aria-label="Which view">${seg}</div>`
    + `<select data-ipg-f="brand" aria-label="Brand"><option value="ALL">Both brands</option><option value="SP">${fcEsc(fcBrandName('SP'))}</option><option value="CPC">${fcEsc(fcBrandName('CPC'))}</option></select>`
    + `<label class="ipg-tog" title="On: only listings that are buyable and have stock. Off: every listing, in stock or not."><input type="checkbox" data-ipg-f="stock"${IPG.stock ? ' checked' : ''}> Stock &gt; 0 only</label>`
    + `<input type="search" class="cc-q" data-ipg-f="q" placeholder="Search SKU, ASIN, family or word" aria-label="Search" value="${fcEsc(IPG.q)}">`
    + `<span style="flex:1"></span><span id="ipgTools"></span>`
    + `<button type="button" class="ghost" data-ipg="rules" title="Listing Rules → What people may write: the two lists this screen checks">Edit the word lists</button></div>`
    + `</div><div class="fc-meta muted ipg-meta" id="ipgMeta"></div><div id="ipgBody"></div>`;
  const sel = box.querySelector ? box.querySelector('[data-ipg-f="brand"]') : null;
  if (sel) sel.value = IPG.brand;
  IPG.built = true;
}
function ipgToolsHtml() {
  return (IPG.view === 'list' ? '<button type="button" class="ghost" data-ipg="openall">Open all</button><button type="button" class="ghost" data-ipg="closeall">Close all</button>' : '')
    + '<button type="button" class="ghost" data-ipg="csv" title="The lines in view (toggle, brand, chip and search), as a sheet">⬇ Download</button>';
}
function ipgMetaHtml(model) {
  const brands = IPG.brand === 'ALL' ? ['SP', 'CPC'] : [IPG.brand];
  const label = typeof lmDataLabel === 'function' ? lmDataLabel(brands) : null;
  const W = model.words;
  return `<div>Amazon data: ${label ? fcEsc(label.text) : '<span class="fc-old">the listing cache is not loaded or is older than a day — listings without a read are “Not checked”</span>'}`
    + ` · Checked for ${ipgN(W.tm, "other brand's name", "other brands' names")} and ${ipgN(W.claim, 'restricted claim')} (Listing Rules → What people may write) · This screen reads nothing from Amazon</div>`
    + model.notes.map(n => `<div>${fcEsc(n)}</div>`).join('') + (IPG.okNote ? `<div class="fc-oknote">${fcEsc(IPG.okNote)}</div>` : '') + (IPG.err ? `<div class="fc-oknote">${fcEsc(IPG.err)}</div>` : '');
}
/** The one-glance summary: how many listings hold a risky word, the split, and where most of them are. */
function ipgSummaryHtml(s) {
  const more = IPG.stock && s.risky > s.withStock ? ` <small class="muted">${ipgN(s.risky - s.withStock, 'more is', 'more are')} out of stock — switch “Stock &gt; 0 only” off to see ${s.risky - s.withStock === 1 ? 'it' : 'them'}</small>` : '';
  const head = `<div class="ipg-big"><b>${ipgN(s.risky, 'listing')} with risky words</b> <span>(${fcNf(s.withStock)} with stock)</span>${more}</div>`;
  const split = `<div class="ipg-split"><span><i class="is-r"></i>Trademark <b>${fcNf(s.tm)}</b></span><span><i class="is-y"></i>Claims <b>${fcNf(s.claim)}</b></span>`
    + (s.top ? `<span class="ipg-most">Most are in <b>${fcEsc(IPG_FIELD[s.top].toLowerCase())}</b> (${fcNf(s.fields[s.top])} of ${ipgN(s.finds, 'finding')})</span>` : '') + '</div>';
  const fields = s.finds ? `<div class="ipg-fields">${IPG_FIELDS.filter(k => s.fields[k]).map(k => `<span>${fcEsc(IPG_FIELD[k])} <b>${fcNf(s.fields[k])}</b></span>`).join('')}</div>` : '';
  return `<div class="card ipg-sum">${head}${split}${fields}</div>`;
}
function ipgCardsHtml(model, s) {
  const box = k => { const st = IPG_ST[k]; const n = ipgCount(model, k); return `<button type="button" class="fc-box ipg-box is-${st.cls}${IPG.f === k ? ' is-on' : ''}" data-ipg="f" data-ipg-v="${k}" aria-pressed="${IPG.f === k}" title="${fcEsc(st.tip)}">`
    + `<span>${fcEsc(st.t)}</span><b>${fcNf(n)}</b><small>${fcEsc(st.one)}</small></button>`; };
  const chip = (k, t, n) => `<button type="button" class="cc-fchip${IPG.f === k ? ' is-on' : ''}" data-ipg="chip" data-ipg-v="${k}" aria-pressed="${IPG.f === k}">${fcEsc(t)}${n == null ? '' : ` <b>${fcNf(n)}</b>`}</button>`;
  const chips = [chip('', 'All risky', ipgCount(model, '')), chip('tm', 'Trademark', ipgCount(model, 'tm')), chip('claim', 'Claims', ipgCount(model, 'claim'))]
    .concat(IPG_FIELDS.map(k => chip('f:' + k, 'In ' + IPG_FIELD[k].toLowerCase().replace('item highlights', 'Item Highlights'), ipgCount(model, 'f:' + k))),
      [chip('allowed', 'Allowed on purpose', ipgCount(model, 'allowed')), chip('clean', 'Clean', ipgCount(model, 'clean'))],
      s.unchecked || IPG.f === 'unchecked' ? [chip('unchecked', 'Not checked', ipgCount(model, 'unchecked'))] : []).join('');
  return `<div class="fc-boxes">${IPG_CARDS.map(box).join('')}</div><div class="cc-chips" role="group" aria-label="Show">${chips}</div>`;
}
function ipgPicHtml(c) {
  const rec = c.asin && typeof lmGetAsin === 'function' ? lmGetAsin(c.asin, c.brand) : null;
  const u = rec && rec.img && rec.img.MAIN && rec.img.MAIN.u ? String(rec.img.MAIN.u) : '';
  const url = u ? (typeof imThumb === 'function' ? imThumb(u) : u) : '';
  return url ? `<img class="cc-pic" src="${fcEsc(url)}" alt="" loading="lazy" decoding="async" width="36" height="36">` : '<span class="cc-pic is-none" aria-hidden="true"></span>';
}
// One finding as a line: the field, then the piece of its text with the word marked. The sheet's row is the same record (ipgFindView).
function ipgSnipHtml(p, fd) {
  const many = (p.c.skus || []).length > 1;
  return `<div class="ipg-snip${fd.subClean ? ' is-wait' : ''}" data-ipg-fd="${fcEsc(fd.sku + '|' + fd.label + '|' + fd.k)}"><span class="ipg-fld">${many ? fcEsc(fd.sku) + ' · ' : ''}${fcEsc(fd.label)}</span>`
    + `<span class="ipg-tx">${fcEsc(fd.snip.a)}<mark class="ipg-hit is-${fd.mark ? 'g' : IPG_TYPE[fd.type].cls}">${fcEsc(fd.snip.hit)}</mark>${fcEsc(fd.snip.b)}</span>${fd.n > 1 ? `<small class="muted"> ×${fd.n}</small>` : ''}</div>`;
}
/** A product's findings, one block per word: the type, the word, why it is risky, each place it is in, and Allowed on purpose / Undo. */
function ipgFindsHtml(p) {
  if (!p.finds.length) return p.bucket === 'unchecked' ? '<span class="fc-none">Not checked — no Amazon read of this listing</span>' : '<span class="ipg-clean">✓ No risky word</span>';
  const by = new Map();
  p.finds.forEach(fd => { const id = fd.k + '|' + (fd.mark ? fd.mark.id || 'ok' : ''); if (!by.has(id)) by.set(id, []); by.get(id).push(fd); });
  const a = `data-ipg-b="${fcEsc(p.c.brand)}" data-ipg-s="${fcEsc(p.key)}"`;
  return [...by.values()].map(list => {                       // in the findings' own order (ipgProduct): the sheet's rows follow the same
    const fd = list[0], t = IPG_TYPE[fd.type], mark = fd.mark;
    const head = mark ? `<span class="fc-chip is-g ipg-c">Allowed on purpose</span><b>${fcEsc(fd.word)}</b><small>${fcEsc(t.t.toLowerCase())} · allowed by ${fcEsc(mark.name || fcName(mark.by))}${mark.at ? ' on ' + fcEsc(ipgDate(mark.at)) : ''}${mark.fam ? ' for the whole family' : ''}</small>`
      : `<span class="fc-chip is-${t.cls} ipg-c">${fcEsc(t.t)}</span><b>${fcEsc(fd.word)}</b><small>${fcEsc(t.why)}</small>`;
    const acts = mark ? `<button type="button" class="ghost fc-b" data-ipg="undo" ${a} data-ipg-w="${fcEsc(fd.k)}" title="${mark.fam ? 'The word counts again on every listing of the family' : 'The word counts again on this listing'}">Undo${mark.fam ? ' (whole family)' : ''}</button>`
      : `<button type="button" class="ghost fc-b" data-ipg="ok" ${a} data-ipg-w="${fcEsc(fd.k)}" title="This word is fine on this listing (you hold the right or the proof): it stops counting and no Fix takes it out. Undo brings it back.">Allowed on purpose</button>`
        + (p.g.f.famId ? `<button type="button" class="ghost fc-b" data-ipg="okfam" data-ipg-v="${fcEsc(p.g.f.fk)}" data-ipg-w="${fcEsc(fd.k)}" title="Allowed on every listing of this family, now and later">Allow for the whole family</button>` : '');
    // ✨ AI (listing-ai.js): only the sentence with the word, rewritten — then into the existing Fix all popup (title, search terms) or the safe send
    const ai = !mark && !fd.subClean && typeof aiOn === 'function' && aiOn() ? aiBtnHtml('ip_rewrite', p.c.brand, fd.sku, { use: 'ipg', field: fd.f, word: fd.text || fd.word, wk: fd.word, screen: 'IP & Trademark Guard', label: 'Rewrite without this word' }) : '';
    return `<div class="ipg-w is-${mark ? 'g' : t.cls}"><div class="ipg-wh">${head}</div>${list.map(x => ipgSnipHtml(p, x)).join('')}<div class="ipg-wa">${acts}${ai}</div></div>`;
  }).join('');
}
// The row's own buttons: what each press opens (the existing popups / Listing Errors).
function ipgActsHtml(p) {
  const a = `data-ipg-b="${fcEsc(p.c.brand)}" data-ipg-s="${fcEsc(p.key)}"`;
  const kw = ipgSkusWith([p], 'kw').length, title = ipgSkusWith([p], 'title').length;
  const edit = p.finds.filter(fd => !fd.mark && (fd.f === 'bullets' || fd.f === 'desc' || fd.f === 'hl'));
  const busy = typeof sqIsOpen === 'function' && sqIsOpen();
  return (kw ? `<button type="button" class="ghost fc-b" data-ipg="fixkw" ${a}${busy ? ' disabled' : ''} title="Opens Fix all search terms for this listing: the risky words are taken out; Amazon checks before anything is sent">Fix search terms</button>` : '')
    + (title ? `<button type="button" class="ghost fc-b" data-ipg="fixtitle" ${a}${busy ? ' disabled' : ''} title="Opens Fix all titles for this listing: you see and approve the new title before it is sent">Fix title</button>` : '')
    + (edit.length ? `<button type="button" class="ghost fc-b" data-ipg="edit" ${a} data-ipg-v="${fcEsc(edit[0].sku)}" data-ipg-hl="${edit.some(fd => fd.f === 'hl') ? 1 : ''}" title="Opens this listing in Listing Errors: edit the ${[...new Set(edit.map(fd => (fd.f === 'desc' ? 'description' : fd.f === 'hl' ? 'Item Highlights' : 'bullets')))].join(' / ')} there">Edit in Listing Errors</button>` : '');
}
function ipgRowHtml(p) {
  const c = p.c;
  const amz = c.asin ? `<a href="https://www.amazon.com/dp/${fcEsc(c.asin)}" target="_blank" rel="noopener" title="Open on Amazon in a new tab">${fcEsc(c.asin)}</a>` : '—';
  const side = p.bucket === 'tm' ? ' is-orphan' : p.bucket === 'claim' ? ' cc-chk' : '';
  const whats = [...new Set(p.finds.length ? p.finds.map(ipgFindWhat) : [ipgFindView(p, null).what])];
  return `<tr class="fc-row ipg-row${side}" data-ipg-row="${fcEsc(p.key)}"><td class="cc-pc">${ipgPicHtml(c)}</td>`
    + `<td class="fc-sku"><b>${fcEsc((c.skus || [c.sku]).join(' / '))}</b>${typeof lmOldHtml === 'function' ? lmOldHtml(c.brand, c.sku) : ''}<small>${fcEsc(String(c.title || '').slice(0, 70))}</small></td>`
    + `<td class="ui-mono">${amz}</td><td class="num">${c.stock == null ? '<span class="fc-none">—</span>' : fcNf(c.stock)}</td>`
    + `<td class="ipg-finds">${ipgFindsHtml(p)}</td>`
    + `<td class="fc-prob ipg-what">${whats.map(w => `<div class="ipg-do${/^Nothing to do|^Not checked/.test(w) ? ' is-g' : ''}">${fcEsc(w)}</div>`).join('')}</td>`
    + `<td class="fc-acts">${ipgActsHtml(p)}</td></tr>`;
}
const IPG_COLHEAD = '<tr class="fc-colh"><th></th><th>SKU</th><th>ASIN</th><th class="num">Stock</th><th>Risky words</th><th>What to do</th><th></th></tr>';
/** One family: a single line while closed (how many of its listings hold what); open, its Fix all buttons, the header and its listings. */
function ipgGroupHtml(x) {
  const g = x.g, f = g.f, open = IPG.open.has(f.fk);
  const n = k => x.inView.filter(p => (k === 'tm' ? p.tm > 0 : k === 'claim' ? p.claim > 0 : k === 'allowed' ? p.okN > 0 : p.bucket === k)).length;
  const badge = (k, cls, one, many) => { const v = n(k); return v ? `<span class="fc-chip is-${cls}">${fcNf(v)} ${v === 1 ? one : many}</span>` : ''; };
  const badges = badge('tm', 'r', 'trademark', 'trademark') + badge('claim', 'y', 'claim', 'claims') + badge('allowed', 'g', 'allowed', 'allowed') + badge('unchecked', 'g', 'not checked', 'not checked');
  const words = [...new Set(x.rows.flatMap(p => p.finds.filter(fd => !fd.mark).map(fd => fd.word)))];
  const wordsHtml = words.length ? `<span class="ipg-words muted">${words.slice(0, 4).map(fcEsc).join(', ')}${words.length > 4 ? ` +${words.length - 4}` : ''}</span>` : '';
  const kw = ipgSkusWith(x.rows, 'kw').length, title = ipgSkusWith(x.rows, 'title').length;
  const busy = typeof sqIsOpen === 'function' && sqIsOpen();
  const bar = open && (kw || title) ? `<tr class="ipg-famr"><td colspan="${IPG_COLS}"><div class="ipg-fam"><b>For this family:</b>`
    + (kw ? `<button type="button" class="fc-b" data-ipg="famkw" data-ipg-v="${fcEsc(f.fk)}"${busy ? ' disabled' : ''} title="One popup for every listing of this family with a risky word in its search terms: the words are taken out; Amazon checks first">Fix all search terms (${fcNf(kw)})</button>` : '')
    + (title ? `<button type="button" class="ghost fc-b" data-ipg="famtitle" data-ipg-v="${fcEsc(f.fk)}"${busy ? ' disabled' : ''} title="One popup for every listing of this family with a risky word in its title: you approve each new title">Fix all titles (${fcNf(title)})</button>` : '')
    + '</div></td></tr>' : '';
  return `<tbody class="fc-grp${open ? ' is-open' : ''}"><tr class="fc-head" data-ipg="grp" data-ipg-v="${fcEsc(f.fk)}" data-ipg-k="${fcEsc(f.fk)}" tabindex="0" aria-expanded="${open}"><td colspan="${IPG_COLS}">`
    + `<button type="button" class="fc-arrow" data-ipg="grp" data-ipg-v="${fcEsc(f.fk)}" aria-label="${open ? 'Close' : 'Open'} ${fcEsc(f.name)}">${open ? '▾' : '▸'}</button>`
    + `<b>${fcEsc(f.name)}</b> <small class="muted">${fcEsc(fcBrandName(f.brand))} · ${f.solo ? '1 listing, no family' : fcNf(x.rows.length) + ' of ' + ipgN(x.inView.length, IPG.stock ? 'live child' : 'child', IPG.stock ? 'live children' : 'children')}</small> ${badges}${wordsHtml}</td></tr>`
    + (open ? bar + IPG_COLHEAD + ipgFamRowsHtml(f.fk, x.rows) : '') + '</tbody>';
}
/* A BIG FAMILY IS DRAWN A SCREENFUL FIRST (as A+ Content does): its first rows at once, the others a frame at a time after the draw. */
const ipgProgressive = () => typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && !!document.body;
function ipgFamRowsHtml(fk, rows) {
  let first = rows.length;
  if (ipgProgressive() && rows.length > IPG_ROWS_FIRST + 10) {
    const at = IPG.need ? rows.findIndex(p => p.key === IPG.need) : -1;
    first = Math.min(rows.length, Math.max(IPG_ROWS_FIRST, at + 20));
  }
  if (first < rows.length) IPG.later.set(fk, rows.slice(first));
  return rows.slice(0, first).map(ipgRowHtml).join('')
    + (first < rows.length ? `<tr class="ipg-laterr" data-ipg-later="${fcEsc(fk)}"><td colspan="${IPG_COLS}" class="muted">… ${fcNf(rows.length - first)} more rows</td></tr>` : '');
}
function ipgLaterRows() {
  const mine = ++IPG.laterV;
  if (!IPG.later.size || !ipgProgressive()) return;
  const step = () => {
    if (mine !== IPG.laterV) return;                               // the page was drawn again since
    const next = IPG.later.entries().next().value;
    if (!next) return;
    const [fk, rest] = next;
    const mark = [...$('ipgBody').querySelectorAll('tr.ipg-laterr')].find(tr => tr.dataset.ipgLater === fk);
    if (!mark) IPG.later.delete(fk);
    else {
      mark.insertAdjacentHTML('beforebegin', rest.splice(0, IPG_ROWS_STEP).map(ipgRowHtml).join(''));
      if (!rest.length) { mark.remove(); IPG.later.delete(fk); }
      else mark.firstChild.textContent = '… ' + fcNf(rest.length) + ' more rows';
    }
    if (IPG.later.size) requestAnimationFrame(() => setTimeout(step, 0));
  };
  requestAnimationFrame(() => setTimeout(step, 0));
}
/** One risky word as a card: how many listings, which families, the fields, a few of its lines, and what a press opens. */
function ipgWordCardHtml(card) {
  const w = card.w, t = IPG_TYPE[w.type];
  const busy = typeof sqIsOpen === 'function' && sqIsOpen();
  const fams = [...card.fams.values()];
  const fields = IPG_FIELDS.filter(k => card.fields[k]).map(k => `${IPG_FIELD[k]} ${fcNf(card.fields[k])}`).join(' · ');
  const eg = card.finds.slice(0, 3).map(x => `<div class="ipg-eg"><small class="ui-mono">${fcEsc(x.fd.sku)}</small>${ipgSnipHtml({ c: { skus: [] } }, x.fd)}</div>`).join('');
  return `<div class="card ipg-wcard is-${t.cls}" data-ipg-k="word:${fcEsc(w.k)}"><div class="ipg-wch"><b title="${fcEsc(w.word)}">${fcEsc(w.word)}</b> <span class="fc-chip is-${t.cls}">${fcEsc(t.t)}</span></div>`
    + `<div class="ipg-wcw">${fcEsc(t.why)}</div>`
    + `<div class="ipg-wcn"><b>${ipgN(card.rows.size, 'listing')}</b> (${fcNf(card.live)} with stock) · ${ipgN(card.fams.size, 'family', 'families')} · ${ipgN(card.finds.length, 'finding')}`
    + (card.allowed.size ? ` · <span class="muted">allowed on purpose on ${fcNf(card.allowed.size)}</span>` : '') + '</div>'
    + (fields ? `<div class="ipg-wcf muted">${fcEsc(fields)}</div>` : '')
    + (fams.length ? `<div class="ipg-wcf muted" title="${fcEsc(fams.join('\n'))}">Families: ${fams.slice(0, 3).map(n => fcEsc(String(n).slice(0, 40))).join(', ')}${fams.length > 3 ? ` +${fams.length - 3} more` : ''}</div>` : '')
    + eg + (card.finds.length > 3 ? `<div class="muted ipg-wcf">… ${fcNf(card.finds.length - 3)} more in “Show the listings” and in the download</div>` : '')
    + `<div class="ipg-wca">${card.rows.size ? `<button type="button" class="ghost fc-b" data-ipg="show" data-ipg-w="${fcEsc(w.k)}" title="By listing, with this word in the search box">Show the ${ipgN(card.rows.size, 'listing')}</button>` : ''}`
    + (card.kw.size ? `<button type="button" class="fc-b" data-ipg="wordkw" data-ipg-w="${fcEsc(w.k)}"${busy ? ' disabled' : ''} title="One popup for every listing with this word in its search terms: it is taken out; Amazon checks first">Fix all in search terms (${fcNf(card.kw.size)})</button>` : '')
    + '</div></div>';
}
function ipgSkeleton() {
  const line = '<div class="ipg-skel"><span class="sp-skel is-w"></span><span class="sp-skel is-s"></span></div>';
  return `<div class="card ipg-sum"><div class="ipg-big"><span class="sp-skel is-w"></span></div></div><div class="card fc-wrap">${line.repeat(7)}</div>`;
}
function ipgBodyHtml(model) {
  const s = ipgSummary(model);
  const noData = s.total > 0 && s.unchecked === s.total;
  const why = `<div class="card fc-empty"><b>Not checked yet</b><p class="muted">Sellora holds no Amazon read of these listings (the listing cache is not loaded, or is older than a day). Nothing is flagged and nothing is called clean.</p></div>`;
  if (IPG.view === 'word') {
    const all = ipgWordCards(model);
    const cnt = k => all.filter(card => ipgCardIn(card, k)).length;
    const chip = (k, t) => `<button type="button" class="cc-fchip${IPG.f === k ? ' is-on' : ''}" data-ipg="chip" data-ipg-v="${k}" aria-pressed="${IPG.f === k}">${fcEsc(t)} <b>${fcNf(cnt(k))}</b></button>`;
    const chips = `<div class="cc-chips" role="group" aria-label="Show">${chip('', 'All risky words')}${chip('tm', 'Trademark')}${chip('claim', 'Claims')}${chip('allowed', 'Allowed on purpose')}</div>`;
    const list = all.filter(card => ipgCardIn(card, IPG.f));
    const shown = list.slice(0, IPG.words);
    const note = noData ? why : !list.length ? `<div class="card fc-empty${IPG.q || IPG.f ? '' : ' cc-allok'}"><b>${IPG.q ? 'Nothing matches the search' : IPG.f ? 'No word under this chip' : 'No risky words found ✓'}</b></div>` : '';
    return ipgSummaryHtml(s) + chips + note + `<div class="ipg-wcards">${shown.map(ipgWordCardHtml).join('')}</div>`
      + (list.length > shown.length ? `<div class="fc-more" id="ipgMore"><button type="button" class="ghost" data-ipg="more">Show more words (${fcNf(list.length - shown.length)} left)</button></div>` : '');
  }
  const top = ipgSummaryHtml(s) + ipgCardsHtml(model, s);
  const groups = ipgGroups(model);
  const shown = groups.slice(0, IPG.limit);
  let note = '';
  if (!s.total) note = '<div class="card fc-empty"><b>No listings to check</b> — the snapshots are empty. Open Listing Health or Image Manager once.</div>';
  else if (noData) note = why;
  else if (!groups.length) {
    if (IPG.q) note = '<div class="card fc-empty"><b>Nothing matches the search</b></div>';
    else if (!IPG.f) note = `<div class="card fc-empty cc-allok"><b>No risky words found ✓</b>${IPG.stock && s.risky ? ` <span class="muted">— among the listings with stock. ${ipgN(s.risky, 'listing')} out of stock ${s.risky === 1 ? 'has' : 'have'} one: switch “Stock &gt; 0 only” off.</span>` : ''}</div>`;
    else note = `<div class="card fc-empty"><b>No listing under this chip</b></div>`;
  }
  const table = groups.length ? `<div class="card xlwrap fc-wrap"><table class="xl fc-tbl cc-tbl ipg-tbl">${shown.map(ipgGroupHtml).join('')}</table></div>` : '';
  const more = groups.length > shown.length ? `<div class="fc-more" id="ipgMore"><button type="button" class="ghost" data-ipg="more">Show more families (${fcNf(groups.length - shown.length)} left)</button></div>` : '';
  return top + note + table + more;
}
/* THE FIRST CHECK NEVER FREEZES THE PAGE: every listing's texts are checked a slice at a time (≤ 30 ms, then the page breathes) while the
 * skeleton says "Checking 4,400 listings…"; each listing's findings are kept (ipgScan) until its data or the lists change, so the draw
 * that follows — and every later one — only reads them. Without a browser (the tests, the console) the draw checks them at once. */
function ipgCold() {
  if (!ipgProgressive() || typeof IML === 'undefined') return [];
  const W = ipgWords();
  const out = [];
  ['SP', 'CPC'].forEach(b => ((IML[b] && IML[b].items) || []).forEach(it => {
    if (!it || !it.sku || /^parent$/i.test(it.lvl || '')) return;
    const kept = IPG.scan.get(b + '|' + it.sku);
    if (!kept || kept.sig[0] !== (typeof lmGet === 'function' ? lmGet(it.sku, b) : null) || kept.sig[1] !== W.v) out.push([b, it.sku]);
  }));
  return out;
}
function ipgWarm() {
  if (IPG.warm) return IPG.warm;
  const todo = ipgCold();
  if (todo.length < 300) return null;
  IPG.warmN = todo.length;
  IPG.warm = (async () => {
    try {
      let i = 0;
      while (i < todo.length) {
        const t0 = performance.now();
        while (i < todo.length && performance.now() - t0 < 30) { const [b, sku] = todo[i++]; ipgScan(b, sku); }
        if (i < todo.length) await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally { IPG.warm = null; }
    if (ipgPaneOn()) ipgDrawKeep();
  })();
  return IPG.warm;
}
/** Draw the screen. Everything comes from memory: no network wait, no Amazon call. */
function ipgDraw() {
  if (!$('ipgPane')) return;
  ipgShell();
  const body = $('ipgBody');
  if (!body) return;
  if (IPG.loading && !IPG.loaded) { body.innerHTML = ipgSkeleton(); if ($('ipgMeta')) $('ipgMeta').textContent = 'Reading the saved listings…'; return; }
  if (IPG.warm || ipgWarm()) { if (!body.querySelector || !body.querySelector('.ipg-tbl,.ipg-wcards')) body.innerHTML = ipgSkeleton(); if ($('ipgMeta')) $('ipgMeta').textContent = `Checking ${fcNf(IPG.warmN)} listings…`; return; }
  const model = ipgBuild();
  if ($('ipgTools')) $('ipgTools').innerHTML = ipgToolsHtml();
  if ($('ipgMeta')) $('ipgMeta').innerHTML = ipgMetaHtml(model);
  IPG.later.clear();
  body.innerHTML = ipgBodyHtml(model);
  ipgLaterRows();
  ipgWatchMore();
  ipgStick();
}
/** Draw again and keep the person's place: the line (family, listing or word) at the top of the screen stays where it was. */
function ipgDrawKeep() {
  const body = $('ipgBody');
  const find = () => (body && body.querySelectorAll ? [...body.querySelectorAll('[data-ipg-k],[data-ipg-row]')] : []);
  const idOf = el => el.dataset.ipgK || el.dataset.ipgRow;
  let key = '', top = 0;
  if (typeof window !== 'undefined' && body && body.querySelectorAll) {
    const edge = ($('ipgTb') && $('ipgTb').getBoundingClientRect ? $('ipgTb').getBoundingClientRect().bottom : 0) + 1;
    const el = find().find(x => x.getBoundingClientRect().bottom > edge);
    if (el) { key = idOf(el); top = el.getBoundingClientRect().top; }
  }
  IPG.need = key;
  try { ipgDraw(); } finally { IPG.need = ''; }
  if (!key || typeof window === 'undefined' || !window.scrollBy) return;
  const again = find().find(x => idOf(x) === key);
  if (again) window.scrollBy(0, again.getBoundingClientRect().top - top);
}
const ipgStep = () => (IPG.open.size > 3 ? IPG_STEP_OPEN : IPG_STEP);
// "Show more" comes in by itself when it scrolls near the screen.
function ipgWatchMore() {
  if (typeof IntersectionObserver !== 'function') return;
  if (!IPG.io) IPG.io = new IntersectionObserver(seen => { if (ipgPaneOn() && seen.some(e => e.isIntersecting)) ipgMore(); }, { rootMargin: '400px' });
  IPG.io.disconnect();
  const more = $('ipgMore');
  if (more) IPG.io.observe(more);
}
function ipgMore() {
  if (IPG.view === 'word') IPG.words += IPG_WORD_STEP;
  else IPG.limit += ipgStep();
  ipgDraw();
}
// The toolbar sticks under Sellora's menu bar (the bar's height is measured, like A+ Content's).
function ipgStick() {
  if (typeof requestAnimationFrame !== 'function' || typeof document === 'undefined' || !document.body) return ipgStickNow();
  if (!IPG.stickT) IPG.stickT = requestAnimationFrame(() => { IPG.stickT = 0; ipgStickNow(); });
}
function ipgStickNow() {
  try {
    const pane = $('paneIpg');
    if (!pane || !pane.style || !pane.style.setProperty || typeof getComputedStyle !== 'function' || typeof document === 'undefined' || !document.querySelector) return;
    const side = document.querySelector('.side');
    pane.style.setProperty('--ipg-top', (side && getComputedStyle(side).position === 'sticky' ? Math.round(side.getBoundingClientRect().height) : 0) + 'px');
  } catch (e) { /* no layout to measure (a test page) */ }
}
/** Open or close one family; the clicked line stays where it was on the screen. */
function ipgToggle(fk, el) {
  const line = el && el.closest ? el.closest('.fc-head') || el : null;
  const top0 = line && line.getBoundingClientRect ? line.getBoundingClientRect().top : null;
  if (IPG.open.has(fk)) IPG.open.delete(fk);
  else IPG.open.add(fk);
  ipgDraw();
  if (top0 == null || typeof document === 'undefined' || !document.querySelector) return;
  const again = document.querySelector(`#ipgBody .fc-head[data-ipg-v="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(fk) : fk}"]`);
  if (again && again.getBoundingClientRect && typeof window !== 'undefined' && window.scrollBy) window.scrollBy(0, again.getBoundingClientRect().top - top0);
}

/* ----- events ----- */
function ipgClick(el) {
  const act = el.dataset.ipg, v = el.dataset.ipgV, key = el.dataset.ipgS, k = el.dataset.ipgW;
  const model = () => ipgBuild();
  const rowOf = () => model().rows.find(p => p.key === key);
  const famOf = () => ipgGroups(model(), undefined).find(x => x.f.fk === v) || ipgGroups(model(), '').find(x => x.f.fk === v);
  if (act === 'view') { if (IPG.view === v) return null; IPG.view = v; IPG.f = ''; IPG.built = false; return ipgDraw(); }
  if (act === 'f') { IPG.f = IPG.f === v ? '' : v; IPG.limit = IPG_STEP; return ipgDraw(); }           // a card: press again to clear it
  if (act === 'chip') { IPG.f = v || ''; IPG.limit = IPG_STEP; IPG.words = IPG_WORD_STEP; return ipgDraw(); }
  if (act === 'grp') return ipgToggle(v, el);
  if (act === 'openall') { ipgGroups(model()).forEach(x => IPG.open.add(x.f.fk)); IPG.limit = IPG_STEP_OPEN; return ipgDraw(); }
  if (act === 'closeall') { IPG.open.clear(); IPG.limit = IPG_STEP; return ipgDraw(); }
  if (act === 'more') return ipgMore();
  if (act === 'csv') return ipgDownload();
  if (act === 'rules') return typeof showTab === 'function' ? showTab('lrules') : null;
  if (act === 'ok') return ipgAllow(key, k);
  if (act === 'okfam') return ipgAllowFam(v, k);
  if (act === 'undo') return ipgUndo(key, k);
  if (act === 'show') { const w = model().words.byKey.get(k); IPG.view = 'list'; IPG.f = ''; IPG.q = w ? w.word : ''; IPG.built = false; IPG.limit = IPG_STEP; return ipgDraw(); }
  if (act === 'fixkw') { const p = rowOf(); return p ? ipgFixKw(ipgSkusWith([p], 'kw'), { title: (p.c.skus || [p.c.sku]).join(' / '), parent: p.g.f.pa || '' }) : null; }
  if (act === 'fixtitle') { const p = rowOf(); return p ? ipgFixTitle(ipgSkusWith([p], 'title'), { title: (p.c.skus || [p.c.sku]).join(' / '), parent: p.g.f.pa || '' }) : null; }
  if (act === 'edit') return ipgEdit(el.dataset.ipgB, v, !!el.dataset.ipgHl);
  if (act === 'famkw') { const x = famOf(); return x ? ipgFixKw(ipgSkusWith(x.rows, 'kw'), { title: String(x.f.name || '').slice(0, 60), parent: x.f.pa || '' }) : null; }
  if (act === 'famtitle') { const x = famOf(); return x ? ipgFixTitle(ipgSkusWith(x.rows, 'title'), { title: String(x.f.name || '').slice(0, 60), parent: x.f.pa || '' }) : null; }
  if (act === 'wordkw') { const card = ipgWordCards(model()).find(c => c.w.k === k); return card ? ipgFixKw([...card.kw.values()], { title: `every listing with “${card.w.word}” in its search terms` }) : null; }
  return null;
}
function ipgFilter(el) {
  const k = el.dataset.ipgF;
  if (k === 'stock') IPG.stock = !!el.checked;
  else IPG[k] = el.value;
  IPG.limit = ipgStep();
  IPG.words = IPG_WORD_STEP;
  clearTimeout(IPG.qT);
  if (k === 'q') IPG.qT = setTimeout(ipgDraw, 200);
  else ipgDraw();
}
/** Opening the page: the saved snapshots (read once), the rules (the team's lists), the marks, then draw. Nothing is asked of Amazon. */
async function ipgOpen() {
  ipgShell();
  ipgDraw();
  if (IPG.loaded || IPG.loading) return;
  IPG.loading = true;
  ipgDraw();
  try {
    if (typeof LR !== 'undefined' && !LR && typeof lrLoad === 'function') await lrLoad();        // the lists the team edited, not the starting ones
    if (typeof lmEnsure === 'function') await lmEnsure();
    if (typeof loadParentNames === 'function') await loadParentNames();
    if (typeof H_LOADED !== 'undefined' && !H_LOADED && typeof loadHealthCache === 'function') await loadHealthCache();
    for (const b of ['SP', 'CPC']) if (typeof IML !== 'undefined' && !(b in IML) && typeof imListLoad === 'function') await imListLoad(b);
    ipgOkLoad();
    // 30-day sales Sellora already keeps (a saved document, never Amazon): they land when read and the page draws again
    const side = () => { IPG.sideV++; if (ipgPaneOn()) ipgDrawKeep(); };
    if (typeof SALES30 !== 'undefined' && !SALES30.at && typeof loadSales30 === 'function') loadSales30().then(side).catch(() => {});
  } catch (e) {
    IPG.err = 'Could not read the snapshots: ' + ((e && e.message) || e);
  }
  IPG.loading = false;
  IPG.loaded = true;
  ipgDraw();
}
const ipgPaneOn = () => { const pane = $('paneIpg'); return !!(pane && !pane.classList.contains('hide')); };
if (typeof document !== 'undefined' && document.addEventListener && $('ipgPane')) {
  $('ipgPane').addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-ipg]') : null;
    if (el && !el.disabled && !(el.tagName === 'TR' && e.target.closest('a,button,input'))) ipgClick(el);
  });
  $('ipgPane').addEventListener('keydown', e => {
    const t = e.target && e.target.dataset ? e.target : null;
    if (t && (e.key === 'Enter' || e.key === ' ') && t.dataset.ipg === 'grp' && t.tagName !== 'BUTTON') { e.preventDefault(); ipgClick(t); }
  });
  $('ipgPane').addEventListener('change', e => { if (e.target && e.target.dataset && e.target.dataset.ipgF && e.target.dataset.ipgF !== 'q') ipgFilter(e.target); });
  $('ipgPane').addEventListener('input', e => { if (e.target && e.target.dataset && e.target.dataset.ipgF === 'q') ipgFilter(e.target); });
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', () => { if (ipgPaneOn()) ipgStick(); });
  const pane = $('paneIpg');
  if (pane && typeof MutationObserver === 'function') new MutationObserver(() => { if (!pane.classList.contains('hide')) ipgOpen(); }).observe(pane, { attributes: true, attributeFilter: ['class'] });
}

/* ----- THE PROOF (the browser console) ----- */
/** ipReport(): per brand — listings, checked, risky (and with stock), trademark / claims, allowed on purpose, clean, not checked, the
 *  findings per field — the words found most, and 10 example findings with their snippet. On the data this page holds (every listing, in
 *  stock or not); it reads nothing from Amazon. Open IP & Trademark Guard once first (it reads the snapshots). */
function ipReport() {
  const model = ipgBuild();
  const counts = {}, words = {}, examples = [];
  ['SP', 'CPC'].forEach(b => {
    const rows = model.rows.filter(p => p.c.brand === b);
    const risky = rows.filter(p => p.bucket === 'tm' || p.bucket === 'claim');
    const fields = {};
    IPG_FIELDS.forEach(f => { fields['in ' + IPG_FIELD[f]] = 0; });
    risky.forEach(p => p.finds.forEach(fd => { if (!fd.mark) { fields['in ' + IPG_FIELD[fd.f]]++; words[fd.word] = (words[fd.word] || 0) + 1; } }));
    counts[fcBrandName(b)] = Object.assign({ listings: rows.length, checked: rows.filter(p => p.checked).length, risky: risky.length, riskyWithStock: risky.filter(p => p.c.live).length,
      trademark: rows.filter(p => p.tm > 0).length, claims: rows.filter(p => p.claim > 0).length, allowedOnPurpose: rows.filter(p => p.okN > 0).length,
      clean: rows.filter(p => p.bucket === 'clean').length, notChecked: rows.filter(p => p.bucket === 'unchecked').length }, fields);
  });
  // 10 examples: trademark first, then the listings that sell most, one per listing and word
  model.rows.filter(p => p.bucket === 'tm' || p.bucket === 'claim').sort((a, b) => IPG_RANK[a.bucket] - IPG_RANK[b.bucket] || (b.sales || 0) - (a.sales || 0)).some(p => {
    const fd = p.finds.filter(x => !x.mark).sort((x, y) => (x.type === y.type ? 0 : x.type === 'tm' ? -1 : 1))[0];
    if (fd) examples.push({ brand: fcBrandName(p.c.brand), SKU: fd.sku, field: fd.label, word: fd.word, type: IPG_TYPE[fd.type].csv, snippet: fd.snip.a + '[' + fd.snip.hit + ']' + fd.snip.b });
    return examples.length >= 10;
  });
  const top = Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([word, findings]) => ({ word, findings }));
  if (typeof console !== 'undefined') {
    if (console.table) { console.table(counts); console.table(top); console.table(examples); }
    console.log(`IP & Trademark Guard: checked for ${model.words.tm} other brands' names and ${model.words.claim} restricted claims (Listing Rules → What people may write). Every listing, in stock or not.`);
  }
  return { counts, topWords: top, examples };
}
if (typeof window !== 'undefined') window.ipReport = ipReport;
