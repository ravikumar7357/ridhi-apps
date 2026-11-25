/* CUTTING DATA IN THE CUTTING DESK'S LOOK (Ravi, 25 Nov: "refine the cutting data page according to the cutting desk page").
 *   node tests/cutting-data-look-test.js      (PCD_SRC=<file> to test another copy — teeth/teeth-cutting-data-look.js does)
 * Loads src/app/vendors/printing/cutting-data-look.js alone with its neighbours stubbed. What must hold: the look shows only where the
 * Cutting Desk's switch is on; the four tiles add up the entries on screen, with cloth and waste counted only over entries somebody
 * measured; the Unused / Partly / Used buttons count the same entries the filter keeps; 50 entries a page, and a changed filter starts
 * again from the first page; the list carries picture, SKU, article, colour, size, fabric and remarks in one cell, cloth and waste in
 * one cell, and the same Edit button for the same people; an entry nobody measured never shows as nought. */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.PCD_SRC || path.join(__dirname, '..', 'src', 'app', 'vendors', 'printing', 'cutting-data-look.js'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' - ' + extra : '')); } };

/* a cutting entry, as Cutting Data holds it */
const cut = (id, pieces, over) => Object.assign({ id, sku: 'SKU-' + id, orderNo: 'PO-' + id, pieces, cutDate: '24/11/2026, 10:30', articleType: 'Bedsheet', articleSubtype: 'Flat sheet',
  color: 'Sage Green', size: 'King', fabricWidth: 'Sheeting 82', addedBy: 'cutter.one@example.com' }, over || {});

function load(o) {
  o = o || {};
  const els = {}, warns = [];
  const classes = () => { const set = new Set(); return { contains: c => set.has(c), toggle: (c, on) => { if (on) set.add(c); else set.delete(c); } }; };
  const listCard = { classList: classes(), insertAdjacentHTML(where, html) { const m = /id="(\w+)"/.exec(html); if (m) el(m[1]); } };
  if (o.listSetAside) listCard.classList.toggle('fl-embhide', true);
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, classList: classes(),
    addEventListener(t, f) { this['on_' + t] = f; },
    insertAdjacentHTML(where, html) { const m = /id="(\w+)"/.exec(html); if (m) el(m[1]); },
    parentElement: listCard });
  const use = o.use || null;   // id -> { used, net }: what the Job Work Register says went to karigars
  const ctx = {
    $: el, console: { warn: (...a) => warns.push(a.join(' ')) },
    esc: s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])), nf: v => String(v),
    ptNum: v => { const n = parseFloat(v); return isFinite(n) ? n : 0; },
    ...(o.noSwitch ? {} : { cdkSwitchOn: () => { if (o.switchThrows) throw new Error('no location'); return o.on !== false; } }),
    ptImgSpan: (sku, px) => `<span data-img="${ctx.esc(sku)}" data-imgpx="${px}"></span>`, ptImgFill: skus => { ctx.__imgs = skus; }, ptIfTab: (t, f) => f, ptImgPatch() {},
    whoCell: r => `<td class="who">${String(r.addedBy || '').split('@')[0]}</td>`,
    pcutUseMap: () => use, pcutUseOf: r => (use ? use[r.id] || null : null),
    pcutUseKind: u => (!u ? '' : u.net <= 0 ? 'used' : u.used >= u.net ? 'used' : u.used > 0 ? 'part' : 'unused'),
    pcutUsePill: r => (use && use[r.id] ? '<span class="pill">' + (use[r.id].used >= use[r.id].net ? 'Used' : use[r.id].used > 0 ? 'Partly' : 'Unused') + '</span>' : ''),
    pcutFilters: () => Object.assign({ q: '' }, ctx.__filters || {}), ptCanEdit: () => o.edit !== false,
    renderPcut: () => { ctx.__redraws = (ctx.__redraws || 0) + 1; },
  };
  const keys = Object.keys(ctx);
  const fn = new Function(...keys, SRC + '\n;return { pcdOn, pcdTotals, pcdUseCounts, pcdPageOf, pcdTopHtml, pcdItemHtml, pcdClothHtml, pcdTableHtml, pcdPagerHtml, pcdRender, PCD };');
  return Object.assign(fn(...keys.map(k => ctx[k])), { els, ctx, warns });
}
const click = (S, id, name, val) => S.els[id].on_click({ target: { closest: sel => (sel === '[data-' + name + ']' ? { dataset: { [name]: val } } : null) } });

