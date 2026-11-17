/* MEERA KNOWS WHAT KIND OF QUESTION IT IS — question categories (17 Nov 2026, Ravi: "categorize questions for the ERP,
 * what they ask, and how Meera should answer each category").
 *
 * Joined by the page and meera.js alike (Replenish-App/src/app/ORDER, after config.ts) since 17 Nov; READ ONLY BY THE JUDGE (guide-ai.ts gaAiJudge, switch "judge", off for everyone):
 * it tells the judge the kind of question, and keeps live figures, outside questions and chat away from any AI. Her own
 * search does not use it yet. Design and reasons: meera/docs/decisions/question-categories.md.
 *
 * One self-contained step, with no page access (like understand.ts), so it can run in the browser or on her router
 * unchanged: a question in, two labels out.
 *
 *   miClassify("Ramesh se 40 piece wapas aaye, kaha chadhau")
 *     → { intent: 'where', area: 'production', scores: {…}, cues: ['kaha', 'piece'] }
 *
 *   INTENT — what kind of answer the person needs (12 kinds, below)
 *   AREA   — which part of the ERP it is about (the same groups as her answer ids: gn / or / pr / in / pl / vm)
 *
 * How it decides: every kind has a few cue patterns (English, Hinglish, Hindi script), each with a weight. The kind with
 * the most weight wins; a tie goes to the kind earlier in MI_ORDER (a red line beats "how", a live figure beats "where").
 * No cue at all: 'how' — most questions to an ERP helper are "how do I". */

type MeeraIntent = 'error' | 'access' | 'data' | 'whatif' | 'fix' | 'flow' | 'status' | 'where' | 'what' | 'how' | 'outside' | 'chat';
type MeeraArea = 'general' | 'orders' | 'production' | 'inventory' | 'planning' | 'vendors' | '';

interface MeeraIntentResult {
  intent: MeeraIntent;
  area: MeeraArea;
  /** each kind's weight, for her tests and the admin page */
  scores: Partial<Record<MeeraIntent, number>>;
  /** the words that decided, for her tests and the admin page */
  cues: string[];
}

/** a tie goes to the kind earlier here */
const MI_ORDER: MeeraIntent[] = ['chat', 'outside', 'error', 'access', 'data', 'whatif', 'fix', 'flow', 'status', 'where', 'what', 'how'];

