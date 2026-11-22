/* ================= NEW LAUNCH — a size set for a new colour, from what the same colour family sells =================
 *
 * Ravi, 22 Nov: "new launch factor add krna h based on color trend … pillow cover - 18x18 - 50, 20x20 - 50, 24x24 - 30,
 * 16x16 - 30 set ka order banana h" and "order qty bhi color family ko dekhte hue same color family me us projection month me
 * article+size ka velocity rahta h uske according order banao". Families agreed: Green, Blue, Pink & Peach, Yellow,
 * Brown & Neutral. Template 50 / 50 / 30 / 30 stays.
 *
 * HOW A SIZE'S QUANTITY FOR ONE MONTH IS FOUND, first that answers wins:
 *   1. VELOCITY: the median units that SKUs of the same article + size + colour family sold in that calendar month last year
 *      (snapshot rows carry lym[12] = units per calendar month over the last 12 complete months). Only SKUs already selling by
 *      then count: a SKU's months start at its first sale, so a colour launched in March is not read as "sold 0 in January".
 *      Needs 2 or more such SKUs.
 *   2. The same article + size, every colour, × the family's colour factor for that month.
 *   3. The template (a normal month) × the article's season × the colour factor.
 * The colour factor = the family's units per selling SKU that month against the whole article's, over the same ratio for the
 * year; kept to ×0.5–×2, pulled towards ×1 for a family under 3,000 units a year; ×1 under 300. A typed Proj, a Sales Order draft and the Excel are only
 * made when the button is pressed. */
/* Families (22 Nov, second pass): Burgundy / Maroon / Wine are red, not brown; Black, Grey and White are a family of their own. */
const NL_FAMILIES = [
  ['Blue', /blue|aquamarine|navy|indigo/i],
  ['Green', /green|sage|artichoke|olive|mint/i],
  ['Pink & Red', /pink|salmon|peach|coral|red|flamingo|rose|blush|burgundy|maroon|wine/i],
  ['Yellow', /yellow|goldenrod|mustard/i],
  ['Black, Grey & White', /black|grey|gray|charcoal|white|silver/i],
  ['Brown & Neutral', /./],
];
const nlFamilyOf = c => (NL_FAMILIES.find(([, re]) => re.test(String(c || ''))) || NL_FAMILIES[NL_FAMILIES.length - 1])[0];
const nlSize = s => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[×*]/g, 'x');
const nlSizeCode = s => nlSize(s).replace(/x/g, '');
const NL_DEFAULT_TPL = { 'Piping Flap Pillow Cover': { '18x18': 50, '20x20': 50, '24x24': 30, '16x16': 30 } };
let NL_TPL = null, NL = { brand: '', art: '', fam: 'Blue', colour: '', base: '', start: 1, cover: 2, skus: {} };
const nlMed = a => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* calendar month c → its place in the 12 months the snapshot holds (0 = this month last year … 11 = last month) */
function nlPos(c) { const cur = new Date().getMonth(); return (c - cur + 12) % 12; }
/** first place a SKU sold in, or 12 when it sold nothing */
function nlFirst(lym) { let f = 12; for (let c = 0; c < 12; c++) if ((Number(lym[c]) || 0) > 0) f = Math.min(f, nlPos(c)); return f; }

