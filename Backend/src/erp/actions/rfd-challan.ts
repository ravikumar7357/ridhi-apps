/* ACTION · MAKE RFD CHALLAN — the first ERP business action done by the server in ONE step (28 Nov).
 *
 * Today (Replenish-App/src/app/flow/flow-challan.js, "Make the challan") the page saves twice:
 *   1. the challan            pt_flowChallans/<no>
 *   2. the lines it covers    pt_flowDemand/<line>/fabricReady  (+ pt_ppc/<line>/printer for lines with no printer)
 * If 2 fails, the challan exists but its lines stay in Demand and can be sent twice.
 *
 * Here: the number comes from the database counter (next_no), and the challan, every line's mark and the printers are
 * written in ONE rt_save call — the database applies a call all or nothing. A repeated request (same requestId after a
 * timeout) gets the first answer back and writes nothing twice.
 *
 * The record shapes are exactly the ones the page writes today, so every screen reads them as before. */

export interface ChallanLine {
  key: string; ruffleOnly?: boolean; sku: string; item?: string; print?: unknown; extras?: unknown[];
  fabric?: string; pcs: number; metres: number;
}
export interface RfdChallanInput {
  requestId: string;
  test?: boolean;                 // a test order: TRFD-… numbers, never using up a real one
  date: string;                   // YYYY-MM-DD
  orderNo: string;
  orders?: string[];
  vendor: { code: string; name: string };
  note?: string;
  lines: ChallanLine[];
  setPrinter?: string[];          // line keys PPC left without a printer: the vendor becomes their printer
}
export interface Change { k: 'put' | 'patch'; p: string; v: unknown; t: string }

const KEY_OK = /^[^/\s][^/]{0,199}$/;   // one path segment: no slash, not empty
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Plain-words reason the input cannot be used, or '' when it is fine. */
export function checkInput(x: any): string {
  if (!x || typeof x !== 'object') return 'Nothing was sent.';
  if (typeof x.requestId !== 'string' || x.requestId.length < 8 || x.requestId.length > 100) return 'The request has no id (requestId). Refresh the page and try again.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ''))) return 'The date must look like 2026-11-28.';
  if (!x.orderNo || typeof x.orderNo !== 'string') return 'Which order is this challan for?';
  if (!x.vendor || !String(x.vendor.code || '').trim()) return 'Which vendor is the fabric going to? Pick one.';
  if (!Array.isArray(x.lines) || !x.lines.length) return 'Tick at least one line.';
  if (x.lines.length > 200) return 'At most 200 lines on one challan.';
  for (const l of x.lines) {
    if (!l || !KEY_OK.test(String(l.key || ''))) return 'A line has no proper key.';
    const pcs = Number(l.pcs), m = Number(l.metres);
    if (!Number.isFinite(pcs) || pcs < 0 || pcs !== Math.round(pcs)) return `${l.sku || l.key}: pieces must be a whole number, 0 or more.`;
    if (!Number.isFinite(m) || m < 0) return `${l.sku || l.key}: metres must be a number, 0 or more.`;
    if (l.ruffleOnly && !(m > 0)) return `${l.sku || l.key} (ruffle): how many metres?`;
    if (!(pcs > 0) && !(m > 0)) return `${l.sku || l.key}: nothing to send (0 pieces and 0 metres).`;
  }
  const keys = x.lines.map((l: ChallanLine) => l.key + (l.ruffleOnly ? '~ruffle' : ''));
  if (new Set(keys).size !== keys.length) return 'The same line is on the challan twice.';
  if (x.setPrinter !== undefined) {
    if (!Array.isArray(x.setPrinter) || x.setPrinter.some((k: unknown) => !KEY_OK.test(String(k)))) return 'A printer change has no proper line key.';
    const onIt = new Set(x.lines.filter((l: ChallanLine) => !l.ruffleOnly).map((l: ChallanLine) => l.key));
    if (x.setPrinter.some((k: string) => !onIt.has(k))) return 'A printer can only be set for a line on this challan.';
  }
  return '';
}

/** The challan number from the counter's answer: RFD-202611-007 (TRFD- for test orders). */
export function challanNo(test: boolean | undefined, date: string, n: number): string {
  return (test ? 'TRFD' : 'RFD') + '-' + date.slice(0, 7).replace('-', '') + '-' + String(n).padStart(3, '0');
}

