/* ================= DAILY CHALLAN — the printer's own delivery challan (Ravi, 4 Nov) =================
 *
 * "ye daily challan ke name se vendor portal par add karna and challan ka format greige fabric jesa rakhna h; yadi koi order vendor
 * ke pas nahi h to uska auto ek order number generate ho jay and jo order unko diye hue order me se mile unko assign ho jay and vendor
 * apna daily ka challan yanhi se banay and wo bad me date wise challan bhi dekh sake."
 *
 * One row per thing sent: Date (today, by itself) · Order Number · SKU · Article · Colour · Size · Qty.
 *   Article, Colour and Size are drop-downs of what THIS printer's own orders hold (not every order of ours); SKU follows from them.
 *   Order Number lists the real orders (SHP-7862, AMZ-04112026-AIR …) those lines are for. Nothing of theirs matches → an order
 *   number is made: NIO-<ddmmyyyy>-NN ("not in order"), which the office sees apart.
 * Saved as pt_vendorChallans/<code>/<DC-code-ddmmyyyy-NN> = { no, date, code, name, lines:[{orderNo, voId, lineId, sku, article,
 *   color, size, qty, unit, nio}], at, by }. A line matched to an order also goes on that order line's Vendor sent (vSent), as if
 *   typed there — the challan number on it.
 * TYPED BY HAND (Ravi, 4 Nov: "koi article aisa jo is list me nahi h but wo print karke bhej raha to manually entry kar sake"): every
 * drop-down ends in "Other — type it"; a row with anything typed is in no order of theirs, so it gets its NIO number like any other.
 * The rules for pt_vendorChallans are NOT deployed yet (Ravi, 4 Nov: "pehle sirf preview"): until then a save is refused and says so;
 * the form, the print and the matching all work. */
let DCH = { rows: [], saved: null, savedErr: '', busy: false, msg: '', open: '' };
const dchDmy = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '-' + m[2] + '-' + m[1] : String(iso || ''); };
const dchCompact = iso => dchDmy(iso).replace(/-/g, '');
const dchToday = () => (typeof dToday === 'function' ? dToday() : new Date().toISOString().slice(0, 10));
const dchCanSave = () => !!(VP.code && !VP.viewAs && typeof spIsVendor === 'function' && spIsVendor());

/** Every open line of this printer's orders, as the challan's drop-downs need it. */
function dchSource() {
  const out = [];
  (VP.rows || []).forEach(o => {
    if (!o || o.status === 'Cancelled' || o.status === 'Draft') return;
    const run = o.orderType === 'running', unit = run ? 'm' : 'pcs';
    voLines(o).forEach((l, i) => {
      if (!l || l.cancelled) return;
      const ord = vpQty(o, l), sent = vpVsSum(vpVsOf(o, l)), bal = Math.max(0, Math.round((ord - sent) * 100) / 100);
      const fo = (Array.isArray(l.forOrders) ? l.forOrders : Object.values(l.forOrders || {})).filter(x => x && x.orderNo).map(x => String(x.orderNo));
      out.push({ o, l, i, run, unit, bal, sku: String(l.sku || '').toUpperCase(),
        article: run ? (String(l.fabricType || 'Fabric') + ' (running cloth)') : String(l.articleSubtype || l.articleType || '').trim(),
        color: String(l.color || '').trim(), size: run ? '' : String(l.size || '').trim(),
        orders: fo.length ? fo : [String(o.orderNo || o.id)] });
    });
  });
  return out;
}
const dchUniq = a => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
/** What one row resolves to: its drop-down choices, the lines it matches, its SKU, its order options. */
function dchResolve(src, r) {
  const byArt = r.mArticle ? [] : src.filter(x => x.article === r.article), byCol = r.mColor ? [] : byArt.filter(x => x.color === r.color),
    bySize = r.mSize ? [] : byCol.filter(x => x.size === (r.size || ''));
  const skus = dchUniq(bySize.map(x => x.sku));
  const orders = dchUniq(bySize.flatMap(x => x.orders));
  return { arts: dchUniq(src.map(x => x.article)), cols: dchUniq(byArt.map(x => x.color)), sizes: dchUniq(byCol.map(x => x.size)),
    match: bySize, sku: skus[0] || '', skus, orders, unit: r.mArticle ? (r.unit || 'pcs') : ((bySize[0] || byCol[0] || byArt[0] || {}).unit || 'pcs'),
    manual: !!(r.mArticle || r.mColor || r.mSize) };
}
/** The NIO numbers this challan hands out: one per order-less row, after the ones already given today. */
function dchNioNos(src) {
  const day = dchCompact(dchToday()), pre = 'NIO-' + day + '-';
  let n = (DCH.saved || []).filter(c => c && c.date === dchToday()).reduce((a, c) => a + (c.lines || []).filter(l => l && l.nio).length, 0);
  const map = {};
  DCH.rows.forEach((r, k) => { const z = dchResolve(src, r); if (r.article && (!z.match.length || r.order === '__nio')) map[k] = pre + String(++n).padStart(2, '0'); });
  return map;
}
function dchNextNo() {
  const pre = 'DC-' + VP.code + '-' + dchCompact(dchToday()) + '-';
  const used = (DCH.saved || []).map(c => c && c.no).filter(n => String(n || '').startsWith(pre)).map(n => +String(n).slice(-2) || 0);
  return pre + String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0');
}
async function dchLoad(force) {
  if (DCH.saved && !force) return;
  try { const v = await ptGet('pt_vendorChallans/' + VP.code); DCH.saved = ptList(v || {}).sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))); DCH.savedErr = ''; }
  catch (e) { DCH.saved = []; DCH.savedErr = /permission|denied/i.test(String(e.message || e)) ? 'Saved challans are not readable yet — the database rule for daily challans is not deployed (preview).' : 'Could not read the saved challans: ' + (e.message || e); }
}

