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
const LC_FIELDS = ['item_name', 'bullet_point', 'product_description', 'generic_keyword'];
const LC_LABEL = { item_name: 'Title', bullet_point: 'Bullet points', product_description: 'Description', generic_keyword: 'Search terms' };
const lcBytes = s => new TextEncoder().encode(String(s || '')).length;
const lcVals = arr => (arr || []).map(e => String((e && e.value) == null ? '' : e.value));
const lcLang = arr => ((arr || []).find(e => e && e.language_tag) || {}).language_tag || 'en_US';
const lcRule = det => ((LR || LR_DEFAULT).issues || []).find(i => i.detector === det && i.on !== false) || null;

/** What the rules say about one field's text. Each finding: { bad: true = Amazon will refuse / false = look at it, msg }. */
function lcCheck(field, vals, ctx) {
  const out = [], push = (bad, msg) => out.push({ bad, msg });
  ctx = ctx || {};
  if (field === 'item_name') {
    const t = vals[0] || '', n = t.length;
    if (!n) push(true, 'No title.');
    if (n > 200) push(true, n + ' characters — Amazon\'s limit is 200.');
    else if (n > 75) push(false, n + ' characters — Amazon asks for 75 or less to use Item Highlights.');
    const len = lcRule('title_length');
    if (len && n && (n < +len.params.min || n > +len.params.max)) push(false, `Listing Rules: ${len.params.min}–${len.params.max} characters (${len.name}).`);
    const kw = lcRule('title_keyword');
    if (kw && t && !lrWords(kw.params.words).some(w => lrHas(t, w))) push(false, `Listing Rules: needs one of "${kw.params.words}" (${kw.name}).`);
    ((LR || LR_DEFAULT).issues || []).filter(i => i.detector === 'title_contains' && i.on !== false)
      .forEach(i => lrWords(i.params.words).filter(w => lrHas(t, w)).forEach(w => push(false, `Listing Rules: "${w}" — ${i.name}.`)));
    const today = new Date(), cfg = LR || LR_DEFAULT;
    (cfg.events || []).forEach(ev => { const s = lrSeason(ev, today, cfg.events);
      if (!s.inSeason && lrWords(ev.words).some(w => lrHas(t, w)) && !lrWords(ev.except).some(w => lrHas(ctx.subcat || '', w) || lrHas(ctx.color || '', w)))
        push(false, `Names ${ev.name}, which is out of season now (in season ${lrFmtDate(s.from)} – ${lrFmtDate(s.to)}).`); });
    const sz = lcRule('size_format');
    if (sz) hTitleSizes(t).filter(s => !lrSizeOk(s.text, sz.params.example)).forEach(s => push(false, `Size "${s.text}" — Listing Rules write it like "${sz.params.example}".`));
  } else if (field === 'bullet_point') {
    const b = vals.filter(x => x.trim()), need = lcRule('bullets_below');
    if (need && b.length < (+need.params.n || 5)) push(false, `${b.length} bullet(s) — Listing Rules want ${+need.params.n || 5}.`);
    b.forEach((x, i) => { if (x.length > 500) push(true, `Bullet ${i + 1}: ${x.length} characters — Amazon's limit is 500.`);
      else if (x.length > 250) push(false, `Bullet ${i + 1}: ${x.length} characters — a phone cuts it at about 250.`); });
    const seen = {}; b.forEach((x, i) => { const k = x.trim().toLowerCase(); if (seen[k]) push(false, `Bullet ${i + 1} repeats bullet ${seen[k]}.`); else seen[k] = i + 1; });
  } else if (field === 'product_description') {
    const d = vals.join('\n'), need = lcRule('desc_below');
    if (d.length > 2000) push(true, d.length + ' characters — Amazon\'s limit is 2,000.');
    if (need && d.length < (+need.params.n || 200)) push(false, `${d.length} characters — Listing Rules want at least ${+need.params.n || 200}.`);
  } else if (field === 'generic_keyword') {
    const k = vals.join(' '), by = lcBytes(k);
    if (by > 249) push(true, by + ' bytes — Amazon reads only the first 249 (US).');
    if (/\bB0[A-Z0-9]{8}\b/i.test(k)) push(false, 'Contains an ASIN — Amazon does not want ASINs in search terms.');
    const tw = new Set(String(ctx.title || '').toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2));
    const rep = [...new Set(k.toLowerCase().split(/[^a-z0-9]+/).filter(w => tw.has(w)))];
    if (rep.length) push(false, `Already in the title (Amazon indexes them once, so these bytes are wasted): ${rep.slice(0, 8).join(', ')}.`);
  }
  return out;
}

