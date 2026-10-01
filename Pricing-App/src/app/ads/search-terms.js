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
    const grab = async name => { try { const r = await baCall({ cache: name }); return (r.data && r.data.d) || {}; } catch (e) { return {}; } };
    let at = '';
    try { const r = await baCall({ cache: 'srchTerm' }); at = (r.data && r.data.at) || ''; } catch (e) {}
    ST.terms = await grab('srchTerm');
    ST.tgts = await grab('targeting');
    ST.ag = await grab('adGroup');
    ST.at = at;
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
  renderSt();
});
$('stBrand').addEventListener('change', renderSt);
let ST_FT = null;
['stFilter', 'stMinSpend'].forEach(id =>
  $(id).addEventListener('input', () => { clearTimeout(ST_FT); ST_FT = setTimeout(renderSt, 250); }));

$('stCsv').onclick = () => {
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

