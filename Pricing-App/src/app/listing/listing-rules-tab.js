/* ================= LISTING · LISTING RULES TAB: the screen where the rules are edited, plus the suggested-title dialog and hand-typed parent names =================
 * Screens: Listing Rules (tab 'lrules') — the Issues / Title templates / Season calendar views, Add, Save, Reset and "Try a SKU";
 *          the suggested-title dialog (hSugModal) and the parent-name editor (pnModal), which other screens open too.
 * Does: draws one of the three views from LR (the saved rules — see listing-rules.js), writes every edit straight back into LR
 *       and saves to Firestore listingrules/config; hSugOpen shows the title lrSuggest builds for one SKU; parentName and the
 *       pnModal handlers keep the names typed by hand in parentnames/{brand}, which win over Amazon's.
 * Main functions: lrParamsParse, hSevDot / hSevCell / hAreaCell (the severity and area cells), ensureLrules, lrAllRows,
 *                 lrAllowRender (the "What people may write" box), renderLrules, the lrTable / lrAllow / lrAdd / lrReset /
 *                 lrSave / lrTry handlers, hSugOpen, loadParentNames,
 *                 saveParentNames, parentName, parentNameLocked, parentNameCell, wireParentNameCells, openParentNameEditor. */
/* ---------- the Listing Rules tab: where the issues are fed in ----------
 *
 * Three views of one saved document (listingrules/config):
 *   Issues            every issue, its severity (colour), the area it marks, what detects it, and how many
 *                     listings it flags right now. Add one, switch one off, change its numbers.
 *   Title templates   per brand and product: the parts a title must have, in order, with a reference title
 *                     to read against — and "Try a SKU" to see the suggestion for any listing.
 *   Season calendar   every occasion, the date it falls on this year, and the window a title may name it in.
 * Nothing changes Listing Health until "Save rules" is pressed; everything is checked on screen first.
 */
let LR_VIEW = 'issues';     // 'issues' | 'titles' | 'season'
let LR_DIRTY = false;       // edits since the last save
// HTML-escape for everything this tab prints.
const lrEsc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
// Status line under the toolbar: red for an error, grey otherwise.
const lrMsg = (text, bad) => {
  const msg = $('lrMsg');
  msg.textContent = text || '';
  msg.className = bad ? 'err' : 'muted';
};
// A detector's settings as "key=value, key=value" for the Settings input.
const lrParamsText = params => Object.entries(params || {}).map(([key, value]) => `${key}=${value}`).join(', ');
// The reverse: read "key=value, …" back, keeping only the keys the detector knows and turning numbers into numbers.
function lrParamsParse(text, detector) {
  const want = (LR_DETECTORS[detector] || {}).params || [];
  const out = {};
  String(text || '').split(/,(?=\s*\w+\s*=)/).forEach(part => {
    const eq = part.indexOf('=');
    if (eq < 0) return;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (want.includes(key)) out[key] = /^-?\d+(\.\d+)?$/.test(value) ? +value : value;
  });
  return out;
}
// The coloured dot for a severity (critical / action / review), or nothing.
const hSevDot = sev => sev ? `<span class="sev ${LR_SEV[sev].cls}"></span>` : '';
// Dot + label for a listing's bucket.
function hSevCell(bucket) {
  if (bucket === 'critical' || bucket === 'action' || bucket === 'review') return `${hSevDot(bucket)}${LR_SEV[bucket].label}`;
  if (bucket === 'monitor') return '<span class="sev sev-m"></span>Monitor';
  if (bucket === 'healthy') return '<span class="sev sev-g"></span>Healthy';
  return '<span class="muted">Not checked</span>';
}
/** One area of a listing: the worst colour found, ✓ when the area was judged and is fine, — when it could not be. */
function hAreaCell(row, area) {
  const hits = row._h.found.filter(hit => hit.area === area);
  /* THE IMAGE COUNT IS WRITTEN BESIDE THE COLOUR (2026-10-05, Ravi: "images nahi h fir bhi show kar rha h ki image h").
   * An out-of-stock listing with no image is shown as Attention, not Critical (the 15 Sept rule), and its amber dot
   * read as "a few images". The number says which: 0 is no image at all. */
  // The count is the one the rules judged — the catalogue's gallery pictures (healthOf's pics), not the raw snapshot field.
  const pics = area === 'Images' ? row._h.pics : null;
  const nImages = pics ? pics.n : null;
  const cnt = nImages == null ? '' : `<span style="font-size:12px;margin-left:4px;${pics.main ? 'color:var(--muted)' : 'color:var(--bad-ink);font-weight:700'}">`
    + `${pics.main ? nImages : (nImages ? nImages + ' · no main' : '0 · no image')}</span>`;
  if (hits.length) {
    const worst = hits.sort((a, b) => LR_SEV[b.sev].rank - LR_SEV[a.sev].rank)[0];
    return `<span class="sev ${LR_SEV[worst.sev].cls}" title="${lrEsc(hits.map(hit => hit.name + ' — ' + hit.detail).join('\n'))}"></span>` + cnt;
  }
  const judged = area === 'Images' ? !!row._h.pics : area === 'Content' ? !!row.content : !!hTitleText(row);
  // The four answers (Rule Engine): ✓ Pass · ◐ A person needs to look (the main picture, not marked yet — not an error) · ○ Not checked.
  const look = area === 'Images' && (row._h.looks || []).length;
  if (judged && look) return `<span class="muted" title="${lrEsc('A person needs to look: ' + row._h.looks[0].what + ' — Image Manager → Picture check')}">◐</span>` + cnt;
  return judged ? '<span class="sev-ok" title="Pass">✓</span>' + cnt : '<span class="muted" title="Not checked: not read yet — not an error">○</span>';
}

