/* ================= LISTING · PARENT CHECK: the "every child of one parent" dialog on Listing Health, plus the screen's KPI cards, Raw fields and CSV exports =================
 * Screens: Listing Health (tab 'health') — the children dialog (hkModal) opened from a parent row, the per-brand KPI cards,
 *          the "Raw fields" panel and the two CSV buttons (the dialog's and the main table's).
 * Does: healthChecks lists each check for one child (pass / fail / not known) from the same fields healthOf scores;
 *       healthKidsOpen / healthKidsRender fill the dialog; renderHealthKpis draws the KPI cards; the hRaw handler shows the
 *       stock docs and the report's real column names; hkCsv and hCsv export the dialog and the table.
 * Main functions: healthChecks, healthKidsOpen, healthKidsRender, renderHealthKpis, the hRaw / hkCsv / hCsv handlers. */
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
const H_OPTIMISER_URL = 'https://claude.ai/public/artifacts/9d2c21e6-30b8-4f08-acf1-33113121e621';   // the Title Optimiser the two "Optimiser" buttons open
const H_TITLE_LIMIT = 75;     // Amazon's title limit — shown for information only, never scored
let HK_OPEN = null;           // { brand, parent } of the dialog on screen
let HK_SHOW = 'all';          // all | bad | ok

/**
 * Each check for one child: pass true/false, or null when the fact is not known (never checked, or the
 * report left it blank). Unknown is never shown as a failure — that would send somebody after a listing
 * that is fine.
 */
// Each check for one child row (see the block above): { k, t, pass, say } — `info: true` marks the one that is not scored.
// `health` is healthOf's answer for the row: pictures and A+ are read from it (the catalogue's pictures, A+ on the listing or its
// parent — Listing Rules, Parts A1 / A2), never from the raw snapshot fields, so this dialog cannot contradict the other screens.
function healthChecks(row, health) {
  const content = row.content;
  const status = row.status || '';
  const isActive = /active/i.test(status) && !/inactive/i.test(status);
  const fba = /amazon|afn/i.test(row.channel || '');
  const titleLen = content ? content.titleLen : null;
  const pics = health ? health.pics : null;
  const ap = health ? health.aplus : null;
  return [
    { k: 'active', t: 'Active', pass: /inactive/i.test(status) ? false : (isActive || fba ? true : (status ? false : null)),
      say: status || 'no status' },
    { k: 'stock', t: 'In stock', pass: row.qty == null ? null : row.qty > 0,
      say: row.qty == null ? 'not known' : row.qty + ' units' },
    { k: 'price', t: 'Price', pass: row.price == null ? null : row.price > 0,
      say: row.price ? '$' + Number(row.price).toFixed(2) : (row.price === 0 ? 'no price' : 'not known') },
    { k: 'title', t: `Title ${H_RULES.minTitle}–${H_RULES.maxTitle}`,
      pass: titleLen == null ? null : titleLen >= H_RULES.minTitle && titleLen <= H_RULES.maxTitle,
      say: titleLen == null ? 'not checked' : titleLen + ' chars' },
    { k: 't75', t: `Title ≤ ${H_TITLE_LIMIT}`, info: true, pass: titleLen == null ? null : titleLen <= H_TITLE_LIMIT,
      say: titleLen == null ? 'not checked' : (titleLen > H_TITLE_LIMIT ? `${titleLen - H_TITLE_LIMIT} over` : 'within') },
    { k: 'bullets', t: `Bullets ${H_RULES.minBullets}+`, pass: content ? content.bullets >= H_RULES.minBullets : null,
      say: content ? content.bullets + ' bullets' : 'not checked' },
    { k: 'images', t: `Images ${H_RULES.minImages}+`, pass: pics ? pics.main && pics.n >= H_RULES.minImages : null,
      say: pics ? `${pics.n} picture${pics.n === 1 ? '' : 's'}${pics.main ? '' : ', no main'}` : 'not checked' },
    { k: 'desc', t: 'Description', pass: content ? content.descLen >= H_RULES.minDesc : null,
      say: content ? (content.descLen ? content.descLen + ' chars' : 'none') : 'not checked' },
    { k: 'aplus', t: 'A+', pass: !ap ? null : ap.v === true ? true : (ap.v === false && !ap.stale ? false : null),
      say: !ap ? 'not checked' : ap.v === true ? (ap.src === 'parent' ? 'published on the parent' : 'published') : ap.v === false && !ap.stale ? 'missing' : (ap.why || 'not checked') },
  ];
}
// The "What to fix" lines of one child, in the two words every problem list uses (Listing Rules, Part B1), Errors first; an Error
// resting on old data reads "Error? Check again".
const hkFixLines = health => lrProblemsSort(health.found).map(hit => (hit.sev === 'critical' ? (hit.stale ? 'Error? Check again: ' : 'Error: fix first: ') : 'Needs attention: ') + hit.name + ' — ' + hit.detail);

