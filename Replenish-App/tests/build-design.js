/* BUILDS public/design/index.html — every part the app is made of, on one page.
 *
 *   node build-design.js
 *
 * WHY THIS IS BUILT AND NOT WRITTEN. A page that copies the app's styles is a page that stops being
 * true the first time somebody changes a colour. This one takes the app's own <style> block, its own
 * icons and its own CSS variables straight out of public/index.html at build time, so what is on it
 * is what the app will actually draw. Change the app, run this again, and the sheet has moved with it.
 *
 * WHAT IT IS FOR (Ravi, 2026-09-23, on making the front end better): one place to agree what a
 * button, a pill, a card and a table row look like. Say it once here and it is said on every screen,
 * because every screen uses these same classes. It is also where the pieces that do the same job in
 * two different ways are listed by name, so new screens stop picking the wrong one.
 */
const fs = require('fs');
const pathm = require('path');
const APP = pathm.join(__dirname, '..', 'public', 'index.html');
const OUT = pathm.join(__dirname, '..', 'public', 'design', 'index.html');

const html = fs.readFileSync(APP, 'utf8');

/* ---- the app's own styles ---- */
const sOpen = html.indexOf('<style>'), sClose = html.indexOf('</style>', sOpen);
if (sOpen < 0 || sClose < 0) throw new Error('no <style> block in the app');
const CSS = html.slice(sOpen + 7, sClose);

/* ---- the app's own icons ---- */
const iOpen = html.indexOf('const JW_ICON = {');
if (iOpen < 0) throw new Error('JW_ICON not found — did it get renamed?');
const iClose = html.indexOf('\n};', iOpen);
const ICONS = new Function('return ' + html.slice(iOpen + 'const JW_ICON = '.length, iClose + 2))();

/* ---- the colours, read from :root rather than typed out again ---- */
const rootBlock = CSS.slice(CSS.indexOf(':root{'), CSS.indexOf('}', CSS.indexOf(':root{')));
const VARS = [];
rootBlock.replace(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi, (m, name, val) => {
  const v = val.trim();
  if (/^(--)?(serif|sh-|ring)/.test(name) || v.includes(',') && !v.startsWith('rgba')) return m;  // fonts and shadows are not swatches
  VARS.push([name, v]);
  return m;
});

