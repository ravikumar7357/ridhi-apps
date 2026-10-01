/* ONE-TIME, STEP 3 OF THE MODULE PLAN for Sellora (Pricing-App), 2026-10-01: the 15 files tests/src-split.js cut from
 * Sellora's page go into group folders, joined in today's order by Pricing-App/src/app/ORDER — the page stays the same
 * bytes. Groups follow Sellora's menu: core, research, sales, listing, ads, inventory; shared/ holds the three blocks
 * the Replenish app also carries; hidden/ is the Shopify Orders + Adjustments code whose tabs are hidden in Sellora
 * (moved to Replenish) but which still loads and runs — nothing in it is removed.
 *
 *   node tests/src-regroup-sellora.js
 */
const path = require('path');
const { regroup } = require('./src-regroup.js');
const PLAN = {
  '0010': [[1, 'core/setup.js'], [18, 'core/rights-mirror.js'], [78, 'research/costing-maths.js'], [106, 'core/auth.js'],
           [216, 'core/access.js'], [312, 'core/admin-access.js'], [576, 'core/nav.js'], [708, 'core/settings.js'],
           [867, 'research/fee-tables.js'], [950, 'core/backend.js'], [966, 'sales/brand-analytics.js'],
           [1066, 'inventory/inventory-age.js'], [1356, 'listing/listing-health.js'], [1399, 'listing/listing-rules.js'],
           [1804, 'listing/listing-health-data.js'], [2435, 'listing/parent-check.js'], [2673, 'listing/listing-rules-tab.js'],
           [3024, 'listing/listing-audit.js'], [3073, 'listing/launch.js'], [4228, 'listing/bsr-audit.js'],
           [4738, 'research/keywords.js'], [4836, 'research/by-amazon-link.js'], [4890, 'research/new-product.js'],
           [5089, 'research/product-research.js']],
  '0020': [[1, 'sales/sales-dashboard.js']],
  '0030': [[1, 'ads/deal-calendar.js'], [197, 'ads/planner.js'], [774, 'ads/completed-deals.js'], [894, 'ads/hda.js']],
  '0040': [[1, 'ads/account-trends.js'], [151, 'ads/search-terms.js']],
  '0050': [[1, 'ads/placement.js']],
  '0060': [[1, 'ads/ppc-organic.js']],
  '0070': [[1, 'sales/parent-listing-review.js']],
  '0080': [[1, 'hidden/shopify-orders.js'], [151, 'hidden/shelf-position.js']],
  '0090': [[1, 'hidden/production-view.js'], [166, 'hidden/india-stock-orders.js'], [942, 'hidden/staged-quantity.js'],
           [1088, 'hidden/adjustment-dialog.js'], [1668, 'hidden/mcf.js']],
  '0100': [[1, 'sales/profit-margin.js']],
  '0110': [[1, 'sales/sales-analysis.js'], [244, 'shared/adjustments.js']],
  '0120': [[1, 'shared/courier-templates.js'], [271, 'hidden/production-to-make.js']],
  '0130': [[1, 'shared/imported-orders.js']],
  '0140': [[1, 'listing/listing-optimiser.js']],
  '0150': [[1, 'listing/bought-together.js'], [134, 'core/version-check.js']],
};
regroup(path.join(__dirname, '..', '..', 'Pricing-App', 'src', 'app'), PLAN);
