/* ================= PRODUCTION FLOW · RFD CHALLAN — the fabric of one order, to one vendor =================
 * Ravi, 10 Oct: "i need a challan here order wise and kis vendor ko de rahe h, yahin se challan generate kare".
 * From Demand · RFD fabric: pick the PO's lines, the vendor, the metres → a numbered delivery challan to print, and
 * those lines' fabric is marked given (it IS ready: it left the store on this paper), so they move on by themselves.
 *   pt_flowChallans/<no> = { no, date, orderNo, vendor:{code, name}, lines:[{key, sku, item, fabric, pcs, metres}], note, at, by }
 *   pt_flowDemand/<line>/fabricReady gets { …, challan: no, vendor: name }
 * The challan's metres stay KEPT out of the RFD stock shown here until the printed cloth is back (or cut / issued) —
 * the Fabric register itself is not written from this test view. */

const flowChItem = r => [r.articleSubtype || r.articleType, r.color, r.size].filter(Boolean).join(' · ');
/** The next number for a month: RFD-YYYYMM-001, after every challan already saved that month. */
function flowChallanNo(date, test) {
  /* A test order's challans count on their own (TRFD-…), so testing never uses up a real number. */
  const pre = (test ? 'TRFD-' : 'RFD-') + String(date || dToday()).slice(0, 7).replace('-', '') + '-';
  const used = Object.keys(FLOW.ch || {}).filter(k => k.startsWith(pre)).map(k => +k.slice(-3) || 0);
  return pre + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}
const flowChVendors = () => {
  let all = []; try { all = voAllVendors(); } catch (e) { all = []; }
  const pr = all.filter(v => String(v.category || '').trim().toLowerCase() === 'printer');
  return pr.concat(all.filter(v => !pr.includes(v)));
};