// A parent row was clicked: remember which parent, show every child, open the dialog.
function healthKidsOpen(brand, parent) {
  HK_OPEN = { brand, parent };
  HK_SHOW = 'all';
  healthKidsRender();
  $('hkModal').classList.remove('hide');
}

// Fill the children dialog: score every child of the open parent, write the header line, then the table of checks.
function healthKidsRender() {
  if (!HK_OPEN) return;
  const { brand, parent } = HK_OPEN;
  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));

  // --- gather the children and score them ---
  const all = ((HEALTH[brand] && HEALTH[brand].rows) || [])
    .filter(row => (row.parent || row.asin || row.sku) === parent)
    .map(row => {
      const health = healthOf(Object.assign({ brand }, row));   // the snapshot rows carry no brand; every live and A+ lookup keys on it
      return Object.assign({}, row, { _h: health, score: health.score, grade: health.grade, _c: healthChecks(row, health) });
    })
    .sort((a, b) => a.score - b.score || String(a.sku).localeCompare(String(b.sku)));
  const bad = row => row._h.blocking.length || row._h.content.length;
  const nBad = all.filter(bad).length;
  const over75 = all.filter(row => row.content && row.content.titleLen > H_TITLE_LIMIT).length;
  const avg = all.length ? Math.round(all.reduce((acc, row) => acc + row.score, 0) / all.length) : 0;
  const name = parentName(brand, parent, all[0] && all[0].title);
  const kids = HK_SHOW === 'bad' ? all.filter(bad) : HK_SHOW === 'ok' ? all.filter(row => !bad(row)) : all;
  const gradeCls = grade => grade === 'Good' ? 'gd-good' : grade === 'Needs work' ? 'gd-warn' : 'gd-bad';

  // --- header line and the All / Problems / OK segment ---
  $('hkTitle').textContent = name || parent;
  $('hkSub').innerHTML = `<span style="font-family:ui-monospace,monospace">${esc(parent)}</span> · ${esc(BRAND_NAME[brand] || brand)}`
    + ` · <b>${all.length}</b> children · <b style="color:var(--bad-ink)">${nBad}</b> with a problem · <b style="color:var(--accent-ink)">${all.length - nBad}</b> OK`
    + ` · avg score <b>${avg}</b>`
    + (over75 ? ` · <b>${over75}</b> title(s) over ${H_TITLE_LIMIT} characters` : '');
  $('hkSeg').querySelectorAll('[data-hks]').forEach(btn => btn.classList.toggle('on', btn.dataset.hks === HK_SHOW));

  // --- the table: one column per check ---
  const checks = all.length ? all[0]._c.map(check => check) : healthChecks({});
  const mark = check => check.pass === null
    ? `<td class="hk-c hk-na" title="${esc(check.t)}: ${esc(check.say)}">–</td>`
    : `<td class="hk-c ${check.pass ? 'hk-ok' : (check.info ? 'hk-info' : 'hk-bad')}"`
      + ` title="${esc(check.t)}: ${esc(check.say)}${check.info ? ' (information only — not scored)' : ''}">`
      + `${check.pass ? '✓' : '✗'}<div class="hk-say">${esc(check.say)}</div></td>`;

  const head = '<thead><tr><th class="frz">SKU</th><th>ASIN</th><th>Title</th><th class="num">Health</th><th>Bucket</th>'
    + checks.map(check => `<th class="hk-c"${check.info
        ? ' title="Amazon\'s 75-character title limit — shown for information, not counted in the score. Fix these with the Title Optimiser."'
        : ''}>${esc(check.t)}${check.info ? ' <span class="muted">ⓘ</span>' : ''}</th>`).join('')
    + '<th>What to fix</th></tr></thead>';
  const body = kids.map(row => {
    const fix = hkFixLines(row._h);
    if (row.content && row.content.titleLen > H_TITLE_LIMIT) fix.push(`Title over ${H_TITLE_LIMIT} (${row.content.titleLen}) — information only`);
    return '<tr>'
      + `<td class="frz" style="font-family:ui-monospace,monospace;font-size:12px">${esc(row.sku)}</td>`
      + `<td style="font-family:ui-monospace,monospace;font-size:12px">${row.asin
          ? `<a href="https://www.amazon.com/dp/${esc(row.asin)}" target="_blank" rel="noopener">${esc(row.asin)}</a>`
          : '<span class="muted">—</span>'}</td>`
      + `<td style="min-width:260px;max-width:340px;white-space:normal;font-size:12px;line-height:1.35" title="${esc(row.title)}">`
        + `${esc(row.title) || '<span class="muted">—</span>'}</td>`
      + `<td class="num" style="font-weight:700">${row.score}</td>`
      + `<td>${esc(row.grade)}</td>`
      + row._c.map(mark).join('')
      + `<td style="white-space:normal;min-width:180px;font-size:12px">${fix.length
          ? fix.map(note => `<div>• ${esc(note)}</div>`).join('')
          : (row.content ? '<span style="font-weight:600">Nothing found — Healthy</span>' : '<span class="muted">Content not checked yet</span>')}</td>`
      + '</tr>';
  }).join('');
  $('hkTable').innerHTML = head + '<tbody>' + (body
    || `<tr><td colspan="${checks.length + 6}" class="muted" style="padding:14px">No children match.</td></tr>`) + '</tbody>';
}