/* The cues. Latin-letter patterns use \b; Hindi-script ones cannot (JavaScript's \b knows only a–z), so they are plain. */
const MI_CUES: Array<[MeeraIntent, number, RegExp]> = [
  /* chat — greetings, thanks, about Meera herself */
  ['chat', 4, /^\s*(hi+|hello|hey|namaste|namaskar|good (morning|evening|afternoon)|thanks?|thank you|shukriya|dhanyavad|ok+|okay)\s*[!.?]*\s*$/i],
  ['chat', 3, /\b(who are you|tum kaun|aap kaun|tell me a joke|joke sunao)\b|नमस्ते|धन्यवाद|शुक्रिया/i],
  /* outside — business questions the ERP does not do */
  ['outside', 3, /\b(gst|hsn|tally|income tax|itr|tds|flipkart|meesho|myntra|ajio|seller central|amazon (seller|price|listing price)|bank account|upi|loan)\b|जीएसटी|टैली/i],
  /* error — a red line, a block, a refusal */
  ['error', 3, /\b(error|err|not working|doesn'?t work|won'?t|wont|can'?t (save|issue|receive|submit|upload)|fails?|failed|blocked|stuck|rok raha|rok rha|rokta|allow nahi|nahi ho (raha|rha|rahi|rhi)|nhi ho (raha|rha|rahi|rhi)|ho hi nahi|save nahi|says .* (not|no|only|first|more))\b/i],
  ['error', 3, /एरर|नहीं हो रहा|नहीं हो रही|रोक रहा|सेव नहीं/],
  ['error', 1, /\b(bol (raha|rha)|likha aa (raha|rha)|aa (raha|rha) hai|message|red line|laal line)\b/i],
  /* access — sign-in, PIN, rights, a screen that is not there */
  ['access', 3, /\b(access|permission|rights?|login|log in|logout|log out|sign ?in|sign ?out|password|pin|otp|too many tries)\b|लॉगिन|लॉगआउट|पासवर्ड|पिन|अधिकार/i],
  ['access', 2, /\b(screen|page|menu) (nahi|nhi|not) (dikh|aa|show)|\b(dont|don'?t|do not|cannot|can'?t) see\b|(approve|edit|delete) nahi kar pa|kar nahi pa (raha|rha)|khud approve/i],
  /* data — a live figure from the ERP: how many, where is this order, what does this karigar hold */
  ['data', 3, /\b(kitna|kitne|kitni|how many|how much|total kitna|count)\b|कितना|कितने|कितनी/i],
  ['data', 2, /\b(abhi|aaj|today'?s?|is waqt|right now)\b.*\b(stock|order|pending|late|maal|piece)\b|\b(ke paas|ke pass|has with him|is holding)\b|के पास/i],
  /* "where is this order" is a figure, not a screen: weight 4, so it beats where (3) */
  ['data', 4, /\b(order|po|so|sku)\b.*\b(kahan|kaha|kidhar|where|status|kis stage)\b.*\b(hai|h|is)\b/i],
  /* a SKU or order code as typed (capitals with a digit: RCN14B, AMZ-25102026-01) — case matters, so no /i */
  ['data', 2, /\b[A-Z]{2,}[A-Z0-9]*\d[A-Z0-9-]*\b/],
  /* whatif — what happens if: never worked out by an AI, only said from her checked answers */
  ['whatif', 3, /\b(agar|if i|if we|if you|what happens|what will happen|kya hoga|kya hota hai agar|badal jaye?ga|badlega|farak|fark|affect|impact)\b|अगर|क्या होगा|फर्क|फ़र्क|असर/i],
  ['whatif', 2, /\bdoes (the )?\w+ (move|change|go up|go down)\b/i],
  /* fix — undo a mistake, put something right */
  ['fix', 3, /\b(galti se|galat|by mistake|mistakenly|wrong entry|entered wrong|undo|revert|cancel karna|delete ho (gay|gai|gya|gyi)|wapas (lana|laana|laye|layen|kar(na|e|u)?|kaise)|wapas aa (sakti|sakta|jaye))\b|गलती|गलत|डिलीट हो|अनडू/i],
  ['fix', 2, /\b(correct|correction|sudhar|theek kar|change karna)\b|सुधार|करेक्शन/i],
  /* flow — a whole process across screens */
  ['flow', 3, /\b(shuru se|start to (end|finish)|from (the )?start|full process|pura process|poora process|end to end|kaun kaun si|which screens|kahan se kahan|flow kya)\b|शुरू से|पूरा प्रोसेस|कौन कौन/i],
  /* status — why the screen shows this (a colour, a word, a row gone) */
  ['status', 3, /\b(kyu|kyun|kyon|kyo|why)\b.*\b(dikh|likha|laal|red|green|hara|peela|yellow|show|shows|showing|aa (raha|rha)|gayab|missing|disappear|hidden)\b/i],
  ['status', 2, /\b(gayab|missing|disappeared|not (in|on) the list|list me nahi)\b|गायब|क्यों दिख/i],
  /* where — find a screen, button or box */
  ['where', 3, /\b(kahan|kaha|kahaan|kha|khan|kidhar|where|kis screen|which screen|kaunsi screen|konsi screen|kis page)\b|कहाँ|कहां|किधर|किस स्क्रीन/i],
  /* what — the meaning of a part or a word */
  ['what', 3, /\b(kya hai|kya h|kya hota|kya hoti|ka matlab|kya matlab|matlab kya|what is|what are|what does .* mean|meaning|kya karta|kya karti|kis kaam|kisliye|what'?s)\b|क्या है|मतलब|क्या करता|किस काम/i],
  /* how — do a job */
  ['how', 2, /\b(kaise|kese|kaisay|kaise kare|kaise karu|kaise kru|how (do|to|can|should)|steps?|tarika|process)\b|कैसे|तरीका/i],
];

/* The areas: the same groups as her answer ids. More cues for one area wins; none: ''. */
const MI_AREAS: Array<[MeeraArea, RegExp]> = [
  ['general', /\b(login|pin|password|export|download|upload|excel|filters?|phone|mobile|camera|scanner|slow|refresh|meera|notification|tab|version)\b|लॉगिन|पिन|फोन/gi],
  ['orders', /\b(order console|sales order|so|order|shopify|customer|return|cx|etsy|bucket)\b|ऑर्डर/gi],
  ['production', /\b(job ?work|jobwork|karigar|kariger|cutting|press|qc|quality|silai|stitch|tailor|darzi|ppc|production|issue|receive|piece|maal)\b|कारीगर|कटिंग|सिलाई|प्रेस|क्यूसी/gi],
  ['inventory', /\b(stock|finished goods|fg|fba|packing|pack|scan|fabric|greige|accessor\w*|zip|zipper|godown|warehouse|dispatch|label)\b|स्टॉक|पैकिंग|फैब्रिक/gi],
  ['planning', /\b(replenish\w*|top asin|dashboard|target|report|meeting|priority|projection|plan\w*)\b|रिपोर्ट|टारगेट/gi],
  ['vendors', /\b(vendor|printer|rfd|master|new sku|sku code|salary|payout|advance|piece rate|rate|employee|hr|freeze)\b|वेंडर|सैलरी|तनख्वाह|मास्टर/gi],
];

/** What kind of question this is, and which part of the ERP it is about. */
function miClassify(q: string): MeeraIntentResult {
  const text = String(q || '').replace(/\s+/g, ' ').trim();
  const scores: Partial<Record<MeeraIntent, number>> = {};
  const cues: string[] = [];
  for (const [kind, weight, re] of MI_CUES) {
    const m = text.match(re);
    if (!m) continue;
    scores[kind] = (scores[kind] || 0) + weight;
    cues.push(m[0].trim().toLowerCase().slice(0, 30));
  }
  /* the most weight wins; a tie goes to the kind earlier in MI_ORDER. "kaise" (how, 2) beside a stronger kind is that
   * kind ("login kaise kru" is access); "kaise" alone stays how */
  let intent: MeeraIntent = 'how', best = 0;
  for (const k of MI_ORDER) {
    const s = scores[k] || 0;
    if (s > best) { best = s; intent = k; }
  }
  let area: MeeraArea = '', most = 0;
  for (const [a, re] of MI_AREAS) {
    const n = (text.match(re) || []).length;
    if (n > most) { most = n; area = a; }
  }
  return { intent, area, scores, cues };
}

/* HOW MEERA ANSWERS EACH KIND — the plan, read by her tests and (later) by her search and her router.
 *   source — where the answer comes from
 *   shape  — what the person sees
 *   ai     — 'judge': Groq may only pick one of her own answers by id; 'write': Groq may write from her notes (marked
 *            "please check"); 'never': no AI, a ticket instead
 *   bar    — how sure her search must be to answer outright (today one bar for all: 0.75 with the meaning table).
 *            STARTING VALUES ONLY: each is set on the tuning set, never on the held-back sets. */
interface MeeraIntentPlan { source: string; shape: string; ai: 'judge' | 'write' | 'never'; bar: number; }
const MI_PLAN: Record<MeeraIntent, MeeraIntentPlan> = {
  how:     { source: 'answers + walk-throughs', shape: 'one line, steps folded, "Do it with me" / "Show me how"', ai: 'judge', bar: 0.75 },
  where:   { source: 'answers + the screens this person can open', shape: 'the screen and the box, an Open button, the box lit', ai: 'judge', bar: 0.7 },
  what:    { source: 'screen parts (label + help text), the open screen first', shape: 'one line: what it is, what it is for', ai: 'judge', bar: 0.7 },
  error:   { source: 'the red line on the screen (GUIDE_FIX), then answers', shape: 'quote the red line, point at the box to fix, "Help with this"', ai: 'judge', bar: 0.75 },
  status:  { source: 'answers about colours, words and hidden rows', shape: 'the rule behind it in one line, what to do about it', ai: 'judge', bar: 0.8 },
  data:    { source: 'the ERP figures this page holds (switch "data", read only)', shape: 'the figure, where it comes from, an Open button', ai: 'never', bar: 0.8 },
  whatif:  { source: 'checked answers only', shape: 'exactly what the answer says happens; never worked out', ai: 'judge', bar: 0.85 },
  access:  { source: 'answers + this person\'s rights (the bridge)', shape: 'what they can and cannot open, who can give the right', ai: 'judge', bar: 0.8 },
  fix:     { source: 'answers about corrections and requests', shape: 'the correction steps; deleted or money: a ticket to an admin at once', ai: 'judge', bar: 0.8 },
  flow:    { source: 'answers + walk-throughs, in order', shape: 'the screens one after another, each with an Open button', ai: 'write', bar: 0.75 },
  outside: { source: 'none', shape: '"The ERP does not do this", and a ticket if it is about the business', ai: 'never', bar: 1 },
  chat:    { source: 'a few fixed lines', shape: 'a short hello or thanks, then "What do you need on the ERP?"', ai: 'never', bar: 1 },
};
