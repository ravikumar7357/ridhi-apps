/* ================= LISTING · DEBUG: ERROR 90244 ("We can't accept the Ounce you entered for Unit Count") — read only (22 Nov 2026) =================
 * Console only: window.debug90244() — the app is one module, so its own names (IML, LH, baCall…) cannot be reached from DevTools.
 * Does, and prints as tables (also returns the same object):
 *   1. every listing of both brands whose Amazon issues include ERROR 90244 (Image Manager's list, IML — the list Listing Errors reads)
 *   2. every Listing History row that changed unit_count (any screen, any SKU)
 *   3. Listing History for the SKUs asked (default RTC14 and RTC75-6060)
 *   4. the backend's own send log for those SKUs (?lfix=history — the attribute paths each send carried)
 *   5. Amazon's current unit_count for those SKUs, as THIS seller submitted it (?lfix=get — a read of the listing)
 * NEVER writes: no Firestore write, no send, no patch. Step 5 is a READ from Amazon; debug90244({ amazon: false }) skips it.
 * Usage: debug90244()  ·  debug90244({ skus: ['RTC14'], brand: 'SP' })  ·  debug90244({ amazon: false }) */
async function debug90244(opts) {
  opts = opts || {};
  const skus = (opts.skus && opts.skus.length ? opts.skus : ['RTC14', 'RTC75-6060']).map(s => String(s).trim()).filter(Boolean);
  const brand = opts.brand || 'SP';
  const out = { errors: [], unitCountSends: [], history: {}, sendLog: {}, amazon: {}, problems: [] };
  const say = (title, rows) => { try { console.log(title); if (rows && rows.length) console.table(rows); } catch (e) { /* no console */ } };
  const step = async (name, fn) => { try { await fn(); } catch (e) { out.problems.push(name + ': ' + String((e && e.message) || e)); } };
  const when = at => { try { return new Date(at).toISOString().replace('T', ' ').slice(0, 16); } catch (e) { return String(at || ''); } };

  // 1. listings with ERROR 90244 — Image Manager's saved list (the shared listing cache first), never the Amazon read
  await step('listings with 90244', async () => {
    for (const b of ['SP', 'CPC']) if (!IML[b]) await imListLoad(b);
    ['SP', 'CPC'].forEach(b => ((IML[b] && IML[b].items) || []).forEach(it => (it.iss || []).forEach(i => {
      if (String(i.c) === '90244') out.errors.push({ brand: b, sku: it.sku, asin: it.asin || '', parent: it.psku || '', severity: i.s, message: i.m, attrs: (i.a || []).join(',') });
    })));
    say(`1. ${out.errors.length} listing${out.errors.length === 1 ? '' : 's'} with ERROR 90244` + (IML.SP && IML.SP.at ? ` (list as at ${IML.SP.at})` : ''), out.errors);
  });

  // 2–3. Listing History (Firestore /history listing_* documents — the same read the Listing History screen makes)
  await step('Listing History', async () => {
    if (!Array.isArray(LH.rows) || LH.loading) await lhLoad(true);
    const rows = LH.rows || [];
    const row = r => ({ at: when(r.at), sku: r.sku, brand: r.brand, screen: r.screen, field: r.field, attr: r.attr, old: r.old, new: r.new, result: r.result, by: r.name || '' });
    out.unitCountSends = rows.filter(r => /unit_count/i.test(r.attr || '') || /unit count/i.test(r.field || '')).map(row);
    say(`2. ${out.unitCountSends.length} Listing History row${out.unitCountSends.length === 1 ? '' : 's'} that changed unit_count (of ${rows.length} read)`, out.unitCountSends);
    skus.forEach(sku => {
      out.history[sku] = rows.filter(r => String(r.sku) === sku).map(row);
      say(`3. Listing History for ${sku}: ${out.history[sku].length} row${out.history[sku].length === 1 ? '' : 's'}`, out.history[sku]);
    });
  });

  // 4. the backend's own send log (Script Properties LFIX_LOG, newest 200 sends): which attribute paths each send carried
  for (const sku of skus) {
    await step('send log ' + sku, async () => {
      const r = await baCall({ lfix: 'history', sku });
      out.sendLog[sku] = ((r && r.rows) || []).map(x => ({ at: String(x.at || '').replace('T', ' ').slice(0, 16), by: x.by || '', brand: x.brand || '', paths: (x.paths || []).join(' · '), status: x.status || '', submission: x.submissionId || '' }));
      const uc = out.sendLog[sku].filter(x => /unit_count/.test(x.paths)).length;
      say(`4. Backend send log for ${sku}: ${out.sendLog[sku].length} send${out.sendLog[sku].length === 1 ? '' : 's'}, ${uc} with /attributes/unit_count`, out.sendLog[sku]);
    });
  }

  // 5. Amazon's current unit_count for those SKUs, as this seller submitted it — a READ (getListingsItem), nothing sent
  if (opts.amazon !== false) {
    for (const sku of skus) {
      await step('Amazon read ' + sku, async () => {
        const g = await baCall({ lfix: 'get', brand, sku });
        const at = (g && g.attributes) || {};
        out.amazon[sku] = {
          productType: g.productType || '', asin: g.asin || '',
          unit_count: at.unit_count || null,
          item_package_quantity: at.item_package_quantity || null,
          number_of_items: at.number_of_items || null,
          issues90244: (g.issues || []).filter(i => String(i.code) === '90244').map(i => i.message),
        };
        say(`5. Amazon now, ${sku} (${out.amazon[sku].productType}): unit_count = ${JSON.stringify(out.amazon[sku].unit_count)}`
          + ` · item_package_quantity = ${JSON.stringify(out.amazon[sku].item_package_quantity)} · number_of_items = ${JSON.stringify(out.amazon[sku].number_of_items)}`
          + (out.amazon[sku].issues90244.length ? ` · 90244: ${out.amazon[sku].issues90244.join(' | ')}` : ' · no 90244 on this read'));
      });
    }
  }
  if (out.problems.length) say('Could not read: ' + out.problems.join(' · '));
  return out;
}
try { window.debug90244 = debug90244; } catch (e) { /* no window (tests) */ }
