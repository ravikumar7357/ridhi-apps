/* ================= WHAT IS PRINTED, AND ON WHAT =================
 *
 * Not every open piece is a printing job. Some articles are never printed (a pillow insert is
 * filling), and some colours are never printed whatever the article (anything white). Before this,
 * the printer requirement counted every open piece and was therefore too big.
 *
 * A rule is per article type AND subtype, because "Napkin" alone cannot separate a Border Napkin —
 * which is cut — from a Plain one, which goes to the printer as running cloth.
 */
const ptPrintKey = (at, sub) => String(at || '').trim().toLowerCase() + '|' + String(sub || '').trim().toLowerCase();
const ptPrintRules = () => ptList((PTG.masters || {}).printRule).filter(Boolean);

/**
 * The rules keyed by article and subtype, built once per rule list.
 *
 * ptPrintRuleOf used to run ptList + filter + find on every call, and every open order line calls it
 * — 785 ms of a 1.6 second screen. Rebuilt when the list itself is replaced, which is what saving a
 * rule does, so an edit is picked up without anything having to remember to clear this.
 */
let PRULE_IX = { src: null, map: null };
function ptPrintRuleMap() {
  const src = (PTG.masters || {}).printRule;
  if (PRULE_IX.src === src && PRULE_IX.map) return PRULE_IX.map;
  const map = new Map();
  /* The FIRST rule for a key wins, exactly as .find() did — two rules for one subtype is a mistake
   * in the masters, and changing which one applies while fixing a slow screen would be a second. */
  ptPrintRules().forEach(r => { const k = ptPrintKey(r.articleType, r.subtype); if (!map.has(k)) map.set(k, r); });
  PRULE_IX = { src, map };
  return map;
}

/** The rule for a master row, or null when nobody has written one. */
function ptPrintRuleOf(m) {
  if (!m) return null;
  return ptPrintRuleMap().get(ptPrintKey(m.articleType, m.subtype)) || null;
}

/**
 * Colours that are never printed. Held on the colour master, because it is the colour that decides:
 * a White Scallop Pillow Cover and a Sage one are the same subtype and the same cloth.
 */
let CPRINT_IX = { src: null, set: null };
function noPrintColours() {
  const src = (PTG.masters || {}).colour;
  if (CPRINT_IX.src === src && CPRINT_IX.set) return CPRINT_IX.set;
  const out = new Set();
  ptList(src).forEach(r => {
    if (r && r.noPrint === true) [r.desc, r.code].forEach(x => {
      const k = String(x || '').trim().toLowerCase(); if (k) out.add(k);
    });
  });
  CPRINT_IX = { src, set: out };
  return out;
}
const ptColourPrints = colour => !noPrintColours().has(String(colour || '').trim().toLowerCase());

/**
 * Does this SKU go to a printer at all? Yes unless something says otherwise — an unruled article is
 * counted, and reported as unruled, rather than quietly dropped.
 */
function ptPrintNeeded(m) {
  if (!m) return true;
  if (!ptColourPrints(m.color)) return false;
  const r = ptPrintRuleOf(m);
  return !(r && r.print === false);
}

/** "Whichever cloth wastes least" — a rule, not a fabric name. */
const PRINT_BY_WIDTH = '*';

/**
 * The cloth it is printed on: the rule's, else whatever the master row already says.
 *
 * A rule set to "whichever wastes least" hands the question to the calculator, which is how one line
 * covers 60-wide off 62", 70-wide off 72" and 80-wide off 82" without three rules to keep in step.
 */
/**
 * The cloth a SKU is printed on, worked out once per kind of SKU rather than once per SKU.
 *
 * "Whichever wastes least" means running ptConsPlan, which lays the cut on every roll the factory
 * buys. That answer depends on the article, the subtype, the size and the row's own fabric and on
 * nothing else — so 4,973 master rows share a few hundred answers, and the printer forecast stops
 * doing the same geometry four thousand times.
 */
