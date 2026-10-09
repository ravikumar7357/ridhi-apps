/* Pricing-API / ListingOptimiser.gs — Listing Optimiser: audit, missing keywords, SQP, title / bullet / description rules, suggestions.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== Listing optimiser: what the listing IS today =====================
 *
 * Step one of the optimiser is not advice, it is FACTS: what Amazon currently holds for this ASIN.
 * Everything suggested downstream is measured against this, so a wrong or half-read "current" makes
 * every suggestion after it wrong in the same direction and nothing on screen would show it.
 *
 * Three things this deliberately does NOT do:
 *
 *   It does not guess at a missing field. `bullet_point` and `product_description` come back on the
 *   Catalog attributes for a listing this seller contributes to, and NOT AT ALL for one they do not.
 *   An empty array from "Amazon sent nothing" and one from "the seller wrote no bullets" are opposite
 *   problems with opposite fixes, so both are reported, separately, along with the attribute keys
 *   Amazon actually returned.
 *
 *   It does not read BACKEND SEARCH TERMS, because the Catalog API does not carry them and nothing
 *   else public does. They are seller-private and live only on the Listings Items API
 *   (/listings/2021-08-01, `generic_keyword`), which needs the Product Listing role and the seller's
 *   merchant token. Until those exist the field is reported as UNKNOWN, never as empty — an empty
 *   keyword box reads as "no keywords set", which is a decision somebody would act on.
 *
 *   It does not score anything. Scoring belongs with the keyword evidence, which comes from SQP and
 *   the ads search-term cache, not from here.
 */
function listingAudit_(asin) {
  var a = String(asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(a)) return { ok: false, error: 'That is not an ASIN: "' + asin + '"' };

  var r;
  try {
    r = spRetry_('/catalog/2022-04-01/items/' + a + '?marketplaceIds=' + marketplaceId_() +
      '&includedData=summaries,attributes,images,salesRanks', 'get');
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 300) };
  }

  var s = (r.summaries && r.summaries[0]) || {};
  var at = r.attributes || {};
  var out = {
    ok: true, asin: a,
    title: String(s.itemName || ''),
    brand: s.brandName || s.brand || '',
    category: (s.browseClassification && s.browseClassification.displayName) || '',
    // WHAT AMAZON ACTUALLY SENT. Without this list, a blank bullets box is unexplainable: it could be
    // the seller's fault, the role's fault, or this code reading the wrong field name.
    attrKeys: Object.keys(at).sort(),
  };

  // Marketplace-scoped attributes arrive as arrays of {value, marketplace_id}. Flattened here so
  // nothing downstream has to know that shape.
  function vals(key) {
    var v = at[key];
    if (!v) return null;
    if (!Array.isArray(v)) v = [v];
    return v.map(function (x) {
      return (x && typeof x === 'object') ? String(x.value == null ? '' : x.value) : String(x);
    }).filter(function (t) { return t !== ''; });
  }

  var bp = vals('bullet_point');
  out.bullets = bp || [];
  out.bulletsKnown = !!bp;          // false = Amazon sent no bullet_point at all, NOT "no bullets"

  var pd = vals('product_description');
  out.description = pd ? pd.join('\n') : '';
  out.descriptionKnown = !!pd;

  /* Attributes Amazon already holds, which the title rules measure against. These are FACTS about
   * the listing, so suggesting one be added to a title is not inventing a claim — and size and
   * colour are exactly what a shopper scans a results page for. `item_type_keyword` is Amazon's own
   * word for what the product IS, which saves guessing the product type out of the title text. */
  var first = function (k) { var v = vals(k); return v && v.length ? v[0] : ''; };
  out.itemType = first('item_type_keyword');
  out.size = first('size');
  out.color = first('color');
  out.material = first('material');
  out.listPrice = first('list_price');

  // Backend keywords are never on this API. Said out loud rather than left to look empty.
  out.searchTerms = null;
  out.searchTermsWhy = 'Backend search terms are not on the Catalog API and are not public anywhere. '
    + 'They need the Listings Items API (/listings/2021-08-01, generic_keyword), which requires the '
    + 'Product Listing role and this brand’s merchant token.';

  /* IMAGES, BY SLOT. The count on its own says nothing: seven images with no dimensions shot and no
   * close-up is a different listing from seven that cover the set. Amazon names the slots (MAIN,
   * PT01..PT08, SWCH), so what is MISSING is answerable, not a matter of taste. */
  var imgs = (r.images && r.images[0] && r.images[0].images) || [];
  var slots = {}, small = [];
  imgs.forEach(function (im) {
    if (!im || !im.variant || !im.link) return;
    var w = Number(im.width) || 0, h = Number(im.height) || 0;
    var cur = slots[im.variant];
    // One variant comes back at several sizes; keep the largest, which is the one Amazon serves for
    // zoom and the only one whose resolution is worth judging.
    if (!cur || w > cur.w) slots[im.variant] = { w: w, h: h, link: im.link };
  });
  Object.keys(slots).forEach(function (k) {
    // Below 1000px on the long side Amazon does not offer zoom, and zoom is measurably worth having.
    var v = slots[k];
    if (Math.max(v.w, v.h) < 1000) small.push(k + ' (' + v.w + 'x' + v.h + ')');
  });
  out.images = {
    slots: slots,
    n: Object.keys(slots).length,
    hasMain: !!slots.MAIN,
    noZoom: small,
    // PT01..PT06 is the set Amazon's own guidance asks for; naming the empty ones turns "add more
    // images" into a job somebody can actually do.
    emptySlots: ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06'].filter(function (k) { return !slots[k]; }),
  };

  var sr = (r.salesRanks && r.salesRanks[0]) || {};
  var ranks = (sr.classificationRanks || []).concat(sr.displayGroupRanks || []);
  out.rank = ranks.length ? { title: ranks[0].title || '', value: Number(ranks[0].rank) || 0 } : null;

  return out;
}

/**
 * Editor check: run this ONCE before trusting any of the above.
 *
 * It answers the question the whole optimiser is built on and which no amount of reading the docs
 * settles: does Amazon return bullet_point and product_description for THIS seller's own ASINs?
 * If it does, the Listings Items API is needed only for the backend keywords. If it does not, it is
 * needed for all three, and that changes what can be built before the role arrives.
 */
function listingAuditTest(asin) {
  /* FINDS ITS OWN ASIN. The editor's Run button cannot pass an argument, so a test that needs one is
   * a test nobody runs — it just prints "pass an ASIN" and stops. The seller's own Catalog tab
   * already maps SKU to ASIN, so there is a real listing to hand without asking for anything. */
  var a = asin || prop_('TEST_ASIN');
  if (!a) {
    var cat = skuAsinMap_();
    var keys = Object.keys(cat.map || {});
    if (keys.length) {
      a = cat.map[keys[0]];
      Logger.log('No ASIN given — using ' + a + ' (SKU ' + keys[0] + ') from the Catalog tab. '
        + keys.length + ' listing(s) available.');
    }
  }
  if (!a) {
    Logger.log('No ASIN to test. Pass one as the argument, or set TEST_ASIN, '
      + 'or check that the Catalog tab has SKU and ASIN columns (run skuImgTest).');
    return;
  }
  var r = listingAudit_(a);
  if (!r.ok) { Logger.log('FAILED: ' + r.error); return; }
  Logger.log('ASIN ' + r.asin + '  brand=' + r.brand + '  category=' + r.category);
  Logger.log('TITLE (' + r.title.length + ' chars): ' + r.title);
  Logger.log('BULLETS: ' + (r.bulletsKnown
    ? r.bullets.length + ' returned'
    : 'Amazon sent NO bullet_point attribute at all — the Listings Items API is needed for these too'));
  r.bullets.forEach(function (b, i) { Logger.log('   ' + (i + 1) + '. (' + b.length + ') ' + b.slice(0, 120)); });
  Logger.log('DESCRIPTION: ' + (r.descriptionKnown
    ? r.description.length + ' chars' : 'not returned by the Catalog API'));
  Logger.log('IMAGES: ' + r.images.n + ' slot(s) — ' + Object.keys(r.images.slots).join(', '));
  if (r.images.emptySlots.length) Logger.log('   empty: ' + r.images.emptySlots.join(', '));
  if (r.images.noZoom.length) Logger.log('   under 1000px (no zoom): ' + r.images.noZoom.join(', '));
  Logger.log('SEARCH TERMS: unknown by design — ' + r.searchTermsWhy);
  Logger.log('ATTRIBUTE KEYS AMAZON RETURNED (' + r.attrKeys.length + '):');
  Logger.log('   ' + r.attrKeys.join(', '));
}

