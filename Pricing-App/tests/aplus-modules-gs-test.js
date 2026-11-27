/* Pricing-API/AplusModules.gs (2 Dec 2026, not deployed yet) in a sandbox: fake Apps Script services and a fake A+ Content API.
 *   node tests/aplus-modules-gs-test.js
 * The daily read of every A+ document's modules: only GET reads, after 14:00, once a day, the last answer kept when a read fails. */
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'Pricing-API', 'AplusModules.gs'), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n + (x ? ' — ' + x : '')); } };
function world(o) {
  const props = {}, tabs = {}, calls = [], logs = [];
  let hour = o.hour == null ? 15 : o.hour;
  const today = '2026-12-02';
  tabs.lmMeta = { aplus: { SP: { tab: 'lmAplus_SP', at: today + ' 13:20' }, CPC: o.noCpc ? undefined : { tab: 'lmAplus_CPC', at: today + ' 13:21' } } };
  tabs.lmAplus_SP = { docs: { A: {}, B: {}, C: {} } };
  tabs.lmAplus_CPC = { docs: { Z: {} } };
  if (o.old) tabs.lmAplus_Mods_SP = o.old;
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    Utilities: { formatDate: (d, tz, f) => (f === 'H' ? String(hour) : f === 'yyyy-MM-dd' ? today : today + ' ' + String(hour).padStart(2, '0') + ':00'), sleep() {} },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create() {} }) }) }) },
    Logger: { log: s => logs.push(s) },
    LM_BRANDS: ['SP', 'CPC'], lmGet_: n => (tabs[n] ? JSON.parse(JSON.stringify(tabs[n])) : null), lmPut_: (n, v) => { tabs[n] = JSON.parse(JSON.stringify(v)); },
    lmNow_: () => today + ' ' + String(hour).padStart(2, '0') + ':00', setBrand_() {}, marketplaceId_: () => 'ATVPDKIKX0DER',
    limgSp_: (p, m) => {
      calls.push({ p, m });
      const k = decodeURIComponent((p.match(/contentDocuments\/([^?]+)/) || [])[1] || '');
      if (o.fail && o.fail.includes(k)) return { code: 500, body: {} };
      if (k === 'C' && o.gone) return { code: 404, body: {} };
      const mods = { A: ['STANDARD_HEADER_IMAGE_TEXT', 'STANDARD_COMPARISON_TABLE'], B: ['STANDARD_TEXT'], C: ['STANDARD_SINGLE_IMAGE_HIGHLIGHTS'], Z: ['STANDARD_HEADER_IMAGE_TEXT'] }[k] || [];
      return { code: 200, body: { contentRecord: { contentDocument: { contentType: 'EBC', contentSubType: k === 'C' ? 'BRAND_STORY' : '', contentModuleList: mods.map(t => ({ contentModuleType: t })) } } } };
    },
  };
  const api = new Function(...Object.keys(ctx), src + '\n;return { apmTick, apmNow, apmStatus, apmInstall };')(...Object.values(ctx));
  return { api, tabs, calls, props, logs, setHour: h => { hour = h; } };
}
const W = world({ hour: 10 });
W.api.apmTick();
ok('before 14:00 nothing is read', W.calls.length === 0 && !W.tabs.lmAplus_Mods_SP);
W.setHour(15);
W.api.apmTick();
const sp = W.tabs.lmAplus_Mods_SP, cpc = W.tabs.lmAplus_Mods_CPC;
ok('after 14:00: one GET getContentDocument per document (4) — nothing but reads', W.calls.length === 4 && W.calls.every(c => c.m === 'get' && /includedDataSet=CONTENTS/.test(c.p)), JSON.stringify(W.calls));
ok('the tab: count, types, sub-type (Brand Story), content type, time', sp.docs.A.n === 2 && sp.docs.A.ty.join() === 'STANDARD_HEADER_IMAGE_TEXT,STANDARD_COMPARISON_TABLE' && sp.docs.C.sub === 'BRAND_STORY' && sp.docs.B.ct === 'EBC' && sp.docs.A.at > 0 && !sp.partial && sp.at && cpc.docs.Z.n === 1);
W.calls.length = 0; W.api.apmTick();
ok('done for today: the next tick reads nothing', W.calls.length === 0);
const F = world({ fail: ['B'], old: { at: 'x', docs: { B: { n: 4, ty: ['STANDARD_TEXT', 'STANDARD_TEXT', 'STANDARD_TEXT', 'STANDARD_TEXT'], sub: '', ct: 'EBC', at: 1 } } } });
for (let i = 0; i < 4; i++) F.api.apmTick();
ok('a document that keeps failing (3 tries) keeps the last read\'s answer — never invented', F.tabs.lmAplus_Mods_SP.docs.B.n === 4 && F.tabs.lmAplus_Mods_SP.failed === 1 && !F.tabs.lmAplus_Mods_SP.partial, JSON.stringify(F.tabs.lmAplus_Mods_SP));
const G = world({ gone: true, old: { docs: { C: { n: 1, ty: ['X'], at: 1 }, OLD: { n: 1, ty: ['X'], at: 1 } } } });
G.api.apmTick();
ok('a document deleted since (404) and one no longer in the A+ read are dropped', !G.tabs.lmAplus_Mods_SP.docs.C && !G.tabs.lmAplus_Mods_SP.docs.OLD && G.tabs.lmAplus_Mods_SP.nDocs === 2);
const N = world({ hour: 9 });
N.api.apmNow();
ok('apmNow reads now whatever the hour', N.calls.length === 4 && N.logs.some(l => /SP: 3 documents/.test(l)), N.logs.join(' | '));
console.log(`
${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