console.log('== the switch: the look follows the Cutting Desk ==');
{
  ok('on where the Cutting Desk is on', load().pcdOn() === true);
  ok('off where the Cutting Desk is off', load({ on: false }).pcdOn() === false);
  ok('off where there is no Cutting Desk at all', load({ noSwitch: true }).pcdOn() === false);
  const T = load({ switchThrows: true });
  ok('a switch that cannot be read leaves the old list, and the console says why', T.pcdOn() === false && T.warns.length === 1);
}

const ROWS = [cut('1', 150, { fabricUsed: 135, fabricWaste: 4, fabricWasteWidth: 20, remarks: 'second lot' }), cut('2', 120, { fabricUsed: 330, fabricWaste: 38, fabricWasteWidth: 12 }),
  cut('3', 100, { fabricUsed: 90 }), cut('4', 140), cut('5', 60, { fabricWaste: 3 })];
const USE = { 1: { used: 0, net: 150 }, 2: { used: 80, net: 120 }, 3: { used: 100, net: 100 }, 4: { used: 140, net: 140 } };

console.log('== the four tiles ==');
{
  const S = load({ use: USE }), t = S.pcdTotals(ROWS, r => USE[r.id] || null);
  ok('pieces cut and entries', t.pieces === 570 && t.entries === 5, JSON.stringify(t));
  ok('issued and still to issue, from the Job Work Register', t.issued === 320 && t.left === 190, JSON.stringify(t));
  ok('cloth used counts only entries somebody measured', t.used === 555 && t.measured === 3, JSON.stringify(t));
  ok('waste is counted over those same entries, with its share of the cloth', t.waste === 42 && Math.abs(t.pct - 42 / 555 * 100) < 1e-9, JSON.stringify(t));
  const n = S.pcdTotals(ROWS, null);
  ok('before the Job Work Register is read, issued and still to issue are unknown, not nought', n.issued === null && n.left === null);
  const top = S.pcdTopHtml(t, null, '');
  ok('the tiles show them', top.includes('>570<') && top.includes('190 pcs') && top.includes('320 issued') && top.includes('555 m') && top.includes('3 of 5 measured') && top.includes('42 m') && top.includes('7.6% of cloth used'));
  ok('waste over 10% of the cloth is in red, under it is not', S.pcdTopHtml(Object.assign({}, t, { pct: 11 }), null, '').includes('color:var(--bad)') && !top.includes('color:var(--bad)'));
  ok('unknown figures show a dash', S.pcdTopHtml(S.pcdTotals([cut('9', 5)], null), null, '').includes('>—<'));
}

console.log('== Unused / Partly used / Used ==');
{
  const S = load({ use: USE }), kind = r => S.ctx.pcutUseKind(USE[r.id] || null), c = S.pcdUseCounts(ROWS, kind);
  ok('each button counts its entries', c[''] === 5 && c.unused === 1 && c.part === 1 && c.used === 2, JSON.stringify(c));
  ok('no counts until the Job Work Register is read', S.pcdUseCounts(ROWS, null) === null);
  const top = S.pcdTopHtml(S.pcdTotals(ROWS, null), c, 'part');
  ok('the buttons carry their counts and the picked one stands out', /data-pcduse="part" class=""[^>]*>Partly used <b[^>]*>1</.test(top) && /data-pcduse="" class="ghost"[^>]*>All <b[^>]*>5</.test(top));
}

