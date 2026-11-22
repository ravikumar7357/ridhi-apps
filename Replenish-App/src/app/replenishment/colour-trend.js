/* ================= COLOUR TREND (Replenishment & planning → Colour Trend) =================
 *
 * Ravi, 22 Nov: "ye bucket chahiye and iska alag bucket hona chahiye and sellora me sales trend h wo bhi replenish me show hona
 * chahiye and new launch projection auto adjust hona chahiye based on same color trend in article and size in projected month".
 * One screen, three parts, all from the snapshot rows' lym (units per calendar month, last 12 complete months):
 *   1. colour family × month factor for an article (+ the article's season), the model the New launch dialog uses;
 *   2. units by size × month;
 *   3. every SKU's month-by-month sales, newest month first, shaded along the row — Sellora's Sales Analysis table.
 * Who sees it: anyone with Replenishment (core/auth.js adds 'ctrend' to their tabs). It reads nothing new.
 *
 * AUTO PROJ FOR A NEW SKU (core/multi-select-filter.js replForecast → nlAutoOf): a SKU that first sold in the last two complete
 * months, or not at all yet, and has stock or sales now, is projected from what SKUs of the same article + size + colour family
 * sold in that calendar month last year (nlQty). When its own Avg/day already says more, its own figure stands. */
let CT = { brand: '', art: '', fam: '', q: '' };
const ctMonthsDesc = () => { const cur = new Date().getMonth(), now = new Date();
  return Array.from({ length: 12 }, (_, k) => { const d = new Date(now.getFullYear(), now.getMonth() - 1 - k, 1);
    return { c: d.getMonth(), label: MON_ABBR[d.getMonth()].charAt(0).toUpperCase() + MON_ABBR[d.getMonth()].slice(1) + " '" + String(d.getFullYear()).slice(2) }; }); };

function ctCell(v) {
  const hi = v >= 1.1, lo = v <= 0.9;
  const bg = hi ? (v >= 1.3 ? '#1f4fbf' : '#cfdcfa') : lo ? (v <= 0.6 ? '#e88a2b' : '#fbe3c7') : '#f4f6fa';
  return `<td style="text-align:center;background:${bg};color:${hi && v >= 1.3 ? '#fff' : '#17202B'};font-weight:${hi || lo ? 700 : 400}">${v.toFixed(2)}</td>`;
}

