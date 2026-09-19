const fs = require('fs'), cp = require('child_process');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const good = fs.readFileSync(P, 'utf8');
const NL = String.fromCharCode(10);

const breaks = [
  /* Putting the old wall back. Every test that says "this is allowed now" must fail. */
  /* The first three breaks that lived here moved to teeth-vlover2.js: one was invalid JavaScript
   * and crashed rather than failed, one was a no-op twin of itself, and one is dropped with its
   * reason recorded there. */
  ['the difference is stored on the acceptance',
   '      const over = (q + rj) - (parseFloat(d.qty) || 0);' + NL + '      if (over > 0) d.ok.over = over;',
   ''],

  ['the printer\'s own claim is never overwritten',
   '      d.ok = { qty: q, by: ME.email, at: now };',
   '      d.ok = { qty: q, by: ME.email, at: now }; d.qty = q;'],

  ['the line is credited with what actually arrived',
   '      l.vendorQty = dels.reduce((s, x) => s + vlQtyOf(x), 0);',
   '      l.vendorQty = dels.reduce((s, x) => s + (parseFloat(x.qty) || 0), 0);'],

  /* The reader. It must work the difference out rather than trust a stored number. */
  ['the overage is worked out from the counts, not read off a stored number',
   '  const got = (parseFloat(k.qty) || 0) + (parseFloat(k.rej) || 0);' + NL
     + '  return Math.max(0, got - (parseFloat(d && d.qty) || 0));',
   '  return parseFloat(k.over) || 0;'],

  ['…and pieces sent back count as having arrived',
   '  const got = (parseFloat(k.qty) || 0) + (parseFloat(k.rej) || 0);',
   '  const got = (parseFloat(k.qty) || 0);'],

  /* What the person is told. */
  ['the message says it went over the challan',
   "        + (over > 0 ? \`, \${nf(over)} MORE than the \${nf(claimed)} the printer recorded — \${r.vendor} is credited for it.\`",
   "        + (false ? ''"],

  ['…and that the line has gone past what was ordered',
   "        + (overOrder > 0 ? \` This line is now \${nf(overOrder)} \${r.unit} over the \${nf(lineOrdered)} \`" + NL
     + "          + 'that were ordered.' : '')",
   "        + ''"],

  ['…and the dialog says how much room the order has left',
   "      { key: 'vlroom', label: 'This line still has room for', type: 'text', readonly: true," + NL
     + "        value: nf(roomOnOrder) + ' ' + r.unit + ' of the ' + nf(lineOrdered) + ' ordered' },",
   ''],

  ['the room left counts the other deliveries on the line',
   '  const otherDone = f.dels.reduce((a, x, i) => a + (i === r.di ? 0 : vlQtyOf(x)), 0);',
   '  const otherDone = 0;'],

  /* The row. */
  ['the row says it went over the challan',
   "          + (over > 0 ? \`<div style=\"font-size:10.5px;color:#7f6000;font-weight:600\"",
   "          + (false ? \`<div style=\"font-size:10.5px;color:#7f6000;font-weight:600\""],

  ['…and an over-receipt is not painted like a clean one',
   "        ? \`<span style=\"font-weight:700;color:\${over > 0 ? '#7f6000' : (okQty + rej < r.qty ? 'var(--bad)' : '#166534')}\">\${nf(okQty)}</span>\`",
   "        ? \`<span style=\"font-weight:700;color:\${okQty + rej < r.qty ? 'var(--bad)' : '#166534'}\">\${nf(okQty)}</span>\`"],

  /* THE COLOUR BUG THIS CHANGE ALSO FIXED: six kept with four sent back is nothing short. */
  ['…and a fully-arrived delivery with rejects is not painted as short',
   "okQty + rej < r.qty ? 'var(--bad)' : '#166534'",
   "okQty < r.qty ? 'var(--bad)' : '#166534'"],

  ['the strip counts the over-receipts',
   '  const vlOverN = rows.filter(r => vlOver(r.del) > 0).length;',
   '  const vlOverN = 0;'],
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
