/* Pricing-API / V2Merge.gs — ORDERS_V2 test stage (added 2026-10-30). NEW names only — see V2Orders.gs.
 *
 * The three merges that ADD (Nightly.gs) are fixed-length there and would drop the new positions. These
 * do the same for [0..1] / [0..4] and carry every position after them, only where a slice had it.
 * `acc` is the scratch tab to read; the defaults are the nightly's own. `parts`, when given, is the list of
 * appended slices already read (V2Nightly keeps its scratch in its own sheet). nMergeAds_ and nMergeAdsAsinDay_
 * REPLACE whole arrays per day, so they already carry ad units unchanged and have no V2 twin. */
function nMergeWeeklyV2_(acc, parts) {
  var out = {};
  (parts || accReadAll_(acc || 'weekly')).forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byWeek = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byWeek).forEach(function (wk) {
        var v = byWeek[wk], c = row[wk] || (row[wk] = [0, 0]);
        c[0] += v[0]; c[1] = Math.round((c[1] + v[1]) * 100) / 100;
        for (var p = 2; p < v.length; p++) c[p] = (c[p] || 0) + (v[p] || 0);   // orders
      });
    });
  });
  return out;
}

function nMergeDayAsinV2_(acc, parts) {
  var out = {};
  (parts || accReadAll_(acc || 'dayAsin')).forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byDay = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byDay).forEach(function (day) {
        var v = byDay[day], c = row[day] || (row[day] = [0, 0]);
        c[0] += v[0] || 0;
        c[1] = Math.round((c[1] + (v[1] || 0)) * 100) / 100;
        for (var p = 2; p < v.length; p++) c[p] = (c[p] || 0) + (v[p] || 0);   // orders
      });
    });
  });
  return out;
}

function nMergeAdsAsinV2_(acc, parts) {
  var out = {};
  (parts || accReadAll_(acc || 'adsAsin')).forEach(function (part) {
    var into = out[part.brand] || (out[part.brand] = {});
    Object.keys(part.d || {}).forEach(function (asin) {
      var byWeek = part.d[asin], row = into[asin] || (into[asin] = {});
      Object.keys(byWeek).forEach(function (wk) {
        var v = byWeek[wk], c = row[wk] || (row[wk] = [0, 0, 0, 0, 0]);
        c[0] += v[0] || 0; c[1] += v[1] || 0;
        c[2] = Math.round((c[2] + (v[2] || 0)) * 100) / 100;
        c[3] += v[3] || 0;
        c[4] = Math.round((c[4] + (v[4] || 0)) * 100) / 100;
        for (var p = 5; p < v.length; p++) c[p] = (c[p] || 0) + (v[p] || 0);   // ad units
      });
    });
  });
  return out;
}
