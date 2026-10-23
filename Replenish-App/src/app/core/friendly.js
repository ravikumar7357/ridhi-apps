/* ================= MY WORK TODAY + SEARCH EVERYTHING (friendly add-on, 2026-10-22) =================
 *
 * Ravi liked the "My work today" layout of the preview, but wanted it on the real site with live data, and then the
 * preview's features too: one card per item with its own Approve, "Approve all", more kinds of approval, and red
 * counts on the menu groups. This file changes no existing screen; it is joined last into a local copy of the app
 * (prototypes/friendly-live). It holds:
 *
 *   MY WORK TODAY — the first screen after sign-in and the top item of the menu.
 *     Needs your approval — ONE CARD PER ITEM, each with Approve and Open:
 *       job work corrections, sales-order lines asked to be deleted, order quantity changes, sales orders
 *       awaiting approval, extra hours awaiting authorisation, printer rates
 *       waiting for approval, finished-goods corrections.
 *     Waiting for you / Problems — one card per kind, with its records and "Open list".
 *   APPROVE — always the screen's OWN approve function, the same code its button runs, after a box that says
 *     exactly what will change (the app's own dialog, ptOpenDialog). Its permission checks, its refusals and its
 *     messages are the screen's. Three kinds open the screen's own window instead, because that window asks for
 *     something first or is the safe way in: sales orders (mode and date), finished-goods corrections (the ledger
 *     must be fully loaded) — and deleting order lines asks with a red warning and is never part of Approve all.
 *   RED COUNTS ON THE MENU GROUPS — every group button shows how many items wait inside it.
 *   SEARCH EVERYTHING (Ctrl K) — jump to any screen, or "Find it in …" fills that screen's own search box.
 *
 * WHERE THE NUMBERS COME FROM: the lists the badges read at sign-in; the sales orders (as the Dashboard reads them);
 * Finance & HR through its screen's own loader (ensureHr) for those allowed to approve there;
 * and this page's own read-only copy of the finished-goods ledger (fgiLoad is not used: it can rewrite the Amazon
 * listings index). */

const FR = { built: false, shown: false, sel: 0, items: [], fg: null, at: '', loading: false, cards: [], tick: new Set(), subOpen: new Set() };
const frMay = tab => !!(ME && (ME.admin || (ME.tabs || []).includes(tab)));
const frTry = (f, d) => { try { return f(); } catch (e) { return d; } };
const frNum = v => Number(v) || 0;
const frQ = s => s ? `“${String(s).slice(0, 80)}”` : '';
/** Wait for the screen a button opened to have its data, then do the next step (up to ~8 s). */
function frWhen(ready, then, n = 40) { if (frTry(ready, false)) return then(); if (n > 0) setTimeout(() => frWhen(ready, then, n - 1), 200); }
/** Open Finished Goods at one of its views (pending / corr / over / alerts), once its list has loaded. */
function frFgView(v) { showTab('fgi'); frWhen(() => FGI.rows, () => { $('fgView').value = v; renderFgi(); }); }
const frGates = async () => { if (typeof ptLoadGates === 'function') await ptLoadGates(); };

/* ---------- the work ---------- */

/** Every card: approvals one per item; waiting and problems one per kind. A card is
 *  { grp, tab, title, detail, lines, n, open, act } and act = { label, what(), prep(), run() → '' | error,
 *  bulk (may go in Approve all), danger, own (opens the screen's own window instead of asking here) }. */
