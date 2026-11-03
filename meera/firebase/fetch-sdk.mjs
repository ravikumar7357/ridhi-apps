/* Google's function library, for the Firebase tool's local read only (Ravi, 2 Nov: approved with conditions).
 *   node meera/firebase/fetch-sdk.mjs <folder>      e.g. C:\AMAZON\meera-deploy\node_modules
 * Downloads EXACTLY the packages and files in sdk-list.json (157 packages, pinned versions, checked 2 Nov: every file the
 * same SHA-256 at jsDelivr and unpkg) from jsDelivr into <folder>, checking each file's SHA-256 against the list; the
 * first file that does not match stops everything and the folder is left incomplete (delete it). Never into the ERP's
 * node_modules, never into the repository (meera/functions/node_modules is a link to <folder>, made for the deploy and
 * removed after; .gitignore keeps it out). Google installs its own copy when it builds the function. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2];
if (!OUT) { console.log('usage: node meera/firebase/fetch-sdk.mjs <folder>'); process.exit(1); }
if (/Replenish-App[\\/]node_modules/i.test(OUT) || path.resolve(OUT).startsWith(path.resolve(HERE, '..', '..'))) { console.log('refused: not into the ERP or the repository'); process.exit(1); }
const list = JSON.parse(readFileSync(path.join(HERE, 'sdk-list.json'), 'utf8'));
let files = 0, bytes = 0;
const skipped = [];
for (const p of list.packages) {
  const [name, version] = [p.pkg.slice(0, p.pkg.lastIndexOf('@')), p.pkg.slice(p.pkg.lastIndexOf('@') + 1)];
  /* a package needed at two versions: the second one goes inside the package that wants it */
  const dir = p.under ? path.join(OUT, p.under, 'node_modules', name) : path.join(OUT, name);
  for (const f of p.files) {
    const to = path.join(dir, f.p);
    if (existsSync(to)) continue;
    let buf = null, refused = false;
    for (let i = 0; i < 3 && !buf && !refused; i++) { try { const r = await fetch(`https://cdn.jsdelivr.net/npm/${name}@${version}${f.p}`); if (r.ok) buf = Buffer.from(await r.arrayBuffer()); else if (r.status === 403) refused = true; } catch (e) { /* again */ } }
    /* jsDelivr will not serve command scripts (.cmd, .sh …): they are benchmark / tool scripts nothing loads — left out, listed */
    if (!buf && refused && /\.(cmd|bat|sh|exe|ps1)$/i.test(f.p)) { skipped.push(p.pkg + f.p); continue; }
    if (!buf) { console.log(`STOP: ${p.pkg}${f.p} could not be downloaded`); process.exit(2); }
    const h = createHash('sha256').update(buf).digest('base64');
    if (h !== f.h) { console.log(`STOP: ${p.pkg}${f.p} does not match its checksum (${h} ≠ ${f.h}) — nothing more is downloaded`); process.exit(3); }
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, buf);
    files++; bytes += buf.length;
  }
}
console.log(`fetched ${files} files (${(bytes / 1048576).toFixed(1)} MB) of ${list.packages.length} packages into ${OUT}; every file matched its checksum`);
if (skipped.length) console.log(`left out (jsDelivr does not serve command scripts; nothing loads them): ${skipped.join(', ')}`);
