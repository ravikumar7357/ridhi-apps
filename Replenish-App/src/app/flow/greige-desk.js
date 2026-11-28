/* ================= GREIGE DESK (2026-10-13; real working since 15 Oct) — built by tools/greige-desk/make-app.js, do not edit by hand =================
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
  var GD_CSS = "[hidden]{display:none!important} img{max-width:100%} \n/* Layout: the Replenish app's own frame -- a bar of screens across the top, soft cards on a tinted\n   ground -- with the greige work at its centre: each PO opens into its challans, each challan into its\n   bales, and receiving is a drawer from the right, opened from the PO itself. */\n:host{display:block;\n  --bg:#F3F5F8; --card:#ffffff; --soft:#F7F9FB; --chip:#EFF2F6; --hover:#EFF2F6; --zebra:#FBFCFE; --line:#E8EDF3;\n  --ink:#14181F; --muted:#5A6472; --faint:#98A1AE;\n  --brand:#4A6A92; --brand-bg:#E9EFF6; --brand-ink:#3A5573; --on-brand:#ffffff;\n  --accent:#4A5A3C; --accent-bg:#EDF0E7; --ok-ink:#2F6B33;\n  --bad:#9B1C1C; --bad-bg:#FBE9E9; --bad-line:#EBB9B9;\n  --warn-ink:#8A5A12; --warn-bg:#FFF3D6; --proc-ink:#7F6000;\n  --pink:#9B3F86; --pink-bg:#F7E8F3;\n  --c-greige:#9A6410; --c-proc:#2F6DB5; --c-rfd:#3F7D3A; --wa:#128C3E;\n  --scrim:rgba(15,23,42,.45); --toast-bg:#14181F; --toast-fg:#ffffff;\n  --sh-1:0 2px 10px rgba(20,24,31,.05); --sh-2:0 4px 16px rgba(20,24,31,.09); --sh-3:0 24px 64px rgba(20,24,31,.22);\n  --ring:0 0 0 3px rgba(110,144,181,.32); --ring-line:#6E90B5;\n  --r-card:18px; --r-ctl:12px; --r-sm:10px; --r-pill:999px; --ctl:40px;\n  --sans:\"Plus Jakarta Sans\",ui-sans-serif,system-ui,-apple-system,\"Segoe UI\",sans-serif;\n  --serif:\"Libre Caslon Text\",\"Iowan Old Style\",Baskerville,\"Times New Roman\",serif;\n  --mono:ui-monospace,\"Cascadia Mono\",Consolas,\"Courier New\",monospace;\n}\n\n\n\n*{box-sizing:border-box}\n.gdroot{background:var(--bg);color:var(--ink);font:14px/1.45 var(--sans);-webkit-font-smoothing:antialiased;border-radius:18px}\n.pill,.tnum,.metric .v,.dfig,.gk-v,.num,.prog,.pc-m,.pc input,.pr input{font-variant-numeric:tabular-nums}\nh1,h2{letter-spacing:-.02em;text-wrap:balance}\n.muted{color:var(--muted)} .b{font-weight:700} .sub{font-size:12px;color:var(--muted)} .grow{flex:1}\n.mono{font-family:var(--mono);font-size:12.5px} .hide{display:none!important}\n.sel{user-select:text}\n\n/* ---- the frame ---- */\n.shell{display:flex;flex-direction:column;min-height:100%}\n.side{position:static;border-radius:18px 18px 0 0;display:flex;align-items:center;gap:2px;flex-wrap:wrap;\n  background:var(--card);box-shadow:var(--sh-1);padding:8px 16px}\n.brand{padding:0 14px 0 2px}\n.brandname{font-family:var(--serif);font-size:16px;letter-spacing:.06em;text-transform:uppercase;display:flex;flex-direction:column;line-height:1}\n.brandsub{font-family:var(--sans);font-size:7.5px;font-weight:600;letter-spacing:.22em;color:var(--muted);margin-top:3px}\n.navgrp{background:transparent;color:var(--muted);box-shadow:none;border:0;font:inherit;font-size:13px;font-weight:600;padding:8px 12px;border-radius:var(--r-sm);cursor:pointer}\n.navgrp:hover{color:var(--ink);background:var(--hover)}\n.navgrp.here{color:var(--brand);background:var(--brand-bg);font-weight:800}\n.sidefoot{margin-left:auto;display:flex;align-items:center;gap:8px}\n.lm-tag{display:inline-block;padding:2px 9px;border-radius:var(--r-pill);background:var(--warn-bg);color:var(--warn-ink);font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}\n.main{flex:1;min-width:0;width:100%;max-width:1560px;margin:0 auto;padding-inline:22px;padding-block:18px 48px}\n@media (max-width:640px){.main{padding-inline:16px}.side{padding:8px 12px;position:static}.brandsub{display:none}.frow select{flex:1 1 100%}}\n.topbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:0 0 14px}\n.lm-h{font-family:var(--serif);font-weight:400;font-size:25px;margin:0}\n.topacts{margin-left:auto;display:flex;gap:8px;min-width:0;flex:0 1 480px;align-items:center}.toppick:empty{display:none}.histday-end td{border-bottom:2px solid var(--line)}.toppick{flex:0 0 auto}.toppick select{width:auto;min-width:150px;max-width:240px;height:var(--ctl)}\n.topacts input{width:100%}\n\n/* ---- controls ---- */\nlabel{display:block;font-size:12.5px;font-weight:600;color:var(--muted);margin-bottom:5px}\ninput,select,textarea{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--line);border-radius:var(--r-ctl);padding:9px 12px;width:100%;min-width:0}\ninput:focus,select:focus,textarea:focus{outline:none;border-color:var(--ring-line);box-shadow:var(--ring)}\ninput[readonly]{background:var(--soft);color:var(--muted)}\ninput::placeholder,textarea::placeholder{color:var(--faint)}\nbutton{font:inherit;font-weight:700;cursor:pointer;border:0;border-radius:var(--r-ctl);padding:10px 18px;background:var(--brand);color:var(--on-brand);\n  box-shadow:0 4px 12px rgba(74,106,146,.25);transition:background .12s,box-shadow .12s,transform .06s;white-space:nowrap}\nbutton:hover{background:var(--brand-ink)}\nbutton:active{transform:translateY(1px);box-shadow:none}\nbutton:focus-visible,a:focus-visible{outline:none;box-shadow:var(--ring)}\nbutton.ghost{background:var(--card);color:var(--muted);font-weight:600;box-shadow:var(--sh-1)}\nbutton.ghost:hover{color:var(--ink);box-shadow:var(--sh-2)}\nbutton.armed,button.ghost.armed{background:var(--bad);color:#fff}\n.btnlink{display:inline-flex;align-items:center;padding:10px 18px;border-radius:var(--r-ctl);background:var(--card);color:var(--brand-ink);font-weight:700;text-decoration:none;box-shadow:var(--sh-1)}\n.btnlink:hover{box-shadow:var(--sh-2)}\n.btnlink{gap:7px}\n.btnlink.wa,.jw-btn.wa{color:var(--wa)}\n.jw-btn.ico{width:32px;padding:0;display:inline-grid;place-items:center}\na.jw-btn{text-decoration:none}\n.frozen{padding:8px 11px;border-radius:var(--r-ctl);background:var(--soft);color:var(--ink);font-size:12.5px;min-width:200px}\n@media print{body *{visibility:hidden}#docPaper,#docPaper *{visibility:visible}#docPaper{position:absolute;left:0;top:0;box-shadow:none;margin:0;padding:0}}\n.jw-btn{height:32px;padding:0 13px;font-size:12.5px;border-radius:var(--r-sm);background:var(--chip);color:var(--muted);font-weight:700;box-shadow:none}\n.jw-btn:hover{background:var(--line);color:var(--ink)}\n.jw-btn.jw-primary{background:var(--brand-bg);color:var(--brand-ink)}\n.jw-btn.jw-wa{background:var(--accent-bg);color:var(--accent)}\n.row{display:flex;gap:10px;flex-wrap:wrap}\n.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n.seg{display:inline-flex;background:var(--chip);border-radius:var(--r-sm);padding:3px;gap:2px}\n.segbtn{background:transparent;color:var(--muted);box-shadow:none;border-radius:8px;padding:6px 14px;font-size:12.5px;font-weight:600}\n.segbtn:hover{background:transparent;color:var(--ink)}\n.segbtn.on{background:var(--card);color:var(--ink);box-shadow:var(--sh-1)}\n.segbtn .n{color:var(--faint);font-weight:500;margin-left:3px}\n\n/* ---- cards, figures, tables ---- */\n.card{background:var(--card);border-radius:var(--r-card);padding:16px 18px;margin-bottom:14px;box-shadow:var(--sh-1);min-width:0}\n.kpis{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:10px}\n.kpi{flex:1 1 300px;background:var(--card);border-radius:var(--r-card);padding:13px 16px;box-shadow:var(--sh-1)}\n.kpihead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px;flex-wrap:wrap}\n.kpiname{font-size:13px;font-weight:700} .kpiwhen{font-size:11px;color:var(--muted)}\n.metrics{display:flex;gap:24px;flex-wrap:wrap;justify-content:space-between}\n.metric .v{font-size:19px;font-weight:700;line-height:1.2} .metric .l{font-size:11px;color:var(--muted);margin-top:2px}\n.ff-cap{font-size:12.5px;color:var(--muted);margin:0 0 8px;line-height:1.5;max-width:110ch}\n.ff-grid,.scroll{overflow-x:auto}\n.ok{background:var(--accent-bg);color:var(--accent);padding:11px 14px;border-radius:var(--r-sm);font-size:13.5px;border-left:3px solid var(--accent)}\n.err{background:var(--bad-bg);color:var(--bad);padding:10px 14px;border-radius:var(--r-sm);font-size:13px;border-left:3px solid var(--bad);margin-bottom:10px;line-height:1.5}\n.warn{background:var(--warn-bg);color:var(--warn-ink);padding:10px 14px;border-radius:var(--r-sm);font-size:13px;border-left:3px solid var(--warn-ink)}\ntable.xl{border-collapse:separate;border-spacing:0;width:100%;font-size:13.5px}\ntable.xl th,table.xl td{border-bottom:1px solid var(--line);padding:9px 11px;white-space:nowrap;background:var(--card);text-align:center;vertical-align:middle}\ntable.xl thead th{position:sticky;top:0;z-index:2;font-size:11px;font-weight:700;letter-spacing:.03em;color:var(--faint);text-transform:uppercase}\ntable.xl .frz{position:sticky;left:0;z-index:1;border-right:1px solid var(--line)}\ntable.xl thead th.frz{z-index:3}\ntable.xl tbody tr:nth-child(even) td{background:var(--zebra)}\ntable.xl tbody tr:hover td{background:var(--soft)}\ntable.xl tfoot td{background:var(--soft);font-weight:800}\ntable.xl.xl-dense th,table.xl.xl-dense td{padding:6px 8px;font-size:12.5px}\n.pill{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:var(--r-pill);font-size:11.5px;font-weight:700;line-height:17px;white-space:nowrap}\n.pill-ok{background:var(--accent-bg);color:var(--accent)} .pill-low{background:var(--warn-bg);color:var(--warn-ink)}\n.pill-out{background:var(--bad-bg);color:var(--bad)} .pill-sea{background:var(--brand-bg);color:var(--brand-ink)} .pill-mute{background:var(--chip);color:var(--muted)}\n.lm-note{font-size:12.5px;color:var(--muted);margin:0 0 10px;line-height:1.5}\n.lm-why{font-size:12px;color:var(--muted);line-height:1.55;margin-top:8px}\n.lm-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:12px}\n.lm-lines td{padding:5px 6px} .lm-lines input,.lm-lines select{padding:6px 8px;font-size:12.5px}\n.lm-x{background:transparent;color:var(--bad);box-shadow:none;padding:4px 8px;font-size:15px}\n.lm-x:hover{background:var(--bad-bg)}\n\n/* ---- the dashboard ---- */\n.dashcards{display:grid;grid-template-columns:repeat(auto-fit,minmax(228px,1fr));gap:14px;margin-bottom:14px}\n.dcard{display:block;width:100%;text-align:left;background:var(--card);color:var(--ink);border-radius:var(--r-card);box-shadow:var(--sh-1);padding:14px 16px;font-weight:400;white-space:normal}\n.dcard:hover{background:var(--card);box-shadow:var(--sh-2)}\n.dhead{display:flex;align-items:center;gap:8px;margin-bottom:9px}\n.dicon{width:22px;height:22px;border-radius:7px;background:var(--chip);color:var(--brand-ink);display:inline-flex;align-items:center;justify-content:center;flex:none}\n.dtitle{font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}\n.dchip{margin-left:auto;font-size:10.5px;font-weight:700;padding:2px 9px;border-radius:var(--r-pill);background:var(--accent-bg);color:var(--accent);white-space:nowrap}\n.dfig{font-size:26px;font-weight:800;line-height:1.1;letter-spacing:-.01em}\n.dsub{font-size:12px;color:var(--muted);margin-top:2px}\n.dsplit{display:flex;gap:30px;flex-wrap:wrap}\n.dnote{font-size:12px;color:var(--muted);margin-left:auto;padding-bottom:3px}\n.dash2col{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(380px,100%),1fr));gap:14px;align-items:stretch;margin-bottom:14px}\n\n/* ---- Greige POs: the figures, each one a filter ---- */\n.pobar{display:flex;gap:10px;flex-wrap:wrap;margin:-4px 0 14px}\n.gk-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:14px}\n.gk{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto auto;column-gap:8px;text-align:left;background:var(--card);color:var(--ink);\n  border-radius:var(--r-card);box-shadow:var(--sh-1);padding:14px 16px;font-weight:400;white-space:normal;outline:1.5px solid transparent}\n.gk:hover{background:var(--card);box-shadow:var(--sh-2)}\n.gk.on{outline-color:var(--brand)}\n.gk-ic{grid-column:2;grid-row:1/3;width:34px;height:34px;border-radius:10px;display:grid;place-items:center}\n.gk-v{grid-column:1;font-size:21px;font-weight:800;letter-spacing:-.01em}\n.gk-l{grid-column:1;font-size:12.5px;color:var(--muted);font-weight:600}\n.gk-s{grid-column:1/-1;font-size:12px;color:var(--muted);margin-top:9px}\n.tone-blue{background:var(--brand-bg);color:var(--brand-ink)} .tone-amber{background:var(--warn-bg);color:var(--warn-ink)}\n.tone-green{background:var(--accent-bg);color:var(--accent)} .tone-red{background:var(--bad-bg);color:var(--bad)}\n.filters{padding:12px 14px;display:flex;flex-direction:column;gap:10px}\n.frow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}\n.frow select{flex:0 1 200px;width:auto;height:38px;padding-block:0}\n.pair{display:inline-flex;align-items:center;gap:6px;flex:0 1 auto;min-width:0}\n.frow input[type=date]{width:160px;max-width:100%;height:38px;padding-block:0}\nlabel.inl{margin:0;font-size:12px}\n.frow2{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}\n.count{font-size:12.5px}\n.tablecard{padding:0;overflow:hidden}\n.t{width:100%;min-width:1080px;border-collapse:collapse}\n.t > thead th,.ct > thead th{font-size:11px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:var(--faint);text-align:left;padding:12px 10px;border-bottom:1px solid var(--line);white-space:nowrap;background:var(--card)}\n.t > tbody > tr > td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:middle}\nth.num,td.num{text-align:right;white-space:nowrap} th.ra{text-align:right} td.tl,th.tl{text-align:left}\n.xrow{cursor:pointer}\n.xrow:hover > td,.xrow.open > td{background:var(--soft)}\n.plus{color:var(--muted);font-weight:600}\n.w-chev{width:40px;padding-left:12px!important;padding-right:0!important}\n.chev{width:26px;height:26px;padding:0;background:transparent;box-shadow:none;border-radius:7px;display:grid;place-items:center;color:var(--muted)}\n.chev:hover{background:var(--line);color:var(--ink)}\n.chev svg{transition:transform .15s ease}\n.open > td .chev svg{transform:rotate(90deg)}\n.mill{display:flex;gap:10px;align-items:center}\n.av{width:32px;height:32px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800}\n.av-a{background:var(--brand-bg);color:var(--brand-ink)} .av-b{background:var(--pink-bg);color:var(--pink)}\n.av-c{background:var(--accent-bg);color:var(--accent)} .av-d{background:var(--warn-bg);color:var(--warn-ink)}\n.prog{display:flex;align-items:center;gap:8px;font-weight:700}\n.actions{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;min-width:230px}\n.plate{font-family:var(--mono);font-size:12px;border:1px solid var(--line);border-radius:5px;padding:1px 7px;background:var(--card);white-space:nowrap}\n.detail > td{padding:0!important;background:var(--soft);border-bottom:1px solid var(--line)}\n.panel{padding:6px 18px 18px 52px;display:flex;flex-direction:column;gap:12px}\n@media (max-width:640px){.panel{padding-left:14px}}\n.panel-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}\n.panel-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px}\n.lsum{display:flex;gap:10px;flex-wrap:wrap}\n.lchip{background:var(--card);border-radius:12px;padding:10px 13px;min-width:min(270px,100%);box-shadow:var(--sh-1)}\n.lchip .top2{display:flex;justify-content:space-between;gap:12px;font-size:13px}\n.lchip .due{color:var(--warn-ink)}\n.bar{height:5px;background:var(--line);border-radius:3px;margin-top:8px;overflow:hidden}\n.bar i{display:block;height:100%;background:var(--brand);border-radius:3px}\n.bar i.full{background:var(--accent)}\n.ct.li th{background:var(--card)}\n.ct.li td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}\n.ct.li tr.tot td{border-bottom:0;font-weight:700;background:var(--soft)}\n.bar.sm{height:4px;margin-top:5px;min-width:70px}\n.box{background:var(--card);border-radius:12px;overflow:hidden;box-shadow:var(--sh-1)}\n.ct{width:100%;border-collapse:collapse}\n.ct > tbody > tr > td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}\n.ct .xrow:hover > td,.ct .xrow.open > td{background:var(--brand-bg)}\n.empty{padding:18px;color:var(--muted);font-size:13.5px}\n.pieces{padding:12px 14px 14px;display:flex;flex-direction:column;gap:12px;background:var(--soft)}\n.pieces-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)}\n.pl-h{font-size:13px;margin-bottom:7px}\n.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px}\n.pc{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:7px 9px;display:flex;flex-direction:column;gap:3px}\n.pc.short{border-color:var(--bad-line);background:var(--bad-bg)}\n.pc-top{display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted)}\n.pc-m{font-weight:700}\n.pc input{padding:4px 7px;font-size:13px;border-radius:7px}\n.pc-lab{font-size:11px;font-weight:500;color:var(--faint);margin:0}\n.d{font-weight:700} .d.short{color:var(--bad)} .d.extra{color:var(--ok-ink)} .d.ok{color:var(--faint);font-weight:500}\n.foot{font-size:12.5px;color:var(--muted);max-width:90ch;margin:4px 2px 0;line-height:1.55}\n\n/* ---- the receive drawer ---- */\n.scrim{position:fixed;inset:0;background:var(--scrim);z-index:1010}\n.drawer{position:fixed;top:0;right:0;bottom:0;width:min(640px,100%);background:var(--card);z-index:1011;display:flex;flex-direction:column;box-shadow:var(--sh-3);\n  padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}\n.dr-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 22px;border-bottom:1px solid var(--line)}\n.dr-head h2{font-size:19px;margin:2px 0 0}\n.crumb{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}\n.dr-body{flex:1;overflow:auto;padding:18px 22px;display:flex;flex-direction:column;gap:16px}\n.dr-foot{border-top:1px solid var(--line);padding:14px 22px;display:flex;flex-direction:column;gap:10px}\n@media (max-width:520px){.dr-head,.dr-body,.dr-foot{padding-inline:16px}}\n.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n@media (max-width:520px){.grid2{grid-template-columns:1fr}}\n.fld{display:flex;flex-direction:column;gap:5px;font-size:12.5px;font-weight:600;color:var(--muted);margin:0}\n.fld small{font-weight:400;font-size:12px}\n.fld.wide{grid-column:1/-1}\n.sect{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}\n.sect span{font-weight:500;letter-spacing:0;text-transform:none}\n.dl{border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:var(--soft)}\n.prh,.pr{display:grid;grid-template-columns:24px minmax(0,1fr) minmax(0,1fr) 32px;gap:8px;align-items:center}\n.prh{font-size:11.5px;color:var(--faint);font-weight:600}\n.pr input{padding:7px 10px}\n.pr-i{font-size:12px;color:var(--faint);text-align:right}\n.x{width:32px;height:32px;padding:0;background:transparent;box-shadow:none;color:var(--muted);font-size:18px;line-height:1;border-radius:8px}\n.x:hover{background:var(--line);color:var(--ink)}\n.dl-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}\n.dl-sum{margin-left:auto;font-weight:700;font-size:13px}\n.link{background:none;box-shadow:none;color:var(--brand-ink);font-size:13px;font-weight:700;padding:2px 0}\n.link:hover{background:none;text-decoration:underline}\n.paste{display:flex;flex-direction:column;gap:8px}\n.paste textarea{min-height:84px;resize:vertical;font-family:var(--mono);font-size:13px}\n.warnline{font-size:12.5px;color:var(--warn-ink)}\n.note{font-size:12.5px;color:var(--muted)}\n.empty-sm{border:1px dashed var(--line);border-radius:12px;padding:16px;color:var(--muted);font-size:13.5px}\n.pohead{background:var(--soft);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}\n.pohead-top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}\n.ct.mini th{padding:7px 8px;background:transparent}\n.ct.mini td{padding:7px 8px;font-size:12.5px}\n.ct.mini tr.tot td{border-bottom:0;font-weight:700}\n.due{color:var(--warn-ink)}\n.dl-top{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}\n.lotf{flex:0 0 150px}\n.lotf input{font-family:var(--mono);font-weight:700}\n.supline{background:var(--brand-bg);color:var(--brand-ink);padding:10px 12px;border-radius:var(--r-sm);font-size:12.5px;line-height:1.55}\n.cellbtn{background:transparent;box-shadow:none;color:inherit;font:inherit;font-weight:inherit;padding:4px 8px;border-radius:8px;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}\n.cellbtn:hover,.cellbtn.on{background:var(--brand-bg);color:var(--brand-ink);text-decoration:none}\n.cellbtn .caret{font-size:10px;opacity:.7}\ntr.invdet > td{background:var(--soft)!important;padding:4px 12px 14px!important;white-space:normal!important;text-align:left!important}\n.invdrop{display:flex;flex-direction:column;gap:8px}\n.balegrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px}\n.bale{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:0;padding:7px 9px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);font-size:12.5px;font-weight:600;cursor:pointer}\n.bale input{width:15px;height:15px;flex:none}.bale b{margin-left:auto;font-variant-numeric:tabular-nums}\n.bale.on{border-color:var(--brand);background:var(--brand-bg);color:var(--brand-ink)}\n.okline{background:var(--accent-bg);color:var(--accent);padding:8px 12px;border-radius:var(--r-sm);font-size:12.5px}\n.approvals{border-left:4px solid var(--warn-ink)}\n.closeline{display:flex;align-items:center;gap:9px;margin:0;font-size:13px;font-weight:600;color:var(--ink);background:var(--warn-bg);border-radius:var(--r-sm);padding:9px 12px}\n.closeline input{width:16px;height:16px;flex:none}\n.dr-total{display:flex;justify-content:space-between;gap:12px;font-weight:700;flex-wrap:wrap}\n.dr-btns{display:flex;justify-content:flex-end;gap:8px}\n\n/* ---- dialogs ---- */\n.modal{position:fixed;inset:0;background:var(--scrim);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}\n.modalbox{background:var(--card);border-radius:var(--r-card);padding:20px;width:min(720px,100%);max-height:92vh;overflow:auto;box-shadow:var(--sh-3)}\n.en-groups{display:flex;flex-direction:column;gap:7px;margin:4px 0 16px}\n.en-group{display:flex;align-items:center;gap:6px;flex-wrap:wrap}\n.en-gname{font-size:10.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);width:82px;flex:none}\n.en-chip{display:inline-flex;align-items:center;gap:7px;background:var(--chip);color:var(--ink);box-shadow:none;border-radius:var(--r-pill);padding:6px 13px;font-size:12.5px;font-weight:600}\n.en-chip:hover{background:var(--line);color:var(--ink)}\n.en-chip.on{background:var(--card);box-shadow:inset 0 0 0 1.5px var(--ink),var(--sh-1);font-weight:800}\n.en-dot{width:8px;height:8px;border-radius:50%;flex:none}\n.en-after{background:var(--brand-bg);color:var(--brand-ink);border-radius:var(--r-sm);padding:10px 14px;font-size:13px;line-height:1.7;margin-bottom:10px}\n.en-after-h{font-size:10.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;opacity:.75;margin-bottom:2px}\n.en-after .bad{color:var(--bad)}\n.docbox{width:min(860px,100%)}\n.docpaper{background:#ffffff;color:#000000;border-radius:8px;padding:16px;overflow-x:auto;box-shadow:inset 0 0 0 1px var(--line);margin:12px 0 16px}\n.mailbox{background:var(--soft);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;font-size:13px;margin:8px 0 12px}\n.mailbox pre{margin:6px 0 0;white-space:pre-wrap;font:13px/1.5 var(--sans);color:var(--ink)}\n.err-in{color:var(--bad);font-weight:600}\n\n.toast{position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--toast-bg);color:var(--toast-fg);\n  padding:11px 16px;border-radius:12px;font-size:13.5px;z-index:80;width:max-content;max-width:calc(100% - 32px);box-shadow:var(--sh-3);border-left:4px solid var(--brand);z-index:1100}\n.toast.ok{border-left-color:var(--c-rfd)} .toast.warn{border-left-color:var(--c-greige)} .toast.err{border-left-color:var(--bad)}\n@media (prefers-reduced-motion: reduce){*{transition:none!important}}\n";
  var GD_HTML = "<div class=\"shell\">\n  <div class=\"side\">\n    <div class=\"brand\"><span class=\"brandname\">Greige Desk<span class=\"brandsub\">Greige · RFD · POs</span></span></div>\n    <button type=\"button\" class=\"navgrp\" data-tab=\"po\">Greige POs</button>\n    <button type=\"button\" class=\"navgrp\" data-tab=\"inv\">Inventory</button>\n    <button type=\"button\" class=\"navgrp\" data-tab=\"ledger\">Fabric ledger</button>\n    <button type=\"button\" class=\"navgrp\" data-tab=\"mst\">Master data</button>\n    <div class=\"sidefoot\">\n      <span id=\"meName\" class=\"muted\" style=\"font-size:12px\"></span>\n    </div>\n  </div>\n\n  <div class=\"main\">\n    <div class=\"topbar\">\n      <h1 class=\"lm-h\" id=\"lmTitle\">Greige POs</h1>\n      <div class=\"topacts\"><span id=\"lmTopPick\" class=\"toppick\"></span><input id=\"lmQ\" type=\"search\" placeholder=\"Search PO, supplier, challan, lot, LR…\" aria-label=\"Search\"></div>\n    </div>\n    <div id=\"lmPane\"></div>\n  </div>\n</div>\n\n<!-- ENTRY. One dialog for every movement: the kind decides which fields matter. -->\n<div class=\"modal hide\" id=\"lmEntry\">\n  <div class=\"modalbox\">\n    <h2 style=\"margin:0 0 4px;font-size:18px\" id=\"lmEnTitle\">Fabric entry</h2>\n    <div class=\"lm-note\" id=\"lmEnNote\"></div>\n    <div id=\"lmEnErr\" class=\"err hide\"></div>\n    <div id=\"enChips\" class=\"en-groups\"></div>\n    <select id=\"enKind\" class=\"hide\" aria-label=\"Movement\"></select>\n    <div class=\"lm-fields\">\n      <div><label for=\"enLot\">Lot *</label><input id=\"enLot\" list=\"enLots\" placeholder=\"LOT-005\"><datalist id=\"enLots\"></datalist></div>\n      <div><label for=\"enDate\">Date *</label><input type=\"date\" id=\"enDate\"></div>\n      <div><label for=\"enFab\">Fabric *</label><input id=\"enFab\" list=\"enFabs\" placeholder=\"Greige Sheeting 67\"><datalist id=\"enFabs\"></datalist></div>\n      <div><label for=\"enQty\">Metres *</label><input id=\"enQty\" type=\"text\" inputmode=\"decimal\" autocomplete=\"off\" data-num=\"7\" placeholder=\"1200\"></div>\n      <div><label id=\"enPartyL\" for=\"enParty\">Party</label><input id=\"enParty\" list=\"enParties\" placeholder=\"Shri Balaji Mills\"><datalist id=\"enParties\"></datalist></div>\n      <div><label for=\"enBill\" id=\"enBillL\">Bill / challan</label><input id=\"enBill\" placeholder=\"Optional\"></div>\n      <div id=\"enFinalWrap\"><label>Is that the lot?</label>\n        <label style=\"display:flex;align-items:center;gap:8px;font-weight:500;color:var(--ink);margin:0;height:var(--ctl)\">\n          <input type=\"checkbox\" id=\"enFinal\" checked style=\"width:16px;height:16px\">\n          <span>Yes, close the lot</span></label></div>\n      <div id=\"enReturnedWrap\"><label for=\"enReturned\">Sent back (optional)</label>\n        <input id=\"enReturned\" type=\"text\" inputmode=\"decimal\" autocomplete=\"off\" data-num=\"7\" placeholder=\"0\" title=\"Metres refused at the door and returned\"></div>\n      <div id=\"enPoWrap\"><label for=\"enPo\">Against greige PO</label><input id=\"enPo\" list=\"enPos\" placeholder=\"Optional\"><datalist id=\"enPos\"></datalist></div>\n    </div>\n    <div style=\"margin-bottom:12px\"><label id=\"enRemarkL\" for=\"enRemark\">Remark (optional)</label>\n      <input id=\"enRemark\" placeholder=\"Anything worth remembering about this entry\"></div>\n    <div id=\"enAfter\" class=\"en-after hide\"></div>\n    <div class=\"lm-why hide\" id=\"enSpec\" style=\"background:var(--soft);border-radius:var(--r-sm);padding:9px 11px\"></div>\n    <div class=\"lm-why\" id=\"lmEnWhy\"></div>\n    <div class=\"row\" style=\"margin-top:14px;justify-content:flex-end\">\n      <button type=\"button\" class=\"ghost hide\" id=\"enDelete\" style=\"color:var(--bad);margin-right:auto\">Remove this entry</button>\n      <button type=\"button\" class=\"ghost\" data-close=\"lmEntry\">Cancel</button>\n      <button type=\"button\" id=\"enSave\">Save the entry</button>\n    </div>\n  </div>\n</div>\n\n<!-- A GREIGE PO. Written in the greige name, priced per line. -->\n<div class=\"modal hide\" id=\"lmPo\">\n  <div class=\"modalbox\" style=\"width:min(1060px,100%)\">\n    <h2 style=\"margin:0 0 4px;font-size:18px\" id=\"poTitle\">New greige PO</h2>\n    <div class=\"lm-note\">The cloth is ordered by its <b>greige</b> name, because greige comes wider than the RFD it becomes.\n      Each line’s description is written from Master data and can be changed by hand.</div>\n    <div id=\"lmPoErr\" class=\"err hide\"></div>\n    <div id=\"poCoNote\" class=\"warn hide\" style=\"margin-bottom:12px\"></div>\n    <div class=\"lm-fields\">\n      <div><label for=\"poNo\">PO number</label><input id=\"poNo\" readonly></div>\n      <div><label for=\"poDate\">Date</label><input type=\"date\" id=\"poDate\" readonly title=\"The day the PO is raised; it is not changed\"></div>\n      <div><label for=\"poMill\">Supplier *</label><input id=\"poMill\" list=\"poMills\" placeholder=\"Shri Balaji Mills\"><datalist id=\"poMills\"></datalist>\n        <div id=\"poMillNote\" class=\"muted\" style=\"font-size:11px;margin-top:4px\"></div><div id=\"poMillLock\" class=\"muted\" style=\"font-size:11px\"></div></div>\n    </div>\n    <details id=\"poMore\" style=\"margin:0 0 12px\">\n      <summary style=\"cursor:pointer;font-size:12.5px;font-weight:700;color:var(--muted)\">Payment, dispatch &amp; delivery terms (optional)</summary>\n      <div class=\"lm-fields\" style=\"margin-top:10px\">\n        <div><label for=\"poPay\">Mode / terms of payment</label><input id=\"poPay\" placeholder=\"e.g. 30 days\"></div>\n        <div><label for=\"poDisp\">Dispatched through</label><input id=\"poDisp\" placeholder=\"Transporter\"></div>\n        <div><label for=\"poDest\">Destination</label><input id=\"poDest\" placeholder=\"Jaipur\"></div>\n        <div><label for=\"poOther\">Other references</label><input id=\"poOther\"></div>\n      </div>\n      <div><label for=\"poTerms\">Terms of delivery</label><input id=\"poTerms\" placeholder=\"Delivered to our godown, freight paid\"></div>\n    </details>\n    <div class=\"ff-grid\"><table class=\"xl lm-lines\" id=\"poLines\"></table></div>\n    <div class=\"row\" style=\"margin-top:8px\"><button type=\"button\" class=\"ghost\" id=\"poAdd\">+ Add a line</button></div>\n    <div id=\"poTot\" class=\"lm-why\"></div>\n    <div style=\"margin-top:12px\"><label for=\"poTc\">Terms &amp; conditions (optional)</label><textarea id=\"poTc\" rows=\"4\" style=\"width:100%\" placeholder=\"Quality, delivery, payment and any other conditions the supplier must follow\"></textarea><div class=\"muted\" style=\"font-size:11px;margin-top:3px\">Starts with your standard terms from the PO settings; change them for this PO if needed. Printed on the PO and put in the mail.</div></div>\n    <div class=\"row\" style=\"margin-top:14px;justify-content:flex-end\">\n      <button type=\"button\" class=\"ghost\" data-close=\"lmPo\">Cancel</button>\n      <button type=\"button\" class=\"ghost\" id=\"poSaveDoc\">Save &amp; open the PO</button>\n      <button type=\"button\" id=\"poSave\">Save the PO</button>\n    </div>\n  </div>\n</div>\n\n<!-- ISSUE TO RFD: from a PO, its lots with greige in the store, to one RFD processor. -->\n<div class=\"modal hide\" id=\"lmIss\">\n  <div class=\"modalbox\" style=\"width:min(900px,100%)\">\n    <div style=\"display:flex;justify-content:space-between;align-items:flex-start;gap:12px\">\n      <div><div class=\"crumb\">Issue to RFD</div><h2 style=\"margin:2px 0 0;font-size:19px\" id=\"issTitle\"></h2></div>\n      <button type=\"button\" class=\"x\" data-close=\"lmIss\" aria-label=\"Close\">×</button>\n    </div>\n    <div id=\"issErr\" class=\"err hide\" style=\"margin-top:12px\"></div>\n    <div class=\"lm-fields\" style=\"margin-top:12px\">\n      <div><label for=\"issProc\">RFD processor *</label><select id=\"issProc\"></select></div>\n      <div><label for=\"issDate\">Date</label><input type=\"date\" id=\"issDate\" readonly title=\"Today\"></div>\n      <div><label for=\"issNo\">Our RFD challan no.</label><input id=\"issNo\" readonly title=\"Given automatically, in its own series\"></div>\n      <div><label for=\"issLr\">Transport / LR no.</label><input id=\"issLr\" autocomplete=\"off\" placeholder=\"Optional\"></div>\n      <div><label for=\"issRate\">Processing rate / m</label><input id=\"issRate\" type=\"text\" inputmode=\"decimal\" autocomplete=\"off\" data-num=\"7\" placeholder=\"Optional\" title=\"The RFD processor’s charge per metre. Leave blank and the RFD PO shows quantities only.\"></div>\n      <div><label for=\"issRem\">Remark</label><input id=\"issRem\" autocomplete=\"off\" placeholder=\"Optional\"></div>\n    </div>\n    <div class=\"sect\">Bales going out</div>\n    <div class=\"lm-why\" style=\"margin-top:4px\">Tick a bale to send all of it, or type fewer metres beside it: the rest stays in the greige store.</div>\n    <div id=\"issLots\" style=\"display:flex;flex-direction:column;gap:12px;margin-top:8px\"></div>\n    <div id=\"issTot\" class=\"lm-why\"></div>\n    <div class=\"row\" style=\"margin-top:14px;justify-content:flex-end\"><button type=\"button\" class=\"ghost\" data-close=\"lmIss\">Cancel</button><button type=\"button\" id=\"issSave\">Issue to RFD</button></div>\n  </div>\n</div>\n\n<!-- SEND TO CUTTING: RFD thans of one lot, off the shelf to the cutting table. -->\n<div class=\"modal hide\" id=\"lmCut\">\n  <div class=\"modalbox\" style=\"width:min(820px,100%)\">\n    <div style=\"display:flex;justify-content:space-between;align-items:flex-start;gap:12px\">\n      <div><div class=\"crumb\">Send to cutting</div><h2 style=\"margin:2px 0 0;font-size:19px\" id=\"cutTitle\"></h2></div>\n      <button type=\"button\" class=\"x\" data-close=\"lmCut\" aria-label=\"Close\">×</button>\n    </div>\n    <div id=\"cutMode\" class=\"seg\" role=\"tablist\" aria-label=\"Kind of cutting\" style=\"margin-top:12px\"></div>\n    <div id=\"cutErr\" class=\"err hide\" style=\"margin-top:12px\"></div>\n    <div class=\"lm-fields\" style=\"margin-top:12px\">\n      <div><label for=\"cutTo\">Cutting master / table</label><input id=\"cutTo\" autocomplete=\"off\" placeholder=\"Optional\"></div>\n      <div><label for=\"cutDate\">Date</label><input type=\"date\" id=\"cutDate\" readonly title=\"Today\"></div>\n      <div><label for=\"cutRem\">Remark</label><input id=\"cutRem\" autocomplete=\"off\" placeholder=\"Optional\"></div>\n    </div>\n    <div class=\"sect\" id=\"cutSect\">Thans going to cutting</div>\n    <div id=\"cutBody\" style=\"display:flex;flex-direction:column;gap:12px;margin-top:8px\"></div>\n    <div id=\"cutTot\" class=\"lm-why\"></div>\n    <div class=\"row\" style=\"margin-top:14px;justify-content:flex-end\"><button type=\"button\" class=\"ghost\" data-close=\"lmCut\">Cancel</button><button type=\"button\" id=\"cutSave\">Send to cutting</button></div>\n  </div>\n</div>\n\n<!-- RECEIVE RFD: thans back from the RFD processor, against the lots of one PO. -->\n<div class=\"modal hide\" id=\"lmRr\">\n  <div class=\"modalbox\" style=\"width:min(820px,100%)\">\n    <div style=\"display:flex;justify-content:space-between;align-items:flex-start;gap:12px\">\n      <div><div class=\"crumb\">Receive RFD</div><h2 style=\"margin:2px 0 0;font-size:19px\" id=\"rrTitle\"></h2></div>\n      <button type=\"button\" class=\"x\" data-close=\"lmRr\" aria-label=\"Close\">×</button>\n    </div>\n    <div id=\"rrErr\" class=\"err hide\" style=\"margin-top:12px\"></div>\n    <div class=\"lm-fields\" style=\"margin-top:12px\">\n      <div><label for=\"rrNo\">Processor’s challan no. *</label><input id=\"rrNo\" autocomplete=\"off\" placeholder=\"As printed on their challan\"></div>\n      <div><label for=\"rrDate\">Date</label><input type=\"date\" id=\"rrDate\" readonly title=\"Today\"></div>\n    </div>\n    <div class=\"sect\">Thans back <span>Enter in a metres box adds the next than. RFD can come back in parts, on different days. The lot closes by itself when 95% of the metres sent are back, or when you tick Nothing more to come. More than 5% shrinkage on a closed lot needs approval.</span></div>\n    <div id=\"rrLots\" style=\"display:flex;flex-direction:column;gap:12px;margin-top:8px\"></div>\n    <div class=\"row\" style=\"margin-top:14px;justify-content:flex-end\"><button type=\"button\" class=\"ghost\" data-close=\"lmRr\">Cancel</button><button type=\"button\" id=\"rrSave\">Save the receipt</button></div>\n  </div>\n</div>\n\n<!-- THE PO AS PAPER, and the mail that goes with it. -->\n<div class=\"modal hide\" id=\"lmDoc\">\n  <div class=\"modalbox docbox\">\n    <div style=\"display:flex;justify-content:space-between;align-items:flex-start;gap:12px\">\n      <div><div class=\"crumb\">Purchase order</div><h2 style=\"margin:2px 0 0;font-size:19px\" id=\"docTitle\"></h2></div>\n      <button type=\"button\" class=\"x\" data-close=\"lmDoc\" aria-label=\"Close\">×</button>\n    </div>\n    <div class=\"docpaper\" id=\"docPaper\"></div>\n    <div id=\"docMail\"></div>\n  </div>\n</div>\n\n<!-- RECEIVE GREIGE: opened from an open PO; the whole PO, then the supplier's challan bale by bale. -->\n<div class=\"scrim\" id=\"scrim\" hidden data-close=\"drawer\"></div>\n<aside class=\"drawer\" id=\"drawer\" hidden role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"drTitle\">\n  <div class=\"dr-head\">\n    <div><div class=\"crumb\">Receive greige</div><h2 id=\"drTitle\">New challan</h2></div>\n    <button type=\"button\" class=\"x\" data-close=\"drawer\" aria-label=\"Close\">×</button>\n  </div>\n  <div class=\"dr-body\">\n    <div id=\"dPo\"></div>\n    <div class=\"sect\">The supplier’s challan</div>\n    <div class=\"grid2\">\n      <label class=\"fld\" for=\"dNo\"><span>Challan no. *</span><input id=\"dNo\" autocomplete=\"off\" placeholder=\"As printed on the challan\"></label>\n      <label class=\"fld\" for=\"dDate\"><span>Challan date *</span><input id=\"dDate\" type=\"date\"></label>\n      <label class=\"fld\" for=\"dInv\"><span>Invoice no.</span><input id=\"dInv\" autocomplete=\"off\" placeholder=\"The supplier’s bill, if it came with the goods\"></label>\n      <label class=\"fld\" for=\"dTrn\"><span>Transporter name</span><input id=\"dTrn\" autocomplete=\"off\" placeholder=\"e.g. VRL Logistics\"></label>\n      <label class=\"fld wide\" for=\"dLr\"><span>LR no.</span><input id=\"dLr\" autocomplete=\"off\" placeholder=\"Optional\"></label>\n    </div>\n    <div class=\"sect\">Bales on this challan <span>Enter in a metres box adds the next bale</span></div>\n    <div id=\"dLines\"></div>\n  </div>\n  <div class=\"dr-foot\">\n    <div class=\"dr-total\" id=\"dTotal\"></div>\n    <label class=\"closeline\" id=\"dCloseWrap\" for=\"dClose\" hidden><input type=\"checkbox\" id=\"dClose\"><span id=\"dCloseTxt\"></span></label>\n    <div class=\"err\" id=\"dErr\" hidden></div>\n    <div class=\"dr-btns\">\n      <button type=\"button\" class=\"ghost\" data-close=\"drawer\">Cancel</button>\n      <button type=\"button\" id=\"dSave\" data-dr=\"save\">Save challan</button>\n    </div>\n  </div>\n</aside>\n<div class=\"toast\" id=\"toast\" hidden role=\"status\"></div>\n\n";

/* core/util.js -- Small shared helpers: escaping, number and date formatting, ids, lists in words.
 * An ES module. Its imports are worked out from the code by the split script. */

/* ---- small helpers, same names as the app --------------------------------------------------- */

var ESCMAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ESCMAP[c]; });
}
function nf(n) { return Math.round(n || 0).toLocaleString('en-IN'); }
function money(n) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/* TODAY AS THE CLOCK ON THE WALL SAYS IT, not as Greenwich does. The date was read off toISOString(),
 * which is UTC: from midnight to half past five in the morning, India time, every entry, PO and
 * "days out" count was stamped with yesterday's date. The date is built from the local calendar now,
 * which is also how every other date in this file is read back (Date.parse of 'YYYY-MM-DDT00:00:00'). */
/** The business day (YYYY-MM-DD) on this PC's clock — today, or the day a stored moment (UTC) fell on. */
function lmToday(moment) {
  var d = moment ? new Date(moment) : new Date(), two = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}
function uid() { return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
/* METRES AND RATES ARE TYPED AS NUMBERS ONLY (Ravi, 21 Nov: "only number can be entered and only upto 7 digits").
 * Digits and one decimal point, up to 7 digits before it and 2 after (9,999,999.99); a discount % box takes 3 before
 * it. The boxes are plain text boxes marked data-num="<digits before the point>", because a browser number box lets
 * "e", "+" and "-" in and hides what was really typed. */
var NUM_WHOLE_DIGITS = 7, NUM_DECIMALS = 2, PCT_WHOLE_DIGITS = 3;
function cleanNumber(text, wholeDigits) {
  var s = String(text == null ? '' : text).replace(/[^0-9.]/g, ''), dot = s.indexOf('.');
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  var parts = s.split('.'), whole = parts[0].slice(0, wholeDigits || NUM_WHOLE_DIGITS);
  return parts.length > 1 ? whole + '.' + parts[1].slice(0, NUM_DECIMALS) : whole;
}
function uniq(list) {
  var seen = {}, out = [];
  list.forEach(function (x) { var k = String(x || '').trim(); if (k && !seen[k]) { seen[k] = 1; out.push(k); } });
  return out;
}

/** Whole days between a written date and today. */
function lmDays(d) {
  if (!d) return null;
  var then = Date.parse(String(d) + 'T00:00:00'), now = Date.parse(lmToday() + 'T00:00:00');
  if (isNaN(then) || isNaN(now)) return null;
  return Math.round((now - then) / 86400000);
}
function daysWord(n) { return n === null ? '' : n === 0 ? 'today' : n === 1 ? '1 day' : n + ' days'; }

/** "A", "A and B", "A, B and C" -- a list the way it would be said out loud. */
function lmList(xs) {
  var a = (xs || []).filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

/* ---- every lot, the whole journey on one line ------------------------------------------------ */
var RUPEE = String.fromCharCode(8377);
var DASH = String.fromCharCode(8212);
var MUTED_DASH = '<span class="muted">' + DASH + '</span>';
var r2 = function (x) { return Math.round((x || 0) * 100) / 100; };
/** 13-Aug-26, as the books print a date. */
var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtD(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  return m ? m[3] + '-' + MON3[parseInt(m[2], 10) - 1] + '-' + m[1].slice(2) : String(d || '');
}
/* THE AMOUNT IN WORDS, in lakhs and crores -- "INR Thirty Six Lakh Twenty Thousand Only" -- because
 * that is the line a mill's accountant reads first and the one a typing slip cannot survive. */
function inrWords(n) {
  n = Math.round((n || 0) * 100) / 100;
  var rupees = Math.floor(n), paise = Math.round((n - rupees) * 100);
  var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
    'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  var two = function (x) { return x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''); };
  var three = function (x) {
    var h = Math.floor(x / 100), r = x % 100;
    return (h ? ones[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : '');
  };
  var words = function (x) {
    if (!x) return 'Zero';
    var out = [], cr = Math.floor(x / 10000000); x %= 10000000;
    var lk = Math.floor(x / 100000); x %= 100000;
    var thou = Math.floor(x / 1000); x %= 1000;
    if (cr) out.push(words(cr) + ' Crore');
    if (lk) out.push(two(lk) + ' Lakh');
    if (thou) out.push(two(thou) + ' Thousand');
    if (x) out.push(three(x));
    return out.join(' ');
  };
  return 'INR ' + words(rupees) + (paise ? ' and ' + two(paise) + ' Paise' : '') + ' Only';
}

/* core/vocab.js -- The words of the register: movement types, their signs and labels, PO statuses, GST states, chase thresholds.
 * An ES module. Its imports are worked out from the code by the split script. */

/* ---- the ledger's vocabulary, lifted from the app ------------------------------------------- */

/* Greige in from the mill, out to the processing house, and back as RFD. The two halves of that
 * round trip are separate movements on purpose: what is with the processor is neither greige stock
 * nor RFD stock, and a factory that cannot see that figure cannot chase it. */
var FAB_SIGN = {
  RECEIVE_GREIGE: 1, ISSUE_TO_RFD: -1, RECEIVE_RFD: 1,
  OPENING_RFD: 1, PURCHASE_RFD: 1, ISSUE_TO_CUTTING: -1,
  /* DAMAGE IS A MOVEMENT, NOT A LABEL ON A LOT.
   *
   * A hole, a stain, a bleach burn: the cloth is still in the building but it will never reach a
   * cutting table, so it has to leave the usable stock the same way an issue does -- with a date, a
   * quantity and a reason against the lot it came out of. Written as a flag instead, the stock
   * figure would stay wrong and somebody would promise cloth that cannot be cut. */
  DAMAGE: -1,
};
var FAB_LABEL = {
  RECEIVE_GREIGE: 'Greige received', ISSUE_TO_RFD: 'Greige sent for RFD', RECEIVE_RFD: 'RFD received',
  OPENING_RFD: 'RFD opening stock', PURCHASE_RFD: 'RFD bought (received ready)',
  ISSUE_TO_CUTTING: 'RFD to cutting', CUT_TO_PRINTER: 'Cut pieces to printer',
  DAMAGE: 'Damaged \u2014 written off',
  RFD_TO_PRINTER: 'RFD to printer', RFD_BACK_FROM_PRINTER: 'RFD back from printer (unprinted)',
};
/* The state a movement leaves the cloth in -- a receipt of RFD makes RFD, whatever the row says. */
var FAB_TXN_STATE = {
  RECEIVE_GREIGE: 'GREIGE', ISSUE_TO_RFD: 'GREIGE', RECEIVE_RFD: 'RFD',
  OPENING_RFD: 'RFD', PURCHASE_RFD: 'RFD', ISSUE_TO_CUTTING: 'RFD', CUT_TO_PRINTER: 'RFD',
};
var FAB_STATE_LABEL = { GREIGE: 'Greige', RFD: 'RFD', PRINTED: 'Printed' };

/* Which lots a movement may be written against: you send greige, you receive what is out at a
 * processor, you issue RFD. The pickers are filtered by this and nothing else. */
var FAB_KIND_WANT = { ISSUE_TO_RFD: 'greige', RECEIVE_RFD: 'out', ISSUE_TO_CUTTING: 'rfd',
  DAMAGE: 'any' };

/* A RECEIPT IS THE ONE MOVEMENT THAT CAN BE REFUSED AT THE DOOR.
 *
 * A bale arrives short, or woven at the wrong width, or off shade, and part of it goes straight back
 * on the same vehicle. The challan still says what was sent, and the mill still has to be told what
 * was kept, so both figures are written down -- but only what stayed comes into stock. */
var FAB_CAN_RETURN = { RECEIVE_GREIGE: 1, RECEIVE_RFD: 1, PURCHASE_RFD: 1 };

var GPO_STATUS = {
  open: ['Sent', 'pill-sea'], sent: ['Sent', 'pill-sea'],
  part: ['Part received', 'pill-low'], received: ['Received', 'pill-ok'], closed: ['Closed short', 'pill-ok'], cancelled: ['Cancelled', 'pill-out'],
};


/* HOW LONG IS IT A DAY TOO LONG?
 *
 * Bleaching a lot takes the better part of a week, so a lot still out after seven days is one worth
 * a telephone call. A PO that a mill has had for a week without delivering is the same. These are
 * the only two numbers on this screen that are a judgement rather than a fact, so they are written
 * here, once, and said out loud on the screen itself. */
var CHASE_PROCESSOR_DAYS = 7;
var CHASE_PO_DAYS = 7;

/* ---- the PO dialog -------------------------------------------------------------------------- */

/* THE STATE A GSTIN BELONGS TO is written in its first two digits, so it is read off rather than
 * typed a second time -- 08 is Rajasthan, wherever the number is printed. */
var GST_STATES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh'
};
/* A GSTIN AS THE GST LAW WRITES IT (Ravi, 13 Oct: "it should follow the standard GSTIN format"): 15 characters --
 * a state code, the 10-character PAN (5 letters, 4 digits, a letter), the registration number in that state, the
 * letter Z, and a check character worked out from the first 14. '' when it is right, else what is wrong. */
var GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstinCheckChar(g14) {
  var sum = 0;
  for (var i = 0; i < 14; i++) { var v = GSTIN_CHARS.indexOf(g14.charAt(i)) * (i % 2 ? 2 : 1); sum += Math.floor(v / 36) + (v % 36); }
  return GSTIN_CHARS.charAt((36 - (sum % 36)) % 36);
}
function gstinProblem(g) {
  var s = String(g || '').trim().toUpperCase();
  if (!s) return '';
  if (s.length !== 15) return 'A GSTIN has 15 characters; this one has ' + s.length + '.';
  if (!GST_STATES[s.slice(0, 2)] && s.slice(0, 2) !== '97' && s.slice(0, 2) !== '99') return s.slice(0, 2) + ' is not a GST state code (01 to 38).';
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s.slice(2, 12))) return 'Characters 3 to 12 must be the PAN: 5 letters, 4 digits, 1 letter (' + s.slice(2, 12) + ').';
  if (!/^[1-9A-Z]$/.test(s.charAt(12))) return 'Character 13 is the registration number in the state: 1-9 or A-Z.';
  if (s.charAt(13) !== 'Z') return 'Character 14 is always Z.';
  if (gstinCheckChar(s.slice(0, 14)) !== s.charAt(14)) return 'The last character does not check out (it should be ' + gstinCheckChar(s.slice(0, 14)) + '). A character is mistyped.';
  return '';
}
function gstState(g) {
  var c = String(g || '').trim().slice(0, 2), n = GST_STATES[c];
  return n ? n + ', Code : ' + c : '';
}

/* core/register.js -- The register itself: the sample data, loading and saving it, and migrating older saved copies.
 * An ES module. Its imports are worked out from the code by the split script. */
/* =============================================================================================
 * GREIGE -> RFD -> CUTTING, as a model that runs on this machine alone.
 *
 * The live screen reads five registers out of Firebase. This one carries the same rules over the
 * same shapes, with the registers kept in this browser, so the flow can be walked end to end
 * without a sign-in, a network, or any chance of touching live data. Transaction types, field
 * names and function names are the live ones on purpose: what is learnt here reads straight
 * across to Replenish-App/public/index.html.
 *
 * Ravi, 2026-09-26: "m pahle greige fabric purchase karta hu, then greige ko RFD par bhejta hu,
 * RFD se receive hota h then cut pcs / running me printers ko deta hu."
 * ============================================================================================= */

var LM_KEY = 'greige-desk-v4';

/* PIECES (THANS) FOR THE SAMPLE CHALLANS: n pieces adding up to exactly `total` metres, the first
 * `checked` of them measured at the door (a few a little short, the way thans arrive). Seeded, so the
 * sample reads the same every time it is put back. */
function lmRng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function lmPieces(start, n, total, seed, checked, diff) {
  var rnd = lmRng(seed), avg = total / n, out = [], sum = 0, DIFF = diff || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, -0.2];
  var one = function (x) { return Math.round(x * 10) / 10; };
  for (var i = 0; i < n; i++) {
    var m = i < n - 1 ? one(avg + (rnd() - 0.5) * 6) : one(total - sum);
    sum = one(sum + m);
    out.push({ than: String(start + i), m: m, chk: (checked === 'all' || i < checked) ? one(m + DIFF[Math.floor(rnd() * DIFF.length)]) : null });
  }
  return out;
}

/* ---- the registers -------------------------------------------------------------------------- */

var DB = null;                                  /* { mst, fab, gpo } */

/* Sample data that shows every state the screen has to draw: a lot that came back cheaply, one
 * sitting at a processor, one that came back badly, RFD that was already on the floor, and a PO
 * nobody has sent yet. Two processors at 6.8% and 14% is the conversation the loss column is for. */
function lmSample() {
  return {
    mst: [
      { rfd: 'Sheeting 62', greige: 'Greige Sheeting 67',
        warp: '30s', weft: '30s', epi: 76, ppi: 68,
        greigeWidth: 67, rfdWidth: 62, active: true },
      { rfd: 'Cambric 44', greige: 'Greige Cambric 48',
        warp: '40s', weft: '40s', epi: 92, ppi: 88,
        greigeWidth: 48, rfdWidth: 44, active: true },
      { rfd: 'Poplin 58', greige: 'Greige Poplin 63',
        warp: '2/40s', weft: '40s', epi: 110, ppi: 76,
        greigeWidth: 63, rfdWidth: 58, active: true },
      { rfd: 'Rayon 44', greige: 'Greige Rayon 46',
        warp: '30s', weft: '30s', epi: 68, ppi: 68,
        greigeWidth: 46, rfdWidth: 44, active: true },
    ],
    /* The company's own details start empty and are filled in once, in this browser -- see the
     * Company page. Only the series is set, so the next PO carries on from RIDHI/PO/GREIG/003. */
    co: { name: 'RIDHI', addr: '', email: '', gstin: '', iec: '', pan: '', jurisdiction: 'Jaipur',
      poPrefix: 'RIDHI/PO/GREIG/', poNext: 1, rfdPrefix: 'RIDHI/RFD/' },
    /* Who works on this page, and what each may do (Users & access). */
    users: [
      { id: 'u1', name: 'Ravi', role: 'Admin', ledger: 'edit', approve: true, active: true },
      { id: 'u2', name: 'Store team', role: 'Store', ledger: 'view', approve: false, active: true },
      { id: 'u3', name: 'Accounts', role: 'Accounts', ledger: 'none', approve: false, active: true },
    ],
    me: 'u1',
    ven: [
      { name: 'Shri Balaji Mills', kind: 'Supplier', phone: '98290 11223', email: 'sales@balajimills.example', city: 'Bhilwara', active: true },
      { name: 'Maa Textiles', kind: 'Supplier', phone: '98250 44556', email: 'orders@maatextiles.example', city: 'Surat', active: true },
      { name: 'Gayatri Processors', kind: 'RFD Processor', phone: '94140 77889', email: '', city: 'Jaipur', active: true },
      { name: 'Maa Tara Processors', kind: 'RFD Processor', phone: '94140 99001', email: '', city: 'Jaipur', active: true },
    ],
    gpo: [
      { id: 'g1', poNo: 'RIDHI/PO/GREIG/001', date: '2026-09-21', mill: 'Shri Balaji Mills', sent: { at: '2026-09-21' },
        lines: [{ rfd: 'Sheeting 62', greige: 'Greige Sheeting 67', metres: 1200, rate: 58 },
          { rfd: 'Cambric 44', greige: 'Greige Cambric 48', metres: 1000, rate: 44 }] },
      { id: 'g2', poNo: 'RIDHI/PO/GREIG/002', date: '2026-09-28', mill: 'Maa Textiles', sent: { at: '2026-09-28' },
        lines: [{ rfd: 'Poplin 58', greige: 'Greige Poplin 63', metres: 1500, rate: 52 }] },
      { id: 'g3', poNo: 'RIDHI/PO/GREIG/003', date: '2026-10-01', mill: 'Shri Balaji Mills', sent: { at: '2026-10-01' },
        lines: [{ rfd: 'Rayon 44', greige: 'Greige Rayon 46', metres: 900, rate: 71 }] },
    ],
    fab: [
      /* a lot that went the whole way: 1,200 out, 1,118 back -- 6.8% left in the bleach */
      { id: 'f1', chId: 'ch1', date: '2026-09-23', lot: 'LOT-001', fabricType: 'Greige Sheeting 67', txnType: 'RECEIVE_GREIGE', qty: 1200, party: 'Shri Balaji Mills', bill: 'SBM/1187', orderNo: 'RIDHI/PO/GREIG/001',
        lr: '', pieces: lmPieces(2301, 28, 1200, 37, 'all') },
      { id: 'f2', date: '2026-09-24', lot: 'LOT-001', fabricType: 'Greige Sheeting 67', txnType: 'ISSUE_TO_RFD', qty: 1200, party: 'Gayatri Processors', bill: 'RIDHI/RFD/001', orderNo: '' },
      { id: 'f3', date: '2026-09-30', lot: 'LOT-001', fabricType: 'Sheeting 62', txnType: 'RECEIVE_RFD', qty: 1118, party: 'Gayatri Processors', bill: 'GP/R/1187', orderNo: '', final: true, pieces: lmPieces(9101, 26, 1118, 71, 0) },
      { id: 'f4', date: '2026-10-01', lot: 'LOT-001', fabricType: 'Sheeting 62', txnType: 'ISSUE_TO_CUTTING', qty: 620, party: 'Cutting', bill: '', orderNo: '' },
      /* part on the shelf, part at the processor -- the lot nobody could see before */
      { id: 'f5', chId: 'ch2', date: '2026-09-25', lot: 'LOT-002', fabricType: 'Greige Cambric 48', txnType: 'RECEIVE_GREIGE', qty: 800, party: 'Shri Balaji Mills', bill: 'SBM/1203', orderNo: 'RIDHI/PO/GREIG/001',
        lr: '', pieces: lmPieces(2340, 20, 800, 41, 9) },
      { id: 'f6', date: '2026-09-27', lot: 'LOT-002', fabricType: 'Greige Cambric 48', txnType: 'ISSUE_TO_RFD', qty: 500, party: 'Gayatri Processors', bill: 'RIDHI/RFD/002', orderNo: '' },
      /* and a lot that came back 14% lighter -- the same job, a different processor */
      { id: 'f7', chId: 'ch3', date: '2026-09-29', lot: 'LOT-003', fabricType: 'Greige Poplin 63', txnType: 'RECEIVE_GREIGE', qty: 1500, party: 'Maa Textiles', bill: 'MT/CH/412', orderNo: 'RIDHI/PO/GREIG/002',
        lr: 'VRL 558120', pieces: lmPieces(4501, 35, 1500, 11, 'all', [0, 0, 0, 0, 0, 0.1, -0.4, -0.8, -1.5, 0]) },
      { id: 'f8', date: '2026-09-30', lot: 'LOT-003', fabricType: 'Greige Poplin 63', txnType: 'ISSUE_TO_RFD', qty: 1500, party: 'Maa Tara Processors', bill: 'RIDHI/RFD/003', orderNo: '' },
      { id: 'f9', date: '2026-10-02', lot: 'LOT-003', fabricType: 'Poplin 58', txnType: 'RECEIVE_RFD', qty: 1290, party: 'Maa Tara Processors', bill: 'MTP/R/0412', orderNo: '', final: true, pieces: lmPieces(9201, 30, 1290, 83, 0) },
      /* A stain down one edge, found on the table. It is still in the building and it will never be
       * cut, so it comes off the lot. */
      { id: 'f11', date: '2026-10-02', lot: 'LOT-001', fabricType: 'Sheeting 62', txnType: 'DAMAGE', qty: 18, party: '', bill: '', orderNo: '', state: 'RFD', note: 'Oil stain down one selvedge' },
      /* RFD already on the floor the day this started -- its own lot, so it can be issued like any
       * other, and kept apart from "RFD back" so it never makes up a processing loss */
      /* The last of the Cambric on PO/68, in this week -- four thans nobody has measured yet. */
      { id: 'f12', chId: 'ch4', date: '2026-10-10', lot: 'LOT-004', fabricType: 'Greige Cambric 48', txnType: 'RECEIVE_GREIGE', qty: 150, party: 'Shri Balaji Mills', bill: 'SBM/1241', orderNo: 'RIDHI/PO/GREIG/001',
        lr: '', pieces: lmPieces(2360, 4, 150, 53, 0) },
      { id: 'f10', date: '2026-09-22', lot: 'LOT-OPEN-01', fabricType: 'Rayon 44', txnType: 'OPENING_RFD', qty: 400, party: '', bill: '', orderNo: '' },
    ],
  };
}

/* ANYTHING TYPED BEFORE THE COLUMNS WERE CUT STILL OPENS. The warp and weft used to be four boxes
 * (a count and a fold each); they are one box now, written the way a sales note writes it. */
function lmMigrate() {
  if (!DB.users || !DB.users.length) { DB.users = lmSample().users; DB.me = 'u1'; }
  if (DB.co && !DB.co.rfdPrefix) DB.co.rfdPrefix = 'RIDHI/RFD/';
  /* A PO line's description used to repeat the greige; it now says what the greige becomes. */
  (DB.gpo || []).forEach(function (po) { (po.lines || []).forEach(function (l) {
    if (l.desc && poDesc(l.rfd) === l.desc) l.desc = 'RFD ready: ' + l.rfd;
  }); });
  if (!DB.co) {
    DB.co = { name: 'RIDHI', addr: '', email: '', gstin: '', iec: '', pan: '', jurisdiction: 'Jaipur',
      poPrefix: 'RIDHI/PO/GREIG/', poNext: 1, rfdPrefix: 'RIDHI/RFD/' };
  }
  (DB.mst || []).forEach(function (m) {
    if (m.warp == null && (m.warpCount || m.warpFold)) {
      m.warp = ((parseInt(m.warpFold, 10) || 1) > 1 ? m.warpFold + '/' : '') + (m.warpCount || '') + 's';
    }
    if (m.weft == null && (m.weftCount || m.weftFold)) {
      m.weft = ((parseInt(m.weftFold, 10) || 1) > 1 ? m.weftFold + '/' : '') + (m.weftCount || '') + 's';
    }
    delete m.warpCount; delete m.warpFold; delete m.weftCount; delete m.weftFold;
    delete m.weave; delete m.composition; delete m.gsm; delete m.hsn;
  });
  /* THE NAMES WERE ALWAYS THERE, just never written down anywhere you could edit them. A register
   * saved before this screen existed gets one built from the mills and processors already used. */
  if (!DB.ven) {
    var seen = {};
    DB.ven = [];
    (DB.gpo || []).forEach(function (po) {
      var n = String(po.mill || '').trim();
      if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; DB.ven.push({ name: n, kind: 'Supplier', phone: '', email: '', city: '', active: true }); }
    });
    (DB.fab || []).forEach(function (r) {
      var n = String(r.party || '').trim();
      if (!n || n.toLowerCase() === 'cutting' || seen[n.toLowerCase()]) return;
      seen[n.toLowerCase()] = 1;
      DB.ven.push({ name: n, kind: r.txnType === 'RECEIVE_GREIGE' ? 'Supplier' : 'RFD Processor',
        phone: '', email: '', city: '', active: true });
    });
  }
}

/* core/stock.js -- The stock rules: fabric names and specs, lot balances, the fabric roll-up, and what the ledger accepts.
 * An ES module. Its imports are worked out from the code by the split script. */
var FAB_SKIP = null;  /* the row every balance leaves out while that is going on */
/* A RECEIPT WAITING FOR APPROVAL (or turned down) is in the ledger but not in the stock. */
function fabCounts(r) { return !(r && r.approval && r.approval.status !== 'approved'); }
function fabQty(r) { return parseFloat(r && r.qty) || 0; }
function fabState(r) {
  return String((r && (FAB_TXN_STATE[r.txnType] || r.state)) || 'PRINTED').trim().toUpperCase();
}

/* ---- the greige / RFD name pair ------------------------------------------------------------- */

/* THE CLOTH IS ORDERED BY ITS GREIGE NAME. Greige comes wider than the RFD it becomes -- the
 * Sheeting 62 on the cutting table is bought as a wider greige -- so each RFD fabric carries the
 * name its greige is bought under. The PO is written in that name; the lot keeps it while it is
 * greige and with the processor; "RFD received" turns it back into the RFD fabric. */
function fabGreigeOf(rfdFabric) {
  var k = String(rfdFabric || '').trim().toLowerCase();
  var r = (DB.mst || []).filter(function (x) { return String(x.rfd || '').trim().toLowerCase() === k; })[0];
  return r && r.greige ? String(r.greige).trim() : '';
}
/** And back: which RFD fabric a greige name becomes once it is processed. '' when nobody has said. */
function fabRfdOfGreige(greige) {
  var k = String(greige || '').trim().toLowerCase();
  var r = (DB.mst || []).filter(function (x) {
    return x.active !== false && String(x.greige || '').trim().toLowerCase() === k;
  })[0];
  return r ? String(r.rfd || '').trim() : '';
}
/* ---- THE SPEC A MILL IS ACTUALLY GIVEN ------------------------------------------------------ *
 *
 * A greige PO that says only "Sheeting" tells a weaver nothing. A loom is set by the yarn count, the
 * reed and the pick, and the cloth is bought by width, so the fabric type is where all of that
 * belongs -- typed once, carried on to every PO, every lot and every challan.
 *
 * HOW A CLOTH IS WRITTEN DOWN, in the order the trade says it:
 *   warp count x weft count / ends per inch x picks per inch   e.g.  2/40s x 40s / 110 x 76
 * A folded (plied) yarn is written fold-first -- 2/40s is two 40s singles twisted together, which is
 * stronger and smoother than a single 40s and costs more. Ends and picks added together are the
 * thread count bed linen is sold by: 110 + 76 = 186 TC.
 */

/** The fabric type a name belongs to, whether the name given is the RFD one or the greige one. */
function mstOf(name) {
  var k = String(name || '').trim().toLowerCase();
  if (!k) return null;
  return (DB.mst || []).filter(function (m) {
    return String(m.rfd || '').trim().toLowerCase() === k || String(m.greige || '').trim().toLowerCase() === k;
  })[0] || null;
}
/** The yarn as the trade writes it: 40s single, 2/40s two-fold. A bare number gets its s. */
function mstYarn(v) {
  var t = String(v == null ? '' : v).trim();
  if (!t) return '';
  return /^[0-9/.]+$/.test(t) ? t + 's' : t;
}
/** Warp x weft / EPI x PPI -- how every mill in the country writes a cloth down. */
function mstConstruction(m) {
  if (!m) return '';
  var w = mstYarn(m.warp), f = mstYarn(m.weft);
  var e = parseFloat(m.epi) || 0, p = parseFloat(m.ppi) || 0;
  if (!w && !f && !e && !p) return '';
  return (w || '?') + ' × ' + (f || '?') + ' / ' + (e || '?') + ' × ' + (p || '?');
}
/** Thread count, as bed linen is sold: the ends and the picks in one square inch, added up. */
function mstTC(m) {
  var e = parseFloat(m && m.epi) || 0, p = parseFloat(m && m.ppi) || 0;
  return (e + p) ? (e + p) : null;
}
/* WHY THE GREIGE IS WIDER. Scouring and bleaching pull a cloth in across its width -- commonly 5 to
 * 8 per cent -- so a 62" sheeting has to be woven at 67" to come back usable. This is the figure
 * that decides what width to order, and it is worth watching per processor. */
function mstWidthLoss(m) {
  var g = parseFloat(m && m.greigeWidth) || 0, r = parseFloat(m && m.rfdWidth) || 0;
  if (!g || !r) return null;
  return Math.round(((g - r) / g) * 1000) / 10;
}
/** The one-line spec, for under a fabric's name wherever it is shown. */
function mstSpecLine(m) {
  if (!m) return '';
  var bits = [];
  if (m.greigeWidth) bits.push(m.greigeWidth + '" greige');
  var c = mstConstruction(m); if (c) bits.push(c);
  var tc = mstTC(m); if (tc) bits.push(tc + ' TC');
  return bits.join(' · ');
}

/** The fabrics a PO can be raised for: every active fabric type with a greige name on it. */
function gpoFabrics() {
  return (DB.mst || []).filter(function (r) { return r.active !== false && String(r.greige || '').trim(); });
}

/* ---- where the cloth is, fabric by fabric --------------------------------------------------- *
 *
 * Greige comes in, goes to the processing house, comes back as RFD, and leaves for cutting. Four
 * numbers, and the one that never had a home before is the middle one: cloth WITH the processor is
 * neither greige stock nor RFD stock.
 *
 * PROCESS LOSS IS SHOWN, NOT HIDDEN -- but only once the cloth is back. A lot still out has not
 * lost anything yet, so it counts as "at processor" and nowhere else; the percentage is struck off
 * settled lots alone, which is what makes one processor at 6% and another at 14% a figure worth
 * arguing with instead of an artefact of what happens to be out today. */
/* A lot answers to two names -- its greige one and the RFD name it comes back as -- and the figures
 * belong on one line, under the RFD name, because that is what the cutting table asks for. */
function fabLineOf(r) {
  var f = String(r.fabricType || '').trim();
  return fabRfdOfGreige(f) || f;
}
function fabFlowRows(rows) {
  var by = {}, order = [];
  function bump(name) {
    var k = name.toUpperCase();
    if (!by[k]) {
      by[k] = { fabricType: name, greigeIn: 0, toRfd: 0, rfdIn: 0, rfdOpen: 0, rfdBuy: 0, rfdOut: 0,
        withProcessor: 0, lossSent: 0, lossBack: 0, dmgGreige: 0, dmgRfd: 0 };
      order.push(k);
    }
    return by[k];
  }
  (rows || []).forEach(function (r) {
    if (!fabCounts(r)) return;
    var n = fabLineOf(r); if (!n) return;
    var g = bump(n), q = fabQty(r);
    if (r.txnType === 'RECEIVE_GREIGE') g.greigeIn += q;
    else if (r.txnType === 'ISSUE_TO_RFD') g.toRfd += q;
    else if (r.txnType === 'RECEIVE_RFD') g.rfdIn += q;
    else if (r.txnType === 'OPENING_RFD') g.rfdOpen += q;
    else if (r.txnType === 'PURCHASE_RFD') g.rfdBuy += q;
    else if (r.txnType === 'ISSUE_TO_CUTTING') g.rfdOut += q;
    else if (r.txnType === 'DAMAGE') {
      if (fabState(r) === 'GREIGE') g.dmgGreige += q; else g.dmgRfd += q;
    }
  });
  /* WHAT IS STILL OUT AND WHAT WAS LOST ARE BOTH "sent minus back", and only the lot knows which
   * one it is. So both are added up off the lots, never off the fabric totals. */
  fabLots(rows).forEach(function (L) {
    var n = (fabRfdOfGreige(L.fabricType) || L.rfdFabric || L.fabricType || '').toUpperCase();
    if (!by[n]) return;
    by[n].withProcessor += L.withProcessor;
    if (!L.closed) return;
    by[n].lossSent += L.toRfd; by[n].lossBack += L.rfdIn;
  });
  return order.map(function (k) {
    var g = by[k];
    g.greigeLeft = g.greigeIn - g.toRfd - g.dmgGreige;
    g.damaged = g.dmgGreige + g.dmgRfd;
    g.loss = Math.max(0, g.lossSent - g.lossBack);
    g.lossPct = g.lossSent > 0 ? Math.round(((g.lossSent - g.lossBack) / g.lossSent) * 1000) / 10 : null;
    g.rfdLeft = g.rfdOpen + g.rfdBuy + g.rfdIn - g.rfdOut - g.dmgRfd;
    return g;
  }).sort(function (a, b) {
    return (b.greigeIn + b.rfdIn + b.rfdOpen + b.rfdBuy) - (a.greigeIn + a.rfdIn + a.rfdOpen + a.rfdBuy);
  });
}

/* ---- ONE FABRIC'S SHELF, ENTRY BY ENTRY (Ravi, 20 Nov: "full history of in and out ... in the tally ledger format") ---- *
 *
 * Two shelves, as on the Inventory page: greige in the store and RFD on the shelf. Cloth at the processor is on
 * neither. The rows and the rules are fabFlowRows' own (same fabric line, same approval hold, damage off the shelf it
 * was on), so the last closing is always the figure the Inventory page shows. Reading only; nothing is saved. */
var FAB_SHELF_MOVES = {
  greige: { RECEIVE_GREIGE: 1, ISSUE_TO_RFD: -1 },
  /* RFD_TO_PRINTER / RFD_BACK_FROM_PRINTER are not register rows: invHistRows adds them from the flow's RFD challans */
  rfd: { RECEIVE_RFD: 1, OPENING_RFD: 1, PURCHASE_RFD: 1, ISSUE_TO_CUTTING: -1, RFD_TO_PRINTER: -1, RFD_BACK_FROM_PRINTER: 1 },
};
/** +1 when the entry puts cloth on this shelf, -1 when it takes cloth off, 0 when it is not this shelf's. */
function fabShelfSign(r, shelf) {
  if (r.txnType === 'DAMAGE') return (fabState(r) === 'GREIGE') === (shelf === 'greige') ? -1 : 0;
  return (FAB_SHELF_MOVES[shelf] || {})[r.txnType] || 0;
}
/** This fabric's entries on this shelf, oldest first; on the same day, in the order they were written. */
function fabShelfMoves(rows, fabric, shelf) {
  var F = String(fabric || '').trim().toUpperCase();
  return (rows || []).map(function (r, i) { return { r: r, i: i }; }).filter(function (x) {
    return fabCounts(x.r) && fabLineOf(x.r).toUpperCase() === F && fabShelfSign(x.r, shelf) !== 0;
  }).sort(function (a, b) {
    return String(a.r.date || '').localeCompare(String(b.r.date || '')) || a.i - b.i;
  }).map(function (x) { return x.r; });
}
/**
 * The ledger page, Tally's way: what the shelf held when the period opened, each entry with the balance before and
 * after it, and the period's totals. from / to are YYYY-MM-DD, both counted in; blank means no limit. Entries before
 * "from" make the opening; entries after "to" are left out.
 */
function fabShelfLedger(rows, fabric, shelf, from, to) {
  var page = { opening: 0, lines: [], inQty: 0, outQty: 0, closing: 0 };
  fabShelfMoves(rows, fabric, shelf).forEach(function (r) {
    var d = String(r.date || ''), q = fabQty(r) * fabShelfSign(r, shelf);
    if (to && d > to) return;
    if (from && d < from) { page.opening += q; return; }
    var before = page.opening + page.inQty - page.outQty;
    page.lines.push({ row: r, opening: before, inQty: q > 0 ? q : 0, outQty: q < 0 ? -q : 0, closing: before + q });
    if (q > 0) page.inQty += q; else page.outQty -= q;
  });
  page.closing = page.opening + page.inQty - page.outQty;
  return page;
}

/* ---- and lot by lot, which is how the floor actually talks about it ------------------------- */
/** The register as the balances should see it -- without the row currently being corrected. */
function fabRows() {
  return (DB.fab || []).filter(function (r) { return !FAB_SKIP || r.id !== FAB_SKIP; });
}
function fabLots(rows) {
  var by = {}, order = [];
  (rows || fabRows()).forEach(function (r) {
    if (!fabCounts(r)) return;
    var lot = String(r.lot || '').trim(); if (!lot) return;
    if (!by[lot]) {
      by[lot] = { lot: lot, fabricType: '', rfdFabric: '', mill: '', processor: '', bill: '', date: '',
        poNo: '', greigeIn: 0, toRfd: 0, rfdIn: 0, rfdOpen: 0, rfdBuy: 0, rfdOut: 0,
        dmgGreige: 0, dmgRfd: 0, dmgNotes: [], closed: false, n: 0 };
      order.push(lot);
    }
    var g = by[lot], q = fabQty(r); g.n++;
    if (r.txnType === 'RECEIVE_GREIGE') {
      g.greigeIn += q; g.fabricType = g.fabricType || r.fabricType; g.mill = g.mill || r.party;
      g.bill = g.bill || r.bill; g.date = g.date || r.date; g.poNo = g.poNo || r.orderNo;
    } else if (r.txnType === 'ISSUE_TO_RFD') { g.toRfd += q; g.processor = r.party || g.processor; }
    else if (r.txnType === 'RECEIVE_RFD') {
      g.rfdIn += q; g.rfdFabric = r.fabricType || g.rfdFabric;
      /* THE CHALLAN THAT CLOSES THE LOT. Until one says "that is the lot", sent-minus-back is cloth
       * still sitting at the processor; once one does, the very same figure is the process loss.
       * No register can tell the two apart on its own, so the person receiving it says which. */
      if (r.final !== false) g.closed = true;
    }
    else if (r.txnType === 'OPENING_RFD' || r.txnType === 'PURCHASE_RFD') {
      if (r.txnType === 'OPENING_RFD') g.rfdOpen += q; else g.rfdBuy += q;
      g.fabricType = g.fabricType || r.fabricType; g.rfdFabric = g.rfdFabric || r.fabricType;
      g.date = g.date || r.date; g.mill = g.mill || r.party;
    } else if (r.txnType === 'ISSUE_TO_CUTTING') g.rfdOut += q;
    else if (r.txnType === 'DAMAGE') {
      /* Spoilt greige never becomes RFD; spoilt RFD never reaches the table. Each comes off its
       * own shelf. */
      if (fabState(r) === 'GREIGE') g.dmgGreige += q; else g.dmgRfd += q;
      g.dmgNotes.push(r.note || '');
    }
  });
  return order.map(function (k) {
    var g = by[k];
    g.greigeLeft = g.greigeIn - g.toRfd - g.dmgGreige;
    g.rfdLeft = g.rfdOpen + g.rfdBuy + g.rfdIn - g.rfdOut - g.dmgRfd;
    g.damaged = g.dmgGreige + g.dmgRfd;
    g.dmgWhy = lmList(g.dmgNotes.filter(Boolean));
    /* ONE SUBTRACTION, TWO MEANINGS. Sent minus back is cloth still at the processor while the lot
     * is open, and the process loss the moment it is closed. It is never both, and showing it as
     * both -- which is what happens when the figure is read off the fabric totals -- is how a
     * factory ends up chasing 82 m that were never there. */
    var gap = Math.max(0, g.toRfd - g.rfdIn);
    g.withProcessor = g.closed ? 0 : gap;
    g.loss = g.closed ? gap : 0;
    g.lossPct = g.closed && g.toRfd > 0 ? Math.round((gap / g.toRfd) * 1000) / 10 : null;
    return g;
  }).sort(function (a, b) {
    return String(b.date).localeCompare(String(a.date)) || a.lot.localeCompare(b.lot);
  });
}
function fabLot(lot) {
  var want = String(lot || '').trim();
  return fabLots().filter(function (g) { return g.lot === want; })[0];
}
/** Lots with greige still to send, and lots still out at a processor -- the two pickers. */
function fabLotsFor(kind) {
  var want = FAB_KIND_WANT[kind];
  return fabLots().filter(function (g) {
    if (want === 'greige') return g.greigeLeft > 1e-9;
    if (want === 'out') return g.withProcessor > 1e-9;
    if (want === 'rfd') return g.rfdLeft > 1e-9;
    if (want === 'any') return g.greigeLeft > 1e-9 || g.rfdLeft > 1e-9;
    return true;
  });
}

/* ---- what the ledger will and will not accept ----------------------------------------------- *
 *
 * The same refusals as the live screen, in the same words. Every one of them is a mistake that was
 * made on paper first: one bale received twice against a single lot, more sent for processing than
 * the lot held, cloth issued to cutting that never came back from the processor. */
function fabEntryCheck(e) {
  var kind = e.txnType, lot = String(e.lot || '').trim(), fabric = String(e.fabric || '').trim();
  var qty = parseFloat(e.qty) || 0;
  var kept = qty - (parseFloat(e.returned) || 0);
  if (!FAB_SIGN[kind]) return 'Pick what kind of movement this is.';
  if (!e.date) return 'Put a date on it.';
  if (!lot) return 'Every movement belongs to a lot. Give it one.';
  if (!fabric) return 'Which cloth?';
  if (qty <= 0) return 'Metres have to be more than nothing.';

  var back = parseFloat(e.returned) || 0;
  if (back) {
    if (!FAB_CAN_RETURN[kind]) return 'Cloth can only be sent back on a receipt.';
    if (back < 0) return 'Returned metres cannot be less than nothing.';
    if (back >= qty) {
      return 'If all ' + nf(qty) + ' m went back, nothing was received \u2014 do not write the entry at all.';
    }
  }

  /* AGAINST A GREIGE PO: it has to be one, still open, and for this cloth. */
  var poNo = String(e.poNo || '').trim().toUpperCase();
  if (kind === 'RECEIVE_GREIGE' && poNo) {
    var po = (DB.gpo || []).filter(function (p) { return String(p.poNo || '').toUpperCase() === poNo; })[0];
    if (!po) return 'There is no greige PO ' + poNo + '.';
    if (gpoStatus(po) === 'cancelled') return 'PO ' + poNo + ' was cancelled.';
    var names = (po.lines || []).map(function (l) { return String(l.greige || '').trim(); });
    var ok = names.filter(function (n) { return n.toLowerCase() === fabric.toLowerCase(); }).length;
    if (!ok) return 'PO ' + poNo + ' is not for ' + fabric + ' — it is for ' + names.join(', ') + '.';
  }

  var g = fabLot(lot);

  if (kind === 'RECEIVE_GREIGE') {
    if (g && g.greigeIn > 0) {
      /* kept, not qty: a part-returned delivery still opens the lot with what stayed. */
      /* g comes from fabRows(), which already leaves out the row being corrected -- so this only
       * ever fires on a genuinely different receipt. */
      return 'Lot ' + lot + ' already has ' + nf(g.greigeIn) + ' m against it. A second receipt into '
        + 'the same lot is how one bale ends up counted twice — open a new lot.';
    }
    if (!fabRfdOfGreige(fabric)) {
      return 'Nobody has said what ' + fabric + ' becomes once it is processed. Masters → fabric '
        + 'type holds the pair; without it, "RFD received" cannot rename the lot.';
    }
  }

  if (kind === 'ISSUE_TO_RFD') {
    if (!g || g.greigeIn <= 0) return 'Lot ' + lot + ' has no greige against it.';
    /* The lot is still greige, so it goes out under its greige name -- typing the RFD name it will
     * come back as is the commonest slip there is. */
    if (fabric.toLowerCase() !== String(g.fabricType).toLowerCase()
      && fabRfdOfGreige(g.fabricType).toLowerCase() === fabric.toLowerCase()) {
      return 'Lot ' + lot + ' is still greige. It goes out as ' + g.fabricType + '; it comes back as ' + fabric + '.';
    }
    if (qty > g.greigeLeft + 1e-9) {
      return 'Only ' + nf(g.greigeLeft) + ' m is left in lot ' + lot + ' (' + nf(g.greigeIn)
        + ' received, ' + nf(g.toRfd) + ' already sent).';
    }
    if (!String(e.party || '').trim()) return 'Which processing house is it going to?';
  }

  if (kind === 'RECEIVE_RFD') {
    if (g && g.closed) {
      return 'Lot ' + lot + ' was closed when the last challan came in. Nothing more is expected '
        + 'back from the processor on it.';
    }
    if (!g || g.withProcessor <= 1e-9) return 'Lot ' + lot + ' has nothing out at a processor.';
    if (qty > g.withProcessor + 1e-9) {
      return 'Only ' + nf(g.withProcessor) + ' m of lot ' + lot + ' is out there. More has come back '
        + 'than went — check the challan.';
    }
    /* GREIGE COMES BACK AS THE RFD FABRIC IT WAS BOUGHT FOR -- Greige Sheeting 67 back as
     * Sheeting 62. Only when Masters says so; a greige with no RFD fabric named keeps what was typed. */
    var becomes = fabRfdOfGreige(g.fabricType);
    if (becomes && becomes.toLowerCase() !== fabric.toLowerCase()) {
      return 'Lot ' + lot + ' was ' + g.fabricType + ', which comes back as ' + becomes + ', not ' + fabric + '.';
    }
  }

  if (kind === 'DAMAGE') {
    if (!g) return 'Lot ' + lot + ' is not in the register.';
    var isGreige = !!fabRfdOfGreige(fabric);
    var have = isGreige ? g.greigeLeft : g.rfdLeft;
    if (have <= 1e-9) {
      return 'Lot ' + lot + ' has no ' + (isGreige ? 'greige' : 'RFD') + ' left to write off.';
    }
    if (qty > have + 1e-9) {
      return 'Lot ' + lot + ' holds ' + nf(have) + ' m of ' + (isGreige ? 'greige' : 'RFD') + '.';
    }
    /* A write-off with no reason on it is a hole in the stock that nobody can answer for later. */
    if (!String(e.remark || '').trim()) return 'Say what is wrong with it \u2014 a write-off needs a reason.';
  }

  if (kind === 'ISSUE_TO_CUTTING') {
    if (!g || g.rfdLeft <= 1e-9) return 'Lot ' + lot + ' has no RFD on the shelf.';
    if (qty > g.rfdLeft + 1e-9) return 'Lot ' + lot + ' holds ' + nf(g.rfdLeft) + ' m of RFD.';
  }
  return '';
}
function fabNextLot() {
  var max = 0;
  (DB.fab || []).forEach(function (r) {
    var m = /^LOT-(\d+)$/i.exec(String(r.lot || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var n = String(max + 1); while (n.length < 3) n = '0' + n;
  return 'LOT-' + n;
}

/** Leave one row out of every balance while it is being corrected; null puts it back. */
function setFabSkip(id) { FAB_SKIP = id; }

/* core/orders.js -- The purchase-order rules: money, progress, status, numbering, mills and processors, valuation rates.
 * An ES module. Its imports are worked out from the code by the split script. */

/* ---- the purchase orders -------------------------------------------------------------------- *
 *
 * Ravi, 2026-09-21: "greige fabric po generation meaning uska challan bane and m mail kar saku
 * yahi se".
 *
 * Ordered, received and still to come are worked out from the ledger, never typed twice: a
 * "Greige received" entry naming the PO number is what counts as delivered. */
function gpoReceived(po) {
  var no = String((po && po.poNo) || '').trim().toUpperCase(), by = {};
  if (!no) return by;
  (DB.fab || []).forEach(function (r) {
    if (r.txnType !== 'RECEIVE_GREIGE') return;
    if (String(r.orderNo || '').trim().toUpperCase() !== no) return;
    var k = String(r.fabricType || '').trim().toLowerCase();
    by[k] = (by[k] || 0) + fabQty(r);
  });
  return by;
}
/* MONEY ON A PO LINE, THE WAY THE PO ITSELF IS WRITTEN.
 *
 * The purchase order states goods value only -- metres at a rate, less any discount the mill has
 * agreed. Tax is the mill's to charge on its own invoice; putting it on the order as well is how
 * the two documents end up disagreeing. */
function gpoLineMoney(l) {
  var gross = Math.round(((parseFloat(l.metres) || 0) * (parseFloat(l.rate) || 0)) * 100) / 100;
  /* A DISCOUNT PER LINE, AS A PERCENT (Ravi, 21 Nov — it replaces "no discount on a greige PO", 13 Oct). Worked out in
   * paise and rounded once, so the lines and the total always agree to the paisa. */
  var disc = Math.round(gross * gpoDiscPct(l)) / 100;
  var amount = Math.round((gross - disc) * 100) / 100;
  return { gross: gross, disc: disc, amount: amount, total: amount };
}
/** A line's discount percent: 0 when none is typed; never below 0 or above 100. */
function gpoDiscPct(l) {
  var p = parseFloat(l && l.disc);
  return isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
}
function gpoTotals(po) {
  return ((po && po.lines) || []).reduce(function (t, l) {
    var m = gpoLineMoney(l);
    t.metres += parseFloat(l.metres) || 0; t.gross += m.gross; t.disc += m.disc;
    t.amount += m.amount; t.total += m.total;
    return t;
  }, { metres: 0, gross: 0, disc: 0, amount: 0, total: 0 });
}
function gpoProgress(po) {
  var got = gpoReceived(po);
  var lines = ((po && po.lines) || []).map(function (l) {
    var rec = got[String(l.greige || '').trim().toLowerCase()] || 0;
    var ordered = parseFloat(l.metres) || 0;
    return { rfd: l.rfd, greige: l.greige, rate: l.rate, disc: l.disc, desc: l.desc, due: l.due, metres: l.metres,
      ordered: ordered, received: rec, pending: Math.max(0, ordered - rec) };
  });
  var ordered = lines.reduce(function (a, l) { return a + l.ordered; }, 0);
  var received = lines.reduce(function (a, l) { return a + l.received; }, 0);
  return { lines: lines, ordered: ordered, received: received, pending: Math.max(0, ordered - received) };
}
function gpoStatus(po) {
  if (!po) return '';
  if (po.status === 'cancelled') return 'cancelled';
  var p = gpoProgress(po);
  /* THREE STATUSES (Ravi, 13 Oct): Sent, Part received, Received. A PO is sent the day it is raised; one closed
   * by its last challan (or by hand) has received all it ever will. */
  if ((p.ordered > 0 && p.received >= p.ordered - 1e-9) || po.closed) return 'received';
  if (p.received > 0) return 'part';
  return 'sent';
}
/* THE PO NUMBER CARRIES ON ITS OWN SERIES -- RIDHI/PO/GREIG/001, /002, /003 (Ravi, 13 Oct) -- so a PO raised here
 * and one raised in the accounts never share a number. The next is one more than the highest the
 * series has reached, and never lower than the starting point set on the Company page. */
function gpoNewNo() {
  var co = DB.co || {}, pre = co.poPrefix || 'RIDHI/PO/GREIG/', max = 0;
  (DB.gpo || []).forEach(function (p) {
    var no = String(p.poNo || '');
    if (no.toUpperCase().indexOf(pre.toUpperCase()) !== 0) return;
    var n = parseInt(no.slice(pre.length), 10);
    if (!isNaN(n)) max = Math.max(max, n);
  });
  var n = String(Math.max(max + 1, parseInt(co.poNext, 10) || 1));
  while (n.length < 3) n = '0' + n;
  return pre + n;
}
/* OUR RFD CHALLAN NUMBER, IN ITS OWN SERIES LIKE THE PO (Ravi, 13 Oct): RIDHI/RFD/001, /002 ... -- one more than the
 * highest the series has reached. Given by the page, never typed. */
function rfdChNewNo() {
  var pre = (DB.co && DB.co.rfdPrefix) || 'RIDHI/RFD/', max = 0;
  (DB.fab || []).forEach(function (r) {
    if (r.txnType !== 'ISSUE_TO_RFD') return;
    var no = String(r.bill || '');
    if (no.toUpperCase().indexOf(pre.toUpperCase()) !== 0) return;
    var n = parseInt(no.slice(pre.length), 10); if (!isNaN(n)) max = Math.max(max, n);
  });
  var s = String(max + 1); while (s.length < 3) s = '0' + s;
  return pre + s;
}
/* THE NAMES COME OFF THE MASTER FIRST, then off the register.
 *
 * Master data is where a mill is written down; but a name that is already on a PO or a challan has
 * to stay pickable even if nobody has got round to adding it, or switched it off since. Anything
 * else and a correction to an old row becomes impossible. */
function venOfKind(kind) {
  var named = (DB.ven || []).filter(function (v) {
    return v.active !== false && (venKind(v) === kind || v.kind === 'Both');
  }).map(function (v) { return v.name; });
  var used = kind === 'Supplier'
    ? (DB.gpo || []).map(function (p) { return p.mill; })
      .concat((DB.fab || []).filter(function (r) { return r.txnType === 'RECEIVE_GREIGE'; }).map(function (r) { return r.party; }))
    : (DB.fab || []).filter(function (r) {
        return r.txnType === 'ISSUE_TO_RFD' || r.txnType === 'RECEIVE_RFD';
      }).map(function (r) { return r.party; });
  /* A name switched off in the master stays out of the suggestions even if it is on old rows.
   * The rows themselves keep the name they were written with -- it is stored on the row, not looked
   * up -- and the box is free text, so an old row can still be corrected by typing it. */
  var off = {};
  (DB.ven || []).forEach(function (v) {
    if (v.active === false) off[String(v.name || '').trim().toLowerCase()] = 1;
  });
  return uniq(named.concat(used)).filter(function (n) { return !off[n.toLowerCase()]; });
}
/* A SUPPLIER WEAVES OR SELLS THE GREIGE; AN RFD PROCESSOR BLEACHES IT (Ravi, 13 Oct: "mill change to supplier, processor
 * should be just RFD processor"). Names saved before keep working: Mill reads as Supplier, Processor as RFD Processor. */
function venKind(v) { var k = String((v && v.kind) || ''); return k === 'Mill' ? 'Supplier' : k === 'Processor' ? 'RFD Processor' : k; }
function gpoMills() { return venOfKind('Supplier'); }
/* A NEW PO'S SUPPLIER IS PICKED, NOT TYPED (Vishesh, 23 Nov: "no new name can be added from here … you can type name but cannot
 * enter it and it will not save it, it can just be used to search from the suppliers feeded in the master data"). Only the
 * greige suppliers of Master data, switched on; a name kept only because an old PO carries it is not offered. */
function gpoPickMills() {
  return uniq((DB.ven || []).filter(function (v) {
    return v.active !== false && !v.deskOnly && (venKind(v) === 'Supplier' || v.kind === 'Both');
  }).map(function (v) { return v.name; }));
}
/** The Master data spelling of a supplier typed in any case; '' when it is not one of them. */
function gpoPickedMill(name) {
  var k = String(name || '').trim().toLowerCase();
  return gpoPickMills().filter(function (n) { return n.toLowerCase() === k; })[0] || '';
}
/** The supplier of the latest PO that is still a Master data supplier: the grey sample in the supplier box. '' when none. */
function gpoLastMill() {
  var best = null;
  (DB.gpo || []).forEach(function (po, i) {
    if (!gpoPickedMill(po.mill)) return;
    if (!best || String(po.date || '') >= String(best.date || '')) best = { date: po.date, mill: gpoPickedMill(po.mill), i: i };
  });
  return best ? best.mill : '';
}
function lmProcessors() { return venOfKind('RFD Processor'); }
/** How many rows of the register answer to this name -- a vendor on one is not deleted. */
function venUsed(name) {
  var k = String(name || '').trim().toLowerCase();
  if (!k) return 0;
  var n = (DB.fab || []).filter(function (r) { return String(r.party || '').trim().toLowerCase() === k; }).length;
  return n + (DB.gpo || []).filter(function (p) { return String(p.mill || '').trim().toLowerCase() === k; }).length;
}

/* ---- INVENTORY: what is owned, right now ----------------------------------------------------- *
 *
 * The flow screen answers "what happened to this cloth". This one answers the question a stock
 * sheet asks: how much is there, where is it standing, and what did it cost.
 *
 * THREE PLACES, NOT TWO. Cloth in the store is the obvious one. Cloth at the processor is the one
 * that gets forgotten -- it is off the shelf but it is still yours, it is still money, and at any
 * time there is a good deal of it. Both are counted here; only cloth issued to cutting has left.
 */

/** The rate a greige was last bought at, off the POs. null when it has never been ordered here. */
function invRate(greigeName) {
  var k = String(greigeName || '').trim().toLowerCase();
  if (!k) return null;
  var best = null;
  (DB.gpo || []).forEach(function (po) {
    (po.lines || []).forEach(function (l) {
      if (String(l.greige || '').trim().toLowerCase() !== k) return;
      var r = parseFloat(l.rate) || 0; if (!r) return;
      if (!best || String(po.date) >= String(best.date)) best = { date: po.date, rate: r, poNo: po.poNo };
    });
  });
  return best;
}
function venByName(n) {
  var k = String(n || '').trim().toLowerCase();
  return (DB.ven || []).filter(function (v) { return String(v.name || '').trim().toLowerCase() === k; })[0] || null;
}
function poFind(no) { return (DB.gpo || []).filter(function (p) { return p.poNo === no; })[0] || null; }
function poFileName(po) { return String(po.poNo || 'PO').replace(/[\/\\:*?"<>|]+/g, '-') + '.pdf'; }

/* The old built description -- "Sheeting 30S 67" Gray Fabric" (quality, count, loom width). No screen or PO shows it now
 * (Ravi, 21 Nov: the greige is named as Master data names it); lmMigrate still uses it to recognise old lines that
 * stored it as their description. */
function poDesc(rfd) {
  var m = mstOf(rfd); if (!m) return '';
  var base = String(m.rfd || '').replace(/\s*\d+(\.\d+)?\s*$/, '').trim()
    || String(m.greige || '').replace(/^greige\s+/i, '').trim();
  var count = m.warp ? String(mstYarn(m.warp)).toUpperCase() : '';
  var width = m.greigeWidth ? m.greigeWidth + '"' : '';
  return [base, count, width].filter(Boolean).join(' ') + ' Gray Fabric';
}
/* Every line must be for a fabric that has a greige name -- a PO written in the RFD name would send
 * the mill a width it does not weave. */
function gpoCheck(po) {
  if (!po.date) return 'Put a date on the PO.';
  if (!String(po.mill || '').trim()) return 'Which supplier is it on?';
  if (!po.lines.length) return 'A PO with no line is not a PO.';
  for (var i = 0; i < po.lines.length; i++) {
    var l = po.lines[i];
    if (!String(l.greige || '').trim()) {
      return l.rfd + ' has no greige name in Master data, so there is nothing to order it by.';
    }
    if (!(parseFloat(l.metres) > 0)) return 'How many metres of ' + l.greige + '?';
    if (!(parseFloat(l.rate) > 0)) return 'What rate for ' + l.greige + '?';
  }
  return '';
}

/* core/analytics.js -- The figures the dashboard and the stock sheet are drawn from.
 * An ES module. Its imports are worked out from the code by the split script. */

/** The five figures the stage bar carries. */
function ffFacts() {
  var flow = fabFlowRows(DB.fab || []);
  var pend = (DB.gpo || []).filter(function (po) {
    return ['open', 'sent', 'part'].indexOf(gpoStatus(po)) >= 0;
  }).reduce(function (a, po) { return a + gpoProgress(po).pending; }, 0);
  var sum = function (k) { return flow.reduce(function (a, x) { return a + (x[k] || 0); }, 0); };
  return {
    poPending: pend, greige: sum('greigeLeft'), proc: sum('withProcessor'), rfd: sum('rfdLeft'),
    cut: sum('rfdOut'), loss: sum('loss'), lossSent: sum('lossSent'),
    flow: flow, lots: fabLots(DB.fab || []),
  };
}

/* WHAT A DASHBOARD IS FOR.
 *
 * Not the totals -- those are on every other screen. What this answers is: of everything standing
 * still right now, which bit is costing money, and who do I ring about it. Each line is a fact the
 * register already knew and nobody was being shown. */
function dashAlerts() {
  var out = [];

  /* Cloth sitting at a processor is money off the shelf and not yet usable. */
  fabLots(DB.fab || []).forEach(function (g) {
    if (g.withProcessor <= 0.05) return;
    var sent = (DB.fab || []).filter(function (r) {
      return r.lot === g.lot && r.txnType === 'ISSUE_TO_RFD';
    }).map(function (r) { return r.date; }).sort().pop();
    var d = lmDays(sent);
    out.push({
      bad: d !== null && d > CHASE_PROCESSOR_DAYS,
      what: nf(g.withProcessor) + ' m of ' + g.fabricType + ' at ' + (g.processor || 'a processor'),
      who: 'lot ' + g.lot + (d === null ? '' : ', sent ' + daysWord(d) + ' ago'),
      go: 'lots'
    });
  });

  /* A PO the mill has not finished, and a PO nobody has sent. */
  (DB.gpo || []).forEach(function (po) {
    var st = gpoStatus(po); if (st === 'received' || st === 'cancelled' || st === 'closed') return;
    var p = gpoProgress(po), d = lmDays(po.date);
    out.push({ bad: d !== null && d > CHASE_PO_DAYS,
      what: nf(p.pending) + ' m still due on ' + po.poNo,
      who: po.mill + (d === null ? '' : ', ordered ' + daysWord(d) + ' ago'), go: 'po' });
  });

  /* A CHALLAN NOBODY HAS MEASURED, AND THANS THAT CAME IN SHORT. The mill bills what it wrote; the
   * store has what it measured. Both are worth a word before the cloth goes on to be bleached. */
  var byCh = {};
  (DB.fab || []).forEach(function (r) {
    if (r.txnType !== 'RECEIVE_GREIGE' || !r.pieces || !r.pieces.length) return;
    var k = r.chId || r.id, e = byCh[k] || (byCh[k] = { no: r.bill, mill: r.party, n: 0, done: 0, short: 0, m: 0 });
    e.m += fabQty(r);
    r.pieces.forEach(function (p) { e.n++; if (p.chk != null) { e.done++; if (p.chk < p.m - 0.05) e.short += p.m - p.chk; } });
  });
  Object.keys(byCh).forEach(function (k) {
    var e = byCh[k];
    if (e.done < e.n) out.push({ bad: false, tag: 'To check', what: (e.n - e.done) + ' of ' + e.n + ' bales on challan ' + e.no + ' not measured', who: e.mill, go: 'check' });
    /* Short enough to raise with the mill: more than 1 m, and more than 0.3% of what the challan says. */
    if (e.short > Math.max(1, e.m * 0.003)) out.push({ bad: true, tag: 'Short', what: (Math.round(e.short * 10) / 10) + ' m short on challan ' + e.no, who: e.mill + ' billed the challan metres', go: 'check' });
  });

  /* AN RFD RECEIPT THAT SHRANK TOO MUCH waits for someone who may approve it. */
  (DB.fab || []).forEach(function (r) {
    if (r.txnType === 'RECEIVE_RFD' && r.approval && r.approval.status === 'pending') out.push({ bad: true, tag: 'Approve', what: nf(fabQty(r)) + ' m of RFD on ' + r.lot + ' shrank ' + r.approval.pct + '%', who: r.party + ', waiting for approval', go: 'po' });
  });
  /* A CUT TO SIZE waits for the production head or accounts head (Vishesh, 23 Nov). */
  ctsWaiting().forEach(function (r) {
    out.push({ bad: true, tag: 'Approve', what: r.approval.ask, who: 'asked by ' + (r.approval.by || 'the store'), go: 'po' });
  });
  /* …and a PO the store asked to close: the accounts head approves it (Ravi, 21 Nov). */
  (DB.gpo || []).forEach(function (po) {
    if (po.closeAsk) out.push({ bad: true, tag: 'Approve', what: 'Close ' + po.poNo + ' with ' + nf(gpoProgress(po).pending) + ' m not supplied',
      who: 'asked by ' + (po.closeAsk.by || 'the store') + ' on challan ' + (po.closeAsk.challan || '—'), go: 'po' });
  });

  /* A cloth the cutting table cannot be given at all. */
  fabFlowRows(DB.fab || []).forEach(function (e) {
    if (e.rfdLeft > 0.05) return;
    if (e.greigeLeft > 0.05) {
      out.push({ bad: true, what: 'No RFD ' + e.fabricType + ' on the shelf',
        who: nf(e.greigeLeft) + ' m of greige is in the store, ready to send', go: 'lots' });
    } else if (e.withProcessor > 0.05) {
      out.push({ bad: false, what: 'No RFD ' + e.fabricType + ' on the shelf',
        who: nf(e.withProcessor) + ' m is at the processor', go: 'lots' });
    }
  });

  return out.sort(function (a, b) { return (b.bad ? 1 : 0) - (a.bad ? 1 : 0); });
}

/* ONE PROCESSOR AT 7% AND ANOTHER AT 14% IS A CONVERSATION, and it can only be had if somebody puts
 * the two next to each other. The loss column on the fabric table never could: it adds up by cloth,
 * and a cloth goes to whoever has room that week. */
function dashProcessors() {
  var by = {}, order = [];
  fabLots(DB.fab || []).forEach(function (g) {
    var p = String(g.processor || '').trim(); if (!p) return;
    if (!by[p]) {
      by[p] = { name: p, sent: 0, back: 0, lots: 0, outM: 0, outLots: 0, cost: 0, days: 0, timed: 0 };
      order.push(p);
    }
    var e = by[p];
    if (g.withProcessor > 0.05) { e.outM += g.withProcessor; e.outLots++; }
    if (!g.closed) return;
    e.sent += g.toRfd; e.back += g.rfdIn; e.lots++;

    /* WHAT THE GREIGE IN THAT LOT COST. Carried through so the loss can be said in rupees as well
     * as in per cent -- which is the only form anybody acts on. */
    var r = invRate(g.fabricType);
    if (r) e.cost += g.toRfd * r.rate;

    /* HOW LONG THEY KEPT IT: the day the last of it went out to the day it came back. */
    var rows = (DB.fab || []).filter(function (x) { return x.lot === g.lot; });
    var out = rows.filter(function (x) { return x.txnType === 'ISSUE_TO_RFD'; })
      .map(function (x) { return x.date; }).sort().pop();
    var back = rows.filter(function (x) { return x.txnType === 'RECEIVE_RFD'; })
      .map(function (x) { return x.date; }).sort().pop();
    if (out && back) {
      var d = Math.round((Date.parse(back + 'T00:00:00') - Date.parse(out + 'T00:00:00')) / 86400000);
      if (!isNaN(d) && d >= 0) { e.days += d; e.timed++; }
    }
  });
  return order.map(function (k) {
    var e = by[k];
    e.loss = Math.max(0, e.sent - e.back);
    e.lossPct = e.sent > 0 ? Math.round((e.loss / e.sent) * 1000) / 10 : null;
    e.avgDays = e.timed ? Math.round((e.days / e.timed) * 10) / 10 : null;
    /* THE NUMBER THAT DECIDES WHO GETS THE NEXT LOT.
     * Not the loss per cent, and not the rate on the bill -- what one usable metre of RFD actually
     * cost you by the time it came back. Greige spent, divided by RFD received. A cheap house that
     * returns 86% of what it was given is not cheap. */
    e.perMetre = e.back > 0 && e.cost > 0 ? Math.round((e.cost / e.back) * 100) / 100 : null;
    e.baseRate = e.sent > 0 && e.cost > 0 ? Math.round((e.cost / e.sent) * 100) / 100 : null;
    e.lossCost = e.perMetre && e.baseRate ? Math.round((e.perMetre - e.baseRate) * 100) / 100 : null;
    return e;
  }).sort(function (a, b) { return (b.lossPct || 0) - (a.lossPct || 0); });
}

/** Metres and money at each stage of the pipe. */
function dashPipeline() {
  var t = { greige: 0, proc: 0, rfd: 0, greigeV: 0, procV: 0, rfdV: 0,
    /* A VALUE WITH A HOLE IN IT IS WORSE THAN NO VALUE, because it looks complete. Whatever could
     * not be costed is named, and its metres counted, so the figure underneath can be read for what
     * it is: the part of the stock somebody has a rate for. */
    unrated: [], unratedM: 0 };
  fabFlowRows(DB.fab || []).forEach(function (e) {
    var owned = e.greigeLeft + e.withProcessor + e.rfdLeft;
    var r = invRate(fabGreigeOf(e.fabricType));
    var rate = r ? r.rate : 0;
    if (!r && owned > 0.05) { t.unrated.push(e.fabricType); t.unratedM += owned; }
    t.greige += e.greigeLeft; t.proc += e.withProcessor; t.rfd += e.rfdLeft;
    t.greigeV += e.greigeLeft * rate; t.procV += e.withProcessor * rate; t.rfdV += e.rfdLeft * rate;
  });
  t.total = t.greige + t.proc + t.rfd;
  t.totalV = t.greigeV + t.procV + t.rfdV;
  t.valuedM = t.total - t.unratedM;
  return t;
}

/** Fabric by fabric: what is in the store, what is out at a processor, and what it cost. */
function invRows() {
  return fabFlowRows(DB.fab || []).map(function (e) {
    var greigeName = fabGreigeOf(e.fabricType);
    var rate = invRate(greigeName);
    var owned = e.greigeLeft + e.withProcessor + e.rfdLeft;
    return {
      fabric: e.fabricType, greige: greigeName,
      inStoreGreige: e.greigeLeft, atProcessor: e.withProcessor, inStoreRfd: e.rfdLeft,
      owned: owned,
      rate: rate ? rate.rate : null, rateFrom: rate ? rate.poNo : '',
      /* COST, NOT WORTH. It is the greige rate off the last PO -- what the cloth cost to buy. The
       * processing bill is not in this app, so it is not in this figure. */
      value: rate ? owned * rate.rate : null
    };
  }).filter(function (r) { return r.owned > 0.05; });
}


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
  $('lmTopPick').innerHTML = '';   // only the Inventory puts its cloth-type drop-down here
  var body = UI.tab === 'inv' ? renderInv()
    : UI.tab === 'ledger' ? renderLedger() : UI.tab === 'mst' ? renderMst() : renderPo();
  $('lmPane').innerHTML = body;
  [].forEach.call(document.querySelectorAll('.navgrp'), function (b) {
    var on = b.getAttribute('data-tab') === UI.tab;
    b.classList.toggle('here', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
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
  /* Every number box is cleaned as it is typed or pasted, before any other screen code reads it (capture phase). */
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (!el || !el.hasAttribute || !el.hasAttribute('data-num')) return;
    var was = el.value, now = cleanNumber(was, parseInt(el.getAttribute('data-num'), 10));
    if (now === was) return;
    var at = el.selectionStart == null ? now.length : Math.max(0, el.selectionStart - (was.length - now.length));
    el.value = now;
    try { el.setSelectionRange(at, at); } catch (e) { /* the cursor goes to the end: nothing is lost */ }
  }, true);
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
  document.addEventListener('keydown', gdTabFillKey);
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    $('lmPo').classList.add('hide'); $('lmDoc').classList.add('hide');
    if ($('lmHist')) $('lmHist').classList.add('hide');
    if (RD) closeDrawer();
  });
  $('lmQ').addEventListener('input', function () { UI.q = this.value.trim().toLowerCase(); render(); });

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
/* The greige is named as Master data names it, everywhere: screens, the printed PO and the mail (Ravi, 21 Nov: the built
 * "Sheeting 20S 98\" Gray Fabric" was not the actual greige name). */
function lineGreigeText(l) { return String(l.greige || ''); }
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
  var asked = po.closeAsk ? ' · close asked by ' + esc(po.closeAsk.by || 'the store') : '';
  if (st === 'cancelled') return '<span class="pill pill-mute">Cancelled</span>';
  if (st === 'received') return '<span class="pill pill-ok">' + I.check + ' Received' + (po.closed ? ' · ' + nf(gpoNotSupplied(po)) + ' m not supplied' : '') + '</span>';
  if (st === 'part') return '<span class="pill ' + (late ? 'pill-out' : 'pill-low') + '">' + I.dot + ' Part received · ' + nf(p.pending) + ' m due' + (late ? ' · ' + late + ' d late' : '') + asked + '</span>';
  return '<span class="pill ' + (late ? 'pill-out' : 'pill-sea') + '">' + I.dot + ' Sent' + (late ? ' · ' + late + ' d late' : '') + asked + '</span>';
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
/* "Closed short" is a Received PO that was closed before all of it came (Ravi, 21 Nov: it was hidden among the
 * POs that got every metre). */
var PO_STATUS_FILTERS = ['sent', 'part', 'received', 'closedshort', 'cancelled'];
function poHasStatus(po, want) {
  if (want === 'closedshort') return !!po.closed && gpoStatus(po) === 'received' && gpoNotSupplied(po) > 0.05;
  return gpoStatus(po) === want;
}
function poPass(po) {
  if (PV.mill && po.mill !== PV.mill) return false;
  if (PV.from && po.date < PV.from) return false;
  if (PV.to && po.date > PV.to) return false;
  if (PV.st === 'late' && !gpoLateDays(po)) return false;
  if (PV.st === 'tocheck' && !chOfPo(po.poNo).some(chToCheck)) return false;
  if (PV.st === 'short' && !chOfPo(po.poNo).some(function (c) { return chCheck(c).shortN > 0; })) return false;
  if (PO_STATUS_FILTERS.indexOf(PV.st) >= 0 && !poHasStatus(po, PV.st)) return false;
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
  if (PO_STATUS_FILTERS.indexOf(PV.st) >= 0 && !(po && poHasStatus(po, PV.st))) return false;
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
          /* A CHECKED BALE IS NOT CHANGED AGAIN, BY ANYONE (Ravi, 25 Nov; then "you didn't remove editing": the first cut left it
           * open to Admins). The box locks when the cursor leaves it with a figure in it (the change event below), and is drawn
           * locked from then on. */
          var lock = p.chk != null;
          return '<div class="pc' + (short ? ' short' : '') + '" id="' + id + '"><div class="pc-top"><span>Bale ' + esc(p.than) + '</span><span id="pd-' + r.id + '-' + pi + '">' + diffSpan(p) + '</span></div>'
            + '<div class="pc-m">' + m1(p.m) + ' m</div>'
            + '<label class="pc-lab" for="chk-' + r.id + '-' + pi + '">measured</label><input id="chk-' + r.id + '-' + pi + '" type="text" inputmode="decimal" autocomplete="off" data-num="7" data-chk="' + esc(key) + '" value="' + (p.chk == null ? '' : p.chk) + '" placeholder="m"' + (lock ? ' readonly title="Checked. A checked bale cannot be changed."' : '') + '></div>';
        }).join('') + '</div></div>';
    }).join('') + '</div>';
}

/* ---- By PO ---------------------------------------------------------------------------------- */
function poRow(po) {
  var p = gpoProgress(po), st = gpoStatus(po), pct = p.ordered ? Math.round(p.received / p.ordered * 100) : 0;
  var chs = chOfPo(po.poNo), open = !!PV.openPo[po.poNo], l0 = (po.lines || [])[0] || {}, more = (po.lines || []).length - 1;
  var acts = '';
  var canRcv = ['open', 'sent', 'part'].indexOf(st) >= 0 && p.pending > 0.05;
  if (canRcv) acts += '<button type="button" class="jw-btn jw-primary" data-rcv="' + esc(po.poNo) + '">Receive greige</button>';
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
    var left = l.pending > 0.05 ? stillDueCell(po, l.pending)
      : (l.received > l.ordered + 0.05 ? '<span class="d extra">' + nf(l.received - l.ordered) + ' m extra</span>' : '<span class="pill pill-ok">complete</span>');
    return '<tr><td class="num muted">' + (i + 1) + '</td>'
      + '<td class="tl"><b>' + esc(lineGreigeText(l)) + '</b></td>'
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
    + '<td class="num">' + (p.pending > 0.05 ? stillDueCell(po, p.pending) : '—') + '</td><td></td><td></td><td class="num b">' + RUPEE + money(t.amount) + '</td></tr></tbody></table></div>';
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
  /* "Open the PO" is gone from here (Ravi, 21 Nov): Print and the mail button on the PO's row open the same page. */
  var foot = (sups.length ? '<div class="panel-foot"><span>Supplement POs: ' + sups.map(function (x) { return '<b>' + esc(x.poNo) + '</b> (' + nf(gpoTotals(x).metres) + ' m)'; }).join(', ') + '</span></div>' : '')
    + '<div class="panel-foot"><span class="muted">' + esc(inrWords(t.amount)) + '</span><span class="grow"></span>' + poCloseNote(po) + poCloseButtons(po) + '</div>'
    + poHistoryHtml(po);
  return '<div class="panel">' + head + list + foot + '</div>';
}
/** A line's "still due": amber while the PO is open; on a closed PO it is what was never supplied, in grey. */
function stillDueCell(po, m) {
  return po.closed ? '<span class="muted">' + nf(m) + ' m not supplied</span>' : '<b class="due">' + nf(m) + ' m</b>';
}
/** Who closed or cancelled it, a close the store asked for, or one the accounts head turned down. */
function poCloseNote(po) {
  if (po.closed) return '<span class="muted">Closed ' + esc(fmtD(po.closed.at)) + ' · ' + nf(gpoNotSupplied(po)) + ' m not supplied (' + esc(gpoClosedBy(po)) + ')</span>';
  if (po.status === 'cancelled') return '<span class="muted">Cancelled ' + esc(fmtD((po.cancelled || {}).at)) + (po.cancelled && po.cancelled.by ? ' by ' + esc(po.cancelled.by) : '') + '</span>';
  if (po.closeAsk) return '<span class="pill pill-low">Close asked by ' + esc(po.closeAsk.by || 'the store') + ' on challan ' + esc(po.closeAsk.challan || '') + ' · waiting for accounts</span>';
  if (po.closeDown) return '<span class="muted">Close turned down by ' + esc(po.closeDown.by || '') + ': ' + esc(po.closeDown.reason || '') + '</span>';
  return '';
}
/** Close / Reopen / Cancel / Undo cancel: for the accounts department only (right gdpo). */
function poCloseButtons(po) {
  if (!canPoClose()) return '';
  var st = gpoStatus(po), id = esc(po.id), no = esc(po.poNo), btn = function (pre, attr, words) {
    return '<button type="button" class="ghost" id="' + pre + id + '" ' + attr + '="' + no + '">' + words + '</button>';
  };
  if (po.closed) return btn('pc-', 'data-pclose', 'Reopen the PO');
  if (st === 'cancelled') return btn('px-', 'data-pcancel', 'Undo cancel');
  var nothingCame = gpoProgress(po).received <= 0.05;
  return (st === 'sent' || st === 'part' ? btn('pc-', 'data-pclose', 'Close the PO') : '') + (nothingCame ? btn('px-', 'data-pcancel', 'Cancel the PO') : '');
}
/** The PO's own history: every close, cancel, reopen, request and decision, newest first. */
function poHistoryHtml(po) {
  var log = (po.log || []).slice().reverse();
  if (!log.length) return '';
  return '<div class="panel-foot" style="display:block"><div class="sect" style="margin:0 0 4px">History</div>'
    + log.map(function (e) {
      return '<div class="sub">' + esc(fmtD(lmToday(e.at))) + ' · <b>' + esc(e.what) + '</b>' + (e.by ? ' by ' + esc(e.by) : '') + (e.note ? ' · ' + esc(e.note) : '') + '</div>';
    }).join('') + '</div>';
}
/* One challan row; `wide` adds the mill and the PO for the Challans view. */
function chRow(c, wide) {
  var open = !!PV.openCh[c.id], cols = wide ? 11 : 9, d = lmDays(c.date);
  var h = '<tr class="xrow' + (open ? ' open' : '') + '" data-tch="' + esc(c.id) + '">'
    + '<td class="w-chev"><button type="button" class="chev" data-tch="' + esc(c.id) + '" aria-expanded="' + open + '" aria-label="Pieces on challan ' + esc(c.no || c.id) + '">' + I.chev + '</button></td>'
    + '<td class="tl"><span class="b mono">' + (c.no ? esc(c.no) : '<span class="muted">no number</span>') + '</span></td>'
    + '<td class="tl">' + esc(fmtD(c.date)) + '<div class="sub">' + (d === null ? '' : d === 0 ? 'today' : daysWord(d) + ' ago') + '</div>' + gdDateAskNote(c.rows) + '</td>'
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
    + '<select id="pvSt" aria-label="Status">' + opt('', 'Any status', PV.st) + opt('sent', 'Sent', PV.st) + opt('part', 'Part received', PV.st) + opt('received', 'Received', PV.st)
    + opt('closedshort', 'Closed short', PV.st) + opt('cancelled', 'Cancelled', PV.st) + '</select>'
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
  return bar + rrApprovalsHtml() + ctsApprovalsHtml() + gdDateAsksHtml() + closeAsksHtml() + poKpis() + filters + '<div class="card tablecard"><div class="scroll">' + list + '</div></div>'
    + '<p class="foot">A PO rarely comes in one go. The supplier sends greige over several challans, and each challan is a bundle '
    + 'of bales with the metres written against them. When the last one is in, accounts close the PO and what never came is written on it. Every challan is written into the fabric ledger as a new lot, so stock, the '
    + 'processor and the dashboard count it at once.</p>';
}

/* ---- RECEIVE GREIGE: always against an open PO ------------------------------------------------ *
 *
 * Ravi, 13 Oct: "pahle greige PO hona chahiye and receive action open PO par hi hona chahiye, and receive
 * greige window me complete PO show chahiye". So the window is opened from the PO's own row, it shows the
 * whole PO -- every line, what has come so far on which challan -- and the supplier's challan is typed bale
 * by bale under the lines still due. A PO that comes in several challans can be closed with its last one. */
var RD = null;
/* THE NEXT BALE (OR THAN) NUMBER KEEPS THE FORMAT (Ravi, 21 Nov: after "001" came "2"; it should be "002"): one more
 * than the last number typed, at least 3 digits with zeros in front, and as wide as the last one ("2360" → "2361"). */
var BALE_NO_DIGITS = 3;
function rdNextBale(ps) {
  for (var i = ps.length - 1; i >= 0; i--) {
    var t = String(ps[i].than).trim();
    if (/^\d+$/.test(t)) return String(+t + 1).padStart(Math.max(t.length, BALE_NO_DIGITS), '0');
  }
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
      return '<tr><td class="tl"><b>' + esc(lineGreigeText(l)) + '</b></td>'
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
    + '<div class="sub">' + esc(fmtD(po.date)) + ' · due ' + esc(fmtD(gpoDueOf(po))) + '</div></div>'
    + '<div style="text-align:right"><div class="sub">Supplier</div><div class="b">' + esc(po.mill) + '</div></div></div>'
    + '<div class="scroll">' + lines + '</div>' + earlier + '</div>';
}
function rdDraw() {
  var po = poFind(RD.po); if (!po) return;
  var pg = gpoProgress(po);
  $('dPo').innerHTML = rdPoHtml(po);
  $('dLines').innerHTML = Object.keys(RD.lines).map(function (k) {
    var li = +k, l = pg.lines[li], ps = RD.lines[li];
    return '<div class="dl"><div class="dl-top"><div><div class="b">' + esc(lineGreigeText(l)) + '</div><div class="sub">→ RFD ' + esc(l.rfd)
      + ' · <b>' + nf(l.pending) + ' m still due</b> · up to ' + nf(rdRoom(l)) + ' m with the 10% allowance</div></div>'
      + '<label class="fld lotf" for="lot-' + li + '"><span>Lot no.</span><input id="lot-' + li + '" value="' + esc(RD.lot[li] || '') + '" readonly title="Given by the register; it cannot be changed"></label></div>'
      + '<div class="prh"><span></span><span>Bale no.</span><span>Metres (on challan) *</span><span></span></div>'
      + ps.map(function (p, pi) {
        return '<div class="pr"><span class="pr-i">' + (pi + 1) + '</span>'
          + '<input id="pt-' + li + '-' + pi + '" data-li="' + li + '" data-pi="' + pi + '" data-f="than" value="' + esc(p.than) + '" placeholder="Bale no." aria-label="Bale number ' + (pi + 1) + '">'
          + '<input id="pm-' + li + '-' + pi + '" data-li="' + li + '" data-pi="' + pi + '" data-f="m" type="text" inputmode="decimal" autocomplete="off" data-num="7" value="' + esc(p.m) + '" placeholder="Metres" aria-label="Metres, bale ' + (pi + 1) + '">'
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
  /* Accounts close it at once; anyone else's tick asks the accounts head (Ravi, 21 Nov). */
  $('dCloseTxt').textContent = canPoClose() ? 'This is the supplier’s last challan: close the PO with ' + nf(after) + ' m not supplied'
    : 'This is the supplier’s last challan: ask accounts to close the PO (' + nf(after) + ' m not supplied)';
}
function openDrawer(poNo) {
  var po = poFind(poNo), st = gpoStatus(po);
  if (!po) { lmSay('warn', 'Receive greige from its PO: open the PO on Greige POs and press Receive.'); UI.tab = 'po'; render(); return; }
  if (st === 'received' || st === 'cancelled') { lmSay('warn', po.poNo + ' is ' + (GPO_STATUS[st] || [st])[0].toLowerCase() + '. Nothing more is expected on it.'); return; }
  RD = { po: po.poNo, lines: {}, paste: {}, lot: {}, sup: {} };
  rdInitLines(); rdDraw();
  $('dNo').value = ''; $('dLr').value = ''; $('dInv').value = ''; $('dTrn').value = ''; $('dDate').value = lmToday(); $('dDate').max = lmToday(); $('dClose').checked = false;
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
  var dErr = gdRecvDateErr($('dDate').value, po.date, 'the PO was raised'); if (dErr) errs.push(dErr);
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
  var chId = uid(), typed = $('dDate').value, lr = $('dLr').value.trim(), inv = $('dInv').value.trim(), trn = $('dTrn').value.trim();
  /* THE SUPPLEMENT PO (Ravi, 13 Oct): the supplier sent more than the PO and its 10% allowance. The PO takes what
   * was still due; a supplement PO on the same supplier, fabric and rate is raised for the rest and received on this
   * same challan, as the same lot. One supplement PO carries every line that needed one. */
  var supLines = lines.filter(function (l) { return l.sup > 0; }), sup = null;
  if (supLines.length) {
    sup = { id: uid(), poNo: supNoFor(po), date: lmToday(), mill: po.mill, sent: { at: lmToday() }, supplementOf: po.poNo,
      pay: po.pay || '', disp: po.disp || '', dest: po.dest || '', terms: po.terms || '', tc: po.tc || '', other: 'Supplement to ' + po.poNo + ', challan ' + no,
      lines: supLines.map(function (l) { var pl = po.lines[l.li]; return { rfd: pl.rfd, greige: pl.greige, desc: pl.desc || ('RFD ready: ' + pl.rfd), due: lmToday(), metres: l.sup, rate: pl.rate, disc: pl.disc }; }) };
    DB.gpo.push(sup);
  }
  lines.forEach(function (l) {
    var pl = pg.lines[l.li], got = r1(l.pieces.reduce(function (s, p) { return s + p.m; }, 0));
    DB.fab.push(gdDated({ id: uid(), chId: chId, lot: l.lot, fabricType: pl.greige, txnType: 'RECEIVE_GREIGE',
      qty: r1(got - l.sup), party: po.mill, bill: no, orderNo: po.poNo,
      lr: lr, invoice: inv, transporter: trn, pieces: l.pieces, done: false }, typed));
    if (l.sup) DB.fab.push(gdDated({ id: uid(), chId: chId, lot: l.lot, fabricType: pl.greige, txnType: 'RECEIVE_GREIGE',
      qty: l.sup, party: po.mill, bill: no, orderNo: sup.poNo, supplementOf: po.poNo, lr: lr, invoice: inv, transporter: trn, done: false }, typed));
  });
  var lastOne = $('dClose').checked && !$('dCloseWrap').hidden, endWords = '';
  if (lastOne) endWords = ' ' + poLastChallan(po, no, meUser().name);
  else if (po.closeAsk && gpoStatus(po) === 'received') gpoClearAsk(po, meUser().name, 'everything has come');
  lmSaveDb();
  PV.openPo[po.poNo] = true; PV.openCh[chId] = true;
  var c = chBy(chId);
  closeDrawer(); if (UI.tab !== 'inv') UI.tab = 'po'; render();
  lmSay('ok', 'Challan ' + no + ' in against ' + po.poNo + ': ' + plural(chPcs(c), 'bale') + ', ' + m1(chM(c)) + ' m, as '
    + lmList(lines.map(function (l) { return l.lot; })) + '.' + endWords
    + (sup ? ' Supplement PO ' + sup.poNo + ' raised and received for ' + nf(gpoTotals(sup).metres) + ' m.' : ''));
}
/* ==== CLOSING, CANCELLING AND THE STORE'S CLOSE REQUEST (Ravi, 21 Nov) ====
 * A PO is closed when the supplier has said the rest is not coming: what did come stays, what did not is "not supplied"
 * and the PO leaves every "still due" figure. A PO nothing ever came on can also be cancelled (the order was called off).
 * WHO: closing, cancelling and reopening are the accounts department's (right gdpo). The store's "last challan" tick only
 * ASKS; the accounts head (right gdpoappr) approves it, or turns it down with a reason. Accounts' own tick closes at once.
 * "NOT SUPPLIED" is ordered − received, worked out every time (gpoNotSupplied), so a challan removed after the close still
 * shows the right figure. closed.short is still written for older readers, never read.
 * Every close, cancel, reopen, request and decision adds a line to the PO's own history (po.log): what, when (UTC), who.
 * ERRORS: these rules change only the PO; saving is lmSaveDb's (a failed save says "Not saved"). A press without the
 * right, or a turn-down without a reason, is refused with a message saying what to do — never ignored quietly. */
var canPoClose = function () { return gdHas('gdpo'); };
var canPoApprove = function () { return gdHas('gdpoappr'); };

/** The metres a closed PO will never get: ordered and not come, worked out now. 0 for a PO that is not closed. */
function gpoNotSupplied(po) { return po && po.closed ? gpoProgress(po).pending : 0; }
/** Who closed it, in words: "by hand, Priya" / "asked by Ramesh on challan SBM/1241, approved, Neha". Older closes
 *  wrote only `by` ("closed by hand", "challan SBM/1241"). */
function gpoClosedBy(po) {
  var c = po.closed || {};
  return c.how ? c.how + (c.by ? ', ' + c.by : '') : (c.by || '');
}
/** One line in the PO's own history. */
function gpoLog(po, what, who, note) {
  po.log = (po.log || []).concat([{ at: new Date().toISOString(), what: what, by: who || '', note: note || '' }]);
}
/** Close the PO; a request still waiting is answered by it. Returns the metres not supplied. */
function gpoClose(po, who, how, day) {
  var short = gpoProgress(po).pending;
  if (po.closeAsk) gpoClearAsk(po, who, 'the PO was closed');
  po.closed = { at: day || lmToday(), short: short, by: who || '', how: how };
  delete po.closeDown;
  gpoLog(po, 'closed', who, how + ' · ' + nf(short) + ' m not supplied');
  return short;
}
function gpoReopen(po, who) { delete po.closed; gpoLog(po, 'reopened', who, nf(gpoProgress(po).pending) + ' m due again'); }
/** Cancel: only a PO nothing has come on. Returns why not, or ''. */
function gpoCancel(po, who) {
  if (gpoProgress(po).received > 0.05) return po.poNo + ' has greige in already, so it cannot be cancelled. Close it instead.';
  if (po.closeAsk) gpoClearAsk(po, who, 'the PO was cancelled');
  po.status = 'cancelled'; po.cancelled = { at: lmToday(), by: who || '' };
  gpoLog(po, 'cancelled', who);
  return '';
}
function gpoUncancel(po, who) { delete po.status; delete po.cancelled; gpoLog(po, 'cancel undone', who); }
/** The store's request to close, made with the challan it came on. A newer request replaces an older one. */
function gpoAskClose(po, who, challan) {
  po.closeAsk = { at: new Date().toISOString(), by: who || '', challan: challan || '' };
  delete po.closeDown;
  gpoLog(po, 'close asked', who, 'on challan ' + (challan || '—') + ' · ' + nf(gpoProgress(po).pending) + ' m not come');
}
function gpoClearAsk(po, who, why) { delete po.closeAsk; gpoLog(po, 'close request cleared', who, why); }
/** The accounts head's answer to a request. Returns why it could not be done, or ''. */
function gpoDecideAsk(po, who, approve, reason) {
  var ask = po.closeAsk;
  if (!ask) return 'No close request is waiting on ' + po.poNo + '.';
  if (!approve && !String(reason || '').trim()) return 'Type why the close is turned down, so the store knows.';
  delete po.closeAsk;
  if (approve) { gpoClose(po, who, 'asked by ' + (ask.by || 'the store') + ' on challan ' + (ask.challan || '—') + ', approved'); return ''; }
  po.closeDown = { at: new Date().toISOString(), by: who || '', reason: String(reason).trim(), askedBy: ask.by || '' };
  gpoLog(po, 'close turned down', who, String(reason).trim());
  return '';
}
/** The "last challan" tick on a saved challan: accounts close the PO, anyone else asks. Returns the words for the message. */
function poLastChallan(po, no, who) {
  if (canPoClose()) return po.poNo + ' closed with ' + nf(gpoClose(po, who, 'on challan ' + no)) + ' m not supplied.';
  gpoAskClose(po, who, no);
  return 'Accounts are asked to close ' + po.poNo + '; until then it stays open.';
}

/* ---- the buttons ---- */
var NOT_ACCOUNTS = 'Closing, cancelling and reopening a greige PO is for the accounts department. Ask them to do it.';
/** Close the PO / Reopen the PO (each asks for a second press). */
function poCloseToggle(no, btn) {
  var po = poFind(no); if (!po) return;
  if (!canPoClose()) { lmSay('warn', NOT_ACCOUNTS); return; }
  var who = meUser().name;
  if (po.closed) {
    if (!armed(btn, 'Press again to reopen ' + po.poNo)) return;
    gpoReopen(po, who); lmSaveDb(); render();
    lmSay('ok', po.poNo + ' is open again: ' + nf(gpoProgress(po).pending) + ' m due.');
    return;
  }
  var due = gpoProgress(po).pending;
  if (!armed(btn, 'Press again to close with ' + nf(due) + ' m not supplied')) return;
  gpoClose(po, who, 'by hand'); lmSaveDb(); render();
  lmSay('ok', po.poNo + ' closed. ' + nf(due) + ' m was not supplied.');
}
/** Cancel the PO / Undo cancel (each asks for a second press). */
function poCancelToggle(no, btn) {
  var po = poFind(no); if (!po) return;
  if (!canPoClose()) { lmSay('warn', NOT_ACCOUNTS); return; }
  var who = meUser().name, undo = gpoStatus(po) === 'cancelled';
  if (!armed(btn, undo ? 'Press again to bring ' + po.poNo + ' back' : 'Press again to cancel ' + po.poNo)) return;
  if (undo) { gpoUncancel(po, who); lmSaveDb(); render(); lmSay('ok', po.poNo + ' is back: ' + nf(gpoProgress(po).pending) + ' m due.'); return; }
  var why = gpoCancel(po, who);
  if (why) { lmSay('warn', why); return; }
  lmSaveDb(); render(); lmSay('ok', po.poNo + ' cancelled. It no longer counts as due.');
}
/** The accounts head approves a close request, or turns it down with the reason typed beside it. */
function poAskDecide(no, approve, btn) {
  var po = poFind(no); if (!po) return;
  if (!canPoApprove()) { lmSay('warn', 'Only the accounts head approves closing a PO.'); return; }
  var reason = approve ? '' : (($('pkr-' + po.id) || {}).value || '');
  if (!approve && !String(reason).trim()) { lmSay('warn', 'Type why the close is turned down, so the store knows.'); return; }
  if (!approve && !armed(btn, 'Press again to turn it down')) return;
  var why = gpoDecideAsk(po, meUser().name, approve, reason);
  if (why) { lmSay('warn', why); return; }
  lmSaveDb(); render();
  lmSay(approve ? 'ok' : 'warn', approve ? po.poNo + ' closed. ' + nf(gpoNotSupplied(po)) + ' m was not supplied.'
    : 'Turned down: ' + po.poNo + ' stays open. The reason is on the PO.');
}
/** The requests waiting for the accounts head, the same card as RFD receipts waiting for approval. */
function closeAsksHtml() {
  var list = (DB.gpo || []).filter(function (po) { return po.closeAsk; });
  if (!list.length) return '';
  return '<div class="card approvals"><div class="kpihead"><span class="kpiname">POs the store asked to close</span><span class="kpiwhen">the last challan is in</span></div>'
    + '<div class="box scroll"><table class="ct li"><thead><tr><th>PO</th><th>Supplier</th><th>Last challan</th><th class="num">Not supplied</th><th>Asked by</th><th></th></tr></thead><tbody>'
    + list.map(function (po) {
      var a = po.closeAsk, id = esc(po.id), no = esc(po.poNo);
      return '<tr><td class="tl b">' + no + '</td><td class="tl">' + esc(po.mill) + '</td><td class="tl mono">' + esc(a.challan || '—') + '</td>'
        + '<td class="num"><b class="due">' + nf(gpoProgress(po).pending) + ' m</b></td>'
        + '<td class="tl">' + esc(a.by || '') + '<div class="sub">' + esc(fmtD(lmToday(a.at))) + '</div></td>'
        + '<td>' + (canPoApprove()
          ? '<div class="actions"><button type="button" class="jw-btn jw-wa" data-pask="' + no + '|ok">Approve</button>'
            + '<input id="pkr-' + id + '" aria-label="Why the close of ' + no + ' is turned down" placeholder="Why not (needed to turn down)" style="min-width:180px">'
            + '<button type="button" class="jw-btn" id="pkd-' + id + '" data-pask="' + no + '|no">Turn down</button></div>'
          : '<span class="muted">for the accounts head</span>') + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
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
    /* the standard terms & conditions from the PO settings fill in; they can be changed for this PO (Ravi, 21 Nov) */
    PO_DRAFT = { poNo: gpoNewNo(), date: lmToday(), mill: '', pay: '', disp: '', dest: '', terms: '', other: '', tc: (DB.co || {}).terms || '', lines: [], editId: null };
    poAddLine();
  }
  $('poTc').value = PO_DRAFT.tc || '';
  $('poTitle').textContent = src ? 'Edit ' + src.poNo : 'New greige PO';
  $('poNo').value = PO_DRAFT.poNo;
  $('poDate').value = PO_DRAFT.date;
  $('poMill').value = PO_DRAFT.mill || '';
  ['pay', 'disp', 'dest', 'terms', 'other'].forEach(function (k) { $('po' + k.charAt(0).toUpperCase() + k.slice(1)).value = PO_DRAFT[k] || ''; });
  var locked = !!(src && gpoProgress(src).received > 0);
  $('poMill').readOnly = locked;
  $('poMillLock').textContent = locked ? 'Greige has come from this supplier on this PO, so the supplier stays.' : '';
  $('poMore').open = false;
  $('poMills').innerHTML = '';
  $('poMill').removeAttribute('list');   // the desk's own search list instead of the browser's
  PO_MILL_HI = 0; poMillListClose();
  /* the last PO's supplier as grey sample text, a reminder only — the supplier is still picked (Vishesh, 23 Nov) */
  gdSample($('poMill'), gpoLastMill(), gpoLastMill() || 'Pick a supplier from the list');   // Tab in the empty box takes the last supplier
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
  if (!gpoPickedMill(name) && !poMillKept(name)) {
    box.innerHTML = '<span class="err-in">Not a supplier in Master data — pick one from the list. A new supplier is added in Master data first.</span>'; return;
  }
  if (!v) { box.textContent = 'Not in Master data → Suppliers & RFD processors — this PO keeps the name it was saved with.'; return; }
  var bits = [v.email ? 'Mails to ' + v.email : 'no e-mail on record', v.phone ? 'WhatsApp ' + v.phone : 'no phone on record'];
  if (!v.gstin) bits.push('no GSTIN on record');
  box.textContent = bits.join(' · ');
}
/* ---- THE SUPPLIER SEARCH (Vishesh, 23 Nov: "when I type the name of the supplier in the box it should show the matching
 * suppliers as a search box so that I can choose from those") ---- *
 * A list under the box of the Master data suppliers whose name holds what is typed; a click, or ↑ ↓ and Enter, picks one.
 * The browser's own suggestion list did not show inside the desk, so the desk draws its own. */
var PO_MILL_HI = 0;   // which suggestion ↑ ↓ are on
/** The Master data suppliers whose name holds the typed text, in the list's order; all of them when nothing is typed. */
function poMillMatches(typed) {
  var k = String(typed || '').trim().toLowerCase();
  return gpoPickMills().filter(function (n) { return !k || n.toLowerCase().indexOf(k) >= 0; });
}
/** The list under the supplier box, made the first time it is needed. */
function poMillListBox() {
  var have = $('poMillList'); if (have && have.id) return have;
  var box = document.createElement('div'), inp = $('poMill');
  box.id = 'poMillList'; box.hidden = true; box.setAttribute('role', 'listbox');
  box.style.cssText = 'position:absolute;left:0;right:0;z-index:5;background:var(--card);border:1px solid var(--line);border-radius:var(--r-sm);box-shadow:var(--sh-2);max-height:240px;overflow:auto';
  inp.parentNode.style.position = 'relative';
  inp.parentNode.insertBefore(box, inp.nextSibling);
  /* mousedown, not click: a click comes after the box has lost focus and closed the list */
  box.addEventListener('mousedown', function (ev) {
    var o = ev.target.closest ? ev.target.closest('[data-pomill]') : null; if (!o) return;
    ev.preventDefault(); poMillPick(o.getAttribute('data-pomill'));
  });
  return box;
}
function poMillListDraw() {
  var box = poMillListBox(), inp = $('poMill');
  if (inp.readOnly) { box.hidden = true; return; }
  box.style.top = ((inp.offsetTop || 0) + (inp.offsetHeight || 0) + 4) + 'px';   // right under the box, above the note under it
  var list = poMillMatches(inp.value), k = inp.value.trim();
  PO_MILL_HI = Math.max(0, Math.min(PO_MILL_HI, list.length - 1));
  var mark = function (n) {
    var at = k ? n.toLowerCase().indexOf(k.toLowerCase()) : -1;
    return at < 0 ? esc(n) : esc(n.slice(0, at)) + '<b>' + esc(n.slice(at, at + k.length)) + '</b>' + esc(n.slice(at + k.length));
  };
  box.innerHTML = list.length
    ? list.map(function (n, i) {
      return '<div data-pomill="' + esc(n) + '" role="option" aria-selected="' + (i === PO_MILL_HI) + '" style="padding:8px 12px;cursor:pointer;font-size:13px'
        + (i === PO_MILL_HI ? ';background:var(--brand-bg);color:var(--brand-ink)' : '') + '">' + mark(n) + '</div>';
    }).join('')
    : '<div style="padding:8px 12px;font-size:12.5px;color:var(--muted)">No supplier in Master data matches "' + esc(k) + '". A new supplier is added in Master data first.</div>';
  box.hidden = false;
}
function poMillListClose() { var b = $('poMillList'); if (b && b.id) b.hidden = true; }
function poMillPick(name) { $('poMill').value = name; poMillListClose(); poMillHint(); }
/** ↑ ↓ move through the list, Enter picks, Esc closes the list (not the PO). Returns whether the key was used. */
function poMillKey(key) {
  var box = $('poMillList'), open = !!(box && box.id && !box.hidden), list = poMillMatches($('poMill').value);
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (open) PO_MILL_HI = (PO_MILL_HI + (key === 'ArrowDown' ? 1 : -1) + list.length) % Math.max(1, list.length);
    poMillListDraw(); return true;
  }
  if (key === 'Enter' && open && list.length) { poMillPick(list[PO_MILL_HI] || list[0]); return true; }
  if (key === 'Escape' && open) { poMillListClose(); return true; }
  return false;
}
/** An open PO being changed keeps the supplier it was saved with, even one Master data no longer has. */
function poMillKept(name) {
  var was = PO_DRAFT && PO_DRAFT.editId ? (DB.gpo || []).filter(function (p) { return p.id === PO_DRAFT.editId; })[0] : null;
  return !!was && String(was.mill || '').trim().toLowerCase() === String(name || '').trim().toLowerCase();
}
/* TAB TAKES THE GREY SAMPLE (Ravi, 25 Nov: "when it is showing something in grey I want you to auto fill when I click tab … for
 * all the boxes with similar feature"). A box whose grey text is a real value the app worked out -- the last supplier, the last
 * rate, the metres still due on a PO -- carries it in data-tabfill; Tab in the EMPTY box writes it in and moves on as Tab does.
 * Grey text that is only an example or a limit ("Optional", "As printed on the challan", "up to 300") carries nothing and is left
 * alone. A box somebody typed in is never touched. The box is told with input and change events, so whatever follows typing
 * (the supplier's note, the row's amount) follows this too. */
function gdSample(el, value, shown) {
  if (!el) return;
  var v = value == null ? '' : String(value);
  if (shown != null) el.placeholder = shown; else if (v) el.placeholder = v;
  if (el.setAttribute && el.removeAttribute) { if (v) el.setAttribute('data-tabfill', v); else el.removeAttribute('data-tabfill'); }
}
/** The value Tab would write into this box now: its sample when the box is empty, else ''. */
function gdTabFillOf(el) {
  if (!el || !el.getAttribute || el.readOnly || el.disabled || String(el.value || '') !== '') return '';
  return el.getAttribute('data-tabfill') || '';
}
function gdTabFillKey(ev) {
  if (ev.key !== 'Tab' || ev.shiftKey) return;
  var el = ev.target, v = gdTabFillOf(el); if (!v) return;
  el.value = v;
  ['input', 'change'].forEach(function (t) { try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) { /* the value is in the box all the same */ } });
}
/* THE LAST RATE AS A SAMPLE (Vishesh, 23 Nov): an empty rate box shows, in grey, the rate that greige was last bought at on a PO
 * here (invRate), or 0 when it never was. It is a reference only — a rate must still be put in — but Tab in the empty box takes it. */
function poRateSample(greige) { var r = invRate(greige); return r ? r.rate : 0; }
/** Tab in an empty rate box: the sample rate goes in. Returns whether it did (nothing when there is no earlier rate). */
function poRateTab(i) {
  var l = PO_DRAFT && PO_DRAFT.lines[i]; if (!l || String(l.rate || '').trim() !== '') return false;
  var r = poRateSample(l.greige); if (!(r > 0)) return false;
  l.rate = String(r);
  return true;
}
function poAddLine() {
  var first = gpoFabrics()[0], rfd = first ? first.rfd : '';
  PO_DRAFT.lines.push({ rfd: rfd, greige: first ? first.greige : '', desc: 'RFD ready: ' + rfd, descAuto: true,
    due: PO_DRAFT.date || lmToday(), metres: '', rate: '', disc: '', _rec: 0 });
  poDraw();
}
function poDraw() {
  var opts = gpoFabrics();
  $('poLines').innerHTML = th(['Greige fabric *', 'Description · RFD ready fabric', 'Due on *', 'Metres *', 'Rate *', 'Disc %', 'Amount', ''], [3, 4, 5, 6])
    + '<tbody>' + PO_DRAFT.lines.map(function (l, i) {
      var m = gpoLineMoney(l), spec = mstSpecLine(mstOf(l.rfd)), rec = +l._rec || 0;
      return '<tr data-row="' + i + '"><td class="frz" style="text-align:left">'
        + '<select data-li="' + i + '" data-f="greige" style="width:200px" aria-label="Greige fabric"' + (rec > 0 ? ' disabled title="Greige has come on this line, so its fabric stays."' : '') + '>'
        + opts.map(function (o) {
          return '<option value="' + esc(o.greige) + '"' + (o.greige === l.greige ? ' selected' : '') + '>' + esc(o.greige) + '</option>';
        }).join('') + '</select>'
        + '</td>'
        /* THE RFD NAME IS READ, NOT TYPED: it comes from the fabric pair in Master data. */
        + '<td style="text-align:left"><div class="frozen" title="Set by Master data">' + esc(lineRfdText(l)) + '</div>'
        + (spec ? '<div class="muted" style="font-size:10.5px;margin-top:3px">' + esc(spec) + '</div>' : '') + '</td>'
        + '<td><input data-li="' + i + '" data-f="due" type="date" value="' + esc(l.due) + '" min="' + esc(PO_DRAFT.date) + '" style="width:138px" aria-label="Due on"></td>'
        + '<td><input data-li="' + i + '" data-f="metres" type="text" inputmode="decimal" autocomplete="off" data-num="7" value="' + esc(l.metres) + '" style="width:104px" aria-label="Metres">'
        + (rec > 0 ? '<div class="muted" style="font-size:10.5px;margin-top:3px">' + nf(rec) + ' m already in</div>' : '') + '</td>'
        + '<td><input data-li="' + i + '" data-f="rate" type="text" inputmode="decimal" autocomplete="off" data-num="7" value="' + esc(l.rate) + '" placeholder="' + esc(String(poRateSample(l.greige))) + '"'
        + ' title="' + esc(invRate(l.greige) ? 'Last bought at ' + RUPEE + ' ' + invRate(l.greige).rate + ' on ' + invRate(l.greige).poNo + ' — Tab takes it' : 'Not bought on a PO here before') + '" style="width:84px" aria-label="Rate"></td>'
        + '<td><input data-li="' + i + '" data-f="disc" type="text" inputmode="decimal" autocomplete="off" data-num="' + PCT_WHOLE_DIGITS + '" value="' + esc(l.disc == null ? '' : l.disc) + '" placeholder="0" style="width:64px" aria-label="Discount percent"></td>'
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
  var typed = $('poMill').value.trim();
  if (typed && !gpoPickedMill(typed) && !poMillKept(typed)) {
    $('lmPoErr').textContent = '"' + typed + '" is not a supplier in Master data. Pick one from the list (a new supplier is added in Master data first).';
    $('lmPoErr').classList.remove('hide'); return;
  }
  PO_DRAFT.mill = gpoPickedMill(typed) || typed;
  ['pay', 'disp', 'dest', 'terms', 'other'].forEach(function (k) {
    PO_DRAFT[k] = $('po' + k.charAt(0).toUpperCase() + k.slice(1)).value.trim();
  });
  PO_DRAFT.tc = $('poTc').value.trim();   // optional; its line breaks are kept
  var err = gpoCheck(PO_DRAFT);
  if (!err) {
    PO_DRAFT.lines.some(function (l) {
      if (!l.due) { err = 'Put a due date on ' + l.greige + '.'; return true; }
      if (String(l.disc || '').trim() !== '' && !(parseFloat(l.disc) >= 0 && parseFloat(l.disc) <= 100)) { err = 'The discount on ' + l.greige + ' has to be between 0 and 100%.'; return true; }
      if (+l._rec > 0 && (parseFloat(l.metres) || 0) < +l._rec - 0.05) { err = nf(l._rec) + ' m of ' + l.greige + ' has already come in, so the line cannot be less than that.'; return true; }
      return false;
    });
  }
  if (err) { $('lmPoErr').textContent = err; $('lmPoErr').classList.remove('hide'); return; }
  if (gdPpcAskPending(after)) return;
  var po = JSON.parse(JSON.stringify(PO_DRAFT));
  delete po.ppcAsk;
  po.lines.forEach(function (l) { delete l.descAuto; delete l._rec; if (!(parseFloat(l.disc) > 0)) delete l.disc; });
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
    + (po.lines || []).map(function (l, i) { return (i + 1) + '. ' + lineGreigeText(l) + ' - ' + nf(l.metres) + ' m @ ' + RUPEE + money(l.rate) + (gpoDiscPct(l) ? ' less ' + money(gpoDiscPct(l)) + '%' : '') + ', due ' + fmtD(l.due || po.date); }).join(NL) + NL
    + 'Total ' + nf(t.metres) + ' m, ' + RUPEE + ' ' + money(t.amount) + NL + NL
    + 'Kindly confirm receipt and the delivery date.' + NL + (co.name || '');
}
function poWaUrl(po) {
  var v = venByName(po.mill), d = String((v && v.phone) || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  return 'https://wa.me/' + (d.length >= 11 ? d : '') + '?text=' + encodeURIComponent(poWaText(po));
}

/* ---- WHAT THE PERSON AT THE KEYBOARD MAY DO: read from meUser() (their own login's rights, further down) ---- */
var canLedger = function () { return meUser().ledger !== 'none'; };
var canLedgerEdit = function () { return meUser().ledger === 'edit'; };
var canApprove = function () { return !!meUser().approve; };
var isAdmin = function () { return meUser().role === 'Admin'; };
var LEDGER_LABEL = { none: 'No access', view: 'View only', edit: 'View & edit' };
/* ---- ISSUE TO RFD, FROM THE PO, BALE BY BALE (Ravi, 13 Oct: "make issue to RFD on the basis of bales") ---- *
 * The bales of a lot are the ones its challan brought in. Ticking bales is what goes out; the metres are the
 * bales' own (as the supplier's challan wrote them). A bale that has gone is not offered again. Older issues
 * that named only metres are taken off the first bales of the lot. A lot that came without bales is sent by metres. */
var ISS = null;
function issLotsOf(po) {
  return fabLots().filter(function (g) { return String(g.poNo).toUpperCase() === String(po.poNo).toUpperCase() && g.greigeLeft > 0.05; });
}
/* PART OF A BALE CAN GO (Ravi, 25 Nov: "a bale of 300 m, you can also send 200 m and it will show 100 m in the greige store").
 * An issue row keeps what it took from each bale in baleM = { <bale no.>: metres }; `bales` stays the list of the bales it took
 * from (older rows have only that, and took the whole bale). A bale is offered with what is left of it, until nothing is. */
function lotBales(lot) {
  var all = [];
  (DB.fab || []).forEach(function (r) { if (r.lot === lot && r.txnType === 'RECEIVE_GREIGE' && fabCounts(r)) (r.pieces || []).forEach(function (p) { all.push({ than: String(p.than), m: +p.m || 0, full: +p.m || 0 }); }); });
  var gone = {}, took = {}, legacy = 0;
  (DB.fab || []).forEach(function (r) {
    if (r.lot !== lot || r.txnType !== 'ISSUE_TO_RFD' || !fabCounts(r)) return;
    if (r.baleM) Object.keys(r.baleM).forEach(function (t) { took[t] = (took[t] || 0) + (+r.baleM[t] || 0); });
    else if (Array.isArray(r.bales) && r.bales.length) r.bales.forEach(function (t) { gone[String(t)] = 1; }); else legacy += fabQty(r);
  });
  var left = all.filter(function (b) { return !gone[b.than]; }).map(function (b) { b.m = r1(b.m - (took[b.than] || 0)); return b; }).filter(function (b) { return b.m > 0.05; });
  while (legacy > 0.05 && left.length) { legacy -= left[0].m; left.shift(); }
  return left;
}
/** The metres going from one ticked bale: what was typed, else all that is left of it. */
function issBaleM(lot, b) { var v = (ISS.bq || {})[lot + '|' + b.than]; return v == null || v === '' ? b.m : (parseFloat(v) || 0); }
/** '' when the metres typed for a ticked bale can go; else why not. */
function issBaleErr(lot, b) {
  var m = issBaleM(lot, b);
  if (!(m > 0)) return 'Bale ' + b.than + ': type the metres to send.';
  if (m > b.m + 0.05) return 'Bale ' + b.than + ' has only ' + m1(b.m) + ' m. Send ' + m1(b.m) + ' m or less from it, and tick another bale for the rest.';
  return '';
}
function issOpen(no, onlyLot) {
  var po = poFind(no); if (!po) return;
  var lots = issLotsOf(po).filter(function (g) { return !onlyLot || g.lot === onlyLot; });
  if (!lots.length) { lmSay('warn', 'No greige from ' + po.poNo + ' is in the store to send.'); return; }
  ISS = { po: po.poNo, pick: {}, qty: {}, bq: {}, only: onlyLot || '' };
  lots.forEach(function (g) { ISS.pick[g.lot] = {}; ISS.qty[g.lot] = ''; });
  $('issTitle').textContent = 'Issue to RFD · ' + po.poNo;
  $('issProc').innerHTML = '<option value="">Choose the RFD processor…</option>' + lmProcessors().map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('');
  $('issDate').value = lmToday(); $('issNo').value = rfdChNewNo(); $('issRem').value = ''; $('issRate').value = '';
  /* THE LR NUMBER COMES WITH THE GREIGE (Ravi, 25 Nov: "auto filled from the greige order lr that was filled while receiving"):
   * the LR typed on the supplier's challan when these lots were received, each once. It can still be changed. */
  $('issLr').value = uniq((DB.fab || []).filter(function (r) { return r.txnType === 'RECEIVE_GREIGE' && ISS.pick[r.lot] && String(r.lr || '').trim(); })
    .map(function (r) { return String(r.lr).trim(); })).join(', ');
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
    if (bales.length) { issPicked(lot).forEach(function (b) { m += issBaleM(lot, b); n++; }); } else m += parseFloat(ISS.qty[lot]) || 0;
  });
  return { m: r1(m), n: n };
}
function issDraw() {
  var po = poFind(ISS.po), lots = issLotsOf(po).filter(function (g) { return !ISS.only || g.lot === ISS.only; });
  $('issLots').innerHTML = lots.map(function (g) {
    var bales = lotBales(g.lot), sel = ISS.pick[g.lot] || (ISS.pick[g.lot] = {});
    var picked = bales.filter(function (b) { return sel[b.than]; }), pm = r1(picked.reduce(function (s, b) { return s + issBaleM(g.lot, b); }, 0));
    var bad = picked.map(function (b) { return issBaleErr(g.lot, b); }).filter(Boolean);
    var head = '<div class="dl-top"><div><b class="mono">' + esc(g.lot) + '</b> · ' + esc(g.fabricType) + ' → RFD ' + esc(fabRfdOfGreige(g.fabricType))
      + '<div class="sub">' + nf(g.greigeIn) + ' m received' + (g.toRfd ? ', ' + nf(g.toRfd) + ' m sent already' : '') + ' · <b>' + nf(g.greigeLeft) + ' m in store</b></div></div>';
    if (!bales.length) {
      return '<div class="dl">' + head + '</div><label class="fld" style="max-width:220px"><span>Metres to send * (this lot came without bales)</span>'
        + '<input type="text" inputmode="decimal" autocomplete="off" data-num="7" data-issqty="' + esc(g.lot) + '" value="' + esc(ISS.qty[g.lot]) + '"></label></div>';
    }
    return '<div class="dl">' + head + '<div class="row"><button type="button" class="jw-btn" data-issall="' + esc(g.lot) + '">' + (picked.length === bales.length ? 'Clear all' : 'All ' + bales.length + ' bales') + '</button></div></div>'
      + '<div class="balegrid">' + bales.map(function (b) {
        var on = !!sel[b.than];
        return '<label class="bale' + (on ? ' on' : '') + '"><input type="checkbox" data-issbale="' + esc(g.lot) + '|' + esc(b.than) + '"' + (on ? ' checked' : '') + '>'
          + '<span>Bale ' + esc(b.than) + '</span><b>' + m1(b.m) + ' m' + (b.m < b.full - 0.05 ? ' <span class="sub" style="font-weight:400">left of ' + m1(b.full) + '</span>' : '') + '</b>'
          /* the metres to send from this bale: all of it unless less is typed */
          + (on ? '<input type="text" inputmode="decimal" autocomplete="off" data-num="7" data-issbq="' + esc(g.lot + '|' + b.than) + '" value="' + esc(ISS.bq[g.lot + '|' + b.than] == null ? m1(b.m).replace(/,/g, '') : ISS.bq[g.lot + '|' + b.than]) + '" aria-label="Metres to send from bale ' + esc(b.than) + '" title="Metres to send from this bale; the rest stays in the greige store" style="width:86px;height:30px;margin-left:6px">' : '')
          + '</label>';
      }).join('') + '</div>'
      + '<div id="issbad-' + esc(g.lot) + '" class="' + (bad.length ? 'err' : 'hide') + '" style="margin-top:8px">' + bad.map(esc).join('<br>') + '</div>'
      + '<div class="dl-actions"><span class="dl-sum" id="isssum-' + esc(g.lot) + '">' + plural(picked.length, 'bale') + ' · ' + m1(pm) + ' m</span></div></div>';
  }).join('');
  var t = issTotals();
  $('issTot').innerHTML = 'Going out: <b>' + plural(t.n, 'bale') + ' · ' + m1(t.m) + ' m</b>';
}
function issSave() {
  var po = poFind(ISS.po), proc = $('issProc').value.trim(), date = lmToday(), errs = [], rows = [];   // issued today, whatever the box says
  var rateTxt = $('issRate').value.trim(), rate = rateTxt === '' ? 0 : parseFloat(rateTxt);
  if (rateTxt !== '' && !(rate > 0)) { $('issErr').textContent = 'The processing rate is a number above 0, or leave it blank.'; $('issErr').classList.remove('hide'); return; }
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
    var bad = picked ? picked.map(function (b) { return issBaleErr(g.lot, b); }).filter(Boolean) : [];
    if (bad.length) { bad.forEach(function (x) { errs.push(g.lot + ' · ' + x); }); return; }
    var q = picked ? r1(picked.reduce(function (s, b) { return s + issBaleM(g.lot, b); }, 0)) : (parseFloat(ISS.qty[g.lot]) || 0);
    if (!(q > 0)) return;
    var e = { txnType: 'ISSUE_TO_RFD', date: date, lot: g.lot, fabric: g.fabricType, qty: q, party: proc, bill: $('issNo').value.trim(), remark: $('issRem').value.trim() };
    var err = fabEntryCheck(e); if (err) { errs.push(err); return; }
    var row = { id: uid(), date: date, lot: g.lot, fabricType: g.fabricType, txnType: 'ISSUE_TO_RFD', qty: q, party: proc,
      bill: e.bill, orderNo: po.poNo, done: false, by: meUser().name };
    if (picked) { row.bales = picked.map(function (b) { return b.than; }); row.baleM = {}; picked.forEach(function (b) { row.baleM[b.than] = r1(issBaleM(g.lot, b)); }); }
    if (e.remark) row.remark = e.remark;
    if ($('issLr').value.trim()) row.lr = $('issLr').value.trim();   // the transporter's LR number, when the greige goes by transport
    if (rate > 0) row.rate = rate;                                    // the processor's charge per metre, for the RFD PO
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
  rfdPoShow(rows[0].bill);   // the RFD PO for the processor, ready to print or send
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
  /* the width starts as the cloth's RFD width from Master data; it can be typed smaller (Vishesh, 23 Nov) */
  var rfdW = parseFloat((mstOf(cutRfdOf(g)) || {}).rfdWidth) || 0;
  CUT = { lot: lot, pick: {}, qty: '', lines: cutLinesFor(cutRfdOf(g)), lpick: {}, mode: 'products', w: rfdW ? String(rfdW) : '', l: '', p: '' };
  $('cutTitle').textContent = 'Send to cutting · ' + lot;
  $('cutDate').value = lmToday(); $('cutTo').value = ''; $('cutRem').value = '';
  $('cutErr').classList.add('hide');
  cutDraw();
  $('lmCut').classList.remove('hide');
}
/** The RFD fabric a lot's cloth is, by the name the flow and PPC use. */
function cutRfdOf(g) { return g.rfdFabric || fabRfdOfGreige(g.fabricType) || g.fabricType; }
function cutDraw() {
  var g = fabLot(CUT.lot), thans = lotThans(CUT.lot), rfd = cutRfdOf(g);
  $('cutErr').classList.add('hide');   // a tick changed: the last refusal may no longer be true
  ctsModeDraw();
  if (CUT.mode === 'size') { ctsDraw(g, rfd); return; }
  var head = '<div class="dl-top"><div><b class="mono">' + esc(CUT.lot) + '</b> · RFD <b>' + esc(rfd) + '</b>'
    + '<div class="sub">' + (g.poNo ? esc(g.poNo) + ' · ' : '') + (g.processor ? 'from ' + esc(g.processor) + ' · ' : '') + '<b>' + nf(g.rfdLeft) + ' m on the shelf</b></div></div>';
  if (!thans.length) {
    $('cutBody').innerHTML = cutLinesHtml() + '<div class="dl">' + head + '</div><label class="fld" style="max-width:240px"><span>Metres to cutting * (this lot has no thans listed)</span>'
      + '<input type="text" inputmode="decimal" autocomplete="off" data-num="7" data-cutqty="1" value="' + esc(CUT.qty) + '"></label></div>';
    $('cutTot').innerHTML = cutTotHtml(parseFloat(CUT.qty) || 0, '');
    return;
  }
  var picked = thans.filter(function (t) { return CUT.pick[t.than]; }), pm = r1(picked.reduce(function (s, t) { return s + t.m; }, 0));
  $('cutBody').innerHTML = cutLinesHtml() + '<div class="dl">' + head + '<div class="row"><button type="button" class="jw-btn" data-cutall="1">' + (picked.length === thans.length ? 'Clear all' : 'All ' + thans.length + ' thans') + '</button></div></div>'
    + '<div class="balegrid">' + thans.map(function (t) {
      var on = !!CUT.pick[t.than];
      return '<label class="bale' + (on ? ' on' : '') + '"><input type="checkbox" data-cutthan="' + esc(t.than) + '"' + (on ? ' checked' : '') + '><span>Than ' + esc(t.than) + '</span><b>' + m1(t.m) + ' m</b></label>';
    }).join('') + '</div></div>';
  $('cutTot').innerHTML = cutTotHtml(pm, plural(picked.length, 'than') + ' · ');
}
/* ---- THE PRODUCTS THE CLOTH GOES FOR (Ravi, 21 Nov: "Link it to the lines") ----
 * Above the thans: the no-printing lines of this fabric still waiting for cloth, or marked ready and not cut (the flow's
 * flowCutLines). Ravi's rules: at least one line is ticked, and the ticked thans cover the ticked lines -- the extra goes
 * with them, less is refused. The save takes the thans off the shelf and marks those lines' fabric ready in ONE write, so
 * the shelf and the lines never disagree; the lines then show on Cutting Data with the lot.
 * Errors: the save is stock, so it is refused out loud in the window; the list loads quietly ("Loading…") and a failed
 * read goes to the console. Inside the ERP only -- run on its own the desk has no production flow, so no line to tick. */
function cutLinesFor(rfd) {
  if (typeof flowCutLines !== 'function') return [];
  if (!gdFlowReady()) {
    if (typeof flowEnsureData === 'function') flowEnsureData().then(function () { if (CUT) { CUT.lines = cutLinesFor(rfd); cutDraw(); } },
      function (e) { console.warn('Send to cutting: the products waiting for ' + rfd + ' could not be read', e); });
    return null;
  }
  return flowCutLines(rfd);
}
function cutLinesPicked() { return (CUT.lines || []).filter(function (l) { return CUT.lpick[l.key]; }); }
function cutLinesNeed(lines) { return r1(lines.reduce(function (s, l) { return s + (+l.metres || 0); }, 0)); }
function cutLinesHtml() {
  if (CUT.lines === null) return '<div class="dl"><div class="sub">Loading the products waiting for this cloth…</div></div>';
  if (!CUT.lines.length) return '<div class="dl"><div class="sub">No product on the no-printing route is waiting for this fabric, so nothing can go to cutting. Plan the line in PPC first.</div></div>';
  return '<div class="dl"><div class="b" style="margin-bottom:6px">For these products *</div><table class="ct mini"><thead><tr><th></th><th>Order</th><th>SKU</th><th class="num">Pcs</th><th class="num">Needs</th></tr></thead><tbody>'
    + CUT.lines.map(function (l) {
      return '<tr><td><input type="checkbox" data-cutline="' + esc(l.key) + '"' + (CUT.lpick[l.key] ? ' checked' : '') + ' aria-label="For ' + esc(l.orderNo + ' ' + l.sku) + '"></td>'
        + '<td class="tl b">' + esc(l.orderNo) + (l.ready ? ' <span class="pill pill-sea" title="Fabric already marked ready; its cloth is held on the shelf">ready</span>' : '') + '</td>'
        + '<td class="tl mono">' + esc(l.sku) + '</td><td class="num">' + nf(l.pcs) + '</td><td class="num">' + m1(l.metres) + ' m</td></tr>';
    }).join('') + '</tbody></table></div>';
}
/** The window's bottom line: what the ticked products need against what is going, and the extra or the shortfall. */
function cutTotHtml(going, thans) {
  var need = cutLinesNeed(cutLinesPicked()), gap = r1(going - need);
  return 'For ' + plural(cutLinesPicked().length, 'product') + ': <b>' + m1(need) + ' m</b> · Going to cutting: <b>' + thans + m1(going) + ' m</b>'
    + (need > 0 && gap > 0.05 ? ' · ' + m1(gap) + ' m extra' : '')
    + (gap < -0.05 ? ' · <span style="color:var(--bad);font-weight:700">' + m1(-gap) + ' m short</span>' : '');
}
/** Why this cloth cannot go yet, in the window's words; '' when it can. A lot with no thans listed has its metres typed,
 *  so the refusal speaks of metres, not thans (Ravi's UAT check, 21 Nov). */
function cutLinesCheck(going, byThans) {
  if (CUT.lines === null) return 'The products are still loading. Try again in a moment.';
  var lines = cutLinesPicked(), need = cutLinesNeed(lines);
  if (!lines.length) return 'Tick the products this cloth is for.';
  if (going >= need - 0.05) return '';
  return byThans
    ? 'The thans come to ' + m1(going) + ' m; the ticked products need ' + m1(need) + ' m. Tick another than or fewer products.'
    : m1(going) + ' m is going; the ticked products need ' + m1(need) + ' m. Send more metres or tick fewer products.';
}
/** The flow's side of the save: each ticked line's fabric marked ready, carrying the lot and this entry. The old mark is
 *  kept on the entry (lineWas) so removing the entry puts each line back exactly as it was. */
function cutLinesPatch(row, lines) {
  var patch = {}, at = new Date().toISOString();
  row.lines = lines.map(function (l) { return l.key; });
  row.lineWas = {};
  row.forOrders = uniq(lines.map(function (l) { return l.orderNo; })).join(', ');
  lines.forEach(function (l) {
    row.lineWas[l.key] = l.was || null;
    patch['pt_flowDemand/' + l.key + '/fabricReady'] = { at: at, by: (typeof ME !== 'undefined' && ME && ME.email) || row.by || '', what: row.fabricType, metres: l.metres,
      note: 'Sent to cutting · ' + row.lot, lot: row.lot, cutEntry: row.id };
  });
  return patch;
}
/** Removing a cutting entry: the lines it was for go back to how they were. */
function cutLinesUndoPatch(row) {
  var patch = {};
  (row.lines || []).forEach(function (k) { patch['pt_flowDemand/' + k + '/fabricReady'] = (row.lineWas || {})[k] || null; });
  return patch;
}
/** Keep the flow on this screen in step with what was just written (it reads its own copy, FLOW.dem). */
function cutFlowKeep(patch) {
  if (typeof FLOW === 'undefined' || !FLOW) return;
  var dem = Object.assign({}, FLOW.dem || {});
  Object.keys(patch).forEach(function (p) { var k = p.split('/')[1]; dem[k] = Object.assign({}, dem[k] || {}, { fabricReady: patch[p] }); });
  FLOW.dem = dem;
}
function cutSave() {
  if (CUT.mode === 'size') { ctsSave(); return; }
  var g = fabLot(CUT.lot), thans = lotThans(CUT.lot), date = lmToday();   // issued to cutting today, whatever the box says
  var picked = thans.length ? thans.filter(function (t) { return CUT.pick[t.than]; }) : null;
  var q = picked ? r1(picked.reduce(function (s, t) { return s + t.m; }, 0)) : (parseFloat(CUT.qty) || 0);
  var rfd = cutRfdOf(g), err = '';
  if (!(q > 0)) err = picked ? 'Tick the thans that are going to cutting.' : 'How many metres are going to cutting?';
  else err = cutLinesCheck(q, !!picked) || fabEntryCheck({ txnType: 'ISSUE_TO_CUTTING', date: date, lot: CUT.lot, fabric: rfd, qty: q });
  if (err) { $('cutErr').textContent = err; $('cutErr').classList.remove('hide'); return; }
  var row = { id: uid(), date: date, lot: CUT.lot, fabricType: rfd, txnType: 'ISSUE_TO_CUTTING', qty: q, party: $('cutTo').value.trim() || 'Cutting',
    bill: '', orderNo: g.poNo || '', done: false, by: meUser().name };
  if (picked) row.thans = picked.map(function (t) { return t.than; });
  if ($('cutRem').value.trim()) row.remark = $('cutRem').value.trim();
  var flowPatch = cutLinesPatch(row, cutLinesPicked());
  DB.fab.push(row); lmSaveDb(flowPatch); cutFlowKeep(flowPatch);
  $('lmCut').classList.add('hide');
  lmSay('ok', (picked ? plural(picked.length, 'than') + ', ' : '') + nf(q) + ' m of RFD ' + rfd + ' from ' + CUT.lot + ' sent to cutting for ' + row.forOrders + '.');
  CUT = null; render();
}

/* ---- CUT TO SIZE: CLOTH CUT FROM THE RFD ON THE SHELF WITH NO PRODUCT BEHIND IT (Vishesh, 23 Nov) ----
 * A second way to use the Send to cutting card: type width × length (inches) and pieces, no product needed. The metres
 * are pieces × length × 0.0254. The entry is one ledger row (ISSUE_TO_CUTTING, cutToSize) that waits for the production
 * head or accounts head (right gdcut); until it is approved it counts nowhere (fabCounts), so the metres stay on the RFD
 * shelf. Approved, the metres leave the shelf and the pieces appear in the Inventory's Cut to size column. From there
 * they go to a printer: one RFD challan through the flow's own writer, and one CUT_TO_PRINTER row per lot the pieces
 * came from (oldest lot first), which moves no cloth figure -- only Sent to printer and Left.
 * Errors: asking, approving and sending are stock, so a refusal is said in the card, never swallowed, and nothing is
 * written. A save that fails says "Not saved" (lmSaveDb). The challan is made first; if the desk's rows cannot be saved
 * after it, that same message shows and the pieces still read as left until they are written again.
 * Two approvers at once: the decision is written to that row's approval alone and the desk has no compare-and-set, so
 * the last one to press wins. */
var CTS_INCH_METRES = 0.0254;   // one inch in metres
var CTS_X = '×';
var ctsN = function (n) { return r2(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }); };
var canCutApprove = function () { return gdHas('gdcut'); };
/** Metres of cloth for pieces of one length (inches), to the paisa-style two places. */
function ctsMetres(pcs, length) { return r2(pcs * length * CTS_INCH_METRES); }
/** "60 × 90" for the screen; ctsSizeKey is the same size as the challan and the sums write it. */
function ctsSizeText(s) { return ctsN(+s.w) + ' ' + CTS_X + ' ' + ctsN(+s.l); }
function ctsSizeKey(s) { return ctsN(+s.w) + CTS_X + ctsN(+s.l); }
/** The RFD width of a fabric from Master data, in inches; 0 when nobody has written it. */
function ctsRfdWidth(rfd) { var m = mstOf(rfd); return m ? parseFloat(m.rfdWidth) || 0 : 0; }
/* THE SIZES WE MAKE, NOT TYPED (Ravi, 24 Nov: "change it to a dropdown … those fabrics which we use in production and has size
 * variants available"). The sizes are the products' own: every Master database row whose fabric is this RFD fabric and whose
 * size reads as two numbers. Width is the side that fits the cloth (the first, else the second). A fabric with no such
 * products keeps the typed boxes. [{ key, w, l, n (products), fits }] largest first. */
function ctsSizesOf(rfd) {
  var F = String(rfd || '').trim().toUpperCase(), rw = ctsRfdWidth(rfd), by = {};
  var rows = typeof PTG !== 'undefined' && PTG && Array.isArray(PTG.mdb) ? PTG.mdb : [];
  rows.forEach(function (m) {
    if (!m || m.active === false || String(m.fabric || '').trim().toUpperCase() !== F) return;
    var p = ctsParseSize(m.size); if (!p || !(p[0] > 0) || !(p[1] > 0)) return;
    var w = p[0], l = p[1]; if (rw > 0 && w > rw && l <= rw) { w = p[1]; l = p[0]; }
    var k = ctsSizeKey({ w: w, l: l }), alt = ctsSizeKey({ w: l, l: w }); if (by[alt] && !by[k]) k = alt;
    (by[k] || (by[k] = { key: k, w: w, l: l, n: 0, fits: !(rw > 0) || w <= rw })).n++;
  });
  return Object.keys(by).map(function (k) { return by[k]; })
    .sort(function (a, b) { return (b.fits - a.fits) || (b.w * b.l - a.w * a.l) || a.key.localeCompare(b.key); });
}
/** What asking for this cut would mean: { err, warn, metres }. spec = { rfd, lot, w, l, pcs, date }. err is '' when the cut can be asked. */
function ctsCheck(spec) {
  var out = { err: '', warn: '', metres: ctsMetres(spec.pcs, spec.l) }, rw = ctsRfdWidth(spec.rfd);
  if (!(spec.w > 0) || !(spec.l > 0) || !(spec.pcs > 0)) { out.err = 'Type the width, the length and the pieces.'; return out; }
  if (spec.pcs !== Math.floor(spec.pcs)) { out.err = 'Pieces are whole numbers.'; return out; }
  if (!(rw > 0)) { out.err = 'Put the RFD width of ' + spec.rfd + ' in Master data first.'; return out; }
  if (spec.w > rw) { out.err = spec.rfd + ' is ' + ctsN(rw) + '" wide — a ' + ctsN(spec.w) + '" piece can\'t be cut from it.'; return out; }
  if (spec.w < rw) out.warn = 'Cutting ' + ctsN(spec.w) + '" wide from ' + ctsN(rw) + '" cloth — ' + ctsN(rw - spec.w) + '" of each piece\'s width is left over.';
  out.err = fabEntryCheck({ txnType: 'ISSUE_TO_CUTTING', date: spec.date, lot: spec.lot, fabric: spec.rfd, qty: out.metres });
  return out;
}
/** The three boxes of the open card as numbers. */
function ctsSpec() {
  return { rfd: cutRfdOf(fabLot(CUT.lot)), lot: CUT.lot, w: parseFloat(CUT.w) || 0, l: parseFloat(CUT.l) || 0, pcs: parseFloat(CUT.p) || 0, date: lmToday() };
}
/** The card's choice of way, and the labels that follow it. */
function ctsModeDraw() {
  var size = CUT.mode === 'size';
  $('cutMode').innerHTML = [['products', 'For products waiting'], ['size', 'Cut to size (no product)']].map(function (m) {
    var on = CUT.mode === m[0];
    return '<button type="button" role="tab" class="segbtn' + (on ? ' on' : '') + '" aria-selected="' + on + '" data-ctsmode="' + m[0] + '">' + esc(m[1]) + '</button>';
  }).join('');
  $('cutSect').textContent = size ? 'Pieces to cut' : 'Thans going to cutting';
  $('cutSave').textContent = size ? 'Ask for approval' : 'Send to cutting';
}
function ctsDraw(g, rfd) {
  var rw = ctsRfdWidth(rfd), box = function (id, key, label) {
    return '<div><label for="' + id + '">' + label + '</label><input id="' + id + '" type="text" inputmode="decimal" autocomplete="off" data-num="7" data-ctsbox="' + key + '" value="' + esc(CUT[key]) + '"></div>';
  };
  var sizes = ctsSizesOf(rfd), pick = sizes.length
    ? '<div style="grid-column:span 2"><label for="ctsS">Size (W × L inches) *</label><select id="ctsS" data-ctssize="1"><option value="">Choose a size</option>'
      + sizes.map(function (z) {
        return '<option value="' + esc(z.w + '|' + z.l) + '"' + (z.fits ? '' : ' disabled') + (CUT.sz === z.w + '|' + z.l ? ' selected' : '') + '>'
          + esc(ctsSizeText(z)) + ' · ' + plural(z.n, 'product') + (z.fits ? '' : ' — wider than the cloth') + '</option>';
      }).join('') + '</select></div>'
    : box('ctsW', 'w', 'Width (") *') + box('ctsL', 'l', 'Length (") *');
  $('cutBody').innerHTML = '<div class="dl"><div class="dl-top"><div><b class="mono">' + esc(CUT.lot) + '</b> · RFD <b>' + esc(rfd) + '</b>'
    + '<div class="sub"><b>' + nf(g.rfdLeft) + ' m on the shelf</b>' + (rw ? ' · ' + ctsN(rw) + '" wide' : ' · no RFD width in Master data') + '</div></div></div></div>'
    + '<div class="lm-fields">' + pick + box('ctsP', 'p', 'Pieces *')
    + '<div><label for="ctsM">Metres (worked out)</label><input id="ctsM" readonly title="Pieces × length × 0.0254"></div></div>'
    + '<div id="ctsInfo"></div>'
    + '<div class="lm-why">The metres come off the shelf only when the production head or accounts head approves.</div>';
  $('cutTot').innerHTML = '';
  ctsInfoDraw();
}
/** The metres, and what is wrong or worth knowing about this size, as the boxes are typed. */
function ctsInfoDraw() {
  var c = ctsCheck(ctsSpec()), typed = CUT.w !== '' && CUT.l !== '' && CUT.p !== '', box = $('ctsInfo');
  $('ctsM').value = c.metres > 0 ? ctsN(c.metres) : '';
  box.className = typed && c.err ? 'err' : 'warnline';
  box.textContent = typed ? (c.err || c.warn) : '';
}
function ctsSave() {
  var spec = ctsSpec(), c = ctsCheck(spec), g = fabLot(CUT.lot), by = meUser().name;
  if (c.err) { $('cutErr').textContent = c.err; $('cutErr').classList.remove('hide'); return; }
  var row = { id: uid(), date: spec.date, lot: CUT.lot, fabricType: spec.rfd, txnType: 'ISSUE_TO_CUTTING', qty: c.metres,
    party: $('cutTo').value.trim() || 'Cutting', bill: '', orderNo: g.poNo || '', done: false, by: by,
    size: { w: spec.w, l: spec.l }, pcs: spec.pcs, cutToSize: true,
    approval: { status: 'pending', ask: 'Cut ' + nf(spec.pcs) + ' pcs of ' + ctsSizeText(spec) + ' (' + ctsN(c.metres) + ' m) from RFD ' + spec.rfd + ', lot ' + CUT.lot, by: by, at: new Date().toISOString() } };
  if ($('cutRem').value.trim()) row.remark = $('cutRem').value.trim();
  DB.fab.push(row); lmSaveDb();
  $('lmCut').classList.add('hide');
  lmSay('ok', 'Saved — waits for the production head or accounts head to approve.');
  CUT = null; render();
}

/* ---- how the ledger page shows these rows ---- */
/** What an approval was asked about: the shrinkage of an RFD receipt, or a cut to size. */
function ctsApprovalWhy(r) { return r.cutToSize ? 'cut to size' : r.approval.pct + '% shrinkage'; }
/** The pieces and size on a cut-to-size entry or on cut pieces sent to a printer; '' on every other row. */
function ctsPiecesNote(r) {
  return r.size && r.pcs ? '<div class="sub">' + nf(r.pcs) + ' pcs of ' + esc(ctsSizeText(r.size)) + '</div>' : '';
}
/** These rows are decided from the Inventory (approve, send to printer); the ledger's Edit would drop their size and approval. */
function ctsLedgerLocked(r) { return r.cutToSize === true || r.txnType === 'CUT_TO_PRINTER' || !!r.cutNo; }

/* ---- the entries waiting for the approver, and the decision ---- */
function ctsWaiting() { return (DB.fab || []).filter(function (r) { return r.cutToSize && r.approval && r.approval.status === 'pending'; }); }
/** Approve or refuse one waiting cut. '' when done, else what stopped it. Approving checks the shelf again: the metres may have gone since it was asked. */
function ctsDecide(id, ok, why) {
  var r = (DB.fab || []).filter(function (x) { return x.id === id; })[0];
  if (!r || !r.cutToSize || !r.approval || r.approval.status !== 'pending') return 'This cut is not waiting for approval any more.';
  if (!canCutApprove()) return 'Only the production head or accounts head can approve cutting to size.';
  var g = fabLot(r.lot), now = { ask: r.approval.ask, by: meUser().name, at: new Date().toISOString() };
  if (ok && (!g || fabQty(r) > g.rfdLeft + 1e-9)) {
    return 'Lot ' + r.lot + ' holds ' + ctsN(g ? g.rfdLeft : 0) + ' m of RFD now, less than the ' + ctsN(fabQty(r)) + ' m this cut needs. Refuse it, or approve once more RFD is in.';
  }
  r.approval = Object.assign(now, ok ? { status: 'approved' } : { status: 'refused', why: String(why || '').trim() });
  ctsSaveApproval(r);
  return '';
}
/** Saves the decision as that row's approval field alone, so nothing else on the row is written over. */
function ctsSaveApproval(row) {
  var patch = {};
  if (GD_SNAP && GD_SNAP.fab) GD_SNAP.fab[row.id] = JSON.stringify(row);   // the row is not written whole: only its approval, below
  patch[GD_NODE + '/fab/' + row.id + '/approval'] = JSON.parse(JSON.stringify(row.approval));
  lmSaveDb(patch);
}
function ctsDecideButtons(r) {
  if (!canCutApprove()) return '<span class="muted">for the production head or accounts head</span>';
  return '<div class="actions"><button type="button" class="jw-btn jw-wa" data-ctsdec="' + esc(r.id) + '|ok">Approve</button>'
    + '<button type="button" class="jw-btn" data-ctsdec="' + esc(r.id) + '|no">Refuse</button></div>';
}
/** The cuts waiting for approval, as a card on the Greige POs page beside the RFD receipts waiting for approval. */
function ctsApprovalsHtml() {
  var list = ctsWaiting(); if (!list.length) return '';
  return '<div class="card approvals"><div class="kpihead"><span class="kpiname">Cutting to size waiting for approval</span><span class="kpiwhen">no product behind it</span></div>'
    + '<div class="box scroll"><table class="ct li"><thead><tr><th>RFD fabric</th><th>Lot</th><th>Size (W × L)</th><th class="num">Pieces</th><th class="num">Metres</th><th>Asked by</th><th></th></tr></thead><tbody>'
    + list.map(function (r) {
      return '<tr><td class="tl b">' + esc(r.fabricType) + '</td><td class="tl mono">' + esc(r.lot) + '</td><td class="tl">' + esc(ctsSizeText(r.size)) + '</td>'
        + '<td class="num">' + nf(r.pcs) + '</td><td class="num">' + ctsN(fabQty(r)) + ' m</td>'
        + '<td class="tl">' + esc(r.approval.by || '') + '<div class="sub">' + esc(fmtD(lmToday(r.approval.at))) + '</div></td><td>' + ctsDecideButtons(r) + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
}

/* ---- what is cut, what went to a printer, what is left (the Inventory's Cut to size column) ---- */
/** Every cut-to-size entry of one RFD fabric, whatever its approval says. */
function ctsRowsOf(fabric) {
  var F = String(fabric || '').trim().toUpperCase();
  return (DB.fab || []).filter(function (r) { return r.cutToSize === true && r.txnType === 'ISSUE_TO_CUTTING' && fabLineOf(r).toUpperCase() === F; });
}
/** Cut pieces already sent to a printer, for one RFD fabric. */
function ctsSentRowsOf(fabric) {
  var F = String(fabric || '').trim().toUpperCase();
  return (DB.fab || []).filter(function (r) { return r.txnType === 'CUT_TO_PRINTER' && fabCounts(r) && fabLineOf(r).toUpperCase() === F; });
}
/** One fabric's cut pieces by size: { sizes: [{ key, w, l, cut, cutM, sent, sentM, left, leftM, asks }], leftPcs, leftM, waiting }.
 *  Only approved entries count as cut; a waiting or refused one is listed in asks and moves nothing. */
function ctsOf(fabric) {
  var by = {}, out = { sizes: [], leftPcs: 0, leftM: 0, waiting: 0 };
  var at = function (s) {
    var k = ctsSizeKey(s);
    if (!by[k]) { by[k] = { key: k, w: +s.w, l: +s.l, cut: 0, cutM: 0, sent: 0, sentM: 0, left: 0, leftM: 0, asks: [] }; out.sizes.push(by[k]); }
    return by[k];
  };
  ctsRowsOf(fabric).forEach(function (r) {
    var z = at(r.size);
    if (fabCounts(r)) { z.cut += +r.pcs || 0; z.cutM += fabQty(r); return; }
    z.asks.push(r);
    if (r.approval.status === 'pending') out.waiting++;
  });
  ctsSentRowsOf(fabric).forEach(function (r) { var z = at(r.size); z.sent += +r.pcs || 0; z.sentM += fabQty(r); });
  out.sizes.sort(function (a, b) { return a.w - b.w || a.l - b.l; });
  out.sizes.forEach(function (z) {
    z.left = Math.max(0, z.cut - z.sent); z.leftM = Math.max(0, r2(z.cutM - z.sentM));
    out.leftPcs += z.left; out.leftM = r2(out.leftM + z.leftM);
  });
  return out;
}
/** The Cut to size cell: pieces left, the metres under them, and how many are waiting for approval. Opens the drop-down. */
function invCutCell(r) {
  var c = r.cut, key = r.fabric + '|cut', on = UI.invOpen === key;
  var ch = (r.cutCh || []).filter(function (x) { return x.status === 'cut' || x.status === 'sending'; });
  var pcs = c.leftPcs + ch.reduce(function (a, x) { return a + x.pcs; }, 0), m = r2(c.leftM + ch.reduce(function (a, x) { return a + x.metres; }, 0));
  if (!(pcs > 0) && !c.waiting) return '<td class="num"><span class="muted">&mdash;</span></td>';
  return '<td class="num"><button type="button" class="cellbtn' + (on ? ' on' : '') + '" data-invd="' + esc(key) + '" aria-expanded="' + on + '" title="Show what makes this up">'
    + (pcs > 0 ? nf(pcs) + ' pcs' : '—') + ' <span class="caret">' + (on ? '▴' : '▾') + '</span></button>'
    + (pcs > 0 ? '<div class="sub">' + ctsN(m) + ' m</div>' : '')
    + (c.waiting ? '<div class="sub">' + nf(c.waiting) + ' waiting approval</div>' : '') + '</td>';
}
/** The drop-down's rows: each size with what was cut, sent and is left, then the entries still waiting or refused under it. */
/* SEND TO PRINTER ON EACH SIZE (Vishesh, 23 Nov: "the page is showing pieces but where is the option to send to printer"): a size
 * with pieces left has its own Send to printer in Next step, which opens the card on that size -- the orders waiting for it. */
function ctsDetailRows(c, fabric) {
  var rows = [];
  c.sizes.forEach(function (z) {
    if (z.cut > 0 || z.sent > 0) {
      var send = fabric && z.left > 0 ? '<button type="button" class="jw-btn jw-primary" data-ctssend="' + esc(fabric) + '" data-ctssize="' + esc(z.key) + '" title="Make an RFD challan to a printer for the orders waiting for ' + esc(ctsSizeText(z)) + '">Send to printer</button>' : '';
      rows.push('<tr><td class="tl b">' + esc(ctsSizeText(z)) + '</td><td class="num">' + nf(z.cut) + ' pcs</td><td class="num">' + (z.sent ? nf(z.sent) + ' pcs' : '—') + '</td>'
        + '<td class="num b">' + nf(z.left) + ' pcs<div class="sub">' + ctsN(z.leftM) + ' m</div></td><td class="tl">' + (z.left > 0 ? '<span class="muted">Ready to send</span>' : '<span class="muted">All sent</span>') + '</td><td>' + send + '</td></tr>');
    }
    z.asks.forEach(function (r) { rows.push(ctsAskRow(r)); });
  });
  return rows;
}
function ctsAskRow(r) {
  var waiting = r.approval.status === 'pending', who = esc(r.approval.by || '') + ' · ' + esc(fmtD(lmToday(r.approval.at))) + ' · lot ' + esc(r.lot);
  var status = waiting ? '<span class="pill pill-low">Waiting approval</span><div class="sub">asked by ' + who + '</div>'
    : '<span class="muted">Refused' + (r.approval.why ? ' — ' + esc(r.approval.why) : '') + '</span><div class="sub">' + who + '</div>';
  return '<tr' + (waiting ? '' : ' class="muted" style="opacity:.6"') + '><td class="tl b">' + esc(ctsSizeText(r.size)) + '</td><td class="num muted">' + nf(r.pcs) + ' pcs</td>'
    + '<td class="num muted">—</td><td class="num muted">—</td><td class="tl">' + status + '</td><td>' + (waiting ? ctsDecideButtons(r) : '') + '</td></tr>';
}

/* ---- SEND CUT PIECES TO A PRINTER ---- *
 * Opens over the Inventory (the flow's own dialog): a printer, one cut size, and the Demand → RFD lines of the same fabric and
 * the same size. A line's size is read as two numbers, so "60x60", "60 X 60" and "60×60" are one size, and 60x90 is also 90x60.
 * Pieces per line are not typed: oldest order first, each takes what it still owes while the cut pieces last; untick a line to
 * leave it out. A line PPC planned for another printer is not sent from here -- changing the printer is asked on the Inventory's
 * RFD card -- and is listed with that note. Inside the ERP only: without the production flow there are no lines. */
var CTS_SEND = null;   // the open card: { fabric, size: a size key, off: { line key: true } for the unticked }
var ctsEl = function (id) { return window.document.getElementById(id); };   // the card is the app's dialog, not inside the desk's shadow root
/** The two numbers in a size written any way ("60x60", "60 X 60", "60×60"); null unless there are exactly two. */
function ctsParseSize(text) {
  var m = String(text == null ? '' : text).match(/\d+(?:\.\d+)?/g);
  return m && m.length === 2 ? [parseFloat(m[0]), parseFloat(m[1])] : null;
}
/** True when a written size is W × L, in either order. */
function ctsSizeMatches(text, w, l) {
  var p = ctsParseSize(text);
  return !!p && ((p[0] === w && p[1] === l) || (p[0] === l && p[1] === w));
}
/** The size a PPC line asks for: the line's own, else its master row's. */
function ctsLineSize(x) {
  var own = String((x.r && x.r.size) || '').trim();
  if (own) return own;
  try { return String(((typeof cutSkuOf === 'function' && cutSkuOf(x.r.sku)) || {}).size || ''); } catch (e) { return ''; }
}
/** The lines on Demand → RFD waiting for this fabric in this size, oldest order first, each with the pieces it still owes (the card's own flowShLine). */
function ctsLinesFor(fabric, w, l) {
  if (typeof flowRows !== 'function' || typeof flowShLine !== 'function') return [];
  var F = flowFabKey(fabric);
  var list = flowRows().filter(function (x) {
    if (typeof flowCpActive === 'function' && flowCpActive(x.s.key)) return false;
    return flowInView('drfd', x.s) && x.s.route !== 'stitch' && flowFabKey(((x.s.plan || {}).fabric || {}).name) === F && ctsSizeMatches(ctsLineSize(x), w, l);
  }).map(flowShLine).filter(function (ln) { return ln.pcs > 0; })
    .sort(function (a, b) { return String(a.x.r.orderDate || '').localeCompare(String(b.x.r.orderDate || '')) || String(a.x.r.orderNo).localeCompare(String(b.x.r.orderNo)); });
  if (typeof flowPriSort !== 'function') return list;
  return flowPriSort(list, function (l) { return { orderNo: l.x.r.orderNo, orderDate: l.x.r.orderDate, priority: l.priority }; });
}
/** What would go for this printer: { size, lines, picks: [{ line, pcs, metres }], skipped: [{ line, why }], pcs, metres }. Reads only. */
function ctsSendPlan(S, code) {
  var z = ctsOf(S.fabric).sizes.filter(function (s) { return s.key === S.size; })[0];
  var plan = { size: z || null, lines: [], picks: [], skipped: [], pcs: 0, metres: 0 };
  if (!z) return plan;
  var left = z.left;
  plan.lines = ctsLinesFor(S.fabric, z.w, z.l);
  plan.lines.forEach(function (ln) {
    if (code && ln.printer && String(ln.printer) !== String(code)) { plan.skipped.push({ line: ln, why: 'Planned for ' + (ln.printerName || ln.printer) }); return; }
    if (S.off[ln.key] || left <= 0) return;
    var n = Math.min(ln.pcs, left);
    left -= n; plan.picks.push({ line: ln, pcs: n, metres: ctsMetres(n, z.l) });
    plan.pcs += n; plan.metres = r2(plan.metres + ctsMetres(n, z.l));
  });
  return plan;
}
/** The approved lots of this size with pieces left, oldest first: [{ lot, left }]. */
function ctsLotsLeft(fabric, key) {
  var left = {}, order = [];
  ctsRowsOf(fabric).filter(function (r) { return fabCounts(r) && ctsSizeKey(r.size) === key; })
    .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })
    .forEach(function (r) { if (!(r.lot in left)) { left[r.lot] = 0; order.push(r.lot); } left[r.lot] += +r.pcs || 0; });
  ctsSentRowsOf(fabric).filter(function (r) { return ctsSizeKey(r.size) === key && r.lot in left; })
    .forEach(function (r) { left[r.lot] -= +r.pcs || 0; });
  return order.map(function (lot) { return { lot: lot, left: left[lot] }; }).filter(function (x) { return x.left > 0; });
}
/** The ledger rows for pieces going to a printer: one per lot they come from, oldest lot first. They move no cloth figure. */
function ctsSentRows(fabric, z, pcs, party, challanNo) {
  var rows = [], need = pcs, at = new Date().toISOString();
  ctsLotsLeft(fabric, z.key).forEach(function (L) {
    if (need <= 0) return;
    var n = Math.min(need, L.left); need -= n;
    rows.push({ id: uid(), date: lmToday(), lot: L.lot, fabricType: fabric, txnType: 'CUT_TO_PRINTER', qty: ctsMetres(n, z.l), size: { w: z.w, l: z.l }, pcs: n,
      party: party, bill: challanNo, orderNo: '', done: false, at: at, by: meUser().name });
  });
  return rows;
}
/** The RFD challan for a plan, then the desk's rows. Returns { err } when refused or failed, else { no }. */
async function ctsSendWrite(v, fabric, plan, note) {
  var picks = plan.picks, z = plan.size;
  if (!picks.length) return { err: 'Tick at least one line.' };
  if (picks.some(function (p) { return !!p.line.x.r.__t; }) && picks.some(function (p) { return !p.line.x.r.__t; })) return { err: 'A test order and a real one cannot share a challan.' };
  var orders = uniq(picks.map(function (p) { return p.line.x.r.orderNo; })), vname = v.desc || v.name || v.code;
  var ch = { no: '', date: dToday(), orderNo: orders.join(', '), orders: orders, vendor: { code: v.code, name: vname },
    note: note, at: new Date().toISOString(), by: (typeof ME !== 'undefined' && ME && ME.email) || '', from: 'Greige Desk cut to size',
    lines: picks.map(function (p) {
      var ln = p.line;
      return { key: ln.key, sku: obUC(ln.x.r.sku), item: flowChItem(ln.x.r), print: ln.print, extras: [],
        fabric: ((ln.x.s.plan || {}).fabric || {}).name || fabric, pcs: p.pcs, metres: p.metres, cutSize: ctsSizeKey(z) };
    }) };
  var err = await flowChallanWrite(ch, v, { isTest: picks.every(function (p) { return !!p.line.x.r.__t; }),
    unplanned: picks.filter(function (p) { return !p.line.printer; }).map(function (p) { return p.line.key; }) });
  if (err) return { err: err };
  ctsSentRows(fabric, z, plan.pcs, vname, ch.no).forEach(function (r) { DB.fab.push(r); });
  lmSaveDb();
  return { no: ch.no };
}
/** Why the card cannot open here ('' when it can). */
function ctsSendBlocked() {
  if (typeof flowRows !== 'function' || typeof flowShLine !== 'function' || typeof flowChallanWrite !== 'function' || typeof flowPrinters !== 'function'
    || typeof flowEnsureData !== 'function' || typeof ptOpenDialog !== 'function') return 'Sending cut pieces to a printer needs the production flow.';
  if (typeof flowScreenAllowed === 'function' && !flowScreenAllowed().some(function (b) { return b[0] === 'drfd'; })) return 'Making an RFD challan needs Demand → RFD access.';
  return '';
}
async function ctsSendOpen(fabric, sizeKey) {
  var why = ctsSendBlocked(); if (why) { lmSay('warn', why); return; }
  lmSay('ok', 'Reading the lines waiting for ' + fabric + '…');
  try { await flowEnsureData(); } catch (e) {
    console.error('Send cut pieces for ' + fabric + ' could not open:', e);
    lmSay('err', 'The lines waiting for ' + fabric + ' could not be read (' + ((e && e.message) || e) + '). Nothing was saved.'); return;
  }
  var sizes = ctsOf(fabric).sizes.filter(function (z) { return z.left > 0; });
  if (!sizes.length) { lmSay('warn', 'No approved cut pieces of ' + fabric + ' are left to send.'); return; }
  /* opened from a size's own button: that size; from the button above the table: the first size with pieces left */
  var first = sizes.filter(function (z) { return z.key === sizeKey; })[0] || sizes[0];
  CTS_SEND = { fabric: fabric, size: first.key, off: {} };
  ptOpenDialog({
    title: 'Cut pieces — ' + fabric + ' → printer',
    subtitle: 'From the pieces already cut to size. Each line takes the pieces it still owes, oldest order first, while the cut pieces last. Untick a line to leave it out.',
    wide: true,
    html: '<div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">'
      + '<label>Printer<select id="ctsVen"><option value="">— pick the printer —</option>' + flowPrinters().map(function (p) {
        return '<option value="' + esc(p.code) + '">' + esc(p.desc || p.name || p.code) + '</option>';
      }).join('') + '</select></label>'
      + '<label>Cut size<select id="ctsSize">' + sizes.map(function (z) {
        return '<option value="' + esc(z.key) + '"' + (z.key === first.key ? ' selected' : '') + '>' + esc(ctsSizeText(z)) + ' — ' + nf(z.left) + ' pcs left</option>';
      }).join('') + '</select></label>'
      + '<label>Date<input value="' + esc(dToday()) + '" readonly title="A challan from here is made today"></label></div>'
      + '<div id="ctsBody" style="margin-top:10px;border:1px solid var(--line,#e3e7ef);border-radius:10px;max-height:55vh;overflow:auto"></div>'
      + '<div id="ctsSum" style="margin-top:10px"></div>'
      + '<label style="display:block;margin-top:10px">Note (vehicle, who carried it…)<input id="ctsNote"></label>',
    saveLabel: 'Make the challan',
    onSave: ctsSendSave
  });
  ctsDlgDraw();
}
/** Draws the matching lines and the sum from the printer and size picked. */
function ctsDlgDraw() {
  var S = CTS_SEND; if (!S) return;
  var code = ctsEl('ctsVen').value, plan = ctsSendPlan(S, code), z = plan.size;
  var going = {}; plan.picks.forEach(function (p) { going[p.line.key] = p; });
  var skipped = {}; plan.skipped.forEach(function (s) { skipped[s.line.key] = s.why; });
  ctsEl('ctsBody').innerHTML = plan.lines.length
    ? '<table class="xl" style="width:100%"><thead><tr><th></th><th style="text-align:left">Order</th><th style="text-align:left">Item</th><th>Owes</th><th>Going</th><th>Metres</th></tr></thead><tbody>'
      + plan.lines.map(function (ln) {
        var p = going[ln.key], why = skipped[ln.key];
        return '<tr><td><input type="checkbox" data-ctsk="' + esc(ln.key) + '"' + (!S.off[ln.key] && !why ? ' checked' : '') + (why ? ' disabled title="' + esc(why) + '"' : '') + ' style="width:auto"></td>'
          + '<td style="text-align:left">' + esc(ln.x.r.orderNo) + '</td>'
          + '<td style="text-align:left"><b>' + esc(obUC(ln.x.r.sku)) + '</b><div class="muted" style="font-size:11px">' + esc(flowChItem(ln.x.r)) + (why ? ' · ' + esc(why) + ' — change the printer on the Inventory RFD card' : '') + '</div></td>'
          + '<td class="num">' + nf(ln.pcs) + '</td><td class="num">' + (p ? '<b>' + nf(p.pcs) + '</b>' : '—') + '</td><td class="num">' + (p ? ctsN(p.metres) : '—') + '</td></tr>';
      }).join('') + '</tbody></table>'
    : '<div class="muted" style="padding:14px">No line on Demand → RFD is waiting for ' + esc(S.fabric) + ' in ' + esc(z ? ctsSizeText(z) : 'this size') + '.</div>';
  ctsEl('ctsSum').innerHTML = z ? 'Going: <b>' + nf(plan.pcs) + ' pcs · ' + ctsN(plan.metres) + ' m</b> of the ' + nf(z.left) + ' pcs left in ' + esc(ctsSizeText(z)) + (code ? '' : ' · pick the printer') : '';
}
async function ctsSendSave() {
  var S = CTS_SEND; if (!S) return 'The card was closed — open it again.';
  var code = ctsEl('ctsVen').value, v = flowPrinters().filter(function (p) { return String(p.code) === String(code); })[0];
  if (!v) return 'Which printer are the pieces going to? Pick one.';
  var plan = ctsSendPlan(S, code), made = await ctsSendWrite(v, S.fabric, plan, ctsEl('ctsNote').value.trim());
  if (made.err) return made.err;
  CTS_SEND = null;
  lmSay('ok', 'Challan ' + made.no + ' made: ' + nf(plan.pcs) + ' pcs of ' + ctsSizeText(plan.size) + ' from the cut stock sent to ' + (v.desc || v.name || v.code) + '.');
  setTimeout(render, 0);
  return '';
}
/** Approve / Refuse pressed on the screen: a refusal asks for its reason first. */
function ctsDecideOnScreen(id, ok) {
  var why = '';
  if (!ok) { why = typeof window.prompt === 'function' ? window.prompt('Why is this cut refused? (the person who asked will see it)', '') : ''; if (why === null) return; }
  var r = (DB.fab || []).filter(function (x) { return x.id === id; })[0], err = ctsDecide(id, ok, why);
  if (err) { lmSay('err', err); return; }
  lmSay(ok ? 'ok' : 'warn', (ok ? 'Approved: ' : 'Refused: ') + r.approval.ask + (ok ? '. The metres have left the RFD shelf.' : '. Nothing moved.'));
  render();
}
function wireCutToSize() {
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-ctsmode],[data-ctsdec],[data-ctssend]') : null; if (!t) return;
    if (t.getAttribute('data-ctsmode') && CUT) { CUT.mode = t.getAttribute('data-ctsmode'); cutDraw(); return; }
    if (t.getAttribute('data-ctsdec')) { var d = t.getAttribute('data-ctsdec').split('|'); ctsDecideOnScreen(d[0], d[1] === 'ok'); return; }
    if (t.getAttribute('data-ctssend')) { ctsSendOpen(t.getAttribute('data-ctssend'), t.getAttribute('data-ctssize') || ''); return; }
  });
  /* the printer card lives in the app's own dialog, so its boxes are heard on the page, not in the desk's root */
  window.document.addEventListener('change', function (ev) {
    var t = ev.target; if (!CTS_SEND || !t || !t.closest || !t.closest('#ctsVen,#ctsSize,[data-ctsk]')) return;
    if (t.id === 'ctsSize') { CTS_SEND.size = t.value; CTS_SEND.off = {}; }
    if (t.getAttribute('data-ctsk')) { if (t.checked) delete CTS_SEND.off[t.getAttribute('data-ctsk')]; else CTS_SEND.off[t.getAttribute('data-ctsk')] = true; }
    ctsDlgDraw();
  });
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
function rrPendingOf(lot) { return (DB.fab || []).filter(function (r) { return r.lot === lot && r.txnType === 'RECEIVE_RFD' && r.approval && r.approval.status === 'pending'; })[0] || null; }
function rrOpen(no, onlyLot) {
  var po = poFind(no); if (!po) return;
  var lots = rrLotsOf(po).filter(function (g) { return !onlyLot || g.lot === onlyLot; });
  if (!lots.length) { lmSay('warn', 'Nothing from ' + po.poNo + ' is out at an RFD processor.'); return; }
  RR = { po: po.poNo, lots: lots.map(function (g) { return g.lot; }), thans: {}, last: {} };
  lots.forEach(function (g) { RR.thans[g.lot] = [{ than: '', m: '' }]; });
  $('rrTitle').textContent = 'Receive RFD · ' + po.poNo;
  /* the day the RFD came back can be put in (Vishesh, 23 Nov): today or earlier, not before the greige was sent */
  $('rrDate').value = lmToday(); $('rrDate').readOnly = false; $('rrDate').max = lmToday(); $('rrDate').min = rrSentOn(RR.lots) || '';
  $('rrDate').title = 'The day the RFD came back — today or earlier'; $('rrNo').value = '';
  $('rrErr').classList.add('hide');
  rrDraw();
  $('lmRr').classList.remove('hide');
  $('rrNo').focus();
}
function rrShrink(g, add, fin) {
  var back = g.rfdIn + add, pct = g.toRfd > 0 ? Math.round(((g.toRfd - back) / g.toRfd) * 1000) / 10 : 0;
  return { back: back, pct: fin ? pct : null, need: fin && pct > RR_SHRINK_LIMIT };
}
/** The thans typed for one lot: only those with metres, as they are saved. */
function rrThansOf(lot) {
  return (RR.thans[lot] || []).filter(function (p) { return +p.m > 0; }).map(function (p) { return { than: String(p.than).trim() || '—', m: r1(+p.m) }; });
}
/* WHEN A LOT CLOSES (Ravi, 25 Nov: "the rfd can be back in multiple thans and at multiple times; even if there are multiple thans
 * yet to come it is asking for approval"). Thans back are not the bales sent -- the processor rolls its own -- so counting them
 * closed a lot on its first small receipt and asked for a 95% shrinkage approval. Now a lot closes by itself only when 95% of the
 * METRES sent are back. Less than that, the rest is still at the processor and more can be received any day; when the processor
 * has nothing more to give, the person receiving ticks "Nothing more to come on this lot", and only then is the shrinkage worked
 * out (over the limit, it waits for approval). */
var RR_CLOSE_METRES_SHARE = 0.95;
function rrLotCloses(g, ps, q, last) {
  if (last) return true;
  return g.toRfd > 0 && g.rfdIn + q >= g.toRfd * RR_CLOSE_METRES_SHARE - 1e-9;
}
/** Has more come back for this lot, counting what is typed, than is out? */
function rrOver(lot) { var g = fabLot(lot); return !!g && rrSum(lot) > g.withProcessor + 0.05; }
function rrSum(lot) { return r1((RR.thans[lot] || []).reduce(function (s, p) { return s + (parseFloat(p.m) || 0); }, 0)); }
function rrDraw() {
  $('rrLots').innerHTML = RR.lots.map(function (lot) {
    var g = fabLot(lot); if (!g) return '';
    var pend = rrPendingOf(lot), out = (DB.fab || []).filter(function (r) { return r.lot === lot && r.txnType === 'ISSUE_TO_RFD'; });
    var head = '<div class="dl-top"><div><b class="mono">' + esc(lot) + '</b> · ' + esc(g.fabricType) + ' → RFD <b>' + esc(fabRfdOfGreige(g.fabricType) || g.fabricType) + '</b>'
      + '<div class="sub">At ' + esc(g.processor || '—') + ' · sent ' + nf(g.toRfd) + ' m' + (out.length ? ' on ' + esc(fmtD(out.map(function (r) { return r.date; }).sort().pop())) : '')
      + (g.rfdIn ? ' · ' + nf(g.rfdIn) + ' m back so far' : '') + ' · <b>' + nf(g.withProcessor) + ' m still out</b></div></div></div>';
    if (pend) {
      /* where the approval is, and the buttons themselves for whoever may press them (Ravi, 25 Nov: "where does the asking for approval gone") */
      var who = (DB.users || []).filter(function (x) { return x.approve && x.active !== false; }).map(function (x) { return x.name; });
      return '<div class="dl">' + head + '<div class="supline">A receipt of ' + nf(fabQty(pend)) + ' m on this lot is waiting for approval (' + pend.approval.pct + '% shrinkage). '
        + 'It is listed at the top of Greige POs under "RFD receipts waiting for approval"' + (who.length ? ', for ' + esc(lmList(who)) : '') + '. Nothing more can be received on this lot until it is decided.'
        + (canApprove() ? '<div class="actions" style="margin-top:8px"><button type="button" class="jw-btn jw-wa" data-appr="' + esc(pend.id) + '|ok">Approve</button><button type="button" class="jw-btn" data-appr="' + esc(pend.id) + '|no">Reject</button></div>' : '')
        + '</div></div>';
    }
    var ps = RR.thans[lot];
    return '<div class="dl">' + head
      + '<div class="prh"><span></span><span>Than no.</span><span>Metres *</span><span></span></div>'
      + ps.map(function (p, pi) {
        return '<div class="pr"><span class="pr-i">' + (pi + 1) + '</span>'
          + '<input id="rt-' + lot + '-' + pi + '" data-rrlot="' + esc(lot) + '" data-pi="' + pi + '" data-f="than" value="' + esc(p.than) + '" placeholder="Than no." aria-label="Than number ' + (pi + 1) + '">'
          + '<input id="rm-' + lot + '-' + pi + '" data-rrlot="' + esc(lot) + '" data-pi="' + pi + '" data-f="m" type="text" inputmode="decimal" autocomplete="off" data-num="7" value="' + esc(p.m) + '" placeholder="Metres" aria-label="Metres, than ' + (pi + 1) + '">'
          + '<button type="button" class="x" data-rrrm="' + esc(lot) + '|' + pi + '" aria-label="Remove than ' + (pi + 1) + '">×</button></div>';
      }).join('')
      + '<div class="dl-actions"><button type="button" class="jw-btn" data-rradd="' + esc(lot) + '">+ Than</button>'
      + '<label style="display:flex;align-items:center;gap:6px;margin:0;font-size:12.5px" title="Tick when the processor has nothing more of this lot to send. The shrinkage is then worked out."><input type="checkbox" data-rrlast="' + esc(lot) + '"' + (RR.last[lot] ? ' checked' : '') + '> Nothing more to come on this lot</label>'
      + '<span class="dl-sum" id="rrsum-' + lot + '"></span></div><div id="rrsh-' + lot + '"></div></div>';
  }).join('');
  rrSums();
}
function rrSums() {
  RR.lots.forEach(function (lot) {
    var g = fabLot(lot); if (!g || rrPendingOf(lot)) return;
    var s = rrSum(lot), n = rrThansOf(lot).length, sh = rrShrink(g, s, rrLotCloses(g, rrThansOf(lot), s, RR.last[lot]));
    var el = $('rrsum-' + lot); if (el) el.textContent = plural(n, 'than') + ' · ' + m1(s) + ' m';
    var box = $('rrsh-' + lot); if (!box) return;
    if (s > g.withProcessor + 0.05) { box.className = 'err'; box.textContent = 'Only ' + nf(g.withProcessor) + ' m of this lot is out, and ' + m1(s) + ' m is typed. Correct the metres before adding the next than.'; return; }
    if (!(s > 0) || sh.pct === null) { box.className = 'warnline'; box.textContent = s > 0 ? 'Part of the lot: ' + nf(Math.max(0, g.withProcessor - s)) + ' m stays at the processor and can be received later. Shrinkage is worked out when the lot is closed.' : ''; return; }
    box.className = sh.need ? 'err' : 'okline';
    box.textContent = 'Sent ' + nf(g.toRfd) + ' m, back ' + m1(sh.back) + ' m: shrinkage ' + sh.pct + '%'
      + (sh.need ? '. More than ' + RR_SHRINK_LIMIT + '%, so this receipt will wait for approval before it counts.' : ', within ' + RR_SHRINK_LIMIT + '%.');
  });
}
/* ISSUE TODAY, RECEIVE ON THE DAY IT CAME (Vishesh, 23 Nov: "any date of issue is to be fixed but receiving date can be
 * changed"). Cloth going out is dated today, whatever a box says. Cloth coming in can be dated back to the day it came —
 * never after today, and never before the day it went out (or was ordered). '' when the date is fine. */
function gdRecvDateErr(date, notBefore, sinceWhat) {
  if (!date) return 'Put the date it came.';
  if (date > lmToday()) return 'It cannot have come after today (' + fmtD(lmToday()) + ').';
  if (notBefore && date < notBefore) return 'It cannot have come before ' + fmtD(notBefore) + ', when ' + sinceWhat + '.';
  return '';
}
/** The first day greige of these lots went to the RFD processor: no RFD can have come back before it. */
function rrSentOn(lots) {
  return (lots || []).map(function (lot) { return invRowsOfLot(lot, 'ISSUE_TO_RFD').map(function (r) { return r.date; }).sort()[0] || ''; })
    .filter(Boolean).sort()[0] || '';
}
function rrSave() {
  var po = poFind(RR.po), no = $('rrNo').value.trim(), typed = $('rrDate').value, date = lmToday(), errs = [], rows = [], held = [];
  if (!no) errs.push('Type the processor’s challan number.');
  var dErr = gdRecvDateErr(typed, rrSentOn(RR.lots), 'the greige was sent for RFD'); if (dErr) errs.push(dErr);
  RR.lots.forEach(function (lot) {
    var g = fabLot(lot); if (!g || rrPendingOf(lot)) return;
    var ps = rrThansOf(lot);
    if (!ps.length) return;
    var q = r1(ps.reduce(function (s, p) { return s + p.m; }, 0)), rfd = fabRfdOfGreige(g.fabricType) || g.fabricType;
    var err = fabEntryCheck({ txnType: 'RECEIVE_RFD', date: date, lot: lot, fabric: rfd, qty: q, party: g.processor });
    if (err) { errs.push(err); return; }
    var dup = {}; ps.forEach(function (p) { if (p.than !== '—') { if (dup[p.than]) errs.push(lot + ': than ' + p.than + ' is typed twice.'); dup[p.than] = 1; } });
    var closes = rrLotCloses(g, ps, q, RR.last[lot]), sh = rrShrink(g, q, closes);
    var row = gdDated({ id: uid(), lot: lot, fabricType: rfd, txnType: 'RECEIVE_RFD', qty: q, party: g.processor, bill: no,
      orderNo: g.poNo, final: closes, pieces: ps, done: false, by: meUser().name }, typed);
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
/* A CHANGED RECEIVE DATE WAITS FOR ACCOUNTS (Vishesh, 23 Nov). Greige and RFD receipts typed for any day but today are saved on
 * TODAY, with the typed day beside them as a request: dateAsk = { at, by, date, status: 'waiting' | 'approved' | 'refused',
 * decidedBy, decidedAt, why }. Until it is approved every figure counts the receipt on today. Deciding is Ravi's or the accounts
 * head's (right gdpoappr, as for a PO close request). Approving moves only that receipt's date; its challan, lot and PO stay.
 * One greige challan can carry several receipts (one per lot): they are decided together.
 * ERRORS: a press without the right, a refusal without a reason, or a request somebody else decided first is refused with a
 * message saying what to do. Saving is lmSaveDb's (a failed save says "Not saved"). */
var canDateApprove = function () { return gdHas('gdpoappr'); };
/** The receipt dated today; when another day was typed, it also carries the ask for that day. A new row, the one given is not changed. */
function gdDated(row, typed) {
  var ask = typed && typed !== lmToday() ? { dateAsk: { at: new Date().toISOString(), by: meUser().id, date: typed, status: 'waiting' } } : {};
  return Object.assign({}, row, { date: lmToday() }, ask);
}
function gdDateAsksWaiting(fab) {
  return (fab || DB.fab || []).filter(function (r) { return (r.txnType === 'RECEIVE_GREIGE' || r.txnType === 'RECEIVE_RFD') && r.dateAsk && r.dateAsk.status === 'waiting'; });
}
/** The receipts decided together with this one: its whole greige challan, or just the RFD receipt. */
function gdDateAskRows(row, fab) {
  if (row.txnType !== 'RECEIVE_GREIGE' || !row.chId) return [row];
  return gdDateAsksWaiting(fab).filter(function (x) { return x.chId === row.chId; });
}
/** What waits, one entry per decision: { id, kind, no, po, lots, m, ask }. */
function gdDateAskItems(fab) {
  var out = [], seen = {};
  gdDateAsksWaiting(fab).forEach(function (r) {
    var key = r.txnType === 'RECEIVE_GREIGE' && r.chId ? r.chId : r.id; if (seen[key]) return; seen[key] = 1;
    var rows = gdDateAskRows(r, fab);
    out.push({ id: r.id, kind: r.txnType === 'RECEIVE_GREIGE' ? 'Greige' : 'RFD', no: r.bill || '', po: r.orderNo || '', ask: r.dateAsk,
      lots: uniq(rows.map(function (x) { return x.lot; })), m: r1(rows.reduce(function (n, x) { return n + fabQty(x); }, 0)) });
  });
  return out;
}
/** Approve (the receipt moves to the day asked) or refuse (it stays today). '' when done, else what stopped it. */
async function gdDateDecide(id, ok, why) {
  var r = (DB.fab || []).filter(function (x) { return x.id === id; })[0];
  if (!r || !r.dateAsk || r.dateAsk.status !== 'waiting') return 'Already decided — this date is not waiting any more.';
  if (!canDateApprove()) return 'Only Ravi, or the accounts head, can decide a changed receive date.';
  if (!ok && !String(why || '').trim()) return 'Type why the date is refused, so the store knows.';
  var patch = {}, now = new Date().toISOString(), rows = gdDateAskRows(r);
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i], ask = row.dateAsk, path = GD_NODE + '/fab/' + row.id;
    var decided = Object.assign({}, ask, { status: ok ? 'approved' : 'refused', decidedBy: meUser().id, decidedAt: now }, ok ? {} : { why: String(why).trim() });
    var lost = '';
    try { if (typeof ptCas === 'function' && await ptCas(path + '/dateAsk', ask, decided)) lost = 'changed'; } catch (e) { return 'Could not save: ' + (e && e.message || e); }
    if (lost) return 'Already decided by someone else — open the Greige Desk again to see it.';
    row.dateAsk = decided; if (ok) row.date = ask.date;
    patch[path + '/dateAsk'] = JSON.parse(JSON.stringify(decided)); if (ok) patch[path + '/date'] = ask.date;
    if (GD_SNAP && GD_SNAP.fab) GD_SNAP.fab[row.id] = JSON.stringify(row);   // written by field, below; not the whole row
  }
  lmSaveDb(patch);
  return '';
}
/** Approve / Refuse pressed on the card: a refusal asks for its reason first. */
function gdDateDecideOnScreen(id, ok) {
  var why = '';
  if (!ok) { why = typeof window.prompt === 'function' ? window.prompt('Why is this date refused? (the person who asked will see it)', '') : ''; if (why === null) return; }
  gdDateDecide(id, ok, why).then(function (err) {
    if (err) { lmSay('err', err); return; }
    lmSay(ok ? 'ok' : 'warn', ok ? 'Approved: the receipt now carries the date asked.' : 'Refused: the receipt stays on today.');
    render();
  });
}
/** The same for printed goods back from a printer: the production flow decides and keeps it. */
function gdFlowDateDecideOnScreen(no, id, ok) {
  var why = '';
  if (!ok) { why = typeof window.prompt === 'function' ? window.prompt('Why is this date refused? (the person who asked will see it)', '') : ''; if (why === null) return; }
  flowDateDecide(no, id, ok, why).then(function (err) {
    if (err) { lmSay('err', err); return; }
    lmSay(ok ? 'ok' : 'warn', ok ? 'Approved: the printed goods carry the date asked.' : 'Refused: the printed goods stay on today.');
    render();
  });
}
/** The small note under a receipt or challan date while its changed day waits; '' otherwise. */
function gdDateAskNote(rows) {
  var w = (rows || []).filter(function (r) { return r.dateAsk && r.dateAsk.status === 'waiting'; })[0];
  return w ? '<div class="sub">asked: ' + esc(fmtD(w.dateAsk.date)) + ' — waiting for accounts</div>' : '';
}
/** Approve / Refuse; `attr` says whose decision it is: data-gdask (a greige or RFD receipt) or data-gdflowask (printed goods back from a printer). */
function gdDateAskButtons(attr, id) {
  if (!canDateApprove()) return '<span class="muted">for the accounts head</span>';
  return '<div class="actions"><button type="button" class="jw-btn jw-wa" ' + attr + '="' + esc(id) + '|ok">Approve</button>'
    + '<button type="button" class="jw-btn" ' + attr + '="' + esc(id) + '|no">Refuse</button></div>';
}
/** Printed goods received with a changed day, from the production flow when it is loaded: [{ no, id, rc, ask, ch }]. */
function gdFlowDateAsks() {
  return typeof flowDateAsksWaiting === 'function' && typeof FLOW !== 'undefined' && FLOW.ch ? flowDateAsksWaiting() : [];
}
/** Receive dates waiting for accounts, as a card on the Greige POs page beside the other approvals. */
function gdDateAsksHtml() {
  var list = gdDateAskItems(), printed = gdFlowDateAsks(); if (!list.length && !printed.length) return '';
  return '<div class="card approvals"><div class="kpihead"><span class="kpiname">Receive dates waiting for accounts</span><span class="kpiwhen">counted on today until approved</span></div>'
    + '<div class="box scroll"><table class="ct li"><thead><tr><th>Receipt</th><th>Their challan</th><th>PO</th><th>Lot</th><th class="num">Metres</th><th>Day asked</th><th>Asked by</th><th></th></tr></thead><tbody>'
    + list.map(function (x) {
      return '<tr><td class="tl b">' + (x.kind === 'Greige' ? 'Greige' : 'RFD') + '</td><td class="tl mono">' + esc(x.no || '—') + '</td><td class="tl">' + esc(x.po || '—') + '</td>'
        + '<td class="tl mono">' + esc(x.lots.join(', ')) + '</td><td class="num">' + m1(x.m) + ' m</td><td class="tl b">' + esc(fmtD(x.ask.date)) + '</td>'
        + '<td class="tl">' + esc(x.ask.by || '') + '<div class="sub">' + esc(fmtD(lmToday(x.ask.at))) + '</div></td><td>' + gdDateAskButtons('data-gdask', x.id) + '</td></tr>';
    }).join('') + printed.map(function (w) {
      var m = Object.keys(w.rc.items || {}).reduce(function (n, k) { return n + (+w.rc.items[k] || 0); }, 0);
      return '<tr><td class="tl b">Printed goods</td><td class="tl mono">' + esc(w.no) + '</td><td class="tl">' + esc(w.ch.orderNo || '—') + '</td><td class="tl">—</td><td class="num">' + nf(m) + '</td>'
        + '<td class="tl b">' + esc(fmtD(w.ask.date)) + '</td><td class="tl">' + esc(w.ask.by || '') + '<div class="sub">' + esc(fmtD(lmToday(w.ask.at))) + '</div></td>'
        + '<td>' + gdDateAskButtons('data-gdflowask', w.no + '|' + w.id) + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
}
function wireDateAsks() {
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-gdask],[data-gdflowask]') : null; if (!t) return;
    if (t.getAttribute('data-gdask')) { var d = t.getAttribute('data-gdask').split('|'); gdDateDecideOnScreen(d[0], d[1] === 'ok'); return; }
    var f = t.getAttribute('data-gdflowask').split('|'); gdFlowDateDecideOnScreen(f[0], f[1], f[2] === 'ok');
  });
}

/** The receipts waiting for someone to approve their shrinkage. */
function rrPending() { return (DB.fab || []).filter(function (r) { return r.txnType === 'RECEIVE_RFD' && r.approval && r.approval.status === 'pending'; }); }
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
/* the paper's own styles: the greige PO and the RFD PO share them */
var POD_CSS = '.pod{width:720px;margin:0 auto;padding:4px 0 0;background:#fff;color:#000;'
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
      + '<td class="n">' + (gpoDiscPct(l) ? money(gpoDiscPct(l)) + ' %' : '') + '</td>'
      + '<td class="c">Mtr</td>'
      + '<td class="n b">' + money(m.amount) + '</td></tr>';
  }).join('');
  var fill = Math.max(40, 300 - lines.length * 24);
  /* THE TERMS GO IN THE TERMS BOX (Ravi, 25 Nov: the box beside the consignee stood empty and the conditions were printed in a
   * box of their own under the total). What the PO window's Terms & conditions holds is printed there, line breaks kept. */
  var hasOther = !!String(po.other || '').trim();
  var terms = [po.terms, po.tc].map(function (x) { return String(x || '').trim(); }).filter(Boolean).join(String.fromCharCode(10));

  return '<div class="pod"><style>' + POD_CSS + '</style>'
    + '<h1>PURCHASE ORDER</h1>'
    + '<table class="hd"><colgroup><col style="width:50%"><col style="width:25%"><col style="width:25%"></colgroup>'
    + '<tr><td rowspan="' + (hasOther ? 5 : 4) + '">' + me + '</td>'
    + '<td class="r">' + cell('Voucher No.', po.poNo) + '</td><td class="r">' + cell('Dated', fmtD(po.date)) + '</td></tr>'
    /* THE ORDER VALUE, IN FIGURES AND IN WORDS, IN ONE BOX (Ravi, 25 Nov: the box under the voucher number was blank; then
     * "put [the amount in words] beside the order value or expand its box"). The box runs the width of the voucher panel; the
     * words are no longer printed again under the total. */
    + '<tr><td class="r" colspan="2" style="height:auto"><div style="display:flex;justify-content:space-between"><span class="lab">Order Value</span><i class="lab">E. &amp; O.E</i></div>'
    + '<div class="val">' + RUPEE + ' ' + money(t.amount) + '</div><div class="words" style="margin:1px 0 2px">' + esc(inrWords(t.amount)) + '</div></td></tr>'
    + '<tr><td class="r">' + cell('Reference No. & Date.', po.poNo) + '</td><td class="r">' + cell('Mode/Terms of Payment', po.pay) + '</td></tr>'
    + '<tr><td class="r">' + cell('Dispatched through', po.disp) + '</td><td class="r">' + cell('Destination', po.dest) + '</td></tr>'
    + (hasOther ? '<tr><td class="r" colspan="2">' + cell('Other References', po.other) + '</td></tr>' : '')   // no empty box (Ravi, 25 Nov)
    + '<tr><td>' + shipTo + '</td><td colspan="2" rowspan="2">' + '<div class="lab">Terms &amp; Conditions</div><div class="val" style="font-weight:400;white-space:pre-line">' + esc(terms) + '</div></td></tr>'
    + '<tr><td>' + supplier + '</td></tr>'
    + '</table>'
    + '<table class="items"><colgroup><col style="width:5%"><col style="width:35%"><col style="width:10%">'
    + '<col style="width:13%"><col style="width:9%"><col style="width:8%"><col style="width:5%"><col style="width:15%"></colgroup>'
    + '<thead><tr><th>Sl<br>No.</th><th>Description of Goods</th><th>Due on</th><th>Quantity</th><th>Rate</th>'
    + '<th>Disc %</th><th>per</th><th>Amount</th></tr></thead>'
    + '<tbody>' + rows
    + '<tr><td style="height:' + fill + 'px"></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>'
    + '<tr class="tot"><td></td><td style="text-align:right">Total</td><td></td>'
    + '<td class="n b">' + money(t.metres) + ' Mtr</td><td></td><td></td><td></td>'
    + '<td class="n b">' + RUPEE + ' ' + money(t.amount) + '</td></tr>'
    + '</tbody></table>'
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
      + (String(po.tc || '').trim() ? 'Terms & conditions:' + NL + String(po.tc).trim() + NL + NL : '')
      + 'Kindly confirm receipt and the delivery date.' + NL + NL + 'Regards,' + NL + who
  };
}
function poGmailUrl(po) {
  var m = poMailText(po);
  return 'https://mail.google.com/mail/?view=cm&fs=1' + (m.to ? '&to=' + encodeURIComponent(m.to) : '')
    + '&su=' + encodeURIComponent(m.su) + '&body=' + encodeURIComponent(m.body);
}
var DOC_NO = '';
/* ---- THE RFD PO (Ravi, 25 Nov: "show the PO of the rfd … build the rfd po") ---------------------------------------- *
 * The paper that goes to the RFD processor with the greige: one per RFD challan (RIDHI/RFD/001 …), laid out like the greige
 * PO. It is worked out from the Issue to RFD rows that carry that challan number -- nothing new is stored -- so it can be
 * opened again any day from the challan number on the Fabric ledger or under "At RFD processor" on Inventory.
 * A processing rate typed on the Issue card puts Rate, Amount and the order value on it; without one it shows quantities only.
 * Reads only: nothing here can lose data. An unknown challan number says so. */
function rfdPoRows(chNo) {
  var k = String(chNo || '').trim().toUpperCase();
  return (DB.fab || []).filter(function (r) { return r.txnType === 'ISSUE_TO_RFD' && fabCounts(r) && String(r.bill || '').trim().toUpperCase() === k; });
}
function rfdPoTotals(rows) {
  return rows.reduce(function (t, r) { t.metres += fabQty(r); t.amount += fabQty(r) * (+r.rate || 0); return t; }, { metres: 0, amount: 0 });
}
function rfdPoDocBody(chNo) {
  var rows = rfdPoRows(chNo); if (!rows.length) return '';
  var co = DB.co || {}, r0 = rows[0], v = venByName(r0.party) || { name: r0.party }, t = rfdPoTotals(rows), priced = t.amount > 0;
  var coLines = String(co.addr || '').split(/\r?\n/).map(function (x) { return x.trim(); });
  var me = podParty('Invoice To', co.name || '', coLines, co.gstin, co.email, co.iec);
  var shipTo = podParty('Consignee (RFD comes back to)', co.name || '', coLines, co.gstin, co.email, co.iec);
  var proc = podParty('RFD Processor (Job worker)', v.name || r0.party, [v.addr, v.city], v.gstin, '', '');
  var cell = function (label, val) { return '<div class="lab">' + esc(label) + '</div><div class="val">' + esc(val || '') + '</div>'; };
  var pos = uniq(rows.map(function (r) { return r.orderNo; }).filter(Boolean)).join(', '), lrs = uniq(rows.map(function (r) { return r.lr; }).filter(Boolean)).join(', ');
  var notes = uniq(rows.map(function (r) { return String(r.remark || '').trim(); }).filter(Boolean)).join(String.fromCharCode(10));
  var lines = rows.map(function (r, i) {
    var bales = r.baleM ? Object.keys(r.baleM).map(function (b) { return b + ' (' + m1(r.baleM[b]) + ' m)'; }) : (r.bales || []);
    return '<tr><td class="c">' + (i + 1) + '</td>'
      + '<td><div class="desc">' + esc(r.fabricType) + '</div><div style="font-size:10px">To be made RFD: ' + esc(fabRfdOfGreige(r.fabricType) || r.fabricType) + '</div>'
      + '<div style="font-size:10px">Lot ' + esc(r.lot) + (bales.length ? ' · ' + plural(bales.length, 'bale') + ': ' + esc(bales.join(', ')) : '') + '</div></td>'
      + '<td class="n b">' + money(fabQty(r)) + ' Mtr</td>'
      + '<td class="n">' + (r.rate ? money(r.rate) : '') + '</td><td class="c">Mtr</td>'
      + '<td class="n b">' + (r.rate ? money(fabQty(r) * r.rate) : '') + '</td></tr>';
  }).join('');
  var fill = Math.max(40, 280 - rows.length * 40);
  return '<div class="pod"><style>' + POD_CSS + '</style>'
    + '<h1>RFD PURCHASE ORDER</h1>'
    + '<table class="hd"><colgroup><col style="width:50%"><col style="width:25%"><col style="width:25%"></colgroup>'
    + '<tr><td rowspan="' + (priced ? 4 : 3) + '">' + me + '</td>'
    + '<td class="r">' + cell('RFD PO / Challan No.', r0.bill) + '</td><td class="r">' + cell('Dated', fmtD(r0.date)) + '</td></tr>'
    + (priced ? '<tr><td class="r" colspan="2" style="height:auto"><div style="display:flex;justify-content:space-between"><span class="lab">Order Value</span><i class="lab">E. &amp; O.E</i></div>'
      + '<div class="val">' + RUPEE + ' ' + money(t.amount) + '</div><div class="words" style="margin:1px 0 2px">' + esc(inrWords(t.amount)) + '</div></td></tr>' : '')
    + '<tr><td class="r">' + cell('Greige PO No.', pos) + '</td><td class="r">' + cell('Transport / LR No.', lrs) + '</td></tr>'
    + '<tr><td class="r" colspan="2">' + cell('Process', 'Greige to RFD (ready for dyeing / printing)') + '</td></tr>'
    + '<tr><td>' + shipTo + '</td><td colspan="2" rowspan="2"><div class="lab">Remarks</div><div class="val" style="font-weight:400;white-space:pre-line">' + esc(notes) + '</div></td></tr>'
    + '<tr><td>' + proc + '</td></tr>'
    + '</table>'
    + '<table class="items"><colgroup><col style="width:5%"><col style="width:45%"><col style="width:16%"><col style="width:11%"><col style="width:6%"><col style="width:17%"></colgroup>'
    + '<thead><tr><th>Sl<br>No.</th><th>Description of Goods</th><th>Quantity sent</th><th>Rate</th><th>per</th><th>Amount</th></tr></thead>'
    + '<tbody>' + lines
    + '<tr><td style="height:' + fill + 'px"></td><td></td><td></td><td></td><td></td><td></td></tr>'
    + '<tr class="tot"><td></td><td style="text-align:right">Total</td>'
    + '<td class="n b">' + money(t.metres) + ' Mtr</td><td></td><td></td>'
    + '<td class="n b">' + (priced ? RUPEE + ' ' + money(t.amount) : '') + '</td></tr>'
    + '</tbody></table>'
    + '<div class="foot"><div class="l">'
    + (co.pan ? '<div>Company\u2019s PAN <span style="display:inline-block;width:40px"></span>: <b>' + esc(co.pan) + '</b></div>' : '')
    + '</div><div class="r"><b>for ' + esc(co.name || '') + '</b><span>Authorised Signatory</span></div></div>'
    + '<div class="after">' + (co.jurisdiction ? 'SUBJECT TO ' + esc(String(co.jurisdiction).toUpperCase()) + ' JURISDICTION<br>' : '')
    + 'This is a Computer Generated Document</div>'
    + '</div>';
}
/** The same order as a WhatsApp message to the processor. */
function rfdPoWaText(chNo) {
  var rows = rfdPoRows(chNo), co = DB.co || {}, t = rfdPoTotals(rows), NL = String.fromCharCode(10);
  return 'RFD PO ' + rows[0].bill + ' dated ' + fmtD(rows[0].date) + NL
    + rows.map(function (r, i) { return (i + 1) + '. ' + r.fabricType + ' to RFD ' + (fabRfdOfGreige(r.fabricType) || r.fabricType) + ' - lot ' + r.lot + ', ' + nf(fabQty(r)) + ' m' + (r.rate ? ' @ ' + RUPEE + money(r.rate) : ''); }).join(NL) + NL
    + 'Total ' + nf(t.metres) + ' m' + (t.amount > 0 ? ', ' + RUPEE + ' ' + money(t.amount) : '') + NL + NL
    + 'Kindly confirm receipt and the date the RFD will be ready.' + NL + (co.name || '');
}
function rfdPoShow(chNo) {
  var rows = rfdPoRows(chNo);
  if (!rows.length) { lmSay('warn', 'No greige was issued on RFD challan ' + chNo + '.'); return; }
  var v = venByName(rows[0].party), d = String((v && v.phone) || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d;
  DOC_NO = '';   // not a greige PO: its mail buttons are not on this paper
  $('docTitle').textContent = 'RFD PO · ' + rows[0].bill + ' · ' + rows[0].party;
  $('docPaper').innerHTML = rfdPoDocBody(chNo);
  $('docMail').innerHTML = '<div class="sect">Send it to the RFD processor</div>'
    + '<div class="row"><a class="btnlink wa" href="' + esc('https://wa.me/' + (d.length >= 11 ? d : '') + '?text=' + encodeURIComponent(rfdPoWaText(chNo))) + '" target="_blank" rel="noopener">' + WA_ICON + ' Send on WhatsApp</a></div>'
    + '<div class="lm-why">To print or save it as a PDF, press Ctrl + P while this is open (only the paper prints). '
    + 'WhatsApp opens on the processor’s number from Master data.</div>';
  $('lmDoc').classList.remove('hide');
}
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
    var rp = ev.target.closest ? ev.target.closest('[data-rfdpo]') : null;
    if (rp) { rfdPoShow(rp.getAttribute('data-rfdpo')); return; }
    var t = ev.target.closest ? ev.target.closest('[data-act],[data-sent],[data-porm],[data-doc],[data-rcv],[data-tpo],[data-tch],[data-fill],[data-kpi],[data-pv],[data-pvclear],[data-dr],[data-pclose],[data-pcancel],[data-pask],[data-pedit],[data-iss],[data-isspick],#docCopy,#issSave') : null;
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
    if (g('data-pcancel')) { poCancelToggle(g('data-pcancel'), t); return; }
    if (g('data-pask')) { var pa = g('data-pask').split('|'); poAskDecide(pa[0], pa[1] === 'ok', t); return; }
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
  /* the measured figure is final once the cursor leaves its box */
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el.getAttribute || !el.getAttribute('data-chk') || el.readOnly) return;
    if (el.value !== '' && !isNaN(parseFloat(el.value))) { el.readOnly = true; el.title = 'Checked. A checked bale cannot be changed.'; }
  });
  /* MEASURED METRES change the tile and the challan's pill in place, so typing never loses the box. */
  document.addEventListener('input', function (ev) {
    var el = ev.target, key = el.getAttribute && el.getAttribute('data-chk');
    if (key && el.readOnly) return;   // a checked bale
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
    if (ISS && el.getAttribute && el.getAttribute('data-issbq')) {
      var bk = el.getAttribute('data-issbq'), blot = bk.split('|')[0]; ISS.bq[bk] = el.value;
      var bl = issPicked(blot), bbad = bl.map(function (b) { return issBaleErr(blot, b); }).filter(Boolean), bbox = $('issbad-' + blot);
      if (bbox) { bbox.className = bbad.length ? 'err' : 'hide'; bbox.innerHTML = bbad.map(esc).join('<br>'); }
      var bsum = $('isssum-' + blot); if (bsum) bsum.textContent = plural(bl.length, 'bale') + ' · ' + m1(r1(bl.reduce(function (a, b) { return a + issBaleM(blot, b); }, 0))) + ' m';
      var bt = issTotals(); $('issTot').innerHTML = 'Going out: <b>' + plural(bt.n, 'bale') + ' · ' + m1(bt.m) + ' m</b>'; $('issErr').classList.add('hide'); return;
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
  /* Tab in an empty rate box takes the sample rate, then moves on as Tab does (Vishesh, 23 Nov) */
  $('poLines').addEventListener('keydown', function (ev) {
    var el = ev.target;
    if (ev.key !== 'Tab' || ev.shiftKey || !el.getAttribute || el.getAttribute('data-f') !== 'rate') return;
    var i = parseInt(el.getAttribute('data-li'), 10);
    if (poRateTab(i)) { el.value = PO_DRAFT.lines[i].rate; poSyncRow(i); }
  });
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
  /* while a name is being typed it is a search: the red "not a supplier" waits until the box is left */
  $('poMill').addEventListener('input', function () { PO_MILL_HI = 0; poMillListDraw(); $('poMillNote').textContent = ''; if (gpoPickedMill(this.value)) poMillHint(); });
  $('poMill').addEventListener('focus', poMillListDraw);
  $('poMill').addEventListener('blur', function () { setTimeout(function () { poMillListClose(); poMillHint(); }, 150); });
  /* stopPropagation: Esc that closes the list must not also close the PO window */
  $('poMill').addEventListener('keydown', function (ev) { if (poMillKey(ev.key)) { ev.preventDefault(); ev.stopPropagation(); } });
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
    /* RFD ON SHELF LESS WHAT WENT TO PRINTERS (Vishesh, 23 Nov): the RFD challans to printers take their metres off the shelf
     * here too, by the flow's own rule (flowRfdStock: the desk's count less the challans since it began counting that fabric),
     * so this column and PPC's "RFD free" agree. Challans are not by lot: the lots below still show what each lot had. */
    var chOut = invChallanOut(n), transit = invTransit(n);
    var cutCh = typeof flowCpList === 'function' && typeof FLOW !== 'undefined' && FLOW && FLOW.dem ? flowCpList(n) : [];
    var g = e.greigeLeft || 0, p = e.withProcessor || 0, r = Math.max(0, (e.rfdLeft || 0) - chOut), cut = ctsOf(n);
    /* The cloth cut to size and not yet sent to a printer is still ours: it is in the total though it left the RFD shelf. */
    return { fabric: n, type: invType(n), greige: fabGreigeOf(n), onOrder: o ? o.m : 0,
      inStoreGreige: g, atProcessor: p, inStoreRfd: r, rfdToPrinters: chOut, transit: transit, cut: cut, cutCh: cutCh, owned: g + p + r + cut.leftM + cutCh.reduce(function (a, x) { return a + x.metres; }, 0),
      ppc: ppc && !ppc.__loading ? (ppc[n.toUpperCase()] || null) : null };
  }).filter(invWorthShowing)
    .sort(function (a, b) { return a.type.localeCompare(b.type) || a.fabric.localeCompare(b.fabric, undefined, { numeric: true }); });
}
/* THE INVENTORY, LAID OUT TO ACT ON (Ravi, 21 Nov: "the page seems very dirty in format make it better with the functions I
 * have"). Every function stays; the page reads in this order:
 *   - one toolbar: the cloth-type drop-down and search (in the top bar), + RFD opening stock, Demand → RFD
 *   - a filter by what needs doing: All · Short for PPC · Covered · No PPC demand (counts on each)
 *   - per fabric: its PPC need with a bar for how much the RFD free covers, an Action (Raise PO · m, or what blocks it),
 *     then where the cloth is now — greige ordered → in store → at processor → RFD on shelf — and the total. Every
 *     figure still opens what makes it up; the fabric's name still opens its stock history.
 *   - short fabrics first, then covered, then those PPC does not need.
 * PPC demand exists only in the app (gdPpcMap); run on its own the desk shows the stock columns alone. */
var INV_SHOW_LABEL = { all: 'All', short: 'Short for PPC', ok: 'Covered', none: 'No PPC demand' };
var INV_SHOW_ORDER = { short: 0, ok: 1, none: 2 };
UI.invShow = 'all';
/* CUSTOM ORDERS: THE SHP BOARD AND THE ONLINE BOARD (Ravi, 28 Nov: "shp/online board ke liye custom orders, jisko dekhkar ham RFD pcs bhej sake"). Beside the fabric table, a list of the
 * made-to-order lines (SHP, ONL, Etsy) waiting on Demand → RFD: the order, the product, the pieces to make, the RFD they need, whether the shelf has it, the printer. The same lines
 * as Demand → RFD (flowShLine), so what is sent from there is what is counted here; "Send to printer" opens Demand → RFD at that fabric. Reads only. */
UI.invView = 'fab'; UI.invBoard = 'all'; UI.cuFrom = ''; UI.cuTo = ''; UI.cuPrn = ''; UI.cuSel = {};
var CU_BOARDS = { shp: 'SHP board', onl: 'Online board' };
function cuBoardOf(r) {
  var pre = String((r && r.orderNo) || '').split('-')[0].trim().toUpperCase(), src = String((r && r.src) || '').trim().toUpperCase();
  var f = function (x) { return x === 'SHP' ? 'shp' : (x === 'ONL' || x === 'ETSY') ? 'onl' : ''; };
  return f(pre) || (pre === 'AMZ' || pre === 'B2B' ? '' : f(src));
}
/** null while the flow is loading; else [{ ln (flowShLine), board, fabric, cover }] oldest first. */
function cuLines() {
  if (typeof flowRows !== 'function' || typeof flowShLine !== 'function' || typeof flowRfdCover !== 'function') return null;
  if (!gdFlowReady()) return null;
  var cov = flowRfdCover().line;
  return flowRows().filter(function (x) {
    return cuBoardOf(x.r) && flowInView('drfd', x.s) && x.s.route !== 'stitch' && !(typeof flowCpActive === 'function' && flowCpActive(x.s.key));
  }).map(function (x) {
    var ln = flowShLine(x);
    return { ln: ln, board: cuBoardOf(x.r), fabric: String((((x.s.plan || {}).fabric) || {}).name || ''), cover: cov[x.s.key] || null };
  }).filter(function (c) { return c.ln.pcs > 0; })
    .sort(function (a, b) { return String(a.ln.x.r.orderDate || '').localeCompare(String(b.ln.x.r.orderDate || '')) || String(a.ln.x.r.orderNo).localeCompare(String(b.ln.x.r.orderNo)); });
}
/** WHY A CUSTOM LINE CANNOT BE SENT FROM HERE ('' = it can): the Send-to-printer card's own rule (flowShWhyNot - a master row without cloth per piece, no printer from PPC, a change waiting
 *  for approval, in Cut to size) plus: cut-piece lines are sent through Demand → RFD (they are cut first), so they are not made into a challan from this list. */
var CU_S = { lines: [], tick: new Set(), prn: {}, qty: {}, fabric: '', q: '', kind: '', show: '', pri: '' };
function cuWhyNot(c) {
  if (typeof flowShWhyNot !== 'function' || typeof flowShKind !== 'function') return 'The challan card is not here.';
  if (!c.fabric) return 'No RFD fabric set on its plan in PPC';
  if (flowShKind(c.ln) === 'cut') return 'Cut pieces: send it from Demand → RFD';
  return flowShWhyNot(CU_S, c.ln);
}
/** The lines under the filters on screen: board, date range, printer, search. */
function cuFiltered(all) {
  return all.filter(function (c) {
    var d = String(c.ln.x.r.orderDate || '');
    if (UI.invBoard !== 'all' && c.board !== UI.invBoard) return false;
    if (UI.cuFrom && d < UI.cuFrom) return false;
    if (UI.cuTo && d > UI.cuTo) return false;
    if (UI.cuPrn && (UI.cuPrn === '-' ? !!c.ln.printer : String(c.ln.printer || '') !== UI.cuPrn)) return false;
    return lmMatch(c.ln.x.r.orderNo) || lmMatch(c.ln.x.r.sku) || lmMatch(c.fabric);
  });
}
function cuSelText(n, pcs, m) { return n ? nf(n) + ' selected · ' + nf(pcs) + ' pcs · ' + m1(m) + ' m' : 'Nothing ticked'; }
/** Ravi, 28 Nov: "lines wale me hi date range and printer filter and select option, jis jisko bhejna usko select karu aur challan bana kar bhej du" - the Lines list has a date range, a printer
 *  filter, a tick on every line that can go, and "Make challan" for the ticked ones: the Send-to-printer card's own review (what goes to which printer) and its own challan writer. */
function cuHtml() {
  var all = cuLines(), tb = '<div class="row" style="margin:0 0 10px;align-items:center;flex-wrap:wrap;gap:8px">'
    + '<button type="button" class="ghost" data-invview="fab">← Fabrics</button>';
  if (all === null) return INV_CSS + tb + '</div><div class="card" style="padding:30px;text-align:center;color:var(--muted)">Loading the custom orders…</div>';
  var n = function (b) { return all.filter(function (c) { return b === 'all' || c.board === b; }).length; };
  tb += '<div class="seg" role="tablist" aria-label="Board">' + ['all', 'shp', 'onl'].map(function (b) {
    return '<button type="button" role="tab" class="segbtn' + (UI.invBoard === b ? ' on' : '') + '" aria-selected="' + (UI.invBoard === b) + '" data-invboard="' + b + '">'
      + (b === 'all' ? 'Both boards' : CU_BOARDS[b]) + ' <span class="n">' + n(b) + '</span></button>';
  }).join('') + '</div>';
  var prs = {}; all.forEach(function (c) { if (c.ln.printer) prs[c.ln.printer] = c.ln.printerName || c.ln.printer; });
  var nopr = all.filter(function (c) { return !c.ln.printer; }).length;
  tb += '<label class="muted" style="font-size:12px;display:flex;align-items:center;gap:5px">From <input type="date" data-cuf="cuFrom" value="' + esc(UI.cuFrom) + '" style="width:auto;height:34px"></label>'
    + '<label class="muted" style="font-size:12px;display:flex;align-items:center;gap:5px">To <input type="date" data-cuf="cuTo" value="' + esc(UI.cuTo) + '" style="width:auto;height:34px"></label>'
    + '<select data-cuf="cuPrn" aria-label="Printer" style="width:auto;height:34px"><option value="">All printers</option>'
    + Object.keys(prs).sort(function (a, b) { return prs[a].localeCompare(prs[b]); }).map(function (k) { return '<option value="' + esc(k) + '"' + (UI.cuPrn === k ? ' selected' : '') + '>' + esc(prs[k]) + '</option>'; }).join('')
    + (nopr ? '<option value="-"' + (UI.cuPrn === '-' ? ' selected' : '') + '>Printer not chosen (' + nopr + ')</option>' : '') + '</select>'
    + ((UI.cuFrom || UI.cuTo || UI.cuPrn) ? '<button type="button" class="ghost" data-cuclear="1" style="height:34px">Clear filters</button>' : '');
  var rows = cuFiltered(all);
  rows.forEach(function (c) { c.why = cuWhyNot(c); });
  var okKeys = {}; rows.forEach(function (c) { if (!c.why) okKeys[c.ln.key] = 1; });
  Object.keys(UI.cuSel).forEach(function (k) { if (!okKeys[k]) delete UI.cuSel[k]; });   // a line that cannot go, or is filtered out, is not ticked
  var sel = rows.filter(function (c) { return UI.cuSel[c.ln.key]; });
  var spcs = 0, sm = 0; sel.forEach(function (c) { spcs += c.ln.pcs; sm += c.ln.metres; });
  tb += '<span style="margin-left:auto"></span><span style="font-size:12.5px;font-weight:700">' + cuSelText(sel.length, spcs, sm) + '</span>'
    + '<button type="button" class="jw-btn jw-primary" data-cumake="1"' + (sel.length ? '' : ' disabled') + ' style="height:34px">Make challan</button></div>';
  var nOk = Object.keys(okKeys).length;
  var body = rows.map(function (c) {
    var l = c.ln, r = l.x.r, cv = c.cover, short = cv ? cv.short : l.metres, ready = cv && cv.short <= 0.05 && cv.name;
    return '<tr><td class="frz" style="width:30px">' + (c.why ? '<input type="checkbox" disabled title="' + esc(c.why) + '">' : '<input type="checkbox" data-cusel="' + esc(l.key) + '"' + (UI.cuSel[l.key] ? ' checked' : '') + ' aria-label="Send ' + esc(r.orderNo + ' ' + r.sku) + '">') + '</td>'
      + '<td class="tl b">' + esc(r.orderNo) + '</td><td class="tl"><span class="pill pill-sea">' + esc(CU_BOARDS[c.board]) + '</span></td>'
      + '<td class="tl" style="white-space:nowrap">' + esc(r.orderDate || '') + '</td><td class="tl mono">' + esc(r.sku) + '</td>'
      + '<td class="tl">' + (c.fabric ? esc(c.fabric) : '<span class="muted">no fabric set in PPC</span>') + '</td>'
      + '<td class="num">' + nf(l.pcs) + '</td><td class="num">' + m1(l.metres) + ' m</td>'
      + '<td class="tl">' + (!c.fabric ? '<span class="muted">—</span>' : ready ? '<span class="pill pill-ok">RFD on shelf</span>' : '<span style="color:var(--bad);font-weight:700">short ' + m1(short) + ' m</span>') + '</td>'
      + '<td class="tl">' + (l.printerName ? esc(l.printerName) : '<span class="muted">not chosen</span>') + (c.why ? '<div style="font-size:10.5px;color:var(--bad)">' + esc(c.why) + '</div>' : '') + '</td></tr>';
  }).join('');
  var head = th(['', 'Order', 'Board', 'Order date', 'SKU', 'RFD fabric', 'Pcs to make', 'RFD needed', 'RFD for it', 'Printer'], [6, 7])
    .replace('<th class="frz"></th>', '<th class="frz"><input type="checkbox" data-cuall="1" aria-label="Select all that can be sent"' + (nOk && sel.length === nOk ? ' checked' : '') + (nOk ? '' : ' disabled') + '></th>');
  var tp = 0, tm = 0; rows.forEach(function (c) { tp += c.ln.pcs; tm += c.ln.metres; });
  return INV_CSS + tb + '<div class="card"><div class="ff-grid"><table class="xl">' + head
    + '<tbody>' + (body || emptyRow(10, 'No SHP or Online board order matches.')) + '</tbody></table></div></div>'
    + '<div class="lm-why">' + plural(rows.length, 'line') + ' · ' + nf(tp) + ' pcs · ' + m1(tm) + ' m. Tick the lines to send (only lines that can go have a tick) and press Make challan: it shows what goes to which printer, and nothing is saved until you press Yes. A line without a tick says why (no cloth per piece on its master row, no printer from PPC, cut pieces go from Demand → RFD).</div>';
}
/** Make challan for the ticked lines: the Send-to-printer card's review (flowShReviewOpen) and writer (flowShCommit), with these lines in it. Several fabrics may go in one go. */
function cuMake() {
  var all = cuLines(); if (!all) return;
  var sel = cuFiltered(all).filter(function (c) { return UI.cuSel[c.ln.key] && !cuWhyNot(c); });
  if (!sel.length) { alert('Tick at least one line that can go.'); return; }
  if (typeof flowShReviewOpen !== 'function' || typeof flowShCommit !== 'function') { alert('The challan card is not in this app.'); return; }
  if (typeof flowScreenAllowed === 'function' && !flowScreenAllowed().some(function (b) { return b[0] === 'drfd'; })) { alert('Making an RFD challan needs Demand → RFD access.'); return; }
  var fabs = uniq(sel.map(function (c) { return c.fabric; }));
  FLOW_SH = { fabric: fabs[0], lines: sel.map(function (c) { return c.ln; }), tick: new Set(sel.map(function (c) { return c.ln.key; })), prn: {}, qty: {}, q: '', kind: '', show: '', pri: '', note: '',
    review: { note: '' }, after: function () { UI.cuSel = {}; if (UI.tab === 'inv') render(); } };
  flowShReviewOpen();
}
/* the filters and ticks of the custom list */
document.addEventListener('change', function (ev) {
  var t = ev.target; if (!t || !t.getAttribute || UI.invView !== 'custom') return;
  var f = t.getAttribute('data-cuf');
  if (f) { UI[f] = t.value; render(); return; }
  var one = t.getAttribute('data-cusel');
  if (one) { if (t.checked) UI.cuSel[one] = true; else delete UI.cuSel[one]; render(); return; }
  if (t.getAttribute('data-cuall')) {
    var all = cuLines(); if (!all) return;
    cuFiltered(all).forEach(function (c) { if (!cuWhyNot(c)) { if (t.checked) UI.cuSel[c.ln.key] = true; else delete UI.cuSel[c.ln.key]; } });
    render();
  }
});
document.addEventListener('click', function (ev) {
  var t = ev.target && ev.target.closest ? ev.target.closest('[data-cumake],[data-cuclear]') : null; if (!t || UI.invView !== 'custom') return;
  if (t.getAttribute('data-cuclear')) { UI.cuFrom = ''; UI.cuTo = ''; UI.cuPrn = ''; render(); return; }
  cuMake();
});
/** What PPC's demand asks of this fabric: 'short' (greige to order), 'ok' (covered, or covered by what is on its way),
 *  or 'none' (PPC does not need it). */
function invNeedState(r) {
  var p = r && r.ppc;
  if (!p || !(p.need > 0.05)) return 'none';
  return p.short > 0.05 && p.greigeM > 0 ? 'short' : 'ok';
}
/** A fabric earns an Inventory row when it has cloth, a PO, or a PPC need the desk can act on. A short fabric with no greige
 *  name in Master data is left out (Ravi, 21 Nov: "remove those fabrics … whose says add greige name"): no PO can be raised
 *  for it here, so the row only said "add greige name". It still shows on Demand → RFD; once Setup gives it a greige name it
 *  comes back here with its Raise PO button. */
function invWorthShowing(r) {
  if (invNeedState(r) === 'short' && !r.ppc.greige) return false;
  return r.owned > 0.05 || r.onOrder > 0.05 || invTransitM(r) > 0.05 || invNeedState(r) !== 'none';
}
/** How much of the PPC need the RFD free covers, in whole percent (0–100). */
function invCoverPct(p) { return p && p.need > 0.05 ? Math.min(100, Math.round((p.free || 0) / p.need * 100)) : 0; }
function invNeedCell(r, loading) {
  if (loading) return '<td class="tl muted">…</td>';
  var p = r.ppc;
  if (invNeedState(r) === 'none') return '<td class="tl muted" style="font-size:12px">no PPC demand</td>';
  var pct = invCoverPct(p), col = pct >= 100 ? 'var(--ok-ink)' : pct >= 50 ? 'var(--warn-ink)' : 'var(--bad)';
  var tip = 'RFD free ' + nf(p.free) + ' m' + (p.desk > 0.05 ? ' (' + nf(p.desk) + ' m on this desk)' : '') + (p.onWay > 0.05 ? ' · ' + nf(p.onWay) + ' m greige on its way' : '');
  var words = p.short > 0.05
    ? pct + '% covered · <span style="color:var(--bad);font-weight:700">' + nf(p.short) + ' short</span>' + (p.greigeM ? '' : ' · covered by what is on its way')
    : 'fully covered';
  /* the lines open Demand → RFD with only this fabric's lines (Ravi, 21 Nov) */
  return '<td class="tl" title="' + esc(tip) + '"><div><b>' + nf(p.need) + ' m</b> <span class="muted" style="font-size:11px">· </span>'
    + '<button type="button" class="link" data-gdlines="' + esc(p.name) + '" style="font-size:11px;padding:0" title="See these lines on Demand → RFD">' + plural(p.lines, 'line') + '</button></div>'
    + '<div style="height:6px;border-radius:3px;background:var(--soft);overflow:hidden;margin:5px 0 3px" role="img" aria-label="' + pct + '% covered">'
    + '<div style="height:100%;width:' + pct + '%;background:' + col + '"></div></div>'
    + '<div class="muted" style="font-size:11px">' + nf(p.free) + ' m RFD free · ' + words + '</div></td>';
}
function invActionCell(r, loading) {
  if (loading) return '<td></td>';
  var p = r.ppc, st = invNeedState(r);
  if (st === 'short' && p.greige) return '<td><button type="button" class="jw-btn jw-primary" data-ppcpo="' + esc(p.name) + '|' + p.greigeM + '" style="white-space:nowrap;padding:4px 10px;font-size:12px" title="Raise a greige PO for what PPC is short of (with the processor’s share)">Raise PO · ' + nf(p.greigeM) + ' m</button></td>';
  if (st === 'ok') return '<td><span class="pill pill-ok">covered</span></td>';
  return '<td></td>';
}
/* ---- WHAT NEEDS DOING, FIRST (Vishesh, 23 Nov: "refine the inventory design … to the best for making it more actionable") ---- *
 * Above the table, a strip of to-do tiles, each a count and the metres behind it, in the order the cloth moves:
 *   Short for PPC (greige to order) · Greige in store (to issue to RFD) · Late at the processor (over CHASE_PROCESSOR_DAYS)
 *   · RFD for PPC lines (to send to printers) · Cut pieces left (to send) · Approvals waiting (on Greige POs).
 * A tile shows only when there is something behind it; pressing it shows only those fabrics (pressing it again shows all).
 * Each fabric row has a Next step: the most pressing thing to do with it as a button, and the other things it needs as
 * small links under it. Every button is one the page already had (Raise PO, Issue to RFD, Send to printer, …): a step
 * that needs a lot or a PO opens the figure's drop-down, where the lot's own button is. Short and late rows carry a coloured
 * edge so they stand out down the list. Nothing is worked out twice: the tiles and the rows read the same tests. */
var INV_ACT = {
  store: { label: 'Greige in store', sub: 'to issue to RFD', tone: 'greige' },
  late: { label: 'Late at the processor', sub: 'over ' + CHASE_PROCESSOR_DAYS + ' days — chase', tone: 'bad' },
  send: { label: 'RFD for PPC lines', sub: 'on the shelf — send to printers', tone: 'rfd' },
  cut: { label: 'Cut pieces left', sub: 'to send to printers', tone: 'brand' },
  tocut: { label: 'Yet to be cut', sub: 'on the cutting list', tone: 'warn' }
};
INV_SHOW_LABEL.store = INV_ACT.store.label; INV_SHOW_LABEL.late = INV_ACT.late.label; INV_SHOW_LABEL.send = INV_ACT.send.label; INV_SHOW_LABEL.cut = INV_ACT.cut.label; INV_SHOW_LABEL.tocut = INV_ACT.tocut.label;
/** The lots of a fabric at an RFD processor for longer than CHASE_PROCESSOR_DAYS: [{ lot, m, days, who }]. */
function invLateOf(r) {
  return invLotsOf(r.fabric).filter(function (g) { return g.withProcessor > 0.05; }).map(function (g) {
    var out = invRowsOfLot(g.lot, 'ISSUE_TO_RFD'), d = lmDays(invLastDate(out));
    return { lot: g.lot, m: g.withProcessor, days: d, who: invJoin(out.map(function (x) { return x.party; })) };
  }).filter(function (x) { return x.days !== null && x.days > CHASE_PROCESSOR_DAYS; });
}
/** Does a fabric need this to-do (store / late / send / cut)? */
function invNeeds(r, k) {
  if (k === 'store') return r.inStoreGreige > 0.05;
  if (k === 'late') return invLateOf(r).length > 0;
  if (k === 'send') return r.inStoreRfd > 0.05 && !!(r.ppc && r.ppc.lines > 0);
  if (k === 'cut') return !!(r.cut && r.cut.leftPcs > 0);
  if (k === 'tocut') return invYetM(r) > 0;
  return false;
}
/** A row is shown under a filter: one of PPC's (all / short / ok / none) or one of the to-dos. */
function invShows(r, k) { return k === 'all' ? true : INV_ACT[k] ? invNeeds(r, k) : invNeedState(r) === k; }
/** The approvals waiting on Greige POs: RFD receipts that shrank, cuts to size, POs asked to close, printer changes. */
function invApprovalsN() {
  var n = rrPending().length + ctsWaiting().length + (DB.gpo || []).filter(function (po) { return !!po.closeAsk; }).length;
  return n + (typeof flowPrnWaiting === 'function' ? flowPrnWaiting().length : 0);
}
/** The to-do strip. */
function invTodoHtml(rows, withPpc, loading) {
  var tiles = [], m = function (list, f) { return list.reduce(function (a, r) { return a + f(r); }, 0); };
  var tile = function (k, n, big, sub, tone, attr) {
    return '<button type="button" class="gdx-tile ' + tone + (UI.invShow === k ? ' on' : '') + '" ' + attr + ' aria-pressed="' + (UI.invShow === k) + '">'
      + '<span class="gdx-n">' + nf(n) + '</span><span class="gdx-l">' + esc(big) + '</span><span class="gdx-s">' + sub + '</span></button>';
  };
  /* No "Short for PPC" or "RFD for PPC lines" tile (Ravi, 24 Nov: remove them); the filter drop-down still has both. */
  ['tocut', 'store', 'late', 'cut'].forEach(function (k) {
    var list = rows.filter(function (r) { return invNeeds(r, k); }); if (!list.length) return;
    var sub = k === 'tocut' ? ctsN(m(list, invYetM)) + ' m · ' + INV_ACT.tocut.sub
      : k === 'store' ? nf(m(list, function (r) { return r.inStoreGreige; })) + ' m · ' + INV_ACT.store.sub
      : k === 'late' ? plural(m(list, function (r) { return invLateOf(r).length; }), 'lot') + ' · ' + INV_ACT.late.sub
      : nf(m(list, function (r) { return r.cut.leftPcs; })) + ' pcs ' + INV_ACT.cut.sub;
    tiles.push(tile(k, list.length, INV_ACT[k].label, sub, INV_ACT[k].tone, 'data-invshow="' + (UI.invShow === k ? 'all' : k) + '"'));
  });
  var ap = invApprovalsN();
  if (ap) tiles.push('<button type="button" class="gdx-tile warn" data-invgo="po"><span class="gdx-n">' + nf(ap) + '</span><span class="gdx-l">Approvals waiting</span><span class="gdx-s">on Greige POs — open them →</span></button>');
  /* with the PPC tiles gone, no tiles does not mean every fabric is covered: say nothing */
  if (!tiles.length) return '';
  return '<div class="gdx-todo" role="group" aria-label="What needs doing">' + tiles.join('') + '</div>';
}
/** The Next step cell: the most pressing step as a button, the others as small links under it. */
function invNextCell(r, loading) {
  if (loading) return '<td></td>';
  var steps = [], st = invNeedState(r), F = esc(r.fabric), late = invLateOf(r);
  var btn = function (cls, attr, words, tip) { return { cls: cls, attr: attr, words: words, tip: tip }; };
  if (st === 'short' && r.ppc.greige) steps.push(btn('jw-primary', 'data-ppcpo="' + esc(r.ppc.name) + '|' + r.ppc.greigeM + '"', 'Raise PO · ' + nf(r.ppc.greigeM) + ' m', 'Raise a greige PO for what PPC is short of (with the processor’s share)'));
  if (late.length) steps.push(btn('gdx-bad', 'data-invd="' + F + '|proc"', 'Chase ' + plural(late.length, 'lot') + ' at processor', late.map(function (x) { return x.lot + ' · ' + x.who + ' · ' + x.days + ' days'; }).join('\n')));
  /* Send to printer is under RFD on shelf (invRfdCell — Ravi, 24 Nov: "sent to printer RFD ke neeche dikhna chahiye") */
  if (invNeeds(r, 'store')) steps.push(btn('jw-wa', 'data-invd="' + F + '|store"', 'Issue ' + nf(r.inStoreGreige) + ' m to RFD', 'Open the greige lots in the store, each with its Issue to RFD'));
  if (invNeeds(r, 'cut')) steps.push(btn('', 'data-ctssend="' + F + '"', 'Send ' + nf(r.cut.leftPcs) + ' cut pcs', 'Make an RFD challan from the pieces already cut to size'));
  if (r.onOrder > 0.05) steps.push(btn('', 'data-invd="' + F + '|order"', 'Receive greige', nf(r.onOrder) + ' m still due on open POs'));
  if (!steps.length) return '<td>' + (st === 'ok' ? '<span class="pill pill-ok">covered</span>' : '<span class="muted" style="font-size:12px">nothing to do</span>') + '</td>';
  var a = steps[0];
  return '<td class="gdx-next"><button type="button" class="jw-btn ' + a.cls + '" ' + a.attr + ' title="' + esc(a.tip) + '">' + esc(a.words) + '</button>'
    + (steps.length > 1 ? '<div class="gdx-more">' + steps.slice(1).map(function (s) { return '<button type="button" class="link" ' + s.attr + ' title="' + esc(s.tip) + '">' + esc(s.words) + '</button>'; }).join('') + '</div>' : '')
    + (st === 'ok' ? '<div><span class="pill pill-ok" style="margin-top:4px">covered</span></div>' : '') + '</td>';
}
/** The coloured edge of a row: red when short for PPC, amber when cloth is late at a processor. */
function invEdge(r) { return invNeedState(r) === 'short' ? 'var(--bad)' : invLateOf(r).length ? 'var(--warn-ink)' : ''; }
var INV_CSS = '<style>'
  + '.gdx-todo{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;margin:0 0 10px}'
  + '.gdx-tile{display:flex;flex-direction:column;align-items:flex-start;gap:1px;text-align:left;padding:9px 12px;border-radius:14px;border:1px solid var(--line);background:var(--card);cursor:pointer;box-shadow:none;color:var(--ink);height:auto;min-height:0;white-space:normal;position:relative;overflow:hidden}'
  + '.gdx-tile:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--tone)}'
  + '.gdx-tile:hover{border-color:var(--tone);background:var(--soft)}'
  + '.gdx-tile.on{border-color:var(--tone);box-shadow:0 0 0 2px var(--tone) inset;background:var(--soft)}'
  + '.gdx-tile.bad{--tone:var(--bad)}.gdx-tile.greige{--tone:var(--c-greige)}.gdx-tile.rfd{--tone:var(--c-rfd)}.gdx-tile.brand{--tone:var(--brand)}.gdx-tile.warn{--tone:var(--warn-ink)}'
  + '.gdx-n{font-size:20px;font-weight:800;line-height:1.1;color:var(--tone)}'
  + '.gdx-l{font-size:13px;font-weight:700}.gdx-s{font-size:11.5px;color:var(--muted)}'
  + '.gdx-clear{margin:0 0 12px;padding:12px 16px;border-radius:14px;background:var(--accent-bg);color:var(--ok-ink);font-weight:700;font-size:13px}'
  + '.gdx-next{text-align:left}.gdx-next .jw-btn{padding:5px 11px;font-size:12px}'
  + '.gdx-bad{background:var(--bad-bg)!important;color:var(--bad)!important;border-color:var(--bad-line)!important}'
  + '.gdx-more{display:flex;flex-direction:column;align-items:flex-start;gap:2px;margin-top:5px}.gdx-more .link{font-size:11.5px;padding:0}'
  /* NO SIDEWAYS SLIDING (Vishesh, 27 Nov): the stock table and the lists under a row fit the screen -- tight cells, words
   * that wrap, figures that stay whole. Child selectors, so the lists keep their own look. */
  + 'table.xl.gdx-inv>thead>tr>th,table.xl.gdx-inv>tbody>tr>td{padding:7px 4px;white-space:normal}'
  + 'table.xl.gdx-inv>thead>tr>th{font-size:10px;line-height:1.25;letter-spacing:0}'
  + 'table.xl.gdx-inv>tbody>tr>td.frz{max-width:190px;padding-left:10px}table.xl.gdx-inv>tbody>tr>td.num>.cellbtn{white-space:nowrap}'
  + '.gdx-stack{display:flex;flex-direction:column;align-items:center;gap:4px}.gdx-stack .jw-btn{white-space:nowrap;padding:5px 11px;font-size:12px}'
  + '.invdrop .ct th{position:static;text-align:left;font-size:10px;letter-spacing:0;padding:6px 5px;white-space:normal}'
  + '.invdrop .ct td{text-align:left;font-size:12px;padding:6px 5px;white-space:normal;overflow-wrap:anywhere}'
  + '.invdrop .ct th.num,.invdrop .ct td.num{text-align:right}.invdrop .ct td.num,.invdrop .ct td.gdx-keep{white-space:nowrap;overflow-wrap:normal}'
  + '.invdrop .ct td.gdx-wrap{min-width:130px}.invdrop .ct td .jw-btn{padding:4px 8px;font-size:11.5px;margin:1px 0;white-space:nowrap}'
  + '</style>';
function renderInv() {
  var all = invAll(), types = uniq(all.map(function (x) { return x.type; })).sort();
  if (UI.inv !== 'all' && types.indexOf(UI.inv) < 0) UI.inv = 'all';
  var count = function (t) { return all.filter(function (x) { return t === 'all' || x.type === t; }).length; };
  /* EVERY CLOTH TYPE IN ONE DROP-DOWN BESIDE THE SEARCH BOX (Ravi, 21 Nov: the row of chips ran off the screen with the
   * real fabrics). "All" first, then each type with how many fabrics it holds. */
  $('lmTopPick').innerHTML = '<select id="invType" aria-label="Type of cloth">'
    + ['all'].concat(types).map(function (t) {
      return '<option value="' + esc(t) + '"' + (UI.inv === t ? ' selected' : '') + '>' + esc(t === 'all' ? 'All' : t) + ' (' + count(t) + ')</option>';
    }).join('') + '</select>';
  /* PPC DEMAND FIRST (Ravi, 15 Oct): what PPC needs, and the greige PO for what is short, from here. Only in the app. */
  var ppcMap = typeof gdPpcMap === 'function' ? gdPpcMap() : null, withPpc = !!ppcMap, loading = !!(ppcMap && ppcMap.__loading);
  var inView = all.filter(function (x) { return (UI.inv === 'all' || x.type === UI.inv) && (lmMatch(x.fabric) || lmMatch(x.greige) || lmMatch(x.type)); });
  if ((!withPpc || loading) && !INV_ACT[UI.invShow]) UI.invShow = 'all';
  var shown = function (k) { return inView.filter(function (x) { return invShows(x, k); }); };
  /* short first, then late, then covered, then those PPC does not need */
  var rows = shown(UI.invShow).sort(function (a, b) {
    return INV_SHOW_ORDER[invNeedState(a)] - INV_SHOW_ORDER[invNeedState(b)] || (invLateOf(b).length ? 1 : 0) - (invLateOf(a).length ? 1 : 0);
  });
  var byCut = invTransitColumn();
  UI.invCols = (withPpc ? 9 : 8) + (byCut ? 1 : 0);
  var tools = '<div class="row" style="margin:0 0 10px;align-items:center;flex-wrap:wrap;gap:8px">'
    + (withPpc && !loading ? '<div class="seg" role="tablist" aria-label="Show">' + ['all', 'short', 'ok', 'none'].map(function (k) {
        return '<button type="button" role="tab" class="segbtn' + (UI.invShow === k ? ' on' : '') + '" aria-selected="' + (UI.invShow === k) + '" data-invshow="' + k + '">'
          + INV_SHOW_LABEL[k] + ' <span class="n">' + shown(k).length + '</span></button>';
      }).join('') + '</div>' : '')
    + (INV_ACT[UI.invShow] ? '<span class="pill pill-sea">Showing: ' + esc(INV_SHOW_LABEL[UI.invShow]) + ' <button type="button" class="link" data-invshow="all" style="padding:0 0 0 4px" aria-label="Show all">✕</button></span>' : '')
    + '<span style="margin-left:auto"></span>'
    + (canLedgerEdit() ? '<button type="button" class="ghost" data-act="OPENING_RFD" title="RFD already on the floor: its own lot, so it is issued like any other and never counted as cloth back from a processor.">+ RFD opening stock</button>' : '')
    + (withPpc ? '<button type="button" class="ghost" data-invview="custom" title="The made-to-order lines of the SHP board and the Online board, waiting for RFD">Custom orders · SHP / Online</button>' : '')
    + (withPpc ? '<button type="button" class="ghost" data-gdflow="drfd" title="Open the flow’s Demand → RFD">Demand → RFD</button>' : '')
    + '</div>';
  var stockHeads = ['Greige ordered', 'Greige in store', 'At RFD processor', 'RFD on shelf', 'Cut to size'].concat(byCut ? ['In transit to printers'] : []);
  var group = '<tr><th class="frz"></th>' + (withPpc ? '<th></th>' : '') + '<th></th>'
    + '<th colspan="' + stockHeads.length + '" style="text-align:center;color:var(--muted);font-weight:600;border-bottom:0">Where the cloth is now →</th><th></th></tr>';
  var heads = th(withPpc ? ['Fabric', 'PPC need, covered by RFD', 'Next step'].concat(stockHeads, ['Total']) : ['Fabric', 'Next step'].concat(stockHeads, ['Total']),
    (withPpc ? [3, 4, 5, 6, 7, 8] : [2, 3, 4, 5, 6, 7]).concat(byCut ? [withPpc ? 9 : 8] : [])).replace('<thead>', '<thead>' + group);
  if (UI.invView === 'custom' && withPpc && !loading) return cuHtml();
  var table = INV_CSS + invTodoHtml(inView, withPpc, loading) + tools + '<div class="card"><div class="ff-grid"><table class="xl gdx-inv">' + heads
    + '<tbody>' + (rows.map(function (r) {
      var edge = invEdge(r);
      return '<tr><td class="frz" style="text-align:left' + (edge ? ';box-shadow:inset 4px 0 0 ' + edge : '') + '">' + invFabricName(r.fabric)
        + (r.greige ? '<div class="muted" style="font-size:10.5px">bought as ' + esc(r.greige) + '</div>' : '') + '</td>'
        + (withPpc ? invNeedCell(r, loading) : '') + invNextCell(r, loading)
        + invCell(r, 'order', r.onOrder, 'color:var(--warn-ink)')
        + invCell(r, 'store', r.inStoreGreige, '')
        + invCell(r, 'proc', r.atProcessor, 'color:var(--proc-ink)')
        + invRfdCell(r)
        + invCutCell(r)
        + (byCut ? invTransitCell(r) : '')
        + '<td class="num" style="font-weight:700">' + dash(r.owned) + '</td></tr>'
        + (UI.invOpen.indexOf(r.fabric + '|') === 0 ? invDetail(r, UI.invOpen.split('|')[1]) : '');
    }).join('') || emptyRow(UI.invCols, UI.invShow !== 'all' ? 'No fabric is ' + INV_SHOW_LABEL[UI.invShow].toLowerCase() + (UI.inv === 'all' ? '.' : ' in ' + UI.inv + '.')
      : 'Nothing on order or in stock' + (UI.inv === 'all' ? '.' : ' for ' + UI.inv + '.')))
    + '</tbody>'   /* no Total row (Ravi, 21 Nov): metres of different cloths added together told nobody anything */
    + '</table></div></div>'
    + (withPpc ? '<div class="lm-why">Metres. The bar shows how much of the PPC need the RFD free covers; Raise PO orders the greige with '
      + Math.round((typeof GD_LOSS !== 'undefined' ? GD_LOSS : 0.05) * 100) + '% for what the processor takes.</div>' : '');
  return table;
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
/* EACH LOT AS IT STANDS NOW (Ravi, 24 Nov: "all the lots should show me the data of actual fabric left in inventory and the
 * final should show me the total of those lots"). A challan to a printer is by fabric, not by lot, so its metres come off the
 * lots oldest first (by the day each came onto the shelf). The lots then add up to RFD on shelf; the challans themselves are
 * in the stock history only. { <lot>: metres left }. */
function invLotsLeft(fabric, out) {
  var left = {}, due = Math.max(0, +out || 0);
  invLotsOf(fabric).filter(function (g) { return g.rfdLeft > 0.05; }).map(function (g) {
    return { g: g, d: invLastDate(invRowsOfLot(g.lot, 'RECEIVE_RFD')) || g.date || '' };
  }).sort(function (a, b) { return a.d.localeCompare(b.d) || String(a.g.lot).localeCompare(String(b.g.lot)); }).forEach(function (x) {
    var take = Math.min(due, x.g.rfdLeft); due -= take; left[x.g.lot] = Math.round((x.g.rfdLeft - take) * 100) / 100;
  });
  return left;
}
function invRowsOfLot(lot, kind) { return (DB.fab || []).filter(function (r) { return r.lot === lot && r.txnType === kind; }); }
var invJoin = function (list) { return uniq(list).join(', ') || '—'; };
var invLastDate = function (rows) { return rows.map(function (r) { return r.date; }).sort().pop() || ''; };
/* A small "N waiting approval" note beside Send to printer when someone asked to change the printer on an RFD challan for this
 * fabric and the approver has not answered yet (Vishesh, 23 Nov). Nothing shows while the flow's request list is not there. */
function gdPrnWaitingPill(fabric) {
  var n = typeof flowPrnWaiting === 'function' ? flowPrnWaiting(fabric).length : 0;
  return n > 0 ? ' <span class="pill" title="A change of printer was asked and waits for the approver">' + n + ' waiting approval</span>' : '';
}
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
        + '<td class="tl mono">' + (uniq(out.map(function (x) { return x.bill; }).filter(Boolean)).map(function (b) { return '<button type="button" class="link mono" style="padding:0" data-rfdpo="' + esc(b) + '" title="Open the RFD PO">' + esc(b) + '</button>'; }).join(', ') || '—') + '</td><td class="tl">' + esc(fmtD(sentOn)) + '</td>'
        + '<td class="num"' + (d > CHASE_PROCESSOR_DAYS ? ' style="color:var(--bad);font-weight:700"' : '') + '>' + (d === null ? '—' : d + ' d') + '</td>'
        + '<td class="num">' + nf(g.toRfd) + ' m</td><td class="num">' + (g.rfdIn ? nf(g.rfdIn) + ' m' : '—') + '</td><td class="num b">' + nf(g.withProcessor) + ' m</td>'
        + '<td class="tl">' + esc(g.poNo || '—') + '</td>'
        + '<td>' + (g.poNo ? '<button type="button" class="jw-btn jw-wa" data-rr="' + esc(g.poNo) + '|' + esc(g.lot) + '">Receive RFD</button>' : '') + '</td></tr>';
    });
    empty = 'Nothing of ' + r.fabric + ' is at an RFD processor.';
  } else if (col === 'transit' || col === 'tocut') {
    head = []; body = []; empty = col === 'tocut' ? 'Nothing of ' + r.fabric + ' is waiting to be cut.' : '';
  } else if (col === 'cut') {
    head = ['Size (W × L)', 'Cut', 'Sent to printer', 'Left', 'Status', 'Next step'];
    body = ctsDetailRows(r.cut, r.fabric);
    empty = 'Nothing has been cut to size from ' + r.fabric + ' yet.';
  } else {
    /* no buttons on a lot (Vishesh, 27 Nov): Send to printer is under RFD on shelf, and cutting is allotted from its card */
    head = ['Lot', 'PO', 'Supplier challan', 'RFD processor', 'Back on', 'Came back', 'To cutting', 'Damaged', 'On shelf'];
    var left = invLotsLeft(r.fabric, r.rfdToPrinters);
    body = invLotsOf(r.fabric).filter(function (g) { return left[g.lot] > 0.05; }).map(function (g) {
      var rec = invRowsOfLot(g.lot, 'RECEIVE_GREIGE'), back = invRowsOfLot(g.lot, 'RECEIVE_RFD');
      var came = g.rfdIn + g.rfdOpen + g.rfdBuy, how = g.rfdOpen ? 'opening stock' : g.rfdBuy ? 'bought ready' : '';
      return '<tr><td class="tl mono b">' + esc(g.lot) + (how ? '<div class="sub">' + how + '</div>' : '') + '</td>'
        + '<td class="tl">' + esc(invJoin(rec.map(function (x) { return x.orderNo; }))) + '</td>'
        + '<td class="tl mono">' + esc(invJoin(rec.map(function (x) { return x.bill; }))) + '</td>'
        + '<td class="tl">' + esc(g.processor || '—') + '</td><td class="tl">' + esc(fmtD(invLastDate(back) || g.date)) + '</td>'
        + '<td class="num">' + nf(came) + ' m</td><td class="num">' + (g.rfdOut ? nf(g.rfdOut) + ' m' : '—') + '</td>'
        + '<td class="num">' + (g.dmgRfd ? '<span class="err-in">' + nf(g.dmgRfd) + ' m</span>' : '—') + '</td><td class="num b">' + nf(left[g.lot]) + ' m</td></tr>';
    });
    empty = 'No RFD ' + r.fabric + ' is on the shelf.';
  }
  var title = { order: 'Greige on order', store: 'Greige in the store', proc: 'At the RFD processor', rfd: 'RFD on the shelf', cut: 'Cut to size', transit: 'In transit to printers', tocut: 'Yet to be cut' }[col];
  /* the products allotted to cutting; the cut-with-no-product table is left out when only these are there */
  var listed = col === 'tocut' ? flowCpYetToCut(r.cutCh) : col === 'cut' && (r.cutCh || []).length ? flowCpAlreadyCut(r.cutCh) : [];
  var pieces = listed.length ? flowCpTableHtml(listed) : '';
  return '<tr class="invdet"><td colspan="' + (UI.invCols || 6) + '"><div class="invdrop"><div class="sect">' + esc(title) + ' · ' + esc(r.fabric) + '</div>'
    + (col === 'cut' && r.cut.leftPcs > 0 ? '<div class="actions" style="justify-content:flex-start;margin:6px 0"><button type="button" class="jw-btn jw-primary" data-ctssend="' + esc(r.fabric) + '" title="Make an RFD challan to a printer from the pieces already cut">Send to printer</button></div>' : '')
    + pieces
    + (col === 'transit' ? invTransitHtml(r) : pieces && !body.length ? '' : body.length ? '<div class="box scroll"><table class="ct li"><thead><tr>' + head.map(function (x, i) {
        return '<th' + (/^(Ordered|Received|Still due|Sent|Back so far|Still out|In store|Came back|To cutting|Damaged|On shelf|Days out|Sent to RFD|Cut|Sent to printer|Left)$/.test(x) ? ' class="num"' : '') + '>' + esc(x) + '</th>';
      }).join('') + '</tr></thead><tbody>' + body.join('') + '</tbody></table></div>'
      : '<div class="empty">' + esc(empty) + '</div>')
    + (col === 'rfd' && !invTransitColumn() ? invTransitHtml(r) : '')
    + '</div></td></tr>';
}
/** A figure that opens its drop-down; a dash when there is nothing behind it. */
/* IN TRANSIT TO PRINTERS (Vishesh, 23 Nov: "dont add a new column but just add a small line under it, and when I click on the value
 * show against which order it is in transit"). Under RFD on shelf: the metres on RFD challans the printer has not yet marked
 * received. They are already off the shelf figure and not in the total; once received they are gone from our count. */
/* SEND TO PRINTER UNDER THE SHELF (Ravi, 24 Nov): the RFD on the shelf is what goes to the printers, so its button is in this cell,
 * under the figure — with the "N waiting approval" note beside it. */
function invRfdCell(r) {
  var tr = invTransitM(r), send = invNeeds(r, 'send');
  if (invTransitColumn()) tr = 0;   // it has its own column
  var yet = invYetM(r);
  if (!(tr > 0.05) && !send && !(yet > 0)) return invCell(r, 'rfd', r.inStoreRfd, 'font-weight:700');
  return '<td class="num"><div class="gdx-stack">' + (r.inStoreRfd > 0.05 ? invCellBtn(r, 'rfd', r.inStoreRfd, 'font-weight:700') : '<span class="muted">&mdash;</span>')
    + (tr > 0.05 ? '<div style="font-size:10.5px;color:var(--warn-ink);font-weight:600;white-space:nowrap">+ ' + nf(tr) + ' m in transit to printers</div>' : '')
    + invYetHtml(r, yet)
    + (send ? '<button type="button" class="jw-btn jw-primary" data-gdsend="' + esc(r.fabric) + '" title="Make an RFD challan to a printer for the ' + plural(r.ppc.lines, 'line') + ' waiting">Send to printer</button>'
      + (typeof gdPrnWaitingPill === 'function' ? gdPrnWaitingPill(r.fabric) : '') : '') + '</div></td>';
}
/* A COLUMN OF ITS OWN (Vishesh, 27 Nov): what is sent to a printer shows here, not under RFD on shelf,
 * until the printer marks it received. */
function invTransitColumn() { return typeof flowCpList === 'function'; }
function invTransitCell(r) { return invCell(r, 'transit', invTransitM(r), 'color:var(--warn-ink)'); }
/* YET TO BE CUT (Vishesh, 27 Nov): what was ticked on the card's Cut pieces tab shows under RFD on shelf until it is cut;
 * pressing it lists what to cut, how many, the length of each piece and the total length. */
function invYetM(r) { return r2((r.cutCh || []).filter(function (x) { return x.status === 'wait' || x.status === 'ready'; }).reduce(function (a, x) { return a + x.metres; }, 0)); }
function invYetHtml(r, yet) {
  if (!(yet > 0)) return '';
  return '<div><button type="button" class="link" data-invd="' + esc(r.fabric + '|tocut') + '" aria-expanded="' + (UI.invOpen === r.fabric + '|tocut') + '" style="font-size:11px;color:var(--warn-ink);font-weight:700;white-space:nowrap" title="Show what is to be cut">+ ' + ctsN(yet) + ' m yet to be cut</button></div>';
}
/** The metres of a row still on their way to printers. */
function invTransitM(r) { return (r.transit || []).reduce(function (a, x) { return a + (+x.metres || 0); }, 0); }
/** The challan lines of this fabric not yet received by the printer, since the desk began counting it; [] when the flow is not read. */
function invTransit(name) {
  if (typeof flowClothInTransit !== 'function' || typeof FLOW === 'undefined' || !FLOW || !FLOW.cloth) return [];
  var opened = gdRfdOpened(name); if (!opened) return [];
  try { return flowClothInTransit(name, opened) || []; } catch (e) { console.warn('In transit for ' + name + ': not counted (' + ((e && e.message) || e) + ').'); return []; }
}
/** The "In transit to printers" list under the RFD lots: challan, printer, order, SKU, metres, sent. */
function invTransitHtml(r) {
  var list = r.transit || []; if (!list.length) return '';
  var pri = invTransitColumn();
  if (pri) list = flowPriSort(list.map(function (x) { return Object.assign({ priority: flowPri(x.orderNo, x.sku), orderDate: x.date }, x); }), function (x) { return x; });
  return '<div class="sect" style="margin-top:10px">In transit to printers · ' + nf(invTransitM(r)) + ' m</div>'
    + '<div class="box scroll"><table class="ct li"><thead><tr>' + (pri ? '<th>Priority</th>' : '') + '<th>Challan</th><th>Printer</th><th>Order</th><th>SKU</th><th class="num">Metres</th><th>Sent</th></tr></thead><tbody>'
    + list.map(function (x) {
      return '<tr>' + (pri ? '<td class="b">' + esc(flowPriText(x.priority)) + '</td>' : '') + '<td class="mono">' + esc(x.no) + '</td><td class="tl">' + esc(x.vendor) + '</td><td class="mono">' + esc(x.orderNo) + '</td><td class="mono">' + esc(x.sku)
        + '</td><td class="num">' + nf(x.metres) + ' m</td><td>' + esc(fmtD(x.date)) + '</td></tr>';
    }).join('') + '</tbody></table></div>'
    + '<div class="muted" style="font-size:11.5px;margin-top:4px">A line leaves this list when the printer presses "Cloth received" in their portal; its metres then leave our inventory.</div>';
}
function invCell(r, col, v, style) {
  if (!(v > 0.05)) return '<td class="num"' + (style ? ' style="' + style + '"' : '') + '><span class="muted">&mdash;</span></td>';
  return '<td class="num">' + invCellBtn(r, col, v, style) + '</td>';
}
/** The figure as the button that opens its drop-down. */
function invCellBtn(r, col, v, style) {
  var key = r.fabric + '|' + col, on = UI.invOpen === key;
  return '<button type="button" class="cellbtn' + (on ? ' on' : '') + '" data-invd="' + esc(key) + '" aria-expanded="' + on + '"'
    + (style ? ' style="' + style + '"' : '') + ' title="Show what makes this up">' + nf(v) + ' <span class="caret">' + (on ? '▴' : '▾') + '</span></button>';
}
/** A PO opens on Greige POs, expanded -- and the challan inside it too, when there is one. */
function invOpenPo(poNo, chId) {
  PV.openPo[poNo] = true; if (chId) PV.openCh[chId] = true;
  PV.view = 'po'; PV.st = ''; UI.tab = 'po'; render(); window.scrollTo(0, 0);
}
function wireInventory() {
  document.addEventListener('click', function (ev) {
    var d = ev.target.closest ? ev.target.closest('[data-invd],[data-openpo],[data-invh],[data-histshelf],[data-histday],[data-histpo],#histAll,#histXlsx,[data-invshow],[data-invview],[data-invboard],[data-invgo]') : null;
    if (d && d.getAttribute('data-invgo')) { UI.tab = d.getAttribute('data-invgo'); UI.invOpen = ''; render(); return; }
    if (d && d.getAttribute('data-invd')) { var k = d.getAttribute('data-invd'); UI.invOpen = UI.invOpen === k ? '' : k; render(); return; }
    if (d && d.getAttribute('data-openpo')) { invOpenPo(d.getAttribute('data-openpo')); return; }
    if (d && d.getAttribute('data-invh')) { invHistOpen(d.getAttribute('data-invh')); return; }
    if (d && d.getAttribute('data-histshelf')) { INV_HIST.shelf = d.getAttribute('data-histshelf'); invHistDraw(); return; }
    if (d && d.getAttribute('data-histday')) { var day = d.getAttribute('data-histday'); INV_HIST.open[day] = !INV_HIST.open[day]; invHistDraw(); return; }
    if (d && d.id === 'histAll') { invHistOpenAll(); return; }
    if (d && d.getAttribute('data-histpo')) { var p = d.getAttribute('data-histpo').split('|'); $('lmHist').classList.add('hide'); invOpenPo(p[0], p[1]); return; }
    if (d && d.id === 'histXlsx') { invHistXlsx(); return; }
    if (d && d.getAttribute('data-invview')) { UI.invView = d.getAttribute('data-invview'); render(); return; }
    if (d && d.getAttribute('data-invboard')) { UI.invBoard = d.getAttribute('data-invboard'); render(); return; }
    if (d && d.getAttribute('data-invshow')) { UI.invShow = d.getAttribute('data-invshow'); UI.invOpen = ''; render(); return; }
  });
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-cp],[data-cpf],[data-cpdl]') : null; if (!t) return;
    if (t.hasAttribute('data-cpf')) { flowCpPickStatus(t); return; }
    if (t.hasAttribute('data-cpdl')) { var bad = flowCpDownload(t.closest('[data-cpwrap]')); if (bad) lmSay('err', bad); return; }
    t.disabled = true;
    flowCpPress(t.getAttribute('data-cp'), t.getAttribute('data-cpkey')).then(function (said) {
      render(); if (said) lmSay(said.ok ? 'ok' : 'err', said.text);
    }, function (e) { console.error('Cut to size button failed:', e); render(); lmSay('err', 'Not saved: ' + ((e && e.message) || e)); });
  });
  document.addEventListener('input', function (ev) { if (ev.target.getAttribute && ev.target.getAttribute('data-cpq')) flowCpFilter(ev.target.closest('[data-cpwrap]')); });
  document.addEventListener('change', function (ev) {
    if (ev.target.id === 'invType') { UI.inv = ev.target.value || 'all'; UI.invOpen = ''; render(); return; }
    if (ev.target.id !== 'histFrom' && ev.target.id !== 'histTo') return;
    INV_HIST.from = $('histFrom').value; INV_HIST.to = $('histTo').value; invHistDraw();
  });
}

/* ---- A FABRIC'S STOCK HISTORY (Ravi, 20 Nov: click the fabric name, see every in and out "in the tally ledger format") ---- *
 *
 * A pop-up over the Inventory page: one tab per shelf (RFD on the shelf first, then greige in the store), each a
 * ledger page -- date, cause, opening, in, out, closing -- worked out by fabShelfLedger, so its last closing is the
 * figure on the page. A row with a PO opens that PO (and its challan) on Greige POs.
 * Errors: it only reads, so nothing here can lose data. The one thing that can fail is the Excel file; that says so in
 * the toast and on the console, and nothing is downloaded. */
var INV_HIST = { fabric: '', shelf: 'rfd', from: '', to: '', open: {} };   // open: the dates shown opened
var INV_SHELF_LABEL = { rfd: 'RFD on shelf', greige: 'Greige in store' };

/** The fabric's name on the Inventory page: a button to its history for whoever may see the fabric ledger. */
function invFabricName(fabric) {
  if (!canLedger()) return '<b>' + esc(fabric) + '</b>';
  return '<button type="button" class="link" style="font-size:inherit;padding:0;text-align:left" data-invh="' + esc(fabric) + '" title="See every in and out of ' + esc(fabric) + '">'
    + esc(fabric) + '</button>';
}
function invHistOpen(fabric) {
  INV_HIST.fabric = fabric; INV_HIST.shelf = 'rfd'; INV_HIST.from = ''; INV_HIST.to = ''; INV_HIST.open = {};
  invHistMount();
  $('histFrom').value = ''; $('histTo').value = '';
  var m = mstOf(fabric);
  $('histTitle').textContent = fabric + ' — stock history';
  $('histSub').textContent = m && m.greige ? 'bought as ' + m.greige : '';
  invHistDraw();
  $('lmHist').classList.remove('hide');
}
/** The pop-up's frame, made once: the tabs and the date boxes stay put while the ledger under them is redrawn. */
function invHistMount() {
  if ($('lmHist')) return;
  var box = document.createElement('div');
  box.className = 'modal hide'; box.id = 'lmHist';
  box.innerHTML = '<div class="modalbox" style="width:min(980px,100%)">'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">'
    + '<div><div class="crumb">Stock history</div><h2 style="margin:2px 0 0;font-size:19px" id="histTitle"></h2><div class="sub" id="histSub"></div></div>'
    + '<button type="button" class="x" data-close="lmHist" aria-label="Close">×</button></div>'
    + '<div class="toolbar" style="margin:14px 0 10px">'
    + '<div class="seg" role="tablist" aria-label="Which stock" id="histTabs"></div>'
    + '<div class="pair" style="margin-left:auto"><label class="inl" for="histFrom">From</label><input type="date" id="histFrom" style="width:150px;height:34px;padding-block:0"></div>'
    + '<div class="pair"><label class="inl" for="histTo">To</label><input type="date" id="histTo" style="width:150px;height:34px;padding-block:0"></div>'
    + '<button type="button" class="ghost" id="histXlsx" style="height:34px;padding:0 14px">Download Excel</button></div>'
    + '<div id="histBody"></div></div>';
  document.body.appendChild(box);
}
/* THE CHALLANS TO PRINTERS IN THE HISTORY (Ravi, 24 Nov): the register, plus one "RFD to printer" row per RFD challan of this
 * fabric since the desk began counting it -- the same challans, by the same rule, that the Inventory page takes off RFD on the
 * shelf -- so the history closes on the Inventory figure. Nothing is written; the flow not read → the register alone. */
function invHistRows(fabric) { return (DB.fab || []).concat(gdChallanRows(fabric)); }
/** The RFD challans to printers of one fabric since the desk began counting it, as rows shaped like the register's own
 *  (flow: true -- never saved, never edited). [] when the fabric was never counted or the flow is not read. */
function gdChallanRows(fabric) {
  var rows = [], opened = gdRfdOpened(fabric);
  if (!opened || typeof flowRfdChallanMoves !== 'function' || typeof FLOW === 'undefined' || !FLOW || !FLOW.ch) return rows;
  try {
    flowRfdChallanMoves(fabric, opened).forEach(function (m) {
      rows.push({ id: 'ch:' + m.no + ':' + fabric + ':' + (m.metres < 0 ? 'back' : 'out'), date: m.date, lot: '', fabricType: fabric, state: 'RFD', flow: true, done: true,
        txnType: m.metres < 0 ? 'RFD_BACK_FROM_PRINTER' : 'RFD_TO_PRINTER', qty: Math.abs(m.metres), party: m.vendor, bill: m.no, orderNo: '' });
    });
  } catch (e) { console.warn('Challans to printers for ' + fabric + ': not listed (' + ((e && e.message) || e) + ').'); }
  return rows;
}
/* EVERY MOVEMENT ON THE FABRIC LEDGER (Ravi, 25 Nov: "all entries to be filled in ledger including the transition of the fabric
 * from the inventory"). The register holds greige in, sent for RFD, RFD back, to cutting, cut pieces to printer and damage; the
 * RFD that leaves the shelf on a challan to a printer is the flow's record, so it is added here as read-only rows -- the same
 * challans, by the same rule, that Inventory takes off RFD on the shelf. One row per challan per fabric. */
function ledChallanRows() {
  var out = [];
  uniq(fabFlowRows(DB.fab || []).map(function (e) { return e.fabricType; })).forEach(function (f) { out = out.concat(gdChallanRows(f)); });
  return out;
}
/** +1 in, −1 out, for a register row or a challan row. */
function ledSign(r) { return r.flow ? (r.txnType === 'RFD_BACK_FROM_PRINTER' ? 1 : -1) : (FAB_SIGN[r.txnType] || 0); }
/** Open every date, or close them all when all are already open. */
function invHistOpenAll() {
  var H = INV_HIST, days = histDays(fabShelfLedger(invHistRows(H.fabric), H.fabric, H.shelf, H.from, H.to).lines);
  var all = days.length && days.every(function (d) { return H.open[d.date]; });
  H.open = {}; if (!all) days.forEach(function (d) { H.open[d.date] = true; });
  invHistDraw();
}
/** The PO an entry belongs to: its own, or its lot's (an issue to RFD or to cutting is written against the lot). */
function invHistPoOf(r, lotPo) { return String(r.orderNo || lotPo[r.lot] || '').trim(); }
/** The cause line and the details under it, as the floor says them. */
function invHistCause(r) {
  var party = String(r.party || '').trim();
  return (FAB_LABEL[r.txnType] || r.txnType) + (party && party !== 'Cutting' ? ' · ' + party : '');
}
function invHistDetails(r, po) {
  var bill = { RECEIVE_GREIGE: 'challan ', ISSUE_TO_RFD: 'our challan ', RECEIVE_RFD: 'their challan ', RFD_TO_PRINTER: 'RFD challan ', RFD_BACK_FROM_PRINTER: 'RFD challan ' }[r.txnType] || 'bill ';
  return [r.lot ? 'Lot ' + r.lot : '', r.bill ? bill + r.bill : '', po ? 'PO ' + po : '', r.forOrders ? 'for ' + r.forOrders : '', r.note || r.remark || '']
    .filter(Boolean).join(' · ');
}
/* THE STOCK HISTORY, FOLDED BY DATE (Ravi, 21 Nov: "put an dropdown in the date … till then it should show only opening
 * and closing balance and also in and out should be hidden and only pops up when it is clicked on the date").
 * On top, the period in four figures: Opening · Came in · Went out · Closing. Below, one line per date — the date with
 * its weekday, what moved that day ("+594 in", "−300 out") and its opening and closing balance — under a month heading.
 * A click on the date opens its movements: an "in" label (green) for cloth that came in, "out" (red) for cloth that went out, the details,
 * and the balance after each. "Open all" opens every date. A movement with a PO still opens that PO. The Excel keeps
 * plain numbers. */
function histIn(m) { return '<span style="color:var(--ok-ink);font-weight:600;white-space:nowrap">+' + nf(m) + '</span>'; }
function histOut(m) { return '<span style="color:var(--bad);font-weight:600;white-space:nowrap">−' + nf(m) + '</span>'; }
/** One movement's metres, signed: what came in, or what went out. */
function histMove(x) { return x.inQty ? histIn(x.inQty) : x.outQty ? histOut(x.outQty) : ''; }
/** The history split into days (Ravi, 21 Nov: "opening balance and closing balance for each date"): each day opens on
 *  the balance before its first movement and closes on the balance after its last, with what came in and went out that
 *  day. The lines keep their order; a day is every line with the same date. */
function histDays(lines) {
  var days = [];
  lines.forEach(function (x) {
    var d = days[days.length - 1];
    if (!d || d.date !== x.row.date) { d = { date: x.row.date, opening: x.opening, closing: x.closing, inQty: 0, outQty: 0, lines: [] }; days.push(d); }
    d.lines.push(x); d.closing = x.closing; d.inQty += x.inQty || 0; d.outQty += x.outQty || 0;
  });
  return days;
}
var HIST_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var HIST_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** A business date (YYYY-MM-DD) read as that calendar day, wherever the PC's clock is. */
function histDateParts(ymd) { var p = String(ymd || '').split('-').map(Number); return { y: p[0], m: p[1] - 1, d: p[2], w: new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() }; }
/** "Fri 20 Nov" — the day line's date. */
function histDayName(ymd) { var p = histDateParts(ymd); return p.y ? HIST_WEEKDAYS[p.w] + ' ' + p.d + ' ' + HIST_MONTHS[p.m].slice(0, 3) : ''; }
/** "November 2026" — the heading over a month's dates. */
function histMonthName(ymd) { var p = histDateParts(ymd); return p.y ? HIST_MONTHS[p.m] + ' ' + p.y : ''; }
/** A day's labels: "+594 in" in green, "−300 out" in red — only what moved. */
function histDayBadges(d) {
  var pill = function (cls, words) { return '<span class="pill ' + cls + '" style="font-weight:600;margin-right:6px">' + words + '</span>'; };
  return (d.inQty ? pill('pill-ok', '+' + nf(d.inQty) + ' in') : '') + (d.outQty ? pill('pill-out', '−' + nf(d.outQty) + ' out') : '');
}
function invHistDraw() {
  var H = INV_HIST, page = fabShelfLedger(invHistRows(H.fabric), H.fabric, H.shelf, H.from, H.to), lotPo = {};
  fabLots(DB.fab || []).forEach(function (L) { lotPo[L.lot] = L.poNo; });
  $('histTabs').innerHTML = ['rfd', 'greige'].map(function (s) {
    return '<button type="button" role="tab" aria-selected="' + (H.shelf === s) + '" class="segbtn' + (H.shelf === s ? ' on' : '') + '" data-histshelf="' + s + '">' + INV_SHELF_LABEL[s] + '</button>';
  }).join('');
  if (!page.lines.length) {
    $('histBody').innerHTML = '<div class="empty">' + esc(H.from || H.to
      ? 'No ' + INV_SHELF_LABEL[H.shelf] + ' entries for ' + H.fabric + ' in these dates. It held ' + nf(page.closing) + ' m.'
      : 'No ' + INV_SHELF_LABEL[H.shelf] + ' entries for ' + H.fabric + ' yet.') + '</div>';
    return;
  }
  var days = histDays(page.lines), allOpen = days.every(function (d) { return H.open[d.date]; });
  var figure = function (label, value) {
    return '<div style="background:var(--soft);border-radius:var(--r-sm);padding:9px 12px"><div class="muted" style="font-size:12px">' + label + '</div>'
      + '<div style="font-size:19px;font-weight:700;font-variant-numeric:tabular-nums">' + value + '</div></div>';
  };
  var summary = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin:0 0 12px">'
    + figure('Opening' + (H.from ? ' on ' + esc(fmtD(H.from)) : ''), nf(page.opening)) + figure('Came in', page.inQty ? histIn(page.inQty) : '0')
    + figure('Went out', page.outQty ? histOut(page.outQty) : '0') + figure('Closing' + (H.to ? ' on ' + esc(fmtD(H.to)) : ''), nf(page.closing)) + '</div>';
  var bar = '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin:0 0 6px">'
    + '<span class="muted" style="font-size:12px">Click a date to see what moved that day</span>'
    + '<button type="button" class="ghost" id="histAll" style="height:30px;padding:0 12px">' + (allOpen ? 'Close all' : 'Open all') + '</button></div>';
  var month = '', rows = days.map(function (d) {
    var on = !!H.open[d.date], m = histMonthName(d.date), h = '';
    if (m !== month) { month = m; h += '<tr><td colspan="4" class="tl" style="padding:12px 8px 4px;font-size:12px;font-weight:700;color:var(--muted);border-bottom:0">' + esc(m) + '</td></tr>'; }
    h += '<tr class="xrow" data-histday="' + esc(d.date) + '" aria-expanded="' + on + '" title="' + (on ? 'Hide' : 'Show') + ' what moved on ' + esc(fmtD(d.date)) + '">'
      + '<td class="tl" style="white-space:nowrap;font-weight:700"><span style="display:inline-block;width:14px;color:var(--muted)">' + (on ? '▾' : '▸') + '</span>' + esc(histDayName(d.date)) + '</td>'
      + '<td class="tl">' + histDayBadges(d) + '<span class="muted" style="font-size:12px">' + plural(d.lines.length, 'movement') + '</span></td>'
      + '<td class="num muted">' + nf(d.opening) + '</td><td class="num b">' + nf(d.closing) + '</td></tr>';
    if (on) h += d.lines.map(function (x) {
      var r = x.row, po = invHistPoOf(r, lotPo), came = !!x.inQty, bad = r.txnType === 'DAMAGE' ? ';color:var(--bad)' : '';
      return '<tr' + (po ? ' class="xrow" data-histpo="' + esc(po + '|' + (r.chId || '')) + '" title="Open PO ' + esc(po) + '"' : '') + ' style="background:var(--soft)">'
        + '<td class="num">' + (came ? '<span class="pill pill-ok" title="came in">in</span>' : '<span class="pill pill-out" title="went out">out</span>') + '</td>'
        + '<td class="tl"><div style="' + bad + '">' + esc(invHistCause(r)) + '</div><div class="sub">' + esc(invHistDetails(r, po)) + '</div></td>'
        + '<td class="num">' + histMove(x) + '</td><td class="num">' + nf(x.closing) + '</td></tr>';
    }).join('');
    return h;
  }).join('');
  $('histBody').innerHTML = summary + bar + '<div class="box scroll" style="max-height:55vh;overflow:auto"><table class="ct li"><thead><tr>'
    + '<th style="width:150px">Date</th><th>That day</th><th class="num" style="width:110px">Opening</th><th class="num" style="width:110px">Closing</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div><div class="lm-why">Metres. '
    + (H.to ? 'The closing figure is the ' + esc(INV_SHELF_LABEL[H.shelf]) + ' at the end of ' + esc(fmtD(H.to)) + '.'
      : 'The closing figure matches the ' + esc(INV_SHELF_LABEL[H.shelf]) + ' figure on the Inventory page.')
    + ' A movement with a PO opens that PO.</div>';
}
/** The same page as an Excel file, made by the app's own writer (the PPC report's). */
function invHistXlsx() {
  var H = INV_HIST;
  if (typeof flowRepXlsx !== 'function') {
    console.warn('Stock history: the Excel writer (flow-report.js) is not loaded; nothing downloaded.');
    lmSay('err', 'The Excel file could not be made here. Nothing was downloaded.');
    return;
  }
  var page = fabShelfLedger(invHistRows(H.fabric), H.fabric, H.shelf, H.from, H.to), lotPo = {};
  fabLots(DB.fab || []).forEach(function (L) { lotPo[L.lot] = L.poNo; });
  var m2 = function (v) { return Math.round(v * 100) / 100; };
  var c = function (v, st) { return { v: v, st: st || {} }; }, bold = { b: 1 }, date = { fmt: 165, h: 'left' };
  var rows = [[c(H.fabric + ' — ' + INV_SHELF_LABEL[H.shelf] + ' · ' + (H.from || H.to ? (H.from ? fmtD(H.from) : 'start') + ' to ' + (H.to ? fmtD(H.to) : 'today') : 'all history'), bold)],
    ['Date', 'Cause', 'Details', 'Opening (m)', 'In (m)', 'Out (m)', 'Closing (m)'].map(function (h) { return c(h, { b: 1, fill: 'F1EFE8' }); })];
  page.lines.forEach(function (x) {
    var r = x.row, po = invHistPoOf(r, lotPo);
    rows.push([c(flowRepSerial(r.date), date), c(invHistCause(r)), c(invHistDetails(r, po)), c(m2(x.opening)),
      c(x.inQty ? m2(x.inQty) : ''), c(x.outQty ? m2(x.outQty) : ''), c(m2(x.closing), bold)]);
  });
  rows.push([c(''), c('Total', bold), c(''), c(m2(page.opening), bold), c(m2(page.inQty), bold), c(m2(page.outQty), bold), c(m2(page.closing), bold)]);
  try {
    var bytes = flowRepXlsx([{ name: INV_SHELF_LABEL[H.shelf], rows: rows, freeze: { x: 0, y: 2 }, widths: [12, 34, 48, 13, 11, 11, 13],
      merges: [], filter: 'A2:G' + (rows.length - 1), heights: {} }]);
    var a = window.document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = 'stock-history-' + H.fabric.replace(/[^A-Za-z0-9]+/g, '-') + '-' + H.shelf + '-' + lmToday() + '.xlsx';
    a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  } catch (e) {
    console.error('Stock history Excel for ' + H.fabric + ' failed:', e);
    lmSay('err', 'The Excel file for ' + H.fabric + ' could not be made. Nothing was downloaded.');
  }
}

/* ui/ledger.js -- The Fabric ledger screen and its filter.
 * An ES module. Its imports are worked out from the code by the split script. */
/* The ledger's own filter. Kept out of UI.q because the search box is shared by every screen and
 * this one is not -- a date range set here should not quietly follow you to the PO list. */
var LF = { from: '', to: '', kind: '', fabric: '', party: '', po: '', done: '' };

/* ---- the register itself, which is the only thing that is actually stored ------------------- */
/** Does a row survive the filter bar? Every box left blank matches everything. `but` names boxes to leave out (the tiles' counts). */
function lfKeep(r, but) {
  but = but || {};
  if (LF.from && String(r.date || '') < LF.from) return false;
  if (LF.to && String(r.date || '') > LF.to) return false;
  if (LF.kind && !but.kind && r.txnType !== LF.kind) return false;
  if (LF.fabric && String(r.fabricType || '').trim() !== LF.fabric) return false;
  if (LF.party && String(r.party || '').trim() !== LF.party) return false;
  if (LF.po && String(r.orderNo || '').trim().toUpperCase() !== LF.po.toUpperCase()) return false;
  if (!but.done && LF.done === 'open' && r.done) return false;
  if (!but.done && LF.done === 'done' && !r.done) return false;
  if (!but.done && LF.done === 'wait' && !lfWaits(r)) return false;
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

/* ---- THE LEDGER, LAID OUT TO ACT ON (Vishesh, 23 Nov: "refine … fabric ledger design to the best for making it more actionable") ---- *
 *   - tiles on top: Not yet fulfilled · Waiting for approval · Damaged · In / Out — each a filter (pressing it again clears it)
 *   - quick periods beside the dates: Today · 7 days · 30 days · This month · All
 *   - the movements grouped by day (newest first), each day with its count and its metres in and out
 *   - a movement reads in colour: green when cloth came in, red when it went out, the metres signed the same way
 *   - a movement waiting for approval carries Approve / Refuse on its own row for whoever may decide (the same decisions as
 *     the Greige POs page: rrDecide for an RFD receipt that shrank, ctsDecide for a cut to size)
 * Every filter, button and figure the ledger had is kept. */
var LF_PERIODS = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['month', 'This month'], ['', 'All']];
/** The from / to of a quick period, from today. */
function lfPeriod(k) {
  var t = lmToday(), d = new Date(t + 'T00:00:00Z');
  var back = function (n) { var x = new Date(d.getTime() - n * 86400000); return x.toISOString().slice(0, 10); };
  if (k === 'today') return { from: t, to: t };
  if (k === '7') return { from: back(6), to: t };
  if (k === '30') return { from: back(29), to: t };
  if (k === 'month') return { from: t.slice(0, 8) + '01', to: t };
  return { from: '', to: '' };
}
/** The quick period the filter's dates are on now ('' = all; null = some other dates). */
function lfPeriodNow() {
  for (var i = 0; i < LF_PERIODS.length; i++) { var p = lfPeriod(LF_PERIODS[i][0]); if (p.from === LF.from && p.to === LF.to) return LF_PERIODS[i][0]; }
  return null;
}
/** A movement waiting for someone to approve it. */
var lfWaits = function (r) { return !!(r.approval && r.approval.status === 'pending'); };
/** Approve / Refuse on the row, for whoever may decide it; else who it waits for. */
function lfDecideHtml(r) {
  if (!lfWaits(r)) return '';
  if (r.cutToSize) return ctsDecideButtons(r);
  if (r.txnType === 'RECEIVE_RFD') return canApprove() ? '<div class="actions"><button type="button" class="jw-btn jw-wa" data-appr="' + esc(r.id) + '|ok">Approve</button><button type="button" class="jw-btn" id="rej-' + esc(r.id) + '" data-appr="' + esc(r.id) + '|no">Reject</button></div>'
    : '<span class="muted" style="font-size:11.5px">waits for an approver</span>';
  return '';
}
var LED_CSS = '<style>'
  + '.gdx-todo{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin:0 0 12px}'
  + '.gdx-tile{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;padding:12px 14px;border-radius:14px;border:1px solid var(--line);background:var(--card);cursor:pointer;box-shadow:none;color:var(--ink);height:auto;min-height:0;white-space:normal;position:relative;overflow:hidden}'
  + '.gdx-tile:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--tone)}'
  + '.gdx-tile:hover{border-color:var(--tone);background:var(--soft)}.gdx-tile.on{border-color:var(--tone);box-shadow:0 0 0 2px var(--tone) inset;background:var(--soft)}'
  + '.gdx-tile.bad{--tone:var(--bad)}.gdx-tile.warn{--tone:var(--warn-ink)}.gdx-tile.brand{--tone:var(--brand)}.gdx-tile.ok{--tone:var(--ok-ink)}'
  + '.gdx-tile[disabled]{cursor:default}.gdx-tile[disabled]:hover{border-color:var(--line);background:var(--card)}'
  + '.gdx-n{font-size:24px;font-weight:800;line-height:1.1;color:var(--tone)}.gdx-l{font-size:13px;font-weight:700}.gdx-s{font-size:11.5px;color:var(--muted)}'
  + '.gdx-per{display:inline-flex;gap:4px;flex-wrap:wrap}.gdx-per button{height:32px;padding:0 12px;font-size:12.5px;border-radius:999px;width:auto}'
  + '.gdx-per button.on{background:var(--brand);color:var(--on-brand);border-color:var(--brand)}'
  + '.gdx-day td{background:var(--soft)!important;text-align:left!important;font-size:12.5px;padding:8px 12px!important;border-top:1px solid var(--line)}'
  + '.gdx-day b{font-size:13px;margin-right:8px}'
  + '.gdx-mv{display:inline-block;font-size:11.5px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}'
  + '.gdx-mv.in{background:var(--accent-bg);color:var(--ok-ink)}.gdx-mv.out{background:var(--bad-bg);color:var(--bad)}.gdx-mv.nil{background:var(--chip);color:var(--muted)}'
  + '.gdx-mv.dmg{background:var(--bad);color:#fff}'
  + 'tr.gdx-wait>td{background:var(--warn-bg)!important}tr.gdx-wait>td:first-child{box-shadow:inset 4px 0 0 var(--warn-ink)}'
  + '</style>';
function renderLedger() {
  var all = (DB.fab || []).concat(ledChallanRows()).sort(function (a, b) {
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
  var lfKinds = kinds.concat(all.some(function (r) { return r.flow; }) ? ['RFD_TO_PRINTER', 'RFD_BACK_FROM_PRINTER'] : []);   // the filter only; nobody adds these by hand

  var inM = rows.reduce(function (a, r) { return a + (ledSign(r) > 0 ? fabQty(r) : 0); }, 0);
  var outM = rows.reduce(function (a, r) { return a + (ledSign(r) < 0 ? fabQty(r) : 0); }, 0);

  /* the tiles count what the dates, fabric, party and PO let through -- not the tile's own filter, so they never read 0 once pressed */
  var base = all.filter(function (r) { return lfKeep(r, { done: true, kind: LF.kind === 'DAMAGE' }); });
  var openN = base.filter(function (r) { return !r.done; }).length, waitN = base.filter(lfWaits).length;
  var dmg = base.filter(function (r) { return r.txnType === 'DAMAGE'; }), dmgM = dmg.reduce(function (a, r) { return a + fabQty(r); }, 0);
  var tile = function (on, tone, n, big, sub, attr) {
    return '<button type="button" class="gdx-tile ' + tone + (on ? ' on' : '') + '" ' + attr + '><span class="gdx-n">' + n + '</span><span class="gdx-l">' + big + '</span><span class="gdx-s">' + sub + '</span></button>';
  };
  var tiles = '<div class="gdx-todo">'
    + tile(LF.done === 'open', 'brand', nf(openN), 'Not yet fulfilled', 'movements nobody has ticked', 'data-lfgo="open"')
    + tile(LF.done === 'wait', waitN ? 'warn' : 'ok', nf(waitN), 'Waiting for approval', waitN ? 'decide them on their rows' : 'nothing waiting', 'data-lfgo="wait"' + (waitN || LF.done === 'wait' ? '' : ' disabled'))
    + tile(LF.kind === 'DAMAGE', dmg.length ? 'bad' : 'ok', nf(dmgM) + ' m', 'Damaged', plural(dmg.length, 'entry', 'entries') + (lfPeriodNow() === '' ? ', all time' : ' in these dates'), 'data-lfgo="dmg"' + (dmg.length || LF.kind === 'DAMAGE' ? '' : ' disabled'))
    + '<div class="gdx-tile ok" style="cursor:default"><span class="gdx-n" style="font-size:18px"><span style="color:var(--ok-ink)">+' + nf(inM) + '</span> <span style="color:var(--bad)">−' + nf(outM) + '</span></span><span class="gdx-l">Metres in / out</span><span class="gdx-s">of the movements below</span></div>'
    + '</div>';

  var per = lfPeriodNow();
  var filters = '<div class="card" style="padding:12px 14px;margin-bottom:12px">'
    + '<div class="toolbar" style="gap:10px;align-items:center">'
    + '<div class="gdx-per" role="group" aria-label="Period">' + LF_PERIODS.map(function (p) {
      return '<button type="button" class="ghost' + (per === p[0] ? ' on' : '') + '" data-lfper="' + p[0] + '">' + p[1] + '</button>';
    }).join('') + '</div>'
    + '<label style="margin:0;display:flex;align-items:center;gap:6px;font-size:12px">From'
    + '<input type="date" data-lf="from" value="' + esc(LF.from) + '" style="height:32px;width:auto;font-size:12.5px"></label>'
    + '<label style="margin:0;display:flex;align-items:center;gap:6px;font-size:12px">To'
    + '<input type="date" data-lf="to" value="' + esc(LF.to) + '" style="height:32px;width:auto;font-size:12.5px"></label></div>'
    + '<div class="toolbar" style="gap:10px;margin-top:8px">'
    + lfSelect('kind', 'Movement', lfKinds, lfKinds.map(function (k) { return FAB_LABEL[k]; }))
    + lfSelect('fabric', 'Fabric', fabrics)
    + lfSelect('party', 'Party', parties)
    + lfSelect('po', 'PO', pos)
    + lfSelect('done', 'Status', ['open', 'done', 'wait'], ['Not yet fulfilled', 'Fulfilled', 'Waiting for approval'])   /* "open" is a PO's word (Ravi, 21 Nov) */
    + (lfOn() ? '<button type="button" class="jw-btn" id="lfClear">Clear the filter</button>' : '')
    + '</div></div>';

  var count = rows.length === all.length
    ? all.length + ' movement' + (all.length === 1 ? '' : 's')
    : '<b>' + rows.length + '</b> of ' + all.length + ' movements';
  var openR = rows.filter(function (r) { return !r.done; }).length;
  if (openR !== rows.length) count += ' · <b>' + openR + '</b> not yet fulfilled';

  /* one header a day: the day, how many movements, the metres in and out */
  var days = {}; rows.forEach(function (r) { var d = String(r.date || ''); var e = days[d] || (days[d] = { n: 0, i: 0, o: 0 }); e.n++;
    if (ledSign(r) > 0) e.i += fabQty(r); else if (ledSign(r) < 0) e.o += fabQty(r); });
  var lastDay = null;

  return LED_CSS + '<div class="row" style="margin-bottom:10px;align-items:center">'
    + '<span class="muted" style="font-size:12px;align-self:center">Add a movement:</span>'
    + (canLedgerEdit() ? '' : '<span class="pill pill-mute">View only · ' + esc(meUser().name) + '</span>')
    + kinds.filter(function (k) { return canLedgerEdit() && k !== 'RECEIVE_GREIGE' && k !== 'ISSUE_TO_RFD' && k !== 'RECEIVE_RFD' && k !== 'ISSUE_TO_CUTTING' && k !== 'CUT_TO_PRINTER'; }).map(function (k) {
      return '<button type="button" class="ghost" data-act="' + k + '" style="padding:6px 12px;font-size:12.5px">'
        + esc(FAB_LABEL[k]) + '</button>';
    }).join('') + '<span class="muted" style="font-size:12px;align-self:center">Greige received, sent to RFD and RFD received back are done from each PO on Greige POs; to cutting from the RFD lot on Inventory.</span></div>'
    + tiles + filters
    + '<div class="card"><div class="ff-cap">' + count + ', newest first · '
    + '<b style="color:var(--ok-ink)">' + nf(inM) + ' m</b> in · <b style="color:var(--bad)">' + nf(outM) + ' m</b> out. '
    + 'Nothing on this page is a stored total — every figure in the app is worked out from these rows.</div>'
    + '<div class="ff-grid"><table class="xl">'
    /* READ THE WAY A DELIVERY IS LOOKED UP: the day, the order it came against, the cloth, and who
     * it came from. The lot and the movement follow, because they answer the next question, not
     * the first one. */
    + th(['Date', 'PO', 'Fabric', 'Challan', 'Party', 'Lot', 'Movement', 'State', 'Metres', ''], [8])
    + '<tbody>' + (rows.map(function (r) {
      var sign = ledSign(r), d = String(r.date || ''), dd = days[d], head = '';
      if (d !== lastDay) { lastDay = d;
        head = '<tr class="gdx-day"><td colspan="10"><b>' + esc(d ? fmtD(d) : 'No date') + '</b><span class="muted">' + plural(dd.n, 'movement') + '</span>'
          + (dd.i ? ' · <span style="color:var(--ok-ink);font-weight:700">+' + nf(dd.i) + ' m</span>' : '') + (dd.o ? ' · <span style="color:var(--bad);font-weight:700">−' + nf(dd.o) + ' m</span>' : '') + '</td></tr>'; }
      var mv = r.txnType === 'DAMAGE' ? 'dmg' : sign > 0 ? 'in' : sign < 0 ? 'out' : 'nil', waits = lfWaits(r);
      return head + '<tr' + (waits ? ' class="gdx-wait"' : '') + '><td class="frz">' + esc(r.date) + '</td>'
        + '<td>' + (r.orderNo ? '<b>' + esc(r.orderNo) + '</b>' : '<span class="muted">—</span>') + '</td>'
        + '<td style="text-align:left">' + esc(r.fabricType) + '</td>'
        /* The bill or challan sits with the cloth it came on: the two are read together off the
         * paper in your hand, so they are read together here. */
        + '<td>' + (r.bill ? (r.txnType === 'ISSUE_TO_RFD' && !r.flow ? '<button type="button" class="link mono" style="padding:0" data-rfdpo="' + esc(r.bill) + '" title="Open the RFD PO">' + esc(r.bill) + '</button>' : '<span class="mono">' + esc(r.bill) + '</span>') + '<div class="sub">' + ({ ISSUE_TO_RFD: 'our RFD challan', RECEIVE_RFD: 'processor’s', RECEIVE_GREIGE: 'supplier’s', PURCHASE_RFD: 'supplier’s', RFD_TO_PRINTER: 'our RFD challan to the printer', RFD_BACK_FROM_PRINTER: 'our RFD challan to the printer' }[r.txnType] || '') + '</div>' : '<span class="muted">—</span>') + '</td>'
        + '<td style="text-align:left">' + (r.party ? esc(r.party) : '<span class="muted">—</span>') + '</td>'
        + '<td style="text-align:left">' + (r.lot ? '<b>' + esc(r.lot) + '</b>' : '<span class="muted">—</span>') + '</td>'
        + '<td style="text-align:left"><span class="gdx-mv ' + mv + '">' + esc(FAB_LABEL[r.txnType] || r.txnType) + '</span>'
        + (r.approval && r.approval.status !== 'approved' ? '<div><span class="pill ' + (r.approval.status === 'pending' ? 'pill-low' : 'pill-out') + '">' + (r.approval.status === 'pending' ? 'Waiting for approval' : r.cutToSize ? 'Refused' : 'Rejected') + ' · ' + ctsApprovalWhy(r) + '</span></div>' : '')
        + (r.approval && r.approval.status === 'approved' ? '<div class="sub">approved by ' + esc(r.approval.by || '') + (r.cutToSize ? '' : ' · ' + r.approval.pct + '%') + '</div>' : '')
        + (r.bales && r.bales.length ? '<div class="sub">' + r.bales.length + ' bales</div>' : '')
        + (r.lr ? '<div class="sub">LR ' + esc(r.lr) + '</div>' : '')
        + (r.thans && r.thans.length ? '<div class="sub">' + r.thans.length + ' thans</div>' : '')
        + ctsPiecesNote(r)
        + (r.txnType === 'DAMAGE' && r.note
          ? '<div class="muted" style="font-size:10.5px;font-weight:400">' + esc(r.note) + '</div>' : '')
        + '</td>'
        + '<td><span class="pill ' + (fabState(r) === 'GREIGE' ? 'pill-low' : 'pill-sea') + '">'
        + esc(FAB_STATE_LABEL[fabState(r)] || fabState(r)) + '</span></td>'
        + '<td class="num" style="font-weight:800;color:' + (sign > 0 ? 'var(--ok-ink)' : sign < 0 ? 'var(--bad)' : 'var(--ink)') + '">' + (sign < 0 ? '−' : sign > 0 ? '+' : '') + nf(fabQty(r))
        + (r.pieces && r.pieces.length ? '<div class="muted" style="font-size:10.5px;font-weight:400">' + r.pieces.length + ' pcs on the challan</div>' : '')
        + (r.returned
          ? '<div class="muted" style="font-size:10.5px;font-weight:400">' + nf(r.gross)
            + ' on the challan, ' + nf(r.returned) + ' sent back</div>' : '')
        + (r.forOrders ? '<div class="muted" style="font-size:10.5px;font-weight:400">for ' + esc(r.forOrders) + '</div>' : '')
        + (r.remark && r.txnType !== 'DAMAGE'
          ? '<div class="muted" style="font-size:10.5px;font-weight:400">' + esc(r.remark) + '</div>' : '')
        + '</td>'
        + (r.flow ? '<td style="white-space:nowrap"><span class="muted" style="font-size:11.5px" title="Made with Send to printer. Change or cancel it on the challan itself.">from the RFD challan</span></td></tr>' : '<td style="white-space:nowrap">' + (waits ? lfDecideHtml(r) : '')
        + (!canLedgerEdit() ? '<span class="muted" title="' + esc(fulfilledBy(r)) + '">' + (r.done ? '✓ Fulfilled' : '') + '</span>' : '')
        + (!canLedgerEdit() || ctsLedgerLocked(r) ? '' : '<button type="button" class="jw-btn jw-primary" data-edit="' + esc(r.id) + '">Edit</button> ')
        + (!canLedgerEdit() || waits ? '' : r.done
          ? '<button type="button" class="jw-btn jw-wa" data-done="' + esc(r.id) + '" '
            + 'title="' + esc(fulfilledBy(r)) + '. Click to put it back on the list.">✓ Fulfilled</button>'
          : '<button type="button" class="jw-btn" data-done="' + esc(r.id) + '" '
            + 'title="Mark this movement as dealt with">Mark fulfilled</button>')
        + '</td></tr>');
    }).join('') || emptyRow(10, lfOn() || UI.q ? 'No movement matches the filter.' : 'The register is empty.'))
    + '</tbody></table></div></div>';
}

/** Tick or untick "fulfilled", keeping who did it and when (Ravi, 21 Nov: a tick nobody can trace is no use). */
function markFulfilled(r, done, who) {
  r.done = done;
  if (done) { r.doneBy = who || ''; r.doneAt = new Date().toISOString(); } else { delete r.doneBy; delete r.doneAt; }
}
/** "Fulfilled by Priya on 21-Nov-26" — or just "Dealt with" for a tick from before names were kept. */
function fulfilledBy(r) {
  if (!r.done) return '';
  return r.doneBy ? 'Fulfilled by ' + r.doneBy + (r.doneAt ? ' on ' + fmtD(lmToday(r.doneAt)) : '') : 'Dealt with';
}

/* ---- wiring: the ledger rows and the filter bar ---------------------------------------------------- */
function wireLedger() {
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('#lfClear,[data-edit],[data-done],[data-del],[data-lfgo],[data-lfper]') : null;
    if (!t) return;
    var g = function (k) { return t.getAttribute(k); };
    /* the ledger's tiles and quick periods (Vishesh, 23 Nov) */
    if (g('data-lfgo') !== null) { var go = g('data-lfgo');
      /* pressing a tile turns its filter on; pressing it again turns it off */
      if (go === 'dmg') LF.kind = LF.kind === 'DAMAGE' ? '' : 'DAMAGE'; else LF.done = LF.done === go ? '' : go;
      render(); return; }
    if (g('data-lfper') !== null) { var pr = lfPeriod(g('data-lfper')); LF.from = pr.from; LF.to = pr.to; render(); return; }
    if (g('data-edit')) {
      var er = (DB.fab || []).filter(function (x) { return x.id === g('data-edit'); })[0];
      if (er) entryOpen(er.txnType, er);
      return;
    }
    if (g('data-done')) {
      /* A WORKING MARK, NOT A FIGURE. Fulfilled says somebody has dealt with this row -- chased it,
       * filed it, tallied it against the paper. It changes no balance anywhere: what the cloth did
       * is a fact, and a tick cannot alter it. */
      if (!canLedgerEdit()) { lmSay('warn', 'Marking a movement fulfilled needs the right to correct the fabric ledger.'); return; }
      var dr = (DB.fab || []).filter(function (x) { return x.id === g('data-done'); })[0];
      if (dr) { markFulfilled(dr, !dr.done, meUser().name); lmSaveDb(); render(); }
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
  ['terms', 'Standard terms & conditions', 'area', 'Fills in on every new PO; it can be changed on each PO'],
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
/* ONLY WHAT HAS NO SCREEN OF ITS OWN (Ravi, 24 Nov: "remove these buttons … that are in our process in different ways like
 * the cutting one"). Greige received is the PO's receive drawer, RFD back is Receive RFD on the PO, To cutting is Send to
 * cutting on the RFD lot in Inventory. A new entry here is RFD bought, RFD opening stock or Damaged; correcting an old row
 * still shows its own movement. */
var EN_ELSEWHERE = { RECEIVE_GREIGE: 1, RECEIVE_RFD: 1, ISSUE_TO_CUTTING: 1 };
function enChips() {
  var on = $('enKind').value;
  $('enChips').innerHTML = EN_GROUPS.map(function (grp) {
    var kinds = grp.kinds.filter(function (k) { return EN_ID ? k === on : !EN_ELSEWHERE[k]; });
    if (!kinds.length) return '';
    return '<div class="en-group"><span class="en-gname">' + esc(grp.name) + '</span>'
      + kinds.map(function (k) {
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
  gdSample($('enQty'), '', '1200');
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
    gdSample($('enQty'), r2(open[0].pending), nf(open[0].pending) + ' still due');   // Tab takes what is still due
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
  if (!row && kind === 'ISSUE_TO_CUTTING') { entryClose(); UI.tab = 'inv'; render(); lmSay('warn', 'RFD goes to cutting from Inventory: press Send to printer under RFD on shelf, then its Cut pieces tab.'); return; }
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
  gdSample($('enQty'), '', '1200');
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
  /* A SHRINKAGE HOLD SURVIVES A CORRECTION. Fixing the metres or the date of an RFD receipt that is
   * waiting for approval (or was turned down) must not slip it into stock without anyone approving it. */
  if (prev && prev.approval && kind === 'RECEIVE_RFD') row.approval = prev.approval;
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
    var back = cutLinesUndoPatch(r);   // a cutting entry's products wait for cloth again
    lmSaveDb(back); cutFlowKeep(back); entryClose(); render();
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
    var t = ev.target.closest ? ev.target.closest('[data-issall],[data-issbale],[data-rradd],[data-rrrm],[data-rrlast],[data-rr],[data-appr],[data-urm],#userAdd,#rrSave,[data-cut],[data-cutall],[data-cutthan],[data-cutline],#cutSave') : null;
    if (!t) return;
    var g = function (k) { return t.getAttribute(k); };
    if (g('data-issall') && ISS) { var lot = g('data-issall'), bs = lotBales(lot), all = bs.every(function (b) { return ISS.pick[lot][b.than]; }); ISS.pick[lot] = {}; if (!all) bs.forEach(function (b) { ISS.pick[lot][b.than] = true; }); issDraw(); return; }
    if (g('data-issbale') && ISS) { var p = g('data-issbale').split('|'); ISS.pick[p[0]][p[1]] = t.checked; if (!t.checked) delete ISS.bq[p[0] + '|' + p[1]]; issDraw(); return; }
    if (g('data-rrlast') && RR) { RR.last[g('data-rrlast')] = t.checked; rrSums(); return; }
    /* more typed than is out: no next than until the figure is put right (Ravi, 25 Nov) */
    if (g('data-rradd') && RR && rrOver(g('data-rradd'))) { rrSums(); var bad = RR.thans[g('data-rradd')].length - 1, bf = $('rm-' + g('data-rradd') + '-' + bad); if (bf) { bf.focus(); if (bf.select) bf.select(); } return; }
    if (g('data-rradd') && RR) { var l = g('data-rradd'), ps = RR.thans[l]; ps.push({ than: rdNextBale(ps), m: '' }); /* same numbering as Receive greige */ rrDraw(); var f = $('rm-' + l + '-' + (ps.length - 1)); if (f) f.focus(); return; }
    if (g('data-rrrm') && RR) { var q = g('data-rrrm').split('|'), arr = RR.thans[q[0]]; arr.splice(+q[1], 1); if (!arr.length) arr.push({ than: '', m: '' }); rrDraw(); return; }
    if (t.id === 'rrSave') { rrSave(); return; }
    if (g('data-cut')) { cutOpen(g('data-cut')); return; }
    if (g('data-cutall') && CUT) { var ts = lotThans(CUT.lot), every = ts.every(function (x) { return CUT.pick[x.than]; }); CUT.pick = {}; if (!every) ts.forEach(function (x) { CUT.pick[x.than] = true; }); cutDraw(); return; }
    if (g('data-cutthan') && CUT) { CUT.pick[g('data-cutthan')] = t.checked; cutDraw(); return; }
    if (g('data-cutline') && CUT) { CUT.lpick[g('data-cutline')] = t.checked; cutDraw(); return; }
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
    if (CUT && el.getAttribute && el.getAttribute('data-cutqty')) { CUT.qty = el.value; $('cutErr').classList.add('hide'); $('cutTot').innerHTML = cutTotHtml(parseFloat(el.value) || 0, ''); return; }   // a new figure: the last refusal may no longer be true
    if (CUT && el.getAttribute && el.getAttribute('data-ctssize')) { var wl = String(el.value || '').split('|'); CUT.sz = el.value; CUT.w = wl[0] || ''; CUT.l = wl[1] || ''; $('cutErr').classList.add('hide'); ctsInfoDraw(); return; }
    if (CUT && el.getAttribute && el.getAttribute('data-ctsbox')) { CUT[el.getAttribute('data-ctsbox')] = el.value; $('cutErr').classList.add('hide'); ctsInfoDraw(); return; }
    var lot = el.getAttribute && el.getAttribute('data-rrlot'); if (!lot || !RR) return;
    RR.thans[lot][+el.getAttribute('data-pi')][el.getAttribute('data-f')] = el.value; rrSums();
  });
  $('rrLots').addEventListener('keydown', function (ev) {
    var el = ev.target, lot = el.getAttribute('data-rrlot');
    if (ev.key !== 'Enter' || !lot || el.getAttribute('data-f') !== 'm') return;
    ev.preventDefault(); var pi = +el.getAttribute('data-pi');
    if (rrOver(lot)) { rrSums(); if (el.select) el.select(); return; }   // stays in the box until the metres fit what is out
    if (pi === RR.thans[lot].length - 1) { var b = document.querySelector('[data-rradd="' + lot + '"]'); if (b) b.click(); } else { var nx = $('rm-' + lot + '-' + (pi + 1)); if (nx) nx.focus(); }
  });
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


/* ================= GREIGE DESK INSIDE THE REPLENISH APP (real working since 15 Oct) =================
 * Ravi, 13 Oct: "is wale part ko bhi jaise humne PPC test flow me run kiya hua h aise hi run kardo" -- the Greige Desk
 * joined to the PPC flow. Everything it writes goes to its own node, pt_gdTest (named in its test days; since 15 Oct, Ravi:
 * "griege ka bhi test window hatao", it holds the real greige POs and movements, RIDHI/PO/GREIG/001 on); the older Greige POs and the
 * fabric ledger are never touched. Its masters start as a copy of the app's own (fabric pairs, suppliers, RFD
 * processors, company); the rights come from the person signed in. */
var GD_NODE = 'pt_gdTest', GD_SNAP = null, GD_READY = null, GD_STATE = '';   // '' not read · 'ok' · 'err: …'
function gdKeyed(list) { var o = {}; (list || []).forEach(function (x) { if (x && x.id) o[x.id] = JSON.stringify(x); }); return o; }
function gdSnap() {
  return { gpo: gdKeyed(DB.gpo), fab: gdKeyed(DB.fab), mst: JSON.stringify(DB.mst || []), ven: JSON.stringify(DB.ven || []), co: JSON.stringify(DB.co || {}) };
}
/* WHAT CHANGED IS WHAT IS WRITTEN: one PO or one ledger row at a time, so two people working at once do not
 * overwrite each other's rows. */
/** Saves what changed on the desk as one patch. alsoWrite (optional) is more paths written in that same patch -- the
 *  flow's lines a cutting entry is for -- so the two never land apart. */
function lmSaveDb(alsoWrite) {
  if (!DB || GD_STATE !== 'ok') return;   // never write a desk this screen could not read
  var now = gdSnap(), was = GD_SNAP || { gpo: {}, fab: {}, mst: '', ven: '', co: '' }, patch = Object.assign({}, alsoWrite || {});
  ['gpo', 'fab'].forEach(function (k) {
    Object.keys(now[k]).forEach(function (id) { if (was[k][id] !== now[k][id]) patch[GD_NODE + '/' + k + '/' + id] = JSON.parse(now[k][id]); });
    Object.keys(was[k]).forEach(function (id) { if (!(id in now[k])) patch[GD_NODE + '/' + k + '/' + id] = null; });
  });
  ['mst', 'ven', 'co'].forEach(function (k) { if (was[k] !== now[k]) patch[GD_NODE + '/' + k] = JSON.parse(now[k]); });
  GD_SNAP = now;
  if (Object.keys(patch).length) Promise.resolve(ptPatch(patch)).catch(function (e) { lmSay('err', 'Not saved: ' + (e && e.message || e)); });
}
function gdFromStore(v) {
  var list = function (o) { return Object.keys(o || {}).map(function (k) { var x = o[k]; if (x && !x.id) x.id = k; return x; }).filter(Boolean); };
  var arr = function (a) { return Array.isArray(a) ? a.filter(Boolean) : list(a); };
  return { gpo: list(v.gpo), fab: list(v.fab), mst: arr(v.mst), ven: arr(v.ven), co: v.co || {}, users: [], me: '' };
}
function gdCoName() {
  try { var s = (typeof GPO !== 'undefined' && GPO.settings) || {}; return s.company || s.name || (typeof FLOW_COMPANY !== 'undefined' ? FLOW_COMPANY : 'Ridhi Home & Living'); }
  catch (e) { return 'Ridhi Home & Living'; }
}
/* THE MASTERS, COPIED FROM THE APP: fabric types with a greige name, the suppliers on real greige POs and in the vendor
 * master, the RFD processors the real ledger has sent cloth to. Typed over here, they change only the test copy. */
function gdSeedMasters() {
  var mst = [], ven = [], seen = {};
  try {
    mstRows('fabricType').forEach(function (r) {
      var rfd = String(r.desc || r.code || '').trim(), greige = String(r.greige || '').trim();
      if (!rfd || !greige) return;
      mst.push({ rfd: rfd, greige: greige, warp: r.warp || '', weft: r.weft || '', epi: r.epi || '', ppi: r.ppi || '',
        greigeWidth: r.greigeWidth || '', rfdWidth: r.rfdWidth || '', active: r.active !== false });
    });
  } catch (e) { /* no fabric master read yet */ }
  var addVen = function (name, kind, extra) {
    var n = String(name || '').trim(), k = n.toLowerCase(); if (!n || seen[k]) return; seen[k] = 1;
    ven.push(Object.assign({ name: n, kind: kind, phone: '', email: '', addr: '', city: '', gstin: '', active: true }, extra || {}));
  };
  try { ((typeof GPO !== 'undefined' && GPO.rows) || []).forEach(function (p) { addVen(p.mill, 'Supplier'); }); } catch (e) { /* none */ }
  try {
    ptList((PTG.masters || {}).vendor).forEach(function (v) {
      var cat = String(v.category || '');
      var kind = /mill|supplier|weav|greige/i.test(cat) ? 'Supplier' : /process|rfd|bleach|dye/i.test(cat) ? 'RFD Processor' : '';
      if (kind) addVen(v.desc || v.name || v.code, kind, { phone: v.phone || '', email: v.email || '', city: v.city || '', gstin: v.gstin || '' });
    });
  } catch (e) { /* none */ }
  try { ((typeof FAB !== 'undefined' && FAB.rows) || []).forEach(function (r) { if (r.txnType === 'ISSUE_TO_RFD') addVen(r.party, 'RFD Processor'); }); } catch (e) { /* none */ }
  return { mst: mst, ven: ven, co: { name: gdCoName(), addr: '', email: '', gstin: '', iec: '', pan: '', jurisdiction: 'Jaipur',
    poPrefix: 'RIDHI/PO/GREIG/', poNext: 1, rfdPrefix: 'RIDHI/RFD/' } };
}
/** THE STARTING LISTS FOR AN EMPTY DESK (fabric pairs, suppliers and processors, company). The store holds the real greige POs
 *  and movements, so it is never written whole (Ravi, 26 Nov: one screen's copy could replace what another PC had saved): the
 *  lists are written only if the store is still empty at that moment, checked and written in one step. Answers what was
 *  written, or null when another screen got there first. */
async function gdSeed() {
  var m = gdSeedMasters(), store = { mst: m.mst, ven: m.ven, co: m.co };
  return (await ptCas(GD_NODE, null, store)) ? null : store;
}
function gdLoad() {
  if (GD_READY) return GD_READY;
  GD_READY = (async function () {
    try { if (typeof ptNeed === 'function') await ptNeed(PTG_MASTER, { why: 'gdesk', has: 'masters' }); } catch (e) { /* masters wait */ }
    try { if (typeof ensureGpo === 'function' && typeof GPO !== 'undefined' && GPO.rows == null) await ensureGpo(); } catch (e) { /* real POs wait */ }
    /* A READ THAT FAILED IS NOT AN EMPTY DESK (16 Oct). It used to be taken as one, and the empty desk was then WRITTEN
     * over the whole node — every greige PO and every movement gone because one read timed out. Now a failed read
     * writes nothing, says so (GD_STATE), and the next open asks again. Only a read that ANSWERED "nothing here" seeds
     * the masters and saves them. */
    var v = null, failed = '';
    try { v = await ptGet(GD_NODE); } catch (e) { failed = String((e && e.message) || e || 'read failed'); }
    if (failed) { DB = null; GD_STATE = 'err: ' + failed; GD_READY = null; return; }
    if (v == null) {
      try { v = (await gdSeed()) || await ptGet(GD_NODE); }   // another screen seeded it first: theirs is read
      catch (e) { DB = null; GD_STATE = 'err: ' + String((e && e.message) || e); GD_READY = null; return; }
      if (v == null) { DB = null; GD_STATE = 'err: another screen was setting up the desk at the same moment — open it again'; GD_READY = null; return; }
    }
    /* Something there that is not a desk (not a record) is never replaced by one: nothing is written, and the screen says so.
     * A desk whose lists are still empty holds only its company details, and is a desk. */
    if (!(v && typeof v === 'object' && !Array.isArray(v))) { DB = null; GD_STATE = 'err: the greige store holds something this desk cannot read — nothing was written'; GD_READY = null; return; }
    DB = gdFromStore(v); lmMigrate(); GD_SNAP = gdSnap();
    GD_STATE = 'ok';
  })();
  return GD_READY;
}
function lmLoad() { if (!DB) DB = { gpo: [], fab: [], mst: [], ven: [], co: {}, users: [], me: '' }; lmMigrate(); }
/* The model's sample (no button for it in the app since 15 Oct), the company's own name on it. */

/* ---- WHO IS WORKING: the person signed in to the app, and the rights they hold ---- *
 * gdesk opens the desk; gdled shows the fabric ledger; gdledit lets them add and correct it; gdappr approves an RFD
 * receipt that shrank more than 5%. An admin holds all four. */
var GD_RIGHTS = [['gdesk', 'Open the Greige Desk'], ['gdled', 'See the fabric ledger'], ['gdledit', 'Add to and correct the fabric ledger'], ['gdappr', 'Approve an RFD receipt that shrank more than 5%'],
  /* Ravi, 21 Nov: closing a greige PO is the accounts department's; the store's "last challan" asks the accounts head. */
  ['gdpo', 'Close, cancel and reopen greige POs'], ['gdpoappr', 'Approve the store’s request to close a greige PO']];
/* AN EMPTY TABS LIST IS NO ACCESS, as it is everywhere else in the app (auth.js: a failed or empty perms read
 * gives nothing). It used to hand all four rights to such an account. Only the desk run on its own, with no
 * app login at all, still opens with every right. */
function gdHas(k) {
  if (typeof ME === 'undefined' || !ME) return true;
  return !!ME.admin || (ME.tabs || []).indexOf(k) >= 0;
}
function meUser() {
  var me = (typeof ME !== 'undefined' && ME) || {};
  return { id: me.email || '', name: me.name || me.email || 'You', role: me.admin ? 'Admin' : 'User',
    ledger: gdHas('gdledit') ? 'edit' : (gdHas('gdled') ? 'view' : 'none'), approve: gdHas('gdappr'), active: true };
}
function meFill() {
  var n = $('meName'); if (n) n.textContent = meUser().name + ' · ledger: ' + LEDGER_LABEL[meUser().ledger].toLowerCase() + (meUser().approve ? ' · approves' : '');
  [].forEach.call(document.querySelectorAll('.navgrp[data-tab="ledger"]'), function (b) { b.hidden = !canLedger(); });
  /* NO MASTER DATA TAB IN THE APP (Ravi, 15 Oct: "remove the master data from here, it will come from setup"): the fabrics and
   * the suppliers / RFD processors are Setup -> Master Database's own (gdLinkMasters). */
  [].forEach.call(document.querySelectorAll('.navgrp[data-tab="mst"]'), function (b) { b.hidden = gdLinked(); });
}
function renderMstUsers() {
  var u = meUser();
  return '<div class="card"><div class="ff-cap">On the Greige Desk, rights come from each person’s own login. They are given in Sellora → Access, '
    + 'like every other screen. An admin holds all four.</div><div class="ff-grid"><table class="xl xl-dense"><thead><tr><th class="frz">Right</th><th>What it allows</th><th>' + esc(u.name) + '</th></tr></thead><tbody>'
    + GD_RIGHTS.map(function (r) { return '<tr><td class="frz mono" style="text-align:left">' + r[0] + '</td><td style="text-align:left">' + esc(r[1]) + '</td><td>' + (gdHas(r[0]) ? '<span class="pill pill-ok">yes</span>' : '<span class="pill pill-mute">no</span>') + '</td></tr>'; }).join('')
    + '</tbody></table></div></div>';
}
function usersSafe() { return true; }

/* ---- GREIGE FOR PPC: what the plans need, and the greige to buy for it ---- *
 * PPC's plans need RFD for printing (the flow's Demand → RFD). Against that: the RFD in the real register and on this
 * desk's shelf, less what earlier lines hold, and on this desk what is already on its way -- greige on order, greige in
 * the store, cloth at an RFD processor. What is still short is the greige to order, with 5% added for what the
 * processor takes. */
var GD_LOSS = 0.05;
/* Page registers on: PPC's figures are not ready until the order book and the factory registers are all in (a plain look, it reads nothing). */
function gdFlowReady() { return typeof FLOW !== 'undefined' && FLOW && FLOW.ppc && typeof flowRfdCover === 'function' && (typeof prOn !== 'function' || !prOn() || ptHas(PTG_ALL)); }
/** RFD metres of a fabric that left on the flow's RFD challans to printers since the desk began counting it; 0 when the flow
 *  is not in this page or not read yet, or the desk has no opening count for the fabric (the flow then counts it elsewhere). */
function invChallanOut(name) {
  if (typeof flowRfdChallanOut !== 'function' || typeof FLOW === 'undefined' || !FLOW || !FLOW.ch) return 0;
  var opened = gdRfdOpened(name); if (!opened) return 0;
  try { return Math.max(0, +flowRfdChallanOut(name, opened) || 0); } catch (e) { console.warn('RFD on shelf for ' + name + ': challans to printers not counted (' + ((e && e.message) || e) + ').'); return 0; }
}
/* THE CLOTH FOR CUT TO SIZE (27 Nov): off the shelf the moment a line is allotted, from the oldest lots that
 * still hold RFD. One ledger row per line and lot, marked cutNo, so Take back removes exactly those. */
function gdCutLots(fabric) {
  var left = invLotsLeft(fabric, invChallanOut(fabric));
  return Object.keys(left).filter(function (lot) { return left[lot] > 0.005; }).map(function (lot) { return { lot: lot, left: left[lot] }; });
}
/** '' when the lots hold this many metres, else why not, in words. */
function gdCutCheck(fabric, metres) {
  if (GD_STATE !== 'ok' || !DB) return 'The Greige Desk could not be read, so no cloth can be taken. Nothing was saved.';
  var have = r2(gdCutLots(fabric).reduce(function (a, x) { return a + x.left; }, 0));
  return metres <= have + 0.005 ? '' : 'The Greige Desk lots of ' + fabric + ' hold ' + ctsN(have) + ' m of RFD, less than the ' + ctsN(metres) + ' m ticked. Tick fewer products.';
}
async function gdCutIssue(fabric, no, lines) {
  var short = gdCutCheck(fabric, lines.reduce(function (a, l) { return a + l.metres; }, 0)); if (short) return short;
  var lots = gdCutLots(fabric), rows = [], by = meUser().name;
  lines.forEach(function (l) {
    var need = l.metres;
    lots.forEach(function (L) {
      var take = r2(Math.min(need, L.left)); if (!(take > 0)) return;
      need = r2(need - take); L.left = r2(L.left - take);
      rows.push({ id: uid(), date: lmToday(), lot: L.lot, fabricType: fabric, txnType: 'ISSUE_TO_CUTTING', qty: take, party: 'Cutting', bill: '',
        orderNo: l.orderNo, done: false, by: by, cutNo: no, lineKey: l.key, remark: 'Cut pieces ' + l.sku + ' · ' + l.pcs + ' pcs' });
    });
  });
  var patch = {}, ready = gdCutReady(fabric, lines, rows);
  rows.forEach(function (r) { patch[GD_NODE + '/fab/' + r.id] = r; });
  try { await ptPatch(Object.assign(patch, ready)); } catch (e) { return 'The cloth could not be taken off the shelf (' + ((e && e.message) || e) + '). Nothing was saved.'; }
  rows.forEach(function (r) { DB.fab.push(r); if (GD_SNAP) GD_SNAP.fab[r.id] = JSON.stringify(r); });
  cutFlowKeep(ready);
  return '';
}
/** A line with no printing is marked "fabric ready" in the same save, as Send to cutting did, so Cutting Data shows its lot. */
function gdCutReady(fabric, lines, rows) {
  var patch = {}, at = new Date().toISOString(), by = (typeof ME !== 'undefined' && ME && ME.email) || meUser().name;
  lines.filter(function (l) { return l.noPrint; }).forEach(function (l) {
    var first = rows.filter(function (r) { return r.lineKey === l.key; })[0]; if (!first) return;
    patch['pt_flowDemand/' + l.key + '/fabricReady'] = { at: at, by: by, what: fabric, metres: l.metres, note: 'Sent to cutting · ' + first.lot, lot: first.lot, cutEntry: first.id };
  });
  return patch;
}
/** `back` (a line with no printing): its fabric-ready mark goes back to what it was, in the same save. */
async function gdCutReturn(no, key, back) {
  if (GD_STATE !== 'ok' || !DB) return 'The Greige Desk could not be read, so the cloth is not back on the shelf.';
  /* no challan number: every cut row of the line (a test order being deleted) */
  var gone = DB.fab.filter(function (r) { return r.cutNo && r.lineKey === key && (!no || r.cutNo === no); }), patch = {};
  gone.forEach(function (r) { patch[GD_NODE + '/fab/' + r.id] = null; });
  var mark = {};
  if (back) mark['pt_flowDemand/' + key + '/fabricReady'] = back.was;
  try { if (gone.length || back) await ptPatch(Object.assign(patch, mark)); } catch (e) { return 'The piece is taken back, but its cloth could not be returned to the shelf (' + ((e && e.message) || e) + '). Tell the office.'; }
  cutFlowKeep(mark);
  DB.fab = DB.fab.filter(function (r) { return gone.indexOf(r) < 0; });
  gone.forEach(function (r) { if (GD_SNAP) delete GD_SNAP.fab[r.id]; });
  return '';
}
function gdRfdShelf(name) {
  if (!DB) return 0;
  var k = String(name || '').trim().toUpperCase(), e = fabFlowRows(DB.fab || []).filter(function (x) { return String(x.fabricType).toUpperCase() === k; })[0];
  return e ? Math.max(0, e.rfdLeft) : 0;
}
/* THE DAY THIS DESK COUNTED AN RFD FABRIC (Ravi, 15 Oct: Sheeting 72 shown 21,782 m where the shelf holds 13,600): the
 * newest OPENING_RFD for it, ISO. PPC takes that count in place of the old fabric ledger up to that day. '' = never counted. */
function gdRfdOpened(name) {
  if (!DB) return '';
  var k = String(name || '').trim().toUpperCase(), d = '';
  (DB.fab || []).forEach(function (r) {
    if (!r || r.txnType !== 'OPENING_RFD' || String(r.fabricType || '').trim().toUpperCase() !== k) return;
    var x = String(r.date || ''), m = x.match(/^(\d{2})-(\d{2})-(\d{4})/); if (m) x = m[3] + '-' + m[2] + '-' + m[1];
    x = x.slice(0, 10); if (x > d) d = x;
  });
  return d;
}
function gdPipeline(name) {
  var k = String(name || '').trim().toUpperCase(), e = fabFlowRows(DB.fab || []).filter(function (x) { return String(x.fabricType).toUpperCase() === k; })[0] || {};
  var ord = (invOnOrder()[k] || {}).m || 0;
  return { order: ord, greige: Math.max(0, e.greigeLeft || 0), proc: Math.max(0, e.withProcessor || 0) };
}
var GD_FLOW_ASKED = false;
/* PPC DEMAND ON THE INVENTORY (Ravi, 15 Oct: "Greige for PPC — jo demand aayega ppc se wo greige order se pahle dikhe
 * jisase hum 1 jagah se hi perform kar sake"). The Greige for PPC figures, fabric by fabric, for the Inventory's first
 * column: what PPC needs, what is short after the free RFD, and the greige to order (with what is on its way taken off).
 * null when the flow is not here; { __loading: true } while the plans are being read. */
function gdPpcMap() {
  if (typeof flowRfdCover !== 'function') return null;
  /* Page registers on: the desk opens on the master alone, but PPC's figures are worked out from the order book and the factory registers.
   * Until all of them are in, the column says it is loading; the flow reads them (flowEnsureData waits for the whole set) and the screen is drawn again. */
  if (!gdFlowReady() || (typeof prOn === 'function' && prOn() && !ptHas(PTG_ALL))) {
    if (typeof flowEnsureData === 'function' && !GD_FLOW_ASKED) { GD_FLOW_ASKED = true; flowEnsureData().then(function () { if (UI.tab === 'inv') render(); }, function () { /* the column says so */ }); }
    return { __loading: true };
  }
  var cov = flowRfdCover(), out = {};
  Object.keys(cov.fab).forEach(function (k) {
    var f = cov.fab[k]; if (!(f.need > 0.05)) return;
    var pipe = gdPipeline(f.name), toOrder = Math.max(0, f.short - (pipe.order + pipe.greige + pipe.proc));
    out[String(f.name).toUpperCase()] = { name: f.name, need: f.need, lines: f.lines, free: Math.max(0, f.free), short: f.short,
      desk: gdRfdShelf(f.name), onWay: pipe.order + pipe.greige + pipe.proc, greigeM: toOrder > 0.05 ? Math.ceil(toOrder / (1 - GD_LOSS)) : 0, greige: fabGreigeOf(f.name) };
  });
  return out;
}
/** A greige PO, its line already written from what PPC needs. */
function gdPoFor(rfd, metres) {
  poOpen();
  var greige = fabGreigeOf(rfd);
  PO_DRAFT.lines = [{ rfd: rfd, greige: greige, desc: 'RFD ready: ' + rfd, descAuto: true, due: PO_DRAFT.date, metres: String(metres), rate: '', _rec: 0 }];
  PO_DRAFT.ppcAsk = { rfd: rfd, greige: greige, metres: metres };   // what PPC was short of when this PO was opened (gdPpcStillShort)
  poDraw();
  lmSay('ok', nf(metres) + ' m of ' + greige + ' for PPC is on the PO. Pick the supplier and the rate.');
}
/* RAISE PO FOR PPC, CHECKED AGAIN AT SAVE (Ravi, 26 Nov: two people raised a PO for one shortage). Behind the switch lineHold.
 * Raise PO fills the PO with what PPC was short of when the button was pressed. Before that PO is saved, the desk's POs are read
 * again from the database; if somebody else has put greige on order for that fabric since, the person is asked whether they still
 * want this one. It is asked, not refused: a second PO can be meant. Fails loudly: if the POs cannot be read, nothing is raised
 * and the form says so. */
/** '' when PPC is still as short as when the PO was opened, else the question to ask. Other people's new POs join the desk. */
async function gdPpcStillShort(ask) {
  var fresh = await ptGetFresh(GD_NODE + '/gpo'), known = {};
  DB.gpo.forEach(function (p) { known[p.id] = true; });
  Object.keys(fresh || {}).forEach(function (k) {
    var p = fresh[k]; if (!p || known[p.id || k]) return;
    if (!p.id) p.id = k;
    DB.gpo.push(p); GD_SNAP.gpo[p.id] = JSON.stringify(p);   // already in the database: not written again
  });
  var map = gdPpcMap();
  if (!map || map.__loading) { console.warn('[line hold] PPC figures not loaded — PO raised without the still-short check'); return ''; }
  var p = map[String(ask.rfd).toUpperCase()], now = p ? p.greigeM : 0;
  if (now >= ask.metres) return '';
  return 'Since this PO was opened, ' + nf(ask.metres - now) + ' m of ' + ask.greige + ' has been put on order by another PO. '
    + 'PPC is now short ' + (now > 0 ? nf(now) + ' m' : 'nothing') + '.\n\nRaise this PO anyway?';
}
/** true while the check runs (poSave is pressed again for the person once it has answered); false = go on saving.
 *  Save pressed again while the check runs does nothing, and an answer is dropped if this PO form has been closed or
 *  replaced by another meanwhile: only the PO that was asked about is ever saved. */
function gdPpcAskPending(after) {
  var draft = PO_DRAFT, ask = draft.ppcAsk;
  if (!ask || draft.editId || !lineHoldOn()) return false;
  if (ask.busy) return true;
  ask.busy = true;
  var gone = function () { return PO_DRAFT !== draft || $('lmPo').classList.contains('hide'); };
  gdPpcStillShort(ask).then(function (q) {
    if (gone()) return;
    draft.ppcAsk = null;
    if (q && !confirm(q)) { lmSay('ok', 'Not raised. The PO is still open to change or close.'); poDraw(); return; }
    poSave(after);
  }, function (e) {
    ask.busy = false;
    if (gone()) return;
    console.warn('[line hold] could not read the greige POs before raising one:', e);
    $('lmPoErr').textContent = 'Not raised — what is already on order could not be checked (' + ((e && e.message) || e) + '). Check the connection and press Save again.';
    $('lmPoErr').classList.remove('hide');
  });
  return true;
}
/** Over to the production flow, at one of its Demand tabs. */
function gdToFlow(view, find) {
  if (typeof showTab !== 'function') return;
  showTab('flow');
  try { FLOW_VIEW = view || 'drfd'; } catch (e) { /* the flow picks its own */ }
  /* `find` (a fabric's name) goes in the flow's search box, so only that fabric's lines show; the app's page, not the desk's */
  var box = window.document.getElementById('flQ');
  if (box && find != null) box.value = find;
  if (typeof ensureFlow === 'function') ensureFlow();
}

/* ---- THE MASTER DATA IS ONE (Ravi, 15 Oct: "greige ka and masterdata ka interlink hona chahiye") ----
 * In the app the desk's fabrics and its suppliers / RFD processors are Setup -> Master Database's own: Greige & RFD
 * fabric (pt_masters/greigeRfd) and the greige and RFD vendors of Vendors (pt_masters/vendorBook). They are read fresh on
 * every open, shown read-only on the desk's Master data, and changed in the Master Data. What the desk alone knows about a
 * fabric (warp / weft typed here before) is kept where the Master Data says nothing. A supplier the test records name but
 * the Master Data does not have is kept too, marked, so an old test PO still finds it. */
function gdLinked() {
  var m = (typeof PTG !== 'undefined' && PTG && PTG.masters) || {};
  return !!(m.greigeRfd && Object.keys(m.greigeRfd).some(function (k) { return k.charAt(0) !== '_'; }));
}
function gdYarns(count) {
  var y = function (s) { s = String(s || '').trim().replace(/'s$/i, 's'); return /^\d/.test(s) ? (/s$/i.test(s) ? s : s + 's') : ''; };
  var p = String(count || '').split(/\s*x\s*/i);
  return p.length === 2 ? [y(p[0]), y(p[1])] : [y(count), y(count)];
}
function gdLinkMasters() {
  if (!DB || !gdLinked() || typeof fmList !== 'function') return;
  var key = function (s) { return String(s || '').trim().toLowerCase(); };
  var old = {}; (DB.mst || []).forEach(function (m) { old[key(m.greige)] = m; });
  DB.mst = fmList('greigeRfd').filter(function (r) { return String(r.greige || '').trim(); }).map(function (r) {
    var o = old[key(r.greige)] || {}, yarn = gdYarns(r.count), pc = String(r.constr || '').match(/^\s*(\d+)\s*x\s*(\d+)\s*$/i);
    var num = function (v, was) { return v === '' || v == null ? (was || '') : v; };
    /* The RFD is called by the app's own fabric name (Sheeting 62, Cambric): that is the name PPC, the flow's Demand and this
     * desk's ledger rows all match on. The Master Data's full name rides along as the title. */
    var app = (Array.isArray(r.fabrics) ? r.fabrics : ptList(r.fabrics))[0];
    return { rfd: String(app || r.rfd || '').trim(), title: String(r.rfd || '').trim(), greige: String(r.greige).trim(), warp: o.warp || yarn[0], weft: o.weft || yarn[1],
      epi: pc ? +pc[1] : (o.epi || ''), ppi: pc ? +pc[2] : (o.ppi || ''), greigeWidth: num(r.gw, o.greigeWidth), rfdWidth: num(r.rw, o.rfdWidth),
      active: true, md: r.id };
  });
  var was = DB.ven || [], names = {};
  var ven = fmList('vendorBook').filter(function (v) { return v.type === 'greige' || v.type === 'rfd'; }).map(function (v) {
    names[key(v.name)] = 1;
    var o = was.filter(function (x) { return key(x.name) === key(v.name); })[0] || {};
    return { name: String(v.name || '').trim(), kind: v.type === 'greige' ? 'Supplier' : 'RFD Processor', phone: v.phone || o.phone || '',
      email: o.email || '', addr: v.address || o.addr || '', city: v.city || o.city || '', gstin: v.gstin || o.gstin || '', pan: v.pan || '', active: true, md: v.id };
  });
  was.forEach(function (v) { if (v && v.name && !names[key(v.name)] && venUsed(v.name) > 0) ven.push(Object.assign({}, v, { deskOnly: true })); });
  DB.ven = ven;
  /* The company on the PO: the app's own Greige PO settings (no Company page on the desk in the app). The numbering stays the desk's. */
  var s = (typeof GPO !== 'undefined' && GPO && GPO.settings) || null;
  if (s) DB.co = Object.assign({}, DB.co || {}, { name: s.company || (DB.co || {}).name || gdCoName(), addr: s.address || (DB.co || {}).addr || '',
    gstin: s.gstin || (DB.co || {}).gstin || '', email: s.email || (DB.co || {}).email || '', pan: s.pan || (DB.co || {}).pan || '',
    terms: s.terms || (DB.co || {}).terms || '' });   // the PO settings' "Default terms" start every new PO's terms & conditions
}
/** Over to Setup -> Master Database, at its Greige & RFD fabric or its Vendors. */
function gdOpenMasterData(view) {
  if (typeof showTab !== 'function') return;
  showTab('pmdb');
  try { if (typeof fmSetView === 'function') fmSetView(view === 'vendors' ? 'vendors' : 'fabric'); } catch (e) { /* the page opens where it was */ }
}

function wireGd() {
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest ? ev.target.closest('[data-ppcpo],[data-gdflow],[data-gdlines],[data-gdsend]') : null; if (!t) return;
    if (t.getAttribute('data-ppcpo')) { var p = t.getAttribute('data-ppcpo').split('|'); gdPoFor(p[0], +p[1]); return; }
    if (t.getAttribute('data-gdflow')) { gdToFlow(t.getAttribute('data-gdflow'), ''); return; }   // the whole list: no fabric left in the search
    if (t.getAttribute('data-gdlines')) { gdToFlow('drfd', t.getAttribute('data-gdlines')); return; }
    if (t.getAttribute('data-gdsend')) { gdSendToPrinter(t.getAttribute('data-gdsend')); return; }
  });
}
/* SEND TO PRINTER MAKES THE CHALLAN HERE (Vishesh, 23 Nov). The card is the flow's (flowShelfChallanOpen); the desk asks for it,
 * says why when it cannot open, and draws itself again once the challan is made. Without the flow in the page it falls back
 * to that fabric's lines on Demand → RFD, as before. */
function gdSendToPrinter(fabric) {
  if (typeof flowShelfChallanOpen !== 'function') { gdToFlow('drfd', fabric); return; }
  lmSay('ok', 'Reading the lines waiting for ' + fabric + '…');
  /* `no` is '' when only printer changes were asked for (they wait for approval); `said` then says what waits */
  flowShelfChallanOpen(fabric, function (no, said) {
    lmSay('ok', ((no ? 'Challan ' + no + ' made for ' + fabric + '. ' : '') + (said || '')).trim() || 'Nothing was sent.');
    render();
  }).then(function (why) { if (why) lmSay('warn', why); }, function (e) {
    console.error('Send to printer for ' + fabric + ' could not open:', e);
    lmSay('err', 'The challan for ' + fabric + ' could not open (' + ((e && e.message) || e) + '). Nothing was saved.');
  });
}


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
    await gdLoad();
    /* The desk could not be read: say so and stop — an empty desk on screen would invite typing over the real one. */
    if (GD_STATE !== 'ok') { $('lmPane').innerHTML = '<div class="card" style="color:#b91c1c">The Greige Desk could not be read just now (' + esc(GD_STATE.replace(/^err: /, '')) + '). Nothing was changed. Open it again in a moment.</div>'; return; }
    lmLoad();
    if (typeof gdLinkMasters === 'function') gdLinkMasters();   // the Master Data's fabrics and vendors, read fresh each time
    if (!GD_WIRED) { GD_WIRED = true; wireShell(); wirePurchaseOrders(); wireInventory(); wireLedger(); wireMasterData(); wireEntry(); wireUsersRfd(); wireCutToSize(); wireDateAsks(); wireGd(); }
    render();
    /* the priorities for the cutting and transit lists; the desk redraws when they are in */
    if (typeof flowPriLoad === 'function') flowPriLoad().then(render);
  }
  /* the desk as it stands now, with the Master Data's names, before cloth is taken or given back */
  async function cutFresh() {
    if (GD_READY) { await GD_READY; GD_READY = null; }
    await gdLoad();
    if (GD_STATE === 'ok' && typeof gdLinkMasters === 'function') gdLinkMasters();
  }
  return { open: open, cutFresh: cutFresh, cutCheck: gdCutCheck, cutIssue: gdCutIssue, cutReturn: gdCutReturn, ensure: function () { return gdLoad(); }, dateAsks: function () { return GD_STATE === 'ok' && DB ? gdDateAskItems() : []; },
    /* the same, from the ledger rows alone as the bell reads them (pt_gdTest/fab) when the desk itself was never opened */
    dateAsksIn: function (fabNode) { return gdDateAskItems(Object.keys(fabNode || {}).map(function (k) { return Object.assign({ id: k }, fabNode[k]); })); }, fabNode: function () { return GD_NODE + '/fab'; }, dateDecide: function (id, ok, why) { return gdDateDecide(id, ok, why); }, rfdKnown: function (n) { return !!mstOf(n); }, rfdShelf: function (n) { return gdRfdShelf(n); }, rfdOpened: function (n) { return gdRfdOpened(n); }, state: function () { return GD_STATE; },
    /* Read the desk again (the flow's Refresh): what is on screen stays until the new read answers. */
    reload: function () { if (GD_READY) { var was = GD_READY; GD_READY = null; return was.then(function () { GD_READY = null; return gdLoad(); }); } return gdLoad(); } };
})();
