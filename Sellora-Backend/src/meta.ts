/* Meta (Facebook + Instagram) ads: the Marketing API's insights for an ad account, by day. Meta counts a day in the AD
 * ACCOUNT's own timezone, which may not be Pacific — that zone is stored with every row. The token should be a System
 * User token with ads_read (Business Settings → System users): a personal token expires in about 60 days. */

import { callJson } from './http.ts';
import type { AdDay } from './ads.ts';

export const GRAPH = 'https://graph.facebook.com/v23.0';

export function accountId(a: string): string {
  return 'act_' + String(a || '').trim().replace(/^act_/, '');
}

/** The account's own timezone, e.g. "America/Los_Angeles". */
export async function accountTz(token: string, account: string): Promise<string> {
  const j = await callJson<{ timezone_name?: string }>('Meta account', `${GRAPH}/${accountId(account)}?fields=timezone_name`, {
    headers: { Authorization: 'Bearer ' + token.trim() },
  });
  return (j && j.timezone_name) || 'America/Los_Angeles';
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
