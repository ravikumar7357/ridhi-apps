/* ================= LISTING · LISTING OPTIMISER: one ASIN reviewed on demand — title, keywords, bullets, images, and two Amazon reports =================
 * Screens: Listing Optimiser (tab 'opt').
 * Does: reads one listing's review from the backend (baCall listing=review) and draws it: the title now and the suggested
 *       rearrangement with the differences marked, shoppers' search words the listing never says, bullets, description and
 *       the images themselves; on request asks Amazon for the Search Query Performance report and the Market Basket report,
 *       polls until built, and shows them. loEsc, the escape helper, is also used by Bought Together.
 * Main functions: loMsg, ensureOpt, the loGo handler, loFindings, renderOpt, loWordTable, loSqpRun, loFillPeriods,
 *                 loBasketRun, loRenderBasket, loRenderSqp. */
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
let LO_DATA = null;     // the last review reply (audit, findings, suggestion, keywords), or null
let LO_SQP = null;      // the Search Query Performance report for the ASIN on screen, once collected
let LO_SQP_ID = '';     // the SQP report Amazon is still building, so another press keeps waiting instead of asking again

// Status line under the toolbar: red for an error, grey otherwise. Does nothing if the pane is not on the page.
function loMsg(text, bad) {
  const el = $('loMsg');
  if (el) {
    el.textContent = text || '';
    el.className = bad ? 'err' : 'muted';
  }
}

// First visit to the tab: put back the last ASIN looked at.
function ensureOpt() {
  if (!$('loAsin').value && LO_LAST) $('loAsin').value = LO_LAST;
}
let LO_LAST = '';       // the last ASIN reviewed (declared after ensureOpt, which only runs later)

// Go: read this ASIN's review from the backend and draw it.
$('loGo').onclick = async () => {
  const asinCode = ($('loAsin').value || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asinCode)) {
    loMsg('That is not an ASIN — ten letters and digits, like B0XXXXXXXX.', true);
    return;
  }
  LO_LAST = asinCode;
  LO_SQP = null;
  LO_SQP_ID = '';
  $('loGo').disabled = true;
  loMsg('Reading the listing…');
  try {
    const reply = await baCall({ listing: 'review', asin: asinCode, brand: $('loBrand').value,
      target: $('loTarget').value || '' });
    LO_DATA = reply;
    renderOpt();
    loMsg('');
  } catch (e) {
    LO_DATA = null;
    $('loBody').innerHTML = '';
    loMsg('Could not read that listing: ' + (e.message || e), true);
  }
  $('loGo').disabled = false;
};
// Enter in the ASIN box = Go.
$('loAsin').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('loGo').click();
});
// Changing the target re-reads, because the suggested title is built to it. Cheap: one round trip.
$('loTarget').addEventListener('change', () => {
  if (LO_DATA) $('loGo').click();
});

// HTML-escape for everything this screen prints (Bought Together uses it too).
const loEsc = str => String(str == null ? '' : str).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));

/** One findings list. `[FIX]` and `[look]` are kept visually apart: a screen where everything is red
 *  is a screen nobody reads twice. */
function loFindings(list) {
  if (!list || !list.length) return '<div class="muted" style="font-size:12px">Nothing to fix here.</div>';
  return list.map(finding => `<div style="display:flex;gap:8px;margin:4px 0;font-size:12.5px">
      <span class="st ${finding.bad ? 'st-rejected' : 'st-draft'}" style="flex:none">${finding.bad ? 'fix' : 'look'}</span>
      <span>${loEsc(finding.msg)}</span></div>`).join('');
}

