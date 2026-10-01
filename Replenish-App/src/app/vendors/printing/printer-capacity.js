/* ================= WHAT A PRINTER CAN DO IN A MONTH, FROM WHAT THEY HAVE DONE =================
 *
 * The typed figures were badly wrong — one printer was down as 280 a month against 1,745 delivered
 * in a month. These read the delivery log instead.
 */

/** A delivery date, day-first or ISO, as the month it fell in. */
function palYm(v) {
  const t = String(v == null ? '' : v).trim();
  let m = t.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];
  m = t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/);
  return m ? m[3] + '-' + String(m[2]).padStart(2, '0') : '';
}
/** How much of the month we are in has gone — never 0, so nothing is ever divided by nothing. */
function palMonthPart(ym) {
  const now = new Date();
  const here = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  if (ym !== here) return 1;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, now.getDate()) / days;
}

/** Which vendor a printer is, by the code they were linked to or by their name. */
function palVendorOf(p) {
  if (!p) return '';
  const code = String(p.vendorCode || '').trim().toUpperCase();
  if (code) return code;
  const norm = x => String(x || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const want = norm(p.name);
  if (!want) return '';
  const hit = (voAllVendors ? voAllVendors() : []).find(v =>
    norm(v.name) === want || norm(v.desc) === want || norm(v.code) === want);
  return hit ? String(hit.code || '').toUpperCase() : '';
}

let PAL_DEL_IX = { src: null, n: -1, map: null };
/** Vendor code → month → pieces delivered. Built once per version of the vendor orders. */
function palDelivered() {
  const src = VO.rows || PT_NONE;
  if (PAL_DEL_IX.map && PAL_DEL_IX.src === src && PAL_DEL_IX.n === src.length) return PAL_DEL_IX.map;
  const map = new Map();
  src.forEach(o => {
    const code = String((o && o.vendorCode) || '').toUpperCase();
    if (!code) return;
    voLines(o || {}).forEach(l => voDels(l || {}).forEach(d => {
      const q = palNum(d && d.qty);
      if (!(q > 0)) return;
      const k = palYm(d.at || d.date || d.on);
      if (!k) return;
      if (!map.has(code)) map.set(code, new Map());
      const m = map.get(code);
      m.set(k, palNum(m.get(k)) + q);
    }));
  });
  PAL_DEL_IX = { src, n: src.length, map };
  return map;
}

/**
 * Pieces per table per month, from the best month this printer has managed.
 *
 * THE BEST MONTH, NOT THE AVERAGE: an average measures how much work we gave them. And the month we
 * are in is scaled up to the month it is on course for, because reading 20 days as 30 under-counts
 * a printer by a third.
 *
 * Tables are today's tables applied to past months — a printer who has just added ten of them will
 * read low until a month has run on the new number. That is the safe direction: it under-promises.
 *
 * NOT IN THE FIRST WEEK (2026-10-01): on the 1st, one day's deliveries were stretched x31 — 100 pcs read
 * as 3,100 a month, above every month the printer has really done. Until PAL_STRETCH_FROM days of the
 * month have run, the month counts as what it has delivered so far, unstretched.
 */
const PAL_STRETCH_FROM = 7;
function palRateOf(p) {
  const tables = palNum(p && p.tables);
  const code = palVendorOf(p);
  const months = code ? palDelivered().get(code) : null;
  if (!tables || !months || !months.size) return null;
  let best = 0, bestMonth = '', part = false;
  const early = new Date().getDate() < PAL_STRETCH_FROM;
  months.forEach((pcs, ym) => {
    const share = palMonthPart(ym);
    const full = share < 1 && early ? pcs : pcs / share;
    if (full > best) { best = full; bestMonth = ym; part = share < 1; }
  });
  if (!(best > 0)) return null;
  return { perTable: best / tables, month: bestMonth, partMonth: part, months: months.size, pcs: best };
}

/** The rate to lend a printer who has no history of their own: what the others manage. */
function palRateShared() {
  const all = palPrinters().map(palRateOf).filter(Boolean).map(r => r.perTable).sort((a, b) => a - b);
  if (!all.length) return 0;
  /* The middle one, not the average — one printer having a spectacular month must not raise
   * everybody else's capacity with it. */
  return all[Math.floor(all.length / 2)];
}

/**
 * WHAT THIS PRINTER CAN DO IN A MONTH, and how we know.
 *
 * Tables times the measured rate. Nothing here is typed unless nothing can be measured at all, and
 * the answer always says which of the three it is, because a capacity nobody can account for is one
 * nobody should plan against.
 */
function palCapacity(p) {
  const tables = palNum(p && p.tables);
  const own = palRateOf(p);
  const shared = palRateShared();
  /* TABLES TIMES THE FLOOR'S RATE - that is what makes adding a table mean something, and it is the
   * whole of "me table add kar dunga". A rate worked out FROM this printer's own tables and then
   * multiplied BY them cancels out, and tables would mean nothing at all.
   *
   * Their OWN best month is the floor under it: a printer who has proved they can do 1,745 is not
   * told they can do less because the average table is slower than theirs. */
  const byTables = tables > 0 && shared > 0 ? tables * shared : 0;
  const proven = own ? own.pcs : 0;
  if (byTables || proven) {
    return { pcs: Math.round(Math.max(byTables, proven)), from: byTables >= proven ? 'tables' : 'own',
      perTable: shared, proven: Math.round(proven), tables,
      months: own ? own.months : 0, month: own ? own.month : '', partMonth: !!(own && own.partMonth) };
  }
  return { pcs: Math.round(palNum(p && p.pcsMonth)), from: 'typed', perTable: 0, proven: 0, tables, months: 0 };
}
/** How the capacity was arrived at, for the cell that shows it. */
function palCapWhy(c) {
  if (!c) return '';
  if (c.from === 'tables') return nf(c.tables) + ' table(s) at ' + nf(Math.round(c.perTable))
    + ' pieces per table a month, which is what the printers with a delivery record manage.'
    + (c.proven ? ' Their own best month so far is ' + nf(c.proven) + '.' : ' Nothing delivered by them yet.');
  if (c.from === 'own') return 'Their own best month' + (c.partMonth ? ' so far, scaled to a full month' : '')
    + ' is ' + nf(c.proven) + ', which is more than ' + nf(c.tables) + ' table(s) at the usual rate. Over '
    + nf(c.months) + ' month(s) on record.';
  return 'Nothing to measure yet - no deliveries on record and no rate to borrow, so this is the figure '
    + 'that was typed in.';
}

/** A group only goes to a printer who has been given it. */
const palTakes = (p, g) => (Array.isArray(p && p.groups) ? p.groups : []).indexOf(g.name) >= 0;

const palScore = (p, g) => (g.now.has(p.name) ? 4 : 0) + (palGroupBlocks(p.key, g).have > 0 ? 2 : 0);

/**
 * How many printers each group needs, and which ones.
 *
 * Biggest group first, and inside a group the printer who already prints that colour, then the one
 * who already holds blocks for it, then whoever has the most room left. A group is filled until its
 * pieces are covered; what nobody can take is reported as short rather than quietly dropped —
 * that shortfall is the case for another printer or another month.
 */
function palPlan(designs) {
  const groups = palGroups(designs);
  const printers = palPrinters().filter(p => p.active !== false);
  /* MEASURED, NOT TYPED. What each printer can do in a month comes off the delivery log. */
  const cap = new Map(printers.map(p => [p.key, palCapacity(p)]));
  const free = new Map(printers.map(p => [p.key, palNum((cap.get(p.key) || {}).pcs)]));
  const rows = groups.map(g => {
    let left = Math.round(g.toMake);
    const picks = [];
    /* ONLY WHOEVER WAS GIVEN THIS GROUP. Who prints which colour is a relationship, not something to
     * work out from who happens to hold a block — that is how all three printers came back at 100%
     * on one group. A group nobody has been given goes to nobody, and says so. */
    const mine = printers.filter(p => palTakes(p, g));
    if (left > 0 && mine.length) {
      const order = mine.slice().sort((a, b) =>
        (palScore(b, g) - palScore(a, g))
        || (palNum(free.get(b.key)) - palNum(free.get(a.key)))
        || String(a.name || '').localeCompare(String(b.name || '')));
      for (const p of order) {
        if (left <= 0) break;
        const can = Math.max(0, palNum(free.get(p.key)));
        if (can <= 0) continue;
        const take = Math.min(can, left);
        const b = palGroupBlocks(p.key, g);
        picks.push({ key: p.key, name: p.name, pcs: take, need: b.need, have: b.have,
          gap: Math.max(0, b.need - b.have), knows: g.now.has(p.name) });
        free.set(p.key, can - take);
        left -= take;
      }
    }
    /* NOBODY HAS BEEN GIVEN IT is a different answer from EVERYBODY IS FULL, and the screen has to
     * be able to tell them apart — one is a decision waiting to be made, the other is a wall. */
    return { group: g, picks, short: left, unassigned: !printers.some(p => palTakes(p, g)) };
  });
  const load = new Map(printers.map(p => [p.key, 0]));
  rows.forEach(r => r.picks.forEach(pk => load.set(pk.key, palNum(load.get(pk.key)) + pk.pcs)));
  return { rows, free, load, printers, cap };
}

/* ---- reading and writing ---- */
async function palLoad() {
  PAL.busy = true;
  if (!PTG.mdb) await ptLoadGates();
  try {
    const [g, p, n, h] = await Promise.all([
      ptGet('pt_colorGroups'), ptGet('pt_printers'), ptGet('pt_blockNeed'), ptGet('pt_blockHave'),
    ]);
    PAL.groups = { map: (g && g.map) || {}, live: (g && g.live) || {}, at: (g && g.at) || '', by: (g && g.by) || '' };
    PAL.need = { map: (n && n.map) || {}, info: (n && n.info) || {}, at: (n && n.at) || '', by: (n && n.by) || '' };
    PAL.have = h || {};
    PAL.printers = Object.entries(p || {}).map(([key, v]) => Object.assign({ key }, v));
    PAL.err = '';
  } catch (e) {
    PAL.err = e.message || String(e);
    PAL.groups = PAL.groups || { map: {} }; PAL.need = PAL.need || { map: {} };
    PAL.have = PAL.have || {}; PAL.printers = PAL.printers || [];
  }
  PAL.busy = false; PAL.at = ptStamp();
}
async function ensurePal() {
  if (PAL.printers === null) { PAL.busy = true; renderPal(); await palLoad(); }
  /* What each colour sold comes from the snapshot rows. A slim copy written before 26 Sep has no last90; until the
   * next snapshot writes one, an account allowed the full copy reads that instead. */
  if (replFull() && !['SP', 'CPC'].some(b => REPL[b] && (REPL[b].rows || []).some(r => r && r.last90 != null))) {
    try { await loadReplCache(true); } catch (e) { /* the designs still draw, without sales */ }
  }
  /* Measured capacity comes from the delivery log; this tab never needed it before. */
  if (!VO.rows) {
    try {
      const raw = (await ptGet('pt_vendorOrders')) || {};
      VO.rows = [];
      Object.entries(raw).forEach(([code, orders]) => Object.values(orders || {})
        .forEach(o => { if (o) VO.rows.push(Object.assign({ vendorCode: code }, o)); }));
    } catch (e) { VO.rows = VO.rows || []; }
  }
  renderPal();
}

/**
 * IS THIS DESIGN STILL BEING MADE?
 *
 * Everything is, until somebody says otherwise — a design that has never been mentioned must not
 * quietly drop out of the plan. Only an explicit false stops one.
 */
const palLiveOf = key => ((PAL.groups || {}).live || {})[key] !== false;

/** Both decisions in one record, so the two can never be written apart and disagree. */
/* ---- emptying what was fed, to feed it again (Ravi, 2026-09-25) ---- */
const PAL_CLEAR = [
  ['groups', 'Colour groups', () => Object.keys(((PAL.groups || {}).map) || {}).length],
  ['live', 'Removed colours (they come back on the list)', () => Object.keys(((PAL.groups || {}).live) || {}).length],
  ['need', 'Blocks, status and printer per design', () => new Set(Object.keys(((PAL.need || {}).map) || {}).concat(Object.keys(((PAL.need || {}).info) || {}))).size],
  ['have', 'Blocks each printer holds', () => Object.values(PAL.have || {}).reduce((t, m) => t + Object.keys(m || {}).length, 0)],
  ['printers', 'Printers and their capacity', () => (PAL.printers || []).length],
];
function palClearOpen() {
  if (!palCanEdit()) { $('palMsg').className = 'err'; $('palMsg').textContent = PAL_NO_EDIT; return; }
  ptOpenDialog({
    title: 'Delete printer allocation data',
    note: 'Everything but the removed colours is ticked — untick what should stay. There is no backup and no undo. '
      + 'The design rows themselves (ordered, to make, printing now) come from the order book and the master, so they stay.',
    fields: [
      { key: 'what', label: 'Delete these', type: 'multi', value: PAL_CLEAR.map(c => c[0]).filter(k => k !== 'live'), span: true,
        options: PAL_CLEAR.map(([k, l, n]) => [k, `${l} (${nf(n())})`]) },
    ],
    onSave: v => palClearRun(v.what || [], confirm('Delete the ticked printer allocation data? There is no backup and no undo.')),
    saveLabel: 'Delete',
  });
}
/* sure: true once the person has said yes. No backup file (Ravi, 2026-09-25: nothing in it is worth keeping). */
async function palClearRun(what, sure) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  const pick = (what || []).filter(k => PAL_CLEAR.some(c => c[0] === k));
  if (!pick.length) return 'Tick what to delete.';
  if (sure !== true) return 'Not deleted.';
  const has = k => pick.indexOf(k) >= 0;
  const patch = {};
  if (has('groups') || has('live')) {
    let g = {};
    try { g = (await ptGet('pt_colorGroups')) || {}; } catch (e) { return 'Not deleted: ' + (e.message || e); }
    const map = has('groups') ? {} : (g.map || {}), live = has('live') ? {} : (g.live || {});
    patch.pt_colorGroups = (Object.keys(map).length || Object.keys(live).length) ? { at: new Date().toISOString(), by: ME.email, map, live } : null;
  }
  if (has('need')) patch.pt_blockNeed = null;
  if (has('have')) patch.pt_blockHave = null;
  if (has('printers')) patch.pt_printers = null;
  try { await ptPatch(patch); } catch (e) { return 'Not deleted: ' + (e.message || e) + ' — nothing changed.'; }
  if ('pt_colorGroups' in patch) PAL.groups = patch.pt_colorGroups || { map: {}, live: {} };
  if (has('need')) PAL.need = { map: {} };
  if (has('have')) PAL.have = {};
  if (has('printers')) PAL.printers = [];
  renderPal();
  $('palMsg').className = 'muted';
  $('palMsg').textContent = 'Deleted: ' + PAL_CLEAR.filter(c => has(c[0])).map(c => c[1].toLowerCase()).join(', ')
    + '. Upload again with Design import (groups) and + Printer.';
  return '';
}

