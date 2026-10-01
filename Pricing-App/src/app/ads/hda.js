/* ---------- HDA — high discounted ASINs ================================================
 *
 * Two kinds of row, labelled apart on every line and never merged:
 *
 *   TYPED HERE — a heavy discount that was set up in Seller Central and recorded by hand, against
 *   the CHILD ASIN that actually carried it. Amazon publishes no export for coupons, Prime
 *   Exclusive Discounts or deals, so nothing else in this app can know these ever happened.
 *
 *   FROM THE PLANNER — a plan already on the Planner whose discount reaches the threshold. Those
 *   are PARENT-level, because a parent × week grid is all the planner can hold. The table says
 *   "whole parent" on those rows rather than presenting a parent as the discounted ASIN.
 *
 * The threshold decides ONLY which planner deals are pulled in. A row typed here is always shown,
 * whatever its size: a record that disappears because somebody moved a dropdown is worse than no
 * record at all.
 */

/** child ASIN → { brand, parent, title }, from the Listing Health snapshot. */
function dAsinIndex() {
  const m = new Map();
  myBrands().forEach(b => (HEALTH[b]?.rows || []).forEach(r => {
    const a = String(r.asin || '').trim().toUpperCase();
    if (!D_ASIN_RE.test(a) || m.has(a)) return;
    const p = String(r.parent || '').trim().toUpperCase();
    // A standalone listing is its own parent — that is what the rest of the calendar assumes too.
    m.set(a, { brand: b, parent: D_ASIN_RE.test(p) ? p : a, title: r.title || '' });
  }));
  return m;
}

/** Where a run sits relative to today. A finished deal and one still live are not the same fact. */
function dHdaStatus(start, end) {
  const t = sdToday();
  return end < t ? 'Finished' : (start > t ? 'Upcoming' : 'Running');
}

const dHdaDays = (s, e) => Math.max(1, Math.round((new Date(e + 'T00:00:00Z') - new Date(s + 'T00:00:00Z')) / 86400000) + 1);

function dHdaRows() {
  const brand = $('dBrand').value, q = $('dFilter').value.trim().toLowerCase();
  const idx = dAsinIndex(), bmap = dBrandOf();
  const out = [];

  D_HDA.forEach(h => {
    if (!h || !h.asin || !h.s || !h.e) return;
    const info = idx.get(h.asin) || {};
    // The brand and parent stored on the record win: the ASIN may since have left the snapshot, and
    // the deal was still run on it. The index only fills in what was never stored.
    const b = h.brand || info.brand || '';
    const parent = h.parent || info.parent || '';
    const name = info.title || (b && parent ? parentName(b, parent, '') : '') || '';
    out.push({ src: 'typed', id: h.id, asin: h.asin, parent, brand: b, name,
      t: h.t || 'PED', v: Number(h.v) || 0, start: h.s, end: h.e, by: h.by || '', note: h.note || '',
      known: !!info.brand });
  });

  if (D_HDA_MIN >= 0) {
    Object.entries(D_PLAN).forEach(([k, p]) => {
      if (!p || !p.t) return;
      // A plan with no percentage typed is not evidence of a discount, let alone a heavy one.
      const v = Number(p.v) || 0;
      if (v <= 0 || v < D_HDA_MIN) return;
      const i = k.lastIndexOf('|');
      if (i < 0) return;
      const parent = k.slice(0, i), week = k.slice(i + 1);
      const span = dPlanSpan(week, p);
      const b = bmap.get(parent) || '';
      out.push({ src: 'plan', key: k, asin: '', parent, brand: b,
        name: (b && parentName(b, parent, '')) || '', t: p.t, v, start: span.start, end: span.end,
        by: p.by || '', note: '', known: true });
    });
  }

  // A typed row and a planner row can be the same discount entered twice. Neither is dropped —
  // which one is the truth is not something this screen can know — but the overlap is named.
  const planned = out.filter(r => r.src === 'plan');
  out.forEach(r => {
    if (r.src !== 'typed') return;
    // An ASIN that is no longer in the snapshot has no parent to compare against, so it is false —
    // not "unknown". Leaving the field off entirely put an undefined into the row and the export.
    r.alsoPlanned = !!r.parent
      && planned.some(p => p.parent === r.parent && p.start <= r.end && r.start <= p.end);
  });

  let rows = out;
  if (brand !== 'ALL') rows = rows.filter(r => r.brand === brand);
  if (q) rows = rows.filter(r => (r.asin + ' ' + r.parent + ' ' + r.name).toLowerCase().includes(q));
  // Most recent first, by the day the run ended.
  rows.sort((a, b) => b.end.localeCompare(a.end) || String(a.asin || a.parent).localeCompare(String(b.asin || b.parent)));
  return rows;
}

