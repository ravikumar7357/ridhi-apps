/* RAVI'S CHATS — every wrong answer Ravi reported, kept for ever (Ravi, 10 Nov: "fix with a looping process so that we
 * don't have to face such patterns again").
 *   node meera/tests/ravi-chats.cjs
 *
 * THE LOOP, every time a chat comes in:
 *   1. Add it to CHATS below first: the screen it was asked on, the question as typed, what the answer must say (want)
 *      and what it must never say (not). Run this file: the new chat must FAIL — that proves the test sees the problem.
 *   2. Fix Meera. Run this file again until every chat passes, then her whole gate (node meera/tests/ci-gate.cjs).
 *   3. Commit the chat with the fix. It runs in every gate after that, so the same pattern cannot come back unseen.
 * Questions about the ERP's own figures are asked on the sample factory (meera/tests/data/sample.cjs) with the few made-up
 * rows each needs (setup), never on live data. */
const path = require('path');
const { load } = require('./harness.cjs');
const { install } = require('./data/sample.cjs');
const ROOT = path.join(__dirname, '..', '..');
const plain = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const OFF = /not about the ERP|ERP ke baare me nahi|ERP के बारे में नहीं/;

/* made-up master rows some chats need (the sample factory has no tablecloth, no two-word colour, no table runner) */
const MASTER = [
  { sku: 'RTC501-6060', brand: 'Ridhi', articleType: 'Tablecloth', subtype: 'Square Tablecloth', color: 'Appetite Green', size: '60x60', fabric: 'Cotton' },
  { sku: 'RTC501-6090', brand: 'Ridhi', articleType: 'Tablecloth', subtype: 'Rectangle Tablecloth', color: 'Appetite Green', size: '60x90', fabric: 'Cotton' },
  { sku: 'RTR301-1670', brand: 'Ridhi', articleType: 'Table Runner', subtype: 'Table Runner', color: 'Biscotti Yellow', size: '16x70', fabric: 'Sheeting 62' },
  { sku: 'RTR301-1690', brand: 'Ridhi', articleType: 'Table Runner', subtype: 'Table Runner', color: 'Biscotti Yellow', size: '16x90', fabric: 'Sheeting 62' },
  { sku: 'RCC777-16', brand: 'Ridhi', articleType: 'Cushion Cover', subtype: 'Printed Cushion Cover', color: 'Mughal Buta Blue', size: '16x16', fabric: 'Canvas' },
  { sku: 'RCC777-18', brand: 'Ridhi', articleType: 'Cushion Cover', subtype: 'Printed Cushion Cover', color: 'Mughal Buta Blue', size: '18x18', fabric: 'Canvas' },
  { sku: 'RCC778-16', brand: 'Ridhi', articleType: 'Cushion Cover', subtype: 'Printed Cushion Cover', color: 'Indigo', size: '16x16', fabric: 'Canvas' }];
const withMaster = M => { M.ctx.PTG.mdb.push(...MASTER.map(r => Object.assign({}, r))); };
/* a screen's lines, as Meera reads them (gaRowFind): made-up rows, first cell = the line's name */
const rows = (M, list) => {
  const mk = cells => ({ textContent: cells.join(' '), offsetParent: {}, tagName: 'TR', closest: () => null, querySelector: () => null,
    children: cells.map(c => ({ textContent: c })) });
  const rs = list.map(mk);
  M.ctx.__meeraTest('void 0');
  M.ctx.guidePane = () => ({ querySelectorAll: () => rs });
  M.ctx.__meeraTest('guidePane = () => ({ querySelectorAll: () => globalThis.__rows })'); M.ctx.__rows = rs;
};
const STORE = [['92 · Dark Salmon Pink', 'Cloth (m)', '120', '—', '120', '2026-11-06', '3'], ['Voil 92 · Dark Salmon Pink', 'Cloth (m)', '40', '—', '40', '2026-11-05', '2'],
  ['Canvas · Mughal Buta Blue', 'Cloth (m)', '—', '72.03', '0', '2026-11-06', '5']];

