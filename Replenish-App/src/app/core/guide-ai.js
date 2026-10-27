/* ================= MEERA ASKS A MODEL — through her router (meera-router/, a Cloudflare Worker), 26 Oct =================
 *
 * OFF until GA_AI_URL is set. Then, when Meera is not sure of her own answer, she asks by herself (Ravi, 27 Oct: no button,
 * "until it hits our decided limit" — 10 a person, 500 the company, a day; over it, she answers on her own): the question is
 * cleaned here first (order numbers, phones, emails, tax numbers and the karigars' names taken out — the router cleans it
 * again), sent with this person's ERP sign-in, and the router asks a free model using only Meera's own nearest answers as
 * its notes. What no model can answer becomes a ticket for an admin; what an admin answers or approves comes back here
 * (GET /learned) and joins Meera's own answers. Nothing here reads or writes the ERP's data. */
const GA_AI_URL = 'https://meera-router.erp-9a0.workers.dev';   // e.g. 'https://meera-router.<account>.workers.dev' — empty: Meera answers on her own, as before

function gaAiOn() {
  try { return !!GA_AI_URL && typeof auth !== 'undefined' && !!(auth && auth.currentUser); } catch (e) { return false; }
}
/* Over today's limit (the router said 429): no more asking from this device until tomorrow. */
const gaAiDay = () => new Date().toISOString().slice(0, 10);
function gaAiAuto() {
  if (!gaAiOn()) return false;
  try { return localStorage.getItem('guideAiFull') !== gaAiDay(); } catch (e) { return true; }
}
/* The same cleaning as the router's (meera-router/src/redact.js): change one, change both. */
function gaClean(text, names) {
  let s = String(text || '').slice(0, 500);
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/gi, '[TAX-ID]').replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '[TAX-ID]')
    .replace(/\b(?:SHP|AMZ|ORD|SPY|LEG|CUST|GPO|PO|SO|INV)-[A-Z0-9][A-Z0-9-]{2,}\b|#[A-Z]{2,4}\d{3,}\b/gi, '[ORDER]')
    .replace(/\+?\d[\d\s-]{8,}\d/g, m => (m.replace(/\D/g, '').length >= 10 ? '[PHONE]' : m))
    .replace(/\b\d{5,}\b/g, '[NUMBER]');
  const list = [...new Set((names || []).filter(n => n && n.length >= 3))].sort((a, b) => b.length - a.length);
  for (const n of list) s = s.replace(new RegExp('(^|[^\\p{L}])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^\\p{L}])', 'giu'), '$1[NAME]');
  return s.replace(/\s+/g, ' ').trim();
}
function gaNames() {
  try { return (PTE.emp || []).map(e => String(e[1] || '').trim()).filter(n => n.length >= 3); } catch (e) { return []; }
}
async function gaAiCall(path, body, method = 'POST') {
  const tok = await auth.currentUser.getIdToken();
  const r = await fetch(GA_AI_URL.replace(/\/$/, '') + path, { method, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
  let j = null;
  try { j = await r.json(); } catch (e) { /* not JSON */ }
  return { status: r.status, body: j || {} };
}
/* A model's or an admin's words are text: escaped, with **bold** for button names. */
const gaMd = s => esc(String(s || '')).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const gaLL = lang => (en, hi, hg) => (lang === 'hi' ? hi : lang === 'hg' ? hg : en);

/** The question, cleaned, to the router; the answer, a ticket, or — when there is neither — `own`, Meera's own reply
 * ({html, acts}), shown as it would have been without AI. */
async function gaAiAsk(q, own) {
  const { lang, means, words } = gaRead(q), L = gaLL(lang);
  await gaBankLoad();
  const ids = gaBankFind(means, words, q).map(h => h.e.id).filter(id => !/^learned-/.test(id)).slice(0, 5);
  gaSay(L('Asking… one moment.', 'पूछ रही हूँ… एक पल।', 'Poochh rahi hoon… ek pal.'), []);
  const wait = $('gaLog').lastElementChild;
  let r;
  try { r = await gaAiCall('/ask', { q: gaClean(q, gaNames()), lang, screen: gaHere(), ids, names: gaNames() }); }
  catch (e) { r = { status: 0, body: {} }; }
  if (wait) wait.remove();
  const b = r.body || {};
  if (r.status === 200 && b.answer) {
    const a = b.answer;
    const html = `<div class="ga-a">${gaMd(a.a)}</div>`
      + (a.why ? `<div class="ga-why"><b>${L('Why', 'क्यों', 'Kyun')}</b>${gaMd(a.why)}</div>` : '')
      + (a.steps && a.steps.length ? `<div class="ga-do"><b>${L('What to do', 'क्या करें', 'Kya karein')}</b><ol>${a.steps.map(s => `<li>${gaMd(s)}</li>`).join('')}</ol></div>` : '')
      + `<div class="ga-note">${b.source === 'saved' ? L('Answer checked by an admin.', 'एडमिन का जाँचा हुआ जवाब।', 'Admin ka jaancha hua jawaab.') : L('Written by AI from Meera\'s notes — not yet checked by an admin.', 'मीरा के नोट्स से AI का लिखा — एडमिन ने अभी जाँचा नहीं।', 'Meera ke notes se AI ka likha — admin ne abhi jaancha nahi.')}</div>`;
    const fb = `<div class="ga-fb"><span>${L('Did this help?', 'क्या इससे मदद मिली?', 'Kya isse madad mili?')}</span><button type="button" class="ga-fbb" data-ga="aifb" data-id="up:${+b.answerId || 0}" aria-label="Yes">👍</button><button type="button" class="ga-fbb" data-ga="aifb" data-id="down:${+b.answerId || 0}" aria-label="No">👎</button></div>`;
    gaSay(html, [], fb);
    return;
  }
  if (b.offTopic) { gaSay(L('Sorry, I can\'t answer that — it isn\'t about the ERP. Ask me about any screen, job or problem in the ERP.', 'माफ़ कीजिए, इसका जवाब मैं नहीं दे सकती — यह ERP के बारे में नहीं है। ERP की किसी भी स्क्रीन, काम या दिक्कत के बारे में पूछें।', 'Sorry, iska jawaab main nahi de sakti — ye ERP ke baare me nahi hai. ERP ki kisi bhi screen, kaam ya dikkat ke baare me poochiye.'), []); return; }
  if (r.status === 429) { try { localStorage.setItem('guideAiFull', gaAiDay()); } catch (e) { /* asks again next time */ } }
  if (b.ticket) {
    gaSay(r.status === 429
      ? L(`Today's AI questions are used up. I have sent your question to the admin team (ticket #${+b.ticket}).`, `आज के AI सवाल पूरे हो गए। मैंने आपका सवाल एडमिन टीम को भेज दिया है (टिकट #${+b.ticket})।`, `Aaj ke AI sawaal poore ho gaye. Maine aapka sawaal admin team ko bhej diya hai (ticket #${+b.ticket}).`)
      : L(`I don't have a sure answer to this. I have sent it to the admin team (ticket #${+b.ticket}); they will answer when they are online, and I will know it next time.`, `इसका पक्का जवाब मेरे पास नहीं है। मैंने इसे एडमिन टीम को भेज दिया है (टिकट #${+b.ticket}); वे ऑनलाइन आकर जवाब देंगे, और अगली बार मुझे पता होगा।`, `Iska pakka jawaab mere paas nahi hai. Maine ise admin team ko bhej diya hai (ticket #${+b.ticket}); woh online aakar jawaab denge, aur agli baar mujhe pata hoga.`), []);
    return;
  }
  gaMissKeep(q, 'ai-unavailable');
  if (own) { if (own.html) gaSay(own.html, own.acts || []); return; }   // her own answer, as without AI
  gaSay(L('AI is not available right now. I have noted your question here.', 'AI अभी उपलब्ध नहीं है। मैंने आपका सवाल यहाँ नोट कर लिया है।', 'AI abhi uplabdh nahi hai. Maine aapka sawaal yahan note kar liya hai.'), []);
}
async function gaAiFeedback(id) {
  const up = id.startsWith('up:'), lang = gaRead(GA.lastQ || '').lang, L = gaLL(lang);
  let t = null;
  try { const r = await gaAiCall('/feedback', { answerId: +id.slice(id.indexOf(':') + 1) || 0, up, q: gaClean(GA.lastQ || '', gaNames()), screen: gaHere(), lang }); t = r.body && r.body.ticket; } catch (e) { /* noted below */ }
  gaSay(up ? L('Thank you! 🙏', 'धन्यवाद! 🙏', 'Dhanyavaad! 🙏')
    : L(`Sorry. I have sent this to the admin team${t ? ` (ticket #${+t})` : ''}.`, `माफ़ कीजिए। मैंने इसे एडमिन टीम को भेज दिया है${t ? ` (टिकट #${+t})` : ''}।`, `Maaf kijiye. Maine ise admin team ko bhej diya hai${t ? ` (ticket #${+t})` : ''}.`), []);
}

/** What admins answered or approved: joins Meera's own answers (as learned-<id>). Never holds up her own list. */
async function gaAiLearned(list) {
  if (!gaAiOn()) return list;
  try {
    const r = await Promise.race([gaAiCall('/learned', null, 'GET'), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3000))]);
    const got = (r.body && r.body.answers) || [];
    return list.concat(got.map(x => {
      const a = x.answer || {}, one = v => ({ en: v, hi: v, hg: v });
      return { id: 'learned-' + x.id, tab: x.screen || '', q: { en: [x.question], hi: [x.question], hg: [x.question] }, a: one(gaMd(a.a)),
        why: a.why ? one(gaMd(a.why)) : undefined, steps: a.steps && a.steps.length ? one(a.steps.map(gaMd)) : undefined };
    }));
  } catch (e) { return list; }
}

/** For admins, in Ask Meera: "tickets" lists the open ones, each with a box to answer it. */
async function gaAiCommand(q) {
  if (!/^\s*(meera\s+)?tickets?\s*$/i.test(q) || !gaAiOn()) return false;
  const r = await gaAiCall('/admin/tickets', null, 'GET').catch(() => ({ status: 0, body: {} }));
  if (r.status === 403) { gaSay('Only an admin can see tickets.', []); return true; }
  const list = (r.body && r.body.tickets) || [];
  GA.tickets = new Map(list.map(t => [String(t.id), t]));
  gaSay(list.length ? `<b>${list.length} open ticket(s)</b>` + list.slice(0, 20).map(t => `<div class="ga-tk"><small>#${+t.id} · ${esc(t.screen || '-')} · ${esc(t.why || '')} · ${esc(String(t.created || '').slice(0, 16))}</small>`
      + `<div>${esc(t.question)}</div><textarea id="gaTk${+t.id}" rows="2" placeholder="Write the answer (it joins Meera's answers)"></textarea>`
      + `<button type="button" class="ga-act" data-ga="aians" data-id="${+t.id}">Save answer</button></div>`).join('')
    : (r.status === 200 ? 'No open tickets.' : 'Could not read the tickets.'), []);
  return true;
}
async function gaAiAnswer(id) {
  const t = GA.tickets && GA.tickets.get(String(id)), box = $('gaTk' + id);
  if (!t || !box || !box.value.trim()) return;
  const r = await gaAiCall('/admin/answer', { ticketId: +id, q: t.question, screen: t.screen, lang: gaRead(t.question).lang, a: box.value.trim() }).catch(() => ({ status: 0 }));
  if (r.status === 200) { box.closest('.ga-tk').innerHTML = `<small>#${+id} answered — it joins Meera's answers.</small>`; GA_BANK = null; GA_BANK_P = null; GA_SEM = null; }
  else gaSay('Could not save that answer.', []);
}
