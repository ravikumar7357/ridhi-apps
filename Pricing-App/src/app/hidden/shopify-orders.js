/* ============ Shopify Orders ============
 *
 * What has to go out of the door, whether Amazon can send it, and where each one stands.
 *
 * Orders are FETCHED, never cached in Firestore: an order's contents and address belong to Shopify
 * and go stale the moment somebody edits them there. Only what this app adds — the status, the note
 * and the shipment details — is stored, keyed by Shopify's order id.
 */
/* Its own escape helper. In the app this came from `esc` is a global; here it is declared inside
 * each render function, so the widget cannot borrow one — and a widget that depends on a name it
 * does not own breaks the moment it is moved. */
const msEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

const MS = {};

function msInit(id, label, opts) {
  MS[id] = { label, opts: opts || [], sel: new Set(), open: false };
  const el = $(id);
  el.innerHTML = '<button type="button" class="ms-btn"></button>'
    + '<div class="ms-panel hide">'
    + '<input class="ms-search" placeholder="Search…">'
    + '<div class="ms-acts"><button type="button" class="ghost ms-all">All</button>'
    + '<button type="button" class="ghost ms-none">None</button></div>'
    + '<div class="ms-list"></div></div>';
  el.querySelector('.ms-btn').onclick = e => { e.stopPropagation(); msToggle(id); };
  el.querySelector('.ms-search').oninput = () => msPaint(id);
  el.querySelector('.ms-all').onclick = () => { MS[id].sel = new Set(); msPaint(id); msChanged(id); };
  el.querySelector('.ms-none').onclick = () => { MS[id].sel = new Set(MS[id].opts); msPaint(id); msChanged(id); };
  // Clicks inside the panel must not reach the document handler that closes it.
  el.querySelector('.ms-panel').onclick = e => e.stopPropagation();
  msPaint(id);
}

function msToggle(id, force) {
  const open = force != null ? force : !MS[id].open;
  // One open at a time — two panels overlapping is unreadable, and closing them by hand is a chore.
  Object.keys(MS).forEach(k => { MS[k].open = false; $(k).querySelector('.ms-panel').classList.add('hide'); });
  MS[id].open = open;
  $(id).querySelector('.ms-panel').classList.toggle('hide', !open);
  if (open) { const q = $(id).querySelector('.ms-search'); q.value = ''; msPaint(id); q.focus(); }
}
document.addEventListener('click', () => Object.keys(MS).forEach(k => {
  if (MS[k].open) { MS[k].open = false; $(k).querySelector('.ms-panel').classList.add('hide'); }
}));

function msPaint(id) {
  const m = MS[id], el = $(id);
  const n = m.sel.size;
  const btn = el.querySelector('.ms-btn');
  // The button says what is chosen, not just "3 selected" — one pick is the common case and its
  // name fits, so read the toolbar and you know what you are looking at.
  btn.textContent = !n ? `All ${m.label}` : n === 1 ? [...m.sel][0] : `${n} of ${m.opts.length} ${m.label}`;
  btn.classList.toggle('on', !!n);
  btn.title = n ? [...m.sel].sort().join(', ') : `All ${m.label}`;
  const q = (el.querySelector('.ms-search').value || '').trim().toLowerCase();
  const list = m.opts.filter(o => !q || o.toLowerCase().includes(q));
  el.querySelector('.ms-list').innerHTML = list.length
    ? list.map(o => '<label class="ms-opt"><input type="checkbox" data-v="' + msEsc(o) + '"'
        + (m.sel.has(o) ? ' checked' : '') + '><span>' + msEsc(o) + '</span></label>').join('')
    : '<div class="muted" style="padding:6px">Nothing matches.</div>';
  el.querySelectorAll('.ms-list input').forEach(cb => {
    cb.onchange = () => { cb.checked ? m.sel.add(cb.dataset.v) : m.sel.delete(cb.dataset.v); msPaint(id); msChanged(id); };
  });
}