// First visit to the tab: the saved rules, the listings snapshot (for the counts) and the brand catalogues, then draw.
async function ensureLrules() {
  if (!LR) await lrLoad();
  if (!H_LOADED) {
    lrMsg('Reading the listings snapshot so the counts are real…');
    try {
      await loadHealthCache();
    } catch (e) { /* counts show as — */ }
  }
  if (!LR_CAT.SP || !LR_CAT.CPC) {
    lrMsg('Reading the brand catalogues (colour, size, sub-category)…');
    await lrLoadCatalog();
  }
  lrMsg('');
  renderLrules();
}

// Every listing of both brands from the Listing Health snapshot, each row tagged with its brand.
function lrAllRows() {
  return ['SP', 'CPC'].flatMap(b => ((HEALTH[b] && HEALTH[b].rows) || []).map(row => Object.assign({}, row, { brand: b })));
}

// The "What people may write" box above the issues (Part A, 5 Nov 2026): the allowances, each with a plain-words note of what it
// means. Every input writes into LR.allow (the lrAllow handler below); Save sends them with the rules, in the same document.
function lrAllowRender(cfg) {
  const allow = lrAllow(cfg);
  const field = (key, value, cls, extra) => `<input data-lra="${key}" class="${cls}" value="${lrEsc(value)}"${extra || ''}>`;
  $('lrAllow').innerHTML = `<div class="lr-allow-head"><b>What people may write</b><span class="muted"> — written on purpose, so not errors. The same
      allowances apply to every parent and every listing of both brands: Listing Health, the Workspace and the Audit all read them from here.</span></div>
    <div class="lr-allow-row"><label>Short forms allowed from ${field('shortFrom', allow.shortFrom, 'w-xs', ' type="number" min="1" max="75"')} characters</label>
      <span class="muted">A title of ${allow.shortFrom} to 75 characters was shortened on purpose to fit Amazon's 75, so in it these are fine: Inch written as Inc, In, In., in,
      " ″ ” or left out; Inches as Inch or In; Centimeter as cm; no spaces around x, X or ×; "&amp;" for and, "w/" for with, Pc or Pcs for Pieces, "2 Pack", "Pack of 2"
      or "2 Pcs" for Set of 2. Below ${allow.shortFrom} characters the house style stays strict ("18 x 18 Inch"); over 75 the title is asked to be shortened.</span></div>
    <div class="lr-allow-row"><label>Our brand words ${field('ourBrands', allow.ourBrands, 'w-l')}</label>
      <span class="muted">All of these are ours, for every listing of both brand accounts. A title has its brand when it holds any of them as whole words — upper or
      lower case, with "the", "my", "by" and punctuation skipped, so "My Whimsical Corner" counts and "Ridhima" does not. The brand Amazon shows for a listing counts
      too once Sellora has read it. Empty = only Amazon's brand is looked for.</span></div>
    <div class="lr-allow-row"><label>Embroidery colours ${field('embColors', allow.embroideryColors, 'w-m')}</label>
      <span class="muted">Pieces in these colours are embroidery, so "Block Print" is never asked of them; nor of a listing that says Embroidered or Embroidery. Otherwise
      "Block Print" is asked for only with proof that the product is block print — a sibling's title under the same parent, or the listing's own bullets or description on
      Amazon say it. A mixed colour such as "Blue &amp; White" is not white.</span></div>
    <div class="lr-allow-row"><span class="muted">Always, at any length, the same meaning is never an error: upper / lower case, singular / plural, Grey / Gray, Colour / Color,
      Tablecloth / Table Cloth / Table-Cloth, Pillow Cover / Cushion Cover, Block Print / Block-Print / Blockprint / Block Printed / Hand Block Printed, hyphens, commas,
      "|" and extra spaces. Siblings' sizes compare by meaning: "18x18" = "18 x 18" = "18×18".</span></div>`;
}

