/* CLOSING, CANCELLING AND COMPLETING A GREIGE PO (Ravi, 21 Nov). Pins the Greige Desk's rules:
 *   - "not supplied" is worked out live (a challan removed after the close still shows the right figure)
 *   - a closed PO's lines say "not supplied", never the amber "still due"
 *   - a PO nothing came on can be closed or cancelled; Cancel is refused once greige is in
 *   - only accounts (right gdpo) close, cancel and reopen; the store's "last challan" tick only ASKS, and the accounts head
 *     (right gdpoappr) approves it or turns it down with a reason
 *   - every close, cancel, reopen, request and decision leaves a history line with who
 *   - "Mark fulfilled" keeps who and when; the filter has "Closed short" and "Cancelled"
 * Loads the real src/app/flow/greige-desk.js. Made-up mills, POs and people only.
 *   node tests/greige-po-close-test.js
 *   GD_FILE=<a broken copy> node tests/greige-po-close-test.js   (the teeth check) */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = process.env.GD_FILE ? path.resolve(process.env.GD_FILE) : path.join(__dirname, '..', 'src', 'app', 'flow', 'greige-desk.js');
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' -- ' + info : '')); } };

/* The desk's own closure, opened up for the test: its inner functions are handed out just before it returns. */
function desk() {
  const anchor = '  return { open: open,';
  const code = fs.readFileSync(SRC, 'utf8');
  if (code.split(anchor).length !== 2) throw new Error('greige-desk.js: the closing "return { open" line moved; update this test');
  const names = ['gpoStatus', 'gpoProgress', 'gpoNotSupplied', 'gpoClosedBy', 'gpoClose', 'gpoReopen', 'gpoCancel', 'gpoUncancel', 'gpoAskClose',
    'gpoDecideAsk', 'poLastChallan', 'poPill', 'poPanel', 'poCloseButtons', 'poHasStatus', 'closeAsksHtml', 'dashAlerts', 'markFulfilled',
    'fulfilledBy', 'canPoClose', 'canPoApprove', 'stillDueCell', 'meUser'];
  const opened = code.replace(anchor, '  globalThis.__GDT = { ' + names.map(n => n + ': ' + n).join(', ')
    + ', setDB: function (v) { DB = v; } };\n' + anchor);
  const ctx = { console, window: { document: {} } };
  vm.createContext(ctx);
  vm.runInContext(opened, ctx);
  ctx.__GDT.signIn = me => { ctx.ME = me; };
  return ctx.__GDT;
}
const G = desk();

/* ---- the business, in its own words ---- */
const ACCOUNTS = { email: 'priya@example.test', name: 'Priya', admin: false, tabs: ['gdesk', 'gdled', 'gdpo'] };
const HEAD = { email: 'neha@example.test', name: 'Neha', admin: false, tabs: ['gdesk', 'gdled', 'gdpoappr'] };
const STORE = { email: 'ramesh@example.test', name: 'Ramesh', admin: false, tabs: ['gdesk', 'gdled', 'gdledit'] };
let seq = 0;
const po = (no, metres) => ({ id: 'po' + (++seq), poNo: no, date: '2026-10-01', mill: 'Test Mill', sent: { at: '2026-10-01' },
  lines: [{ greige: 'Greige Cambric 48', rfd: 'Cambric 44', metres: metres, rate: 44, due: '2026-10-10' }] });
const challan = (p, metres, no) => ({ id: 'f' + (++seq), chId: 'c' + seq, date: '2026-10-05', lot: 'LOT-' + seq, fabricType: 'Greige Cambric 48',
  txnType: 'RECEIVE_GREIGE', qty: metres, party: 'Test Mill', bill: no || 'TM/' + seq, orderNo: p.poNo, pieces: [{ than: '1', m: metres, chk: null }] });
const desk1 = (pos, fab) => { G.setDB({ gpo: pos, fab: fab || [], mst: [{ rfd: 'Cambric 44', greige: 'Greige Cambric 48', active: true }], ven: [], co: {}, users: [], me: '' }); };
const text = html => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const lastLog = p => (p.log || [])[(p.log || []).length - 1] || {};

