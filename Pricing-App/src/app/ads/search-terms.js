/* ================= SEARCH TERMS =================
 *
 * Two lists that have to be read against each other: what shoppers TYPED (search terms) and what we
 * BID ON (targets). Amazon reports them separately and never joins them, so the join is here.
 *
 * A search term carries NO ASIN — Amazon reports it against the ad group it matched in, and an ad
 * group can advertise several products. So "product wise" goes through the ad group, and where a
 * group holds more than one ASIN the term belongs to all of them. It is shown that way rather than
 * picking one, because picking one would be a made-up answer that reads like a real one.
 *
 * Terms with no clicks never leave the backend: nothing here can be said about a term on the
 * strength of an impression, and they are the bulk of the rows.
 */
let ST = { at: '', terms: {}, tgts: {}, ag: {}, loaded: false, dropped: 0, from: '', to: '' };
let ST_VIEW = 'harvest', ST_LAST = [];
function stMsg(t, bad) { const m = $('stMsg'); m.innerHTML = t || ''; m.className = bad ? 'err' : 'muted'; }

async function ensureSt() {
  if (!ST.loaded) {
    stMsg('Loading…');
    /* Each cache ONCE, and the three at the same time (2026-10-03: "ye bahut hang ho rha h"). The search-term cache is
     * 3.8 MB and was fetched twice — once only to read its date — and the three came one after another. */
    const grab = async name => { try { const r = await baCall({ cache: name }); return (r && r.data) || {}; } catch (e) { return {}; } };
    const [t, g, a] = await Promise.all([grab('srchTerm'), grab('targeting'), grab('adGroup')]);
    ST.terms = t.d || {};
    ST.tgts = g.d || {};
    ST.ag = a.d || {};
    ST.at = t.at || '';
    ST.loaded = true;
    stMsg('');
  }
  renderSt();
}

/** The targets we bid on, as a set per ad group — what "is this term already a keyword" is asked of. */
function stTargetSet(brands) {
  const set = new Set();
  brands.forEach(b => ((ST.tgts[b] || {}).rows || []).forEach(r => {
    if (r.t) set.add(r.ag + '|' + String(r.t).toLowerCase().trim());
  }));
  return set;
}

/** The products behind an ad group, with their parents. A list, because a group can hold several. */
function stProductsOf(brand, agId) {
  const pack = ST.ag[brand] || {};
  const g = (pack.groups || {})[agId];
  if (!g || !g.a || !g.a.length) return { asins: [], parents: [] };
  const pmap = pack.parent || {};
  const parents = [...new Set(g.a.map(a => pmap[a] || '').filter(Boolean))];
  return { asins: g.a, parents };
}

/* Campaign and ad-group names are stored ONCE per id, not on every row — see the fold in the
 * backend. Joined back here, where it costs nothing. */
const nm = (brand, which, id) => (((ST[which] || {})[brand] || {}).names || {})[id] || '';

