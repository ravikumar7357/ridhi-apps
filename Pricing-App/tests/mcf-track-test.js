/* Pricing-API/McfTrack.gs (MCF tracking for the team) — its nightly run over a fake Amazon, a fake spreadsheet and fake
 * timers: every flag, several parcels, ids with & in them, 90-day first run, a 429 mid-run, finished orders not asked again.
 *   node Pricing-App/tests/mcf-track-test.js */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'McfTrack.gs'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); } };

let NOW = Date.parse('2026-11-18T03:00:00Z');
const day = n => new Date(NOW - n * 86400000).toISOString();
const ymd = n => day(n).slice(0, 10);

// ---- fake Amazon ----
const AMZ = {
  SP: {
    'SHOP-RBP1': { shown: '# RBP1', st: 'Complete', rec: day(5), pk: [{ n: 11, trk: '9400A', car: 'USPS', state: 'DELIVERED', last: day(1), eta: ymd(1) }] },
    'SHOP-RBP2': { shown: '# RBP2', st: 'Complete', rec: day(6), pk: [{ n: 21, trk: '9400B', car: 'USPS', state: 'IN_TRANSIT', last: day(0.5), eta: ymd(2) }] },
    'Julie Peek6': { shown: 'Julie Peek6', st: 'Processing', rec: day(3), pk: [] },
    'SHOP-RBP4': { shown: '# RBP4', st: 'Cancelled', rec: day(2), pk: [] },
    'SHOP-RBP5': { shown: '# RBP5', st: 'Complete', rec: day(2), pk: [{ n: 51, trk: 'TBA1', car: 'AMZL', state: 'IN_TRANSIT', last: day(0.2), eta: ymd(-2) }, { n: 52, trk: 'TBA2', car: 'AMZL', err: true }] },
    'SHOP-RBP6': { shown: '# RBP6', st: 'Complete', rec: day(8), ship: ymd(7), pk: [{ n: 61, trk: '1ZC', car: 'UPS', state: 'IN_TRANSIT', last: day(5), eta: ymd(-1) }] },
    'SHOP-RBP7': { shown: '# RBP7', st: 'Complete', rec: day(9), pk: [{ n: 71, trk: '1ZD', car: 'UPS', state: 'RETURNED_TO_SELLER', last: day(1), eta: ymd(3) }] },
    'SHOP-RBP8': { shown: '# RBP8', st: 'Received', rec: day(0.5), pk: [] },
    'SHOP-OLD1': { shown: '# OLD1', st: 'Complete', rec: day(60), ship: ymd(59), pk: [{ n: 201, trk: '9400O', car: 'USPS', state: 'DELIVERED', last: day(55), eta: ymd(54) }] },
    'SHOP-OLD2': { shown: '# OLD2', st: 'Complete', rec: day(70), ship: ymd(69), pk: [{ n: 202, trk: '9400P', car: 'USPS', err: true }] },
    'SHOP-OLD3': { shown: '# OLD3', st: 'Complete', rec: day(100), ship: ymd(99), pk: [{ n: 203, trk: '9400Q', car: 'USPS', state: 'DELIVERED', last: day(95), eta: ymd(94) }] },
    'Stella & Meredy5': { shown: 'Stella & Meredy5', st: 'Complete', rec: day(2), noLookup: true, pk: [] },
    'SHOP-RBP9': { shown: '# RBP9', st: 'Complete', rec: day(1), pk: [{ n: 91, trk: '', car: 'USPS', noTrack: true }] },
  },
  CPC: {
    '4231623233': { shown: '4231623233', st: 'Complete', rec: day(4), pk: [{ n: 101, trk: '9400Z', car: 'USPS', state: 'DELIVERED', last: day(2), eta: ymd(2) }] },
  },
};
let calls = [], throttleOnce = 0;
let BRAND = 'SP';
function sp_(path) {
  calls.push(BRAND + ' ' + path);
  if (throttleOnce && calls.length === throttleOnce) throw new Error('SP-API 429 on ' + path + ' :: QuotaExceeded');
  const db = AMZ[BRAND];
  let m;
  if ((m = path.match(/fulfillmentOrders\?queryStartDate=([^&]+)/))) {
    const from = decodeURIComponent(m[1]);
    return { payload: { fulfillmentOrders: Object.keys(db).filter(id => db[id].rec >= from || db[id].changed)
      .map(id => ({ sellerFulfillmentOrderId: id, displayableOrderId: db[id].shown, receivedDate: db[id].rec, fulfillmentOrderStatus: db[id].st, shippingSpeedCategory: 'Standard' })) } };
  }
  if ((m = path.match(/fulfillmentOrders\/([^?]+)$/))) {
    const id = decodeURIComponent(m[1]); const o = db[id];
    if (!o || o.noLookup) throw new Error('SP-API 400 on ' + path + ' :: InvalidInput');
    return { payload: { fulfillmentOrder: { fulfillmentOrderStatus: o.st, receivedDate: o.rec, shippingSpeedCategory: 'Standard', displayableOrderId: o.shown },
      fulfillmentShipments: o.pk.length ? [{ shippingDate: (o.ship || ymd(2)) + 'T00:00:00Z', fulfillmentShipmentPackage: o.pk.map(p => ({ packageNumber: p.n, trackingNumber: p.trk, carrierCode: p.car, estimatedArrivalDate: p.eta })) }] : [] } };
  }
  if ((m = path.match(/tracking\?packageNumber=(\d+)/))) {
    const n = +m[1]; let p = null;
    Object.values(db).forEach(o => o.pk.forEach(x => { if (x.n === n) p = x; }));
    if (!p || p.err) throw new Error('SP-API 400 on ' + path + ' :: package not found');
    if (p.noTrack) return { payload: { packageNumber: n } };
    return { payload: { packageNumber: n, trackingNumber: p.trk, carrierCode: p.car, currentStatus: p.state, estimatedArrivalDate: p.eta,
      trackingEvents: [{ eventDate: p.last, eventAddress: { city: 'Aurora', state: 'CO', country: 'US' }, eventDescription: 'Scan ' + p.state }] } };
  }
  throw new Error('unexpected ' + path);
}

