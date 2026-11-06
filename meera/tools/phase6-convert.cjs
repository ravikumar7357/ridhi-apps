/* Phase 6: one of her older files becomes TypeScript — node meera/tools/phase6-convert.cjs guide-tours
 *   1. legacy/<name>.js → legacy/<name>.ts (git mv, so its history follows it)
 *   2. its line in Replenish-App/src/app/ORDER → .ts
 *   3. the type check of all her files together (tsconfig.legacy.json): its notes printed, for fixing by hand
 * Then: fix, rebuild (assemble, meera.js, the router's search), gate, never-break, commit — one file per save. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const name = process.argv[2];
if (!name) throw new Error('which file? e.g. guide-tours');
const L = path.join(ROOT, 'meera', 'client', 'src', 'legacy');
if (fs.existsSync(path.join(L, name + '.js'))) cp.execFileSync('git', ['mv', `meera/client/src/legacy/${name}.js`, `meera/client/src/legacy/${name}.ts`], { cwd: ROOT });
const ORDER = path.join(ROOT, 'Replenish-App', 'src', 'app', 'ORDER');
let o = fs.readFileSync(ORDER, 'utf8');
if (o.includes(`@meera/legacy/${name}.js`)) { o = o.replace(`@meera/legacy/${name}.js`, `@meera/legacy/${name}.ts`); fs.writeFileSync(ORDER, o); }
const TSC = 'C:/AMAZON/Amazon Inventory/Amazon Inventory/fba-forecast/node_modules/typescript/lib/tsc.js';
try { cp.execFileSync(process.execPath, [TSC, '-p', 'meera/client/tsconfig.legacy.json'], { cwd: ROOT, stdio: 'pipe' }); console.log(name + '.ts: type check clean'); }
catch (e) { const out = String(e.stdout || ''); console.log(out.split('\n').filter(Boolean).length + ' notes'); console.log(out.slice(0, 6000)); }
