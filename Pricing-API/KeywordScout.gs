/* Pricing-API / KeywordScout.gs — the BESTSELLER KEYWORD SCOUT for Sellora's search terms (28 Nov 2026).
 *
 * In place of the Brand Analytics uploads, which are no longer used. Once a week (and when a person presses "Run now" in Sellora → Listing
 * Rules → Winning keywords → 🔎 Bestseller words), for each of OUR product types (tablecloth, napkin, placemat, table runner, pillow cover,
 * and any other product type Sellora finds in our listings) it searches Amazon's catalogue by that product word (Catalog Items API
 * searchCatalogItems, the same call Research.gs makes for Product research), keeps the TOP KWS_TOP results by Best Seller Rank that are not
 * ours, reads their titles and bullet points, and counts which words and 2–3 word phrases those bestsellers use.
 *
 * WRITES ONE CACHE TAB, "kwScout", in the nightly cache spreadsheet (cacheWrite_, Nightly.gs). Sellora reads it through the ?cache= route
 * that is already live (Code.gs: ?cache=kwScout → cacheRead_). Its shape:
 *   { v: 1, at: 'yyyy-MM-dd HH:mm', ms, by: 'weekly' | 'run now', top: KWS_TOP, min: KWS_MIN_SHARE,
 *     types: { <type>: { q: the search, pt: Amazon's product type, at, ms, n: bestsellers counted, scanned, ours: our items skipped,
 *                        other: other product types skipped, items: [{ a: ASIN, b: brand, r: rank, t: title (first 140) }],
 *                        words: [{ w: 'wrinkle free', n: 14 (bestsellers using it), r: best rank among them }], err } } }
 * A type whose search fails keeps what the last run found for it (its err says why) — a word is never made up.
 *
 * WORD MINING (kwsMine_, pure — tests/kw-scout-test.js runs it on sample titles): the words of each bestseller's title + bullets, and every
 * 2–3 word phrase inside one part of the text (a phrase never crosses a comma, a dash, a bracket…). Out: every brand name of the results
 * and our own brands (Ridhi, Whimsical Corner, CPC, Cotton Print Club), ASINs, anything with a number, words under 3 letters, joining
 * words, and a few low-value words (KWS_LOW); a phrase holds no joining word and never begins or ends with a low-value one. Counted ONCE per bestseller. Kept: what
 * at least KWS_MIN_SHARE (30 %) of the counted bestsellers use. Sellora then applies all of its own word rules on top (IP & Trademark Guard
 * words, other brands, another colour / size / shape, season, the 249-byte limit…) — this file only finds the candidates.
 *
 * READ-ONLY ON AMAZON: only GET searchCatalogItems. Nothing is ever sent to Amazon.
 * CALLS: per product type up to KWS_PAGES pages of 20 (Catalog Items allows 2 requests a second: KWS_GAP_MS between calls; a 429 waits and
 * goes on at the next tick). A tick works at most KWS_BUDGET_MS and remembers where it stopped (Script Property KWS_STATE).
 * WHEN: kwsInstall() once — an hourly trigger; a tick starts a run when the last one finished KWS_EVERY_DAYS ago (a week) or when Sellora
 * asked (?kwscout=run → kwsAsk_, which also starts a one-off trigger so the run begins within seconds).
 * ROUTES (Code.gs doGet): ?kwscout=run&types=<type>~<search>~<PT>,… → kwsAsk_ · ?kwscout=status → kwsStatus_.
 * BY HAND (Apps Script editor): kwsInstall() · kwsNow() — run now · kwsStatusLog() — where it is.
 * Uses Nightly.gs (cacheWrite_, cacheRead_), ListingImages.gs (limgSp_), Code.gs (setBrand_), SpApi.gs (marketplaceId_). */
var KWS_TAB = 'kwScout';
var KWS_STATE = 'KWS_STATE';
var KWS_TOP = 25;                    // bestsellers counted per product type (the top 20–30 by Best Seller Rank)
var KWS_MIN_SHARE = 0.3;             // a word is kept when at least 30 % of them use it
var KWS_PAGES = 3;                   // search pages per type (20 results each)
var KWS_GAP_MS = 700;                // Catalog Items: 2 requests a second
var KWS_BUDGET_MS = 4.5 * 60000;     // work per tick, inside Apps Script's 6 minutes
var KWS_EVERY_DAYS = 7;              // once a week
var KWS_MAX_TYPES = 15;              // product types per run at most
var KWS_MAX_WORDS = 200;             // words / phrases kept per type (most used first)
var KWS_OURS = ['ridhi', 'whimsical corner', 'cpc', 'cotton print club'];
// Our product types, always scouted: [type, the search, Amazon's product type]
var KWS_TYPES = [['tablecloth', 'tablecloth', 'TABLECLOTH'], ['napkin', 'cloth napkins', 'NAPKIN'], ['placemat', 'placemats', 'PLACEMAT'],
  ['runner', 'table runner', 'TABLE_RUNNER'], ['pillow', 'pillow cover', 'PILLOW']];
