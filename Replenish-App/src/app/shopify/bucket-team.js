/* ================= SHOPIFY PRODUCTION BUCKET — the production team's one page =================
 * Ravi, 2 Nov 2026: "production team will see production bucket and they see that only one page and everything should
 * work on that like the existing ERP right now".
 *
 * One right, 'shopbkt' (Sellora → Access → Shopify → "Shopify production bucket"), made the way the returns team's right
 * is (returns-team.js). It opens the Shopify Orders screen in a narrow form: the title band and the store switch, then the
 * Production bucket only — the same bucket the Shopify team opens from its Bucket button (bucket-excel.js shpBucketOpen):
 * Need production · Stock says it can fill · Done · From production (take what was made) · Handed over, Download Excel,
 * Open from pending sheet, Open ticked production lines. Nothing of it is copied: the same code, the same saves.
 * The orders and the stock are still read (the bucket is worked out from them), but the orders table, export, import and
 * the automatic production sync are not there for this account.
 * An account that also holds Shopify Orders ('shop'), and an admin, get the full screen as before. */
let BKT = { opened: false };
/* No menu item of its own any more (Ravi, 2 Nov, later: "remove production bucket and get the bucket ready in our Shopify
 * hub"): the bucket is opened from the Shopify hub's "Production bucket" button (shopify-hub-local.js). This narrow form
 * stays only for an account given the 'shopbkt' right alone. */
const SHOP_BKT_ONLY = () => !!(typeof ME !== 'undefined' && ME && ME.tabs && ME.tabs.includes('shopbkt') && !ME.tabs.includes('shop') && !ME.admin);

function renderShopBkt() {
  const pane = $('paneShop'), box = $('soBktPanel'); if (!pane || !box) return;
  pane.classList.add('so-bkt'); box.classList.remove('hide');
  const stockOk = typeof SHOP_STOCK_LOADED !== 'undefined' && SHOP_STOCK_LOADED && SHOP_INDIA_LOADED && !SHOP_INDIA_ERR;
  let list = []; try { list = stockOk ? shpBucket() : []; } catch (e) { list = []; }
  const nMake = list.filter(x => x.kind === 'make').length, nCov = list.filter(x => x.kind === 'covered').length;
  const nReady = (() => { try { return typeof shpReadyLines === 'function' ? shpReadyLines().length : 0; } catch (e) { return 0; } })();
  const nToday = (() => { try { return typeof shbOpenedToday === 'function' ? shbOpenedToday().length : 0; } catch (e) { return 0; } })();
  const msg = ($('soMsg') && $('soMsg').textContent) || '';
  box.innerHTML = `<div class="srt-grid">
      <button type="button" class="srt-tile" data-bkt="open"><b>Production bucket</b><span>${stockOk
        ? `${nf(nMake)} need production · ${nf(nCov)} stock says it can fill · ${nf(nReady)} made, to take from production · ${nf(nToday)} opened today`
        : 'Reading the Shopify orders and the stock…'} — open it to work through them</span></button>
    </div>
    ${msg ? `<div class="muted" id="bktMsg" style="margin-top:2px">${esc(msg)}</div>` : ''}`;
  /* The bucket opens by itself the first time everything it needs is read — this page is only for it. */
  if (stockOk && !BKT.opened) { BKT.opened = true; shpBucketOpen(); }
}
if ($('soBktPanel') && $('soBktPanel').addEventListener) {
  $('soBktPanel').addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-bkt]'); if (!t) return;
    if (t.dataset.bkt === 'open' && typeof shpBucketOpen === 'function') shpBucketOpen();
  });
  /* The Shopify screen's own messages ("Opened 4 production lines…", "Stock has not been read yet…") sit in a part of the
   * screen this form hides — they are shown under the tile instead. */
  if ($('soMsg') && typeof MutationObserver === 'function') {
    new MutationObserver(() => { if (SHOP_BKT_ONLY()) renderShopBkt(); }).observe($('soMsg'), { childList: true, characterData: true, subtree: true });
  }
}
