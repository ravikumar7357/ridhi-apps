/* monthly-report.js — the requested report on live.html only (Ravi, 24 Nov 2026: "Need Jan'25 to May'25 Amazon Sales Data for
 * Ridhi Month on Month & Jan'25 to March'26 Amazon Sales Data for CPC — sales, ads / organic, spend, orders, units, ASIN SKU
 * wise … add this to the html only").
 *
 * A card at the top of live.html's By product tab: both brands' months side by side, and a "Download Excel" button that
 * builds the workbook in the browser from the same data (the "months" tab of the published live sheet — Pricing-API
 * liveMonths_): Read me · Ridhi monthly · Ridhi by ASIN · Ridhi by SKU · CPC monthly · CPC by ASIN · CPC by SKU · All rows.
 * Orders on the monthly and ASIN sheets are counted once per order (the backend's o / ao counts); on the SKU sheets per SKU.
 * Ad spend / ad sales / organic appear only for months with an uploaded Ads console report (Amazon's Ads API keeps ~95 days).
 * MonthlyReport.render(host, M) · MonthlyReport.workbook(M) → Blob. */
(function () {
  const RANGES = { SP: ['2025-01', '2025-05'], CPC: ['2025-01', '2026-03'] };
  const NAME = { SP: 'Ridhi', CPC: 'CPC' };
  const monthsOf = (a, b) => { const r = []; let [y, m] = a.split('-').map(Number); for (let i = 0; i < 120; i++) { const k = y + '-' + String(m).padStart(2, '0'); if (k > b) break; r.push(k); if (++m > 12) { m = 1; y++; } } return r; };
  const mLabel = mk => new Date(mk + '-15T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', month: 'short', year: 'numeric' });
  const money = v => '$' + Math.round(v || 0).toLocaleString('en-US');
  const int = v => Math.round(v || 0).toLocaleString('en-US');
  const escH = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- the figures, per brand ---------- */
  function brandData(M, br) {
    const D = (M.d || {})[br], ms = monthsOf(...RANGES[br]), A = (M.ads || {})[br] || {};
    if (!D) return null;
    const sku = {}, asin = {}, months = [];
    ms.forEach(mk => {
      const rows = D.m[mk] || [];
      let s = 0, u = 0; const aSold = new Set(); let sSold = 0;
      rows.forEach(([ix, sa, un, o]) => {
        const [k, a] = D.skus[ix] || ['?', ''];
        s += sa; u += un; if (un > 0) { aSold.add(a || k); sSold++; }
        (sku[k] || (sku[k] = { a, m: {} })).m[mk] = [sa, un, o];
        const key = a || k, X = asin[key] || (asin[key] = { skus: new Set(), m: {} }); X.skus.add(k);
        const c = X.m[mk] || (X.m[mk] = [0, 0, 0]); c[0] += sa; c[1] += un;
      });
      const ad = A[mk] && Object.keys(A[mk]).length ? Object.values(A[mk]).flat().reduce((t, r) => [t[0] + r[2], t[1] + r[3]], [0, 0]) : null;
      months.push({ mk, s, u, o: (D.o || {})[mk] || 0, nA: aSold.size, nS: sSold, ad });
    });
    Object.keys(asin).forEach(a => ms.forEach(mk => { if (asin[a].m[mk]) asin[a].m[mk][2] = ((D.ao || {})[a] || {})[mk] || 0; }));
    return { D, ms, sku, asin, months };
  }

  /* ---------- the card ---------- */
  function css() {
    if (document.getElementById('mrep-css')) return;
    const s = document.createElement('style'); s.id = 'mrep-css';
    s.textContent = `.mrep{background:var(--panel,#fff);border:1px solid var(--rule,#e3e6ea);border-top:4px solid #6366f1;border-radius:14px;padding:14px 16px 16px;margin-bottom:16px;display:flex;flex-direction:column;gap:12px}
.mrep-h{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}.mrep-h h2{margin:0;font-size:18px}
.mrep-h .tag{font:800 13px/1 var(--f-display,inherit);color:#fff;background:#4F46E5;padding:6px 10px;border-radius:8px}
.mrep-h button{margin-left:auto;font:700 13px var(--f-display,inherit);color:#fff;background:var(--y26,#5B8FE0);border:0;border-radius:999px;padding:8px 16px;cursor:pointer;min-height:36px}
.mrep-h button[disabled]{opacity:.6;cursor:progress}
.mrep-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:12px}@media(max-width:1000px){.mrep-two{grid-template-columns:1fr}}
.mrep table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
.mrep th,.mrep td{padding:5px 8px;border-bottom:1px solid var(--rule,#e3e6ea);text-align:right;white-space:nowrap}
.mrep th:first-child,.mrep td:first-child{text-align:left}.mrep th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted,#6b7480)}
.mrep tfoot td{font-weight:700}.mrep h3{margin:0 0 6px;font-size:14px}.mrep .up{color:var(--good,#16a34a)}.mrep .dn{color:var(--warn,#d97706)}
.mrep p{margin:0;font-size:12.5px;color:var(--muted,#6b7480)}.mrep .scroll{overflow-x:auto}`;
    document.head.appendChild(s);
  }
  function table(b) {
    let T = [0, 0, 0], prev = null;
    const body = b.months.map(x => {
      const ch = prev ? Math.round((x.s / prev - 1) * 100) : null; prev = x.s; T[0] += x.s; T[1] += x.u; T[2] += x.o;
      return `<tr><td>${mLabel(x.mk)}</td><td>${money(x.s)}</td><td>${ch == null ? '' : `<span class="${ch >= 0 ? 'up' : 'dn'}">${ch > 0 ? '+' : ''}${ch}%</span>`}</td><td>${int(x.u)}</td><td>${int(x.o)}</td><td>${x.o ? '$' + (x.s / x.o).toFixed(2) : '—'}</td><td>${int(x.nA)}</td><td>${x.ad ? money(x.ad[0]) : '—'}</td><td>${x.ad ? money(Math.max(0, x.s - x.ad[1])) : '—'}</td></tr>`;
    }).join('');
    return `<table><thead><tr><th>Month</th><th>Sales</th><th>vs before</th><th>Units</th><th>Orders</th><th>Avg order</th><th>ASINs sold</th><th>Ad spend</th><th>Organic</th></tr></thead><tbody>${body}</tbody>
      <tfoot><tr><td>Total</td><td>${money(T[0])}</td><td></td><td>${int(T[1])}</td><td>${int(T[2])}</td><td>${T[2] ? '$' + (T[0] / T[2]).toFixed(2) : '—'}</td><td></td><td></td><td></td></tr></tfoot></table>`;
  }
  function render(host, M) {
    css();
    if (!M || !M.d) { host.innerHTML = ''; return; }
    const R = brandData(M, 'SP'), C = brandData(M, 'CPC');
    const anyAds = [R, C].some(b => b && b.months.some(x => x.ad));
    host.innerHTML = `<div class="mrep">
      <div class="mrep-h"><span class="tag">Report</span><h2>Amazon sales month on month — Ridhi Jan–May 2025 · CPC Jan 2025–Mar 2026</h2>
        <button type="button" data-mrep-dl>Download Excel (by ASIN and SKU)</button></div>
      <div class="mrep-two">
        <div class="scroll"><h3>Ridhi · January – May 2025</h3>${R ? table(R) : '<p>Not in the data yet.</p>'}</div>
        <div class="scroll"><h3>CPC · January 2025 – March 2026</h3>${C ? table(C) : '<p>Not in the data yet.</p>'}</div>
      </div>
      <p>Amazon.com orders from each brand's Orders workbook (cancelled, MCF and other marketplaces left out); sales are what buyers paid for the items, no shipping or tax. An order counts once even with two SKUs. The Excel has every ASIN and SKU month by month.
      ${anyAds ? 'Ad spend and organic sales are shown for the months with an uploaded Ads console report.' : 'Ad spend, ad sales and organic sales: Amazon’s Ads API keeps only about 95 days, so these months have none — they fill in once Ads console reports for them are uploaded in Sellora (By product).'}</p>
    </div>`;
    const btn = host.querySelector('[data-mrep-dl]');
    btn.onclick = () => {
      btn.disabled = true; btn.textContent = 'Building…';
      setTimeout(() => {
        try {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(workbook(M));
          a.download = 'Amazon monthly by ASIN and SKU - Ridhi Jan-May 2025, CPC Jan 2025-Mar 2026.xlsx';
          document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        } catch (e) { alert('Could not build the file: ' + e.message); }
        btn.disabled = false; btn.textContent = 'Download Excel (by ASIN and SKU)';
      }, 30);
    };
  }

  /* ---------- the workbook (a small xlsx writer: stored zip, inline strings) ---------- */
  const CRCT = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
  const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRCT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
    files.forEach(([name, str]) => {
      const data = enc.encode(str), nb = enc.encode(name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
      parts.push(new Uint8Array(h.buffer), nb, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), nb); off += 30 + nb.length + data.length;
    });
    const cdLen = cen.reduce((t, x) => t + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cen, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const col = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  // cell: string | number | null | {v, s}: s 1 bold header, 2 money, 3 integer, 4 bold money, 5 percent, 6 bold integer, 7 wrapped text
  function sheetXml(rows, opt) {
    opt = opt || {};
    const cols = (opt.widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const pane = opt.freeze ? `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${opt.freeze[0]}" ySplit="${opt.freeze[1]}" topLeftCell="${col(opt.freeze[0])}${opt.freeze[1] + 1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>` : '';
    const out = [];
    rows.forEach((r, ri) => {
      let x = `<row r="${ri + 1}">`;
      r.forEach((c, ci) => {
        if (c == null || c === '') return;
        const o = typeof c === 'object' ? c : { v: c }, ref = col(ci) + (ri + 1), s = o.s ? ` s="${o.s}"` : '';
        x += typeof o.v === 'number' && isFinite(o.v) ? `<c r="${ref}"${s}><v>${Math.round(o.v * 10000) / 10000}</v></c>` : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
      });
      out.push(x + '</row>');
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols ? '<cols>' + cols + '</cols>' : ''}<sheetData>${out.join('')}</sheetData></worksheet>`;
  }
  function pack(sheets) {
    const f = [];
    f.push(['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`]);
    f.push(['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
    f.push(['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`]);
    f.push(['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
    f.push(['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F7"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="8"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="3" applyNumberFormat="1"/><xf numFmtId="164" fontId="1" applyNumberFormat="1" applyFont="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="3" fontId="1" applyNumberFormat="1" applyFont="1"/><xf applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`]);
    sheets.forEach((s, i) => f.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.opt)]));
    return zip(f);
  }
  function workbook(M) {
    const B = v => ({ v, s: 1 }), $ = v => ({ v, s: 2 }), N = v => ({ v, s: 3 }), P = v => (v == null ? '—' : { v, s: 5 });
    const sheets = [], flat = [[B('Brand'), B('Month'), B('ASIN'), B('SKU'), B('Sales'), B('Units'), B('Orders (this SKU)')]];
    ['SP', 'CPC'].forEach(br => {
      const b = brandData(M, br); if (!b) return;
      const mrows = [[B('Month'), B('Sales'), B('vs month before'), B('Units'), B('Orders'), B('Avg order value'), B('Units per order'), B('ASINs sold'), B('SKUs sold'), B('Ad spend'), B('Ad sales'), B('Organic sales'), B('TACoS')]];
      let T = [0, 0, 0], prev = null;
      b.months.forEach(x => {
        const na = 'not available';
        mrows.push([mLabel(x.mk), $(x.s), prev ? P(x.s / prev - 1) : '', N(x.u), N(x.o), x.o ? $(x.s / x.o) : '', x.o ? { v: x.u / x.o } : '', N(x.nA), N(x.nS),
          x.ad ? $(x.ad[0]) : na, x.ad ? $(x.ad[1]) : na, x.ad ? $(Math.max(0, x.s - x.ad[1])) : na, x.ad ? P(x.ad[0] / x.s) : na]);
        T[0] += x.s; T[1] += x.u; T[2] += x.o; prev = x.s;
      });
      mrows.push([B('Total'), { v: T[0], s: 4 }, '', { v: T[1], s: 6 }, { v: T[2], s: 6 }, T[2] ? { v: T[0] / T[2], s: 4 } : '']);
      sheets.push({ name: NAME[br] + ' monthly', rows: mrows, opt: { widths: [12, 14, 16, 10, 10, 15, 15, 11, 11, 14, 14, 14, 14], freeze: [1, 1] } });
      const grid = (map, kind) => {
        const head = [B(kind === 'asin' ? 'ASIN' : 'SKU'), B(kind === 'asin' ? 'SKUs' : 'ASIN')];
        b.ms.forEach(mk => head.push(B(mLabel(mk) + ' Sales'), B(mLabel(mk) + ' Units'), B(mLabel(mk) + ' Orders')));
        head.push(B('Total Sales'), B('Total Units'), B('Total Orders'), B('Share of sales'));
        const list = Object.keys(map).map(k => { const x = map[k], t = b.ms.reduce((a, mk) => { const c = x.m[mk]; if (c) { a[0] += c[0]; a[1] += c[1]; a[2] += c[2]; } return a; }, [0, 0, 0]); return { k, x, t }; })
          .filter(r => r.t[0] || r.t[1]).sort((p, q) => q.t[0] - p.t[0]);
        const rows = [head];
        list.forEach(({ k, x, t }) => {
          const r = [k, kind === 'asin' ? [...x.skus].sort().join(', ') : (x.a || '')];
          b.ms.forEach(mk => { const c = x.m[mk]; r.push(c ? $(c[0]) : '', c ? N(c[1]) : '', c ? N(c[2]) : ''); });
          r.push({ v: t[0], s: 4 }, { v: t[1], s: 6 }, { v: t[2], s: 6 }, P(T[0] ? t[0] / T[0] : null));
          rows.push(r);
        });
        return rows;
      };
      const w = b.ms.flatMap(() => [12, 8, 8]).concat([13, 11, 11, 11]);
      sheets.push({ name: NAME[br] + ' by ASIN', rows: grid(b.asin, 'asin'), opt: { widths: [14, 34].concat(w), freeze: [2, 1] } });
      sheets.push({ name: NAME[br] + ' by SKU', rows: grid(b.sku, 'sku'), opt: { widths: [26, 14].concat(w), freeze: [2, 1] } });
      b.ms.forEach(mk => (b.D.m[mk] || []).forEach(([ix, s, u, o]) => { const [k, a] = b.D.skus[ix]; flat.push([NAME[br], mLabel(mk), a, k, $(s), N(u), N(o)]); }));
    });
    const W = s => ({ v: s, s: 7 });
    const notes = [[B('Amazon.com sales by month, per ASIN and SKU')], [W('Ridhi: January – May 2025. CPC: January 2025 – March 2026. Month on month.')], [''],
      [B('Where the figures come from')],
      [W("Each brand's Orders workbook (every Amazon.com order line) — the same source as Sellora's Live vs Last Year → By product tab and the Sales Dashboard.")],
      [W('Left out, as everywhere in Sellora: cancelled orders, MCF (multi-channel) shipments, and other marketplaces (other currencies).')],
      [W('Sales = what buyers were charged for the items (no shipping or tax), in US dollars. Months are calendar months on the order date (Pacific).')],
      [W('Orders: on the monthly and ASIN sheets an order is counted once, even when it holds two SKUs (or two sizes of one ASIN). On the SKU sheets each SKU counts the orders it was in, so they add up to a little more than the monthly total.')],
      [''], [B('Ad spend, ad sales and organic sales')],
      [W("Amazon's Ads API only gives about the last 95 days, so per-ASIN ad figures for these months cannot be fetched by any tool. They appear here for the months where an Ads console 'Advertised product' report was uploaded in Sellora (Live vs Last Year → By product).")],
      [''], [B('Sheets')],
      [W('Ridhi monthly / CPC monthly — one row per month. By ASIN / By SKU — one row per product, each month\'s sales, units and orders, totals and share of sales, sorted by sales. All rows — one row per brand, month and SKU, for pivot tables.')],
      [''], [W('Downloaded ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC from live.html · report built ' + String(M.at || '').slice(0, 16).replace('T', ' ') + ' UTC.')]];
    return pack([{ name: 'Read me', rows: notes, opt: { widths: [140] } }].concat(sheets, [{ name: 'All rows', rows: flat, opt: { widths: [8, 11, 14, 26, 12, 9, 15], freeze: [0, 1] } }]));
  }
  window.MonthlyReport = { render, workbook };
})();