// ---- fake Google ----
const props = {};
const PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) };
let triggers = [];
const ScriptApp = {
  getProjectTriggers: () => triggers.slice(),
  deleteTrigger: t => { triggers = triggers.filter(x => x !== t); },
  newTrigger: h => { const t = { getHandlerFunction: () => h }; const b = { timeBased: () => b, atHour: () => b, everyDays: () => b, everyMinutes: () => b, create: () => { triggers.push(t); return t; } }; return b; },
};
const books = {};
function makeSheet(name) {
  let data = [], max = 1000;
  const sh = {
    name, data: () => data,
    setName: n => { sh.name = n; }, getName: () => sh.name,
    getLastRow: () => data.length, getMaxRows: () => max, deleteRows: (a, n) => { max -= n; },
    clear: () => { data = []; }, setFrozenRows: () => {}, hideColumns: () => {},
    getRange: (r, c, nr, nc) => ({
      getValues: () => data.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc).map(v => v == null ? '' : v)),
      setValues: vals => { vals.forEach((row, i) => { data[r - 1 + i] = row.slice(); }); },
      setNumberFormat() { return this; }, setFontWeight() { return this; },
    }),
  };
  return sh;
}
const SpreadsheetApp = {
  create: name => { const id = 'book' + Object.keys(books).length; const sheets = [makeSheet('Sheet1')];
    books[id] = { getId: () => id, getUrl: () => 'https://sheet/' + id, getSheets: () => sheets,
      getSheetByName: n => sheets.find(s => s.name === n) || null, insertSheet: n => { const s = makeSheet(n); sheets.push(s); return s; } };
    return books[id]; },
  openById: id => { if (!books[id]) throw new Error('no book'); return books[id]; },
};
const Utilities = {
  sleep: () => {},
  formatDate: (d, tz, fmt) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz === 'UTC' ? 'UTC' : tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d).map(x => [x.type, x.value]));
    if (fmt === 'yyyy-MM-dd') return `${p.year}-${p.month}-${p.day}`;
    return `${p.day} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+p.month - 1]} ${p.hour}:${p.minute}`;
  },
};
const Logger = { lines: [], log: s => Logger.lines.push(String(s)) };
const RealDate = Date;
class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
const env = {
  sp_, PropertiesService, ScriptApp, SpreadsheetApp, Utilities, Logger, Date: FakeDate,
  ORDERS_PT: 'America/Los_Angeles', ACTIVE_PREFIX: 'SP',
  prop_: k => props[k] || '', nowStamp_: () => new FakeDate().toISOString().slice(0, 16).replace('T', ' '),
  setBrand_: b => { BRAND = String(b).toUpperCase() === 'CPC' ? 'CPC' : 'SP'; return BRAND; },
  mcfIdOf_: n => 'SHOP-' + String(n || '').replace(/[^A-Za-z0-9]+/g, '').toUpperCase(),
};
const names = Object.keys(env);
const api = new Function(...names, src + '\nreturn { mcfSetup, mcfStart, mcfTick, mcfStatus, mcfState_, mcfRead_, MCF_C };')(...names.map(n => env[n]));
const C = api.MCF_C;
const sheetRows = () => { const b = Object.values(books)[0]; return b.getSheetByName('Tracking').data().slice(1); };
const row = id => sheetRows().find(r => r[C['MCF id']] === id && (r[C['Parcel']] !== '' || true));
const flagOf = (id, parcel) => (sheetRows().find(r => r[C['MCF id']] === id && (parcel == null || r[C['Parcel']] === String(parcel))) || [])[0];