/* ===================== Listing optimiser: what the listing DOES NOT SAY =====================
 *
 * The suggestions are only worth anything if they come from evidence, so this is the evidence: the
 * search terms shoppers actually used on the way to buying this ASIN, and which of their words the
 * listing does not contain anywhere.
 *
 * WORD BY WORD, NOT PHRASE BY PHRASE. Amazon indexes the words of a listing, not its phrases — a
 * listing containing "cotton" and "bottle" and "sleeve" can be found by "cotton bottle sleeve"
 * without those three words ever standing together. So testing whether the PHRASE appears would
 * report almost every term as missing and bury the handful that really are. The test is: which of a
 * term's words are absent from the listing altogether.
 *
 * The terms come from the ads cache, which is real spend and real orders. Search terms carry no
 * ASIN — Amazon reports them against the AD GROUP — so the join is ASIN → ad groups → their terms,
 * and a group holding several ASINs means its terms belong to all of them. That is a real limit of
 * the report, not of this code, and it is stated on the way out rather than hidden.
 */
var LKW_STOP = ('a,an,and,are,as,at,be,by,for,from,has,in,is,it,its,of,on,or,that,the,to,with,'
  + 'you,your,my,our,this,these,those,i,we,they,them,he,she,his,her,not,no,do,does,did,'
  + 'have,had,but,if,so,than,then,too,very,can,will,just,also,into,out,up,down,over,under').split(',');

/** The words a piece of listing text actually contains. */
function lkwWords_(text) {
  var out = {};
  String(text || '').toLowerCase()
    // Punctuation splits words, but a hyphen inside a word does not: "quick-dry" is searched both
    // ways, so it is kept whole AND split.
    .replace(/[^a-z0-9\-\s]/g, ' ')
    .split(/\s+/).forEach(function (w) {
      if (!w) return;
      out[w] = 1;
      if (w.indexOf('-') >= 0) w.split('-').forEach(function (p) { if (p) out[p] = 1; });
    });
  return out;
}

/* AN ASIN IS NOT A KEYWORD, and it was topping the list.
 *
 * Shoppers paste ASINs into the search box, and ASIN-TARGETED ads report the targeted ASIN as the
 * "search term" — usually a COMPETITOR's. Both arrive here looking like high-converting words nobody
 * has used: b0gjddnzn3 came back with 5 orders and 269 clicks. There is nothing to do with it. You
 * cannot put it in a title, and if it is a rival's ASIN, putting it anywhere would be worse than
 * useless. Dropped from the words AND from the terms. */
var LKW_ASIN_RE = /^b0[a-z0-9]{8}$/i;

/* Amazon does not reliably match a plural to its singular, but a listing that says "covers" plainly
 * does say "cover" to a reader, and reporting it as missing sends somebody to add a word that is
 * already there. Checked both ways — conservative, only the trailing s. */
function lkwHas_(have, w) {
  if (have[w] || have[w + 's']) return true;
  if (w.length > 3 && w.charAt(w.length - 1) === 's' && have[w.slice(0, -1)]) return true;
  return false;
}

/* THE SAME SIZE, WRITTEN ANOTHER WAY — and deliberately NOT called covered.
 *
 * Shoppers search "18x18". The listing says 18" x 18", which breaks into the words 18 and 18. Whether
 * Amazon matches one to the other depends on how it tokenises that string, and I do not know that for
 * certain. Both confident answers are dangerous in opposite directions: calling it MISSING sends
 * somebody to add a size their title already states, and calling it COVERED hides a query the listing
 * may genuinely not rank for — and that one only shows up as sales that never happen.
 *
 * So it is neither. It comes back as its own state, with both forms shown, and the person who can
 * check it decides. The cheap move is to put the joined form in the BACKEND keywords, where it costs
 * nothing and removes the question.
 */
function lkwSizeAlt_(have, w) {
  var m = w.match(/^([0-9]+(?:\.[0-9]+)?)[x\u00d7]([0-9]+(?:\.[0-9]+)?)$/);
  return !!(m && have[m[1]] && have[m[2]]);
}

/** Content words of a search term — stopwords and single characters carry no index weight. */
function lkwTermWords_(term) {
  var out = [], seen = {};
  String(term || '').toLowerCase().replace(/[^a-z0-9\-\s]/g, ' ').split(/\s+/).forEach(function (w) {
    if (!w || w.length < 2) return;
    if (LKW_STOP.indexOf(w) >= 0) return;
    if (LKW_ASIN_RE.test(w)) return;
    if (seen[w]) return;
    seen[w] = 1; out.push(w);
  });
  return out;
}

function listingKeywords_(asin) {
  var a = String(asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(a)) return { ok: false, error: 'That is not an ASIN: "' + asin + '"' };

  var audit = listingAudit_(a);
  if (!audit.ok) return audit;

  var stC = cacheRead_('srchTerm'), agC = cacheRead_('adGroup');
  if (!stC || !agC) {
    return { ok: false, error: 'The ads search-term cache has not been built yet. It is collected by '
      + 'the nightly run — check nightlyStatus() for srchTerm and adGroup.' };
  }

  /* Which ad groups advertise this ASIN. Both caches are per brand, so this walks whatever brands
   * the cache holds rather than assuming the one the request set. */
  var mine = {}, shared = 0;
  Object.keys(agC.d || {}).forEach(function (brand) {
    var groups = (agC.d[brand] && agC.d[brand].groups) || {};
    Object.keys(groups).forEach(function (ag) {
      var list = groups[ag].a || [];
      if (list.indexOf(a) < 0) return;
      mine[ag] = { name: groups[ag].n || '', campaign: groups[ag].cn || '',
        asins: list.length, clean: list.length === 1 };
      // A group carrying several ASINs cannot attribute its terms to one of them. Counted, and said.
      if (list.length > 1) shared++;
    });
  });
  if (!Object.keys(mine).length) {
    return { ok: true, asin: a, terms: [], missing: [], words: [],
      why: 'No advertising ad group carries this ASIN, so there are no search terms to read for it. '
        + 'A product with no Sponsored Products history has no keyword evidence here — the listing '
        + 'can still be judged on its title, bullets and images.' };
  }

  // Every term reported against those groups, added up.
  var byTerm = {};
  Object.keys(stC.d || {}).forEach(function (brand) {
    ((stC.d[brand] && stC.d[brand].rows) || []).forEach(function (r) {
      if (!mine[r.ag]) return;
      var t = String(r.t || '').toLowerCase().trim();
      if (!t) return;
      if (LKW_ASIN_RE.test(t)) return;              // an ASIN is not a keyword
      var b = byTerm[t] || (byTerm[t] = { t: t, i: 0, c: 0, o: 0, s: 0, sp: 0, clean: false });
      // A term seen in even ONE single-ASIN group is safely this product's.
      if (mine[r.ag].clean) b.clean = true;
      b.i += Number(r.i) || 0; b.c += Number(r.c) || 0;
      b.o += Number(r.o) || 0; b.s += Number(r.s) || 0; b.sp += Number(r.sp) || 0;
    });
  });

  // What the listing says, everywhere a shopper's word could be indexed from.
  /* WHAT "the listing never says" WAS CHECKED AGAINST. Returned, because the claim is only as good as
   * the text behind it: if the bullets never arrived, every word looks missing and the whole table is
   * noise that reads like insight. */
  var checked = { title: (audit.title || '').length, bullets: (audit.bullets || []).length,
    description: (audit.description || '').length };
  var have = lkwWords_([audit.title, (audit.bullets || []).join(' '), audit.description].join(' '));

  /* CLEAN AND CONTAMINATED EVIDENCE ARE COUNTED SEPARATELY, NEVER BLENDED.
   *
   * A note saying "some of these may belong to a sibling" is not enough when EVERY group is shared:
   * the first run of this returned pillow, scalloped, euro sham, quilted bag and desk organiser for
   * one ASIN, all of them real terms belonging to other products. A list like that is not a weak
   * answer, it is a wrong one, and acting on it puts a neighbour's words in this listing's title.
   *
   * A term seen in even one SINGLE-ASIN group is this product's beyond doubt; everything else is
   * held apart and labelled. Where there is no clean evidence at all, that is said plainly instead of
   * handing over the contaminated list with a caveat nobody reads. */
  var terms = [], missWord = {}, missClean = {}, altAlt = {};
  Object.keys(byTerm).forEach(function (t) {
    var b = byTerm[t];
    var words = lkwTermWords_(t);
    var raw = words.filter(function (w) { return !lkwHas_(have, w); });
    // Split off the sizes the listing DOES state, just in another form. They are neither missing nor
    // safely covered, so they are counted apart and never mixed into the "never says" list.
    var altForms = raw.filter(function (w) { return lkwSizeAlt_(have, w); });
    var absent = raw.filter(function (w) { return !lkwSizeAlt_(have, w); });
    altForms.forEach(function (w) {
      var m = altAlt[w] || (altAlt[w] = { w: w, orders: 0, clicks: 0, impr: 0, terms: 0, eg: [] });
      m.orders += b.o; m.clicks += b.c; m.impr += b.i; m.terms++;
      if (m.eg.length < 3) m.eg.push(t);
    });
    b.words = words.length;
    b.absent = absent;
    b.covered = absent.length === 0;
    terms.push(b);
    // A word is worth adding in proportion to what the terms containing it actually did.
    absent.forEach(function (w) {
      [missWord, b.clean ? missClean : null].forEach(function (bag) {
        if (!bag) return;
        var m = bag[w] || (bag[w] = { w: w, orders: 0, clicks: 0, impr: 0, terms: 0, eg: [] });
        m.orders += b.o; m.clicks += b.c; m.impr += b.i; m.terms++;
        if (m.eg.length < 4) m.eg.push(t);
      });
    });
  });

  var byOrders = function (x, y) { return (y.o - x.o) || (y.c - x.c) || (y.i - x.i); };
  terms.sort(byOrders);
  var missing = terms.filter(function (b) { return !b.covered; }).slice(0, 120);
  var rank = function (bag) {
    return Object.keys(bag).map(function (w) { return bag[w]; })
      .sort(function (x, y) { return (y.orders - x.orders) || (y.clicks - x.clicks) || (y.impr - x.impr); })
      .slice(0, 60);
  };
  var words = rank(missClean), wordsShared = rank(missWord), altSizes = rank(altAlt);
  var nClean = terms.filter(function (b) { return b.clean; }).length;

  return {
    ok: true, asin: a, checked: checked,
    title: audit.title, bullets: audit.bullets, description: audit.description,
    groups: Object.keys(mine).length, sharedGroups: shared,
    nTerms: terms.length, nClean: nClean,
    terms: terms.slice(0, 120),
    missing: missing,
    // THE ACTIONABLE LIST, from single-ASIN ad groups only. Terms are evidence; WORDS are what goes
    // into a title, a bullet or the backend keywords, and one word usually fixes several terms.
    words: words,
    // The same worked out over every group, contaminated ones included. Kept so the tool can OFFER
    // it, clearly marked, rather than pretending the evidence does not exist — but never as the
    // headline, because these words may be a neighbouring product's.
    wordsShared: wordsShared,
    // Sizes the listing states in a DIFFERENT FORM. Not missing, not confidently covered.
    altSizes: altSizes,
    trust: nClean ? 'clean' : (terms.length ? 'shared' : 'none'),
    note: !terms.length ? ''
      : nClean
        ? (shared ? shared + ' of the ' + Object.keys(mine).length + ' ad group(s) also carry other ASINs; '
            + 'their terms are held back and only the ' + nClean + ' term(s) from single-product groups '
            + 'are used above.' : '')
        : 'EVERY ad group carrying this ASIN also carries others, so NOTHING here can be attributed to '
          + 'this product with confidence. Amazon reports search terms against the ad group, not the '
          + 'ASIN. The words below are the whole ad group, and may belong to a sibling — to get '
          + 'per-ASIN terms, either split the ad groups so one group advertises one product, or use '
          + 'the Search Query Performance report, which is reported per ASIN.',
  };
}

