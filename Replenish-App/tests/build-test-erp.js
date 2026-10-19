/* THE TEST ERP: the same two apps, built from the same files, served from GitHub Pages — with saving switched off.
 *
 *   node Replenish-App/tests/build-test-erp.js        → _site/  (GitHub Actions publishes it; see .github/workflows/test-erp.yml)
 *
 * It is the code on the dev branch, as it is: Replenish-App/public and Pricing-App/public are copied whole. Nothing in
 * src/ or public/ is edited — only the copy in _site/ is changed, in four ways:
 *
 *   1. A "TEST ERP" label on every screen, with the commit it was built from, so nobody takes it for the real ERP.
 *   2. SAVING IS OFF. The test ERP reads the LIVE data (same Firebase project) so it can be compared screen for screen
 *      with the real ERP — so it must never write. Every way the apps write is stopped before it leaves the browser:
 *        - the factory registers: any request to the Realtime Database that is not a read (PUT/PATCH/POST/DELETE)
 *        - settings and access: the Firestore write functions setDoc / addDoc / deleteDoc
 *        - logins: creating an account, changing a password or PIN, sending a reset mail (identity service)
 *        - the backends: every POST (MCF parcels, Shopify fulfilment, listing changes, PO mail), and the few GET
 *          requests that send mail, start jobs or change triggers
 *      A stopped save shows "Saving is off in the TEST ERP — nothing was saved" and fails, so no screen pretends it saved.
 *   3. Paths that assumed the site's root ("/logo.png") are made relative, because the test ERP lives in a sub-folder.
 *   4. The offline service worker is not installed, so a phone never keeps an old test version.
 *
 * The build stops with an error if any of these cannot be applied exactly — a test ERP that might write is worse than
 * no test ERP. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, '_site');
const SHA = (process.env.GITHUB_SHA || 'local').slice(0, 7);
const BRANCH = process.env.GITHUB_REF_NAME || 'local';
const WHEN = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/* ---- what runs first on every page of the test ERP ---- */
const GUARD = `<script>/* TEST ERP GUARD — added by Replenish-App/tests/build-test-erp.js; not in the real ERP. */
(function () {
  var MSG = 'Saving is off in the TEST ERP \\u2014 nothing was saved.';
  window.__TEST_ERP = { sha: ${JSON.stringify(SHA)}, branch: ${JSON.stringify(BRANCH)}, built: ${JSON.stringify(WHEN)}, blocked: 0 };
  function tell(what) {
    window.__TEST_ERP.blocked++;
    try { console.warn('[TEST ERP] blocked: ' + what); } catch (e) {}
    try {
      var t = document.getElementById('testErpToast');
      if (!t) { t = document.createElement('div'); t.id = 'testErpToast'; document.body.appendChild(t); }
      t.textContent = MSG; t.style.display = 'block';
      clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 4000);
    } catch (e) {}
  }
  window.__testErpBlock = function (what) { tell(what); return Promise.reject(new Error(MSG)); };
  /* Backend GET requests that change something rather than read it. */
  var BACKEND_GET_WRITES = /[?&](notify|shopSkuBuild|adState)=|[?&]repl=(primeSetup|primeStop|primeLiveSetup|primeTest|histbuild)(&|$)/;
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = String((input && input.url) || input || '');
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var write = false, what = '';
    if (/firebasedatabase\\.app|firebaseio\\.com/.test(url) && method !== 'GET' && method !== 'HEAD') { write = true; what = 'database ' + method; }
    else if (/identitytoolkit\\.googleapis\\.com\\/v1\\/accounts:(signUp|update|delete|sendOobCode|setAccountInfo)/.test(url)) { write = true; what = 'login change'; }
    else if (/script\\.google(usercontent)?\\.com/.test(url) && (method !== 'GET' || BACKEND_GET_WRITES.test(url))) { write = true; what = 'backend ' + method; }
    if (write) return window.__testErpBlock(what + ' ' + url.replace(/[?#].*$/, '').slice(0, 120));
    return origFetch.apply(this, arguments);
  };
  var css = '#testErpLabel{position:fixed;left:10px;bottom:10px;z-index:2147483647;background:#b45309;color:#fff;'
    + 'font:600 12px/1.3 system-ui,sans-serif;padding:6px 10px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);pointer-events:none}'
    + '#testErpToast{display:none;position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#7f1d1d;color:#fff;'
    + 'font:600 14px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.3)}';
  document.addEventListener('DOMContentLoaded', function () {
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
    var l = document.createElement('div'); l.id = 'testErpLabel';
    l.textContent = 'R1 \\u00b7 test ERP \\u00b7 live data, saving off \\u00b7 ' + window.__TEST_ERP.branch + ' @ ' + window.__TEST_ERP.sha;
    document.body.appendChild(l);
  });
})();
</script>`;