function stRows() {
  const pick = $('stBrand').value;
  const brands = (pick === 'ALL' ? ['SP', 'CPC'] : [pick]);
  const targets = stTargetSet(brands);
  const q = $('stFilter').value.trim().toLowerCase();
  const minSp = Number($('stMinSpend').value) || 0;
  let rows = [];

  if (ST_VIEW === 'waste') {
    // The targets WE added: money out, nothing back. One row per target, not per search term.
    brands.forEach(b => ((ST.tgts[b] || {}).rows || []).forEach(r => {
      if (!(r.sp > 0) || r.o > 0) return;
      const p = stProductsOf(b, r.ag);
      rows.push({ brand: b, term: r.t, kind: 'target', mt: r.mt, cn: nm(b, 'tgts', r.cid), agn: nm(b, 'tgts', r.ag),
        i: r.i, c: r.c, sp: r.sp, o: r.o, s: r.s, asins: p.asins, parents: p.parents, inList: true });
    }));
  } else {
    brands.forEach(b => ((ST.terms[b] || {}).rows || []).forEach(r => {
      const inList = targets.has(r.ag + '|' + String(r.t).toLowerCase().trim());
      if (ST_VIEW === 'harvest' && (!(r.o > 0) || inList)) return;
      if (ST_VIEW === 'neg' && (!(r.sp > 0) || r.o > 0)) return;
      const p = stProductsOf(b, r.ag);
      rows.push({ brand: b, term: r.t, kind: 'term', mt: r.mt, cn: nm(b, 'terms', r.cid), agn: nm(b, 'terms', r.ag), kw: r.kw,
        i: r.i, c: r.c, sp: r.sp, o: r.o, s: r.s, asins: p.asins, parents: p.parents, inList });
    }));
  }

  if (minSp > 0) rows = rows.filter(r => r.sp >= minSp);
  if (q) rows = rows.filter(r => (r.term + ' ' + (r.kw || '') + ' ' + r.cn + ' ' + r.agn
    + ' ' + r.asins.join(' ') + ' ' + r.parents.join(' ')).toLowerCase().includes(q));
  // Harvest by what it earned, everything else by what it cost — in each view the biggest number is
  // the one worth acting on first.
  rows.sort((a, b) => ST_VIEW === 'harvest' ? (b.s - a.s || b.o - a.o) : (b.sp - a.sp || b.c - a.c));
  return rows;
}

function renderSt() {
  if (ST_VIEW === 'cp') { renderCp(); return; }
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = v => '$' + (Math.round((v || 0) * 100) / 100).toLocaleString('en-US');
  const haveAny = Object.keys(ST.terms).length || Object.keys(ST.tgts).length;
  if (!haveAny) {
    $('stTable').innerHTML = '';
    stMsg('The nightly run has not collected any search-term data yet. It asks Amazon for these '
      + 'reports overnight and picks them up on a later wake-up, so they appear the morning after '
      + 'the first run that includes them.', true);
    return;
  }
  const rows = stRows();
  ST_LAST = rows;

  const CAP = 500;
  const shown = rows.slice(0, CAP);
  const isWaste = ST_VIEW === 'waste';
  const head = '<thead><tr>'
    + `<th class="frz">${isWaste ? 'Target we added' : 'Search term'}</th>`
    + (isWaste ? '' : '<th title="The target that caught this search term. Blank means Amazon did not report one.">Matched target</th>')
    + '<th>Match</th>'
    + '<th title="The ASINs advertised in the ad group this ran in. More than one means the term cannot be pinned to a single product.">Product</th>'
    + '<th>Parent</th><th>Campaign</th>'
    + '<th class="num">Impr</th><th class="num">Clicks</th><th class="num">Spend</th>'
    + '<th class="num">Orders</th><th class="num">Sales</th>'
    + '<th class="num" title="Spend ÷ sales. Blank when there are no sales to divide by.">ACOS</th>'
    + '</tr></thead>';

  const prod = r => !r.asins.length
    ? '<span class="muted" title="No advertised-product row for this ad group in the same window.">—</span>'
    : r.asins.length === 1
      ? esc(r.asins[0])
      : `<span title="${esc(r.asins.join(', '))}">${esc(r.asins[0])} <span class="muted">+${r.asins.length - 1}</span></span>`;
  const par = r => !r.parents.length ? '<span class="muted">—</span>'
    : r.parents.length === 1 ? esc(r.parents[0])
    : `<span title="${esc(r.parents.join(', '))}">${esc(r.parents[0])} <span class="muted">+${r.parents.length - 1}</span></span>`;

  const body = shown.map(r => '<tr>'
    + `<td class="frz" style="font-weight:600">${esc(r.term)}`
      + (!isWaste && r.inList ? ' <span class="st st-draft" title="Already in your target list.">bidding</span>' : '')
      + '</td>'
    + (isWaste ? '' : `<td>${r.kw ? esc(r.kw) : '<span class="muted">—</span>'}</td>`)
    + `<td>${r.mt ? esc(r.mt) : '<span class="muted">—</span>'}</td>`
    + `<td style="font-family:ui-monospace,monospace">${prod(r)}</td>`
    + `<td style="font-family:ui-monospace,monospace">${par(r)}</td>`
    + `<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.cn + ' · ' + r.agn)}">${esc(r.cn)}</td>`
    + `<td class="num">${(r.i || 0).toLocaleString('en-US')}</td>`
    + `<td class="num">${r.c || 0}</td>`
    + `<td class="num">${money(r.sp)}</td>`
    + `<td class="num"${r.o ? ' style="font-weight:700"' : ''}>${r.o || 0}</td>`
    + `<td class="num">${money(r.s)}</td>`
    + `<td class="num">${r.s > 0 ? Math.round(r.sp * 100 / r.s) + '%' : '<span class="muted">—</span>'}</td>`
    + '</tr>').join('');

  $('stTable').innerHTML = head + '<tbody>' + (body
    || `<tr><td colspan="${isWaste ? 11 : 12}" class="muted" style="padding:14px">Nothing matches.</td></tr>`) + '</tbody>';

  const spend = rows.reduce((s, r) => s + r.sp, 0), sales = rows.reduce((s, r) => s + r.s, 0);
  const WHAT = {
    harvest: 'search terms that produced orders and are NOT in your target list — the list to add',
    waste: 'targets you added that spent and produced nothing — the list to cut or re-bid',
    neg: 'search terms that spent and produced nothing — the list to negative',
    all: 'every search term that got at least one click',
  };
  stMsg(`<b>${rows.length.toLocaleString('en-US')}</b> ${WHAT[ST_VIEW]}`
    + ` · ${money(spend)} spent, ${money(sales)} back`
    + (rows.length > CAP ? ` · showing the first ${CAP} — narrow it to see the rest` : '')
    + (ST.at ? ` · built ${esc(ST.at)}` : '')
    + ' · a 30-day window'
    // Said plainly. A cap nobody is told about reads as "this is everything", and a decision made on
    // that belief is a decision made on a lie.
    + (() => {
        const b = brands.reduce((a, x) => {
          const p = ST.terms[x] || {};
          a.n += p.dropped || 0; a.sp += p.dropSpend || 0; a.min = p.minClicks || a.min; return a;
        }, { n: 0, sp: 0, min: 3 });
        return b.n
          ? ` · <b>${b.n.toLocaleString('en-US')} more term(s) not shown</b>: fewer than ${b.min} clicks and no order`
            + ` (${money(b.sp)} between them — too little traffic each to call one way or the other)`
          : '';
      })());
}

