/* ui/shell.js -- The frame every screen sits in: the tab router, table helpers, the message bar.
 * An ES module. Its imports are worked out from the code by the split script. */

/** The one element with this id. The page's own helper; nothing in core/ touches the page. */
function $(id) { return document.getElementById(id); }
var UI = { tab: 'po', q: '', inv: 'all', mst: 'fabric' };

/* =============================================================================================
 * THE SCREEN
 *
 * Five stages across the top, the fabric-by-fabric line under them, and the chosen stage's
 * worklist below that -- the same shape as the live Fabric Flow window, drawn with the app's own
 * classes so a figure here sits where a figure there sits.
 * ============================================================================================= */

function lmMatch(text) {
  if (!UI.q) return true;
  return String(text || '').toLowerCase().indexOf(UI.q) >= 0;
}
function th(list, nums) {
  return '<thead><tr>' + list.map(function (h, i) {
    var cls = i === 0 ? ' class="frz"' : (nums.indexOf(i) >= 0 ? ' class="num"' : '');
    return '<th' + cls + '>' + esc(h) + '</th>';
  }).join('') + '</tr></thead>';
}
function emptyRow(cols, words) {
  return '<tr><td colspan="' + cols + '" class="muted" style="padding:12px">' + esc(words) + '</td></tr>';
}
function dash(v) { return v ? nf(v) : '<span class="muted">&mdash;</span>'; }

/** A small quiet mark on a card heading. Drawn, not fetched -- nothing to fail to load. */
function dIcon(kind) {
  var d = {
    doc: '<path d="M4 2h6l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M10 2v4h4" fill="none"/>',
    box: '<path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11z"/><path d="M2.5 5 8 7.5 13.5 5M8 7.5v6" fill="none"/>',
    cut: '<circle cx="4" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><path d="M5.5 10.5 12 3M10.5 10.5 4 3" fill="none"/>',
    chart: '<path d="M3 13V7M8 13V3M13 13v-4" fill="none"/>'
  }[kind] || '';
  return '<span class="dicon"><svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" '
    + 'stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">'
    + d + '</svg></span>';
}
function metric(v, l, colour) {
  return '<div class="metric"><div class="v"' + (colour ? ' style="color:' + colour + '"' : '') + '>' + v + '</div>'
    + '<div class="l">' + esc(l) + '</div></div>';
}