function frCards() {
  const C = [], fg = FR.fg || [];
  const item = (tab, title, detail, open, act) => C.push({ grp: 'approve', tab, key: tab + '|' + title, title, detail, n: 1, open, act });
  const kind = (grp, tab, n, title, lines, open) => { if (n > 0) C.push({ grp, tab, n, key: grp + '|' + tab + '|' + title.replace(/[\d,]+ pcs/, ''), title: `${n.toLocaleString('en-IN')} ${title}`, lines: lines.slice(0, 3), more: Math.max(0, lines.length - 3), open }); };

  /* Job work corrections — jwCorrApprove(id), which needs the job-work rows (ptLoadGates). */
  if (frMay('pbase') && frTry(ptCanEdit, false) && JWC.rows) jwCorrPending().forEach(q => {
    const own = q.by === ME.email && !ME.admin, adminOnly = Object.keys(q.change || {}).some(k => JWC_ADMIN_ONLY.indexOf(k) >= 0) && !ME.admin;
    item('pbase', `Job work correction · ${q.empName || '—'} · ${q.sku || ''}`, [frQ(q.why), q.orderNo, q.by && 'asked by ' + q.by].filter(Boolean).join(' · '),
      () => { showTab('pbase'); setTimeout(jwCorrListOpen, 300); },
      own || adminOnly ? null : {
        label: 'Approve', bulk: true, prep: async () => { await frGates(); if (!JWC.rows) await jwCorrLoad(); },
        what: () => { const row = frTry(() => (PT.base || {})[q.rowId] || (PT.base || []).find && PT.base.find(r => r && (r.id === q.rowId || r._id === q.rowId)), null);
          const d = row ? frTry(() => jwCorrDiff(row, q.change), []) : [];
          return `Job work entry for ${q.empName || '—'} (${q.sku || ''}) changes: ${d.length ? d.map(x => `${x[0]} ${x[1]} → ${x[2]}`).join(', ') : Object.entries(q.change || {}).map(([k, v]) => `${k} → ${v}`).join(', ')}.`; },
        run: () => jwCorrApprove(q.id) });
  });
  /* Sales-order lines asked to be deleted — odrDeleteRun([id]) really deletes them: red warning, never in Approve all. */
  if (frMay('so') && frTry(odrCanAnswer, false) && ODR.rows) odrPending().forEach(r => item('so', `Delete ${r.sku || ''} from sales order ${r.orderNo || ''}`,
    [`${frNum(r.qty)} pcs`, frQ(r.why), r.by && 'asked by ' + r.by].filter(Boolean).join(' · '),
    () => { showTab('so'); setTimeout(odrListOpen, 300); },
    { label: 'Delete line', danger: true, prep: frGates,
      what: () => `This DELETES ${r.sku} (${frNum(r.qty)} pcs) from sales order ${r.orderNo} and from the order book. Work already booked against it (cut ${frNum((r.work || {}).cut)}, issued ${frNum((r.work || {}).issued)}) is kept. It cannot be undone here.`,
      run: () => odrDeleteRun([r.id]) }));
  /* Order quantity changes — ordQtyApprove(orderNo, logId); needs the sales orders and the order book. */
  if (frMay('ord') && SOX.rows) {
    const r = [];
    SOX.rows.forEach(o => o && Object.values(o.qtyAdjustments || {}).forEach(a => { if (soQtyStage(a) === 'pending') r.push(Object.assign({ orderNo: o._id || o.id }, a)); }));
    r.sort((a, b) => String(a.at || '').localeCompare(String(b.at || ''))).forEach(a => item('ord', `Quantity change · ${a.orderNo} · ${a.sku || ''}: ${frNum(a.from)} → ${frNum(a.to)}`,
      [frQ(a.why), a.by && 'by ' + a.by].filter(Boolean).join(' · '),
      () => { showTab('ord'); frWhen(() => SOX.rows, ordQtyListOpen); },
      frTry(ordQtyCanApprove, false) ? { label: 'Approve', bulk: true, prep: frGates,
        what: () => `Order ${a.orderNo}, ${a.sku}: the quantity becomes ${frNum(a.to)} (was ${frNum(a.from)}) in the sales order and the order book.`,
        run: () => ordQtyApprove(a.orderNo, a.id) } : null));
  }
  /* Vendor requests and RFD requirements are not shown: their screens have been off the menu since 15 Oct (PPC does
   * that work now; Ravi, 22 Oct: "remove the vendor request and RFD cards"). */
  /* Sales orders awaiting approval — the screen's own Review window (it asks for the delivery mode and date). */
  if (frMay('so') && frTry(soCanApprove, false) && SOX.rows) SOX.rows.filter(o => o && frTry(() => soStatus(o), '') === 'submitted').forEach(o => {
    const s = frTry(() => soSummary(o, soWork()), {});
    item('so', `Sales order ${o._id || o.id} awaiting approval`, [o.buyerName || o.buyerEmail, o.channel, s.qty && `${s.qty} pcs`, s.skus && `${s.skus} SKUs`].filter(Boolean).join(' · '),
      () => showTab('so'),
      ME.admin ? { label: 'Review', own: true, run: async () => { await frGates(); soReview(o._id || o.id); return ''; } } : null);
  });
  /* Extra hours awaiting authorisation (they feed the payouts) — ehSetOne(id, true), admins only. */
  if (frMay('hr') && ME.admin && HR.eh) HR.eh.filter(r => (r.status || 'pending') === 'pending').forEach(r => item('hr',
    `Extra hours · ${r.empName || ''} · ${frNum(r.hours)} h`,
    [r.date, r.fromTime && r.toTime && `${r.fromTime}–${r.toTime}`, r.department, (r.enteredByName || r.enteredBy) && 'entered by ' + (r.enteredByName || r.enteredBy)].filter(Boolean).join(' · '),
    () => showTab('hr'),
    { label: 'Authorise', bulk: true, what: () => `Authorises ${frNum(r.hours)} extra hours for ${r.empName} on ${r.date}. They count in the payout.`,
      run: async () => { await ehSetOne(r.id, true); const now = (HR.eh || []).find(x => x.id === r.id);
        return now && now.status === 'authorized' ? '' : (($('hrMsg') && $('hrMsg').textContent) || 'Not authorised.'); } }));
  /* Printer rates waiting for approval — prSetOk(index, true); the index is looked up at the moment of approving. */
  if (frMay('hr') && frTry(prCanApprove, false) && HR.prate) HR.prate.filter(r => frTry(() => prStatus(r), '') === 'Pending').forEach(r => item('hr',
    `Printer rate · ${frTry(() => voName(r.vendor), r.vendor)} · ${frTry(() => prWhat(r), r.service || '')}`,
    [`₹${r.rate}`, r.by && 'set by ' + r.by, r.notes].filter(Boolean).join(' · '),
    () => showTab('hr'),
    { label: 'Approve', bulk: true, what: () => `Approves the rate ₹${r.rate} for ${frTry(() => voName(r.vendor), r.vendor)} (${frTry(() => prWhat(r), '')}).`,
      run: async () => { const i = HR.prate.indexOf(r); if (i < 0) return 'This rate has changed — open Finance & HR.'; return (await prSetOk(i, true)) || ''; } }));
  /* Finished-goods corrections — the screen's own Corrections view (approving needs the whole ledger loaded). */
  if (frMay('fgi') && frTry(fgiCanEdit, false) && FGC.rows) Object.values(FGC.rows).filter(x => x && x.status === 'pending').forEach(x => item('fgi',
    `Finished goods correction · ${x.sku || ''} · ${x.kind === 'delete' ? 'remove' : 'edit'} ${x.txnType || ''}`,
    [frQ(x.why), x.by && 'asked by ' + x.by].filter(Boolean).join(' · '),
    () => frFgView('corr'), { label: 'Review', own: true, run: async () => { frFgView('corr'); return ''; } }));

  /* Waiting for you */
  if (frMay('fba') && FR.fg) {
    const r = fg.filter(x => x && x.txnType === 'FBA' && frTry(() => fbaState(x).st, '') === 'waiting');
    kind('wait', 'fba', r.length, `FBA dispatch${r.length > 1 ? 'es' : ''} to accept · ${r.reduce((s, x) => s + frNum(x.qty), 0).toLocaleString('en-IN')} pcs`,
      r.map(x => `${x.sku || ''} · ${frNum(x.qty)} pcs${x.issuedFor ? ' · ' + x.issuedFor : ''}${x.date ? ' · ' + x.date : ''}`), () => showTab('fba'));
  }
  if (frMay('fgi') && FR.fg) {
    const r = fg.filter(x => x && x.txnType === 'TRANSFER_IN' && x.confirmed !== true && x.reversed !== true);
    kind('wait', 'fgi', r.length, `transfer${r.length > 1 ? 's' : ''} waiting to be counted into Finished Goods`,
      r.map(x => `${x.sku || ''} · ${frNum(x.qty)} pcs${x.createdBy ? ' · from ' + x.createdBy : ''}`), () => frFgView('pending'));
  }
  if (frMay('follow') && Array.isArray(PO) && PO.length) {
    const r = PO.map(p => ({ p, f: frTry(() => poFollow(p), {}) })).filter(x => x.f.ongoing && (x.f.dueNow || x.f.overdue))
      .sort((a, b) => (b.f.overdue - a.f.overdue) || String(a.p.eta || '').localeCompare(String(b.p.eta || '')));
    kind('wait', 'follow', r.length, `purchase order${r.length > 1 ? 's' : ''} to follow up`,
      r.map(({ p, f }) => `${p.id} · ${p.supplier || ''}${p.eta ? ' · ETA ' + p.eta : ''}${f.overdue ? ' · overdue' : ''}`), () => showTab('follow'));
  }
  /* Problems */
  if (frMay('repl') && REPL && (REPL.SP || REPL.CPC)) {
    const r = [].concat((REPL.SP && REPL.SP.rows) || [], (REPL.CPC && REPL.CPC.rows) || [])
      .filter(x => x && !(frNum(x.totalStock) > 0) && !(frNum(x.awdAvail) > 0) && frNum(x.last30) > 0).sort((a, b) => frNum(b.last30) - frNum(a.last30));
    kind('bad', 'repl', r.length, `SKU${r.length > 1 ? 's' : ''} selling but out of stock on Amazon`, r.map(x => `${x.sku} · sold ${frNum(x.last30)} in the last 30 days`), () => showTab('repl'));
  }
  if (frMay('fgi') && LST.alerts) {
    const r = frTry(lstOpen, []);
    kind('bad', 'fgi', r.length, `finished good${r.length > 1 ? 's' : ''} not listed on Amazon`, r.map(x => `${x.sku || x}${x.lastQty ? ' · ' + x.lastQty + ' pcs received' : ''}`), () => frFgView('alerts'));
  }
  if (frMay('fgi') && frTry(fgiCanEdit, false) && FR.fg) {
    const r = fg.filter(x => x && x.txnType === 'RECEIVE' && frNum(x.overQty) > 0 && x.overStatus === 'open');
    kind('bad', 'fgi', r.length, `receipt${r.length > 1 ? 's' : ''} with more pieces than the order`,
      r.map(x => `${x.sku || ''} · ${x.orderNo || ''} · ${frNum(x.overQty)} over${x.overReason ? ' ' + frQ(x.overReason) : ''}`), () => frFgView('over'));
  }
  return C;
}

/** What the page needs beyond the sign-in loads. SPEED (Ravi, 22 Oct: "it's taking time to load"): nothing big is
 *  read while the site is still opening — the page draws at once from what sign-in already read, and the big lists
 *  follow ONE AT A TIME (they used to start together and queue behind the site's own first screen), each drawn as
 *  it arrives: sales orders first (quantity changes and orders to approve), then the finished-goods ledger, then
 *  Finance & HR, which needs the most. */
async function frLoad(force) {
  if (FR.loading) return;
  FR.loading = true; frDraw();
  const jobs = [];
  if ((frMay('ord') || frMay('so')) && (force || !SOX.rows)) jobs.push(() => ptGet('pt_salesOrders').then(v => { SOX.rows = ptList(v); }));
  if ((frMay('fba') || frMay('fgi')) && (force || !FR.fg)) jobs.push(() => ptGet('pt_fgiLedger').then(v => { FR.fg = ptList(v); }));
  if (force) {
    if (frMay('pbase') && frTry(ptCanEdit, false)) jobs.push(() => jwCorrLoad());
    if (frMay('so') && frTry(odrCanAnswer, false)) jobs.push(() => odrLoad(true));
    if (frMay('fgi') && frTry(fgiCanEdit, false)) jobs.push(() => fgiCorrLoad());
  }
  if (frMay('hr') && (ME.admin || frTry(prCanApprove, false)) && (force || HR.emp === null)) jobs.push(() => { if (force) HR.emp = null; return ensureHr(); });
  for (const job of jobs) {
    try { await job(); } catch (e) { console.warn('[my work]', e); }
    frDraw(); frCount();
  }
  FR.loading = false;
  FR.at = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  FR.known = frKnown();
  frDraw(); frCount();
}

/* ---------- approving ---------- */

/** One item: a box that says what will change; Yes runs the screen's own approve. A refusal stays in the box. */
async function frAsk(c) {
  const a = c.act;
  if (a.own) return a.run();
  ptOpenDialog({ title: `${a.label}?`, subtitle: c.title, note: 'Getting the details…', saveLabel: a.danger ? `Yes, ${a.label.toLowerCase()}` : `Yes, ${a.label.toLowerCase()}`,
    onSave: async () => { const e = await a.run(); if (!e) frDone(`${a.label === 'Delete line' ? 'Deleted' : a.label === 'Authorise' ? 'Authorised' : 'Approved'} · ${c.title}`); return e || ''; } });
  try { if (a.prep) await a.prep(); $('ptDlgNote').textContent = a.what(); }
  catch (e) { ptDlgMsg('Could not load the details: ' + (e.message || e), true); }
  if (a.danger) $('ptDlgNote').style.color = 'var(--bad,#850000)';
}
/** Approve all: every item in the list that can be approved here (deleting lines and the screen-window kinds are
 *  left out), one after another, with each screen's own approve. What was refused is listed. */