// Draw the current view (issues / titles / season) into lrTable, with live counts from the listings snapshot.
function renderLrules() {
  ['issues', 'titles', 'season'].forEach(view => $('lrView' + view[0].toUpperCase() + view.slice(1)).classList.toggle('on', LR_VIEW === view));
  const cfg = LR || LR_DEFAULT;
  const rows = lrAllRows();
  H_CTX = null;
  const ctx = hCtx(rows);
  $('lrAdd').textContent = LR_VIEW === 'issues' ? '+ Add issue' : LR_VIEW === 'titles' ? '+ Add template' : '+ Add occasion';
  $('lrTry').classList.toggle('hide', LR_VIEW !== 'titles');
  $('lrAllow').classList.toggle('hide', LR_VIEW !== 'issues');
  if (LR_VIEW === 'issues') lrAllowRender(cfg);
  lrHistoryRender();

  // --- the issues view ---
  if (LR_VIEW === 'issues') {
    /* How many listings each issue flags today, from the same evaluation Listing Health uses. */
    const count = {};
    rows.forEach(row => healthOf(row, ctx).found.forEach(hit => { count[hit.id] = (count[hit.id] || 0) + 1; }));
    const order = { critical: 0, action: 1, review: 2 };
    const list = cfg.issues.map((it, i) => ({ it, i })).sort((a, b) => (order[a.it.sev] - order[b.it.sev]) || a.i - b.i);
    // The three pickers of one row, with the current value selected. The level names say which of the two words a problem list
    // uses (Part B1); the search-term rule is never an Error (Part A4), so Critical is not offered for it.
    const sevSel = (i, selected, detector) => `<select data-lri="${i}" data-f="sev" style="width:auto">${Object.entries(LR_SEV)
      .filter(([key]) => !(detector === 'keyword_bytes' && key === 'critical' && selected !== 'critical'))
      .map(([key, sev]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${sev.label} — ${lrLevel(key).word}</option>`).join('')}</select>`;
    const areaSel = (i, selected) => `<select data-lri="${i}" data-f="area" style="width:auto">${LR_AREAS
      .map(area => `<option${area === selected ? ' selected' : ''}>${area}</option>`).join('')}</select>`;
    const detSel = (i, selected) => `<select data-lri="${i}" data-f="detector" style="max-width:230px">${Object.entries(LR_DETECTORS)
      .map(([key, det]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${lrEsc(det.label)}</option>`).join('')}</select>`;
    $('lrTable').innerHTML = '<thead><tr><th></th><th>Issue</th><th>Severity</th><th>Area</th><th>How it is detected</th><th>Settings</th>'
      + '<th>When it applies</th><th class="num">Flagged now</th><th>On</th><th></th></tr></thead><tbody>'
      + list.map(({ it, i }) => {
        const params = (LR_DETECTORS[it.detector] || {}).params || [];
        return `<tr>
          <td>${hSevDot(it.sev)}</td>
          <td style="text-align:left"><input class="w-l" data-lri="${i}" data-f="name" value="${lrEsc(it.name)}"></td>
          <td>${sevSel(i, it.sev, it.detector)}</td><td>${areaSel(i, it.area)}</td><td style="text-align:left">${detSel(i, it.detector)}</td>
          <td>${params.length
            ? `<input data-lri="${i}" data-f="params" value="${lrEsc(lrParamsText(it.params))}" placeholder="${params.map(param => param + '=').join(', ')}" class="w-s">`
            : '<span class="muted">—</span>'}</td>
          <td style="text-align:left"><input class="w-l" data-lri="${i}" data-f="desc" value="${lrEsc(it.desc || '')}" title="${lrEsc(it.desc || '')}"></td>
          <td class="num" style="font-weight:700">${it.detector === 'manual'
            ? '<span class="muted" title="Needs data Amazon has not been asked for">not detectable yet</span>'
            : (rows.length ? (count[it.id] || 0).toLocaleString('en-US') : '—')}</td>
          <td><input type="checkbox" data-lri="${i}" data-f="on"${it.on === false ? '' : ' checked'} style="width:auto"></td>
          <td><button class="ghost lr-del" data-lrdel="issues|${i}" title="Delete this issue">×</button></td>
        </tr>`;
      }).join('') + '</tbody>';
    const manual = cfg.issues.filter(issue => issue.detector === 'manual').length;
    const offLevels = cfg.issues.filter(issue => { const def = LR_DEFAULT.issues.find(each => each.id === issue.id); return def && def.sev !== issue.sev; }).length;
    lrMsg(`${cfg.issues.length} issues · ${manual} not detectable yet · counts are from the listings snapshot${rows.length ? ' (' + rows.length.toLocaleString('en-US') + ' listings)' : ' — none loaded'}`
      + ` · on every screen Critical reads "Error: fix first", Attention and Review read "Needs attention"`
      + (offLevels ? ` · ${offLevels} rule${offLevels === 1 ? '' : 's'} not at the recommended level` : '')
      + `${LR_SAVED_AT ? ' · last saved ' + LR_SAVED_AT.toLocaleString() : ' · using the built-in lists until you save'}${LR_DIRTY ? ' · UNSAVED CHANGES' : ''}`);
    return;
  }

  // --- the title templates view ---
  if (LR_VIEW === 'titles') {
    // One text input of a template row: the field `key`, `width` pixels wide.
    const input = (i, key, width) => `<input data-lrt="${i}" data-f="${key}" value="${lrEsc((cfg.templates[i] || {})[key] || '')}"`
      + ` title="${lrEsc((cfg.templates[i] || {})[key] || '')}" style="width:${width || 120}px">`;
    $('lrTable').innerHTML = '<thead><tr><th>Brand</th><th>Sub-category contains</th><th>Product</th><th>Material</th><th>Print</th><th>Uses</th>'
      + '<th>Must have</th><th>Template</th><th>Reference title</th><th class="num">Titles off template</th><th></th></tr></thead><tbody>'
      + cfg.templates.map((tpl, i) => {
        const off = rows.filter(row => lrTemplateFor(row, cfg) === tpl && healthOf(row, ctx).found.some(hit => hit.id === 'title_template')).length;
        return `<tr>
          <td><select data-lrt="${i}" data-f="brand" style="width:auto">${['ALL', 'SP', 'CPC']
            .map(brand => `<option value="${brand}"${brand === tpl.brand ? ' selected' : ''}>${brand === 'ALL' ? 'Both' : BRAND_NAME[brand]}</option>`).join('')}</select></td>
          <td>${input(i, 'match', 110)}</td><td>${input(i, 'product', 130)}</td><td>${input(i, 'material', 100)}</td><td>${input(i, 'pattern', 120)}</td>
          <td>${input(i, 'uses', 220)}</td><td>${input(i, 'required', 180)}</td><td>${input(i, 'template', 320)}</td>
          <td><textarea data-lrt="${i}" data-f="reference" rows="1" style="width:240px">${lrEsc(tpl.reference || '')}</textarea></td>
          <td class="num" style="font-weight:700">${rows.length ? off.toLocaleString('en-US') : '—'}</td>
          <td><button class="ghost lr-del" data-lrdel="templates|${i}" title="Delete this template">×</button></td>
        </tr>`;
      }).join('') + '</tbody>';
    lrMsg('Tokens: {brand} {product} {shape} {material} {size} {pattern} {uses} {occasions} {color}. "Must have" lists the tokens a title is checked for, in template order. '
      + '{occasions} is filled only with occasions in season today. Shape comes from the catalog sub-category, size and colour from the catalog row. Type a SKU in "Try a SKU" to see its suggestion.'
      + (LR_CAT.SP && LR_CAT.CPC ? '' : ' · the brand catalogues could not be read, so no title can be suggested yet'));
    return;
  }

  // --- the season calendar view ---
  /* the season calendar */
  const today = new Date();
  const mon = month => new Date(2000, month - 1, 1).toLocaleString('en-GB', { month: 'short' });
  const short = date => date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—';
  // The rule for when an occasion falls, in words.
  const whenText = occasion => {
    const when = occasion.when || {};
    if (when.type === 'fixed') return `${when.d} ${mon(when.m)}`;
    if (when.type === 'nth') return `${when.n === -1 ? 'Last' : ['', '1st', '2nd', '3rd', '4th', '5th'][when.n]} `
      + `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][when.wd]} of ${mon(when.m)}`;
    if (when.type === 'easter') return 'Easter Sunday';
    if (when.type === 'after') return `${when.days} day${when.days === 1 ? '' : 's'} after ${(cfg.events.find(other => other.id === when.event) || {}).name || when.event}`;
    return '—';
  };
  // How many titles in the snapshot name each occasion.
  const titled = {};
  rows.forEach(row => {
    const title = hTitleText(row);
    if (!title) return;
    cfg.events.forEach(occasion => {
      if (lrWords(occasion.words).some(word => lrHas(title, word))) titled[occasion.id] = (titled[occasion.id] || 0) + 1;
    });
  });
  $('lrTable').innerHTML = '<thead><tr><th>Occasion</th><th>Words in a title</th><th>Falls on</th><th>Next</th>'
    + '<th title="A title may name the occasion inside this window">Allowed in titles</th><th>Now</th>'
    + '<th class="num" title="How many days before and after the occasion a title may name it">Days before · after</th>'
    + '<th title="Never flag when the SKU\'s catalog sub-category or colour contains one of these">Skip if product is</th>'
    + '<th class="num" title="Titles in the listings snapshot that name it">Titles</th><th></th></tr></thead><tbody>'
    + cfg.events.map((occasion, i) => {
      const season = lrSeason(occasion, today, cfg.events);
      // this year's and next year's date, worked out by themselves (or typed: a typed date wins) — "Easter 2027: 28 Mar"
      const y = today.getFullYear();
      const typedOf = year => !!(occasion.on && occasion.on[String(year)]);
      const dates = [y, y + 1].map(year => ({ year, date: lrEventDate(occasion, year, cfg.events), typed: typedOf(year) }));
      const typedVal = (occasion.on && (occasion.on[String(y)] || occasion.on[String(y + 1)])) || '';
      return `<tr>
        <td><input class="w-s" data-lre="${i}" data-f="name" value="${lrEsc(occasion.name)}"></td>
        <td><input class="w-m" data-lre="${i}" data-f="words" value="${lrEsc(occasion.words)}" title="${lrEsc(occasion.words)}"></td>
        <td>${lrEsc(whenText(occasion))}<div class="muted lr-dates" title="${lrEsc(dates.map(d => `${occasion.name} ${d.year}: ${short(d.date)}`).join(' · '))}">${dates.map(d => `${d.year}: ${short(d.date)}${d.typed ? ' (typed)' : ''}`).join(' · ')}</div>`
          + `<input type="date" class="w-s" data-lre="${i}" data-f="on" value="${lrEsc(typedVal)}" title="Type a date only to use it instead of the worked-out one (for that year); clear it to go back"></td>
        <td>${season.next ? short(season.next) + " '" + String(season.next.getUTCFullYear()).slice(2) : '—'}</td>
        <td>${season.from ? short(season.from) + ' → ' + short(season.to) : '—'}</td>
        <td><span class="lr-pill ${season.inSeason ? 'lr-in' : 'lr-out'}">${season.inSeason ? 'in season' : 'out'}</span></td>
        <td class="num" style="white-space:nowrap"><input class="w-xs" data-lre="${i}" data-f="lead" type="number" min="0" value="${occasion.lead || 0}" title="days before">
          <span class="muted">·</span> <input class="w-xs" data-lre="${i}" data-f="lag" type="number" min="0" value="${occasion.lag || 0}" title="days after"></td>
        <td><input class="w-s" data-lre="${i}" data-f="except" value="${lrEsc(occasion.except || '')}" placeholder="e.g. Tree Skirt" title="${lrEsc(occasion.except || '')}"></td>
        <td class="num" style="font-weight:700">${rows.length ? (titled[occasion.id] || 0).toLocaleString('en-US') : '—'}</td>
        <td><button class="ghost lr-del" data-lrdel="events|${i}" title="Delete this occasion">×</button></td>
      </tr>`;
    }).join('') + '</tbody>';
  lrMsg(`Today is ${lrFmtDate(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())))}. `
    + `A title naming an occasion outside its window is flagged "Out-of-season occasion in title". `
    + '"Skip if product is" is checked against the SKU\'s catalog sub-category and colour — a Christmas tree skirt may always say Christmas.');
}

/* Every input writes straight into the rules in memory; Save sends them. */
// A change in any input of the table: find which issue / template / occasion and which field, write it, redraw.
$('lrTable').addEventListener('change', e => {
  const el = e.target;
  const cfg = LR || (LR = JSON.parse(JSON.stringify(LR_DEFAULT)));
  const field = el.getAttribute('data-f');
  const val = el.type === 'checkbox' ? el.checked : el.value;
  if (el.hasAttribute('data-lri')) {
    const issue = cfg.issues[+el.getAttribute('data-lri')];
    if (!issue) return;
    if (field === 'params') issue.params = lrParamsParse(val, issue.detector);
    else if (field === 'detector') {
      issue.detector = val;
      issue.params = {};
    } else issue[field] = val;
  } else if (el.hasAttribute('data-lrt')) {
    const tpl = cfg.templates[+el.getAttribute('data-lrt')];
    if (tpl) tpl[field] = val;
  } else if (el.hasAttribute('data-lre')) {
    const occasion = cfg.events[+el.getAttribute('data-lre')];
    if (!occasion) return;
    if (field === 'on') {
      // a typed date for its own year wins over the worked-out one; an empty box goes back to the worked-out dates
      const y = new Date().getFullYear();
      occasion.on = Object.assign({}, occasion.on || {});
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) occasion.on[val.slice(0, 4)] = val;
      else { delete occasion.on[String(y)]; delete occasion.on[String(y + 1)]; }
      if (!Object.keys(occasion.on).length) delete occasion.on;
    } else occasion[field] = (field === 'lead' || field === 'lag') ? Math.max(0, parseInt(val, 10) || 0) : val;
  } else return;
  LR_DIRTY = true;
  H_CTX = null;
  renderLrules();
});
// The "What people may write" box: every input writes into the allowances in memory; Save sends them with the rules.
$('lrAllow').addEventListener('change', e => {
  const key = e.target.getAttribute('data-lra');
  if (!key) return;
  const cfg = LR || (LR = JSON.parse(JSON.stringify(LR_DEFAULT)));
  const allow = cfg.allow = lrAllow(cfg);
  const value = String(e.target.value || '').trim();
  if (key === 'shortFrom') allow.shortFrom = Math.min(75, Math.max(1, parseInt(value, 10) || LR_DEFAULT.allow.shortFrom));
  else if (key === 'ourBrands') allow.ourBrands = value;
  else if (key === 'embColors') allow.embroideryColors = value;
  LR_DIRTY = true;
  H_CTX = null;
  renderLrules();
});
// The × button on a row: delete that issue / template / occasion (after a confirm).
$('lrTable').addEventListener('click', e => {
  const delBtn = e.target.closest('[data-lrdel]');
  if (!delBtn) return;
  const [kind, i] = delBtn.getAttribute('data-lrdel').split('|');
  const cfg = LR || (LR = JSON.parse(JSON.stringify(LR_DEFAULT)));
  const item = cfg[kind][+i];
  if (!item || !confirm(`Delete "${item.name || item.match || 'this row'}"? It is gone once you save.`)) return;
  cfg[kind].splice(+i, 1);
  LR_DIRTY = true;
  H_CTX = null;
  renderLrules();
});
// The three view buttons.
$('lrViewIssues').onclick = () => {
  LR_VIEW = 'issues';
  renderLrules();
};
$('lrViewTitles').onclick = () => {
  LR_VIEW = 'titles';
  renderLrules();
};
$('lrViewSeason').onclick = () => {
  LR_VIEW = 'season';
  renderLrules();
};
// Add: a new issue, template or occasion for the view on screen, with sensible starting values.
$('lrAdd').onclick = () => {
  const cfg = LR || (LR = JSON.parse(JSON.stringify(LR_DEFAULT)));
  if (LR_VIEW === 'issues') {
    const name = prompt('Name of the new issue (e.g. "Title says Rustic")');
    if (!name) return;
    cfg.issues.push({ id: 'u' + Date.now().toString(36), name: name.trim(), sev: 'review', area: 'Title',
      detector: 'title_contains', params: { words: '' }, desc: '', on: true });
  } else if (LR_VIEW === 'titles') {
    cfg.templates.push({ brand: 'ALL', match: '', product: '', material: '', pattern: '', uses: '',
      required: 'brand,product,size,color', template: '{brand} {color} {product} {size}', reference: '' });
  } else {
    const name = prompt('Occasion name (e.g. Diwali)');
    if (!name) return;
    const when = prompt('The date it falls on, as MM-DD (a fixed date every year)', '11-01');
    if (!when) return;
    const parts = String(when).match(/^(\d{1,2})-(\d{1,2})$/);
    if (!parts) {
      lrMsg('Write the date as MM-DD, e.g. 12-25.', true);
      return;
    }
    cfg.events.push({ id: 'u' + Date.now().toString(36), name: name.trim(), words: name.trim(),
      when: { type: 'fixed', m: +parts[1], d: +parts[2] }, lead: 30, lag: 3 });
  }
  LR_DIRTY = true;
  H_CTX = null;
  renderLrules();
};
// Use recommended levels (Part B2, 6 Nov 2026): every rule's level becomes the built-in one — Error (Critical) for Amazon
// reports an error, Suppressed from search, Stock but Inactive, No price, Main image missing, Secondary images missing and
// A+ missing; Needs attention for everything else. Only the levels change, in memory; the person presses Save to keep them.
$('lrLevels').onclick = () => {
  const cfg = LR || (LR = JSON.parse(JSON.stringify(LR_DEFAULT)));
  let changed = 0;
  cfg.issues.forEach(issue => {
    const def = LR_DEFAULT.issues.find(each => each.id === issue.id);
    if (def && def.sev !== issue.sev) {
      issue.sev = def.sev;
      changed++;
    }
  });
  LR_VIEW = 'issues';
  LR_DIRTY = LR_DIRTY || changed > 0;
  H_CTX = null;
  renderLrules();
  lrMsg(changed ? `${changed} level${changed === 1 ? '' : 's'} set to the recommended one — press “Save rules” to keep them (saving works on live Sellora).` : 'Every rule is already at its recommended level.');
};
// Reset: back to the built-in lists (LR_DEFAULT) in memory; nothing is saved until Save.
$('lrReset').onclick = () => {
  if (!confirm("Put back Ravi's original lists, templates and calendar? Your edits are lost once you save.")) return;
  LR = JSON.parse(JSON.stringify(LR_DEFAULT));
  LR_DIRTY = true;
  H_CTX = null;
  renderLrules();
};
// Save: write the three lists to Firestore listingrules/config.
/* ---- HISTORY (Rule Engine, 12 Nov 2026): every "Save rules" keeps the version it replaces, inside listingrules/config itself (the last
 *      LR_HISTORY_MAX), with who saved, when, and what the save changed in words. Compare with now; no restore button. ---- */
