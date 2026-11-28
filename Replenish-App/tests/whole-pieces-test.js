/* WHOLE PIECES POP-UP (28 Nov 2026): "2.5" typed for pieces was saved as 2 or 3 without a word. A whole-number box now stops
 * it, says so, empties the box and puts the cursor back after Okay; pasted plans and packing files with part pieces are refused.
 *   node tests/whole-pieces-test.js      (APP_DIR=<a broken or older copy of src/app> for the teeth check) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const APP = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : path.join(__dirname, '..', 'src', 'app');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const pending = [];   // checks that wait on a file being read
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };

/* a made-up page: just enough for the pop-up */
function page() {
  const heard = {}, body = [];
  const el = tag => ({ tagName: tag.toUpperCase(), kids: [], style: {}, attrs: {}, isConnected: true, value: '', focused: 0, fired: [],
    appendChild(c) { this.kids.push(c); c.parent = this; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || null; },
    focus() { this.focused++; }, dispatchEvent(e) { this.fired.push(e.type); }, contains(x) { return x === this || this.kids.some(k => k.contains(x)); },
    remove() { const i = body.indexOf(this); if (i >= 0) body.splice(i, 1); } });
  const find = (list, id) => list.reduce((m, e) => m || (e.id === id ? e : find(e.kids, id)), null);
  const ctx = { Event: function (type) { this.type = type; }, document: { createElement: el, getElementById: id => find(body, id),
    body: { appendChild: c => body.push(c) }, addEventListener: (t, f, capture) => { (heard[t] = heard[t] || []).push({ f, capture }); } } };
  vm.createContext(ctx);
  vm.runInContext(read('core/whole-pieces.js') + '\nthis.__t = { wpBad };', ctx);
  const box = (value, step = '1', type = 'number') => { const b = el('input'); b.type = type; b.attrs.step = step; b.value = value; return b; };
  const words = e => [e.textContent || ''].concat(e.kids.map(words)).join(' ');
  /* one event through the listeners in the order they were added, as a browser would */
  const send = (type, target, more) => { const e = Object.assign({ target, stopped: false, prevented: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } }, more);
    for (const l of heard[type] || []) { l.f(e); if (e.stopped) break; } return e; };
  return { ctx, heard, send, body, box, words, byId: id => find(body, id) };
}

console.log('== what is a whole number ==');
{ const { ctx } = page(), bad = ctx.__t.wpBad;
  ok('2.5, 0.1 and 1e3 are stopped', bad('2.5') && bad('0.1') && bad('1e3'));
  ok('2, 0, 2.0, -3 and blank are left to the form', !bad('2') && !bad('0') && !bad('2.0') && !bad('-3') && !bad('') && !bad(null)); }

console.log('== a pieces box ==');
{ const p = page(), b = p.box('');
  p.send('focusin', b); b.value = '2.5';
  const e = p.send('change', b);
  ok('it is caught before the screen\'s own handler', Object.values(p.heard).flat().every(l => l.capture === true));
  ok('the screen never hears the change', e.stopped === true);
  ok('the pop-up says what cannot be saved', p.body.length === 1 && /2\.5 cannot be saved/.test(p.words(p.body[0])), p.body.map(p.words).join());
  ok('an empty box goes back to empty and the screen is told', b.value === '' && b.fired.includes('input'));
  const outside = p.box('4');
  ok('nothing under the open pop-up can be pressed, saved or left', ['click', 'focusout', 'blur', 'change'].every(t => p.send(t, outside).stopped));
  ok('Okay itself can be pressed', !p.send('click', p.byId('wpOk')).stopped);
  p.byId('wpOk').onclick();
  ok('Okay closes it and puts the cursor back', p.body.length === 0 && b.focused === 1);
  ok('after Okay the page hears clicks again', !p.send('click', outside).stopped); }
{ const p = page(), b = p.box('120');
  p.send('focusin', b); b.value = '120.5'; p.send('change', b);
  ok('a box that held a figure gets it back, never a blank', b.value === '120', JSON.stringify(b.value)); }
{ const p = page();
  const heard = [p.box('2'), p.box('2.5', '0.01'), p.box('2.5', 'any'), p.box('2.5', '1', 'text')].map(b => p.send('change', b).stopped);
  ok('whole numbers, metres, money and text boxes are not stopped', p.body.length === 0 && !heard.some(Boolean)); }
{ const p = page(), b = p.box('2.5');
  const e = p.send('keydown', b, { key: 'Enter' });
  ok('Enter does not save a part piece', e.stopped && e.prevented && b.value === ''); }

