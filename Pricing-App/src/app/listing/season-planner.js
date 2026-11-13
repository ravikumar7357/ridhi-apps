/* ================= LISTING · SEASON PLANNER: the season words in Item Highlights and the hidden search words, and sending them =================
 * Screens: Listing Optimiser (tab 'opt') → the "Season planner" pill beside "Review one ASIN" (#spPane) — ONLY there. Written for a
 *          seller, not a developer: plain words everywhere, one main button per card, a confirm window before anything is sent.
 * Does (the season rules of 13 Nov 2026 — they replace the old title changes): ONLY SEASONS. The seasons on now come from the Listing
 *       Rules calendar by date — every season running or starting soon (its lead days before its date, up to the date; the day after it is
 *       over); several at once; never a sale day. For every listing (home products) and every season on now: is the season word in Item
 *       Highlights? In the hidden search words? Missing in either = a problem for that season. The fix adds the word only where it is
 *       missing, in natural words ("Christmas table decor"), within the limits (125 / 249); no room → the expired season words come out
 *       of those two places first (never a word that describes the product); still no room → "Fix by hand" with the reason. THE TITLE IS
 *       NEVER TOUCHED. Sending goes through the existing path (POST lfix=patch: Amazon checks the change first, then sends, and logs it),
 *       one listing at a time with a progress bar; what was sent is recorded with the OLD values in listingrules/seasonlog.
 * Screens, three levels: the page (spRender: "Now: … · Next: …", chips All · <season> missing · Ready, one card per parent with season
 *       badges), a parent's side panel (#spPanel: one row per season with Fix all, "N children ready for the season", then the children
 *       list) and a child's side panel (#spKid: Problem, Why it matters, What we'll do, Where each season is, What changes, Checks).
 * Main functions: spActive / spWindow / spExpired (which seasons), spPlan / spBuild / spPlanFor (one listing, all seasons or one),
 *                 spHlAdd / spKwAdd (the two places), spSeasonChecks, spSeasonRows (the counts every screen shares), spFixSeasons (THE
 *                 one fix path), spSendAll, spAfterRead (redraw when reads land).
 */
const SP_TITLE_MAX = 75;                 // Amazon asks for 75 or less (Item Highlights); the house rule too
const SP_AMZ_MAX = 200;                  // Amazon's hard limit
const SP_SOON_DAYS = 30;                 // a season starting within this many days is shown as "coming"
const SP_PAGE = 25;                      // parents shown at once
const SP_LOG_MAX = 1500;                 // change records kept in listingrules/seasonlog (one document; well under its size limit)
const SP_SKIP_DAYS = 120;                // "Not now" lasts this long in this browser
const SP_STORE_SKIP = 'selloraSeasonSkip';   // localStorage: "brand|sku|what" → when "Not now" was pressed
const SP_STORE_VIEW = 'selloraOptView';      // localStorage: 'one' | 'season' — the pill last chosen in the Listing Optimiser
const SP_STORE_HELP = 'selloraSeasonHelp';   // localStorage: '1' when the "How it works" strip is folded away
/* SPEED + NO JUMPING (12 Nov 2026): the parent list reads nothing — it shows what is held (the full refresh and the Workspace's live
 * reads kept 24 h in selloraWsLive). Opening a parent reads that parent only: titles and search words 20 a call (?lfix=content),
 * then Item Highlights one by one (?lfix=get) — the rows on screen first, 4 at a time (the Workspace queue). While reads land the
 * screens redraw at most every SP_DRAW_MS, never while scrolled (SP_SCROLL_MS after the last scroll), and keep the top row in place. */
const SP_DRAW_MS = 2000;
const SP_SCROLL_MS = 400;
/* THE FOUR PLAIN SEASONS (planner only). Listing Rules' calendar holds occasions (Christmas, Easter …) — a word like "Spring" in a
 * November title is also old, so the planner judges these four as REMOVE-only words (they are never added to a title). They are not
 * Listing Rules, so no rule, level or count on any other screen changes. Windows: Spring 1 Mar – 31 May, Summer 1 Jun – 31 Aug,
 * Fall 1 Sep – 30 Nov, Winter 1 Dec – 28 Feb. */
const SP_SEASONS = [
  { id: 'sp_spring', name: 'Spring', words: 'Spring', when: { type: 'fixed', m: 4, d: 15 }, lead: 45, lag: 46, removeOnly: true },
  { id: 'sp_summer', name: 'Summer', words: 'Summer', when: { type: 'fixed', m: 7, d: 16 }, lead: 45, lag: 46, removeOnly: true },
  { id: 'sp_fall', name: 'Fall', words: 'Fall, Autumn', when: { type: 'fixed', m: 10, d: 16 }, lead: 45, lag: 45, removeOnly: true },
  { id: 'sp_winter', name: 'Winter', words: 'Winter', when: { type: 'fixed', m: 1, d: 15 }, lead: 45, lag: 44, removeOnly: true },
];
const SP_BANNED = /[!$?_{}^¬¦]|\p{Extended_Pictographic}/u;   // the symbols Amazon does not allow in a title (and no emoji); "%" and "&" are fine
/* A SEASON WORD THAT DESCRIBES THE PRODUCT IS NEVER TOUCHED ("Summer Dress", "Christmas Tablecloth", "Spring floral", "Winter Coat").
 * Only a season word used as an OCCASION or a time of use is judged: "for Thanksgiving", "Christmas Gift", "Spring Decor", "Easter table",
 * or standing where the title templates put occasions (at the end, before " - Colour", next to another season word). When unsure the
 * word is left alone. SP_USE: the words after a season word that mean "used for / at". SP_BEFORE: the words before it that do. */
const SP_USE = new Set(['decor', 'decoration', 'decorations', 'gift', 'gifts', 'gifting', 'party', 'parties', 'table', 'tables', 'dinner', 'dinners', 'celebration', 'celebrations',
  'holiday', 'holidays', 'season', 'seasonal', 'occasion', 'occasions', 'present', 'presents', 'entertaining', 'hosting', 'feast', 'brunch', 'dining', 'gathering', 'gatherings', 'event', 'events']);
const SP_BEFORE = new Set(['for', 'this', 'gift', 'gifts', 'perfect']);
/* THE CALENDAR IS FOR HOME PRODUCTS: a listing is judged only when its sub-category or title names one of these (clothing is left out),
 * unless the calendar event itself names its products (`products: "Tablecloth, Napkin"` in Listing Rules). */
const SP_HOME = 'Tablecloth, Table Cloth, Table Cover, Napkin, Runner, Placemat, Place Mat, Cushion, Pillow, Bedding, Quilt, Duvet, Bedspread, Comforter, Sheet, Curtain, Throw, Blanket, Apron, Towel, Pot Holder, Oven Mitt, Coaster, Tea Cosy, Table Linen';
const SP_JOIN = ['for', 'and', 'with', 'the', 'of', 'a', 'an', 'to', 'in', 'on', '&', '-', '–', '|', ',', 'x'];   // joiners, never counted as facts
const SP_FILLER = new Set(['for', 'and', 'with', 'the', 'of', 'a', 'an', 'to', 'in', 'on', 'or', 'by', 'at', 'from', 'your', 'our', 'is', 'are', 'it', 'its', 'this', 'that']);   // small words wasted in the hidden search words
/* ITEM HIGHLIGHTS (12 Nov 2026): Amazon's 125-character field shown under the title, searchable — the attribute title_differentiation
 * (Amazon: "can only be used when item_name is 75 characters or fewer"). Its shape (one text, or several entries; the limits) is read
 * at run time from the product type's schema (?lfix=schema), its value from ?lfix=get, both through the Workspace's queue. A season
 * word goes to the title first, then Item Highlights (shoppers see it), then the hidden search words. Promotions are never written
 * there, nor words the title already says, nor banned symbols — only the season word and plain use words. */
const SP_HL_ATTR = 'title_differentiation';
const SP_HL_MAX = 125;                   // when the schema names no limit
const SP_PROMO = /\b(sale|sales|deals?|black friday|cyber monday|prime day|best|bestsellers?|best sellers?|discounts?|offers?|cheapest|free shipping|number one)\b|#\s*1\b|\bno\.?\s*1\b/i;
const SP_HL_TABLE = /table ?cloth|table cover|table linen|napkin|runner|placemat|place mat|coaster/i;   // what is used at a table: "… table decor"
/* WHERE THE SEASON WORD IS (12 Nov 2026): the title, Item Highlights and the hidden search words, each found / missing / not available /
 * checking. A season word is found as a whole word, any case, with its other spellings ("Xmas" for Christmas — the calendar's own
 * words), joined by a hyphen ("Christmas-themed") or with "time" / "tide" grown on ("Christmastime"); never inside another word. */
const SP_ALIAS = { christmas: ['X-mas'] };
function spFindSeason(text, ev) {
  const t = String(text || '');
  if (!t || !ev) return '';
  const words = lrWords(ev.words || ev.name).concat(SP_ALIAS[String(ev.id || '').toLowerCase()] || [], [ev.name]);
  for (const word of words) {
    const re = new RegExp('(^|[^a-z0-9])(' + String(word).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + "(?:'s|time|tide)?)(?=$|[^a-z0-9])", 'i');
    const m = t.match(re);
    if (m) return m[2];
  }
  return '';
}

let SP = {
  on: false,                 // the planner is the view showing on the Listing Optimiser
  loading: false,            // the snapshots are being read
  loadErr: '',               // why they could not be read
  log: null,                 // the change records (listingrules/seasonlog), once read: [{ brand, sku, kind, seasons, before, after, at, by }]
  logErr: '',                // why the records could not be read
  items: null,               // the last spCompute: every listing's plan
  itemsKey: '',              // what it was computed from
  brand: 'ALL',              // filters
  list: 'all',               // all | add | remove | restore | ok
  season: '',                // an event id, or ''
  q: '',
  shown: SP_PAGE,
  edits: new Map(),          // "brand|sku" → the title as typed in Edit (cleared on Approve / Not now)
  choice: new Map(),         // "brand|sku" → the season the person switched to ("Also possible: …")
  editing: new Set(),        // the cards whose Edit box is open
  skip: null,                // the "Not now" records, once read from localStorage
  reading: new Set(),        // "brand|sku" queued for a content read from Amazon ("brand|sku|get": for Item Highlights); cleared when that read is done
  prog: null,                // the open parent's reads: { key, items: Map("brand|sku" → Set(read tokens)) } — "Reading 40 of 469" in its header
  lastDraw: 0,               // when the planner last redrew for landed reads (at most every SP_DRAW_MS)
  scrollAt: 0,               // when the list or a panel was last scrolled (no redraw for SP_SCROLL_MS after)
  check: null,               // "Check all parents": { total, done (parents), left: Map(parent → listings still out), at } — spCheckAll
  checkStarted: false,       // it starts once by itself when the planner opens
  bgKeys: new Set(),         // "brand|sku" waiting in a background batch (moved to the front when their parent opens)
  hlTried: new Set(),        // "brand|sku" whose Item Highlights were asked for (?lfix=get) — an error after that is said, not waited on
  tipAdd: new Set(),         // "brand|sku" where "Add to Item Highlights" (the optional tip) was pressed
  redrawT: 0,                // the debounced redraw for landed reads
  sending: null,             // { done, total, results } while titles are sent
  panel: null,               // the parent side panel: { key: "brand|parent", filter: '' | 'look' | 'fix', ws }
  kid: null,                 // the child side panel: { key: "brand|sku" }
  kidOrder: [],              // the rows' order in the parent last drawn (↑ / ↓ in a child)
  showDone: false,           // the up-to-date parents are showing
  result: null,              // the last send's result, shown until the next action
};

/* ----- small helpers ----- */
const spNf = n => Number(n || 0).toLocaleString('en-US');
const spKey = (brand, sku) => brand + '|' + sku;
const spToday = () => SP.today || new Date();   // SP.today: a fixed day for the tests
const spCfg = () => LR || LR_DEFAULT;
const spIsTest = () => typeof window !== 'undefined' && !!window.__TEST_ERP;
// "12 Nov" — short, for the timeline; "12 Nov 2026" with the year for the records.
const spDate = (date, year) => (date ? date.toLocaleDateString('en-GB', Object.assign({ day: 'numeric', month: 'short', timeZone: 'UTC' }, year ? { year: 'numeric' } : {})) : '—');
const spDays = (from, to) => Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()) - from.getTime()) / LR_DAY);
const spPlural = (n, word) => `${spNf(n)} ${word}${n === 1 ? '' : 's'}`;
// Every calendar occasion, then the four plain seasons; each with where today stands against it.
function spEvents(cfg, today) {
  return (cfg.events || []).concat(SP_SEASONS).map(ev => ({ ev, s: lrSeason(ev, today, cfg.events) }));
}
// The words of a title as people count them: letters and digits only, lower case.
const spWords = text => String(text || '').toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
// Tidy a title after words were taken out or put in: one space between words, no joiner left hanging before a dash or the end.
function spTidy(text) {
  return String(text || '').replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',').replace(/,\s*,/g, ',').replace(/,\s*(-|$)/g, ' $1')
    .replace(/\b(for|and|with|or|&)\s+(?=-|$)/gi, '').replace(/\b(for|and|with|or)\s+(for|and|with|or)\b/gi, '$1')
    .replace(/\s+-\s+-\s+/g, ' - ').replace(/\s*-\s*$/, '').replace(/^\s*-\s*/, '').replace(/\s+/g, ' ').trim();
}
// Take one occasion's words out of a title (whole words, however written), with the "for" / "&" that only joined them and a use word
// that only belonged to them ("Spring Decor", "Christmas Gift", "Easter Celebration" go whole; "Thanksgiving Dinner Napkins" keeps Dinner).
const SP_STRIP_WITH = 'decor|decorations?|gifts?|gifting|celebrations?|party|parties|holidays?|season|seasonal|occasions?|presents?';
function spStrip(title, words) {
  let out = String(title || '');
  lrWords(words).forEach(word => {
    const re = new RegExp('(?:\\b(?:for|and|&)\\s+)?(^|[^a-z0-9])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + "(?:'s)?(?:\\s+(?:" + SP_STRIP_WITH + ")(?![a-z]))?(?=$|[^a-z0-9])", 'gi');
    out = out.replace(re, '$1');
  });
  return spTidy(out);
}
// Put the occasion names into a title where the templates put {occasions}: before " - Colour" when the title ends that way, else at the end.
function spInsert(title, names) {
  const text = names.join(' ');
  if (!text) return spTidy(title);
  const dash = title.lastIndexOf(' - ');
  if (dash >= 0 && title.length - dash <= 32) return spTidy(title.slice(0, dash) + ' ' + text + title.slice(dash));
  return spTidy(title + ' ' + text);
}
// "Not now" records: "brand|sku|what" → when. Read once; old ones dropped.
function spSkips() {
  if (SP.skip) return SP.skip;
  SP.skip = {};
  try {
    const data = JSON.parse(localStorage.getItem(SP_STORE_SKIP) || '{}');
    const cut = Date.now() - SP_SKIP_DAYS * LR_DAY;
    Object.keys(data).forEach(key => { if (data[key] > cut) SP.skip[key] = data[key]; });
  } catch (e) { /* no storage: nothing is hidden */ }
  return SP.skip;
}
function spSkipSave() {
  try { localStorage.setItem(SP_STORE_SKIP, JSON.stringify(SP.skip || {})); } catch (e) { /* no storage */ }
}

/* ----- the change records: what this planner sent, with the OLD title (listingrules/seasonlog) ----- */
async function spLogLoad() {
  if (SP.log) return SP.log;
  try {
    const snap = await getDoc(doc(db, 'listingrules', 'seasonlog'));
    SP.log = snap.exists() ? (snap.data().rows || []) : [];
    SP.logErr = '';
  } catch (e) {
    SP.log = [];
    SP.logErr = String((e && e.message) || e);
  }
  SP.itemsKey = '';
  return SP.log;
}
async function spLogAdd(rows) {
  if (!SP.log) await spLogLoad();
  SP.log = rows.concat(SP.log).slice(0, SP_LOG_MAX);
  SP.itemsKey = '';
  try {
    await setDoc(doc(db, 'listingrules', 'seasonlog'), { rows: SP.log, at: serverTimestamp() });
    return '';
  } catch (e) {
    return String((e && e.message) || e);
  }
}

