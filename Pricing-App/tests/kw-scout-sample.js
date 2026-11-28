/* SAMPLE BESTSELLERS for the Bestseller keyword scout (28 Nov 2026) — shared by kw-scout-test.js (the backend) and kw-win-test.js (Sellora).
 * Amazon's searchCatalogItems answer shape (summaries, attributes.bullet_point, salesRanks, productTypes) with made-up items: this machine
 * cannot reach Amazon, so no real search result is here. scoutWorld() runs Pricing-API/KeywordScout.gs in a sandbox (fake Apps Script
 * services, a fake Catalog Items API); scoutTab() returns the kwScout tab it writes — what Sellora reads with ?cache=kwScout. */
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'KeywordScout.gs'), 'utf8');

// Per product type: the brands of the results (best rank first), and which results (by place) say each feature.
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const TC_BRANDS = ['Lahome', 'Lahome', 'Lahome', 'Lahome', 'Lahome', 'Lahome', 'Lahome', 'Lahome', 'Utopia Home', 'Utopia Home', 'Utopia Home', 'Utopia Home',
  'Etopia', 'Etopia', 'Etopia', 'Etopia', 'Etopia', "Maison d' Hermine", "Maison d' Hermine", "Maison d' Hermine", "Maison d' Hermine", 'Angry Orange',
  'Angry Orange', 'Angry Orange', 'Angry Orange', 'Lahome'];
// the tablecloths' features — of the top 25 (place 0–24); place 25 has the worst rank and is not counted
const TC_FEAT = {
  Farmhouse: range(0, 11),               // 12 of 25 = 48 %
  Boho: range(12, 20),                   // 9 = 36 %
  Rustic: range(0, 5),                   // 6 = 24 %: under 30 %, never used
  'Christmas Buffalo Plaid': range(13, 21),   // 9: a season and a pattern it is not said to be
  Round: range(4, 11),                   // 8: another shape
  Waterproof: range(14, 21),             // 8: not our cloth
  White: range(0, 7),                    // 8: another colour
  Linen: range(8, 15),                   // 8: another material
  Elegant: range(2, 10),                 // 9: a low-value word
  'Wrinkle Free': range(0, 9),           // 10: the listing has it already
  Lastone: [25],                         // only the 26th — never counted
};
const TC_BULLET = { 'Pottery Barn style look': range(3, 10) };   // 8: another brand's name (IP & Trademark Guard list)
const NP_BRANDS = ['Etopia', 'Etopia', 'Etopia', 'Etopia', 'Etopia', 'Etopia', 'Lahome', 'Lahome', 'Lahome', 'Lahome', 'Lahome', 'Angry Orange', 'Angry Orange',
  'Angry Orange', 'Angry Orange', 'Angry Orange', "Maison d' Hermine", "Maison d' Hermine", "Maison d' Hermine", "Maison d' Hermine"];
const NP_FEAT = {
  Farmhouse: range(0, 9),                // 10 of 20 = 50 %
  Wedding: range(4, 11),                 // 8 = 40 %
  Boho: range(12, 18),                   // 7 = 35 %
  Linen: range(0, 8),                    // 9: another material
  Fall: range(10, 16),                   // 7: a season
  Organic: range(2, 8),                  // 7: a restricted claim
  'Napkin Rings Included': range(13, 18),   // 6 = 30 %: not our cloth
  Rustic: range(0, 4),                   // 5 = 25 %
};
function catItem(asin, brand, title, bullets, rank, pt) {
  return { asin, summaries: [{ marketplaceId: 'ATVPDKIKX0DER', brandName: brand, itemName: title }], attributes: { bullet_point: bullets.map(v => ({ value: v, language_tag: 'en_US' })) },
    salesRanks: [{ marketplaceId: 'ATVPDKIKX0DER', displayGroupRanks: [{ websiteDisplayGroup: 'home_garden_display_on_website', title: 'Home & Kitchen', rank }], classificationRanks: [{ title: 'Tablecloths', rank: Math.ceil(rank / 50) }] }],
    productTypes: [{ marketplaceId: 'ATVPDKIKX0DER', productType: pt }] };
}
function build(brands, feat, bullet, word, pt, common) {
  return brands.map((b, i) => {
    const f = Object.keys(feat).filter(k => feat[k].includes(i));
    const title = word === 'Tablecloth' ? `${b} Tablecloth, ${f.join(', ')}, 60 x 120 Inch` : `${b} Cloth Napkins, ${f.join(', ')}, 18 x 18 Inch, Set of 6`;
    const bl = [common].concat(Object.keys(bullet || {}).filter(k => bullet[k].includes(i)), f.map(x => x + ' — B0' + String(i).padStart(8, '7')));
    return catItem('B0' + word.slice(0, 2).toUpperCase() + String(i).padStart(6, '0'), b, title, bl, (i + 1) * 120 + (i === brands.length - 1 ? 90000 : 0), pt);
  });
}
// "tablecloth": 26 tablecloths of other brands, 2 of ours (Ridhi, Whimsical Corner — left out), 2 napkin rings (another product type)
const TC = build(TC_BRANDS, TC_FEAT, TC_BULLET, 'Tablecloth', 'TABLECLOTH', 'Tablecloth for dining table and kitchen')
  .concat([catItem('B0RIDHI777', 'Ridhi', 'Ridhi Hand Block Print Tablecloth Farmhouse Boho', ['Tablecloth'], 50, 'TABLECLOTH'),
    catItem('B0WHIMS777', 'Whimsical Corner', 'Whimsical Corner Floral Tablecloth', ['Tablecloth'], 60, 'TABLECLOTH'),
    catItem('B0RING0001', 'Lahome', 'Lahome Napkin Rings Set of 6 Gold', ['Napkin rings'], 70, 'NAPKIN_RING'), catItem('B0RING0002', 'Etopia', 'Etopia Napkin Rings', ['Rings'], 80, 'NAPKIN_RING')]);
