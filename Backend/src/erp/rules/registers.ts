/* THE ERP RULES, one entry per register — the same table as the database checker (ERP-DB/changes/001, erp.rules),
 * so the server and the database can be compared note for note before either is allowed to refuse a save.
 *
 *   depth        path segments that make one record (pt_x/<id> = 2, pt_x/<code>/<id> = 3)
 *   monthField   the date that decides the record's month (month lock)
 *   required     fields a saved record must have
 *   ranges       number limits
 *   adminWrite   only admins may write this register
 *   adminValues  only admins may set these values (status = authorized)
 *   addOnly      history: no edits, no deletes
 *   noNew        no new records
 *   vendorFields the only top-level fields a vendor may change */

export interface RegisterRule {
  depth: number;
  monthField?: string;
  required?: string[];
  ranges?: Record<string, { min?: number; max?: number }>;
  adminWrite?: boolean;
  adminValues?: Record<string, string[]>;
  addOnly?: boolean;
  noNew?: boolean;
  vendorFields?: string[];
  note?: string;
}

export const RULES: Record<string, RegisterRule> = {
  pt_extraHours: {
    depth: 2, monthField: 'date', required: ['date', 'empName', 'department', 'hours', 'status'],
    ranges: { hours: { min: 0, max: 16 } }, adminValues: { status: ['authorized'] }, note: 'Q1-Q3',
  },
  pt_payoutFreezes: { depth: 2, adminWrite: true, note: 'admin only' },
  pt_kaTargets: { depth: 2, adminWrite: true, note: 'admin only' },
  pt_audit: { depth: 3, addOnly: true, note: 'Q11 add-only' },
  pt_trash: { depth: 2, addOnly: true, note: 'Q11 add-only' },
  pt_pressInventory: { depth: 2, monthField: 'entryDate', noNew: true, note: 'Q15 press entry off since 5 Oct' },
  pt_vendorOrders: { depth: 3, vendorFields: ['status', 'vSent', 'rfdReqs'], note: 'Q10' },
  pt_baseData: { depth: 2, monthField: 'receivingDate', note: 'Q5 job work by receiving date' },
  pt_cuttingData: { depth: 2, monthField: 'date' },
  pt_qcChecks: { depth: 2, monthField: 'date' },
  pt_qcIssuance: { depth: 2, monthField: 'date' },
  pt_qcReturns: { depth: 2, monthField: 'date' },
  pt_attend: { depth: 2, monthField: 'day' },
  pt_fgiLedger: { depth: 2, monthField: 'date', note: 'Q6 DD/MM/YYYY' },
  pt_accLedger: { depth: 2, monthField: 'date' },
  pt_storeLedger: { depth: 2, monthField: 'date' },
  pt_fabInvLedger: { depth: 2, monthField: 'date' },
  pt_flowChallans: { depth: 2, monthField: 'date' },
  pt_salesOrders: { depth: 2, monthField: 'orderDate' },
  pt_greigePOs: { depth: 2, monthField: 'date' },
  pt_vendorChallans: { depth: 3, monthField: 'date' },
};
