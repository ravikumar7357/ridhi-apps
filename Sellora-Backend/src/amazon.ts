/* Amazon: the Login-with-Amazon token, and the Sales API's getOrderMetrics — every order placed on Amazon.com (pending
 * ones included), by Pacific hour or day. The same call Apps Script makes (Pricing-API/SalesLive.gs liveMetrics_). */

import { callJson, HttpError } from './http.ts';
import { isoPT } from './time.ts';

export const LWA_URL = 'https://api.amazon.com/auth/o2/token';
export const SP_HOST = 'https://sellingpartnerapi-na.amazon.com';
export const MARKETPLACE_US = 'ATVPDKIKX0DER';

export interface LwaCred { clientId: string; clientSecret: string; refreshToken: string }

const tokens = new Map<string, { token: string; until: number }>();

/** An access token for one set of credentials, kept until 5 minutes before it runs out (they last an hour).
 * `what` names the credentials in an error ("Amazon Ads login"), and Amazon's own reason is put first — its answer
 * opens with a long error_index that used to push the reason out of the message. */
export async function lwaToken(c: LwaCred, what = 'Amazon login'): Promise<string> {
  const k = c.clientId + '|' + c.refreshToken.slice(-12);
  const hit = tokens.get(k);
  if (hit && hit.until > Date.now()) return hit.token;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.clientId, client_secret: c.clientSecret });
  let j: { access_token: string; expires_in?: number };
  try {
    j = await callJson<{ access_token: string; expires_in?: number }>(what, LWA_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    });
  } catch (e) {
    if (e instanceof HttpError) {
      let why = '';
      try { const x = JSON.parse(e.body); why = [x.error, x.error_description].filter(Boolean).join(' — '); } catch { /* not JSON */ }
      throw new Error(`${what} ${e.status}: ${why || e.body.slice(0, 200)} (client id …${c.clientId.slice(-6)})`);
    }
    throw e;
  }
  if (!j || !j.access_token) throw new Error('Amazon login: no access token in the answer');
  tokens.set(k, { token: j.access_token, until: Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000 });
  return j.access_token;
}

export interface MetricRow { start: string; ms: number; day: string; orders: number; units: number; items: number; sales: number }

/** Order metrics from startMs to endMs, by 'Hour' or 'Day' in US/Pacific. */
export async function orderMetrics(c: LwaCred, startMs: number, endMs: number, gran: 'Hour' | 'Day', marketplace = MARKETPLACE_US): Promise<MetricRow[]> {
  const token = await lwaToken(c);
  const q = new URLSearchParams({
    marketplaceIds: marketplace,
    interval: `${isoPT(startMs)}--${isoPT(endMs)}`,
    granularity: gran,
    granularityTimeZone: 'US/Pacific',
  });
  const j = await callJson<{ payload?: any[] }>('Amazon Sales API', `${SP_HOST}/sales/v1/orderMetrics?${q}`, {
    headers: { 'x-amz-access-token': token, Accept: 'application/json' },
  }, 5, 2500);
  return (j && j.payload || []).map(parseMetric);
}

export function parseMetric(x: any): MetricRow {
  const start = String(x.interval || '').split('--')[0];
  return {
    start, ms: Date.parse(start), day: start.slice(0, 10),
    orders: Number(x.orderCount) || 0, units: Number(x.unitCount) || 0, items: Number(x.orderItemCount) || 0,
    sales: Math.round((Number(x.totalSales && x.totalSales.amount) || 0) * 100) / 100,
  };
}
