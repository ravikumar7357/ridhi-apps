/* ================= CORE HELPERS: DATES AND CSV =================
 * Gathered here from the Follow-ups and Replenishment files (2026-10-01, step 3 of the module plan), where they had
 * been written first and every other screen had come to use them. Unchanged; only where they live moved. */

const dToday = () => new Date().toLocaleDateString('en-CA');           // local 'YYYY-MM-DD'
const dAdd = (ds, n) => { const d = new Date(ds + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const dDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);   // b − a in days
const dValid = ds => !!ds && !isNaN(new Date(String(ds) + 'T00:00:00').getTime());   // guards NaN from a non-ISO date

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
/** The "is that right?" question for a big figure, or '' when it is not big. Rupees are never asked about. */
function ptNumBig(n, label, kind) {
  const cap = PT_NUM_BIG[kind];
  if (!cap || !(Number(n) > cap)) return '';
  const u = kind === 'pcs' ? 'pcs' : 'm';
  return `${label}: ${Number(n).toLocaleString('en-IN')} ${u} is more than ${cap.toLocaleString('en-IN')} ${u}. Is that right?`;
}
