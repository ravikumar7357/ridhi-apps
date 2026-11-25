/* THE CUTTING DESK (Ravi, 25 Nov: the "To cut" list redesigned — what is left to cut on each line, and the cutting entry in a pop-up card).
 *   node tests/cutting-desk-test.js      (CDK_SRC=<file> to test another copy — teeth/teeth-cutting-desk.js does)
 * Loads src/app/flow/flow-cutting-desk.js alone with its neighbours stubbed. What must hold: the desk shows only where its switch is on;
 * a line's Left to cut is the order less what is cut; the tiles, quick filters and pages count the same lines; the list carries the picture,
 * SKU, article, size and fabric in one cell and nothing about waiting, status or issue; and the pop-up saves through Cutting Data's own form
 * with the pieces, date, fabric, cloth, waste and remarks it was given, and stays open with the form's message when the form refuses. */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(process.env.CDK_SRC || path.join(__dirname, '..', 'src', 'app', 'flow', 'flow-cutting-desk.js'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' - ' + extra : '')); } };

/* a line of the list, as flowRows gives it: r the order line, s where it stands */
const line = (no, sku, qty, cut, over) => ({ r: Object.assign({ orderNo: no, sku, qty, articleType: 'Bedsheet', articleSubtype: 'Flat sheet', size: 'King', orderDate: '2026-11-20' }, (over || {}).r),
  s: Object.assign({ key: no + '__' + sku, cut, plan: { fabric: { name: 'Sheeting 82' } } }, (over || {}).s) });

function load(o) {
  o = o || {};
  const els = {}, drives = [], warns = [];
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', dataset: {}, options: [], appendChild(x) { this.options.push(x); }, addEventListener(t, f) { this['on_' + t] = f; },
    parentElement: { insertAdjacentHTML(where, html) { const m = /id="(\w+)"/.exec(html); if (m) el(m[1]); } } });
  const ctx = {
    $: id => (id === 'cdkTop' || id === 'cdkPager' ? els[id] : el(id)),
    localStorage: { getItem: () => { if (o.lsBlocked) throw new Error('blocked'); return o.ls === undefined ? null : o.ls; } },
    window: { __TEST_ERP: !!o.testLink, open: () => (o.popupBlocked ? null : { document: { open() {}, write(h) { ctx.__printed = h; }, close() {} } }) },
    location: { hostname: o.host || 'erp.example.com' }, baseOnPreview: () => /--/.test(o.host || ''), console: { warn: (...a) => warns.push(a.join(' ')) },
    document: { createElement: () => ({ value: '', textContent: '' }) },
    esc: s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])), nf: v => String(v),
    obUC: v => String(v == null ? '' : v).trim().toUpperCase(), dToday: () => '2026-11-25',
    cutSkuOf: sku => (o.mdb || {})[sku] || null, ptConsPlan: m => (m && m.cons ? { metres: m.cons } : { why: 'no cloth per piece' }),
    ptImgSpan: (sku, px) => `<span data-img="${ctx.esc(sku)}" data-imgpx="${px}"></span>`, ptImgFill: skus => { ctx.__imgs = skus; }, ptIfTab: (t, f) => f, ptImgPatch() {},
    PT: { cut: o.cut || [] }, flowRows: () => o.rows || [], flowMay: () => o.may !== false, flowTestCutOpen: (no, sku) => { ctx.__testCut = no + '|' + sku; },
    flowCutNow: (r, s) => Math.max(0, (+r.qty || 0) - (+s.cut || 0)), flowCutFabricOf: () => ({ code: o.printed || '' }), cutFabrics: () => ['Cambric 90', 'Sheeting 82'],
    ptOpenDialog: cfg => { ctx.__dlg = cfg; }, cutFormMsg: t => { el('cwMsg').textContent = t; }, ensureCutForm: async () => {}, renderCutPick() {}, renderCutForm() {},
    flowEmbedRender: tab => { ctx.__redraws = (ctx.__redraws || 0) + 1; }, flowEmbedRefresh: () => { ctx.__refreshed = (ctx.__refreshed || 0) + 1; },
    __driveErr: o.driveErr || '', __driveThrows: !!o.driveThrows,
  };
  /* the form's own Save, stood in for: it notes what it was handed and whether the line's own fabric was allowed at that moment */
  const pre = 'let CUT_OWN_OK = "";\nasync function shpbDrive(set, saveId, msgId) { __drives.push({ set, saveId, msgId, ownOk: CUT_OWN_OK, typed: $("cwUsed").dataset.typed, sku: $("cwSku").value });'
    + ' Object.entries(set).forEach(([id, v]) => { $(id).value = v; }); $("cwMsg").textContent = __driveErr;'
    + ' if (__driveThrows) throw new Error("offline"); return __driveErr; }\n';
  const keys = Object.keys(ctx).concat('__drives');
  const fn = new Function(...keys, pre + SRC + '\n;return { cdkSwitchOn, cdkLeft, cdkStage, cdkTiles, cdkFilter, cdkPageOf, cdkTableHtml, cdkTopHtml, cdkPagerHtml, cdkRender, cdkClick, cdkPrint,'
    + ' cdkCutOpen, cdkCutSave, cdkEarlier, CDK, CDK_NAME, CDK_PAGE, ownOk: () => CUT_OWN_OK };');
  return Object.assign(fn(...keys.map(k => (k === '__drives' ? drives : ctx[k]))), { els, ctx, drives, warns });
}
const click = (S, name, val) => S.cdkClick({ target: { closest: sel => (sel === '[data-' + name + ']' ? { dataset: { [name]: val } } : null) } });