/**
 * HOW MUCH OF THE AD EVIDENCE IS USABLE AT ALL — across every advertised ASIN, not one.
 *
 * B0GK8Z2L13 came back with zero clean terms, and the next decision (build the suggestions on ads
 * data, or add the Search Query Performance report first) turns entirely on whether that is one
 * awkward product or the normal shape of this account. Guessing it would mean building the wrong
 * half first.
 *
 * Reads only the adGroup cache — no API calls, no reports, so it is instant and can be re-run any
 * time the ad structure changes.
 */
function listingKeywordsCoverage() {
  var agC = cacheRead_('adGroup');
  if (!agC) { Logger.log('No adGroup cache yet — check nightlyStatus().'); return; }

  var clean = {}, dirty = {}, groupsPer = {};
  Object.keys(agC.d || {}).forEach(function (brand) {
    var groups = (agC.d[brand] && agC.d[brand].groups) || {};
    Object.keys(groups).forEach(function (ag) {
      var list = groups[ag].a || [];
      list.forEach(function (asin) {
        groupsPer[asin] = (groupsPer[asin] || 0) + 1;
        if (list.length === 1) clean[asin] = (clean[asin] || 0) + 1;
        else dirty[asin] = (dirty[asin] || 0) + 1;
      });
    });
  });

  var all = Object.keys(groupsPer);
  var withClean = all.filter(function (a) { return clean[a]; });
  var onlyDirty = all.filter(function (a) { return !clean[a]; });
  Logger.log(all.length + ' ASIN(s) have ad history.');
  Logger.log('  ' + withClean.length + ' (' + Math.round(withClean.length / all.length * 100)
    + '%) sit in at least one SINGLE-PRODUCT ad group — these get trustworthy keyword evidence.');
  Logger.log('  ' + onlyDirty.length + ' (' + Math.round(onlyDirty.length / all.length * 100)
    + '%) are ONLY in shared groups — for these the ads data cannot say which product a term belongs to.');

  // Group sizes, because "shared" covers everything from a pair to a catch-all of two hundred.
  var sizes = {};
  Object.keys(agC.d || {}).forEach(function (brand) {
    var groups = (agC.d[brand] && agC.d[brand].groups) || {};
    Object.keys(groups).forEach(function (ag) {
      var n = (groups[ag].a || []).length;
      var band = n === 1 ? '1' : n <= 3 ? '2-3' : n <= 10 ? '4-10' : n <= 30 ? '11-30' : '30+';
      sizes[band] = (sizes[band] || 0) + 1;
    });
  });
  Logger.log('');
  Logger.log('AD GROUPS BY HOW MANY PRODUCTS THEY CARRY:');
  ['1', '2-3', '4-10', '11-30', '30+'].forEach(function (b) {
    if (sizes[b]) Logger.log('   ' + b + ' product(s): ' + sizes[b] + ' group(s)');
  });
  Logger.log('');
  Logger.log(withClean.length && withClean.length / all.length > 0.5
    ? 'VERDICT: most products have clean evidence — the ads cache is enough to build the suggestions on.'
    : 'VERDICT: most products have NO clean evidence. The ads cache alone cannot answer "which words '
      + 'does THIS listing miss" for them. Either the ad groups get split one product per group, or '
      + 'the Search Query Performance report is needed, which reports per ASIN.');
}

/** Editor check: the keyword evidence for one real listing, and what it is not saying. */
function listingKeywordsTest(asin) {
  var a = asin || prop_('TEST_ASIN');
  if (!a) {
    var cat = skuAsinMap_(), keys = Object.keys(cat.map || {});
    // The FIRST catalogue ASIN is rarely an advertised one; prefer a SKU the ads cache has heard of,
    // or this prints "no ad group" on a product that simply was never advertised and proves nothing.
    var agC = cacheRead_('adGroup'), advertised = {};
    Object.keys((agC && agC.d) || {}).forEach(function (b) {
      var g = (agC.d[b] && agC.d[b].groups) || {};
      Object.keys(g).forEach(function (k) { (g[k].a || []).forEach(function (x) { advertised[x] = 1; }); });
    });
    for (var i = 0; i < keys.length && !a; i++) if (advertised[cat.map[keys[i]]]) a = cat.map[keys[i]];
    if (!a && keys.length) a = cat.map[keys[0]];
    Logger.log('No ASIN given — using ' + a + (Object.keys(advertised).length
      ? ' (' + Object.keys(advertised).length + ' ASIN(s) have ad history)' : ''));
  }
  var r = listingKeywords_(a);
  if (!r.ok) { Logger.log('FAILED: ' + r.error); return; }
  Logger.log('ASIN ' + r.asin + ' — ' + r.groups + ' ad group(s), ' + r.nTerms + ' search term(s), '
    + r.nClean + ' of them from single-product groups');
  if (r.why) { Logger.log(r.why); return; }
  if (r.note) Logger.log('NOTE: ' + r.note);
  Logger.log('');
  if (r.trust !== 'clean') {
    // The whole point of the split: on contaminated evidence the tool must not print a confident
    // list. It prints the shared one, labelled, and says what would fix it.
    Logger.log('*** NO CLEAN EVIDENCE FOR THIS ASIN — the words below are the AD GROUP’S, and some');
    Logger.log('*** of them belong to other products. Do not put them in this title as they stand.');
    Logger.log('');
    r.wordsShared.slice(0, 12).forEach(function (w) {
      Logger.log('   [group] ' + w.w + '  —  ' + w.orders + ' order(s), ' + w.clicks + ' click(s)   e.g. ' + w.eg.slice(0, 2).join(' / '));
    });
    Logger.log('');
    Logger.log(r.terms.filter(function (b) { return b.covered; }).length + ' of ' + r.nTerms + ' term(s) already covered.');
    return;
  }
  Logger.log('WORDS THE LISTING NEVER SAYS (top 15, by orders behind them):');
  r.words.slice(0, 15).forEach(function (w) {
    Logger.log('   ' + w.w + '  —  ' + w.orders + ' order(s), ' + w.clicks + ' click(s), '
      + w.impr + ' impression(s), in ' + w.terms + ' term(s)   e.g. ' + w.eg.join(' / '));
  });
  Logger.log('');
  Logger.log('TOP TERMS THAT DID NOT CONVERT INTO THE LISTING (top 10):');
  r.missing.slice(0, 10).forEach(function (b) {
    Logger.log('   "' + b.t + '"  ' + b.o + ' order(s), ' + b.c + ' click(s)  —  missing: ' + b.absent.join(', '));
  });
  var covered = r.terms.filter(function (b) { return b.covered; }).length;
  Logger.log('');
  Logger.log(covered + ' of ' + r.nTerms + ' term(s) are already fully covered by the listing text.');
}

