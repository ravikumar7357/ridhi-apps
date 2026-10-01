/* ---- one parent, every child, every check ----
 *
 * Ravi, 2026-09-15: "once I click on a parent ASIN, all its child listings should open — what is wrong
 * in them, what is right, everything." The parent row says HOW MANY children have a problem; this says
 * which ones, and which check each one fails, with the ones it passes shown beside them so a fixed
 * listing visibly reads as fixed.
 *
 * Every check here is healthOf's own rule, read from the same fields — so the dialog and the score can
 * never disagree. The one exception is marked as such: Amazon's 75-character title limit is shown for
 * information (it is what the Title Optimiser works to) and does NOT change the score or the grade.
 */
const H_OPTIMISER_URL = 'https://claude.ai/public/artifacts/9d2c21e6-30b8-4f08-acf1-33113121e621';
const H_TITLE_LIMIT = 75;
let HK_OPEN = null;           // { brand, parent } of the dialog on screen
let HK_SHOW = 'all';          // all | bad | ok

/**
 * Each check for one child: pass true/false, or null when the fact is not known (never checked, or the
 * report left it blank). Unknown is never shown as a failure — that would send somebody after a listing
 * that is fine.
 */
function healthChecks(r) {
  const c = r.content, st = r.status || '';
  const isActive = /active/i.test(st) && !/inactive/i.test(st);
  const fba = /amazon|afn/i.test(r.channel || '');
  const tl = c ? c.titleLen : null;
  return [
    { k: 'active', t: 'Active', pass: /inactive/i.test(st) ? false : (isActive || fba ? true : (st ? false : null)),
      say: st || 'no status' },
    { k: 'stock', t: 'In stock', pass: r.qty == null ? null : r.qty > 0, say: r.qty == null ? 'not known' : r.qty + ' units' },
    { k: 'price', t: 'Price', pass: r.price == null ? null : r.price > 0, say: r.price ? '$' + Number(r.price).toFixed(2) : (r.price === 0 ? 'no price' : 'not known') },
    { k: 'title', t: `Title ${H_RULES.minTitle}–${H_RULES.maxTitle}`, pass: tl == null ? null : tl >= H_RULES.minTitle && tl <= H_RULES.maxTitle,
      say: tl == null ? 'not checked' : tl + ' chars' },
    { k: 't75', t: `Title ≤ ${H_TITLE_LIMIT}`, info: true, pass: tl == null ? null : tl <= H_TITLE_LIMIT,
      say: tl == null ? 'not checked' : (tl > H_TITLE_LIMIT ? `${tl - H_TITLE_LIMIT} over` : 'within') },
    { k: 'bullets', t: `Bullets ${H_RULES.minBullets}+`, pass: c ? c.bullets >= H_RULES.minBullets : null, say: c ? c.bullets + ' bullets' : 'not checked' },
    { k: 'images', t: `Images ${H_RULES.minImages}+`, pass: c ? c.images >= H_RULES.minImages : null, say: c ? c.images + ' images' : 'not checked' },
    { k: 'desc', t: 'Description', pass: c ? c.descLen >= H_RULES.minDesc : null, say: c ? (c.descLen ? c.descLen + ' chars' : 'none') : 'not checked' },
    { k: 'aplus', t: 'A+', pass: r.aplus === true ? true : (r.aplus === false ? false : null), say: r.aplus === true ? 'published' : (r.aplus === false ? 'missing' : 'not checked') },
  ];
}

function healthKidsOpen(brand, parent) {
  HK_OPEN = { brand, parent };
  HK_SHOW = 'all';
  healthKidsRender();
  $('hkModal').classList.remove('hide');
}

