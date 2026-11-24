/* MEERA'S QUESTION CATEGORIES — a check of meera/client/src/intent.ts (17 Nov 2026).
 *   node meera/tests/intent-check.cjs          every question below must get its kind (and area, where given)
 *   node meera/tests/intent-check.cjs --show   also prints the cues that decided each one
 *
 * The questions are from her test set (bank/evals/eval.json) or written for this file — never from the held-back sets
 * (typos-held, hinglish-held), so their scores stay honest. A new question that gets the wrong kind: add it here first
 * (it must fail), then fix the cues in intent.ts — the same loop as ravi-chats.cjs. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const esbuild = require(path.join(ROOT, 'Replenish-App', 'node_modules', 'esbuild'));
const SHOW = process.argv.includes('--show');

const src = fs.readFileSync(path.join(ROOT, 'meera', 'client', 'src', 'intent.ts'), 'utf8').replace(/\r\n/g, '\n');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(esbuild.transformSync(src, { loader: 'ts' }).code + '\nthis.miClassify = miClassify; this.MI_PLAN = MI_PLAN;', ctx);

/* [question, kind, area (optional)] */
const CASES = [
  /* how */
  ['karigar ko kaam kaise de', 'how', 'production'],
  ['ek saath 10 entry receive krni hai, ek ek karke nhi', 'how', 'production'],
  ['how do i remove all the filters at once', 'how', 'general'],
  /* where */
  ['Ramesh se 40 piece wapas aaye, kaha chadhau', 'where', 'production'],
  ['लॉगआउट का बटन कहाँ है', 'access'],
  ['export kiya par file kha gyi dikh nhi rhi', 'where', 'general'],
  ['rfd requirements screen kha milegi', 'where', 'vendors'],
  /* what */
  ['row pe change asked likha hai iska kya matlab', 'what'],
  ['SKU kya karta hai', 'what'],
  ['what is fba', 'what', 'inventory'],
  /* error */
  ['इश्यू करते समय पहले कटिंग करो वाला एरर आ रहा है', 'error'],
  ['issue nhi ho rha bol rha at most itne hi allowed', 'error', 'production'],
  ['excel upload fails every time, says wrong format', 'error', 'general'],
  ['error says month is frozen but i need to put an entry for last month', 'error'],
  /* status */
  ['date ke aage 8d laal kyu dikh rha', 'status'],
  ['जिनका पूरा माल आ गया वो लाइनें रजिस्टर से गायब हैं', 'status'],
  /* data */
  ['RCN14B ka stock kitna hai', 'data', 'inventory'],
  ['Ramesh ke paas abhi kitna maal hai', 'data', 'production'],
  ['order AMZ-25102026-01 kahan hai', 'data', 'orders'],
  /* whatif */
  ['after freezing a fortnight, if I change a rate does the payout move', 'whatif', 'vendors'],
  ['गलती से दो बार सेव दबा दिया, अब क्या होगा', 'whatif'],
  /* access */
  ['password bhul gaya sir ab login kaise kru', 'access', 'general'],
  ['admin just gave me the cutting screen but i still dont see it', 'access'],
  ['maine change maanga tha, ab khud approve kyu nahi kar pa raha', 'access'],
  /* fix */
  ['sir galti se entry delete ho gyi wapas aa skti hai kya urgent', 'fix'],
  ['wrong entry ho gayi job work me, kaise theek kare', 'fix', 'production'],
  /* flow */
  ['amazon ka order shuru se FBA bhejne tak kaun kaun si screen se guzarta h', 'flow'],
  ['full process of a shopify order from start to dispatch', 'flow', 'orders'],
  /* outside */
  ['GST invoice me HSN code kaise badle', 'outside'],
  ['flipkart pe listing kaise kare', 'outside'],
  /* chat */
  ['hello', 'chat'],
  ['thank you', 'chat'],
];

let bad = 0;
for (const [q, kind, area] of CASES) {
  const r = ctx.miClassify(q);
  const ok = r.intent === kind && (area === undefined || r.area === area);
  if (!ok) bad++;
  if (!ok || SHOW) console.log(`${ok ? 'ok  ' : 'FAIL'} ${q}\n     want ${kind}${area ? ' / ' + area : ''}, got ${r.intent} / ${r.area || '-'}  cues: ${r.cues.join(' | ')}`);
}
/* every kind has a plan */
for (const k of ['how', 'where', 'what', 'error', 'status', 'data', 'whatif', 'access', 'fix', 'flow', 'outside', 'chat'])
  if (!ctx.MI_PLAN[k]) { bad++; console.log('FAIL no plan for ' + k); }
console.log(bad ? `\n${bad} of ${CASES.length} wrong` : `all ${CASES.length} right`);
process.exit(bad ? 1 : 0);
