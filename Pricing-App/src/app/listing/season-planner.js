/* ================= LISTING · SEASON PLANNER (Seasonal Title Optimiser): which titles should gain or lose a season word, and sending them =================
 * Screens: Listing Optimiser (tab 'opt') → the "Season planner" pill beside "Review one ASIN" (#spPane); and the "Season" tab of the
 *          Workspace side panel (listing-workspace.js asks spPanelHtml for one parent). Written for a seller, not a developer: plain
 *          words everywhere, one main button per card, a confirm window before anything is sent, and nothing lost (the old title is
 *          always kept).
 * Does: for every listing in the Listing Health snapshot, from the title Amazon shows (the live read first) and the Listing Rules
 *       season calendar: ADD the occasions in season now (when the product's title template carries {occasions}), REMOVE occasion
 *       words whose season is over, and PUT BACK the old title after a season change this planner sent. The suggested title only
 *       ever removes those words or inserts the occasion names where the template puts them — brand, product, size, colour,
 *       material and pattern come from the title Amazon shows and are never written in. When the words do not fit in 75 letters
 *       they go to the hidden search words instead (within Amazon's limit). Every suggestion carries the same checks; Send is
 *       disabled until they all pass. Sending goes through the existing path (POST lfix=patch: Amazon checks the change first,
 *       then sends, and logs it), one listing at a time with a progress bar; what was sent is recorded with the OLD title in
 *       listingrules/seasonlog (the backend's own log keeps no old values), so "Put back" always knows the original.
 * Screens, three levels: the page (spRender: one card per parent), a parent's side panel (#spPanel, spParentPanelHtml — the sentence,
 *       three state cards with one button each, the children as rows) and a child's side panel (#spKid, spKidHtml — Problem, Why it
 *       matters, What we'll do, What changes, Checks, and the action bar). Esc closes the child first, then the parent.
 * Main functions: spCompute (every listing's plan), spPlan (one listing), spChecks (the ✓ list), spWordDiff (word sets, not positions),
 *                 spRender / spParentBodyHtml / spKidHtml / spPanelHtml (the screens), spApprove / spSendAll (the confirm window and the
 *                 send), spAfterRead (redraw when reads land).
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
  reading: new Set(),        // "brand|sku" queued for a content read from Amazon
  redrawT: 0,                // the debounced redraw for landed reads
  sending: null,             // { done, total, results } while titles are sent
  panel: null,               // the parent side panel: { key: "brand|parent", filter: '' | 'look' | 'fix', ws }
  kid: null,                 // the child side panel: { key: "brand|sku", from: 'page' | 'ws' }
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

/* ----- one listing's plan ----- */
/**
 * What this listing needs: { key, brand, sku, asin, row, name, title, kw, kwMax, pt, live, fits, add: [ev], soon: [ev], remove: [ev],
 * restore: record|null, seasons: [ids], kind: 'add'|'remove'|'restore'|'ok'|'none', after, kwAfter, kwWords, checks, status, why, note }.
 * `status`: ready | look | no | reading | ok. Only `ready` can be sent. `title` is the title Amazon shows (the live read first).
 */