function healthKidsRender() {
  if (!HK_OPEN) return;
  const { brand, parent } = HK_OPEN;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const all = ((HEALTH[brand] && HEALTH[brand].rows) || [])
    .filter(r => (r.parent || r.asin || r.sku) === parent)
    .map(r => { const h = healthOf(r); return Object.assign({}, r, { _h: h, score: h.score, grade: h.grade, _c: healthChecks(r) }); })
    .sort((a, b) => a.score - b.score || String(a.sku).localeCompare(String(b.sku)));
  const bad = r => r._h.blocking.length || r._h.content.length;
  const nBad = all.filter(bad).length;
  const over75 = all.filter(r => r.content && r.content.titleLen > H_TITLE_LIMIT).length;
  const avg = all.length ? Math.round(all.reduce((s, r) => s + r.score, 0) / all.length) : 0;
  const name = parentName(brand, parent, all[0] && all[0].title);
  const kids = HK_SHOW === 'bad' ? all.filter(bad) : HK_SHOW === 'ok' ? all.filter(r => !bad(r)) : all;
  const gradeCls = g => g === 'Good' ? 'gd-good' : g === 'Needs work' ? 'gd-warn' : 'gd-bad';

  $('hkTitle').textContent = name || parent;
  $('hkSub').innerHTML = `<span style="font-family:ui-monospace,monospace">${esc(parent)}</span> · ${esc(BRAND_NAME[brand] || brand)}`
    + ` · <b>${all.length}</b> children · <b style="color:#991b1b">${nBad}</b> with a problem · <b style="color:#166534">${all.length - nBad}</b> OK`
    + ` · avg score <b>${avg}</b>`
    + (over75 ? ` · <b>${over75}</b> title(s) over ${H_TITLE_LIMIT} characters` : '');
  $('hkSeg').querySelectorAll('[data-hks]').forEach(b => b.classList.toggle('on', b.dataset.hks === HK_SHOW));

  const checks = all.length ? all[0]._c.map(x => x) : healthChecks({});
  const mark = x => x.pass === null
    ? `<td class="hk-c hk-na" title="${esc(x.t)}: ${esc(x.say)}">–</td>`
    : `<td class="hk-c ${x.pass ? 'hk-ok' : (x.info ? 'hk-info' : 'hk-bad')}" title="${esc(x.t)}: ${esc(x.say)}${x.info ? ' (information only — not scored)' : ''}">${x.pass ? '✓' : '✗'}<div class="hk-say">${esc(x.say)}</div></td>`;

  const head = '<thead><tr><th class="frz">SKU</th><th>ASIN</th><th>Title</th><th class="num">Health</th><th>Bucket</th>'
    + checks.map(x => `<th class="hk-c"${x.info ? ' title="Amazon\'s 75-character title limit — shown for information, not counted in the score. Fix these with the Title Optimiser."' : ''}>${esc(x.t)}${x.info ? ' <span class="muted">ⓘ</span>' : ''}</th>`).join('')
    + '<th>What to fix</th></tr></thead>';
  const body = kids.map(r => {
    const fix = [...r._h.critical.map(x => 'Critical: ' + x), ...r._h.action.map(x => 'Action: ' + x), ...r._h.review.map(x => 'Review: ' + x)];
    if (r.content && r.content.titleLen > H_TITLE_LIMIT) fix.push(`Title over ${H_TITLE_LIMIT} (${r.content.titleLen}) — information only`);
    return '<tr>'
      + `<td class="frz" style="font-family:ui-monospace,monospace;font-size:12px">${esc(r.sku)}</td>`
      + `<td style="font-family:ui-monospace,monospace;font-size:12px">${r.asin ? `<a href="https://www.amazon.com/dp/${esc(r.asin)}" target="_blank" rel="noopener">${esc(r.asin)}</a>` : '<span class="muted">—</span>'}</td>`
      + `<td style="min-width:260px;max-width:340px;white-space:normal;font-size:12px;line-height:1.35" title="${esc(r.title)}">${esc(r.title) || '<span class="muted">—</span>'}</td>`
      + `<td class="num" style="font-weight:700">${r.score}</td>`
      + `<td>${esc(r.grade)}</td>`
      + r._c.map(mark).join('')
      + `<td style="white-space:normal;min-width:180px;font-size:12px">${fix.length
          ? fix.map(f => `<div>• ${esc(f)}</div>`).join('')
          : (r.content ? '<span style="font-weight:600">Nothing found — Healthy</span>' : '<span class="muted">Content not checked yet</span>')}</td>`
      + '</tr>';
  }).join('');
  $('hkTable').innerHTML = head + '<tbody>' + (body
    || `<tr><td colspan="${checks.length + 6}" class="muted" style="padding:14px">No children match.</td></tr>`) + '</tbody>';
}

