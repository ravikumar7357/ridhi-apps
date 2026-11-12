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
 * Main functions: spCompute (every listing's plan), spPlan (one listing), spChecks (the ✓ list), spRender / spPanelHtml (the
 *                 screens), spApprove / spSendAll (the confirm window and the send), spAfterRead (redraw when reads land).
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
const SP_JOIN = ['for', 'and', 'with', 'the', 'of', 'a', 'an', 'to', 'in', 'on', '&', '-', '–', '|', ',', 'x'];   // joiners, never counted as facts

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
  editing: new Set(),        // the cards whose Edit box is open
  skip: null,                // the "Not now" records, once read from localStorage
  reading: new Set(),        // "brand|sku" queued for a content read from Amazon
  redrawT: 0,                // the debounced redraw for landed reads
  sending: null,             // { done, total, results } while titles are sent
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
// Take one occasion's words out of a title (whole words, however written), and the "for" / "&" that only joined them.
function spStrip(title, words) {
  let out = String(title || '');
  lrWords(words).forEach(word => {
    const re = new RegExp('(?:\\b(?:for|and|&)\\s+)?(^|[^a-z0-9])' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+') + "(?:'s)?(?=$|[^a-z0-9])", 'gi');
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
  const soon = e => !e.s.inSeason && e.s.from && spDays(e.s.from, today) < 0 && -spDays(e.s.from, today) <= SP_SOON_DAYS;
  const remove = events.filter(e => inTitle(e) && !e.s.inSeason && !keep(e));
  const add = events.filter(e => !e.ev.removeOnly && fits && !keep(e) && !inTitle(e) && e.s.inSeason);
  const coming = events.filter(e => !e.ev.removeOnly && fits && !keep(e) && !inTitle(e) && soon(e));
  // --- put back: the newest change this planner sent for the listing whose seasons are all over, and that was not put back since ---
  const mine = (log || []).filter(rec => rec.brand === brand && rec.sku === row.sku);
  const last = mine[0] || null;
  let restore = null;
  if (last && last.kind !== 'restore' && last.seasons && last.seasons.length) {
    const over = last.seasons.every(id => { const e = events.find(each => each.ev.id === id); return !e || !e.s.inSeason; });
    if (over) restore = last;
  }
  const item = { key, brand, sku: row.sku, asin: row.asin || '', row, name: title || row.title || '', title, kw, kwMax, pt: live && live.pt ? live.pt : '',
    live, liveFresh, fits, add, coming, remove: restore ? [] : remove, restore, seasons: [], kind: 'none', after: title, kwAfter: kw, kwWords: [],
    checks: [], status: 'ok', why: '', note: '', readErr: live && (live.cErr || live.err) ? String(live.cErr || live.err) : '' };
  if (restore) {
    item.kind = 'restore';
    item.seasons = restore.seasons.slice();
    if (!restore.before || !restore.before.title) {
      item.status = 'no';
      item.why = 'the old title was not kept in the change record';
      return item;
    }
    item.after = String(restore.before.title);
    item.kwAfter = restore.before.kw != null ? String(restore.before.kw) : kw;
    if (title && restore.after && restore.after.title && title !== restore.after.title) item.note = `The title changed since the planner sent it (it was sent as “${restore.after.title}”) — look before putting back.`;
    return spFinish(item, ctx, today);
  }
  if (!title) {
    if (add.length || remove.length) {
      item.kind = add.length ? 'add' : 'remove';
      item.seasons = add.concat(remove).map(e => e.ev.id);
    }
    if (item.kind === 'none' && !coming.length) return item;
    item.status = 'no';
    item.why = row.title && String(row.title).length === 60 ? 'only the first 60 letters of this title were saved — press “Refresh both brands” on Listing Health' : 'we do not have this title yet — press “Refresh both brands” on Listing Health';
    return item;
  }
  if (!add.length && !remove.length) {
    if (coming.length) {
      item.kind = 'add';
      item.seasons = coming.map(e => e.ev.id);
      item.status = 'look';
      item.why = `${coming[0].ev.name} can be added from ${spDate(coming[0].s.from)} — nothing to send yet`;
    }
    return item;
  }
  item.kind = add.length ? 'add' : 'remove';
  item.seasons = add.concat(remove).map(e => e.ev.id);
  // --- the suggestion: take the old words out, put the in-season names in (nearest first); what does not fit goes to the search words ---
  let next = title;
  remove.forEach(e => { next = spStrip(next, e.ev.words); });
  const names = add.slice().sort((a, b) => a.s.next - b.s.next).map(e => e.ev.name);
  let into = names.slice();
  let out = spInsert(next, into);
  while (into.length && out.length > SP_TITLE_MAX) {
    into = into.slice(0, -1);
    out = spInsert(next, into);
  }
  const toKw = names.filter(name => !into.includes(name));
  if (next.length > SP_TITLE_MAX && into.length) {   // the title was over 75 before we started: never make it longer
    into = [];
    out = spTidy(next);
    toKw.splice(0, toKw.length, ...names);
  }
  item.after = out;
  if (toKw.length) {
    if (kw == null) {
      item.kwWords = toKw;
      if (item.readErr) {
        item.status = 'no';
        item.why = `the title is full, so the words would go to the hidden search words — but Amazon could not be read for this listing (${item.readErr})`;
        return item;
      }
      item.status = 'reading';
      item.why = 'the title is full, so the words go to the hidden search words — reading those from Amazon first';
      return item;
    }
    const have = word => lrHas(kw, word) || lrHas(out, word);
    const words = toKw.filter(word => !have(word));
    let kwNext = kw.trim();
    const added = [];
    words.forEach(word => {
      const tryNext = (kwNext ? kwNext + ' ' : '') + word;
      if (lrKwBytes(tryNext) <= kwMax) { kwNext = tryNext; added.push(word); }
    });
    item.kwAfter = kwNext;
    item.kwWords = added;
    const full = words.filter(word => !added.includes(word));
    if (full.length && !added.length && out === title) {
      item.status = 'no';
      item.why = `the title is full and the hidden search words are full too (${spNf(lrKwBytes(kw))} of ${spNf(kwMax)}) — no safe place for “${full.join('”, “')}”`;
      return item;
    }
    if (added.length) item.note = `The title is full, so we added “${added.join('”, “')}” to the hidden search words instead (the safest place).`;
    else if (!words.length) item.note = `The title is full; “${toKw.join('”, “')}” ${toKw.length === 1 ? 'is' : 'are'} already in the hidden search words.`;
    if (full.length && added.length) item.note += ` “${full.join('”, “')}” did not fit anywhere.`;
  }
  if (coming.length) item.note += (item.note ? ' ' : '') + `${coming[0].ev.name} can be added from ${spDate(coming[0].s.from)}.`;
  return spFinish(item, ctx, today);
}
// Nothing changed (the words were already in the search words): up to date. Else run the checks and set the status.
function spFinish(item, ctx, today) {
  if (item.after === item.title && (item.kwAfter == null || item.kwAfter === item.kw)) {
    item.kind = item.kind === 'restore' ? 'restore' : 'ok';
    item.status = item.kind === 'restore' ? 'no' : 'ok';
    if (item.kind === 'restore') item.why = 'the old title is the same as the title on Amazon now';
    return item;
  }
  item.checks = spChecks(item.title, item.after, item.row, ctx, today, { kwAfter: item.kwAfter, kwMax: item.kwMax, added: item.kwWords });
  const bad = item.checks.find(check => check.ok === false);
  const warn = item.checks.find(check => check.ok === 'warn');
  if (bad) {
    item.status = 'no';
    item.why = bad.why || bad.t;
  } else if (!item.pt) {
    item.status = (item.live && item.live.cAt) || item.readErr ? 'no' : 'reading';
    item.why = item.readErr ? `Amazon could not be read for this listing (${item.readErr})` : item.status === 'no' ? 'Amazon did not say what kind of product this is, so a change cannot be sent' : 'reading this listing from Amazon first (the product kind is needed to send)';
  } else item.status = warn ? 'look' : 'ready';
  return item;
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
  const stale = spEvents(cfg, today).find(e => !e.s.inSeason && lrWords(e.ev.words).some(word => lrHas(now, word)) && !lrWords(e.ev.except).some(word => lrHas(protect, word)));
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
  const key = [ctx === SP.ctx ? 1 : 0, typeof LI_WS !== 'undefined' ? LI_WS.liveV : 0, today.toDateString(), SP.log ? SP.log.length : -1,
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
const spInList = (item, k) => (k === 'add' ? item.kind !== 'restore' && (item.add.length > 0 || item.coming.length > 0)
  : k === 'remove' ? item.kind !== 'restore' && item.remove.length > 0 : k === 'restore' ? item.kind === 'restore' : k === 'ok' ? item.kind === 'ok' : item.kind !== 'none' && item.kind !== 'ok');
const spSkipped = item => { const skips = spSkips(); return !!skips[item.key + '|' + item.kind + ':' + item.seasons.join('+')]; };
// Reads from Amazon the listings whose plan needs the live read (the hidden search words, the product kind): 20 a call through the
// Workspace's queue, content only. Returns how many were queued.
function spEnsureReads(items) {
  if (typeof liWsQueue !== 'function' || !items.length) return 0;
  if (!LI_WS.stored) liWsStoreLoad();
  const want = items.filter(item => (item.status === 'reading' || (item.status !== 'no' && item.kind !== 'ok' && item.kind !== 'none' && !item.liveFresh))
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
  if (!SP.on && !(typeof LI_WS !== 'undefined' && LI_WS.panel)) return;
  ['SP', 'CPC'].forEach(brand => Object.keys(LI_WS.live[brand] || {}).forEach(sku => {
    const entry = LI_WS.live[brand][sku];
    if (entry && (entry.cAt || entry.cErr || entry.err)) SP.reading.delete(spKey(brand, sku));
  }));
  clearTimeout(SP.redrawT);
  SP.redrawT = setTimeout(() => {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active && active.classList && active.classList.contains('sp-edit')) return spAfterRead();
    if (SP.on) spRender();
  }, 600);
}

/* ----- the screen on the Listing Optimiser ----- */
const SP_ICON = {
  pick: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 7"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M3 11.5 21 3l-7 18-2.5-7.5z"/></svg>',
  add: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  remove: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  restore: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v5h5"/></svg>',
  ok: '<svg viewBox="0 0 24 24"><path d="M4 12.5l5 5L20 7"/></svg>',
};
const SP_LISTS = [
  { k: 'add', t: 'Add season words', hint: 'The season is on and these titles do not say it yet', cls: 'is-add' },
  { k: 'remove', t: 'Remove old season words', hint: 'These titles still name a season that is over', cls: 'is-rem' },
  { k: 'restore', t: 'Put old titles back', hint: 'Season changes this planner sent whose season has ended', cls: 'is-res' },
  { k: 'ok', t: 'Up to date', hint: 'Nothing to change for the seasons on now', cls: 'is-ok' },
];
const SP_STATUS = {
  ready: ['✓', 'Ready', 'is-ready'], look: ['⚠', 'Needs a look', 'is-look'], no: ['✕', "Can't do safely", 'is-no'],
  reading: ['…', 'Reading from Amazon', 'is-reading'], ok: ['✓', 'Up to date', 'is-ok'],
};
// The "How it works" strip: three steps with icons, a "?" that opens the short explanation, Hide that remembers.
function spHowHtml() {
  let hidden = false;
  try { hidden = localStorage.getItem(SP_STORE_HELP) === '1'; } catch (e) { /* no storage */ }
  if (hidden) return '<div class="sp-how is-folded"><button type="button" class="sp-link" data-sp-act="help-show">How it works</button></div>';
  const step = (n, icon, t, s) => `<div class="sp-step"><span class="sp-step-n">${n}</span><span class="sp-step-i">${SP_ICON[icon]}</span><div><b>${t}</b><small>${s}</small></div></div>`;
  return `<div class="sp-how" role="note"><div class="sp-steps">${step(1, 'pick', 'Pick a season', 'Click a season card or a list below')}${step(2, 'check', 'Check the new titles', 'Each card shows the title now and the new one, with its checks')}${step(3, 'send', 'Approve and send', 'Amazon checks each title first; the old one is always kept')}</div>`
    + `<div class="sp-how-a"><button type="button" class="sp-q" data-sp-act="help-more" aria-expanded="${SP.helpOpen ? 'true' : 'false'}" aria-label="What does this do?">?</button><button type="button" class="sp-link" data-sp-act="help-hide">Hide</button></div>`
    + (SP.helpOpen ? `<div class="sp-help">This page looks at every listing's title on Amazon and the season calendar in Listing Rules. When a season is on (for example Christmas from ${spDate(spEvents(spCfg(), spToday()).find(e => e.ev.id === 'christmas').s.from)}), it suggests adding that word to the titles of products that fit; when a season is over, it suggests taking the word out again. You read each suggestion, approve the ones you like, and Amazon checks every title before it goes live. Nothing is lost: the old title is kept, and “Put back” returns it after the season with one click.</div>` : '')
    + '</div>';
}
// The meta line, like the Ad Console's: what is on, when Amazon was read, when the full refresh was.
function spMetaHtml(items) {
  const now = Date.now();
  const read = typeof liWsNewestRead === 'function' ? liWsNewestRead(['SP', 'CPC']) : 0;
  const ats = ['SP', 'CPC'].map(b => (HEALTH[b] && HEALTH[b].at ? HEALTH[b].at.getTime() : 0)).filter(Boolean);
  const ago = ms => (typeof liWsAgoWords === 'function' ? liWsAgoWords(ms) : Math.round(ms / 3600000) + ' h ago');
  const onNow = spEvents(spCfg(), spToday()).filter(e => e.s.inSeason && !e.ev.removeOnly).map(e => e.ev.name);
  const reading = SP.reading.size ? ` · <span class="sp-reading">Reading your listings… ${spNf(SP.reading.size)} left</span>` : '';
  return `<div class="sp-meta"><span><b>Season planner</b> · today ${spDate(spToday(), true)} · on now: ${onNow.length ? lrEsc(onNow.join(', ')) : 'no occasion'}${reading}</span>`
    + `<span>Amazon read ${read ? ago(now - read) : 'not yet'} · Full refresh ${ats.length ? ago(now - Math.min(...ats)) : 'never'} · ${spNf(items.length)} listings</span></div>`;
}
// Season timeline: one card per season in date order; "Add from" and "Remove after", today's place, how many listings it touches.
function spTimelineHtml(items) {
  const today = spToday();
  const events = spEvents(spCfg(), today).filter(e => e.s.next).sort((a, b) => a.s.next - b.s.next);
  const touches = id => items.filter(item => item.seasons.includes(id) && item.kind !== 'ok' && !spSkipped(item)).length;
  return '<div class="sp-tl" role="group" aria-label="Seasons">' + events.map(e => {
    const n = touches(e.ev.id);
    const startsIn = e.s.from ? -spDays(e.s.from, today) : 0;
    const state = e.s.inSeason ? 'is-now' : startsIn > 0 && startsIn <= SP_SOON_DAYS ? 'is-soon' : '';
    const when = e.s.inSeason ? `On now · until ${spDate(e.s.to)}` : startsIn > 0 ? `Starts in ${spPlural(startsIn, 'day')}` : 'Over';
    return `<button type="button" class="sp-tlc ${state}${SP.season === e.ev.id ? ' is-on' : ''}${e.ev.removeOnly ? ' is-plain' : ''}" data-sp-act="season" data-sp-id="${lrEsc(e.ev.id)}" aria-pressed="${SP.season === e.ev.id}">`
      + `<b>${lrEsc(e.ev.name)}</b><span class="sp-tlw">${lrEsc(when)}</span>`
      + `<span class="sp-tld">${e.ev.removeOnly ? 'Remove after' : 'Add from'} <b>${spDate(e.ev.removeOnly ? e.s.to : e.s.from)}</b>${e.ev.removeOnly ? '' : ` · Remove after <b>${spDate(e.s.to)}</b>`}</span>`
      + `<span class="sp-tln">${n ? spPlural(n, 'listing') : 'nothing to do'}</span></button>`;
  }).join('') + '</div>';
}
// The four number cards: Add · Remove · Put back · Up to date — a one-line hint each, click to filter.
function spBoxesHtml(counts) {
  return '<div class="sp-boxes">' + SP_LISTS.map(list => `<div class="sp-box ${list.cls}${SP.list === list.k ? ' is-on' : ''}"><button type="button" class="sp-box-main" data-sp-act="list" data-sp-list="${list.k}" aria-pressed="${SP.list === list.k}">`
    + `<span class="sp-l"><span class="sp-ic">${SP_ICON[list.k === 'ok' ? 'ok' : list.k === 'remove' ? 'remove' : list.k]}</span>${list.t}</span><span class="sp-v"><b>${spNf(counts[list.k] || 0)}</b></span><span class="sp-note">${list.hint}</span></button></div>`).join('') + '</div>';
}
// One listing card: picture + name, the title now and the suggested one with the changed words marked, the letter count, the checks, the buttons.
function spCardHtml(item, where) {
  const st = SP_STATUS[item.status] || SP_STATUS.look;
  const editing = SP.editing.has(item.key);
  const typed = SP.edits.has(item.key) ? SP.edits.get(item.key) : null;
  const after = typed != null ? typed : item.after;
  const checks = typed != null ? spChecks(item.title, typed, item.row, hCtx(), spToday(), { kwAfter: item.kwAfter, kwMax: item.kwMax }) : item.checks;
  const bad = checks.find(check => check.ok === false);
  const canSend = item.status !== 'no' && item.status !== 'reading' && item.status !== 'ok' && item.kind !== 'none' && !bad && !!item.pt && !SP.sending && spChanges(item, after);
  const reason = item.status === 'reading' ? 'Reading this listing from Amazon…' : item.status === 'no' ? '' : bad ? bad.why || bad.t : !item.pt ? 'Reading this listing from Amazon first' : item.status === 'look' && !item.checks.length ? item.why : '';
  const pic = typeof liWsPicHtml === 'function' ? liWsPicHtml(typeof liWsPicUrl === 'function' ? liWsPicUrl(item.brand, item.sku) : '', false) : '';
  const what = item.kind === 'restore' ? 'Put the old title back' : item.kind === 'ok' || item.kind === 'none' ? 'Up to date'
    : [item.remove.length ? `Remove ${lrEsc(item.remove.map(e => e.ev.name).join(', '))}` : '', item.add.length || item.coming.length ? `Add ${lrEsc(item.add.concat(item.coming).map(e => e.ev.name).join(', '))}` : ''].filter(Boolean).join(' · ');
  const head = `<div class="sp-card-h">${pic}<div class="sp-card-t"><b title="${lrEsc(item.name)}">${lrEsc(item.name || item.sku)}</b><small><span class="ui-mono">${lrEsc(item.sku)}</span> · <span class="ui-mono">${lrEsc(item.asin || '—')}</span> · ${lrEsc(BRAND_NAME[item.brand] || item.brand)}</small></div>`
    + `<span class="sp-st ${st[2]}" title="${lrEsc(item.why)}"><i>${st[0]}</i>${st[1]}</span></div>`;
  if (item.status === 'no') {
    return `<div class="sp-card is-no" data-sp-card="${lrEsc(item.key)}">${head}<div class="sp-what">${what}</div><div class="sp-no">✕ Can't do this one safely — ${lrEsc(item.why)}.</div>`
      + `<div class="sp-now"><small>Now on Amazon</small><div>${lrEsc(item.title || '(no title saved)')}</div></div></div>`;
  }
  if (item.kind === 'ok' || item.kind === 'none') {
    return `<div class="sp-card is-ok" data-sp-card="${lrEsc(item.key)}">${head}<div class="sp-now"><small>Now on Amazon</small><div>${lrEsc(item.title)}</div></div><div class="sp-okline">✓ Nothing to change for the seasons on now.</div></div>`;
  }
  const diff = spDiffHtml(item.title, after);
  const kwLine = item.kwAfter != null && item.kwAfter !== item.kw ? `<div class="sp-kw"><small>Hidden search words</small><div>${spDiffHtml(item.kw || '', item.kwAfter)}</div><span class="sp-cnt">${spNf(lrKwBytes(item.kwAfter))} of ${spNf(item.kwMax)}</span></div>` : '';
  const checksHtml = checks.length ? `<ul class="sp-checks">${checks.map(check => `<li class="sp-chk ${check.ok === true ? 'is-ok' : check.ok === false ? 'is-no' : 'is-warn'}"><i>${check.ok === true ? '✓' : check.ok === false ? '✕' : '⚠'}</i>${lrEsc(check.t)}</li>`).join('')}</ul>` : '';
  const edit = editing ? `<div class="sp-editbox"><label>Your title<textarea class="sp-edit" data-sp-key="${lrEsc(item.key)}" rows="2" aria-label="Edit the title">${lrEsc(after)}</textarea></label><span class="sp-cnt" data-sp-cnt="${lrEsc(item.key)}">${after.length} of ${SP_TITLE_MAX} letters</span></div>` : '';
  const main = item.kind === 'restore' ? 'Put back' : 'Approve';
  const actions = `<div class="sp-actions"><button type="button" class="sp-main" data-sp-act="approve" data-sp-key="${lrEsc(item.key)}"${canSend ? '' : ' disabled'}>${main}</button>`
    + `<button type="button" class="sp-btn" data-sp-act="edit" data-sp-key="${lrEsc(item.key)}" aria-pressed="${editing}">${editing ? 'Done editing' : 'Edit'}</button>`
    + `<button type="button" class="sp-btn" data-sp-act="copy" data-sp-key="${lrEsc(item.key)}">Copy</button>`
    + `<button type="button" class="sp-btn sp-quiet" data-sp-act="skip" data-sp-key="${lrEsc(item.key)}" title="Hide this suggestion for this season, in this browser">Not now</button>`
    + (reason && !canSend ? `<span class="sp-reason">${lrEsc(reason)}</span>` : '') + '</div>';
  return `<div class="sp-card ${st[2]}" data-sp-card="${lrEsc(item.key)}">${head}<div class="sp-what">${what}</div>`
    + `<div class="sp-now"><small>Now on Amazon</small><div>${lrEsc(item.title)}</div><span class="sp-cnt">${item.title.length} of ${SP_TITLE_MAX}</span></div>`
    + `<div class="sp-sug"><small>${item.kind === 'restore' ? 'Old title to put back' : 'Suggested'}</small><div>${diff}</div><span class="sp-cnt${after.length > SP_TITLE_MAX ? ' is-over' : ''}">${after.length} of ${SP_TITLE_MAX} letters</span></div>`
    + kwLine + (item.note ? `<div class="sp-note-l">${lrEsc(item.note)}</div>` : '') + edit + checksHtml + actions + '</div>';
}
// The changed words marked in place: taken out = red strikethrough, put in = green.
function spDiffHtml(from, to) {
  const a = String(from || '').split(/\s+/).filter(Boolean);
  const b = String(to || '').split(/\s+/).filter(Boolean);
  const count = list => { const n = {}; list.forEach(word => { const k = word.toLowerCase(); n[k] = (n[k] || 0) + 1; }); return n; };
  const inA = count(a);
  const inB = count(b);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const wa = a[i] ? a[i].toLowerCase() : null;
    const wb = b[j] ? b[j].toLowerCase() : null;
    if (wa !== null && wb !== null && wa === wb) { out.push(lrEsc(b[j])); i++; j++; continue; }
    if (wa !== null && !(inB[wa] > 0)) { out.push(`<del>${lrEsc(a[i])}</del>`); i++; continue; }
    if (wb !== null && !(inA[wb] > 0)) { out.push(`<ins>${lrEsc(b[j])}</ins>`); j++; continue; }
    if (wa !== null) { inB[wa]--; out.push(`<del>${lrEsc(a[i])}</del>`); i++; }
    if (wb !== null) { inA[wb]--; out.push(`<ins>${lrEsc(b[j])}</ins>`); j++; }
  }
  return out.join(' ');
}
// The listings in view, grouped by parent in the order the snapshot has them.
function spGroups(items) {
  const by = new Map();
  items.forEach(item => {
    const parent = item.row.parent || item.asin || item.sku;
    const key = item.brand + '|' + parent;
    const group = by.get(key) || { key, brand: item.brand, parent, name: typeof parentName === 'function' ? parentName(item.brand, parent, item.row.title) : parent, items: [], all: 0 };
    group.items.push(item);
    by.set(key, group);
  });
  return [...by.values()];
}
function spFilter(items) {
  const q = SP.q.trim().toLowerCase();
  return items.filter(item => (SP.brand === 'ALL' || item.brand === SP.brand)
    && spInList(item, SP.list)
    && (!SP.season || item.seasons.includes(SP.season))
    && (!q || [item.sku, item.asin, item.name, item.row.parent].join(' ').toLowerCase().includes(q))
    && !(SP.list !== 'ok' && spSkipped(item)));
}
// The whole planner.
function spRender() {
  const box = $('spPane');
  if (!box || !SP.on) return;
  if (SP.loading || !H_LOADED) {
    box.innerHTML = spHowHtml() + '<div class="sp-meta"><span><b>Season planner</b> · <span class="sp-reading">Reading your listings…</span></span></div>'
      + '<div class="sp-boxes">' + SP_LISTS.map(() => '<div class="sp-box is-skel"><span class="sp-skel is-s"></span><span class="sp-skel"></span></div>').join('') + '</div>'
      + '<div class="card sp-list">' + Array.from({ length: 5 }, () => '<div class="sp-skel-row"><span class="sp-skel is-pic"></span><span class="sp-skel is-w"></span><span class="sp-skel is-s"></span></div>').join('') + '</div>';
    return;
  }
  if (SP.loadErr) {
    box.innerHTML = spHowHtml() + `<div class="card sp-empty"><b>Could not read your listings.</b><br>${lrEsc(SP.loadErr)}<br><button type="button" class="sp-main" data-sp-act="reload">Try again</button></div>`;
    return;
  }
  const items = spCompute();
  spEnsureReads(items.filter(item => SP.brand === 'ALL' || item.brand === SP.brand));
  const counts = {};
  items.forEach(item => SP_LISTS.forEach(list => { if (spInList(item, list.k) && (list.k === 'ok' || !spSkipped(item))) counts[list.k] = (counts[list.k] || 0) + 1; }));
  const shown = spFilter(items);
  const groups = spGroups(shown);
  const page = groups.slice(0, SP.shown);
  const ready = shown.filter(item => item.status === 'ready' && !SP.sending);
  const chips = '<div class="sp-chips">' + [['all', 'Everything to do']].concat(SP_LISTS.map(list => [list.k, list.t])).map(([k, t]) => `<button type="button" class="sp-chip${SP.list === k ? ' is-on' : ''}" data-sp-act="list" data-sp-list="${k}" aria-pressed="${SP.list === k}">${t}<span class="sp-n">${spNf(k === 'all' ? (counts.add || 0) + (counts.remove || 0) + (counts.restore || 0) : counts[k] || 0)}</span></button>`).join('')
    + (SP.season ? `<button type="button" class="sp-chip is-on" data-sp-act="season" data-sp-id="" aria-pressed="true">${lrEsc((spEvents(spCfg(), spToday()).find(e => e.ev.id === SP.season) || { ev: { name: SP.season } }).ev.name)} ✕</button>` : '') + '</div>';
  const toolbar = `<div class="card sp-tb"><select class="sp-sel" data-sp-act="brand" aria-label="Brand"><option value="ALL"${SP.brand === 'ALL' ? ' selected' : ''}>Both brands</option><option value="SP"${SP.brand === 'SP' ? ' selected' : ''}>${lrEsc(BRAND_NAME.SP || 'SP')}</option><option value="CPC"${SP.brand === 'CPC' ? ' selected' : ''}>${lrEsc(BRAND_NAME.CPC || 'CPC')}</option></select>`
    + `<label class="sp-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="spQ" value="${lrEsc(SP.q)}" placeholder="Search name, SKU or ASIN" aria-label="Search"></label><span class="sp-spacer"></span>`
    + `<button type="button" class="sp-main sp-big" data-sp-act="approve-all"${ready.length ? '' : ' disabled'}>Approve all ${spNf(ready.length)} ready</button></div>`;
  const next = spEvents(spCfg(), spToday()).filter(e => !e.ev.removeOnly && !e.s.inSeason && e.s.from && spDays(e.s.from, spToday()) < 0).sort((a, b) => a.s.from - b.s.from)[0];
  const empty = !shown.length ? `<div class="card sp-empty"><b>${SP.list === 'ok' ? 'No listing is up to date yet.' : SP.q || SP.season || SP.list !== 'all' ? 'Nothing here with these filters.' : 'No season changes needed right now.'}</b><br>`
    + (SP.q || SP.season || (SP.list !== 'all' && SP.list !== 'ok') ? 'Clear the search or the filters above to see everything.' : next ? `The next season, ${lrEsc(next.ev.name)}, starts adding on ${spDate(next.s.from)}.` : '') + '</div>' : '';
  const groupHtml = page.map(group => {
    const readyN = group.items.filter(item => item.status === 'ready').length;
    return `<section class="card sp-group" aria-label="${lrEsc(group.name)}"><div class="sp-group-h">${typeof liWsPicHtml === 'function' ? liWsPicHtml(typeof liWsPicUrl === 'function' ? liWsPicUrl(group.brand, group.items[0].sku) : '', false) : ''}<div class="sp-group-t"><b>${lrEsc(group.name)}</b><small><span class="ui-mono">${lrEsc(group.parent)}</span> · ${lrEsc(BRAND_NAME[group.brand] || group.brand)} · ${spPlural(group.items.length, 'listing')} to look at</small></div>`
      + (readyN > 1 ? `<button type="button" class="sp-btn" data-sp-act="approve-group" data-sp-group="${lrEsc(group.key)}">Approve all ${spNf(readyN)}</button>` : '') + '</div>'
      + group.items.map(item => spCardHtml(item, 'page')).join('') + '</section>';
  }).join('');
  const more = groups.length > page.length ? `<div class="sp-foot"><span>${spNf(page.length)} of ${spNf(groups.length)} parents</span><button type="button" class="sp-btn" data-sp-act="more">Show ${spNf(Math.min(SP_PAGE, groups.length - page.length))} more</button></div>` : '';
  const result = SP.result ? spResultHtml(SP.result) : '';
  box.innerHTML = spHowHtml() + spMetaHtml(items) + toolbar + spBoxesHtml(counts) + spTimelineHtml(items) + chips + result + empty + groupHtml + more;
}
// After a send: what went, what did not and why, in plain words.
function spResultHtml(res) {
  const okN = res.results.filter(r => r.ok).length;
  const bad = res.results.filter(r => !r.ok);
  return `<div class="card sp-result${bad.length ? ' has-bad' : ''}" role="status">${res.test ? '<div><b>This is the test site — nothing was sent.</b></div>' : ''}`
    + (okN ? `<div class="sp-res-ok">✓ ${spPlural(okN, 'title')} sent. Amazon usually shows them within a few hours.</div>` : '')
    + bad.map(r => `<div class="sp-res-bad">✕ ${lrEsc(r.sku)} was not accepted: ${lrEsc(r.why)} — what to do: ${lrEsc(r.todo)} <button type="button" class="ghost lr-fixbtn" data-lr-fix="lerr|${lrEsc(r.brand)}|${lrEsc(r.sku)}">Open Listing Errors</button></div>`).join('')
    + (res.logErr ? `<div class="sp-res-bad">⚠ The change was sent but the record of the old title could not be saved (${lrEsc(res.logErr)}) — keep a note of it.</div>` : '')
    + '<button type="button" class="sp-link" data-sp-act="result-close">Close</button></div>';
}
// The same planner for ONE parent, inside the Workspace side panel's Season tab (listing-workspace.js calls it).
function spPanelHtml(p) {
  if (!SP.log) spLogLoad().then(() => { if (typeof liWsPanelRender === 'function' && LI_WS.panel) liWsPanelRender(); });
  const items = spCompute().filter(item => item.brand === p.brand && (item.row.parent || item.asin || item.sku) === p.parent && item.kind !== 'none');
  const todo = items.filter(item => item.kind !== 'ok' && !spSkipped(item));
  spEnsureReads(todo);
  const ready = todo.filter(item => item.status === 'ready' && !SP.sending);
  const head = `<div class="sp-panel-a">${ready.length > 1 ? `<button type="button" class="sp-main" data-sp-act="approve-group" data-sp-group="${lrEsc(p.key)}">Approve all ${spNf(ready.length)}</button>` : ''}<span class="sp-panel-s">${todo.length ? spPlural(todo.length, 'listing') + ' to look at' : 'Nothing to change for the seasons on now'}${SP.reading.size ? ' · reading from Amazon…' : ''}</span></div>`;
  const next = spEvents(spCfg(), spToday()).filter(e => !e.ev.removeOnly && !e.s.inSeason && e.s.from && spDays(e.s.from, spToday()) < 0).sort((a, b) => a.s.from - b.s.from)[0];
  if (!todo.length) return `<div class="sp-root sp-in-panel">${head}<div class="ls-empty"><b>No season changes needed right now.</b><br>${next ? `The next season, ${lrEsc(next.ev.name)}, starts adding on ${spDate(next.s.from)}.` : ''}</div>${SP.result ? spResultHtml(SP.result) : ''}</div>`;
  return `<div class="sp-root sp-in-panel">${head}${SP.result ? spResultHtml(SP.result) : ''}${todo.map(item => spCardHtml(item, 'panel')).join('')}</div>`;
}
// How many of a parent's listings the Season tab would show (its count pill).
function spPanelCount(p) {
  if (!H_LOADED) return 0;
  return spCompute().filter(item => item.brand === p.brand && (item.row.parent || item.asin || item.sku) === p.parent && item.kind !== 'none' && item.kind !== 'ok' && !spSkipped(item)).length;
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
    if (item.status === 'no' || item.status === 'reading' || !item.pt || checks.some(check => check.ok === false) || !spChanges(item, after)) return;
    todo.push({ item, after, patches: spPatches(item, after) });
  });
  if (!todo.length) return;
  const n = todo.length;
  const test = spIsTest();
  const body = `<div class="sp-m-h"><b>${test ? 'This is the test site — nothing will be sent' : `You are about to change ${spPlural(n, 'title')} on Amazon`}</b>`
    + `<p>${test ? 'On live Sellora this would send:' : 'Amazon checks each one first. You can put the old titles back after the season.'}</p></div>`
    + `<div class="sp-m-list">${todo.map(t => `<div class="sp-m-row"><b>${lrEsc(t.item.name)}</b><small>${lrEsc(t.item.sku)}</small><div class="sp-m-was">${lrEsc(t.item.title)}</div><div class="sp-m-now">${spDiffHtml(t.item.title, t.after)}</div>${t.patches.length > 1 ? `<div class="sp-m-kw">Hidden search words: ${lrEsc(t.item.kwAfter)}</div>` : ''}</div>`).join('')}</div>`
    + `<div class="sp-m-a"><button type="button" class="sp-main" id="spSendBtn">${test ? 'Close — nothing is sent here' : `Send ${spPlural(n, 'title')}`}</button><button type="button" class="sp-btn" id="spCancelBtn">Cancel</button></div>`;
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
  const bar = () => `<div class="sp-m-h"><b>Sending ${spNf(SP.sending.done)} of ${spNf(SP.sending.total)}…</b><p>Amazon checks each title first. Please keep this window open.</p></div><div class="sp-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${SP.sending.total}" aria-valuenow="${SP.sending.done}"><span style="width:${Math.round(SP.sending.done * 100 / SP.sending.total)}%"></span></div>`;
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
    else spOff();
  });
  // The planner comes back on its own when the Listing Optimiser tab opens with "Season planner" last chosen.
  const pane = $('paneOpt');
  if (pane && typeof MutationObserver === 'function') new MutationObserver(() => { if (!pane.classList.contains('hide')) spMaybeOpen(); }).observe(pane, { attributes: true, attributeFilter: ['class'] });
  // Every button of the planner, on the page and inside the Workspace panel.
  document.addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-sp-act]') : null;
    if (!el || el.tagName === 'SELECT') return;
    const act = el.dataset.spAct;
    const key = el.dataset.spKey || '';
    const inPanel = !!el.closest('#lsPanel');
    const redraw = () => (inPanel ? (typeof liWsPanelRender === 'function' && liWsPanelRender()) : spRender());
    const refocus = selector => { const root = inPanel ? $('lsPanel') : $('spPane'); const again = root && root.querySelector ? root.querySelector(selector) : null; if (again) again.focus({ preventScroll: true }); };
    if (act === 'help-hide') { try { localStorage.setItem(SP_STORE_HELP, '1'); } catch (x) { /* no storage */ } SP.helpOpen = false; return redraw(); }
    if (act === 'help-show') { try { localStorage.removeItem(SP_STORE_HELP); } catch (x) { /* no storage */ } return redraw(); }
    if (act === 'help-more') { SP.helpOpen = !SP.helpOpen; redraw(); return refocus('[data-sp-act="help-more"]'); }
    if (act === 'list') { SP.list = SP.list === el.dataset.spList && el.classList.contains('sp-box-main') ? 'all' : el.dataset.spList; SP.shown = SP_PAGE; redraw(); return refocus(`[data-sp-act="list"][data-sp-list="${el.dataset.spList}"]`); }
    if (act === 'season') { SP.season = SP.season === el.dataset.spId ? '' : el.dataset.spId; SP.shown = SP_PAGE; redraw(); return refocus(SP.season ? `[data-sp-act="season"][data-sp-id="${CSS.escape(SP.season)}"]` : '.sp-tlc'); }
    if (act === 'more') { SP.shown += SP_PAGE; return redraw(); }
    if (act === 'reload') { H_LOADED = false; return spOn(); }
    if (act === 'result-close') { SP.result = null; return redraw(); }
    if (act === 'edit') {
      if (SP.editing.has(key)) { SP.editing.delete(key); } else { SP.editing.add(key); }
      redraw();
      const box = (inPanel ? $('lsPanel') : $('spPane')).querySelector(`.sp-edit[data-sp-key="${CSS.escape(key)}"]`);
      if (box) box.focus({ preventScroll: true });
      else refocus(`[data-sp-act="edit"][data-sp-key="${CSS.escape(key)}"]`);
      return;
    }
    if (act === 'copy') {
      const item = spCompute().find(each => each.key === key);
      const text = item ? (SP.edits.has(key) ? SP.edits.get(key) : item.after) : '';
      const done = () => { el.textContent = 'Copied'; setTimeout(() => { el.textContent = 'Copy'; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => { el.textContent = 'Could not copy'; });
      return;
    }
    if (act === 'skip') {
      const item = spCompute().find(each => each.key === key);
      if (!item) return;
      spSkips()[item.key + '|' + item.kind + ':' + item.seasons.join('+')] = Date.now();
      spSkipSave();
      SP.edits.delete(key);
      SP.editing.delete(key);
      return spRedrawAll();
    }
    if (act === 'approve') return spApprove([key]);
    if (act === 'approve-group') {
      const g = el.dataset.spGroup;
      const sep = g.indexOf('|');
      const brand = g.slice(0, sep);
      const parent = g.slice(sep + 1);
      return spApprove(spCompute().filter(item => item.brand === brand && (item.row.parent || item.asin || item.sku) === parent && item.status === 'ready' && !spSkipped(item)).map(item => item.key));
    }
    if (act === 'approve-all') return spApprove(spFilter(spCompute()).filter(item => item.status === 'ready').map(item => item.key));
  });
  // The brand select, the search box (a quarter second after typing stops), and the Edit box (checks again as you type).
  document.addEventListener('change', e => {
    if (e.target && e.target.dataset && e.target.dataset.spAct === 'brand') { SP.brand = e.target.value; SP.shown = SP_PAGE; spRender(); $('spPane').querySelector('[data-sp-act="brand"]').focus(); }
  });
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
      // the card's checks and its count follow the typing in place (no redraw: the box keeps the cursor)
      const card = t.closest('[data-sp-card]');
      const checks = spChecks(item.title, t.value, item.row, hCtx(), spToday(), { kwAfter: item.kwAfter, kwMax: item.kwMax });
      const list = card && card.querySelector('.sp-checks');
      if (list) list.innerHTML = checks.map(check => `<li class="sp-chk ${check.ok === true ? 'is-ok' : check.ok === false ? 'is-no' : 'is-warn'}"><i>${check.ok === true ? '✓' : check.ok === false ? '✕' : '⚠'}</i>${lrEsc(check.t)}</li>`).join('');
      const cnt = card && card.querySelector(`[data-sp-cnt="${CSS.escape(key)}"]`);
      if (cnt) cnt.textContent = `${t.value.length} of ${SP_TITLE_MAX} letters`;
      const sug = card && card.querySelector('.sp-sug > div');
      if (sug) sug.innerHTML = spDiffHtml(item.title, t.value);
      const bad = checks.find(check => check.ok === false);
      const btn = card && card.querySelector('[data-sp-act="approve"]');
      const reason = card && card.querySelector('.sp-reason');
      if (btn) btn.disabled = !!bad || !item.pt || item.status === 'no' || item.status === 'reading' || !spChanges(item, t.value);
      if (reason) reason.textContent = bad ? bad.why || bad.t : '';
      else if (bad && btn) btn.insertAdjacentHTML('afterend', `<span class="sp-reason">${lrEsc(bad.why || bad.t)}</span>`);
    }
  });
  // Esc closes the confirm window (nothing is sent); a press on the dark backdrop too, unless a send is running.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('spModal') && !$('spModal').classList.contains('hide') && !SP.sending) spModal('');
  });
  if ($('spModal')) $('spModal').addEventListener('click', e => { if (e.target === $('spModal') && !SP.sending) spModal(''); });
}
