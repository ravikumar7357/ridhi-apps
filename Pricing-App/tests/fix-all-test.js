/* Fix all (src/app/listing/fix-all.js) over the real Listing Rules, Workspace, child component and Season planner, in a stub page.
 *   node tests/fix-all-test.js
 * One parent with 100 children, 10 of them with the same problem (a title over 75) → one row "10 children" → one click → 10 changes,
 * each with its own size and colour; a child whose fix would break a rule needs your OK; one child's Fix = Fix all for that child;
 * Amazon's check → To send → send → read again → Accepted / Rejected / Amazon working; the test site sends nothing; Put back; the spec
 * copy; the season word; the block on top of both side panels; the cards = Listing Health's numbers. */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const JUL = new Date(2026, 6, 15);       // 15 Jul 2026: no occasion on — no season word in the way
const NOV = new Date(2026, 10, 12);      // 12 Nov 2026: Christmas is on
const COLORS = ['Blue', 'Red', 'Green', 'Grey', 'Navy', 'Mustard', 'Rust', 'Teal', 'Sage', 'Pink'];
const SIZES = ['18x18', '20x20', '22x22', '16x16'];
const sizeText = s => s.replace('x', ' x ') + ' Inch';
const GOOD = (size, color) => `Ridhi Cloth Napkins 100% Cotton ${sizeText(size)} Block Print - ${color}`;                                    // 63–66 letters
const LONG = (size, color, material) => `Ridhi Cloth Napkins ${material || '100% Cotton'} ${sizeText(size)} Block Print Reusable Dinner Napkins for Kitchen Party Wedding - ${color}`;
const idle = async C => { for (let i = 0; i < 400 && (C.LI_WS.inflight || C.LI_WS.q.length); i++) await new Promise(r => setTimeout(r, 2)); await new Promise(r => setTimeout(r, 2)); };

// A stub page with one parent PB of 100 napkins: 90 with good titles, 10 (L0–L9) over 75 letters. `mod(sku, row, cat)` changes one.
function setup(opts) {
  opts = opts || {};
  const handed = [];
  const saved = [];
  let C;
  const amazon = opts.amazon || {};             // what the re-read answers: { work: sku (old title still), rej: sku (an ERROR on item_name) }
  const baCall = async q => {
    if (q.lfix === 'content') {
      const items = {};
      q.skus.split(',').forEach(sku => {
        const it = C.FA.run && C.FA.run.items.find(each => each.sku === sku);
        const title = it && sku !== amazon.work ? it.after : (C.LI_WS.live.SP[sku] || {}).catTitle;
        items[sku] = { productType: 'NAPKIN', item_name: [{ value: title }], bullet_point: [1, 2, 3, 4, 5].map(n => ({ value: 'b' + n })), product_description: [{ value: 'd'.repeat(300) }], generic_keyword: [{ value: 'cotton' }] };
      });
      return { items };
    }
    if (q.lfix === 'get') return { productType: 'NAPKIN', status: ['BUYABLE', 'DISCOVERABLE'], attributes: (opts.attrs && opts.attrs[q.sku]) || {},
      issues: q.sku === amazon.rej ? [{ severity: 'ERROR', message: 'The provided value for item_name is not a valid value', attrs: ['item_name'] }] : [] };
    return {};
  };
  C = load({ ws: true, sp: true, fa: true, baCall, post: opts.post, window: opts.window, setDoc: async (ref, data) => { saved.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)) }); },
    ctx: { imOnly: (skus, label) => handed.push({ to: 'img', skus, label }), leOnly: (skus, label) => handed.push({ to: 'lerr', skus, label }), leShow() {}, leListEnsure() {}, imListRender() {} } });
  C.setHealthLoaded(true);
  C.LI_WS.stored = true;
  C.SP.log = [];
  C.SP.today = opts.today || JUL;
  C.FA.log = [];
  ['SP', 'CPC'].forEach(b => { C.LI_WS.schema[b].NAPKIN = { at: Date.now(), ok: opts.specs || [], hl: { none: true } }; });
  const now = Date.now();
  const cat = {};
  const put = (sku, title, c, extra) => {
    const row = Object.assign({ brand: 'SP', parent: 'PB', sku, asin: 'B0' + sku, title, qty: 5, price: 12.5, status: 'Active', channel: 'AFN', aplus: true, aplusAt: now, checked: now,
      content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } }, extra || {});
    C.HEALTH.SP.rows.push(row);
    cat[sku] = Object.assign({ subcat: 'Napkin Set' }, c);
    C.LI_WS.live.SP[sku] = { at: now, cAt: now, pt: 'NAPKIN', title, titleLen: title.length, catTitle: title, tAt: now, kw: 'cotton', kwBytes: 6, bul: 5, desc: 300 };
    return row;
  };
  for (let i = 0; i < 100; i++) {
    const sku = i < 10 ? 'L' + i : 'G' + i;
    const c = { color: COLORS[i % 10], size: SIZES[i % 4] };
    if (opts.mod && opts.mod[sku]) Object.assign(c, opts.mod[sku].cat || {});
    const title = (opts.mod && opts.mod[sku] && opts.mod[sku].title) || (i < 10 ? LONG(c.size, c.color) : GOOD(c.size, c.color));
    put(sku, title, c, opts.mod && opts.mod[sku] && opts.mod[sku].row);
  }
  C.setCat('SP', cat);
  C.LI_WS.liveV++;
  C.reset();
  return { C, handed, saved, put, cat };
}
const patchCalls = (C, apply) => C.calls.filter(c => c.lfix === 'patch' && c.apply === apply);