function frAskAll(list) {
  ptOpenDialog({ title: `Approve all ${list.length}?`, subtitle: 'Each one runs the same approve as its own screen.',
    note: list.map(c => '• ' + c.title).slice(0, 12).join('\n') + (list.length > 12 ? `\n… and ${list.length - 12} more` : ''), saveLabel: `Yes, approve ${list.length}`,
    onSave: async () => {
      const bad = [];
      for (const c of list) {
        ptDlgMsg(`Approving ${list.indexOf(c) + 1} of ${list.length}…`);
        try { if (c.act.prep) await c.act.prep(); const e = await c.act.run(); if (e) bad.push(`${c.title}: ${e}`); }
        catch (e) { bad.push(`${c.title}: ${e.message || e}`); }
      }
      list.forEach(c => FR.tick.delete(c.key));
      frDone(`${list.length - bad.length} of ${list.length} approved`);
      return bad.length ? `${list.length - bad.length} done. Not done:\n${bad.join('\n')}` : '';
    } });
}
function frDone(msg) {
  frDraw(); frCount();
  frToast('✓ ' + msg, null, 3500);
}

/* ---------- the screen ---------- */

const FR_GROUPS = [['approve', 'Needs your approval', 'fr-warn', '✓'], ['wait', 'Waiting for you', 'fr-go', '⏳'], ['bad', 'Problems', 'fr-bad', '!']];
/* APPROVALS IN GROUPS (Ravi, 23 Oct: "need your approval … better like grouping, approve at once in a single go"):
 * one group per kind of approval, each with its own "Approve all N"; tick boxes pick any set, across the groups, for
 * one "Approve N ticked". A long group shows its first few, with "Show all". Deleting lines and the kinds that open
 * the screen's own window have no tick box — they are never approved in a batch. */
const FR_SUBS = [[/^Job work correction/, 'Job work corrections'], [/^Quantity change/, 'Order quantity changes'],
  [/^Extra hours/, 'Extra hours to authorise'], [/^Printer rate/, 'Printer rates'], [/^Sales order/, 'Sales orders to review'],
  [/^Finished goods correction/, 'Finished goods corrections'], [/^Delete /, 'Lines asked to be deleted']];
const FR_SUB_SHOW = 4;
const frSub = c => { const i = FR_SUBS.findIndex(s => s[0].test(c.title)); return i < 0 ? FR_SUBS.length : i; };
const frSubName = i => (FR_SUBS[i] || [0, 'Other approvals'])[1];
const frTickable = c => c.grp === 'approve' && c.act && c.act.bulk;
/* VIEWING AS (admins): the page as one of the roles (roles.js — R-one's own menu groups and permissions) would see
 * it. A card shows when the role holds its screen, and an approval only when the role also holds the
 * permission that approval needs. It only filters this page; the admin's own access stays the same. */
const FR_VIEWS = [['', 'Me (everything)']].concat((typeof R1_ROLES !== 'undefined' ? R1_ROLES : []).map(r => [r.key, r.name]));
/** The permission an approval card needs, beyond its screen (as the screens' own can-approve checks). */
function frCardPerm(c) {
  if (c.grp !== 'approve') return null;
  if (c.tab === 'pbase') return 'prodEdit';
  if (c.tab === 'fgi') return 'fgiEdit';
  if (c.tab === 'hr') return /^Extra hours/.test(c.title) ? 'admin' : 'rateApprove';
  if (c.tab === 'so' && /^Sales order/.test(c.title)) return 'admin';   // the Review window is admins only
  return null;
}
const frInView = c => {
  const r = FR.view && typeof R1_ROLES !== 'undefined' && R1_ROLES.find(x => x.key === FR.view);
  if (!r || r.admin) return true;
  const screen = r.tabs.includes(c.tab) || (c.tab === 'follow' && r.tabs.includes('repl'));
  const perm = frCardPerm(c);
  return screen && (!perm || (perm !== 'admin' && r.perms.includes(perm)));
};

/* WHAT'S NEW: the approvals this person has not seen on this page before (kept per person, in this browser). */
const frSeenKey = () => 'frSeen:' + ((ME && ME.email) || 'anon');
function frSeen() { try { return new Set(JSON.parse(localStorage.getItem(frSeenKey()) || '[]')); } catch (e) { return new Set(); } }
function frSeenSave(keys) { try { localStorage.setItem(frSeenKey(), JSON.stringify([...keys].slice(-800))); } catch (e) { /* this visit only */ } }
const frNew = cards => { const s = frSeen(); return cards.filter(c => c.key && !s.has(c.key)); };

/** FINISHED THIS WEEK: approvals answered in the last 7 days, read off the same lists (the dates each screen stamps). */
function frFinished() {
  const since = Date.now() - 7 * 864e5, recent = v => { const t = typeof v === 'number' ? v : Date.parse(v || ''); return t && t >= since; };
  let n = 0;
  if (frMay('pbase') && JWC.rows) n += Object.values(JWC.rows).filter(q => q && q.status === 'approved' && recent(q.answeredAt)).length;
  if (frMay('so') && ODR.rows) n += ODR.rows.filter(r => r && /deleted|kept/.test(r.status || '') && recent(r.answeredAt)).length;
  if (frMay('fgi') && FGC.rows) n += Object.values(FGC.rows).filter(q => q && q.status === 'approved' && recent(q.answeredAt)).length;
  if ((frMay('ord') || frMay('so')) && SOX.rows) SOX.rows.forEach(o => {
    if (!o) return;
    if (recent(o.approvedAt)) n++;
    Object.values(o.qtyAdjustments || {}).forEach(a => { if (soQtyStage(a) === 'applied' && recent(a.decidedAt)) n++; });
  });
  if (frMay('hr') && HR.eh) n += HR.eh.filter(r => r && r.status === 'authorized' && recent(r.authorizedAt)).length;
  return n;
}

