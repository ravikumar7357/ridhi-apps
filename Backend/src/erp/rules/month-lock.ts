/* RULE 1 · MONTH LOCK — the first ERP rule that lives in the server (28 Nov).
 *
 * A month closes after the 5th of the next month (India time). After that, only admins may add, change or delete
 * a record of that month. "The month" of a record is the date in its month field (job work: receivingDate, etc.).
 * Editing an old record counts if EITHER its old month or its new month is closed (so a record cannot be moved
 * out of, or into, a closed month).
 *
 * Same rule, same registers and same date formats as the database checker (ERP-DB/changes/001), so the two can be
 * compared note for note before the server is allowed to refuse anything.
 *
 * NOTES ONLY for now: the door logs what this rule would have refused and saves anyway. */

/** register → which path segments make one record, and which field holds its date */
export const MONTH_RULES: Record<string, { depth: number; field: string }> = {
  pt_extraHours: { depth: 2, field: 'date' },
  pt_pressInventory: { depth: 2, field: 'entryDate' },
  pt_baseData: { depth: 2, field: 'receivingDate' },
  pt_cuttingData: { depth: 2, field: 'date' },
  pt_qcChecks: { depth: 2, field: 'date' },
  pt_qcIssuance: { depth: 2, field: 'date' },
  pt_qcReturns: { depth: 2, field: 'date' },
  pt_attend: { depth: 2, field: 'day' },
  pt_fgiLedger: { depth: 2, field: 'date' },
  pt_accLedger: { depth: 2, field: 'date' },
  pt_storeLedger: { depth: 2, field: 'date' },
  pt_fabInvLedger: { depth: 2, field: 'date' },
  pt_flowChallans: { depth: 2, field: 'date' },
  pt_salesOrders: { depth: 2, field: 'orderDate' },
  pt_greigePOs: { depth: 2, field: 'date' },
  pt_vendorChallans: { depth: 3, field: 'date' },
};

export const CLOSE_DAY = 5;
const IST_MS = 5.5 * 3600_000;

const istMonth = (ms: number) => new Date(ms + IST_MS).toISOString().slice(0, 7);

/** 'YYYY-MM' from "2026-10-14…", "14/10/2026…", or epoch milliseconds (number or text); null if it cannot tell. */
export function monthOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? istMonth(v) : null;
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}`;
  if (/^\d{12,13}$/.test(t)) return istMonth(Number(t));
  return null;
}

/** Is month 'YYYY-MM' closed at this moment? Closed from the (closeDay+1)th of the next month, India time. */
export function monthClosed(month: string | null, now: number, closeDay = CLOSE_DAY): boolean {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return false;
  const [y, mo] = month.split('-').map(Number);
  const opensUntil = Date.UTC(y, mo, closeDay + 1) - IST_MS;   // month mo (0-based next month), day closeDay+1, 00:00 IST
  return now >= opensUntil;
}

export interface Change { k: string; p: string; v?: unknown }
export interface Note { rule: 'month_lock' | 'month_lock_admin'; path: string; register: string; detail: string }

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** the record after writing `value` at `sub` inside it (sub = [] means the whole record) */
function withAt(rec: unknown, sub: string[], value: unknown, kind: string): unknown {
  if (!sub.length) {
    if (kind === 'delete' || value === null || value === undefined) return null;
    if (kind === 'patch' && isObj(value)) return { ...(isObj(rec) ? rec : {}), ...value };
    return value;
  }
  const base: Record<string, unknown> = isObj(rec) ? { ...rec } : {};
  const next = withAt(base[sub[0]], sub.slice(1), value, kind);
  if (next === null) delete base[sub[0]]; else base[sub[0]] = next;
  return Object.keys(base).length ? base : null;
}

export interface MonthLockDeps {
  /** the record as it is now in ERP data (null if new) */
  getRecord: (path: string) => Promise<unknown>;
  isAdmin: (email: string) => Promise<boolean>;
  now: number;
}

/** What the month lock says about one save (a list of changes). Empty list = nothing against the rule. */
export async function checkMonthLock(email: string, changes: Change[], d: MonthLockDeps): Promise<Note[]> {
  const notes: Note[] = [];
  const before = new Map<string, unknown>(), after = new Map<string, unknown>();
  for (const c of changes) {
    const s = String(c.p || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const r = MONTH_RULES[s[0]];
    if (!r || s.length < r.depth) continue;              // not a month register, or a write above one record
    const rec = s.slice(0, r.depth).join('/');
    if (!before.has(rec)) { const cur = await d.getRecord(rec); before.set(rec, cur ?? null); after.set(rec, cur ?? null); }
    after.set(rec, withAt(after.get(rec), s.slice(r.depth), c.v, c.k));
  }
  let admin: boolean | null = null;
  for (const [rec, oldRec] of before) {
    const newRec = after.get(rec);
    if (JSON.stringify(oldRec) === JSON.stringify(newRec)) continue;
    const reg = rec.split('/')[0], f = MONTH_RULES[reg].field;
    const mOld = isObj(oldRec) ? monthOf(oldRec[f]) : null;
    const mNew = isObj(newRec) ? monthOf(newRec[f]) : null;
    const closed = monthClosed(mOld, d.now) ? mOld : monthClosed(mNew, d.now) ? mNew : null;
    if (!closed) continue;
    if (admin === null) admin = await d.isAdmin(email);
    notes.push({ rule: admin ? 'month_lock_admin' : 'month_lock', path: rec, register: reg,
      detail: `closed month ${closed}` + (admin ? ' (admin: allowed with a reason)' : '') });
  }
  return notes;
}
