/* Image Manager — rearranging a listing's pictures in the list (24 Nov 2026): drag / keys (swap, move to an empty slot), one copied
 * picture → "Paste here" on the listing or a sibling, the Replace menu, "Match family order", the draft (Undo / Discard changes),
 * nothing sent before Send, Send → the before → after preview → THE ONE SEND PATH, the MAIN question. In the stub page (opts.im).
 *   node tests/image-reorder-test.js */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? ' — ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const SLOTS = ['MAIN', 'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08'];
const A = id => `https://m.media-amazon.com/images/I/${id}.jpg`;
function kid(sku, slots, psku) {
  const img = {};
  slots.forEach((p, i) => { if (p) img[SLOTS[i]] = A(/^own/.test(p) ? sku + p : p); });
  return { sku, psku: psku === undefined ? 'PAR' : psku, asin: 'B0' + sku, pt: 'NAPKIN', c: sku, z: '18x18', st: 'BUYABLE,DISCOVERABLE', iss: [], img, live: Object.assign({}, img) };
}
// The family: own photos MAIN–PT02, the size chart in PT03, an own photo in PT04. C has the chart in PT04 and its own photo in PT03.
const ITEMS = () => [
  { sku: 'PAR', lvl: 'parent', asin: 'B0PAR', t: 'Napkins', img: { MAIN: A('par') }, live: { MAIN: A('par') } },
  kid('KA', ['own1', 'own2', 'own3', 'chart', 'own4']),
  kid('KB', ['own1', 'own2', 'own3', 'chart', 'own4', 'own5']),
  kid('KC', ['own1', 'own2', 'own3', 'own4', 'chart']),
  kid('X1', ['own1', 'own2'], 'OTHER'),
];
function page() {
  const sent = [];
  const posts = [];
  const P = load({ im: true, ctx: { sqSendWithCheck: async (jobs, o) => { sent.push({ jobs, o }); }, sqField: s => (s === 'MAIN' ? 'Main picture' : 'Picture ' + s.slice(3)), sqSummaryText: () => '',
    imPost: async b => { posts.push(b); return { ok: true }; } } });
  P.el('imBrand').value = 'SP';
  P.el('imFilter').value = 'all';
  P.el('imQ').value = '';
  P.IML.SP = { at: new Date(), items: ITEMS() };
  P.HEALTH.SP = Object.assign(P.HEALTH.SP || {}, { rows: ['KA', 'KB', 'KC', 'X1'].map(sku => ({ sku, qty: 5, status: 'Active', channel: 'AFN' })) });
  P.sent = sent;
  P.posts = posts;
  return P;
}
const it = (P, sku) => P.IML.SP.items.find(i => i.sku === sku);
const nowOf = (P, sku) => { const d = P.IM_DRAFT.get(sku); return d ? d.now : null; };
const id = url => (String(url || '').match(/\/I\/([^.]+)/) || ['', ''])[1];

console.log('== drag / keys: swap, move to an empty slot — a draft, nothing sent ==');
{
  const P = page();
  ok('KA\'s strip can be rearranged: its pictures carry data-drag, its empty slots are places to drop', /data-sku="KA" data-slot="PT03" data-drag="1"/.test(P.imKidRow(it(P, 'KA'))) && /class="im-tw is-empty" data-sku="KA" data-slot="PT05"/.test(P.imKidRow(it(P, 'KA'))));
  eq('drag 04 onto 03 → 03 and 04 SWAP', [P.imMove('KA', 'PT04', 'PT03'), id(nowOf(P, 'KA').PT03), id(nowOf(P, 'KA').PT04)], [true, 'KAown4', 'chart']);
  eq('…the draft changes those two slots only', Object.keys(P.imDraftDiff('KA')), ['PT03', 'PT04']);
  const row = P.imKidRow(it(P, 'KA'));
  ok('…the row: both slots marked "changed", "2 changes — not sent", Undo · Discard changes · Send…', (row.match(/class="im-tchg"/g) || []).length === 2 && /2 changes<\/b> — not sent/.test(row)
    && /data-dr="undo"/.test(row) && /data-dr="discard"/.test(row) && /data-dr="send"/.test(row));
  eq('drag 02 onto the empty 05 → it MOVES there, 02 is empty', [P.imMove('KA', 'PT02', 'PT05'), id(nowOf(P, 'KA').PT05), nowOf(P, 'KA').PT02], [true, 'KAown3', '']);
  eq('…its note says where it came from (Listing History: old → new slot)', P.IM_DRAFT.get('KA').note.PT05, 'from PT02');
  eq('an empty slot cannot be dragged; the swatch and another listing are no places to drop', [P.imMove('KA', 'PT06', 'PT01'), P.imMove('KA', 'PT01', 'SWCH')], [false, false]);
  eq('NOTHING SENT before Send: no Amazon check, no backend call', [P.sent.length, P.posts.length], [0, 0]);
  eq('Undo → the move to 05 is taken back', [P.imDraftUndo('KA'), id(nowOf(P, 'KA').PT02), nowOf(P, 'KA').PT05 || ''], [true, 'KAown3', '']);
  P.imDraftUndo('KA');
  ok('Undo again → back to how it was: no draft any more', !P.IM_DRAFT.has('KA'));
  P.imMove('KA', 'PT01', 'PT02');
  P.imDraftDiscard('KA');
  ok('Discard changes → no draft', !P.IM_DRAFT.has('KA') && !/im-draft/.test(P.imKidRow(it(P, 'KA'))));
  // keys: Space picks a picture up, → moves it, Esc puts it back
  const tw = slot => ({ closest: sel => (/im-tw/.test(sel) ? { dataset: { sku: 'KA', slot, drag: '1' } } : null), tagName: 'A' });
  const key = (k, slot) => P.imKey({ key: k, target: tw(slot), preventDefault() {} });
  ok('keys: Space on PT01 picks it up; → moves it to PT02 (a swap)', key(' ', 'PT01') && key('ArrowRight', 'PT01') && id(nowOf(P, 'KA').PT02) === 'KAown2' && id(nowOf(P, 'KA').PT01) === 'KAown3');
  ok('…→ again: on to PT03; Esc puts everything back as it was before the pick-up', key('ArrowRight') && id(nowOf(P, 'KA').PT03) === 'KAown2' && key('Escape') && !P.IM_DRAFT.has('KA'));
  ok('…Space, →, Space: put down — the move stays in the draft', key(' ', 'PT01') && key('ArrowRight') && key(' ') && id(nowOf(P, 'KA').PT02) === 'KAown2');
}

