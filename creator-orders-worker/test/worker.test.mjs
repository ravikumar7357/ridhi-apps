/* The creator-orders Worker, tested with no internet and no accounts:  node creator-orders-worker/test/worker.test.mjs
 * Google's token door and Firestore are played by a fake fetch holding the documents in memory; a real RSA key is made
 * here so the service-account signing is really done. Every log line is caught, so the test can prove no address,
 * phone or email is ever written to it. */
import { handle, cleanOrder, fsValue, resetToken } from '../src/worker.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

/* ---- a service account with a real key ---- */
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', kp.privateKey)).toString('base64');
const PEM = '-----BEGIN PRIVATE KEY-----\n' + pkcs8.match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
const SECRET = 'test-secret-0123456789-abcdefgh';
const env = { CREATOR_SETU_SECRET: SECRET, FIREBASE_PROJECT_ID: 'demo-proj',
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'erp-writer@demo-proj.iam.gserviceaccount.com', private_key: PEM }),
  ERP_ORDER_URL: 'https://fabricrush-replenish.web.app/#creators?ref=' };

/* ---- Google + Firestore, in memory ---- */
const DOCS = new Map(); let tokenCalls = 0, fsCalls = 0, sawJwt = '';
async function fakeFetch(url, opt) {
  url = String(url);
  if (url === 'https://oauth2.googleapis.com/token') {
    tokenCalls++;
    const p = new URLSearchParams(opt.body); sawJwt = p.get('assertion') || '';
    const [h, b, s] = sawJwt.split('.');
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', kp.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(h + '.' + b));
    return new Response(JSON.stringify(valid ? { access_token: 'ya29.fake', expires_in: 3600 } : { error: 'invalid_grant' }), { status: valid ? 200 : 400 });
  }
  const m = /^https:\/\/firestore\.googleapis\.com\/v1\/projects\/demo-proj\/databases\/\(default\)\/documents\/creatorOrders\?documentId=(.+)$/.exec(url);
  if (m) {
    fsCalls++;
    if ((opt.headers || {}).authorization !== 'Bearer ya29.fake') return new Response('{}', { status: 401 });
    const id = decodeURIComponent(m[1]);
    if (DOCS.has(id)) return new Response(JSON.stringify({ error: { status: 'ALREADY_EXISTS' } }), { status: 409 });
    DOCS.set(id, JSON.parse(opt.body).fields);
    return new Response(JSON.stringify({ name: id }), { status: 200 });
  }
  return new Response('not faked: ' + url, { status: 599 });
}
const LOG = []; const realLog = console.log;
console.log = (...a) => { LOG.push(a.join(' ')); };
const post = (body, key, path) => handle(new Request('https://creator-orders.test' + (path || '/creator-orders'), {
  method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, key === null ? {} : { authorization: 'Bearer ' + (key || SECRET) }),
  body: typeof body === 'string' ? body : JSON.stringify(body) }), env, { fetch: fakeFetch });
const sample = (over = {}) => Object.assign({
  reference: 'CGE-12AB34CD', brand: 'ridhi', campaign: 'Fall Tablescapes 2026',
  creator: { name: 'Jane Doe', instagram: '@janedoe', email: 'jane@example.com' },
  shipTo: { name: 'Jane Doe', line1: '12 Pine St', line2: null, city: 'Portland', state: 'OR', zip: '97205', country: 'US', phone: '5035550100' },
  lines: [{ sku: 'RTC130-6060', asin: 'B0XXXXXXX', title: 'Tablecloth', color: 'Ruby Red', size: '60" x 60"', quantity: 1, priceUsd: 40 }],
  approvedAt: '2026-11-16T10:00:00Z', note: 'Approved by the gift rules',
}, over);

/* ---- a good key → 200, saved with the right shape ---- */
let r = await post(sample()), d = await r.json();
ok(r.status === 200 && d.ok === true, 'good key → 200');
ok(d.reference === 'CGE-12AB34CD' && d.url === 'https://fabricrush-replenish.web.app/#creators?ref=CGE-12AB34CD', 'reply has the reference and the ERP link');
ok(!d.already, 'first send is not "already"');
ok(DOCS.size === 1 && DOCS.has('CGE-12AB34CD'), 'one document, id = reference');
const f = DOCS.get('CGE-12AB34CD');
ok(f.status.stringValue === 'New' && f.source.stringValue === 'creator-setu', 'saved as New, source creator-setu');
ok(f.brand.stringValue === 'ridhi' && f.shipTo.mapValue.fields.zip.stringValue === '97205', 'brand and address kept');
ok(f.lines.arrayValue.values[0].mapValue.fields.quantity.integerValue === '1', 'quantity is a whole number in Firestore');
ok(f.creator.mapValue.fields.instagram.stringValue === 'janedoe', 'the @ is taken off the handle');
ok(!!f.createdAt.stringValue && f.approvedAt.stringValue === '2026-11-16T10:00:00.000Z', 'createdAt set, approvedAt kept');
ok(f.notes.stringValue === 'Creator Setu: Approved by the gift rules', 'the note goes into notes');
ok(sawJwt.split('.').length === 3 && tokenCalls === 1, 'the service account signed one token');

