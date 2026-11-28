/* ================= CORE HELPERS: DATES AND CSV =================
 * Gathered here from the Follow-ups and Replenishment files (2026-10-01, step 3 of the module plan), where they had
 * been written first and every other screen had come to use them. Unchanged; only where they live moved. */

const dToday = () => new Date().toLocaleDateString('en-CA');           // local 'YYYY-MM-DD'
const dAdd = (ds, n) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const dDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);   // b − a in days
const dValid = ds => !!ds && !isNaN(new Date(String(ds) + 'T00:00:00').getTime());   // guards NaN from a non-ISO date

/* ONE DATE RULE (Ravi, 26 Nov 2026, fix 7 of the PPC flow test: a plan went in Ready 03-11-0008 and a receive was dated 2099,
 * and each form checked its dates its own way, or not at all). Two kinds of date:
 *   'done' — when something happened (cut, issued, received, PO date): not after today, not more than 60 days back;
 *   'fixed' — an admin's correction of a 'done' date: not after today, any day back;
 *   'plan' — when something should happen (PPC cut / QC / ready, PO delivery): not before today, not more than a year ahead.
 * "Today" is India's today, whatever the PC clock's zone. A date left as it was saved (`was`, on an edit) is not checked again,
 * so an old plan can still be saved. Blank is the form's own business: '' here. Returns '' when fine, else what to fix. */
const PT_DATE_BACK_DAYS = 60, PT_DATE_AHEAD_DAYS = 366;
const dTodayIndia = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const ptDayWords = ds => String(ds).slice(0, 10).split('-').reverse().join('-');   // 2026-11-03 → 03-11-2026, the way the floor reads it
function ptDateErr(ds, label, kind, was) {
  const t = String(ds == null ? '' : ds).trim().slice(0, 10);
  if (!t) return '';
  /* A real calendar day: 31 Feb is not one, though the browser would quietly read it as 3 March. */
  const d = /^\d{4}-\d{2}-\d{2}$/.test(t) ? new Date(t + 'T00:00:00Z') : null;
  const real = !!d && !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t;
  if (!real) return `${label}: "${t}" is not a date.`;
  if (was && t === String(was).trim().slice(0, 10)) return '';
  const today = dTodayIndia();
  if (kind === 'done' || kind === 'fixed') {
    if (t > today) return `${label} ${ptDayWords(t)} is in the future — pick today or an earlier day.`;
    if (kind === 'done' && dDiff(t, today) > PT_DATE_BACK_DAYS) return `${label} ${ptDayWords(t)} is more than ${PT_DATE_BACK_DAYS} days back — ask an admin to enter it.`;
    return '';
  }
  if (t < today) return `${label} ${ptDayWords(t)} is before today — pick a date from today on.`;
  if (dDiff(today, t) > PT_DATE_AHEAD_DAYS) return `${label} ${ptDayWords(t)} is more than a year ahead — check the year.`;
  return '';
}
/** Dates that must come in this order, e.g. [['Cut', cut], ['QC', qc], ['Ready', ready]]; blanks are skipped. '' or what to fix. */
function ptDateOrderErr(steps) {
  const set = steps.filter(([, d]) => String(d || '').trim());
  for (let i = 1; i < set.length; i++)
    if (set[i][1] < set[i - 1][1]) return `${set[i][0]} date ${ptDayWords(set[i][1])} is before the ${set[i - 1][0]} date ${ptDayWords(set[i - 1][1])}.`;
  return '';
}

function csvCell(v) { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function csvDownload(name, cols, rows) {
  const lines = [cols.map(csvCell).join(',')].concat(rows.map(r => r.map(csvCell).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
// Header lookup for CSV import: first matching column name wins, -1 when absent.
const colIdx = (head, names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
const cellAt = (row, i) => (i >= 0 && row[i] != null ? String(row[i]).trim() : '');


/* ONE NUMBER RULE (Ravi, 26 Nov 2026, fix 6 of the PPC flow test: the plan form took -5 metres a piece and planned -250 m, and
 * each form checked its numbers its own way, or not at all). Every typed pieces, metres or rupees box asks here, so every form
 * refuses the same things in the same words. Pieces are whole and above 0; metres above 0; rupees 0 or more. zeroOk lets a box
 * take 0 (or blank) where 0 is a real answer: 0 rejected, a rate of 0. Returns '' when the number is fine, else what to fix. */
const PT_NUM_BIG = { pcs: 1500, m: 3000 };   // Ravi, 26 Nov: above these the form asks "is that right?" before saving
function ptNumErr(raw, label, kind, zeroOk) {
  const t = String(raw == null ? '' : raw).trim();
  if (!t) return zeroOk ? '' : `${label}: type a number.`;
  const n = Number(t);
  if (!Number.isFinite(n)) return `${label}: "${t}" is not a number.`;
  if (n < 0) return `${label} cannot be below 0 — you typed ${t}.`;
  if (kind === 'pcs' && !Number.isInteger(n)) return `${label} must be whole pieces — you typed ${t}.`;
  if (n === 0 && !zeroOk && kind !== 'rs') return `${label} must be more than 0.`;
  return '';
}
/* CLOTH ABOVE THE NEED (28 Nov 2026, order-to-shipping test: 5,000 m went on a challan for a 5.2 m line): a challan or a cutting
 * entry may take up to a tenth more than the worked-out need. Where no need can be worked out, nothing is refused. */
const PT_CLOTH_EXTRA = 0.10;
function ptClothOver(typed, need, label) {
  const m = Number(typed), n = Number(need);
  if (!(n > 0) || !(m > n * (1 + PT_CLOTH_EXTRA) + 0.05)) return '';   // 0.05 m: figures are rounded on screen
  const most = Math.round(n * (1 + PT_CLOTH_EXTRA) * 100) / 100;
  return `${label}: ${m} m typed, but the need is ${Math.round(n * 100) / 100} m — at most ${most} m (10% extra).`;
}
/** The "is that right?" question for a big figure, or '' when it is not big. Rupees are never asked about. */
function ptNumBig(n, label, kind) {
  const cap = PT_NUM_BIG[kind];
  if (!cap || !(Number(n) > cap)) return '';
  const u = kind === 'pcs' ? 'pcs' : 'm';
  return `${label}: ${Number(n).toLocaleString('en-IN')} ${u} is more than ${cap.toLocaleString('en-IN')} ${u}. Is that right?`;
}
