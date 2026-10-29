/* Wires meera/tests/ci-gate.cjs into the deploy workflow (29 Oct, Ravi's gate rules). */
const fs = require('fs'), path = require('path');
const f = path.join(__dirname, '..', '..', '.github', 'workflows', 'replenish-hosting.yml');
let s = fs.readFileSync(f, 'utf8');
const from = s.indexOf("      # MEERA'S GATE (v2 rebuild"), to = s.indexOf('      - name: Build the deployed copy (dist/)');
if (from < 0 || to < 0 || !s.slice(from, to).includes('gate.cjs --bundle')) throw new Error('Meera step not found');
s = s.slice(0, from) + `      # MEERA'S GATE (v2 rebuild, 29 Oct 2026): meera/tests/ci-gate.cjs. When this push touches Meera (meera/, her answers,
      # the bridge) or a screen box she points at, it can block the deploy if she got worse, with a plain message saying
      # which check failed and why; any other ERP change only gets a warning, so an urgent fix is never stuck. A meant
      # change: node meera/tests/gate.cjs --accept "why", commit meera/bank/baseline/.
      - name: Meera — never-break list and no-worse gate
        env:
          MEERA_BASE: \${{ github.event.before }}
        run: node ../meera/tests/ci-gate.cjs

` + s.slice(to);
const c = '      - uses: actions/checkout@v4\n';
if (s.split(c).length !== 2) throw new Error('checkout step not found once');
s = s.replace(c, "      - uses: actions/checkout@v4\n        with:\n          fetch-depth: 0   # Meera's gate compares this push with the commit before it\n");
fs.writeFileSync(f, s);
console.log('ok');
