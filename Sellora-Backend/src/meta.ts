/* Meta (Facebook + Instagram) ads: the Marketing API's insights for an ad account, by day. Meta counts a day in the AD
 * ACCOUNT's own timezone, which may not be Pacific — that zone is stored with every row. The token should be a System
 * User token with ads_read (Business Settings → System users): a personal token expires in about 60 days. */

import { callJson } from './http.ts';
import type { AdDay } from './ads.ts';

export const GRAPH = 'https://graph.facebook.com/v23.0';

export function accountId(a: string): string {
  return 'act_' + String(a || '').trim().replace(/^act_/, '');
}

/** The account's own timezone (e.g. "Asia/Kolkata") and the currency it reports in (e.g. "INR"). */
export async function accountInfo(token: string, account: string): Promise<{ tz: string; currency: string }> {
  const j = await callJson<{ timezone_name?: string; currency?: string }>('Meta account', `${GRAPH}/${accountId(account)}?fields=timezone_name,currency`, {
    headers: { Authorization: 'Bearer ' + token.trim() },
  });
  return { tz: (j && j.timezone_name) || 'America/Los_Angeles', currency: String((j && j.currency) || 'USD').toUpperCase() };
}

export interface MetaHour { day: string; hour: number; impressions: number; clicks: number; spend: number; orders: number; sales: number }

/** The same figures by HOUR on the account's own clock (Meta's hourly_stats_aggregated_by_advertiser_time_zone), from
 * `from` to `to` (the account's days). Hourly figures come in many rows, so every page is read. */
export async function insightsHourly(token: string, account: string, from: string, to: string): Promise<MetaHour[]> {
  const q = new URLSearchParams({
    level: 'account', time_increment: '1', limit: '500',
    breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
    fields: 'spend,clicks,impressions,actions,action_values',
    time_range: JSON.stringify({ since: from, until: to }),
  });
  let url = `${GRAPH}/${accountId(account)}/insights?${q}`;
  const out: MetaHour[] = [];
  for (let page = 0; page < 40 && url; page++) {
    const j = await callJson<{ data?: any[]; paging?: { next?: string } }>('Meta insights by hour', url, {
      headers: { Authorization: 'Bearer ' + token.trim() },
    });
    for (const r of (j && j.data) || []) {
      const h = Number(String(r.hourly_stats_aggregated_by_advertiser_time_zone || '').slice(0, 2));
      if (!Number.isInteger(h) || h < 0 || h > 23) continue;
      out.push({ day: String(r.date_start), hour: h, impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0,
        spend: Number(r.spend) || 0, orders: pickPurchase(r.actions), sales: pickPurchase(r.action_values) });
    }
    url = (j && j.paging && j.paging.next) || '';
  }
  return out;
}

/** The purchase count / value Meta reports, by the usual action types. */
function pickPurchase(list: any[] | undefined): number {
  let v = 0;
  for (const a of list || []) if (a.action_type === 'purchase' || a.action_type === 'omni_purchase') v = Math.max(v, Number(a.value) || 0);
  return v;
}

/** Spend, clicks, impressions and the purchases Meta counts, per day from `from` to `to` (the account's days). */
export async function insights(token: string, account: string, from: string, to: string): Promise<Map<string, AdDay>> {
  const q = new URLSearchParams({
    level: 'account', time_increment: '1',
    fields: 'spend,clicks,impressions,actions,action_values',
    time_range: JSON.stringify({ since: from, until: to }),
  });
  const j = await callJson<{ data?: any[] }>('Meta insights', `${GRAPH}/${accountId(account)}/insights?${q}`, {
    headers: { Authorization: 'Bearer ' + token.trim() },
  });
  const pick = (list: any[] | undefined) => {
    let v = 0;
    for (const a of list || []) if (a.action_type === 'purchase' || a.action_type === 'omni_purchase') v = Math.max(v, Number(a.value) || 0);
    return v;
  };
  const out = new Map<string, AdDay>();
  for (const r of (j && j.data) || []) {
    out.set(String(r.date_start), {
      impressions: Number(r.impressions) || 0, clicks: Number(r.clicks) || 0,
      spend: Math.round((Number(r.spend) || 0) * 100) / 100,
      orders: pick(r.actions), sales: Math.round(pick(r.action_values) * 100) / 100,
    });
  }
  return out;
}
