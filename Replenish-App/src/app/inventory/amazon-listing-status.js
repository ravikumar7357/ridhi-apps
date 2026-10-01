/* ================= IS IT LISTED ON AMAZON? =================
 *
 * Ravi: "listing status like listed or not listed … amazon data se check hokr … jese hi entry kre koi
 * sku yadi wo amazon par list ho to listed other wise not listed; if not listed team will get a alert".
 *
 * THE ANSWER COMES FROM AMAZON, never from the SKU name. The source is GET_MERCHANT_LISTINGS_ALL_DATA,
 * the same report Listing Health uses, pulled for both brands through the Price Research backend
 * (?lh=create / ?lh=poll). It lists every listing on the US marketplace, active and inactive.
 *
 * WHY NOT READ THE LISTING HEALTH SNAPSHOT? Two reasons, both real:
 *   · it drops merchant-fulfilled listings and RB* bundles, so absence from it is not proof. An MFN
 *     listing is still a listing, and calling it "not listed" would send the team to list it again;
 *   · it lives in Firestore behind perms.repl, and the store team's accounts are factory-only.
 * So the full report is boiled down to one index in the production database, pt_amzListings, which
 * every factory account can read:
 *   { at, by, brands: { SP: {n}, CPC: {n} }, list: "SKU\tstatus\tchannel\tasin\n…" }
 * One string, not a keyed object: SKUs can contain characters a database key cannot.
 *
 * THREE ANSWERS, and the difference matters:
 *   listed    at least one row for the SKU is Active
 *   inactive  it is on Amazon but not live (out of stock, suppressed, incomplete) — still LISTED
 *   not       Amazon has no row for it at all → this is the one that raises an alert
 *   unknown   there is no index yet. Nothing is alerted on no evidence.
 *
 * WHO REFRESHES IT: any account that can reach the backend (not factory-only). It refreshes by itself
 * when that person opens Finished Goods and the index is more than 24 hours old, and a button does it
 * on demand. The report takes several minutes to build, so a lock (pt_amzListings/refreshing) stops two
 * people ordering it at once.
 *
 * THE ALERT: saving a stock entry for a SKU that is `not` listed writes pt_listingAlerts/<SKU> (once —
 * later entries only update it) and says so on screen. The team sees a red count on Finished Goods in
 * the sidebar and the "Needs listing on Amazon" view. An alert closes itself when a later index shows
 * the SKU listed, or somebody closes it by hand with a note.
 */