/* ----- THE SEASON RULES (13 Nov 2026, MD — they replace the old title changes) -----
 * 1 ONLY SEASONS: the planner shows the season words and nothing else (specs, pictures, title length stay in Listing Health).
 * 2 WHICH SEASONS: from the Listing Rules calendar, automatically by date — every season RUNNING NOW or STARTING SOON: from its lead
 *   days before its date up to the date itself; the day after, it is over (spWindow). Several can be on at once. Sale days (Black
 *   Friday, Cyber Monday, Prime Day, deals, sales) are never added.
 * 3 THE TITLE IS NEVER TOUCHED. Two places only: Item Highlights (Amazon's limit, 125) and the hidden search words (249 bytes of words).
 *   A child has a problem for a season when the season word is missing from either. The fix adds it only where it is missing, in
 *   natural words ("Christmas table decor"), within the limit. No room → the EXPIRED season words (seasons not on now) come out of
 *   those two places first — never a word that describes the product; still no room → "Fix by hand" with the reason. A title over 75
 *   still gets Item Highlights, with a note that Amazon shows them only when the title is 75 letters or less. */
const SP_HL75_NOTE = `Amazon shows Item Highlights only when the title is ${SP_TITLE_MAX} letters or less.`;
// Where today stands against one calendar season — THE one season-date rule of Listing Rules (lrSeasonState), so the planner and
// every other screen agree: { active (time to add: lead days before → the day), keep (just past), expired (after its "days after"),
// date, from, to (the day) }.
function spWindow(ev, today, events) {
  const st = lrSeasonState(ev, today, events);
  return Object.assign({}, st, { to: st.date });
}
// The seasons on now (running or starting soon), nearest day first: [{ ev, w, s }] (`s` in the old shape for the shared helpers).
function spActive(cfg, today) {
  return (cfg.events || []).filter(ev => !spIsSale(ev)).map(ev => ({ ev, w: spWindow(ev, today, cfg.events) })).filter(e => e.w.active)
    .sort((a, b) => a.w.date - b.w.date).map(e => Object.assign(e, { s: { inSeason: true, next: e.w.date, from: e.w.from, to: e.w.to } }));
}
// The next season to come on (never a sale day), or null.
function spNext(cfg, today) {
  return (cfg.events || []).filter(ev => !spIsSale(ev)).map(ev => ({ ev, w: spWindow(ev, today, cfg.events) })).filter(e => e.w.expired && e.w.from)
    .sort((a, b) => a.w.from - b.w.from)[0] || null;
}
// The EXPIRED seasons (lrSeasonState: after the calendar's "days after") — every calendar season, sale days included, and the four plain
// seasons out of their months: their words may be taken out of Item Highlights and the hidden search words to make room. A season just
// past (its "days after") is neither added nor taken out.
function spExpired(cfg, today) {
  return (cfg.events || []).concat(SP_SEASONS).filter(ev => lrSeasonState(ev, today, cfg.events).expired).map(ev => ({ ev }));
}
// "Thanksgiving", "Thanksgiving and Christmas", "A, B and C".
const spNames = names => (names.length < 2 ? names[0] || '' : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);
// A season is the product here (the calendar's "Skip if product is" in the sub-category or colour, or the title uses the word to describe
// the product — "Spring Floral Tablecloth"): its word is never taken out.
function spIsProduct(item, ev) {
  const cat = lrCatOf(item.row) || {};
  const protect = String(cat.subcat || '') + ' ' + String(cat.color || '');
  return lrWords(ev.except).some(word => lrHas(protect, word)) || spSeasonUse(item.title, ev) === 'product';
}
// Take the expired season words out of a text (Item Highlights: only where the word is used as an occasion). { text, removed: [names] }.
function spStripExpired(item, text, expired, hl) {
  let out = String(text || '');
  const removed = [];
  expired.forEach(e => {
    if (!lrWords(e.ev.words).some(word => lrHas(out, word)) || spIsProduct(item, e.ev)) return;
    if (hl && spSeasonUse(out, e.ev) !== 'use') return;
    const next = spStrip(out, e.ev.words);
    if (next !== out) { out = next; removed.push(e.ev.name); }
  });
  return { text: out, removed };
}

/* ----- one listing's plan ----- */
/**
 * { key, brand, sku, asin, row, name, title, kw, kwMax, pt, live, liveFresh, readErr, hl, hlInfo, active: [e], miss: { id: { hl, kw } },
 *   add: [e] (the seasons missing somewhere), seasons: [ids], kind, status, after (= the title, never changed), hlAfter, kwAfter, hlAdd,
 *   kwAdd, removed: { hl, kw }, checks, why, hint, note }.
 * miss[id].hl / .kw: found | missing | na (Item Highlights not used by this product type) | unknown (not read yet) | err (could not be read).
 * kind: none (no season on now applies to it) | ok (every season found) | add (missing somewhere) | check (not read yet / not readable).
 * status: ready | fix | reading | ok — only `ready` is sent.
 */
