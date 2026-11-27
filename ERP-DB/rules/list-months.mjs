// Prints register → month_field (first 90 chars) for the month-based rows, and key shapes, to pick lock fields.
import fs from 'node:fs';
const rows = JSON.parse(fs.readFileSync(new URL('./rules-draft.json', import.meta.url), 'utf8'));
for (const r of rows) {
  const m = String(r.month_field ?? '');
  if (!m.trim() || /^\s*none/i.test(m)) continue;
  console.log(r.register.padEnd(22), '|', m.replace(/\s+/g, ' ').slice(0, 90), '| key:', String(r.record_key ?? '').slice(0, 50));
}