// Draw the whole review: header, title before / after, search terms, bought-together, bullets, description, images.
function renderOpt() {
  const data = LO_DATA;
  if (!data) return;
  const audit = data.audit;             // what the listing holds now
  const findings = data.findings;       // { title, bullets, description, images }: lists of { bad, msg }
  const suggestion = data.suggestion;   // the rearranged title and why
  const keywords = data.keywords;       // shoppers' words, with a trust level

  // --- the images ---
  /* THE IMAGES THEMSELVES, not a list of slot names. "PT03 is filled" tells nobody whether PT03 is a
   * lifestyle shot, a dimensions graphic or the same photo again — and that is the only question
   * worth asking about a set of images. The slot and the size ride along underneath. */
  const imgs = Object.keys(audit.images.slots || {}).sort().map(slot => {
    const im = audit.images.slots[slot];
    const small = Math.max(im.w, im.h) < 1000;
    return `<div style="text-align:center;flex:0 0 108px">
      <a href="${loEsc(im.link)}" target="_blank" rel="noopener">
        <img src="${loEsc(im.link)}" alt="${slot}" loading="lazy" decoding="async"
             style="width:104px;height:104px;object-fit:contain;border:1px solid var(--line);
                    border-radius:6px;background:#fff"></a>
      <div style="font-size:11px;font-weight:600;margin-top:2px">${slot}</div>
      <div class="muted" style="font-size:10.5px${small ? ';color:var(--bad-ink)' : ''}">${im.w}${'×'}${im.h}${small ? ' · no zoom' : ''}</div>
    </div>`;
  }).join('');

  // --- the title, before and after ---
  /* THE TITLE, BEFORE AND AFTER, with every reason underneath. A suggestion nobody can check is a
   * suggestion nobody should apply — especially one that will be pasted into 3,646 live listings. */
  /* WHAT ACTUALLY CHANGED, marked. Two long strings side by side is a spot-the-difference puzzle,
   * and on a 189-to-75 character cut nobody wins it. Words present in one and not the other are
   * marked in place: removed struck through, added in green. */
  const loDiff = (from, to) => {
    const set = str => new Set(String(str).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
    const fromWords = set(from);
    const toWords = set(to);
    const mark = (text, other, cls) => String(text).split(/(\s+)/).map(tok => {
      const norm = tok.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!norm || other.has(norm)) return loEsc(tok);
      return `<span class="${cls}">${loEsc(tok)}</span>`;
    }).join('');
    return { from: mark(from, toWords, 'lo-gone'), to: mark(to, fromWords, 'lo-new') };
  };
  const df = loDiff(suggestion && suggestion.ok ? suggestion.current : '', suggestion && suggestion.ok ? suggestion.suggested : '');

  const titleBlock = suggestion && suggestion.ok ? `
    <div style="display:grid;gap:8px">
      <div><div class="muted" style="font-size:11px">CURRENT · ${suggestion.curLen} chars${suggestion.curLen > 75 ? ' · over the 75-character cap' : ''}</div>
        <div style="font-size:13px">${df.from}</div></div>
      <div><div class="muted" style="font-size:11px">SUGGESTED · ${suggestion.newLen} chars${suggestion.newLen > (suggestion.cap || 75) ? ' · still over target' : ''}</div>
        <div style="font-size:13px;font-weight:600">${df.to}</div></div>
      ${suggestion.highlights ? `<div><div class="muted" style="font-size:11px">ITEM HIGHLIGHTS · what was cut, ${suggestion.highlights.length} of ${125} chars</div>
        <div style="font-size:12.5px">${loEsc(suggestion.highlights)}</div>
        <div class="muted" style="font-size:11px">Amazon split the old 200-character budget on 27 July 2026: 75 for the title, 125 for this field. `
          + `What comes out of the title goes in here — it is not lost.</div></div>` : ''}
      ${suggestion.why.length ? `<div class="muted" style="font-size:12px">
        ${suggestion.why.map(reason => '· ' + loEsc(reason)).join('<br>')}</div>` : ''}
      <div><button class="ghost" id="loCopy" style="width:auto;padding:4px 12px;font-size:12px">Copy suggested title</button></div>
    </div>` : '<div class="muted">No title to work from.</div>';

  // --- keywords ---
  /* KEYWORDS. The trust level is the loudest thing here on purpose: words from a shared ad group may
   * belong to a different product, and putting those in a title is the one mistake this whole design
   * exists to prevent. */
  let kwBlock;
  if (keywords.trust === 'clean') {
    kwBlock = `<div class="muted" style="font-size:12px;margin-bottom:6px">From ${keywords.nClean} search term(s) in single-product ad groups.</div>`
      + (keywords.words.length ? loWordTable(keywords.words) : '<div class="muted">Every word shoppers used is already in the listing.</div>');
  } else if (keywords.trust === 'shared') {
    kwBlock = `<div class="err" style="font-size:12.5px;margin-bottom:6px">${loEsc(keywords.note)}</div>`
      + `<div class="muted" style="font-size:12px;margin-bottom:6px">Shown for information only — these are the AD GROUP's words and are not used in the suggestion above.</div>`
      + loWordTable(keywords.wordsShared, true);
  } else {
    kwBlock = `<div class="muted" style="font-size:12.5px">${loEsc(keywords.note || 'No advertising history for this ASIN.')}</div>`;
  }

  // --- the page ---
  $('loBody').innerHTML = `
    <div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:baseline">
        <b style="font-size:15px">${loEsc(audit.asin)}</b>
        <span class="muted" style="font-size:12px">${loEsc(audit.brand)} · ${loEsc(audit.category)}</span>
        ${audit.rank ? `<span class="muted" style="font-size:12px">rank ${audit.rank.value.toLocaleString('en-US')} in ${loEsc(audit.rank.title)}</span>` : ''}
      </div>
    </div>

    <div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div class="sec" style="margin-top:0">Title</div>
      ${titleBlock}
      <div style="margin-top:10px">${loFindings(findings.title)}</div>
    </div>

    <div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div class="sec" style="margin-top:0">Search terms</div>
      ${keywords.checked ? `<div class="muted" style="font-size:11.5px;margin-bottom:6px">
        "Never says" was checked against the title (${keywords.checked.title} chars), ${keywords.checked.bullets}
        bullet(s) and the description (${keywords.checked.description} chars) — all three, not the title alone.</div>` : ''}
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        <b>Backend keywords cannot be read.</b> They are seller-private: not on the Catalog API and
        nowhere public. Reading them needs the Listings Items API, which needs the Product Listing
        role and this brand's merchant token. Shown below is what shoppers actually searched.
      </div>
      ${kwBlock}
      ${(keywords.altSizes && keywords.altSizes.length) ? `
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
        ${loWordTable(keywords.altSizes, true)}` : ''}
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
      <div class="sec" style="margin-top:0">Bullet points · ${(audit.bullets || []).length}</div>
      ${(audit.bullets || []).map((bullet, i) => `<div style="font-size:12.5px;margin:3px 0">
          <span class="muted">${i + 1}.</span> ${loEsc(bullet)} <span class="muted">(${bullet.length})</span></div>`).join('')
        || '<div class="muted">No bullets.</div>'}
      <div style="margin-top:10px">${loFindings(findings.bullets)}</div>
    </div>

    <div class="card" style="padding:12px 14px;margin-bottom:12px">
      <div class="sec" style="margin-top:0">Description · ${audit.description.length} chars</div>
      <div style="font-size:12.5px;max-height:150px;overflow:auto;white-space:pre-wrap">${loEsc(audit.description) || '<span class="muted">None.</span>'}</div>
      <div style="margin-top:10px">${loFindings(findings.description)}</div>
    </div>

    <div class="card" style="padding:12px 14px">
      <div class="sec" style="margin-top:0">Images · ${audit.images.n} slot(s)</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px">${imgs || '<span class="muted">None.</span>'}</div>
      ${loFindings(findings.images)}
    </div>`;

  // --- wire the buttons in what was just drawn ---
  const cp = $('loCopy');
  if (cp) cp.onclick = () => {
    navigator.clipboard.writeText(suggestion.suggested).then(
      () => {
        cp.textContent = 'Copied';
        setTimeout(() => { cp.textContent = 'Copy suggested title'; }, 1500);
      },
      () => loMsg('The browser would not copy it — select the text instead.', true));
  };
  $('loSqp').onclick = loSqpRun;
  $('loPeriod').onchange = loFillPeriods;
  loFillPeriods();
  $('loBasket').onclick = loBasketRun;
}

