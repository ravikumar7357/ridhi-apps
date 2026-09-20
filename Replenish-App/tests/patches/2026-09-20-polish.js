/* THE POLISH, NOT A REDESIGN.
 *
 * "design my app like professional." The app is not badly designed — it has a colour system, a type
 * scale that steps, a serif mark set as type, tabular figures in the number columns, frozen headers
 * and columns, zebra rows. What it does not have is the last ten per cent: everything is flat, the
 * focus ring is a one-pixel border you cannot see, the toolbar controls are three different heights,
 * and the big figures on the KPI strip jitter as they change because they are not tabular.
 *
 * So this is CSS only. Not one class name, element or line of logic moves — which is why every one
 * of the 4,154 tests, all of which read markup, still passes.
 *
 * WHAT IS DELIBERATELY NOT TOUCHED:
 *   · No web font is fetched. The page says why, at the top of its own stylesheet: nothing is
 *     fetched, so nothing can fail to load. A factory on a bad line is not kept waiting for a font.
 *   · No shadow on a frozen column. The comment there records that a shadow on ~400 sticky cells is
 *     repainted on every horizontal scroll frame, and that it is what made the grid stutter.
 *   · The sign-in screen, which is its own considered thing.
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

/* ---- 1. the tokens the rest of this leans on ---- */
one(`    --warn-bg:#fef9c3;--warn-ink:#854d0e}`,
`    --warn-bg:#fef9c3;--warn-ink:#854d0e;
    /* DEPTH, SET ONCE. Three steps and no more: a card barely off the page, a control that has been
       pressed, and a dialog that is plainly above everything. Shadows invented per rule are how a
       screen ends up with six slightly different greys under six slightly different boxes. */
    --sh-1:0 1px 2px rgba(15,23,42,.05);
    --sh-2:0 1px 3px rgba(15,23,42,.08),0 1px 2px rgba(15,23,42,.04);
    --sh-3:0 24px 64px rgba(15,23,42,.22);
    /* The ring a keyboard leaves. A one-pixel border change is not one you can see across a room,
       and this is a screen people work at all day. */
    --ring:0 0 0 3px rgba(99,102,241,.18);
    --ring-line:#6366f1;
    /* ONE HEIGHT FOR EVERY CONTROL IN A TOOLBAR. Three different ones is the single thing that makes
       a working screen look unfinished, and this app had three. */
    --ctl:38px}`, 'the tokens');

/* ---- 2. figures line up everywhere, not only in the number columns ---- */
one(`  body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);font-size:14px}`,
`  body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);font-size:14px;
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  /* EVERY FIGURE ON THE PAGE LINES UP. The number columns already had this; the KPI strip did not,
     so a total ticking from 145,539 to 146,002 shifted every tile beside it. Anywhere a number is
     read rather than a word, the digits are the same width. */
  .metric .v,.kpi,.vpbar b,.sumtbl,.sliptab,.pill,.lane,.fu,.navbadge{font-variant-numeric:tabular-nums}`, 'figures line up');

/* ---- 3. cards sit on the page rather than being drawn on it ---- */
one(`  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:14px}`,
`  .card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin-bottom:14px;
    box-shadow:var(--sh-1)}`, 'cards');

one(`  .kpi{flex:1 1 300px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px 12px}`,
`  .kpi{flex:1 1 300px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;
    box-shadow:var(--sh-1)}`, 'the KPI card');

/* ---- 4. the controls ---- */
one(`  input,select,textarea{font:inherit;color:var(--ink);background:var(--input);border:1px solid var(--line);
    border-radius:10px;padding:10px 12px;width:100%}
  input:focus,select:focus,textarea:focus{outline:none;border-color:var(--muted)}
  button{font:inherit;font-weight:600;cursor:pointer;border:0;border-radius:10px;padding:11px 16px;background:#0f172a;color:#fff}
  button.ghost{background:var(--card);color:var(--ink);border:1px solid var(--line);font-weight:500}
  button.ghost:hover{background:var(--hover)}
  button:disabled{opacity:.5;cursor:default}`,
`  input,select,textarea{font:inherit;color:var(--ink);background:var(--input);border:1px solid var(--line);
    border-radius:10px;padding:10px 12px;width:100%;transition:border-color .12s,box-shadow .12s}
  /* A RING YOU CAN SEE. The border alone changed by one shade and told a keyboard user nothing. */
  input:focus,select:focus,textarea:focus{outline:none;border-color:var(--ring-line);box-shadow:var(--ring)}
  input::placeholder,textarea::placeholder{color:#94a3b8}
  button{font:inherit;font-weight:600;cursor:pointer;border:1px solid #0f172a;border-radius:10px;padding:10px 16px;
    background:#0f172a;color:#fff;box-shadow:var(--sh-1);transition:background .12s,box-shadow .12s,transform .06s}
  button:hover{background:#1e293b;border-color:#1e293b}
  /* It moves when it is pressed. One pixel, and it is the difference between a picture of a button
     and a button. */
  button:active{transform:translateY(1px);box-shadow:none}
  button:focus-visible{outline:none;box-shadow:var(--ring)}
  button.ghost{background:var(--card);color:var(--ink);border:1px solid var(--line);font-weight:500;box-shadow:none}
  button.ghost:hover{background:var(--hover);border-color:#cbd5e1}
  button:disabled{opacity:.5;cursor:default;box-shadow:none}
  button:disabled:hover{background:#0f172a;border-color:#0f172a}
  button.ghost:disabled:hover{background:var(--card);border-color:var(--line)}`, 'the controls');

