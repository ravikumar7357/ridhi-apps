/* ================= LISTING OPTIMISER =================
 *
 * One ASIN at a time, on demand. That is not a smaller version of a catalogue-wide tool — it is the
 * right shape for this data: Search Query Performance is ONE REPORT PER ASIN (Amazon's words:
 * "this report type requires the report option(s): asin"), so nothing here can be pre-computed for
 * 3,646 listings without a rotation that would take weeks to come round.
 *
 * Everything shown is measured. Findings come from Amazon's own attributes and its stated rules;
 * the suggested title only ever REARRANGES what is already there. Nothing on this screen invents a
 * fact about a product, because a title claiming a material the product lacks is a suppression.
 */
let LO_DATA = null, LO_SQP = null, LO_SQP_ID = '';

function loMsg(t, bad) { const el = $('loMsg'); if (el) { el.textContent = t || ''; el.className = bad ? 'err' : 'muted'; } }

function ensureOpt() {
  if (!$('loAsin').value && LO_LAST) $('loAsin').value = LO_LAST;
}
let LO_LAST = '';

$('loGo').onclick = async () => {
  const a = ($('loAsin').value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(a)) { loMsg('That is not an ASIN — ten letters and digits, like B0XXXXXXXX.', true); return; }
  LO_LAST = a; LO_SQP = null; LO_SQP_ID = '';
  $('loGo').disabled = true;
  loMsg('Reading the listing…');
  try {
    const r = await baCall({ listing: 'review', asin: a, brand: $('loBrand').value,
      target: $('loTarget').value || '' });
    LO_DATA = r;
    renderOpt();
    loMsg('');
  } catch (e) {
    LO_DATA = null;
    $('loBody').innerHTML = '';
    loMsg('Could not read that listing: ' + (e.message || e), true);
  }
  $('loGo').disabled = false;
};
$('loAsin').addEventListener('keydown', e => { if (e.key === 'Enter') $('loGo').click(); });
// Changing the target re-reads, because the suggested title is built to it. Cheap: one round trip.
$('loTarget').addEventListener('change', () => { if (LO_DATA) $('loGo').click(); });

const loEsc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/** One findings list. `[FIX]` and `[look]` are kept visually apart: a screen where everything is red
 *  is a screen nobody reads twice. */
function loFindings(list) {
  if (!list || !list.length) return '<div class="muted" style="font-size:12px">Nothing to fix here.</div>';
  return list.map(f => `<div style="display:flex;gap:8px;margin:4px 0;font-size:12.5px">
      <span class="st ${f.bad ? 'st-rejected' : 'st-draft'}" style="flex:none">${f.bad ? 'fix' : 'look'}</span>
      <span>${loEsc(f.msg)}</span></div>`).join('');
}

