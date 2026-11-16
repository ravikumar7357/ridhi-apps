/* CREATOR ORDERS — the door Creator Setu sends a creator's gift order through, into the ERP (16 Nov 2026).
 *
 *   POST /creator-orders   Authorization: Bearer <CREATOR_SETU_SECRET>   Content-Type: application/json
 *     401 wrong key · 400 a field missing ({ ok:false, error:"zip is missing" }) · 200 { ok, reference, url }
 *   GET  /health           { ok, v, firestore } — no data
 *
 * Saved to Firestore creatorOrders/{reference}, the reference as the document id, created with "must not exist yet":
 * the same order sent twice is one order, and an order already there is never overwritten — the second send is
 * answered exactly like the first. Written with a Google service account (Worker secret FIREBASE_SERVICE_ACCOUNT, the
 * whole JSON key), which the Firestore rules do not govern; that account needs only the role "Cloud Datastore User".
 *
 * KEPT APART FROM MEERA'S ROUTER ON PURPOSE: that Worker promises it holds no key to the ERP's data. This one holds one,
 * for one collection, and does nothing else.
 *
 * NEVER LOGGED: the address, the phone, the email — no body is ever written to the log, only the reference and why.
 */
export const VERSION = 'creator-orders-2026-11-16';
const BRANDS = ['ridhi', 'cotton-print-club'];
const COLLECTION = 'creatorOrders';

const reply = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const bad = error => reply({ ok: false, error }, 400);

/** Same length, same bytes, in time that does not depend on where they differ. */
function sameKey(want, got) {
  want = String(want || ''); got = String(got || '');
  if (want.length < 24 || got.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max || 200));

/**
 * The order as Creator Setu sends it, checked and cut to size. { order } or { error } — the error names the field, in
 * plain words, so the person on the Creator Setu side can fix it.
 */
export function cleanOrder(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'the body is not a JSON object' };
  const reference = str(b.reference, 60);
  if (!reference) return { error: 'reference is missing' };
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,59}$/.test(reference)) return { error: 'reference may hold only letters, numbers, - and _' };
  if (/^ERP-CC-/i.test(reference)) return { error: 'reference ERP-CC-… is kept for orders typed in the ERP' };
  const brand = str(b.brand, 40).toLowerCase();
  if (!BRANDS.includes(brand)) return { error: 'brand must be "ridhi" or "cotton-print-club"' };
  const c = b.creator && typeof b.creator === 'object' ? b.creator : {};
  const s = b.shipTo && typeof b.shipTo === 'object' ? b.shipTo : {};
  const shipTo = {
    name: str(s.name, 80) || str(c.name, 80), line1: str(s.line1, 120), line2: str(s.line2, 120) || null, city: str(s.city, 80),
    state: str(s.state, 40).toUpperCase(), zip: str(s.zip, 20), country: (str(s.country, 2) || '').toUpperCase(), phone: str(s.phone, 30),
  };
  if (!shipTo.name) return { error: 'a name is missing' };
  if (!shipTo.line1) return { error: 'line1 is missing' };
  if (!shipTo.city) return { error: 'city is missing' };
  if (!shipTo.state) return { error: 'state is missing' };
  if (!shipTo.zip) return { error: 'zip is missing' };
  if (!/^[A-Z]{2}$/.test(shipTo.country)) return { error: 'country is missing (two letters, e.g. US)' };
  if (shipTo.country === 'US' && !/^[A-Z]{2}$/.test(shipTo.state)) return { error: 'state must be two letters for the US (e.g. OR)' };
  if (shipTo.country === 'US' && !/^\d{5}(-\d{4})?$/.test(shipTo.zip)) return { error: 'zip must be 5 digits (or 5+4) for the US' };
  const rawLines = Array.isArray(b.lines) ? b.lines : [];
  if (!rawLines.length) return { error: 'lines is missing (at least one line with a sku and a quantity)' };
  if (rawLines.length > 10) return { error: 'at most 10 lines' };
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i] && typeof rawLines[i] === 'object' ? rawLines[i] : {};
    const sku = str(l.sku, 60), quantity = Number(l.quantity);
    if (!sku) return { error: `line ${i + 1}: sku is missing` };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return { error: `line ${i + 1}: quantity must be a whole number from 1 to 20` };
    const price = Number(l.priceUsd);
    lines.push({ sku, asin: str(l.asin, 20), title: str(l.title, 120), color: str(l.color, 60), size: str(l.size, 60), quantity,
      priceUsd: Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : 0 });
  }
  const approvedAt = str(b.approvedAt, 40);
  return { order: {
    reference, brand, campaign: str(b.campaign, 120),
    creator: { name: str(c.name, 80) || shipTo.name, instagram: str(c.instagram, 60).replace(/^@+/, ''), email: str(c.email, 120) },
    shipTo, lines, approvedAt: approvedAt && !isNaN(Date.parse(approvedAt)) ? new Date(Date.parse(approvedAt)).toISOString() : '',
    note: str(b.note, 500),
  } };
}

