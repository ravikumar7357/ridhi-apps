/* #10 "Safe SP-API Approval & Verification Loop" (src/app/listing/listing-send-check.js): the ONE send path — the Amazon check popup —
 * over the real files in a stub page.
 *   node tests/send-check-test.js
 * Fix → "Checking with Amazon…" → "✓ Amazon will accept" (before → after) / "✗ Amazon says no: <plain reason>" + how to fix; Fix all →
 * "N Amazon will accept · M Amazon says no"; Approve & send → read again → ✅ accepted / ❌ rejected / ⏳ still working (Check again); the
 * test site sends nothing; every send is written once (lhistAdd); every send point goes through sqSendWithCheck. */
const { load } = require('./listing-rules-test.js');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); } };
const strip = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const NOV = new Date(2026, 10, 13);
const TITLE = c => `Ridhi Cloth Napkins 100% Cotton 18 x 18 Inch Block Print - ${c}`;

// A stub page with a fake Amazon: Amazon's check says no to the SKUs in `no` (with that message); a real send is kept and ?lfix=get returns
// it — except the SKUs in `slow` (still the old value: "working") and `reject` (an ERROR on the field).
function setup(opts) {
  opts = opts || {};
  const posts = [];
  const saved = [];
  const amazon = {};
  const post = body => {
    posts.push(body);
    const no = (opts.no || {})[body.sku];
    if (no) return { ok: false, previewOnly: !body.apply, error: 'Amazon would reject this: ' + no, issues: [{ severity: 'ERROR', message: no }] };
    if (!body.apply) return { ok: true, previewOnly: true, status: 'VALID', issues: [] };
    if (!(opts.slow || []).includes(body.sku)) amazon[body.sku] = Object.assign(amazon[body.sku] || {}, Object.fromEntries((body.patches || []).map(p => [p.path.replace('/attributes/', ''), p.value])));
    return { ok: true, status: 'ACCEPTED', submissionId: 'sub-' + body.sku };
  };
  const baCall = async q => {
    if (q.lfix !== 'get') return {};
    const rej = (opts.reject || {})[q.sku];
    return { productType: 'NAPKIN', attributes: amazon[q.sku] || {}, issues: rej ? [{ severity: 'ERROR', message: rej, attrs: ['generic_keyword'] }] : [] };
  };
  const C = load({ ws: true, sp: true, window: opts.window, baCall, post, setDoc: async (ref, data, o) => { saved.push({ path: ref.path, data: JSON.parse(JSON.stringify(data)), merge: !!(o && o.merge) }); } });
  C.setHealthLoaded(true); C.LI_WS.stored = true; C.SP.log = []; C.SP.today = NOV;
  C.LI_WS.schema.SP.NAPKIN = { at: Date.now(), ok: [], hl: { items: 1, max: 125, bytes: 0 } };
  ['SP', 'CPC'].forEach(b => C.HEALTH[b].rows.splice(0));
  const cat = {};
  const now = Date.now();
  const put = (sku, kw, hl) => {
    const title = TITLE('Blue');
    C.HEALTH.SP.rows.push({ brand: 'SP', parent: 'PP', sku, asin: 'B0' + sku, title, qty: 5, price: 12, status: 'Active', channel: 'AFN', aplus: true, aplusAt: now, checked: now, content: { titleLen: title.length, images: 8, bullets: 5, descLen: 300, title } });
    cat[sku] = { color: 'Blue', size: '18x18', subcat: 'Napkin Set' };
    C.LI_WS.live.SP[sku] = { at: now, cAt: now, pt: 'NAPKIN', title, titleLen: title.length, catTitle: title, tAt: now, kw, kwBytes: C.lrKwBytes(kw), hl, hlAt: now };
  };
  const done = () => { C.setCat('SP', cat); C.LI_WS.liveV++; C.reset(); C.SP.itemsKey = ''; C.SP.on = true; };
  return { C, posts, saved, put, done, amazon };
}
const box = C => C.el('spModalBox').innerHTML;

