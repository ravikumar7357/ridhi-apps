/* ================= LISTING · LISTING CONTENT: the title / bullets / description / search terms of a listing — checked, suggested, edited, and moved by Excel =================
 * Screens: Listing Errors (tab 'lerr') — the Content section inside the fixer that listing-errors.js draws, and its
 *          Download / Upload buttons (the content sheet). No screen of its own.
 * Does: lcCheck says what Listing Rules and Amazon's limits object to in each field; lcTemplateFit / lcSuggestKeywords build
 *       the only suggestions (from the title template, never invented); lcSectionHtml / lcWire draw and wire the section;
 *       lcDownload writes the listings on screen to an .xlsx with the suggestions beside them; lcUpload reads one back,
 *       compares with Amazon now, and lcUpSend checks / applies row by row through imPost; sections 6 is a no-library
 *       xlsx reader and writer. Pricing-App/tests/listing-content-test.js runs this file (with listing-rules.js) in a stub page.
 * Main functions: lcCheck, lcTemplateFit, lcSuggestKeywords, lcSectionHtml, lcWire, lcContentFor, lcDownload, lcReadXlsx,
 *                 lcUpload, lcUpRender, lcUpSend, lcXlsx, lcUnzip / lcZip. */
/* ================= LISTING CONTENT: title, bullets, description, search terms =================
 *
 * Part of Listing Errors (2026-10-10, Ravi: "yanhi se title, desc, bullet point, search term dekh saku and change kar
 * saku manually and via upload with auto suggestion based on listing rule").
 *
 * HOW THIS FILE IS LAID OUT:
 *   1. Fields and rules  — the four fields, and what Listing Rules (listing-rules.js) say about each
 *   2. Suggestions       — ONLY from Listing Rules: the title template (and a 75-character cut of it), and search terms
 *                          from the template's words the title does not already carry. Bullets and description have no
 *                          template in Listing Rules, so they get the rule checks and no invented text.
 *   3. In the fixer      — the Content section of one listing (listing-errors.js draws it, this fills it)
 *   4. Excel out         — the content of the listings on screen, with the suggestions beside it
 *   5. Excel in          — read it back, compare with Amazon now, check and apply row by row
 *   6. xlsx              — a reader and a writer with no library (Sellora loads no external scripts)
 *
 * Every change goes through POST lfix=patch (Pricing-API/ListingFix.gs): checked with Amazon first, sent only when
 * Amazon reports no problem. Content for many SKUs comes from ?lfix=content, 20 a call. */

/* ============================================================================================
 * 1. FIELDS AND RULES
 * ============================================================================================ */
const LC_FIELDS = ['item_name', 'bullet_point', 'product_description', 'generic_keyword'];   // the four content attributes, in screen order
const LC_LABEL = { item_name: 'Title', bullet_point: 'Bullet points', product_description: 'Description', generic_keyword: 'Search terms' };
// UTF-8 byte length (Amazon counts search terms in bytes).
const lcBytes = str => new TextEncoder().encode(String(str || '')).length;
// The plain strings of an attribute's entries ([{ value, language_tag }] → ['…']).
const lcVals = arr => (arr || []).map(entry => String((entry && entry.value) == null ? '' : entry.value));
// The language tag Amazon sent with an attribute, else en_US.
const lcLang = arr => ((arr || []).find(entry => entry && entry.language_tag) || {}).language_tag || 'en_US';
// The Listing Rules issue that uses this detector and is switched on, or null.
const lcRule = detector => ((LR || LR_DEFAULT).issues || []).find(issue => issue.detector === detector && issue.on !== false) || null;

