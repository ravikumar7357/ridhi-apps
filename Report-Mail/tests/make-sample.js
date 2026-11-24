/* Builds a sample mail and the two PDF pages from database export files, so Ravi can see the report before the timer
 * is switched on. Shopify cannot be read from here, so its counts are missing in the sample.
 * Run: node Report-Mail/tests/make-sample.js <folder with the pt_*-export.json files> <output folder> [YYYY-MM-DD]
 * The export files hold live order data: keep them and the output out of the repo. */
const fs = require('fs');
const path = require('path');
const { loadReportMail } = require('./load');

/* [YYYY-MM-DD] = "today" for the sample; [from YYYY-MM-DD] = count from that day to today, as sendErpReportSinceSaturday does. */
const [inDir, outDir, day, fromDay] = process.argv.slice(2);
if (!inDir || !outDir) { console.error('Usage: node make-sample.js <export folder> <output folder> [YYYY-MM-DD]'); process.exit(1); }
const rm = loadReportMail();
const node = (n, optional) => {
  const f = fs.readdirSync(inDir).find(x => x.endsWith('pt_' + n + '-export.json'));
  if (!f && optional) return null;
  if (!f) throw new Error('No export file for pt_' + n + ' in ' + inDir);
  return JSON.parse(fs.readFileSync(path.join(inDir, f), 'utf8'));
};
const data = { ob: node('orderBook'), shopProd: node('shopProd'), cut: node('cuttingData'), base: node('baseData'), press: node('pressInventory'),
  fgi: node('fgiLedger'), so: node('salesOrders'), alerts: node('orderAlerts', true), shop: { orders: [], err: 'not read in this sample (Shopify is read only when the script runs)' }, meta: {} };
const now = day ? Date.parse(day + 'T09:05:00+05:30') : Date.now();
const rep = rm.rmReport(data, now, fromDay || '');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'mail.html'), '<!doctype html><meta charset="utf-8"><title>Sample mail</title>'
  + rm.rmMailHtml(rep, { Production: 'Production.pdf', Shipping: 'Shipping.pdf' }));   // the real mail links the Drive copies
fs.writeFileSync(path.join(outDir, 'Production.html'), rm.rmPdfHtml('Production', rep, rm.rmProductionSections(rep), rm.rmSmallPhoto));
fs.writeFileSync(path.join(outDir, 'Shipping.html'), rm.rmPdfHtml('Shipping', rep, rm.rmShippingSections(rep), rm.rmSmallPhoto));
const n = s => s.map(x => x.title + ' ' + x.rows.length).join(' · ');
console.log('Window ' + rep.win.fromDay + ' – ' + rep.win.lastDay);
console.log('Production: ' + n(rm.rmProductionSections(rep)));
console.log('Shipping:   ' + n(rm.rmShippingSections(rep)));
