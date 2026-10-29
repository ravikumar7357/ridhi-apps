/* ================= PRODUCTION FLOW · EMBROIDERY — printed cloth out in metres, embroidered pieces back =================
 * Ravi, 21 Oct: "ppc plan me 1 section embroidery ka bhi add krna padega meaning jis article me embroidery work hota h wo
 * running fabric direct embroidery department me jata h … pahle fabric print then embroidery then cut and then Q.C".
 * His answers: who embroiders is picked per line (our own department, or an embroidery vendor); metres go, pieces come
 * back; after the cut the pieces go straight to QC (no karigar); every SKU whose subtype says Embroidery starts on it.
 *
 *   PPC        route 'emb' (flow-core.js FLOW_ROUTES), plan.emb = { code, name } — FLOW_EMB_DEPT or a vendor.
 *   Printing   as Printing: print order, RFD challan, printed cloth back on it (always as running cloth — flowPrintWhat).
 *   Embroidery Demand → Embroidery (bucket 'demb', the fabric team's right flchl): the printed cloth back for a line goes out
 *              on an embroidery challan, and the embroidered pieces are received against it.
 *                pt_flowChallans/EMB-YYYYMM-NNN = { no, kind: 'emb', date, orderNo, vendor:{code, name},
 *                  lines:[{ key, sku, item, fabric, print, metres, pcs }], receipts:{ <id>: { at, date, by, items:{ <key>: pcs } } },
 *                  closed, cancelled, note, at, by }
 *              Kept in the RFD challans' node (the fabric team writes it and the flow's rights read it — no new rule), and
 *              split off as it is read (flowEmbSplit), so no RFD list, total or index ever sees one.
 *   Cutting    "To cut" lists the pieces back from embroidery; the cutting entry is marked qcDirect.
 *   QC         Quality Control → Waiting for QC lists those cut pieces (quality-control.js); a rejected piece is embroidered
 *              again — it comes off the embroidered count (flowState). */

/** Per line: metres sent to embroidery, pieces back, who has it, the challans. */
let FLOW_EMBX = { src: null, map: {} };
function flowEmbIndex() {
  if (FLOW_EMBX.src === FLOW.emb && FLOW_EMBX.src) return FLOW_EMBX.map;
  const map = {};
  Object.values(FLOW.emb || {}).forEach(c => {
    if (!c || c.cancelled) return;
    const back = flowEmbRecv(c);
    (c.lines || []).forEach(l => {
      const e = map[l.key] || (map[l.key] = { sent: 0, back: 0, nos: [], to: '' });
      e.sent = flowR2(e.sent + (+l.metres || 0)); e.back += back[l.key] || 0; e.nos.push(c.no); e.to = (c.vendor && c.vendor.name) || e.to;
    });
  });
  FLOW_EMBX = { src: FLOW.emb, map };
  return map;
}
/** Pieces received on one embroidery challan, per line key. */
function flowEmbRecv(c) {
  const out = {};
  Object.values((c && c.receipts) || {}).forEach(rc => Object.entries((rc && rc.items) || {}).forEach(([k, q]) => { out[k] = (out[k] || 0) + (+q || 0); }));
  return out;
}
/** Who can embroider: our own department first, then the vendors whose category says Embroidery (every vendor when none does). */
function flowEmbVendors() {
  let all = []; try { all = voAllVendors(); } catch (e) { all = []; }
  const emb = all.filter(v => /embroid/i.test(String(v.category || '')));
  return [Object.assign({ dept: true }, FLOW_EMB_DEPT)].concat(emb.length ? emb : all);
}
/** { code, name } for a code — our own department when it is blank or not found. */
function flowEmbWho(code) {
  const c = String(code == null ? '' : code).trim();
  const v = c ? flowEmbVendors().find(x => String(x.code) === c) : null;
  return v ? { code: String(v.code), name: v.dept ? FLOW_EMB_DEPT.name : (v.desc || v.name || v.code) } : Object.assign({}, FLOW_EMB_DEPT);
}
const flowEmbOpts = cur => flowEmbVendors().map(v => `<option value="${esc(v.code)}"${String(v.code) === String(cur || FLOW_EMB_DEPT.code) ? ' selected' : ''}>${esc(v.dept ? v.name : (v.desc || v.name || v.code) + (v.category ? ' · ' + v.category : ''))}</option>`).join('');
/** The next number for a month: EMB-YYYYMM-001 (a test order's: TEMB-…), after every embroidery challan that month. */
function flowEmbNo(date, test, taken) {
  const pre = (test ? 'TEMB-' : 'EMB-') + String(date || dToday()).slice(0, 7).replace('-', '') + '-';
  const used = Object.keys(FLOW.emb || {}).concat(taken || []).filter(k => k.startsWith(pre)).map(k => +k.slice(-3) || 0);
  return pre + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}