$('hkClose').onclick = () => { $('hkModal').classList.add('hide'); HK_OPEN = null; };
$('hkModal').onclick = e => { if (e.target === $('hkModal')) { $('hkModal').classList.add('hide'); HK_OPEN = null; } };
$('hkSeg').onclick = e => { const b = e.target.closest('[data-hks]'); if (!b) return; HK_SHOW = b.dataset.hks; healthKidsRender(); };
$('hkOptimiser').onclick = () => window.open(H_OPTIMISER_URL, '_blank', 'noopener');
$('hOptimiser').onclick = () => window.open(H_OPTIMISER_URL, '_blank', 'noopener');
$('hkCsv').onclick = () => {
  if (!HK_OPEN) return;
  const { brand, parent } = HK_OPEN;
  const rows = ((HEALTH[brand] && HEALTH[brand].rows) || []).filter(r => (r.parent || r.asin || r.sku) === parent);
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const checks = healthChecks({});
  const lines = [['SKU', 'ASIN', 'Title', 'Health', 'Bucket'].concat(checks.map(x => x.t), ['What to fix']).map(cell).join(',')];
  rows.forEach(r => {
    const h = healthOf(r), cs = healthChecks(r);
    const fix = [...h.critical.map(x => 'Critical: ' + x), ...h.action.map(x => 'Action: ' + x), ...h.review.map(x => 'Review: ' + x)];
    if (r.content && r.content.titleLen > H_TITLE_LIMIT) fix.push(`Title over ${H_TITLE_LIMIT} (${r.content.titleLen})`);
    lines.push([r.sku, r.asin, r.title, h.score, h.grade].concat(cs.map(x => (x.pass === null ? '' : (x.pass ? 'OK' : 'FAIL')) + ' ' + x.say), [fix.join(' | ')]).map(cell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `listing-health_${BRAND_NAME[brand] || brand}_${parent}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};


/** One card per brand, built from the SAME rows the table is showing — filter included. */
function renderHealthKpis(rows, brands) {
  const nf = v => Number(v || 0).toLocaleString('en-US');
  const tally = rs => rs.reduce((a, r) => {
    a.n++;
    a[r._h.bucket]++;
    if (r._h.bucket !== 'unchecked') { a.checked++; a.score += r.score; }
    else if (r.tried) a.nodata++;
    return a;
  }, { n: 0, critical: 0, action: 0, review: 0, healthy: 0, monitor: 0, unchecked: 0, nodata: 0, checked: 0, score: 0 });

  $('hKpis').innerHTML = brands.map(b => {
    const t = tally(rows.filter(r => r.brand === b));
    const h = HEALTH[b];
    const when = h && h.at ? 'updated ' + h.at.toLocaleString() : '';
    const avg = t.checked ? Math.round(t.score / t.checked) : 0;
    return `<div class="kpi">
      <div class="kpihead"><span class="kpiname">${BRAND_NAME[b]}</span><span class="kpiwhen">${when}</span></div>
      <div class="metrics">
        <div class="metric"><div class="v">${nf(t.critical)}</div><div class="l">Critical</div></div>
        <div class="metric"><div class="v">${nf(t.action)}</div><div class="l">Needs Action</div></div>
        <div class="metric"><div class="v">${nf(t.review)}</div><div class="l">Needs Review</div></div>
        <div class="metric"><div class="v">${nf(t.healthy + t.monitor)}</div><div class="l">Healthy${t.monitor ? ` · ${nf(t.monitor)} monitor` : ''}</div></div>
        <div class="metric"><div class="v" style="font-size:15px">${avg}</div><div class="l">Health</div></div>
        <div class="metric"><div class="v" style="font-size:15px">${nf(t.n)}</div><div class="l">Listings${
          t.unchecked ? ` · ${nf(t.unchecked)} not checked` : ''}${t.nodata ? ` (${nf(t.nodata)} no catalog data)` : ''}</div></div>
      </div>
    </div>`;
  }).join('');
}

/**
 * The report's REAL column names, one real row, and how many rows actually carry a merchant
 * price/quantity. Guessing at this schema is what produced "2,437 of 2,437 not selling" on the first
 * run, so it is inspectable here rather than argued about.
 */
$('hRaw').onclick = async () => {
  const box = $('hSchema');
  if (!box.classList.contains('hide')) { box.classList.add('hide'); return; }
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  // Where quantities actually come from. A qty of 0 can mean three completely different things —
  // the stock doc says 0, the stock doc has no such SKU, or there is no stock doc at all — and they
  // need different fixes, so this states which one it is instead of leaving it to be guessed at.
  box.innerHTML = '<span class="muted">Reading the stock docs…</span>';
  box.classList.remove('hide');
  const stockParts = [];
  for (const b of ['SP', 'CPC']) {
    let line = `<b>${BRAND_NAME[b]} stock doc</b> — `;
    try {
      const snap = await getDoc(doc(db, 'stock', b));
      if (!snap.exists()) line += '<span style="color:var(--bad)">does not exist yet</span> — run “Refresh both brands”.';
      else {
        const d = snap.data(), m = d.m || {};
        const keys = Object.keys(m);
        const zero = keys.filter(k => !(m[k] > 0)).length;
        const at = d.at && d.at.toDate ? d.at.toDate().toLocaleString() : 'unknown';
        const sample = keys.slice(0, 6).map(k => `${k} = ${m[k]}`).join('  ·  ');
        line += `${keys.length} SKUs · <b>${keys.length - zero} with stock</b>, ${zero} at zero · written ${at}`
          + (keys.length ? `<div style="font-family:ui-monospace,monospace;font-size:11px;margin-top:4px">${esc(sample)}</div>` : '');
        if (keys.length && zero === keys.length) {
          line += '<div style="color:var(--bad);margin-top:4px">Every value is zero — the quantity is not coming through from the ageing report.</div>';
        }
        // How the join actually landed for the listings on screen.
        const rows = HEALTH[b]?.rows || [];
        if (rows.length) {
          const nul = rows.filter(r => r.qty == null).length;
          const z = rows.filter(r => r.qty === 0).length;
          line += `<div style="margin-top:4px">Listings: ${rows.length - nul - z} with stock · ${z} at zero · ${nul} unmatched (“—”)</div>`;
        }
      }
    } catch (e) { line += `<span style="color:var(--bad)">could not read (${esc(e.message || e)})</span>`; }
    stockParts.push(`<div style="margin-bottom:12px">${line}</div>`);
  }

  const parts = ['SP', 'CPC'].filter(b => HEALTH[b]?.schema).map(b => {
    const s = HEALTH[b].schema;
    const pricePc = s.n ? Math.round((s.withPrice / s.n) * 100) : 0;
    const qtyPc = s.n ? Math.round((s.withQty / s.n) * 100) : 0;
    return `<div style="margin-bottom:12px">
      <b>${BRAND_NAME[b]}</b> — ${s.n} rows ·
      <b>${s.withPrice}</b> have a price (${pricePc}%) ·
      <b>${s.withQty}</b> have a quantity (${qtyPc}%)
      <div class="muted" style="margin:4px 0">Columns: ${esc((s.headers || []).join(', '))}</div>
      <div style="font-family:ui-monospace,monospace;font-size:11px;white-space:pre-wrap;background:var(--hover);padding:8px;border-radius:8px">${
        esc(Object.entries(s.sample || {}).map(([k, v]) => `${k} = ${v}`).join('\n'))}</div>
    </div>`;
  });
  const scopeBlock = [...H_SCOPE_NOTE, ...H_LAST_RUN].length
    ? `<div style="margin-bottom:12px"><b>Scope of what's on screen</b>${
        [...H_SCOPE_NOTE, ...H_LAST_RUN].map(t => `<div class="muted">${esc(t)}</div>`).join('')}</div>`
    : '';
  box.innerHTML = scopeBlock + stockParts.join('') + (parts.length ? parts.join('')
    : '<span class="muted">No listings schema yet — run “Refresh both brands” first.</span>');
  box.classList.remove('hide');
};

$('hCsv').onclick = () => {
  if (!H_RENDER.rows.length) return;
  const { rows, defs, val } = H_RENDER;
  const cell = v => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [defs.map(d => cell(d.t)).join(',')];
  rows.forEach(r => lines.push(defs.map(d => cell(val(r, d))).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `listing-health-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