let PFAB_IX = { src: null, map: null };
function ptPrintFabric(m) {
  const src = PTG.masters || {};
  if (PFAB_IX.src !== src || !PFAB_IX.map) PFAB_IX = { src, map: new Map() };
  const key = ptPrintKey(m && m.articleType, m && m.subtype) + '|'
    + String((m && m.size) || '').trim().toLowerCase() + '|'
    + String((m && m.fabric) || '').trim().toLowerCase();
  const hit = PFAB_IX.map.get(key);
  if (hit !== undefined) return hit;
  const r = ptPrintRuleOf(m);
  const named = String((r && r.fabric) || '').trim();
  const out = named === PRINT_BY_WIDTH
    ? ((ptConsPlan(m) || {}).fabric || String((m && m.fabric) || '').trim())
    : String(named || (m && m.fabric) || '').trim();
  PFAB_IX.map.set(key, out);
  return out;
}

/** Running cloth or cut pieces — what the printer is actually handed. '' when nobody has said. */
function ptPrintIssueAs(m) {
  const r = ptPrintRuleOf(m);
  return String((r && r.issueAs) || '').trim();
}

$('ptmTable').addEventListener('click', e => {
  const b = e.target.closest('[data-rec-edit]');
  if (b) recipeEdit(b.getAttribute('data-rec-edit'));
});

$('ptmRecSeed').onclick = async () => {
  const plan = recipeSeedPlan();
  if (!plan.rows.length) {
    $('ptmMsg').className = 'muted';
    $('ptmMsg').textContent = 'Nothing to seed — every combination where the SKUs agree already has its recipe.'
      + (plan.skipped.length ? ` ${nf(plan.skipped.length)} field(s) are left because the SKUs contradict each other.` : '');
    return;
  }
  const fields = plan.rows.reduce((a, r) => a + r.filled, 0);
  /* SHOWN BEFORE IT IS WRITTEN, and the disagreements listed by name — they are the ones only Ravi
   * can settle, and burying them under a count is how they stay unsettled. */
  const byField = new Map();
  plan.skipped.forEach(x => byField.set(x.field, (byField.get(x.field) || 0) + 1));
  ptOpenDialog({
    title: 'Seed the recipes from the SKUs?',
    subtitle: `${nf(fields)} field(s) across ${nf(plan.rows.length)} combination(s)`,
    note: 'Only where every SKU that has said anything says the same thing. A recipe that is already '
      + 'set is never overwritten.',
    html: `<div class="muted" style="font-size:12.5px;line-height:1.7">`
      + (plan.skipped.length
        ? `<b style="color:var(--bad)">${nf(plan.skipped.length)} field(s) are NOT seeded</b> because the SKUs `
          + `contradict each other: ${esc([...byField].map(([f, n]) => (RECIPE_FIELDS.find(x => x[0] === f) || [f, f])[1] + ' (' + n + ')').join(', '))}. `
          + 'Those are on the screen in red, and only you can say which figure is right.<br><br>'
        : '')
      + `<b>What would be written</b><br>`
      + plan.rows.slice(0, 12).map(r => esc(r.key.replace(/\|/g, ' · ')) + ' — ' + nf(r.filled) + ' field(s)').join('<br>')
      + (plan.rows.length > 12 ? `<br>…and ${nf(plan.rows.length - 12)} more combination(s).` : '')
      + '</div>',
    saveLabel: 'Write them',
    onSave: async () => {
      const err = await recipeSeedRun(plan.rows);
      if (err) return err;
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = `${nf(fields)} field(s) seeded across ${nf(plan.rows.length)} combination(s).`
        + (plan.skipped.length ? ` ${nf(plan.skipped.length)} left for you where the SKUs disagree.` : '');
      return '';
    },
  });
};

