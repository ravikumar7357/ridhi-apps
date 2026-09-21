
/* ================= GREIGE PURCHASE ORDERS =================
 *
 * Ravi, 2026-09-21: "greige fabric po generation meaning uska challan bane and m mail kar saku yahi se".
 *
 * A PO is raised against a mill for greige, printed or e-mailed from here, and received against: a
 * "Greige received" entry that names the PO number is what counts as delivered, so ordered, received
 * and still to come are always worked out from the ledger, never typed twice.
 *
 * THE CLOTH IS ORDERED BY ITS GREIGE NAME. Greige comes wider than the RFD it becomes — the Sheeting 62
 * on the cutting table is bought as a wider greige — so each RFD fabric carries the name its greige is
 * bought under (Masters → Fabric type → Greige name). The PO is written in that name; the lot keeps it
 * while it is greige and with the processor; "RFD received" turns it back into the RFD fabric.
 */

let GPO = { rows: null, settings: null, err: '', busy: false, at: '' };

/** The greige name an RFD fabric is bought under, from Masters → Fabric type. */
function fabGreigeOf(rfdFabric) {
  const k = String(rfdFabric || '').trim().toLowerCase();
  if (!k) return '';
  const r = mstRows('fabricType').find(x => [x.desc, x.code].some(v => String(v || '').trim().toLowerCase() === k));
  return r && r.greige ? String(r.greige).trim() : '';
}
/** And back: which RFD fabric a greige name becomes once it is processed. '' when nobody has said. */
function fabRfdOfGreige(greige) {
  const k = String(greige || '').trim().toLowerCase();
  if (!k) return '';
  const r = mstRows('fabricType').find(x => x.active !== false && String(x.greige || '').trim().toLowerCase() === k);
  return r ? String(r.desc || r.code || '').trim() : '';
}
/** The RFD fabrics a PO can be raised for: every active fabric type with a greige name on it. */
const gpoFabrics = () => mstRows('fabricType').filter(r => r.active !== false && String(r.greige || '').trim())
  .map(r => ({ rfd: String(r.desc || r.code).trim(), greige: String(r.greige).trim() }))
  .sort((a, b) => a.rfd.localeCompare(b.rfd));

/** The mills: vendors marked Mill, or — until anybody is — every vendor, so the list is never empty. */
function gpoMills() {
  const all = voAllVendors();
  const mills = all.filter(v => /mill/i.test(String(v.category || '')));
  return mills.length ? mills : all;
}

async function ensureGpo(force) {
  if (GPO.rows === null || force) {
    GPO.busy = true;
    try {
      const [rows, settings] = await Promise.all([ptGet('pt_greigePOs'), ptGet('pt_poSettings')]);
      GPO.rows = ptList(rows).filter(r => r && r.id);
      GPO.settings = settings || {};
      GPO.err = '';
    } catch (e) { GPO.err = e.message || String(e); GPO.rows = GPO.rows || []; GPO.settings = GPO.settings || {}; }
    GPO.busy = false; GPO.at = ptStamp();
  }
}

/** GPO-260921-01: the day, and one more than the day already has. */
function gpoNewNo(day) {
  const d = String(day || attToday()).replace(/-/g, '').slice(2);
  const taken = new Set((GPO.rows || []).map(r => String(r.poNo || '').toUpperCase()));
  for (let i = 1; i < 100; i++) {
    const no = 'GPO-' + d + '-' + String(i).padStart(2, '0');
    if (!taken.has(no)) return no;
  }
  return 'GPO-' + d + '-' + Date.now().toString(36).slice(-3).toUpperCase();
}

const gpoR2 = n => Math.round((parseFloat(n) || 0) * 100) / 100;

/** Money on one line and on the whole PO. GST is per line, because two cloths can carry two rates. */
function gpoLineMoney(l) {
  const amount = gpoR2((parseFloat(l.metres) || 0) * (parseFloat(l.rate) || 0));
  const gst = gpoR2(amount * (parseFloat(l.gstPct) || 0) / 100);
  return { amount, gst, total: gpoR2(amount + gst) };
}
function gpoTotals(po) {
  return ((po && po.lines) || []).reduce((t, l) => {
    const m = gpoLineMoney(l);
    t.metres += parseFloat(l.metres) || 0; t.amount += m.amount; t.gst += m.gst; t.total += m.total;
    return t;
  }, { metres: 0, amount: 0, gst: 0, total: 0 });
}

