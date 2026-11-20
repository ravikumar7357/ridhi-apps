/* products.js — "By product": month by month per ASIN or SKU (Ravi, 2026-11-20: "Jan'25 to May'25 Amazon sales for Ridhi
 * month on month, and Jan'25 to Mar'26 for CPC — all metrics: sales, ads / organic, spend, orders, units, ASIN SKU wise —
 * in the app and the HTML").
 *
 * One file, used by both pages: live.html (the "By product" tab) and Sellora's Live vs Last Year screen (same tab). Each page
 * fetches the data its own way and calls ProdReport.render(host, M, opts):
 *   M = the backend's ?live=months answer (Pricing-API/SalesLive.gs liveMonths_):
 *       { at, from, d: { SP|CPC: { skus: [[sku, asin]], m: { 'YYYY-MM': [[skuIndex, sales, units, orders]] } } },
 *         ads: { SP|CPC: { 'YYYY-MM': { sp|sd|sb: [[asin, sku, spend, adSales, adOrders, adUnits, clicks, impressions]] } } },
 *         adsAt, files: [{ at, brand, kind, name, months }], building: { book, row, of } | null }
 *   opts = { upload?: (body) => Promise<{ok, error?}>, drop?: (body) => Promise, readFile?: (File) => Promise<rows[][]>,
 *            reload?: () => void }   — upload/drop/readFile only in Sellora (live.html is read-only).
 * Sales, units and orders come from the Orders workbooks (every month since Jan 2025). Ad figures for a month exist only
 * when an Ads console report for it was uploaded: Amazon's Ads API keeps about 95 days, so older months cannot be fetched.
 * Organic = sales − ad sales, only for months that have ad figures. TACoS = spend ÷ sales; ACoS = spend ÷ ad sales. */