function spPlan(row, ctx, today) {
  const cfg = ctx.cfg;
  const brand = row.brand;
  const key = spKey(brand, row.sku);
  const fresh = lrFresh(row, ctx);
  const live = lrLiveOf(row, ctx);
  const title = hTitleText(fresh) || '';
  const liveFresh = !!(live && live.cAt && Date.now() - live.cAt < LR_DAY);
  const kw = live && live.cAt && fresh.kw != null ? String(fresh.kw) : null;   // the hidden search words are only ever known from the live read — never "0 of 249" for one not read
  const kwMax = (() => { const rule = (cfg.issues || []).find(issue => issue.detector === 'keyword_bytes' && issue.on !== false); return rule ? (+(rule.params || {}).max || 249) : 249; })();
  const cat = lrCatOf(row);
  const hlInfo = spHlInfo(brand, live && live.pt ? live.pt : '', live, key);
  const hl = hlInfo.state === 'ok' ? hlInfo.entries.slice() : null;
  const readErr = live && (live.cErr || live.err) ? String(live.cErr || live.err) : '';
  const active = spActive(cfg, today).filter(e => spApplies(e.ev, cat, title));   // home products only (or what the season itself names)
  const item = { key, brand, sku: row.sku, asin: row.asin || '', row, name: title || row.title || '', title, kw, kwMax, pt: live && live.pt ? live.pt : '', live, liveFresh, readErr,
    hl, hlInfo, active, miss: {}, add: [], remove: [], seasons: [], kind: 'none', status: 'ok', after: title, hlAfter: hl ? hl.slice() : null, kwAfter: kw, hlAdd: '', kwAdd: [],
    removed: { hl: [], kw: [] }, checks: [], why: '', hint: '', note: '', titleOver: title.length > SP_TITLE_MAX, pick: active[0] || null };
  if (!active.length) return item;
  const hlText = hl ? hl.join(' · ') : '';
  active.forEach(e => {
    item.miss[e.ev.id] = {
      hl: hlInfo.state === 'none' ? 'na' : hl ? (spFindSeason(hlText, e.ev) ? 'found' : 'missing') : hlInfo.state === 'err' ? 'err' : 'unknown',
      kw: kw != null ? (spFindSeason(kw, e.ev) ? 'found' : 'missing') : readErr ? 'err' : 'unknown',
    };
  });
  item.add = active.filter(e => spMissing(item, e.ev.id));
  item.seasons = item.add.map(e => e.ev.id);
  item.pick = item.add[0] || active[0];
  const open = active.some(e => ['unknown', 'err'].includes(item.miss[e.ev.id].hl) || ['unknown', 'err'].includes(item.miss[e.ev.id].kw));
  item.kind = item.add.length ? 'add' : open ? 'check' : 'ok';
  return Object.assign(item, spBuild(item, item.add, today));
}
// Missing from at least one of the two places (as far as is known).
const spMissing = (item, id) => !!item.miss[id] && (item.miss[id].hl === 'missing' || item.miss[id].kw === 'missing');
// The plan for ONE season only (a parent's season row: "Fix all" for Christmas adds Christmas, nothing else).
function spPlanFor(item, id) {
  return Object.assign({}, item, spBuild(item, item.add.filter(e => e.ev.id === id), spToday()), { only: id });
}
// What the fix sends for these seasons: Item Highlights and the hidden search words — the season word only where it is missing, within
// the limits, expired words out first when there is no room; then the checks. { hlAfter, kwAfter, hlAdd, kwAdd, removed, checks, status,
// why, hint, note }.
function spBuild(item, adds, today) {
  const out = { hlAfter: item.hl ? item.hl.slice() : null, kwAfter: item.kw, hlAdd: '', kwAdd: [], removed: { hl: [], kw: [] }, checks: [], status: 'ok', why: '', hint: '', note: '' };
  const fix = (why, hint) => Object.assign(out, { status: 'fix', why, hint: hint || '' });
  if (item.kind === 'none' || item.kind === 'ok') return out;
  const places = item.active.map(e => item.miss[e.ev.id]);
  if (!adds.length) {
    if (places.some(m => m.hl === 'unknown' || m.kw === 'unknown') && !item.readErr) return Object.assign(out, { status: 'reading', why: 'reading this listing from Amazon first' });
    const err = (item.hlInfo.state === 'err' && item.hlInfo.err) || item.readErr;
    return fix(`Amazon could not be read for this listing${err ? ` (${err})` : ''}`, 'Read it again from Amazon, or check it in Listing Errors.');
  }
  // a season missing in one place and not read yet in the other: read first, then fix both at once
  if (adds.some(e => item.miss[e.ev.id].hl === 'unknown' || item.miss[e.ev.id].kw === 'unknown')) return Object.assign(out, { status: 'reading', why: 'reading this listing from Amazon first' });
  const hlNeed = adds.filter(e => item.miss[e.ev.id].hl === 'missing');
  const kwNeed = adds.filter(e => item.miss[e.ev.id].kw === 'missing');
  const expired = spExpired(spCfg(), today);
  if (hlNeed.length) {
    const r = spHlAdd(item, hlNeed, expired);
    if (!r.ok) return fix(r.why, `Make room in Item Highlights, then add “${spNames(hlNeed.map(e => e.ev.name))}”.`);
    Object.assign(out, { hlAfter: r.after, hlAdd: r.said });
    out.removed.hl = r.removed;
  }
  if (kwNeed.length) {
    const r = spKwAdd(item, kwNeed, expired);
    if (!r.ok) return fix(r.why, `Shorten the hidden search words, then add “${r.words.join(' ')}”.`);
    Object.assign(out, { kwAfter: r.after, kwAdd: r.words });
    out.removed.kw = r.removed;
  }
  if (hlNeed.length && item.titleOver) out.note = SP_HL75_NOTE;
  out.checks = spSeasonChecks(item, out, today);
  const bad = out.checks.find(check => check.ok === false);
  if (bad) return fix(bad.why || bad.t, `Change it by hand: ${bad.why || bad.t}.`);
  if (!item.pt) {
    if (item.live && item.live.cAt) return fix('Amazon did not say what kind of product this is, so the change cannot be sent from here', 'Send the change from Listing Errors.');
    return Object.assign(out, { status: 'reading', why: 'reading this listing from Amazon first (the product kind is needed to send)' });
  }
  out.status = 'ready';
  return out;
}
/* ----- Item Highlights ----- */
// What the schema allows for this product type and what the listing holds: { state: ok | none | unknown | err, entries, max, items,
// need: '' | 'schema' | 'get', err }. Read lazily: the planner queues what is missing (spEnsureReads).
function spHlInfo(brand, pt, live, key) {
  if (typeof LI_WS === 'undefined') return { state: 'unknown', need: '' };
  if (!pt) return live && (live.cErr || live.err) ? { state: 'err', err: String(live.cErr || live.err) } : { state: 'unknown', need: '' };   // a failed read is said, never waited on
  const sch = LI_WS.schema[brand] && LI_WS.schema[brand][pt];
  if (!sch) return { state: 'unknown', need: 'schema' };
  if (sch.pending) return { state: 'unknown', need: '' };
  if (sch.err) return { state: 'err', err: String(sch.err) };
  if (!sch.hl) return { state: 'unknown', need: 'schema' };          // a schema answer from before Item Highlights was asked
  if (sch.hl.none) return { state: 'none' };
  if (!live || !live.hlAt) {
    if (live && live.err && SP.hlTried.has(key)) return { state: 'err', err: String(live.err) };
    return { state: 'unknown', need: 'get' };
  }
  // read within 24 h: kept (the Workspace's cache); older: used as it is and read again
  return { state: 'ok', entries: (live.hl || []).map(String), max: +sch.hl.max || SP_HL_MAX, items: +sch.hl.items || 1, need: Date.now() - live.hlAt > LR_DAY ? 'get' : '' };
}
const spHlChanged = item => item.hl != null && item.hlAfter != null && item.hlAfter.join('\u0001') !== item.hl.join('\u0001');
// The season's natural phrase: "Christmas table decor" (what is used at a table), "Christmas decor", or the name alone — "decor" left out
// when the title or the highlights already say it. `word`: one name, or "Thanksgiving and Christmas".
function spHlPhrase(item, word, have) {
  const cat = lrCatOf(item.row) || {};
  const table = SP_HL_TABLE.test(String(cat.subcat || '') + ' ' + item.title);
  const decor = !lrHas(item.title, 'decor') && !lrHas((have || []).join(' '), 'decor');
  return [word, table && decor ? 'table' : '', decor ? 'decor' : ''].filter(Boolean).join(' ');
}
// Item Highlights as a person writes them: a capital first letter, commas between ideas, no dangling joining word or comma.
function spHlTidy(text) {
  const t = String(text || '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').replace(/,(\s*,)+/g, ',').replace(/,(?=[A-Za-z])/g, ', ')
    .replace(/^[\s,;·–-]+|[\s,;·–-]+$/g, '').replace(/^(for|and|with|or|&)\s+/i, '').replace(/\s+(for|and|with|or|&)$/i, '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
// The first word of what was the start, in lower case once the season phrase goes in front — unless it is a name (a brand word).
function spHlAfterStart(text, item) {
  const m = String(text).match(/^([A-Z][a-z]+)\b/);
  if (!m) return String(text);
  const names = lrBrandWords(item.row, spCfg()).flatMap(phrase => phrase.split(' '))
    .concat(spEvents(spCfg(), spToday()).flatMap(e => lrWords(e.ev.words).concat([e.ev.name]).map(w => w.split(' ')[0])))   // a season's name keeps its capital
    .map(w => lrNorm(w));
  return names.includes(lrNorm(m[1])) ? String(text) : m[1].toLowerCase() + String(text).slice(m[1].length);
}
// Put the missing seasons into Item Highlights, at the START, as a person would write it; within the schema's limit (125 letters an
// entry, so many entries). No room: the expired season words come out first, then it is tried again. { ok, after, said, removed, why }.
function spHlAdd(item, adds, expired) {
  const info = item.hlInfo;
  const word = spNames(adds.map(e => e.ev.name));
  const fits = (list, added) => list.length <= info.items && list.every(entry => entry.length <= info.max) && !SP_PROMO.test(added) && !SP_BANNED.test(added);
  // highlights that already start with the use ("Table decor, …"): the season word joins it ("Christmas table decor, …")
  const front = (add, rest) => {
    if (!rest) return spHlTidy(add);
    if (/^(table decor|holiday decor|decor|table)\b/i.test(rest)) return spHlTidy(`${word} ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`);
    // …or with other seasons' names before that use ("Thanksgiving table decor, …"): one phrase — "Thanksgiving and Christmas table decor, …"
    const lead = rest.match(/^(.+?)\s+(?=(?:table decor|holiday decor|decor)\b)/i);
    const isName = part => spEvents(spCfg(), spToday()).some(e => lrWords(e.ev.words).concat([e.ev.name]).some(w => lrNorm(w) === lrNorm(part)));
    if (lead && lead[1].split(/\s*(?:,|\band\b)\s*/i).filter(Boolean).every(isName)) {
      const names = lead[1].split(/\s*(?:,|\band\b)\s*/i).filter(Boolean).concat(adds.map(e => e.ev.name));
      return spHlTidy(`${spNames(names)} ${rest.slice(lead[0].length)}`);
    }
    return spHlTidy(`${add}, ${spHlAfterStart(rest, item)}`);
  };
  const tryIn = now => {
    const phrase = spHlPhrase(item, word, now);
    const adds2 = [phrase, `${word} decor`, word].filter((v, i, a) => a.indexOf(v) === i);
    if (info.items > 1 && now.length < info.items) {
      for (const add of adds2) { const entry = spHlTidy(add); if (fits([entry].concat(now), add)) return { after: [entry].concat(now), said: entry }; }
    }
    for (const add of adds2) {
      const cand = front(add, now[0] || '');
      const list = [cand].concat(now.slice(1));
      if (fits(list, add)) return { after: list, said: add };
    }
    return null;
  };
  const now = item.hl.slice();
  let r = tryIn(now);
  if (r) return Object.assign({ ok: true, removed: [] }, r);
  const removed = [];
  const less = now.map(entry => { const s = spStripExpired(item, entry, expired, true); s.removed.forEach(n => { if (!removed.includes(n)) removed.push(n); }); return spHlTidy(s.text); }).filter(Boolean);
  if (removed.length) {
    r = tryIn(less);
    if (r) return Object.assign({ ok: true, removed }, r);
  }
  const size = info.items > 1 ? `${now.length} of ${info.items} entries` : `${(now[0] || '').length} of ${info.max} letters`;
  return { ok: false, why: `no room in Item Highlights for “${word}” (${size})${removed.length ? ` — even without ${spNames(removed.map(n => '“' + n + '”'))}` : ''}` };
}
/* ----- the hidden search words ----- */
// Add the missing season names at the end (lower case, words only), within the byte limit; no room: the expired season words come out
// first. { ok, after, words, removed, why }.
function spKwAdd(item, adds, expired) {
  const words = adds.map(e => e.ev.name.toLowerCase());
  const join = base => [String(base || '').trim()].concat(words).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  let after = join(item.kw);
  if (lrKwBytes(after) <= item.kwMax) return { ok: true, after, words, removed: [] };
  const s = spStripExpired(item, item.kw, expired, false);
  after = join(s.text);
  if (s.removed.length && lrKwBytes(after) <= item.kwMax) return { ok: true, after, words, removed: s.removed };
  return { ok: false, words, why: `the hidden search words are full (${spNf(lrKwBytes(item.kw))} of ${spNf(item.kwMax)}; “${words.join(' ')}” needs ${spNf(lrKwBytes(words.join('')))} more)${s.removed.length ? ` — even without ${spNames(s.removed.map(n => '“' + n + '”'))}` : ''}` };
}
/* ----- the checks: the same list for every season fix ----- */
// [{ k, t, ok: true | false | 'warn', why, pre }] — `ok: false` stops the fix ("Fix by hand"); `pre` = already so before the change
// (never stops it). The title is never changed; Item Highlights and the search words stay within their limits; only the seasons on now
// are added, never a sale day, a promotion word or a banned symbol; nothing else is made up.
function spSeasonChecks(item, out, today) {
  const checks = [];
  const push = (k, t, ok, why, pre) => checks.push({ k, t, ok, why: why || '', pre: !!pre });
  push('title', 'The title stays the same', true);
  const on = spActive(spCfg(), today);
  const okWords = new Set(on.flatMap(e => spWords(e.ev.name + ' ' + e.ev.words)).concat(['table', 'decor', 'and']));
  const sale = /\b(black friday|cyber monday|prime day|sales?|deals?)\b/i;
  const hlChanged = item.hl != null && out.hlAfter != null && out.hlAfter.join('\u0001') !== item.hl.join('\u0001');
  if (hlChanged) {
    const info = item.hlInfo;
    const longest = out.hlAfter.reduce((m, e) => Math.max(m, e.length), 0);
    const size = info.items > 1 ? `${out.hlAfter.length} of ${info.items} entries, each up to ${info.max}` : `${longest} of ${info.max}`;
    push('hl', `Item Highlights within their limit (${size})`, out.hlAfter.length <= info.items && longest <= info.max, 'Item Highlights would be over their limit');
    const added = spWordDiff(item.hl.join(' · '), out.hlAfter.join(' · ')).added.map(x => x.k);
    const text = added.join(' ');
    push('hlpromo', 'No promotion or sale words added', !SP_PROMO.test(text) && !sale.test(text), 'no promotion or sale words in Item Highlights');
    push('hlsym', 'No banned symbols added', !SP_BANNED.test(text), 'a banned symbol');
    const madeUp = added.filter(w => !okWords.has(w) && !/^\d/.test(w));
    push('hlfact', madeUp.length ? `New words in Item Highlights “${madeUp.slice(0, 4).join('”, “')}”` : 'Only the season words added to Item Highlights', !madeUp.length, 'only the season words may be added');
    if (item.titleOver) push('hl75', `${SP_HL75_NOTE} (now ${item.title.length})`, 'warn', '', true);
  }
  if (out.kwAfter != null && out.kwAfter !== item.kw) {
    const bytes = lrKwBytes(out.kwAfter);
    push('kw', `Hidden search words within their limit (${spNf(bytes)} of ${spNf(item.kwMax)})`, bytes <= item.kwMax, 'the hidden search words would be over their limit');
    const added = spWordDiff(item.kw, out.kwAfter).added.map(x => x.k);
    const madeUp = added.filter(w => !okWords.has(w) && !/^\d/.test(w));
    push('kwfact', madeUp.length ? `New words in the hidden search words “${madeUp.slice(0, 4).join('”, “')}”` : 'Only the season words added to the hidden search words', !madeUp.length, 'only the season words may be added');
    push('kwsale', 'No sale words added', !sale.test(added.join(' ')), 'no sale words');
  }
  return checks;
}
// Item Highlights per brand, from what this page holds — run spHighlightsCount() in the console on live Sellora: listings whose title
// is 75 letters or less, over 75, and how many of the ones read from Amazon already have Item Highlights.
function spHighlightsCount() {
  const ctx = hCtx();
  const out = {};
  ['SP', 'CPC'].forEach(brand => {
    const rows = (HEALTH[brand] && HEALTH[brand].rows) || [];
    const c = { listings: rows.length, titleUpTo75: 0, titleOver75: 0, titleUnknown: 0, highlightsRead: 0, haveHighlights: 0 };
    rows.forEach(row => {
      const r = row.brand ? row : Object.assign({ brand }, row);
      const t = hTitleText(lrFresh(r, ctx));
      if (!t) c.titleUnknown++;
      else if (t.length <= SP_TITLE_MAX) c.titleUpTo75++;
      else c.titleOver75++;
      const live = LI_WS.live[brand] && LI_WS.live[brand][row.sku];
      if (live && live.hlAt) {
        c.highlightsRead++;
        if ((live.hl || []).length) c.haveHighlights++;
      }
    });
    out[BRAND_NAME[brand] || brand] = c;
  });
  if (typeof console !== 'undefined' && console.table) console.table(out);
  return out;
}
// Sale days are promotions, not product words.
const spIsSale = ev => /black friday|cyber monday|prime day|\bsale\b|\bdeal/i.test(String(ev.name || '') + ' ' + String(ev.id || ''));
// Does this calendar event apply to the listing? Its own `products`, else the home products — found in the sub-category or the title.
function spApplies(ev, cat, title) {
  const text = String((cat && cat.subcat) || '') + ' ' + String(title || '');
  return lrWords(ev.products || SP_HOME).some(word => lrHas(text, word));
}
/** How an event's word is used in a text: 'use' (an occasion or time of use — may be taken out), 'product' (describes the product — never
 *  touched), or null when the word is not there. Reads the word before and after each occurrence; one 'use' is enough. */
function spSeasonUse(title, ev) {
  const text = String(title || '');
  let found = null;
  for (const word of lrWords(ev.words)) {
    const re = new RegExp('(^|[^a-z0-9])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + "(?:'s)?(?=$|[^a-z0-9])", 'gi');
    let m;
    while ((m = re.exec(text))) {
      const before = (text.slice(0, m.index + m[1].length).trim().split(/\s+/).pop() || '').toLowerCase().replace(/[^a-z']/g, '');
      const rest = text.slice(m.index + m[0].length).trim();
      const after = (rest.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z']/g, '');
      const nextIsSeason = !!after && spEvents(spCfg(), spToday()).some(e => lrWords(e.ev.words).some(w => lrNorm(w).split(' ')[0] === lrNorm(after)));
      const use = SP_BEFORE.has(before) || SP_USE.has(after) || !rest || rest.startsWith('-') || rest.startsWith('–') || rest.startsWith(',') || nextIsSeason || (after === 'and' || after === '&');
      if (use) return 'use';
      found = 'product';
    }
  }
  return found;
}
/** The same ✓ list for every suggested title (and for a title typed in Edit): [{ k, t, ok: true | false | 'warn', why, pre }].
 *  `ok: false` blocks sending; 'warn' makes it "⚠ Needs your OK" — unless `pre`: a problem that was ALREADY THERE BEFORE the
 *  change (a title already over 75, a size already written another way…). Those never block it and never make it Needs your OK:
 *  a change is Ready when it makes nothing worse. They show in their own card, "Already there before — not caused by this change". */
function spChecks(before, after, row, ctx, today, opts) {
  opts = opts || {};
  const cfg = ctx.cfg;
  const out = [];
  const push = (k, t, ok, why, pre) => out.push({ k, t, ok, why: why || '', pre: !!pre });
  const was = String(before || '');
  const now = String(after || '').trim();
  // 1 Within 75 letters (never made longer than it already was)
  if (now.length <= SP_TITLE_MAX) push('len', `Within ${SP_TITLE_MAX} letters (${now.length} of ${SP_TITLE_MAX})`, true);
  else if (was.length > SP_TITLE_MAX && now.length <= was.length) push('len', `Longer than ${SP_TITLE_MAX} letters (${now.length}) — it already was; this change does not make it longer`, 'warn', '', true);
  else push('len', `Too long by ${spNf(now.length - SP_TITLE_MAX)} letter${now.length - SP_TITLE_MAX === 1 ? '' : 's'} (${now.length} of ${SP_TITLE_MAX})`, false, `the title is too long by ${now.length - SP_TITLE_MAX} letter${now.length - SP_TITLE_MAX === 1 ? '' : 's'}`);
  // 2 Under Amazon's 200 limit
  push('amz', `Under Amazon's ${SP_AMZ_MAX} limit`, now.length <= SP_AMZ_MAX, `over Amazon's ${SP_AMZ_MAX}-letter limit`);
  // 3 Size kept, written the house way
  const example = (((cfg.issues || []).find(issue => issue.detector === 'size_format') || {}).params || {}).example || '14 x 36 Inch';
  const sizesWas = hTitleSizes(was).map(size => lrSizeShape(size.text) + '|' + [size.a, size.b, size.c].filter(n => n != null).join('x'));
  const sizesNow = hTitleSizes(now).map(size => lrSizeShape(size.text) + '|' + [size.a, size.b, size.c].filter(n => n != null).join('x'));
  const sizeNums = list => list.map(s => s.split('|')[1]).sort().join(',');
  if (sizesWas.length && sizeNums(sizesWas) !== sizeNums(sizesNow)) push('size', 'The size was lost or changed', false, 'the size was lost');
  else {
    const near = lrNear(now, cfg);
    const badNow = hTitleSizes(now).find(size => !lrSizeOk(size.text, example) && !(near && lrSizeLoose(size.text)));
    const badWas = hTitleSizes(was).find(size => !lrSizeOk(size.text, example) && !(lrNear(was, cfg) && lrSizeLoose(size.text)));
    if (!sizesNow.length) push('size', 'Size kept as it was (none in the title)', true);
    else if (!badNow) push('size', 'Size written the house way', true);
    else if (badWas) push('size', `Size written another way (“${badNow.text}”)`, 'warn', '', true);
    else push('size', `Size not written the house way (“${badNow.text}”)`, false, `the size should read like “${example}”`);
  }
  // 4 Brand at the start
  const brandWords = lrBrandWords(row, cfg);
  if (!brandWords.length) push('brand', 'Brand not checked (no brand words known)', true);
  else {
    const atNow = brandWords.map(word => lrFind(now, word)).filter(i => i >= 0);
    const atWas = brandWords.map(word => lrFind(was, word)).filter(i => i >= 0);
    if (atNow.length && Math.min(...atNow) === 0) push('brand', 'Brand at the start', true);
    else if (!atNow.length && atWas.length) push('brand', 'The brand was lost', false, 'the brand was lost');
    else if (atNow.length) push('brand', 'Brand in the title, not at the start', 'warn', '', atWas.length > 0 && Math.min(...atWas) > 0);
    else push('brand', 'No brand in the title', 'warn', '', true);
  }
  // 5 Colour kept
  const color = lrColorOf(row);
  const colorWords = lrNorm(color).split(/[^a-z]+/).filter(word => word.length > 2);
  if (colorWords.length && colorWords.some(word => lrHas(was, word)) && !colorWords.some(word => lrHas(now, word))) push('color', 'The colour was lost', false, 'the colour was lost');
  else push('color', colorWords.length ? 'Colour kept' : 'Colour not checked (none known)', true);
  // 6 No banned symbols
  const symNow = now.match(SP_BANNED);
  const symWas = was.match(SP_BANNED);
  if (!symNow) push('sym', 'No banned symbols', true);
  else if (symWas && symWas[0] === symNow[0]) push('sym', `Has “${symNow[0]}”, which Amazon does not allow`, 'warn', '', true);
  else push('sym', `Has “${symNow[0]}”, which Amazon does not allow`, false, `“${symNow[0]}” is not allowed in a title`);
  // 7 No word used 3 times
  const thrice = text => { const n = {}; spWords(text).filter(word => word.length >= 3).forEach(word => { n[word] = (n[word] || 0) + 1; }); return Object.keys(n).find(word => n[word] >= 3) || ''; };
  const threeNow = thrice(now);
  if (!threeNow) push('rep', 'No word used 3 times', true);
  else if (thrice(was) === threeNow) push('rep', `“${threeNow}” is used 3 times`, 'warn', '', true);
  else push('rep', `“${threeNow}” would be used 3 times`, false, `“${threeNow}” would be used 3 times`);
  // 8 Season words in season
  const cat = lrCatOf(row) || {};
  const protect = String(cat.subcat || '') + ' ' + String(cat.color || '');
  const stale = spEvents(cfg, today).find(e => !e.s.inSeason && lrWords(e.ev.words).some(word => lrHas(now, word)) && !lrWords(e.ev.except).some(word => lrHas(protect, word))
    && spApplies(e.ev, cat, now) && spSeasonUse(now, e.ev) === 'use');   // a season word that describes the product is never flagged
  if (!stale) push('season', 'Every season word is in season', true);
  else push('season', `Still says “${lrWords(stale.ev.words).find(word => lrHas(now, word))}” — ${stale.ev.name} is ${stale.s.next ? 'on ' + spDate(stale.s.next, true) : 'over'}`, false, `“${stale.ev.name}” is out of season`);
  // 9 Nothing made up: every word was in the title before, or is an occasion name
  const okWords = new Set(spWords(was).concat(spEvents(cfg, today).flatMap(e => spWords(e.ev.name + ' ' + e.ev.words)), SP_JOIN));
  const madeUp = spWords(now).filter(word => !okWords.has(word) && !/^\d/.test(word));
  if (!madeUp.length) push('fact', 'Nothing new made up — only season words moved', true);
  else push('fact', `New word${madeUp.length === 1 ? '' : 's'} “${[...new Set(madeUp)].slice(0, 4).join('”, “')}” — make sure ${madeUp.length === 1 ? 'it is' : 'they are'} true`, 'warn');
  // 10 Hidden search words within their limit
  if (opts.kwAfter != null) {
    const bytes = lrKwBytes(opts.kwAfter);
    if (bytes <= (opts.kwMax || 249)) push('kw', `Hidden search words within their limit (${spNf(bytes)} of ${spNf(opts.kwMax || 249)})`, true);
    else if (opts.kwBefore != null && opts.kwAfter === opts.kwBefore) push('kw', `Hidden search words over their limit (${spNf(bytes)} of ${spNf(opts.kwMax || 249)})`, 'warn', '', true);   // unchanged: already so
    else push('kw', `Hidden search words over their limit (${spNf(bytes)} of ${spNf(opts.kwMax || 249)})`, false, 'the hidden search words would be over their limit');
  }
  // 11 Item Highlights, when they change
  if (!now) push('empty', 'The title is empty', false, 'the title is empty');
  return out;
}

/* ----- every listing's plan, cached until something it reads changes ----- */
function spCompute(today) {
  today = today || spToday();
  const ctx = hCtx();
  const key = [ctx === SP.ctx ? 1 : 0, typeof LI_WS !== 'undefined' ? LI_WS.liveV : 0, today.toDateString(), SP.log ? SP.log.length : -1, [...SP.choice.entries()].join(';'),
    ['SP', 'CPC'].map(b => (HEALTH[b] && HEALTH[b].rows ? HEALTH[b].rows.length : 0)).join(',')].join('|');
  if (SP.items && SP.itemsKey === key && SP.ctx === ctx) return SP.items;
  SP.ctx = ctx;
  // Each listing's plan is kept until something it reads changes (its live read, its product type's schema, the rules, the day, the
  // change records): a read landing re-plans that one listing, not all of them.
  if (!SP.planKeep) SP.planKeep = new WeakMap();
  const hour = Math.floor(Date.now() / 3600000);
  SP.items = ['SP', 'CPC'].flatMap(b => ((HEALTH[b] && HEALTH[b].rows) || []).map(raw => {
    const row = raw.brand ? raw : Object.assign({ brand: b }, raw);
    const live = typeof LI_WS !== 'undefined' && LI_WS.live[b] ? LI_WS.live[b][raw.sku] || null : null;
    const sch = live && live.pt && LI_WS.schema[b] ? LI_WS.schema[b][live.pt] || null : null;
    const sig = [ctx, today.toDateString(), SP.log, SP.log ? SP.log.length : -1, SP.choice.get(spKey(b, raw.sku)) || '', hour, live, live ? live.at : 0, live ? live.cAt : 0,
      live ? live.gAt : 0, live ? live.hlAt : 0, live ? live.tAt : 0, live ? live.err : '', live ? live.cErr : '', sch, sch ? !!sch.pending : false, SP.hlTried.has(spKey(b, raw.sku)), SP.tipAdd.has(spKey(b, raw.sku)),
      raw.content, raw.checked, raw.title, raw.status, raw.qty];
    const kept = SP.planKeep.get(raw);
    if (kept && kept.sig.length === sig.length && kept.sig.every((part, i) => part === sig[i])) return kept.item;
    const item = spPlan(row, ctx, today, SP.log || []);
    SP.planKeep.set(raw, { sig, item });
    return item;
  }));
  SP.itemsKey = key;
  return SP.items;
}
// A listing to do: a season missing somewhere, or not read yet (the parent panel's children list; "Not now" left out).
const spToDo = item => item.kind === 'add' || item.kind === 'check';
const spSkipped = item => { const skips = spSkips(); return !!skips[item.key + '|' + item.kind + ':' + item.seasons.join('+')]; };
// Reads from Amazon the listings whose plan needs the live read (the hidden search words, the product kind): 20 a call through the
// Workspace's queue, content only. Returns how many were queued.
// Reads from Amazon what these listings' plans still need — only ever for the parent that is open (spPanelsRender): titles and search
// words 20 a call (?lfix=content), then the product type's schema and each listing's Item Highlights (?lfix=get), `first` (the rows on
// screen) before the rest, through the Workspace's queue (4 at a time). A read is never queued twice; one held for 24 h is not read again.
function spEnsureReads(items, first) {
  if (typeof liWsQueue !== 'function' || !items.length) return 0;
  if (!LI_WS.stored) liWsStoreLoad();
  spCheckPromote(items.map(item => item.key));        // this parent's listings already waiting in "Check all parents": read them first
  const front = new Set(first || []);
  const order = front.size ? items.filter(item => front.has(item.key)).concat(items.filter(item => !front.has(item.key))) : items;
  const token = t => { SP.reading.add(t); spProgAdd(t); return () => { SP.reading.delete(t); }; };
  // 1 titles and search words: 20 a call
  const want = order.filter(item => (item.kind === 'add' || item.kind === 'check') && !item.liveFresh && !item.readErr   // the content read (search words) only: one waiting for its Item Highlights is not read twice
    && !SP.reading.has(item.key) && !(item.live && item.live.cErr && Date.now() - (item.live.at || 0) < 3600000));
  const byBrand = { SP: [], CPC: [] };
  want.forEach(item => byBrand[item.brand].push(item));
  ['SP', 'CPC'].forEach(brand => {
    for (let i = 0; i < byBrand[brand].length; i += LI_WS_BATCH) {
      const batch = byBrand[brand].slice(i, i + LI_WS_BATCH);
      const done = batch.map(item => token(item.key));
      liWsQueue({ t: 'content', brand, skus: batch.map(item => item.sku), units: batch.length, pk: '', mark: batch.map(item => item.key), sweep: true, done: () => done.forEach(fn => fn()) });
    }
  });
  // 2 Item Highlights: the product type's schema (once per type), then the listing's own value (?lfix=get), one by one
  let hlN = 0;
  order.forEach(item => {
    const need = item.kind !== 'none' && item.hlInfo && item.hlInfo.need;   // no season on now applies: nothing to read
    if (!need) return;
    if (need === 'schema') {
      const pt = item.pt;
      const sch = LI_WS.schema[item.brand][pt];
      if (sch && !sch.pending && !sch.hl && !sch.err) delete LI_WS.schema[item.brand][pt];   // an older answer: ask again, with Item Highlights
      if (!LI_WS.schema[item.brand][pt]) { liWsNeedSchema(item.brand, pt, ''); hlN++; }
    } else if (need === 'get' && !SP.reading.has(item.key + '|get')) {
      SP.hlTried.add(item.key);
      liWsQueue({ t: 'get', brand: item.brand, sku: item.sku, units: 1, pk: '', mark: [item.key], sweep: true, done: token(item.key + '|get') });
      hlN++;
    }
  });
  return want.length + hlN;
}
/* ----- "Check all parents" (13 Nov 2026): every parent's hidden search words, read in the background ----- */
// ?lfix=content, 20 a call, for every listing a season on now applies to that was not read in the last 24 h (the Workspace's cache, kept
// 24 h), parent by parent so parents finish one after another, behind every read a person asks for (job.bg). The product type's schema
// (does it have Item Highlights?) follows once per type. Item Highlights themselves need ?lfix=get, one call a listing: they are read
// when a parent is opened. Progress counts parents: "Reading 120 of 362 — you can keep working"; the page redraws as answers land (at
// most every SP_DRAW_MS, never while scrolled — spAfterRead). Starts once by itself when the planner opens (spOn).
function spCheckAll() {
  if (typeof liWsQueue !== 'function' || spCheckRunning()) return 0;
  if (!LI_WS.stored) liWsStoreLoad();
  SP.checkStarted = true;
  const items = spCompute().filter(item => (item.kind === 'add' || item.kind === 'check') && !item.liveFresh && !item.readErr && !SP.reading.has(item.key));
  const byParent = new Map();
  items.forEach(item => { const pk = item.brand + '|' + spParentOf(item); if (!byParent.has(pk)) byParent.set(pk, []); byParent.get(pk).push(item); });
  const check = { total: byParent.size, done: 0, left: new Map(), at: Date.now() };
  SP.check = check;
  const lists = { SP: [], CPC: [] };
  byParent.forEach((list, pk) => { check.left.set(pk, list.length); list.forEach(item => lists[item.brand].push(item)); });
  ['SP', 'CPC'].forEach(brand => {
    for (let i = 0; i < lists[brand].length; i += LI_WS_BATCH) {
      const batch = lists[brand].slice(i, i + LI_WS_BATCH);
      batch.forEach(item => { SP.reading.add(item.key); SP.bgKeys.add(item.key); });
      liWsQueue({ t: 'content', brand, skus: batch.map(item => item.sku), units: batch.length, pk: '', mark: batch.map(item => item.key), bg: true, done: () => spCheckDone(check, batch) });
    }
  });
  if (SP.on) spRender();
  return check.total;
}
const spCheckRunning = () => !!(SP.check && SP.check.done < SP.check.total);
// One background batch is in: its listings are read; a parent is done when the last of its listings is.
function spCheckDone(check, batch) {
  batch.forEach(item => {
    SP.reading.delete(item.key);
    SP.bgKeys.delete(item.key);
    const pk = item.brand + '|' + spParentOf(item);
    const left = (check.left.get(pk) || 1) - 1;
    check.left.set(pk, left);
    if (!left) check.done++;
  });
}
// A parent opened while "Check all parents" runs: its background batches move to the front, as the person's own reads.
function spCheckPromote(keys) {
  if (typeof LI_WS === 'undefined' || !SP.bgKeys.size) return;
  const want = new Set(keys.filter(key => SP.bgKeys.has(key)));
  if (!want.size) return;
  const jobs = LI_WS.q.filter(job => job.bg && (job.mark || []).some(key => want.has(key)));
  if (!jobs.length) return;
  LI_WS.q = LI_WS.q.filter(job => !jobs.includes(job));
  jobs.forEach(job => { job.bg = false; liWsQueue(job); });
}
// The button and its progress, in the page's toolbar.
function spCheckHtml() {
  const c = SP.check;
  if (spCheckRunning()) return `<div class="sp-checkall"><button type="button" class="sp-btn" disabled>Checking…</button><span class="sp-reading" role="status">Reading ${spNf(c.done)} of ${spNf(c.total)} — you can keep working</span></div>`;
  return `<div class="sp-checkall"><button type="button" class="sp-btn" data-sp-act="check-all" title="Reads every parent's hidden search words from Amazon (20 listings a call; kept 24 h)">Check all parents</button>`
    + (c && c.total ? `<span class="sp-dim">✓ ${spNf(c.total)} parent${c.total === 1 ? '' : 's'} read</span>` : '') + '</div>';
}
// The open parent's progress: each listing counts once, done when every read queued for it is in.
function spProgAdd(t) {
  if (!SP.prog) return;
  const key = t.replace(/\|get$/, '');
  if (!SP.prog.items.has(key)) SP.prog.items.set(key, new Set());
  SP.prog.items.get(key).add(t);
}
function spProgNums(g) {
  const p = SP.prog;
  if (!p || p.key !== g.key) return null;
  let done = 0;
  p.items.forEach(set => { if ([...set].every(t => !SP.reading.has(t))) done++; });
  return { done, total: p.items.size };
}
function spProgText(g) {
  const p = spProgNums(g);
  return p && p.done < p.total ? `Reading ${spNf(p.done)} of ${spNf(p.total)} — you can keep working` : '';
}
// The rows of the open parent that are on screen now (their reads go first).
function spVisibleKeys() {
  const body = $('spPanel') && $('spPanel').querySelector ? $('spPanel').querySelector('.sp-side-b') : null;
  if (!body || !body.getBoundingClientRect || !body.querySelectorAll) return [];
  const box = body.getBoundingClientRect();
  return [...body.querySelectorAll('.sp-row[data-sp-key]')].filter(row => { const r = row.getBoundingClientRect(); return r.bottom > box.top && r.top < box.bottom; }).map(row => row.dataset.spKey);
}
// Once scrolling stops: the queued Item Highlights reads of the rows now on screen move to the front of the queue.
function spPrioritize() {
  if (typeof LI_WS === 'undefined' || !LI_WS.q || !SP.panel) return;
  const seen = new Set(spVisibleKeys());
  if (!seen.size) return;
  const first = LI_WS.q.filter(job => job.t === 'get' && job.mark && seen.has(job.mark[0]));
  if (!first.length) return;
  LI_WS.q = first.concat(LI_WS.q.filter(job => !first.includes(job)));
}
/* Keeping my place across a redraw: the first row (or card) on screen and how far it sat from the top of its scroller; after the
 * redraw that row is put back exactly there. `scroller` is a panel body, or null for the page. */
function spPlaceOf(scroller, rows) {
  const root = scroller || (typeof document !== 'undefined' ? document : null);
  if (!root || !root.querySelectorAll) return null;
  const top = scroller && scroller.getBoundingClientRect ? scroller.getBoundingClientRect().top : 0;
  const list = [...root.querySelectorAll(rows)];
  for (const row of list) {
    if (!row.getBoundingClientRect) return null;
    const r = row.getBoundingClientRect();
    if (r.bottom > top) return { key: row.getAttribute('data-sp-key') || row.getAttribute('data-sp-group') || '', off: r.top - top, scroll: scroller ? scroller.scrollTop : 0 };
  }
  return { key: '', off: 0, scroll: scroller ? scroller.scrollTop : 0 };
}
function spPlaceBack(scroller, rows, place) {
  if (!place) return;
  if (scroller) scroller.scrollTop = place.scroll;
  const root = scroller || document;
  if (!place.key || !root.querySelector) return;
  const attr = /group/.test(rows) ? 'data-sp-group' : 'data-sp-key';
  const row = root.querySelector(`${rows.split(',')[0].replace(/\[[^\]]*\]$/, '')}[${attr}="${CSS.escape(place.key)}"]`);
  if (!row || !row.getBoundingClientRect) return;
  const top = scroller && scroller.getBoundingClientRect ? scroller.getBoundingClientRect().top : 0;
  const delta = row.getBoundingClientRect().top - top - place.off;
  if (!delta) return;
  if (scroller) scroller.scrollTop += delta;
  else if (typeof window !== 'undefined' && window.scrollBy) window.scrollBy(0, delta);
}
// A read landed (listing-workspace.js calls this): the planner redraws, a little later and not while a title is being typed.
// A read landed (listing-workspace.js calls this): the planner redraws — at most every SP_DRAW_MS, never while the list or a panel is
// being scrolled (SP_SCROLL_MS after the last scroll), and not while a title is being typed.
function spAfterRead() {
  if (!SP.on && !SP.kid && !SP.panel) return;
  spSchedule();
}
function spSchedule() {
  if (SP.redrawT) return;
  const now = Date.now();
  SP.redrawT = setTimeout(spTick, Math.max(50, SP.lastDraw + SP_DRAW_MS - now, SP.scrollAt + SP_SCROLL_MS - now));
}
function spTick() {
  SP.redrawT = 0;
  spReadOpen();                                        // the open parent's next reads (schema, Item Highlights) go out even while scrolling
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (Date.now() - SP.scrollAt < SP_SCROLL_MS || (active && active.classList && active.classList.contains('sp-edit'))) return spSchedule();
  SP.lastDraw = Date.now();
  if (SP.on) spRender();
  spPanelsRender();
}
// What the open parent still needs from Amazon: queued (never twice), the rows on screen first. No redraw.
function spReadOpen() {
  if (!SP.panel) return 0;
  const g = spGroupOf(SP.panel.key);
  return g ? spEnsureReads(g.todo.concat(g.all.filter(item => !g.todo.includes(item))), spVisibleKeys()) : 0;
}
// A scroll in the list or a panel: held for SP_SCROLL_MS before any redraw; once it stops, the rows on screen are read first.
function spOnScroll(e) {
  const t = e && e.target;
  if (!SP.on && !SP.panel) return;
  if (t && t !== document && !(t.closest && t.closest('#spPane,#spPanel,#spKid'))) return;
  SP.scrollAt = Date.now();
  clearTimeout(SP.prioT);
  SP.prioT = setTimeout(spPrioritize, SP_SCROLL_MS);
}
if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('scroll', spOnScroll, true);

/* ----- the screens: three levels — parent cards on the page, one parent's side panel, one child's side panel -----
 * Written for a seller, not a developer: one sentence says what is going on, every card has ONE main button, every state is an icon
 * and a word (never colour alone), and nothing is sent without the confirm window. */
const SP_ICON = {
  pick: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 7"/></svg>',
  fix: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z"/></svg>',
};
// Each state: its icon, its long word (cards, the child panel), its short word (the rows), its class.
const SP_STATE = {
  ready: { i: '✓', t: 'Ready to fix', s: 'Ready', cls: 'is-ready' },
  look: { i: '⚠', t: 'Needs your OK', s: 'OK?', cls: 'is-look' },
  fix: { i: '✎', t: 'Fix by hand', s: 'By hand', cls: 'is-fix' },
  reading: { i: '…', t: 'Reading from Amazon', s: 'Reading', cls: 'is-reading' },
  ok: { i: '✓', t: 'Up to date', s: 'Up to date', cls: 'is-ok' },
};
// A picture for each season, beside its name (the word is always there too).
const SP_SEASON_ICON = { christmas: '🎄', thanksgiving: '🦃', halloween: '🎃', easter: '🐣', valentine: '❤️', newyear: '🎆', mother: '💐', father: '👔', july4: '🎆',
  patrick: '☘️', memorial: '🎗️', labor: '🛠️', sp_spring: '🌸', sp_summer: '☀️', sp_fall: '🍂', sp_winter: '❄️' };
const spSeasonIcon = id => SP_SEASON_ICON[id] || '📅';
// Where today stands against a season, in words: "is coming" (before its day), "is here" (its day has passed, still in its window), "is over".
function spSeasonWord(e) {
  if (!e || !e.s) return '';
  if (!e.s.inSeason) return 'is over';
  const t = spToday();
  return e.s.next && Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) < e.s.next.getTime() ? 'is coming' : 'is here';
}
// What a parent's products are called in a sentence: "napkins", "table runners", "pillow covers" (from the title template, else the catalogue).
function spProducts(row) {
  const tpl = lrTemplateFor(row, spCfg());
  const cat = lrCatOf(row) || {};
  let words = String((tpl && tpl.product) || cat.subcat || 'listing').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 1 && /^(cloth|throw|rectangle|round|square)$/.test(words[0])) words = words.slice(1);
  const last = words.pop();
  words.push(/s$/.test(last) ? last : last + 's');
  return words.join(' ');
}
// A child in the words a seller knows it by: Colour · Size · Pack — from the title (and the colour Amazon or the catalogue holds).
function spFacts(item) {
  const title = item.title || item.row.title || '';
  const color = typeof lrColorOf === 'function' ? lrColorOf(item.row) : '';
  const size = (hTitleSizes(title)[0] || {}).text || '';
  const pack = (title.match(/\b(?:set|pack) of \d+\b|\b\d+\s*(?:pack|pcs|pieces)\b/i) || [])[0] || '';
  return [color, size, pack ? pack.charAt(0).toUpperCase() + pack.slice(1) : ''].filter(Boolean).join(' · ') || item.name || item.sku;
}
const spPic = (brand, sku, big) => (typeof liWsPicHtml === 'function' ? liWsPicHtml(typeof liWsPicUrl === 'function' ? liWsPicUrl(brand, sku) : '', big) : '');
// The season name a listing's change is about, and the season word still in its title.
const spSeasonOf = item => (item.add[0] ? item.add[0] : null);


/* ----- the word difference: word SETS, not positions ----- */
// { added: [{ w, n, k }], removed: [{ w, n, k, kept }] } — a word that only moved is in neither; a word is never in both; a word
// whose count went down by 2 is one entry with n = 2 ("picnic ×2"). `kept`: the word is still there (a repeat taken out).
function spWordDiff(from, to) {
  const tok = text => String(text || '').split(/[\s,;]+/).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '')).filter(Boolean);
  const count = list => { const m = new Map(); list.forEach(word => { const k = word.toLowerCase(); const e = m.get(k) || { w: word, n: 0 }; e.n++; m.set(k, e); }); return m; };
  const a = count(tok(from));
  const b = count(tok(to));
  const added = [];
  const removed = [];
  b.forEach((e, k) => { const d = e.n - ((a.get(k) || {}).n || 0); if (d > 0) added.push({ w: e.w, n: d, k }); });
  a.forEach((e, k) => { const d = e.n - ((b.get(k) || {}).n || 0); if (d > 0) removed.push({ w: e.w, n: d, k, kept: b.has(k) }); });
  return { added, removed };
}
// "cloth, napkins ×2, block" — each word once, ×n when it went more than once.
const spWordList = list => list.map(x => lrEsc(x.w) + (x.n > 1 ? ` <span class="sp-times">×${x.n}</span>` : '')).join(', ');
// A text with the listed words marked (each as many times as it counts): ins for added, del for removed.
// The words of `list` marked in `text`. With `other` (the text on the other side of the change) the marks go BY POSITION: the words
// the other side does not keep, found by lining the two up word by word (the longest common run) — so the last "for" in "Gifts for
// Spring, Mother's Day" is marked when that is the one taken out, never an earlier one. Without it, the first ones are marked.
function spMarkHtml(text, list, tag, other) {
  const left = new Map(list.map(x => [x.k, x.n]));
  const key = part => part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '').toLowerCase();
  const parts = String(text || '').split(/(\s+)/);
  let only = null;
  if (other != null) {
    const a = parts.map((part, i) => ({ i, k: key(part) })).filter(x => x.k);
    const b = String(other || '').split(/\s+/).map(key).filter(Boolean);
    const n = a.length;
    const m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i].k === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const kept = new Set();
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[i].k === b[j]) { kept.add(a[i].i); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
    }
    only = new Set(a.filter(x => !kept.has(x.i)).map(x => x.i));
  }
  return parts.map((part, idx) => {
    const k = key(part);
    if (k && left.get(k) > 0 && (!only || only.has(idx))) { left.set(k, left.get(k) - 1); return `<${tag}>${lrEsc(part)}</${tag}>`; }
    return lrEsc(part);
  }).join('');
}
// The new text with only the really new words marked.
const spDiffHtml = (from, to) => spMarkHtml(to, spWordDiff(from, to).added, 'ins', from);
// The "before" text with what goes marked, by position.
const spDelHtml = (from, to) => spMarkHtml(from, spWordDiff(from, to).removed, 'del', to);

