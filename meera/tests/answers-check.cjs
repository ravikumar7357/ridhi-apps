/* HER ANSWERS ARE WELL-FORMED — checked every time meera.js is built (v2 rebuild, Phase 6, 2 Nov 2026).
 *
 *   node meera/tests/answers-check.cjs        prints what is wrong, in plain words; exit 1 if anything is
 *   require('./answers-check.cjs').check()    → [] or the list of problems (meera/client/build.cjs stops on any)
 *
 * meera-bank.json — every entry: a unique id; a screen ("" for any screen); and EITHER a written answer (ways of asking
 * in English / Hindi / Hinglish, the answer in English at least, why and steps in the same shape) OR a part of a screen
 * ([label, kind, English, Hindi, Hinglish, box?]). meera-walks.json — every walk-through: a unique id, a title, steps
 * that each say something in English, Hindi and Hinglish, and only known kinds of waiting. */
const fs = require('fs'), path = require('path');
const G = path.join(__dirname, '..', '..', 'Replenish-App', 'public', 'guide');
const LANGS = ['en', 'hi', 'hg'];
const KINDS = ['button', 'column', 'box', 'option', 'note', 'tab', 'link', 'part', 'filter', 'check', 'menu', 'row', 'card', 'chip', 'toggle', 'field', 'list', 'badge', 'hint'];
const isText = v => typeof v === 'string' && v.trim() !== '';

function check(bank, walks) {
  bank = bank || JSON.parse(fs.readFileSync(path.join(G, 'meera-bank.json'), 'utf8'));
  walks = walks || JSON.parse(fs.readFileSync(path.join(G, 'meera-walks.json'), 'utf8'));
  const bad = [];
  const say = (where, what) => bad.push(`${where}: ${what}`);
  if (!Array.isArray(bank)) return ['meera-bank.json: not a list of answers'];
  const ids = new Set();
  bank.forEach((e, i) => {
    const where = `meera-bank.json answer ${i + 1} (${e && e.id ? e.id : 'no id'})`;
    if (!e || typeof e !== 'object') return say(where, 'not an answer');
    if (!isText(e.id)) say(where, 'has no id');
    else if (ids.has(e.id)) say(where, 'the same id as an earlier answer');
    else ids.add(e.id);
    if (typeof e.tab !== 'string') say(where, 'no screen ("tab" — "" for any screen)');
    if (e.p) {
      if (!Array.isArray(e.p) || e.p.length < 5) return say(where, 'a part of a screen needs [label, kind, English, Hindi, Hinglish]');
      if (!isText(e.p[0])) say(where, 'the part has no label');
      if (!isText(e.p[2])) say(where, 'the part has no English line');
      if (e.p[5] != null && typeof e.p[5] !== 'string') say(where, 'the part\'s box is not a selector');
      return;
    }
    if (!e.q || typeof e.q !== 'object') return say(where, 'no ways of asking ("q")');
    const asks = LANGS.flatMap(l => (e.q[l] || []));
    if (!asks.length) say(where, 'no way of asking in any language');
    for (const l of LANGS) if (e.q[l] != null && (!Array.isArray(e.q[l]) || e.q[l].some(x => !isText(x)))) say(where, `ways of asking (${l}) must be a list of sentences`);
    if (!e.a || !isText(e.a.en)) say(where, 'no answer in English ("a.en")');
    for (const k of ['a', 'why']) if (e[k]) for (const l of LANGS) if (e[k][l] != null && typeof e[k][l] !== 'string') say(where, `"${k}.${l}" is not text`);
    if (e.steps) for (const l of LANGS) if (e.steps[l] != null && (!Array.isArray(e.steps[l]) || e.steps[l].some(x => !isText(x)))) say(where, `steps (${l}) must be a list of sentences`);
    if (e.sel != null && !isText(e.sel)) say(where, 'its "Show me" box is not a selector');
    /* an answer must not be broken HTML a person would see: tags opened and closed */
    for (const l of LANGS) {
      const t = e.a && e.a[l];
      if (typeof t === 'string' && (t.match(/<b>/g) || []).length !== (t.match(/<\/b>/g) || []).length) say(where, `the answer (${l}) opens and closes <b> unevenly`);
    }
  });
  if (!Array.isArray(walks)) return bad.concat(['meera-walks.json: not a list of walk-throughs']);
  const wids = new Set();
  walks.forEach((w, i) => {
    const where = `meera-walks.json walk ${i + 1} (${w && w.id ? w.id : 'no id'})`;
    if (!w || !isText(w.id)) return say(where, 'has no id');
    if (wids.has(w.id)) say(where, 'the same id as an earlier walk-through');
    wids.add(w.id);
    if (!w.replaces && !w.existing) {
      if (!w.title || !isText(w.title.en)) say(where, 'no title in English');
      if (!Array.isArray(w.steps) || !w.steps.length) say(where, 'no steps');
    }
    (w.steps || []).forEach((s, j) => {
      if (!isText(s.en)) say(`${where} step ${j + 1}`, 'says nothing in English');
      if (s.wait != null && !['click', 'value'].includes(s.wait)) say(`${where} step ${j + 1}`, `waits for "${s.wait}" — only "click" or "value"`);
      if (s.sel != null && !isText(s.sel)) say(`${where} step ${j + 1}`, 'its box is not a selector');
    });
  });
  return bad;
}
module.exports = { check, KINDS };

if (require.main === module) {
  const bad = check();
  if (bad.length) { console.log(`HER ANSWERS HAVE ${bad.length} PROBLEM(S):`); bad.slice(0, 40).forEach(b => console.log('  • ' + b)); process.exit(1); }
  console.log('her answers and walk-throughs are well-formed');
}
