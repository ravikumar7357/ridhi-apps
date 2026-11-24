/* ================= LISTING · DEBUG: ROUND sizes, before / after (22 Nov 2026) — read only =================
 * Console only: window.debugRoundSizes() — the app is one module, so its own names cannot be reached from DevTools.
 * Judges every listing Listing Health holds (both brands) twice with the rules' own healthOf: once with round sizes OFF (the rules as
 * they were — W x H only) and once ON (listing-rules.js hTitleSizes / lrIsRound). Prints and returns:
 *   rules      per rule: listings found before, after, the change
 *   gone       the listings whose "Missing size" went away — each with its title and why it counts as round
 *   changed    every listing whose findings changed, round or not; nonRound = those that are NOT round (should be none)
 * NEVER writes, sends or reads Amazon: Listing Health's snapshot must already be loaded (open Listing Health first). The rules' cached
 * context is rebuilt for each pass and dropped after, so the screens judge again with the rules as they are now. */
// The two ways a title with no size is reported: "Missing size" (title_template), or — in a family whose children name sizes —
// "no size in the title; N sibling(s) name theirs" (variation_value_missing).
const LR_NOSIZE_RE = /Missing size|no size in the title/;
function debugRoundSizes() {
  const say = (title, rows) => { try { console.log(title); if (rows && rows.length) console.table(rows); } catch (e) { /* no console */ } };
  if (typeof H_LOADED === 'undefined' || !H_LOADED || !LR) {
    say('Listing Health is not loaded yet — open Listing Health, wait for it to draw, then run debugRoundSizes() again.');
    return null;
  }
  const rows = ['SP', 'CPC'].flatMap(b => ((HEALTH[b] && HEALTH[b].rows) || []).map(row => Object.assign({}, row, { brand: b })));
  const judge = on => {
    LR_ROUND_ON = on;
    H_CTX = null;                                   // the cached context counted each family's sizes one way: count them again
    const ctx = hCtx();
    const per = {}, byRow = new Map();
    rows.forEach(row => {
      let found = [];
      try { found = (healthOf(row, ctx).found || []); } catch (e) { found = []; }
      const keys = [];
      found.forEach(f => {
        per[f.detector] = (per[f.detector] || 0) + 1;
        keys.push(f.detector + ': ' + f.detail);
      });
      byRow.set(row.brand + '|' + row.sku, keys);
    });
    return { per, byRow };
  };
  let before, after;
  try {
    before = judge(false);
    after = judge(true);
  } finally {
    LR_ROUND_ON = true;
    H_CTX = null;
  }
  const rules = [...new Set([...Object.keys(before.per), ...Object.keys(after.per)])].sort()
    .map(d => ({ rule: d, before: before.per[d] || 0, after: after.per[d] || 0, change: (after.per[d] || 0) - (before.per[d] || 0) }));
  const ctx = hCtx();
  const why = row => {
    const t = hTitleText(row);
    if (/\bround\b/i.test(t)) return 'title says Round';
    const m = typeof lmGet === 'function' ? lmGet(row.sku, row.brand) : null;
    const v = m && m.va && m.va.item_shape;
    if (/round/i.test(String(Array.isArray(v) ? (v[0] || {}).value : v || ''))) return 'Amazon item_shape Round';
    const cat = (LR_CAT[row.brand] || {})[row.sku] || {};
    return /round/i.test(String(cat.subcat || '')) ? 'sub-category ' + cat.subcat : '';
  };
  const changed = [], gone = [];
  rows.forEach(row => {
    const key = row.brand + '|' + row.sku;
    const a = before.byRow.get(key) || [], b = after.byRow.get(key) || [];
    if (a.join('\n') === b.join('\n')) return;
    const fresh = lrFresh(row, ctx);
    const round = lrIsRound(fresh);
    const entry = { brand: row.brand === 'SP' ? 'Ridhi' : row.brand, sku: row.sku, round: round ? why(fresh) || 'round' : 'NOT round', title: hTitleText(fresh),
      before: a.filter(x => !b.includes(x)).join(' | '), after: b.filter(x => !a.includes(x)).join(' | ') };
    changed.push(entry);
    if (a.some(x => LR_NOSIZE_RE.test(x)) && !b.some(x => LR_NOSIZE_RE.test(x))) gone.push(entry);
  });
  const nonRound = changed.filter(c => c.round === 'NOT round');
  const missing = m => [...m.byRow.values()].filter(keys => keys.some(x => LR_NOSIZE_RE.test(x))).length;
  say(`Listings judged: ${rows.length}. No size found ("Missing size" / "no size in the title"): ${missing(before)} before → ${missing(after)} after.`);
  say('Per rule, before → after', rules.filter(r => r.change));
  say(`No size found → size found on ${gone.length} listing${gone.length === 1 ? '' : 's'}`, gone);
  say(`Findings changed on ${changed.length} listing${changed.length === 1 ? '' : 's'} — ${nonRound.length} of them NOT round (should be 0)`, changed);
  return { judged: rows.length, missingBefore: missing(before), missingAfter: missing(after), rules, gone, changed, nonRound };
}
try { window.debugRoundSizes = debugRoundSizes; } catch (e) { /* no window (tests) */ }