function renderHdaKpis(rows) {
  const nf = v => Math.round(v || 0).toLocaleString('en-US');
  const asins = new Set(rows.map(r => r.asin || r.parent).filter(Boolean));
  const typed = rows.filter(r => r.src === 'typed').length;
  const live = rows.filter(r => dHdaStatus(r.start, r.end) === 'Running').length;
  const days = rows.reduce((s, r) => s + dHdaDays(r.start, r.end), 0);
  const discs = rows.map(r => r.v).filter(v => v > 0);
  const avg = discs.length ? Math.round(discs.reduce((a, b) => a + b, 0) / discs.length) : 0;
  const deepest = discs.length ? Math.max(...discs) : 0;
  const tile = (label, val, colour) => `<div class="metric"><div class="v"${colour ? ` style="color:${colour}"` : ''}>${val}</div><div class="l">${label}</div></div>`;
  const rule = D_HDA_MIN < 0 ? 'typed records only' : (D_HDA_MIN ? `typed records + every plan at ${D_HDA_MIN}% or more` : 'typed records + every plan with a discount');
  $('dHdaKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">High discounted ASINs</span>
      <span class="kpiwhen">${rule}</span></div>
    <div class="metrics">
      ${tile('Records', nf(rows.length))}
      ${tile('ASINs / parents', nf(asins.size))}
      ${tile('Days of discount', nf(days))}
      ${tile('Average discount', avg ? avg + '%' : '—')}
      ${tile('Deepest', deepest ? deepest + '%' : '—', deepest >= 50 ? 'var(--bad)' : '')}
      ${tile('Running now', nf(live), live ? '#166534' : '')}
      ${tile('Typed here', nf(typed))}
      ${tile('From planner', nf(rows.length - typed))}
    </div></div>`;
}

function renderHda() {
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  // A threshold saved before these options existed must not leave the dropdown blank.
  const sel = $('dHdaMin');
  if (![...sel.options].some(o => Number(o.value) === D_HDA_MIN)) {
    sel.insertAdjacentHTML('beforeend', `<option value="${D_HDA_MIN}">Planner: ${D_HDA_MIN}% and above</option>`);
  }
  sel.value = String(D_HDA_MIN);

  const rows = dHdaRows();
  renderHdaKpis(rows);
  const head = '<thead><tr><th>Ran</th><th class="num">Days</th><th>Status</th><th>ASIN</th><th>Image</th>'
    + '<th>Product</th><th>Brand</th><th>Type</th><th class="num">Disc %</th><th>Where from</th>'
    + '<th>Run by</th><th>Note</th></tr></thead>';
  const body = rows.slice(0, 400).map(r => {
    const [bg, fg] = (D_PLAN_COLOUR[r.t] || '#f1f5f9|#334155').split('|');
    const img = D_IMG[r.parent];
    const st = dHdaStatus(r.start, r.end);
    const stCol = st === 'Running' ? '#166534' : (st === 'Upcoming' ? '#92400e' : '');
    const attr = r.src === 'typed' ? `data-hda="${esc(r.id)}"` : `data-hdaplan="${esc(r.key)}"`;
    const tip = r.src === 'typed'
      ? 'Typed here. Click to edit or delete it.'
      : 'Comes from the Planner — click to open it there. It covers the whole parent, not one child.';
    return `<tr ${attr} style="cursor:pointer" title="${esc(tip)}">`
      + `<td style="white-space:nowrap">${esc(r.start)} → ${esc(r.end)}</td>`
      + `<td class="num">${dHdaDays(r.start, r.end)}</td>`
      + `<td${stCol ? ` style="color:${stCol};font-weight:600"` : ''}>${st}</td>`
      + `<td style="font-family:ui-monospace,monospace">${r.asin
          ? esc(r.asin) + (r.known ? '' : ' <span class="muted" style="font-family:inherit;font-size:11px" title="This ASIN is not in the Listing Health snapshot — it may have been removed, or belong to a brand you cannot see. The record is kept either way.">not in snapshot</span>')
          : `<span class="muted" style="font-size:11px">whole parent</span><br>${esc(r.parent)}`}</td>`
      + `<td style="padding:2px 6px">${img
          ? `<img src="${esc(dThumb(img))}" loading="lazy" decoding="async" style="width:30px;height:30px;object-fit:cover;border-radius:5px;background:#f1f5f9" alt="">`
          : '<span class="muted" style="font-size:11px">—</span>'}</td>`
      + `<td title="${esc(r.name)}">${esc(String(r.name).slice(0, 34)) || '<span class="muted">—</span>'}</td>`
      + `<td>${r.brand ? esc(BRAND_NAME[r.brand] || r.brand) : '<span class="muted">—</span>'}</td>`
      + `<td><span style="background:${bg};color:${fg};font-weight:700;font-size:11.5px;padding:2px 7px;border-radius:5px">${esc(r.t)}</span></td>`
      + `<td class="num"${r.v >= 50 ? ' style="color:var(--bad);font-weight:700"' : ''}>${r.v ? r.v + '%' : '<span class="muted">—</span>'}</td>`
      + `<td style="font-size:11.5px">${r.src === 'typed'
          ? 'Typed here' + (r.alsoPlanned ? ' <span class="muted" title="A planner deal on the same parent overlaps these dates. Both are shown — this screen cannot tell whether it is the same discount entered twice.">· also on planner</span>' : '')
          : '<span class="muted">From planner</span>'}</td>`
      + `<td>${r.by ? esc(r.by) : '<span class="muted">—</span>'}</td>`
      + `<td title="${esc(r.note)}">${esc(String(r.note).slice(0, 40)) || '<span class="muted">—</span>'}</td></tr>`;
  }).join('');
  $('dHdaTable').innerHTML = head + '<tbody>' + (body
    || `<tr><td colspan="12" class="muted" style="padding:14px">Nothing recorded yet. Press <b>+ Add ASIN</b> to record a discount you ran${D_HDA_MIN < 0 ? '' : ', or widen the threshold to pull in what is already on the planner'}.</td></tr>`)
    + '</tbody>';
  dMsg(rows.length > 400
    ? `${rows.length} record(s) · showing the 400 most recent · Export covers all of them.`
    : `${rows.length} record(s) · click a row to open it.`);
}

/* ---------- the HDA record box ---------- */
let D_HDA_EDIT = null;

function hdaErr(t) { $('hdaErr').textContent = t || ''; }

/** Say who the typed ASIN belongs to, as it is typed — so a wrong paste is caught before saving. */
function hdaWhoNote() {
  const a = $('hdaAsin').value.trim().toUpperCase();
  const el = $('hdaWho');
  if (!a) { el.textContent = ''; return; }
  if (!D_ASIN_RE.test(a)) { el.textContent = 'An ASIN is 10 letters and digits.'; return; }
  const info = dAsinIndex().get(a);
  if (!info) { el.textContent = 'Not in the Listing Health snapshot. It will still be saved — the name and brand will just be blank.'; return; }
  const name = info.title || parentName(info.brand, info.parent, '') || '(no name)';
  el.textContent = `${BRAND_NAME[info.brand] || info.brand} · ${String(name).slice(0, 46)}${info.parent !== a ? ' · parent ' + info.parent : ' · standalone'}`;
}
function hdaSpanNote() {
  const s = $('hdaStart').value, e = $('hdaEnd').value;
  $('hdaSpan').textContent = (s && e && e >= s) ? `${dHdaDays(s, e)} day(s) · ${dHdaStatus(s, e).toLowerCase()}` : '';
}
['hdaAsin'].forEach(id => $(id).addEventListener('input', hdaWhoNote));
['hdaStart', 'hdaEnd'].forEach(id => $(id).addEventListener('input', hdaSpanNote));

function hdaOpen(id) {
  const h = id ? D_HDA.find(x => x && x.id === id) : null;
  D_HDA_EDIT = h ? h.id : null;
  $('hdaTitle').textContent = h ? 'High discount — ' + h.asin : 'Record a high discount';
  $('hdaAsin').value = h ? h.asin : '';
  $('hdaType').value = (h && h.t) || 'PED';
  $('hdaVal').value = h ? (h.v || '') : '';
  $('hdaStart').value = h ? h.s : '';
  $('hdaEnd').value = h ? h.e : '';
  $('hdaBy').value = h ? (h.by || '') : '';
  $('hdaNote').value = h ? (h.note || '') : '';
  $('hdaDelete').classList.toggle('hide', !h);
  // Names already used anywhere on this tab, so the same person is not spelt three ways.
  const names = [...new Set([...D_HDA.map(x => x && x.by), ...Object.values(D_PLAN).map(p => p && p.by)].filter(Boolean))].sort();
  $('hdaByList').innerHTML = names.map(n => `<option value="${String(n).replace(/"/g, '&quot;')}">`).join('');
  hdaErr(''); hdaWhoNote(); hdaSpanNote();
  $('hdaModal').classList.remove('hide');
  $('hdaAsin').focus();
}