/* ---- R1, the test ERP's mark ---- */
const R1_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#14161a"/>
<text x="32" y="43" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="30" font-weight="700" fill="#ffffff">R1</text>
<rect x="14" y="51" width="36" height="4" rx="2" fill="#d97706"/></svg>`;
const R1_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 228" width="560" height="228">
<text x="280" y="150" text-anchor="middle" font-family="Georgia,'Times New Roman',serif" font-size="150" letter-spacing="14" fill="#14161a">R1</text>
<text x="280" y="204" text-anchor="middle" font-family="'Segoe UI',Arial,sans-serif" font-size="26" font-weight="600" letter-spacing="12" fill="#b45309">TEST ERP</text></svg>`;

/** Replace exactly `count` occurrences of `find` (string or regex) — or stop the build. */
function must(text, find, repl, count, label) {
  let n = 0;
  /* A string replacement keeps its $1, $2 … meaning (a callback would otherwise insert them literally). */
  const out = text.replace(find instanceof RegExp ? find : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (...m) => {
    n++;
    return typeof repl === 'function' ? repl(...m) : repl.replace(/\$(\d)/g, (_, i) => (m[Number(i)] == null ? '' : m[Number(i)]));
  });
  if (count != null && n !== count) throw new Error(`${label}: expected ${count} change(s), made ${n}. The source changed — update build-test-erp.js before publishing.`);
  return out;
}

/** The Firestore import: setDoc / addDoc / deleteDoc are renamed, and the names the app uses now refuse. */
function blockFirestoreWrites(html, label) {
  const WRITES = ['setDoc', 'addDoc', 'deleteDoc', 'updateDoc', 'writeBatch', 'runTransaction'];
  return must(html, /import\s*\{([^}]*)\}\s*from\s*"(https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+\/firebase-firestore\.js)";/g, (all, names, url) => {
    const list = names.split(',').map(s => s.trim()).filter(Boolean);
    const blocked = list.filter(n => WRITES.includes(n));
    const kept = list.map(n => (WRITES.includes(n) ? `${n} as __real_${n}` : n));
    const stubs = blocked.map(n => `const ${n} = (...a) => window.__testErpBlock('Firestore ${n}');`).join('\n');
    return `import { ${kept.join(', ')} }\n  from "${url}";\n/* TEST ERP: Firestore writes are refused (build-test-erp.js). */\n${stubs}`;
  }, 1, label + ' Firestore import');
}

/* The guard goes just before the page's first <title>, which is the real top of the page in both apps (the factory
 * ERP has no <head> tag of its own, and a "<head>" further down is text inside the code). It must be the first
 * script that runs, and it must never land inside a script. */
function guardPage(html, label) {
  const at = html.search(/<title[\s>]/i);
  if (at < 0 || at > 20000) throw new Error(`${label}: no <title> near the top of the page — the guard has nowhere safe to go.`);
  if (/<script\b/i.test(html.slice(0, at))) throw new Error(`${label}: a script runs before <title>; the guard must run first.`);
  return html.slice(0, at) + GUARD + '\n' + html.slice(at);
}

function copyDir(from, to, skip) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    if (f.startsWith('.') || (skip && skip.includes(f))) continue;
    const a = path.join(from, f), b = path.join(to, f);
    fs.statSync(a).isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}

