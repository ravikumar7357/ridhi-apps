/* HER ANSWERS INTO THE ROUTER'S DATABASE (Phase 5) — run by the router's deploy, after schema.sql:
 *   node meera/router/kb-sql.cjs > kb.sql   then   wrangler d1 execute meera --remote --file=kb.sql
 * Every entry of meera-bank.json (answers) and meera-walks.json (walk-throughs), exactly as in the files; what is no
 * longer in them is removed; kb_version goes up, so every router copy reloads. Answers admins approved live in their
 * own table (answers) and are not touched. */
const fs = require('fs'), path = require('path');
const G = path.join(__dirname, '..', '..', 'Replenish-App', 'public', 'guide');
const bank = JSON.parse(fs.readFileSync(path.join(G, 'meera-bank.json'), 'utf8'));
const walks = JSON.parse(fs.readFileSync(path.join(G, 'meera-walks.json'), 'utf8'));
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const out = ['DELETE FROM kb;'];
for (const e of bank) if (e && e.id && !/^learned-/.test(e.id)) out.push(`INSERT OR REPLACE INTO kb (id, kind, body) VALUES (${q(e.id)}, 'answer', ${q(JSON.stringify(e))});`);
for (const w of walks) if (w && w.id) out.push(`INSERT OR REPLACE INTO kb (id, kind, body) VALUES (${q('walk:' + w.id)}, 'walk', ${q(JSON.stringify(w))});`);
/* answers already moved into her file by the weekly build step keep their learned-<id>: in the file, once */
for (const e of bank) if (e && /^learned-/.test(e.id)) out.push(`INSERT OR REPLACE INTO kb (id, kind, body) VALUES (${q(e.id)}, 'answer', ${q(JSON.stringify(e))});`);
out.push("INSERT INTO config (key, value) VALUES ('kb_version', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1;");
process.stdout.write(out.join('\n') + '\n');