async function hdaSave() {
  const asin = $('hdaAsin').value.trim().toUpperCase();
  const s = $('hdaStart').value, e = $('hdaEnd').value;
  const v = Number($('hdaVal').value) || 0;
  if (!D_ASIN_RE.test(asin)) { hdaErr('An ASIN is 10 letters and digits — check the one pasted in.'); return; }
  if (!s || !e) { hdaErr('Both dates are needed. This records something that already ran.'); return; }
  if (e < s) { hdaErr('The end date is before the start date.'); return; }
  if (v < 1 || v > 90) { hdaErr('Give the discount as a percentage between 1 and 90.'); return; }
  const info = dAsinIndex().get(asin) || {};
  const rec = {
    id: D_HDA_EDIT || 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    asin, parent: info.parent || '', brand: info.brand || '',
    t: $('hdaType').value, v, s, e,
    by: $('hdaBy').value.trim(), note: $('hdaNote').value.trim(),
    at: sdToday(), byUser: ME.email,
  };
  const i = D_HDA.findIndex(x => x && x.id === rec.id);
  if (i >= 0) D_HDA[i] = { ...D_HDA[i], ...rec }; else D_HDA.push(rec);
  $('hdaModal').classList.add('hide'); D_HDA_EDIT = null;
  renderDealsAny();
  try { await saveDeals(false); dMsg('Saved.'); }
  catch (err) { dMsg('Could not save: ' + (err.message || err), true); }
}