/** The challan for one PO: its lines still waiting for fabric. */
function flowChallanOpen(orderNo) {
  const cv = flowRfdCover();
  const rows = flowRows().filter(x => x.r.orderNo === orderNo && flowInView('drfd', x.s));
  if (!rows.length) return;
  const vens = flowChVendors();
  const lineHtml = rows.map((x, i) => { const p = x.s.plan || {}, c = cv.line[x.s.key] || {};
    return `<tr><td><input type="checkbox" data-chk="${i}" checked style="width:auto"></td>
      <td style="text-align:left"><b style="font-family:ui-monospace,monospace">${esc(obUC(x.r.sku))}</b><div class="muted" style="font-size:10.5px">${esc(flowChItem(x.r))}</div></td>
      <td style="text-align:left">${esc((p.fabric && p.fabric.name) || '—')}</td>
      <td class="num">${nf(x.r.qty)}</td>
      <td class="num"><input data-chm="${i}" type="number" step="0.01" value="${esc((p.fabric && p.fabric.metres) || '')}" style="width:90px;padding:3px 6px;font-size:12px"></td>
      <td style="font-size:11px">${c.short ? `<b style="color:#b91c1c">⚑ short ${nf(c.short)} m</b>` : '<span style="color:#166534">covered</span>'}</td></tr>`; }).join('');
  ptOpenDialog({
    title: `RFD challan — ${orderNo}`,
    subtitle: 'The fabric of this order, to one vendor. Saving numbers the challan, opens it to print, and marks these lines\' fabric as given — they leave Demand by themselves.',
    html: `<div class="ptgrid" style="grid-template-columns:2fr 1fr">
        <label>Vendor<select id="flcVen"><option value="">— pick the vendor —</option>${vens.map(v => `<option value="${esc(v.code)}">${esc((v.desc || v.name || v.code) + (v.category ? ' · ' + v.category : ''))}</option>`).join('')}</select></label>
        <label>Date<input id="flcDate" type="date" value="${esc(dToday())}"></label></div>
      <table class="xl" style="margin-top:10px;width:100%"><thead><tr><th></th><th style="text-align:left">SKU</th><th style="text-align:left">Fabric</th><th>Pcs</th><th>Metres</th><th>RFD</th></tr></thead><tbody>${lineHtml}</tbody></table>
      <label style="display:block;margin-top:8px">Note (vehicle, who carried it…)<input id="flcNote"></label>`,
    saveLabel: 'Make the challan',
    onSave: async () => {
      const code = $('flcVen').value, v = vens.find(x => String(x.code) === String(code));
      if (!v) return 'Which vendor is the fabric going to? Pick one.';
      const date = $('flcDate').value || dToday();
      const picked = rows.map((x, i) => ({ x, on: (document.querySelector(`[data-chk="${i}"]`) || {}).checked, m: +((document.querySelector(`[data-chm="${i}"]`) || {}).value || 0) }))
        .filter(y => y.on);
      if (!picked.length) return 'Tick at least one line.';
      const noM = picked.filter(y => !(y.m > 0)).map(y => obUC(y.x.r.sku));
      if (noM.length) return `How many metres? Type them for ${noM.join(', ')}.`;
      const no = flowChallanNo(date, flowIsTest(orderNo)), now = new Date().toISOString(), vname = v.desc || v.name || v.code;
      const ch = { no, date, orderNo, vendor: { code: v.code, name: vname }, note: $('flcNote').value.trim(), at: now, by: ME.email || '',
        lines: picked.map(({ x, m }) => ({ key: x.s.key, sku: obUC(x.r.sku), item: flowChItem(x.r), fabric: (x.s.plan && x.s.plan.fabric && x.s.plan.fabric.name) || '', pcs: +x.r.qty || 0, metres: flowR2(m) })) };
      const patch = { ['pt_flowChallans/' + no]: ch };
      ch.lines.forEach(l => { patch[`pt_flowDemand/${l.key}/fabricReady`] = { at: now, by: ME.email || '', what: l.fabric, metres: l.metres, note: `Challan ${no} to ${vname}`, challan: no, vendor: vname }; });
      try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
      FLOW.ch = Object.assign({}, FLOW.ch, { [no]: ch });
      const dem = Object.assign({}, FLOW.dem);
      ch.lines.forEach(l => { dem[l.key] = Object.assign({}, dem[l.key] || {}, { fabricReady: patch[`pt_flowDemand/${l.key}/fabricReady`] }); });
      FLOW.dem = dem;
      renderFlow();
      const err = flowChallanPrint(no);
      if (err) { $('flMsg').className = 'err'; $('flMsg').textContent = `Challan ${no} saved. ${err}`; }
      return '';
    },
  });
}