console.log('== 50 entries a page ==');
{
  const S = load(), many = Array.from({ length: 120 }, (_, i) => cut(String(i), 10));
  ok('the first page holds 50, the last the rest', S.pcdPageOf(many, 0).rows.length === 50 && S.pcdPageOf(many, 2).rows.length === 20 && S.pcdPageOf(many, 2).from === 100);
  ok('a page past the end falls back to the last one', S.pcdPageOf(many, 9).at === 2);
  const pager = S.pcdPagerHtml(S.pcdPageOf(many, 1), 120);
  ok('the pager says which entries are shown, and that Export covers all', /Showing 51 to 100 of 120, newest first · Export covers all of them/.test(pager));
  ok('Previous is off on the first page and Next on the last', /data-pcdpage="-1"[^>]*disabled/.test(S.pcdPagerHtml(S.pcdPageOf(many, 0), 120)) && /data-pcdpage="1"[^>]*disabled/.test(S.pcdPagerHtml(S.pcdPageOf(many, 2), 120)));
  ok('one page has no Previous / Next', !/data-pcdpage/.test(S.pcdPagerHtml(S.pcdPageOf(ROWS, 0), 5)));
}

console.log('== the list ==');
{
  const S = load({ use: USE }), pill = S.ctx.pcutUsePill, h = S.pcdTableHtml([ROWS[0]], pill, true);
  ok('7 columns: Cut date, Item, Pieces, Issued, Cloth and waste, Cut by, Edit', (h.match(/<th[ >]/g) || []).length === 7 && ['Cut date', 'Item', 'Pieces', 'Issued', 'Cloth and waste', 'Cut by'].every(c => h.includes('>' + c + '</th>')));
  ok('the date without the time, and the order under it', h.includes('>24/11/2026<div') && !h.includes('10:30') && h.includes('>PO-1</div>'));
  ok('the item cell: picture, SKU, article · colour · size, fabric, remarks', h.includes('data-img="SKU-1" data-imgpx="40"') && h.includes('>SKU-1</b>') && h.includes('Flat sheet · Sage Green · King') && h.includes('Sheeting 82') && h.includes('second lot'));
  ok('pieces, the used mark and who cut it', h.includes('>150</td>') && h.includes('Unused') && h.includes('class="who">cutter.one'));
  ok('cloth and waste in one cell', h.includes('135 m used') && h.includes('4 m waste · 20" · 3.0%'));
  ok('the same Edit button, naming the entry', h.includes('data-cut-edit="1"'));
  ok('…and none for somebody who may not edit', !S.pcdTableHtml([ROWS[0]], pill, false).includes('data-cut-edit'));
  ok('waste over 10% of the cloth is in red', S.pcdClothHtml(ROWS[1]).includes('color:var(--bad)') && !S.pcdClothHtml(ROWS[0]).includes('color:var(--bad)'));
  ok('an entry nobody measured says so, never 0', S.pcdClothHtml(ROWS[3]) === '<span class="muted">not measured</span>');
  ok('cloth measured with no waste entered says that', S.pcdClothHtml(ROWS[2]).includes('90 m used') && S.pcdClothHtml(ROWS[2]).includes('no waste entered'));
  ok('waste entered with no cloth measured shows the waste and no share', S.pcdClothHtml(ROWS[4]).includes('cloth not measured') && S.pcdClothHtml(ROWS[4]).includes('3 m waste') && !S.pcdClothHtml(ROWS[4]).includes('%'));
  const bad = S.pcdTableHtml([cut('<b>', 5, { sku: '<img onerror=1>', remarks: '<script>x</script>', orderNo: '<i>' })], pill, true);
  ok('order, SKU and remarks are shown as text, never as page code', !bad.includes('<img onerror') && !bad.includes('<script>') && !bad.includes('<i>') && bad.includes('&lt;img onerror'));
  ok('a cut with no order number says so', S.pcdTableHtml([cut('7', 5, { orderNo: '' })], pill, true).includes('no order'));
  ok('an empty list says so', /No cutting entry fits these filters/.test(S.pcdTableHtml([], pill, true)));
}