function spPlan(row, ctx, today, log) {
  const cfg = ctx.cfg;
  const brand = row.brand;
  const key = spKey(brand, row.sku);
  const fresh = lrFresh(row, ctx);
  const live = lrLiveOf(row, ctx);
  const title = hTitleText(fresh) || '';
  const liveFresh = !!(live && live.cAt && Date.now() - live.cAt < LR_DAY);
  const kw = live && live.cAt ? String(fresh.kw || '') : null;        // the hidden search words are only ever known from the live read
  const kwMax = (() => { const rule = (cfg.issues || []).find(issue => issue.detector === 'keyword_bytes' && issue.on !== false); return rule ? (+(rule.params || {}).max || 249) : 249; })();
  const cat = lrCatOf(row);
  const tpl = lrTemplateFor(row, cfg);
  const fits = !!(tpl && /\{occasions\}/.test(String(tpl.template || '')));
  const protect = String((cat && cat.subcat) || '') + ' ' + String((cat && cat.color) || '');
  const events = spEvents(cfg, today);
  const keep = e => lrWords(e.ev.except).some(word => lrHas(protect, word));   // the product IS the occasion: its title may always say so
  const inTitle = e => !!title && lrWords(e.ev.words).some(word => lrHas(title, word));
  const applies = e => spApplies(e.ev, cat, title);                              // a home product (or one the event names): clothing is left out
  // Only a season word used as an occasion is ever taken out; one that describes the product stays (spSeasonUse).
  const remove = events.filter(e => inTitle(e) && !e.s.inSeason && !keep(e) && applies(e) && spSeasonUse(title, e.ev) === 'use');
  // ONE product season at a time: the active one the title will keep the longest (most days left in its window; ties → the nearest).
  // Sale days (Black Friday, Cyber Monday, Prime Day …) are promotions, never product words: never suggested anywhere.
  const product = events.filter(e => !e.ev.removeOnly && !spIsSale(e.ev) && fits && applies(e) && !keep(e) && !inTitle(e) && e.s.inSeason)
    .sort((a, b) => (b.s.to - a.s.to) || (a.s.next - b.s.next));
  const chosen = SP.choice.get(key);
  const main = product.find(e => e.ev.id === chosen) || product[0] || null;
  const alts = product.filter(e => e !== main);
  // --- put back: the newest change this planner sent for the listing whose seasons are all over, and that was not put back since ---
  const mine = (log || []).filter(rec => rec.brand === brand && rec.sku === row.sku);
  const last = mine[0] || null;
  let restore = null;
  if (last && last.kind !== 'restore' && last.seasons && last.seasons.length) {
    const over = last.seasons.every(id => { const e = events.find(each => each.ev.id === id); return !e || !e.s.inSeason; });
    if (over) restore = last;
  }
  const item = { key, brand, sku: row.sku, asin: row.asin || '', row, name: title || row.title || '', title, kw, kwMax, pt: live && live.pt ? live.pt : '',
    live, liveFresh, fits, add: main ? [main] : [], alts, remove: restore ? [] : remove, restore, seasons: [], kind: 'none', after: title, kwAfter: kw, kwWords: [],
    checks: [], status: 'ok', why: '', note: '', changes: [], hint: '', readErr: live && (live.cErr || live.err) ? String(live.cErr || live.err) : '' };
  const word = main ? main.ev.name : '';
  if (restore) {
    item.kind = 'restore';
    item.seasons = restore.seasons.slice();
    if (!restore.before || !restore.before.title) {
      // the old title was not kept: the next best thing is the title as it is with the season words taken out — the person says OK
      let stripped = title;
      restore.seasons.forEach(id => { const e = events.find(each => each.ev.id === id); if (e) stripped = spStrip(stripped, e.ev.words); });
      item.after = stripped;
      item.note = 'The old title was not kept in the change record, so this only takes the season words out of the title as it is now.';
      item.forceLook = true;
      if (!title || stripped === title) return spFix(item, 'the old title was not kept in the change record — put it back by hand', '');
      return spFinish(item, ctx, today);
    }
    item.after = String(restore.before.title);
    item.kwAfter = restore.before.kw != null ? String(restore.before.kw) : kw;
    if (title && restore.after && restore.after.title && title !== restore.after.title) {
      item.note = `The title changed since the planner sent it (it was sent as “${restore.after.title}”) — look before putting back.`;
      item.forceLook = true;
    }
    return spFinish(item, ctx, today);
  }
  if (!main && !remove.length) return item;                       // nothing for the seasons on now
  item.kind = main ? 'add' : 'remove';
  item.seasons = (main ? [main] : []).concat(remove).map(e => e.ev.id);
  if (!title) {
    if (!live || (!live.cAt && !item.readErr)) { item.status = 'reading'; item.why = 'reading this title from Amazon first'; return item; }
    return spFix(item, item.readErr ? `Amazon could not be read for this listing (${item.readErr})` : (row.title && String(row.title).length === 60 ? 'only the first 60 letters of this title were saved' : 'we do not have this title yet'),
      word ? `Add “${word}” to the title if it fits 75 letters, else to the hidden search words.` : `Take ${remove.map(e => '“' + e.ev.name + '”').join(', ')} out of the title.`);
  }
  // --- the suggestion: take the old words out, put the one season word in — in the title when it fits, else make room elsewhere ---
  let next = title;
  remove.forEach(e => { next = spStrip(next, e.ev.words); });
  item.after = spTidy(next);
  let placed = '';
  if (word) {
    const out = spInsert(next, [word]);
    if (out.length <= SP_TITLE_MAX) { item.after = out; placed = 'title'; }
    else if (kw == null) {
      item.kwWords = [word];
      if (item.readErr) return spFix(item, `the title is full and Amazon could not be read for the hidden search words (${item.readErr})`, `Add “${word}” to the hidden search words.`);
      item.status = 'reading';
      item.why = 'the title is full, so the word goes to the hidden search words — reading those from Amazon first';
      return item;
    } else {
      // a. the hidden search words: already there? else drop what is wasted (words the title says, repeats, fillers, out-of-season) and add it
      const asIs = (kw.trim() ? kw.trim() + ' ' : '') + word;
      if (lrHas(kw, word)) { item.kwAfter = kw; placed = 'kw-has'; item.note = `“${word}” is already in the hidden search words.`; }
      else if (lrKwBytes(asIs) <= kwMax) {
        item.kwAfter = asIs;
        item.kwWords = [word];
        placed = 'kw';
        item.note = `The title is full, so we added “${word}” to the hidden search words instead (the safest place).`;
      } else {
        const clean = spKwClean(kw, item.after, events, keep);
        const tryKw = clean.words.concat([word]).join(' ');
        if (lrKwBytes(tryKw) <= kwMax) {
          item.kwAfter = tryKw;
          item.kwWords = [word];
          placed = 'kw';
          if (clean.removed) {
            item.note = `Removed ${spPlural(clean.removed, 'word')} (${clean.whyText}) from the hidden search words to make room for “${word}” (now ${spNf(lrKwBytes(tryKw))} of ${spNf(kwMax)}).`;
            item.changes.push({ what: 'Hidden search words', from: kw, to: tryKw });
            item.forceLook = true;
          } else item.note = `The title is full, so we added “${word}” to the hidden search words instead (the safest place).`;
        } else {
          // b. the title: replace ONE low-value word (a repeat, or a shape the size already tells)
          const swap = spSwap(item.after, word, item, cfg, tpl);
          if (swap && swap.title.length <= Math.max(SP_TITLE_MAX, item.after.length)) {   // never longer than it already was
            item.changes.push({ what: 'Title', from: item.after, to: swap.title, why: `“${swap.removed}” replaced by “${word}” — ${swap.why}` });
            item.after = swap.title;
            item.note = `Replaced “${swap.removed}” with “${word}” in the title (${swap.why}).`;
            item.forceLook = true;
            item.swapped = swap.removed;
            item.swapWhy = swap.why;
            placed = 'swap';
          } else {
            const over = lrKwBytes(tryKw) - kwMax;
            item.kwAfter = tryKw;
            return spFix(item, `the title is full and the hidden search words are full too (${spNf(lrKwBytes(kw))} of ${spNf(kwMax)})`,
              `Shorten the hidden search words by ${spPlural(over, 'letter')}, then add “${word}”.`);
          }
        }
      }
    }
  }
  if (!placed && word && !remove.length && item.after === title && (item.kwAfter == null || item.kwAfter === kw)) item.kind = 'none';
  item.place = placed;                                 // title | kw | kw-has | swap | '' — where the season word went (the screens say it)
  return spFinish(item, ctx, today);
}
// Nothing changed: up to date. Else run the checks; a check that fails means "Fix by hand" (the suggestion goes to Listing Errors).
function spFinish(item, ctx, today) {
  if (item.after === item.title && (item.kwAfter == null || item.kwAfter === item.kw)) {
    if (item.kind === 'restore') return spFix(item, 'the old title is the same as the title on Amazon now', '');
    item.kind = 'ok';
    item.status = 'ok';
    return item;
  }
  item.checks = spChecks(item.title, item.after, item.row, ctx, today, { kwAfter: item.kwAfter, kwMax: item.kwMax, added: item.kwWords });
  const bad = item.checks.find(check => check.ok === false);
  const warn = item.checks.find(check => check.ok === 'warn');
  if (bad) return spFix(item, bad.why || bad.t, `Change the title by hand: ${bad.why || bad.t}.`);
  if (!item.pt) {
    if (item.live && item.live.cAt) return spFix(item, 'Amazon did not say what kind of product this is, so the change cannot be sent from here', 'Send the change from Listing Errors.');
    if (item.readErr) return spFix(item, `Amazon could not be read for this listing (${item.readErr})`, 'Send the change from Listing Errors.');
    item.status = 'reading';
    item.why = 'reading this listing from Amazon first (the product kind is needed to send)';
    return item;
  }
  item.status = warn || item.forceLook ? 'look' : 'ready';
  return item;
}
// "Fix by hand": the card keeps its suggestion and a one-line hint, and its button opens Listing Errors with the boxes filled in.
function spFix(item, why, hint) {
  item.status = 'fix';
  item.why = why;
  item.hint = hint;
  return item;
}
// Sale days are promotions, not product words.
const spIsSale = ev => /black friday|cyber monday|prime day|\bsale\b|\bdeal/i.test(String(ev.name || '') + ' ' + String(ev.id || ''));
// Does this calendar event apply to the listing? Its own `products`, else the home products — found in the sub-category or the title.
function spApplies(ev, cat, title) {
  const text = String((cat && cat.subcat) || '') + ' ' + String(title || '');
  return lrWords(ev.products || SP_HOME).some(word => lrHas(text, word));
}
/** How an event's word is used in a title: 'use' (an occasion or time of use — may be judged), 'product' (describes the product — never
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
      const use = SP_BEFORE.has(before) || SP_USE.has(after) || !rest || rest.startsWith('-') || rest.startsWith('–') || nextIsSeason || (after === 'and' || after === '&');
      if (use) return 'use';
      found = 'product';
    }
  }
  return found;
}
// The hidden search words with the waste taken out: words the title already says, repeats, fillers, out-of-season words.
function spKwClean(kw, title, events, keep) {
  let text = String(kw || '');
  let season = 0;
  events.forEach(e => {
    if (e.s.inSeason || keep(e)) return;
    const stripped = spStrip(text, e.ev.words);
    if (stripped !== text) { season++; text = stripped; }
  });
  const inTitle = new Set(spWords(title).map(w => lrNorm(w)));
  const seen = new Set();
  const words = [];
  let dup = 0;
  let said = 0;
  let filler = 0;
  text.split(/[\s;,.]+/).filter(Boolean).forEach(tok => {
    const w = lrNorm(tok);
    if (!w) return;
    if (SP_FILLER.has(w)) { filler++; return; }
    if (inTitle.has(w)) { said++; return; }
    if (seen.has(w)) { dup++; return; }
    seen.add(w);
    words.push(tok);
  });
  const parts = [dup ? spPlural(dup, 'repeat') : '', said ? `${said} the title already says` : '', filler ? spPlural(filler, 'filler word') : '', season ? `${season} out of season` : ''].filter(Boolean);
  return { words, removed: dup + said + filler + season, whyText: parts.join(', ') };
}
// ONE low-value word in the title that the season word may replace: a repeated word, or a shape word the size already tells. Never
// the brand, the product, the size, the colour, the material or the pattern. Null when there is none.
function spSwap(title, word, item, cfg, tpl) {
  const tokens = String(title).split(' ');
  const protect = new Set([].concat(lrBrandWords(item.row, cfg), spWords(tpl ? tpl.product : ''), spWords(tpl ? tpl.material : ''), spWords(tpl ? tpl.pattern : ''),
    spWords(lrColorOf(item.row)), ['cotton', 'linen', 'polyester', 'jute', 'velvet', 'block', 'print', 'hand', 'embroidered', 'embroidery', 'printed', 'inch', 'inches', 'cm', 'x', '-'], [...SP_FILLER])
    .map(w => lrNorm(w)).filter(Boolean));
  const sizes = hTitleSizes(title).map(s => s.text);
  const inSize = i => sizes.some(s => s.split(/\s+/).map(lrNorm).includes(lrNorm(tokens[i])));
  const norm = tokens.map(t => lrNorm(t));
  const counts = {};
  norm.forEach(w => { if (w) counts[w] = (counts[w] || 0) + 1; });
  let at = -1;
  let why = '';
  for (let i = tokens.length - 1; i >= 0; i--) {
    const w = norm[i];
    if (!w || w.length < 3 || /^\d/.test(w) || inSize(i) || SP_FILLER.has(w)) continue;
    if (counts[w] >= 2) { at = i; why = 'it was in the title twice'; break; }   // a repeat may go even when the word itself is protected: one copy stays
  }
  if (at < 0 && sizes.length) {
    at = tokens.findIndex((t, i) => /^(Rectangle|Rectangular|Round|Square|Oval)$/i.test(t) && !inSize(i));
    if (at >= 0) why = 'the size already says it';
  }
  if (at < 0) return null;
  const removed = tokens[at];
  const out = tokens.slice();
  out[at] = word;
  return { title: spTidy(out.join(' ')), removed, why };
}

/** The same ✓ list for every suggested title (and for a title typed in Edit): [{ k, t, ok: true | false | 'warn', why }].
 *  `ok: false` blocks sending; 'warn' is "⚠ Needs a look" and shows beside the button. */
