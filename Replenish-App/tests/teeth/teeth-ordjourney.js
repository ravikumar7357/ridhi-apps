const fs = require('fs'), cp = require('child_process'), pathm = require('path');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8'); const NL = String.fromCharCode(10);
const breaks = [
  /* THE WHOLE POINT: a vendor's pieces are dealt ONCE. */
  ['what a vendor holds is dealt out once, not shown whole on every order',
   '        c.left -= take; c.backLeft -= back; need -= take;',
   '        c.backLeft -= back; need -= take;'],
  ['…and what came back is dealt once too',
   '        c.left -= take; c.backLeft -= back; need -= take;',
   '        c.left -= take; need -= take;'],
  ['oldest order first',
   '    const open = rows.filter(r => r.open).sort((a, b) => when(a) - when(b));',
   '    const open = rows.filter(r => r.open).sort((a, b) => when(b) - when(a));'],
  ['open orders before finished ones',
   '    open.concat(shut).forEach(r => {',
   '    rows.slice().sort((a, b) => when(a) - when(b)).forEach(r => {'],
  ['a cancelled vendor order holds nothing',
   "    if (!o || o.status === 'Cancelled') return;" + NL + '    voLines(o).forEach(l => {' + NL + "      if (!l || l.cancelled || voKind(l) !== 'cut' || l.shopKey || l.shopOrderNo) return;",
   '    if (!o) return;' + NL + '    voLines(o).forEach(l => {' + NL + "      if (!l || l.cancelled || voKind(l) !== 'cut' || l.shopKey || l.shopOrderNo) return;"],
  ['…nor a cancelled line',
   "      if (!l || l.cancelled || voKind(l) !== 'cut' || l.shopKey || l.shopOrderNo) return;",
   "      if (!l || voKind(l) !== 'cut' || l.shopKey || l.shopOrderNo) return;"],
  ['…and a line put on from the console is not counted twice',
   "      if (!l || l.cancelled || voKind(l) !== 'cut' || l.shopKey || l.shopOrderNo) return;",
   "      if (!l || l.cancelled || voKind(l) !== 'cut') return;"],
  ['only an ACCEPTED delivery is back',
   '      const back = voDels(l).reduce((t, d) => { const ok = vlOk(d); return t + (ok ? (parseFloat(ok.qty) || 0) : 0); }, 0);',
   '      const back = voDels(l).reduce((t, d) => t + (parseFloat(d.qty) || 0), 0);'],
  ['a share is marked as shared',
   '        parts, shared: rows.length > 1 });',
   '        parts, shared: false });'],
  ['each share carries the promised date',
   "        due: voDayOf(l.vendorDate) || voDayOf(l.deliveryDate) || '' });",
   "        due: '' });"],
  ['the Printing cell reads the vendor orders',
   '            : \'<span class="muted">not given to a vendor</span>\'))(ordVendorOf(r.orderNo, r.sku))}</td>`',
   '            : \'<span class="muted">not given to a vendor</span>\'))(null)}</td>`'],
  ['…and says how much of the line nobody has given out',
   "              + (v.given < r.qty ? ` <span class=\"muted\">· ${nf(r.qty - v.given)} not given</span>` : '')",
   ''],
  ['a line whose cloth is at the printer is waiting on the vendor',
   "  if (vGiven > vBack && (r.cutReq ? r.cut < vGiven : r.received < vGiven)) return 'Vendor — ' + nf(vGiven - vBack) + ' to come back';",
   ''],
  ['a finished line is complete',
   "  if (!r.open) return 'Complete';",
   ''],
  ['the order number opens the order',
   "  if (oj) { e.preventDefault(); return ordJourney(oj.getAttribute('data-ordj')); }",
   ''],
  ['the journey names the vendor order behind a line',
   "      : (x.v ? x.v.parts.map(p => `${esc(p.vpo)} · ${esc(voName(p.vendorCode))}${p.service ? ' · ' + esc(p.service) : ''} · ${nf(p.qty)} given, ${nf(p.back)} back`",
   "      : (x.v ? x.v.parts.map(p => `${esc(voName(p.vendorCode))}`"],
  ['an order that is not in the book opens nothing',
   '  if (!rows.length) return;' + NL + '  const stage = r =>',
   '  const stage = r =>'],
  ['the console reads the vendor orders when it opens',
   '  if (VO.rows === null) { try { await ensureVo(); } catch (e) { VO.rows = VO.rows || []; } }' + NL + '  /* The priority tag',
   '  /* The priority tag'],
];
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor (' + (src.split(from).length - 1) + '): ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'], { cwd: pathm.join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || ''); const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > 1 : false; if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-160)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