const NP = build(NP_BRANDS, NP_FEAT, null, 'Napkins', 'NAPKIN', 'Cloth napkins for dinner');

/** A sandbox: KeywordScout.gs over fake services. o.items: search → items; o.fail: searches answering 500; o.slow: searches answering 429. */
function scoutWorld(o) {
  o = o || {};
  const props = {}, tabs = {}, calls = [], logs = [], triggers = [];
  let now = o.now || Date.parse('2026-11-28T06:10:00Z');
  const items = o.items || { tablecloth: TC, 'cloth napkins': NP };
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    Utilities: { formatDate: (d, tz, f) => new Date(d).toISOString().slice(0, 16).replace('T', ' '), sleep: ms => { calls.push({ sleep: ms }); } },
    Session: { getScriptTimeZone: () => 'UTC' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: { getProjectTriggers: () => triggers.slice(), deleteTrigger: t => { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: fn => { const tb = { after: ms => ({ create() { triggers.push({ fn, after: ms, getHandlerFunction: () => fn }); } }), everyHours: h => ({ create() { triggers.push({ fn, every: h, getHandlerFunction: () => fn }); } }) }; return { timeBased: () => tb }; } },
    Logger: { log: s => logs.push(s) },
    cacheRead_: n => (tabs[n] ? JSON.parse(JSON.stringify(tabs[n])) : null), cacheWrite_: (n, v) => { tabs[n] = JSON.parse(JSON.stringify(v)); return 1; },
    setBrand_: b => calls.push({ brand: b }), marketplaceId_: () => 'ATVPDKIKX0DER',
    limgSp_: (p, m) => {
      calls.push({ p, m });
      const q = decodeURIComponent((p.match(/[?&]keywords=([^&]+)/) || [])[1] || '').replace(/\+/g, ' ');
      if ((o.slow || []).includes(q)) return { code: 429, body: {} };
      if ((o.fail || []).includes(q)) return { code: 500, body: { errors: [{ message: 'InternalFailure' }] } };
      const all = items[q] || [];
      const page = +((p.match(/pageToken=p(\d+)/) || [])[1] || 0);
      const slice = all.slice(page * 20, page * 20 + 20);
      return { code: 200, body: { numberOfResults: all.length, items: JSON.parse(JSON.stringify(slice)), pagination: all.length > (page + 1) * 20 ? { nextToken: 'p' + (page + 1) } : {} } };
    },
  };
  const realNow = Date.now;
  const api = new Function(...Object.keys(ctx), 'Date', SRC + '\n;return { kwsMine_, kwsTick, kwsKick, kwsNow, kwsAsk_, kwsStatus_, kwsInstall, kwsStatusLog, kwsTypes_, kwsParts_, kwsRankOf_, KWS_TOP, KWS_MIN_SHARE };')(
    ...Object.values(ctx), new Proxy(Date, { get: (t, k) => (k === 'now' ? () => now : Reflect.get(t, k)), construct: (t, a) => (a.length ? new t(...a) : new t(now)) }));
  void realNow;
  return { api, tabs, calls, props, logs, triggers, setNow: t => { now = t; }, getNow: () => now };
}
/** The kwScout tab the backend writes for the samples (one "Run now"). */
function scoutTab(o) {
  const W = scoutWorld(o);
  W.api.kwsAsk_('');
  W.api.kwsTick();
  return W.tabs.kwScout;
}
module.exports = { TC, NP, TC_FEAT, NP_FEAT, scoutWorld, scoutTab, SRC };
