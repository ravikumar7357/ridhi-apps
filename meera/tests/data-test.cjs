/* PHASE 7 CHECKS — answers from the ERP's own figures, on the SAMPLE factory (meera/tests/data/sample.cjs).
 *   node meera/tests/data-test.cjs [--list]
 * 1. 100+ questions (English, Hindi, Hinglish, with typos), the right answer for each worked out from the plain sample
 *    data here (not by Meera's code): right / asked which / wrong. Ordinary how-to questions must NOT be taken.
 * 2. Rights: an account without the screen gets "not in your account" and no figure.
 * 3. A screen not read yet: she says so, and nothing is read.
 * 4. Read only: no function that saves or reads the database is called; no screen opens unless its button is pressed;
 *    nothing is fetched (no AI, no router).
 * 5. Her 580 recorded questions: how many she would now take as data questions (should be none or real ones). */
const fs = require('fs'), path = require('path');
const { load } = require('./harness.cjs');
const { install, RAW, TOUCH } = require('./data/sample.cjs');
const ROOT = path.join(__dirname, '..', '..');
const LIST = process.argv.includes('--list');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL ' + m); } };
const nf = n => Number(n).toLocaleString('en-IN');
const plain = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/* ---------- the right answers, from the plain data ---------- */
const { LINES, BASE, STOCK, CHECKS, LAST, NOW, DAY, left, open, waitingAt, today } = RAW;
const placed = no => { const d = LINES.find(l => l.orderNo === no).orderDate.split('/'); return new Date(+d[2], +d[1] - 1, +d[0]).getTime(); };
const idle = no => Math.floor((NOW - (LAST[no] ? LAST[no].ms : placed(no))) / DAY);
const want = {
  order: no => { const ls = LINES.filter(l => l.orderNo === no), o = ls.some(open);
    return [nf(ls.reduce((a, l) => a + l.qty, 0)), ...ls.map(waitingAt), ...BASE.filter(b => b.orderNo === no && left(b) > 0).map(b => b.empName), ...(o && idle(no) >= 5 ? ['LATE'] : [])]; },
  karigar: name => [name, nf(BASE.filter(b => b.empName === name).reduce((a, b) => a + Math.max(0, left(b)), 0))],
  sku: s => [s, nf(STOCK[s].current), ...(STOCK[s].pending ? [nf(STOCK[s].pending)] : [])],
  wait: st => { const ls = LINES.filter(l => open(l) && waitingAt(l).startsWith(st + ' — ')); return [nf(ls.reduce((a, l) => a + Number(waitingAt(l).match(/— ([\d,]+)/)[1].replace(/,/g, '')), 0)), ...ls.map(l => l.sku)]; },
  today: f => { const iss = BASE.filter(b => RAW.stamp(b.issueAt).slice(0, 10) === today).reduce((a, b) => a + b.issuePieces, 0);
    const rec = BASE.reduce((a, b) => a + b.recv.filter(r => RAW.stamp(r[0]).slice(0, 10) === today).reduce((x, r) => x + r[1], 0), 0);
    const pas = CHECKS.filter(c => c.baseId && c.date.slice(0, 10) === today).reduce((a, c) => a + c.ok, 0);
    return f === 'issued' ? [nf(iss)] : f === 'received' ? [nf(rec)] : f === 'passed' ? [nf(pas)] : [nf(iss), nf(rec), nf(pas)]; },
  late: () => { const late = [...new Set(LINES.filter(open).map(l => l.orderNo))].filter(no => idle(no) >= 5); return [String(late.length), ...late]; },
};

