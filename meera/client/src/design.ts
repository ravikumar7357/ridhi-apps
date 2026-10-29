/* MEERA'S NEW LOOK (v2 rebuild, Phase 3, 29 Oct 2026) — switch "design" (core/meera-bridge.js), meera.js only.
 *
 * It changes how she looks, never what she answers: her answers are made exactly as before (guide-ask.js), and only
 * the way they are laid out on screen changes here. Switch off, every function below returns at once.
 *
 *   her sealed box   all her pieces live inside one Shadow DOM box (#meera-host): the ERP's styles cannot reach them
 *                    and hers cannot reach the ERP; her buttons and boxes have their own styles (design.css, part 1)
 *   answer card      where the answer came from (her ERP guide, or the AI — amber, "please check"), one bold line, one
 *                    main button; the steps and the why folded under "Steps and why"
 *   opens on screen  a red message on the screen → "Help with this"; three common questions for the screen open now
 *   getting ready    a thin line while her files arrive; typing works meanwhile
 *   English / हिंदी   in the Ask box's header; buttons and labels follow it (an answer is in Hinglish only when the
 *                    question was typed in Hinglish)
 *   walk-rounds      her full figure only on a first visit's walk-round; on a phone, the bubble is a sheet at the bottom
 *                    and the box she points at is kept in view above it
 * The hooks are called from her files with `typeof meeraDesign… === 'function'`, so inside the page they are never there. */

declare const __MEERA_DESIGN_CSS__: string;
declare function guideLang(): string;
declare function gaHere(): string;
declare function gaTabName(tab: string): string;
declare function gaRedLines(): HTMLElement[];
declare function gaBankLoad(): Promise<unknown>;
declare function gaWordsLoad(): Promise<unknown>;
declare function gaChipsDraw(): void;
declare let GA_BANK: { list: MdEntry[] } | null;
declare let GA_W: unknown;
interface MdEntry { id: string; tab?: string; q?: { en?: string[]; hi?: string[]; hg?: string[] } }

const MEERA_DESIGN: boolean = meeraOn('design');
let MD_HOST: HTMLElement | null = null;
const MD = { seen: '', tried: null as Element | null };

/** where her pieces go: her sealed box (made the first time), or the page with the switch off */
function meeraLayer(): Node {
  if (!MEERA_DESIGN) return document.body;
  if (MD_HOST) return MEERA_SHADOW || MD_HOST;
  const host = document.createElement('div');
  host.id = 'meera-host';
  document.body.appendChild(host);
  MD_HOST = host;
  if (typeof host.attachShadow === 'function') {
    MEERA_SHADOW = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = __MEERA_DESIGN_CSS__;
    MEERA_SHADOW.appendChild(st);
  }
  /* the ERP's phone layout (html.mob), mirrored on her box */
  const sync = () => host.classList.toggle('mob', document.documentElement.classList.contains('mob'));
  sync();
  try { new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); } catch (e) { /* no watcher: as it was at the start */ }
  return MEERA_SHADOW || host;
}