console.log('== copy → paste: on the listing or a sibling ==');
{
  const P = page();
  P.imOneCopy(it(P, 'KA'), 'PT03', A('chart'));
  ok('one picture copied: KA and its siblings take it, a listing of another family does not', P.imOneFits(it(P, 'KA')) && P.imOneFits(it(P, 'KB')) && !P.imOneFits(it(P, 'X1')));
  ok('…every slot of a sibling shows "Paste here" (MAIN–08, not the swatch)', (P.imKidRow(it(P, 'KB')).match(/data-paste-one="KB"/g) || []).length === 9 && !/data-paste-one="X1"/.test(P.imKidRow(it(P, 'X1'))));
  P.IM_OPEN.add('PAR');
  P.imListRender();
  ok('…the bar: "1 picture copied · PT03 of KA · … · Esc to cancel"', /1 picture copied<\/b> · PT03 of <span class="im-mono">KA<\/span> · “Paste here” on any slot of this listing or its siblings · Esc to cancel/.test(P.el('imList').innerHTML));
  eq('paste into KB\'s PT05 (a filled slot) → replaced, in the draft', [P.imPasteOne('KB', 'PT05'), id(nowOf(P, 'KB').PT05), P.IM_DRAFT.get('KB').note.PT05], [true, 'chart', 'copy of PT03 of KA']);
  eq('…the old picture is not lost: Undo brings it back', [P.imDraftUndo('KB'), P.IM_DRAFT.has('KB')], [true, false]);
  eq('paste into another family → nothing', P.imPasteOne('X1', 'PT02'), false);
  P.el('spModal').classList = { contains: c => c === 'hide', add() {}, remove() {}, toggle() {} };   // no popup open
  eq('Esc → the copy is cancelled (no "Paste here" any more); nothing was sent', [P.imKey({ key: 'Escape', target: { tagName: 'BODY' }, preventDefault() {} }), P.imOneFits(it(P, 'KB')), P.sent.length], [true, false, 0]);
}

console.log('== Replace: a small menu ==');
{
  const P = page();
  const html = P.imReplMenuHtml('KA', 'PT02');
  ok('three choices: a picture from this listing · from a sibling · Upload from computer', /Use a picture from this listing/.test(html) && /Use a picture from a sibling/.test(html) && /Upload from computer…/.test(html));
  const picks = P.imReplPicks('KA', 'PT02');
  eq('…this listing: its other pictures (MAIN, 01, 03, 04)', picks.own.map(p => p.slot), ['MAIN', 'PT01', 'PT03', 'PT04']);
  ok('…a sibling: the family\'s pictures KA does not have (each once; KB\'s and KC\'s own photos, not the shared chart again)', picks.sib.length === 9 && !picks.sib.some(p => id(p.url) === 'chart') && picks.sib.every(p => p.sku === 'KB' || p.sku === 'KC'), picks.sib.map(p => p.sku + p.slot));
  P.imReplMenu(null, 'KA', 'PT02');
  eq('picking KB\'s PT05 → it goes into KA\'s PT02 (a draft)', [P.imReplPick({ url: A('KBown5'), note: 'PT05 of KB' }), id(nowOf(P, 'KA').PT02)], [true, 'KBown5']);
  let clicked = 0;
  P.el('imFile2').click = () => { clicked++; };
  P.imReplMenu(null, 'KA', 'PT01');
  P.imReplPick({ upload: true });
  eq('"Upload from computer" → today\'s Replace: the file chooser opens for that slot', clicked, 1);
  eq('nothing sent', P.sent.length, 0);
}

