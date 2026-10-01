/* ================= SALES DASHBOARD =================
 * Reads the nightly cache and nothing else — no scanning, no waiting. Three channels side by side:
 * the two Amazon accounts and Shopify, each stored as [sales, units, orders] per day, so "All" is a
 * plain sum and no part of this file needs a special case for Shopify.
 */
let SD = { at: '', d: {} };            // { SP: {date:[sales,units,orders]}, CPC: {…}, SHOP: {…} }
let SD_CH = 'SP';
// State several functions here share, kept at the top of the section rather than beside the one
// function that fills it — a `let` read above its own line is a ReferenceError that kills the whole
// module, and this file has already been taken down that way twice.
let SD_LIVE = '', SD_LIVE_MS = 0;
// How long each leg of the load actually took, printed beside the stamps. Guessing at which of the
// three round trips is the slow one costs a deploy per guess; the screen can just say.
let SD_MS = {};

function sdMsg(t, bad) { const m = $('sdMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

/* Re-opening the tab must not re-read a month of orders. The top-up is a server read of the tail of
 * both Orders books plus a walk through Shopify — seconds, not milliseconds — and nothing on this
 * screen moves enough in ten minutes to be worth paying that twice. "Refresh today" always forces it. */
const SD_FRESH_MS = 10 * 60 * 1000;
let SD_BUSY = null;

/* The nightly history is a few hundred KB that changes ONCE A NIGHT, and fetching it is a round trip
 * to Apps Script — which redirects to googleusercontent before it answers, so it is two trips and
 * rarely under a second and a half. Paying that before the first paint, on every page load, is most
 * of what "the dashboard is slow" actually was. It is kept in localStorage instead: a reopen paints
 * with NO network at all, and the fetch still happens behind it in case the nightly run has moved on.
 *
 * The live top-up stamp is saved with it, so reopening a few minutes later does not re-read a month
 * of orders either. Both are stamped on screen (`sdSynced`), so nothing here is shown as fresher
 * than it is. */
const SD_LS = 'sd.daily.v1';

function sdLoadLocal() {
  try {
    const o = JSON.parse(localStorage.getItem(SD_LS) || 'null');
    if (!o || !o.at || !o.d) return false;
    SD = { at: o.at, d: o.d };
    SD_LIVE = o.live || '';
    SD_LIVE_MS = Number(o.liveMs) || 0;
    return true;
  } catch (e) { return false; }
}

function sdSaveLocal() {
  try {
    localStorage.setItem(SD_LS, JSON.stringify({ at: SD.at, d: SD.d, live: SD_LIVE, liveMs: SD_LIVE_MS }));
  } catch (e) { /* quota, or private browsing — the app works without it, just slower */ }
}

/** Sensible default range: this month so far. Set BEFORE any render, since renderSales reads them. */
function sdDefaults() {
  if ($('sdFrom').value) return;
  const n = new Date();
  $('sdFrom').value = new Date(Date.UTC(n.getFullYear(), n.getMonth(), 1)).toISOString().slice(0, 10);
  $('sdTo').value = sdToday();
}

async function ensureSales() {
  // PAINT FIRST, FETCH AFTER. Nothing on this screen is worth a blank page: last night's figures are
  // true for every day but the last few, and the line above always says what is still on its way.
  const fromDisk = !SD.at && sdLoadLocal();
  if (SD.at) { sdDefaults(); renderSales(); }

  if (!SD.at) {
    sdMsg('Loading…');
    const t0 = Date.now();
    try {
      const r = await baCall({ cache: 'daily' });
      SD = { at: (r.data && r.data.at) || '', d: (r.data && r.data.d) || {} };
      SD_MS.history = Date.now() - t0;
      sdMsg('');
      sdSaveLocal();
    } catch (e) {
      sdMsg('The nightly run has not produced any sales data yet — it builds this overnight. ' + (e.message || e), true);
    }
    sdDefaults();
    renderSales();
  }

  if (SD_BUSY) return;                                  // already working from an earlier visit
  SD_BUSY = (async () => {
    try {
      // Did the nightly run move on since the copy on disk? Asked behind the painted screen, and it
      // REPLACES the history — which throws away the topped-up days, so a top-up must follow.
      let replaced = false;
      if (fromDisk) {
        try {
          const r = await baCall({ cache: 'daily' });
          const at = (r.data && r.data.at) || '';
          if (at && at !== SD.at) {
            SD = { at, d: (r.data && r.data.d) || {} };
            replaced = true;
            renderSales();
          }
        } catch (e) { /* the saved copy is still good; the top-up below is what matters */ }
      }
      if (!replaced && SD_LIVE_MS && Date.now() - SD_LIVE_MS < SD_FRESH_MS) { sdSaveLocal(); return; }

      // Today first: it is the figure being watched, and three days is a cheap read. Then the rest
      // of the month, which is the part that keeps MTD honest but costs the most.
      await sdTopUp(3, 'Showing last night’s figures — reading today…');
      const full = Math.min(40, Math.max(8, Number(sdToday().slice(8, 10)) + 7));
      if (full > 3) await sdTopUp(full, 'Today is live — correcting the month so far…');
      sdSaveLocal();
    } finally { SD_BUSY = null; }
  })();
}

/**
 * Bring the recent end up to the minute.
 *
 * The nightly cache is right for history and stale for today — sales arrive all day, and a figure
 * stamped at 05:47 is breakfast, not "today". This asks the backend for just the last few days,
 * read from the tail of the Orders sheets plus Shopify, and OVERWRITES those days.
 *
 * Overwrites, not adds: the top-up is a complete statement of each day it covers, so adding it to
 * whatever the nightly run already had would double every one of them.
 */
async function sdTopUp(days, note) {
  const t0 = Date.now();
  try {
    sdMsg(note || 'Topping up today…');
    // FIVE DAYS WAS A BOUNDARY NOBODY ASKED FOR. It kept today and yesterday honest and left every
    // older day on whatever the nightly run happened to leave — so MTD carried the first of the
    // month around all month, and no amount of pressing Refresh could correct it.
    //
    // The window now reaches back over the whole month plus the seven-day card, so every figure on
    // this screen except YTD is read from the sheet itself each time the tab is opened. It is sized
    // by the date rather than fixed, so it is one day's work on the 2nd and a fortnight's on the
    // 15th, and it stops at the backend's 40-day ceiling.
    const want = days || Math.min(40, Math.max(8, Number(sdToday().slice(8, 10)) + 7));
    const r = await baCall({ daily: 'recent', days: want });
    Object.entries(r.d || {}).forEach(([ch, byDay]) => {
      if (ch === 'shopError') return;
      const into = SD.d[ch] || (SD.d[ch] = {});
      Object.entries(byDay).forEach(([day, v]) => { into[day] = v; });
    });
    SD_LIVE = r.at || '';
    SD_LIVE_MS = Date.now();
    SD_MS[want <= 3 ? 'today' : 'month'] = Date.now() - t0;
    sdMsg(r.d && r.d.shopError ? 'Live top-up done, but Shopify did not answer: ' + r.d.shopError : '');
  } catch (e) {
    // The cached figures are still on screen and still true for everything but today, so this is a
    // note rather than a failure.
    sdMsg('Could not refresh today — showing last night\'s figures. ' + (e.message || e), true);
  }
  renderSales();
}

/* ---------- dates ----------
 * Every boundary is worked out in the MARKETPLACE's day (PT), not the viewer's. Someone opening
 * this in India at 9am is looking at a US trading day that has barely started, and "today" has to
 * mean the same thing here as it does in Seller Central. */
const sdPT = ms => new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
function sdToday() { const d = sdPT(Date.now()); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
const sdShift = (iso, days) => new Date(new Date(iso + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10);
/**
 * A timestamp in the MARKETPLACE's day, not UTC.
 *
 * Everything that filters by date here — sdToday, the week keys, the adjustment window — works in
 * PT. Stamping the records themselves with toISOString() put them in UTC, so a job raised in the
 * evening PT was stamped with tomorrow's date and then filtered out by a window ending "today".
 * That is how one adjustment showed as "0 shown of 1 ever raised".
 *
 * Same rule as the Amazon side and the Shopify side: pick ONE zone for a day and never mix.
 */
function soStamp() {
  const d = sdPT(Date.now());
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Same calendar day one year earlier — used for every "LY" column. */
const sdLastYear = iso => (Number(iso.slice(0, 4)) - 1) + iso.slice(4);

/** Sum [sales, units, orders] across the chosen channel(s) between two dates, inclusive. */
function sdSum(from, to) {
  const chans = SD_CH === 'ALL' ? ['SP', 'CPC', 'SHOP'] : [SD_CH];
  const t = [0, 0, 0];
  chans.forEach(c => {
    const m = SD.d[c] || {};
    Object.keys(m).forEach(day => {
      if (day < from || day > to) return;
      const v = m[day];
      t[0] += v[0] || 0; t[1] += v[1] || 0; t[2] += v[2] || 0;
    });
  });
  t[0] = Math.round(t[0] * 100) / 100;
  return t;
}
/** Daily series for the chosen channel(s), oldest first. */
function sdSeries(from, to) {
  const chans = SD_CH === 'ALL' ? ['SP', 'CPC', 'SHOP'] : [SD_CH];
  const by = {};
  chans.forEach(c => Object.entries(SD.d[c] || {}).forEach(([day, v]) => {
    if (day < from || day > to) return;
    by[day] = (by[day] || 0) + (v[0] || 0);
  }));
  return Object.keys(by).sort().map(d => ({ d, v: by[d] }));
}

const sdMoney = v => (v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US'));
const sdNum = v => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
/** "2026-08-04" → "4 Aug". Used where a card has to name the window it actually measured. */
const sdShort = iso => String(Number(iso.slice(8, 10))) + ' ' + W_MON[Number(iso.slice(5, 7)) - 1];
function sdDelta(now, was) {
  // No baseline means no percentage. Showing +100% against a zero last year reads as growth when it
  // really means "there is nothing to compare with".
  if (!was) return '<span class="muted">—</span>';
  const p = (now - was) / was * 100;
  return `<span class="${p < 0 ? 'sd-dn' : 'sd-up'}">${p < 0 ? '▼' : '▲'}${Math.abs(p).toFixed(1)}%</span>`;
}

function renderSales() {
  const today = sdToday();
  const yest = sdShift(today, -1);
  const d = new Date(today + 'T00:00:00Z');
  const monthStart = today.slice(0, 8) + '01';
  const yearStart = today.slice(0, 4) + '-01-01';

  /* TODAY IS NOT A DAY YET, and every window here has to say so.
   *
   * At any hour before midnight PT, today holds a few hours of trading. Counting it as though it
   * were a day understates whatever window it sits in, and comparing that window against seven — or
   * ten, or two hundred — COMPLETE days last year understates the growth on top of that.
   *
   * So "Last 7 days" now means the seven complete days ending yesterday. It is what the card has
   * always claimed to be, what Seller Central means by it, and what the month projection below has
   * always used for its run rate — the two were disagreeing inside one screen.
   *
   * MTD and YTD still INCLUDE today, because month-to-date and year-to-date mean exactly that and
   * Seller Central agrees. Only their comparison is moved onto complete days, on both sides, so the
   * percentage answers "how are we doing against last year" rather than "how far through today is
   * it". The dollar figure and the percentage are deliberately measured over different windows here,
   * and the card says which. */
  const sevenTo = yest, sevenFrom = sdShift(yest, -6);

  const T = sdSum(today, today), Y = sdSum(yest, yest);
  const W = sdSum(sevenFrom, sevenTo), Wl = sdSum(sdLastYear(sevenFrom), sdLastYear(sevenTo));
  const M = sdSum(monthStart, today), Yr = sdSum(yearStart, today);
  // Complete-day basis for the two "vs LY" percentages.
  const Mc = sdSum(monthStart, yest), Ml = sdSum(sdLastYear(monthStart), sdLastYear(yest));
  const Yrc = sdSum(yearStart, yest), Yrl = sdSum(sdLastYear(yearStart), sdLastYear(yest));

  $('sdToday').textContent = sdMoney(T[0]);
  $('sdYest').textContent = sdMoney(Y[0]);
  $('sd7').textContent = sdMoney(W[0]);
  $('sd7p').innerHTML = (Wl[0] ? sdDelta(W[0], Wl[0]) + ' vs LY' : '<span class="muted">—</span>')
    + ` <span class="muted">· ${sdShort(sevenFrom)}–${sdShort(sevenTo)}</span>`;
  $('sdMtd').textContent = sdMoney(M[0]);
  $('sdMtdp').innerHTML = Ml[0]
    ? sdDelta(Mc[0], Ml[0]) + ' vs LY <span class="muted">· complete days</span>'
    : '<span class="muted">—</span>';
  $('sdYtd').textContent = sdMoney(Yr[0]);
  $('sdYtdp').innerHTML = Yrl[0]
    ? sdDelta(Yrc[0], Yrl[0]) + ' vs LY <span class="muted">· complete days</span>'
    : '<span class="muted">—</span>';

  /* ---------- where this month lands ----------
   * Built on COMPLETE days only, on both sides of every comparison. Today is hours behind all day
   * at Amazon's end, so a run rate that included it would read low every morning and climb towards
   * midnight — a projection that moves with the clock rather than with the business.
   *
   * The rate is the last seven complete days rather than the month so far: a month-to-date average
   * still carries the first week's trading three weeks later, and by then it is answering a question
   * nobody asked. Seven days also spans a whole week, so the weekend is neither counted twice nor
   * missed out. */
  const daysInMonth = Number(today.slice(8, 10)) === 0 ? 30
    : new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate();
  const doneDays = Number(today.slice(8, 10)) - 1;            // complete days of this month so far
  // The same seven complete days the card above now shows — one definition, used twice, so the two
  // halves of this screen can no longer drift apart.
  const rate7 = W[0] / 7;
  const mtdDone = doneDays > 0 ? Mc[0] : 0;
  const projected = mtdDone + rate7 * (daysInMonth - doneDays);

  // Last month: the whole of it, and the same number of days into it.
  const pmY = Number(today.slice(5, 7)) === 1 ? Number(today.slice(0, 4)) - 1 : Number(today.slice(0, 4));
  const pmM = Number(today.slice(5, 7)) === 1 ? 12 : Number(today.slice(5, 7)) - 1;
  const pm = pmY + '-' + String(pmM).padStart(2, '0');
  const pmDays = new Date(Date.UTC(pmY, pmM, 0)).getUTCDate();
  const prevWhole = sdSum(pm + '-01', pm + '-' + pmDays)[0];
  // Clamped: the 31st of a month compared against a February that stops at 28 would quietly measure
  // a shorter window on one side and call the difference growth.
  const prevSame = doneDays > 0 ? sdSum(pm + '-01', pm + '-' + String(Math.min(doneDays, pmDays)).padStart(2, '0'))[0] : 0;

  const pmName = W_MON[pmM - 1];
  $('sdProj').textContent = rate7 ? sdMoney(projected) : '—';
  $('sdProjp').innerHTML = rate7
    ? (prevWhole ? sdDelta(projected, prevWhole) + ' vs ' + pmName : '<span class="muted">no ' + pmName + ' to compare</span>')
      + (prevSame ? ` · ${doneDays}d ${sdDelta(mtdDone, prevSame)}` : '')
    : '<span class="muted">—</span>';

  const LABEL = { SP: 'Ridhi', CPC: 'CPC', SHOP: 'Shopify', ALL: 'All channels' };
  $('sdBrandLabel').textContent = LABEL[SD_CH];

  /* Period comparison — the same three windows, each against its own last-year equivalent. */
  const row = (name, i, fmt) => `<tr><td>${name}</td>`
    + `<td>${fmt(T[i])}</td><td>${fmt(Y[i])}</td>`
    + `<td>${fmt(W[i])}</td><td class="sd-ly">${fmt(Wl[i])}</td><td>${sdDelta(W[i], Wl[i])}</td>`
    + `<td>${fmt(M[i])}</td><td class="sd-ly">${fmt(Ml[i])}</td><td>${sdDelta(M[i], Ml[i])}</td>`
    + `<td>${fmt(Yr[i])}</td><td class="sd-ly">${fmt(Yrl[i])}</td><td>${sdDelta(Yr[i], Yrl[i])}</td></tr>`;
  $('sdPeriodBody').innerHTML = row('Sales', 0, sdMoney) + row('Quantity', 1, sdNum) + row('Orders', 2, sdNum);

  /* Monthly comparison — this year's months against the same months last year. */
  const yr = today.slice(0, 4), lyr = String(Number(yr) - 1);
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let mrows = '';
  for (let m = 0; m < 12; m++) {
    const mm = String(m + 1).padStart(2, '0');
    const last = new Date(Date.UTC(Number(yr), m + 1, 0)).toISOString().slice(0, 10);
    const ty = sdSum(`${yr}-${mm}-01`, last)[0];
    const ly = sdSum(`${lyr}-${mm}-01`, `${lyr}-${mm}-31`)[0];
    if (!ty && !ly) continue;                       // a month neither year has is just noise
    mrows += `<tr><td>${MON[m]}</td><td>${sdMoney(ty)}</td><td class="sd-ly">${sdMoney(ly)}</td><td>${sdDelta(ty, ly)}</td></tr>`;
  }
  $('sdMonthlyBody').innerHTML = mrows || '<tr><td colspan="4" class="muted">Nothing yet.</td></tr>';

  sdChartDaily(sdSeries(sdShift(today, -89), today));
  sdChartMonthly(yr, lyr);
  sdRange();
  // Two timestamps, because they mean different things: the nightly run owns the history, the
  // top-up owns today. One combined "last synced" would hide which half is stale.
  const legs = Object.entries(SD_MS).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join(', ');
  $('sdSynced').textContent = (SD.at || '—') + (SD_LIVE ? ` · today refreshed ${SD_LIVE}` : '')
    + (legs ? ` · read: ${legs}` : ' · read from this browser');
}

function sdRange() {
  const f = $('sdFrom').value, t = $('sdTo').value;
  if (!f || !t) return;
  const v = sdSum(f, t);
  $('sdrSales').textContent = sdMoney(v[0]);
  $('sdrQty').textContent = sdNum(v[1]);
  $('sdrItems').textContent = sdNum(v[2]);
  // Per ITEM, not per order — the label says item, and dividing by orders would quietly answer a
  // different question on a screen where both numbers are sitting side by side.
  $('sdrAvg').textContent = v[1] ? '$' + (v[0] / v[1]).toFixed(2) : '—';
}

/* ---------- charts, drawn as SVG so the page stays free of external scripts ---------- */
function sdChartDaily(pts) {
  if (!pts.length) { $('sdChartDaily').innerHTML = '<div class="muted" style="padding:20px">No data yet.</div>'; return; }
  const W = 640, H = 220, padL = 56, padR = 10, padT = 10, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(1, ...pts.map(p => p.v));
  const x = i => padL + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = v => padT + ih - (v / max) * ih;
  let line = '', area = `M${padL} ${padT + ih}`;
  pts.forEach((p, i) => { line += (i ? ' L' : 'M') + x(i) + ' ' + y(p.v); area += ` L${x(i)} ${y(p.v)}`; });
  area += ` L${x(pts.length - 1)} ${padT + ih} Z`;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const yy = padT + ih - (i / 4) * ih;
    g += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#eef2f6"/>`
      + `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#94a3b8">$${Math.round(max * i / 4).toLocaleString('en-US')}</text>`;
  }
  g += `<path d="${area}" fill="#a855f7" opacity=".12"/><path d="${line}" fill="none" stroke="#7c3aed" stroke-width="1.8"/>`;
  const step = Math.ceil(pts.length / 8);
  pts.forEach((p, i) => {
    if (i % step) return;
    g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#64748b">${p.d.slice(5)}</text>`;
  });
  pts.forEach((p, i) => { g += `<circle cx="${x(i)}" cy="${y(p.v)}" r="6" fill="transparent"><title>${p.d} — $${Math.round(p.v).toLocaleString('en-US')}</title></circle>`; });
  $('sdChartDaily').innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${g}</svg>`;
}

function sdChartMonthly(yr, lyr) {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const ty = [], ly = [];
  for (let m = 0; m < 12; m++) {
    const mm = String(m + 1).padStart(2, '0');
    const last = new Date(Date.UTC(Number(yr), m + 1, 0)).toISOString().slice(0, 10);
    ty.push(sdSum(`${yr}-${mm}-01`, last)[0]);
    ly.push(sdSum(`${lyr}-${mm}-01`, `${lyr}-${mm}-31`)[0]);
  }
  const max = Math.max(1, ...ty, ...ly);
  const W = 640, H = 220, padL = 56, padR = 10, padT = 10, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const slot = iw / 12, bw = Math.min(14, slot * 0.33);
  const y = v => padT + ih - (v / max) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const yy = padT + ih - (i / 4) * ih;
    g += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#eef2f6"/>`
      + `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#94a3b8">$${Math.round(max * i / 4).toLocaleString('en-US')}</text>`;
  }
  for (let m = 0; m < 12; m++) {
    const cx = padL + slot * m + slot / 2;
    g += `<rect x="${cx - bw - 1}" y="${y(ty[m])}" width="${bw}" height="${Math.max(0, padT + ih - y(ty[m]))}" fill="#0d9488" rx="1.5"><title>${MON[m]} ${yr} — $${Math.round(ty[m]).toLocaleString('en-US')}</title></rect>`
      + `<rect x="${cx + 1}" y="${y(ly[m])}" width="${bw}" height="${Math.max(0, padT + ih - y(ly[m]))}" fill="#f97316" rx="1.5"><title>${MON[m]} ${lyr} — $${Math.round(ly[m]).toLocaleString('en-US')}</title></rect>`
      + `<text x="${cx}" y="${H - 12}" text-anchor="middle" font-size="10" fill="#64748b">${MON[m]}</text>`;
  }
  g += `<rect x="${padL}" y="${H - 8}" width="9" height="9" fill="#0d9488" rx="1"/><text x="${padL + 13}" y="${H - 1}" font-size="10" fill="#64748b">This Year</text>`
    + `<rect x="${padL + 70}" y="${H - 8}" width="9" height="9" fill="#f97316" rx="1"/><text x="${padL + 83}" y="${H - 1}" font-size="10" fill="#64748b">Last Year</text>`;
  $('sdChartMonthly').innerHTML = `<svg viewBox="0 0 ${W} ${H + 4}" style="width:100%;height:auto">${g}</svg>`;
}

$('sdBrand').addEventListener('click', e => {
  const b = e.target.closest('[data-ch]'); if (!b) return;
  SD_CH = b.dataset.ch;
  [...$('sdBrand').querySelectorAll('button')].forEach(x => x.classList.toggle('on', x === b));
  renderSales();
});
$('sdApply').onclick = sdRange;
$('sdRefresh').onclick = async () => {
  const b = $('sdRefresh');
  b.disabled = true; b.textContent = 'Refreshing…';
  await sdTopUp(7);
  sdSaveLocal();                        // so the next open starts from what was just read
  b.disabled = false; b.textContent = 'Refresh today';
};

/* Fetched only when somebody opens the tab. Nothing in there talks to the backend or to Firestore,
 * so there is no permission to check and nothing to load — which is why this is three lines rather
 * than an ensure() like the others. */
function ensureTiktok() {
  const f = $('tkFrame');
  if (f && !f.src) f.src = 'toolkit.html';
}
function ensureCarousel() {
  const f = $('carFrame');
  if (f && !f.src) f.src = 'carousel.html';
}

