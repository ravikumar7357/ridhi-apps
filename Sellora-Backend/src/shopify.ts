/* Shopify Admin API: a store's orders, folded by PACIFIC hour and day so they line up with Amazon. Sales = line-item
 * price × quantity (no shipping, no tax), voided orders left out — the same counting as Apps Script (shopifyDaily_). */

import { call } from './http.ts';
import { ptDay, hourStart } from './time.ts';

export const SHOP_API_VERSION = '2024-10';

/** "mystore.myshopify.com" from whatever was saved (also the admin.shopify.com/store/<handle> form). */
export function storeHost(s: string): string {
  s = String(s || '').trim().replace(/^https?:\/\//, '');
  const m = s.match(/admin\.shopify\.com\/store\/([^/?#]+)/i);
  if (m) return m[1] + '.myshopify.com';
  s = s.replace(/\/.*$/, '');
  if (!s) throw new Error('Shopify store is not set');
  return s.includes('.myshopify.com') ? s : s + '.myshopify.com';
}

export interface ShopOrder { id: number; created_at: string; financial_status?: string | null; line_items?: { price: string; quantity: number }[] }

/** Every order created from fromMs to toMs (all pages). */
export async function ordersBetween(store: string, token: string, fromMs: number, toMs: number): Promise<ShopOrder[]> {
  token = token.trim();
  if (token.startsWith('shpss_')) throw new Error("the Shopify token is the app's SECRET (shpss_…), not an Admin API access token (shpat_…)");
  const base = `https://${storeHost(store)}/admin/api/${SHOP_API_VERSION}/orders.json`;
  const fields = 'id,created_at,financial_status,line_items';
  let url = `${base}?status=any&limit=250&fields=${fields}&created_at_min=${encodeURIComponent(new Date(fromMs).toISOString())}&created_at_max=${encodeURIComponent(new Date(toMs).toISOString())}`;
  const out: ShopOrder[] = [];
  for (let page = 0; page < 200 && url; page++) {
    const r = await call('Shopify orders', url, { headers: { 'X-Shopify-Access-Token': token } }, 5, 2500);
    const j = await r.json() as { orders?: ShopOrder[] };
    out.push(...(j.orders || []));
    const m = String(r.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : '';
  }
  return out;
}

export interface Tot { orders: number; units: number; sales: number }

/** Orders by Pacific hour start (ms) and by Pacific day. Voided orders out. */
export function foldShop(orders: ShopOrder[]): { hours: Map<number, Tot>; days: Map<string, Tot> } {
  const hours = new Map<number, Tot>(), days = new Map<string, Tot>();
  for (const o of orders) {
    if (String(o.financial_status || '').toLowerCase() === 'voided') continue;
    const ms = Date.parse(o.created_at);
    if (!Number.isFinite(ms)) continue;
    let units = 0, sales = 0;
    for (const li of o.line_items || []) { const q = Number(li.quantity) || 0; units += q; sales += (Number(li.price) || 0) * q; }
    for (const [map, key] of [[hours, hourStart(ms)], [days, ptDay(ms)]] as [Map<any, Tot>, any][]) {
      const t = map.get(key) || { orders: 0, units: 0, sales: 0 };
      t.orders += 1; t.units += units; t.sales += sales;
      map.set(key, t);
    }
  }
  for (const m of [hours, days] as Map<any, Tot>[]) for (const t of m.values()) t.sales = Math.round(t.sales * 100) / 100;
  return { hours, days };
}