/** What the rules say about one field's text. Each finding: { bad: true = Amazon will refuse / false = look at it, msg }. */
// ctx may carry { title, subcat, color } for the checks that need the listing's title or catalogue row.
function lcCheck(field, vals, ctx) {
  const out = [];
  const push = (bad, msg) => out.push({ bad, msg });
  ctx = ctx || {};
  if (field === 'item_name') {
    // --- title: Amazon's limits, then the Listing Rules about length, required words, forbidden words, season, sizes ---
    const title = vals[0] || '';
    const nChars = title.length;
    if (!nChars) push(true, 'No title.');
    if (nChars > 200) push(true, nChars + ' characters — Amazon\'s limit is 200.');
    else if (nChars > 75) push(false, nChars + ' characters — Amazon asks for 75 or less to use Item Highlights.');
    const len = lcRule('title_length');
    if (len && nChars && (nChars < +len.params.min || nChars > +len.params.max)) push(false, `Listing Rules: ${len.params.min}–${len.params.max} characters (${len.name}).`);
    const kw = lcRule('title_keyword');
    if (kw && title && !lrWords(kw.params.words).some(word => lrHas(title, word))) {
      // Block Print is never asked of an embroidery colour, nor of a title that says Embroidered (Listing Rules, "What people may write").
      const bp = lrWords(kw.params.words).some(word => lrNorm(word) === 'block print');
      if (!bp || !(lrIsEmbroideryColor(ctx.color || '', LR || LR_DEFAULT) || /embroider/.test(lrNorm(title)))) push(false, `Listing Rules: needs one of "${kw.params.words}" (${kw.name}).`);
    }
    ((LR || LR_DEFAULT).issues || []).filter(issue => issue.detector === 'title_contains' && issue.on !== false)
      .forEach(issue => lrWords(issue.params.words).filter(word => lrHas(title, word)).forEach(word => push(false, `Listing Rules: "${word}" — ${issue.name}.`)));
    const today = new Date();
    const cfg = LR || LR_DEFAULT;
    (cfg.events || []).forEach(ev => {
      const season = lrSeason(ev, today, cfg.events);
      if (lrSeasonState(ev, today, cfg.events).expired && lrWords(ev.words).some(word => lrHas(title, word))   // the one season-date rule
          && !lrWords(ev.except).some(word => lrHas(ctx.subcat || '', word) || lrHas(ctx.color || '', word))) {
        push(false, `Names ${ev.name}, which is out of season now (in season ${lrFmtDate(season.from)} – ${lrFmtDate(season.to)}).`);
      }
    });
    const sizeRule = lcRule('size_format');
    if (sizeRule) {
      const near = lrNear(title, LR || LR_DEFAULT);   // 74–75 characters: the short forms are allowed (Listing Rules, "What people may write")
      hTitleSizes(title).filter(size => !lrSizeOk(size.text, sizeRule.params.example) && !(near && lrSizeLoose(size.text)))
        .forEach(size => push(false, `Size "${size.text}" — Listing Rules write it like "${sizeRule.params.example}".`));
    }
  } else if (field === 'bullet_point') {
    // --- bullets: how many, how long, repeated ---
    const bullets = vals.filter(bullet => bullet.trim());
    const need = lcRule('bullets_below');
    if (need && bullets.length < (+need.params.n || 5)) push(false, `${bullets.length} bullet(s) — Listing Rules want ${+need.params.n || 5}.`);
    bullets.forEach((bullet, i) => {
      if (bullet.length > 500) push(true, `Bullet ${i + 1}: ${bullet.length} characters — Amazon's limit is 500.`);
      else if (bullet.length > 250) push(false, `Bullet ${i + 1}: ${bullet.length} characters — a phone cuts it at about 250.`);
    });
    const seen = {};
    bullets.forEach((bullet, i) => {
      const key = bullet.trim().toLowerCase();
      if (seen[key]) push(false, `Bullet ${i + 1} repeats bullet ${seen[key]}.`);
      else seen[key] = i + 1;
    });
  } else if (field === 'product_description') {
    // --- description: Amazon's limit, the Listing Rules minimum ---
    const desc = vals.join('\n');
    const need = lcRule('desc_below');
    if (desc.length > 2000) push(true, desc.length + ' characters — Amazon\'s limit is 2,000.');
    if (need && desc.length < (+need.params.n || 200)) push(false, `${desc.length} characters — Listing Rules want at least ${+need.params.n || 200}.`);
  } else if (field === 'generic_keyword') {
    // --- search terms: the byte limit the way Amazon counts it (the words only — spaces and ; , . do not count; Listing Rules,
    //     Part A4), no ASINs, nothing the title already says ---
    const text = vals.join(' ');
    const bytes = lrKwBytes(text);
    const max = lcKwMax();
    if (bytes > max) push(true, `${bytes} bytes of words — over ${max} Amazon ignores all of the search terms (spaces and ; , . do not count).`);
    if (/\bB0[A-Z0-9]{8}\b/i.test(text)) push(false, 'Contains an ASIN — Amazon does not want ASINs in search terms.');
    const titleWords = new Set(String(ctx.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2));
    const repeated = [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(word => titleWords.has(word)))];
    if (repeated.length) push(false, `Already in the title (Amazon indexes them once, so these bytes are wasted): ${repeated.slice(0, 8).join(', ')}.`);
  }
  return out;
}

/* ============================================================================================
 * 2. SUGGESTIONS — only from Listing Rules
 * ============================================================================================ */
let LC_RULES_AT = 0;    // when the brand catalogues were last (re)read for this screen
// The rules and both brand catalogues, loaded once and the catalogues refreshed every six hours.
async function lcEnsureRules() {
  if (!LR) await lrLoad();
  if (!LR_CAT.SP || !LR_CAT.CPC || Date.now() - LC_RULES_AT > 6 * 3600 * 1000) {
    await lrLoadCatalog();
    LC_RULES_AT = Date.now();
  }
}
/** The template filled to fit `max`, and what had to come out. Order of what goes: the occasions, the uses phrase, then
 *  the parts the template does not require — but a part carrying a word the title_keyword rule requires is cut down to
 *  that word ("Hand Block Print" → "Block Print") rather than dropped. Only then a required part, last resort, and it is
 *  NAMED in `dropped` so nobody takes a title that breaks the rules for one that follows them. */