/* ---------- words: buttons and labels follow the switch ---------- */
const mdL = (en: string, hi: string): string => (guideLang() === 'hi' ? hi : en);
/** every button and label she shows, in English, Hindi and Hinglish — found in any of the three, shown in the switch's */
const MD_WORDS: [string, string, string][] = [
  ['Do it with me', 'मेरे साथ करें', 'Mere saath kijiye'],
  ['Show me how', 'करके दिखाएँ', 'Karke dikhaiye'],
  ['Carry on from where I am', 'जहाँ हूँ वहाँ से आगे करवाएँ', 'Jahan hoon wahan se aage karwaiye'],
  ['Guide me step by step', 'स्टेप-बाय-स्टेप करवाएँ', 'Step-by-step karwaiye'],
  ['Show me', 'दिखाएँ', 'Dikhaiye'],
  ['Show me the line', 'लाइन दिखाएँ', 'Line dikhaiye'],
  ['Show me round this screen', 'यह स्क्रीन घुमाकर दिखाएँ', 'Ye screen ghuma ke dikhaiye'],
  ['Why', 'क्यों', 'Kyun'],
  ['What to do', 'क्या करें', 'Kya karein'],
  ['What it shows', 'इसमें क्या है', 'Isme kya hai'],
  ['This screen', 'यह स्क्रीन', 'Ye screen'],
  ['Did this help?', 'क्या इससे मदद मिली?', 'Kya isse madad mili?'],
  ['Related', 'इससे जुड़े', 'Isse jude'],
  ['Search what I typed', 'जैसा लिखा वैसा खोजें', 'Jaisa likha waisa khojiye'],
  ['Answer checked by an admin.', 'एडमिन का जाँचा हुआ जवाब।', 'Admin ka jaancha hua jawaab.'],
  ['Written by AI from Meera\'s notes — not yet checked by an admin.', 'मीरा के नोट्स से AI का लिखा — एडमिन ने अभी जाँचा नहीं।', 'Meera ke notes se AI ka likha — admin ne abhi jaancha nahi.'],
];
function mdRelabel(el: Element): void {
  const t = (el.textContent || '').trim();
  const w = MD_WORDS.find(x => x.includes(t));
  if (w) el.textContent = mdL(w[0], w[1]);
}
/** a button by what it does: "Open <screen>" and "Show me: <box>" carry a name */
function mdAct(b: HTMLElement): void {
  const t = b.dataset.ga || '';
  if (t === 'open' && b.dataset.tab) { const n = gaTabName(b.dataset.tab); b.textContent = mdL(`Open ${n}`, `${n} खोलें`); return; }
  const m = /^(?:Show me|दिखाएँ|Dikhaiye):\s*(.+)$/.exec((b.textContent || '').trim());
  if (t === 'fixel' && m) { b.textContent = mdL(`Show me: ${m[1]}`, `दिखाएँ: ${m[1]}`); return; }
  mdRelabel(b);
}
function mdUnd(u: Element): void {
  const b = u.querySelector('b'), btn = u.querySelector('.ga-und-b');
  if (!b) return;
  u.innerHTML = `${mdL('Showing results for', 'इसके नतीजे')} <b>${esc(b.textContent)}</b>${mdL(' — did you mean something else?', ' — कुछ और पूछना था?')} `;
  if (btn) { mdRelabel(btn); u.appendChild(btn); }
}
const MD_SRC: Record<string, [string, string]> = {
  guide: ['✓ From the ERP guide', '✓ ERP गाइड से'],
  ai: ['⚠ Suggested — please check', '⚠ सुझाव — कृपया जाँच लें'],
  checked: ['✓ Checked by an admin', '✓ एडमिन का जाँचा हुआ'],
};

/* ---------- the answer card ---------- */
/** one message from her, laid out the new way (guide-ask.js gaSay calls this; src = where the answer came from) */
function meeraDesignSay(d: HTMLElement, src: string): void {
  if (!MEERA_DESIGN) return;
  try {
    d.dataset.mdSrc = src;
    d.querySelectorAll<HTMLElement>('.ga-act').forEach(mdAct);
    d.querySelectorAll('.ga-why>b, .ga-do>b, .ga-fb>span, .ga-rel>span, .ga-note').forEach(mdRelabel);
    const und = d.querySelector('.ga-und'); if (und) mdUnd(und);
    const a = d.querySelector(':scope > .ga-a');
    if (!a) return;   // a short reply (hello, not sure, did you mean): as a plain note
    const card = document.createElement('div');
    card.className = 'md-card' + (src === 'ai' ? ' ai' : '');
    if (MD_SRC[src]) {
      const fb = d.querySelector<HTMLElement>('[data-ga="fb"]'), id = fb ? (fb.dataset.id || '').replace(/^up:/, '') : '';
      const e = id && GA_BANK ? GA_BANK.list.find(x => x.id === id) : null, where = e && e.tab ? gaTabName(e.tab) : '';
      card.innerHTML = `<div class="md-src${src === 'ai' ? ' ai' : ''}"><span class="md-srct">${mdL(MD_SRC[src][0], MD_SRC[src][1])}</span><span class="md-where">${esc(where)}</span></div>`;
    }
    d.insertBefore(card, a);
    card.appendChild(a);
    const acts = d.querySelector(':scope > .ga-acts');
    if (acts) { card.appendChild(acts); const first = acts.querySelector('.ga-act'); if (first) first.classList.add('md-main'); }
    const fold = Array.from(d.querySelectorAll(':scope > .ga-do')).concat(Array.from(d.querySelectorAll(':scope > .ga-why')));
    if (fold.length) {
      const n = d.querySelectorAll(':scope > .ga-do li').length;
      const more = document.createElement('details');
      more.className = 'md-more';
      more.innerHTML = `<summary>${mdL('Steps and why', 'स्टेप और क्यों')}${n ? ' (' + n + ')' : ''}</summary>`;
      fold.forEach(x => more.appendChild(x));
      card.appendChild(more);
    }
    d.querySelectorAll(':scope > .ga-note, :scope > .ga-empty').forEach(x => card.appendChild(x));
    const fb = d.querySelector(':scope > .ga-fb'); if (fb) card.appendChild(fb);
    const rel = d.querySelector(':scope > .ga-rel'); if (rel) d.appendChild(rel);
    d.classList.add('md-has-card');
    const chips = $('gaChips'); if (chips) chips.classList.add('md-quiet');   // they come back when she is not sure (gaChipsDraw)
    setTimeout(() => { const log = $('gaLog'); if (log && d.offsetHeight > log.clientHeight - 40) log.scrollTop = d.offsetTop - log.offsetTop - 8; }, 0);   // the start of the answer, not its end
  } catch (e) { /* laid out as before */ }
}