const LR_HISTORY_MAX = 20;
// A person's name from an e-mail: the part before the @ (and before a dot), capitalised.
const lrWho = email => { const s = String(email || '').split(/[@._-]/)[0]; return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Someone'; };
// What changed from one version of the rules to another, in words: ["changed 'A+ missing' from Attention to Critical", …].
function lrRulesDiff(a, b) {
  a = a || {};
  b = b || {};
  const out = [];
  const lvl = sev => (LR_SEV[sev] ? LR_SEV[sev].label : String(sev || '—'));
  const ai = new Map((a.issues || []).map(issue => [issue.id, issue]));
  const bi = new Map((b.issues || []).map(issue => [issue.id, issue]));
  bi.forEach((x, id) => {
    const o = ai.get(id);
    if (!o) return out.push(`added the rule '${x.name}'`);
    if (o.name !== x.name) out.push(`renamed '${o.name}' to '${x.name}'`);
    if (o.sev !== x.sev) out.push(`changed '${x.name}' from ${lvl(o.sev)} to ${lvl(x.sev)}`);
    if ((o.on !== false) !== (x.on !== false)) out.push(`turned '${x.name}' ${x.on === false ? 'off' : 'on'}`);
    if (o.area !== x.area) out.push(`moved '${x.name}' from ${o.area} to ${x.area}`);
    if (o.detector !== x.detector) out.push(`changed how '${x.name}' is found`);
    const op = o.params || {};
    const np = x.params || {};
    const keys = [...new Set(Object.keys(op).concat(Object.keys(np)))].filter(k => String(op[k]) !== String(np[k]));
    if (keys.length) out.push(`changed the settings of '${x.name}' (${keys.map(k => `${k}: ${op[k] == null ? '—' : op[k]} → ${np[k] == null ? '—' : np[k]}`).join(', ')})`);
  });
  ai.forEach((o, id) => { if (!bi.has(id)) out.push(`removed the rule '${o.name}'`); });
  const tkey = tpl => `${tpl.brand || 'ALL'}|${tpl.match || ''}`;
  const at = new Map((a.templates || []).map(tpl => [tkey(tpl), tpl]));
  const bt = new Map((b.templates || []).map(tpl => [tkey(tpl), tpl]));
  bt.forEach((x, k) => { if (!at.has(k)) out.push(`added the title template for '${x.match || 'anything'}'`); else if (JSON.stringify(at.get(k)) !== JSON.stringify(x)) out.push(`changed the title template for '${x.match || 'anything'}'`); });
  at.forEach((o, k) => { if (!bt.has(k)) out.push(`removed the title template for '${o.match || 'anything'}'`); });
  const ae = new Map((a.events || []).map(ev => [ev.id, ev]));
  const be = new Map((b.events || []).map(ev => [ev.id, ev]));
  be.forEach((x, id) => { if (!ae.has(id)) out.push(`added '${x.name}' to the season calendar`); else if (JSON.stringify(ae.get(id)) !== JSON.stringify(x)) out.push(`changed '${x.name}' in the season calendar`); });
  ae.forEach((o, id) => { if (!be.has(id)) out.push(`removed '${o.name}' from the season calendar`); });
  const aa = lrAllow(a);
  const ba = lrAllow(b);
  const allowName = { shortFrom: 'Short forms allowed from', ourBrands: 'Our brand words', embroideryColors: 'Embroidery colours' };
  Object.keys(allowName).forEach(k => { if (String(aa[k]) !== String(ba[k])) out.push(`changed '${allowName[k]}' from '${aa[k]}' to '${ba[k]}'`); });
  return out;
}
// The History card: each save — who, when, what it changed — and "Compare with now" (that version against the rules in force).
const LR_HIST_OPEN = new Set();
function lrHistoryRender() {
  const box = $('lrHistory');
  if (!box) return;
  const cfg = LR || LR_DEFAULT;
  const when = ms => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const rows = LR_HISTORY.map((entry, i) => {
    const open = LR_HIST_OPEN.has(i);
    const now = open ? lrRulesDiff(entry.prev, cfg) : [];
    return `<div class="lr-h-row"><div class="lr-h-who"><b>${lrEsc(entry.who || lrWho(entry.by))}</b> <span class="sp-dim">· ${lrEsc(when(entry.at))}</span></div>`
      + `<ul class="lr-h-list">${(entry.changes || []).length ? entry.changes.map(line => `<li>${lrEsc(line)}</li>`).join('') : '<li class="sp-dim">saved without a change</li>'}</ul>`
      + `<button type="button" class="sp-link" data-lrh="${i}" aria-expanded="${open}">${open ? 'Hide the comparison' : 'Compare with now'}</button>`
      + (open ? `<div class="lr-h-cmp"><b>From the version before this save to the rules now:</b>${now.length ? `<ul class="lr-h-list">${now.map(line => `<li>${lrEsc(line)}</li>`).join('')}</ul>` : '<p class="sp-dim">The same as now.</p>'}</div>` : '')
      + '</div>';
  }).join('');
  box.innerHTML = `<div class="lr-h-head"><b>History</b><span class="sp-dim">The last ${LR_HISTORY_MAX} saves. Each one keeps the rules as they were before it, so you can see what changed.</span></div>`
    + (rows || '<p class="sp-dim lr-h-none">No save yet. When someone presses “Save rules”, it shows here: who, when and what changed.</p>');
}
if ($('lrHistory') && $('lrHistory').addEventListener) $('lrHistory').addEventListener('click', e => {
  const btn = e.target.closest ? e.target.closest('[data-lrh]') : null;
  if (!btn) return;
  const i = +btn.dataset.lrh;
  if (LR_HIST_OPEN.has(i)) LR_HIST_OPEN.delete(i); else LR_HIST_OPEN.add(i);
  lrHistoryRender();
  const again = $('lrHistory').querySelector(`[data-lrh="${i}"]`);
  if (again) again.focus({ preventScroll: true });
});
// The rules as one plain object (what is saved and compared), from a config or a saved document.
const lrRulesOf = cfg => JSON.parse(JSON.stringify({ issues: cfg.issues || [], templates: cfg.templates || [], events: cfg.events || [], allow: lrAllow(cfg) }));
$('lrSave').onclick = async () => {
  const cfg = LR || LR_DEFAULT;
  /* Firestore refuses undefined anywhere in a document. */
  const clean = lrRulesOf(cfg);
  if (clean.issues.some(issue => !String(issue.name || '').trim())) {
    lrMsg('Every issue needs a name.', true);
    return;
  }
  $('lrSave').disabled = true;
  try {
    // The version this save replaces, read fresh (someone else may have saved since this page loaded): kept in the history.
    const snap = await getDoc(doc(db, 'listingrules', 'config'));
    const data = snap.exists() ? snap.data() : null;
    const prev = data ? Object.assign(lrRulesOf(Object.assign({}, LR_DEFAULT, data, { allow: data.allow })), { at: data.at && data.at.toMillis ? data.at.toMillis() : 0, by: data.by || '' })
      : Object.assign(lrRulesOf(LR_DEFAULT), { at: 0, by: '' });
    const history = [{ at: Date.now(), by: ME.email, who: lrWho(ME.email), changes: lrRulesDiff(prev, clean), prev }]
      .concat(data && Array.isArray(data.history) ? data.history : []).slice(0, LR_HISTORY_MAX);
    await setDoc(doc(db, 'listingrules', 'config'), Object.assign(clean, { at: serverTimestamp(), by: ME.email, history: JSON.parse(JSON.stringify(history)) }));
    LR_HISTORY = history;
    LR_SAVED_AT = new Date();
    LR_DIRTY = false;
    H_CTX = null;
    renderLrules();
    lrMsg('Saved. Listing Health now flags listings by these rules.');
  } catch (e) {
    lrMsg('Not saved: ' + (e.message || e), true);
  }
  $('lrSave').disabled = false;
};
// Try a SKU: open the suggested-title dialog for one listing from the snapshot.
$('lrTry').onclick = () => {
  const sku = (prompt('SKU to try') || '').trim().toUpperCase();
  if (!sku) return;
  const row = lrAllRows().find(each => String(each.sku).toUpperCase() === sku);
  if (!row) {
    lrMsg(`${sku} is not in the listings snapshot.`, true);
    return;
  }
  hSugOpen(row.brand, row.sku);
};

/* ---- the suggested title, for one listing ---- */
// Fill and open the dialog: the title now, the one lrSuggest builds, and the title / size / variation issues found.
function hSugOpen(brand, sku) {
  const saved = ((HEALTH[brand] && HEALTH[brand].rows) || []).find(each => each.sku === sku);
  if (!saved) return;
  const row = Object.assign({}, saved, { brand });
  const cfg = LR || LR_DEFAULT;
  const health = healthOf(row);
  const tpl = lrTemplateFor(row, cfg);
  const cat = lrCatOf(row);
  const sug = lrSuggest(row, cfg);
  $('hSugTitle').textContent = sku + ' · ' + (BRAND_NAME[brand] || brand);
  $('hSugBody').innerHTML = `
    <div class="muted" style="font-size:12px">Now${hTitleText(row) ? '' : ' (only the first 60 characters were saved — refresh Listing Health for the full title)'}</div>
    <div style="margin:4px 0 12px;font-size:13.5px">${lrEsc(hTitleText(row) || row.title || '—')}</div>
    <div class="muted" style="font-size:12px">Suggested${tpl ? ` — template "${lrEsc(tpl.match || 'any')}"` : ''}</div>
    <textarea id="hSugText" rows="3" style="width:100%;margin:4px 0 4px;font-size:13.5px">${lrEsc(sug)}</textarea>
    <div class="muted" style="font-size:11.5px" id="hSugLen">${sug.length} / 200 characters</div>
    ${!cat ? '<div class="err" style="margin-top:8px">This SKU is not in the brand catalog, so its colour, size and sub-category are unknown — no title can be built.</div>' : ''}
    ${cat && !tpl ? '<div class="err" style="margin-top:8px">No title template matches its sub-category "' + lrEsc(cat.subcat) + '" — add one in Listing Rules → Title templates.</div>' : ''}
    <div class="lr-probs" style="margin-top:12px;max-width:none">${lrProblemsHtml(health.found.filter(hit => hit.area === 'Title' || hit.area === 'Size' || hit.area === 'Variation'), { brand, sku })
      || '<span class="muted">No title, size or variation issue on this listing.</span>'}</div>`;
  $('hSugModal').classList.remove('hide');
}
// Close: the X button, or a click on the backdrop.
$('hSugClose').onclick = () => $('hSugModal').classList.add('hide');
$('hSugModal').onclick = e => {
  if (e.target === $('hSugModal')) $('hSugModal').classList.add('hide');
};
// Copy the suggested title to the clipboard; if the browser refuses, select it so Ctrl+C works.
$('hSugCopy').onclick = async () => {
  const text = $('hSugText') ? $('hSugText').value : '';
  try {
    await navigator.clipboard.writeText(text);
    $('hSugCopy').textContent = 'Copied';
    setTimeout(() => { $('hSugCopy').textContent = 'Copy'; }, 1500);
  } catch (e) {
    $('hSugText').select();
  }
};

/* ---------- parent names you typed yourself ---------- */
/*
 * A name entered here OVERRIDES whatever Amazon reports, and a refresh never touches it — that is
 * the "lock". Amazon's own listing name can change under you (or come back as a child's title when
 * the parent has no row of its own), and a name the user curated must not be silently replaced by it.
 *
 * Stored per brand in `parentnames/{brand}`, separate from the health snapshot so that rebuilding
 * listings can never take these with it.
 */
let PNAME = { SP: {}, CPC: {} };          // brand → { asin: { v, by, at } }
let PNAME_LOADED = false;
let PNAME_EDIT = null;                    // { brand, asin, after } while the name editor is open

// Read both brands' hand-typed names once.
async function loadParentNames() {
  if (PNAME_LOADED) return;
  for (const brand of ['SP', 'CPC']) {
    try {
      const snap = await getDoc(doc(db, 'parentnames', brand));
      PNAME[brand] = snap.exists() ? (snap.data().n || {}) : {};
    } catch (e) { /* reported by whichever tab needed it */ }
  }
  PNAME_LOADED = true;
}
// Write one brand's hand-typed names back.
async function saveParentNames(brand) {
  await setDoc(doc(db, 'parentnames', brand), { n: PNAME[brand] || {}, at: serverTimestamp() });
}

/**
 * The name to show for a parent, in priority order:
 *   1. what the user typed (locked — never overwritten)
 *   2. the seller's own listing name from the merchant report
 *   3. a child's title, prefixed "~" so a borrowed name is never mistaken for the parent's own
 */
function parentName(brand, asin, fallbackChildTitle) {
  const own = PNAME[brand]?.[asin]?.v;          // hand-typed in the name editor (wins, locked)
  if (own) return own;
  const rep = HEALTH[brand]?.parentNames?.[asin];   // the seller's own Amazon listing name
  if (rep) return rep;
  const man = AUDIT_MANUAL?.[brand]?.[asin]?.name;  // a name given to a manually-added parent
  if (man) return man;
  return fallbackChildTitle ? '~ ' + fallbackChildTitle : '';
}
// True when the user typed this parent's name (so refreshes leave it alone).
function parentNameLocked(brand, asin) {
  return !!PNAME[brand]?.[asin]?.v;
}

/**
 * Renders a parent name cell. No icons — the NAME ITSELF is the click target, so nothing is added to
 * the row visually. The tooltip carries the full name and, when it was set by hand, that it is fixed.
 */
function parentNameCell(brand, asin, text, trunc) {
  const esc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  const shown = String(text || '').slice(0, trunc || 34);
  const tip = (text ? text + ' — ' : '') + (parentNameLocked(brand, asin)
    ? 'set by you; refreshes will not change it. Click to edit.' : 'click to set your own name');
  return `<span data-pname="${esc(brand)}|${esc(asin)}" title="${esc(tip)}" style="cursor:pointer">${
    esc(shown) || '<span class="muted">—</span>'}</span>`;
}
// After a table is drawn: clicking a parent name opens the editor; `after` is what to redraw once a name is saved.
function wireParentNameCells(tableId, after) {
  $(tableId).querySelectorAll('[data-pname]').forEach(el => {
    el.onclick = () => openParentNameEditor(...el.dataset.pname.split('|'), after);
  });
}

// Open the name editor for one parent, showing what Amazon reports beside the input.
function openParentNameEditor(brand, asin, after) {
  PNAME_EDIT = { brand, asin, after };
  const cur = PNAME[brand]?.[asin]?.v || '';
  const amazon = HEALTH[brand]?.parentNames?.[asin] || '';
  $('pnAsin').textContent = asin + ' · ' + BRAND_NAME[brand];
  $('pnAmazon').textContent = amazon ? `Amazon reports: ${amazon}` : 'Amazon reports no name for this parent.';
  $('pnInput').value = cur;
  $('pnReset').classList.toggle('hide', !cur);
  $('pnModal').classList.remove('hide');
  $('pnInput').focus();
}
// Close the editor: Cancel, or a click on the backdrop.
function closeParentNameEditor() {
  $('pnModal').classList.add('hide');
  PNAME_EDIT = null;
}
$('pnCancel').onclick = closeParentNameEditor;
$('pnModal').onclick = e => {
  if (e.target === $('pnModal')) closeParentNameEditor();
};
// Save: keep the typed name (at most 90 characters) for this parent, redraw the caller's table, then write it to Firestore.
$('pnSave').onclick = async () => {
  if (!PNAME_EDIT) return;
  const { brand, asin, after } = PNAME_EDIT;
  const v = $('pnInput').value.trim().slice(0, 90);
  if (!v) {
    $('pnInput').focus();
    return;
  }
  PNAME[brand] = PNAME[brand] || {};
  PNAME[brand][asin] = { v, by: ME.email, at: new Date().toISOString().slice(0, 10) };
  closeParentNameEditor();
  if (after) after();
  try {
    await saveParentNames(brand);
  } catch (e) {
    alert('Could not save the name: ' + (e.message || e));
  }
};
// Reset: drop the typed name so Amazon's shows again, redraw, then write.
$('pnReset').onclick = async () => {
  if (!PNAME_EDIT) return;
  const { brand, asin, after } = PNAME_EDIT;
  // Removing the override hands the name back to Amazon's — it does not blank it.
  if (PNAME[brand]) delete PNAME[brand][asin];
  closeParentNameEditor();
  if (after) after();
  try {
    await saveParentNames(brand);
  } catch (e) {
    alert('Could not save: ' + (e.message || e));
  }
};