async function palPutGroups(map, live) {
  const rec = { at: new Date().toISOString(), by: ME.email, map, live };
  await ptPut('pt_colorGroups', rec);
  PAL.groups = rec;
  return '';
}

async function palSetGroup(designKey, name) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  const map = Object.assign({}, (PAL.groups || {}).map || {});
  const v = String(name == null ? '' : name).trim();
  /* Clearing it does not write an empty name — it drops the decision, and the guess comes back. */
  if (v) map[designKey] = v; else delete map[designKey];
  /* THE OTHER MAP IS CARRIED THROUGH. Writing the record without it would stop every design that
   * had been stopped, silently, on the next group edit. */
  return palPutGroups(map, Object.assign({}, (PAL.groups || {}).live || {}));
}

/** Stop a design, or start it again. Stopping writes false; starting drops the entry. */
async function palSetLive(designKey, on) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  const live = Object.assign({}, (PAL.groups || {}).live || {});
  if (on) delete live[designKey]; else live[designKey] = false;
  return palPutGroups(Object.assign({}, (PAL.groups || {}).map || {}), live);
}

async function palSetBlocks(designKey, blocks) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  const n = Math.max(0, Math.round(palNum(blocks)));
  const map = Object.assign({}, (PAL.need || {}).map || {});
  if (n) map[designKey] = n; else delete map[designKey];
  return palPutNeed(map, (PAL.need || {}).info || {});
}
/** The whole blocks record, both halves together — writing one without the other would wipe it. */
async function palPutNeed(map, info) {
  const rec = { at: new Date().toISOString(), by: ME.email, map, info };
  await ptPut('pt_blockNeed', rec);
  PAL.need = rec;
  return '';
}
/** Current blocks, status or the printer for one design. An empty value drops it. */
async function palSetInfo(designKey, field, value) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  if (['cur', 'status', 'printer'].indexOf(field) < 0) return 'Unknown field.';
  const info = Object.assign({}, (PAL.need || {}).info || {});
  const e = Object.assign({}, info[designKey] || {});
  const v = field === 'cur' ? Math.max(0, Math.round(palNum(value))) : String(value == null ? '' : value).trim();
  if (v === '' || v === 0) delete e[field]; else e[field] = v;
  if (Object.keys(e).length) info[designKey] = e; else delete info[designKey];
  return palPutNeed(Object.assign({}, (PAL.need || {}).map || {}), info);
}

