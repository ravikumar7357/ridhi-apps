/* A QUANTITY THAT MOVED AND NOBODY ON THE FLOOR WAS TOLD.
 *
 * Ravi, straight after the first upload: "mene jese hi adjustment qty upload kiya direct change ho
 * gya production team ko pata hi nahi chala."
 *
 * He is right, and this was my miss. The change was written down — who, when, from, to, why — but it
 * was written down ON THE SALES ORDER, and nobody on the floor opens a sales order. The Order Console
 * is where work is done now, and there the number simply moved: a line that said 100 yesterday said
 * 150 today, with nothing to say it had changed, who changed it or why. That is worse than the old
 * problem it fixed. A figure that moves silently is one nobody can trust.
 *
 * SO THE CHANGE FOLLOWS THE WORK. On the Order Console line, a pill that says what it was, what it is
 * and why. A tile that counts the ones nobody has looked at yet. A red line at the top of the screen
 * while any of them is unseen, and a count on the sidebar so it does not need the tab open to be
 * noticed.
 *
 * AND SOMEBODY HAS TO SAY THEY SAW IT. "Seen" stamps the adjustment with who and when — on the
 * adjustment itself, where the person who made the change reads it, so the loop closes at both ends.
 * A tile that clears itself after a week is a tile nobody reads; one that clears when a person says
 * so is a message that arrived.
 *
 * Nothing here can change a quantity. It only carries the news.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. the changes, indexed by the line they happened to ---- */
one(`/* ================= WHAT THE VENDORS HOLD, ORDER BY ORDER =================`,
`/* ================= A QUANTITY THAT MOVED, CARRIED TO THE PEOPLE MAKING IT =================
 *
 * The record lives on the sales order because that is where the decision was taken. Nobody on the
 * floor opens a sales order, so it is indexed here by the line it happened to and shown where the
 * work is.
 */
let ORD_ADJ_IX = { src: null, n: -1, map: null };
function ordQtyAdjIndex() {
  const src = SOX.rows || [];
  if (ORD_ADJ_IX.map && ORD_ADJ_IX.src === src && ORD_ADJ_IX.n === src.length) return ORD_ADJ_IX.map;
  const map = new Map();
  src.forEach(o => {
    if (!o) return;
    Object.values(o.qtyAdjustments || {}).forEach(a => {
      if (!a || !a.sku) return;
      const k = obKeyOf(o._id, a.sku);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(Object.assign({ orderNo: o._id }, a));
    });
  });
  /* Newest first — the last thing that happened to a line is the thing somebody needs to read. */
  map.forEach(l => l.sort((x, y) => String(y.at || '').localeCompare(String(x.at || ''))));
  ORD_ADJ_IX = { src, n: src.length, map };
  return map;
}
const ordQtyAdj = (orderNo, sku) => ordQtyAdjIndex().get(obKeyOf(orderNo, sku)) || [];
/** The ones nobody on the floor has said they have seen. */
const ordQtyUnseen = (orderNo, sku) => ordQtyAdj(orderNo, sku).filter(a => !a.seenAt);
/** Every unseen change across the whole book, newest first — what the banner counts. */
const ordQtyUnseenAll = () => {
  const out = [];
  ordQtyAdjIndex().forEach(l => l.forEach(a => { if (!a.seenAt) out.push(a); }));
  return out.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')));
};

/**
 * SOMEBODY ON THE FLOOR SAYS THEY HAVE SEEN IT.
 *
 * Stamped onto the adjustment itself, where whoever changed the quantity reads it back — a message
 * that is delivered and a message that is read are different things, and the person who changed a
 * figure needs to know which one this was.
 */
async function ordQtySeen(orderNo, logId) {
  const o = (SOX.rows || []).find(x => x && obUC(x._id) === obUC(orderNo));
  if (!o) return 'That order is gone.';
  const a = (o.qtyAdjustments || {})[logId];
  if (!a) return 'That change is gone.';
  if (a.seenAt) return '';
  const now = new Date().toISOString();
  const base = 'pt_salesOrders/' + o._id + '/qtyAdjustments/' + logId + '/';
  try { await ptPatch({ [base + 'seenAt']: now, [base + 'seenBy']: ME.email }); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  const adj = Object.assign({}, o.qtyAdjustments);
  adj[logId] = Object.assign({}, a, { seenAt: now, seenBy: ME.email });
  SOX.rows = (SOX.rows || []).map(x => (x._id === o._id ? Object.assign({}, x, { qtyAdjustments: adj }) : x));
  ORD_ADJ_IX = { src: null, n: -1, map: null };
  ordQtyBadge();
  return '';
}

/** The count on the sidebar, so it does not need the tab open to be noticed. */
function ordQtyBadge() {
  const el = $('ordAdjBadge'); if (!el) return;
  const n = ordQtyUnseenAll().length;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hide', !n);
}

/** How one change reads on a line: "was 100, now 150". */
const ordQtyPill = a => nf(a.from) + ' → ' + nf(a.to);

/* ================= WHAT THE VENDORS HOLD, ORDER BY ORDER =================`, 'the changes, indexed by line');

/* ---- 2. the sales orders are read by the Order Console ---- */
one(`  await odrLoad();
  ORD.busy = false; ORD.at = ptStamp();
  renderOrd();
}`,
`  await odrLoad();
  /* THE QUANTITY CHANGES, which live on the sales orders. A failed read leaves the pills off rather
   * than stopping the screen — but it is the one thing here that is news, so it says so. */
  if (SOX.rows === null) {
    try { SOX.rows = ptList(await ptGet('pt_salesOrders')); }
    catch (e) { SOX.rows = []; ORD.adjErr = e.message || String(e); }
  }
  ORD.busy = false; ORD.at = ptStamp();
  ordQtyBadge();
  renderOrd();
}`, 'the console reads them');

/* ---- 3. the sidebar count ---- */
one(`      <button id="tabOrd" class="nav">Order Console</button>`,
`      <button id="tabOrd" class="nav">Order Console <span id="ordAdjBadge" class="navbadge hide" title="Quantities changed on an order that nobody here has said they have seen" style="background:#b45309"></span></button>`, 'the sidebar count');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
