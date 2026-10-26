/* SCAN TO PACK screen (PKS), from scanner-live/scan-to-pack.js + card-zoom.js. Replaces src/app/replenishment/pack-scan.js. */
/* ============================================================================================
 * SCAN TO PACK — the screen (PKS). Improved 16 Oct 2026 on the live copy, same order of things as live:
 *   1. NEVER LOSE SCANS   every change is kept on this phone (localStorage) until the server has it; a save that failed
 *                         is tried again every 15 s and as soon as the network is back; reopening the list restores it.
 *   2. STOP ON WRONG      a wrong article, an unknown label or a piece the orders do not want stops the counting until
 *                         the packer taps "Kept aside" — the next good scan can no longer hide the warning.
 *   3. SCREEN ON          the phone is kept awake while scanning; the camera stops when the app is in the background and
 *                         starts again on return. A Bluetooth / USB hand scanner is read wherever the focus is.
 *   4. FIX MISTAKES       −1 and remove on every line, any earlier box can be opened again, Undo survives closing and
 *                         reopening the list on this phone, and "everything on the orders is packed" is said out loud.
 * PACK_CORE (the order rules) and the camera reader are as live.
 * ============================================================================================ */
const PKS = {
  p: null,
  box: 1,
  per: 1,
  hist: [],
  last: null,
  seen: null,
  stream: null,
  timer: 0,
  det: null,
  zx: null,
  saveT: 0,
  saving: false,
  dirty: false,
  err: "",
  busy: false,
  on: false,
  hold: false,      // a wrong / unknown / not-wanted piece is on screen: nothing counts until "Kept aside"
  wake: null,       // the screen wake lock
  keyBuf: "",       // what a hand scanner has typed so far
  keyT: 0,
  retryT: 0,
  restored: 0,      // scans brought back from this phone when the list was opened
  allDone: false,
  mode: "",         // "pack" (box or by order) or "track" (look-up only)
  track: null,      // Track order scan: { last, recent }
  panel: ""         // "dims" or "finish" while that panel is open: a save landing must not redraw it away
};
const PKS_GAP_MS = 900;     // a label not read for this long has left the camera (21 Oct; see pksFrame)
const PKS_GONE_MS = 250;    // unread this long and back somewhere else: it may be the next piece (26 Oct; see pksFrame)
const PKS_LEFT_MS = 120;    // …or this long, when it was last seen on its way out
const PKS_MOVE = 0.2;       // this far across the box on screen is another place: the label moved, not shook
const PKS_AGREE = 2;
const PKS_RETRY_MS = 15000;
const PKS_HIST_KEEP = 80;
function pksResolve(code) {
  const c = obUC(code);
  if (!c) return { sku: "", how: "" };
  const byFn = (FN.map || /* @__PURE__ */ new Map()).get(c);
  if (byFn) return { sku: obUC(byFn), how: "fnsku" };
  const rmap = typeof replRowMap === "function" ? replRowMap() : {};
  if (rmap[c] || PK_META[c] || (PTG.mdb || []).some((r) => r && obUC(r.sku) === c)) return { sku: c, how: "sku" };
  return { sku: "", how: "" };
}
function pksImg(sku) {
  const k = obUC(sku);
  let u = (typeof ptImgOf === "function" ? ptImgOf(k) : "") || "";
  if (!u) {
    const r = (typeof replRowMap === "function" ? replRowMap() : {})[k];
    u = r && r.image || "";
  }
  return /m\.media-amazon\.com\/images\/I\//.test(u) ? u.replace(/\._[A-Z0-9_,]+_\./, ".").replace(/\.(jpg|png)$/i, "._SL900_.$1") : u;
}
function pksBoxOf(p, n) {
  let b = (p.boxes || []).find((x) => +x.n === +n);
  if (!b) {
    b = { n: +n, L: "", W: "", H: "", items: [] };
    p.boxes = (p.boxes || []).concat([b]).sort((a, c) => a.n - c.n);
  }
  return b;
}
/** One read of `code` at time `t`: true when it counts as a new piece.
 * ONE LABEL, ONE PIECE (21 Oct, Ravi: "scanning delayed … bohot mushkil se scan … kai phonon main scan bhi nahi"). A label
 * is in sight from its first read until it has gone unread for longer than a label held in front of the camera ever goes
 * between reads — at least PKS_GAP_MS, more on a phone that reads slowly or patchily (2.5 × the longest gap seen while this
 * label was in sight). Every read of it, however patchy, keeps it in sight. The rule before (19 Oct) let a slightly blurred
 * or tilted label, read every 0.2–0.4 s, count again and again: 7–10 times in six seconds.
 * `need` reads must agree before it counts: a Code 128 label carries its own check digit, so one read of a code on the
 * FNSKU list is enough (the caller says so); anything else needs PKS_AGREE.
 *
 * WHERE THE LABEL SITS (26 Oct, Ravi: "it was scanning every product properly before, not now"). The 0.9 s wait above
 * missed the next identical piece: swapped in under a second, or read once while moving, and 4 of 5 pieces were lost.
 * Waiting alone cannot tell a label held still that blurs for half a second from the next piece put in its place, so the
 * readers now say where the label is (st.aim, set by pksAimed; null from a reader that cannot tell). The label's place
 * is kept (`home`, following it as the hand drifts). The same code is the next piece when, after PKS_GONE_MS unread, it
 * comes back somewhere else (PKS_MOVE from home), or, after PKS_LEFT_MS, when it was last seen on its way out; then two
 * reads in one place count it, so a label read once while sliding out never counts. Back in its old place without being
 * seen leave, it is the same piece, as before: a piece put down exactly where the last one was still waits PKS_GAP_MS. */
function pksFrame(code, t, st, need) {
  st = st || PKS;
  const f = st.frameMs || 0, s = st.seen, agree = need || PKS_AGREE, at = st.aim || null;
  if (s && s.code === code) {
    const iv = t - s.last, hold = Math.max(PKS_GAP_MS, 6 * f, 2.5 * (s.ivMax || 0));
    const next = (s.away && iv > Math.max(PKS_LEFT_MS, 1.5 * f)) || (iv > Math.max(PKS_GONE_MS, 2.2 * f) && pksApart(s.home, at) >= PKS_MOVE);
    if (next) {
      st.seen = { code, last: t, hits: 1, counted: false, need: 2, settle: at, home: at, away: false, farN: 0, ivMax: 0 };
      return false;
    }
    if (iv <= hold) {
      if (iv > 0) s.ivMax = Math.max(s.ivMax || 0, Math.min(iv, 1600));
      s.last = t;
      if (at) pksTrack(s, at);
      /* a piece being settled counts on two reads in one place: one read while it slides in starts again */
      if (!s.counted && s.settle && at) {
        const still = pksApart(s.settle, at) < PKS_MOVE / 2;
        s.settle = at;
        s.hits = still ? s.hits + 1 : 1;
      } else s.hits++;
      if (!s.counted && s.hits >= (s.need || agree)) { s.counted = true; return true; }
      return false;
    }
  }
  st.seen = { code, last: t, hits: 1, counted: agree <= 1, need: agree, home: at, away: false, farN: 0, ivMax: 0 };
  return agree <= 1;
}
/** How far apart two places in the box on screen are (shares of its width and height); 0 when either is not known. */
function pksApart(a, b) {
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}
/** One read at `at`: near home, home follows it (a hand drifts); away from home, the label is on its way out, unless it
 * stays still there for three reads in a row, which is a piece moved to a new place without leaving. */
function pksTrack(s, at) {
  if (!s.home) { s.home = at; s.away = false; s.farN = 0; return; }
  if (pksApart(s.home, at) < PKS_MOVE) {
    s.home = { x: s.home.x * 0.8 + at.x * 0.2, y: s.home.y * 0.8 + at.y * 0.2 };
    s.away = false; s.farN = 0;
    return;
  }
  s.farN = s.farN && pksApart(s.farAt, at) < PKS_MOVE / 2 ? s.farN + 1 : 1;
  s.farAt = at;
  if (s.farN >= 3) { s.home = at; s.away = false; s.farN = 0; }
  else s.away = true;
}
/** A piece counted some other way (hand scanner, typed): the same label in front of the camera is not counted again. */
function pksSeenNow(code) {
  PKS.seen = { code: obUC(code), last: Date.now(), hits: PKS_AGREE, counted: true, ivMax: 0 };
}

