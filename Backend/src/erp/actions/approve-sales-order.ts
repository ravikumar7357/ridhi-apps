/* ACTION · APPROVE A SALES ORDER — into production (28 Nov).
 *
 * Today (Replenish-App/src/app/orders/raise-sales-order.js, soApproveRun) the page:
 *   1. writes the order as approved, then
 *   2. writes the order-book rows 200 at a time — an order can carry 1,200 SKUs, so a failed batch leaves the order
 *      "approved" with only part of it in the order book.
 * And the right to approve (soApprove) is only checked in the browser.
 *
 * Here: the server checks the right itself (admin, or "Can approve sales orders"; never a vendor), reads the order and
 * the order book FRESH, and writes the approval and every missing order-book row in ONE rt_save — all or nothing.
 * Approving twice adds nothing twice: a row exists per order + SKU, and those already in the book are left alone.
 * The records are the same shape the page writes, so every screen reads them as before. */

export interface ApproveInput {
  requestId: string;
  orderId: string;
  mode: 'complete' | 'lines';      // one date for the whole order, or the date already on each line
  date?: string;                   // YYYY-MM-DD, for 'complete'
  remarks?: string;
}
export interface Change { k: 'put'; p: string; v: unknown; t: string }

export const UC = (s: unknown) => String(s == null ? '' : s).trim().toUpperCase();
const linesOf = (o: any): any[] => (Array.isArray(o?.lines) ? o.lines : Object.values(o?.lines || {})).filter(Boolean);
const isB2B = (ch: unknown) => UC(ch) === 'B2B';
const KEY_OK = /^[^/\s][^/]{0,199}$/;

export const NO_RIGHT = 'Approving a sales order needs permission. Ask an admin to switch on "Can approve sales orders" for your account.';

export function checkApproveInput(x: any): string {
  if (!x || typeof x !== 'object') return 'Nothing was sent.';
  if (typeof x.requestId !== 'string' || x.requestId.length < 8 || x.requestId.length > 100) return 'The request has no id (requestId). Refresh the page and try again.';
  if (!KEY_OK.test(String(x.orderId || ''))) return 'Which order?';
  if (x.mode !== 'complete' && x.mode !== 'lines') return 'Pick how delivery is dated: one date, or the date on each line.';
  if (x.mode === 'complete' && !/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ''))) return 'Set the delivery date for the order, or switch to the date already on each line.';
  return '';
}

