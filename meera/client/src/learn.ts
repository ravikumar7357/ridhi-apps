/* MEERA LEARNS FROM STAFF (v2 rebuild, Phase 4, 29 Oct 2026) — switch "learn" (core/meera-bridge.js), meera.js only.
 *
 * What she could not answer, was not sure of, a 👎 (with an optional one line "What were you looking for?"), and a
 * misspelt or unclear question followed by the answer the person then tapped (a new way of asking, suggested) go to her
 * router's database (meera/router, POST /learn). Before anything leaves the browser the question is cleaned with the
 * router's own rules (guide-ai.js gaClean: names, phone numbers, order numbers, amounts, emails, tax ids); the router
 * cleans it again. Nothing else is sent about the person but their role (staff / admin / vendor) — no email, no name.
 * At most 30 a day from one browser (and the router counts per person). Switch off, or not signed in: nothing is sent.
 *
 * Admins get "Meera's learning" in her menu: this week's unanswered questions, suggested spellings, the 👎s and the open
 * tickets, with Add answer / Approve spelling / Reject / Answer ticket. Nothing joins her answers until an admin
 * approves it (the router refuses anyone else, whatever this page shows). */

declare const GA_AI_URL: string;
declare function gaClean(text: string, names: string[]): string;
declare function gaNames(): string[];
declare function gaSpellFind(q: string): { e: { id: string }; s: number }[];
declare function gaRead(q: string): { lang: string; means: string[]; words: string[] };
declare const GUIDE: { tour: unknown };
declare function guideClose(): void;

const MEERA_LEARN: boolean = meeraOn('learn');
const ML = { last: null as null | { q: string; fixed: boolean; near: boolean } };
const mlL = (en: string, hi: string): string => (guideLang() === 'hi' ? hi : en);

