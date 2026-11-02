/* MEERA'S ANSWERS KEEP UP WITH THE ERP (switch "autobank", Ravi 2 Nov 2026; off for everyone).
 *
 * Compares the screens as they are now (meera/tools/catalog.cjs reads them from Replenish-App/src) with the screens as
 * her answers last saw them (meera/bank/catalog.json), and:
 *   NEW part (button, tab, column, box, option, hover note)  → a short "what is this" answer, made ONLY from its own
 *       label and the help text written on it, in English, Hindi and Hinglish (the screen's own words are quoted as they
 *       are, never translated or explained further). A part with no help text gets "nothing is written on it yet", and
 *       a draft for an admin to write what it does.
 *   CHANGED label (same box, new name)                        → the answer's name and ways of asking follow it.
 *   REMOVED part                                              → its answer is taken out; any other answer or
 *       walk-through that pointed at it is flagged (never changed).
 *   NEW screen or NEW job (a function that saves)             → never written into her answers: a draft answer and
 *       walk-through for the admin page ("Meera's learning" → Drafts), to approve.
 *   Hand-written answers are never changed — only flagged.
 *
 *   node meera/tools/autobank.cjs                report only: what it would do (always, whatever the switch)
 *   node meera/tools/autobank.cjs --apply        do it, if the switch is on (MEERA_SWITCHES.autobank, or --force)
 *   node meera/tools/autobank.cjs --snapshot     record the screens as they are now as "seen" (first run, or after a
 *                                                change was taken in by hand)
 *   --app <Replenish-App>  --bank <meera-bank.json>  --walks <meera-walks.json>  --state <folder>   another copy (tests)
 *   --ci                   also write the report to GitHub's job summary
 * The gate (580 golden answers, every score) checks the result like any other change. */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { read } = require('./catalog.cjs');
const ROOT = path.join(__dirname, '..', '..');
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const has = n => process.argv.includes(n);
const APP = arg('--app') || path.join(ROOT, 'Replenish-App');
const BANK = arg('--bank') || path.join(APP, 'public/guide/meera-bank.json');
const WALKS = arg('--walks') || path.join(APP, 'public/guide/meera-walks.json');
const STATE = arg('--state') || path.join(ROOT, 'meera/bank');
const SNAP = path.join(STATE, 'catalog.json'), DRAFTS = path.join(STATE, 'drafts.json'), CHANGES = path.join(STATE, 'CHANGES.md');
const TODAY = new Date().toISOString().slice(0, 10);

const SCREEN = { shop: 'Shopify Orders', ord: 'Order Console', pack: 'Packing List', fgi: 'Finished Goods', pbase: 'Job Work Register', flow: 'Production flow', qc: 'Quality Control', fba: 'FBA Dispatch', pmdb: 'Master Database', att: 'Attendance', rep: 'Reports', so: 'Sales Orders', cx: 'Customer Orders', top: 'Top ASIN Status', fab: 'Fabric Inventory', repl: 'Replenishment', dash: 'Dashboard', pcut: 'Cutting Data', hr: 'Finance & HR', vord: 'Vendor Orders', acc: 'Accessories', adj: 'Adjustments', shopify: 'Shopify Stock', india: 'India Stock', article: 'Article Review', target: 'Revenue Target', follow: 'Ongoing Purchase Order', prod: 'In Production', ppress: 'Press Inventory', mst: 'Masters', vreq: 'Vendor Order Requests', rfd: 'RFD Requirements', vend: 'Vendor Portal', vlog: 'History', palloc: 'Printer Allocation', pa: 'Production Analysis', ka: 'Karigar Analysis', gdesk: 'Greige Desk' };
const scr = t => SCREEN[t] || t || 'every screen';
/* a part is the same part when its kind (a tab is a button), screen and label are — as the 26 Oct catalogue counted them */
const same = (kind, tab, label) => (kind === 'tab' ? 'button' : kind) + '|' + (tab || '') + '|' + String(label).toLowerCase().slice(0, 90);
const bankKey = e => same(e.p[1], e.tab, e.p[0]);
/* her switch, as the ERP holds it */
function switchOn() {
  if (has('--force')) return true;
  const s = fs.readFileSync(path.join(APP, 'src/app/core/meera-bridge.js'), 'utf8');
  return /^\s*autobank:\s*true\b/m.test(s);
}