function flowChallanHtml(ch) {
  let s = {}; try { s = (GPO && GPO.settings) || {}; } catch (e) { s = {}; }
  const e = v => esc(v == null ? '' : String(v));
  const cell = 'border:1px solid #999;padding:6px 8px;font-size:11px';
  const tm = flowR2((ch.lines || []).reduce((a, l) => a + (+l.metres || 0), 0)), tp = (ch.lines || []).reduce((a, l) => a + (+l.pcs || 0), 0);
  const dmy = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : d; };
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(ch.no) + '</title></head>'
    + '<body style="font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px">'
    + `<table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:top">`
    + `<div style="font-size:18px;font-weight:bold">${e(s.company || 'The Fabric Rush')}</div>`
    + `<div style="font-size:11px;white-space:pre-line">${e(s.address)}</div>`
    + (s.gstin ? `<div style="font-size:11px">GSTIN: ${e(s.gstin)}</div>` : '')
    + `</td><td style="vertical-align:top;text-align:right"><div style="font-size:20px;font-weight:bold">DELIVERY CHALLAN</div>`
    + `<div style="font-size:11px">RFD fabric for job work — not for sale</div>`
    + `<div style="font-size:12px;margin-top:4px">Challan No: <b>${e(ch.no)}</b></div><div style="font-size:12px">Date: ${e(dmy(ch.date))}</div>`
    + `<div style="font-size:12px">Order: <b>${e(ch.orderNo)}</b></div></td></tr></table>`
    + `<div style="margin:16px 0 8px;font-size:12px"><b>To</b><br>${e(ch.vendor && ch.vendor.name)}${ch.vendor && ch.vendor.code ? ` <span style="color:#666">(${e(ch.vendor.code)})</span>` : ''}</div>`
    + `<table style="width:100%;border-collapse:collapse"><tr style="background:#f0f0f0">`
    + ['#', 'SKU', 'Item', 'Fabric (RFD)', 'Pieces to make', 'Metres'].map(h => `<th style="${cell};text-align:left">${h}</th>`).join('') + '</tr>'
    + (ch.lines || []).map((l, i) => `<tr><td style="${cell};text-align:center">${i + 1}</td><td style="${cell}">${e(l.sku)}</td><td style="${cell}">${e(l.item)}</td>`
      + `<td style="${cell}">${e(l.fabric)}</td><td style="${cell};text-align:right">${e(nf(l.pcs))}</td><td style="${cell};text-align:right">${e(nf(l.metres))}</td></tr>`).join('')
    + `<tr><td style="${cell}" colspan="4"><b>Total</b></td><td style="${cell};text-align:right"><b>${e(nf(tp))}</b></td><td style="${cell};text-align:right"><b>${e(nf(tm))}</b></td></tr></table>`
    + (ch.note ? `<div style="margin-top:10px;font-size:11px"><b>Note:</b> ${e(ch.note)}</div>` : '')
    + `<table style="width:100%;margin-top:50px;font-size:11px"><tr><td>Issued by<br><br><br>${e(String(ch.by || '').split('@')[0])}</td>`
    + `<td style="text-align:right">Received by (${e(ch.vendor && ch.vendor.name)})<br><br><br>Signature &amp; date</td></tr></table>`
    + '</body></html>';
}
function flowChallanPrint(no) {
  const ch = (FLOW.ch || {})[no]; if (!ch) return 'That challan is not here — press Refresh.';
  const w = window.open('', '_blank');
  if (!w || !w.document) return 'The browser blocked the new window. Allow pop-ups for this site and press Print again.';
  w.document.open();
  w.document.write(flowChallanHtml(ch).replace('</body>',
    '<div style="margin-top:24px;text-align:center" class="noprint"><button onclick="window.print()" style="padding:8px 20px">Print / Save as PDF</button></div>'
    + '<style>@media print{.noprint{display:none}}</style></body>'));
  w.document.close();
  return '';
}
/** The challans for the lines on screen, newest first — to print again. */
function flowChallanList(orderNos) {
  const want = new Set(orderNos);
  const list = Object.values(FLOW.ch || {}).filter(c => !orderNos || want.has(c.orderNo)).sort((a, b) => String(b.no).localeCompare(String(a.no)));
  if (!list.length) return '';
  return `<div style="font-weight:600;margin:12px 0 6px">Challans made</div><table class="xl" style="width:auto"><thead><tr><th style="text-align:left">Challan</th><th>Date</th><th style="text-align:left">Order</th><th style="text-align:left">Vendor</th><th>Lines</th><th>Metres</th><th></th></tr></thead><tbody>`
    + list.slice(0, 50).map(c => `<tr><td style="text-align:left"><b>${esc(c.no)}</b></td><td>${esc(String(c.date || '').slice(5))}</td><td style="text-align:left">${esc(c.orderNo)}</td><td style="text-align:left">${esc(c.vendor && c.vendor.name)}</td>
      <td class="num">${nf((c.lines || []).length)}</td><td class="num">${nf(flowR2((c.lines || []).reduce((a, l) => a + (+l.metres || 0), 0)))}</td>
      <td><button class="ghost" data-flchp="${esc(c.no)}" style="width:auto;padding:2px 9px;font-size:11.5px">Print</button></td></tr>`).join('') + '</tbody></table>';
}