/* ---- 1. kept on this phone until the server has it ---- */
const PKS_LS = (id) => "pksBackup:" + id;
const PKS_LH = (id) => "pksHist:" + id;
function pksBackup() {
  if (!PKS.p) return;
  try {
    localStorage.setItem(PKS_LS(PKS.p.id), JSON.stringify({ at: Date.now(), box: PKS.box, p: PKS.p }));
    localStorage.setItem(PKS_LH(PKS.p.id), JSON.stringify(PKS.hist.slice(-PKS_HIST_KEEP)));
  } catch (e) {
  }
}
function pksBackupOf(id) {
  try {
    const v = localStorage.getItem(PKS_LS(id));
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}
function pksBackupClear(id) {
  try {
    localStorage.removeItem(PKS_LS(id));
  } catch (e) {
  }
}
function pksHistOf(id) {
  try {
    const v = localStorage.getItem(PKS_LH(id));
    return v ? JSON.parse(v) : [];
  } catch (e) {
    return [];
  }
}
function pksHistClear(id) {
  try {
    localStorage.removeItem(PKS_LH(id));
  } catch (e) {
  }
}
const pksQty = (p) => (p && p.boxes || []).reduce((s, b) => s + PACK_CORE.boxQty(b), 0);

const pksOrderLines = () => packOrderLines(PKS.p && PKS.p.scan);
function pksCount(code, via) {
  const p = PKS.p;
  if (!p) return { ok: false, kind: "none", code, why: "No packing list open." };
  const r = pksResolve(code);
  if (!r.sku) return { ok: false, kind: "unknown", code: obUC(code), why: "This code is not in the FNSKU list and is not a SKU this app knows." };
  let n = PKS.per, parts = null, left = null;
  if (packGuarded(p)) {
    const a = PACK_CORE.apply(r, pksOrderLines(), p.scan.packed, PKS.per);
    if (a.kind === "wrong") {
      p.scan.wrong.push({ at: (/* @__PURE__ */ new Date()).toISOString(), code: obUC(code), sku: r.sku, by: ME.email || "" });
      pksSaveSoon();
      return { ok: false, kind: "wrong", code: obUC(code), sku: r.sku, why: r.sku + " is not on any order of this list." };
    }
    if (a.kind === "full") return { ok: false, kind: "full", store: a.why === "store", code: obUC(code), sku: r.sku, why: a.why === "store" ? "The India Store holds no more " + r.sku + " for these orders — receive it in Finished Goods first." : "Every order line for " + r.sku + " is already packed." };
    n = a.taken;
    parts = a.parts;
    left = a.left;
  }
  const b = pksBoxOf(p, PKS.box);
  const it = PACK_CORE.addToBox(b, r.sku, n, pkLookupSku(r.sku) || {});
  PKS.hist.push({ box: b.n, sku: r.sku, n, parts, code: obUC(code), at: Date.now(), via: via || "camera" });
  PKS.last = { sku: r.sku, how: r.how, code: obUC(code), left };
  pksSaveSoon();
  return { ok: true, sku: r.sku, how: r.how, item: it, box: b, n, short: n < PKS.per, left };
}
function pksUndo() {
  PKS.panel = "";
  const h = PKS.hist.pop();
  if (!h || !PKS.p) return null;
  const b = pksBoxOf(PKS.p, h.box);
  PACK_CORE.takeFromBox(b, h.sku, h.n);
  if (h.parts && PKS.p.scan) PACK_CORE.untake(PKS.p.scan.packed, h.sku, h.parts);
  PKS.last = PKS.hist.length ? { sku: PKS.hist[PKS.hist.length - 1].sku } : null;
  PKS.box = h.box;     // Undo shows the box it took the piece out of
  pksSaveSoon(0);
  return h;
}

/* ---- 4. fix a line by hand: −1, or the whole line out ---- */
/** Give back n pieces of a SKU to the orders, newest order first — for a line changed by hand, which has no scan parts. */
function pksUntakeAny(sku, n) {
  const sc = PKS.p && PKS.p.scan, k = obUC(sku);
  if (!sc || !sc.packed || !sc.packed[k]) return;
  let rest = n;
  const parts = [];
  Object.entries(sc.packed[k]).reverse().forEach(([no, q]) => {
    if (rest <= 0) return;
    const t = Math.min(rest, pkNum(q));
    if (t > 0) parts.push({ orderNo: no, qty: t });
    rest -= t;
  });
  PACK_CORE.untake(sc.packed, k, parts);
}
/** Take n pieces of a SKU out of the open box. The scans behind them leave the Undo list, so Undo never takes them twice. */
function pksTake(sku, n) {
  PKS.panel = "";
  const b = pksBoxOf(PKS.p, PKS.box), it = PACK_CORE.itemOf(b, sku);
  if (!it) return 0;
  const k = Math.min(n, pkNum(it.qty));
  PACK_CORE.takeFromBox(b, sku, k);
  let rem = k, viaParts = 0;
  for (let i = PKS.hist.length - 1; i >= 0 && rem > 0; i--) {
    const h = PKS.hist[i];
    if (+h.box !== +b.n || obUC(h.sku) !== obUC(sku)) continue;
    const t = Math.min(rem, h.n);
    if (h.parts && PKS.p.scan) {
      const give = [];
      let r = t;
      for (let j = h.parts.length - 1; j >= 0 && r > 0; j--) {
        const q = Math.min(r, h.parts[j].qty);
        give.push({ orderNo: h.parts[j].orderNo, qty: q });
        h.parts[j].qty -= q;
        r -= q;
      }
      h.parts = h.parts.filter((x) => x.qty > 0);
      PACK_CORE.untake(PKS.p.scan.packed, sku, give);
      viaParts += t;
    }
    h.n -= t;
    rem -= t;
    if (h.n <= 0) PKS.hist.splice(i, 1);
  }
  if (k - viaParts > 0) pksUntakeAny(sku, k - viaParts);
  PKS.last = null;
  PKS.allDone = false;
  pksSaveSoon(0);
  return k;
}
function pksGoBox(n) {
  PKS.panel = "";
  PKS.box = +n;
  pksBoxOf(PKS.p, PKS.box);
  PKS.last = null;
  pksSay(`Box ${PKS.box} open — scans now go into it`);
  pksDraw();
}

function pksNextBox(dims) {
  const b = pksBoxOf(PKS.p, PKS.box);
  if (dims) ["L", "W", "H"].forEach((k) => {
    if (dims[k] !== void 0 && dims[k] !== "") b[k] = pkNum(dims[k]);
  });
  if (dims && pkNum(dims.gross) > 0) b.grossWtOverride = pkNum(dims.gross);
  PKS.box = Math.max(...(PKS.p.boxes || []).map((x) => +x.n), PKS.box) + 1;
  pksBoxOf(PKS.p, PKS.box);
  pksSaveSoon(0);
}
function pksSaveSoon(ms) {
  PKS.dirty = true;
  pksBackup();
  clearTimeout(PKS.saveT);
  PKS.saveT = setTimeout(pksSaveNow, ms == null ? 700 : ms);
}
async function pksSaveNow() {
  if (!PKS.p || PKS.saving || !PKS.dirty) return;
  PKS.saving = true;
  PKS.dirty = false;
  clearTimeout(PKS.retryT);
  pksSavedMark();
  const p = Object.assign({}, PKS.p, { boxes: (PKS.p.boxes || []).filter((b) => (b.items || []).length || +b.n < PKS.box) });
  try {
    /* NO NETWORK IS NOT "SAVED" (21 Oct): an offline write never fails, it only waits — so the screen said "Saving…" for
       ever and Close said "saved". No network, or no answer in 12 s, is now a failed save: the scans stay on this phone
       and are sent again every 15 s and when the network comes back. */
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("no network");
    await Promise.race([savePkOne(p), new Promise((_, rej) => setTimeout(() => rej(new Error("no answer from the server")), 12000))]);
    PKS.err = "";
    if (!PKS.dirty) pksBackupClear(p.id);   // the server has all of it; nothing left only on the phone
  } catch (e) {
    PKS.err = "Not saved yet (" + (e.message || e) + "). Every scan is kept on this phone and is saved as soon as the network is back.";
    PKS.dirty = true;
    PKS.retryT = setTimeout(pksSaveNow, PKS_RETRY_MS);
  }
  PKS.saving = false;
  if (PKS.dirty && !PKS.err) pksSaveSoon();
  pksDraw();
}
/** The small line under the title: saved, saving, or kept on this phone. */
function pksSavedMark() {
  const el = $("pksSaved");
  if (!el) return;
  const st = PKS.err ? "off" : PKS.saving || PKS.dirty ? "busy" : "ok";
  el.className = "pks-saved pks-saved-" + st;
  el.textContent = st === "off" ? "Not saved — kept on this phone" : st === "busy" ? "Saving…" : "Saved";
}
async function pksCamStart() {
  const v = $("pksVid");
  if (!v) return;
  if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
    pksSay("This browser cannot open the camera here — use a hand scanner or type the code below.", true);
    return;
  }
  /* ONE CAMERA AT A TIME (21 Oct): a start that finishes after the list was closed, or after a newer start, lets its camera
     go at once — before, it stayed on in the background. */
  const gen = (PKS.camGen = (PKS.camGen || 0) + 1);
  if (PKS.stream) { PKS.stream.getTracks().forEach((t) => t.stop()); PKS.stream = null; }
  let stream;
  try {
    /* 1080p where the phone has it: a small FNSKU label is read from further away, where the camera can focus (19 Oct) */
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  } catch (e) {
    /* A laptop or desktop with no camera is a hand-scanner station, not a fault: the camera box goes, the code box is
       ready, and nothing is said in red (19 Oct: "we are going to connect a scanner with our laptop or desktop"). */
    if (e && (e.name === "NotFoundError" || e.name === "OverconstrainedError")) return pksDeskMode();
    pksSay(e && e.name === "NotAllowedError" ? "The camera is not allowed for this site — allow it in the browser settings, or use a hand scanner / type the code."
      : e && e.name === "NotReadableError" ? "The camera is busy in another app — close that app, then close and reopen this list."
      : "The camera did not open (" + (e.name || e.message || e) + "). Allow the camera for this site, or use a hand scanner / type the code.", true);
    return;
  }
  if (!PKS.on || gen !== PKS.camGen || !$("pksVid")) { stream.getTracks().forEach((t) => t.stop()); return; }
  PKS.stream = stream;
  /* a camera taken away (a call, another app) is opened again, once it can be */
  const tr0 = stream.getVideoTracks()[0];
  if (tr0 && tr0.addEventListener) tr0.addEventListener("ended", () => {
    if (!PKS.on || PKS.stream !== stream || document.visibilityState !== "visible") return;
    pksSay("The camera stopped — opening it again…", true);
    pksCamStop();
    setTimeout(() => { if (PKS.on && !PKS.stream) pksCamStart().then(pksFocus); }, 600);
  });
  v.srcObject = PKS.stream;
  v.setAttribute("playsinline", "");
  v.muted = true;
  try {
    await v.play();
  } catch (e) {
  }
  try {
    if ("BarcodeDetector" in window && (await BarcodeDetector.getSupportedFormats()).includes("code_128"))
      /* Code 128 only — what FNSKU and SKU labels carry. A product's own EAN / UPC in view was read too, and Code 39 has
         no check digit, so a half-seen bar could come back as another code (19 Oct: "not working accurately"). */
      PKS.det = new BarcodeDetector({ formats: ["code_128"] });
  } catch (e) {
    PKS.det = null;
  }
  if (!PKS.det) {
    /* the better reader first; if it is not ready in 5 s (slow network, first open) the small one reads meanwhile */
    const wz = pksWzLoad().catch(() => false);
    if (!(await Promise.race([wz, new Promise((r) => setTimeout(() => r(false), 5000))]))) {
      try {
        await pksZxLoad();
      } catch (e) {
        if (!(await wz)) { pksSay("The barcode reader did not load — use a hand scanner or type the code.", true); return; }
      }
    }
  }
  if (!PKS.stream || gen !== PKS.camGen) return;
  const track = PKS.stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  if ($("pksTorch")) $("pksTorch").classList.toggle("hide", !caps.torch);
  PKS.hasTorch = !!caps.torch;
  PKS.torch = false; PKS.torchAuto = false; PKS.torchHand = false; PKS.darkSaid = false; PKS.lightAt = 0;
  PKS.fit = null; PKS.zxN = 0; PKS.readAt = Date.now(); PKS.frameMs = 0; PKS.loopAt = 0; PKS.detErr = 0;
  /* the better reader is fetched now on every phone, not after 2.5 s of nothing: ready when the phone's own one misses */
  if (PKS.det) pksWzLoad().catch(() => {});
  pksSay("Point at the FNSKU label");
  pksLoop();
}
/** No camera here: scan with the hand scanner. The screen stays as it is (Ravi, 19 Oct: "the previous UI … showing the
 * SKU with details"): the camera box says the hand scanner is ready, and a scan shows the same SKU card as the camera.
 * The code box keeps the focus, so every scan lands in it. */
function pksDeskMode() {
  const cam = document.querySelector("#pksOv .pks-cam");
  if (cam && !cam.querySelector(".pks-deskmsg")) {
    const m = document.createElement("div");
    m.className = "pks-deskmsg";
    m.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#cbd5e1;font-size:15px;text-align:center;padding:12px";
    m.innerHTML = '<b style="font-size:17px;color:#fff">Hand scanner ready</b><span>Scan a label — its SKU and details show below</span>';
    cam.appendChild(m);
  }
  pksSay("Ready — scan with the hand scanner");
  const box = $("pksCode");
  if (box) { box.placeholder = "Scan with the hand scanner (or type the FNSKU and press Enter)"; box.focus(); }
}
function pksZxLoad() {
  if (window.ZXing) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "/vendor/zxing.min.js";
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}
/* THE BETTER READER (21 Oct, Ravi: "jaise yeh image hai isko toh scan hi nahi kar paya" — an FNSKU label stuck upright on
 * striped cloth). ZXing JS read 0 of 8 pictures of it; zxing-cpp — the C++ ZXing, kept up by ZXing's own maintainers —
 * built for the browser (zxing-wasm 3.1.5, in /vendor, nothing fetched from outside) reads it. It reads a label at any
 * turn, finds it among stripes and print, and says where each label is, so the one aimed at is chosen. ~1 MB, loaded on
 * first use and cached after; ZXing JS stays as the reader when it cannot load. */