function spChecks(before, after, row, ctx, today, opts) {
  opts = opts || {};
  const cfg = ctx.cfg;
  const out = [];
  const push = (k, t, ok, why) => out.push({ k, t, ok, why: why || '' });
  const was = String(before || '');
  const now = String(after || '').trim();
  // 1 Within 75 letters (never made longer than it already was)
  if (now.length <= SP_TITLE_MAX) push('len', `Within ${SP_TITLE_MAX} letters (${now.length} of ${SP_TITLE_MAX})`, true);
  else if (was.length > SP_TITLE_MAX && now.length <= was.length) push('len', `Longer than ${SP_TITLE_MAX} letters — it already was (${now.length}); not made longer`, 'warn');
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
    else if (badWas) push('size', `Size written another way (“${badNow.text}”, as before)`, 'warn');
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
    else if (atNow.length) push('brand', 'Brand in the title, not at the start (as before)', 'warn');
    else push('brand', 'No brand in the title (as before)', 'warn');
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
  else if (symWas && symWas[0] === symNow[0]) push('sym', `Has “${symNow[0]}”, which Amazon does not allow (as before)`, 'warn');
  else push('sym', `Has “${symNow[0]}”, which Amazon does not allow`, false, `“${symNow[0]}” is not allowed in a title`);
  // 7 No word used 3 times
  const thrice = text => { const n = {}; spWords(text).filter(word => word.length >= 3).forEach(word => { n[word] = (n[word] || 0) + 1; }); return Object.keys(n).find(word => n[word] >= 3) || ''; };
  const threeNow = thrice(now);
  if (!threeNow) push('rep', 'No word used 3 times', true);
  else if (thrice(was) === threeNow) push('rep', `“${threeNow}” is used 3 times (as before)`, 'warn');
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
    else push('kw', `Hidden search words over their limit (${spNf(bytes)} of ${spNf(opts.kwMax || 249)})`, false, 'the hidden search words would be over their limit');
  }
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
  const rows = ['SP', 'CPC'].flatMap(b => ((HEALTH[b] && HEALTH[b].rows) || []).map(row => (row.brand ? row : Object.assign({ brand: b }, row))));
  SP.items = rows.map(row => spPlan(row, ctx, today, SP.log || []));
  SP.itemsKey = key;
  return SP.items;
}
// Which lists a listing is in (the number cards and chips): one title can both lose "Spring" and gain "Christmas", so it counts in
// Add AND Remove; a Put back is only that; Up to date is its own list.
const spInList = (item, k) => (k === 'add' ? item.kind !== 'restore' && item.add.length > 0
  : k === 'remove' ? item.kind !== 'restore' && item.remove.length > 0 : k === 'restore' ? item.kind === 'restore' : k === 'ok' ? item.kind === 'ok' : item.kind !== 'none' && item.kind !== 'ok');
const spSkipped = item => { const skips = spSkips(); return !!skips[item.key + '|' + item.kind + ':' + item.seasons.join('+')]; };
// Reads from Amazon the listings whose plan needs the live read (the hidden search words, the product kind): 20 a call through the
// Workspace's queue, content only. Returns how many were queued.
function spEnsureReads(items) {
  if (typeof liWsQueue !== 'function' || !items.length) return 0;
  if (!LI_WS.stored) liWsStoreLoad();
  const want = items.filter(item => (item.status === 'reading' || (item.kind !== 'ok' && item.kind !== 'none' && !item.liveFresh && !item.readErr))
    && !SP.reading.has(item.key) && !(item.live && item.live.cErr && Date.now() - (item.live.at || 0) < 3600000));
  const byBrand = { SP: [], CPC: [] };
  want.forEach(item => { byBrand[item.brand].push(item.sku); SP.reading.add(item.key); });
  ['SP', 'CPC'].forEach(brand => {
    for (let i = 0; i < byBrand[brand].length; i += LI_WS_BATCH) {
      const skus = byBrand[brand].slice(i, i + LI_WS_BATCH);
      liWsQueue({ t: 'content', brand, skus, units: skus.length, pk: '', mark: skus.map(sku => spKey(brand, sku)), sweep: true });
    }
  });
  return want.length;
}
// A read landed (listing-workspace.js calls this): the planner redraws, a little later and not while a title is being typed.
function spAfterRead() {
  if (!SP.on && !SP.kid && !(typeof LI_WS !== 'undefined' && LI_WS.panel)) return;
  ['SP', 'CPC'].forEach(brand => Object.keys(LI_WS.live[brand] || {}).forEach(sku => {
    const entry = LI_WS.live[brand][sku];
    if (entry && (entry.cAt || entry.cErr || entry.err)) SP.reading.delete(spKey(brand, sku));
  }));
  clearTimeout(SP.redrawT);
  SP.redrawT = setTimeout(() => {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active && active.classList && active.classList.contains('sp-edit')) return spAfterRead();
    if (SP.on) spRender();
    spPanelsRender();
    if (typeof LI_WS !== 'undefined' && LI_WS.panel && LI_WS.panel.tab === 'season' && typeof liWsPanelRender === 'function') liWsPanelRender();
  }, 600);
}

/* ----- the screens: three levels — parent cards on the page, one parent's side panel, one child's side panel -----
 * Written for a seller, not a developer: one sentence says what is going on, every card has ONE main button, every state is an icon
 * and a word (never colour alone), and nothing is sent without the confirm window. */
const SP_ICON = {
  pick: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 7"/></svg>',
  fix: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5z"/></svg>',
};
const SP_LISTS = [
  { k: 'add', t: 'Add season words' },
  { k: 'remove', t: 'Remove old season words' },
  { k: 'restore', t: 'Put old titles back' },
];
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
const spOldWord = (item, e) => lrWords(e.ev.words).find(word => lrHas(item.title, word)) || e.ev.name;

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
function spMarkHtml(text, list, tag) {
  const left = new Map(list.map(x => [x.k, x.n]));
  return String(text || '').split(/(\s+)/).map(part => {
    const k = part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '').toLowerCase();
    if (k && left.get(k) > 0) { left.set(k, left.get(k) - 1); return `<${tag}>${lrEsc(part)}</${tag}>`; }
    return lrEsc(part);
  }).join('');
}
// The new text with only the really new words marked.
const spDiffHtml = (from, to) => spMarkHtml(to, spWordDiff(from, to).added, 'ins');

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
    g.todo = g.all.filter(item => spInList(item, SP.list) && (!SP.season || item.seasons.includes(SP.season)) && !spSkipped(item));
    ['ready', 'look', 'fix', 'reading'].forEach(st => { g[st] = g.todo.filter(item => item.status === st); });
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