/* ---- the answer for a new part: its label and the screen's own help text, nothing more ---- */
function partAnswer(p) {
  const help = p.help;
  const en = help ? `The screen says: “${help}”` : 'Nothing is written on it yet — ask your admin what it does.';
  const hi = help ? `स्क्रीन पर लिखा है: “${help}”` : 'इस पर अभी कुछ लिखा नहीं है — यह क्या करता है, एडमिन से पूछें।';
  const hg = help ? `Screen par likha hai: “${help}”` : 'Is par abhi kuch likha nahi hai — ye kya karta hai, admin se poochiye.';
  const id = 'c-' + (p.tab || 'any') + '-a' + crypto.createHash('sha1').update(p.k).digest('hex').slice(0, 6);
  const e = { id, tab: p.tab || '', p: [p.label, p.kind, en, hi, hg].concat(p.id && p.kind !== 'note' ? ['#' + p.id] : []), auto: TODAY };
  return e;
}

function compare(seen, now) {
  const before = new Map(seen.parts.map(p => [p.k, p])), after = new Map(now.parts.map(p => [p.k, p]));
  let added = now.parts.filter(p => !before.has(p.k)), gone = seen.parts.filter(p => !after.has(p.k));
  /* the same box with a new name: a part that went and one that came with the same element id on the same screen */
  const renamed = [];
  gone = gone.filter(g => {
    if (!g.id) return true;
    const n = added.find(a => a.id === g.id && a.tab === g.tab && (a.kind === g.kind || (a.kind === 'tab') === (g.kind === 'tab')));
    if (!n) return true;
    renamed.push({ from: g, to: n });
    added = added.filter(a => a !== n);
    return false;
  });
  /* a new hover note that is only the help text of a new part beside it is that part's help, not a part of its own */
  const helps = new Set(now.parts.filter(p => p.help).map(p => p.at + '|' + p.help.toLowerCase()));
  added = added.filter(a => !(a.kind === 'note' && helps.has(a.at + '|' + a.label.toLowerCase())));
  const helpsWas = new Set(seen.parts.filter(p => p.help).map(p => p.at + '|' + p.help.toLowerCase()));
  gone = gone.filter(g => !(g.kind === 'note' && !g.bank && helpsWas.has(g.at + '|' + g.label.toLowerCase())));
  const sc = new Set(seen.screens.map(s => s.tab)), jb = new Set(seen.jobs.map(j => j.fn));
  return { added, gone, renamed, screens: now.screens.filter(s => !sc.has(s.tab)), jobs: now.jobs.filter(j => !jb.has(j.fn)) };
}

/* who points at an element (#id): answers' Show me, and walk-through steps */
function pointers(bank, walks, id) {
  if (!id) return [];
  const re = new RegExp('#' + id.replace(/[-]/g, '\\-') + '(?![\\w-])');
  const out = [];
  for (const e of bank) if ((e.sel && re.test(e.sel)) || (e.p && e.p[5] && re.test(e.p[5]))) out.push(`answer ${e.id}`);
  for (const w of walks) (w.steps || []).forEach((s, i) => { if ((s.sel && re.test(s.sel)) || (s.skip && re.test(s.skip))) out.push(`walk-through ${w.id} step ${i + 1}`); });
  return out;
}

/* a draft for a new job: the buttons that start it, by their own labels — never how it works */
function jobDraft(j, app, now) {
  const src = [path.join(app, 'src/index.html')].concat(walkJs(path.join(app, 'src/app'))).map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const ids = [...src.matchAll(new RegExp(`\\$\\('([\\w-]+)'\\)\\.onclick\\s*=\\s*(?:\\(\\)\\s*=>\\s*)?${j.fn}\\b`, 'g'))].map(m => m[1]);
  const btns = now.parts.filter(p => p.id && ids.includes(p.id));
  const b = btns[0];
  return {
    key: 'job|' + j.fn, kind: 'job', tab: j.tab, at: j.at, made: TODAY,
    what: `A new job that saves on ${scr(j.tab)} (${j.fn}, ${j.at})` + (b ? `, started by the “${b.label}” button.` : '. The button that starts it was not found by name.'),
    answer: b ? { q: { en: [`how to ${b.label.toLowerCase()}`, `${b.label} kaise kare`] }, a: { en: `On <b>${scr(j.tab)}</b>, press <b>${b.label}</b>.` } } : null,
    walk: b ? { title: { en: b.label }, steps: [{ tab: j.tab, en: `Open <b>${scr(j.tab)}</b>.` }, { tab: j.tab, sel: '#' + b.id, en: `Press <b>${b.label}</b>.`, save: true }] } : null,
    note: 'Draft from the screen\'s labels only — an admin writes what the job does, its boxes and its rules before it goes into her answers.',
  };
}
const walkJs = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => (x.isDirectory() ? walkJs(path.join(d, x.name)) : x.name.endsWith('.js') ? [path.join(d, x.name)] : []));