/* ----- the groups: one per parent ----- */
const spParentOf = item => item.row.parent || item.asin || item.sku;
// Every parent in view (brand and search), with all its listings and the ones to do (the list and season filters, "Not now" left out).
function spGroups(items) {
  const q = SP.q.trim().toLowerCase();
  const by = new Map();
  items.forEach(item => {
    if (SP.brand !== 'ALL' && item.brand !== SP.brand) return;
    const parent = spParentOf(item);
    const key = item.brand + '|' + parent;
    let g = by.get(key);
    if (!g) {
      g = { key, brand: item.brand, parent, name: typeof parentName === 'function' ? parentName(item.brand, parent, item.row.title) : parent, all: [], todo: [], match: !q };
      by.set(key, g);
    }
    g.all.push(item);
    if (q && [item.sku, item.asin, item.name, parent, g.name].join(' ').toLowerCase().includes(q)) g.match = true;
  });
  const out = [];
  by.forEach(g => {
    if (!g.match) return;
    g.todo = g.all.filter(item => spToDo(item) && !spSkipped(item));
    ['ready', 'fix', 'reading'].forEach(st => { g[st] = g.todo.filter(item => item.status === st); });
    out.push(g);
  });
  return out;
}
const spGroupOf = key => spGroups(spCompute()).find(g => g.key === key) || null;
// The season most of these listings need, with how many: { e, n } or null.
function spTopSeason(list) {
  const by = new Map();
  list.forEach(item => { const e = spSeasonOf(item); if (e) by.set(e.ev.id, { e, n: ((by.get(e.ev.id) || {}).n || 0) + 1 }); });
  return [...by.values()].sort((a, b) => b.n - a.n)[0] || null;
}
function spTopRemove(list) {
  const by = new Map();
  list.forEach(item => item.remove.forEach(e => by.set(e.ev.id, { e, n: ((by.get(e.ev.id) || {}).n || 0) + 1 })));
  return [...by.values()].sort((a, b) => b.n - a.n)[0] || null;
}