var KWS_STOP = ['a', 'an', 'and', 'the', 'for', 'with', 'of', 'to', 'in', 'on', 'by', 'from', 'your', 'our', 'this', 'that', 'these', 'those', 'is', 'are',
  'it', 'its', 'as', 'at', 'or', 'be', 'will', 'can', 'you', 'we', 'all', 'any', 'more', 'not', 'no', 'so', 'very', 'also', 'up', 'out', 'into', 'each', 'per',
  'x', 'than', 'but', 'if', 'has', 'have', 'was', 'been', 'their', 'they', 'them', 'my', 'us', 'which', 'when', 'what', 'while', 'about', 'over', 'under',
  'other', 'such', 'only', 'just', 'one', 'two', 'three', 'four', 'six', 'both', 'every', 'most', 'many', 'much', 'how', 'well', 'even', 'too', 'yet'];
var KWS_LOW = ['perfect', 'great', 'ideal', 'best', 'quality', 'high', 'premium', 'new', 'nice', 'beautiful', 'beautifully', 'gift', 'gifts', 'idea', 'ideas',
  'make', 'makes', 'made', 'making', 'add', 'adds', 'adding', 'set', 'sets', 'pack', 'piece', 'pieces', 'pcs', 'pc', 'inch', 'inches', 'cm', 'size', 'sizes',
  'item', 'items', 'product', 'products', 'package', 'include', 'includes', 'included', 'brand', 'amazon', 'buy', 'order', 'satisfaction', 'guarantee',
  'guaranteed', 'customer', 'customers', 'service', 'look', 'looks', 'looking', 'feel', 'feels', 'use', 'uses', 'used', 'using', 'get', 'need', 'needs',
  'want', 'like', 'just', 'way', 'time', 'day', 'days', 'year', 'years', 'lot', 'lots', 'thing', 'things', 'any', 'other'];

