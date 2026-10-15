/* ================= SHOPIFY RETURNS TEAM — returns & replacements, delivery days, FBA stock by SKU =================
 * Ravi, 15 Oct 2026: "me chahta hu ek team sirf shopify ke return & replacement likh pay or dekh pay and zip code par
 * delivery check kar pay and inventory check kar pay sku wise for fba".
 *
 * One right, 'shopret' (Sellora → Access → Shopify → "Shopify returns team"). It opens the Shopify Orders screen in a
 * narrow form: the title band and the store switch, then three things only — Returns & replacements (returns.js, the
 * same window the Shopify team uses), Delivery days (india-usa-express.js) and FBA stock by SKU, both Amazon accounts and
 * India. The orders table, the Production bucket, export, import and the automatic production sync are not there for it:
 * the orders are still fetched, because a return is raised against one, but nothing is drawn of them and nothing is
 * opened or closed in production from this account.
 * An account that also holds Shopify Orders ('shop'), and an admin, get the full screen as before. */
const SHOP_RET_ONLY = () => !!(typeof ME !== 'undefined' && ME && ME.tabs && ME.tabs.includes('shopret') && !ME.tabs.includes('shop') && !ME.admin);
let SRT = { q: '' };

/** FBA (each Amazon account) and India for the SKUs asked: exact codes when several are typed, else every SKU holding the text. */
function srtStockRows(q) {
  const terms = String(q || '').toUpperCase().split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
  if (!terms.length) return [];
  const all = new Set(Object.keys(SHOP_STOCK || {}).concat(Object.keys((SHOP_STOCK_BY || {}).SP || {}), Object.keys((SHOP_STOCK_BY || {}).CPC || {})));
  let keys;
  if (terms.length > 1) keys = terms;
  else { const t = terms[0], amz = (() => { try { return soAmzKey(t); } catch (e) { return ''; } })();
    keys = [...new Set([t, amz].filter(Boolean).concat([...all].filter(k => k.includes(t)).sort().slice(0, 60)))]; }
  return keys.map(k => {
    let ind = null; try { const i = soIndiaOf(k); ind = i ? Number(i[0]) || 0 : null; } catch (e) { ind = null; }
    return { sku: k, sp: soFbaIn('SP', k), cpc: soFbaIn('CPC', k), india: ind };
  });
}
function renderShopRet() {
  const pane = $('paneShop'), box = $('soRetPanel'); if (!pane || !box) return;
  pane.classList.add('so-ret'); box.classList.remove('hide');
  const n = v => (v == null ? '<span class="muted">—</span>' : nf(v));
  const stockAt = typeof SHOP_STOCK_LOADED !== 'undefined' && SHOP_STOCK_LOADED;
  const rows = srtStockRows(SRT.q);
  const cases = (() => { try { return srAll(); } catch (e) { return []; } })();
  const open = cases.filter(r => r.status !== 'closed').length, toSend = cases.filter(r => r.rep && r.rep.st === 'todo').length;
  box.innerHTML = `<div class="srt-grid">
      <button type="button" class="srt-tile" data-srt="ret"><b>Returns &amp; replacements</b><span>${nf(open)} open${toSend ? ` · <span style="color:var(--bad)">${nf(toSend)} replacement(s) to send</span>` : ''} — see them, add one, move one on</span></button>
      <button type="button" class="srt-tile" data-srt="days"><b>Delivery days by zip code</b><span>How long a parcel from the USA warehouse takes to a zip</span></button>
    </div>
    <div class="srt-stock">
      <div class="srt-h"><b>FBA stock by SKU</b><span class="muted">${stockAt ? 'Amazon stock, both accounts, and India' : 'Reading Amazon stock…'}</span></div>
      <label class="srt-search"><input id="srtQ" type="search" value="${esc(SRT.q)}" placeholder="Type a SKU, or several separated by commas" aria-label="SKU"></label>
      ${SRT.q ? (rows.length ? `<div class="xlwrap" style="margin-top:8px;max-height:52vh"><table class="xl"><thead><tr><th style="text-align:left">SKU</th><th>FBA · Ridhi</th><th>FBA · CPC</th><th>India</th></tr></thead><tbody>${
        rows.map(r => `<tr><td style="text-align:left;font-family:ui-monospace,monospace">${esc(r.sku)}</td><td class="num">${n(r.sp)}</td><td class="num">${n(r.cpc)}</td><td class="num">${n(r.india)}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="muted" style="margin-top:8px">No SKU like that in the Amazon stock.</div>') : ''}
    </div>`;
}
if ($('soRetPanel') && $('soRetPanel').addEventListener) {
  $('soRetPanel').addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-srt]'); if (!t) return;
    if (t.dataset.srt === 'ret' && typeof srOpen === 'function') srOpen();
    if (t.dataset.srt === 'days' && typeof daysOpen === 'function') daysOpen();
  });
  $('soRetPanel').addEventListener('input', e => {
    if (e.target.id !== 'srtQ') return;
    SRT.q = e.target.value; clearTimeout(SRT.t);
    SRT.t = setTimeout(() => { const pos = e.target.selectionStart; renderShopRet(); const q = $('srtQ'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (er) { /* search box */ } } }, 250);
  });
}