/* ---- Demand → Embroidery, one row a line ---- */
/** The cells after PO · SKU · Qty: the printed cloth back, what embroidery has, and the buttons. */
function flowEmbCells(x, first) {
  const s = x.s, q = +x.r.qty || 0, p = s.plan || {}, who = (p.emb && p.emb.name) || FLOW_EMB_DEPT.name;
  const td = 'text-align:left;font-size:13px;line-height:1.55;white-space:normal;vertical-align:top';
  const w = (() => { try { return flowPrintWhat(x.r, p); } catch (e) { return null; } })();
  const open = (s.embNos || []).filter(no => { const c = (FLOW.emb || {})[no]; return c && !c.closed && !c.cancelled; });
  return `<td style="${td};min-width:190px"><div><b>${nf(s.fabHave || 0)} m</b> back of ${nf(s.fabTotal || 0)} m</div>`
      + (w && w.code ? `<div class="muted" style="font-size:12px">${esc(w.code)}</div>` : '')
      + (s.bucket === 'fabric' ? '<div style="font-size:11.5px;color:#b45309">the rest still with the printer</div>' : '') + '</td>'
    + `<td style="${td};min-width:230px"><div>To: <b>${esc(s.embTo || who)}</b></div>`
      + `<div>Sent: <b>${nf(s.embSent || 0)} m</b>${s.embCanSend > 0 ? ` <span class="muted">· ${nf(s.embCanSend)} m to send</span>` : ''}</div>`
      + `<div>Back: <b>${nf(s.embBack || 0)} / ${nf(q)} pcs</b>${s.qcRej ? ` <span style="color:#b91c1c">· ${nf(s.qcRej)} rejected at QC — embroider again</span>` : ''}</div>`
      + open.map(no => `<div style="font-size:12px;margin-top:2px"><a href="#" data-flembp="${esc(no)}">${esc(no)}</a> · <a href="#" data-flembrx="${esc(no)}">Receive pieces</a>`
        + (flowMay('flchl') && !Object.keys(((FLOW.emb || {})[no] || {}).receipts || {}).length ? ` · <a href="#" data-flembx="${esc(no)}" style="color:#b91c1c">Cancel</a>` : '') + '</div>').join('') + '</td>'
    + `<td style="white-space:nowrap;vertical-align:top">${first && flowMay('flchl') ? `<button data-flembs="${esc(x.r.orderNo)}" style="width:auto;padding:3px 10px;font-size:12px">Send to embroidery</button>` : ''}`
      + (s.canCut > 0 ? `<div class="muted" style="font-size:11px;margin-top:4px">${nf(s.canCut)} pcs ready to cut</div>` : '') + '</td>';
}