/* ----- level 1: the page ----- */
function spHowHtml() {
  let hidden = false;
  try { hidden = localStorage.getItem(SP_STORE_HELP) === '1'; } catch (e) { /* no storage */ }
  if (hidden) return '<div class="sp-how is-folded"><button type="button" class="sp-link" data-sp-act="help-show">How it works</button></div>';
  const step = (n, icon, t, s) => `<div class="sp-step"><span class="sp-step-n">${n}</span><span class="sp-step-i">${SP_ICON[icon]}</span><div><b>${t}</b><small>${s}</small></div></div>`;
  return `<div class="sp-how" role="note"><div class="sp-steps">${step(1, 'pick', 'Pick a season', 'Click a season card below')}${step(2, 'check', 'Check', 'Open a product to see what would change')}${step(3, 'fix', 'Fix', 'Amazon checks each change first; the old words are kept')}</div>`
    + `<div class="sp-how-a"><button type="button" class="sp-q" data-sp-act="help-more" aria-expanded="${SP.helpOpen ? 'true' : 'false'}" aria-label="What does this do?">?</button><button type="button" class="sp-link" data-sp-act="help-hide">Hide</button></div>`
    + (SP.helpOpen ? '<div class="sp-help">This page compares every listing with the season calendar in Listing Rules. When a season is on, it suggests adding its name where shoppers will find it — in the title when there is room, otherwise in the hidden search words. When a season is over, it suggests taking its word out again. You open a product, look at what would change, and press Fix. Amazon checks every change before it goes live, and the old words are kept so you can put them back after the season.</div>' : '')
    + '</div>';
}
// One sentence for today: what is coming, and how many parents it touches.
function spTodayHtml(groups) {
  const todo = groups.flatMap(g => g.todo);
  const top = spTopSeason(todo);
  if (top) {
    const n = groups.filter(g => g.todo.some(item => spSeasonOf(item) && spSeasonOf(item).ev.id === top.e.ev.id)).length;
    return `<p class="sp-today">${spSeasonIcon(top.e.ev.id)} <b>${lrEsc(top.e.ev.name)} ${spSeasonWord(top.e)}.</b> ${spNf(n)} parent${n === 1 ? ' has' : 's have'} listings that don't mention it yet.</p>`;
  }
  const rem = spTopRemove(todo);
  if (rem) {
    const n = groups.filter(g => g.todo.some(item => item.remove.some(e => e.ev.id === rem.e.ev.id))).length;
    return `<p class="sp-today">${spSeasonIcon(rem.e.ev.id)} <b>${lrEsc(rem.e.ev.name)} is over.</b> ${spNf(n)} parent${n === 1 ? ' still has' : 's still have'} listings that mention it.</p>`;
  }
  const back = todo.filter(item => item.kind === 'restore').length;
  if (back) return `<p class="sp-today">↺ <b>A season is over.</b> ${spPlural(back, 'listing')} can go back to ${back === 1 ? 'its' : 'their'} old title.</p>`;
  const next = spEvents(spCfg(), spToday()).filter(e => !e.ev.removeOnly && !e.s.inSeason && e.s.from && spDays(e.s.from, spToday()) < 0).sort((a, b) => a.s.from - b.s.from)[0];
  return `<p class="sp-today">✓ <b>No season changes needed right now.</b>${next ? ` The next season, ${lrEsc(next.ev.name)}, starts on ${spDate(next.s.from)}.` : ''}</p>`;
}
// Season timeline: one card per season in date order; "Add from" and "Remove after", today's place, how many listings it touches.
function spTimelineHtml(items) {
  const today = spToday();
  const events = spEvents(spCfg(), today).filter(e => e.s.next && !spIsSale(e.ev)).sort((a, b) => a.s.next - b.s.next);
  const touches = id => items.filter(item => item.seasons.includes(id) && item.kind !== 'ok' && item.kind !== 'none' && !spSkipped(item) && (SP.brand === 'ALL' || item.brand === SP.brand)).length;
  return '<div class="sp-tl" role="group" aria-label="Seasons">' + events.map(e => {
    const n = touches(e.ev.id);
    const startsIn = e.s.from ? -spDays(e.s.from, today) : 0;
    const state = e.s.inSeason ? 'is-now' : startsIn > 0 && startsIn <= SP_SOON_DAYS ? 'is-soon' : '';
    const when = e.s.inSeason ? `On now · until ${spDate(e.s.to)}` : startsIn > 0 ? `Starts in ${spPlural(startsIn, 'day')}` : 'Over';
    return `<button type="button" class="sp-tlc ${state}${SP.season === e.ev.id ? ' is-on' : ''}${e.ev.removeOnly ? ' is-plain' : ''}" data-sp-act="season" data-sp-id="${lrEsc(e.ev.id)}" aria-pressed="${SP.season === e.ev.id}">`
      + `<b>${spSeasonIcon(e.ev.id)} ${lrEsc(e.ev.name)}</b><span class="sp-tlw">${lrEsc(when)}</span>`
      + `<span class="sp-tld">${e.ev.removeOnly ? 'Remove after' : 'Add from'} <b>${spDate(e.ev.removeOnly ? e.s.to : e.s.from)}</b>${e.ev.removeOnly ? '' : ` · Remove after <b>${spDate(e.s.to)}</b>`}</span>`
      + `<span class="sp-tln">${n ? spPlural(n, 'listing') : 'nothing to do'}</span></button>`;
  }).join('') + '</div>';
}
// One parent card: picture, name, one line — "36 listings · 🎄 30 need “Christmas” · ⚠ 2 need you" — and Open ›. The whole card opens it.
function spParentLine(g) {
  const parts = [spPlural(g.all.length, 'listing')];
  if (!g.todo.length) return parts.concat(['<span class="sp-ok">✓ Up to date</span>']).join(' · ');
  const top = spTopSeason(g.todo);
  if (top) parts.push(`${spSeasonIcon(top.e.ev.id)} ${spNf(top.n)} need “${lrEsc(top.e.ev.name)}”`);
  const rem = spTopRemove(g.todo);
  if (rem) parts.push(`${spSeasonIcon(rem.e.ev.id)} ${spNf(rem.n)} still say “${lrEsc(rem.e.ev.name)}”`);
  const back = g.todo.filter(item => item.kind === 'restore').length;
  if (back) parts.push(`↺ ${spNf(back)} can go back`);
  const you = g.look.length + g.fix.length;
  if (you) parts.push(`<span class="sp-you">⚠ ${spNf(you)} need${you === 1 ? 's' : ''} you</span>`);
  if (g.reading.length) parts.push(`<span class="sp-wait">… ${spNf(g.reading.length)} being read</span>`);
  return parts.join(' · ');
}
function spParentCardHtml(g) {
  const open = SP.panel && SP.panel.key === g.key;
  return `<div class="card sp-pc${open ? ' is-open' : ''}${g.todo.length ? '' : ' is-done'}" role="button" tabindex="0" data-sp-act="open-parent" data-sp-group="${lrEsc(g.key)}" aria-label="Open ${lrEsc(g.name)}">`
    + `${spPic(g.brand, (g.todo[0] || g.all[0]).sku, false)}<div class="sp-pc-t"><b title="${lrEsc(g.name)}">${lrEsc(g.name)}</b><span>${spParentLine(g)}</span></div>`
    + '<span class="sp-pc-open" aria-hidden="true">Open ›</span></div>';
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
  const items = spCompute();
  spEnsureReads(items.filter(item => SP.brand === 'ALL' || item.brand === SP.brand));
  const groups = spGroups(items);
  const todo = groups.filter(g => g.todo.length).sort((a, b) => (b.todo.length - a.todo.length) || a.name.localeCompare(b.name));
  const done = groups.filter(g => !g.todo.length).sort((a, b) => a.name.localeCompare(b.name));
  const page = todo.slice(0, SP.shown);
  const counts = {};
  items.forEach(item => { if ((SP.brand === 'ALL' || item.brand === SP.brand) && !spSkipped(item)) SP_LISTS.forEach(list => { if (spInList(item, list.k)) counts[list.k] = (counts[list.k] || 0) + 1; }); });
  const all = (counts.add || 0) + (counts.remove || 0) + (counts.restore || 0);
  const toolbar = `<div class="card sp-tb"><div class="sp-seg" role="group" aria-label="Brand">${[['ALL', 'Both brands'], ['SP', BRAND_NAME.SP || 'SP'], ['CPC', BRAND_NAME.CPC || 'CPC']].map(([v, t]) => `<button type="button" class="${SP.brand === v ? 'on' : ''}" data-sp-act="brand" data-sp-brand="${v}" aria-pressed="${SP.brand === v}">${lrEsc(t)}</button>`).join('')}</div>`
    + `<label class="sp-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="spQ" value="${lrEsc(SP.q)}" placeholder="Search a product, SKU or ASIN" aria-label="Search"></label></div>`;
  const chips = '<div class="sp-chips">' + [['all', 'Everything to do', all]].concat(SP_LISTS.map(list => [list.k, list.t, counts[list.k] || 0])).map(([k, t, n]) => `<button type="button" class="sp-chip${SP.list === k ? ' is-on' : ''}" data-sp-act="list" data-sp-list="${k}" aria-pressed="${SP.list === k}">${t}<span class="sp-n">${spNf(n)}</span></button>`).join('')
    + (SP.season ? `<button type="button" class="sp-chip is-on" data-sp-act="season" data-sp-id="" aria-pressed="true">${spSeasonIcon(SP.season)} ${lrEsc((spEvents(spCfg(), spToday()).find(e => e.ev.id === SP.season) || { ev: { name: SP.season } }).ev.name)} ✕</button>` : '') + '</div>';
  const empty = !todo.length ? `<div class="card sp-empty"><b>${SP.q || SP.season || SP.list !== 'all' ? 'Nothing here with these filters.' : 'No season changes needed right now.'}</b><br>${SP.q || SP.season || SP.list !== 'all' ? 'Clear the search or the filters above to see everything.' : 'Everything below is up to date.'}</div>` : '';
  const more = todo.length > page.length ? `<div class="sp-foot"><span>${spNf(page.length)} of ${spNf(todo.length)} parents</span><button type="button" class="sp-btn" data-sp-act="more">Show ${spNf(Math.min(SP_PAGE, todo.length - page.length))} more</button></div>` : '';
  const doneHtml = done.length ? `<div class="sp-done"><button type="button" class="sp-link" data-sp-act="show-done" aria-expanded="${SP.showDone ? 'true' : 'false'}">${SP.showDone ? 'Hide' : 'Show'} the ${spNf(done.length)} parent${done.length === 1 ? '' : 's'} that ${done.length === 1 ? 'is' : 'are'} up to date</button>`
    + (SP.showDone ? `<div class="sp-list">${done.map(spParentCardHtml).join('')}</div>` : '') + '</div>' : '';
  const result = SP.result && !SP.panel ? spResultHtml(SP.result) : '';
  box.innerHTML = spHowHtml() + spTodayHtml(groups) + toolbar + spTimelineHtml(items) + chips + result + empty + `<div class="sp-list">${page.map(spParentCardHtml).join('')}</div>` + more + doneHtml;
}
// After a send: what went, what did not and why, in plain words.
function spResultHtml(res) {
  const okN = res.results.filter(r => r.ok).length;
  const bad = res.results.filter(r => !r.ok);
  const head = res.test ? '<b>Test site — nothing was sent.</b>' : [okN ? `<span class="sp-res-ok">✓ ${spNf(okN)} sent</span>` : '', bad.length ? `<span class="sp-res-no">✕ ${spNf(bad.length)} not accepted</span>` : ''].filter(Boolean).join(' · ');
  return `<div class="card sp-result${bad.length ? ' has-bad' : ''}" role="status"><div class="sp-res-h">${head}${okN && !res.test ? ' <small>Amazon usually shows the changes within a few hours.</small>' : ''}</div>`
    + bad.map(r => `<div class="sp-res-bad">✕ <b>${lrEsc(r.sku)}</b> was not accepted: ${lrEsc(r.why)} — what to do: ${lrEsc(r.todo)} <button type="button" class="sp-btn sp-small" data-lr-fix="lerr|${lrEsc(r.brand)}|${lrEsc(r.sku)}">Open in Listing Errors</button></div>`).join('')
    + (res.logErr ? `<div class="sp-res-bad">⚠ The change was sent, but the note of the old words could not be saved (${lrEsc(res.logErr)}) — keep a copy of the old title.</div>` : '')
    + '<button type="button" class="sp-link" data-sp-act="result-close">Close</button></div>';
}