async function hdaDelete() {
  if (!D_HDA_EDIT) return;
  const h = D_HDA.find(x => x && x.id === D_HDA_EDIT);
  if (!confirm(`Delete the ${h ? h.t + ' on ' + h.asin : 'record'}? This is the only copy — Amazon has no export to get it back from.`)) return;
  D_HDA = D_HDA.filter(x => x && x.id !== D_HDA_EDIT);
  $('hdaModal').classList.add('hide'); D_HDA_EDIT = null;
  renderDealsAny();
  try { await saveDeals(false); dMsg('Deleted.'); }
  catch (err) { dMsg('Could not save: ' + (err.message || err), true); }
}

$('hdaSave').onclick = hdaSave;
$('hdaDelete').onclick = hdaDelete;
$('hdaCancel').onclick = () => { $('hdaModal').classList.add('hide'); D_HDA_EDIT = null; };
$('dHdaAdd').onclick = () => hdaOpen(null);
$('dHdaTable').addEventListener('click', e => {
  const typed = e.target.closest('[data-hda]');
  if (typed) { hdaOpen(typed.dataset.hda); return; }
  const fromPlan = e.target.closest('[data-hdaplan]');
  if (fromPlan) dPlanOpen(fromPlan.dataset.hdaplan);
});
$('dHdaMin').addEventListener('change', async () => {
  D_HDA_MIN = Number($('dHdaMin').value);
  renderHda();
  // Saved, because "high" has to mean the same thing to everyone looking at this tab.
  try { await saveDeals(false); } catch (err) { dMsg('Could not save the threshold: ' + (err.message || err), true); }
});

/* ---------- importing HDA records from a sheet =========================================
 *
 * ADDS, never replaces. The orders import beside this one replaces its channel because each export
 * is a full picture of that shop; a discount log is not — it is built up over months, and a file is
 * one more page of it. Replacing here would delete last quarter's records because this quarter's
 * sheet does not mention them.
 *
 * Same ASIN + type + start + end is treated as the SAME record and updated, so re-uploading a sheet
 * that has grown by three rows adds three rows, not forty duplicates.
 */
const HDA_IMP_COLS = [
  { k: 'asin', t: 'ASIN', need: true, alias: ['child asin', 'product asin', 'asin1', 'asin '] },
  { k: 't', t: 'Type', need: false, alias: ['deal type', 'discount type', 'promotion', 'promo type'] },
  { k: 'v', t: 'Discount %', need: true, alias: ['discount', 'discount percent', 'disc %', 'disc', 'discount%', '%'] },
  { k: 's', t: 'Started', need: true, alias: ['start', 'start date', 'started on', 'from'] },
  { k: 'e', t: 'Ended', need: true, alias: ['end', 'end date', 'ended on', 'to'] },
  { k: 'by', t: 'Run by', need: false, alias: ['by', 'owner', 'run_by'] },
  { k: 'note', t: 'Note', need: false, alias: ['notes', 'remark', 'remarks', 'comment'] },
];

/** The six types the calendar knows, plus the names people actually write for them. */
const HDA_TYPES = {
  PED: 'PED', 'PRIME EXCLUSIVE DISCOUNT': 'PED', 'PRIME EXCLUSIVE': 'PED', 'PRIME DISCOUNT': 'PED',
  COUPON: 'COUPON', COUPONS: 'COUPON',
  DEAL: 'DEAL', 'DEAL OF THE DAY': 'DEAL', DOTD: 'DEAL',
  'BEST DEAL': 'BEST DEAL', BESTDEAL: 'BEST DEAL',
  LIGHTNING: 'LIGHTNING', 'LIGHTNING DEAL': 'LIGHTNING', LD: 'LIGHTNING',
  'PRICE DISC': 'PRICE DISC', 'PRICE DISCOUNT': 'PRICE DISC', 'SALE PRICE': 'PRICE DISC', 'PRICE DROP': 'PRICE DISC',
};

