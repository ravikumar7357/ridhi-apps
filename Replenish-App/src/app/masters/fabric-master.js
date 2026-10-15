/* ================= MASTER DATA · GREIGE & RFD FABRIC, ALL PRODUCTS, VENDORS =================
 * Ravi, 15 Oct 2026: "this is the format of our masterdata, allign it in our app … don't change the current data … use
 * this format for our data and implement in our masterdata". The format is his Greige Fabric Master page
 * (claude.ai/artifact/JvDyxMsfJGzS9VKJuCUiA6). Asked, he said: only Setup / Master Data changes (recipes and the rest
 * stay as they are), bring the page's fabric and vendor details in as they are, and PPC is not touched.
 *
 *   pt_masters/greigeRfd/<gNN>  = { order, rfd, greige, count, constr, gw, rw, gsm, hsn, gr, rr, fabrics:[app fabric names] }
 *                                 plus _others: [fabric names shown as "Other fabrics"]. Imported from the page on 15 Oct.
 *   pt_masters/vendorBook/<vNN> = { order, name, type: greige|rfd|quilt|cut|run, work, contact, phone, city, state,
 *                                   address, pincode, gstin, pan, reg, tds, note }. Imported from the page on 15 Oct.
 *
 * The products are the Master Database's own SKUs (PTG.mdb), read as they are: a SKU sits under the fabric whose
 * `fabrics` list holds its fabric. Cutting, zip, ruffle, piping and filler are read through recipeValue (the SKU wins,
 * else its recipe) and never written. Only an admin edits the two new lists — the database allows pt_masters/<list>
 * to admins alone — and the old Master Database table is one click away, unchanged. */
/* 15 Oct, second pass (Ravi): "masterdata me all product required nahi h" — All products is gone; the fabric list and the
 * Master database table sit side by side and open each other (a fabric's app fabric, a SKU), and the Greige Desk reads
 * its fabrics and vendors from here (tools/greige-desk/app-layer.js gdLinkMasters). */
const FM_VIEWS = [['fabric', 'Greige & RFD fabric'], ['table', 'Master database'], ['vendors', 'Vendors']];
const FM_VTYPES = { greige: 'Greige vendor', rfd: 'RFD vendor', quilt: 'Quilt filling vendor', cut: 'Cutting job-worker', run: 'Runner job-worker' };
const FM_FEAT = [['count', 'Count'], ['constr', 'Construction'], ['gw', 'Greige width (in)', 1], ['rw', 'RFD width (in)', 1], ['gsm', 'GSM'],
  ['hsn', 'HSN code'], ['gr', 'Greige rate (₹/m)', 1], ['rr', 'RFD rate (₹/m)', 1]];
const FM_VCOLS = [['contact', 'Contact person'], ['phone', 'Phone'], ['city', 'City'], ['gstin', 'GSTIN'], ['pan', 'PAN'], ['address', 'Address'],
  ['pincode', 'Pincode'], ['reg', 'Registration type'], ['tds', 'TDS']];
const FM_FLT = [['proc', 'Cutting / Runner / Both', ['Cutting', 'Runner', 'Both']], ['cut', 'Cutting required'], ['zip', 'Zip'], ['ruf', 'Ruffle'],
  ['pip', 'Piping dori'], ['fil', 'Filler fabric'], ['emb', 'Embroidery'], ['pack', 'Pack of', null]];
const FM = { view: null, open: new Set(), allSku: new Set(), q: '', flt: {}, seg: 'all', vOpen: new Set(['greige', 'rfd', 'quilt', 'cut', 'run']), cache: null };
FM.view = (() => { try { const v = localStorage.getItem('fmView'); return FM_VIEWS.some(x => x[0] === v) ? v : 'fabric'; } catch (e) { return 'fabric'; } })();

const fmYN = v => (v === true || /^(y|yes|true|1)$/i.test(String(v == null ? '' : v).trim()) ? 'Yes' : 'No');
const fmNum = v => { const n = +v; return v === '' || v == null || !isFinite(n) || n === 0 ? '' : String(Math.round(n * 1000) / 1000); };
const fmKey = s => String(s || '').trim().toLowerCase();
const fmAdmin = () => !!(ME && ME.admin);
/** One of the two new lists, in its own order; the "_" keys are notes, not rows. */
const fmList = key => Object.entries(((PTG.masters || {})[key]) || {})
  .filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object').map(([id, v]) => Object.assign({ id }, v))
  .sort((a, b) => (+a.order || 999) - (+b.order || 999) || String(a.id).localeCompare(String(b.id)));
