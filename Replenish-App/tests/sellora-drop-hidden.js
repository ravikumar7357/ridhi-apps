/* ONE-TIME (Ravi, 2026-10-01: "hidden … hum isko yaha se remove kar sakte h because humne replenish app par le liya h").
 *
 * Sellora's Shopify Orders and Adjustments tabs moved to the Replenish app and have been hidden in Sellora since; their
 * code (src/app/hidden/, 8 files) and the shared blocks only they used (Adjustments, Courier & MCF templates, Imported
 * orders — still joined into the Replenish app) still loaded on every Sellora page. They go; git keeps them.
 *
 * KEPT, because a visible screen uses it: saveStockDoc — Listing Health's and Parent Listing Review's refresh write the
 * Amazon stock to Firestore stock/{brand} through it, and the Replenish app's Shopify screen reads that. It moves to
 * core/stock-doc.js. Navigation's two lines that opened the hidden tabs go too.
 *
 *   node tests/sellora-drop-hidden.js          check only: what would go, and every name it would leave unresolved
 *   node tests/sellora-drop-hidden.js go       do it, then assemble
 */
const fs = require('fs'), path = require('path');
const esbuild = require('esbuild');
const APP = path.join(__dirname, '..', '..', 'Pricing-App', 'src', 'app');
const SHARED = path.join(__dirname, '..', '..', 'shared');
const GO = process.argv[2] === 'go';
const NL = '\r\n';
const orderFile = path.join(APP, 'ORDER');
const orderRaw = fs.readFileSync(orderFile, 'utf8');
const order = orderRaw.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const read = f => fs.readFileSync(f.startsWith('@shared/') ? path.join(SHARED, f.slice(8)) : path.join(APP, f), 'utf8');
const dropped = order.filter(f => f.startsWith('hidden/') || f.startsWith('@shared/'));
const kept = order.filter(f => !dropped.includes(f));

/* the one function a kept screen needs */
const shelf = read('hidden/shelf-position.js');
const sA = shelf.indexOf('async function saveStockDoc(brand, map) {');
const sB = shelf.indexOf(NL + '}' + NL, sA) + (NL + '}' + NL).length;
if (sA < 0 || sB <= sA) throw new Error('saveStockDoc not found where expected');
const stockDoc = '/* ================= AMAZON STOCK, SAVED FOR THE REPLENISH APP =================' + NL
  + ' * Listing Health\'s and Parent Listing Review\'s refresh save the Amazon stock per SKU to Firestore stock/{brand}; the' + NL
  + ' * Replenish app\'s Shopify screen reads it. Kept here when the hidden Shopify Orders code left Sellora (2026-10-01). */' + NL
  + shelf.slice(sA, sB);

/* names declared by what goes (but not the kept function) — none may be used by what stays */
const clean = js => { try { js = esbuild.transformSync(js, { loader: 'js', legalComments: 'none', target: 'esnext' }).code; } catch (e) { /* as is */ }
  return js.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, "''"); };
const DECL = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^class\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([^=;]+)/gm;
const gone = new Set();
dropped.forEach(f => { for (const m of clean(read(f)).matchAll(DECL)) {
  const raw = m[1] || m[2] || m[3] || ''; (raw.match(/[A-Za-z_$][\w$]*/g) || []).slice(0, m[3] ? 50 : 1).forEach(n => gone.add(n)); } });
gone.delete('saveStockDoc');
/* a name the staying code declares itself (e.g. a local of the same name) is its own */
const keptCode = kept.map(f => clean(read(f))).join('\n') + '\n' + clean(stockDoc);
/* only real declarations count (function / class / const / let / var names) — a call argument is a USE, not a declaration */
const keptDecl = new Set(); for (const m of keptCode.matchAll(/(?:function\s*\*?\s+|class\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)/g)) keptDecl.add(m[1]);
const NAV_LINES = ["  if (which === 'shop') ensureShop();" + NL, "  if (which === 'adj') ensureAdj();" + NL];
const navAfter = read('core/nav.js').split(NAV_LINES[0]).join('').split(NAV_LINES[1]).join('');
const keptAfter = kept.map(f => (f === 'core/nav.js' ? clean(navAfter) : clean(read(f)))).join('\n') + '\n' + clean(stockDoc);
const ids = new Map();
for (const m of keptAfter.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?!\s*:)/g)) if (gone.has(m[1]) && !keptDecl.has(m[1])) ids.set(m[1], (ids.get(m[1]) || 0) + 1);
console.log(`goes: ${dropped.length} files (${dropped.join(', ')})`);
console.log(`names they declare: ${gone.size}; still used by what stays: ${ids.size ? [...ids].map(([n, c]) => n + '×' + c).join(', ') : 'none'}`);
if (ids.size) { console.log('NOT done — resolve those first'); process.exit(1); }
if (!GO) { console.log('check only — run with "go"'); return; }

fs.writeFileSync(path.join(APP, 'core', 'stock-doc.js'), stockDoc);
fs.writeFileSync(path.join(APP, 'core', 'nav.js'), navAfter);
const lines = orderRaw.split(/\r?\n/);
const out = [];
lines.forEach(l => { const t = l.trim(); if (dropped.includes(t)) return; out.push(l); if (t === 'core/backend.js') out.push('core/stock-doc.js'); });
fs.writeFileSync(orderFile, out.join(NL).replace(/(\r\n)*$/, '') + NL);
dropped.filter(f => f.startsWith('hidden/')).forEach(f => fs.unlinkSync(path.join(APP, f)));
try { fs.rmdirSync(path.join(APP, 'hidden')); } catch (e) { /* not empty */ }
console.log('done: hidden/ removed, saveStockDoc kept in core/stock-doc.js, ORDER updated');