/* ---- 5. one height across a toolbar ---- */
one(`  .row{display:flex;gap:10px;flex-wrap:wrap}
  .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}`,
`  .row{display:flex;gap:10px;flex-wrap:wrap}
  .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  /* THE RAGGED EDGE. A search box 41px tall beside a date box of 38 and a button of 40 is the thing
     that reads as unfinished before anybody has looked at a single figure. One height, one radius.
     Scoped to a toolbar so nothing inside a table or a dialog is caught by it. */
  .toolbar > input,.toolbar > select,.toolbar > button{height:var(--ctl);padding-top:0;padding-bottom:0;line-height:calc(var(--ctl) - 2px)}
  .toolbar > input[type=date]{line-height:normal}
  .toolbar > button{display:inline-flex;align-items:center;justify-content:center;line-height:1}`, 'one height');

/* ---- 6. the grid reads lighter, and the header sits above it ---- */
one(`  table.xl thead th{position:sticky;top:0;z-index:5;background:#f8fafc;font-weight:700;text-align:center;cursor:pointer;vertical-align:top}`,
`  /* THE HEADER IS ABOVE THE DATA, and now looks it. One row of sticky cells, so the shadow costs
     nothing — unlike the frozen columns, where the comment below records why there is none. */
  table.xl thead th{position:sticky;top:0;z-index:5;background:#f8fafc;font-weight:700;text-align:center;cursor:pointer;vertical-align:top;
    font-size:12.5px;letter-spacing:.01em;color:#334155;box-shadow:inset 0 -1px 0 #cbd5e1}`, 'the header');

one(`  table.xl tbody tr:nth-child(even) td{background:#fbfcfe}
  table.xl tbody tr:hover td{background:var(--hover)}`,
`  table.xl tbody tr:nth-child(even) td{background:#fbfcfe}
  /* The row under the pointer, and the one it is beside, kept apart — zebra plus hover of the same
     weight makes both disappear. */
  table.xl tbody tr:hover td{background:#eef2f7}
  table.xl tbody tr:hover td.frz,table.xl tbody tr:hover td.frz2{background:#eef2f7}`, 'the rows');

/* ---- 7. a notice reads as a notice, not as a wall ---- */
one(`  .err{background:var(--bad-bg);color:var(--bad);padding:12px 14px;border-radius:10px;font-size:14px;margin-bottom:12px}
  .ok{background:var(--accent-bg);color:var(--accent);padding:12px 14px;border-radius:10px;font-size:14px;margin-bottom:12px}
  .warn{background:var(--warn-bg);color:var(--warn-ink);padding:12px 14px;border-radius:10px;font-size:13px}`,
`  /* A BAR DOWN THE SIDE, not a slab of colour. The fill is lighter and the edge carries the weight,
     which is what lets a long notice stay readable — and the notices on this app do get long. */
  .err{background:var(--bad-bg);color:var(--bad);padding:11px 14px;border-radius:10px;font-size:14px;margin-bottom:12px;
    border-left:3px solid var(--bad);line-height:1.5}
  .ok{background:var(--accent-bg);color:var(--accent);padding:11px 14px;border-radius:10px;font-size:14px;margin-bottom:12px;
    border-left:3px solid var(--accent);line-height:1.5}
  .warn{background:var(--warn-bg);color:var(--warn-ink);padding:11px 14px;border-radius:10px;font-size:13px;
    border-left:3px solid #ca8a04;line-height:1.5}`, 'the notices');

/* ---- 8. pills sit on the line they are on ---- */
one(`  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700}`,
`  /* line-height, so a pill beside a figure does not push its own row taller than its neighbours. */
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;line-height:17px;vertical-align:1px}`, 'the pills');

/* ---- 9. the dialog is plainly above everything ---- */
one(`  .ptmodal-box{background:var(--card);border:1px solid var(--line);border-radius:14px;width:640px;
    max-width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.28)}`,
`  .ptmodal-box{background:var(--card);border:1px solid var(--line);border-radius:16px;width:640px;
    max-width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:var(--sh-3)}`, 'the dialog');

/* ---- 10. the nav says where you are ---- */
one(`  .nav:hover{background:var(--hover)}
  .nav.on{background:var(--hover);font-weight:600}`,
`  .nav:hover{background:var(--hover)}
  /* WHERE YOU ARE, said by more than a shade of grey. The same weight of background carried both
     "you are here" and "your pointer is here", so on a still screen neither said anything. */
  .nav.on{background:#eef2ff;font-weight:600;color:#1e1b4b;box-shadow:inset 2px 0 0 var(--ring-line)}
  .nav:focus-visible{outline:none;box-shadow:var(--ring)}`, 'the nav');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