// The keyword table: words shoppers searched that the listing never says, with figures summed over those searches; `shared` dims it.
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
    + words.slice(0, 25).map(word => `<tr${shared ? ' style="opacity:.75"' : ''}>
        <td><b>${loEsc(word.w)}</b></td>
        <td class="num">${word.orders}</td><td class="num">${word.clicks}</td>
        <td class="num">${word.impr.toLocaleString('en-US')}</td>
        <td class="muted">${loEsc((word.eg || []).slice(0, 2).join(' / '))}</td></tr>`).join('')
    + '</tbody></table>';
}

/* SQP is a REPORT: asked for, built by Amazon over minutes, then collected. So the button asks, and
 * then polls — rather than holding one request open for something that will not answer inside it. */
// Get Search Query Performance: ask (or keep waiting for the report already asked for), poll up to 20 × 15 s, draw it.
async function loSqpRun() {
  const asinCode = LO_DATA && LO_DATA.asin;
  if (!asinCode) return;
  const btn = $('loSqp');
  const msg = $('loSqpMsg');
  btn.disabled = true;
  try {
    if (!LO_SQP_ID) {
      // --- ask for the report ---
      msg.textContent = 'Asking Amazon for the report…';
      const reply = await baCall({ listing: 'sqpAsk', asin: asinCode, brand: $('loBrand').value,
        period: $('loPeriod').value, back: $('loWhich').value || '0' });
      if (!reply.reportId) throw new Error(reply.error || 'Amazon did not accept the request.');
      LO_SQP_ID = reply.reportId;
      msg.textContent = `Building ${reply.label || ''} (${reply.window}). Amazon takes a few minutes.`;
    }
    // --- poll until it is done ---
    // Polled with a ceiling. An open-ended loop against a rate-limited API is how an account gets
    // throttled for the rest of the day.
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 15000));
      msg.textContent = `Waiting for Amazon… ${(i + 1) * 15}s`;
      const pollReply = await baCall({ listing: 'sqpGet', id: LO_SQP_ID, asin: asinCode, brand: $('loBrand').value });
      if (pollReply.ok && pollReply.status === 'done') {
        LO_SQP = pollReply;
        loRenderSqp();
        msg.textContent = '';
        LO_SQP_ID = '';
        btn.disabled = false;
        return;
      }
      if (!pollReply.ok && /FATAL|CANCELLED/i.test(String(pollReply.error || ''))) throw new Error(pollReply.error);
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
let LO_PERIODS = [];    // the complete periods the backend offered for the chosen period type
// Fill the "which period" picker for the chosen period type (week / month / quarter).
async function loFillPeriods() {
  const sel = $('loWhich');
  if (!sel) return;
  sel.innerHTML = '<option>…</option>';
  try {
    const reply = await baCall({ listing: 'periods', period: $('loPeriod').value, n: 12 });
    LO_PERIODS = reply.periods || [];
    sel.innerHTML = LO_PERIODS.map(period =>
      `<option value="${period.back}">${loEsc(period.label)}</option>`).join('');
    // Changing the window means the report already fetched is for a different one.
    LO_SQP = null;
    LO_SQP_ID = '';
    $('loSqpBody').innerHTML = '';
  } catch (e) {
    sel.innerHTML = '<option value="0">most recent complete</option>';
  }
}