const fmOthers = () => { const o = ((PTG.masters || {}).greigeRfd || {})._others; return Array.isArray(o) ? o : ptList(o); };

/** A SKU of the Master Database, in the page's terms. Cached on the SKU list and the recipes. */
function fmProducts() {
  const mdb = PTG.mdb || [], rec = (PTG.masters || {}).recipe || null, fab = (PTG.masters || {}).greigeRfd || null;
  if (FM.cache && FM.cache.mdb === mdb && FM.cache.rec === rec && FM.cache.fab === fab) return FM.cache.rows;
  const byName = new Map();
  fmList('greigeRfd').forEach(f => (Array.isArray(f.fabrics) ? f.fabrics : ptList(f.fabrics)).forEach(n => byName.set(fmKey(n), f.id)));
  fmOthers().forEach(n => { if (!byName.has(fmKey(n))) byName.set(fmKey(n), 'O:' + n); });
  const rv = (m, k) => { try { return recipeValue(m, k); } catch (e) { return m[k]; } };
  const rows = mdb.filter(m => m && m.sku).map(m => {
    const p = { sku: String(m.sku), art: m.articleType || '', sub: m.subtype || '', size: m.size || '', col: m.color || '', brand: m.brand || '',
      fabName: String(rv(m, 'fabric') || m.fabric || '').trim(), cons: fmNum(rv(m, 'consumption')), pack: String(rv(m, 'packOf') || '').trim(),
      cut: fmYN(rv(m, 'cuttingRequired')), zip: fmYN(rv(m, 'isZip')), zipQty: fmNum(rv(m, 'zipQty')), zipSize: fmNum(rv(m, 'chainLength')),
      ruf: fmYN(rv(m, 'isRuffle')), rufM: fmNum(rv(m, 'ruffleMeters')), rufF: String(rv(m, 'ruffleFabric') || '').trim(),
      pip: fmYN(rv(m, 'isPiping')), pipM: fmNum(rv(m, 'pipingMeters')), fil: fmYN(rv(m, 'fillerFabricRequired')) };
    p.fab = byName.get(fmKey(p.fabName)) || '';
    p.proc = p.cut === 'Yes' ? 'Cutting' : (p.ruf === 'Yes' ? 'Both' : 'Runner');
    p.emb = /embroid/i.test(p.art + ' ' + p.sub) ? 'Yes' : 'No';
    p.hay = [p.sku, p.art, p.sub, p.col, p.size, p.fabName].join(' ').toLowerCase();
    return p;
  });
  FM.cache = { mdb, rec, fab, rows };
  return rows;
}
const fmFltOn = () => Object.values(FM.flt).some(Boolean);
const fmPass = p => FM_FLT.every(([k]) => !FM.flt[k] || p[k] === FM.flt[k]);
const fmFabLabel = id => { if (!id) return ''; if (id.startsWith('O:')) return id.slice(2);
  const f = fmList('greigeRfd').find(x => x.id === id); return f ? (f.rfd || f.greige) : id; };

/* ---- the page: the switch on top, then the view ---- */
function fmSetView(v) {
  FM.view = v; try { localStorage.setItem('fmView', v); } catch (e) { /* remembered for this visit only */ }
  fmRender();
  if (v === 'table' && typeof renderPmdb === 'function') renderPmdb();
}
function fmRender() {
  const pane = $('panePmdb'), root = $('fmRoot'), nav = $('fmNav');
  if (!pane || !root || !nav) return;
  nav.innerHTML = FM_VIEWS.map(([k, l]) => `<button type="button" data-fmview="${k}" aria-current="${k === FM.view ? 'page' : 'false'}">${esc(l)}</button>`).join('');
  [...(pane.children || [])].forEach(c => { if (c !== nav && c !== root && c.style) c.style.display = FM.view === 'table' ? '' : 'none'; });
  root.classList.toggle('hide', FM.view === 'table');
  if (FM.view === 'table') return;
  if (!PTG.mdb) { root.innerHTML = '<div class="card fm-card"><div class="fm-empty">Reading the master data…</div></div>'; return; }
  root.innerHTML = FM.view === 'fabric' ? fmFabricHtml() : fmVendorsHtml();
}
const fmHead = (crumb, title, sub, btns, count) => `<div class="card fm-card fm-head"><div class="fm-crumb">${esc(crumb)}</div>
  <div class="fm-title"><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div><div class="fm-hbtns">${btns}<span class="fm-count">${count}</span></div></div></div>`;
