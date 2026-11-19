/* SMOOTH TO USE — the same screens, the same answers (18 Nov 2026).
 *   node tests/smooth-test.js            → compares the Listing screens drawn by the code of a commit (default HEAD) and by the code now
 *   node tests/smooth-test.js <commit>   → against another commit (before the speed work: 05c7f59 or a21b0a7)
 * The speed work changes only how often things are worked out and how the screen is drawn — never what it says. So on the full-size mock
 * catalogue (~4,400 listings, the biggest parent "Tablecloth Main" with 490 children — tests/smooth-bench.js) every screen is drawn by
 * BOTH versions of the files, the same way, and what they draw must be the very same text: Listing Health (Parent ASINs with every sort,
 * Child listings, the biggest parent open), every listing's checks (bucket, score, each finding with its level, detail, fix and tag),
 * the Workspace list and its side panel, the Season planner list and its biggest parent, Fix all's block, the Listing Errors card for
 * search terms, Listing History; and each number format gives the same text as toLocaleString('en-US').
 * Then the kept answers must follow the data: a listing changed (stock 0, a new title) is judged again, and the screens still match. */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { bigPage, healthPage } = require('./smooth-bench.js');

let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, info === undefined ? '' : '\n       ' + String(info).slice(0, 600)); } };
const firstDiff = (a, b) => { a = String(a); b = String(b); let i = 0; while (i < a.length && a[i] === b[i]) i++; return i >= a.length && i >= b.length ? '' : `at ${i}:\n       was …${a.slice(Math.max(0, i - 80), i + 120)}…\n       now …${b.slice(Math.max(0, i - 80), i + 120)}…`; };
const same = (name, a, b) => ok(name, a === b, firstDiff(a, b));