/* ---------- the Ask box opening ---------- */
function meeraDesignAskOpen(): void {
  if (!MEERA_DESIGN) return;
  try { mdHead(); mdReady(); mdSeen(); } catch (e) { /* the box as before */ }
}
/** the header: her name and the English / हिंदी switch; the form's words */
function mdHead(): void {
  const box = $('gdAsk'); if (!box) return;
  if (!$('mdSeg')) {
    const seg = document.createElement('span');
    seg.id = 'mdSeg';
    seg.className = 'md-seg';
    seg.innerHTML = '<button type="button" data-md-lang="en">English</button><button type="button" data-md-lang="hi">हिंदी</button>';
    const head = box.querySelector('.ga-head'), x = $('gaClose');
    if (head && x) head.insertBefore(seg, x);
    seg.addEventListener('click', ev => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-md-lang]'); if (!b) return;
      try { localStorage.setItem('guideLang', b.dataset.mdLang || 'en'); } catch (e) { /* this visit only */ }
      mdHead();
      const log: HTMLElement | null = $('gaLog');
      if (log) log.querySelectorAll<HTMLElement>('.ga-msg.ga-she').forEach(m => mdRelabelMsg(m));
      gaChipsDraw();
    });
  }
  const hi = guideLang() === 'hi';
  $('mdSeg').querySelectorAll('[data-md-lang]').forEach((b: HTMLElement) => b.classList.toggle('on', (b.dataset.mdLang === 'hi') === hi));
  const who = box.querySelector('.ga-who b'); if (who) who.textContent = mdL('Ask Meera', 'मीरा से पूछें');
  const q = $('gaQ'); if (q) q.placeholder = mdL('Ask anything — e.g. karigar ko kaam kaise de', 'कुछ भी पूछें — जैसे कारीगर को काम कैसे दें');
  const send = $('gaSend'); if (send) send.textContent = mdL('Ask', 'पूछें');
}
/** an earlier message's buttons and labels, again in the switch's language (its answer stays as it was) */
function mdRelabelMsg(d: HTMLElement): void {
  d.querySelectorAll<HTMLElement>('.ga-act').forEach(mdAct);
  d.querySelectorAll('.ga-why>b, .ga-do>b, .ga-fb>span, .ga-rel>span, .ga-note').forEach(mdRelabel);
  const und = d.querySelector('.ga-und'); if (und) mdUnd(und);
  const s = d.querySelector('.md-srct'), src = MD_SRC[d.dataset.mdSrc || ''];
  if (s && src) s.textContent = mdL(src[0], src[1]);
  const sum = d.querySelector('.md-more summary');
  if (sum) { const n = d.querySelectorAll('.md-more .ga-do li').length; sum.textContent = mdL('Steps and why', 'स्टेप और क्यों') + (n ? ' (' + n + ')' : ''); }
  const seen = d.querySelector('.md-seen');
  if (seen) { const b = seen.querySelector('b'), btn = seen.querySelector<HTMLElement>('button');
    if (b) b.textContent = mdL('I can see this message on the screen', 'स्क्रीन पर यह मैसेज दिख रहा है');
    if (btn) { btn.textContent = mdL('Help with this', 'इसमें मदद करें'); btn.dataset.gq = mdL('Why isn\'t this working?', 'यह सेव क्यों नहीं हो रहा?'); } }
}
/** "Getting ready…" while her answers and her meaning list arrive; the box can be typed in meanwhile */
function mdReady(): void {
  if ((GA_BANK && GA_W !== null) || $('mdReady')) return;
  const box = $('gdAsk'), head = box && box.querySelector('.ga-head');
  if (!head) return;
  const line = document.createElement('div');
  line.id = 'mdReady';
  line.innerHTML = `<span>${mdL('Getting ready… you can type now', 'तैयार हो रही हूँ… आप लिखना शुरू करें')}</span><i></i>`;
  head.insertAdjacentElement('afterend', line);
  const done = () => { line.remove(); gaChipsDraw(); };
  Promise.all([gaBankLoad(), gaWordsLoad()]).then(done, done);
  setTimeout(() => { if (line.isConnected) line.remove(); }, 20000);   // never a line that stays
}
/** a red message on the screen: she says she sees it, and offers to help with it */
function mdSeen(): void {
  const red = gaRedLines()[0];
  const text = red ? (red.textContent || '').trim() : '';
  if (!text || text === MD.seen) return;
  MD.seen = text;
  const log = $('gaLog'); if (!log) return;
  const d = document.createElement('div');
  d.className = 'ga-msg ga-she md-has-card';
  d.innerHTML = `<div class="md-seen"><b>${mdL('I can see this message on the screen', 'स्क्रीन पर यह मैसेज दिख रहा है')}</b><div class="md-msg">${esc(text.length > 200 ? text.slice(0, 197) + '…' : text)}</div>`
    + `<button type="button" data-gq="${esc(mdL('Why isn\'t this working?', 'यह सेव क्यों नहीं हो रहा?'))}">${mdL('Help with this', 'इसमें मदद करें')}</button></div>`;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}
