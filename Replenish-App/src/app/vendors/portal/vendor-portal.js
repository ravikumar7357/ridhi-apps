/* ================= THE VENDOR'S OWN PORTAL =================
 *
 * What a printer sees when they sign in: their own orders, and nothing else. They acknowledge an
 * order, start production, and then record what they are actually sending — as many rounds as it
 * takes — until the balance is nil.
 *
 * A DELIVERY IS AN EVENT, NOT A FIELD. Each round is appended to the line's `deliveries[]` with the
 * date, who recorded it and when. `vendorQty` and `dispatchedQty` are then rewritten from that sum,
 * because the staff screens read them — but the array is the record, and it is what the Vendor
 * Orders screen totals.
 *
 * A ROUND IS CAPPED AT THE BALANCE. Typing 500 against a line with 40 left records 40 and says so,
 * rather than letting a vendor book more than was ordered.
 *
 * SCOPE IS BY EMAIL, THROUGH pt_vendorMap. Only that one vendor's branch is ever read — the whole
 * node is never fetched. NOTE, and this is worth saying plainly: that scoping is done HERE, in the
 * app. The database this reads today is open to anyone with no sign-in at all, and even after the
 * move the rules say "signed in = may work". A vendor who went around this screen could read another
 * vendor's branch. Closing that needs a rule on pt_vendorOrders/$code keyed to the vendor's email,
 * which can only be written once the data is in this project.
 */
let VP = { code: null, name: '', rows: null, err: '', busy: false, at: '', sent: {}, pinFresh: true,
  tab: 'bulk' };

/**
 * Every delivery this printer has recorded, newest first.
 *
 * One row per delivery, carrying both sides of it: what they said they sent, and what the factory
 * accepted. The difference is the shortfall — and "not answered yet" is kept apart from "none kept",
 * because those are very different things to be told.
 */
function vpHistRows() {
  const out = [];
  (VP.rows || []).forEach(o => {
    const run = voRunning(o);
    voLines(o).forEach(l => {
      voDels(l).forEach(d => {
        const sent = parseFloat(d && d.qty) || 0;
        if (!sent) return;
        const ok = vlOk(d), no = vlNo(d);
        const kept = no ? 0 : (ok ? (parseFloat(ok.qty) || 0) : null);   // null = nobody has answered
        const beyond = ok ? (parseFloat(ok.beyond) || 0) : 0;            // sent past the order: recorded, not credited
        out.push({
          date: String((d && d.date) || ''), day: voDayOf(d && d.date),
          orderNo: o.orderNo || o.id, run, unit: run ? 'm' : 'pcs',
          sku: run ? (l.fabricType || '') : (l.sku || ''),
          what: run ? [l.fabricType, l.color, l.printDirection].filter(Boolean).join(' · ')
                    : [l.articleSubtype || l.articleType, l.color, l.size].filter(Boolean).join(' · '),
          sent, kept, no: !!no, ok: !!ok, beyond,
          short: kept === null ? 0 : Math.max(0, sent - kept - beyond),
          note: String((ok && ok.note) || (no && no.note) || ''),
          at: String((ok && ok.at) || (no && no.at) || (d && d.at) || ''),
        });
      });
    });
  });
  /* Oldest first, like the orders above it: this is a ledger of what has gone out, and a ledger is
   * read from the beginning. */
  return out.sort((a, b) => String(a.day || a.date).localeCompare(String(b.day || b.date)));
}

/** Shopify work, which the buyer's side writes as one standing order per printer. */
const vpIsShop = o => String((o && o.demandSource) || '') === 'shopify';
/* COMPLETED (Ravi, 2026-09-28): a line sent in full, or cancelled, or on an order closed as Received or Cancelled, is
 * done. The Bulk and Custom tabs draw only the lines still to do; the Completed tab draws the rest. VP_PART is set by
 * renderVp for the tab on screen and read by every table and the export, so they always agree. */
let VP_PART = '';
const vpLineIsDone = (o, l) => !!(l && (l.cancelled || ['Received', 'Cancelled'].indexOf((o && o.status) || '') >= 0
  || (vpQty(o, l) > 0 && vpQty(o, l) - vpDone(l) <= 0)));
const vpPartOk = (o, l) => !VP_PART || (VP_PART === 'done') === vpLineIsDone(o, l);
/** True when this account signs in with a cellphone and a PIN rather than a real email address. */
const vpOnPin = () => String(ME.email || '').toLowerCase().indexOf('@vendors-tfr.app') >= 0;

const VP_CAN_DELIVER = ['Acknowledged', 'In Production', 'Partially Dispatched'];
const VP_FLOW = { Placed: 'Acknowledged', Acknowledged: 'In Production' };

/**
 * Whether the Vendor Portal tab belongs in front of this account, once the index has answered.
 *
 *   'yes'  a known vendor — their own orders are there to show
 *   'ask'  not a vendor, but somebody ticked this section for them deliberately: let them in, so the
 *          pane can say which step was missed. Taking the tab away instead is how a printer ended up
 *          bounced onto the Replenishment planning board.
 *   'no'   hide it — the account never asked for this screen, or has every tab anyway
 */
function vendTabRule(isVendor) {
  if (isVendor) return 'yes';
  const asked = !!(ME.tabsExplicit && !ME.admin && (ME.tabs || []).indexOf('vend') >= 0);
  return asked ? 'ask' : 'no';
}

async function ensureVp() {
  if (VP.rows === null) {
    VP.busy = true; renderVp();
    try {
      /* One direct read of this account's own entry. Reading pt_vendorMap whole would mean every
       * vendor could see every other vendor's contact details, and once the rules are on it, a
       * vendor will not be allowed that read at all. The scan is the fallback for the database as it
       * stands today, where the index has not been written yet. */
      let code = null, name = '';
      try {
        const own = await ptGet('pt_vendorByEmail/' + vpEmailKey(ME.email));
        if (own && own.code) { code = own.code; name = own.name || own.code; }
      } catch (e) { /* not written yet — fall through to the scan */ }
      /* THE WIDER SCAN IS A FALLBACK FOR A ROW THAT WAS NEVER WRITTEN, and a vendor is not allowed
       * it — pt_vendorMap holds every printer's contact details, which is exactly why. Trying it
       * anyway is how a printer whose own row is missing was shown "permission denied" instead of
       * being told what is actually wrong. */
      if (!code) {
        let map = null;
        try { map = await ptGet('pt_vendorMap'); }
        catch (e) {
          VP.code = null; VP.name = '';
          VP.rows = [];
          VP.err = 'This sign-in is not linked to any printer yet, so there are no orders to show. '
            + 'Ask the office to link ' + (ME.email || 'this account') + ' to your firm on the Printers screen.';
          VP.at = ptStamp(); VP.busy = false;
          renderVp();
          return;
        }
        map = map || {};
        const e = String(ME.email || '').toLowerCase();
        // Email first, then cellphone — the same two ways the tool identifies a vendor.
        code = Object.keys(map).find(k => map[k] && String(map[k].email || '').trim().toLowerCase() === e) || null;
        if (!code) {
          const ph = vpPhone(e.split('@')[0]);
          if (ph.length >= 10) code = Object.keys(map).find(k => map[k] && vpPhone(map[k].phone) === ph) || null;
        }
        if (code) name = map[code].name || code;
      }
      VP.code = code;
      VP.name = name;
      // Only this vendor's branch is ever asked for. Reading the node would hand over every vendor.
      VP.rows = code ? ptList(await ptGet('pt_vendorOrders/' + code)) : [];
      /* WHAT THIS PRINTER HAS SAID IS ON THEIR FLOOR. Their branch and nobody else's, for the same
       * reason. A failed read leaves the boxes empty and the requirement at its full size, which is
       * the safe way round — it asks for cloth that may not be needed rather than skipping cloth
       * that is. */
      if (code) {
        try { RFD.stock = Object.assign({}, RFD.stock || {}, { [obUC(code)]: (await ptGet('pt_rfdStock/' + code)) || {} }); }
        catch (e) { RFD.stock = RFD.stock || {}; }
      }
      /* The pictures. This account cannot reach the backend that finds them, so it reads the ones
       * somebody with that access has already looked up. */
      try { await ptImgShared(); } catch (e) { /* the portal works without them */ }
      /* Has this account ever changed the PIN it was handed? Only the fact is stored, never the PIN. */
      if (vpOnPin()) {
        try { const p = await ptGet('pt_vendorPin/' + vpEmailKey(ME.email));
          VP.pinFresh = !!(p && p.changedAt); } catch (e) { VP.pinFresh = false; }
      } else VP.pinFresh = true;
      VP.err = '';
    } catch (e) { VP.err = e.message || String(e); VP.rows = VP.rows || []; }
    VP.at = ptStamp(); VP.busy = false;
  }
  renderVp();
}

/* A key the rules can build for themselves. Firebase rule strings have replace(), so
 * auth.token.email.replace('.', ',') lands on exactly this key — which is what lets the DATABASE
 * decide whether a signed-in account is a vendor, without the app being asked. */
const vpEmailKey = e => String(e || '').trim().toLowerCase().replace(/\./g, ',');

const vpPhone = p => { let d = String(p == null ? '' : p).replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };
const vpQty = (o, l) => { const n = parseFloat(o.orderType === 'running' ? l.meters : l.qty); return isFinite(n) ? n : 0; };
const vpDone = l => {
  const d = (Array.isArray(l.deliveries) ? l.deliveries : Object.values((l && l.deliveries) || {})).filter(Boolean);
  /* The printer sees the same answer as we do. If eighteen of a claimed nineteen were accepted, their
   * balance says eighteen — telling them otherwise is how a dispute starts two months later. */
  if (d.length) return d.reduce((s, x) => s + vlQtyOf(x), 0);
  const c = parseFloat(l.vendorQty != null ? l.vendorQty : l.dispatchedQty);
  return isFinite(c) ? c : 0;
};

/**
 * The orders this vendor may see, before any filter is touched.
 *
 * A CANCELLED ORDER IS NOT WORK. The vendor has nothing to do with it and never will, and leaving it
 * on the screen with a red pill is an invitation to read it and wonder. One waiting for approval is
 * not theirs to see either — it is not an order yet.
 *
 * Unique by ORDER NUMBER, cut and running together in one list: an order is one thing however it is
 * measured, and two rows carrying the same number would be a puzzle nobody can solve from here.
 */
/**
 * When an order was raised, as a number that sorts.
 *
 * createdAt is ISO and would sort as text, but plenty of orders carry only orderDate — "12/09/2026",
 * day first, which as text puts the 1st of December before the 2nd of January. Read properly, both.
 */
function voWhenMs(o) {
  const iso = String((o && o.createdAt) || '').trim();
  if (iso) { const t = Date.parse(iso); if (isFinite(t)) return t; }
  const d = ptDtMs((o && o.orderDate) || '');
  return isFinite(d) && d ? d : 0;
}

/**
 * The orders a printer is shown, OLDEST FIRST — the order the pile is worked in.
 *
 * The de-duplication is done first and on its own: two rows under one order number mean the order was
 * written twice, and the later one is the truth. That used to ride on the sort being newest-first, so
 * turning the sort around would have started showing the stale copy of every duplicated order.
 */
function vpVisible(rows) {
  const seen = new Set(), kept = [];
  (rows || [])
    .filter(o => o && o.status !== 'Pending Approval' && o.status !== 'Cancelled')
    .slice()
    .sort((a, b) => voWhenMs(b) - voWhenMs(a))   // newest first, for picking the winner only
    .forEach(o => {
      const k = String(o.orderNo || o.id || '').trim().toUpperCase();
      if (k && seen.has(k)) return;              // the newest wins; the sort put it first
      if (k) seen.add(k);
      kept.push(o);
    });
  /* …and then read the other way round: oldest at the top, because that is the one due first. */
  return kept.sort((a, b) => voWhenMs(a) - voWhenMs(b)
    || String(a.orderNo || '').localeCompare(String(b.orderNo || '')));
}

/**
 * Fill the pickers from what this vendor actually has.
 *
 * Built from their OWN orders and nothing else — a list of every colour the factory buys would tell
 * a printer what the others are printing. A choice already made is kept, so the list does not reset
 * itself under somebody mid-filter.
 */
function vpFillFilters(rows) {
  const uniq = f => [...new Set(rows.flatMap(o => voLines(o).map(f)).map(v => String(v || '').trim()).filter(Boolean))]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const fill = (id, vals, blank) => {
    const el = $(id); if (!el) return;
    const keep = el.value;
    el.innerHTML = `<option value="">${esc(blank)}</option>`
      + vals.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    /* A choice that no longer exists is dropped rather than silently ignored. */
    el.value = vals.indexOf(keep) >= 0 ? keep : '';
  };
  fill('vpStatus', [...new Set(rows.map(o => String(o.status || 'Placed')))].sort(), 'All statuses');
  fill('vpAt', uniq(l => l.articleType), 'All article types');
  fill('vpSub', uniq(l => l.articleSubtype), 'All subtypes');
  fill('vpCol', uniq(l => l.color), 'All colours');
  fill('vpSz', uniq(l => l.size), 'All sizes');
  fill('vpPri', uniq(l => l.priority), 'All priorities');
}

/** What the filter bar is asking for. */
const vpF = () => ({
  status: ($('vpStatus') || {}).value || '',
  type: ($('vpType') || {}).value || '',
  q: String(($('vpQ') || {}).value || '').trim().toLowerCase(),
  at: ($('vpAt') || {}).value || '', sub: ($('vpSub') || {}).value || '',
  col: ($('vpCol') || {}).value || '', sz: ($('vpSz') || {}).value || '',
  pri: ($('vpPri') || {}).value || '',
});
const vpLineOn = f => !!(f.at || f.sub || f.col || f.sz || f.pri);
/** Does this order survive the order-level filters? */
function vpOrderMatches(o, f) {
  if (f.status && String(o.status || 'Placed') !== f.status) return false;
  if (f.type && (o.orderType || 'cut') !== f.type) return false;
  if (f.q) {
    const hay = [o.orderNo, o.id, o.status, o.notes,
      ...voLines(o).flatMap(l => [l.sku, l.fabricType, l.color, l.printDirection, l.articleType, l.articleSubtype, l.size])]
      .filter(Boolean).join(' ').toLowerCase();
    if (hay.indexOf(f.q) < 0) return false;
  }
  /* A line filter narrows the LINES; an order with nothing left is not worth drawing. */
  if (vpLineOn(f) && !voLines(o).some(l => voLineMatches(l, f))) return false;
  return true;
}

