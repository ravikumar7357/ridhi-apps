/* ================= ADS · AD CONSOLE · RECOMMENDATION: suggestions from ACoS and stock, last 30 days, ranked =================
 * Screens: Ad Console (tab 'trends', pane paneTrends), the Recommendation bar (tHealth). Nothing here runs by itself: ADSX.draw
 * (ads/ads-charts.js) calls ADSH.draw inside a try, and again once the campaign figures have arrived.
 * Does: reads what Search Terms reads — the 30-day search-term, target and ad-group caches — plus the FBA stock where the
 * account may read it, Amazon's listing status (the Image Manager snapshot) likewise, the weekly store and the Ad Console's
 * own daily store, and runs ten checks over the brands in view. Each one, when it finds something, makes one polite
 * suggestion — never an order: lower bids, pause a campaign, stop a search term, restock, send stock before it runs out,
 * pause ads still spending on a product out of stock, fix a listing Amazon took out of search while its ads spend, look at
 * products whose ad spend is above all their sales (TACoS over 100%, no costs needed), raise bids, turn a paused ad back
 * on — with the money involved, the evidence, how it was
 * checked and where the figures came from. A check passes, or cannot run because a right or the data it needs is missing —
 * said, never guessed. Suggestions rank by priority, then by the money involved. The bar stays closed until opened and shows
 * the top suggestion in one line; open, it shows three figures (suggestions, ACoS against the range, money burned), the top
 * suggestion, then the list.
 * THE RULES are the ACoS range (ADSX.state's band): 25–35% is good; over 35% is high — lower bids; under 25% is room to grow —
 * raise bids, but only where the products have stock to spare. Nothing is judged on fewer than 10 orders; launch, ranking and
 * seasonal campaigns (by name) are left out of "lower bids". A campaign or search term is called spend-without-sales only
 * after enough clicks that "no order" is very unlikely to be chance at the account's own conversion rate. Stock comes first:
 * an advertised product out of stock or running low is a suggestion of its own, and a campaign is never told to grow on stock
 * it does not have. Unit costs play no part here.
 * DATA NOTES. A brand whose nightly report failed at Amazon is simply missing from the caches, so each brand's spend in them
 * is checked against the Ad Console's own daily figures; a shortfall, or figures more than two days old, is said above the
 * suggestions — not counted as one.
 * SPEED. The data starts loading the moment the Ad Console is asked for (or the pointer reaches it in the menu), all at
 * once; the checks that need only the campaign figures show first and the search-term one joins when that cache lands.
 * The checks run again only when what they read changes — another period (Day / Week / Month) changes none of it.
 * Once loaded, the three caches are handed to Search Terms, so it opens without fetching them again.
 * THE TABLES list every row (up to 300): the first five, then "Show N more" opens the rest in place. Rows carry the stock of
 * what they advertise, tinted light red (out of stock), light orange (under 7 days) or light yellow (under 15 days) at each
 * product's pace over its last four finished weeks; a campaign row opens that campaign in Campaign performance, and "Show
 * these in Campaign performance" narrows it to the campaigns a suggestion names. A total row closes each table.
 * MONEY AT STAKE (tStake, over the page): the waste the suggestions name, counted once per campaign, up to all of it added up,
 * with a chip per suggestion and the day each source reaches ("Data as of").
 * READ-ONLY: nothing here saves anything, and nothing changes anything at Amazon.
 * Main functions: ADSH.draw — and inside it load, checks, render, stakePaint. */
