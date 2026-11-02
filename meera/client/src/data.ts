/* MEERA ANSWERS FROM THE ERP'S OWN FIGURES (v2 rebuild, Phase 7, 2 Nov 2026; switch "data", off) — meera.js only.
 *
 * Six kinds of question, each answered from what this page already holds, through the bridge's read-only calls
 * (ERP_MEERA.data — core/meera-bridge.js):
 *   where is an order        stage of each line, who holds the pieces, the last work and when      → Order Console
 *   what a karigar holds     pieces given and not yet back                                          → Job Work Register
 *   stock of a SKU           the India store                                                        → Finished Goods
 *   waiting at a stage       QC, cutting, printer (vendor), karigar, issue                          → Order Console
 *   today's counts           issued, received (Job Work Register); passed (Quality Control)
 *   late orders              the Order Console's own rule: no work for 5 days or more               → Order Console
 * Rules: READ ONLY — she never saves, and never makes the ERP read the database (a screen not read yet: she asks the
 * person to open it). A screen the account cannot open: "Aapke account mein yeh screen nahi hai", and no figure. The
 * question and its figures never go to the AI or her router and are never kept: a data answer is given here and
 * stops (guide-ask.ts gaAsk). Every answer says where its figures come from and when, with a button to that screen on
 * the right line. Not sure which karigar or SKU was meant: she asks ("kaunsa Raju — Raju Kumar ya Raju Singh?"). */

declare function gaSay(html: string, acts?: { t: string; id?: string; tab?: string; label: string }[], after?: string, src?: string): void;
declare function gaRead(q: string): { lang: string; means: string[]; words: string[] };
declare function muDistance(a: string, b: string, max: number): number;

const MEERA_DATA: boolean = meeraOn('data');
type MdLang = 'en' | 'hi' | 'hg';
type MdAsk = { kind: 'order'; no: string } | { kind: 'order-missing'; text: string } | { kind: 'karigar'; name: string } | { kind: 'karigar-which'; said: string; names: string[] }
  | { kind: 'sku'; sku: string } | { kind: 'sku-which'; said: string; skus: string[] } | { kind: 'today'; focus: string } | { kind: 'late' } | { kind: 'wait'; stage: string };

/* ---------- reading the question ---------- */
const MD_HOW = /\b(kaise|kese|kaisey|kaisay|how to|how do|how can|kaha likh\w*|kahan likh\w*|kaha chadha\w*|kaha daal\w*|kaha enter|entry kaise|kya kar(u|un|e|na)|how (are|is|does|did|come))\b|कैसे|कहाँ लिखूं|कहाँ चढ़ाऊं/;
/* never a figures question: what a word or a box means, pay and money, the past (last week, yesterday), attendance — her
 * answers or the AI, as before (measured 2 Nov: without this, 25 of her 580 recorded questions were taken) */