function renderVp() {
  const body = $('vpBody');
  $('vpPinBtn').classList.toggle('hide', !vpOnPin());
  if (VP.busy) { $('vpMsg').className = 'muted'; $('vpMsg').textContent = 'Reading your orders…'; body.innerHTML = ''; return; }
  if (VP.err) { $('vpMsg').className = 'err'; $('vpMsg').textContent = 'Could not read them: ' + VP.err; body.innerHTML = ''; return; }
  if (!VP.code) {
    $('vpMsg').className = 'err';
    $('vpMsg').textContent = `${ME.email} is not linked to a vendor yet.`;
    /* Being ALLOWED to open this screen and BEING a vendor are two different things, and only the
     * second one decides whose orders appear here. The message says which step is missing, because
     * the person reading it is usually the one who has to ask for it. */
    body.innerHTML = `<div class="card" style="padding:26px;max-width:560px;margin:0 auto">`
      + `<div style="font-weight:600;margin-bottom:8px">This sign-in is not linked to a vendor yet.</div>`
      + `<div class="muted" style="font-size:13px;line-height:1.6">Being allowed to open this screen is `
      + `one thing; being a vendor is another, and only the second decides whose orders show up here.`
      + `<br><br>The link is made in <b>Vendor Orders → Printers</b>, with the <b>Set up</b> button on `
      + `that vendor's row — or in one go with <b>Vendor access</b>. Granting sections does not do it.`
      + `<br><br>Ask The Fabric Rush to do that for <b>${esc(ME.email)}</b>.</div></div>`;
    $('vpKpis').innerHTML = '';
    return;
  }

  const all = vpVisible(VP.rows);
  vpFillFilters(all);
  const f = vpF();
  const matched = all.filter(o => vpOrderMatches(o, f));
  /* THE TABS ARE COUNTED BEFORE THE SPLIT, so a printer can see there is Shopify work waiting even
   * while they are looking at the bulk orders. A tab with nothing behind it is not drawn at all. */
  const hasOpen = o => voLines(o).some(l => l && !vpLineIsDone(o, l));
  const hasDone = o => voLines(o).some(l => l && vpLineIsDone(o, l));
  const openOrders = matched.filter(hasOpen);
  const shopN = openOrders.filter(vpIsShop).length, bulkN = openOrders.length - shopN;
  const doneN = matched.reduce((t, o) => t + voLines(o).filter(l => l && vpLineIsDone(o, l)).length, 0);
  const tabs = $('vpTabs');
  if (tabs) {
    tabs.classList.toggle('hide', false);
    if (!shopN && VP.tab === 'shop') VP.tab = 'bulk';
    $('vpTabDone').classList.toggle('hide', !doneN);
    if (!doneN && VP.tab === 'done') VP.tab = 'bulk';
    $('vpTabShop').classList.toggle('hide', !shopN);
    const paint = (id, on, label, n) => {
      const b = $(id); if (!b) return;
      b.textContent = n ? label + ' (' + nf(n) + ')' : label;
      b.className = on ? '' : 'ghost';
    };
    paint('vpTabBulk', VP.tab === 'bulk', 'Bulk orders', bulkN);
    paint('vpTabShop', VP.tab === 'shop', 'Custom orders', shopN);
    paint('vpTabDone', VP.tab === 'done', 'Completed', doneN);
    paint('vpTabHist', VP.tab === 'hist', 'What I have sent', vpHistRows().length);
    /* Counted as things still to hear about, not as things ever asked — a printer wants to know what
     * is outstanding, and a number that only goes up stops being read after a fortnight. */
    paint('vpTabRfd', VP.tab === 'rfd', 'RFD fabric I need',
      vpRfdRows().filter(r => r.stage === 'pending' || r.stage === 'approved').length);
  }
  const doneTab = VP.tab === 'done';
  VP_PART = doneTab ? 'done' : 'open';
  const rows = doneTab ? matched.filter(hasDone) : openOrders.filter(o => (VP.tab === 'shop') === vpIsShop(o));
  VP.shown = rows;
  const open = rows.filter(o => ['Received', 'Dispatched'].indexOf(o.status || 'Placed') < 0).length;
  /* Over the live lines of the orders on screen, in one pass: what is still owed, and — the thing
   * this strip never said — what has already gone out. A printer wants to know what they have got
   * through as much as what is left. */
  const tot = { owedPcs: 0, owedM: 0, sentPcs: 0, sentM: 0, late: 0, noDate: 0 };
  rows.forEach(o => {
    const run = o.orderType === 'running';
    voLines(o).filter(l => !l.cancelled && vpPartOk(o, l)).forEach(l => {
      const left = Math.max(0, vpQty(o, l) - vpDone(l));
      if (run) { tot.owedM += left; tot.sentM += vpDone(l); }
      else { tot.owedPcs += left; tot.sentPcs += vpDone(l); }
      if (left > 0) {
        if (voLateBy(o, l) != null) tot.late++;
        else if (!voProm(l)) tot.noDate++;
      }
    });
  });
  const done = rows.length - open;

  /* One strip, not a card of four nineteen-pixel figures. Everything a printer needs to know about
   * where they stand, in the space the old heading alone used to take. */
  const amt = (p, m) => [p ? nf(p) + ' pcs' : '', m ? nf(m) + ' m' : ''].filter(Boolean).join(' · ') || '—';
  $('vpKpis').innerHTML = `<div class="vpbar">
    <span><b>${esc(VP.name)}</b> <span class="muted">· ${esc(VP.code)}</span></span>
    <span class="sep"></span>
    <span><b>${nf(open)}</b> open<span class="muted">${done ? ' · ' + nf(done) + ' done' : ''} of ${nf(rows.length)}</span></span>
    <span class="sep"></span>
    <span class="muted">Sent</span> <span style="color:#166534;font-weight:700">${amt(tot.sentPcs, tot.sentM)}</span>
    <span class="sep"></span>
    <span class="muted">Left to send</span> <span style="color:var(--bad);font-weight:700">${amt(tot.owedPcs, tot.owedM)}</span>
    ${tot.late ? `<span class="sep"></span><span style="color:var(--bad);font-weight:600">${nf(tot.late)} past your date</span>` : ''}
    ${tot.noDate ? `<span class="sep"></span><span style="color:#7f6000;font-weight:600">${nf(tot.noDate)} with no date from you</span>` : ''}
    <span style="flex:1"></span>
    <span class="muted" style="font-size:11px">your orders only${VP.at ? ' · ' + esc(VP.at) : ''}</span>
  </div>`;

  /* A PIN somebody else chose and read out is not a password yet. Said once, at the top, with the
   * button right there — not buried in a settings screen a printer will never open. */
  const nag = (vpOnPin() && !VP.pinFresh)
    ? `<div class="err" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <span style="flex:1 1 260px">You are still using the PIN you were given. Somebody else chose it and
        somebody else knows it — change it to one only you know.</span>
        <button id="vpPin">Change my PIN</button></div>`
    : '';
  /* THEIR OWN HISTORY. A different question from "what am I making" — what went out, and what was
   * kept — so it gets the screen to itself rather than another column on a full table. */
  /* THE RFD TAB SHOWS ONLY WHAT IT USES (Ravi, 2026-09-26: "data too much lag rha h do neet and clean"). */
  /* A vendor's browser is marked, so the full guide at /guide/ sends them to theirs. */
  if (spIsVendor()) { try { localStorage.setItem('guideRole', 'vendor'); } catch (e) { /* nothing to mark */ } }
  const rfdTab = VP.tab === 'rfd';
  ['vpBar2', 'vpBar3'].forEach(id => { if ($(id)) $(id).classList.toggle('hide', rfdTab); });
  ['vpView', 'vpStatus', 'vpType', 'vpQ', 'vpExport'].forEach(id => { if ($(id)) $(id).classList.toggle('hide', rfdTab); });
  if (rfdTab) { vpRfdRender(matched, nag); return; }

  if (VP.tab === 'hist') {
    const q = f.q;
    const hist = vpHistRows().filter(r => !q
      || [r.orderNo, r.sku, r.what, r.date].join(' ').toLowerCase().indexOf(q) >= 0);
    VP.hist = hist;
    const sum = (fn, run) => hist.filter(r => !!r.run === run).reduce((a, r) => a + fn(r), 0);
    const amt = (fn) => [sum(fn, false) ? nf(sum(fn, false)) + ' pcs' : '',
      sum(fn, true) ? nf(sum(fn, true)) + ' m' : ''].filter(Boolean).join(' · ') || '—';
    const waiting = hist.filter(r => r.kept === null).length;
    $('vpKpis').innerHTML = `<div class="vpbar">
      <span><b>${esc(VP.name)}</b> <span class="muted">· what I have sent</span></span>
      <span class="sep"></span>
      <span><b>${nf(hist.length)}</b> delivery(s)</span>
      <span class="sep"></span>
      <span class="muted">Sent</span> <span style="font-weight:700">${amt(r => r.sent)}</span>
      <span class="sep"></span>
      <span class="muted">Accepted</span> <span style="color:#166534;font-weight:700">${amt(r => r.kept || 0)}</span>
      <span class="sep"></span>
      <span class="muted">Short</span> <span style="color:var(--bad);font-weight:700">${amt(r => r.short)}</span>
      ${waiting ? `<span class="sep"></span><span style="color:#7f6000;font-weight:600">${nf(waiting)} not checked yet</span>` : ''}
      <span style="flex:1"></span>
      <span class="muted" style="font-size:11px">your deliveries only${VP.at ? ' · ' + esc(VP.at) : ''}</span>
    </div>`;
    body.innerHTML = nag + (hist.length ? vpHistTable(hist)
      : '<div class="card" style="padding:34px;text-align:center;color:var(--muted)">You have not recorded anything sent yet.</div>');
    if ($('vpPin')) $('vpPin').onclick = pinOpenChange;
    $('vpMsg').className = 'muted';
    $('vpMsg').textContent = `${nf(hist.length)} delivery(s)`;
    ptImgFill([], false, ptImgPatch);
    return;
  }

  const empty = `<div class="card" style="padding:34px;text-align:center;color:var(--muted)">${
    all.length ? 'No order matches those filters.' : 'No orders yet.'}</div>`;
  body.innerHTML = nag + (rows.length
    ? doneTab ? (rows.some(o => !vpIsShop(o)) ? vpTable(rows.filter(o => !vpIsShop(o)), f) : '') + (rows.some(vpIsShop) ? vpShopTable(rows.filter(vpIsShop), f) : '')
    : (VP.tab === 'shop' ? vpShopTable(rows, f)
      : (($('vpView') || {}).value === 'orders' ? rows.map(o => vpCard(o, f)).join('') : vpTable(rows, f)))
    : empty);
  if ($('vpPin')) $('vpPin').onclick = pinOpenChange;
  /* The count, and nothing else. The two paragraphs that used to sit here were written for somebody
   * opening this screen for the first time, and are read by people who have used it for weeks. */
  $('vpMsg').className = 'muted';
  $('vpMsg').textContent = rows.length === all.length
    ? `${nf(all.length)} order(s)`
    : `${nf(rows.length)} of ${nf(all.length)} order(s)`;
  ptImgFill(rows.flatMap(o => voLines(o).map(l => l.sku)).filter(Boolean), false, ptImgPatch);
}

/**
 * Every order's lines in one table, an order at a time.
 *
 * The bar row is the order: its number, what it is, where it has got to, and the buttons that belong
 * to it. Its lines follow. Cut and running sit in the same table because they are the same job to the
 * person doing them — the bar says which is which, and the unit travels with each number.
 *
 * There is deliberately no max-height here. A box that scrolls inside a page that also scrolls is two
 * scrollbars to fight, and it was showing four lines at a time.
 */
/** P1 first, P4 last, and a line with no priority after all of them. */
const vpPriRank = l => { const m = String((l && l.priority) || '').match(/^P([1-4])$/i); return m ? +m[1] : 9; };
const vpColour = l => String((l && l.color) || '').trim();

/**
 * A vendor's lines, grouped the way the work is actually done: one colour at a time, most urgent
 * first, every size of that colour together.
 *
 * The ORIGINAL index travels with each line. Everything a vendor types is addressed by it, so a row
 * that moved on screen must still write to the line it came from.
 */
function vpGroups(lines) {
  const sorted = lines.slice().sort((a, b) =>
    vpPriRank(a.l) - vpPriRank(b.l)
    || vpColour(a.l).toLowerCase().localeCompare(vpColour(b.l).toLowerCase())
    || String(a.l.size || '').localeCompare(String(b.l.size || ''), undefined, { numeric: true })
    || a.i - b.i);
  const out = [];
  sorted.forEach(x => {
    const key = String((x.l.priority || '')).toUpperCase() + '|' + vpColour(x.l).toLowerCase();
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(x);
    else out.push({ key, priority: String(x.l.priority || '').toUpperCase(), colour: vpColour(x.l), items: [x] });
  });
  return out;
}

/**
 * One row per product, every customer order on it.
 *
 * THE COMBINING IS FOR PRINTING; THE LINES UNDERNEATH ARE FOR TRACKING. Five orders for the same
 * tablecloth are one thing to print and five things to deliver, so the row adds the quantities up and
 * carries the order numbers, while what is typed against it is split back across the real lines.
 */
/**
 * The history table: what went out, what was kept, and what is still unanswered.
 *
 * A shortfall is shown in red because it is money — but only once somebody has actually answered the
 * delivery. Until then the row says "waiting", which is the truth and is not an accusation.
 */
