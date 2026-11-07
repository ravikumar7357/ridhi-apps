/* PAGE REGISTERS — which registers does a screen reach? (Step 3, Part B of docs/data-reduction/STEP3-PLAN.md)
 * Used by tests/page-registers-test.js.
 *
 * The whole app is one module scope, so a function in one file calls a function in another by its bare name. This reads every
 * file under src/app, cuts it into top-level pieces (a piece starts on a line that begins in column 0 and runs to the next such
 * line), notes which registers each piece names directly (PTG.ob, PT.base …), notes which other pieces it mentions, and then
 * follows the mentions until nothing new turns up. What a screen's entry reaches is therefore everything it can draw, every
 * button it wires, every Excel it exports and every save it makes — and each of those must sit inside the set the screen declares.
 *
 * Deliberately generous (a name that appears is a call): a false alarm is fixed by reading it, a missed read would be a wrong list.
 * Not seen: calls made through a table or a string (TABS[x].render, onclick="foo()" inside a template). Those screens are read by hand.
 *
 * GATED PIECES: a piece that waits for the whole set (ptNeed(PTG_ALL …), ptLoadGates() or ptNeedAll …) before it touches anything is a gate: what
 * it reaches is not charged to the screen that calls it, because by then everything is loaded. The Change SKU / rename saves
 * and the master edit dialog are the ones that matter. */
const fs = require('fs'), path = require('path');
const REGS = ['masters', 'mdb', 'ob', 'press', 'freeze', 'cut', 'base', 'shopProd', 'qc'];
const ALL = REGS.slice();

/** The code of a file with comments and the insides of strings blanked to spaces (newlines kept), template ${…} kept as code. */
function blank(src) {
  const n = src.length, out = new Array(n);
  let i = 0, last = '';                                  // last = last significant code character, to tell a regex from a division
  const stack = [];                                      // template literal nesting: depth of braces inside each ${ }
  const keep = (k) => { out[k] = src[k]; };
  const wipe = (k) => { out[k] = src[k] === '\n' ? '\n' : ' '; };
  const KW = /(?:^|[^\w$])(return|typeof|case|of|in|delete|void|throw|yield|await|else|do)$/;
  let code = '';
  const readTemplate = () => {                           // i is just after the opening ` (or after the closing } of a ${ })
    while (i < n) {
      const c = src[i];
      if (c === '\\') { wipe(i); if (i + 1 < n) wipe(i + 1); i += 2; continue; }
      if (c === '`') { keep(i); i++; last = '`'; return; }
      if (c === '$' && src[i + 1] === '{') { keep(i); keep(i + 1); i += 2; stack.push(0); return 'expr'; }
      wipe(i); i++;
    }
  };
  let pendingTemplate = false;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (pendingTemplate) { pendingTemplate = false; if (readTemplate() === 'expr') { /* continue as code */ } continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { wipe(i); i++; } continue; }
    if (c === '/' && d === '*') { wipe(i); wipe(i + 1); i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { wipe(i); i++; } if (i < n) { wipe(i); wipe(i + 1); i += 2; } continue; }
    if (c === '\'' || c === '"') {
      keep(i); i++;
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { wipe(i); i++; } wipe(i); i++; }
      if (i < n && src[i] === c) { keep(i); i++; }
      last = c; continue;
    }
    if (c === '`') { keep(i); i++; if (readTemplate() === 'expr') { /* code resumes inside ${ } */ } continue; }
    if (stack.length) {
      if (c === '{') stack[stack.length - 1]++;
      if (c === '}') {
        if (stack[stack.length - 1] === 0) { stack.pop(); keep(i); i++; if (readTemplate() === 'expr') { /* a further ${ } */ } continue; }
        stack[stack.length - 1]--;
      }
    }
    if (c === '/') {
      const before = code.slice(-30);
      const isRegex = last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || KW.test(before);
      if (isRegex) {
        keep(i); i++;
        let cls = false;
        while (i < n && src[i] !== '\n') {
          if (src[i] === '\\') { wipe(i); i++; wipe(i); i++; continue; }
          if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false;
          else if (src[i] === '/' && !cls) break;
          wipe(i); i++;
        }
        if (i < n && src[i] === '/') { keep(i); i++; }
        last = '/'; code += '/'; continue;
      }
    }
    keep(i);
    if (!/\s/.test(c)) { last = c; }
    code = (code + c).slice(-60);
    i++;
  }
  return out.join('');
}