/* ---- the frame ------------------------------------------------------------------------------ */
/* NO DASHBOARD (Ravi, 15 Oct: "remove the greige dashboard"): the desk opens on the Greige POs. */
var LM_TITLE = {
  po: 'Greige POs &amp; challans', inv: 'Inventory',
  ledger: 'Fabric ledger', mst: 'Master data',
};
function render() {
  if (!LM_TITLE[UI.tab]) UI.tab = 'po';
  if (UI.tab === 'ledger' && !canLedger()) UI.tab = 'po';
  if (UI.tab === 'mst' && gdIsLinked()) UI.tab = 'po';   // in the app the masters are Setup's (no Master data tab)
  meFill();
  $('lmTitle').innerHTML = LM_TITLE[UI.tab];
  var body = UI.tab === 'inv' ? renderInv()
    : UI.tab === 'ledger' ? renderLedger() : UI.tab === 'mst' ? renderMst() : renderPo();
  $('lmPane').innerHTML = body;
  [].forEach.call(document.querySelectorAll('.navgrp'), function (b) {
    var on = b.getAttribute('data-tab') === UI.tab;
    b.classList.toggle('here', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  try { localStorage.setItem(LM_KEY + '-tab', UI.tab); } catch (e) { /* the tab is a convenience */ }
}

/* EVERY MESSAGE IS ONE TOAST at the foot of the screen, in the colour of what it says. */
var TOAST_T = null;
function lmSay(kind, words) {
  var t = $('toast');
  t.className = 'toast ' + (kind || 'ok'); t.textContent = words; t.hidden = false;
  clearTimeout(TOAST_T); TOAST_T = setTimeout(function () { t.hidden = true; }, kind === 'err' ? 7000 : 4200);
}

/* A SECOND PRESS TO CONFIRM. The page cannot raise a browser confirm box, so anything that throws
 * work away asks on its own button: the first press arms it and says what will go, the second does it. */
var ARMED = { id: '', t: null };
function armed(btn, words) {
  if (ARMED.id === btn.id) { clearTimeout(ARMED.t); ARMED.id = ''; btn.textContent = btn.getAttribute('data-was'); btn.classList.remove('armed'); return true; }
  if (ARMED.id && $(ARMED.id)) { var o = $(ARMED.id); o.textContent = o.getAttribute('data-was'); o.classList.remove('armed'); }
  ARMED.id = btn.id; btn.setAttribute('data-was', btn.textContent); btn.textContent = words; btn.classList.add('armed');
  clearTimeout(ARMED.t);
  ARMED.t = setTimeout(function () { if (ARMED.id === btn.id) { btn.textContent = btn.getAttribute('data-was'); btn.classList.remove('armed'); ARMED.id = ''; } }, 4500);
  return false;
}

/* ---- wiring: the tabs, the search box, closing dialogs, the reset button --------------------------- */
function wireShell() {
  document.addEventListener('click', function (ev) {
    var md = ev.target.closest ? ev.target.closest('[data-gdmd]') : null;
    if (md && typeof gdOpenMasterData === 'function') { gdOpenMasterData(md.getAttribute('data-gdmd')); return; }
    var t = ev.target.closest ? ev.target.closest('[data-tab],[data-go],[data-close]') : null;
    if (!t) return;
    var g = function (k) { return t.getAttribute(k); };
    if (g('data-tab')) { UI.tab = g('data-tab'); render(); return; }
    if (g('data-go')) {
      /* The PO list (or its challans), or the stock sheet opened lot by lot -- which is where a lot
       * standing still is actually looked at. */
      var to = g('data-go');
      if (to === 'po') { UI.tab = 'po'; PV.view = 'po'; }
      else if (to === 'check') { UI.tab = 'po'; PV.view = 'ch'; PV.st = 'tocheck'; }
      else { UI.tab = 'inv'; UI.inv = 'all'; }
      render(); window.scrollTo(0, 0); return;
    }
    if (g('data-close')) {
      var c = g('data-close');
      if (c === 'drawer') { closeDrawer(); return; }
      if (c !== 'lmEntry') $(c).classList.add('hide');
      return;
    }
  });
  document.addEventListener('click', function (ev) {
    /* A click on the ground behind a dialog closes it, as the app's dialogs do. */
    if (ev.target.classList && ev.target.classList.contains('modal') && ev.target.id !== 'lmEntry') {
      ev.target.classList.add('hide');
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    $('lmPo').classList.add('hide'); $('lmDoc').classList.add('hide');
    if (RD) closeDrawer();
  });
  $('lmQ').addEventListener('input', function () { UI.q = this.value.trim().toLowerCase(); render(); });
  $('lmReset').addEventListener('click', function () {
    if (!armed(this, 'Press again to wipe what you typed')) return;
    lmResetSample(); render();
    lmSay('ok', 'The sample registers are back.');
  });
}

/* ui/dashboard.js -- The Dashboard screen.
 * An ES module. Its imports are worked out from the code by the split script. */

function renderAlerts() {
  var list = dashAlerts();
  var card = '<div class="card" style="margin-bottom:0">';
  var bad = list.filter(function (x) { return x.bad; }).length;
  var head = '<div class="kpihead"><span class="kpiname">Needs chasing</span>'
    + '<span class="kpiwhen">a lot out more than ' + CHASE_PROCESSOR_DAYS + ' days, or a PO older than '
    + CHASE_PO_DAYS + ' days, is called late</span></div>';
  if (!list.length) {
    return card + head
      + '<div class="ok" style="margin:0">Nothing is standing still. Every lot is either in the store '
      + 'or on its way back, and every PO is accounted for.</div></div>';
  }
  return card + head
    + (bad ? '' : '<div class="ff-cap">Nothing is late, but these are the things in motion.</div>')
    + '<div style="display:flex;flex-direction:column;gap:7px">'
    + list.map(function (x) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 11px;border-radius:var(--r-sm);'
        + 'background:' + (x.bad ? 'var(--bad-bg)' : 'var(--soft)') + '">'
        + '<span class="pill ' + (x.bad ? 'pill-out' : 'pill-low') + '">' + (x.tag || (x.bad ? 'Late' : 'Open')) + '</span>'
        + '<span style="flex:1;min-width:0"><b>' + esc(x.what) + '</b>'
        + '<span class="muted"> \u2014 ' + esc(x.who) + '</span></span>'
        + '<button type="button" class="jw-btn" data-go="' + x.go + '">Show me</button>'
        + '</div>';
    }).join('') + '</div></div>';
}

function renderProcessors() {
  var rows = dashProcessors();
  if (!rows.length) return '';
  var best = rows.filter(function (r) { return r.lossPct !== null; });
  var worst = best[0], kind = best[best.length - 1];
  var spread = '';
  if (best.length > 1) {
    spread = 'The gap between your best and worst is '
      + (Math.round((worst.lossPct - kind.lossPct) * 10) / 10) + ' points';
    if (worst.perMetre && kind.perMetre && worst.baseRate && kind.baseRate) {
      /* Said in the only unit that settles an argument: what the same cloth costs through each. */
      var gap = Math.round(((worst.perMetre - worst.baseRate) - (kind.perMetre - kind.baseRate)) * 100) / 100;
      if (gap > 0) spread += ', which is ' + RUPEE + money(gap) + ' a metre';
    }
    spread += '.';
  }
  return '<div class="card"><div class="kpihead"><span class="kpiname">The processing houses</span>'
    + '<span class="kpiwhen">settled lots only</span></div>'
    + '<div class="ff-cap">What each one gives back, how long they keep it, and what a usable metre '
    + 'of RFD actually cost by the time it came home. ' + esc(spread) + '</div>'
    + '<div class="ff-grid"><table class="xl">'
    + th(['RFD processor', 'Lots', 'Sent', 'Back', 'Loss', 'Turnaround', 'Greige rate', 'Cost per usable metre', 'Out with them now'],
      [1, 2, 3, 4, 5, 6, 7, 8])
    + '<tbody>' + rows.map(function (r) {
      return '<tr><td class="frz" style="text-align:left"><b>' + esc(r.name) + '</b></td>'
        + '<td class="num">' + (r.lots || MUTED_DASH) + '</td>'
        + '<td class="num">' + dash(r.sent) + '</td>'
        + '<td class="num">' + dash(r.back) + '</td>'
        + '<td class="num" style="font-weight:700' + (r.lossPct > 10 ? ';color:var(--bad)' : '') + '">'
        + (r.lossPct === null ? MUTED_DASH : r.lossPct + '%')
        + (r.loss ? '<div class="muted" style="font-size:10.5px">' + nf(r.loss) + ' m</div>' : '') + '</td>'
        + '<td class="num">' + (r.avgDays === null ? MUTED_DASH : r.avgDays + ' d') + '</td>'
        + '<td class="num">' + (r.baseRate === null ? MUTED_DASH : RUPEE + money(r.baseRate)) + '</td>'
        + '<td class="num" style="font-weight:700">' + (r.perMetre === null ? MUTED_DASH
          : RUPEE + money(r.perMetre)
            + (r.lossCost ? '<div class="muted" style="font-size:10.5px">+' + RUPEE + money(r.lossCost) + ' lost in the bleach</div>' : ''))
        + '</td>'
        + '<td class="num" style="color:var(--proc-ink)">' + (r.outM > 0.05
          ? nf(r.outM) + ' m<div class="muted" style="font-size:10.5px">' + r.outLots + ' lot'
            + (r.outLots > 1 ? 's' : '') + '</div>' : MUTED_DASH) + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
}

/* ---- THE PIPELINE, DRAWN ---------------------------------------------------------------------- *
 *
 * Three numbers in a row of text do not tell you that more than half your cloth is sitting at a
 * processing house. One bar does, at a glance, before you have read a single figure.
 *
 * The colours are the app's own meanings -- waiting, in motion, ready -- stepped up in chroma until
 * they passed the palette checks (lightness band, chroma floor, colour-blind separation, contrast).
 * Each segment is also labelled underneath, so identity never rests on colour alone.
 */
var PIPE = [
  { key: 'greige', short: 'Greige', label: 'Greige in store', colour: 'var(--c-greige)',
    note: 'bought, not yet sent to be bleached' },
  { key: 'proc', short: 'In-processing', label: 'At the processor', colour: 'var(--c-proc)',
    note: 'off your shelf, still your money' },
  { key: 'rfd', short: 'RFD ready', label: 'RFD on the shelf', colour: 'var(--c-rfd)',
    note: 'ready for the cutting table' }
];

function renderPipe() {
  var t = dashPipeline();
  if (t.total <= 0.05) return '';
  var val = { greige: t.greigeV, proc: t.procV, rfd: t.rfdV };
  var pct = function (v) { return Math.round((v / t.total) * 1000) / 10; };

  /* A RING, NOT A BAR.
   *
   * Three slices, nowhere near each other in size -- 10, 17 and 73 per cent. That is the one case a
   * ring is good for: the share of a whole, read at a glance. It would be the wrong drawing for
   * close values, where the eye cannot judge one arc against another; then it goes back to being a
   * bar. The total sits in the hole, which is the thing a ring can do that a bar cannot, and every
   * figure is written out underneath as well, so nothing rests on the colour or on the angle.
   */
  var R = 108, SW = 34, C = 2 * Math.PI * R, GAP = 4, at = 0;
  var ring = PIPE.map(function (p) {
    var v = t[p.key]; if (v <= 0.05) return '';
    var len = (v / t.total) * C, draw = Math.max(0.5, len - GAP);
    var seg = '<circle cx="140" cy="140" r="' + R + '" fill="none" style="stroke:' + p.colour + '"'
      + ' stroke-width="' + SW + '"'
      /* A sliver of surface between arcs, so two colours never touch. */
      + ' stroke-dasharray="' + draw + ' ' + (C - draw) + '"'
      + ' stroke-dashoffset="' + (-at) + '">'
      + '<title>' + esc(p.label + ' \u2014 ' + nf(v) + ' m, ' + pct(v) + '% of what you own') + '</title>'
      + '</circle>';
    at += len;
    return seg;
  }).join('');

  var donut = '<div style="flex:none;position:relative;width:280px;height:280px;max-width:100%">'
    + '<svg viewBox="0 0 280 280" width="100%" height="100%" style="transform:rotate(-90deg);display:block" role="img"'
    + ' aria-label="Share of the cloth you own, by where it is standing">' + ring + '</svg>'
    + '<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;'
    + 'justify-content:center;text-align:center;pointer-events:none">'
    + '<div style="font-size:38px;font-weight:800;line-height:1.05;letter-spacing:-.02em;'
    + 'font-variant-numeric:tabular-nums">' + nf(t.total) + ' m</div>'
    + '<div class="muted" style="font-size:14px;letter-spacing:.06em;margin-top:2px">OWNED</div>'
    + (t.totalV ? '<div style="font-size:20px;margin-top:12px;font-weight:700;color:var(--ink);'
      + 'font-variant-numeric:tabular-nums">' + RUPEE + nf(t.totalV) + '</div>'
      + (t.unratedM > 0.05
        ? '<div class="muted" style="font-size:13px;margin-top:3px">on ' + nf(t.valuedM) + ' m</div>'
        : '') : '')
    + '</div></div>';

  /* THREE THINGS SIDE BY SIDE, because they are three parts of one whole and the eye should take
   * them in together rather than read down a list. They wrap onto a second row when the window
   * cannot hold them. */
  var legend = '<div style="display:flex;flex-wrap:wrap;gap:14px 26px">'
    + PIPE.map(function (p) {
      var v = t[p.key];
      return '<div style="display:flex;gap:8px;align-items:flex-start;min-width:140px;flex:1 1 140px">'
        + '<span style="width:10px;height:10px;border-radius:3px;background:' + p.colour + ';margin-top:4px;flex:none"></span>'
        + '<span style="font-size:12.5px"><b>' + esc(p.short) + ':</b> '
        + '<span style="font-variant-numeric:tabular-nums">' + nf(v) + ' m \u00b7 ' + pct(v) + '%</span>'
        + (val[p.key] ? ' \u00b7 ' + RUPEE + nf(val[p.key])
          : (v > 0.05 ? ' \u00b7 <span class="muted">no rate on record</span>' : ''))
        + '<div class="muted" style="font-size:11px">' + esc(p.note) + '</div></span></div>';
    }).join('')
    + '</div>';

  /* THE TOTAL USED TO BE WRITTEN THREE TIMES on one card -- in the heading, in the middle of the
   * ring, and in a box of its own. It is in the ring; that is where the eye already is. What is
   * said instead is the thing the ring cannot: what is missing from the money. It runs the width of
   * the card, under the drawing, because it is about the whole of it. */
  /* The line worth putting in words: how much of what you own you cannot actually cut today. */
  var stuck = t.total ? Math.round(((t.greige + t.proc) / t.total) * 1000) / 10 : 0;
  var say = stuck >= 50
    ? '<b>' + stuck + '% of your cloth cannot be cut today</b> \u2014 it is still greige, or still at a processor.'
    : stuck + '% of your cloth is not yet usable, the rest is RFD and ready.';

  return '<div class="card" style="margin-bottom:0">'
    + '<div class="dhead" style="margin-bottom:6px">' + dIcon('chart')
    + '<span class="dtitle">Material positioning &amp; value</span>'
    + '<span class="muted" style="margin-left:auto;font-size:11px">'
    + (t.totalV ? 'valued at the rate on each cloth\u2019s last greige PO' : 'metres only \u2014 no rates on record')
    + '</span></div>'
    + '<div class="ff-cap" style="margin-bottom:2px">' + say + '</div>'
    /* THE RING GETS THE WIDTH OF THE CARD TO ITSELF and the legend reads underneath it. Side by
     * side, the drawing was squeezed into whatever the words left over; this way the shape of the
     * stock is the first thing on the card and the figures sit under it as the caption they are. */
    + '<div style="display:flex;justify-content:center;margin:10px 0 16px">' + donut + '</div>'
    + legend + '</div>';
}

/** What the value is missing, said once, under the whole row. */
function dashUnratedNote() {
  var t = dashPipeline();
  if (t.unratedM <= 0.05) return '';
  return '<div style="margin-bottom:14px;background:var(--warn-bg);color:var(--warn-ink);'
    + 'border-radius:var(--r-card);padding:11px 15px;font-size:12.5px;line-height:1.55">'
    + '<b>' + nf(t.unratedM) + ' m is not in that value.</b> '
    + esc(lmList(t.unrated)) + ' ' + (t.unrated.length > 1 ? 'have' : 'has')
    + ' never been on a PO here, so there is no rate to cost '
    + (t.unrated.length > 1 ? 'them' : 'it') + ' at. Raise one, or put the rate on the fabric '
    + 'type, and the figure completes itself.</div>';
}

function renderFlow() {
  var X = ffFacts();
  /* THREE CARDS, NOT SIX FIGURES IN A ROW.
   *
   * The old strip put "on order", "greige", "at processor", "RFD" and the loss side by side at the
   * same weight, which said they were the same kind of thing. They are not: one is a promise from a
   * mill, two are cloth you cannot cut yet, and one is cloth you can. Grouped that way, the shape of
   * the week is readable before a single figure is. */
  var pos = (DB.gpo || []).filter(function (po) {
    return ['open', 'sent', 'part'].indexOf(gpoStatus(po)) >= 0;
  }).length;
  var lossPct = X.lossSent ? Math.round((X.loss / X.lossSent) * 1000) / 10 : null;
  var P = dashPipeline();

  /* EVERY FIGURE ON A CARD IS A DOOR. A number you cannot get behind is a number you end up
   * distrusting; each of these opens the screen that can show you what it is made of. */
  var head = '<div class="dashcards">'
    + '<button type="button" class="dcard" data-go="po" title="Open the greige POs">'
    + '<div class="dhead">' + dIcon('doc') + '<span class="dtitle">Greige &amp; RFD on-order</span>'
    + (pos ? '<span class="dchip">' + pos + ' PO' + (pos > 1 ? 's' : '') + ' open</span>' : '')
    + '</div>'
    + '<div class="dfig">' + nf(X.poPending) + ' m</div>'
    + '<div class="dsub">On order from suppliers</div></button>'

    + '<button type="button" class="dcard" data-go="lots" title="Open the stock sheet, lot by lot">'
    + '<div class="dhead">' + dIcon('box') + '<span class="dtitle">In stock &amp; processing</span></div>'
    + '<div class="dsplit">'
    + '<div><div class="dfig" style="color:' + PIPE[0].colour + '">' + nf(X.greige) + ' m</div>'
    + '<div class="dsub">Greige in stock</div></div>'
    + '<div><div class="dfig" style="color:' + PIPE[1].colour + '">' + nf(X.proc) + ' m</div>'
    + '<div class="dsub">With processor</div></div>'
    + '</div></button>'

    + '<button type="button" class="dcard" data-go="inv" title="Open the stock sheet">'
    + '<div class="dhead">' + dIcon('cut') + '<span class="dtitle">Ready for cutting</span></div>'
    + '<div style="display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap">'
    + '<div><div class="dfig" style="color:' + PIPE[2].colour + '">' + nf(X.rfd) + ' m</div>'
    + '<div class="dsub">RFD on shelf</div></div>'
    + '<div class="dnote">Process loss: <b>' + nf(X.loss) + ' m</b>'
    + (lossPct === null ? '' : ' (' + lossPct + '%)') + '</div>'
    + '</div></button>'

    /* WHAT IS ACTUALLY IN THE BUILDING, AND AT THE PROCESSOR. The three cards before it each hold a
     * piece; this is the one figure somebody asks for over the telephone. */
    + '<button type="button" class="dcard" data-go="inv" title="Open the stock sheet">'
    + '<div class="dhead">' + dIcon('box') + '<span class="dtitle">Total inventory</span>'
    + '<span class="dchip">all cloth owned</span></div>'
    + '<div class="dfig">' + nf(P.total) + ' m</div>'
    + '<div class="dsub">'
    + (P.totalV ? RUPEE + nf(P.totalV) + ' at the last greige rate' : 'greige, at the processor and RFD')
    + '</div></button>'
    + '</div>';
  var grid = '<div class="ff-cap">Every fabric, start to finish. The loss column counts settled lots '
    + 'only — cloth still at a processor has not lost anything yet.</div>'
    + '<div class="ff-grid"><table class="xl">'
    + th(['Fabric', 'Greige in', 'Sent for RFD', 'Greige left', 'At processor', 'RFD back', 'Loss', 'RFD left', 'To cutting', ''], [1, 2, 3, 4, 5, 6, 7, 8])
    + '<tbody>'
    + (X.flow.filter(function (e) { return lmMatch(e.fabricType); }).map(function (e) {
      var tag = e.rfdLeft <= 0.05
        ? (e.greigeLeft > 0.05 || e.withProcessor > 0.05
          ? '<span class="pill pill-low">No RFD — ' + (e.withProcessor > 0.05 ? 'ask the processor' : 'send greige to RFD') + '</span>'
          : '<span class="pill pill-out">Nothing in the pipe</span>')
        : '<span class="pill pill-ok">RFD on the shelf</span>';
      return '<tr>'
        + '<td class="frz" style="text-align:left"><b>' + esc(e.fabricType) + '</b>'
        + (function () {
          var m = mstOf(e.fabricType); if (!m) return '';
          var w = m.greigeWidth && m.rfdWidth ? ' · ' + m.greigeWidth + '" → ' + m.rfdWidth + '"' : '';
          return '<div class="muted" style="font-size:10.5px">bought as ' + esc(m.greige) + esc(w) + '</div>';
        }())
        + '</td>'
        + '<td class="num">' + dash(e.greigeIn) + '</td>'
        + '<td class="num">' + dash(e.toRfd) + '</td>'
        + '<td class="num" style="font-weight:700' + (e.greigeLeft < -1e-9 ? ';color:var(--bad)' : '') + '">' + dash(e.greigeLeft) + '</td>'
        + '<td class="num" style="color:var(--proc-ink)">' + dash(e.withProcessor) + '</td>'
        + '<td class="num">' + dash(e.rfdIn) + '</td>'
        + '<td class="num"' + (e.loss ? ' style="color:var(--bad)"' : '') + '>' + dash(e.loss)
        + (e.lossPct === null ? '' : '<div class="muted" style="font-size:10.5px">' + e.lossPct + '%</div>') + '</td>'
        + '<td class="num" style="font-weight:700">' + dash(e.rfdLeft) + '</td>'
        + '<td class="num">' + dash(e.rfdOut) + '</td>'
        + '<td>' + tag + '</td></tr>';
    }).join('') || emptyRow(10, 'Nothing in the fabric ledger yet.'))
    + '</tbody></table></div>';

  return head
    /* THE SHAPE OF THE STOCK AND THE LIST OF WHAT IS STUCK, read together. They answer the two
     * halves of the same morning question -- what have I got, and what is not moving. */
    + '<div class="dash2col">' + renderPipe() + renderAlerts() + '</div>'
    + dashUnratedNote()
    + '<div class="card">' + grid + '</div>'
    + renderProcessors();
}

/* ui/purchase-orders.js -- The Greige POs screen, the new-PO dialog, and the PO document with its PDF, print and mail.
 * An ES module. Its imports are worked out from the code by the split script. */
var PO_DRAFT = null;

/* ---- THE GREIGE POs, AS ONE WORKING LIST ------------------------------------------------------ *
 *
 * A PO rarely comes in one go. The mill sends it over several trucks, each with its own challan,
 * and each challan is a bundle of pieces (thans) with the metres written against them. So a PO
 * opens into its challans, and a challan into its pieces, where the metres measured at the door are
 * typed beside the metres the mill wrote -- a short piece is caught before the cloth goes to be
 * bleached.
 *
 * NOTHING HERE IS STORED TWICE. A challan is the "Greige received" rows of the fabric ledger that
 * came on one paper (they share a chId). Its pieces ride on those rows. Received, still due, lot,
 * stock and the dashboard all read the same rows. */
var PV = { view: 'po', st: '', mill: '', from: '', to: '', openPo: { 'RIDHI/PO/GREIG/001': true }, openCh: { ch4: true } };

var I = {
  chev: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>',
  mail: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5 8 9l5.5-4.5"/></svg>',
  check: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5"/></svg>',
  dot: '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" style="fill:currentColor"/></svg>',
  doc: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/></svg>',
  half: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" style="fill:currentColor"/></svg>',
  truck: '<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M2 5h10v8H2zM12 8h3.5L18 11v2h-6z"/><circle cx="5.5" cy="14.5" r="1.7"/><circle cx="14.5" cy="14.5" r="1.7"/></svg>',
  alert: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v5.5M8 12v.2"/></svg>',
  ruler: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="1.5" y="5" width="13" height="6" rx="1"/><path d="M4.5 5v2.5M7.5 5v3M10.5 5v2.5"/></svg>'
};

/* A PO LINE IS THE GREIGE BOUGHT, AND WHAT IT BECOMES (Ravi, 13 Oct: "main article griege fabric, uske against
 * me kya RFD ready fabric hoga wo description me"). */
function lineGreigeText(l) { return poDesc(l.rfd) || l.greige || ''; }
function lineRfdText(l) { return l.desc || ('RFD ready: ' + (l.rfd || '')); }
var r1 = function (n) { return Math.round((n || 0) * 10) / 10; };
var m1 = function (n) { return r1(n).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); };
var plural = function (n, one, many) { return nf(n) + ' ' + (n === 1 ? one : (many || one + 's')); };
function dmy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : String(iso || ''); }

/* ---- challans, read off the ledger ---------------------------------------------------------- */
function chList() {
  var by = {}, out = [];
  (DB.fab || []).forEach(function (r) {
    if (r.txnType !== 'RECEIVE_GREIGE') return;
    var k = r.chId || ('row-' + r.id);
    if (!by[k]) {
      by[k] = { id: k, no: r.bill || '', mill: r.party || '', po: r.orderNo || '', date: r.date || '',
        vehicle: r.vehicle || '', lr: r.lr || '', transporter: r.transporter || '', invoice: r.invoice || '', rows: [] };
      out.push(by[k]);
    }
    by[k].rows.push(r);
  });
  return out;
}
function chBy(id) { return chList().filter(function (c) { return c.id === id; })[0] || null; }
function chOfPo(no) {
  var N = String(no).toUpperCase();
  return chList().filter(function (c) { return String(c.po).toUpperCase() === N || c.rows.some(function (r) { return String(r.orderNo).toUpperCase() === N; }); })
    .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
}
function chPcs(c) { return c.rows.reduce(function (s, r) { return s + ((r.pieces || []).length); }, 0); }
function chM(c) { return r1(c.rows.reduce(function (s, r) { return s + fabQty(r); }, 0)); }
function chCheck(c) {
  var n = 0, done = 0, diff = 0, shortN = 0;
  c.rows.forEach(function (r) {
    (r.pieces || []).forEach(function (p) {
      n++;
      if (p.chk != null) { done++; diff += p.chk - p.m; if (p.chk - p.m <= -0.05) shortN++; }
    });
  });
  return { n: n, done: done, diff: r1(diff), shortN: shortN };
}
var chToCheck = function (c) { var k = chCheck(c); return k.n > 0 && k.done < k.n; };
function chCloth(c) {
  return uniq(c.rows.map(function (r) { return fabRfdOfGreige(r.fabricType) || r.fabricType; })).join(', ');
}

/* ---- a PO's dates and lateness -------------------------------------------------------------- */
/* LATE IS SAID THE SAME WAY AS ON THE DASHBOARD: a PO nobody has mailed after two days, or one the
 * mill has had past its due date (or a week, where no line carries a date). */
function gpoDueOf(po) {
  var d = (po.lines || []).map(function (l) { return l.due || ''; }).filter(Boolean).sort().pop();
  return d || po.date;
}
function gpoLateDays(po) {
  var st = gpoStatus(po);
  if (st === 'received' || st === 'cancelled') return 0;
  var due = gpoDueOf(po), d = lmDays(due), grace = due === po.date ? CHASE_PO_DAYS : 0;
  return d !== null && d > grace ? d - grace : 0;
}

/* ---- small drawings ------------------------------------------------------------------------- */
function ring(p) {
  var r = 11, c = 2 * Math.PI * r, col = p >= 100 ? 'var(--accent)' : 'var(--brand)';
  return '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">'
    + '<circle cx="15" cy="15" r="' + r + '" style="fill:none;stroke:var(--line)" stroke-width="3.5"/>'
    + (p > 0 ? '<circle cx="15" cy="15" r="' + r + '" style="fill:none;stroke:' + col + '" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="'
      + (c * Math.min(p, 100) / 100).toFixed(2) + ' ' + c.toFixed(2) + '" transform="rotate(-90 15 15)"/>' : '')
    + '</svg>';
}
var AV_TONES = ['av-a', 'av-b', 'av-c', 'av-d'];
function millCell(name) {
  var v = venByName(name) || {}, n = String(name || '?');
  var ini = n.split(/\s+/).filter(function (w) { return /^[A-Za-z]/.test(w); }).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '?';
  var h = 7; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return '<div class="mill"><span class="av ' + AV_TONES[h % AV_TONES.length] + '">' + esc(ini) + '</span>'
    + '<div><div class="b">' + esc(n) + '</div><div class="sub">' + esc(v.city || v.kind || '') + '</div></div></div>';
}

/* ---- status, in words and colour ------------------------------------------------------------ */
function poPill(po) {
  var st = gpoStatus(po), p = gpoProgress(po), late = gpoLateDays(po);
  if (st === 'cancelled') return '<span class="pill pill-mute">Cancelled</span>';
  if (st === 'received') return '<span class="pill pill-ok">' + I.check + ' Received' + (po.closed ? ' · ' + nf(po.closed.short) + ' m not supplied' : '') + '</span>';
  if (st === 'part') return '<span class="pill ' + (late ? 'pill-out' : 'pill-low') + '">' + I.dot + ' Part received · ' + nf(p.pending) + ' m due' + (late ? ' · ' + late + ' d late' : '') + '</span>';
  return '<span class="pill ' + (late ? 'pill-out' : 'pill-sea') + '">' + I.dot + ' Sent' + (late ? ' · ' + late + ' d late' : '') + '</span>';
}
function checkPill(c) {
  var k = chCheck(c);
  if (!k.n) return '<span class="pill pill-mute">No pieces listed</span>';
  if (k.done < k.n) return '<span class="pill pill-low">To check · ' + k.done + ' of ' + k.n + '</span>';
  if (k.diff <= -0.05) return '<span class="pill pill-out">Checked · ' + m1(-k.diff) + ' m short</span>';
  if (k.diff >= 0.05) return '<span class="pill pill-ok">Checked · ' + m1(k.diff) + ' m extra</span>';
  return '<span class="pill pill-ok">' + I.check + ' Checked · matches</span>';
}

/* ---- the filters ---------------------------------------------------------------------------- */
function poPass(po) {
  if (PV.mill && po.mill !== PV.mill) return false;
  if (PV.from && po.date < PV.from) return false;
  if (PV.to && po.date > PV.to) return false;
  var st = gpoStatus(po);
  if (PV.st === 'late' && !gpoLateDays(po)) return false;
  if (PV.st === 'tocheck' && !chOfPo(po.poNo).some(chToCheck)) return false;
  if (PV.st === 'short' && !chOfPo(po.poNo).some(function (c) { return chCheck(c).shortN > 0; })) return false;
  if (['open', 'sent', 'part', 'received', 'closed', 'cancelled'].indexOf(PV.st) >= 0 && st !== PV.st) return false;
  if (UI.q) {
    var hay = [po.poNo, po.mill].concat((po.lines || []).map(function (l) { return l.greige + ' ' + l.rfd + ' ' + (l.desc || ''); }),
      chOfPo(po.poNo).map(function (c) { return c.no + ' ' + c.vehicle + ' ' + c.lr + ' ' + c.rows.map(function (r) { return r.lot; }).join(' '); })).join(' ').toLowerCase();
    if (hay.indexOf(UI.q) < 0) return false;
  }
  return true;
}
function chPass(c) {
  var po = poFind(c.po);
  if (PV.mill && c.mill !== PV.mill) return false;
  if (PV.from && c.date < PV.from) return false;
  if (PV.to && c.date > PV.to) return false;
  if (PV.st === 'tocheck' && !chToCheck(c)) return false;
  if (PV.st === 'short' && !(chCheck(c).shortN > 0)) return false;
  if (PV.st === 'late' && !(po && gpoLateDays(po))) return false;
  if (['open', 'sent', 'part', 'received', 'closed', 'cancelled'].indexOf(PV.st) >= 0 && !(po && gpoStatus(po) === PV.st)) return false;
  if (UI.q) {
    var hay = [c.no, c.mill, c.po, c.transporter, c.invoice, c.lr].concat(c.rows.map(function (r) { return r.fabricType + ' ' + r.lot + ' ' + fabRfdOfGreige(r.fabricType); })).join(' ').toLowerCase();
    if (hay.indexOf(UI.q) < 0) return false;
  }
  return true;
}

/* ---- the figures across the top: each one a filter ------------------------------------------ */
function poKpis() {
  var pos = DB.gpo || [], chs = chList();
  var live = pos.filter(function (p) { return gpoStatus(p) !== 'cancelled'; });
  var notSent = live.filter(function (p) { return gpoStatus(p) === 'open'; });
  var part = live.filter(function (p) { return gpoStatus(p) === 'part'; });
  var due = part.reduce(function (s, p) { return s + gpoProgress(p).pending; }, 0);
  var pcs = chs.reduce(function (s, c) { return s + chPcs(c); }, 0), m = chs.reduce(function (s, c) { return s + chM(c); }, 0);
  var tc = chs.filter(chToCheck).length;
  var short = 0, shortN = 0;
  chs.forEach(function (c) { c.rows.forEach(function (r) { (r.pieces || []).forEach(function (p) { if (p.chk != null && p.chk - p.m <= -0.05) { short += p.m - p.chk; shortN++; } }); }); });
  var value = live.reduce(function (s, p) { return s + gpoTotals(p).amount; }, 0);
  var sentL = live.filter(function (p) { return gpoStatus(p) === 'sent'; }), recL = live.filter(function (p) { return gpoStatus(p) === 'received'; });
  var cards = [
    { k: '', v: nf(live.length), l: 'Greige POs', s: RUPEE + nf(value) + ' goods value', ic: 'doc', tone: 'blue' },
    { k: 'sent', v: nf(sentL.length), l: 'Sent', s: nf(sentL.reduce(function (s, p) { return s + gpoProgress(p).ordered; }, 0)) + ' m awaited from the supplier', ic: 'mail', tone: 'amber' },
    { k: 'part', v: nf(part.length), l: 'Part received', s: nf(due) + ' m still due', ic: 'half', tone: 'blue' },
    { k: 'received', v: nf(recL.length), l: 'Received', s: nf(recL.reduce(function (s, p) { return s + gpoProgress(p).received; }, 0)) + ' m in', ic: 'check', tone: 'green' }
  ];
  return '<div class="gk-row">' + cards.map(function (k) {
    var on = PV.st === k.k && k.k;
    return '<button type="button" class="gk' + (on ? ' on' : '') + '" data-kpi="' + k.k + '"'
      + (k.k ? ' title="Show only these"' : ' title="Show every PO"') + '>'
      + '<span class="gk-ic tone-' + k.tone + '">' + I[k.ic] + '</span>'
      + '<span class="gk-v">' + esc(k.v) + '</span><span class="gk-l">' + esc(k.l) + '</span>'
      + '<span class="gk-s">' + esc(k.s) + '</span></button>';
  }).join('') + '</div>';
}

/* ---- the pieces of one challan -------------------------------------------------------------- */
function diffSpan(p) {
  if (p.chk == null) return '<span class="d ok">—</span>';
  var d = r1(p.chk - p.m);
  if (d <= -0.05) return '<span class="d short">−' + m1(-d) + '</span>';
  if (d >= 0.05) return '<span class="d extra">+' + m1(d) + '</span>';
  return '<span class="d ok">ok</span>';
}
function piecesHtml(c) {
  var k = chCheck(c);
  if (!k.n) {
    return '<div class="pieces"><div class="pieces-head"><span>This receipt was typed into the ledger as one figure, so it has no pieces to measure. '
      + 'The next challan, received from its PO, lists its bales.</span></div></div>';
  }
  return '<div class="pieces"><div class="pieces-head"><span>Metres as the supplier wrote them on the challan, and the metres you measure at the door.</span>'
    + (k.done < k.n ? '<button type="button" class="jw-btn" data-fill="' + esc(c.id) + '">Fill the rest as per challan</button>' : '') + '</div>'
    + c.rows.map(function (r) {
      var ps = r.pieces || [];
      if (!ps.length) return '';
      var sum = r1(ps.reduce(function (s, p) { return s + (+p.m || 0); }, 0));
      return '<div><div class="pl-h"><b>' + esc(r.fabricType) + '</b> <span class="sub">→ ' + esc(fabRfdOfGreige(r.fabricType) || r.fabricType)
        + ' · lot <b>' + esc(r.lot) + '</b> · ' + plural(ps.length, 'bale') + ' · ' + m1(sum) + ' m</span>'
        + (Math.abs(sum - c.rows.filter(function (x) { return x.lot === r.lot; }).reduce(function (s, x) { return s + fabQty(x); }, 0)) > 0.05 ? ' <span class="pill pill-out">ledger says ' + m1(fabQty(r)) + ' m</span>' : '') + '</div>'
        + '<div class="pgrid">' + ps.map(function (p, pi) {
          var key = r.id + '|' + pi, id = 'pc-' + r.id + '-' + pi, short = p.chk != null && p.chk - p.m <= -0.05;
          return '<div class="pc' + (short ? ' short' : '') + '" id="' + id + '"><div class="pc-top"><span>Bale ' + esc(p.than) + '</span><span id="pd-' + r.id + '-' + pi + '">' + diffSpan(p) + '</span></div>'
            + '<div class="pc-m">' + m1(p.m) + ' m</div>'
            + '<label class="pc-lab" for="chk-' + r.id + '-' + pi + '">measured</label><input id="chk-' + r.id + '-' + pi + '" type="number" step="0.1" min="0" inputmode="decimal" data-chk="' + esc(key) + '" value="' + (p.chk == null ? '' : p.chk) + '" placeholder="m"></div>';
        }).join('') + '</div></div>';
    }).join('') + '</div>';
}

/* ---- By PO ---------------------------------------------------------------------------------- */
function poRow(po) {
  var p = gpoProgress(po), st = gpoStatus(po), pct = p.ordered ? Math.round(p.received / p.ordered * 100) : 0;
  var chs = chOfPo(po.poNo), open = !!PV.openPo[po.poNo], l0 = (po.lines || [])[0] || {}, more = (po.lines || []).length - 1;
  var acts = '';
  var canRcv = ['open', 'sent', 'part'].indexOf(st) >= 0 && p.pending > 0.05;
  if (canRcv) acts += '<button type="button" class="jw-btn jw-primary" data-rcv="' + esc(po.poNo) + '">Receive</button>';
  if (issLotsOf(po).length) acts += '<button type="button" class="jw-btn jw-wa" data-iss="' + esc(po.poNo) + '">Issue to RFD</button>';
  if (rrLotsOf(po).length) acts += '<button type="button" class="jw-btn jw-wa" data-rr="' + esc(po.poNo) + '">Receive RFD</button>';
  if (['open', 'sent', 'part'].indexOf(st) >= 0) acts += '<button type="button" class="jw-btn" data-pedit="' + esc(po.poNo) + '">Edit</button>';
  acts += '<button type="button" class="jw-btn" data-doc="' + esc(po.poNo) + '">Print</button>'
    + '<button type="button" class="jw-btn ico" data-doc="' + esc(po.poNo) + '" title="Mail the PO" aria-label="Mail ' + esc(po.poNo) + '">' + I.mail + '</button>'
    + '<a class="jw-btn ico wa" href="' + esc(poWaUrl(po)) + '" target="_blank" rel="noopener" title="Send on WhatsApp" aria-label="Send ' + esc(po.poNo) + ' on WhatsApp">' + WA_ICON + '</a>';
  var h = '<tr class="xrow' + (open ? ' open' : '') + '" data-tpo="' + esc(po.poNo) + '">'
    + '<td class="w-chev"><button type="button" class="chev" data-tpo="' + esc(po.poNo) + '" aria-expanded="' + open + '" aria-label="Challans for ' + esc(po.poNo) + '">' + I.chev + '</button></td>'
    + '<td class="tl"><div class="b">' + esc(po.poNo) + '</div>' + (po.supplementOf ? '<div class="sub"><span class="pill pill-sea">Supplement to ' + esc(po.supplementOf) + '</span></div>' : '') + '<div class="sub">' + esc(fmtD(po.date)) + (more > 0 ? ' · ' + (more + 1) + ' lines' : ' · due ' + esc(fmtD(gpoDueOf(po)))) + '</div></td>'
    + '<td class="tl">' + millCell(po.mill) + '</td>'
    + '<td class="tl"><div class="b">' + esc(lineGreigeText(l0)) + (more > 0 ? ' <span class="plus">+' + more + '</span>' : '') + '</div>'
    + '<div class="sub">→ ' + esc((po.lines || []).map(function (l) { return l.rfd; }).join(', ')) + '</div></td>'
    + '<td class="num">' + nf(p.ordered) + ' m</td>'
    + '<td><div class="prog">' + ring(pct) + '<div><div>' + nf(p.received) + ' m</div><div class="sub">' + pct + '%</div></div></div></td>'
    + '<td class="tl">' + poPill(po) + '<div class="sub" style="margin-top:4px">' + (chs.length ? plural(chs.length, 'challan') + ' · ' + plural(chs.reduce(function (s, c) { return s + chPcs(c); }, 0), 'bale') : 'no challan yet') + '</div></td>'
    + '<td class="num"><div class="b">' + RUPEE + nf(gpoTotals(po).amount) + '</div><div class="sub">goods value</div></td>'
    + '<td><div class="actions">' + acts + '</div></td></tr>';
  if (open) h += '<tr class="detail"><td colspan="9">' + poPanel(po) + '</td></tr>';
  return h;
}
function poPanel(po) {
  var p = gpoProgress(po), chs = chOfPo(po.poNo), t = gpoTotals(po), st = gpoStatus(po);
  /* THE PO'S LINES AS LINE ITEMS (Ravi, 13 Oct: "isko line item main dikhao na ki dabbe main"): one row per
   * greige bought, read across the way the PO itself is written -- what, becomes what, due, how much has come,
   * what is still due, and the money. */
  var items = p.lines.map(function (l, i) {
    var pc = l.ordered ? Math.min(100, l.received / l.ordered * 100) : 0, m = gpoLineMoney(l);
    var sent = fabLots().filter(function (g) { return String(g.poNo).toUpperCase() === po.poNo.toUpperCase() && String(g.fabricType).toLowerCase() === String(l.greige).toLowerCase(); }).reduce(function (s, g) { return s + g.toRfd; }, 0);
    var left = l.pending > 0.05 ? '<b class="due">' + nf(l.pending) + ' m</b>'
      : (l.received > l.ordered + 0.05 ? '<span class="d extra">' + nf(l.received - l.ordered) + ' m extra</span>' : '<span class="pill pill-ok">complete</span>');
    return '<tr><td class="num muted">' + (i + 1) + '</td>'
      + '<td class="tl"><b>' + esc(lineGreigeText(l)) + '</b><div class="sub">' + esc(l.greige) + '</div></td>'
      + '<td class="tl">' + esc(lineRfdText(l)) + '</td>'
      + '<td class="tl">' + esc(fmtD(l.due || po.date)) + '</td>'
      + '<td class="num">' + nf(l.ordered) + ' m</td>'
      + '<td class="num">' + nf(l.received) + ' m<div class="bar sm"><i class="' + (pc >= 100 ? 'full' : '') + '" style="width:' + pc.toFixed(1) + '%"></i></div></td>'
      + '<td class="num">' + left + '</td>'
      + '<td class="num">' + (sent ? nf(sent) + ' m' : '<span class="muted">—</span>') + '</td>'
      + '<td class="num">' + RUPEE + money(l.rate) + '</td>'
      + '<td class="num b">' + RUPEE + money(m.amount) + '</td></tr>';
  }).join('');
  var lineTable = '<div class="box scroll"><table class="ct li"><thead><tr><th class="num">#</th><th>Greige fabric</th><th>RFD ready fabric</th><th>Due on</th>'
    + '<th class="num">Ordered</th><th class="num">Received</th><th class="num">Still due</th><th class="num">Sent to RFD</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>'
    + '<tbody>' + items + '<tr class="tot"><td></td><td class="tl" colspan="3">Total</td><td class="num">' + nf(p.ordered) + ' m</td><td class="num">' + nf(p.received) + ' m</td>'
    + '<td class="num">' + (p.pending > 0.05 ? '<b class="due">' + nf(p.pending) + ' m</b>' : '—') + '</td><td></td><td></td><td class="num b">' + RUPEE + money(t.amount) + '</td></tr></tbody></table></div>';
  var head = '<div class="panel-head"><div class="sect">Line items</div>'
    + '<div class="row">' + (issLotsOf(po).length ? '<button type="button" class="ghost" data-iss="' + esc(po.poNo) + '">Issue to RFD</button>' : '')
    + (rrLotsOf(po).length ? '<button type="button" class="ghost" data-rr="' + esc(po.poNo) + '">Receive RFD</button>' : '')
    + (p.pending > 0.05 && ['open', 'sent', 'part'].indexOf(st) >= 0 ? '<button type="button" data-rcv="' + esc(po.poNo) + '">Receive greige</button>' : '') + '</div></div>'
    + lineTable + '<div class="sect" style="margin-top:4px">Challans received</div>';
  var list;
  if (!chs.length) {
    list = '<div class="box"><div class="empty">No challan yet. ' + (po.sent ? 'When the supplier’s challan arrives, press Receive greige and type its bales.'
      : 'This PO has not gone to the supplier yet, so no greige is expected.') + '</div></div>';
  } else {
    list = '<div class="box scroll"><table class="ct"><thead><tr><th class="w-chev"></th><th>Challan no.</th><th>Date</th><th>Transport / LR</th><th>Cloth</th><th>Lots</th>'
      + '<th class="num">Pieces</th><th class="num">Metres</th><th>Checked</th></tr></thead><tbody>'
      + chs.map(function (c) { return chRow(c, false); }).join('') + '</tbody></table></div>';
  }
  var sups = (DB.gpo || []).filter(function (x) { return x.supplementOf === po.poNo; });
  var foot = (sups.length ? '<div class="panel-foot"><span>Supplement POs: ' + sups.map(function (x) { return '<b>' + esc(x.poNo) + '</b> (' + nf(gpoTotals(x).metres) + ' m)'; }).join(', ') + '</span></div>' : '') + '<div class="panel-foot"><span class="muted">' + esc(inrWords(t.amount)) + '</span><span class="grow"></span>'
    + (po.closed ? '<span class="muted">Closed ' + esc(fmtD(po.closed.at)) + ' · ' + nf(po.closed.short) + ' m not supplied (' + esc(po.closed.by || '') + ')</span>'
      + '<button type="button" class="ghost" id="pc-' + esc(po.id) + '" data-pclose="' + esc(po.poNo) + '">Reopen the PO</button>'
      : (st === 'part' ? '<button type="button" class="ghost" id="pc-' + esc(po.id) + '" data-pclose="' + esc(po.poNo) + '">Close the PO</button>' : ''))

    + '<button type="button" class="ghost" data-doc="' + esc(po.poNo) + '">Open the PO</button></div>';
  return '<div class="panel">' + head + list + foot + '</div>';
}
/* One challan row; `wide` adds the mill and the PO for the Challans view. */
function chRow(c, wide) {
  var open = !!PV.openCh[c.id], cols = wide ? 11 : 9, d = lmDays(c.date);
  var h = '<tr class="xrow' + (open ? ' open' : '') + '" data-tch="' + esc(c.id) + '">'
    + '<td class="w-chev"><button type="button" class="chev" data-tch="' + esc(c.id) + '" aria-expanded="' + open + '" aria-label="Pieces on challan ' + esc(c.no || c.id) + '">' + I.chev + '</button></td>'
    + '<td class="tl"><span class="b mono">' + (c.no ? esc(c.no) : '<span class="muted">no number</span>') + '</span></td>'
    + '<td class="tl">' + esc(fmtD(c.date)) + '<div class="sub">' + (d === null ? '' : d === 0 ? 'today' : daysWord(d) + ' ago') + '</div></td>'
    + (wide ? '<td class="tl">' + millCell(c.mill) + '</td><td class="tl">' + (c.po ? '<span class="b">' + esc(c.po) + '</span>' : '<span class="muted">no PO</span>') + '</td>' : '')
    + '<td class="tl">' + (c.transporter ? esc(c.transporter) : '') + (c.lr ? '<div><span class="plate">' + esc(c.lr) + '</span></div>' : (c.transporter ? '' : '<span class="sub">—</span>'))
    + (c.invoice ? '<div class="sub">Invoice ' + esc(c.invoice) + '</div>' : '') + '</td>'
    + '<td class="tl">' + esc(chCloth(c)) + '</td>'
    + '<td class="tl mono">' + esc(c.rows.map(function (r) { return r.lot; }).join(', ')) + '</td>'
    + '<td class="num">' + (chPcs(c) || '<span class="muted">—</span>') + '</td><td class="num b">' + m1(chM(c)) + ' m</td>'
    + '<td class="tl" data-chsum="' + esc(c.id) + '">' + checkPill(c) + '</td></tr>';
  if (open) h += '<tr class="detail"><td colspan="' + cols + '">' + piecesHtml(c) + '</td></tr>';
  return h;
}

function renderPo() {
  var pos = (DB.gpo || []).filter(poPass).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || String(b.poNo).localeCompare(String(a.poNo)); });
  var all = chList(), chs = all.filter(chPass).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || String(b.no).localeCompare(String(a.no)); });
  var mills = uniq((DB.gpo || []).map(function (p) { return p.mill; }).concat(all.map(function (c) { return c.mill; }))).sort();
  var opt = function (v, l, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>'; };
  /* First the PO, then what comes against it: receiving starts from an open PO's own row. */
  var bar = '<div class="pobar"><button type="button" data-act="po">+ Greige PO</button>'
    + '<span class="muted" style="align-self:center;font-size:12.5px">Greige is received against its PO: press <b>Receive</b> on an open PO.</span></div>';
  var filters = '<div class="card filters"><div class="frow">'
    + '<select id="pvSt" aria-label="Status">' + opt('', 'Any status', PV.st) + opt('sent', 'Sent', PV.st) + opt('part', 'Part received', PV.st) + opt('received', 'Received', PV.st) + '</select>'
    + '<select id="pvMill" aria-label="Supplier">' + opt('', 'All suppliers', PV.mill) + mills.map(function (m) { return opt(m, m, PV.mill); }).join('') + '</select>'
    + '<span class="pair"><label class="inl" for="pvFrom">From</label><input id="pvFrom" type="date" value="' + esc(PV.from) + '"></span>'
    + '<span class="pair"><label class="inl" for="pvTo">To</label><input id="pvTo" type="date" value="' + esc(PV.to) + '"></span>'
    + ((PV.st || PV.mill || PV.from || PV.to) ? '<button type="button" class="jw-btn" data-pvclear="1">Clear</button>' : '')
    + '</div><div class="frow2"><div class="seg" role="tablist" aria-label="View">'
    + '<button type="button" role="tab" class="segbtn' + (PV.view === 'po' ? ' on' : '') + '" aria-selected="' + (PV.view === 'po') + '" data-pv="po">By PO <span class="n">' + nf((DB.gpo || []).length) + '</span></button>'
    + '<button type="button" role="tab" class="segbtn' + (PV.view === 'ch' ? ' on' : '') + '" aria-selected="' + (PV.view === 'ch') + '" data-pv="ch">Challans <span class="n">' + nf(all.length) + '</span></button>'
    + '</div><span class="muted count">' + (PV.view === 'po' ? nf(pos.length) + ' of ' + plural((DB.gpo || []).length, 'PO') : nf(chs.length) + ' of ' + plural(all.length, 'challan')) + '</span></div></div>';
  var list;
  if (PV.view === 'po') {
    list = pos.length
      ? '<table class="t"><thead><tr><th class="w-chev"></th><th>PO</th><th>Supplier</th><th>Greige → comes back as</th><th class="num">Ordered</th><th>Received</th>'
        + '<th>Status</th><th class="num">Amount</th><th class="ra">Actions</th></tr></thead><tbody>' + pos.map(poRow).join('') + '</tbody></table>'
      : '<div class="empty">No PO matches these filters.</div>';
  } else {
    list = chs.length
      ? '<table class="t ct"><thead><tr><th class="w-chev"></th><th>Challan no.</th><th>Date</th><th>Supplier</th><th>Against PO</th><th>Transport / LR</th><th>Cloth</th><th>Lots</th>'
        + '<th class="num">Pieces</th><th class="num">Metres</th><th>Checked</th></tr></thead><tbody>' + chs.map(function (c) { return chRow(c, true); }).join('') + '</tbody></table>'
      : '<div class="empty">No challan matches these filters.</div>';
  }
  return bar + rrApprovalsHtml() + poKpis() + filters + '<div class="card tablecard"><div class="scroll">' + list + '</div></div>'
    + '<p class="foot">A PO rarely comes in one go. The supplier sends greige over several challans, and each challan is a bundle '
    + 'of bales with the metres written against them. When the last one is in, close the PO and what never came is written on it. Every challan is written into the fabric ledger as a new lot, so stock, the '
    + 'processor and the dashboard count it at once.</p>';
}

/* ---- RECEIVE GREIGE: always against an open PO ------------------------------------------------ *
 *
 * Ravi, 13 Oct: "pahle greige PO hona chahiye and receive action open PO par hi hona chahiye, and receive
 * greige window me complete PO show chahiye". So the window is opened from the PO's own row, it shows the
 * whole PO -- every line, what has come so far on which challan -- and the supplier's challan is typed bale
 * by bale under the lines still due. A PO that comes in several challans can be closed with its last one. */
var RD = null;
function rdNextBale(ps) {
  for (var i = ps.length - 1; i >= 0; i--) { var t = String(ps[i].than).trim(); if (/^\d+$/.test(t)) return String(+t + 1); }
  return '';
}
/* The lots this challan will open: the next numbers in the series, one per line still due -- each can be
 * typed over with the lot the store writes on the bales. */
