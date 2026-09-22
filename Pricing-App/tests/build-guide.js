/* BUILDS public/guide/index.html — the in-app guide, English and Hindi, one section per screen.
 *
 *   node build-guide.js <folder with section fragments>
 *
 * Each fragment file holds <section class="sec" id="TAB">…</section> blocks written in one markup
 * (see the guide's own CSS below). Sections are placed in the sidebar's order and grouped the same
 * way, so the guide reads like the app. A screen with no section is reported, not silently dropped.
 */
const fs = require('fs'), pathm = require('path');
const SRC = process.argv[2];
if (!SRC) { console.error('usage: node build-guide.js <fragments folder>'); process.exit(1); }
const OUT = pathm.join(__dirname, '..', 'public', 'guide', 'index.html');

const GROUPS = [
  ['research', 'Research', 'रिसर्च', ['new', 'pr']],
  ['sales', 'Sales', 'सेल्स', ['sales', 'profit', 'sa', 'plaudit']],
  ['listing', 'Listing', 'लिस्टिंग', ['opt', 'basket', 'health', 'lrules', 'audit', 'bsr']],
  ['ads', 'Advertising', 'एडवर्टाइजिंग', ['trends', 'weekly', 'st', 'plc', 'deals']],
  ['inv', 'Inventory', 'इन्वेंटरी', ['age']],
  ['social', 'Social', 'सोशल', ['tiktok', 'carousel']],
];

/* ---- gather the sections ---- */
const secs = new Map();
fs.readdirSync(SRC).filter(f => /\.html$/i.test(f)).sort().forEach(f => {
  const txt = fs.readFileSync(pathm.join(SRC, f), 'utf8');
  const re = /<section class="sec" id="([a-z]+)">[\s\S]*?<\/section>/g;
  let m;
  while ((m = re.exec(txt))) {
    if (secs.has(m[1])) throw new Error(`section ${m[1]} is in two files`);
    secs.set(m[1], m[0]);
  }
});

/* ---- check them ---- */
const problems = [];
for (const [id, html] of secs) {
  if (/<script|<style|<html|<head/i.test(html)) problems.push(`${id}: has a script, style or page tag`);
  const en = (html.match(/class="en"/g) || []).length, hi = (html.match(/class="hi"/g) || []).length;
  if (en !== hi) problems.push(`${id}: ${en} English blocks but ${hi} Hindi`);
  if (!/[ऀ-ॿ]/.test(html)) problems.push(`${id}: no Hindi text at all`);
  if (!/<h2>/.test(html)) problems.push(`${id}: no heading`);
}
const wanted = GROUPS.flatMap(g => g[3]);
const missing = wanted.filter(k => !secs.has(k));
const extra = [...secs.keys()].filter(k => wanted.indexOf(k) < 0);
if (problems.length) { console.error('PROBLEMS:\n  ' + problems.join('\n  ')); process.exit(1); }