function frDraw() {
  if (!FR.shown) return;
  const all0 = frCards().filter(frInView), later = all0.filter(frIsLater);
  const shown = all0.filter(c => !frIsLater(c));
  /* approvals kind by kind (a stable sort keeps each kind's own order), so J/K walk them as they are drawn */
  const cards = FR.cards = shown.filter(c => c.grp === 'approve').map((c, i) => [c, i]).sort((a, b) => (frSub(a[0]) - frSub(b[0])) || (a[1] - b[1])).map(x => x[0])
    .concat(shown.filter(c => c.grp !== 'approve')), g = k => cards.filter(c => c.grp === k);
  const n = k => g(k).reduce((s, c) => s + c.n, 0);
  const name = (ME.name || (ME.email || '').split('@')[0] || '').replace(/[._].*$/, '').replace(/^\w/, c => c.toUpperCase());
  const h = new Date().getHours(), hello = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const total = n('approve') + g('wait').length + g('bad').length;
  const bulk = g('approve').filter(c => c.act && c.act.bulk);
  const fresh = new Set(frNew(cards).map(c => c.key));
  const scr = t => (frScreens().find(s => s.tab === t) || {}).name || '';
  FR.tick = new Set([...FR.tick].filter(k => bulk.some(c => c.key === k)));   // gone or approved: no longer ticked
  const ticked = bulk.filter(c => FR.tick.has(c.key)), card = c => frCardHtml(c, cards, fresh, scr);
  $('frHome').innerHTML = `
    <div class="fr-head2"><div><h1>${esc(hello)}${name ? ', ' + esc(name) : ''}</h1>
      <div class="fr-sub2">${total ? `${total} thing${total > 1 ? 's' : ''} need${total > 1 ? '' : 's'} you today.${n('approve') ? ' Start with the approvals.' : ''}` : FR.loading ? 'Checking what is waiting…' : 'Nothing is waiting for you right now.'}</div>
      <div class="fr-when">${FR.loading ? 'Checking…' : `Last checked ${FR.at || '—'}`} · <button type="button" data-fr-ref>↻ Refresh</button></div></div>
      <div class="fr-hright">${ME.admin ? `<label class="fr-view" title="What this page shows to one role — your own access stays the same">Viewing as <select data-fr-view>${FR_VIEWS.map(v => `<option value="${v[0]}"${(FR.view || '') === v[0] ? ' selected' : ''}>${v[1]}</option>`).join('')}</select></label>` : ''}
        ${ME.admin ? '<button type="button" class="fr-how" data-fr-roles title="Ready-made roles: what each one gets in R-one">Roles</button>' : ''}
        <button type="button" class="fr-how" data-fr-how>How this page works</button></div></div>
    ${frAlertCan() && !frAlertOn() && Notification.permission !== 'denied' && !FR.alertHide ? `<div class="fr-alertask"><span>🔔 <b>Get a desktop alert</b> when something new needs you — even when R-one is behind other windows.</span><button type="button" class="fr-yes" data-fr-alert-on>Turn on</button><button type="button" class="fr-later" data-fr-alert-no>Not now</button></div>` : ''}
    <div class="fr-stats">
      <button type="button" class="fr-stat fr-warn" data-fr-jump="approve"><b>${n('approve')}</b><span>Need your approval</span></button>
      <button type="button" class="fr-stat" data-fr-jump="wait"><b>${n('wait').toLocaleString('en-IN')}</b><span>Waiting for you</span></button>
      <button type="button" class="fr-stat fr-bad" data-fr-jump="bad"><b>${n('bad').toLocaleString('en-IN')}</b><span>Problems</span></button>
      <div class="fr-stat fr-done"><b>${frFinished()}</b><span>Finished this week</span></div>
    </div>
    ${FR_GROUPS.map(([k, title, cls, icon]) => g(k).length ? `<div class="fr-grp" data-fr-grp="${k}"><h3><span>${title} · ${n(k).toLocaleString('en-IN')}</span>${k === 'approve' && bulk.length > 1 ? `<button type="button" class="fr-all" data-fr-all>Approve all ${bulk.length}</button>` : ''}</h3>${k === 'approve' ? frSubsHtml(g(k), card, ticked) : g(k).map(card).join('')}</div>` : '').join('')}
    ${total ? '' : `<div class="fr-empty">${FR.loading ? '' : '✓'}</div>`}
    ${later.length ? `<div class="fr-snz">${later.length} moved to later · <button type="button" data-fr-unlater>Show them now</button></div>` : ''}
    <div class="fr-tip2">Approve runs the same approve as the screen itself, after showing what will change. Tick several to approve them in one go. Looking for something else? Press <kbd>Ctrl</kbd> <kbd>K</kbd>. Keys: <kbd>J</kbd> <kbd>K</kbd> move · <kbd>A</kbd> approve · <kbd>O</kbd> open · <kbd>L</kbd> later · <kbd>H</kbd> all keys</div>
    <div class="fr-tickbar${ticked.length ? '' : ' hide'}"><b>${ticked.length} ticked</b><button type="button" class="fr-yes" data-fr-tickgo>Approve ${ticked.length} ticked</button><button type="button" class="fr-later" data-fr-tickclr>Clear</button></div>`;
  frWire(cards, bulk, ticked);
}
/** One card. An approval that can go in a batch has a tick box where the others have their mark. */
function frCardHtml(c, cards, fresh, scr) {
  const [, , cls, icon] = FR_GROUPS.find(x => x[0] === c.grp), i = cards.indexOf(c);
  return `
      <div class="fr-card${i === FR.k ? ' fr-kf' : ''}${FR.tick.has(c.key) ? ' fr-ticked' : ''}" data-fr-i="${i}">${frTickable(c) ? `<label class="fr-tick" title="Tick to approve together with others"><input type="checkbox" data-fr-tick="${i}"${FR.tick.has(c.key) ? ' checked' : ''}></label>` : `<div class="fr-dot ${cls}">${icon}</div>`}
        <div class="fr-body"><b>${esc(c.title)}${fresh.has(c.key) ? '<i class="fr-new">NEW</i>' : ''}</b>${c.detail ? `<span>${esc(c.detail)}</span>` : ''}${(c.lines || []).map(l => `<span>${esc(l)}</span>`).join('')}${c.more ? `<span class="fr-more">+ ${c.more.toLocaleString('en-IN')} more</span>` : ''}<em>${esc(scr(c.tab))}</em></div>
        <div class="fr-acts">${c.act ? `<button type="button" class="fr-yes${c.act.danger ? ' fr-danger' : ''}" data-fr-act="${i}">${esc(c.act.label)}</button>` : ''}
          <button type="button" class="fr-go" data-fr-open="${i}">${c.grp === 'approve' ? 'Open →' : 'Open list →'}</button>
          <button type="button" class="fr-later" data-fr-later="${i}" title="Hide it from this page until ${frLaterTxt()}">Later</button></div></div>`;
}
/** The approvals, kind by kind: a heading with a tick-all box and "Approve all N", then the cards (the first few of a
 *  long kind, and "Show all"). */