const HDA_MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Take a date apart WITHOUT deciding what 01/02/2026 means.
 *
 * Anything with a month NAME, or written the ISO way, is unambiguous and comes back finished. A
 * purely numeric date comes back as its two numbers and is settled later, from the whole column —
 * because guessing day-first or month-first per row is how a sheet ends up with half its deals
 * eleven months out, all of them looking perfectly reasonable.
 */
function hdaDateParts(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return { kind: 'fixed', y: +m[1], mo: +m[2], d: +m[3] };
  m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]*(\d{4})$/.exec(t);              // 23-Aug-2026, 23 August 2026
  if (m) { const mo = HDA_MON[m[2].slice(0, 3).toLowerCase()]; return mo ? { kind: 'fixed', y: +m[3], mo, d: +m[1] } : null; }
  m = /^([A-Za-z]{3,9})[-\s]+(\d{1,2}),?[-\s]+(\d{4})$/.exec(t);            // Aug 23, 2026
  if (m) { const mo = HDA_MON[m[1].slice(0, 3).toLowerCase()]; return mo ? { kind: 'fixed', y: +m[3], mo, d: +m[2] } : null; }
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(t);                  // 01/02/2026 — not yet decided
  if (m) return { kind: 'numeric', a: +m[1], b: +m[2], y: +m[3] };
  return null;
}

/** Which way round the numeric dates in THIS file are written. Decided once, from all of them. */
function hdaDateOrder(numeric) {
  let dayFirst = false, monthFirst = false;
  numeric.forEach(p => { if (p.a > 12) dayFirst = true; if (p.b > 12) monthFirst = true; });
  if (dayFirst && monthFirst) return 'mixed';
  if (dayFirst) return 'dmy';
  if (monthFirst) return 'mdy';
  return numeric.length ? 'ambiguous' : 'none';
}

/** A real calendar day, or ''. Catches 31 February, which every naive builder accepts as 3 March. */
function hdaIso(y, mo, d) {
  if (!(y >= 2000 && y <= 2100) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return '';
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) === iso ? iso : '';
}

/** The identity of a record for import: the same discount, on the same ASIN, over the same days. */
const hdaKeyOf = r => [r.asin, r.t, r.s, r.e].join('|');

let HDA_IMP_STAGED = null;

$('dHdaImp').onclick = () => {
  HDA_IMP_STAGED = null;
  $('hdaImpPrev').classList.add('hide');
  $('hdaImpErr').classList.add('hide');
  $('hdaImpSave').disabled = true;
  $('hdaImpModal').classList.remove('hide');
};
$('hdaImpCancel').onclick = () => $('hdaImpModal').classList.add('hide');
$('hdaImpModal').onclick = e => { if (e.target === $('hdaImpModal')) $('hdaImpModal').classList.add('hide'); };
$('hdaImpPick').onclick = () => $('hdaImpFile').click();

