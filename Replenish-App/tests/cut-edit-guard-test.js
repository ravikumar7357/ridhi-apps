/* FIX 4 FROM THE PPC TEST (Ravi, 26 Nov). Switch "lineHold" on:
 *  - a cutting entry cannot be lowered, moved to another order or deleted so that its order line has less cut than karigars
 *    were already given (src/app/core/edit-dialog.js — cutBelowIssued, cutEdit's save and delete);
 *  - a placed sales order stays placed when Save is pressed, instead of silently becoming a Draft
 *    (src/app/orders/raise-sales-order.js — soFormSave).
 * Cases are made up.
 *   node tests/cut-edit-guard-test.js      (EDIT_FILE / SO_FILE = copies to test instead) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..', 'src', 'app');
const read = (env, f) => fs.readFileSync(process.env[env] || path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
const EDIT = read('EDIT_FILE', 'core/edit-dialog.js'), SO = read('SO_FILE', 'orders/raise-sales-order.js');
const HIS = fs.readFileSync(path.join(APP, 'core', 'history.js'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const cut = (src, re, end) => { const i = src.search(re); if (i < 0) throw new Error(re + ' not found'); return src.slice(i, src.indexOf(end || '\n}', i) + (end || '\n}').length); };

/** The Cutting Data screen with two entries on OC-1 (30 + 20 = 50 cut) and `issued` pieces given to karigars on OC-1. */
function screen(o) {
  const written = [], deleted = [], up = s => String(s || '').trim().toUpperCase();
  let dialog = null;
  const ctx = {
    console, nf: String, obUC: up, ME: { email: 'cutter@test' }, $: () => ({}), localStorage: { getItem: k => (k === 'lineHold' && !o.off ? '1' : null) },
    PT: { cut: [Object.assign({ id: 'c1', sku: 'MADE-UP', orderNo: o.order || 'OC-1', pieces: 30, cutDate: '01/11/2026', fabricWidth: 'Cotton' }, o.c1 || {}),
                { id: 'c2', sku: 'MADE-UP', orderNo: o.order || 'OC-1', pieces: o.c2 == null ? 20 : o.c2, cutDate: '02/11/2026', fabricWidth: 'Cotton' }] },
    ptCanEdit: () => true, PT_NO_EDIT: 'no', cutOrdersFor: () => [{ orderNo: 'OC-2', left: 100, ordered: 100 }], ptNum: Number, ptIsoDate: d => d,
    cutGuard: () => '', cutMonthFrozen: () => false, ptMonthKey: d => d, ptStampFrom: (a, b) => b, mdbNum: Number, renderPcut: () => {},
    cutSkuOf: () => ({ cuttingRequired: o.noCutting ? false : true }), flowPlanRouteOf: () => (o.jobwork ? 'jobwork' : ''),
    obIssueOfCut: (no) => (no === (o.order || 'OC-1') ? o.issued : 0), obPressQty: (no) => (no === (o.order || 'OC-1') ? o.press || 0 : 0),
    obCutQty: (no, sku, excl) => ctx.PT.cut.filter(r => r.orderNo === no && r.id !== excl)
      .reduce((t, r) => t + r.pieces - (r.rejected === true ? r.rejPieces : 0), 0),
    ptPut: async (p, v) => { written.push([p, v]); }, ptDelete: async p => { deleted.push(p); },
    ptOpenDialog: d => { dialog = d; },
  };
  vm.createContext(ctx);
  vm.runInContext([cut(HIS, /^function lineHoldOn\(/m), cut(EDIT, /^function cutOrderOptions\(/m), cut(EDIT, /^function cutBelowIssued\(/m), cut(EDIT, /^const cutGoodOf/m, '\n'), cut(EDIT, /^function cutEdit\(/m)].join('\n'), ctx);
  ctx.cutEdit('c1');
  return { written, deleted,
    save: v => dialog.onSave(Object.assign({ orderNo: o.order || 'OC-1', pieces: '30', fabricWidth: 'Cotton', fabricUsed: '', fabricWaste: '', fabricWasteWidth: '', remarks: '', cutDate: '' }, v)),
    del: () => dialog.onDelete() };
}

(async () => {
  console.log('== a cutting entry and what karigars were given ==');
  { const s = screen({ issued: 45 }); const said = await s.save({ pieces: '20' });
    ok('lowering 30 to 20 when 45 of the 50 were issued: refused, with both figures', /45 piece\(s\) are already issued/.test(said) && /down to 40/.test(said) && !s.written.length, said); }
  { const s = screen({ issued: 45 }); const said = await s.save({ pieces: '25' });
    ok('lowering 30 to 25 keeps 45 cut: saved', said === '' && s.written.length === 1, said); }
  { const s = screen({ issued: 45 }); const said = await s.save({ orderNo: 'OC-2' });
    ok('moving the entry to another order when OC-1 needs it for what was issued: refused', /down to 20/.test(said) && !s.written.length, said); }
  { const s = screen({ issued: 20 }); const said = await s.save({ orderNo: 'OC-2' });
    ok('moving it when OC-1 keeps enough: saved', said === '' && s.written.length === 1, said); }
  { const s = screen({ issued: 45 }); const said = await s.del();
    ok('deleting it when its pieces were issued: not deleted, says why', /^Not deleted — /.test(said) && /already issued/.test(said) && !s.deleted.length, said); }
  { const s = screen({ issued: 20 }); const said = await s.del();
    ok('deleting it when the rest still covers what was issued: deleted', said === '' && s.deleted.length === 1, said); }
  { const s = screen({ issued: 45, jobwork: true }); const said = await s.del();
    ok('a line PPC sent straight to job work (issued without a cut) is not held to its cut', said === '' && s.deleted.length === 1, said); }
  { const s = screen({ issued: 45, noCutting: true }); const said = await s.save({ pieces: '1' });
    ok('a SKU that needs no cutting is not held to its cut', said === '' && s.written.length === 1, said); }
  { const s = screen({ issued: 45, press: 45 }); const said = await s.save({ pieces: '1' });
    ok('an old order made on press entries counts what was pressed, as the issue form does', said === '' && s.written.length === 1, said); }
  { const s = screen({ issued: 80 }); const said = await s.save({ remarks: 'fabric was Cotton' });
    ok('a line already below (issued before its cut was entered): a change that lowers nothing is saved', said === '' && s.written.length === 1, said); }
  { const s = screen({ issued: 80 }); const said = await s.save({ pieces: '25' });
    ok('…but it cannot be lowered further', /already issued/.test(said) && !s.written.length, said); }
  { const s = screen({ issued: 5, order: 'LEG-17102026-01', c1: { pieces: 3 }, c2: 0 }); const said = await s.del();
    ok('the last cut of a legacy order is deleted: issued on its ordered quantity, as the issue form allows', said === '' && s.deleted.length === 1, said); }
  { const s = screen({ issued: 35, c1: { rejected: true, rejPieces: 10 } }); const said = await s.save({ pieces: '22' });
    ok('an entry with 10 rejected counts only its good pieces: 12 + 20 = 32 is below the 35 issued', /already issued/.test(said) && /down to 32/.test(said), said); }
  { const s = screen({ issued: 45, off: true }); const a = await s.del();
    ok('switch off: deleted as it always was', a === '' && s.deleted.length === 1); }

  console.log('== a placed sales order and Save ==');
  { const keep = cut(SO, /^  const keepPlaced = /m, ';');
    const status = (place, sw, was) => { const ctx = { place, existing: was ? { status: was } : null, soStatus: o => o.status || 'draft', lineHoldOn: () => sw };
      vm.createContext(ctx); vm.runInContext(keep.replace('const keepPlaced', 'var keepPlaced') + '\nvar out = place ? "submitted" : (keepPlaced ? existing.status : "draft");', ctx); return ctx.out; };
    ok('an approved order, Save: stays approved', status(false, true, 'approved') === 'approved');
    ok('a submitted order, Save: stays submitted', status(false, true, 'submitted') === 'submitted');
    ok('a draft or a returned order, Save: a draft, as before', status(false, true, 'draft') === 'draft' && status(false, true, 'returned') === 'draft');
    ok('a new order, Save: a draft', status(false, true, null) === 'draft');
    ok('Place order: submitted', status(true, true, 'approved') === 'submitted');
    ok('switch off: Save on an approved order makes a draft, as it always did', status(false, false, 'approved') === 'draft'); }
  { const ctx = { obUC: s => String(s || '').trim().toUpperCase(), soLines: o => o.lines };
    vm.createContext(ctx);
    vm.runInContext(cut(SO, /^const soLinesOf/m, ';') + '\n' + cut(SO, /^const soQtyOf/m, ';') + '\n' + cut(SO, /^function soQtyDrift\(/m), ctx);
    const was = { lines: [{ sku: 'A', qty: 10 }, { sku: 'b', qty: 5 }] };
    ok('an approved order saved with the same quantities (lines in another order, one SKU split in two): nothing differs',
      ctx.soQtyDrift(was, [{ sku: 'B', qty: 5 }, { sku: 'A', qty: 4 }, { sku: 'A', qty: 6 }]) === '');
    ok('…a quantity changed: that SKU is named', ctx.soQtyDrift(was, [{ sku: 'A', qty: 12 }, { sku: 'B', qty: 5 }]) === 'A');
    ok('…a SKU added or one removed: named', ctx.soQtyDrift(was, [{ sku: 'A', qty: 10 }, { sku: 'C', qty: 1 }]) === 'C, B'); }
  ok('Save on an approved order with other quantities is refused before anything is written, pointing to Change quantity',
    /const drift = keepPlaced && soStatus\(existing\) === 'approved' \? soQtyDrift\(existing, lines\) : '';\n  if \(drift\) return `[^`]*Use Change quantity on the order[^`]*Return to buyer\.`;\n  rec\.status =/.test(SO));
  ok('the save writes that status', /rec\.status = place \? 'submitted' : \(keepPlaced \? existing\.status : 'draft'\);/.test(SO));
  ok('and says the order stays as it was, not "saved as a draft"', /: keepPlaced \? `\$\{rec\._id\} saved — it stays \$\{soStatus\(rec\)\}, as it was\.`/.test(SO));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
