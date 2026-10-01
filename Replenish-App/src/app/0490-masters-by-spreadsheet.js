/* ================= MASTERS BY SPREADSHEET =================
 *
 * Ravi, 2026-09-21, looking at 37 fabric types with a width box and a greige box each: "i need excel
 * template in every where". Every simple master list can be downloaded, filled in Excel and read back.
 * The file is read by column NAME, so the columns can be in any order; "In records" is there to
 * decide with and is read back for nothing. Nothing is written until the preview has been seen.
 *
 * THE SAME RULES AS THE EDIT BOX: a code and a name, one code per row, a parent that exists, a width in
 * inches, one greige name per fabric, and a parent is not retired while its children are in use.
 */
const MST_SHEET_OFF = ['ruffleRule', 'printRule'];   // drawn as rules, not as code-and-name lists

function mstSheetCols(key) {
  const def = mstDef(key);
  return ['Code', 'Name'].concat(def[3] ? ['Belongs to'] : [])
    .concat(key === 'fabricType' ? ['Width (inches)', 'Greige name'] : [])
    .concat(key === 'colour' ? ['Printed'] : [])
    .concat(['State', 'In records']);
}

/** The list as it stands, one row per entry — the template IS the current list, ready to change. */
function mstSheetRows(key) {
  const def = mstDef(key);
  const rows = [mstSheetCols(key)];
  mstRows(key).slice().sort((a, b) => String(a.desc || a.code || '').localeCompare(String(b.desc || b.code || '')))
    .forEach(r => rows.push([r.code, r.desc].concat(def[3] ? [r.parentCode || ''] : [])
      .concat(key === 'fabricType' ? [r.widthIn == null ? '' : r.widthIn, r.greige || ''] : [])
      .concat(key === 'colour' ? [r.noPrint === true ? 'no' : 'yes'] : [])
      .concat([r.active === false ? 'retired' : 'in use', mstUsage(key, r.desc || r.code)])));
  return rows;
}

/**
 * What a filled sheet would do. Returns { err } or { set, skip }.
 * set: [{ k, row, isNew, changes: [text], used }]   skip: [{ row, why }]
 */