/* Market Basket is a report like SQP: asked for, built over minutes, then collected. Unlike SQP it
 * is BRAND-WIDE, so one report answers for every product — which is why the result is cached for the
 * session and a second ASIN costs nothing. */
let LO_BASKET = null;       // the Market Basket report, once collected (brand-wide, so it serves every ASIN this session)
let LO_BASKET_ID = '';      // the report Amazon is still building
// Get bought-together: show the cached report, or ask Amazon for it and poll up to 20 × 15 s.
async function loBasketRun() {
  const asinCode = LO_DATA && LO_DATA.asin;
  if (!asinCode) return;
  const btn = $('loBasket');
  const msg = $('loBasketMsg');
  if (LO_BASKET) {        // already have it: this report covers everything
    loRenderBasket();
    return;
  }
  btn.disabled = true;
  try {
    if (!LO_BASKET_ID) {
      // --- ask for the report ---
      msg.textContent = 'Asking Amazon…';
      const reply = await baCall({ listing: 'basketAsk', brand: $('loBrand').value, period: 'MONTH' });
      if (!reply.reportId) throw new Error(reply.error || 'Amazon did not accept the request.');
      LO_BASKET_ID = reply.reportId;
      msg.textContent = `Report ${reply.reportId} building (${reply.window}).`;
    }
    // --- poll until it is done ---
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 15000));
      msg.textContent = `Waiting for Amazon… ${(i + 1) * 15}s`;
      const pollReply = await baCall({ listing: 'basketGet', id: LO_BASKET_ID, brand: $('loBrand').value });
      if (pollReply.ok && pollReply.status === 'done') {
        LO_BASKET = pollReply;
        LO_BASKET_ID = '';
        loRenderBasket();
        msg.textContent = '';
        btn.disabled = false;
        return;
      }
      if (!pollReply.ok && /FATAL|CANCELLED/i.test(String(pollReply.error || ''))) throw new Error(pollReply.error);
    }
    msg.textContent = 'Still building. Press again to keep waiting — the report is not lost.';
  } catch (e) {
    msg.textContent = 'Could not get it: ' + (e.message || e);
    LO_BASKET_ID = '';
  }
  btn.disabled = false;
}

