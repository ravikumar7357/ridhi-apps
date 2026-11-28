/* PACK CORE + pack helpers, from scanner-live/scan-to-pack.js. Replaces src/app/replenishment/pack-core.js. */
// Scan to pack — from the live site (fabricrush-replenish.web.app, deployed 16 Oct 2026 08:16 GMT), lines 9116–9905 of its page; the screen (PKS) improved 16 Oct, see its header below.
// PACK_CORE, the pack helpers and the PKS scanner screen. Edit this file; app-stubs.js stands in for the rest of the app.
const PACK_CORE = /* @__PURE__ */ (() => {
  const up = (s) => String(s == null ? "" : s).trim().toUpperCase();
  const num = (v) => {
    const n = Number(v);
    return isFinite(n) ? n : 0;
  };
  function lines(orderLines, packed) {
    const bySku = /* @__PURE__ */ new Map();
    (orderLines || []).forEach((o) => {
      const sku = up(o && o.sku);
      if (!sku || !o.orderNo) return;
      const got = num(((packed || {})[sku] || {})[o.orderNo]);
      const qty = num(o.qty), store = num(o.store);
      const l = { orderNo: o.orderNo, qty, store, got, left: Math.max(0, Math.min(qty, store) - got), plan: !!o.plan };
      if (!bySku.has(sku)) bySku.set(sku, []);
      bySku.get(sku).push(l);
    });
    return bySku;
  }
  function apply(hit, orderLines, packed, n) {
    const want = Math.max(1, Math.floor(num(n)) || 1);
    if (!hit || !hit.sku) return { kind: "unknown", taken: 0, parts: [] };
    const sku = up(hit.sku);
    const ls = lines(orderLines, packed).get(sku);
    if (!ls) return { kind: "wrong", sku, taken: 0, parts: [] };
    let left = want;
    const parts = [];
    for (const l of ls) {
      if (left <= 0) break;
      const q = Math.min(left, l.left);
      if (q <= 0) continue;
      parts.push({ orderNo: l.orderNo, qty: q });
      left -= q;
    }
    if (!parts.length) {
      const capped = ls.some((l) => l.qty - l.got > 0 && l.store - l.got <= 0);
      return { kind: "full", sku, why: capped ? "store" : "order", taken: 0, parts: [] };
    }
    packed[sku] = packed[sku] || {};
    parts.forEach((p) => {
      packed[sku][p.orderNo] = num(packed[sku][p.orderNo]) + p.qty;
    });
    const taken = want - left;
    const after = lines(orderLines, packed).get(sku) || [];
    return { kind: taken < want ? "short" : "good", sku, taken, parts, orderNo: parts[0].orderNo, left: after.reduce((s, l) => s + l.left, 0) };
  }
  function untake(packed, sku, parts) {
    const k = up(sku), m = packed && packed[k];
    if (!m) return;
    (parts || []).forEach((p) => {
      m[p.orderNo] = Math.max(0, num(m[p.orderNo]) - num(p.qty));
      if (!m[p.orderNo]) delete m[p.orderNo];
    });
    if (!Object.keys(m).length) delete packed[k];
  }
  function leftBySku(orderLines, packed) {
    return [...lines(orderLines, packed).entries()].map(([sku, ls]) => ({
      sku,
      qty: ls.reduce((s, l) => s + l.qty, 0),
      got: ls.reduce((s, l) => s + l.got, 0),
      left: ls.reduce((s, l) => s + l.left, 0)
    })).sort((a, b) => (b.left > 0) - (a.left > 0) || a.sku.localeCompare(b.sku));
  }
  const boxQty = (box) => (box && box.items || []).reduce((s, it) => s + num(it.qty), 0);
  const itemOf = (box, sku) => (box && box.items || []).find((it) => up(it.sku) === up(sku)) || null;
  function addToBox(box, sku, n, info) {
    const k = up(sku);
    let it = itemOf(box, k);
    if (!it) {
      const i = info || {};
      it = { sku: k, desc: i.desc || k, size: i.size || "", material: i.material || "100% COTTON", qty: 0, perPcsWt: num(i.perPcsWt) };
      box.items = (box.items || []).concat([it]);
    }
    it.qty = num(it.qty) + num(n);
    return it;
  }
  function takeFromBox(box, sku, n) {
    const it = itemOf(box, sku);
    if (!it) return -1;
    it.qty = num(it.qty) - num(n);
    if (it.qty <= 0) {
      box.items = box.items.filter((x) => x !== it);
      return 0;
    }
    return it.qty;
  }
  function weightOf(sku, wtMaster, meta, all) {
    const k = up(sku), typed = num((wtMaster || {})[k]);
    if (typed > 0) return { wt: typed, approx: false, how: "master" };
    const me = (meta || {})[k] || {};
    const pool = (same) => {
      const ws = (all || []).filter((s) => s !== k && num(wtMaster[s]) > 0 && same(meta[s] || {})).map((s) => num(wtMaster[s]));
      return ws.length ? ws.reduce((a, b) => a + b, 0) / ws.length : 0;
    };
    let w = me.subcat && me.size ? pool((m) => m.subcat === me.subcat && m.size === me.size) : 0;
    if (w) return { wt: Math.round(w * 1e3) / 1e3, approx: true, how: "same sub-category and size" };
    w = me.subcat ? pool((m) => m.subcat === me.subcat) : 0;
    if (w) return { wt: Math.round(w * 1e3) / 1e3, approx: true, how: "same sub-category" };
    return { wt: 0, approx: true, how: "no figure anywhere" };
  }
  function boxWeights(box, wtOf, pkgWt, volDiv) {
    const net = (box && box.items || []).reduce((s, it) => s + num(it.qty) * (wtOf ? num(wtOf(it.sku)) : num(it.perPcsWt)), 0);
    const g = box && box.grossWtOverride;
    const gross = g !== "" && g != null && num(g) > 0 ? num(g) : net + num(pkgWt);
    const L = num(box && box.L), W = num(box && box.W), H = num(box && box.H);
    return { net, gross, vol: L * W * H / (num(volDiv) || 5e3), cbm: L * W * H / 1e6 };
  }
  function planParse(text) {
    const rows = String(text || "").split(/\r?\n/).map((l) => l.split(/\t|,/).map((c) => c.trim().replace(/^"|"$/g, ""))).filter((r) => r.some(Boolean));
    if (!rows.length) return { lines: [], why: "Nothing pasted." };
    const head = rows[0].map((h) => h.toLowerCase());
    const si = head.findIndex((h) => /^(merchant[- ]?sku|seller[- ]?sku|sku|msku)$/.test(h));
    const qi = head.findIndex((h) => /^(quantity|qty|expected quantity|units|shipped|quantity to ship)$/.test(h));
    if (si < 0 || qi < 0) return { lines: [], why: "Could not find a SKU column and a Quantity column in the first row." };
    /* part pieces were cut down to whole ones without a word (28 Nov): the paste is refused instead */
    const part = rows.slice(1).map((r) => r[qi]).find((q) => String(q || "").trim() && !Number.isInteger(Number(q)) && isFinite(Number(q)));
    if (part) return { lines: [], part, why: part + " cannot be saved: quantities must be whole pieces. Correct the pasted plan." };
    const byS = /* @__PURE__ */ new Map();
    rows.slice(1).forEach((r) => {
      const s = up(r[si]), q = parseInt(r[qi], 10) || 0;
      if (s && q > 0) byS.set(s, (byS.get(s) || 0) + q);
    });
    const lines2 = [...byS.entries()].map(([sku, qty]) => ({ sku, qty }));
    return { lines: lines2, why: lines2.length ? "" : "No row carried a SKU and a quantity." };
  }
  function ledgerRows(p, o) {
    const sc = p && p.scan || {}, packed = sc.packed || {}, planNo = sc.planNo || "";
    const bySku = /* @__PURE__ */ new Map();
    (p.boxes || []).forEach((b) => (b.items || []).forEach((it) => {
      const sku = up(it.sku), q = num(it.qty);
      if (!sku || q <= 0) return;
      const r = bySku.get(sku) || { sku, qty: 0, boxes: [] };
      r.qty += q;
      r.boxes.push({ n: num(b.n), qty: q });
      bySku.set(sku, r);
    }));
    const m = String(p.date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const date = m ? `${m[3]}/${m[2]}/${m[1]}` : p.date || "";
    return [...bySku.values()].map((r) => {
      const parts = /* @__PURE__ */ new Map();
      Object.entries(packed[r.sku] || {}).forEach(([no, q]) => {
        if (no && no !== planNo && num(q) > 0) parts.set(no, num(q));
      });
      const onOrders = [...parts.values()].reduce((s, q) => s + q, 0);
      const rest = r.qty - onOrders;
      if (rest > 0 && o.allot) {
        const al = o.allot(r.sku, rest, new Map(parts)) || {};
        (al.orders || []).forEach((x) => {
          if (x && x.orderNo && num(x.qty) > 0) parts.set(x.orderNo, (parts.get(x.orderNo) || 0) + num(x.qty));
        });
      }
      const orders = [...parts.entries()].map(([orderNo, qty]) => ({ orderNo, qty }));
      return Object.assign(
        { _id: o.newId(r.sku), txnType: "FBA", sku: r.sku, qty: r.qty, date, reason: "", scanned: true },
        orders.length ? { orders } : {},
        { issuedFor: p.account || "" },
        o.handoverTo || sc.handoverTo ? { handoverTo: o.handoverTo || sc.handoverTo } : {},
        {
          packId: p.id,
          boxes: r.boxes,
          remarks: "scanned · pack " + p.id + (planNo ? " · plan " + planNo : ""),
          createdAt: o.nowIso,
          createdBy: o.by || ""
        }
      );
    });
  }
  return { lines, apply, untake, leftBySku, boxQty, itemOf, addToBox, takeFromBox, weightOf, boxWeights, planParse, ledgerRows };
})();
if (typeof module !== "undefined" && module.exports) module.exports = PACK_CORE;
const packGuarded = (p) => !!(p && p.scan && ((p.scan.orders || []).length || (p.scan.plan || []).length));
function packScanNew(orders, plan, planNo, handoverTo) {
  return {
    orders: (orders || []).map(obUC).filter(Boolean),
    plan: plan || [],
    planNo: planNo || "",
    handoverTo: handoverTo || "",
    packed: {},
    wrong: [],
    ledgerIds: [],
    done: false
  };
}
/* ---- packing an FBA list (28 Nov, fba-lists.js; switch fbaList) ----
 * With the switch on, packing never takes stock out: it is saved on an FBA list and the pieces leave on FBA Dispatch.
 * One packing list per FBA list, found by its id, so two PCs opening the same list carry on in the same one. A list that
 * cannot be read or a packing that cannot be saved is said to the packer; nothing is written then. */
const packFbaOn = () => typeof fblOn === "function" && fblOn();
const PACK_NO_FBA_LIST = "FBA lists are on: stock leaves only through an FBA list. Nothing leaves stock from this packing list — start a new one and choose the FBA list.";
const packFbaIdOf = (listId) => "PK-" + listId;
const packFbaPackable = (list) => !!list && ["open", "packed"].includes(list.status);
/** False only for the packing list of an FBA list that has since been shipped or cancelled. */
const packFbaStillOpen = (p) => !(packFbaOn() && p.scan && p.scan.fbaListId) || packFbaPackable(fblLists()[p.scan.fbaListId]);
/* The database lets only these accounts save a packing list (Sellora's rules, canPack), so packing is not offered to others. */
const packFbaMayPack = () => !!(ME.admin || ME.repl || ME.fgiEdit || ME.fgiEntry);
const PACK_NO_RIGHT = "This account cannot save packing lists, so it cannot pack: ask an admin to give you the Packing List tab.";
/** Why this person cannot pack an FBA list here, or "". */
const packFbaBlocked = () => fblBlocked() || (packFbaMayPack() ? "" : PACK_NO_RIGHT);
/** Before a packing list is saved or deleted: an FBA list packed from other boxes than these is no longer packed. Throws. */
async function packFbaKeepInStep(p) {
  if (packFbaOn() && p.scan && p.scan.fbaListId) await fblBoxesChanged(p.scan.fbaListId, packBoxTotals(p));
}
/** What the boxes hold, as the scanner's packed count of an FBA list, so boxes changed on the Packing List tab count too. */
function packFbaPackedOf(p, listId) {
  const out = {};
  Object.entries(packBoxTotals(p)).forEach(([sku, n]) => { out[sku] = { [listId]: n }; });
  return out;
}
/** Read the FBA lists as they are now: "" or why not. */
async function packFbaListsRead() {
  try {
    fblKeepAll(await ptGetFresh(FBL_PATH) || {});
    return "";
  } catch (e) {
    return "The FBA lists could not be read (" + (e.message || e) + "). Check the connection and open this again.";
  }
}
/** The FBA lists that can be packed, as drop-down options. */
function packFbaOptions() {
  return '<option value="">— choose an FBA list —</option>' + Object.entries(fblLists()).filter(([, l]) => packFbaPackable(l)).map(([id, l]) => {
    const lines = Object.values(l.lines || {}), pcs = lines.reduce((s, x) => s + fgiNum(x.qty), 0);
    const label = [fblvTitle(l), "made " + ptDayWords(l.at), lines.length + " SKU(s)", nf(pcs) + " pcs", l.status].join(" · ");
    return `<option value="${esc(id)}">${esc(label)}</option>`;
  }).join("");
}
/** The packing list of an FBA list, holding the list's SKUs and pieces as they are now: { p } or { err }.
 * head: { title, invoice, handoverTo }, used when it is made. */
async function packFbaSession(listId, head) {
  const blocked = packFbaBlocked();
  if (blocked) return { err: blocked };
  try {
    const { open } = await fblReadOne(listId);
    if (!packFbaPackable(open)) return { err: "This FBA list is no longer open for packing — press Refresh." };
    const id = packFbaIdOf(listId), had = await getDoc(doc(db, "packlist", id));
    const lines = Object.values(open.lines).map((l) => ({ sku: l.sku, qty: l.qty }));
    if (had.exists()) {
      const saved = Object.assign({ id }, had.data());
      const scan = Object.assign({}, saved.scan, { plan: lines, packed: packFbaPackedOf(saved, listId) });
      const p = Object.assign({}, saved, { account: open.account, scan });
      PK = [p].concat(PK.filter((x) => x.id !== id));
      return { p };
    }
    const p = {
      id,
      date: pkToday(),
      invoice: head.invoice || "",
      title: head.title || "Scan " + pkToday() + (head.invoice ? " · " + head.invoice : ""),
      account: open.account,
      status: "progress",
      pkgWt: PK_DEF.pkgWt,
      volDiv: PK_DEF.volDiv,
      boxes: [],
      by: ME.email || "",
      src: "scan",
      scan: Object.assign(packScanNew([], lines, listId, head.handoverTo || ""), { fbaListId: listId })
    };
    await savePkOne(p);
    return { p };
  } catch (e) {
    return { err: "Could not open the packing list of this FBA list: " + (e.message || e) + " — try again." };
  }
}
/** The pieces in the boxes, per SKU. */
function packBoxTotals(p) {
  const out = {};
  (p.boxes || []).forEach((b) => (b.items || []).forEach((it) => {
    const sku = obUC(it.sku), q = Number(it.qty) || 0;
    if (sku && q > 0) out[sku] = (out[sku] || 0) + q;
  }));
  return out;
}
/** Finish, with FBA lists on: what is in the boxes is saved on the list. No stock moves, so it is safe to do again. */
async function packFbaFinish(p, handoverTo) {
  const listId = p.scan.fbaListId;
  if (!listId) return { err: PACK_NO_FBA_LIST };
  const packed = packBoxTotals(p);
  if (!Object.keys(packed).length) return { err: "Nothing packed yet — scan at least one piece." };
  const why = await fblPackSave(listId, p.id, packed);
  if (why) return { err: why };
  if (handoverTo != null) p.scan.handoverTo = String(handoverTo || "").trim();
  p.scan.done = true;
  p.scan.doneAt = (/* @__PURE__ */ new Date()).toISOString();
  p.scan.doneBy = ME.email || "";
  return { rows: [], fbaList: true };
}
function packOrderLines(scan) {
  const out = [];
  if (!scan) return out;
  /* the pieces of an FBA list are already kept for it: the list's quantity is what may be packed */
  if (scan.fbaListId) return (scan.plan || []).map((l) => ({ sku: obUC(l.sku), orderNo: scan.planNo, qty: l.qty, store: l.qty, plan: true }));
  (scan.plan || []).forEach((l) => out.push({ sku: obUC(l.sku), orderNo: scan.planNo, qty: l.qty, store: fgiOf(l.sku).current, plan: true }));
  const want = new Set((scan.orders || []).map(obUC).filter(Boolean));
  if (want.size) {
    const seen = /* @__PURE__ */ new Set();
    ordLines().forEach((l) => {
      if (!want.has(l.orderNo) || seen.has(l.orderNo + "|" + l.sku)) return;
      seen.add(l.orderNo + "|" + l.sku);
      const c = fgiOutOrders(l.sku, "FBA").find((x) => x.orderNo === l.orderNo);
      out.push({ sku: l.sku, orderNo: l.orderNo, qty: l.qty, store: c ? c.store : 0 });
    });
  }
  /* Pieces held for website orders are not there to pack for FBA, so the scanner says so at scan time. */
  if (typeof shpHoldOn === "function" && shpHoldOn()) return fgiHoldCap(out);
  return out;
}
async function packDataReady() {
  try {
    if (FGI.rows === null) await fgiLoad();
  } catch (e) {
    return e.message || String(e);
  }
  if (FGI.err && !(FGI.rows || []).length) return FGI.err;
  if (typeof shpHoldOn === "function" && shpHoldOn()) await fgiHoldReread();   // unread: said in the console there, and the save reads it again
  return "";
}
const packOrdersUnknown = (orders) => (orders || []).map(obUC).filter(Boolean).filter((o) => !fgiOrderKnown(o));
function packWtOf(sku) {
  const all = Object.keys(PK_WT || {}), meta = {};
  all.concat([obUC(sku)]).forEach((s) => {
    const m = typeof mdbOf === "function" ? mdbOf(s) : null;
    meta[s] = { subcat: m ? String(m.subcat || "").trim() : "", size: m ? String(m.size || "").trim() : "" };
  });
  return PACK_CORE.weightOf(sku, PK_WT || {}, meta, all);
}
function packMarkDone(p, ids) {
  p.scan.ledgerIds = ids;
  p.scan.done = true;
  p.scan.doneAt = (/* @__PURE__ */ new Date()).toISOString();
  p.scan.doneBy = ME.email || "";
}
/* ONE ROW PER LIST AND SKU (28 Nov): the same list finished on two screens wrote the stock out twice. The row's name is made
 * from the list and the SKU, so a later Finish meets the first one's rows. Two presses at the very same moment still land on
 * one row each, but the later one's figures stay and a website-order release may be used twice. Errors: loud: nothing is
 * written when the rows or the saved list cannot be read, or when another screen finished the list. */
const packRowId = (packId, sku) => "FBA-" + packId + "-" + shpHoldKey(sku);
/** { done } when exactly these rows are written already (the list only has to be marked finished), { err }, or {} to write. */
async function packWrittenBefore(rows) {
  let was;
  try { was = await Promise.all(rows.map((r) => ptGet("pt_fgiLedger/" + r._id))); }
  catch (e) { return { err: "Nothing was saved — could not check whether this list was finished already (" + (e.message || e) + "). Check the connection and press Finish again." }; }
  const found = was.filter((x, i) => x && x._id === rows[i]._id);
  if (!found.length) return {};
  if (found.length === rows.length && rows.every((r, i) => Number(was[i].qty) === Number(r.qty))) return { done: true };
  return { err: "Nothing was saved — this list was already finished" + (found[0].createdBy ? " by " + found[0].createdBy : "") + " on another screen, with other quantities. Close it and open it again." };
}
/** The rows are there already. '' when this screen may mark the list finished (they were written, the list was not saved);
 *  else why not: saving this screen's copy would cover the finished list. */
async function packFinishedElsewhere(packId) {
  try {
    const saved = await getDoc(doc(db, "packlist", packId));
    const scan = saved.exists() && saved.data().scan || {};
    return (scan.ledgerIds || []).length ? "Nothing was saved — this list is already finished on another screen. Close it and open it again." : "";
  } catch (e) {
    return "Nothing was saved — could not check the saved list (" + (e.message || e) + "). Check the connection and press Finish again.";
  }
}
async function packLedgerWrite(p, handoverTo) {
  if (!p) return { err: "No packing list open." };
  p.scan = p.scan || packScanNew([], [], "", "");
  if ((p.scan.ledgerIds || []).length) return { rows: [], already: true };
  /* the packing list of an FBA list never writes stock-out rows, even on a computer where the switch is off */
  if (packFbaOn() || p.scan.fbaListId) return packFbaFinish(p, handoverTo);
  if (!fgiCanEntry()) return { err: FGI_NO_ENTRY };
  if (FGI_FBA_ACCOUNTS.indexOf(p.account) < 0) return { err: `Pick the FBA account — ${FGI_FBA_ACCOUNTS.join(" or ")}.` };
  const why = await packDataReady();
  if (why) return { err: "Could not read the Finished Goods ledger: " + why };
  const unread = await fgiStockReread();
  if (unread) return { err: unread };
  if (handoverTo != null) p.scan.handoverTo = String(handoverTo || "").trim();
  const rows = PACK_CORE.ledgerRows(p, {
    newId: (sku) => packRowId(p.id, sku),
    nowIso: (/* @__PURE__ */ new Date()).toISOString(),
    by: ME.email || "",
    handoverTo: p.scan.handoverTo,
    allot: (sku, n, taken) => fgiOutAlloc(sku, n, "FBA", "", taken)
  });
  if (!rows.length) return { err: "Nothing packed yet — scan at least one piece." };
  if (typeof fapOn === "function" && fapOn()) {
    const unseen = await fapReread();
    if (unseen) return { err: unseen };
  }
  /* an approved repeat SKU already left the store under its approval's own row (FBAR-…), so it is not looked for here */
  const mine = rows.filter((r) => !(typeof fapApproved === "function" && fapApproved(p.id, r.sku)));
  const before = await packWrittenBefore(mine);
  if (before.err) return { err: before.err };
  if (before.done) {
    const elsewhere = await packFinishedElsewhere(p.id);
    if (elsewhere) return { err: elsewhere };
    packMarkDone(p, rows.map((r) => mine.includes(r) ? r._id : fapIdOf(p.id, r.sku)));
    return { rows: [], already: true };
  }
  for (const r of rows) {
    /* an approved repeat SKU has already left the store (fg-fba-repeat.js): it is not asked of the stock again */
    if (typeof fapApproved === "function" && fapApproved(p.id, r.sku)) continue;
    const bad = fgiOutCheck(r.sku, r.qty, "FBA", 0);
    const receive = r.qty > fgiOf(r.sku).current ? " Receive it in Finished Goods first, then Finish again." : "";
    if (bad) return { err: bad + receive };
  }
  /* SKUs sent to FBA in the past 7 days ask first (fg-fba-repeat.js). While one waits, nothing of the list is written. */
  const gate = typeof fapGate === "function" ? await fapGate(rows, p.id) : { send: rows, extra: {}, held: [], written: [] };
  if (gate.stop) return { err: gate.stop };
  if (gate.held.length) return { err: fapHeldNote(gate.held).trim() + " The list is not finished — finish it again once approved, or take those boxes out." };
  const sent = gate.send;
  const patch = Object.assign({}, gate.extra);
  sent.forEach((r) => {
    patch["pt_fgiLedger/" + r._id] = r;
  });
  const write = () => ptPatch(patch);
  if (!sent.length) {
    /* every SKU of the list was approved: its movements are written already */
  } else if (typeof shpHoldOn === "function" && shpHoldOn()) {
    const refused = await fgiFbaWrite(sent.map((r) => ({ sku: r.sku, qty: r.qty, current: fgiOf(r.sku).current })), write);
    if (refused) return { err: refused };
  } else await write();
  FGI.rows = (FGI.rows || []).concat(sent);
  packMarkDone(p, sent.concat(gate.written).map((r) => r._id));
  try {
    fbaBadge();
    fgiOverBadge();
  } catch (e) {
  }
  for (const r of sent) {
    try {
      await lstAlertFor(r.sku, "FBA", r.qty);
    } catch (e) {
    }
  }
  return { rows: sent };
}
