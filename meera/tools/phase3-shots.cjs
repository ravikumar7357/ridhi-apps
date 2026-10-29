/* PHASE 3 — every scene, desktop and phone, the "design" switch off and on, photographed in the offline copy by the
 * computer's own Edge (hidden), plus a check that every walk-round lights the right box and, on a phone, keeps it in
 * view above her bubble.
 *   node meera/tests/preview-make.cjs && node meera/tools/phase3-shots.cjs   (the offline copy served on port 8795)
 * Pictures: meera/docs/phase3/*.png and index.html (one page with all of them). Nothing leaves this computer. */
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const OUT = path.join(__dirname, '..', 'docs', 'phase3');
const BASE = 'http://localhost:8795/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const DEVICES = {
  desktop: { width: 1280, height: 800, mobile: false },
  phone: { width: 375, height: 812, mobile: true, ua: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' },
};
/* each scene: what to do on the page (T = her test handle), and how long to wait before the picture */
const SCENES = [
  ['face', 'Her round face, nothing open', ''],
  ['ready', 'Ask opens while her files are still arriving', `
    const f = window.fetch; window.fetch = (u, o) => String(u).includes('/guide/') ? new Promise(r => setTimeout(() => r(f(u, o)), 8000)) : f(u, o);
    T('guideAskOpen()'); await sleep(900);`],
  ['screen', 'Ask opens on a screen with a red message', `T('guideAskOpen()'); await sleep(2500);`],
  ['answer', 'An answer (typed with spelling mistakes)', `T("guideAskOpen('kariger ko maaal kaise de')"); await sleep(3000);`],
  ['answer-en', 'An answer to an English question', `T("guideAskOpen('how do i give job work to a karigar')"); await sleep(3000);`],
  ['hindi', 'हिंदी chosen in the Ask box, then asked', `localStorage.setItem('guideLang', 'hi'); T("guideAskOpen('karigar ko kaam kaise de')"); await sleep(3000);`],
  ['ai', 'An answer written by the AI (a made-up one: the copy cannot reach the AI)', `
    const f = window.fetch; window.fetch = (u, o) => String(u).includes('workers.dev') ? Promise.resolve(new Response(JSON.stringify({ source: 'ai', answerId: 1, answer: {
      a: 'Open **Setup → Products**, find the item, change the **HSN code** and press **Save**.', why: 'New invoices take the code from the product; old invoices keep theirs.',
      steps: ['Open **Setup → Products**.', 'Search the item.', 'Change **HSN code**.', 'Press **Save**.'] } }), { status: 200, headers: { 'content-type': 'application/json' } })) : f(u, o);
    T('guideAskOpen()'); await sleep(1500); T("gaMine('GST invoice me HSN code kaise badle'); gaAiAsk('GST invoice me HSN code kaise badle')"); await sleep(2500);`],
  ['stuck', 'The "stuck?" note', `T("gaNudgeShow('shot', 'idle')"); await sleep(800);`],
  ['tour-first', "A first visit's walk-round (it starts by itself)", `T("guideStart(ERP_MEERA.screen(), false)"); await sleep(600); T('guideTypeAll()'); await sleep(600);`],
  ['tour-asked', 'A walk-round asked for ("Show me this screen"), step 3', `T("guideStart(ERP_MEERA.screen(), true)"); await sleep(400); T('guideGo(1); guideGo(1); guideTypeAll()'); await sleep(900);`],
];

async function cdpOpen() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meera-shots-'));
  const edge = cp.spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 40 && !list; i++) { await sleep(250); try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch (e) { /* starting */ } }
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const wait = new Map();
  ws.onmessage = m => { const j = JSON.parse(m.data); if (j.id && wait.has(j.id)) { wait.get(j.id)(j); wait.delete(j.id); } };
  const send = (method, params = {}) => new Promise(ok => { const n = ++id; wait.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
  return { send, close: () => { try { ws.close(); } catch (e) {} edge.kill(); } };
}
async function evaluate(c, code) {
  const r = await c.send('Runtime.evaluate', { expression: `(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); const T = window.__meeraTest; ${code} })()`, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result && r.result.result && r.result.result.value;
}
async function load(c, dev, design, tab = 'pbase') {
  const d = DEVICES[dev];
  await c.send('Emulation.setDeviceMetricsOverride', { width: d.width, height: d.height, deviceScaleFactor: 1, mobile: d.mobile });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: d.mobile, maxTouchPoints: d.mobile ? 5 : 0 });
  await c.send('Network.setUserAgentOverride', { userAgent: d.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0' });
  await c.send('Page.navigate', { url: BASE + `?meera=lazy,spell${design ? ',design' : ''}&tab=${tab}&t=${Date.now()}` });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await evaluate(c, 'return !!window.__meeraTest && !!window.MEERA')) break; }
  /* the phone opens on its home page: the screen itself, as on the desktop */
  await evaluate(c, `localStorage.removeItem('guideLang'); window.__meera.showTab(${JSON.stringify(tab)}); await sleep(800); T('guideClose && guideClose()'); return 1`);
  await sleep(400);
}
async function shot(c, file) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, file), Buffer.from(r.result.data, 'base64'));
}

