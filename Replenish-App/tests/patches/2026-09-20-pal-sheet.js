/* THE DESIGN SHEET: Ravi says which design goes in which group and which ones are still being made.
 *
 * "mujhe kon c design continue krni h kon c nahi m feed kru via excel and then tum auto decide krna
 * usme kitne sku h and kitna order open h etc but design or group me decide krunga via template."
 *
 * THE DIVISION OF LABOUR, WRITTEN DOWN. Two columns are his and nothing else is: the GROUP a design
 * belongs to, and whether it is still being made. Everything else on the sheet — how many SKUs carry
 * that colour, how much is on order, how much is still to make, what sold in ninety days, who is
 * printing it today — is worked out from the registers and is there to decide WITH, not to fill in.
 * It is read back for nothing, the same way the recipe sheet's "SKUs say" columns are.
 *
 * A DESIGN THAT IS NOT CONTINUING IS NOT HIDDEN. It stays on the screen with its figures, marked, and
 * its outstanding pieces stop counting towards what has to be made and stop being offered to a
 * printer. Dropping the row would lose the one thing somebody will ask later — how much was still
 * open when it was stopped.
 *
 * BOTH DECISIONS LIVE IN ONE RECORD. pt_colorGroups already holds { at, by, map }; the second map
 * goes beside it rather than into a node of its own — one write, one rule, and the two cannot end up
 * written by different people at different times and disagree about which designs exist.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

/* ---- 1. whether a design is still being made ---- */
one(`async function palSetGroup(designKey, name) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  const map = Object.assign({}, (PAL.groups || {}).map || {});
  const v = String(name == null ? '' : name).trim();
  /* Clearing it does not write an empty name — it drops the decision, and the guess comes back. */
  if (v) map[designKey] = v; else delete map[designKey];
  const rec = { at: new Date().toISOString(), by: ME.email, map };
  await ptPut('pt_colorGroups', rec);
  PAL.groups = rec;
  return '';
}`,
`/**
 * IS THIS DESIGN STILL BEING MADE?
 *
 * Everything is, until somebody says otherwise — a design that has never been mentioned must not
 * quietly drop out of the plan. Only an explicit false stops one.
 */
const palLiveOf = key => ((PAL.groups || {}).live || {})[key] !== false;

/** Both decisions in one record, so the two can never be written apart and disagree. */
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
}`, 'still being made');

/* ---- 2. the record keeps both maps when it is read ---- */
one(`    PAL.groups = { map: (g && g.map) || {}, at: (g && g.at) || '', by: (g && g.by) || '' };`,
`    PAL.groups = { map: (g && g.map) || {}, live: (g && g.live) || {}, at: (g && g.at) || '', by: (g && g.by) || '' };`, 'read back');

/* ---- 3. a stopped design stops being planned, and says so ---- */
one(`  return [...out.values()].map(d => Object.assign(d, {
    group: palGroupOf(d.brand, d.color),
    blocks: palBlocksNeed(d.key),
  })).sort((a, b) => b.toMake - a.toMake || b.skus - a.skus);`,
`  return [...out.values()].map(d => {
    /* A DESIGN NOBODY IS CONTINUING STOPS BEING WORK, BUT DOES NOT STOP BEING A ROW. Its outstanding
     * pieces are kept as an open figure — somebody will ask how much was still on order when it was stopped,
     * and a row that vanished cannot answer. */
    const live = palLiveOf(d.key);
    return Object.assign(d, {
      live, open: d.toMake, toMake: live ? d.toMake : 0,
      group: palGroupOf(d.brand, d.color),
      blocks: palBlocksNeed(d.key),
    });
  }).sort((a, b) => b.toMake - a.toMake || b.skus - a.skus);`, 'a stopped design');