$('stViewSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  ST_VIEW = b.dataset.v;
  $('stViewSeg').querySelectorAll('[data-v]').forEach(x => x.classList.toggle('on', x === b));
  $('stCpShow').classList.toggle('hide', ST_VIEW !== 'cp');
  $('stCpTarget').classList.toggle('hide', ST_VIEW !== 'cp');
  if (ST_VIEW === 'cp' && !CP.loaded) { ensureCp().then(renderSt); return; }
  renderSt();
});
$('stBrand').addEventListener('change', renderSt);
$('stCpShow').addEventListener('change', renderSt);
try { const t = localStorage.getItem('stCpTarget'); if (t) $('stCpTarget').value = t; } catch (e) { /* no storage */ }
$('stCpTarget').addEventListener('input', () => {
  try { localStorage.setItem('stCpTarget', $('stCpTarget').value); } catch (e) { /* no storage */ }
  clearTimeout(ST_FT); ST_FT = setTimeout(renderSt, 250);
});
let ST_FT = null;
['stFilter', 'stMinSpend'].forEach(id =>
  $(id).addEventListener('input', () => { clearTimeout(ST_FT); ST_FT = setTimeout(renderSt, 250); }));

$('stCsv').onclick = () => {
  if (ST_VIEW === 'cp') { cpCsv(); return; }
  if (!ST_LAST.length) { stMsg('Nothing to export.', true); return; }
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const cols = ['Brand', 'View', ST_VIEW === 'waste' ? 'Target' : 'Search term', 'Matched target',
    'Match type', 'ASINs', 'Parents', 'Campaign', 'Ad group', 'Impressions', 'Clicks', 'Spend',
    'Orders', 'Sales', 'Already bidding'];
  const lines = [cols.map(cell).join(',')];
  // Everything in the view, not just the 500 drawn — the table is capped for the browser's sake and
  // an export that silently matched that cap would be a plan with the tail cut off.
  ST_LAST.forEach(r => lines.push([r.brand, ST_VIEW, r.term, r.kw || '', r.mt || '',
    r.asins.join(' '), r.parents.join(' '), r.cn, r.agn, r.i, r.c, r.sp, r.o, r.s,
    r.inList ? 'yes' : 'no'].map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'search-terms-' + ST_VIEW + '-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
};


/* ================= CAMPAIGN × PRODUCT =================
 *
 * Ravi, 2026-10-03: "mujhe ek aisa view chahiye jisme me pata laga saku ki mera kis campaign me kis product me mera
 * achcha ya bura chal rha h and uska action kya and uske against me stock h ya nahi" — then "add indivisual tacos and
 * add kro ki wo particular asin active h or pause h us campaign me".
 *
 * One row per (campaign, ad group, SKU) over the same 30-day window as the search terms, from the advertised-product
 * report the nightly run asks for. Beside it: whether that ad is running today (one letter per row, from Amazon's
 * product-ad / ad-group / campaign lists, read nightly), the FBA stock of that SKU (stock/{brand}), days of cover and the
 * ASIN's own TACoS over the last four finished weeks (PPC & Organic's store), and the break-even ACoS where the unit
 * cost is known (Profit & Margin).
 *
 * The verdict asks: is it running at all, then STOCK, then evidence (under CP_MIN_CLICKS clicks with no order nothing
 * can be said yet), then the money against the break-even ACoS or the typed target. Sellora only ADVISES — nothing
 * here changes a bid, a state or a campaign at Amazon.
 *
 * SPEED: everything that does not depend on the target ACoS is worked out ONCE per load (cpBase); a keystroke in the
 * filter or the target only re-runs the verdict and the filter over that list.
 */
const CP_MIN_CLICKS = 10;       // clicks before "no order" is evidence rather than chance
const CP_LOW_COVER = 14;        // days of stock below which the ad is slowed so the product does not run out
const CP_SCALE_COVER = 45;      // days of stock needed before "spend more" is advice anyone can follow
const CP_TARGET_DEFAULT = 30;   // ACoS % used when the unit cost is not known and nothing is typed in
const CP_STATE = {
  E: { t: 'Active', tip: 'Ad, ad group and campaign are all enabled.' },
  a: { t: 'Paused — ad', tip: 'This product is paused inside the ad group.' },
  g: { t: 'Paused — ad group', tip: 'The ad group holding this product is paused.' },
  c: { t: 'Paused — campaign', tip: 'The whole campaign is paused.' },
  A: { t: 'Archived', tip: 'The ad, its ad group or its campaign is archived.' },
  '?': { t: 'Not found', tip: "Not in Amazon's lists when they were last read." },
};
let CP = { loaded: false, stock: {}, stockAt: {}, base: null };
let CP_LAST = [];

async function ensureCp() {
  if (CP.loaded) return;
  stMsg('Loading the FBA stock, weekly sales and unit costs…');
  const stockOf = async b => {
    try {
      const snap = await getDoc(doc(db, 'stock', b));
      if (!snap.exists()) return;
      const d = snap.data();
      CP.stock[b] = d.m || {};
      CP.stockAt[b] = d.at && d.at.toDate ? d.at.toDate() : null;
    } catch (e) { /* no read access, or never saved — stock shows as unknown */ }
  };
  await Promise.all([
    stockOf('SP'), stockOf('CPC'),
    (async () => { try { if (!H_LOADED) await loadHealthCache(); } catch (e) { /* titles stay blank */ } })(),
    (async () => { try { if (!WEEKLY.weeks.length && !Object.keys(WEEKLY.rows).length) await loadWeekly(); } catch (e) { /* cover unknown */ } })(),
    (async () => { try { await loadCosts(); } catch (e) { /* break-even unknown */ } })(),
  ]);
  CP.loaded = true;
  CP.base = null;
  stMsg('');
}

/** Units a day, price and the ASIN's TACoS, from the last four FINISHED weeks of its sales. Null when there are none. */
function cpPace(asin) {
  const r = WEEKLY.rows[asin];
  if (!r || !r.weeks) return null;
  const wks = Object.keys(r.weeks).filter(wWeekDone).sort().slice(-4);
  if (!wks.length) return null;
  let u = 0, rev = 0, spend = 0, spendKnown = false;
  wks.forEach(k => {
    const c = r.weeks[k];
    u += c.u || 0; rev += c.rev || 0;
    if (c.spend != null) { spend += c.spend; spendKnown = true; }
  });
  return { perDay: u / (wks.length * 7), price: u > 0 ? rev / u : null,
    tacos: spendKnown && rev > 0 ? spend / rev * 100 : null };
}

/** The ACoS at which an ad sale makes nothing — what is left of the price after cost and fees, as a % of it. */
function cpBreakEven(asin, price) {
  const cost = pfCostOf(asin);
  if (!(cost > 0) || !(price > 0)) return null;
  const pctOfPrice = (PF_MODEL.ref + PF_MODEL.fba + PF_MODEL.oh + PF_MODEL.sal) / 100;
  return (price * (1 - pctOfPrice) - cost * (1 + PF_MODEL.ret / 100)) / price * 100;
}

/** { v: 'bad' | 'watch' | 'good' | '', act, why } — running?, then stock, then evidence, then money. */
function cpVerdict(r) {
  const money = v => '$' + Math.round(v).toLocaleString('en-US');
  const acos = r.s > 0 ? r.sp / r.s * 100 : null;
  const tgt = r.be != null ? r.be : r.tgt;
  const tgtTxt = r.be != null ? `break-even ${Math.round(r.be)}%` : `target ${Math.round(r.tgt)}%`;
  /* Not running today: nothing to cut. Only worth a word when it was working and the stock is there to sell. */
  if (r.st && r.st !== 'E' && r.st !== '?') {
    const where = (CP_STATE[r.st] || {}).t || 'Stopped';
    if (r.st !== 'A' && r.o >= 3 && acos != null && tgt > 0 && acos <= tgt && r.stock > 0 && (r.cover == null || r.cover >= CP_LOW_COVER)) {
      return { v: 'watch', act: 'Paused but was working', why: `${where}. In the 30 days it made ${r.o} orders at ACoS ${Math.round(acos)}% (within the ${tgtTxt}) and ${r.stock.toLocaleString('en-US')} are in stock — worth turning back on.` };
    }
    return { v: '', act: 'Not running', why: `${where} — nothing to change. It spent ${money(r.sp)} in the 30 days.` };
  }
  if (r.stock === 0 && r.sp > 0) {
    return { v: 'bad', act: 'Pause — no stock', why: `FBA stock is 0 and this ad spent ${money(r.sp)} in 30 days. Pause it until stock lands.` };
  }
  if (r.cover != null && r.cover < CP_LOW_COVER && r.o > 0) {
    return { v: 'watch', act: 'Slow down — low stock', why: `About ${Math.round(r.cover)} days of stock left. Lower the bids so it does not run out before the next shipment.` };
  }
  if (!(r.o > 0) && r.c < CP_MIN_CLICKS) {
    return { v: '', act: 'Too early', why: `${r.c} click${r.c === 1 ? '' : 's'} and no order yet — not enough to judge. Leave it running.` };
  }
  if (!(r.o > 0)) {
    return { v: 'bad', act: 'Pause / cut bids', why: `${money(r.sp)} on ${r.c} clicks and not one order.` };
  }
  if (tgt <= 0) {
    return { v: 'bad', act: 'Loses money', why: 'At this price and unit cost the product loses money before any ad, so every ad sale adds to the loss. Fix the price or the cost first.' };
  }
  if (acos > tgt) {
    return { v: 'bad', act: 'Lower bids', why: `ACoS ${Math.round(acos)}% is over the ${tgtTxt} — each ad sale costs more than it should.` };
  }
  if (acos <= tgt * 0.7 && r.o >= 3 && r.cover != null && r.cover >= CP_SCALE_COVER) {
    return { v: 'good', act: 'Scale up', why: `ACoS ${Math.round(acos)}% is well under the ${tgtTxt}, ${r.o} orders, ${Math.round(r.cover)} days of stock. Raise the budget or bids.` };
  }
  return { v: 'good', act: 'Keep', why: `ACoS ${Math.round(acos)}% is within the ${tgtTxt}.`
    + (r.cover == null ? ' Stock cover is not known, so no advice to spend more.'
      : r.cover < CP_SCALE_COVER ? ` Only ${Math.round(r.cover)} days of stock — hold here.` : '') };
}

/** Everything that does not change with the target ACoS, worked out once per load. */
function cpBase() {
  if (CP.base) return CP.base;
  const out = [], paceOf = {};
  ['SP', 'CPC'].forEach(b => {
    const pack = ST.ag[b] || {};
    const pmap = pack.parent || {}, names = pack.names || {}, stock = CP.stock[b];
    (pack.rows || []).forEach(x => {
      const pace = x.a in paceOf ? paceOf[x.a] : (paceOf[x.a] = cpPace(x.a));
      const st = stock && x.sku && Object.prototype.hasOwnProperty.call(stock, x.sku) ? Number(stock[x.sku]) || 0 : null;
      const r = { brand: b, cn: names[x.cid] || '', agn: names[x.ag] || '', asin: x.a, sku: x.sku || '', parent: pmap[x.a] || '',
        title: wTitle(x.a), st: x.st || '',
        i: x.i || 0, c: x.c || 0, sp: x.sp || 0, o: x.o || 0, s: x.s || 0,
        // OWN sales (this SKU only). Absent on caches built before 2026-10-03 — then unknown, never zero.
        os: x.os != null ? x.os : null, oo: x.oo != null ? x.oo : null,
        stock: st, cover: st != null && pace && pace.perDay > 0 ? st / pace.perDay : null,
        tacos: pace ? pace.tacos : null, be: cpBreakEven(x.a, pace && pace.price) };
      r.hay = [r.cn, r.agn, r.asin, r.sku, r.parent, r.title, (CP_STATE[r.st] || {}).t || ''].join(' ').toLowerCase();
      out.push(r);
    });
  });
  CP.base = out;
  return out;
}

function cpRows() {
  const pick = $('stBrand').value;
  const q = $('stFilter').value.trim().toLowerCase();
  const minSp = Number($('stMinSpend').value) || 0;
  const typed = Number($('stCpTarget').value);
  const tgt = typed > 0 ? typed : CP_TARGET_DEFAULT;
  const show = $('stCpShow').value;
  const rows = [];
  cpBase().forEach(b => {
    if (pick !== 'ALL' && b.brand !== pick) return;
    if (minSp > 0 && b.sp < minSp) return;
    b.tgt = tgt;
    Object.assign(b, cpVerdict(b));
    if (show === 'running' ? b.st !== 'E' : show === 'stopped' ? (b.st === 'E' || !b.st) : show && b.v !== show) return;
    if (q && !(b.hay + ' ' + b.act.toLowerCase()).includes(q)) return;
    rows.push(b);
  });
  // Bad first, and the biggest spend first inside each — the money leaving is what gets read first.
  const rank = { bad: 0, watch: 1, good: 2, '': 3 };
  rows.sort((x, y) => (rank[x.v] - rank[y.v]) || (y.sp - x.sp));
  return rows;
}

function renderCp() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const money = v => '$' + Math.round(v || 0).toLocaleString('en-US');
  const haveRows = ['SP', 'CPC'].some(b => ((ST.ag[b] || {}).rows || []).length);
  if (!haveRows) {
    $('stTable').innerHTML = '';
    stMsg('No campaign × product figures yet. The nightly run keeps them, so they appear here the morning after, for the '
      + 'same 30 days as the search terms.', true);
    return;
  }
  const rows = cpRows();
  CP_LAST = rows;
  const CAP = 300, shown = rows.slice(0, CAP);
  const TAG = { bad: 'st-rejected', watch: 'st-pending', good: 'st-approved' };
  const dash = '<span class="muted">—</span>';
  const head = '<thead><tr>'
    + '<th class="frz">Campaign</th><th>Ad group</th><th>ASIN</th><th>SKU</th>'
    + '<th title="Is this product\'s ad running today? Ad, ad group and campaign must all be enabled.">Ad status</th>'
    + '<th class="num">Clicks</th><th class="num">Spend</th><th class="num">Orders</th><th class="num">Sales</th>'
    + '<th class="num" title="This ad\'s spend ÷ ALL the sales Amazon gives it, 30 days — as in Campaign Manager. Includes other products the shopper bought after the click.">ACoS</th>'
    + '<th class="num" title="Sales of THIS SKU only that came from this ad, 30 days.">Own sales</th>'
    + '<th class="num" title="This ad\'s spend ÷ sales of THIS SKU only. Far above the ACoS means the ad mostly sells other products, not the one it advertises.">ACoS (own)</th>'
    + '<th class="num" title="The ASIN\'s TOTAL ad spend ÷ its TOTAL sales (ads + organic), last four finished weeks — the same for every campaign it is in. It can sit far above the ACoS: Amazon counts in an ad sale what the shopper bought of OTHER products after the click, so an ad can look cheap while the product it advertises sells little itself.">TACoS (ASIN)</th>'
    + '<th class="num" title="Orders ÷ clicks.">Conv.</th>'
    + '<th class="num" title="The ACoS at which an ad sale makes nothing: price less unit cost and fees, as a % of the price. Blank when the unit cost is not in Profit &amp; Margin.">Break-even</th>'
    + '<th class="num" title="FBA stock of this SKU that Amazon can sell now.">FBA stock</th>'
    + '<th class="num" title="FBA stock ÷ units a day over the last four finished weeks of this ASIN.">Days of cover</th>'
    + '<th>Verdict</th><th>What to do</th>'
    + '</tr></thead>';
  const stCell = r => {
    if (!r.st) return dash;
    const x = CP_STATE[r.st] || CP_STATE['?'];
    return `<span class="st ${r.st === 'E' ? 'st-approved' : r.st === '?' ? 'st-draft' : 'st-pending'}" title="${esc(x.tip)}">${esc(x.t)}</span>`;
  };
  const body = shown.map(r => '<tr>'
    + `<td class="frz" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600" title="${esc(r.cn)}">${esc(r.cn) || dash}</td>`
    + `<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.agn)}">${esc(r.agn) || dash}</td>`
    + `<td style="font-family:ui-monospace,monospace" title="${esc(r.title)}">${esc(r.asin)}</td>`
    + `<td style="font-family:ui-monospace,monospace">${esc(r.sku) || dash}</td>`
    + `<td style="white-space:nowrap">${stCell(r)}</td>`
    + `<td class="num">${r.c}</td>`
    + `<td class="num">${money(r.sp)}</td>`
    + `<td class="num"${r.o ? ' style="font-weight:700"' : ''}>${r.o}</td>`
    + `<td class="num">${money(r.s)}</td>`
    + `<td class="num">${r.s > 0 ? Math.round(r.sp * 100 / r.s) + '%' : dash}</td>`
    + `<td class="num">${r.os != null ? money(r.os) : dash}</td>`
    + `<td class="num">${r.os == null ? dash : r.os > 0 ? Math.round(r.sp * 100 / r.os) + '%' : (r.sp > 0 ? '<span class="muted" title="Spent, and not one of this SKU sold from it">no own sale</span>' : dash)}</td>`
    + `<td class="num">${r.tacos != null ? Math.round(r.tacos) + '%' : dash}</td>`
    + `<td class="num">${r.c > 0 ? (r.o / r.c * 100).toFixed(1) + '%' : dash}</td>`
    + `<td class="num">${r.be != null ? Math.round(r.be) + '%' : dash}</td>`
    + `<td class="num"${r.stock === 0 ? ' style="color:var(--bad,#b91c1c);font-weight:700"' : ''}>${r.stock != null ? r.stock.toLocaleString('en-US') : dash}</td>`
    + `<td class="num">${r.cover != null ? Math.round(r.cover) : dash}</td>`
    + `<td style="white-space:nowrap">${r.v ? `<span class="st ${TAG[r.v]}">${esc(r.act)}</span>` : `<span class="muted">${esc(r.act)}</span>`}</td>`
    + `<td style="min-width:260px;white-space:normal">${esc(r.why)}</td>`
    + '</tr>').join('');
  $('stTable').innerHTML = head + '<tbody>' + (body
    || '<tr><td colspan="19" class="muted" style="padding:14px">Nothing matches.</td></tr>') + '</tbody>';

  const sum = v => rows.filter(r => r.v === v).reduce((a, r) => { a.n++; a.sp += r.sp; a.s += r.s; return a; }, { n: 0, sp: 0, s: 0 });
  const bad = sum('bad'), watch = sum('watch'), good = sum('good');
  const running = rows.filter(r => r.st === 'E').length, stopped = rows.filter(r => r.st && r.st !== 'E' && r.st !== '?').length;
  const stockAt = Object.entries(CP.stockAt).filter(([, d]) => d)
    .map(([b, d]) => `${BRAND_NAME[b] || b} ${d.toLocaleDateString('en-GB')}`).join(', ');
  const stAt = ['SP', 'CPC'].map(b => (ST.ag[b] || {}).stAt).filter(Boolean)[0];
  stMsg(`<b>${rows.length.toLocaleString('en-US')}</b> campaign × product rows`
    + ` (${running.toLocaleString('en-US')} running, ${stopped.toLocaleString('en-US')} paused or archived)`
    + ` · <b style="color:var(--bad,#b91c1c)">${bad.n} bad</b> (${money(bad.sp)} spent, ${money(bad.s)} back)`
    + ` · <b>${watch.n} watch</b> (${money(watch.sp)} spent)`
    + ` · <b style="color:#15803D">${good.n} good</b> (${money(good.sp)} spent, ${money(good.s)} back)`
    + (rows.length > CAP ? ` · showing the first ${CAP} — narrow it, or Export for all` : '')
    + (ST.at ? ` · built ${esc(ST.at)}` : '') + ' · a 30-day window'
    + (stAt ? ` · ad status read ${esc(stAt)}` : '')
    + (stockAt ? ` · FBA stock as saved ${esc(stockAt)}` : ' · <b>no FBA stock saved yet</b> — refresh Listing Health once to fill it')
    + ' · advice only: nothing here changes a bid at Amazon');
}

function cpCsv() {
  if (!CP_LAST.length) { stMsg('Nothing to export.', true); return; }
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const cols = ['Brand', 'Campaign', 'Ad group', 'ASIN', 'SKU', 'Parent', 'Ad status', 'Impressions', 'Clicks', 'Spend', 'Orders', 'Sales',
    'ACoS %', 'Own sales', 'ACoS own %', 'TACoS (ASIN) %', 'Break-even ACoS %', 'FBA stock', 'Days of cover', 'Verdict', 'What to do'];
  const lines = [cols.map(cell).join(',')];
  CP_LAST.forEach(r => lines.push([r.brand, r.cn, r.agn, r.asin, r.sku, r.parent, (CP_STATE[r.st] || {}).t || '', r.i, r.c, r.sp, r.o, r.s,
    r.s > 0 ? Math.round(r.sp * 100 / r.s) : '', r.os != null ? r.os : '', r.os > 0 ? Math.round(r.sp * 100 / r.os) : '', r.tacos != null ? Math.round(r.tacos) : '', r.be != null ? Math.round(r.be) : '', r.stock,
    r.cover != null ? Math.round(r.cover) : '', r.act, r.why].map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'campaign-product-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click(); URL.revokeObjectURL(a.href);
}