function pksWzLoad() {
  if (PKS.wzP) return PKS.wzP;
  PKS.wzP = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "/vendor/zxing-wasm-reader.js";
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  }).then(() => window.ZXingWASM.prepareZXingModule({
    overrides: { locateFile: (f, pre) => (f.endsWith(".wasm") ? "/vendor/" + f : pre + f) },
    fireImmediately: true,
  })).then(() => { PKS.wz = window.ZXingWASM; return true; });
  PKS.wzP.catch(() => { PKS.wzP = null; PKS.wzFailAt = Date.now(); });     // tried again, but not before 30 s
  return PKS.wzP;
}
const PKS_WZ_OPT = { formats: ["Code128"], tryHarder: true, tryRotate: true, tryInvert: false, tryDownscale: true, maxNumberOfSymbols: 4 };
/* A LABEL HELD AT A SLANT: a barcode reader reads bars up to about 12° off straight (tryRotate adds the quarter turns).
 * Measured 21 Oct: at 15°, 45°, 75° … nothing read. So the picture is also read turned 22.5°, 45° and −22.5° — every
 * other picture straight, the turned ones in between — which leaves no angle unread. */
const PKS_WZ_TURN = [0, 22.5, 0, 45, 0, -22.5];
/** What shows in the box on screen, with a quarter of its height more above and below (an upright label runs past the
 * box), turned as PKS_WZ_TURN says, read by zxing-cpp; of the labels found, the one aimed at (pksAimed). */
async function pksWzRead(v) {
  const W = v.videoWidth, H = v.videoHeight;
  if (!W || !H) return null;
  const r = pksSeenRect(v), pad = r.h * 0.25;
  const sx = Math.round(r.x), sy = Math.round(Math.max(0, r.y - pad)), sw = Math.round(r.w), sh = Math.round(Math.min(H, r.y + r.h + pad) - sy);
  const deg = PKS_WZ_TURN[(PKS.wzN = (PKS.wzN || 0) + 1) % PKS_WZ_TURN.length], a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const cw = Math.ceil(Math.abs(sw * cs) + Math.abs(sh * sn)), ch = Math.ceil(Math.abs(sw * sn) + Math.abs(sh * cs));
  const c = PKS.wcv || (PKS.wcv = document.createElement("canvas"));
  const g = c.getContext("2d", { willReadFrequently: true });
  if (c.width !== cw) c.width = cw;
  if (c.height !== ch) c.height = ch;
  if (deg) { g.fillStyle = "#808080"; g.fillRect(0, 0, cw, ch); }
  g.setTransform(cs, sn, -sn, cs, cw / 2, ch / 2);
  g.drawImage(v, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const got = await PKS.wz.readBarcodes(g.getImageData(0, 0, cw, ch), PKS_WZ_OPT);
  /* each label's middle, turned back into the camera picture */
  return pksAimed((got || []).filter((x) => x.isValid && x.text).map((x) => {
    const q = x.position, dx = (q.topLeft.x + q.topRight.x + q.bottomLeft.x + q.bottomRight.x) / 4 - cw / 2,
      dy = (q.topLeft.y + q.topRight.y + q.bottomLeft.y + q.bottomRight.y) / 4 - ch / 2;
    return { rawValue: x.text, boundingBox: { x: sx + sw / 2 + cs * dx + sn * dy, y: sy + sh / 2 - sn * dx + cs * dy, width: 0, height: 0 } };
  }), v);
}
/** The part of the camera picture the packer actually sees in the box on screen (the video is drawn to cover the box, so
 * on a phone held upright only a strip across the middle shows), in the picture's own pixels. Worked out once per size. */
function pksSeenRect(v) {
  const W = v.videoWidth, H = v.videoHeight, cw = v.clientWidth || 0, ch = v.clientHeight || 0;
  const key = W + "x" + H + "/" + cw + "x" + ch;
  if (PKS.fit && PKS.fit.key === key) return PKS.fit;
  let r = { x: 0, y: 0, w: W, h: H };
  if (cw > 0 && ch > 0 && W && H) {
    const s = Math.max(cw / W, ch / H), w = Math.min(W, cw / s), h = Math.min(H, ch / s);
    r = { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }
  PKS.fit = Object.assign(r, { key });
  return r;
}
/* READING WITHOUT THE PHONE'S OWN READER — iPhones, laptops and the many Android phones that have none (21 Oct).
 * Measured on 14 generated FNSKU labels (sizes, blur, dark, tilt, two labels side by side): the 19 Oct reader read 3 —
 * it squeezed the 1080p picture to 1280 wide, which breaks the bars. At full sharpness it read 8; with ZXing's "try
 * harder" on every fourth picture, 10; a 2/3-size copy every fourth picture catches labels printed at an odd bar width.
 * Only the band the packer is aiming with is read: the middle 60% of what shows on screen. */
function pksZxRead(v) {
  const W = v.videoWidth, H = v.videoHeight;
  if (!W || !H) return null;
  const r = pksSeenRect(v), k = (PKS.zxN = (PKS.zxN || 0) + 1) % 4;
  const c = PKS.cv || (PKS.cv = document.createElement("canvas"));
  const g = c.getContext("2d", { willReadFrequently: true });
  if (k === 2) {
    /* A LABEL STUCK ON UPRIGHT (21 Oct, Ravi's photo of X0055RALOT): its bars run across the picture, which this reader
       cannot read, and on a phone held upright most of it is above and below the box on screen. Every fourth picture a
       band down the middle of the WHOLE picture is turned on its side and read. */
    const bw = Math.max(40, Math.round(r.w * 0.6)), sx = Math.round(r.x + (r.w - bw) / 2);
    if (c.width !== H) c.width = H;
    if (c.height !== bw) c.height = bw;
    g.setTransform(0, -1, 1, 0, 0, bw);
    g.drawImage(v, sx, 0, bw, H, 0, 0, bw, H);
    g.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    const bh = Math.max(40, Math.round(r.h * 0.6)), sy = Math.round(r.y + (r.h - bh) / 2);
    const scale = k === 1 ? 2 / 3 : 1, cw = Math.round(r.w * scale), ch = Math.round(bh * scale);
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;
    g.drawImage(v, Math.round(r.x), sy, Math.round(r.w), bh, 0, 0, cw, ch);
  }
  if (!PKS.zx) PKS.zx = new ZXing.Code128Reader();
  let hints = null;
  if (k === 3) { hints = PKS.zxHard || (PKS.zxHard = new Map()); hints.set(ZXing.DecodeHintType.TRY_HARDER, true); }
  try {
    return PKS.zx.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c))), hints || undefined).getText();
  } catch (e) {
    return null;
  }
}
/** Of the labels in view, the one the camera is pointed at: nearest the middle, and inside the middle band — the same
 * band the ZXing reader looks at. With two labels in view the reader used to take whichever came first, a different one
 * from frame to frame, so the two frames that must agree before a piece counts seldom did: slow, and now and then the
 * wrong label (19 Oct). */
function pksAimed(got, v) {
  const W = v.videoWidth || 1, H = v.videoHeight || 1;
  /* only a label that shows in the box on screen (21 Oct: one the packer could not see was counted) */
  const r = pksSeenRect(v), mx = r.x + r.w / 2, my = r.y + r.h / 2;
  /* ONE LABEL IN VIEW IS THAT LABEL (21 Oct, Ravi's S24 video: a clear label in the box, nothing read for 20 s). Where a
     phone's reader puts a label is not the same on every phone, so a lone label is never refused for where it is; the
     box on screen only decides between two or more. */
  /* where the label is, as shares of the box on screen, for pksFrame to tell the next piece from this one (26 Oct) */
  const place = (b) => b && isFinite(b.x) && isFinite(b.y) ? { x: (b.x + (b.width || 0) / 2 - r.x) / (r.w || W), y: (b.y + (b.height || 0) / 2 - r.y) / (r.h || H) } : null;
  PKS.aim = null;
  const all = (got || []).filter((x) => x.rawValue);
  if (all.length === 1) { PKS.aim = place(all[0].boundingBox); return all[0].rawValue; }
  let best = null, bestD = Infinity;
  (got || []).forEach((x) => {
    const b = x.boundingBox;
    if (!x.rawValue || !b) return;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (cx < r.x || cx > r.x + r.w || cy < r.y + r.h * 0.1 || cy > r.y + r.h * 0.9) return;
    const d = Math.hypot((cx - mx) / (r.w || W), (cy - my) / (r.h || H));
    if (d < bestD) { bestD = d; best = x.rawValue; PKS.aim = place(b); }
  });
  return best;
}
/* WHAT THE SCANNER SEES, for finding out why a phone does not read (21 Oct): open the app with ?scandebug=1 and a
   line over the camera picture shows the reader, the picture sizes, labels found, the last read and the last error. */
const PKS_DEBUG = typeof location !== "undefined" && /[?&]scandebug=1/.test(location.search || "");
function pksDebugShow(v, code) {
  if (code) PKS.dbgLast = code;
  if (Date.now() - (PKS.dbgAt || 0) < 300) return;
  PKS.dbgAt = Date.now();
  const cam = v.parentNode;
  if (!cam) return;
  let el = cam.querySelector(".pks-dbg");
  if (!el) {
    el = document.createElement("div");
    el.className = "pks-dbg";
    el.style.cssText = "position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.65);color:#fde68a;font:11px/1.35 monospace;padding:3px 6px;pointer-events:none;white-space:pre-wrap";
    cam.appendChild(el);
  }
  const r = pksSeenRect(v);
  el.textContent = `reader ${PKS.det ? "phone" : PKS.wz ? "zxing-cpp" : window.ZXing ? "zxing-js" : "none"}${PKS.wz ? " +cpp" : PKS.wzP ? " (cpp loading)" : ""}`
    + ` · video ${v.videoWidth}x${v.videoHeight} · box ${v.clientWidth}x${v.clientHeight} · seen ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}`
    + ` · ${Math.round(PKS.frameMs || 0)} ms/picture · found ${PKS.dbgN == null ? "-" : PKS.dbgN} · last ${PKS.dbgLast || "-"}${PKS.dbgErr ? " · error " + PKS.dbgErr : ""}`;
}
/* each camera start is a new run: a picture callback left from the run before (the app went to the background and came
   back) ends instead of starting a second reader beside the new one */