function renderOpt() {
  const d = LO_DATA; if (!d) return;
  const a = d.audit, f = d.findings, s = d.suggestion, k = d.keywords;

  /* THE IMAGES THEMSELVES, not a list of slot names. "PT03 is filled" tells nobody whether PT03 is a
   * lifestyle shot, a dimensions graphic or the same photo again — and that is the only question
   * worth asking about a set of images. The slot and the size ride along underneath. */
  const imgs = Object.keys(a.images.slots || {}).sort().map(v => {
    const im = a.images.slots[v];
    const small = Math.max(im.w, im.h) < 1000;
    return `<div style="text-align:center;flex:0 0 108px">
      <a href="${loEsc(im.link)}" target="_blank" rel="noopener">
        <img src="${loEsc(im.link)}" alt="${v}" loading="lazy" decoding="async"
             style="width:104px;height:104px;object-fit:contain;border:1px solid var(--line);
                    border-radius:6px;background:#fff"></a>
      <div style="font-size:11px;font-weight:600;margin-top:2px">${v}</div>
      <div class="muted" style="font-size:10.5px${small ? ';color:#991b1b' : ''}">${im.w}${'×'}${im.h}${small ? ' · no zoom' : ''}</div>
    </div>`;
  }).join('');

  /* THE TITLE, BEFORE AND AFTER, with every reason underneath. A suggestion nobody can check is a
   * suggestion nobody should apply — especially one that will be pasted into 3,646 live listings. */
  /* WHAT ACTUALLY CHANGED, marked. Two long strings side by side is a spot-the-difference puzzle,
   * and on a 189-to-75 character cut nobody wins it. Words present in one and not the other are
   * marked in place: removed struck through, added in green. */
  const loDiff = (from, to) => {
    const set = t => new Set(String(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
    const A = set(from), B = set(to);
    const mark = (text, other, cls) => String(text).split(/(\s+)/).map(tok => {
      const k = tok.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!k || other.has(k)) return loEsc(tok);
      return `<span class="${cls}">${loEsc(tok)}</span>`;
    }).join('');
    return { from: mark(from, B, 'lo-gone'), to: mark(to, A, 'lo-new') };
  };
  const df = loDiff(s && s.ok ? s.current : '', s && s.ok ? s.suggested : '');

  const titleBlock = s && s.ok ? `
    <div style="display:grid;gap:8px">
      <div><div class="muted" style="font-size:11px">CURRENT · ${s.curLen} chars${s.curLen > 75 ? ' · over the 75-character cap' : ''}</div>
        <div style="font-size:13px">${df.from}</div></div>
      <div><div class="muted" style="font-size:11px">SUGGESTED · ${s.newLen} chars${s.newLen > (s.cap || 75) ? ' · still over target' : ''}</div>
        <div style="font-size:13px;font-weight:600">${df.to}</div></div>
      ${s.highlights ? `<div><div class="muted" style="font-size:11px">ITEM HIGHLIGHTS · what was cut, ${s.highlights.length} of ${125} chars</div>
        <div style="font-size:12.5px">${loEsc(s.highlights)}</div>
        <div class="muted" style="font-size:11px">Amazon split the old 200-character budget on 27 July 2026: 75 for the title, 125 for this field. What comes out of the title goes in here — it is not lost.</div></div>` : ''}
      ${s.why.length ? `<div class="muted" style="font-size:12px">
        ${s.why.map(w => '· ' + loEsc(w)).join('<br>')}</div>` : ''}
      <div><button class="ghost" id="loCopy" style="width:auto;padding:4px 12px;font-size:12px">Copy suggested title</button></div>
    </div>` : '<div class="muted">No title to work from.</div>';

  /* KEYWORDS. The trust level is the loudest thing here on purpose: words from a shared ad group may
   * belong to a different product, and putting those in a title is the one mistake this whole design
   * exists to prevent. */
  let kwBlock;
  if (k.trust === 'clean') {
    kwBlock = `<div class="muted" style="font-size:12px;margin-bottom:6px">From ${k.nClean} search term(s) in single-product ad groups.</div>`
      + (k.words.length ? loWordTable(k.words) : '<div class="muted">Every word shoppers used is already in the listing.</div>');
  } else if (k.trust === 'shared') {
    kwBlock = `<div class="err" style="font-size:12.5px;margin-bottom:6px">${loEsc(k.note)}</div>`
      + `<div class="muted" style="font-size:12px;margin-bottom:6px">Shown for information only — these are the AD GROUP's words and are not used in the suggestion above.</div>`
      + loWordTable(k.wordsShared, true);
  } else {
    kwBlock = `<div class="muted" style="font-size:12.5px">${loEsc(k.note || 'No advertising history for this ASIN.')}</div>`;
  }

  $('loBody').innerHTML = `
    <div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline">
        <b style="font-size:15px">${loEsc(a.asin)}</b>
        <span class="muted" style="font-size:12px">${loEsc(a.brand)} · ${loEsc(a.category)}</span>
        ${a.rank ? `<span class="muted" style="font-size:12px">rank ${a.rank.value.toLocaleString('en-US')} in ${loEsc(a.rank.title)}</span>` : ''}
      </div>
    </div>

    <div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div class="sec" style="margin-top:0">Title</div>
      ${titleBlock}
      <div style="margin-top:10px">${loFindings(f.title)}</div>
    </div>

    <div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div class="sec" style="margin-top:0">Search terms</div>
      ${k.checked ? `<div class="muted" style="font-size:11.5px;margin-bottom:6px">
        "Never says" was checked against the title (${k.checked.title} chars), ${k.checked.bullets}
        bullet(s) and the description (${k.checked.description} chars) — all three, not the title alone.</div>` : ''}
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        <b>Backend keywords cannot be read.</b> They are seller-private: not on the Catalog API and
        nowhere public. Reading them needs the Listings Items API, which needs the Product Listing
        role and this brand's merchant token. Shown below is what shoppers actually searched.
      </div>
      ${kwBlock}
      ${(k.altSizes && k.altSizes.length) ? `
        <div class="sec" style="margin:14px 0 4px;font-size:11px">Sizes written another way</div>
        <div class="muted" style="font-size:11.5px;margin-bottom:6px">
          Shoppers search <b>18x18</b>; your listing says <b>18" × 18"</b>. Whether Amazon treats those as
          the same depends on how it splits that text, and I do not know that for certain — so this is
          neither counted as missing nor waved through as covered. Calling it missing would send you to
          add a size the title already states; calling it covered could hide a query you do not rank
          for, and that only ever shows up as sales that never happen.
          <b>The cheap answer: put the joined form in your BACKEND search terms.</b> It costs nothing
          there and settles the question.
        </div>
        ${loWordTable(k.altSizes, true)}` : ''}
      <div style="margin-top:10px;display:flex;gap:8px;align-items:center">
        <select id="loPeriod" style="flex:0 0 110px;font-size:12px;padding:3px 6px"
                title="Amazon builds this report per PERIOD, never for two dates you pick. A whole Sunday-to-Saturday week, a whole calendar month, or a whole quarter.">
          <option value="WEEK">Week</option>
          <option value="MONTH" selected>Month</option>
          <option value="QUARTER">Quarter</option>
        </select>
        <select id="loWhich" style="flex:0 0 190px;font-size:12px;padding:3px 6px"
                title="Only COMPLETE periods. A month still running is not a month, and its figures set beside finished ones read as a collapse."></select>
        <button class="ghost" id="loSqp" style="width:auto;padding:4px 12px;font-size:12px"
                title="Amazon builds this report on request, which takes a few minutes. It is not live: it covers the last COMPLETE month, and it is Amazon's own search data, not this app's.">Get Search Query Performance</button>
        <span class="muted" id="loSqpMsg" style="font-size:12px"></span>
      </div>
      <div id="loSqpBody" style="margin-top:8px"></div>
    </div>

    <div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div class="sec" style="margin-top:0">Bought together</div>
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        Amazon's Market Basket report: what ends up in the same basket as this product, and how often.
        <b>Whose it is decides what to do.</b> One of yours means a bundle or a cross-sell; somebody
        else's means a hole in your own range — the customer wanted both and you sold one.
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="ghost" id="loBasket" style="width:auto;padding:4px 12px;font-size:12px">Get bought-together</button>
        <span class="muted" id="loBasketMsg" style="font-size:12px"></span>
      </div>
      <div id="loBasketBody" style="margin-top:8px"></div>
    </div>

    <div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div class="sec" style="margin-top:0">Bullet points · ${(a.bullets || []).length}</div>
      ${(a.bullets || []).map((b, i) => `<div style="font-size:12.5px;margin:3px 0">
          <span class="muted">${i + 1}.</span> ${loEsc(b)} <span class="muted">(${b.length})</span></div>`).join('')
        || '<div class="muted">No bullets.</div>'}
      <div style="margin-top:10px">${loFindings(f.bullets)}</div>
    </div>

    <div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div class="sec" style="margin-top:0">Description · ${a.description.length} chars</div>
      <div style="font-size:12.5px;max-height:150px;overflow:auto;white-space:pre-wrap">${loEsc(a.description) || '<span class="muted">None.</span>'}</div>
      <div style="margin-top:10px">${loFindings(f.description)}</div>
    </div>

    <div class="card" style="padding:12px 14px">
      <div class="sec" style="margin-top:0">Images · ${a.images.n} slot(s)</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px">${imgs || '<span class="muted">None.</span>'}</div>
      ${loFindings(f.images)}
    </div>`;

  const cp = $('loCopy');
  if (cp) cp.onclick = () => {
    navigator.clipboard.writeText(s.suggested).then(
      () => { cp.textContent = 'Copied'; setTimeout(() => { cp.textContent = 'Copy suggested title'; }, 1500); },
      () => loMsg('The browser would not copy it — select the text instead.', true));
  };
  $('loSqp').onclick = loSqpRun;
  $('loPeriod').onchange = loFillPeriods;
  loFillPeriods();
  $('loBasket').onclick = loBasketRun;
}

function loWordTable(words, shared) {
  if (!words || !words.length) return '<div class="muted">Nothing.</div>';
  /* THE COLUMN NAMES ARE THE WHOLE MEANING HERE.
   *
   * "Seen in" read as "where this word appears in your listing" — the exact opposite of what it
   * holds, on a table whose first column says the listing never says it. And the three numbers are
   * SUMS across every search term containing the word, not the word's own: 74 orders for "18x18" is
   * the total of the searches it turned up in. Both were guessable and neither should have to be. */
  return `<table class="xl" style="font-size:12px"><thead><tr>
      <th title="Not in the title, not in the bullets, not in the description.">Word the listing never says</th>
      <th class="num" title="Added up across every search term below that contains this word — not the word's own orders.">Orders</th>
      <th class="num" title="Added up the same way.">Clicks</th>
      <th class="num" title="Added up the same way.">Impressions</th>
      <th title="Real searches shoppers typed that contained this word. This is where the word comes from — it is NOT where it appears in your listing.">Searches it came from</th>
      </tr></thead><tbody>`
    + words.slice(0, 25).map(w => `<tr${shared ? ' style="opacity:.75"' : ''}>
        <td><b>${loEsc(w.w)}</b></td>
        <td class="num">${w.orders}</td><td class="num">${w.clicks}</td>
        <td class="num">${w.impr.toLocaleString('en-US')}</td>
        <td class="muted">${loEsc((w.eg || []).slice(0, 2).join(' / '))}</td></tr>`).join('')
    + '</tbody></table>';
}

/* SQP is a REPORT: asked for, built by Amazon over minutes, then collected. So the button asks, and
 * then polls — rather than holding one request open for something that will not answer inside it. */
async function loSqpRun() {
  const a = LO_DATA && LO_DATA.asin; if (!a) return;
  const btn = $('loSqp'), msg = $('loSqpMsg');
  btn.disabled = true;
  try {
    if (!LO_SQP_ID) {
      msg.textContent = 'Asking Amazon for the report…';
      const r = await baCall({ listing: 'sqpAsk', asin: a, brand: $('loBrand').value,
        period: $('loPeriod').value, back: $('loWhich').value || '0' });
      if (!r.reportId) throw new Error(r.error || 'Amazon did not accept the request.');
      LO_SQP_ID = r.reportId;
      msg.textContent = `Building ${r.label || ''} (${r.window}). Amazon takes a few minutes.`;
    }
    // Polled with a ceiling. An open-ended loop against a rate-limited API is how an account gets
    // throttled for the rest of the day.
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 15000));
      msg.textContent = `Waiting for Amazon… ${(i + 1) * 15}s`;
      const g = await baCall({ listing: 'sqpGet', id: LO_SQP_ID, asin: a, brand: $('loBrand').value });
      if (g.ok && g.status === 'done') { LO_SQP = g; loRenderSqp(); msg.textContent = ''; LO_SQP_ID = ''; btn.disabled = false; return; }
      if (!g.ok && /FATAL|CANCELLED/i.test(String(g.error || ''))) throw new Error(g.error);
    }
    msg.textContent = 'Still building after five minutes. Press the button again to keep waiting — the report is not lost.';
  } catch (e) {
    msg.textContent = 'Could not get it: ' + (e.message || e);
    LO_SQP_ID = '';
  }
  btn.disabled = false;
}

