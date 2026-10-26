/* =====================================================================================
 * THE JOURNEY — one file, used by the backend (require) and by the page (<script>, as window.J).
 *
 * Every order is split into PARTS. A part walks one road:
 *     PRODUCTION  →  SHIPMENT  →  CARRIER (Amazon MCF / DHL / FedEx / UPS)  →  DELIVERED
 * Its progress is ONE number, `pos` = how many of its steps are done. Everything shown about a
 * part — bars, labels, the one button, the timeline — is worked out from `pos` and these rules,
 * so the screen and the server can never disagree about where a part is.
 * ===================================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.J = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DAY = 86400000;
  const PHASES = ['Production', 'Shipment', 'Carrier', 'Delivered'];
  /* Production: the request waits until the factory starts it, then Cut, Print, Press, Quality check. */
  const STAGES = ['Requested', 'Cut', 'Print', 'Press', 'Quality check'];
  const STAGE_BTN = ['Start', 'Cut done', 'Print done', 'Press done', 'QC passed'];
  const TARGET = [1, 1, 2, 1, 1];                       // days each stage should take
  const CAUSES = ['Waiting for fabric', 'No karigar free', 'Printer busy', 'Dye or colour issue', 'QC rework', 'Other'];
  const RSTEPS = ['Return started', 'On its way back', 'Received at USA warehouse', 'Closed'];
  const CARRIERS = ['DHL Express', 'FedEx', 'UPS'];

  const isMcf = pk => pk.route === 'mcf';
  const prodLen = pk => pk.src === 'make' ? STAGES.length : 1;
  const total = pk => prodLen(pk) + 6;
  /* steps after production: 0 ready · 1 sent/packed · 2 accepted/label · 3 shipped/picked up · 4 in transit · 5 out · 6 delivered */
  const off = pk => pk.pos - prodLen(pk);
  const carName = pk => isMcf(pk) ? 'Amazon MCF' : (pk.car || 'carrier');

  function steps(pk) {
    const prod = pk.src === 'make' ? ['Production requested', 'Cut', 'Print', 'Press', 'Quality check'] : [pk.src === 'fba' ? 'In Amazon FBA stock' : pk.src === 'shop' ? 'Shipped from Shopify' : 'In India stock'];
    const ship = isMcf(pk) ? ['Sent to Amazon MCF', 'Amazon accepted'] : pk.route ? ['Packed', 'Label created'] : ['Packed', 'Booked with a carrier'];
    const carrier = isMcf(pk) ? ['Shipped by Amazon', 'In transit'] : ['Picked up by ' + (pk.car || 'the carrier'), 'In transit'];
    return [prod, ship, carrier, ['Out for delivery', 'Delivered']];
  }
  /* which phase is happening now: 0..3, or 4 when delivered */
  function phaseOf(pk) { if (pk.pos < prodLen(pk)) return 0; const o = off(pk); return o <= 2 ? 1 : o <= 4 ? 2 : o === 5 ? 3 : 4; }
  const stageStart = pk => pk.pos ? pk.ts[pk.pos - 1] : pk.req;
  const inStage = (pk, now) => (now - stageStart(pk)) / DAY;
  const isLateStage = (pk, now) => pk.src === 'make' && pk.pos < prodLen(pk) && inStage(pk, now) > TARGET[pk.pos];

  function statusOf(pk) {
    if (pk.pos < prodLen(pk)) return pk.block ? 'Blocked · ' + pk.block.why : pk.pos === 0 ? 'Waiting to start' : 'In ' + STAGES[pk.pos];
    return ['Ready to ship', isMcf(pk) ? 'Sent to Amazon' : 'Packed', isMcf(pk) ? 'Amazon accepted' : 'Waiting for pickup',
      isMcf(pk) ? 'Shipped by Amazon' : 'Picked up', pk.late ? 'Delayed' : 'In transit', 'Out for delivery', 'Delivered'][off(pk)];
  }
  /* The one thing a person does now. Null = it moves by itself (Amazon / carrier updates). */
  function actionOf(pk) {
    if (pk.pos < prodLen(pk)) return { k: 'stage', t: pk.pos === 0 ? 'Start production' : 'Finish ' + STAGES[pk.pos],
      sub: pk.pos === 0 ? 'The factory has the request; start when work begins' : 'Next: ' + (STAGES[pk.pos + 1] || 'ready to ship'), b: STAGE_BTN[pk.pos] };
    if (off(pk) === 0) return { k: 'ship', t: 'Ship this part', sub: 'Choose DHL, FedEx or UPS and add the tracking number', b: 'Ship…' };
    return null;
  }
  function phaseText(pk, i) {
    const ph = phaseOf(pk);
    if (i === 0) return pk.src !== 'make' ? (pk.src === 'fba' ? 'From FBA stock' : pk.src === 'shop' ? 'Shipped in Shopify' : 'From India stock') : ph === 0 ? (pk.block ? pk.block.why : pk.pos === 0 ? 'Requested' : STAGES[pk.pos] + ' · ' + pk.pos + ' of 4') : 'Made';
    if (i === 1) return ph < 1 ? 'After production' : ph === 1 ? statusOf(pk) : isMcf(pk) ? 'Sent by MCF' : 'Packed';
    if (i === 2) return ph < 2 ? (pk.route ? carName(pk) : 'MCF, DHL or FedEx') : ph === 2 ? statusOf(pk) + ' · ' + carName(pk) : carName(pk);
    return ph === 4 ? null : pk.eta ? 'Expected ' + pk.eta : '—';      // null = "delivered on <date>", which the caller formats
  }
  /* Where a carrier status puts a part (`off` value). */
  const STATUS_OFF = { label_created: 2, picked_up: 3, in_transit: 4, delayed: 4, out_for_delivery: 5, delivered: 6 };
  /* The Shopify delivery status each step sends. */
  const SHOPIFY_EVENT = { 4: 'IN_TRANSIT', 5: 'OUT_FOR_DELIVERY', 6: 'DELIVERED' };

  function retAction(r) {
    if (r.what !== 'return' && r.rep == null) return { k: 'rep', b: 'Send replacement', t: 'Send the replacement' };
    if (r.what === 'replace') return r.pos < 3 ? { k: 'rclose', b: 'Close', t: 'Close the case' } : null;
    if (r.pos === 0) return { k: 'rtrk', b: 'Add return tracking', t: 'Add the return tracking number' };
    if (r.pos === 1) return { k: 'rrecv', b: 'Mark received', t: 'Mark it received at the warehouse' };
    if (r.pos === 2) return { k: 'rclose', b: 'Close', t: 'Close the return' };
    return null;
  }
  /* SEND QUANTITY (as the ERP's send qty): how many of a line go out — the ordered quantity unless a person set it
   * lower; 0 = this line is not being sent. A line not being sent is not waiting for a decision either. */
  const sendQty = it => it.sq == null ? it.q : Math.max(0, Math.min(it.q, Number(it.sq) || 0));
  const undecided = o => o.items.map((it, i) => i).filter(i => o.items[i].pk == null && sendQty(o.items[i]) > 0);

  /* STOCK SHARED OUT, OLDEST ORDER FIRST (as the ERP's soAllocIndia, for FBA too): two orders can never both be
   * promised the same 3 quilts. Per SKU, the stock (the Stock list, else the line's own figure) goes first to India
   * items already picked and not yet shipped, then to the waiting lines of the oldest order, then the next. A waiting
   * line takes from FBA when FBA covers its send quantity (MCF comes first), else from India when India covers it; a
   * line marked out of stock takes nothing. Returns { orderNo: { line: { need, fba, india, fbaHeld, indiaHeld, takes } } }
   * — fba / india = what is left for THAT line, *Held = what older orders already hold. A suggestion, as in the ERP. */
  function allocate(orders, stock) {
    const left = { fba: {}, india: {} }, out = {};
    const level = (kind, it) => { const s = (stock || []).find(x => x.sku === it.sku); return s && s[kind] != null ? Number(s[kind]) || 0 : Number(it[kind]) || 0; };
    const pool = (kind, it) => { if (!it.sku) return null; if (left[kind][it.sku] == null) left[kind][it.sku] = level(kind, it); return left[kind]; };
    const list = orders.filter(o => !o.cancelled).slice().sort((a, b) => (a.at - b.at) || String(a.no).localeCompare(String(b.no)));
    list.forEach(o => o.pkgs.forEach(pk => {
      if (pk.src !== 'india' || pk.route) return;
      pk.items.forEach(i => { const it = o.items[i], p = pool('india', it); if (p) p[it.sku] -= sendQty(it); });
    }));
    list.forEach(o => {
      const mine = out[o.no] = {};
      o.items.forEach((it, i) => {
        if (it.pk != null) return;
        const need = sendQty(it), pf = pool('fba', it), pi = pool('india', it);
        const fba = pf ? Math.max(0, pf[it.sku]) : Number(it.fba) || 0, india = pi ? Math.max(0, pi[it.sku]) : Number(it.india) || 0;
        const a = mine[i] = { need, fba, india, fbaHeld: Math.max(0, level('fba', it) - fba), indiaHeld: Math.max(0, level('india', it) - india), takes: '' };
        if (!need) { a.takes = 'skip'; return; }
        if (it.oos) { a.takes = 'make'; return; }
        if (fba >= need) { a.takes = 'mcf'; if (pf) pf[it.sku] -= need; }
        else if (india >= need) { a.takes = 'india'; if (pi) pi[it.sku] -= need; }
        else a.takes = 'make';
      });
    });
    return out;
  }

  /* A parcel that needs a person, read from its last scan. 72 h without a scan, not 48: India → US parcels
   * often go two or three days quiet between flights, weekends and customs. */
  const FLAGS = { late: 'Delayed', customs: 'Held at customs', returned: 'Returning to sender', failed: 'Delivery failed', stale: 'No scan for 3 days' };
  function flagOf(pk, now) {
    const x = off(pk); if (pk.pos < prodLen(pk) || x < 3 || x >= 6) return '';
    const t = String((pk.last || {}).text || '');
    if (/return(ed|ing)? to (sender|shipper)|\bRTS\b/i.test(t)) return 'returned';
    if (/customs|clearance|held by/i.test(t)) return 'customs';
    if (/fail|unable to deliver|exception|refused|undeliverable/i.test(t)) return 'failed';
    if (pk.late) return 'late';
    const lastAt = (pk.last && pk.last.at) || pk.ts[pk.pos - 1];
    if (lastAt && now - lastAt > 3 * DAY) return 'stale';
    return '';
  }

  return { DAY, PHASES, STAGES, STAGE_BTN, TARGET, CAUSES, RSTEPS, CARRIERS, STATUS_OFF, SHOPIFY_EVENT, FLAGS,
    isMcf, prodLen, total, off, carName, steps, phaseOf, stageStart, inStage, isLateStage, statusOf, actionOf, phaseText, retAction, undecided, flagOf, sendQty, allocate };
});