let PKS_RUN = 0;
async function pksLoop(run) {
  if (run === undefined) run = ++PKS_RUN;
  if (!PKS.on || !PKS.stream || run !== PKS_RUN) return;
  const v = $("pksVid");
  let code = null;
  PKS.aim = null;     // where this picture's label is: set by pksAimed; the ZXing JS reader cannot tell
  try {
    if (PKS.det) {
      /* A PHONE'S OWN READER THAT FAILS ON EVERY PICTURE ("Barcode detection service unavailable" on some Androids):
         before, every picture was lost and the other reader never ran. Five failures in a row and it is set aside. */
      let got = null;
      try {
        got = await PKS.det.detect(v);
        PKS.detErr = 0;
      } catch (e) {
        PKS.dbgErr = (e && (e.name + ": " + e.message)) || String(e);
        if (++PKS.detErr >= 5) { PKS.det = null; pksWzLoad().catch(() => pksZxLoad().catch(() => {})); }
      }
      if (got) PKS.dbgN = got.length;
      code = got ? pksAimed(got, v) : null;
      /* SOME PHONES' OWN READER SEES LITTLE (21 Oct: "kai phonon main scan bhi nahi"): a picture it reads nothing in,
         every other one, goes to the better reader too */
      if (!code && (PKS.zxN = (PKS.zxN || 0) + 1) % 2 === 0) {
        if (PKS.wz) code = await pksWzRead(v);
        else if (!PKS.wzP && Date.now() - (PKS.wzFailAt || 0) > 30000) pksWzLoad().catch(() => {});
      }
    } else code = PKS.wz ? await pksWzRead(v) : window.ZXing ? pksZxRead(v) : null;
  } catch (e) {
    PKS.dbgErr = (e && (e.name + ": " + e.message)) || String(e);
    code = null;
  }
  if (run !== PKS_RUN || !PKS.on) return;     // the camera was closed while this picture was being read
  /* how fast this phone reads: the pksFrame waits follow it */
  const now = Date.now();
  if (PKS.loopAt && now - PKS.loopAt < 2000) PKS.frameMs = PKS.frameMs ? PKS.frameMs * 0.8 + (now - PKS.loopAt) * 0.2 : now - PKS.loopAt;
  PKS.loopAt = now;
  if (code) {
    PKS.readAt = now;
    const c = obUC(code);
    /* one read of a code on the FNSKU list / a known SKU counts — Code 128 checks itself; an unknown one needs two */
    if (pksFrame(c, now, PKS, pksResolve(c).sku ? 1 : PKS_AGREE)) pksHit(code, "camera");
  }
  if (v) pksLightCheck(v, PKS.hasTorch);
  if (PKS_DEBUG && v) pksDebugShow(v, code);
  /* the phone's own reader looks at each new picture as it arrives; the other readers take the next picture as soon as
     they are done with this one (it waited 140 ms before — 21 Oct, "scanning delayed") */
  if (PKS.det && v && typeof v.requestVideoFrameCallback === "function") { PKS.timer = 0; v.requestVideoFrameCallback(() => pksLoop(run)); }
  else PKS.timer = setTimeout(() => pksLoop(run), PKS.det ? 60 : 30);
}
function pksCamStop() {
  clearTimeout(PKS.timer);
  PKS_RUN++;
  PKS.camGen = (PKS.camGen || 0) + 1;     // a start still waiting for the camera lets it go
  if (PKS.stream) PKS.stream.getTracks().forEach((t) => t.stop());
  PKS.stream = null;
}
/** Ask the camera to keep focusing, and to keep setting its brightness and colour, by itself, where the phone allows it
 * (labels are read close up, and a shadow or a dim corner moves with the hand). */
async function pksFocus() {
  try {
    const t = PKS.stream && PKS.stream.getVideoTracks()[0], caps = t && t.getCapabilities ? t.getCapabilities() : {};
    const want = {};
    if ((caps.focusMode || []).includes("continuous")) want.focusMode = "continuous";
    if ((caps.exposureMode || []).includes("continuous")) want.exposureMode = "continuous";
    if ((caps.whiteBalanceMode || []).includes("continuous")) want.whiteBalanceMode = "continuous";
    for (const k of Object.keys(want)) { try { await t.applyConstraints({ advanced: [{ [k]: want[k] }] }); } catch (e) { /* this phone does not take this one */ } }
  } catch (e) {
  }
}

/* ---- DARK AND SHADOW (Ravi, 19 Oct: "scan in dark … in shadows … accurately") ----
 * Once a second the middle of the picture is weighed (a 32 × 18 copy, nothing heavy). Too dark for a label: the torch
 * comes on by itself — it also fills the shadow of a hand or the phone over the label — and goes off again once the
 * light is back. A torch pressed by hand is left as the packer set it. A phone with no torch is told to find light. */
const PKS_DARK = 55, PKS_LIGHT = 95;     // average grey (0–255) of the middle of the picture: on below, off above
/** What to do with the torch, from the brightness now: "on", "off" or "" (leave it). Pure, for the tests. */
function pksLightStep(mean, torchOn, auto, hasTorch) {
  if (!hasTorch || mean == null) return "";
  if (!torchOn && mean < PKS_DARK) return "on";
  if (torchOn && auto && mean > PKS_LIGHT + 60) return "off";   // lit by the torch itself reads brighter: off only when the room is truly light
  return "";
}
function pksMean(v) {
  const W = v.videoWidth, H = v.videoHeight;
  if (!W || !H) return null;
  const c = PKS.lc || (PKS.lc = document.createElement("canvas"));
  c.width = 32; c.height = 18;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(v, W * 0.2, H * 0.25, W * 0.6, H * 0.5, 0, 0, 32, 18);
  const d = g.getImageData(0, 0, 32, 18).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  return s / (d.length / 4);
}
async function pksTorchSet(on, auto) {
  try {
    const t = PKS.stream && PKS.stream.getVideoTracks()[0];
    if (!t) return;
    await t.applyConstraints({ advanced: [{ torch: on }] });
    PKS.torch = on;
    PKS.torchAuto = on && auto;
    if ($("pksTorch")) $("pksTorch").classList.toggle("on", on);
    return true;
  } catch (e) {
    return false;
  }
}
function pksLightCheck(v, hasTorch) {
  const now = Date.now();
  if (now - (PKS.lightAt || 0) < 1000) return;
  PKS.lightAt = now;
  let mean = null;
  try { mean = pksMean(v); } catch (e) { mean = null; }
  if (mean == null) return;
  if (PKS.torchHand) return;                          // the packer chose; leave it
  const step = pksLightStep(mean, !!PKS.torch, !!PKS.torchAuto, hasTorch);
  if (step === "on") pksTorchSet(true, true).then((ok) => { if (ok) pksSay("Low light — torch on"); else PKS.hasTorch = false; });
  else if (step === "off") pksTorchSet(false, false);
  else if (!hasTorch && mean < PKS_DARK && !PKS.darkSaid) { PKS.darkSaid = true; pksSay("Too dark to read — move the label into more light", true); }
  else if (mean >= PKS_DARK && PKS.darkSaid) { PKS.darkSaid = false; pksSay("Point at the FNSKU label"); }
}
let PKS_AC = null;
/** good: one short high beep · bad: a low buzz · done: two rising beeps. */
/** iPhone only plays sound from a context started by a tap: woken on the scan screen's taps, and again after sleep. */
function pksAudioWake() {
  try {
    PKS_AC = PKS_AC || new (window.AudioContext || window.webkitAudioContext)();
    if (PKS_AC.state === "suspended" && PKS_AC.resume) PKS_AC.resume();
  } catch (e) {
  }
}
function pksBeep(good, kind) {
  try {
    PKS_AC = PKS_AC || new (window.AudioContext || window.webkitAudioContext)();
    if (PKS_AC.state === "suspended" && PKS_AC.resume) PKS_AC.resume();
    const tone = (f, at, len, type, vol) => {
      const o = PKS_AC.createOscillator(), g = PKS_AC.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.value = vol;
      o.connect(g);
      g.connect(PKS_AC.destination);
      o.start(PKS_AC.currentTime + at);
      o.stop(PKS_AC.currentTime + at + len);
    };
    if (kind === "done") {
      tone(990, 0, 0.1, "sine", 0.12);
      tone(1480, 0.13, 0.16, "sine", 0.12);
    } else if (good) tone(1320, 0, 0.09, "sine", 0.12);
    else tone(180, 0, kind === "again" ? 0.18 : 0.45, "square", 0.2);
  } catch (e) {
  }
  try {
    if (navigator.vibrate) navigator.vibrate(kind === "done" ? [60, 60, 60] : good ? 60 : [200, 80, 200]);
  } catch (e) {
  }
}
function pksFlash(good) {
  const ov = $("pksOv");
  if (!ov) return;
  ov.classList.remove("pks-ok", "pks-bad");
  void ov.offsetWidth;
  ov.classList.add(good ? "pks-ok" : "pks-bad");
}
const pksSay = (t, bad) => {
  const el = $("pksSay");
  if (el) {
    el.textContent = t || "";
    el.classList.toggle("pks-say-bad", !!bad);
  }
};

/* ---- 3. the screen stays on; the camera rests while the app is in the background ---- */
async function pksWake() {
  try {
    if ("wakeLock" in navigator && !PKS.wake && document.visibilityState === "visible") {
      PKS.wake = await navigator.wakeLock.request("screen");
      PKS.wake.addEventListener("release", () => {
        PKS.wake = null;
      });
    }
  } catch (e) {
  }
}
function pksSleep() {
  try {
    if (PKS.wake) PKS.wake.release();
  } catch (e) {
  }
  PKS.wake = null;
}
if (typeof document.addEventListener === "function") document.addEventListener("visibilitychange", () => {
  if (!PKS.on) return;
  if (document.visibilityState === "visible") {
    pksWake();
    if (!PKS.stream) pksCamStart().then(pksFocus);
  } else {
    pksCamStop();
    clearTimeout(PKS.saveT);
    pksSaveNow();
  }
});
if (typeof window.addEventListener === "function") window.addEventListener("online", () => {
  if (PKS.on && PKS.dirty) pksSaveNow();
});
if (typeof window.addEventListener === "function") window.addEventListener("beforeunload", (e) => {
  if (PKS.on && (PKS.dirty || PKS.saving)) {
    pksBackup();
    e.preventDefault();
    e.returnValue = "";
  }
});
/** What a hand scanner typed, as the label says it: without a symbology prefix some scanners add (]C1, ]E0…), control
 * characters, or spaces around it. */
function pksClean(c) {
  return String(c || "").replace(/[\x00-\x1f\x7f]/g, "").trim().replace(/^\][A-Za-z][0-9A-Za-z]/, "").trim();
}
/* A drop-down never takes typing here (19 Oct, laptop scanners): left focused after "Pcs / scan" was changed, it swallowed
 * the scanner's letters — the options jumped and the scan was lost. Text boxes still keep their own keys. */