function nlArticleModel(brand, art) {
  const rows = ((REPL[brand] || {}).rows || []).filter(r => r && String(r.subcat || '').trim() === art && Array.isArray(r.lym));
  const T = Array(12).fill(0), nAll = Array(12).fill(0), fam = {};
  rows.forEach(r => {
    const f = nlFamilyOf(r.color), first = nlFirst(r.lym), F = fam[f] = fam[f] || { u: Array(12).fill(0), n: Array(12).fill(0), tot: 0 };
    for (let c = 0; c < 12; c++) {
      const u = Number(r.lym[c]) || 0; T[c] += u; F.u[c] += u; F.tot += u;
      if (first <= nlPos(c)) { nAll[c]++; F.n[c]++; }
    }
  });
  const yr = T.reduce((a, b) => a + b, 0), season = T.map(v => yr ? v / (yr / 12) : 1);
  const per = (u, n) => n ? u / n : 0, yrPer = per(yr, nAll.reduce((a, b) => a + b, 0) / 12);
  const colour = {};
  NL_FAMILIES.forEach(([f]) => {
    const F = fam[f];
    colour[f] = Array.from({ length: 12 }, (_, c) => {
      if (!F || F.tot < 300 || !F.n[c] || !nAll[c]) return 1;
      const yrF = per(F.tot, F.n.reduce((a, b) => a + b, 0) / 12); if (!yrF || !yrPer) return 1;
      const raw = (per(F.u[c], F.n[c]) / per(T[c], nAll[c])) / (yrF / yrPer);
      /* a small family's month swings on a handful of orders: its factor is pulled towards ×1, fully trusted from 3,000 units a year */
      const w = Math.min(1, F.tot / 3000), shr = 1 + (Math.min(2, Math.max(0.5, raw)) - 1) * w;
      return Math.round(shr * 100) / 100;
    });
  });
  return { rows, season, colour, yr };
}

/** one size's quantity for calendar month c, and how it was found */
/* A SKU'S NORMAL MONTH (22 Nov, second pass — RPC232-2020 showed 4 for January: only three weak SKUs were selling in Jan '26, while
 * Oak Brown, Quiet Earth … came later). Every SKU of the group counts, whenever it launched: its units from the month AFTER its first
 * sale (the launch month is part of a month), divided by the article's season over those same months — so a SKU launched in a
 * busy March is not read as stronger than one launched in a slow December. Needs 2+ such months. */
function nlBase(r, season) {
  const f = nlFirst(r.lym); let u = 0, s = 0, n = 0;
  for (let c = 0; c < 12; c++) if (nlPos(c) > f) { u += Number(r.lym[c]) || 0; s += season[c] || 0; n++; }
  return n >= 2 && s > 0 ? u / s : null;
}
/** One size's quantity for calendar month c = the median normal month of the group × the article's season × the family's factor.
 * Group: same article + size + colour family, 3 SKUs or more; else the same size in any colour; else the template. */
function nlQty(model, size, fam, c, tpl, except) {
  const ex = except ? String(except).trim().toUpperCase() : '';
  const pool = model.rows.filter(r => nlSize(r.size) === size && String(r.sku).trim().toUpperCase() !== ex).map(r => ({ r, b: nlBase(r, model.season) })).filter(x => x.b != null);
  const sc = model.season[c], cf = model.colour[fam][c], k = `season ${sc.toFixed(2)} × ${fam} ${cf.toFixed(2)}`;
  const mine = pool.filter(x => nlFamilyOf(x.r.color) === fam).map(x => x.b);
  if (mine.length >= 3) { const m = nlMed(mine); return { q: Math.round(m * sc * cf), how: `${m.toFixed(1)} a normal month (median of ${mine.length} ${fam} SKUs of this size) × ${k}` }; }
  const all = pool.map(x => x.b);
  if (all.length >= 3) { const m = nlMed(all); return { q: Math.round(m * sc * cf), how: `${m.toFixed(1)} a normal month (median of ${all.length} SKUs of this size, any colour — under 3 ${fam}) × ${k}` }; }
  if (tpl) return { q: Math.round(tpl * sc * cf), how: `template ${tpl} × ${k}` };
  return { q: 0, how: 'no sales of this size and no template' };
}

async function nlLoadTpl() {
  if (NL_TPL) return NL_TPL;
  NL_TPL = JSON.parse(JSON.stringify(NL_DEFAULT_TPL));
  try { const s = await getDoc(doc(db, 'repl', 'launchtpl')); if (s.exists() && s.data().map) Object.assign(NL_TPL, s.data().map); } catch (e) { /* the default stands */ }
  return NL_TPL;
}

