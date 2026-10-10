/* TEETH for tests/flow-test.js: break the production flow's rules on purpose; the suite must fail every time.
 *   node tests/teeth/teeth-flow.js */
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const DIR = path.join(__dirname, '..', '..', 'src', 'app', 'flow');
const FILES = ['flow-core.js', 'flow-ppc.js', 'flow-demand.js', 'flow-view.js'];
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
const breaks = {
  'flow-core.js': {
    'on for the live app too': s => s.replace("return /--/.test(location.hostname) ||", 'return true ||'),
    'every account sees every bucket': s => s.replace('const flowBucketsAllowed = () => (ME.admin ? FLOW_BUCKETS :', 'const flowBucketsAllowed = () => (true ? FLOW_BUCKETS :'),
    'old orders go into PPC too': s => s.replace("const isNew = String(ptIsoDate(r.orderDate) || '') >= flowFrom();", 'const isNew = true;'),
    'Demand ignores the accessories': s => s.replace('s.needAcc = isNew && accNeed && !res;', 's.needAcc = false;'),
    'an outsourced line still waits in Demand': s => s.replace("const accNeed = !!p && route !== 'outsource' &&", 'const accNeed = !!p &&').replace("s.needFab = isNew && !!p && route !== 'outsource' &&", 's.needFab = isNew && !!p &&').replace("    : (route === 'outsource') ? (s.india < qty ? 'out' : 'done')", '    : false ? 0'),
    'stitching only goes to the printer': s => s.replace("const printed = p ? route === 'inhouse' :", "const printed = p ? !!(p.print && p.print.need) :"),
    'the two Demand lists are one': s => s.replace("const flowInView = (view, s) => view === 'drfd' ? s.bucket === 'demand' && s.needFab", "const flowInView = (view, s) => view === 'drfd' ? s.bucket === 'demand'"),
    'cut figures not capped at the order': s => s.replace('const cap = n => Math.max(0, Math.min(qty, +n || 0));', 'const cap = n => Math.max(0, +n || 0);'),
    'made ignores the press': s => s.replace('made: Math.max(cap(r.pressed), q ? cap(q.ok) : 0)', 'made: q ? cap(q.ok) : 0'),
    'done lines stay listed': s => s.replace("if (s.bucket === 'done' && !recent) return;", ''),
    'rows never worked out again': s => s.replace('&& FLOW_C.ppc === FLOW.ppc ', ''),
  },
  'flow-ppc.js': {
    'a plan with no fabric is saved': s => s.replace('if (noFab.length) return', 'if (false) return'),
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
    'ready lines do not hold their cloth': s => s.replace('F(name).held += +fr.metres || +(p.fabric && p.fabric.metres) || 0;', 'F(name).held += 0;'),
    'every line sees the whole stock (no oldest-first)': s => s.replace('avail = Math.max(0, f.stock - f.held - f.need);', 'avail = Math.max(0, f.stock - f.held);'),
    'part of the fabric is "ready"': s => s.replace('if (!undo && need && metres < need) return', 'if (false) return'),
  },
  'flow-view.js': {
    'buttons for buckets not held': s => s.replace('$(\'flBuckets\').innerHTML = allowed.map(', '$(\'flBuckets\').innerHTML = FLOW_BUCKETS.map('),
    'no RFD stock panel': s => s.replace("if (fs.length) FLOW.panel =", "if (false) FLOW.panel ="),
    'no red flag on a short line': s => s.replace('⚑ SHORT ${nf(c.short)} m', 'covered'),
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
