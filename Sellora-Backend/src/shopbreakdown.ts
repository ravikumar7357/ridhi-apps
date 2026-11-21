/* SHOPIFY'S "TOTAL SALES BREAKDOWN", per store and PACIFIC day (Ravi, 21 Nov 2026: "show total sales in Shopify").
 * The same lines as Shopify Analytics' Total sales report:
 *
 *   Gross sales       product price × quantity of the orders placed that day
 * − Discounts         their discounts
 * − Returns           "sales reversals": items refunded that day (on ANY order — counted on the refund's day, as Shopify
 *                     does), and orders cancelled unpaid (voided) that day
 * = Net sales
 * + Shipping          shipping charged on the day's orders, less shipping refunded that day
 * + Taxes             tax charged on the day's orders, less tax refunded that day
 * = Total sales       (return fees and duties: none in these stores)
 *
 * So a day needs every order placed on it AND every refund made on it — the orders UPDATED since the day began cover both
 * (a refund or a cancellation updates its order). Test orders are left out. Figures in the store's currency (USD). */

import { call } from './http.ts';
import { storeHost, SHOP_API_VERSION } from './shopify.ts';
import { ptDay } from './time.ts';

export interface Breakdown { orders: number; gross: number; discounts: number; returns: number; shipping: number; taxes: number }
const empty = (): Breakdown => ({ orders: 0, gross: 0, discounts: 0, returns: 0, shipping: 0, taxes: 0 });
const n = (v: unknown) => Number(v) || 0;

/** Every order updated from `fromMs` on, with what the breakdown needs (all pages). */
export async function ordersUpdatedSince(store: string, token: string, fromMs: number): Promise<any[]> {
  const fields = 'id,created_at,cancelled_at,financial_status,test,line_items,total_discounts,total_tax,shipping_lines,refunds';
  let url = `https://${storeHost(store)}/admin/api/${SHOP_API_VERSION}/orders.json?status=any&limit=250&fields=${fields}&updated_at_min=${encodeURIComponent(new Date(fromMs).toISOString())}`;
  const out: any[] = [];
  for (let page = 0; page < 200 && url; page++) {
    const r = await call('Shopify orders (breakdown)', url, { headers: { 'X-Shopify-Access-Token': token.trim() } }, 5, 2500);
    const j = await r.json() as { orders?: any[] };
    out.push(...(j.orders || []));
    const m = String(r.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : '';
  }
  return out;
}

/** The breakdown for each Pacific day from `fromDay` on (days with nothing are absent). */
export function foldBreakdown(orders: any[], fromDay: string): Map<string, Breakdown> {
  const out = new Map<string, Breakdown>();
  const at = (iso: string) => { const d = ptDay(Date.parse(iso)); if (d < fromDay) return null; let b = out.get(d); if (!b) { b = empty(); out.set(d, b); } return b; };
  for (const o of orders) {
    if (o.test) continue;
    const gross = (o.line_items || []).reduce((t: number, li: any) => t + n(li.price) * n(li.quantity), 0);
    const ship = (o.shipping_lines || []).reduce((t: number, s: any) => t + n(s.discounted_price != null ? s.discounted_price : s.price), 0);
    // The order's own day: what was sold.
    const b = o.created_at ? at(o.created_at) : null;
    if (b) { b.orders += 1; b.gross += gross; b.discounts += n(o.total_discounts); b.shipping += ship; b.taxes += n(o.total_tax); }
    // Cancelled before any money was taken (voided): the whole sale reverses on the day it was cancelled.
    if (String(o.financial_status || '').toLowerCase() === 'voided' && o.cancelled_at) {
      const c = at(o.cancelled_at);
      if (c) { c.returns += gross - n(o.total_discounts); c.shipping -= ship; c.taxes -= n(o.total_tax); }
      continue;
    }
    // Refunds: each on its own day.
    for (const rf of o.refunds || []) {
      const r = rf.created_at ? at(rf.created_at) : null;
      if (!r) continue;
      for (const rli of rf.refund_line_items || []) { r.returns += n(rli.subtotal); r.taxes -= n(rli.total_tax); }
      for (const adj of rf.order_adjustments || []) {          // amounts are negative for money given back
        if (/shipping/i.test(String(adj.kind || ''))) { r.shipping += n(adj.amount); r.taxes += n(adj.tax_amount); }
        else r.returns -= n(adj.amount);                         // a refund discrepancy: Shopify counts it as a return
      }
    }
  }
  for (const b of out.values()) for (const k of ['gross', 'discounts', 'returns', 'shipping', 'taxes'] as const) b[k] = Math.round(b[k] * 100) / 100;
  return out;
}

/** net and total, as Shopify shows them. */
export function totals(b: Breakdown) {
  const net = Math.round((b.gross - b.discounts - b.returns) * 100) / 100;
  return { net, total: Math.round((net + b.shipping + b.taxes) * 100) / 100 };
}
