/* Pricing-API/CreatorOrders.gs (Content Creators: Creator Setu's orders in, status back out), run in Node with fakes for
 * Apps Script (UrlFetchApp, PropertiesService, ScriptApp) and an in-memory Firestore and Creator Setu.
 *   node Replenish-App/tests/creator-orders-gs-test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'CreatorOrders.gs'), 'utf8');
const CODE = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'Code.gs'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const SECRET = 'k'.repeat(48);
const PROPS = { CREATOR_SETU_SECRET: SECRET };
const DOCS = new Map(), SETU = [], LOG = [];
let setuCode = 200, fsDown = false;
const FS = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body || {})) });
const ctx = {
  console: { log: (...a) => LOG.push(a.join(' ')) },
  Logger: { log: () => {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in PROPS ? PROPS[k] : null) }) },
  ScriptApp: { getOAuthToken: () => 'owner-token', getService: () => ({ getUrl: () => 'https://script.google.com/x/exec' }) },
  UrlFetchApp: { fetch(url, opt = {}) {
    if (url.startsWith('https://creator-growth-engine.netlify.app/api/erp/orders/')) {
      SETU.push({ url, auth: opt.headers.Authorization, body: JSON.parse(opt.payload) }); return resp(setuCode, { ok: setuCode === 200 });
    }
    if (!url.startsWith(FS)) return resp(599, 'not faked');
    if (fsDown) return resp(500, {});
    if (opt.headers.Authorization !== 'Bearer owner-token') return resp(401, {});
    const rest = url.slice(FS.length);
    const create = /^creatorOrders\?documentId=(.+)$/.exec(rest);
    if (create && opt.method === 'post') {
      const id = decodeURIComponent(create[1]);
      if (DOCS.has('creatorOrders/' + id)) return resp(409, {});
      DOCS.set('creatorOrders/' + id, JSON.parse(opt.payload).fields); return resp(200, {});
    }
    const [p, q] = rest.split('?'), key = decodeURIComponent(p);
    if (opt.method === 'patch') {
      if (!DOCS.has(key)) return resp(404, {});
      const field = decodeURIComponent(/updateMask\.fieldPaths=([^&]+)/.exec(q)[1]);
      DOCS.get(key)[field] = JSON.parse(opt.payload).fields[field]; return resp(200, {});
    }
    return DOCS.has(key) ? resp(200, { fields: DOCS.get(key) }) : resp(404, {});
  } },
};
vm.createContext(ctx); vm.runInContext(SRC, ctx);
const run = (fn, ...a) => ctx[fn](...a);
const plain = id => ctx.coPlain_({ mapValue: { fields: DOCS.get('creatorOrders/' + id) } });
const setDoc = (path, obj) => DOCS.set(path, ctx.coValue_(obj).mapValue.fields);
const sample = (over = {}) => Object.assign({ key: SECRET,
  reference: 'CGE-12AB34CD', brand: 'ridhi', campaign: 'Fall Tablescapes 2026',
  creator: { name: 'Jane Doe', instagram: '@janedoe', email: 'jane@example.com' },
  shipTo: { name: 'Jane Doe', line1: '12 Pine St', line2: null, city: 'Portland', state: 'OR', zip: '97205', country: 'US', phone: '5035550100' },
  lines: [{ sku: 'RTC130-6060', asin: 'B0XXXXXXX', title: 'Tablecloth', color: 'Ruby Red', size: '60" x 60"', quantity: 1, priceUsd: 40 }],
  approvedAt: '2026-11-16T10:00:00Z', note: 'Approved by the gift rules' }, over);

console.log('== an order comes in from Creator Setu ==');
let d = run('coOrderIn_', sample());
ok(d.ok === true && d.reference === 'CGE-12AB34CD', 'a good key → ok');
ok(d.url === 'https://fabricrush-replenish.web.app/#creators?ref=CGE-12AB34CD', 'the reply has the ERP link');
ok(!d.already && !('key' in plain('CGE-12AB34CD')), 'saved once — and the key itself is NOT saved on the order');
let o = plain('CGE-12AB34CD');
ok(o.status === 'New' && o.source === 'creator-setu', 'saved as New, source creator-setu');
ok(o.shipTo.zip === '97205' && o.brand === 'ridhi' && o.lines[0].quantity === 1, 'address, brand and line kept');
ok(o.creator.instagram === 'janedoe', 'the @ is taken off the handle');
ok(o.notes === 'Creator Setu: Approved by the gift rules' && o.approvedAt === '2026-11-16T10:00:00.000Z', 'note and approval time kept');

console.log('== the same order twice is one order ==');
d = run('coOrderIn_', sample({ campaign: 'CHANGED' }));
ok(d.ok && d.already === true, 'second send → ok, already');
ok(plain('CGE-12AB34CD').campaign === 'Fall Tablescapes 2026', 'never overwritten');

console.log('== a wrong key ==');
const n0 = DOCS.size;
d = run('coOrderIn_', sample({ reference: 'CGE-OTHER01', key: 'x'.repeat(48) }));
ok(!d.ok && d.code === 401, 'wrong key → 401 in the body');
d = run('coOrderIn_', sample({ reference: 'CGE-OTHER01', key: undefined }));
ok(!d.ok && d.code === 401, 'no key → 401');
PROPS.CREATOR_SETU_SECRET = 'short';
d = run('coOrderIn_', sample({ reference: 'CGE-OTHER01', key: 'short' }));
ok(!d.ok && d.code === 401, 'a secret under 24 characters opens nothing');
delete PROPS.CREATOR_SETU_SECRET;
d = run('coOrderIn_', sample({ reference: 'CGE-OTHER01', key: '' }));
ok(!d.ok && d.code === 401, 'the door is shut until CREATOR_SETU_SECRET is set');
PROPS.CREATOR_SETU_SECRET = SECRET;
ok(DOCS.size === n0, 'nothing saved without the key');

console.log('== a missing field ==');
const noZip = sample({ reference: 'CGE-NOZIP01' }); delete noZip.shipTo.zip;
d = run('coOrderIn_', noZip);
ok(!d.ok && d.code === 400 && d.error === 'zip is missing', 'missing zip → 400 "zip is missing"');
ok(!DOCS.has('creatorOrders/CGE-NOZIP01'), 'nothing saved for a 400');
ok(run('coOrderIn_', sample({ reference: '' })).error === 'reference is missing', 'missing reference');
ok(/brand/.test(run('coOrderIn_', sample({ reference: 'CGE-1', brand: 'amazon' })).error), 'unknown brand');
ok(/lines/.test(run('coOrderIn_', sample({ reference: 'CGE-1', lines: [] })).error), 'no lines');
ok(/quantity/.test(run('coOrderIn_', sample({ reference: 'CGE-1', lines: [{ sku: 'X', quantity: 1.5 }] })).error), 'a part quantity');
ok(/ERP-CC/.test(run('coOrderIn_', sample({ reference: 'ERP-CC-0001' })).error), 'ERP-CC- references stay the team\'s');
ok(run('coOrderIn_', sample({ reference: 'a/b' })).code === 400, 'a / in the reference (it would be a path)');
const st = sample({ reference: 'CGE-1' }); st.shipTo.state = 'Oregon';
ok(/state/.test(run('coOrderIn_', st).error), 'US state must be two letters');

console.log('== Firestore down ==');
fsDown = true;
d = run('coOrderIn_', sample({ reference: 'CGE-DOWN01' }));
ok(!d.ok && d.code === 503, 'Firestore down → 503 in the body, not a false ok');
fsDown = false;

console.log('== the report-back ==');
setDoc('perms/team@x.com', { tabs: ['shop'] });
setDoc('perms/repl@x.com', { repl: true, replTabs: ['shop', 'adj'] });
setDoc('perms/other@x.com', { tabs: ['health'] });
d = run('coReport_', { reference: 'CGE-12AB34CD' }, { email: 'team@x.com' });
ok(d.ok && /nothing to report/.test(d.skipped) && SETU.length === 0, 'a New order is not reported');
setDoc('creatorOrders/CGE-12AB34CD', Object.assign(plain('CGE-12AB34CD'), { status: 'Sent to Amazon',
  amazon: { orderId: 'SHOP-CGE12AB34CD', sentAt: '2026-11-16T12:00:00.000Z', carrier: '', tracking: '' } }));
d = run('coReport_', { reference: 'CGE-12AB34CD', status: 'delivered' }, { email: 'team@x.com' });
ok(d.ok && d.reported === 'sent_to_amazon', 'Sent to Amazon → sent_to_amazon (the status in the request is ignored)');
ok(SETU.length === 1 && SETU[0].url.endsWith('/api/erp/orders/CGE-12AB34CD') && SETU[0].auth === 'Bearer ' + SECRET, 'posted to Creator Setu at the reference, with the key');
ok(SETU[0].body.amazonOrderId === 'SHOP-CGE12AB34CD' && SETU[0].body.at === '2026-11-16T12:00:00.000Z', 'the body Creator Setu asked for');
ok(plain('CGE-12AB34CD').setu.status === 'sent_to_amazon' && plain('CGE-12AB34CD').campaign === 'Fall Tablescapes 2026', 'what was told is on the order; nothing else changed');
d = run('coReport_', { reference: 'CGE-12AB34CD' }, { email: 'team@x.com' });
ok(d.ok && d.already && SETU.length === 1, 'the same status is not told twice');
setDoc('creatorOrders/CGE-12AB34CD', Object.assign(plain('CGE-12AB34CD'), { status: 'Shipped',
  amazon: { orderId: 'SHOP-CGE12AB34CD', sentAt: '2026-11-16T12:00:00.000Z', carrier: 'UPS', tracking: '1Z999', shippedAt: '2026-11-17' } }));
d = run('coReport_', { reference: 'CGE-12AB34CD' }, { email: 'repl@x.com' });
ok(d.ok && d.reported === 'shipped' && SETU[1].body.tracking === '1Z999' && SETU[1].body.carrier === 'UPS', 'Shipped → with carrier and tracking (a Replenishment Shopify account may ask)');
ok(!run('coReport_', { reference: 'CGE-12AB34CD' }, { email: 'other@x.com' }).ok, 'an account without Shopify Orders is refused');
ok(!run('coReport_', { reference: 'CGE-12AB34CD' }, { email: 'nobody@x.com' }).ok, 'an account with no rights is refused');
/* An older Code.gs has no sign-in check and passes no person: served, because what is told comes from Firestore. */
const ns = run('coReport_', { reference: 'CGE-12AB34CD' }, null);
ok(ns.ok && ns.already, 'with no person known (older backend) the ask is served — and still tells nothing twice');
ok(SETU.length === 2, 'none of the refused asks reached Creator Setu');
setDoc('creatorOrders/ERP-CC-0001', { reference: 'ERP-CC-0001', source: 'team', status: 'Delivered' });
d = run('coReport_', { reference: 'ERP-CC-0001' }, { email: 'team@x.com' });
ok(d.ok && /typed in the ERP/.test(d.skipped) && SETU.length === 2, 'a team order is never reported');
ok(/not found/.test(run('coReport_', { reference: 'CGE-NOPE001' }, { email: 'team@x.com' }).error), 'an order that is not there');
setuCode = 404;
setDoc('creatorOrders/CGE-12AB34CD', Object.assign(plain('CGE-12AB34CD'), { status: 'Delivered' }));
d = run('coReport_', { reference: 'CGE-12AB34CD' }, { email: 'ravi@thefabricrush.com' });
ok(!d.ok && /does not know/.test(d.error), 'Creator Setu 404 → said plainly (the owner needs no perms record)');
ok(plain('CGE-12AB34CD').setu.error && plain('CGE-12AB34CD').setu.status === 'shipped', '…the refusal is kept; what Creator Setu knows stays "shipped"');
setuCode = 200;
d = run('coReport_', { reference: 'CGE-12AB34CD' }, { email: 'ravi@thefabricrush.com' });
ok(d.ok && d.reported === 'delivered' && !plain('CGE-12AB34CD').setu.error, 'asked again once Creator Setu knows it → delivered, error cleared');
ok(run('coSetuReport_', { status: 'Problem' }) === null && run('coSetuReport_', { status: 'Cancelled', updAt: '2026-11-18T00:00:00Z' }).status === 'cancelled', 'Problem is not reported; Cancelled is');

