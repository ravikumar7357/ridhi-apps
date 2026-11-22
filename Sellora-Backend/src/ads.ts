/* Amazon Ads API: daily campaign reports for Sponsored Products, Brands and Display. The API has no live number: a report
 * is asked for, Amazon builds it (minutes, sometimes an hour), then it is collected — so each run collects what the last
 * run asked for and asks again. Attribution as the Ads console shows it for a seller: Products 7-day, Brands and Display
 * 14-day. The same reports Apps Script asks for (Pricing-API/SalesLive.gs liveAdsTick_). */

import { gunzipSync } from 'node:zlib';
import { call, callJson, HttpError } from './http.ts';
import { lwaToken, type LwaCred } from './amazon.ts';

export const ADS_HOST = 'https://advertising-api.amazon.com';
export const REPORT_MIME = 'application/vnd.createasyncreportrequest.v3+json';

export type AdType = 'sp' | 'sb' | 'sd';
export const AD_TYPES: Record<AdType, { adProduct: string; reportTypeId: string; o: string; s: string }> = {
  sp: { adProduct: 'SPONSORED_PRODUCTS', reportTypeId: 'spCampaigns', o: 'purchases7d', s: 'sales7d' },
  sb: { adProduct: 'SPONSORED_BRANDS', reportTypeId: 'sbCampaigns', o: 'purchases', s: 'sales' },
  sd: { adProduct: 'SPONSORED_DISPLAY', reportTypeId: 'sdCampaigns', o: 'purchases', s: 'sales' },
};

export interface AdsCtx { cred: LwaCred; profileId: string }
export interface AdDay { impressions: number; clicks: number; spend: number; orders: number; sales: number }

async function headers(c: LwaCred, profileId?: string): Promise<Record<string, string>> {
  const h: Record<string, string> = { Authorization: 'Bearer ' + await lwaToken(c, 'Amazon Ads login'), 'Amazon-Advertising-API-ClientId': c.clientId };
  if (profileId) h['Amazon-Advertising-API-Scope'] = String(profileId);
  return h;
}

/** The brand's one US seller profile. Refuses to guess between several (one Ads login can see both brands). */
export async function findProfile(c: LwaCred, brand: string): Promise<string> {
  const list = await callJson<any[]>('Amazon Ads profiles', `${ADS_HOST}/v2/profiles`, { headers: await headers(c) }) || [];
  const sellers = list.filter(p => String(p.countryCode || '').toUpperCase() === 'US' && String((p.accountInfo || {}).type || '').toLowerCase() === 'seller');
  if (sellers.length === 1) return String(sellers[0].profileId);
  if (!sellers.length) throw new Error(`${brand}: no US seller profile is visible to these Ads credentials`);
  throw new Error(`${brand}: ${sellers.length} US seller profiles are visible (${sellers.map(p => p.profileId + ' ' + ((p.accountInfo || {}).name || '?')).join(', ')}) — set ${brand}_ADS_PROFILE_ID`);
}

/** Ask for one type's daily report from `from` to `to` (YYYY-MM-DD, the profile's own day). Returns the report id. */
export async function askReport(x: AdsCtx, type: AdType, from: string, to: string, brand: string): Promise<string> {
  const T = AD_TYPES[type];
  let j: { reportId?: string; status?: string };
  try {
    j = await callJson<{ reportId?: string; status?: string }>('Amazon Ads report', `${ADS_HOST}/reporting/reports`, {
    method: 'POST',
    headers: { ...await headers(x.cred, x.profileId), 'Content-Type': REPORT_MIME, Accept: REPORT_MIME },
    body: JSON.stringify({
      name: `sellora-live-${type}-${brand}-${Date.now()}`,       // the time in the name: Amazon never hands back an older duplicate
      startDate: from, endDate: to,
      configuration: {
        adProduct: T.adProduct, groupBy: ['campaign'], reportTypeId: T.reportTypeId,
        columns: ['date', 'impressions', 'clicks', 'cost', T.o, T.s], timeUnit: 'DAILY', format: 'GZIP_JSON',
      },
    }),
  });
  } catch (e) {
    // 425 "duplicate of <id>": the same report is already being built — Apps Script asks for the identical one (21 Nov).
    // That report is just as good: collect it.
    const id = duplicateOf(e);
    if (id) return id;
    throw e;
  }
  if (!j || !j.reportId) throw new Error(`Amazon Ads report: no report id (${(j && j.status) || '?'})`);
  return j.reportId;
}

/** The report id in Amazon's 425 "The Request is a duplicate of : <id>", or '' for any other error. */
export function duplicateOf(e: unknown): string {
  if (!(e instanceof HttpError) || e.status !== 425) return '';
  const m = e.body.match(/duplicate of\s*:?\s*([0-9a-f-]{20,})/i);
  return m ? m[1] : '';
}

export interface ReportStatus { status: string; ready: boolean; failed: boolean; url: string; reason: string }

export async function reportStatus(x: AdsCtx, id: string): Promise<ReportStatus> {
  const j = await callJson<any>('Amazon Ads report status', `${ADS_HOST}/reporting/reports/${encodeURIComponent(id)}`, {
    headers: { ...await headers(x.cred, x.profileId), Accept: REPORT_MIME },
  }) || {};
  const status = String(j.status || '');
  return { status, ready: status === 'COMPLETED', failed: /fail|cancel/i.test(status), url: j.url || '', reason: j.failureReason || '' };
}

/** A finished report's rows. The link is a plain pre-signed download: none of our headers go with it. */
export async function downloadReport(url: string): Promise<any[]> {
  const r = await call('Amazon Ads report download', url);
  const buf = Buffer.from(await r.arrayBuffer());
  let text: string;
  try { text = gunzipSync(buf).toString('utf8'); } catch { text = buf.toString('utf8'); }
  return JSON.parse(text || '[]') || [];
}

/** Report rows (one per campaign and day) folded to one row per day. */
export function foldAds(rows: any[], type: AdType): Map<string, AdDay> {
  const T = AD_TYPES[type], out = new Map<string, AdDay>();
  for (const y of rows) {
    const d = String(y.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const t = out.get(d) || { impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0 };
    t.impressions += Number(y.impressions) || 0;
    t.clicks += Number(y.clicks) || 0;
    t.spend += Number(y.cost) || 0;
    t.orders += Number(y[T.o]) || 0;
    t.sales += Number(y[T.s]) || 0;
    out.set(d, t);
  }
  for (const t of out.values()) { t.spend = Math.round(t.spend * 100) / 100; t.sales = Math.round(t.sales * 100) / 100; }
  return out;
}