/** Every change of the challan, in the shapes the page writes today. One list = one rt_save = all or nothing. */
export function challanChanges(x: RfdChallanInput, no: string, by: string, nowIso: string): { challan: object; changes: Change[] } {
  const vname = String(x.vendor.name || x.vendor.code);
  const challan = {
    no, date: x.date, orderNo: x.orderNo, orders: x.orders && x.orders.length ? x.orders : [x.orderNo],
    vendor: { code: x.vendor.code, name: vname }, note: String(x.note || '').trim().slice(0, 500), at: nowIso, by,
    lines: x.lines.map(l => ({
      key: l.key, ...(l.ruffleOnly ? { ruffleOnly: true } : {}), sku: l.sku, item: l.item ?? '', print: l.print ?? null,
      extras: l.extras ?? [], fabric: l.fabric ?? '', pcs: Number(l.pcs), metres: r2(Number(l.metres)),
    })),
  };
  const changes: Change[] = [{ k: 'put', p: 'pt_flowChallans/' + no, v: challan, t: nowIso }];
  for (const k of x.setPrinter || []) {
    changes.push({ k: 'patch', p: `pt_ppc/${k}/printer`, v: { code: x.vendor.code, name: vname, why: 'set by challan ' + no }, t: nowIso });
  }
  for (const l of challan.lines) {
    if ((l as any).ruffleOnly) continue;
    changes.push({ k: 'patch', p: `pt_flowDemand/${l.key}/fabricReady`, t: nowIso,
      v: { at: nowIso, by, what: l.fabric, metres: l.metres, note: `Challan ${no} to ${vname}`, challan: no, vendor: vname } });
  }
  return { challan, changes };
}

/** Remembers answers by requestId for an hour, so a repeated request writes nothing twice.
 *  In this process only: a restart forgets (the durable version comes with the server's own store). */
export class RepeatGuard {
  seen = new Map<string, { at: number; answer: Promise<object> }>();
  keepMs: number;
  constructor(keepMs = 3_600_000) { this.keepMs = keepMs; }
  /** The first answer for this id (running or done), or null when the id is new. */
  get(id: string, now: number): Promise<object> | null {
    for (const [k, v] of this.seen) if (now - v.at > this.keepMs) this.seen.delete(k); else break;
    return this.seen.get(id)?.answer ?? null;
  }
  set(id: string, now: number, answer: Promise<object>): void { this.seen.set(id, { at: now, answer }); }
  forget(id: string): void { this.seen.delete(id); }
}

export interface ActionDeps {
  /** call a database function as the signed-in person (their rights, their name on the save) */
  asPerson: (fn: string, args: object) => Promise<unknown>;
  now: () => number;
  /** runs just before the one save, with every change (the rules look here; must never throw) */
  beforeSave?: (changes: Change[]) => Promise<void>;
}

/** Run the action for one signed-in person. Throws with a plain message when it cannot be done. */
export async function makeRfdChallan(email: string, x: RfdChallanInput, d: ActionDeps): Promise<{ ok: true; no: string; lines: number; changes: Change[] }> {
  const bad = checkInput(x);
  if (bad) throw new Error(bad);
  // the counter never gives a number twice; a number made the old way (before the counter) is skipped, never written over
  let no = '';
  for (let tries = 0; tries < 5 && !no; tries++) {
    const n = Number(await d.asPerson('next_no', { p_kind: x.test ? 'TRFD' : 'RFD', p_period: x.date.slice(0, 7).replace('-', ''), p_floor: 0 }));
    if (!(n >= 1)) throw new Error('Could not get a challan number. Try again.');
    const cand = challanNo(x.test, x.date, n);
    if ((await d.asPerson('rt_get', { p_path: 'pt_flowChallans/' + cand, p_order_by: null, p_equal_to: null, p_limit_last: null })) == null) no = cand;
  }
  if (!no) throw new Error('Could not get a free challan number. Try again.');
  const { changes } = challanChanges(x, no, email, new Date(d.now()).toISOString());
  if (d.beforeSave) await d.beforeSave(changes);                                           // the rules (notes only)
  await d.asPerson('rt_save', { p_changes: changes, p_screen: 'server · rfd challan' });   // all or nothing
  return { ok: true, no, lines: x.lines.length, changes };
}