function mstSheetPlan(key, rows) {
  if (MST_SHEET_OFF.indexOf(key) >= 0) return { err: 'This list is a set of rules, not codes and names — change it on the screen.' };
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const def = mstDef(key);
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  const at = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const iC = at(['code']), iN = at(['name', 'desc', 'description']);
  if (iC < 0 || iN < 0) return { err: 'The file needs Code and Name columns. Download the template to see them.' };
  const iP = at(['belongs to', 'parent', 'parent code']);
  const iW = at(['width (inches)', 'width', 'width in']);
  const iG = at(['greige name', 'greige']);
  const iPr = at(['printed', 'printed?']);
  const iS = at(['state', 'status', 'active']);
  const cur = mstRows(key);
  const byCode = new Map(cur.map(r => [String(r.code || '').trim().toLowerCase(), r]));
  const parents = def[3] ? mstRows(def[3]) : null;
  const set = [], skip = [], seen = new Map(), greigeTaken = new Map();
  /* One greige name, one fabric — counting what the file itself says, not only what is saved. */
  if (key === 'fabricType') cur.forEach(r => { if (String(r.greige || '').trim()) greigeTaken.set(String(r.greige).trim().toLowerCase(), String(r.code).trim().toLowerCase()); });
  let nextN = null;
  const newKey = () => {
    if (nextN === null) {
      const ks = Object.keys((PTG.masters || {})[key] || {});
      const ns = ks.map(k => (/^r(\d+)$/.test(k) ? +k.slice(1) : -1));
      nextN = ks.length && ns.every(n => n >= 0) ? Math.max(...ns) + 1 : (ks.length ? -1 : 0);
    }
    if (nextN < 0) return 'm_' + Date.now().toString(36) + '_' + set.length;
    return 'r' + (nextN++);
  };
  const now = new Date().toISOString();
  for (let i = 1; i < rows.length; i++) {
    const cell = j => (j >= 0 && rows[i][j] != null ? String(rows[i][j]).trim() : '');
    const code = cell(iC), desc = cell(iN), line = i + 1;
    if (!code && !desc) continue;
    if (!code) { skip.push({ row: line, why: 'no code.' }); continue; }
    const ck = code.toLowerCase();
    if (seen.has(ck)) { skip.push({ row: line, why: `code ${code} is also on row ${seen.get(ck)}.` }); continue; }
    seen.set(ck, line);
    if (!desc) { skip.push({ row: line, why: `${code} has no name.` }); continue; }
    const r = byCode.get(ck);
    /* The code is how the row is FOUND — matched without regard to case, and kept as it was written. */
    const row = Object.assign({}, r || { createdAt: now, createdBy: ME.email }, { code: r ? r.code : code, desc });
    delete row._key;
    const changes = [];
    if (r && String(r.desc || '') !== desc) changes.push(`name ${r.desc || '—'} → ${desc}`);
    if (def[3] && iP >= 0) {
      const pc = cell(iP);
      const p = pc && parents.find(x => String(x.code).trim().toLowerCase() === pc.toLowerCase() && x.active !== false);
      if (!p) { skip.push({ row: line, why: `${code}: "${pc || 'nothing'}" is not a ${mstDef(def[3])[1].toLowerCase()} in use.` }); continue; }
      if (String(r ? r.parentCode : '') !== String(p.code)) changes.push(`belongs to ${p.code}`);
      row.parentCode = p.code;
    } else if (def[3] && !r) { skip.push({ row: line, why: `${code}: say which ${mstDef(def[3])[1].toLowerCase()} it belongs to.` }); continue; }
    if (key === 'fabricType' && iW >= 0) {
      const t = cell(iW), w = parseFloat(t);
      if (t && !(w > 0 && w <= 200)) { skip.push({ row: line, why: `${code}: width "${t}" is not inches between 1 and 200.` }); continue; }
      const before = r && r.widthIn != null ? r.widthIn : '';
      if (t) row.widthIn = w; else delete row.widthIn;
      if (String(before) !== String(t ? w : '')) changes.push(t ? `width ${w}"` : 'width removed');
    }
    if (key === 'fabricType' && iG >= 0) {
      const g = cell(iG).replace(/\s+/g, ' ');
      const owner = g && greigeTaken.get(g.toLowerCase());
      if (owner && owner !== ck) { skip.push({ row: line, why: `${code}: greige "${g}" already belongs to ${owner.toUpperCase()}.` }); continue; }
      if (r && r.greige && r.greige.toLowerCase() !== g.toLowerCase()) greigeTaken.delete(String(r.greige).toLowerCase());
      if (g) greigeTaken.set(g.toLowerCase(), ck);
      if (String((r && r.greige) || '') !== g) changes.push(g ? `greige ${g}` : 'greige removed');
      if (g) row.greige = g; else delete row.greige;
    }
    if (key === 'colour' && iPr >= 0 && cell(iPr)) {
      const t = cell(iPr).toLowerCase();
      const yes = /^(y|yes|printed|true|1)$/.test(t), no = /^(n|no|no printing|false|0)$/.test(t);
      if (!yes && !no) { skip.push({ row: line, why: `${code}: Printed has to be yes or no, not "${cell(iPr)}".` }); continue; }
      if ((r && r.noPrint === true) !== no) changes.push(no ? 'not printed' : 'printed');
      if (no) row.noPrint = true; else delete row.noPrint;
    }
    if (iS >= 0 && cell(iS)) {
      const t = cell(iS).toLowerCase();
      const off = /^(retired|no|inactive|off)$/.test(t), on = /^(in use|yes|active|on)$/.test(t);
      if (!off && !on) { skip.push({ row: line, why: `${code}: State has to be "in use" or "retired", not "${cell(iS)}".` }); continue; }
      if (off && r && r.active !== false) {
        const kids = MASTERS.filter(m => m[3] === key)
          .flatMap(m => mstRows(m[0]).filter(x => x.active !== false && String(x.parentCode) === String(r.code)));
        if (kids.length) { skip.push({ row: line, why: `${code}: ${nf(kids.length)} row(s) still belong to it — retire those first.` }); continue; }
      }
      if (r && (r.active !== false) !== on) changes.push(on ? 'back in use' : 'retired');
      row.active = on;
    } else if (!r) row.active = true;
    if (r && !changes.length) continue;                      // says what the screen already says
    row.modifiedAt = now; row.modifiedBy = ME.email;
    set.push({ k: r ? r._key : newKey(), row, isNew: !r, changes: r ? changes : ['new'],
      used: r && changes.some(c => /^name /.test(c)) ? mstUsage(key, r.desc || r.code) : 0 });
  }
  return { set, skip };
}