console.log('== "not supplied" is worked out live ==');
{
  const p = po('PO/1', 1000), c1 = challan(p, 600), c2 = challan(p, 350);
  const fab = [c1, c2]; desk1([p], fab); G.signIn(ACCOUNTS);
  ok('part received before closing', G.gpoStatus(p) === 'part');
  ok('closing returns what never came', G.gpoClose(p, 'Priya', 'by hand') === 50);
  ok('closed → Received', G.gpoStatus(p) === 'received');
  ok('the pill says 50 m not supplied', /Received · 50 m not supplied/.test(text(G.poPill(p))));
  fab.splice(fab.indexOf(c2), 1);                          // the 350 m challan is taken out of the ledger afterwards
  ok('a challan removed after the close: the figure follows (400 m)', G.gpoNotSupplied(p) === 400 && /400 m not supplied/.test(text(G.poPill(p))));
  ok('the old field is still written for older readers', p.closed.short === 50);
  ok('a PO that is not closed has nothing "not supplied"', G.gpoNotSupplied(po('PO/X', 10)) === 0);
}

console.log('== a closed PO\'s lines say "not supplied", not "still due" ==');
{
  const p = po('PO/2', 1000); desk1([p], [challan(p, 950)]); G.signIn(ACCOUNTS);
  ok('open: amber still due', /class="due"/.test(G.stillDueCell(p, 50)));
  G.gpoClose(p, 'Priya', 'by hand');
  const html = G.poPanel(p);
  ok('closed: no amber "still due" anywhere on the PO', !/class="due"/.test(html), (html.match(/class="due"[^<]*<?[^<]*/) || [''])[0]);
  ok('closed: the line and the total say "50 m not supplied"', (text(html).match(/50 m not supplied/g) || []).length >= 3);
  ok('the footer names who closed it and how', /\(by hand, Priya\)/.test(text(html)));
  ok('"Open the PO" is gone from the footer (Print and mail on the row do it)', !/Open the PO/.test(html));
}

console.log('== a PO nothing came on: close or cancel ==');
{
  const p = po('PO/3', 900); desk1([p], []); G.signIn(ACCOUNTS);
  ok('nothing came: Sent', G.gpoStatus(p) === 'sent');
  const b = text(G.poCloseButtons(p));
  ok('accounts see Close the PO and Cancel the PO', /Close the PO/.test(b) && /Cancel the PO/.test(b));
  ok('closing at 0 received: 900 m not supplied', G.gpoClose(p, 'Priya', 'by hand') === 900 && /Received · 900 m not supplied/.test(text(G.poPill(p))));
  const q = po('PO/4', 900); desk1([q], []);
  ok('cancel: allowed while nothing came', G.gpoCancel(q, 'Priya') === '' && G.gpoStatus(q) === 'cancelled');
  ok('cancelled leaves the to-do list', !G.dashAlerts().some(a => /PO\/4/.test(a.what)));
  ok('undo cancel brings it back as Sent', (G.gpoUncancel(q, 'Priya'), G.gpoStatus(q) === 'sent' && !q.cancelled));
  const r = po('PO/5', 900); desk1([r], [challan(r, 100)]);
  ok('cancel is refused once greige is in, and says to close instead', /cannot be cancelled\. Close it instead/.test(G.gpoCancel(r, 'Priya')) && G.gpoStatus(r) === 'part');
  ok('…and no Cancel button is offered then', !/Cancel the PO/.test(G.poCloseButtons(r)));
}