/* ---- sending: one PO, one embroiderer ---- */
function flowEmbSendOpen(orderNo) {
  if (!flowMay('flchl')) return flowSay('Embroidery is the fabric team\'s — this account has no "Printed fabric in" right.', true);
  const rows = flowRows().filter(x => obUC(x.r.orderNo) === obUC(orderNo) && flowInView('demb', x.s) && x.s.embCanSend > 0);
  if (!rows.length) return flowSay(`Nothing of ${orderNo} is waiting to go to embroidery — its printed cloth is not back, or it went already.`, true);
  const vens = flowEmbVendors(), planned = (rows.map(x => x.s.plan && x.s.plan.emb && x.s.plan.emb.code).find(Boolean)) || FLOW_EMB_DEPT.code;
  const isTest = rows.every(x => !!x.r.__t);
  const lineHtml = rows.map((x, i) => { const w = (() => { try { return flowPrintWhat(x.r, x.s.plan); } catch (e) { return null; } })();
    return `<tr><td><input type="checkbox" data-emk="${i}" checked style="width:auto"></td>
      <td style="text-align:left;white-space:normal"><b style="font-family:ui-monospace,monospace">${esc(obUC(x.r.sku))}</b><div class="muted" style="font-size:11px">${esc(flowChItem(x.r))}</div>${w && w.code ? `<div style="font-size:11px;color:#4338ca">${esc(w.code)}</div>` : ''}</td>
      <td class="num"><input data-emm="${i}" type="number" step="0.01" min="0" value="${esc(x.s.embCanSend)}" style="width:80px;padding:3px 6px;font-size:12px"></td>
      <td class="num"><input data-emp="${i}" type="number" step="1" min="0" value="${esc(Math.max(0, (+x.r.qty || 0) - (x.s.embBack || 0)))}" style="width:70px;padding:3px 6px;font-size:12px"></td></tr>`; }).join('');
  ptOpenDialog({
    title: `Embroidery challan — ${orderNo}`,
    subtitle: 'The printed cloth of this order, to the embroiderer. Saving numbers the challan and opens it to print; the pieces are received against it.',
    html: `<div class="ptgrid" style="grid-template-columns:2fr 1fr">
        <label>Embroidery by<select id="flemVen">${flowEmbOpts(planned)}</select></label>
        <label>Date<input id="flemDate" type="date" value="${esc(dToday())}"></label></div>
      <table class="xl" style="margin-top:10px;width:100%"><thead><tr><th></th><th style="text-align:left">Item</th><th>Metres</th><th>Pieces to make</th></tr></thead><tbody>${lineHtml}</tbody></table>
      <label style="display:block;margin-top:8px">Note (who carried it…)<input id="flemNote"></label>`,
    saveLabel: 'Make the challan',
    onSave: async () => {
      const who = flowEmbWho($('flemVen').value), date = $('flemDate').value || dToday();
      const picked = rows.map((x, i) => ({ x, on: !!(document.querySelector(`[data-emk="${i}"]`) || {}).checked,
        m: flowR2(+((document.querySelector(`[data-emm="${i}"]`) || {}).value || 0)), pc: Math.round(+((document.querySelector(`[data-emp="${i}"]`) || {}).value || 0)) })).filter(y => y.on);
      if (!picked.length) return 'Tick at least one line.';
      const noM = picked.filter(y => !(y.m > 0)).map(y => obUC(y.x.r.sku));
      if (noM.length) return `How many metres? Type them for ${noM.join(', ')}.`;
      const over = picked.filter(y => y.m > y.x.s.embCanSend + 0.01);
      if (over.length) return over.map(y => `${obUC(y.x.r.sku)}: only ${nf(y.x.s.embCanSend)} m of its printed cloth is back and not sent`).join(' · ');
      const now = new Date().toISOString();
      let no = flowEmbNo(date, isTest);
      const ch = { no, kind: 'emb', date, orderNo: obUC(orderNo), vendor: who, note: $('flemNote').value.trim(), at: now, by: ME.email || '',
        lines: picked.map(({ x, m, pc }) => { let w = null; try { w = flowPrintWhat(x.r, x.s.plan); } catch (e) { w = null; }
          return { key: x.s.key, sku: obUC(x.r.sku), item: flowChItem(x.r), fabric: (x.s.plan && x.s.plan.fabric && x.s.plan.fabric.name) || '', print: w ? (w.code || '') : '', metres: m, pcs: pc }; }) };
      /* the number is claimed: two people sending at the same moment get two numbers, never one challan over the other */
      for (let k = 0, taken = []; ; k++) {
        let er = ''; try { er = await flowClaim('pt_flowChallans/' + no, ch); } catch (e) { return 'Could not save: ' + (e.message || e); }
        if (!er) break;
        if (k >= 15) return 'Could not get a free challan number — press Refresh and try again.';
        taken.push(no); no = flowEmbNo(date, isTest, taken); ch.no = no;
      }
      if (typeof ptCas !== 'function') { try { await ptPatch({ ['pt_flowChallans/' + no]: ch }); } catch (e) { return 'Could not save: ' + (e.message || e); } }
      FLOW.emb = Object.assign({}, FLOW.emb, { [no]: ch });
      renderFlow();
      const er = flowEmbPrint(no); if (er) flowSay(`Challan ${no} saved. ${er}`, true);
      return '';
    },
  });
}