/* ----- one parent's season problems: the parent card's badges, the panel's rows and each child's panel all read this ----- */
// One entry per season on now that a child of this parent misses somewhere: { e, kids, hlN, kwN } ("Not now" left out). Nearest season first.
function spSeasonRows(g) {
  return spActive(spCfg(), spToday()).map(e => {
    const id = e.ev.id;
    const kids = g.all.filter(item => spMissing(item, id) && !spSkipped(item));
    return { e, kids, hlN: kids.filter(item => item.miss[id].hl === 'missing').length, kwN: kids.filter(item => item.miss[id].kw === 'missing').length };
  }).filter(r => r.kids.length);
}
// Children of a parent not read from Amazon yet (nothing known about their two places) — never counted as missing or as ready.
const spCheckN = g => g.all.filter(item => item.kind === 'check').length;
const spReadyN = g => g.all.filter(item => item.kind === 'ok').length;

/* ----- level 1: the page ----- */
function spHowHtml() {
  let hidden = false;
  try { hidden = localStorage.getItem(SP_STORE_HELP) === '1'; } catch (e) { /* no storage */ }
  if (hidden) return '<div class="sp-how is-folded"><button type="button" class="sp-link" data-sp-act="help-show">How it works</button></div>';
  const step = (n, icon, t, s) => `<div class="sp-step"><span class="sp-step-n">${n}</span><span class="sp-step-i">${SP_ICON[icon]}</span><div><b>${t}</b><small>${s}</small></div></div>`;
  return `<div class="sp-how" role="note"><div class="sp-steps">${step(1, 'pick', 'Seasons on now', 'Picked by date from the calendar')}${step(2, 'check', 'Check', 'Open a product to see what is missing')}${step(3, 'fix', 'Fix', 'Amazon checks each change first; the title never changes')}</div>`
    + `<div class="sp-how-a"><button type="button" class="sp-q" data-sp-act="help-more" aria-expanded="${SP.helpOpen ? 'true' : 'false'}" aria-label="What does this do?">?</button><button type="button" class="sp-link" data-sp-act="help-hide">Hide</button></div>`
    + (SP.helpOpen ? `<div class="sp-help">Every season that is on now or starting soon (from the Listing Rules calendar) should be in two places of each listing: Item Highlights (shown under the title, up to 125 letters) and the hidden search words. This page shows where it is missing and adds it — in natural words, within the limits. When there is no room, old season words (seasons that are over) are taken out first. The title is never changed. Amazon checks every change before it goes live.</div>` : '')
    + '</div>';
}
// "Now: 🦃 Thanksgiving (26 Nov), 🎄 Christmas (25 Dec) · Next: 🎆 New Year's" — the seasons change by themselves as the dates pass.
function spNowHtml() {
  const today = spToday();
  const on = spActive(spCfg(), today);
  const next = spNext(spCfg(), today);
  const now = on.length ? on.map(e => `${spSeasonIcon(e.ev.id)} ${lrEsc(e.ev.name)} (${spDate(e.w.date)})`).join(', ') : 'no season';
  return `<p class="sp-today sp-now"><b>Now:</b> ${now}${next ? ` · <b>Next:</b> ${spSeasonIcon(next.ev.id)} ${lrEsc(next.ev.name)} <span class="sp-dim">(from ${spDate(next.w.from)})</span>` : ''}</p>`;
}
// One parent card's line: "36 listings · 🎄 Christmas missing · 14 · 🦃 Thanksgiving missing · 20", or "✓ Ready for the season".
function spParentLine(g) {
  const rows = spSeasonRows(g);
  const parts = [spPlural(g.all.length, 'listing')];
  if (rows.length) parts.push(rows.map(r => `<span class="sp-sbadge">${spSeasonIcon(r.e.ev.id)} ${lrEsc(r.e.ev.name)} missing · ${spNf(r.kids.length)}</span>`).join(' '));   // the badges side by side
  const unread = spCheckN(g);
  if (!rows.length) parts.push(unread ? `<span class="sp-dim">${spNf(unread)} not read yet — open to check</span>` : '<span class="sp-ok">✓ Ready for the season</span>');
  return parts.join(' · ');
}
function spParentCardHtml(g) {
  const open = SP.panel && SP.panel.key === g.key;
  const done = !spSeasonRows(g).length && !spCheckN(g);
  return `<div class="card sp-pc${open ? ' is-open' : ''}${done ? ' is-done' : ''}" role="button" tabindex="0" data-sp-act="open-parent" data-sp-group="${lrEsc(g.key)}" aria-label="Open ${lrEsc(g.name)}">`
    + `${spPic(g.brand, (g.todo[0] || g.all[0]).sku, false)}<div class="sp-pc-t"><b title="${lrEsc(g.name)}">${lrEsc(g.name)}</b><span>${spParentLine(g)}</span></div>`
    + '<span class="sp-pc-open" aria-hidden="true">Open ›</span></div>';
}
// The chips: All · 🎄 Christmas missing · 🦃 Thanksgiving missing · ✓ Ready — each with how many parents it shows.
function spChips(groups) {
  const on = spActive(spCfg(), spToday());
  const list = [['all', 'All', groups.length]].concat(on.map(e => ['miss:' + e.ev.id, `${spSeasonIcon(e.ev.id)} ${e.ev.name} missing`, groups.filter(g => g.rows.some(r => r.e.ev.id === e.ev.id)).length]),
    [['ready', '✓ Ready', groups.filter(g => g.ready).length]]);
  return '<div class="sp-chips">' + list.map(([k, t, n]) => `<button type="button" class="sp-chip${SP.list === k ? ' is-on' : ''}" data-sp-act="list" data-sp-list="${lrEsc(k)}" aria-pressed="${SP.list === k}">${lrEsc(t)}<span class="sp-n">${spNf(n)}</span></button>`).join('') + '</div>';
}
// The whole page.
function spRender() {
  const box = $('spPane');
  if (!box || !SP.on) return;
  if (SP.loading || !H_LOADED) {
    box.innerHTML = spHowHtml() + '<p class="sp-today"><span class="sp-reading">Reading your listings…</span></p>'
      + '<div class="sp-list">' + Array.from({ length: 6 }, () => '<div class="card sp-pc is-skel"><span class="sp-skel is-pic"></span><span class="sp-skel is-w"></span><span class="sp-skel is-s"></span></div>').join('') + '</div>';
    return;
  }
  if (SP.loadErr) {
    box.innerHTML = spHowHtml() + `<div class="card sp-empty"><b>Could not read your listings.</b><br>${lrEsc(SP.loadErr)}<br><button type="button" class="sp-main" data-sp-act="reload">Try again</button></div>`;
    return;
  }
  const items = spCompute();                           // what is held now — the list reads nothing from Amazon
  const groups = spGroups(items);
  groups.forEach(g => { g.rows = spSeasonRows(g); g.ready = !g.rows.length && !spCheckN(g); g.missN = new Set(g.rows.flatMap(r => r.kids)).size; });
  if (SP.list !== 'all' && SP.list !== 'ready' && !spActive(spCfg(), spToday()).some(e => 'miss:' + e.ev.id === SP.list)) SP.list = 'all';   // a season that went by
  const keep = g => (SP.list === 'all' ? true : SP.list === 'ready' ? g.ready : g.rows.some(r => 'miss:' + r.e.ev.id === SP.list));
  const shown = groups.filter(keep).sort((a, b) => (b.missN - a.missN) || (spCheckN(b) - spCheckN(a)) || a.name.localeCompare(b.name));
  const page = shown.slice(0, SP.shown);
  const toolbar = `<div class="card sp-tb"><div class="sp-seg" role="group" aria-label="Brand">${[['ALL', 'Both brands'], ['SP', BRAND_NAME.SP || 'SP'], ['CPC', BRAND_NAME.CPC || 'CPC']].map(([v, t]) => `<button type="button" class="${SP.brand === v ? 'on' : ''}" data-sp-act="brand" data-sp-brand="${v}" aria-pressed="${SP.brand === v}">${lrEsc(t)}</button>`).join('')}</div>`
    + `<label class="sp-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="spQ" value="${lrEsc(SP.q)}" placeholder="Search a product, SKU or ASIN" aria-label="Search"></label>${spCheckHtml()}</div>`;
  const empty = !shown.length ? `<div class="card sp-empty"><b>${SP.q || SP.list !== 'all' ? 'Nothing here with these filters.' : 'No season is on now.'}</b><br>${SP.q || SP.list !== 'all' ? 'Clear the search or pick “All” to see everything.' : 'The next one shows here by itself when it starts.'}</div>` : '';
  const more = shown.length > page.length ? `<div class="sp-foot"><span>${spNf(page.length)} of ${spNf(shown.length)} parents</span><button type="button" class="sp-btn" data-sp-act="more">Show ${spNf(Math.min(SP_PAGE, shown.length - page.length))} more</button></div>` : '';
  const result = SP.result && !SP.panel ? spResultHtml(SP.result) : '';
  const place = spPlaceOf(null, '#spPane .sp-pc[data-sp-group]');   // the card at the top of the screen stays where it is
  box.innerHTML = spHowHtml() + spNowHtml() + toolbar + spChips(groups) + result + empty + `<div class="sp-list">${page.map(spParentCardHtml).join('')}</div>` + more;
  spPlaceBack(null, '#spPane .sp-pc[data-sp-group]', place);
}