if (typeof document.addEventListener === "function") document.addEventListener("keydown", (e) => {
  if (!PKS.on) return;
  const t = e.target, tag = t && t.tagName || "";
  if (t && t.id === "pksCode") {
    /* a scanner set to end with Tab finishes the code like Enter */
    if (e.key === "Tab" && t.value.trim().length >= 4) { e.preventDefault(); t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
    return;
  }
  if (/^(INPUT|TEXTAREA)$/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
  const now = Date.now();
  if (now - PKS.keyT > 400) PKS.keyBuf = "";
  PKS.keyT = now;
  if (e.key === "Enter" || (e.key === "Tab" && PKS.keyBuf.trim().length >= 4)) {
    const c = PKS.keyBuf.trim();
    PKS.keyBuf = "";
    if (c.length >= 4) {
      e.preventDefault();
      pksSeenNow(pksClean(c));
      pksHit(pksClean(c), "scanner");
    }
    return;
  }
  if (e.key && e.key.length === 1) {
    PKS.keyBuf += e.key;
    e.preventDefault();
  }
}, true);

/* ---- 2. a piece that must not go in stops the counting until it is put aside ---- */
function pksHit(code, via) {
  if (PKS.mode === "track") return pksTrackHit(code);
  if (PKS.hold) {
    pksBeep(false, "again");
    pksSay('Put the last piece aside first, then tap "Kept aside".', true);
    const k = $("pksAside");
    if (k) {
      k.classList.remove("pks-nudge");
      void k.offsetWidth;
      k.classList.add("pks-nudge");
    }
    return;
  }
  PKS.panel = "";   // a scan closes an open panel: what was scanned is shown
  const r = pksCount(code, via);
  if (!r.ok) {
    PKS.bad = r;
    PKS.hold = r.kind !== "none" && !(r.kind === "unknown" && via === "camera");
    pksBeep(false);
    pksFlash(false);
    pksSay(r.kind === "wrong" ? "Wrong article — not counted" : r.kind === "full" ? "Not counted — the orders want no more of it" : "Not counted — unknown label", true);
    pksDraw();
    return;
  }
  PKS.bad = null;
  const wasDone = PKS.allDone;
  PKS.allDone = pksAllPacked();
  pksFlash(true);
  if (PKS.allDone && !wasDone) {
    pksBeep(true, "done");
    pksSay("Everything on the orders is packed — press Finish");
  } else {
    pksBeep(true);
    pksSay(`+${r.n} ${r.sku}${r.short ? ` — only ${r.n} of ${PKS.per}: the orders want no more` : ""}${r.left != null ? ` · ${nf(r.left)} left on the orders` : ""}`);
  }
  pksDraw();
}
function pksKeptAside() {
  PKS.hold = false;
  PKS.bad = null;
  pksSay("Carry on — scan the next piece");
  pksDraw();
}
/** A list packed against orders, with nothing left to pack. Never true for a free list. */
function pksAllPacked() {
  const p = PKS.p;
  if (!packGuarded(p)) return false;
  const rows = PACK_CORE.leftBySku(pksOrderLines(), p.scan.packed);
  return rows.length > 0 && rows.every((r) => !r.left) && rows.some((r) => r.got > 0);
}

/* ---- THREE WAYS IN (Ravi, 16 Oct: "when I click on scan to pack ... I want it to show three buttons") ----
 *   Track order scan  scan a piece, see which open orders want it, how many are packed and left, and the India Store.
 *                     A look-up: nothing is counted or saved.
 *   Box pack scan     pack freely into boxes — every known label counts (the list has no orders).
 *   Pack by order     pack against Order Console orders and/or an Amazon plan — a wrong article is stopped. */
const PKS_MODES = [
  ["track", "Track order scan", "Scan a piece — see which orders want it and how many are left", "🔍"],
  ["box", "Box pack scan", "Pack pieces into boxes — every known label counts", "📦"],
  ["order", "Pack by order scan", "Pack against orders or an Amazon plan — a wrong piece is stopped", "🧾"]
];
async function pksOpen() {
  if (PKS.on) return;
  ptOpenDialog({
    title: "Scan",
    html: `<div class="pks-choose">${PKS_MODES.map(([k, t, d, ic]) => `<button type="button" class="pks-mode" data-pks-mode="${k}"><span class="pks-mode-ic" aria-hidden="true">${ic}</span><span><b>${t}</b><small>${d}</small></span></button>`).join("")}</div>`
  });
  $("ptDlgBody").onclick = (e) => {
    const b = e.target.closest("[data-pks-mode]");
    if (!b) return;
    $("ptDlgBody").onclick = null;
    ptDlgClose();
    pksStart(b.dataset.pksMode).catch((err) => pkMsg("Scan could not start: " + (err.message || err), true));
  };
}
async function pksStart(mode) {
  await Promise.all([loadPkWt(), PK_LOADED ? null : loadPk().catch(() => {
  }), fnLoad(), typeof ptImgShared === "function" ? ptImgShared().catch(() => {
  }) : null]);
  if (pksQcMay()) pksQcReady().then((ok) => { if (ok && PKS.on) { if (PKS.mode === "track") pksTrackDraw(); else if (!PKS.panel) pksDraw(); } });
  if (mode === "track") return pksTrackOpen();
  const byOrder = mode === "order";
  /* Each way offers only its own lists: a box list never turns into an order list half way, nor the other way round. */
  const open = PK.filter((p) => p.status !== "done" && packGuarded(p) === byOrder);
  /* A list with scans only on this phone is said so in the picker, and picked for you. */
  const kept = open.filter((p) => pksBackupOf(p.id));
  ptOpenDialog({
    title: byOrder ? "Pack by order scan" : "Box pack scan",
    subtitle: byOrder ? "Only what the orders still want counts; a wrong article stops the scanner." : "Every known label counts into the open box.",
    html: `<div class="ptgrid" style="grid-template-columns:1fr">
      ${kept.length ? `<div class="pks-keptnote">Scans not yet saved are kept on this phone for: <b>${kept.map((p) => esc(p.title || "(untitled)")).join(", ")}</b>. Open the list to save them.</div>` : ""}
      <label>Packing list<select id="pksPick">
        <option value="">+ A new packing list</option>
        ${open.map((p) => `<option value="${esc(p.id)}"${kept[0] && kept[0].id === p.id ? " selected" : ""}>${esc((p.title || "(untitled)") + " · " + (p.date || "") + " · " + pkTotals(p).boxes + " box(es)" + (byOrder ? " · " + (p.scan.orders || []).join(", ") + (p.scan.planNo ? " + plan" : "") : "") + (pksBackupOf(p.id) ? " · unsaved scans on this phone" : ""))}</option>`).join("")}
      </select></label>
      <label>Title (a new list)<input id="pksTitle" value="Scan ${esc(pkToday())}"></label>
      <label>FBA account (a new list)<input id="pksAcc" list="pksAccs" placeholder="${esc(FGI_FBA_ACCOUNTS.join(" / "))}"><datalist id="pksAccs">${[...new Set(FGI_FBA_ACCOUNTS.concat(PK.map((p) => p.account).filter(Boolean)))].map((a) => `<option value="${esc(a)}">`).join("")}</datalist></label>
      ${byOrder ? `<label>Orders (a new list)<input id="pksOrds" placeholder="Order Console order numbers, comma separated"></label>
      <label>Amazon shipment plan (a new list — instead of, or as well as, orders)<textarea id="pksPlan" rows="3" placeholder="Paste the Send to Amazon list — a SKU column and a Quantity column"></textarea></label>` : ""}
      <div class="muted" style="font-size:12px">FNSKU list: ${(FN.map || /* @__PURE__ */ new Map()).size.toLocaleString("en-US")} codes. A label not on it is never counted — refresh it in Finished Goods → FNSKU list.</div>
    </div>`,
    saveLabel: "Start scanning",
    onSave: async () => {
      const id = $("pksPick").value;
      if (!id && byOrder && !($("pksOrds").value.trim() || $("pksPlan").value.trim()))
        return "Enter the order numbers or paste an Amazon plan — or use Box pack scan to pack without orders.";
      PKS.restored = 0;
      if (id) {
        const server = PK.find((p) => p.id === id), bk = pksBackupOf(id);
        /* What this phone holds is newer than what the server has — the server only ever gets it from here. */
        PKS.p = JSON.parse(JSON.stringify(bk && bk.p || server));
        if (bk) PKS.restored = Math.max(0, pksQty(bk.p) - pksQty(server));
        if (packGuarded(PKS.p)) {
          const why = await packDataReady();
          if (why) return "This list packs against orders, and the orders could not be read: " + why;
        }
      } else {
        const ords = ($("pksOrds") ? $("pksOrds").value : "").split(/[,;\s]+/).map(obUC).filter(Boolean);
        const planTxt = ($("pksPlan") ? $("pksPlan").value : "").trim();
        let scan = null;
        if (ords.length || planTxt) {
          const why = await packDataReady();
          if (why) return "Could not read the orders and the Finished Goods ledger: " + why;
          const bad = packOrdersUnknown(ords);
          if (bad.length) return "Not in the Order Console: " + bad.join(", ");
          let plan = [], planNo = "";
          if (planTxt) {
            const pp = PACK_CORE.planParse(planTxt);
            if (!pp.lines.length) return pp.why;
            const unk = pp.lines.filter((l) => !pksResolve(l.sku).sku).map((l) => l.sku);
            if (unk.length) return "Not a SKU this app knows: " + unk.join(", ");
            plan = pp.lines;
            planNo = "FBA-PLAN-" + Date.now().toString(36).toUpperCase();
          }
          scan = packScanNew(ords, plan, planNo, "");
        }
        PKS.p = Object.assign({
          id: pkId(),
          date: pkToday(),
          invoice: "",
          title: ($("pksTitle").value || "").trim() || "Scan " + pkToday(),
          account: ($("pksAcc").value || "").trim(),
          status: "progress",
          pkgWt: 0.5,
          volDiv: 5e3,
          boxes: [],
          by: ME.email || "",
          src: "scan"
        }, scan ? { scan } : {});
        try {
          await savePkOne(PKS.p);
        } catch (e) {
          return "Could not create the list: " + (e.message || e);
        }
      }
      const used = (PKS.p.boxes || []).filter((b) => (b.items || []).length).map((b) => +b.n);
      const bk = id ? pksBackupOf(id) : null;
      PKS.box = bk && bk.box ? +bk.box : used.length ? Math.max(...used) : 1;
      PKS.hist = pksHistOf(PKS.p.id);      // Undo carries on where it stopped on this phone
      PKS.last = null;
      PKS.seen = null;
      PKS.bad = null;
      PKS.hold = false;
      PKS.err = "";
      PKS.allDone = pksAllPacked();
      if (bk) {
        PKS.dirty = true;
        pksSaveSoon(0);
      }
      setTimeout(pksShow, 0);
      return "";
    }
  });
}
/* ---- TRACK ORDER SCAN: a piece → which orders want it. A look-up — nothing is counted, nothing is saved. ---- */
/** Every Order Console line and every Amazon plan line (on an open list) for this SKU: what it wants, what is packed. */
function pksWhoWants(sku) {
  const k = obUC(sku), packedOf = (no) => PK.reduce((s, p) => s + pkNum(((p.scan && p.scan.packed || {})[k] || {})[no]), 0);
  const seen = new Set(), out = [];
  (typeof ordLines === "function" ? ordLines() : []).forEach((l) => {
    if (obUC(l.sku) !== k || !l.orderNo || seen.has(l.orderNo)) return;
    seen.add(l.orderNo);
    const got = packedOf(l.orderNo), qty = pkNum(l.qty);
    out.push({ no: l.orderNo, what: "Order", qty, got, left: Math.max(0, qty - got) });
  });
  PK.filter((p) => p.status !== "done" && p.scan && p.scan.planNo).forEach((p) => (p.scan.plan || []).forEach((l) => {
    if (obUC(l.sku) !== k) return;
    const got = packedOf(p.scan.planNo), qty = pkNum(l.qty);
    out.push({ no: p.title || p.scan.planNo, what: "Amazon plan", qty, got, left: Math.max(0, qty - got) });
  }));
  return out.sort((a, b) => (b.left > 0) - (a.left > 0) || String(a.no).localeCompare(String(b.no)));
}
async function pksTrackOpen() {
  const why = await packDataReady();
  if (why) {
    pkMsg("Track order scan could not read the orders: " + why, true);
    return;
  }
  PKS.mode = "track";
  PKS.p = null;
  PKS.hold = false;
  PKS.seen = null;
  PKS.track = { last: null, recent: [] };
  let ov = $("pksOv");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "pksOv";
    document.body.appendChild(ov);
  }
  ov.className = "pks pks-trackmode";
  ov.innerHTML = `
    <div class="pks-top">
      <div class="pks-title"><div class="pks-kick">Track order scan · look-up only</div><b>Which order wants it?</b><div class="pks-sub">Scan a piece. Nothing is counted or saved here.</div></div>
      <button class="pks-x" id="pksClose">Close</button></div>
    <div class="pks-cam"><video id="pksVid" playsinline muted></video>
      <div class="pks-guide"><i></i><i></i><i></i><i></i></div>
      <button id="pksTorch" class="pks-mini hide" aria-label="Torch">💡</button></div>
    <div id="pksSay" class="pks-say">Opening the camera…</div>
    <div id="pksCard"></div>
    <div class="pks-type"><input id="pksCode" placeholder="Hand scanner / type the FNSKU and press Enter" autocomplete="off" autocapitalize="characters"><button id="pksGo" class="pks-ghost">Find</button></div>
    <div id="pksBox"></div>`;
  PKS.on = true;
  $("pksClose").onclick = () => {
    pksEnd();
    PKS.mode = "";
  };
  const go = () => {
    const c = $("pksCode").value.trim();
    if (c) {
      pksSeenNow(pksClean(c));
      pksHit(pksClean(c), "typed");
    }
    $("pksCode").value = "";
  };
  $("pksGo").onclick = go;
  $("pksCode").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      go();
    }
  };
  $("pksTorch").onclick = async () => {
    try {
      PKS.torchHand = true; await pksTorchSet(!PKS.torch, false);
    } catch (e) {
    }
  };
  $("pksBox").onclick = (e) => {
    const r = e.target.closest("[data-pks-again]");
    if (r) {
      const sku = r.dataset.pksAgain, left = pksWhoWants(sku).reduce((s, x) => s + x.left, 0);
      PKS.track.last = { sku };
      pksSay(left ? `${sku} — open orders want ${nf(left)} more` : `${sku} — no open order wants it`, !left);
      pksTrackDraw();
    }
  };
  pksTrackDraw();
  pksWake();
  pksCamStart().then(pksFocus);
}
function pksTrackHit(code) {
  const r = pksResolve(code);
  if (!r.sku) {
    PKS.track.last = { bad: obUC(code) };
    pksBeep(false);
    pksFlash(false);
    pksSay("Unknown label — not on the FNSKU list", true);
    pksTrackDraw();
    return;
  }
  PKS.track.last = { sku: r.sku };
  PKS.track.recent = [r.sku].concat(PKS.track.recent.filter((s) => s !== r.sku)).slice(0, 8);
  const left = pksWhoWants(r.sku).reduce((s, x) => s + x.left, 0);
  pksBeep(true);
  pksFlash(true);
  pksSay(left ? `${r.sku} — open orders want ${nf(left)} more` : `${r.sku} — no open order wants it`, !left);
  pksTrackDraw();
}
function pksTrackDraw() {
  if (!PKS.on || PKS.mode !== "track") return;
  const L = PKS.track.last, card = $("pksCard");
  if (!L) card.innerHTML = '<div class="pks-empty">Scan a piece to see which orders want it.</div>';
  else if (L.bad) card.innerHTML = `<div class="pks-badcard"><div class="pks-badicon">✕</div><div class="pks-big">Unknown label</div><div class="pks-code">${esc(L.bad)}</div>
      <div class="pks-sub">Not on the FNSKU list, and not a SKU this app knows. Check the label.</div></div>`;
  else {
    const sku = L.sku, info = pkLookupSku(sku) || {}, img = pksImg(sku), rows = pksWhoWants(sku);
    const left = rows.reduce((s, x) => s + x.left, 0), store = fgiOf(sku).current;
    card.innerHTML = `<div class="pks-prod">
      ${img ? `<img class="pks-img pks-img-sm" src="${esc(img)}" alt="">` : '<div class="pks-noimg">No picture for this SKU</div>'}
      <div class="pks-sku">${esc(sku)}</div>
      <div class="pks-desc">${esc(info.desc || "")}</div>
      <div class="pks-want${left ? "" : " pks-want-none"}"><b>${nf(left)}</b> ${left ? "more wanted by open orders" : "— no open order wants this piece"}</div>
      <div class="pks-facts"><span>India Store <b>${nf(store)}</b></span>${left && store < left ? `<span class="pks-warn">${nf(left - store)} short in the store</span>` : ""}</div>
      ${pksQcHtml(sku, pksQcWaiting(sku).pcs, "Accept {n} into Finished Goods")}
      ${rows.length ? `<div class="pks-wtab">${rows.map((x) => `<div class="pks-wrow${x.left ? "" : " pks-wrow-done"}"><span><b>${esc(x.no)}</b><small>${esc(x.what)}</small></span><span>wants ${nf(x.qty)}</span><span>packed ${nf(x.got)}</span><span class="pks-wleft">${x.left ? nf(x.left) + " left" : "✓ done"}</span></div>`).join("")}</div>` : ""}
    </div>`;
  }
  const recent = PKS.track.recent.filter((s) => !L || s !== L.sku);
  $("pksBox").innerHTML = recent.length ? `<div class="pks-list-h">Scanned just now</div>` + recent.map((s) => {
    const u = pksImg(s), left = pksWhoWants(s).reduce((t, x) => t + x.left, 0);
    return `<div class="pks-row" data-pks-again="${esc(s)}">${u ? `<img src="${esc(u)}" alt="">` : '<span class="pks-ph"></span>'}<div><b>${esc(s)}</b><div class="pks-sub">${left ? nf(left) + " wanted" : "no open order"}</div></div></div>`;
  }).join("") : "";
}