/* THE PERIOD LIST COMES FROM THE BACKEND, not from date maths repeated here.
 *
 * Two copies of the same calendar arithmetic is how this app once put a seventh of every week in the
 * wrong bucket — the browser and the backend disagreed by a day and nothing on screen showed it. The
 * same function that builds the request builds this list, so a label and the window it asks for
 * cannot drift apart. */
let LO_PERIODS = [];
async function loFillPeriods() {
  const sel = $('loWhich'); if (!sel) return;
  sel.innerHTML = '<option>…</option>';
  try {
    const r = await baCall({ listing: 'periods', period: $('loPeriod').value, n: 12 });
    LO_PERIODS = r.periods || [];
    sel.innerHTML = LO_PERIODS.map(x =>
      `<option value="${x.back}">${loEsc(x.label)}</option>`).join('');
    // Changing the window means the report already fetched is for a different one.
    LO_SQP = null; LO_SQP_ID = ''; $('loSqpBody').innerHTML = '';
  } catch (e) {
    sel.innerHTML = '<option value="0">most recent complete</option>';
  }
}

/* Market Basket is a report like SQP: asked for, built over minutes, then collected. Unlike SQP it
 * is BRAND-WIDE, so one report answers for every product — which is why the result is cached for the
 * session and a second ASIN costs nothing. */
