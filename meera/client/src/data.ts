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
 *   SKUs by their words      article, type, colour, brand, size, fabric ("tablecloth Appetite Green") → Master Database
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
type MdTerm = { said: string; hits: { f: string; v: string; w?: string; x?: boolean }[] };
type MdAsk = { kind: 'order'; no: string } | { kind: 'order-missing'; text: string } | { kind: 'order-which'; said: string; nos: string[] }
  | { kind: 'skucard'; sku: string; focus: 'all' | 'cloth' | 'brand' | 'amazon' | 'orders' | 'where'; fam?: boolean } | { kind: 'karigar'; name: string } | { kind: 'karigar-which'; said: string; names: string[] }
  | { kind: 'skufind'; terms: MdTerm[] } | { kind: 'sku'; sku: string } | { kind: 'sku-which'; said: string; skus: string[] } | { kind: 'today'; focus: string } | { kind: 'late' } | { kind: 'wait'; stage: string };

/* ---------- reading the question ---------- */
const MD_HOW = /\b(kaise|kese|kaisey|kaisay|how to|how do|how can|kaha likh\w*|kahan likh\w*|kaha chadha\w*|kaha daal\w*|kaha enter|entry kaise|kya kar(u|un|e|na)|how (are|is|does|did|come))\b|कैसे|कहाँ लिखूं|कहाँ चढ़ाऊं/;
/* never a figures question: what a word or a box means, pay and money, the past (last week, yesterday), attendance — her
 * answers or the AI, as before (measured 2 Nov: without this, 25 of her 580 recorded questions were taken) */