function pksShow() {
  PKS.mode = "pack";
  PKS.panel = "";
  let ov = $("pksOv");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "pksOv";
    document.body.appendChild(ov);
  }
  ov.className = "pks";
  ov.innerHTML = `
    <div class="pks-top">
      <div class="pks-title"><div class="pks-kick">Scan to pack · <span id="pksSaved" class="pks-saved"></span></div><b id="pksHead"></b><div id="pksSub" class="pks-sub"></div></div>
      <button class="pks-x" id="pksClose">Finish</button></div>
    <div id="pksProg" class="pks-prog hide"><div class="pks-prog-bar"><i id="pksProgFill"></i></div><span id="pksProgTxt"></span></div>
    <div id="pksBoxes" class="pks-boxes"></div>
    <div class="pks-cam"><video id="pksVid" playsinline muted></video>
      <div class="pks-guide"><i></i><i></i><i></i><i></i></div>
      <div id="pksPaused" class="pks-paused hide">Paused — tap Kept aside</div>
      <button id="pksTorch" class="pks-mini hide" aria-label="Torch">💡</button></div>
    <div id="pksSay" class="pks-say">Opening the camera…</div>
    <div id="pksErr" class="pks-err hide"></div>
    <div id="pksCard"></div>
    <div class="pks-ctl">
      <button id="pksUndo" class="pks-ghost">↶ Undo</button>
      <label class="pks-per">Pcs / scan <select id="pksPer">${[1, 2, 3, 4, 5, 6, 10, 12, 20, 24].map((n) => `<option${n === PKS.per ? " selected" : ""}>${n}</option>`).join("")}</select></label>
      <button id="pksNext">Box done → next</button></div>
    <div class="pks-type"><input id="pksCode" placeholder="Hand scanner / type the FNSKU and press Enter" autocomplete="off" autocapitalize="characters"><button id="pksGo" class="pks-ghost">Add</button></div>
    <div id="pksBox"></div>`;
  PKS.on = true;
  pksAudioWake();
  ov.addEventListener("pointerdown", pksAudioWake);
  $("pksClose").onclick = pksFinishAsk;
  $("pksUndo").onclick = () => {
    if (PKS.hold) return pksSay('Tap "Kept aside" first.', true);
    const h = pksUndo();
    PKS.allDone = pksAllPacked();
    pksSay(h ? `Undone: −${h.n} ${h.sku} (box ${h.box})` : "Nothing to undo.");
    pksDraw();
  };
  $("pksPer").onchange = () => {
    PKS.per = Math.max(1, +$("pksPer").value || 1); $("pksPer").blur();
  };
  $("pksNext").onclick = pksNextAsk;
  const go = () => {
    const c = $("pksCode").value.trim();
    if (c) {
      pksSeenNow(pksClean(c));
      pksHit(pksClean(c), "typed");
    }
    $("pksCode").value = "";
  };
  $("pksGo").onclick = go;
  $("pksCode").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      go();
    }
  };
  $("pksTorch").onclick = async () => {
    try {
      PKS.torchHand = true; await pksTorchSet(!PKS.torch, false);
    } catch (e) {
    }
  };
  /* One listener each for the box chips, the lines and the cards — they are redrawn on every scan. */
  $("pksBoxes").onclick = (e) => {
    const c = e.target.closest("[data-pks-box]");
    if (!c || PKS.hold) return;
    pksGoBox(c.dataset.pksBox);
  };
  $("pksBox").onclick = (e) => {
    const m = e.target.closest("[data-pks-minus]"), d = e.target.closest("[data-pks-del]");
    if (PKS.hold && (m || d)) return pksSay('Tap "Kept aside" first.', true);
    if (m) {
      pksTake(m.dataset.pksMinus, 1);
      pksSay(`−1 ${m.dataset.pksMinus} (box ${PKS.box})`);
      pksDraw();
    }
    if (d) {
      const sku = d.dataset.pksDel, it = PACK_CORE.itemOf(pksBoxOf(PKS.p, PKS.box), sku);
      if (!it || !confirm(`Take all ${pkNum(it.qty)} of ${sku} out of box ${PKS.box}?`)) return;
      const n = pksTake(sku, pkNum(it.qty));
      pksSay(`Removed ${n} ${sku} from box ${PKS.box}`);
      pksDraw();
    }
  };
  $("pksCard").onclick = (e) => {
    if (e.target.closest("#pksAside")) pksKeptAside();
  };
  const back = () => PKS.restored && pksSay(`${nf(PKS.restored)} piece(s) brought back from this phone — saved`);
  back();
  pksDraw();
  pksWake();
  /* the camera writes its own line when it opens; the restore note is said again after it */
  pksCamStart().then(() => {
    pksFocus();
    back();
    PKS.restored = 0;
  });
}
function pksNextAsk() {
  if (PKS.hold) return pksSay('Tap "Kept aside" first.', true);
  const b = pksBoxOf(PKS.p, PKS.box), q = (b.items || []).reduce((s, x) => s + pkNum(x.qty), 0);
  if (!q) {
    pksSay("This box is empty — scan something into it first.", true);
    return;
  }
  const card = $("pksCard");
  PKS.panel = "dims";
  card.innerHTML = `<div class="pks-dims"><div class="pks-big">Box ${b.n} done — ${q} pcs</div>
    <div class="pks-sub">Size and weight now (optional — they can be filled in on the computer later)</div>
    <div class="pks-dimrow"><input id="pksL" inputmode="decimal" placeholder="L cm" value="${esc(b.L || "")}"><input id="pksW" inputmode="decimal" placeholder="W cm" value="${esc(b.W || "")}">
      <input id="pksH" inputmode="decimal" placeholder="H cm" value="${esc(b.H || "")}"><input id="pksG" inputmode="decimal" placeholder="Gross kg" value="${esc(b.grossWtOverride || "")}"></div>
    <div class="pks-dimrow"><button id="pksDimOk">Start box ${Math.max(...(PKS.p.boxes || []).map((x) => +x.n), PKS.box) + 1}</button><button id="pksDimNo" class="pks-ghost">Back to box ${b.n}</button></div></div>`;
  $("pksDimOk").onclick = () => {
    PKS.panel = "";
    pksNextBox({ L: $("pksL").value, W: $("pksW").value, H: $("pksH").value, gross: $("pksG").value });
    pksSay(`Box ${PKS.box} open — scan its first piece`);
    PKS.last = null;
    pksDraw();
  };
  $("pksDimNo").onclick = () => {
    PKS.panel = "";
    pksDraw();
  };
}
function pksDraw() {
  if (!PKS.on || !PKS.p) return;
  const p = PKS.p, b = pksBoxOf(p, PKS.box), t = pkTotals(Object.assign({}, p, { boxes: (p.boxes || []).filter((x) => (x.items || []).length) }));
  const boxQty = (b.items || []).reduce((s, x) => s + pkNum(x.qty), 0);
  $("pksHead").textContent = `Box ${b.n} · ${boxQty} pcs`;
  $("pksSub").textContent = `${p.title || ""} · ${t.boxes} box(es) · ${t.qty} pcs in all`;
  pksSavedMark();
  const er = $("pksErr");
  er.classList.toggle("hide", !PKS.err);
  er.textContent = PKS.err;
  $("pksPaused").classList.toggle("hide", !PKS.hold);
  $("pksOv").classList.toggle("pks-holding", !!PKS.hold);
  /* how far the orders are: a bar, for a list packed against orders */
  const guarded = packGuarded(p), rows = guarded ? PACK_CORE.leftBySku(pksOrderLines(), p.scan.packed) : [];
  const want = rows.reduce((s, r) => s + r.got + r.left, 0), got = rows.reduce((s, r) => s + r.got, 0);
  $("pksProg").classList.toggle("hide", !guarded);
  if (guarded) {
    $("pksProgFill").style.width = (want ? Math.round(got / want * 100) : 0) + "%";
    $("pksProgTxt").textContent = `${nf(got)} of ${nf(want)} packed`;
    $("pksProg").classList.toggle("pks-prog-done", PKS.allDone);
  }
  /* every box, so an earlier one can be opened again */
  const boxes = (p.boxes || []).filter((x) => (x.items || []).length || +x.n === +PKS.box);
  $("pksBoxes").innerHTML = boxes.length > 1 || boxes.some((x) => +x.n !== 1) ? boxes.map((x) => `<button class="pks-chip${+x.n === +PKS.box ? " on" : ""}" data-pks-box="${x.n}">Box ${x.n} <b>${PACK_CORE.boxQty(x)}</b></button>`).join("") : "";
  const card = $("pksCard");
  if (PKS.panel) {
    /* the Box done / Finish panel stays as it is */
  } else if (PKS.bad) {
    const k = PKS.bad.kind, title = k === "wrong" ? "Wrong article" : k === "full" ? "Not counted — orders want no more" : "Not counted — unknown label";
    const img = k === "wrong" || k === "full" ? pksImg(PKS.bad.sku) : "";
    card.innerHTML = `<div class="pks-badcard${k === "full" ? " pks-fullcard" : ""}"><div class="pks-badicon">${k === "full" ? "■" : "✕"}</div><div class="pks-big">${title}</div><div class="pks-code">${esc(PKS.bad.sku || PKS.bad.code)}</div>
      ${img ? `<img class="pks-img pks-img-sm" src="${esc(img)}" alt="">` : ""}
      <div class="pks-sub">${esc(PKS.bad.why)} ${k === "unknown" ? "Check its label." : "Do not put it in the box."}</div>
      ${k === "full" && PKS.bad.store ? pksQcHtml(PKS.bad.sku, pksOrdersWant(PKS.bad.sku) || PKS.per, "Accept {n} from QC and count this piece") : ""}
      ${PKS.hold ? '<button id="pksAside" class="pks-aside">✓ Kept aside — carry on</button>' : ""}</div>`;
  } else if (PKS.allDone) {
    card.innerHTML = `<div class="pks-donecard"><div class="pks-badicon">✓</div><div class="pks-big">Everything on the orders is packed</div>
      <div class="pks-sub">${nf(t.qty)} pcs in ${nf(t.boxes)} box(es). Press Finish to write the Send to FBA rows.</div></div>`;
  } else if (PKS.last) {
    const sku = PKS.last.sku, it = (b.items || []).find((x) => obUC(x.sku) === sku) || {}, info = pkLookupSku(sku) || {}, img = pksImg(sku);
    card.innerHTML = `<div class="pks-prod">
      ${img ? `<img class="pks-img" src="${esc(img)}" alt="">` : '<div class="pks-noimg">No picture for this SKU — check the product by its label</div>'}
      <div class="pks-sku">${esc(sku)}</div>
      <div class="pks-desc">${esc(it.desc || info.desc || "")}</div>
      <div class="pks-facts"><span>Size <b>${esc(it.size || info.size || "—")}</b></span><span>${esc(it.material || info.material || "")}</span>
        <span>${pkNum(it.perPcsWt) ? pkNum(it.perPcsWt).toFixed(2) + " kg/pc" : '<b class="pks-warn">no weight</b>'}</span></div>
      <div class="pks-count">${pkNum(it.qty)} <small>in box ${b.n}</small></div>
      ${PKS.last.left != null ? `<div class="pks-facts"><span>The orders still want <b>${nf(PKS.last.left)}</b> of this SKU</span></div>` : ""}</div>`;
  } else card.innerHTML = `<div class="pks-empty">Box ${b.n} is open. Scan the first piece.</div>`;
  $("pksBox").innerHTML = `<div class="pks-list-h">In box ${b.n}</div>` + ((b.items || []).slice().reverse().map((x) => {
    const u = pksImg(x.sku);
    return `<div class="pks-row">${u ? `<img src="${esc(u)}" alt="">` : '<span class="pks-ph"></span>'}<div><b>${esc(x.sku)}</b><div class="pks-sub">${esc(x.desc || "")}</div></div><div class="pks-q">${pkNum(x.qty)}</div>
      <div class="pks-fix"><button class="pks-ghost" data-pks-minus="${esc(x.sku)}" aria-label="One less ${esc(x.sku)}">−1</button><button class="pks-ghost pks-del" data-pks-del="${esc(x.sku)}" aria-label="Remove ${esc(x.sku)}">✕</button></div></div>`;
  }).join("") || '<div class="pks-sub">Nothing yet.</div>') + pksOrdersHtml(p);
}
function pksOrdersHtml(p) {
  if (!packGuarded(p)) return "";
  const rows = PACK_CORE.leftBySku(pksOrderLines(), p.scan.packed);
  const wrong = (p.scan.wrong || []).length;
  return `<div class="pks-list-h">Orders ${esc((p.scan.orders || []).join(", "))}${p.scan.planNo ? (p.scan.orders.length ? " + " : "") + "Amazon plan" : ""} — left to pack${wrong ? ` · <span class="pks-warn">${nf(wrong)} wrong article scan(s)</span>` : ""}</div>` + (rows.length ? rows.map((r) => `<div class="pks-row pks-row-ord${r.left ? "" : " pks-row-done"}"><div><b>${esc(r.sku)}</b><div class="pks-sub">packed ${nf(r.got)} of ${nf(r.qty)}</div></div><div class="pks-q">${r.left ? nf(r.left) : "✓"}</div></div>`).join("") : '<div class="pks-sub">The orders have no pieces of their SKUs in the India Store — receive them in Finished Goods first.</div>');
}
/* ---- PIECES STILL WAITING IN QC (Ravi, 19 Oct: "if the product is still in QC according to the site and the scanner is
 * scanning the product, give the function of approving it so that it can be accepted to finished goods") ----
 * A piece in the packer's hand can still be on the books as "passed QC, not in India stock yet" (Finished Goods → From QC
 * — to accept). Then Finish refuses ("not enough stock") and Pack by order stops it. The scanner now says how many are
 * waiting and, for whoever may accept on the Finished Goods screen (flowMayFg), accepts them right here — the same
 * accept as that screen (flowFgAccept: a RECEIVE row in the India store, "Received from: QC", logged) — and carries on.
 * Test orders are left to the Finished Goods screen. */
