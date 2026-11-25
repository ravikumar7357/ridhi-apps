/* THE BOARDS' REPORT IS A RIGHT (Ravi, 25 Nov: "ye report har kisi ko show n ho, me jisko access du usi ko dikhe or report bhej sake").
 *   node tests/board-report-right-test.js
 * brMay is cut out of src/app/orders/board-report.js and run; the wiring is read from the sources. What must hold: only an admin or somebody
 * with perms.bdReport has it; the board draws no Report button and no report screen without it; a click on PDF / WhatsApp / mail does nothing
 * without it; sign-in reads the right and gives it to admins; the Access page has the box, in both copies; and it is NOT one of the step
 * rights (ticking it must not narrow what steps a person may do on the board). */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const BR = rd('src/app/orders/board-report.js'), SB = rd('src/app/orders/shp-board.js'), AU = rd('src/app/core/auth.js');
const AX = rd('src/app/core/access-design.js'), AXS = rd('../Pricing-App/src/app/core/access-design.js');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' - ' + d : '')); } };

const line = BR.slice(BR.indexOf('const brMay ='), BR.indexOf('\n', BR.indexOf('const brMay =')));
const may = me => new Function('ME', line + '\nreturn brMay();')(me);
ok('an admin has the report', may({ admin: true }) === true);
ok('somebody given "Board - Report" has it', may({ admin: false, bdReport: true }) === true);
ok('everybody else does not - whatever else they hold', may({ admin: false, bdCut: true, bdQc: true, tabs: ['ord'] }) === false);
ok('nobody signed in: no', may(null) === false);

ok('the board draws the Report button only with the right', /typeof renderShpBoardReport === 'function' && brMay\(\) \? `<button type="button" data-shpb-report/.test(SB));
ok('...and the report screen only with the right (a kept "report on" does not open it)', /SHPB\.report && typeof renderShpBoardReport === 'function' && brMay\(\)\) return renderShpBoardReport/.test(SB));
ok('a click on PDF / WhatsApp / mail does nothing without the right', /addEventListener\('click', e => \{\n  if \(!brMay\(\)\) return;/.test(BR));
ok('sign-in reads the right from the access record', /ME\.bdReport = d\.bdReport === true;/.test(AU));
ok('...and an admin has it', /if \(ME\.admin\) ME\.bdReport = true;/.test(AU));
ok('the Access page has the box "Board - Report (see and send)"', /\['bdReport', 'Board — Report \(see and send\)'\]/.test(AX));
ok('...in Sellora\'s copy of the page too (the two are kept the same)', /\['bdReport', 'Board — Report \(see and send\)'\]/.test(AXS));
ok('it is NOT a step right: ticking it does not narrow the board\'s buttons', !/bdReport/.test(SB.slice(SB.indexOf('const SHPB_BD ='), SB.indexOf('\n', SB.indexOf('const SHPB_BD =')))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