console.log('== Code.gs routes ==');
/* Either Code.gs: dev's (WRITE_KEY + sign-in, and a log line) or main's (API_KEY only). */
const iPost = CODE.indexOf('function doPost(');
const iDoor = CODE.indexOf("creator === 'order') return json_(coOrderIn_(p))", iPost);
const iKey = Math.max(CODE.indexOf("var wkey = prop_('WRITE_KEY')", iPost), CODE.indexOf("var key = prop_('API_KEY')", iPost));
const iLog = CODE.indexOf("console.log('POST '", iPost);
ok(iDoor > 0 && iKey > 0 && iDoor < iKey && (iLog < 0 || iDoor < iLog), 'Creator Setu\'s door is answered before the apps\' key check and before anything is logged');
const iRep = CODE.indexOf("p.creator === 'report') return json_(coReport_(p, typeof who === 'undefined' ? null : who))");
ok(iRep > iKey, 'the report goes through the apps\' key check, and works whether or not this Code.gs knows "who"');
ok(/^ {4}"CreatorOrders\.gs",$/m.test(fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', '.clasp.json'), 'utf8')), 'CreatorOrders.gs is in .clasp.json, so clasp pushes it');

console.log('== the log ==');
const all = LOG.join('\n');
ok(!/Pine|97205|5035550100|jane@example|Portland|kkkkkkkk/.test(all), 'no address, ZIP, phone, email, city or key in the log');
ok(/CGE-12AB34CD/.test(all), 'the reference is in the log');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
