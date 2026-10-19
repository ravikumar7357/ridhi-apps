/* MASTER DATA IN RAVI'S FORMAT (15 Oct) — src/app/masters/fabric-master.js, run on its own with the database's own
 * masters and SKUs (Backups/rtdb-full-2026-10-15.json when it is there, else a small sample).
 *   node tests/fabric-master-test.js */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'masters', 'fabric-master.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' — ' + String(info).slice(0, 300) : '')); } };

const BK = path.join(__dirname, '..', '..', 'Backups', 'rtdb-full-2026-10-15.json');
const SEED = path.join(__dirname, 'mix', 'fabric-master-seed.json');
function data() {
  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
  if (fs.existsSync(BK)) {
    const d = JSON.parse(fs.readFileSync(BK, 'utf8'));
    return { masters: Object.assign({}, d.pt_masters, seed), mdb: Object.values(d.pt_masterDB || {}).filter(Boolean), real: true };
  }
  return { masters: Object.assign({ vendor: { a: { code: 'VND007', name: 'Alisha Garments', category: 'Filling' } } }, seed), real: false, mdb: [
    { sku: 'AC987-1818', articleType: 'Pillow Cover', subtype: 'Piping Pillow Cover', size: '18x18', color: 'Callum', fabric: 'Sheeting 82', consumption: 0.26, packOf: '2', cuttingRequired: true, isZip: true, isRuffle: false, fillerFabricRequired: false },
    { sku: 'RTC1-60108', articleType: 'Tablecloth', subtype: 'Rectangular Tablecloth', size: '60x108', color: 'Blue', fabric: 'Sheeting 62', consumption: 2.9, packOf: '1', cuttingRequired: false, isZip: false, isRuffle: false, fillerFabricRequired: false },
    { sku: 'RTC2-60108', articleType: 'Tablecloth', subtype: 'Ruffle Rectangular Tablecloth', size: '60x108', color: 'Red', fabric: 'Sheeting 62', consumption: 3, packOf: '1', cuttingRequired: false, isZip: false, isRuffle: true, fillerFabricRequired: false },
    { sku: 'X-58', articleType: 'Tablecloth', subtype: 'Square Tablecloth', size: '52x52', color: 'Red', fabric: 'Sheeting 58', consumption: 1.5, packOf: '1', cuttingRequired: false, isZip: false, isRuffle: false },
    { sku: 'NOFAB', articleType: 'Napkin', subtype: '', size: '18x18', color: 'Red', fabric: '' }] };
}

function load(me) {
  const D = data(), els = {}, writes = [];
  const el = id => els[id] || (els[id] = { id, innerHTML: '', value: '', children: [], style: {}, dataset: {}, classList: { s: new Set(), toggle(c, on) { if (on) this.s.add(c); else this.s.delete(c); }, add(c) { this.s.add(c); }, contains(c) { return this.s.has(c); } }, addEventListener() {} });
  el('panePmdb').children = [el('fmNav'), el('fmRoot'), el('oldCard')];
  const ctx = {
    $: el, ME: Object.assign({ email: 'x@y', admin: false }, me || {}), PTG: { masters: D.masters, mdb: D.mdb },
    /* The quote is left alone here so the fabric names (20's Sheeting 62" …) read as they are; the page's esc turns it into &quot;. */
    esc: s => String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])), nf: v => Number(v).toLocaleString('en-IN'),
    ptList: o => (Array.isArray(o) ? o.filter(Boolean) : Object.values(o || {}).filter(Boolean)), recipeValue: (m, k) => m[k],
    ptPatch: async p => { writes.push(p); }, ptDownload: (n, l) => { ctx.__csv = l; }, csvCell: v => String(v == null ? '' : v),
    mstRows: k => Object.values((D.masters || {})[k] || {}), ptOpenDialog: c => { ctx.__dlg = c; }, ptDlgClose: () => {}, renderPmdb: () => {},
    localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout,
  };
  const api = new Function(...Object.keys(ctx), SRC + '\n;return { FM, fmProducts, fmRender, fmSetView, fmList, fmSave, fmFabricHtml, fmVendorsHtml, fmToTable, fmAddFabric, fmAddVendor };')(...Object.values(ctx));
  return Object.assign(api, { els, writes, ctx, D });
}

