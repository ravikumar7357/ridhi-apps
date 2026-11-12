/* Phase 6: her numbers read from config.ts (MEERA_CONFIG) — the same values, so nothing she does changes. Run once. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..'), SRC = path.join(ROOT, 'meera', 'client', 'src');
function edit(rel, pairs) {
  const f = path.join(SRC, rel);
  let s = fs.readFileSync(f, 'utf8');
  const crlf = s.includes('\r\n');
  for (let [a, b] of pairs) {
    if (crlf) { a = a.replace(/\r?\n/g, '\r\n'); b = b.replace(/\r?\n/g, '\r\n'); }
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${rel}: found ${n}× — ${a.slice(0, 70)}`);
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(f, s);
}
/* config.ts: the ring's glow (guide.ts) and the fill list's wait (guide-fill.ts) too */
edit('config.ts', [
  ["  stepGiveUpMs: 20000,            // a step that waits: given up after this long\n",
   "  ringMs: 20000,                  // the glow round a box after \"Try it\" / \"Fix it now\": gone after this long\n"],
  ["  fillRetryMs: 600,               // filling a box whose list is still loading: tried again after this long\n",
   "  fillRetryMs: 600,               // filling a box whose list is still loading: tried again after this long…\n  fillGiveUpMs: 30000,            // …for at most this long\n"],
]);
edit('legacy/guide-ask.ts', [
  ["let GA_SEM_W = 0.5, GA_SEM_SKIP = true;", "let GA_SEM_W = MEERA_CONFIG.meaningWeight, GA_SEM_SKIP = MEERA_CONFIG.meaningSkipFillers;   // config.ts"],
  ["let GA_TOPK = 4;", "let GA_TOPK = MEERA_CONFIG.topK;   // config.ts"],
  ["let GA_BANK_SURE = 0.65, GA_BANK_SURE_SEM = 0.75, GA_BANK_NEAR = 0.32;", "let GA_BANK_SURE = MEERA_CONFIG.sure, GA_BANK_SURE_SEM = MEERA_CONFIG.sureMeaning, GA_BANK_NEAR = MEERA_CONFIG.near;   // config.ts"],
  ["let GA_BANK_GAP = 0.04;", "let GA_BANK_GAP = MEERA_CONFIG.gap;   // config.ts"],
  ["let GA_BANK_ASK = 0.5;", "let GA_BANK_ASK = MEERA_CONFIG.ask;   // config.ts"],
  ["let GA_SPELL_FIXED = false, GA_SPELL_SURE = 0.8, GA_SPELL_GAP = 0.06;", "let GA_SPELL_FIXED = false, GA_SPELL_SURE = MEERA_CONFIG.spellSure, GA_SPELL_GAP = MEERA_CONFIG.spellGap;   // config.ts"],
  ["setTimeout(ok, 4000)", "setTimeout(ok, MEERA_CONFIG.wordsWaitMs)"],
]);
edit('legacy/guide-ai.ts', [["setTimeout(() => no(new Error('slow')), 3000)", "setTimeout(() => no(new Error('slow')), MEERA_CONFIG.learnedWaitMs)"]]);
edit('legacy/guide-walks.ts', [["const GA_NUDGE_IDLE_MS = 75000;", "const GA_NUDGE_IDLE_MS = MEERA_CONFIG.nudgeIdleMs;   // config.ts"]]);
edit('legacy/guide.ts', [
  ["const GUIDE_STRIKES = 3;                    // the same mistake this many times → the lesson", "const GUIDE_STRIKES = MEERA_CONFIG.strikes;   // the same mistake this many times → the lesson (config.ts)"],
  ["const GUIDE_WINDOW_MS = 15 * 60 * 1000;     // …inside this long; older strikes are forgotten", "const GUIDE_WINDOW_MS = MEERA_CONFIG.strikeWindowMs;   // …inside this long; older strikes are forgotten"],
  ["const GUIDE_FOOT = 300;                    // the bottom of the screen Meera and her bubble stand in", "const GUIDE_FOOT = MEERA_CONFIG.footPx;   // the bottom of the screen Meera and her bubble stand in"],
  ["const GUIDE_ACT_MS = 8000;                  // a red line this soon after a click or key is the person's doing", "const GUIDE_ACT_MS = MEERA_CONFIG.actMs;   // a red line this soon after a click or key is the person's doing"],
  ["const GUIDE_TYPE_MS = 12;                  // the bubble's words appear a few letters at a time, like a game…", "const GUIDE_TYPE_MS = MEERA_CONFIG.typeMs;   // the bubble's words appear a few letters at a time, like a game…"],
  ["const GUIDE_TYPE_STEP = 4;                 // …four a tick: a long sentence is out in about half a second", "const GUIDE_TYPE_STEP = MEERA_CONFIG.typeStep;   // …four a tick: a long sentence is out in about half a second"],
  ["setTimeout(() => { if (GUIDE.tour === t) guideShow(); }, 650); return; }", "setTimeout(() => { if (GUIDE.tour === t) guideShow(); }, MEERA_CONFIG.stepOpenMs); return; }"],
  ["    setTimeout(() => { if (GUIDE.tour === tour && GUIDE.i === at) guideGo(1); }, 750);", "    setTimeout(() => { if (GUIDE.tour === tour && GUIDE.i === at) guideGo(1); }, MEERA_CONFIG.stepNextMs);"],
  ["tm = setTimeout(() => { if (filled()) done(); }, 1400); };", "tm = setTimeout(() => { if (filled()) done(); }, MEERA_CONFIG.valueCheckMs); };"],
  ["  GUIDE.ringT = setTimeout(done, 20000);", "  GUIDE.ringT = setTimeout(done, MEERA_CONFIG.ringMs);"],
]);
/* line 294: "…GUIDE.i = n; guideShow(); } }, 700)" */
{
  const f = path.join(SRC, 'legacy', 'guide.ts');
  let s = fs.readFileSync(f, 'utf8');
  const a = "{ if (GUIDE.tour === t) { GUIDE.i = n; guideShow(); } }, 700)";
  if (s.split(a).length !== 2) throw new Error('guide.ts 700');
  fs.writeFileSync(f, s.replace(a, "{ if (GUIDE.tour === t) { GUIDE.i = n; guideShow(); } }, MEERA_CONFIG.stepAgainMs)"));
}
edit('legacy/guide-fill.ts', [
  ["Date.now() - since > 30000) return;", "Date.now() - since > MEERA_CONFIG.fillGiveUpMs) return;"],
  ["      if (gfOptions(el).length) guideFillOffer(s, el, task); else setTimeout(again, 600);\n    };\n    setTimeout(again, 600);",
   "      if (gfOptions(el).length) guideFillOffer(s, el, task); else setTimeout(again, MEERA_CONFIG.fillRetryMs);\n    };\n    setTimeout(again, MEERA_CONFIG.fillRetryMs);"],
]);
edit('design.ts', [["  setTimeout(() => { if (line.isConnected) line.remove(); }, 20000);", "  setTimeout(() => { if (line.isConnected) line.remove(); }, MEERA_CONFIG.readyLineMs);"]]);
edit('server.ts', [
  ["  const r = await srvCall('/config', null, 4000);", "  const r = await srvCall('/config', null, MEERA_CONFIG.routerWaitMs);"],
  ["tabs: u.tabs, admin: u.admin, ...extra }, 4000);", "tabs: u.tabs, admin: u.admin, ...extra }, MEERA_CONFIG.routerWaitMs);"],
]);
/* the page joins config.ts first of hers; the router's search (which runs guide-ask.ts) gets it too */
const ORDER = path.join(ROOT, 'Replenish-App', 'src', 'app', 'ORDER');
let o = fs.readFileSync(ORDER, 'utf8');
if (!o.includes('@meera/config.ts')) { const nl = o.includes('\r\n') ? '\r\n' : '\n'; o = o.replace('@meera/legacy/guide-art.ts', '@meera/config.ts' + nl + '@meera/legacy/guide-art.ts'); fs.writeFileSync(ORDER, o); }
const BS = path.join(ROOT, 'meera', 'router', 'build-search.cjs');
let b = fs.readFileSync(BS, 'utf8');
const ba = "const FILES = ['understand.ts', pick('legacy/guide-tours'), pick('legacy/guide-ask')];";
if (b.includes(ba)) b = b.replace(ba, "const FILES = ['understand.ts', 'config.ts', pick('legacy/guide-tours'), pick('legacy/guide-ask')];   // config.ts: her numbers (Phase 6)");
const bb = "  const [und, tours, ask] = sources().map((s, i) => js(s, FILES[i]));\n  const undJs = und;";
if (b.includes(bb)) b = b.replace(bb, "  const [und, config, tours, ask] = sources().map((s, i) => js(s, FILES[i]));\n  const undJs = und + '\\n/* ---- meera/client/src/config.ts ---- */\\n' + config;");
fs.writeFileSync(BS, b);
console.log('ok');
