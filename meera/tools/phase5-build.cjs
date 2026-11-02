/* Phase 5: server.ts into meera.js, the per-screen lists, the two switches. Run once. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const BUILD = path.join(ROOT, 'meera', 'client', 'build.cjs');
let c = fs.readFileSync(BUILD, 'utf8');
const rep = (a, b) => { if (c.split(a).length !== 2) throw new Error('build.cjs: ' + a.slice(0, 60)); c = c.replace(a, () => b); };
rep("['start.ts', 'understand.ts', 'design.ts', 'learn.ts', 'finish.ts']", "['start.ts', 'understand.ts', 'design.ts', 'learn.ts', 'server.ts', 'finish.ts']");
rep(" + src/learn.ts (Phase 4) + her files", " + src/learn.ts (Phase 4) + src/server.ts (Phase 5) + her files");
rep("    + ts('learn.ts', {}) + '\\n'   // Phase 4: learning from staff (switch \"learn\")\n",
    "    + ts('learn.ts', {}) + '\\n'   // Phase 4: learning from staff (switch \"learn\")\n"
  + "    + ts('server.ts', {}) + '\\n'   // Phase 5: searching on her router (switches \"server\", \"serveruse\")\n");
rep("  return { 'meera.js': file,",
    "  /* PHASE 5: the small list for each screen, for when her router cannot be reached (switch \"serveruse\"): each answer's\n"
  + "   * first ways of asking and its one line (cut at 220 letters), no steps; the screen's walk-throughs; the general answers\n"
  + "   * (no screen) in _.json, the 40 with the most ways of asking */\n"
  + "  const G = path.join(APP, 'public', 'guide'), bank = JSON.parse(fs.readFileSync(path.join(G, 'meera-bank.json'), 'utf8')), walks = JSON.parse(fs.readFileSync(path.join(G, 'meera-walks.json'), 'utf8'));\n"
  + "  const cut = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, String(v).length > 220 ? String(v).slice(0, 217).replace(/<[^>]*$/, '') + '…' : v]));\n"
  + "  const slim = e => ({ id: e.id, tab: e.tab || '', q: { en: (e.q.en || []).slice(0, 2), hi: (e.q.hi || []).slice(0, 1), hg: (e.q.hg || []).slice(0, 2) }, a: cut(e.a), ...(e.task ? { task: e.task } : {}), ...(e.sel ? { sel: e.sel } : {}) });\n"
  + "  const ways = new Map(bank.map(e => [e.id, ((e.q || {}).en || []).length]));\n"
  + "  const backup = {};\n"
  + "  for (const e of bank) { if (e.p || !e.q || !e.a) continue; const t = e.tab || '_'; (backup[t] = backup[t] || []).push(slim(e)); }\n"
  + "  backup._ = (backup._ || []).sort((x, y) => ways.get(y.id) - ways.get(x.id)).slice(0, 40);\n"
  + "  const files = {};\n"
  + "  for (const [t, list] of Object.entries(backup)) {\n"
  + "    const ws = t === '_' ? [] : walks.filter(w => (w.steps || []).some(s => s.tab === t) || (w.from || []).some(id => list.some(e => e.id === id)));\n"
  + "    files['backup/' + t + '.json'] = Buffer.from(JSON.stringify({ answers: list, walks: ws }));\n"
  + "  }\n"
  + "  return { ...files, 'meera.js': file,");
rep("  for (const f of names) fs.writeFileSync(path.join(OUT, f), out[f]);",
    "  fs.mkdirSync(path.join(OUT, 'backup'), { recursive: true });\n"
  + "  for (const f of fs.readdirSync(path.join(OUT, 'backup'))) if (!names.includes('backup/' + f)) fs.unlinkSync(path.join(OUT, 'backup', f));   // a screen no longer in her answers\n"
  + "  for (const f of names) fs.writeFileSync(path.join(OUT, f), out[f]);");
fs.writeFileSync(BUILD, c);

const BR = path.join(ROOT, 'Replenish-App', 'src', 'app', 'core', 'meera-bridge.js');
let br = fs.readFileSync(BR, 'utf8');
const NL = '\r\n', a = '  learn: false,' + NL;
if (br.split(a).length !== 2) throw new Error('bridge');
br = br.replace(a, a + '  /* Phase 5 — her search on her router: "server" side by side (she answers as before; the router\'s answer is only' + NL
  + '   * compared), "serveruse" answers from the router (no 1.9 MB download; a small list per screen when it is down). */' + NL
  + '  server: false,' + NL + '  serveruse: false,' + NL);
fs.writeFileSync(BR, br);
console.log('ok');
