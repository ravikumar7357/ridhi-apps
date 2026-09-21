/* GREIGE POs, the greige name on each fabric, and greige turning into RFD. See 2026-09-21-gpo-code.js. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};
const code = fs.readFileSync(__dirname + '/2026-09-21-gpo-code.js', 'utf8').split(CR + LF).join(LF);

/* ---- 1. mills and processors are kinds of vendor ---- */
one(`const VENDOR_CATS = ['Printer', 'Digital printer', 'Screen printer', 'Marble printer',
  'Embroidery', 'Fabricator', 'Filling'];`,
`const VENDOR_CATS = ['Printer', 'Digital printer', 'Screen printer', 'Marble printer',
  'Embroidery', 'Fabricator', 'Filling', 'Mill', 'Processor'];`, 'mill and processor');

/* ---- 2. the toolbar ---- */
one(`            <option value="lots">Lots &mdash; bale by bale</option>
            <option value="ledger">Every movement</option>
          </select>`,
`            <option value="lots">Lots &mdash; bale by bale</option>
            <option value="ledger">Every movement</option>
            <option value="po">Greige POs</option>
          </select>`, 'the view');
one(`          <button id="fbEntry">+ Fabric entry</button>`,
`          <button id="fbEntry">+ Fabric entry</button>
          <button id="fbPoNew" class="hide">+ Greige PO</button>
          <button id="fbPoSet" class="ghost hide" title="Company name, address, GSTIN and default terms printed on every PO.">PO settings</button>`, 'the buttons');

one(`  if (FAB.err) { $('fbMsg').className = 'err'; $('fbMsg').textContent = 'Could not read it: ' + FAB.err; ptEmpty('fbTable', 'Nothing to show.'); $('fbKpis').innerHTML = ''; return; }
  const all = FAB.rows || [];`,
`  if (FAB.err) { $('fbMsg').className = 'err'; $('fbMsg').textContent = 'Could not read it: ' + FAB.err; ptEmpty('fbTable', 'Nothing to show.'); $('fbKpis').innerHTML = ''; return; }
  /* THE PO VIEW has its own buttons and its own table; the ledger's filters do not apply to it. */
  const isPo = $('fbView').value === 'po';
  if ($('fbPoNew')) $('fbPoNew').classList.toggle('hide', !isPo || !ptCanEdit());
  if ($('fbPoSet')) $('fbPoSet').classList.toggle('hide', !isPo || !ME.admin);
  if (isPo) return renderGpo();
  const all = FAB.rows || [];`, 'dispatch');

/* ---- 3. receiving against a PO ---- */
one(`/** The dialog. The fabric list is the ledger's own — the factory buys what it buys. */
function fabEntryOpen() {`,
`/** The dialog. The fabric list is the ledger's own — the factory buys what it buys. */
function fabEntryOpen(pre) {
  /* Opened from the toolbar it is handed a click; opened from a PO it is handed what to fill in. */
  pre = pre && typeof pre === 'object' && !pre.target ? pre : {};`, 'entry takes a prefill');
one(`      <label>Bill / challan <input id="fbeChallan" placeholder="Optional"></label>`,
`      <label>Bill / challan <input id="fbeChallan" placeholder="Optional"></label>
      <label>Against greige PO <input id="fbeOrd" placeholder="Optional — GPO-…"></label>`, 'PO field');