function run() {
  const now = read(APP);
  if (has('--snapshot') || !fs.existsSync(SNAP)) {
    const bank = JSON.parse(fs.readFileSync(BANK, 'utf8'));
    const ans = new Map(bank.filter(e => e.p).map(e => [bankKey(e), e.id]));
    const snap = { made: TODAY, parts: now.parts.map(p => ({ ...p, bank: ans.get(same(p.kind, p.tab, p.label)) || '' })), screens: now.screens, jobs: now.jobs };
    fs.writeFileSync(SNAP, JSON.stringify(snap, null, 0).replace(/\},\{/g, '},\n{') + '\n');
    const stale = bank.filter(e => e.p && !now.parts.some(p => same(p.kind, p.tab, p.label) === bankKey(e)));
    /* on the admin page: answers about a label no screen shows now (renamed or taken out before autobank) — an admin
     * decides; none is removed by itself */
    const old = fs.existsSync(DRAFTS) ? JSON.parse(fs.readFileSync(DRAFTS, 'utf8')).filter(x => x.kind !== 'stale') : [];
    fs.writeFileSync(DRAFTS, JSON.stringify(old.concat(stale.map(e => ({ key: 'stale|' + e.id, kind: 'stale', tab: e.tab || '', at: '', made: TODAY,
      what: `Answer ${e.id} is about the ${e.p[1]} “${e.p[0]}” on ${scr(e.tab)}, which no screen shows by that name now — keep, reword or take out.` })) ), null, 1) + '\n');
    console.log(`autobank: the screens as they are now are recorded as seen (${now.parts.length} parts, ${now.screens.length} screens, ${now.jobs.length} jobs that save) → ${path.relative(ROOT, SNAP)}`);
    console.log(`  ${stale.length} part answers name a label no screen shows now — listed for an admin, not removed`);
    return;
  }
  const seen = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const d = compare(seen, now);
  const bank = JSON.parse(fs.readFileSync(BANK, 'utf8')), walks = JSON.parse(fs.readFileSync(WALKS, 'utf8'));
  const byId = new Map(bank.map(e => [e.id, e]));
  const lines = [], drafts = [], flags = [];
  const ansOf = p => p.bank || (bank.find(e => e.p && bankKey(e) === same(p.kind, p.tab, p.label)) || {}).id || '';
  const plan = { add: [], rename: [], remove: [] };
  for (const p of d.added) {
    const e = partAnswer(p);
    plan.add.push(e);
    lines.push(`NEW ${p.kind} “${p.label}” on ${scr(p.tab)} — answer ${e.id} added from ${p.help ? 'its label and the help text on it' : 'its label only (no help text on the screen)'}`);
    if (!p.help) drafts.push({ key: 'part|' + p.k, kind: 'part', tab: p.tab, at: p.at, made: TODAY, what: `New ${p.kind} “${p.label}” on ${scr(p.tab)} has no help text: write one line on what it does.`, answer: { id: e.id } });
  }
  for (const { from, to } of d.renamed) {
    const id = ansOf(from), e = id && byId.get(id);
    if (e && e.p) { plan.rename.push({ e, to }); lines.push(`CHANGED ${from.kind} on ${scr(from.tab)}: “${from.label}” → “${to.label}” — answer ${id} now uses the new name${e.auto && to.help !== from.help ? ' and its new help text' : ''}`); }
    else if (e) { flags.push(`answer ${id} is about “${from.label}”, now called “${to.label}” on ${scr(from.tab)} — written by hand, check its wording`); }
    else { const n = partAnswer(to); plan.add.push(n); lines.push(`CHANGED ${from.kind} on ${scr(from.tab)}: “${from.label}” → “${to.label}” (it had no answer) — answer ${n.id} added`); }
    pointers(bank, walks, from.id).filter(x => x !== `answer ${id}`).forEach(x => flags.push(`${x} points at “${from.label}”, now “${to.label}” — check its words`));
  }
  for (const g of d.gone) {
    const id = ansOf(g), e = id && byId.get(id);
    if (e && e.p) { plan.remove.push(e); lines.push(`REMOVED ${g.kind} “${g.label}” from ${scr(g.tab)} — answer ${id} taken out`); }
    else if (e) flags.push(`answer ${id} is about “${g.label}”, which is no longer on ${scr(g.tab)} — written by hand, not removed`);
    pointers(bank, walks, g.id).filter(x => x !== `answer ${id}`).forEach(x => flags.push(`${x} pointed at “${g.label}” (#${g.id}), no longer on ${scr(g.tab)}`));
  }
  for (const s of d.screens) drafts.push({ key: 'screen|' + s.tab, kind: 'screen', tab: s.tab, at: s.at, made: TODAY,
    what: `A new screen (${s.pane}, ${s.at}). Draft: what it is for and a walk round it — an admin writes it from the screen.`,
    answer: { q: { en: [`what is ${scr(s.tab)}`] }, a: { en: `<b>${scr(s.tab)}</b> — a new screen.` } },
    walk: { title: { en: `Round ${scr(s.tab)}` }, steps: now.parts.filter(p => p.tab === s.tab && p.id && p.kind !== 'note').slice(0, 8).map(p => ({ tab: s.tab, sel: '#' + p.id, en: `<b>${p.label}</b>` })) } });
  for (const j of d.jobs) drafts.push(jobDraft(j, APP, now));
  d.screens.forEach(s => lines.push(`NEW screen ${s.pane} — not written into her answers: a draft is on the admin page`));
  d.jobs.forEach(j => lines.push(`NEW job ${j.fn} on ${scr(j.tab)} — not written into her answers: a draft is on the admin page`));

  const on = switchOn(), apply = has('--apply') && on;
  const head = `Meera autobank — ${TODAY}: ${d.added.length} new part(s), ${d.renamed.length} renamed, ${d.gone.length} removed, ${d.screens.length} new screen(s), ${d.jobs.length} new job(s)`
    + (has('--apply') ? (on ? ' — applied' : ' — switch "autobank" is off: nothing changed') : ' — report only');
  const report = [head, ...lines.map(l => '  • ' + l), ...(flags.length ? ['  To check by hand:', ...flags.map(f => '    – ' + f)] : []), ...(drafts.length ? [`  Drafts for the admin page: ${drafts.length}`] : [])].join('\n');
  console.log(report);
  if (has('--ci') && process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### ' + head + '\n\n' + lines.map(l => '- ' + l).join('\n') + (flags.length ? '\n\n**To check by hand**\n\n' + flags.map(f => '- ' + f).join('\n') : '') + '\n');
  if (!apply) return;
  if (!d.added.length && !d.gone.length && !d.renamed.length && !d.screens.length && !d.jobs.length) return;   // nothing new: no files touched (no pull request)

  /* apply: her answers, the drafts, the screens as now seen, and the CHANGES list */
  const rm = new Set(plan.remove.map(e => e.id));
  for (const { e, to } of plan.rename) { e.p[0] = to.label; if (e.auto) { const n = partAnswer(to); e.p.splice(2, 3, n.p[2], n.p[3], n.p[4]); } }
  const out = bank.filter(e => !rm.has(e.id));
  for (const e of plan.add) if (!out.some(x => x.id === e.id)) out.push(e);
  fs.writeFileSync(BANK, JSON.stringify(out) + '\n');
  const old = fs.existsSync(DRAFTS) ? JSON.parse(fs.readFileSync(DRAFTS, 'utf8')) : [];
  const keep = old.filter(x => !drafts.some(y => y.key === x.key));
  fs.writeFileSync(DRAFTS, JSON.stringify(keep.concat(drafts), null, 1) + '\n');
  const ans = new Map(out.filter(e => e.p).map(e => [bankKey(e), e.id]));
  fs.writeFileSync(SNAP, JSON.stringify({ made: TODAY, parts: now.parts.map(p => ({ ...p, bank: ans.get(same(p.kind, p.tab, p.label)) || '' })), screens: now.screens, jobs: now.jobs }).replace(/\},\{/g, '},\n{') + '\n');
  if (lines.length || flags.length) fs.appendFileSync(CHANGES, `\n## ${head}\n\n` + lines.map(l => '- ' + l).join('\n') + (flags.length ? '\n- To check by hand:\n' + flags.map(f => '  - ' + f).join('\n') : '') + '\n');
}
run();