$('ptmRecApply').onclick = async () => {
  const plan = recipeApplyPlan();
  if (!plan.fill.length && !plan.change.length) {
    $('ptmMsg').className = 'muted';
    $('ptmMsg').textContent = 'Every SKU already matches its recipe.';
    return;
  }
  const show = list => list.slice(0, 10).map(x => esc(x.sku) + ' · ' + esc(x.label) + ': '
    + (x.from === '' ? '<i>blank</i>' : esc(String(x.from))) + ' → <b>' + esc(String(x.to)) + '</b>').join('<br>');
  ptOpenDialog({
    title: 'Write the recipes onto the SKUs?',
    subtitle: `${nf(plan.fill.length)} blank(s) filled · ${nf(plan.change.length)} value(s) changed`,
    /* FILLING A BLANK AND CONTRADICTING A VALUE ARE DIFFERENT THINGS. The first is what this feature
     * is for; the second overwrites something somebody typed, and deserves to be looked at. */
    note: 'Filling a blank is what the recipes are for. Changing a value that is already there '
      + 'overwrites what somebody typed on that SKU — read those before agreeing.',
    html: `<div class="muted" style="font-size:12.5px;line-height:1.7">`
      + (plan.fill.length ? `<b>Blanks filled in</b><br>${show(plan.fill)}`
        + (plan.fill.length > 10 ? `<br>…and ${nf(plan.fill.length - 10)} more.` : '') + '<br><br>' : '')
      + (plan.change.length ? `<b style="color:var(--bad)">Values changed</b><br>${show(plan.change)}`
        + (plan.change.length > 10 ? `<br>…and ${nf(plan.change.length - 10)} more.` : '') : '')
      + '</div>',
    saveLabel: 'Write them',
    onSave: async () => {
      const err = await recipeApplyRun(plan);
      if (err) return err;
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = `${nf(plan.fill.length)} blank(s) filled and ${nf(plan.change.length)} value(s) changed.`;
      return '';
    },
  });
};

/* ---------- the recipe sheet ----------
 *
 * One row per combination, every field a column, and what the SKUs currently say carried alongside
 * so nobody has to hold 319 rows in their head while filling it in. A blank cell says nothing about
 * that field — it is not an instruction to clear it.
 */
/* A FUNCTION, not a constant: this block is read before the recipe bucket further down, and a
 * top-level const here reaches for RECIPE_FIELDS before it exists. */
const recipeSheetHead = () => ['Article', 'Subtype', 'Size', 'SKUs']
  .concat(RECIPE_FIELDS.map(f => f[1]))
  .concat(RECIPE_FIELDS.map(f => 'SKUs say: ' + f[1]));

function recipeSheetRows() {
  const rows = [recipeSheetHead()];
  recipeCombos().forEach(c => {
    const r = c.recipe || {};
    rows.push([c.articleType, c.subtype, c.size, c.n]
      .concat(RECIPE_FIELDS.map(([f]) => (recSaid(r[f]) ? String(r[f]) : '')))
      /* READ-ONLY CONTEXT. The disagreement is why a field is still empty, and a number typed with
       * "133 × 1.6 · 1 × 1.5 · 8 blank" in view is a different decision from one typed blind. */
      .concat(RECIPE_FIELDS.map(([f]) => {
        const said = c.says[f];
        if (!said.values.length) return said.blank ? said.blank + ' blank' : '';
        return said.values.map(v => v.n + ' × ' + v.value).join(' · ')
          + (said.blank ? ' · ' + said.blank + ' blank' : '');
      })));
  });
  return rows;
}

/** Read a filled recipe sheet back, by column name. */
function recipeSheetEntries(rows) {
  if (!rows || rows.length < 2) return { err: 'That file has no rows.' };
  const head = rows[0].map(h => String(h == null ? '' : h).trim().toLowerCase());
  const iA = head.indexOf('article'), iS = head.indexOf('subtype'), iZ = head.indexOf('size');
  if (iA < 0 || iS < 0 || iZ < 0)
    return { err: 'The file needs Article, Subtype and Size columns. Download the recipe template to see them.' };
  const at = {};
  RECIPE_FIELDS.forEach(([f, label]) => {
    /* "SKUs say: Consumption (m)" is the read-only twin and must never be mistaken for the field
     * itself — indexOf would find it first on some spellings. */
    const i = head.findIndex(h => h === label.toLowerCase());
    if (i >= 0) at[f] = i;
  });
  if (!Object.keys(at).length)
    return { err: 'The file has none of the recipe columns. Download the recipe template to see them.' };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const cell = j => String(rows[i][j] == null ? '' : rows[i][j]).trim();
    const e = { articleType: cell(iA), subtype: cell(iS), size: cell(iZ), row: i + 1, vals: {} };
    if (!e.articleType && !e.subtype && !e.size) continue;
    Object.keys(at).forEach(f => { const v = cell(at[f]); if (v !== '') e.vals[f] = v; });
    out.push(e);
  }
  return { entries: out };
}