function nlMonths() {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return { i, y: d.getFullYear(), m: d.getMonth(), key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
      label: MON_ABBR[d.getMonth()].charAt(0).toUpperCase() + MON_ABBR[d.getMonth()].slice(1) + " '" + String(d.getFullYear()).slice(2) }; });
}

function nlPlan() {
  const model = nlArticleModel(NL.brand, NL.art), tpl = (NL_TPL || {})[NL.art] || {};
  const sizes = [...new Set(Object.keys(tpl).concat(model.rows.map(r => nlSize(r.size)).filter(Boolean)))]
    .sort((a, b) => (tpl[b] || 0) - (tpl[a] || 0) || a.localeCompare(b, undefined, { numeric: true }));
  const months = nlMonths().slice(NL.start, NL.start + NL.cover);
  const known = new Set((PTG.mdb || []).map(r => obUC(r.sku)));
  const lines = sizes.map(size => {
    const per = months.map(mo => nlQty(model, size, NL.fam, mo.m, tpl[size]));
    const sku = obUC(NL.skus[size] != null ? NL.skus[size] : (NL.base ? NL.base + '-' + nlSizeCode(size) : ''));
    return { size, tpl: tpl[size] || 0, per, order: per.reduce((a, x) => a + x.q, 0), sku, inMaster: !!sku && known.has(sku) };
  });
  return { model, months, lines };
}