/* ===================== SQP for the WHOLE catalogue, per ASIN =====================
 *
 * The ads search-term cache cannot answer "which words does THIS listing miss" for 98% of the
 * catalogue: Amazon reports ad search terms against the AD GROUP, and 1,701 of 1,734 advertised
 * ASINs sit only in groups that carry several products (measured 2026-08-22, listingKeywordsCoverage).
 * A term from such a group may belong to any of them.
 *
 * Search Query Performance is reported PER ASIN, so it does not have that problem at all. And the
 * `asin` report option is OPTIONAL: leave it out and ONE report covers every product the brand owns.
 * That turns a per-listing question that would need 3,646 report round-trips into a single nightly
 * one.
 *
 * Asking and collecting are separate on purpose — Amazon builds these asynchronously and a report
 * sits at IN_PROGRESS for longer than anyone will watch. The pending id is parked in Script
 * Properties so the editor flow is: run once to ask, run again later to collect.
 */
var SQP_PENDING = 'SQP_ALL_PENDING';
var SQP_CACHE = 'sqp';
var SQP_MAX_Q = 40;          // queries kept per ASIN

/** Ask for one brand-wide SQP report. Returns the id; nothing is collected here. */
function sqpAllAsk_(period) {
  var r = baCreate_('sqp', period || 'MONTH', '');    // no ASIN = every product this brand owns
  if (!r.ok) return r;
  return r;
}

/**
 * Collect a finished brand-wide report into a per-ASIN cache.
 *
 * Only what a listing can act on is kept. The full report is one row per ASIN per query and runs to
 * tens of thousands of rows; the cache sheet has already been broken once by a report nobody trimmed
 * (see the search-term cut). Queries are kept per ASIN, best first, capped — and WHAT WAS DROPPED IS
 * COUNTED, because a silent cap reads as "this is everything".
 */
/* One Search Query Performance row, read EXPLICITLY.
 *
 * The generic shaper hunts for field names with regexes, which was fine while nothing depended on
 * getting the right one. Here it is not: this report carries TWO numbers for everything, and they
 * answer opposite questions.
 *
 *   total*  — the WHOLE MARKET for that query. "ruffle pillow covers" drew 96,860 impressions and
 *             1,878 clicks across every seller on Amazon.
 *   asin*   — what THIS listing got out of it: 1,876 impressions, 13 clicks, 2 cart adds.
 *
 * Reading the market number as the product's would tell a seller their listing had 96,860
 * impressions on a query that in fact barely saw them. That is the most expensive mistake this tool
 * could make, because it would be a flattering one — nobody questions a good number.
 *
 * Both are kept, because both matter and they matter differently: the market volume is the size of
 * the opportunity, and the ASIN's share is how much of it the listing is currently taking. A big
 * query with a tiny share is exactly what a listing fix is for.
 */
function sqpRow_(x) {
  var q = x.searchQueryData || {};
  var im = x.impressionData || {};
  var cl = x.clickData || {};
  var ca = x.cartAddData || {};
  var pu = x.purchaseData || {};
  var n = function (v) { return Number(v) || 0; };
  return {
    asin: String(x.asin || '').trim().toUpperCase(),
    q: String(q.searchQuery || '').trim().toLowerCase(),
    // How often the query is searched, and where it ranks. The size of the prize.
    vol: n(q.searchQueryVolume),
    rank: n(q.searchQueryScore),
    // THIS listing.
    i: n(im.asinImpressionCount),
    iShare: n(im.asinImpressionShare),
    c: n(cl.asinClickCount),
    cShare: n(cl.asinClickShare),
    cart: n(ca.asinCartAddCount),
    o: n(pu.asinPurchaseCount),
    oShare: n(pu.asinPurchaseShare),
    // The market, for comparison only. Never to be shown as the listing's own.
    mktI: n(im.totalQueryImpressionCount),
    mktC: n(cl.totalClickCount),
    mktO: n(pu.totalPurchaseCount),
  };
}

function sqpAllCollect_(id, knownAsin) {
  var p = baPoll_(id);
  if (!p.ok) return p;
  if (p.status !== 'done') return { ok: true, status: p.status };
  if (p.kind !== 'sqp') return { ok: false, error: 'That report is not Search Query Performance (got ' + p.kind + ').' };

  /* A REPORT ASKED FOR ONE ASIN DOES NOT REPEAT IT ON EVERY ROW.
   *
   * This is what threw away all 100 rows of the first working report: the collector demanded an
   * `asin` field on each row, and there was none to find, because the request already named it.
   * Amazon was not at fault and neither was the window — the parsing was. When the caller knows
   * which ASIN it asked about, that is the answer for every row. */
  var known = String(knownAsin || '').trim().toUpperCase();
  var byAsin = {}, noAsin = 0, noQuery = 0, kept = 0;
  (p.raw || []).forEach(function (x) {
    var r = sqpRow_(x);
    var a = r.asin || known;
    if (!/^[A-Z0-9]{10}$/.test(a)) { noAsin++; return; }
    if (!r.q) { noQuery++; return; }
    r.asin = a;
    (byAsin[a] || (byAsin[a] = [])).push(r);
  });

  var dropped = 0;
  Object.keys(byAsin).forEach(function (a) {
    var list = byAsin[a];
    // A query is worth keeping in proportion to what it DID, not how often it was searched: a huge
    // query nobody bought from teaches a listing nothing.
    // What the LISTING did first, then the size of the query — a huge query this product never
    // converted is still worth keeping, because that gap is the whole point of the exercise.
    list.sort(function (x, y) { return (y.o - x.o) || (y.c - x.c) || (y.vol - x.vol); });
    if (list.length > SQP_MAX_Q) { dropped += list.length - SQP_MAX_Q; list.length = SQP_MAX_Q; }
    kept += list.length;
  });

  return { ok: true, status: 'done', asins: Object.keys(byAsin).length,
    rows: p.total || 0, kept: kept, dropped: dropped, noAsin: noAsin, noQuery: noQuery,
    // The first raw row, so that when nothing is kept the FIELD NAMES are on screen instead of
    // being guessed at from the outside.
    sample: p.sample || null, d: byAsin };
}

/**
 * Editor flow, two runs.
 *
 * FIRST RUN asks Amazon for the report and parks the id. SECOND RUN (a few minutes later) collects
 * it and writes the cache. Run it a third time and it asks again — the id is cleared once used.
 *
 * This exists to prove the thing the whole design now rests on: that a report asked for WITHOUT an
 * ASIN really does come back with one row per ASIN per query, for every product. If it does not,
 * the per-ASIN plan is wrong and it is better to find out here than after the UI is built on it.
 */
/* SQP IS ONE REPORT PER ASIN. Amazon said so outright when the brand-wide one was tried:
 * "This report type requires the report option(s): asin." So the whole-catalogue idea is dead —
 * 3,646 listings cannot each have a report on demand, and what replaces it is a ROTATION over the
 * products that matter. Before building that, one thing has to be proved: that a report for a
 * product which certainly HAD traffic comes back with rows. The first control returned 0 rows, but
 * it was a low-traffic bottle holder, so zero said nothing either way.
 *
 * This picks the most-advertised ASIN there is — the one with the most ad impressions in the cache —
 * so an empty answer would be a real finding rather than an unlucky pick. */