function rdInitLines() {
  RD.lines = {}; RD.paste = {}; RD.lot = {};
  var po = poFind(RD.po); if (!po) return;
  var n = parseInt(fabNextLot().slice(4), 10);
  gpoProgress(po).lines.forEach(function (l, i) {
    if (l.pending <= 0.05) return;
    RD.lines[i] = [{ than: '', m: '' }];
    var s = String(n++); while (s.length < 3) s = '0' + s;
    RD.lot[i] = 'LOT-' + s;
  });
}
/* THE WHOLE PO, read before anything is typed: who it is with, every line, and the challans already in. */
function rdPoHtml(po) {
  var p = gpoProgress(po), chs = chOfPo(po.poNo);
  var lines = '<table class="ct mini"><thead><tr><th>Greige fabric</th><th>RFD ready fabric</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Due</th></tr></thead><tbody>'
    + p.lines.map(function (l) {
      return '<tr><td class="tl"><b>' + esc(lineGreigeText(l)) + '</b><div class="sub">' + esc(l.greige) + '</div></td>'
        + '<td class="tl">' + esc(l.rfd) + '</td><td class="num">' + nf(l.ordered) + ' m</td><td class="num">' + nf(l.received) + ' m</td>'
        + '<td class="num">' + (l.pending > 0.05 ? '<b class="due">' + nf(l.pending) + ' m</b>' : '<span class="pill pill-ok">complete</span>') + '</td></tr>';
    }).join('')
    + '<tr class="tot"><td class="tl" colspan="2">Total · ' + RUPEE + nf(gpoTotals(po).amount) + ' goods value</td><td class="num">' + nf(p.ordered) + ' m</td><td class="num">' + nf(p.received) + ' m</td><td class="num"><b>' + nf(p.pending) + ' m</b></td></tr>'
    + '</tbody></table>';
  var earlier = chs.length
    ? '<div class="sub" style="margin-top:8px">Already in: ' + chs.map(function (c) {
        return '<b>' + esc(c.no || 'no number') + '</b> ' + esc(fmtD(c.date)) + ' · ' + plural(chPcs(c), 'bale') + ' · ' + m1(chM(c)) + ' m';
      }).join(' &nbsp;|&nbsp; ') + '</div>'
    : '<div class="sub" style="margin-top:8px">Nothing received against this PO yet.</div>';
  return '<div class="pohead"><div class="pohead-top"><div><div class="b" style="font-size:15px">' + esc(po.poNo) + '</div>'
    + '<div class="sub">' + esc(fmtD(po.date)) + ' · due ' + esc(fmtD(gpoDueOf(po))) +  + '</div></div>'
    + '<div style="text-align:right"><div class="sub">Supplier</div><div class="b">' + esc(po.mill) + '</div></div></div>'
    + '<div class="scroll">' + lines + '</div>' + earlier + '</div>';
}
function rdDraw() {
  var po = poFind(RD.po); if (!po) return;
  var pg = gpoProgress(po);
  $('dPo').innerHTML = rdPoHtml(po);
  $('dLines').innerHTML = Object.keys(RD.lines).map(function (k) {
    var li = +k, l = pg.lines[li], ps = RD.lines[li];
    return '<div class="dl"><div class="dl-top"><div><div class="b">' + esc(lineGreigeText(l)) + '</div><div class="sub">' + esc(l.greige) + ' → RFD ' + esc(l.rfd)
      + ' · <b>' + nf(l.pending) + ' m still due</b> · up to ' + nf(rdRoom(l)) + ' m with the 10% allowance</div></div>'
      + '<label class="fld lotf" for="lot-' + li + '"><span>Lot no.</span><input id="lot-' + li + '" value="' + esc(RD.lot[li] || '') + '" readonly title="Given by the register; it cannot be changed"></label></div>'
      + '<div class="prh"><span></span><span>Bale no.</span><span>Metres (on challan) *</span><span></span></div>'
      + ps.map(function (p, pi) {
        return '<div class="pr"><span class="pr-i">' + (pi + 1) + '</span>'
          + '<input id="pt-' + li + '-' + pi + '" data-li="' + li + '" data-pi="' + pi + '" data-f="than" value="' + esc(p.than) + '" placeholder="Bale no." aria-label="Bale number ' + (pi + 1) + '">'
          + '<input id="pm-' + li + '-' + pi + '" data-li="' + li + '" data-pi="' + pi + '" data-f="m" type="number" step="0.1" min="0" inputmode="decimal" value="' + esc(p.m) + '" placeholder="Metres" aria-label="Metres, bale ' + (pi + 1) + '">'
          + '<button type="button" class="x" data-dr="rm" data-li="' + li + '" data-pi="' + pi + '" aria-label="Remove bale ' + (pi + 1) + '">×</button></div>';
      }).join('')
      + '<div class="dl-actions"><button type="button" class="jw-btn" data-dr="add" data-li="' + li + '">+ Bale</button>'
      + '<span class="dl-sum" id="dlsum-' + li + '"></span></div>'
      + '<div class="warnline" id="dlwarn-' + li + '"></div></div>';
  }).join('');
  rdSums();
}
/** The supplement PO a PO's next one will be: its own number, -S1, -S2. */
function supNoFor(po) {
  var n = (DB.gpo || []).filter(function (p) { return p.supplementOf === po.poNo; }).length + 1;
  return po.poNo + '-S' + n;
}
/* THE 10% ALLOWANCE (Ravi, 13 Oct: "greig receiving tolerance of error should be marginal 10 percent"): a line
 * may take in up to 10% more than it ordered, never more. */
var RD_TOL = 0.10;
function rdRoom(l) { return Math.max(0, r1(l.ordered * (1 + RD_TOL) - l.received)); }
function rdSums() {
  var po = poFind(RD.po), tp = 0, tm = 0, left = 0;
  if (po) {
    var pg = gpoProgress(po);
    left = pg.pending;
    Object.keys(RD.lines).forEach(function (k) {
      var li = +k, ps = RD.lines[li].filter(function (p) { return +p.m > 0; }), s = r1(ps.reduce(function (a, p) { return a + (+p.m || 0); }, 0));
      tp += ps.length; tm += s;
      var el = $('dlsum-' + li); if (el) el.textContent = plural(ps.length, 'bale') + ' · ' + m1(s) + ' m';
      var w = $('dlwarn-' + li), room = rdRoom(pg.lines[li]);
      if (w) {
        var over = s > room + 0.05, extra = r1(s - pg.lines[li].pending);
        if (over && RD.sup[li]) { w.className = 'supline'; w.innerHTML = '<b>Supplement PO</b> ' + esc(supNoFor(po)) + ' will be made for <b>' + m1(extra) + ' m</b> of ' + esc(pg.lines[li].greige) + ' at ' + RUPEE + money(pg.lines[li].rate) + ', and received on this challan. '
          + '<button type="button" class="link" data-dr="sup" data-li="' + li + '">Don’t make it</button>'; }
        else if (over) { w.className = 'err'; w.innerHTML = esc(m1(s - room) + ' m over the 10% allowance on this line (' + nf(room) + ' m can still come). ')
          + '<div style="margin-top:8px"><button type="button" data-dr="sup" data-li="' + li + '">+ Supplement PO for ' + m1(extra) + ' m</button></div>'; }
        else { if (RD.sup[li]) RD.sup[li] = false; w.className = 'warnline'; w.textContent = extra > 0.05 ? m1(extra) + ' m more than still due, inside the 10% allowance.' : ''; }
      }
    });
  }
  var after = Math.max(0, r1(left - tm));
  $('dTotal').innerHTML = '<span>Challan total</span><span class="tnum">' + plural(tp, 'bale') + ' · ' + m1(tm) + ' m</span>';
  /* THE LAST CHALLAN CLOSES THE PO -- offered only while something would still be left open. */
  $('dCloseWrap').hidden = !(after > 0.05);
  $('dCloseTxt').textContent = 'This is the supplier’s last challan: close the PO with ' + nf(after) + ' m not supplied';
}
function openDrawer(poNo) {
  var po = poFind(poNo), st = gpoStatus(po);
  if (!po) { lmSay('warn', 'Receive greige from its PO: open the PO on Greige POs and press Receive.'); UI.tab = 'po'; render(); return; }
  if (st === 'received' || st === 'cancelled') { lmSay('warn', po.poNo + ' is ' + (GPO_STATUS[st] || [st])[0].toLowerCase() + '. Nothing more is expected on it.'); return; }
  RD = { po: po.poNo, lines: {}, paste: {}, lot: {}, sup: {} };
  rdInitLines(); rdDraw();
  $('dNo').value = ''; $('dLr').value = ''; $('dInv').value = ''; $('dTrn').value = ''; $('dDate').value = lmToday(); $('dClose').checked = false;
  $('dErr').hidden = true;
  $('drTitle').textContent = 'Challan against ' + po.poNo;
  $('scrim').hidden = false; $('drawer').hidden = false;
  $('dNo').focus();
}
function closeDrawer() { $('scrim').hidden = true; $('drawer').hidden = true; RD = null; }
function rdAddPiece(li) {
  var ps = RD.lines[li]; ps.push({ than: rdNextBale(ps), m: '' });
  rdDraw(); var el = $('pm-' + li + '-' + (ps.length - 1)); if (el) el.focus();
}
function rdPaste(li) {
  var txt = ($('paste-' + li) || {}).value || '', add = [];
  txt.split(/\n/).forEach(function (line) {
    var nums = line.match(/\d+(?:\.\d+)?/g) || [];
    if (nums.length === 2 && /^\d+$/.test(nums[0]) && +nums[0] > 999) add.push({ than: nums[0], m: nums[1] });
    else nums.forEach(function (n) { if (+n > 0) add.push({ than: '', m: n }); });
  });
  if (!add.length) { lmSay('warn', 'No metres found in the list. Put one bale on each line.'); return; }
  var ps = RD.lines[li].filter(function (p) { return String(p.than).trim() || String(p.m).trim(); });
  add.forEach(function (p) { if (!p.than) p.than = rdNextBale(ps); ps.push(p); });
  RD.lines[li] = ps; RD.paste[li] = false; rdDraw();
  lmSay('ok', plural(add.length, 'bale') + ' added.');
}
/* SAVING A CHALLAN WRITES THE LEDGER: one "Greige received" row per fabric on it, each opening the lot typed
 * for it (one receipt per lot, as the ledger insists), the challan number as the bill, the PO named, and the
 * bales riding on the row. Ticked as the last challan, the PO is closed short as well. */
function rdSave() {
  var errs = [], po = poFind(RD.po), no = $('dNo').value.trim();
  if (!po) return;
  if (!no) errs.push('Type the supplier’s challan number. It is printed at the top of their challan.');
  if (no && chList().some(function (c) { return String(c.mill).toLowerCase() === String(po.mill).toLowerCase() && String(c.no).toLowerCase() === no.toLowerCase(); })) {
    errs.push('Challan ' + no + ' from ' + po.mill + ' is already in. Check the number.');
  }
  if (!$('dDate').value) errs.push('Fill in the challan date.');
  var pg = gpoProgress(po), seen = {};
  var lines = Object.keys(RD.lines).map(Number).sort(function (a, b) { return a - b; }).map(function (li) {
    return { li: li, lot: String(RD.lot[li] || '').trim().toUpperCase(),
      pieces: RD.lines[li].filter(function (p) { return +p.m > 0; }).map(function (p) { return { than: String(p.than).trim() || '—', m: r1(+p.m), chk: null }; }) };
  }).filter(function (l) { return l.pieces.length; });
  if (!lines.length) errs.push('Add at least one bale with its metres.');
  lines.forEach(function (l) {
    var name = pg.lines[l.li].rfd, got = r1(l.pieces.reduce(function (s, p) { return s + p.m; }, 0)), room = rdRoom(pg.lines[l.li]);
    l.sup = got > room + 0.05 && RD.sup[l.li] ? r1(got - pg.lines[l.li].pending) : 0;
    if (got > room + 0.05 && !l.sup) errs.push(name + ': ' + m1(got) + ' m is over the 10% allowance (' + nf(room) + ' m can still come on this PO). Take bales off, or add a supplement PO.');
    if (!l.lot) errs.push('Give the ' + name + ' bales a lot number.');
    else if (seen[l.lot]) errs.push('Lot ' + l.lot + ' is on two lines. Each fabric opens its own lot.');
    else if (fabLot(l.lot)) errs.push('Lot ' + l.lot + ' is already in the register. A new delivery opens a new lot.');
    seen[l.lot] = 1;
    var dup = {}; l.pieces.forEach(function (p) { if (p.than !== '—') { if (dup[p.than]) errs.push(name + ': bale ' + p.than + ' is typed twice.'); dup[p.than] = 1; } });
  });
  if (errs.length) { $('dErr').innerHTML = uniq(errs).map(esc).join('<br>'); $('dErr').hidden = false; return; }
  var chId = uid(), date = $('dDate').value, lr = $('dLr').value.trim(), inv = $('dInv').value.trim(), trn = $('dTrn').value.trim();
  /* THE SUPPLEMENT PO (Ravi, 13 Oct): the supplier sent more than the PO and its 10% allowance. The PO takes what
   * was still due; a supplement PO on the same supplier, fabric and rate is raised for the rest and received on this
   * same challan, as the same lot. One supplement PO carries every line that needed one. */
  var supLines = lines.filter(function (l) { return l.sup > 0; }), sup = null;
  if (supLines.length) {
    sup = { id: uid(), poNo: supNoFor(po), date: lmToday(), mill: po.mill, sent: { at: lmToday() }, supplementOf: po.poNo,
      pay: po.pay || '', disp: po.disp || '', dest: po.dest || '', terms: po.terms || '', other: 'Supplement to ' + po.poNo + ', challan ' + no,
      lines: supLines.map(function (l) { var pl = po.lines[l.li]; return { rfd: pl.rfd, greige: pl.greige, desc: pl.desc || ('RFD ready: ' + pl.rfd), due: lmToday(), metres: l.sup, rate: pl.rate }; }) };
    DB.gpo.push(sup);
  }
  lines.forEach(function (l) {
    var pl = pg.lines[l.li], got = r1(l.pieces.reduce(function (s, p) { return s + p.m; }, 0));
    DB.fab.push({ id: uid(), chId: chId, date: date, lot: l.lot, fabricType: pl.greige, txnType: 'RECEIVE_GREIGE',
      qty: r1(got - l.sup), party: po.mill, bill: no, orderNo: po.poNo,
      lr: lr, invoice: inv, transporter: trn, pieces: l.pieces, done: false });
    if (l.sup) DB.fab.push({ id: uid(), chId: chId, date: date, lot: l.lot, fabricType: pl.greige, txnType: 'RECEIVE_GREIGE',
      qty: l.sup, party: po.mill, bill: no, orderNo: sup.poNo, supplementOf: po.poNo, lr: lr, invoice: inv, transporter: trn, done: false });
  });
  var closing = $('dClose').checked && !$('dCloseWrap').hidden, shortM = 0;
  if (closing) { shortM = gpoProgress(po).pending; po.closed = { at: date, short: shortM, by: 'challan ' + no }; }
  lmSaveDb();
  PV.openPo[po.poNo] = true; PV.openCh[chId] = true;
  var c = chBy(chId);
  closeDrawer(); if (UI.tab !== 'inv') UI.tab = 'po'; render();
  lmSay('ok', 'Challan ' + no + ' in against ' + po.poNo + ': ' + plural(chPcs(c), 'bale') + ', ' + m1(chM(c)) + ' m, as '
    + lmList(lines.map(function (l) { return l.lot; })) + '.' + (closing ? ' ' + po.poNo + ' closed with ' + nf(shortM) + ' m not supplied.' : '')
    + (sup ? ' Supplement PO ' + sup.poNo + ' raised and received for ' + nf(gpoTotals(sup).metres) + ' m.' : ''));
}
/* CLOSING A PO BY HAND: the supplier has said the rest is not coming. What did come stays; what did not is
 * written on the PO as not supplied, and the PO leaves every "still due" figure. Reopened, it counts again. */
function poCloseToggle(no, btn) {
  var po = poFind(no); if (!po) return;
  if (po.closed) { delete po.closed; lmSaveDb(); render(); lmSay('ok', po.poNo + ' is open again: ' + nf(gpoProgress(po).pending) + ' m due.'); return; }
  var due = gpoProgress(po).pending;
  if (!armed(btn, 'Press again to close with ' + nf(due) + ' m not supplied')) return;
  po.closed = { at: lmToday(), short: due, by: 'closed by hand' };
  lmSaveDb(); render(); lmSay('ok', po.poNo + ' closed. ' + nf(due) + ' m was not supplied.');
}


/* ---- THE PO DIALOG: A NEW PO, OR AN OPEN ONE EDITED ----------------------------------------- *
 *
 * Ravi, 13 Oct: the PO number runs RIDHI/PO/GREIG/001 and on; the date is the day it is raised and is never
 * changed; no discount; the RFD a line becomes comes from Master data and is not typed; the PO can be edited
 * from the list. What an edit may not do is undo what has already happened: a line that has received greige
 * keeps its fabric and cannot go below what came, and the supplier stays once anything has come from them. */
function poOpen(editNo) {
  var src = editNo ? poFind(editNo) : null;
  if (editNo && !src) return;
  if (src && ['received', 'closed', 'cancelled'].indexOf(gpoStatus(src)) >= 0) {
    lmSay('warn', src.poNo + ' is ' + String((GPO_STATUS[gpoStatus(src)] || [''])[0]).toLowerCase() + ', so it is no longer edited.'); return;
  }
  if (src) {
    PO_DRAFT = JSON.parse(JSON.stringify(src));
    var pg = gpoProgress(src);
    PO_DRAFT.lines.forEach(function (l, i) { l._rec = pg.lines[i] ? pg.lines[i].received : 0; l.descAuto = true; l.due = l.due || src.date; });
    PO_DRAFT.editId = src.id;
  } else {
    PO_DRAFT = { poNo: gpoNewNo(), date: lmToday(), mill: '', pay: '', disp: '', dest: '', terms: '', other: '', lines: [], editId: null };
    poAddLine();
  }
  $('poTitle').textContent = src ? 'Edit ' + src.poNo : 'New greige PO';
  $('poNo').value = PO_DRAFT.poNo;
  $('poDate').value = PO_DRAFT.date;
  $('poMill').value = PO_DRAFT.mill || '';
  ['pay', 'disp', 'dest', 'terms', 'other'].forEach(function (k) { $('po' + k.charAt(0).toUpperCase() + k.slice(1)).value = PO_DRAFT[k] || ''; });
  var locked = !!(src && gpoProgress(src).received > 0);
  $('poMill').readOnly = locked;
  $('poMillLock').textContent = locked ? 'Greige has come from this supplier on this PO, so the supplier stays.' : '';
  $('poMore').open = false;
  $('poMills').innerHTML = gpoMills().map(function (m) { return '<option value="' + esc(m) + '">'; }).join('');
  $('lmPoErr').classList.add('hide');
  var co = DB.co || {}, miss = !String(co.addr || '').trim() && !String(co.gstin || '').trim();
  $('poCoNote').classList.toggle('hide', !miss);
  $('poCoNote').textContent = miss ? 'Your own company details are not filled in yet — ' + (gdIsLinked() ? 'they come from the app\'s PO settings (ask an admin). ' : 'Master data → Company. ')
    + 'The PO will print without your address and GSTIN until they are.' : '';
  $('poSave').textContent = src ? 'Save the changes' : 'Save the PO';
  poDraw(); poMillHint();
  $('lmPo').classList.remove('hide');
  (locked ? $('poAdd') : $('poMill')).focus();
}
/** Under the supplier: whether this PO can be mailed or sent on WhatsApp, and whether it carries a GSTIN. */
function poMillHint() {
  var name = $('poMill').value.trim(), v = venByName(name), box = $('poMillNote');
  if (!name) { box.textContent = ''; return; }
  if (!v) { box.textContent = 'Not in Master data → Suppliers & RFD processors yet — the PO will carry the name only.'; return; }
  var bits = [v.email ? 'Mails to ' + v.email : 'no e-mail on record', v.phone ? 'WhatsApp ' + v.phone : 'no phone on record'];
  if (!v.gstin) bits.push('no GSTIN on record');
  box.textContent = bits.join(' · ');
}
function poAddLine() {
  var first = gpoFabrics()[0], rfd = first ? first.rfd : '';
  PO_DRAFT.lines.push({ rfd: rfd, greige: first ? first.greige : '', desc: 'RFD ready: ' + rfd, descAuto: true,
    due: PO_DRAFT.date || lmToday(), metres: '', rate: '', _rec: 0 });
  poDraw();
}
function poDraw() {
  var opts = gpoFabrics();
  $('poLines').innerHTML = th(['Greige fabric *', 'Description · RFD ready fabric', 'Due on *', 'Metres *', 'Rate *', 'Amount', ''], [3, 4, 5])
    + '<tbody>' + PO_DRAFT.lines.map(function (l, i) {
      var m = gpoLineMoney(l), spec = mstSpecLine(mstOf(l.rfd)), rec = +l._rec || 0;
      return '<tr data-row="' + i + '"><td class="frz" style="text-align:left">'
        + '<select data-li="' + i + '" data-f="greige" style="width:200px" aria-label="Greige fabric"' + (rec > 0 ? ' disabled title="Greige has come on this line, so its fabric stays."' : '') + '>'
        + opts.map(function (o) {
          return '<option value="' + esc(o.greige) + '"' + (o.greige === l.greige ? ' selected' : '') + '>' + esc(o.greige) + '</option>';
        }).join('') + '</select>'
        + '<div class="muted" style="font-size:10.5px;margin-top:3px">' + esc(poDesc(l.rfd)) + '</div></td>'
        /* THE RFD NAME IS READ, NOT TYPED: it comes from the fabric pair in Master data. */
        + '<td style="text-align:left"><div class="frozen" title="Set by Master data">' + esc(lineRfdText(l)) + '</div>'
        + (spec ? '<div class="muted" style="font-size:10.5px;margin-top:3px">' + esc(spec) + '</div>' : '') + '</td>'
        + '<td><input data-li="' + i + '" data-f="due" type="date" value="' + esc(l.due) + '" min="' + esc(PO_DRAFT.date) + '" style="width:138px" aria-label="Due on"></td>'
        + '<td><input data-li="' + i + '" data-f="metres" type="number" step="0.01" min="' + rec + '" value="' + esc(l.metres) + '" style="width:104px" aria-label="Metres">'
        + (rec > 0 ? '<div class="muted" style="font-size:10.5px;margin-top:3px">' + nf(rec) + ' m already in</div>' : '') + '</td>'
        + '<td><input data-li="' + i + '" data-f="rate" type="number" step="0.01" value="' + esc(l.rate) + '" style="width:84px" aria-label="Rate"></td>'
        + '<td class="num po-total">' + money(m.amount) + '</td>'
        + '<td>' + (rec > 0 ? '' : '<button type="button" class="lm-x" data-porm="' + i + '" aria-label="Remove this line">&times;</button>') + '</td></tr>';
    }).join('') + '</tbody>';
  poTotals();
}
/** The strip under the table: the total, and the total in words exactly as the PO will print it. */
function poTotals() {
  var t = gpoTotals(PO_DRAFT);
  $('poTot').innerHTML = '<b>' + nf(t.metres) + ' m</b> &middot; <b>' + RUPEE + ' ' + money(t.amount) + '</b>'
    + '<div class="muted" style="margin-top:2px">' + esc(inrWords(t.amount)) + '</div>';
}
/** One line's money, without taking the cursor out of the box being typed in. */
function poSyncRow(i) {
  var l = PO_DRAFT.lines[i];
  var tr = document.querySelector('#poLines tr[data-row="' + i + '"]');
  if (tr && l) tr.querySelector('.po-total').textContent = money(gpoLineMoney(l).amount);
  poTotals();
}
/** Save -- a new PO on the next number, or the open one changed in place -- and if asked, open it to send. */
function poSave(after) {
  PO_DRAFT.mill = $('poMill').value.trim();
  ['pay', 'disp', 'dest', 'terms', 'other'].forEach(function (k) {
    PO_DRAFT[k] = $('po' + k.charAt(0).toUpperCase() + k.slice(1)).value.trim();
  });
  var err = gpoCheck(PO_DRAFT);
  if (!err) {
    PO_DRAFT.lines.some(function (l) {
      if (!l.due) { err = 'Put a due date on ' + l.greige + '.'; return true; }
      if (+l._rec > 0 && (parseFloat(l.metres) || 0) < +l._rec - 0.05) { err = nf(l._rec) + ' m of ' + l.greige + ' has already come in, so the line cannot be less than that.'; return true; }
      return false;
    });
  }
  if (err) { $('lmPoErr').textContent = err; $('lmPoErr').classList.remove('hide'); return; }
  var po = JSON.parse(JSON.stringify(PO_DRAFT));
  po.lines.forEach(function (l) { delete l.descAuto; delete l._rec; delete l.disc; });
  delete po.editId;
  if (PO_DRAFT.editId) {
    var at = DB.gpo.map(function (p) { return p.id; }).indexOf(PO_DRAFT.editId), was = DB.gpo[at];
    /* The number, the date, and what has happened to it stay as they were. */
    po.id = was.id; po.poNo = was.poNo; po.date = was.date; po.sent = was.sent || null;
    if (was.closed) po.closed = was.closed;
    po.edited = { at: lmToday() };
    DB.gpo[at] = po;
  } else {
    po.poNo = gpoNewNo(); po.date = lmToday(); po.id = uid(); po.sent = { at: po.date };
    DB.gpo.push(po);
  }
  lmSaveDb();
  $('lmPo').classList.add('hide');
  lmSay('ok', (PO_DRAFT.editId ? po.poNo + ' updated' : 'PO ' + po.poNo + ' raised on ' + po.mill) + ' — ' + nf(gpoTotals(po).metres) + ' m, '
    + RUPEE + ' ' + money(gpoTotals(po).amount) + '.');
  UI.tab = 'po'; PV.openPo[po.poNo] = true; render();
  if (after === 'doc') poShow(po.poNo);
}

/* ---- WHATSAPP, beside every mail (Ravi, 13 Oct) -------------------------------------------- *
 * A wa.me link: WhatsApp opens on the supplier's number with the message written, and the person presses
 * Send. With no phone in Master data it opens on the message alone, to be sent to whoever is chosen. */