/**
 * What an uploaded sheet would do, field by field, before anything is written.
 *
 * A BLANK CELL SAYS NOTHING. Most of a 319-row sheet comes back untouched, and reading an empty
 * box as "unset this" would wipe every recipe somebody did not mean to edit.
 */
function recipeUploadPlan(entries) {
  const set = [], change = [], skip = [];
  const known = new Map();
  recipeCombos().forEach(c => known.set(c.key, c));
  (entries || []).forEach(e => {
    const key = recKey(e);
    const c = known.get(key);
    if (!c) {
      skip.push({ row: e.row, key, why: 'no SKU in the catalogue has that article, subtype and size.' });
      return;
    }
    Object.keys(e.vals).forEach(f => {
      const spec = RECIPE_FIELDS.find(x => x[0] === f);
      const raw = e.vals[f];
      if (spec[2] === 'yn') {
        const k = recNorm(raw);
        if (k !== 'yes' && k !== 'no') {
          skip.push({ row: e.row, key, why: `${spec[1]} must be yes or no, not "${raw}".` });
          return;
        }
      } else if (spec[2] === 'fab') {
        /* A SPELLING THE MASTER DOES NOT HAVE IS A FABRIC NOBODY AGREED TO — and from here it would
         * be written onto every SKU under this combination. The row is refused with the reason. */
        const hit = cutFabrics().find(x => recNorm(x) === recNorm(raw));
        if (!hit) {
          skip.push({ row: e.row, key, why: `"${raw}" is not in the Fabric Type master. Add it there first, or fix the spelling.` });
          return;
        }
        e.vals[f] = hit;                       // the master's own spelling, not the sheet's
      } else if (spec[2] === 'num' && !Number.isFinite(mdbNum(raw))) {
        /* NOT `mdbNum(raw) >= 0`. mdbNum answers null for anything that is not a number, and
         * null >= 0 is true — so "lots" sailed through and would have been written as a quantity. */
        skip.push({ row: e.row, key, why: `${spec[1]} must be a number, not "${raw}".` });
        return;
      }
      const want = spec[2] === 'yn' ? recNorm(raw) : String(e.vals[f]).trim();
      const had = (c.recipe || {})[f];
      if (recSaid(had) && String(had).trim() === want) return;      // already says exactly that
      (recSaid(had) ? change : set).push({ row: e.row, key, field: f, label: spec[1],
        from: recSaid(had) ? String(had) : '', to: want,
        rec: Object.assign({ articleType: c.articleType, subtype: c.subtype, size: c.size }, c.recipe || {}) });
    });
  });
  return { set, change, skip };
}