/** The tab. */
function vpDchRender() {
  const body = $('vpBody');
  if (!DCH.saved) { body.innerHTML = '<div class="card muted" style="padding:24px">Reading your challans…</div>'; dchLoad().then(() => { if (VP.tab === 'dch') vpDchRender(); }); return; }
  if (!DCH.rows.length) DCH.rows = [{ article: '', color: '', size: '', order: '', qty: '' }];
  const src = dchSource(), nio = dchNioNos(src), today = dchToday(), can = dchCanSave();
  const mk = f => 'm' + f[0].toUpperCase() + f.slice(1);
  const sel = (k, f, list, v, ph) => DCH.rows[k][mk(f)]
    ? `<div style="display:flex;gap:4px;align-items:center"><input data-dch="${k}" data-f="${f}" type="text" value="${esc(v || '')}" placeholder="type the ${esc(f === 'color' ? 'colour' : f)}" style="width:100%;min-width:110px;padding:5px 8px;font-size:13px">`
      + (f === 'article' || !DCH.rows[k].mArticle ? `<button type="button" class="ghost" data-dchlist="${k}" data-f="${f}" title="Back to the list" style="width:auto;padding:3px 7px;font-size:11px">list</button>` : '') + '</div>'
    : `<select data-dch="${k}" data-f="${f}" style="width:100%;min-width:110px;padding:5px 8px;font-size:13px">`
      + `<option value="">${esc(ph)}</option>` + list.map(x => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('')
      + `<option value="__other">Other — type it</option></select>`;
  const rowsH = DCH.rows.map((r, k) => {
    const z = dchResolve(src, r), nioNo = nio[k];
    const orderCell = !r.article ? '<span class="muted">—</span>'
      : !z.match.length ? `<b>${esc(nioNo || '')}</b><div class="muted" style="font-size:10.5px">${z.manual ? 'typed by hand' : 'not in your orders'} — a number is made</div>`
      : `<select data-dch="${k}" data-f="order" style="width:100%;min-width:150px;padding:5px 8px;font-size:13px">`
        + `<option value="">— pick the order —</option>` + z.orders.map(x => `<option${x === r.order ? ' selected' : ''}>${esc(x)}</option>`).join('')
        + `<option value="__nio"${r.order === '__nio' ? ' selected' : ''}>Not in my orders (NIO)</option></select>`
        + (r.order === '__nio' ? `<div class="muted" style="font-size:10.5px">${esc(nioNo || '')}</div>` : '');
    return `<tr><td style="white-space:nowrap;font-size:12.5px">${esc(dchDmy(today))}</td><td style="min-width:170px">${orderCell}</td>`
      + `<td style="font-family:ui-monospace,monospace;font-size:12px">${esc(z.skus.join(' / ')) || '<span class="muted">—</span>'}</td>`
      + `<td>${sel(k, 'article', z.arts, r.article, '— article —')}</td><td>${sel(k, 'color', z.cols, r.color, '— colour —')}</td>`
      + `<td>${z.sizes.some(Boolean) || r.mSize ? sel(k, 'size', z.sizes, r.size, '— size —') : r.article ? `<span class="muted">—</span> <button type="button" class="ghost" data-dchother="${k}" data-f="size" style="width:auto;padding:3px 7px;font-size:11px">type a size</button>` : '<span class="muted">—</span>'}</td>`
      + `<td><input data-dch="${k}" data-f="qty" type="number" min="0" step="${z.unit === 'm' ? '0.01' : '1'}" value="${esc(r.qty)}" placeholder="0" style="width:90px;padding:5px 8px;text-align:right"> `
      + (r.mArticle ? `<select data-dch="${k}" data-f="unit" style="width:auto;padding:4px 6px;font-size:12px"><option${z.unit === 'pcs' ? ' selected' : ''}>pcs</option><option${z.unit === 'm' ? ' selected' : ''}>m</option></select>` : `<span class="muted" style="font-size:11px">${esc(z.unit)}</span>`) + `</td>`
      + `<td><button type="button" class="ghost" data-dchdel="${k}" style="width:auto;padding:4px 10px" aria-label="Remove this row">✕</button></td></tr>`;
  }).join('');
  /* office (looking as the printer): what came outside any order */
  const nioLines = (DCH.saved || []).flatMap(c => (c.lines || []).filter(l => l && l.nio).map(l => Object.assign({ challan: c.no, date: c.date }, l)));
  const byDate = new Map(); (DCH.saved || []).forEach(c => { const d = c.date || ''; byDate.set(d, (byDate.get(d) || []).concat(c)); });
  const savedH = !(DCH.saved || []).length ? `<div class="muted" style="padding:10px 0">${esc(DCH.savedErr || 'No challan made yet.')}</div>`
    : [...byDate.entries()].map(([d, cs]) => `<div style="margin:10px 0 4px;font-weight:700">${esc(dchDmy(d))} <span class="muted" style="font-weight:400">· ${nf(cs.length)} challan(s)</span></div>`
      + cs.map(c => { const tot = (c.lines || []).reduce((a, l) => a + (+l.qty || 0), 0);
        return `<div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--line)"><b style="font-family:ui-monospace,monospace">${esc(c.no)}</b>`
          + `<span class="muted">${nf((c.lines || []).length)} line(s) · ${nf(tot)}${(c.lines || []).some(l => l.nio) ? ' · <span style="color:#b45309">has NIO lines</span>' : ''}</span>`
          + `<span style="flex:1"></span><button type="button" class="ghost" data-dchprint="${esc(c.no)}" style="width:auto;padding:4px 12px">Print</button></div>`; }).join('')).join('');
  $('vpKpis').innerHTML = `<div class="vpbar"><span><b>${esc(VP.name)}</b> <span class="muted">· daily challan</span></span><span class="sep"></span>`
    + `<span class="muted">Date</span> <b>${esc(dchDmy(today))}</b><span class="sep"></span><span class="muted">Challan no.</span> <b style="font-family:ui-monospace,monospace">${esc(dchNextNo())}</b>`
    + `<span style="flex:1"></span><span class="muted" style="font-size:11px">${src.length ? nf(src.length) + ' open line(s) in your orders' : 'no open order lines'}</span></div>`;
  body.innerHTML = `<div class="card" style="padding:12px 14px">`
    + `<div style="font-weight:700;margin-bottom:6px">New challan</div>`
    + `<div class="xlwrap" style="max-height:none"><table class="xl xl-dense"><thead><tr><th>Date</th><th>Order Number</th><th>SKU</th><th>Article</th><th>Colour</th><th>Size</th><th>Qty</th><th></th></tr></thead><tbody>${rowsH}</tbody></table></div>`
    + `<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">`
    + `<button type="button" class="ghost" data-dchadd="1" style="width:auto">+ Add a row</button>`
    + `<button type="button" class="ghost" data-dchprint="__new" style="width:auto">Print / preview</button>`
    + (can ? `<button type="button" data-dchsave="1" style="width:auto"${DCH.busy ? ' disabled' : ''}>Save challan</button>` : `<span class="muted" style="font-size:12px">${VP.viewAs ? 'View only — the printer makes the challan from their own sign-in.' : ''}</span>`)
    + `<span data-dchmsg class="${/^Not |^Could not|refused/i.test(DCH.msg) ? 'err' : 'muted'}" style="font-size:12.5px">${esc(DCH.msg || '')}</span></div></div>`
    + (VP.viewAs && nioLines.length ? `<div class="card" style="padding:12px 14px"><div style="font-weight:700;margin-bottom:6px">Sent outside any order (NIO) <span class="muted" style="font-weight:400">· ${nf(nioLines.length)} line(s) — match them to an order</span></div>`
      + `<table class="xl xl-dense"><thead><tr><th>Date</th><th>Challan</th><th>NIO no.</th><th>SKU</th><th>Article</th><th>Colour</th><th>Size</th><th>Qty</th></tr></thead><tbody>`
      + nioLines.map(l => `<tr><td>${esc(dchDmy(l.date))}</td><td>${esc(l.challan)}</td><td><b>${esc(l.orderNo)}</b></td><td>${esc(l.sku || '—')}</td><td>${esc(l.article)}</td><td>${esc(l.color)}</td><td>${esc(l.size || '—')}</td><td class="num">${nf(l.qty)} ${esc(l.unit || '')}</td></tr>`).join('')
      + `</tbody></table></div>` : '')
    + `<div class="card" style="padding:12px 14px"><div style="font-weight:700">My challans, by date</div>${savedH}</div>`;
  $('vpMsg').className = 'muted'; $('vpMsg').textContent = '';
}

/** The challan being made, as it will be saved. */
function dchBuild() {
  const src = dchSource(), nio = dchNioNos(src), lines = [], bad = [];
  DCH.rows.forEach((r, k) => {
    if (!r.article && !r.qty) return;
    const z = dchResolve(src, r), qty = parseFloat(r.qty);
    if (!r.article || !r.color) return bad.push(`row ${k + 1}: pick the article and colour`);
    if (z.sizes.some(Boolean) && !r.size && !r.mSize) return bad.push(`row ${k + 1}: pick the size, or type it`);
    if (!(qty > 0)) return bad.push(`row ${k + 1}: type the quantity`);
    if (z.unit === 'pcs' && qty !== Math.round(qty)) return bad.push(`row ${k + 1}: pieces are whole numbers`);
    const isNio = !z.match.length || r.order === '__nio';
    if (!isNio && !r.order) return bad.push(`row ${k + 1}: pick the order`);
    const hit = isNio ? null : (z.match.find(x => x.orders.includes(r.order) && x.bal > 0) || z.match.find(x => x.orders.includes(r.order)));
    lines.push({ orderNo: isNio ? nio[k] : r.order, nio: isNio, voId: hit ? hit.o.id : '', voNo: hit ? (hit.o.orderNo || hit.o.id) : '', lineId: hit ? (hit.l.lineId || '') : '', li: hit ? hit.i : -1,
      sku: z.sku, article: r.article, color: r.color, size: r.size || '', qty: z.unit === 'm' ? Math.round(qty * 100) / 100 : qty, unit: z.unit, bal: hit ? hit.bal : 0,
      typed: z.manual || undefined });
  });
  return { lines, bad };
}
async function dchSave() {
  if (!dchCanSave()) return;
  const { lines, bad } = dchBuild();
  if (bad.length) { DCH.msg = 'Not saved — ' + bad.join('; '); return vpDchRender(); }
  if (!lines.length) { DCH.msg = 'Not saved — add at least one row.'; return vpDchRender(); }
  const no = dchNextNo(), now = new Date().toISOString();
  const rec = { no, date: dchToday(), code: VP.code, name: VP.name || '', lines: lines.map(({ li, bal, ...x }) => x), at: now, by: ME.email || '' };
  DCH.busy = true; vpDchRender();
  /* the challan first: if it is refused nothing else is written */
  try { await ptPut('pt_vendorChallans/' + VP.code + '/' + no, rec); }
  catch (e) { DCH.busy = false; DCH.msg = /permission|denied/i.test(String(e.message || e)) ? 'Not saved — the database rule for daily challans is not deployed yet (preview). The form and the print work.' : 'Not saved: ' + (e.message || e); return vpDchRender(); }
  /* then each matched line's Vendor sent, as if typed on the order — never more than the line still owes */
  const said = [];
  for (const l of lines.filter(x => !x.nio && x.voId)) {
    const o = (VP.rows || []).find(x => x && x.id === l.voId), vl = o && voLines(o)[l.li]; if (!o || !vl) continue;
    const q = l.unit === 'm' ? Math.round(Math.min(l.qty, l.bal) * 100) / 100 : Math.min(l.qty, Math.floor(l.bal));
    if (!(q > 0)) { said.push(`${l.sku} ${l.orderNo}: nothing left on the order, kept on the challan only`); continue; }
    const key = 'vs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const b = { lineId: vl.lineId || '', sku: vl.sku || '', color: vl.color || '', fabricType: vl.fabricType || '', printDirection: vl.printDirection || '',
      qty: q, unit: l.unit, at: now, by: ME.email || '', challan: no };
    try { await ptPut('pt_vendorOrders/' + VP.code + '/' + o.id + '/vSent/' + key, b); o.vSent = Object.assign({}, o.vSent, { [key]: b }); }
    catch (e) { said.push(`${l.sku} ${l.orderNo}: Vendor sent not recorded (${e.message || e})`); }
    if (q < l.qty) said.push(`${l.sku} ${l.orderNo}: only ${nf(q)} was left on the order`);
  }
  DCH.busy = false; DCH.rows = []; DCH.saved = null; await dchLoad(true);
  DCH.msg = `Saved ${no} — ${nf(lines.length)} line(s).` + (said.length ? ' ' + said.join('; ') + '.' : '');
  vpDchRender();
}