// Close the dialog: the X button, or a click on the backdrop.
$('hkClose').onclick = () => {
  $('hkModal').classList.add('hide');
  HK_OPEN = null;
};
$('hkModal').onclick = e => {
  if (e.target === $('hkModal')) {
    $('hkModal').classList.add('hide');
    HK_OPEN = null;
  }
};
// The All / Problems / OK segment inside the dialog.
$('hkSeg').onclick = e => {
  const btn = e.target.closest('[data-hks]');
  if (!btn) return;
  HK_SHOW = btn.dataset.hks;
  healthKidsRender();
};
// The two "Title Optimiser" buttons — in the dialog and on the Listing Health toolbar — open it in a new tab.
$('hkOptimiser').onclick = () => window.open(H_OPTIMISER_URL, '_blank', 'noopener');
$('hOptimiser').onclick = () => window.open(H_OPTIMISER_URL, '_blank', 'noopener');
// CSV of the open parent's children: one row per child, one column per check, then what to fix.
$('hkCsv').onclick = () => {
  if (!HK_OPEN) return;
  const { brand, parent } = HK_OPEN;
  const rows = ((HEALTH[brand] && HEALTH[brand].rows) || []).filter(row => (row.parent || row.asin || row.sku) === parent);
  const cell = value => {
    const str = String(value == null ? '' : value);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const checks = healthChecks({});
  const lines = [['SKU', 'ASIN', 'Title', 'Health', 'Bucket'].concat(checks.map(check => check.t), ['What to fix']).map(cell).join(',')];
  rows.forEach(row => {
    const health = healthOf(Object.assign({ brand }, row));
    const rowChecks = healthChecks(row, health);
    const fix = hkFixLines(health);
    if (row.content && row.content.titleLen > H_TITLE_LIMIT) fix.push(`Title over ${H_TITLE_LIMIT} (${row.content.titleLen})`);
    lines.push([row.sku, row.asin, row.title, health.score, health.grade]
      .concat(rowChecks.map(check => (check.pass === null ? '' : (check.pass ? 'OK' : 'FAIL')) + ' ' + check.say), [fix.join(' | ')])
      .map(cell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `listing-health_${BRAND_NAME[brand] || brand}_${parent}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 2000);
};


/** One card per brand, built from the SAME rows the table is showing — filter included. */
// KPI cards at the top of Listing Health: counts per bucket, the average score and how many listings were never checked.
function renderHealthKpis(rows, brands) {
  const nf = value => Number(value || 0).toLocaleString('en-US');
  // Count one brand's rows by bucket; the average only counts rows that were actually checked.
  const tally = list => list.reduce((acc, row) => {
    acc.n++;
    acc[row._h.bucket]++;
    if (row._h.bucket !== 'unchecked') {
      acc.checked++;
      acc.score += row.score;
    } else if (row.tried) acc.nodata++;
    return acc;
  }, { n: 0, critical: 0, action: 0, review: 0, healthy: 0, monitor: 0, unchecked: 0, nodata: 0, checked: 0, score: 0 });

  $('hKpis').innerHTML = brands.map(brand => {
    const counts = tally(rows.filter(row => row.brand === brand));
    const saved = HEALTH[brand];
    const when = saved && saved.at ? 'updated ' + saved.at.toLocaleString() : '';
    const avg = counts.checked ? Math.round(counts.score / counts.checked) : 0;
    return `<div class="kpi">
      <div class="kpihead"><span class="kpiname">${BRAND_NAME[brand]}</span><span class="kpiwhen">${when}</span></div>
      <div class="metrics">
        <div class="metric"><div class="v">${nf(counts.critical)}</div><div class="l">Critical</div></div>
        <div class="metric"><div class="v">${nf(counts.action)}</div><div class="l">Needs Action</div></div>
        <div class="metric"><div class="v">${nf(counts.review)}</div><div class="l">Needs Review</div></div>
        <div class="metric"><div class="v">${nf(counts.healthy + counts.monitor)}</div><div class="l">Healthy${counts.monitor ? ` · ${nf(counts.monitor)} monitor` : ''}</div></div>
        <div class="metric"><div class="v" style="font-size:15px">${avg}</div><div class="l">Health</div></div>
        <div class="metric"><div class="v" style="font-size:15px">${nf(counts.n)}</div><div class="l">Listings${
          counts.unchecked ? ` · ${nf(counts.unchecked)} not checked` : ''}${counts.nodata ? ` (${nf(counts.nodata)} no catalog data)` : ''}</div></div>
      </div>
    </div>`;
  }).join('');
}

/**
 * The report's REAL column names, one real row, and how many rows actually carry a merchant
 * price/quantity. Guessing at this schema is what produced "2,437 of 2,437 not selling" on the first
 * run, so it is inspectable here rather than argued about.
 */
// "Raw fields" button: toggle the panel that shows the stock docs, the report's columns and the scope notes.
$('hRaw').onclick = async () => {
  const box = $('hSchema');
  if (!box.classList.contains('hide')) {
    box.classList.add('hide');
    return;
  }
  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));

  // --- the stock docs, one per brand ---
  // Where quantities actually come from. A qty of 0 can mean three completely different things —
  // the stock doc says 0, the stock doc has no such SKU, or there is no stock doc at all — and they
  // need different fixes, so this states which one it is instead of leaving it to be guessed at.
  box.innerHTML = '<span class="muted">Reading the stock docs…</span>';
  box.classList.remove('hide');
  const stockParts = [];
  for (const brand of ['SP', 'CPC']) {
    let line = `<b>${BRAND_NAME[brand]} stock doc</b> — `;
    try {
      const snap = await getDoc(doc(db, 'stock', brand));
      if (!snap.exists()) line += '<span style="color:var(--bad-ink)">does not exist yet</span> — run “Refresh both brands”.';
      else {
        const data = snap.data();
        const qtyMap = data.m || {};          // SKU → quantity
        const keys = Object.keys(qtyMap);
        const zero = keys.filter(sku => !(qtyMap[sku] > 0)).length;
        const at = data.at && data.at.toDate ? data.at.toDate().toLocaleString() : 'unknown';
        const sample = keys.slice(0, 6).map(sku => `${sku} = ${qtyMap[sku]}`).join('  ·  ');
        line += `${keys.length} SKUs · <b>${keys.length - zero} with stock</b>, ${zero} at zero · written ${at}`
          + (keys.length ? `<div style="font-family:ui-monospace,monospace;font-size:11px;margin-top:4px">${esc(sample)}</div>` : '');
        if (keys.length && zero === keys.length) {
          line += '<div style="color:var(--bad-ink);margin-top:4px">Every value is zero — '
            + 'the quantity is not coming through from the ageing report.</div>';
        }
        // How the join actually landed for the listings on screen.
        const rows = HEALTH[brand]?.rows || [];
        if (rows.length) {
          const unmatched = rows.filter(row => row.qty == null).length;
          const atZero = rows.filter(row => row.qty === 0).length;
          line += `<div style="margin-top:4px">Listings: ${rows.length - unmatched - atZero} with stock · ${atZero} at zero · ${unmatched} unmatched (“—”)</div>`;
        }
      }
    } catch (e) {
      line += `<span style="color:var(--bad-ink)">could not read (${esc(e.message || e)})</span>`;
    }
    stockParts.push(`<div style="margin-bottom:12px">${line}</div>`);
  }

  // --- the report's real columns and one sample row, per brand ---
  const parts = ['SP', 'CPC'].filter(brand => HEALTH[brand]?.schema).map(brand => {
    const schema = HEALTH[brand].schema;
    const pricePc = schema.n ? Math.round((schema.withPrice / schema.n) * 100) : 0;
    const qtyPc = schema.n ? Math.round((schema.withQty / schema.n) * 100) : 0;
    return `<div style="margin-bottom:12px">
      <b>${BRAND_NAME[brand]}</b> — ${schema.n} rows ·
      <b>${schema.withPrice}</b> have a price (${pricePc}%) ·
      <b>${schema.withQty}</b> have a quantity (${qtyPc}%)
      <div class="muted" style="margin:4px 0">Columns: ${esc((schema.headers || []).join(', '))}</div>
      <div style="font-family:ui-monospace,monospace;font-size:11px;white-space:pre-wrap;background:var(--hover);padding:8px;border-radius:8px">${
        esc(Object.entries(schema.sample || {}).map(([key, value]) => `${key} = ${value}`).join('\n'))}</div>
    </div>`;
  });
  // --- what was excluded or truncated, and the last refresh's notes ---
  const scopeBlock = [...H_SCOPE_NOTE, ...H_LAST_RUN].length
    ? `<div style="margin-bottom:12px"><b>Scope of what's on screen</b>${
        [...H_SCOPE_NOTE, ...H_LAST_RUN].map(note => `<div class="muted">${esc(note)}</div>`).join('')}</div>`
    : '';
  box.innerHTML = scopeBlock + stockParts.join('') + (parts.length ? parts.join('')
    : '<span class="muted">No listings schema yet — run “Refresh both brands” first.</span>');
  box.classList.remove('hide');
};

// CSV of the main table as shown: the same columns (defs) and the same cell text (val) the table uses, filter included.
$('hCsv').onclick = () => {
  if (!H_RENDER.rows.length) return;
  const { rows, defs, val } = H_RENDER;
  const cell = value => {
    const str = String(value == null ? '' : value);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const lines = [defs.map(col => cell(col.t)).join(',')];
  rows.forEach(row => lines.push(defs.map(col => cell(val(row, col))).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `listing-health-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
};