var WA_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path style="fill:currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8c.1.2 1.9 2.9 4.6 4 1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>';
function poWaText(po) {
  var co = DB.co || {}, t = gpoTotals(po), NL = String.fromCharCode(10);
  return 'Purchase Order ' + po.poNo + ' dated ' + fmtD(po.date) + NL
    + (po.lines || []).map(function (l, i) { return (i + 1) + '. ' + lineGreigeText(l) + ' - ' + nf(l.metres) + ' m @ ' + RUPEE + money(l.rate) + ', due ' + fmtD(l.due || po.date); }).join(NL) + NL
    + 'Total ' + nf(t.metres) + ' m, ' + RUPEE + ' ' + money(t.amount) + NL + NL
    + 'Kindly confirm receipt and the delivery date.' + NL + (co.name || '');
}
function poWaUrl(po) {
  var v = venByName(po.mill), d = String((v && v.phone) || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  return 'https://wa.me/' + (d.length >= 11 ? d : '') + '?text=' + encodeURIComponent(poWaText(po));
}

/* ---- WHO IS WORKING, AND WHAT THEY MAY DO (Ravi, 13 Oct: "make fabric ledger access specific on the basis of user") ---- *
 * Each person in Users & access has a ledger right -- no access, view only, or view and edit -- and may or may
 * not approve a shrinkage. "Working as" in the top bar says who is at the keyboard. This page has no sign-in,
 * so it models the rights; the Replenish app enforces them with each person's own login. */
function meUser() {
  var list = DB.users || [];
  return list.filter(function (x) { return x.id === DB.me; })[0] || list[0] || { id: '', name: 'Admin', role: 'Admin', ledger: 'edit', approve: true };
}
var canLedger = function () { return meUser().ledger !== 'none'; };
var canLedgerEdit = function () { return meUser().ledger === 'edit'; };
var canApprove = function () { return !!meUser().approve; };
var isAdmin = function () { return meUser().role === 'Admin'; };
function meFill() {
  var sel = $('meSel'); if (!sel) return;
  sel.innerHTML = (DB.users || []).filter(function (x) { return x.active !== false; }).map(function (x) {
    return '<option value="' + esc(x.id) + '"' + (x.id === meUser().id ? ' selected' : '') + '>' + esc(x.name) + ' · ' + esc(x.role) + '</option>';
  }).join('');
  [].forEach.call(document.querySelectorAll('.navgrp[data-tab="ledger"]'), function (b) { b.hidden = !canLedger(); });
}
var LEDGER_LABEL = { none: 'No access', view: 'View only', edit: 'View & edit' };
function renderMstUsers() {
  var admin = isAdmin();
  var rows = (DB.users || []).map(function (x, i) {
    if (!admin) {
      return '<tr><td class="frz" style="text-align:left"><b>' + esc(x.name) + '</b></td><td>' + esc(x.role) + '</td><td>' + esc(LEDGER_LABEL[x.ledger] || x.ledger) + '</td>'
        + '<td>' + (x.approve ? 'Yes' : '—') + '</td><td></td></tr>';
    }
    return '<tr><td class="frz" style="text-align:left"><input data-ui="' + i + '" data-uf="name" value="' + esc(x.name) + '" style="width:170px;font-weight:700" aria-label="Name"></td>'
      + '<td><select data-ui="' + i + '" data-uf="role" style="width:130px" aria-label="Role">' + ['Admin', 'Store', 'Accounts', 'Production', 'Other'].map(function (r) { return '<option' + (r === x.role ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></td>'
      + '<td><select data-ui="' + i + '" data-uf="ledger" style="width:150px" aria-label="Fabric ledger access">' + ['none', 'view', 'edit'].map(function (k) { return '<option value="' + k + '"' + (k === x.ledger ? ' selected' : '') + '>' + LEDGER_LABEL[k] + '</option>'; }).join('') + '</select></td>'
      + '<td><input type="checkbox" data-ui="' + i + '" data-uf="approve"' + (x.approve ? ' checked' : '') + ' style="width:16px;height:16px" aria-label="Can approve shrinkage"></td>'
      + '<td>' + (x.id === meUser().id ? '<span class="muted">you</span>' : '<button type="button" class="lm-x" data-urm="' + i + '" aria-label="Remove ' + esc(x.name) + '">&times;</button>') + '</td></tr>';
  }).join('');
  return '<div class="card"><div class="ff-cap">Who may open the <b>fabric ledger</b> (no access, view only, or view and edit) and who may <b>approve</b> an RFD receipt that shrank more than '
    + RR_SHRINK_LIMIT + '%. Pick who is working in the top bar. ' + (admin ? 'Changes save as you make them.' : 'Only an Admin changes these.') + '</div>'
    + '<div class="ff-grid"><table class="xl xl-dense lm-lines"><thead><tr><th class="frz">Name *</th><th>Role</th><th>Fabric ledger</th><th>Approves shrinkage</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + (admin ? '<div class="row" style="margin-top:12px"><button type="button" id="userAdd">+ Add a user</button></div>' : '') + '</div>';
}
/* At least one Admin who can edit the ledger and approve must always remain, or nobody could change this again. */
function usersSafe() {
  return (DB.users || []).some(function (x) { return x.role === 'Admin' && x.ledger === 'edit' && x.approve && x.active !== false && String(x.name || '').trim(); });
}

/* ---- ISSUE TO RFD, FROM THE PO, BALE BY BALE (Ravi, 13 Oct: "make issue to RFD on the basis of bales") ---- *
 * The bales of a lot are the ones its challan brought in. Ticking bales is what goes out; the metres are the
 * bales' own (as the supplier's challan wrote them). A bale that has gone is not offered again. Older issues
 * that named only metres are taken off the first bales of the lot. A lot that came without bales is sent by metres. */
var ISS = null;
function issLotsOf(po) {
  return fabLots().filter(function (g) { return String(g.poNo).toUpperCase() === String(po.poNo).toUpperCase() && g.greigeLeft > 0.05; });
}
function lotBales(lot) {
  var all = [];
  (DB.fab || []).forEach(function (r) { if (r.lot === lot && r.txnType === 'RECEIVE_GREIGE' && fabCounts(r)) (r.pieces || []).forEach(function (p) { all.push({ than: String(p.than), m: +p.m || 0 }); }); });
  var gone = {}, legacy = 0;
  (DB.fab || []).forEach(function (r) {
    if (r.lot !== lot || r.txnType !== 'ISSUE_TO_RFD' || !fabCounts(r)) return;
    if (Array.isArray(r.bales) && r.bales.length) r.bales.forEach(function (t) { gone[String(t)] = 1; }); else legacy += fabQty(r);
  });
  var left = all.filter(function (b) { return !gone[b.than]; });
  while (legacy > 0.05 && left.length) { legacy -= left[0].m; left.shift(); }
  return left;
}
function issOpen(no, onlyLot) {
  var po = poFind(no); if (!po) return;
  var lots = issLotsOf(po).filter(function (g) { return !onlyLot || g.lot === onlyLot; });
  if (!lots.length) { lmSay('warn', 'No greige from ' + po.poNo + ' is in the store to send.'); return; }
  ISS = { po: po.poNo, pick: {}, qty: {}, only: onlyLot || '' };
  lots.forEach(function (g) { ISS.pick[g.lot] = {}; ISS.qty[g.lot] = ''; });
  $('issTitle').textContent = 'Issue to RFD · ' + po.poNo;
  $('issProc').innerHTML = '<option value="">Choose the RFD processor…</option>' + lmProcessors().map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('');
  $('issDate').value = lmToday(); $('issNo').value = rfdChNewNo(); $('issRem').value = '';
  $('issErr').classList.add('hide');
  issDraw();
  $('lmIss').classList.remove('hide');
  $('issProc').focus();
}
function issPicked(lot) { var b = lotBales(lot), s = ISS.pick[lot] || {}; return b.filter(function (x) { return s[x.than]; }); }
function issTotals() {
  var m = 0, n = 0;
  Object.keys(ISS.pick).forEach(function (lot) {
    var bales = lotBales(lot);
    if (bales.length) { issPicked(lot).forEach(function (b) { m += b.m; n++; }); } else m += parseFloat(ISS.qty[lot]) || 0;
  });
  return { m: r1(m), n: n };
}
function issDraw() {
  var po = poFind(ISS.po), lots = issLotsOf(po).filter(function (g) { return !ISS.only || g.lot === ISS.only; });
  $('issLots').innerHTML = lots.map(function (g) {
    var bales = lotBales(g.lot), sel = ISS.pick[g.lot] || (ISS.pick[g.lot] = {});
    var picked = bales.filter(function (b) { return sel[b.than]; }), pm = r1(picked.reduce(function (s, b) { return s + b.m; }, 0));
    var head = '<div class="dl-top"><div><b class="mono">' + esc(g.lot) + '</b> · ' + esc(g.fabricType) + ' → RFD ' + esc(fabRfdOfGreige(g.fabricType))
      + '<div class="sub">' + nf(g.greigeIn) + ' m received' + (g.toRfd ? ', ' + nf(g.toRfd) + ' m sent already' : '') + ' · <b>' + nf(g.greigeLeft) + ' m in store</b></div></div>';
    if (!bales.length) {
      return '<div class="dl">' + head + '</div><label class="fld" style="max-width:220px"><span>Metres to send * (this lot came without bales)</span>'
        + '<input type="number" step="0.1" min="0" max="' + r1(g.greigeLeft) + '" data-issqty="' + esc(g.lot) + '" value="' + esc(ISS.qty[g.lot]) + '"></label></div>';
    }
    return '<div class="dl">' + head + '<div class="row"><button type="button" class="jw-btn" data-issall="' + esc(g.lot) + '">' + (picked.length === bales.length ? 'Clear all' : 'All ' + bales.length + ' bales') + '</button></div></div>'
      + '<div class="balegrid">' + bales.map(function (b) {
        var on = !!sel[b.than];
        return '<label class="bale' + (on ? ' on' : '') + '"><input type="checkbox" data-issbale="' + esc(g.lot) + '|' + esc(b.than) + '"' + (on ? ' checked' : '') + '>'
          + '<span>Bale ' + esc(b.than) + '</span><b>' + m1(b.m) + ' m</b></label>';
      }).join('') + '</div>'
      + '<div class="dl-actions"><span class="dl-sum">' + plural(picked.length, 'bale') + ' · ' + m1(pm) + ' m</span></div></div>';
  }).join('');
  var t = issTotals();
  $('issTot').innerHTML = 'Going out: <b>' + plural(t.n, 'bale') + ' · ' + m1(t.m) + ' m</b>';
}
function issSave() {
  var po = poFind(ISS.po), proc = $('issProc').value.trim(), date = $('issDate').value, errs = [], rows = [];
  if (!proc) { $('issErr').textContent = 'Choose the RFD processor the greige is going to.'; $('issErr').classList.remove('hide'); return; }
  /* THE RFD CHALLAN IS REQUIRED (Ravi, 13 Oct): no greige leaves for an RFD processor without our challan, and one
   * challan number is used once. */
  var chNo = rfdChNewNo(); $('issNo').value = chNo;   // given at the moment of saving, so two windows never take one number
  if (!chNo) { $('issErr').textContent = 'Type our RFD challan number. Greige does not go to the RFD processor without one.'; $('issErr').classList.remove('hide'); $('issNo').focus(); return; }
  var used = (DB.fab || []).filter(function (r) { return r.txnType === 'ISSUE_TO_RFD' && String(r.bill || '').trim().toUpperCase() === chNo.toUpperCase(); })[0];
  if (used) { $('issErr').textContent = 'RFD challan ' + chNo + ' is already used (' + used.lot + ' to ' + used.party + ' on ' + fmtD(used.date) + '). Use the next number.'; $('issErr').classList.remove('hide'); return; }
  issLotsOf(po).forEach(function (g) {
    if (!ISS.pick[g.lot]) return;
    var bales = lotBales(g.lot), picked = bales.length ? issPicked(g.lot) : null;
    var q = picked ? r1(picked.reduce(function (s, b) { return s + b.m; }, 0)) : (parseFloat(ISS.qty[g.lot]) || 0);
    if (!(q > 0)) return;
    var e = { txnType: 'ISSUE_TO_RFD', date: date, lot: g.lot, fabric: g.fabricType, qty: q, party: proc, bill: $('issNo').value.trim(), remark: $('issRem').value.trim() };
    var err = fabEntryCheck(e); if (err) { errs.push(err); return; }
    var row = { id: uid(), date: date, lot: g.lot, fabricType: g.fabricType, txnType: 'ISSUE_TO_RFD', qty: q, party: proc,
      bill: e.bill, orderNo: po.poNo, done: false, by: meUser().name };
    if (picked) row.bales = picked.map(function (b) { return b.than; });
    if (e.remark) row.remark = e.remark;
    rows.push(row);
  });
  if (!errs.length && !rows.length) errs.push('Tick the bales that are going out.');
  if (errs.length) { $('issErr').innerHTML = uniq(errs).map(esc).join('<br>'); $('issErr').classList.remove('hide'); return; }
  rows.forEach(function (r) { DB.fab.push(r); });
  lmSaveDb();
  $('lmIss').classList.add('hide');
  var m = rows.reduce(function (s, r) { return s + r.qty; }, 0), n = rows.reduce(function (s, r) { return s + ((r.bales || []).length); }, 0);
  lmSay('ok', 'RFD challan ' + rows[0].bill + ': ' + (n ? plural(n, 'bale') + ', ' : '') + nf(m) + ' m of greige from ' + po.poNo + ' sent to ' + proc + ' (' + lmList(rows.map(function (r) { return r.lot; })) + ').');
  ISS = null; render();
}

/* ---- SEND RFD TO CUTTING, THAN BY THAN (Ravi, 13 Oct: "if I want to move to the next process I can move from
 * there only" -- every figure in Inventory moves its cloth one step on, from the same drop-down) ---- *
 * The thans of a lot are the ones the RFD processor sent back. Ticked thans go to cutting; their metres are the
 * thans' own. A than that has gone is not offered again; older issues and write-offs that named only metres are
 * taken off the first thans. A lot without thans (opening stock, bought ready) is sent by metres. */
var CUT = null;
function lotThans(lot) {
  var all = [];
  (DB.fab || []).forEach(function (r) { if (r.lot === lot && r.txnType === 'RECEIVE_RFD' && fabCounts(r)) (r.pieces || []).forEach(function (p) { all.push({ than: String(p.than), m: +p.m || 0 }); }); });
  var gone = {}, legacy = 0;
  (DB.fab || []).forEach(function (r) {
    if (r.lot !== lot || !fabCounts(r)) return;
    if (r.txnType === 'ISSUE_TO_CUTTING') { if (Array.isArray(r.thans) && r.thans.length) r.thans.forEach(function (t) { gone[String(t)] = 1; }); else legacy += fabQty(r); }
    if (r.txnType === 'DAMAGE' && fabState(r) !== 'GREIGE') legacy += fabQty(r);
  });
  var left = all.filter(function (b) { return !gone[b.than]; });
  while (legacy > 0.05 && left.length) { legacy -= left[0].m; left.shift(); }
  return left;
}
function cutOpen(lot) {
  var g = fabLot(lot);
  if (!g || g.rfdLeft <= 0.05) { lmSay('warn', 'Lot ' + lot + ' has no RFD on the shelf.'); return; }
  CUT = { lot: lot, pick: {}, qty: '' };
  $('cutTitle').textContent = 'Send to cutting · ' + lot;
  $('cutDate').value = lmToday(); $('cutTo').value = ''; $('cutRem').value = '';
  $('cutErr').classList.add('hide');
  cutDraw();
  $('lmCut').classList.remove('hide');
}
function cutDraw() {
  var g = fabLot(CUT.lot), thans = lotThans(CUT.lot), rfd = g.rfdFabric || fabRfdOfGreige(g.fabricType) || g.fabricType;
  var head = '<div class="dl-top"><div><b class="mono">' + esc(CUT.lot) + '</b> · RFD <b>' + esc(rfd) + '</b>'
    + '<div class="sub">' + (g.poNo ? esc(g.poNo) + ' · ' : '') + (g.processor ? 'from ' + esc(g.processor) + ' · ' : '') + '<b>' + nf(g.rfdLeft) + ' m on the shelf</b></div></div>';
  if (!thans.length) {
    $('cutBody').innerHTML = '<div class="dl">' + head + '</div><label class="fld" style="max-width:240px"><span>Metres to cutting * (this lot has no thans listed)</span>'
      + '<input type="number" step="0.1" min="0" max="' + r1(g.rfdLeft) + '" data-cutqty="1" value="' + esc(CUT.qty) + '"></label></div>';
    $('cutTot').innerHTML = 'Going to cutting: <b>' + m1(parseFloat(CUT.qty) || 0) + ' m</b>';
    return;
  }
  var picked = thans.filter(function (t) { return CUT.pick[t.than]; }), pm = r1(picked.reduce(function (s, t) { return s + t.m; }, 0));
  $('cutBody').innerHTML = '<div class="dl">' + head + '<div class="row"><button type="button" class="jw-btn" data-cutall="1">' + (picked.length === thans.length ? 'Clear all' : 'All ' + thans.length + ' thans') + '</button></div></div>'
    + '<div class="balegrid">' + thans.map(function (t) {
      var on = !!CUT.pick[t.than];
      return '<label class="bale' + (on ? ' on' : '') + '"><input type="checkbox" data-cutthan="' + esc(t.than) + '"' + (on ? ' checked' : '') + '><span>Than ' + esc(t.than) + '</span><b>' + m1(t.m) + ' m</b></label>';
    }).join('') + '</div></div>';
  $('cutTot').innerHTML = 'Going to cutting: <b>' + plural(picked.length, 'than') + ' · ' + m1(pm) + ' m</b>';
}
function cutSave() {
  var g = fabLot(CUT.lot), thans = lotThans(CUT.lot), date = $('cutDate').value;
  var picked = thans.length ? thans.filter(function (t) { return CUT.pick[t.than]; }) : null;
  var q = picked ? r1(picked.reduce(function (s, t) { return s + t.m; }, 0)) : (parseFloat(CUT.qty) || 0);
  var rfd = g.rfdFabric || fabRfdOfGreige(g.fabricType) || g.fabricType, err = '';
  if (!(q > 0)) err = picked ? 'Tick the thans that are going to cutting.' : 'How many metres are going to cutting?';
  else err = fabEntryCheck({ txnType: 'ISSUE_TO_CUTTING', date: date, lot: CUT.lot, fabric: rfd, qty: q });
  if (err) { $('cutErr').textContent = err; $('cutErr').classList.remove('hide'); return; }
  var row = { id: uid(), date: date, lot: CUT.lot, fabricType: rfd, txnType: 'ISSUE_TO_CUTTING', qty: q, party: $('cutTo').value.trim() || 'Cutting',
    bill: '', orderNo: g.poNo || '', done: false, by: meUser().name };
  if (picked) row.thans = picked.map(function (t) { return t.than; });
  if ($('cutRem').value.trim()) row.remark = $('cutRem').value.trim();
  DB.fab.push(row); lmSaveDb();
  $('lmCut').classList.add('hide');
  lmSay('ok', (picked ? plural(picked.length, 'than') + ', ' : '') + nf(q) + ' m of RFD ' + rfd + ' from ' + CUT.lot + ' sent to cutting.');
  CUT = null; render();
}

/* ---- RECEIVE RFD, THAN BY THAN, WITH A SHRINKAGE CHECK (Ravi, 13 Oct: "on receiving the thans of RFD, if shrinkage
 * is more than 5% it asks for approval") ---- *
 * RFD comes back from the processor as thans, typed against the lot that went out. When the receipt closes the lot,
 * what never came back is the shrinkage. Up to 5% it goes straight into stock; more than that it waits for someone
 * who may approve -- until then it is not counted, and the cloth still reads as at the processor. */
var RR_SHRINK_LIMIT = 5;
var RR = null;
function rrLotsOf(po) {
  return fabLots().filter(function (g) { return String(g.poNo).toUpperCase() === String(po.poNo).toUpperCase() && g.withProcessor > 0.05; });
}
function rrPendingOf(lot) { return (DB.fab || []).filter(function (r) { return r.lot === lot && r.approval && r.approval.status === 'pending'; })[0] || null; }
function rrOpen(no, onlyLot) {
  var po = poFind(no); if (!po) return;
  var lots = rrLotsOf(po).filter(function (g) { return !onlyLot || g.lot === onlyLot; });
  if (!lots.length) { lmSay('warn', 'Nothing from ' + po.poNo + ' is out at an RFD processor.'); return; }
  RR = { po: po.poNo, lots: lots.map(function (g) { return g.lot; }), thans: {}, fin: {} };
  lots.forEach(function (g) { RR.thans[g.lot] = [{ than: '', m: '' }]; RR.fin[g.lot] = true; });
  $('rrTitle').textContent = 'Receive RFD · ' + po.poNo;
  $('rrDate').value = lmToday(); $('rrNo').value = '';
  $('rrErr').classList.add('hide');
  rrDraw();
  $('lmRr').classList.remove('hide');
  $('rrNo').focus();
}
function rrShrink(g, add, fin) {
  var back = g.rfdIn + add, pct = g.toRfd > 0 ? Math.round(((g.toRfd - back) / g.toRfd) * 1000) / 10 : 0;
  return { back: back, pct: fin ? pct : null, need: fin && pct > RR_SHRINK_LIMIT };
}
function rrSum(lot) { return r1((RR.thans[lot] || []).reduce(function (s, p) { return s + (parseFloat(p.m) || 0); }, 0)); }
function rrDraw() {
  $('rrLots').innerHTML = RR.lots.map(function (lot) {
    var g = fabLot(lot); if (!g) return '';
    var pend = rrPendingOf(lot), out = (DB.fab || []).filter(function (r) { return r.lot === lot && r.txnType === 'ISSUE_TO_RFD'; });
    var head = '<div class="dl-top"><div><b class="mono">' + esc(lot) + '</b> · ' + esc(g.fabricType) + ' → RFD <b>' + esc(fabRfdOfGreige(g.fabricType) || g.fabricType) + '</b>'
      + '<div class="sub">At ' + esc(g.processor || '—') + ' · sent ' + nf(g.toRfd) + ' m' + (out.length ? ' on ' + esc(fmtD(out.map(function (r) { return r.date; }).sort().pop())) : '')
      + (g.rfdIn ? ' · ' + nf(g.rfdIn) + ' m back so far' : '') + ' · <b>' + nf(g.withProcessor) + ' m still out</b></div></div></div>';
    if (pend) return '<div class="dl">' + head + '<div class="supline">A receipt of ' + nf(fabQty(pend)) + ' m on this lot is waiting for approval (' + pend.approval.pct + '% shrinkage).</div></div>';
    var ps = RR.thans[lot];
    return '<div class="dl">' + head
      + '<div class="prh"><span></span><span>Than no.</span><span>Metres *</span><span></span></div>'
      + ps.map(function (p, pi) {
        return '<div class="pr"><span class="pr-i">' + (pi + 1) + '</span>'
          + '<input id="rt-' + lot + '-' + pi + '" data-rrlot="' + esc(lot) + '" data-pi="' + pi + '" data-f="than" value="' + esc(p.than) + '" placeholder="Than no." aria-label="Than number ' + (pi + 1) + '">'
          + '<input id="rm-' + lot + '-' + pi + '" data-rrlot="' + esc(lot) + '" data-pi="' + pi + '" data-f="m" type="number" step="0.1" min="0" inputmode="decimal" value="' + esc(p.m) + '" placeholder="Metres" aria-label="Metres, than ' + (pi + 1) + '">'
          + '<button type="button" class="x" data-rrrm="' + esc(lot) + '|' + pi + '" aria-label="Remove than ' + (pi + 1) + '">×</button></div>';
      }).join('')
      + '<div class="dl-actions"><button type="button" class="jw-btn" data-rradd="' + esc(lot) + '">+ Than</button>'
      + '<label class="inl" style="display:flex;align-items:center;gap:7px;margin:0;font-weight:600;color:var(--ink)"><input type="checkbox" data-rrfin="' + esc(lot) + '"' + (RR.fin[lot] ? ' checked' : '') + ' style="width:16px;height:16px">This is the whole lot back (close it)</label>'
      + '<span class="dl-sum" id="rrsum-' + lot + '"></span></div><div id="rrsh-' + lot + '"></div></div>';
  }).join('');
  rrSums();
}
function rrSums() {
  RR.lots.forEach(function (lot) {
    var g = fabLot(lot); if (!g || rrPendingOf(lot)) return;
    var s = rrSum(lot), n = (RR.thans[lot] || []).filter(function (p) { return +p.m > 0; }).length, sh = rrShrink(g, s, RR.fin[lot]);
    var el = $('rrsum-' + lot); if (el) el.textContent = plural(n, 'than') + ' · ' + m1(s) + ' m';
    var box = $('rrsh-' + lot); if (!box) return;
    if (s > g.withProcessor + 0.05) { box.className = 'err'; box.textContent = 'Only ' + nf(g.withProcessor) + ' m of this lot is out. More has come back than went.'; return; }
    if (!(s > 0) || sh.pct === null) { box.className = 'warnline'; box.textContent = s > 0 ? 'Part of the lot: shrinkage is worked out when the lot is closed.' : ''; return; }
    box.className = sh.need ? 'err' : 'okline';
    box.textContent = 'Sent ' + nf(g.toRfd) + ' m, back ' + m1(sh.back) + ' m: shrinkage ' + sh.pct + '%'
      + (sh.need ? '. More than ' + RR_SHRINK_LIMIT + '%, so this receipt will wait for approval before it counts.' : ', within ' + RR_SHRINK_LIMIT + '%.');
  });
}
function rrSave() {
  var po = poFind(RR.po), no = $('rrNo').value.trim(), date = $('rrDate').value, errs = [], rows = [], held = [];
  if (!no) errs.push('Type the processor’s challan number.');
  RR.lots.forEach(function (lot) {
    var g = fabLot(lot); if (!g || rrPendingOf(lot)) return;
    var ps = (RR.thans[lot] || []).filter(function (p) { return +p.m > 0; }).map(function (p) { return { than: String(p.than).trim() || '—', m: r1(+p.m) }; });
    if (!ps.length) return;
    var q = r1(ps.reduce(function (s, p) { return s + p.m; }, 0)), rfd = fabRfdOfGreige(g.fabricType) || g.fabricType;
    var err = fabEntryCheck({ txnType: 'RECEIVE_RFD', date: date, lot: lot, fabric: rfd, qty: q, party: g.processor });
    if (err) { errs.push(err); return; }
    var dup = {}; ps.forEach(function (p) { if (p.than !== '—') { if (dup[p.than]) errs.push(lot + ': than ' + p.than + ' is typed twice.'); dup[p.than] = 1; } });
    var sh = rrShrink(g, q, RR.fin[lot]);
    var row = { id: uid(), date: date, lot: lot, fabricType: rfd, txnType: 'RECEIVE_RFD', qty: q, party: g.processor, bill: no,
      orderNo: g.poNo, final: !!RR.fin[lot], pieces: ps, done: false, by: meUser().name };
    if (sh.need) { row.approval = { status: 'pending', pct: sh.pct, askedBy: meUser().name, at: lmToday() }; held.push(lot + ' (' + sh.pct + '%)'); }
    rows.push(row);
  });
  if (!errs.length && !rows.length) errs.push('Type at least one than with its metres.');
  if (errs.length) { $('rrErr').innerHTML = uniq(errs).map(esc).join('<br>'); $('rrErr').classList.remove('hide'); return; }
  rows.forEach(function (r) { DB.fab.push(r); });
  lmSaveDb();
  $('lmRr').classList.add('hide');
  var m = rows.reduce(function (s, r) { return s + r.qty; }, 0);
  lmSay(held.length ? 'warn' : 'ok', nf(m) + ' m of RFD received against ' + po.poNo + '.'
    + (held.length ? ' Waiting for approval: ' + held.join(', ') + ' shrank more than ' + RR_SHRINK_LIMIT + '%.' : ''));
  RR = null; render();
}
/** The receipts waiting for someone to approve their shrinkage. */
function rrPending() { return (DB.fab || []).filter(function (r) { return r.approval && r.approval.status === 'pending'; }); }
function rrApprovalsHtml() {
  var list = rrPending(); if (!list.length) return '';
  var who = (DB.users || []).filter(function (x) { return x.approve && x.active !== false; }).map(function (x) { return x.name; });
  return '<div class="card approvals"><div class="kpihead"><span class="kpiname">RFD receipts waiting for approval</span><span class="kpiwhen">shrinkage over ' + RR_SHRINK_LIMIT + '%</span></div>'
    + '<div class="box scroll"><table class="ct li"><thead><tr><th>Lot</th><th>PO</th><th>RFD processor</th><th>Their challan</th><th class="num">Sent</th><th class="num">Back</th><th class="num">Shrinkage</th><th>Asked by</th><th></th></tr></thead><tbody>'
    + list.map(function (r) {
      var g = fabLot(r.lot) || {};
      return '<tr><td class="tl mono b">' + esc(r.lot) + '</td><td class="tl">' + esc(r.orderNo || '—') + '</td><td class="tl">' + esc(r.party) + '</td><td class="tl mono">' + esc(r.bill || '—') + '</td>'
        + '<td class="num">' + nf(g.toRfd || 0) + ' m</td><td class="num">' + nf((g.rfdIn || 0) + fabQty(r)) + ' m</td><td class="num"><b class="err-in">' + r.approval.pct + '%</b></td>'
        + '<td class="tl">' + esc(r.approval.askedBy || '') + '<div class="sub">' + esc(fmtD(r.approval.at)) + '</div></td>'
        + '<td>' + (canApprove() ? '<div class="actions"><button type="button" class="jw-btn jw-wa" data-appr="' + esc(r.id) + '|ok">Approve</button><button type="button" class="jw-btn" id="rej-' + esc(r.id) + '" data-appr="' + esc(r.id) + '|no">Reject</button></div>'
          : '<span class="muted">' + (who.length ? 'for ' + esc(lmList(who)) : 'nobody may approve') + '</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
}
function rrDecide(id, ok, btn) {
  var r = (DB.fab || []).filter(function (x) { return x.id === id; })[0]; if (!r || !canApprove()) return;
  if (!ok && !armed(btn, 'Press again to reject')) return;
  r.approval.status = ok ? 'approved' : 'rejected'; r.approval.by = meUser().name; r.approval.on = lmToday();
  lmSaveDb(); render();
  lmSay(ok ? 'ok' : 'warn', ok ? 'Approved: ' + nf(fabQty(r)) + ' m of RFD on ' + r.lot + ' is in stock (' + r.approval.pct + '% shrinkage).'
    : 'Rejected: the receipt on ' + r.lot + ' does not count. Receive it again with the right thans.');
}

/* ================================================================================================
 * THE PURCHASE ORDER ITSELF -- laid out as RIDHI's books lay one out, box for box: Invoice To and
 * Consignee and Supplier down the left, the voucher panel down the right, the goods, the total in
 * words, the PAN, the signature, the jurisdiction. One layout feeds the print, the PDF and the mail,
 * so the three can never come out different.
 * ================================================================================================ */
function podParty(label, name, lines, gstin, email, iec) {
  return '<div class="lab">' + esc(label) + '</div>'
    + '<div class="pname">' + esc(name || '') + '</div>'
    + lines.filter(Boolean).map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('')
    + (iec ? '<div>IEC-' + esc(iec) + '</div>' : '')
    + (gstin ? '<div><span class="k">GSTIN/UIN</span>: ' + esc(gstin) + '</div>' : '')
    + (gstState(gstin) ? '<div><span class="k">State Name</span>: ' + esc(gstState(gstin)) + '</div>' : '')
    + (email ? '<div><span class="k">E-Mail</span>: ' + esc(email) + '</div>' : '');
}
function poDocBody(po) {
  var co = DB.co || {}, v = venByName(po.mill) || { name: po.mill };
  var t = gpoTotals(po);
  var coLines = String(co.addr || '').split(/\r?\n/).map(function (x) { return x.trim(); });
  var me = podParty('Invoice To', co.name || '', coLines, co.gstin, co.email, co.iec);
  var shipTo = podParty('Consignee (Ship to)', co.name || '', coLines, co.gstin, co.email, co.iec);
  var supplier = podParty('Supplier (Bill from)', v.name || po.mill, [v.addr, v.city], v.gstin, '', '');
  var cell = function (label, val, bold) {
    return '<div class="lab">' + esc(label) + '</div><div class="val"' + (bold === false ? ' style="font-weight:400"' : '') + '>'
      + esc(val || '') + '</div>';
  };
  var lines = (po.lines || []);
  var rows = lines.map(function (l, i) {
    var m = gpoLineMoney(l);
    return '<tr><td class="c">' + (i + 1) + '</td>'
      + '<td class="desc">' + esc(lineGreigeText(l)) + '<div style="font-weight:400;font-size:10px">' + esc(lineRfdText(l)) + '</div></td>'
      + '<td class="c it">' + esc(fmtD(l.due || po.date)) + '</td>'
      + '<td class="n b">' + money(l.metres) + ' Mtr</td>'
      + '<td class="n">' + money(l.rate) + '</td>'
      + '<td class="c">Mtr</td>'
      + '<td class="n b">' + money(m.amount) + '</td></tr>';
  }).join('');
  var fill = Math.max(40, 300 - lines.length * 24);

  var css = '.pod{width:720px;margin:0 auto;padding:4px 0 0;background:#fff;color:#000;'
    + 'font:11px/1.38 Arial,Helvetica,sans-serif}'
    + '.pod *{box-sizing:border-box}'
    + '.pod h1{text-align:center;font-size:16px;font-weight:700;letter-spacing:.06em;margin:0 0 10px}'
    + '.pod table{width:100%;border-collapse:collapse;table-layout:fixed}'
    + '.pod td,.pod th{border:1px solid #000;vertical-align:top;padding:3px 6px;word-wrap:break-word}'
    + '.pod .lab{font-size:10.5px}'
    + '.pod .pname{font-weight:700;font-size:12.5px;margin:2px 0 1px}'
    + '.pod .k{display:inline-block;min-width:72px}'
    + '.pod .val{font-weight:700;font-size:12px;padding-top:2px;min-height:17px}'
    + '.pod .hd td.r{height:40px}'
    + '.pod .items{margin-top:-1px}'
    + '.pod .items th{font-weight:400;font-size:10.5px;text-align:center;vertical-align:middle;padding:4px}'
    + '.pod .items td{border-top:0;border-bottom:0;padding:2px 5px}'
    + '.pod .items .n{text-align:right;white-space:nowrap}'
    + '.pod .items .c{text-align:center}'
    + '.pod .items .b,.pod .items .desc{font-weight:700}'
    + '.pod .items .it{font-style:italic}'
    + '.pod .items tr.tot td{border-top:1px solid #000;border-bottom:1px solid #000;padding:4px 5px}'
    + '.pod .box{border:1px solid #000;border-top:0;padding:4px 6px}'
    + '.pod .words{font-weight:700;font-size:12px;margin:3px 0 2px}'
    + '.pod .foot{display:flex;border:1px solid #000;border-top:0;min-height:118px}'
    + '.pod .foot .l{flex:1;padding:6px;display:flex;flex-direction:column;justify-content:flex-end}'
    + '.pod .foot .r{width:290px;border-left:1px solid #000;border-top:1px solid #000;margin-top:34px;padding:6px;'
    + 'display:flex;flex-direction:column;justify-content:space-between;text-align:right}'
    + '.pod .after{text-align:center;margin-top:8px;line-height:1.75}';

  return '<div class="pod"><style>' + css + '</style>'
    + '<h1>PURCHASE ORDER</h1>'
    + '<table class="hd"><colgroup><col style="width:50%"><col style="width:25%"><col style="width:25%"></colgroup>'
    + '<tr><td rowspan="4">' + me + '</td>'
    + '<td class="r">' + cell('Voucher No.', po.poNo) + '</td><td class="r">' + cell('Dated', fmtD(po.date)) + '</td></tr>'
    + '<tr><td class="r"></td><td class="r">' + cell('Mode/Terms of Payment', po.pay) + '</td></tr>'
    + '<tr><td class="r">' + cell('Reference No. & Date.', po.poNo) + '</td>'
    + '<td class="r">' + cell('Other References', po.other) + '</td></tr>'
    + '<tr><td class="r">' + cell('Dispatched through', po.disp) + '</td><td class="r">' + cell('Destination', po.dest) + '</td></tr>'
    + '<tr><td>' + shipTo + '</td><td colspan="2" rowspan="2">' + cell('Terms of Delivery', po.terms, false) + '</td></tr>'
    + '<tr><td>' + supplier + '</td></tr>'
    + '</table>'
    + '<table class="items"><colgroup><col style="width:5%"><col style="width:40%"><col style="width:11%">'
    + '<col style="width:14%"><col style="width:10%"><col style="width:5%"><col style="width:15%"></colgroup>'
    + '<thead><tr><th>Sl<br>No.</th><th>Description of Goods</th><th>Due on</th><th>Quantity</th><th>Rate</th>'
    + '<th>per</th><th>Amount</th></tr></thead>'
    + '<tbody>' + rows
    + '<tr><td style="height:' + fill + 'px"></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'
    + '<tr class="tot"><td></td><td style="text-align:right">Total</td><td></td>'
    + '<td class="n b">' + money(t.metres) + ' Mtr</td><td></td><td></td>'
    + '<td class="n b">' + RUPEE + ' ' + money(t.amount) + '</td></tr>'
    + '</tbody></table>'
    + '<div class="box"><div style="display:flex;justify-content:space-between">'
    + '<span>Amount Chargeable (in words)</span><i>E. &amp; O.E</i></div>'
    + '<div class="words">' + esc(inrWords(t.amount)) + '</div></div>'
    + '<div class="foot"><div class="l">'
    + (co.pan ? '<div>Company\u2019s PAN <span style="display:inline-block;width:40px"></span>: <b>' + esc(co.pan) + '</b></div>' : '')
    + '</div><div class="r"><b>for ' + esc(co.name || '') + '</b><span>Authorised Signatory</span></div></div>'
    + '<div class="after">' + (co.jurisdiction ? 'SUBJECT TO ' + esc(String(co.jurisdiction).toUpperCase()) + ' JURISDICTION<br>' : '')
    + 'This is a Computer Generated Document</div>'
    + '</div>';
}

/* ---- THE PO, SHOWN AS THE PAPER, AND THE MAIL THAT GOES WITH IT ---------------------------- *
 *
 * This page runs in a locked frame: it cannot print, cannot start a download, and cannot open a tab
 * from a script. So the PO opens here as the paper it is, the letter to the mill is written out ready
 * to copy, and Gmail is a plain link already addressed to the mill. The PDF itself is made by the
 * Replenish app's Greige POs screen, which prints the same layout. */
function poMailText(po) {
  var co = DB.co || {}, t = gpoTotals(po), who = co.name || '', NL = String.fromCharCode(10), v = venByName(po.mill);
  return {
    to: v && v.email ? v.email : '',
    su: 'Purchase Order ' + po.poNo + (who ? ' - ' + who : ''),
    body: 'Dear Sir/Madam,' + NL + NL
      + 'Please find attached our Purchase Order ' + po.poNo + ' dated ' + fmtD(po.date) + ' for '
      + nf(t.metres) + ' m (' + RUPEE + ' ' + money(t.amount) + ').' + NL + NL
      + 'Kindly confirm receipt and the delivery date.' + NL + NL + 'Regards,' + NL + who
  };
}
function poGmailUrl(po) {
  var m = poMailText(po);
  return 'https://mail.google.com/mail/?view=cm&fs=1' + (m.to ? '&to=' + encodeURIComponent(m.to) : '')
    + '&su=' + encodeURIComponent(m.su) + '&body=' + encodeURIComponent(m.body);
}
var DOC_NO = '';
function poShow(no) {
  var po = poFind(no); if (!po) return;
  DOC_NO = po.poNo;
  var m = poMailText(po);
  $('docTitle').textContent = po.poNo + ' · ' + po.mill;
  $('docPaper').innerHTML = poDocBody(po);
  $('docMail').innerHTML = '<div class="sect">Send it to the supplier</div>'
    + '<div class="mailbox"><div><span class="muted">To</span> ' + (m.to ? '<b class="sel">' + esc(m.to) + '</b>'
      : '<span class="err-in">no e-mail for ' + esc(po.mill) + ' in Master data</span>') + '</div>'
    + '<div><span class="muted">Subject</span> <b class="sel">' + esc(m.su) + '</b></div>'
    + '<pre class="sel" id="docBody">' + esc(m.body) + '</pre></div>'
    + '<div class="row"><button type="button" class="ghost" id="docCopy">Copy the mail</button>'
    + '<a class="btnlink" href="' + esc(poGmailUrl(po)) + '" target="_blank" rel="noopener">' + I.mail + ' Open in Gmail</a>'
    + '<a class="btnlink wa" href="' + esc(poWaUrl(po)) + '" target="_blank" rel="noopener">' + WA_ICON + ' Send on WhatsApp</a>'
    + '</div>'
    + '<div class="lm-why">To print or save it as a PDF, press Ctrl + P while this is open (only the PO paper prints). '
    + 'WhatsApp opens on the supplier’s number from Master data.</div>';
  $('lmDoc').classList.remove('hide');
}

/* ---- wiring: the PO list, the challans, the drawer and the new-PO dialog -------------------------- */
function wirePurchaseOrders() {
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-act],[data-sent],[data-porm],[data-doc],[data-rcv],[data-tpo],[data-tch],[data-fill],[data-kpi],[data-pv],[data-pvclear],[data-dr],[data-pclose],[data-pedit],[data-iss],[data-isspick],#docCopy,#issSave') : null;
    if (!t) return;
    var g = function (k) { return t.getAttribute(k); };
    if (t.id === 'docCopy') {
      var po0 = poFind(DOC_NO); if (!po0) return;
      var mt = poMailText(po0), NL = String.fromCharCode(10);
      var txt = 'To: ' + mt.to + NL + 'Subject: ' + mt.su + NL + NL + mt.body;
      try {
        navigator.clipboard.writeText(txt).then(function () { lmSay('ok', 'The mail is copied. Paste it into a new message to ' + (mt.to || 'the mill') + '.'); },
          function () { lmSay('warn', 'Copying was refused here. Select the letter above and copy it by hand.'); });
      } catch (e) { lmSay('warn', 'Copying was refused here. Select the letter above and copy it by hand.'); }
      return;
    }
    if (g('data-act') !== null) { if (g('data-act') === 'po') poOpen(); return; }
    if (g('data-sent')) {
      var po = poFind(g('data-sent'));
      if (po) { po.sent = { at: lmToday() }; lmSaveDb(); render(); if (!$('lmDoc').classList.contains('hide')) poShow(po.poNo); lmSay('ok', po.poNo + ' marked as sent to ' + po.mill + '.'); }
      return;
    }
    if (g('data-porm')) {
      PO_DRAFT.lines.splice(parseInt(g('data-porm'), 10), 1);
      if (!PO_DRAFT.lines.length) poAddLine(); else poDraw();
      return;
    }
    if (g('data-doc')) { poShow(g('data-doc')); return; }
    if (g('data-pclose')) { poCloseToggle(g('data-pclose'), t); return; }
    if (g('data-pedit')) { poOpen(g('data-pedit')); return; }
    if (g('data-iss')) { var ip = g('data-iss').split('|'); issOpen(ip[0], ip[1] || ''); return; }
    if (t.id === 'issSave') { issSave(); return; }
    if (g('data-isspick') && ISS) { ISS.pick[g('data-isspick')] = t.checked; issDraw(); return; }
    if (g('data-rcv')) { $('lmDoc').classList.add('hide'); openDrawer(g('data-rcv')); return; }
    if (g('data-tpo')) { var k = g('data-tpo'); PV.openPo[k] = !PV.openPo[k]; render(); return; }
    if (g('data-tch')) { var c = g('data-tch'); PV.openCh[c] = !PV.openCh[c]; render(); return; }
    if (g('data-kpi') !== null) { var kk = g('data-kpi'); PV.st = PV.st === kk ? '' : kk; if (kk === 'tocheck' || kk === 'short') PV.view = 'ch'; render(); return; }
    if (g('data-pv')) { PV.view = g('data-pv'); render(); return; }
    if (g('data-pvclear')) { PV.st = ''; PV.mill = ''; PV.from = ''; PV.to = ''; render(); return; }
    if (g('data-fill')) {
      var ch = chBy(g('data-fill')); if (!ch) return;
      ch.rows.forEach(function (r) { (r.pieces || []).forEach(function (p) { if (p.chk == null) p.chk = p.m; }); });
      lmSaveDb(); render();
      lmSay('ok', 'Every bale on ' + (ch.no || 'the challan') + ' marked as measured to the challan metres. Change any that differ.');
      return;
    }
    if (g('data-dr') && RD) {
      var act = g('data-dr'), li = +g('data-li');
      if (act === 'add') rdAddPiece(li);
      else if (act === 'sup') { RD.sup[li] = !RD.sup[li]; rdSums(); }
      else if (act === 'rm') { var ps = RD.lines[li]; ps.splice(+g('data-pi'), 1); if (!ps.length) ps.push({ than: '', m: '' }); rdDraw(); }
      else if (act === 'paste') { RD.paste[li] = !RD.paste[li]; rdDraw(); var ta = $('paste-' + li); if (ta) ta.focus(); }
      else if (act === 'dopaste') rdPaste(li);
      else if (act === 'save') rdSave();
    }
  });
  /* MEASURED METRES change the tile and the challan's pill in place, so typing never loses the box. */
  document.addEventListener('input', function (ev) {
    var el = ev.target, key = el.getAttribute && el.getAttribute('data-chk');
    if (key) {
      var bits = key.split('|'), row = (DB.fab || []).filter(function (r) { return r.id === bits[0]; })[0];
      var p = row && row.pieces ? row.pieces[+bits[1]] : null; if (!p) return;
      p.chk = el.value === '' || isNaN(parseFloat(el.value)) ? null : r1(parseFloat(el.value));
      lmSaveDb();
      var did = bits[0] + '-' + bits[1];
      $('pd-' + did).innerHTML = diffSpan(p);
      $('pc-' + did).classList.toggle('short', p.chk != null && p.chk - p.m <= -0.05);
      var c = chList().filter(function (x) { return x.rows.some(function (r) { return r.id === row.id; }); })[0];
      if (c) [].forEach.call(document.querySelectorAll('[data-chsum="' + c.id + '"]'), function (n) { n.innerHTML = checkPill(c); });
      /* The KPI strip follows too, swapped in place so the cursor stays in its box. */
      var kr = document.querySelector(".gk-row"); if (kr) kr.outerHTML = poKpis();
      return;
    }
    if (ISS && el.getAttribute && el.getAttribute('data-issqty') !== null) {
      ISS.qty[el.getAttribute('data-issqty')] = el.value;
      var tot = Object.keys(ISS.pick).filter(function (k) { return ISS.pick[k]; }).reduce(function (s, k) { return s + (parseFloat(ISS.qty[k]) || 0); }, 0);
      $('issTot').innerHTML = 'Going out: <b>' + nf(tot) + ' m</b>'; return;
    }
    if (RD && el.closest && el.closest('#dLines') && el.getAttribute('data-f')) {
      RD.lines[+el.getAttribute('data-li')][+el.getAttribute('data-pi')][el.getAttribute('data-f')] = el.value;
      rdSums();
    }
  });
  document.addEventListener("change", function (ev) {
    var f = { pvSt: 'st', pvMill: 'mill', pvFrom: 'from', pvTo: 'to' }[ev.target.id];
    if (f) { PV[f] = ev.target.value; render(); }
  });
  $('dLines').addEventListener('keydown', function (ev) {
    var el = ev.target;
    if (ev.key !== 'Enter' || el.getAttribute('data-f') !== 'm') return;
    ev.preventDefault();
    var li = +el.getAttribute('data-li'), pi = +el.getAttribute('data-pi');
    if (pi === RD.lines[li].length - 1) rdAddPiece(li); else $('pm-' + li + '-' + (pi + 1)).focus();
  });
  /* The PO lines keep their own state as they are typed, so a redraw never loses a figure. */
  $('poLines').addEventListener('input', poEdit);
  $('poLines').addEventListener('change', poEdit);
  function poEdit(ev) {
    var el = ev.target, i = el.getAttribute('data-li'), f = el.getAttribute('data-f');
    if (i === null || !f) return;
    var idx = parseInt(i, 10), l = PO_DRAFT.lines[idx]; if (!l) return;
    l[f] = el.value;
    if (f === 'greige') {
      /* A different greige becomes a different RFD -- the description follows it, unless it has been
       * written by hand, in which case it is left as written. */
      l.rfd = fabRfdOfGreige(el.value);
      if (l.descAuto !== false) l.desc = 'RFD ready: ' + l.rfd;
      poDraw(); return;
    }
    if (f === 'desc') { l.descAuto = false; return; }
    if (f === 'due') return;
    /* REDRAWING THE WHOLE TABLE ON EVERY KEYSTROKE TAKES THE CURSOR OUT OF THE BOX. Only the
     * figures that are worked out move. */
    poSyncRow(idx);
  }
  $('poMill').addEventListener('input', poMillHint);
  $('poMill').addEventListener('change', poMillHint);
  $('poAdd').addEventListener('click', poAddLine);
  $('poSave').addEventListener('click', function () { poSave(''); });
  $('poSaveDoc').addEventListener('click', function () { poSave('doc'); });
  $('poDate').readOnly = true;
}

/* ui/inventory.js -- The Inventory screen.
 * An ES module. Its imports are worked out from the code by the split script. */

/* ---- INVENTORY, BY TYPE OF CLOTH (Ravi, 13 Oct) ------------------------------------------------ *
 *
 * What is on order from suppliers, what is in the store as greige, what is out at an RFD processor, what is on
 * the shelf as RFD, and the whole of it -- in metres, fabric by fabric, with a tab for each type of cloth
 * (Sheeting, Poplin, Rayon ...). Money is not on this screen. */
function invType(name) { var n = String(name || '').trim(); return n.replace(/\s*\d+(\.\d+)?"?\s*$/, '').trim() || n; }
/** Greige still due on open POs, by the RFD fabric it becomes. */
function invOnOrder() {
  var by = {};
  (DB.gpo || []).forEach(function (po) {
    var st = gpoStatus(po); if (st !== 'sent' && st !== 'part') return;
    gpoProgress(po).lines.forEach(function (l) {
      var k = String(l.rfd || fabRfdOfGreige(l.greige) || l.greige || '').trim();
      if (k && l.pending > 0.05) by[k.toUpperCase()] = { name: k, m: ((by[k.toUpperCase()] || {}).m || 0) + l.pending };
    });
  });
  return by;
}
function invAll() {
  var flow = {}, order = invOnOrder(), names = [];
  /* PPC's demand, in the app only (gdPpcMap lives in the app layer): a fabric PPC needs is a row even with nothing in stock. */
  var ppc = typeof gdPpcMap === 'function' ? gdPpcMap() : null;
  fabFlowRows(DB.fab || []).forEach(function (e) { flow[e.fabricType.toUpperCase()] = e; names.push(e.fabricType); });
  Object.keys(order).forEach(function (k) { if (!flow[k]) names.push(order[k].name); });
  if (ppc && !ppc.__loading) Object.keys(ppc).forEach(function (k) { if (!flow[k] && !order[k]) names.push(ppc[k].name); });
  return uniq(names).map(function (n) {
    var e = flow[n.toUpperCase()] || {}, o = order[n.toUpperCase()];
    var g = e.greigeLeft || 0, p = e.withProcessor || 0, r = e.rfdLeft || 0;
    return { fabric: n, type: invType(n), greige: fabGreigeOf(n), onOrder: o ? o.m : 0,
      inStoreGreige: g, atProcessor: p, inStoreRfd: r, owned: g + p + r,
      ppc: ppc && !ppc.__loading ? (ppc[n.toUpperCase()] || null) : null };
  }).filter(function (x) { return x.owned > 0.05 || x.onOrder > 0.05 || (x.ppc && x.ppc.need > 0.05); })
    .sort(function (a, b) { return a.type.localeCompare(b.type) || a.fabric.localeCompare(b.fabric, undefined, { numeric: true }); });
}
function renderInv() {
  var all = invAll(), types = uniq(all.map(function (x) { return x.type; })).sort();
  if (UI.inv !== 'all' && types.indexOf(UI.inv) < 0) UI.inv = 'all';
  var rows = all.filter(function (x) {
    return (UI.inv === 'all' || x.type === UI.inv) && (lmMatch(x.fabric) || lmMatch(x.greige) || lmMatch(x.type));
  });
  var sum = function (k) { return rows.reduce(function (a, x) { return a + (x[k] || 0); }, 0); };
  var count = function (t) { return all.filter(function (x) { return t === 'all' || x.type === t; }).length; };
  var seg = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px">'
    + '<div class="seg" role="tablist" aria-label="Type of cloth">'
    + ['all'].concat(types).map(function (t) {
      return '<button type="button" role="tab" aria-selected="' + (UI.inv === t) + '" class="segbtn' + (UI.inv === t ? ' on' : '') + '" data-inv="' + esc(t) + '">'
        + esc(t === 'all' ? 'All' : t) + ' <span class="n">' + count(t) + '</span></button>';
    }).join('') + '</div></div>';
  /* PPC DEMAND FIRST (Ravi, 15 Oct): what PPC needs, before what is on order — and the greige PO for what is short, from
   * here. And the RFD already on the floor goes in as opening stock from here too. Only in the app (gdPpcMap). */
  var ppcMap = typeof gdPpcMap === 'function' ? gdPpcMap() : null, withPpc = !!ppcMap;
  UI.invCols = withPpc ? 7 : 6;
  var ppcCell = function (r) {
    if (ppcMap && ppcMap.__loading) return '<td class="num muted">…</td>';
    var p = r.ppc; if (!p) return '<td class="num">' + dash(0) + '</td>';
    /* What the old Greige for PPC tab showed (Ravi, 15 Oct: "remove this and integrate … under the ppc demand column"):
     * need, the RFD free against it, short, what is already on its way, and the greige to order. */
    var sm = 'font-size:10.5px;line-height:1.5';
    return '<td class="num"><b>' + nf(p.need) + ' m</b><div class="muted" style="' + sm + '">' + plural(p.lines, 'line') + '</div>'
      + '<div class="muted" style="' + sm + '">RFD free ' + nf(p.free) + ' m' + (p.desk > 0.05 ? ' (' + nf(p.desk) + ' m this desk)' : '') + '</div>'
      + (p.short > 0.05 ? '<div style="' + sm + ';color:var(--bad);font-weight:700">short ' + nf(p.short) + ' m</div>'
        + (p.onWay > 0.05 ? '<div class="muted" style="' + sm + '">' + nf(p.onWay) + ' m greige on its way</div>' : '')
        + (p.greigeM ? '<div style="' + sm + ';font-weight:700">greige to order ' + nf(p.greigeM) + ' m</div>' : '<div style="' + sm + ';color:var(--ok-ink,#166534)">covered by what is on its way</div>')
        : '<div style="' + sm + ';color:var(--ok-ink,#166534)">covered</div>')
      + (p.greigeM && p.greige ? '<button type="button" class="jw-btn jw-primary" data-ppcpo="' + esc(p.name) + '|' + p.greigeM + '" style="margin-top:4px;padding:3px 10px;font-size:12px">Raise greige PO · ' + nf(p.greigeM) + ' m</button>'
        : p.greigeM ? '<div class="err-in" style="font-size:10.5px">no greige name in Master data</div>' : '') + '</td>';
  };
  var tools = '<div class="row" style="margin:0 0 10px;align-items:center">'
    + (canLedgerEdit() ? '<button type="button" class="ghost" data-act="OPENING_RFD" title="RFD already on the floor: its own lot, so it is issued like any other and never counted as cloth back from a processor.">+ RFD opening stock</button>' : '')
    + (withPpc ? '<button type="button" class="ghost" data-gdflow="drfd">Open the flow’s Demand → RFD</button>' : '')
    + (withPpc ? '<span class="muted" style="font-size:12px;align-self:center">PPC demand is what the production plans need in RFD; short is after the RFD free today; the PO button orders the greige for it (with ' + Math.round((typeof GD_LOSS !== 'undefined' ? GD_LOSS : 0.05) * 100) + '% for what the processor takes).</span>' : '')
    + '</div>';
  var table = tools + '<div class="card"><div class="ff-grid"><table class="xl">'
    + th(withPpc ? ['Fabric', 'PPC demand', 'Greige order', 'Greige in store', 'At RFD processor', 'RFD on shelf', 'Total'] : ['Fabric', 'Greige order', 'Greige in store', 'At RFD processor', 'RFD on shelf', 'Total'],
      withPpc ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5])
    + '<tbody>' + (rows.map(function (r) {
      return '<tr><td class="frz" style="text-align:left"><b>' + esc(r.fabric) + '</b>'
        + (r.greige ? '<div class="muted" style="font-size:10.5px">bought as ' + esc(r.greige) + '</div>' : '') + '</td>'
        + (withPpc ? ppcCell(r) : '')
        + invCell(r, 'order', r.onOrder, 'color:var(--warn-ink)')
        + invCell(r, 'store', r.inStoreGreige, '')
        + invCell(r, 'proc', r.atProcessor, 'color:var(--proc-ink)')
        + invCell(r, 'rfd', r.inStoreRfd, 'font-weight:700')
        + '<td class="num" style="font-weight:700">' + dash(r.owned) + '</td></tr>'
        + (UI.invOpen.indexOf(r.fabric + '|') === 0 ? invDetail(r, UI.invOpen.split('|')[1]) : '');
    }).join('') || emptyRow(UI.invCols, 'Nothing on order or in stock' + (UI.inv === 'all' ? '.' : ' for ' + UI.inv + '.')))
    + '</tbody>'
    + (rows.length > 1 ? '<tfoot><tr><td class="frz" style="text-align:left">Total' + (UI.inv === 'all' ? '' : ' · ' + esc(UI.inv)) + '</td>'
      + (withPpc ? '<td class="num">' + dash(rows.reduce(function (a, x) { return a + (x.ppc ? x.ppc.need : 0); }, 0)) + '</td>' : '')
      + '<td class="num">' + dash(sum('onOrder')) + '</td><td class="num">' + dash(sum('inStoreGreige')) + '</td><td class="num">' + dash(sum('atProcessor')) + '</td>'
      + '<td class="num">' + dash(sum('inStoreRfd')) + '</td><td class="num">' + dash(sum('owned')) + '</td></tr></tfoot>' : '')
    + '</table></div></div>';
  return seg + table;
}

/* ---- wiring: the type tabs ------------------------------------------------------------------------- */
/* ---- WHAT A FIGURE IS MADE OF (Ravi, 13 Oct: click a number and see, on the same page, what makes it) ---- *
 * Each figure in the table opens a drop-down under its row: the POs on order, the lots in the store with
 * their PO and challan, the lots at each RFD processor, the lots of RFD on the shelf. One open at a time. */
UI.invOpen = '';
function invLotsOf(fabric) {
  var F = String(fabric).toUpperCase();
  return fabLots(DB.fab || []).filter(function (g) {
    return String(fabRfdOfGreige(g.fabricType) || g.rfdFabric || g.fabricType || '').toUpperCase() === F;
  });
}
function invRowsOfLot(lot, kind) { return (DB.fab || []).filter(function (r) { return r.lot === lot && r.txnType === kind; }); }
var invJoin = function (list) { return uniq(list).join(', ') || '—'; };
var invLastDate = function (rows) { return rows.map(function (r) { return r.date; }).sort().pop() || ''; };
function invDetail(r, col) {
  var head, body, empty;
  if (col === 'order') {
    var lines = [];
    (DB.gpo || []).forEach(function (po) {
      var st = gpoStatus(po); if (st !== 'sent' && st !== 'part') return;
      gpoProgress(po).lines.forEach(function (l) {
        if (String(l.rfd || fabRfdOfGreige(l.greige)).toUpperCase() === r.fabric.toUpperCase() && l.pending > 0.05) lines.push({ po: po, l: l });
      });
    });
    head = ['PO', 'Supplier', 'PO date', 'Due on', 'Ordered', 'Received', 'Still due', 'Status', 'Next step'];
    body = lines.map(function (x) {
      return '<tr><td class="tl"><button type="button" class="link" data-openpo="' + esc(x.po.poNo) + '">' + esc(x.po.poNo) + '</button></td>'
        + '<td class="tl">' + esc(x.po.mill) + '</td><td class="tl">' + esc(fmtD(x.po.date)) + '</td><td class="tl">' + esc(fmtD(x.l.due || x.po.date)) + '</td>'
        + '<td class="num">' + nf(x.l.ordered) + ' m</td><td class="num">' + nf(x.l.received) + ' m</td><td class="num b">' + nf(x.l.pending) + ' m</td>'
        + '<td class="tl">' + poPill(x.po) + '</td>'
        + '<td><button type="button" class="jw-btn jw-primary" data-rcv="' + esc(x.po.poNo) + '">Receive greige</button></td></tr>';
    });
    empty = 'No open PO for ' + r.fabric + '.';
  } else if (col === 'store') {
    head = ['Lot', 'PO', 'Supplier challan', 'Supplier', 'Received on', 'Received', 'Sent to RFD', 'In store', 'Next step'];
    body = invLotsOf(r.fabric).filter(function (g) { return g.greigeLeft > 0.05; }).map(function (g) {
      var rec = invRowsOfLot(g.lot, 'RECEIVE_GREIGE');
      return '<tr><td class="tl mono b">' + esc(g.lot) + '</td><td class="tl">' + esc(invJoin(rec.map(function (x) { return x.orderNo; }))) + '</td>'
        + '<td class="tl mono">' + esc(invJoin(rec.map(function (x) { return x.bill; }))) + '</td><td class="tl">' + esc(g.mill || '—') + '</td>'
        + '<td class="tl">' + esc(fmtD(g.date)) + '</td><td class="num">' + nf(g.greigeIn) + ' m</td>'
        + '<td class="num">' + (g.toRfd ? nf(g.toRfd) + ' m' : '—') + '</td><td class="num b">' + nf(g.greigeLeft) + ' m</td>'
        + '<td>' + (g.poNo ? '<button type="button" class="jw-btn jw-wa" data-iss="' + esc(g.poNo) + '|' + esc(g.lot) + '">Issue to RFD</button>' : '') + '</td></tr>';
    });
    empty = 'No greige of ' + r.fabric + ' is in the store.';
  } else if (col === 'proc') {
    head = ['Lot', 'RFD processor', 'Our challan', 'Sent on', 'Days out', 'Sent', 'Back so far', 'Still out', 'PO', 'Next step'];
    body = invLotsOf(r.fabric).filter(function (g) { return g.withProcessor > 0.05; }).map(function (g) {
      var out = invRowsOfLot(g.lot, 'ISSUE_TO_RFD'), sentOn = invLastDate(out), d = lmDays(sentOn);
      return '<tr><td class="tl mono b">' + esc(g.lot) + '</td><td class="tl b">' + esc(invJoin(out.map(function (x) { return x.party; }))) + '</td>'
        + '<td class="tl mono">' + esc(invJoin(out.map(function (x) { return x.bill; }))) + '</td><td class="tl">' + esc(fmtD(sentOn)) + '</td>'
        + '<td class="num"' + (d > CHASE_PROCESSOR_DAYS ? ' style="color:var(--bad);font-weight:700"' : '') + '>' + (d === null ? '—' : d + ' d') + '</td>'
        + '<td class="num">' + nf(g.toRfd) + ' m</td><td class="num">' + (g.rfdIn ? nf(g.rfdIn) + ' m' : '—') + '</td><td class="num b">' + nf(g.withProcessor) + ' m</td>'
        + '<td class="tl">' + esc(g.poNo || '—') + '</td>'
        + '<td>' + (g.poNo ? '<button type="button" class="jw-btn jw-wa" data-rr="' + esc(g.poNo) + '|' + esc(g.lot) + '">Receive RFD</button>' : '') + '</td></tr>';
    });
    empty = 'Nothing of ' + r.fabric + ' is at an RFD processor.';
  } else {
    head = ['Lot', 'PO', 'Supplier challan', 'RFD processor', 'Back on', 'Came back', 'To cutting', 'Damaged', 'On shelf', 'Next step'];
    body = invLotsOf(r.fabric).filter(function (g) { return g.rfdLeft > 0.05; }).map(function (g) {
      var rec = invRowsOfLot(g.lot, 'RECEIVE_GREIGE'), back = invRowsOfLot(g.lot, 'RECEIVE_RFD');
      var came = g.rfdIn + g.rfdOpen + g.rfdBuy, how = g.rfdOpen ? 'opening stock' : g.rfdBuy ? 'bought ready' : '';
      return '<tr><td class="tl mono b">' + esc(g.lot) + (how ? '<div class="sub">' + how + '</div>' : '') + '</td>'
        + '<td class="tl">' + esc(invJoin(rec.map(function (x) { return x.orderNo; }))) + '</td>'
        + '<td class="tl mono">' + esc(invJoin(rec.map(function (x) { return x.bill; }))) + '</td>'
        + '<td class="tl">' + esc(g.processor || '—') + '</td><td class="tl">' + esc(fmtD(invLastDate(back) || g.date)) + '</td>'
        + '<td class="num">' + nf(came) + ' m</td><td class="num">' + (g.rfdOut ? nf(g.rfdOut) + ' m' : '—') + '</td>'
        + '<td class="num">' + (g.dmgRfd ? '<span class="err-in">' + nf(g.dmgRfd) + ' m</span>' : '—') + '</td><td class="num b">' + nf(g.rfdLeft) + ' m</td>'
        + '<td><button type="button" class="jw-btn jw-primary" data-cut="' + esc(g.lot) + '">Send to cutting</button></td></tr>';
    });
    empty = 'No RFD ' + r.fabric + ' is on the shelf.';
  }
  var title = { order: 'Greige on order', store: 'Greige in the store', proc: 'At the RFD processor', rfd: 'RFD on the shelf' }[col];
  return '<tr class="invdet"><td colspan="' + (UI.invCols || 6) + '"><div class="invdrop"><div class="sect">' + esc(title) + ' · ' + esc(r.fabric) + '</div>'
    + (body.length ? '<div class="box scroll"><table class="ct li"><thead><tr>' + head.map(function (x, i) {
        return '<th' + (/^(Ordered|Received|Still due|Sent|Back so far|Still out|In store|Came back|To cutting|Damaged|On shelf|Days out|Sent to RFD)$/.test(x) ? ' class="num"' : '') + '>' + esc(x) + '</th>';
      }).join('') + '</tr></thead><tbody>' + body.join('') + '</tbody></table></div>'
      : '<div class="empty">' + esc(empty) + '</div>')
    + '</div></td></tr>';
}
/** A figure that opens its drop-down; a dash when there is nothing behind it. */
function invCell(r, col, v, style) {
  if (!(v > 0.05)) return '<td class="num"' + (style ? ' style="' + style + '"' : '') + '><span class="muted">&mdash;</span></td>';
  var key = r.fabric + '|' + col, on = UI.invOpen === key;
  return '<td class="num"><button type="button" class="cellbtn' + (on ? ' on' : '') + '" data-invd="' + esc(key) + '" aria-expanded="' + on + '"'
    + (style ? ' style="' + style + '"' : '') + ' title="Show what makes this up">' + nf(v) + ' <span class="caret">' + (on ? '▴' : '▾') + '</span></button></td>';
}
function wireInventory() {
  document.addEventListener('click', function (ev) {
    var d = ev.target.closest ? ev.target.closest('[data-invd],[data-openpo]') : null;
    if (d && d.getAttribute('data-invd')) { var k = d.getAttribute('data-invd'); UI.invOpen = UI.invOpen === k ? '' : k; render(); return; }
    /* A PO in a drop-down opens on Greige POs, expanded. */
    if (d && d.getAttribute('data-openpo')) { var pn = d.getAttribute('data-openpo'); PV.openPo[pn] = true; PV.view = 'po'; PV.st = ''; UI.tab = 'po'; render(); window.scrollTo(0, 0); return; }
    var t = ev.target.closest ? ev.target.closest('[data-inv]') : null;
    if (!t) return;
    UI.inv = t.getAttribute('data-inv') || 'all'; UI.invOpen = ''; render();
  });
}

/* ui/ledger.js -- The Fabric ledger screen and its filter.
 * An ES module. Its imports are worked out from the code by the split script. */
/* The ledger's own filter. Kept out of UI.q because the search box is shared by every screen and
 * this one is not -- a date range set here should not quietly follow you to the PO list. */
var LF = { from: '', to: '', kind: '', fabric: '', party: '', po: '', done: '' };

/* ---- the register itself, which is the only thing that is actually stored ------------------- */
/** Does a row survive the filter bar? Every box left blank matches everything. */
function lfKeep(r) {
  if (LF.from && String(r.date || '') < LF.from) return false;
  if (LF.to && String(r.date || '') > LF.to) return false;
  if (LF.kind && r.txnType !== LF.kind) return false;
  if (LF.fabric && String(r.fabricType || '').trim() !== LF.fabric) return false;
  if (LF.party && String(r.party || '').trim() !== LF.party) return false;
  if (LF.po && String(r.orderNo || '').trim().toUpperCase() !== LF.po.toUpperCase()) return false;
  if (LF.done === 'open' && r.done) return false;
  if (LF.done === 'done' && !r.done) return false;
  return true;
}
var lfOn = function () {
  return !!(LF.from || LF.to || LF.kind || LF.fabric || LF.party || LF.po || LF.done);
};
/** One dropdown, with everything the register actually holds in it. */
function lfSelect(key, label, values, labels) {
  return '<label style="margin:0;display:flex;align-items:center;gap:6px;font-size:12px">' + esc(label)
    + '<select data-lf="' + key + '" style="height:32px;padding:0 8px;font-size:12.5px;width:auto">'
    + '<option value="">All</option>'
    + values.map(function (v, i) {
      return '<option value="' + esc(v) + '"' + (LF[key] === v ? ' selected' : '') + '>'
        + esc(labels ? labels[i] : v) + '</option>';
    }).join('') + '</select></label>';
}

function renderLedger() {
  var all = (DB.fab || []).slice().sort(function (a, b) {
    return String(b.date).localeCompare(String(a.date)) || String(b.id).localeCompare(String(a.id));
  });
  /* The PO and the challan are searchable too -- they are what a question about a delivery
   * usually starts from. */
  var rows = all.filter(function (r) {
    if (!lfKeep(r)) return false;
    return lmMatch(r.lot) || lmMatch(r.fabricType) || lmMatch(r.party) || lmMatch(FAB_LABEL[r.txnType])
      || lmMatch(r.orderNo) || lmMatch(r.bill);
  });

  /* THE LISTS ARE BUILT FROM THE REGISTER, not from Masters -- a cloth or a mill that appears on a
   * row has to be filterable even if somebody has since switched it off upstream. */
  var fabrics = uniq(all.map(function (r) { return r.fabricType; })).sort();
  var parties = uniq(all.map(function (r) { return r.party; })).sort();
  var pos = uniq(all.map(function (r) { return r.orderNo; })).sort();
  var kinds = Object.keys(FAB_SIGN);

  var inM = rows.reduce(function (a, r) { return a + (FAB_SIGN[r.txnType] > 0 ? fabQty(r) : 0); }, 0);
  var outM = rows.reduce(function (a, r) { return a + (FAB_SIGN[r.txnType] < 0 ? fabQty(r) : 0); }, 0);

  var filters = '<div class="card" style="padding:12px 14px;margin-bottom:12px">'
    + '<div class="toolbar" style="gap:10px">'
    + '<label style="margin:0;display:flex;align-items:center;gap:6px;font-size:12px">From'
    + '<input type="date" data-lf="from" value="' + esc(LF.from) + '" style="height:32px;width:auto;font-size:12.5px"></label>'
    + '<label style="margin:0;display:flex;align-items:center;gap:6px;font-size:12px">To'
    + '<input type="date" data-lf="to" value="' + esc(LF.to) + '" style="height:32px;width:auto;font-size:12.5px"></label>'
    + lfSelect('kind', 'Movement', kinds, kinds.map(function (k) { return FAB_LABEL[k]; }))
    + lfSelect('fabric', 'Fabric', fabrics)
    + lfSelect('party', 'Party', parties)
    + lfSelect('po', 'PO', pos)
    + lfSelect('done', 'Status', ['open', 'done'], ['Still open', 'Fulfilled'])
    + (lfOn() ? '<button type="button" class="jw-btn" id="lfClear">Clear the filter</button>' : '')
    + '</div></div>';

  var count = rows.length === all.length
    ? all.length + ' movement' + (all.length === 1 ? '' : 's')
    : '<b>' + rows.length + '</b> of ' + all.length + ' movements';
  var openN = rows.filter(function (r) { return !r.done; }).length;
  if (openN !== rows.length) count += ' · <b>' + openN + '</b> still open';

  return '<div class="row" style="margin-bottom:10px;align-items:center">'
    + '<span class="muted" style="font-size:12px;align-self:center">Add a movement:</span>'
    + (canLedgerEdit() ? '' : '<span class="pill pill-mute">View only · ' + esc(meUser().name) + '</span>')
    + kinds.filter(function (k) { return canLedgerEdit() && k !== 'RECEIVE_GREIGE' && k !== 'ISSUE_TO_RFD' && k !== 'RECEIVE_RFD'; }).map(function (k) {
      return '<button type="button" class="ghost" data-act="' + k + '" style="padding:6px 12px;font-size:12.5px">'
        + esc(FAB_LABEL[k]) + '</button>';
    }).join('') + '<span class="muted" style="font-size:12px;align-self:center">Greige received, sent to RFD and RFD received back are done from each PO on Greige POs.</span></div>'
    + filters
    + '<div class="card"><div class="ff-cap">' + count + ', newest first · '
    + '<b style="color:var(--ok-ink)">' + nf(inM) + ' m</b> in · <b style="color:var(--bad)">' + nf(outM) + ' m</b> out. '
    + 'Nothing on this page is a stored total — every figure in the app is worked out from these rows.</div>'
    + '<div class="ff-grid"><table class="xl">'
    /* READ THE WAY A DELIVERY IS LOOKED UP: the day, the order it came against, the cloth, and who
     * it came from. The lot and the movement follow, because they answer the next question, not
     * the first one. */
    + th(['Date', 'PO', 'Fabric', 'Challan', 'Party', 'Lot', 'Movement', 'State', 'Metres', ''], [8])
    + '<tbody>' + (rows.map(function (r) {
      var sign = FAB_SIGN[r.txnType] || 0;
      return '<tr><td class="frz">' + esc(r.date) + '</td>'
        + '<td>' + (r.orderNo ? '<b>' + esc(r.orderNo) + '</b>' : '<span class="muted">—</span>') + '</td>'
        + '<td style="text-align:left">' + esc(r.fabricType) + '</td>'
        /* The bill or challan sits with the cloth it came on: the two are read together off the
         * paper in your hand, so they are read together here. */
        + '<td>' + (r.bill ? '<span class="mono">' + esc(r.bill) + '</span><div class="sub">' + ({ ISSUE_TO_RFD: 'our RFD challan', RECEIVE_RFD: 'processor’s', RECEIVE_GREIGE: 'supplier’s', PURCHASE_RFD: 'supplier’s' }[r.txnType] || '') + '</div>' : '<span class="muted">—</span>') + '</td>'
        + '<td style="text-align:left">' + (r.party ? esc(r.party) : '<span class="muted">—</span>') + '</td>'
        + '<td style="text-align:left"><b>' + esc(r.lot) + '</b></td>'
        + '<td style="text-align:left"' + (r.txnType === 'DAMAGE' ? ' style="text-align:left;color:var(--bad);font-weight:700"' : '') + '>'
        + esc(FAB_LABEL[r.txnType] || r.txnType)
        + (r.approval && r.approval.status !== 'approved' ? '<div><span class="pill ' + (r.approval.status === 'pending' ? 'pill-low' : 'pill-out') + '">' + (r.approval.status === 'pending' ? 'Waiting for approval' : 'Rejected') + ' · ' + r.approval.pct + '% shrinkage</span></div>' : '')
        + (r.approval && r.approval.status === 'approved' ? '<div class="sub">approved by ' + esc(r.approval.by || '') + ' · ' + r.approval.pct + '%</div>' : '')
        + (r.bales && r.bales.length ? '<div class="sub">' + r.bales.length + ' bales</div>' : '')
        + (r.thans && r.thans.length ? '<div class="sub">' + r.thans.length + ' thans</div>' : '')
        + (r.txnType === 'DAMAGE' && r.note
          ? '<div class="muted" style="font-size:10.5px;font-weight:400">' + esc(r.note) + '</div>' : '')
        + '</td>'
        + '<td><span class="pill ' + (fabState(r) === 'GREIGE' ? 'pill-low' : 'pill-sea') + '">'
        + esc(FAB_STATE_LABEL[fabState(r)] || fabState(r)) + '</span></td>'
        + '<td class="num" style="font-weight:700">' + (sign < 0 ? '−' : '+') + nf(fabQty(r))
        + (r.pieces && r.pieces.length ? '<div class="muted" style="font-size:10.5px;font-weight:400">' + r.pieces.length + ' pcs on the challan</div>' : '')
        + (r.returned
          ? '<div class="muted" style="font-size:10.5px;font-weight:400">' + nf(r.gross)
            + ' on the challan, ' + nf(r.returned) + ' sent back</div>' : '')
        + (r.remark && r.txnType !== 'DAMAGE'
          ? '<div class="muted" style="font-size:10.5px;font-weight:400">' + esc(r.remark) + '</div>' : '')
        + '</td>'
        + '<td style="white-space:nowrap">' + (!canLedgerEdit() ? '<span class="muted">' + (r.done ? '✓ Fulfilled' : '') + '</span>' : '')
        + (!canLedgerEdit() ? '' : '<button type="button" class="jw-btn jw-primary" data-edit="' + esc(r.id) + '">Edit</button> ')
        + (!canLedgerEdit() ? '' : r.done
          ? '<button type="button" class="jw-btn jw-wa" data-done="' + esc(r.id) + '" '
            + 'title="Dealt with. Click to put it back on the list.">✓ Fulfilled</button>'
          : '<button type="button" class="jw-btn" data-done="' + esc(r.id) + '" '
            + 'title="Mark this movement as dealt with">Mark fulfilled</button>')
        + '</td></tr>';
    }).join('') || emptyRow(10, lfOn() || UI.q ? 'No movement matches the filter.' : 'The register is empty.'))
    + '</tbody></table></div></div>';
}

/* ---- wiring: the ledger rows and the filter bar ---------------------------------------------------- */
function wireLedger() {
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('#lfClear,[data-edit],[data-done],[data-del]') : null;
    if (!t) return;
    var g = function (k) { return t.getAttribute(k); };
    if (g('data-edit')) {
      var er = (DB.fab || []).filter(function (x) { return x.id === g('data-edit'); })[0];
      if (er) entryOpen(er.txnType, er);
      return;
    }
    if (g('data-done')) {
      /* A WORKING MARK, NOT A FIGURE. Fulfilled says somebody has dealt with this row -- chased it,
       * filed it, tallied it against the paper. It changes no balance anywhere: what the cloth did
       * is a fact, and a tick cannot alter it. */
      var dr = (DB.fab || []).filter(function (x) { return x.id === g('data-done'); })[0];
      if (dr) { dr.done = !dr.done; lmSaveDb(); render(); }
      return;
    }
    if (g('data-del')) {
      /* UNDO, NOT DELETE: the row comes out of the register and every figure above is worked out
       * again. Taking out a receipt a lot has already been issued against will show as a negative. */
      DB.fab = DB.fab.filter(function (r) { return r.id !== g('data-del'); });
      lmSaveDb(); render(); return;
    }
    if (t.id === 'lfClear') {
      LF = { from: '', to: '', kind: '', fabric: '', party: '', po: '', done: '' };
      render(); return;
    }
  });
  /* THE FILTER REDRAWS ON COMMIT, NOT ON EVERY KEYSTROKE -- a date half typed is not a date, and
   * a table that reshuffles under the cursor is not one anybody can use. */
  document.addEventListener('change', function (ev) {
    var k = ev.target.getAttribute && ev.target.getAttribute('data-lf');
    if (!k) return;
    LF[k] = ev.target.value;
    render();
  });
}

/* ui/master-data.js -- The Master data screen: fabric types, mills and vendors, the company.
 * An ES module. Its imports are worked out from the code by the split script. */

/* ---- Masters, where a cloth is actually described ------------------------------------------- *
 *
 * Everything the mill, the processor and the cutting table need to agree on, in one row per cloth.
 * It is typed here once; the PO, the lot and the challan all read it.
 */
var MST_COLS = [
  ['warp', 'Warp', 'yarn', 'The lengthwise yarn — 40s single, 2/40s two-fold'],
  ['weft', 'Weft', 'yarn', 'The crosswise yarn — 40s single, 2/40s two-fold'],
  ['epi', 'EPI', 'num', 'Ends per inch — warp yarns in an inch of width'],
  ['ppi', 'PPI', 'num', 'Picks per inch — weft yarns in an inch of length'],
  ['greigeWidth', 'Greige width', 'in', 'Inches on the loom — what the PO is written in'],
  ['rfdWidth', 'RFD width', 'in', 'Inches after processing — what cutting gets'],
];

/* WHAT A CLOTH IS DOES NOT CHANGE WHILE YOU LOOK AT IT.
 *
 * A fabric type is settled once and then read by every PO, lot and challan for years. Left as a
 * grid of open boxes it is one stray keystroke away from a cloth quietly becoming something else --
 * and nothing downstream would know. So the row is plain text, and one row at a time can be opened
 * with Edit. Cancel puts back exactly what was there. */
var MST_EDIT = null;   /* the row being edited, or null */
var MST_SNAP = null;   /* what it looked like before, for Cancel */

/** A value as it is read, not as it is typed. */
function mstShow(m, c) {
  var v = m[c[0]];
  if (v === '' || v == null) return '<span class="muted">—</span>';
  if (c[2] === 'yarn') return esc(mstYarn(v));
  if (c[2] === 'in') return esc(v) + '"';
  if (c[2] === 'pct') return esc(v) + '%';
  return esc(v);
}

var VEN_COLS = [
  ['kind', 'Kind', 'kind', 'A supplier sells the greige; an RFD processor bleaches it'],
  ['phone', 'Phone', 'text', ''],
  ['email', 'E-mail', 'text', 'Where a PO is mailed'],
  ['addr', 'Address', 'text', 'The street line on the PO; the city follows it'],
  ['city', 'City', 'text', ''],
  ['gstin', 'GSTIN', 'text', '15 characters: state code, PAN, registration no., Z, check character. Checked when saved.'],
];
var VEN_KINDS = ['Supplier', 'RFD Processor'];
var VEN_EDIT = null;
var VEN_SNAP = null;

/** The two sets of master data, behind one switch. */
function renderMst() {
  var seg = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">'
    + '<div class="seg" role="tablist">'
    + '<button type="button" class="segbtn' + (UI.mst === 'ven' || UI.mst === 'co' || UI.mst === 'users' ? '' : ' on') + '" data-mstview="fabric">Fabric</button>'
    + '<button type="button" class="segbtn' + (UI.mst === 'ven' ? ' on' : '') + '" data-mstview="ven">Suppliers &amp; RFD processors</button>'
    + '<button type="button" class="segbtn' + (UI.mst === 'co' ? ' on' : '') + '" data-mstview="co">Company</button>'
    + '<button type="button" class="segbtn' + (UI.mst === 'users' ? ' on' : '') + '" data-mstview="users">Users &amp; access</button>'
    + '</div></div>';
  return seg + (UI.mst === 'ven' ? renderMstVen() : UI.mst === 'co' ? renderMstCo() : UI.mst === 'users' ? renderMstUsers() : renderMstFabric());
}

/* JOINED TO THE APP'S MASTER DATA (Ravi, 15 Oct: "greige ka and masterdata ka interlink hona chahiye"). Inside the app the
 * fabrics and the suppliers / RFD processors are Setup -> Master Database's own (gdLinked, app-layer.js): shown here,
 * changed there. The page on its own keeps its own lists, as before. */
function gdIsLinked() { return typeof gdLinked === 'function' && gdLinked(); }
function gdLinkedCap(what, view) {
  return '<div class="ff-cap" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><span>These ' + what + ' are the app\'s <b>Master Data</b> '
    + '(Setup &rarr; Master Database). They are shown here and changed there, so every screen reads the same names.</span>'
    + '<button type="button" class="jw-btn jw-primary" data-gdmd="' + view + '">Open in Master Data</button></div>';
}
function renderMstVen() {
  if (gdIsLinked()) return renderMstVenLinked();
  var list = (DB.ven || []).map(function (v, i) { return { v: v, i: i }; })
    .filter(function (x) { return lmMatch(x.v.name) || lmMatch(x.v.city) || lmMatch(x.v.kind); });

  var head = '<thead><tr><th class="frz">Name</th>'
    + VEN_COLS.map(function (c) {
      return '<th class="num"' + (c[3] ? ' title="' + esc(c[3]) + '"' : '') + '>' + esc(c[1]) + '</th>';
    }).join('')
    + '<th class="num" title="How many rows of the register answer to this name">On record</th>'
    + '<th>Active</th><th></th></tr></thead>';

  var body = list.map(function (x) {
    var v = x.v, i = x.i, editing = VEN_EDIT === i, used = venUsed(v.name);

    var name = editing
      ? '<input data-vi="' + i + '" data-vf="name" value="' + esc(v.name) + '" style="width:180px;font-weight:700">'
      : '<b>' + esc(v.name || DASH) + '</b>';

    var cells = VEN_COLS.map(function (c) {
      var val = v[c[0]] == null ? '' : v[c[0]];
      if (!editing) {
        if (c[0] === 'kind') {
          var vk = venKind(v);
          return '<td><span class="pill ' + (vk === 'RFD Processor' ? 'pill-sea' : 'pill-ok') + '">' + esc(vk || DASH) + '</span></td>';
        }
        if (c[0] === 'gstin' && val) {
          return '<td class="num"><span class="mono">' + esc(val) + '</span>' + (gstinProblem(val) ? '<div class="err-in" style="font-size:10.5px">not a valid GSTIN</div>' : '') + (gstState(val)
            ? '<div class="muted" style="font-size:10.5px">' + esc(gstState(val)) + '</div>' : '') + '</td>';
        }
        return '<td class="num">' + (val ? esc(val) : MUTED_DASH) + '</td>';
      }
      if (c[0] === 'kind') {
        return '<td><select data-vi="' + i + '" data-vf="kind" style="width:108px">'
          + VEN_KINDS.map(function (k) {
            return '<option value="' + k + '"' + (k === venKind(v) ? ' selected' : '') + '>' + k + '</option>';
          }).join('') + '</select></td>';
      }
      return '<td><input data-vi="' + i + '" data-vf="' + c[0] + '" value="' + esc(val) + '" style="width:150px"></td>';
    }).join('');

    var acts = editing
      ? '<button type="button" class="jw-btn jw-primary" data-vsave="' + i + '">Save</button> '
        + '<button type="button" class="jw-btn" data-vcancel="' + i + '">Cancel</button> '
        + '<button type="button" class="lm-x" data-vrm="' + i + '" title="Remove this vendor">&times;</button>'
      : '<button type="button" class="jw-btn" data-vedit="' + i + '">Edit</button>';

    return '<tr' + (editing ? ' class="jw-on"' : '') + '>'
      + '<td class="frz" style="text-align:left">' + name + '</td>' + cells
      + '<td class="num">' + (used ? used : MUTED_DASH) + '</td>'
      + '<td><button type="button" class="jw-btn' + (v.active === false ? '' : ' jw-primary') + '" data-vact="' + i + '">'
      + (v.active === false ? 'Off' : 'On') + '</button></td>'
      + '<td style="white-space:nowrap">' + acts + '</td></tr>';
  }).join('') || emptyRow(VEN_COLS.length + 4, 'No supplier or RFD processor yet.');

  return '<div class="card">'
    + '<div class="ff-cap">A <b>supplier</b> sells the greige and is who a PO is raised on. An <b>RFD processor</b> '
    + 'bleaches it and is who a lot is sent to. Mark one <b>Both</b> if they do the two. Switching a vendor '
    + 'off takes them out of the pickers without losing the rows they are already on.</div>'
    + '<div class="ff-grid"><table class="xl xl-dense lm-lines" id="venTable">' + head + '<tbody>' + body + '</tbody></table></div>'
    + '<div class="row" style="margin-top:12px"><button type="button" id="venAdd">+ Add a supplier or RFD processor</button>'
    + '<span class="muted" style="align-self:center;font-size:12px">These names fill the PO and the entry screens.</span></div>'
    + '</div>';
}

function venOpen(i) {
  if (VEN_EDIT !== null && VEN_EDIT !== i) venCancel();
  VEN_EDIT = i; VEN_SNAP = JSON.parse(JSON.stringify(DB.ven[i]));
  render();
  var first = document.querySelector('#venTable input'); if (first) { first.focus(); first.select(); }
}
function venCancel() {
  if (VEN_EDIT !== null && VEN_SNAP) DB.ven[VEN_EDIT] = VEN_SNAP;
  VEN_EDIT = null; VEN_SNAP = null; lmSaveDb();
}
function venClose() { VEN_EDIT = null; VEN_SNAP = null; lmSaveDb(); }

/* ---- the company: printed at the head of every PO --------------------------------------------- *
 *
 * KEPT IN THIS BROWSER, NOT IN THE PAGE. The PAN and GSTIN are typed in here once and saved with the
 * rest of the registers on this machine. None of it is written into the published page, so a link
 * passed round to show somebody the screens never carries the company's own numbers with it. */
var CO_FIELDS = [
  ['name', 'Company name', 'text', 'As it is printed on every PO'],
  ['addr', 'Address', 'area', 'One line per line on the paper'],
  ['email', 'E-mail', 'text', ''],
  ['gstin', 'GSTIN/UIN', 'text', 'The state and its code are read off the first two digits'],
  ['iec', 'IEC', 'text', 'Import-export code'],
  ['pan', 'PAN', 'text', ''],
  ['jurisdiction', 'Jurisdiction', 'text', '"Subject to ___ jurisdiction"'],
  ['poPrefix', 'PO number prefix', 'text', 'RIDHI/PO/GREIG/'],
  ['rfdPrefix', 'RFD challan prefix', 'text', 'RIDHI/RFD/ -- our challan to the RFD processor, numbered 001 on'],
  ['poNext', 'Next PO number', 'text', 'The series carries on from this, or from the last PO raised, whichever is higher']
];
var CO_EDIT = false, CO_SNAP = null;
function coCancel() { if (CO_EDIT && CO_SNAP) DB.co = CO_SNAP; CO_EDIT = false; CO_SNAP = null; lmSaveDb(); }

function renderMstCo() {
  var co = DB.co || {};
  var rows = CO_FIELDS.map(function (f) {
    var v = co[f[0]] == null ? '' : String(co[f[0]]);
    var shown;
    if (CO_EDIT) {
      shown = f[2] === 'area'
        ? '<textarea data-cf="' + f[0] + '" rows="3" style="width:100%;max-width:540px">' + esc(v) + '</textarea>'
        : '<input data-cf="' + f[0] + '" value="' + esc(v) + '" style="width:100%;max-width:540px">';
    } else {
      shown = (v ? esc(v).replace(/\n/g, '<br>') : MUTED_DASH)
        + (f[0] === 'gstin' && gstState(v) ? '<div class="muted" style="font-size:11px">State: ' + esc(gstState(v)) + '</div>' : '');
    }
    return '<tr><td class="frz" style="text-align:left;width:230px;white-space:normal"><b>' + esc(f[1]) + '</b>'
      + (f[3] ? '<div class="muted" style="font-size:10.5px;font-weight:400">' + esc(f[3]) + '</div>' : '') + '</td>'
      + '<td style="text-align:left;white-space:normal">' + shown + '</td></tr>';
  }).join('');
  var nextNo = gpoNewNo();
  return '<div class="card">'
    + '<div class="ff-cap">Printed at the head of every purchase order. Saved in this browser only \u2014 '
    + 'none of it is written into the published page. The next PO will be <b>' + esc(nextNo) + '</b>.</div>'
    + '<div class="ff-grid"><table class="xl xl-dense">' + '<tbody>' + rows + '</tbody></table></div>'
    + '<div class="row" style="margin-top:12px">'
    + (CO_EDIT
      ? '<button type="button" data-co="save">Save</button><button type="button" class="ghost" data-co="cancel">Cancel</button>'
      : '<button type="button" class="ghost" data-co="edit">Edit</button>')
    + '</div></div>';
}

/** The fabric list, read-only: the app's Greige & RFD fabric, with what the desk works out from it. */
function renderMstFabricLinked() {
  var head = '<thead><tr><th class="frz">Fabric</th>'
    + MST_COLS.map(function (c) { return '<th class="num" title="' + esc(c[3]) + '">' + esc(c[1]) + '</th>'; }).join('')
    + '<th class="num" title="Ends and picks added together">TC</th><th class="num" title="How much width the bleach takes">Width loss</th></tr></thead>';
  var body = (DB.mst || []).map(function (m) {
    return '<tr><td class="frz" style="text-align:left">' + (m.rfd ? '<b>' + esc(m.rfd) + '</b>' : '<i class="muted">No RFD fabric</i>')
      + (m.title && m.title !== m.rfd ? '<div style="font-size:11.5px;color:#4A6A92">' + esc(m.title) + '</div>' : '')
      + '<div class="muted" style="margin-top:2px">' + esc(m.greige || '') + '</div>'
      + '<div class="muted mst-spec" style="font-size:10.5px;margin-top:3px">' + esc(mstSpecLine(m)) + '</div></td>'
      + MST_COLS.map(function (c) { return '<td class="num">' + mstShow(m, c) + '</td>'; }).join('')
      + '<td class="num mst-tc" style="font-weight:700">' + (mstTC(m) === null ? '<span class="muted">&mdash;</span>' : mstTC(m)) + '</td>'
      + '<td class="num mst-loss">' + (mstWidthLoss(m) === null ? '<span class="muted">&mdash;</span>' : mstWidthLoss(m) + '%') + '</td></tr>';
  }).join('') || emptyRow(MST_COLS.length + 3, 'No fabric in the Master Data yet.');
  return '<div class="card">' + gdLinkedCap('fabrics', 'fabric')
    + '<div class="ff-grid"><table class="xl xl-dense lm-lines" id="mstTable">' + head + '<tbody>' + body + '</tbody></table></div></div>';
}
/** The suppliers and RFD processors, read-only: the app's Vendors (greige and RFD vendors). */
function renderMstVenLinked() {
  var list = (DB.ven || []).filter(function (v) { return lmMatch(v.name) || lmMatch(v.city) || lmMatch(v.kind); });
  var head = '<thead><tr><th class="frz">Name</th>'
    + VEN_COLS.map(function (c) { return '<th class="num"' + (c[3] ? ' title="' + esc(c[3]) + '"' : '') + '>' + esc(c[1]) + '</th>'; }).join('')
    + '<th class="num" title="How many rows of the register answer to this name">On record</th></tr></thead>';
  var body = list.map(function (v) {
    var used = venUsed(v.name);
    return '<tr><td class="frz" style="text-align:left"><b>' + esc(v.name || DASH) + '</b>'
      + (v.deskOnly ? '<div class="muted" style="font-size:10.5px">only on the Greige Desk &mdash; not in the Master Data</div>' : '') + '</td>'
      + VEN_COLS.map(function (c) {
        var val = v[c[0]] == null ? '' : v[c[0]];
        if (c[0] === 'kind') { var vk = venKind(v); return '<td><span class="pill ' + (vk === 'RFD Processor' ? 'pill-sea' : 'pill-ok') + '">' + esc(vk || DASH) + '</span></td>'; }
        if (c[0] === 'gstin' && val) return '<td class="num"><span class="mono">' + esc(val) + '</span></td>';
        return '<td class="num">' + (val ? esc(val) : MUTED_DASH) + '</td>';
      }).join('')
      + '<td class="num">' + (used ? used : MUTED_DASH) + '</td></tr>';
  }).join('') || emptyRow(VEN_COLS.length + 2, 'No greige or RFD vendor in the Master Data yet.');
  return '<div class="card">' + gdLinkedCap('suppliers and RFD processors', 'vendors')
    + '<div class="ff-grid"><table class="xl xl-dense lm-lines" id="venTable">' + head + '<tbody>' + body + '</tbody></table></div></div>';
}
function renderMstFabric() {
  if (gdIsLinked()) return renderMstFabricLinked();
  var head = '<thead><tr><th class="frz">Fabric</th>'
    + MST_COLS.map(function (c) {
      return '<th class="num" title="' + esc(c[3]) + '">' + esc(c[1]) + '</th>';
    }).join('')
    + '<th class="num" title="Ends and picks added together — how bed linen is sold">TC</th>'
    + '<th class="num" title="How much width the bleach takes">Width loss</th>'
    + '<th>Active</th><th></th></tr></thead>';

  var body = (DB.mst || []).map(function (m, i) {
    var editing = MST_EDIT === i;

    var name = editing
      ? '<input data-mi="' + i + '" data-mf="rfd" value="' + esc(m.rfd) + '" style="width:140px;font-weight:700">'
        + '<div style="margin-top:4px"><input data-mi="' + i + '" data-mf="greige" value="' + esc(m.greige) + '" style="width:170px"></div>'
        + '<div class="muted mst-spec" style="font-size:10.5px;margin-top:4px">' + esc(mstSpecLine(m)) + '</div>'
      : '<b>' + esc(m.rfd || '—') + '</b>'
        + '<div class="muted" style="margin-top:2px">' + esc(m.greige || '—') + '</div>'
        + '<div class="muted mst-spec" style="font-size:10.5px;margin-top:3px">' + esc(mstSpecLine(m)) + '</div>';

    var cells = MST_COLS.map(function (c) {
      if (!editing) return '<td class="num">' + mstShow(m, c) + '</td>';
      var v = m[c[0]] == null ? '' : m[c[0]];
      return '<td><input data-mi="' + i + '" data-mf="' + c[0] + '"'
        + (c[2] === 'yarn' ? ' placeholder="40s" style="width:86px"' : ' type="number" step="0.01" style="width:82px"')
        + ' value="' + esc(v) + '"></td>';
    }).join('');

    /* The × only exists while the row is open, so a spec cannot be lost by a misplaced click. */
    var acts = editing
      ? '<button type="button" class="jw-btn jw-primary" data-msave="' + i + '">Save</button> '
        + '<button type="button" class="jw-btn" data-mcancel="' + i + '">Cancel</button> '
        + '<button type="button" class="lm-x" data-mrm="' + i + '" title="Remove this fabric type">&times;</button>'
      : '<button type="button" class="jw-btn" data-medit="' + i + '">Edit</button>';

    return '<tr data-mrow="' + i + '"' + (editing ? ' class="jw-on"' : '') + '>'
      + '<td class="frz" style="text-align:left">' + name + '</td>' + cells
      + '<td class="num mst-tc" style="font-weight:700">' + (mstTC(m) === null ? '<span class="muted">—</span>' : mstTC(m)) + '</td>'
      + '<td class="num mst-loss">' + (mstWidthLoss(m) === null ? '<span class="muted">—</span>' : mstWidthLoss(m) + '%') + '</td>'
      + '<td><button type="button" class="jw-btn' + (m.active === false ? '' : ' jw-primary') + '" data-mst="' + i + '">'
      + (m.active === false ? 'Off' : 'On') + '</button></td>'
      + '<td style="white-space:nowrap">' + acts + '</td></tr>';
  }).join('') || emptyRow(MST_COLS.length + 4, 'No fabric type yet.');

  return '<div class="card">'
    + '<div class="ff-cap">Settled once, then read by every PO, lot and challan — so a row is plain '
    + 'until you open it with <b>Edit</b>. A cloth is written down as <b>warp × weft / EPI × PPI</b>: '
    + '<b>2/40s × 40s / 110 × 76</b> is a two-fold 40s warp, a single 40s weft, 110 ends and 76 picks in '
    + 'an inch. Ends plus picks is the thread count (186 TC). Greige is woven wider than the RFD it becomes, '
    + 'because the bleach pulls the cloth in.</div>'
    + '<div class="ff-grid"><table class="xl xl-dense lm-lines" id="mstTable">' + head + '<tbody>' + body + '</tbody></table></div>'
    + '<div class="row" style="margin-top:12px"><button type="button" id="mstAdd">+ Add a fabric type</button>'
    + '<span class="muted" style="align-self:center;font-size:12px">Typed here once. Every PO, lot and challan reads it.</span></div>'
    + '</div>';
}

/** Only the figures that are worked out move while a row is open -- the cursor stays put. */
function mstSync(i) {
  var m = DB.mst[i];
  var tr = document.querySelector('#mstTable tr[data-mrow="' + i + '"]');
  if (!tr || !m) return;
  var tc = mstTC(m), loss = mstWidthLoss(m), spec = tr.querySelector('.mst-spec');
  tr.querySelector('.mst-tc').innerHTML = tc === null ? '<span class="muted">—</span>' : tc;
  tr.querySelector('.mst-loss').innerHTML = loss === null ? '<span class="muted">—</span>' : loss + '%';
  if (spec) spec.textContent = mstSpecLine(m);
}

/** Open a row. Anything else open is put back first, so two rows are never half-typed at once. */
function mstOpen(i) {
  if (MST_EDIT !== null && MST_EDIT !== i) mstCancel();
  MST_EDIT = i;
  MST_SNAP = JSON.parse(JSON.stringify(DB.mst[i]));
  render();
  var first = document.querySelector('#mstTable tr[data-mrow="' + i + '"] input');
  if (first) { first.focus(); first.select(); }
}
/** Put back exactly what was there. */
function mstCancel() {
  if (MST_EDIT !== null && MST_SNAP) DB.mst[MST_EDIT] = MST_SNAP;
  MST_EDIT = null; MST_SNAP = null;
  lmSaveDb();
}
function mstClose() { MST_EDIT = null; MST_SNAP = null; lmSaveDb(); }

/* ---- wiring: fabric types, mills and vendors, the company ------------------------------------------ */
function wireMasterData() {
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-mstview],[data-vedit],[data-vsave],[data-vcancel],[data-vrm],[data-vact],[data-co],[data-medit],[data-msave],[data-mcancel],[data-mrm],[data-mst]') : null;
    if (!t) return;
    var g = function (k) { return t.getAttribute(k); };
    if (g('data-mstview')) {
      if (MST_EDIT !== null) mstCancel();
      if (VEN_EDIT !== null) venCancel();
      if (CO_EDIT) coCancel();
      UI.mst = g('data-mstview'); render(); return;
    }
    if (g('data-vedit')) { venOpen(parseInt(g('data-vedit'), 10)); return; }
    if (g('data-vcancel')) { venCancel(); render(); return; }
    if (g('data-vsave')) {
      var vi = parseInt(g('data-vsave'), 10), v = DB.ven[vi];
      if (!String(v.name || '').trim()) { lmSay('err', 'A supplier or processor needs a name.'); return; }
      v.gstin = String(v.gstin || '').trim().toUpperCase();
      var gp = gstinProblem(v.gstin); if (gp) { lmSay('err', v.name + ': ' + gp); return; }
      /* NO TWO ROWS FOR ONE PARTY (Ravi, 13 Oct): not the same name, not the same GSTIN. */
      var vn = String(v.name).trim().toLowerCase(), vg = String(v.gstin || '').trim().toUpperCase();
      var twin = DB.ven.filter(function (x, xi) { return xi !== vi && (String(x.name || '').trim().toLowerCase() === vn || (vg && String(x.gstin || '').trim().toUpperCase() === vg)); })[0];
      if (twin) { lmSay('err', (String(twin.name).trim().toLowerCase() === vn ? twin.name + ' is already in Master data.' : 'GSTIN ' + vg + ' is already on ' + twin.name + '.') + ' Edit that row instead.'); return; }
      venClose(); render();
      lmSay('ok', v.name + ' saved — ' + (v.kind || 'vendor').toLowerCase() + '.');
      return;
    }
    if (g('data-vact')) {
      var va = DB.ven[parseInt(g('data-vact'), 10)];
      if (va) { va.active = va.active === false; lmSaveDb(); render(); }
      return;
    }
    if (g('data-vrm')) {
      var vr = parseInt(g('data-vrm'), 10), gone = DB.ven[vr], n = gone ? venUsed(gone.name) : 0;
      if (n) {
        lmSay('warn', gone.name + ' is on ' + n + ' record' + (n > 1 ? 's' : '')
          + ', so the name stays. Switch them off instead.');
        return;
      }
      DB.ven.splice(vr, 1); VEN_EDIT = null; VEN_SNAP = null; lmSaveDb(); render(); return;
    }
    if (g('data-co')) {
      var act = g('data-co');
      if (act === 'edit') { CO_SNAP = JSON.parse(JSON.stringify(DB.co || {})); CO_EDIT = true; render(); }
      if (act === 'cancel') { coCancel(); render(); }
      if (act === 'save') {
        if (!String((DB.co || {}).name || '').trim()) { lmSay('err', 'The company needs a name.'); return; }
        DB.co.gstin = String(DB.co.gstin || '').trim().toUpperCase();
        var cg = gstinProblem(DB.co.gstin); if (cg) { lmSay('err', 'Company GSTIN: ' + cg); return; }
        CO_EDIT = false; CO_SNAP = null; lmSaveDb(); render();
        lmSay('ok', 'Company details saved \u2014 every PO from now on carries them.');
      }
      return;
    }
    if (g('data-medit')) { mstOpen(parseInt(g('data-medit'), 10)); return; }
    if (g('data-mcancel')) { mstCancel(); render(); return; }
    if (g('data-msave')) {
      var si = parseInt(g('data-msave'), 10), r = DB.mst[si];
      /* A fabric type with no name is not one. The rest may be filled in later. */
      if (!String(r.rfd || '').trim() || !String(r.greige || '').trim()) {
        lmSay('err', 'Both names, please — the RFD name cutting asks for, and the greige name the supplier is told.');
        return;
      }
      var rn = String(r.rfd).trim().toLowerCase(), gn = String(r.greige).trim().toLowerCase();
      var dup = DB.mst.filter(function (x, xi) { return xi !== si && (String(x.rfd || '').trim().toLowerCase() === rn || String(x.greige || '').trim().toLowerCase() === gn); })[0];
      if (dup) { lmSay('err', (String(dup.rfd).trim().toLowerCase() === rn ? r.rfd : r.greige) + ' is already a fabric type in Master data. Edit that row instead.'); return; }
      mstClose(); render();
      lmSay('ok', r.rfd + ' saved — bought as ' + r.greige
        + (mstConstruction(r) ? ', ' + mstConstruction(r) : '') + '.');
      return;
    }
    if (g('data-mrm')) {
      var mi = parseInt(g('data-mrm'), 10), gone = DB.mst[mi];
      /* A fabric type still named in the ledger is not removed -- the lots that answer to it would
       * lose the only record of what they are. It is switched off instead. */
      var used = (DB.fab || []).filter(function (r) {
        var n = String(r.fabricType || '').trim().toLowerCase();
        return gone && (n === String(gone.rfd || '').toLowerCase() || n === String(gone.greige || '').toLowerCase());
      }).length;
      if (used) {
        lmSay('warn', (gone.rfd || gone.greige) + ' is on ' + used + ' row'
          + (used > 1 ? 's' : '') + ' of the ledger, so it stays. Switch it off instead.');
        return;
      }
      DB.mst.splice(mi, 1); MST_EDIT = null; MST_SNAP = null; lmSaveDb(); render(); return;
    }
    if (g('data-mst')) {
      var m = DB.mst[parseInt(g('data-mst'), 10)];
      if (m) { m.active = m.active === false; lmSaveDb(); render(); }
      return;
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    if (MST_EDIT !== null) { mstCancel(); render(); }
    if (VEN_EDIT !== null) { venCancel(); render(); }
  });
  /* Masters: a blank row, filled in where it is read. */
  document.addEventListener('click', function (ev) {
    if (ev.target.id !== 'mstAdd') return;
    DB.mst.push({ rfd: '', greige: '', warp: '', weft: '', active: true });
    lmSaveDb(); mstOpen(DB.mst.length - 1);
  });

  document.addEventListener('click', function (ev) {
    if (ev.target.id !== 'venAdd') return;
    DB.ven.push({ name: '', kind: 'Supplier', phone: '', email: '', addr: '', city: '', gstin: '', active: true });
    lmSaveDb(); venOpen(DB.ven.length - 1);
  });
  function venEdit(ev) {
    var el = ev.target, i = el.getAttribute && el.getAttribute('data-vi'), f = el.getAttribute && el.getAttribute('data-vf');
    if (i === null || i === undefined || !f) return;
    var vi = parseInt(i, 10);
    if (VEN_EDIT !== vi) return;
    var v = DB.ven[vi]; if (!v) return;
    v[f] = el.value;
  }
  document.addEventListener('input', venEdit);
  /* The company page: typed straight into DB.co while open; Cancel puts the snapshot back. */
  document.addEventListener('input', function (ev) {
    var f = ev.target.getAttribute && ev.target.getAttribute('data-cf');
    if (!f || !CO_EDIT) return;
    DB.co = DB.co || {}; DB.co[f] = ev.target.value;
  });
  document.addEventListener('change', venEdit);

  /* A cell is typed in: the row is kept, only the worked-out figures move. */
  document.addEventListener('input', mstEdit);
  document.addEventListener('change', mstEdit);
  function mstEdit(ev) {
    var el = ev.target, i = el.getAttribute && el.getAttribute('data-mi'), f = el.getAttribute && el.getAttribute('data-mf');
    if (i === null || i === undefined || !f) return;
    var mi = parseInt(i, 10);
    if (MST_EDIT !== mi) return;
    var m = DB.mst[mi]; if (!m) return;
    m[f] = el.value;
    mstSync(mi);
  }
}

/* ui/entry.js -- The fabric-entry dialog: movements, auto-fill, the before-and-after preview, saving.
 * An ES module. Its imports are worked out from the code by the split script. */
/* A ROW BEING CORRECTED MUST NOT BE WEIGHED AGAINST ITSELF.
 *
 * Every refusal in fabEntryCheck is worked out from the lot's balances, and those balances include
 * the row you are editing. Left in, a 1,200 m receipt being corrected to 1,250 would be told the lot
 * "already has 1,200 m against it" -- by itself. So while the dialog is open on an existing row,
 * that row is left out of every balance. */
var EN_ID = null;     /* the ledger row open for correction, or null for a new one */

/* ---- the entry dialog ----------------------------------------------------------------------- */
var EN_NOTE = {
  RECEIVE_GREIGE: 'Greige in from the supplier. Name the PO and this is what counts as delivered against it.',
  ISSUE_TO_RFD: 'Out to the processing house. It stops being greige stock and does not yet become RFD stock — it is with the processor.',
  RECEIVE_RFD: 'Back from the processor, under the RFD name Masters says it becomes. Less than went out is the process loss.',
  OPENING_RFD: 'RFD that was already on the floor. Its own lot, so it can be issued like any other, and never counted as cloth back from a processor.',
  PURCHASE_RFD: 'RFD bought ready from a vendor rather than processed from our own greige. A lot of its own.',
  ISSUE_TO_CUTTING: 'RFD off the shelf to the cutting table.',
  DAMAGE: 'Cloth that will never reach a cutting table \u2014 a hole, a stain, a bleach burn. It comes '
    + 'off the lot it was in, so the stock figure stays true.',
};
/* =============================================================================================
 * THE ENTRY, MADE TO DO THE TYPING
 *
 * Almost everything on a movement is already known to the register. A lot going out for bleaching
 * is one greige, a known number of metres; a lot coming back is that same cloth under its RFD name,
 * from the processor it went to. Making somebody type it again is how it gets typed wrong.
 *
 * So the form fills what it knows -- but only into boxes nobody has touched. A value the app put in
 * is remembered; it may be replaced when the context changes. A value a person typed is theirs and
 * is never overwritten.
 * ============================================================================================= */
var EN_AUTO = {};
function enFill(id, v) {
  var el = $(id); if (!el || v == null || v === '') return;
  v = String(v);
  if (el.value === '' || el.value === EN_AUTO[id]) { el.value = v; EN_AUTO[id] = v; }
}
function enUnfill(id) {
  var el = $(id);
  if (el && el.value !== '' && el.value === EN_AUTO[id]) el.value = '';
  delete EN_AUTO[id];
}

/* The movements, grouped the way a store-keeper thinks about them: what came through the door, and
 * what left by it. Each wears the colour of the shelf it touches, the same colours as the dashboard
 * ring, so the two read as one system. */
var EN_GROUPS = [
  { name: 'Coming in', kinds: ['RECEIVE_GREIGE', 'RECEIVE_RFD', 'PURCHASE_RFD', 'OPENING_RFD'] },
  { name: 'Going out', kinds: ['ISSUE_TO_CUTTING', 'DAMAGE'] }
];
var EN_DOT = {
  RECEIVE_GREIGE: 'var(--c-greige)', ISSUE_TO_RFD: 'var(--c-proc)', RECEIVE_RFD: 'var(--c-rfd)',
  PURCHASE_RFD: 'var(--c-rfd)', OPENING_RFD: 'var(--c-rfd)', ISSUE_TO_CUTTING: 'var(--muted)', DAMAGE: 'var(--bad)'
};
var EN_SHORT = {
  RECEIVE_GREIGE: 'Greige received', RECEIVE_RFD: 'RFD back', PURCHASE_RFD: 'RFD bought',
  OPENING_RFD: 'RFD opening stock', ISSUE_TO_RFD: 'Send for RFD', ISSUE_TO_CUTTING: 'To cutting',
  DAMAGE: 'Damaged'
};
function enChips() {
  var on = $('enKind').value;
  $('enChips').innerHTML = EN_GROUPS.map(function (grp) {
    return '<div class="en-group"><span class="en-gname">' + esc(grp.name) + '</span>'
      + grp.kinds.map(function (k) {
        return '<button type="button" class="en-chip' + (k === on ? ' on' : '') + '" data-enkind="' + k + '">'
          + '<span class="en-dot" style="background:' + EN_DOT[k] + '"></span>' + esc(EN_SHORT[k]) + '</button>';
      }).join('') + '</div>';
  }).join('');
}

/* THE NEXT LOT NUMBER, so nobody invents one that already exists. */
var EN_OPENS = { RECEIVE_GREIGE: 1, OPENING_RFD: 1, PURCHASE_RFD: 1 };

/** Pick a lot, and what the register knows about it fills the rest. */
function enFromLot() {
  if (EN_ID) return;
  var kind = $('enKind').value, g = fabLot($('enLot').value);
  $('enQty').placeholder = '1200';
  if (!g) return;
  var rfdName = g.rfdFabric || fabRfdOfGreige(g.fabricType) || g.fabricType;
  if (kind === 'ISSUE_TO_RFD') {
    enFill('enFab', g.fabricType);
    /* The whole lot usually goes out together, so that is the guess. */
    if (g.greigeLeft > 0.05) enFill('enQty', r2(g.greigeLeft));
  } else if (kind === 'RECEIVE_RFD') {
    enFill('enFab', fabRfdOfGreige(g.fabricType) || g.fabricType);
    enFill('enParty', g.processor);
    if (g.withProcessor > 0.05) enFill('enQty', r2(g.withProcessor));
  } else if (kind === 'ISSUE_TO_CUTTING') {
    enFill('enFab', rfdName);
    /* Cutting rarely takes a whole lot, so this one is a ceiling, not a guess. */
    $('enQty').placeholder = 'up to ' + nf(g.rfdLeft);
  } else if (kind === 'DAMAGE') {
    var rfdSide = g.rfdLeft > 0.05;
    enFill('enFab', rfdSide ? rfdName : g.fabricType);
    $('enQty').placeholder = 'up to ' + nf(rfdSide ? g.rfdLeft : g.greigeLeft);
  }
  entrySpec();
}

/** Name the PO, and the mill and the cloth come with it. */
function enFromPo() {
  if (EN_ID || $('enKind').value !== 'RECEIVE_GREIGE') return;
  var no = $('enPo').value.trim().toUpperCase();
  var po = (DB.gpo || []).filter(function (p) { return String(p.poNo || '').toUpperCase() === no; })[0];
  if (!po) return;
  enFill('enParty', po.mill);
  var open = gpoProgress(po).lines.filter(function (l) { return l.pending > 0.05; });
  if (open.length === 1) {
    enFill('enFab', open[0].greige);
    $('enQty').placeholder = nf(open[0].pending) + ' still due';
  }
  entrySpec();
}

/* WHAT THIS ENTRY WILL DO, BEFORE IT DOES IT.
 *
 * A ledger entry is a change to a shelf. Showing the shelf before and after turns "fill in the form
 * and hope" into "see what happens and decide" -- and a slip of a nought, 5,000 for 500, is caught
 * by the eye in the after-figure long before anybody reads an error. */
function enAfter() {
  var box = $('enAfter');
  var kind = $('enKind').value, lot = $('enLot').value.trim();
  var qty = parseFloat($('enQty').value) || 0;
  var back = FAB_CAN_RETURN[kind] ? (parseFloat($('enReturned').value) || 0) : 0;
  var kept = qty - back;
  if (!lot || qty <= 0) { box.classList.add('hide'); return; }

  var g = fabLot(lot);
  var go = function (label, a, b) {
    return '<div>' + esc(label) + ': ' + nf(a) + ' m \u2192 <b' + (b < -0.05 ? ' class="bad"' : '') + '>'
      + nf(b) + ' m</b>' + (b < -0.05 ? ' <span class="bad">\u2014 more than there is</span>' : '') + '</div>';
  };
  var lines = [];

  if (kind === 'RECEIVE_GREIGE' || kind === 'OPENING_RFD' || kind === 'PURCHASE_RFD') {
    var what = kind === 'RECEIVE_GREIGE' ? 'greige into the store' : 'RFD onto the shelf';
    if (g && (g.greigeIn > 0 || g.rfdOpen > 0 || g.rfdBuy > 0)) {
      lines.push('<div class="bad">' + esc(lot) + ' already exists \u2014 a new delivery wants a new lot.</div>');
    } else {
      lines.push('<div>Opens <b>' + esc(lot) + '</b> with <b>' + nf(kept) + ' m</b> of ' + what
        + (back > 0 ? ' <span style="opacity:.75">(' + nf(qty) + ' on the challan, ' + nf(back) + ' sent back)</span>' : '')
        + '</div>');
    }
    if (kind === 'RECEIVE_GREIGE') {
      var no = $('enPo').value.trim().toUpperCase();
      var po = (DB.gpo || []).filter(function (p) { return String(p.poNo || '').toUpperCase() === no; })[0];
      var fab = $('enFab').value.trim().toLowerCase();
      var ln = po ? gpoProgress(po).lines.filter(function (l) {
        return String(l.greige || '').toLowerCase() === fab;
      })[0] : null;
      if (ln) lines.push(go(po.poNo + ' still due', ln.pending, ln.pending - kept));
    }
  } else if (!g) {
    lines.push('<div class="bad">There is no lot ' + esc(lot) + ' in the register.</div>');
  } else if (kind === 'ISSUE_TO_RFD') {
    lines.push(go('Greige in the store', g.greigeLeft, g.greigeLeft - qty));
    lines.push(go('At the processor', g.withProcessor, g.withProcessor + qty));
  } else if (kind === 'RECEIVE_RFD') {
    var closing = $('enFinal').checked;
    var stillOut = closing ? 0 : g.withProcessor - kept;
    lines.push(go('At the processor', g.withProcessor, stillOut));
    lines.push(go('RFD on the shelf', g.rfdLeft, g.rfdLeft + kept));
    if (closing && g.toRfd > 0) {
      var lost = g.toRfd - (g.rfdIn + kept);
      if (lost >= -0.05) {
        lines.push('<div>Closes the lot: <b>' + nf(Math.max(0, lost)) + ' m</b> lost in processing ('
          + (Math.round((Math.max(0, lost) / g.toRfd) * 1000) / 10) + '%)</div>');
      }
    }
  } else if (kind === 'ISSUE_TO_CUTTING') {
    lines.push(go('RFD on the shelf', g.rfdLeft, g.rfdLeft - qty));
  } else if (kind === 'DAMAGE') {
    var isGreige = !!fabRfdOfGreige($('enFab').value);
    lines.push(isGreige ? go('Greige in the store', g.greigeLeft, g.greigeLeft - qty)
                        : go('RFD on the shelf', g.rfdLeft, g.rfdLeft - qty));
    lines.push('<div>' + nf(qty) + ' m written off for good.</div>');
  }

  box.innerHTML = '<div class="en-after-h">After this entry</div>' + lines.join('');
  box.classList.remove('hide');
}

function entryOpen(kind, row) {
  /* ONE WAY IN FOR GREIGE: a new receipt comes on a challan, so it is typed in the challan drawer with
   * its pieces. A receipt already in the ledger is still corrected here. */
  if (!row && kind === 'RECEIVE_GREIGE') { entryClose(); openDrawer(''); return; }
  if (!row && kind === 'ISSUE_TO_RFD') { entryClose(); UI.tab = 'po'; render(); lmSay('warn', 'Greige goes to RFD from its PO: press Issue to RFD on the PO.'); return; }
  if (!row && kind === 'RECEIVE_RFD') { entryClose(); UI.tab = 'po'; render(); lmSay('warn', 'RFD comes back on its PO: press Receive RFD on the PO.'); return; }
  if (!canLedgerEdit()) { lmSay('warn', meUser().name + ' may only view the fabric ledger.'); return; }
  EN_AUTO = {};
  EN_ID = row ? row.id : null;
  setFabSkip(EN_ID);
  if (row) kind = row.txnType;
  var sel = $('enKind');
  sel.innerHTML = Object.keys(FAB_SIGN).map(function (k) {
    return '<option value="' + k + '"' + (k === kind ? ' selected' : '') + '>' + esc(FAB_LABEL[k]) + '</option>';
  }).join('');
  $('enDate').value = row ? (row.date || '') : lmToday();
  $('enLot').value = row ? (row.lot || '') : '';
  /* A LOT NUMBER IS GIVEN ONCE AND NEVER CHANGED (Ravi, 13 Oct). */
  $('enLot').readOnly = !!row;
  $('enRemark').value = row ? (row.remark || row.note || '') : '';
  /* An edit shows what the challan said, not what was kept -- the returned box carries the rest. */
  $('enReturned').value = row ? (row.returned || '') : '';
  $('enFab').value = row ? (row.fabricType || '') : '';
  $('enQty').value = row ? (row.gross != null ? row.gross : (row.qty == null ? '' : row.qty)) : '';
  $('enParty').value = row ? (row.party || '') : '';
  $('enBill').value = row ? (row.bill || '') : '';
  $('enPo').value = row ? (row.orderNo || '') : '';
  $('lmEnErr').classList.add('hide');
  $('lmEnTitle').textContent = row ? 'Correct this entry' : 'Fabric entry';
  $('enSave').textContent = row ? 'Save the correction' : 'Save the entry';
  $('enDelete').classList.toggle('hide', !row);
  entrySync(row);
  $('lmEntry').classList.remove('hide');
  /* A new lot gets the next number already written in; the cursor goes to what is left to type. */
  if (!row && EN_OPENS[kind]) $('enFab').focus();
  else (row ? $('enQty') : $('enLot')).focus();
}
/** Shut the dialog and put the register back the way the rest of the app reads it. */
function entryClose() {
  $('lmEntry').classList.add('hide');
  EN_ID = null; setFabSkip(null);
}
/* THE CHALLAN ON A LEDGER ROW, BY ITS RULES (Ravi, 13 Oct): our RFD challan is in the series and never typed; the
 * processor's challan on RFD received and the supplier's on greige received are required. */
var EN_BILL = {
  ISSUE_TO_RFD: ['Our RFD challan no.', 'auto'], RECEIVE_RFD: ['Processor’s challan no. *', 'req'],
  RECEIVE_GREIGE: ['Supplier challan no. *', 'req'], PURCHASE_RFD: ['Supplier challan / bill no. *', 'req']
};
function enBillRule(kind, row) {
  var rule = EN_BILL[kind] || ['Bill / challan', ''];
  $('enBillL').textContent = rule[0];
  $('enBill').readOnly = rule[1] === 'auto';
  if (rule[1] === 'auto') $('enBill').value = (row && row.bill) || rfdChNewNo();
  $('enBill').placeholder = rule[1] === 'req' ? 'As printed on their challan' : rule[1] === 'auto' ? '' : 'Optional';
}
function entrySync(row) {
  var kind = $('enKind').value;
  enChips();
  enBillRule(kind, EN_ID ? (DB.fab || []).filter(function (x) { return x.id === EN_ID; })[0] : null);
  $('enQty').placeholder = '1200';
  if (!EN_ID) {
    /* What the app filled for the last movement does not belong to this one. What a person typed
     * stays where they put it. */
    ['enFab', 'enQty', 'enParty'].forEach(enUnfill);
    if (EN_OPENS[kind]) enFill('enLot', fabNextLot()); else enUnfill('enLot');
    $('enLot').readOnly = !!EN_OPENS[kind];
  }
  $('lmEnNote').textContent = EN_NOTE[kind] || '';
  $('enPoWrap').style.display = kind === 'RECEIVE_GREIGE' ? '' : 'none';
  /* The one question only the person holding the challan can answer. */
  $('enFinalWrap').style.display = kind === 'RECEIVE_RFD' ? '' : 'none';
  /* The remark is always there; only a write-off insists on it. */
  $('enRemarkL').textContent = kind === 'DAMAGE' ? 'What is wrong with it' : 'Remark (optional)';
  $('enRemark').placeholder = kind === 'DAMAGE'
    ? 'Oil stain, hole, bleach burn\u2026' : 'Anything worth remembering about this entry';
  $('enReturnedWrap').style.display = FAB_CAN_RETURN[kind] ? '' : 'none';
  if (kind === 'RECEIVE_RFD') $('enFinal').checked = row ? (row.final !== false) : true;
  $('enPartyL').textContent = kind === 'RECEIVE_GREIGE' || kind === 'PURCHASE_RFD' ? 'Supplier *'
    : (kind === 'ISSUE_TO_RFD' || kind === 'RECEIVE_RFD') ? 'RFD processor *' : 'Party';

  /* THE PICKERS ARE FILTERED BY WHAT THE ENTRY NEEDS. You send greige, you receive what is out at a
   * processor, you issue RFD -- a list of every lot ever opened is a list nobody reads. */
  var lots = FAB_KIND_WANT[kind] ? fabLotsFor(kind) : [];
  $('enLots').innerHTML = lots.map(function (g) {
    var want = FAB_KIND_WANT[kind];
    var left = want === 'greige' ? g.greigeLeft
      : want === 'out' ? g.withProcessor
      : want === 'any' ? (g.greigeLeft + g.rfdLeft) : g.rfdLeft;
    return '<option value="' + esc(g.lot) + '">' + esc(g.fabricType) + ' · ' + nf(left) + ' m left</option>';
  }).join('');

  /* The fabric list is in the name the cloth answers to at this point in its life. */
  var names = kind === 'RECEIVE_GREIGE' || kind === 'ISSUE_TO_RFD'
    ? gpoFabrics().map(function (m) { return m.greige; })
    : kind === 'DAMAGE'
      ? (DB.mst || []).map(function (m) { return m.rfd; })
        .concat(gpoFabrics().map(function (m) { return m.greige; }))
      : (DB.mst || []).map(function (m) { return m.rfd; });
  $('enFabs').innerHTML = uniq(names).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  /* Mills when cloth is coming in, processing houses when it is going out to be bleached. */
  var people = kind === 'RECEIVE_GREIGE' || kind === 'PURCHASE_RFD' ? gpoMills()
    : (kind === 'ISSUE_TO_RFD' || kind === 'RECEIVE_RFD') ? lmProcessors() : [];
  $('enParties').innerHTML = people.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  $('enPos').innerHTML = (DB.gpo || []).filter(function (po) {
    return ['open', 'sent', 'part'].indexOf(gpoStatus(po)) >= 0;
  }).map(function (po) {
    return '<option value="' + esc(po.poNo) + '">' + esc(po.mill) + ' · ' + nf(gpoProgress(po).pending) + ' m pending</option>';
  }).join('');

  var why = '';
  if (kind === 'RECEIVE_RFD') {
    why = 'The lot keeps its greige name until this entry; saving it renames the lot to the RFD fabric Masters pairs with that greige.';
  } else if (kind === 'ISSUE_TO_RFD') {
    why = 'Name the cloth as it is now — the greige name. It comes back under the RFD one.';
    why += ' Tick "close the lot" when this challan is the whole of it — what did not come back is '
      + 'then the process loss, not cloth still sitting there. Leave it clear for a part delivery.';
  } else if (kind === 'RECEIVE_GREIGE') {
    why = 'One receipt per lot. A second one into the same lot is how a bale gets counted twice.';
  }
  var pr = EN_ID ? (DB.fab || []).filter(function (x) { return x.id === EN_ID; })[0] : null;
  var hasPcs = !!(pr && pr.pieces && pr.pieces.length);
  $('enQty').readOnly = hasPcs;
  if (hasPcs) why = 'This receipt came on challan ' + (pr.bill || '') + ' with ' + pr.pieces.length + ' pieces, so its metres are the sum of the pieces. '
    + 'To change them, remove this entry and receive the challan again.';
  $('lmEnWhy').textContent = why;
  enFromLot();
  enFromPo();
  entrySpec();
  enAfter();
}
/** The spec of whatever cloth has been named, so a wrong name is obvious before it is saved. */
function entrySpec() {
  var m = mstOf($('enFab').value), box = $('enSpec');
  if (!m) { box.textContent = ''; box.classList.add('hide'); return; }
  box.classList.remove('hide');
  box.innerHTML = '<b>' + esc(m.rfd) + '</b> is woven as <b>' + esc(m.greige) + '</b>'
    + (m.greigeWidth && m.rfdWidth ? ' · ' + esc(m.greigeWidth) + '" on the loom, ' + esc(m.rfdWidth) + '" after processing' : '')
    + (mstConstruction(m) ? ' · ' + esc(mstConstruction(m)) : '')
    + (mstTC(m) ? ' · ' + mstTC(m) + ' TC' : '');
}
function entrySave() {
  var kind = $('enKind').value;
  var e = {
    txnType: kind, date: $('enDate').value, lot: $('enLot').value.trim(),
    fabric: $('enFab').value.trim(), qty: $('enQty').value, party: $('enParty').value.trim(),
    bill: $('enBill').value.trim(), poNo: kind === 'RECEIVE_GREIGE' ? $('enPo').value.trim() : '',
    remark: $('enRemark').value.trim(),
    returned: FAB_CAN_RETURN[kind] ? $('enReturned').value : '',
  };
  var err = fabEntryCheck(e);
  var br = (EN_BILL[kind] || [])[1];
  if (!err && br === 'req' && !e.bill) err = (EN_BILL[kind][0].replace(' *', '')) + ' is required.';
  if (!err && br === 'auto') {
    if (!e.bill) { e.bill = rfdChNewNo(); }
    var twin = (DB.fab || []).filter(function (x) { return x.id !== EN_ID && x.txnType === 'ISSUE_TO_RFD' && String(x.bill || '').toUpperCase() === e.bill.toUpperCase() && x.lot !== e.lot; })[0];
    if (twin && (twin.party !== e.party || twin.date !== e.date)) err = 'RFD challan ' + e.bill + ' already belongs to ' + twin.lot + ' to ' + twin.party + ' on ' + fmtD(twin.date) + '.';
  }
  if (err) { $('lmEnErr').textContent = err; $('lmEnErr').classList.remove('hide'); return; }

  /* GREIGE COMES BACK AS THE RFD FABRIC IT WAS BOUGHT FOR. */
  var fabric = e.fabric;
  if (kind === 'RECEIVE_RFD') {
    var g = fabLot(e.lot);
    var becomes = g ? fabRfdOfGreige(g.fabricType) : '';
    if (becomes) fabric = becomes;
  }
  var prev = EN_ID ? (DB.fab || []).filter(function (x) { return x.id === EN_ID; })[0] : null;
  var row = { id: EN_ID || uid(), date: e.date, lot: e.lot, fabricType: fabric, txnType: kind,
    qty: parseFloat(e.qty) || 0, party: e.party, bill: e.bill, orderNo: e.poNo,
    done: prev ? !!prev.done : false };
  /* A RECEIPT THAT CAME ON A CHALLAN KEEPS IT: the paper, the truck and the pieces ride on the row. */
  if (prev) ['chId', 'vehicle', 'lr', 'pieces'].forEach(function (k) { if (prev[k] != null) row[k] = prev[k]; });
  if (kind === 'RECEIVE_RFD') row.final = !!$('enFinal').checked;
  /* WHAT STAYED IS WHAT THE LEDGER COUNTS. The challan figure and what went back are kept on the
   * row so the mill can be answered later, but the stock only ever sees the difference. */
  var back = parseFloat(e.returned) || 0;
  if (back > 0) {
    row.gross = parseFloat(e.qty) || 0;
    row.returned = back;
    row.qty = row.gross - back;
  }
  if (e.remark) row.remark = e.remark;
  if (kind === 'DAMAGE') {
    row.note = e.remark;
    /* The cloth was one thing or the other when it was spoilt, and the name says which. */
    row.state = fabRfdOfGreige(e.fabric) ? 'GREIGE' : 'RFD';
  }

  var correcting = EN_ID, was = null;
  if (correcting) {
    /* THE ROW KEEPS ITS PLACE AND ITS ID. Taking it out and adding a new one would move it to the
     * bottom of the register and break the PO it was received against. */
    var at = DB.fab.map(function (x) { return x.id; }).indexOf(EN_ID);
    if (at >= 0) { was = DB.fab[at]; DB.fab[at] = row; } else DB.fab.push(row);
  } else {
    DB.fab.push(row);
  }
  lmSaveDb();
  entryClose();
  lmSay('ok', correcting
    ? 'Lot ' + e.lot + ' corrected — ' + FAB_LABEL[kind] + ', '
      + (was && fabQty(was) !== row.qty ? nf(fabQty(was)) + ' m → ' + nf(row.qty) + ' m' : nf(row.qty) + ' m') + '.'
    : FAB_LABEL[kind] + ' · lot ' + e.lot + ' · ' + nf(e.qty) + ' m written to the register.');
  render();
}

/* ---- wiring: the fabric-entry dialog --------------------------------------------------------------- */
function wireEntry() {
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-act],[data-enkind],[data-close]') : null;
    if (!t) return;
    var g = function (k) { return t.getAttribute(k); };
    if (g('data-close')) { if (g('data-close') === 'lmEntry') entryClose(); return; }
    if (g('data-act')) { if (g('data-act') !== 'po') entryOpen(g('data-act')); return; }
    if (g('data-enkind')) {
      if (!EN_ID && g('data-enkind') === 'RECEIVE_GREIGE') { entryClose(); openDrawer(''); return; }
      var ks = $('enKind'); ks.value = g('data-enkind');
      ks.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
  });
  document.addEventListener('click', function (ev) {
    if (ev.target.classList && ev.target.classList.contains('modal') && ev.target.id === 'lmEntry') entryClose();
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') entryClose(); });
  /* Removing a movement: only from inside the dialog, only on an existing row, and only once it
   * has been said out loud what goes. */
  $('enDelete').addEventListener('click', function () {
    if (!EN_ID) return;
    var r = (DB.fab || []).filter(function (x) { return x.id === EN_ID; })[0];
    if (!r) return;
    /* Every figure in the app is worked out from these rows, so the button says what goes first. */
    if (!armed(this, 'Press again to remove ' + nf(fabQty(r)) + ' m from lot ' + r.lot)) return;
    DB.fab = DB.fab.filter(function (x) { return x.id !== EN_ID; });
    lmSaveDb(); entryClose(); render();
    lmSay('ok', (FAB_LABEL[r.txnType] || r.txnType) + ' of ' + nf(fabQty(r)) + ' m taken off lot ' + r.lot + '.');
  });

  $('enKind').addEventListener('change', entrySync);
  /* The preview follows every keystroke; the auto-fill follows the lot and the PO. */
  ['enLot', 'enPo'].forEach(function (id) {
    ['input', 'change'].forEach(function (ev) {
      $(id).addEventListener(ev, function () {
        if (id === 'enLot') enFromLot(); else enFromPo();
        enAfter();
      });
    });
  });
  ['enQty', 'enReturned', 'enFab'].forEach(function (id) {
    $(id).addEventListener('input', enAfter);
  });
  $('enFinal').addEventListener('change', enAfter);
  $('enFab').addEventListener('input', entrySpec);
  $('enFab').addEventListener('change', entrySpec);
  $('enSave').addEventListener('click', entrySave);
}

function wireUsersRfd() {
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-issall],[data-issbale],[data-rradd],[data-rrrm],[data-rrfin],[data-rr],[data-appr],[data-urm],#userAdd,#rrSave,[data-cut],[data-cutall],[data-cutthan],#cutSave') : null;
    if (!t) return;
    var g = function (k) { return t.getAttribute(k); };
    if (g('data-issall') && ISS) { var lot = g('data-issall'), bs = lotBales(lot), all = bs.every(function (b) { return ISS.pick[lot][b.than]; }); ISS.pick[lot] = {}; if (!all) bs.forEach(function (b) { ISS.pick[lot][b.than] = true; }); issDraw(); return; }
    if (g('data-issbale') && ISS) { var p = g('data-issbale').split('|'); ISS.pick[p[0]][p[1]] = t.checked; issDraw(); return; }
    if (g('data-rradd') && RR) { var l = g('data-rradd'), ps = RR.thans[l], last = ps.length ? String(ps[ps.length - 1].than).trim() : ''; ps.push({ than: /^\d+$/.test(last) ? String(+last + 1) : '', m: '' }); rrDraw(); var f = $('rm-' + l + '-' + (ps.length - 1)); if (f) f.focus(); return; }
    if (g('data-rrrm') && RR) { var q = g('data-rrrm').split('|'), arr = RR.thans[q[0]]; arr.splice(+q[1], 1); if (!arr.length) arr.push({ than: '', m: '' }); rrDraw(); return; }
    if (g('data-rrfin') && RR) { RR.fin[g('data-rrfin')] = t.checked; rrSums(); return; }
    if (t.id === 'rrSave') { rrSave(); return; }
    if (g('data-cut')) { cutOpen(g('data-cut')); return; }
    if (g('data-cutall') && CUT) { var ts = lotThans(CUT.lot), every = ts.every(function (x) { return CUT.pick[x.than]; }); CUT.pick = {}; if (!every) ts.forEach(function (x) { CUT.pick[x.than] = true; }); cutDraw(); return; }
    if (g('data-cutthan') && CUT) { CUT.pick[g('data-cutthan')] = t.checked; cutDraw(); return; }
    if (t.id === 'cutSave') { cutSave(); return; }
    if (g('data-rr')) { var z = g('data-rr').split('|'); rrOpen(z[0], z[1] || ''); return; }
    if (g('data-appr')) { var y = g('data-appr').split('|'); rrDecide(y[0], y[1] === 'ok', t); return; }
    if (g('data-urm') && isAdmin()) { var gone = DB.users.splice(+g('data-urm'), 1)[0]; if (!usersSafe()) { DB.users.splice(+g('data-urm'), 0, gone); lmSay('err', 'At least one Admin who edits the ledger and approves must stay.'); return; } lmSaveDb(); render(); return; }
    if (t.id === 'userAdd' && isAdmin()) { DB.users.push({ id: uid(), name: 'New user', role: 'Store', ledger: 'view', approve: false, active: true }); lmSaveDb(); render(); return; }
  });
  function userEdit(ev) {
    var el = ev.target, i = el.getAttribute && el.getAttribute('data-ui'); if (i === null || i === undefined || !isAdmin()) return;
    var x = DB.users[+i], f = el.getAttribute('data-uf'), was = x[f];
    x[f] = f === 'approve' ? el.checked : el.value;
    if (!usersSafe()) { x[f] = was; lmSay('err', 'At least one Admin who edits the ledger and approves must stay.'); render(); return; }
    lmSaveDb(); if (ev.type === 'change') { meFill(); if (f !== 'name') render(); }
  }
  document.addEventListener('input', userEdit);
  document.addEventListener('change', userEdit);
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (CUT && el.getAttribute && el.getAttribute('data-cutqty')) { CUT.qty = el.value; $('cutTot').innerHTML = 'Going to cutting: <b>' + m1(parseFloat(el.value) || 0) + ' m</b>'; return; }
    var lot = el.getAttribute && el.getAttribute('data-rrlot'); if (!lot || !RR) return;
    RR.thans[lot][+el.getAttribute('data-pi')][el.getAttribute('data-f')] = el.value; rrSums();
  });
  $('rrLots').addEventListener('keydown', function (ev) {
    var el = ev.target, lot = el.getAttribute('data-rrlot');
    if (ev.key !== 'Enter' || !lot || el.getAttribute('data-f') !== 'm') return;
    ev.preventDefault(); var pi = +el.getAttribute('data-pi');
    if (pi === RR.thans[lot].length - 1) { var b = document.querySelector('[data-rradd="' + lot + '"]'); if (b) b.click(); } else { var nx = $('rm-' + lot + '-' + (pi + 1)); if (nx) nx.focus(); }
  });
  $('meSel').addEventListener('change', function () { DB.me = this.value; lmSaveDb(); render(); lmSay('ok', 'Working as ' + meUser().name + ' · fabric ledger: ' + LEDGER_LABEL[meUser().ledger].toLowerCase() + (meUser().approve ? ' · may approve shrinkage' : '') + '.'); });
}

/* ui/boot.js -- Start-up: load the register, draw the first screen, and let each screen wire its own controls. */

/* EACH SCREEN WIRES ITS OWN CONTROLS. This used to be one click handler with twenty-six branches,
 * which meant every screen reached into every other screen's state. Now each file answers only for
 * its own buttons, and the state it owns is changed only by that file. */
function lmBoot() {
  lmLoad();
  try { var t0 = localStorage.getItem(LM_KEY + '-tab'); if (t0 && LM_TITLE[t0]) UI.tab = t0; } catch (e) { /* opens on the POs */ }
  render();
  wireShell();
  wirePurchaseOrders();
  wireInventory();
  wireLedger();
  wireMasterData();
  wireEntry();
  wireUsersRfd();
}
/* Started at once when the page is already parsed, as it is when this script sits at its foot. */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lmBoot); else lmBoot();