/** Give every colour of a group to one printer — one write. '' clears them all. */
async function palSetGroupPrinter(keys, printer) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  const v = String(printer == null ? '' : printer).trim();
  const info = Object.assign({}, (PAL.need || {}).info || {});
  (keys || []).forEach(k => {
    const e = Object.assign({}, info[k] || {});
    if (v) e.printer = v; else delete e.printer;
    if (Object.keys(e).length) info[k] = e; else delete info[k];
  });
  return palPutNeed(Object.assign({}, (PAL.need || {}).map || {}), info);
}
/** How a group is split: printer → { colours, pieces }, and what is not given to anybody yet. */
function palGroupSplit(g) {
  const by = new Map(); let none = 0, noneN = 0;
  g.designs.forEach(d => {
    const pr = palInfoOf(d.key).printer || '';
    if (!pr) { none += d.toMake; noneN++; return; }
    const e = by.get(pr) || { printer: pr, colours: 0, pcs: 0 };
    e.colours++; e.pcs += d.toMake; by.set(pr, e);
  });
  return { parts: [...by.values()].sort((a, b) => b.pcs - a.pcs), none, noneN };
}

async function palSetHave(printerKey, designKey, blocks) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  if (!palPrinterOf(printerKey)) return 'That printer is not on the list.';
  const n = Math.max(0, Math.round(palNum(blocks)));
  const map = Object.assign({}, (PAL.have || {})[printerKey] || {});
  if (n) map[designKey] = n; else delete map[designKey];
  await ptPut('pt_blockHave/' + printerKey, map);
  PAL.have = Object.assign({}, PAL.have || {}, { [printerKey]: map });
  return '';
}