/* every walk-round's every step: is the lit box on the box she means, and (phone) not under her bubble? */
const TOUR_CHECK = `
  const tabs = Object.keys(T('GUIDE_TOURS')), out = [];
  for (const tab of tabs) {
    window.__meera.showTab(tab); await sleep(500);
    T('guideClose()'); T("guideStart(" + JSON.stringify(tab) + ", true)"); await sleep(300);
    const n = T('GUIDE.tour ? GUIDE.tour.steps.length : 0');
    for (let i = 0; i < n; i++) {
      await sleep(900);   // the lit box glides into place
      if (!T('GUIDE.tour')) break;   // the round ended (a step whose box this screen does not show is skipped)
      const c = T(\`(() => { const el = GUIDE.el; if (!el || !guideVisible(el)) return null;
        const r = el.getBoundingClientRect(), s = $('gdSpot').getBoundingClientRect(), b = $('gdBubble').getBoundingClientRect();
        const lit = s.left <= Math.max(r.left, 4) + 1 && s.top <= Math.max(r.top, 4) + 1 && s.right >= Math.min(r.right, innerWidth - 8) - 1 && s.bottom >= Math.min(r.bottom, innerHeight - 8) - 1;
        const covered = !(r.bottom <= b.top + 1 || r.top >= b.bottom - 1 || r.right <= b.left + 1 || r.left >= b.right - 1);
        return { lit, covered, r: [r.left, r.top, r.right, r.bottom].map(Math.round), s: [s.left, s.top, s.right, s.bottom].map(Math.round), b: [b.left, b.top, b.right, b.bottom].map(Math.round), vh: innerHeight, y: Math.round(scrollY) }; })()\`);
      if (c) out.push({ tab, step: i + 1, ...c });
      T('guideGo(1)');
    }
    T('guideClose()');
  }
  return out;`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const c = await cdpOpen();
  await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable');
  const done = [], tours = {};
  try {
    for (const dev of Object.keys(DEVICES)) for (const design of [false, true]) {
      if (!process.argv.includes('--tours')) for (const [key, , code] of SCENES) {
        await load(c, dev, design);
        try { await evaluate(c, code + '; return 1'); } catch (e) { console.log('scene', key, dev, design, 'failed:', e.message.slice(0, 200)); }
        const file = `${dev}-${design ? 'on' : 'off'}-${key}.png`;
        await shot(c, file);
        done.push(file);
      }
      await load(c, dev, design);
      tours[`${dev} ${design ? 'on' : 'off'}`] = await evaluate(c, TOUR_CHECK);
    }
  } finally { c.close(); }
  /* the walk-round check */
  const summary = {};
  for (const [k, list] of Object.entries(tours)) {
    const bad = (list || []).filter(x => !x.lit || x.covered);
    summary[k] = { steps: (list || []).length, notLit: (list || []).filter(x => !x.lit).length, coveredByBubble: (list || []).filter(x => x.covered).length,
      problems: bad.slice(0, 60).map(x => `${x.tab} step ${x.step}${x.lit ? '' : ' not lit'}${x.covered ? ' under the bubble' : ''} — box ${x.r} lit ${x.s} bubble ${x.b} h${x.vh} y${x.y}`) };
  }
  fs.writeFileSync(path.join(OUT, 'tours.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  if (process.argv.includes('--tours')) return;
  /* one page with every picture: scene by scene, off beside on */
  const img = f => `<img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, f)).toString('base64')}">`;
  let html = `<!doctype html><meta charset="utf-8"><title>Meera Phase 3 screens</title><style>body{font:14px system-ui,sans-serif;margin:24px;color:#14181F;background:#F3F5F8}
h2{margin:32px 0 8px;font-size:16px}.row{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.row.ph{grid-template-columns:repeat(2,minmax(0,300px))}
figure{margin:0}figcaption{font-size:12px;color:#5A6472;margin-bottom:4px}img{width:100%;border:1px solid #E8EDF3;border-radius:8px;background:#fff}</style>
<h1>Meera — Phase 3 design, switch off (today) and on (new look)</h1><p>Offline copy of the ERP on this computer, not signed in (no data). Pictures made by meera/tools/phase3-shots.cjs.</p>`;
  for (const [key, title] of SCENES) for (const dev of Object.keys(DEVICES)) {
    html += `<h2>${title} — ${dev}</h2><div class="row${dev === 'phone' ? ' ph' : ''}">`
      + ['off', 'on'].map(s => `<figure><figcaption>design ${s}</figcaption>${img(`${dev}-${s}-${key}.png`)}</figure>`).join('') + '</div>';
  }
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  console.log(done.length, 'pictures →', path.relative(process.cwd(), OUT));
})().catch(e => { console.error(e); process.exit(1); });