(async () => {
  console.log('== Fix → the Amazon check popup: will accept / says no ==');
  {
    const { C, put, done, posts } = setup();
    put('A1', 'cotton', ['Soft cotton']);
    done();
    const r = C.spApprove(['SP|A1']);
    ok('Fix → the popup opens on "Checking with Amazon…" (Amazon\'s VALIDATION_PREVIEW: nothing changes on Amazon)', /Checking with Amazon…/.test(box(C)) && /nothing changes on Amazon yet/.test(box(C)));
    await C.SQ.run.checked;
    ok('…the check is apply:false (never a send)', posts.length === 1 && posts[0].apply === false && posts[0].lfix === 'patch');
    ok('…"✓ Amazon will accept" + the change, before → after, [Approve & send] [Cancel]', /✓ Amazon will accept/.test(box(C)) && /<small>Hidden search words<\/small> <del>cotton<\/del> → <ins>cotton thanksgiving christmas<\/ins>/.test(box(C))
      && /data-sq="approve">Approve &amp; send</.test(box(C)) && /data-sq="cancel">Cancel</.test(box(C)), strip(box(C)).slice(0, 400));
    C.sqClose();
    await r.run;
    ok('Cancel: nothing sent', !posts.some(p => p.apply));
  }
  {
    const { C, put, done, posts } = setup({ no: { B1: 'The value for title_differentiation must be 125 characters or less' } });
    put('B1', 'cotton', ['Soft cotton']);
    done();
    let edited = null;
    C.spApprove(['SP|B1']);
    await C.SQ.run.checked;
    ok('Amazon says no → "✗ Amazon says no: Value too long — max 125" + how to fix, [Edit] [Close]', /✗ Amazon says no: Value too long — max 125/.test(box(C)) && /How to fix: Shorten it to 125 or less, then send again\./.test(box(C))
      && /data-sq="edit">Edit</.test(box(C)) && /data-sq="cancel">Close</.test(box(C)) && !/data-sq="approve"/.test(box(C)), strip(box(C)).slice(0, 300));
    C.sqEdit();
    ok('Edit: the popup closes and Listing Errors opens for that listing (the planner\'s hand-off)', !C.sqIsOpen() && C.calls.some(c => c.tab === 'lerr') && C.calls.some(c => c.sku === 'B1'));
    ok('…nothing sent', !posts.some(p => p.apply));
  }
  {
    const C = setup().C;
    ok('plain words for Amazon\'s messages', C.sqPlain('item_name must be 200 characters or less') === 'Value too long — max 200' && C.sqPlain("The value 'Blu' is not a valid value") === 'A value Amazon does not accept'
      && /catalogue holds a different value/.test(C.sqPlain("different from what's already in the Amazon catalog")) && C.sqName('vishesh.gyanchandani@x.com') === 'Vishesh Gyanchandani');
  }

  console.log('== Fix all N: the counts, the ones Amazon says no to listed with their reason ==');
  const F = setup({ no: { N8: 'Value is not a valid value for pattern', N9: 'generic_keyword must be 249 bytes or less' }, slow: ['N6'], reject: { N7: 'The keywords contain a word Amazon does not allow' } });
  {
    const { C, put, done, posts } = F;
    for (let i = 0; i < 10; i++) put('N' + i, 'cotton', ['Soft cotton']);
    done();
    const g = C.spGroupOf('SP|PP');
    const r = C.spFixSeasons(g.todo.map(i => i.key), '');
    await C.SQ.run.checked;
    ok('"8 Amazon will accept · 2 Amazon says no", [Approve & send 8] [Cancel]', /8 Amazon will accept · 2 Amazon says no/.test(strip(box(C))) && /data-sq="approve">Approve &amp; send 8</.test(box(C)) && /data-sq="cancel">Cancel</.test(box(C)), strip(box(C)).slice(0, 200));
    ok('…the 2 listed with their reason, in the list that scrolls inside the popup', /Amazon says no \(2\)/.test(box(C)) && /N8[^]*A value Amazon does not accept/.test(box(C)) && /N9[^]*Value too long — max 249/.test(box(C)) && /class="sp-m-list"/.test(box(C)));
    await C.sqApprove();
    const sent = posts.filter(p => p.apply).map(p => p.sku);
    ok('Approve & send 8: only the 8 Amazon will accept are sent', sent.length === 8 && !sent.includes('N8') && !sent.includes('N9'), sent.join());
    ok('…read again: "✅ 6 accepted · ❌ 1 rejected (reason) · ⏳ 1", [Check again] [Close]', /✅ 6 accepted · ❌ 1 rejected \(The keywords contain a word Amazon does not allow\) · ⏳ 1/.test(strip(box(C))) && /data-sq="again">Check again</.test(box(C)), strip(box(C)).slice(0, 250));
    F.amazon.N6 = { generic_keyword: posts.find(p => p.apply && p.sku === 'N6').patches.find(p => /generic_keyword/.test(p.path)).value, title_differentiation: posts.find(p => p.apply && p.sku === 'N6').patches.find(p => /title_differentiation/.test(p.path)).value };
    await C.sqCheckAgain();
    ok('Check again (Amazon has it now): "✅ 7 accepted · ❌ 1 rejected · ⏳ 0", no Check again button', /✅ 7 accepted · ❌ 1 rejected \(.*\) · ⏳ 0/.test(strip(box(C))) && !/data-sq="again"/.test(box(C)), strip(box(C)).slice(0, 200));
    C.sqClose();
    await r.run;
    C.SP.panel = null; C.spRender();
    ok('Close: the screen says "✓ 7 fixed · 2 need your OK (Amazon says no …) · ✕ 1 not accepted"', /✓ 7 fixed · 2 need your OK \(Amazon says no/.test(strip(C.el('spPane').innerHTML)) && /✕ 1 not accepted/.test(strip(C.el('spPane').innerHTML)), strip(C.el('spPane').innerHTML).slice(0, 500));
  }

  console.log('== every send is written down once (lhistAdd) ==');
  {
    const day = new Date().toISOString().slice(0, 10);
    const logs = F.saved.filter(s => s.path === 'listingrules/sendlog_' + day);
    const rows = Object.assign({}, ...logs.map(s => s.data.rows));
    const list = Object.values(rows);
    ok(`listingrules/sendlog_${day}, merged in (never overwriting another send)`, logs.length >= 1 && logs.every(s => s.merge));
    ok('one row per changed field of each of the 8 sends: date, user (name from the e-mail), SKU, ASIN, field, old → new, screen, result', list.length === 16
      && list.every(r => r.at && r.by === 'test@example.com' && r.name === 'Test' && /^N\d$/.test(r.sku) && r.asin === 'B0' + r.sku && r.field && r.screen === 'Season planner' && r.result)
      && list.some(r => r.field === 'Hidden search words' && r.old === 'cotton' && r.new === 'cotton thanksgiving christmas'), JSON.stringify(list[0]));
    ok('…with each result: the rejected one "rejected", the slow one updated to "accepted" by Check again', list.filter(r => r.sku === 'N7').every(r => r.result === 'rejected' && /not allow/.test(r.why))
      && list.filter(r => r.sku === 'N6').every(r => r.result === 'accepted'));
  }

  console.log('== the test site: the check shows, nothing is sent ==');
  {
    const { C, put, done, posts, saved } = setup({ window: { __TEST_ERP: true } });
    put('T1', 'cotton', ['Soft cotton']);
    put('T2', 'cotton', ['Soft cotton']);
    done();
    C.spFixSeasons(['SP|T1', 'SP|T2'], '');
    await C.SQ.run.checked;
    ok('the popup still shows the check step: "Amazon\'s check cannot run here" with the changes and Approve & send 2', /Test site — Amazon's check cannot run here/.test(box(C)) && /Approve &amp; send 2/.test(box(C)) && /<del>cotton<\/del>/.test(box(C)));
    await C.sqApprove();
    ok('Approve: "Test site — not sent to Amazon"; no call to the backend, nothing written', /<b>Test site — not sent to Amazon<\/b>/.test(box(C)) && posts.length === 0 && !saved.some(s => /sendlog/.test(s.path)));
    C.sqClose();
  }

  console.log('== the send points that go through the ONE function ==');
  ok('Season planner (Fix, Fix all, Remove all, Fix all seasons) → sqSendWithCheck', F.C.SQ.screens.includes('Season planner'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