/** Cut a file into top-level pieces: { file, line, name, head, text (blanked code) }. */
function pieces(file, src) {
  const code = blank(src);
  const L = src.split('\n'), C = code.split('\n');
  const out = [];
  let cur = null;
  for (let k = 0; k < C.length; k++) {
    const c0 = C[k][0];
    const starts = c0 !== undefined && !/[\s}\])]/.test(c0);
    if (starts) {
      cur = { file, line: k + 1, name: '', head: L[k].trim().slice(0, 90), text: '', orig: '' };
      const m = L[k].match(/^(?:async\s+)?function\s*\*?\s*([\w$]+)/) || L[k].match(/^(?:export\s+)?(?:const|let|var)\s+([\w$]+)/);
      if (m) cur.name = m[1];
      out.push(cur);
    }
    if (cur) { cur.text += C[k] + '\n'; cur.orig += L[k] + '\n'; }
  }
  return out;
}

const REG_DIRECT = [
  [/\bPTG\s*\.\s*(masters|mdb|ob|press|freeze|shopProd|qc)\b/g, 1],
  [/\bPT\s*\.\s*(cut|base)\b/g, 1],
];
const peekFree = t => t.replace(/typeof\s+ptPeek\s*===\s*'\s*'\s*\?\s*ptPeek\([^)]*\)\s*:\s*(?:\(\s*typeof\s+PTG\s*!==\s*'\s*'\s*\?\s*PTG\[\w+\]\s*:\s*undefined\s*\)|(?:PTG|PT)\s*\.\s*\w+|(?:PTG|PT)\s*\[\s*\w+\s*\])/g, ' ');
/** Registers a piece names directly. A piece that goes through a dynamic key (PTG[x], PT[x]) says so as '?'. */
function directRegs(text) {
  const s = new Set();
  /* "Is it there? Then use it" reads go through ptPeek (core/gates.js), which never asks for a register: the field read that
   * sits behind it as the fallback for a page without the gates is not a read of the screen. */
  text = text.replace(/typeof\s+ptPeek\s*===\s*'\s*'\s*\?\s*ptPeek\([^)]*\)\s*:\s*(?:\(\s*typeof\s+PTG\s*!==\s*'\s*'\s*\?\s*PTG\[\w+\]\s*:\s*undefined\s*\)|(?:PTG|PT)\s*\.\s*\w+|(?:PTG|PT)\s*\[\s*\w+\s*\])/g, ' ');
  REG_DIRECT.forEach(([re]) => { re.lastIndex = 0; let m; while ((m = re.exec(text))) s.add(m[1]); });
  /* Job Work and Cutting load through ptLoad('base' | 'cut', …) (core/database-read.js), which writes PT[which]. */
  { const re = /\bptLoad\s*\(\s*['"](cut|base)['"]/g; let m; while ((m = re.exec(text))) s.add(m[1]); }
  /* A dynamic key (PTG[x]) cannot be followed: it counts as every register, so it can never hide one. The generic loader itself is the one exception. */
  if (/\bPTG\s*\[|\bPT\s*\[\s*(?!['"]?(?:mdb|err|at|busy)\b)/.test(text) && !/^(?:async\s+)?function\s+ptLoad\b/.test(text.trim())) ALL.forEach(r => s.add(r));
  return s;
}

/** Names a piece declares for itself (variables, parameters, inner functions): a mention of one of these is not a call to a top-level function of the same name. */
function localNames(text) {
  const s = new Set();
  let m;
  const decl = /\b(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[\w$]+)/g;
  while ((m = decl.exec(text))) m[1].replace(/[{}\[\]]/g, ' ').split(/[\s,]+/).forEach(x => { const q = x.split(':').pop().split('=')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(q)) s.add(q); });
  const params = /function\s*[\w$]*\s*\(([^)]*)\)|\(([^()]*)\)\s*=>|\b([A-Za-z_$][\w$]*)\s*=>|\bcatch\s*\(\s*([\w$]+)\s*\)/g;
  while ((m = params.exec(text))) (m[1] || m[2] || m[3] || m[4] || '').replace(/[{}\[\]]/g, ' ').split(/[\s,]+/).forEach(x => { const q = x.split('=')[0].replace('...', '').trim(); if (/^[A-Za-z_$][\w$]*$/.test(q)) s.add(q); });
  return s;
}

/** Build the graph over a { 'core/x.js': text } tree. extra = more pieces (a planted fake screen). */
function build(tree, extra) {
  const all = [];
  Object.keys(tree).forEach(f => pieces(f, tree[f]).forEach(p => all.push(p)));
  (extra || []).forEach(e => pieces(e.file, e.text).forEach(p => all.push(p)));
  const byName = new Map();
  all.forEach(p => { if (p.name) { if (!byName.has(p.name)) byName.set(p.name, []); byName.get(p.name).push(p); } });
  all.forEach(p => {
    p.regs = directRegs(p.text);
    /* A gate waits for the whole set before touching anything. */
    /* A gate asks for the whole set BEFORE its first mention of any register. */
    { const g = p.text.search(/\bptNeed\s*\(\s*PTG_ALL\b|\bptNeedAll\s*\(|\bptLoadGates\s*\(/);
      const first = (() => { let best = -1; REG_DIRECT.forEach(([re]) => { re.lastIndex = 0; const m = re.exec(peekFree(p.text)); if (m && (best < 0 || m.index < best)) best = m.index; }); return best; })();
      p.gate = g >= 0 && (first < 0 || g < first); }
    p.calls = new Set();
    const local = localNames(p.text);
    const re = /(?<![\w$.]|\.\.)([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(p.text))) {
      const t = byName.get(m[1]);
      if (!t || local.has(m[1])) continue;
      /* an object key (a: 1, b: 2) is a label, not a call */
      const before = p.text.slice(Math.max(0, m.index - 40), m.index), after = p.text.slice(m.index + m[1].length, m.index + m[1].length + 3);
      if (/[{,]\s*$/.test(before) && /^\s*:(?!:)/.test(after)) continue;
      t.forEach(q => { if (q !== p) p.calls.add(q); });
    }
  });
  return { all, byName };
}

/** What the pieces named by `entries` reach. entries: function names, or a RegExp matched against a piece's first line, or { file } for every piece of one file.
 *  Returns { regs: Set, via: Map(reg -> chain of "name (file:line)") }. */
function reach(g, entries) {
  const start = g.all.filter(p => entries.some(e => (e instanceof RegExp ? e.test(p.head) : typeof e === 'object' ? p.file === e.file : p.name === e)));
  /* An entry named outright is charged for what it reaches even if it asks for the whole set (the whole set IS its declared set);
   * an entry found by a pattern (a button handler) is a gate like any other piece. */
  const named = new Set(start.filter(p => entries.includes(p.name)));
  const seen = new Map(), via = new Map(), regs = new Set(), gates = [];
  const label = p => (p.name || p.head.slice(0, 40)) + ' (' + p.file + ':' + p.line + ')';
  const queue = [];
  start.forEach(p => { seen.set(p, [label(p)]); queue.push(p); });
  while (queue.length) {
    const p = queue.shift();
    const chain = seen.get(p);
    /* The loader itself (core/gates.js) is not a screen: asking for registers is what it is for. */
    if (p.file === 'core/gates.js') continue;
    /* A gate is a stopping place: it loads everything first, so neither it nor what it calls is charged. */
    if (p.gate && !named.has(p)) { gates.push(label(p)); continue; }
    p.regs.forEach(r => { regs.add(r); if (!via.has(r)) via.set(r, chain); });
    p.calls.forEach(q => { if (!seen.has(q)) { seen.set(q, chain.concat(label(q))); queue.push(q); } });
  }
  return { regs, via, start, gates };
}

function readTree(APP) {
  const tree = {};
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(p, r); else if (e.name.endsWith('.js')) tree[r] = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    }
  })(APP, '');
  return tree;
}

module.exports = { build, reach, readTree, blank, pieces, REGS, ALL };
