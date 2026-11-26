/* Read or change the backend roadmap shown on Sellora's /roadmap.html (table backend.roadmap), with the backend's own
 * server key from Backend/.env. For Claude and the owner; the page's admins edit through sellora.roadmap_save.
 *
 *   node --env-file=.env tools/roadmap.ts list
 *   node --env-file=.env tools/roadmap.ts set m2a done=600 status=active "note=Orders job running beside Apps Script"
 *   node --env-file=.env tools/roadmap.ts set _meta 'next=[{"text":"Buy the server","done":true}]'
 *
 * A value that reads as JSON (a number, true/false, [..] or {..}) is stored as that; anything else as text.
 * Only the fields named change; everything else on the row stays. Each change is stamped "updated by claude". */

import { Db } from '../src/lib/db.ts';
import { processEnv, SUPABASE_URL } from '../src/lib/env.ts';

interface Row { id: string; ord: number; data: Record<string, unknown>; updated_at?: string; updated_by?: string }

const key = processEnv('SUPABASE_SERVICE_KEY');
if (!key) { console.error('SUPABASE_SERVICE_KEY is not set (run with --env-file=.env).'); process.exit(1); }
const db = new Db(SUPABASE_URL, key, 'backend');

export function parseValue(v: string): unknown {
  const t = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(t) || t === 'true' || t === 'false' || /^[[{]/.test(t)) {
    try { return JSON.parse(t); } catch { /* fall through to text */ }
  }
  return v;
}

const [cmd, id, ...pairs] = process.argv.slice(2);

if (cmd === 'list') {
  const rows = await db.select<Row>('roadmap', 'select=id,ord,data,updated_at,updated_by&order=ord');
  for (const r of rows) {
    const d = r.data || {};
    const amount = d.total !== undefined ? `${d.done ?? 0}/${d.total} ${d.unit ?? ''}` : '';
    console.log([r.id.padEnd(11), String(d.status ?? '').padEnd(7), amount.padEnd(18), String(d.week ?? '').padEnd(18), r.updated_by ?? ''].join('  '));
  }
} else if (cmd === 'set' && id && pairs.length) {
  const found = await db.select<Row>('roadmap', `select=id,ord,data&id=eq.${encodeURIComponent(id)}`);
  if (!found.length) { console.error(`No roadmap row "${id}".`); process.exit(1); }
  const patch: Record<string, unknown> = {};
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i < 1) { console.error(`Not key=value: ${p}`); process.exit(1); }
    patch[p.slice(0, i)] = parseValue(p.slice(i + 1));
  }
  const row = found[0];
  await db.upsert('roadmap', [{ id: row.id, ord: row.ord, data: { ...row.data, ...patch }, updated_at: new Date().toISOString(), updated_by: 'claude' }], 'id');
  console.log(`Updated ${id}: ${Object.keys(patch).join(', ')}`);
} else {
  console.log('Use: tools/roadmap.ts list   |   tools/roadmap.ts set <id> key=value [key=value …]');
  process.exit(cmd ? 1 : 0);
}