function sqpTest(period) {
  var props = PropertiesService.getScriptProperties();
  var pend = prop_(SQP_PENDING);

  if (!pend) {
    var pick = sqpBusiestAsin_();
    if (!pick.asin) { Logger.log('No advertised ASIN to test with: ' + pick.why); return; }
    Logger.log('Testing with ' + pick.asin + ' — ' + pick.impr + ' ad impression(s) in the cache, '
      + 'the busiest product there is. An empty report for THIS one would mean something.');
    var r = baCreate_('sqp', period || 'MONTH', pick.asin);
    if (!r.ok) { Logger.log('Could not ask: ' + r.error); return; }
    props.setProperty(SQP_PENDING, r.reportId + '||' + pick.asin);
    Logger.log('Report ' + r.reportId + ' asked for ' + r.period + ' (' + r.window + '). RUN AGAIN in a few minutes.');
    return;
  }

  var parts = pend.split('|'), id = parts[0], asin = parts[2] || '';
  var b = sqpAllCollect_(id, asin);
  if (!b.ok) {
    var dead = /FATAL|CANCELLED/i.test(String(b.error || ''));
    Logger.log((dead ? 'Report failed: ' : 'Not ready: ') + b.error);
    if (b.reason) { Logger.log('AMAZON’S OWN REASON:'); Logger.log('   ' + b.reason); }
    if (dead) props.deleteProperty(SQP_PENDING);
    else Logger.log('The id is still parked — run again shortly.');
    return;
  }
  if (b.status !== 'done') { Logger.log('Still ' + b.status + ' — run again shortly.'); return; }
  props.deleteProperty(SQP_PENDING);

  Logger.log('ASIN ' + asin + ': ' + b.rows + ' row(s), kept ' + b.kept + ' query row(s).');
  if (!b.kept) {
    Logger.log('Nothing kept. ' + b.noAsin + ' row(s) had no ASIN, ' + b.noQuery + ' had no query text.');
    Logger.log('When rows came back but none survived, the fault is in the READING, not the report.');
    if (b.sample) Logger.log('RAW FIRST ROW: ' + JSON.stringify(b.sample).slice(0, 900));
    return;
  }
  Logger.log('(this listing’s own numbers, with the whole query’s market beside them)');
  Object.keys(b.d).forEach(function (a) {
    b.d[a].slice(0, 12).forEach(function (q) {
      Logger.log('   "' + q.q + '"  vol ' + q.vol + '  |  mine: ' + q.i + ' impr, ' + q.c + ' click, '
        + q.cart + ' cart, ' + q.o + ' purch (' + q.iShare + '% of impressions)'
        + '  |  market: ' + q.mktI + ' impr, ' + q.mktO + ' purch');
    });
  });
  Logger.log('');
  Logger.log('SQP WORKS. Next: a nightly rotation — one report per ASIN, N a night, over the products');
  Logger.log('that matter, because the whole catalogue cannot be covered.');
}

/** The advertised ASIN with the most impressions behind it. A meaningful thing to test with. */
function sqpBusiestAsin_() {
  var agC = cacheRead_('adGroup'), stC = cacheRead_('srchTerm');
  if (!agC || !stC) return { asin: '', why: 'the ads caches have not been built yet' };
  var imprOfGroup = {};
  Object.keys(stC.d || {}).forEach(function (brand) {
    ((stC.d[brand] && stC.d[brand].rows) || []).forEach(function (r) {
      imprOfGroup[r.ag] = (imprOfGroup[r.ag] || 0) + (Number(r.i) || 0);
    });
  });
  var best = { asin: '', impr: 0 };
  Object.keys(agC.d || {}).forEach(function (brand) {
    var groups = (agC.d[brand] && agC.d[brand].groups) || {};
    Object.keys(groups).forEach(function (ag) {
      var list = groups[ag].a || [];
      // Split across the ASINs the group carries, so a catch-all of two hundred does not crown a
      // product that happens to sit inside it.
      var share = (imprOfGroup[ag] || 0) / Math.max(1, list.length);
      list.forEach(function (a) {
        var t = (best.byAsin && best.byAsin[a] || 0) + share;
        best.byAsin = best.byAsin || {};
        best.byAsin[a] = t;
        if (t > best.impr) { best.impr = t; best.asin = a; }
      });
    });
  });
  return { asin: best.asin, impr: Math.round(best.impr), why: best.asin ? '' : 'no ASIN carried any impressions' };
}

/* ===================== Listing optimiser: judging a title =====================
 *
 * AMAZON'S RULES, NOT TIKTOK'S. The two tools look similar and their rules are not: TikTok cuts a
 * title at ~40 characters on a phone and wants the product type first with no brand; Amazon shows
 * far more, expects the BRAND first, and indexes every word in the title. Carrying the TikTok rules
 * over would confidently produce worse Amazon titles.
 *
 * What this does NOT do is invent facts. Every suggestion is built from words already in the
 * listing, its own attributes, or the search evidence — never from what the product "probably" is.
 * A title that claims a material or a size the product does not have is a suppression waiting to
 * happen, and it would be this code that wrote it.
 */

/* 75 CHARACTERS. Amazon moved from recommendation to ENFORCEMENT on 27 July 2026: every category
 * except Media is capped at 75 characters including spaces, and Amazon is actively rewriting titles
 * that exceed it (brand owners get 14 days to review its rewrite before it lands).
 *
 * This code said 200 until 2026-08-22, which is the old working limit — so it was calling a
 * 189-character title "inside the limit" when it is two and a half times the cap and Amazon will
 * replace it. Ravi caught that; it was worth checking rather than trusting what was already written.
 *
 * The 200 figure is not gone, it MOVED: the total budget is still 200, now split 75 for the title
 * and 125 for the new ITEM HIGHLIGHTS field. So detail cut from a title is not lost — it has
 * somewhere to go, and saying so is the difference between a useful trim and a destructive one. */
var TT_HARD = 75, TT_HILITE = 125, TT_LONG = 60;

/* Words Amazon's style guide keeps out of titles. Promotional claims, not descriptions — they are
 * also the first thing a listing gets flagged for. */
var TT_BANNED = [
  'best seller', 'bestseller', 'best-seller', 'free shipping', 'sale', 'discount', 'cheap',
  'top rated', 'guarantee', 'guaranteed', '100% quality', 'new arrival', 'limited time',
  'hot item', 'must have', 'amazing', 'perfect gift for everyone',
];

function ttWords_(s) { return String(s || '').trim().split(/\s+/).filter(Boolean); }

/* COMPARING A SIZE TO A TITLE IS A PUNCTUATION PROBLEM, not a text one.
 *
 * The attribute says 12" x 3.75" and the title says 12'' x 3.75'' — the same size, typed two ways,
 * because Amazon's own form and whoever wrote the title reached for different quote characters.
 * Compared literally, the rule reports a size as missing that is already there, and somebody adds it
 * twice. Every kind of quote collapses to one, and so does spacing around x and punctuation. */
