/* One-time wiring of the Greige Desk into the app (menu, pane, navigation, rights, the flow's RFD count).
 *   node tools/greige-desk/wire-app.js */
const fs = require('fs'), path = require('path');
const S = path.join(__dirname, '..', '..', 'src');
const P = f => path.join(S, f);
const edit = (f, pairs) => {
  let s = fs.readFileSync(P(f), 'utf8'); const NL = String.fromCharCode(10), CRNL = String.fromCharCode(13, 10), crlf = s.includes(CRNL);
  pairs.forEach(([a, b]) => { if (crlf) { a = a.split(NL).join(CRNL); b = b.split(NL).join(CRNL); } const n = s.split(a).length - 1; if (n !== 1) throw new Error(f + ': anchor x' + n + ': ' + a.slice(0, 80)); s = s.replace(a, b); });
  fs.writeFileSync(P(f), s);
};
/* the file order: after the flow screen it reads from */
edit('app/ORDER', [['flow/flow-view.js\n', 'flow/flow-view.js\nflow/greige-desk.js\n']]);
/* the four rights */
edit('app/core/setup.js', [["  'flppc', 'fldem', 'flacc', 'flchl', 'flcut', 'flraw', 'flwip'];",
  "  'flppc', 'fldem', 'flacc', 'flchl', 'flcut', 'flraw', 'flwip',\n  /* Greige Desk (test, 2026-10-13): open it, see the fabric ledger, add to / correct it, approve shrinkage over 5%. */\n  'gdesk', 'gdled', 'gdledit', 'gdappr'];"]]);
/* the menu link under Materials, and the screen */
edit('index.html', [
  ['data-tabs="so,ord,pcut,pbase,ppress,qc,fgi,fba,fab,acc,', 'data-tabs="so,ord,pcut,pbase,ppress,qc,fgi,fba,fab,acc,gdesk,'],
  ['      </div>\n      <div class="mg-col">\n        <div class="mg-h">Setup</div>',
    '        <a id="tabGdesk" class="nav" href="#gdesk" style="display:none"><span class="nav-ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18"/><path d="M7 4v16"/></svg></span><span class="nav-t">Greige Desk</span><span class="nav-bd"><span class="navbadge" style="background:#7c3aed" data-what="test">TEST</span></span></a>\n'
    + '      </div>\n      <div class="mg-col">\n        <div class="mg-h">Setup</div>'],
  ['    <div id="paneFlow" class="hide">', '    <!-- GREIGE DESK (test): its own screen, sealed in a shadow root (flow/greige-desk.js). -->\n    <div id="paneGdesk" class="hide"></div>\n\n    <div id="paneFlow" class="hide">'],
]);
/* navigation */
edit('app/core/nav.js', [
  ["  shop: 'tabShop', adj: 'tabAdj' };\n", "  shop: 'tabShop', adj: 'tabAdj', gdesk: 'tabGdesk' };\n"],
  ["      && !(which === 'flow' && FLOW_ON && flowBucketsAllowed().length)) which =",
    "      && !(which === 'flow' && FLOW_ON && flowBucketsAllowed().length)\n      && !(which === 'gdesk' && FLOW_ON && gdAllowed())) which ="],
  ["adj: 'paneAdj', flow: 'paneFlow' };\n  const navs", "adj: 'paneAdj', flow: 'paneFlow', gdesk: 'paneGdesk' };\n  const navs"],
  ["adj: 'tabAdj', flow: 'tabFlow' };\n  /* Before anything is shown", "adj: 'tabAdj', flow: 'tabFlow', gdesk: 'tabGdesk' };\n  /* Before anything is shown"],
  ["flow: 'Production flow (test)' };", "flow: 'Production flow (test)', gdesk: 'Greige Desk (test)' };"],
  ["  if (which === 'flow') ensureFlow();", "  if (which === 'flow') ensureFlow();\n  if (which === 'gdesk' && FLOW_ON) GD.open();"],
  ["$('tabFlow').onclick = () => showTab('flow');", "$('tabFlow').onclick = () => showTab('flow');\n$('tabGdesk').onclick = e => { e.preventDefault(); showTab('gdesk'); };"],
]);
/* the flow: the menu link, the desk's RFD in Demand's count, a way across from Demand → RFD */
edit('app/flow/flow-view.js', [
  ["function flowNavShow() { if ($('tabFlow')) $('tabFlow').style.display = FLOW_ON && flowScreenAllowed().length ? '' : 'none';",
    "/* The Greige Desk (test) is for anyone holding one of its rights, on the test link only. */\nfunction gdAllowed() { return ['gdesk', 'gdled', 'gdledit', 'gdappr'].some(k => ME.admin || !(ME.tabs && ME.tabs.length) || ME.tabs.includes(k)); }\n"
    + "function flowNavShow() { if ($('tabGdesk')) $('tabGdesk').style.display = FLOW_ON && gdAllowed() ? '' : 'none'; if ($('tabFlow')) $('tabFlow').style.display = FLOW_ON && flowScreenAllowed().length ? '' : 'none';"],
  ["    (typeof ensureAcc === 'function' ? ensureAcc().catch(() => {}) : null)]);",
    "    (typeof ensureAcc === 'function' ? ensureAcc().catch(() => {}) : null),\n    /* The Greige Desk's RFD counts in Demand → RFD on the test link. */\n    (FLOW_ON && typeof GD !== 'undefined' && gdAllowed() ? GD.ensure().catch(() => {}) : null)]);"],
  ["  $('flPanel').innerHTML = FLOW.panel; $('flPanel').classList.toggle('hide', !FLOW.panel);",
    "  /* RFD short? The Greige Desk shows the greige to order for it (Ravi, 13 Oct: Greige Desk joined to the PPC flow). */\n"
    + "  if (FLOW_VIEW === 'drfd' && typeof GD !== 'undefined' && gdAllowed()) FLOW.panel = (FLOW.panel || '') + '<button type=\"button\" class=\"ghost\" data-gdgo=\"ppc\" style=\"width:auto;padding:5px 14px;font-size:13px;margin-left:10px\">Greige Desk · greige for PPC</button>';\n"
    + "  $('flPanel').innerHTML = FLOW.panel; $('flPanel').classList.toggle('hide', !FLOW.panel);"],
  ["$('flPanel').addEventListener('click', e => { const dm = e.target.closest('[data-fldem]');",
    "$('flPanel').addEventListener('click', e => { const gg = e.target.closest('[data-gdgo]'); if (gg) { showTab('gdesk'); GD.open(gg.dataset.gdgo); return; } const dm = e.target.closest('[data-fldem]');"],
]);
edit('app/flow/flow-demand.js', [
  ["function flowRfdStock(name) { try { return Math.max(0, +fabStockOf(name, 'RFD') || 0); } catch (e) { return 0; } }",
    "function flowRfdStock(name) {\n  /* On the test link the Greige Desk's RFD on the shelf counts too (its own test records, flow/greige-desk.js). */\n"
    + "  let desk = 0; try { desk = FLOW_ON && typeof GD !== 'undefined' ? +GD.rfdShelf(name) || 0 : 0; } catch (e) { desk = 0; }\n"
    + "  try { return Math.max(0, +fabStockOf(name, 'RFD') || 0) + desk; } catch (e) { return desk; }\n}"],
]);
console.log('wired');