/* ---------------- Firestore through its REST door, as a service account ---------------- */
/** A JavaScript value as Firestore's typed value. */
export function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fsValue(x)])) } };
  return { stringValue: String(v) };
}
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uText = t => b64u(new TextEncoder().encode(t));
let TOKEN = { key: '', value: '', until: 0 };
/** An access token for Firestore, kept for its hour (less a minute) so most requests sign nothing. */
async function accessToken(env, fetcher, now) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || '{}');
  if (!sa.client_email || !sa.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  if (TOKEN.key === sa.client_email && TOKEN.value && now < TOKEN.until) return TOKEN.value;
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const iat = Math.floor(now / 1000);
  const head = b64uText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64uText(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + body)));
  const r = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + body + '.' + sig });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('Google refused the service account (' + r.status + ')');
  TOKEN = { key: sa.client_email, value: d.access_token, until: now + (Math.max(120, Number(d.expires_in) || 3600) - 60) * 1000 };
  return TOKEN.value;
}
export function resetToken() { TOKEN = { key: '', value: '', until: 0 }; }

/** Create the document if, and only if, it is not there. 'created' | 'exists'. */
async function createOnce(env, fetcher, now, id, data) {
  const project = env.FIREBASE_PROJECT_ID;
  if (!project) throw new Error('FIREBASE_PROJECT_ID is not set');
  const token = await accessToken(env, fetcher, now);
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/${COLLECTION}?documentId=${encodeURIComponent(id)}`;
  const r = await fetcher(url, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ fields: fsValue(data).mapValue.fields }) });
  if (r.status === 409) return 'exists';
  if (!r.ok) throw new Error('Firestore answered ' + r.status);
  return 'created';
}

/** The whole Worker. deps: { fetch, now } — the real ones by default; the tests pass their own. */
export async function handle(req, env, deps = {}) {
  const fetcher = deps.fetch || fetch;
  const now = deps.now ? deps.now() : Date.now();
  const url = new URL(req.url);
  if (url.pathname === '/health' && req.method === 'GET') return reply({ ok: true, v: VERSION, firestore: !!(env.FIREBASE_SERVICE_ACCOUNT && env.FIREBASE_PROJECT_ID), key: String(env.CREATOR_SETU_SECRET || '').length >= 24 }, 200);
  if (url.pathname !== '/creator-orders') return reply({ ok: false, error: 'not found' }, 404);
  if (req.method !== 'POST') return reply({ ok: false, error: 'POST only' }, 405);
  /* 1. The key, before anything is read. Wrong → 401, nothing saved. */
  const auth = req.headers.get('authorization') || '';
  const got = /^Bearer\s+(.+)$/i.exec(auth);
  if (!got || !sameKey(env.CREATOR_SETU_SECRET, got[1].trim())) return reply({ ok: false, error: 'unauthorized' }, 401);
  /* 2. The fields. */
  let body;
  try { body = JSON.parse(await req.text()); } catch (e) { return bad('the body is not JSON'); }
  const c = cleanOrder(body);
  if (c.error) return bad(c.error);
  const o = c.order;
  /* 3. Saved once, under its reference. */
  const at = new Date(now).toISOString();
  const rec = Object.assign({}, o, { status: 'New', source: 'creator-setu', createdAt: at, approvedAt: o.approvedAt || at,
    notes: o.note ? 'Creator Setu: ' + o.note : '', log: [{ at, by: 'Creator Setu', what: 'sent from Creator Setu' }] });
  delete rec.note;
  let result;
  try { result = await createOnce(env, fetcher, now, o.reference, rec); }
  catch (e) {
    console.log('creator-orders: not saved', o.reference, String(e && e.message || e).slice(0, 120));
    return reply({ ok: false, error: 'the ERP could not save it right now — send it again in a minute' }, 503);
  }
  console.log('creator-orders:', result, o.reference);
  /* 4. Where the team opens it. Signing in to the ERP is still needed to see it. */
  const base = String(env.ERP_ORDER_URL || 'https://fabricrush-replenish.web.app/#creators?ref=');
  return reply({ ok: true, reference: o.reference, url: base + encodeURIComponent(o.reference), ...(result === 'exists' ? { already: true } : {}) }, 200);
}

export default { fetch: (req, env) => handle(req, env) };