/* ----- level 2: one parent ----- */
// One season's row: "🎄 Christmas missing — Item Highlights 10 · Search words 14 — 14 children [Fix all 14]", and under "› Show all N" the
// children: name · SKU · where it is missing · what the fix writes (or why it needs your OK).
function spSeasonRowHtml(g, r) {
  const id = r.e.ev.id;
  const plans = r.kids.map(item => spPlanFor(item, id));
  const ready = plans.filter(p => p.status === 'ready');
  const openSet = (SP.panel && SP.panel.open) || new Set();
  const open = openSet.has(id);
  const where = [r.hlN ? `Item Highlights ${spNf(r.hlN)}` : '', r.kwN ? `Search words ${spNf(r.kwN)}` : ''].filter(Boolean).join(' · ');
  const n = r.kids.length;
  const btn = ready.length ? `<button type="button" class="fa-btn fa-main" data-sp-act="fix-season" data-sp-group="${lrEsc(g.key)}" data-sp-id="${lrEsc(id)}"${SP.sending ? ' disabled' : ''}>Fix all ${spNf(ready.length)}</button>`
    : plans.some(p => p.status === 'reading') ? '<button type="button" class="fa-btn" disabled>Checking…</button>'
      : `<button type="button" class="fa-btn" data-sp-act="season-more" data-sp-id="${lrEsc(id)}">See why</button>`;
  const show = `<button type="button" class="fa-link" data-sp-act="season-more" data-sp-id="${lrEsc(id)}" aria-expanded="${open}">${open ? '⌄ Hide' : '› Show all ' + spNf(n)}</button>`;
  const head = `<div class="fa-row is-att"><span class="fa-dot" aria-hidden="true"></span><div class="fa-row-t"><b>${spSeasonIcon(id)} ${lrEsc(r.e.ev.name)} missing</b><small>${lrEsc(where)}</small>${show}</div>`
    + `<span class="fa-n">${n === 1 ? '1 child' : spNf(n) + ' children'}</span>${btn}</div>`;
  if (!open) return head;
  const all = SP.panel && SP.panel.all && SP.panel.all.has(id);
  const list = all ? r.kids : r.kids.slice(0, 8);
  const rows = list.map((item, i) => {
    const p = plans[r.kids.indexOf(item)];
    const m = item.miss[id];
    const missing = [m.hl === 'missing' ? 'Item Highlights' : '', m.kw === 'missing' ? 'search words' : ''].filter(Boolean).join(' and ');
    const after = p.status === 'ready' ? [p.hlAdd ? `Item Highlights: “${spCut(p.hlAfter[0] || p.hlAdd, 70)}”` : '', p.kwAdd.length ? `Search words: + ${p.kwAdd.join(' ')}` : ''].filter(Boolean).join(' · ')
      : '';
    const why = p.status === 'ready' ? '' : p.status === 'reading' ? '… reading it from Amazon first' : `⚠ Needs your OK: ${p.why}`;
    return `<div class="fa-kid"><button type="button" class="fa-kid-o" data-sp-act="open-kid" data-sp-key="${lrEsc(item.key)}"><b>${lrEsc(spFacts(item))}</b><small>${lrEsc(item.sku)}</small>`
      + `<span class="fa-chg">Missing in ${lrEsc(missing)}${after ? ` → <span class="fa-new">${lrEsc(after)}</span>` : ''}${why ? ` <span class="fa-why">${lrEsc(why)}</span>` : ''}${p.note && p.status === 'ready' ? ` <span class="fa-why">${lrEsc(p.note)}</span>` : ''}</span></button></div>`;
  }).join('');
  const more = r.kids.length > list.length ? `<button type="button" class="fa-link" data-sp-act="season-all" data-sp-id="${lrEsc(id)}">Show the other ${spNf(r.kids.length - list.length)}</button>` : '';
  return head + `<div class="fa-kids">${rows}${more}</div>`;
}
const spCut = (text, n) => { const t = String(text || ''); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; };
// The parent side panel's body: the result of the last fix, one row per season, "N children ready for the season", then the children
// list as it always was (the ones to do, then the ones up to date, folded away).
function spParentBodyHtml(g) {
  const rows = spSeasonRows(g);
  const result = SP.result ? spResultHtml(SP.result) : '';
  const block = rows.length ? `<div class="fa sp-seasons"><div class="fa-sec"><div class="fa-sec-h">Season words missing</div>${rows.map(r => spSeasonRowHtml(g, r)).join('')}</div></div>` : '';
  const readyN = spReadyN(g);
  const unread = spCheckN(g);
  const ok = `<div class="fa-okline sp-readyl"><span aria-hidden="true">✓</span> ${readyN === 1 ? '1 child' : spNf(readyN) + ' children'} ready for the season${unread ? ` · ${spNf(unread)} not read yet` : ''}</div>`;
  const none = spActive(spCfg(), spToday()).length ? '' : '<p class="sp-today sp-psent">✓ <b>No season is on now.</b> The next one shows here by itself when it starts.</p>';
  SP.kidOrder = g.todo.map(item => item.key);
  const upToDate = g.all.filter(item => !g.todo.includes(item));
  return `${none}${result}${block}${ok}`
    + `<div class="sp-rows">${g.todo.map(item => spRowHtml(item)).join('')}</div>`
    + (upToDate.length ? `<details class="sp-fold sp-uptodate"${SP.panel && SP.panel.okOpen ? ' open' : ''}><summary class="sp-more-ok">✓ ${spNf(upToDate.length)} more listing${upToDate.length === 1 ? ' is' : 's are'} up to date.</summary>`
      + `<div class="sp-rows">${upToDate.map(item => spRowHtml(item)).join('')}</div></details>` : '');
}
// What we will do for one listing, in one short line.
function spDoLine(item) {
  return spDoLineWords(item);
}
function spDoLineWords(item) {
  if (item.status === 'reading') return 'Reading this listing from Amazon…';
  if (item.status === 'fix') return item.hint || 'Change it by hand in Listing Errors';
  if (item.kind === 'none') return 'No season on now applies to it';
  if (item.kind === 'ok') return 'Ready for the season';
  const out = [];
  if (item.hlAdd) out.push(`Add “${lrEsc(item.hlAdd)}” to Item Highlights`);
  if (item.kwAdd.length) out.push(`add “${lrEsc(item.kwAdd.join(' '))}” to the hidden search words`);
  return out.join(', ') || 'Nothing to change';
}
// One child as a compact row: picture · Colour · Size · Pack (SKU small grey) · what we'll do · the state chip · ONE button.
function spRowHtml(item) {
  const st = SP_STATE[item.status] || SP_STATE.look;
  const open = SP.kid && SP.kid.key === item.key;
  const btn = item.status === 'ready' ? `<button type="button" class="sp-btn sp-row-b" data-sp-act="row-fix" data-sp-key="${lrEsc(item.key)}"${SP.sending ? ' disabled' : ''}>Fix</button>`
    : item.status === 'reading' ? '<button type="button" class="sp-btn sp-row-b" disabled>Wait</button>'
      : `<button type="button" class="sp-btn sp-row-b" data-sp-act="open-kid" data-sp-key="${lrEsc(item.key)}">Check</button>`;
  return `<div class="sp-row ${st.cls}${open ? ' is-open' : ''}" role="button" tabindex="0" data-sp-act="open-kid" data-sp-key="${lrEsc(item.key)}" aria-label="Open ${lrEsc(spFacts(item))}">`
    + `${spPic(item.brand, item.sku, false)}<div class="sp-row-t"><b>${lrEsc(spFacts(item))}</b><span>${spDoLine(item)}${spWhereShort(item) ? ' · ' + spWhereShort(item) : ''}</span><small>${lrEsc(item.sku)}</small></div>`
    + `<span class="sp-chip-s ${st.cls}"><i aria-hidden="true">${st.i}</i>${st.s}</span>${btn}</div>`;
}
// The parent side panel: header card, then the body.
function spParentPanelHtml(g) {
  return `<div class="sp-side-h"><div class="sp-hc">${spPic(g.brand, (g.todo[0] || g.all[0]).sku, true)}<div class="sp-hc-t"><b title="${lrEsc(g.name)}">${lrEsc(g.name)}</b>`
    + `<span>${lrEsc(BRAND_NAME[g.brand] || g.brand)} · ${spPlural(g.all.length, 'listing')}${spProgText(g) ? ` · <span class="sp-reading">${spProgText(g)}</span>` : ''}</span></div><button type="button" class="sp-x" data-sp-act="close-parent" aria-label="Close">×</button></div></div>`
    + `<div class="sp-side-b">${spParentBodyHtml(g)}</div>`;
}