function frSubsHtml(list, card, ticked) {
  const subs = [...new Set(list.map(frSub))];
  return subs.map(s => {
    const mine = list.filter(c => frSub(c) === s), tk = mine.filter(frTickable), open = FR.subOpen.has(s) || mine.length <= FR_SUB_SHOW + 1;
    const all = tk.length && tk.every(c => FR.tick.has(c.key));
    return `<div class="fr-sub" data-fr-sub="${s}"><div class="fr-subh">${tk.length ? `<label class="fr-tick" title="Tick all ${tk.length}"><input type="checkbox" data-fr-subtick="${s}"${all ? ' checked' : ''}></label>` : ''}
        <b>${esc(frSubName(s))}</b><span class="fr-subn">${mine.length}</span>${tk.length > 1 ? `<button type="button" class="fr-suball" data-fr-suball="${s}">Approve all ${tk.length}</button>` : ''}</div>
      ${(open ? mine : mine.slice(0, FR_SUB_SHOW)).map(card).join('')}${open ? '' : `<button type="button" class="fr-showall" data-fr-subopen="${s}">Show all ${mine.length} ${esc(frSubName(s).toLowerCase())}</button>`}</div>`;
  }).join('');
}
/** The page's buttons and tick boxes. */
function frWire(cards, bulk, ticked) {
  const H = $('frHome');
  H.querySelectorAll('[data-fr-tick]').forEach(b => b.onchange = () => { const c = cards[+b.dataset.frTick]; b.checked ? FR.tick.add(c.key) : FR.tick.delete(c.key); frDraw(); });
  H.querySelectorAll('[data-fr-subtick]').forEach(b => b.onchange = () => {
    const s = +b.dataset.frSubtick; cards.filter(c => frTickable(c) && frSub(c) === s).forEach(c => b.checked ? FR.tick.add(c.key) : FR.tick.delete(c.key));
    if (b.checked) FR.subOpen.add(s);   // what is ticked is on show
    frDraw();
  });
  H.querySelectorAll('[data-fr-suball]').forEach(b => b.onclick = () => frAskAll(bulk.filter(c => frSub(c) === +b.dataset.frSuball)));
  H.querySelectorAll('[data-fr-subopen]').forEach(b => b.onclick = () => { FR.subOpen.add(+b.dataset.frSubopen); frDraw(); });
  const go = H.querySelector('[data-fr-tickgo]'); if (go) go.onclick = () => frAskAll(ticked);
  const clr = H.querySelector('[data-fr-tickclr]'); if (clr) clr.onclick = () => { FR.tick.clear(); frDraw(); };
  H.querySelectorAll('[data-fr-open]').forEach(b => b.onclick = () => cards[+b.dataset.frOpen].open());
  H.querySelectorAll('[data-fr-act]').forEach(b => b.onclick = () => frAsk(cards[+b.dataset.frAct]));
  const all = H.querySelector('[data-fr-all]'); if (all) all.onclick = () => frAskAll(bulk);
  H.querySelectorAll('[data-fr-jump]').forEach(b => b.onclick = () => { const s = H.querySelector(`[data-fr-grp="${b.dataset.frJump}"]`); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  H.querySelector('[data-fr-ref]').onclick = () => frLoad(true);
  H.querySelector('[data-fr-how]').onclick = frHow;
  const rl = H.querySelector('[data-fr-roles]'); if (rl) rl.onclick = frRoles;
  H.querySelectorAll('[data-fr-later]').forEach(b => b.onclick = () => frLater(cards[+b.dataset.frLater]));
  const un = H.querySelector('[data-fr-unlater]'); if (un) un.onclick = () => { frLaterSave({}); frDraw(); };
  const ao = H.querySelector('[data-fr-alert-on]'); if (ao) ao.onclick = () => frAlertSet(true);
  const an = H.querySelector('[data-fr-alert-no]'); if (an) an.onclick = () => { FR.alertHide = true; frDraw(); };
  const vw = H.querySelector('[data-fr-view]'); if (vw) vw.onchange = () => { FR.view = vw.value; frDraw(); };
}

/* ROLES (admins) — the ready-made roles (roles.js, made from R-one's own access): each one's screens and permissions,
 * in the menu's words. "View as" shows this page as that role. */
const FR_TAB_NAMES = { flppc: 'PPC', fldem: 'Demand', flacc: 'Accessories (flow)', flchl: 'Challans', flcut: 'To cut', flraw: 'Raw cutting',
  flwip: 'WIP', gdesk: 'Greige Desk', gdled: 'Greige ledger', gdledit: 'Greige corrections', gdappr: 'Greige approvals',
  qcalt: 'QC — alteration out', qcret: 'QC — alteration back', vend: 'Vendor portal', mst: 'Masters', shopret: 'Shopify returns' };
function frRoles() {
  const menu = Object.fromEntries(frScreens().map(s => [s.tab, s.name]));
  const scr = t => FR_TAB_NAMES[t] || menu[t] || t;
  ptOpenDialog({ title: 'Roles — what each one gets in R-one', subtitle: `${R1_ROLES.length} roles, made from R-one's own menu groups and permissions.`,
    note: 'Not in any role: approving vendor requests and RFD, marking RFD fabric sent, accepting printer deliveries — their screens have been off the menu since 15 Oct (PPC does that work now).',
    html: `<div class="fr-roles">${R1_ROLES.map(r => `<div class="fr-role">
        <div class="fr-role-h"><b>${esc(r.name)}</b><span>${esc(r.hi)}</span><button type="button" class="fr-go" data-fr-as="${r.key}">View as</button></div>
        <p>${esc(r.job)}</p>
        <div><i>Screens</i> ${r.admin ? '<em>Everything (Admin)</em>' : r.tabs.map(t => `<em>${esc(scr(t))}</em>`).join('')}</div>
        <div><i>Permissions</i> ${r.admin ? '<em>Everything (Admin)</em>' : (r.perms.map(p => `<em>${esc(R1_PERM_BOX[p][1])}</em>`).join('') || '<small>none</small>')}</div>
        ${r.note ? `<small>${esc(r.note)}</small>` : ''}</div>`).join('')}</div>`,
    saveLabel: 'Close', onSave: () => '' });
  document.querySelectorAll('[data-fr-as]').forEach(b => b.onclick = () => { FR.view = b.dataset.frAs; ptDlgClose(); frDraw(); window.scrollTo({ top: 0 }); });
}

/* HOW THIS PAGE WORKS — the same help as every screen's, in English and Hindi; "Show me" hands over to Meera. */
const FR_HELP = {
  en: 'My work today gathers everything waiting for you, from every screen you use.\n\n'
    + '1. Needs your approval — one card per item. Approve shows what will change; Yes runs the same approve as the screen itself. Open takes you to it on its own screen.\n'
    + '2. Waiting for you and Problems — one card per kind of work. Open list goes straight to that list.\n'
    + '3. The red numbers on the menu say how many items wait on each screen. NEW marks what arrived since you last looked; the bell lists them.\n\n'
    + 'Press Ctrl K anywhere to find a screen, an order or a SKU.',
  hi: 'My work today में आपकी हर स्क्रीन का बाकी काम एक जगह दिखता है।\n\n'
    + '1. Needs your approval — हर काम का अलग कार्ड। Approve दबाने पर दिखता है कि क्या बदलेगा; Yes दबाते ही वही approve होता है जो उस स्क्रीन पर होता है। Open से वो स्क्रीन खुलती है।\n'
    + '2. Waiting for you और Problems — हर तरह के काम का एक कार्ड। Open list से वही लिस्ट खुलती है।\n'
    + '3. मेन्यू पर लाल नंबर बताते हैं कि किस स्क्रीन पर कितना काम बाकी है। NEW का मतलब है पिछली बार के बाद आया काम; घंटी में उनकी लिस्ट है।\n\n'
    + 'कहीं भी Ctrl K दबाकर कोई स्क्रीन, ऑर्डर या SKU ढूँढें।'
};
function frHow() {
  const hi = (() => { try { return localStorage.getItem('guideLang') === 'hi'; } catch (e) { return false; } })();
  ptOpenDialog({ title: hi ? 'My work today कैसे काम करता है' : 'How My work today works', note: FR_HELP[hi ? 'hi' : 'en'], saveLabel: hi ? 'समझ गया' : 'Got it',
    onSave: () => '', alt: typeof guideStart === 'function' ? { label: hi ? 'मीरा से दिखाओ' : 'Show me (Meera)', run: () => { setTimeout(() => guideStart('mywork', true), 50); return ''; } } : null });
  $('ptDlgNote').style.whiteSpace = 'pre-line';
}
/* Meera's walk-round of this page (guide.js reads GUIDE_TOURS by name). */
if (typeof GUIDE_TOURS !== 'undefined') GUIDE_TOURS.mywork = [
  { en: 'This is <b>My work today</b> — everything waiting for you, from every screen, on one page.', hi: 'यह <b>My work today</b> है — हर स्क्रीन का आपका बाकी काम, एक ही पेज पर।' },
  { sel: '.fr-stats', en: 'Four boxes count your day. Click one to jump to that part of the list.', hi: 'ये चार बॉक्स आपका दिन गिनते हैं। किसी पर क्लिक करें तो लिस्ट का वही हिस्सा खुलता है।' },
  { sel: '.fr-grp[data-fr-grp="approve"] .fr-card', en: 'Each card is one item for you: what it is, who asked and why, and which screen it belongs to.', hi: 'हर कार्ड आपका एक काम है: क्या है, किसने और क्यों माँगा, और किस स्क्रीन का है।' },
  { sel: '.fr-yes', en: '<b>Approve</b> first shows exactly what will change. <b>Yes</b> runs the same approve as the screen itself.', hi: '<b>Approve</b> पहले दिखाता है कि क्या बदलेगा। <b>Yes</b> दबाते ही वही approve होता है जो स्क्रीन पर होता है।' },
  { sel: '.fr-card .fr-go', en: '<b>Open</b> takes you to the item on its own screen.', hi: '<b>Open</b> से वो काम उसकी अपनी स्क्रीन पर खुलता है।' },
  { sel: '.fr-card .fr-later', en: '<b>Later</b> hides a card until 4 pm (or tomorrow morning). <b>Undo</b> brings it back at once.', hi: '<b>Later</b> से कार्ड शाम 4 बजे तक (या कल सुबह तक) छुप जाता है। <b>Undo</b> से तुरंत वापस आता है।' },
  { sel: '.fr-grp[data-fr-grp="wait"] .fr-card', en: '<b>Waiting for you</b>: one card per kind of work. <b>Open list</b> opens that list on its own screen.', hi: '<b>Waiting for you</b>: हर तरह के काम का एक कार्ड। <b>Open list</b> से वो लिस्ट उसकी अपनी स्क्रीन पर खुलती है।' },
  { sel: '.fr-grp[data-fr-grp="bad"] .fr-card', en: '<b>Problems</b>: things to put right, like SKUs selling but out of stock on Amazon.', hi: '<b>Problems</b>: जो ठीक करना है, जैसे Amazon पर बिकते SKU जिनका स्टॉक खत्म है।' },
  { sel: '.side', en: 'The red numbers on the menu say how many items wait on each screen.', hi: 'मेन्यू पर लाल नंबर बताते हैं कि किस स्क्रीन पर कितना काम बाकी है।' },
  { sel: '#frBell', en: 'The bell lists what is new since you last looked.', hi: 'घंटी में वो काम दिखते हैं जो पिछली बार के बाद आए।' },
  { sel: '#frFindBtn', en: '<b>Search</b> (or Ctrl K): type a screen, an order, a SKU or a name, and jump straight to it.', hi: '<b>Search</b> (या Ctrl K): स्क्रीन, ऑर्डर, SKU या नाम लिखें, और सीधे वहाँ पहुँचें।' },
  { sel: '#frHome .fr-hright', en: '<b>How this page works</b> replays this. Admins also get <b>Viewing as</b> and <b>Roles</b>: the page as each team sees it.', hi: '<b>How this page works</b> से यह फिर से चलता है। एडमिन को <b>Viewing as</b> और <b>Roles</b> भी मिलते हैं: हर टीम को पेज कैसा दिखता है।' }
];

/* THE BELL — what is new since this person last left My work today, each with Open. */
function frBellOpen() {
  const fresh = frNew(frCards());
  ptOpenDialog({ title: fresh.length ? `${fresh.length} new since you last looked` : 'Nothing new since you last looked',
    html: fresh.length ? `<div class="fr-bell">${fresh.slice(0, 30).map((c, i) => `<div><span><b>${esc(c.title)}</b><small>${esc(c.detail || '')}</small></span><button type="button" class="fr-go" data-fr-bell="${i}">Open →</button></div>`).join('')}${fresh.length > 30 ? `<p>… and ${fresh.length - 30} more on My work today</p>` : ''}</div>` : '',
    saveLabel: 'Mark all as seen', onSave: () => { frSeenSave(new Set([...frSeen(), ...fresh.map(c => c.key)])); frCount(); frDraw(); return ''; },
    alt: { label: 'Open My work today', run: () => { frHomeShow(); return ''; } } });
  document.querySelectorAll('[data-fr-bell]').forEach(b => b.onclick = () => { ptDlgClose(); fresh[+b.dataset.frBell].open(); });
}
function frHomeShow() {
  FR.shown = true;
  document.querySelector('main.main').classList.add('fr-home-on');
  $('frHome').classList.remove('hide');
  document.querySelectorAll('.side .nav.on, .side .navgrp.on').forEach(e => e.classList.remove('on'));
  $('frHomeNav').classList.add('on');
  if ($('pageTitle')) $('pageTitle').textContent = 'My work today';
  frDraw();
  /* The first time, the big lists wait 3 s for the site to finish opening; after that they load straight away. */
  if (FR.started) frLoad(false); else { FR.started = true; setTimeout(() => frLoad(false), 3000); }
  window.scrollTo({ top: 0 });
  if (typeof guideIsOn === 'function' && guideIsOn() && !guideSeen().includes('mywork'))
    setTimeout(() => { if (FR.shown && !(GUIDE && GUIDE.tour)) { guideMarkSeen('mywork'); guideStart('mywork', false); } }, 2500);
}
function frHomeHide() {
  if (!FR.shown) return;
  FR.shown = false;
  frSeenSave(new Set([...frSeen(), ...(FR.cards || []).filter(c => c.key).map(c => c.key)]));
  frCount();
  document.querySelector('main.main').classList.remove('fr-home-on');
  $('frHome').classList.add('hide');
  $('frHomeNav').classList.remove('on');
}
/** The red counts: My work today's total, every menu group's share of it, and each screen's own share on its menu
 *  link (where the screen has no badge of its own already). The bell's dot says something is new. */
function frCount() {
  const cards = frCards(), byTab = {};
  cards.forEach(c => { byTab[c.tab] = (byTab[c.tab] || 0) + c.n; });
  const total = cards.reduce((s, c) => s + c.n, 0), cnt = n => n > 999 ? '999+' : n.toLocaleString('en-IN');
  ['frWorkN', 'frHomeN'].forEach(id => { const c = $(id); if (c) { c.textContent = cnt(total); c.classList.toggle('hide', !total); } });
  document.querySelectorAll('.side .navgrp[data-tabs]').forEach(b => {
    const n = b.dataset.tabs.split(',').reduce((s, t) => s + (byTab[t.trim()] || 0), 0);
    let c = b.querySelector('.fr-gcnt');
    if (!c) { c = document.createElement('b'); c.className = 'fr-gcnt'; b.appendChild(c); }
    c.textContent = cnt(n); c.classList.toggle('hide', !n);
  });
  document.querySelectorAll('.side a.nav[href^="#"]').forEach(a => {
    const n = byTab[a.getAttribute('href').slice(1)] || 0;
    const own = [...a.querySelectorAll('.navbadge')].some(x => !x.classList.contains('hide') && x.textContent.trim());
    let c = a.querySelector('.fr-tcnt');
    if (!c) { c = document.createElement('b'); c.className = 'fr-tcnt'; a.appendChild(c); }
    c.textContent = cnt(n); c.classList.toggle('hide', !n || own);
  });
  const bell = $('frBell'); if (bell) bell.classList.toggle('fr-unread', frNew(cards).length > 0);
}

/* ---------- Later ---------- */

/* LATER: a card leaves this page until 4 pm today (tomorrow 9 am once it is past 4). Only this page, only this
 * person, in this browser — nothing in the data changes and the item still counts on the menu. */
const frLaterKey = () => 'frLater:' + ((ME && ME.email) || 'anon');
function frLaterAll() { try { return JSON.parse(localStorage.getItem(frLaterKey()) || '{}') || {}; } catch (e) { return {}; } }
function frLaterSave(m) { try { localStorage.setItem(frLaterKey(), JSON.stringify(m)); } catch (e) { /* this visit only */ } }
function frLaterUntil() {
  const d = new Date(), t = new Date(); t.setHours(16, 0, 0, 0);
  if (d >= t) { t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); }
  return t.getTime();
}
const frLaterTxt = () => new Date(frLaterUntil()).getHours() === 16 ? '4:00 pm' : 'tomorrow 9:00 am';
const frIsLater = c => { const u = c.key && frLaterAll()[c.key]; return !!(u && u > Date.now()); };
function frLater(c) {
  if (!c || !c.key) return;
  const m = frLaterAll(), was = m[c.key];
  m[c.key] = frLaterUntil(); frLaterSave(m); frDraw();
  frToast(`Moved to later · back at ${frLaterTxt()}`, { label: 'Undo', run: () => { const x = frLaterAll(); if (was) x[c.key] = was; else delete x[c.key]; frLaterSave(x); frDraw(); } });
}

/** A note at the bottom of the screen, with one button (Undo, Open) for a few seconds. */
function frToast(msg, btn, ms = 6000) {
  const t = document.createElement('div'); t.className = 'fr-toast';
  t.innerHTML = `<span>${esc(msg)}</span>${btn ? `<button type="button">${esc(btn.label)}</button>` : ''}`;
  document.body.appendChild(t);
  const kill = () => t.remove(), timer = setTimeout(kill, ms);
  if (btn) t.querySelector('button').onclick = () => { clearTimeout(timer); kill(); btn.run(); };
  const all = [...document.querySelectorAll('.fr-toast')];
  all.forEach((x, i) => { x.style.bottom = (24 + (all.length - 1 - i) * 58) + 'px'; });
}

/* ---------- keys ---------- */

/* J/K move down/up the cards, A approves (the same box as the button), O or Enter opens, L moves to later,
 * H lists the keys (? is Meera's: Ask Meera). Only on My work today, and never while typing or while a box or Meera is open. */
function frKeys(e) {
  if (!FR.shown || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
  if (!$('ptDlg').classList.contains('hide') || !$('frPal').classList.contains('hide') || (typeof GUIDE !== 'undefined' && GUIDE.tour)) return;
  const cards = FR.cards || [], k = e.key;
  const move = d => {
    if (!cards.length) return;
    FR.k = Math.max(0, Math.min(cards.length - 1, (FR.k == null ? -1 : FR.k) + d));
    if (!document.querySelector(`#frHome .fr-card[data-fr-i="${FR.k}"]`) && cards[FR.k].grp === 'approve') { FR.subOpen.add(frSub(cards[FR.k])); frDraw(); }   // behind "Show all"
    document.querySelectorAll('#frHome .fr-card').forEach(el => el.classList.toggle('fr-kf', +el.dataset.frI === FR.k));
    const el = document.querySelector(`#frHome .fr-card[data-fr-i="${FR.k}"]`); if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const c = FR.k != null ? cards[FR.k] : null;
  if (k === 'j' || k === 'J') { e.preventDefault(); move(1); }
  else if (k === 'k' || k === 'K') { e.preventDefault(); move(-1); }
  else if ((k === 'a' || k === 'A') && c && c.act) { e.preventDefault(); frAsk(c); }
  else if ((k === 'o' || k === 'O' || k === 'Enter') && c) { e.preventDefault(); c.open(); }
  else if ((k === 'l' || k === 'L') && c) { e.preventDefault(); frLater(c); FR.k = Math.min(FR.k, (FR.cards || []).length - 1); frDraw(); }
  else if (k === 'h' || k === 'H') {   // ? belongs to Meera (Ask Meera)
    e.preventDefault();
    ptOpenDialog({ title: 'Keys on My work today', note: 'J / K — move down / up the cards\nA — approve the chosen card (asks first)\nO or Enter — open it\nL — move it to later\nH — this list\n? — Ask Meera\nCtrl K — search any screen, order or SKU\nEsc — close a box', saveLabel: 'Got it', onSave: () => '' });
    $('ptDlgNote').style.whiteSpace = 'pre-line';
  }
}

/* ---------- new-work pop-ups ---------- */

/* Every 5 minutes, while the site is open (in front or not), the small approval lists are read again with the screens'
 * own loaders (corrections, deletion requests, finished-goods corrections, vendor requests). Anything that was not
 * there before pops up at the bottom with Open. The big lists are not re-read; Refresh does that. */
const FR_POLL_MS = 5 * 60 * 1000;
function frKnown() { return new Set(frCards().filter(c => c.grp === 'approve').map(c => c.key)); }
async function frPoll() {
  /* also while R-one is behind other windows or minimised: that is when a desktop alert is wanted (Ravi, 23 Oct) */
  if (!ME || !ME.email || $('appView').classList.contains('hide')) return;
  const before = FR.known || frKnown(), jobs = [];
  if (frMay('pbase') && frTry(ptCanEdit, false)) jobs.push(jwCorrLoad());
  if (frMay('so') && frTry(odrCanAnswer, false)) jobs.push(odrLoad(true));
  if (frMay('fgi') && frTry(fgiCanEdit, false)) jobs.push(fgiCorrLoad());
  await Promise.all(jobs.map(p => Promise.resolve(p).catch(() => {})));
  const now = frCards().filter(c => c.grp === 'approve'), fresh = now.filter(c => !before.has(c.key));
  FR.known = new Set(now.map(c => c.key));
  if (fresh.length) frAlert(fresh);
  if (document.visibilityState === 'visible') {
    fresh.slice(0, 3).forEach(c => frToast(`New: ${c.title}`, { label: 'Open', run: () => c.open() }, 12000));
    if (fresh.length > 3) frToast(`${fresh.length - 3} more new items on My work today`, { label: 'Show', run: frHomeShow }, 12000);
  }
  frCount(); frDraw();
}

/* DESKTOP ALERTS (Ravi, 23 Oct: "most of our users are laptop and desktop users … a notification reaches them
 * whenever there is something new"): the computer's own notification, in the corner of the screen, when a new
 * approval arrives — while R-one is open in a tab, even behind other windows or minimised (not when the browser is
 * closed: that would need the server to send it). Each person switches it on once (the browser asks "Allow"); kept
 * per person in this browser. Clicking the alert brings R-one forward and opens the item. */
const frAlertKey = () => 'frAlerts:' + ((ME && ME.email) || 'anon');
const frAlertCan = () => typeof Notification !== 'undefined';
function frAlertOn() {
  let v = ''; try { v = localStorage.getItem(frAlertKey()) || ''; } catch (e) { /* none */ }
  return frAlertCan() && Notification.permission === 'granted' && v !== 'off';
}
async function frAlertSet(on) {
  if (!frAlertCan()) { frToast('This browser cannot show desktop alerts.', null, 5000); return false; }
  if (on && Notification.permission !== 'granted') {
    if (Notification.permission === 'denied') { frToast('Alerts are blocked for this site — allow them from the lock icon left of the address.', null, 9000); return false; }
    if (await Notification.requestPermission() !== 'granted') return false;
  }
  try { localStorage.setItem(frAlertKey(), on ? 'on' : 'off'); } catch (e) { /* this visit only */ }
  if (on) { const n = new Notification('R-one desktop alerts are on', { body: 'New approvals will show here, even when R-one is behind other windows.', icon: '/icon-192.png', tag: 'r1-alert-on' }); setTimeout(() => n.close(), 6000); }
  frDraw();
  return true;
}
function frAlert(fresh) {
  if (!frAlertOn() || (document.visibilityState === 'visible' && document.hasFocus())) return;   // in front: the pop-ups say it
  const one = fresh.length === 1, c = fresh[0];
  const n = new Notification(one ? 'R-one · new approval' : `R-one · ${fresh.length} new approvals`, {
    body: one ? c.title : fresh.slice(0, 4).map(x => '• ' + x.title).join('\n') + (fresh.length > 4 ? `\n… and ${fresh.length - 4} more` : ''),
    icon: '/icon-192.png', tag: 'r1-' + (one ? c.key : 'many'), renotify: true });
  n.onclick = () => { window.focus(); n.close(); if (one) c.open(); else frHomeShow(); };
}

/* ---------- search everything ---------- */

/** The screens this person can open: the menu's own links, minus the ones hidden from them. */
function frScreens() {
  const seen = new Set();
  return [...document.querySelectorAll('a.nav[href^="#"]')].map(a => {
    const tab = a.getAttribute('href').slice(1);
    const name = ((a.querySelector('.nav-t') || a).textContent || '').replace(/\d+\s*$/, '').trim();
    const grp = a.closest('.navsec') && a.closest('.navsec').previousElementSibling;
    return { tab, name, grp: grp && grp.classList.contains('navgrp') ? grp.textContent.trim() : '', a };
  }).filter(s => s.tab && s.tab !== 'dash' && s.name && !seen.has(s.tab) && seen.add(s.tab)   // the Dashboard is off R-one's menu (23 Oct)
    && s.a.style.display !== 'none' && !s.a.closest('.hide') && (!ME.tabs || !ME.tabs.length || ME.tabs.includes(s.tab)));
}
/** A screen's own search box: the first box on it whose hint says search or filter. */
function frSearchBox(tab) {
  const pane = $('pane' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (!pane) return null;
  return [...pane.querySelectorAll('input')].find(i => /search|filter/i.test(i.placeholder || '') && !/^(employee|sku \(|colour|size|pieces|remarks)/i.test(i.placeholder)) || null;
}
function frItems(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean), scr = frScreens(), out = [];
  const match = t => words.every(w => t.toLowerCase().includes(w));
  if (!q || match('my work today')) out.push({ sec: 'Screens', label: 'My work today', sm: 'Everything waiting for you', run: frHomeShow });
  scr.filter(s => !q || match(s.name + ' ' + s.grp)).forEach(s => out.push({ sec: 'Screens', label: s.name, sm: s.grp, run: () => showTab(s.tab) }));
  if (q) {
    const now = FR.shown ? '' : (typeof TAB_NOW !== 'undefined' ? TAB_NOW : '');
    scr.filter(s => frSearchBox(s.tab)).sort((a, b) => (b.tab === now) - (a.tab === now)).forEach(s => out.push({
      sec: 'Find it', label: `Find “${q}” in ${s.name}`, sm: frSearchBox(s.tab).placeholder,
      run: () => { showTab(s.tab); setTimeout(() => { const box = frSearchBox(s.tab); if (!box) return; box.value = q; box.focus();
        ['input', 'keyup', 'change'].forEach(ev => box.dispatchEvent(new Event(ev, { bubbles: true }))); }, 250); } }));
  }
  [{ label: 'Walk me round this screen (Meera)', run: () => guideStart(TAB_NOW, true), if: typeof guideStart === 'function' },
   { label: 'Open the written guide · गाइड', run: () => $('guideBtn').click(), if: !!$('guideBtn') }]
    .filter(a => a.if && (!q || match(a.label))).forEach(a => out.push({ sec: 'Help', label: a.label, sm: '', run: a.run }));
  return out.slice(0, 16);
}
function frPalDraw() {
  const q = $('frQ').value.trim();
  FR.items = frItems(q); FR.sel = 0;
  let last = '';
  $('frList').innerHTML = FR.items.map((it, i) => {
    const h = it.sec !== last ? `<div class="fr-sec">${esc(it.sec)}</div>` : ''; last = it.sec;
    return h + `<div class="fr-row${i === 0 ? ' on' : ''}" data-fr-row="${i}"><span>${esc(it.label)}</span><small>${esc(it.sm || '')}</small></div>`;
  }).join('') || '<div class="fr-none">Nothing found.</div>';
}
function frPalMove(d) {
  const rows = [...$('frList').querySelectorAll('.fr-row')]; if (!rows.length) return;
  FR.sel = (FR.sel + d + rows.length) % rows.length;
  rows.forEach((r, i) => r.classList.toggle('on', i === FR.sel)); rows[FR.sel].scrollIntoView({ block: 'nearest' });
}
function frPalGo(i) { const it = FR.items[i]; frPalClose(); if (it) it.run(); }
function frPalOpen() { $('frPal').classList.remove('hide'); $('frQ').value = ''; frPalDraw(); setTimeout(() => $('frQ').focus(), 10); }
function frPalClose() { $('frPal').classList.add('hide'); }

/* ---------- the pieces on the page ---------- */

function frBuild() {
  if (FR.built || !document.body || !document.querySelector('main.main')) return;
  FR.built = true;
  /* The menu's first item, above the groups. */
  const nav = document.createElement('button');
  nav.type = 'button'; nav.id = 'frHomeNav'; nav.className = 'fr-homenav';
  nav.innerHTML = 'My work today <b id="frHomeN" class="hide">0</b>';
  const brand = document.querySelector('.side .brand');
  if (brand && brand.parentNode) brand.parentNode.insertBefore(nav, brand.nextSibling); else document.querySelector('.side').prepend(nav);
  nav.onclick = frHomeShow;
  /* Search, beside it (the top bar's Search button is hidden). */
  const find = document.createElement('button');
  find.type = 'button'; find.id = 'frFindNav'; find.className = 'fr-findnav'; find.title = 'Search screens, orders, SKUs — Ctrl K';
  find.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Search</span>';
  nav.parentNode.insertBefore(find, nav.nextSibling);
  find.onclick = () => frPalOpen();
  /* The screen itself, in the page beside the app's own screens. */
  const home = document.createElement('section');
  home.id = 'frHome'; home.className = 'hide';
  const top = document.querySelector('main.main > .topbar');
  top.parentNode.insertBefore(home, top.nextSibling);
  /* Top bar: My work and Search (on a phone, in its header). */
  const ctl = document.createElement('span');
  ctl.id = 'frCtl';
  ctl.innerHTML = `<button type="button" id="frBell" title="What is new since you last looked" aria-label="What's new"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><i></i></button>`
    + `<button type="button" id="frWorkBtn" title="Everything waiting for you">My work <b id="frWorkN" class="hide">0</b></button>`
    + `<button type="button" id="frFindBtn" title="Search screens, orders, SKUs — Ctrl K"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span>Search</span><kbd>Ctrl K</kbd></button>`;
  const phone = typeof mobOn === 'function' && mobOn() && $('mobHead'), host = $('topActs');
  if (phone) phone.appendChild(ctl); else if (host && host.parentNode) host.parentNode.insertBefore(ctl, host); else document.body.appendChild(ctl);
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div id="frPal" class="hide" role="dialog" aria-label="Search"><div class="fr-box">
      <input id="frQ" autocomplete="off" placeholder="Type a screen, an order no., a SKU or a name…">
      <div id="frList"></div>
      <div class="fr-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div></div></div>`;
  document.body.appendChild(wrap);
  $('frWorkBtn').onclick = frHomeShow;
  $('frBell').onclick = frBellOpen;
  document.addEventListener('keydown', frKeys);
  setInterval(frPoll, FR_POLL_MS);
  $('frFindBtn').onclick = frPalOpen;
  $('frQ').oninput = frPalDraw;
  $('frQ').onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); frPalMove(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); frPalMove(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); frPalGo(FR.sel); }
    else if (e.key === 'Escape') frPalClose();
  };
  $('frList').onclick = e => { const r = e.target.closest('[data-fr-row]'); if (r) frPalGo(+r.dataset.frRow); };
  $('frPal').onclick = e => { if (e.target === $('frPal')) frPalClose(); };
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('frPal').classList.contains('hide') ? frPalOpen() : frPalClose(); }
  });
  /* Opening any other screen leaves My work today: showTab is the one door every screen goes through. */
  const appShowTab = showTab;
  showTab = function (which) { frHomeHide(); return appShowTab.apply(this, arguments); };
  /* …except the screen already open underneath, which the menu does not re-open: that one is shown again here. */
  document.addEventListener('click', e => {
    const a = FR.shown && e.target.closest && e.target.closest('.side a.nav[href^="#"]');
    if (a && a.getAttribute('href').slice(1) === TAB_NOW) { frHomeHide(); showTab(TAB_NOW); }
  }, true);
  /* The badges change as their lists arrive after sign-in: keep the counts and the screen up to date. */
  const mo = new MutationObserver(() => { clearTimeout(FR.t); FR.t = setTimeout(() => { frCount(); frDraw(); }, 200); });
  document.querySelectorAll('.navbadge').forEach(b => mo.observe(b, { attributes: true, childList: true, characterData: true, subtree: true }));
  /* After sign-in, once the app has opened its first screen: My work today, and a few re-draws while the
   * background lists arrive. Shown once per sign-in; the menu item brings it back. */
  /* …unless the person has already gone somewhere from the menu: then it never jumps in on top of their screen. */
  document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.side, #frCtl, #mobHead')) FR.touched = true; }, true);
  frWhen(() => !$('appView').classList.contains('hide') && typeof TAB_NOW !== 'undefined' && TAB_NOW && ME.email, () => {
    if (!FR.touched) frHomeShow();
    [1500, 4000, 8000, 15000].forEach(ms => setTimeout(() => { frCount(); frDraw(); }, ms));
  }, 600);
}
frBuild();