console.log('== drawing the page ==');
{
  const many = Array.from({ length: 120 }, (_, i) => cut(String(i), 10));
  const S = load({ use: {} });
  S.pcdRender(many, many, 300);
  ok('50 entries are drawn and pictures asked for those only', (S.els.pcTable.innerHTML.match(/<tr><td/g) || []).length === 50 && S.ctx.__imgs.length === 50);
  ok('the line under the filters counts what is shown of all', S.els.pcMsg.textContent === '120 of 300 cut entries');
  ok('the old Used-or-not list is put away; its choices are the buttons', S.els.pcUse.style.display === 'none' && S.els.pcKpis.innerHTML.includes('data-pcduse="unused"'));
  ok('the pick-lists are left to the Filters button: none is hidden or moved here', ['pcPlat', 'pcOrd', 'pcArt', 'pcSub', 'pcCol', 'pcSz', 'pcWho'].every(id => !S.els[id] || S.els[id].style.display === undefined) && !S.els.pcdMore);
  ok('the page bar is in view with the list', !S.els.pcdPager.classList.contains('fl-embhide'));
  const A = load({ use: {}, listSetAside: true }); A.pcdRender(many, many, 300);
  ok('…and set aside with it where the Cutting Desk tab was opened before the entries came', A.els.pcdPager.classList.contains('fl-embhide'));
  click(S, 'pcdPager', 'pcdpage', '1');
  ok('Next moves a page on and draws again', S.PCD.page === 1 && S.ctx.__redraws === 1);
  S.pcdRender(many, many, 300);
  ok('the same filters keep the page', S.PCD.page === 1 && /Showing 51 to 100/.test(S.els.pcdPager.innerHTML));
  S.ctx.__filters = { q: 'sku-1' }; S.pcdRender(many, many, 300);
  ok('a changed filter starts again from the first page', S.PCD.page === 0);
  click(S, 'pcKpis', 'pcduse', 'used');
  ok('a Used / Unused button sets the pick and draws again', S.els.pcUse.value === 'used' && S.ctx.__redraws === 2);
  S.PCD.page = 2; S.pcdRender(many, many, 300);
  ok('…which also starts again from the first page', S.PCD.page === 0);
}

console.log('== wired into Cutting Data ==');
{
  const list = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'vendors', 'printing', 'fabric-catalogue.js'), 'utf8').replace(/\r\n/g, '\n');
  ok('Cutting Data hands its filtered entries to the new look only where the switch is on', list.includes("if (typeof pcdOn === 'function' && pcdOn()) return pcdRender(rows, beforeUse, all.length);"));
  ok('…after the filters and the Used pick, so both looks list the same entries', list.indexOf('PT._pcutRows = rows;\n  /* THE CUTTING DESK') > list.indexOf('if (useSel && useMap) rows = rows.filter'));
  ok('the Cut, not yet issued view is handed on before it, untouched', list.indexOf("=== 'wait') { PT._pcutRows = rows; return renderPcutWait(rows); }") < list.indexOf('pcdRender(rows, beforeUse'));
}

console.log('== Cutting Data\'s own list is set aside while the Cutting Desk tab is open ==');
{
  const rd = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').replace(/\r\n/g, '\n');
  ok('the flow tab marks the screen\'s own content to be set aside', rd('app/flow/flow-view.js').includes("ch.classList.toggle('fl-embhide', !!v)"));
  ok('…and the styles hide what is marked (lost on 16 Oct: both lists showed, one under the other)', /^\.fl-embhide\{display:none!important\}$/m.test(rd('styles.css')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