function kwsProps_() { return PropertiesService.getScriptProperties(); }
function kwsState_() { try { return JSON.parse(kwsProps_().getProperty(KWS_STATE) || '{}'); } catch (e) { return {}; } }
function kwsSave_(st) { kwsProps_().setProperty(KWS_STATE, JSON.stringify(st)); }
function kwsStamp_(ms) { return Utilities.formatDate(new Date(ms || Date.now()), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }

/* ============================== word mining (pure) ============================== */
function kwsNorm_(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[‘’']/g, '').replace(/&/g, ' and ');
}
// A text → its parts (a phrase never crosses one) → each part's words.
function kwsParts_(s) {
  return kwsNorm_(s).split(/[,.;:!?|()\[\]{}\/\\"–—•·]+|\s-\s|\s+-|-\s+/).map(function (p) {
    return p.split(/[^a-z0-9%]+/).filter(function (w) { return w; });
  }).filter(function (ws) { return ws.length; });
}
// The brand names to take out, as word lists: the results' brands and ours.
function kwsBrandLists_(brands) {
  var seen = {}, out = [];
  KWS_OURS.concat(brands || []).forEach(function (b) {
    var ws = kwsParts_(b).reduce(function (a, p) { return a.concat(p); }, []);
    var k = ws.join(' ');
    if (ws.length && !seen[k]) { seen[k] = 1; out.push(ws); }
  });
  return out;
}
/** items: [{ b: brand, t: title, bl: [bullets] }] → [{ w, n, r }] — the words and 2–3 word phrases at least `min` (a share) of them use,
 *  most used first. Brand names (each brand of the items, ours), ASINs, numbers, joining and low-value words are never counted (a phrase
 *  holds no joining word — Amazon ignores them in a search — and never begins or ends with a low-value one: "style look" is not a phrase). */
function kwsMine_(items, opts) {
  opts = opts || {};
  var min = opts.min == null ? KWS_MIN_SHARE : opts.min;
  var stop = {}, low = {};
  KWS_STOP.forEach(function (w) { stop[w] = 1; });
  KWS_LOW.forEach(function (w) { low[w] = 1; });
  var brands = kwsBrandLists_((items || []).map(function (it) { return it.b; }).concat(opts.brands || []));
  var brandWord = {};
  brands.forEach(function (ws) { if (ws.length === 1 && ws[0].length >= 3) brandWord[ws[0]] = 1; });
  var count = {}, best = {};
  (items || []).forEach(function (it) {
    var mine = {};
    var text = [it.t || ''].concat(it.bl || []);
    text.forEach(function (s) {
      kwsParts_(s).forEach(function (ws) {
        // brand names out: a brand's words in a row (a one-word brand anywhere) end the run of words there
        var out = ws.map(function () { return false; });
        brands.forEach(function (bw) {
          for (var i = 0; i + bw.length <= ws.length; i++) {
            var hit = true;
            for (var j = 0; j < bw.length; j++) if (ws[i + j] !== bw[j]) { hit = false; break; }
            if (hit) for (var j2 = 0; j2 < bw.length; j2++) out[i + j2] = true;
          }
        });
        var bad = ws.map(function (w, i) {
          return out[i] || brandWord[w] || /\d/.test(w) || /^b0[a-z0-9]{8}$/.test(w) || w.length < 2;
        });
        for (var i = 0; i < ws.length; i++) {
          for (var n = 1; n <= 3 && i + n <= ws.length; n++) {
            var g = ws.slice(i, i + n);
            var stopAt = false;
            for (var k = i; k < i + n; k++) if (bad[k]) { stopAt = true; break; }
            if (stopAt) break;
            if (g.some(function (w) { return stop[w]; }) || low[g[0]] || low[g[n - 1]]) continue;   // no joining word in it; never begins or ends with a low-value word
            if (n === 1 && (low[g[0]] || g[0].length < 3)) continue;
            if (n > 1 && g.every(function (w) { return low[w] || stop[w]; })) continue;
            mine[g.join(' ')] = 1;
          }
        }
      });
    });
    Object.keys(mine).forEach(function (k) {
      count[k] = (count[k] || 0) + 1;
      if (it.r > 0 && (!best[k] || it.r < best[k])) best[k] = it.r;
    });
  });
  var total = (items || []).length;
  var need = Math.max(1, Math.ceil(min * total - 1e-9));
  return Object.keys(count).filter(function (k) { return count[k] >= need; })
    .sort(function (a, b) { return count[b] - count[a] || a.split(' ').length - b.split(' ').length || (best[a] || 9e9) - (best[b] || 9e9) || (a < b ? -1 : 1); })
    .slice(0, KWS_MAX_WORDS)
    .map(function (k) { return { w: k, n: count[k], r: best[k] || 0 }; });
}

/* ============================== reading Amazon (GET only) ============================== */
// The rank that compares across results: the website display group's (Home & Kitchen…), else the best category rank. 0 = none.
function kwsRankOf_(it) {
  var sr = (it.salesRanks && it.salesRanks[0]) || {};
  var best = 0;
  (sr.displayGroupRanks || []).forEach(function (r) { var n = Number(r.rank) || 0; if (n > 0 && (!best || n < best)) best = n; });
  if (best) return best;
  (sr.classificationRanks || []).forEach(function (r) { var n = Number(r.rank) || 0; if (n > 0 && (!best || n < best)) best = n; });
  return best;
}
function kwsBullets_(it) {
  var a = it.attributes || {};
  return (a.bullet_point || []).map(function (b) { return String((b && b.value) || '').slice(0, 500); }).filter(function (s) { return s; }).slice(0, 8);
}
function kwsIsOurs_(brand, title) {
  var b = ' ' + kwsParts_(brand || '').map(function (p) { return p.join(' '); }).join(' ') + ' ';
  var t = ' ' + kwsParts_(String(title || '').split(/\s+/).slice(0, 4).join(' ')).map(function (p) { return p.join(' '); }).join(' ') + ' ';
  return KWS_OURS.some(function (o) { return b.indexOf(' ' + o + ' ') >= 0 || t.indexOf(' ' + o + ' ') >= 0; });
}
/** One product type: search, keep the top KWS_TOP by rank that are not ours (of its product type when enough are), mine their words.
 *  → { ok, rec } or { ok: false, wait (429), err }. */
function kwsScoutType_(type, q, pt) {
  var items = [], token = '', calls = 0;
  for (var page = 0; page < KWS_PAGES; page++) {
    var path = '/catalog/2022-04-01/items?marketplaceIds=' + marketplaceId_() + '&keywords=' + encodeURIComponent(q) + '&pageSize=20'
      + '&includedData=summaries,attributes,salesRanks,productTypes' + (token ? '&pageToken=' + encodeURIComponent(token) : '');
    if (calls) Utilities.sleep(KWS_GAP_MS);
    var r = limgSp_(path, 'get');
    calls++;
    if (r.code === 429) return { ok: false, wait: true, err: 'Amazon asked us to slow down' };
    if (r.code >= 300) {
      if (items.length) break;                           // keep the pages already read
      var e = (r.body && r.body.errors && r.body.errors[0]) || {};
      return { ok: false, err: 'search failed (' + r.code + (e.message ? ': ' + String(e.message).slice(0, 160) : '') + ')' };
    }
    (r.body.items || []).forEach(function (it) { items.push(it); });
    token = (r.body.pagination && r.body.pagination.nextToken) || '';
    if (!token) break;
  }
  var scanned = items.length, ours = 0;
  var rows = [];
  var seen = {};
  items.forEach(function (it) {
    if (!it.asin || seen[it.asin]) return;
    seen[it.asin] = 1;
    var s = (it.summaries && it.summaries[0]) || {};
    var brand = s.brandName || s.brand || '';
    var title = s.itemName || '';
    if (kwsIsOurs_(brand, title)) { ours++; return; }
    var rank = kwsRankOf_(it);
    if (!rank || !title) return;
    var types = (it.productTypes || []).map(function (x) { return String((x && x.productType) || ''); });
    rows.push({ a: it.asin, b: String(brand).slice(0, 60), r: rank, t: title, bl: kwsBullets_(it), pt: types[0] || '' });
  });
  // the same product type as ours when at least 10 are (a "napkin" search also finds napkin rings)
  var same = pt ? rows.filter(function (x) { return x.pt === pt; }) : [];
  var other = 0;
  if (same.length >= 10) { other = rows.length - same.length; rows = same; }
  rows.sort(function (a, b) { return a.r - b.r; });
  rows = rows.slice(0, KWS_TOP);
  var words = kwsMine_(rows);
  return { ok: true, calls: calls, rec: {
    q: q, pt: pt || '', at: kwsStamp_(), ms: Date.now(), n: rows.length, scanned: scanned, ours: ours, other: other,
    items: rows.map(function (x) { return { a: x.a, b: x.b, r: x.r, t: String(x.t).slice(0, 140) }; }), words: words, err: '' } };
}

/* ============================== the run ============================== */
// The product types of a run: ours always, then the ones Sellora sent ("type~search~PT"), at most KWS_MAX_TYPES.
function kwsTypes_(extra) {
  var out = [], seen = {};
  var add = function (t, q, pt) {
    t = String(t || '').toLowerCase().replace(/[^a-z0-9_ ]+/g, '').trim().slice(0, 40);
    q = String(q || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    pt = String(pt || '').toUpperCase().replace(/[^A-Z0-9_]+/g, '').slice(0, 60);
    if (!t || !q || seen[t] || out.length >= KWS_MAX_TYPES) return;
    seen[t] = 1; out.push([t, q, pt]);
  };
  KWS_TYPES.forEach(function (x) { add(x[0], x[1], x[2]); });
  (extra || []).forEach(function (x) { add(x[0], x[1], x[2]); });
  return out;
}
function kwsParseTypes_(s) {
  return String(s || '').split(',').map(function (x) { return x.split('~'); }).filter(function (x) { return x.length >= 2; });
}
/** ?kwscout=run — Sellora's "Run now": ask for a run (the product types it found in our listings with it); it starts within seconds. */
function kwsAsk_(typesCsv) {
  var st = kwsState_();
  var extra = kwsParseTypes_(typesCsv);
  if (extra.length) kwsProps_().setProperty('KWS_EXTRA', JSON.stringify(extra.slice(0, KWS_MAX_TYPES)));
  if (!st.run) { st.ask = Date.now(); kwsSave_(st); }
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'kwsKick') ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger('kwsKick').timeBased().after(1000).create();
  } catch (e) { /* the hourly tick starts it then */ }
  return kwsStatus_();
}
/** ?kwscout=status — where the scout is: { ok, running, asked, last, next, types done of all }. */
function kwsStatus_() {
  var st = kwsState_();
  var run = st.run || null;
  return { ok: true, running: !!run, asked: st.ask || 0, last: st.last || null,
    next: st.last && st.last.ms ? kwsStamp_(st.last.ms + KWS_EVERY_DAYS * 864e5) : '',
    progress: run ? { done: run.i, of: run.types.length, by: run.by, started: run.started, note: run.note || '' } : null };
}
function kwsKick() { kwsTick(); }
function kwsTick() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try { kwsTickLocked_(); } finally { lock.releaseLock(); }
}
function kwsTickLocked_() {
  var t0 = Date.now(), left = function () { return KWS_BUDGET_MS - (Date.now() - t0); };
  var st = kwsState_();
  if (!st.run) {
    var due = !st.last || !st.last.ms || Date.now() - st.last.ms >= KWS_EVERY_DAYS * 864e5;
    if (!st.ask && !due) return;
    var extra = [];
    try { extra = JSON.parse(kwsProps_().getProperty('KWS_EXTRA') || '[]'); } catch (e) { extra = []; }
    st.run = { by: st.ask ? 'run now' : 'weekly', started: Date.now(), types: kwsTypes_(extra), i: 0, calls: 0, fail: 0, tries: 0 };
    st.ask = 0;
    kwsSave_(st);
  }
  var run = st.run;
  setBrand_('SP');                                       // the catalogue is the same for both brands: Ridhi's credentials read it
  var cache = cacheRead_(KWS_TAB) || {};
  cache.types = cache.types || {};
  var changed = false;
  while (run.i < run.types.length && left() > 45000) {
    var x = run.types[run.i];
    var res = kwsScoutType_(x[0], x[1], x[2]);
    run.calls += res.calls || 1;
    if (res.wait) { run.note = 'Amazon asked us to slow down — going on at the next tick'; break; }
    if (!res.ok) {
      run.tries++;
      if (run.tries < 3) { run.note = x[0] + ': ' + res.err + ' — trying again at the next tick'; break; }
      var old = cache.types[x[0]] || { q: x[1], pt: x[2], items: [], words: [], n: 0 };
      old.err = res.err + ' (' + kwsStamp_() + ') — the last run\'s words kept';
      cache.types[x[0]] = old;                            // never invented: what the last run found stays
      run.fail++;
    } else cache.types[x[0]] = res.rec;
    changed = true;
    run.tries = 0; run.note = '';
    run.i++;
    Utilities.sleep(KWS_GAP_MS);
  }
  var done = run.i >= run.types.length;
  if (changed || done) {
    if (done) {
      var keep = {};
      run.types.forEach(function (t) { keep[t[0]] = 1; });
      Object.keys(cache.types).forEach(function (k) { if (!keep[k]) delete cache.types[k]; });   // a type no longer in our listings
      cache.v = 1; cache.at = kwsStamp_(); cache.ms = Date.now(); cache.by = run.by; cache.top = KWS_TOP; cache.min = KWS_MIN_SHARE;
      cache.partial = false;
    } else cache.partial = true;
    cacheWrite_(KWS_TAB, cache);
  }
  if (done) {
    st.last = { ms: Date.now(), at: kwsStamp_(), by: run.by, types: run.types.length, fail: run.fail, calls: run.calls };
    st.run = null;
  }
  kwsSave_(st);
}