const FM_SEARCH_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
const FM_CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const fmSearch = ph => `<label class="fm-search">${FM_SEARCH_ICON}<input id="fmQ" type="search" value="${esc(FM.q)}" placeholder="${esc(ph)}" aria-label="${esc(ph)}"></label>`;
function fmFilterBar(all, extra) {
  const packs = [...new Set(all.map(p => p.pack).filter(Boolean))].sort((a, b) => (+a || 0) - (+b || 0) || a.localeCompare(b));
  return `<div class="fm-fbar">${FM_FLT.map(([k, l, opts]) => { const o = opts === null ? packs : (opts || ['Yes', 'No']);
    return `<label class="fm-fsel"><span>${esc(l)}</span><select data-fmflt="${k}" class="${FM.flt[k] ? 'on' : ''}"><option value="">All</option>${o.map(v =>
      `<option${FM.flt[k] === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`; }).join('')}${extra || ''}
    ${fmFltOn() ? '<button type="button" class="ghost fm-sm" data-fmclear="1">Clear filters</button>' : ''}</div>`;
}
/** The Greige Desk reads this page's fabrics and vendors; the way over, for those who may open it. */
const fmGdBtn = () => (typeof gdAllowed === 'function' && gdAllowed() && typeof GD !== 'undefined'
  ? '<button type="button" class="ghost fm-sm" data-fmgd="1" title="The Greige Desk uses these fabrics and vendors">Open Greige Desk</button>' : '');
/** Over to the Master database table, searched for a SKU or a fabric. */
function fmToTable(q) {
  fmSetView('table');
  if ($('ptmView') && $('ptmView').value !== 'master') $('ptmView').value = 'master';
  if ($('ptmQ')) $('ptmQ').value = q;
  if (typeof renderPmdb === 'function') renderPmdb();
}
const fmCell = (list, id, k, v, num) => (fmAdmin()
  ? `<td class="fm-fc fm-ed${num ? ' num r' : ''}" tabindex="0" data-fmed="${list}|${esc(id)}|${k}" title="Click to change">${v === '' || v == null ? '<span class="fm-add">add</span>' : esc(v)}</td>`
  : `<td class="fm-fc${num ? ' num r' : ''}">${v === '' || v == null ? '<span class="muted">—</span>' : esc(v)}</td>`);

/* ---- Greige & RFD fabric: one row per RFD fabric (its greige under it), its products when opened ---- */
function fmFabricHtml() {
  const all = fmProducts(), q = fmKey(FM.q), fabs = fmList('greigeRfd');
  const shown = all.filter(fmPass);
  const groups = new Map();
  shown.forEach(p => { if (!p.fab) return; const g = groups.get(p.fab) || []; g.push(p); groups.set(p.fab, g); });
  const nameHit = f => !!q && fmKey([f.rfd, f.greige].join(' ')).includes(q);
  const prodsOf = (f, ps) => (!q || nameHit(f) ? ps : ps.filter(p => p.hay.includes(q)));
  const rowsF = fabs.map(f => ({ f, ps: prodsOf(f, groups.get(f.id) || []) })).filter(x => !(q || fmFltOn()) || x.ps.length || nameHit(x.f));
  const others = fmOthers().map(n => ({ name: n, id: 'O:' + n, ps: (groups.get('O:' + n) || []).filter(p => !q || p.hay.includes(q) || fmKey(n).includes(q)) }))
    .filter(x => x.ps.length || !(q || fmFltOn()));
  const loose = all.filter(p => !p.fab).length;
  const cols = 4 + FM_FEAT.length;
  const det = (key, ps) => {
    if (!FM.open.has(key)) return '';
    if (!ps.length) return `<tr class="fm-det"><td colspan="${cols}"><div class="fm-none">No products of the Master Database under this fabric${fmFltOn() || q ? ' with these filters' : ''}.</div></td></tr>`;
    const by = new Map();
    ps.forEach(p => { const k = p.art + '|' + p.sub; const e = by.get(k) || { art: p.art, sub: p.sub, sizes: new Set(), skus: [], proc: { Cutting: 0, Runner: 0, Both: 0 } };
      if (p.size) e.sizes.add(p.size); e.skus.push(p.sku); e.proc[p.proc]++; by.set(k, e); });
    const items = [...by.values()].sort((a, b) => b.skus.length - a.skus.length || a.art.localeCompare(b.art));
    const szKey = x => { const m = String(x).match(/[\d.]+/g); return m ? m.slice(0, 2).map(Number) : [9e9]; };
    const bySize = (a, b) => { const x = szKey(a), y = szKey(b); return (x[0] - y[0]) || ((x[1] || 0) - (y[1] || 0)) || String(a).localeCompare(String(b)); };
    return `<tr class="fm-det"><td colspan="${cols}"><table class="fm-sub"><thead><tr><th>Product (parent)</th><th>Child</th><th>Sizes</th><th>Process</th><th class="r">SKUs</th><th>SKU codes</th></tr></thead><tbody>${
      items.map(e => { const k2 = key + '|' + e.art + '|' + e.sub, all2 = FM.allSku.has(k2), sk = e.skus.sort();
        return `<tr><td class="fm-it">${esc(e.art || '—')}</td><td>${esc(e.sub || '—')}</td><td><div class="fm-sizes">${[...e.sizes].sort(bySize).map(z => `<span>${esc(z)}</span>`).join('')}</div></td>
          <td class="fm-nw">${['Cutting', 'Runner', 'Both'].filter(x => e.proc[x]).map(x => `<span class="fm-pb fm-${x.toLowerCase()}">${x}${e.proc[x] !== sk.length ? ' ' + nf(e.proc[x]) : ''}</span>`).join(' ')}</td>
          <td class="r num">${nf(sk.length)}</td><td class="fm-skcell"><div class="fm-skl${all2 ? ' all' : ''}">${(all2 ? sk : sk.slice(0, 8)).map(s => `<button type="button" class="fm-skc fm-lnk" data-fmtab="${esc(s)}" title="Open ${esc(s)} in the Master database">${esc(s)}</button>`).join('')}</div>${
          sk.length > 8 ? `<button type="button" class="fm-skm" data-fmsk="${esc(k2)}">${all2 ? 'Show fewer' : 'All ' + nf(sk.length) + ' SKUs'}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></td></tr>`;
  };
  const head = `<tr><th class="fm-s1">#</th><th class="fm-s2">RFD fabric <span class="muted">(greige)</span></th>${FM_FEAT.map(([, l, n]) => `<th${n ? ' class="r"' : ''}>${esc(l)}</th>`).join('')}<th>App fabric</th><th class="r">Products</th></tr>`;
  const body = rowsF.map(({ f, ps }, i) => { const open = FM.open.has(f.id), items = new Set(ps.map(p => p.art + '|' + p.sub)).size;
    return `<tr class="fm-main${open ? ' open' : ''}"><td class="fm-sn">${i + 1}</td><td class="fm-name"><button type="button" class="fm-tog" data-fmopen="${esc(f.id)}" aria-expanded="${open}">${FM_CHEV}<span>${
      f.rfd ? `<span class="fm-rfd">${esc(f.rfd)}</span>` : '<span class="fm-norfd">No RFD fabric</span>'}<span class="fm-gr">(${esc(f.greige || '—')})</span></span></button></td>${
      FM_FEAT.map(([k, , n]) => fmCell('greigeRfd', f.id, k, f[k], n)).join('')}<td class="fm-fc fm-small">${(Array.isArray(f.fabrics) ? f.fabrics : ptList(f.fabrics)).map(n => `<button type="button" class="fm-lnk" data-fmtab="${esc(n)}" title="Its SKUs in the Master database">${esc(n)}</button>`).join(', ') || '—'}</td>
      <td class="fm-cnt r"><b>${nf(ps.length)}</b> SKUs · ${nf(items)} items</td></tr>${det(f.id, ps)}`; }).join('')
    + (others.length ? `<tr class="fm-ogh"><td colspan="${cols}">Other fabrics <span class="muted">— on the Master Database, not in the greige list</span></td></tr>` : '')
    + others.map(o => { const open = FM.open.has(o.id);
      return `<tr class="fm-main fm-oth${open ? ' open' : ''}"><td class="fm-sn"></td><td class="fm-name"><button type="button" class="fm-tog" data-fmopen="${esc(o.id)}" aria-expanded="${open}">${FM_CHEV}<span>${esc(o.name)}</span></button></td>
        <td colspan="${FM_FEAT.length + 1}" class="fm-oth-note">Not in the greige list</td><td class="fm-cnt r"><b>${nf(o.ps.length)}</b> SKUs</td></tr>${det(o.id, o.ps)}`; }).join('');
  const nSku = all.filter(p => p.fab).length;
  return fmHead('Master data / Fabric / Greige & RFD fabric', 'Greige & RFD fabric', 'Each RFD fabric with the greige it is made from, shown in brackets. Open a fabric to see its products from the Master Database.',
      fmGdBtn() + (fmAdmin() ? '<button type="button" class="fm-primary" data-fmadd="fabric">+ Add fabric</button>' : ''), `${nf(fabs.length)} fabrics · ${nf(nSku)} SKUs`)
    + `<div class="card fm-card"><div class="fm-tools">${fmSearch('Search fabric, parent, child, SKU or colour')}<span class="fm-grow"></span>
      <button type="button" class="ghost fm-sm" data-fmexp="1">Expand all</button><button type="button" class="ghost fm-sm" data-fmexp="0">Collapse all</button></div>
      ${fmFilterBar(all)}<div class="fm-wrapx"><table class="fm-tab"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${cols}" class="fm-empty">Nothing matches.</td></tr>`}</tbody></table></div>
      <div class="fm-foot"><span>${loose ? `${nf(loose)} SKU(s) have no fabric, or a fabric name that is in neither list — they are in the Master database table.` : 'Every SKU sits under a fabric.'}</span>
      <span>${fmAdmin() ? 'Click a detail to add or change it' : 'Only an admin can change these details'}</span></div></div>`;
}

/* ---- Vendors: by type, each vendor with its Tally details; the app's own vendor code beside it where the names match ---- */
const fmVKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function fmVendorsHtml() {
  const q = fmKey(FM.q), list = fmList('vendorBook');
  /* By its name or its description: VND007 is named 'Alisha Garmnets' and described 'Alisha Garments'. */
  const app = new Map(); ptList((PTG.masters || {}).vendor).forEach(v => { if (v) [v.name, v.desc].forEach(n => { if (n && !app.has(fmVKey(n))) app.set(fmVKey(n), v); }); });
  const appOf = v => app.get(fmVKey(v.name)) || [...app.entries()].find(([k]) => k && (k.startsWith(fmVKey(v.name)) || fmVKey(v.name).startsWith(k)))?.[1] || null;
  const hit = v => !q || fmKey(Object.values(v).join(' ')).includes(q);
  const seg = [['all', 'All']].concat(Object.keys(FM_VTYPES).map(k => [k, FM_VTYPES[k].replace(/ vendor$| job-worker$/, '')]));
  const cnt = k => list.filter(v => (k === 'all' || v.type === k) && hit(v)).length;
  const types = Object.keys(FM_VTYPES).filter(t => FM.seg === 'all' || FM.seg === t);
  const ncol = 3 + FM_VCOLS.length;
  const body = types.map(t => { const vs = list.filter(v => v.type === t && hit(v)), open = FM.vOpen.has(t);
    return `<tr class="fm-grp${open ? ' open' : ''}"><td colspan="${ncol - 1}"><button type="button" class="fm-tog" data-fmvt="${t}" aria-expanded="${open}">${FM_CHEV}<span class="fm-gname">${esc(FM_VTYPES[t])}</span></button></td><td class="r num">${nf(vs.length)}</td></tr>`
      + (!open ? '' : vs.length ? vs.map((v, i) => { const a = appOf(v);
        return `<tr class="fm-vrow"><td class="fm-sn">${i + 1}</td><td class="fm-vname">${fmAdmin() ? `<span class="fm-ed" tabindex="0" data-fmed="vendorBook|${esc(v.id)}|name">${esc(v.name)}</span>` : esc(v.name)}${
          v.work ? `<span class="fm-vsub">${esc(v.work)}</span>` : ''}${v.note ? `<span class="fm-vsub">${esc(v.note)}</span>` : ''}</td>${FM_VCOLS.map(([k]) => fmCell('vendorBook', v.id, k, v[k], k === 'pincode' || k === 'phone')).join('')}
          <td class="fm-nw">${a ? `<span class="fm-skc">${esc(a.code || '')}</span> <span class="muted">${esc(a.category || '')}</span>` : '<span class="muted">not in the app’s vendor list</span>'}</td></tr>`; }).join('')
        : `<tr class="fm-none-row"><td colspan="${ncol}">No ${esc(FM_VTYPES[t].toLowerCase())} yet.</td></tr>`); }).join('');
  return fmHead('Master data / Vendors', 'Vendors', 'Greige, RFD, quilt filling, cutting and runner vendors, with the details from Tally. The app’s own vendor list (Masters → Vendor) is not changed.',
      fmGdBtn() + (fmAdmin() ? '<button type="button" class="fm-primary" data-fmadd="vendor">+ Add vendor</button>' : ''), `${nf(list.length)} vendors`)
    + `<div class="card fm-card"><div class="fm-tools"><div class="fm-seg">${seg.map(([k, l]) => `<button type="button" data-fmseg="${k}" aria-pressed="${FM.seg === k}">${esc(l)}<span>${nf(cnt(k))}</span></button>`).join('')}</div>
      <span class="fm-grow"></span>${fmSearch('Search vendor, city, GSTIN or work')}</div>
      <div class="fm-wrapx"><table class="fm-tab fm-vt"><thead><tr><th>#</th><th>Vendor</th>${FM_VCOLS.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th>In the app</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="fm-foot"><span>Open a vendor type to see its vendors</span><span>${fmAdmin() ? 'Click a detail to add or change it' : 'Only an admin can change these details'}</span></div></div>`;
}

/* ---- changing a detail: admins only, one field at a time, straight to the database ---- */
const FM_RX = { gstin: [/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'A GSTIN is 15 characters, e.g. 08ACMPJ6106C1ZV.'], pan: [/^[A-Z]{5}\d{4}[A-Z]$/, 'A PAN is 10 characters, e.g. ACMPJ6106C.'],
  phone: [/^[6-9]\d{9}$/, 'A phone number is 10 digits.'], pincode: [/^\d{6}$/, 'A pincode is 6 digits.'] };
function fmCheck(k, v) {
  if (v === '') return '';
  const r = FM_RX[k]; if (r && !r[0].test(v)) return r[1];
  if (['gw', 'rw', 'gr', 'rr'].includes(k) && !(isFinite(+v) && +v >= 0)) return 'A number, please.';
  return '';
}
async function fmSave(list, id, k, raw) {
  if (!fmAdmin()) return 'Only an admin can change the master data.';
  let v = String(raw == null ? '' : raw).trim();
  if (['gstin', 'pan'].includes(k)) v = v.toUpperCase();
  if (k === 'phone') v = v.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '');
  const bad = fmCheck(k, v); if (bad) return bad;
  if (k === 'name' && !v) return 'A vendor needs a name.';
  const val = ['gw', 'rw', 'gr', 'rr'].includes(k) && v !== '' ? +v : v;
  try { await ptPatch({ [`pt_masters/${list}/${id}/${k}`]: val }); } catch (e) { return 'Not saved: ' + (e.message || e); }
  const cur = Object.assign({}, (PTG.masters || {})[list] || {});
  cur[id] = Object.assign({}, cur[id] || {}, { [k]: val });
  PTG.masters = Object.assign({}, PTG.masters || {}, { [list]: cur });
  return '';
}
function fmEditStart(td) {
  if (!td || td.classList.contains('on')) return;
  const [list, id, k] = td.dataset.fmed.split('|'), rec = (((PTG.masters || {})[list]) || {})[id] || {};
  td.classList.add('on');
  td.innerHTML = `<input class="fm-cin" value="${esc(rec[k] == null ? '' : rec[k])}" aria-label="${esc(k)}"><span class="fm-cerr"></span>`;
  const inp = td.querySelector('input'); inp.focus(); inp.select();
  let done = false;
  const finish = async save => {
    if (done) return; done = true;
    if (save && String(inp.value).trim() !== String(rec[k] == null ? '' : rec[k])) {
      const er = await fmSave(list, id, k, inp.value);
      if (er) { done = false; inp.setAttribute('aria-invalid', 'true'); td.querySelector('.fm-cerr').textContent = er; inp.focus(); return; }
    }
    fmRender();
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}

/* ---- adding: a fabric or a vendor, in the app's own dialog ---- */
function fmNextId(list, p) { const n = Object.keys(((PTG.masters || {})[list]) || {}).map(k => +(String(k).match(new RegExp('^' + p + '(\\d+)$')) || [])[1] || 0);
  return p + String(Math.max(0, ...n) + 1).padStart(2, '0'); }
function fmAddFabric() {
  const appFabs = mstRows('fabricType').map(r => r && (r.desc || r.code)).filter(Boolean);
  ptOpenDialog({ title: 'Add fabric', note: 'The RFD fabric, the greige it is made from, and its features. "App fabric" names the fabric the Master Database SKUs carry, so they appear under it.',
    fields: [{ key: 'rfd', label: 'RFD fabric name', value: '', span: 1 }, { key: 'greige', label: 'Greige fabric name *', value: '', span: 1 },
      { key: 'count', label: 'Count', value: '' }, { key: 'constr', label: 'Construction', value: '' }, { key: 'gw', label: 'Greige width (in)', value: '' },
      { key: 'rw', label: 'RFD width (in)', value: '' }, { key: 'gsm', label: 'GSM', value: '' }, { key: 'hsn', label: 'HSN code', value: '520812' },
      { key: 'gr', label: 'Greige rate (₹/m)', value: '' }, { key: 'rr', label: 'RFD rate (₹/m)', value: '' },
      { key: 'fabrics', label: 'App fabric (as the Master Database names it)', value: '', list: appFabs, span: 1 }],
    saveLabel: 'Add fabric',
    async onSave(v) {
      const rfd = String(v.rfd || '').trim(), greige = String(v.greige || '').trim();
      if (!greige) return 'Enter the greige fabric name.';
      const have = fmList('greigeRfd');
      if (have.some(f => fmKey(f.greige) === fmKey(greige) || (rfd && fmKey(f.rfd) === fmKey(rfd)))) return 'That fabric is already on the list.';
      for (const k of ['gw', 'rw', 'gr', 'rr']) { const b = fmCheck(k, String(v[k] || '').trim()); if (b) return b; }
      const rec = { order: have.length + 1, rfd, greige, hsn: String(v.hsn || '').trim(), fabrics: String(v.fabrics || '').split(',').map(s => s.trim()).filter(Boolean),
        addedBy: ME.email || '', addedAt: new Date().toISOString() };
      ['count', 'constr', 'gsm'].forEach(k => { rec[k] = String(v[k] || '').trim(); });
      ['gw', 'rw', 'gr', 'rr'].forEach(k => { const s = String(v[k] || '').trim(); rec[k] = s === '' ? '' : +s; });
      const id = fmNextId('greigeRfd', 'g');
      try { await ptPatch({ [`pt_masters/greigeRfd/${id}`]: rec }); } catch (e) { return 'Not saved: ' + (e.message || e); }
      PTG.masters = Object.assign({}, PTG.masters || {}, { greigeRfd: Object.assign({}, (PTG.masters || {}).greigeRfd || {}, { [id]: rec }) });
      ptDlgClose(); fmRender(); return '';
    } });
}
function fmAddVendor() {
  ptOpenDialog({ title: 'Add vendor', note: 'Saved to the vendor details of Master Data. The app’s own vendor list (Masters → Vendor) is not changed.',
    fields: [{ key: 'name', label: 'Vendor name *', value: '', span: 1 }, { key: 'type', label: 'Vendor type *', type: 'select', value: '', options: [['', 'Choose type']].concat(Object.entries(FM_VTYPES)) },
      { key: 'work', label: 'Work done', value: '' }, { key: 'contact', label: 'Contact person', value: '' }, { key: 'phone', label: 'Phone', value: '' },
      { key: 'city', label: 'City', value: 'Jaipur' }, { key: 'state', label: 'State', value: 'Rajasthan' }, { key: 'address', label: 'Address', value: '', span: 1 },
      { key: 'pincode', label: 'Pincode', value: '' }, { key: 'gstin', label: 'GSTIN', value: '' }, { key: 'pan', label: 'PAN', value: '' },
      { key: 'reg', label: 'Registration type', type: 'select', value: 'Regular', options: ['Regular', 'Composition', 'Unregistered/Consumer'] },
      { key: 'tds', label: 'TDS deductible', type: 'select', value: 'No', options: ['No', 'Yes · Individual/HUF - Resident', 'Yes · Individual - Resident', 'Yes · Partnership firm', 'Yes · Company - Resident'] }],
    saveLabel: 'Add vendor',
    async onSave(v) {
      const rec = {}; ['name', 'type', 'work', 'contact', 'phone', 'city', 'state', 'address', 'pincode', 'gstin', 'pan', 'reg', 'tds'].forEach(k => { rec[k] = String(v[k] == null ? '' : v[k]).trim(); });
      if (!rec.name) return 'Enter the vendor name.';
      if (!FM_VTYPES[rec.type]) return 'Choose a vendor type.';
      rec.gstin = rec.gstin.toUpperCase(); rec.pan = rec.pan.toUpperCase() || (rec.gstin ? rec.gstin.slice(2, 12) : '');
      rec.phone = rec.phone.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, '');
      for (const k of ['phone', 'pincode', 'gstin', 'pan']) { const b = fmCheck(k, rec[k]); if (b) return b; }
      const have = fmList('vendorBook');
      if (have.some(x => fmVKey(x.name) === fmVKey(rec.name) && x.type === rec.type)) return 'That vendor is already on the list for this type.';
      Object.assign(rec, { order: have.length + 1, note: '', addedBy: ME.email || '', addedAt: new Date().toISOString() });
      const id = fmNextId('vendorBook', 'v');
      try { await ptPatch({ [`pt_masters/vendorBook/${id}`]: rec }); } catch (e) { return 'Not saved: ' + (e.message || e); }
      PTG.masters = Object.assign({}, PTG.masters || {}, { vendorBook: Object.assign({}, (PTG.masters || {}).vendorBook || {}, { [id]: rec }) });
      FM.vOpen.add(rec.type); ptDlgClose(); fmRender(); return '';
    } });
}