/** The approved order and the order-book rows to add, or a plain reason. Pure: works on what was read. */
export function planApproval(o: any, existingBookSkus: Set<string>, master: Map<string, any>, x: ApproveInput, by: string, nowIso: string)
  : { order: any; rows: any[] } | { error: string } {
  if (!o || typeof o !== 'object') return { error: 'That order is gone — press Refresh.' };
  let lines = linesOf(o).slice();
  if (!lines.length) return { error: 'This order has no lines to approve.' };
  if (x.mode === 'complete') lines = lines.map(l => ({ ...l, deliveryDate: x.date }));
  else {
    const missing = lines.filter(l => !l.deliveryDate).length;
    if (missing) return { error: `${missing} line(s) have no delivery date, so there is nothing to approve them against.` };
  }
  const order = {
    ...o, lines, status: 'approved', saRemarks: String(x.remarks || '').trim().slice(0, 1000),
    approvedAt: nowIso, approvedBy: by,
    deliveryMode: x.mode === 'complete' ? 'complete' : 'partial',
    deliveryDate: x.mode === 'complete' ? x.date : '',
  };

  // one order-book row per SKU, at a key made of the order and the SKU: approving twice lands on the same keys
  const per = new Map<string, number>(), firstOf = new Map<string, any>();
  for (const l of lines) {
    const s = UC(l.sku); if (!s) continue;
    per.set(s, (per.get(s) || 0) + (parseFloat(l.qty) || 0));
    if (!firstOf.has(s)) firstOf.set(s, l);
  }
  const b2b = isB2B(o.channel), rows: any[] = [];
  for (const [s, v] of per) {
    const qty = Math.round(v);
    if (qty <= 0 || existingBookSkus.has(s)) continue;
    const m = master.get(s) || {}, l = firstOf.get(s) || {};
    const bits = b2b ? [l.brand, l.itemName, l.material && 'Material: ' + l.material,
      l.label && !/^no$/i.test(l.label) && 'Label: ' + l.label,
      l.customization && !/^no$/i.test(l.customization) && 'Customization: ' + l.customization].filter(Boolean) : [];
    rows.push({
      id: 'ob_so_' + UC(o._id ?? x.orderId) + '_' + s, orderNo: o._id ?? x.orderId, orderDate: o.orderDate || nowIso.slice(0, 10),
      sku: s, articleType: String(m.articleType || ''), articleSubtype: String(m.subtype || ''),
      color: String(m.color || (b2b ? l.color : '') || ''), size: String(m.size || l.size || ''), qty,
      remarks: 'From approved Sales Order' + (o.buyerName ? ' · ' + o.buyerName : '') + (bits.length ? ' · ' + bits.join(' · ') : ''), src: 'SO',
      uploadedBy: by, uploadedAt: nowIso,
      ...(o.saleMonth ? { saleMonth: o.saleMonth } : {}),
      ...(b2b ? { needsSku: !master.has(s), shopImg: String(l.img || ''), brand: String(l.brand || ''), itemName: String(l.itemName || ''),
        label: String(l.label || ''), material: String(l.material || ''), customization: String(l.customization || '') } : {}),
    });
  }
  if (rows.length > 1990) return { error: `This order has ${rows.length} SKUs to add; one save takes at most 1,990. Split the order.` };
  return { order, rows };
}

export interface ApproveDeps {
  asPerson: (fn: string, args: object) => Promise<unknown>;
  /** the person's rights as the server reads them (pt_perms), with the server key */
  perms: (email: string) => Promise<{ admin?: boolean; soApprove?: boolean; vendor?: boolean } | null>;
  now: () => number;
  beforeSave?: (changes: Change[]) => Promise<void>;
}

export async function approveSalesOrder(email: string, x: ApproveInput, d: ApproveDeps): Promise<{ ok: true; orderId: string; added: number; alreadyInBook: number }> {
  const bad = checkApproveInput(x);
  if (bad) throw new Error(bad);
  const p = await d.perms(email);
  if (!p || p.vendor || !(p.admin || p.soApprove)) throw new Error(NO_RIGHT);

  const get = (path: string, orderBy: string | null = null, equalTo: unknown = null) =>
    d.asPerson('rt_get', { p_path: path, p_order_by: orderBy, p_equal_to: equalTo, p_limit_last: null });
  const o = await get('pt_salesOrders/' + x.orderId);
  const book = (await get('pt_orderBook', 'orderNo', (o as any)?._id ?? x.orderId)) as Record<string, any> | null;
  const have = new Set(Object.values(book || {}).filter(r => r && UC(r.orderNo) === UC((o as any)?._id ?? x.orderId)).map(r => UC(r.sku)));
  const mdb = (await get('pt_masterDB')) as any;
  const master = new Map<string, any>((Array.isArray(mdb) ? mdb : Object.values(mdb || {})).filter(Boolean).map((r: any) => [UC(r.sku), r]));

  const nowIso = new Date(d.now()).toISOString();
  const plan = planApproval(o, have, master, x, email, nowIso);
  if ('error' in plan) throw new Error(plan.error);
  const changes: Change[] = [{ k: 'put', p: 'pt_salesOrders/' + x.orderId, v: plan.order, t: nowIso }]
    .concat(plan.rows.map(r => ({ k: 'put' as const, p: 'pt_orderBook/' + r.id, v: r, t: nowIso })));
  if (d.beforeSave) await d.beforeSave(changes);
  await d.asPerson('rt_save', { p_changes: changes, p_screen: 'server · approve sales order' });   // all or nothing
  return { ok: true, orderId: x.orderId, added: plan.rows.length, alreadyInBook: have.size };
}
