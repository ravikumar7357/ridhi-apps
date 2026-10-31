/* MEERA PHASE 3 — DESIGN MOCK (29 Oct 2026). Not part of the ERP: shown only in the offline copy, mock.html.
 *
 * The new Ask box drawn on the real ERP screen, inside its own sealed box (Shadow DOM): the ERP's styles cannot change
 * her, and hers cannot change the ERP. Her real answers (meera-bank.json) and her real search (meera.js, ?meera=lazy)
 * fill it, so any question can be tried. A dark bar at the top switches between the scenes Ravi asked to see. */
(() => {
  'use strict';
  const IMG = '/meera/meera.webp';
  /* Ravi, 29 Oct: buttons and labels follow the switch — English or हिंदी; Hinglish only in an answer to a question typed
   * in Hinglish. lang = the switch (labels); said = the language of the answer itself. */
  let lang = 'en', said = 'en', bank = null, scene = 'answer', today = false;
  const L = (en, hi) => (lang === 'hi' ? hi : en);
  const C = (en, hi, hg) => (said === 'hi' ? hi : said === 'hg' ? hg : en);
  const pick = o => (o ? o[said] || o.en || '' : '');
  const HG = /\b(kaise|kese|kya|kaha|kahan|hai|hain|ho|ko|ka|ki|ke|nahi|nhi|kare|kre|karna|karu|de|dena|diya|mein|me|se|wala|wale|kab|kyu|kyun|chahiye|raha|rha|gaya|gya|kaun|kitna)\b/i;
  const saidFor = q => (lang === 'hi' ? 'hi' : /^[\x00-\x7F]*$/.test(q) && HG.test(q) ? 'hg' : 'en');
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  const phone = () => innerWidth < 700;

  /* ---------- her sealed box ---------- */
  const host = document.createElement('div');
  host.id = 'meera-host';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  /* the old Meera stays quiet while the mock is shown ("Today's Meera" brings her back) */
  const quiet = document.createElement('style');
  quiet.textContent = '#gdLaunch,#gdMenu,#gdNudge,#gdAsk,#gdResume{display:none!important}';
  document.head.appendChild(quiet);

  root.innerHTML = `<style>
:host{all:initial}
*{box-sizing:border-box}
.m{font:14px/1.45 "Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#14181F;
  --brand:#4A6A92;--brand-bg:#E9EFF6;--brand-ink:#3A5573;--ink:#14181F;--muted:#5A6472;--faint:#98A1AE;--line:#E8EDF3;--soft:#F7F9FB;
  --amber:#8A5A00;--amber-bg:#FFF6E0;--red:#B42318;--red-bg:#FEF3F2}
button{font:inherit;cursor:pointer}
.face{display:inline-block;flex:none;border-radius:50%;background:#E4E5D4 url(${IMG}) no-repeat 47% 3%/290%}

/* mock controls — not part of the design */
.bar{position:fixed;bottom:10px;left:10px;z-index:2147483000;display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:center;
  background:#14181F;color:#fff;border-radius:10px;padding:5px 6px;font-size:12px;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:calc(100vw - 16px)}
.phone .bar{bottom:auto;top:6px;left:6px;right:6px}
.bar b{padding:0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#FFD45A}
.bar button{background:transparent;color:#cfd6df;border:0;border-radius:6px;padding:4px 8px;font-size:12px}
.bar button.on{background:#fff;color:#14181F;font-weight:700}

/* the round face, bottom right */
.launch{position:fixed;right:22px;bottom:22px;z-index:2147482000;width:52px;height:52px;border-radius:50%;border:2px solid #fff;padding:0;
  box-shadow:0 4px 14px rgba(20,24,31,.22),0 0 0 1px var(--line)}
.launch .face{width:100%;height:100%}
.phone .launch{right:14px;bottom:74px;width:46px;height:46px}

/* the Ask box */
.panel{position:fixed;right:20px;bottom:86px;z-index:2147482001;width:400px;max-height:min(600px,calc(100vh - 110px));display:flex;flex-direction:column;
  background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 16px 40px rgba(20,24,31,.16);overflow:hidden}
.phone .panel{left:0;right:0;bottom:0;width:auto;max-height:86vh;border-radius:16px 16px 0 0;border-bottom:0}
.dim{display:none}
.phone .dim{display:block;position:fixed;inset:0;z-index:2147482000;background:rgba(20,24,31,.35)}
.phone .head .t{font-size:15px;white-space:nowrap}
.grab{display:none;width:40px;height:4px;border-radius:2px;background:#D5DBE3;margin:8px auto 0}
.phone .grab{display:block}
.head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line)}
.head .face{width:28px;height:28px;box-shadow:0 0 0 1px var(--line)}
.head .t{font-weight:700;font-size:14px;flex:1}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:7px;overflow:hidden}
.seg button{border:0;background:#fff;color:var(--muted);font-size:11.5px;padding:3px 8px}
.seg button+button{border-left:1px solid var(--line)}
.seg button.on{background:var(--brand-bg);color:var(--brand-ink);font-weight:700}
.x{border:0;background:none;color:var(--faint);font-size:18px;line-height:1;padding:2px 4px}
.ready{display:flex;align-items:center;gap:8px;padding:7px 12px;font-size:12px;color:var(--muted);background:var(--soft);border-bottom:1px solid var(--line)}
.ready i{flex:1;height:3px;border-radius:2px;background:var(--line);overflow:hidden;position:relative}
.ready i:after{content:"";position:absolute;inset:0;width:40%;background:var(--brand);border-radius:2px;animation:go 1.2s ease-in-out infinite}
@keyframes go{from{transform:translateX(-100%)}to{transform:translateX(260%)}}
.body{flex:1;overflow:auto;padding:12px}
.q{margin:0 0 10px auto;max-width:85%;width:max-content;background:var(--brand);color:#fff;border-radius:10px 10px 2px 10px;padding:6px 10px;font-size:13px}
.und{font-size:12px;color:var(--muted);margin:-4px 0 8px}
.und a{color:var(--brand);text-decoration:underline;cursor:pointer}

/* the answer: one line, one button, the rest folded */
.card{border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-bottom:10px}
.src{display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:11.5px;font-weight:600;color:var(--brand-ink);background:var(--brand-bg)}
.src.ai{color:var(--amber);background:var(--amber-bg)}
.src .where{margin-left:auto;font-weight:500;color:var(--muted)}
.main{padding:10px 12px 4px;font-size:14px}
.main b{font-weight:700}
.btns{display:flex;gap:8px;align-items:center;padding:8px 12px 10px}
.do{border:0;background:var(--brand);color:#fff;font-weight:700;border-radius:8px;padding:7px 14px;font-size:13px}
.lnk{border:0;background:none;color:var(--brand);font-size:13px;padding:6px 4px}
.more{border-top:1px solid var(--line)}
.more summary{list-style:none;cursor:pointer;padding:7px 12px;font-size:12.5px;color:var(--muted);display:flex;justify-content:space-between}
.more summary::-webkit-details-marker{display:none}
.more summary:after{content:"▾"}
.more[open] summary:after{content:"▴"}
.more ol{margin:0;padding:0 12px 4px 30px;font-size:13px}
.more li{padding:2px 0}
.why{margin:6px 12px 10px;padding:7px 10px;background:var(--soft);border-radius:8px;font-size:12.5px;color:var(--muted)}
.why b{color:var(--ink)}
.note{font-size:12px;color:var(--amber);padding:0 12px 8px}
.foot{display:flex;align-items:center;gap:8px;padding:6px 12px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
.foot button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:1px 7px;font-size:12px}

/* lists: table-first rows, not cards */
.h{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);margin:12px 0 6px}
.rows{border:1px solid var(--line);border-radius:10px;overflow:hidden}
.rows button{display:flex;width:100%;align-items:center;gap:8px;border:0;border-top:1px solid var(--line);background:#fff;text-align:left;padding:8px 12px;font-size:13px;color:var(--ink)}
.rows button:first-child{border-top:0}
.rows button:hover{background:var(--soft)}
.rows button:after{content:"›";margin-left:auto;color:var(--faint);font-size:16px}
.seen{border:1px solid #F4C7C3;background:var(--red-bg);border-radius:10px;padding:9px 12px;font-size:13px}
.seen .msg{margin:4px 0 8px;padding-left:8px;border-left:3px solid var(--red);color:var(--red);font-size:12.5px}

.ask{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line)}
.ask input{flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit;font-size:13.5px;color:var(--ink);outline:none}
.ask input:focus{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-bg)}
.ask button{border:0;background:var(--brand);color:#fff;font-weight:700;border-radius:8px;padding:0 14px}

/* stuck: a small note, nothing blocked */
.stuck{position:fixed;right:84px;bottom:28px;z-index:2147482000;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid var(--line);
  border-radius:10px;padding:8px 10px 8px 12px;box-shadow:0 8px 24px rgba(20,24,31,.14);font-size:13px;max-width:330px}
.phone .stuck{left:12px;right:70px;bottom:78px;max-width:none}
.stuck .do{padding:5px 10px;font-size:12.5px}

/* first-visit walk-round: the full figure, only here */
.ring{position:fixed;z-index:2147481999;border-radius:10px;box-shadow:0 0 0 3px #FFD45A,0 0 0 9999px rgba(20,24,31,.45);pointer-events:none;transition:all .2s}
.tour{position:fixed;z-index:2147482002;display:flex;gap:12px;align-items:flex-end;background:#fff;border-radius:12px;padding:12px 14px 12px 8px;width:360px;
  box-shadow:0 16px 40px rgba(20,24,31,.25)}
.tour .fig{width:74px;height:100px;flex:none;background:url(${IMG}) no-repeat center top/contain}
.tour .k{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.tour .s{font-size:14px;margin:3px 0 10px}
.tour .row{display:flex;gap:8px;align-items:center}
.phone .tour{left:10px!important;right:10px;width:auto;bottom:10px;top:auto!important}
</style><div class="m"><div class="bar"></div><div class="stage"></div></div>`;
  const $m = root.querySelector('.m'), $bar = root.querySelector('.bar'), $stage = root.querySelector('.stage');

  /* ---------- the ERP screen, read only ---------- */
  const screenId = () => (location.hash || '').slice(1) || 'pbase';
  const screenName = () => { const n = document.querySelector('.nav.on, a.nav.on'); return (n && n.textContent.trim()) || 'Job Work Register'; };
  /* a red message on screen: visible text in a reddish colour */
  function redSeen() {
    for (const el of document.querySelectorAll('#appView *')) {
      if (el.children.length || !el.offsetParent) continue;
      const t = el.textContent.trim();
      if (t.length < 8 || t.length > 160) continue;
      const c = getComputedStyle(el).color.match(/\d+/g);
      if (el.closest('.err') || (c && +c[0] > 120 && +c[1] < 80 && +c[2] < 80)) return t;
    }
    return '';
  }
  const findBtn = re => [...document.querySelectorAll('#appView button, #appView a')].find(b => b.offsetParent && re.test(b.textContent));

  /* ---------- her answers ---------- */
  const loadBank = () => bank || fetch('/guide/meera-bank.json').then(r => r.json()).then(b => (bank = b));
  const byId = id => (bank || []).find(e => e.id === id);
  async function search(q) {
    await loadBank();
    let hits = [];
    for (let i = 0; i < 60 && !window.MEERA; i++) await new Promise(r => setTimeout(r, 250));   // meera.js arrives after the page
    try { if (window.MEERA) { await window.MEERA.ready(); hits = window.MEERA.find(q); } } catch (e) {}
    const u = window.MEERA && window.MEERA.understand ? window.MEERA.understand(q) : { text: q, changes: [] };
    return { hits, u };
  }
  const forScreen = tab => (bank || []).filter(e => e.tab === tab && e.a && e.steps).slice(0, 3);

  /* ---------- pieces ---------- */
  const head = () => `<div class="grab"></div><div class="head"><span class="face"></span><span class="t">${phone() ? 'Meera' : L('Ask Meera', 'मीरा से पूछें', 'Meera se poochiye')}</span>
    <span class="seg">${[['en', 'English'], ['hi', 'हिंदी']].map(([k, n]) => `<button data-lang="${k}" class="${lang === k ? 'on' : ''}">${n}</button>`).join('')}</span>
    <button class="x" data-go="close" aria-label="Close">×</button></div>`;
  const ready = () => `<div class="ready"><span>${L('Getting ready… you can type now', 'तैयार हो रही हूँ… आप लिखना शुरू करें', 'Taiyaar ho rahi hoon… aap likhna shuru kariye')}</span><i></i></div>`;
  const askRow = (v = '') => `<form class="ask"><input placeholder="${L('Ask anything — e.g. karigar ko kaam kaise de', 'कुछ भी पूछें — जैसे कारीगर को काम कैसे दें', 'Kuch bhi poochiye — jaise karigar ko kaam kaise de')}" value="${esc(v)}"><button>${L('Ask', 'पूछें', 'Poochiye')}</button></form>`;
  function card(e, opts = {}) {
    const steps = (e.steps && (e.steps[said] || e.steps.en)) || [];
    const ai = !!opts.ai;
    return `<div class="card"><div class="src ${ai ? 'ai' : ''}">${ai ? '⚠ ' + L('Suggested — please check', 'सुझाव — कृपया जाँच लें', 'Sujhav — please check kar lijiye') : '✓ ' + L('From the ERP guide', 'ERP गाइड से', 'ERP guide se')}
        <span class="where">${esc(opts.where || '')}</span></div>
      <div class="main">${ai ? esc(e.text) : pick(e.a)}</div>
      ${ai ? `<div class="note">${L('Not from the ERP guide. Check before you save anything.', 'यह ERP गाइड से नहीं है। कुछ भी सेव करने से पहले जाँच लें।', 'Ye ERP guide se nahi hai. Kuch bhi save karne se pehle check kar lijiye.')}</div>` : `<div class="btns">
        <button class="do">${L('Do it with me', 'मेरे साथ करें', 'Mere saath kijiye')}</button>
        <button class="lnk">${L('Show me', 'करके दिखाएँ', 'Karke dikhaiye')}</button></div>`}
      ${steps.length || e.why ? `<details class="more"><summary>${L('Steps and why', 'स्टेप और क्यों', 'Steps aur kyun')} (${steps.length})</summary>
        <ol>${steps.map(s => `<li>${s}</li>`).join('')}</ol>${e.why ? `<div class="why"><b>${L('Why', 'क्यों')}:</b> ${pick(e.why)}</div>` : ''}</details>` : ''}
      <div class="foot">${L('Did this help?', 'क्या मदद मिली?', 'Madad mili?')} <button>👍</button><button>👎</button></div></div>`;
  }
  const rows = list => `<div class="rows">${list.map(e => `<button data-q="${esc((e.q[lang] || e.q.en || [])[0] || '')}">${esc((e.q[lang] || e.q.en || [])[0] || e.id)}</button>`).join('')}</div>`;

  /* ---------- scenes ---------- */
  const SCENES = [
    ['answer', 'Answer'], ['ready', 'Getting ready'], ['screen', 'Opens on screen'], ['ai', 'AI answer'], ['stuck', 'Stuck note'], ['tour', 'First-visit tour'],
  ];
  function drawBar() {
    $bar.innerHTML = '<b>Mock</b>' + SCENES.map(([k, n]) => `<button data-scene="${k}" class="${!today && scene === k ? 'on' : ''}">${n}</button>`).join('')
      + `<button data-scene="today" class="${today ? 'on' : ''}">Today's Meera</button>`;
  }
  let lastQ = 'kariger ko maaal kaise de';
  async function draw() {
    drawBar();
    $m.classList.toggle('phone', phone());
    quiet.disabled = today;
    if (today) { $stage.innerHTML = ''; return; }
    await loadBank();
    const launch = `<button class="launch" data-go="open" aria-label="${L('Ask Meera', 'मीरा से पूछें', 'Meera se poochiye')}"><span class="face"></span></button>`;
    let inner = '';
    said = lang;
    if (scene === 'answer') {
      said = saidFor(lastQ);
      const { hits, u } = await search(lastQ);
      const sure = hits[0] && hits[0].s >= 0.75 && !(hits[1] && hits[0].s - hits[1].s < 0.04);
      const e = sure && byId(hits[0].id);
      inner = `<div class="q">${esc(lastQ)}</div>`
        + (u.changes.length ? `<div class="und">${L('Showing results for', 'इसके नतीजे', 'Iske results')} <b>${esc(u.text)}</b> · <a>${L('search what I typed', 'जैसा लिखा वैसा खोजें', 'jaisa likha waisa khojiye')}</a></div>` : '')
        + (e ? card(e, { where: e.tab ? screenNameOf(e.tab) : '' }) + (hits.length > 1 ? `<div class="h">${L('Related', 'इससे जुड़े', 'Isse jude')}</div>` + rows(hits.slice(1, 3).map(h => byId(h.id)).filter(Boolean)) : '')
          : `<div class="h">${L('Did you mean', 'क्या आप यह पूछ रहे हैं', 'Kya aap ye pooch rahe hain')}</div>` + rows(hits.slice(0, 3).map(h => byId(h.id)).filter(Boolean)));
    } else if (scene === 'ready') {
      inner = `<div class="h">${L('Common on this screen', 'इस स्क्रीन पर अक्सर पूछे गए', 'Is screen par aksar poochhe gaye')}</div>` + rows(forScreen(screenId()));
    } else if (scene === 'screen') {
      const red = redSeen() || 'Could not read it: Failed to fetch';
      inner = `<div class="seen"><b>${L('I can see this message on the screen', 'स्क्रीन पर यह मैसेज दिख रहा है', 'Screen par ye message dikh raha hai')}</b><div class="msg">${esc(red)}</div>
          <button class="do">${L('Help with this', 'इसमें मदद करें')}</button></div>
        <div class="h">${L('Common on', 'अक्सर पूछे गए —', 'Aksar poochhe gaye —')} ${esc(screenName())}</div>` + rows(forScreen(screenId()));
    } else if (scene === 'ai') {
      const aiQ = lang === 'hi' ? 'GST बिल में HSN कोड कैसे बदलें' : 'GST invoice me HSN code kaise badle';
      said = saidFor(aiQ);
      inner = `<div class="q">${esc(aiQ)}</div>`
        + card({ text: C('Open Setup → Products, find the item, change the HSN code and press Save. New invoices use the new code; old ones keep theirs.',
          'Setup → Products खोलें, आइटम ढूँढें, HSN कोड बदलें और Save दबाएँ। नए इनवॉइस नया कोड लेंगे; पुराने वैसे ही रहेंगे।',
          'Setup → Products kholiye, item dhoondhiye, HSN code badaliye aur Save dabaiye. Naye invoice naya code lenge; purane waise hi rahenge.') }, { ai: true, where: L('AI', 'AI', 'AI') });
    }
    const panel = ['answer', 'ready', 'screen', 'ai'].includes(scene)
      ? (phone() ? '<div class="dim" data-go="close"></div>' : '') + `<div class="panel">${head()}${scene === 'ready' ? ready() : ''}<div class="body">${inner}</div>${askRow(scene === 'answer' ? '' : '')}</div>` : '';
    let extra = '';
    if (scene === 'stuck') extra = `<div class="stuck"><span>${L('Stuck on this form? I can show the next box.', 'इस फ़ॉर्म में अटक गए? मैं अगला बॉक्स दिखा सकती हूँ।', 'Is form me atak gaye? Main agla box dikha sakti hoon.')}</span>
      <button class="do">${L('Show me', 'दिखाएँ', 'Dikhaiye')}</button><button class="x" data-go="close" aria-label="Close">×</button></div>`;
    if (scene === 'tour') {
      const b = findBtn(/New Job Work|New/i), r = b ? b.getBoundingClientRect() : { left: innerWidth - 220, top: 70, width: 160, height: 36, bottom: 106 };
      const left = Math.max(10, Math.min(innerWidth - 370, r.left + r.width - 360));
      extra = `<div class="ring" style="left:${r.left - 5}px;top:${r.top - 5}px;width:${r.width + 10}px;height:${r.height + 10}px"></div>
        <div class="tour" style="left:${left}px;top:${r.bottom + 14}px"><span class="fig"></span><div>
          <div class="k">${esc(screenName())} · ${L('step 1 of 6', 'स्टेप 1 / 6', 'step 1 / 6')}</div>
          <div class="s">${L('Press <b>+ New Job Work</b> to give work to a karigar.', 'कारीगर को काम देने के लिए <b>+ New Job Work</b> दबाएँ।', 'Karigar ko kaam dene ke liye <b>+ New Job Work</b> dabaiye.')}</div>
          <div class="row"><button class="do">${L('Next', 'आगे', 'Aage')}</button><button class="lnk">${L('Skip the tour', 'टूर छोड़ें', 'Tour chhodiye')}</button></div></div></div>`;
    }
    $stage.innerHTML = (scene === 'tour' ? '' : launch) + panel + extra;
    root.querySelectorAll('.face').forEach(() => {});
  }
  const screenNameOf = tab => { const n = document.querySelector(`a.nav[href="#${tab}"]`); return (n && n.textContent.trim()) || ''; };

  /* ---------- clicks, typing ---------- */
  root.addEventListener('click', e => {
    const t = e.target.closest('button,a');
    if (!t) return;
    if (t.dataset.scene) { today = t.dataset.scene === 'today'; if (!today) scene = t.dataset.scene; draw(); return; }
    if (t.dataset.lang) { lang = t.dataset.lang; draw(); return; }
    if (t.dataset.q) { lastQ = t.dataset.q; scene = 'answer'; draw(); return; }
  });
  root.addEventListener('submit', e => {
    e.preventDefault();
    const v = e.target.querySelector('input').value.trim();
    if (v) { lastQ = v; scene = 'answer'; draw(); }
  });
  addEventListener('resize', () => { clearTimeout(draw.t); draw.t = setTimeout(draw, 150); });
  setTimeout(draw, 1200);
})();