console.log('== Match family order ==');
{
  const P = page();
  ok('KC (chart in 04, an own photo in 03) offers "Match family order"; KA (in order) does not', (P.imShownGroups(P.IML.SP.items, 'all', ''), /data-match="KC"/.test(P.imKidRow(it(P, 'KC')))) && !/data-match="KA"/.test(P.imKidRow(it(P, 'KA'))));
  P.imMatchFamily('KC');
  const now = nowOf(P, 'KC');
  eq('the result IS the family order: own photos MAIN–02 and 04, the chart in 03', SLOTS.slice(0, 5).map(s => id(now[s])), ['KCown1', 'KCown2', 'KCown3', 'chart', 'KCown4']);
  const after = Object.assign({}, it(P, 'KC'), { img: now, live: now });
  eq('…checked the way the dots are: KC now has no dot', P.imSeqFamily([it(P, 'KA'), it(P, 'KB'), after]).has('KC'), false);
  eq('…only moved, never deleted: the same pictures', Object.values(now).filter(Boolean).map(id).sort(), Object.values(it(P, 'KC').img).map(id).sort());
  const pv = P.el('spModalBox').innerHTML || '';
  ok('…then the before → after preview of the slots (nothing sent yet)', /Before → after/.test(pv) || /Before → after/.test(P.imDraftPreviewHtml('KC')));
  ok('…its rows: 03 and 04 change ("from PT04 (family order)"), the others "same"', /from PT04 \(family order\)/.test(P.imDraftPreviewHtml('KC')) && (P.imDraftPreviewHtml('KC').match(/is-same/g) || []).length === 7);
  eq('nothing sent before Send', P.sent.length, 0);
  // Send → THE ONE SEND PATH
  P.imDraftSend('KC');
  const call = P.sent[0];
  ok('Send → sqSendWithCheck (Amazon checks first, then the person approves), one listing, screen "Image Manager"', P.sent.length === 1 && call.jobs.length === 1 && call.o.screen === 'Image Manager');
  const job = call.jobs[0];
  eq('…the patch: PT03 ← the chart, PT04 ← KC\'s own photo (limg patch, its product type)', [job.body.limg, job.body.productType, id(job.body.set.PT03), id(job.body.set.PT04), Object.keys(job.body.set)], ['patch', 'NAPKIN', 'chart', 'KCown4', ['PT03', 'PT04']]);
  ok('…each change logged with its old picture (Put back can undo it) and the slot it came from', job.changes.every(c => c.pic && c.attr && c.oldV) && /Picture 3 \(from PT04 \(family order\)\)/.test(job.changes.map(c => c.field).join('|')));
  call.o.onSent(job);
  ok('…once sent: the strip shows it, the draft is gone', !P.IM_DRAFT.has('KC') && id(it(P, 'KC').img.PT03) === 'chart');
}

console.log('== MAIN: our own product photo on white — asked first ==');
{
  const P = page();
  eq('putting the size chart (on 3 listings) into MAIN → asked first, nothing changed yet', [P.imMove('KA', 'PT03', 'MAIN'), P.IM_DRAFT.has('KA')], ['ask', false]);
  const q = P.el('spModalBox').innerHTML || '';
  ok('…the question says why: "MAIN must be this product\'s own photo … size chart, care guide or lifestyle photo"', /Put this picture in MAIN\?/.test(q) && /on 3 listings of the family — a size chart, care guide or lifestyle photo\?/.test(q), strip(q).slice(0, 300));
  eq('…"Put it in MAIN anyway" → it goes in', [P.imMove('KA', 'PT03', 'MAIN', true), id(nowOf(P, 'KA').MAIN)], [true, 'chart']);
  eq('a main picture (this listing\'s or a sibling\'s) is never asked about', [P.imMainWarn('KA', A('KAown1')), P.imMainWarn('KA', A('KBown1'))], ['', '']);
  ok('the before → after preview repeats the warning on MAIN', /MAIN must be this product/.test(P.imDraftPreviewHtml('KA')));
  eq('nothing sent', P.sent.length, 0);
}

console.log('== the send leaves alone what is not ours ==');
{
  const P = page();
  const k = it(P, 'KA');
  k.img = Object.assign({}, k.img);
  delete k.img.PT04;                                  // PT04 only from Amazon's catalogue
  P.imMove('KA', 'PT04', 'PT06');
  const job = P.imDraftJob('KA');
  eq('moving a catalogue-only picture: PT06 gets it; PT04 (never ours) is not "emptied" in the patch', Object.keys(job.body.set), ['PT06']);
  ok('…the preview says so', /Shown from Amazon's catalogue, not your listing/.test(P.imDraftPreviewHtml('KA')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
