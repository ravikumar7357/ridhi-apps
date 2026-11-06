const FILE_TAB = [
  [/shopify[\\/](returns|shopify-orders|shopify-copy|orders-to-make|production-bucket|bucket-excel|delivery-days|returns-team|production-to-make)/, 'shop'],
  [/@shared[\\/](adjustments)/, 'adj'], [/@shared[\\/](courier|imported)/, 'shop'], [/shopify[\\/]imported/, 'shop'], [/shopify[\\/]bulk-entry/, 'ord'],
  [/orders[\\/](sales-orders|raise-sales-order|quantity-sheet|reserve|delete-requests)/, 'so'], [/orders[\\/]customer-orders/, 'cx'], [/orders[\\/]/, 'ord'],
  [/production[\\/](job-work|whatsapp)/, 'pbase'], [/production[\\/]press/, 'ppress'], [/production[\\/]quality/, 'qc'], [/production[\\/]attendance/, 'att'],
  [/flow[\\/]greige-desk/, 'gdesk'], [/flow[\\/]/, 'flow'],
  [/inventory[\\/](fba-|amazon-listing)/, 'fba'], [/inventory[\\/](fabric|store)/, 'fab'], [/inventory[\\/]accessories/, 'acc'], [/inventory[\\/]/, 'fgi'],
  [/replenishment[\\/](pack-|packing-list|fba-box)/, 'pack'], [/replenishment[\\/]article-review/, 'article'], [/replenishment[\\/]revenue-target/, 'target'],
  [/replenishment[\\/](follow-ups|purchase-orders)/, 'follow'], [/replenishment[\\/]top-asin/, 'top'], [/replenishment[\\/]india-/, 'india'],
  [/replenishment[\\/]shopify-stock/, 'shopify'], [/replenishment[\\/]in-production/, 'prod'], [/replenishment[\\/]/, 'repl'],
  [/dashboard[\\/]/, 'dash'], [/reports[\\/]production-karigar/, 'ka'], [/reports[\\/]/, 'rep'],
  [/people-pay[\\/]/, 'hr'], [/masters[\\/](master-database|asin-from)/, 'pmdb'], [/masters[\\/]/, 'mst'],
  [/vendors[\\/]portal/, 'vend'], [/vendors[\\/]printing[\\/](printer-allocation|printer-capacity|design-sheet)/, 'palloc'], [/vendors[\\/]rfd/, 'rfd'],
  [/vendors[\\/]orders[\\/]vendor-order-requests/, 'vreq'], [/vendors[\\/]orders[\\/]history/, 'vlog'], [/vendors[\\/]/, 'vord'],
  [/core[\\/]/, ''],
];
const tabOfFile = f => { for (const [re, t] of FILE_TAB) if (re.test(f)) return t; return ''; };

module.exports = { tabOfFile };