console.log('== only accounts close, cancel and reopen ==');
{
  const p = po('PO/6', 500); desk1([p], [challan(p, 200)]);
  G.signIn(STORE);
  ok('the store has no close right', G.canPoClose() === false && G.poCloseButtons(p) === '');
  G.signIn(HEAD);
  ok('the accounts head\'s approval right is not the close right', G.canPoClose() === false && G.canPoApprove() === true);
  G.signIn(ACCOUNTS);
  ok('accounts may close', G.canPoClose() === true && /Close the PO/.test(G.poCloseButtons(p)));
  G.gpoClose(p, 'Priya', 'by hand');
  ok('a closed PO offers Reopen only', text(G.poCloseButtons(p)).trim() === 'Reopen the PO');
  G.gpoReopen(p, 'Priya');
  ok('reopened: part received again, 300 m due', G.gpoStatus(p) === 'part' && G.gpoProgress(p).pending === 300);
  ok('history: closed then reopened, each with who', p.log.map(e => e.what + '/' + e.by).join() === 'closed/Priya,reopened/Priya');
  ok('history lines carry a world-time moment', /^\d{4}-\d\d-\d\dT.*Z$/.test(lastLog(p).at));
}

console.log('== the store\'s last challan asks; the accounts head decides ==');
{
  const p = po('PO/7', 1000); desk1([p], [challan(p, 950, 'SBM/1241')]);
  G.signIn(STORE);
  const words = G.poLastChallan(p, 'SBM/1241', 'Ramesh');
  ok('the store\'s tick does NOT close the PO', !p.closed && G.gpoStatus(p) === 'part');
  ok('…it asks accounts, and says so', /Accounts are asked to close PO\/7/.test(words) && p.closeAsk.by === 'Ramesh' && p.closeAsk.challan === 'SBM/1241');
  ok('while waiting it still counts as due (50 m)', G.gpoProgress(p).pending === 50);
  ok('the pill says who asked', /Part received · 50 m due( · \d+ d late)? · close asked by Ramesh/.test(text(G.poPill(p))));
  ok('the to-do list has an Approve line for it', G.dashAlerts().some(a => a.tag === 'Approve' && /Close PO\/7 with 50 m not supplied/.test(a.what) && /Ramesh/.test(a.who)));
  G.signIn(STORE);
  ok('the store sees the request but no Approve button', /for the accounts head/.test(G.closeAsksHtml()) && !/data-pask/.test(G.closeAsksHtml()));
  G.signIn(HEAD);
  ok('the accounts head sees Approve and Turn down', /data-pask="PO\/7\|ok"/.test(G.closeAsksHtml()) && /data-pask="PO\/7\|no"/.test(G.closeAsksHtml()));
  ok('turning down without a reason is refused', /Type why/.test(G.gpoDecideAsk(p, 'Neha', false, '  ')) && !!p.closeAsk);
  ok('turned down with a reason: stays open, the reason is on the PO', G.gpoDecideAsk(p, 'Neha', false, 'Mill promised 50 m next week') === ''
    && !p.closed && !p.closeAsk && /Close turned down by Neha: Mill promised 50 m next week/.test(text(G.poPanel(p))));
  ok('…and in the history', lastLog(p).what === 'close turned down' && lastLog(p).by === 'Neha' && /next week/.test(lastLog(p).note));
  G.signIn(STORE); G.poLastChallan(p, 'SBM/1300', 'Ramesh');
  ok('asked again: the old "turned down" note gives way', !p.closeDown && p.closeAsk.challan === 'SBM/1300');
  G.signIn(HEAD);
  ok('approved: the PO closes', G.gpoDecideAsk(p, 'Neha', true) === '' && G.gpoStatus(p) === 'received' && !p.closeAsk);
  ok('the close names both people', G.gpoClosedBy(p) === 'asked by Ramesh on challan SBM/1300, approved, Neha');
  ok('the request card is gone once decided', G.closeAsksHtml() === '');
  ok('deciding twice is refused', /No close request/.test(G.gpoDecideAsk(p, 'Neha', true)));
}
{
  const p = po('PO/8', 1000); desk1([p], [challan(p, 900)]);
  G.signIn(ACCOUNTS);
  ok('accounts\' own tick closes at once', /PO\/8 closed with 100 m not supplied/.test(G.poLastChallan(p, 'TM/9', 'Priya')) && G.gpoClosedBy(p) === 'on challan TM/9, Priya');
  const q = po('PO/9', 1000); desk1([q], [challan(q, 900)]);
  G.signIn(STORE); G.poLastChallan(q, 'TM/10', 'Ramesh'); G.signIn(ACCOUNTS);
  G.gpoClose(q, 'Priya', 'by hand');
  ok('accounts closing a PO with a waiting request clears it, with a history line', !q.closeAsk && q.log.some(e => e.what === 'close request cleared' && /closed/.test(e.note)));
  const r = po('PO/10', 900); desk1([r], []);
  G.signIn(STORE); G.gpoAskClose(r, 'Ramesh', 'TM/11'); G.signIn(ACCOUNTS); G.gpoCancel(r, 'Priya');
  ok('cancelling a PO with a waiting request clears it too', !r.closeAsk && r.log.some(e => e.what === 'close request cleared'));
}