function msChanged(id) { if (MS[id].onChange) MS[id].onChange(); }
function msFill(id, vals, label) {
  const m = MS[id];
  m.opts = [...new Set(vals.map(v => (v == null ? '' : String(v).trim())).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  // A value that no longer exists in the data is dropped, so a stale tick cannot silently filter
  // everything away.
  m.sel = new Set([...m.sel].filter(v => m.opts.includes(v)));
  if (label) m.label = label;
  msPaint(id);
}
/** Chosen values. EMPTY MEANS ALL — the caller never has to special-case "nothing ticked". */
const msVals = id => (MS[id] ? [...MS[id].sel] : []);
const msHas = (id, v) => { const m = MS[id]; return !m || !m.sel.size || m.sel.has(String(v || '')); };
function msSet(id, arr) { if (MS[id]) { MS[id].sel = new Set((arr || []).filter(Boolean)); msPaint(id); } }
function msClearAll() { Object.keys(MS).forEach(k => { MS[k].sel = new Set(); msPaint(k); }); }

let SHOP = { orders: [], from: '', to: '', tz: '', at: '' };
/* Declared HERE, with the other Shopify state, and NOT down in the import block where it is filled.
 * `renderShop` and `ensureShop` both read it, and a `let` read before its own line is a
 * ReferenceError that kills the whole module — which is exactly what happened once already with
 * SO_CHANNELS. State that several functions share belongs at the top of the section, not beside the
 * one function that writes it. */
let SHOP_IMP = [], SHOP_IMP_AT = {}, SHOP_IMP_LOADED = false, SO_IMP_STAGED = null;
let SHOP_META = {};          // orderId → { s, note, desc, wt, val, carrier, by, at }
let SHOP_STOCK = {};         // SKU IN UPPER CASE → FBA units available, both brands merged
/* AMAZON'S OWN SPELLING of every code it stocks, keyed by the upper-case form.
 *
 * Amazon SKUs are CASE-SENSITIVE. Matching has to ignore case (Shopify and the sheets disagree about
 * it constantly) but what we SEND back to Amazon, and what we print beside a line, must be spelled
 * the way Amazon spells it — `RCNBmix`, not `RCNBMIX`. Upper-casing everything was quietly changing
 * the identifier in the MCF payload. Ravi spotted it on the screen, 2026-08-25. */
let SHOP_STOCK_CASE = {};
let SHOP_STOCK_LOADED = false;
let SHOP_EDIT = null;
let SHOP_SORT = { k: 'at', dir: -1 };

function soMsg(t, bad) { const m = $('soMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }
/**
 * A shop this screen cannot fetch, asked for anyway.
 *
 * It said so already, in the middle of the grey line that counts the orders — and it was read past.
 * The sentence stays, because that line is where somebody looks to ask "why nothing?"; the bar
 * above carries the same thing with the one thing to press on it, because the answer is not a fact
 * to absorb, it is another app to open.
 */
function soNoKeyNote() {
  const bar = $('soNoKey'), txt = $('soNoKeyTxt');
  const picked = (typeof msVals === 'function' ? msVals('soChan') : []) || [];
  const noApi = picked.filter(c => SO_CHANNELS.indexOf(c) >= 0);
  const have = noApi.length ? SO_ALL_ROWS.filter(r => noApi.indexOf(r.channel) >= 0).length : 0;
  const show = !!noApi.length && !have;
  const many = noApi.length > 1;
  const line = !show ? '' : `${noApi.join(', ')} ${many ? 'are' : 'is'} not fetched here — this app has no API key for `
    + `${many ? 'those shops' : 'that shop'}. Bring ${many ? 'them' : 'it'} in with "Import orders", or open Shopify Orders `
    + 'in the Replenishment app, which is connected to the CPC store.';
  if (bar) {
    bar.classList.toggle('hide', !show);
    if (txt) txt.textContent = line;
    /* The button is only for CPC. The Etsy shops are not in the other app either — for those the
     * answer is Import orders, and a button that went somewhere useless would be worse than none. */
    const go = $('soNoKeyGo');
    if (go) go.style.display = noApi.some(c => /^CPC/i.test(c)) ? '' : 'none';
  }
  return show ? ' · ' + line : '';
}

async function loadShopMeta() {
  try {
    const s = await getDoc(doc(db, 'audit', 'shoporders'));
    SHOP_META = s.exists() ? (s.data().m || {}) : {};
  } catch (e) { /* nothing saved yet, or no read access */ }
}
async function saveShopMeta() {
  await setDoc(doc(db, 'audit', 'shoporders'),
    { m: SHOP_META, n: Object.keys(SHOP_META).length, by: ME.email, saved: serverTimestamp() });
}

/**
 * FBA stock by SKU, both brands in one map.
 *
 * Read from the shared `stock/{brand}` documents the Listing Health pull maintains, so this tab
 * costs nothing to answer "could Amazon ship it" — no report, no waiting. A SKU sold on both
 * accounts keeps the LARGER figure rather than whichever brand was read last.
 */
