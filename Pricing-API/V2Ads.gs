/* Pricing-API / V2Ads.gs — ORDERS_V2 test stage (added 2026-10-30). NEW names only — see V2Orders.gs.
 *
 * ppcCreateRangeV2_ = ppcCreateRange_ (AdsApi.gs) asking for one more column, unitsSoldClicks30d, LAST.
 * ppcFetchV2_       = ppcFetch_ with ad units at [5], after the five the old pages read by position:
 *   [impressions, clicks, spend, orders, adSales, adUnits]. A report without the column keeps five. */
function ppcCreateRangeV2_(startDate, endDate) {
  var s = String(startDate || '').slice(0, 10), e = String(endDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
    return { ok: false, error: 'start and end must be yyyy-MM-dd.' };
  }
  var days = Math.round((new Date(e + 'T00:00:00Z') - new Date(s + 'T00:00:00Z')) / 86400000) + 1;
  if (days < 1) return { ok: false, error: 'end is before start.' };
  if (days > 31) return { ok: false, error: 'Range is ' + days + ' days; the Ads API allows at most 31 per report.' };

  var body = {
    // Its own name, so Amazon's "duplicate report" answer can never hand back a report without units.
    name: 'ppcwu-' + ACTIVE_PREFIX + '-' + s + '-to-' + e,
    startDate: s, endDate: e,
    configuration: {
      adProduct: 'SPONSORED_PRODUCTS',
      groupBy: ['advertiser'],
      columns: ['date', 'advertisedAsin', 'impressions', 'clicks', 'cost', 'purchases30d', 'sales30d', 'unitsSoldClicks30d'],
      reportTypeId: 'spAdvertisedProduct',
      timeUnit: 'DAILY',
      format: 'GZIP_JSON',
    },
  };
  return adsAsk_(body, { brand: ACTIVE_PREFIX, kind: 'ppc', start: s, end: e });
}

function ppcFetchV2_(id, gran) {
  var s = ppcStatus_(id);
  if (!s.ok) return s;
  if (!s.ready || !s.url) return { ok: false, error: 'Report is not ready yet (' + (s.status || '?') + ').' + (s.error ? ' ' + s.error : '') };

  var resp = UrlFetchApp.fetch(s.url, { muteHttpExceptions: true });
  if (resp.getResponseCode() >= 300) throw new Error('Report download failed (' + resp.getResponseCode() + ').');

  var text;
  try {
    text = Utilities.ungzip(resp.getBlob().setContentType('application/x-gzip')).getDataAsString();
  } catch (e) {
    text = resp.getContentText();          // Amazon occasionally hands back plain JSON
  }
  var rows = JSON.parse(text || '[]');
  if (!rows || !rows.length) return { ok: true, n: 0, weekly: false, asins: {} };

  var weekly = !!rows[0].date;
  var hasU = rows[0].unitsSoldClicks30d !== undefined;
  var zero = function () { return hasU ? [0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0]; };

  var g = String(gran || '').toLowerCase();
  var byDate = null;
  if (weekly && (g === 'day' || g === 'both')) {
    byDate = {};
    for (var d = 0; d < rows.length; d++) {
      var y = rows[d], key = String(y.date || '').slice(0, 10); if (!key) continue;
      var t = byDate[key] || (byDate[key] = zero());
      t[0] += Number(y.impressions) || 0;
      t[1] += Number(y.clicks) || 0;
      t[2] += Number(y.cost) || 0;
      t[3] += Number(y.purchases30d) || 0;
      t[4] += Number(y.sales30d) || 0;
      if (hasU) t[5] += Number(y.unitsSoldClicks30d) || 0;
    }
    Object.keys(byDate).forEach(function (k) {
      byDate[k][2] = Math.round(byDate[k][2] * 100) / 100;
      byDate[k][4] = Math.round(byDate[k][4] * 100) / 100;
    });
    if (g === 'day') return { ok: true, n: Object.keys(byDate).length, gran: 'day', dates: byDate };
  }

  var byAsinDay = (g === 'both' && weekly) ? {} : null;
  var dayFrom = byAsinDay ? dayWindowFrom_() : '';

  var out = {};
  for (var i = 0; i < rows.length; i++) {
    var x = rows[i];
    var a = String(x.advertisedAsin || '').trim().toUpperCase(); if (!a) continue;
    var impr = Number(x.impressions) || 0, clk = Number(x.clicks) || 0, cost = Number(x.cost) || 0;
    var pur = Number(x.purchases30d) || 0, sal = Number(x.sales30d) || 0;
    var au = hasU ? (Number(x.unitsSoldClicks30d) || 0) : 0;
    var b;
    if (weekly) {
      var day = String(x.date).slice(0, 10);
      var ms = new Date(day + 'T12:00:00Z').getTime();
      if (isNaN(ms)) continue;
      var wk = weekKeyOf_(ms);
      var byWeek = out[a] || (out[a] = {});
      b = byWeek[wk] || (byWeek[wk] = zero());
      if (byAsinDay && day >= dayFrom) {
        var ad = byAsinDay[a] || (byAsinDay[a] = {});
        var bd = ad[day] || (ad[day] = zero());
        bd[0] += impr; bd[1] += clk; bd[2] += cost; bd[3] += pur; bd[4] += sal;
        if (hasU) bd[5] += au;
      }
    } else {
      b = out[a] || (out[a] = zero());
    }
    b[0] += impr; b[1] += clk; b[2] += cost; b[3] += pur; b[4] += sal;
    if (hasU) b[5] += au;
  }
  var round = function (b) { b[2] = Math.round(b[2] * 100) / 100; b[4] = Math.round(b[4] * 100) / 100; };
  Object.keys(out).forEach(function (a) {
    if (weekly) Object.keys(out[a]).forEach(function (w) { round(out[a][w]); });
    else round(out[a]);
  });
  if (byAsinDay) Object.keys(byAsinDay).forEach(function (a) {
    Object.keys(byAsinDay[a]).forEach(function (dd) { round(byAsinDay[a][dd]); });
  });
  var res = { ok: true, n: Object.keys(out).length, weekly: weekly, asins: out };
  if (byDate) { res.gran = 'both'; res.dates = byDate; res.asinDays = byAsinDay || {}; }
  return res;
}