console.log('== the status filter ==');
{
  const short = po('PO/11', 1000), full = po('PO/12', 500), gone = po('PO/13', 100);
  desk1([short, full, gone], [challan(short, 700), challan(full, 500)]);
  G.signIn(ACCOUNTS); G.gpoClose(short, 'Priya', 'by hand'); G.gpoCancel(gone, 'Priya');
  ok('"Closed short" finds the PO closed before all of it came', G.poHasStatus(short, 'closedshort') && !G.poHasStatus(full, 'closedshort'));
  ok('…both are still "Received"', G.poHasStatus(short, 'received') && G.poHasStatus(full, 'received'));
  ok('"Cancelled" finds the cancelled one', G.poHasStatus(gone, 'cancelled') && !G.poHasStatus(short, 'cancelled'));
}

console.log('== "Mark fulfilled" keeps who and when ==');
{
  const r = { id: 'r1', done: false };
  G.markFulfilled(r, true, 'Priya');
  ok('ticked: who and a world-time moment are kept', r.done === true && r.doneBy === 'Priya' && /Z$/.test(r.doneAt));
  ok('the tooltip says who', /^Fulfilled by Priya on /.test(G.fulfilledBy(r)));
  G.markFulfilled(r, false, 'Priya');
  ok('unticked: the names go too', r.done === false && !('doneBy' in r) && !('doneAt' in r) && G.fulfilledBy(r) === '');
  ok('an old tick with no name reads "Dealt with"', G.fulfilledBy({ done: true }) === 'Dealt with');
}

console.log('== closes made before today\'s change still read ==');
{
  const p = po('PO/14', 1000); p.closed = { at: '2026-11-01', short: 50, by: 'challan SBM/9' };
  desk1([p], [challan(p, 950)]);
  ok('an old close (only "by") is shown as it was written', G.gpoClosedBy(p) === 'challan SBM/9' && G.gpoStatus(p) === 'received');
}

console.log('== one copy of each: the person comes from their own login ==');
{
  /* The desk once carried the stand-alone model's copies too (a sample users list, browser-only saving); the later
   * copies won, so the first were dead code. Removed 21 Nov; this keeps them from coming back. */
  const code = fs.readFileSync(SRC, 'utf8');
  const twice = ['lmLoad', 'lmResetSample', 'lmSaveDb', 'meUser', 'meFill', 'renderMstUsers', 'usersSafe']
    .filter(n => (code.match(new RegExp('^function ' + n + '\\(', 'gm')) || []).length !== 1);
  ok('each of the seven is written once', twice.length === 0, twice.join(', '));
  G.setDB({ gpo: [], fab: [], mst: [], ven: [], co: {}, users: [{ id: 'u1', name: 'Sample Admin', role: 'Admin', ledger: 'edit', approve: true }], me: 'u1' });
  G.signIn(STORE);
  ok('the person at the keyboard is the signed-in one, not a sample user', G.meUser().name === 'Ramesh' && G.meUser().ledger === 'edit' && G.meUser().approve === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