let LST = { at: '', map: null, alerts: null, refreshing: null, busy: false, err: '' };
const LST_STALE_MS = 24 * 3600 * 1000;
const lstKey = sku => obUC(sku).replace(/[.#$\[\]\/]/g, '_');

function lstParse(idx) {
  const map = new Map();
  String((idx && idx.list) || '').split('\n').forEach(line => {
    if (!line) return;
    const [s, st, ch, asin] = line.split('\t');
    const k = obUC(s); if (!k) return;
    const e = map.get(k) || { active: false, rows: 0, channels: new Set(), asin: '' };
    e.rows++;
    if (/^active$/i.test(String(st || '').trim())) e.active = true;
    if (ch) e.channels.add(ch);
    if (asin && !e.asin) e.asin = asin;
    map.set(k, e);
  });
  return map;
}

/** What Amazon says about a SKU: { st: 'listed' | 'inactive' | 'not' | 'unknown', asin }. */
function lstOf(sku) {
  if (!LST.map || !LST.map.size) return { st: 'unknown', asin: '' };
  const e = LST.map.get(obUC(sku));
  if (!e) return { st: 'not', asin: '' };
  return { st: e.active ? 'listed' : 'inactive', asin: e.asin };
}
const LST_PILL = { listed: ['pill-ok', 'Listed'], inactive: ['pill-low', 'Listed · inactive'], not: ['pill-out', 'Not listed'], unknown: ['', '—'] };

async function lstLoad() {
  try {
    const [idx, al] = await Promise.all([ptGet('pt_amzListings'), ptGet('pt_listingAlerts')]);
    LST.at = (idx && idx.at) || '';
    LST.refreshing = (idx && idx.refreshing) || null;
    LST.map = lstParse(idx);
    LST.alerts = al && typeof al === 'object' ? al : {};
    LST.err = '';
  } catch (e) { LST.err = e.message || String(e); LST.map = LST.map || new Map(); LST.alerts = LST.alerts || {}; }
  lstBadge();
}

async function lstLoadAlerts() {
  try { const al = await ptGet('pt_listingAlerts'); LST.alerts = al && typeof al === 'object' ? al : {}; } catch (e) { /* the badge waits */ }
  lstBadge();
}

/** Open alerts that Amazon still does not list — the ones somebody has to act on. */
function lstOpen() {
  return Object.values(LST.alerts || {}).filter(a => a && a.status === 'open' && lstOf(a.sku).st !== 'listed' && lstOf(a.sku).st !== 'inactive');
}

function lstBadge() {
  const el = $('fgiLstBadge'); if (!el) return;
  const n = lstOpen().length;
  el.textContent = n ? String(n) : '';
  el.classList.toggle('hide', !n);
}

const lstCanRefresh = () => !spIsVendor() && !!(PRAPI && PRAPI.url);

/**
 * Ask Amazon for the listings of both brands, and write the index.
 * Alerts whose SKU is now on Amazon close in the same write.
 */
async function lstRefresh(say) {
  if (!lstCanRefresh()) return 'This account cannot reach the Amazon backend — ask somebody with Replenishment access to refresh.';
  if (LST.busy) return 'Already refreshing.';
  const tell = t => { if (say) say(t); };
  const now = Date.now();
  const lock = LST.refreshing;
  if (lock && lock.at && now - Date.parse(lock.at) < 20 * 60 * 1000 && lock.by !== ME.email)
    return `${String(lock.by || '').split('@')[0]} started a refresh at ${String(lock.at).slice(11, 16)} — it will land in a few minutes.`;
  LST.busy = true;
  try {
    await ptPatch({ 'pt_amzListings/refreshing': { by: ME.email, at: new Date().toISOString() } });
    const lines = [], brands = {};
    for (const brand of ['SP', 'CPC']) {
      tell(`Asking Amazon for ${brand === 'SP' ? 'Ridhi' : 'CPC'} listings…`);
      const cr = await prGet({ lh: 'create', brand });
      let done = null;
      for (let i = 0; i < 180 && !done; i++) {
        await new Promise(r => setTimeout(r, LST_POLL_MS));
        const p = await prGet({ lh: 'poll', brand, id: cr.reportId });
        if (p.status === 'done') done = p;
        else tell(`${brand === 'SP' ? 'Ridhi' : 'CPC'} listings report is being built by Amazon… ${i + 1}`);
      }
      if (!done) throw new Error(`Amazon did not finish the ${brand} listings report in time.`);
      const rows = done.rows || [];
      /* The backend caps what it returns. A capped list would call real listings "not listed". */
      if ((done.total || rows.length) > rows.length)
        throw new Error(`The ${brand} report has ${done.total} listings but only ${rows.length} came back — refusing to write a partial list.`);
      rows.forEach(r => { if (r && r.sku) lines.push([String(r.sku).replace(/[\t\n]/g, ' '), r.status || '', r.channel || '', r.asin || ''].join('\t')); });
      brands[brand] = { n: rows.length };
    }
    if (!lines.length) throw new Error('Amazon returned no listings at all — the index was left as it was.');
    const at = new Date().toISOString();
    const idx = { at, by: ME.email, brands, list: lines.join('\n') };
    LST.map = lstParse(idx); LST.at = at;
    const updates = { pt_amzListings: Object.assign({}, idx, { refreshing: null }) };
    let closed = 0;
    Object.entries(LST.alerts || {}).forEach(([k, a]) => {
      if (!a || a.status !== 'open') return;
      const st = lstOf(a.sku).st;
      if (st === 'listed' || st === 'inactive') {
        updates['pt_listingAlerts/' + k + '/status'] = 'listed';
        updates['pt_listingAlerts/' + k + '/closedAt'] = at;
        updates['pt_listingAlerts/' + k + '/closedBy'] = 'Amazon listings ' + at.slice(0, 10);
        closed++;
      }
    });
    await ptPatch(updates);
    Object.keys(updates).forEach(p => {
      const m = p.match(/^pt_listingAlerts\/([^/]+)\/(.+)$/);
      if (m && LST.alerts[m[1]]) LST.alerts[m[1]][m[2]] = updates[p];
    });
    LST.refreshing = null;
    lstBadge();
    tell(`Amazon listings refreshed · ${nf(lines.length)} listing(s)` + (closed ? ` · ${nf(closed)} alert(s) closed — those SKUs are on Amazon now` : '') + '.');
    return '';
  } catch (e) {
    try { await ptPatch({ 'pt_amzListings/refreshing': null }); } catch (e2) { /* the lock expires by itself */ }
    return 'Amazon listings not refreshed: ' + (e.message || e);
  } finally { LST.busy = false; }
}
let LST_POLL_MS = 10000;

/** Refresh in the background when the index is missing or a day old, for somebody who can. */
function lstMaybeRefresh() {
  if (!lstCanRefresh() || LST.busy) return;
  const age = LST.at ? Date.now() - Date.parse(LST.at) : Infinity;
  if (age < LST_STALE_MS) return;
  const onFg = () => typeof TAB_NOW === 'undefined' || TAB_NOW === 'fgi';
  lstRefresh(t => { if (onFg() && $('fgView').value === 'alerts') { $('fgMsg').className = 'muted'; $('fgMsg').textContent = t; } })
    .then(why => { if (why && onFg()) { $('fgMsg').className = 'err'; $('fgMsg').textContent = why; } else renderFgi(); });
}

/** After a stock entry is saved: alert if Amazon does not list the SKU. Returns the line to show. */
async function lstAlertFor(sku, type, qty) {
  const s = obUC(sku), a = lstOf(s);
  if (a.st !== 'not') return '';
  const k = lstKey(s), now = new Date().toISOString();
  const cur = (LST.alerts || {})[k];
  const rec = cur && cur.status === 'open'
    ? Object.assign({}, cur, { lastAt: now, lastBy: ME.email, lastType: type, lastQty: qty, entries: (cur.entries || 1) + 1 })
    : { sku: s, status: 'open', firstAt: now, by: ME.email, lastAt: now, lastBy: ME.email, lastType: type, lastQty: qty, entries: 1,
        listingsAt: LST.at || '' };
  try { await ptPut('pt_listingAlerts/' + k, rec); }
  catch (e) { return ` ${s} is NOT listed on Amazon, and the alert could not be saved (${e.message || e}) — tell the listing team.`; }
  LST.alerts = Object.assign({}, LST.alerts || {}, { [k]: rec });
  lstBadge();
  return cur && cur.status === 'open'
    ? ` ${s} is still NOT listed on Amazon — the listing team already has an alert for it.`
    : ` ⚠ ${s} is NOT listed on Amazon — the listing team has been alerted.`;
}

/** Close an alert by hand, with a note. */
async function lstClose(k, note) {
  const a = (LST.alerts || {})[k]; if (!a) return 'That alert is gone.';
  if (!String(note || '').trim()) return 'Say what was done — listed under another SKU, not for Amazon, …';
  const now = new Date().toISOString();
  await ptPatch({ ['pt_listingAlerts/' + k + '/status']: 'closed', ['pt_listingAlerts/' + k + '/closedAt']: now,
    ['pt_listingAlerts/' + k + '/closedBy']: ME.email, ['pt_listingAlerts/' + k + '/note']: String(note).trim() });
  Object.assign(a, { status: 'closed', closedAt: now, closedBy: ME.email, note: String(note).trim() });
  lstBadge();
  return '';
}

function lstRenderAlerts() {
  const q = $('fgQ').value.trim().toLowerCase();
  const all = Object.entries(LST.alerts || {}).map(([k, a]) => Object.assign({ k }, a)).filter(a => a && a.sku);
  const rows = all.filter(a => a.status === 'open')
    .filter(a => { const m = fgiMaster(a.sku); return !q || [a.sku, m.color, m.size, m.articleType, m.subtype].join(' ').toLowerCase().includes(q); })
    .sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')));
  FGI.shown = rows;
  const head = '<thead><tr>' + ['SKU', 'Image', 'Item', 'In stock', 'Amazon now', 'First alerted', 'Last entry', '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 3 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  $('fgTable').innerHTML = head + '<tbody>' + (rows.length ? rows.map(a => {
    const m = fgiMaster(a.sku), st = lstOf(a.sku), [cls, txt] = LST_PILL[st.st];
    return '<tr>'
      + `<td class="frz" style="font-family:ui-monospace,monospace;text-align:left">${esc(a.sku)}</td>`
      + ptImgCell(a.sku)
      + `<td style="text-align:left">${esc([m.subtype || m.articleType, m.color, m.size].filter(Boolean).join(' · ')) || '<span class="muted">not in the master DB</span>'}</td>`
      + `<td class="num" style="font-weight:700">${nf(fgiOf(a.sku).current)}</td>`
      + `<td><span class="pill ${cls}">${txt}</span></td>`
      + `<td style="font-size:12px">${esc(String(a.firstAt || '').slice(0, 10))}<div class="muted" style="font-size:10.5px">${esc(String(a.by || '').split('@')[0])}</div></td>`
      + `<td style="font-size:12px">${esc(String(a.lastAt || '').slice(0, 10))}<div class="muted" style="font-size:10.5px">${esc(String(a.lastType || '').toLowerCase())} ${a.lastQty ? nf(a.lastQty) : ''} · ${nf(a.entries || 1)} entr${(a.entries || 1) === 1 ? 'y' : 'ies'}</div></td>`
      + `<td><button class="ghost" data-lstclose="${esc(a.k)}" style="padding:2px 9px;font-size:12px">Close</button></td>`
      + '</tr>';
  }).join('') : '<tr><td colspan="8" class="muted" style="padding:16px">No SKU is waiting to be listed on Amazon.</td></tr>') + '</tbody>';
  const done = all.filter(a => a.status !== 'open').length;
  $('fgMsg').className = rows.length ? 'err' : 'muted';
  $('fgMsg').textContent = `${nf(rows.length)} SKU(s) had stock entered but are NOT listed on Amazon`
    + (done ? ` · ${nf(done)} alert(s) already closed` : '')
    + (LST.at ? ` · Amazon listings as of ${String(LST.at).slice(0, 16).replace('T', ' ')}` : ' · the Amazon listings have never been fetched')
    + (lstCanRefresh() ? '' : ' · an alert closes by itself once the listings are refreshed and show the SKU');
  ptImgFill(rows.map(a => a.sku), false, ptImgPatch);
}

function lstCloseOpen(k) {
  const a = (LST.alerts || {})[k]; if (!a) return;
  ptOpenDialog({
    title: 'Close the alert for ' + a.sku,
    subtitle: 'Amazon still shows no listing for it',
    note: 'An alert closes by itself when the Amazon listings next show this SKU. Close it by hand only when it will not be '
      + 'listed under this SKU — say why, so the next person knows.',
    fields: [{ key: 'note', label: 'Why', value: '', span: true }],
    onSave: async v => { const why = await lstClose(k, v.note); if (why) return why; renderFgi(); return ''; },
    saveLabel: 'Close it',
  });
}

