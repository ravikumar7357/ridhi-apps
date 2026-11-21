/* METRES AND RATES TAKE NUMBERS ONLY (Ravi, 21 Nov: the New greige PO's Metres box took "E99890"; "only number can be
 * entered and only upto 7 digits"). Pins cleanNumber — digits and one point, 7 digits before it, 2 after — and that every
 * metre and rate box on the Greige Desk is one of these boxes, none a browser number box (which lets "e" in).
 * Loads the real src/app/flow/greige-desk.js.
 *   node tests/greige-number-boxes-test.js
 *   GD_FILE=<a broken copy> node tests/greige-number-boxes-test.js   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = process.env.GD_FILE ? path.resolve(process.env.GD_FILE) : path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

const code = fs.readFileSync(SRC, 'utf8');
const anchor = '  return { open: open,';
if (code.split(anchor).length !== 2) throw new Error('greige-desk.js: the closing "return { open" line moved; update this test');
const ctx = { console, window: { document: {} } };
vm.createContext(ctx);
vm.runInContext(code.replace(anchor, '  globalThis.__GDT = { cleanNumber: cleanNumber };\n' + anchor), ctx);
const clean = ctx.__GDT.cleanNumber;

console.log('== what can be typed ==');
ok('the screenshot\'s "E99890" keeps only the number', clean('E99890') === '99890');
ok('a plain figure stays as it is', clean('1250') === '1250' && clean('1250.5') === '1250.5' && clean('0.75') === '0.75');
ok('letters, signs and spaces go', clean('1e3') === '13' && clean('-500') === '500' && clean('+12 00') === '1200' && clean('12,000') === '12000');
ok('7 digits before the point at most', clean('12345678') === '1234567' && clean('9999999.99') === '9999999.99');
ok('2 digits after the point at most', clean('100.456') === '100.45');
ok('one decimal point only', clean('1.2.3') === '1.23' && clean('..5') === '.5');
ok('empty stays empty', clean('') === '' && clean(null) === '');
ok('a point being typed is kept (so "12." can become "12.5")', clean('12.') === '12.');

console.log('== every metre and rate box is a number-only box ==');
const boxes = code.match(/<input[^>]*>/g) || [];
const named = (re) => boxes.filter(b => re.test(b));
ok('no browser number box is left for metres or rates', !boxes.some(b => /type=\\?"number\\?"/.test(b) && /metre|rate|qty|data-f=\\?"m\\?"|data-chk|enQty|enReturned/i.test(b)),
  boxes.filter(b => /type=\\?"number\\?"/.test(b)).map(b => b.slice(0, 60)).join(' | '));
[['PO metres', /data-f="metres"/], ['PO rate', /data-f="rate"/], ['bale metres (receive greige)', /aria-label="Metres, bale/], ['than metres (receive RFD)', /aria-label="Metres, than/],
  ['measured at the door', /data-chk=/], ['issue to RFD', /data-issqty=/], ['send to cutting', /data-cutqty=/], ['entry metres', /id=\\"enQty\\"/], ['entry sent back', /id=\\"enReturned\\"/]]
  .forEach(([what, re]) => { const b = named(re); ok(what + ' is a number-only box', b.length >= 1 && b.every(x => /data-num=\\?"7\\?"/.test(x)), b.map(x => x.slice(0, 80)).join(' | ') || 'not found'); });
ok('a discount % takes 3 digits before the point', clean('1234.567', 3) === '123.56' && clean('2.5', 3) === '2.5');
ok('the PO line discount box is a 3-digit number-only box', /data-f="disc"[^>]*data-num="' \+ PCT_WHOLE_DIGITS \+ '"/.test(code) && /var NUM_WHOLE_DIGITS = 7, NUM_DECIMALS = 2, PCT_WHOLE_DIGITS = 3;/.test(code));
ok('each box is cleaned to its own digit limit', /cleanNumber\(was, parseInt\(el\.getAttribute\('data-num'\), 10\)\)/.test(code));
ok('the boxes are cleaned as they are typed', /addEventListener\('input', function \(ev\) \{\s*var el = ev\.target;\s*if \(!el \|\| !el\.hasAttribute \|\| !el\.hasAttribute\('data-num'\)\) return;/.test(code));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