function ttNorm_(s) {
  return String(s || '').toLowerCase()
    .replace(/[‘’“”′″]/g, '"')
    .replace(/''/g, '"').replace(/[`´]/g, '"')
    .replace(/\s*x\s*/g, 'x')
    .replace(/[^a-z0-9".]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * What is wrong with a title, as a list of findings — each one checkable, none of them taste.
 *
 * `have` is the listing's own word set, used to answer "is this word anywhere else" so a fix can say
 * whether a word is genuinely absent or merely absent from the title.
 */
function titleFindings_(title, audit) {
  var t = String(title || '');
  var low = t.toLowerCase();
  var out = [];

  if (!t) return [{ k: 'empty', bad: true, msg: 'There is no title.' }];

  if (t.length > TT_HARD) {
    out.push({ k: 'length', bad: true,
      msg: t.length + ' characters, against Amazon’s ' + TT_HARD + '-character cap (enforced since '
        + '27 July 2026, every category except Media). This is not a recommendation — Amazon rewrites '
        + 'titles over the cap itself, and its rewrite is what shoppers will see unless you get there '
        + 'first. The detail you cut belongs in ITEM HIGHLIGHTS, which holds another '
        + TT_HILITE + ' characters.' });
  } else if (t.length > TT_LONG) {
    out.push({ k: 'length', bad: false,
      msg: t.length + ' characters — inside the ' + TT_HARD + '-character cap, with little room left.' });
  }

  // BRAND FIRST. Amazon's style guide asks for it, and a brand buried mid-title reads as a keyword.
  var brand = String((audit && audit.brand) || '').trim();
  if (brand) {
    if (low.indexOf(brand.toLowerCase()) !== 0) {
      out.push({ k: 'brand', bad: true,
        msg: low.indexOf(brand.toLowerCase()) < 0
          ? 'The brand "' + brand + '" is not in the title at all.'
          : 'The title does not START with the brand "' + brand + '".' });
    }
  }

  /* THE PRODUCT TYPE, and where it sits. Amazon returns its own `item_type_keyword` for the listing,
   * so what the product IS does not have to be guessed from the words. A shopper scanning results
   * should meet it early; buried past the halfway mark it is doing nothing. */
  var ptype = String((audit && audit.itemType) || '').replace(/[-_]+/g, ' ').trim();
  /* SOMETIMES item_type_keyword IS THE BROWSE NODE, NOT THE PRODUCT.
   *
   * On B0H367KBV4 it came back as "sports water bottle accessories" — word for word the category
   * name. Told to put that in the title, somebody would, and the title would be worse for it: no
   * shopper types "sports water bottle accessories". A rule that fires confidently on a taxonomy
   * label is worse than one that stays quiet, so when the field is just the category, or ends in a
   * shelf word, it is not used as the product name. */
  var cat = String((audit && audit.category) || '').trim();
  var shelfy = /\s(accessories|products|supplies|sets|items|goods)$/i.test(ptype);
  if (ptype && (ttNorm_(ptype) === ttNorm_(cat) || shelfy)) {
    out.push({ k: 'type', bad: false, skipped: true,
      msg: 'Amazon’s item type for this listing is "' + ptype + '", which is its shelf, not what the '
        + 'product is called — so the title is not judged against it. Name the product in your own '
        + 'words instead, in the first few words.' });
    ptype = '';
  }
  if (ptype) {
    var at = low.indexOf(ptype.toLowerCase());
    if (at < 0) {
      out.push({ k: 'type', bad: true,
        msg: 'Amazon files this as "' + ptype + '" and the title never says it.' });
    } else if (at > t.length / 2) {
      out.push({ k: 'type', bad: false,
        msg: '"' + ptype + '" only appears ' + at + ' characters in — the product type belongs near the front.' });
    }
  }

  /* One phrase, one finding. "guarantee" and "guaranteed" both match the same six letters on the
   * page, and reporting them separately turns one problem into two lines of noise. The longest match
   * wins, because it is the one actually written. */
  var hits = TT_BANNED.filter(function (w) { return low.indexOf(w) >= 0; })
    .sort(function (a, b) { return b.length - a.length; });
  var said = [];
  hits.forEach(function (w) {
    if (said.some(function (o) { return o.indexOf(w) >= 0; })) return;
    said.push(w);
    out.push({ k: 'banned', bad: true, msg: 'Contains "' + w + '", which Amazon’s title guidance disallows.' });
  });

  // ALL-CAPS words. Amazon asks for title case; a shouted word is also a wasted one.
  var caps = ttWords_(t).filter(function (w) {
    return w.length > 3 && w === w.toUpperCase() && /[A-Z]{4}/.test(w);
  });
  if (caps.length) {
    out.push({ k: 'caps', bad: false, msg: caps.length + ' word(s) in capitals (' + caps.slice(0, 4).join(', ')
      + '). Amazon asks for title case.' });
  }

  // A word repeated in a title buys nothing: Amazon indexes it once.
  var seen = {}, dupes = [];
  ttWords_(low.replace(/[^a-z0-9\s]/g, ' ')).forEach(function (w) {
    if (w.length < 4) return;
    if (seen[w] && dupes.indexOf(w) < 0) dupes.push(w);
    seen[w] = 1;
  });
  if (dupes.length) {
    out.push({ k: 'dupe', bad: false,
      msg: 'Repeats ' + dupes.slice(0, 5).map(function (w) { return '"' + w + '"'; }).join(', ')
        + '. Amazon indexes a word once — a repeat costs characters and returns nothing.' });
  }

  /* Attributes Amazon already holds that the title does not mention. These are FACTS from the
   * listing, so putting them in is not a claim — and size and colour are exactly what a shopper
   * scans a results page for. */
  ['size', 'color', 'material'].forEach(function (k) {
    var v = String((audit && audit[k]) || '').trim();
    if (!v) return;
    if (ttNorm_(t).indexOf(ttNorm_(v)) < 0) {
      out.push({ k: 'attr', bad: false, field: k, value: v,
        msg: 'Amazon holds ' + k + ' = "' + v + '" for this listing and the title does not say it.' });
    }
  });

  return out;
}

/** Editor check: judge one real title and print every finding. */
function titleRulesTest(asin) {
  var a = asin;
  if (!a) {
    var cat = skuAsinMap_(), keys = Object.keys(cat.map || {});
    a = prop_('TEST_ASIN') || (keys.length ? cat.map[keys[0]] : '');
  }
  if (!a) { Logger.log('No ASIN to test.'); return; }
  var audit = listingAudit_(a);
  if (!audit.ok) { Logger.log('FAILED: ' + audit.error); return; }
  Logger.log('ASIN ' + audit.asin + '  (' + audit.category + ')');
  Logger.log('TITLE (' + audit.title.length + '): ' + audit.title);
  Logger.log('');
  var f = titleFindings_(audit.title, audit);
  if (!f.length) { Logger.log('No findings — this title passes every rule checked.'); return; }
  f.forEach(function (x) { Logger.log((x.bad ? '  [FIX]  ' : '  [look] ') + x.msg); });
}

/* ===================== Listing optimiser: judging bullets and the description =====================
 *
 * Same discipline as the title rules: every finding is checkable against the listing or against
 * Amazon's own stated guidance, and nothing here invents a fact about the product.
 *
 * The one judgement call worth writing down: an ALL-CAPS LEAD-IN ("PREMIUM QUILTED BOTTLE COVER —")
 * is NOT flagged. Amazon's style guide dislikes capitals, but a short capitalised opener followed by
 * a sentence is the convention across most of the category and it scans well on a phone. A whole
 * bullet in capitals is a different thing and is flagged. Rules that fight a working convention get
 * ignored wholesale, and then the real findings go with them.
 */
var BL_WANT = 5;              // Amazon shows five in almost every category
var BL_LONG = 250;            // past this the tail is cut on a phone
var BL_HARD = 500;            // most categories reject beyond this
var DS_LONG = 2000;

/* Claims Amazon does not allow in bullets or the description. Pricing, availability, contact
 * details and guarantees — the things that get a listing flagged rather than merely ignored. */
var BL_BANNED = [
  'free shipping', 'money back', 'money-back', 'satisfaction guaranteed', 'guarantee',
  'best seller', 'bestseller', 'sale', 'discount', 'cheapest', 'lowest price',
  'www.', 'http', '.com', 'email us', 'contact us', 'call us',
];

function bulletFindings_(bullets, audit) {
  var out = [];
  var list = (bullets || []).map(function (b) { return String(b || ''); }).filter(function (b) { return b.trim(); });

  if (!list.length) {
    return [{ k: 'none', bad: true, msg: 'This listing has no bullet points at all. They are the most '
      + 'read part of a page after the images.' }];
  }
  if (list.length < BL_WANT) {
    out.push({ k: 'count', bad: true,
      msg: 'Only ' + list.length + ' bullet(s). Amazon shows ' + BL_WANT + ' — the empty slots are free space.' });
  }

  var allWords = {}, repeated = {};
  list.forEach(function (b, i) {
    var n = i + 1, low = b.toLowerCase();

    if (b.length > BL_HARD) {
      out.push({ k: 'len', bad: true, bullet: n,
        msg: 'Bullet ' + n + ' is ' + b.length + ' characters. Most categories cut off past ' + BL_HARD + '.' });
    } else if (b.length > BL_LONG) {
      out.push({ k: 'len', bad: false, bullet: n,
        msg: 'Bullet ' + n + ' is ' + b.length + ' characters — a phone shows roughly the first ' + BL_LONG + '.' });
    }

    // A WHOLE bullet shouted. A capitalised opener is the category convention and is left alone.
    var letters = b.replace(/[^a-zA-Z]/g, '');
    if (letters.length > 40 && letters === letters.toUpperCase()) {
      out.push({ k: 'caps', bad: true, bullet: n, msg: 'Bullet ' + n + ' is entirely in capitals.' });
    }

    BL_BANNED.forEach(function (w) {
      if (low.indexOf(w) >= 0) {
        out.push({ k: 'banned', bad: true, bullet: n,
          msg: 'Bullet ' + n + ' contains "' + w + '", which Amazon does not allow in bullets.' });
      }
    });

    // Words shared across bullets. Amazon indexes each once, so a word in all five is four wasted.
    var seenHere = {};
    low.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).forEach(function (w) {
      if (w.length < 5 || seenHere[w]) return;
      seenHere[w] = 1;
      allWords[w] = (allWords[w] || 0) + 1;
      if (allWords[w] >= 4) repeated[w] = allWords[w];
    });
  });

  var rep = Object.keys(repeated);
  if (rep.length) {
    out.push({ k: 'overlap', bad: false,
      msg: rep.slice(0, 6).map(function (w) { return '"' + w + '" (' + repeated[w] + ')'; }).join(', ')
        + ' appear in four or more bullets. Amazon indexes a word once — those repeats are space that '
        + 'could carry something the listing does not say yet.' });
  }

  /* Attributes Amazon holds that no bullet mentions. Facts, not claims — and the bullets are where a
   * shopper looks for exactly these. */
  ['size', 'color', 'material'].forEach(function (k) {
    var v = String((audit && audit[k]) || '').trim();
    if (!v) return;
    /* A SIZE IS NOT A STRING, IT IS ITS NUMBERS.
     *
     * Bullet 2 says "measures 12 inches in height and 3.75 inches in diameter" — the size is plainly
     * stated, just not as 12" x 3.75". Matching the text reports it missing, and somebody adds it a
     * second time. So a size is checked by whether every NUMBER in it appears; colour and material
     * are words, and there the words themselves are the fact. */
    var said;
    if (k === 'size') {
      var nums = v.match(/[0-9]+(?:\.[0-9]+)?/g) || [];
      if (!nums.length) return;
      var text = list.join(' ');
      said = nums.every(function (nm) {
        return new RegExp('(^|[^0-9.])' + nm.replace(/\\./g, '\\\\.') + '([^0-9]|$)').test(text);
      });
    } else {
      said = ttNorm_(list.join(' ')).indexOf(ttNorm_(v)) >= 0;
    }
    if (said) return;
    out.push({ k: 'attr', bad: false, field: k, value: v,
      msg: 'No bullet mentions the ' + k + ' ("' + v + '"), which Amazon already holds for this listing.' });
  });

  return out;
}

function descFindings_(desc, bullets, audit) {
  var d = String(desc || '');
  var out = [];
  if (!d.trim()) {
    return [{ k: 'none', bad: true, msg: 'There is no description. It is indexed, and on a page with '
      + 'no A+ content it is the only place left to answer a question the bullets did not.' }];
  }
  if (d.length > DS_LONG) {
    out.push({ k: 'len', bad: false, msg: d.length + ' characters. Most categories stop indexing past '
      + 'about ' + DS_LONG + '.' });
  }
  if (/<[a-z][^>]*>/i.test(d)) {
    out.push({ k: 'html', bad: false, msg: 'Contains HTML tags. Some categories strip them and show '
      + 'the raw markup instead — worth checking how this renders on the live page.' });
  }
  var low = d.toLowerCase();
  BL_BANNED.forEach(function (w) {
    if (low.indexOf(w) >= 0) {
      out.push({ k: 'banned', bad: true, msg: 'The description contains "' + w + '", which Amazon does not allow.' });
    }
  });

  /* A description that only repeats the bullets is a wasted field: the words are already indexed and
   * the shopper has already read them. */
  var b = (bullets || []).join(' ').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  var bset = {}; b.forEach(function (w) { if (w.length > 4) bset[w] = 1; });
  var dw = low.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 4; });
  var uniq = {}; dw.forEach(function (w) { if (!bset[w]) uniq[w] = 1; });
  var newWords = Object.keys(uniq).length;
  if (dw.length && newWords / dw.length < 0.15) {
    out.push({ k: 'echo', bad: false,
      msg: 'Only ' + Math.round(newWords / dw.length * 100) + '% of the description’s words are not '
        + 'already in the bullets. It is repeating them rather than adding anything.' });
  }
  return out;
}

/** Editor check: judge the bullets and description of one real listing. */
function bulletRulesTest(asin) {
  var a = asin;
  if (!a) {
    var cat = skuAsinMap_(), keys = Object.keys(cat.map || {});
    a = prop_('TEST_ASIN') || (keys.length ? cat.map[keys[0]] : '');
  }
  if (!a) { Logger.log('No ASIN to test.'); return; }
  var r = listingAudit_(a);
  if (!r.ok) { Logger.log('FAILED: ' + r.error); return; }
  Logger.log('ASIN ' + r.asin + '  (' + r.category + ')');
  Logger.log('');
  Logger.log('BULLETS (' + (r.bullets || []).length + '):');
  var bf = bulletFindings_(r.bullets, r);
  if (!bf.length) Logger.log('   nothing to fix.');
  bf.forEach(function (x) { Logger.log((x.bad ? '  [FIX]  ' : '  [look] ') + x.msg); });
  Logger.log('');
  Logger.log('DESCRIPTION (' + r.description.length + ' chars):');
  var df = descFindings_(r.description, r.bullets, r);
  if (!df.length) Logger.log('   nothing to fix.');
  df.forEach(function (x) { Logger.log((x.bad ? '  [FIX]  ' : '  [look] ') + x.msg); });
}

/* ===================== Listing optimiser: the SUGGESTED title =====================
 *
 * The rule this whole file obeys: EVERY WORD IN THE SUGGESTION ALREADY EXISTS. It comes from the
 * current title, from an attribute Amazon holds for the listing, or from a search term shoppers
 * actually used. Nothing is written about the product that was not already true of it.
 *
 * That is not caution for its own sake. A title claiming a material, a size or a certification the
 * product does not have is a suppression, and it would be this function that wrote it — on 3,646
 * listings at once, with nobody reading each one.
 *
 * So this REARRANGES and TRIMS. It does not compose.
 */

/* Words that carry nothing in an Amazon title. Not banned — just the first things to drop when the
 * title has to lose characters, because they say nothing a shopper is searching for. */
var TS_FILLER = ['with', 'and', 'for', 'the', 'a', 'an', 'of', 'in', 'on', 'to', 'your', 'our',
  'perfect', 'great', 'lovely', 'beautiful', 'stylish', 'elegant', 'premium', 'quality'];

/**
 * A suggested title, plus the reason for every change.
 *
 * `add` is the ranked missing-word list when there is trustworthy keyword evidence, and empty when
 * there is not — in which case this still does useful work, because reordering and de-duplicating
 * need no evidence at all.
 */
function titleSuggest_(audit, add, target) {
  /* THE TARGET IS A CHOICE, NOT A RULE, and the difference is worth stating.
   *
   * Amazon's cap is 200 characters. Anything shorter is a decision about what a shopper reads: the
   * first 80 or so are all that show on a phone, so a shorter title puts the words that matter in
   * front of the words that do not. It is a real trade — every phrase dropped is a phrase Amazon can
   * no longer index this listing on — so the caller sets it and everything dropped is named. */
  var cap = Math.max(30, Math.min(Number(target) || TT_HARD, 200));
  var cur = String((audit && audit.title) || '').trim();
  if (!cur) return { ok: false, error: 'No current title to work from.' };

  var brand = String(audit.brand || '').trim();
  var why = [];

  /* The title is read as COMMA-SEPARATED PHRASES, because that is how these titles are written and
   * a phrase is the unit that can be moved or dropped without leaving a fragment behind. Splitting
   * on words instead produces "Cotton Bottle Cover Sleeve Reusable" style rubble. */
  var parts = cur.split(/\s*,\s*/).map(function (p) { return p.trim(); }).filter(Boolean);

  // The brand leads. If it is buried inside the first phrase, it is lifted out rather than repeated.
  var lead = brand;
  if (brand) {
    if (parts.length && parts[0].toLowerCase().indexOf(brand.toLowerCase()) === 0) {
      parts[0] = parts[0].slice(brand.length).replace(/^[\s,\-–—]+/, '');
      if (!parts[0]) parts.shift();
    } else if (cur.toLowerCase().indexOf(brand.toLowerCase()) < 0) {
      why.push('Brand "' + brand + '" put at the front — Amazon asks for it there and it was missing.');
    } else {
      why.push('Brand "' + brand + '" moved to the front.');
    }
  }

  /* De-duplicate WORDS across the whole title. Amazon indexes a word once, so a second "bottle" is
   * characters spent for nothing. The FIRST occurrence stays, because that is the one a reader meets. */
  var seen = {}, dropped = [];
  parts = parts.map(function (p) {
    var kept = p.split(/\s+/).filter(function (w) {
      var k = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!k || k.length < 4) return true;                 // short words are grammar, not keywords
      if (seen[k]) { dropped.push(w); return false; }
      seen[k] = 1;
      return true;
    }).join(' ').trim();
    return kept;
  }).filter(Boolean);
  if (dropped.length) {
    why.push('Removed repeated word(s): ' + dropped.slice(0, 6).join(', ')
      + '. Amazon indexes a word once, so the repeat cost characters and returned nothing.');
  }

  /* Attributes Amazon already holds and the title does not say. FACTS about this listing, so adding
   * one is not a claim. Only colour and size — material is often already in the phrases and is the
   * easiest to get wrong. */
  var extra = [];
  ['color', 'size'].forEach(function (k) {
    var v = String(audit[k] || '').trim();
    if (!v) return;
    var joined = ttNorm_(parts.join(' '));
    if (k === 'size') {
      var nums = v.match(/[0-9]+(?:\.[0-9]+)?/g) || [];
      if (nums.length && nums.every(function (n) { return parts.join(' ').indexOf(n) >= 0; })) return;
    } else if (joined.indexOf(ttNorm_(v)) >= 0) return;
    extra.push(v);
    why.push('Added the ' + k + ' "' + v + '" — Amazon already holds it for this listing and the title did not say it.');
  });

  /* Search words the listing never uses. ONLY from clean evidence: a word taken from a shared ad
   * group may belong to a different product, and putting it here is how a neighbour's keywords end
   * up in this title. The caller decides what counts as clean; this trusts what it is handed. */
  var kw = [];
  (add || []).slice(0, 6).forEach(function (w) {
    var word = String(w.w || w).trim();
    if (!word || seen[word.toLowerCase()]) return;
    kw.push(word);
    seen[word.toLowerCase()] = 1;
  });
  if (kw.length) {
    why.push('Added search word(s) shoppers used and the listing never said: ' + kw.join(', ') + '.');
  }

  var out = [lead].concat(parts.slice(0, 1)).filter(Boolean).join(' ');
  var tail = parts.slice(1).concat(extra.length ? [extra.join(', ')] : []).concat(kw.length ? [kw.join(' ')] : []);

  // TRIM TO FIT, and say what went. Filler goes first, then whole phrases from the END — the front
  // of a title is what a shopper reads and what the index weights.
  var cut = [];
  var build = function () { return [out].concat(tail).filter(Boolean).join(', '); };
  while (build().length > cap && tail.length) {
    var last = tail[tail.length - 1];
    var words = last.split(/\s+/);
    var lean = words.filter(function (w) { return TS_FILLER.indexOf(w.toLowerCase()) < 0; });
    if (lean.length < words.length) { tail[tail.length - 1] = lean.join(' '); continue; }
    cut.push(tail.pop());
  }
  if (cut.length) {
    why.push('Trimmed towards ' + cap + ' characters by dropping from the END, where a title does least '
      + 'work: "' + cut.join('", "') + '". Every one of those is a phrase Amazon can no longer index '
      + 'this listing on — keep them only if the length is worth it.');
  }
  if (build().length > cap) {
    why.push('Could not reach ' + cap + ' characters without cutting into the brand and the product '
      + 'itself, so it stopped at ' + build().length + '.');
  }

  var next = build();
  /* WHAT WAS CUT IS HANDED BACK, not discarded. Since 27 July 2026 the title holds 75 characters and
   * ITEM HIGHLIGHTS holds another 125 — so the phrases trimmed out of a title are not waste, they are
   * the raw material for the field next to it. A tool that only deletes is doing half the job. */
  return { ok: true, current: cur, suggested: next,
    curLen: cur.length, newLen: next.length, why: why,
    cap: cap, cut: cut,
    highlights: cut.length ? cut.join(', ').slice(0, TT_HILITE) : '' };
}

/** Editor check: the current title and the suggested one, side by side, with every reason. */
function titleSuggestTest(asin) {
  var a = asin;
  if (!a) {
    var cat = skuAsinMap_(), keys = Object.keys(cat.map || {});
    a = prop_('TEST_ASIN') || (keys.length ? cat.map[keys[0]] : '');
  }
  var audit = listingAudit_(a);
  if (!audit.ok) { Logger.log('FAILED: ' + audit.error); return; }

  // Only CLEAN keyword evidence is allowed to reach the suggestion.
  var add = [];
  try {
    var kw = listingKeywords_(a);
    if (kw.ok && kw.trust === 'clean') add = kw.words || [];
    else if (kw.ok) Logger.log('(no clean keyword evidence for this ASIN, so no search words are added)');
  } catch (e) { /* keywords are optional here */ }

  var r = titleSuggest_(audit, add);
  if (!r.ok) { Logger.log(r.error); return; }
  Logger.log('ASIN ' + audit.asin);
  Logger.log('');
  Logger.log('CURRENT   (' + r.curLen + '): ' + r.current);
  Logger.log('SUGGESTED (' + r.newLen + '): ' + r.suggested);
  Logger.log('');
  Logger.log('WHY:');
  r.why.forEach(function (w) { Logger.log('   - ' + w); });
}

/* ===================== Listing optimiser: everything about one listing, in one call =====================
 *
 * The screen asks one question — "what is wrong with this listing and what should it say instead" —
 * so it makes one request. Four round trips to Apps Script, each redirecting before it answers,
 * is most of a minute for a page that could have taken one.
 *
 * SQP is NOT included. It is a report Amazon builds asynchronously and it takes minutes; folding it
 * in here would make every listing take as long as the slowest thing in it. The screen asks for it
 * separately, and only when somebody wants it.
 */
function listingReview_(asin, target) {
  var a = String(asin || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(a)) return { ok: false, error: 'That is not an ASIN: "' + asin + '"' };

  var audit = listingAudit_(a);
  if (!audit.ok) return audit;

  /* Keyword evidence is OPTIONAL and never fatal. A product with no ad history is a normal thing,
   * and the rest of the review is still worth showing for it. */
  var kw = null;
  try { kw = listingKeywords_(a); } catch (e) { kw = { ok: false, error: String(e.message || e) }; }
  var clean = (kw && kw.ok && kw.trust === 'clean') ? (kw.words || []) : [];

  return {
    ok: true, asin: a,
    audit: audit,
    findings: {
      title: titleFindings_(audit.title, audit),
      bullets: bulletFindings_(audit.bullets, audit),
      description: descFindings_(audit.description, audit.bullets, audit),
      images: imageFindings_(audit),
    },
    // Only CLEAN evidence reaches the suggestion. A word from a shared ad group may be a neighbour's.
    suggestion: titleSuggest_(audit, clean, target),
    keywords: kw && kw.ok ? {
      trust: kw.trust, groups: kw.groups, nTerms: kw.nTerms, nClean: kw.nClean,
      note: kw.note, checked: kw.checked, words: kw.words || [], wordsShared: kw.wordsShared || [],
      altSizes: kw.altSizes || [],
      missing: (kw.missing || []).slice(0, 40),
    } : { trust: 'none', note: (kw && kw.error) || 'No keyword evidence.', words: [], wordsShared: [], missing: [] },
  };
}

/* Images, judged by SLOT rather than by count.
 *
 * Seven images that are seven angles of the same thing is a different listing from seven that answer
 * seven different questions, and only the slots can tell them apart. Amazon names them, so what is
 * missing is answerable rather than a matter of taste.
 */
function imageFindings_(audit) {
  var out = [], im = (audit && audit.images) || { slots: {}, emptySlots: [], noZoom: [] };
  if (!im.hasMain) {
    out.push({ k: 'main', bad: true, msg: 'There is no MAIN image. Nothing else on the page matters until there is.' });
  }
  var n = im.n || 0;
  if (n < 4) {
    out.push({ k: 'count', bad: true,
      msg: 'Only ' + n + ' image slot(s) filled. Amazon shows up to seven, and the ones past the first '
        + 'are where a shopper decides.' });
  } else if ((im.emptySlots || []).length) {
    out.push({ k: 'count', bad: false,
      msg: n + ' slot(s) filled; ' + im.emptySlots.join(', ') + ' empty. Free space on the page.' });
  }
  if ((im.noZoom || []).length) {
    out.push({ k: 'zoom', bad: true,
      msg: (im.noZoom || []).join(', ') + ' are under 1000px on the long side, so Amazon offers no '
        + 'zoom on them. Zoom is one of the few image things with a measured effect on conversion.' });
  }
  return out;
}