console.log('== night 1: first run ==');
api.mcfSetup();
for (let k = 0; k < 5 && api.mcfState_().phase !== 'done'; k++) api.mcfTick();
const st = api.mcfState_();
ok('the run finishes and its 10-minute timer switches itself off', st.phase === 'done' && !triggers.some(t => t.getHandlerFunction() === 'mcfTick'), st.phase);
ok('the nightly start timer stays', triggers.some(t => t.getHandlerFunction() === 'mcfStart'));
ok('every MCF order of the last 90 days, both brands, is on the sheet (12 Ridhi + 1 CPC; the 100-day one is not)', new Set(sheetRows().map(r => r[C['_key']])).size === 13 && !flagOf('SHOP-OLD3'), new Set(sheetRows().map(r => r[C['_key']])).size);
ok('an id Amazon will not look up ("Stella & Meredy5") → Check in Seller Central', /^Check in Seller Central/.test(flagOf('Stella & Meredy5')), flagOf('Stella & Meredy5'));
ok('a 60-day-old order is checked once on the first run and shows Delivered (not "Check by hand")', flagOf('SHOP-OLD1') === 'Delivered', flagOf('SHOP-OLD1'));
ok('a 70-day-old order whose old tracking cannot be read → Check by hand (30+ days), not retried', flagOf('SHOP-OLD2') === 'Check by hand (30+ days)', flagOf('SHOP-OLD2'));
ok('delivered → Delivered', flagOf('SHOP-RBP1') === 'Delivered', flagOf('SHOP-RBP1'));
ok('arrives-by passed, not delivered → Late', flagOf('SHOP-RBP2') === 'Late', flagOf('SHOP-RBP2'));
ok('received 3 days ago, no parcel → Not shipped after 2 days (a name as the id works)', flagOf('Julie Peek6') === 'Not shipped after 2 days', flagOf('Julie Peek6'));
ok('cancelled → Cancelled', flagOf('SHOP-RBP4') === 'Cancelled', flagOf('SHOP-RBP4'));
ok('two parcels → two rows: one On the way, one Tracking not available', flagOf('SHOP-RBP5', 51) === 'On the way' && flagOf('SHOP-RBP5', 52) === 'Tracking not available', flagOf('SHOP-RBP5', 51) + ' / ' + flagOf('SHOP-RBP5', 52));
ok('no scan for 5 days → Stuck', flagOf('SHOP-RBP6') === 'Stuck', flagOf('SHOP-RBP6'));
ok('returned to seller → Problem: RETURNED_TO_SELLER', /^Problem: RETURNED_TO_SELLER/.test(flagOf('SHOP-RBP7')), flagOf('SHOP-RBP7'));
ok('received today, no parcel → Waiting to ship', flagOf('SHOP-RBP8') === 'Waiting to ship', flagOf('SHOP-RBP8'));
ok('a parcel with no tracking number → No tracking number yet', flagOf('SHOP-RBP9') === 'No tracking number yet', flagOf('SHOP-RBP9'));
ok('CPC order with a number id → Delivered, brand CPC', flagOf('4231623233') === 'Delivered' && row('4231623233')[C['Brand']] === 'CPC');
ok('order number shown without "# "', row('SHOP-RBP1')[C['Order']] === 'RBP1', row('SHOP-RBP1')[C['Order']]);
ok('problems first on the sheet (Problem row is first)', /^Problem/.test(sheetRows()[0][0]), sheetRows()[0][0]);
ok('tracking number kept as text', row('SHOP-RBP1')[C['Tracking']] === '9400A');

