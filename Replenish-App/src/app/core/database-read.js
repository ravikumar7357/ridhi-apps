
/* A failed read and an empty node look identical if the error is swallowed, and only one of them is
 * something anyone can act on. So: a real timeout, one retry, and the reason kept and shown. */
async function ptGet(node, raw) {
  /* JOB WORK IS READ AS ONE REGISTER (core/job-work-split.js): its completed entries live apart, and one entry's own
   * path is sent to where it is. raw = this exact path, nothing joined (used by that file itself). */
  if (!raw && BASE.on) {
    if (node === BASE_NODE) return baseReadAll();
    const rt = baseRoutePath(node);
    if (rt) node = rt.path;
  }
  if (ptLiveable(node)) {
    try { const v = await ptLiveRead(node); if (v !== PT_LIVE_NO) { try { if (typeof dmCount === 'function') dmCount(node, 0, 'from-copy'); } catch (e2) { console.warn('[data meter]', e2); } return v; } } catch (e) { /* the plain read below */ }
  }
  /* The token goes on the READ as well as the write. Where the data sits now, nothing is readable
   * without one — the rules are "signed in, and not a vendor", and a vendor is refused at the root
   * and granted only their own branch. */
  const url = `${PT_URL}/${ptPath(node)}.json` + await ptAuthQuery();
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (r.status === 401 || r.status === 403)
        throw new Error('The production database refused the read (permission denied). Sign out and '
          + 'sign in again; if it keeps happening, this account is not allowed to read production data.');
      if (!r.ok) throw new Error(`The production database answered ${r.status} ${r.statusText || ''}`.trim());
      return await (typeof dmJson === 'function' ? dmJson(r, node, 'plain') : r.json());
    } catch (e) {
      clearTimeout(t);
      lastErr = (e && e.name === 'AbortError')
        ? new Error('The production database did not answer within 45 seconds.')
        : e;
      /* "Failed to fetch" is the network, not the database — give it a moment before the one retry (2026-10-06). */
      if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue; }
    }
  }
  throw lastErr || new Error('Could not read the production database.');
}

/** RTDB hands back an object keyed by record id (or an array). Either way we want a plain list. */
function ptList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(v => v != null);
  return Object.keys(raw).map(k => {
    const v = raw[k];
    return (v && typeof v === 'object' && !Array.isArray(v)) ? Object.assign({ _key: k }, v) : { _key: k, value: v };
  });
}

/* Dates arrive as "26/08/2026, 15:20" — day first. Date.parse reads that as MONTH first wherever it
 * parses it at all, which silently reorders the register and quietly breaks every date filter.
 * Parsed by hand. */
function ptDtMs(s) {
  if (!s) return 0;
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)).getTime();
  const d = new Date(String(s));
  return isNaN(d) ? 0 : d.getTime();
}
const ptDate = s => { const ms = ptDtMs(s); return ms ? new Date(ms) : null; };
/**
 * Is this record's date inside the two boxes? Either box may be empty, and an empty one is no limit.
 *
 * A row whose date cannot be read is OUT once a limit is set and IN when none is — the same rule the
 * six screens that already have a range use. Dropping an undated row from an unfiltered list would
 * hide it for no reason; keeping it in a filtered one would answer a question about a date with a
 * row that has none.
 */
function ptInRange(when, d1, d2) {
  if (!d1 && !d2) return true;
  const d = ptDate(when);
  if (!d) return false;
  if (d1 && d < new Date(d1 + 'T00:00:00')) return false;
  if (d2 && d > new Date(d2 + 'T23:59:59')) return false;
  return true;
}
/** The two boxes of a screen, read together. Missing boxes read as empty, which is no limit. */
const ptRangeOf = (a, b) => [(($(a) || {}).value || ''), (($(b) || {}).value || '')];
const ptNum = v => { const n = Number(v); return isFinite(n) ? n : 0; };
const ptCi = (a, b) => String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();

/** Fill a <select> with the values still reachable, keeping the current pick if it survives. */
function ptFill(id, values, allLabel) {
  const sel = $(id); if (!sel) return;
  const cur = sel.value;
  const seen = new Set();
  values.forEach(v => { const s = String(v == null ? '' : v).trim(); if (s) seen.add(s); });
  sel.innerHTML = `<option value="">${esc(allLabel)}</option>`
    + [...seen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  sel.value = cur;
  if (sel.value !== cur) sel.value = '';     // the old pick is no longer reachable
}

function ptDownload(name, lines) {
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${name}-${dToday()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

function ptStamp() { return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }

/* Shared shape for all three: load once on first open, then only on Refresh. */
async function ptLoad(which, node, after) {
  if (PT.busy[which]) return;
  PT.busy[which] = true; PT.err[which] = '';
  after();
  try {
    PT[which] = ptList(await ptGet(node));
    PT.at[which] = ptStamp();
  } catch (e) {
    PT.err[which] = e.message || String(e);
    PT[which] = PT[which] || [];
  }
  PT.busy[which] = false;
  after();
}

/** A REFRESH BUTTON THAT SHOWS IT IS WORKING (18 Nov 2026). Staff pressed F5 15-20 times a day on the busy screens:
 *  a Refresh looked as if nothing happened, or missed what another PC had saved, and every F5 downloads the whole
 *  page again (30-40 MB). Now the button says "Refreshing…" and stays off until the screen has its fresh data (read
 *  from the live copies, so nothing is downloaded again). Errors: the screen's own work shows what it could not read;
 *  anything else goes to the console, and the button always comes back, so the screen is never left stuck. */
async function ptRefreshButton(btn, work) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Refreshing…';
  ptBusy(+1);
  try { await work(); }
  catch (e) { console.warn('[refresh] ' + (btn.id || 'button') + ':', e); }
  finally { btn.disabled = false; btn.textContent = label; ptBusy(-1); }
}

/** THE BLOCK-PRINTING LOADING PICTURE (Ravi, 26 Nov 2026: "whenever the data is loading when refreshed"). A wooden
 *  block printing a five-colour flower shows on a browser refresh (#gateWait), in a table that is still reading, and
 *  over the screen while a Refresh button works. The picture is public/loading-print.svg (made by
 *  tools/loading-print/make.js); it is only a picture, so if it cannot load, the words beside it still say what is
 *  happening. */
const PT_LOADING_ART = '/loading-print.svg';
function ptLoadingArt(words) {
  return `<div class="ptLoading"><img src="${PT_LOADING_ART}" alt="" width="105" height="107"><span>${words}</span></div>`;
}

/** The cover shown while Refresh buttons work. A count, not an on/off: two screens refreshing at once must not
 *  lift the cover when the first one finishes. */
let ptBusyCount = 0;
function ptBusy(change) {
  ptBusyCount = Math.max(0, ptBusyCount + change);
  document.body.classList.toggle('ptBusy', ptBusyCount > 0);
}

/** A message ending in "…" ("Loading…", "Reading…") means the table is still reading, so it shows the block
 *  printing; any other message ("Nothing to show.") stays plain words. */
function ptEmpty(tableId, msg) {
  const words = String(msg);
  const cell = words.endsWith('…') ? ptLoadingArt(words) : words;
  $(tableId).innerHTML = `<tbody><tr><td class="muted" style="padding:14px;text-align:left">${cell}</td></tr></tbody>`;
}

