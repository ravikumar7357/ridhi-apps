/* TEETH for tests/flow-test.js: break the production flow's rules on purpose; the suite must fail every time.
 *   node tests/teeth/teeth-flow.js */
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const DIR = path.join(__dirname, '..', '..', 'src', 'app', 'flow');
const FILES = ['flow-core.js', 'flow-ppc.js', 'flow-demand.js', 'flow-challan.js', 'flow-test-order.js', 'flow-receive.js', 'flow-edit.js', 'flow-view.js'];
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'flow-core.js': {
    'on for the live app too': s => s.replace("return /--/.test(location.hostname) ||", 'return true ||'),
    'every account sees every bucket': s => s.replace('const flowBucketsAllowed = () => (ME.admin ? FLOW_BUCKETS :', 'const flowBucketsAllowed = () => (true ? FLOW_BUCKETS :'),
    'old orders go into PPC too': s => s.replace("const isNew = String(ptIsoDate(r.orderDate) || '') >= flowFrom();", 'const isNew = true;'),
    'Demand ignores the accessories': s => s.replace('s.needAcc = isNew && accNeed && !res;', 's.needAcc = false;'),
    'an outsourced line still waits in Demand': s => s.replace("const accNeed = !!p && route !== 'outsource' &&", 'const accNeed = !!p &&').replace("s.needFab = isNew && !!p && route !== 'outsource' &&", 's.needFab = isNew && !!p &&').replace("    : (route === 'outsource') ? (s.india < qty ? 'out' : 'done')", '    : false ? 0'),
    'a challan line is not given': s => s.replace('if (cx) { s.challan = cx; s.given = qty;', 'if (cx) { s.challan = cx;'),
    'a closed challan does not send the line on': s => s.replace('s.back = cx.closed ? qty :', 's.back = false ? qty :'),
    'stitching only goes to the printer': s => s.replace("const printed = p ? route === 'inhouse' :", "const printed = p ? !!(p.print && p.print.need) :"),
    'the two Demand lists are one': s => s.replace("const flowInView = (view, s) => view === 'drfd' ? s.bucket === 'demand' && s.needFab", "const flowInView = (view, s) => view === 'drfd' ? s.bucket === 'demand'"),
    'cut figures not capped at the order': s => s.replace('const cap = n => Math.max(0, Math.min(qty, +n || 0));', 'const cap = n => Math.max(0, +n || 0);'),
    'made ignores the press': s => s.replace('made: Math.max(cap(r.pressed), q ? cap(q.ok) : 0)', 'made: q ? cap(q.ok) : 0'),
    'done lines stay listed': s => s.replace("if (s.bucket === 'done' && !recent) return;", ''),
    'rows never worked out again': s => s.replace('&& FLOW_C.ppc === FLOW.ppc ', ''),
  },
  'flow-ppc.js': {
    'a locked fabric can be changed': s => s.replace("if (locked) ['fabric', 'route', 'printer', 'print'].forEach(k => { nu[k] = x.s.plan[k]; });", ''),
    'stray keys in the plan list': s => s.replace(".filter(([path]) => path.startsWith('pt_ppc/'))", ''),
    'width calculator beats the master row': s => s.replace('if (mFab && mCons > 0) fabric =', 'if (false) fabric ='),
    'direction asked for a SKU printed on itself': s => s.replace("if (m.cuttingRequired === false) return { dirs: [], cur: '' };", ''),
    'a sheeting line saved with no direction': s => s.replace('if (noDir.length) return', 'if (false) return'),
    'an old plan hides the master data': s => s.replace('return nameOff || perOff ? {', 'return false ? {'),
    'master m/pc not compared': s => s.replace('perOff = mc > 0 &&', 'perOff = false &&'),
    'Use the master data does nothing': s => s.replace("if (n) n.value = b.dataset.n; if (pc && +b.dataset.p) pc.value = b.dataset.p;", ''),
    'a plan with no fabric is saved': s => s.replace('if (noFab.length) return', 'if (false) return'),
    'a stitching line keeps a printer': s => s.replace("p.printer = v ? {", "p.printer = (v || p.printer.code) ? {").replace("p.route === 'inhouse' && p.printer && p.printer.code ? flowChVendors()", "p.printer && p.printer.code ? flowChVendors()"),
    'a test order eats real stock': s => s.replace(" || (r.__t && !withTest)) return;", ") return;"),
    'earlier plans not counted': s => s.replace('before = (com.acc[c] || 0) + (run.acc[c] || 0)', 'before = (run.acc[c] || 0)'),
    'balance shows the stock, not what is left': s => s.replace('const bal = flowR2(stock - earlier), ok = bal >= need;', 'const bal = flowR2(stock), ok = bal >= need;'),
    'no printed stock row': s => s.replace("if (w && w.code) h.push(flowPrintedRow(", "if (false) h.push(flowPrintedRow("),
    'printed pieces looked up as cloth': s => s.replace("const key = w.kind === 'sku' ? 'P|' + obUC(w.code) :", "const key = false ? '' :"),
    'lines above in the form not counted': s => s.replace('        run.acc[c] = (run.acc[c] || 0) + need; });', '        });'),
    'issued zippers still counted': s => s.replace("acc[c] = (acc[c] || 0) + Math.ceil(+a.qty * left);", "acc[c] = (acc[c] || 0) + (+a.qty);"),
    'moved cloth still counted': s => s.replace('const unmoved = !s.cut && !s.issued &&', 'const unmoved = true ||'),
    'unknown stock shown as 0': s => s.replace("const st = !known ? '<span class=\"muted\">stock not kept in the app</span>'", "const st = false ? ''"),
    'the gaps are saved': s => s.replace('delete rec.gaps;', ''),
    'no recipe fallback': s => s.replace("const per = +(recipeValue(m, 'consumption') || 0)", 'const per = 0'),
    'an outsourced line needs no vendor': s => s.replace('if (noVen.length) return', 'if (false) return'),
    'an outsourced line keeps its accessories': s => s.replace("if (p.route === 'outsource') { p.acc = [];", "if (p.route === 'outsource') {"),
    'ready date ignores the MTO due date': s => s.replace('ready: ptIsoDate(r.mtoDue) || flowAddDays(t, 10)', 'ready: flowAddDays(t, 10)'),
  },
  'flow-demand.js': {
    'a reservation is never let go at issue': s => s.replace('const left = qty > 0 ? Math.max(0, 1 - (+issued || 0) / qty) : 0', 'const left = 1'),
    'reserving more than is free': s => s.replace('if (short.length) return', 'if (false) return'),
    'held is not taken off the shelf': s => s.replace("free: (+b.qty || 0) - (held[c] || 0) }", 'free: (+b.qty || 0) }'),
    'a challan is let go as soon as the vendor order is placed': s => s.replace('(fr.challan ? s.back : s.given)', 's.given'),
    'ready lines do not hold their cloth': s => s.replace('F(name).held += +fr.metres || +(p.fabric && p.fabric.metres) || 0;', 'F(name).held += 0;'),
    'every line sees the whole stock (no oldest-first)': s => s.replace('avail = Math.max(0, f.stock - f.held - f.need);', 'avail = Math.max(0, f.stock - f.held);'),
    'part of the fabric is "ready"': s => s.replace('if (!undo && need && metres < need) return', 'if (false) return'),
  },
  'flow-challan.js': {
    'any printer may take any line': s => s.replace('if (other.length) return `${other.map(y =>', 'if (false) return `${other.map(y =>'),
    'the challan holds every printer\'s lines': s => s.replace("(pcode == null || (pcode === '?' ? !flowPlanPrinter(x.s) : flowPlanPrinter(x.s) === pcode))", 'true'),
    'stitching lines go on a challan': s => s.replace("flowInView('drfd', x.s) && x.s.route !== 'stitch'", "flowInView('drfd', x.s)"),
    'no printer set from the challan': s => s.replace("setP.forEach(k => { patch[`pt_ppc/${k}/printer`]", "[].forEach(k => { patch[`pt_ppc/${k}/printer`]"),
    'cutting-not-required sent as fabric': s => s.replace("  if (m.cuttingRequired === false)\n    return { kind: 'sku'", "  if (false)\n    return { kind: 'sku'"),
    'the print rule beats the master row': s => s.replace("  if (m.cuttingRequired === false)\n    return { kind: 'sku'", "  if (m.cuttingRequired === false && (() => { try { return ptPrintIssueAs(m) !== 'running'; } catch (e) { return true; } })())\n    return { kind: 'sku'"),
    'both directions shown when none chosen': s => s.replace('if (!dir && dirs.length > 1)\n    return', 'if (false)\n    return'),
    'chosen direction ignored': s => s.replace("let dir = (plan && plan.print && plan.print.dir) || flowDirDefault(m, fab);", 'let dir = flowDirDefault(m, fab);'),
    'one-way fabric needs a direction': s => s.replace('if (!dir && dirs.length === 1) dir = dirs[0];', ''),
    'no colour code: any fabric SKU of the colour': s => s.replace("&& (!cc || codeOf(c) === String(cc)", "&& (true || codeOf(c) === String(cc)"),
    'colour code read from the SKU text again': s => s.replace("const codeOf = c => String(c.code || ordColCodeOf(c.sku) || '');", "const codeOf = c => String(ordColCodeOf(c.sku) || '');"),
    'the built SKU beats the one added by hand': s => s.replace('if (!e || (c.manual && !e.some(x => x.manual))) byDir.set(k, [c]);', 'if (!e) byDir.set(k, [c]);'),
    'To print not added up': s => s.replace('e.metres += +l.metres || 0; e.pcs += +l.pcs || 0; g.set(k, e);', 'g.set(k + Math.random(), Object.assign({}, e, { metres: +l.metres || 0, pcs: +l.pcs || 0 }));'),
    'challan line forgets what it prints': s => s.replace('item: flowChItem(x.r), print: flowPrintWhat(x.r, x.s.plan),', 'item: flowChItem(x.r),'),
    'ruffle cloth not printed': s => s.replace("return (plan.extra || []).filter(x => x.unit === 'm' && /^Ruffle — /", "return [].filter(x => x.unit === 'm' && /^Ruffle — /"),
    'ruffle takes the body direction': s => s.replace("const dir = dirs.length === 1 ? dirs[0] : ((plan.print && plan.print.dir) || '');", "const dir = (plan.print && plan.print.dir) || '';"),
    'ruffle not in To print': s => s.replace("xe.metres += +x.metres || 0; g.set(xk, xe);", ''),
    'ruffle for a line not printed here': s => s.replace("if (!plan || flowRouteOf(plan) !== 'inhouse') return [];", 'if (!plan) return [];'),
    'a challan with no vendor': s => s.replace("if (!v) return 'Which vendor", "if (false) return 'Which vendor"),
    'the challan ignores the PPC printer': s => s.replace("String(v.code) === String(planned) ? ' selected' : ''", "''"),
    'unticked lines go on it too': s => s.replace('.filter(y => y.on);', '.filter(y => true);'),
    'test challans use real numbers': s => s.replace("(test ? 'TRFD-' : 'RFD-')", "'RFD-'"),
    'challan number never moves on': s => s.replace('(used.length ? Math.max(...used) : 0) + 1', '1'),
    'lines not marked given': s => s.replace("ch.lines.forEach(l => { patch[`pt_flowDemand/${l.key}/fabricReady`]", "[].forEach(l => { patch[`pt_flowDemand/${l.key}/fabricReady`]"),
    'a blocked pop-up is swallowed': s => s.replace("if (!w || !w.document) return 'The browser blocked", "if (!w || !w.document) return ''; if (0) return 'The browser blocked"),
  },
  'flow-test-order.js': {
    'switch on with no test order': s => s.replace('return Object.keys(FLOW.test || {}).length > 0;', 'return true;'),
    'a test order with a SKU not in the master': s => s.replace("if (!cutSkuOf(sku)) { bad.push", "if (false) { bad.push"),
    'Simulate does not move the line': s => s.replace('const nt = Object.assign({}, t, set);', 'const nt = t;'),
    'delete leaves the plan behind': s => s.replace("patch['pt_ppc/' + k] = null; ", ''),
    'test lines never re-read': s => s.replace('if (FLOW_TC.src === FLOW.test) return FLOW_TC.rows;', 'if (FLOW_TC.rows.length) return FLOW_TC.rows;'),
  },
  'flow-receive.js': {
    'Demand history challans not filtered': s => s.replace('.filter(c => !testOnly || flowIsTest(c.orderNo))', ''),
    'a receipt never closes the challan': s => s.replace('if (allBack) patch[', 'if (false) patch['),
    'receipts not added up': s => s.replace('out[k] = flowR2((out[k] || 0) + (+m || 0));', 'out[k] = flowR2(+m || 0);'),
    'any metres accepted': s => s.replace('if (over.length) return', 'if (false) return'),
    'close short with no reason': s => s.replace("if (!why) return 'Say why", "if (false) return 'Say why"),
    'no printer from the allocation': s => s.replace('if (v) return as(v, `Printer Allocation', 'if (false) return as(v, `Printer Allocation'),
    'no printer from history': s => s.replace('const v = best && find(best.code);', 'const v = null;'),
    'a cancelled challan still gives the line away': s => s.replace("if (c.cancelled) return;   // a cancelled challan gave nothing to anybody", ''),
    'challan index never re-read': s => s.replace('if (FLOW_CHX.src === FLOW.ch) return FLOW_CHX.map;', 'if (FLOW_CHX.src) return FLOW_CHX.map;'),
  },
  'flow-edit.js': {
    'a changed accessory list keeps the old reservation': s => s.replace("if (s.res && accSig(old) !== accSig(nu))", 'if (false)'),
    'changed cloth keeps fabric ready': s => s.replace("if (fr && !fr.challan && fabSig(old) !== fabSig(nu))", 'if (false)'),
    'undo allowed with fabric on a challan': s => s.replace("if (flowFabLocked(s)) return `Its fabric", "if (false) return `Its fabric"),
    'undo leaves the reservation': s => s.replace(", ['pt_accReserve/' + s.key]: null };", ' };'),
    'edit after a receipt': s => s.replace("if (flowChHasRecv(c)) { $('flMsg').className = 'err'; $('flMsg').textContent = `${no} has fabric received against it — undo the receipt first.`; return; }", ''),
    'unticked line stays on the challan': s => s.replace("drop.forEach(l => { patch[`pt_flowDemand/${l.key}/fabricReady`] = null; });", ''),
    'edit gives a line to another printer': s => s.replace('if (other.length) return `${other.map(l =>', 'if (false) return `${other.map(l =>'),
    'cancel with no reason': s => s.replace("if (!why) return 'Say why it is cancelled.';", ''),
    'undo receipt keeps it closed': s => s.replace("if (c.closed && !c.closed.short) patch[", "if (false) patch["),
  },
  'flow-view.js': {
    'buttons for buckets not held': s => s.replace('$(\'flBuckets\').innerHTML = allowed.map(', '$(\'flBuckets\').innerHTML = FLOW_BUCKETS.map('),
    'no RFD stock angle': s => s.replace("if (ang === 'stock') $('flTable').innerHTML = FLOW.stock;", ''),
    'stock stacked above the lines again': s => s.replace("    if (ang === 'stock') $('flTable').innerHTML = FLOW.stock;", "    FLOW.panel += '<table>' + FLOW.stock + '</table>';"),
    'no red flag on a short line': s => s.replace('⚑ SHORT ${nf(c.short)} m', 'covered'),
    'test-only switch ignored on the lines': s => s.replace('const pass = x => (!only || x.r.__t) &&', 'const pass = x =>'),
    'test-only switch ignored in Demand history': s => s.replace("filter(c => !c.closed && !c.cancelled && (!only || flowIsTest(c.orderNo)))", 'filter(c => !c.closed && !c.cancelled)'),
    'challans still shown in Demand RFD': s => s.replace("$('flPanel').innerHTML = FLOW.panel;", "$('flPanel').innerHTML = FLOW.panel + (FLOW_VIEW === 'drfd' ? flowHistTable('') : '');"),
    'no Receive button on the fabric bucket': s => s.replace("x && x.s.challan && view === 'fabric' && !x.s.challan.closed", 'false'),
    'one challan button per PO again': s => s.replace("const pk = x.s.route === 'stitch' ? '' : (flowPlanPrinter(x.s) || '?'), gk = x.r.orderNo + '|' + pk;", "const pk = x.s.route === 'stitch' ? '' : (flowPlanPrinter(x.s) || '?'), gk = x.r.orderNo;"),
    'no "test view" warning': s => s.replace(' · TEST VIEW, not on the live app', ''),
  },
};
let bad = 0;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teeth-flow-'));
for (const [file, set] of Object.entries(breaks)) for (const [name, f] of Object.entries(set)) {
  FILES.forEach(x => fs.writeFileSync(path.join(tmpDir, x), read(x)));
  const src = read(file), t = f(src);
  if (t === src) { console.log('  COULD NOT BREAK IT (anchor missing): ' + file + ' · ' + name); bad++; continue; }
  fs.writeFileSync(path.join(tmpDir, file), t);
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'flow-test.js')], { env: Object.assign({}, process.env, { FLOW_DIR: tmpDir }), encoding: 'utf8', timeout: 60000 });
  const caught = r.status !== 0;
  console.log((caught ? '  BITES  ' : '  MISSED ') + file + ' · ' + name + (caught ? '' : ' — the suite still passed'));
  if (!caught) bad++;
}
console.log(bad ? `\n${bad} break(s) not caught` : '\nevery break was caught');
process.exit(bad ? 1 : 0);