/* ============================================================================================
 * 2. SUGGESTIONS — only from Listing Rules
 * ============================================================================================ */
let LC_RULES_AT = 0;
async function lcEnsureRules() {
  if (!LR) await lrLoad();
  if (!LR_CAT.SP || !LR_CAT.CPC || Date.now() - LC_RULES_AT > 6 * 3600 * 1000) { await lrLoadCatalog(); LC_RULES_AT = Date.now(); }
}
/** The template filled to fit `max`, and what had to come out. Order of what goes: the occasions, the uses phrase, then
 *  the parts the template does not require — but a part carrying a word the title_keyword rule requires is cut down to
 *  that word ("Hand Block Print" → "Block Print") rather than dropped. Only then a required part, last resort, and it is
 *  NAMED in `dropped` so nobody takes a title that breaks the rules for one that follows them. */
function lcTemplateFit(brand, sku, max) {
  const cfg = LR || LR_DEFAULT, r = { brand, sku };
  const t = lrTemplateFor(r, cfg); if (!t) return { title: '', dropped: [] };
  const p = Object.assign({}, lrParts(r, t, cfg, new Date()));
  const required = lrWords(t.required);
  const kwRule = lcRule('title_keyword'), keys = kwRule ? lrWords(kwRule.params.words) : [];
  const fill = drop => String(t.template || '').replace(/\{(\w+)\}/g, (_, k) => (drop.includes(k) ? '' : (p[k] || '')))
    .replace(/\s+-\s+(?=-|$)/g, ' ').replace(/\s{2,}/g, ' ').replace(/\s+-\s*$/, '').replace(/^\s*-\s+/, '').trim();
  const parts = (String(t.template || '').match(/\{(\w+)\}/g) || []).map(x => x.slice(1, -1));
  const drop = [];
  let out = fill(drop);
  const steps = ['occasions', 'uses'].concat(parts.filter(k => !['occasions', 'uses', 'brand', 'product', 'color'].includes(k) && !required.includes(k)),
    required.filter(k => !['brand', 'product', 'color', 'size'].includes(k)));
  for (const k of steps) {
    if (out.length <= max) break;
    if (!p[k] || drop.includes(k)) continue;
    const key = keys.find(w => lrHas(p[k], w));
    if (key && p[k].trim().toLowerCase() !== key.toLowerCase()) { p[k] = key; out = fill(drop); if (out.length <= max) break; }
    if (key) continue;                                   // the required word stays
    drop.push(k); out = fill(drop);
  }
  if (out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s,\-–]+$/, '');
  return { title: out, dropped: drop.filter(k => required.includes(k)) };
}
const lcTemplateTitle = (brand, sku, max) => lcTemplateFit(brand, sku, max).title;
/** Search terms: the template's own words that the title does not carry, then what is there now — never past 249 bytes. */
function lcSuggestKeywords(brand, sku, title, current) {
  const cfg = LR || LR_DEFAULT, r = { brand, sku };
  const t = lrTemplateFor(r, cfg);
  const p = t ? lrParts(r, t, cfg, new Date()) : {};
  const stop = new Set(['for', 'and', 'the', 'with', 'of', 'a', 'an', 'to', 'in', 'on', '&', '-', 'x', 'inch']);
  const inTitle = new Set(String(title || '').toLowerCase().split(/[^a-z0-9']+/).filter(Boolean));
  const words = [];
  [p.uses, p.occasions, p.material, p.pattern, p.product, p.shape, current].join(' ').toLowerCase().split(/[^a-z0-9']+/)
    .forEach(w => { if (w.length > 1 && !stop.has(w) && !inTitle.has(w) && !/^b0[a-z0-9]{8}$/.test(w) && !words.includes(w)) words.push(w); });
  let out = '';
  for (const w of words) { const next = out ? out + ' ' + w : w; if (lcBytes(next) > 249) break; out = next; }
  return out;
}

/* ============================================================================================
 * 3. IN THE FIXER — the Content section of one listing
 * ============================================================================================ */
const lcNow = name => (LE_EDIT[name] && LE_EDIT[name].vals) ? lcVals(LE_EDIT[name].vals) : lcVals((LE.attributes || {})[name]);
function lcSetVals(name, list) {
  const lang = lcLang((LE.attributes || {})[name]);
  const before = lcVals((LE.attributes || {})[name]);
  const clean = list.map(v => String(v || ''));
  if (JSON.stringify(clean) === JSON.stringify(before)) { delete LE_EDIT[name]; return; }
  LE_EDIT[name] = { vals: clean.map(v => ({ value: v, language_tag: lang })) };
}
const lcFindHtml = list => list.length ? list.map(f => `<div style="font-size:11.5px;${f.bad ? 'color:var(--bad);font-weight:600' : 'color:#92400e'}">${f.bad ? '✕' : '•'} ${leEsc(f.msg)}</div>`).join('')
  : '<div style="font-size:11.5px;color:var(--accent)">✓ Nothing the rules object to.</div>';
function lcCtx() { const c = (LR_CAT[$('leBrand').value] || {})[LE.sku] || {}; return { title: lcNow('item_name')[0] || '', subcat: c.subcat, color: c.color }; }

let LC_FOR = '', LC_EXTRA = 0;          // empty bullet boxes added by hand, for the listing on screen
function lcSectionHtml() {
  const brand = $('leBrand').value, sku = LE.sku;
  if (LC_FOR !== sku) { LC_FOR = sku; LC_EXTRA = 0; }
  const title = lcNow('item_name')[0] || '', bullets = lcNow('bullet_point'), desc = lcNow('product_description').join('\n'), kw = lcNow('generic_keyword').join(' ');
  const tFull = lcTemplateTitle(brand, sku, 200), t75 = lcTemplateTitle(brand, sku, 75);
  const ch = n => LE_EDIT[n] ? ' <span style="color:var(--accent);font-size:11.5px">· changed</span>' : '';
  const nb = Math.min(10, Math.max(5, bullets.length) + LC_EXTRA);
  return `<div class="card" style="padding:10px 14px;margin-bottom:10px">
    <div style="font-weight:600;font-size:13px;margin-bottom:6px">Content <span class="muted" style="font-weight:400;font-size:11.5px">— checked against Listing Rules as you type</span></div>
    <div style="margin-bottom:10px"><div style="font-weight:600;font-size:12.5px">Title${ch('item_name')}</div>
      <textarea id="lcTitle" rows="2" style="width:100%">${leEsc(title)}</textarea>
      <div class="muted" style="font-size:11px"><span id="lcTitleN">${title.length}</span> characters</div>
      <div id="lcTitleF">${lcFindHtml(lcCheck('item_name', [title], lcCtx()))}</div>
      ${tFull ? `<div style="font-size:11.5px;margin-top:4px" class="muted">Listing Rules template: <b>${leEsc(tFull)}</b> (${tFull.length})
          <button class="ghost im-b" data-lcuse="full">Use it</button>
          ${t75 && t75 !== tFull ? `<br>Cut to 75: <b>${leEsc(t75)}</b> (${t75.length}) <button class="ghost im-b" data-lcuse="75">Use it</button>${(d75 => d75.length ? ` <span style="color:#92400e">— leaves out what the template requires: ${leEsc(d75.join(', '))}</span>` : '')(lcTemplateFit(brand, sku, 75).dropped)}` : ''}</div>`
        : `<div class="muted" style="font-size:11.5px;margin-top:4px">No Listing Rules template matches this SKU (its sub-category is not one the templates name, or the SKU is not in the brand catalogue).</div>`}
    </div>
    <div style="margin-bottom:10px"><div style="font-weight:600;font-size:12.5px">Bullet points${ch('bullet_point')}</div>
      ${Array.from({ length: nb }, (_, i) => `<div style="display:flex;gap:6px;align-items:flex-start;margin:3px 0"><span class="muted" style="font-size:11px;width:18px;padding-top:6px">${i + 1}</span>
        <textarea class="lcBullet" data-i="${i}" rows="2" style="flex:1">${leEsc(bullets[i] || '')}</textarea>
        <span class="muted lcBulletN" data-i="${i}" style="font-size:11px;width:40px;padding-top:6px">${(bullets[i] || '').length}</span></div>`).join('')}
      ${nb < 10 ? '<button class="ghost im-b" id="lcAddBullet">+ Bullet</button>' : ''}
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
      <div class="muted" style="font-size:11px"><span id="lcKwN">${lcBytes(kw)}</span> / 249 bytes
        <button class="ghost im-b" id="lcKwSug" title="Words from the Listing Rules template this title does not carry, then what is there now">Suggest from Listing Rules</button></div>
      <div id="lcKwF">${lcFindHtml(lcCheck('generic_keyword', [kw], lcCtx()))}</div>
    </div></div>`;
}

function lcWire(redraw) {
  const T = $('lcTitle'); if (!T) return;
  const recount = () => {
    const n = Object.keys(LE_EDIT).length;
    if ($('leApply')) { $('leApply').disabled = $('leCheck').disabled = !n; $('leApply').textContent = 'Apply to Amazon' + (n ? ' (' + n + ')' : ''); }
  };
  T.oninput = () => { lcSetVals('item_name', [T.value]); $('lcTitleN').textContent = T.value.length;
    $('lcTitleF').innerHTML = lcFindHtml(lcCheck('item_name', [T.value], lcCtx()));
    $('lcKwF').innerHTML = lcFindHtml(lcCheck('generic_keyword', [$('lcKw').value], lcCtx())); recount(); };
  const bulletsNow = () => [...document.querySelectorAll('.lcBullet')].map(x => x.value);
  document.querySelectorAll('.lcBullet').forEach(b => b.oninput = () => {
    const list = bulletsNow(); lcSetVals('bullet_point', list.filter(x => x.trim()));
    const c = document.querySelector(`.lcBulletN[data-i="${b.dataset.i}"]`); if (c) c.textContent = b.value.length;
    $('lcBulletsF').innerHTML = lcFindHtml(lcCheck('bullet_point', list)); recount(); });
  if ($('lcAddBullet')) $('lcAddBullet').onclick = () => { LC_EXTRA++; redraw(); setTimeout(() => { const all = document.querySelectorAll('.lcBullet'); if (all.length) all[all.length - 1].focus(); }, 0); };
  $('lcDesc').oninput = () => { lcSetVals('product_description', [$('lcDesc').value]); $('lcDescN').textContent = $('lcDesc').value.length;
    $('lcDescF').innerHTML = lcFindHtml(lcCheck('product_description', [$('lcDesc').value])); recount(); };
  $('lcKw').oninput = () => { lcSetVals('generic_keyword', [$('lcKw').value]); $('lcKwN').textContent = lcBytes($('lcKw').value);
    $('lcKwF').innerHTML = lcFindHtml(lcCheck('generic_keyword', [$('lcKw').value], lcCtx())); recount(); };
  document.querySelectorAll('[data-lcuse]').forEach(b => b.onclick = () => {
    T.value = lcTemplateTitle($('leBrand').value, LE.sku, b.dataset.lcuse === '75' ? 75 : 200); T.oninput(); redraw(); });
  $('lcKwSug').onclick = () => { $('lcKw').value = lcSuggestKeywords($('leBrand').value, LE.sku, T.value, $('lcKw').value); $('lcKw').oninput(); };
}

/* ============================================================================================
 * 4. EXCEL OUT — the content of the listings on screen, with the suggestions beside it
 * ============================================================================================ */
const LC_MAX = 1000;
async function lcContentFor(brand, skus, say) {
  const got = {};
  for (let i = 0; i < skus.length; i += 20) {
    if (say) say(`Reading content from Amazon… ${Math.min(i + 20, skus.length)} of ${skus.length}`);
    let r;
    try { r = await baCall({ lfix: 'content', brand, skus: skus.slice(i, i + 20).join(',') }); }
    catch (e) { throw new Error(/No ASIN found/.test(e.message || '') ? 'the backend is not updated for this yet (lfix=content) — it needs a clasp push' : (e.message || e)); }
    Object.assign(got, r.items || {});
  }
  return got;
}

async function lcDownload() {
  const brand = $('leBrand').value, rows = leRows() || [];
  if (!rows.length) { leMsg('No listings on screen to export.', true); return; }
  if (rows.length > LC_MAX && !confirm(`${rows.length} listings are on screen — only the first ${LC_MAX} go into the file. Narrow the list for the rest.`)) return;
  const list = rows.slice(0, LC_MAX).map(r => r.x);
  $('leDown').disabled = true;
  try {
    await lcEnsureRules();
    const content = await lcContentFor(brand, list.map(x => x.sku), leMsg);
    const nb = Math.max(5, ...Object.values(content).map(c => (c.bullet_point || []).length));
    const head = ['SKU', 'ASIN', 'Product type', 'Colour', 'Size', 'Title', 'Title characters', 'Suggested title (Listing Rules)', 'Suggested title, 75 characters']
      .concat(Array.from({ length: nb }, (_, i) => 'Bullet ' + (i + 1)), ['Description', 'Search terms', 'Search terms bytes', 'Suggested search terms', 'What the rules say']);
    const out = [head];
    list.forEach(x => {
      const c = content[x.sku]; if (!c) return;
      const title = lcVals(c.item_name)[0] || '', bullets = lcVals(c.bullet_point), desc = lcVals(c.product_description).join('\n'), kw = lcVals(c.generic_keyword).join(' ');
      const cat = (LR_CAT[brand] || {})[x.sku] || {};
      const finds = [].concat(lcCheck('item_name', [title], { subcat: cat.subcat, color: cat.color }), lcCheck('bullet_point', bullets),
        lcCheck('product_description', [desc]), lcCheck('generic_keyword', [kw], { title })).map(f => (f.bad ? '✕ ' : '• ') + f.msg).join('\n');
      out.push([x.sku, x.asin || c.asin, c.productType, x.c || cat.color || '', x.z || cat.size || '', title, title.length,
        lcTemplateTitle(brand, x.sku, 200), lcTemplateTitle(brand, x.sku, 75)]
        .concat(Array.from({ length: nb }, (_, i) => bullets[i] || ''), [desc, kw, lcBytes(kw), lcSuggestKeywords(brand, x.sku, title, kw), finds]));
    });
    const blob = new Blob([lcXlsx(out)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `Listing content - ${brand === 'CPC' ? 'CPC' : 'Ridhi'} - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    leMsg(`${out.length - 1} listing(s) in the file. Change Title / Bullet / Description / Search terms, then Upload. An empty cell leaves that field as it is; the suggested columns are never read back.`);
  } catch (e) { leMsg('Could not build the file: ' + (e.message || e), true); }
  $('leDown').disabled = false;
}

/* ============================================================================================
 * 5. EXCEL IN — read it back, compare with Amazon now, check and apply row by row
 * ============================================================================================ */
let LC_UP = null;          // { brand, rows: [{ sku, productType, patches, fields:[{name, old, new}], finds, state, msg }] }
const lcNorm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');

/** The upload's columns, by name. Only SKU, Title, Bullet N, Description and Search terms are read. */
function lcColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const h = (rows[r] || []).map(lcNorm), at = n => h.indexOf(n);
    if (at('sku') < 0) continue;
    const bullets = h.map((x, i) => [x, i]).filter(([x]) => /^bullet( point)? ?\d+$/.test(x)).sort((a, b) => +a[0].match(/\d+/)[0] - +b[0].match(/\d+/)[0]).map(([, i]) => i);
    return { row: r, sku: at('sku'), title: at('title'), desc: at('description'), kw: at('search terms'), bullets };
  }
  return null;
}

async function lcUpload(file) {
  const brand = $('leBrand').value;
  leMsg('Reading ' + file.name + '…');
  let rows;
  try { rows = /\.xlsx$/i.test(file.name) ? await lcReadXlsx(new Uint8Array(await file.arrayBuffer())) : lcCsv(await file.text()); }
  catch (e) { leMsg('Could not read that file: ' + (e.message || e), true); return; }
  const c = lcColumns(rows);
  if (!c) { leMsg('No "SKU" column found — use the file from Download.', true); return; }
  const wanted = [];
  rows.slice(c.row + 1).forEach(r => {
    const sku = String(r[c.sku] || '').trim(); if (!sku) return;
    const w = { sku };
    if (c.title >= 0 && String(r[c.title] || '').trim()) w.item_name = [String(r[c.title]).trim()];
    const b = c.bullets.map(i => String(r[i] || '').trim()).filter(Boolean);
    if (b.length) w.bullet_point = b;
    if (c.desc >= 0 && String(r[c.desc] || '').trim()) w.product_description = [String(r[c.desc]).trim()];
    if (c.kw >= 0 && String(r[c.kw] || '').trim()) w.generic_keyword = [String(r[c.kw]).trim()];
    wanted.push(w);
  });
  if (!wanted.length) { leMsg('No rows with a SKU in that file.', true); return; }
  if (wanted.length > 300) { leMsg(`${wanted.length} rows — at most 300 at a time, so nothing goes out half-checked. Split the file.`, true); return; }
  try {
    await lcEnsureRules();
    const now = await lcContentFor(brand, wanted.map(w => w.sku), leMsg);
    LC_UP = { brand, file: file.name, rows: wanted.map(w => {
      const cur = now[w.sku];
      if (!cur) return { sku: w.sku, state: 'skip', msg: 'Not a listing of this brand', fields: [], patches: [] };
      const fields = [], patches = [];
      LC_FIELDS.forEach(n => {
        if (!w[n]) return;
        const old = lcVals(cur[n]);
        if (JSON.stringify(old) === JSON.stringify(w[n])) return;
        fields.push({ name: n, old, new: w[n] });
        const lang = lcLang(cur[n]);
        patches.push({ op: 'replace', path: '/attributes/' + n, value: w[n].map(v => ({ value: v, language_tag: lang })) });
      });
      const cat = (LR_CAT[brand] || {})[w.sku] || {};
      const title = (w.item_name || lcVals(cur.item_name))[0] || '';
      const finds = fields.flatMap(f => lcCheck(f.name, f.new, { title, subcat: cat.subcat, color: cat.color }).map(x => ({ ...x, field: f.name })));
      return { sku: w.sku, productType: cur.productType, fields, patches, finds,
        state: !fields.length ? 'same' : finds.some(x => x.bad) ? 'bad' : 'ready', msg: '' };
    }) };
    lcUpRender();
    leMsg('');
  } catch (e) { leMsg('Could not compare with Amazon: ' + (e.message || e), true); }
}

function lcUpRender() {
  const el = $('leUp'); if (!el) return;
  if (!LC_UP) { el.innerHTML = ''; return; }
  const R = LC_UP.rows, n = s => R.filter(r => r.state === s).length;
  const short = v => leEsc(String(v.join(' | ')).slice(0, 160)) + (String(v.join(' | ')).length > 160 ? '…' : '');
  const go = R.filter(r => ['ready', 'checked'].includes(r.state)).length;
  el.innerHTML = `<div class="card" style="padding:10px 14px;margin-bottom:12px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <b style="font-size:13px">Upload: ${leEsc(LC_UP.file)}</b>
      <span class="muted" style="font-size:12px">${R.length} row(s) · ${n('ready') + n('checked')} to send · ${n('same')} unchanged · ${n('bad')} refused by the rules · ${n('skip')} not found
        ${n('sent') ? ' · <b style="color:var(--accent)">' + n('sent') + ' sent</b>' : ''}${n('fail') ? ' · <b class="err">' + n('fail') + ' refused by Amazon</b>' : ''}</span>
      <span style="flex:1"></span>
      <button class="ghost im-b" id="lcUpCheck" ${go ? '' : 'disabled'}>Check all with Amazon</button>
      <button class="im-b" id="lcUpApply" ${go ? '' : 'disabled'}>Apply all (${go})</button>
      <button class="ghost im-b" id="lcUpClose">Close</button></div>
    <div id="lcUpMsg" class="muted" style="font-size:12px;margin:4px 0"></div>
    <div style="max-height:460px;overflow:auto"><table class="xl" style="width:100%"><thead><tr><th style="text-align:left">SKU</th><th style="text-align:left">Field</th><th style="text-align:left">Now</th><th style="text-align:left">New</th><th style="text-align:left">Rules / result</th></tr></thead><tbody>
    ${R.filter(r => r.state !== 'same').map(r => (r.fields.length ? r.fields : [{ name: '', old: [], new: [] }]).map((f, i) => `<tr>
      ${i ? '<td></td>' : `<td style="text-align:left;white-space:nowrap;vertical-align:top" rowspan="1"><b style="font-family:ui-monospace,monospace">${leEsc(r.sku)}</b></td>`}
      <td style="text-align:left;vertical-align:top">${leEsc(LC_LABEL[f.name] || '')}</td>
      <td style="text-align:left;white-space:normal;font-size:11.5px;vertical-align:top" class="muted">${short(f.old)}</td>
      <td style="text-align:left;white-space:normal;font-size:11.5px;vertical-align:top">${short(f.new)}</td>
      <td style="text-align:left;white-space:normal;font-size:11.5px;vertical-align:top">${i ? '' : lcStateHtml(r)}${lcFindHtml((r.finds || []).filter(x => x.field === f.name))}</td></tr>`).join('')).join('')}
    </tbody></table></div></div>`;
  $('lcUpClose').onclick = () => { LC_UP = null; lcUpRender(); };
  $('lcUpCheck').onclick = () => lcUpSend(false);
  $('lcUpApply').onclick = () => lcUpSend(true);
}
const lcStateHtml = r => ({ ready: '<b>ready</b>', checked: '<b style="color:var(--accent)">Amazon: no objection</b>', sent: `<b style="color:var(--accent)">accepted ${leEsc(r.msg)}</b>`,
  fail: `<b class="err">${leEsc(r.msg)}</b>`, bad: '<b class="err">not sent — fix what the rules say ✕</b>', skip: `<b class="err">${leEsc(r.msg)}</b>` }[r.state] || '');

/** One SKU at a time, each previewed by Amazon (the backend sends for real only when the preview is clean). Stops after
 *  three refusals in a row: the fourth would fail the same way. */
async function lcUpSend(apply) {
  const todo = LC_UP.rows.filter(r => ['ready', 'checked'].includes(r.state));
  if (!todo.length) return;
  if (apply && !confirm(`Send the changes for ${todo.length} listing(s) to Amazon?\n\nEach is checked by Amazon first; one Amazon objects to is not sent and is named.`)) return;
  $('lcUpCheck').disabled = $('lcUpApply').disabled = true;
  let run = 0, i = 0;
  for (const r of todo) {
    $('lcUpMsg').textContent = `${apply ? 'Sending' : 'Checking'} ${++i} of ${todo.length}: ${r.sku}…`;
    let res;
    try { res = await imPost({ lfix: 'patch', brand: LC_UP.brand, sku: r.sku, productType: r.productType, patches: r.patches, apply, by: ME.email }); }
    catch (e) { res = { ok: false, error: String(e.message || e) }; }
    if (res.ok) { run = 0; r.state = res.previewOnly ? 'checked' : 'sent'; r.msg = res.submissionId ? '(' + res.submissionId.slice(0, 8) + '…)' : ''; }
    else { run++; r.state = 'fail'; r.msg = res.error || 'refused'; if (run >= 3) { $('lcUpMsg').textContent = 'Stopped after three refusals in a row — read why, fix the file, upload again.'; break; } }
  }
  lcUpRender();
  if (run < 3) $('lcUpMsg').textContent = apply ? 'Done. Amazon updates listings in the background — minutes to a few hours.' : 'Checked. Rows Amazon has no objection to are ready to Apply.';
}

/* ============================================================================================
 * 6. XLSX — read and write without a library
 * ============================================================================================ */
const LC_TD = new TextDecoder();
async function lcInflate(buf) { return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
async function lcUnzip(bytes, want) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('That does not look like a .xlsx file.');
  const count = dv.getUint16(end + 10, true); let p = dv.getUint32(end + 16, true); const out = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = LC_TD.decode(bytes.subarray(p + 46, p + 46 + nlen)); p += 46 + nlen + elen + clen;
    if (!want(name)) continue;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true), raw = bytes.subarray(start, start + csize);
    out[name] = method === 0 ? raw : await lcInflate(raw);
  }
  return out;
}
const lcUnesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&');
function lcColIx(ref) { let n = 0; for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; }
async function lcReadXlsx(bytes) {
  const files = await lcUnzip(bytes, n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const sx = files['xl/sharedStrings.xml'] ? LC_TD.decode(files['xl/sharedStrings.xml']) : '';
  const shared = sx.split('<si>').slice(1).map(si => { let s = ''; for (const m of si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += m[1]; return lcUnesc(s); });
  const sheet = Object.keys(files).filter(n => n.startsWith('xl/worksheets/')).sort()[0];
  if (!sheet) throw new Error('That .xlsx has no worksheet in it.');
  const rows = [];
  for (const rm of LC_TD.decode(files[sheet]).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of rm[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attrs = cm[1] ?? cm[3] ?? '', body = cm[2] ?? '';
      const ref = (attrs.match(/r="([A-Z]+)\d+"/) || [])[1], type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      let v = '';
      if (type === 'inlineStr') { for (const t of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) v += t[1]; v = lcUnesc(v); }
      else { const vm = body.match(/<v>([\s\S]*?)<\/v>/); v = vm ? lcUnesc(vm[1]) : ''; if (type === 's') v = shared[Number(v)] ?? ''; }
      const at = ref ? lcColIx(ref) : cells.length;
      while (cells.length < at) cells.push('');
      cells[at] = v;
    }
    rows.push(cells);
  }
  return rows;
}
function lcCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const LC_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function lcCrc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = LC_CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function lcZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF], u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];
  files.forEach(([name, text]) => {
    const nb = enc.encode(name), data = enc.encode(text), crc = lcCrc32(data);
    const head = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0));
    parts.push(new Uint8Array(head), nb, data);
    central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), nb);
    offset += head.length + nb.length + data.length;
  });
  const cd = central.reduce((a, b) => a + b.length, 0);
  const all = parts.concat(central, [new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd), u32(offset), u16(0)))]);
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; all.forEach(b => { out.set(b, p); p += b.length; });
  return out;
}
const lcXml = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const lcColName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
/** One sheet, a bold frozen heading, wrapped text, the suggestion columns shaded so nobody edits them by mistake. */
function lcXlsx(rows) {
  const head = rows[0] || [], sug = head.map(h => /^Suggested|characters$|bytes$|What the rules say/.test(h));
  const cell = (v, ref, r, c) => {
    const st = r === 0 ? 1 : (sug[c] ? 3 : 2);
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="${st}"><v>${v}</v></c>`;
    const s = String(v == null ? '' : v); if (s === '') return '';
    return `<c r="${ref}" t="inlineStr" s="${st}"><is><t xml:space="preserve">${lcXml(s)}</t></is></c>`;
  };
  const width = h => /^Bullet|Description|^Title$|Suggested title|What the rules/.test(h) ? 48 : /Search terms$|Suggested search/.test(h) ? 36 : /chars|bytes/.test(h) ? 10 : 16;
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
    + '<cols>' + head.map((h, i) => `<col min="${i + 1}" max="${i + 1}" width="${width(h)}" customWidth="1"/>`).join('') + '</cols>'
    + '<sheetData>' + rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => cell(v, lcColName(j) + (i + 1), i, j)).join('')}</row>`).join('') + '</sheetData></worksheet>';
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
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
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="Content" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheet],
    ['xl/styles.xml', styles],
  ]);
}