(async () => {
  console.log('== the switch: off for everybody, on for the test link, this PC and whoever turns it on ==');
  {
    ok('off on the live address', load().cdkSwitchOn() === false);
    ok('on on the TEST ERP', load({ testLink: true }).cdkSwitchOn() === true);
    ok('on on a branch\'s test link', load({ host: 'erp-site--cutting-desk-ab12.web.app' }).cdkSwitchOn() === true);
    ok('on on this PC (localhost)', load({ host: 'localhost' }).cdkSwitchOn() === true);
    ok('turned on for one computer', load({ ls: '1' }).cdkSwitchOn() === true);
    ok('turned off on the test link', load({ ls: '0', testLink: true }).cdkSwitchOn() === false);
    const B = load({ lsBlocked: true });
    ok('saved settings blocked: the old list stays, and the console says why', B.cdkSwitchOn() === false && B.warns.length === 1);
  }

  console.log('== what is left to cut ==');
  const ROWS = [line('PO-1', 'A', 300, 0), line('PO-2', 'B', 400, 250), line('PO-3', 'C', 500, 0), line('PO-4', 'D', 200, 140), line('PO-5', 'E', 50, 80)];
  {
    const S = load();
    ok('left to cut is the order less what is cut', S.cdkLeft(ROWS[1]) === 150 && S.cdkLeft(ROWS[0]) === 300);
    ok('…and never below nought when more was cut than ordered', S.cdkLeft(ROWS[4]) === 0);
    ok('a line with nothing cut is Not started, one with some cut is Part cut', S.cdkStage(ROWS[0]) === 'none' && S.cdkStage(ROWS[1]) === 'part');
    const t = S.cdkTiles(ROWS);
    ok('the tiles: pieces left on the whole list', t.left === 1010 && t.lines === 5, JSON.stringify(t));
    ok('…lines and pieces not started', t.noneLines === 2 && t.nonePcs === 800, JSON.stringify(t));
    ok('…lines part cut and their pieces left', t.partLines === 3 && t.partPcs === 210, JSON.stringify(t));
    ok('the quick filters keep the same lines the tiles count', S.cdkFilter(ROWS, 'none').length === t.noneLines && S.cdkFilter(ROWS, 'part').length === t.partLines && S.cdkFilter(ROWS, '').length === 5);
  }

  console.log('== 50 lines a page ==');
  {
    const S = load(), many = Array.from({ length: 120 }, (_, i) => line('PO-' + i, 'S' + i, 10, 0));
    const p0 = S.cdkPageOf(many, 0), p2 = S.cdkPageOf(many, 2), past = S.cdkPageOf(many, 9);
    ok('the first page holds 50', p0.rows.length === 50 && p0.pages === 3 && p0.rows[0].r.orderNo === 'PO-0');
    ok('the last page holds the rest', p2.rows.length === 20 && p2.from === 100);
    ok('a page past the end falls back to the last one', past.at === 2 && past.rows.length === 20);
    ok('the pager says which lines are shown', /Showing 51 to 100 of 120, oldest order first/.test(S.cdkPagerHtml(S.cdkPageOf(many, 1), 120)));
    ok('Previous is off on the first page and Next on the last', /data-cdkpage="-1"[^>]*disabled/.test(S.cdkPagerHtml(p0, 120)) && /data-cdkpage="1"[^>]*disabled/.test(S.cdkPagerHtml(p2, 120)));
    ok('one page has no Previous / Next', !/data-cdkpage/.test(S.cdkPagerHtml(S.cdkPageOf(ROWS, 0), 5)));
  }

  console.log('== the list ==');
  {
    const S = load(), h = S.cdkTableHtml([ROWS[1]]);
    ok('columns: PO, Item, Ordered, Cut, Left to cut', ['PO', 'Item', 'Ordered', 'Cut', 'Left to cut'].every(c => h.includes('>' + c + '</th>')));
    ok('no Waiting, Status, cloth or issue column', !/Waiting|Status|Cloth to cut|To issue|karigar/i.test(h));
    ok('the item cell: picture, SKU, article and size, fabric', h.includes('data-img="B" data-imgpx="44"') && h.includes('>B</b>') && h.includes('Flat sheet · King') && h.includes('Sheeting 82'));
    ok('ordered, cut and left to cut', h.includes('>400</td>') && h.includes('>250</td>') && h.includes('>150</b>'));
    ok('each line has Enter cutting, naming the line', h.includes('data-cdkcut="PO-2__B"') && h.includes('Enter cutting'));
    const bad = S.cdkTableHtml([line('PO-<x>', '<img onerror=1>', 5, 0)]);
    ok('an order or SKU is shown as text, never as page code', !bad.includes('<img onerror') && bad.includes('&lt;img onerror'));
    ok('an empty list says so', /No line is waiting to be cut/.test(S.cdkTableHtml([])));
    const noPlan = S.cdkTableHtml([line('PO-9', 'M1', 5, 0, { s: { plan: null } })]);
    ok('a line with no plan takes its fabric from the master row', load({ mdb: { M1: { fabric: 'Cambric 90' } } }).cdkTableHtml([line('PO-9', 'M1', 5, 0, { s: { plan: null } })]).includes('Cambric 90') && !noPlan.includes('Cambric'));
    const top = S.cdkTopHtml(ROWS);
    ok('the top: three tiles and the quick filters with their counts', top.includes('1010 pcs') && top.includes('800 pcs') && top.includes('210 pcs left') && /data-cdkpick="none"[^>]*>Not started <b[^>]*>2</.test(top) && /data-cdkpick="part"[^>]*>Part cut <b[^>]*>3</.test(top));
  }

  console.log('== drawing the desk, the quick filters and the pages ==');
  {
    const many = Array.from({ length: 60 }, (_, i) => line('PO-' + i, 'S' + i, 10, i % 2 ? 4 : 0));
    const S = load();
    const kept = S.cdkRender('pcut', many);
    ok('every line is kept with no quick filter, and 50 are drawn', kept.length === 60 && (S.els.flEmbT_pcut.innerHTML.match(/data-cdkcut/g) || []).length === 50);
    ok('pictures are asked for only for the lines drawn', S.ctx.__imgs.length === 50);
    click(S, 'cdkpage', '1');
    ok('Next moves a page on and redraws', S.CDK.page === 1 && S.ctx.__redraws === 1);
    click(S, 'cdkpick', 'part');
    ok('a quick filter goes back to the first page', S.CDK.pick === 'part' && S.CDK.page === 0);
    const part = S.cdkRender('pcut', many);
    ok('…and the lines it keeps are what Excel and Print take', part.length === 30 && part.every(x => x.s.cut > 0));
  }

  console.log('== print ==');
  {
    const S = load();
    ok('nothing to print says so', S.cdkPrint([]) === 'No line to print.');
    ok('a blocked window says what to do', /Allow pop-ups/.test(load({ popupBlocked: true }).cdkPrint(ROWS)));
    ok('the sheet carries every line with its left to cut', S.cdkPrint(ROWS) === '' && ROWS.every(x => S.ctx.__printed.includes('<td>' + x.r.orderNo + '</td>')) && S.ctx.__printed.includes('<td>150</td>'));
  }

  console.log('== the pop-up cutting entry ==');
  {
    const x = ROWS[1], S = load({ rows: ROWS, mdb: { B: { cons: 0.9 } }, printed: 'PF-77', cut: [{ orderNo: 'PO-2', sku: 'B', pieces: 150, cutDate: '20/11/2026, 10:00' }, { orderNo: 'PO-2', sku: 'B', pieces: 100, cutDate: '22/11/2026, 11:00' }, { orderNo: 'PO-9', sku: 'B', pieces: 7, cutDate: '01/11/2026, 09:00' }] });
    click(S, 'cdkcut', x.s.key);
    const d = S.ctx.__dlg, f = k => d.fields.find(z => z.key === k);
    ok('opens a card for that line', d && d.title === 'Cutting entry' && d.saveLabel === 'Save cutting' && d.subtitle.includes('PO-2'));
    ok('fields: pieces, date, fabric, cloth used, waste, waste width, remarks', d.fields.map(z => z.key).join() === 'pcs,date,fabric,used,waste,wasteW,remarks');
    ok('the pieces come filled with what is left to cut, the date with today', f('pcs').value === 150 && f('date').value === '2026-11-25');
    ok('the fabric is the line\'s own, first in the list and not offered twice', f('fabric').value === 'Sheeting 82' && f('fabric').options[0][0] === 'Sheeting 82' && f('fabric').options.filter(p => p[0] === 'Sheeting 82').length === 1);
    ok('the cloth box says what a blank takes', /blank takes 0\.9 m a piece/.test(f('used').label) && f('used').value === '');
    ok('the remarks carry the printed fabric', f('remarks').value === 'Printed fabric PF-77');
    ok('the card shows the item, what is left and the earlier entries of this line only', d.html.includes('150 of 400') && d.html.includes('20/11/2026 cut 150 · 22/11/2026 cut 100') && !d.html.includes('cut 7'));

    const N = load({ rows: ROWS, may: false }); click(N, 'cdkcut', x.s.key);
    ok('an account without the Cutting right gets no card, and is told why', !N.ctx.__dlg && /Cutting right/.test(N.els.flEmbMsg_pcut.textContent));
    const T = load({ rows: [line('T-1', 'TS', 5, 0, { r: { __t: true } })] }); click(T, 'cdkcut', 'T-1__TS');
    ok('a test line opens its own stand-in form', T.ctx.__testCut === 'T-1|TS' && !T.ctx.__dlg);
  }

  console.log('== saving ==');
  {
    const x = ROWS[1], V = { pcs: '120', date: '2026-11-24', fabric: 'Sheeting 82', used: '', waste: '4', wasteW: '20', remarks: ' second lot ' };
    const S = load({ rows: ROWS, mdb: { B: { cons: 0.9 } } });
    ok('no pieces is refused before the form is touched', (await S.cdkCutSave(x, Object.assign({}, V, { pcs: '0' }))) === 'Type how many pieces were cut.' && !S.drives.length);
    ok('no fabric is refused', /Pick the fabric/.test(await S.cdkCutSave(x, Object.assign({}, V, { fabric: '' }))) && !S.drives.length);
    const err = await S.cdkCutSave(x, V), d = S.drives[0];
    ok('saved through Cutting Data\'s own Save button', err === '' && d && d.saveId === 'cwSave' && d.msgId === 'cwMsg');
    ok('…against this order and SKU', d.set.cwOrd === 'PO-2' && d.sku === 'B');
    ok('…with the pieces, date, fabric, waste, width and remarks typed', d.set.cwPcs === '120' && d.set.cwDate === '2026-11-24' && d.set.cwFabric === 'Sheeting 82' && d.set.cwWaste === '4' && d.set.cwWasteW === '20' && d.set.cwRemarks === 'second lot');
    ok('a blank cloth box takes the planned metres for the pieces cut, rounded once', d.set.cwUsed === '108', d.set.cwUsed);
    ok('…and the form is told to keep those metres', d.typed === '1');
    ok('the line\'s own fabric is allowed while saving, and not after', d.ownOk === 'Sheeting 82' && S.ownOk() === '');
    ok('the list is read again after a save', S.ctx.__refreshed === 1);

    const S2 = load({ rows: ROWS, mdb: { B: { cons: 0.9 } } });
    await S2.cdkCutSave(x, Object.assign({}, V, { used: '111.5', fabric: 'Cambric 90' }));
    ok('cloth typed by hand is kept as typed', S2.drives[0].set.cwUsed === '111.5');
    ok('another fabric of the master is not passed off as the line\'s own', S2.drives[0].ownOk === '');
    const S3 = load({ rows: ROWS });
    await S3.cdkCutSave(x, Object.assign({}, V, { pcs: '7' }));
    ok('where the master has no cloth per piece, a blank stays blank', S3.drives[0].set.cwUsed === '');
    await S3.cdkCutSave(x, Object.assign({}, V, { fabric: 'Linen 60' }));
    ok('a fabric the form\'s list lacks is added to it, so the pick is not lost', S3.els.cwFabric.options.some(o => o.value === 'Linen 60'));

    const R = load({ rows: ROWS, driveErr: 'PO-2 allows only 150 more piece(s).' });
    ok('the form\'s refusal comes back as it is, and the list is not read again', (await R.cdkCutSave(x, V)) === 'PO-2 allows only 150 more piece(s).' && !R.ctx.__refreshed);
    const X = load({ rows: ROWS, driveThrows: true });
    let threw = false; try { await X.cdkCutSave(x, V); } catch (e) { threw = true; }
    ok('a save that breaks still puts the fabric allowance back', threw && X.ownOk() === '');

    /* somebody had half typed another line in Cutting Data's own form */
    const half = S => { Object.assign(S.ctx.$('cwSku'), { value: 'ZZ-9' }).dataset.typed = '1'; S.ctx.$('cwOrd').value = 'PO-77'; S.ctx.$('cwPcs').value = '33'; S.ctx.$('cwUsed').value = '12.5'; S.ctx.$('cwUsed').dataset.typed = '1'; S.ctx.$('cwRemarks').value = 'mine'; };
    const same = S => S.els.cwSku.value === 'ZZ-9' && S.els.cwSku.dataset.typed === '1' && S.els.cwOrd.value === 'PO-77' && S.els.cwPcs.value === '33' && S.els.cwUsed.value === '12.5' && S.els.cwUsed.dataset.typed === '1' && S.els.cwRemarks.value === 'mine' && S.els.cwWaste.value === '';
    const H1 = load({ rows: ROWS }); half(H1); await H1.cdkCutSave(x, V);
    ok('a half-typed Cutting Data form is as it was after a save from the desk', same(H1) && H1.drives[0].sku === 'B');
    const H2 = load({ rows: ROWS, driveErr: 'refused' }); half(H2); const herr = await H2.cdkCutSave(x, V);
    ok('…and after a refusal, with the refusal shown in the pop-up and not left on the form', herr === 'refused' && same(H2) && H2.els.cwMsg.textContent === '');
    const SP = load({ rows: ROWS }), caps = line('PO-8', 'B', 10, 0, { s: { plan: { fabric: { name: 'SHEETING 82' } } } });
    await SP.cdkCutSave(caps, Object.assign({}, V, { fabric: 'Sheeting 82' }));
    ok('a plan that spells the fabric its own way still shows and saves the master\'s spelling, as the line\'s own', SP.cdkTableHtml([caps]).includes('Sheeting 82') && !SP.cdkTableHtml([caps]).includes('SHEETING') && SP.drives[0].set.cwFabric === 'Sheeting 82' && SP.drives[0].ownOk === 'Sheeting 82');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