const pksQcOn = () => typeof FLOW_ON !== "undefined" && FLOW_ON && typeof flowFgLines === "function" && typeof flowFgAccept === "function";
const pksQcMay = () => pksQcOn() && typeof flowMayFg === "function" && flowMayFg();
async function pksQcReady() {
  if (!pksQcOn()) return false;
  try {
    const w = typeof flowFgEnsure === "function" ? flowFgEnsure() : null;
    if (w) await w;
  } catch (e) {
    return false;
  }
  return true;
}
/** What of this SKU passed QC and is not in India stock yet: the pieces, and the order lines they sit on. */
let PKS_QC_C = { at: 0, fgi: null, all: [] };     // worked out at most every 3 s (or when the stock changes), not on every scan
function pksQcWaiting(sku) {
  if (!pksQcOn() || typeof FLOW === "undefined" || !FLOW.ppc || typeof QC === "undefined" || QC.checks == null) return { pcs: 0, lines: [] };
  const fgi = typeof FGI !== "undefined" ? FGI.rows : null;
  if (Date.now() - PKS_QC_C.at > 3000 || PKS_QC_C.fgi !== fgi) {
    let all = [];
    try {
      all = flowFgLines().filter((x) => !x.r.__t);
    } catch (e) {
      all = [];
    }
    PKS_QC_C = { at: Date.now(), fgi, all };
  }
  const lines = PKS_QC_C.all.filter((x) => obUC(x.r.sku) === obUC(sku));
  return { pcs: lines.reduce((s, x) => s + flowFgToAccept(x.r, x.s), 0), lines };
}
/** Accept up to `want` pieces of this SKU from QC into the India store, line by line. */
async function pksQcAccept(sku, want) {
  let left = want, got = 0;
  for (const x of pksQcWaiting(sku).lines) {
    if (left <= 0) break;
    const n = Math.min(left, flowFgToAccept(x.r, x.s));
    if (n <= 0) continue;
    const err = await flowFgAccept(x, n, "accepted from Scan to pack");
    if (err) return { got, err };
    got += n;
    left -= n;
  }
  return { got, err: "" };
}
/** How many more of this SKU the list's orders want (Pack by order). */
function pksOrdersWant(sku) {
  const p = PKS.p;
  if (!p || !packGuarded(p)) return 0;
  const r = PACK_CORE.leftBySku(pksOrderLines(), p.scan.packed).find((x) => obUC(x.sku) === obUC(sku));
  return r ? Math.max(0, (+r.qty || 0) - (+r.got || 0)) : 0;
}
/** The SKUs on this list that the India store holds fewer of than are packed. */
function pksShort(p) {
  const need = new Map();
  (p.boxes || []).forEach((b) => (b.items || []).forEach((it) => need.set(obUC(it.sku), (need.get(obUC(it.sku)) || 0) + pkNum(it.qty))));
  return [...need].map(([sku, qty]) => ({ sku, qty, have: Math.max(0, +fgiOf(sku).current || 0) })).filter((r) => r.qty > r.have);
}
/** One line under a refusal: how many wait in QC, and the button to accept them. */
function pksQcHtml(sku, want, label) {
  const w = pksQcWaiting(sku);
  if (!w.pcs) return "";
  const n = Math.min(w.pcs, want);
  return `<div class="pks-qcrow" style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#dcfce7;border:1px solid #86efac;color:#14532d;text-align:left">
    <div style="margin:0 0 8px;font-size:14px;line-height:1.35;color:#14532d"><b>${nf(w.pcs)}</b> of ${esc(sku)} passed QC and ${w.pcs === 1 ? "is" : "are"} waiting to be accepted into Finished Goods.${w.pcs < want ? ` That covers ${nf(w.pcs)} of the ${nf(want)} needed.` : ""}</div>
    ${pksQcMay() ? `<button type="button" data-pks-qc="${esc(sku)}" data-pks-qcn="${n}" style="width:100%">${esc(label.replace("{n}", nf(n)))}</button>`
      : '<div style="margin:0;font-size:13px;color:#14532d">Ask the Finished Goods team to accept them (Finished Goods → From QC — to accept).</div>'}</div>`;
}
/** Done refused for stock: say what waits in QC under the Finish panel, with Accept buttons. */
async function pksQcOffer() {
  const p = PKS.p;
  if (!p || !(await pksQcReady()) || PKS.panel !== "finish") return;
  const box = document.querySelector("#pksCard .pks-dims");
  if (!box) return;
  const shorts = pksShort(p), all = shorts.every((r) => pksQcWaiting(r.sku).pcs >= r.qty - r.have);
  const html = shorts.map((r) => pksQcHtml(r.sku, r.qty - r.have, all && shorts.length === 1 ? "Accept {n} from QC and finish" : "Accept {n} from QC")).join("");
  let el = $("pksQcBox");
  if (!el) { el = document.createElement("div"); el.id = "pksQcBox"; box.appendChild(el); }
  el.innerHTML = html;
}
/** Accept pressed: under the Finish panel (then Done again once nothing is short), on a refused piece (then it counts),
 * or on the Track card (then the card shows the new stock). */
