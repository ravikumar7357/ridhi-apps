/* THE COMPANY'S GSTIN ON THE RFD DELIVERY CHALLAN (Vishesh, 23 Nov: "add GST number of the company"). The challan prints the
 * company's name, address and GSTIN from the PO settings; the production flow now reads those settings itself, so a challan
 * made from Demand or the Inventory card is not printed without them. Uses the flow tests' own loader (read from
 * tests/flow-test.js, never changed). Made-up company details only.
 *   node tests/challan-gstin-test.js */
const fs = require('fs'), path = require('path');
const DIR = process.env.FLOW_DIR || path.join(__dirname, '..', 'src', 'app', 'flow');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

/* the flow tests' loader, taken as it is */
const test = fs.readFileSync(path.join(__dirname, 'flow-test.js'), 'utf8');
const cut = (a, b) => { const i = test.indexOf(a), j = test.indexOf(b, i); if (i < 0 || j < 0) throw new Error('flow-test.js changed shape: ' + a.slice(0, 30)); return test.slice(i, j); };
const SRC = ['flow-core.js', 'flow-ppc.js', 'flow-demand.js', 'flow-challan.js', 'flow-test-order.js', 'flow-receive.js', 'flow-printorder.js', 'flow-vendor.js', 'flow-edit.js', 'flow-back.js', 'flow-entries.js', 'flow-qcfg.js', 'flow-emb.js', 'flow-view.js', 'flow-report.js']
  .filter(f => fs.existsSync(path.join(DIR, f))).map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
const head = cut('const obUC = ', 'function load(opts)').replace(/^let pass = 0[^\n]*\n/m, '').replace(/^const ok = [^\n]*\n/m, '');
const { load } = new Function('SRC', 'require', head + cut('function load(opts)', 'const plan = (o) =>') + '\n;return { load };')(SRC, require);

const challan = { no: 'RFD-202611-452', date: '2026-11-23', orderNo: 'AMZ-1', orders: ['AMZ-1'], vendor: { code: 'P1', name: 'Sanganer Prints' }, note: '', by: 'ravi',
  lines: [{ key: 'AMZ-1__S1', sku: 'S1', item: 'Square Tablecloth', fabric: 'Sheeting 58', pcs: 10, metres: 15, print: { kind: 'sku', code: 'S1', label: 'printed on the SKU itself' } }] };
const F = load({ me: { admin: true } });

console.log('== the company on the RFD challan ==');
F.ctx.GPO.settings = { company: 'Test Home & Living', address: '12 Test Road, Jaipur', gstin: '08ABCDE1234F1Z5' };
const page = F.flowChallanHtml(challan);
ok('the challan prints the company\'s GSTIN under its name', /Test Home &amp; Living[\s\S]*GSTIN: 08ABCDE1234F1Z5/.test(page));
ok('…and its address', /12 Test Road, Jaipur/.test(page));
F.ctx.GPO.settings = { company: 'Test Home & Living' };
ok('no GSTIN in the PO settings: no empty "GSTIN:" line is printed', !/GSTIN:/.test(F.flowChallanHtml(challan)));

console.log('== the flow reads the company details itself ==');
const view = fs.readFileSync(path.join(DIR, 'flow-view.js'), 'utf8');
ok('when the flow loads its data it reads the PO settings (company details) once, if not read yet',
  /\['company details', typeof GPO !== 'undefined' && !GPO\.settings \? ptGet\('pt_poSettings'\)\.then\(v => \{ if \(!GPO\.settings\) GPO\.settings = v \|\| \{\}; \}\) : null\]/.test(view));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
