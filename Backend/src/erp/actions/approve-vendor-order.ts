/* ACTION · APPROVE A VENDOR ORDER REQUEST — the request becomes an order on the vendor's portal (28 Nov).
 *
 * Today (Replenish-App/src/app/vendors/orders/vendor-order-requests.js, vrqApprove) the page saves THREE times:
 *   1. the order            pt_vendorOrders/<vendor>/vpo_<request>
 *   2. the vendor's login   pt_vendorMap/<vendor>
 *   3. the request          pt_vendorOrderReqs/<request>  → approved
 * If 3 fails the order is with the vendor while the request still says pending. The order number is made in the
 * browser (VPO-YYMMDD- and three random letters, checked only against that page's copy), and the right to approve
 * (vreqApprove) is only checked in the browser.
 *
 * Here: the right is checked by the server; the request and the vendor are read FRESH; the number comes from the
 * database counter (VPO-YYMMDD-NNN, never given twice); and the three records go in ONE rt_save — all or nothing.
 * Approving again never sends the order twice: its id is fixed by the request (vpo_<request>), as on the page.
 *
 * Still on the page for now (it needs the order book and every open order): the printer-cap check and the
 * "this is a flow order" check, run before the page calls this. The page may send its lines stamped with the
 * sales orders they are for; the server takes them only if they are the request's own lines (same SKU, same qty). */

export interface ApproveVoInput {
  requestId: string;
  reqId: string;                 // the request's id (pt_vendorOrderReqs/<reqId>)
  vendor?: string;               // send to another vendor than asked for
  note?: string;
  stampedLines?: any[];          // the page's lines with their sales orders stamped on (optional)
}
export interface Change { k: 'put'; p: string; v: unknown; t: string }

const KEY_OK = /^[^/\s][^/]{0,199}$/;
const linesOf = (o: any): any[] => (Array.isArray(o?.lines) ? o.lines : Object.values(o?.lines || {})).filter(Boolean);
const listOf = (v: any): any[] => (Array.isArray(v) ? v : Object.values(v || {})).filter(Boolean);
export const NO_VO_RIGHT = 'Approving a vendor order request needs permission. Ask an admin to switch on "Approve vendor order requests" for your account.';

export function checkVoInput(x: any): string {
  if (!x || typeof x !== 'object') return 'Nothing was sent.';
  if (typeof x.requestId !== 'string' || x.requestId.length < 8 || x.requestId.length > 100) return 'The request has no id (requestId). Refresh the page and try again.';
  if (!KEY_OK.test(String(x.reqId || ''))) return 'Which request?';
  if (x.vendor !== undefined && !KEY_OK.test(String(x.vendor))) return 'Which vendor?';
  if (x.stampedLines !== undefined && !Array.isArray(x.stampedLines)) return 'The lines sent are not a list.';
  return '';
}

/** Today in India as DD/MM/YYYY and YYMMDD (the order date and the number's day). */
export function istDay(ms: number): { dmy: string; yymmdd: string; yyyymm: string } {
  const d = new Date(ms + 5.5 * 3600_000), y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), dd = String(d.getUTCDate()).padStart(2, '0');
  return { dmy: `${dd}/${m}/${y}`, yymmdd: String(y).slice(2) + m + dd, yyyymm: `${y}${m}` };
}

/** The request's lines, or the page's stamped copy when it is the same lines (same SKUs and quantities, in order). */
export function pickLines(reqLines: any[], stamped: any[] | undefined): any[] {
  const mine = reqLines.filter(l => !l.cancelled);
  if (!stamped || stamped.length !== mine.length) return mine.map(l => ({ ...l }));
  const same = mine.every((l, i) => String(l.sku ?? '') === String(stamped[i]?.sku ?? '')
    && String(l.qty ?? '') === String(stamped[i]?.qty ?? '') && String(l.meters ?? '') === String(stamped[i]?.meters ?? ''));
  return same ? stamped.map(l => ({ ...l })) : mine.map(l => ({ ...l }));
}

export interface PlanOut { order: any | null; request: any; map: { email: string; name: string } | null; orderNo: string; vname: string }

