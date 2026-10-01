/* ---------- backend call ---------- */
/**
 * A read from the Replenishment backend, asked again when Google answers with a web page instead of
 * the data. Only for reads — `tries` stays 1 for anything that writes.
 */
async function apiGetRetry(params, tries, onRetry, timeoutMs) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await apiGet(params, timeoutMs); }
    catch (e) {
      last = e;
      if (!e || !e.transient || i === tries) break;
      if (onRetry) onRetry(i + 1, tries);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
  throw last;
}

async function apiGet(params, timeoutMs) {
  if (!API || !API.url) throw new Error('Backend not configured (Firestore config/replapi).');
  const u = new URL(API.url);
  u.searchParams.set('key', API.key);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
  const transient = msg => Object.assign(new Error(msg), { transient: true });
  let r, text;
  /* A GOOD ANSWER COMES BACK IN ABOUT 20 SECONDS; a lost one hangs for a minute or more before Google
   * gives up with its Page-not-found page. Waiting it out made every retry cost a minute. */
  const ac = timeoutMs ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try { r = await fetch(u, { redirect: 'follow', signal: ac ? ac.signal : undefined }); text = await r.text(); }
  catch (e) { throw transient(ac && ac.signal.aborted ? `No answer from Google within ${Math.round(timeoutMs / 1000)} seconds.` : 'The connection to the backend dropped before the data arrived.'); }
  finally { if (timer) clearTimeout(timer); }
  let d;
  try { d = JSON.parse(text); }
  catch (e) {
    // Apps Script answers with an HTML PAGE instead of JSON in several situations, and the raw
    // "Unexpected token '<'" that JSON.parse throws says nothing useful. Name what actually happened.
    const t = text.slice(0, 9000);
    /* GOOGLE LOST THE ANSWER. The script finished (its Executions log says Completed) but the
     * hand-back link had already gone, and Google serves Drive's "Page not found" page — whose markup
     * contains the word "error", so this used to read as the script crashing. Asking again works. */
    if (r.status === 404 || /unable to open the file|page not found/i.test(t))
      throw transient('Google lost the answer on the way back (the script finished, but a "Page not found" page came instead of the data).');
    if (/accounts\.google\.com|sign ?in|authoriz/i.test(t))
      throw new Error('Google asked to sign in instead of returning data — the Apps Script deployment has lost its “Anyone, even anonymous” access. Re-deploy the backend and check Deploy → Manage deployments → Who has access.');
    if (/too many times|quota|rate limit|try again later/i.test(t))
      throw new Error('Google is throttling the Apps Script backend (too many calls). Wait a few minutes and hit Refresh again.');
    if (/exception|error/i.test(t))
      throw new Error('The backend script threw an error. Open the Apps Script project → Executions to see it.');
    throw transient(`The backend returned a web page, not data (${text.length.toLocaleString()} bytes, HTTP ${r.status}). This is usually a dropped connection on a big pull.`);
  }
  if (!d.ok) throw Object.assign(new Error(d.error || 'Request failed'), { data: d });
  return d;
}

/* ---- one brand's inventory, in pieces ----
 *
 * The backend used to answer "Refresh from sheet" with the whole brand at once: a minute of work and
 * several MB in one response. Google loses big, slow answers — on 15 Sep it lost every CPC read — and
 * each retry started another minute-long read on top of the last.
 *
 * Now the backend reads the sheet once and keeps the result (repl=meta), and the app collects it a
 * few hundred KB at a time (repl=page). A lost "meta" answer loses no work: asking again finds the read
 * finished, or still running. A lost piece is a two-second request, asked again.
 */
const replSleep = ms => new Promise(r => setTimeout(r, ms));

async function replPull(brand, say) {
  const T0 = Date.now(), LIMIT = 6 * 60 * 1000;
  const secs = () => Math.round((Date.now() - T0) / 1000);
  let fresh = '1', again = false;
  for (;;) {
    let meta = null;
    while (!meta) {
      if (Date.now() - T0 > LIMIT) throw new Error('The sheet read did not finish within 6 minutes. Refresh again in a little while.');
      let d = null;
      try { d = await apiGet({ repl: 'meta', brand, fresh }, 150000); }
      catch (e) {
        if (!e.transient) throw e;
        say(`reading the sheet — Google lost an answer, checking whether the read finished (${secs()} s)…`);
      }
      fresh = '0';                                  // from here on: take the read that is already running
      if (d && !d.building) { meta = d; break; }
      if (d && d.building) say(`reading the sheet (${secs()} s)…`);
      await replSleep(d ? 6000 : 3000);
    }
    try { return await replPieces(brand, meta, say); }
    catch (e) {
      /* The cache let go of the read between "ready" and collecting it. Once, a fresh read; twice is a
       * real problem and is reported. */
      if (e.data && e.data.expired && !again) { again = true; fresh = '1'; continue; }
      throw e;
    }
  }
}

/** Collect a finished read: rows in groups of six pieces, three at a time, then the rest of it. */
async function replPieces(brand, meta, say) {
  const groups = [];
  for (let i = 0; i < meta.rowPieces; i += 6) groups.push([i, Math.min(meta.rowPieces, i + 6)]);
  const got = new Array(groups.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < groups.length) {
      const k = next++;
      const d = await apiGetRetry({ repl: 'page', brand, token: meta.token, kind: 'r', from: groups[k][0], to: groups[k][1] }, 4, null, 60000);
      got[k] = d.rows || [];
      done++;
      say(`collecting the rows (${done} of ${groups.length})…`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const x = await apiGetRetry({ repl: 'page', brand, token: meta.token, kind: 'x', from: 0, to: meta.extraPieces }, 4, null, 60000);
  const rows = [].concat(...got);
  /* A brand with rows missing would look like a complete one with fewer SKUs — refuse it instead. */
  if (rows.length !== meta.n) throw new Error(`Only ${rows.length} of ${meta.n} rows arrived. Refresh again.`);
  return Object.assign(JSON.parse(x.text || '{}'), { rows });
}

/* The Price Research backend. Both the Shopify tab AND India stock come through it: the Shopify
 * connection and the warehouse-workbook access live only in that script, not in this app's own. */
async function prGet(params) {
  if (!PRAPI || !PRAPI.url) {
    throw new Error('No access to the Price Research backend. Its address lives in Firestore '
      + 'config/api, and this account has to be allowed to read it — ask an admin to re-save your access.');
  }
  const u = new URL(PRAPI.url);
  u.searchParams.set('key', PRAPI.key);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
  const r = await fetch(u, { redirect: 'follow' });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); }
  catch (e) { throw new Error(`The Price Research backend returned a web page, not data (HTTP ${r.status}).`); }
  if (!d.ok) throw new Error(d.error || 'Request failed');
  return d;
}