/** What has come in against a PO, per greige name, out of the ledger. */
function gpoReceived(po) {
  const no = String((po && po.poNo) || '').trim().toUpperCase();
  const by = {};
  if (!no) return by;
  (FAB.rows || []).forEach(r => {
    if (r.txnType !== 'RECEIVE_GREIGE' || String(r.orderNo || '').trim().toUpperCase() !== no) return;
    const k = String(r.fabricType || '').trim().toLowerCase();
    by[k] = (by[k] || 0) + fabQty(r);
  });
  return by;
}
/** Ordered, received and still to come, line by line and in total. */
function gpoProgress(po) {
  const got = gpoReceived(po);
  const lines = ((po && po.lines) || []).map(l => {
    const rec = got[String(l.greige || '').trim().toLowerCase()] || 0;
    const ordered = parseFloat(l.metres) || 0;
    return Object.assign({}, l, { ordered, received: rec, pending: Math.max(0, ordered - rec) });
  });
  const ordered = lines.reduce((a, l) => a + l.ordered, 0), received = lines.reduce((a, l) => a + l.received, 0);
  return { lines, ordered, received, pending: Math.max(0, ordered - received) };
}
function gpoStatus(po) {
  if (!po) return '';
  if (po.status === 'cancelled') return 'cancelled';
  const p = gpoProgress(po);
  if (p.ordered > 0 && p.received >= p.ordered - 1e-9) return 'received';
  if (p.received > 0) return 'part';
  return ((po.sent && Object.keys(po.sent).length) ? 'sent' : 'open');
}
const GPO_STATUS = {
  open: ['Not sent yet', 'pill-low'], sent: ['Sent to the mill', 'pill-low'], part: ['Part received', 'pill-low'],
  received: ['Received', 'pill-ok'], cancelled: ['Cancelled', 'pill-out'],
};

/**
 * Check a PO before it is written. Returns { err } or { po }.
 *
 * Every line must be for a fabric that has a greige name — a PO in the RFD name would send the mill
 * the wrong width.
 */