// Draw the bought-together rows for the ASIN on screen: what it is bought with, how often, and whose it is.
function loRenderBasket() {
  const report = LO_BASKET;
  if (!report) return;
  const rows = (report.d && report.d[LO_DATA.asin]) || [];
  if (!rows.length) {
    $('loBasketBody').innerHTML = `<div class="muted" style="font-size:12px">The report covers ${report.asins || 0} ASIN(s) `
      + `but has nothing for this one — it needs enough baskets containing this product to report on.</div>`;
    return;
  }
  $('loBasketBody').innerHTML = `<table class="xl" style="font-size:12px"><thead><tr>
      <th>Bought with</th><th>Product</th>
      <th class="num" title="Share of baskets containing this product that also contained that one.">Share of baskets</th>
      <th>Whose</th></tr></thead><tbody>`
    + rows.map(row => `<tr>
        <td class="mono">${loEsc(row.withAsin)}</td>
        <td>${loEsc(row.title) || '<span class="muted">—</span>'}</td>
        <td class="num">${row.share ? row.share + '%' : '—'}</td>
        <td>${row.mine === null ? '<span class="st st-draft">unknown</span>'
             : row.mine ? '<span class="st st-approved">yours</span>'
                      : '<span class="st st-pending">someone else’s</span>'}</td></tr>`).join('')
    + '</tbody></table>'
    + (report.catalogueKnown ? '' : '<div class="muted" style="font-size:11.5px;margin-top:6px">The Catalog tab '
      + 'could not be read, so "whose" is unknown on every row — not "not yours".</div>');
}

// Draw the Search Query Performance rows for the ASIN on screen: the listing's own figures beside the whole market's.
function loRenderSqp() {
  const report = LO_SQP;
  if (!report) return;
  const rows = (report.d && report.d[LO_DATA.asin]) || [];
  if (!rows.length) {
    $('loSqpBody').innerHTML = `<div class="muted" style="font-size:12px">Amazon returned ${report.rows || 0} row(s) but none for this ASIN.</div>`;
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
    + rows.slice(0, 30).map(row => `<tr>
        <td>${loEsc(row.q)}</td>
        <td class="num">${(row.vol || 0).toLocaleString('en-US')}</td>
        <td class="num">${(row.i || 0).toLocaleString('en-US')}</td>
        <td class="num">${row.iShare ? row.iShare.toFixed(2) + '%' : '—'}</td>
        <td class="num">${row.c || 0}</td>
        <td class="num">${row.o || 0}</td>
        <td class="num muted">${(row.mktO || 0).toLocaleString('en-US')}</td>
        <td class="num muted">${(row.mktI || 0).toLocaleString('en-US')}</td></tr>`).join('')
    + '</tbody></table>';
}



