/* The plan follows the choice, the form takes the choice, and the table shows where the capacity
 * came from. Second half of 2026-09-20-pal-manual.js. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the plan only uses printers who were given the group ---- */
one(`  const printers = palPrinters().filter(p => p.active !== false);
  const free = new Map(printers.map(p => [p.key, palNum(p.pcsMonth)]));
  const rows = groups.map(g => {
    let left = Math.round(g.toMake);
    const picks = [];
    if (left > 0) {
      const order = printers.slice().sort((a, b) =>
        (palScore(b, g) - palScore(a, g))
        || (palNum(free.get(b.key)) - palNum(free.get(a.key)))
        || String(a.name || '').localeCompare(String(b.name || '')));
      for (const p of order) {`,
`  const printers = palPrinters().filter(p => p.active !== false);
  /* MEASURED, NOT TYPED. What each printer can do in a month comes off the delivery log. */
  const cap = new Map(printers.map(p => [p.key, palCapacity(p)]));
  const free = new Map(printers.map(p => [p.key, palNum((cap.get(p.key) || {}).pcs)]));
  const rows = groups.map(g => {
    let left = Math.round(g.toMake);
    const picks = [];
    /* ONLY WHOEVER WAS GIVEN THIS GROUP. Who prints which colour is a relationship, not something to
     * work out from who happens to hold a block — that is how all three printers came back at 100%
     * on one group. A group nobody has been given goes to nobody, and says so. */
    const mine = printers.filter(p => palTakes(p, g));
    if (left > 0 && mine.length) {
      const order = mine.slice().sort((a, b) =>
        (palScore(b, g) - palScore(a, g))
        || (palNum(free.get(b.key)) - palNum(free.get(a.key)))
        || String(a.name || '').localeCompare(String(b.name || '')));
      for (const p of order) {`, 'the plan follows the choice');

one(`    return { group: g, picks, short: left };
  });
  const load = new Map(printers.map(p => [p.key, 0]));
  rows.forEach(r => r.picks.forEach(pk => load.set(pk.key, palNum(load.get(pk.key)) + pk.pcs)));
  return { rows, free, load, printers };`,
`    /* NOBODY HAS BEEN GIVEN IT is a different answer from EVERYBODY IS FULL, and the screen has to
     * be able to tell them apart — one is a decision waiting to be made, the other is a wall. */
    return { group: g, picks, short: left, unassigned: !printers.some(p => palTakes(p, g)) };
  });
  const load = new Map(printers.map(p => [p.key, 0]));
  rows.forEach(r => r.picks.forEach(pk => load.set(pk.key, palNum(load.get(pk.key)) + pk.pcs)));
  return { rows, free, load, printers, cap };`, 'and says when nobody was given one');

/* ---- 2. the form: groups picked, vendor linked, capacity shown not typed ---- */
one(`    note: 'Capacity is the pieces this printer can finish in a month. Tables are what they print on — '
      + 'they do not change the arithmetic, they explain it.',
    fields: [
      { key: 'palName', label: 'Name', value: p ? p.name || '' : '', span: true },
      { key: 'palTables', label: 'Tables', type: 'number', min: 0, step: 1, value: p ? palNum(p.tables) : '' },
      { key: 'palCap', label: 'Capacity — pieces a month', type: 'number', min: 0, step: 1, value: p ? palNum(p.pcsMonth) : '' },
      { key: 'palActive', label: 'Taking work', type: 'select', options: ['Yes', 'No'], value: p && p.active === false ? 'No' : 'Yes' },
      { key: 'palNote', label: 'Note', value: p ? p.note || '' : '', span: true },
    ],`,
`    note: (c => 'Capacity is worked out from what they have actually delivered — tables times their best '
      + 'month per table — so the only number to enter is the tables. ' + (p ? palCapWhy(c) + ' ' : '')
      + 'Which colour groups they take is your choice; a group nobody is given goes to nobody.')(p ? palCapacity(p) : null),
    fields: [
      { key: 'palName', label: 'Name', value: p ? p.name || '' : '', span: true },
      { key: 'palTables', label: 'Tables', type: 'number', min: 0, step: 1, value: p ? palNum(p.tables) : '' },
      /* THE VENDOR THEY ARE, because that is what the delivery log is keyed by. Guessed from the name
       * when it matches one, and correctable — a printer tied to the wrong vendor would be measured
       * on somebody else's work. */
      { key: 'palVendor', label: 'Vendor (for the delivery history)', type: 'select',
        value: p ? (p.vendorCode || palVendorOf(p) || '') : '',
        options: [['', '— not linked —']].concat(voAllVendors().map(v => [String(v.code || ''), String(v.name || v.code || '')])) },
      /* WHICH GROUPS THEY TAKE. Several at once, ticked — this is the allocation. */
      { key: 'palGroups', label: 'Colour groups this printer takes', type: 'multi', span: true,
        value: Array.isArray(p && p.groups) ? p.groups : [],
        options: palGroupNames() },
      { key: 'palCap', label: 'Capacity if there is nothing to measure yet', type: 'number', min: 0, step: 1, value: p ? palNum(p.pcsMonth) : '' },
      { key: 'palActive', label: 'Taking work', type: 'select', options: ['Yes', 'No'], value: p && p.active === false ? 'No' : 'Yes' },
      { key: 'palNote', label: 'Note', value: p ? p.note || '' : '', span: true },
    ],`, 'the form');

/* ---- 3. what gets saved ---- */
one(`  const cap = Math.max(0, Math.round(palNum(v.palCap)));`,
`  const cap = Math.max(0, Math.round(palNum(v.palCap)));
  /* The ticked groups, and the vendor they are. Both are decisions, so both are stored as given. */
  const groups = (Array.isArray(v.palGroups) ? v.palGroups : []).map(String).filter(Boolean);
  const vendorCode = String(v.palVendor || '').trim().toUpperCase();`, 'read back');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
