/* FINISHED GOODS LIGHT OPEN (switch fgLite) — inventory/finished-goods.js fgiLoad + fgLiteOn, flow/flow-qcfg.js badge functions.
 *   node tests/fg-lite-test.js            (FG_SRC=<file> / FQ_SRC=<file> run another copy of either file; the teeth do)
 * What must hold: the switch order (0 beats the flag, 1 is on, else the flag; never for vendors or harnesses); switch OFF opens the
 * screen with exactly today's calls (the whole flow is read for the badge); switch ON reads none of the flow's nodes on open (no
 * flowEnsureData), shows "…" until the flow is in memory, shows exactly today's number once it is, and opening "From QC" loads the
 * flow first and then fills the same number. */
const fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
const APP = path.join(__dirname, '..', 'src', 'app');
const FG = rd(process.env.FG_SRC || path.join(APP, 'inventory/finished-goods.js')), FQ = rd(process.env.FQ_SRC || path.join(APP, 'flow/flow-qcfg.js'));
const cut = (src, name) => { let i = src.indexOf('async function ' + name + '('); if (i < 0) i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error(name + ' not found'); return src.slice(i, src.indexOf('\n}', i) + 2); };
const line = (src, head) => { const i = src.indexOf(head); if (i < 0) throw new Error(head + ' not found'); return src.slice(i, src.indexOf('\n', i)) + '\n'; };
const PARTS = [cut(FG, 'fgLiteOn'), cut(FG, 'fgiLoad'), cut(FQ, 'flowFgEnsure'), cut(FQ, 'flowFgBadge'), cut(FQ, 'flowFgBadgeLoad'), cut(FQ, 'flowFgBadgeLite'),
  'let FLOW_FG_LOADING = null;\n', line(FQ, 'const flowFgToAccept ='), line(FQ, 'const flowFgLines ='), line(FQ, 'const flowMayFg =')].join('\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (d ? ' — ' + d : '')); } };
const tick = (n = 12) => new Promise(r => { let i = 0; const f = () => (++i >= n ? r() : setImmediate(f)); setImmediate(f); });

/* planned lines: A (3 to accept), B (0: all in India stock), C (outsourced), D (make-to-order), E (4 to accept), F (not planned) */
const ROWS = [{ k: 'A', made: 5, india: 2 }, { k: 'B', made: 4, india: 4 }, { k: 'C', made: 9, india: 0, route: 'outsource' }, { k: 'D', made: 9, india: 0, mto: 1 }, { k: 'E', made: 6, india: 2 }, { k: 'F', made: 7, india: 0, noplan: 1 }]
  .map(o => ({ r: { orderNo: o.k, mto: o.mto }, s: { key: o.k, plan: !o.noplan, route: o.route || '', made: o.made, india: o.india } }));
const TODAY = 2; // lines A and E

async function open(o) {
  o = o || {};
  const LS = new Map(Object.entries(o.ls || {})), calls = [], reads = [], els = {};
  const localStorage = { getItem: k => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: k => { LS.delete(k); } };
  const mk = () => { const h = new Set(['hide']); return { textContent: '', classList: { add: c => h.add(c), remove: c => h.delete(c), toggle: (c, on) => (on ? h.add(c) : h.delete(c)), has: c => h.has(c) } }; };
  const $ = id => els[id] || (els[id] = mk());
  const ctx = {
    localStorage, $, AUDIT: { on: !o.harness }, spIsVendor: () => !!o.vendor, FLOW_ON: true, ME: { admin: true, tabs: ['fgi'] },
    FLOW: { ppc: o.loaded ? {} : null }, QC: { checks: o.loaded ? [] : null }, PTG_ALL: 'ALL',
    flowRows: () => ROWS, flowIsMto: r => !!r.mto,
    flowEnsureData: async () => { calls.push('flowEnsureData'); ['pt_vendorOrders', 'pt_ppc', 'pt_storeLedger'].forEach(n => reads.push(n)); ctx.FLOW.ppc = {}; ctx.QC.checks = []; },
    ptNeed: async () => { calls.push('ptNeed'); }, ptGet: async n => { reads.push(n); return null; }, ptList: () => [], ptStamp: () => 't',
    renderFgi() {}, fbaBadge() {}, lstLoad: async () => {}, fgiCorrLoad: async () => {}, fnLoad: async () => {}, fgiOverBadge() {}, lstMaybeRefresh() {},
    FGI: { rows: null, set: {}, recips: null, err: '', busy: false, at: '' }, FGI_PICK: null,
  };
  const body = PARTS + '\nreturn { fgLiteOn, fgiLoad, flowFgBadge, flowFgBadgeLite, flowFgEnsure };';
  const names = Object.keys(ctx);
  const api = new Function(...names, body)(...names.map(k => ctx[k]));
  await api.fgiLoad(); await tick();
  const b = $('flFgBadge');
  return Object.assign(api, { calls, reads, ctx, LS, badge: () => ({ text: b.textContent, hidden: b.classList.has('hide') }) });
}
const flowRead = r => r.reads.some(n => /vendorOrders|ppc|storeLedger/.test(n)) || r.calls.includes('flowEnsureData');

(async () => {
  console.log('== switch order ==');
  let W = await open({ ls: { fgLite: '0', fgFlagLast: '1' } }); ok("'0' beats the flag", W.fgLiteOn() === false);
  W = await open({ ls: { fgLite: '1' } }); ok("'1' is on", W.fgLiteOn() === true);
  W = await open({ ls: { fgFlagLast: '1' } }); ok('the flag decides when nothing is set', W.fgLiteOn() === true);
  W = await open({}); ok('off by default', W.fgLiteOn() === false);
  W = await open({ ls: { fgLite: '1' }, vendor: true }); ok('never for a vendor', W.fgLiteOn() === false);
  W = await open({ ls: { fgLite: '1' }, harness: true }); ok('never for a harness', W.fgLiteOn() === false);

  console.log('== switch OFF: today\'s calls ==');
  W = await open({}); ok('the whole flow is read on open', W.calls.includes('flowEnsureData'));
  ok('the badge shows today\'s number', W.badge().text === String(TODAY) && !W.badge().hidden, JSON.stringify(W.badge()));

  console.log('== switch ON: nothing of the flow is read on open ==');
  W = await open({ ls: { fgLite: '1' } });
  ok('flowEnsureData is not called', !W.calls.includes('flowEnsureData'), W.calls.join());
  ok('no flow node is read', !flowRead(W), W.reads.join());
  ok('the ledger is still read', W.reads.includes('pt_fgiLedger'));
  ok('the badge shows "…" while the flow is not in memory', W.badge().text === '…' && !W.badge().hidden, JSON.stringify(W.badge()));

  console.log('== switch ON, flow already in memory: the same number as today ==');
  W = await open({ ls: { fgLite: '1' }, loaded: true });
  ok('number equals today\'s', W.badge().text === String(TODAY) && !W.badge().hidden, JSON.stringify(W.badge()));
  ok('still nothing read from the flow', !flowRead(W));

  console.log('== switch ON, opening "From QC" loads the flow first, then the same number ==');
  W = await open({ ls: { fgLite: '1' } });
  await W.flowFgEnsure(); W.flowFgBadge();
  ok('flowEnsureData ran for the From QC view', W.calls.includes('flowEnsureData'));
  ok('number equals today\'s', W.badge().text === String(TODAY), JSON.stringify(W.badge()));

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
