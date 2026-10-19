/* THE CLEAN-UP PLAN (Ravi, 15 Oct: "jo data h jiska production pahle complete ho chuka h and in hand working me h — job
 * work issue h but receive nahi hua — wo delete nahi krna; baki current orders sare (pending) delete krne h; vendor order
 * bhi sare cancel"). Read-only: runs the app's own ordLines on a backup file and says which lines are done, which are in
 * hand, which are pending, and what the vendor orders are.   node probes/cleanup-plan.js <backup.json> [out.json] */
const fs = require('fs'), pathm = require('path');
const B = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const src = fs.readFileSync(pathm.join(__dirname, '..', 'prod-test.js'), 'utf8');
const cutAt = src.indexOf('/* ---- real data ---- */'); if (cutAt < 0) throw new Error('harness marker moved');
const head = src.slice(0, cutAt).replace(/__dirname/g, JSON.stringify(pathm.join(__dirname, '..')));
const A = new Function('require', 'process', 'global', head + '\n;return { A, els, ME };')(require, process, global);
const app = A.A, L = app.ptList;
app.setPTG(Object.assign(app.PTG(), { ob: L(B.pt_orderBook), mdb: L(B.pt_masterDB), press: L(B.pt_pressInventory), shopProd: B.pt_shopProd || {} }));
app.setPT(Object.assign(app.PT(), { base: L(B.pt_baseData), cut: L(B.pt_cuttingData) }));
app.setQC(Object.assign({}, app.QC(), { checks: L(B.pt_qcChecks), issue: [], ret: [] }));
app.setORD({ req: {}, busy: false, at: '', rows: [] });
const lines = app.ordLines();
if (process.env.KEYS) { console.log(Object.keys(lines[0]).join(',')); process.exit(0); }
module.exports = { lines, B };
