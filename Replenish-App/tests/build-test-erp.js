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
    l.textContent = 'TEST ERP \\u00b7 live data, saving off \\u00b7 ' + window.__TEST_ERP.branch + ' @ ' + window.__TEST_ERP.sha;
    document.body.appendChild(l);
    if (document.title.indexOf('TEST') !== 0) document.title = 'TEST \\u00b7 ' + document.title;
  });
})();
</script>`;

/** Replace exactly `count` occurrences of `find` (string or regex) — or stop the build. */
function must(text, find, repl, count, label) {
  let n = 0;
  const out = text.replace(find instanceof RegExp ? find : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (...m) => { n++; return typeof repl === 'function' ? repl(...m) : repl; });
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
  fs.writeFileSync(path.join(dst, 'index.html'), html);
  /* the install manifest: relative to the test folder */
  const mf = JSON.parse(fs.readFileSync(path.join(src, 'manifest.webmanifest'), 'utf8'));
  mf.name = 'TEST ' + mf.name; mf.short_name = 'TEST ' + mf.short_name; mf.start_url = './?source=app'; mf.scope = './';
  mf.icons = (mf.icons || []).map(i => Object.assign({}, i, { src: String(i.src).replace(/^\//, '') }));
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
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Ridhi TEST ERP</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#15171a;display:grid;place-items:center;min-height:100vh;padding:16px}
main{max-width:520px;width:100%;display:grid;gap:14px}h1{margin:0;font-size:28px}.tag{display:inline-block;background:#b45309;color:#fff;font-weight:700;font-size:12px;padding:3px 8px;border-radius:6px}
a.card{display:block;background:#fff;border:1px solid #e2e4e8;border-radius:12px;padding:16px 18px;text-decoration:none;color:inherit}a.card:hover{border-color:#2b3a8c}
a.card b{display:block;font-size:18px}small,p{color:#5d636b}@media(prefers-color-scheme:dark){body{background:#111214;color:#e9eaec}a.card{background:#18191c;border-color:#2a2c30}small,p{color:#a0a4ab}}</style></head>
<body><main><span class="tag">TEST ERP</span><h1>Ridhi test ERP</h1>
<p>The same apps as the real ERP, built from the <b>${BRANCH}</b> branch on GitHub. They show the <b>live data</b>, and <b>saving is switched off</b>, so nothing here can change the real ERP.</p>
<a class="card" href="replenish/"><b>Factory ERP</b><small>Replenishment, production, vendors, stock</small></a>
<a class="card" href="sellora/"><b>Sellora</b><small>Research, sales, listings, advertising</small></a>
<small>Built from commit ${SHA} · ${WHEN}</small></main></body></html>`);

console.log(`test ERP built into _site/ from ${BRANCH} @ ${SHA}: factory ERP + Sellora, saving off.`);
