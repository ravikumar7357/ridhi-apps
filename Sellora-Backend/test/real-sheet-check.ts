/* By hand only (not part of npm test): reads the REAL published sheet and shows what the one-time history import would
 * write. Writes nothing anywhere.   node test/real-sheet-check.ts */
import { LIVE_CSV, parseSnapshotCsv, historyRows } from '../src/backfill.ts';
import { ptDay } from '../src/time.ts';

const now = Date.now(), today = ptDay(now);
const snap = parseSnapshotCsv(await (await fetch(LIVE_CSV + '&t=' + now)).text());
const { daily, ads } = historyRows(snap, today, now);
const by = (rows: any[], f: (r: any) => string) => rows.reduce((o, r) => { const k = f(r); o[k] = o[k] || { n: 0, first: r.day, last: r.day }; o[k].n++; if (r.day < o[k].first) o[k].first = r.day; if (r.day > o[k].last) o[k].last = r.day; return o; }, {} as Record<string, any>);
console.log('snapshot asOf', snap.asOf, '· today (Pacific)', today);
console.table(by(daily, r => r.brand + ' ' + r.channel));
console.table(by(ads, r => r.brand + ' ' + r.ad_type));
const pick = (b: string, c: string, d: string) => (daily.find((r: any) => r.brand === b && r.channel === c && r.day === d) as any) || null;
console.log('CPC amazon 2025-11-20 (last year, should be 32473.19):', pick('CPC', 'amazon', '2025-11-20')?.sales);