/* ---- one listener for the whole page ---- */
if ($('panePmdb') && $('panePmdb').addEventListener) {
  const pane = $('panePmdb');
  pane.addEventListener('click', e => {
    const t = e.target.closest ? e.target : null; if (!t) return;
    const v = t.closest('[data-fmview]'); if (v) return fmSetView(v.dataset.fmview);
    const o = t.closest('[data-fmopen]'); if (o) { const k = o.dataset.fmopen; if (FM.open.has(k)) FM.open.delete(k); else FM.open.add(k); return fmRender(); }
    const x = t.closest('[data-fmexp]'); if (x) { FM.open = x.dataset.fmexp === '1' ? new Set(fmList('greigeRfd').map(f => f.id).concat(fmOthers().map(n => 'O:' + n))) : new Set(); return fmRender(); }
    const s = t.closest('[data-fmsk]'); if (s) { const k = s.dataset.fmsk; if (FM.allSku.has(k)) FM.allSku.delete(k); else FM.allSku.add(k); return fmRender(); }
    const c = t.closest('[data-fmclear]'); if (c) { FM.flt = {}; return fmRender(); }
    const g = t.closest('[data-fmseg]'); if (g) { FM.seg = g.dataset.fmseg; return fmRender(); }
    const vt = t.closest('[data-fmvt]'); if (vt) { const k = vt.dataset.fmvt; if (FM.vOpen.has(k)) FM.vOpen.delete(k); else FM.vOpen.add(k); return fmRender(); }
    const a = t.closest('[data-fmadd]'); if (a) return a.dataset.fmadd === 'vendor' ? fmAddVendor() : fmAddFabric();
    const tb = t.closest('[data-fmtab]'); if (tb) return fmToTable(tb.dataset.fmtab);
    if (t.closest('[data-fmgd]')) { showTab('gdesk'); return GD.open('inv'); }
    const ed = t.closest('[data-fmed]'); if (ed && !t.closest('input')) return fmEditStart(ed);
  });
  pane.addEventListener('keydown', e => { const ed = e.target.closest && e.target.closest('[data-fmed]');
    if (ed && e.target === ed && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fmEditStart(ed); } });
  pane.addEventListener('change', e => {
    const f = e.target.closest && e.target.closest('[data-fmflt]'); if (f) { FM.flt[f.dataset.fmflt] = f.value; return fmRender(); }
  });
  pane.addEventListener('input', e => {
    if (e.target.id !== 'fmQ') return;
    FM.q = e.target.value;
    clearTimeout(FM.qt); FM.qt = setTimeout(() => { const pos = e.target.selectionStart; fmRender(); const n = $('fmQ'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) { /* search inputs */ } } }, 200);
  });
}
