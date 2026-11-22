/* Exchange rates to US dollars, so every figure in sellora is in the same money as Amazon's sales (21 Nov: Ridhi's Meta
 * ad account reports in rupees — ₹263,095 a day read as $263,095). The European Central Bank's daily reference rates,
 * through Frankfurter (free, no key). The ECB publishes on working days only: a weekend or holiday, or today before the
 * day's rate is out, takes the latest rate before it. */

import { callJson } from './http.ts';
import { shiftDay, daysBetween } from './time.ts';

export const FX_URL = 'https://api.frankfurter.dev/v1';

/** One USD rate per day from `from` to `to` (both included): 1 unit of `currency` = rate US dollars. */
export async function usdRates(currency: string, from: string, to: string): Promise<Map<string, number>> {
  const cur = String(currency || 'USD').toUpperCase(), out = new Map<string, number>();
  if (cur === 'USD') { for (const d of daysBetween(from, to)) out.set(d, 1); return out; }
  const start = shiftDay(from, -10);                                    // reach back past a long weekend
  const j = await callJson<{ rates?: Record<string, Record<string, number>> }>('Exchange rates',
    `${FX_URL}/${start}..${to}?from=${encodeURIComponent(cur)}&to=USD`);
  const known = Object.entries((j && j.rates) || {}).map(([d, r]) => [d, Number(r.USD)] as [string, number])
    .filter(([, r]) => r > 0).sort((a, b) => a[0].localeCompare(b[0]));
  if (!known.length) throw new Error(`Exchange rates: no ${cur} → USD rate from ${start} to ${to}`);
  let i = 0, last = 0;
  for (const d of daysBetween(start, to)) {
    while (i < known.length && known[i][0] <= d) last = known[i++][1];
    if (d >= from && last) out.set(d, last);
  }
  return out;
}