/* ----- level 2: one parent ----- */
// The sentence, the three state cards, and the children as compact rows. Used by the parent side panel and the Workspace's Season tab.
function spParentBodyHtml(g, inWs) {
  const total = g.all.length;
  const products = spProducts((g.todo[0] || g.all[0]).row);
  const top = spTopSeason(g.todo);
  const rem = spTopRemove(g.todo);
  const back = g.todo.filter(item => item.kind === 'restore');
  let sentence;
  if (top) sentence = `${spSeasonIcon(top.e.ev.id)} <b>${lrEsc(top.e.ev.name)} ${spSeasonWord(top.e)}.</b> ${top.n === total ? `None of these ${spNf(total)} ${lrEsc(products)} mention${total === 1 ? 's' : ''} it yet.` : `${spNf(top.n)} of these ${spNf(total)} ${lrEsc(products)} don't mention it yet.`}`;
  else if (rem) sentence = `${spSeasonIcon(rem.e.ev.id)} <b>${lrEsc(rem.e.ev.name)} is over.</b> ${spNf(rem.n)} of these ${spNf(total)} ${lrEsc(products)} still mention it.`;
  else if (back.length) sentence = `↺ <b>The season is over.</b> ${spNf(back.length)} of these ${spNf(total)} ${lrEsc(products)} can go back to their old titles.`;
  else sentence = `✓ <b>Nothing to change here</b> for the seasons on now.`;
  const word = top ? top.e.ev.name : rem ? rem.e.ev.name : '';
  const readyMeaning = top ? `We add “${lrEsc(word)}” safely. Nothing else changes.` : rem ? `We take “${lrEsc(word)}” out safely. Nothing else changes.` : back.length ? 'We put the old titles back. Nothing else changes.' : 'Nothing is waiting.';
  const lookTitle = g.look.some(item => item.after !== item.title);
  const card = (k, n, meaning, btn) => `<div class="sp-sc ${SP_STATE[k].cls}${n ? '' : ' is-zero'}"><div class="sp-sc-h"><span class="sp-sc-i" aria-hidden="true">${SP_STATE[k].i}</span><span>${SP_STATE[k].t}</span><b>${spNf(n)}</b></div><p>${meaning}</p>${btn}</div>`;
  const fixBtn = g.fix.length === 1
    ? `<button type="button" class="sp-btn" data-sp-act="fixhand" data-sp-key="${lrEsc(g.fix[0].key)}">Open in Listing Errors</button>`
    : `<button type="button" class="sp-btn" data-sp-act="filter" data-sp-filter="fix" data-sp-group="${lrEsc(g.key)}"${g.fix.length ? '' : ' disabled'}>${g.fix.length ? `Show the ${spNf(g.fix.length)}` : 'Open in Listing Errors'}</button>`;
  const cards = '<div class="sp-scs">'
    + card('ready', g.ready.length, readyMeaning, `<button type="button" class="sp-main" data-sp-act="fix-all" data-sp-group="${lrEsc(g.key)}"${g.ready.length && !SP.sending ? '' : ' disabled'}>Fix all ${spNf(g.ready.length)}</button>`)
    + card('look', g.look.length, g.look.length ? (lookTitle ? 'One word in the title would change.' : 'Some hidden search words are trimmed to make room.') : 'Nothing waits for your OK.',
      `<button type="button" class="sp-btn" data-sp-act="filter" data-sp-filter="look" data-sp-group="${lrEsc(g.key)}"${g.look.length ? '' : ' disabled'}>Check them</button>`)
    + card('fix', g.fix.length, g.fix.length ? 'No safe automatic change.' : 'Nothing to do by hand.', fixBtn) + '</div>';
  const filter = SP.panel && SP.panel.key === g.key ? SP.panel.filter : '';
  const rows = g.todo.filter(item => !filter || item.status === filter);
  SP.kidOrder = rows.map(item => item.key);
  const note = filter ? `<div class="sp-filter">Showing the ${spNf(rows.length)} that ${filter === 'look' ? 'need your OK' : 'need fixing by hand'} · <button type="button" class="sp-link" data-sp-act="filter" data-sp-filter="" data-sp-group="${lrEsc(g.key)}">Show all ${spNf(g.todo.length)}</button></div>` : '';
  const upToDate = total - g.todo.length;
  const result = SP.result ? spResultHtml(SP.result) : '';
  const reading = g.reading.length ? `<div class="sp-filter"><span class="sp-reading">Reading ${spPlural(g.reading.length, 'listing')} from Amazon…</span></div>` : '';
  return `<p class="sp-today sp-psent">${sentence}</p>${result}${g.todo.length ? cards : ''}${reading}${note}`
    + `<div class="sp-rows">${rows.map(item => spRowHtml(item, inWs)).join('')}</div>`
    + (upToDate ? `<p class="sp-more-ok">✓ ${spNf(upToDate)} more listing${upToDate === 1 ? ' is' : 's are'} up to date.</p>` : '');
}
// What we will do for one listing, in one short line.
function spDoLine(item) {
  if (item.status === 'reading') return 'Reading this listing from Amazon…';
  if (item.status === 'fix') return item.hint || 'Change it by hand in Listing Errors';
  if (item.kind === 'restore') return 'Put the old title back';
  const e = spSeasonOf(item);
  const out = [];
  if (item.remove.length) out.push(`Take “${lrEsc(spOldWord(item, item.remove[0]))}” out of the title`);
  if (e) {
    if (item.place === 'swap') out.push(`Put “${lrEsc(e.ev.name)}” in the title in place of “${lrEsc(item.swapped)}”`);
    else if (item.place === 'title') out.push(`Add “${lrEsc(e.ev.name)}” to the title`);
    else if (item.place === 'kw') out.push(`Add “${lrEsc(e.ev.name)}” to hidden search words`);
  }
  return out.join(', then ') || 'Nothing to change';
}
// One child as a compact row: picture · Colour · Size · Pack (SKU small grey) · what we'll do · the state chip · ONE button.
function spRowHtml(item, inWs) {
  const st = SP_STATE[item.status] || SP_STATE.look;
  const open = SP.kid && SP.kid.key === item.key;
  const btn = item.status === 'ready' ? `<button type="button" class="sp-btn sp-row-b" data-sp-act="row-fix" data-sp-key="${lrEsc(item.key)}"${SP.sending ? ' disabled' : ''}>Fix</button>`
    : item.status === 'reading' ? '<button type="button" class="sp-btn sp-row-b" disabled>Wait</button>'
      : `<button type="button" class="sp-btn sp-row-b" data-sp-act="open-kid" data-sp-key="${lrEsc(item.key)}"${inWs ? ' data-sp-from="ws"' : ''}>Check</button>`;
  return `<div class="sp-row ${st.cls}${open ? ' is-open' : ''}" role="button" tabindex="0" data-sp-act="open-kid" data-sp-key="${lrEsc(item.key)}"${inWs ? ' data-sp-from="ws"' : ''} aria-label="Open ${lrEsc(spFacts(item))}">`
    + `${spPic(item.brand, item.sku, false)}<div class="sp-row-t"><b>${lrEsc(spFacts(item))}</b><span>${spDoLine(item)}</span><small>${lrEsc(item.sku)}</small></div>`
    + `<span class="sp-chip-s ${st.cls}"><i aria-hidden="true">${st.i}</i>${st.s}</span>${btn}</div>`;
}
// The parent side panel: header card, then the body.
function spParentPanelHtml(g) {
  return `<div class="sp-side-h"><div class="sp-hc">${spPic(g.brand, (g.todo[0] || g.all[0]).sku, true)}<div class="sp-hc-t"><b title="${lrEsc(g.name)}">${lrEsc(g.name)}</b>`
    + `<span>${lrEsc(BRAND_NAME[g.brand] || g.brand)} · ${spPlural(g.all.length, 'listing')}</span></div><button type="button" class="sp-x" data-sp-act="close-parent" aria-label="Close">×</button></div></div>`
    + `<div class="sp-side-b">${spParentBodyHtml(g, false)}</div>`;
}
// The same, for ONE parent, inside the Workspace side panel's Season tab (listing-workspace.js calls it).
function spPanelHtml(p) {
  if (!SP.log) spLogLoad().then(() => { if (typeof liWsPanelRender === 'function' && LI_WS.panel) liWsPanelRender(); });
  const g = spGroups(spCompute()).find(each => each.key === p.brand + '|' + p.parent);
  if (!g) return '<div class="sp-root sp-in-panel"><div class="ls-empty"><b>No listing of this parent is in the season planner.</b></div></div>';
  spEnsureReads(g.todo);
  return `<div class="sp-root sp-in-panel">${spParentBodyHtml(g, true)}</div>`;
}
// How many of a parent's listings the Season tab would show (its count pill).
function spPanelCount(p) {
  if (!H_LOADED) return 0;
  return spCompute().filter(item => item.brand === p.brand && spParentOf(item) === p.parent && item.kind !== 'none' && item.kind !== 'ok' && !spSkipped(item)).length;
}

