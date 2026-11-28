/* A store with the FBA lists running over a made-up database, for the hold-auto-note suite: what fba-lists-test.js sets up,
 * cut down to making a list. The website-hold figure is missing, and a stand-in for the shared copy notes it (or says why not). */
const { same, line, whole, appFile, NOW, row, store } = require('./india-store-harness');
const copy = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
const asRead = v => (v && typeof v === 'object' ? (Array.isArray(v) ? v.map(asRead)
  : Object.keys(v).sort().reduce((o, k) => Object.assign(o, { [k]: asRead(v[k]) }), {})) : v);

function lists(o = {}) {
  const S = store(Object.assign({ admin: false }, o));
  const db = S.db, ledger = new Map([row('O', 'OPENING', 20)].map(r => [r._id, copy(r)]));
  db._shopHold = { releases: {} };
  S.ctx.FGI.set = Object.assign({}, S.ctx.FGI.set, { _shopHold: { releases: {} } });
  const at = p => p.split('/').slice(1).reduce((v, k) => (v == null ? v : v[k]), db);
  const set = (p, v) => {
    const seg = p.split('/').slice(1), last = seg.pop(); let n = db;
    seg.forEach(k => { n = n[k] = n[k] || {}; });
    if (v === null) delete n[last]; else n[last] = copy(v);
  };
  S.calls = 0;
  const readSales = S.ctx.ptGet;
  S.ctx.ME = { email: 'team@test', admin: !!o.admin, tabs: ['fba'] };
  Object.assign(S.ctx, {
    spIsVendor: () => false, ptDtMs: () => 0, wpShow() {}, wpRefuse: why => why,
    ptGetFresh: async p => asRead(copy(at(p))),
    ptGet: async p => (p === 'pt_salesOrders' ? readSales(p) : p === 'pt_fgiLedger' ? copy(Object.fromEntries(ledger)) : copy(ledger.get(p.split('/')[1]))),
    ptCas: async (p, expect, next) => { if (!same(asRead(copy(at(p))), copy(expect))) return 'changed'; set(p, next); return ''; },
    ptPatch: async patch => Object.entries(patch).forEach(([k, v]) => set(k, v)),
    lstAlertFor: async () => '',
    soHoldNoteFromCopy: async () => {
      S.calls++;
      if (o.noteWhy) return o.noteWhy;
      db._shopHold = { SP: { at: NOW, skus: {} }, CPC: { at: NOW, skus: {} }, releases: {} };
      return '';
    },
  });
  S.ctx.FGI.rows = [...ledger.values()].map(copy);
  S.run(line('core/helpers.js', 'const dTodayIndia') + line('core/helpers.js', 'const dAdd') + line('core/helpers.js', 'const ptDayWords')
    + line('core/helpers.js', 'const dDiff') + line('core/helpers.js', 'const PT_DATE_BACK_DAYS') + whole('core/helpers.js', 'ptDateErr')
    + line('inventory/fg-change-remove.js', 'const fgiDmy') + line('inventory/fba-dispatch.js', 'const fbaCan')
    + line('inventory/fg-other-movements.js', 'const FGI_FBA_ACCOUNTS') + 'const ptIsoDate = d => String(d || "").split("/").reverse().join("-");\n'
    + appFile('inventory/fg-fba-repeat.js') + appFile('inventory/fba-lists.js'));
  S.saved.fbaList = '1';
  S.open = () => db._fbaLists || {};
  S.make = qty => S.ctx.fblMake({ id: 'L1', account: 'Ridhi FBA', lane: 'sea', lines: [{ sku: 'A', qty }] });
  return S;
}
module.exports = { lists };
