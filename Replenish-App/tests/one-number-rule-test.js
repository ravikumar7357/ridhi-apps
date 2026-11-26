/* ONE NUMBER RULE (Ravi, 26 Nov 2026, fix 6 of the PPC flow test: the plan form raised -5 m a piece, -250 m in all, and the
 * cutting, karigar and QC forms saved 2.5 pieces as 2). Pins ptNumErr / ptNumBig in core/helpers.js, and that every form the
 * fix touched asks them, behind switch lineHold, before it saves.
 *   node tests/one-number-rule-test.js
 *   HELPERS_FILE=<a broken copy> node tests/one-number-rule-test.js   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const APP = path.join(__dirname, '..', 'src', 'app');
const SRC = process.env.HELPERS_FILE ? path.resolve(process.env.HELPERS_FILE) : path.join(APP, 'core', 'helpers.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(SRC, 'utf8') + '\nglobalThis.__N = { ptNumErr, ptNumBig };', ctx);
const { ptNumErr: err, ptNumBig: big } = ctx.__N;

console.log('== pieces: whole and above 0 ==');
ok('12 pieces is fine', err('12', 'Pieces', 'pcs') === '');
ok('2.5 pieces is refused, never cut down to 2', /whole pieces — you typed 2\.5/.test(err('2.5', 'Pieces', 'pcs')));
ok('-5 pieces is refused', /cannot be below 0 — you typed -5/.test(err('-5', 'Pieces', 'pcs')));
ok('0 pieces is refused', /more than 0/.test(err('0', 'Pieces', 'pcs')));
ok('blank is refused', /type a number/.test(err('', 'Pieces', 'pcs')) && /type a number/.test(err(null, 'Pieces', 'pcs')));
ok('letters are refused', /"12abc" is not a number/.test(err('12abc', 'Pieces', 'pcs')));
ok('0 or blank rejected pieces is fine where 0 is a real answer', err('0', 'Rejected', 'pcs', true) === '' && err('', 'Rejected', 'pcs', true) === '');
ok('…but part pieces are still refused there', /whole pieces/.test(err('1.5', 'Rejected', 'pcs', true)));
ok('the message names the box', err('-1', 'Pieces issued', 'pcs').startsWith('Pieces issued'));

console.log('== metres and rupees ==');
ok('metres may have decimals', err('1.75', 'Metres / piece', 'm') === '');
ok('the test\'s -5 metres a piece is refused', /cannot be below 0 — you typed -5/.test(err('-5', 'Metres / piece', 'm')));
ok('0 metres is refused unless 0 is allowed', /more than 0/.test(err('0', 'Metres / piece', 'm')) && err('0', 'Waste', 'm', true) === '');
ok('a rate of 0 is fine, a minus rate is not', err('0', 'Rate', 'rs') === '' && /below 0/.test(err('-10', 'Rate', 'rs')));

console.log('== big figures are asked about (Ravi, 26 Nov: 1,500 pcs / 3,000 m) ==');
ok('1,500 pieces is not asked about, 1,501 is', big(1500, 'Pieces', 'pcs') === '' && /1,501 pcs is more than 1,500 pcs/.test(big(1501, 'Pieces', 'pcs')));
ok('3,000 m is not asked about, 3,000.5 is', big(3000, 'Fabric', 'm') === '' && /more than 3,000 m/.test(big(3000.5, 'Fabric', 'm')));
ok('rupees are never asked about', big(999999, 'Rate', 'rs') === '');

console.log('== every form the fix touched asks the rule, behind switch lineHold ==');
const read = f => fs.readFileSync(path.join(APP, f), 'utf8');
const asks = (f, re) => { const s = read(f); return re.test(s) && /lineHoldOn\(\)/.test(s); };
ok('PPC plan form: metres a piece and accessories', asks('flow/flow-ppc.js', /ptNumErr\(inp\.value, [^;]*'m', !fab \|\| noCloth\)/));
ok('PPC plan form: big fabric total asked about, not for a line raising no cloth', /pick\(i\) && !flowPpcNoCloth\(p\) \? ptNumBig\(flowR2\(\(\+p\.fabric\.perPc \|\| 0\) \* \(\+p\.qty \|\| 0\)\)/.test(read('flow/flow-ppc.js')));

console.log('== which plan lines raise no cloth (reviewer, 26 Nov: a Job Work line with 0 m a piece was refused) ==');
{ const PPC = process.env.PPC_FILE ? path.resolve(process.env.PPC_FILE) : path.join(APP, 'flow', 'flow-ppc.js');
  const core = read('flow/flow-core.js').replace(/\r\n/g, '\n'), ppc = fs.readFileSync(PPC, 'utf8').replace(/\r\n/g, '\n');
  const line = (s, re) => { const m = s.match(re); if (!m) throw new Error(String(re) + ' not found'); return m[0]; };
  const c2 = { console };
  vm.createContext(c2);
  vm.runInContext([line(core, /^const flowRouteOf = .*$/m), line(core, /^const flowInHand = .*$/m), line(ppc, /^const flowPpcNoCloth = .*$/m),
    'globalThis.__NC = flowPpcNoCloth;'].join('\n'), c2);
  const nc = (route, noRfd) => c2.__NC({ route, fabric: { noRfd } });
  ok('outsourced and Job Work lines raise no cloth', nc('outsource', false) && nc('jobwork', false));
  ok('cloth already in hand on Cutting or Embroidery raises none', nc('stitch', true) && nc('emb', true));
  ok('printed, embroidered and cutting lines need their metres', !nc('inhouse', false) && !nc('emb', false) && !nc('stitch', false));
  ok('the in-hand tick means nothing on a printed line', !nc('inhouse', true));
}
ok('Cutting form: pieces and fabric metres', asks('core/look-alike-skus.js', /ptNumErr\(\$\('cwPcs'\)\.value, 'Pieces cut', 'pcs'\)/) && /\['cwWaste', 'Fabric waste'\]/.test(read('core/look-alike-skus.js')));
ok('Karigar issue: pieces, and a Custom order\'s big count', asks('production/job-work-entry.js', /ptNumErr\(\$\('bwPcs'\)\.value, 'Pieces issued', 'pcs'\)/) && /custom \? ptNumBig\(pcs/.test(read('production/job-work-entry.js')));
ok('Karigar edit box: issued, received, rejected', asks('production/job-work-corrections.js', /ptNumErr\(\$\('bdmIssue'\)\.value/) && /ptNumErr\(\$\('bdmRej'\)\.value, 'Rejection pieces', 'pcs', true\)/.test(read('production/job-work-corrections.js')));
ok('Karigar corrections tool: changed figures', /has\(k\) \? ptNumErr\(c\[k\], label, 'pcs', zeroOk\)/.test(read('production/job-work-corrections.js')));
ok('QC check and QC return', asks('production/quality-control.js', /ptNumErr\(\$\('qcwChecked'\)\.value/) && /ptNumErr\(\$\('qcrPcs'\)\.value/.test(read('production/quality-control.js')));
ok('Greige PO: big line asked about', asks('vendors/greige/greige-po.js', /ptNumBig\(l\.metres, l\.greige, 'm'\)/));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
