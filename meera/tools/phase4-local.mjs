/* PHASE 4, ON THIS COMPUTER ONLY — the offline copy (meera/.preview) served together with Meera's REAL router code, its
 * tables in Node's SQLite with SAMPLE records, so "Meera's learning" can be tried and photographed with no internet,
 * no Cloudflare and no real sign-in.  node meera/tools/phase4-local.mjs  →  http://localhost:8798/?meera=lazy,learn
 * The page's calls to her router go to /__router here; every visitor counts as the admin "local@admin" (?as=staff: staff). */
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../router/src/worker.js';
import { store } from '../router/src/store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRE = path.join(HERE, '..', '.preview');
const PORT = +process.env.PORT || 8798, ORIGIN = `http://localhost:${PORT}`;

const raw = new DatabaseSync(':memory:');
raw.exec(readFileSync(path.join(HERE, '..', 'router', 'schema.sql'), 'utf8'));
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  first: async () => raw.prepare(sql).get(...args) || null,
  all: async () => ({ results: raw.prepare(sql).all(...args) }),
  run: async () => { raw.prepare(sql).run(...args); return { success: true }; },
  _run: () => ({ results: /RETURNING/i.test(sql) ? raw.prepare(sql).all(...args) : (raw.prepare(sql).run(...args), []) }),
});
const DB = { prepare: sql => stmt(sql), batch: async list => list.map(s => s._run()), raw };
const env = { ENABLED: 'true', ALLOWED_ORIGINS: ORIGIN, ADMIN_EMAILS: 'local@admin', LEARN_DAILY: '200', DB };

/* SAMPLE records (made up, already cleaned — as the router keeps them) */
const ago = h => new Date(Date.now() - h * 3600e3).toISOString();
const add = (kind, q, screen, lang, answer = '', note = '', h = 1) => raw.prepare("INSERT INTO learn (created, kind, question, qkey, screen, lang, role, answer, note, status, key) VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?, 'new', '')")
  .run(ago(h), kind, q, q.toLowerCase().replace(/[^\p{L}\p{N}\[\]\s]+/gu, ' ').replace(/\s+/g, ' ').trim(), screen, lang, answer, note);
for (let i = 0; i < 4; i++) add('missed', 'gst bill me hsn code kaise badle', 'so', 'hg', '', '', 2 + i * 7);
for (let i = 0; i < 3; i++) add('unsure', 'packing list print kaise kare', 'pack', 'hg', 'gn-print-popup,in-fg-pack-verify', '', 5 + i * 9);
add('missed', '[NAME] ko [AMOUNT] advance diya, kaha likhu', 'pbase', 'hg', '', '', 30);
add('unsure', 'how do i change the courier for an order', 'shop', 'en', 'or-shop-courier', '', 50);
add('missed', 'रिटर्न आया माल कहाँ चढ़ाएँ', 'fgi', 'hi', '', '', 70);
for (let i = 0; i < 3; i++) add('spelling', 'kariger ko maaal kaise de', 'pbase', 'hg', 'pr-jw-issue', '', 3 + i);
add('spelling', 'pakking list kaha hai', 'pack', 'hg', 'in-fg-pack-verify', '', 12);
add('down', 'qc pass kaise kare', 'qc', 'hg', 'pr-qc-pass', 'mujhe aadhe pieces pass karne the', 6);
add('down', 'order [ORDER] kahan hai', 'shop', 'hg', 'gn-written-guide', '', 20);
raw.prepare("INSERT INTO tickets (created, uid, email, screen, question, why, status) VALUES (?, '', '', 'fab', 'fabric return to vendor kaise kare', 'no-answer', 'open')").run(ago(26));

/* the page: the offline copy, its calls to her router sent here, and a signed-in person */
const SHIM = `<script>(function(){var f=window.fetch;window.fetch=function(u,o){u=String(u);if(u.indexOf('https://meera-router.')===0)u='/__router'+new URL(u).pathname;return f.call(this,u,o)};
var who=new URLSearchParams(location.search).get('as')==='staff'?'staff':'admin';
var t=setInterval(function(){if(window.ERP_MEERA){clearInterval(t);window.ERP_MEERA.token=function(){return Promise.resolve('local-'+who)};window.ERP_MEERA.signedIn=function(){return true};if(who==='staff'){var k=setInterval(function(){try{ME.admin=false}catch(e){}},200);setTimeout(function(){clearInterval(k)},4000)}}},50);})();</script>`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.bin': 'application/octet-stream', '.woff2': 'font/woff2' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, ORIGIN);
  if (u.pathname.startsWith('/__router/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await handle(new Request('https://router.local' + u.pathname.slice(9) + u.search, { method: req.method, headers: { ...req.headers, origin: ORIGIN }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }),
      env, { store: store(DB), verify: async tok => (tok === 'local-admin' ? { uid: 'local-a', email: 'local@admin', admin: true } : tok === 'local-staff' ? { uid: 'local-s', email: 'local@staff', admin: false } : null) });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(await r.text()); return;
  }
  let f = path.join(PRE, decodeURIComponent(u.pathname));
  if (!f.startsWith(PRE)) { res.writeHead(403); res.end(); return; }
  if (existsSync(f) && statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  let body = readFileSync(f);
  if (f.endsWith('index.html')) body = Buffer.from(SHIM + body.toString('utf8'));
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
}).listen(PORT, () => console.log(`Meera with her local router: ${ORIGIN}/?meera=lazy,learn  (add &as=staff to be staff)`));