function mlRole(): string { const u = ERP_MEERA.user(); return u.admin ? 'admin' : u.vendor ? 'vendor' : 'staff'; }
/** this browser's own daily cap (the router keeps the real one) */
function mlCount(): boolean {
  try {
    const d = new Date().toISOString().slice(0, 10), k = 'meera.learnDay';
    const v = JSON.parse(localStorage.getItem(k) || '{}');
    if (v.d !== d) { v.d = d; v.n = 0; }
    if (v.n >= 30) return false;
    v.n++;
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) { /* no storage: the router's count only */ }
  return true;
}
/** one call to her router, signed in; not signed in or no router: nothing sent */
async function mlCall(path: string, body: object | null, method = 'POST'): Promise<{ status: number; body: any }> {
  if (!GA_AI_URL) return { status: 0, body: {} };
  const tok = await ERP_MEERA.token();
  if (!tok) return { status: 0, body: {} };
  const r = await fetch(GA_AI_URL.replace(/\/$/, '') + path, { method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
  let j: any = {};
  try { j = await r.json(); } catch (e) { /* not JSON */ }
  return { status: r.status, body: j };
}
/* A NAME THE ERP'S LISTS DO NOT HAVE (yet). gaClean removes the names on the karigar and staff lists — but a list a screen
 * has not loaded, or a name not on it, would slip through. For learning only, a second net: a word that is not one of her
 * known words and stands where a name stands — just before ko / ke / ka / ki / ne / se / ji / bhai / sir (को के का की ने से
 * जी), or written with a capital letter inside the sentence — becomes [NAME]. */
let ML_KNOWN: Set<string> | null = null;
const ML_AFTER_NAME = new Set('ko ke ka ki ne se ji jee bhai bhaiya sahab saab sir madam didi को के का की ने से जी भाई'.split(' '));
function mlClean(text: string): string {
  const names = gaNames();
  let s = gaClean(text, names);
  try {
    if (!ML_KNOWN || !ML_KNOWN.size) {   // made once her answers are here (before that: the cleaning above only, and it is made again)
      /* known = a word of her answers or a filler word; the ERP's own names (parties, brands…) are not "known" here */
      const d = gaDict();
      ML_KNOWN = new Set([...Array.from(d.known)].filter(w => (d.freq.get(w) || 0) > 0 || GUIDE_STOP.has(w)));
      ML_NAMES = d.names;
      try { ML_IX = muIndex(d as unknown as MeeraDict); } catch (e) { ML_IX = null; }
      if (!GA_BANK) { ML_KNOWN = new Set(); return s; }
    }
    const parts = s.split(/(\s+)/);
    const word = (p: string) => p.replace(/^[^\p{L}]+|[^\p{L}\p{M}]+$/gu, '');
    for (let i = 0; i < parts.length; i += 2) {
      const raw = word(parts[i]), w = raw.toLowerCase();
      if (raw.length < 3 || !/^[\p{L}\p{M}]+$/u.test(raw)) continue;
      if (ML_NAMES && ML_NAMES.has(w) && !ML_KNOWN.has(w)) { parts[i] = parts[i].replace(raw, '[NAME]'); continue; }   // a party, brand or person the ERP knows
      if (ML_KNOWN.has(w)) continue;
      try { if (ML_IX && /^[a-z]+$/.test(w) && muFix(w, ML_IX)) continue; } catch (e) { /* no spelling step */ }   // a slip of one of her words ("kariger"), not a name
      const next = word(parts[i + 2] || '').toLowerCase();
      if (ML_AFTER_NAME.has(next) || (i > 0 && /^\p{Lu}/u.test(raw))) parts[i] = parts[i].replace(raw, '[NAME]');
    }
    s = parts.join('');
  } catch (e) { /* the first cleaning only */ }
  return s;
}
let ML_NAMES: Set<string> | null = null;
let ML_IX: MeeraDictIndex | null = null;
declare function gaDict(): { known: Set<string>; freq: Map<string, number>; names: Set<string> };
declare const GUIDE_STOP: Set<string>;

/** one record: the question cleaned here first; the screen, the language and the role — nothing else about the person */
async function mlSend(kind: string, q: string, answer: string | string[]): Promise<any> {
  if (!MEERA_LEARN || !String(q || '').trim() || !mlCount()) return null;
  try {
    const names = gaNames();
    const r = await mlCall('/learn', { kind, q: mlClean(q), names, screen: gaHere(), lang: gaRead(q).lang, role: mlRole(), answer });
    return r.status === 200 ? r.body : null;
  } catch (e) { return null; }
}

/* ---------- the hooks (guide-ask.js) ---------- */
/** after every answer: a miss or a "not sure" is kept; the question is remembered for a tap that may follow */
function meeraLearnAnswered(q: string, r: { miss?: unknown; off?: boolean; understood?: unknown }): void {
  if (!MEERA_LEARN) return;
  ML.last = { q, fixed: !!r.understood, near: r.miss === 'near' };
  if (!r.miss || r.off || r.miss === 'offtopic') return;
  let ids: string[] = [];
  try { ids = gaSpellFind(q).slice(0, 3).map(h => h.e.id); } catch (e) { /* none */ }
  mlSend(r.miss === 'near' ? 'unsure' : 'missed', q, r.miss === 'near' ? ids : []);
}
/** a suggested question tapped after a misspelt or unclear one: that wording is a new way of asking for this answer */
function meeraLearnTap(text: string): void {
  if (!MEERA_LEARN || !ML.last) return;
  const last = ML.last;
  ML.last = null;
  const t = String(text || '').trim().toLowerCase();
  if (!(last.fixed || last.near) || last.q.trim().toLowerCase() === t) return;
  const e = (GA_BANK ? GA_BANK.list : []).find(x => !!x.q && (['en', 'hi', 'hg'] as const).some(l => (x.q![l] || []).some(s => s.trim().toLowerCase() === t)));
  if (e && !/^learned-/.test(e.id)) mlSend('spelling', last.q, e.id);
}
/** a 👎: kept, then one line back — "What were you looking for?" — which may be left empty */
/** the note's look, once, wherever her pieces live */
function mlNoteCss(): void {
  if ($('mlNoteCss')) return;
  const st = document.createElement('style');
  st.id = 'mlNoteCss';
  st.textContent = ML_CSS.slice(ML_CSS.indexOf('.ml-note label'));
  meeraLayer().appendChild(st);
}
async function meeraLearnDown(q: string, bankId: string): Promise<void> {
  if (!MEERA_LEARN) return;
  mlNoteCss();
  const got = await mlSend('down', q, bankId);
  const log: HTMLElement | null = $('gaLog');
  if (!got || !got.id || !got.key || !log) return;
  const d = document.createElement('div');
  d.className = 'ga-msg ga-she ml-ask';
  d.innerHTML = `<form class="ml-note"><label>${mlL('What were you looking for?', 'आप क्या ढूँढ रहे थे?')} <small>${mlL('(optional)', '(ज़रूरी नहीं)')}</small></label>`
    + `<div class="ml-row"><input maxlength="300" placeholder="${mlL('One line is enough', 'एक लाइन काफ़ी है')}"><button type="submit">${mlL('Send', 'भेजें')}</button>`
    + `<button type="button" class="ml-skip">${mlL('Skip', 'छोड़ें')}</button></div></form>`;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  const form = d.querySelector('form')!, input = d.querySelector('input')!;
  d.querySelector('.ml-skip')!.addEventListener('click', () => d.remove());
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const note = input.value.trim();
    if (!note) { d.remove(); return; }
    try { await mlCall('/learn/note', { id: got.id, key: got.key, note: mlClean(note), names: gaNames() }); } catch (e) { /* kept without it */ }
    d.innerHTML = `<small>${mlL('Thank you — noted for the admin.', 'धन्यवाद — एडमिन के लिए नोट कर लिया।')}</small>`;
  });
  setTimeout(() => { try { input.focus(); } catch (e) { /* gone */ } }, 30);
}

