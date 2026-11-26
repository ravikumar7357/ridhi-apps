/* Form memory: my previous entry of a form in grey, Tab fills and moves on, Enter moves to the next box (this PC only).
 * Ravi, 26 Nov 2026. Runs src/app/core/form-memory.js on made-up boxes, and checks each entry form is wired to it.
 * Run: node tests/form-memory-test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = path.join(__dirname, '..', 'src', 'app');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };

/* ---- a tiny page ---- */
let store = {}, logs = [];
const ctx = {
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  console: { info: m => logs.push(m), log: console.log },
  Event: function (t) { this.type = t; },
  setTimeout: f => f(),
};
vm.createContext(ctx);
vm.runInContext(read('core/form-memory.js'), ctx);

function box(id, o) {
  return Object.assign({
    id, type: 'text', tagName: 'INPUT', value: '', placeholder: 'example', attrs: {}, dataset: {}, fired: [], offsetParent: {},
    setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    dispatchEvent(e) { this.fired.push(e.type); }, focus() { ctx.focused = this; }, closest: () => null,
  }, o || {});
}
function form(boxes) {
  return { boxes, dataset: {}, keys: [], querySelectorAll: () => boxes, addEventListener(t, f) { this.keys.push(f); } };
}
const key = (f, k, target, shift) => { let stopped = false; f.keys.forEach(h => h({ key: k, shiftKey: !!shift, target, preventDefault() { stopped = true; } })); return stopped; };

console.log('Remember after a save, show in grey next time');
let fab = box('fab'), who = box('who'), date = box('date', { type: 'date' }), kind = box('kind', { tagName: 'SELECT', options: [{ value: 'IN' }, { value: 'OUT' }] });
fab.value = ' CAMBRIC '; who.value = 'Mill A'; date.value = '2026-11-26'; kind.value = 'OUT';
ctx.frmRemember('fabricEntry', form([fab, who, date, kind]));
const kept = JSON.parse(store['formMemory:fabricEntry']);
ok(kept.fab === 'CAMBRIC' && kept.who === 'Mill A' && kept.kind === 'OUT', 'each box is kept, trimmed');
ok(!('date' in kept), 'a date is never remembered');

const fab2 = box('fab'), who2 = box('who', { value: 'Typed' }), kind2 = box('kind', { tagName: 'SELECT', value: '', placeholder: '', options: [{ value: 'IN' }, { value: 'OUT' }] }), other = box('other');
const f2 = form([fab2, who2, kind2, other]);
ctx.frmWire('fabricEntry', f2);
ok(fab2.placeholder === 'CAMBRIC', 'previous value shows in grey');
ok(other.placeholder === 'example', 'a box with nothing remembered keeps its own example');
ok(kind2.placeholder === '', 'a list box gets no grey text');
ctx.frmWire('fabricEntry', f2);
ok(f2.keys.length === 1, 'opening the same form again does not double the keys');
ok(ctx.frmRead("cuttingEntry").fab === undefined, "each form has its own memory");

console.log('Tab fills an empty box and moves on');
ok(!key(f2, 'Tab', fab2), 'Tab is not held back: it still moves on');
ok(fab2.value === 'CAMBRIC' && fab2.fired.join() === 'input,change', 'empty box takes the previous value and says so');
key(f2, 'Tab', who2);
ok(who2.value === 'Typed', 'a typed box is never changed');
key(f2, 'Tab', kind2);
ok(kind2.value === 'OUT', 'a list box takes the previous choice');
const gone = box('kind', { tagName: 'SELECT', value: '', options: [{ value: 'IN' }], attrs: { 'data-frm': 'OUT' } });
ok(ctx.frmFillOf(gone) === '', 'a choice no longer on the list is not forced in');
const back = box('x', { attrs: { 'data-frm': 'v' } });
const fb = form([back]); ctx.frmWire("shiftTest", fb);
key(fb, "Tab", back, true);
ok(back.value === '', 'Shift+Tab goes back without filling');
ok(ctx.frmFillOf(box('r', { readOnly: true, attrs: { 'data-frm': 'v' } })) === '', 'a read-only box is not filled');

console.log('Enter moves to the next box');
const a = box('a'), hid = box('h', { offsetParent: null }), b = box('b'), c = box('c'), area = box('t', { tagName: 'TEXTAREA' });
const f3 = form([a, hid, b, c]); ctx.frmWire('enterTest', f3);
ctx.focused = null;
ok(key(f3, 'Enter', a) && ctx.focused === b, 'Enter skips a hidden box and stops the old Enter');
ctx.focused = null;
ok(!key(f3, 'Enter', c) && ctx.focused === null, 'on the last box Enter does what it always did');
ctx.focused = null; key(f3, 'Enter', area);
ok(ctx.focused === null, 'Enter in a text area makes a new line as before');
const listed = box('l', { attrs: { list: 'x' } }); const f4 = form([listed, b]); ctx.frmWire('listTest', f4);
ctx.focused = null;
ok(!key(f4, 'Enter', listed) && ctx.focused === b, 'a box with the browser list keeps its Enter pick, then moves on');

