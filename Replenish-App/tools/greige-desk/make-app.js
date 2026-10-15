/* Builds src/app/flow/greige-desk.js from the Greige Desk page's own source (core.js, ui.js, head.html) plus the
 * in-app layer (app-layer.js). The page runs sealed inside the Replenish app: its own styles and element ids in a
 * shadow root, its own names inside one closure, saving to its own node pt_gdTest (the name is from its test days; the
 * Firestore/RTDB rights are written for it, so it keeps it).
 *   node tools/greige-desk/make-app.js */
const fs = require('fs'), path = require('path');
const D = __dirname, OUT = path.join(D, '..', '..', 'src', 'app', 'flow', 'greige-desk.js');
const read = f => fs.readFileSync(path.join(D, f), 'utf8').replace(/\r\n/g, '\n');
const R = (s, a, b) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error('anchor x' + n + ': ' + a.slice(0, 90)); return s.replace(a, b); };
/* REAL WORKING SINCE 15 OCT (Ravi: "griege ka bhi test window hatao"): the page's own numbers, RIDHI/PO/GREIG/001 and
 * RIDHI/RFD/001, no TEST tag, no sample / clear buttons. */
let core = read('core.js'), ui = read('ui.js'), head = read('head.html'), layer = read('app-layer.js');

/* ---- the screen code: no start-up of its own, no reset button, no "working as" picker ---- */
ui = ui.replace(/\/\* Started at once when the page is already parsed[^\n]*\n[^\n]*lmBoot\(\);\s*$/, '');
ui = R(ui, "  $('lmReset').addEventListener('click', function () {\n    if (!armed(this, 'Press again to wipe what you typed')) return;\n    lmResetSample(); render();\n    lmSay('ok', 'The sample registers are back.');\n  });",
  '');
ui = R(ui, "  $('meSel').addEventListener('change', function () { DB.me = this.value; lmSaveDb(); render(); lmSay('ok', 'Working as ' + meUser().name + ' · fabric ledger: ' + LEDGER_LABEL[meUser().ledger].toLowerCase() + (meUser().approve ? ' · may approve shrinkage' : '') + '.'); });\n", '');
ui = R(ui, "  try { localStorage.setItem(LM_KEY + '-tab', UI.tab); } catch (e) { /* the tab is a convenience */ }\n", '');
/* RFD on the shelf goes on to a printer through the flow's Demand */
ui = R(ui, "        + '<td><button type=\"button\" class=\"jw-btn jw-primary\" data-cut=\"' + esc(g.lot) + '\">Send to cutting</button></td></tr>';",
  "        + '<td><div class=\"actions\" style=\"justify-content:flex-start\"><button type=\"button\" class=\"jw-btn jw-primary\" data-gdflow=\"drfd\">Send to printer</button>'\n"
  + "        + '<button type=\"button\" class=\"jw-btn\" data-cut=\"' + esc(g.lot) + '\">Send to cutting</button></div></td></tr>';");

/* ---- the in-app wiring: PPC links ---- */
layer += "\nfunction wireGd() {\n"
  + "  document.addEventListener('click', function (ev) {\n"
  + "    var t = ev.target.closest ? ev.target.closest('[data-ppcpo],[data-gdflow]') : null; if (!t) return;\n"
  + "    if (t.getAttribute('data-ppcpo')) { var p = t.getAttribute('data-ppcpo').split('|'); gdPoFor(p[0], +p[1]); return; }\n"
  + "    if (t.getAttribute('data-gdflow')) { gdToFlow(t.getAttribute('data-gdflow')); return; }\n"
  + "  });\n}\n";

/* ---- the styles: the page's own, sealed in the shadow root, light only (the app is), above the app's bar ---- */
let css = head.slice(head.indexOf('<style>') + 7, head.indexOf('</style>'));
const cut = (s, a, endMark) => { const i = s.indexOf(a); if (i < 0) throw new Error('css block: ' + a.slice(0, 40)); const j = s.indexOf(endMark, i) + endMark.length; return s.slice(0, i) + s.slice(j); };
css = cut(css, '@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){', 'color-scheme:dark } }');
css = cut(css, ':root[data-theme="dark"]{', 'color-scheme:dark }');
css = R(css, ':root{', ':host{display:block;');
/* What the page skeleton gave the published page, the shadow root has to say itself. */
css = '[hidden]{display:none!important} img{max-width:100%} ' + css;
css = R(css, 'body{background:var(--bg);color:var(--ink);font:14px/1.45 var(--sans);-webkit-font-smoothing:antialiased}', '.gdroot{background:var(--bg);color:var(--ink);font:14px/1.45 var(--sans);-webkit-font-smoothing:antialiased;border-radius:18px}');
css = R(css, '.side{position:sticky;top:env(safe-area-inset-top,0px);z-index:40;', '.side{position:static;border-radius:18px 18px 0 0;');
css = R(css, '.modal{position:fixed;inset:0;background:var(--scrim);display:flex;align-items:center;justify-content:center;z-index:50;', '.modal{position:fixed;inset:0;background:var(--scrim);display:flex;align-items:center;justify-content:center;z-index:1000;');
css = R(css, '.scrim{position:fixed;inset:0;background:var(--scrim);z-index:60}', '.scrim{position:fixed;inset:0;background:var(--scrim);z-index:1010}');
css = R(css, 'width:min(640px,100%);background:var(--card);z-index:61;', 'width:min(640px,100%);background:var(--card);z-index:1011;');
css = R(css, 'box-shadow:var(--sh-3);border-left:4px solid var(--brand)}', 'box-shadow:var(--sh-3);border-left:4px solid var(--brand);z-index:1100}');

