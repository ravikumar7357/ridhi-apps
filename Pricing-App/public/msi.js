/* msi.js — live.html's MSI tab (Ravi, 24 Nov 2026: "build the MSI section — everything Amazon gives — only in live.html").
 * Draws what the backend's liveAmzTick_ (Pricing-API/SalesLive.gs) collects per brand, handed over inside the months tab as
 * M.amz = { at, SP|CPC: { tr, trLy, inv, age, sqp, bask, *Err, *At } }:
 *   Traffic & conversion — Sales & Traffic report, last 30 finished days against the same weekdays a year back
 *   Inventory            — FBA + AWD stock from the inventory sync (every 3 hours)
 *   Inventory age        — FBA Inventory Planning report
 *   Search               — Brand Analytics Search Query Performance, last full month, summed per query over the brand's ASINs
 *   Bought together      — Brand Analytics Market Basket, last full month
 * Uses live.html's own helpers (tile, usd, usdk, int, pc, bars, dname, change), so it only works on that page.
 * MSI.render(host, amz, brandKeys). */
(function () {
  const BR = { SP: 'Ridhi', CPC: 'CPC' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct1 = v => (v == null || !isFinite(v) ? '—' : v.toFixed(1) + '%');
  const pts = (a, b) => { if (a == null || b == null || !b) return ['—', '']; const d = Math.round((a - b) * 10) / 10; return [(d > 0 ? '+' : '') + d.toFixed(1) + ' pts', d > 0 ? 'up' : d < 0 ? 'dn' : '']; };
  const css = () => {
    if (document.getElementById('msi-css')) return;
    const s = document.createElement('style'); s.id = 'msi-css';
    s.textContent = `.msiwrap{display:none}body[data-period="msi"] .msiwrap{display:flex;flex-direction:column;gap:20px}body[data-period="msi"] .box{display:none!important}
.box.msi{--sec:#FF9900;--tag:#232F3E}.box.msi.inv{--sec:#14b8a6;--tag:#0f766e}.box.msi.age{--sec:#a855f7;--tag:#7e22ce}.box.msi.sqp{--sec:#3b82f6;--tag:#1d4ed8}.box.msi.bask{--sec:#ec4899;--tag:#be185d}
body[data-period="msi"] .box.msi{display:flex!important}
.msi .tbl{overflow-x:auto}.msi table td.l{text-align:left}.msi .note{font-size:12.5px;color:var(--muted);margin:0}.msi .two{align-items:start}
.msi .wait{border:1px dashed var(--rule);border-radius:10px;padding:12px 14px;font-size:13.5px;color:var(--ink2)}`;
    document.head.appendChild(s);
  };
  const waitBox = (what, err) => `<div class="wait">${err ? 'Could not read ' + what + ': ' + esc(err) : what + ' is being collected — Amazon builds this report in a few minutes; it shows up on the next refresh.'}</div>`;
  const box = (cls, tag, sub, inner) => `<div class="box msi ${cls}"><div class="boxh"><span class="tag">${tag}</span><span>${sub}</span></div>${inner}</div>`;

  /* ---------- Traffic & conversion ---------- */
  function sum(days) {
    const t = { s: 0, pv: 0, bbw: 0, u: 0, sales: 0, oi: 0, b2b: 0, b2bU: 0, n: days.length };
    days.forEach(d => { t.s += d[1]; t.pv += d[2]; t.bbw += d[3] * d[2]; t.u += d[5]; t.sales += d[6]; t.oi += d[7]; t.b2b += d[8]; t.b2bU += d[9]; });
    t.conv = t.s ? t.u / t.s * 100 : null; t.bb = t.pv ? t.bbw / t.pv : null; return t;
  }
  function traffic(b, P, hostId) {
    if (!P.tr) return box('', 'Traffic & conversion', BR[b], waitBox('The Sales & Traffic report', P.trErr));
    const T = sum(P.tr.days), L = P.trLy ? sum(P.trLy.days) : null;
    const [cS, kS] = change(T.s, L && L.s), [cP, kP] = change(T.pv, L && L.pv), [cU, kU] = change(T.u, L && L.u), [cR, kR] = change(T.sales, L && L.sales);
    const [cC, kC] = pts(T.conv, L && L.conv), [cB, kB] = pts(T.bb, L && L.bb);
    const span = P.tr.from && P.tr.to ? dname(P.tr.from, false) + ' – ' + dname(P.tr.to, true) : 'last 30 days';
    const ly = L && P.trLy.from ? ` against ${dname(P.trLy.from, false)} – ${dname(P.trLy.to, true)}` : ' (last year not collected yet)';
    const tiles1 = tile('Sessions', int(T.s), L ? `last year ${int(L.s)} · ${cS}` : '', kS, false, '#FF9900', 'Visits to the product pages (Amazon counts a session as visits within 24 hours).')
      + tile('Conversion', pct1(T.conv), L ? `last year ${pct1(L.conv)} · ${cC}` : 'units ÷ sessions', kC, false, '#14b8a6', 'Unit session percentage: units ordered ÷ sessions.')
      + tile('Buy Box', pct1(T.bb), L ? `last year ${pct1(L.bb)} · ${cB}` : 'share of page views', kB, false, '#6366f1', 'Featured offer (Buy Box) percentage, weighted by page views.')
      + tile('Page views', int(T.pv), L ? `last year ${int(L.pv)} · ${cP}` : '', kP, false, '#3b82f6');
    const tiles2 = tile('Ordered sales', usd(T.sales), L ? `last year ${usd(L.sales)} · ${cR}` : '', kR, false, '#ec4899', 'Ordered product sales as the Sales & Traffic report counts them.')
      + tile('Units', int(T.u), L ? `last year ${int(L.u)} · ${cU}` : `${int(T.oi)} order items`, kU, false, '#f59e0b')
      + tile('B2B sales', usd(T.b2b), `${pc(T.b2b, T.sales)} of sales · ${int(T.b2bU)} units`, '', false, '#64748b', 'Amazon Business orders.')
      + tile('Sessions a day', int(T.s / Math.max(1, T.n)), `${int(T.pv / Math.max(1, T.n))} page views a day`, '', false, '#94a3b8');
    const top = (P.tr.asins || []).slice(0, 25).map(a => `<tr><td class="l">${esc(a[0])}</td><td>${int(a[1])}</td><td>${int(a[2])}</td><td>${pct1(a[4])}</td><td>${pct1(a[3])}</td><td>${int(a[5])}</td><td>${usd(a[6])}</td><td>${a[7] ? usd(a[7]) : '—'}</td></tr>`).join('');
    return box('', 'Traffic & conversion', `${BR[b]} · Sales & Traffic report · ${span}${ly}${P.trErr ? ' · last refresh failed: ' + esc(P.trErr) : ''}`,
      `<div class="strip big four">${tiles1}</div><div class="strip big four">${tiles2}</div>
      <div class="two"><section class="card"><h2>Sessions by day</h2><div class="legend"><span><i style="background:var(--y26)"></i>This year</span><span><i style="background:var(--y25)"></i>Same weekday last year</span><span><i class="dash"></i>Conversion % × 100 (this year)</span></div><div class="chart" id="${hostId}"></div></section>
      <div class="card tcard"><h2>Top ASINs, 30 days</h2><div class="tbl"><table><thead><tr><th>ASIN</th><th>Sessions</th><th>Page views</th><th>Conv.</th><th>Buy Box</th><th>Units</th><th>Sales</th><th>B2B</th></tr></thead><tbody>${top}</tbody></table></div><p class="note">${int(P.tr.nAsins || 0)} ASINs had traffic · top 25 by sales</p></div></div>`);
  }
  function drawTraffic(P, hostId) {
    const host = document.getElementById(hostId); if (!host || !P.tr) return;
    const D = P.tr.days, L = (P.trLy || {}).days || [];
    bars(host, D.map(d => dname(d[0]).replace(/^(\w+) /, '$1\n')), [
      { vals: D.map(d => d[1]), fill: 'var(--y26)', tip: i => 'Sessions ' + dname(D[i][0], true) },
      { vals: D.map((d, i) => (L[i] ? L[i][1] : null)), fill: 'var(--y25)', tip: i => 'Sessions ' + (L[i] ? dname(L[i][0], true) : 'last year') },
    ], { vals: D.map(d => d[4] * 100), tip: i => 'Conversion ' + pct1(D[i][4]) + ' ×100' });
  }

  /* ---------- Inventory ---------- */
  function inventory(b, P) {
    if (!P.inv) return box('inv', 'Inventory', BR[b], waitBox('The inventory snapshot', P.invErr));
    const t = P.inv.t, perDay = t.l30 / 30, cover = perDay > 0 ? Math.round(t.total / perDay) : null;
    const at = P.inv.at ? new Date(P.inv.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
    const rows = list => list.map(r => `<tr><td class="l">${esc(r[0])}</td><td class="l">${esc(r[1])}</td><td class="l">${esc([r[2], r[3]].filter(Boolean).join(' · '))}</td><td>${int(r[4])}</td><td>${int(r[5])}</td><td>${int(r[6])}</td><td>${int(r[7])}</td><td>${r[8] ? int(r[8]) : '—'}</td></tr>`).join('') || '<tr><td class="l" colspan="8">None</td></tr>';
    const head = '<thead><tr><th>SKU</th><th>ASIN</th><th>Colour · size</th><th>Available</th><th>Inbound</th><th>AWD</th><th>Sold 30 d</th><th>Days cover</th></tr></thead>';
    return box('inv', 'Inventory', `${BR[b]} · FBA + AWD, from the inventory sync (every 3 hours) · as of ${at}`,
      `<div class="strip big four">
        ${tile('Available (FBA)', int(t.ful), `${int(t.res)} reserved · ${int(t.uns)} unsellable`, '', false, '#14b8a6', 'Fulfillable units in Amazon warehouses.')}
        ${tile('Inbound', int(t.inbound), 'working + shipped + receiving', '', false, '#3b82f6')}
        ${tile('AWD', int(t.awd + t.awdT), `${int(t.awd)} stored · ${int(t.awdT)} in transit`, '', false, '#6366f1', 'Amazon Warehousing & Distribution.')}
        ${tile('Days of cover', cover == null ? '—' : int(cover), `${int(t.total)} units on hand ÷ ${int(perDay)} sold a day (30 d)`, '', false, '#f59e0b', 'All stock ÷ average daily units over the last 30 days.')}
      </div><div class="strip big four">
        ${tile('Out of stock, selling', int(t.oosSelling), `of ${int(t.oos)} SKUs at zero`, t.oosSelling ? 'dn' : '', false, '#ef4444', 'SKUs with no fulfillable stock that sold in the last 30 days.')}
        ${tile('Running low', P.inv.low.length >= 30 ? '30+' : int(P.inv.low.length), 'selling SKUs under 21 days of cover', P.inv.low.length ? 'dn' : '', false, '#f97316')}
        ${tile('SKUs', int(t.skus), `${int(t.l30)} units sold in 30 days`, '', false, '#64748b')}
        ${tile('Sales, 90 days', usd(t.l90amt), 'from the orders behind the cover figures', '', false, '#ec4899')}
      </div>
      <div class="two"><div class="card tcard"><h2>Out of stock and still selling</h2><div class="tbl"><table>${head}<tbody>${rows(P.inv.out)}</tbody></table></div></div>
      <div class="card tcard"><h2>Running low (under 21 days)</h2><div class="tbl"><table>${head}<tbody>${rows(P.inv.low)}</tbody></table></div></div></div>`);
  }

  /* ---------- Inventory age ---------- */
  function age(b, P) {
    if (!P.age) return box('age', 'Inventory age', BR[b], waitBox('The inventory age report', P.ageErr));
    const A = P.age, name = c => c.replace(/^inv[-_ ]?age[-_ ]?/i, '').replace(/[-_]/g, ' ').replace(/ days?$/i, '') + ' days';
    /* Amazon's report carries two overlapping sets of buckets (0–90, 91–180 … and 0–30, 31–60 …) and a snapshot-date column.
       Only one chain that does not overlap is counted: in the report's own order, each bucket starting where the last ended —
       0–90, 91–180, 181–270, 271–365, 366–455, 456+ (24 Nov: the overlap had been summed, so the shares read 2%). */
    const chain = []; let next = 0;
    A.cols.forEach((c, i) => {
      const m = c.match(/(\d+)[-_ ]to[-_ ](\d+)[-_ ]days?/i), p = c.match(/(\d+)[-_ ]plus[-_ ]days?/i);
      if (m && +m[1] === next) { chain.push(i); next = +m[2] + 1; } else if (p && +p[1] === next) { chain.push(i); next = Infinity; }
    });
    const all = chain.reduce((t, i) => t + A.tot[i], 0), colors = ['#14b8a6', '#3b82f6', '#6366f1', '#a855f7', '#f59e0b', '#f97316', '#ef4444'];
    const tiles = chain.map((i, k) => tile(name(A.cols[i]), int(A.tot[i]), pc(A.tot[i], all) + ' of FBA units', k >= chain.length - 2 && A.tot[i] ? 'dn' : '', false, colors[k % 7])).join('')
      + tile('Storage cost', usd(A.storage), 'estimated, this month', '', false, '#64748b');
    // The backend picked these SKUs by the report's last two columns, which are "331–365 days" and the snapshot date — so the
    // list is the SKUs with the most stock aged 331–365 days, and is called that; its columns are the chain above.
    const i331 = A.cols.findIndex(c => /331[-_ ]to[-_ ]365/i.test(c));
    const rows = A.oldest.map(r => `<tr><td class="l">${esc(r[0])}</td><td class="l">${esc(r[1])}</td><td>${int(r[2])}</td>${chain.map(i => `<td>${r[3][i] ? int(r[3][i]) : ''}</td>`).join('')}<td>${i331 >= 0 && r[3][i331] ? int(r[3][i331]) : ''}</td><td>${r[4] ? usd(r[4]) : '—'}</td></tr>`).join('') || `<tr><td class="l" colspan="${5 + chain.length}">None</td></tr>`;
    return box('age', 'Inventory age', `${BR[b]} · FBA Inventory Planning report · ${int(all)} units in ${int(A.skus)} SKUs${P.ageAt ? ' · ' + dname(P.ageAt.slice(0, 10), true) : ''}`,
      `<div class="strip big four">${tiles}</div>
      <div class="card tcard"><h2>SKUs with the most stock aged 331–365 days</h2><div class="tbl"><table><thead><tr><th>SKU</th><th>ASIN</th><th>Available</th>${chain.map(i => `<th>${esc(name(A.cols[i]))}</th>`).join('')}<th>331–365 days</th><th>Storage</th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
  }

  /* ---------- Search (Brand Analytics SQP) ---------- */
  function search(b, P) {
    // Only what we actually get (Ravi, 24 Nov): no Search section until Brand Analytics Search Query Performance comes back.
    if (!P.sqp) return '';
    const S = P.sqp, mo = new Date(S.month + '-15T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    const share = (a, m) => (m ? pct1(a / m * 100) : '—');
    const row = q => `<tr><td class="l">${esc(q[0])}</td><td>${int(q[1])}</td><td>${int(q[2])}</td><td>${share(q[2], q[3])}</td><td>${int(q[4])}</td><td>${share(q[4], q[5])}</td><td>${int(q[6])}</td><td><b>${int(q[7])}</b></td><td>${share(q[7], q[8])}</td><td>${int(q[9])}</td></tr>`;
    const head = '<thead><tr><th>Search query</th><th>Searches</th><th>Our impr.</th><th>Share</th><th>Our clicks</th><th>Share</th><th>Cart adds</th><th>Our purchases</th><th>Share</th><th>Our ASINs</th></tr></thead>';
    return box('sqp', 'Search', `${BR[b]} · Brand Analytics Search Query Performance · ${mo} · ${int(S.queries)} queries${S.asins ? ' · the brand’s ' + S.asins + ' best-selling ASINs' : ''}`,
      `<div class="card tcard"><h2>Queries that sold the most</h2><div class="tbl"><table>${head}<tbody>${S.top.map(row).join('')}</tbody></table></div><p class="note">Share = our ASINs' figure ÷ the whole market's for that query. Amazon gives this report only for named ASINs (200 characters at most), so it covers the brand's best sellers of the last 30 days.</p></div>
      <div class="card tcard"><h2>Searched a lot, no purchase from us</h2><div class="tbl"><table>${head}<tbody>${S.missed.map(row).join('') || '<tr><td class="l" colspan="10">None</td></tr>'}</tbody></table></div></div>`);
  }

  /* ---------- Bought together (Market Basket) ---------- */
  function basket(b, P) {
    if (!P.bask) return box('bask', 'Bought together', BR[b], waitBox('Brand Analytics (Market Basket)', P.baskErr));
    const K = P.bask, mo = new Date(K.month + '-15T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' });
    // Only the columns Amazon filled: in this report the share and title came back empty (24 Nov), so they are left out then.
    const pS = K.pairs.some(p => +p[4]), pT = K.pairs.some(p => p[5]), gT = K.gaps.some(g => g[1]), gS = K.gaps.some(g => +g[3]);
    const link = a => `<a href="https://www.amazon.com/dp/${encodeURIComponent(a)}" target="_blank" rel="noopener">${esc(a)}</a>`;
    const pairs = K.pairs.map(p => `<tr><td class="l">${link(p[0])}${p[1] ? ' · ' + esc(p[1]) : ''}</td><td class="l">${link(p[2])}${p[3] ? ' · ' + esc(p[3]) : ''}</td>${pS ? `<td>${pct1(+p[4])}</td>` : ''}${pT ? `<td class="l">${esc(p[5])}</td>` : ''}</tr>`).join('') || '<tr><td class="l" colspan="4">None</td></tr>';
    const gaps = K.gaps.map(g => `<tr><td class="l">${link(g[0])}</td>${gT ? `<td class="l">${esc(g[1])}</td>` : ''}<td>${int(g[2])}</td>${gS ? `<td>${pct1(+g[3])}</td>` : ''}</tr>`).join('') || '<tr><td class="l" colspan="4">None</td></tr>';
    return box('bask', 'Bought together', `${BR[b]} · Brand Analytics Market Basket · ${mo} (the latest month Amazon gave)`,
      `<div class="two"><div class="card tcard"><h2>Our products bought together (bundle ideas)</h2><div class="tbl"><table><thead><tr><th>Product</th><th>Bought with</th>${pS ? '<th>Share</th>' : ''}${pT ? '<th>Title</th>' : ''}</tr></thead><tbody>${pairs}</tbody></table></div></div>
      <div class="card tcard"><h2>Other sellers' products bought with ours (range gaps)</h2><div class="tbl"><table><thead><tr><th>ASIN</th>${gT ? '<th>Title</th>' : ''}<th>Bought with how many of ours</th>${gS ? '<th>Best share</th>' : ''}</tr></thead><tbody>${gaps}</tbody></table></div><p class="note">ASINs open on Amazon.com.</p></div></div>`);
  }

  function render(host, amz, keys) {
    css();
    if (!amz) { host.innerHTML = `<div class="box msi"><div class="wait">The MSI figures arrive with the next backend run (every 15 minutes); Amazon's reports take a little longer the first time.</div></div>`; return; }
    host.innerHTML = keys.map(b => { const P = amz[b] || {}; return traffic(b, P, 'msiTr' + b) + inventory(b, P) + age(b, P) + search(b, P) + basket(b, P); }).join('');
    keys.forEach(b => drawTraffic(amz[b] || {}, 'msiTr' + b));
  }
  window.MSI = { render };
})();
