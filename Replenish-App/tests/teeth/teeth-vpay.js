const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* ---- what is owed, and what is not ---- */
  ['nothing is owed until somebody accepted it',
   '        const ok = vlOk(d);' + NL + '        if (!ok) return;',
   '        const ok = vlOk(d) || { qty: d.qty };' + NL + '        if (!ok) return;'],

  ['the vendor is paid for what was kept, not what was claimed',
   '        const kept = parseFloat(ok.qty) || 0;',
   '        const kept = parseFloat(d.qty) || 0;'],

  ['…and returned pieces are not added back in',
   '        g[key].qty += kept;',
   '        g[key].qty += kept + (parseFloat(ok.rej) || 0);'],

  ['…while what was returned is still shown',
   '        g[key].rej += parseFloat(ok.rej) || 0;',
   '        '],

  ['…and so is what was taken in over the challan',
   '        g[key].over += parseFloat(ok.over) || 0;',
   '        '],

  ['a delivery of nothing is not a line on a bill',
   '        if (kept <= 0) return;',
   '        '],

  /* ---- when ---- */
  ['a delivery is owed in the period it arrived in',
   '        if (!vpayInWindow(d, w)) return;',
   '        '],

  ['…and a day outside the window is outside it',
   "  return k >= w.from.replace(/-/g, '') && k <= w.to.replace(/-/g, '');",
   '  return true;'],

  ['…and a delivery with no readable date is in no period at all',
   '  if (!k) return false;',
   '  if (!k) return true;'],

  /* The cancelled rule was REVERSED by A-3 — a cancelled order still owes what was accepted on it —
   * and both directions of it are broken in teeth-a123.js. */

  /* ---- the rate ---- */
  /* A RATE OF NULL IS NOT A RATE OF ZERO. Zero would say the work is free and quietly add nothing;
   * null says nobody has priced it, which is a thing to go and fix. */
  ['work nobody has priced says so instead of reading as free',
   '      const rate = row ? (parseFloat(row.rate) || 0) : null;',
   '      const rate = row ? (parseFloat(row.rate) || 0) : 0;'],

  ['…and an amount is the rate times what arrived',
   '    .map(x => Object.assign(x, { amount: x.rate == null ? 0 : x.qty * x.rate }))',
   '    .map(x => Object.assign(x, { amount: x.rate == null ? 0 : x.rate }))'],

  /* THE RATE IS PART OF THE KEY. The same cloth in two colours is two prices, and merging them would
   * produce one figure at a rate that priced neither half of it. */
  ['the same cloth at two prices stays two rows',
   "        const key = [o.vendorCode, run ? 'running' : 'cut', what, rate == null ? 'no-rate' : rate].join('|');",
   "        const key = [o.vendorCode, run ? 'running' : 'cut', what].join('|');"],

  ['…and one firm is not merged with another',
   "        const key = [o.vendorCode, run ? 'running' : 'cut', what, rate == null ? 'no-rate' : rate].join('|');",
   "        const key = [run ? 'running' : 'cut', what, rate == null ? 'no-rate' : rate].join('|');"],

  /* ---- the screen ---- */
  ['the screen says nothing on it is settled',
   '      <span class="kpiwhen">live — nothing on this screen is settled</span></div>',
   '      <span class="kpiwhen">&nbsp;</span></div>'],

  ['…and says what it counts and how it dates it',
   "    + 'counted on what was KEPT, dated by the day the goods came'",
   "    + ''"],

  ['…and warns about the work that is priced by nothing',
   '      ${noRate.length ? `<div class="metric"><div class="v" style="color:var(--bad)">${nf(noRate.length)}</div>' + NL
     + '        <div class="l">Lines with no rate</div></div>` : \'\'}',
   ''],

  ['…and a period with nothing in it explains itself',
   "      : `Nothing was accepted from any vendor between ${w.from} and ${w.to}. `",
   '      : ``'],

  ['…and the search box narrows it',
   "  const rows = all.filter(r => !q || [r.vendor, r.vendorCode, r.service, r.what].join(' ').toLowerCase().includes(q));",
   '  const rows = all;'],

  ['the vendor payout is a view of its own',
   "  if (view === 'vpay') return renderVpay();",
   '  '],

  ['…with the period picker on it',
   "  $('hrPeriod').classList.toggle('hide', !(payView || view === 'vpay'));",
   "  $('hrPeriod').classList.toggle('hide', !payView);"],

  /* AND NO FREEZE. There is nothing on this screen that means settled, and a Freeze button that
   * locked nothing would say there were. */
  ['…and no Freeze button on it',
   "  $('hrFreeze').classList.toggle('hide', !payView);",
   "  $('hrFreeze').classList.toggle('hide', !(payView || view === 'vpay'));"],

  /* ---- taking a figure apart ---- */
  ['a figure can be taken apart into its deliveries',
   '  const r = vpayRows(yr, mo, per).find(x => x.key === key);' + NL + '  if (!r) return;',
   '  const r = null;' + NL + '  if (!r) return;'],

  ['…and it names the rate it used',
   "      : `Paid at Rs.${r.rate} ${r.run ? 'per metre' : 'per piece'} — ${rw.service || 'Block print'}`",
   "      : `Paid at Rs.${r.rate}`"],

  ['…and shows the arithmetic',
   "        + `. ${nf(r.qty)} ${r.unit} × Rs.${r.rate} = ${rs(r.amount)}.`)",
   "        + `.`)"],

  ['…and unpriced work says the rate is what is missing',
   "      ? 'NO APPROVED RATE prices this work, so it is adding nothing to the total: ' + r.why + '. The pieces '",
   "      ? ' '"],

  /* ---- and the rate row itself ---- */
  ['a rate is looked up as a row, not only as a number',
   '  return hits[0] || null;',
   '  return hits[0] ? { rate: hits[0].rate } : null;'],
];

const BASE = 1;
let bad = 0;
for (const [what, from, to] of breaks) {
  const src = good.replace(/\r\n/g, NL);
  if (src.split(from).length !== 2) { console.log('  ??    anchor missing or not unique: ' + what); bad++; continue; }
  fs.writeFileSync(P, src.replace(from, () => to).replace(/\n/g, '\r\n'));
  const r = cp.spawnSync('node', ['prod-test.js'],
    { cwd: require('path').join(__dirname, '..'), encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const bit = m ? +m[2] > BASE : false;
  if (!bit) bad++;
  console.log(`  ${bit ? 'BIT ' : 'MISS'}  ${what} — ${m ? m[0] : 'suite crashed: ' + out.slice(-200)}`);
}
fs.writeFileSync(P, good);
console.log(bad ? '\n' + bad + ' DO NOT BITE' : '\nall bite; file restored');
