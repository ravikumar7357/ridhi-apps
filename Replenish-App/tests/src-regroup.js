/* ONE-TIME, STEP 2 OF THE MODULE PLAN (Ravi, 2026-10-01: "haan step 2 start karo").
 *
 * Puts every piece of src/app/ into the group it belongs to (core/, production/, vendors/rfd/ …) WITHOUT changing the
 * order the pieces are joined in: src/app/ORDER lists the files in today's order, and tests/assemble.js joins them in
 * that order. A piece is cut only at the start of a line, so the joined page is the same bytes as before.
 *
 * Why not move core to the front: top-level const/let run in file order (moving one past its first use breaks the
 * page), and the test harnesses cut the page at its section headings. Real reordering waits for real imports
 * (step 6); this step makes the groups visible and ownable.
 *
 *   node tests/src-regroup.js        (refuses if src/app/ORDER already exists)
 */
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..', 'src', 'app');
if (fs.existsSync(path.join(APP, 'ORDER'))) throw new Error('src/app/ORDER exists — the regroup is done once');

/* file prefix → [ [first line, destination], … ] in order. Line numbers are 1-based in the file as it is now. */
const PLAN = {
  '0010': [[1, 'core/setup.js'], [75, 'core/auth.js'], [294, 'core/nav.js'], [652, 'core/backend.js']],
  '0020': [[1, 'replenishment/replenishment.js']],
  '0030': [[1, 'core/multi-select-filter.js'], [285, 'replenishment/minutes-of-meeting.js']],
  '0040': [[1, 'replenishment/priority.js'], [302, 'replenishment/article-review.js']],
  '0050': [[1, 'replenishment/revenue-target.js']],
  '0060': [[1, 'replenishment/purchase-orders.js'], [201, 'replenishment/follow-ups.js']],
  '0070': [[1, 'replenishment/top-asin.js']],
  '0080': [[1, 'replenishment/shared-lookups.js'], [49, 'replenishment/shopify-stock.js'], [291, 'replenishment/india-stock.js']],
  '0090': [[1, 'replenishment/india-projection.js'], [249, 'replenishment/in-production.js']],
  '0100': [[1, 'replenishment/packing-list-labels.js']],
  '0110': [[1, 'replenishment/fba-box-template.js']],
  '0120': [[1, 'core/database.js'], [71, 'core/live-copies.js'], [141, 'core/database-read.js'],
           [258, 'masters/master-database.js'], [562, 'production/job-work.js']],
  '0130': [[1, 'production/attendance.js'], [301, 'vendors/printing/fabric-catalogue.js']],
  '0140': [[1, 'core/database-auth.js'], [34, 'core/history.js'], [207, 'core/gates.js'], [283, 'core/lookups.js']],
  '0150': [[1, 'core/look-alike-skus.js']],
  '0160': [[1, 'production/job-work-entry.js']],
  '0170': [[1, 'production/whatsapp.js']],
  '0180': [[1, 'production/job-work-corrections.js']],
  '0190': [[1, 'production/press.js'], [274, 'core/edit-dialog.js']],
  '0200': [[1, 'production/quality-control.js']],
  '0210': [[1, 'masters/master-database-edit.js']],
  '0220': [[1, 'masters/asin-from-amazon.js']],
  '0230': [[1, 'orders/custom-order-skus.js']],
  '0240': [[1, 'orders/order-console.js']],
  '0250': [[1, 'orders/production-to-shipping.js'], [263, 'orders/quantity-changes.js']],
  '0260': [[1, 'orders/vendor-holdings.js']],
  '0270': [[1, 'orders/order-console-table.js']],
  '0280': [[1, 'shopify/bulk-entry.js']],
  '0290': [[1, 'orders/demand.js']],
  '0300': [[1, 'orders/tracking.js'], [90, 'orders/shopify-pipeline-team.js']],
  '0310': [[1, 'orders/orders-one-line.js']],
  '0320': [[1, 'dashboard/management-dashboard.js'], [176, 'people-pay/finance-hr.js']],
  '0330': [[1, 'people-pay/printer-rates.js']],
  '0340': [[1, 'people-pay/payouts.js'], [186, 'people-pay/vendor-payout.js']],
  '0350': [[1, 'inventory/fabric.js'], [79, 'vendors/rfd/rfd-stock-auto.js']],
  '0360': [[1, 'vendors/greige/fabric-flow.js']],
  '0370': [[1, 'vendors/greige/greige-po.js']],
  '0380': [[1, 'inventory/accessories.js']],
  '0390': [[1, 'orders/sales-orders.js'], [293, 'orders/quantity-sheet.js']],
  '0400': [[1, 'vendors/orders/vendor-orders.js'], [183, 'vendors/orders/day-by-day.js'], [343, 'vendors/orders/change-remove.js']],
  '0410': [[1, 'vendors/orders/history.js'], [16, 'vendors/orders/accept-delivery.js']],
  '0420': [[1, 'orders/raise-sales-order.js']],
  '0430': [[1, 'vendors/orders/place-vendor-order.js']],
  '0440': [[1, 'vendors/orders/same-colour-twice.js'], [229, 'orders/reserve.js']],
  '0450': [[1, 'vendors/portal/vendor-portal.js']],
  '0460': [[1, 'vendors/portal/vendor-master.js'], [208, 'vendors/portal/phone-pin.js']],
  '0470': [[1, 'inventory/finished-goods.js']],
  '0480': [[1, 'masters/masters.js']],
  '0490': [[1, 'masters/masters-spreadsheet.js'], [199, 'reports/reports.js']],
  '0500': [[1, 'reports/last-week.js'], [171, 'reports/charts.js']],
  '0510': [[1, 'reports/shopify-dispatch.js'], [250, 'inventory/fg-other-movements.js']],
  '0520': [[1, 'inventory/fg-receive-excel.js']],
  '0530': [[1, 'inventory/fg-change-remove.js']],
  '0540': [[1, 'inventory/fba-dispatch.js'], [206, 'inventory/fba-ship-excel.js']],
  '0550': [[1, 'orders/delete-requests.js'], [331, 'inventory/amazon-listing-status.js']],
  '0560': [[1, 'inventory/fg-entry-access.js'], [74, 'inventory/fg-corrections.js']],
  '0570': [[1, 'inventory/fg-over-order.js'], [59, 'inventory/fg-external-orders.js'], [90, 'inventory/fg-scanning.js']],
  '0580': [[1, 'vendors/printing/printer-allocation.js'], [210, 'vendors/printing/printer-capacity.js']],
  '0590': [[1, 'vendors/printing/design-sheet.js']],
  '0600': [[1, 'orders/customer-orders.js']],
  '0610': [[1, 'vendors/orders/vendor-order-requests.js']],
  '0620': [[1, 'vendors/rfd/rfd-requirements.js'], [208, 'vendors/rfd/rfd-sizes.js']],
  '0630': [[1, 'vendors/rfd/ask-for-now.js'], [329, 'vendors/rfd/order-driven-rfd.js']],
  '0640': [[1, 'reports/production-karigar-analysis.js']],
  '0650': [[1, 'vendors/printing/fabric-m2.js'], [176, 'vendors/printing/printed-on-what.js']],
  '0660': [[1, 'masters/recipe-bucket.js'], [11, 'masters/sku-codes.js']],
  '0670': [[1, 'inventory/store.js']],
  '0680': [[1, 'masters/cloth-per-piece.js']],
  '0690': [[1, 'reports/day-by-day-target.js']],
  '0700': [[1, 'shopify/shopify-orders.js']],
  '0710': [[1, 'shopify/orders-to-make.js']],
  '0720': [[1, 'shopify/production-bucket.js'], [119, 'shopify/bucket-excel.js']],
  '0730': [[1, 'shopify/returns.js'], [199, 'shopify/delivery-days.js'], [256, 'replenishment/india-usa-express.js']],
  '0740': [[1, 'shared/adjustments.js'], [269, 'shared/courier-templates.js']],
  '0750': [[1, 'shared/imported-orders.js']],
  '0760': [[1, 'core/filter-by.js'], [134, 'core/installed-app.js'], [151, 'core/version-check.js']],
};

