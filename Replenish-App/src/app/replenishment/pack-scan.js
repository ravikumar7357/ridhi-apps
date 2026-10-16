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
const PKS_GAP_MS = 700;
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
function pksFrame(code, t, st) {
  st = st || PKS;
  const s = st.seen;
  if (!s || s.code !== code || t - s.last > PKS_GAP_MS) st.seen = { code, last: t, hits: 1, counted: false };
  else {
    s.last = t;
    s.hits++;
  }
  if (!st.seen.counted && st.seen.hits >= PKS_AGREE) {
    st.seen.counted = true;
    return true;
  }
  return false;
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
    if (a.kind === "full") return { ok: false, kind: "full", code: obUC(code), sku: r.sku, why: a.why === "store" ? "The India Store holds no more " + r.sku + " for these orders — receive it in Finished Goods first." : "Every order line for " + r.sku + " is already packed." };
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
  PKS.seen = null;
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
  PKS.seen = null;
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
    await savePkOne(p);
    PKS.err = "";
    if (!PKS.dirty) pksBackupClear(PKS.p.id);   // the server has all of it; nothing left only on the phone
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
  try {
    PKS.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    pksSay("The camera did not open (" + (e.name || e.message || e) + "). Allow the camera for this site, or use a hand scanner / type the code.", true);
    return;
  }
  v.srcObject = PKS.stream;
  v.setAttribute("playsinline", "");
  v.muted = true;
  try {
    await v.play();
  } catch (e) {
  }
  try {
    if ("BarcodeDetector" in window && (await BarcodeDetector.getSupportedFormats()).includes("code_128"))
      PKS.det = new BarcodeDetector({ formats: ["code_128", "ean_13", "code_39", "upc_a"] });
  } catch (e) {
    PKS.det = null;
  }
  if (!PKS.det) {
    try {
      await pksZxLoad();
    } catch (e) {
      pksSay("The barcode reader did not load — use a hand scanner or type the code.", true);
      return;
    }
  }
  const track = PKS.stream.getVideoTracks()[0];
  const caps = track && track.getCapabilities ? track.getCapabilities() : {};
  $("pksTorch").classList.toggle("hide", !caps.torch);
  pksSay(PKS.det ? "Point at the FNSKU label" : "Point at the FNSKU label (reader: ZXing)");
  pksLoop();
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
function pksZxRead(v) {
  const W = v.videoWidth, H = v.videoHeight;
  if (!W || !H) return null;
  const c = PKS.cv || (PKS.cv = document.createElement("canvas"));
  const cw = Math.min(1280, W), ch = Math.round(H * 0.45), sy = Math.round((H - ch) / 2);
  c.width = cw;
  c.height = ch;
  c.getContext("2d", { willReadFrequently: true }).drawImage(v, 0, sy, W, ch, 0, 0, cw, ch);
  if (!PKS.zx) PKS.zx = new ZXing.Code128Reader();
  try {
    return PKS.zx.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c)))).getText();
  } catch (e) {
    return null;
  }
}
async function pksLoop() {
  if (!PKS.on || !PKS.stream) return;
  const v = $("pksVid");
  let code = null;
  try {
    if (PKS.det) {
      const got = await PKS.det.detect(v);
      code = got && got[0] ? got[0].rawValue : null;
    } else code = pksZxRead(v);
  } catch (e) {
    code = null;
  }
  if (code && pksFrame(obUC(code), Date.now())) pksHit(code, "camera");
  PKS.timer = setTimeout(pksLoop, PKS.det ? 90 : 140);
}
function pksCamStop() {
  clearTimeout(PKS.timer);
  if (PKS.stream) PKS.stream.getTracks().forEach((t) => t.stop());
  PKS.stream = null;
}
/** Ask the camera to keep focusing by itself, where the phone allows it (labels are read close up). */
async function pksFocus() {
  try {
    const t = PKS.stream && PKS.stream.getVideoTracks()[0], caps = t && t.getCapabilities ? t.getCapabilities() : {};
    if ((caps.focusMode || []).includes("continuous")) await t.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
  } catch (e) {
  }
}
let PKS_AC = null;
/** good: one short high beep · bad: a low buzz · done: two rising beeps. */
function pksBeep(good, kind) {
  try {
    PKS_AC = PKS_AC || new (window.AudioContext || window.webkitAudioContext)();
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
/* A hand scanner types the code and presses Enter. Read it wherever the focus is — not only in the box — but never take
 * keys meant for another field (box sizes, the account, the hand-over name). */
if (typeof document.addEventListener === "function") document.addEventListener("keydown", (e) => {
  if (!PKS.on) return;
  const t = e.target, tag = t && t.tagName || "";
  if (t && t.id === "pksCode") return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || e.ctrlKey || e.metaKey || e.altKey) return;
  const now = Date.now();
  if (now - PKS.keyT > 400) PKS.keyBuf = "";
  PKS.keyT = now;
  if (e.key === "Enter") {
    const c = PKS.keyBuf.trim();
    PKS.keyBuf = "";
    if (c.length >= 4) {
      e.preventDefault();
      PKS.seen = null;
      pksHit(c, "scanner");
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
    PKS.hold = r.kind !== "none";
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
  PKS.seen = null;
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
      PKS.seen = null;
      pksHit(c, "typed");
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
      const t = PKS.stream.getVideoTracks()[0];
      PKS.torch = !PKS.torch;
      await t.applyConstraints({ advanced: [{ torch: PKS.torch }] });
      $("pksTorch").classList.toggle("on", PKS.torch);
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
  $("pksClose").onclick = pksFinishAsk;
  $("pksUndo").onclick = () => {
    if (PKS.hold) return pksSay('Tap "Kept aside" first.', true);
    const h = pksUndo();
    PKS.allDone = pksAllPacked();
    pksSay(h ? `Undone: −${h.n} ${h.sku} (box ${h.box})` : "Nothing to undo.");
    pksDraw();
  };
  $("pksPer").onchange = () => {
    PKS.per = Math.max(1, +$("pksPer").value || 1);
  };
  $("pksNext").onclick = pksNextAsk;
  const go = () => {
    const c = $("pksCode").value.trim();
    if (c) {
      PKS.seen = null;
      pksHit(c, "typed");
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
      const t = PKS.stream.getVideoTracks()[0];
      PKS.torch = !PKS.torch;
      await t.applyConstraints({ advanced: [{ torch: PKS.torch }] });
      $("pksTorch").classList.toggle("on", PKS.torch);
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
  if (!done) $("pksDoneBtn").onclick = () => pksDone();
}
async function pksDone() {
  const p = PKS.p;
  if (!p) return;
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