/* ---------- Meera, R-one's way ---------- */

/* Ravi, 23 Oct: "a circle in the bottom right of the screen to ask Meera"; while she walks a screen, "if we click
 * anywhere else except the box then it closes"; and "instead of turn helper off make a skip button to skip the box
 * slide". So: a round button with her face opens Ask Meera (the top bar's own Ask Meera button is hidden, friendly.css);
 * a click outside her box ends the walk-round (the click itself does nothing on the page, as before); and her box's
 * small link is Skip — this step — where it said "Turn helper off". The Helper switch in the top bar still turns
 * her off. Meera's own files are not changed: this wraps guideShow, the one function that draws each step. */
function frMeera() {
  if (typeof guideAskOpen !== 'function' || typeof guideShow !== 'function' || $('frMeeraFab')) return;
  const fab = document.createElement('button');
  fab.type = 'button'; fab.id = 'frMeeraFab';
  fab.title = 'Ask Meera — English, Hindi or Hinglish'; fab.setAttribute('aria-label', 'Ask Meera');
  fab.innerHTML = GUIDE_FACE + '<span class="fr-fab-tip">Ask Meera</span>';
  document.body.appendChild(fab);
  /* Ravi, 23 Oct, of the top bar's bell, My work, Search, Show me and Helper On: "remove these things too". They are
   * hidden (friendly.css); My work today is the menu's first item, Search sits beside it and in this menu (Ctrl K
   * still opens it), and Meera's own buttons live here. The bell's news stays as the NEW tags and the pop-ups. */
  const menu = document.createElement('div');
  menu.id = 'frMeeraMenu'; menu.className = 'hide'; menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  const close = () => menu.classList.add('hide');
  const draw = () => {
    const on = typeof guideIsOn === 'function' && guideIsOn();
    menu.innerHTML = `<button type="button" data-m="ask">💬<span><b>Ask Meera</b><small>English, Hindi or Hinglish</small></span></button>`
      + `<button type="button" data-m="show">🧭<span><b>Show me this screen</b><small>A walk round, step by step</small></span></button>`
      + `<button type="button" data-m="find">🔍<span><b>Search</b><small>Screens, orders, SKUs · Ctrl K</small></span></button>`
      + (frAlertCan() ? `<button type="button" data-m="alerts" role="switch" aria-checked="${frAlertOn()}"><i class="fr-sw${frAlertOn() ? ' on' : ''}"></i><span><b>Desktop alerts ${frAlertOn() ? 'on' : 'off'}</b><small>A notification when something new comes</small></span></button>` : '')
      + `<button type="button" data-m="help" role="switch" aria-checked="${on}"><i class="fr-sw${on ? ' on' : ''}"></i><span><b>Helper ${on ? 'on' : 'off'}</b><small>${on ? 'Walks new screens with you' : 'Only when you ask'}</small></span></button>`;
  };
  fab.onclick = e => { e.stopPropagation(); if (menu.classList.contains('hide')) { draw(); menu.classList.remove('hide'); } else close(); };
  menu.onclick = e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const m = b.dataset.m;
    if (m === 'help') { if ($('gdSwitch')) $('gdSwitch').click(); draw(); return; }
    if (m === 'alerts') { frAlertSet(!frAlertOn()).then(draw); return; }
    close();
    if (m === 'ask') guideAskOpen();
    else if (m === 'show') { if ($('gdShow')) $('gdShow').click(); }
    else if (m === 'find') frPalOpen();
  };
  document.addEventListener('click', e => { if (!menu.classList.contains('hide') && !e.target.closest('#frMeeraMenu, #frMeeraFab')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  const show = guideShow;
  guideShow = function () { const r = show.apply(this, arguments); frSkipDraw(); return r; };
  document.addEventListener('click', e => {
    if (typeof GUIDE === 'undefined' || !GUIDE.tour || GUIDE.selfClick || !e.isTrusted) return;
    const t = e.target;
    if (t.closest && t.closest('#gdBubble, #gdAsk, #gdCtl, #gdResume, #frMeeraFab, #frMeeraMenu, #ptDlg')) return;
    if (GUIDE.live && GUIDE.el && GUIDE.el.contains(t)) return;   // a "your turn" step: the lit box is hers to use
    guideClose();
  }, true);
}
/** "Skip" in place of "Turn helper off": the next step, or the end on the last one. */
function frSkipDraw() {
  const b = $('gdOff'); if (!b) return;
  b.textContent = typeof guideLang === 'function' && guideLang() === 'hi' ? 'छोड़ें' : 'Skip';
  b.title = 'Skip this step';
  b.classList.add('fr-skip');
  b.onclick = () => guideGo(1);
}
frWhen(() => $('gdRoot') && typeof guideAskOpen === 'function', frMeera, 150);
