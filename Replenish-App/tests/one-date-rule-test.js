/* ONE DATE RULE (Ravi, 26 Nov 2026, fix 7 of the PPC flow test: a plan went in Ready 03-11-0008, a receive was dated 2099).
 * Pins ptDateErr / ptDateOrderErr in core/helpers.js — 'done' dates from 60 days back to today, an admin's 'fixed' date any day
 * back, 'plan' dates from today to a year ahead, India's today — and that every form the fix touched asks them behind lineHold.
 *   node tests/one-date-rule-test.js
 *   HELPERS_FILE=<a broken copy> node tests/one-date-rule-test.js   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const APP = path.join(__dirname, '..', 'src', 'app');
const SRC = process.env.HELPERS_FILE ? path.resolve(process.env.HELPERS_FILE) : path.join(APP, 'core', 'helpers.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

/* The page's clock, held still: 26 Nov 2026, 10:00 in India (04:30 world time). */
const NOW = Date.UTC(2026, 10, 26, 4, 30);
const RealDate = Date;
const load = now => {
  const ctx = { console, Date: class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, 'utf8') + '\nglobalThis.__D = { ptDateErr, ptDateOrderErr, dTodayIndia };', ctx);
  return ctx.__D;
};
const { ptDateErr: err, ptDateOrderErr: order, dTodayIndia } = load(NOW);

console.log('== India\'s today ==');
ok('10:00 in India on 26 Nov is 26 Nov', dTodayIndia() === '2026-11-26');
ok('01:00 in India on 27 Nov (19:30 world time on the 26th) is already 27 Nov', load(Date.UTC(2026, 10, 26, 19, 30)).dTodayIndia() === '2026-11-27');

console.log('== dates when something happened (cut, issue, PO date) ==');
ok('today is fine', err('2026-11-26', 'Cutting date', 'done') === '');
ok('60 days back is fine, 61 is refused', err('2026-09-27', 'Cutting date', 'done') === '' && /more than 60 days back — ask an admin/.test(err('2026-09-26', 'Cutting date', 'done')));
ok('tomorrow is refused', /27-11-2026 is in the future/.test(err('2026-11-27', 'Cutting date', 'done')));
ok('the test\'s 2099 is refused', /in the future/.test(err('2099-01-05', 'Receive date', 'done')));
ok('the year 0008 is refused', /more than 60 days back/.test(err('0008-11-03', 'Issue date', 'done')));
ok('an admin\'s correction may go back any distance, never ahead', err('2025-01-10', 'Issue date', 'fixed') === '' && /in the future/.test(err('2026-12-01', 'Issue date', 'fixed')));

console.log('== planned dates (PPC cut / QC / ready, PO delivery) ==');
ok('today and a year ahead are fine', err('2026-11-26', 'Ready date', 'plan') === '' && err('2027-11-27', 'Ready date', 'plan') === '');
ok('the test\'s Ready 03-11-0008 is refused, in the floor\'s way of writing it', err('0008-11-03', 'Ready date', 'plan') === 'Ready date 03-11-0008 is before today — pick a date from today on.');
ok('yesterday is refused', /before today/.test(err('2026-11-25', 'Ready date', 'plan')));
ok('more than a year ahead is refused', /more than a year ahead/.test(err('2027-11-28', 'Ready date', 'plan')) && /year ahead/.test(err('2099-01-01', 'QC date', 'plan')));
ok('a date an edited plan already had is left alone', err('2026-10-01', 'Ready date', 'plan', '2026-10-01') === '' && /before today/.test(err('2026-10-02', 'Ready date', 'plan', '2026-10-01')));

console.log('== blanks and nonsense ==');
ok('blank is the form\'s own business', err('', 'Ready date', 'plan') === '' && err(null, 'Cutting date', 'done') === '');
ok('not a date is refused', /"31-13-2026" is not a date/.test(err('31-13-2026', 'Cutting date', 'done')) && /not a date/.test(err('2026-02-31x', 'Cutting date', 'done')));
ok('31 Feb and month 13 are refused, never rolled over or thrown', /"2026-02-31" is not a date/.test(err('2026-02-31', 'Cutting date', 'done')) && /"2026-13-01" is not a date/.test(err('2026-13-01', 'Ready date', 'plan')));
ok('a stamped date-and-time reads as its day', err('2026-11-26T09:15:00', 'Issue date', 'done') === '');

console.log('== dates in order ==');
ok('Cut, QC, Ready in order is fine; same day is fine', order([['Cut', '2026-11-28'], ['QC', '2026-12-02'], ['Ready', '2026-12-02']]) === '');
ok('Ready before QC is refused, naming both', order([['Cut', '2026-11-28'], ['QC', '2026-12-02'], ['Ready', '2026-11-30']]) === 'Ready date 30-11-2026 is before the QC date 02-12-2026.');
ok('a blank step is skipped', order([['Cut', '2026-12-05'], ['QC', ''], ['Ready', '2026-12-01']]) === 'Ready date 01-12-2026 is before the Cut date 05-12-2026.');

console.log('== every form the fix touched asks the rule, behind switch lineHold ==');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8');
const asks = (f, re) => { const s = read(f); return re.test(s) && /lineHoldOn\(\)/.test(s); };
ok('PPC plan form: cut, QC, ready, in order, an edit\'s old dates left alone', asks('flow/flow-ppc.js', /ptDateErr\(d\[k\], `\$\{p\.sku\} · \$\{label\} date`, 'plan', was\[k\]\)/) && /ptDateOrderErr\(\[\['Cut', d\.cut\], \['QC', d\.qc\], \['Ready', d\.ready\]\]\)/.test(read('flow/flow-ppc.js')));
ok('Cutting form', asks('core/look-alike-skus.js', /ptDateErr\(date, 'Cutting date', 'done'\)/));
ok('Karigar issue', asks('production/job-work-entry.js', /ptDateErr\(date, 'Issue date', 'done'\)/));
ok('Karigar edit box and corrections tool: an admin\'s correction, receiving not before issue', asks('production/job-work-corrections.js', /ptDateErr\(iss, 'Issue date', 'fixed', ptIsoDate\(r\.issueDate\)\)/)
  && /has\('issueDate'\) \? ptDateErr\(iss, 'Issue date', 'fixed'\)/.test(read('production/job-work-corrections.js'))
  && (read('production/job-work-corrections.js').match(/ptDateOrderErr\(\[\['Issue', iss\], \['Receiving', rcv\]\]\)/g) || []).length === 2);
ok('Greige PO: PO date done, delivery planned and not before the PO', asks('vendors/greige/greige-po.js', /ptDateErr\(plan\.po\.date, 'PO date', 'done', was\.date\)/) && /ptDateErr\(plan\.po\.deliveryDate, 'Delivery date', 'plan', was\.deliveryDate\)/.test(read('vendors/greige/greige-po.js')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
