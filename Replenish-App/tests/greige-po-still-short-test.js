/* RAISE PO FOR PPC, CHECKED AGAIN AT SAVE (src/app/flow/greige-desk.js — gdPoFor, gdPpcStillShort, gdPpcAskPending, poSave).
 * Ravi, 26 Nov: two people raised a greige PO for the same PPC shortage. Switch "lineHold" on: before such a PO is saved the desk's
 * POs are read again; if somebody else has since put that greige on order, the person is asked whether they still want it.
 * Cases are made up.
 *   node tests/greige-po-still-short-test.js      (GD_FILE=<a copy of greige-desk.js> tests that copy) */
const fs = require('fs'), path = require('path'), vm = require('vm');
const FILE = process.env.GD_FILE || path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
const SRC = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
function cut(re) { const i = SRC.search(re); if (i < 0) throw new Error(re + ' not found'); return SRC.slice(i, SRC.indexOf('\n}', i) + 2); }
const tick = () => new Promise(r => setTimeout(r, 5));

const HISTORY = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'core', 'history.js'), 'utf8').replace(/\r\n/g, '\n');
const lineHoldOn = HISTORY.slice(HISTORY.search(/^function lineHoldOn\(/m), HISTORY.indexOf('\n}', HISTORY.search(/^function lineHoldOn\(/m)) + 2);

(async () => {
  /* One PC at the desk. PPC needs 1,000 m of greige for Made-up Voil; each PO on order for it covers that much less.
   * lineHoldOn lives in core/history.js; the desk sees it as the app does. */
  const make = o => {
    const asked = [], said = [], saved = [], boxes = {};
    const ctx = {
      JSON, Object, Array, String, Promise, nf: String,
      GD_NODE: 'pt_gdTest', GD_SNAP: { gpo: {} }, DB: { gpo: (o.mine || []).map(p => Object.assign({}, p)) },
      localStorage: { getItem: k => (k === 'lineHold' && !o.off ? '1' : null) },
      ptGetFresh: async () => { await new Promise(r => setTimeout(r, 1)); if (o.readFails) throw new Error('read 503'); return JSON.parse(JSON.stringify(o.db || null)); },
      gdPpcMap: () => (o.loading ? { __loading: true } : { 'MADE-UP VOIL': { greigeM: Math.max(0, 1000 - ctx.DB.gpo.reduce((t, p) => t + p.metres, 0)) } }),
      console: { warn: m => { said.push('console: ' + m); }, log: console.log },
      confirm: q => { asked.push(q); return o.answer; }, lmSay: (k, t) => { said.push(t); }, poDraw: () => {},
      $: id => boxes[id] || (boxes[id] = { textContent: '', classList: { remove: () => {}, contains: () => !!o.closed } }),
      PO_DRAFT: { lines: [], editId: o.edit ? 'po-old' : null, ppcAsk: o.noAsk ? null : { rfd: 'Made-up Voil', greige: 'Made-up Greige', metres: o.askM || 1000 } },
    };
    vm.createContext(ctx);
    vm.runInContext(lineHoldOn + '\n' + cut(/^async function gdPpcStillShort\(/m) + '\n' + cut(/^function gdPpcAskPending\(/m), ctx);
    ctx.poSave = after => { saved.push(after); if (ctx.gdPpcAskPending(after)) return; saved.push('written'); };
    return { ctx, asked, said, saved, err: () => (boxes.lmPoErr || {}).textContent || '' };
  };
  const OTHER = { other: { id: 'other', poNo: 'RIDHI/PO/GREIG/009', metres: 700 } };

  console.log('== nobody else raised one ==');
  { const d = make({ db: {} }); d.ctx.poSave('doc'); await tick();
    ok('the PO is raised, nobody is asked', d.asked.length === 0 && d.saved.includes('written'), JSON.stringify(d.saved)); }

  console.log('== somebody raised one for the same shortage meanwhile ==');
  { const d = make({ db: OTHER, answer: false }); d.ctx.poSave('doc'); await tick();
    ok('the person is asked, with how much is now on order and how much PPC still needs', d.asked.length === 1 && /700 m of Made-up Greige/.test(d.asked[0]) && /short 300 m/.test(d.asked[0]), d.asked[0]);
    ok('…"no": nothing is raised and the form says so', !d.saved.includes('written') && /Not raised/.test(d.said.join(' ')), JSON.stringify(d.saved));
    ok('…the other PO is now on this desk, and will not be written again', d.ctx.DB.gpo.some(p => p.id === 'other') && !!d.ctx.GD_SNAP.gpo.other); }
  { const d = make({ db: OTHER, answer: true }); d.ctx.poSave('doc'); await tick();
    ok('…"yes": the PO is raised once, the question asked once', d.saved.filter(x => x === 'written').length === 1 && d.asked.length === 1, JSON.stringify(d.saved)); }
  { const d = make({ db: { other: { id: 'other', metres: 1000 } }, answer: false }); d.ctx.poSave(); await tick();
    ok('the shortage is now fully covered: the question says PPC is short nothing', /short nothing/.test(d.asked[0] || ''), d.asked[0]); }
  { const d = make({ db: OTHER, mine: [{ id: 'other', metres: 700 }], askM: 300 }); d.ctx.poSave(); await tick();   // it opened Raise PO for the 300 m still short
    ok('a PO this screen already knew is not counted twice', d.asked.length === 0 && d.ctx.DB.gpo.length === 1 && d.saved.includes('written')); }

  console.log('== Save pressed twice, or the form changed, while the check runs ==');
  { const d = make({ db: OTHER, answer: true }); d.ctx.poSave('doc'); d.ctx.poSave('doc'); await tick(); await tick();
    ok('Save pressed twice while the POs are being read: one question, one PO', d.saved.filter(x => x === 'written').length === 1 && d.asked.length === 1, JSON.stringify(d.saved) + ' asked ' + d.asked.length); }
  { const d = make({ db: OTHER, answer: true }); d.ctx.poSave(); const other = { lines: [], editId: null, ppcAsk: { rfd: 'Made-up Voil', greige: 'G', metres: 500 } };
    d.ctx.PO_DRAFT = other; await tick();
    ok('Raise PO for another fabric while the first was being checked: the answer is dropped, the new PO keeps its own check', !d.saved.includes('written') && d.asked.length === 0 && other.ppcAsk && other.ppcAsk.metres === 500, JSON.stringify(d.saved)); }
  { const d = make({ db: OTHER, answer: true, closed: true }); d.ctx.poSave(); await tick();
    ok('the PO form closed while it was being checked: nothing is raised', !d.saved.includes('written') && d.asked.length === 0); }
  { const d = make({ db: OTHER, loading: true }); d.ctx.poSave(); await tick();
    ok('PPC figures not loaded yet: raised without the question, and the console says why', d.saved.includes('written') && d.said.some(s => /console: .*without the still-short check/.test(s)), JSON.stringify(d.said)); }
  { const d = make({ readFails: true }); d.ctx.poSave(); await tick();
    ok('after a failed read Save can be pressed again', d.ctx.PO_DRAFT.ppcAsk && !d.ctx.PO_DRAFT.ppcAsk.busy); }

  console.log('== fails loudly ==');
  { const d = make({ readFails: true }); d.ctx.poSave(); await tick();
    ok('the POs cannot be read: nothing raised, the form says why and what to do', !d.saved.includes('written') && /Not raised/.test(d.err()) && /503/.test(d.err()) && /press Save again/.test(d.err()), d.err()); }

  console.log('== only where it belongs ==');
  { const d = make({ db: OTHER, edit: true }); d.ctx.poSave(); await tick();
    ok('changing an existing PO is not asked', d.asked.length === 0 && d.saved.includes('written')); }
  { const d = make({ db: OTHER, noAsk: true }); d.ctx.poSave(); await tick();
    ok('a PO typed by hand (not from Raise PO) is not asked', d.asked.length === 0 && d.saved.includes('written')); }
  { const d = make({ db: OTHER, off: true }); d.ctx.poSave(); await tick();
    ok('switch off: raised as it always was', d.asked.length === 0 && d.saved.includes('written')); }
  ok('Raise PO remembers the shortage on the PO it opens', /PO_DRAFT\.ppcAsk = \{ rfd: rfd, greige: greige, metres: metres \}/.test(SRC));
  ok('the PO is checked after the form is found complete, before it is written, and the note is not saved on the PO',
    /classList\.remove\('hide'\); return; \}\n  if \(gdPpcAskPending\(after\)\) return;\n  var po = JSON\.parse\(JSON\.stringify\(PO_DRAFT\)\);\n  delete po\.ppcAsk;/.test(SRC));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