const files = fs.readdirSync(APP).filter(f => /^\d{4}-.*\.js$/.test(f)).sort();
const order = [], written = new Set();
for (const f of files) {
  const plan = PLAN[f.slice(0, 4)];
  if (!plan) throw new Error('no plan for ' + f);
  const text = fs.readFileSync(path.join(APP, f), 'utf8');
  /* the offset where each 1-based line starts */
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  plan.forEach(([line, dest], k) => {
    if (line > starts.length) throw new Error(`${f}: no line ${line}`);
    if (written.has(dest)) throw new Error('two pieces named ' + dest);
    const a = starts[line - 1], b = k + 1 < plan.length ? starts[plan[k + 1][0] - 1] : text.length;
    if (!(b > a)) throw new Error(`${f}: empty piece ${dest}`);
    fs.mkdirSync(path.dirname(path.join(APP, dest)), { recursive: true });
    fs.writeFileSync(path.join(APP, dest), text.slice(a, b));
    written.add(dest); order.push(dest);
  });
  fs.unlinkSync(path.join(APP, f));
}
fs.writeFileSync(path.join(APP, 'ORDER'), [
  '# The order the app files are joined in (tests/assemble.js). ONE module, ONE scope: top-level const/let and',
  '# statements run in this order, so a line moves only with every test green afterwards. Every .js file under',
  '# src/app/ must be listed exactly once.', ''].join('\r\n') + order.join('\r\n') + '\r\n');
const by = {};
order.forEach(p => { const g = p.split('/').slice(0, -1).join('/'); by[g] = (by[g] || 0) + 1; });
console.log(order.length + ' files in ' + Object.keys(by).length + ' folders:', JSON.stringify(by));