/* ---- build ---- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

/* The factory ERP */
{
  const src = path.join(ROOT, 'Replenish-App', 'public'), dst = path.join(OUT, 'replenish');
  copyDir(src, dst, ['index.html']);
  let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  html = guardPage(html, 'factory ERP');
  html = blockFirestoreWrites(html, 'factory ERP');
  ['logo.png', 'manifest.webmanifest', 'apple-touch-icon.png', 'wordmark.png'].forEach(f => {
    html = must(html, new RegExp(`(href|src)="/${f.replace('.', '\\.')}"`, 'g'), `$1="${f}"`, null, 'factory ERP ' + f);
  });
  html = must(html, "navigator.serviceWorker.register('/sw.js')", 'Promise.resolve()', 1, 'factory ERP service worker');
  html = must(html, "fetch('/', { method: 'HEAD'", "fetch('./', { method: 'HEAD'", 1, 'factory ERP version check');
  /* R1: the test ERP's own name and mark, so nobody mistakes it for the real one. Screens only: documents (POs,
   * challans) keep the company name, which is what a vendor must see. */
  html = must(html, '<title>Ridhi Home &amp; Living</title>', '<title>R1</title>', 1, 'factory ERP title');
  html = must(html, '<link rel="icon" href="logo.png">', '<link rel="icon" href="r1-icon.svg" type="image/svg+xml">', 1, 'factory ERP tab icon');
  html = must(html, '<link rel="apple-touch-icon" href="apple-touch-icon.png">', '<link rel="apple-touch-icon" href="r1-icon.svg">', 1, 'factory ERP phone icon');
  html = must(html, 'src="wordmark.png" alt="Ridhi Home &amp; Living"', 'src="r1-logo.svg" alt="R1 test ERP"', 1, 'factory ERP sign-in logo');
  html = must(html, '<span class="brandname">Ridhi<span class="brandsub">Home &amp; Living</span></span>',
    '<span class="brandname">R1<span class="brandsub">Test ERP</span></span>', 1, 'factory ERP header name');
  html = must(html, "+ 'Ridhi Home & Living'; } catch (e) { /* nothing depends on it */ }",
    "+ 'R1'; } catch (e) { /* nothing depends on it */ }", 1, 'factory ERP tab name');
  fs.writeFileSync(path.join(dst, 'index.html'), html);
  fs.writeFileSync(path.join(dst, 'r1-icon.svg'), R1_ICON);
  fs.writeFileSync(path.join(dst, 'r1-logo.svg'), R1_LOGO);
  /* the install manifest: relative to the test folder */
  const mf = JSON.parse(fs.readFileSync(path.join(src, 'manifest.webmanifest'), 'utf8'));
  mf.name = 'R1 test ERP'; mf.short_name = 'R1'; mf.start_url = './?source=app'; mf.scope = './';
  mf.icons = [{ src: 'r1-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }];
  fs.writeFileSync(path.join(dst, 'manifest.webmanifest'), JSON.stringify(mf, null, 2));
}

/* Sellora */
{
  const src = path.join(ROOT, 'Pricing-App', 'public'), dst = path.join(OUT, 'sellora');
  copyDir(src, dst, ['index.html']);
  let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  html = guardPage(html, 'Sellora');
  html = blockFirestoreWrites(html, 'Sellora');
  html = must(html, /(href|src)="\/logo\.png"/g, '$1="logo.png"', null, 'Sellora logo');
  html = must(html, "fetch('/', { method: 'HEAD'", "fetch('./', { method: 'HEAD'", 1, 'Sellora version check');
  fs.writeFileSync(path.join(dst, 'index.html'), html);
}

/* The front page of the test ERP */
fs.writeFileSync(path.join(OUT, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>R1 · test ERP</title>
<link rel="icon" href="replenish/r1-icon.svg" type="image/svg+xml">
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#15171a;display:grid;place-items:center;min-height:100vh;padding:16px}
main{max-width:520px;width:100%;display:grid;gap:14px}h1{margin:0;font-size:28px}.tag{display:inline-block;background:#b45309;color:#fff;font-weight:700;font-size:12px;padding:3px 8px;border-radius:6px}
a.card{display:block;background:#fff;border:1px solid #e2e4e8;border-radius:12px;padding:16px 18px;text-decoration:none;color:inherit}a.card:hover{border-color:#2b3a8c}
a.card b{display:block;font-size:18px}small,p{color:#5d636b}@media(prefers-color-scheme:dark){body{background:#111214;color:#e9eaec}a.card{background:#18191c;border-color:#2a2c30}small,p{color:#a0a4ab}}</style></head>
<body><main><img src="replenish/r1-logo.svg" alt="R1" width="200" style="justify-self:start"><span class="tag">TEST ERP</span><h1>R1 · the test ERP</h1>
<p>The same apps as the real ERP, built from the <b>${BRANCH}</b> branch on GitHub. They show the <b>live data</b>, and <b>saving is switched off</b>, so nothing here can change the real ERP.</p>
<a class="card" href="replenish/"><b>Factory ERP</b><small>Replenishment, production, vendors, stock</small></a>
<a class="card" href="sellora/"><b>Sellora</b><small>Research, sales, listings, advertising</small></a>
<small>Built from commit ${SHA} · ${WHEN}</small></main></body></html>`);

console.log(`test ERP built into _site/ from ${BRANCH} @ ${SHA}: factory ERP + Sellora, saving off.`);
