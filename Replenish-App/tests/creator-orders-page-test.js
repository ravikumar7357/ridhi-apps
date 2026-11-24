/* Content Creators page (src/app/shopify/creator-orders.js): how a line's name, colour and size are shown, and where they
 * come from when the SKU is changed (Khushi, 17 Nov). The real file, run in Node with the page's surroundings faked.
 *   node Replenish-App/tests/creator-orders-page-test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'shopify', 'creator-orders.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m); } else { fail++; console.log('  FAIL ' + m); } };

const MDB = {
  'RTC130-6060': { sku: 'RTC130-6060', articleType: 'Tablecloth', subtype: 'Square', color: 'Ruby Red', size: '60" x 60"' },
  'RTR14-14108': { sku: 'RTR14-14108', articleType: 'Table Runner', subtype: '', color: 'Sage', size: '' },
  'NOSIZE-1': { sku: 'NOSIZE-1', articleType: 'Napkin', color: 'Indigo', size: '-' },
};
const FETCHED = { 'NEW-SKU-9': { sku: 'NEW-SKU-9', articleType: 'Pillow Cover', color: 'Sea Blue', size: '20" x 20"' } };
const asked = [];
const ctx = {
  console, location: { hash: '' },
  $: () => null,                                     // no page: the menu item and pane are not made
  obUC: s => String(s == null ? '' : s).trim().toUpperCase(),
  mdbOf: s => MDB[String(s || '').trim().toUpperCase()],
  mdbFetchSku: async s => { asked.push(s); return FETCHED[String(s).toUpperCase()] || null; },
  SHOP_STOCK: { 'AMZ-ONLY': 3 },
  esc: s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])),
};
vm.createContext(ctx);
vm.runInContext(SRC, ctx);
const run = js => vm.runInContext(js, ctx);

(async () => {
  console.log('== a line is shown as name · colour · size ==');
  ok(run(`croLineDesc({ title: 'Tablecloth', color: 'Ruby Red', size: '60" x 60"' })`) === 'Tablecloth · Ruby Red · 60" x 60"', 'Khushi\'s example: Tablecloth · Ruby Red · 60" x 60"');
  ok(run(`croLineDesc({ title: 'Table Runner', color: 'Sage', size: '' })`) === 'Table Runner · Sage', 'an empty size shows nothing — no dash, no trailing dot');
  ok(run(`croLineDesc({ title: 'Napkin', color: 'Indigo', size: '-' })`) === 'Napkin · Indigo', 'a size of "-" counts as empty too');
  ok(run(`croLineDesc({ title: 'Napkin', color: 'Indigo', size: '  ' })`) === 'Napkin · Indigo', 'spaces only count as empty');
  ok(run(`croLineDesc({ title: '', color: '', size: '' })`) === '', 'nothing at all is an empty string, not a dash');
  ok(run(`croLineDesc(null)`) === '', 'no line at all does not throw');

  console.log('== the product list fills a changed SKU ==');
  const f = run(`croSkuFacts('rtc130-6060')`);
  ok(f && f.title === 'Tablecloth' && f.color === 'Ruby Red' && f.size === '60" x 60"', 'the master\'s article, colour and size (any letter case)');
  ok(run(`croLineDesc(croSkuFacts('RTR14-14108'))`) === 'Table Runner · Sage', 'a product with no size in the master shows none');
  const g = await run(`croSkuFactsNow('NEW-SKU-9')`);
  ok(g && g.color === 'Sea Blue' && g.size === '20" x 20"' && asked.includes('NEW-SKU-9'), 'a SKU not in this page\'s copy is asked of the database, one row');
  asked.length = 0;
  await run(`croSkuFactsNow('RTC130-6060')`);
  ok(asked.length === 0, 'a SKU the page already knows is not asked again');
  ok((await run(`croSkuFactsNow('NOPE-1')`)) === null, 'a SKU nobody knows answers null');

  console.log('== the screens use it ==');
  ok(/croLineDesc\(l\)/.test(SRC.slice(SRC.indexOf('function croRender'), SRC.indexOf('function croOpen'))), 'the table\'s Product cell uses croLineDesc');
  ok(/data-cro-name="\$\{i\}">\$\{esc\(croLineDesc\(l\)\)\}/.test(SRC), 'the drawer\'s Product cell uses croLineDesc, with no dash fallback');
  const save = SRC.slice(SRC.indexOf('async function croSaveDrawer'), SRC.indexOf('/* ---------------- MCF'));
  ok(/await croSkuFactsNow\(sku\)/.test(save) && /color: \(f && f\.color\)/.test(save) && /size: \(f && f\.size\)/.test(save), 'saving a changed SKU takes colour and size from the product list');
  ok(/is not in the product list — pick it from the list/.test(save), 'a SKU the list does not know (and FBA does not stock) is refused');
  const open = SRC.slice(SRC.indexOf('function croOpen'), SRC.indexOf('async function croSaveDrawer'));
  ok(/await croSkuFactsNow\(typed\)/.test(open), 'typing a SKU in the drawer shows its colour and size at once');

  console.log('== report-back on the page (Khushi, 18 Nov) ==');
  const G = (o) => JSON.stringify(Object.assign({ reference: 'CGE-12AB34CD', source: 'creator-setu' }, o));
  ok(run(`croNeedsReport(${G({ status: 'Shipped' })})`) === true, 'a Shipped gift nobody has told yet → told');
  ok(run(`croNeedsReport(${G({ status: 'Shipped', setu: { status: 'shipped' } })})`) === false, 'already told "shipped" → not again');
  ok(run(`croNeedsReport(${G({ status: 'Shipped', setu: { status: 'sent_to_amazon', tried: 'shipped', error: 'Creator Setu refused (409)' } })})`) === false,
    'a failed or refused try is NOT asked again by itself — only by "Retry report-back"');
  ok(run(`croNeedsReport(${G({ status: 'Delivered', setu: { status: 'sent_to_amazon', tried: 'shipped', error: 'x' } })})`) === true, 'a NEW status after a failed one is told');
  ['New', 'Checked', 'Problem'].forEach(s => ok(run(`croNeedsReport(${G({ status: s })})`) === false, s + ' → no call'));
  ok(run(`croNeedsReport(${G({ status: 'Shipped', source: 'team' })})`) === false, 'a team order → no call');
  ok(run(`croNeedsReport(${G({ status: 'Shipped', reference: 'ERP-CC-0001' })})`) === false, 'not a CGE- reference → no call');
  const failed = run(`croSetuLine(${G({ status: 'Shipped', lastReportError: 'Creator Setu refused (409): This gift is not approved yet.', reportFailedAt: '2026-11-18T09:05:00Z', reportedStatus: 'sent_to_amazon', reportedAt: '2026-11-17T09:00:00Z' })})`);
  ok(/Report-back failed/.test(failed) && /This gift is not approved yet/.test(failed), 'a failure shows "Report-back failed" with Creator Setu\'s words');
  ok(/18 Nov/.test(failed), '…with its time');
  ok(/id="croRetryReport"[^>]*>Retry report-back</.test(failed), '…and a "Retry report-back" button');
  ok(/Creator Setu knows: <b>sent to Amazon<\/b>/.test(failed), '…and what Creator Setu already knows');
  const good = run(`croSetuLine(${G({ status: 'Shipped', reportedStatus: 'shipped', reportedAt: '2026-11-18T09:00:00Z', lastReportError: '' })})`);
  ok(/Creator Setu knows: <b>shipped<\/b>/.test(good) && !/Retry/.test(good), 'told → "Creator Setu knows: shipped", no Retry button');
  ok(run(`croSetuLine(${G({ status: 'Shipped', source: 'team' })})`) === '', 'nothing about Creator Setu on a team order');
  const open2 = SRC.slice(SRC.indexOf('function croOpen'), SRC.indexOf('async function croSaveDrawer'));
  ok(/croRetryReport'\)\.onclick[\s\S]{0,200}croReport\(o\.reference, true\)/.test(open2), 'the Retry button asks again, past the "do not retry by itself" rule');

  console.log('== delete (19 Nov) ==');
  const gone = [];
  ctx.db = {}; ctx.doc = (d, col, id) => ({ path: col + '/' + id });
  ctx.deleteDoc = async ref => { gone.push(ref.path); };
  ctx.croMsg = () => {}; ctx.croRender = () => {}; ctx.history = { replaceState() {} }; ctx.setTimeout = () => 0;
  run(`CRO.list = [{ reference: 'CGE-NEW1', status: 'New', source: 'creator-setu' },
    { reference: 'CGE-SENT1', status: 'Sent to Amazon', source: 'creator-setu', amazon: { orderId: 'SHOP-CGESENT1' } }];
    CRO.picked.add('CGE-NEW1');`);
  ok((await run(`croDelete('CGE-NEW1')`)) === '' && gone.join() === 'creatorOrders/CGE-NEW1', 'an order not sent to Amazon is deleted from creatorOrders/<reference>');
  ok(run(`CRO.list.length === 1 && !croOf('CGE-NEW1') && !CRO.picked.has('CGE-NEW1')`), '…and leaves the list and the ticks');
  const no = await run(`croDelete('CGE-SENT1')`);
  ok(/with Amazon as SHOP-CGESENT1 — it cannot be deleted\. Set it to Cancelled instead/.test(no) && gone.length === 1, 'an order with an Amazon order id is NOT deleted — Cancelled instead');
  ctx.deleteDoc = async () => { throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }); };
  run(`CRO.list.push({ reference: 'CGE-NEW2', status: 'Checked', source: 'creator-setu' })`);
  ok(/rule for creator orders needs its delete line/.test(await run(`croDelete('CGE-NEW2')`)) && run(`!!croOf('CGE-NEW2')`), 'refused by the rules → says the rule needs its delete line, keeps the order');
  const openSrc = SRC.slice(SRC.indexOf('function croOpen'), SRC.indexOf('async function croDelete'));
  ok(/\.\.\.\(a\.orderId \? \{\} : \{ onDelete: \(\) => croDelete\(o\.reference\), deleteAllowed: true/.test(openSrc), 'the order window offers Delete only when there is no Amazon order id');
  ok(/Creator Setu is NOT told\. To tell them, set the status to Cancelled instead\./.test(openSrc), 'a Creator Setu gift warns that Creator Setu is not told');
  const rules = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-App', 'firestore.rules'), 'utf8');
  const block = rules.slice(rules.indexOf('match /creatorOrders/{ref}'), rules.indexOf('match /creatorOrders/{ref}') + 900);
  ok(/allow delete: if canCreators\(\) && !\(\('amazon' in resource\.data\) && \('orderId' in resource\.data\.amazon\)\s+&& resource\.data\.amazon\.orderId != ''\);/.test(block), 'the Firestore rule allows delete only without an Amazon order id');

  console.log('== tracking links (24 Nov) ==');
  ok(run(`croTrackUrl('UPS', '1Z999AA10123456784')`) === 'https://www.ups.com/track?tracknum=1Z999AA10123456784', 'UPS → ups.com');
  ok(run(`croTrackUrl('', '1Z999AA10123456784')`).startsWith('https://www.ups.com/'), 'a 1Z number with no carrier is UPS');
  ok(run(`croTrackUrl('USPS', '9400111899223')`).startsWith('https://tools.usps.com/'), 'USPS → usps.com');
  ok(run(`croTrackUrl('FedEx', '7712')`).startsWith('https://www.fedex.com/'), 'FedEx → fedex.com');
  ok(run(`croTrackUrl('AMZL_US', 'TBA123456789000')`) === 'https://track.amazon.com/tracking/TBA123456789000', 'Amazon (TBA…) → track.amazon.com');
  ok(run(`croTrackUrl('Some Co', '123')`) === '' && run(`croTrackUrl('UPS', '')`) === '', 'unknown carrier or no number → no link');
  const two = run(`croTrackHtml({ carrier: 'UPS', tracking: '1ZAAA, 1ZBBB' })`);
  ok((two.match(/<a /g) || []).length === 2 && /target="_blank"/.test(two) && /rel="noopener noreferrer"/.test(two), 'two numbers → two links, each opening a new tab safely');
  ok(run(`croTrackHtml({ carrier: 'X', tracking: '<b>' })`).indexOf('<b>') < 0, 'the number is escaped');
  ok(run(`croTrackHtml({})`) === '', 'no tracking → nothing');

  console.log('== steps and next step ==');
  ctx.SHOP_STOCK_LOADED = false; ctx.sdPT = t => new Date(t); ctx.nf = n => String(n);
  run(`CRO.list = [
    { reference: 'A1', status: 'New' }, { reference: 'A2', status: 'Checked' }, { reference: 'A3', status: 'Sent to Amazon', amazon: { orderId: 'SHOP-A3' } },
    { reference: 'A4', status: 'Shipped', amazon: { orderId: 'SHOP-A4', carrier: 'UPS', tracking: '1ZX' } }, { reference: 'A5', status: 'Delivered' },
    { reference: 'A6', status: 'Problem', notes: 'bad address' }, { reference: 'A7', status: 'Shipped', lastReportError: 'refused' }];
    CRO.from = ''; CRO.to = ''; CRO.store = ''; CRO.q = ''; CRO.status = ''; CRO.src = '';`);
  const lane = k => run(`CRO.lane = '${k}'; croRows().map(o => o.reference).join()`);
  ok(lane('') === 'A1,A2,A3,A4,A5,A6,A7', 'All → every order');
  ok(lane('check') === 'A1' && lane('send') === 'A2' && lane('amazon') === 'A3', 'To check / Ready to send / With Amazon');
  ok(lane('shipped') === 'A4,A7' && lane('delivered') === 'A5', 'Shipped / Delivered');
  ok(lane('attention') === 'A6,A7', 'Needs attention = Problem, Cancelled, or Creator Setu not told');
  ok(run(`CRO.lane = 'check'; croRows(true).length`) === 7, 'the step counts are taken before the step filter');
  run(`CRO.lane = ''`);
  ok(/Check product/.test(run(`croNext(croOf('A1'))`)) && /Send to Amazon/.test(run(`croNext(croOf('A2'))`)), 'next step: New → check, Checked → send');
  ok(/Waiting for Amazon/.test(run(`croNext(croOf('A3'))`)) && /not asked Amazon yet/.test(run(`croNext(croOf('A3'))`)), 'Sent → waiting, and says Amazon was not asked yet');
  ok(/ups\.com/.test(run(`croNext(croOf('A4'))`)) && /mark Delivered/.test(run(`croNext(croOf('A4'))`)), 'Shipped → the tracking link and "mark Delivered"');
  const pr = run(`croProgress({ status: 'Sent to Amazon', createdAt: '2026-11-18T10:00:00Z', checkedAt: '2026-11-18T12:00:00Z', amazon: { sentAt: '2026-11-19T07:05:00Z' } })`);
  ok((pr.match(/cro-step done/g) || []).length === 2 && (pr.match(/cro-step now/g) || []).length === 1, 'progress: New and Checked done, Sent to Amazon is now');
  ok(/cro-off/.test(run(`croProgress({ status: 'Problem', notes: 'x' })`)), 'a Problem order shows the red banner');

  console.log('== tracking is asked for by itself ==');
  const now = Date.now(), iso = ms => new Date(ms).toISOString();
  run(`CRO_ASKED.clear(); CRO.busy = false; CRO.list = [
    { reference: 'T1', status: 'Sent to Amazon', amazon: { orderId: 'SHOP-T1' } },
    { reference: 'T2', status: 'Sent to Amazon', amazon: { orderId: 'SHOP-T2', checkedAt: '${iso(now - 5 * 60e3)}' } },
    { reference: 'T3', status: 'Shipped', amazon: { orderId: 'SHOP-T3', checkedAt: '${iso(now - 2 * 3600e3)}' } },
    { reference: 'T4', status: 'Shipped', amazon: { orderId: 'SHOP-T4', tracking: '1ZDONE' } },
    { reference: 'T5', status: 'Checked' }];`);
  ok(run(`CRO.list.filter(o => croTrackDue(o)).map(o => o.reference).join()`) === 'T1,T3',
    'due: never asked, or asked over 30 min ago, and no tracking yet — not one asked 5 min ago, not one with tracking, not one not sent');
  const askedAmazon = [];
  ctx.croStatusOne = async ref => { askedAmazon.push(ref); run(`croOf('${ref}').status = 'Shipped'`); return ''; };
  ctx.location = { hash: '', hostname: 'localhost' };
  ok((await run(`croTrackAuto()`)) === 0 && askedAmazon.length === 0, 'not on the real ERP (test ERP, localhost) → Amazon is not asked');
  ctx.location = { hash: '', hostname: 'fabricrush-replenish.web.app' };
  ok((await run(`croTrackAuto()`)) === 2 && askedAmazon.join() === 'T1,T3', 'on the real ERP → asks Amazon about T1 and T3, one after the other');
  ok((await run(`croTrackAuto()`)) === 0 && askedAmazon.length === 2, 'opening the page again → not asked twice in one sitting');
  ok(/croTrackAuto\(\)/.test(SRC.slice(SRC.indexOf('async function croShow'))), 'the page asks when it opens');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