/* ----- level 3: one child ----- */
function spKidHtml(item, g) {
  const st = SP_STATE[item.status] || SP_STATE.look;
  const parentNameText = g ? g.name : spParentOf(item);
  const back = `<button type="button" class="sp-back" data-sp-act="close-kid">← Back to ${lrEsc(parentNameText)}</button>`;
  const head = `<div class="sp-side-h">${back}<div class="sp-hc">${spPic(item.brand, item.sku, true)}<div class="sp-hc-t"><b>${lrEsc(spFacts(item))}</b><span>${lrEsc(parentNameText)}</span><small>${lrEsc(item.sku)}</small>`
    + `<span class="sp-chip-s ${st.cls}"><i aria-hidden="true">${st.i}</i>${st.t}</span></div><button type="button" class="sp-x" data-sp-act="close-kid" aria-label="Close">×</button></div></div>`;
  if (item.kind === 'ok' || item.kind === 'none') {
    return head + `<div class="sp-side-b"><div class="sp-card2 is-ok"><h4>✓ Up to date</h4><p>Nothing to change on this listing for the seasons on now.</p></div></div>`
      + '<div class="sp-bar"><button type="button" class="sp-main" data-sp-act="close-kid">Close</button></div>';
  }
  const e = spSeasonOf(item);
  const products = spProducts(item.row);
  const card = (cls, title, body) => `<div class="sp-card2 ${cls}"><h4>${title}</h4>${body}</div>`;
  // 2 the problem
  let problem;
  if (item.kind === 'restore') problem = `${lrEsc((item.restore && item.restore.seasons || []).map(id => (spEvents(spCfg(), spToday()).find(x => x.ev.id === id) || { ev: { name: id } }).ev.name).join(', ') || 'The season')} is over. This listing still has the title we changed for it.`;
  else {
    const bits = [];
    if (e) bits.push(`${lrEsc(e.ev.name)} ${spSeasonWord(e)} and this listing doesn't mention it.`);
    item.remove.forEach(r => bits.push(`${lrEsc(r.ev.name)} is over, but the title still says “${lrEsc(spOldWord(item, r))}”.`));
    problem = bits.join(' ');
  }
  // 3 why it matters
  const why = item.kind === 'restore' ? 'Your normal title is the one that sells the rest of the year.'
    : e ? `Shoppers searching “${lrEsc(e.ev.name.toLowerCase())} ${lrEsc(products)}” may not find it.` : 'An old season word makes the listing look out of date to shoppers.';
  // 4 what we'll do
  let todo;
  if (item.status === 'fix') todo = `We can't change this one safely by ourselves: ${lrEsc(item.why)}. ${item.hint ? lrEsc(item.hint) + ' ' : ''}Listing Errors opens with the suggestion already filled in — nothing is sent until you press Send there.`;
  else if (item.status === 'reading') todo = 'We are reading this listing from Amazon first. This takes a moment.';
  else if (item.kind === 'restore') todo = `Put the old title back. ${item.note ? lrEsc(item.note) : 'Nothing else changes.'}`;
  else {
    const bits = [];
    if (item.remove.length) bits.push(`Take “${lrEsc(spOldWord(item, item.remove[0]))}” out of the title.`);
    if (e && item.place === 'title') bits.push(`Add “${lrEsc(e.ev.name)}” to the title.`);
    if (e && item.place === 'swap') bits.push(`Put “${lrEsc(e.ev.name)}” in the title in place of “${lrEsc(item.swapped)}” (${lrEsc(item.swapWhy)}).`);
    if (e && item.place === 'kw') bits.push(`Add “${lrEsc(e.ev.name)}” to the hidden search words.`);
    if (e && item.place === 'kw' && item.changes.some(c => c.what === 'Hidden search words')) bits.push('To make room, words that were wasted there are taken out.');
    bits.push(item.after === item.title ? 'The title stays the same.' : 'Everything else stays the same.');
    todo = bits.join(' ');
  }
  const alts = item.alts && item.alts.length ? `<p class="sp-alts">Also possible: ${item.alts.map(a => `<button type="button" class="sp-link" data-sp-act="choose" data-sp-key="${lrEsc(item.key)}" data-sp-id="${lrEsc(a.ev.id)}">${spSeasonIcon(a.ev.id)} ${lrEsc(a.ev.name)}</button>`).join(' · ')}</p>` : '';
  // 5 what changes, 6 checks, the edit box
  const typed = SP.edits.has(item.key) ? SP.edits.get(item.key) : null;
  const after = typed != null ? typed : item.after;
  const checks = typed != null ? spChecks(item.title, typed, item.row, hCtx(), spToday(), { kwAfter: item.kwAfter, kwMax: item.kwMax }) : item.checks;
  const editing = SP.editing.has(item.key);
  const edit = editing ? card('sp-editc', 'Your title', `<textarea class="sp-edit" data-sp-key="${lrEsc(item.key)}" rows="3" aria-label="Edit the title">${lrEsc(after)}</textarea><span class="sp-cnt" data-sp-cnt="${lrEsc(item.key)}">${after.length} of ${SP_TITLE_MAX} letters</span>`) : '';
  const changes = item.status === 'reading' ? '' : card('sp-chg', 'What changes', spChangesHtml(item, after));
  const checksHtml = checks.length ? card('sp-chk-c', 'Checks', spChecksHtml(checks)) : '';
  // 7 the action bar
  const bad = checks.find(check => check.ok === false);
  const canSend = (item.status === 'ready' || item.status === 'look') && !bad && !!item.pt && !SP.sending && spChanges(item, after);
  let main;
  if (item.status === 'fix') main = `<button type="button" class="sp-main" data-sp-act="fixhand" data-sp-key="${lrEsc(item.key)}">Open in Listing Errors</button>`;
  else if (item.status === 'reading') main = '<button type="button" class="sp-main" disabled>Reading from Amazon…</button>';
  else main = `<button type="button" class="sp-main" data-sp-act="approve" data-sp-key="${lrEsc(item.key)}"${canSend ? '' : ' disabled'}>${item.status === 'look' ? 'Approve this change' : item.kind === 'restore' ? 'Put it back — send to Amazon' : 'Fix — send to Amazon'}</button>`;
  const reason = (item.status === 'ready' || item.status === 'look') && !canSend ? (bad ? bad.why || bad.t : !item.pt ? 'Reading this listing from Amazon first' : '') : '';
  const bar = `<div class="sp-bar">${main}<button type="button" class="sp-btn" data-sp-act="edit" data-sp-key="${lrEsc(item.key)}" aria-pressed="${editing}">${editing ? 'Done' : 'Edit'}</button>`
    + `<button type="button" class="sp-btn sp-quiet" data-sp-act="skip" data-sp-key="${lrEsc(item.key)}" title="Hide this for this season, in this browser">Not now</button>`
    + `<span class="sp-reason"${reason ? '' : ' hidden'}>${lrEsc(reason)}</span></div>`;
  return head + `<div class="sp-side-b">${card('sp-prob', 'Problem', `<p>${problem}</p>`)}${card('sp-whyc', 'Why it matters', `<p>${why}</p>`)}${card('sp-do', 'What we’ll do', `<p>${todo}</p>${alts}`)}${edit}${changes}${checksHtml}</div>` + bar;
}
// "What changes": the title before → after (only the changed words marked) when the title changes; else the hidden search words as
// "+ Added" / "− Removed" lists, each word once, with why it went; the full search words folded away.
function spChangesHtml(item, after) {
  const kwChanged = item.kwAfter != null && item.kwAfter !== item.kw;
  const fullKw = kwChanged ? `<details class="sp-fold"><summary>Show full search words</summary><div class="sp-kwfull"><small>Before</small><p>${lrEsc(item.kw || '(none)')}</p><small>After</small><p>${spDiffHtml(item.kw, item.kwAfter)}</p></div></details>` : '';
  if (String(after).trim() !== item.title) {
    const d = spWordDiff(item.title, after);
    return `<div class="sp-ba"><small>Title before</small><p>${spMarkHtml(item.title, d.removed, 'del')}</p><small>Title after</small><p class="sp-change-after">${spMarkHtml(after, d.added, 'ins')}</p></div>`
      + (!d.added.length && !d.removed.length ? '<p class="sp-dim">Only the order of the words changes.</p>' : '') + fullKw;
  }
  if (!kwChanged) return '<p class="sp-dim">Nothing changes.</p>';
  const d = spWordDiff(item.kw, item.kwAfter);
  const titleWords = new Set(spWords(after).map(w => lrNorm(w)));
  const outOf = new Set(spEvents(spCfg(), spToday()).filter(e => !e.s.inSeason).flatMap(e => spWords(e.ev.words)));
  const reasonOf = x => (x.kept ? 'repeated' : titleWords.has(lrNorm(x.k)) ? 'already in the title' : SP_FILLER.has(lrNorm(x.k)) ? 'small filler words' : outOf.has(x.k) ? 'out of season' : 'to make room');
  const groups = new Map();
  d.removed.forEach(x => { const r = reasonOf(x); groups.set(r, (groups.get(r) || []).concat([x])); });
  return (d.added.length ? `<p class="sp-add">+ Added: ${spWordList(d.added)}</p>` : '')
    + [...groups.entries()].map(([r, list]) => `<p class="sp-rem">− Removed: ${spWordList(list)} <span class="sp-dim">(${r})</span></p>`).join('')
    + `<p class="sp-dim">Hidden search words: ${spNf(lrKwBytes(item.kwAfter))} of ${spNf(item.kwMax)}.</p>` + fullKw;
}
// "✓ All 10 checks pass" — click to see them.
function spChecksHtml(checks) {
  const fail = checks.filter(check => check.ok === false).length;
  const warn = checks.filter(check => check.ok === 'warn').length;
  const sum = fail ? `✕ ${spPlural(fail, 'check')} ${fail === 1 ? 'does' : 'do'} not pass` : warn ? `⚠ ${spNf(checks.length - warn)} of ${spNf(checks.length)} checks pass — ${spNf(warn)} to look at` : `✓ All ${spNf(checks.length)} checks pass`;
  return `<details class="sp-fold${fail ? ' is-bad' : warn ? ' is-warn' : ''}"${fail ? ' open' : ''}><summary class="sp-chk-sum">${sum}</summary><ul class="sp-checks">${checks.map(check => `<li class="sp-chk ${check.ok === true ? 'is-ok' : check.ok === false ? 'is-no' : 'is-warn'}"><i>${check.ok === true ? '✓' : check.ok === false ? '✕' : '⚠'}</i>${lrEsc(check.t)}</li>`).join('')}</ul></details>`;
}

