/* ================= LISTING · DEBUG: Title Fix and the product name, before / after (22 Nov 2026) — read only =================
 * Console only: window.debugTitleFix() — the app is one module, so its own names cannot be reached from DevTools.
 * Works out every listing's title suggestion (listing-rules.js lrTitleFix, at Fix all titles' length) twice: as before 22 Nov
 * (LR_TF_GUARD off — the suggestion-words rule alone, which could cut a product name it did not know, e.g. "Tissue Box Cover") and now
 * (the product's own name protected, material first, nothing protected lost — else "Can't fit: needs a manual title"). Prints / returns:
 *   dropped   the suggestions that lost a product name before (brand, SKU, family, the title, the old suggestion, what it lost, now)
 *   families  how many families those are in
 *   prefix    the listings whose SKU starts with opts.prefix (default "RTBX"): before → the old suggestion → the new one
 * NEVER writes, sends or reads Amazon: Listing Health's snapshot must already be loaded (open Listing Health first).
 * Usage: debugTitleFix()  ·  debugTitleFix({ prefix: 'RTCR' }) */
function debugTitleFix(opts) {
  opts = opts || {};
  const say = (title, rows) => { try { console.log(title); if (rows && rows.length) console.table(rows); } catch (e) { /* no console */ } };
  if (typeof H_LOADED === 'undefined' || !H_LOADED || !LR) {
    say('Listing Health is not loaded yet — open Listing Health, wait for it to draw, then run debugTitleFix() again.');
    return null;
  }
  const prefix = String(opts.prefix == null ? 'RTBX' : opts.prefix).toUpperCase();
  const rows = ['SP', 'CPC'].flatMap(b => ((HEALTH[b] && HEALTH[b].rows) || []).map(row => Object.assign({}, row, { brand: b })));
  const ctx = hCtx();
  const max = typeof ttLimits === 'function' ? ttLimits(ctx.cfg).max : 75;
  const run = on => {
    LR_TF_GUARD = on;
    const out = new Map();
    rows.forEach(row => {
      try {
        const fresh = lrFresh(row, ctx);
        out.set(row.brand + '|' + row.sku, { fresh, fx: lrTitleFix(fresh, ctx, { max }) });
      } catch (e) { /* that listing is skipped */ }
    });
    return out;
  };
  let before, after;
  try { before = run(false); after = run(true); } finally { LR_TF_GUARD = true; }
  const nowOf = key => { const n = after.get(key); return !n ? '' : n.fx.held ? n.fx.held : n.fx.after === n.fx.before ? '(no change)' : n.fx.after; };
  const dropped = [];
  before.forEach(({ fresh, fx }, key) => {
    if (fx.held || fx.after === fx.before) return;                    // never offered: nothing it could have sent
    const f = lrSwFacts(fresh, ctx.cfg, null, { title: fx.before });
    const lost = lrTitleLost(fx.before, fx.after, fresh, ctx.cfg, f, fx.fixes).filter(l => /product name/.test(l));
    if (!lost.length) return;
    dropped.push({ brand: fresh.brand === 'SP' ? 'Ridhi' : fresh.brand, sku: fresh.sku, family: fresh.parent || '', title: fx.before,
      before: fx.after, lost: lost.join(', '), now: nowOf(key) });
  });
  const families = new Set(dropped.map(d => d.brand + '|' + d.family)).size;
  const pre = prefix ? [...after.keys()].filter(k => k.split('|')[1].toUpperCase().startsWith(prefix)).map(k => {
    const a = after.get(k), b = before.get(k);
    return { sku: a.fresh.sku, title: a.fx.before, before: b ? (b.fx.held || (b.fx.after === b.fx.before ? '(no change)' : b.fx.after)) : '', now: nowOf(k),
      chars: a.fx.held ? '' : a.fx.after.length };
  }) : [];
  say(`Listings judged: ${rows.length} (length ${max}). Suggestions that DROPPED a product name before the fix: ${dropped.length}, in ${families} famil${families === 1 ? 'y' : 'ies'}.`, dropped);
  if (prefix) say(`${prefix}…: ${pre.length} listing${pre.length === 1 ? '' : 's'} — the suggestion before → now`, pre);
  return { judged: rows.length, max, dropped, families, prefix: pre };
}
try { window.debugTitleFix = debugTitleFix; } catch (e) { /* no window (tests) */ }