async function pksQcPress(btn) {
  const sku = btn.dataset.pksQc, n = +btn.dataset.pksQcn || 0;
  if (!sku || !(n > 0) || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "Accepting…";
  const r = await pksQcAccept(sku, n);
  if (r.err) {
    btn.disabled = false;
    btn.textContent = "Try again";
    pksSay((r.got ? `${nf(r.got)} accepted, then: ` : "Not accepted: ") + r.err, true);
    return;
  }
  pksBeep(true);
  pksSay(`${nf(r.got)} of ${sku} accepted from QC into Finished Goods — India stock`);
  if (PKS.mode === "track") return pksTrackDraw();
  if (PKS.panel === "finish") {
    if (!pksShort(PKS.p).length) return pksDone();       // nothing short any more: finish, as was asked
    return pksQcOffer();
  }
  if (PKS.bad && PKS.bad.kind === "full" && PKS.bad.store) {   // the refused piece: now there is stock for it
    const code = PKS.bad.code;
    PKS.hold = false;
    PKS.bad = null;
    pksSeenNow(code);     // the label is still in front of the camera: this one count is its count
    pksHit(code, "qc");
  }
}
if (typeof document.addEventListener === "function") document.addEventListener("click", (e) => {
  const b = PKS.on && e.target && e.target.closest && e.target.closest("[data-pks-qc]");
  if (b) { e.preventDefault(); pksQcPress(b); }
});
function pksFinishAsk() {
  if (PKS.hold) return pksSay('Tap "Kept aside" first.', true);
  const p = PKS.p, card = $("pksCard");
  if (!p || !card) return;
  const t = pkTotals(Object.assign({}, p, { boxes: (p.boxes || []).filter((x) => (x.items || []).length) }));
  const done = !!(p.scan && (p.scan.ledgerIds || []).length), accOk = FGI_FBA_ACCOUNTS.indexOf(p.account) >= 0;
  const rows = packGuarded(p) ? PACK_CORE.leftBySku(pksOrderLines(), p.scan.packed) : [], left = rows.reduce((s, r) => s + r.left, 0);
  PKS.panel = "finish";
  card.innerHTML = `<div class="pks-dims"><div class="pks-big">Finish — ${nf(t.qty)} pcs in ${nf(t.boxes)} box(es)</div>
    ${left ? `<div class="pks-sub pks-warn">The orders still want ${nf(left)} pc(s). Done now sends only what is packed.</div>` : ""}
    ${done ? `<div class="pks-sub">The Send to FBA rows for this list are already written (${nf(p.scan.ledgerIds.length)}). Pause just closes.</div>` : `<div class="pks-sub">Done writes one Send to FBA row per SKU into Finished Goods, so nothing is typed twice; the FBA Dispatch tab then has them. Pause keeps the list to carry on later.</div>
    ${accOk ? "" : `<div class="pks-dimrow"><select id="pksDoneAcc"><option value="">FBA account…</option>${FGI_FBA_ACCOUNTS.map((a) => `<option${a === p.account ? " selected" : ""}>${esc(a)}</option>`).join("")}</select></div>`}
    <div class="pks-dimrow"><input id="pksDoneHand" placeholder="Handed over to (optional)" value="${esc(p.scan && p.scan.handoverTo || "")}"></div>`}
    <div class="pks-dimrow"><button id="pksPause" class="pks-ghost">Pause — carry on later</button>${done ? "" : '<button id="pksDoneBtn">Done — write Send to FBA</button>'}<button id="pksFinNo" class="pks-ghost">Back</button></div></div>`;
  $("pksPause").onclick = () => pksClose();
  $("pksFinNo").onclick = () => {
    PKS.panel = "";
    pksDraw();
  };
  if (!done) $("pksDoneBtn").onclick = (e) => {
    /* ONE TAP, ONE WRITE (21 Oct): a second tap while the first was still writing wrote the Send to FBA rows twice */
    const b = e && e.currentTarget; if (PKS.doneBusy) return;
    if (b) b.disabled = true;
    pksDone().finally(() => { if (b && b.isConnected) b.disabled = false; });
  };
}
async function pksDone() {
  const p = PKS.p;
  if (!p || PKS.doneBusy) return;
  PKS.doneBusy = true;
  try { await pksDoneRun(p); } finally { PKS.doneBusy = false; }
}
async function pksDoneRun(p) {
  const acc = $("pksDoneAcc") ? $("pksDoneAcc").value : p.account;
  if (FGI_FBA_ACCOUNTS.indexOf(acc) < 0) {
    pksSay("Pick the FBA account — " + FGI_FBA_ACCOUNTS.join(" or ") + ".", true);
    return;
  }
  p.account = acc;
  const hand = $("pksDoneHand") ? $("pksDoneHand").value : "";
  pksSay("Writing the Send to FBA rows…");
  let res;
  try {
    res = await packLedgerWrite(p, hand);
  } catch (e) {
    res = { err: e.message || String(e) };
  }
  if (res.err) {
    pksSay("Not done — " + res.err, true);
    pksQcOffer();
    return;
  }
  PKS.dirty = true;
  clearTimeout(PKS.saveT);
  pksBackup();
  await pksSaveNow();
  if (PKS.err) {
    pksSay("The rows are written, but the list did not save — " + PKS.err + " Press Finish → Done again: nothing is written twice.", true);
    return;
  }
  pksHistClear(p.id);     // the list is sent: nothing left to undo
  pksEnd();
  if (typeof renderFgi === "function" && FGI.rows) {
    try {
      renderFgi();
    } catch (e) {
    }
  }
  pkMsg(res.already ? `${p.title}: the Send to FBA rows were already written — list saved.` : `${nf(res.rows.length)} Send to FBA row(s) written for ${p.title} (pack ${p.id}) — the FBA Dispatch tab has them. Open the list for sizes and weights, then Packing list / Labels / FBA file as usual.`);
}
function pksEnd() {
  PKS.panel = "";
  pksCamStop();
  pksSleep();
  clearTimeout(PKS.retryT);
  PKS.on = false;
  PKS.hold = false;
  const ov = $("pksOv");
  if (ov) ov.remove();
  if (typeof renderPack === "function" && PK_LOADED) renderPack();
}
async function pksClose() {
  if (PKS.dirty || PKS.saving) {
    pksSay("Saving…");
    clearTimeout(PKS.saveT);
    await pksSaveNow();
  }
  if (PKS.err) {
    if (!confirm("Not saved to the server yet — the network is down.\n\nThe scans stay on this phone and are saved the next time this list is opened here. Close anyway?")) return;
  }
  pksEnd();
  pkMsg(PKS.err ? `${PKS.p.title}: closed with scans kept on this phone — open it again here when the network is back to save them.` : `Scanned list saved: ${PKS.p.title} — open it to add sizes and weights, then Packing list / Labels / FBA file as usual.`);
}
$("pkScanBtn").onclick = () => pksOpen().catch((e) => pkMsg("Scan to pack could not start: " + (e.message || e), true));

// Picture zoom (16 Oct, not live yet). Hold a finger on a product picture, or hover with a mouse, and a magnified
// window pops out above it and follows the finger. Lifting the finger closes it. Loaded after scan-to-pack.js;
// it only listens on the page, so the scanner code itself is unchanged.
(() => {
  if (typeof document.addEventListener !== "function") return; // the test stand-in document has none
  const ZOOM = 2; // the window shows half of the picture across
  let held = null;
  const pick = (t) => t && t.closest && t.closest(".pks .pks-img, .pks .pks-row img");
  function show(img, x, y) {
    let z = document.getElementById("pksZoom");
    if (!z) {
      z = document.createElement("div");
      z.id = "pksZoom";
      z.className = "pks-zoom";
      document.body.appendChild(z);
    }
    const r = img.getBoundingClientRect();
    // the picture is drawn inside its box with object-fit:contain; find where it actually is
    const nw = img.naturalWidth || r.width, nh = img.naturalHeight || r.height;
    const k = Math.min(r.width / nw, r.height / nh), cw = nw * k, ch = nh * k;
    const cx = r.left + (r.width - cw) / 2, cy = r.top + (r.height - ch) / 2;
    const fx = Math.max(0, Math.min(1, (x - cx) / cw)), fy = Math.max(0, Math.min(1, (y - cy) / ch));
    const vw = window.innerWidth, vh = window.innerHeight;
    const size = Math.round(Math.min(vw, vh) * 0.62);
    const bw = size * ZOOM, bh = bw * nh / nw;
    z.style.width = z.style.height = size + "px";
    z.style.backgroundImage = `url("${img.currentSrc || img.src}")`;
    z.style.backgroundSize = `${bw}px ${bh}px`;
    z.style.backgroundPosition = `${size / 2 - fx * bw}px ${size / 2 - fy * bh}px`;
    // above the finger; below it when there is no room at the top
    let top = y - size - 0.06 * vw;
    if (top < 8) top = Math.min(vh - size - 8, y + 0.08 * vw);
    z.style.top = top + "px";
    z.style.left = Math.max(8, Math.min(vw - size - 8, x - size / 2)) + "px";
    z.classList.add("on");
  }
  function hide() {
    const z = document.getElementById("pksZoom");
    if (z) z.classList.remove("on");
  }
  document.addEventListener("pointerdown", (e) => {
    const img = pick(e.target);
    if (!img) return;
    e.preventDefault();
    held = img;
    show(img, e.clientX, e.clientY);
  });
  document.addEventListener("pointermove", (e) => {
    // the card is redrawn after each save; keep zooming the new picture while the finger stays down
    if (held && !held.isConnected) held = document.querySelector(".pks .pks-img") || null;
    const img = held || (e.pointerType === "mouse" ? pick(e.target) : null);
    if (img) show(img, e.clientX, e.clientY);
    else if (e.pointerType === "mouse") hide();
  });
  const end = (e) => {
    if (!held) return;
    held = null;
    if (e.pointerType !== "mouse") hide();
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  document.addEventListener("contextmenu", (e) => { if (pick(e.target)) e.preventDefault(); });
})();