const MD_NOT = /\b(matlab|meaning|mean|means|stands for|what does|what is (this|that)|what's this|what happens|kya hota|kya karta|kya karti|button|column|press|dabane|payment|salary|hisab|hisaab|paisa|paise|rate|advance|attendance|hajri|haziri|tds|bill|last week|is hafte|pichhle|pichle|yesterday|kal|week|month|mahine|hafte)\b|मतलब|सैलरी|हाजिरी|पिछले|कल/;
const MD_WHERE = /\b(kaha|kahan|kahaan|kha|kidhar|where|status|stage|haal|position|tak pahuncha|pahucha)\b|कहाँ|कहां|किधर|स्टेटस/;
const MD_COUNT = /\b(kitne|kitna|kitni|kitane|kitnay|how many|how much|count|total|kul)\b|कितने|कितना|कितनी/;
const MD_HOLD = /\b(paas|pass|holding|holds|has|have|ke yaha|ke yahan|pe|par)\b|पास/;
const MD_THINGS = /\b(maal|mal|piece|pieces|pcs|pc|kaam|kam|work)\b|माल|पीस|काम/;
const MD_STOCK = /\b(stock|stok|stck|available|store|godown|inventory|bacha|bache|bachi|pada|pade|padi)\b|स्टॉक|बचा|बचे/;
const MD_WAIT = /\b(waiting|wait|pending|pendng|pada|padi|pade|baki|baaki|bacha|bache|atka|atki|atke|ruka|ruki|stuck|lying)\b|बाकी|पड़ा|पड़े|पड़ी|रुका|अटका|पेंडिंग/;
const MD_TODAY = /\b(aaj|aj|today|todays|today's)\b|आज/;
const MD_LATE = /\b(late|der|delay|delayed|overdue|peeche|pichhe)\b|लेट|देर/;
const MD_LIST = /\b(order|orders|ordr|odrer|line|lines|kaun|kaunse|konse|kon se|which|list|sab)\b|ऑर्डर|लाइन|कौन/;
const MD_STAGES: [string, RegExp][] = [['QC', /\b(qc|q\.c|quality|checking)\b|क्यूसी/], ['Cutting', /\b(cutting|cuting|kutting|katai)\b|कटिंग/],
  ['Vendor', /\b(printer|printers|printing|vendor|vendors|print)\b|प्रिंटर|वेंडर|प्रिंटिंग/], ['Karigar', /\b(karigar|karigars|karigaron|kaarigar)\s+(ke paas|ke pass|pe|par)\b|\bwith (the )?karigars?\b|कारीगरों के पास|कारीगर के पास/]];
const MD_ORDERLIKE = /^(amz|spy|shp|b2b|onl|adj|leg)[-a-z0-9]*\d[-a-z0-9]*$/i;

const mdWords = (q: string): string[] => String(q || '').split(/[\s,?!।.;:()]+/).filter(Boolean);
const mdBare = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const mdNf = (n: number): string => (Number(n) || 0).toLocaleString('en-IN');

/** what the question asks for, or null when it is not about the ERP's figures (a how-to goes to her answers as before) */
function mdParse(q: string, D: ErpMeeraData): MdAsk | null {
  const low = ' ' + String(q || '').toLowerCase().replace(/\s+/g, ' ') + ' ', ws = mdWords(q);
  if (MD_HOW.test(low) || MD_NOT.test(low)) return null;
  /* an order number ("AMZ-16092026-02", "amz1609202602", "RBP7620" for SHP-RBP7620) */
  const orderish = ws.filter(w => (MD_ORDERLIKE.test(w) && /\d{3,}/.test(w)) || (/^[a-z]{2,4}\d{3,}$/i.test(w) && MD_WHERE.test(low)));
  if (orderish.length) {
    const all = D.orders(), byBare = new Map(all.map(o => [mdBare(o), o]));
    for (const w of orderish) {
      const b = mdBare(w), hit = byBare.get(b) || all.find(o => mdBare(o).endsWith(b) && o.toUpperCase().endsWith(w.toUpperCase()));
      if (hit) return { kind: 'order', no: hit };
    }
    const w0 = orderish.find(w => MD_ORDERLIKE.test(w));
    /* the Order Console cannot be read here (not allowed, or not opened yet): findOrder says which */
    if (w0) return all.length ? { kind: 'order-missing', text: w0.toUpperCase() } : { kind: 'order', no: w0.toUpperCase() };
  }
  /* a karigar ("Raju Kumar", "Raju" — two Rajus: she asks which; one letter off in a longer name is still him) */
  const names = D.karigars(), lw = ws.map(w => w.toLowerCase());
  const full = names.filter(n => { const p = n.toLowerCase().split(/\s+/); return p.length > 1 && lw.some((w, i) => p.every((x, j) => lw[i + j] === x)); });
  let cand: string[] = full.length ? [full.sort((a, b) => b.length - a.length)[0]] : [];
  let said = '';
  if (!cand.length) for (const w of lw) {
    if (w.length < 3 || /^\d/.test(w)) continue;
    const near = (x: string) => x === w || (w.length >= 5 && x.length >= 5 && muDistance(x, w, 1) <= 1);
    const c = names.filter(n => n.toLowerCase().split(/\s+/).some(near));
    if (c.length) { cand = c; said = w; break; }
  }
  const aboutHolding = MD_COUNT.test(low) || MD_HOLD.test(low) || MD_WAIT.test(low) || MD_THINGS.test(low);
  if (cand.length && aboutHolding && !MD_TODAY.test(low)) {
    if (cand.length === 1) return { kind: 'karigar', name: cand[0] };
    return { kind: 'karigar-which', said: said || cand[0].split(/\s+/)[0], names: cand.slice(0, 6) };
  }
  /* a SKU ("CPC008-04"; "CPC008" when it has several sizes: she asks which) */
  if (MD_STOCK.test(low) || MD_COUNT.test(low)) {
    const set = new Set(D.skus());
    for (const w of ws) {
      const u = w.toUpperCase();
      if (!/\d/.test(u) || u.length < 4) continue;
      if (set.has(u)) return { kind: 'sku', sku: u };
      const pre = [...set].filter(s => s.startsWith(u + '-') || mdBare(s) === mdBare(u));
      if (pre.length === 1) return { kind: 'sku', sku: pre[0] };
      if (pre.length > 1 && pre.length <= 8) return { kind: 'sku-which', said: u, skus: pre };
    }
  }
  if (MD_TODAY.test(low)) {
    /* pieces only: "aaj kitne order aaye", "aaj kitne karigar aaye" are not this */
    const pcs = MD_THINGS.test(low);
    const f = [/\b(issue|issued|isue)\b|इश्यू/.test(low) || (pcs && /\b(diya|diye|de diya|given)\b|दिया|दिए/.test(low)) ? 'issued' : '',
      /\b(qc pass|passed|pass hue|pass hua)\b|क्यूसी पास|qc\s+pass/.test(low) ? 'passed' : '',
      /\b(receive|received|recieve|recieved)\b|रिसीव/.test(low) || (pcs && /\b(aaya|aaye|aya|aye|wapas|back)\b|आया|आए/.test(low)) ? 'received' : ''].filter(Boolean);
    if (f.length && MD_COUNT.test(low)) return { kind: 'today', focus: f.length === 1 ? f[0] : '' };
  }
  if (MD_LATE.test(low) && (MD_LIST.test(low) || MD_COUNT.test(low))) return { kind: 'late' };
  const st = MD_STAGES.find(([, re]) => re.test(low));
  if (st && MD_WAIT.test(low) && (MD_COUNT.test(low) || /\b(kya|what)\b|क्या/.test(low)) && !cand.length) return { kind: 'wait', stage: st[0] };
  return null;
}

/* ---------- answering ---------- */
function mdSource(f: ErpMeeraFrom, L: (en: string, hi: string, hg: string) => string): string {
  const n = esc(f.name || f.tab), t = esc(f.asOf || '');
  return `<div class="ga-und">${t ? L(`From <b>${n}</b>, as of ${t}`, `<b>${n}</b> से, ${t} तक`, `<b>${n}</b> se, ${t} tak`) : L(`From <b>${n}</b>`, `<b>${n}</b> से`, `<b>${n}</b> se`)}</div>`;
}
/** a screen she cannot read from: not allowed (no figure at all), or not read yet on this computer (no read is made) */
function mdCannot(f: ErpMeeraFrom, L: (en: string, hi: string, hg: string) => string): { html: string; acts: { t: string; id: string; label: string }[] } | null {
  if (f.denied) return { html: L('Your account does not have this screen.', 'आपके अकाउंट में यह स्क्रीन नहीं है।', 'Aapke account mein yeh screen nahi hai.'), acts: [] };
  if (f.notLoaded) {
    const n = esc(f.name || f.tab);
    return { html: L(`I read only what this computer has already loaded, and <b>${n}</b> has not been opened yet. Open it once, then ask me again.`,
      `मैं सिर्फ़ वही पढ़ती हूँ जो इस कंप्यूटर पर पहले से खुला है, और <b>${n}</b> अभी नहीं खुली। उसे एक बार खोलें, फिर दोबारा पूछें।`,
      `Main sirf wahi padhti hoon jo is computer par pehle se khula hai, aur <b>${n}</b> abhi nahi khuli. Use ek baar kholiye, phir dobara poochiye.`),
      acts: [{ t: 'dataopen', id: f.tab + '|', label: L(`Open ${f.name || f.tab}`, `${f.name || f.tab} खोलें`, `${f.name || f.tab} kholiye`) }] };
  }
  return null;
}
const mdChips = (head: string, list: { label: string; q: string }[]): string =>
  `<div class="ga-rel"><span>${head}</span>${list.map(x => `<button type="button" class="ga-chip" data-gq="${esc(x.q)}">${esc(x.label)}</button>`).join('')}</div>`;

function mdAnswer(a: MdAsk, q: string, D: ErpMeeraData, lang: MdLang): { html: string; acts: { t: string; id: string; label: string }[] } {
  const L = (en: string, hi: string, hg: string): string => (lang === 'hi' ? hi : lang === 'hg' ? hg : en);
  const open = (id: string, en: string, hi: string, hg: string) => ({ t: 'dataopen', id, label: L(en, hi, hg) });
  if (a.kind === 'order-missing') return { html: L(`I cannot find order <b>${esc(a.text)}</b> on the Order Console. Check the number — for example AMZ-16092026-02.`,
    `ऑर्डर कंसोल पर ऑर्डर <b>${esc(a.text)}</b> नहीं मिला। नंबर जाँचें — जैसे AMZ-16092026-02।`, `Order Console par order <b>${esc(a.text)}</b> nahi mila. Number check kijiye — jaise AMZ-16092026-02.`), acts: [] };
  if (a.kind === 'karigar-which') return { html: L(`Which ${esc(a.said)} do you mean — ${a.names.map(esc).join(' or ')}?`, `कौन-सा ${esc(a.said)} — ${a.names.map(esc).join(' या ')}?`,
    `Kaunsa ${esc(a.said)} — ${a.names.map(esc).join(' ya ')}?`) + mdChips('', a.names.map(n => ({ label: n, q: q.replace(new RegExp(a.said.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), n) }))), acts: [] };
  if (a.kind === 'sku-which') return { html: L(`Which SKU — ${a.skus.map(esc).join(', ')}?`, `कौन-सा SKU — ${a.skus.map(esc).join(', ')}?`, `Kaunsa SKU — ${a.skus.map(esc).join(', ')}?`)
    + mdChips('', a.skus.map(s => ({ label: s, q: q.replace(new RegExp(a.said.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), s) }))), acts: [] };
  if (a.kind === 'order') {
    const r = D.findOrder(a.no), no = esc(a.no);
    const c = mdCannot(r.from, L); if (c) return c;
    if (!r.order) return { html: L(`I cannot find order <b>${no}</b> on the Order Console.`, `ऑर्डर कंसोल पर ऑर्डर <b>${no}</b> नहीं मिला।`, `Order Console par order <b>${no}</b> nahi mila.`), acts: [] };
    const o = r.order, lines = o.lines.slice(0, 8).map(x => `<li><b>${esc(x.sku)}</b> · ${mdNf(x.qty)} — ${esc(x.at)}</li>`).join('');
    const kar = o.karigars.length ? L('With karigars now: ', 'अभी कारीगरों के पास: ', 'Abhi karigaron ke paas: ') + o.karigars.slice(0, 5).map(([k, n]) => `<b>${esc(k)}</b> ${mdNf(n)}`).join(' · ') + '.' : '';
    const dt = o.last ? new Date(o.last.ms) : null, d = dt ? String(dt.getDate()).padStart(2, '0') + ' ' + 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[dt.getMonth()] : '';
    const last = o.last ? L(`Last work: ${esc(o.last.kind)}${o.last.by ? ' by ' + esc(o.last.by) : ''}, ${d} (${o.idle} day${o.idle === 1 ? '' : 's'} ago).`,
      `आख़िरी काम: ${esc(o.last.kind)}${o.last.by ? ', ' + esc(o.last.by) : ''}, ${d} (${o.idle} दिन पहले)।`, `Aakhri kaam: ${esc(o.last.kind)}${o.last.by ? ', ' + esc(o.last.by) : ''}, ${d} (${o.idle} din pehle).`) : '';
    const late = o.late ? `<br><b>${L('Late', 'लेट', 'Late')}</b>: ${L(`no work for ${o.idle} days (the Order Console counts 5 or more as late).`, `${o.idle} दिन से कोई काम नहीं (ऑर्डर कंसोल 5 या ज़्यादा को लेट गिनता है)।`, `${o.idle} din se koi kaam nahi (Order Console 5 ya zyada ko late ginta hai).`)}` : '';
    return { html: `<div class="ga-a"><b>${no}</b>: ${mdNf(o.pcs)} ${L('pcs on', 'पीस,', 'pcs,')} ${o.lines.length} ${L(o.lines.length === 1 ? 'line' : 'lines', 'लाइन', o.lines.length === 1 ? 'line' : 'lines')}${o.open ? '' : ' — ' + L('done, nothing open.', 'पूरा, कुछ बाकी नहीं।', 'poora, kuch baaki nahi.')}</div>`
      + `<ul>${lines}</ul>${kar ? `<div>${kar}</div>` : ''}${last ? `<div>${last}${late}</div>` : late}` + mdSource(r.from, L),
      acts: [open('order|' + a.no, 'Open this order', 'यह ऑर्डर खोलें', 'Ye order kholiye')] };
  }
  if (a.kind === 'karigar') {
    const r = D.karigarHolding(a.name), n = esc(a.name);
    const c = mdCannot(r.from, L); if (c) return c;
    const rows = (r.rows || []).slice(0, 6).map(x => `<li>${esc(x.orderNo || '—')} · <b>${esc(x.sku)}</b> — ${mdNf(x.pcs)} ${L('pcs, given', 'पीस, दिए', 'pcs, diye')} ${esc(x.given)}</li>`).join('');
    return { html: `<div class="ga-a">${r.pieces ? L(`<b>${n}</b> has <b>${mdNf(r.pieces || 0)}</b> pieces not back yet, on ${(r.rows || []).length} entr${(r.rows || []).length === 1 ? 'y' : 'ies'}.`,
      `<b>${n}</b> के पास <b>${mdNf(r.pieces || 0)}</b> पीस हैं जो अभी वापस नहीं आए, ${(r.rows || []).length} एंट्री में।`, `<b>${n}</b> ke paas <b>${mdNf(r.pieces || 0)}</b> piece hain jo abhi wapas nahi aaye, ${(r.rows || []).length} entry mein.`)
      : L(`<b>${n}</b> has no pieces out right now.`, `<b>${n}</b> के पास अभी कोई पीस नहीं है।`, `<b>${n}</b> ke paas abhi koi piece nahi hai.`)}</div>` + (rows ? `<ul>${rows}</ul>` : '') + mdSource(r.from, L),
      acts: [open('karigar|' + a.name, `Open Job Work Register for ${a.name}`, `${a.name} का Job Work Register खोलें`, `${a.name} ka Job Work Register kholiye`)] };
  }
  if (a.kind === 'sku') {
    const r = D.skuStock(a.sku), s = esc(a.sku);
    const c = mdCannot(r.from, L); if (c) return c;
    const pend = r.pending ? L(` (${mdNf(r.pending)} more waiting to be confirmed)`, ` (${mdNf(r.pending)} और पुष्टि के इंतज़ार में)`, ` (${mdNf(r.pending)} aur confirm hone baaki)`) : '';
    return { html: `<div class="ga-a">${L(`<b>${s}</b>: <b>${mdNf(r.current || 0)}</b> in the India store${pend}.`, `<b>${s}</b>: इंडिया स्टोर में <b>${mdNf(r.current || 0)}</b>${pend}।`, `<b>${s}</b>: India store mein <b>${mdNf(r.current || 0)}</b>${pend}.`)}</div>` + mdSource(r.from, L),
      acts: [open('sku|' + a.sku, 'Open this SKU', 'यह SKU खोलें', 'Ye SKU kholiye')] };
  }
  if (a.kind === 'wait') {
    const r = D.waitingAt(a.stage);
    const c = mdCannot(r.from, L); if (c) return c;
    const name = L({ QC: 'QC', Cutting: 'cutting', Vendor: 'the printers (vendors)', Karigar: 'karigars' }[a.stage] || a.stage, { QC: 'QC', Cutting: 'कटिंग', Vendor: 'प्रिंटर (वेंडर)', Karigar: 'कारीगर' }[a.stage] || a.stage,
      { QC: 'QC', Cutting: 'cutting', Vendor: 'printer (vendor)', Karigar: 'karigar' }[a.stage] || a.stage);
    const list = (r.lines || []).slice(0, 6).map(x => `<li>${esc(x.orderNo)} · <b>${esc(x.sku)}</b> — ${mdNf(x.pcs)}</li>`).join('');
    return { html: `<div class="ga-a">${(r.lines || []).length ? L(`Waiting at ${name}: <b>${mdNf(r.pcs || 0)}</b> pcs on ${(r.lines || []).length} order line(s).`, `${name} पर: ${(r.lines || []).length} ऑर्डर लाइन में <b>${mdNf(r.pcs || 0)}</b> पीस।`,
      `${name} par: ${(r.lines || []).length} order line mein <b>${mdNf(r.pcs || 0)}</b> pcs.`) : L(`Nothing is waiting at ${name} right now.`, `अभी ${name} पर कुछ नहीं रुका।`, `Abhi ${name} par kuch nahi ruka.`)}</div>` + (list ? `<ul>${list}</ul>` : '') + mdSource(r.from, L),
      acts: [open('ord|', 'Open Order Console', 'ऑर्डर कंसोल खोलें', 'Order Console kholiye')] };
  }
  if (a.kind === 'today') {
    const r = D.today(), parts: string[] = [], srcs: string[] = [], acts: { t: string; id: string; label: string }[] = [];
    const want = (k: string) => !a.focus || a.focus === k;
    if (want('issued') || want('received')) {
      const c = mdCannot(r.base, L);
      if (c) parts.push(c.html);
      else {
        if (want('issued') && r.issued) parts.push(L(`Issued: <b>${mdNf(r.issued.pcs)}</b> pcs (${r.issued.entries} entries)`, `इश्यू: <b>${mdNf(r.issued.pcs)}</b> पीस (${r.issued.entries} एंट्री)`, `Issue: <b>${mdNf(r.issued.pcs)}</b> pcs (${r.issued.entries} entry)`));
        if (want('received') && r.received) parts.push(L(`Received: <b>${mdNf(r.received.pcs)}</b> pcs`, `रिसीव: <b>${mdNf(r.received.pcs)}</b> पीस`, `Receive: <b>${mdNf(r.received.pcs)}</b> pcs`));
        srcs.push(mdSource(r.base, L));
      }
      acts.push(open('pbase|', 'Open Job Work Register', 'Job Work Register खोलें', 'Job Work Register kholiye'));
    }
    if (want('passed')) {
      const c = mdCannot(r.qc, L);
      if (c) parts.push(c.html);
      else { if (r.passed) parts.push(L(`QC passed: <b>${mdNf(r.passed.pcs)}</b> pcs (${r.passed.checks} checks)`, `QC पास: <b>${mdNf(r.passed.pcs)}</b> पीस (${r.passed.checks} चेक)`, `QC pass: <b>${mdNf(r.passed.pcs)}</b> pcs (${r.passed.checks} check)`)); srcs.push(mdSource(r.qc, L)); }
      acts.push(open('qc|', 'Open Quality Control', 'Quality Control खोलें', 'Quality Control kholiye'));
    }
    return { html: `<div class="ga-a">${L('Today so far', 'आज अब तक', 'Aaj ab tak')}:</div><ul>${parts.map(p => `<li>${p}</li>`).join('')}</ul>` + srcs.join(''), acts };
  }
  /* late */
  const r = D.late();
  const c = mdCannot(r.from, L); if (c) return c;
  const list = (r.orders || []).slice(0, 8).map(x => `<li><b>${esc(x.orderNo)}</b> — ${x.idle} ${L('days', 'दिन', 'din')} · ${esc(x.at)}</li>`).join('');
  return { html: `<div class="ga-a">${(r.orders || []).length ? L(`<b>${(r.orders || []).length}</b> order(s) are late — no work for ${r.days} days or more:`, `<b>${(r.orders || []).length}</b> ऑर्डर लेट हैं — ${r.days} या ज़्यादा दिन से कोई काम नहीं:`,
    `<b>${(r.orders || []).length}</b> order late hain — ${r.days} ya zyada din se koi kaam nahi:`) : L('No order is late right now.', 'अभी कोई ऑर्डर लेट नहीं है।', 'Abhi koi order late nahi hai.')}</div>` + (list ? `<ul>${list}</ul>` : '') + mdSource(r.from, L),
    acts: [open('ord|', 'Open Order Console', 'ऑर्डर कंसोल खोलें', 'Order Console kholiye')] };
}

/** guide-ask.ts gaAsk, first thing: true when the question was about the ERP's figures and has been answered here */
async function meeraDataAsk(q: string): Promise<boolean> {
  if (!MEERA_DATA || !ERP_MEERA.data) return false;
  try {
    const D = ERP_MEERA.data, a = mdParse(q, D);
    if (!a) return false;
    const r = mdAnswer(a, q, D, gaRead(q).lang as MdLang);
    gaSay(r.html, r.acts, '', 'data');
    return true;
  } catch (e) { return false; }   // anything unexpected: her ordinary answer, as before
}
/** for her tests: what she would say, without the chat */
function meeraDataTry(q: string): { kind: string; html: string; acts: string[] } | null {
  if (!ERP_MEERA.data) return null;
  const D = ERP_MEERA.data, a = mdParse(q, D);
  if (!a) return null;
  const r = mdAnswer(a, q, D, gaRead(q).lang as MdLang);
  return { kind: a.kind, html: r.html, acts: r.acts.map(x => x.id) };
}
/** a data answer's button: that screen, on the line — the person pressed it */
function meeraDataOpen(id: string): void {
  const i = id.indexOf('|');
  try { if (ERP_MEERA.data) ERP_MEERA.data.open(id.slice(0, i), id.slice(i + 1)); } catch (e) { /* the screen stays as it is */ }
}