function nlDraw() {
  const box = document.getElementById('nlBox'); if (!box) return;
  const arts = [...new Set(Object.values(REPL).flatMap(b => (b && b.rows) || []).map(r => String(r.subcat || '').trim()).filter(Boolean))].sort();
  if (!NL.art) NL.art = arts.includes('Piping Flap Pillow Cover') ? 'Piping Flap Pillow Cover' : arts[0] || '';
  const P = nlPlan(), mo = nlMonths(), tot = P.lines.reduce((a, l) => a + (l.sku ? l.order : 0), 0);
  const famRow = NL_FAMILIES.map(([f]) => `<option${f === NL.fam ? ' selected' : ''}>${esc(f)}</option>`).join('');
  box.querySelector('.nl-body').innerHTML = `
    <div class="nl-grid">
      <label>Brand<select data-nl="brand">${Object.keys(REPL).filter(b => (REPL[b] || {}).rows).map(b => `<option${b === NL.brand ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select></label>
      <label>Article<select data-nl="art">${arts.map(a => `<option${a === NL.art ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      <label>New colour<input data-nl="colour" value="${esc(NL.colour)}" placeholder="e.g. Ocean Blue"></label>
      <label>Colour family<select data-nl="fam">${famRow}</select></label>
      <label>SKU base (size is added)<input data-nl="base" value="${esc(NL.base)}" placeholder="e.g. RPC81"></label>
      <label>Goes live<select data-nl="start">${mo.map(x => `<option value="${x.i}"${x.i === NL.start ? ' selected' : ''}>${x.label}</option>`).join('')}</select></label>
      <label>First order covers<select data-nl="cover">${[1, 2, 3].map(n => `<option value="${n}"${n === NL.cover ? ' selected' : ''}>${n} month${n > 1 ? 's' : ''}</option>`).join('')}</select></label>
    </div>
    <table class="nl-tbl"><thead><tr><th>Size</th><th>SKU</th><th>Template (a month)</th>${P.months.map(m => `<th>${m.label}</th>`).join('')}<th>Order</th></tr></thead><tbody>
    ${P.lines.map(l => `<tr><td><b>${esc(l.size)}</b></td>
      <td><input data-nlsku="${esc(l.size)}" value="${esc(l.sku)}" style="width:130px${l.sku && !l.inMaster ? ';border-color:#b91c1c;color:#b91c1c' : ''}" title="${l.sku && !l.inMaster ? 'Not in the master database yet — left out of the order' : ''}"></td>
      <td><input data-nltpl="${esc(l.size)}" type="number" min="0" value="${l.tpl || ''}" style="width:70px"></td>
      ${l.per.map(x => `<td title="${esc(x.how)}">${nf(x.q)}<div class="seatag">${x.how.startsWith('template') ? 'template' : x.how.includes('any colour') ? 'size × colour' : x.how.includes('normal month') ? 'velocity' : '—'}</div></td>`).join('')}
      <td><b>${nf(l.order)}</b></td></tr>`).join('')}
    <tr class="nl-tot"><td colspan="${3 + P.months.length}">Order — SKUs in the master</td><td><b>${nf(P.lines.reduce((a, l) => a + (l.inMaster ? l.order : 0), 0))}</b></td></tr>
    </tbody></table>
    <div class="muted" style="font-size:12px;margin-top:6px">Each month = a ${esc(NL.fam)} ${esc(NL.art)} SKU of that size in a normal month (median, launch month left out) × the article's season × the ${esc(NL.fam)} factor (hover a number for how it was found) · ${esc(NL.fam)} factor by month: ${mo.slice(NL.start, NL.start + NL.cover).map(m => m.label + ' ×' + P.model.colour[NL.fam][m.m].toFixed(2)).join(', ')} · ${nf(P.model.rows.length)} ${esc(NL.art)} SKUs with history</div>
    <div id="nlMsg" class="muted" style="font-size:12.5px;margin-top:6px">${tot ? '' : 'Type a SKU base (or each SKU) to make the order.'}</div>`;
}

async function nlOpen() {
  await nlLoadTpl();
  if (!NL.brand) NL.brand = ['SP', 'CPC'].find(b => (REPL[b] || {}).rows) || Object.keys(REPL)[0] || '';
  let box = document.getElementById('nlBox');
  if (!box) {
    box = document.createElement('div'); box.id = 'nlBox'; box.className = 'modal';
    box.innerHTML = `<style>
      #nlBox .modalbox{width:min(1000px,100%);max-height:calc(100vh - 40px);overflow:auto}
      #nlBox .nl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:12px}
      #nlBox .nl-grid label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600}
      #nlBox .nl-tbl{width:100%;border-collapse:collapse;font-size:14px}#nlBox .nl-tbl th{font-size:12px;color:#5B6475;text-align:left;padding:6px;border-bottom:2px solid #E4E7EC}
      #nlBox .nl-tbl td{padding:6px;border-bottom:1px solid #F1F3F6;vertical-align:top}#nlBox .nl-tot td{background:#F7F8FA}
      </style><div class="modalbox"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="font-size:17px">New launch — size set for a new colour</b>
      <button type="button" class="ghost" data-nlact="x">Close</button></div><div class="nl-body"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px">
        <button type="button" class="ghost" data-nlact="tpl">Save template</button>
        <button type="button" class="ghost" data-nlact="xl">Download order (Sales Order upload)</button>
        <button type="button" class="ghost" data-nlact="proj">Put on Proj (✎)</button>
        <button type="button" data-nlact="so">Make Sales Order draft</button></div></div>`;
    document.body.appendChild(box);
    box.addEventListener('change', e => {
      const t = e.target, k = t.getAttribute('data-nl');
      if (k) { NL[k] = k === 'start' || k === 'cover' ? +t.value : t.value;
        if (k === 'colour') { NL.fam = nlFamilyOf(t.value); }
        if (k === 'base' || k === 'art') NL.skus = {};
        return nlDraw(); }
      if (t.hasAttribute('data-nlsku')) { NL.skus[t.getAttribute('data-nlsku')] = t.value; return nlDraw(); }
      if (t.hasAttribute('data-nltpl')) { const s = t.getAttribute('data-nltpl'), v = Math.max(0, Math.round(+t.value || 0));
        (NL_TPL[NL.art] = NL_TPL[NL.art] || {})[s] = v; return nlDraw(); }
    });
    box.addEventListener('click', e => { const b = e.target.closest('[data-nlact]'); if (b) nlAct(b.getAttribute('data-nlact')); });
  }
  box.classList.remove('hide'); box.style.display = '';
  nlDraw();
}

function nlSay(m, bad) { const x = document.getElementById('nlMsg'); if (x) { x.className = bad ? 'err' : 'muted'; x.textContent = m; } }

async function nlAct(k) {
  if (k === 'x') { const b = document.getElementById('nlBox'); if (b) b.style.display = 'none'; return; }
  const P = nlPlan(), ok = P.lines.filter(l => l.inMaster && l.order > 0), out = P.lines.filter(l => l.order > 0 && !l.inMaster);
  const launch = nlMonths()[NL.start], firstOf = launch.y + '-' + String(launch.m + 1).padStart(2, '0') + '-01';
  const dmy = iso => iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4), today = new Date().toISOString().slice(0, 10);
  if (k === 'tpl') {
    try { await setDoc(doc(db, 'repl', 'launchtpl'), { map: { [NL.art]: NL_TPL[NL.art] || {} }, by: ME.email, at: serverTimestamp() }, { merge: true }); nlSay('Template saved for ' + NL.art + '.'); }
    catch (e) { nlSay('Not saved: ' + (e.message || e), true); }
    return;
  }
  if (!ok.length) return nlSay('No size has a SKU that is in the master database yet' + (out.length ? ' (' + out.map(l => l.sku || l.size).join(', ') + ')' : '') + '.', true);
  const skipped = out.length ? ' Left out (not in the master): ' + out.map(l => l.sku || l.size).join(', ') + '.' : '';
  if (k === 'xl') {
    ptDownload('new-launch-' + (NL.base || 'order'), [['SKU', 'Qty', 'Priority', 'Order Type', 'Order Date', 'Delivery Date', 'Legacy Order ID'].map(csvCell).join(',')]
      .concat(ok.map(l => [l.sku, l.order, '', 'New Development', dmy(today), dmy(firstOf), ''].map(csvCell).join(','))));
    return nlSay('Downloaded ' + ok.length + ' line(s): Sales Orders → Raise → upload this file.' + skipped);
  }
  if (k === 'proj') {
    if (!ME.projEdit) return nlSay('You do not have "Edit projections".', true);
    const patch = {};
    ok.forEach(l => P.months.forEach((m, i) => { const key = l.sku + '|' + m.key; patch[key] = l.per[i].q; PROJ_OVR[key] = l.per[i].q; }));
    PROJ_VER++;
    try { await setDoc(doc(db, 'repl', 'projoverride'), { map: patch, by: ME.email, at: serverTimestamp() }, { merge: true }); }
    catch (e) { return nlSay('Not saved: ' + (e.message || e), true); }
    renderRepl();
    return nlSay('Proj typed for ' + ok.length + ' SKU(s), ' + P.months.map(m => m.label).join(' + ') + ' — they show ✎ in the table.' + skipped);
  }
  if (k === 'so') {
    if (typeof soFormOpen !== 'function') return nlSay('Sales Orders is not open to this account — use Download instead.', true);
    const b = document.getElementById('nlBox'); if (b) b.style.display = 'none';
    soFormOpen('');
    const ch = $('sof_channel'); if (ch) { ch.value = 'AMZ'; ch.dispatchEvent(new Event('change', { bubbles: true })); }
    SOF.lines = ok.map(l => ({ sku: l.sku, qty: l.order, deliveryDate: firstOf, orderTypeKey: 'newdev', priority: '' }));
    SOF.page = 0; soFormLines(); soIdPreview();
    ptDlgMsg('New launch: ' + ok.length + ' line(s) loaded — check AIR / SEA and the dates, then save. Nothing is saved yet.' + skipped);
  }
}
$('rNewLaunch').onclick = () => nlOpen();
