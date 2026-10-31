/* WHAT MEERA TAKES FROM THE ERP (v2 rebuild, Phase 1): every name her files use that the ERP's own files define.
 * These are the doors the bridge (core/meera-bridge.js) must cover.
 *   node meera/tools/app-deps.cjs [--json]
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'Replenish-App', 'src', 'app');
const order = fs.readFileSync(path.join(APP, 'ORDER'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const isMeera = f => /^core\/(guide|meera)|^@meera\//.test(f);
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ')
  .replace(/`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`/g, m => m.replace(/[^${}\w]+/g, ' '))   // keep ${…} code in templates
  .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, ' ');
const defs = code => {
  const out = new Set();
  for (const m of code.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) out.add(m[1] || m[2]);
  for (const m of code.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*\s*=[^;]*?,\s*[A-Za-z_$][\w$]*\s*=)/gm)) for (const n of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)\s*=/g)) out.add(n[1]);
  for (const m of code.matchAll(/^(?:let|var)\s+([A-Za-z_$][\w$]*(?:\s*=\s*[^,;]+)?(?:\s*,\s*[A-Za-z_$][\w$]*(?:\s*=\s*[^,;]+)?)+)\s*;/gm)) for (const n of m[1].matchAll(/(?:^|,)\s*([A-Za-z_$][\w$]*)/g)) out.add(n[1]);
  return out;
};
const appDefs = new Map(), meeraDefs = new Set();
let meeraCode = '';
for (const f of order) {
  const p = f.startsWith('@shared/') ? path.join(ROOT, 'shared', f.slice(8)) : f.startsWith('@meera/') ? path.join(ROOT, 'meera', 'client', 'src', f.slice(7)) : path.join(APP, f);
  if (!fs.existsSync(p)) continue;
  const code = fs.readFileSync(p, 'utf8');
  if (isMeera(f)) { defs(code).forEach(n => meeraDefs.add(n)); meeraCode += '\n' + strip(code); }
  else defs(code).forEach(n => { if (!appDefs.has(n)) appDefs.set(n, f); });
}
const used = new Map();
for (const m of meeraCode.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
  const n = m[2];
  if (appDefs.has(n) && !meeraDefs.has(n)) used.set(n, (used.get(n) || 0) + 1);
}
const list = [...used.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => ({ name: n, uses: c, from: appDefs.get(n) }));
if (process.argv.includes('--json')) console.log(JSON.stringify(list, null, 1));
else list.forEach(x => console.log(String(x.uses).padStart(4), x.name.padEnd(26), x.from));