/** below the conversation: three common questions for the screen open now, as rows */
function meeraDesignChips(): void {
  if (!MEERA_DESIGN) return;
  try {
    const box: HTMLElement | null = $('gaChips'); if (!box) return;
    box.classList.remove('md-quiet');
    const tab = gaHere(), hi = guideLang() === 'hi';
    const list = (GA_BANK ? GA_BANK.list : []).filter(e => e.tab === tab && e.q).slice(0, 3)
      .map(e => ((hi ? e.q!.hi : e.q!.en) || e.q!.en || [])[0]).filter(Boolean) as string[];
    if (!list.length) {   // her answers not here yet: the first three of the usual suggestions
      const old = Array.from(box.querySelectorAll<HTMLElement>('.ga-chip')).slice(0, 3).map(b => b.dataset.gq || '');
      list.push(...old.filter(Boolean));
    }
    const name = tab ? gaTabName(tab) : '';
    box.innerHTML = `<span class="md-h">${name ? mdL('Common on', 'अक्सर पूछे गए —') + ' ' + esc(name) : mdL('Common questions', 'अक्सर पूछे गए')}</span>`
      + `<div class="md-rows">${list.map(q => `<button type="button" class="ga-chip" data-gq="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
  } catch (e) { /* the suggestions as before */ }
}
/** the language of her answers: हिंदी when chosen in the Ask box; otherwise as typed (guide-ask.js gaRead) */
function meeraDesignLang(): string | null {
  return MEERA_DESIGN && guideLang() === 'hi' ? 'hi' : null;
}

/* ---------- walk-rounds ---------- */
/** her full figure only on a first visit's walk-round (it opened by itself); elsewhere her face in the bubble */
function meeraDesignShow(t: { kind: string; first?: boolean }): void {
  if (!MEERA_DESIGN) return;
  const root = $('gdRoot'); if (root) root.classList.toggle('md-fig', t.kind === 'tour' && !!t.first);
}
/** on a phone the bubble is a sheet at the bottom: the box she points at must stay in view above it — the page is
 * moved up once; if it cannot move, the sheet goes to the top instead */
function meeraDesignPlace(el: Element | null, r: DOMRect | null, bub: HTMLElement | null): void {
  if (!MEERA_DESIGN || !MD_HOST || !MD_HOST.classList.contains('mob') || !el || !r || !bub) return;
  const bh = bub.getBoundingClientRect().height;
  if (r.bottom <= innerHeight - bh - 8) { bub.classList.remove('gd-up'); MD.tried = null; return; }
  if (MD.tried !== el) {
    MD.tried = el;
    window.scrollBy(0, r.bottom - (innerHeight - bh - 16));
    r = el.getBoundingClientRect();
    if (r.bottom <= innerHeight - bh - 8) return;   // the page moved: her scroll watcher places her again
  }
  bub.classList.toggle('gd-up', r.top > bh + 8);   // the page cannot move: the sheet goes to the top
}