(function () {
  const BR = { SP: 'Ridhi', CPC: 'CPC' };
  const KIND = { sp: 'Sponsored Products', sd: 'Sponsored Display', sb: 'Sponsored Brands' };
  const PRESETS = [
    { label: 'Ridhi · Jan – May 2025', brand: 'SP', from: '2025-01', to: '2025-05' },
    { label: 'CPC · Jan 2025 – Mar 2026', brand: 'CPC', from: '2025-01', to: '2026-03' },
  ];
  const METRICS = { s: 'Sales', u: 'Units', o: 'Orders', sp: 'Ad spend', as: 'Ad sales', org: 'Organic sales', tacos: 'TACoS', acos: 'ACoS' };
  const money = v => (v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US'));
  const int = v => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
  const pc = (a, b) => (a == null || !(b > 0) ? '—' : (a / b * 100).toFixed(1) + '%');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mName = (mk, long) => new Date(mk + '-15T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit' });
  const monthsOf = (a, b) => { const r = []; let [y, m] = a.split('-').map(Number); for (let i = 0; i < 120; i++) { const k = y + '-' + String(m).padStart(2, '0'); if (k > b) break; r.push(k); if (++m > 12) { m = 1; y++; } } return r; };
  const nowMonth = () => new Date().toISOString().slice(0, 7);
  let ST = { brand: 'SP', from: '2025-01', to: '2025-05', by: 'asin', metric: 's', q: '', all: false };
  try { Object.assign(ST, JSON.parse(localStorage.getItem('prod.state') || '{}')); } catch (e) { /* no storage */ }
  const save = () => { try { localStorage.setItem('prod.state', JSON.stringify(ST)); } catch (e) { /* no storage */ } };
  let UP = null;                                     // the report read from a file, waiting to be saved

  /* ---------- the figures ---------- */
  const Z = () => ({ s: 0, u: 0, o: 0, sp: 0, as: 0, ao: 0, au: 0, cl: 0, im: 0, ad: false, adAll: true });
  function build(M, brands, ms, by) {
    const rows = new Map(), tot = {};
    ms.forEach(mk => { tot[mk] = Z(); });
    const row = (key, b) => { let r = rows.get(key); if (!r) { r = { key, brand: b, asin: '', skus: new Set(), m: {} }; rows.set(key, r); } return r; };
    const cell = (r, mk) => r.m[mk] || (r.m[mk] = Z());
    brands.forEach(b => {
      const D = (M.d || {})[b], A = (M.ads || {})[b] || {};
      const skuAsin = {};
      if (D) {
        D.skus.forEach(([sku, asin]) => { skuAsin[sku] = asin; });
        ms.forEach(mk => (D.m[mk] || []).forEach(([ix, s, u, o]) => {
          const [sku, asin] = D.skus[ix] || ['?', ''];
          const r = row(by === 'asin' ? (asin || sku) : sku, b); r.asin = asin || r.asin; r.skus.add(sku);
          const c = cell(r, mk), t = tot[mk]; c.s += s; c.u += u; c.o += o; t.s += s; t.u += u; t.o += o;
        }));
      }
      ms.forEach(mk => {
        const mo = A[mk];
        if (!mo || !Object.keys(mo).length) { tot[mk].adAll = false; return; }
        tot[mk].ad = true;
        Object.keys(mo).forEach(kind => (mo[kind] || []).forEach(([asin, sku, sp, as, ao, au, cl, im]) => {
          asin = asin || skuAsin[sku] || '';
          const key = by === 'asin' ? (asin || sku) : (sku || (asin + ' · no SKU in the ad report'));
          const r = row(key, b); if (asin) r.asin = r.asin || asin; if (sku) r.skus.add(sku);
          const c = cell(r, mk), t = tot[mk];
          c.sp += sp; c.as += as; c.ao += ao; c.au += au; c.cl += cl; c.im += im;
          t.sp += sp; t.as += as; t.ao += ao; t.au += au; t.cl += cl; t.im += im;
        }));
      });
    });
    // A product's month counts as having ad figures when its brand had a report for that month.
    rows.forEach(r => ms.forEach(mk => { const A = ((M.ads || {})[r.brand] || {})[mk]; if (A && Object.keys(A).length) cell(r, mk).ad = true; }));
    return { rows: [...rows.values()], tot };
  }
  const val = (c, k) => {
    if (!c) return null;
    if (k === 'org') return c.ad ? Math.max(0, c.s - c.as) : null;
    if (k === 'tacos') return c.ad && c.s > 0 ? c.sp / c.s : null;
    if (k === 'acos') return c.ad && c.as > 0 ? c.sp / c.as : null;
    if (['sp', 'as'].includes(k) && !c.ad) return null;
    return c[k];
  };
  const fmt = (k, v) => (v == null ? '—' : k === 'tacos' || k === 'acos' ? (v * 100).toFixed(1) + '%' : k === 'u' || k === 'o' ? int(v) : money(v));
  const sumCells = cs => { const t = Z(); t.ad = cs.length > 0; cs.forEach(c => { if (!c) return; ['s', 'u', 'o', 'sp', 'as', 'ao', 'au', 'cl', 'im'].forEach(f => { t[f] += c[f]; }); if (!c.ad) t.ad = false; }); return t; };

  /* ---------- reading an Ads console report ---------- */
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function readReport(rows) {
    let h = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) if ((rows[i] || []).some(c => ['spend', 'cost'].includes(norm(c)))) { h = i; break; }
    if (h < 0) throw new Error('No "Spend" column found — is this an Ads console report?');
    const H = rows[h].map(norm), find = f => H.findIndex(f);
    const col = {
      date: find(x => x === 'date'), start: find(x => x === 'startdate'), end: find(x => x === 'enddate'),
      asin: find(x => x === 'advertisedasin' || x === 'asin' || x === 'purchasedasin'), sku: find(x => x === 'advertisedsku' || x === 'sku'),
      spend: find(x => x === 'spend' || x === 'cost' || x.startsWith('spend')),
      sales: find(x => /^(7|14|30)daytotalsales/.test(x) || x === 'sales' || x === 'totalsales' || x.startsWith('salesusd')),
      orders: find(x => /^(7|14|30)daytotalorders/.test(x) || x === 'orders' || x === 'purchases' || x === 'totalorders'),
      units: find(x => /^(7|14|30)daytotalunits/.test(x) || x === 'units' || x === 'unitssold' || x === 'totalunits'),
      clicks: find(x => x === 'clicks'), impr: find(x => x === 'impressions'),
    };
    if (col.asin < 0 && col.sku < 0) throw new Error('No "Advertised ASIN" or "Advertised SKU" column — use the Advertised product report.');
    if (col.date < 0 && col.start < 0) throw new Error('No "Date" or "Start Date" column.');
    const num = v => { const n = Number(String(v == null ? '' : v).replace(/[$,%\s]/g, '')); return isFinite(n) ? n : 0; };
    const day = v => {
      if (v == null || v === '') return '';
      if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v))) return new Date(Math.round((Number(v) - 25569) * 864e5)).toISOString().slice(0, 10);
      const s = String(v).trim();
      let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
      m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
      const d = new Date(s + ' 12:00 UTC'); return isNaN(d) ? '' : d.toISOString().slice(0, 10);
    };
    const out = {}, skipped = [];
    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || []; if (!r.some(c => String(c).trim())) continue;
      let d = col.date >= 0 ? day(r[col.date]) : day(r[col.start]);
      if (!d) { skipped.push(i + 1); continue; }
      if (col.date < 0 && col.end >= 0) { const e = day(r[col.end]); if (e && e.slice(0, 7) !== d.slice(0, 7)) throw new Error('Row ' + (i + 1) + ' runs from ' + d + ' to ' + e + ', across months. Run the report with Time unit "Daily", or one month at a time.'); }
      const mk = d.slice(0, 7), asin = col.asin >= 0 ? String(r[col.asin] || '').trim().toUpperCase() : '', sku = col.sku >= 0 ? String(r[col.sku] || '').trim() : '';
      const k = asin + '|' + sku, mo = out[mk] || (out[mk] = {});
      const t = mo[k] || (mo[k] = [asin, sku, 0, 0, 0, 0, 0, 0]);
      t[2] += num(r[col.spend]); if (col.sales >= 0) t[3] += num(r[col.sales]); if (col.orders >= 0) t[4] += num(r[col.orders]);
      if (col.units >= 0) t[5] += num(r[col.units]); if (col.clicks >= 0) t[6] += num(r[col.clicks]); if (col.impr >= 0) t[7] += num(r[col.impr]);
    }
    const months = {}; Object.keys(out).sort().forEach(mk => { months[mk] = Object.values(out[mk]); });
    return { months, skipped, cols: Object.keys(col).filter(k => col[k] < 0) };
  }

  /* ---------- painting ---------- */
  function css() {
    if (document.getElementById('prod-css')) return;
    const s = document.createElement('style'); s.id = 'prod-css';
    s.textContent = `.pr{display:flex;flex-direction:column;gap:14px;--pr-org:var(--y26,var(--yoy-now,#5B8FE0));--pr-ad:var(--y25,var(--yoy-ly,#D0702A));--pr-line:var(--rule,var(--line,#e3e6ea));--pr-mute:var(--muted,#6b7480);--pr-card:var(--panel,var(--card,#fff))}
.pr-bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:13px}
.pr-bar select,.pr-bar input[type=search],.pr-bar input[type=month]{font:inherit;padding:5px 8px;border:1px solid var(--pr-line);border-radius:8px;background:var(--pr-card);color:inherit}
.pr-seg{display:inline-flex;border:1px solid var(--pr-line);border-radius:999px;padding:2px;background:var(--pr-card)}
.pr-seg button,.pr-chip{font:600 12.5px inherit;font-family:inherit;border:0;background:none;color:inherit;padding:5px 12px;border-radius:999px;cursor:pointer}
.pr-seg button.on{background:var(--ink,#1f2937);color:var(--pr-card)}
.pr-chip{border:1px dashed var(--pr-line)}.pr-chip:hover{border-style:solid}
.pr-card{background:var(--pr-card);border:1px solid var(--pr-line);border-radius:12px;padding:12px 14px;min-width:0}
.pr-card h3{margin:0 0 8px;font-size:15px}
.pr-note{font-size:12.5px;color:var(--pr-mute);margin:0}
.pr-scroll{overflow-x:auto;max-width:100%}
.pr table{border-collapse:collapse;width:100%;font-size:12.5px;font-variant-numeric:tabular-nums}
.pr th,.pr td{padding:5px 9px;border-bottom:1px solid var(--pr-line);text-align:right;white-space:nowrap}
.pr th{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--pr-mute);font-weight:700;position:sticky;top:0;background:var(--pr-card)}
.pr th:first-child,.pr td:first-child{text-align:left;position:sticky;left:0;background:var(--pr-card)}
.pr td.l{text-align:left}.pr tfoot td,.pr tr.tot td{font-weight:700}
.pr .up{color:var(--good,#16a34a)}.pr .dn{color:var(--warn,#d97706)}
.pr-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.pr-k div{background:var(--pr-card);border:1px solid var(--pr-line);border-radius:10px;padding:10px 12px}
.pr-k b{display:block;font-size:20px;font-variant-numeric:tabular-nums}.pr-k span{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--pr-mute)}.pr-k i{display:block;font-style:normal;font-size:12px;color:var(--pr-mute)}
.pr svg{display:block;width:100%;height:auto}.pr svg text{fill:var(--pr-mute);font-size:11px}
.pr-up{border:1px dashed var(--pr-line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.pr-files{display:flex;flex-wrap:wrap;gap:6px}.pr-files span{font-size:12px;border:1px solid var(--pr-line);border-radius:999px;padding:3px 8px}
.pr-files button{border:0;background:none;color:var(--warn,#d97706);cursor:pointer;font:inherit;padding:0 0 0 4px}`;
    document.head.appendChild(s);
  }

  function chart(ms, tot) {
    const W = 960, H = 220, L = 54, B = 30, T = 10, n = ms.length;
    const vals = ms.map(mk => tot[mk].s), max = Math.max(1, ...vals) * 1.08;
    const p = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / p) * p;
    const y = v => T + (H - T - B) * (1 - v / top), slot = (W - L - 10) / n, bw = Math.min(46, slot * 0.7);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales by month">`;
    for (let i = 0; i <= 4; i++) { const v = top * i / 4; s += `<line x1="${L}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".12" stroke-dasharray="2 4"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? '$' + Math.round(v / 1000) + 'k' : '$' + v}</text>`; }
    ms.forEach((mk, i) => {
      const t = tot[mk], x = L + slot * i + (slot - bw) / 2, ad = t.ad ? Math.min(t.as, t.s) : 0, org = t.s - ad;
      const tip = `${mName(mk, true)}\nSales ${money(t.s)}` + (t.ad ? `\nAd sales ${money(t.as)} · organic ${money(org)}\nAd spend ${money(t.sp)} · TACoS ${pc(t.sp, t.s)}` : '\nno ad report uploaded for this month');
      s += `<g><title>${esc(tip)}</title><rect x="${x}" y="${y(t.s)}" width="${bw}" height="${y(t.s - ad) - y(t.s) + 0.01}" fill="var(--pr-ad)" rx="2"/><rect x="${x}" y="${y(org)}" width="${bw}" height="${Math.max(0, y(0) - y(org))}" fill="var(--pr-org)" rx="2"/></g>`;
      if (n <= 18 || i % 2 === 0) s += `<text x="${x + bw / 2}" y="${H - B + 16}" text-anchor="middle">${mName(mk)}</text>`;
    });
    return s + '</svg>';
  }

  function render(host, M, opts) {
    css(); opts = opts || {}; host._prod = { M, opts };
    const avail = (M && M.from) || '2025-01', last = nowMonth();
    const brands = ST.brand === 'ALL' ? ['SP', 'CPC'] : [ST.brand];
    if (ST.from < avail) ST.from = avail; if (ST.to > last) ST.to = last; if (ST.from > ST.to) ST.from = ST.to;
    const allMonths = monthsOf(avail, last), ms = monthsOf(ST.from, ST.to);
    const opt = sel => allMonths.map(mk => `<option value="${mk}"${mk === sel ? ' selected' : ''}>${mName(mk, true)}</option>`).join('');
    let html = `<div class="pr">
      <div class="pr-bar">
        <span class="pr-seg" data-k="brand">${['SP', 'CPC', 'ALL'].map(b => `<button data-v="${b}" class="${ST.brand === b ? 'on' : ''}">${b === 'ALL' ? 'Ridhi + CPC' : BR[b]}</button>`).join('')}</span>
        <label>From <select data-k="from">${opt(ST.from)}</select></label><label>to <select data-k="to">${opt(ST.to)}</select></label>
        <span class="pr-seg" data-k="by"><button data-v="asin" class="${ST.by === 'asin' ? 'on' : ''}">By ASIN</button><button data-v="sku" class="${ST.by === 'sku' ? 'on' : ''}">By SKU</button></span>
        ${PRESETS.map((p, i) => `<button class="pr-chip" data-preset="${i}">${p.label}</button>`).join('')}
      </div>`;
    if (!M || !M.d) {
      const b = M && M.building;
      host.innerHTML = html + `<div class="pr-card"><p class="pr-note"><b>Building the report from the Orders workbooks</b>${b ? ` — ${b.book < 1 ? 'Ridhi' : 'CPC'} workbook, row ${int(b.row)}` : ''}. It reads a slice every 15 minutes and is ready in about an hour; this page fills in by itself.</p></div></div>`;
      wire(host); return;
    }
    const { rows, tot } = build(M, brands, ms, ST.by);
    const T = sumCells(ms.map(mk => tot[mk])), adMonths = ms.filter(mk => tot[mk].ad), adAll = ms.filter(mk => tot[mk].ad && tot[mk].adAll);
    const brandTxt = ST.brand === 'ALL' ? 'Ridhi + CPC' : BR[ST.brand];
    // --- headline ---
    html += `<p class="pr-note"><b>${brandTxt} · Amazon.com · ${mName(ms[0], true)} – ${mName(ms[ms.length - 1], true)}</b> · sales, units and orders from the Orders workbooks (MCF, cancelled and other marketplaces left out), copy of ${M.at ? new Date(M.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}`
      + ` · ad figures for ${adMonths.length ? adMonths.length + ' of ' + ms.length + ' months (uploaded Ads console reports)' : 'no months yet — Amazon’s Ads API keeps only about 95 days, so older months need an uploaded Ads console report'}${M.building ? ' · today’s refresh is running' : ''}</p>`;
    const adT = sumCells(adMonths.map(mk => tot[mk]));
    html += `<div class="pr-k">
      <div><span>Sales</span><b>${money(T.s)}</b><i>${int(T.o)} orders · ${int(T.u)} units</i></div>
      <div><span>Average a month</span><b>${money(T.s / ms.length)}</b><i>${ms.length} months</i></div>
      <div><span>Average order</span><b>${T.o ? '$' + (T.s / T.o).toFixed(2) : '—'}</b><i>${T.o ? (T.u / T.o).toFixed(2) + ' units an order' : ''}</i></div>
      <div><span>Ad spend</span><b>${adMonths.length ? money(adT.sp) : '—'}</b><i>${adMonths.length ? 'TACoS ' + pc(adT.sp, adT.s) + ' · ACoS ' + pc(adT.sp, adT.as) : 'no ad report for these months'}</i></div>
      <div><span>Organic sales</span><b>${adMonths.length ? money(Math.max(0, adT.s - adT.as)) : '—'}</b><i>${adMonths.length ? pc(Math.max(0, adT.s - adT.as), adT.s) + ' of sales, in months with ad figures' : 'needs the ad report'}</i></div>
      <div><span>Products sold</span><b>${int(rows.filter(r => ms.some(mk => r.m[mk] && r.m[mk].u > 0)).length)}</b><i>${ST.by === 'asin' ? 'ASINs' : 'SKUs'} with a sale</i></div>
    </div>`;
    // --- month on month ---
    html += `<div class="pr-card"><h3>Month on month</h3>
      <div style="display:flex;gap:16px;font-size:12px;color:var(--pr-mute);margin-bottom:4px"><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--pr-org);margin-right:5px"></i>${adMonths.length ? 'Organic sales' : 'Sales'}</span>${adMonths.length ? '<span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--pr-ad);margin-right:5px"></i>Ad sales</span>' : ''}</div>
      ${chart(ms, tot)}
      <div class="pr-scroll"><table><thead><tr><th>Month</th><th>Sales</th><th>vs month before</th><th>Units</th><th>Orders</th><th>Avg order</th><th>Ad spend</th><th>Ad sales</th><th>Ad orders</th><th>Organic sales</th><th>Organic %</th><th>TACoS</th><th>ACoS</th><th>Clicks</th><th>CPC</th></tr></thead><tbody>`
      + ms.map((mk, i) => { const t = tot[mk], prev = i ? tot[ms[i - 1]].s : null, ad = t.ad, part = ad && !t.adAll ? '*' : '';
        const ch = prev ? Math.round((t.s / prev - 1) * 100) : null;
        return `<tr><td>${mName(mk, true)}</td><td>${money(t.s)}</td><td>${ch == null ? '' : `<span class="${ch >= 0 ? 'up' : 'dn'}">${ch > 0 ? '+' : ''}${ch}%</span>`}</td><td>${int(t.u)}</td><td>${int(t.o)}</td><td>${t.o ? '$' + (t.s / t.o).toFixed(2) : '—'}</td>`
          + `<td>${ad ? money(t.sp) + part : '—'}</td><td>${ad ? money(t.as) + part : '—'}</td><td>${ad ? int(t.ao) : '—'}</td><td>${ad && t.adAll ? money(Math.max(0, t.s - t.as)) : '—'}</td><td>${ad && t.adAll ? pc(Math.max(0, t.s - t.as), t.s) : '—'}</td>`
          + `<td>${ad && t.adAll ? pc(t.sp, t.s) : '—'}</td><td>${ad ? pc(t.sp, t.as) : '—'}</td><td>${ad ? int(t.cl) : '—'}</td><td>${ad && t.cl ? '$' + (t.sp / t.cl).toFixed(2) : '—'}</td></tr>`; }).join('')
      + `</tbody><tfoot><tr><td>Total</td><td>${money(T.s)}</td><td></td><td>${int(T.u)}</td><td>${int(T.o)}</td><td>${T.o ? '$' + (T.s / T.o).toFixed(2) : '—'}</td><td>${adMonths.length ? money(adT.sp) : '—'}</td><td>${adMonths.length ? money(adT.as) : '—'}</td><td>${adMonths.length ? int(adT.ao) : '—'}</td><td>${adAll.length ? money(Math.max(0, adT.s - adT.as)) : '—'}</td><td>${adAll.length ? pc(Math.max(0, adT.s - adT.as), adT.s) : '—'}</td><td>${adAll.length ? pc(adT.sp, adT.s) : '—'}</td><td>${adMonths.length ? pc(adT.sp, adT.as) : '—'}</td><td>${adMonths.length ? int(adT.cl) : '—'}</td><td>${adT.cl ? '$' + (adT.sp / adT.cl).toFixed(2) : '—'}</td></tr></tfoot></table></div>
      ${ST.brand === 'ALL' && adMonths.length > adAll.length ? '<p class="pr-note">* only one brand has an ad report for that month.</p>' : ''}</div>`;
    // --- per product, month by month ---
    const q = ST.q.trim().toUpperCase(), mk0 = ST.metric;
    const totOf = r => { const t = sumCells(ms.map(mk => r.m[mk]).filter(Boolean)); t.ad = ms.some(mk => r.m[mk] && r.m[mk].ad); return t; };
    let list = rows.map(r => ({ r, t: totOf(r) })).filter(x => !q || x.r.key.toUpperCase().includes(q) || x.r.asin.includes(q) || [...x.r.skus].some(s => s.toUpperCase().includes(q)));
    const sortV = x => { const v = val(x.t, mk0); return v == null ? -1 : v; };
    list.sort((a, b) => sortV(b) - sortV(a) || b.t.s - a.t.s);
    const shown = ST.all ? list : list.slice(0, 200);
    html += `<div class="pr-card"><h3>${ST.by === 'asin' ? 'ASIN' : 'SKU'} by month</h3>
      <div class="pr-bar" style="margin-bottom:8px">
        <label>Show <select data-k="metric">${Object.keys(METRICS).map(k => `<option value="${k}"${k === mk0 ? ' selected' : ''}>${METRICS[k]}</option>`).join('')}</select></label>
        <input type="search" data-k="q" placeholder="Find an ASIN or SKU" value="${esc(ST.q)}">
        <button class="pr-chip" data-dl="1">Download CSV (every metric)</button>
        <span class="pr-note">${int(list.length)} ${ST.by === 'asin' ? 'ASINs' : 'SKUs'}${list.length > shown.length ? ', top ' + shown.length + ' shown' : ''}</span>
        ${list.length > 200 ? `<button class="pr-chip" data-all="1">${ST.all ? 'Show top 200' : 'Show all'}</button>` : ''}
      </div>
      <div class="pr-scroll" style="max-height:640px"><table><thead><tr><th>${ST.by === 'asin' ? 'ASIN' : 'SKU'}</th><th>${ST.by === 'asin' ? 'SKUs' : 'ASIN'}</th>${brands.length > 1 ? '<th>Brand</th>' : ''}${ms.map(mk => `<th>${mName(mk)}</th>`).join('')}<th>Total</th><th>Sales</th><th>Units</th><th>Orders</th><th>Ad spend</th><th>TACoS</th></tr></thead><tbody>`
      + `<tr class="tot"><td>All</td><td></td>${brands.length > 1 ? '<td></td>' : ''}${ms.map(mk => `<td>${fmt(mk0, (mk0 === 'org' || mk0 === 'tacos') && !tot[mk].adAll ? null : val(tot[mk], mk0))}</td>`).join('')}<td>${fmt(mk0, val(T, mk0))}</td><td>${money(T.s)}</td><td>${int(T.u)}</td><td>${int(T.o)}</td><td>${adMonths.length ? money(adT.sp) : '—'}</td><td>${adAll.length ? pc(adT.sp, adT.s) : '—'}</td></tr>`
      + shown.map(({ r, t }) => {
        const skus = [...r.skus], second = ST.by === 'asin' ? (skus.length > 2 ? skus.slice(0, 2).join(', ') + ' +' + (skus.length - 2) : skus.join(', ')) : r.asin;
        return `<tr><td class="l">${esc(r.key)}</td><td class="l" title="${esc(skus.join(', '))}">${esc(second)}</td>${brands.length > 1 ? `<td class="l">${BR[r.brand]}</td>` : ''}`
          + ms.map(mk => `<td>${r.m[mk] ? fmt(mk0, val(r.m[mk], mk0)) : (mk0 === 's' || mk0 === 'u' || mk0 === 'o' ? '' : '—')}</td>`).join('')
          + `<td><b>${fmt(mk0, val(t, mk0))}</b></td><td>${money(t.s)}</td><td>${int(t.u)}</td><td>${int(t.o)}</td><td>${t.ad ? money(t.sp) : '—'}</td><td>${t.ad && t.s ? pc(t.sp, t.s) : '—'}</td></tr>`;
      }).join('') + '</tbody></table></div></div>';
    // --- ad reports ---
    html += upHtml(M, opts);
    host.innerHTML = html + '</div>';
    host._prod.rows = rows; host._prod.ms = ms; host._prod.brands = brands;
    wire(host);
  }

  function upHtml(M, opts) {
    const files = (M.files || []);
    const cover = ['SP', 'CPC'].map(b => { const A = (M.ads || {})[b] || {}; const ks = Object.keys(A).sort(); return ks.length ? `<b>${BR[b]}</b>: ` + ks.map(k => Object.keys(A[k]).map(kind => opts.drop ? `<span>${mName(k)} ${kind.toUpperCase()}<button title="Take this month's ${KIND[kind]} figures out" data-drop="${b}|${kind}|${k}">✕</button></span>` : `<span>${mName(k)} ${kind.toUpperCase()}</span>`).join('')).join('') : ''; }).filter(Boolean).join(' ');
    let h = `<div class="pr-up"><h3 style="margin:0;font-size:15px">Ad figures for old months</h3>
      <p class="pr-note">Amazon’s Ads API only keeps about 95 days, so ad spend, ad sales and organic sales for older months come from Ads console reports. In Amazon Ads: Measurement &amp; reporting → Sponsored ads reports → Sponsored Products, report type <b>Advertised product</b>, time unit <b>Daily</b> (or one month at a time), download as .csv or .xlsx. Do the same for Sponsored Display if you run it.</p>
      <div class="pr-files">${cover || '<span>No ad reports uploaded yet</span>'}</div>`;
    if (!opts.upload) return h + '<p class="pr-note">Reports are added in Sellora → Advertising → Live vs Last Year → By product.</p></div>';
    h += `<div class="pr-bar"><label>Brand <select data-up="brand"><option value="SP">Ridhi</option><option value="CPC">CPC</option></select></label>
        <label>Ad type <select data-up="kind"><option value="sp">Sponsored Products</option><option value="sd">Sponsored Display</option><option value="sb">Sponsored Brands</option></select></label>
        <input type="file" data-up="file" accept=".csv,.xlsx,.txt" multiple></div>
      <div data-up="msg" class="pr-note"></div></div>`;
    return h;
  }

  function wire(host) {
    const { M, opts } = host._prod, redraw = () => { save(); render(host, M, opts); };
    host.querySelectorAll('.pr-seg[data-k] button').forEach(b => b.onclick = () => { ST[b.parentElement.dataset.k] = b.dataset.v; ST.all = false; redraw(); });
    host.querySelectorAll('select[data-k]').forEach(s => s.onchange = () => { ST[s.dataset.k] = s.value; if (s.dataset.k === 'from' && ST.to < ST.from) ST.to = ST.from; if (s.dataset.k === 'to' && ST.from > ST.to) ST.from = ST.to; redraw(); });
    const q = host.querySelector('input[data-k="q"]');
    if (q) { let t = 0; q.oninput = () => { clearTimeout(t); t = setTimeout(() => { ST.q = q.value; redraw(); const n = host.querySelector('input[data-k="q"]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); }; }
    host.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { const p = PRESETS[b.dataset.preset]; Object.assign(ST, { brand: p.brand, from: p.from, to: p.to, all: false }); redraw(); });
    const all = host.querySelector('[data-all]'); if (all) all.onclick = () => { ST.all = !ST.all; redraw(); };
    const dl = host.querySelector('[data-dl]'); if (dl) dl.onclick = () => download(host);
    host.querySelectorAll('[data-drop]').forEach(b => b.onclick = async () => {
      const [brand, kind, month] = b.dataset.drop.split('|');
      if (!confirm(`Take ${BR[brand]}'s ${KIND[kind]} figures for ${mName(month, true)} out of the report?`)) return;
      b.disabled = true; const r = await opts.drop({ brand, kind, month }).catch(e => ({ ok: false, error: e.message }));
      if (!r.ok) { alert(r.error || 'Could not take it out.'); b.disabled = false; return; }
      opts.reload && opts.reload();
    });
    const f = host.querySelector('[data-up="file"]');
    if (f) f.onchange = async () => {
      const msg = host.querySelector('[data-up="msg"]'), brand = host.querySelector('[data-up="brand"]').value, kind = host.querySelector('[data-up="kind"]').value;
      const say = (t, bad) => { msg.innerHTML = t; msg.style.color = bad ? 'var(--warn,#d97706)' : ''; };
      for (const file of f.files) {
        try {
          say('Reading ' + esc(file.name) + '…');
          const got = readReport(await opts.readFile(file)), ks = Object.keys(got.months);
          if (!ks.length) throw new Error('No dated rows in ' + file.name + '.');
          const sp = ks.map(k => mName(k) + ' ' + money(got.months[k].reduce((t, r) => t + r[2], 0))).join(' · ');
          if (!confirm(`${file.name}\n${BR[brand]} · ${KIND[kind]}\n${ks.length} month(s): ${sp}\n\nSave these into the report? A month already uploaded for this brand and ad type is replaced.`)) { say('Not saved.'); continue; }
          say('Saving ' + esc(file.name) + '…');
          const r = await opts.upload({ brand, kind, file: file.name, months: got.months });
          if (!r || !r.ok) throw new Error((r && r.error) || 'The backend did not take it.');
          say(`Saved ${esc(file.name)}: ${ks.length} month(s) of ${KIND[kind]} for ${BR[brand]}.` + (got.cols.length ? ' Columns not in this report: ' + got.cols.join(', ') + '.' : ''));
        } catch (e) { say(esc(e.message || e), true); f.value = ''; return; }
      }
      f.value = ''; opts.reload && opts.reload();
    };
  }

  function download(host) {
    const { M, ms, brands } = host._prod;
    const { rows } = build(M, brands, ms, ST.by);
    const head = ['Brand', 'Month', ST.by === 'asin' ? 'ASIN' : 'SKU', ST.by === 'asin' ? 'SKUs' : 'ASIN', 'Sales', 'Units', 'Orders', 'Ad spend', 'Ad sales', 'Ad orders', 'Ad units', 'Organic sales', 'Clicks', 'Impressions', 'TACoS %', 'ACoS %'];
    const q = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const r2 = v => (v == null ? '' : Math.round(v * 100) / 100);
    const lines = [head.join(',')];
    rows.forEach(r => ms.forEach(mk => {
      const c = r.m[mk]; if (!c) return;
      lines.push([BR[r.brand], mk, r.key, ST.by === 'asin' ? [...r.skus].join(' ') : r.asin, r2(c.s), c.u, c.o,
        c.ad ? r2(c.sp) : '', c.ad ? r2(c.as) : '', c.ad ? c.ao : '', c.ad ? c.au : '', c.ad ? r2(Math.max(0, c.s - c.as)) : '',
        c.ad ? c.cl : '', c.ad ? c.im : '', c.ad && c.s ? r2(c.sp / c.s * 100) : '', c.ad && c.as ? r2(c.sp / c.as * 100) : ''].map(q).join(','));
    }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `Amazon by ${ST.by === 'asin' ? 'ASIN' : 'SKU'} by month - ${brands.map(b => BR[b]).join(' + ')} - ${ms[0]} to ${ms[ms.length - 1]}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  window.ProdReport = { render, readReport };
})();