$('hdaImpTemplate').onclick = () => {
  const cell = v => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  // Two examples: one filled in completely, one with only what is required — so it is obvious which
  // columns may be left empty. The dates are written the one way that can never be misread.
  const ex = [
    ['B0CR91CFCJ', 'PED', '40', '2026-07-06', '2026-07-12', 'Ravi', 'Prime Day. BSR 12k → 3k, held two weeks.'],
    ['B0C625C9RP', 'COUPON', '25', '2026-08-03', '2026-08-16', '', ''],
  ];
  const lines = [HDA_IMP_COLS.map(c => c.t).map(cell).join(',')].concat(ex.map(r => r.map(cell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'hda-import-template.csv';
  a.click(); URL.revokeObjectURL(a.href);
};

$('hdaImpFile').onchange = async ev => {
  const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const err = t => { $('hdaImpErr').innerHTML = t; $('hdaImpErr').classList.remove('hide'); $('hdaImpSave').disabled = true; };
  $('hdaImpErr').classList.add('hide');
  $('hdaImpPrev').classList.add('hide');
  HDA_IMP_STAGED = null;
  try {
    const rows = dParseCsv(await file.text());
    if (rows.length < 2) { err('That file has no rows under its header.'); return; }
    const head = rows[0].map(h => String(h).trim().toLowerCase());

    // BY NAME, never by position — an extra column inserted at the front would otherwise move every
    // value one place across, and the import would look like it worked.
    const at = {};
    HDA_IMP_COLS.forEach(c => {
      let idx = head.indexOf(c.t.toLowerCase());
      if (idx < 0) for (const a of c.alias) { const i = head.indexOf(a); if (i >= 0) { idx = i; break; } }
      if (idx >= 0) at[c.k] = idx;
    });
    const missing = HDA_IMP_COLS.filter(c => c.need && at[c.k] == null).map(c => c.t);
    if (missing.length) {
      err('These columns are required and were not found: <b>' + esc(missing.join(', ')) + '</b>.'
        + ' The file has: ' + esc(head.filter(Boolean).slice(0, 18).join(', '))
        + '. Download the template to see the names it looks for.');
      return;
    }

    const cellOf = (row, k) => (at[k] == null ? '' : String(row[at[k]] == null ? '' : row[at[k]]).trim());
    const body = rows.slice(1).filter(r => r.some(c => String(c || '').trim()));

    /* THE DATE QUESTION IS SETTLED ONCE, FOR THE WHOLE FILE, BEFORE A SINGLE ROW IS BUILT.
     * If every numeric date could be read either way, nothing is imported and it says so — an
     * import that silently picks a convention is the one that puts a July deal in a January week. */
    const numeric = [];
    body.forEach(r => ['s', 'e'].forEach(k => {
      const p = hdaDateParts(cellOf(r, k));
      if (p && p.kind === 'numeric') numeric.push(p);
    }));
    const order = hdaDateOrder(numeric);
    if (order === 'ambiguous' || order === 'mixed') {
      err(order === 'mixed'
        ? 'The dates in this file contradict each other — some can only be day-first, others only month-first.'
          + ' Nothing has been imported. Write them as <b>yyyy-mm-dd</b> and try again.'
        : 'The dates are written as numbers only (for example <b>' + esc(String(numeric[0].a).padStart(2, '0') + '/' + String(numeric[0].b).padStart(2, '0') + '/' + numeric[0].y)
          + '</b>) and every one of them could be read either way round. Nothing has been imported, because'
          + ' guessing would silently move deals by months. Write the dates as <b>yyyy-mm-dd</b>'
          + ' — in Excel, set the column to Text first, or it will reformat them back.');
      return;
    }
    const toIso = v => {
      const p = hdaDateParts(v);
      if (!p) return '';
      if (p.kind === 'fixed') return hdaIso(p.y, p.mo, p.d);
      return order === 'dmy' ? hdaIso(p.y, p.b, p.a) : hdaIso(p.y, p.a, p.b);
    };

    const good = [], bad = [];
    let noType = 0;
    body.forEach((r, i) => {
      const line = i + 2;                                   // as numbered in the file, header included
      const asin = cellOf(r, 'asin').toUpperCase();
      const rawT = cellOf(r, 't').toUpperCase().replace(/\s+/g, ' ');
      const s = toIso(cellOf(r, 's')), e = toIso(cellOf(r, 'e'));
      const v = Math.round(Number(cellOf(r, 'v').replace(/[^0-9.\-]/g, '')) || 0);
      if (!D_ASIN_RE.test(asin)) { bad.push(`line ${line}: “${cellOf(r, 'asin').slice(0, 14)}” is not an ASIN`); return; }
      if (rawT && !HDA_TYPES[rawT]) { bad.push(`line ${line}: type “${rawT.slice(0, 18)}” is not one this calendar knows`); return; }
      if (!rawT) noType++;
      if (!s || !e) { bad.push(`line ${line}: ${!s ? 'the start' : 'the end'} date could not be read`); return; }
      if (e < s) { bad.push(`line ${line}: it ends before it starts`); return; }
      if (v < 1 || v > 90) { bad.push(`line ${line}: discount “${cellOf(r, 'v').slice(0, 10)}” is not between 1 and 90`); return; }
      good.push({ asin, t: rawT ? HDA_TYPES[rawT] : 'PED', v, s, e, by: cellOf(r, 'by'), note: cellOf(r, 'note') });
    });

    if (!good.length) {
      err('Nothing in that file could be used.<br>' + esc(bad.slice(0, 8).join(' · ')) + (bad.length > 8 ? ' …' : ''));
      return;
    }

    // The same discount twice in one file is one record — the later line wins, and it is said out loud.
    const byKey = new Map();
    let dupInFile = 0;
    good.forEach(g => { if (byKey.has(hdaKeyOf(g))) dupInFile++; byKey.set(hdaKeyOf(g), g); });
    const list = [...byKey.values()];
    const have = new Set(D_HDA.map(h => hdaKeyOf({ asin: h.asin, t: h.t, s: h.s, e: h.e })));
    const updating = list.filter(g => have.has(hdaKeyOf(g))).length;
    const idx = dAsinIndex();
    const unknown = list.filter(g => !idx.has(g.asin));

    HDA_IMP_STAGED = list;
    $('hdaImpPrev').classList.remove('hide');
    $('hdaImpPrev').innerHTML =
      `<div><b>${list.length} record(s)</b> ready — ${list.length - updating} new, ${updating} updating one already recorded.</div>`
      + `<div class="muted" style="font-size:12px;margin-top:4px">Matched columns: ${HDA_IMP_COLS.filter(c => at[c.k] != null).map(c => esc(c.t)).join(', ')}.`
      + (order === 'dmy' || order === 'mdy' ? ` Numeric dates read as ${order === 'dmy' ? 'day/month/year' : 'month/day/year'} — the file itself made that unambiguous.` : '')
      + `</div>`
      + (noType ? `<div class="muted" style="font-size:12px;margin-top:4px">${noType} row(s) had no Type and will be recorded as <b>PED</b>.</div>` : '')
      + (dupInFile ? `<div class="muted" style="font-size:12px;margin-top:4px">${dupInFile} row(s) repeat an earlier line in the same file (same ASIN, type and dates) — the last one wins.</div>` : '')
      + (unknown.length ? `<div style="color:var(--bad);font-size:12px;margin-top:4px">${unknown.length} ASIN(s) are not in the Listing Health snapshot (${unknown.slice(0, 3).map(g => esc(g.asin)).join(', ')}${unknown.length > 3 ? '…' : ''}). They will import, but with no name, brand or picture.</div>` : '')
      + (bad.length ? `<div style="color:var(--bad);font-size:12px;margin-top:4px">${bad.length} row(s) will be skipped — ${esc(bad.slice(0, 5).join(' · '))}${bad.length > 5 ? ' …' : ''}</div>` : '')
      + `<div class="muted" style="font-size:12px;margin-top:6px">This ADDS to the ${D_HDA.length} record(s) already kept. Nothing is deleted.</div>`;
    $('hdaImpSave').disabled = false;
  } catch (e2) { err('Could not read that file: ' + esc(e2.message || e2)); }
};

$('hdaImpSave').onclick = async () => {
  if (!HDA_IMP_STAGED || !HDA_IMP_STAGED.length) return;
  const idx = dAsinIndex();
  let added = 0, updated = 0;
  // The row's position goes into the id: a whole file lands inside one millisecond, so the clock
  // alone would hand several records the same id and the last one would swallow the rest.
  const stamp = Date.now().toString(36);
  HDA_IMP_STAGED.forEach((g, n) => {
    const info = idx.get(g.asin) || {};
    const rec = { asin: g.asin, parent: info.parent || '', brand: info.brand || '',
      t: g.t, v: g.v, s: g.s, e: g.e, by: g.by, note: g.note, at: sdToday(), byUser: ME.email };
    const i = D_HDA.findIndex(h => h && hdaKeyOf({ asin: h.asin, t: h.t, s: h.s, e: h.e }) === hdaKeyOf(g));
    if (i >= 0) { D_HDA[i] = { ...D_HDA[i], ...rec }; updated++; }
    else { D_HDA.push({ id: 'h' + stamp + '-' + n.toString(36), ...rec }); added++; }
  });
  HDA_IMP_STAGED = null;
  $('hdaImpModal').classList.add('hide');
  renderDealsAny();
  try { await saveDeals(false); dMsg(`Imported — ${added} added, ${updated} updated.`); }
  catch (err2) { dMsg('Could not save the import: ' + (err2.message || err2), true); }
};

function dSetMode(m) {
  D_MODE = m;
  $('dModePlan').classList.toggle('on', m === 'plan');
  $('dModeEvents').classList.toggle('on', m === 'events');
  $('dModeDone').classList.toggle('on', m === 'done');
  $('dModeHda').classList.toggle('on', m === 'hda');
  $('dPlanCard').classList.toggle('hide', m !== 'plan');
  $('dKpis').classList.toggle('hide', m !== 'plan');
  $('dEventsCard').classList.toggle('hide', m !== 'events');
  $('dDoneCard').classList.toggle('hide', m !== 'done');
  $('dHdaCard').classList.toggle('hide', m !== 'hda');
  document.querySelectorAll('#paneDeals .planOnly').forEach(el => el.classList.toggle('hide', m !== 'plan'));
  document.querySelectorAll('#paneDeals .doneOnly').forEach(el => el.classList.toggle('hide', m !== 'done'));
  document.querySelectorAll('#paneDeals .hdaOnly').forEach(el => el.classList.toggle('hide', m !== 'hda'));
  // HDA rows are keyed on the CHILD ASIN, so the box searches one more thing here and says so.
  $('dFilter').placeholder = m === 'hda' ? 'Filter ASIN / parent / name' : 'Filter parent ASIN / name';
  renderDealsAny();
}
function renderDealsAny() {
  if (D_MODE === 'events') renderEvents();
  else if (D_MODE === 'done') renderDone();
  else if (D_MODE === 'hda') renderHda();
  else renderPlanner();
}
$('dModePlan').onclick = () => dSetMode('plan');
$('dModeEvents').onclick = () => dSetMode('events');
$('dModeDone').onclick = () => dSetMode('done');
$('dModeHda').onclick = () => dSetMode('hda');

['dBrand', 'dPlanFilter'].forEach(id => $(id).addEventListener('change', renderDealsAny));
let D_FILTER_T = null;
$('dFilter').addEventListener('input', () => { clearTimeout(D_FILTER_T); D_FILTER_T = setTimeout(renderDealsAny, 250); });
$('dExport').onclick = () => {
  // The planner exports as the grid you see — that is the thing people paste into a sheet or send on.
  if (D_MODE === 'plan') {
    const weeks = dPlanWeeks(), rows = dPlanParents();
    const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const endOf = w => new Date(new Date(w + 'T00:00:00Z').getTime() + 6 * 86400000).toISOString().slice(0, 10);
    const lines = [
      ['', '', '', 'Start Date', ...weeks].map(cell).join(','),
      ['Parent ASIN', 'Product', 'BSR', 'End Date', ...weeks.map(endOf)].map(cell).join(','),
    ];
    rows.forEach(r => lines.push([r.parent, r.name, r.rank || '', '',
      ...weeks.map(w => { const p = D_PLAN[r.parent + '|' + w]; return p && p.t ? p.t + (p.v ? ' ' + p.v + '%' : '') : ''; })].map(cell).join(',')));
    const blob0 = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a0 = document.createElement('a'); a0.href = URL.createObjectURL(blob0);
    a0.download = `deal-planner-${dToday()}.csv`; a0.click(); URL.revokeObjectURL(a0.href);
    return;
  }
  // Completed view: one row per finished deal, every row in the range — not just the 400 drawn.
  if (D_MODE === 'done') {
    const cell1 = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines1 = [['Started', 'Ended', 'Days', 'Parent ASIN', 'Product', 'Brand', 'Type', 'Discount %', 'Run by'].map(cell1).join(',')];
    dDoneRows().forEach(r => lines1.push([r.span.start, r.span.end, r.span.days, r.parent, r.name,
      r.brand ? (BRAND_NAME[r.brand] || r.brand) : '', r.p.t, r.p.v || '', r.p.by || ''].map(cell1).join(',')));
    const blob1 = new Blob(['﻿' + lines1.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a1 = document.createElement('a'); a1.href = URL.createObjectURL(blob1);
    a1.download = `deals-completed-${dToday()}.csv`; a1.click(); URL.revokeObjectURL(a1.href);
    return;
  }
  // HDA: every record in the view, typed and pulled alike — with the column that says which, because
  // a parent-level planner row and an ASIN-level record are not the same claim.
  if (D_MODE === 'hda') {
    const cell2 = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines2 = [['Started', 'Ended', 'Days', 'Status', 'ASIN', 'Parent ASIN', 'Applies to', 'Product',
      'Brand', 'Type', 'Discount %', 'Where from', 'Run by', 'Note'].map(cell2).join(',')];
    dHdaRows().forEach(r => lines2.push([r.start, r.end, dHdaDays(r.start, r.end), dHdaStatus(r.start, r.end),
      r.asin, r.parent, r.asin ? 'this ASIN' : 'whole parent', r.name,
      r.brand ? (BRAND_NAME[r.brand] || r.brand) : '', r.t, r.v || '',
      r.src === 'typed' ? 'Typed here' : 'From planner', r.by || '', r.note || ''].map(cell2).join(',')));
    const blob2 = new Blob(['﻿' + lines2.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob2);
    a2.download = `deals-hda-${dToday()}.csv`; a2.click(); URL.revokeObjectURL(a2.href);
    return;
  }
  // Events view: the windows and how many recommendations sit in each.
  const cell = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const named = new Set(Object.keys(D_EVENTS));
  DEALS.recs.forEach(r => { const s = String(r.schedule || '').trim(); if (s && !D_DATE_RE.test(s)) named.add(s); });
  const lines = [['Event', 'Starts', 'Ends', 'Recommendation rows'].map(cell).join(',')];
  [...named].sort().forEach(n => {
    const ev = D_EVENTS[n] || {};
    lines.push([n, ev.start || '', ev.end || '', DEALS.recs.filter(r => String(r.schedule || '').trim() === n).length].map(cell).join(','));
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `deal-events-${dToday()}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
};