/* the chats: when Ravi asked, on which screen, what he typed — what the answer must say, and must never say */
const CHATS = [
  { day: '5 Nov', tab: 'shop', q: 'WHAT IS THIS BUCKET', want: /Bucket is where Shopify lines/ },
  { day: '5 Nov', tab: 'shop', q: 'no stock kya hai', want: /No stock ka matlab/ },
  { day: '7 Nov', tab: 'palloc', q: 'what is this 51 not given', want: /^Not given — box on Printer Allocation/, not: /a line on|palloc/ },
  { day: '7 Nov', tab: 'pa', q: 'kis karigar ko kitana kaam mila iss baar kaise pata karoon', want: /Karigar Analysis/ },
  { day: '7 Nov', tab: 'repl', q: 'yeh page jispe main hoon voh kya kaam karta hai', want: /Replenishment/, not: OFF },
  { day: '7 Nov', tab: 'repl', q: 'mai erp pe jis screen par hoon main uski baat kar raha hoon', want: /Replenishment/, not: OFF },
  { day: '7 Nov', tab: 'shop', q: 'what are the sku of table cloth that comes under apettite green', setup: withMaster, data: true,
    want: /2 SKUs .*Appetite Green.*RTC501-6060.*RTC501-6090.*I read “apettite green” as Appetite Green/ },
  { day: '10 Nov', tab: 'fab', q: 'TOH ISME YEH IN COLUMN KYA HAI', want: /^In — /, not: OFF },
  { day: '10 Nov', tab: 'ord', q: 'AMZ-16092026-02 OPENING DATE', data: true, want: /^AMZ-16092026-02 — Placed on 16 Sep 2026/ },
  { day: '10 Nov', tab: 'ord', q: 'YEH ORDER KHULA KAB THA', data: true, after: 'AMZ-16092026-02 kahan hai', want: /AMZ-16092026-02 — Placed on 16 Sep 2026/ },
  /* 10 Nov, the patterns Ravi asked to stop for good */
  { day: '10 Nov', tab: 'pmdb', q: 'RTR301-1670', setup: withMaster, data: true, want: /Product: Table Runner Biscotti Yellow/, not: /Table Runner Table Runner/ },
  { day: '10 Nov', tab: 'pmdb', q: 'RTR301-1670 kahan hai abhi production main', setup: withMaster, data: true, html: true, not: /ga-spell|Showing results for/ },
  { day: '10 Nov', tab: 'fab', q: '92 · Dark Salmon Pink', setup: M => rows(M, STORE), want: /^That is a line on Fabric Inventory\s*:\s*92 · Dark Salmon Pink\s*\./, not: /Which one do you mean/ },
  { day: '10 Nov', tab: 'fab', q: 'so what is it for 92 · Dark Salmon Pink and whhy', setup: M => rows(M, STORE), not: /Which one do you mean/ },
  { day: '10 Nov', tab: 'fab', q: 'Canvas · Mughal Buta Blue what is its sku', setup: withMaster, data: true, want: /^2 SKUs — (?=.*Fabric Canvas)(?=.*Colour Mughal Buta Blue).*RCC777-16.*RCC777-18/, not: /RCC778/ },
  { day: '10 Nov', tab: 'fab', q: 'how many products use this cloth', setup: M => { withMaster(M); rows(M, STORE); }, before: 'Canvas · Mughal Buta Blue', data: true,
    want: /^2 SKUs — (?=.*Fabric Canvas)(?=.*Colour Mughal Buta Blue)/, acts: /^pmdbfab\|Canvas\|Mughal Buta Blue$/ },
];

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
(async () => {
  for (const c of CHATS) {
    /* a fresh page for every chat: nothing one chat leaves behind can help or hurt the next */
    const M = await load({ root: ROOT, bundle: true, handle: true, switches: ['lazy', 'data'], only: false });
    install(M);
    if (c.setup) c.setup(M);
    M.setTab(c.tab);
    const ask = q => M.ctx.__meeraTest(`(async () => { let o = '', a = []; const s = gaSay; gaSay = (h, acts) => { o += h; a = a.concat((acts || []).map(x => x.id || '')); };
      try { await gaAsk(${JSON.stringify(q)}); } finally { gaSay = s; } return { o, a }; })()`);
    if (c.before) await ask(c.before);
    if (c.after) await ask(c.after);
    const r = await ask(c.q), text = c.html ? r.o : plain(r.o);
    const tag = `[${c.day}, ${c.tab}] "${c.q}"`;
    ok(!c.want || c.want.test(text), `${tag} should say ${c.want} — said: ${plain(r.o).slice(0, 160)}`);
    ok(!c.not || !c.not.test(text), `${tag} must never say ${c.not} — said: ${plain(r.o).slice(0, 160)}`);
    if (c.acts) ok(r.a.some(x => c.acts.test(x)), `${tag} its button should be ${c.acts} — buttons: ${r.a.join(', ')}`);
  }
  console.log(`\nravi-chats: ${pass} passed, ${fail} failed (${CHATS.length} chats)`);
  process.exit(fail ? 1 : 0);
})();