/* ---- the contents list and the body ---- */
const titleOf = html => {
  const en = (html.match(/<h2><span class="en">([\s\S]*?)<\/span>/) || [])[1] || '';
  const hi = (html.match(/<span class="hi">([\s\S]*?)<\/span><\/h2>/) || [])[1] || '';
  return { en: en.replace(/<[^>]+>/g, '').replace(/\s*[—-].*$/, ''), hi: hi.replace(/<[^>]+>/g, '').replace(/\s*[—-].*$/, '') };
};
let toc = '', body = '';
GROUPS.forEach(([key, en, hi, tabs]) => {
  const have = tabs.filter(t => secs.has(t));
  if (!have.length) return;
  toc += `<div class="tg"><div class="tgh"><span class="en">${en}</span><span class="sep"> · </span><span class="hi">${hi}</span></div>`
    + have.map(t => { const x = titleOf(secs.get(t)); return `<a href="#${t}"><span class="en">${x.en}</span><span class="sep"> · </span><span class="hi">${x.hi}</span></a>`; }).join('') + '</div>';
  body += `<div class="grp" id="grp-${key}"><div class="grph"><span class="en">${en}</span><span class="sep"> · </span><span class="hi">${hi}</span></div>`
    + have.map(t => secs.get(t)).join('\n') + '</div>\n';
});

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sellora guide · सेलोरा गाइड</title>
<style>
  :root { --ink:#1a1a1a; --muted:#5b6170; --line:#dde1e8; --accent:#4f46e5; --soft:#eef0ff; --warn-bg:#fff8e6; --warn-line:#f0d58a; --bg:#f6f7f9; --card:#fff; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 "Segoe UI", "Nirmala UI", "Noto Sans Devanagari", Arial, sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 16px; }
  header { padding: 8px 0 12px; border-bottom: 1px solid var(--line); }
  h1 { font-size: 26px; margin: 0; }
  .sub { color: var(--muted); font-size: 13px; }
  .bar { position: sticky; top: 0; z-index: 5; background: var(--bg); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 0; }
  .bar button, .bar a { font: inherit; font-size: 13px; padding: 6px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--ink); cursor: pointer; text-decoration: none; }
  .bar button.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .bar input { font: inherit; font-size: 13px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; flex: 1 1 200px; min-width: 0; }
  .toc { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; margin: 10px 0 6px; }
  .tg { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
  .tgh { font-weight: 700; font-size: 13px; margin-bottom: 4px; }
  .tg a { display: block; font-size: 13px; color: var(--accent); text-decoration: none; padding: 2px 0; }
  .grph { margin: 34px 0 0; font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
  h2 { font-size: 20px; margin: 10px 0 8px; padding-bottom: 4px; border-bottom: 2px solid var(--accent); }
  .sec { scroll-margin-top: 60px; margin-bottom: 26px; }
  .step { background: var(--card); border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 8px; padding: 12px 14px; margin: 10px 0; scroll-margin-top: 60px; }
  .n { display: inline-block; min-width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 50%; background: var(--accent); color: #fff; font-size: 12px; font-weight: 700; margin-right: 6px; }
  .t { font-weight: 700; }
  .where { color: var(--accent); font-weight: 600; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 4px; }
  .pair > div { min-width: 0; }
  .hi { font-family: "Nirmala UI", "Noto Sans Devanagari", "Segoe UI", sans-serif; }
  /* ONE LANGUAGE MEANS ONE LANGUAGE — headings, contents and separators included. */
  body.only-en .hi, body.only-hi .en, body.only-en .sep, body.only-hi .sep { display: none; }
  body.only-en .pair, body.only-hi .pair { grid-template-columns: 1fr; }
  body.both .pair > .hi { border-left: 1px dashed var(--line); padding-left: 14px; }
  .note { background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: 8px; padding: 10px 12px; margin: 10px 0; }
  .flow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 10px 0; }
  .flow span { border: 1px solid var(--accent); background: var(--soft); border-radius: 8px; padding: 5px 10px; font-weight: 600; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; background: var(--card); font-size: 14px; }
  th, td { border: 1px solid var(--line); padding: 6px 9px; text-align: left; vertical-align: top; }
  ul { margin: 4px 0; padding-left: 20px; }
  .hidden { display: none !important; }
  #none { color: var(--muted); padding: 20px 0; }
  @media (max-width: 700px) { .pair { grid-template-columns: 1fr; } body.both .pair > .hi { border-left: 0; padding-left: 0; border-top: 1px dashed var(--line); padding-top: 8px; } h1 { font-size: 22px; } }
  @media print { .bar, .toc { display: none; } .step, .note { break-inside: avoid; } h2 { break-after: avoid; } body { background: #fff; } .sec { break-before: page; } }
</style>
</head>
<body class="both">
<div class="wrap">
<header>
  <h1><span class="en">Sellora guide</span><span class="sep"> · </span><span class="hi">सेलोरा गाइड</span></h1>
  <div class="sub"><span class="en">Every screen, step by step · Sellora</span><span class="sep"> · </span><span class="hi">हर स्क्रीन, स्टेप-बाय-स्टेप</span></div>
</header>
<div class="bar">
  <button data-lang="both" class="on">English + हिंदी</button>
  <button data-lang="en">English</button>
  <button data-lang="hi">हिंदी</button>
  <input id="q" placeholder="Search · खोजें (e.g. profit, PPC, लिस्टिंग)">
  <a href="Sellora-Guide.pdf" download>PDF</a>
  <a href="javascript:window.print()">Print</a>
</div>
<nav class="toc">${toc}</nav>
${body}
<div id="none" class="hidden"><span class="en">Nothing matches that search.</span><span class="sep"> · </span><span class="hi">कुछ नहीं मिला।</span></div>
</div>
<script>
(function () {
  var KEY = 'guideLang';
  function set(l) {
    document.body.className = l === 'en' ? 'only-en' : l === 'hi' ? 'only-hi' : 'both';
    document.querySelectorAll('[data-lang]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-lang') === l); });
    try { localStorage.setItem(KEY, l); } catch (e) {}
  }
  var q = (location.search.match(/[?&]lang=(en|hi|both)/) || [])[1], saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  set(q || saved || 'both');
  document.querySelectorAll('[data-lang]').forEach(function (b) { b.onclick = function () { set(b.getAttribute('data-lang')); }; });
  /* SEARCH: a screen stays if any of its words match; a group with none left is hidden. */
  var box = document.getElementById('q');
  box.addEventListener('input', function () {
    var t = box.value.trim().toLowerCase(), any = false;
    document.querySelectorAll('.sec').forEach(function (s) {
      var hit = !t || s.textContent.toLowerCase().indexOf(t) >= 0;
      s.classList.toggle('hidden', !hit); if (hit) any = true;
    });
    document.querySelectorAll('.grp').forEach(function (g) { g.classList.toggle('hidden', !g.querySelector('.sec:not(.hidden)')); });
    document.querySelector('.toc').classList.toggle('hidden', !!t);
    document.getElementById('none').classList.toggle('hidden', any);
  });
  /* Opened from a screen's Guide button: go to that screen once the page has laid itself out. */
  if (location.hash) addEventListener('load', function () { var el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); });
})();
</script>
</body>
</html>
`;
fs.writeFileSync(OUT, page);
console.log(`written ${OUT} — ${secs.size} section(s)`
  + (missing.length ? `\nNO SECTION YET: ${missing.join(', ')}` : '')
  + (extra.length ? `\nnot in any group (left out): ${extra.join(', ')}` : ''));