one(`      return fabSave({ txnType: v.fbeKind, date: v.fbeDate, fabricType: v.fbeFab, qty: v.fbeQty,
        lot: v.fbeLot, counterpartyName: v.fbeCp, colour: v.fbeCol, challan: v.fbeChallan, rate: v.fbeRate,
        remarks: v.fbeRemarks, state: v.fbeKind === 'ISSUE_TO_CUTTING' ? 'RFD' : '' });
    },
  });`,
`      const err = await fabSave({ txnType: v.fbeKind, date: v.fbeDate, fabricType: v.fbeFab, qty: v.fbeQty,
        lot: v.fbeLot, counterpartyName: v.fbeCp, colour: v.fbeCol, challan: v.fbeChallan, rate: v.fbeRate,
        remarks: v.fbeRemarks, orderNo: v.fbeOrd, state: v.fbeKind === 'ISSUE_TO_CUTTING' ? 'RFD' : '' });
      if (!err && $('fbView').value === 'po') renderGpo();
      return err;
    },
  });
  const put = (id, v) => { const el = $(id); if (el && v != null && v !== '') el.value = v; };
  put('fbeKind', pre.kind); put('fbeFab', pre.fabric); put('fbeQty', pre.qty); put('fbeCp', pre.cp); put('fbeOrd', pre.orderNo);`, 'prefill');

one(`  const fabric = String(rec.fabricType || '').trim();
  if (!fabric) return 'Which fabric?';`,
`  let fabric = String(rec.fabricType || '').trim();
  if (!fabric) return 'Which fabric?';`, 'fabric can be converted');

one(`  if (kind === 'RECEIVE_GREIGE') {
    /* A delivery opens a lot. If nobody types the mill's own number, one is made. */`,
`  /* AGAINST A GREIGE PO: it has to be one, still open, and for this cloth. */
  const poNo = String(rec.orderNo || '').trim().toUpperCase();
  if (kind === 'RECEIVE_GREIGE' && poNo && GPO.rows) {
    const po = GPO.rows.find(r => String(r.poNo || '').toUpperCase() === poNo);
    if (!po) return \`There is no greige PO \${poNo}.\`;
    if (po.status === 'cancelled') return \`\${poNo} was cancelled.\`;
    const names = (po.lines || []).map(l => String(l.greige || '').trim());
    if (!names.some(n => n.toLowerCase() === fabric.toLowerCase()))
      return \`\${poNo} is for \${names.join(', ')} — not \${fabric}.\`;
  }

  if (kind === 'RECEIVE_GREIGE') {
    /* A delivery opens a lot. If nobody types the mill's own number, one is made. */`, 'checked against the PO');

one(`    if (g.fabricType && fabric && String(g.fabricType).toUpperCase() !== fabric.toUpperCase())
      return \`Lot \${lot} is \${g.fabricType}, not \${fabric}.\`;`,
`    /* The lot is still greige, so it goes out under its greige name — typing the RFD name it will
     * become is not a mistake worth stopping anybody for. */
    if (g.fabricType && fabric && String(g.fabricType).toUpperCase() !== fabric.toUpperCase()
      && fabRfdOfGreige(g.fabricType).toUpperCase() !== fabric.toUpperCase())
      return \`Lot \${lot} is \${g.fabricType}, not \${fabric}.\`;
    fabric = g.fabricType || fabric;`, 'sent out as greige');

one(`    if (qty > g.withProcessor + 1e-9)
      return \`Only \${nf(Math.round(g.withProcessor))} m of lot \${lot} is still with \${g.processor || 'the processor'} \`
        + \`(\${nf(Math.round(g.toRfd))} sent, \${nf(Math.round(g.rfdIn))} already back).\`;`,
`    if (qty > g.withProcessor + 1e-9)
      return \`Only \${nf(Math.round(g.withProcessor))} m of lot \${lot} is still with \${g.processor || 'the processor'} \`
        + \`(\${nf(Math.round(g.toRfd))} sent, \${nf(Math.round(g.rfdIn))} already back).\`;
    /* GREIGE COMES BACK AS THE RFD FABRIC IT WAS BOUGHT FOR — Greige Sheeting 67 back as Sheeting 62.
     * Only when Masters says so; a greige with no RFD fabric named keeps whatever was typed. */
    const becomes = fabRfdOfGreige(g.fabricType);
    if (becomes) fabric = becomes;`, 'back as RFD');

