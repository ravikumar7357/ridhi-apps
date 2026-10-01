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