console.log('Storage that fails');
ctx.localStorage.getItem = () => { throw new Error('blocked'); };
ctx.localStorage.setItem = () => { throw new Error('full'); };
logs = [];
ok(JSON.stringify(ctx.frmRead('x')) === '{}', 'unreadable storage: no grey values, no error');
ctx.frmRemember('x', form([box('a')]));
ok(logs.length === 2 && /could not read/.test(logs[0]) && /could not keep/.test(logs[1]), 'each failure leaves a console line');

console.log('A form that stays on the page, and the shared dialog');
ctx.localStorage.getItem = k => (k in store ? store[k] : null);
ctx.localStorage.setItem = (k, v) => { store[k] = String(v); };
store = { 'formMemory:press': JSON.stringify({ pcs: '40' }) };
const pcs = box('pcs', { placeholder: '0' }), fp = form([pcs]);
ctx.frmWire('press', fp);
ok(pcs.placeholder === '40', 'first entry shows in grey');
store['formMemory:press'] = JSON.stringify({ pcs: '' });
ctx.frmWire('press', fp);
ok(pcs.placeholder === '0' && pcs.getAttribute('data-frm') === null, 'newest entry left it empty: its own example comes back');
const shared = box('s', { attrs: { 'data-frm': 'old' } }), dlg = form([shared, box('s2')]);
ctx.frmWire('fabricEntry', dlg); ctx.frmWire('', dlg);   // the shared dialog was used by a form that takes part, then by one that does not
ctx.focused = null;
ok(!key(dlg, 'Tab', shared) && shared.value === '' && !key(dlg, 'Enter', shared) && ctx.focused === null,
  'a dialog that does not take part: Tab and Enter do what they did');

console.log('Forms wired');
const fabric = read('vendors/greige/fabric-flow.js');
ok(fabric.includes("memory: 'fabricEntry',"), 'Fabric entry takes part');
ok(['fbeFabList', 'fbeLotList', 'fbeSizeList', 'fbeCpList'].every(id => fabric.includes(`<datalist id="${id}">`)), 'Fabric entry looks as it did');
ok(/^core\/form-memory\.js$/m.test(read('ORDER')), 'form memory is joined into the page');
const dlgSrc = read('core/edit-dialog.js');
ok(dlgSrc.includes("frmWire(cfg.memory || '', $('ptDlgBody'))"), 'every dialog opening says whether it takes part');
ok(/if \(err\) ptDlgMsg\(err, true\);\s*else \{ if \(PTD\.memory\) frmRemember\(PTD\.memory, \$\('ptDlgBody'\)\); ptDlgClose\(\); \}/.test(dlgSrc),
  'a dialog remembers only after a save that worked');
/* the dialogs that make a NEW entry, by file and name; an edit of an existing row takes no part */
[['inventory/finished-goods.js', "'fgReceive'"], ['inventory/finished-goods.js', "'fgOpening'"], ['inventory/finished-goods.js', "'fgTransfer'"],
  ['inventory/fg-other-movements.js', "'fgMovement:' + type"], ['inventory/store.js', "'storeEntry'"], ['shopify/returns.js', "id ? '' : 'shopifyReturn'"],
  ['orders/raise-sales-order.js', "editing ? '' : 'salesOrder'"], ['flow/flow-challan.js', "'karigarChallan'"], ['flow/flow-receive.js', "'flowReceive'"],
  ['vendors/orders/place-vendor-order.js', "'vendorOrder'"], ['flow/flow-qcfg.js', "'fgAccept'"], ['flow/flow-qcfg.js', "'fgReject'"],
  ['production/whatsapp.js', "'jobWorkReceive'"]]
  .forEach(([f, name]) => ok(read(f).includes('memory: ' + name + ','), f + ' takes part as ' + name));
/* the forms that stay on the page: shown when drawn, remembered right after the write and before the boxes are cleared */
[['production/job-work-entry.js', 'jobWorkIssue', 'bwBox', "const why = await bdWrite(entry);"],
  ['production/press.js', 'pressEntry', 'pwBox', "await ptPut('pt_pressInventory/"],
  ['production/quality-control.js', 'qcCheck', 'qcwBox', "await ptPut('pt_qcChecks/"],
  ['production/quality-control.js', 'qcIssue', 'qciBox', "await ptPut('pt_qcIssuance/"],
  ['production/quality-control.js', 'qcReturn', 'qcrBox', "await ptPut('pt_qcReturns/"],
  ['core/look-alike-skus.js', 'cuttingEntry', 'cwBox', 'const why = await cutWrite(entry);']].forEach(([f, name, root, write]) => {
  const src = read(f), rem = src.indexOf(`frmRemember('${name}', $('${root}'))`), at = src.indexOf(write);
  ok(src.includes(`frmWire('${name}', $('${root}'))`), name + ' shows my previous entry');
  ok(rem > at && at > 0 && src.slice(at, rem).split('\n').length <= 3, name + ' remembers right after the save worked');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