const ADSH = (() => {
  // Priority: its words, its rank, and what it means (the ⓘ on the bar).
  const SEV = {
    crit: { t: 'Critical', r: 0, tip: 'Sales have stopped.' },
    high: { t: 'High', r: 1, tip: 'Money is going out with little coming back, or a product has run out of stock.' },
    med: { t: 'Medium', r: 2, tip: 'Worth a look soon.' },
    low: { t: 'Low', r: 3, tip: 'An opportunity.' },
  };
  // Where a figure came from — the tags under each suggestion.
  const SRC = {
    ADS: 'Amazon Ads reports — Sponsored Products only, sales credited within 30 days of a click. The nightly caches Search Term Analysis reads.',
    STOCK: 'FBA stock as Listing Health last saved it.',
    AMZ: 'Amazon\'s listing status as the Image Manager last saved it — the snapshot Listing Health reads too.',
    WEEKLY: 'Weekly sales and ad spend per product (the PPC & Organic store) over the last four finished weeks.',
    DERIVED: 'Worked out here from the figures above.',
  };
  const SHOW = 6;                 // suggestions listed before "Show all"
  const EV_ROWS = 5;              // evidence rows shown before "Show N more"
  const EV_CAP = 300;             // evidence rows listed at most (the rest are counted)
  const LOW_COVER = 15;           // days of stock under which an advertised product is "running low" (the yellow tint)
  const TINT = { out: 0, soon: 7, low: LOW_COVER };   // the stock tints: out of stock, under 7 days, under 15 days
  const STALE_DAYS = 2;           // caches older than this many days count as stale
  const MIN_ORDERS = 10;          // orders a campaign needs in the 30 days before its ACoS is judged
  const BURN_EXPECT = 2;          // a search term is spend-without-sales once its clicks would usually have brought this many orders
  const BURN_MAX_CLICKS = 40;     // … but never asks for more clicks than this
  const PAUSE_EXPECT = 3;         // the same for a whole campaign, more surely: the orders its clicks would usually have brought
  const PAUSE_MIN_CLICKS = 15;    // … never on fewer clicks than this
  const PAUSE_MAX_CLICKS = 60;    // … and never asking for more than this
  const RAISE_COVER = 30;         // days of stock a campaign's selling products need before a bid increase is suggested
  const COVER_MIN = 80;           // % of a brand's ad spend the campaign and search-term caches should hold
  const COVER_MIN_SPEND = 100;    // a brand that spent less than this on ads in the 30 days is not checked
  const TACOS_MIN_SPEND = 50;     // ad spend over the four weeks below which "ad spend above sales" is not judged
  const TRI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';
  const CHEV = '<svg class="adh-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const BULB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/></svg>';

  // st = idle / loading / ready; src = each source's own state (terms, tgts, stock: loading / ready / failed / none);
  // terms, tgts = the two caches per brand; flat = the search terms per brand with their lower-case text, made once;
  // stock = per brand { sku → FBA units }; stockAt = per brand when Listing Health saved it; stSum = each brand's search-term
  // spend, added up once; at = when the search-term cache was built; miss = what failed; ver = bumped as each source lands;
  // sig = what the bar last drew; all = "Show all"; open = the bar is open; seen = it has been opened once.
  // exp = the suggestions whose table is opened to every row.
  // amz = Amazon's listing status per "<brand>|<sku>" (the Image Manager snapshot, AMZ.map); amzAt = when each brand's was saved.
  const HS = { st: 'idle', src: { terms: 'idle', tgts: 'idle', stock: 'idle', amz: 'idle' }, terms: null, tgts: null, flat: null, stock: null, stockAt: {},
    amz: null, amzAt: {},
    stSum: null, at: '', miss: {}, ver: 0, sig: '', all: false, open: false, seen: false, memo: new Map(), exp: new Set() };

  /* ---------- small helpers ---------- */
  const esc = s => String(s == null ? '' : s)
    .replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const can = t => ME.admin || ME.tabs.includes(t);
  const dollars = v => (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
  const pct = v => (v == null ? '—' : v.toFixed(1) + '%');
  const plural = (n, one, many) => (n === 1 ? one : (many || one + 's'));
  const quote = t => '“' + esc(t) + '”';
  const cnt = n => Number(n).toLocaleString('en-US');
  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const pct0 = v => (v == null ? '…' : Math.round(v) + '%');
  // A day as "5 Oct": a yyyy-mm-dd day as it is written, a Date in this computer's own time.
  // The light tint a stock level { st, days } gets: out of stock, under 7 days, under 15 days — none above, or when not known.
  const tint = s => (!s || s.st == null ? '' : s.st <= TINT.out ? 'adh-k0' : s.days == null ? '' : s.days < TINT.soon ? 'adh-k7' : s.days < TINT.low ? 'adh-k15' : '');
  // { st, days } of one SKU from the FBA stock (days at its product's pace over the last four finished weeks), or null.
  function stockInfo(b, sku, a) {
    const m = HS.stock && HS.stock[b];
    if (!m || !sku || !has(m, sku)) return null;
    const st = Number(m[sku]) || 0;
    ADSX.paceFresh();
    const p = a ? ADSX.lines(a) : null;
    return { st, days: p && p.perDay > 0 ? st / p.perDay : null, perDay: p ? p.perDay : null };
  }
  const dayTxt = d => (d instanceof Date ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : new Date(String(d).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }));

  /* ---------- the data: once per session, all at once, each part shown as it lands ---------- */
  async function load() {
    const landed = () => {
      HS.ver++;
      paint();
    };
    const grab = async name => {
      try {
        const r = await baCall({ cache: name });
        const d = (r && r.data) || {};
        return { d: d.d || {}, at: d.at || '' };
      } catch (e) {
        HS.miss[name] = (e && e.message) || String(e);
        return null;
      }
    };
    const jobs = [];
    // --- the two caches: Search Terms' copy when it already has them ---
    if (ST.loaded) {
      HS.terms = ST.terms || {};
      HS.tgts = ST.tgts || {};
      HS.at = ST.at || '';
      HS.src.terms = HS.src.tgts = 'ready';
    } else {
      HS.src.terms = HS.src.tgts = 'loading';
      jobs.push(grab('srchTerm').then(x => {
        if (x) {
          HS.terms = x.d;
          HS.at = x.at;
        }
        HS.src.terms = x ? 'ready' : 'failed';
        landed();
      }));
      jobs.push(grab('targeting').then(x => {
        if (x) HS.tgts = x.d;
        HS.src.tgts = x ? 'ready' : 'failed';
        landed();
      }));
    }
    // --- FBA stock: only for an account the database lets read it ---
    const restock = () => { try { ADSX.campRedraw(); } catch (e) { /* its chips wait for the next redraw */ } };
    if (CP.loaded && Object.keys(CP.stock).length) {
      HS.stock = CP.stock;
      HS.stockAt = CP.stockAt || {};
      HS.src.stock = 'ready';
      Promise.resolve().then(restock);
    } else if (can('health') || can('age') || can('shop')) {
      HS.src.stock = 'loading';
      jobs.push(Promise.all(['SP', 'CPC'].map(async b => {
        try {
          const snap = await getDoc(doc(db, 'stock', b));
          if (!snap.exists()) return null;
          const d = snap.data();
          return [b, d.m || {}, d.at && d.at.toDate ? d.at.toDate() : null];
        } catch (e) { return null; }
      })).then(list => {
        const got = list.filter(Boolean);
        if (got.length) {
          HS.stock = Object.fromEntries(got.map(([b, m]) => [b, m]));
          HS.stockAt = Object.fromEntries(got.map(([b, , at]) => [b, at]));
        }
        HS.src.stock = got.length ? 'ready' : 'failed';
        landed();
        restock();
      }));
    } else HS.src.stock = 'none';
    // --- Amazon's listing status (taken out of search?): the Image Manager's snapshot, read once — the same one Listing
    //     Health reads (amzEnsure, listing/listing-rules.js), only for an account the database lets read it ---
    if (typeof amzEnsure === 'function' && (can('img') || can('lerr'))) {
      HS.src.amz = 'loading';
      jobs.push((async () => {
        try {
          if (!AMZ.map) {
            await amzEnsure();
            for (let i = 0; AMZ.busy && i < 120; i++) await new Promise(r => setTimeout(r, 250));   // another screen is reading it
          }
          HS.amz = AMZ.map || null;
          HS.amzAt = { SP: AMZ.snapAt.SP || 0, CPC: AMZ.snapAt.CPC || 0 };
        } catch (e) { HS.amz = null; }
        HS.src.amz = HS.amz ? 'ready' : 'failed';
        landed();
      })());
    } else HS.src.amz = 'none';
    await Promise.all(jobs);
    HS.st = 'ready';
    landed();
  }

  // Hand the three caches to Search Terms once they are all here, exactly as its own ensureSt would have set them — so it
  // opens without downloading them again. Only when it has not loaded its own, and only with all three complete.
  function share(c) {
    try {
      if (ST.loaded || c.st !== 'ready' || HS.src.terms !== 'ready' || HS.src.tgts !== 'ready') return;
      ST.terms = HS.terms;
      ST.tgts = HS.tgts;
      ST.ag = c.ag;
      ST.at = HS.at;
      ST.loaded = true;
    } catch (e) { /* Search Terms loads its own, as before */ }
  }

  // The search terms of one brand, each with its brand and its lower-case text, made once per load (not on every check).
  function flat(b) {
    if (!HS.terms) return [];
    if (!HS.flat) HS.flat = {};
    return HS.flat[b] || (HS.flat[b] = ((HS.terms[b] || {}).rows || []).map(r => Object.assign({ brand: b, lt: String(r.t).toLowerCase().trim() }, r)));
  }

  // The search-term spend of one brand: its rows and what the nightly run folded away under its click floor. Once per load.
  function stSpendOf(b) {
    if (!HS.terms) return 0;
    if (!HS.stSum) HS.stSum = {};
    if (!has(HS.stSum, b)) {
      const p = HS.terms[b] || {};
      HS.stSum[b] = (p.rows || []).reduce((t, r) => t + (r.sp || 0), 0) + (Number(p.dropSpend) || 0);
    }
    return HS.stSum[b];
  }

  /* ---------- the checks: ACoS and stock only ---------- */
  // Seven checks, each a suggestion when it finds something: lower bids, pause a campaign, stop a search term, restock,
  // send stock before it runs out, raise bids, turn a paused ad back on. Every check returns { id, name, st: 'found' |
  // 'pass' | 'na' | 'wait', … }; a suggestion also carries sev, cat, title, act (the suggestion, in one sentence), why,
  // money { v, l, kind: 'waste' | 'risk' | 'gain' | 'plain' }, kv (three figures), ev (evidence: a table, a jump to
  // Campaign performance, or both), how, src (tags) and link (the screen to act in). A data note (st: 'note') is not a
  // suggestion: it says what the suggestions cannot see — a brand missing from the 30-day figures, or figures that are old.
  function checks(c) {
    const out = [];
    const brands = c.brands;
    const BAND = c.band;
    // --- each ASIN's pace over its last four finished weeks (ADSX.lines), for days of stock ---
    ADSX.paceFresh();
    const beOf = a => ADSX.lines(a);
    // --- the ad-group rows of the brands in view, and the names ---
    const agRows = [];
    brands.forEach(b => ((c.ag[b] || {}).rows || []).forEach(x => agRows.push(Object.assign({ brand: b }, x))));
    const cname = (b, cid) => ((c.ag[b] || {}).names || {})[cid] || (((HS.terms || {})[b] || {}).names || {})[cid] || cid;
    const stockOf = x => {
      const m = HS.stock && HS.stock[x.brand];
      return m && x.sku && has(m, x.sku) ? Number(m[x.sku]) || 0 : null;
    };
    // Days of stock at the product's own pace; null when the pace is not known.
    const daysOf = (x, st) => {
      const p = x.a ? beOf(x.a) : null;
      return st != null && p && p.perDay > 0 ? st / p.perDay : null;
    };
    // --- the search terms of the brands in view ---
    const terms = [].concat(...brands.map(flat));
    // --- how much of each brand's ad spend the two caches hold, against the Ad Console's daily figures over the same 30 days.
    //     A brand whose report failed at Amazon is missing from them: the checks below would be short by it, so it is said
    //     (a data note) and, when every brand in view is missing, the checks that read that cache do not run ---
    const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
    const cover = [];
    brands.forEach(b => {
      const tp = (HS.terms || {})[b] || {};
      const to = isDay(tp.to) ? tp.to : c.ad.to;
      const from = isDay(tp.from) ? tp.from : (isDay(c.ad.to) ? sdShift(c.ad.to, -29) : '');
      if (!isDay(from) || !isDay(to)) return;
      const tr = ADSX.trendSum([b], from, to).spend;
      if (!(tr >= COVER_MIN_SPEND)) return;
      const ag = ((c.ag[b] || {}).rows || []).reduce((t, x) => t + (x.sp || 0), 0);
      const st = HS.src.terms === 'ready' && HS.terms ? stSpendOf(b) : null;
      cover.push({ b, name: BRAND_NAME[b] || b, from, to, tr, ag, st, agP: ag / tr * 100, stP: st == null ? null : st / tr * 100 });
    });
    const namesOf = list => list.map(x => x.name).join(' and ');
    const allOut = k => cover.length > 0 && cover.length === brands.length && cover.every(x => x[k] != null && x[k] <= 0);
    const noAg = allOut('ag') ? `no campaign figures for ${namesOf(cover)}` : '';
    // A check that needs a source still on its way waits (st: 'wait') rather than saying it cannot run.
    const termsWait = HS.src.terms === 'loading' || HS.src.terms === 'idle';
    const noTerms = termsWait ? 'wait' : (!HS.terms ? 'the search-term cache could not be read'
      : allOut('st') ? `no search-term figures for ${namesOf(cover)}` : '');
    const stockWait = HS.src.stock === 'loading' || HS.src.stock === 'idle';
    const noStock = 'needs the FBA stock (Listing Health or Inventory Age right)';
    const notRun = (id, name, why) => out.push(why === 'wait' ? { id, name, st: 'wait' } : { id, name, st: 'na', why });
    const rows = c.rows;
    // A campaign that is running: an ad in it is enabled, or its status is not known.
    const live = r => !r.st || !r.st.size || r.st.has('E') || r.st.has('?');
    // The running campaigns with enough orders to judge their ACoS.
    const judged = rows.filter(r => live(r) && r.o >= MIN_ORDERS && r.acos != null);
    // When Listing Health saved each brand's FBA stock — and, for the SKU a stock suggestion names, a gentle word when it is old.
    const savedOf = b => { const d = HS.stockAt && HS.stockAt[b]; return d instanceof Date && !isNaN(d.getTime()) ? d : null; };
    const saved = brands.filter(savedOf);
    const stockText = saved.map(b => (saved.length > 1 ? (BRAND_NAME[b] || b) + ' ' : '') + dayTxt(savedOf(b))).join(', ');
    const stockOld = b => {
      const d = savedOf(b), age = d ? Math.floor((Date.now() - d.getTime()) / 864e5) : 0;
      return d && age > STALE_DAYS ? ` — though that stock figure is from ${dayTxt(d)} (${age} days ago), so a refresh of Listing Health would confirm it` : '';
    };
    const stockKv = ['FBA stock saved', stockText ? esc(stockText) : 'not known'];
    const stockHow = stockText ? ` FBA stock as Listing Health saved it: ${stockText}.` : '';
    // Each campaign's advertised SKUs that sold in the 30 days, with their FBA stock and days of it.
    const campStock = {};
    agRows.forEach(x => {
      if (!x.sku || !(x.o > 0)) return;
      const k = x.brand + '|' + x.cid, st = stockOf(x);
      (campStock[k] || (campStock[k] = [])).push({ sku: x.sku, st, days: daysOf(x, st) });
    });
    // The tightest stock among a campaign's selling SKUs: { sku, st, days, n } or null when none is known.
    const tight = r => {
      const s = (campStock[r.brand + '|' + r.cid] || []).filter(x => x.st != null);
      if (!s.length) return null;
      const rank = x => (x.st <= 0 ? -1 : x.days == null ? 1e9 : x.days);
      return Object.assign({ n: new Set(s.map(x => x.sku)).size }, s.slice().sort((p, q) => rank(p) - rank(q))[0]);
    };
    // Whole days left, rounded down (6.6 days is "6", so the number always agrees with its tint).
    const daysCell = s => (!s ? '—' : s.st <= 0 ? '0' : s.days == null ? '—' : cnt(Math.max(1, Math.floor(s.days))));
    const stockCells = s => (s ? [`<span title="${esc(s.sku)}${s.n > 1 ? ` — the tightest of the ${s.n} products it sells` : ''}">${cnt(s.st)}</span>`, daysCell(s)] : ['—', '—']);
    // One evidence row for a campaign: its name, the figures, the stock of what it sells; tinted by that stock, and
    // opening the campaign in Campaign performance.
    const campRow = (r, figs) => {
      const s = tight(r);
      return { c: [esc(r.name || r.cid)].concat(figs, stockCells(s)), t: tint(s), k: r.brand + '|' + r.cid };
    };
    const sum = (list, f) => list.reduce((t, r) => t + (f(r) || 0), 0);
    const stockHead = ['FBA stock', 'Days left'];
    // [key, $] pairs → { key: $ added up }: the money of a suggestion per campaign, for Money at stake.
    const perMap = pairs => {
      const m = {};
      pairs.forEach(([k, v]) => { if (v > 0) m[k] = (m[k] || 0) + v; });
      return m;
    };

    /* 1 · lower bids: running campaigns above the range */
    const NAME_LO = `Every campaign with enough orders is at or under ${BAND.high}% ACoS`;
    const high = judged.filter(r => r.acos > BAND.high);
    const lower = high.filter(r => !r.invest).map(r => Object.assign({ over: Math.max(0, r.sp - r.s * BAND.high / 100) }, r))
      .sort((p, q) => q.over - p.over);
    const invHigh = high.filter(r => r.invest);
    if (noAg) notRun('lower', NAME_LO, noAg);
    else if (!lower.length) out.push({ id: 'lower', name: NAME_LO, st: 'pass' });
    else {
      const top = lower[0], over = lower.reduce((t, r) => t + r.over, 0);
      out.push({ id: 'lower', name: NAME_LO, st: 'found', sev: 'high', cat: 'Lower bids',
        title: `${cnt(lower.length)} ${plural(lower.length, 'campaign is', 'campaigns are')} running above ${BAND.high}% ACoS`,
        act: `It may be worth lowering bids on ${quote(top.name || top.cid)} first — its ACoS is ${pct(top.acos)} on ${dollars(top.sp)} of spend over 30 days.`,
        why: `Above ${BAND.high}%, each ad sale costs more than your good range allows. Easing bids a little at a time (say 10–15%) and looking again after a week usually brings ACoS down without losing the sales that convert.`
          + (invHigh.length ? ` ${cnt(invHigh.length)} launch, ranking or seasonal ${plural(invHigh.length, 'campaign is', 'campaigns are')} above ${BAND.high}% too and ${invHigh.length === 1 ? 'is' : 'are'} left out here, as ${invHigh.length === 1 ? 'it may be' : 'they may be'} meant to cost more for a while.` : ''),
        money: { v: over, l: `spent above ${BAND.high}% ACoS, 30 days`, kind: 'waste' },
        per: perMap(lower.map(r => [r.brand + '|' + r.cid, r.over])),
        kv: [['Campaigns', cnt(lower.length)], ['Their ad spend', dollars(lower.reduce((t, r) => t + r.sp, 0))], [`Spent above ${BAND.high}%`, dollars(over)]],
        ev: { head: ['Campaign', 'ACoS', 'Spend', 'Ad sales', 'Orders', `Above ${BAND.high}%`].concat(stockHead), num: [1, 2, 3, 4, 5, 6, 7], n: lower.length,
          rows: lower.slice(0, EV_CAP).map(r => campRow(r, [pct(r.acos), dollars(r.sp), dollars(r.s), cnt(Math.round(r.o)), dollars(r.over)])),
          tot: ['Total', pct(sum(lower, r => r.sp) / sum(lower, r => r.s) * 100), dollars(sum(lower, r => r.sp)), dollars(sum(lower, r => r.s)),
            cnt(Math.round(sum(lower, r => r.o))), dollars(over), '', ''],
          jump: lower.map(r => r.brand + '|' + r.cid), text: `${lower.length === 1 ? 'It is the red row' : 'They are the red rows'} in Campaign performance, below.` },
        how: `Running campaigns with ${MIN_ORDERS} or more orders in the 30 days and an ACoS over ${BAND.high}%. "Above ${BAND.high}%" is the spend beyond ${BAND.high}% of their ad sales. Launch, ranking and seasonal campaigns (by their names) are left out.`,
        src: ['ADS', 'DERIVED'] });
    }

    /* 2 · pause: running campaigns that spend and never sell — only once that is very unlikely to be bad luck */
    const agClicks = agRows.reduce((t, x) => t + (x.c || 0), 0), agOrders = agRows.reduce((t, x) => t + (x.o || 0), 0);
    const cvrC = agClicks > 0 ? agOrders / agClicks : 0;
    const needC = cvrC > 0 ? Math.min(PAUSE_MAX_CLICKS, Math.max(PAUSE_MIN_CLICKS, Math.ceil(PAUSE_EXPECT / cvrC))) : PAUSE_MAX_CLICKS;
    const NAME_PA = 'No running campaign spends without a sale';
    if (noAg) notRun('pause', NAME_PA, noAg);
    else {
      const dead = rows.filter(r => live(r) && r.sp > 0 && !(r.o > 0) && !(r.s > 0) && (r.cl || 0) >= needC).sort((p, q) => q.sp - p.sp);
      if (!dead.length) out.push({ id: 'pause', name: NAME_PA, st: 'pass' });
      else {
        const top = dead[0], sp = dead.reduce((t, r) => t + r.sp, 0);
        const odds = cvrC > 0 ? Math.round(1 / Math.pow(1 - cvrC, needC)) : null;
        out.push({ id: 'pause', name: NAME_PA, st: 'found', sev: 'high', cat: 'Pause',
          title: `${cnt(dead.length)} ${plural(dead.length, 'campaign')} spent with no sales`,
          act: `Pausing ${quote(top.name || top.cid)} could be worth considering — ${dollars(top.sp)} on ${cnt(top.cl)} clicks over 30 days without an order.`,
          why: `At your ${(cvrC * 100).toFixed(1)}% conversion rate, ${needC} clicks would usually bring about ${PAUSE_EXPECT} orders${odds ? ` — none at all happens by chance only about 1 time in ${odds}` : ''}. A look at its targets first, or a pause, stops the spend.`,
          money: { v: sp, l: 'their spend, 30 days', kind: 'waste' },
          per: perMap(dead.map(r => [r.brand + '|' + r.cid, r.sp])),
          kv: [['Campaigns', cnt(dead.length)], ['Their spend', dollars(sp)], ['Clicks before judging', String(needC)]],
          ev: { head: ['Campaign', 'Clicks', 'Spend', 'Orders'].concat(stockHead), num: [1, 2, 3, 4, 5], n: dead.length,
            rows: dead.slice(0, EV_CAP).map(r => campRow(r, [cnt(r.cl), dollars(r.sp), '0'])),
            tot: ['Total', cnt(sum(dead, r => r.cl)), dollars(sp), '0', '', ''],
            jump: dead.map(r => r.brand + '|' + r.cid), text: `${dead.length === 1 ? 'It is marked' : 'They are marked'} "Spend, no sales" in Campaign performance, below.` },
          how: `Running campaigns with spend and no order in the 30 days after ${needC} or more clicks — enough for ${PAUSE_EXPECT} orders at the account's own conversion rate (orders ÷ clicks over every campaign in view), and never fewer than ${PAUSE_MIN_CLICKS}.`,
          src: ['ADS', 'DERIVED'] });
      }
    }

    /* 3 · stop a search term: spend and no order — only once that is very unlikely to be bad luck */
    const NAME_B = 'No search term spends without orders';
    if (noTerms) notRun('burn', NAME_B, noTerms);
    else {
      const clicks = terms.reduce((t, r) => t + (r.c || 0), 0), orders = terms.reduce((t, r) => t + (r.o || 0), 0);
      const cvr = clicks > 0 ? orders / clicks : 0;
      const need = cvr > 0 ? Math.min(BURN_MAX_CLICKS, Math.max(CP_MIN_CLICKS, Math.ceil(BURN_EXPECT / cvr))) : BURN_MAX_CLICKS;
      const odds = cvr > 0 ? Math.round(1 / Math.pow(1 - cvr, need)) : null;
      const list = terms.filter(r => r.sp > 0 && !(r.o > 0) && r.c >= need).sort((p, q) => q.sp - p.sp);
      if (!list.length) out.push({ id: 'burn', name: NAME_B, st: 'pass' });
      else {
        const top = list[0], burned = list.reduce((t, r) => t + r.sp, 0);
        out.push({ id: 'burn', name: NAME_B, st: 'found', sev: 'med', cat: 'Pause',
          title: `${cnt(list.length)} search ${plural(list.length, 'term')} spent with no order`,
          act: `Adding ${quote(top.t)} as a negative in ${esc(cname(top.brand, top.cid))} might be worth it — ${dollars(top.sp)} on ${top.c} clicks and no order.`,
          why: `At your ${(cvr * 100).toFixed(1)}% conversion rate, ${need} clicks would usually bring about ${BURN_EXPECT} orders${odds ? ` — none at all happens by chance only about 1 time in ${odds}` : ''}. A negative stops paying for that search without touching the rest.`,
          money: { v: burned, l: 'spent with no order, 30 days', kind: 'waste' },
          per: perMap(list.map(r => [r.brand + '|' + r.cid, r.sp])),
          kv: [['Search terms', cnt(list.length)], ['Spend', dollars(burned)], ['Clicks before judging', String(need)]],
          ev: { head: ['Search term', 'Campaign', 'Clicks', 'Spend'], num: [2, 3],
            n: list.length, rows: list.slice(0, EV_CAP).map(r => ({ c: [esc(r.t), esc(cname(r.brand, r.cid)), String(r.c), dollars(r.sp)], k: r.brand + '|' + r.cid })),
            tot: ['Total', '', cnt(sum(list, r => r.c)), dollars(burned)] },
          how: `Search terms with no order after ${need} or more clicks in the 30 days: enough for ${BURN_EXPECT} orders at the account's own conversion rate (orders ÷ clicks over every search term in view), and never fewer than ${CP_MIN_CLICKS}.`,
          src: ['ADS', 'DERIVED'], link: { tab: 'St', v: 'burn', t: 'Open Search Term Analysis · Burning money' } });
      }
    }

    /* 4 and 5 · stock: out of stock, and about to run out */
    const liveAds = agRows.filter(x => x.st === 'E' && x.sku);
    const bySku = rule => {
      const m = {};
      liveAds.forEach(x => {
        const st = stockOf(x);
        if (!rule(x, st)) return;
        const k = x.brand + '|' + x.sku;
        const r = m[k] || (m[k] = { brand: x.brand, sku: x.sku, a: x.a, stock: st, o: 0, s: 0, sp: 0, camps: new Set(), ks: new Set() });
        r.o += x.o || 0;
        r.s += x.s || 0;
        r.sp += x.sp || 0;
        r.camps.add(cname(x.brand, x.cid));
        r.ks.add(x.brand + '|' + x.cid);
      });
      return Object.values(m);
    };
    const NAME_O = 'No advertised product is out of stock', NAME_L = 'No advertised product runs out within ' + LOW_COVER + ' days';
    if (noAg || !HS.stock) {
      notRun('oos', NAME_O, noAg || (stockWait ? 'wait' : noStock));
      notRun('low', NAME_L, noAg || (stockWait ? 'wait' : noStock));
    } else {
      const oos = bySku((x, st) => st === 0 && x.o > 0).sort((p, q) => q.s - p.s);
      if (!oos.length) out.push({ id: 'oos', name: NAME_O, st: 'pass' });
      else {
        const top = oos[0], sales = oos.reduce((t, r) => t + r.s, 0);
        out.push({ id: 'oos', name: NAME_O, st: 'found', sev: 'high', cat: 'Restock',
          title: `${cnt(oos.length)} advertised ${plural(oos.length, 'SKU is', 'SKUs are')} out of FBA stock`,
          act: `Restocking ${esc(top.sku)} may be worth putting first — its ads sold ${dollars(top.s)} in 30 days and its FBA stock is 0${stockOld(top.brand)}.`,
          why: 'While a product is out of stock, Amazon usually stops showing its ads, and the sales they were bringing pause with them.',
          money: { v: sales, l: 'their ad sales, 30 days', kind: 'risk' },
          kv: [['Their ad sales', dollars(sales)], ['Their ad orders', cnt(oos.reduce((t, r) => t + r.o, 0))], stockKv],
          ev: { head: ['SKU', 'ASIN', 'Campaign', 'FBA stock', 'Ad spend', 'Ad orders', 'Ad sales'], num: [3, 4, 5, 6],
            n: oos.length, rows: oos.slice(0, EV_CAP).map(r => ({ c: [esc(r.sku), esc(r.a), esc([...r.camps].join(', ')), '0', dollars(r.sp), cnt(r.o), dollars(r.s)],
              t: 'adh-k0', k: [...r.ks].join(',') })),
            tot: ['Total', '', '', '0', dollars(sum(oos, r => r.sp)), cnt(sum(oos, r => r.o)), dollars(sales)] },
          how: 'An ad that is running (ad, ad group and campaign all enabled) and sold in the 30 days, on a SKU whose FBA stock is 0.' + stockHow,
          src: ['ADS', 'STOCK'] });
      }
      const low = bySku((x, st) => {
        const d = daysOf(x, st);
        return st > 0 && x.o > 0 && d != null && d < LOW_COVER;
      }).map(r => Object.assign(r, { exact: daysOf(r, r.stock), days: Math.max(1, Math.floor(daysOf(r, r.stock))) })).sort((p, q) => p.exact - q.exact);
      if (!low.length) out.push({ id: 'low', name: NAME_L, st: 'pass' });
      else {
        const top = low[0];
        out.push({ id: 'low', name: NAME_L, st: 'found', sev: 'med', cat: 'Restock',
          title: `${cnt(low.length)} advertised ${plural(low.length, 'SKU', 'SKUs')} could run out within ${LOW_COVER} days`,
          act: `${esc(top.sku)} has about ${top.days} ${plural(top.days, 'day')} of stock left — sending more soon, and easing its bids until it lands, could keep it selling${stockOld(top.brand)}.`,
          why: 'Ads speed up the sales of a SKU that is about to run out. Slowing them a little keeps it on sale until the next shipment arrives.',
          money: { v: null, l: 'fewest days left', text: top.days + ' ' + plural(top.days, 'day'), kind: 'plain' },
          kv: [['Fewest days left', String(top.days)], ['Their ad sales', dollars(low.reduce((t, r) => t + r.s, 0))], stockKv],
          ev: { head: ['SKU', 'Campaign', 'FBA stock', 'Units a day', 'Days left', 'Ad orders', 'Ad sales'], num: [2, 3, 4, 5, 6],
            n: low.length, rows: low.slice(0, EV_CAP).map(r => {
              const pd = r.a ? (beOf(r.a) || {}).perDay : null;
              return { c: [esc(r.sku), esc([...r.camps].join(', ')), cnt(r.stock), pd ? pd.toFixed(1) : '—', String(r.days), cnt(r.o), dollars(r.s)],
                t: tint({ st: r.stock, days: r.exact }), k: [...r.ks].join(',') };
            }),
            tot: ['Total', '', cnt(sum(low, r => r.stock)), '', '', cnt(sum(low, r => r.o)), dollars(sum(low, r => r.s))] },
          how: `FBA stock ÷ units a day over the product's last four finished weeks (about the last month's pace), under ${LOW_COVER} days, on a running ad that sold in the 30 days.${stockHow}`,
          src: ['ADS', 'STOCK', 'DERIVED'] });
      }
    }

    /* 8, 9, 10 · MONEY GOING WHERE IT CANNOT COME BACK (the TrainAdz comparison, 18 Nov 2026): running ads that still spend on
     * a product out of FBA stock, or on a listing Amazon has taken out of search; and products whose ad spend is above all their
     * sales (TACoS over 100%) — a loss whatever the unit cost, so it needs no costs. */
    // The running ads (ad enabled) that spent in the 30 days, per SKU matching rule, with their campaigns and spend per campaign.
    const spendBySku = rule => {
      const m = {};
      liveAds.forEach(x => {
        if (!(x.sp > 0) || !rule(x)) return;
        const k = x.brand + '|' + x.sku;
        const r = m[k] || (m[k] = { brand: x.brand, sku: x.sku, a: x.a, o: 0, s: 0, sp: 0, camps: new Set(), per: {} });
        r.o += x.o || 0;
        r.s += x.s || 0;
        r.sp += x.sp || 0;
        r.camps.add(cname(x.brand, x.cid));
        const ck = x.brand + '|' + x.cid;
        r.per[ck] = (r.per[ck] || 0) + x.sp;
      });
      return Object.values(m).sort((p, q) => q.sp - p.sp);
    };
    const perOf = list => perMap([].concat(...list.map(r => Object.entries(r.per))));
    // The weekly store: the last finished week any product has an ad figure for, and the four finished weeks ending on it.
    const wRows = (typeof WEEKLY !== 'undefined' && WEEKLY.rows) || {};
    const weeklyOk = Object.keys(wRows).length > 0;
    let wLast = '';
    if (weeklyOk) {
      Object.values(wRows).forEach(r => Object.keys((r && r.weeks) || {}).forEach(k => { if (k > wLast && r.weeks[k].spend != null) wLast = k; }));
      if (wLast && !wWeekDone(wLast)) wLast = sdShift(wLast, -7);
    }
    const W4 = wLast ? [sdShift(wLast, -21), sdShift(wLast, -14), sdShift(wLast, -7), wLast] : [];
    const wkTxt = k => dayTxt(k) + '–' + dayTxt(sdShift(k, 6));
    const w4Txt = W4.length ? dayTxt(W4[0]) + '–' + dayTxt(sdShift(wLast, 6)) : '';
    HS.w4 = W4.length ? { end: sdShift(wLast, 6), txt: w4Txt } : null;   // for "Data as of"
    // An ASIN's ad spend in the last finished week (null when the weekly store does not have it).
    const lastWkSp = a => {
      const c = wLast && a && wRows[a] && wRows[a].weeks ? wRows[a].weeks[wLast] : null;
      return c && c.spend != null ? c.spend : (wLast && a && wRows[a] ? 0 : null);
    };
    const stillTxt = wk => (wk > 0 ? `, ${dollars(wk)} of the product's in the last full week (${wkTxt(wLast)})` : '');

    /* 8 · pause: ads still spending on a product that is out of FBA stock */
    const NAME_OS = 'No running ad spends on a product that is out of FBA stock';
    if (noAg || !HS.stock) notRun('oosSpend', NAME_OS, noAg || (stockWait ? 'wait' : noStock));
    else {
      // Where the weekly store has the product, it must still have spent in the last finished week — otherwise it has stopped.
      const list = spendBySku(x => stockOf(x) === 0).map(r => Object.assign(r, { wk: lastWkSp(r.a) })).filter(r => r.wk == null || r.wk > 0);
      if (!list.length) out.push({ id: 'oosSpend', name: NAME_OS, st: 'pass' });
      else {
        const top = list[0], sp = sum(list, r => r.sp), wk = sum(list, r => r.wk);
        out.push({ id: 'oosSpend', name: NAME_OS, st: 'found', sev: 'high', cat: 'Pause',
          title: `Ads are still spending on ${cnt(list.length)} out-of-stock ${plural(list.length, 'SKU')}`,
          act: `Pausing the ads of ${esc(top.sku)} until it is back in stock may be worth it — they spent ${dollars(top.sp)} in 30 days${stillTxt(top.wk)}, and its FBA stock is 0${stockOld(top.brand)}.`,
          why: 'A click on a product that cannot be bought cannot turn into an order. Amazon usually stops these ads by itself, but not always — a family with other sizes in stock, or a stock figure that lags, keeps them running.',
          money: { v: sp, l: 'their ad spend, 30 days', kind: 'waste' },
          per: perOf(list),
          kv: [['SKUs', cnt(list.length)], ['Their ad spend, 30 days', dollars(sp)]].concat(wLast ? [[`Last full week (${wkTxt(wLast)})`, dollars(wk)]] : []).concat([stockKv]),
          ev: { head: ['SKU', 'ASIN', 'Campaign', 'FBA stock', 'Ad spend', 'Last full week', 'Ad orders', 'Ad sales'], num: [3, 4, 5, 6, 7],
            n: list.length, rows: list.slice(0, EV_CAP).map(r => ({ c: [esc(r.sku), esc(r.a), esc([...r.camps].join(', ')), '0', dollars(r.sp),
              r.wk == null ? '—' : dollars(r.wk), cnt(r.o), dollars(r.s)], t: 'adh-k0', k: Object.keys(r.per).join(',') })),
            tot: ['Total', '', '', '0', dollars(sp), wLast ? dollars(wk) : '—', cnt(sum(list, r => r.o)), dollars(sum(list, r => r.s))] },
          how: 'Ads that are running (ad enabled) and spent in the 30 days, on a SKU whose FBA stock is 0'
            + (wLast ? ` — and, where the weekly figures have the product, that still spent in the last finished week (${wkTxt(wLast)}; "Last full week" is the whole product's (ASIN's) ad spend that week)` : '') + '.' + stockHow,
          src: ['ADS', 'STOCK'].concat(wLast ? ['WEEKLY'] : []) });
      }
    }

    /* 9 · fix the listing: ads still spending on a listing Amazon has taken out of search */
    const NAME_SU = 'No running ad spends on a listing Amazon has taken out of search';
    const supOf = x => {
      const v = HS.amz && x.sku ? HS.amz.get(x.brand + '|' + x.sku) : null;
      const s = v && v.st ? String(v.st).toUpperCase() : '';
      return s && s.includes('BUYABLE') && !s.includes('DISCOVERABLE') ? s : '';
    };
    const amzWait = HS.src.amz === 'loading' || HS.src.amz === 'idle';
    if (noAg) notRun('sup', NAME_SU, noAg);
    else if (!HS.amz) notRun('sup', NAME_SU, amzWait ? 'wait' : HS.src.amz === 'none' ? 'needs Amazon\'s listing status (Image Manager or Listing Errors right)' : 'Amazon\'s listing status (the Image Manager snapshot) could not be read');
    else {
      const list = spendBySku(x => !!supOf(x)).map(r => Object.assign(r, { wk: lastWkSp(r.a), amzSt: supOf(r) }));
      const saw = brands.filter(b => HS.amzAt[b]).map(b => (brands.length > 1 ? (BRAND_NAME[b] || b) + ' ' : '') + dayTxt(new Date(HS.amzAt[b]))).join(', ');
      if (!list.length) out.push({ id: 'sup', name: NAME_SU, st: 'pass' });
      else {
        const top = list[0], sp = sum(list, r => r.sp);
        out.push({ id: 'sup', name: NAME_SU, st: 'found', sev: 'high', cat: 'Fix listing',
          title: `Ads are spending on ${cnt(list.length)} ${plural(list.length, 'listing')} Amazon has taken out of search`,
          act: `Fixing ${esc(top.sku)}'s listing first may be worth it — Amazon shows it as buyable but not in search, yet its ads spent ${dollars(top.sp)} in 30 days${stillTxt(top.wk)}.`,
          why: 'A listing out of search sells only through a direct link; its ads tend to stop serving or to convert poorly until the listing is back. Listing Errors shows what Amazon wants fixed.',
          money: { v: sp, l: 'their ad spend, 30 days', kind: 'waste' },
          per: perOf(list),
          kv: [['Listings', cnt(list.length)], ['Their ad spend, 30 days', dollars(sp)], ['Status read', saw ? esc(saw) : 'not known']],
          ev: { head: ['SKU', 'ASIN', 'Campaign', 'Amazon status', 'Ad spend', 'Last full week', 'Ad orders', 'Ad sales'], num: [4, 5, 6, 7],
            n: list.length, rows: list.slice(0, EV_CAP).map(r => ({ c: [esc(r.sku), esc(r.a), esc([...r.camps].join(', ')), esc(r.amzSt), dollars(r.sp),
              r.wk == null ? '—' : dollars(r.wk), cnt(r.o), dollars(r.s)], k: Object.keys(r.per).join(',') })),
            tot: ['Total', '', '', '', dollars(sp), wLast ? dollars(sum(list, r => r.wk)) : '—', cnt(sum(list, r => r.o)), dollars(sum(list, r => r.s))] },
          how: `Ads that are running (ad enabled) and spent in the 30 days, on a SKU whose Amazon status is buyable but not discoverable — the rule Listing Health's "Suppressed from search" uses — as the Image Manager last read it${saw ? ` (${saw})` : ''}.`,
          src: ['ADS', 'AMZ'].concat(wLast ? ['WEEKLY'] : []), link: { tab: 'Lerr', t: 'Open Listing Errors' } });
      }
    }

    /* 10 · ad spend above sales: products whose ads cost more than everything they sold (TACoS over 100%), four finished weeks */
    const NAME_T = 'No advertised product spends more on ads than it sells';
    if (!weeklyOk || !W4.length) {
      notRun('tacos', NAME_T, !(can('weekly') || can('profit') || can('audit')) ? 'needs the weekly sales (PPC & Organic, Profit or Audit right)'
        : weeklyOk ? 'the weekly figures have no ad spend yet' : 'the weekly sales could not be read');
    } else {
      // the campaigns each ASIN is advertised in over the 30 days, with its spend in each — for the names, the jump and the stake
      const campsOf = {};
      agRows.forEach(x => {
        if (!x.a || !(x.sp > 0)) return;
        const m = campsOf[x.brand + '|' + x.a] || (campsOf[x.brand + '|' + x.a] = {});
        m[x.brand + '|' + x.cid] = (m[x.brand + '|' + x.cid] || 0) + x.sp;
      });
      const rowOf = {};
      rows.forEach(r => { rowOf[r.brand + '|' + r.cid] = r; });
      const inView = new Set(brands);
      let inv = 0;
      const list = [];
      Object.entries(wRows).forEach(([a, wr]) => {
        if (!wr || !wr.weeks || (wr.brand ? !inView.has(wr.brand) : brands.length < 2)) return;
        let sp = 0, rev = 0;
        W4.forEach(k => {
          const c = wr.weeks[k];
          if (!c) return;
          sp += c.spend || 0;
          rev += c.rev || 0;
        });
        if (!(sp >= TACOS_MIN_SPEND) || !(sp > rev)) return;
        const b = wr.brand || '', per = campsOf[b + '|' + a] || {}, ks = Object.keys(per);
        if (ks.length && ks.every(k => rowOf[k] && rowOf[k].invest)) {
          inv++;
          return;
        }
        list.push({ a, brand: b, sp, rev, tacos: rev > 0 ? sp / rev * 100 : null, ks, per, ex: sp - rev });
      });
      list.sort((p, q) => q.ex - p.ex);
      if (!list.length) out.push({ id: 'tacos', name: NAME_T, st: 'pass' });
      else {
        const top = list[0], sp = sum(list, r => r.sp), rev = sum(list, r => r.rev), ex = sum(list, r => r.ex);
        // the money above sales, shared over each product's campaigns by its 30-day spend in them
        const pairs = [];
        list.forEach(r => {
          const tot = r.ks.reduce((t, k) => t + r.per[k], 0);
          if (tot > 0) r.ks.forEach(k => pairs.push([k, r.ex * r.per[k] / tot]));
          else pairs.push(['a|' + r.brand + '|' + r.a, r.ex]);
        });
        const camps = r => [...new Set(r.ks.map(k => cname(k.split('|')[0], k.split('|').slice(1).join('|'))))].join(', ') || '—';
        out.push({ id: 'tacos', name: NAME_T, st: 'found', sev: 'high', cat: 'Lower bids',
          title: `${cnt(list.length)} ${plural(list.length, 'product spends', 'products spend')} more on ads than ${list.length === 1 ? 'it sells' : 'they sell'}`,
          act: `${esc(top.a)} might be worth looking at first — ${dollars(top.sp)} of ad spend on ${dollars(top.rev)} of sales (${top.tacos == null ? 'no sales' : pct(top.tacos) + ' TACoS'}) over ${w4Txt}. Lowering its bids, or pausing its weakest targets, stops the loss.`,
          why: 'When the ads cost more than everything a product sold — organic sales included — it loses money whatever its unit cost, so this needs no costs to be sure.'
            + (inv ? ` ${cnt(inv)} more ${plural(inv, 'product is', 'products are')} advertised only in launch, ranking or seasonal campaigns and ${inv === 1 ? 'is' : 'are'} left out, as ${inv === 1 ? 'it may be' : 'they may be'} meant to cost more for a while.` : ''),
          money: { v: ex, l: 'ad spend beyond their sales, 4 weeks', kind: 'waste' },
          per: perMap(pairs),
          kv: [['Products', cnt(list.length)], ['Their ad spend', dollars(sp)], ['Their sales', dollars(rev)], ['Their TACoS', rev > 0 ? pct(sp / rev * 100) : '—']],
          ev: { head: ['ASIN', 'Campaigns', 'Ad spend', 'Sales', 'TACoS', 'Above sales'], num: [2, 3, 4, 5], n: list.length,
            rows: list.slice(0, EV_CAP).map(r => ({ c: [esc(r.a), esc(camps(r)), dollars(r.sp), dollars(r.rev), r.tacos == null ? 'no sales' : pct(r.tacos), dollars(r.ex)],
              k: r.ks.join(',') || undefined })),
            tot: ['Total', '', dollars(sp), dollars(rev), rev > 0 ? pct(sp / rev * 100) : '—', dollars(ex)] },
          how: `Each product's (ASIN's) ad spend and all its sales — ads and organic — over the four finished weeks ${w4Txt}, from the weekly store; listed when the spend is at least ${dollars(TACOS_MIN_SPEND)} and above the sales. "Above sales" is the spend beyond them. Launch, ranking and seasonal campaigns (by their names) are left out.`,
          src: ['WEEKLY', 'ADS', 'DERIVED'] });
      }
    }

    /* 6 · raise bids: running campaigns under the range, whose selling products have stock to spare */
    const NAME_R = `No campaign under ${BAND.low}% ACoS has stock to spare`;
    if (noAg) notRun('raise', NAME_R, noAg);
    else if (!HS.stock) notRun('raise', NAME_R, stockWait ? 'wait' : noStock);
    else {
      const grow = judged.filter(r => r.acos < BAND.low).map(r => {
        const s = campStock[r.brand + '|' + r.cid] || [];
        const known = s.filter(x => x.st != null), days = known.filter(x => x.days != null).map(x => x.days);
        return Object.assign({ known: known.length, out: known.some(x => x.st <= 0), minDays: days.length ? Math.min(...days) : null }, r);
      }).filter(r => r.known > 0 && !r.out && (r.minDays == null || r.minDays >= RAISE_COVER)).sort((p, q) => q.s - p.s);
      if (!grow.length) out.push({ id: 'raise', name: NAME_R, st: 'pass' });
      else {
        const top = grow[0], sales = grow.reduce((t, r) => t + r.s, 0), sp = grow.reduce((t, r) => t + r.sp, 0);
        out.push({ id: 'raise', name: NAME_R, st: 'found', sev: 'low', cat: 'Raise bids',
          title: `${cnt(grow.length)} ${plural(grow.length, 'campaign has', 'campaigns have')} room to grow`,
          act: `${quote(top.name || top.cid)} might be worth a small bid increase — its ACoS is ${pct(top.acos)} on ${dollars(top.s)} of ad sales, ${top.minDays != null ? `with about ${cnt(Math.round(top.minDays))} days of stock` : 'with stock in hand'}.`,
          why: `Under ${BAND.low}% ACoS there is room to bid a little higher and still stay inside your ${BAND.low}–${BAND.high}% range — usually more impressions, and more sales. Raising gently (say 10%) and looking again after a week keeps it safe. Only campaigns whose selling products have at least ${RAISE_COVER} days of stock are listed.`,
          money: { v: sales, l: 'their ad sales, 30 days', kind: 'gain' },
          kv: [['Campaigns', cnt(grow.length)], ['Their ad sales', dollars(sales)], ['Their ACoS', pct(sp / sales * 100)]],
          ev: { head: ['Campaign', 'ACoS', 'Spend', 'Ad sales', 'Orders'].concat(stockHead), num: [1, 2, 3, 4, 5, 6], n: grow.length,
            rows: grow.slice(0, EV_CAP).map(r => campRow(r, [pct(r.acos), dollars(r.sp), dollars(r.s), cnt(Math.round(r.o))])),
            tot: ['Total', pct(sp / sales * 100), dollars(sp), dollars(sales), cnt(Math.round(sum(grow, r => r.o))), '', ''],
            jump: grow.map(r => r.brand + '|' + r.cid), text: `${grow.length === 1 ? 'It is the blue row' : 'They are the blue rows'} in Campaign performance, below.` },
          how: `Running campaigns with ${MIN_ORDERS} or more orders in the 30 days and an ACoS under ${BAND.low}%, where every SKU that sold through them is in FBA stock with at least ${RAISE_COVER} days of it at its pace over the last four finished weeks (or the pace is not known).${stockHow}`,
          src: ['ADS', 'STOCK', 'DERIVED'] });
      }
    }

    /* 7 · turn back on: paused ads that were selling inside the range, with stock to sell */
    const NAME_A = `No paused ad was selling at or under ${BAND.high}% ACoS`;
    if (noAg) notRun('resume', NAME_A, noAg);
    else if (!HS.stock) notRun('resume', NAME_A, stockWait ? 'wait' : noStock);
    else {
      const list = agRows.filter(x => {
        if (!x.st || x.st === 'E' || x.st === 'A' || x.st === '?' || !(x.o >= 3) || !(x.s > 0) || !x.a) return false;
        const st = stockOf(x), d = daysOf(x, st);
        return x.sp / x.s * 100 <= BAND.high && st > 0 && (d == null || d >= LOW_COVER);
      }).sort((p, q) => q.s - p.s);
      if (!list.length) out.push({ id: 'resume', name: NAME_A, st: 'pass' });
      else {
        const top = list[0], sales = list.reduce((t, x) => t + x.s, 0);
        const where = x => ((CP_STATE[x.st] || {}).t || 'Paused');
        out.push({ id: 'resume', name: NAME_A, st: 'found', sev: 'low', cat: 'Turn back on',
          title: `${cnt(list.length)} paused ${plural(list.length, 'ad was', 'ads were')} selling at or under ${BAND.high}% ACoS`,
          act: `Turning ${esc(top.sku || top.a)} in ${esc(cname(top.brand, top.cid))} back on could be worth a look — ${top.o} orders at ${pct(top.sp / top.s * 100)} ACoS, and ${stockOf(top).toLocaleString('en-US')} in stock.`,
          why: `${list.length === 1 ? 'It was' : 'They were'} bringing orders inside your ACoS range, and there is stock to sell.`,
          money: { v: sales, l: 'their ad sales, 30 days', kind: 'gain' },
          kv: [['Paused ads', cnt(list.length)], ['Their ad sales', dollars(sales)], ['Their orders', cnt(list.reduce((t, x) => t + x.o, 0))]],
          ev: { head: ['SKU', 'Campaign', 'Status', 'Orders', 'Ad sales', 'ACoS'].concat(stockHead), num: [3, 4, 5, 6, 7],
            n: list.length, rows: list.slice(0, EV_CAP).map(x => {
              const s = { sku: x.sku, st: stockOf(x), days: daysOf(x, stockOf(x)), n: 1 };
              return { c: [esc(x.sku || x.a), esc(cname(x.brand, x.cid)), esc(where(x)), cnt(x.o), dollars(x.s), pct(x.sp / x.s * 100)].concat(stockCells(s)), t: tint(s), k: x.brand + '|' + x.cid };
            }),
            tot: ['Total', '', '', cnt(sum(list, x => x.o)), dollars(sales), pct(sum(list, x => x.sp) / sales * 100), '', ''] },
          how: `Paused (not archived) ads with 3 or more orders in the 30 days at an ACoS of ${BAND.high}% or less, stock in hand and at least ${LOW_COVER} days of it.${stockHow}`,
          src: ['ADS', 'STOCK'], link: { tab: 'St', v: 'cp', t: 'Open Search Term Analysis · Campaign × product' } });
      }
    }

    /* data notes: what the suggestions above cannot see */
    // --- a brand missing (or partly missing) from the 30-day figures ---
    const short = cover.filter(x => x.agP < COVER_MIN || (x.stP != null && x.stP < COVER_MIN));
    if (short.length) {
      const lowP = x => Math.min(x.agP, x.stP == null ? Infinity : x.stP);
      short.sort((p, q) => lowP(p) - lowP(q));
      const w = short[0], agS = w.agP < COVER_MIN, stS = w.stP != null && w.stP < COVER_MIN;
      const parts = [agS ? 'campaign' : '', stS ? 'search-term' : ''].filter(Boolean).join(' and ');
      const gone = [w.agP < 1 ? 'campaign' : '', w.stP != null && w.stP < 1 ? 'search-term' : ''].filter(Boolean).join(' or ');
      const missing = short.reduce((t, x) => t + Math.max(0, x.tr - Math.min(x.ag, x.st == null ? x.ag : x.st)), 0);
      const others = cover.filter(x => !short.includes(x)).map(x => x.name);
      const cell = (v, p) => `<span${p < COVER_MIN ? ' class="ui-neg"' : ''}>${dollars(v)} · ${pct0(p)}</span>`;
      out.push({ id: 'data', st: 'note',
        text: (gone ? `${w.name} isn't in last night's 30-day ${gone} figures` : `The 30-day ${parts} figures hold only ${pct0(lowP(w))} of ${w.name}'s ad spend`)
          + (short.length > 1 ? `, and ${namesOf(short.slice(1))}'s are short too` : '')
          + ` — about ${dollars(missing)} of ad spend from ${dayTxt(w.from)} to ${dayTxt(w.to)} is missing, so the suggestions here `
          + (gone ? (others.length ? `cover ${others.join(' and ')} only` : `cannot see ${namesOf(short)}`) : `may miss some of ${namesOf(short)}'s campaigns`)
          + '. It needs the nightly run to bring it in.',
        ev: { head: ['Brand', 'Overview', 'Campaign figures', 'Search-term figures'], num: [1, 2, 3],
          rows: cover.map(x => [esc(x.name), dollars(x.tr), cell(x.ag, x.agP), x.st == null ? '…' : cell(x.st, x.stP)]) } });
    }
    // --- figures that are old ---
    const day = t => (/^\d{4}-\d{2}-\d{2}/.test(String(t)) ? String(t).slice(0, 10) : null);
    const built = [day(c.at), day(HS.at)].filter(Boolean).sort()[0];
    if (built) {
      const age = Math.round((new Date(sdToday() + 'T00:00:00Z') - new Date(built + 'T00:00:00Z')) / 864e5);
      if (age > STALE_DAYS) out.push({ id: 'fresh', st: 'note', text: `The 30-day ad figures were last built on ${dayTxt(built)} (${age} days ago), so these suggestions may be a little behind.` });
    }
    return out;
  }

  /* ---------- drawing ---------- */
  // The money cell of a finding.
  function moneyCell(m) {
    if (m.v == null) return `<b>${esc(m.text || '—')}</b><small>${esc(m.l)}</small>`;
    const cls = m.kind === 'loss' ? ' class="ui-neg"' : m.kind === 'gain' ? ' class="adh-pos"' : '';
    const v = m.kind === 'loss' ? dollars(-Math.abs(m.v)) : dollars(m.v);
    return `<b${cls}>${v}</b><small>${esc(m.l)}</small>`;
  }
  const pill = sev => `<span class="adh-pill adh-${sev}">${sev === 'crit' || sev === 'high' ? TRI : ''}${SEV[sev].t}</span>`;
  const tags = list => list.map(k => `<span class="adh-src adh-src-${k.toLowerCase()}" title="${esc(SRC[k])}">${k}</span>`).join('');
  // The link to the screen where the finding is acted on; only for a tab this account can open.
  const linkOf = l => (l && can(l.tab.toLowerCase()) && $('tab' + l.tab) && !$('tab' + l.tab).classList.contains('hide')
    ? `<button type="button" class="adh-link" data-tab="${esc(l.tab)}" data-v="${esc(l.v || '')}">${esc(l.t)} →</button>` : '');

  // The key to the stock tints, under a table that uses them.
  const TINT_KEY = `<div class="adh-tkey"><span><i class="adh-k0"></i>Out of stock</span><span><i class="adh-k7"></i>Under ${TINT.soon} days</span>`
    + `<span><i class="adh-k15"></i>Under ${TINT.low} days</span><span class="adh-tkn">days of FBA stock at each product's pace over its last four finished weeks</span></div>`;
  // An evidence table: every row (up to EV_CAP), the first EV_ROWS showing and "Show N more" opening the rest in place (id is
  // the suggestion's, so it stays open on a redraw); a total row; the tint key when a row is tinted. A row with campaign keys
  // (k) opens them in Campaign performance.
  function tableHtml(ev, link, id) {
    const num = new Set(ev.num || []);
    const rows = ev.rows.map(r => (Array.isArray(r) ? { c: r } : r));
    const open = !!id && HS.exp.has(id);
    const cell = (v, j) => `<td${num.has(j) ? ' class="num"' : ''}>${v}</td>`;
    const th = ev.head.map((h, j) => `<th${num.has(j) ? ' class="num"' : ''}>${esc(h)}</th>`).join('');
    const tr = rows.map((r, i) => {
      const cls = [r.t, i >= EV_ROWS ? 'adh-x' : '', r.k ? 'adh-row' : ''].filter(Boolean).join(' ');
      return `<tr${cls ? ` class="${cls}"` : ''}${r.k ? ` data-k="${esc(r.k)}" tabindex="0" title="Show in Campaign performance, with its products and stock"` : ''}>`
        + r.c.map(cell).join('') + '</tr>';
    }).join('');
    const foot = ev.tot && rows.length > 1 ? `<tfoot><tr>${ev.tot.map(cell).join('')}</tr></tfoot>` : '';
    const hidden = Math.max(0, rows.length - EV_ROWS), beyond = (ev.n || rows.length) - rows.length;
    const more = hidden ? `<button type="button" class="adh-evmore" data-f="${esc(id || '')}" aria-expanded="${open}">`
      + `<span class="adh-evo">Show ${cnt(hidden)} more</span><span class="adh-evc">Show fewer</span></button>` : '';
    const rest = beyond > 0 ? `<div class="adh-evnote">The first ${cnt(rows.length)} are listed; ${cnt(beyond)} more${link ? ' are in the screen linked below' : ' are left out'}.</div>` : '';
    return `<div class="adh-ev${open ? ' is-open' : ''}"><table class="adh-t"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody>${foot}</table>${more}${rest}</div>`
      + (rows.some(r => r.t) ? TINT_KEY : '');
  }

  // One suggestion: the row that opens, and what it opens to.
  function findingHtml(f, open, i) {
    const ev = (f.ev && f.ev.rows ? tableHtml(f.ev, f.link, f.id) : '')
      + (f.ev && f.ev.jump ? `<div class="adh-jump"><span>${esc(f.ev.text)} Click a row to open one, with its products and stock.</span>`
        + `<button type="button" class="ghost adh-go" data-keys="${esc(f.ev.jump.join(','))}" data-t="${esc(f.cat)}">Show ${f.ev.jump.length === 1 ? 'it' : `these ${cnt(f.ev.jump.length)}`} in Campaign performance ↓</button></div>` : '');
    const kv = (f.kv || []).map(([l, v]) => `<div><span>${esc(l)}</span><b>${v}</b></div>`).join('');
    return `<details class="adh-f adh-${f.sev}" data-f="${f.id}" style="--i:${i}"${open ? ' open' : ''}><summary>${pill(f.sev)}`
      + `<span class="adh-ft"><b>${esc(f.title)}</b><small>${esc(f.cat)}</small></span>`
      + `<span class="adh-fm">${moneyCell(f.money)}</span>${CHEV}</summary>`
      + `<div class="adh-fb"><p class="adh-do"><b>Suggestion:</b> ${f.act}</p><p class="adh-why">${esc(f.why)}</p>`
      + `${kv ? `<div class="adh-kv">${kv}</div>` : ''}${ev}`
      + `<div class="adh-how"><p><b>How it was checked:</b> ${esc(f.how)}</p><div class="adh-srcs"><span>Sources</span>${tags(f.src)}</div>${linkOf(f.link)}</div></div></details>`;
  }

  // A data note: what the suggestions cannot see, with its figures folded away under it.
  function noteHtml(x) {
    return `<div class="adh-note"><span class="adh-nic">${TRI}</span><div><p>${esc(x.text)}</p>`
      + (x.ev && x.ev.rows ? `<details><summary>Show the figures</summary>${tableHtml(x.ev)}</details>` : '') + '</div></div>';
  }

  // The bar's top line: the icon, the name, what was checked, the severity counts and the chevron.
  function barHead(sub, chips) {
    const sevTip = Object.keys(SEV).map(k => `${SEV[k].t}: ${SEV[k].tip}`).join('\n');
    return `<span class="adh-ico">${BULB}</span><span class="adh-tt"><b>Recommendation</b><small>${sub}</small></span>`
      + `<span class="adh-chips" title="${esc(sevTip)}">${chips}</span><span class="adh-chevw">${CHEV}</span>`;
  }

  // The three figures and the top suggestion, at the top of the open bar.
  function topHtml(found, n, c, notes) {
    const B = c.band, t28 = c.t28;
    const acos = t28 && t28.adSales > 0 ? t28.spend / t28.adSales * 100 : null;
    // What Money burned is a share of: the search-term spend of the brands in view — the same cache the burn comes from.
    const stSp = HS.src.terms === 'ready' ? c.brands.reduce((t, b) => t + stSpendOf(b), 0) : 0;
    const burnF = found.find(f => f.id === 'burn');
    const burnSt = HS.src.terms === 'ready' ? (burnF ? burnF.money.v : 0) : null;
    const sevTip = Object.keys(SEV).map(k => `${SEV[k].t}: ${SEV[k].tip}`).join('\n');
    const bar = (w, cls) => `<div class="adh-bar${cls ? ' ' + cls : ''}"><i style="width:${Math.max(0, Math.min(100, w)).toFixed(1)}%"></i></div>`;
    // --- Suggestions: how many, by priority ---
    const sevs = Object.keys(SEV).filter(k => n[k]).map(k => `<span><i class="adh-dot adh-${k}"></i>${n[k]} ${SEV[k].t.toLowerCase()}</span>`).join('');
    const tile1 = `<div class="adh-stat adh-s-find" data-go="list" role="button" tabindex="0" title="Go to the suggestions"><div class="adh-sl"><span class="adh-ic">${BULB}</span>Suggestions<span class="adx-i" title="${esc(sevTip)}">i</span></div>`
      + `<b>${cnt(found.length)}</b><div class="adh-bar adh-sevbar">${Object.keys(SEV).filter(k => n[k]).map(k => `<i class="adh-${k}" style="flex:${n[k]}"></i>`).join('')}</div>`
      + `<div class="adh-sevs">${sevs || '<span>nothing to suggest</span>'}</div></div>`;
    // --- ACoS, last 28 days, against the range (the green band) ---
    const acls = acos == null ? '' : acos > B.high ? 'adh-crit' : acos >= B.low ? 'adh-ok' : 'adh-blue';
    const scale = Math.max(B.high * 1.6, (acos || 0) * 1.15);
    const at = v => Math.max(0, Math.min(100, v / scale * 100));
    const tile2 = `<div class="adh-stat adh-s-acos ${acls}" data-go="chart" role="button" tabindex="0" title="Go to the ACoS &amp; TACoS chart"><div class="adh-sl"><span class="adh-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.3"/><circle cx="17" cy="17" r="2.3"/></svg></span>ACoS`
      + `<span class="adx-i" title="Ad spend ÷ ad sales over the last 28 days with ad figures, against your ${B.low}–${B.high}% range (the green band).">i</span></div>`
      + (acos == null ? '<b class="ui-dim">—</b><div class="adh-sn">no ad figures yet</div>'
        : `<b>${pct(acos)}</b><div class="adh-gauge adh-gr"><i style="width:${at(acos).toFixed(1)}%"></i><span style="left:${at(B.low).toFixed(1)}%;width:${(at(B.high) - at(B.low)).toFixed(1)}%"></span><b style="left:${at(acos).toFixed(1)}%"></b></div>`
          + `<div class="adh-sn">last 28 days · good range ${B.low}–${B.high}%</div>`) + '</div>';
    // --- Money burned: search terms that spent and never sold ---
    const tile3 = `<div class="adh-stat adh-s-burn" data-go="burn" role="button" tabindex="0" title="Open the search terms behind it"><div class="adh-sl"><span class="adh-ic"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.3 1.2-3.6 2.3-4.6.3 1.6 1.2 2.6 2.2 2.6 0-3 .5-5.3.5-8Z"/></svg></span>Money burned`
      + `<span class="adx-i" title="Spend on search terms that had enough clicks to sell and never did, last 30 days — and its share of all the search-term spend.">i</span></div>`
      + (burnSt == null ? `<b class="ui-dim">—</b><div class="adh-sn">${HS.src.terms === 'failed' ? 'search terms could not be read' : 'search terms still loading…'}</div>`
        : !(stSp > 0) ? '<b class="ui-dim">—</b><div class="adh-sn">no search-term figures for these brands</div>'
        : `<b>${dollars(burnSt)}</b>${bar(burnSt / stSp * 100, 'adh-bar-1')}<div class="adh-sn">${(burnSt / stSp * 100).toFixed(1)}% of the search-term spend · no order</div>`) + '</div>';
    // --- the top suggestion ---
    const f = found[0];
    const urgent = f
      ? `<div class="adh-urgent adh-${f.sev}"><div class="adh-ul">${pill(f.sev)}<span>Top suggestion · ${esc(f.cat)}</span></div>`
        + `<div class="adh-ua">${f.act}</div><div class="adh-uw">${esc(f.title)}. ${esc(f.why)}</div>`
        + `<div class="adh-uf"><button type="button" class="ghost adh-open" data-f="${f.id}">See the details</button>`
        + `<span>Shown first: ${SEV[f.sev].t.toLowerCase()} priority${f.money.v != null ? `, ${dollars(Math.abs(f.money.v))} involved` : ''}.</span></div></div>`
      : notes.length
        ? '<div class="adh-urgent adh-high"><div class="adh-ul"><span class="adh-pill adh-high">Nothing to suggest yet</span></div><div class="adh-ua">Nothing to suggest from the figures there are — the data note above says what is missing.</div></div>'
        : '<div class="adh-urgent adh-ok"><div class="adh-ul"><span class="adh-pill adh-ok">All clear</span></div><div class="adh-ua">Nothing to suggest for the last 30 days.</div></div>';
    return `<div class="adh-top"><div class="adh-stats">${tile1}${tile2}${tile3}</div>${urgent}</div>`;
  }

  /* MONEY AT STAKE AND DATA AS OF (the TrainAdz comparison, 18 Nov 2026: "put the money at stake on top of every page"; "stamp
   * data as of on every page"). One strip over the page (tStake): the money the waste suggestions name, counted once per
   * campaign — the largest of them in each, so a campaign above the range that also burns on search terms is not added twice —
   * up to every suggestion added up; a chip per suggestion opens it in the bar; and the day each source reaches. */
  const STAKE_NAME = { lower: 'Above the ACoS range', pause: 'Campaigns with no sales', burn: 'No-sale search terms',
    oosSpend: 'Out of stock, still spending', sup: 'Out of search, still spending', tacos: 'Ad spend above sales' };
  function stakeOf(found) {
    const waste = found.filter(f => f.money && f.money.kind === 'waste' && f.money.v > 0);
    const best = {};
    waste.forEach(f => Object.entries(f.per || {}).forEach(([k, v]) => { if (!(best[k] >= v)) best[k] = v; }));
    return { lo: Object.values(best).reduce((t, v) => t + v, 0), hi: waste.reduce((t, f) => t + f.money.v, 0), waste };
  }
  // The days each source reaches, oldest flagged: sales and ad figures (the daily store), the 30-day caches, the weekly store,
  // FBA stock and Amazon's listing status.
  function asOfHtml(c) {
    const today = sdToday();
    const age = d => (d ? Math.round((new Date(today + 'T00:00:00Z') - new Date(String(d).slice(0, 10) + 'T00:00:00Z')) / 864e5) : null);
    const ymd = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
    const item = (label, d, txt, tip, old) => {
      const a = age(ymd(d)), late = a != null && a > (old || STALE_DAYS + 1);
      return `<span class="adt-asof-i${late ? ' adt-late' : ''}" title="${esc(tip + (a != null ? ` — ${a} ${plural(a, 'day')} ago` : ''))}"><em>${esc(label)}</em> ${esc(txt || (d ? dayTxt(ymd(d)) : '—'))}</span>`;
    };
    // sales: the newest day with sales in the daily store, for the brands in view
    let sales = '';
    try {
      c.brands.forEach(b => Object.entries((TREND.d || {})[b] || {}).forEach(([day, v]) => { if (day > sales && v && v[T_I.sales] > 0) sales = day; }));
    } catch (e) { sales = ''; }
    const parts = [item('Sales to', sales, '', 'The newest day with sales in the Overview\'s daily store (Orders workbooks; today is read live)')];
    if (c.ad.to) parts.push(item('Ad figures', c.ad.to, `${dayTxt(c.ad.from)} – ${dayTxt(c.ad.to)}`, 'The days the daily ad figures cover (Amazon\'s report runs a day or two behind the sales)', 3));
    const tp = c.brands.map(b => (HS.terms || {})[b] || {}).find(p => p.to);
    const built = [String(c.at || '').slice(0, 10), String(HS.at || '').slice(0, 10)].filter(Boolean).sort()[0];
    if (built) parts.push(item('30-day campaign & search-term figures', built, (tp && tp.from ? `${dayTxt(tp.from)} – ${dayTxt(tp.to)}, ` : '') + 'built ' + dayTxt(built),
      'The nightly 30-day caches Campaign performance, Recommendation and Search Term Analysis read'));
    if (HS.w4) parts.push(item('Weekly figures', HS.w4.end, HS.w4.txt, 'The four finished weeks "Ad spend above sales" reads (the PPC & Organic weekly store)', 9));
    const st = c.brands.map(b => HS.stockAt && HS.stockAt[b]).filter(d => d instanceof Date && !isNaN(d.getTime())).sort((p, q) => p - q)[0];
    if (st) parts.push(item('FBA stock saved', st, '', 'When Listing Health last saved the FBA stock'));
    const am = c.brands.map(b => HS.amzAt && HS.amzAt[b]).filter(Boolean).sort((p, q) => p - q)[0];
    if (am) parts.push(item('Listing status', new Date(am), '', 'When the Image Manager last read Amazon\'s listing status (out of search or not)', 7));
    let win = '';
    try {
      if (typeof T_SPAN_AUTO !== 'undefined' && T_SPAN_AUTO && !T_SPAN_TOUCHED && T_GRAN === 'week' && $('tSpan').value === String(T_SPAN_AUTO.n)) {
        win = `<span class="adt-asof-i adt-asof-win" title="The page opened on the weeks every figure covers, so sales and ad figures speak for the same weeks. Pick another stretch above at any time.">`
          + `<em>Page window</em> last ${T_SPAN_AUTO.n} weeks — the weeks with ad figures</span>`;
      }
    } catch (e) { win = ''; }
    return `<div class="adt-asof"><b>Data as of</b>${parts.join('')}${win}</div>`;
  }
  function stakePaint(c, found, wait) {
    const el = $('tStake');
    if (!el) return;
    if (!c) {
      el.classList.add('hide');
      return;
    }
    el.classList.remove('hide');
    const s = stakeOf(found || []);
    const waiting = (wait || []).some(x => STAKE_NAME[x.id]);
    const tip = 'Money the suggestions below name as going out with little or nothing coming back: spend above your ACoS range, campaigns and search terms with no sales, ads on products out of stock or out of search, and ad spend above a product\'s sales. The first figure counts each campaign once (the largest suggestion in it); the second adds every suggestion up, so the true figure is between the two. Last 30 days (ad spend above sales: the last four finished weeks).';
    const big = found == null ? '<b class="adt-sk-v"><span class="adh-skel adh-skel-w"></span></b>'
      : s.hi > 0 ? `<b class="adt-sk-v">${dollars(s.lo)}</b>${s.hi - s.lo >= 1 ? `<small>to ${dollars(s.hi)}</small>` : ''}`
      : '<b class="adt-sk-v adt-sk-ok">$0</b><small>nothing found</small>';
    const chips = s.waste.sort((p, q) => q.money.v - p.money.v).map(f => `<button type="button" class="adt-sk-chip adh-${f.sev}" data-f="${esc(f.id)}" title="${esc(f.title)}">`
      + `<span>${esc(STAKE_NAME[f.id] || f.cat)}</span><b>${dollars(f.money.v)}</b></button>`).join('')
      + (waiting ? '<span class="adt-sk-wait">still adding up…</span>' : '');
    el.innerHTML = `<div class="adt-sk-row"><div class="adt-sk-main" role="button" tabindex="0" data-go="list">`
      + `<span class="adt-sk-l">Money at stake<span class="adx-i" title="${esc(tip)}">i</span></span>`
      + `<span class="adt-sk-vw">${big}</span><span class="adt-sk-sub">last 30 days · ${esc(BRAND_NAME[$('tBrand').value] || 'Both brands')}</span></div>`
      + `<div class="adt-sk-chips">${chips}</div></div>${asOfHtml(c)}`;
    if (!el.dataset.wired) {
      el.dataset.wired = '1';
      const go = id => {
        const bar = $('tHealth'), dd = bar && bar.querySelector('details.adh-dd');
        if (!dd) return;
        dd.open = true;
        HS.open = true;
        const f = id ? bar.querySelector(`details.adh-f[data-f="${id}"]`) : null;
        if (f) f.open = true;
        (f || dd).scrollIntoView({ behavior: 'smooth', block: f ? 'center' : 'start' });
      };
      el.addEventListener('click', e => {
        if (e.target.closest('.adx-i')) return;
        const b = e.target.closest('.adt-sk-chip');
        if (b) go(b.dataset.f);
        else if (e.target.closest('.adt-sk-main')) go('');
      });
      el.addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('adt-sk-main')) {
          e.preventDefault();
          go('');
        }
      });
    }
  }

  // The whole bar, from whatever is loaded. Drawn again only when something it reads has changed.
  function render() {
    const el = $('tHealth');
    const c = ADSX.state();
    const t28 = c.t28 ? Math.round(c.t28.sales) + '/' + Math.round(c.t28.spend) : '';
    // (the page's stretch only for the strip's "Page window" note: it is cut off again for the checks' memo below)
    const sig = [c.brands.join(','), c.st, c.ver, c.key, HS.ver, HS.all, t28].join('|') + '|sp' + (($('tSpan') || {}).value || '');
    if (sig === HS.sig && el.innerHTML) return;
    HS.sig = sig;
    share(c);
    const brandTxt = esc(BRAND_NAME[$('tBrand').value] || 'Both brands');
    const wrap = (sum, body, cls) => `<details class="adh-dd${cls ? ' ' + cls : ''}"${HS.open ? ' open' : ''}><summary class="adh-sum">${sum}</summary><div class="adh-body">${body}</div></details>`;
    // --- loading, failed, or nothing to check ---
    if (c.st === 'failed') {
      stakePaint(null);
      el.innerHTML = wrap(barHead(`Last 30 days · ${brandTxt}`, ''), '<div class="ui-error">The checks need the campaign figures, which did not load — see Campaign performance below.</div>');
      return;
    }
    if (c.st !== 'ready') {
      stakePaint(c, null, []);
      el.innerHTML = wrap(barHead(`Last 30 days · Sponsored Products · ${brandTxt} · running the checks…`, '<span class="adh-skel"></span><span class="adh-skel"></span>')
        + '<span class="adh-urg adh-wait"><span class="adh-skel adh-skel-w"></span></span>', '<div class="ui-loading">Running the checks…</div>');
      return;
    }
    // (with ad spend in the daily figures the checks still run: a brand missing from the caches is a finding of its own)
    if (!c.rows.length && HS.src.terms !== 'loading' && !(HS.terms && c.brands.some(b => ((HS.terms[b] || {}).rows || []).length))
      && !(c.t28 && c.t28.spend > 0)) {
      stakePaint(null);
      el.innerHTML = wrap(barHead(`Last 30 days · ${brandTxt}`, ''), '<div class="ui-empty">No 30-day ad figures yet. The nightly run keeps them, so the checks run the morning after.</div>');
      return;
    }
    // --- the checks, ranked (kept for the last few brand choices, so switching back is instant) ---
    const mkey = sig.replace(/\|sp[^|]*$/, '').replace(/\|(true|false)\|/, '|');
    let list = HS.memo.get(mkey);
    if (!list) {
      list = checks(c);
      if (HS.memo.size > 5) HS.memo.delete(HS.memo.keys().next().value);
      HS.memo.set(mkey, list);
    }
    const found = list.filter(x => x.st === 'found')
      .sort((p, q) => SEV[p.sev].r - SEV[q.sev].r || Math.abs(q.money.v || 0) - Math.abs(p.money.v || 0));
    const passed = list.filter(x => x.st === 'pass'), na = list.filter(x => x.st === 'na'), wait = list.filter(x => x.st === 'wait');
    const notes = list.filter(x => x.st === 'note');
    const n = { crit: 0, high: 0, med: 0, low: 0 };
    found.forEach(f => { n[f.sev]++; });
    const sub = `Last 30 days · Sponsored Products · ${brandTxt} · ${cnt(found.length)} ${plural(found.length, 'suggestion')} from ${list.length - notes.length} checks`
      + (passed.length ? `, ${passed.length} passed` : '') + (na.length ? `, ${na.length} not run` : '') + (wait.length ? ` · ${wait.length} still loading…` : '');
    const chips = (found.length ? Object.keys(SEV).filter(k => n[k]).map(k => `<span class="adh-chip adh-${k}"><i class="adh-dot"></i>${n[k]} ${SEV[k].t}</span>`).join('')
      : (wait.length || notes.length ? '' : '<span class="adh-chip adh-ok"><i class="adh-dot"></i>All clear</span>'))
      + (notes.length ? `<span class="adh-chip adh-high" title="${esc(notes.map(x => x.text).join('\n'))}"><i class="adh-dot"></i>Data note</span>` : '')
      + (wait.length ? '<span class="adh-skel adh-skel-s"></span>' : '');
    // --- the top suggestion, in one line, on the bar itself (or the data note, when there is nothing to suggest) ---
    const top = found[0];
    const urgent = top ? `<span class="adh-urg adh-${top.sev}"><span class="adh-urgl">Top suggestion</span><span class="adh-urga">${top.act}</span></span>`
      : wait.length ? '<span class="adh-urg adh-wait"><span class="adh-skel adh-skel-w"></span></span>'
      : notes.length ? `<span class="adh-urg adh-high"><span class="adh-urgl">Data note</span><span class="adh-urga">${esc(notes[0].text)}</span></span>`
      : '<span class="adh-urg adh-ok"><span class="adh-urgl">All clear</span><span class="adh-urga">Nothing to suggest for the last 30 days.</span></span>';
    // --- inside: the data notes, the three figures and the top suggestion, the list, then what passed, could not run, or is loading ---
    const openNow = new Set([...el.querySelectorAll('details.adh-f[open]')].map(d => d.dataset.f));
    const shown = HS.all ? found : found.slice(0, SHOW);
    const more = found.length > SHOW ? `<button type="button" class="ghost adh-more">${HS.all ? 'Show fewer' : `Show all ${found.length}`}</button>` : '';
    const rest = (passed.length ? `<div><b class="adh-okt">✓ Passed</b> ${passed.map(x => esc(x.name)).join(' · ')}</div>` : '')
      + (wait.length ? `<div><b>◌ Still loading</b> ${wait.map(x => esc(x.name)).join(' · ')}</div>` : '')
      + (na.length ? `<div><b>○ Not run</b> ${na.map(x => `${esc(x.name)} <span>(${esc(x.why)})</span>`).join(' · ')}</div>` : '');
    const body = (notes.length ? `<div class="adh-notes">${notes.map(noteHtml).join('')}</div>` : '') + topHtml(found, n, c, notes)
      + (found.length ? `<div class="adh-list">${shown.map((f, i) => findingHtml(f, openNow.has(f.id), i)).join('')}</div>` : '')
      + `<div class="adh-foot"><div class="adh-rest">${rest}</div><div class="adh-srcs adh-key"><span>Sources</span>${tags(Object.keys(SRC))}</div>${more}</div>`;
    el.innerHTML = wrap(barHead(sub, chips) + urgent, body);
    stakePaint(c, found, wait);
  }

  // Draw, and hide the bar quietly if that fails.
  function paint() {
    try { render(); } catch (e) {
      console.warn('[ads-health]', e);
      try { $('tHealth').classList.add('hide'); } catch (x) { /* the bar itself is missing */ }
      try { $('tStake').classList.add('hide'); } catch (x) { /* the strip is missing */ }
    }
  }

  // One set of listeners for the whole bar: open / close, the jump to Campaign performance, the screen links, Show all.
  function wire() {
    const el = $('tHealth');
    if (el.dataset.wired) return;
    el.dataset.wired = '1';
    // Opening and closing the bar is remembered for this visit (not saved anywhere).
    el.addEventListener('toggle', e => {
      const d = e.target;
      if (!d.classList || !d.classList.contains('adh-dd')) return;
      HS.open = d.open;
      if (d.open) HS.seen = true;
    }, true);
    // A tile, a table row, "Show N more": things that are not plain buttons.
    const goTile = tile => {
      const go = tile.dataset.go;
      if (go === 'chart') {
        const c = $('tChartPct') || $('tCharts');
        if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      const d = go === 'burn' ? el.querySelector('details.adh-f[data-f="burn"]') : el.querySelector('.adh-list');
      if (!d) return;
      if (d.tagName === 'DETAILS') d.open = true;
      d.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const goRow = tr => {
      const d = tr.closest('details.adh-f'), b = d && d.querySelector('.adh-ft small');
      try { ADSX.focus(String(tr.dataset.k).split(','), b ? b.textContent : 'Recommendation'); } catch (x) { /* Campaign performance is not there */ }
    };
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tr = e.target.closest('tr[data-k]'), tile = e.target.closest('.adh-stat[data-go]');
      if (tr && e.target === tr) {
        e.preventDefault();
        goRow(tr);
      } else if (tile && e.target === tile) {
        e.preventDefault();
        goTile(tile);
      }
    });
    el.addEventListener('click', e => {
      const tr = e.target.closest('tr[data-k]');
      if (tr && el.contains(tr)) {
        goRow(tr);
        return;
      }
      const tile = e.target.closest('.adh-stat[data-go]');
      if (tile && !e.target.closest('.adx-i')) {
        goTile(tile);
        return;
      }
      const t = e.target.closest('button');
      if (!t || !el.contains(t)) return;
      if (t.classList.contains('adh-evmore')) {
        const box = t.closest('.adh-ev'), on = !box.classList.contains('is-open');
        box.classList.toggle('is-open', on);
        t.setAttribute('aria-expanded', String(on));
        if (t.dataset.f) {
          if (on) HS.exp.add(t.dataset.f);
          else HS.exp.delete(t.dataset.f);
        }
        if (!on) box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      if (t.classList.contains('adh-open')) {
        const d = el.querySelector(`details.adh-f[data-f="${t.dataset.f}"]`);
        if (d) {
          d.open = true;
          d.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      } else if (t.classList.contains('adh-go')) {
        try { ADSX.focus(String(t.dataset.keys || '').split(','), t.dataset.t || 'Recommendation'); } catch (x) { /* Campaign performance is not there */ }
      } else if (t.classList.contains('adh-link')) {
        const tab = $('tab' + t.dataset.tab);
        if (!tab) return;
        tab.click();
        const v = t.dataset.v;
        if (v) {
          const seg = document.querySelector(`#stViewSeg [data-v="${v}"]`);
          if (seg) seg.click();
        }
      } else if (t.classList.contains('adh-more')) {
        HS.all = !HS.all;
        HS.sig = '';
        paint();
      }
    });
  }

  /* ---------- the one entry point ---------- */
  // Called by ADSX.draw on every redraw of the Ad Console, and when the campaign figures arrive.
  function draw() {
    const el = $('tHealth');
    // The figures are Search Terms' to show: an account without that tab does not get them here either.
    if (!can('st')) {
      el.classList.add('hide');
      if ($('tStake')) $('tStake').classList.add('hide');
      return;
    }
    el.classList.remove('hide');
    wire();
    warmUp();
    paint();
  }

  // Start loading now, if nothing has yet (ADSX calls this the moment the Ad Console is asked for, or hovered in the menu).
  function warmUp() {
    if (HS.st !== 'idle' || !can('st')) return;
    HS.st = 'loading';
    load().catch(e => {
      console.warn('[ads-health]', e);
      HS.st = 'ready';
      HS.ver++;
      paint();
    });
  }

  return { draw, warmUp, stockInfo, tint, stockReady: () => (HS.src.stock === 'ready' && HS.stock ? 1 : 0) };
})();
