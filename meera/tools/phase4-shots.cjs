/* PHASE 4 — pictures of "Meera's learning" and of the 👎 one-line question, from the offline copy with her local router
 * (node meera/tools/phase4-local.mjs on port 8798, sample records), by the computer's own Edge, hidden.
 *   node meera/tools/phase4-shots.cjs  →  meera/docs/phase4/*.png and index.html */
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const OUT = path.join(__dirname, '..', 'docs', 'phase4');
const BASE = 'http://localhost:8798/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', PORT = 9334;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEV = { desktop: { width: 1280, height: 800, mobile: false }, phone: { width: 375, height: 812, mobile: true } };
const OPEN = `R.getElementById('gdLaunch') ? R.getElementById('gdLaunch').click() : T("$('gdLaunch').click()"); await sleep(300);
  const m = R.querySelector('#gdMenu [data-m=learn]') || document.querySelector('#gdMenu [data-m=learn]'); if (m) m.click(); await sleep(1500);`;
const A = `const A = R.getElementById('mlAdmin') || document.getElementById('mlAdmin');`;
const SHOTS = [
  ['learn-unanswered', 'desktop', 'design', 'Meera\'s learning — unanswered this week (admin)', OPEN],
  ['learn-spellings', 'desktop', 'design', 'Suggested spellings', OPEN + A + `A.querySelector('[data-tab=spellings]').click(); await sleep(300);`],
  ['learn-down', 'desktop', 'design', '👎 Not helpful, with what they were looking for', OPEN + A + `A.querySelector('[data-tab=down]').click(); await sleep(300);`],
  ['learn-tickets', 'desktop', 'design', 'Open tickets', OPEN + A + `A.querySelector('[data-tab=tickets]').click(); await sleep(300);`],
  ['learn-add', 'desktop', 'design', 'Add answer (the form)', OPEN + A + `A.querySelector('[data-ml=add]').click(); await sleep(300);`],
  ['learn-old-look', 'desktop', '', 'The same page with the "design" switch off', OPEN],
  ['learn-staff', 'desktop', 'design', 'Staff: no menu line; opened anyway, the router refuses', `T('meeraLearnAdmin()'); await sleep(1500);`, '&as=staff'],
  ['down-ask', 'desktop', 'design', 'After a 👎: "What were you looking for?"', `T("guideAskOpen('karigar ko kaam kaise de')"); await sleep(3000); const b = [...R.querySelectorAll('.ga-fbb')].pop(); b.click(); await sleep(1500);`, '&as=staff'],
  ['learn-phone', 'phone', 'design', 'On a phone', OPEN],
];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meera-shots4-'));
  const edge = cp.spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 40 && !list; i++) { await sleep(250); try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch (e) { /* starting */ } }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const wait = new Map();
  ws.onmessage = m => { const j = JSON.parse(m.data); if (j.id && wait.has(j.id)) { wait.get(j.id)(j); wait.delete(j.id); } };
  const send = (method, params = {}) => new Promise(ok => { const n = ++id; wait.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async code => { const r = await send('Runtime.evaluate', { expression: `(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms)); const T = window.__meeraTest; const h = document.getElementById('meera-host'); const R = h && h.shadowRoot ? h.shadowRoot : document; ${code} })()`, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) console.log('  scene error:', JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result && r.result.result && r.result.result.value; };
  try {
    await send('Page.enable'); await send('Runtime.enable');
    for (const [key, dev, design, , code, extra] of SHOTS) {
      const d = DEV[dev];
      await send('Emulation.setDeviceMetricsOverride', { width: d.width, height: d.height, deviceScaleFactor: 1, mobile: d.mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: d.mobile, maxTouchPoints: d.mobile ? 5 : 0 });
      await send('Network.setUserAgentOverride', { userAgent: d.mobile ? 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' });
      await send('Page.navigate', { url: BASE + `?meera=lazy,spell,learn${design ? ',design' : ''}&tab=pbase${extra || ''}&t=${Date.now()}` });
      for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('return !!window.__meeraTest && !!window.MEERA')) break; }
      await sleep(1500);
      await ev(`window.__meera.showTab('pbase'); await sleep(600); T('guideClose && guideClose()'); return 1`);
      await ev(code + '; return 1');
      const r = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, key + '.png'), Buffer.from(r.result.data, 'base64'));
    }
  } finally { try { ws.close(); } catch (e) {} edge.kill(); }
  const img = f => `<img src="data:image/png;base64,${fs.readFileSync(path.join(OUT, f)).toString('base64')}">`;
  const html = `<!doctype html><meta charset="utf-8"><title>Meera Phase 4 screens</title><style>body{font:14px system-ui,sans-serif;margin:24px;color:#14181F;background:#F3F5F8}
h2{margin:28px 0 8px;font-size:16px}img{max-width:100%;border:1px solid #E8EDF3;border-radius:8px;background:#fff}.ph img{max-width:360px}</style>
<h1>Meera — Phase 4, learning from staff</h1><p>Offline copy on this computer with her real router code and SAMPLE records (made up, already cleaned). Not signed in to anything real.</p>`
    + SHOTS.map(([key, dev, , title]) => `<h2>${title}</h2><div class="${dev === 'phone' ? 'ph' : ''}">${img(key + '.png')}</div>`).join('');
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  console.log(SHOTS.length, 'pictures → meera/docs/phase4');
})().catch(e => { console.error(e); process.exit(1); });