one(`      g = { lot, fabricType: r.fabricType || '', bill: '', mill: '', processor: '', date: r.date || '',`,
`      g = { lot, fabricType: r.fabricType || '', rfdFabric: '', bill: '', mill: '', processor: '', date: r.date || '',`, 'lot knows its RFD name');
one(`    } else if (r.txnType === 'RECEIVE_RFD') g.rfdIn += q;`,
`    } else if (r.txnType === 'RECEIVE_RFD') { g.rfdIn += q; g.rfdFabric = g.rfdFabric || String(r.fabricType || '').trim(); }`, 'recorded');
one(`    if (f && String(g.fabricType || '').trim().toUpperCase() !== f) return false;`,
`    /* A lot answers to its greige name, the RFD name it came back as, and the one Masters says it becomes. */
    if (f && ![g.fabricType, g.rfdFabric, fabRfdOfGreige(g.fabricType)]
      .some(n => String(n || '').trim().toUpperCase() === f)) return false;`, 'lot found by either name');

/* ---- 4. the greige name, in Masters ---- */
one(`    .concat(isFab ? ['Width (inches)'] : [])`,
`    .concat(isFab ? ['Width (inches)', 'Greige name (what the mill is sent)'] : [])`, 'masters head');
one(`            : (!r.widthIn ? \`<div class="muted" style="font-size:10.5px">from the name</div>\` : '')}</td>\` : '')`,
`            : (!r.widthIn ? \`<div class="muted" style="font-size:10.5px">from the name</div>\` : '')}</td>\` : '')
      + (isFab ? \`<td>\${ME.admin
          ? \`<input data-fabg="\${esc(r._key)}" type="text" value="\${esc(r.greige || '')}" placeholder="e.g. Greige Sheeting 67" style="width:180px">\`
          : (r.greige ? esc(r.greige) : '<span class="muted">—</span>')}</td>\` : '')`, 'masters cell');
one(`/** Put a width on one fabric. Nothing else on the row is touched. */`,
`$('mstTable').addEventListener('change', async e => {
  const k = e.target.getAttribute && e.target.getAttribute('data-fabg');
  if (!k) return;
  const err = await fabGreigeSave(k, e.target.value);
  $('mstMsg').className = err ? 'err' : 'muted';
  if (err) $('mstMsg').textContent = err;
});

/**
 * The name this fabric's greige is bought under. One greige name belongs to one fabric — two would
 * leave "RFD received" not knowing which it had become.
 */
async function fabGreigeSave(rkey, value) {
  if (!ME.admin) return 'Only an admin can change a master list.';
  const r = mstRows('fabricType').find(x => x._key === rkey);
  if (!r) return 'That fabric is not on the list any more.';
  const txt = String(value == null ? '' : value).trim().replace(/\\s+/g, ' ');
  const clash = txt && mstRows('fabricType').find(x => x._key !== rkey && x.active !== false
    && String(x.greige || '').trim().toLowerCase() === txt.toLowerCase());
  if (clash) return \`\${txt} is already the greige of \${clash.desc || clash.code}. One greige name, one fabric.\`;
  const row = Object.assign({}, r, { modifiedAt: new Date().toISOString(), modifiedBy: ME.email });
  delete row._key;
  if (txt) row.greige = txt; else delete row.greige;
  await ptPut('pt_masters/fabricType/' + rkey, row);
  PTG.masters.fabricType = PTG.masters.fabricType || {};
  PTG.masters.fabricType[rkey] = row;
  renderMst();
  $('mstMsg').className = 'muted';
  $('mstMsg').textContent = txt ? \`\${r.desc || r.code} is bought as \${txt}.\` : \`\${r.desc || r.code} has no greige name — it cannot go on a greige PO.\`;
  return '';
}

/** Put a width on one fabric. Nothing else on the row is touched. */`, 'masters save');

/* ---- 5. the PO section itself ---- */
one(`$('fbEntry').onclick = fabEntryOpen;`, `$('fbEntry').onclick = fabEntryOpen;
` + code, 'the PO code');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