/* ---------- the admin page ---------- */
/** her menu's extra line, for admins only */
function meeraLearnMenu(): string {
  if (!MEERA_LEARN || !ERP_MEERA.user().admin) return '';
  return `<button type="button" data-m="learn">📋<span><b>${mlL('Meera\'s learning', 'मीरा की सीख')}</b><small>${mlL('Unanswered, spellings, 👎 — admins', 'अनुत्तरित, स्पेलिंग, 👎 — एडमिन')}</small></span></button>`;
}
interface MlView {
  unanswered: { question: string; screen: string; lang: string; n: number; unsure: number; last: string; ids: number[] }[];
  spellings: { question: string; answer: string; lang: string; n: number; last: string; ids: number[] }[];
  down: { id: number; created: string; question: string; screen: string; lang: string; answer: string; note: string }[];
  tickets: { id: number; created: string; screen: string; question: string; why: string }[];
}
const ML_ADMIN = { tab: 'unanswered', view: null as MlView | null, form: null as null | { q: string; screen: string; lang: string; learnIds?: number[]; ticketId?: number } };
const ML_CSS = `
#mlAdmin{position:fixed;inset:0;z-index:2147483000;background:rgba(20,24,31,.35);display:flex;align-items:flex-start;justify-content:center;padding:5vh 16px;
  font:14px/1.45 "Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#14181F;box-sizing:border-box}
#mlAdmin *{box-sizing:border-box}
#mlAdmin .ml-box{background:#fff;border:1px solid #E8EDF3;border-radius:12px;width:min(1040px,100%);max-height:90vh;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(20,24,31,.2);overflow:hidden}
#mlAdmin .ml-head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid #E8EDF3}
#mlAdmin .ml-head b{font-size:16px}
#mlAdmin .ml-head small{color:#5A6472;display:block;font-size:12px}
#mlAdmin .ml-head button.ml-x{margin-left:auto}
#mlAdmin .ml-tabs{display:flex;gap:0;padding:0 16px;border-bottom:1px solid #E8EDF3}
#mlAdmin .ml-tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:none;color:#5A6472;font-weight:600;padding:10px 12px;box-shadow:none;font-size:13px;height:auto}
#mlAdmin .ml-tabs button.on{color:#3A5573;border-bottom-color:#4A6A92}
#mlAdmin .ml-tabs i{font-style:normal;background:#EFF2F6;border-radius:999px;padding:0 7px;margin-left:6px;font-size:11.5px}
#mlAdmin .ml-body{overflow:auto;padding:0 0 12px}
#mlAdmin table{width:100%;border-collapse:collapse;font-size:13px}
#mlAdmin th{text-align:left;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5A6472;padding:9px 12px;border-bottom:1px solid #E8EDF3;background:#F7F9FB;position:sticky;top:0}
#mlAdmin td{padding:9px 12px;border-bottom:1px solid #E8EDF3;vertical-align:top}
#mlAdmin td.n{text-align:right;white-space:nowrap}
#mlAdmin td.act{white-space:nowrap;text-align:right}
#mlAdmin .ml-empty{padding:28px 16px;color:#5A6472;text-align:center}
#mlAdmin button.ml-b,#mlAdmin button.ml-g{font:inherit;font-size:12.5px;font-weight:600;border-radius:8px;padding:5px 10px;height:auto;box-shadow:none;cursor:pointer;margin-left:6px}
#mlAdmin button.ml-b{background:#4A6A92;color:#fff;border:1px solid #4A6A92}
#mlAdmin button.ml-g{background:#fff;color:#14181F;border:1px solid #E8EDF3}
#mlAdmin .ml-form{display:grid;grid-template-columns:140px 1fr;gap:8px 12px;padding:14px 16px;border-bottom:1px solid #E8EDF3;background:#F7F9FB}
#mlAdmin .ml-form label{font-size:12.5px;color:#5A6472;padding-top:7px}
#mlAdmin .ml-form input,#mlAdmin .ml-form textarea,#mlAdmin .ml-form select{font:inherit;font-size:13px;color:#14181F;background:#fff;border:1px solid #E8EDF3;border-radius:8px;padding:7px 9px;width:100%}
#mlAdmin .ml-form textarea{min-height:64px;resize:vertical}
#mlAdmin .ml-form .ml-btns{grid-column:2;display:flex;gap:0}
#mlAdmin .ml-form .ml-btns button:first-child{margin-left:0}
#mlAdmin .ml-msg{padding:10px 16px;color:#5A6472;font-size:12.5px}
#mlAdmin code{font-size:12px;color:#5A6472}
@media (max-width:700px){#mlAdmin{padding:0}#mlAdmin .ml-box{max-height:100vh;height:100vh;border-radius:0}#mlAdmin .ml-form{grid-template-columns:1fr}#mlAdmin .ml-form .ml-btns{grid-column:1}
  #mlAdmin .ml-tabs{overflow-x:auto;white-space:nowrap;padding:0 8px}#mlAdmin .ml-tabs button{padding:10px 8px}
  #mlAdmin table,#mlAdmin tbody,#mlAdmin tr,#mlAdmin td{display:block}#mlAdmin tr:first-child{display:none}
  #mlAdmin tr{padding:10px 12px;border-bottom:1px solid #E8EDF3}#mlAdmin td{border:0;padding:2px 0}#mlAdmin td:first-child{font-weight:600}
  #mlAdmin td:not(:first-child):not(.act){display:inline-block;margin-right:12px;color:#5A6472;font-size:12px}#mlAdmin td.act{text-align:left;padding-top:6px}#mlAdmin td.act button:first-child{margin-left:0}}
.ml-note label{display:block;font-size:13px;margin-bottom:6px}
.ml-note small{color:#5A6472}
.ml-note .ml-row{display:flex;gap:6px}
.ml-note input{flex:1;min-width:0;font:inherit;font-size:13px;border:1px solid #E8EDF3;border-radius:8px;padding:6px 8px}
.ml-note button{font:inherit;font-size:12.5px;font-weight:600;border-radius:8px;padding:5px 10px;height:auto;box-shadow:none;cursor:pointer;background:#4A6A92;color:#fff;border:1px solid #4A6A92;width:auto}
#gdAsk .ml-note input{width:auto;flex:1}
#gdAsk .ml-note .ml-skip,.ml-note .ml-skip{background:#fff;color:#5A6472;border:1px solid #E8EDF3}`;