/** Write what the preview showed, in one go. */
async function mstSheetRun(key, plan) {
  if (!ME.admin) return 'Only an admin can change a master list.';
  const rows = (plan && plan.set) || [];
  if (!rows.length) return 'There is nothing to write.';
  const patch = {};
  rows.forEach(x => { patch['pt_masters/' + key + '/' + x.k] = x.row; });
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PTG.masters[key] = Object.assign({}, PTG.masters[key] || {});
  rows.forEach(x => { PTG.masters[key][x.k] = x.row; });
  if (key === 'fabricType') FABW_IX = { src: null, map: null };
  return '';
}

$('mstTpl').onclick = () => {
  const key = MST.key;
  if (MST_SHEET_OFF.indexOf(key) >= 0) return;
  ptDownload('master-' + key + '-template', mstSheetRows(key).map(r => r.map(csvCell).join(',')));
  $('mstMsg').className = 'muted';
  $('mstMsg').textContent = `The ${mstDef(key)[1].toLowerCase()} list, ready to fill in Excel. Change or add rows, save, and press Excel import. `
    + '"In records" is only there to help — it is not read back.';
};
$('mstImp').onclick = () => $('mstFile').click();
$('mstFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const key = MST.key, def = mstDef(key);
  const say = (t, bad) => { $('mstMsg').className = bad ? 'err' : 'muted'; $('mstMsg').textContent = t; };
  try {
    const rows = /\.xlsx$/i.test(file.name) ? await pkReadXlsx(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
    const plan = mstSheetPlan(key, rows);
    if (plan.err) return say(plan.err, true);
    if (!plan.set.length) return say(plan.skip.length
      ? `${nf(plan.skip.length)} row(s) refused, nothing written: ` + plan.skip.slice(0, 3).map(x => 'row ' + x.row + ': ' + x.why).join(' · ')
      : 'Every row in that file already says what the list says.', plan.skip.length > 0);
    const adds = plan.set.filter(x => x.isNew), edits = plan.set.filter(x => !x.isNew);
    const renamed = edits.filter(x => x.used > 0);
    ptOpenDialog({
      title: `Write these to ${def[1].toLowerCase()}?`,
      subtitle: `${nf(adds.length)} new · ${nf(edits.length)} changed` + (plan.skip.length ? ` · ${nf(plan.skip.length)} refused` : ''),
      note: renamed.length ? `${nf(renamed.length)} renamed row(s) are already used by records, which will keep the old name.` : '',
      html: '<div class="muted" style="font-size:12.5px;line-height:1.7">'
        + plan.set.slice(0, 25).map(x => `<b>${esc(x.row.code)}</b> ${esc(x.row.desc)}: ${esc(x.changes.join(', '))}`).join('<br>')
        + (plan.set.length > 25 ? `<br>…and ${nf(plan.set.length - 25)} more.` : '')
        + (plan.skip.length ? '<br><br><b style="color:var(--bad)">Refused, not written</b><br>'
          + plan.skip.slice(0, 10).map(x => 'row ' + x.row + ': ' + esc(x.why)).join('<br>') : '') + '</div>',
      saveLabel: `Write ${nf(plan.set.length)} row(s)`,
      onSave: async () => {
        const err = await mstSheetRun(key, plan);
        if (err) return err;
        renderMst();
        say(`${nf(plan.set.length)} row(s) written to ${def[1].toLowerCase()}.` + (plan.skip.length ? ` ${nf(plan.skip.length)} refused and left alone.` : ''));
        return '';
      },
    });
  } catch (err) { say('Could not read it: ' + (err.message || err), true); }
};

$('mstExport').onclick = () => {
  const key = MST.key, def = mstDef(key), rows = mstRows(key);
  if (!rows.length) return;
  ptDownload('master-' + key, [['Code', 'Name'].concat(def[3] ? ['Belongs to'] : [])
    .concat(['In records', 'State']).map(csvCell).join(',')]
    .concat(rows.map(r => [r.code, r.desc].concat(def[3] ? [r.parentCode] : [])
      .concat([mstUsage(key, r.desc || r.code), r.active === false ? 'retired' : 'in use']).map(csvCell).join(','))));
};

/* ================= REPORTS =================
 *
 * Five readings of data that already exists. Nothing here writes anything.
 *
 * TWO WAYS TO COUNT A PIECE, and every production report shows both. PRODUCTION-FACING is pieces off
 * the press. CUSTOMER-FACING divides by the pack size, because a pack of four sold once is one thing
 * a customer received and four things the floor made. Reporting only one of them makes either the
 * factory or the customer look wrong.
 *
 * A WEEK RUNS SUNDAY TO SATURDAY, and belongs to the month its SUNDAY falls in — so a week starting
 * 29 June stays wholly in June even though most of it is July. Splitting it would put half a week's
 * work in each month and make both look short.
 *
 * LEGACY ROWS ARE NOT PRODUCTION. A row marked `legacy` is opening stock carried in on the day the
 * system started; counting it as that week's output would invent a week nobody worked.
 */
let REP = { view: 'wpr', busy: false, at: '' };

async function ensureRep() {
  /* PT.base as well as the press: the week-on-week report is built on receipts now, and opening the
   * tab straight onto it would otherwise show an empty report rather than a loading one. */
  if (!PTG.mdb || !PTG.press || !PT.base) { REP.busy = true; renderRep(); await ptLoadGates(); REP.busy = false; REP.at = ptStamp(); }
  if (FGI.rows === null && $('repView').value === 'fgval') { try { FGI.rows = ptList(await ptGet('pt_fgiLedger')); } catch (e) { FGI.rows = []; } }
  if (REP_HEADS === null) { try { REP_HEADS = (await ptGet('pt_contractorHeads')) || {}; } catch (e) { REP_HEADS = {}; } }
  renderRep();
  /* The cut pieces that came from printers are vendor deliveries: read after the report is on screen. */
  if (VO.rows === null && ($('repView') || {}).value === 'wow') { try { await ensureVo(); renderRep(); } catch (e) { /* the tile says it is not read */ } }
}

const repPack = sku => { const m = mdbOf(sku);
  const n = parseInt(String((m && m.packOf) || '').replace(/[^0-9]/g, ''), 10); return n > 0 ? n : 1; };
const repAt = (sku, fallback) => { const m = mdbOf(sku);
  return (m && String(m.articleType || '').trim()) || String(fallback || '').trim() || '(unknown)'; };
const repBrand = sku => { const m = mdbOf(sku);
  return m ? String(m.brand || '').trim() : ''; };
const repBrands = () => [...new Set((PTG.mdb || []).map(r => String((r && r.brand) || '').trim()).filter(Boolean))].sort();

/* PILLOW INSERT IS TRACKED APART (Ravi, 2026-09-29: "pillow insert ko alag se track krna h is production report me add
 * nahi krna h"). It is filling, not stitching: the production report and its capacity figures leave it out, and it has a
 * line of its own. */
const repIsInsert = r => /pillow insert/i.test(repAt(r && r.sku, r && r.articleType));
/* An external contractor's pieces come back under one name for a whole team; their people are counted apart, from the
 * headcount Ravi gives at the end of the week (pt_contractorHeads/<week>/<name>). */
const REP_CONTRACTOR_RE = /pradeep/i;
let REP_HEADS = null;
const REP_DAYS = 6;
const repHeadKey = n => String(n || '').trim().toLowerCase().replace(/[.#$\[\]\/]/g, '').replace(/\s+/g, '_');
/** One week of work, pillow insert apart: in-house karigars and what each brought back, and each contractor. */
function repManpower(week, brand) {
  /* The week read in local time: "2026-09-20" on its own parses as UTC midnight, five and a half hours off. */
  const wp = String(week).split('-').map(Number), from = new Date(wp[0], wp[1] - 1, wp[2]).getTime(), to = new Date(wp[0], wp[1] - 1, wp[2] + 7).getTime();
  const kar = new Map(), con = new Map();
  let insert = 0;
  (PT.base || []).forEach(r => {
    if (!r) return;
    const pcs = ptNum(r.receivedPieces);
    if (!(pcs > 0)) return;
    if (brand && repBrand(r.sku) !== brand) return;
    const ms = r.receivingDate ? ptDtMs(r.receivingDate) : 0;
    if (!ms || ms < from || ms >= to) return;
    if (repIsInsert(r)) { insert += pcs; return; }
    const who = String(r.empName || '').trim() || '(no name)';
    const m = REP_CONTRACTOR_RE.test(who) ? con : kar;
    m.set(who, (m.get(who) || 0) + pcs);
  });
  const inPcs = [...kar.values()].reduce((a, b) => a + b, 0);
  const heads = (REP_HEADS || {})[week] || {};
  /* The contractor's number is the WEEK'S ATTENDANCE — each day's people added up (20 a day for 6 days = 120). Over the
   * working days it is the people a day; his pieces over that is what one person made in the week, and over the
   * attendance, in a day. The working days are 6 (Monday to Saturday) unless typed for the week. */
  const days = Number(heads._days) || REP_DAYS;
  const avg = kar.size ? inPcs / kar.size : 0;
  return { week, insert, days, people: kar.size, inPcs, avg, avgDay: avg / days,
    karigars: [...kar.entries()].sort((a, b) => b[1] - a[1]),
    contractors: [...con.entries()].map(([name, pcs]) => {
      const h = Number(heads[repHeadKey(name)]) || 0;
      return { name, pcs, heads: h, perDayPeople: h ? h / days : null, per: h ? pcs * days / h : null, perDay: h ? pcs / h : null };
    }) };
}

/* WHERE THE GAP IS (Ravi, 2026-09-29): "meri kami kaha h — cutting kam ho rhi h ya karigar". A karigar can make
 * REP_PER_DAY pieces a day (50 unless typed); the week's in-house karigars could have made karigars × that × working
 * days. What they did not make is split two ways:
 *   NO WORK   — karigar-days on which a karigar who worked this week had nothing in hand and was given nothing
 *               (from the issue date until the row closed), × the pieces a day;
 *   SPEED     — the rest: they had work and made less than the day's figure.
 * The supply beside it — what they held at the start, what they were given, what was cut — says whether the
 * cutting and issuing kept up. Pillow insert and the outside contractor are left out, as in the rest of the card. */
const REP_PER_DAY = 50;
/* WHAT IS CUT IN-HOUSE (Ravi, 2026-09-29: "cutting me jo article nahi aate h wo ye h — tablecloth, in ko chhodkar ruffle
 * tablecloth, piping scallop tablecloth; border napkin; table runner"). Those come already cut from the printer; everything
 * else goes through our cutting first. */
function repNeedsCutting(r) {
  const m = typeof mdbOf === 'function' ? mdbOf(r && r.sku) : null;
  const at = String((m && m.articleType) || (r && r.articleType) || ''), st = String((m && m.subtype) || (r && r.articleSubtype) || '');
  const t = at + ' ' + st;
  if (/table\s*runner/i.test(t)) return false;
  if (/border\s*napkin/i.test(t)) return false;
  if (/tablecloth/i.test(t)) return /ruffle|piping|scallop/i.test(st);
  return true;
}
const repPerDay = () => Number(((REP_HEADS || {})._settings || {}).perday) || REP_PER_DAY;   // saved under repHeadKey('perDay')
function repGap(week, brand) {
  const wp = String(week).split('-').map(Number), from = new Date(wp[0], wp[1] - 1, wp[2]).getTime(), DAY = 864e5, to = from + 7 * DAY;
  const heads = (REP_HEADS || {})[week] || {}, nDays = Number(heads._days) || REP_DAYS, T = repPerDay();
  const mine = r => r && !repIsInsert(r) && !REP_CONTRACTOR_RE.test(String(r.empName || '')) && (!brand || repBrand(r.sku) === brand);
  const rows = (PT.base || []).filter(mine);
  const byWho = new Map(), made = new Map();
  let issued = 0, held = 0, issuedCut = 0;
  rows.forEach(r => {
    const k = String(r.empName || '').trim() || '(no name)';
    (byWho.get(k) || byWho.set(k, []).get(k)).push(r);
    const im = ptDtMs(r.issueDate), rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0;
    if (rm && rm >= from && rm < to && ptNum(r.receivedPieces) > 0) made.set(k, (made.get(k) || 0) + ptNum(r.receivedPieces));
    if (im && im >= from && im < to) { issued += ptNum(r.issuePieces); if (repNeedsCutting(r)) issuedCut += ptNum(r.issuePieces); }
    if (im && im < from && (!rm || rm >= from)) held += ptNum(r.issuePieces);         // still out when the week began
  });
  /* The working days: Monday to Saturday of this week, as many as the week's working days, and none still to come. */
  const days = [];
  for (let i = 0; i < 7 && days.length < nDays; i++) { const d = new Date(wp[0], wp[1] - 1, wp[2] + i); if (d.getDay() !== 0 && d.getTime() <= Date.now()) days.push(d.getTime()); }
  const K = made.size, madeTot = [...made.values()].reduce((a, b) => a + b, 0);
  const empty = [], dayCounts = days.map(() => 0);
  made.forEach((_, k) => {
    const rs = byWho.get(k) || [];
    let n = 0;
    days.forEach((d, i) => {
      const busy = rs.some(r => { const im = ptDtMs(r.issueDate), rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0; return im && im < d + DAY && (!rm || rm >= d); });
      if (busy) dayCounts[i]++; else n++;
    });
    if (n) empty.push({ name: k, days: n, made: made.get(k) || 0 });
  });
  const emptyDays = empty.reduce((a, e) => a + e.days, 0);
  let cut = 0;
  (PT.cut || []).forEach(r => { const ms = r && ptDtMs(r.cutDate); if (ms && ms >= from && ms < to && !repIsInsert(r) && repNeedsCutting(r) && (!brand || repBrand(r.sku) === brand)) cut += ptNum(r.pieces); });
  const possible = K * T * days.length, short = Math.max(0, possible - madeTot);
  const noWork = Math.min(short, emptyDays * T), speed = Math.max(0, short - noWork);
  /* MANPOWER A DAY: on each working day, the karigars who had work in hand — 48 one day, 50 the next, 49 on average. */
  const personDays = dayCounts.reduce((a, b) => a + b, 0);
  return { week, perDay: T, days: days.length, karigars: K, made: madeTot, possible, short, noWork, speed,
    dayCounts, dayMs: days, personDays, perDayPeople: days.length ? personDays / days.length : 0, perPersonDay: personDays ? madeTot / personDays : 0,
    emptyDays, karigarDays: K * days.length, held, issued, issuedCut, issuedReady: issued - issuedCut, cut, available: held + issued,
    empty: empty.sort((a, b) => b.days - a.days || a.made - b.made) };
}

/** A SKU the factory makes itself, as the tool defines it. An unknown SKU counts in. */
function repInhouse(sku) {
  const m = mdbOf(sku);
  if (!m) return true;
  const at = String(m.articleType || '').trim().toLowerCase();
  return m.cuttingRequired !== false || m.isCustom === true || at === 'tablecloth' || at === 'table runner';
}

/* ---- weekly production, and its in-house twin ---- */
function repWeekly(yr, mo, brand, inhouseOnly) {
  const byWeek = {};
  (PTG.press || []).forEach(r => {
    if (!r || !r.entryDate || r.legacy === true) return;
    const ms = ptDtMs(r.entryDate); if (!ms) return;
    if (brand && repBrand(r.sku) !== brand) return;
    if (inhouseOnly && !repInhouse(r.sku)) return;
    if (repIsInsert(r)) return;                                // tracked apart (2026-09-29)
    const d = new Date(ms);
    const ws = new Date(d); ws.setDate(d.getDate() - d.getDay());       // the Sunday this week starts on
    if (ws.getFullYear() !== yr || ws.getMonth() + 1 !== mo) return;
    const wk = ws.getFullYear() + '-' + String(ws.getMonth() + 1).padStart(2, '0') + '-' + String(ws.getDate()).padStart(2, '0');
    const at = repAt(r.sku, r.articleType);
    byWeek[wk] = byWeek[wk] || {};
    byWeek[wk][at] = byWeek[wk][at] || { cust: 0, prod: 0 };
    const pcs = parseInt(r.pieces, 10) || 0;
    byWeek[wk][at].prod += pcs;
    byWeek[wk][at].cust += pcs / repPack(r.sku);
  });
  const weeks = Object.keys(byWeek).sort();
  const arts = [...new Set(weeks.flatMap(w => Object.keys(byWeek[w])))].sort((a, b) => a.localeCompare(b));
  return { weeks, byWeek, arts };
}

const repWeekLabel = iso => { const p = iso.split('-').map(Number); const d = new Date(p[0], p[1] - 1, p[2]);
  return String(d.getDate()).padStart(2, '0') + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]; };