// Returns { title, dropped }: the template filled to at most `max` characters, and the required parts that had to go.
function lcTemplateFit(brand, sku, max) {
  const cfg = LR || LR_DEFAULT;
  const row = { brand, sku };
  const tpl = lrTemplateFor(row, cfg);
  if (!tpl) return { title: '', dropped: [] };
  const values = Object.assign({}, lrParts(row, tpl, cfg, new Date()));     // token → text, a copy so it can be trimmed
  const required = lrWords(tpl.required);
  const kwRule = lcRule('title_keyword');
  const keys = kwRule ? lrWords(kwRule.params.words) : [];
  // Fill the template without the tokens in `drop`, then tidy spaces and dashes.
  const fill = drop => String(tpl.template || '').replace(/\{(\w+)\}/g, (_, name) => (drop.includes(name) ? '' : (values[name] || '')))
    .replace(/\s+-\s+(?=-|$)/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+-\s*$/, '').replace(/^\s*-\s+/, '').trim();
  const parts = (String(tpl.template || '').match(/\{(\w+)\}/g) || []).map(token => token.slice(1, -1));
  const drop = [];
  let out = fill(drop);
  // --- what goes first: occasions, uses, the optional parts, then required parts other than brand / product / colour / size ---
  const steps = ['occasions', 'uses']
    .concat(parts.filter(name => !['occasions', 'uses', 'brand', 'product', 'color'].includes(name) && !required.includes(name)),
      required.filter(name => !['brand', 'product', 'color', 'size'].includes(name)));
  for (const name of steps) {
    if (out.length <= max) break;
    if (!values[name] || drop.includes(name)) continue;
    const key = keys.find(word => lrHas(values[name], word));
    if (key && values[name].trim().toLowerCase() !== key.toLowerCase()) {
      values[name] = key;                                 // cut the part down to the required word
      out = fill(drop);
      if (out.length <= max) break;
    }
    if (key) continue;                                   // the required word stays
    drop.push(name);
    out = fill(drop);
  }
  if (out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s,\-–]+$/, '');
  return { title: out, dropped: drop.filter(name => required.includes(name)) };
}
// Just the title of lcTemplateFit.
const lcTemplateTitle = (brand, sku, max) => lcTemplateFit(brand, sku, max).title;
// The search-term byte limit from Listing Rules (the "Search terms over the limit" rule), 249 when the rule is off or gone.
const lcKwMax = () => { const rule = lcRule('keyword_bytes'); return rule ? (+(rule.params || {}).max || 249) : 249; };
/** Search terms: the template's own words that the title does not carry, then what is there now — never past the byte limit. */
function lcSuggestKeywords(brand, sku, title, current) {
  const cfg = LR || LR_DEFAULT;
  const row = { brand, sku };
  const tpl = lrTemplateFor(row, cfg);
  const parts = tpl ? lrParts(row, tpl, cfg, new Date()) : {};
  const stop = new Set(['for', 'and', 'the', 'with', 'of', 'a', 'an', 'to', 'in', 'on', '&', '-', 'x', 'inch']);
  const inTitle = new Set(String(title || '').toLowerCase().split(/[^a-z0-9']+/).filter(Boolean));
  const words = [];
  [parts.uses, parts.occasions, parts.material, parts.pattern, parts.product, parts.shape, current].join(' ').toLowerCase().split(/[^a-z0-9']+/)
    .forEach(word => {
      if (word.length > 1 && !stop.has(word) && !inTitle.has(word) && !/^b0[a-z0-9]{8}$/.test(word) && !words.includes(word)) words.push(word);
    });
  let out = '';
  const max = lcKwMax();
  for (const word of words) {
    const next = out ? out + ' ' + word : word;
    if (lrKwBytes(next) > max) break;
    out = next;
  }
  return out;
}

/* ============================================================================================
 * 3. IN THE FIXER — the Content section of one listing
 * ============================================================================================ */
// The field's values as the screen holds them now: the edit if there is one, else what Amazon sent.
const lcNow = name => (LE_EDIT[name] && LE_EDIT[name].vals) ? lcVals(LE_EDIT[name].vals) : lcVals((LE.attributes || {})[name]);
// Write a field's new values into LE_EDIT — or drop the edit when they equal what Amazon sent.
function lcSetVals(name, list) {
  const lang = lcLang((LE.attributes || {})[name]);
  const before = lcVals((LE.attributes || {})[name]);
  const clean = list.map(str => String(str || ''));
  if (JSON.stringify(clean) === JSON.stringify(before)) {
    delete LE_EDIT[name];
    return;
  }
  LE_EDIT[name] = { vals: clean.map(str => ({ value: str, language_tag: lang })) };
}
// The findings of lcCheck as HTML: red ✕ for what Amazon refuses, amber • for what to look at, or a green tick.
const lcFindHtml = list => list.length
  ? list.map(finding => `<div style="font-size:11.5px;${finding.bad ? 'color:var(--bad-ink);font-weight:600' : 'color:var(--act-ink)'}">`
    + `${finding.bad ? '✕' : '•'} ${leEsc(finding.msg)}</div>`).join('')
  : '<div style="font-size:11.5px;color:var(--accent-ink)">✓ Nothing the rules object to.</div>';
// The ctx lcCheck wants for the listing on screen: its title now and its catalogue sub-category and colour.
function lcCtx() {
  const cat = (LR_CAT[$('leBrand').value] || {})[LE.sku] || {};
  return { title: lcNow('item_name')[0] || '', subcat: cat.subcat, color: cat.color };
}

let LC_FOR = '';        // the SKU the bullet boxes below were counted for
let LC_EXTRA = 0;       // empty bullet boxes added by hand, for the listing on screen
/* A suggestion brought from another screen (the Season planner's "Fix by hand"): { brand, sku, title, kw, hint, done }. When that
 * listing opens here, the title and search-term boxes start with the suggestion typed in and the hint shows above them; nothing is
 * sent until the person presses Apply. Applied once (done), kept for the hint until another listing opens. */
let LC_PREFILL = null;
// The Content section's HTML: title (with the template suggestions), bullets, description, search terms — each with its findings.
function lcSectionHtml() {
  const brand = $('leBrand').value;
  const sku = LE.sku;
  if (LC_FOR !== sku) {
    LC_FOR = sku;
    LC_EXTRA = 0;
    if (LC_PREFILL && (LC_PREFILL.sku !== sku || LC_PREFILL.brand !== brand)) LC_PREFILL = null;
  }
  if (LC_PREFILL && LC_PREFILL.sku === sku && LC_PREFILL.brand === brand && !LC_PREFILL.done) {
    LC_PREFILL.done = true;
    if (LC_PREFILL.title) lcSetVals('item_name', [LC_PREFILL.title]);
    if (LC_PREFILL.kw != null) lcSetVals('generic_keyword', [LC_PREFILL.kw]);
  }
  const hint = LC_PREFILL && LC_PREFILL.sku === sku && LC_PREFILL.hint ? `<div class="lc-hint">✎ From the Season planner: ${leEsc(LC_PREFILL.hint)} The boxes below hold the suggestion — change what you like, then Check and Apply.</div>` : '';
  const title = lcNow('item_name')[0] || '';
  const bullets = lcNow('bullet_point');
  const desc = lcNow('product_description').join('\n');
  const kw = lcNow('generic_keyword').join(' ');
  const tFull = lcTemplateTitle(brand, sku, 200);
  const t75 = lcTemplateTitle(brand, sku, 75);
  const ch = name => LE_EDIT[name] ? ' <span style="color:var(--accent-ink);font-size:11.5px">· changed</span>' : '';
  const nBoxes = Math.min(10, Math.max(5, bullets.length) + LC_EXTRA);
  return `<div class="card" style="padding:10px 14px;margin-bottom:10px">
    <div style="font-weight:600;font-size:13px;margin-bottom:6px">Content <span class="muted" style="font-weight:400;font-size:11.5px">— checked against Listing Rules as you type</span></div>${hint}
    <div style="margin-bottom:10px"><div style="font-weight:600;font-size:12.5px">Title${ch('item_name')}</div>
      <textarea id="lcTitle" rows="2" style="width:100%">${leEsc(title)}</textarea>
      <div class="muted" style="font-size:11px"><span id="lcTitleN">${title.length}</span> characters</div>
      <div id="lcTitleF">${lcFindHtml(lcCheck('item_name', [title], lcCtx()))}</div>
      ${tFull ? `<div style="font-size:11.5px;margin-top:4px" class="muted">Listing Rules template: <b>${leEsc(tFull)}</b> (${tFull.length})
          <button class="ghost im-b" data-lcuse="full">Use it</button>
          ${t75 && t75 !== tFull ? `<br>Cut to 75: <b>${leEsc(t75)}</b> (${t75.length}) <button class="ghost im-b" data-lcuse="75">Use it</button>${
            (dropped => dropped.length ? ` <span style="color:var(--act-ink)">— leaves out what the template requires: ${leEsc(dropped.join(', '))}</span>` : '')(lcTemplateFit(brand, sku, 75).dropped)}` : ''}</div>`
        : `<div class="muted" style="font-size:11.5px;margin-top:4px">No Listing Rules template matches this SKU (its sub-category is not one the templates name, or the SKU is not in the brand catalogue).</div>`}
    </div>
    <div style="margin-bottom:10px"><div style="font-weight:600;font-size:12.5px">Bullet points${ch('bullet_point')}</div>
      ${Array.from({ length: nBoxes }, (_, i) => `<div style="display:flex;gap:6px;align-items:flex-start;margin:3px 0">`
        + `<span class="muted" style="font-size:11px;width:18px;padding-top:6px">${i + 1}</span>
        <textarea class="lcBullet" data-i="${i}" rows="2" style="flex:1">${leEsc(bullets[i] || '')}</textarea>
        <span class="muted lcBulletN" data-i="${i}" style="font-size:11px;width:40px;padding-top:6px">${(bullets[i] || '').length}</span></div>`).join('')}
      ${nBoxes < 10 ? '<button class="ghost im-b" id="lcAddBullet">+ Bullet</button>' : ''}
      <div id="lcBulletsF">${lcFindHtml(lcCheck('bullet_point', bullets))}</div>
      <div class="muted" style="font-size:11px">Listing Rules hold no bullet template, so nothing is written for you here — only checked.</div>
    </div>
    <div style="margin-bottom:10px"><div style="font-weight:600;font-size:12.5px">Description${ch('product_description')}</div>
      <textarea id="lcDesc" rows="5" style="width:100%">${leEsc(desc)}</textarea>
      <div class="muted" style="font-size:11px"><span id="lcDescN">${desc.length}</span> characters</div>
      <div id="lcDescF">${lcFindHtml(lcCheck('product_description', [desc]))}</div>
    </div>
    <div><div style="font-weight:600;font-size:12.5px">Search terms (backend keywords)${ch('generic_keyword')}</div>
      <textarea id="lcKw" rows="2" style="width:100%">${leEsc(kw)}</textarea>
      <div class="muted" style="font-size:11px"><span id="lcKwN">${lrKwBytes(kw)}</span> / ${lcKwMax()} bytes of words (spaces and ; , . do not count)
        <button class="ghost im-b" id="lcKwSug" title="Words from the Listing Rules template this title does not carry, then what is there now">Suggest from Listing Rules</button></div>
      <div id="lcKwF">${lcFindHtml(lcCheck('generic_keyword', [kw], lcCtx()))}</div>
    </div></div>`;
}

// Wire the Content section lcSectionHtml drew: every box writes into LE_EDIT as you type, re-checks, and updates Check / Apply.
function lcWire(redraw) {
  const titleBox = $('lcTitle');
  if (!titleBox) return;
  // Check / Apply follow the number of edited attributes (the fixer's own inputs do the same in listing-errors.js).
  const recount = () => {
    const nChanges = Object.keys(LE_EDIT).length;
    if ($('leApply')) {
      $('leApply').disabled = $('leCheck').disabled = !nChanges;
      $('leApply').textContent = 'Apply to Amazon' + (nChanges ? ' (' + nChanges + ')' : '');
    }
  };
  // --- title ---
  titleBox.oninput = () => {
    lcSetVals('item_name', [titleBox.value]);
    $('lcTitleN').textContent = titleBox.value.length;
    $('lcTitleF').innerHTML = lcFindHtml(lcCheck('item_name', [titleBox.value], lcCtx()));
    $('lcKwF').innerHTML = lcFindHtml(lcCheck('generic_keyword', [$('lcKw').value], lcCtx()));
    recount();
  };
  // --- bullets ---
  const bulletsNow = () => [...document.querySelectorAll('.lcBullet')].map(each => each.value);
  document.querySelectorAll('.lcBullet').forEach(box => box.oninput = () => {
    const list = bulletsNow();
    lcSetVals('bullet_point', list.filter(each => each.trim()));
    const counter = document.querySelector(`.lcBulletN[data-i="${box.dataset.i}"]`);
    if (counter) counter.textContent = box.value.length;
    $('lcBulletsF').innerHTML = lcFindHtml(lcCheck('bullet_point', list));
    recount();
  });
  if ($('lcAddBullet')) $('lcAddBullet').onclick = () => {
    LC_EXTRA++;
    redraw();
    setTimeout(() => {
      const all = document.querySelectorAll('.lcBullet');
      if (all.length) all[all.length - 1].focus();
    }, 0);
  };
  // --- description, search terms ---
  $('lcDesc').oninput = () => {
    lcSetVals('product_description', [$('lcDesc').value]);
    $('lcDescN').textContent = $('lcDesc').value.length;
    $('lcDescF').innerHTML = lcFindHtml(lcCheck('product_description', [$('lcDesc').value]));
    recount();
  };
  $('lcKw').oninput = () => {
    lcSetVals('generic_keyword', [$('lcKw').value]);
    $('lcKwN').textContent = lrKwBytes($('lcKw').value);
    $('lcKwF').innerHTML = lcFindHtml(lcCheck('generic_keyword', [$('lcKw').value], lcCtx()));
    recount();
  };
  // --- the suggestion buttons: Use it (full / cut to 75) and Suggest from Listing Rules ---
  document.querySelectorAll('[data-lcuse]').forEach(btn => btn.onclick = () => {
    titleBox.value = lcTemplateTitle($('leBrand').value, LE.sku, btn.dataset.lcuse === '75' ? 75 : 200);
    titleBox.oninput();
    redraw();
  });
  $('lcKwSug').onclick = () => {
    $('lcKw').value = lcSuggestKeywords($('leBrand').value, LE.sku, titleBox.value, $('lcKw').value);
    $('lcKw').oninput();
  };
}

/* ============================================================================================
 * 4. EXCEL OUT — the content of the listings on screen, with the suggestions beside it
 * ============================================================================================ */
const LC_MAX = 1000;    // listings per file
// The content of many SKUs from the backend (?lfix=content), 20 a call: { sku: { item_name, bullet_point, … , asin, productType } }.
async function lcContentFor(brand, skus, say) {
  const got = {};
  for (let i = 0; i < skus.length; i += 20) {
    if (say) say(`Reading content from Amazon… ${Math.min(i + 20, skus.length)} of ${skus.length}`);
    let reply;
    try {
      reply = await baCall({ lfix: 'content', brand, skus: skus.slice(i, i + 20).join(',') });
    } catch (e) {
      throw new Error(/No ASIN found/.test(e.message || '')
        ? 'the backend is not updated for this yet (lfix=content) — it needs a clasp push'
        : (e.message || e));
    }
    Object.assign(got, reply.items || {});
  }
  return got;
}

// Download: the listings on screen (at most LC_MAX) as an .xlsx — what Amazon holds, the suggestions, and what the rules say.
async function lcDownload() {
  const brand = $('leBrand').value;
  const rows = leRows() || [];
  if (!rows.length) {
    leMsg('No listings on screen to export.', true);
    return;
  }
  if (rows.length > LC_MAX && !confirm(`${rows.length} listings are on screen — only the first ${LC_MAX} go into the file. Narrow the list for the rest.`)) return;
  const list = rows.slice(0, LC_MAX).map(row => row.x);
  $('leDown').disabled = true;
  try {
    await lcEnsureRules();
    const content = await lcContentFor(brand, list.map(item => item.sku), leMsg);
    // --- one column per bullet, as many as the longest listing has (at least 5) ---
    const nBullets = Math.max(5, ...Object.values(content).map(cur => (cur.bullet_point || []).length));
    const head = ['SKU', 'ASIN', 'Product type', 'Colour', 'Size', 'Title', 'Title characters', 'Suggested title (Listing Rules)', 'Suggested title, 75 characters']
      .concat(Array.from({ length: nBullets }, (_, i) => 'Bullet ' + (i + 1)),
        ['Description', 'Search terms', 'Search terms bytes', 'Suggested search terms', 'What the rules say']);
    const out = [head];
    // --- one row per listing ---
    list.forEach(item => {
      const cur = content[item.sku];
      if (!cur) return;
      const title = lcVals(cur.item_name)[0] || '';
      const bullets = lcVals(cur.bullet_point);
      const desc = lcVals(cur.product_description).join('\n');
      const kw = lcVals(cur.generic_keyword).join(' ');
      const cat = (LR_CAT[brand] || {})[item.sku] || {};
      const finds = [].concat(lcCheck('item_name', [title], { subcat: cat.subcat, color: cat.color }), lcCheck('bullet_point', bullets),
        lcCheck('product_description', [desc]), lcCheck('generic_keyword', [kw], { title }))
        .map(finding => (finding.bad ? '✕ ' : '• ') + finding.msg).join('\n');
      out.push([item.sku, item.asin || cur.asin, cur.productType, item.c || cat.color || '', item.z || cat.size || '', title, title.length,
        lcTemplateTitle(brand, item.sku, 200), lcTemplateTitle(brand, item.sku, 75)]
        .concat(Array.from({ length: nBullets }, (_, i) => bullets[i] || ''),
          [desc, kw, lrKwBytes(kw), lcSuggestKeywords(brand, item.sku, title, kw), finds]));
    });
    // --- the file ---
    const blob = new Blob([lcXlsx(out)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `Listing content - ${brand === 'CPC' ? 'CPC' : 'Ridhi'} - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 5000);
    leMsg(`${out.length - 1} listing(s) in the file. Change Title / Bullet / Description / Search terms, then Upload. `
      + `An empty cell leaves that field as it is; the suggested columns are never read back.`);
  } catch (e) {
    leMsg('Could not build the file: ' + (e.message || e), true);
  }
  $('leDown').disabled = false;
}

/* ============================================================================================
 * 5. EXCEL IN — read it back, compare with Amazon now, check and apply row by row
 * ============================================================================================ */
let LC_UP = null;          // { brand, rows: [{ sku, productType, patches, fields:[{name, old, new}], finds, state, msg }] }
// A heading as typed, made comparable: trimmed, lower case, single spaces.
const lcNorm = str => String(str == null ? '' : str).trim().toLowerCase().replace(/\s+/g, ' ');

/** The upload's columns, by name. Only SKU, Title, Bullet N, Description and Search terms are read. */
// Looks for the heading row in the first 10 rows; returns { row, sku, title, desc, kw, bullets[] } as column indexes, or null.
function lcColumns(rows) {
  for (let ix = 0; ix < Math.min(rows.length, 10); ix++) {
    const headers = (rows[ix] || []).map(lcNorm);
    const at = name => headers.indexOf(name);
    if (at('sku') < 0) continue;
    const bullets = headers.map((cell, i) => [cell, i]).filter(([cell]) => /^bullet( point)? ?\d+$/.test(cell))
      .sort((a, b) => +a[0].match(/\d+/)[0] - +b[0].match(/\d+/)[0]).map(([, i]) => i);
    return { row: ix, sku: at('sku'), title: at('title'), desc: at('description'), kw: at('search terms'), bullets };
  }
  return null;
}

// Upload: read the file, keep the filled-in cells per SKU, read those SKUs from Amazon now, and build LC_UP for lcUpRender.
async function lcUpload(file) {
  const brand = $('leBrand').value;
  leMsg('Reading ' + file.name + '…');
  // --- read the file ---
  let rows;
  try {
    rows = /\.xlsx$/i.test(file.name) ? await lcReadXlsx(new Uint8Array(await file.arrayBuffer())) : lcCsv(await file.text());
  } catch (e) {
    leMsg('Could not read that file: ' + (e.message || e), true);
    return;
  }
  const cols = lcColumns(rows);
  if (!cols) {
    leMsg('No "SKU" column found — use the file from Download.', true);
    return;
  }
  // --- what each row wants to change: only the cells that are filled in ---
  const wanted = [];
  rows.slice(cols.row + 1).forEach(cells => {
    const sku = String(cells[cols.sku] || '').trim();
    if (!sku) return;
    const entry = { sku };
    if (cols.title >= 0 && String(cells[cols.title] || '').trim()) entry.item_name = [String(cells[cols.title]).trim()];
    const bullets = cols.bullets.map(ix => String(cells[ix] || '').trim()).filter(Boolean);
    if (bullets.length) entry.bullet_point = bullets;
    if (cols.desc >= 0 && String(cells[cols.desc] || '').trim()) entry.product_description = [String(cells[cols.desc]).trim()];
    if (cols.kw >= 0 && String(cells[cols.kw] || '').trim()) entry.generic_keyword = [String(cells[cols.kw]).trim()];
    wanted.push(entry);
  });
  if (!wanted.length) {
    leMsg('No rows with a SKU in that file.', true);
    return;
  }
  if (wanted.length > 300) {
    leMsg(`${wanted.length} rows — at most 300 at a time, so nothing goes out half-checked. Split the file.`, true);
    return;
  }
  // --- compare with Amazon now: a patch per field that differs, and what the rules say about the new text ---
  try {
    await lcEnsureRules();
    const now = await lcContentFor(brand, wanted.map(entry => entry.sku), leMsg);
    LC_UP = { brand, file: file.name, rows: wanted.map(entry => {
      const cur = now[entry.sku];
      if (!cur) return { sku: entry.sku, state: 'skip', msg: 'Not a listing of this brand', fields: [], patches: [] };
      const fields = [];
      const patches = [];
      LC_FIELDS.forEach(field => {
        if (!entry[field]) return;
        const old = lcVals(cur[field]);
        if (JSON.stringify(old) === JSON.stringify(entry[field])) return;
        fields.push({ name: field, old, new: entry[field] });
        const lang = lcLang(cur[field]);
        patches.push({ op: 'replace', path: '/attributes/' + field, value: entry[field].map(str => ({ value: str, language_tag: lang })) });
      });
      const cat = (LR_CAT[brand] || {})[entry.sku] || {};
      const title = (entry.item_name || lcVals(cur.item_name))[0] || '';
      const finds = fields.flatMap(change => lcCheck(change.name, change.new, { title, subcat: cat.subcat, color: cat.color })
        .map(finding => ({ ...finding, field: change.name })));
      return { sku: entry.sku, productType: cur.productType, fields, patches, finds,
        state: !fields.length ? 'same' : finds.some(finding => finding.bad) ? 'bad' : 'ready', msg: '' };
    }) };
    lcUpRender();
    leMsg('');
  } catch (e) {
    leMsg('Could not compare with Amazon: ' + (e.message || e), true);
  }
}

// Draw the upload's table under the list: counts per state, Check all / Apply all / Close, one row per changed field.
function lcUpRender() {
  const el = $('leUp');
  if (!el) return;
  if (!LC_UP) {
    el.innerHTML = '';
    return;
  }
  const rows = LC_UP.rows;
  const count = state => rows.filter(row => row.state === state).length;
  const short = list => leEsc(String(list.join(' | ')).slice(0, 160)) + (String(list.join(' | ')).length > 160 ? '…' : '');
  const go = rows.filter(row => ['ready', 'checked'].includes(row.state)).length;
  el.innerHTML = `<div class="card" style="padding:10px 14px;margin-bottom:12px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <b style="font-size:13px">Upload: ${leEsc(LC_UP.file)}</b>
      <span class="muted" style="font-size:12px">${rows.length} row(s) · ${count('ready') + count('checked')} to send · ${count('same')} unchanged · ${count('bad')} refused by the rules · ${count('skip')} not found
        ${count('sent') ? ' · <b style="color:var(--accent-ink)">' + count('sent') + ' sent</b>' : ''}${count('fail') ? ' · <b class="err">' + count('fail') + ' refused by Amazon</b>' : ''}</span>
      <span style="flex:1"></span>
      <button class="ghost im-b" id="lcUpCheck" ${go ? '' : 'disabled'}>Check all with Amazon</button>
      <button class="im-b" id="lcUpApply" ${go ? '' : 'disabled'}>Apply all (${go})</button>
      <button class="ghost im-b" id="lcUpClose">Close</button></div>
    <div id="lcUpMsg" class="muted" style="font-size:12px;margin:4px 0"></div>
    <div style="max-height:460px;overflow:auto"><table class="xl" style="width:100%"><thead><tr><th style="text-align:left">SKU</th><th style="text-align:left">Field</th>`
      + `<th style="text-align:left">Now</th><th style="text-align:left">New</th><th style="text-align:left">Rules / result</th></tr></thead><tbody>
    ${rows.filter(row => row.state !== 'same').map(row => (row.fields.length ? row.fields : [{ name: '', old: [], new: [] }]).map((change, i) => `<tr>
      ${i ? '<td></td>' : `<td style="text-align:left;white-space:nowrap;vertical-align:top" rowspan="1">`
        + `<b style="font-family:ui-monospace,monospace">${leEsc(row.sku)}</b></td>`}
      <td style="text-align:left;vertical-align:top">${leEsc(LC_LABEL[change.name] || '')}</td>
      <td style="text-align:left;white-space:normal;font-size:11.5px;vertical-align:top" class="muted">${short(change.old)}</td>
      <td style="text-align:left;white-space:normal;font-size:11.5px;vertical-align:top">${short(change.new)}</td>
      <td style="text-align:left;white-space:normal;font-size:11.5px;vertical-align:top">${i ? '' : lcStateHtml(row)}`
        + `${lcFindHtml((row.finds || []).filter(finding => finding.field === change.name))}</td></tr>`).join('')).join('')}
    </tbody></table></div></div>`;
  $('lcUpClose').onclick = () => {
    LC_UP = null;
    lcUpRender();
  };
  $('lcUpCheck').onclick = () => lcUpSend(false);
  $('lcUpApply').onclick = () => lcUpSend(true);
}
// The state cell of one upload row.
const lcStateHtml = row => ({
  ready: '<b>ready</b>',
  checked: '<b style="color:var(--accent-ink)">Amazon: no objection</b>',
  sent: `<b style="color:var(--accent-ink)">accepted ${leEsc(row.msg)}</b>`,
  fail: `<b class="err">${leEsc(row.msg)}</b>`,
  bad: '<b class="err">not sent — fix what the rules say ✕</b>',
  skip: `<b class="err">${leEsc(row.msg)}</b>`
}[row.state] || '');

/** One SKU at a time, each previewed by Amazon (the backend sends for real only when the preview is clean). Stops after
 *  three refusals in a row: the fourth would fail the same way. */
// Check all (apply = false): ask Amazon about each ready row, here. Apply all (apply = true): THE ONE SEND PATH (#10, listing-send-check.js)
// — the Amazon check popup for every ready row; each row's state follows what Amazon did.
async function lcUpSend(apply) {
  const todo = LC_UP.rows.filter(row => ['ready', 'checked'].includes(row.state));
  if (!todo.length) return;
  if (apply) {
    const up = LC_UP;
    return sqSendWithCheck(todo.map(row => ({ brand: up.brand, sku: row.sku, asin: '', label: row.sku, row, body: { lfix: 'patch', brand: up.brand, sku: row.sku, productType: row.productType, patches: row.patches },
      changes: row.fields.map(change => Object.assign({ field: LC_LABEL[change.name] || change.name, old: change.old.join(' | '), new: change.new.join(' | ') },
        change.name === 'generic_keyword' ? { max: 249, unit: 'bytes' } : {})) })), {
      screen: 'Listing Content upload', title: 'Upload: ' + up.file,
      onSent: (job, reply) => { job.row.state = 'sent'; job.row.msg = reply.submissionId ? '(' + reply.submissionId.slice(0, 8) + '…)' : ''; },
      onDone: sum => {
        sum.jobs.forEach(job => { if (job.state === 'no' || job.state === 'rejected') { job.row.state = 'fail'; job.row.msg = (job.state === 'no' ? 'Amazon says no: ' : 'Amazon rejected: ') + job.why; } });
        if (LC_UP === up) lcUpRender();
      } });
  }
  $('lcUpCheck').disabled = $('lcUpApply').disabled = true;
  let refusals = 0;     // refusals in a row
  let i = 0;
  for (const row of todo) {
    $('lcUpMsg').textContent = `${apply ? 'Sending' : 'Checking'} ${++i} of ${todo.length}: ${row.sku}…`;
    let res;
    try {
      res = await imPost({ lfix: 'patch', brand: LC_UP.brand, sku: row.sku, productType: row.productType, patches: row.patches, apply, by: ME.email });
    } catch (e) {
      res = { ok: false, error: String(e.message || e) };
    }
    if (res.ok) {
      refusals = 0;
      row.state = res.previewOnly ? 'checked' : 'sent';
      row.msg = res.submissionId ? '(' + res.submissionId.slice(0, 8) + '…)' : '';
    } else {
      refusals++;
      row.state = 'fail';
      row.msg = res.error || 'refused';
      if (refusals >= 3) {
        $('lcUpMsg').textContent = 'Stopped after three refusals in a row — read why, fix the file, upload again.';
        break;
      }
    }
  }
  lcUpRender();
  if (refusals < 3) {
    $('lcUpMsg').textContent = apply
      ? 'Done. Amazon updates listings in the background — minutes to a few hours.'
      : 'Checked. Rows Amazon has no objection to are ready to Apply.';
  }
}

/* ============================================================================================
 * 6. XLSX — read and write without a library
 * ============================================================================================ */
const LC_TD = new TextDecoder();    // UTF-8 decoder shared by the zip reader
// Inflate one raw-deflate member with the browser's own DecompressionStream.
async function lcInflate(buf) {
  return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}
// Read the zip's central directory and return { name: bytes } for the entries `want(name)` accepts (inflated when needed).
async function lcUnzip(bytes, want) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // --- find the end-of-central-directory record, scanning back from the end ---
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('That does not look like a .xlsx file.');
  // --- walk the central directory entries ---
  const count = dv.getUint16(end + 10, true);
  let pos = dv.getUint32(end + 16, true);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(pos, true) !== 0x02014b50) break;
    const method = dv.getUint16(pos + 10, true);
    const compSize = dv.getUint32(pos + 20, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const localHead = dv.getUint32(pos + 42, true);
    const name = LC_TD.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    pos += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = localHead + 30 + dv.getUint16(localHead + 26, true) + dv.getUint16(localHead + 28, true);
    const raw = bytes.subarray(start, start + compSize);
    out[name] = method === 0 ? raw : await lcInflate(raw);
  }
  return out;
}
// Undo XML escapes (&amp; last, so "&amp;lt;" does not become "<").
const lcUnesc = str => str.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(+dec))
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  .replace(/&amp;/g, '&');
// Column index of a cell reference: "A1" → 0, "AB7" → 27.
function lcColIx(ref) {
  let index = 0;
  for (const ch of ref.replace(/\d+/g, '')) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}
// The first worksheet of an .xlsx as rows of strings (shared and inline strings, numbers as text).
async function lcReadXlsx(bytes) {
  const files = await lcUnzip(bytes, name => name === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  // --- the shared strings table ---
  const sharedXml = files['xl/sharedStrings.xml'] ? LC_TD.decode(files['xl/sharedStrings.xml']) : '';
  const shared = sharedXml.split('<si>').slice(1).map(si => {
    let text = '';
    for (const match of si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += match[1];
    return lcUnesc(text);
  });
  // --- the first sheet, row by row, cell by cell ---
  const sheet = Object.keys(files).filter(name => name.startsWith('xl/worksheets/')).sort()[0];
  if (!sheet) throw new Error('That .xlsx has no worksheet in it.');
  const rows = [];
  for (const rowMatch of LC_TD.decode(files[sheet]).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attrs = cellMatch[1] ?? cellMatch[3] ?? '';
      const body = cellMatch[2] ?? '';
      const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1];
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      let value = '';
      if (type === 'inlineStr') {
        for (const textMatch of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) value += textMatch[1];
        value = lcUnesc(value);
      } else {
        const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
        value = valueMatch ? lcUnesc(valueMatch[1]) : '';
        if (type === 's') value = shared[Number(value)] ?? '';
      }
      const at = ref ? lcColIx(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    rows.push(cells);
  }
  return rows;
}
// A CSV as rows of strings: quotes, doubled quotes inside quotes, and both line endings.
function lcCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
// The CRC-32 lookup table the zip writer needs.
const LC_CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let crc = n;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xEDB88320 ^ (crc >>> 1) : crc >>> 1;
    table[n] = crc >>> 0;
  }
  return table;
})();
// CRC-32 of a byte array.
function lcCrc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = LC_CRC[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
// A zip (stored, no compression) of [[name, text] …] as one Uint8Array.
function lcZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
  // --- one local header + name + data per file, and its central-directory entry ---
  files.forEach(([name, text]) => {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = lcCrc32(data);
    const head = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0));
    parts.push(new Uint8Array(head), nameBytes, data);
    central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length),
      u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), nameBytes);
    offset += head.length + nameBytes.length + data.length;
  });
  // --- the end-of-central-directory record, then everything joined ---
  const cdSize = central.reduce((sum, part) => sum + part.length, 0);
  const all = parts.concat(central, [new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdSize), u32(offset), u16(0)))]);
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let pos = 0;
  all.forEach(part => {
    out.set(part, pos);
    pos += part.length;
  });
  return out;
}
// Escape text for XML and drop the control characters Excel refuses.
const lcXml = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
// Column name of an index: 0 → "A", 27 → "AB".
const lcColName = i => {
  let name = '';
  i++;
  while (i) {
    const rem = (i - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    i = Math.floor((i - 1) / 26);
  }
  return name;
};
/** One sheet, a bold frozen heading, wrapped text, the suggestion columns shaded so nobody edits them by mistake. */
// rows[0] is the heading. Styles: 1 bold heading, 2 wrapped text, 3 wrapped text on a grey fill (the shaded columns).
function lcXlsx(rows) {
  const head = rows[0] || [];
  const shaded = head.map(heading => /^Suggested|characters$|bytes$|What the rules say/.test(heading));
  const cell = (value, ref, rowIx, colIx) => {
    const styleIx = rowIx === 0 ? 1 : (shaded[colIx] ? 3 : 2);
    if (typeof value === 'number' && isFinite(value)) return `<c r="${ref}" s="${styleIx}"><v>${value}</v></c>`;
    const str = String(value == null ? '' : value);
    if (str === '') return '';
    return `<c r="${ref}" t="inlineStr" s="${styleIx}"><is><t xml:space="preserve">${lcXml(str)}</t></is></c>`;
  };
  const width = heading => /^Bullet|Description|^Title$|Suggested title|What the rules/.test(heading) ? 48
    : /Search terms$|Suggested search/.test(heading) ? 36 : /chars|bytes/.test(heading) ? 10 : 16;
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + head.map((heading, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(heading)}" customWidth="1"/>`).join('') + '</cols>'
    + '<sheetData>' + rows.map((cells, i) => `<row r="${i + 1}">${cells.map((value, j) => cell(value, lcColName(j) + (i + 1), i, j)).join('')}</row>`).join('')
    + '</sheetData></worksheet>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
    + '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>';
  return lcZip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="Content" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styles],
  ]);
}