/** Write an uploaded sheet — one patch, built from the plan that was shown. */
async function recipeUploadRun(plan) {
  if (!mdbCanEdit()) return MDB_NO_EDIT;
  const all = plan.set.concat(plan.change);
  if (!all.length) return 'There is nothing to write.';
  const byKey = new Map();
  all.forEach(x => {
    if (!byKey.has(x.key)) byKey.set(x.key, Object.assign({}, x.rec));
    byKey.get(x.key)[x.field] = x.to;
  });
  const now = new Date().toISOString();
  const patch = {}, keep = {};
  byKey.forEach((rec, key) => {
    const next = Object.assign({}, rec, { uploadedBy: ME.email, uploadedAt: now });
    RECIPE_FIELDS.forEach(([f, , kind]) => {
      if (!recSaid(next[f])) { delete next[f]; return; }
      next[f] = kind === 'yn' ? (recNorm(next[f]) === 'yes' ? 'yes' : 'no') : String(next[f]).trim();
    });
    patch['pt_masters/recipe/' + recPath(key)] = next;
    keep[recPath(key)] = next;
  });
  try { await ptPatch(patch); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  const masters = Object.assign({}, PTG.masters || {});
  masters.recipe = Object.assign({}, masters.recipe || {}, keep);
  PTG.masters = masters;
  RECIPE_IX = { src: null, map: null };
  RECIPE_FILLED = await recipeFillBlanks([...byKey.keys()]);
  return '';
}

/** The recipe sheet as .xlsx, with yes/no as a dropdown on the four fields that take one. */
function recipeXlsx(rows, opts) {
  /* Also writes the SKU template (Ravi, 2026-09-22: "i need recipe in excel template") — same dropdowns,
   * different columns, so opts says which they are. Without opts it is the recipe sheet, as before. */
  const O = opts || {};
  const last = Math.max(rows.length, 2) + 500;
  const cellX = (v, ref, head) => {
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    const t = String(v == null ? '' : v); if (t === '') return '';
    return `<c r="${ref}" t="inlineStr"${head ? ' s="1"' : ''}><is><t xml:space="preserve">${soXml(t)}</t></is></c>`;
  };
  /* THE FABRICS GO IN THE HIDDEN Lists SHEET beside yes/no, so the cloth columns are a dropdown in
   * Excel rather than a box to mistype into. */
  const fabs = cutFabrics();
  const colsOf = kind => (O.cols ? (O.cols[kind] || []) : RECIPE_FIELDS.filter(f => f[2] === kind).map(f => rows[0].indexOf(f[1]))).filter(i => i >= 0);
  const dvFor = (kind, name) => colsOf(kind).map(ix => {
    const c = soColName(ix);
    return `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${c}2:${c}${last}"><formula1>${name}</formula1></dataValidation>`;
  }).join('');
  const extra = O.list && (O.list.values || []).length ? O.list : null;     // one more dropdown of the caller's own
  const dvs = dvFor('yn', 'YesNo') + (fabs.length ? dvFor('fab', 'Fabrics') : '')
    + (extra ? extra.cols.filter(i => i >= 0).map(ix => { const c = soColName(ix);
      return `<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="${c}2:${c}${last}"><formula1>${extra.name}</formula1></dataValidation>`; }).join('') : '');
  const dvN = colsOf('yn').length + (fabs.length ? colsOf('fab').length : 0) + (extra ? extra.cols.filter(i => i >= 0).length : 0);
  const sheet1 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${O.freeze == null ? 3 : O.freeze}" ySplit="1" topLeftCell="${soColName(O.freeze == null ? 3 : O.freeze)}2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`
    + '<cols>' + rows[0].map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${O.cols ? Math.min(30, Math.max(11, String(h).length + 4)) : (i < 3 ? 22 : (i < 4 ? 8 : (i < 4 + RECIPE_FIELDS.length ? 16 : 26)))}" customWidth="1"/>`).join('') + '</cols>'
    + '<sheetData>' + rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cellX(v, soColName(j) + (i + 1), i === 0)).join('')}</row>`).join('') + '</sheetData>'
    + (dvN ? `<dataValidations count="${dvN}">${dvs}</dataValidations>` : '') + '</worksheet>';
  const exV = extra ? extra.values : [];
  const nL = Math.max(2, fabs.length, exV.length);
  const sheet2 = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + Array.from({ length: nL }, (_, i) => `<row r="${i + 1}">${i < 2 ? cellX(i ? 'no' : 'yes', 'A' + (i + 1)) : ''}${cellX(fabs[i], 'B' + (i + 1))}${cellX(exV[i], 'C' + (i + 1))}</row>`).join('')
    + '</sheetData></worksheet>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets><sheet name="${soXml(O.name || 'Recipes')}" sheetId="1" r:id="rId1"/><sheet name="Lists" sheetId="2" state="hidden" r:id="rId2"/></sheets>`
    + '<definedNames><definedName name="YesNo">Lists!$A$1:$A$2</definedName>'
    + (fabs.length ? '<definedName name="Fabrics">Lists!$B$1:$B$' + fabs.length + '</definedName>' : '')
    + (extra ? '<definedName name="' + soXml(extra.name) + '">Lists!$C$1:$C$' + exV.length + '</definedName>' : '')
    + '</definedNames></workbook>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';
  const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  return soZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${ct}.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="${ct}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/></Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet1], ['xl/worksheets/sheet2.xml', sheet2], ['xl/styles.xml', styles],
  ]);
}