/* ---- what is said twice, so new screens stop picking the wrong one ---- */
const count = (re) => (html.match(re) || []).length;
const DOUBLES = [
  ['Status pill', '.jw-st', count(/class="jw-st/g), '.pill', count(/class="pill[ "]/g),
    'Use .jw-st on anything new. .pill is the older one and is still on screens that have not been redrawn.'],
  ['Small button', '.jw-btn', count(/class="jw-btn/g), '.ghost', count(/class="ghost"/g),
    'Use .jw-btn inside a table row. .ghost is for a toolbar button, which is taller.'],
  ['Tiny tag', '.st', count(/class="st /g), '(defined twice)', (CSS.match(/^\s*\.st\{/gm) || []).length,
    '.st has two definitions in the stylesheet — one 6px corner, one fully round. The later one wins; the earlier is dead.'],
];

const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
/* A live example and the markup that made it, side by side. */
const demo = (markup, note) => '<div class="d-demo"><div class="d-live">' + markup + '</div>'
  + '<pre class="d-code">' + esc(markup.replace(/\n\s+/g, '\n  ').trim()) + '</pre></div>'
  + (note ? '<p class="d-note">' + note + '</p>' : '');

const SECTIONS = [];
const sec = (id, title, body) => SECTIONS.push({ id, title, body });

/* ---------- colours ---------- */
sec('colour', 'Colours', '<p>Every colour the app uses is one of these, set once at the top of the stylesheet. '
  + 'A colour typed straight into a rule is how a screen ends up with six slightly different greys.</p>'
  + '<div class="d-swatches">' + VARS.map(v => '<div class="d-sw"><span style="background:var(--' + v[0] + ')"></span>'
    + '<b>--' + v[0] + '</b><i>' + esc(v[1]) + '</i></div>').join('') + '</div>'
  + '<p class="d-note">The status colours below are not variables yet — they are written into the pill rules. '
  + 'Green #166534 means done, blue #1d4ed8 means in progress, amber #c2410c means waiting, red #991b1b means wrong.</p>');

/* ---------- text ---------- */
sec('text', 'Text', demo('<h2 style="margin:0 0 4px">A screen\'s title</h2>\n'
  + '<div style="font-weight:600">A row\'s heading — 600, never bold-bold</div>\n'
  + '<div class="jw-sub">The line under it: colour • size, a date, a count</div>\n'
  + '<div class="jw-sku">RPC177-2020 · SHP-3408</div>\n'
  + '<div class="muted">Anything the reader can ignore</div>\n'
  + '<div class="err">Something is wrong and somebody has to act</div>\n'
  + '<div class="ok">It worked</div>',
  '<b>.jw-sku</b> is monospaced on purpose: codes are compared letter by letter, and a proportional font '
  + 'makes RPC177 and RPCI77 look the same.'));

/* ---------- buttons ---------- */
sec('button', 'Buttons', demo('<button>Refresh</button>\n'
  + '<button class="ghost">Export</button>\n'
  + '<button class="jw-btn jw-primary">Entry</button>\n'
  + '<button class="jw-btn">Edit</button>\n'
  + '<button class="jw-btn jw-fix">Correction</button>\n'
  + '<button class="jw-btn jw-wa">WhatsApp</button>\n'
  + '<button class="jw-btn jw-more">⋯</button>\n'
  + '<button class="jw-btn" disabled>Change asked</button>\n'
  + '<button class="jw-link">Clear filters</button>')
  + '<table class="d-rules"><tbody>'
  + [['<code>button</code>', 'The one thing this toolbar is for. One per toolbar — two dark buttons is no dark button.'],
    ['<code>.ghost</code>', 'Everything else in a toolbar: Export, Clear, Template.'],
    ['<code>.jw-btn</code>', 'Inside a table row. Short, 28px, never wraps.'],
    ['<code>.jw-btn.jw-primary</code>', 'The action that row is FOR — Receive on Job Work, Entry on the order book. At most one per row.'],
    ['<code>.jw-btn.jw-fix</code>', 'Asking somebody else to change something. Amber, because it is a request, not a change.'],
    ['<code>.jw-btn.jw-more</code>', 'The ⋯ that opens the rest. Always last.'],
    ['<code>.jw-link</code>', 'Looks like a link, does something small: Reset, Clear, Show more.'],
    ['<code>[disabled]</code>', 'Only when pressing it could not work — never as a way of hiding a permission. '
      + 'Somebody without the right gets no button at all, not one that refuses.']]
    .map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('') + '</tbody></table>');

/* ---------- pills ---------- */
sec('pill', 'Status', demo('<span class="jw-st pend">' + ICONS.clock + ' Pending</span>\n'
  + '<span class="jw-st prog">↻ In Progress</span>\n'
  + '<span class="jw-st done">' + ICONS.tick + ' Completed</span>\n'
  + '<span class="jw-st pend">25 to cut</span>\n'
  + '<span class="jw-st prog">12 to make</span>\n'
  + '<span class="jw-st done">Complete</span>',
  'Amber = nothing has happened yet. Blue = it is moving. Green = it is finished. '
  + 'A pill carries the NUMBER where there is one — "12 to make" tells somebody what to do; "In Progress" does not.')
  + '<h3>The older one, still on undrawn screens</h3>'
  + demo('<span class="pill pill-low">25 to cut</span>\n'
  + '<span class="pill pill-out">12 to make</span>\n'
  + '<span class="pill pill-ok">Complete</span>\n'
  + '<span class="st st-pending">custom</span>',
  'Do not use <code>.pill</code> on a new screen. It is kept because a dozen screens still carry it, '
  + 'and they will move over as each is redrawn.'));

/* ---------- kpi cards ---------- */
const kpi = (v, l, icon, tone, sub, on) => '<div class="jw-kc metric pt-kpi' + (on ? ' pt-kpi-on' : '') + '">'
  + '<div class="jw-kt"><div><div class="v">' + v + '</div><div class="l">' + l + (on ? ' ✕' : '') + '</div></div>'
  + '<span class="jw-ki ' + tone + '">' + ICONS[icon] + '</span></div><div class="jw-ks">' + sub + '</div></div>';
sec('kpi', 'The figures', '<p>Cards, not a strip of numbers. Each one says what it is a share OF — a figure '
  + 'with nothing to measure it against is just a big number. A card that narrows the table below says so with ✕.</p>'
  + '<div class="jw-kpiname">Order Console</div><div class="jw-kpis">'
  + kpi('2,828', 'Lines', 'list', 'blue', 'one order, one SKU')
  + kpi('39,968', 'Cut', 'cut', 'blue', '23% of ordered')
  + kpi('39,028', 'Received', 'ok', 'green', '88.3% of issued')
  + kpi('136,932', 'Still to make', 'clock', 'red', '78.6% of ordered', true)
  + kpi('64', 'Sent, never recorded', 'x', 'amber', 'gone, with no entry behind them')
  + '</div>'
  + '<p class="d-note">Tones: <b>blue</b> is a plain count, <b>green</b> is work finished, <b>amber</b> is '
  + 'something to look at, <b>red</b> is what is outstanding. Nothing else gets a colour.</p>');

/* ---------- table ---------- */
const av = (bg, fg, ini) => '<span class="jw-av" style="background:' + bg + ';color:' + fg + '">' + ini + '</span>';
const ring = p => '<div class="jw-ring"><svg viewBox="0 0 36 36" width="34" height="34">'
  + '<circle cx="18" cy="18" r="14" fill="none" stroke="#e5e7eb" stroke-width="4"/>'
  + '<circle cx="18" cy="18" r="14" fill="none" stroke="' + (p >= 100 ? '#16a34a' : p > 0 ? '#2563eb' : '#cbd5e1')
  + '" stroke-width="4" stroke-linecap="round" stroke-dasharray="' + (2 * Math.PI * 14 * p / 100).toFixed(1)
  + ' ' + (2 * Math.PI * 14).toFixed(1) + '" transform="rotate(-90 18 18)"/></svg><b>' + p + '%</b></div>';
const itemCell = (name, sub, code) => '<td style="text-align:left"><div class="jw-item">'
  + '<span style="flex:0 0 auto;line-height:0"><span class="muted" style="font-size:11px">—</span></span>'
  + '<div style="min-width:0"><div style="font-weight:600">' + name + '</div>'
  + '<div class="jw-sub">' + sub + '</div><div class="jw-sku">' + code + '</div></div></div></td>';
sec('table', 'A row', '<p>One cell for the order, one for the product. Six narrow columns for one item is how a '
  + 'table grows wider than the screen and loses its first column.</p>'
  + '<div class="card xlwrap jw-table" style="max-height:none"><table class="xl">'
  + '<thead><tr><th class="frz">Order</th><th>Item</th><th class="num">Ordered</th><th>Progress</th>'
  + '<th>Status</th><th>Karigar</th><th></th></tr></thead><tbody>'
  + '<tr><td class="frz" style="text-align:left"><a href="#" style="color:inherit;text-decoration:underline dotted;font-weight:600">SHP-3408</a>'
  + '<div class="jw-sub">#3408</div><div class="jw-sku">ADJ-3408-RCNB</div><div class="jw-t">2026-08-16</div></td>'
  + itemCell('Piping Flap Pillow Cover', 'Blue Leaf • 20x20', 'RPC177-2020')
  + '<td class="num">12 <span class="jw-u">pcs</span></td><td>' + ring(25) + '</td>'
  + '<td style="text-align:left"><span class="jw-st pend">12 to cut</span><div class="jw-sub">12 to cut</div></td>'
  + '<td style="text-align:left"><div class="jw-who">' + av('#e0ecff', '#1d4ed8', 'AD')
  + '<div><div style="font-weight:600">Asha Devi</div><div class="jw-sub">Company Contractor</div></div></div></td>'
  + '<td><div class="jw-acts"><button class="jw-btn jw-primary">Entry</button>'
  + '<button class="jw-btn">Assign</button><button class="jw-btn jw-more">⋯</button></div></td></tr>'
  + '<tr class="jw-on"><td class="frz" style="text-align:left"><a href="#" style="color:inherit;text-decoration:underline dotted;font-weight:600">SHP-3385</a>'
  + '<div class="jw-sub">#3385</div><div class="jw-t">2026-08-14</div></td>'
  + itemCell('King Quilt', 'Columbia Blue • 96x106', 'RQL516-K')
  + '<td class="num">4 <span class="jw-u">pcs</span></td><td>' + ring(100) + '</td>'
  + '<td style="text-align:left"><span class="jw-st done">Complete</span></td>'
  + '<td style="text-align:left"><span class="muted">—</span></td>'
  + '<td><div class="jw-acts"><button class="jw-btn">View</button><button class="jw-btn jw-more">⋯</button></div></td></tr>'
  + '</tbody></table></div>'
  + '<table class="d-rules"><tbody>'
  + [['<code>.jw-table</code>', 'On the wrapper. Gives the rows their height and the picked row its blue.'],
    ['<code>.jw-item</code>', 'Picture, what it is, colour • size, code. Never separate columns for those.'],
    ['<code>.jw-ring</code>', 'How far along, with the real figures in the tooltip.'],
    ['<code>.jw-av</code>', 'A person. Same name, same colour, everywhere in the app.'],
    ['<code>.num</code>', 'Every column of figures, so they line up on the digit.'],
    ['<code>.frz</code>', 'The first column, pinned, so it cannot slide off a narrow screen.'],
    ['<code>tr.jw-on</code>', 'The row being worked on.']]
    .map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>').join('') + '</tbody></table>');

/* ---------- forms ---------- */
sec('form', 'Filters and forms', demo('<div class="toolbar">\n'
  + '  <select style="flex:0 0 200px"><option>All orders</option></select>\n'
  + '  <input placeholder="Search order / SKU / article" style="flex:1 1 180px;min-width:0">\n'
  + '  <input type="date" style="flex:0 0 150px">\n'
  + '  <button class="ghost">Clear</button>\n'
  + '  <button>Refresh</button>\n'
  + '</div>',
  'A filter select always starts with its "all" option — "All orders", "Any status" — because that is '
  + 'what the Filters button reads to name it. Three or more filters on a card and they move behind one '
  + '<b>Filters</b> button by themselves.')
  + demo('<div class="row" style="gap:10px">\n'
  + '  <div style="flex:1"><label>Karigar</label><input value="Asha Devi"></div>\n'
  + '  <div style="flex:0 0 120px"><label>Pieces</label><input type="number" value="12"></div>\n'
  + '</div>\n<div class="muted" style="font-size:12.5px;margin-top:6px">A note under the field</div>'));

/* ---------- icons ---------- */
sec('icon', 'Icons', '<p>The whole set. They are drawn with the current text colour, so a card\'s tone colours its icon too.</p>'
  + '<div class="d-icons">' + Object.keys(ICONS).map(k => '<div class="d-icon"><span class="jw-ki blue">'
  + ICONS[k] + '</span><b>' + k + '</b></div>').join('') + '</div>');

/* ---------- said twice ---------- */
sec('double', 'Said twice', '<p>Two ways of doing the same job. Both are listed with how many times each is used '
  + 'in the app today, counted when this page was built — so when the older one reaches zero it can be deleted.</p>'
  + '<table class="d-rules"><thead><tr><th>Part</th><th>Use this</th><th>Not this</th><th></th></tr></thead><tbody>'
  + DOUBLES.map(d => '<tr><td>' + d[0] + '</td><td><code>' + d[1] + '</code> <span class="muted">· ' + d[2]
    + ' uses</span></td><td><code>' + d[3] + '</code> <span class="muted">· ' + d[4] + ' uses</span></td>'
    + '<td>' + d[5] + '</td></tr>').join('') + '</tbody></table>');

/* ---------- the page ---------- */
const page = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n'
  + '<title>The look of the app — Ridhi Home</title>\n'
  + '<link rel="icon" href="/icon-192.png">\n'
  + '<style>' + CSS + '</style>\n'
  + '<style>\n'
  + '  body{display:block;background:var(--bg);padding:0;margin:0}\n'
  + '  .d-wrap{display:flex;gap:24px;align-items:flex-start;max-width:1400px;margin:0 auto;padding:22px 20px 60px}\n'
  + '  .d-nav{flex:0 0 190px;position:sticky;top:22px}\n'
  + '  .d-nav a{display:block;padding:7px 10px;border-radius:8px;color:var(--muted);text-decoration:none;font-size:13px;font-weight:600}\n'
  + '  .d-nav a:hover{background:var(--hover);color:var(--ink)}\n'
  + '  .d-main{flex:1 1 auto;min-width:0}\n'
  + '  .d-sec{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-bottom:18px}\n'
  + '  .d-sec h2{margin:0 0 4px;font-size:19px}\n'
  + '  .d-sec h3{margin:18px 0 6px;font-size:14px;color:var(--muted)}\n'
  + '  .d-sec p{margin:6px 0 14px;font-size:13.5px;line-height:1.6;color:var(--muted);max-width:70ch}\n'
  + '  .d-demo{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;margin:10px 0}\n'
  /* A grid track is as wide as its widest child unless it is told otherwise, and a block of code with
     no spaces in it is very wide indeed — which pushed this whole page off the right of the screen. */
  + '  .d-demo>*{min-width:0}\n'
  + '  .d-sec{overflow:hidden}\n'
  + '  .d-rules{table-layout:fixed}\n'
  + '  .d-rules td:last-child{white-space:normal}\n'
  /* ON WHITE, because that is what these sit on in the app. A pill whose background is #fff7ed is
     invisible against the page grey, and it was being read as "that one has no background". */
  + '  .d-live{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:14px;border:1px dashed var(--line);border-radius:10px;background:var(--card)}\n'
  + '  .d-live>*{margin:0}\n'
  + '  .d-code{margin:0;padding:12px 14px;background:#0f172a;color:#e2e8f0;border-radius:10px;font-size:11.5px;line-height:1.55;overflow:auto;white-space:pre-wrap;word-break:break-word}\n'
  + '  .d-note{font-size:12.5px;color:var(--muted);margin:2px 0 0!important}\n'
  + '  .d-rules{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}\n'
  + '  .d-rules th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);padding:6px 10px;border-bottom:1px solid var(--line)}\n'
  + '  .d-rules td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;color:var(--ink)}\n'
  /* A fixed layout obeys the first width it is given, and "1%" collapsed this column to nothing —
     the code and its explanation were drawn on top of each other. */
  + '  .d-rules td:first-child,.d-rules th:first-child{width:200px}\n'
  + '  .d-rules code{background:var(--hover);padding:2px 6px;border-radius:5px;font-size:12px}\n'
  + '  .d-swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}\n'
  + '  .d-sw{display:flex;align-items:center;gap:9px;font-size:12px}\n'
  + '  .d-sw span{width:30px;height:30px;border-radius:8px;border:1px solid var(--line);flex:0 0 auto}\n'
  + '  .d-sw b{font-family:ui-monospace,monospace;font-size:11.5px}\n'
  + '  .d-sw i{color:var(--muted);font-style:normal;font-size:11px;margin-left:auto}\n'
  + '  .d-icons{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:12px}\n'
  + '  .d-icon{display:flex;align-items:center;gap:8px;font-size:12px}\n'
  + '  .d-head{max-width:1400px;margin:0 auto;padding:26px 20px 0}\n'
  + '  .d-head h1{margin:0;font-size:26px;letter-spacing:-.01em}\n'
  + '  .d-head p{margin:6px 0 0;font-size:13.5px;color:var(--muted);max-width:75ch;line-height:1.6}\n'
  + '  @media (max-width:900px){.d-demo{grid-template-columns:1fr}}\n'
  + '</style></head><body>\n'
  + '<div class="d-head"><h1>The look of the app</h1>\n'
  + '<p>Every part the screens are built from, drawn with the app\'s own stylesheet. Say it once here — '
  + 'this button is too big, that pill is the wrong colour — and it is said on every screen, because every '
  + 'screen uses these same classes.</p>\n'
  + '<p class="muted" style="font-size:12px">Built from <code>public/index.html</code> on '
  + new Date().toISOString().slice(0, 10) + ' · rebuild with <code>node tests/build-design.js</code></p></div>\n'
  + '<div class="d-wrap"><nav class="d-nav">'
  + SECTIONS.map(s => '<a href="#' + s.id + '">' + s.title + '</a>').join('') + '</nav>\n'
  + '<main class="d-main">'
  + SECTIONS.map(s => '<section class="d-sec" id="' + s.id + '"><h2>' + s.title + '</h2>' + s.body + '</section>').join('\n')
  + '</main></div></body></html>\n';

fs.mkdirSync(pathm.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, page);
console.log('wrote', OUT, '·', SECTIONS.length, 'sections ·', VARS.length, 'colours ·', Object.keys(ICONS).length, 'icons');
DOUBLES.forEach(d => console.log('  said twice:', d[0], '→', d[1], d[2] + ' uses, vs', d[3], d[4] + ' uses'));