async function meeraLearnAdmin(): Promise<void> {
  if (!MEERA_LEARN) return;
  try { if (GUIDE.tour) guideClose(); } catch (e) { /* no walk-round */ }   // a walk-round holds the page: it gives way, as for Ask
  let host: HTMLElement | null = $('mlAdmin');
  if (!host) {
    host = document.createElement('div');
    host.id = 'mlAdmin';
    meeraLayer().appendChild(host);
    host.addEventListener('click', mlAdminClick);
    host.addEventListener('submit', mlAdminSubmit);
  }
  host.style.display = 'flex';
  host.innerHTML = `<style>${ML_CSS}</style><div class="ml-box"><div class="ml-msg">${mlL('Loading…', 'खुल रहा है…')}</div></div>`;
  await mlAdminLoad();
}
async function mlAdminLoad(): Promise<void> {
  let r: { status: number; body: any };
  try { r = await mlCall('/admin/learn', null, 'GET'); } catch (e) { r = { status: 0, body: {} }; }
  if (r.status === 403) { mlAdminDraw(mlL('Only admins can open this page.', 'यह पेज सिर्फ़ एडमिन खोल सकते हैं।')); return; }
  if (r.status !== 200) { mlAdminDraw(mlL('Her router could not be reached — try again in a minute.', 'राउटर से जुड़ नहीं पाई — एक मिनट बाद फिर कोशिश करें।')); return; }
  ML_ADMIN.view = r.body as MlView;
  mlAdminDraw('');
}
function mlAdminDraw(msg: string): void {
  const host: HTMLElement | null = $('mlAdmin'); if (!host) return;
  const v = ML_ADMIN.view, n = (k: keyof MlView) => (v ? v[k].length : 0);
  const tabs: [string, string][] = [['unanswered', mlL('Unanswered this week', 'इस हफ़्ते अनुत्तरित')], ['spellings', mlL('Suggested spellings', 'सुझाई स्पेलिंग')],
    ['down', mlL('👎 Not helpful', '👎 काम नहीं आया')], ['tickets', mlL('Open tickets', 'खुले टिकट')]];
  const answerName = (id: string) => { const e = (GA_BANK ? GA_BANK.list : []).find(x => x.id === id); return e ? ((e.q && (e.q.en || [])[0]) || id) : id; };
  const when = (s: string) => esc(String(s || '').slice(0, 16).replace('T', ' '));
  const btn = (cls: string, act: string, data: string, label: string) => `<button type="button" class="${cls}" data-ml="${act}" ${data}>${label}</button>`;
  let body = '';
  if (!v) body = `<div class="ml-msg">${esc(msg)}</div>`;
  else if (ML_ADMIN.tab === 'unanswered') body = v.unanswered.length ? `<table><tr><th>${mlL('Question (cleaned)', 'सवाल (साफ़ किया)')}</th><th>${mlL('Screen', 'स्क्रीन')}</th><th>${mlL('Asked', 'बार')}</th><th>${mlL('Not sure', 'पक्का नहीं')}</th><th>${mlL('Last', 'आख़िरी')}</th><th></th></tr>`
      + v.unanswered.map((x, i) => `<tr><td>${esc(x.question)}</td><td>${esc(x.screen ? gaTabName(x.screen) || x.screen : '-')}</td><td class="n">${x.n}</td><td class="n">${x.unsure || 0}</td><td>${when(x.last)}</td>`
        + `<td class="act">${btn('ml-b', 'add', `data-i="${i}"`, mlL('Add answer', 'जवाब जोड़ें'))}${btn('ml-g', 'reject', `data-ids="${x.ids.join(',')}"`, mlL('Reject', 'हटाएँ'))}</td></tr>`).join('') + '</table>'
    : `<div class="ml-empty">${mlL('Nothing unanswered this week.', 'इस हफ़्ते कुछ अनुत्तरित नहीं।')}</div>`;
  else if (ML_ADMIN.tab === 'spellings') body = v.spellings.length ? `<table><tr><th>${mlL('Typed (cleaned)', 'लिखा गया (साफ़ किया)')}</th><th>${mlL('Then chose the answer', 'फिर यह जवाब चुना')}</th><th>${mlL('Times', 'बार')}</th><th></th></tr>`
      + v.spellings.map(x => `<tr><td>${esc(x.question)}</td><td>${esc(answerName(x.answer))} <code>${esc(x.answer)}</code></td><td class="n">${x.n}</td>`
        + `<td class="act">${btn('ml-b', 'approve', `data-ids="${x.ids.join(',')}"`, mlL('Approve spelling', 'स्पेलिंग मंज़ूर'))}${btn('ml-g', 'reject', `data-ids="${x.ids.join(',')}"`, mlL('Reject', 'हटाएँ'))}</td></tr>`).join('') + '</table>'
    : `<div class="ml-empty">${mlL('No suggested spellings.', 'कोई सुझाई स्पेलिंग नहीं।')}</div>`;
  else if (ML_ADMIN.tab === 'down') body = v.down.length ? `<table><tr><th>${mlL('Question (cleaned)', 'सवाल (साफ़ किया)')}</th><th>${mlL('Answer she gave', 'उसका जवाब')}</th><th>${mlL('What they were looking for', 'वे क्या ढूँढ रहे थे')}</th><th>${mlL('When', 'कब')}</th><th></th></tr>`
      + v.down.map((x, i) => `<tr><td>${esc(x.question)}</td><td>${esc(answerName(x.answer))} <code>${esc(x.answer)}</code></td><td>${esc(x.note || '—')}</td><td>${when(x.created)}</td>`
        + `<td class="act">${btn('ml-b', 'adddown', `data-i="${i}"`, mlL('Add answer', 'जवाब जोड़ें'))}${btn('ml-g', 'reject', `data-ids="${x.id}"`, mlL('Reject', 'हटाएँ'))}</td></tr>`).join('') + '</table>'
    : `<div class="ml-empty">${mlL('No 👎 waiting.', 'कोई 👎 बाकी नहीं।')}</div>`;
  else body = v.tickets.length ? `<table><tr><th>${mlL('Question (cleaned)', 'सवाल (साफ़ किया)')}</th><th>${mlL('Screen', 'स्क्रीन')}</th><th>${mlL('Why', 'क्यों')}</th><th>${mlL('When', 'कब')}</th><th></th></tr>`
      + v.tickets.map((x, i) => `<tr><td>${esc(x.question)}</td><td>${esc(x.screen ? gaTabName(x.screen) || x.screen : '-')}</td><td>${esc(x.why || '')}</td><td>${when(x.created)}</td>`
        + `<td class="act">${btn('ml-b', 'ticket', `data-i="${i}"`, mlL('Answer ticket', 'टिकट का जवाब'))}</td></tr>`).join('') + '</table>'
    : `<div class="ml-empty">${mlL('No open tickets.', 'कोई खुला टिकट नहीं।')}</div>`;
  const f = ML_ADMIN.form;
  const form = f ? `<form class="ml-form"><label>${mlL('Question', 'सवाल')}</label><input name="q" value="${esc(f.q)}" required>`
    + `<label>${mlL('Screen', 'स्क्रीन')}</label><input name="screen" value="${esc(f.screen)}" placeholder="pbase, shop, qc…">`
    + `<label>${mlL('Language', 'भाषा')}</label><select name="lang">${[['en', 'English'], ['hi', 'हिंदी'], ['hg', 'Hinglish']].map(([k, t]) => `<option value="${k}"${f.lang === k ? ' selected' : ''}>${t}</option>`).join('')}</select>`
    + `<label>${mlL('Answer', 'जवाब')}</label><textarea name="a" required placeholder="${mlL('One or two sentences. Button names in **bold**.', 'एक-दो वाक्य। बटन के नाम **बोल्ड** में।')}"></textarea>`
    + `<label>${mlL('Why (optional)', 'क्यों (ज़रूरी नहीं)')}</label><input name="why">`
    + `<label>${mlL('Steps (one a line)', 'स्टेप (हर लाइन एक)')}</label><textarea name="steps"></textarea>`
    + `<div class="ml-btns"><button type="submit" class="ml-b">${mlL('Save answer', 'जवाब सेव करें')}</button>${btn('ml-g', 'cancel', '', mlL('Cancel', 'रद्द करें'))}</div></form>` : '';
  host.innerHTML = `<style>${ML_CSS}</style><div class="ml-box" role="dialog" aria-label="Meera's learning">`
    + `<div class="ml-head"><span><b>${mlL('Meera\'s learning', 'मीरा की सीख')}</b><small>${mlL('Questions are cleaned of names, phones, order numbers and amounts. Nothing joins her answers until you approve it.', 'सवालों से नाम, फ़ोन, ऑर्डर नंबर और रकम हटाए गए हैं। आपकी मंज़ूरी के बिना कुछ भी उसके जवाबों में नहीं जुड़ता।')}</small></span>`
    + `${btn('ml-g ml-x', 'close', '', mlL('Close', 'बंद करें'))}</div>`
    + (v ? `<div class="ml-tabs">${tabs.map(([k, t]) => `<button type="button" data-ml="tab" data-tab="${k}" class="${ML_ADMIN.tab === k ? 'on' : ''}">${t}<i>${n(k as keyof MlView)}</i></button>`).join('')}</div>` : '')
    + form + `<div class="ml-body">${msg && v ? `<div class="ml-msg">${esc(msg)}</div>` : ''}${body}</div></div>`;
}
async function mlAdminClick(ev: Event): Promise<void> {
  const host: HTMLElement | null = $('mlAdmin');
  const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-ml]');
  if (!host) return;
  if (!b) { if (ev.target === host) host.style.display = 'none'; return; }   // a click beside the page closes it
  const v = ML_ADMIN.view, i = +(b.dataset.i || 0), act = b.dataset.ml;
  if (act === 'close') { host.style.display = 'none'; ML_ADMIN.form = null; return; }
  if (act === 'tab') { ML_ADMIN.tab = b.dataset.tab || 'unanswered'; ML_ADMIN.form = null; mlAdminDraw(''); return; }
  if (act === 'cancel') { ML_ADMIN.form = null; mlAdminDraw(''); return; }
  if (!v) return;
  if (act === 'add') { const x = v.unanswered[i]; ML_ADMIN.form = { q: x.question, screen: x.screen, lang: x.lang || 'en', learnIds: x.ids }; mlAdminDraw(''); return; }
  if (act === 'adddown') { const x = v.down[i]; ML_ADMIN.form = { q: x.question, screen: x.screen, lang: x.lang || 'en', learnIds: [x.id] }; mlAdminDraw(''); return; }
  if (act === 'ticket') { const x = v.tickets[i]; ML_ADMIN.form = { q: x.question, screen: x.screen, lang: 'en', ticketId: x.id }; mlAdminDraw(''); return; }
  if (act === 'approve' || act === 'reject') {
    const ids = String(b.dataset.ids || '').split(',').map(Number).filter(Boolean);
    const r = await mlCall('/admin/learn', { ids, action: act });
    await mlAdminLoad();
    if (r.status !== 200) mlAdminDraw(mlL('That did not save — try again.', 'सेव नहीं हुआ — फिर कोशिश करें।'));
  }
}
async function mlAdminSubmit(ev: Event): Promise<void> {
  ev.preventDefault();
  const f = ML_ADMIN.form, form = ev.target as HTMLFormElement;
  if (!f) return;
  const val = (k: string) => String((form.elements.namedItem(k) as HTMLInputElement | null)?.value || '').trim();
  const body = { q: val('q'), a: val('a'), why: val('why'), steps: val('steps').split(/\n+/).map(s => s.trim()).filter(Boolean), lang: val('lang'), screen: val('screen'),
    names: gaNames(), learnIds: f.learnIds, ticketId: f.ticketId };
  const r = await mlCall('/admin/answer', body);
  ML_ADMIN.form = null;
  await mlAdminLoad();
  mlAdminDraw(r.status === 200 ? mlL('Saved. It joins her answers in every browser now, and in her answer file at the next weekly build.', 'सेव हो गया। अब हर ब्राउज़र में उसके जवाबों में है, और अगले साप्ताहिक बिल्ड में उसकी जवाब-फ़ाइल में।')
    : mlL('That did not save — try again.', 'सेव नहीं हुआ — फिर कोशिश करें।'));
}
