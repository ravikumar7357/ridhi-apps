/* The Rule Engine (12 Nov 2026): the four answers, the picture rules, the Picture check marks, and the rules' history — over the real
 * Listing Rules, Workspace, child sidebar, Picture check and Rules tab, in a stub page.
 *   node tests/rule-engine-test.js */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const url = id => `https://m.media-amazon.com/images/I/${id}._AC_SL1500_.jpg`;

(async () => {
  console.log('== the four answers ==');
  {
    const C = load({ ws: true });
    const where = { brand: 'SP', sku: 'X1' };
    const lines = {
      pass: C.lrAnswerHtml('Bullets', { pass: true, found: '5 of 5' }, where, ''),
      fix: C.lrAnswerHtml('Bullets', { pass: false, miss: '3 of 5' }, where, ''),
      unk: C.lrAnswerHtml('Search terms', { pass: null, found: 'Not read from Amazon yet' }, where, ''),
      na: C.lrAnswerHtml('Template', { pass: null, na: true }, where, ''),
      look: C.lrAnswerHtml('Main image', { pass: true, look: 'is the background of the main picture pure white, with no text or logo on it?' }, where, ''),
    };
    ok('✓ Pass', /li-ws-ok" aria-hidden="true">✓<\/span> <b>Bullets<\/b> — Pass · 5 of 5/.test(lines.pass), lines.pass);
    ok('✕ Fix', /ui-error" aria-hidden="true">✕<\/span> <b>Bullets<\/b> — Fix: 3 of 5/.test(lines.fix), lines.fix);
    ok('○ Not checked, with the plain reason: "Not read from Amazon yet — not an error"', /○<\/span> <b>Search terms<\/b> — Not checked: Not read from Amazon yet — not an error/.test(lines.unk), lines.unk);
    ok('○ Not checked when a rule does not apply — not an error', /○<\/span> <b>Template<\/b> — Not checked: doesn’t apply to this listing — not an error/.test(lines.na), lines.na);
    ok('◐ A person needs to look, with "Open in Image Manager"', /◐<\/span> <b>Main image<\/b> — A person needs to look: is the background/.test(lines.look) && /data-pc-open="SP\|X1">Open in Image Manager</.test(lines.look), lines.look);
    ok('the answer of each kind of check record', C.lrAnswer({ pass: true }) === 'pass' && C.lrAnswer({ pass: false }) === 'fix' && C.lrAnswer({ pass: null }) === 'unk' && C.lrAnswer({ pass: true, look: 'x' }) === 'look');
  }

  console.log('== the picture rules, on the catalogue pictures ==');
  {
    const C = load({ ws: true, pc: true });
    C.LI_WS.stored = true;
    const r1 = C.rows.find(r => r.sku === 'R1');
    const now = Date.now();
    const cat = pic => ({ at: now, iAt: now, cat: Object.keys(pic), catMain: url(pic.MAIN[0]), catPic: pic });
    const judge = (pic, extra) => { C.LI_WS.live.SP.R1 = Object.assign(cat(pic), extra || {}); C.LI_WS.liveV++; C.reset(); delete r1._f; return C.healthOf(r1, C.hCtx()); };
    const ids = n => Object.fromEntries(['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06'].slice(0, n).map((slot, i) => [slot, ['p' + i, 2000, 2000]]));
    let h = judge(ids(7));
    ok('7 big, square, different pictures: none of the picture rules fires', !h.found.some(hit => /images_small|main_not_square|images_duplicate|no_main_image|images_below/.test(hit.detector)), h.found.map(x => x.detector).join());
    const small = ids(7); small.PT03 = ['p3', 800, 600];
    h = judge(small);
    const hs = h.found.find(hit => hit.detector === 'images_small');
    ok('an 800 px picture fails "Picture too small to zoom", and the fix says which slot and how big', hs && /PT03 \(800 px\)/.test(hs.detail) && /Upload a bigger version of PT03 in Image Manager — at least 1000 px/.test(hs.fix) && hs.kind === 'img', hs && (hs.detail + ' | ' + hs.fix));
    const dup = ids(7); dup.PT02 = ['p0', 2000, 2000];
    h = judge(dup);
    const hd = h.found.find(hit => hit.detector === 'images_duplicate');
    ok('the same picture in two slots fails "Same picture used twice"', hd && /PT02 is the same picture as MAIN/.test(hd.detail) && /Put a different picture in PT02/.test(hd.fix), hd && hd.detail);
    const wide = ids(7); wide.MAIN = ['p0', 1500, 1000];
    h = judge(wide);
    ok('a 1500 × 1000 main picture fails "Main picture not square"', h.found.some(hit => hit.detector === 'main_not_square' && /1500 × 1000 px/.test(hit.detail)));
    const nearly = ids(7); nearly.MAIN = ['p0', 2000, 1900];
    ok('…a nearly square one (2000 × 1900, 5 %) passes', !judge(nearly).found.some(hit => hit.detector === 'main_not_square'));
    // no sizes (a read from before 12 Nov): the size rules are not judged — Not checked, never an error
    h = judge(ids(7), { catPic: undefined });
    ok('no picture sizes (an older read): too small / not square are not judged, never an error', !h.found.some(hit => /images_small|main_not_square/.test(hit.detector)));
    // the Workspace's check lines
    C.LI_WS.on = true; C.liWsRender();
    const kid = C.LI_WS.byKey.get('SP|P1').kids.find(k => k.sku === 'R1');
    ok('…and the Images line says the sizes were not read yet', /picture sizes not read from Amazon yet/.test(kid.c.img.found), kid.c.img.found);
    // no picture data at all: Not checked
    delete C.LI_WS.live.SP.R1; C.reset();
    const bare = Object.assign({}, r1, { content: null }); delete bare._f;
    ok('no picture data at all: no picture rule fires (Not checked)', !C.healthOf(bare, C.hCtx()).found.some(hit => hit.area === 'Images'));
  }

  console.log('== the Picture check: ◐ A person needs to look, Looks OK remembered, Not OK a problem ==');
  {
    const posts = [];
    const C = load({ ws: true, pc: true });
    C.LI_WS.stored = true;
    const r1 = C.rows.find(r => r.sku === 'R1');
    const now = Date.now();
    const pic = { MAIN: ['main1', 2000, 2000], PT01: ['a', 2000, 2000], PT02: ['b', 2000, 2000], PT03: ['c', 2000, 2000], PT04: ['d', 2000, 2000], PT05: ['e', 2000, 2000], PT06: ['f', 2000, 2000] };
    C.LI_WS.live.SP.R1 = { at: now, iAt: now, cat: Object.keys(pic), catMain: url('main1'), catPic: pic };
    C.LI_WS.liveV++; C.reset();
    const judge = () => { C.reset(); delete r1._f; return C.healthOf(r1, C.hCtx()); };
    let h = judge();
    const before = h.bucket;
    ok('a main picture nobody looked at: ◐ "A person needs to look" — not a problem, not in any count', h.looks.length === 1 && /pure white/.test(h.looks[0].what) && !h.found.some(hit => hit.detector === 'main_photo_check'), JSON.stringify(h.looks));
    C.LI_WS.on = true; C.liWsRender();
    let kid = C.LI_WS.byKey.get('SP|P1').kids.find(k => k.sku === 'R1');
    ok('…the Workspace main-picture check still passes (counts unchanged) and carries the ◐ line', kid.c.main.pass === true && !!kid.c.main.look && kid.cards.err === false);
    const detail = C.liWsDetail(kid, 8);
    ok('…the listing\'s check lines show it with "Open in Image Manager"', /◐<\/span> <b>Main image<\/b> — A person needs to look/.test(detail) && /data-pc-open="SP\|R1">Open in Image Manager</.test(detail), detail.match(/◐[\s\S]{0,200}/));
    // Looks OK: remembered
    await C.pcMark('SP', 'main1', 'ok', '', 'R1');
    h = judge();
    ok('Looks OK: no ◐ any more, no problem, the bucket as before', !h.looks.length && !h.found.some(hit => hit.detector === 'main_photo_check') && h.bucket === before, h.bucket + ' vs ' + before);
    // the picture changes: the mark no longer applies
    const pic2 = Object.assign({}, pic, { MAIN: ['main2', 2000, 2000] });
    C.LI_WS.live.SP.R1 = { at: now, iAt: now, cat: Object.keys(pic2), catMain: url('main2'), catPic: pic2 };
    C.LI_WS.liveV++;
    h = judge();
    ok('a new main picture: the Looks OK mark is cleared — ◐ asks again', h.looks.length === 1 && h.looks[0].picId === 'main2');
    // Not OK: a normal problem
    await C.pcMark('SP', 'main2', 'bad', 'grey shadow at the bottom', 'R1');
    h = judge();
    const hit = h.found.find(each => each.detector === 'main_photo_check');
    ok('Not OK: a normal problem "Main picture marked Not OK", with who / when / the note and "Replace the main picture" as the fix', hit && /marked Not OK by /.test(hit.detail) && /grey shadow at the bottom/.test(hit.detail)
      && /^Replace the main picture in Image Manager/.test(hit.fix) && hit.kind === 'img' && !h.looks.length, hit && (hit.detail + ' | ' + hit.fix));
    ok('…and it counts like any other Needs attention problem', h.bucket === 'action' || h.bucket === 'critical', h.bucket);
  }

  console.log('== where the marks are saved ==');
  {
    const writes = [];
    const C = load({ pc: true, setDoc: async (ref, data, options) => { writes.push({ ref, data, options }); } });
    C.PC.loaded = true;
    ok('the marks start empty per brand', JSON.stringify(C.PC.marks) === JSON.stringify({ SP: {}, CPC: {} }));
    await C.pcMark('CPC', 'x9', 'ok', '', 'C1a');
    ok('a mark is kept per picture with Looks OK, who and when', C.PC.marks.CPC.x9 && C.PC.marks.CPC.x9.v === 'ok' && C.PC.marks.CPC.x9.at > 0 && C.PC.where === 'shared', JSON.stringify(C.PC.marks.CPC.x9) + ' ' + C.PC.where);
    ok('…saved in imgsnap/piccheck (the Image Manager\'s own collection, which it may write), merged per brand and picture', writes.length === 1 && writes[0].ref.path === 'imgsnap/piccheck' && writes[0].options && writes[0].options.merge === true && writes[0].data.CPC.x9.v === 'ok', JSON.stringify(writes[0] || {}).slice(0, 200));
    // a write that is refused keeps the mark in this browser, and says so
    const store = {};
    const D = load({ pc: true, setDoc: async () => { throw new Error('Missing or insufficient permissions.'); } });
    D.PC.loaded = true;
    const ls = globalThis.localStorage; globalThis.localStorage = { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } };
    await D.pcMark('SP', 'z1', 'bad', 'logo', 'R1');
    globalThis.localStorage = ls;
    ok('a refused write: kept in this browser, and the page will say so', D.PC.where === 'browser' && /permissions/.test(D.PC.err) && D.PC.marks.SP.z1.v === 'bad');
    // the test site: nothing is written, the mark lasts for the visit
    const tw = [];
    const E = load({ pc: true, window: { __TEST_ERP: {} }, setDoc: async () => { tw.push(1); } });
    E.PC.loaded = true;
    await E.pcMark('SP', 'z2', 'ok', '', 'R1');
    ok('the test site: nothing is written; the mark lasts for this visit ("not saved here")', !tw.length && E.PC.where === 'visit' && E.PC.marks.SP.z2.v === 'ok');
    // the picture list for the chip: one card per picture, the shared ones once
    C.IML.CPC = { at: new Date(), items: [{ sku: 'C1a', lvl: 'child', live: { MAIN: url('x9') }, t: 'Tablecloth A' }, { sku: 'C1b', lvl: 'child', live: { MAIN: url('x9') }, t: 'Tablecloth A' }, { sku: 'C1c', lvl: 'child', live: { MAIN: url('y1') }, t: 'Tablecloth C' }] };
    const pics = C.pcPictures('CPC');
    ok('the Picture check lists each main picture once ("used on 2 listings") and knows which are checked', pics.length === 2 && pics.find(p => p.id === 'x9').skus.length === 2 && pics.find(p => p.id === 'x9').mark && !pics.find(p => p.id === 'y1').mark);
  }

  console.log('== the rules\' history ==');
  {
    const saved = [];
    const C = load({ tab: true });
    const a = JSON.parse(JSON.stringify(C.LR_DEFAULT));
    const b = JSON.parse(JSON.stringify(a));
    b.issues.find(x => x.id === 'aplus_missing').sev = 'action';
    b.issues.find(x => x.id === 'title_opt').on = false;
    b.issues.find(x => x.id === 'img_secondary').params.n = 7;
    b.allow = { ourBrands: 'Ridhi, CPC' };
    const words = C.lrRulesDiff(a, b);
    ok('the change in words: "changed \'A+ missing\' from Critical to Attention", turned off, settings, brand words', words.includes("changed 'A+ missing' from Critical to Attention") && words.some(w => /turned 'Title slightly under-optimized' off/.test(w))
      && words.some(w => /changed the settings of 'Secondary images missing' \(n: 6 → 7\)/.test(w)) && words.some(w => /changed 'Our brand words' from 'Ridhi, CPC, Whimsical Corner' to 'Ridhi, CPC'/.test(w)), words.join(' | '));
    ok('the same rules: no change', C.lrRulesDiff(a, JSON.parse(JSON.stringify(a))).length === 0);
    ok('the name from the e-mail', C.lrWho('ravi.kumar@ridhihome.com') === 'Ravi');
  }

  console.log('== Save rules keeps the previous version (last 20) ==');
  {
    const store = { data: null };
    const C = load({ tab: true, getDoc: async () => ({ exists: () => !!store.data, data: () => store.data }), setDoc: async (ref, data) => { store.data = data; } });
    const prevRules = JSON.parse(JSON.stringify(C.LR_DEFAULT));
    prevRules.issues.find(x => x.id === 'aplus_missing').sev = 'action';
    store.data = Object.assign(prevRules, { at: { toMillis: () => 1700000000000 }, by: 'ravi@x.com', history: Array.from({ length: 20 }, (_, i) => ({ at: i, by: 'old', who: 'Old', changes: ['old ' + i], prev: {} })) });
    C.getLR().issues.find(x => x.id === 'aplus_missing').sev = 'critical';
    try { await C.el('lrSave').onclick(); } catch (e) { /* the stub page cannot draw the table after saving; the save itself happened */ }
    const h = store.data && store.data.history;
    ok('the save keeps the version it replaced, with who and when, first in the list', h && h[0].prev && h[0].prev.by === 'ravi@x.com' && h[0].prev.issues.find(x => x.id === 'aplus_missing').sev === 'action' && h[0].by === 'test@example.com', h && JSON.stringify(h[0]).slice(0, 200));
    ok('…with the change in words: "changed \'A+ missing\' from Attention to Critical"', h && h[0].changes.includes("changed 'A+ missing' from Attention to Critical"), h && h[0].changes.join(' | '));
    ok('…and only the last 20 are kept', h && h.length === 20 && h[19].changes[0] === 'old 18');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