/* ---- the screen ---- */

/** "42 × 2.8 · 1 × 2.7", which is the whole story where a bare "conflict" is not. */
function recSaysCell(s) {
  if (!s.values.length) return '<span class="muted">&mdash;</span>';
  const txt = s.values.map(v => `${nf(v.n)} × ${esc(v.value)}`).join(' · ')
    + (s.blank ? ` · ${nf(s.blank)} blank` : '');
  return s.conflict ? `<span style="color:var(--bad);font-weight:600">${txt}</span>` : `<span class="muted">${txt}</span>`;
}

function renderMdbRecipe() {
  const q = ($('ptmQ') || {}).value.trim().toLowerCase();
  /* THE THREE FILTERS THAT MEAN SOMETHING HERE. A recipe has no brand and no colour — those boxes
   * are taken off this view — but article, subtype and size are its very key, and they sat on screen
   * doing nothing. */
  const fA = ($('ptmArt') || {}).value || '', fS = ($('ptmSub') || {}).value || '', fZ = ($('ptmSz') || {}).value || '';
  const all = recipeCombos();
  ptFill('ptmArt', all.map(c => c.articleType), 'All articles');
  ptFill('ptmSub', all.filter(c => !fA || ptCi(c.articleType, fA)).map(c => c.subtype), 'All subtypes');
  ptFill('ptmSz', all.filter(c => (!fA || ptCi(c.articleType, fA)) && (!fS || ptCi(c.subtype, fS))).map(c => c.size), 'All sizes');
  const combos = all.filter(c => (!fA || ptCi(c.articleType, fA))
    && (!fS || ptCi(c.subtype, fS)) && (!fZ || ptCi(c.size, fZ))
    && (!q || [c.articleType, c.subtype, c.size].join(' ').toLowerCase().includes(q)));
  PT._recipeCombos = combos;

  const done = combos.filter(c => c.recipe && RECIPE_FIELDS.some(([f]) => recSaid(c.recipe[f]))).length;
  const clash = combos.reduce((a, c) => a + RECIPE_FIELDS.filter(([f]) => c.says[f].conflict).length, 0);
  const blanks = combos.reduce((a, c) => a + RECIPE_FIELDS.reduce((b, [f]) => b + c.says[f].blank, 0), 0);
  $('ptmKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Recipes — one per article, subtype and size</span>
      <span class="kpiwhen">${nf((PTG.mdb || []).length)} SKU(s) in ${nf(combos.length)} combination(s)</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(combos.length)}</div><div class="l">Combinations</div></div>
      <div class="metric"><div class="v" style="color:${done === combos.length ? '#166534' : '#7f6000'}">${nf(done)}</div><div class="l">With a recipe</div></div>
      <div class="metric"><div class="v"${blanks ? ' style="color:#7f6000"' : ''}>${nf(blanks)}</div><div class="l">Blank fields on SKUs</div></div>
      <div class="metric"><div class="v"${clash ? ' style="color:var(--bad)"' : ''}>${nf(clash)}</div><div class="l">Where the SKUs disagree</div></div>
    </div></div>`;

  const head = '<thead><tr>' + ['Article', 'Subtype', 'Size', 'SKUs']
    .concat(RECIPE_FIELDS.map(f => f[1])).concat([''])
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 3 ? ' class="num"' : '')}>${esc(h)}</th>`).join('') + '</tr></thead>';

  $('ptmTable').innerHTML = head + '<tbody>' + (combos.length ? combos.map(c => {
    const r = c.recipe || {};
    return '<tr>'
      + `<td class="frz" style="text-align:left">${esc(c.articleType) || '<span class="muted">(none)</span>'}</td>`
      + `<td style="text-align:left">${esc(c.subtype) || '<span class="muted">(none)</span>'}</td>`
      + `<td style="text-align:left">${esc(c.size) || '<span class="muted">(none)</span>'}</td>`
      + `<td class="num">${nf(c.n)}</td>`
      + RECIPE_FIELDS.map(([f]) => `<td style="text-align:left">`
        + (recSaid(r[f]) ? `<b>${esc(MDB_M2.indexOf(f) >= 0 && mdbM2(r[f]) != null ? mdbM2Txt(r[f]) : r[f])}</b>` : '<span class="muted">not set</span>')
        /* WHAT THE SKUs SAY, under what the recipe says. The disagreement is the reason this screen
         * exists, so it is on the row rather than behind a click. */
        + `<div style="font-size:10.5px">${recSaysCell(c.says[f])}</div></td>`).join('')
      + `<td><button class="ghost" data-rec-edit="${esc(c.key)}" style="padding:3px 10px;font-size:12px">Edit</button></td></tr>`;
  }).join('') : `<tr><td colspan="${RECIPE_FIELDS.length + 5}" class="muted" style="padding:16px">No combination matches that search.</td></tr>`)
    + '</tbody>';

  $('ptmMsg').className = 'muted';
  $('ptmMsg').textContent = `${nf(combos.length)} combination(s) · ${nf(done)} with a recipe`
    + (clash ? ` · ${nf(clash)} field(s) where the SKUs contradict each other — those are left for you` : '')
    + ' · a new SKU takes its recipe automatically; the ones already in the database change only when you press Apply';
}

