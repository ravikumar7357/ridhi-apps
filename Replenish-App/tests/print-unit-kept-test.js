/* PIECES OR RUNNING CLOTH - WHO DECIDES (Ravi, 26 Nov: lampshades and napkins shown as pieces on "Orders with printers - receive" though they were
 * given to the printer as running cloth).
 *   node tests/print-unit-kept-test.js
 * flowPrintKept and flowPrintWhat are cut out of src/app/flow/flow-challan.js and run against stubs. What must hold:
 *  - a line on a print order keeps the unit that print order was made in, whatever the master says today (both ways);
 *  - a line on no print order yet: the master decides as before (No = cut pieces, Yes = running cloth), whatever the printing rule says;
 *  - embroidery is always running cloth; a print order that is cancelled keeps nothing. */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'flow', 'flow-challan.js'), 'utf8').replace(/\r\n/g, '\n');
const PO = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'flow', 'flow-printorder.js'), 'utf8').replace(/\r\n/g, '\n');
const CORE = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'flow', 'flow-core.js'), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' - ' + d : '')); } };
const cut = (src, name) => { const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const line = (src, head) => { const i = src.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return src.slice(i, src.indexOf('\n', i)) + '\n'; };
const CODE = [line(CORE, 'const flowKey ='), line(PO, 'let FLOW_POX ='), cut(PO, 'flowPoIndex'), cut(SRC, 'flowPrintKept'), cut(SRC, 'flowPrintWhat')].join('\n');

function what(o) {
  const ctx = {
    FLOW: { po: o.po || {} }, obUC: s => String(s == null ? '' : s).trim().toUpperCase(),
    cutSkuOf: () => ({ cuttingRequired: o.cut, fabric: 'Cambric', color: 'Agate Green', articleType: 'Lampshade', subtype: 'Small Lampshade' }),
    flowRouteOf: () => (o.emb ? 'emb' : 'inhouse'), ptPrintIssueAs: () => o.rule || '', ordColCodeOf: () => '005',
    flowFabDirs: () => ['Vertical'], flowDirDefault: () => 'Vertical', flowDirAsked: () => false, flowDirAuto: d => d[0], flowFabHits: () => [{ sku: 'AGTG', side: '' }],
  };
  const names = Object.keys(ctx);
  return new Function(...names, CODE + '\nreturn flowPrintWhat({ orderNo: "AMZ-17102026-02-SEA", sku: "CPCLS005", color: "Agate Green" }, { print: {} });')(...names.map(k => ctx[k]));
}
const K = 'AMZ-17102026-02-SEA__CPCLS005';
const po = (kind, more) => ({ 'PRN-1': Object.assign({ no: 'PRN-1', items: { [K]: { pcs: 500, metres: 175, unit: kind === 'sku' ? 'pcs' : 'm', print: { kind } } } }, more || {}) });

ok('given as running cloth, master now says Cutting required: No -> still running cloth, metres (the lampshade)', what({ cut: false, po: po('fabric') }).unit === 'm' && what({ cut: false, po: po('fabric') }).code === 'AGTG', JSON.stringify(what({ cut: false, po: po('fabric') })));
ok('given as cut pieces, master now says Yes -> still cut pieces', what({ cut: true, po: po('sku') }).unit === 'pcs');
ok('given as cut pieces, a "Running cloth" rule added later -> still cut pieces (pieces already sent are not read as metres)', what({ cut: false, rule: 'running', po: po('sku') }).unit === 'pcs');
ok('a cancelled print order keeps nothing: the master decides again', what({ cut: false, po: po('fabric', { cancelled: { at: 'x' } }) }).unit === 'pcs');
ok('a NEW line, master No, rule "Running cloth": cut pieces - the master row beats the print rule (Ravi, 10 Oct), unchanged', what({ cut: false, rule: 'running' }).unit === 'pcs');
ok('a new line, master No, no rule: cut pieces, as before', what({ cut: false }).unit === 'pcs' && what({ cut: false }).kind === 'sku');
ok('a new line, master No, rule "cut": cut pieces', what({ cut: false, rule: 'cut' }).unit === 'pcs');
ok('a new line, master Yes, no rule: running cloth, as before', what({ cut: true }).unit === 'm' && what({ cut: true }).mode === 'Running fabric');
ok('a new line, master Yes, rule "cut": running cloth, cut here from the printed fabric (as before)', what({ cut: true, rule: 'cut' }).unit === 'm' && /cut here/.test(what({ cut: true, rule: 'cut' }).mode));
ok('embroidery is running cloth even on a line given as pieces', what({ cut: false, emb: true, po: po('sku') }).unit === 'm');
ok('the flow reads the unit of a line through this one function (flow-core.js)', /const pcsWise = flowPrintWhat\(r, p\)\.kind === 'sku'/.test(CORE));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