console.log('== text that is not a number ==');
{ const p = page(), b = p.box('', 'any');
  p.send('focusin', b); b.validity = { badInput: true }; p.send('focusout', b);
  ok('"1-000" is said on leaving the box, on any number box', p.body.length === 1 && /This is not a number/.test(p.words(p.body[0])), p.body.length);
  p.byId('wpOk').onclick(); b.validity = { badInput: false }; p.send('focusout', b);
  ok('a readable or blank box is left alone', p.body.length === 0); }
{ const p = page(), b = p.box('120');
  p.send('focusin', b); b.value = ''; b.validity = { badInput: true };
  const e = p.send('keydown', b, { key: 'Enter' });
  ok('Enter does not save it, and the old figure is back', e.stopped && b.value === '120', b.value); }

{ const p = page(), b = p.box('120');
  p.send('focusin', b); b.value = ''; b.validity = { badInput: true };
  const e = p.send('change', b);
  ok('on change no screen sees the blank: stopped, old figure back, one pop-up', e.stopped && b.value === '120' && p.body.length === 1, b.value);
  b.validity = { badInput: false }; p.send('focusout', b);
  ok('leaving it afterwards says nothing more', p.body.length === 1); }

console.log('== pasted plan and packing file ==');
{ const ctx = { module: { exports: {} } }; vm.createContext(ctx);
  const src = read('replenishment/pack-core.js');
  vm.runInContext(src.slice(0, src.indexOf('const packGuarded')), ctx);
  const parse = ctx.module.exports.planParse;
  const r = parse('SKU\tQuantity\nAAA-1\t2.5\nBBB-2\t3');
  ok('a pasted plan with 2.5 is refused whole', r.lines.length === 0 && r.part === '2.5' && /whole pieces/.test(r.why), JSON.stringify(r));
  const g = parse('SKU\tQuantity\nAAA-1\t2\nBBB-2\t3');
  ok('a whole plan reads as before', g.lines.length === 2 && !g.part && g.why === ''); }
{ const src = read('replenishment/packing-list-labels.js');
  const cut = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)) + b.length);
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext("const pkNum = v => Number(String(v == null ? '' : v).replace(/[, ]/g, '')) || 0; const pkLookupSku = () => null;\n"
    + cut('function pkRowWrong(', '\n}\n') + cut('function pkBuild(', '\n}\n') + 'this.b = pkBuild;', ctx);
  const m = { row: 0, idx: { box: 0, sku: 1, qty: 2 } };
  const r = ctx.b([['box', 'sku', 'qty'], ['1', 'AAA-1', '2.5'], ['1', 'BBB-2', '1,000']], m, { L: 1, W: 1, H: 1 });
  ok('a file row with 2.5 is named by its row', r.wrong.length === 1 && r.wrong[0].row === 2 && /2.5/.test(r.wrong[0].why), JSON.stringify(r.wrong));
  const box = read('replenishment/fba-box-template.js');
  ok('such a file cannot be saved', /\$\('pkSave'\)\.disabled = [^;]*wrong\.length > 0/.test(box) && /wpShow\('This file cannot be saved'/.test(box)); }

