/* Shopify GraphQL order → the JSON shape flowmerce.ingest_shopify_orders() expects (keys = our column names).
 *
 * Privacy (requirements §13): no customer name, email, phone, street address or note text is ever passed on.
 * The note is read ONLY to work out two yes/no facts (reship, "DONE"); the text itself is dropped, also from the raw copy. */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const shop = (m: any) => num(m?.shopMoney?.amount);
const pres = (m: any) => num(m?.presentmentMoney?.amount);
const nodes = (c: any): any[] => (Array.isArray(c) ? c : c?.nodes) || [];

/** "#RBP9361" → 9361 */
export function orderNumber(name: string | null | undefined): number | null {
  const m = String(name || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

const RESHIP_WORD = /\b(re-?ship(ment|ped)?|replacement|resend|re-?send)\b/i;
const ORDER_REF = /#\s?([A-Z]{0,5}\d{3,})/i;

/** Reship / replacement and "DONE" facts from tags and the note. Returns facts only — never the note. */
export function noteFacts(note: string | null | undefined, tags: string[]): { is_reship: boolean; reship_of_order_name: string | null; note_done: boolean } {
  const text = String(note || '');
  const tagText = tags.join(' ');
  const is_reship = RESHIP_WORD.test(tagText) || RESHIP_WORD.test(text);
  let reship_of_order_name: string | null = null;
  if (is_reship) {
    const m = text.match(ORDER_REF) || tagText.match(ORDER_REF);
    if (m) reship_of_order_name = '#' + m[1].toUpperCase();
  }
  const note_done = /(^|\W)DONE(\W|$)/.test(text);           // the team writes DONE in capitals
  return { is_reship, reship_of_order_name, note_done };
}

/** The UTM values from the landing page URL, when Shopify's journey summary has none. */
function utmFromUrl(url: string | null | undefined): Record<string, string | null> {
  const out: Record<string, string | null> = { source: null, medium: null, campaign: null, content: null, term: null };
  if (!url) return out;
  try {
    const u = new URL(url, 'https://x.invalid');
    for (const k of Object.keys(out)) out[k] = u.searchParams.get('utm_' + k);
  } catch { /* not a URL: leave empty */ }
  return out;
}

export function mapOrder(o: any): Record<string, unknown> {
  const tags: string[] = Array.isArray(o.tags) ? o.tags : [];
  const visit = o.customerJourneySummary?.firstVisit || null;
  const utmJ = visit?.utmParameters || null;
  const utmU = utmFromUrl(visit?.landingPage);
  const utm = (k: string) => (utmJ && utmJ[k]) || utmU[k] || null;
  const addr = o.shippingAddress || null;

  const lines = nodes(o.lineItems).map((l: any) => {
    const cur = Number(l.currentQuantity ?? l.quantity ?? 0);
    const open = o.cancelledAt ? 0 : Math.min(Number(l.unfulfilledQuantity ?? 0), cur);
    return {
      external_id: l.id,
      product_external_id: l.product?.id ?? null,
      variant_external_id: l.variant?.id ?? null,
      sku: l.sku || null,
      title: l.title || 'Item',
      variant_title: l.variantTitle || null,
      product_type: l.product?.productType || null,
      tags: [],
      quantity: Number(l.quantity ?? 0),
      unit_price: shop(l.originalUnitPriceSet) ?? 0,
      discount: shop(l.totalDiscountSet) ?? 0,
      fulfilled_quantity: Math.max(cur - open, 0),
      currency: o.currencyCode || null,
    };
  });

  const fulfillments = (o.fulfillments || []).map((f: any) => {
    const info: any[] = f.trackingInfo || [];
    return {
      external_id: f.id,
      status: f.status || null,
      display_status: f.displayStatus || null,
      service: f.service?.serviceName || null,
      carrier_name_raw: info.find(t => t?.company)?.company || null,
      tracking_numbers: info.map(t => t?.number).filter(Boolean),
      tracking_urls: info.map(t => t?.url).filter(Boolean),
      src_created_at: f.createdAt || null,
      in_transit_at: f.inTransitAt || null,
      estimated_delivery_at: f.estimatedDeliveryAt || null,
      delivered_at: f.deliveredAt || null,
      src_updated_at: f.updatedAt || null,
      lines: nodes(f.fulfillmentLineItems).filter((x: any) => x?.lineItem?.id)
        .map((x: any) => ({ line_external_id: x.lineItem.id, quantity: Number(x.quantity ?? 0) })),
      events: nodes(f.events).map((e: any) => ({
        external_id: e.id, status: e.status || null, happened_at: e.happenedAt || null,
        message: e.message || null, city: e.city || null, province: e.province || null, country: e.country || null,
      })),
    };
  });

  // raw copy without the note (and with only city/province/country of the address, which is all we ask for)
  const rawNoNote: Record<string, unknown> = { ...o };
  delete rawNoNote.note;

  return {
    external_id: o.id,
    name: o.name,
    order_number: orderNumber(o.name),
    src_created_at: o.createdAt,
    src_updated_at: o.updatedAt || null,
    processed_at: o.processedAt || null,
    cancelled_at: o.cancelledAt || null,
    cancel_reason: o.cancelReason || null,
    is_test: !!o.test,
    financial_status: o.displayFinancialStatus || null,
    fulfillment_status: o.displayFulfillmentStatus || null,
    tags,
    source_name: o.sourceName || null,
    channel: null,
    landing_site: visit?.landingPage || null,
    referring_site: visit?.referrerUrl || null,
    utm_source: utm('source'), utm_medium: utm('medium'), utm_campaign: utm('campaign'),
    utm_content: utm('content'), utm_term: utm('term'),
    discount_codes: Array.isArray(o.discountCodes) ? o.discountCodes : [],
    shipping_method: o.shippingLine?.title || null,
    ship_city: addr?.city || null,
    ship_province: addr?.provinceCode || null,
    ship_country: addr?.countryCodeV2 || null,
    currency: o.currencyCode || 'USD',
    subtotal: shop(o.subtotalPriceSet) ?? 0,
    discounts: shop(o.totalDiscountsSet) ?? 0,
    shipping: shop(o.totalShippingPriceSet) ?? 0,
    tax: shop(o.totalTaxSet) ?? 0,
    total: shop(o.totalPriceSet) ?? 0,
    total_refunded: shop(o.totalRefundedSet) ?? 0,
    presentment_currency: o.presentmentCurrencyCode || null,
    p_subtotal: pres(o.subtotalPriceSet), p_discounts: pres(o.totalDiscountsSet), p_shipping: pres(o.totalShippingPriceSet),
    p_tax: pres(o.totalTaxSet), p_total: pres(o.totalPriceSet), p_total_refunded: pres(o.totalRefundedSet),
    ...noteFacts(o.note, tags),
    raw: rawNoNote,
    lines,
    fulfillments,
  };
}
