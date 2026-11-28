/* ACTION · RECEIVE ON A CHALLAN — printed fabric (or pieces) back from the printer against one RFD challan (28 Nov).
 *
 * Today (Replenish-App/src/app/flow/flow-receive.js, flowReceiveOpen → "Received") the page checks "never more than
 * was given" against ITS OWN COPY of the challan, which can be minutes old, and two people receiving on one challan at
 * the same moment can both pass the check.
 *
 * Here the server reads the challan FRESH, checks against what is really there, and writes with compare-and-set
 * (core.rt_cas): the challan is written only if nobody changed it since it was read. If somebody did, it reads again
 * and checks again (up to 3 times). The receipt and the "closed" mark go in that one write.
 *
 * Same rules as the page: pieces are whole and never come over; cloth may come up to 10% over what was given;
 * a moved line takes nothing; when every line is back the challan closes ("all received"). */

export interface ReceiveInput {
  requestId: string;
  no: string;                         // the challan number, e.g. RFD-202611-007
  date: string;                       // YYYY-MM-DD
  items: Record<string, number>;      // line key → metres (cloth) or pieces received now
  notCame?: string[];                 // lines crossed "not received this time"
  note?: string;
}

const CLOTH_OVER = 0.1;               // Ravi, 21 Nov: cloth may come 10% over
const r2 = (n: number) => Math.round((+n || 0) * 100) / 100;
const NO_OK = /^T?RFD-\d{6}-\d{3,}$/;

export const unitOf = (l: any): 'pcs' | 'm' => (l && l.print && l.print.kind === 'sku' ? 'pcs' : 'm');
export const sentOf = (l: any) => (unitOf(l) === 'pcs' ? (+l.pcs || 0) : (+l.metres || 0));
export const movedOf = (c: any, l: any) => !!(c && l && !l.ruffleOnly && c.moved && c.moved[l.key]);
export function receivedSoFar(c: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const rc of Object.values(c?.receipts || {}) as any[]) {
    for (const [k, m] of Object.entries(rc?.items || {})) out[k] = r2((out[k] || 0) + (+(m as number) || 0));
  }
  return out;
}

/** Plain-words reason the input cannot be used, or ''. */
export function checkReceiveInput(x: any): string {
  if (!x || typeof x !== 'object') return 'Nothing was sent.';
  if (typeof x.requestId !== 'string' || x.requestId.length < 8 || x.requestId.length > 100) return 'The request has no id (requestId). Refresh the page and try again.';
  if (!NO_OK.test(String(x.no || ''))) return 'Which challan? The number looks wrong.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ''))) return 'The date must look like 2026-11-28.';
  if (!x.items || typeof x.items !== 'object' || Array.isArray(x.items)) return 'Type what came back for at least one line.';
  if (Object.values(x.items).some(v => !Number.isFinite(Number(v)) || Number(v) < 0)) return 'Quantities must be numbers, 0 or more.';
  if (!Object.values(x.items).some(v => Number(v) > 0)) return 'Type what came back for at least one line.';
  if (x.notCame !== undefined && (!Array.isArray(x.notCame) || x.notCame.some((k: unknown) => typeof k !== 'string'))) return 'The "not received" list is wrong.';
  return '';
}

/** The challan after this receipt, or a plain reason it cannot be received. Pure: works on the challan as read. */
export function applyReceipt(c: any, x: ReceiveInput, by: string, nowIso: string, receiptId: string): { next: any; closed: boolean } | { error: string } {
  if (!c || typeof c !== 'object') return { error: `Challan ${x.no} was not found — press Refresh.` };
  if (c.cancelled) return { error: `Challan ${x.no} was cancelled.` };
  if (c.closed) return { error: `Challan ${x.no} is already closed — everything on it is in.` };
  const lines: any[] = Array.isArray(c.lines) ? c.lines : [];
  const byKey = new Map<string, any>();
  for (const l of lines) if (l && !byKey.has(l.key)) byKey.set(l.key, l);
  const recv = receivedSoFar(c);
  const items: Record<string, number> = {}, frac: string[] = [], over: string[] = [], strange: string[] = [], moved: string[] = [];
  for (const [k, raw] of Object.entries(x.items)) {
    const q = r2(Number(raw));
    if (!(q > 0)) continue;
    const l = byKey.get(k);
    if (!l) { strange.push(k); continue; }
    if (movedOf(c, l)) { moved.push(l.sku || k); continue; }
    const u = unitOf(l);
    if (u === 'pcs' && q !== Math.round(q)) frac.push(l.sku || k);
    if ((recv[k] || 0) + q > sentOf(l) * (u === 'pcs' ? 1 : 1 + CLOTH_OVER) + 1e-9) over.push(l.sku || k);
    items[k] = q;
  }
  if (strange.length) return { error: `Not on challan ${x.no}: ${strange.join(', ')}.` };
  if (moved.length) return { error: `Moved to another printer, nothing to receive here: ${moved.join(', ')}.` };
  if (frac.length) return { error: `Pieces are whole: ${frac.join(', ')}.` };
  if (over.length) return { error: `More came back than was given for ${over.join(', ')} — check the figure.` };
  if (!Object.keys(items).length) return { error: 'Type what came back for at least one line.' };

  const rc: any = { date: x.date, items, note: String(x.note || '').trim().slice(0, 500), at: nowIso, by };
  const notCame = (x.notCame || []).filter(k => byKey.has(k) && !(k in items));
  if (notCame.length) rc.notCame = notCame;
  const allBack = lines.every(l => movedOf(c, l) || (recv[l.key] || 0) + (items[l.key] || 0) >= sentOf(l) - 0.01);
  const next = { ...c, receipts: { ...(c.receipts || {}), [receiptId]: rc } };
  if (allBack) next.closed = { at: nowIso, by, why: 'all received' };
  return { next, closed: allBack };
}

export interface ReceiveDeps {
  asPerson: (fn: string, args: object) => Promise<unknown>;
  now: () => number;
  newId?: () => string;
  /** the rules look at the write just before it is made (never throws) */
  beforeSave?: (changes: { k: 'put'; p: string; v: unknown; t: string }[]) => Promise<void>;
}

export async function receiveOnChallan(email: string, x: ReceiveInput, d: ReceiveDeps): Promise<{ ok: true; no: string; receipt: string; closed: boolean }> {
  const bad = checkReceiveInput(x);
  if (bad) throw new Error(bad);
  const path = 'pt_flowChallans/' + x.no;
  const id = d.newId ? d.newId() : 'r' + d.now().toString(36) + Math.random().toString(36).slice(2, 6);
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = await d.asPerson('rt_get', { p_path: path, p_order_by: null, p_equal_to: null, p_limit_last: null });
    const nowIso = new Date(d.now()).toISOString();
    const r = applyReceipt(c, x, email, nowIso, id);
    if ('error' in r) throw new Error(r.error);
    if (d.beforeSave) await d.beforeSave([{ k: 'put', p: path, v: r.next, t: nowIso }]);
    const res = await d.asPerson('rt_cas', { p_path: path, p_expect: c, p_next: r.next });
    if (res !== 'changed') return { ok: true, no: x.no, receipt: id, closed: r.closed };
    // somebody received on this challan in between: read it again and check again
  }
  throw new Error(`Challan ${x.no} is being changed by someone else right now — try again in a moment.`);
}