/* ----- opening and closing the panels ----- */
// The parent panel (from the page) and the child panel (from the parent panel or the Workspace's Season tab). Esc closes the child first.
function spOpenParent(key) {
  SP.panel = { key, filter: '' };
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
function spOpenKid(key, from) {
  SP.kid = { key, from: from || 'page' };
  const box = $('spKid');
  if (!box) return;
  box.hidden = false;
  box.classList.toggle('is-ws', SP.kid.from === 'ws');
  spPanelsRender();
  if (box.focus) box.focus({ preventScroll: true });
}
function spCloseKid(returnFocus) {
  if (!SP.kid) return;
  const { key, from } = SP.kid;
  SP.kid = null;
  const box = $('spKid');
  if (box) { box.hidden = true; box.innerHTML = ''; }
  spPanelsRender();
  if (from === 'ws' && typeof liWsPanelRender === 'function' && LI_WS.panel) liWsPanelRender();
  if (returnFocus) {
    const root = from === 'ws' ? $('lsPanel') : $('spPanel');
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
  if (next) spOpenKid(next, SP.kid.from);
}
// Close both (the tab changed, or the Workspace panel went away).
function spPanelsClose(from) {
  if (SP.kid && (!from || SP.kid.from === from)) spCloseKid(false);
  if (SP.panel && from !== 'ws') spCloseParent(false);
}
// Draw what is open: the parent panel (its scroll kept) and the child panel.
function spPanelsRender() {
  const pp = $('spPanel');
  if (pp && SP.panel && !SP.panel.ws) {
    const g = spGroupOf(SP.panel.key);
    if (!g) spCloseParent(false);
    else {
      const body = pp.querySelector ? pp.querySelector('.sp-side-b') : null;
      const top = body ? body.scrollTop : 0;
      pp.innerHTML = spParentPanelHtml(g);
      const again = pp.querySelector ? pp.querySelector('.sp-side-b') : null;
      if (again) again.scrollTop = top;
      if (g.todo.length) spEnsureReads(g.todo);
    }
  }
  if (pp && pp.classList) pp.classList.toggle('has-kid', !!(SP.kid && SP.kid.from === 'page'));
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

/* ----- approve, confirm, send ----- */
// Something would change on Amazon: the title, or the hidden search words alone (a full title sends only those).
const spChanges = (item, after) => String(after || '').trim() !== item.title || (item.kwAfter != null && item.kwAfter !== item.kw);
// The patches one listing's approval sends: the title, and the hidden search words when they change.
function spPatches(item, after) {
  const patches = [{ op: 'replace', path: '/attributes/item_name', value: [{ value: after, language_tag: 'en_US' }] }];
  if (item.kwAfter != null && item.kwAfter !== item.kw) patches.push({ op: 'replace', path: '/attributes/generic_keyword', value: [{ value: item.kwAfter, language_tag: 'en_US' }] });
  return patches;
}
// Approve: one listing, a parent's ready ones, or every ready one in view → the review list and the confirm window.
function spApprove(keys) {
  const items = spCompute().filter(item => keys.includes(item.key));
  const todo = [];
  items.forEach(item => {
    const typed = SP.edits.has(item.key) ? SP.edits.get(item.key) : null;
    const after = (typed != null ? typed : item.after).trim();
    const checks = typed != null ? spChecks(item.title, typed, item.row, hCtx(), spToday(), { kwAfter: item.kwAfter, kwMax: item.kwMax }) : item.checks;
    if (!(item.status === 'ready' || item.status === 'look') || !item.pt || checks.some(check => check.ok === false) || !spChanges(item, after)) return;
    todo.push({ item, after, patches: spPatches(item, after) });
  });
  if (!todo.length) return;
  const n = todo.length;
  const test = spIsTest();
  const body = `<div class="sp-m-h"><b>${test ? 'Test site — nothing will be sent' : `You are about to change ${spPlural(n, 'listing')} on Amazon`}</b>`
    + `<p>${test ? 'On live Sellora this would send what is listed below.' : 'Amazon checks each one first. The old words are kept so you can put them back.'}</p></div>`
    + `<div class="sp-m-list">${todo.map(t => { const dk = spWordDiff(t.item.kw, t.item.kwAfter); return `<div class="sp-m-row"><b>${lrEsc(spFacts(t.item))}</b><small>${lrEsc(t.item.sku)}</small>${t.after !== t.item.title ? `<div class="sp-m-now">${spDiffHtml(t.item.title, t.after)}</div>` : ''}${t.patches.length > 1 && dk.added.length ? `<div class="sp-m-kw">+ Hidden search words: ${spWordList(dk.added)}</div>` : ''}</div>`; }).join('')}</div>`
    + `<div class="sp-m-a"><button type="button" class="sp-main" id="spSendBtn">${test ? 'Close — nothing is sent here' : `Send ${spPlural(n, 'listing')}`}</button><button type="button" class="sp-btn" id="spCancelBtn">Cancel</button></div>`;
  spModal(body);
  $('spCancelBtn').onclick = () => spModal('');
  $('spSendBtn').onclick = () => {
    if (test) {
      SP.result = { test: true, results: todo.map(t => ({ ok: true, sku: t.item.sku, brand: t.item.brand })) };
      spModal('');
      return spRedrawAll();
    }
    spSendAll(todo);
  };
  if ($('spSendBtn').focus) $('spSendBtn').focus();
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
// then record each one sent, with its OLD title, so it can be put back.
async function spSendAll(todo) {
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
      records.push({ brand: item.brand, sku: item.sku, asin: item.asin, kind: item.kind, seasons: item.seasons.slice(), at: now, by: (typeof ME !== 'undefined' && ME.email) || '',
        before: { title: item.title, kw: item.kw }, after: { title: t.after, kw: item.kwAfter != null ? item.kwAfter : item.kw }, sub: reply.submissionId || '' });
      // what was sent is now what the listing shows, as far as every screen knows
      if (typeof liWsEntry === 'function') {
        const entry = liWsEntry(item.brand, item.sku);
        Object.assign(entry, { at: now, cAt: now, title: t.after.slice(0, 220), titleLen: t.after.length, err: '', cErr: '' });
        if (item.kwAfter != null) Object.assign(entry, { kw: item.kwAfter.slice(0, 300), kwBytes: lrKwBytes(item.kwAfter) });
        LI_WS.liveV++;
        if (typeof liWsStoreSave === 'function') liWsStoreSave();
      }
      SP.edits.delete(item.key);
      SP.editing.delete(item.key);
    } else {
      const raw = String(reply.error || 'Amazon did not accept it').replace(/^Amazon would reject this:\s*/i, '');
      results.push({ ok: false, sku: item.sku, brand: item.brand, why: spPlainReason(raw), todo: spTodo(raw) });
    }
    SP.sending.done++;
    spModal(bar());
  }
  const logErr = records.length ? await spLogAdd(records) : '';
  SP.sending = null;
  SP.result = { results, logErr };
  spModal('');
  spRedrawAll();
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
// Redraw wherever the planner is showing: the page, and the Workspace panel's Season tab.
function spRedrawAll() {
  SP.itemsKey = '';
  if (SP.on) spRender();
  spPanelsRender();
  if (typeof LI_WS !== 'undefined' && LI_WS.panel && typeof liWsPanelRender === 'function') liWsPanelRender();
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
  // tab goes away (and a child opened from the Workspace closes with Listing Health).
  const pane = $('paneOpt');
  if (pane && typeof MutationObserver === 'function') new MutationObserver(() => { if (!pane.classList.contains('hide')) spMaybeOpen(); else spPanelsClose('page'); }).observe(pane, { attributes: true, attributeFilter: ['class'] });
  const health = $('paneHealth');
  if (health && typeof MutationObserver === 'function') new MutationObserver(() => { if (health.classList.contains('hide')) spPanelsClose('ws'); }).observe(health, { attributes: true, attributeFilter: ['class'] });
  // Every button of the planner: on the page, in its two panels, and in the Workspace's Season tab.
  document.addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-sp-act]') : null;
    if (!el || el.tagName === 'SELECT') return;
    const act = el.dataset.spAct;
    const key = el.dataset.spKey || '';
    const inWs = !!el.closest('#lsPanel');
    const root = el.closest('#spKid') ? $('spKid') : el.closest('#spPanel') ? $('spPanel') : inWs ? $('lsPanel') : $('spPane');
    const refocus = selector => { const again = root && root.querySelector ? root.querySelector(selector) : null; if (again) again.focus({ preventScroll: true }); };
    if (act === 'help-hide') { try { localStorage.setItem(SP_STORE_HELP, '1'); } catch (x) { /* no storage */ } SP.helpOpen = false; return spRender(); }
    if (act === 'help-show') { try { localStorage.removeItem(SP_STORE_HELP); } catch (x) { /* no storage */ } return spRender(); }
    if (act === 'help-more') { SP.helpOpen = !SP.helpOpen; spRender(); return refocus('[data-sp-act="help-more"]'); }
    if (act === 'brand') { SP.brand = el.dataset.spBrand; SP.shown = SP_PAGE; spRender(); return refocus(`[data-sp-act="brand"][data-sp-brand="${el.dataset.spBrand}"]`); }
    if (act === 'list') { SP.list = el.dataset.spList; SP.shown = SP_PAGE; spRender(); return refocus(`[data-sp-act="list"][data-sp-list="${el.dataset.spList}"]`); }
    if (act === 'season') { SP.season = SP.season === el.dataset.spId ? '' : el.dataset.spId; SP.shown = SP_PAGE; spRender(); return refocus(SP.season ? `[data-sp-act="season"][data-sp-id="${CSS.escape(SP.season)}"]` : '.sp-tlc'); }
    if (act === 'more') { SP.shown += SP_PAGE; return spRender(); }
    if (act === 'show-done') { SP.showDone = !SP.showDone; spRender(); return refocus('[data-sp-act="show-done"]'); }
    if (act === 'reload') { H_LOADED = false; return spOn(); }
    if (act === 'result-close') { SP.result = null; return spRedrawAll(); }
    if (act === 'open-parent') return spOpenParent(el.dataset.spGroup);
    if (act === 'close-parent') return spCloseParent(true);
    if (act === 'open-kid') return spOpenKid(key, el.dataset.spFrom || (inWs ? 'ws' : 'page'));
    if (act === 'close-kid') return spCloseKid(true);
    if (act === 'filter') {
      if (inWs) { SP.panel = SP.panel && SP.panel.key === el.dataset.spGroup ? SP.panel : { key: el.dataset.spGroup, filter: '', ws: true }; }
      if (SP.panel) SP.panel.filter = el.dataset.spFilter || '';
      spRedrawAll();
      return refocus('.sp-row');
    }
    if (act === 'edit') {
      if (SP.editing.has(key)) SP.editing.delete(key); else SP.editing.add(key);
      spPanelsRender();
      const box = $('spKid').querySelector ? $('spKid').querySelector(`.sp-edit[data-sp-key="${CSS.escape(key)}"]`) : null;
      if (box) box.focus({ preventScroll: true }); else refocus(`[data-sp-act="edit"][data-sp-key="${CSS.escape(key)}"]`);
      return;
    }
    if (act === 'skip') {
      const item = spCompute().find(each => each.key === key);
      if (!item) return;
      spSkips()[item.key + '|' + item.kind + ':' + item.seasons.join('+')] = Date.now();
      spSkipSave();
      SP.edits.delete(key);
      SP.editing.delete(key);
      spCloseKid(false);
      return spRedrawAll();
    }
    if (act === 'choose') { SP.choice.set(key, el.dataset.spId); SP.edits.delete(key); spRedrawAll(); return refocus('.sp-bar .sp-main'); }
    if (act === 'fixhand') {
      const item = spCompute().find(each => each.key === key);
      if (!item) return;
      const after = SP.edits.has(key) ? SP.edits.get(key) : item.after;
      if (typeof LC_PREFILL !== 'undefined') LC_PREFILL = { brand: item.brand, sku: item.sku, title: after && after !== item.title ? after : '', kw: item.kwAfter != null && item.kwAfter !== item.kw ? item.kwAfter : null, hint: item.hint || item.why, done: false };
      spPanelsClose();
      if (typeof lrFixOpen === 'function') lrFixOpen('lerr', item.brand, item.sku, []);
      return;
    }
    // One child: its own approval (Ready or Needs your OK). A row's Fix: that Ready child only.
    if (act === 'approve') return spApprove([key]);
    if (act === 'row-fix') { const item = spCompute().find(each => each.key === key); return item && item.status === 'ready' ? spApprove([key]) : undefined; }
    // Fix all: ONLY the Ready ones of this parent — a change that needs your OK is never sent without its own approval.
    if (act === 'fix-all') {
      const g = spGroupOf(el.dataset.spGroup);
      return g ? spApprove(g.ready.map(item => item.key)) : undefined;
    }
  });
  // The cards and rows that are not buttons (role="button") open on Enter or Space, like a button.
  document.addEventListener('keydown', e => {
    if ((e.key !== 'Enter' && e.key !== ' ') || !e.target || !e.target.dataset || !e.target.dataset.spAct || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    e.target.click();
  });
  // Esc: the confirm window first, then the child panel, then the parent panel — the keyboard goes back to where it came from.
  // ↑ / ↓ in a child panel: the previous / next child. Caught before the Workspace's own keys, so its panel stays open under a child.
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('keydown', e => {
    const typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '');
    const modalOpen = $('spModal') && !$('spModal').classList.contains('hide');
    if (e.key === 'Escape') {
      if (modalOpen) { if (!SP.sending) spModal(''); e.preventDefault(); e.stopPropagation(); return; }
      if (SP.kid) { spCloseKid(true); e.preventDefault(); e.stopPropagation(); return; }
      if (SP.panel && !SP.panel.ws) { spCloseParent(true); e.preventDefault(); e.stopPropagation(); }
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
    if (t.classList && t.classList.contains('sp-edit')) {
      const key = t.dataset.spKey;
      const item = spCompute().find(each => each.key === key);
      if (!item) return;
      SP.edits.set(key, t.value);
      // the panel's What changes, Checks, count and main button follow the typing in place (no redraw: the box keeps the cursor)
      const panel = t.closest('#spKid') || t.closest('[data-sp-card]');
      if (!panel) return;
      const checks = spChecks(item.title, t.value, item.row, hCtx(), spToday(), { kwAfter: item.kwAfter, kwMax: item.kwMax });
      const chk = panel.querySelector('.sp-chk-c');
      if (chk) chk.innerHTML = '<h4>Checks</h4>' + spChecksHtml(checks);
      const chg = panel.querySelector('.sp-chg');
      if (chg) chg.innerHTML = '<h4>What changes</h4>' + spChangesHtml(item, t.value);
      const cnt = panel.querySelector(`[data-sp-cnt="${CSS.escape(key)}"]`);
      if (cnt) cnt.textContent = `${t.value.length} of ${SP_TITLE_MAX} letters`;
      const bad = checks.find(check => check.ok === false);
      const btn = panel.querySelector('[data-sp-act="approve"]');
      const reason = panel.querySelector('.sp-reason');
      if (btn) btn.disabled = !!bad || !item.pt || !(item.status === 'ready' || item.status === 'look') || !spChanges(item, t.value);
      if (reason) { reason.textContent = bad ? bad.why || bad.t : ''; reason.hidden = !bad; }
    }
  });
  if ($('spModal')) $('spModal').addEventListener('click', e => { if (e.target === $('spModal') && !SP.sending) spModal(''); });
}