let LO_BASKET = null, LO_BASKET_ID = '';
async function loBasketRun() {
  const a = LO_DATA && LO_DATA.asin; if (!a) return;
  const btn = $('loBasket'), msg = $('loBasketMsg');
  if (LO_BASKET) { loRenderBasket(); return; }        // already have it: this report covers everything
  btn.disabled = true;
  try {
    if (!LO_BASKET_ID) {
      msg.textContent = 'Asking Amazon…';
      const r = await baCall({ listing: 'basketAsk', brand: $('loBrand').value, period: 'MONTH' });
      if (!r.reportId) throw new Error(r.error || 'Amazon did not accept the request.');
      LO_BASKET_ID = r.reportId;
      msg.textContent = `Report ${r.reportId} building (${r.window}).`;
    }
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 15000));
      msg.textContent = `Waiting for Amazon… ${(i + 1) * 15}s`;
      const g = await baCall({ listing: 'basketGet', id: LO_BASKET_ID, brand: $('loBrand').value });
      if (g.ok && g.status === 'done') { LO_BASKET = g; LO_BASKET_ID = ''; loRenderBasket(); msg.textContent = ''; btn.disabled = false; return; }
      if (!g.ok && /FATAL|CANCELLED/i.test(String(g.error || ''))) throw new Error(g.error);
    }
    msg.textContent = 'Still building. Press again to keep waiting — the report is not lost.';
  } catch (e) {
    msg.textContent = 'Could not get it: ' + (e.message || e);
    LO_BASKET_ID = '';
  }
  btn.disabled = false;
}