/* ---- receiving: the embroidered pieces, against the challan ---- */
function flowEmbRecvOpen(no) {
  if (!flowMay('flchl')) return flowSay('Embroidery is the fabric team\'s — this account has no "Printed fabric in" right.', true);
  const c = (FLOW.emb || {})[no]; if (!c || c.cancelled) return flowSay('That embroidery challan is not here — press Refresh.', true);
  const got = flowEmbRecv(c), lines = (c.lines || []);
  const left = l => Math.max(0, (+l.pcs || 0) - (got[l.key] || 0));
  ptOpenDialog({
    title: `Receive embroidered pieces — ${no}`,
    subtitle: `${c.vendor && c.vendor.name ? c.vendor.name + ' · ' : ''}${c.orderNo}. Type the pieces that came back today; the rest stays open on the challan.`,
    html: `<label style="display:block;max-width:220px">Date<input id="flerDate" type="date" value="${esc(dToday())}"></label>
      <table class="xl" style="margin-top:10px;width:100%"><thead><tr><th style="text-align:left">Item</th><th>Metres sent</th><th>Pieces</th><th>Back already</th><th>Back today</th></tr></thead><tbody>${lines.map((l, i) =>
        `<tr><td style="text-align:left"><b style="font-family:ui-monospace,monospace">${esc(l.sku)}</b><div class="muted" style="font-size:11px">${esc(l.item || '')}</div></td>
          <td class="num">${nf(l.metres)}</td><td class="num">${nf(l.pcs)}</td><td class="num">${nf(got[l.key] || 0)}</td>
          <td class="num"><input data-emr="${i}" type="number" min="0" step="1" value="0" title="still to come: ${nf(left(l))} pcs" onfocus="this.select()" style="width:72px;padding:3px 6px;font-size:12px"></td></tr>`).join('')}</tbody></table>
      <label style="display:flex;gap:6px;align-items:center;margin-top:8px"><input id="flerClose" type="checkbox" style="width:auto"> Nothing more is coming on this challan — close it</label>`,
    saveLabel: 'Receive',
    onSave: async () => {
      const items = {};
      lines.forEach((l, i) => { const n = Math.round(+((document.querySelector(`[data-emr="${i}"]`) || {}).value || 0)); if (n > 0) items[l.key] = (items[l.key] || 0) + n; });
      const closeIt = !!($('flerClose') && $('flerClose').checked);
      if (!Object.keys(items).length && !closeIt) return 'Type the pieces that came back.';
      const date = $('flerDate').value || dToday(), now = new Date().toISOString(), patch = {};
      if (Object.keys(items).length) {
        const rid = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        patch[`pt_flowChallans/${no}/receipts/${rid}`] = { at: now, date, by: ME.email || '', items };
      }
      const after = Object.assign({}, got); Object.entries(items).forEach(([k, n]) => { after[k] = (after[k] || 0) + n; });
      const full = lines.every(l => (after[l.key] || 0) >= (+l.pcs || 0));
      if (full || closeIt) patch[`pt_flowChallans/${no}/closed`] = { at: now, by: ME.email || '', short: !full };
      try { await ptPatch(patch); } catch (e) { return 'Could not save: ' + (e.message || e); }
      const nc = Object.assign({}, c, { receipts: Object.assign({}, c.receipts) });
      Object.entries(patch).forEach(([k, v]) => { const part = k.split('/'); if (part[2] === 'receipts') nc.receipts[part[3]] = v; else if (part[2] === 'closed') nc.closed = v; });
      FLOW.emb = Object.assign({}, FLOW.emb, { [no]: nc });
      renderFlow();
      flowSay(`${no}: ${nf(Object.values(items).reduce((a, n) => a + n, 0))} pcs received${nc.closed ? ' · challan closed' : ''} — they are in Cutting → To cut.`);
      return '';
    },
  });
}
/** A challan sent by mistake: cancelled (its number kept) while nothing has come back on it. */
async function flowEmbCancel(no) {
  if (!flowMay('flchl')) return flowSay('Embroidery is the fabric team\'s — this account has no "Printed fabric in" right.', true);
  const c = (FLOW.emb || {})[no]; if (!c || c.cancelled) return;
  if (Object.keys(c.receipts || {}).length) return flowSay(`${no} has pieces received on it — it cannot be cancelled.`, true);
  if (!confirm(`Cancel embroidery challan ${no}? The cloth on it counts as not sent again.`)) return;
  const v = { at: new Date().toISOString(), by: ME.email || '' };
  try { await ptPatch({ [`pt_flowChallans/${no}/cancelled`]: v }); } catch (e) { return flowSay('Could not cancel: ' + (e.message || e), true); }
  FLOW.emb = Object.assign({}, FLOW.emb, { [no]: Object.assign({}, c, { cancelled: v }) });
  renderFlow();
}

