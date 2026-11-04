/* HER TYPE CHECKS, BLOCKING (v2 rebuild, Phase 6) — run by the deploy gate (ci-gate.cjs) whenever a push touches Meera.
 *   tsconfig.json         her new files, strict
 *   tsconfig.legacy.json  all her files together (her older ones converted under relaxed rules first)
 * Where TypeScript comes from: TSC (a path), else the copy on the office computer, else npx (GitHub). */
const path = require('path'), fs = require('fs'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const LOCAL = 'C:/AMAZON/Amazon Inventory/Amazon Inventory/fba-forecast/node_modules/typescript/lib/tsc.js';
const tsc = process.env.TSC || (fs.existsSync(LOCAL) ? LOCAL : null);
let failed = 0;
for (const cfg of ['meera/client/tsconfig.json', 'meera/client/tsconfig.legacy.json']) {
  const r = tsc ? spawnSync(process.execPath, [tsc, '-p', cfg], { cwd: ROOT, encoding: 'utf8' })
    : spawnSync('npx', ['--yes', '-p', 'typescript@5.9.3', 'tsc', '-p', cfg], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0) { failed++; console.log(`${cfg}: NOT clean\n` + out.split('\n').slice(0, 30).join('\n')); }
  else console.log(`${cfg}: clean`);
}
process.exit(failed ? 1 : 0);
