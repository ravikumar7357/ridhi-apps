/* Shopify Admin GraphQL: read orders with their lines, parcels (fulfillments), tracking numbers and parcel events.
 * READS ONLY — nothing here ever writes to Shopify.
 *
 * Gentle on Shopify's limits:
 *   · page size starts at 25 orders and halves if Shopify says the query is too expensive (MAX_COST_EXCEEDED)
 *   · waits when the cost bucket runs low (extensions.cost.throttleStatus), and on THROTTLED
 *   · fields that need extra Shopify access (journey/UTM, ship-to address) are dropped by themselves if refused,
 *     so a missing permission never stops the whole job */

import { call, sleep } from './http.ts';
import { SHOPIFY_API_VERSION, type ShopCred } from './config.ts';

const MONEY = (f: string) => `${f} { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }`;

export interface QueryParts { journey: boolean; address: boolean }

export function orderFields(p: QueryParts): string {
  return `
    id name createdAt updatedAt processedAt cancelledAt cancelReason test
    displayFinancialStatus displayFulfillmentStatus tags sourceName note discountCodes
    currencyCode presentmentCurrencyCode
    ${MONEY('subtotalPriceSet')} ${MONEY('totalDiscountsSet')} ${MONEY('totalShippingPriceSet')}
    ${MONEY('totalTaxSet')} ${MONEY('totalPriceSet')} ${MONEY('totalRefundedSet')}
    shippingLine { title }
    ${p.address ? 'shippingAddress { city provinceCode countryCodeV2 }' : ''}
    ${p.journey ? 'customerJourneySummary { firstVisit { landingPage referrerUrl utmParameters { source medium campaign content term } } }' : ''}
    lineItems(first: 50) { nodes {
      id sku title variantTitle quantity currentQuantity unfulfilledQuantity
      originalUnitPriceSet { shopMoney { amount } } totalDiscountSet { shopMoney { amount } }
      product { id productType } variant { id } } }
    fulfillments(first: 10) {
      id status displayStatus createdAt updatedAt inTransitAt estimatedDeliveryAt deliveredAt
      service { serviceName }
      trackingInfo(first: 5) { company number url }
      fulfillmentLineItems(first: 50) { nodes { quantity lineItem { id } } }
      events(first: 20) { nodes { id status happenedAt message city province country } } }`;
}

export class Shopify {
  cred: ShopCred;
  parts: QueryParts = { journey: true, address: true };
  pageSize = 25;
  calls = 0;
  constructor(cred: ShopCred) { this.cred = cred; }

  private async gql(query: string, variables: Record<string, unknown>): Promise<any> {
    for (let attempt = 0; attempt < 6; attempt++) {
      this.calls++;
      const r = await call('Shopify GraphQL', `https://${this.cred.host}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': this.cred.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      }, 4, 2000);
      const j = await r.json() as any;
      const errs: any[] = j.errors || [];
      const codes = errs.map(e => e?.extensions?.code);
      if (codes.includes('THROTTLED')) { await sleep(2000 * (attempt + 1)); continue; }
      if (errs.length) {
        const err = new Error('Shopify: ' + JSON.stringify(errs).slice(0, 400)) as Error & { codes?: string[] };
        err.codes = codes;
        throw err;
      }
      // keep half the bucket free for everything else that uses this store's API (Sellora, the ERP)
      const t = j.extensions?.cost?.throttleStatus;
      if (t && t.currentlyAvailable < t.maximumAvailable / 2) {
        const need = t.maximumAvailable / 2 - t.currentlyAvailable;
        await sleep(Math.min(10_000, Math.ceil(need / Math.max(t.restoreRate, 1)) * 1000));
      }
      return j.data;
    }
    throw new Error('Shopify: still throttled after 6 tries');
  }

  /** Runs a query; on a refused field or a too-expensive query, adjusts and tries again. */
  private async gqlAdaptive(build: () => string, variables: () => Record<string, unknown>): Promise<any> {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        return await this.gql(build(), variables());
      } catch (e) {
        const msg = String((e as Error).message);
        const codes = (e as any).codes || [];
        if ((codes.includes('MAX_COST_EXCEEDED') || /max.?cost|too complex/i.test(msg)) && this.pageSize > 1) {
          this.pageSize = Math.max(1, Math.floor(this.pageSize / 2));
          continue;
        }
        if (this.parts.journey && /customerJourneySummary|journey/i.test(msg)) { this.parts.journey = false; continue; }
        if (this.parts.address && /shippingAddress|protected customer data|ACCESS_DENIED/i.test(msg)) { this.parts.address = false; continue; }
        throw e;
      }
    }
    throw new Error('Shopify: query could not be made to work');
  }

  /** One page of orders matching a Shopify search (e.g. "updated_at:>='…'"). */
  async ordersPage(search: string, sortKey: 'UPDATED_AT' | 'CREATED_AT', reverse: boolean, after: string | null) {
    const data = await this.gqlAdaptive(
      () => `query($n: Int!, $after: String, $q: String!, $reverse: Boolean!) {
        orders(first: $n, after: $after, query: $q, sortKey: ${sortKey}, reverse: $reverse) {
          pageInfo { hasNextPage endCursor }
          nodes { ${orderFields(this.parts)} } } }`,
      () => ({ n: this.pageSize, after, q: search, reverse }),
    );
    return data.orders as { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: any[] };
  }

  /** One order by its Shopify id (number or gid). */
  async order(id: string | number): Promise<any | null> {
    const gid = String(id).startsWith('gid://') ? String(id) : `gid://shopify/Order/${id}`;
    const data = await this.gqlAdaptive(
      () => `query($id: ID!) { order(id: $id) { ${orderFields(this.parts)} } }`,
      () => ({ id: gid }),
    );
    return data.order || null;
  }
}