/* ---- 4. the sheet ---- */
one(`/* ---- the screen ---- */
function renderPal() {`,
`/* ================= THE DESIGN SHEET =================
 *
 * Two columns are Ravi's: the group, and whether it is still being made. Every other column is
 * worked out from the registers and read back for nothing — it is there to decide WITH.
 */
const PAL_SHEET_COLS = ['Brand', 'Design', 'Group', 'Continue',
  'SKUs', 'Ordered', 'Still to make', 'Sold 90d', 'Blocks/design', 'Printing now'];

/** Every design there is, with what the registers say about it. */
function palSheetRows() {
  const rows = [PAL_SHEET_COLS];
  palDesigns().forEach(d => {
    rows.push([d.brand, d.color, d.group || '', d.live ? 'yes' : 'no',
      d.skus, Math.round(d.ordered), Math.round(d.open), Math.round(d.l90), d.blocks || '',
      [...d.now.keys()].join(' / ')]);
  });
  return rows;
}

/** Read a filled sheet back, by column name. */
function palSheetRead(rows) {
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  const at = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const iB = at(['brand']), iD = at(['design', 'colour', 'color']);
  const iG = at(['group', 'colour group', 'color group']), iC = at(['continue', 'still making', 'active']);
  if (iB < 0 || iD < 0) return { err: 'The file needs Brand and Design columns. Download the design sheet to see them.' };
  if (iG < 0 && iC < 0) return { err: 'The file has neither a Group nor a Continue column, so there is nothing in it to read.' };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const cell = j => (j >= 0 && rows[i][j] != null ? String(rows[i][j]).trim() : '');
    const brand = cell(iB), design = cell(iD);
    if (!brand && !design) continue;
    out.push({ row: i + 1, brand, design, group: cell(iG), cont: cell(iC), hasG: iG >= 0, hasC: iC >= 0 });
  }
  return { entries: out };
}

/** What the sheet would do, before anything is written. */
function palSheetPlan(entries) {
  const known = new Map(palDesigns().map(d => [d.key, d]));
  const set = [], skip = [], seen = new Map();
  (entries || []).forEach(e => {
    const key = palKey(e.brand, e.design);
    if (seen.has(key)) { skip.push({ row: e.row, key, why: 'the same brand and design is on row ' + seen.get(key) + ' as well.' }); return; }
    seen.set(key, e.row);
    const d = known.get(key);
    /* A DESIGN THE CATALOGUE HAS NEVER SEEN is a typo far more often than it is a new colour, and
     * inventing one here would put a group on something nothing can ever be made of. */
    if (!d) { skip.push({ row: e.row, key, why: 'no SKU in the catalogue is ' + (e.brand || '?') + ' ' + (e.design || '?') + '.' }); return; }
    if (e.hasG) {
      const want = e.group;
      if (want !== (d.group || '')) set.push({ row: e.row, key, d, field: 'group', from: d.group || '', to: want });
    }
    if (e.hasC && e.cont !== '') {
      const yes = /^(y|yes|true|1|continue|on)$/i.test(e.cont);
      const no = /^(n|no|false|0|stop|stopped|off)$/i.test(e.cont);
      if (!yes && !no) { skip.push({ row: e.row, key, why: 'Continue has to be yes or no, not "' + e.cont + '".' }); return; }
      if (yes !== d.live) set.push({ row: e.row, key, d, field: 'live', from: d.live ? 'yes' : 'no', to: yes ? 'yes' : 'no', on: yes });
    }
  });
  return { set, skip };
}

/**
 * Write what the plan showed, in ONE record.
 *
 * Both maps go together: written apart, a group edit landing between them would carry the old stop
 * list back over the new one.
 */
async function palSheetRun(plan) {
  if (!palCanEdit()) return PAL_NO_EDIT;
  const rows = (plan && plan.set) || [];
  if (!rows.length) return 'There is nothing to write.';
  const map = Object.assign({}, (PAL.groups || {}).map || {});
  const live = Object.assign({}, (PAL.groups || {}).live || {});
  rows.forEach(r => {
    if (r.field === 'group') { if (r.to) map[r.key] = r.to; else delete map[r.key]; }
    else if (r.on) delete live[r.key]; else live[r.key] = false;
  });
  try { await palPutGroups(map, live); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  return '';
}

/* ---- the screen ---- */
function renderPal() {`, 'the sheet');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