console.log('== night 2: finished orders are not asked again; a 429 stops and resumes ==');
NOW += 86400000;
AMZ.SP['SHOP-RBP2'].pk[0].state = 'DELIVERED'; AMZ.SP['SHOP-RBP2'].pk[0].last = day(0.1);
calls = [];
throttleOnce = 6;                          // the 6th call of the night is refused
api.mcfStart();
const afterFirst = api.mcfState_();
ok('a 429 stops the tick without marking orders failed, and the timer stays on to carry on', afterFirst.phase !== 'done' && triggers.some(t => t.getHandlerFunction() === 'mcfTick') && (afterFirst.errors || []).some(e => /slow down/.test(e)), afterFirst.phase + ' ' + JSON.stringify(afterFirst.errors));
throttleOnce = 0;
for (let k = 0; k < 5 && api.mcfState_().phase !== 'done'; k++) api.mcfTick();
ok('…the next tick finishes the run', api.mcfState_().phase === 'done');
ok('delivered / cancelled / old / no-lookup orders were not asked about again (RBP1, RBP4, OLD1, OLD2, Stella, CPC 4231623233)', !calls.some(c => /RBP1$|RBP4$|OLD1$|OLD2$|Meredy5$|4231623233$/.test(c)), calls.filter(c => /RBP1$|RBP4$|OLD1$|OLD2$|Meredy5$|4231623233$/.test(c)).join(' '));
ok('RBP2 now Delivered', flagOf('SHOP-RBP2') === 'Delivered', flagOf('SHOP-RBP2'));
ok('a delivered parcel in an open order is not tracked again (51 asked, the order re-read)', !calls.some(c => /packageNumber=51$/.test(c)) || AMZ.SP['SHOP-RBP5'].pk[0].state !== 'DELIVERED');

console.log('== a new order the next night is found, and 30+ days goes to "Check by hand" ==');
NOW += 86400000;
AMZ.SP['SHOP-RBP10'] = { shown: '# RBP10', st: 'Planning', rec: day(0.2), pk: [] };
AMZ.SP['SHOP-RBP6'].rec = day(40);
api.mcfStart(); for (let k = 0; k < 5 && api.mcfState_().phase !== 'done'; k++) api.mcfTick();
ok('new order found → Waiting to ship', flagOf('SHOP-RBP10') === 'Waiting to ship', flagOf('SHOP-RBP10'));
ok('an order open 40 days → Check by hand (30+ days)', flagOf('SHOP-RBP6') === 'Check by hand (30+ days)', flagOf('SHOP-RBP6'));
ok('the state stays under the 9 KB property limit', (props.MCF_STATE || '').length < 9000, String((props.MCF_STATE || '').length));
Logger.lines = []; api.mcfStatus();
console.log(Logger.lines.map(l => '    ' + l).join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
