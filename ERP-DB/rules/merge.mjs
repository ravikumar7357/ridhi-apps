// Merges the three rule drafts into rules-draft.json (one row per register) and prints a short summary.
//   node ERP-DB/rules/merge.mjs
import fs from 'node:fs';
import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1');
const parts = ['draft-production.json', 'draft-orders-stock.json', 'draft-hr-masters.json'];
const byReg = new Map(); const problems = [];
for (const f of parts) {
  let rows;
  try { rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
  catch (e) { problems.push(f + ': ' + e.message); continue; }
  for (const r of rows) {
    const key = String(r.register || '').trim();
    if (!key) { problems.push(f + ': row without register'); continue; }
    const prev = byReg.get(key);
    if (!prev) { byReg.set(key, { ...r, from: [f.replace(/^draft-|\.json$/g, '')] }); continue; }
    prev.from.push(f.replace(/^draft-|\.json$/g, ''));
    for (const k of Object.keys(r)) {
      if (prev[k] == null || prev[k] === '' || (Array.isArray(prev[k]) && !prev[k].length)) prev[k] = r[k];
      else if (Array.isArray(prev[k]) && Array.isArray(r[k])) prev[k] = [...new Set([...prev[k], ...r[k]])];
      else if (typeof prev[k] === 'string' && typeof r[k] === 'string' && prev[k] !== r[k] && !prev[k].includes(r[k])) prev[k] += ' | ' + r[k];
    }
  }
}
const rows = [...byReg.values()].sort((a, b) => String(a.area).localeCompare(String(b.area)) || a.register.localeCompare(b.register));
fs.writeFileSync(path.join(dir, 'rules-draft.json'), JSON.stringify(rows, null, 1));
const txt = v => JSON.stringify(v ?? '');
console.log('registers', rows.length, 'problems', problems.length);
problems.forEach(p => console.log('PROBLEM', p));
console.log('in 2+ drafts:', rows.filter(r => r.from.length > 1).map(r => r.register).join(', '));
console.log('doubts:', rows.filter(r => /doubt/i.test(txt(r))).length);
console.log('multi_save yes:', rows.filter(r => /^yes/i.test(txt(r.multi_save).replace(/^"/, ''))).length);
console.log('month-based:', rows.filter(r => r.month_field && !/^none/i.test(String(r.month_field))).length);