/* ---------- the questions ---------- */
const Q = [];
const add = (kind, key, qs) => qs.forEach(q => Q.push({ q, kind, key }));
for (const no of ['AMZ-16092026-02', 'AMZ-25102026-01', 'B2B-20102026-01', 'LEG-17102026-01', 'SPY-28102026-03', 'SHP-RBP7620']) {
  add('order', no, [`where is order ${no}`, `${no} kahan hai`, `${no} ka status kya hai`, `${no} कहाँ है`]);
}
add('order', 'AMZ-16092026-02', ['amz-16092026-02 kis stage pe hai', 'wher is ordr AMZ-16092026-02', 'amz1609202602 kidhar hai', 'AMZ-16092026-02 ka kya haal hai', 'status of AMZ-16092026-02 please']);
add('order', 'SHP-RBP7620', ['RBP7620 order kahan hai', 'shp-rbp7620 kaha he']);
add('order', 'B2B-20102026-01', ['B2B-20102026-01 का स्टेटस बताओ', 'b2b-20102026-01 where']);
add('order-missing', 'AMZ-01012026-09', ['AMZ-01012026-09 kaha hai', 'where is AMZ-01012026-09']);
for (const k of ['Raju Kumar', 'Raju Singh', 'Imran Ali', 'Mohan Lal', 'Sunita Devi', 'Suresh Yadav', 'Farida Begum']) {
  add('karigar', k, [`${k} ke paas kitne piece hain`, `how many pieces does ${k} have`, `${k} के पास कितने पीस हैं`]);
}
add('karigar', 'Imran Ali', ['Imran ke paas kitna maal pada hai', 'imran ali ke pas kitne pcs baki', 'Imraan Ali ke paas kitna maal hai']);
add('karigar', 'Mohan Lal', ['mohan lal ke paas kitna kaam hai', 'Mohan ke paas kitne piece pending hai']);
add('karigar', 'Farida Begum', ['Farida ke paas kitna maal']);
add('karigar', 'Sunita Devi', ['Suneeta Devi ke paas kitne piece hain']);
add('karigar-which', 'Raju', ['Raju ke paas kitne piece hain', 'raju ke pass kitna maal hai', 'how many pieces does Raju have', 'Raju के पास कितने पीस हैं']);
for (const s of ['CPC008-04', 'RTBX72', 'RQL354-K', 'CPC210-02', 'RBC101-M']) add('sku', s, [`${s} ka stock kitna hai`, `stock of ${s}`, `${s} का स्टॉक कितना है`]);
add('sku', 'CPC008-04', ['cpc008-04 kitne bache hain', 'how many CPC008-04 in store', 'cpc008-04 ka stok']);
add('sku', 'RBC101-S', ['RBC101-S ka stock']);
add('sku-which', 'CPC008', ['CPC008 ka stock kitna hai', 'stock of cpc008']);
add('wait', 'QC', ['QC mein kya pending hai', 'how many pieces waiting in qc', 'क्यूसी में कितना बाकी है', 'qc pe kitna maal pada hai']);
add('wait', 'Cutting', ['cutting me kitna baki hai', 'what is waiting in cutting', 'कटिंग में कितना बाकी है', 'cuting me kitne pending']);
add('wait', 'Vendor', ['printer ke paas kitna maal pada hai', 'what is waiting at the printer', 'vendor ke paas kitna pending hai', 'प्रिंटर पर कितना बाकी है']);
add('wait', 'Karigar', ['karigaron ke paas kitna maal pending hai', 'how many pieces are pending with karigars']);
add('today', 'issued', ['aaj kitna issue hua', 'how many pieces issued today', 'आज कितना इश्यू हुआ', 'aj kitne piece issue kiye']);
add('today', 'received', ['aaj kitna maal wapas aaya', 'how many pieces received today', 'aj kitne recieve hue', 'आज कितना माल आया']);
add('today', 'passed', ['aaj qc pass kitne hue', 'how many passed qc today', 'आज क्यूसी पास कितने हुए']);
add('today', '', ['aaj kitna issue aur receive hua', 'today how many pieces issued and received']);
add('late', '', ['kaun se order late hain', 'which orders are late', 'late orders kitne hain', 'कौन से ऑर्डर लेट हैं', 'der wale order konse hai', 'lat orders list']);
/* ordinary questions: never taken as data questions */
add('none', '', ['karigar ko kaam kaise de', 'Raju Kumar ko maal kaise issue kare', 'order kaise banaye', 'qc kaise kare', 'stock entry kaise kare', 'how to receive pieces from Imran Ali',
  'AMZ-16092026-02 ka maal kaise receive kare', 'where do i enter cutting', 'printer ko order kaise de', 'late fee kya hai', 'how to check stock of a sku', 'Mohan Lal ka hisab chahiye']);