(async () => {
  console.log('== the fabric list: the page\'s 16 fabrics, their details as imported, the SKUs under each ==');
  const A = load();
  ok('16 fabrics, in the page\'s order, with their greige', A.fmList('greigeRfd').length === 16 && A.fmList('greigeRfd')[0].rfd === '20\'s Sheeting 62" RFD 60x56'
    && A.fmList('greigeRfd')[0].greige === '20\'s Sheeting 67" Greige 60x56' && A.fmList('greigeRfd')[15].greige === 'Velvet Greige');
  ok('the details came across as they were: Cambric 60\'s, 92x80, 48/42 in, 70–80 GSM, HSN 520812, ₹48 / ₹7',
    (f => f.count === '60\'s' && f.constr === '92x80' && f.gw === 48 && f.rw === 42 && f.gsm === '70–80' && f.hsn === '520812' && f.gr === 48 && f.rr === 7)(A.fmList('greigeRfd').find(f => f.id === 'g07')));
  const P = A.fmProducts();
  ok('every SKU of the Master Database is read, none written', P.length === A.D.mdb.filter(m => m && m.sku).length && A.writes.length === 0);
  const s62 = P.filter(p => p.fab === 'g01');
  ok('a Sheeting 62 SKU sits under 20\'s Sheeting 62" RFD; a Sheeting 58 SKU under Other fabrics', s62.length > 0 && s62.every(p => p.fabName === 'Sheeting 62')
    && P.filter(p => p.fabName === 'Sheeting 58').every(p => p.fab === 'O:Sheeting 58'));
  if (A.D.real) {
    const byFab = n => P.filter(p => p.fabName === n).length;
    ok('the counts are the Master Database\'s own: Sheeting 82 = ' + byFab('Sheeting 82') + ', Cambric = ' + byFab('Cambric'),
      P.filter(p => p.fab === 'g03').length === byFab('Sheeting 82') && P.filter(p => p.fab === 'g07').length === byFab('Cambric'));
  }
  ok('process: cutting required → Cutting; no cutting with a ruffle → Both; else Runner',
    P.every(p => p.proc === (p.cut === 'Yes' ? 'Cutting' : p.ruf === 'Yes' ? 'Both' : 'Runner')));
  A.fmRender();
  ok('the page opens on Greige & RFD fabric, the old table hidden', /aria-current="page">Greige &amp; RFD fabric/.test(A.els.fmNav.innerHTML) && A.els.oldCard.style.display === 'none'
    && /20's Sheeting 62" RFD 60x56/.test(A.els.fmRoot.innerHTML) && /\(20's Sheeting 67" Greige 60x56\)/.test(A.els.fmRoot.innerHTML));
  ok('a fabric with no RFD says so (40\'s Percale, greige only)', /No RFD fabric<\/span><span class="fm-gr">\(40's Percale Sheeting 122" Greige 110x90\)/.test(A.els.fmRoot.innerHTML));
  ok('not an admin → the details are shown, not editable', !/data-fmed=/.test(A.els.fmRoot.innerHTML) && /Only an admin can change/.test(A.els.fmRoot.innerHTML) && !/data-fmadd/.test(A.els.fmRoot.innerHTML));
  A.FM.open.add('g01'); A.fmRender();
  ok('opened, a fabric lists its products: parent, child, sizes, process, SKUs', /<table class="fm-sub">/.test(A.els.fmRoot.innerHTML) && /<th>Product \(parent\)<\/th><th>Child<\/th><th>Sizes<\/th><th>Process<\/th>/.test(A.els.fmRoot.innerHTML));
  A.FM.flt.proc = 'Both'; A.fmRender();
  const both = A.fmProducts().filter(p => p.proc === 'Both').length;
  ok('filter Cutting / Runner / Both = Both → only fabrics with such SKUs, and Clear filters shows', /data-fmclear/.test(A.els.fmRoot.innerHTML) && (both ? /fm-both/.test(A.els.fmRoot.innerHTML) : /Nothing matches/.test(A.els.fmRoot.innerHTML)));
  A.FM.flt = {}; A.FM.q = 'cambric'; A.fmRender();
  ok('search "cambric" → the Cambric fabric, and only fabrics with something that matches', /60's Cambric 42" RFD 92x80/.test(A.els.fmRoot.innerHTML) && (A.els.fmRoot.innerHTML.match(/class="fm-main/g) || []).length < 16);

  console.log('== Greige & RFD fabric and the Master database open each other (15 Oct) ==');
  A.FM.q = ''; A.fmRender();
  ok('three pages, no All products: Greige & RFD fabric, Master database, Vendors', (A.els.fmNav.innerHTML.match(/data-fmview="(\w+)"/g) || []).join(',') === 'data-fmview="fabric",data-fmview="table",data-fmview="vendors"');
  ok('a fabric\'s app fabric opens the Master database', /data-fmtab="Sheeting 62"/.test(A.els.fmRoot.innerHTML));
  A.FM.open.add('g07'); A.fmRender();
  ok('…and so does every SKU code under a fabric', /<button type="button" class="fm-skc fm-lnk" data-fmtab="[^"]+"/.test(A.els.fmRoot.innerHTML));
  A.fmToTable('Cambric');
  ok('pressed: the Master database table, searched for it', A.FM.view === 'table' && A.els.ptmQ.value === 'Cambric' && A.els.oldCard.style.display === '');
  A.fmSetView('fabric');

  console.log('== Vendors ==');
  A.fmSetView('vendors');
  ok('15 vendors from the page, by type, with Tally details', A.fmList('vendorBook').length === 15 && /Greige vendor/.test(A.els.fmRoot.innerHTML) && /08ACMPJ6106C1ZV/.test(A.els.fmRoot.innerHTML));
  ok('a vendor the app knows shows its code (Alisha Garments → VND007)', /Alisha Garments[\s\S]*?VND007/.test(A.els.fmRoot.innerHTML));
  A.FM.seg = 'quilt'; A.fmRender();
  ok('the Quilt filling segment shows only quilt filling vendors', /Shama Cotton Udyog/.test(A.els.fmRoot.innerHTML) && !/Patch Craft/.test(A.els.fmRoot.innerHTML));
  A.fmSetView('table');
  ok('"Master database" brings the old table back, untouched', A.els.oldCard.style.display === '' && A.els.fmRoot.classList.contains('hide'));

  console.log('== an admin changes a detail ==');
  const B = load({ admin: true });
  B.fmRender();
  ok('an admin gets editable cells and + Add fabric', /data-fmed="greigeRfd\|g01\|gsm"/.test(B.els.fmRoot.innerHTML) && /data-fmadd="fabric"/.test(B.els.fmRoot.innerHTML));
  let er = await B.fmSave('greigeRfd', 'g01', 'gr', '61');
  ok('Greige rate 61 → written to pt_masters/greigeRfd/g01/gr as a number, nothing else', !er && B.writes.length === 1 && B.writes[0]['pt_masters/greigeRfd/g01/gr'] === 61);
  er = await B.fmSave('vendorBook', 'v02', 'gstin', '08abc');
  ok('a bad GSTIN is refused, nothing written', /15 characters/.test(er) && B.writes.length === 1);
  er = await B.fmSave('vendorBook', 'v02', 'phone', '+91 98290 11223');
  ok('a phone is cleaned to its 10 digits', !er && B.writes[1]['pt_masters/vendorBook/v02/phone'] === '9829011223');
  const C = load();
  er = await C.fmSave('greigeRfd', 'g01', 'gr', '61');
  ok('not an admin → refused, nothing written', /Only an admin/.test(er) && C.writes.length === 0);
  B.fmAddFabric(); er = await B.ctx.__dlg.onSave({ rfd: '', greige: '20\'s Sheeting 67" Greige 60x56' });
  ok('adding a fabric already on the list is refused', /already on the list/.test(er));
  er = await B.ctx.__dlg.onSave({ rfd: 'Linen 56" RFD', greige: 'Linen 58" Greige', gw: '58', rw: '56', hsn: '530911', fabrics: 'Linen' });
  const wNew = B.writes[B.writes.length - 1];
  ok('a new fabric gets the next number, g17, with its app fabric', !er && wNew['pt_masters/greigeRfd/g17'] && wNew['pt_masters/greigeRfd/g17'].fabrics[0] === 'Linen' && wNew['pt_masters/greigeRfd/g17'].gw === 58);
  B.fmAddVendor(); er = await B.ctx.__dlg.onSave({ name: 'New Cutter', type: 'cut', phone: '9876543210' });
  ok('a new vendor (Cutting job-worker) is saved as v16', !er && B.writes[B.writes.length - 1]['pt_masters/vendorBook/v16'].type === 'cut');

  console.log('== the Greige Desk reads its fabrics and vendors from the Master Data (15 Oct) ==');
  {
    const LAYER = fs.readFileSync(path.join(__dirname, '..', 'tools', 'greige-desk', 'app-layer.js'), 'utf8');
    const M = load({ admin: true });
    const run = new Function('PTG', 'fmList', 'venUsed', 'showTab', 'fmSetView', 'DBin', LAYER.replace(/^function lmLoad[^\n]*\n/m, '')
      + '\n;DB = DBin; gdLinkMasters(); return { DB, linked: gdLinked(), open: gdOpenMasterData };');
    let DB = null;
    const tabs = [], views = [];
    const out = run.call(null, M.ctx.PTG, M.fmList, n => (n === 'Old Mill' ? 2 : 0), t => tabs.push(t), v => views.push(v),
      { mst: [{ rfd: 'Sheeting 62', greige: '20\'s Sheeting 67" Greige 60x56', warp: '2/20s', weft: '20s' }], ven: [{ name: 'Old Mill', kind: 'Supplier' }, { name: 'Unused', kind: 'Supplier' }], fab: [], gpo: [] });
    const g = out.DB.mst, v = out.DB.ven;
    ok('linked: the desk has the Master Data\'s 16 fabrics, called by the app fabric name PPC matches on, the full name as title', out.linked && g.length === 16 && g[0].rfd === 'Sheeting 62' && g[0].title === '20\'s Sheeting 62" RFD 60x56' && g[0].greige === '20\'s Sheeting 67" Greige 60x56');
    ok('…widths and EPI x PPI from the Master Data (67 / 62 in, 60 x 56); the warp typed on the desk is kept', g[0].greigeWidth === 67 && g[0].rfdWidth === 62 && g[0].epi === 60 && g[0].ppi === 56 && g[0].warp === '2/20s');
    ok('…a count the desk never had becomes warp and weft (60\'s Cambric → 60s × 60s)', (c => c.warp === '60s' && c.weft === '60s')(g.find(x => /Cambric/.test(x.greige))));
    ok('suppliers = the greige vendors, RFD processors = the RFD vendors (quilt and runner vendors are not the desk\'s)',
      v.filter(x => x.kind === 'Supplier' && !x.deskOnly).length === 5 && v.filter(x => x.kind === 'RFD Processor').length === 3 && !v.some(x => /Shama|Royal/.test(x.name)));
    ok('a supplier only the test records name stays, marked; one nobody uses goes', v.some(x => x.name === 'Old Mill' && x.deskOnly) && !v.some(x => x.name === 'Unused'));
    out.open('vendors');
    ok('"Open in Master Data" goes to Setup → Master Database at Vendors', tabs[0] === 'pmdb' && views[0] === 'vendors');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