/* ---- the markup: its own bar and who is working ---- */
let html = head.slice(head.indexOf('<div class="shell">'), head.indexOf('<script>'));
html = R(html, '<div class="brand"><span class="brandname">Ridhi<span class="brandsub">Home &amp; Living</span></span></div>',
  '<div class="brand"><span class="brandname">Greige Desk<span class="brandsub">Greige · RFD · POs</span></span></div>');
const sf = html.indexOf('    <div class="sidefoot">'), sfe = html.indexOf('    </div>\n', sf) + '    </div>\n'.length;
html = html.slice(0, sf) + '    <div class="sidefoot">\n      <span id="meName" class="muted" style="font-size:12px"></span>\n    </div>\n' + html.slice(sfe);

const out = `/* ================= GREIGE DESK (2026-10-13; real working since 15 Oct) — built by tools/greige-desk/make-app.js, do not edit by hand =================
 *
 * Ravi's Greige Desk page (greige POs received bale by bale, issue to RFD by bales, RFD back by thans with a 5% shrinkage
 * approval, inventory with next steps, the fabric ledger and its masters) running inside the app, joined to the PPC flow:
 * the Inventory's PPC demand column shows the greige to buy for what PPC has planned, the flow's Demand → RFD counts this desk's RFD, and
 * RFD on the shelf goes on to a printer through the flow. On while FLOW_ON; saves to pt_gdTest only.
 *
 * Sealed: its styles and element ids live in a shadow root on #paneGdesk, its names inside this one closure. Only GD is
 * seen by the rest of the app. */
const GD = (function () {
  var GD_ROOT = null;
  /* The page's code asks "document" for its elements; here that is the shadow root it lives in. */
  var document = {
    getElementById: function (id) { return GD_ROOT ? GD_ROOT.getElementById(id) : null; },
    querySelector: function (s) { return GD_ROOT ? GD_ROOT.querySelector(s) : null; },
    querySelectorAll: function (s) { return GD_ROOT ? GD_ROOT.querySelectorAll(s) : []; },
    addEventListener: function (t, f, o) { if (GD_ROOT) GD_ROOT.addEventListener(t, f, o); },
    createElement: function (t) { return window.document.createElement(t); },
    get activeElement() { return GD_ROOT ? GD_ROOT.activeElement : null; },
    get body() { return GD_ROOT ? GD_ROOT.querySelector('.gdroot') : null; },
    readyState: 'complete'
  };
  var localStorage = { getItem: function () { return null; }, setItem: function () {} };
  var GD_CSS = ${JSON.stringify(css)};
  var GD_HTML = ${JSON.stringify(html)};

${core}

${ui}

${layer}

  var GD_WIRED = false;
  function gdMount() {
    if (GD_ROOT) return true;
    var host = window.document.getElementById('paneGdesk'); if (!host || !host.attachShadow) return false;
    GD_ROOT = host.attachShadow({ mode: 'open' });
    GD_ROOT.innerHTML = '<style>' + GD_CSS + '</style><div class="gdroot">' + GD_HTML + '</div>';
    return true;
  }
  async function open(tab) {
    if (!gdMount()) return;
    if (tab) UI.tab = tab;
    if (!DB) $('lmPane').innerHTML = '<div class="card muted">Reading the Greige Desk…</div>';
    await gdLoad(); lmLoad();
    if (typeof gdLinkMasters === 'function') gdLinkMasters();   // the Master Data's fabrics and vendors, read fresh each time
    if (!GD_WIRED) { GD_WIRED = true; wireShell(); wirePurchaseOrders(); wireInventory(); wireLedger(); wireMasterData(); wireEntry(); wireUsersRfd(); wireGd(); }
    render();
  }
  return { open: open, ensure: function () { return gdLoad(); }, rfdShelf: function (n) { return gdRfdShelf(n); } };
})();
`;
fs.writeFileSync(OUT, out);
console.log('wrote', path.relative(process.cwd(), OUT), Math.round(out.length / 1024) + ' KB');
