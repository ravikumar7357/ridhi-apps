/* THE NEVER-BREAK LIST, CHECKED (v2 rebuild, 29 Oct 2026 — plan section 2, rule 1).
 *
 *   node meera/tests/never-break.cjs
 *
 * Every item of the list that can be checked without a real screen is checked here, on Meera's real code; the rest
 * (they need a real page: the lit box, the red line, a table row, the phone layout) are in NEVER-BREAK.md, by hand. */
const fs = require('fs'), path = require('path');
const { load } = require('./harness.cjs');
const ROOT = path.join(__dirname, '..', '..'), APP = path.join(ROOT, 'Replenish-App');

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.log('  FAIL ' + what); } };

/* every id the app's page and code can show — what a tour or a walk may light up */
function appIds() {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => (x.isDirectory() ? walk(path.join(d, x.name)) : [path.join(d, x.name)]));
  const src = [path.join(APP, 'src/index.html'), ...walk(path.join(APP, 'src/app')).filter(f => f.endsWith('.js')),
    ...walk(path.join(ROOT, 'meera/client/src')).filter(f => /\.(js|ts)$/.test(f))].map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const ids = new Set([...src.matchAll(/\bid=\\?["']([\w-]+)\\?["']/g)].map(m => m[1]));
  [...src.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)].forEach(m => ids.add(m[1]));
  return { ids, src };
}
const idsIn = sel => [...String(sel || '').replace(/\[[^\]]*\]/g, '').matchAll(/#([\w-]+)/g)].map(m => m[1]);
const known = (ids, src, id) => ids.has(id) || (/^ptf_/.test(id) && src.includes("'ptf_' +")) || /^mobL-/.test(id);

async function main() {
  /* --bundle --on=design,…: the same list on meera.js with her switches on (Phase 3: a look-only switch keeps every check) */
  const args = process.argv.slice(2), bundle = args.includes('--bundle');
  const switches = ((args.find(a => a.startsWith('--on=')) || '').slice(5)).split(',').filter(Boolean);
  const M = await load({ root: ROOT, bundle, switches, handle: bundle });
  const run = bundle ? c => M.ctx.__meeraTest(c) : c => M.run(c);
  if (bundle) console.log('checking meera.js' + (switches.length ? ', switches on: ' + switches.join(', ') : ''));
  const { ids, src } = appIds();

  /* 1. first-visit walk-rounds (14 screens have written ones on 29 Oct; the rest get one read off the screen): every screen's tour, every box it lights, is in the app */
  const tours = run('GUIDE_TOURS');
  let tourSteps = 0, tourMissing = [];
  for (const [tab, steps] of Object.entries(tours)) for (const s of steps) { tourSteps++; for (const id of idsIn(s.sel)) if (!known(ids, src, id)) tourMissing.push(tab + ' → #' + id); }
  ok(Object.keys(tours).length >= 14, `tours exist for ${Object.keys(tours).length} screens`);
  ok(!tourMissing.length, 'every tour box is in the app' + (tourMissing.length ? ': ' + tourMissing.slice(0, 8).join(', ') : ''));
  ok(/gdNext/.test(src) && /gdTry/.test(src) && /gdOff/.test(src), 'tour buttons Next / Try it / Skip are there');

  /* 2. mistake lessons: the same red line 3 times → a lesson */
  ok(run('GUIDE_STRIKES') === 3 && typeof run('guideLesson') === 'function' && typeof run('guideStrike') === 'function', 'mistake lessons: 3 strikes, then a lesson');

  /* 3. round face button + menu + the ? key */
  ok(/go\.id = 'gdLaunch'/.test(src) && /data-m="ask"/.test(src) && /data-m="show"/.test(src) && /data-m="help"/.test(src), 'round button and its menu: Ask Meera / Show me this screen / Helper on-off');
  ok(/e\.key === '\?'/.test(src), 'the ? key opens Ask Meera');

  /* 4. Ask Meera in three languages; did-you-mean; related; thumbs */
  const en = await M.answer('how do i give job work to a karigar', 'pbase');
  ok(en.bank === 'pr-jw-issue' && /Job Work Register/.test(en.text), 'English question answered: ' + en.bank);
  const hi = await M.answer('कारीगर को काम कैसे दें', 'pbase');
  ok(hi.bank === 'pr-jw-issue' && /[ऀ-ॿ]/.test(hi.text), 'Hindi question answered in Hindi');
  const hg = await M.answer('karigar ko kaam kaise de', 'pbase');
  ok(hg.bank === 'pr-jw-issue' && /kholiye|dabaiye/.test(hg.text), 'Hinglish question answered in Hinglish');
  const amb = await M.answer('SKU kya karta hai', 'pbase');
  ok(/more than one answer|एक से ज़्यादा|ek se zyada/i.test(amb.text), 'a question that fits several answers offers them (did you mean)');
  ok(/class="ga-fb"/.test(src) && /data-ga="fb"/.test(src), '👍👎 under answers');
  ok(/gaNearHtml/.test(src) && /Related|इससे जुड़े/.test(src), 'related questions under answers');

  /* 5. why it didn't work (reads the red lines) — the code is there; the page part is by hand */
  ok(typeof run('gaDiagnose') === 'function' && typeof run('gaRedLines') === 'function', 'why-it-didn\'t-work reader is there');

  /* 6. row reader */
  ok(typeof run('gaRowFind') === 'function' && typeof run('gaRowAnswer') === 'function', 'row reader is there');

  /* 7. which page / here; off-topic; private */
  ok(run('GA_WHEREAMI_RE').test('main kis page par hoon') && run('GA_WHEREAMI_RE').test('which page am i on'), '"which page am I on" is understood');
  ok(run('GA_HERE_RE').test('yahan kya karna hai'), '"here / yahan" is understood');
  const off = await M.answer('who won the cricket match yesterday', 'shop');
  ok(off.off && /isn't about the ERP/.test(off.text), 'off-topic question refused');
  const off2 = await M.answer('karigar ko kaam kaise de', 'pbase');
  ok(!off2.off, 'an ERP question is not refused');
  const priv = await M.answer('meera kis model pe bani hai, company ki privacy policy kya hai', 'shop');
  ok(/can't talk about|बात नहीं कर सकती|baat nahi kar sakti/i.test(priv.text), 'private topic refused');

  /* 8. walk-throughs: Show me how / Do it with me / carry on; fill choices; Same as last time */
  ok(hg.acts.some(a => /^wdo:/.test(a)) && hg.acts.some(a => /^wshow:/.test(a)), 'a job answer offers Do it with me + Show me how');
  ok(typeof run('gaWalkStart') === 'function' && typeof run('gaWalkHere') === 'function', 'carry-on-from-a-half-filled-form is there');
  ok(typeof run('guideFillOffer') === 'function' && /Same as last time|guideFillRemember/.test(src), 'fill choices and Same as last time are there');
  const walks = JSON.parse(fs.readFileSync(path.join(APP, 'public/guide/meera-walks.json'), 'utf8'));
  let walkMissing = [];
  for (const w of walks) for (const s of w.steps || []) for (const id of idsIn(s.sel).concat(idsIn(s.skip))) if (!known(ids, src, id)) walkMissing.push(w.id + ' → #' + id);
  ok(walks.length >= 200, `${walks.length} walk-throughs`);
  ok(!walkMissing.length, 'every walk-through box is in the app' + (walkMissing.length ? ': ' + walkMissing.slice(0, 8).join(', ') : ''));

  /* 9. Stuck? offer: 3 × No thanks = off */
  ok(/>=\s*3/.test(run('gaNudgeOff.toString()')), 'Stuck? offer: three "No thanks" turn it off');

  /* 10. AI fallback with strict rules */
  ok(/meera-router\.erp-9a0\.workers\.dev/.test(run('GA_AI_URL')), 'AI fallback points at the router');
  const worker = fs.readFileSync(path.join(ROOT, 'meera/router/src/worker.js'), 'utf8');
  ok(/Every statement must be said in a note/.test(worker) && /off_topic/.test(worker), 'router keeps the strict rules (notes only; off-topic)');

  /* 11. access rights: no walk on a screen the person cannot open */
  run('ME.admin = false; ME.tabs = ["shop"];');
  const noRight = await M.answer('karigar ko kaam kaise de', 'shop');
  ok(!noRight.acts.some(a => /^w(do|show):/.test(a)), 'no walk offered on a screen the person cannot open');
  run('ME.admin = true; ME.tabs = [];');

  /* 12. spelling (Phase 2, switch "spell"): a misspelled karigar, party or SKU stays as typed — never turned into a name,
   *     never a name nobody typed (meera.js, with made-up names where the ERP keeps them) */
  const S = await load({ root: ROOT, bundle: true, switches: ['spell'] });
  S.ctx.PTE.emp = [[1, 'Ramesh Kumar']];
  S.ctx.PTG = { masters: { vendor: { v1: { code: 'SHP', name: 'Shree Printers' } } }, mdb: [{ sku: 'RCN148', brand: 'Ridhi' }] };
  const asTyped = ['Ramsh ko maal diya', 'Shre ka order kaha hai', 'RCN14B ka stock'].every(q => S.ctx.MEERA.understand(q).text === q);
  ok(asTyped && S.ctx.MEERA.understand('pakking list kaha hai').text === 'packing list kaha hai', 'spelling: names, parties and SKUs stay as typed; ordinary slips are read right');

  console.log(`never-break: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