/* ---- the paper ---- */
function flowEmbHtml(c) {
  let st = {}; try { st = (GPO && GPO.settings) || {}; } catch (e) { st = {}; }
  const e = v => esc(v == null ? '' : String(v)), cell = 'border:1px solid #999;padding:6px 8px;font-size:12px';
  const dmy = d => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : d; };
  const lines = c.lines || [], tm = lines.reduce((a, l) => a + (+l.metres || 0), 0), tp = lines.reduce((a, l) => a + (+l.pcs || 0), 0);
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(c.no) + '</title></head><body style="font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px">'
    + `<table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:top"><div style="font-size:18px;font-weight:bold">${e(st.company || FLOW_COMPANY)}</div>`
    + `<div style="font-size:11px;white-space:pre-line">${e(st.address)}</div>${st.gstin ? `<div style="font-size:11px">GSTIN: ${e(st.gstin)}</div>` : ''}</td>`
    + `<td style="vertical-align:top;text-align:right"><div style="font-size:20px;font-weight:bold">EMBROIDERY CHALLAN</div><div style="font-size:11px">Printed fabric for embroidery job work — not for sale</div>`
    + `<div style="font-size:12px;margin-top:4px">Challan No: <b>${e(c.no)}</b></div><div style="font-size:12px">Order: <b>${e(c.orderNo)}</b></div></td></tr></table>`
    + `<table style="width:100%;border-collapse:collapse;margin:16px 0 10px"><tr><td style="border:2px solid #111;padding:8px 12px;width:70%"><div style="font-size:11px;color:#555">Embroidery by (To)</div>`
    + `<div style="font-size:17px;font-weight:bold">${e(c.vendor && c.vendor.name)}</div></td><td style="border:2px solid #111;border-left:0;padding:8px 12px"><div style="font-size:11px;color:#555">Date</div><div style="font-size:17px;font-weight:bold">${e(dmy(c.date))}</div></td></tr></table>`
    + `<table style="width:100%;border-collapse:collapse"><thead><tr>${['#', 'SKU', 'Item', 'Printed fabric', 'Metres', 'Pieces to make'].map(h => `<th style="${cell};background:#eee;text-align:left">${h}</th>`).join('')}</tr></thead><tbody>`
    + lines.map((l, i) => `<tr><td style="${cell}">${i + 1}</td><td style="${cell}"><b>${e(l.sku)}</b></td><td style="${cell}">${e(l.item)}</td><td style="${cell}">${e(l.print || l.fabric)}</td>`
      + `<td style="${cell};text-align:right">${e(nf(l.metres))}</td><td style="${cell};text-align:right">${e(nf(l.pcs))}</td></tr>`).join('')
    + `<tr><td style="${cell}" colspan="4"><b>Total</b></td><td style="${cell};text-align:right"><b>${e(nf(flowR2(tm)))} m</b></td><td style="${cell};text-align:right"><b>${e(nf(tp))} pcs</b></td></tr></tbody></table>`
    + (c.note ? `<div style="margin-top:10px;font-size:11px"><b>Note:</b> ${e(c.note)}</div>` : '')
    + `<table style="width:100%;margin-top:50px;font-size:11px"><tr><td>Issued by<br><br><br>${e(String(c.by || '').split('@')[0])}</td>`
    + `<td style="text-align:right">Received by (${e(c.vendor && c.vendor.name)})<br><br><br>Signature &amp; date</td></tr></table></body></html>`;
}
function flowEmbPrint(no) {
  const c = (FLOW.emb || {})[no]; if (!c) return 'That challan is not here — press Refresh.';
  const w = window.open('', '_blank');
  if (!w || !w.document) return 'The browser blocked the new window. Allow pop-ups for this site and press the challan number again.';
  w.document.open();
  w.document.write(flowEmbHtml(c).replace('</body>', '<div style="margin-top:24px;text-align:center" class="noprint"><button onclick="window.print()" style="padding:8px 20px">Print / Save as PDF</button></div>'
    + '<style>@media print{.noprint{display:none}}</style></body>'));
  w.document.close();
  return '';
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  const t = e.target; if (!t || !t.closest) return;
  const s = t.closest('[data-flembs]'), rx = t.closest('[data-flembrx]'), pr = t.closest('[data-flembp]'), cx = t.closest('[data-flembx]');
  if (!s && !rx && !pr && !cx) return;
  e.preventDefault();
  if (s) return flowEmbSendOpen(s.dataset.flembs);
  if (rx) return flowEmbRecvOpen(rx.dataset.flembrx);
  if (cx) return flowEmbCancel(cx.dataset.flembx);
  const er = flowEmbPrint(pr.dataset.flembp); if (er) flowSay(er, true);
});