/** Every record of the approval, or a plain reason. Pure: works on what was read. */
export function planVoApproval(r: any, vendors: any[], existingOrder: any, x: ApproveVoInput, by: string, nowIso: string, dmy: string, newNo: string)
  : PlanOut | { error: string } {
  if (!r || typeof r !== 'object') return { error: 'That request is gone — press Refresh.' };
  if (r.status !== 'pending') return { error: `${r.reqNo || x.reqId} is not waiting for approval any more (${r.status}).` };
  const code = String(x.vendor || r.vendorCode || '').trim();
  const vend = vendors.find(v => v && v.active !== false && String(v.code) === code);
  if (!vend) return { error: 'That vendor is not active in the vendor master any more. Pick another one.' };
  const lines = pickLines(linesOf(r), x.stampedLines);
  if (!lines.length) return { error: 'This request has no lines to send.' };
  const vname = String(vend.desc || vend.name || code), oid = 'vpo_' + x.reqId;
  const order = existingOrder ? null : {
    id: oid, orderNo: newNo, vendorCode: code, vendorName: vname, service: String(r.service || 'Block print').trim(),
    ...(r.channel ? { channel: String(r.channel) } : {}),
    orderType: r.orderType === 'running' ? 'running' : 'cut',
    ...(r.filler ? { filler: String(r.filler) } : {}),
    orderDate: dmy, status: 'Placed', notes: String(r.notes || ''), lines,
    createdBy: r.requestedBy || by, createdAt: nowIso, approvedBy: by, approvedAt: nowIso,
    requestId: x.reqId, requestNo: r.reqNo || '',
    ...(r.orderType === 'running' ? {} : { demandSource: 'bulk' }),
  };
  const orderNo = existingOrder ? String(existingOrder.orderNo || '') : newNo;
  const note = String(x.note || '').trim().slice(0, 500), moved = String(r.vendorCode || '') !== code;
  const request = {
    ...r, status: 'approved', approvedBy: by, approvedAt: nowIso, approveNote: note,
    sentTo: code, sentToName: vname, vendorOrderId: oid, vendorOrderNo: orderNo,
    log: (Array.isArray(r.log) ? r.log : []).concat([{ at: nowIso, by,
      what: 'Approved and sent to ' + vname + ' as ' + orderNo + (moved ? ' (asked for ' + (r.vendorName || r.vendorCode || '') + ')' : '') + (note ? ' — ' + note : '') }]),
  };
  delete (request as any)._key;
  const map = !existingOrder && vend.email ? { email: String(vend.email).toLowerCase(), name: String(vend.name || code) } : null;
  return { order, request, map, orderNo, vname };
}

export interface ApproveVoDeps {
  asPerson: (fn: string, args: object) => Promise<unknown>;
  perms: (email: string) => Promise<{ admin?: boolean; vreqApprove?: boolean; vendor?: boolean } | null>;
  now: () => number;
  beforeSave?: (changes: Change[]) => Promise<void>;
}

export async function approveVendorOrder(email: string, x: ApproveVoInput, d: ApproveVoDeps): Promise<{ ok: true; orderNo: string; vendor: string; sentBefore: boolean }> {
  const bad = checkVoInput(x);
  if (bad) throw new Error(bad);
  const p = await d.perms(email);
  if (!p || p.vendor || !(p.admin || p.vreqApprove)) throw new Error(NO_VO_RIGHT);

  const get = (path: string) => d.asPerson('rt_get', { p_path: path, p_order_by: null, p_equal_to: null, p_limit_last: null });
  const r: any = await get('pt_vendorOrderReqs/' + x.reqId);
  const vendors = listOf(await get('pt_masters/vendor'));
  const code = String(x.vendor || r?.vendorCode || '').trim();
  const existing = code ? await get(`pt_vendorOrders/${code}/vpo_${x.reqId}`) : null;

  const now = d.now(), nowIso = new Date(now).toISOString(), day = istDay(now);
  let newNo = '';
  if (!existing && r && r.status === 'pending') {
    const n = Number(await d.asPerson('next_no', { p_kind: 'VPO', p_period: day.yyyymm, p_floor: 0 }));
    if (!(n >= 1)) throw new Error('Could not get an order number. Try again.');
    newNo = `VPO-${day.yymmdd}-${String(n).padStart(3, '0')}`;
  }
  const plan = planVoApproval(r, vendors, existing, x, email, nowIso, day.dmy, newNo);
  if ('error' in plan) throw new Error(plan.error);

  const changes: Change[] = [];
  if (plan.order) changes.push({ k: 'put', p: `pt_vendorOrders/${code}/${plan.order.id}`, v: plan.order, t: nowIso });
  if (plan.map) changes.push({ k: 'put', p: 'pt_vendorMap/' + code, v: plan.map, t: nowIso });
  changes.push({ k: 'put', p: 'pt_vendorOrderReqs/' + x.reqId, v: plan.request, t: nowIso });
  if (d.beforeSave) await d.beforeSave(changes);
  await d.asPerson('rt_save', { p_changes: changes, p_screen: 'server · approve vendor order' });   // all or nothing
  return { ok: true, orderNo: plan.orderNo, vendor: plan.vname, sentBefore: !!existing };
}