function gpoPlan(v) {
  const millCode = String(v.mill || '').trim();
  const mill = voAllVendors().find(x => String(x.code) === millCode);
  if (!mill) return { err: 'Pick the mill.' };
  const known = new Map(gpoFabrics().map(f => [f.rfd.toLowerCase(), f]));
  const lines = [], seen = new Set();
  for (const [i, l] of (v.lines || []).entries()) {
    const rfd = String(l.rfd || '').trim();
    const m = String(l.metres == null ? '' : l.metres).trim();
    if (!rfd && !m) continue;
    const f = known.get(rfd.toLowerCase());
    if (!f) return { err: `Line ${i + 1}: ${rfd || 'no fabric'} has no greige name. Add one in Masters → Fabric type.` };
    if (seen.has(f.greige.toLowerCase())) return { err: `${f.greige} is on the PO twice. Put it on one line.` };
    seen.add(f.greige.toLowerCase());
    const metres = parseFloat(m);
    if (!(metres > 0)) return { err: `Line ${i + 1}: how many metres of ${f.greige}?` };
    const rate = String(l.rate == null ? '' : l.rate).trim() === '' ? 0 : parseFloat(l.rate);
    if (!(rate >= 0)) return { err: `Line ${i + 1}: the rate has to be a number.` };
    const gstPct = String(l.gstPct == null ? '' : l.gstPct).trim() === '' ? 0 : parseFloat(l.gstPct);
    if (!(gstPct >= 0 && gstPct <= 28)) return { err: `Line ${i + 1}: GST is a percentage between 0 and 28.` };
    lines.push({ rfd: f.rfd, greige: f.greige, metres, rate, gstPct });
  }
  if (!lines.length) return { err: 'Add at least one fabric.' };
  const date = String(v.date || '').trim() || attToday();
  const now = new Date().toISOString();
  const id = v.id || ('gpo_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const prev = (GPO.rows || []).find(r => r.id === id) || {};
  return { po: Object.assign({}, prev, {
    id, poNo: prev.poNo || gpoNewNo(date), date,
    mill: { code: mill.code, name: mill.desc || mill.name || mill.code, email: String(mill.email || '').trim(), phone: mill.phone || '' },
    lines, deliveryDate: String(v.deliveryDate || '').trim(), terms: String(v.terms || '').trim(),
    status: prev.status || 'open',
    createdBy: prev.createdBy || ME.email, createdAt: prev.createdAt || now,
    modifiedBy: ME.email, modifiedAt: now,
  }) };
}

async function gpoSave(v) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const plan = gpoPlan(v);
  if (plan.err) return plan.err;
  const prev = (GPO.rows || []).find(r => r.id === plan.po.id);
  if (prev && prev.status === 'cancelled') return 'That PO was cancelled.';
  try { await ptPut('pt_greigePOs/' + plan.po.id, plan.po); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  GPO.rows = (GPO.rows || []).filter(r => r.id !== plan.po.id).concat([plan.po]);
  return '';
}

async function gpoCancel(id, reason) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const po = (GPO.rows || []).find(r => r.id === id);
  if (!po) return 'That PO is gone — press Refresh.';
  if (!String(reason || '').trim()) return 'Say why it is cancelled — the mill may ask.';
  if (gpoProgress(po).received > 0) return 'Cloth has already come in against this PO, so it cannot be cancelled.';
  const rec = Object.assign({}, po, { status: 'cancelled', cancelNote: String(reason).trim(),
    cancelledBy: ME.email, cancelledAt: new Date().toISOString() });
  try { await ptPut('pt_greigePOs/' + id, rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  GPO.rows = GPO.rows.map(r => (r.id === id ? rec : r));
  return '';
}

/* ---- the document ---- */

/** Our own name, address and GSTIN, and the terms every PO carries unless it says otherwise. */
const GPO_SETTING_FIELDS = [['company', 'Company name'], ['address', 'Address'], ['gstin', 'GSTIN'],
  ['phone', 'Phone'], ['email', 'Email'], ['terms', 'Default terms']];

async function gpoSettingsSave(v) {
  if (!ME.admin) return 'Only an admin can change what every PO says about the company.';
  const rec = { modifiedBy: ME.email, modifiedAt: new Date().toISOString() };
  GPO_SETTING_FIELDS.forEach(([k]) => { rec[k] = String(v[k] == null ? '' : v[k]).trim(); });
  if (!rec.company) return 'The company name goes at the top of every PO.';
  try { await ptPut('pt_poSettings', rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  GPO.settings = rec;
  return '';
}

const gpoDmy = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(iso || ''); };
const gpoMoney = n => (Math.round((parseFloat(n) || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The PO as a page, A4, the same page whether it is printed here or turned into the PDF that is
 * mailed. Plain tables and inline styles only — the mail side converts HTML to PDF and ignores
 * anything cleverer.
 */
function gpoHtml(po, settings) {
  const s = settings || {};
  const t = gpoTotals(po);
  const e = v => esc(v == null ? '' : String(v));
  const cell = 'border:1px solid #999;padding:6px 8px;font-size:11px';
  const rows = (po.lines || []).map((l, i) => {
    const m = gpoLineMoney(l);
    return `<tr><td style="${cell};text-align:center">${i + 1}</td><td style="${cell}">${e(l.greige)}`
      + `<div style="color:#666;font-size:10px">becomes ${e(l.rfd)} after processing</div></td>`
      + `<td style="${cell};text-align:right">${e(nf(l.metres))}</td><td style="${cell};text-align:right">${e(gpoMoney(l.rate))}</td>`
      + `<td style="${cell};text-align:right">${e(gpoMoney(m.amount))}</td><td style="${cell};text-align:right">${e(nf(l.gstPct))}%</td>`
      + `<td style="${cell};text-align:right">${e(gpoMoney(m.gst))}</td><td style="${cell};text-align:right">${e(gpoMoney(m.total))}</td></tr>`;
  }).join('');
  const terms = String(po.terms || s.terms || '').trim();
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(po.poNo) + '</title></head>'
    + '<body style="font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px">'
    + `<table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:top">`
    + `<div style="font-size:18px;font-weight:bold">${e(s.company || 'The Fabric Rush')}</div>`
    + `<div style="font-size:11px;white-space:pre-line">${e(s.address)}</div>`
    + (s.gstin ? `<div style="font-size:11px">GSTIN: ${e(s.gstin)}</div>` : '')
    + ((s.phone || s.email) ? `<div style="font-size:11px">${e([s.phone, s.email].filter(Boolean).join(' · '))}</div>` : '')
    + `</td><td style="vertical-align:top;text-align:right"><div style="font-size:20px;font-weight:bold">PURCHASE ORDER</div>`
    + `<div style="font-size:12px">PO No: <b>${e(po.poNo)}</b></div><div style="font-size:12px">Date: ${e(gpoDmy(po.date))}</div>`
    + (po.deliveryDate ? `<div style="font-size:12px">Deliver by: <b>${e(gpoDmy(po.deliveryDate))}</b></div>` : '')
    + `</td></tr></table>`
    + `<div style="margin:16px 0 8px;font-size:12px"><b>To</b><br>${e((po.mill || {}).name)}`
    + ((po.mill || {}).phone ? `<br>${e(po.mill.phone)}` : '') + ((po.mill || {}).email ? `<br>${e(po.mill.email)}` : '') + '</div>'
    + `<div style="font-size:12px;margin-bottom:8px">Please supply the following greige fabric:</div>`
    + `<table style="width:100%;border-collapse:collapse"><tr style="background:#f0f0f0">`
    + ['#', 'Greige fabric', 'Metres', 'Rate / m', 'Amount', 'GST', 'GST amount', 'Total']
      .map(h => `<th style="${cell};text-align:left">${h}</th>`).join('') + '</tr>' + rows
    + `<tr><td style="${cell}" colspan="2"><b>Total</b></td><td style="${cell};text-align:right"><b>${e(nf(t.metres))}</b></td>`
    + `<td style="${cell}"></td><td style="${cell};text-align:right"><b>${e(gpoMoney(t.amount))}</b></td><td style="${cell}"></td>`
    + `<td style="${cell};text-align:right"><b>${e(gpoMoney(t.gst))}</b></td><td style="${cell};text-align:right"><b>${e(gpoMoney(t.total))}</b></td></tr></table>`
    + (terms ? `<div style="margin-top:14px;font-size:11px"><b>Terms</b><div style="white-space:pre-line">${e(terms)}</div></div>` : '')
    + `<div style="margin-top:40px;font-size:11px;text-align:right">For ${e(s.company || 'The Fabric Rush')}<br><br><br>Authorised signatory</div>`
    + '</body></html>';
}

function gpoPrint(id) {
  const po = (GPO.rows || []).find(r => r.id === id);
  if (!po) return 'That PO is gone — press Refresh.';
  const w = window.open('', '_blank');
  if (!w || !w.document) return 'The browser blocked the new window. Allow pop-ups for this site and press Print again.';
  w.document.open();
  w.document.write(gpoHtml(po, GPO.settings).replace('</body>',
    '<div style="margin-top:24px;text-align:center" class="noprint"><button onclick="window.print()" style="padding:8px 20px">Print / Save as PDF</button></div>'
    + '<style>@media print{.noprint{display:none}}</style></body>'));
  w.document.close();
  return '';
}

/**
 * Mail it, from the owner's own Gmail, with the PDF attached.
 *
 * The backend turns the same page into the PDF and sends it; this only says who to and what to say.
 * What went, to whom and when, is kept on the PO.
 */
async function gpoEmail(id, to, cc, message) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const po = (GPO.rows || []).find(r => r.id === id);
  if (!po) return 'That PO is gone — press Refresh.';
  if (po.status === 'cancelled') return 'That PO was cancelled.';
  const list = s => String(s || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  const toL = list(to), ccL = list(cc);
  if (!toL.length) return 'Who is it going to? The mill has no email in the vendor master.';
  const bad = toL.concat(ccL).find(x => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  if (bad) return `"${bad}" is not an email address.`;
  if (toL.length + ccL.length > 5) return 'Five addresses at most.';
  const company = (GPO.settings || {}).company || 'The Fabric Rush';
  try {
    await apiPost({ mail: 'po', poNo: po.poNo, to: toL.join(','), cc: ccL.join(','),
      subject: 'Purchase Order ' + po.poNo + ' — ' + company,
      message: String(message || '').slice(0, 1500), html: gpoHtml(po, GPO.settings), fromName: company });
  } catch (e) { return 'Not sent: ' + (e.message || e); }
  const at = new Date().toISOString();
  const k = 's' + Date.now().toString(36);
  const log = { at, by: ME.email, to: toL.join(', '), cc: ccL.join(', ') };
  try { await ptPut('pt_greigePOs/' + id + '/sent/' + k, log); } catch (e) { /* it went; only the note of it failed */ }
  po.sent = Object.assign({}, po.sent || {}, { [k]: log });
  return '';
}

/* ---- the screen ---- */

function renderGpo() {
  const say = (t, bad) => { $('fbMsg').className = bad ? 'err' : 'muted'; $('fbMsg').textContent = t; };
  if (GPO.rows === null) {
    say('Reading the greige POs…'); ptEmpty('fbTable', 'Loading…');
    ensureGpo().then(() => { if ($('fbView').value === 'po') renderGpo(); });
    return;
  }
  if (GPO.err) { say('Could not read them: ' + GPO.err, true); ptEmpty('fbTable', 'Nothing to show.'); $('fbKpis').innerHTML = ''; return; }
  const q = String(($('fbQ') || {}).value || '').trim().toLowerCase();
  const rows = GPO.rows.filter(po => !q || [po.poNo, (po.mill || {}).name, ...(po.lines || []).map(l => l.greige + ' ' + l.rfd)]
    .join(' ').toLowerCase().includes(q))
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.poNo).localeCompare(String(a.poNo)));
  const live = GPO.rows.filter(p => p.status !== 'cancelled');
  const pend = live.reduce((a, p) => a + gpoProgress(p).pending, 0);
  $('fbKpis').innerHTML = `<div class="kpi" style="flex-basis:100%"><div class="kpihead"><span class="kpiname">Greige purchase orders</span>`
    + `<span class="kpiwhen">read live${GPO.at ? ' · ' + esc(GPO.at) : ''}</span></div><div class="metrics">`
    + `<div class="metric"><div class="v">${nf(live.length)}</div><div class="l">POs</div></div>`
    + `<div class="metric"><div class="v">${nf(live.filter(p => gpoStatus(p) === 'open').length)}</div><div class="l">Not sent yet</div></div>`
    + `<div class="metric"><div class="v" style="color:#7f6000">${nf(Math.round(pend))}</div><div class="l">Metres still to come</div></div>`
    + `<div class="metric"><div class="v" style="color:#166534">${nf(live.filter(p => gpoStatus(p) === 'received').length)}</div><div class="l">Fully received</div></div>`
    + '</div></div>';
  PTE.gpoShown = rows;
  const can = ptCanEdit();
  $('fbTable').innerHTML = '<thead><tr>' + ['PO', 'Date', 'Mill', 'Greige fabric', 'Ordered', 'Received', 'To come', 'Amount', 'Stage', '']
    .map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>'
    + (rows.length ? rows.map(po => {
      const p = gpoProgress(po), st = gpoStatus(po), t = gpoTotals(po);
      const sentN = Object.keys(po.sent || {}).length;
      const b = [];
      b.push(`<button class="ghost" data-gpo-print="${esc(po.id)}" style="padding:2px 9px;font-size:12px">Print</button>`);
      if (can && st !== 'cancelled') {
        b.push(`<button class="ghost" data-gpo-mail="${esc(po.id)}" style="padding:2px 9px;font-size:12px">${sentN ? 'Mail again' : 'Mail'}</button>`);
        if (p.pending > 0) b.push(`<button data-gpo-recv="${esc(po.id)}" style="padding:2px 9px;font-size:12px">Receive</button>`);
        if (p.received <= 0) {
          b.push(`<button class="ghost" data-gpo-edit="${esc(po.id)}" style="padding:2px 9px;font-size:12px">Edit</button>`);
          b.push(`<button class="ghost" data-gpo-cancel="${esc(po.id)}" style="padding:2px 9px;font-size:12px">Cancel</button>`);
        }
      }
      return `<tr><td style="text-align:left;font-family:ui-monospace,monospace;font-weight:700">${esc(po.poNo)}</td>`
        + `<td>${esc(gpoDmy(po.date))}${po.deliveryDate ? `<div class="muted" style="font-size:10.5px">by ${esc(gpoDmy(po.deliveryDate))}</div>` : ''}</td>`
        + `<td style="text-align:left">${esc((po.mill || {}).name)}</td>`
        + `<td style="text-align:left">${p.lines.map(l => `${esc(l.greige)} <span class="muted" style="font-size:10.5px">→ ${esc(l.rfd)}</span>`).join('<br>')}</td>`
        + `<td class="num">${nf(Math.round(p.ordered))} m</td><td class="num">${nf(Math.round(p.received))} m</td>`
        + `<td class="num"${p.pending > 0 && st !== 'cancelled' ? ' style="color:#7f6000;font-weight:700"' : ''}>${nf(Math.round(p.pending))} m</td>`
        + `<td class="num">${esc(gpoMoney(t.total))}</td>`
        + `<td><span class="pill ${(GPO_STATUS[st] || ['', ''])[1]}">${esc((GPO_STATUS[st] || [st])[0])}</span>`
        + (sentN ? `<div class="muted" style="font-size:10.5px">mailed ${nf(sentN)}×</div>` : '')
        + (po.cancelNote ? `<div class="muted" style="font-size:10.5px">${esc(po.cancelNote)}</div>` : '') + '</td>'
        + `<td style="white-space:nowrap">${b.join(' ')}</td></tr>`;
    }).join('') : `<tr><td colspan="10" class="muted" style="padding:16px">No greige PO yet. Press "+ Greige PO".</td></tr>`)
    + '</tbody>';
  const missing = mstRows('fabricType').filter(r => r.active !== false && !String(r.greige || '').trim()).length;
  say(`${nf(rows.length)} PO(s) · received is what the ledger says came in against the PO number`
    + (gpoFabrics().length ? '' : ' · no fabric has a greige name yet — add them in Masters → Fabric type')
    + (missing && gpoFabrics().length ? ` · ${nf(missing)} fabric type(s) have no greige name and cannot be ordered` : '')
    + ((GPO.settings || {}).company ? '' : ' · set the company details once under PO settings'));
}

const GPO_LINES = 6;
function gpoOpen(id) {
  const po = id ? (GPO.rows || []).find(r => r.id === id) : null;
  const fabs = gpoFabrics(), mills = gpoMills();
  if (!fabs.length) return 'No fabric has a greige name yet. Add them in Masters → Fabric type, then raise the PO.';
  const opt = (v, cur) => `<option value="${esc(v)}"${String(cur || '') === String(v) ? ' selected' : ''}>${esc(v)}</option>`;
  const line = i => {
    const l = ((po && po.lines) || [])[i] || {};
    return `<tr><td><select id="gpoF${i}" data-gpo-line="${i}" style="width:170px"><option value="">—</option>${fabs.map(f => opt(f.rfd, l.rfd)).join('')}</select></td>`
      + `<td id="gpoG${i}" class="muted" style="font-size:12px;text-align:left">${esc(l.greige || '')}</td>`
      + `<td><input id="gpoM${i}" type="number" min="0" step="0.1" value="${esc(l.metres == null ? '' : l.metres)}" style="width:90px"></td>`
      + `<td><input id="gpoR${i}" type="number" min="0" step="0.01" value="${esc(l.rate == null ? '' : l.rate)}" style="width:80px"></td>`
      + `<td><input id="gpoT${i}" type="number" min="0" max="28" step="0.5" value="${esc(l.gstPct == null ? '5' : l.gstPct)}" style="width:60px"></td></tr>`;
  };
  ptOpenDialog({
    title: po ? 'Edit ' + po.poNo : 'New greige PO',
    subtitle: 'Ordered in the greige name; it becomes the RFD fabric once processed.',
    note: 'Pick the RFD fabric you need — the greige name the mill is sent comes from Masters → Fabric type. '
      + 'Receiving against the PO number is what counts as delivered.',
    html: `<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <label>Mill<select id="gpoMill"><option value="">— pick —</option>${mills.map(v =>
          `<option value="${esc(v.code)}"${po && po.mill && po.mill.code === v.code ? ' selected' : ''}>${esc(v.desc || v.name || v.code)}${v.email ? '' : ' (no email)'}</option>`).join('')}</select></label>
        <label>PO date<input id="gpoDate" type="date" value="${esc((po && po.date) || attToday())}"></label>
        <label>Deliver by<input id="gpoDeliv" type="date" value="${esc((po && po.deliveryDate) || '')}"></label>
      </div>
      <table class="xl" style="margin-top:10px"><thead><tr><th>RFD fabric</th><th>Greige name (to the mill)</th><th>Metres</th><th>Rate / m</th><th>GST %</th></tr></thead>
        <tbody>${Array.from({ length: GPO_LINES }, (_, i) => line(i)).join('')}</tbody></table>
      <label style="display:block;margin-top:10px">Terms / remarks
        <textarea id="gpoTerms" rows="3" style="width:100%" placeholder="${esc((GPO.settings || {}).terms || 'Payment terms, quality notes…')}">${esc((po && po.terms) || '')}</textarea></label>`,
    saveLabel: po ? 'Save changes' : 'Raise PO',
    onSave: async () => {
      const g = x => ($(x) || {}).value;
      const err = await gpoSave({ id: po && po.id, mill: g('gpoMill'), date: g('gpoDate'), deliveryDate: g('gpoDeliv'), terms: g('gpoTerms'),
        lines: Array.from({ length: GPO_LINES }, (_, i) => ({ rfd: g('gpoF' + i), metres: g('gpoM' + i), rate: g('gpoR' + i), gstPct: g('gpoT' + i) })) });
      if (!err) renderGpo();
      return err;
    },
  });
  for (let i = 0; i < GPO_LINES; i++) {
    const el = $('gpoF' + i);
    if (el) el.addEventListener('change', () => { const c = $('gpoG' + i); if (c) c.textContent = fabGreigeOf(el.value); });
  }
  return '';
}

function gpoSettingsOpen() {
  const s = GPO.settings || {};
  ptOpenDialog({
    title: 'PO settings',
    subtitle: 'What every greige PO says about The Fabric Rush.',
    fields: GPO_SETTING_FIELDS.map(([k, label]) => ({ key: k, label, span: k === 'address' || k === 'terms', value: s[k] || '' })),
    saveLabel: 'Save',
    onSave: async v => { const err = await gpoSettingsSave(v); if (!err) renderGpo(); return err; },
  });
}

$('fbTable').addEventListener('click', async e => {
  if ($('fbView').value !== 'po') return;
  const say = (t, bad) => { $('fbMsg').className = bad ? 'err' : 'muted'; $('fbMsg').textContent = t; };
  const pick = a => { const b = e.target.closest('[' + a + ']'); return b ? b.getAttribute(a) : ''; };
  let id;
  if ((id = pick('data-gpo-print'))) { const err = gpoPrint(id); if (err) say(err, true); return; }
  if ((id = pick('data-gpo-edit'))) { const err = gpoOpen(id); if (err) say(err, true); return; }
  if ((id = pick('data-gpo-cancel'))) {
    const po = GPO.rows.find(r => r.id === id); if (!po) return;
    return ptOpenDialog({ title: 'Cancel ' + po.poNo, subtitle: (po.mill || {}).name || '',
      fields: [{ key: 'why', label: 'Why', span: true, value: '' }], saveLabel: 'Cancel the PO',
      onSave: async v => { const err = await gpoCancel(id, v.why); if (!err) renderGpo(); return err; } });
  }
  if ((id = pick('data-gpo-mail'))) {
    const po = GPO.rows.find(r => r.id === id); if (!po) return;
    return ptOpenDialog({ title: 'Mail ' + po.poNo + ' to ' + ((po.mill || {}).name || 'the mill'),
      subtitle: 'Sent from ' + ME.email + ' with the PO attached as a PDF.',
      fields: [{ key: 'to', label: 'To', span: true, value: (po.mill || {}).email || '' },
        { key: 'cc', label: 'Cc (optional)', span: true, value: '' },
        { key: 'msg', label: 'Message (optional)', span: true, value: '' }],
      saveLabel: 'Send',
      onSave: async v => { const err = await gpoEmail(id, v.to, v.cc, v.msg); if (!err) { renderGpo(); say(po.poNo + ' sent to ' + v.to + '.'); } return err; } });
  }
  if ((id = pick('data-gpo-recv'))) {
    const po = GPO.rows.find(r => r.id === id); if (!po) return;
    const next = gpoProgress(po).lines.find(l => l.pending > 0);
    if (!next) return;
    return fabEntryOpen({ kind: 'RECEIVE_GREIGE', fabric: next.greige, qty: Math.round(next.pending * 100) / 100,
      cp: (po.mill || {}).name || '', orderNo: po.poNo });
  }
});
$('fbPoNew').onclick = async () => { await ensureGpo(); const err = gpoOpen(null); if (err) { $('fbMsg').className = 'err'; $('fbMsg').textContent = err; } };
$('fbPoSet').onclick = async () => { await ensureGpo(); gpoSettingsOpen(); };