const MD_NOT = /\b(matlab|meaning|mean|means|stands for|what does|what is (this|that)|what's this|what happens|kya hota|kya karta|kya karti|button|column|press|dabane|payment|salary|hisab|hisaab|paisa|paise|rate|advance|attendance|hajri|haziri|tds|bill|last week|is hafte|pichhle|pichle|yesterday|kal|week|month|mahine|hafte)\b|मतलब|सैलरी|हाजिरी|पिछले|कल/;
/* "yeh … kya hai", "what is this …": asking what something IS — her answers explain it, never a figures list (Ravi,
 * 3 Nov: "yeh jo upar chalti hui line … late … kya hai" got the late-orders list) */
const MD_WHATIS = /\b(ye|yeh|yah|yaha|this|that|wo|woh|jo)\b[^?.!]*\b(kya hai|kya h|kya he|kya hota|what is|what are|what's)\b|यह[^?.!]*क्या है/;
/* a SKU: its orders, the cloth it takes, its brand, Amazon (Ravi, 3 Nov: "all the knowledge of all the skus") */
const MD_ORDERQ = /\b(order|orders|ordr|ordar|stage|open|production|chal raha|chal rahi|ban raha|ban rahi|kahan tak)\b|ऑर्डर|स्टेज/;
const MD_CLOTH = /\b(kapda|kapde|kapra|kapre|cloth|fabric|consumption|meter|metre|meters|metres|mtr|width|chaudai|chodai|panna|lagta|lagega|lagti)\b|कपड़ा|कपड़े|मीटर/;
const MD_BRAND = /\b(brand|cpc|ridhi|company|kiska|kis brand)\b|ब्रांड/;
const MD_AMAZON = /\b(asin|amazon|listing|listed|parent)\b|अमेज़न/;
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
/* SKUs FOUND BY THEIR MASTER WORDS (Ravi, 7 Nov: "what are the sku of table cloth that comes under apettite green") — any mix
 * of article, type, colour, brand, size and fabric, as the Master Database spells them, or a letter or two off. Two words
 * of one kind are either ("red ya blue cushion cover"); words of different kinds must all hold ("CPC ke 60x90 quilt"). */
const MD_FIND_FIELDS: [string, string, string, string][] = [['articleType', 'Article', 'आर्टिकल', 'Article'], ['subtype', 'Type', 'टाइप', 'Type'],
  ['color', 'Colour', 'रंग', 'Colour'], ['brand', 'Brand', 'ब्रांड', 'Brand'], ['size', 'Size', 'साइज़', 'Size'], ['fabric', 'Fabric', 'कपड़ा', 'Fabric']];
const MD_SKUWORD = /\bskus?\b|एसकेयू/;
const MD_FIND_ASK = /\b(kaun|kaunse|kaunsi|kaunsa|konse|konsi|konsa|kon se|which|what are|list|sab|saare|sare|saari|sari|all|batao|bataiye|dikhao|show|give|find|dhundo)\b|कौन|बताओ|दिखाओ/;
/* words that are never a master value on their own (a value made of several words may still hold them) */
const MD_FIND_STOP = new Set(('the a an of in on at to for from and or with under comes come coming that this these those what which who are is was all any '
  + 'sku skus list show me my give tell please pls code codes do does have has we our us you can i '
  + 'ki ka ke ko mein me mai main hai hain he h kaun kaunse kaunsi konse konsi kon se batao bataiye dikhao sab saare sare wala wali wale kya ya '
  + 'aur jo andar aate aati aata apne apni apna hamare humare hamari kitne kitni kitna how many much number '
  + 'colour color colours colors size sizes brand fabric type article item items product products').split(' '));
const mdFindKey = (s: string): string => String(s || '').toLowerCase().replace(/(\d)\s*[*×]\s*(\d)/g, '$1x$2').replace(/[^a-z0-9]/g, '');
const mdFieldName = (f: string, L: (en: string, hi: string, hg: string) => string): string => { const x = MD_FIND_FIELDS.find(y => y[0] === f); return x ? L(x[1], x[2], x[3]) : f; };
/** the master words a question names: the longest run of words first, then one letter off (two in a long name) */
function mdFindTerms(q: string, rows: Record<string, string>[]): MdTerm[] {
  const vals = new Map<string, { f: string; v: string }[]>();
  for (const r of rows) for (const [f] of MD_FIND_FIELDS) {
    const v = r[f], k = mdFindKey(v);
    if (k.length < 2) continue;
    const l = vals.get(k) || [];
    if (!l.some(x => x.f === f)) { l.push({ f, v }); vals.set(k, l); }
  }
  const letters = [...vals.keys()].filter(k => k.length >= 6 && /^[a-z]+$/.test(k));
  const ws = String(q || '').toLowerCase().replace(/(\d)\s*[*×]\s*(\d)/g, '$1x$2').split(/[\s,?!।.;:()"'/]+/).filter(Boolean);
  const used = ws.map(() => false), out: MdTerm[] = [];
  for (let n = Math.min(4, ws.length); n >= 1; n--) for (let i = 0; i + n <= ws.length; i++) {
    if (used.slice(i, i + n).some(Boolean) || MD_FIND_STOP.has(ws[i]) || MD_FIND_STOP.has(ws[i + n - 1])) continue;
    const said = ws.slice(i, i + n).join(' '), k = mdFindKey(said);
    if (k.length < 2) continue;
    let hits = vals.get(k) || (k.length > 3 ? vals.get(k.replace(/s$/, '')) || vals.get(k.replace(/es$/, '')) : undefined);
    const exact = !!hits;
    /* a letter off only in a word of six letters or more: "lines" is not "Linen" */
    if (!hits && k.length >= 6 && /^[a-z]+$/.test(k)) {
      const max = k.length >= 10 ? 2 : 1;
      let best = max + 1, at: string[] = [];
      for (const v of letters) { const d = muDistance(k, v, max); if (d < best) { best = d; at = [v]; } else if (d === best) at.push(v); }
      if (best <= max && at.length === 1) hits = vals.get(at[0]);
    }
    if (!hits) continue;
    for (let j = i; j < i + n; j++) used[j] = true;
    out.push({ said, hits: hits.map(h => ({ f: h.f, v: h.v, w: said, x: exact })) });
  }
  /* words of the same kind are either: "ocean blue ya appetite green" is one colour OR the other */
  const kinds = new Map<string, MdTerm>();
  for (const x of out) { const k = [...new Set(x.hits.map(h => h.f))].sort().join("|"), o = kinds.get(k); if (o) { o.said += " / " + x.said; o.hits.push(...x.hits); } else kinds.set(k, { said: x.said, hits: x.hits.slice() }); }
  return [...kinds.values()];
}
function mdParse(q0: string, D: ErpMeeraData): MdAsk | null {
  /* "AMZ -30082026", "amz 30082026" → AMZ-30082026 (an order number typed with a space) */
  const q = String(q0 || '').replace(/\b(amz|spy|shp|b2b|onl|adj|leg)\s*-\s*(?=\d)|\b(amz|spy|shp|b2b|onl|adj|leg)\s+(?=\d)/gi, (m: string, a: string, b: string) => (a || b) + '-');
  const low = ' ' + q.toLowerCase().replace(/\s+/g, ' ') + ' ', ws = mdWords(q);
  if (MD_HOW.test(low) || MD_NOT.test(low)) return null;
  /* an order number ("AMZ-16092026-02", "amz1609202602", "RBP7620" for SHP-RBP7620) */
  const orderish = ws.filter(w => (MD_ORDERLIKE.test(w) && /\d{3,}/.test(w)) || (/^[a-z]{2,4}\d{3,}$/i.test(w) && MD_WHERE.test(low)));
  if (orderish.length) {
    const all = D.orders(), byBare = new Map(all.map(o => [mdBare(o), o]));
    for (const w of orderish) {
      const b = mdBare(w), hit = byBare.get(b) || all.find(o => mdBare(o).endsWith(b) && o.toUpperCase().endsWith(w.toUpperCase()));
      if (hit) return { kind: 'order', no: hit };
      /* only the start of a number ("AMZ-30082026"): the one order it names, or she asks which */
      const pre = all.filter(o => o.toUpperCase().startsWith(w.toUpperCase() + '-'));
      if (pre.length === 1) return { kind: 'order', no: pre[0] };
      if (pre.length > 1) return { kind: 'order-which', said: w.toUpperCase(), nos: pre.slice(0, 8) };
    }
    const w0 = orderish.find(w => MD_ORDERLIKE.test(w));
    /* the Order Console cannot be read here (not allowed, or not opened yet): findOrder says which */
    if (w0) return all.length ? { kind: 'order-missing', text: w0.toUpperCase() } : { kind: 'order', no: w0.toUpperCase() };
  }
  /* a SKU named in full ("RTC327-6060"): its stock when that is what is asked, else its card — master details, cloth,
   * brand, Amazon, its open orders and their stage */
  const skuSet = new Set(D.skus());
  const skuW = ws.map(w => w.toUpperCase()).find(u => /\d/.test(u) && u.length >= 4 && skuSet.has(u));
  const skuAsk = (sku: string, fam?: boolean): MdAsk => {
    if (!fam && (MD_STOCK.test(low) || MD_COUNT.test(low)) && !MD_ORDERQ.test(low) && !MD_CLOTH.test(low) && !MD_WHERE.test(low)) return { kind: 'sku', sku };
    const focus = MD_ORDERQ.test(low) ? 'orders' : MD_WHERE.test(low) ? 'where' : MD_CLOTH.test(low) ? 'cloth' : MD_AMAZON.test(low) ? 'amazon' : MD_BRAND.test(low) ? 'brand' : 'all';
    return { kind: 'skucard', sku, focus, fam };
  };
  if (skuW) return skuAsk(skuW);
  /* past here only her figures lists — never for "yeh … kya hai" */
  if (MD_WHATIS.test(low)) return null;
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
  /* …or a SKU typed on its own ("CPC-002"): written with the dash anywhere, it is that SKU or its sizes */
  const alone = ws.length === 1 && /[a-z]/i.test(ws[0]) && /\d{2,}/.test(ws[0]);
  if (alone || MD_STOCK.test(low) || MD_COUNT.test(low) || MD_ORDERQ.test(low) || MD_CLOTH.test(low) || MD_WHERE.test(low) || /\b(details?|batao|bataiye|info|about|sab kuch|poori|puri)\b|बताओ|बताइए/.test(low)) {
    const set = new Set(D.skus());
    for (const w of ws) {
      const u = w.toUpperCase();
      if (!/\d/.test(u) || u.length < 4) continue;
      if (set.has(u)) return skuAsk(u);
      const pre = [...set].filter(s => s.startsWith(u + '-') || mdBare(s) === mdBare(u) || mdBare(s.split('-')[0]) === mdBare(u));
      if (pre.length === 1) return skuAsk(pre[0]);
      if (pre.length > 1) {
        const stockOnly = (MD_STOCK.test(low) || MD_COUNT.test(low)) && !MD_ORDERQ.test(low) && !MD_WHERE.test(low) && !MD_CLOTH.test(low);
        if (stockOnly && pre.length <= 8) return { kind: 'sku-which', said: u, skus: pre };
        return skuAsk(u, true);
      }
    }
  }
  /* SKUs by their master words: "which SKUs" with one word of the master, or two of its words with an article or type
   * among them ("red", "white", "cotton" alone are everyday words: "stock is showing -12 in red for one sku" is no search) */
  if (D.skuList && (MD_SKUWORD.test(low) || ws.length >= 2)) {
    const L0 = D.skuList();
    if (L0.from.denied || L0.from.notLoaded) { if (MD_SKUWORD.test(low) && MD_FIND_ASK.test(low)) return { kind: 'skufind', terms: [] }; }
    else {
      const terms = mdFindTerms(q, L0.rows as unknown as Record<string, string>[]);
      /* without "which SKUs": an article or type among them, and at least one word spelt as the master spells it */
      const product = terms.length >= 2 && terms.some(x => x.hits.some(h => h.f === 'articleType' || h.f === 'subtype')) && terms.some(x => x.hits.some(h => h.x));
      if (product || (terms.length && MD_SKUWORD.test(low) && MD_FIND_ASK.test(low))) return { kind: 'skufind', terms };
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

/* ONE SKU'S CARD (Ravi, 3 Nov): what the Master Database says about it — never its cost value or its maker — the
 * cloth it takes, Amazon, its stock and its open orders with their stage. Each part needs its own screen: an account
 * without it is told so for that part only. */
const MD_FIELDS: [string, string][] = [['brand', 'Brand'], ['articleType', 'Article'], ['subtype', 'Type'], ['color', 'Colour'], ['size', 'Size'], ['packOf', 'Pack of'],
  ['packType', 'Pack type'], ['packMaterial', 'Pack material'], ['isCustom', 'Custom'], ['mergedInto', 'Merged into']];
const mdYes = (v: unknown): boolean => v === true || /^(true|yes|y|1)$/i.test(String(v));
function mdSkuCard(sku: string, focus: string, D: ErpMeeraData, L: (en: string, hi: string, hg: string) => string, fam?: boolean): { html: string; acts: { t: string; id: string; label: string }[] } {
  const s = esc(sku), parts: string[] = [], acts: { t: string; id: string; label: string }[] = [];
  const no = L('Your account does not have this screen.', 'आपके अकाउंट में यह स्क्रीन नहीं है।', 'Aapke account mein yeh screen nahi hai.');
  const part = (head: string, body: string) => parts.push(`<div class="ga-a"><b>${head}</b></div>${body}`);
  const cant = (f: ErpMeeraFrom) => { const c = mdCannot(f, L); return c ? (f.denied ? no : c.html) : ''; };
  const row = (label: string, v: string) => `<li>${label}: ${v}</li>`;
  /* the design and its sizes (Ravi, 5 Nov: "CPC-002 … name of product, sizes available, brand, in production, number of
   * orders, order id, platforms") — a family typed on its own ("CPC-002") is all its sizes together */
  const fy = D.skuFamily(sku), sizes = fy.skus || [];
  const members = fam ? sizes.map(x => x.sku) : [sku.toUpperCase()];
  const m = D.skuInfo(members[0] || sku), mc = mdCannot(m.from, L), r = !mc && !m.none && m.row ? m.row : null;
  const sum: string[] = [];
  if (mc) sum.push(row(L('Product', 'प्रोडक्ट', 'Product'), cant(m.from)));
  else if (!r) sum.push(`<li>${L(`<b>${s}</b> is not in the Master Database.`, `<b>${s}</b> मास्टर डेटाबेस में नहीं है।`, `<b>${s}</b> Master Database mein nahi hai.`)}</li>`);
  else {
    const name = [r.articleType, r.subtype, fam ? '' : r.color].filter(x => x !== undefined && x !== '').map(x => esc(String(x))).join(' ');
    if (name) sum.push(row(L('Product', 'प्रोडक्ट', 'Product'), `<b>${name}</b>`));
    if (r.brand !== undefined) sum.push(row(L('Brand', 'ब्रांड', 'Brand'), `<b>${esc(String(r.brand))}</b>`));
  }
  if (sizes.length) {
    const one = (x: { sku: string; size: string; color: string }) => `<b>${esc(x.size || x.sku)}</b>${x.size ? ` (${esc(x.sku)}${fam && x.color ? ' · ' + esc(x.color) : ''})` : ''}`;
    sum.push(row(L('Sizes available', 'उपलब्ध साइज़', 'Sizes available'), sizes.map(one).join(', ')));
  }
  /* its open orders: how many, which, and the stage each is at */
  let ordHtml = '', pcsMade = 0, ordOk = false;
  const lines: { sku: string; orderNo: string; qty: number; at: string }[] = [];
  let of: ErpMeeraFrom | null = null;
  members.forEach(k => { const o = D.skuOrders(k); of = o.from; if (!mdCannot(o.from, L)) { ordOk = true; (o.lines || []).forEach(x => lines.push({ sku: k, ...x })); } });
  if (!members.length) { const o = D.skuOrders(sku); of = o.from; if (!mdCannot(o.from, L)) { ordOk = true; (o.lines || []).forEach(x => lines.push({ sku, ...x })); } }
  if (!ordOk && of) {
    sum.push(row(L('In production', 'प्रोडक्शन में', 'Production mein'), cant(of)));
  } else if (of) {
    pcsMade = lines.reduce((t, x) => t + (x.qty || 0), 0);
    const nos = [...new Set(lines.map(x => x.orderNo))];
    const stage = new Map<string, number>();
    lines.forEach(x => { const k = String(x.at || '—').split(' — ')[0].trim() || '—'; stage.set(k, (stage.get(k) || 0) + (x.qty || 0)); });
    sum.push(row(L('In production', 'प्रोडक्शन में', 'Production mein'), lines.length
      ? `<b>${mdNf(pcsMade)}</b> pcs — ${[...stage.entries()].map(([k, n]) => `${esc(k)} <b>${mdNf(n)}</b>`).join(' · ')}`
      : L('nothing open right now', 'अभी कुछ खुला नहीं', 'abhi kuch open nahi')));
    sum.push(row(L('Number of orders', 'ऑर्डर की गिनती', 'Orders kitne'), `<b>${nos.length}</b>`));
    if (nos.length) sum.push(row(L('Order IDs', 'ऑर्डर नंबर', 'Order IDs'), nos.slice(0, 10).map(n => `<b>${esc(n)}</b>`).join(', ') + (nos.length > 10 ? L(` and ${nos.length - 10} more`, ` और ${nos.length - 10}`, ` aur ${nos.length - 10}`) : '')));
    if (lines.length) ordHtml = `<ul>${lines.slice(0, 10).map(x => `<li><b>${esc(x.orderNo)}</b>${fam ? ' · ' + esc(x.sku) : ''} · ${mdNf(x.qty)} — ${esc(x.at || '—')}</li>`).join('')}</ul>` + mdSource(of, L);
    acts.push({ t: 'dataopen', id: 'ord|', label: L('Open Order Console', 'ऑर्डर कंसोल खोलें', 'Order Console kholiye') });
  }
  /* where it sells */
  const plat = new Map<string, Set<string>>();
  let asin = '';
  (members.length ? members : [sku]).forEach(k => { const p = D.skuPlatforms(k); if (p.asin && !asin) asin = p.asin; (p.list || []).forEach(x => { const m = plat.get(x.name) || new Set<string>(); (x.nos || []).forEach(n => m.add(n)); plat.set(x.name, m); }); });
  if (plat.size) sum.push(row(L('Platforms', 'प्लेटफ़ॉर्म', 'Platforms'), [...plat.entries()].map(([n, set]) => { const c = set.size; return `<b>${esc(n)}</b>${n === 'Amazon' && asin && !fam ? ` (${esc(asin)})` : ''}${c ? L(` — ${c} order(s)`, ` — ${c} ऑर्डर`, ` — ${c} order`) : ''}`; }).join(', ')));
  /* where it is: the India store, Amazon FBA, in production */
  const where: string[] = [];
  let ind = 0, indOk = false, indFrom: ErpMeeraFrom | null = null, fba = 0, fbaKnown = false, fbaFrom: ErpMeeraFrom | null = null;
  (members.length ? members : [sku]).forEach(k => {
    const st = D.skuStock(k); indFrom = st.from; if (!mdCannot(st.from, L)) { indOk = true; ind += st.current || 0; }
    const f = D.skuFba(k); fbaFrom = f.from; if (!mdCannot(f.from, L) && f.fba != null) { fbaKnown = true; fba += f.fba; }
  });
  if (indOk) where.push(L(`India store <b>${mdNf(ind)}</b>`, `इंडिया स्टोर <b>${mdNf(ind)}</b>`, `India store <b>${mdNf(ind)}</b>`));
  else if (indFrom) where.push(L('India store: ', 'इंडिया स्टोर: ', 'India store: ') + cant(indFrom));
  if (fbaKnown) where.push(L(`Amazon FBA <b>${mdNf(fba)}</b>`, `Amazon FBA <b>${mdNf(fba)}</b>`, `Amazon FBA <b>${mdNf(fba)}</b>`));
  else if (fbaFrom && (fbaFrom as ErpMeeraFrom).denied) where.push('Amazon FBA: ' + no);
  else if (fbaFrom && (fbaFrom as ErpMeeraFrom).notLoaded) where.push(L('Amazon FBA: open Shopify Orders and press Fetch orders to read it', 'Amazon FBA: Shopify Orders खोलकर Fetch orders दबाएँ', 'Amazon FBA: Shopify Orders kholke Fetch orders dabaiye'));
  if (ordOk && pcsMade) where.push(L(`in production <b>${mdNf(pcsMade)}</b>`, `प्रोडक्शन में <b>${mdNf(pcsMade)}</b>`, `production mein <b>${mdNf(pcsMade)}</b>`));
  if (where.length) sum.push(row(L('Where it is', 'कहाँ है', 'Kahan hai'), where.join(' · ')));
  const summary = `<ul>${sum.join('')}</ul>`;
  /* the rest of its master details — one SKU only */
  if (r && !fam) {
    const li = (k: string, label: string) => (r[k] !== undefined ? `<li>${label}: <b>${esc(String(r[k]))}</b></li>` : '');
    const cloth: string[] = [];
    if (r.fabric !== undefined) cloth.push(`<li>${L('Fabric', 'कपड़ा', 'Kapda')}: <b>${esc(String(r.fabric))}</b>${m.fabricWidthIn ? ` · ${L('width', 'चौड़ाई', 'width')} <b>${mdNf(m.fabricWidthIn)}"</b>` : ''}</li>`);
    if (r.cuttingRequired !== undefined && !mdYes(r.cuttingRequired)) cloth.push(`<li>${L('No cutting needed', 'कटिंग नहीं चाहिए', 'Cutting nahi chahiye')}</li>`);
    if (r.consumption !== undefined) cloth.push(`<li>${L('Cloth per piece', 'एक पीस में कपड़ा', 'Ek piece mein kapda')}: <b>${esc(String(r.consumption))} m</b></li>`);
    if (mdYes(r.isZip)) cloth.push(`<li>${L('Zip', 'ज़िप', 'Zip')}: ${[r.chainLength !== undefined ? esc(String(r.chainLength)) + L(' chain', ' चेन', ' chain') : '', r.zipQty !== undefined ? '× ' + esc(String(r.zipQty)) : ''].filter(Boolean).join(' ') || L('yes', 'हाँ', 'haan')}</li>`);
    if (mdYes(r.isRuffle)) cloth.push(`<li>${L('Ruffle', 'रफ़ल', 'Ruffle')}: ${r.ruffleMeters !== undefined ? esc(String(r.ruffleMeters)) + ' m' : ''}${r.ruffleFabric !== undefined ? ' ' + esc(String(r.ruffleFabric)) : ''}</li>`);
    if (mdYes(r.isPiping)) cloth.push(`<li>${L('Piping', 'पाइपिंग', 'Piping')}: ${r.pipingMeters !== undefined ? esc(String(r.pipingMeters)) + ' m' : ''}${r.pipingFabric !== undefined ? ' ' + esc(String(r.pipingFabric)) : ''}</li>`);
    if (mdYes(r.fillerFabricRequired) || r.standardFillingQty !== undefined) cloth.push(`<li>${L('Filling', 'फिलिंग', 'Filling')}: ${r.standardFillingQty !== undefined ? '<b>' + esc(String(r.standardFillingQty)) + '</b>' : L('yes', 'हाँ', 'haan')}</li>`);
    const amz = [li('asin', 'ASIN'), li('parentAsin', L('Parent ASIN', 'पैरेंट ASIN', 'Parent ASIN')), li('listingStatus', L('Listing', 'लिस्टिंग', 'Listing'))].join('');
    const det = MD_FIELDS.map(([k, label]) => li(k, label)).join('');
    const order = focus === 'cloth' ? ['c', 'd', 'a'] : focus === 'amazon' ? ['a', 'd', 'c'] : ['d', 'c', 'a'];
    for (const x of order) {
      if (x === 'd' && det) part(L('Master details', 'मास्टर डिटेल', 'Master details'), `<ul>${det}</ul>`);
      if (x === 'c' && cloth.length) part(L('Cloth', 'कपड़ा', 'Kapda'), `<ul>${cloth.join('')}</ul>`);
      if (x === 'a' && amz) part('Amazon', `<ul>${amz}</ul>`);
    }
    parts.push(mdSource(m.from, L));
    acts.unshift({ t: 'dataopen', id: 'sku|' + sku, label: L('Open this SKU', 'यह SKU खोलें', 'Ye SKU kholiye') });
  }
  const ordPart = ordHtml ? `<div class="ga-a"><b>${L('Open orders', 'खुले ऑर्डर', 'Open orders')}</b></div>${ordHtml}` : '';
  const body = focus === 'orders' || focus === 'where' ? [ordPart, ...parts] : [...parts, ordPart];
  const title = fam ? L(`<b>${s}</b> — all ${sizes.length} sizes`, `<b>${s}</b> — सभी ${sizes.length} साइज़`, `<b>${s}</b> — saare ${sizes.length} size`) : `<b>${s}</b>`;
  /* a family: each size opens its own card */
  const chips = fam && sizes.length ? mdChips(L('Open one size', 'एक साइज़ खोलें', 'Ek size kholiye'), sizes.slice(0, 12).map(x => ({ label: x.sku, q: x.sku }))) : '';
  return { html: `<div class="ga-a">${title}</div>` + summary + body.join('') + chips, acts: acts.slice(0, 3) };
}

function mdAnswer(a: MdAsk, q: string, D: ErpMeeraData, lang: MdLang): { html: string; acts: { t: string; id: string; label: string }[] } {
  const L = (en: string, hi: string, hg: string): string => (lang === 'hi' ? hi : lang === 'hg' ? hg : en);
  const open = (id: string, en: string, hi: string, hg: string) => ({ t: 'dataopen', id, label: L(en, hi, hg) });
  if (a.kind === 'order-missing') return { html: L(`I cannot find order <b>${esc(a.text)}</b> on the Order Console. Check the number — for example AMZ-16092026-02.`,
    `ऑर्डर कंसोल पर ऑर्डर <b>${esc(a.text)}</b> नहीं मिला। नंबर जाँचें — जैसे AMZ-16092026-02।`, `Order Console par order <b>${esc(a.text)}</b> nahi mila. Number check kijiye — jaise AMZ-16092026-02.`), acts: [] };
  if (a.kind === 'karigar-which') return { html: L(`Which ${esc(a.said)} do you mean — ${a.names.map(esc).join(' or ')}?`, `कौन-सा ${esc(a.said)} — ${a.names.map(esc).join(' या ')}?`,
    `Kaunsa ${esc(a.said)} — ${a.names.map(esc).join(' ya ')}?`) + mdChips('', a.names.map(n => ({ label: n, q: q.replace(new RegExp(a.said.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), n) }))), acts: [] };
  if (a.kind === 'sku-which') return { html: L(`Which SKU — ${a.skus.map(esc).join(', ')}?`, `कौन-सा SKU — ${a.skus.map(esc).join(', ')}?`, `Kaunsa SKU — ${a.skus.map(esc).join(', ')}?`)
    + mdChips('', a.skus.map(s => ({ label: s, q: q.replace(new RegExp(a.said.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), s) }))), acts: [] };
  if (a.kind === 'order-which') return { html: L(`Which order — ${a.nos.map(esc).join(', ')}?`, `कौन-सा ऑर्डर — ${a.nos.map(esc).join(', ')}?`, `Kaunsa order — ${a.nos.map(esc).join(', ')}?`)
    + mdChips('', a.nos.map(n => ({ label: n, q: n }))), acts: [] };
  if (a.kind === 'skucard') return mdSkuCard(a.sku, a.focus, D, L, a.fam);
  if (a.kind === 'skufind') {
    const r = D.skuList(), c = mdCannot(r.from, L); if (c) return c;
    const rows = r.rows as unknown as Record<string, string>[];
    const has = (row: Record<string, string>, t: MdTerm) => t.hits.some(h => mdFindKey(row[h.f]) === mdFindKey(h.v));
    const hit = rows.filter(row => a.terms.every(t => has(row, t))).sort((x, y) => x.sku.localeCompare(y.sku));
    const desc = a.terms.map(t => [...new Set(t.hits.map(h => mdFieldName(h.f, L)))].join(' / ') + ' <b>' + [...new Set(t.hits.map(h => esc(h.v)))].join(' / ') + '</b>').join(' · ');
    /* a word she read as another spelling: she says how she read it */
    const same = (w: string, v: string) => { const k = mdFindKey(w); return [k, k.replace(/s$/, ''), k.replace(/es$/, '')].includes(mdFindKey(v)); };
    const read = [...new Map(a.terms.flatMap(t => t.hits).filter(h => h.w && !same(h.w, h.v)).map(h => [h.w + '|' + h.v, h])).values()];
    const asRead = read.length ? '<div class="ga-und">' + read.map(h => L(`I read “${esc(h.w || '')}” as <b>${esc(h.v)}</b>.`, `“${esc(h.w || '')}” को मैंने <b>${esc(h.v)}</b> पढ़ा।`,
      `“${esc(h.w || '')}” ko maine <b>${esc(h.v)}</b> padha.`)).join(' ') + '</div>' : '';
    const SHOW = 40, n = hit.length;
    let html: string;
    if (n) {
      html = `<div class="ga-a">${L(`<b>${mdNf(n)}</b> SKU${n === 1 ? '' : 's'} — ${desc}:`, `<b>${mdNf(n)}</b> SKU — ${desc}:`, `<b>${mdNf(n)}</b> SKU — ${desc}:`)}</div>`
        + mdChips('', hit.slice(0, SHOW).map(x => ({ label: x.sku + (x.size ? ' · ' + x.size : ''), q: x.sku })))
        + (n > SHOW ? `<div>${L(`Showing the first ${SHOW}. Add a size, brand or type to narrow it.`, `पहले ${SHOW} दिखाए हैं। कम करने के लिए साइज़, ब्रांड या टाइप भी लिखें।`,
          `Pehle ${SHOW} dikhaye hain. Kam karne ke liye size, brand ya type bhi likhiye.`)}</div>` : '')
        + `<div class="ga-und">${L('Press a SKU for its card.', 'किसी SKU का कार्ड देखने के लिए उसे दबाएँ।', 'Kisi SKU ka card dekhne ke liye use dabaiye.')}</div>`;
    } else {
      const each = a.terms.length > 1 ? a.terms.map(t => [...new Set(t.hits.map(h => esc(h.v)))].join(' / ') + ': ' + mdNf(rows.filter(row => has(row, t)).length)).join(' · ') : '';
      html = `<div class="ga-a">${L(`No SKU in the Master Database is ${desc}.`, `मास्टर डेटाबेस में कोई SKU ${desc} नहीं है।`, `Master Database mein koi SKU ${desc} nahi hai.`)}</div>`
        + (each ? `<div>${L('SKUs with each on its own: ', 'हर एक के अलग से SKU: ', 'Har ek ke alag se SKU: ')}${each}</div>` : '');
    }
    return { html: html + asRead + mdSource(r.from, L), acts: [open('pmdb|', 'Open Master Database', 'मास्टर डेटाबेस खोलें', 'Master Database kholiye')] };
  }
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