/* ----- level 3: one child ----- */
function spKidHtml(item, g) {
  const st = SP_STATE[item.status] || SP_STATE.look;
  const parentNameText = g ? g.name : spParentOf(item);
  const back = `<button type="button" class="sp-back" data-sp-act="close-kid">← Back to ${lrEsc(parentNameText)}</button>`;
  const head = `<div class="sp-side-h">${back}<div class="sp-hc">${spPic(item.brand, item.sku, true)}<div class="sp-hc-t"><b>${lrEsc(spFacts(item))}</b><span>${lrEsc(parentNameText)}</span><small>${lrEsc(item.sku)}</small>`
    + `<span class="sp-chip-s ${st.cls}"><i aria-hidden="true">${st.i}</i>${st.t}</span></div><button type="button" class="sp-x" data-sp-act="close-kid" aria-label="Close">×</button></div></div>`;
  if (item.kind === 'ok' || item.kind === 'none') {
    const words = item.kind === 'none' ? 'No season on now applies to this listing.' : 'Every season on now is in Item Highlights and the hidden search words.';
    return head + `<div class="sp-side-b"><div class="sp-card2 is-ok"><h4>✓ Ready for the season</h4><p>${words}</p></div>${spWhereHtml(item)}</div>`
      + '<div class="sp-bar"><button type="button" class="sp-main" data-sp-act="close-kid">Close</button></div>';
  }
  const products = spProducts(item.row);
  const card = (cls, title, body) => `<div class="sp-card2 ${cls}"><h4>${title}</h4>${body}</div>`;
  // 2 the problem: each season on now, where it is missing
  const problem = item.add.length ? item.add.map(e => {
    const m = item.miss[e.ev.id];
    const where = [m.hl === 'missing' ? 'Item Highlights' : '', m.kw === 'missing' ? 'the hidden search words' : ''].filter(Boolean).join(' and ');
    return `${spSeasonIcon(e.ev.id)} ${lrEsc(e.ev.name)} ${spSeasonWord(e)} (${spDate(e.w.date)}) and this listing doesn't have it in ${where}.`;
  }).join('<br>') : 'We are reading this listing from Amazon first, to see where the season words are.';
  // 3 why it matters
  const first = item.add[0] || item.pick;
  const why = first ? `Shoppers searching “${lrEsc(first.ev.name.toLowerCase())} ${lrEsc(products)}” may not find it.` : '';
  // 4 what we'll do
  let todo;
  if (item.status === 'fix') todo = `We can't add it safely by ourselves: ${lrEsc(item.why)}. ${item.hint ? lrEsc(item.hint) + ' ' : ''}Listing Errors opens with the suggestion filled in — nothing is sent until you press Send there.`;
  else if (item.status === 'reading') todo = 'We are reading this listing from Amazon first. This takes a moment.';
  else {
    const bits = [];
    if (item.hlAdd) bits.push(`Add “${lrEsc(item.hlAdd)}” to Item Highlights (shown under the title).`);
    if (item.kwAdd.length) bits.push(`Add “${lrEsc(item.kwAdd.join(' '))}” to the hidden search words.`);
    if (item.removed.hl.length) bits.push(`To make room, the old season words ${lrEsc(spNames(item.removed.hl.map(n => '“' + n + '”')))} come out of Item Highlights.`);
    if (item.removed.kw.length) bits.push(`To make room, the old season words ${lrEsc(spNames(item.removed.kw.map(n => '“' + n + '”')))} come out of the hidden search words.`);
    bits.push('The title stays the same.');
    todo = bits.join(' ') + (item.note ? `<br><span class="sp-dim">${lrEsc(item.note)}</span>` : '');
  }
  const changes = item.status === 'reading' ? '' : card('sp-chg', 'What changes', spChangesHtml(item));
  const checksHtml = item.checks.length ? card('sp-chk-c', 'Checks', spChecksHtml(item.checks)) + spPreCardHtml(item.checks, item) : '';
  // the action bar
  const canSend = item.status === 'ready' && !!item.pt && !SP.sending && spChanges(item);
  let main;
  if (item.status === 'fix') main = `<button type="button" class="sp-main" data-sp-act="fixhand" data-sp-key="${lrEsc(item.key)}">Open in Listing Errors</button>`;
  else if (item.status === 'reading') main = '<button type="button" class="sp-main" disabled>Reading from Amazon…</button>';
  else main = `<button type="button" class="sp-main" data-sp-act="approve" data-sp-key="${lrEsc(item.key)}"${canSend ? '' : ' disabled'}>Fix — send to Amazon</button>`;
  const bar = `<div class="sp-bar">${main}<button type="button" class="sp-btn sp-quiet" data-sp-act="skip" data-sp-key="${lrEsc(item.key)}" title="Hide this for this season, in this browser">Not now</button>`
    + `<span class="sp-reason" hidden></span></div>`;
  return head + `<div class="sp-side-b">${card('sp-prob', 'Problem', `<p>${problem}</p>`)}${why ? card('sp-whyc', 'Why it matters', `<p>${why}</p>`) : ''}${card('sp-do', 'What we’ll do', `<p>${todo}</p>`)}${spWhereHtml(item)}${changes}${checksHtml}</div>` + bar;
}
// Where one season is on this listing now: Item Highlights ✓ / ✕ and the hidden search words ✓ / ✕ — never the title.
// [{ k: 'hl' | 'kw', st: found | missing | na | checking, text }].
function spWhere(item, e) {
  const id = e.ev.id;
  const m = item.miss[id] || { hl: 'unknown', kw: 'unknown' };
  const name = e.ev.name;
  const unread = token => (SP.reading.has(token) ? 'checking…' : 'Not read yet');
  const info = item.hlInfo || {};
  const hl = item.hl || [];
  const hlSize = list => (info.items > 1 ? `${spNf(list.length)} of ${spNf(info.items)} entries` : `${spNf((list[0] || '').length)} of ${spNf(info.max)}`);
  const hlAfterN = spHlChanged(item) && m.hl === 'missing' ? `now ${hlSize(hl)}, after the fix ${hlSize(item.hlAfter)}` : info.state === 'ok' ? hlSize(hl) : '';
  const kwAfterN = item.kw != null ? (item.kwAfter != null && item.kwAfter !== item.kw && m.kw === 'missing' ? `now ${spNf(lrKwBytes(item.kw))} of ${spNf(item.kwMax)}, after the fix ${spNf(lrKwBytes(item.kwAfter))} of ${spNf(item.kwMax)}` : `${spNf(lrKwBytes(item.kw))} of ${spNf(item.kwMax)}`) : '';
  const row = (k, place, st, what, n) => ({ k, st, text: `${st === 'found' ? '✓' : st === 'missing' ? '✕' : '·'} ${place}: ${what}${n ? ` (${n})` : ''}` });
  const over = item.titleOver && (m.hl === 'found' || m.hl === 'missing') ? ` — ${SP_HL75_NOTE}` : '';
  const hlRow = m.hl === 'found' ? row('hl', 'Item Highlights', 'found', `“${spFindSeason(hl.join(' · '), e.ev)}” found${over}`, hlAfterN)
    : m.hl === 'missing' ? row('hl', 'Item Highlights', 'missing', `${name} missing${over}`, hlAfterN)
      : m.hl === 'na' ? row('hl', 'Item Highlights', 'na', 'not available for this product type', '')
        : m.hl === 'err' ? row('hl', 'Item Highlights', 'na', `could not be read (${info.err || item.readErr})`, '')
          : row('hl', 'Item Highlights', 'checking', unread(item.key + '|get'), '');
  const kwRow = m.kw === 'found' ? row('kw', 'Hidden search words', 'found', `“${spFindSeason(item.kw, e.ev)}” found`, kwAfterN)
    : m.kw === 'missing' ? row('kw', 'Hidden search words', 'missing', `${name} missing`, kwAfterN)
      : m.kw === 'err' ? row('kw', 'Hidden search words', 'na', `could not be read (${item.readErr})`, '')
        : row('kw', 'Hidden search words', 'checking', unread(item.key), '');
  return [hlRow, kwRow];
}
// One card per season on now, in the style of "What changes": ✓ found (green), ✕ missing (red), not available / checking (grey).
function spWhereHtml(item) {
  if (!item.active.length) return '<div class="sp-card2 sp-chg sp-where"><h4>Seasons on now</h4><p class="sp-dim">No season on now applies to this listing.</p></div>';
  return item.active.map(e => `<div class="sp-card2 sp-chg sp-where" data-sp-season="${lrEsc(e.ev.id)}"><h4>Where “${lrEsc(e.ev.name)}” is</h4>`
    + spWhere(item, e).map(r => `<p class="${r.st === 'found' ? 'sp-add' : r.st === 'missing' ? 'sp-rem' : 'sp-dim'}" data-sp-where="${r.k}">${lrEsc(r.text)}</p>`).join('') + '</div>').join('');
}
// The child row's short words, per season on now: "🎄 ✓ highlights ✕ search words".
function spWhereShort(item) {
  return item.active.map(e => {
    const m = item.miss[e.ev.id];
    const w = (st, word) => (st === 'found' ? `✓ ${word}` : st === 'missing' ? `✕ ${word}` : '');
    const parts = [w(m.hl, 'highlights'), w(m.kw, 'search words')].filter(Boolean);
    return parts.length ? `${spSeasonIcon(e.ev.id)} ${parts.join(' ')}` : '';
  }).filter(Boolean).join(' · ');
}
// Per brand, per season on now: how many listings have it in Item Highlights, in the hidden search words, and miss it — run
// spWhereCount() in the console on live Sellora.
function spWhereCount() {
  const out = {};
  const items = spCompute();
  ['SP', 'CPC'].forEach(brand => spActive(spCfg(), spToday()).forEach(e => {
    const c = { inHighlights: 0, inSearchWords: 0, missing: 0, notRead: 0 };
    items.filter(item => item.brand === brand && item.miss[e.ev.id]).forEach(item => {
      const m = item.miss[e.ev.id];
      if (m.hl === 'found') c.inHighlights++;
      if (m.kw === 'found') c.inSearchWords++;
      if (spMissing(item, e.ev.id)) c.missing++;
      else if (m.hl === 'unknown' || m.kw === 'unknown') c.notRead++;
    });
    out[`${BRAND_NAME[brand] || brand} · ${e.ev.name}`] = c;
  }));
  if (typeof console !== 'undefined' && console.table) console.table(out);
  return out;
}
// "What changes": Item Highlights and the hidden search words, before → after (only the changed words marked). Never the title.
function spChangesHtml(item) {
  const out = [];
  if (spHlChanged(item)) {
    const before = item.hl.join(' · ');
    const after = item.hlAfter.join(' · ');
    out.push(`<div class="sp-ba"><small>Item Highlights before</small><p>${before ? spDelHtml(before, after) : '(none)'}</p><small>Item Highlights after</small><p class="sp-change-after">${spDiffHtml(before, after)}</p></div>`);
  }
  if (item.kwAfter != null && item.kw != null && item.kwAfter !== item.kw) {
    out.push(`<div class="sp-ba"><small>Hidden search words before</small><p>${item.kw ? spDelHtml(item.kw, item.kwAfter) : '(none)'}</p><small>Hidden search words after</small><p class="sp-change-after">${spDiffHtml(item.kw, item.kwAfter)}</p></div>`
      + `<p class="sp-dim">Hidden search words: ${spNf(lrKwBytes(item.kwAfter))} of ${spNf(item.kwMax)}.</p>`);
  }
  return (out.join('') || '<p class="sp-dim">Nothing changes.</p>') + '<p class="sp-dim">The title stays the same.</p>';
}
// "Already there before — not caused by this change": the checks that failed before the change too, and a way to fix them in
// Listing Health (Child listings, this listing's sidebar). Always in the page (hidden when empty) so the Edit box can fill it.
function spPreCardHtml(checks, item) {
  const pre = checks.filter(check => check.pre);
  return `<div class="sp-card2 sp-pre-c"${pre.length ? '' : ' hidden'}>${spPreHtml(pre, item)}</div>`;
}
const spPreHtml = (pre, item) => '<h4>Already there before — not caused by this change</h4>'
  + `<ul class="sp-checks">${pre.map(check => `<li class="sp-chk is-pre"><i>⚠</i>${lrEsc(check.t)}</li>`).join('')}</ul>`
  + `<p class="sp-dim">These don't stop this change. <button type="button" class="sp-link" data-sp-act="to-health" data-sp-key="${lrEsc(item.key)}">Fix them in Listing Health</button></p>`;
// "✓ All 8 checks pass" — click to see them. Only the change's own checks: the ones already failing before are in their own card.
function spChecksHtml(checks) {
  checks = checks.filter(check => !check.pre);
  const fail = checks.filter(check => check.ok === false).length;
  const warn = checks.filter(check => check.ok === 'warn').length;
  const sum = fail ? `✕ ${spPlural(fail, 'check')} ${fail === 1 ? 'does' : 'do'} not pass` : warn ? `⚠ ${spNf(checks.length - warn)} of ${spNf(checks.length)} checks pass — ${spNf(warn)} to look at` : `✓ All ${spNf(checks.length)} checks pass`;
  return `<details class="sp-fold${fail ? ' is-bad' : warn ? ' is-warn' : ''}"${fail ? ' open' : ''}><summary class="sp-chk-sum">${sum}</summary><ul class="sp-checks">${checks.map(check => `<li class="sp-chk ${check.ok === true ? 'is-ok' : check.ok === false ? 'is-no' : 'is-warn'}"><i>${check.ok === true ? '✓' : check.ok === false ? '✕' : '⚠'}</i>${lrEsc(check.t)}</li>`).join('')}</ul></details>`;
}

/* ----- opening and closing the panels ----- */
// The parent panel (from the page) and the child panel (from the parent panel). Esc closes the child first.
function spOpenParent(key) {
  SP.panel = { key, filter: '' };
  if (!SP.prog || SP.prog.key !== key) SP.prog = { key, items: new Map() };
  SP.kid = null;
  SP.result = null;
  const box = $('spPanel');
  if (!box) return;
  box.hidden = false;
  spPanelsRender();
  if (SP.on) spRender();
  if (box.focus) box.focus({ preventScroll: true });
}
function spCloseParent(returnFocus) {
  if (SP.kid) spCloseKid(false);
  const key = SP.panel && SP.panel.key;
  SP.panel = null;
  const box = $('spPanel');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  if (SP.on) spRender();
  if (returnFocus && key) {
    const card = $('spPane') && $('spPane').querySelector ? $('spPane').querySelector(`[data-sp-act="open-parent"][data-sp-group="${CSS.escape(key)}"]`) : null;
    if (card && card.focus) card.focus({ preventScroll: true });
  }
}
function spOpenKid(key) {
  SP.kid = { key };
  const box = $('spKid');
  if (!box) return;
  box.hidden = false;
  spPanelsRender();
  if (box.focus) box.focus({ preventScroll: true });
}
function spCloseKid(returnFocus) {
  if (!SP.kid) return;
  const { key } = SP.kid;
  SP.kid = null;
  const box = $('spKid');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  spPanelsRender();
  if (returnFocus) {
    const root = $('spPanel');
    const row = root && root.querySelector ? root.querySelector(`.sp-row[data-sp-key="${CSS.escape(key)}"]`) : null;
    if (row && row.focus) row.focus({ preventScroll: true });
  }
}
// ↑ / ↓ in a child: the child before / after it, in the order the parent's rows show.
function spKidMove(dir) {
  if (!SP.kid) return;
  const order = SP.kidOrder || [];
  const at = order.indexOf(SP.kid.key);
  const next = order[at + dir];
  if (next) spOpenKid(next);
}
// Close both (the tab changed, or the Season planner pill was switched off).
function spPanelsClose() {
  if (SP.kid) spCloseKid(false);
  if (SP.panel) spCloseParent(false);
}
// Draw what is open: the parent panel (its scroll kept) and the child panel.
function spPanelsRender() {
  const pp = $('spPanel');
  if (pp && SP.panel) {
    const g = spGroupOf(SP.panel.key);
    if (!g) spCloseParent(false);
    else {
      // this parent's reads only, queued before drawing so its header shows the progress at once: the rows on screen first (the rows
      // still to do, then the up-to-date children)
      spEnsureReads(g.todo.concat(g.all.filter(item => !g.todo.includes(item))), spVisibleKeys());
      const body = pp.querySelector ? pp.querySelector('.sp-side-b') : null;
      const place = body ? spPlaceOf(body, '.sp-row[data-sp-key]') : null;   // my place: the top row on screen and its offset
      pp.innerHTML = spParentPanelHtml(g);
      const again = pp.querySelector ? pp.querySelector('.sp-side-b') : null;
      if (again) spPlaceBack(again, '.sp-row[data-sp-key]', place);
    }
  }
  if (pp && pp.classList) pp.classList.toggle('has-kid', !!SP.kid);
  const kp = $('spKid');
  if (kp && SP.kid) {
    const item = spCompute().find(each => each.key === SP.kid.key);
    if (!item) return spCloseKid(false);
    const g = spGroups(spCompute()).find(each => each.key === item.brand + '|' + spParentOf(item));
    const body = kp.querySelector ? kp.querySelector('.sp-side-b') : null;
    const top = body ? body.scrollTop : 0;
    kp.innerHTML = spKidHtml(item, g);
    const again = kp.querySelector ? kp.querySelector('.sp-side-b') : null;
    if (again) again.scrollTop = top;
    if (kp.setAttribute) kp.setAttribute('data-sp-card', item.key);
  }
}

/* ----- fix: ONE path for one child, a season row's "Fix all" and anything that plugs in later ----- */
// Something would change on Amazon: Item Highlights or the hidden search words (the title never).
const spChanges = item => (item.kwAfter != null && item.kwAfter !== item.kw) || spHlChanged(item);
// The patches one listing's fix sends: the hidden search words and Item Highlights, when they change — never the title.
function spPatches(item) {
  const patches = [];
  if (item.kwAfter != null && item.kwAfter !== item.kw) patches.push({ op: 'replace', path: '/attributes/generic_keyword', value: [{ value: item.kwAfter, language_tag: 'en_US' }] });
  // Item Highlights: every entry (one text or several), or taken away when nothing is left
  if (spHlChanged(item)) patches.push(item.hlAfter.length ? { op: 'replace', path: '/attributes/' + SP_HL_ATTR, value: item.hlAfter.map(value => ({ value, language_tag: 'en_US' })) }
    : { op: 'delete', path: '/attributes/' + SP_HL_ATTR });
  return patches;
}
/** THE ONE FIX FUNCTION. `keys`: the listings ("brand|sku"); `seasonId`: only that season (a parent's season row), or '' for every season
 *  each listing misses. The ready ones go to the confirm window (Amazon checks each, then it is sent); the others are named with their
 *  reason ("need your OK"). The test site sends nothing. Returns { todo, held } — what would go and what waits. */
