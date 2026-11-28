/* THE RULE CHECKER: every ERP rule, for one save (a list of changes), in the server.
 *
 * Same rules and same note names as the database checker (ERP-DB/changes/001, erp.check_save):
 *   add_only · no_new · admin_only · admin_value · required · range · month_lock / month_lock_admin · vendor_field
 *
 * It works out, for each record the save touches, the record BEFORE (as it is in ERP data now) and AFTER (with every
 * change of this save applied in order), then asks each rule. NOTES ONLY for now: it never stops a save. */

import { RULES, type RegisterRule } from './registers.ts';
import { monthOf, monthClosed, withAt, type Change } from './month-lock.ts';

export type RuleName = 'add_only' | 'no_new' | 'admin_only' | 'admin_value' | 'required' | 'range'
  | 'month_lock' | 'month_lock_admin' | 'vendor_field';

export interface RuleNote { rule: RuleName; register: string; path: string; detail: string }

export interface CheckDeps {
  getRecord: (path: string) => Promise<unknown>;
  isAdmin: (email: string) => Promise<boolean>;
  /** is this email a vendor (pt_vendorByEmail)? Without it, the vendor rule is skipped. */
  isVendor?: (email: string) => Promise<boolean>;
  now: number;
}

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const empty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export async function checkSave(email: string, changes: Change[], d: CheckDeps): Promise<RuleNote[]> {
  const notes: RuleNote[] = [];
  const before = new Map<string, unknown>(), after = new Map<string, unknown>(), regOf = new Map<string, string>();

  for (const c of changes) {
    const s = String(c.p || '').replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const r = RULES[s[0]];
    if (!r) continue;
    if (s.length < r.depth) {
      // a write above one record (a whole list or a branch): only the history rule looks at it
      if (r.addOnly && c.k !== 'put') notes.push({ rule: 'add_only', register: s[0], path: s.join('/'), detail: 'write above one record of a history list' });
      continue;
    }
    const rec = s.slice(0, r.depth).join('/');
    if (!before.has(rec)) {
      const cur = (await d.getRecord(rec)) ?? null;
      before.set(rec, cur); after.set(rec, cur); regOf.set(rec, s[0]);
    }
    after.set(rec, withAt(after.get(rec), s.slice(r.depth), c.v, c.k));
  }

  // looked up once, only when a rule needs them
  let admin: boolean | null = null, vendor: boolean | null = null;
  const isAdmin = async () => (admin ??= await d.isAdmin(email));
  const isVendor = async () => (vendor ??= d.isVendor ? await d.isVendor(email) : false);

  for (const [rec, oldRec] of before) {
    const newRec = after.get(rec) ?? null;
    if (same(oldRec, newRec)) continue;
    const reg = regOf.get(rec)!, r: RegisterRule = RULES[reg];
    const note = (rule: RuleName, detail: string) => notes.push({ rule, register: reg, path: rec, detail });

    if (r.addOnly && oldRec !== null) note('add_only', newRec === null ? 'deleted a history record' : 'changed a history record');
    if (r.noNew && oldRec === null && newRec !== null) note('no_new', 'new record in a register that takes no new rows');
    if (r.adminWrite && !(await isAdmin())) note('admin_only', 'non-admin wrote an admin-only register');

    if (isObj(newRec) && r.adminValues) {
      for (const [f, values] of Object.entries(r.adminValues)) {
        const v = newRec[f];
        if (!same(v, isObj(oldRec) ? oldRec[f] : undefined) && values.includes(String(v)) && !(await isAdmin())) {
          note('admin_value', `non-admin set ${f} = ${v}`);
        }
      }
    }

    if (isObj(newRec) && r.required?.length) {
      const missing = r.required.filter(f => empty(newRec[f]));
      if (missing.length) note('required', 'missing: ' + missing.join(', '));
    }

    if (isObj(newRec) && r.ranges) {
      for (const [f, lim] of Object.entries(r.ranges)) {
        const raw = newRec[f];
        if (raw === null || raw === undefined || !/^-?\d+(\.\d+)?$/.test(String(raw))) continue;
        const x = Number(raw);
        if ((lim.min !== undefined && x < lim.min) || (lim.max !== undefined && x > lim.max)) {
          note('range', `${f} = ${x} outside ${JSON.stringify(lim)}`);
        }
      }
    }

    if (r.monthField) {
      const mOld = isObj(oldRec) ? monthOf(oldRec[r.monthField]) : null;
      const mNew = isObj(newRec) ? monthOf(newRec[r.monthField]) : null;
      const closed = monthClosed(mOld, d.now) ? mOld : monthClosed(mNew, d.now) ? mNew : null;
      if (closed) {
        const adm = await isAdmin();
        note(adm ? 'month_lock_admin' : 'month_lock', `closed month ${closed}` + (adm ? ' (admin: allowed with a reason)' : ''));
      }
    }

    if (r.vendorFields && (await isVendor())) {
      const o = isObj(oldRec) ? oldRec : {}, n = isObj(newRec) ? newRec : {};
      const changed = [...new Set([...Object.keys(o), ...Object.keys(n)])]
        .filter(k => !same(o[k], n[k]) && !r.vendorFields!.includes(k));
      if (changed.length) note('vendor_field', 'vendor changed: ' + changed.join(', '));
    }
  }
  return notes;
}
