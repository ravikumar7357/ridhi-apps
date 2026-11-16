/* Family & Category Check (src/app/listing/family-check.js) over the real file in a stub page.
 *   node tests/family-check-test.js
 * Only live children (buyable AND stock > 0) · Not in family + the suggested family · Removed on purpose hides it for good and is saved
 * (who / when / reason) · Undo brings it back · a linked or no-longer-live child leaves every list · duplicate / missing / different theme ·
 * the fixes go through sqSendWithCheck · "Fix by hand" opens Listing Errors · the CSV holds red problems only · ratings · other screens unchanged. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'listing', 'family-check.js'), 'utf8');

// The sample: a tablecloth family RTC14-1…6 (parent RTC14-P), a child left out of it (RTC14-7), children that are not live, a product of its own.
function sample() {
  const T = c => `Ridhi Block Print Tablecloth Rectangle 60x90 Inch Floral - ${c}`;
  const it = (sku, o) => Object.assign({ sku, asin: 'B0' + sku.replace(/\W/g, ''), st: 'BUYABLE,DISCOVERABLE', pt: 'TABLECLOTH', t: T(o && o.c || ''), lvl: 'child', psku: 'RTC14-P', c: '', z: '60x90' }, o || {});
  const items = [
    { sku: 'RTC14-P', asin: 'BPARENT14', st: 'DISCOVERABLE', pt: 'TABLECLOTH', t: 'Ridhi Block Print Tablecloth Rectangle', lvl: 'parent' },
    it('RTC14-1', { c: 'Blue' }), it('RTC14-2', { c: 'Red' }), it('RTC14-3', { c: 'White' }), it('RTC14-4', { c: '' }),
    it('RTC14-5', { c: 'Grey' }), it('RTC14-6', { c: 'Grey' }),
    it('RTC14-7', { c: 'Yellow', psku: '', lvl: '' }),                                  // live, no parent: belongs to RTC14
    it('RTC14-8', { c: 'Pink', psku: '', lvl: '' }),                                    // no parent, but no stock: not live
    it('RTC14-9', { c: 'Lime', psku: '', lvl: '', st: 'DISCOVERABLE' }),                // no parent, not buyable: not live
    it('RTC14-10', { c: 'Blue' }),                                                       // same colour as RTC14-1, but no stock: not live
    { sku: 'ZZ-100', asin: 'B0ZZ100', st: 'BUYABLE,DISCOVERABLE', pt: 'PILLOW', t: 'Velvet cushion cover 18x18', lvl: '', c: 'Blue', z: '18x18' },   // a product of its own
  ];
  const qty = { 'RTC14-8': 0, 'RTC14-10': 0 };
  const rows = items.filter(i => i.lvl !== 'parent').map(i => ({ sku: i.sku, asin: i.asin, parent: '', title: i.t, qty: qty[i.sku] != null ? qty[i.sku] : 5, status: 'Active' }));
  return { items, rows };
}
// Amazon's answers to ?lfix=get: the variation theme (parent SIZE/COLOR, RTC14-3 COLOR only) and the values.
const THEME = { 'RTC14-P': 'SIZE/COLOR', 'RTC14-3': 'COLOR' };

function setup(opts) {
  opts = opts || {};
  const store = opts.store || {};
  const els = {};
  const el = id => els[id] || (els[id] = { id, value: '', innerHTML: '', textContent: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, querySelector: () => null, querySelectorAll: () => [], scrollIntoView() {} });
  const S = sample();
  const IML = { SP: { at: new Date(Date.now() - 3600e3), items: S.items }, CPC: { at: new Date(Date.now() - 3600e3), items: [] } };
  const HEALTH = { SP: { at: new Date(), rows: S.rows }, CPC: { at: new Date(), rows: [] } };
  const LR_CAT = { SP: { 'RTC14-4': { color: 'Green', size: '60x90' }, 'RTC14-5': { color: 'Grey', size: '60x90' }, 'RTC14-6': { color: 'Black', size: '60x90' } }, CPC: {} };
  const sends = [], calls = [], reads = [];
  const amazon = sku => {
    const i = S.items.find(x => x.sku === sku) || {};
    const at = {};
    if (i.c) at.color = [{ value: i.c, language_tag: 'en_US', marketplace_id: 'M' }];
    if (i.z) at.size = [{ value: i.z, language_tag: 'en_US', marketplace_id: 'M' }];
    const th = THEME[sku] || (i.lvl === 'child' ? 'SizeName-ColorName' : '');
    if (th) at.variation_theme = [{ name: th, marketplace_id: 'M' }];
    if (i.psku) at.child_parent_sku_relationship = [{ child_relationship_type: 'variation', parent_sku: i.psku, marketplace_id: 'M' }];
    if (i.lvl) at.parentage_level = [{ value: i.lvl, marketplace_id: 'M' }];
    return { ok: true, sku, productType: i.pt || '', attributes: at, issues: [] };
  };
  const mem = {};
  const ctx = {
    $: el, document: { addEventListener() {}, querySelectorAll: () => [], createElement: () => ({ click() {} }) }, window: { scrollTo() {}, __TEST_ERP: !!opts.test },
    MutationObserver: class { observe() {} }, localStorage: { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = v; } }, setTimeout: fn => { fn(); return 0; }, clearTimeout() {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: class { constructor(p) { this.p = p; } },
    BRAND_NAME: { SP: 'Ridhi', CPC: 'CPC' }, IML, HEALTH, LR_CAT, H_LOADED: true, ME: { email: 'vishesh.g@example.com', tabs: ['health'] },
    parentName: (b, asin, fallback) => (asin === 'BPARENT14' ? 'Floral Tablecloth' : fallback),
    baCall: async q => { reads.push(q.sku); if (q.lfix === 'get') return amazon(q.sku); return {}; },
    lsGet: async (coll, id) => (opts.test ? null : store[coll + '/' + id] ? JSON.parse(JSON.stringify(store[coll + '/' + id])) : null),
    lsSave: async (coll, id, data) => {
      if (opts.test) return false;
      const k = coll + '/' + id, cur = store[k] || {};
      store[k] = Object.assign({}, cur, data, { items: Object.assign({}, cur.items || {}, data.items || {}) });
      return true;
    },
    sqSendWithCheck: (jobs, o) => { sends.push({ jobs, opts: o }); return Promise.resolve({}); },
    sqName: e => String(e || '').split('@')[0].split(/[._-]+/).map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
    sqValText: v => (Array.isArray(v) ? v.map(e => e.value || e.name || e.parent_sku || '').join(' · ') : ''),
    showTab: t => calls.push({ tab: t }), leOnly: (skus, label) => calls.push({ leOnly: skus, label }), leShow() {}, leListEnsure() {},
  };
  const tail = '\n;return { FC, fcBuild, fcSuggest, fcProblems, fcTheme, fcStem, fcAlike, fcRating, fcLowRated, fcDrawAll, fcOpen, fcOkSet, fcOkUndo, fcOkLoad, fcLink, fcSetValue, fcAfterSend,'
    + ' fcOpenLerr, fcCsv, fcReadThemes, fcGroups, fcCount, fcClick, FC_CSV_COLS };';
  const C = new Function(...Object.keys(ctx), SRC + tail)(...Object.values(ctx));
  return Object.assign(C, { el, store, sends, calls, reads, S, IML, HEALTH, LR_CAT, mem });
}
const flush = () => new Promise(r => setImmediate(r));
const rowsOf = v => v.groups.flatMap(g => g.rows);
const probOf = (v, sku, k) => { const r = rowsOf(v).find(x => x.c.sku === sku); return r ? r.probs.find(p => p.k === k) || null : null; };

(async () => {
  console.log('== the small rules ==');
  {
    const C = setup();
    ok('theme as a key: SIZE/COLOR = SizeName-ColorName = color_size', C.fcTheme('SIZE/COLOR') === 'COLOR+SIZE' && C.fcTheme('SizeName-ColorName') === 'COLOR+SIZE' && C.fcTheme('color_size') === 'COLOR+SIZE', C.fcTheme('SizeName-ColorName'));
    ok('theme COLOR is not COLOR+SIZE', C.fcTheme('COLOR') === 'COLOR');
    ok('SKU stem: RTC14-7 → RTC14, R-CP-351 → R-CP', C.fcStem('RTC14-7') === 'RTC14' && C.fcStem('R-CP-351') === 'R-CP');
  }

  console.log('== RULE 1: only live children ==');
  const A = setup();
  await A.fcOpen();
  let v = A.FC.view;
  {
    const html = A.el('fcBody').innerHTML;
    ok('live = buyable AND stock > 0: 8 of 12 children (RTC14-8 no stock, RTC14-9 not buyable, RTC14-10 no stock out)', v.live === 8 && v.all === 11, `live ${v.live} all ${v.all}`);
    ok('the not-live ones are never shown', !/RTC14-8|RTC14-9|RTC14-10/.test(html) && !/RTC14-8|RTC14-9|RTC14-10/.test(strip(A.fcCsv(v).text)), strip(html).slice(0, 300));
    ok('a not-live child with the same colour as RTC14-1 makes no duplicate', !probOf(v, 'RTC14-1', 'dup'));
    ok('the meta line says live children only', /Live children only \(buyable and in stock\): 8 of 11/.test(A.el('fcMeta').innerHTML), A.el('fcMeta').innerHTML);
  }

  console.log('== RULE 2: Not in family ==');
  {
    const p = probOf(v, 'RTC14-7', 'orphan');
    ok('RTC14-7 is "Not in family" (red) with the suggested family RTC14-P', p && p.sev === 'r' && p.fix.kind === 'link' && /RTC14-P/.test(p.fix.text), JSON.stringify(p));
    ok('…and why: the SKU, the title, the product type', p && /SKU like 6 children/.test(p.text) && /title matches/.test(p.text) && /same product type/.test(p.text), p && p.text);
    ok('a product of its own (ZZ-100) is no error', !rowsOf(v).some(r => r.c.sku === 'ZZ-100'));
    ok('card "Not in family" = 1', A.fcCount(v, 'orphan') === 1);
    ok('the row has [Link to family] and [Removed on purpose]', /data-fc="link"[^>]*data-fc-s="RTC14-7"/.test(A.el('fcBody').innerHTML) && /data-fc="ok"[^>]*data-fc-s="RTC14-7"/.test(A.el('fcBody').innerHTML));
    ok('ratings: none in Sellora\'s data — reported on the page', v.ratingFound === 0 && /ratings: none in Sellora/.test(A.el('fcMeta').innerHTML));
  }

  console.log('== duplicate, missing, different theme ==');
  {
    ok('RTC14-5 and RTC14-6: same colour + size (red)', probOf(v, 'RTC14-5', 'dup') && probOf(v, 'RTC14-6', 'dup') && /RTC14-5/.test(probOf(v, 'RTC14-6', 'dup').text));
    ok('the catalogue gives RTC14-6 another colour → [Set colour/size] "Black"', probOf(v, 'RTC14-6', 'dup').fix.kind === 'set' && probOf(v, 'RTC14-6', 'dup').fix.set.color === 'Black');
    ok('RTC14-5 already holds its catalogue colour → Fix by hand', probOf(v, 'RTC14-5', 'dup').fix.kind === 'hand');
    ok('RTC14-4 has no colour (judged from the siblings before the theme is read) → Set colour "Green"', probOf(v, 'RTC14-4', 'missing') && /theme not read yet/.test(probOf(v, 'RTC14-4', 'missing').text) && probOf(v, 'RTC14-4', 'missing').fix.set.color === 'Green');
    ok('no theme problem before the themes are read', A.fcCount(v, 'theme') === 0);
    const n = A.fcReadThemes('');
    await flush(); await flush(); await flush();
    v = A.FC.view;
    ok('Read variation themes: the parent and every live child of the family (8 reads), nothing not live', n === 8 && !A.reads.some(s => /RTC14-(8|9|10)/.test(s)), `${n} ${A.reads.join()}`);
    const t = probOf(v, 'RTC14-3', 'theme');
    ok('RTC14-3: "Different theme" (yellow) — COLOR, the family uses SIZE/COLOR', t && t.sev === 'y' && /COLOR; the family uses SIZE\/COLOR/.test(t.text) && t.fix.kind === 'hand', t && t.text);
    ok('the siblings written SizeName-ColorName are the same theme', !probOf(v, 'RTC14-1', 'theme') && !probOf(v, 'RTC14-2', 'theme'));
    ok('after the read the missing colour names the theme', /the theme is SIZE\/COLOR/.test(probOf(v, 'RTC14-4', 'missing').text));
    ok('the reads are kept in this browser', !!A.mem.fcReads1 && /RTC14-3/.test(A.mem.fcReads1));
    const csv = A.fcCsv(v);
    ok('CSV: red problems only (orphan 1 + dup 2 + missing 1 = 4 lines, no theme line)', csv.n === 4 && !/Theme COLOR/.test(csv.text) && csv.text.split('\r\n')[0].replace('﻿', '') === A.FC_CSV_COLS.join(','), csv.n + ' ' + csv.text);
    A.fcClick({ dataset: { fc: 'card', fcV: 'theme' } });
    ok('a card is a filter: Different theme shows only RTC14-3', A.fcGroups(v).flatMap(g => g.rows).map(r => r.c.sku).join() === 'RTC14-3');
    A.fcClick({ dataset: { fc: 'card', fcV: 'theme' } });
    ok('…clicked again: everything', A.fcGroups(v).flatMap(g => g.rows).length === 5);
  }

  console.log('== the fixes go through sqSendWithCheck ==');
  {
    await A.fcLink('SP', 'RTC14-7');
    const s = A.sends[0];
    const body = s && s.jobs[0].body;
    ok('Link to family → one sqSendWithCheck job, screen "Family Check"', A.sends.length === 1 && s.opts.screen === 'Family Check' && body.lfix === 'patch' && body.productType === 'TABLECLOTH');
    ok('…parentage child, parent SKU RTC14-P, the parent\'s theme SIZE/COLOR', JSON.stringify(body.patches.map(p => p.path)) === JSON.stringify(['/attributes/parentage_level', '/attributes/child_parent_sku_relationship', '/attributes/variation_theme'])
      && body.patches[1].value[0].parent_sku === 'RTC14-P' && body.patches[2].value[0].name === 'SIZE/COLOR', JSON.stringify(body.patches));
    ok('…the popup lists the changes with the old values (for Put back)', s.jobs[0].changes.length === 3 && s.jobs[0].changes.every(c => Array.isArray(c.oldV)));
    await A.fcSetValue('SP', 'RTC14-4', 'missing');
    const s2 = A.sends[1];
    ok('Set colour/size → sqSendWithCheck with color "Green" (the catalogue\'s), the language kept', s2 && s2.jobs[0].body.patches.length === 1 && s2.jobs[0].body.patches[0].path === '/attributes/color' && s2.jobs[0].body.patches[0].value[0].value === 'Green' && s2.jobs[0].body.patches[0].value[0].language_tag === 'en_US');
    ok('a Fix by hand problem has no send — fcSetValue does nothing for RTC14-5', (await A.fcSetValue('SP', 'RTC14-5', 'dup')) === null && A.sends.length === 2);
    A.fcOpenLerr('SP', 'RTC14-3');
    ok('Open in Listing Errors: that one SKU, then the Listing Errors tab', A.calls.some(c => c.leOnly && c.leOnly.join() === 'RTC14-3') && A.calls.some(c => c.tab === 'lerr'));
    ok('every send button on the page is a fix that goes through those two functions', !/imPost|baCall\(\{ lfix: 'patch'|limg: 'patch'/.test(SRC));
    A.fcAfterSend({ jobs: [{ state: 'accepted' }] }, 'SP|RTC14-4', { color: 'Green' });
    ok('accepted: RTC14-4 has its colour and leaves the list', !probOf(A.FC.view, 'RTC14-4', 'missing'));
  }

  console.log('== RULE 3: Removed on purpose ==');
  const B = setup();
  await B.fcOpen();
  {
    await B.fcOkSet('SP', 'RTC14-7', 'low rating');
    v = B.FC.view;
    const html = B.el('fcBody').innerHTML;
    ok('the child leaves the red list at once', !probOf(v, 'RTC14-7', 'orphan') && B.fcCount(v, 'orphan') === 0);
    ok('saved with who / when / reason in listingrules/famok_SP', (() => { const e = (B.store['listingrules/famok_SP'] || { items: {} }).items['RTC14-7']; return e && e.on && e.by === 'vishesh.g@example.com' && e.name === 'Vishesh G' && e.reason === 'low rating' && e.at > 0 && e.fam === 'RTC14-P'; })(), JSON.stringify(B.store));
    ok('nothing else is written: one document, kind famok', Object.keys(B.store).join() === 'listingrules/famok_SP' && B.store['listingrules/famok_SP'].kind === 'famok');
    ok('the page shows only the grey link "1 removed on purpose › Show"', /1 removed on purpose › Show/.test(html) && !/data-fc-s="RTC14-7"/.test(html), strip(html).slice(-200));
    ok('not in the CSV', !/RTC14-7/.test(B.fcCsv(v).text));
    B.fcClick({ dataset: { fc: 'showok' } });
    ok('Show: the list with who, the reason and [Undo]', /RTC14-7/.test(B.el('fcBody').innerHTML) && /Vishesh G/.test(B.el('fcBody').innerHTML) && /low rating/.test(B.el('fcBody').innerHTML) && /data-fc="undo"/.test(B.el('fcBody').innerHTML));
    ok('the e-mail is never on the page', !/example\.com/.test(B.el('fcBody').innerHTML));
    // a reload: a new page over the same saved store
    const B2 = setup({ store: B.store });
    await B2.fcOpen();
    ok('for good: after a reload it is still not an error', !probOf(B2.FC.view, 'RTC14-7', 'orphan') && B2.FC.view.removed.length === 1);
    // Undo
    await B2.fcOkUndo('SP', 'RTC14-7');
    ok('Undo brings it back as an error', !!probOf(B2.FC.view, 'RTC14-7', 'orphan') && B2.FC.view.removed.length === 0);
    const e = B.store['listingrules/famok_SP'].items['RTC14-7'];
    ok('…saved: on false, who undid it and when, the first mark kept', e.on === false && e.undoneBy === 'vishesh.g@example.com' && e.undoneAt > 0 && e.reason === 'low rating');
    const B3 = setup({ store: B.store });
    await B3.fcOpen();
    ok('…and after a reload it is an error again', !!probOf(B3.FC.view, 'RTC14-7', 'orphan'));
  }

  console.log('== a linked or no-longer-live child leaves every list ==');
  {
    const D = setup();
    await D.fcOpen();
    await D.fcOkSet('SP', 'RTC14-7', 'low rating');
    D.S.items.find(i => i.sku === 'RTC14-7').psku = 'RTC14-P';           // linked to its family (the next snapshot)
    v = D.fcBuild();
    ok('linked: not an error, not in the removed list', !probOf(v, 'RTC14-7', 'orphan') && v.removed.length === 0);
    D.S.items.find(i => i.sku === 'RTC14-7').psku = '';
    D.HEALTH.SP.rows.find(r => r.sku === 'RTC14-7').qty = 0;            // sold out
    v = D.fcBuild();
    ok('no longer live: not an error, not in the removed list, not counted', !probOf(v, 'RTC14-7', 'orphan') && v.removed.length === 0 && v.live === 7);
    D.HEALTH.SP.rows.find(r => r.sku === 'RTC14-7').qty = 3;
    v = D.fcBuild();
    ok('live again (and never linked): still removed on purpose — the mark holds', !probOf(v, 'RTC14-7', 'orphan') && v.removed.length === 1);
    const E = setup();
    await E.fcOpen();
    E.fcAfterSend({ jobs: [{ state: 'accepted' }] }, 'SP|RTC14-7', { psku: 'RTC14-P', theme: 'SIZE/COLOR', lvl: 'child' });
    ok('a Link Amazon accepted: the child leaves the list at once', !probOf(E.FC.view, 'RTC14-7', 'orphan'));
  }

  console.log('== ratings (if Sellora ever holds them) ==');
  {
    const R = setup();
    R.S.items.find(i => i.sku === 'RTC14-7').rating = 3.5;
    R.S.items.find(i => i.sku === 'RTC14-7').reviews = 12;
    await R.fcOpen();
    ok('rating below 4 → treated as removed on purpose (listed as automatic, no Undo)', !probOf(R.FC.view, 'RTC14-7', 'orphan') && R.FC.view.removed[0].why === 'rating' && R.FC.view.ratingFound === 1);
    ok('…and the page says ratings were found', /ratings found for 1 listings/.test(R.el('fcMeta').innerHTML));
    ok('0 reviews → error; 4 or more → error; none → error', !R.fcLowRated({ rating: 3, reviews: 0 }) && !R.fcLowRated({ rating: 4.2, reviews: 30 }) && !R.fcLowRated(null) && R.fcLowRated({ rating: 3.9, reviews: 1 }));
  }

  console.log('== the test site, the Categories tab ==');
  {
    const T = setup({ test: true });
    await T.fcOpen();
    await T.fcOkSet('SP', 'RTC14-7', 'low rating');
    ok('test site: hidden on the page, nothing saved, and it says so', !probOf(T.FC.view, 'RTC14-7', 'orphan') && !Object.keys(T.store).length && /Test site — the mark is kept on this page only/.test(T.el('fcMeta').innerHTML));
    T.fcClick({ dataset: { fc: 'tab', fcV: 'cat' } });
    ok('Categories: "Coming with the automatic refresh — browse nodes"', /Coming with the automatic refresh — browse nodes/.test(T.el('fcBody').innerHTML));
  }

  console.log('== other screens unchanged ==');
  {
    const assigns = SRC.match(/\b(HEALTH|IML|LR_CAT|LI_WS|AMZ|H_CTX|H_LOADED|LR|SP|LH|SQ)\s*(\[[^\]]*\])*\s*(\.\w+)*\s*=(?!=)/g) || [];
    ok('family-check.js never writes Listing Health / Image Manager / catalogue / Workspace / planner state', !assigns.length, assigns.join(' | '));
    const root = path.join(__dirname, '..', '..');
    let changed = [];
    try { changed = cp.execSync('git diff --name-only HEAD -- Pricing-App/src Pricing-App/firestore.rules Pricing-API', { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean); } catch (e) { changed = ['(git not available)']; }
    const allowed = ['Pricing-App/src/app/ORDER', 'Pricing-App/src/app/core/nav.js', 'Pricing-App/src/index.html', 'Pricing-App/src/styles.css'];
    ok('only the menu, the pane, its CSS, ORDER and nav.js (Core) changed — no backend, no rules, no other screen', changed.every(f => allowed.includes(f)), changed.join(', '));
    let nav = '';
    try { nav = cp.execSync('git diff -U0 HEAD -- Pricing-App/src/app/core/nav.js', { cwd: root, encoding: 'utf8' }); } catch (e) { nav = ''; }
    const navLines = nav.split(/\r?\n/).filter(l => /^[+-](?![+-])/.test(l));
    ok('nav.js: only the tab key, its title and TAB_INHERIT fam: \'health\' (3 old lines replaced)', !nav || (navLines.filter(l => l[0] === '-').length === 3
      && navLines.filter(l => l[0] === '+').every(l => /'fam'\]|fam: 'Family & Category Check'|fam: 'health'|lhist: 'Listing History',$/.test(l))), navLines.join('\n'));
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
    ok('menu: column 2 · Check, right after BSR Audit', /<button id="tabBsr" class="nav">BSR Audit<\/button>\r\n      <button id="tabFam" class="nav">Family &amp; Category Check<\/button><\/div>/.test(html) && /data-tabs="[^"]*bsr,fam,/.test(html));
    ok('the new file is CRLF', !/(^|[^\r])\n/.test(SRC));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