function vpHistTable(rows) {
  const COLS = ['Date', 'Order', 'SKU / fabric', 'What', 'Sent', 'Accepted', 'Short', 'Status'];
  const head = COLS.map(h => `<th${['Sent', 'Accepted', 'Short'].indexOf(h) >= 0 ? ' class="num"' : ''}>${esc(h)}</th>`).join('');
  const body = rows.map(r => {
    const status = r.no ? '<span class="pill pill-out">did not arrive</span>'
      : r.ok && r.beyond > 0 ? `<span class="pill pill-low" title="Only what the order asked for is accepted.">${nf(r.beyond)} more than the order — not accepted</span>`
      : r.ok ? (r.short > 0 ? `<span class="pill pill-low">${nf(r.short)} short</span>`
                            : '<span class="pill pill-ok">accepted in full</span>')
      : '<span class="pill">waiting to be checked</span>';
    return '<tr>'
      + `<td style="text-align:left">${esc(r.date) || '<span class="muted">—</span>'}</td>`
      + `<td style="text-align:left;font-size:12px">${esc(r.orderNo)}</td>`
      + `<td style="text-align:left;font-family:ui-monospace,monospace;font-size:12px">${esc(r.sku)}</td>`
      + `<td style="text-align:left;font-size:12px">${esc(r.what)}</td>`
      + `<td class="num" style="font-weight:700">${nf(r.sent)} <span class="muted" style="font-weight:400;font-size:10px">${r.unit}</span></td>`
      + `<td class="num"${r.kept === null ? ' class="num"' : ''}>${r.kept === null ? '<span class="muted">—</span>'
          : `<span style="color:#166534;font-weight:700">${nf(r.kept)}</span>`}</td>`
      + `<td class="num">${r.short > 0 ? `<span style="color:var(--bad);font-weight:700">${nf(r.short)}</span>` : '<span class="muted">—</span>'}</td>`
      + `<td style="text-align:left">${status}${r.note ? `<div class="muted" style="font-size:10px;white-space:normal;max-width:220px">${esc(r.note)}</div>` : ''}</td>`
      + '</tr>';
  }).join('');
  return `<div class="xlwrap"><table class="xl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function vpShopTable(rows, f) {
  const COLS = ['SKU', 'Image', 'Article', 'Size', 'Customer orders', 'Ordered', 'Sent so far',
    'Balance', 'Your date', 'Sending now'];
  const head = COLS
    .map(h => `<th${['Ordered', 'Sent so far', 'Balance', 'Sending now'].indexOf(h) >= 0 ? ' class="num"' : ''}>${esc(h)}</th>`).join('');

  const body = rows.map(o => {
    const st = o.status || 'Placed';
    const can = VP_CAN_DELIVER.indexOf(st) >= 0;
    const on = !!(f && vpLineOn(f));
    const keep = voLines(o).map((l, i) => ({ l, i })).filter(({ l }) => (!on || voLineMatches(l, f)) && vpPartOk(o, l));
    if (!keep.length) return '';
    const flow = VP_FLOW[st];
    const cls = st === 'Cancelled' ? 'pill-out' : (st === 'Dispatched' || st === 'Received' ? 'pill-ok' : 'pill-low');

    /* One product, its lines, and the orders they came from. */
    const bySku = new Map();
    keep.forEach(({ l, i }) => {
      const k = obUC(l.sku);
      let g = bySku.get(k);
      if (!g) { g = { sku: l.sku, l, items: [] }; bySku.set(k, g); }
      g.items.push({ l, i });
    });
    /* Grouped by priority and colour, exactly as the bulk table groups, so both tabs read the same
     * way: a colour at a time, most urgent first. */
    const groups = vpGroups([...bySku.values()].map(g => ({ l: g.l, i: g.items[0].i, g })));

    const bar = `<tr data-vporder="${esc(o.id)}" style="background:var(--hover,#f1f5f9)">
      <td colspan="${COLS.length}" style="text-align:left;padding:7px 10px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <b style="font-size:14px">${esc(o.orderNo || o.id)}</b>${o.channel ? ` <span class="pill" style="background:#E9EFF6;color:#3A5573">For ${esc(o.channel)}</span>` : ''}
          <span class="pill">Customer orders${(m => m.size ? ' — ' + esc([...m].map(([k, n]) => k + ' ' + nf(n)).join(' · ')) : '')(
            keep.reduce((m, { l }) => { const k = vpPlatformOf(l) || 'not known'; m.set(k, (m.get(k) || 0) + 1); return m; }, new Map()))}</span>
          <span class="muted" style="font-size:12px">${nf(bySku.size)} product(s) · ${nf(keep.length)} customer order line(s)</span>
          <span style="flex:1"></span>
          <span class="pill ${cls}">${esc(st)}</span>
        </div>
        ${flow ? `<div style="margin-top:7px">
          <button data-vpflow="${esc(o.id)}">${flow === 'Acknowledged' ? 'Acknowledge this order' : 'Start production'}</button>
        </div>` : ''}
        <div data-vpmsg="${esc(o.id)}" class="muted" style="font-size:12.5px"></div>
      </td></tr>`;

    const lines = groups.map(grp => {
      const gHead = `<tr style="background:var(--line-2,#f8fafc)">
        <td colspan="${COLS.length}" style="text-align:left;padding:6px 10px;font-size:12.5px">
          ${grp.priority ? `<b style="color:var(--accent)">${esc(grp.priority)}</b> · ` : ''}
          <b>${esc(grp.colour) || 'no colour'}</b>
          <span class="muted">· ${nf(grp.items.length)} product(s)</span>
        </td></tr>`;
      return gHead + grp.items.map(({ g }) => {
        /* Oldest customer order first, so a part delivery fills the order that has waited longest
         * rather than whichever line happens to sit first in the list. */
        const items = g.items.slice().sort((a, b) =>
          String(a.l.shopOrderNo || '').localeCompare(String(b.l.shopOrderNo || ''), undefined, { numeric: true }));
        const live = items.filter(({ l }) => !l.cancelled);
        const ord = live.reduce((s, { l }) => s + vpQty(o, l), 0);
        const done = live.reduce((s, { l }) => s + vpDone(l), 0);
        const bal = Math.max(0, ord - done);
        const ix = live.map(({ i }) => i).join(',');
        const chips = items.map(({ l }) => {
          const left = Math.max(0, vpQty(o, l) - vpDone(l));
          const no = String(l.shopOrderNo || '').trim() || '?';
          const ref = String(l.shopRef || '').trim();
          const plat = vpPlatformOf(l);
          return `<span class="pill${left ? '' : ' pill-ok'}" title="${plat ? esc(plat) + ' order ' : ''}${esc(no)}${ref ? ' · ' + esc(ref) : ''} — ${
            left ? nf(left) + ' still to send' : 'done'}" style="font-size:11px">${esc(ref || no)}`
            + `<span class="muted">&times;${nf(vpQty(o, l))}</span></span>`;
        }).join(' ')
          /* WHERE THE ORDERS CAME FROM, under them (2026-09-28). */
          + (p => p ? `<div class="muted" style="font-size:11px;line-height:1.3">${esc(p)}</div>` : '')(
            [...new Set(items.map(({ l }) => vpPlatformOf(l) + (vpBuyerOf(l) ? ' · for ' + vpBuyerOf(l) : '')).filter(Boolean))].join(' / '));
        const l0 = g.items[0].l;
        /* One date for the product: every customer order for the same cloth is printed together, so
         * they are finished together too. */
        const dateVal = live.map(({ l }) => voProm(l)).find(Boolean) || '';
        return '<tr>'
          + `<td style="text-align:left;font-family:ui-monospace,monospace;font-size:12px">${esc(g.sku)}</td>`
          + ptImgCellSrc(g.sku, l0.img)
          + `<td style="text-align:left;font-size:12px">${esc(l0.articleSubtype || l0.articleType || '')}</td>`
          + `<td style="font-size:12px">${esc(l0.size || '') || '<span class="muted">—</span>'}</td>`
          + `<td style="text-align:left;white-space:normal;max-width:280px;line-height:1.9">${chips}</td>`
          + `<td class="num" style="font-weight:700">${nf(ord)} <span class="muted" style="font-weight:400;font-size:10px">pcs</span></td>`
          + `<td class="num" style="color:#166534">${done ? nf(done) : '<span class="muted">—</span>'}</td>`
          + `<td class="num">${bal > 0 ? `<span style="font-weight:700;color:var(--bad)">${nf(bal)}</span>`
              : '<span class="pill pill-ok">done</span>'}</td>`
          + `<td>${bal <= 0 ? '<span class="muted">—</span>'
              : `<input data-vppromg="${esc(o.id)}" data-ix="${esc(ix)}" type="date" value="${esc(dateVal)}" style="width:146px">`}</td>`
          + `<td class="num">${!can || bal <= 0 ? '<span class="muted">—</span>'
              : `<input data-vpsendg="${esc(o.id)}" data-ix="${esc(ix)}" type="number" min="0" max="${bal}" step="1"
                   placeholder="0" style="width:82px;text-align:right">`}</td>`
          + '</tr>';
      }).join('');
    }).join('');
    return bar + lines;
  }).join('');

  return `<div class="xlwrap"><table class="xl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

/** Where a customer order came from, for a printer who cannot read the order book: "Shopify · Ridhi". */
function vpPlatformOf(l) {
  const no = obUC(l && l.shopOrderNo);
  const src = /^SHP-/.test(no) || /shopify/i.test(String((l && l.notes) || '')) ? 'Shopify'
    : /^AMZ-/.test(no) ? 'Amazon' : /^B2B-/.test(no) ? 'B2B' : /^ONL-/.test(no) ? 'Online' : /^SPY-/.test(no) ? 'Shopify' : '';
  const sku = obUC(l && l.sku);
  /* Only a real brand counts: on a B2B line the brand box holds the BUYER ("Daina"), and RBP is Ridhi's code. */
  const own = VP_BRANDS[obUC(l && l.brand)] || '';
  const brand = own || (/^CPC/.test(sku) ? 'CPC' : /^R/.test(sku) ? 'Ridhi' : '');
  return [src, brand].filter(Boolean).join(' · ');
}
const VP_BRANDS = { RIDHI: 'Ridhi', RBP: 'Ridhi', CPC: 'CPC' };
/** The buyer of a B2B line, when its brand box holds one. */
const vpBuyerOf = l => (/^B2B-/.test(obUC(l && l.shopOrderNo)) && String((l && l.brand) || '').trim() && !VP_BRANDS[obUC(l.brand)]) ? String(l.brand).trim() : '';

function vpTable(rows, f) {
  /* Ten columns, not thirteen. The colour and the priority moved up into the group heading, and the
   * order number was on every row of an order whose bar already named it. */
  const COLS = ['SKU / fabric', 'Image', 'Article', 'Size', 'Ordered', 'Sent so far',
    'Balance', 'Wanted by', 'Your date', 'Sending now'];
  const head = COLS
    .map(h => `<th${['Ordered', 'Sent so far', 'Balance', 'Sending now'].indexOf(h) >= 0 ? ' class="num"' : ''}>${esc(h)}</th>`).join('');

  const body = rows.map(o => {
    const st = o.status || 'Placed';
    const can = VP_CAN_DELIVER.indexOf(st) >= 0;
    const run = o.orderType === 'running';
    const unit = run ? 'm' : 'pcs';
    const all = voLines(o);
    const on = !!(f && vpLineOn(f));
    const keep = all.map((l, i) => ({ l, i })).filter(({ l }) => (!on || voLineMatches(l, f)) && vpPartOk(o, l));
    if (!keep.length) return '';
    const flow = VP_FLOW[st];
    const cls = st === 'Cancelled' ? 'pill-out' : (st === 'Dispatched' || st === 'Received' ? 'pill-ok' : 'pill-low');

    /* The order itself, as one row across the table. Everything that belongs to the WHOLE order lives
     * here — there is nowhere else for it to go once the cards are gone. */
    const bar = `<tr data-vporder="${esc(o.id)}" style="background:var(--hover,#f1f5f9)">
      <td colspan="${COLS.length}" style="text-align:left;padding:7px 10px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <b style="font-size:14px">${esc(o.orderNo || o.id)}</b>${o.channel ? ` <span class="pill" style="background:#E9EFF6;color:#3A5573">For ${esc(o.channel)}</span>` : ''}
          <span class="pill">${esc(run ? 'Running fabric — metres' : 'Cut fabric — pieces')}</span>
          <span class="muted" style="font-size:12px">raised ${esc(o.orderDate) || '—'}${
            o.lastDispatchDate ? ' · last sent ' + esc(o.lastDispatchDate) : ''}${
            on && keep.length < all.length ? ' · ' + nf(all.length - keep.length) + ' line(s) filtered out' : ''}</span>
          <span style="flex:1"></span>
          <span class="pill ${cls}">${esc(st)}</span>
        </div>
        ${o.notes ? `<div class="ptnote" style="margin-top:7px">From the buyer: ${esc(o.notes)}</div>` : ''}
        ${flow ? `<div style="margin-top:7px">
          <button data-vpflow="${esc(o.id)}">${flow === 'Acknowledged' ? 'Acknowledge this order' : 'Start production'}</button>
        </div>` : ''}
        <div data-vpmsg="${esc(o.id)}" class="muted" style="font-size:12.5px"></div>
      </td></tr>`;

    const lines = vpGroups(keep).map(g => {
      /* THE COLOUR, ONCE, WITH ITS PRIORITY — and how much of it there is, because that is the
       * question a printer asks before starting a colour. */
      const gQty = g.items.filter(({ l }) => !l.cancelled).reduce((s, { l }) => s + vpQty(o, l), 0);
      const gLeft = g.items.filter(({ l }) => !l.cancelled)
        .reduce((s, { l }) => s + Math.max(0, vpQty(o, l) - vpDone(l)), 0);
      const gHead = `<tr style="background:var(--line-2,#f8fafc)">
        <td colspan="${COLS.length}" style="text-align:left;padding:6px 10px;font-size:12.5px">
          ${g.priority ? `<b style="color:var(--accent)">${esc(g.priority)}</b> · ` : ''}
          <b>${esc(g.colour) || 'no colour'}</b>
          <span class="muted">· ${nf(g.items.length)} line(s) · ${nf(gQty)} ${unit}${
            gLeft ? ' · ' + nf(gLeft) + ' still to send' : ' · done'}</span>
        </td></tr>`;
      return gHead + g.items.map(({ l, i }) => {
      const ord = vpQty(o, l), done = vpDone(l), bal = Math.max(0, ord - done);
      const dead = l.cancelled === true;
      const dels = (Array.isArray(l.deliveries) ? l.deliveries : Object.values(l.deliveries || {})).filter(Boolean);
      return `<tr${dead ? ' style="opacity:.5"' : ''}>`
        + `<td style="text-align:left;font-family:ui-monospace,monospace;font-size:12px">${esc(run ? (l.sku || l.fabricType) : l.sku)}${run && l.sku ? `<div class="muted" style="font-size:10.5px;font-family:inherit">${esc(l.fabricType)}</div>` : ''}</td>`
        + (run ? (l.img ? ptImgCellSrc(l.sku, l.img) : '<td class="muted">—</td>') : ptImgCell(l.sku))
        + `<td style="text-align:left;font-size:12px">${esc(run
            ? (l.printDirection || '')
            : (l.articleSubtype || l.articleType || ''))}</td>`
        + `<td style="font-size:12px">${esc(run ? '' : (l.size || '')) || '<span class="muted">—</span>'}</td>`
        + `<td class="num" style="font-weight:700">${nf(ord)} <span class="muted" style="font-weight:400;font-size:10px">${unit}</span></td>`
        + `<td class="num" style="color:#166534">${done ? nf(done) : '<span class="muted">—</span>'}`
          + `${dels.length ? `<div class="muted" style="font-size:10px">${dels.map(d => nf(parseFloat(d.qty) || 0) + (d.date ? ' @ ' + esc(d.date) : '')).join(' · ')}</div>` : ''}</td>`
        + `<td class="num">${dead ? '<span class="pill pill-out">cancelled</span>'
            : (bal > 0 ? `<span style="font-weight:700;color:var(--bad)">${nf(bal)}</span>` : '<span class="pill pill-ok">done</span>')}</td>`
        + `<td class="muted" style="font-size:12px">${voWant(l) ? esc(dShow(voWant(l))) : '—'}</td>`
        + `<td>${dead || bal <= 0 ? '<span class="muted">—</span>'
            : `<input data-vpprom="${esc(o.id)}" data-i="${i}" type="date" value="${esc(voProm(l))}" style="width:146px">`
              + (voMoves(l) ? `<div class="muted" style="font-size:10px">first said ${esc(dShow(voPromFirst(l)))}</div>` : '')}</td>`
        + `<td class="num">${!can || dead || bal <= 0 ? '<span class="muted">—</span>'
            : `<input data-vpsend="${esc(o.id)}" data-i="${i}" type="number" min="0" max="${bal}" step="${run ? '0.01' : '1'}"
                 placeholder="0" style="width:82px;text-align:right">`}</td>`
        + '</tr>';
      }).join('');
    }).join('');
    return bar + lines;
  }).join('');

  /* No max-height: one scrollbar on the page beats two fighting each other, and the box this
   * replaces was showing four lines at a time. */
  return `<div class="card xlwrap" style="padding:0">
    <table class="xl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function vpCard(o, f) {
  const st = o.status || 'Placed';
  const can = VP_CAN_DELIVER.indexOf(st) >= 0;
  const run = o.orderType === 'running';
  const unit = run ? 'm' : 'pcs';
  const all = voLines(o);
  /* The filters narrow the LINES, so a printer looking for one colour sees that colour — but the row
   * index has to stay the real one, or what they type lands on a different line. */
  const on = !!(f && vpLineOn(f));
  const keep = all.map((l, i) => ({ l, i })).filter(({ l }) => (!on || voLineMatches(l, f)) && vpPartOk(o, l));
  const lines = all;
  /* WANTED BY was not on this screen at all — the vendor was being asked to hit a date nobody had
   * shown them. It is here now, next to the box where they answer it. */
  const head = (run ? ['Fabric', 'Colour', 'Print'] : ['SKU', 'Image', 'Item'])
    .concat(['Priority', 'Ordered', 'Sent so far', 'Balance', 'Wanted by', 'Your date'])
    .concat(can ? ['Sending now'] : [])
    .map(h => `<th${['Ordered', 'Sent so far', 'Balance', 'Sending now'].indexOf(h) >= 0 ? ' class="num"' : ''}>${h}</th>`).join('');
  const body = keep.map(({ l, i }) => {
    const ord = vpQty(o, l), done = vpDone(l), bal = Math.max(0, ord - done);
    const dead = l.cancelled === true;
    const dels = (Array.isArray(l.deliveries) ? l.deliveries : Object.values(l.deliveries || {})).filter(Boolean);
    const lead = run
      ? `<td style="text-align:left">${esc(l.fabricType)}${l.sku ? `<div class="muted" style="font-family:ui-monospace,monospace;font-size:11px">${esc(l.sku)}</div>` : ''}</td><td>${esc(l.color)}</td><td>${esc(l.printDirection)}</td>`
      : `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(l.sku)}</td>${ptImgCell(l.sku)}`
        + `<td style="text-align:left;font-size:11.5px">${esc([l.articleType, l.articleSubtype, l.color, l.size].filter(Boolean).join(' · '))}</td>`;
    return `<tr${dead ? ' style="opacity:.5"' : ''}>` + lead
      + `<td>${esc(l.priority) || '<span class="muted">—</span>'}</td>`
      + `<td class="num" style="font-weight:700">${nf(ord)}</td>`
      + `<td class="num" style="color:#166534">${done ? nf(done) : '<span class="muted">—</span>'}`
      /* The rounds themselves, so a vendor can see what they have already told us. */
      + `${dels.length ? `<div class="muted" style="font-size:10px">${dels.map(d => nf(parseFloat(d.qty) || 0) + (d.date ? ' @ ' + esc(d.date) : '')).join(' · ')}</div>` : ''}</td>`
      + `<td class="num">${dead ? '<span class="pill pill-out">cancelled</span>'
        : (bal > 0 ? `<span style="font-weight:700;color:var(--bad)">${nf(bal)}</span>` : '<span class="pill pill-ok">done</span>')}</td>`
      /* What the buyer asked for, and the box where this vendor says what they can really do. */
      + `<td class="muted" style="font-size:12px">${voWant(l) ? esc(dShow(voWant(l))) : '—'}</td>`
      + `<td>${dead || bal <= 0 ? '<span class="muted">—</span>'
        : `<input data-vpprom="${esc(o.id)}" data-i="${i}" type="date" value="${esc(voProm(l))}" style="width:148px">`
          + (voMoves(l) ? `<div class="muted" style="font-size:10px">first said ${esc(dShow(voPromFirst(l)))}</div>` : '')}</td>`
      + (can ? `<td class="num">${dead || bal <= 0 ? '<span class="muted">—</span>'
        : `<input data-vpsend="${esc(o.id)}" data-i="${i}" type="number" min="0" max="${bal}" step="${run ? '0.01' : '1'}"
             placeholder="0" style="width:82px;text-align:right">`}</td>` : '')
      + '</tr>';
  }).join('');

  const flow = VP_FLOW[st];
  const cls = st === 'Cancelled' ? 'pill-out' : (st === 'Dispatched' || st === 'Received' ? 'pill-ok' : 'pill-low');
  return `<div class="card" style="padding:14px 16px;margin-bottom:12px">
    <div class="toolbar" style="align-items:baseline">
      <b style="font-size:15px">${esc(o.orderNo || o.id)}</b>
      <span class="muted" style="font-size:12px">${esc(run ? 'running fabric — metres' : 'cut fabric — pieces')}
        · raised ${esc(o.orderDate) || '—'}${o.lastDispatchDate ? ' · last sent ' + esc(o.lastDispatchDate) : ''}</span>
      <span style="flex:1"></span><span class="pill ${cls}">${esc(st)}</span>
    </div>
    ${o.notes ? `<div class="ptnote" style="margin-top:8px">From the buyer: ${esc(o.notes)}</div>` : ''}
    <div class="xlwrap" style="border:1px solid var(--line);border-radius:10px;margin-top:8px">
      <table class="xl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    ${on && keep.length < all.length ? `<div class="muted" style="font-size:12px;margin-top:6px">${
      nf(all.length - keep.length)} of this order's line(s) are filtered out.</div>` : ''}
    ${flow ? `<div class="toolbar" style="margin-top:10px">
      <button data-vpflow="${esc(o.id)}">${flow === 'Acknowledged' ? 'Acknowledge this order' : 'Start production'}</button>
    </div>` : ''}
    <div data-vpmsg="${esc(o.id)}" class="muted" style="margin-top:8px;font-size:12.5px"></div>
  </div>`;
}

const vpSay = (id, msg, bad) => { const el = document.querySelector(`[data-vpmsg="${id}"]`);
  if (el) { el.className = bad ? 'err' : 'muted'; el.textContent = msg; } };

/** Write the order back to its own branch, and keep the copy this screen holds in step. */
async function vpSave(o, note) {
  const rec = Object.assign({}, o);
  delete rec.vendorCode;                    // this app's own bookkeeping, never stored
  rec.vendorUpdatedAt = new Date().toISOString();
  await ptPut('pt_vendorOrders/' + VP.code + '/' + o.id, rec);
  VP.rows = (VP.rows || []).map(x => (x.id === o.id ? rec : x));
  renderVp();
  if (note) vpSay(o.id, note);
  return '';
}

async function vpFlow(id) {
  const o = (VP.rows || []).find(x => x.id === id); if (!o) return;
  const next = VP_FLOW[o.status || 'Placed'];
  if (!next) return;
  try { await vpSave(Object.assign({}, o, { status: next }), `Marked as ${next}.`); }
  catch (e) { vpSay(id, 'Not saved: ' + (e.message || e), true); }
}

/**
 * Record a round against one order, from quantities ALREADY READ off the screen.
 *
 * No DOM in here on purpose. Writing calls vpSave, which re-renders — so a loop that read each order
 * as it went would wipe the boxes the vendor had typed into on the orders it had not reached yet.
 * Reading happens first, all of it; this only writes.
 *
 * The typed map is { lineIndex: quantity }. Returns a message, empty when it went through.
 */
async function vpDeliverWith(o, typed, iso) {
  if (!o) return 'That order is no longer here.';
  if (!iso) return 'Put the date you are sending on.';
  // This database keeps dates day-first. Writing the input's YYYY-MM-DD would break every reader.
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = m ? `${m[3]}/${m[2]}/${m[1]}` : iso;

  const lines = voLines(o).map(l => Object.assign({}, l));
  let any = false, capped = 0;
  const now = new Date().toISOString();
  lines.forEach((l, i) => {
    if (l.cancelled) return;                                  // a cancelled line can never take a delivery
    let q = parseFloat(typed && typed[i]) || 0;
    if (q <= 0) return;
    const bal = Math.max(0, vpQty(o, l) - vpDone(l));
    if (bal <= 0) return;
    if (q > bal) { q = bal; capped++; }                       // a round can never exceed what is left
    const d = (Array.isArray(l.deliveries) ? l.deliveries : Object.values(l.deliveries || {})).filter(Boolean);
    l.deliveries = d.concat([{ qty: q, date, by: ME.email, at: now }]);
    // The staff screens read these two; they are rewritten from the array, never added to.
    l.vendorQty = l.deliveries.reduce((s, x) => s + (parseFloat(x.qty) || 0), 0);
    l.dispatchedQty = l.vendorQty;
    any = true;
  });
  if (!any) return 'Put a quantity against at least one line you are sending now.';

  const allDone = lines.every(l => l.cancelled || vpDone(l) >= vpQty(o, l));
  const next = Object.assign({}, o, { lines, status: allDone ? 'Dispatched' : 'Partially Dispatched',
    lastDispatchDate: date, dispatchDate: o.dispatchDate || date });
  try {
    await vpSave(next, '');
    VP.lastNote = `${o.orderNo || o.id}: recorded, dated ${date}.`
      + (capped ? ` ${nf(capped)} line(s) trimmed to the balance left.` : '')
      + (allDone ? ' That completes it.' : '');
    return '';
  } catch (e) { return 'Not saved: ' + (e.message || e); }
}

/**
 * Record every quantity typed anywhere in the table, whichever order each line belongs to.
 *
 * EVERYTHING IS READ FIRST. The first write re-renders the table, and anything not yet read would be
 * gone — so the plan is built from the screen in one pass, and only then written, order by order.
 */
async function vpRecordAll() {
  const say = (t, bad) => { const el = $('vpActMsg');
    if (el) { el.className = bad ? 'err' : 'muted'; el.textContent = t; } };
  const iso = String(($('vpSendDate') || {}).value || '').trim();
  if (!iso) return say('Put the date you are sending on.', true);

  const plan = [];
  (VP.shown || []).forEach(o => {
    if (VP_CAN_DELIVER.indexOf(o.status || 'Placed') < 0) return;   // not an order you can send against
    const typed = {};
    let n = 0;
    voLines(o).forEach((l, i) => {
      const el = document.querySelector(`[data-vpsend="${o.id}"][data-i="${i}"]`);
      const q = parseFloat(el && el.value) || 0;
      if (q > 0) { typed[i] = q; n++; }
    });
    /* A COMBINED ROW IS SPLIT BACK ACROSS ITS CUSTOMER ORDERS, oldest first. Five orders for the same
     * cloth are printed together and delivered one order at a time — putting the whole quantity on
     * the first line would leave four orders open and one over-delivered. */
    document.querySelectorAll(`[data-vpsendg="${o.id}"]`).forEach(el => {
      let q = parseFloat(el && el.value) || 0;
      if (!(q > 0)) return;
      const lines = voLines(o);
      String(el.getAttribute('data-ix') || '').split(',').forEach(s => {
        const i = parseInt(s, 10);
        const l = lines[i];
        if (!l || !(q > 0)) return;
        const room = Math.max(0, vpQty(o, l) - vpDone(l) - (typed[i] || 0));
        if (room <= 0) return;
        const take = Math.min(room, q);
        typed[i] = (typed[i] || 0) + take;
        q -= take; n++;
      });
    });
    if (n) plan.push({ o, typed, n });
  });
  if (!plan.length) return say('Put a quantity against at least one line you are sending now.', true);

  say('Recording…');
  const notes = [], bad = [];
  for (const p of plan) {
    /* The order is re-read from VP.rows each time: the write before this one replaced it. */
    const fresh = (VP.rows || []).find(x => x.id === p.o.id) || p.o;
    const err = await vpDeliverWith(fresh, p.typed, iso);
    if (err) bad.push((p.o.orderNo || p.o.id) + ': ' + err); else notes.push(VP.lastNote);
  }
  say(bad.length ? bad.join(' ') : notes.join('  '), bad.length > 0);
}

/** The per-order button, for anywhere it is still drawn: read this order's boxes, then write. */
async function vpDeliver(id) {
  const o = (VP.rows || []).find(x => x.id === id); if (!o) return;
  const dEl = document.querySelector(`[data-vpdate="${id}"]`);
  const iso = (dEl ? dEl.value : '') || String(($('vpSendDate') || {}).value || '');
  const typed = {};
  voLines(o).forEach((l, i) => {
    const el = document.querySelector(`[data-vpsend="${id}"][data-i="${i}"]`);
    const q = parseFloat(el && el.value) || 0;
    if (q > 0) typed[i] = q;
  });
  const err = await vpDeliverWith(o, typed, iso);
  vpSay(id, err || VP.lastNote || 'Recorded.', !!err);
}

/**
 * The vendor's own delivery dates.
 *
 * THEIR FIRST PROMISE IS KEPT. Without that, a vendor who slips a week every week edits the date each
 * time and is permanently on schedule — the record would show nothing, which is worse than no record
 * at all. vendorDateFirst is written once; every later change is added to the log instead.
 */
async function vpPromise(id, bulkIn, typedIn) {
  const o = (VP.rows || []).find(x => x.id === id); if (!o) return '';
  const all = document.querySelector(`[data-vpallprom="${id}"]`);
  /* The bulk date now lives in the toolbar, one for the whole screen. A per-order box is still read
   * first for anywhere one is still drawn. */
  const bulk = bulkIn !== undefined ? String(bulkIn || '').trim()
    : (all ? String(all.value || '').trim() : String(($('vpPromDate') || {}).value || '').trim());
  const now = new Date().toISOString();
  const lines = voLines(o).map(l => Object.assign({}, l));
  let changed = 0, bad = 0;
  lines.forEach((l, i) => {
    if (l.cancelled || vpQty(o, l) - vpDone(l) <= 0) return;     // nothing owed, nothing to promise
    /* Read from the plan when there is one — a write re-renders, and a later order's boxes would be
     * gone by the time this reached them. */
    const el = typedIn ? null : document.querySelector(`[data-vpprom="${id}"][data-i="${i}"]`);
    const typed = typedIn ? String(typedIn[i] || '').trim() : (el ? String(el.value || '').trim() : '');
    const want = bulk || typed;
    if (!want) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(want)) { bad++; return; }
    if (want === voProm(l)) return;                              // unchanged is not a promise moved
    const was = voProm(l);
    l.vendorDate = want;
    if (!l.vendorDateFirst) l.vendorDateFirst = want;            // written once, never again
    else l.vendorDateLog = (Array.isArray(l.vendorDateLog) ? l.vendorDateLog : [])
      .concat([{ from: was, to: want, at: now }]);
    l.vendorDateAt = now;
    changed++;
  });
  if (bad) return `${nf(bad)} date(s) could not be read. Pick them from the calendar.`;
  if (!changed) { VP.lastNote = ''; return ''; }
  try {
    await vpSave(Object.assign({}, o, { lines }), '');
    if (all) all.value = '';
    VP.lastNote = `${o.orderNo || o.id}: ${nf(changed)} date(s) saved.`;
    return '';
  } catch (e) { return 'Not saved: ' + (e.message || e); }
}

/**
 * Save every delivery date typed anywhere in the table, across every order shown.
 *
 * Read first, write after — a save re-renders, and the dates on the orders below would be gone
 * before they were read.
 */
async function vpPromiseAll() {
  const say = (t, bad) => { const el = $('vpActMsg');
    if (el) { el.className = bad ? 'err' : 'muted'; el.textContent = t; } };
  const bulk = String(($('vpPromDate') || {}).value || '').trim();
  const plan = [];
  (VP.shown || []).forEach(o => {
    const typed = {};
    let n = 0;
    voLines(o).forEach((l, i) => {
      const el = document.querySelector(`[data-vpprom="${o.id}"][data-i="${i}"]`);
      const v = el ? String(el.value || '').trim() : '';
      if (v) { typed[i] = v; n++; }
    });
    /* One date on a combined row is the date for every customer order on it: they are printed
     * together, so they are finished together. */
    document.querySelectorAll(`[data-vppromg="${o.id}"]`).forEach(el => {
      const v = String(el.value || '').trim();
      if (!v) return;
      String(el.getAttribute('data-ix') || '').split(',').forEach(s => {
        const i = parseInt(s, 10);
        if (i >= 0) { typed[i] = v; n++; }
      });
    });
    if (n || bulk) plan.push({ o, typed });
  });
  if (!plan.length) return say('Pick a date first — one for everything, or one on a line.', true);

  say('Saving…');
  const notes = [], bad = [];
  for (const p of plan) {
    const err = await vpPromise(p.o.id, bulk, p.typed);
    if (err) bad.push((p.o.orderNo || p.o.id) + ': ' + err);
    else if (VP.lastNote) notes.push(VP.lastNote);
  }
  if (!bad.length && !notes.length) return say('Nothing to save — those are already your dates.');
  say(bad.length ? bad.join(' ')
    : notes.join('  ') + '  The buyer plans on these now, so tell us here if one moves.', bad.length > 0);
}

$('vpBody').addEventListener('click', e => {
  const f = e.target.closest('[data-vpflow]'); if (f) return vpFlow(f.getAttribute('data-vpflow'));
  const d = e.target.closest('[data-vpdeliver]'); if (d) return vpDeliver(d.getAttribute('data-vpdeliver'));
  const p = e.target.closest('[data-vpsaveprom]'); if (p) return vpPromise(p.getAttribute('data-vpsaveprom'));
});
['vpView', 'vpStatus', 'vpType', 'vpAt', 'vpSub', 'vpCol', 'vpSz', 'vpPri'].forEach(id => {
  const el = $(id); if (el) el.onchange = renderVp;
});
$('vpQ').oninput = renderVp;
$('vpRecordAll').onclick = vpRecordAll;
$('vpSaveProm').onclick = vpPromiseAll;
/* Today, because that is the day a vendor is almost always recording. */
if ($('vpSendDate') && !$('vpSendDate').value) $('vpSendDate').value = dToday();
$('vpClear').onclick = () => {
  ['vpStatus', 'vpType', 'vpAt', 'vpSub', 'vpCol', 'vpSz', 'vpPri', 'vpQ'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
  renderVp();
};
$('vpTabBulk').onclick = () => { VP.tab = 'bulk'; renderVp(); };
$('vpTabShop').onclick = () => { VP.tab = 'shop'; renderVp(); };
$('vpTabDone').onclick = () => { VP.tab = 'done'; renderVp(); };
$('vpTabHist').onclick = () => { VP.tab = 'hist'; renderVp(); };
$('vpTabRfd').onclick = () => { VP.tab = 'rfd'; renderVp(); };
$('vpGo').onclick = async () => { VP.rows = null; await ensureVp(); };
// Only an account that signs in with a PIN has one to change.
$('vpPinBtn').onclick = pinOpenChange;
/**
 * The rows a download carries: what is on the screen, in the order the screen puts it.
 *
 * ONE THING PER COLUMN. SKU, article, colour and size shared a cell before, which is fine to read and
 * useless to sort, filter or total by — the whole reason for opening it in Excel. Priority was not
 * there at all, so the one thing the file could not tell you was the order to work in.
 *
 * Grouped colour by colour inside each order, exactly as the screen groups them, so the file and the
 * screen can be read side by side.
 */
function vpExportRows(rows, f) {
  const out = [['Order', 'Type', 'Raised', 'Status', 'Priority', 'SKU / fabric', 'Article', 'Colour',
    'Size', 'Line', 'Ordered', 'Unit', 'Sent so far', 'Balance', 'Wanted by', 'Your date', 'Rounds']];
  const on = !!(f && vpLineOn(f));
  rows.forEach(o => {
    const run = o.orderType === 'running';
    const keep = voLines(o).map((l, i) => ({ l, i })).filter(({ l }) => (!on || voLineMatches(l, f)) && vpPartOk(o, l));
    vpGroups(keep).forEach(g => g.items.forEach(({ l }) => {
      const ord = vpQty(o, l), done = vpDone(l);
      const dels = (Array.isArray(l.deliveries) ? l.deliveries : Object.values(l.deliveries || {})).filter(Boolean);
      out.push([o.orderNo || o.id, run ? 'running' : 'cut', o.orderDate, o.status,
        l.priority || '',
        run ? (l.sku ? l.sku + ' · ' : '') + (l.fabricType || '') : (l.sku || ''),
        run ? (l.printDirection || '') : (l.articleSubtype || l.articleType || ''),
        l.color || '',
        run ? '' : (l.size || ''),
        l.cancelled ? 'cancelled' : 'active', ord, run ? 'm' : 'pcs',
        done, l.cancelled ? 0 : Math.max(0, ord - done),
        voWant(l), voProm(l),
        dels.map(x => x.date + ':' + x.qty).join(' | ')]);
    }));
  });
  return out;
}

$('vpExport').onclick = () => {
  /* WHAT IS ON SCREEN, filters and all — downloading the whole book while looking at one colour is
   * the surest way to end up working from the wrong list. */
  /* The history is a different list with different columns, so the file follows the tab rather than
   * handing somebody their orders when they are looking at what they sent. */
  if (VP.tab === 'hist') {
    const hist = VP.hist || vpHistRows();
    if (!hist.length) return;
    const out = [['Date', 'Order', 'SKU / fabric', 'What', 'Sent', 'Unit', 'Accepted', 'Short', 'Status', 'Note']];
    hist.forEach(r => out.push([r.date, r.orderNo, r.sku, r.what, r.sent, r.unit,
      r.kept === null ? '' : r.kept, r.short || '',
      r.no ? 'did not arrive' : (r.ok ? (r.short > 0 ? 'short' : 'accepted in full') : 'waiting to be checked'),
      r.note]));
    return ptDownload('what-i-have-sent', out.map(r => r.map(csvCell).join(',')));
  }
  const rows = VP.shown || vpVisible(VP.rows); if (!rows.length) return;
  const out = vpExportRows(rows, vpF());
  if (out.length < 2) return;
  ptDownload('my-vendor-orders', out.map(r => r.map(csvCell).join(',')));
};

/* ---- staff side: giving a printer their login ----
 *
 * A vendor can only be recognised by an email or a cellphone that is written into pt_vendorMap, and
 * the map is also what pt_loginDir turns a phone number into. This is the only thing that connects
 * a person signing in to the orders they are allowed to see.
 */
async function voSyncAccess() {
  if (!ME.admin) return 'Only an admin can give a vendor portal access.';
  const vendors = voAllVendors();
  /* A vendor can be mapped on either a real email OR a cellphone. Neither means there is nothing
   * to identify them by at all, and they are named rather than quietly skipped. */
  const mappable = vendors.filter(v => vmValid(v.email) || vpPhone(v.phone).length >= 10
    || vmValid(((VO.map || {})[v.code] || {}).email));
  if (!mappable.length) return 'No vendor in the vendor master has an email address or a cellphone, so there is nothing to map.';
  const updates = {}, made = [];
  /* Built from every vendor, not from the ones that survived the filter — a vendor with nothing to
   * identify them by is the one who most needs to be named. */
  const unreachable = vendors.filter(v => mappable.indexOf(v) < 0).map(v => v.desc || v.name || v.code);
  mappable.forEach(v => {
    const ph = vpPhone(v.phone);
    const had = (VO.map && VO.map[v.code]) || {};
    /* THE PRINTER'S OWN ADDRESS COMES FIRST. It is the only one a password link can reach, so a
     * real address on the master beats anything already mapped — including the made-up
     * @vendors-tfr.app one the old tool invents, which no mailbox exists for.
     * An already-mapped REAL address is kept: changing it would lock out a printer using it.
     * VND001 is mapped to "sonu@the fabricrush.com"; the space means that address can never sign in,
     * so keeping it would preserve the lockout. */
    const clean = String(v.email || '').trim().toLowerCase();
    const mapped = String(had.email || '').trim().toLowerCase();
    const email = vmReal(clean) ? clean
      : (vmReal(mapped) ? mapped
        : (vmValid(mapped) ? mapped : (ph ? 'p' + ph + '@vendors-tfr.app' : '')));
    if (!email) { unreachable.push(v.desc || v.name || v.code); return; }
    const mended = !!mapped && mapped !== email;
    const placeholder = !vmReal(email);
    /* desc is what a master row calls a vendor; name is the login cache's own field. Reading v.name
     * off a master row is always undefined, so every row written here was named after its code. */
    updates['pt_vendorMap/' + v.code] = { email, phone: ph, name: v.desc || v.name || v.code };
    // The phone directory is the old tool's PIN login. It is kept working while both run.
    if (ph) updates['pt_loginDir/' + ph] = { email, name: v.desc || v.name || v.code, updatedAt: new Date().toISOString() };
    /* The index the database rules read. Without it a vendor's isolation is only this app's good
     * behaviour; with it, the rules can refuse a vendor everything outside their own branch. */
    updates['pt_vendorByEmail/' + vpEmailKey(email)] = { code: v.code, name: v.desc || v.name || v.code, phone: ph };
    made.push({ code: v.code, name: v.desc || v.name || v.code, email, isNew: !had.email, mended, placeholder });
  });
  await ptPatch(updates);
  made.forEach(x => { VO.map[x.code] = { email: x.email, phone: vpPhone(x.email), name: x.name }; });
  renderVo();
  const fresh = made.filter(x => x.isNew), mendedOnes = made.filter(x => x.mended);
  const noMailbox = made.filter(x => x.placeholder);
  $('voMsg').className = 'muted';
  $('voMsg').textContent = `${nf(made.length)} printer(s) mapped. `
    + (fresh.length ? `New: ${fresh.map(x => x.name + ' → ' + x.email).join(', ')}. ` : '')
    + (mendedOnes.length ? `Changed: ${mendedOnes.map(x => x.name + ' → ' + x.email).join(', ')}. ` : '')
    + (noMailbox.length ? `${nf(noMailbox.length)} printer(s) are on an address no mailbox exists for, so a `
      + `password link cannot reach them — put their own email on the master under "Printers": `
      + `${noMailbox.map(x => x.name).join(', ')}. ` : '')
    + (unreachable.length ? `${nf(unreachable.length)} printer(s) have neither an email nor a cellphone and `
      + `could not be mapped at all: ${unreachable.join(', ')}. ` : '')
    + 'A mapping is not a login: each of these emails still needs an account in this app before that '
    + 'vendor can sign in, and they set their own password with "Forgot password?".';
  return '';
}

$('voSync').onclick = async () => {
  if (!ME.admin) { $('voMsg').className = 'err'; $('voMsg').textContent = 'Only an admin can give a vendor portal access.'; return; }
  if (VO.rows === null) await ensureVo();
  if (!PTG.masters) await ptLoadGates();
  /* This writes to the vendor list the portal reads, so it says what it will do before doing it —
   * and it must count the same vendors voSyncAccess will map, or it offers 6 and does 9. */
  const n = voAllVendors().filter(v => vpPhone(v.phone).length >= 10).length;
  if (!confirm('Map portal access for ' + n + ' vendor(s) from the cellphone on their master record?\n\n'
    + 'Each vendor will only ever see their own orders. An email already mapped is left alone.')) return;
  $('voMsg').className = 'muted'; $('voMsg').textContent = 'Mapping…';
  try { const err = await voSyncAccess(); if (err) { $('voMsg').className = 'err'; $('voMsg').textContent = err; } }
  catch (e) { $('voMsg').className = 'err'; $('voMsg').textContent = 'Not saved: ' + (e.message || e); }
};


/* ---- RFD: what this printer needs in cloth ----
 *
 * The same sum the office sees, on the printer's own screen, before they ask — so an ask that is
 * going to need somebody's approval says so at the keyboard rather than after two days of silence.
 *
 * Only orders still being worked on. Cloth for an order already sent back is not a requirement, it
 * is a question about last month.
 */
const vpRfdOrders = () => (VP.rows || []).filter(o => o
  && ['Received', 'Cancelled'].indexOf(o.status || 'Placed') < 0
  /* Either kind counts. An order that is entirely Tablecloths has no cloth to ask for at all and is
   * still an order whose pieces have to be asked for. */
  && (rfdFabrics(o).length > 0 || rfdPieceLines(o).length > 0))
  /* THE ORDERS THE STORE SENDS COME FIRST, NEWEST FIRST (2026-09-27): the tab opens on the first one, and it used to be
   * the oldest — the new way of working sat at the bottom of the list and "nothing changed" on screen. */
  .sort((a, b) => (rfdTracked(b) - rfdTracked(a)) || (voWhenMs(b) - voWhenMs(a)));

/** Every ask this printer has made, newest first, with where it stands. */
function vpRfdRows() {
  const out = [];
  (VP.rows || []).forEach(o => rfdReqsOf(o).forEach(r => out.push(Object.assign({}, r, {
    _order: o, orderNo: r.orderNo || o.orderNo || o.id,
    /* THE PRINTER'S COPY, which is all they can read — the real decision lives where they cannot
     * write it. Until somebody answers, the stage is the one this end would work out anyway: inside
     * the order is already agreed, beyond it is waiting. */
    stage: (r.shown && r.shown.stage) || (rfdAuto(r, o) ? 'approved' : 'pending'),
    answer: (r.shown && r.shown.note) || '',
    sent: (r.shown && parseFloat(r.shown.sent)) || 0,
  }))));
  return out.sort((a, b) => String(b.raisedAt || '').localeCompare(String(a.raisedAt || '')));
}

/**
 * Every lot that has reached this printer, newest first — read off the copy left for them, which is
 * all a vendor can see.
 */
function vpRfdSends(o) {
  const out = [];
  rfdReqsOf(o).forEach(r => {
    const list = (r.shown && Array.isArray(r.shown.sends)) ? r.shown.sends : [];
    list.forEach((x, i) => out.push({
      qty: parseFloat(x.qty) || 0, date: x.date || '', at: x.at || '', seq: i, reqId: r.id, got: rfdRecvLot(r, x.at),
      unit: rfdUnit(r), what: rfdUnit(r) === 'pcs' ? (r.size || r.sku || 'pieces') : (r.fabric || 'cloth'),
    }));
  });
  /* Newest first, and the position in the list breaks a tie — two lots recorded in the same second
   * are still one after the other, and the later one is the one further down the array. */
  return out.filter(x => x.qty > 0)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || (b.seq - a.seq));
}

/** The order the printer is looking at, defaulting to the first one they can ask against. */
function vpRfdOrder() {
  const list = vpRfdOrders();
  if (!list.length) return null;
  return list.find(o => o.id === VP.rfdOrder) || list[0];
}

function vpRfdRender(matched, nag) {
  const body = $('vpBody');
  const orders = vpRfdOrders();
  const mine = vpRfdRows();
  const waiting = mine.filter(r => r.stage === 'pending');
  const okNotSent = mine.filter(r => r.stage === 'approved');
  /* Counted in each requirement's own unit and said as two figures, never added together — pieces
   * and metres make no sense as one number. */
  const m = rows => [
    rfdRound(rows.filter(r => rfdUnit(r) === 'pcs').reduce((a, r) => a + rfdWant(r), 0)),
    rfdRound(rows.filter(r => rfdUnit(r) === 'm').reduce((a, r) => a + rfdWant(r), 0)),
  ].map((v, i) => v ? nf(v) + (i ? ' m' : ' pcs') : '').filter(Boolean).join(' · ');
  /* HOW MANY ORDERS CANNOT BE STARTED. Counted on what has actually arrived, not on what has been
   * agreed — an approved requirement still sitting in the store prints nothing. */
  const shortOrders = orders.filter(o =>
    rfdFabrics(o).some(x => rfdSentFor(o, x.fabric) < rfdAllowed(o, x.fabric).need)
    || rfdPieceLines(o).some(x => rfdSentPcsFor(o, x.sku) < x.pieces)).length;

  $('vpKpis').innerHTML = `<div class="vpbar">
    <span><b>${esc(VP.name)}</b> <span class="muted">· RFD</span></span>
    <span class="sep"></span>
    <span><b>${nf(orders.length)}</b> order(s)${(n => n ? ` · <b>${nf(n)}</b> sent by the store` : '')(orders.filter(rfdTracked).length)}</span>
    ${(n => n ? `<span class="sep"></span><span class="muted">Lots to confirm</span> <span style="font-weight:700;color:#166534">${nf(n)}</span>` : '')(orders.filter(rfdTracked).reduce((a, x) => a + vpRfdSends(x).filter(l => !l.got && l.at).length, 0))}
    <span class="sep"></span>
    <span class="muted">Waiting for approval</span> <span style="color:#7f6000;font-weight:700">${nf(waiting.length)}${m(waiting) ? ' · ' + m(waiting) : ''}</span>
    <span class="sep"></span>
    <span class="muted">Agreed, not yet with you</span> <span style="font-weight:700">${nf(okNotSent.length)}${m(okNotSent) ? ' · ' + m(okNotSent) : ''}</span>
    <span class="sep"></span>
    <span class="muted">Orders still short</span> <span style="font-weight:700;color:${shortOrders ? 'var(--bad)' : '#166534'}">${nf(shortOrders)}</span>
    <span style="flex:1"></span>
    <span class="muted" style="font-size:11px">your orders only${VP.at ? ' · ' + esc(VP.at) : ''}</span>
  </div>`;

  if (!orders.length) {
    body.innerHTML = nag + '<div class="card" style="padding:34px;text-align:center;color:var(--muted)">'
      + 'Nothing to ask for yet. Cloth and cut pieces are asked for against an order — when one is '
      + 'placed with you, it shows up here.</div>';
    if ($('vpPin')) $('vpPin').onclick = pinOpenChange;
    $('vpMsg').className = 'muted'; $('vpMsg').textContent = '';
    return;
  }

  /* ---- ONE ORDER AT A TIME ----
   *
   * Six orders stacked, 113 rows on the first of them, was a screen nobody could find their way
   * through. A printer works one order at a time and this now asks which one. */
  /* The picker answers with a fallback of its own, and this keeps one anyway: a screen that
   * throws is a screen a printer cannot use, and the order list right here is a perfectly good
   * answer to "which one". */
  const o = vpRfdOrder() || orders[0];
  const pick = orders.map(x => {
    const short = rfdPieceLines(x).some(p => rfdSentPcsFor(x, p.sku) < p.pieces)
      || rfdFabrics(x).some(f => rfdSentFor(x, f.fabric) < rfdAllowed(x, f.fabric).need);
    return `<option value="${esc(x.id)}"${x.id === o.id ? ' selected' : ''}>`
      + `${esc(x.orderNo || x.id)} — ${esc(x.status || 'Placed')}${rfdTracked(x) ? ' · sent by the store' : ''}${short ? ' · short of goods' : ' · all here'}</option>`;
  }).join('');

  const pcsLines = rfdPieceLines(o);
  const fabLines = rfdFabrics(o);
  const need = rfdOrderNeed(o);

  /* THE NEW FLOW, AS THE PRINTER SEES IT (Ravi, 2026-09-27: "vendor ke page par kaise reflect hoga"). An order placed
   * from RFD_TRACK_FROM is sent by the store as it is needed — the printer asks for nothing. Their card says what is
   * coming, what reached them, what is on the way, and lists every lot waiting for their Received; their own count
   * stays. Asking is kept only for MORE than the order needs, below, and goes for approval as before. */
  const tracked = rfdTracked(o);
  let trackHtml = '';
  if (tracked) {
    const led = rfdOrderLedger(o);
    const toConfirm = vpRfdSends(o).filter(x => !x.got && x.at);
    const z = (n, u) => (n ? nf(n) + ' ' + u : '<span class="z">—</span>');
    trackHtml = (toConfirm.length ? `<div class="vr-pop-h" style="margin:4px 0 6px">Lots to confirm — press Received when they reach you</div>
      <div class="xlwrap" style="margin-bottom:12px"><table class="vrs"><thead><tr><th>Sent on</th><th>What</th><th>How much</th><th></th></tr></thead><tbody>${
        toConfirm.map(x => `<tr><td>${esc(x.date || '—')}</td><td><b>${esc(x.what)}</b></td><td style="font-weight:700;color:#166534">${nf(rfdRound(x.qty))} ${esc(x.unit)}</td>`
          + `<td><button type="button" class="jw-btn jw-primary" data-vprfd-recv="${esc(o.id)}|${esc(x.reqId)}|${esc(x.at)}" style="padding:4px 12px;font-size:12.5px">Received</button></td></tr>`).join('')
      }</tbody></table></div>` : '')
      + `<div class="xlwrap"><table class="vrs"><caption style="text-align:left;font-size:12px;color:var(--muted);padding:4px 0 6px;caption-side:top">The store sends this order as it is needed — nothing to ask for. Confirm each lot when it arrives.</caption>
        <thead><tr><th>Size / cloth</th><th>Item</th><th>On order</th><th>Sent to you</th><th>You confirmed</th><th>On the way</th><th>Still to come</th><th title="What you already have for this order — saves by itself">With you</th></tr></thead><tbody>${
        led.map(x => `<tr><td><b>${esc(x.what)}</b></td><td>${esc(x.item)}<span class="sub muted">${x.unit === 'pcs' ? 'cut pieces' : 'metres'}</span></td>`
          + `<td><b>${nf(x.need)}</b></td><td style="color:#166534">${z(x.sent, x.unit)}</td><td>${z(x.recv, x.unit)}</td>`
          + `<td style="color:#7f6000">${z(x.onWay, x.unit)}</td><td style="color:var(--bad);font-weight:700">${z(x.toSend, x.unit)}</td>`
          + `<td><input data-vprfd-stock="${esc(o.id)}|${esc(x.key)}" type="number" min="0" step="${x.unit === 'pcs' ? '1' : '0.1'}" value="${x.withYou || ''}" placeholder="0" title="What you already have for THIS order — the store sends that much less."></td></tr>`).join('')
      }</tbody></table></div>`;
  }

  /* What one press of the button would ask for, worked out before it is offered — a button that
   * says what it will do is a button somebody can trust. */
  const leftPcs = rfdRound(pcsLines.reduce((a, x) => a + rfdPcsAllowed(o, x.sku).left, 0));
  const leftM = rfdRound(fabLines.reduce((a, x) => a + rfdAllowed(o, x.fabric).left, 0));
  const leftTxt = [leftPcs ? nf(leftPcs) + ' pcs' : '', leftM ? nf(leftM) + ' m' : ''].filter(Boolean).join(' · ');

  /* ---- THE RECEIPT ----
   *
   * "jese hi rfd wala banda goods bhej de yaha bhi confirmation aa jay." Every lot the store sends,
   * with its date, at the top where it is read — not only as a figure in a column. */
  const sends = vpRfdSends(o);
  const gotTxt = u => { const t = rfdRound(sends.filter(x => x.unit === u).reduce((a, x) => a + x.qty, 0));
    return t ? nf(t) + ' ' + u : ''; };
  /* UP TOP, BESIDE THE ORDER (Ravi, 2026-09-26: "sent to you ko upar shift krdo"): a green chip that opens the lots. */
  const sentTxt = [gotTxt('pcs'), gotTxt('m')].filter(Boolean).join(' · ');
  const lotsHtml = sends.length ? `<div class="vr-pop-h">Sent to you — ${sentTxt} on ${nf(sends.length)} lot(s)</div>
    <table class="xl"><thead><tr><th>Sent on</th><th>What</th><th class="num">How much</th><th>Received</th></tr></thead><tbody>${
      sends.slice(0, 12).map(x => `<tr><td style="text-align:left">${esc(x.date) || '<span class="muted">no date</span>'}</td>`
        + `<td style="text-align:left">${esc(x.what)}</td>`
        + `<td class="num" style="font-weight:700;color:#166534">${nf(rfdRound(x.qty))} ${esc(x.unit)}</td>`
        /* CONFIRM IT ARRIVED (2026-09-26): once, per lot; the office reads it from here. */
        + `<td style="white-space:nowrap">${x.got
          ? `<span class="pill pill-ok">✓ ${nf(rfdRound(x.got.qty))} ${esc(x.unit)}</span><span class="sub muted">${esc(x.got.date || '')}</span>`
          : (x.at ? `<button class="ghost" data-vprfd-recv="${esc(o.id)}|${esc(x.reqId)}|${esc(x.at)}" style="padding:3px 10px;font-size:12px">Received</button>` : '<span class="muted">—</span>')}</td></tr>`).join('')
    }</tbody></table>
    ${sends.length > 12 ? `<div class="muted" style="font-size:12px;margin-top:6px">…and ${nf(sends.length - 12)} earlier lot(s).</div>` : ''}` : '';

  /* ---- THE SIZES ----
   *
   * FOUR COLUMNS. The three that were a dash on every row are gone: what has been asked for is said
   * under the size when there is something to say, and nowhere when there is not. */
  /* ONE ROW PER SIZE. Thirteen colours of a 60X60 tablecloth are thirteen sums to answer one
   * question, and the answer is the same cloth — the colour is printed on afterwards. */
  const sizes = rfdSizeGroups(o);
  const rowsP = sizes.map(g => {
    const got = g.sent;
    /* WHAT THEIR OWN COUNT COVERS on this order, whether or not it was typed before the ask. A count
     * typed after everything was asked for still means that much of the ask is not needed. */
    const counted = g.own ? Math.min(g.pool, g.pieces) : g.stock;
    const shortOf = rfdRound(Math.max(0, g.pieces - got - counted));
    const elsewhere = g.own ? 0 : rfdRound(Math.max(0, g.pool - g.stock));
    /* ASKED PAST WHAT IS WITH THEM: an ask raised before the count was typed still stands, and the
     * two together can be more than the order needs. Said, so it can be taken back. */
    const overAsked = rfdRound(Math.max(0, g.used + counted - g.pieces));
    const spare = g.own ? rfdRound(Math.max(0, g.pool - g.stock - overAsked)) : 0;
    const said = rfdStockRow(rfdVendorOf(o), g.stockKey, o);
    const onWay = rfdRound(Math.max(0, shortOf - g.left));
    const z = n => n ? nf(n) : '<span class="z">—</span>';
    return '<tr>'
      + `<td><b>${esc(g.size || g.key)}</b>`
      + (g.used ? `<span class="sub" style="color:#7f6000">${nf(g.used)} pcs asked for</span>` : '')
      + (overAsked ? `<span class="sub" style="color:var(--bad)" title="What you asked for and what you said is with you add up to more than this order needs.">${nf(overAsked)} pcs more than the order needs</span>` : '')
      + '</td>'
      + `<td>${esc(g.what)}<span class="sub muted">${g.colours.length ? '<span title="' + esc(g.colours.join(', ')) + '">' + nf(g.colours.length) + ' colour' + (g.colours.length > 1 ? 's' : '') + '</span>' : ''}${g.fabrics.length ? ' · ' + esc(g.fabrics.join(' / ')) : ''}</span></td>`
      + `<td><b>${nf(g.pieces)}</b></td>`
      + `<td style="color:#166534">${z(got)}</td>`
      + `<td style="color:#7f6000">${z(onWay)}</td>`
      + `<td style="color:var(--bad);font-weight:700">${z(g.left)}</td>`
      + '<td>'
      + `<input data-vprfd-stock="${esc(o.id)}|${esc(g.stockKey)}" type="number" min="0" step="1" value="${g.pool || ''}" placeholder="0"`
      + ` title="How many of these you already have for THIS order. It comes off what is left to ask for on this order.">`
      + (elsewhere ? `<span class="sub" style="color:#7f6000">${nf(elsewhere)} counted elsewhere</span>` : '')
      + (spare ? `<span class="sub" style="color:#7f6000">${nf(spare)} more than this order still needs</span>` : '')
      + (said && said.at ? `<span class="sub muted">you said, ${esc(ptIsoDate(said.at) || '')}</span>` : '')
      + '</td>'
      + vpRfdAskCell(o, g.stockKey, 'pcs', g.left) + '</tr>';
  }).join('');

  const rowsF = fabLines.map(x => {
    const cap = rfdAllowed(o, x.fabric);
    const key = rfdFabKey(x.fabric);
    const got = rfdSentFor(o, x.fabric);
    const shortOf = rfdRound(Math.max(0, cap.need - got - cap.stock));
    const pool = rfdStockOf(rfdVendorOf(o), key, o);
    const own = rfdStockOwn(o, key) > 0;
    const elsewhere = own ? 0 : rfdRound(Math.max(0, pool - cap.stock));
    const spare = own ? rfdRound(Math.max(0, pool - cap.stock)) : 0;
    const said = rfdStockRow(rfdVendorOf(o), key, o);
    const onWay = rfdRound(Math.max(0, shortOf - cap.left));
    const z = n => n ? nf(n) : '<span class="z">—</span>';
    return '<tr>'
      + `<td><b>${esc(x.fabric)}</b>${cap.used ? `<span class="sub" style="color:#7f6000">${nf(cap.used)} m asked for</span>` : ''}</td>`
      + '<td>Running cloth<span class="sub muted">metres</span></td>'
      + `<td><b>${nf(cap.need)}</b></td>`
      + `<td style="color:#166534">${z(got)}</td>`
      + `<td style="color:#7f6000">${z(onWay)}</td>`
      + `<td style="color:var(--bad);font-weight:700">${z(cap.left)}</td>`
      + '<td>'
      + `<input data-vprfd-stock="${esc(o.id)}|${esc(key)}" type="number" min="0" step="0.1" value="${pool || ''}" placeholder="0"`
      + ` title="How many metres of this you already have for THIS order. It comes off what is left to ask for on this order.">`
      + (elsewhere ? `<span class="sub" style="color:#7f6000">${nf(elsewhere)} m counted elsewhere</span>` : '')
      + (spare ? `<span class="sub" style="color:#7f6000">${nf(spare)} m more than this order still needs</span>` : '')
      + (said && said.at ? `<span class="sub muted">you said, ${esc(ptIsoDate(said.at) || '')}</span>` : '')
      + '</td>'
      + vpRfdAskCell(o, key, 'm', cap.left) + '</tr>';
  }).join('');

  /* The sheet's header: what, item, on order, sent, on the way, to ask, with you, ask for now. */
  const vrsHead = (what, cap) => `<div class="xlwrap"><table class="vrs"><caption style="text-align:left;font-size:12px;color:var(--muted);padding:4px 0 6px;caption-side:top">${cap} · up to "Still to ask for" is agreed at once, more goes for approval</caption><thead><tr>
    <th>${what}</th><th>Item</th><th>On order</th><th>Sent</th><th>On the way</th><th>Still to ask for</th><th title="What you already have for this order — saves by itself">With you</th><th title="What you need now — press Raise requirement">Ask for now</th></tr></thead><tbody>`;
  const head = (what, unit) => `<table class="xl" style="margin-bottom:10px"><thead><tr>
    <th>${what}</th><th class="num">On this order</th>
    <th class="num" title="What you already have. Type it in — it comes off what is left to ask for, here and on your later orders. Sent against this order is shown underneath.">With you</th>
    <th class="num" title="What is left to ask for, or what has been asked for and is still to arrive.">Still to ask for</th>
    <th class="num" title="Type how much you need now. Up to what is left is agreed at once; anything more goes to The Fabric Rush to approve. Press Raise requirement to send.">Ask for now</th>
  </tr></thead><tbody>`;

  const unruled = pcsLines.filter(x => !x.ruled);
  const pcsOpts = sizes.map(g => `<option value="${esc(g.stockKey)}">`
    + `${esc(g.size || g.key)} · ${esc(g.what)}${g.left > 0 ? ' — ' + nf(g.left) + ' left' : ''}</option>`).join('');
  const fabOpts = fabLines.map(x => `<option value="${esc(x.fabric)}">${esc(x.fabric)}</option>`).join('');

  /* What has been asked, and where each one has got to. Only drawn once there is something in it. */
  const asks = rfdReqsOf(o).slice().sort((x, y) => String(y.raisedAt || '').localeCompare(String(x.raisedAt || '')))
    .map(r => {
      const st = (r.shown && r.shown.stage) || (rfdAuto(r, o) ? 'approved' : 'pending');
      const lab = RFD_STAGE[st] || { label: st, pill: 'pill-low' };
      const sent = (r.shown && parseFloat(r.shown.sent)) || 0;
      return `<tr><td style="text-align:left">${esc(rfdUnit(r) === 'pcs' ? (r.size || r.sku) : r.fabric)}</td>`
        + `<td class="num">${esc(rfdQtyTxt(r))}</td>`
        + `<td><span class="pill ${lab.pill}">${esc(lab.label)}</span>`
        + (r.shown && r.shown.note ? `<div class="muted" style="font-size:10.5px">${esc(r.shown.note)}</div>` : '')
        + '</td>'
        + `<td class="num">${sent ? nf(rfdRound(sent)) + ' ' + rfdUnit(r) : '<span class="muted">&mdash;</span>'}</td>`
        + `<td>${!r.shown ? `<button class="ghost" data-vprfd-del="${esc(o.id)}|${esc(r.id)}" style="padding:3px 10px;font-size:12px">Take back</button>` : '<span class="muted">&mdash;</span>'}</td></tr>`;
    }).join('');

  /* THE COMPANY'S CLOTH ON THEIR FLOOR (2026-09-26), on the orders tracked from RFD_TRACK_FROM: what they said they
   * had, plus what they confirmed received, less what they delivered back. Drawn only once there is something in it. */
  /* ONLY WHAT HAS MOVED (Ravi, 2026-09-27, crossing out a table of zeros): nothing sent yet is not a stock to show —
   * the order's own table below already says what is coming. A row appears once cloth has been had, received, is on
   * the way or has come back printed. */
  const store = rfdStoreOf(rfdVendorOf(o), VP.rows).filter(x => x.had || x.recv || x.onWay || x.used || x.inHand);
  const storeHtml = store.length ? `<div class="xlwrap" style="margin-bottom:10px"><table class="vrs"><caption style="text-align:left;font-size:12px;color:var(--muted);padding:4px 0 6px;caption-side:top">Company cloth with you — orders from ${esc(RFD_TRACK_FROM)} · what you had + what you confirmed received − what you delivered back</caption>
    <thead><tr><th>What</th><th>Item</th><th>Orders</th><th>Had</th><th>Received</th><th>On the way</th><th>Delivered back</th><th>With you now</th></tr></thead><tbody>${
      store.map(x => `<tr><td><b>${esc(x.what)}</b></td><td>${esc(x.item || (x.unit === 'm' ? 'Running cloth' : ''))}</td><td>${nf(x.orders)}</td>`
        + `<td>${nf(x.had)}</td><td style="color:#166534">${nf(x.recv)}</td><td style="color:#7f6000">${nf(x.onWay)}</td><td>${nf(x.used)}</td>`
        + `<td style="font-weight:700${x.inHand < 0 ? ';color:var(--bad)' : ''}">${nf(x.inHand)} ${esc(x.unit)}</td></tr>`).join('')
    }</tbody></table></div>` : '';
  /* ONE DROPDOWN AT THE TOP: what was sent, then everything asked for with its stage and Take back. */
  const nAsk = rfdReqsOf(o).length;
  const receipt = (sends.length || asks) ? `<details id="vpRfdSent" class="vr-sent"${VP.rfdSentOpen ? ' open' : ''}><summary>${sends.length ? 'Sent to you — ' + sentTxt : 'Nothing sent yet'}${nAsk ? ' · ' + nf(nAsk) + ' asked' : ''}</summary>
    <div class="vr-sent-pop">${lotsHtml}${asks ? `<div class="vr-pop-h" style="margin-top:${sends.length ? 12 : 0}px">What you have asked for on ${esc(o.orderNo || o.id)} (${nf(nAsk)})</div>
      <table class="xl"><thead><tr><th>What</th><th class="num">Asked</th><th>Stage</th><th class="num">Sent to you</th><th></th></tr></thead><tbody>${asks}</tbody></table>` : ''}</div></details>` : '';
  body.innerHTML = nag
    + `<div class="card" style="padding:12px 14px;margin-top:12px">
      <div class="toolbar" style="margin-bottom:10px">
        <label for="vpRfdPick" class="lb" style="flex:0 0 auto">Change order</label>
        <select id="vpRfdPick" style="flex:0 0 380px">${pick}</select>
        <span class="pill">${esc(o.orderType === 'running' ? 'running — metres' : 'cut — pieces')}</span>
        ${voAckOf(o) ? '' : '<span class="pill pill-low" title="Acknowledge it on your Orders tab, so the store knows you have it">not acknowledged yet</span>'}
        ${receipt}
        <span style="flex:1"></span>
        ${tracked ? '<span class="pill pill-ok" title="Placed from ' + esc(RFD_TRACK_FROM) + ': the store sends what this order needs by itself.">The store sends this order</span>'
          : leftTxt
          ? `<button id="vpRfdAll" class="ghost" title="Raises a requirement for everything this order still needs, in one go. You are asked to confirm first.">Ask for the whole order (${esc(leftTxt)})…</button>`
          : '<span class="muted" style="font-size:12.5px">Everything this order needs has been asked for.</span>'}
      </div>
      ${storeHtml}
      ${tracked ? trackHtml : (rowsP ? vrsHead('Size', 'Cut pieces · pcs') + rowsP + '</tbody></table></div>' : '')}
      ${unruled.length ? `<div class="muted" style="font-size:12px;margin-bottom:8px">${nf(unruled.length)} of these have no printing rule set — ${esc(unruled.map(x => x.what || x.sku).filter((v, i, a) => a.indexOf(v) === i).join(', '))}. They are being treated as cut pieces because the order line is in pieces. Ask the office to set the rule.</div>` : ''}

      ${!tracked && rowsF ? vrsHead('Fabric', 'Running cloth · metres') + rowsF + '</tbody></table></div>' : ''}
      ${need.unknown.length ? `<div class="muted" style="font-size:12px;margin-bottom:8px">${nf(need.unknown.length)} line(s) on this order could not be worked out, so their cloth is not in the figures above. Ask the office.</div>` : ''}

      <details style="margin-top:6px">
        <summary class="muted" style="font-size:12px;cursor:pointer">${tracked ? 'Need MORE than this order? Ask for extra — it goes for approval' : 'Ask for one size or one fabric only'}</summary>
        <div class="muted" style="font-size:11.5px;margin-top:6px">A size is asked for once. It is shared out over that size's colours for you, in proportion to what each still needs.</div>
        <div style="margin-top:8px">
          ${pcsOpts ? `<div class="toolbar" style="margin-bottom:6px">
            <select data-vprfd-sku="${esc(o.id)}" style="flex:0 0 260px">${pcsOpts}</select>
            <input data-vprfd-p="${esc(o.id)}" type="number" min="0" step="1" placeholder="Pieces" style="flex:0 0 120px">
            <input data-vprfd-pn="${esc(o.id)}" placeholder="Why, if it is more than the order covers" style="flex:1 1 200px;min-width:0">
            <button class="ghost" data-vprfd-askp="${esc(o.id)}">Ask</button>
          </div>` : ''}
          ${fabOpts ? `<div class="toolbar">
            <select data-vprfd-fab="${esc(o.id)}" style="flex:0 0 190px">${fabOpts}</select>
            <input data-vprfd-m="${esc(o.id)}" type="number" min="0" step="0.1" placeholder="Metres" style="flex:0 0 130px">
            <input data-vprfd-n="${esc(o.id)}" placeholder="Why, if it is more than the order covers" style="flex:1 1 220px;min-width:0">
            <button class="ghost" data-vprfd-ask="${esc(o.id)}">Ask</button>
          </div>` : ''}
        </div>
      </details>
      ${tracked ? '' : `<div class="vrb-foot"><span id="vpRfdRaiseTxt" style="font-size:14px">${vpRfdRaiseTxt(o)}</span><span style="flex:1"></span>
        <button type="button" id="vpRfdClear" class="ghost">Clear</button>
        <button type="button" id="vpRfdRaise" title="Sends every row where you typed in Ask for now">Raise requirement</button></div>`}
    </div>`
    ;

  if ($('vpPin')) $('vpPin').onclick = pinOpenChange;
  if ($('vpRfdPick')) $('vpRfdPick').onchange = () => { VP.rfdOrder = $('vpRfdPick').value; renderVp(); };
  if ($('vpRfdRaise')) $('vpRfdRaise').onclick = () => vpRfdRaiseOpen(o);
  /* The asks list stays open across a redraw (a Take back redraws the screen) once somebody has opened it. */
  if ($('vpRfdSent')) $('vpRfdSent').addEventListener('toggle', () => { VP.rfdSentOpen = $('vpRfdSent').open; });
  if ($('vpRfdClear')) $('vpRfdClear').onclick = () => { (VP.rfdDraft || {})[o.id] = {}; renderVp(); };
  if ($('vpRfdAll')) $('vpRfdAll').onclick = () => ptOpenDialog({
    title: 'Ask for the whole of ' + (o.orderNo || o.id) + '?',
    subtitle: leftTxt + ' — every size and fabric this order still needs',
    note: 'This raises a requirement for EVERYTHING left on the order, in one go. '
      + 'If you only want to tell us what is already with you, you do not need this — those boxes save by themselves.',
    fields: [],
    saveLabel: 'Yes, ask for all of it',
    onSave: async () => {
      const r = await vpRfdAllRun(o);
      return r.err || '';
    },
  });
  async function vpRfdAllRun(o) {
    const r = await rfdSubmitOrder(o, '');
    if (r.err) { $('vpMsg').className = 'err'; $('vpMsg').textContent = r.err; return r; }
    VP.lastNote = `${nf(r.n)} requirement(s) raised on ${o.orderNo || o.id}`
      + ([r.pcs ? nf(r.pcs) + ' pcs' : '', r.mtr ? nf(r.mtr) + ' m' : ''].filter(Boolean).join(' · ')
        ? ' — ' + [r.pcs ? nf(r.pcs) + ' pcs' : '', r.mtr ? nf(r.mtr) + ' m' : ''].filter(Boolean).join(' · ') : '')
      + '. All of it is within what the order covers, so it is already agreed.';
    renderVp();
    $('vpMsg').className = 'muted'; $('vpMsg').textContent = VP.lastNote;
    return r;
  }
  $('vpMsg').className = 'muted';
  $('vpMsg').textContent = '';
  ptImgFill([], false, ptImgPatch);
}

/* ---- ASK FOR NOW: the boxes hold a draft (not saved) until Raise requirement ---- */
const vpRfdDraftOf = o => ((VP.rfdDraft = VP.rfdDraft || {})[o.id] = (VP.rfdDraft || {})[o.id] || {});
const vpRfdDrafts = o => Object.entries(vpRfdDraftOf(o)).filter(([, q]) => parseFloat(q) > 0).map(([key, qty]) => ({ key, qty }));
function vpRfdRaiseLabel(o) {
  const d = vpRfdDrafts(o);
  return d.length ? `Raise requirement (${nf(d.length)})` : 'Raise requirement';
}
function vpRfdAskCell(o, key, unit, left, asBox) {
  const v = vpRfdDraftOf(o)[key] || '';
  const over = parseFloat(v) > left ? rfdRound(parseFloat(v) - Math.max(0, left)) : 0;
  return (asBox ? '<div class="vrb-box"><span class="lb">Ask for now</span>' : '<td class="num">')
    + `<input data-vprfd-need="${esc(o.id)}|${esc(key)}" type="number" min="0" step="${unit === 'm' ? '0.1' : '1'}" value="${esc(v)}" placeholder="0"${asBox ? ' style="width:88px;text-align:right"' : ''}`
    + ` title="How much you need now. Up to ${nf(Math.max(0, left))} ${unit} is agreed at once; more goes for approval.">`
    + (over ? `<span class="sub" style="color:#7f6000">${nf(over)} over — needs approval</span>` : '')
    + (asBox ? '</div>' : '</td>');
}
/** The raise bar's words: rows, how much, and how much of it goes for approval. */
function vpRfdRaiseTxt(o) {
  const rows = vpRfdRaisePlan(o, vpRfdDrafts(o)).filter(r => !r.err);
  if (!rows.length) return '<span class="muted">Type how much you need in Ask for now, then raise it here.</span>';
  const sum = u => rfdRound(rows.filter(r => r.unit === u).reduce((t, r) => t + r.want, 0));
  const over = u => rfdRound(rows.filter(r => r.unit === u).reduce((t, r) => t + r.over, 0));
  const both = f => [f('pcs') ? nf(f('pcs')) + ' pcs' : '', f('m') ? nf(f('m')) + ' m' : ''].filter(Boolean).join(' · ');
  return `<b>${nf(rows.length)} row${rows.length === 1 ? '' : 's'} to ask</b> <span class="muted">· ${both(sum)}`
    + (both(over) ? ` · <span style="color:#7f6000;font-weight:700">${both(over)} over the order go for approval</span>` : '') + '</span>';
}
function vpRfdRaiseOpen(o) {
  const rows = vpRfdRaisePlan(o, vpRfdDrafts(o));
  if (!rows.length) { $('vpMsg').className = 'err'; $('vpMsg').textContent = 'Type how much you need in "Ask for now" on the rows you want, then press Raise requirement.'; return; }
  const anyOver = rows.some(r => r.over > 0);
  ptOpenDialog({
    title: 'Raise requirement on ' + (o.orderNo || o.id),
    subtitle: `${nf(rows.length)} row(s)`,
    note: 'What fits inside the order is agreed at once. Anything more than the order needs is sent separately and waits for The Fabric Rush to approve.',
    html: '<table class="xl"><thead><tr><th>What</th><th class="num">Asked</th><th class="num">Agreed at once</th><th class="num">Needs approval</th></tr></thead><tbody>'
      + rows.map(r => `<tr><td style="text-align:left">${esc(r.label)}${r.err ? '<div class="err" style="font-size:11px">' + esc(r.err) + '</div>' : ''}</td>`
        + `<td class="num">${r.err ? '—' : nf(r.want) + ' ' + r.unit}</td><td class="num" style="color:#166534;font-weight:700">${r.within ? nf(r.within) + ' ' + r.unit : '—'}</td>`
        + `<td class="num" style="color:#7f6000;font-weight:700">${r.over ? nf(r.over) + ' ' + r.unit : '—'}</td></tr>`).join('') + '</tbody></table>'
      + (anyOver ? '<label style="display:block;margin-top:10px">Why do you need more than the order? <b style="color:var(--bad)">*</b><input id="vpRfdWhy" placeholder="e.g. rejects in printing, extra for shrinkage"></label>' : ''),
    saveLabel: 'Raise requirement',
    onSave: async () => {
      const r = await vpRfdRaiseRun(o, vpRfdDrafts(o), ($('vpRfdWhy') || {}).value);
      if (r.err) return r.err;
      VP.rfdDraft[o.id] = {};
      renderVp();
      $('vpMsg').className = 'muted';
      $('vpMsg').textContent = `Raised on ${o.orderNo || o.id}: ${nf(r.agreed)} agreed at once${r.waiting ? ` · ${nf(r.waiting)} waiting for approval` : ''}.`;
      return '';
    },
  });
}
$('vpBody').addEventListener('input', e => {
  const need = e.target.closest && e.target.closest('[data-vprfd-need]');
  if (!need) return;
  const [oid, key] = need.getAttribute('data-vprfd-need').split('|');
  const o = (VP.rows || []).find(x => x && x.id === oid); if (!o) return;
  vpRfdDraftOf(o)[key] = String(need.value).trim();
  if ($('vpRfdRaiseTxt')) $('vpRfdRaiseTxt').innerHTML = vpRfdRaiseTxt(o);
});

/* WHAT IS ALREADY WITH YOU, saved the moment the printer tabs out of the box. A button beside every
 * size would be another thing to forget to press, and forgetting this one means the factory keeps
 * sending cloth they already have. */
$('vpBody').addEventListener('change', async e => {
  const stock = e.target.closest('[data-vprfd-stock]');
  if (!stock) return;
  const [oid, key] = stock.getAttribute('data-vprfd-stock').split('|');
  const o = (VP.rows || []).find(x => x && x.id === oid); if (!o) return;
  const err = await rfdStockSave(o, key, String(stock.value).trim());
  $('vpMsg').className = err ? 'err' : 'muted';
  $('vpMsg').textContent = err || 'Saved — nothing else to press. It comes off what is left to ask for, here and on your other orders. '
    + 'Nothing has been asked for.';
  if (!err) renderVp();
});

$('vpBody').addEventListener('click', async e => {
  const ask = e.target.closest('[data-vprfd-ask]');
  if (ask) {
    const id = ask.getAttribute('data-vprfd-ask');
    const o = (VP.rows || []).find(x => x && x.id === id); if (!o) return;
    const g = k => document.querySelector('[data-vprfd-' + k + '="' + id + '"]');
    const err = await rfdSubmit(o, (g('fab') || {}).value, (g('m') || {}).value, (g('n') || {}).value);
    if (err) { $('vpMsg').className = 'err'; $('vpMsg').textContent = err; return; }
    renderVp();
    const box = document.querySelector('[data-vprfd-m="' + id + '"]'); if (box) box.value = '';
    return;
  }
  const askp = e.target.closest('[data-vprfd-askp]');
  if (askp) {
    const id = askp.getAttribute('data-vprfd-askp');
    const o = (VP.rows || []).find(x => x && x.id === id); if (!o) return;
    const g = k => document.querySelector('[data-vprfd-' + k + '="' + id + '"]');
    const err = await rfdSubmitSize(o, (g('sku') || {}).value, (g('p') || {}).value, (g('pn') || {}).value);
    if (err) { $('vpMsg').className = 'err'; $('vpMsg').textContent = err; return; }
    renderVp();
    const box = document.querySelector('[data-vprfd-p="' + id + '"]'); if (box) box.value = '';
    return;
  }
  const rcv = e.target.closest('[data-vprfd-recv]');
  if (rcv) {
    const [oid, rid, at] = rcv.getAttribute('data-vprfd-recv').split('|');
    const o = (VP.rows || []).find(x => x && x.id === oid); if (!o) return;
    const r = (o.rfdReqs || {})[rid];
    const lot = r && ((r.shown && Array.isArray(r.shown.sends)) ? r.shown.sends : []).find(x => x && x.at === at);
    if (!lot) return;
    const u = rfdUnit(r);
    return ptOpenDialog({
      title: 'Received ' + (u === 'pcs' ? (r.size || r.sku) : r.fabric),
      subtitle: nf(rfdRound(lot.qty)) + ' ' + u + ' sent on ' + (lot.date || '—') + ' against ' + (o.orderNo || o.id),
      note: 'Say what actually arrived. Short of what was sent is fine — the store sees the difference.',
      fields: [{ key: 'qty', label: (u === 'pcs' ? 'Pieces' : 'Metres') + ' that arrived', type: 'number', min: 0, step: u === 'pcs' ? '1' : '0.1', value: rfdRound(lot.qty) },
               { key: 'date', label: 'Date it arrived', type: 'date', value: ptIsoDate(new Date().toISOString()) }],
      saveLabel: 'Confirm',
      onSave: async v => { const err = await rfdRecvSave(o, rid, at, v.qty, v.date); if (!err) renderVp(); return err; },
    });
  }
  const del = e.target.closest('[data-vprfd-del]');
  if (del) {
    const [oid, rid] = del.getAttribute('data-vprfd-del').split('|');
    const o = (VP.rows || []).find(x => x && x.id === oid); if (!o) return;
    if (!confirm('Take this requirement back?')) return;
    const err = await rfdWithdraw(o, rid);
    if (err) { $('vpMsg').className = 'err'; $('vpMsg').textContent = err; return; }
    renderVp();
  }
});

