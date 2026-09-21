/* THE WHOLE-ORDER ASK NEEDS A YES.
 *
 * 21 Sep 2026: the VND002 printer typed what they had in hand into the "with you" boxes at 06:19 and
 * a minute later pressed "Ask for everything still needed — 4,409 pcs". One click, no question, 67
 * requirements. Ravi: "vendor ne abhi request hi nahi kiya tha". The button was blue, at the top
 * right, where a Save button sits — and the stock boxes save by themselves, so there was nothing
 * else on the screen to press.
 *
 * So: the button is plain, not blue; it opens a dialog that says how many and how much, and nothing
 * is written until they press the button inside it. And the stock box says it is saved and that
 * nothing else needs pressing.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

one(`          ? \`<button id="vpRfdAll" title="Raises a requirement for everything this order still needs, in one go.">Ask for everything still needed — \${esc(leftTxt)}</button>\``,
`          ? \`<button id="vpRfdAll" class="ghost" title="Raises a requirement for everything this order still needs, in one go. You are asked to confirm first.">Ask for the whole order (\${esc(leftTxt)})…</button>\``,
'plain button');

one(`  if ($('vpRfdAll')) $('vpRfdAll').onclick = async () => {
    const btn = $('vpRfdAll'); btn.disabled = true;
    const r = await rfdSubmitOrder(o, '');
    btn.disabled = false;
    if (r.err) { $('vpMsg').className = 'err'; $('vpMsg').textContent = r.err; return; }`,
`  if ($('vpRfdAll')) $('vpRfdAll').onclick = () => ptOpenDialog({
    title: 'Ask for the whole of ' + (o.orderNo || o.id) + '?',
    subtitle: leftTxt + ' — every size and fabric this order still needs',
    note: 'This raises a requirement for EVERYTHING left on the order, in one go. '
      + 'If you only want to tell us what is already with you, you do not need this — those boxes save by themselves.',
    fields: [],
    saveLabel: 'Yes, ask for all of it',
    onSave: async () => {
      const r = await vpRfdAllRun(o);
      return r.err || '';
    },
  });
  async function vpRfdAllRun(o) {
    const r = await rfdSubmitOrder(o, '');
    if (r.err) { $('vpMsg').className = 'err'; $('vpMsg').textContent = r.err; return r; }`,
'asks first');

one(`    renderVp();
    $('vpMsg').className = 'muted'; $('vpMsg').textContent = VP.lastNote;
  };`,
`    renderVp();
    $('vpMsg').className = 'muted'; $('vpMsg').textContent = VP.lastNote;
    return r;
  }`, 'returns');

one(`  $('vpMsg').textContent = err || 'Saved. It comes off what is left to ask for, here and on your other orders.';`,
`  $('vpMsg').textContent = err || 'Saved — nothing else to press. It comes off what is left to ask for, here and on your other orders. '
    + 'Nothing has been asked for.';`, 'stock says saved');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
