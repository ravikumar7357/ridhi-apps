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