/* ---- the same body twice → still one order, never overwritten ---- */
r = await post(sample({ campaign: 'CHANGED' })); d = await r.json();
ok(r.status === 200 && d.ok && d.already === true, 'second send → 200, already');
ok(DOCS.size === 1 && DOCS.get('CGE-12AB34CD').campaign.stringValue === 'Fall Tablescapes 2026', 'still one order, not overwritten');
ok(tokenCalls === 1, 'the token is reused, not signed again');

/* ---- a bad key → 401, nothing saved ---- */
const before = fsCalls;
r = await post(sample({ reference: 'CGE-OTHER01' }), 'wrong-secret-0123456789-abcdefg'); d = await r.json();
ok(r.status === 401 && d.ok === false, 'bad key → 401');
r = await post(sample({ reference: 'CGE-OTHER01' }), null);
ok(r.status === 401, 'no key → 401');
r = await post(sample({ reference: 'CGE-OTHER01' }), SECRET.slice(0, -1) + 'X');
ok(r.status === 401, 'key one letter off → 401');
ok(fsCalls === before && !DOCS.has('CGE-OTHER01'), 'nothing saved without the key');
const shortEnv = Object.assign({}, env, { CREATOR_SETU_SECRET: 'short' });
r = await handle(new Request('https://x/creator-orders', { method: 'POST', headers: { authorization: 'Bearer short' }, body: '{}' }), shortEnv, { fetch: fakeFetch });
ok(r.status === 401, 'a secret under 24 characters opens nothing');

/* ---- a missing field → 400, in plain words ---- */
const noZip = sample({ reference: 'CGE-NOZIP01' }); delete noZip.shipTo.zip;
r = await post(noZip); d = await r.json();
ok(r.status === 400 && d.ok === false && d.error === 'zip is missing', 'missing zip → 400 "zip is missing"');
ok(!DOCS.has('CGE-NOZIP01'), 'nothing saved for a 400');
r = await post(sample({ reference: '' })); d = await r.json();
ok(r.status === 400 && d.error === 'reference is missing', 'missing reference → 400');
r = await post(sample({ reference: 'CGE-1', brand: 'amazon' })); d = await r.json();
ok(r.status === 400 && /brand/.test(d.error), 'unknown brand → 400');
r = await post(sample({ reference: 'CGE-1', lines: [] })); d = await r.json();
ok(r.status === 400 && /lines/.test(d.error), 'no lines → 400');
r = await post(sample({ reference: 'CGE-1', lines: [{ sku: 'X', quantity: 0 }] })); d = await r.json();
ok(r.status === 400 && /quantity/.test(d.error), 'quantity 0 → 400');
r = await post(sample({ reference: 'CGE-1', lines: [{ quantity: 1 }] })); d = await r.json();
ok(r.status === 400 && /sku is missing/.test(d.error), 'line without sku → 400');
r = await post(sample({ reference: 'ERP-CC-0001' })); d = await r.json();
ok(r.status === 400 && /ERP-CC/.test(d.error), 'ERP-CC- references stay the team\'s');
r = await post(sample({ reference: 'a/b' })); d = await r.json();
ok(r.status === 400, 'a / in the reference → 400 (it would be a path)');
r = await post('not json'); d = await r.json();
ok(r.status === 400 && /JSON/.test(d.error), 'not JSON → 400');
const badState = sample({ reference: 'CGE-1' }); badState.shipTo.state = 'Oregon';
r = await post(badState); d = await r.json();
ok(r.status === 400 && /state/.test(d.error), 'US state must be two letters');

/* ---- other doors ---- */
r = await handle(new Request('https://x/health'), env, { fetch: fakeFetch }); d = await r.json();
ok(r.status === 200 && d.ok && d.firestore === true && d.key === true, '/health says it is set up, with no data');
r = await handle(new Request('https://x/creator-orders'), env, { fetch: fakeFetch });
ok(r.status === 405, 'GET /creator-orders → 405');
r = await handle(new Request('https://x/other', { method: 'POST' }), env, { fetch: fakeFetch });
ok(r.status === 404, 'other path → 404');

/* ---- Firestore down → 503, said plainly ---- */
resetToken();
const downFetch = async (u, o) => (String(u).startsWith('https://firestore') ? new Response('{}', { status: 500 }) : fakeFetch(u, o));
r = await handle(new Request('https://x/creator-orders', { method: 'POST', headers: { authorization: 'Bearer ' + SECRET }, body: JSON.stringify(sample({ reference: 'CGE-DOWN01' })) }), env, { fetch: downFetch });
d = await r.json();
ok(r.status === 503 && d.ok === false, 'Firestore down → 503, not a false 200');

/* ---- what the log holds ---- */
const all = LOG.join('\n');
ok(!/Pine|97205|5035550100|jane@example|Portland/.test(all), 'no address, ZIP, phone, email or city in the log');
ok(/CGE-12AB34CD/.test(all), 'the reference is in the log');

/* ---- small pieces ---- */
ok(JSON.stringify(fsValue({ a: 1, b: 1.5, c: 'x', d: null, e: [true] })) === JSON.stringify({ mapValue: { fields: {
  a: { integerValue: '1' }, b: { doubleValue: 1.5 }, c: { stringValue: 'x' }, d: { nullValue: null }, e: { arrayValue: { values: [{ booleanValue: true }] } } } } }), 'fsValue types');
ok(cleanOrder(sample()).order.shipTo.country === 'US', 'cleanOrder keeps the country');

console.log = realLog;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