function loRenderBasket() {
  const g = LO_BASKET; if (!g) return;
  const rows = (g.d && g.d[LO_DATA.asin]) || [];
  if (!rows.length) {
    $('loBasketBody').innerHTML = `<div class="muted" style="font-size:12px">The report covers ${g.asins || 0} ASIN(s) `
      + `but has nothing for this one — it needs enough baskets containing this product to report on.</div>`;
    return;
  }
  $('loBasketBody').innerHTML = `<table class="xl" style="font-size:12px"><thead><tr>
      <th>Bought with</th><th>Product</th>
      <th class="num" title="Share of baskets containing this product that also contained that one.">Share of baskets</th>
      <th>Whose</th></tr></thead><tbody>`
    + rows.map(x => `<tr>
        <td class="mono">${loEsc(x.withAsin)}</td>
        <td>${loEsc(x.title) || '<span class="muted">—</span>'}</td>
        <td class="num">${x.share ? x.share + '%' : '—'}</td>
        <td>${x.mine === null ? '<span class="st st-draft">unknown</span>'
             : x.mine ? '<span class="st st-approved">yours</span>'
                      : '<span class="st st-pending">someone else’s</span>'}</td></tr>`).join('')
    + '</tbody></table>'
    + (g.catalogueKnown ? '' : '<div class="muted" style="font-size:11.5px;margin-top:6px">The Catalog tab '
      + 'could not be read, so "whose" is unknown on every row — not "not yours".</div>');
}

function loRenderSqp() {
  const g = LO_SQP; if (!g) return;
  const rows = (g.d && g.d[LO_DATA.asin]) || [];
  if (!rows.length) {
    $('loSqpBody').innerHTML = `<div class="muted" style="font-size:12px">Amazon returned ${g.rows || 0} row(s) but none for this ASIN.</div>`;
    return;
  }
  /* TWO SETS OF NUMBERS, NEVER MIXED. `total*` is the whole market for that query; `asin*` is what
   * this listing got. Showing the market figure as the listing's would flatter, and a flattering
   * wrong number is the one nobody checks. */
  $('loSqpBody').innerHTML = `<div class="muted" style="font-size:11.5px;margin-bottom:4px">
      Your listing's own figures, with the whole query's market beside them.</div>
    <table class="xl" style="font-size:12px"><thead><tr>
      <th>Search query</th><th class="num">Volume</th>
      <th class="num">Your impr</th><th class="num">Your share</th>
      <th class="num">Your clicks</th><th class="num">Your orders</th>
      <th class="num" title="Every order this query produced across all of Amazon, not just yours. The size of the prize.">Market orders</th>
      <th class="num" title="Every impression this query produced across all of Amazon.">Market impr</th>
      </tr></thead><tbody>`
    + rows.slice(0, 30).map(q => `<tr>
        <td>${loEsc(q.q)}</td>
        <td class="num">${(q.vol || 0).toLocaleString('en-US')}</td>
        <td class="num">${(q.i || 0).toLocaleString('en-US')}</td>
        <td class="num">${q.iShare ? q.iShare.toFixed(2) + '%' : '—'}</td>
        <td class="num">${q.c || 0}</td>
        <td class="num">${q.o || 0}</td>
        <td class="num muted">${(q.mktO || 0).toLocaleString('en-US')}</td>
        <td class="num muted">${(q.mktI || 0).toLocaleString('en-US')}</td></tr>`).join('')
    + '</tbody></table>';
}



