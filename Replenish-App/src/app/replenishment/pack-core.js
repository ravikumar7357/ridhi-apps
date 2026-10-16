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
        { _id: o.newId(), txnType: "FBA", sku: r.sku, qty: r.qty, date, reason: "", scanned: true },
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
function packOrderLines(scan) {
  const out = [];
  if (!scan) return out;
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
  return out;
}
async function packDataReady() {
  try {
    if (FGI.rows === null) await fgiLoad();
  } catch (e) {
    return e.message || String(e);
  }
  if (FGI.err && !(FGI.rows || []).length) return FGI.err;
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
async function packLedgerWrite(p, handoverTo) {
  if (!p) return { err: "No packing list open." };
  p.scan = p.scan || packScanNew([], [], "", "");
  if ((p.scan.ledgerIds || []).length) return { rows: [], already: true };
  if (!fgiCanEntry()) return { err: FGI_NO_ENTRY };
  if (FGI_FBA_ACCOUNTS.indexOf(p.account) < 0) return { err: `Pick the FBA account — ${FGI_FBA_ACCOUNTS.join(" or ")}.` };
  const why = await packDataReady();
  if (why) return { err: "Could not read the Finished Goods ledger: " + why };
  if (handoverTo != null) p.scan.handoverTo = String(handoverTo || "").trim();
  const rows = PACK_CORE.ledgerRows(p, {
    newId: () => fgiNewId("FBA"),
    nowIso: (/* @__PURE__ */ new Date()).toISOString(),
    by: ME.email || "",
    handoverTo: p.scan.handoverTo,
    allot: (sku, n, taken) => fgiOutAlloc(sku, n, "FBA", "", taken)
  });
  if (!rows.length) return { err: "Nothing packed yet — scan at least one piece." };
  for (const r of rows) {
    const bad = fgiOutCheck(r.sku, r.qty, "FBA", 0);
    if (bad) return { err: bad + " Receive it in Finished Goods first, then Finish again." };
  }
  const patch = {};
  rows.forEach((r) => {
    patch["pt_fgiLedger/" + r._id] = r;
  });
  await ptPatch(patch);
  FGI.rows = (FGI.rows || []).concat(rows);
  p.scan.ledgerIds = rows.map((r) => r._id);
  p.scan.done = true;
  p.scan.doneAt = (/* @__PURE__ */ new Date()).toISOString();
  p.scan.doneBy = ME.email || "";
  try {
    fbaBadge();
    fgiOverBadge();
  } catch (e) {
  }
  for (const r of rows) {
    try {
      await lstAlertFor(r.sku, "FBA", r.qty);
    } catch (e) {
    }
  }
  return { rows };
}
