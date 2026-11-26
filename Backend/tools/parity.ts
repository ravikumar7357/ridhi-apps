/* Ask Apps Script and the new backend the SAME question and show the differences.
 *
 *   node tools/parity.ts ping
 *   node tools/parity.ts cacheState
 *   node tools/parity.ts ads:profiles
 *   node tools/parity.ts lh:poll brand=CPC id=12345
 *   node tools/parity.ts ping --record        also saves Apps Script's answer to .parity/ping.json (to become a golden file)
 *
 * Needs three settings in the shell (never in a file in the repo):
 *   PARITY_APPS_SCRIPT_URL   the Pricing-API web app address (…/exec)
 *   PARITY_NEW_URL           the new backend address (…/roneApi)
 *   PARITY_KEY               the shared API key
 *
 * GET routes only. Routes that CHANGE something (POST: mail, MCF, listing patches, fulfilment) are never sent from
 * here — they are checked with test data on the test project instead. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { diffJson, describe } from '../src/lib/parity.ts';

/** Fields that change on every call, per route. Add to this as routes move. */
const IGNORE: Record<string, string[]> = {
  ping: [],
  cacheState: ['at', 'updatedAt', 'started', 'finished'],
};

function query(route: string, extra: string[]): URLSearchParams {
  const [param, value] = route.split(':');
  const q = new URLSearchParams();
  q.set(param, value || '1');
  for (const kv of extra) { const i = kv.indexOf('='); if (i > 0) q.set(kv.slice(0, i), kv.slice(i + 1)); }
  return q;
}

async function ask(base: string, q: URLSearchParams, key: string): Promise<{ ms: number; body: any }> {
  const u = new URL(base);
  q.forEach((v, k) => u.searchParams.set(k, v));
  u.searchParams.set('key', key);
  const t0 = Date.now();
  const r = await fetch(u, { redirect: 'follow' });
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { notJson: text.slice(0, 200), status: r.status }; }
  return { ms: Date.now() - t0, body };
}

async function main() {
  const args = process.argv.slice(2);
  const route = args.find(a => !a.includes('=') && !a.startsWith('--'));
  const record = args.includes('--record');
  const oldUrl = process.env.PARITY_APPS_SCRIPT_URL, newUrl = process.env.PARITY_NEW_URL, key = process.env.PARITY_KEY;
  if (!route) { console.log('Which route? e.g. node tools/parity.ts ping'); process.exit(2); }
  if (!oldUrl || !newUrl || !key) { console.log('Set PARITY_APPS_SCRIPT_URL, PARITY_NEW_URL and PARITY_KEY in this shell first.'); process.exit(2); }

  const q = query(route, args.filter(a => a.includes('=')));
  const [a, b] = await Promise.all([ask(oldUrl, q, key), ask(newUrl, q, key)]);
  const diffs = diffJson(a.body, b.body, { ignore: IGNORE[route] || [], tolerance: 0.005 });

  console.log(`Route ${route}   Apps Script ${a.ms} ms   new backend ${b.ms} ms`);
  console.log(diffs.length ? `${diffs.length} difference(s):\n${describe(diffs)}` : 'Same answer.');
  if (record) {
    mkdirSync(new URL('../.parity/', import.meta.url), { recursive: true });
    const file = new URL(`../.parity/${route.replace(':', '_')}.json`, import.meta.url);
    writeFileSync(file, JSON.stringify(a.body, null, 2));
    console.log('Apps Script\'s answer saved to ' + file.pathname);
  }
  process.exit(diffs.length ? 1 : 0);
}

main().catch(e => { console.error(String(e?.message || e)); process.exit(1); });