/** The challan as a page — the greige PO's layout: who from, who to, the number and the date, the goods, the total, the signature. */
function dchHtml(c) {
  const e = v => esc(v == null ? '' : String(v)), cell = 'border:1px solid #999;padding:6px 8px;font-size:11px';
  const tot = {}; (c.lines || []).forEach(l => { tot[l.unit || 'pcs'] = (tot[l.unit || 'pcs'] || 0) + (+l.qty || 0); });
  const rows = (c.lines || []).map((l, i) => `<tr><td style="${cell};text-align:center">${i + 1}</td><td style="${cell}"><b>${e(l.orderNo)}</b>${l.nio ? '<div style="color:#b45309;font-size:10px">not in any order</div>' : ''}</td>`
    + `<td style="${cell};font-family:monospace">${e(l.sku || '—')}</td><td style="${cell}">${e(l.article)}</td><td style="${cell}">${e(l.color)}</td><td style="${cell}">${e(l.size || '—')}</td>`
    + `<td style="${cell};text-align:right"><b>${e(nf(l.qty))}</b></td><td style="${cell}">${e(l.unit)}</td></tr>`).join('');
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + e(c.no) + '</title></head>'
    + '<body style="font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px">'
    + `<table style="width:100%;border-collapse:collapse"><tr><td style="vertical-align:top">`
    + `<div style="font-size:18px;font-weight:bold">${e(c.name || c.code)}</div><div style="font-size:11px">Printer code ${e(c.code)}</div>`
    + `</td><td style="vertical-align:top;text-align:right"><div style="font-size:20px;font-weight:bold">DELIVERY CHALLAN</div>`
    + `<div style="font-size:12px">Challan No: <b>${e(c.no)}</b></div><div style="font-size:12px">Date: ${e(dchDmy(c.date))}</div></td></tr></table>`
    + `<div style="margin:16px 0 8px;font-size:12px"><b>To</b><br>Ridhi Home &amp; Living</div>`
    + `<div style="font-size:12px;margin-bottom:8px">Please receive the following goods:</div>`
    + `<table style="width:100%;border-collapse:collapse"><tr style="background:#f0f0f0">`
    + ['#', 'Order Number', 'SKU', 'Article', 'Colour', 'Size', 'Qty', 'Unit'].map(h => `<th style="${cell};text-align:left">${h}</th>`).join('') + '</tr>' + rows
    + `<tr><td style="${cell}" colspan="6"><b>Total</b></td><td style="${cell};text-align:right" colspan="2"><b>${e(Object.entries(tot).map(([u, n]) => nf(Math.round(n * 100) / 100) + ' ' + u).join(' · '))}</b></td></tr></table>`
    + `<table style="width:100%;margin-top:46px;font-size:11px"><tr><td>Received by (Ridhi)<br><br><br>Signature &amp; date</td>`
    + `<td style="text-align:right">For ${e(c.name || c.code)}<br><br><br>Authorised signatory</td></tr></table>`
    + '</body></html>';
}
function dchPrint(no) {
  let c = null;
  if (no === '__new') { const { lines, bad } = dchBuild(); if (!lines.length) { DCH.msg = bad.length ? 'Nothing to print — ' + bad.join('; ') : 'Nothing to print — add a row.'; return vpDchRender(); }
    c = { no: dchNextNo() + ' (not saved)', date: dchToday(), code: VP.code, name: VP.name, lines }; }
  else c = (DCH.saved || []).find(x => x.no === no);
  if (!c) return;
  const w = window.open('', '_blank');
  if (!w || !w.document) { DCH.msg = 'The browser blocked the new window — allow pop-ups and press Print again.'; return vpDchRender(); }
  w.document.open();
  w.document.write(dchHtml(c).replace('</body>', '<div style="margin-top:24px;text-align:center" class="noprint"><button onclick="window.print()" style="padding:8px 20px">Print / Save as PDF</button></div><style>@media print{.noprint{display:none}}</style></body>'));
  w.document.close();
}