(async () => {
  const M = await load({ root: ROOT, bundle: true, handle: true, switches: ['lazy', 'data'], only: true });
  const T = c => M.ctx.__meeraTest(c);
  install(M);
  M.setTab('shop');
  const fetched0 = M.state.fetched.length;
  const res = { right: 0, asked: 0, missed: 0, wrong: 0 }, byKind = {};
  console.log(`1. ${Q.length} questions on the sample factory (${Q.filter(x => x.kind !== 'none').length} about its figures, ${Q.filter(x => x.kind === 'none').length} ordinary ones that must be left alone)`);
  for (const x of Q) {
    const r = T('meeraDataTry(' + JSON.stringify(x.q) + ')'), text = r ? plain(r.html) : '';
    let k;
    if (x.kind === 'none') k = r ? 'wrong' : 'right';
    else if (x.kind.endsWith('-which')) k = r && r.kind === x.kind && (x.kind === 'karigar-which' ? ['Raju Kumar', 'Raju Singh'] : ['CPC008-04', 'CPC008-06', 'CPC008-08']).every(s => text.includes(s)) ? 'right' : r && r.kind.endsWith('-which') ? 'asked' : 'wrong';
    else if (x.kind === 'order-missing') k = r && r.kind === 'order-missing' ? 'right' : 'wrong';
    else if (!r) k = 'missed';   // not taken: her ordinary answer, no figure — not a wrong one
    else if (r.kind.endsWith('-which')) k = 'asked';
    else k = r.kind === x.kind && want[x.kind](x.key).every(s => (s === 'LATE' ? /Late|लेट/.test(text) : text.includes(s))) ? 'right' : 'wrong';
    res[k]++; (byKind[x.kind] = byKind[x.kind] || { right: 0, asked: 0, missed: 0, wrong: 0 })[k]++;
    if (LIST && k !== 'right') console.log(`  ${k.padEnd(6)} [${x.kind} ${x.key}] ${x.q}\n         → ${r ? r.kind + ': ' + text.slice(0, 160) : 'not taken'}`);
  }
  console.log(`   right ${res.right} · asked which ${res.asked} · not taken (her ordinary answer) ${res.missed} · wrong ${res.wrong}`);
  Object.entries(byKind).forEach(([k, v]) => console.log(`     ${k.padEnd(14)} right ${v.right}, asked ${v.asked}, not taken ${v.missed}, wrong ${v.wrong}`));
  ok(res.wrong === 0, `${res.wrong} question(s) answered wrong`);

  console.log('2. rights: an account with Quality Control only');
  install(M, { tabs: ['qc'] });
  for (const q of ['AMZ-16092026-02 kahan hai', 'Imran Ali ke paas kitne piece hain', 'CPC008-04 ka stock kitna hai', 'kaun se order late hain', 'cutting me kitna baki hai']) {
    const r = T('meeraDataTry(' + JSON.stringify(q) + ')'), t = plain(r && r.html);
    ok(r && /Aapke account mein yeh screen nahi hai|Your account does not have this screen|आपके अकाउंट में यह स्क्रीन नहीं है/.test(t) && !/\d{2,}/.test(t.replace(/AMZ-\d+-\d+|CPC\d+-\d+/g, '')), `not allowed, no figure: ${q} → ${t.slice(0, 120)}`);
  }
  { const t = plain(T('meeraDataTry("aaj qc pass kitne hue")').html); ok(t.includes(want.today('passed')[0]), 'the screen it has (QC) still answers: ' + t.slice(0, 100)); }
  { const t = plain(T('meeraDataTry("aaj kitna issue hua")').html); ok(/nahi hai|does not have|नहीं है/.test(t) && !t.includes(want.today('issued')[0] + ' pcs'), 'issued today (Job Work) is not shown: ' + t.slice(0, 120)); }

  console.log('3. a screen not read yet on this computer');
  install(M, { missing: ['pbase', 'ord'] });
  { const t = plain(T('meeraDataTry("Imran Ali ke paas kitne piece hain")').html); ok(/not been opened yet|abhi nahi khuli|अभी नहीं खुली/.test(t), 'Job Work not read: she says so — ' + t.slice(0, 120)); }
  { const t = plain(T('meeraDataTry("AMZ-16092026-02 kahan hai")').html); ok(/not been opened yet|abhi nahi khuli|अभी नहीं खुली|cannot find|nahi mila/.test(t), 'Order Console not read: ' + t.slice(0, 120)); }
  ok(!M.ctx.__touched.length, 'nothing was read to fill the gap: ' + M.ctx.__touched.join(', '));

  console.log('4. read only');
  install(M);
  for (const x of Q) T('meeraDataTry(' + JSON.stringify(x.q) + ')');
  ok(!M.ctx.__touched.length, 'no save or database read in ' + Q.length + ' questions: ' + M.ctx.__touched.join(', '));
  ok(!M.ctx.__opened.length, 'no screen opened by itself: ' + M.ctx.__opened.join(', '));
  ok(M.state.fetched.length === fetched0, 'nothing fetched (no AI, no router): ' + M.state.fetched.slice(fetched0).join(', '));
  T('meeraDataOpen("order|AMZ-16092026-02")'); T('meeraDataOpen("karigar|Imran Ali")'); T('meeraDataOpen("sku|CPC008-04")');
  ok(M.ctx.__opened.join() === 'order:AMZ-16092026-02,search:kar|Imran Ali,sku:CPC008-04', 'its buttons open the right line: ' + M.ctx.__opened.join(', '));
  ok(!M.ctx.__touched.length, 'still no save or read after the buttons');
  { const src = fs.readFileSync(path.join(ROOT, 'meera/client/src/data.ts'), 'utf8'), br = fs.readFileSync(path.join(ROOT, 'Replenish-App/src/app/core/meera-bridge.js'), 'utf8');
    const part = br.slice(br.indexOf('MEERA READS THE ERP'), br.indexOf('MEERA READS THE ERP') > 0 ? br.indexOf('/* ===', br.indexOf('MEERA READS THE ERP')) : 0);
    const bad = TOUCH.concat(['fetch(', 'localStorage', 'mlSend', 'gaAiAsk', 'srvAsk']).filter(n => src.includes(n + (n.endsWith('(') ? '' : '(')) || part.includes(n + (n.endsWith('(') ? '' : '(')));
    ok(part.length > 1000 && !bad.length, 'the Phase 7 code names no save, read, fetch or AI call: ' + bad.join(', '));
    ok((part.match(/showTab\(/g) || []).length === 1 && /open: \(kind, key\)/.test(part), 'the only screen change is the button (open)'); }
  { T('GA.lastQ = ""'); const took = await M.ctx.__meeraTest('meeraDataAsk("Imran Ali ke paas kitne piece hain")');
    ok(took === true && T('GA.lastQ') === '', 'a data question is answered and not kept as her last question (no 👎 note can carry it)'); }

  console.log('5. her 580 recorded questions, with the switch on');
  { const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'meera/bank/baseline/golden.json'), 'utf8'));
    const taken = Object.keys(g).map(k => k.split('|').slice(2).join('|')).filter(q => T('meeraDataTry(' + JSON.stringify(q) + ')'));
    console.log(`   taken as data questions: ${taken.length}` + (taken.length ? '\n     ' + taken.join('\n     ') : ''));
    ok(taken.length <= 5, 'at most a handful of recorded questions are taken as data questions'); }

  console.log('6. switch off');
  { const N = await load({ root: ROOT, bundle: true, handle: true, switches: ['lazy'], only: true }); install(N);
    ok((await N.ctx.__meeraTest('meeraDataAsk("Imran Ali ke paas kitne piece hain")')) === false, 'with "data" off she does not take it'); }
  console.log(`\nphase7-data: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