async function renderCtrend() {
  await nlLoadTpl();
  const box = $('ctBody'); if (!box) return;
  const brands = Object.keys(REPL).filter(b => (REPL[b] || {}).rows);
  if (!brands.length) { box.innerHTML = '<div class="muted">Replenishment data is still loading…</div>'; return; }
  if (!CT.brand || !brands.includes(CT.brand)) CT.brand = brands.includes('SP') ? 'SP' : brands[0];
  const rows = REPL[CT.brand].rows || [];
  const arts = [...new Set(rows.filter(r => Array.isArray(r.lym)).map(r => String(r.subcat || '').trim()).filter(Boolean))].sort();
  if (!CT.art || !arts.includes(CT.art)) CT.art = arts.includes('Piping Flap Pillow Cover') ? 'Piping Flap Pillow Cover' : arts[0] || '';
  const M = nlArticleModel(CT.brand, CT.art), months = ctMonthsDesc().slice().reverse();     // oldest → newest for the trend tables
  const famUnits = {}, famSkus = {};
  M.rows.forEach(r => { const f = nlFamilyOf(r.color); famUnits[f] = (famUnits[f] || 0) + r.lym.reduce((a, b) => a + (Number(b) || 0), 0); famSkus[f] = (famSkus[f] || 0) + 1; });
  const sizes = [...new Set(M.rows.map(r => nlSize(r.size)).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const bySize = s => months.map(m => M.rows.filter(r => nlSize(r.size) === s).reduce((a, r) => a + (Number(r.lym[m.c]) || 0), 0));
  const sizeTot = sizes.map(s => bySize(s).reduce((a, b) => a + b, 0)), allTot = sizeTot.reduce((a, b) => a + b, 0) || 1;
  const head = '<tr><th>Colour family</th>' + months.map(m => `<th>${m.label}</th>`).join('') + '<th>Units</th><th>SKUs</th></tr>';
  const famRows = NL_FAMILIES.map(([f]) => f).filter(f => famUnits[f])
    .map(f => `<tr><td><b>${esc(f)}</b></td>${months.map(m => ctCell(M.colour[f][m.c])).join('')}<td>${nf(famUnits[f])}</td><td>${nf(famSkus[f])}</td></tr>`).join('');
  /* 3 · every SKU of the article (or all), newest month first, shaded along its own row */
  const desc = ctMonthsDesc(), q = CT.q.trim().toUpperCase();
  const skuRows = rows.filter(r => r && Array.isArray(r.lym) && (!CT.art || String(r.subcat || '').trim() === CT.art)
      && (!CT.fam || nlFamilyOf(r.color) === CT.fam) && (!q || (String(r.sku) + ' ' + (r.color || '')).toUpperCase().includes(q)))
    .map(r => ({ r, tot: r.lym.reduce((a, b) => a + (Number(b) || 0), 0) })).sort((a, b) => b.tot - a.tot).slice(0, 300);
  /* EACH MONTH AGAINST THE SKU'S OWN AVERAGE MONTH (Ravi, 22 Nov: "achcha sale green, average sale yellow, average se kam amber,
   * kharab sale red"). The average is over the months since its first sale; a month before it was selling has no colour.
   *   green ≥ 1.25 × average · yellow 0.85–1.25 · amber 0.5–0.85 · red under 0.5 (a 0 after launch is red) */
  const shade = (v, avg, live) => { if (!live || !(avg > 0)) return ''; const t = v / avg;
    return t >= 1.25 ? 'background:#15803d;color:#fff' : t >= 0.85 ? 'background:#fde68a' : t >= 0.5 ? 'background:#fdba74' : 'background:#b91c1c;color:#fff'; };
  box.innerHTML = `
    <div class="toolbar">
      <select id="ctBrand" style="flex:0 0 130px">${brands.map(b => `<option value="${esc(b)}"${b === CT.brand ? ' selected' : ''}>${b === 'SP' ? 'Ridhi' : esc(b)}</option>`).join('')}</select>
      <select id="ctArt" style="flex:0 0 260px">${arts.map(a => `<option${a === CT.art ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <span class="muted" style="font-size:12px">${nf(M.rows.length)} SKUs with sales history · ${nf(M.yr)} units in the last 12 months · MCF and cancelled left out</span>
    </div>
    <div class="muted" style="font-size:12.5px;margin:6px 0 8px"><b>Colour factor</b> = the family's units per selling SKU that month against the whole article's, over the same ratio for the year (×1.20 = sells 20% above its usual share). A colour counts only from the month it first sold. A family under 300 units a year = ×1.</div>
    <div style="overflow-x:auto"><table class="ct-tbl"><thead>${head}</thead><tbody>
      <tr><td><b>Season (whole article)</b></td>${months.map(m => ctCell(M.season[m.c])).join('')}<td>${nf(M.yr)}</td><td>${nf(M.rows.length)}</td></tr>${famRows}</tbody></table></div>
    <div class="sec" style="margin-top:14px">Units by size</div>
    <div style="overflow-x:auto"><table class="ct-tbl"><thead><tr><th>Size</th>${months.map(m => `<th>${m.label}</th>`).join('')}<th>Units</th><th>Share</th><th>Template</th></tr></thead><tbody>
      ${sizes.map((s, i) => `<tr><td><b>${esc(s)}</b></td>${bySize(s).map(v => `<td>${nf(v)}</td>`).join('')}<td>${nf(sizeTot[i])}</td><td>${Math.round(sizeTot[i] / allTot * 100)}%</td><td>${nf(((NL_TPL || {})[CT.art] || {})[s] || 0) || '—'}</td></tr>`).join('')}</tbody></table></div>
    <div class="sec" style="margin-top:14px">Sales by SKU, month by month</div>
    <div class="toolbar">
      <select id="ctFam" style="flex:0 0 180px"><option value="">Every colour</option>${NL_FAMILIES.map(([f]) => `<option${f === CT.fam ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select>
      <input id="ctQ" value="${esc(CT.q)}" placeholder="Filter SKU / colour" style="flex:1 1 180px">
    </div>
    <div style="overflow-x:auto;max-height:560px"><table class="ct-tbl"><thead><tr><th>SKU</th><th>Colour</th><th>Size</th><th>L30</th>${desc.map(m => `<th>${m.label}</th>`).join('')}<th>12 months</th></tr></thead><tbody>
      ${skuRows.map(({ r, tot }) => { const v = desc.map(m => Number(r.lym[m.c]) || 0);
        let L = -1; v.forEach((x, i) => { if (x > 0) L = i; });                 // the oldest month it sold in (desc order)
        const avg = L >= 0 ? v.slice(0, L + 1).reduce((a, b) => a + b, 0) / (L + 1) : 0;
        return `<tr><td>${esc(r.sku)}</td><td>${esc(r.color || '')}</td><td>${esc(r.size || '')}</td><td>${nf(r.last30 || 0)}</td>${v.map((x, i) => `<td style="${shade(x, avg, i <= L)}">${x ? nf(x) : (i <= L ? '0' : '<span class="muted">0</span>')}</td>`).join('')}<td><b>${nf(tot)}</b></td></tr>`; }).join('')
        || `<tr><td colspan="${5 + desc.length}" class="muted">No SKU with sales history matches.</td></tr>`}</tbody></table></div>
    <div class="muted" style="font-size:12px;margin-top:6px">Each month against the SKU's own average month since it first sold: <span style="background:#15803d;color:#fff;padding:0 6px;border-radius:3px">good</span> 1.25× or more · <span style="background:#fde68a;padding:0 6px;border-radius:3px">average</span> 0.85–1.25× · <span style="background:#fdba74;padding:0 6px;border-radius:3px">below average</span> 0.5–0.85× · <span style="background:#b91c1c;color:#fff;padding:0 6px;border-radius:3px">bad</span> under 0.5× · no colour = before it first sold.<br>${skuRows.length === 300 ? 'First 300 by units. ' : ''}L30 = the last 30 days; the months are whole calendar months (Amazon orders).</div>`;
}

document.addEventListener('change', e => {
  const t = e.target; if (!t || !t.id || !/^ct(Brand|Art|Fam)$/.test(t.id)) return;
  CT[{ ctBrand: 'brand', ctArt: 'art', ctFam: 'fam' }[t.id]] = t.value; renderCtrend();
});
document.addEventListener('input', e => {
  const t = e.target; if (!t || t.id !== 'ctQ') return;
  CT.q = t.value; clearTimeout(CT._t); CT._t = setTimeout(() => { renderCtrend().then(() => { const i = $('ctQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 300);
});

/* ---- the new-SKU projection used by replForecast ---- */
const NL_AUTO = { sig: '', brandOf: new Map(), models: new Map(), baseFirst: new Map() };
const nlBaseOf = sku => { const s = String(sku || '').trim().toUpperCase(), i = s.lastIndexOf('-'); return i > 0 ? s.slice(0, i) : s; };
function nlAutoPrep() {
  if (!NL_TPL && !NL_AUTO.loading) { NL_AUTO.loading = true; nlLoadTpl().then(() => { if (typeof TAB_NOW !== 'undefined' && TAB_NOW === 'repl') renderRepl(); }); }
  const sig = Object.keys(REPL).map(b => b + ':' + (((REPL[b] || {}).rows) || []).length + ':' + ((REPL[b] || {}).at ? REPL[b].at.getTime() : 0)).join(',') + '|' + (NL_TPL ? 1 : 0);
  if (sig === NL_AUTO.sig) return;
  NL_AUTO.sig = sig; NL_AUTO.models = new Map(); NL_AUTO.brandOf = new Map(); NL_AUTO.baseFirst = new Map();
  Object.keys(REPL).forEach(b => (((REPL[b] || {}).rows) || []).forEach(r => {
    if (!r || !r.sku) return;
    NL_AUTO.brandOf.set(String(r.sku).trim().toUpperCase(), b);
    const k = b + '|' + nlBaseOf(r.sku), f = Array.isArray(r.lym) ? nlFirst(r.lym) : 12;
    NL_AUTO.baseFirst.set(k, Math.min(NL_AUTO.baseFirst.has(k) ? NL_AUTO.baseFirst.get(k) : 12, f));
  }));
}
/** A SKU still in its launch, stocked or selling now:
 *   - it first sold in the last two complete months; or
 *   - it has not sold yet, and the other sizes of its colour (same SKU base, e.g. RPC232-) first sold in the last two months,
 *     or none of them has sold yet and stock is on the way.
 * An old SKU that simply has not sold for a year (dead stock) is NOT new: its colour sold long ago. */
function nlIsNew(r, b) {
  if (!r || !r.subcat || !r.size) return false;
  const first = Array.isArray(r.lym) ? nlFirst(r.lym) : 12;
  if (first < 10) return false;
  const here = (r.totalStock || 0) > 0 || (r.inbReceiving || 0) > 0 || (r.awdAvail || 0) > 0 || (r.awdTransit || 0) > 0 || (r.last30 || 0) > 0;
  if (!here) return false;
  if (first < 12) return true;
  const bf = NL_AUTO.baseFirst.get((b || '') + '|' + nlBaseOf(r.sku));
  if (bf != null && bf >= 10 && bf < 12) return true;
  return (bf == null || bf === 12) && ((r.inbReceiving || 0) > 0 || (r.awdTransit || 0) > 0 || (r.last30 || 0) > 0);
}
/** { q, how, fam } for this new SKU in plan month p (the running month counts the days left), or null */
function nlAutoOf(r, p) {
  nlAutoPrep();
  const b = NL_AUTO.brandOf.get(String(r.sku).trim().toUpperCase()); if (!b) return null;
  if (!nlIsNew(r, b)) return null;
  const art = String(r.subcat).trim(), key = b + '|' + art;
  let M = NL_AUTO.models.get(key); if (!M) { M = nlArticleModel(b, art); NL_AUTO.models.set(key, M); }
  if (!M.rows.length) return null;
  const fam = nlFamilyOf(r.color), x = nlQty(M, nlSize(r.size), fam, p.m, ((NL_TPL || {})[art] || {})[nlSize(r.size)]);
  if (!x.q) return null;
  const q = p.partial && p.dim ? Math.round(x.q * p.days / p.dim) : x.q;
  return { q, how: x.how, fam };
}