/** Edit one recipe. Every field may be left unsaid, which means the SKU decides. */
function recipeEdit(key) {
  if (!mdbCanEdit()) { $('ptmMsg').className = 'err'; $('ptmMsg').textContent = MDB_NO_EDIT; return; }
  const c = recipeCombos().find(x => x.key === key);
  if (!c) return;
  const r = c.recipe || {};
  ptOpenDialog({
    title: 'Recipe — ' + [c.articleType, c.subtype, c.size].filter(Boolean).join(' · '),
    subtitle: nf(c.n) + ' SKU(s) share this combination',
    note: 'Leave a box empty to say nothing about it — the SKU decides. What the SKUs say today is '
      + 'shown beside each box, and where they disagree it is on you to say which is right.',
    fields: RECIPE_FIELDS.map(([f, label, kind]) => {
      const s = c.says[f];
      const said = s.values.map(v => nf(v.n) + ' × ' + v.value).join(', ') + (s.blank ? ', ' + nf(s.blank) + ' blank' : '');
      if (kind === 'fab') return { key: f, label: label + '  [' + said + ']', type: 'select',
        value: recSaid(r[f]) ? String(r[f]).trim() : '', options: [''].concat(fabListOr(r[f])) };
      return kind === 'yn'
        ? { key: f, label: label + '  [' + said + ']', type: 'select', value: recSaid(r[f]) ? recNorm(r[f]) : '',
            options: ['', 'yes', 'no'] }
        : { key: f, label: label + '  [' + said + ']', type: kind === 'num' ? 'number' : 'text',
            step: kind === 'num' ? '0.01' : undefined,
            value: recSaid(r[f]) ? (MDB_M2.indexOf(f) >= 0 && mdbM2(r[f]) != null ? mdbM2Txt(r[f]) : r[f]) : '' };
    }),
    saveLabel: 'Save the recipe',
    onSave: async v => {
      const err = await recipeSave(Object.assign({ articleType: c.articleType, subtype: c.subtype, size: c.size }, v));
      if (err) return err;
      renderPmdb();
      $('ptmMsg').className = 'muted';
      $('ptmMsg').textContent = 'Recipe saved.' + recipeFilledTxt(RECIPE_FILLED);
      return '';
    },
  });
}