function spFixSeasons(keys, seasonId) {
  const items = spCompute().filter(item => keys.includes(item.key));
  const todo = [];
  const held = [];
  items.forEach(item => {
    const plan = seasonId ? spPlanFor(item, seasonId) : item;
    if (plan.status === 'ready' && plan.pt && spChanges(plan)) todo.push({ item: plan, patches: spPatches(plan) });
    else if (plan.kind === 'add' || plan.kind === 'check') held.push({ sku: plan.sku, brand: plan.brand, why: plan.status === 'reading' ? 'still reading it from Amazon' : plan.why || 'nothing safe to add' });
  });
  if (!todo.length) {
    SP.result = { results: [], held };
    spRedrawAll();
    return { todo, held };
  }
  const n = todo.length;
  const test = spIsTest();
  const word = seasonId ? (spActive(spCfg(), spToday()).find(e => e.ev.id === seasonId) || { ev: { name: '' } }).ev.name : '';
  const body = `<div class="sp-m-h"><b>${test ? 'Test site — not sent to Amazon' : `You are about to change ${spPlural(n, 'listing')} on Amazon${word ? ` (${lrEsc(word)})` : ''}`}</b>`
    + `<p>${test ? 'On live Sellora this would send what is listed below.' : 'Only Item Highlights and the hidden search words change — never the title. Amazon checks each one first.'}</p>`
    + (held.length ? `<p>${spPlural(held.length, 'more listing')} need${held.length === 1 ? 's' : ''} your OK and ${held.length === 1 ? 'is' : 'are'} not in this list.</p>` : '') + '</div>'
    + `<div class="sp-m-list">${todo.map(t => `<div class="sp-m-row"><b>${lrEsc(spFacts(t.item))}</b><small>${lrEsc(t.item.sku)}</small>${spModalLines(t.item)}</div>`).join('')}</div>`
    + `<div class="sp-m-a"><button type="button" class="sp-main" id="spSendBtn">${test ? 'Close — not sent to Amazon' : `Send ${spPlural(n, 'listing')}`}</button><button type="button" class="sp-btn" id="spCancelBtn">Cancel</button></div>`;
  spModal(body);
  $('spCancelBtn').onclick = () => spModal('');
  $('spSendBtn').onclick = () => {
    if (test) {
      SP.result = { test: true, results: todo.map(t => ({ ok: true, sku: t.item.sku, brand: t.item.brand })), held };
      spModal('');
      return spRedrawAll();
    }
    spSendAll(todo, held);
  };
  if ($('spSendBtn').focus) $('spSendBtn').focus();
  return { todo, held };
}
// One listing (its child panel, its row's Fix): every season it misses.
const spApprove = keys => spFixSeasons(keys, '');
// The confirm window's lines for one listing: what is added (and taken out) in the two places.
function spModalLines(item) {
  const out = [];
  if (spHlChanged(item)) out.push(`<div class="sp-m-now">Item Highlights: ${spDiffHtml(item.hl.join(' · '), item.hlAfter.join(' · '))}</div>`);
  if (item.kwAdd && item.kwAdd.length) out.push(`<div class="sp-m-kw">+ Hidden search words: ${lrEsc(item.kwAdd.join(' '))}</div>`);
  const gone = (item.removed.hl || []).concat(item.removed.kw || []);
  if (gone.length) out.push(`<div class="sp-m-kw">− Old season words: ${lrEsc([...new Set(gone)].join(', '))}</div>`);
  return out.join('');
}
function spModal(html) {
  const modal = $('spModal');
  if (!modal) return;
  if (!html) {
    modal.classList.add('hide');
    $('spModalBox').innerHTML = '';
    return;
  }
  $('spModalBox').innerHTML = html;
  modal.classList.remove('hide');
}
// Send one by one through the existing path (Amazon's check first, then the real change, logged by the backend), with a progress bar;
// then record each one sent with its OLD values (listingrules/seasonlog).
async function spSendAll(todo, held) {
  SP.sending = { done: 0, total: todo.length };
  const bar = () => `<div class="sp-m-h"><b>Sending ${spNf(SP.sending.done)} of ${spNf(SP.sending.total)}…</b><p>Amazon checks each one first. Please keep this window open.</p></div><div class="sp-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${SP.sending.total}" aria-valuenow="${SP.sending.done}"><span style="width:${Math.round(SP.sending.done * 100 / SP.sending.total)}%"></span></div>`;
  spModal(bar());
  const results = [];
  const records = [];
  const now = Date.now();
  for (const t of todo) {
    const item = t.item;
    let reply;
    try {
      reply = await imPost({ lfix: 'patch', brand: item.brand, sku: item.sku, productType: item.pt, patches: t.patches, apply: true, by: ME.email });
    } catch (e) {
      reply = { ok: false, error: String((e && e.message) || e) };
    }
    if (reply.ok && !reply.previewOnly) {
      results.push({ ok: true, sku: item.sku, brand: item.brand });
      records.push({ brand: item.brand, sku: item.sku, asin: item.asin, kind: 'add', seasons: item.add.filter(e => !item.only || e.ev.id === item.only).map(e => e.ev.id), at: now, by: (typeof ME !== 'undefined' && ME.email) || '',
        before: Object.assign({ title: item.title, kw: item.kw }, item.hl ? { hl: item.hl.slice() } : {}),
        after: Object.assign({ title: item.title, kw: item.kwAfter != null ? item.kwAfter : item.kw }, item.hl ? { hl: (item.hlAfter || item.hl).slice() } : {}), sub: reply.submissionId || '' });
      // what was sent is now what the listing holds, as far as every screen knows (the title is untouched)
      if (typeof liWsEntry === 'function') {
        const entry = liWsEntry(item.brand, item.sku);
        Object.assign(entry, { at: now, err: '', cErr: '' });
        if (item.kwAfter != null && item.kwAfter !== item.kw) Object.assign(entry, { kw: item.kwAfter.slice(0, 300), kwBytes: lrKwBytes(item.kwAfter) }, entry.cAt ? { cAt: now } : {});
        if (spHlChanged(item)) Object.assign(entry, { hl: item.hlAfter.slice(), hlAt: now });
        LI_WS.liveV++;
        if (typeof liWsStoreSave === 'function') liWsStoreSave();
      }
    } else {
      const raw = String(reply.error || 'Amazon did not accept it').replace(/^Amazon would reject this:\s*/i, '');
      results.push({ ok: false, sku: item.sku, brand: item.brand, why: spPlainReason(raw), todo: spTodo(raw) });
    }
    SP.sending.done++;
    spModal(bar());
  }
  const logErr = records.length ? await spLogAdd(records) : '';
  SP.sending = null;
  SP.result = { results, held: held || [], logErr };
  spModal('');
  spRedrawAll();
}
// After a fix: "N fixed · M need your OK (reason)", and what Amazon did not accept, in plain words.
function spResultHtml(res) {
  const okN = res.results.filter(r => r.ok).length;
  const bad = res.results.filter(r => !r.ok);
  const held = res.held || [];
  const reasons = [...new Set(held.map(h => h.why))];
  const heldText = held.length ? `${spNf(held.length)} need your OK (${lrEsc(reasons.slice(0, 2).join('; '))}${reasons.length > 2 ? '…' : ''})` : '';
  const head = res.test ? `<b>Test site — not sent to Amazon.</b> ${spNf(okN)} would be fixed${heldText ? ' · ' + heldText : ''}`
    : [`<span class="sp-res-ok">✓ ${spNf(okN)} fixed</span>`, heldText ? `<span class="sp-res-no">${heldText}</span>` : '', bad.length ? `<span class="sp-res-no">✕ ${spNf(bad.length)} not accepted</span>` : ''].filter(Boolean).join(' · ');
  return `<div class="card sp-result${bad.length || held.length ? ' has-bad' : ''}" role="status"><div class="sp-res-h">${head}${okN && !res.test ? ' <small>Amazon usually shows the changes within a few hours.</small>' : ''}</div>`
    + bad.map(r => `<div class="sp-res-bad">✕ <b>${lrEsc(r.sku)}</b> was not accepted: ${lrEsc(r.why)} — what to do: ${lrEsc(r.todo)} <button type="button" class="sp-btn sp-small" data-lr-fix="lerr|${lrEsc(r.brand)}|${lrEsc(r.sku)}">Open in Listing Errors</button></div>`).join('')
    + (res.logErr ? `<div class="sp-res-bad">⚠ The change was sent, but the note of the old words could not be saved (${lrEsc(res.logErr)}) — keep a copy of the old words.</div>` : '')
    + '<button type="button" class="sp-link" data-sp-act="result-close">Close</button></div>';
}
// Amazon's reason, in plain words where its wording is known.
function spPlainReason(text) {
  const t = String(text || '');
  if (/characters or less/i.test(t)) return 'the title is longer than Amazon allows for this kind of product';
  if (/not a valid value|approved value/i.test(t)) return 'a value on the listing is not one Amazon accepts';
  if (/different from what's already in the Amazon catalog/i.test(t)) return "the title differs from what Amazon's catalogue already holds, so Amazon keeps its own";
  if (/Backend not configured|Saving is off/i.test(t)) return t;
  return t.length > 220 ? t.slice(0, 219).replace(/\s+\S*$/, '') + '…' : t;
}
const spTodo = text => (/different from what's already in the Amazon catalog/i.test(String(text)) ? 'ask Seller Support to update the catalogue, or leave this title as it is'
  : /characters or less/i.test(String(text)) ? 'shorten the title in Listing Errors and try again' : 'open Listing Errors for this listing and do what Amazon asks');
// Redraw wherever the planner is showing: the page and its two panels.
function spRedrawAll() {
  SP.itemsKey = '';
  if (SP.on) spRender();
  spPanelsRender();
}

/* ----- opening the planner: the pill on the Listing Optimiser ----- */
async function spOn() {
  SP.on = true;
  try { localStorage.setItem(SP_STORE_VIEW, 'season'); } catch (e) { /* no storage */ }
  const pane = $('spPane');
  const one = $('loOne');
  if (pane) pane.classList.remove('hide');
  if (one) one.classList.add('hide');
  $('spSwitch').querySelectorAll('[data-sp-view]').forEach(btn => { const on = btn.dataset.spView === 'season'; btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); });
  if (!H_LOADED || !SP.log) {
    SP.loading = true;
    SP.loadErr = '';
    spRender();
    try {
      if (!H_LOADED) await ensureHealth();
      if (typeof liWsStoreLoad === 'function' && !LI_WS.stored) liWsStoreLoad();
      await spLogLoad();
    } catch (e) {
      SP.loadErr = String((e && e.message) || e);
    }
    SP.loading = false;
  }
  spRender();
  if (!SP.checkStarted && !SP.loadErr && H_LOADED) spCheckAll();   // "Check all parents" starts once by itself, in the background
}
function spOff() {
  SP.on = false;
  try { localStorage.setItem(SP_STORE_VIEW, 'one'); } catch (e) { /* no storage */ }
  const pane = $('spPane');
  const one = $('loOne');
  if (pane) pane.classList.add('hide');
  if (one) one.classList.remove('hide');
  $('spSwitch').querySelectorAll('[data-sp-view]').forEach(btn => { const on = btn.dataset.spView === 'one'; btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); });
}
// The pill last chosen comes back when the tab opens.
function spMaybeOpen() {
  let view = 'one';
  try { view = localStorage.getItem(SP_STORE_VIEW) || 'one'; } catch (e) { /* no storage */ }
  if (view === 'season' && !SP.on) spOn();
}

/* ----- wiring ----- */
if (typeof document !== 'undefined' && document.addEventListener && $('spSwitch') && $('spSwitch').addEventListener) {
  $('spSwitch').addEventListener('click', e => {
    const btn = e.target.closest ? e.target.closest('[data-sp-view]') : null;
    if (!btn) return;
    if (btn.dataset.spView === 'season') spOn();
    else { spPanelsClose(); spOff(); }
  });
  // The planner comes back on its own when the Listing Optimiser tab opens with "Season planner" last chosen; its panels close when the
  // tab goes away.
  const pane = $('paneOpt');
  if (pane && typeof MutationObserver === 'function') new MutationObserver(() => { if (!pane.classList.contains('hide')) spMaybeOpen(); else spPanelsClose(); }).observe(pane, { attributes: true, attributeFilter: ['class'] });
  // Every button of the planner: on the page and in its two panels.
  document.addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-sp-act]') : null;
    if (!el || el.tagName === 'SELECT') return;
    const act = el.dataset.spAct;
    const key = el.dataset.spKey || '';
    const root = el.closest('#spKid') ? $('spKid') : el.closest('#spPanel') ? $('spPanel') : $('spPane');
    const refocus = selector => { const again = root && root.querySelector ? root.querySelector(selector) : null; if (again) again.focus({ preventScroll: true }); };
    if (act === 'help-hide') { try { localStorage.setItem(SP_STORE_HELP, '1'); } catch (x) { /* no storage */ } SP.helpOpen = false; return spRender(); }
    if (act === 'help-show') { try { localStorage.removeItem(SP_STORE_HELP); } catch (x) { /* no storage */ } return spRender(); }
    if (act === 'help-more') { SP.helpOpen = !SP.helpOpen; spRender(); return refocus('[data-sp-act="help-more"]'); }
    if (act === 'brand') { SP.brand = el.dataset.spBrand; SP.shown = SP_PAGE; spRender(); return refocus(`[data-sp-act="brand"][data-sp-brand="${el.dataset.spBrand}"]`); }
    if (act === 'list') { SP.list = el.dataset.spList; SP.shown = SP_PAGE; spRender(); return refocus(`[data-sp-act="list"][data-sp-list="${el.dataset.spList}"]`); }
    if (act === 'more') { SP.shown += SP_PAGE; return spRender(); }
    if (act === 'show-done') { SP.showDone = !SP.showDone; spRender(); return refocus('[data-sp-act="show-done"]'); }
    if (act === 'reload') { H_LOADED = false; return spOn(); }
    if (act === 'check-all') { spCheckAll(); return refocus('.sp-checkall'); }
    if (act === 'result-close') { SP.result = null; return spRedrawAll(); }
    if (act === 'open-parent') return spOpenParent(el.dataset.spGroup);
    if (act === 'close-parent') return spCloseParent(true);
    if (act === 'open-kid') return spOpenKid(key);
    if (act === 'close-kid') return spCloseKid(true);
    if (act === 'skip') {
      const item = spCompute().find(each => each.key === key);
      if (!item) return;
      spSkips()[item.key + '|' + item.kind + ':' + item.seasons.join('+')] = Date.now();
      spSkipSave();
      spCloseKid(false);
      return spRedrawAll();
    }
    if (act === 'fixhand') {
      const item = spCompute().find(each => each.key === key);
      if (!item) return;
      // the title is never suggested; the hidden search words are, when the plan changes them
      if (typeof LC_PREFILL !== 'undefined') LC_PREFILL = { brand: item.brand, sku: item.sku, title: '', kw: item.kwAfter != null && item.kwAfter !== item.kw ? item.kwAfter : null, hint: item.hint || item.why, done: false };
      spPanelsClose();
      if (typeof lrFixOpen === 'function') lrFixOpen('lerr', item.brand, item.sku, []);
      return;
    }
    // One child: its own approval (Ready or Needs your OK). A row's Fix: that Ready child only.
    if (act === 'to-health') {
      const item = spCompute().find(each => each.key === key);
      if (!item) return;
      spPanelsClose();
      if (typeof showTab === 'function') showTab('health');
      if (typeof liWsOff === 'function') liWsOff();
      if (typeof hFocusOpen === 'function') hFocusOpen(item.brand, spParentOf(item));
      if (typeof lkOpen === 'function') setTimeout(() => lkOpen(item.key), 0);
      return;
    }
    if (act === 'approve') return spApprove([key]);
    if (act === 'row-fix') { const item = spCompute().find(each => each.key === key); return item && item.status === 'ready' ? spApprove([key]) : undefined; }
    // A season row: show its children (and all of them); Fix all = that season for every child of the parent that misses it — the ONE
    // fix path; the ones that cannot be done safely are named with their reason.
    if (act === 'season-more' || act === 'season-all') {
      if (!SP.panel) return;
      const set = act === 'season-more' ? (SP.panel.open = SP.panel.open || new Set()) : (SP.panel.all = SP.panel.all || new Set());
      if (act === 'season-more' && set.has(el.dataset.spId)) set.delete(el.dataset.spId); else set.add(el.dataset.spId);
      return spPanelsRender();
    }
    if (act === 'fix-season') {
      const g = spGroupOf(el.dataset.spGroup);
      const r = g ? spSeasonRows(g).find(each => each.e.ev.id === el.dataset.spId) : null;
      return r ? spFixSeasons(r.kids.map(item => item.key), el.dataset.spId) : undefined;
    }
  });
  // The cards and rows that are not buttons (role="button") open on Enter or Space, like a button.
  document.addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target || !e.target.dataset || !e.target.dataset.spAct || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    e.target.click();
  });
  // Esc: the confirm window first, then the child panel, then the parent panel — the keyboard goes back to where it came from.
  // ↑ / ↓ in a child panel: the previous / next child.
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', e => {
    const typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '');
    const modalOpen = $('spModal') && !$('spModal').classList.contains('hide');
    if (e.key === 'Escape') {
      if (modalOpen) { if (!SP.sending) spModal(''); e.preventDefault(); e.stopPropagation(); return; }
      if (SP.kid) { spCloseKid(true); e.preventDefault(); e.stopPropagation(); return; }
      if (SP.panel) { spCloseParent(true); e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && SP.kid && !typing && !modalOpen) {
      e.preventDefault();
      e.stopPropagation();
      spKidMove(e.key === 'ArrowDown' ? 1 : -1);
    }
  }, true);
  // The search box (a quarter second after typing stops), and the Edit box (checks again as you type).
  let spQT = 0;
  document.addEventListener('input', e => {
    const t = e.target;
    if (!t) return;
    if (t.id === 'spQ') {
      clearTimeout(spQT);
      spQT = setTimeout(() => { SP.q = t.value; SP.shown = SP_PAGE; spRender(); const again = $('spQ'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } }, 250);
      return;
    }
  });
  if ($('spModal')) $('spModal').addEventListener('click', e => { if (e.target === $('spModal') && !SP.sending) spModal(''); });
}