(async () => {
  console.log('== one parent, 100 children, 10 with the same problem → one row "10 children" ==');
  const A = setup({ amazon: { work: 'L7', rej: 'L8' } });
  {
    const { C } = A;
    const kids = C.faKids('SP', 'PB');
    const groups = C.faGroups('SP', 'PB', kids);
    const tg = groups.find(g => g.key === 'title');
    ok('100 children under the parent', kids.length === 100, kids.length);
    ok('ONE row "Title too long" holding the 10', tg && tg.kids.length === 10 && groups.filter(g => g.kind === 'title').length === 1 && tg.kids.every(k => /^L\d$/.test(k.sku)), tg && tg.kids.map(k => k.sku).join());
    ok('…the 90 good titles are in no row', groups.every(g => g.kids.every(k => /^L/.test(k.sku))), groups.map(g => g.key + ':' + g.kids.length).join(' '));
    const html = C.faBlockHtml('SP', 'PB');
    ok('the block: "Title too long" · what we will do · "10 children" · ONE button "Fix all 10" · "› Show all 10"', /<b>Title too long<\/b><small>Shorten to 75 letters with the title template — brand, product, size and colour kept<\/small>/.test(html)
      && /class="fa-n">10 children</.test(html) && />Fix all 10</.test(html) && /› Show all 10/.test(html) && !/Could not group/.test(html), strip(html).slice(0, 600));
    ok('…under NEEDS ATTENTION (a review-level rule), and the green line "90 children have no problem · Nothing to do"', /fa-sec-h">Needs attention</.test(html) && !/fa-sec-h">Fix first</.test(html)
      && /90 children have no problem · Nothing to do/.test(strip(html)), strip(html).slice(-300));
    // the cards = Listing Health's numbers for this parent: healthOf over the same rows, each child once by its level
    const rows = C.HEALTH.SP.rows.filter(r => r.parent === 'PB');
    const lh = { critical: 0, action: 0, review: 0, healthy: 0, monitor: 0, unchecked: 0 };
    rows.forEach(r => { lh[C.healthOf(Object.assign({}, r, { brand: 'SP' }), C.hCtx()).bucket]++; });
    const n = C.faCards(kids);
    ok('the three cards = Listing Health: Critical · Needs action + Needs review · Healthy + Monitor', n.err === lh.critical && n.att === lh.action + lh.review && n.ok === lh.healthy + lh.monitor && n.unk === lh.unchecked,
      JSON.stringify({ n, lh }));
    ok('…drawn as "0 problems to fix first · 10 need attention · 90 children with no problem"', /<b>0<\/b><span>problems to fix first/.test(html) && /<b>10<\/b><span>need attention/.test(html) && /<b>90<\/b><span>children with no problem/.test(html));
    C.FA.open.add('SP|PB|title');
    const open = C.faBlockHtml('SP', 'PB');
    ok('"› Show all 10" lists the children: name (colour · size) · SKU · before → after', (open.match(/class="fa-kid"/g) || []).length === 8 && /Show the other 2/.test(open)
      && /<b>Blue · 18 x 18 Inch<\/b><small>L0<\/small>/.test(open) && /fa-was">Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print Reusable Dinner Napkins for…<\/span> → <span class="fa-new">Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - Blue</.test(open),
      strip(open).slice(0, 900));
    C.FA.open.clear();

    console.log('== 1 click → 10 items, each with its own size and colour; Amazon checks each first ==');
    await C.faStart('SP|PB|title');
    const run = C.FA.run;
    ok('Amazon checks all 10 first (apply: false = VALIDATION_PREVIEW), nothing sent', patchCalls(C, false).length === 10 && patchCalls(C, true).length === 0 && run.step === 'review' && run.items.length === 10);
    ok('each child gets ITS OWN title: its own colour after " - ", its own size, 10 different titles', run.items.every(it => it.after.endsWith(' - ' + A.cat[it.sku].color) && it.after.includes(sizeText(A.cat[it.sku].size)) && it.after.length <= 75)
      && new Set(run.items.map(it => it.after)).size === 10, run.items.map(it => it.sku + ': ' + it.after).join(' | '));
    ok('…and each patch names only that child: item_name with its own title', patchCalls(C, false).every(c => c.patches.length === 1 && c.patches[0].path === '/attributes/item_name'
      && c.patches[0].value[0].value === run.items.find(it => it.sku === c.sku).after));
    ok('…brand, product, size, colour, material and print kept; the long "uses" words go', run.items.every(it => /^Ridhi Cloth Napkins 100% Cotton \d+ x \d+ Inch Block Print - \w+$/.test(it.after)));
    const rh = C.faBlockHtml('SP', 'PB');
    ok('the answer: "10 Amazon will accept · 0 Amazon says no", To send (10), Approve & send 10, Reject all', /10 Amazon will accept · 0 Amazon says no/.test(strip(rh)) && /To send \(10\)/.test(rh)
      && /data-fa-act="approve">Approve &amp; send 10</.test(rh) && /data-fa-act="reject">Reject all</.test(rh), strip(rh).slice(0, 400));
    A.review = Object.fromEntries(run.items.map(it => [it.sku, JSON.stringify(it.patches)]));

    console.log('== Approve & send → read again → Accepted / Rejected / Amazon working ==');
    await C.faApprove();
    ok('the 10 are sent for real (apply: true), one by one', patchCalls(C, true).length === 10);
    ok('every change is kept with its OLD title in listingrules/fixlog', C.FA.log.length === 10 && A.saved.some(s => s.path === 'listingrules/fixlog' && s.data.rows.length === 10)
      && C.FA.log.every(rec => rec.before.title && rec.before.title.length > 75 && rec.after.title.length <= 75 && rec.row === 'title'), JSON.stringify(C.FA.log[0]));
    await idle(C);
    const st = Object.fromEntries(C.FA.run.items.map(it => [it.sku, it.state]));
    ok('after the re-read: ✅ Accepted where Amazon holds the new title, ⏳ Amazon working where not yet, ❌ Rejected + why on an ERROR',
      Object.entries(st).filter(([sku]) => !['L7', 'L8'].includes(sku)).every(([, s]) => s === 'accepted') && st.L7 === 'working' && st.L8 === 'rejected', JSON.stringify(st));
    const L8 = C.FA.run.items.find(it => it.sku === 'L8');
    ok('…the reason in plain words', /not one Amazon accepts/.test(L8.why), L8.why);
    const sh = strip(C.faBlockHtml('SP', 'PB'));
    ok('the run says so: "✅ 8 accepted · ⏳ 1 Amazon working · ❌ 1 rejected"', /✅ 8 accepted · ⏳ 1 Amazon working · ❌ 1 rejected/.test(sh), sh.slice(0, 300));
    ok('…and the records follow (History)', C.FA.log.filter(r => r.state === 'accepted').length === 8 && C.FA.log.find(r => r.sku === 'L8').state === 'rejected');
    const g2 = C.faGroups('SP', 'PB', C.faKids('SP', 'PB')).find(g => g.key === 'title');
    ok('the rows update: the 9 sent wait for Amazon to show the new title; only the rejected one is still in the row', g2 && g2.kids.length === 1 && g2.kids[0].sku === 'L8' && g2.waiting.length === 9,
      g2 && JSON.stringify({ kids: g2.kids.map(k => k.sku), waiting: g2.waiting.length }));
    ok('…our submitted titles are the new ones on every screen (the live entries)', C.LI_WS.live.SP.L0.title === C.FA.run.items.find(it => it.sku === 'L0').after);
    C.faReject();
    const hist = C.faBlockHtml('SP', 'PB');
    ok('History lists the 10 changes with their state and Put back', /History · 10 changes sent from here/.test(hist) && (hist.match(/data-fa-act="putback"/g) || []).length === 10);

    console.log('== Put back: Amazon checks the old title first, then it is sent ==');
    const rec = C.FA.log.find(r => r.sku === 'L0');
    await C.faPutBack(rec.id);
    const pc = patchCalls(C, false).slice(-1)[0];
    ok('Put back asks Amazon about the OLD title (nothing sent yet)', C.FA.putting && C.FA.putting.step === 'ok' && pc.sku === 'L0' && pc.patches[0].value[0].value === rec.before.title);
    await C.faPutSend();
    ok('…Send put back sends it; the record says when', patchCalls(C, true).slice(-1)[0].patches[0].value[0].value === rec.before.title && rec.back > 0 && !C.FA.putting
      && /↺ Put back/.test(C.faHistHtml('SP', 'PB')));
  }

  console.log('== one child\'s Fix gives exactly what Fix all gives that child ==');
  {
    const { C } = setup();
    for (const sku of ['L0', 'L3', 'L9']) {
      C.FA.run = null;
      await C.faStart('SP|PB|title', sku);
      ok(`${sku}: one child alone → one item, the same patch as in Fix all`, C.FA.run.items.length === 1 && JSON.stringify(C.FA.run.items[0].patches) === A.review[sku], C.FA.run.items.map(it => it.sku).join());
    }
  }

  console.log('== a child whose fix would break a rule needs your OK ==');
  {
    const { C } = setup({ mod: { L5: { title: LONG('20x20', 'Mustard', 'Pure Linen') }, L6: { cat: { size: '' } } } });
    const g = C.faGroups('SP', 'PB', C.faKids('SP', 'PB')).find(each => each.key === 'title');
    const plans = C.faPlans(g, C.hCtx());
    const p5 = plans.find(p => p.sku === 'L5'), p6 = plans.find(p => p.sku === 'L6');
    ok('L5 says Linen: the template would write "Cotton" — a word made up → not safe, with the reason', g.kids.length === 10 && !p5.ok && /cotton/i.test(p5.why), p5.why);
    ok('L6 has no size in the catalogue → not safe ("the catalogue has no size")', !p6.ok && /no size/.test(p6.why), p6.why);
    ok('the row offers "Fix all 8"', />Fix all 8</.test(C.faBlockHtml('SP', 'PB')));
    await C.faStart('SP|PB|title');
    ok('Fix all sends only the 8 to Amazon\'s check; the 2 wait for your OK', patchCalls(C, false).length === 8 && C.FA.run.held.length === 2 && !C.FA.run.items.some(it => ['L5', 'L6'].includes(it.sku)));
    ok('"8 Amazon will accept · 0 Amazon says no · 2 need your OK (reason)"', /8 Amazon will accept · 0 Amazon says no · 2 need your OK \(.+\)/.test(strip(C.faRunHtml(C.FA.run))), strip(C.faRunHtml(C.FA.run)).slice(0, 300));
  }

  console.log('== Amazon says no to one in its check → only the others can be sent; Reject all sends nothing ==');
  {
    const { C } = setup({ post: body => (body.sku === 'L2' && !body.apply ? { ok: false, previewOnly: true, error: 'Amazon would reject this: The value is not a valid value for item_name' } : { ok: true, previewOnly: !body.apply, submissionId: 'sub-' + body.sku }) });
    await C.faStart('SP|PB|title');
    const h = strip(C.faRunHtml(C.FA.run));
    ok('"9 Amazon will accept · 1 Amazon says no", with the reason', /9 Amazon will accept · 1 Amazon says no/.test(h) && /Amazon says no \(1\)/.test(h) && /not one Amazon accepts/.test(h), h.slice(0, 400));
    C.faReject();
    ok('Reject all: nothing is sent, the plan is gone', patchCalls(C, true).length === 0 && C.FA.run === null);
    await C.faStart('SP|PB|title');
    await C.faApprove();
    ok('Approve & send 9: L2 is not sent', patchCalls(C, true).length === 9 && !patchCalls(C, true).some(c => c.sku === 'L2'));
  }

  console.log('== the test site: "not sent to Amazon" ==');
  {
    const { C } = setup({ window: { __TEST_ERP: true } });
    await C.faStart('SP|PB|title');
    ok('no call to Amazon at all; the 10 say "Test site — not sent to Amazon"', patchCalls(C, false).length === 0 && C.FA.run.items.length === 10 && C.FA.run.items.every(it => it.state === 'test')
      && /Test site — not sent to Amazon/.test(C.faRunHtml(C.FA.run)));
    await C.faApprove();
    ok('…Close: still nothing sent, nothing written', patchCalls(C, true).length === 0 && C.FA.run.items.every(it => it.state === 'notsent') && C.FA.log.length === 0);
  }

  console.log('== an empty spec: copied only when every sibling that has it uses the same value ==');
  {
    const val = v => ({ material: [{ value: v, language_tag: 'en_US', marketplace_id: 'ATVPDKIKX0DER' }], color: [{ value: 'Blue', language_tag: 'en_US' }] });
    // what Amazon's ?lfix=get answers for each child: four with the material (and a colour), G14 with nothing
    const attrs = { G10: val('Cotton'), G11: val('Cotton'), G12: val('Cotton'), G13: val('Cotton') };
    const { C } = setup({ specs: ['material', 'pattern', 'color'], attrs });
    const now = Date.now();
    // five children read from Amazon (gAt, specs): four have the material, one has not; no one has the pattern; G14 has no colour
    ['G10', 'G11', 'G12', 'G13', 'G14'].forEach(sku => Object.assign(C.LI_WS.live.SP[sku], { gAt: now, specs: { material: sku !== 'G14', pattern: false, color: sku !== 'G14' } }));
    C.LI_WS.liveV++;
    const rowOf = key => C.faGroups('SP', 'PB', C.faKids('SP', 'PB')).find(g => g.key === key);
    let g = rowOf('spec:material');
    ok('one row "Empty spec: material" with G14', g && g.kids.length === 1 && g.kids[0].sku === 'G14' && g.name === 'Empty spec: material');
    let plan = C.faPlans(g, C.hCtx())[0];
    ok('the siblings\' values not read yet → "Checking…", and they are read from Amazon', !plan.ok && plan.wait && /Checking…/.test(C.faBlockHtml('SP', 'PB')) && ['G10', 'G11', 'G12', 'G13'].every(s => C.FA.reading.has('SP|' + s) || C.FA.vals.SP[s]));
    await idle(C);   // the reads land: the Workspace's get job hands each answer to faOnGet
    g = rowOf('spec:material');
    plan = C.faPlans(g, C.hCtx())[0];
    ok('all four say "Cotton" → copy it, exactly as Amazon holds it', plan.ok && plan.after === 'Cotton' && plan.patches[0].path === '/attributes/material' && plan.patches[0].value[0].value === 'Cotton'
      && />Fix all 1</.test(C.faBlockHtml('SP', 'PB')), JSON.stringify(plan));
    C.faOnGet('SP', 'G12', val('Linen'));
    g = rowOf('spec:material');
    plan = C.faPlans(g, C.hCtx())[0];
    ok('one sibling says "Linen" → not copied: "the other children use different values"', !plan.ok && /different values/.test(plan.why) && /Open in Listing Errors/.test(C.faBlockHtml('SP', 'PB')), plan.why);
    const pat = C.faPlans(rowOf('spec:pattern'), C.hCtx());
    ok('nobody has the pattern → nothing to copy', pat.every(p => !p.ok && /no other child/.test(p.why)), pat[0].why);
    const col = C.faPlans(rowOf('spec:color'), C.hCtx());
    ok('a colour is never copied: each child has its own', col.length === 1 && !col[0].ok && /its own color/.test(col[0].why), col[0] && col[0].why);
  }

  console.log('== the season word: exactly the Season planner\'s own plan ==');
  {
    const { C } = setup({ today: NOV });
    C.FA.log = [];
    const items = C.spCompute(NOV).filter(it => it.row.parent === 'PB' && it.status === 'ready');
    const g = C.faGroups('SP', 'PB', C.faKids('SP', 'PB')).find(each => each.key === 'season');
    ok('a "Season word missing: “Christmas”" row, its children = the planner\'s to-do for the parent', g && /Christmas/.test(g.name) && g.kids.length >= items.length && items.length > 0, g && g.name + ' ' + g.kids.length + '/' + items.length);
    const plans = C.faPlans(g, C.hCtx());
    const same = items.every(item => { const p = plans.find(each => each.sku === item.sku); return p && p.ok && JSON.stringify(p.patches) === JSON.stringify(C.spPatches(item, item.after)); });
    ok('every ready child: the very patches the planner\'s own Fix sends (title if room, else Item Highlights, else hidden search words)', same && plans.filter(p => p.ok).length === items.length);
    await C.faStart('SP|PB|season');
    const n = C.FA.run.items.length;
    await C.faApprove();
    await idle(C);
    ok('sent: written to the fix log AND the planner\'s own log (its Put back keeps working)', C.FA.log.length === n && C.SP.log.length === n && C.SP.log.every(r => r.before && r.after && r.seasons.length), `${C.FA.log.length} / ${C.SP.log.length} / ${n}`);
  }

  console.log('== on top of both side panels; the children list below, as it was ==');
  {
    const { C } = setup();
    C.el('hBrandView').value = 'SP';
    C.LI_WS.on = true; C.LI_WS.mode = 'all'; C.LI_WS.card = ''; C.LI_WS.chip = 'all';
    C.liWsRender();
    C.liWsPanelOpen('SP|PB');
    const h = C.el('lsPanel').innerHTML;
    const p = C.LI_WS.byKey.get('SP|PB');
    ok('Workspace panel: header, then the block, then the children list (exactly liWsPanelList)', h.indexOf('class="ls-panel-h"') < h.indexOf('<section class="fa"') && h.indexOf('</section>') < h.indexOf('class="ls-kids"')
      && h.includes(C.liWsPanelList(p)), h.slice(0, 200));
    C.faClick({ dataset: { faAct: 'kid', faKid: 'SP|L3' }, closest: () => null });
    ok('a child clicked in the block opens the panel\'s own child view (the shared child component)', C.LI_WS.panel.kid === 'SP|L3' && /lk-sku[^>]*>L3</.test(C.el('lsPanel').innerHTML));
    C.liWsPanelClose(false);
    C.spOpenParent('SP|PB');
    const sp = C.el('spPanel').innerHTML;
    ok('Season planner panel: the block on top of the planner\'s own body', sp.indexOf('<section class="fa"') > sp.indexOf('sp-side-b') && sp.indexOf('</section>') < sp.indexOf('sp-psent'), sp.slice(0, 200));
    C.faClick({ dataset: { faAct: 'kid', faKid: 'SP|L4' }, closest: sel => (sel === '#spPanel' ? {} : null) });
    ok('…a child clicked there opens the planner\'s child panel', C.SP.kid && C.SP.kid.key === 'SP|L4');
  }

  console.log('== no safe fix: Image Manager / Listing Errors, with those children already picked ==');
  {
    const { C, handed } = setup({ mod: { G20: { row: { content: { titleLen: 63, images: 3, bullets: 5, descLen: 300, title: GOOD('18x18', 'Blue') } } }, G21: { row: { price: 0 } } } });
    C.LI_WS.live.SP.G20.cat = null;
    const groups = C.faGroups('SP', 'PB', C.faKids('SP', 'PB'));
    const img = groups.find(g => g.kind === 'img');
    const lerr = groups.find(g => g.kind === 'lerr' && g.kids.some(k => k.sku === 'G21'));
    const html = C.faBlockHtml('SP', 'PB');
    ok('pictures → FIX FIRST, "Open in Image Manager"; no price → "Open in Listing Errors"', img && lerr && /fa-sec-h">Fix first</.test(html) && /data-fa-act="img"[^>]*>Open in Image Manager</.test(html)
      && /data-fa-act="lerr"[^>]*>Open in Listing Errors</.test(html) && html.indexOf('Fix first') < html.indexOf('Needs attention'), groups.map(g => g.key + ':' + g.kind).join(' '));
    C.faOpenImg('SP|PB|' + img.key);
    C.faOpenLerr('SP|PB|' + lerr.key);
    ok('…each opens its screen with exactly those children picked', handed[0].to === 'img' && handed[0].skus.join() === 'G20' && handed[1].to === 'lerr' && handed[1].skus.join() === 'G21'
      && C.calls.some(c => c.tab === 'img') && C.calls.some(c => c.tab === 'lerr'), JSON.stringify(handed));
    ok('the cards count them as Listing Health does (2 to fix first)', /<b>2<\/b><span>problems to fix first/.test(html), strip(html).slice(0, 200));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