console.log('== projection file ==');
{ const src = read('replenishment/replenishment.js');
  const body = src.slice(src.indexOf("$('pjFile').onchange"), src.indexOf("$('pjClear').onclick"));
  const run = async csv => { const seen = { saved: 0, popped: '', err: '' };
    const el = { value: 'm1' }, ctx = { FC_PLAN: [], PROJ_OVR: {}, PROJ_VER: 0, ME: {}, db: 0, nf: String,
      $: () => el, pjErr: t => { if (t) seen.err = t; }, parseCsv: t => t.split('|').map(r => r.split(',')), colIdx: (h, n) => h.findIndex(x => n.includes(x)),
      cellAt: (r, i) => r[i] || '', confirm: () => true, renderRepl() {}, doc() {}, serverTimestamp() {}, pjHave() {}, rMsg() {},
      fsSetDoc: async () => { seen.saved++; }, wpShow: t => { seen.popped = t; } };
    el.classList = { add() {} };
    vm.createContext(ctx); vm.runInContext(body, ctx);
    await el.onchange({ target: { files: [{ text: async () => csv }], value: '' } });
    return seen; };
  pending.push((async () => {
    const r = await run('sku,qty|AAA-1,2.5|BBB-2,3'), g = await run('sku,qty|AAA-1,2|BBB-2,3');
    ok('a projection file with 2.5 saves nothing and names the row', r.saved === 0 && /row 2 · AAA-1 · 2\.5/.test(r.err) && r.popped === 'This file cannot be saved', JSON.stringify(r));
    ok('a whole projection file saves as before', g.saved === 1 && !g.popped, JSON.stringify(g)); })()); }

console.log('== every pieces box is a whole-number box ==');
{ const lines = f => read(f).split(/\n/);
  const fields = [['production/whatsapp.js', ['recv', 'rej']], ['production/job-work-corrections.js', ['issuePieces', 'receivedPieces', 'rejectionPieces']],
    ['shopify/bulk-entry.js', ['cut', 'issued', 'received', 'printed']], ['orders/complete-from-stock.js', ['pcs']], ['orders/shp-board.js', ['pcs', 'iss', 'rec', 'q']]];
  for (const [f, keys] of fields) {
    const found = lines(f).filter(l => /type: 'number'/.test(l) && keys.some(k => l.includes(`key: '${k}'`) || (k === 'q' && l.includes("key: 'q' + i"))));
    ok(`${f}: ${found.length} dialog boxes`, found.length >= keys.length && found.every(l => /step: 1\b/.test(l)), found.filter(l => !/step: 1\b/.test(l)).join());
  }
  for (const [f, marks] of [['flow/flow-qcfg.js', ['id="flfP"', 'id="flfrP"']], ['flow/flow-test-order.js', ['data-tqty="', 'id="fltcP"', 'id="fltiP"', 'id="fltrP"', 'id="fltrX"']],
    ['production/quality-control.js', ['data-qcd-qty="']], ['../index.html', ['id="pmAddAir"', 'id="pmAddSea"']]]) {
    const tags = read(f).match(/<input[^>]*>/g) || [];
    const missing = marks.filter(m => !tags.some(t => t.includes(m) && t.includes('step="1"')));
    ok(f, !missing.length, missing.join());
  }
  ok('accessory boxes still take decimals (they can be metres or kg)',
    !lines('inventory/accessories.js').some(l => /key: '(reorderLevel|qty)'/.test(l) && l.includes("step: '1'")));
  ok('money target boxes still take decimals', /id="tgTotal"[^>]*step="any"/.test(read('../index.html')) && /class="tgIn"[^>]*step="any"/.test(read('replenishment/revenue-target.js')));
  /* a sweep, so a new box is not forgotten: a number box named for money, metres or weight must not be a whole-number box */
  const files = read('ORDER').split('\n').map(f => f.trim()).filter(f => f && !/^[#@]/.test(f)).concat('../index.html');
  const wrong = [];
  for (const f of files) for (const line of read(f).split('\n')) {
    const boxes = (line.match(/<input[^>]*type="number"[^>]*>/g) || []).concat(/type: *'number'/.test(line) && /step: *'?1'?[ ,}]/.test(line) ? [line] : []);
    for (const x of boxes) if (/step(="1"|: *'?1'?[ ,}])/.test(x) && /(₹|\$\)|\(m\)|\bmetres?\b|\bkg\b|\bcm\b|rupees|amount)/i.test(x.replace(/\$\{[^}]*\}/g, ''))) wrong.push(f + ': ' + x.trim().slice(0, 100));
  }
  ok('no box named for money, metres or weight is a whole-number box', !wrong.length, wrong.join(' | '));
  ok('the pop-up is part of the page', /^core\/whole-pieces\.js$/m.test(read('ORDER'))); }

Promise.all(pending).then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