/** Add a printer, or change one. Capacity is pieces a month — Ravi's own unit; tables sit beside it. */
function palPrinterOpen(key) {
  if (!palCanEdit()) { $('palMsg').className = 'err'; $('palMsg').textContent = PAL_NO_EDIT; return; }
  const p = key ? palPrinterOf(key) : null;
  ptOpenDialog({
    title: p ? 'Printer' : 'Add a printer',
    subtitle: p ? p.name : '',
    note: (c => 'Capacity is worked out from what they have actually delivered — tables times their best '
      + 'month per table — so the only number to enter is the tables. ' + (p ? palCapWhy(c) + ' ' : '')
      + 'Which colour groups they take is your choice; a group nobody is given goes to nobody.')(p ? palCapacity(p) : null),
    fields: [
      { key: 'palName', label: 'Name', value: p ? p.name || '' : '', span: true },
      { key: 'palTables', label: 'Tables', type: 'number', min: 0, step: 1, value: p ? palNum(p.tables) : '' },
      /* THE VENDOR THEY ARE, because that is what the delivery log is keyed by. Guessed from the name
       * when it matches one, and correctable — a printer tied to the wrong vendor would be measured
       * on somebody else's work. */
      { key: 'palVendor', label: 'Vendor (for the delivery history)', type: 'select',
        value: p ? (p.vendorCode || palVendorOf(p) || '') : '',
        options: [['', '— not linked —']].concat(voAllVendors().map(v => [String(v.code || ''), String(v.name || v.code || '')])) },
      /* WHICH GROUPS THEY TAKE. Several at once, ticked — this is the allocation. */
      { key: 'palGroups', label: 'Colour groups this printer takes', type: 'multi', span: true,
        value: Array.isArray(p && p.groups) ? p.groups : [],
        options: palGroupNames() },
      { key: 'palCap', label: 'Capacity if there is nothing to measure yet', type: 'number', min: 0, step: 1, value: p ? palNum(p.pcsMonth) : '' },
      { key: 'palActive', label: 'Taking work', type: 'select', options: ['Yes', 'No'], value: p && p.active === false ? 'No' : 'Yes' },
      { key: 'palNote', label: 'Note', value: p ? p.note || '' : '', span: true },
    ],
    deleteWhat: p ? `${p.name} from the printer list` : '',
    onDelete: p ? (() => palPrinterDelete(key)) : null,
    onSave: v => palPrinterSave(key, v),
    saveLabel: p ? 'Save' : 'Add',
  });
}