/* ============================== by hand ============================== */
/** Once: the hourly trigger (an old kwsTick trigger is replaced). A run starts when the last one is a week old. */
function kwsInstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'kwsTick') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('kwsTick').timeBased().everyHours(1).create();
  Logger.log('kwsTick runs every hour; the scout reads the bestsellers once every ' + KWS_EVERY_DAYS + ' days (and on "Run now" in Sellora).');
}
/** Run the scout now (from the editor). */
function kwsNow() {
  var st = kwsState_();
  if (!st.run) { st.ask = Date.now(); kwsSave_(st); }
  kwsTick();
  kwsStatusLog();
}
function kwsStatusLog() {
  var s = kwsStatus_(), c = cacheRead_(KWS_TAB);
  Logger.log(JSON.stringify(s));
  if (c && c.types) Object.keys(c.types).forEach(function (k) {
    var t = c.types[k];
    Logger.log(k + ' ("' + t.q + '"): ' + t.n + ' bestsellers of ' + (t.scanned || 0) + ' results, ' + (t.words || []).length + ' words'
      + ((t.words || []).length ? ' — ' + t.words.slice(0, 8).map(function (w) { return w.w + ' ' + w.n; }).join(', ') : '') + (t.err ? ' · ' + t.err : ''));
  });
}
