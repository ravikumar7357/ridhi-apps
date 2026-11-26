/* The switches, kept in Supabase table backend.controls (key, value) so they can be changed without a deploy:
 *
 *   pause_all            true  → this backend makes NO Amazon call at all
 *   pause:<job>          true  → that job is skipped
 *   owner:<dataset>      'apps-script' | 'backend' → who may ask Amazon for that data. ONE owner at a time: while a
 *                        dataset belongs to Apps Script, the gateway refuses to fetch it (25 Nov audit: the live Ads
 *                        reports were asked for by two systems all day).
 *   share                0.05–1 → the part of Amazon's limits this backend may use. 0.5 while Apps Script still calls
 *                        Amazon with the same app; 1 when Apps Script is at zero.
 *
 * Anything missing reads as the SAFE answer: not ours, half the limit. */

import type { DbLike } from './db.ts';

export const DATASETS = [
  // 'ads-profiles' is listing the advertising profiles a login can see. It has its own switch, apart from the Ads
  // report datasets, because it is a CHECK and not a fetch: it pulls no report and fills no table, so both systems
  // doing it costs nothing and doubles nothing. That makes it safe to hand to this backend first, which is what
  // proves the Ads credentials here before any report moves.
  'ads-profiles',
  'ads-live', 'ads-nightly', 'sales-live', 'orders-report', 'sales-traffic', 'fba-inventory', 'inbound-shipments',
  'listings', 'inventory-age', 'brand-analytics', 'catalog', 'pricing', 'listing-writes', 'mcf',
] as const;
export type Dataset = typeof DATASETS[number];

export interface Controls {
  pausedAll: boolean;
  paused(job: string): boolean;
  owner(dataset: Dataset): string;
  share: number;
}

export function controlsFrom(rows: { key: string; value: unknown }[]): Controls {
  const m = new Map(rows.map(r => [r.key, r.value]));
  const share = Number(m.get('share'));
  return {
    pausedAll: m.get('pause_all') === true,
    paused: (job) => m.get('pause:' + job) === true,
    owner: (d) => String(m.get('owner:' + d) || 'apps-script'),
    share: share > 0 && share <= 1 ? share : 0.5,
  };
}

/** Read the switches. If they can't be read, nothing is ours and everything is paused: fail closed. */
export async function loadControls(db: DbLike): Promise<Controls> {
  try {
    return controlsFrom(await db.select<{ key: string; value: unknown }>('controls', 'select=key,value'));
  } catch {
    return { pausedAll: true, paused: () => true, owner: () => 'apps-script', share: 0.5 };
  }
}