async function palPrinterSave(key, v) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  const name = String((v && v.palName) || '').trim();
  if (!name) return 'Put in the printer\'s name.';
  const clash = (PAL.printers || []).find(p => p.key !== key && obUC(p.name) === obUC(name));
  if (clash) return `${name} is already on the list.`;
  const cap = Math.max(0, Math.round(palNum(v.palCap)));
  /* The ticked groups, and the vendor they are. Both are decisions, so both are stored as given. */
  const groups = (Array.isArray(v.palGroups) ? v.palGroups : []).map(String).filter(Boolean);
  const vendorCode = String(v.palVendor || '').trim().toUpperCase();
  const tables = Math.max(0, Math.round(palNum(v.palTables)));
  /* TABLES OR A TYPED CAPACITY — one of the two, because with neither there is nothing to plan
   * against. Tables are the one to want: the capacity is then measured and moves on its own. */
  if (!tables && !cap)
    return 'Put in how many tables this printer has — the capacity is worked out from that and what '
      + 'they have delivered. If they have never delivered anything, type a capacity instead.';
  const rec = { name, tables, pcsMonth: cap, groups, vendorCode,
    active: String(v.palActive || 'Yes') !== 'No', note: String(v.palNote || '').trim(),
    at: new Date().toISOString(), by: ME.email };
  const k = key || ('PRN-' + Date.now().toString(36).toUpperCase());
  await ptPut('pt_printers/' + k, rec);
  PAL.printers = (PAL.printers || []).filter(p => p.key !== k).concat([Object.assign({ key: k }, rec)]);
  renderPal();
  return '';
}

