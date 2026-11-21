/* ================= LISTING · DEBUG: Title Fix before / after THE REMOVE-ALLOWLIST (22 Nov 2026) — read only =================
 * Console only: window.debugTitleFix() — the app is one module, so its own names cannot be reached from DevTools.
 * Works out every listing's title suggestion (listing-rules.js lrTitleFix, at Fix all titles' length) twice: as before 22 Nov
 * (LR_TF_GUARD off — the suggestion-words rule alone, which could cut any word it did not know, e.g. "Tissue Box Cover") and now (THE
 * REMOVE-ALLOWLIST: only the material, the approved filler, the 74–75 short forms and — last — the shape may go; every other word stays,
 * else "Can't fit: needs a manual title"; the safety check lrTitleMissing blocks anything else). Prints / returns:
 *   changed     every suggestion that changed: the title, the suggestion before → now
 *   blocked     every OLD suggestion the safety check now blocks, with the words it would have lost
 *   nowBlocked  the listings whose suggestion is held now by the safety check, with its reason
 *   unsafe      the NEW suggestions missing a product / brand / colour / size word — must be [] (0)
 *   dropped     the old suggestions that lost a product name (brand, SKU, family, title, the old suggestion, what it lost, now)
 *   families    how many families those are in
 *   prefix      the listings whose SKU starts with opts.prefix (default "RTBX"): the old suggestion → the new one
 * NEVER writes, sends or reads Amazon: Listing Health's snapshot must already be loaded (open Listing Health first).
 * Usage: debugTitleFix()  ·  debugTitleFix({ prefix: 'RTCR' })  ·  debugTitleFix({ prefix: '' }) (no prefix table) */
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
  const brandName = b => (b === 'SP' ? 'Ridhi' : b);
  const offered = fx => !fx.held && fx.after !== fx.before;                    // a suggestion someone could send
  const textOf = n => (!n ? '' : n.fx.held ? n.fx.held : n.fx.after === n.fx.before ? '(no change)' : n.fx.after);
  const nowOf = key => textOf(after.get(key));
  // the safety check as ttCheck runs it: the words a real correction changes (a misspelling, another brand's name) may differ
  const missingOf = (fresh, oldT, newT) => {
    const f = lrSwFacts(fresh, ctx.cfg, null, { title: oldT });
    let allow = [];
    try { allow = lrTitleProblems(fresh, ctx).filter(p => p.from).map(p => p.from); } catch (e) { /* none */ }
    try {
      const risk = typeof ipgKwRisk === 'function' ? ipgKwRisk(fresh.brand, fresh.sku, fresh, ctx.cfg) : null;
      if (risk) allow = allow.concat((risk(oldT) || []).map(sp => oldT.slice(sp.s, sp.e)));
    } catch (e) { /* no IP guard */ }
    return lrTitleMissing(oldT, newT, { names: f.names || [], keep: [f.colour].concat(lrBrandWords(fresh, ctx.cfg)).filter(Boolean), allow });
  };
  const changed = [], blocked = [], nowBlocked = [], unsafe = [], dropped = [];
  after.forEach(({ fresh, fx }, key) => {
    const b = before.get(key);
    const was = b ? textOf(b) : '', now = textOf(after.get(key));
    const base = { brand: brandName(fresh.brand), sku: fresh.sku, family: fresh.parent || '', title: fx.before };
    if (was !== now) changed.push(Object.assign({}, base, { before: was, now, chars: fx.held ? '' : fx.after.length }));
    if (fx.held && fx.held.startsWith(LR_BLOCKED)) nowBlocked.push(Object.assign({}, base, { why: fx.held }));
    if (b && offered(b.fx)) {
      const miss = missingOf(b.fresh, b.fx.before, b.fx.after);
      if (miss.length) blocked.push(Object.assign({}, base, { before: b.fx.after, missing: miss.join(', '), now }));
      const f = lrSwFacts(b.fresh, ctx.cfg, null, { title: b.fx.before });
      const lost = lrTitleLost(b.fx.before, b.fx.after, b.fresh, ctx.cfg, f, b.fx.fixes).filter(l => /product name/.test(l));
      if (lost.length) dropped.push(Object.assign({}, base, { before: b.fx.after, lost: lost.join(', '), now }));
    }
    if (offered(fx)) {                                                         // the NEW suggestion: nothing it may never lose is gone
      const f = lrSwFacts(fresh, ctx.cfg, null, { title: fx.before });
      const lost = lrTitleLost(fx.before, fx.after, fresh, ctx.cfg, f, fx.fixes);
      const miss = missingOf(fresh, fx.before, fx.after);
      if (lost.length || miss.length) unsafe.push(Object.assign({}, base, { now: fx.after, lost: lost.concat(miss.map(w => `"${w}"`)).join(', ') }));
    }
  });
  const families = new Set(dropped.map(d => d.brand + '|' + d.family)).size;
  const pre = prefix ? [...after.keys()].filter(k => k.split('|')[1].toUpperCase().startsWith(prefix)).map(k => {
    const a = after.get(k), b = before.get(k);
    return { sku: a.fresh.sku, title: a.fx.before, before: b ? textOf(b) : '', now: nowOf(k), chars: a.fx.held ? '' : a.fx.after.length };
  }) : [];
  say(`Listings judged: ${rows.length} (length ${max}). Title suggestions that CHANGED with the remove-allowlist: ${changed.length}.`, changed);
  say(`Old suggestions the safety check now BLOCKS (the words they would lose): ${blocked.length}.`, blocked);
  say(`Held now by the safety check: ${nowBlocked.length}.`, nowBlocked);
  say(`New suggestions missing a product / brand / colour / size word: ${unsafe.length}${unsafe.length ? ' — PLEASE REPORT THESE' : ' ✓'}.`, unsafe);
  say(`Old suggestions that DROPPED a product name: ${dropped.length}, in ${families} famil${families === 1 ? 'y' : 'ies'}.`, dropped);
  if (prefix) say(`${prefix}…: ${pre.length} listing${pre.length === 1 ? '' : 's'} — the suggestion before → now`, pre);
  return { judged: rows.length, max, changed, blocked, nowBlocked, unsafe, dropped, families, prefix: pre };
}
try { window.debugTitleFix = debugTitleFix; } catch (e) { /* no window (tests) */ }
