/* PHASE 3 DESIGN MOCK — adds mock.html to the offline copy (meera/.preview, made by meera/tests/preview-make.cjs).
 *   node meera/mock/make.cjs   →  http://localhost:8795/mock.html?meera=lazy,spell
 * The real ERP page with the new Ask box drawn over it (mock/phase3/mock.js). Nothing here goes into the ERP. */
const fs = require('fs'), path = require('path');
const PRE = path.join(__dirname, '..', '.preview');
if (!fs.existsSync(path.join(PRE, 'index.html'))) throw new Error('run node meera/tests/preview-make.cjs first');
fs.copyFileSync(path.join(__dirname, 'phase3', 'mock.js'), path.join(PRE, 'mock-phase3.js'));
const page = fs.readFileSync(path.join(PRE, 'index.html'), 'utf8');
fs.writeFileSync(path.join(PRE, 'mock.html'), page + `\n<script src="/mock-phase3.js?v=${Date.now()}"></script>\n`);   // a new name each time: never an old copy
console.log('mock ready: http://localhost:8795/mock.html?meera=lazy,spell');