async function palPrinterDelete(key) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  const p = palPrinterOf(key);
  if (!p) return 'That printer is already gone.';
  await ptPut('pt_printers/' + key, null);
  /* The blocks were that printer's own record of what they hold; with the printer gone it means
   * nothing, and left behind it would count towards a name nobody can see. */
  await ptPut('pt_blockHave/' + key, null);
  PAL.printers = (PAL.printers || []).filter(x => x.key !== key);
  const have = Object.assign({}, PAL.have || {});
  delete have[key];
  PAL.have = have;
  renderPal();
  return '';
}

/** What one printer holds, design by design, for the colours they are given. */
function palBlocksOpen(key) {
  const p = palPrinterOf(key);
  if (!p) return;
  const plan = palPlan(palDesigns());
  const mine = [];
  plan.rows.forEach(r => { if (r.picks.some(x => x.key === key)) r.group.designs.forEach(d => mine.push({ d, group: r.group.name })); });
  const rows = mine.length ? mine : palDesigns().filter(d => d.toMake > 0).slice(0, 60).map(d => ({ d, group: d.group || '—' }));
  ptOpenDialog({
    title: `Blocks with ${p.name}`,
    subtitle: mine.length ? 'The designs this printer is given in the plan' : 'No allocation yet — the busiest designs',
    note: 'Two numbers per design: how many blocks the design takes, and how many this printer already '
      + 'has. The difference is what has to be made before they can print it.',
    html: `<div class="xlwrap" style="max-height:52vh"><table class="xl" id="palBlkTable">
        <thead><tr><th>Design</th><th>Group</th><th class="num">Needs</th><th class="num">Has</th><th class="num">To make</th></tr></thead>
        <tbody>${rows.map(({ d, group }) => {
          const has = palBlocksHave(key, d.key);
          return `<tr><td style="text-align:left">${esc(d.brand)} · ${esc(d.color)}</td>`
            + `<td style="text-align:left">${esc(group)}</td>`
            + `<td class="num"><input data-palneed="${esc(d.key)}" type="number" min="0" step="1" value="${d.blocks || ''}" style="width:70px"></td>`
            + `<td class="num"><input data-palhave="${esc(d.key)}" data-palprn="${esc(key)}" type="number" min="0" step="1" value="${has || ''}" style="width:70px"></td>`
            + `<td class="num">${d.blocks > has ? `<b class="err">${nf(d.blocks - has)}</b>` : '—'}</td></tr>`;
        }).join('')}</tbody></table></div>`,
    onSave: () => { renderPal(); return ''; },
    saveLabel: 'Done',
  });
}

