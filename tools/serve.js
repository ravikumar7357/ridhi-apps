/* A tiny local web server for the test build in _site/ — no packages needed.
 *   node tools/serve.js [port]      → http://localhost:8080/
 * It serves only the _site/ folder (built by Replenish-App/tests/build-test-erp.js), where saving is switched off. */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '_site');
const PORT = Number(process.argv[2]) || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };

if (!fs.existsSync(ROOT)) { console.error('No _site/ yet — run tools/check-local.ps1 (button 1) first.'); process.exit(1); }

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('no'); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' }); return res.end(); }
    file = path.join(file, 'index.html');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found: ' + p); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
/* Already running (an earlier button 1 is still open)? That one serves the same _site/ folder, so the new build is
 * already there: say so instead of failing. */
server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`The local test ERP is already running on http://localhost:${PORT}/ and now has this build. Just reload the page.`);
    process.exit(0);
  }
  throw e;
});
server.listen(PORT, () => {
  console.log(`Local test ERP (saving off): http://localhost:${PORT}/`);
  console.log('Press Ctrl+C here to stop it.');
});