if ($('vpBody') && $('vpBody').addEventListener) {
  $('vpBody').addEventListener('change', e => {
    if (VP.tab !== 'dch') return;
    const el = e.target.closest && e.target.closest('[data-dch]'); if (!el) return;
    const r = DCH.rows[+el.dataset.dch]; if (!r) return;
    const f = el.dataset.f;
    if (el.value === '__other') {
      const chain = f === 'article' ? ['article', 'color', 'size'] : f === 'color' ? ['color', 'size'] : ['size'];
      chain.forEach(x => { r['m' + x[0].toUpperCase() + x.slice(1)] = true; r[x] = ''; }); r.order = '';
      DCH.msg = ''; return vpDchRender();
    }
    r[f] = el.value;
    if (el.tagName === 'INPUT' && el.type === 'text') { DCH.msg = ''; return vpDchRender(); }   // typed: nothing to pick by itself
    /* a choice upstream clears what depended on it */
    if (f === 'article') { r.color = ''; r.size = ''; r.order = ''; }
    if (f === 'color') { r.size = ''; r.order = ''; }
    if (f === 'size') r.order = '';
    /* one colour, size or order only: picked by itself */
    const z = dchResolve(dchSource(), r);
    if (!r.color && z.cols.length === 1) r.color = z.cols[0];
    const z2 = dchResolve(dchSource(), r);
    if (!r.size && z2.sizes.length === 1) r.size = z2.sizes[0];
    const z3 = dchResolve(dchSource(), r);
    if (!r.order && z3.orders.length === 1 && z3.match.length) r.order = z3.orders[0];
    if (f !== 'qty') { DCH.msg = ''; vpDchRender(); }
  });
  $('vpBody').addEventListener('click', e => {
    if (VP.tab !== 'dch') return;
    const t = e.target.closest && e.target.closest('[data-dchadd],[data-dchdel],[data-dchprint],[data-dchsave],[data-dchlist],[data-dchother]'); if (!t) return;
    if (t.dataset.dchlist != null) { const r = DCH.rows[+t.dataset.dchlist], f = t.dataset.f, chain = f === 'article' ? ['article', 'color', 'size'] : f === 'color' ? ['color', 'size'] : ['size'];
      if (r) chain.forEach(x => { r['m' + x[0].toUpperCase() + x.slice(1)] = false; r[x] = ''; }); return vpDchRender(); }
    if (t.dataset.dchother != null) { const r = DCH.rows[+t.dataset.dchother]; if (r) { r.mSize = true; r.size = ''; } return vpDchRender(); }
    if (t.dataset.dchadd) { DCH.rows.push({ article: '', color: '', size: '', order: '', qty: '' }); return vpDchRender(); }
    if (t.dataset.dchdel != null) { DCH.rows.splice(+t.dataset.dchdel, 1); return vpDchRender(); }
    if (t.dataset.dchprint) return dchPrint(t.dataset.dchprint);
    if (t.dataset.dchsave) return dchSave();
  });
}
if ($('vpTabDch')) $('vpTabDch').onclick = () => { VP.tab = 'dch'; DCH.saved = null; renderVp(); };