const REV = process.argv[2] || 'HEAD';
const ROOT = path.join(__dirname, '..', '..');
const DIR = 'Pricing-App/src/app/listing/';
const FILES = fs.readdirSync(path.join(__dirname, '..', 'src', 'app', 'listing')).filter(f => f.endsWith('.js'));
const old = {};
FILES.forEach(f => { try { old[f] = cp.execSync(`git show ${REV}:${DIR}${f}`, { cwd: ROOT, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8'); } catch (e) { /* new file */ } });
const changed = FILES.filter(f => old[f] !== undefined && old[f] !== fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', f), 'utf8'));
console.log(`== ${REV} → now: ${changed.length} listing file(s) differ: ${changed.join(', ') || '(none)'}`);

// Every listing's checks, as text: what each screen counts and shows.
const checksText = h => JSON.stringify([h.bucket, h.score, h.grade, h.stale, h.critical, h.action, h.review, h.notes, h.looks,
  h.found.map(x => [x.id, x.sev, x.detail, x.what, x.fix, x.tag, x.kind, x.src, x.stale])]);

/* ---- Listing Health: Parent ASINs, Child listings, the biggest parent, the Workspace and its panel ---- */
console.log('== Listing Health and the Workspace (healthPage, full size) ==');
{
  const A = healthPage({ files: old });
  const B = healthPage({});
  const both = fn => [fn(A), fn(B)];
  const html = (C, ...ids) => ids.map(id => C.el(id).innerHTML).join('\n§\n');
  // every listing's checks
  const all = C => ['SP', 'CPC'].flatMap(b => C.HEALTH[b].rows.map(r => checksText(C.healthOf(Object.assign({}, r, { brand: b }), C.hCtx())))).join('\n');
  const [ca, cb] = both(all);
  same(`every listing's checks (${A.HEALTH.SP.rows.length + A.HEALTH.CPC.rows.length} listings): bucket, score, each finding's level, detail, fix and tag`, ca, cb);
  // Parent ASINs, every column's sort both ways
  const draw = (C, view, sort, focus) => { C.setView(view); C.setSort(sort); C.setFocus(focus || null); C.renderHealth(); return html(C, 'hTable', 'hKpis', 'hFocus'); };
  const [pa, pb] = both(C => draw(C, 'parent', { k: 'critical', dir: -1 }));
  same('Parent ASINs: the table, the cards', pa, pb);
  const keys = A.getRender().defs.map(d => d.k);
  let sorted = true, first = '';
  keys.forEach(k => [-1, 1].forEach(dir => { const [x, y] = both(C => draw(C, 'parent', { k, dir })); if (x !== y && sorted) { sorted = false; first = k + ' ' + dir + ' ' + firstDiff(x, y); } }));
  ok(`Parent ASINs sorted by each of its ${keys.length} columns, both ways: the same rows in the same order`, sorted, first);
  const [kidA, kidB] = both(C => draw(C, 'child', { k: 'score', dir: 1 }));
  same('Child listings: the table, the cards', kidA, kidB);
  const ckeys = A.getRender().defs.map(d => d.k);
  let csorted = true, cfirst = '';
  ckeys.forEach(k => [-1, 1].forEach(dir => { const [x, y] = both(C => draw(C, 'child', { k, dir })); if (x !== y && csorted) { csorted = false; cfirst = k + ' ' + dir + ' ' + firstDiff(x, y); } }));
  ok(`Child listings sorted by each of its ${ckeys.length} columns, both ways`, csorted, cfirst);
  const [fa, fb] = both(C => draw(C, 'child', { k: 'sevRank', dir: -1 }, { brand: 'SP', parent: 'TM' }));
  same('the biggest parent open (490 children): its header card, counts and table', fa, fb);
  ok('…and it is the big one', (fa.match(/data-lk-row=/g) || []).length === 300 && /490/.test(fa), (fa.match(/data-lk-row=/g) || []).length);
  // drawing again with nothing changed gives the same (the kept checks)
  same('drawn again with nothing changed: the same', draw(B, 'child', { k: 'sevRank', dir: -1 }, { brand: 'SP', parent: 'TM' }), fb);
  // the Workspace list, and the panel of the biggest parent
  const ws = C => { C.LI_WS.on = true; C.LI_WS.mode = 'live'; C.liWsRender(); return C.el('liWs').innerHTML; };
  const [wa, wb] = both(ws);
  same('Workspace: the list (cards, chips, parents, problems, audit)', wa, wb);
  ['all', 'off'].forEach(mode => { const [x, y] = both(C => { C.LI_WS.mode = mode; C.liWsRender(); return C.el('liWs').innerHTML; }); same(`Workspace in "${mode}" mode`, x, y); });
  both(C => { C.LI_WS.mode = 'live'; C.liWsRender(); });
  const panel = (C, tab) => { C.LI_WS.panel = null; C.liWsPanelOpen('SP|TM'); if (tab) { C.LI_WS.panel.tab = tab; C.liWsPanelRender(); } return C.el('lsPanel').innerHTML; };
  ['list', 'fix', 'audit'].forEach(tab => { const [x, y] = both(C => panel(C, tab)); same(`Workspace panel of the biggest parent, tab "${tab}"`, x, y); });
  // a listing changes: the kept checks follow it (stock to 0, a new title, an Amazon read landing)
  const change = C => {
    const r0 = C.HEALTH.SP.rows[0], r1 = C.HEALTH.SP.rows[1], r2 = C.HEALTH.SP.rows[2];
    r0.qty = 0;
    r1.title = 'Ridhi Tablecloth';
    C.LI_WS.live.SP[r2.sku] = Object.assign({}, C.LI_WS.live.SP[r2.sku], { at: Date.now(), cAt: Date.now(), title: 'Ridhi Rectangle Tablecloth', catTitle: 'Ridhi Rectangle Tablecloth', titleLen: 26 });
    C.LI_WS.liveV++;
    return [r0, r1, r2].map(r => checksText(C.healthOf(Object.assign({}, r, { brand: 'SP' }), C.hCtx()))).join('\n');
  };
  const [xa, xb] = both(change);
  same('a listing changed (stock 0, a new title, a new Amazon read): its checks are judged again — the same as before the speed work', xa, xb);
  const [ya, yb] = both(C => draw(C, 'parent', { k: 'critical', dir: -1 }));
  same('…and Parent ASINs after the change', ya, yb);
  const [za, zb] = both(C => draw(C, 'child', { k: 'sevRank', dir: -1 }, { brand: 'SP', parent: 'TM' }));
  same('…and the biggest parent after the change', za, zb);
  const [qa, qb] = both(ws);
  same('…and the Workspace after the change', qa, qb);
}

/* ---- the Season planner, Fix all, the Listing Errors search-terms card, Listing History (bigPage, full size) ---- */
console.log('== Season planner, Fix all, Listing Errors card, Listing History (bigPage, full size) ==');
{
  const A = bigPage({ files: old });
  const B = bigPage({});
  const both = fn => [fn(A), fn(B)];
  const html = (C, ...ids) => ids.map(id => C.el(id).innerHTML).join('\n§\n');
  const plan = C => { C.SP.on = true; C.spRender(); return html(C, 'spPane'); };
  const [sa, sb] = both(plan);
  same('Season planner: the parent list', sa, sb);
  const open = C => { C.SP.panel = null; C.spOpenParent('SP|TM'); return html(C, 'spPane', 'spPanel', 'spKid'); };
  const [oa, ob] = both(open);
  same('Season planner: the biggest parent open (490 children)', oa, ob);
  const items = C => C.spCompute().map(it => JSON.stringify([it.brand, it.sku, it.kind, it.after || null, it.kwAfter || null, it.kwOver || false, (it.checks || []).map(c => [c.k, c.ok, c.t])])).join('\n');
  const [ia, ib] = both(items);
  same('Season planner: every listing\'s plan', ia, ib);
  const [ba, bb] = both(C => C.faBlockHtml('SP', 'TM'));
  // 19 Nov 2026: a title row's button says its OWN count ("Fix 12 titles", was the family's "Fix all 490 children") — that button
  // alone is set aside here; everything else of the block must be the same
  const ttBtn = h => h.replace(/<button type="button" class="fa-btn fa-main" data-fa-act="fix" data-fa-row="[^"]*"[^>]*title="One new title for each[^"]*">Fix (?:all [\d,]+ child(?:ren)?|[\d,]+ titles?)<\/button>/g, '[title button]');
  same('Fix all: the block of the biggest parent (cards, rows, Fix all counts — the title rows\' button aside)', ttBtn(ba), ttBtn(bb));
  const nBtn = h => (ttBtn(h).match(/\[title button\]/g) || []).length;
  ok('…the title rows\' buttons are there in both, now with each row\'s own count', nBtn(ba) > 0 && nBtn(ba) === nBtn(bb) && (bb.match(/>Fix [\d,]+ titles?</g) || []).length === nBtn(bb), nBtn(ba) + ' vs ' + nBtn(bb));
  const [ka, kb] = both(C => (typeof C.kfLeCardHtml === 'function' ? C.kfLeCardHtml('SP', null) + C.kfLeCardHtml('CPC', null) : ''));
  same('Listing Errors: the "Search terms over the limit" card, both brands', ka, kb);
  const hist = C => {
    const now = Date.now();
    C.LH.rows = Array.from({ length: 300 }, (_, i) => ({ id: 'h' + i, kind: 'listing', at: now - i * 3600000, by: 'a@b.c', name: ['Asha', 'Ravi'][i % 2], approvedBy: '', brand: 'SP', sku: 'SP-' + String(i).padStart(5, '0'), asin: 'B0' + i,
      label: 'Title', field: 'item_name', old: 'old ' + i, new: 'new ' + i, attr: 'item_name', api: 'patch', screen: ['ws', 'sp'][i % 2], run: i % 10 < 4 ? 'r' + Math.floor(i / 10) : '', runN: i % 10 < 4 ? 4 : 0, result: ['sent', 'live', 'error'][i % 3], why: '', doc: 'd' }));
    C.lhBuild(false); C.lhDraw();
    return html(C, 'lhPane');
  };
  const [la, lb] = both(hist);
  same('Listing History: the page (groups, counts, results)', la, lb);
}

/* ---- the number formats: one Intl.NumberFormat per file instead of toLocaleString('en-US') per number ---- */
console.log('== number formats ==');
{
  const NUM = new Intl.NumberFormat('en-US');
  const vals = [0, 1, 7, 12, 999, 1000, 1234, 12345.678, 1e6, 4400, -3, -1234.5, 0.5, 2.25, 1 / 3, 1e21, NaN, Infinity, -Infinity, null, undefined, '', '42', '1234.5'];
  ok('Intl.NumberFormat("en-US") gives the same text as toLocaleString("en-US") for every kind of number (whole, decimal, negative, huge, NaN, ∞, text)',
    vals.every(v => NUM.format(Number(v || 0)) === Number(v || 0).toLocaleString('en-US') && NUM.format(Math.round(Number(v) || 0)) === Math.round(Number(v) || 0).toLocaleString('en-US')),
    vals.filter(v => NUM.format(Number(v || 0)) !== Number(v || 0).toLocaleString('en-US')).join(', '));
  const now = FILES.map(f => fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', f), 'utf8')).join('\n');
  ok('every changed formatter is a shared Intl.NumberFormat("en-US")', ['SP_NUM', 'FC_NUM', 'FA_NUM', 'KF_NUM', 'LH_NUM', 'SQ_NUM', 'BSR_NUM', 'LE_NUM', 'H_NUM']
    .every(n => new RegExp(`const ${n} = new Intl\\.NumberFormat\\('en-US'\\);`).test(now)));
}

/* ---- nothing new talks to Amazon or the backend ---- */
console.log('== no new calls ==');
{
  const calls = s => (s.match(/\b(baCall|imPost|fetch|getDoc|getDocs|setDoc|lsGet|lsSave)\(/g) || []).length;
  const was = changed.reduce((n, f) => n + calls(old[f]), 0);
  const now = changed.reduce((n, f) => n + calls(fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', f), 'utf8')), 0);
  ok(`the changed files hold exactly as many backend / Amazon / database calls as before (${was})`, was === now, `${was} → ${now}`);
}

/* ---- the kept checks follow the clock exactly: an Error turns "Error? Check again" the moment its data is LR_STALE_DAYS old ---- */
(async () => {
  console.log('== kept checks and the clock ==');
  const C = healthPage({});
  const src = C.HEALTH.SP.rows.find(r => /inactive/i.test(r.status) && r.qty > 0);
  const row = Object.assign({}, src, { brand: 'SP' });
  C.HEALTH.SP.at = new Date(Date.now() - C.LR_STALE_DAYS * C.LR_DAY + 1500);   // the listings report turns 7 days old in 1.5 s
  C.reset();
  const hitOf = h => h.found.find(x => x.detector === 'inactive_with_stock');
  const h1 = C.hHealthKept(src, row, C.hCtx(), Date.now());
  ok('a stock-but-Inactive listing on a report 1.5 s short of 7 days old: an Error, not yet "Error? Check again"', !!hitOf(h1) && hitOf(h1).sev === 'critical' && !hitOf(h1).stale, JSON.stringify(hitOf(h1)));
  ok('…kept: the same answer again a moment later', C.hHealthKept(src, row, C.hCtx(), Date.now()) === h1);
  ok('…kept exactly until the moment its data turns 7 days old', C.hHealthUntil(h1, Date.now()) === C.HEALTH.SP.at.getTime() + C.LR_STALE_DAYS * C.LR_DAY + 1);
  await new Promise(resolve => setTimeout(resolve, 2000));
  const h3 = C.hHealthKept(src, row, C.hCtx(), Date.now());
  ok('two seconds later it is judged again: "Error? Check again", exactly what healthOf says now', h3 !== h1 && hitOf(h3).stale === true
    && checksText(h3) === checksText(C.healthOf(row, C.hCtx())), JSON.stringify(hitOf(h3)));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
