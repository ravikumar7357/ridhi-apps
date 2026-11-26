/* Amazon's speed limit for every kind of call we make. rate = calls per second that refill, burst = how many may go at
 * once. SP-API figures are Amazon's DEFAULT usage plans, from its official API models
 * (github.com/amzn/selling-partner-api-models, read 25 Nov 2026). The limits are counted per brand AND per Amazon app,
 * so Apps Script and this backend share them: see `share` in controls.ts.
 *
 * Amazon Ads publishes no fixed numbers (it throttles by load), so those are OUR OWN careful budget, marked
 * published: false. Adding a call here is the only way to make it: the gateway refuses an unknown one. */

export interface OpLimit {
  api: 'sp' | 'ads';
  rate: number;
  burst: number;
  published: boolean;
}

export const OPS = {
  // Reports 2021-06-30
  'reports.createReport':        { api: 'sp', rate: 0.0167, burst: 15, published: true },   // about 1 a minute
  'reports.getReports':          { api: 'sp', rate: 0.0222, burst: 10, published: true },
  'reports.getReport':           { api: 'sp', rate: 2,      burst: 15, published: true },
  'reports.getReportDocument':   { api: 'sp', rate: 0.0167, burst: 15, published: true },
  // Sales v1
  'sales.getOrderMetrics':       { api: 'sp', rate: 0.5,    burst: 15, published: true },
  // FBA inventory, inbound, AWD
  'fbaInventory.getInventorySummaries': { api: 'sp', rate: 2, burst: 2,  published: true },
  'inboundV0.getShipments':             { api: 'sp', rate: 2, burst: 30, published: true },
  'inboundV0.getShipmentItems':         { api: 'sp', rate: 2, burst: 30, published: true },
  'awd.listInventory':                  { api: 'sp', rate: 2, burst: 2,  published: true },
  'awd.listInboundShipments':           { api: 'sp', rate: 1, burst: 1,  published: false }, // not confirmed: kept careful
  'awd.getInboundShipment':             { api: 'sp', rate: 1, burst: 1,  published: false }, // not confirmed: kept careful
  // Catalog, pricing, fees
  'catalog.searchCatalogItems':  { api: 'sp', rate: 2,   burst: 2, published: true },
  'catalog.getCatalogItem':      { api: 'sp', rate: 2,   burst: 2, published: true },
  'pricing.getItemOffers':       { api: 'sp', rate: 0.5, burst: 1, published: true },       // one every 2 s
  'pricing.getItemOffersBatch':  { api: 'sp', rate: 0.1, burst: 1, published: true },       // one every 10 s
  'fees.getMyFeesEstimateForASIN': { api: 'sp', rate: 1, burst: 2, published: true },
  // Listings
  'listings.getListingsItem':    { api: 'sp', rate: 5, burst: 10, published: true },
  'listings.patchListingsItem':  { api: 'sp', rate: 5, burst: 5,  published: true },
  'definitions.getDefinitionsProductType': { api: 'sp', rate: 5, burst: 10, published: true },
  // Fulfilment outbound (MCF)
  'outbound.getFulfillmentPreview': { api: 'sp', rate: 2, burst: 30, published: true },
  'outbound.createFulfillmentOrder': { api: 'sp', rate: 2, burst: 30, published: true },
  'outbound.getFulfillmentOrder':   { api: 'sp', rate: 2, burst: 30, published: true },
  // A+ content
  'aplus.searchContentDocuments': { api: 'sp', rate: 10, burst: 10, published: true },
  // Amazon Ads (our own budget; Amazon publishes none)
  'ads.createReport':            { api: 'ads', rate: 1 / 60, burst: 3, published: false },
  'ads.getReport':               { api: 'ads', rate: 1,      burst: 5, published: false },
  'ads.profiles':                { api: 'ads', rate: 0.2,    burst: 2, published: false },
} as const satisfies Record<string, OpLimit>;

export type Op = keyof typeof OPS;

/** The limit this backend may use: Amazon's limit times our share of it (0.5 while Apps Script is also calling). */
export function effective(op: Op, share: number): { rate: number; burst: number } {
  const o = OPS[op];
  const s = Math.min(1, Math.max(0.05, share));
  return { rate: o.rate * s, burst: Math.max(1, Math.floor(o.burst * s)) };
}
