/* Phase 1, step 1: Meera's files ask the bridge (core/meera-bridge.js) instead of reaching into the ERP.
 * Every replacement must be found exactly once; the golden answers must not change. */
const fs = require('fs'), path = require('path');
const CORE = path.join(__dirname, '..', '..', 'Replenish-App', 'src', 'app', 'core');
function edit(file, pairs) {
  const f = path.join(CORE, file);
  let s = fs.readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${file}: found ${n} times: ${a.slice(0, 80)}`);
    s = s.replace(a, () => b);
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) throw new Error('control character in ' + file);
  fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
  console.log('  ' + file + ': ' + pairs.length + ' changed');
}

edit('guide-ai.js', [
  ["  try { return !!GA_AI_URL && typeof auth !== 'undefined' && !!(auth && auth.currentUser); } catch (e) { return false; }",
   "  try { return !!GA_AI_URL && ERP_MEERA.signedIn(); } catch (e) { return false; }"],
  ["  try { return (PTE.emp || []).map(e => String(e[1] || '').trim()).filter(n => n.length >= 3); } catch (e) { return []; }",
   "  try { return ERP_MEERA.people().filter(n => n.length >= 3); } catch (e) { return []; }"],
  ["  const tok = await auth.currentUser.getIdToken();",
   "  const tok = await ERP_MEERA.token();"],
]);

edit('guide-ask.js', [
  ["  const tab = typeof TAB_NOW !== 'undefined' ? TAB_NOW : '';\n  const acts = [];",
   "  const tab = ERP_MEERA.screen();\n  const acts = [];"],
  ["  try { return new Set((PTE.emp || []).flatMap(e => String(e[1] || '').toLowerCase().split(/\\s+/).filter(w => w.length >= 3))); }",
   "  try { return new Set(ERP_MEERA.people().flatMap(n => n.toLowerCase().split(/\\s+/).filter(w => w.length >= 3))); }"],
  ["    if (sc && typeof TAB_NOW !== 'undefined' && g.sec === TAB_NOW) sc += 1;",
   "    if (sc && g.sec === ERP_MEERA.screen()) sc += 1;"],
  ["  return typeof TAB_NOW !== 'undefined' ? TAB_NOW : '';\n}",
   "  return ERP_MEERA.screen();\n}"],
  ["  if (tab === 'mywork' && typeof frHomeShow === 'function') frHomeShow(); else showTab(tab);",
   "  if (tab === 'mywork' && typeof frHomeShow === 'function') frHomeShow(); else ERP_MEERA.openScreen(tab);"],
  ["    if (!ME || ME.admin || !ME.tabs || !ME.tabs.length) return true;\n    return ME.tabs.includes(tab) || (tab === 'shop' && ME.tabs.includes('shopret')) || (tab === 'ord' && ME.tabs.includes('shopprod'));",
   "    const me = ERP_MEERA.user();\n    if (me.admin || !me.tabs.length) return true;\n    return me.tabs.includes(tab) || (tab === 'shop' && me.tabs.includes('shopret')) || (tab === 'ord' && me.tabs.includes('shopprod'));"],
]);

edit('guide-walks.js', [
  ["  if (!t || (t.admin && typeof ME !== 'undefined' && ME && !ME.admin)) return null;",
   "  if (!t || (t.admin && !ERP_MEERA.user().admin)) return null;"],
  ["  try { signedIn = typeof auth !== 'undefined' && !!(auth && auth.currentUser); } catch (e) { /* not signed in yet */ }",
   "  try { signedIn = ERP_MEERA.signedIn(); } catch (e) { /* not signed in yet */ }"],
  ["  try { if (typeof spIsVendor === 'function' && spIsVendor()) return; } catch (e) { /* not known: go on */ }",
   "  try { if (ERP_MEERA.user().vendor) return; } catch (e) { /* not known: go on */ }"],
]);

edit('guide.js', [
  ["function guideKey(k) { return k + ':' + ((typeof ME !== 'undefined' && ME && ME.email) || 'anon'); }",
   "function guideKey(k) { return k + ':' + (ERP_MEERA.user().email || 'anon'); }"],
  ["  const host = $('topActs'), phone = typeof mobOn === 'function' && mobOn() && $('mobHead');",
   "  const host = $('topActs'), phone = ERP_MEERA.phone() && $('mobHead');"],
  ["  $('gdShow').onclick = () => guideStart(typeof gaHere === 'function' ? gaHere() : typeof TAB_NOW !== 'undefined' ? TAB_NOW : '', true);",
   "  $('gdShow').onclick = () => guideStart(typeof gaHere === 'function' ? gaHere() : ERP_MEERA.screen(), true);"],
  ["    if (typeof TAB_NOW !== 'undefined' && TAB_NOW !== tab) return;",
   "    if (ERP_MEERA.screen() !== tab) return;"],
  ["    if (typeof mobOn === 'function' && mobOn()) st.splice(",
   "    if (ERP_MEERA.phone()) st.splice("],
  ["    if (s.tab && typeof TAB_NOW !== 'undefined' && TAB_NOW !== s.tab) {",
   "    if (s.tab && ERP_MEERA.screen() !== s.tab) {"],
  ["      if (!s._went) { s._went = true; showTab(s.tab);",
   "      if (!s._went) { s._went = true; ERP_MEERA.openScreen(s.tab);"],
  ["  GUIDE.tour = { kind: 'tour', tab: typeof TAB_NOW !== 'undefined' ? TAB_NOW : '', steps: [{",
   "  GUIDE.tour = { kind: 'tour', tab: ERP_MEERA.screen(), steps: [{"],
  /* the ERP tells her a screen opened through the bridge now (nav.js) */
  ["/** Called by showTab (nav.js) every time a screen opens.",
   "ERP_MEERA.on('screen', tab => guideScreen(tab));\n/** Called through the bridge (nav.js → meeraBridgeEmit('screen', tab)) every time a screen opens."],
]);

/* the ERP side: nav.js announces the screen through the bridge instead of calling Meera by name */
{
  const f = path.join(CORE, 'nav.js');
  let s = fs.readFileSync(f, 'utf8'); const crlf = s.includes('\r\n'); s = s.replace(/\r\n/g, '\n');
  const a = "  try { guideScreen(which); } catch (e) { /* the guide character (guide.js) is not on the page yet — the screen still opens */ }";
  if (s.split(a).length !== 2) throw new Error('nav.js hook not found');
  s = s.replace(a, () => "  try { meeraBridgeEmit('screen', which); } catch (e) { /* Meera (through her bridge) is not on the page yet — the screen still opens */ }");
  fs.writeFileSync(f, crlf ? s.replace(/\n/g, '\r\n') : s);
  console.log('  nav.js: 1 changed');
}

/* the bridge joins the page right after the switches, before Meera's own files */
{
  const f = path.join(CORE, '..', 'ORDER');
  let s = fs.readFileSync(f, 'utf8'); const nl = s.includes('\r\n') ? '\r\n' : '\n';
  if (!s.includes('core/meera-bridge.js')) {
    const a = 'core/meera-switches.js' + nl;
    if (s.split(a).length !== 2) throw new Error('ORDER: switches line not found');
    s = s.replace(a, a + 'core/meera-bridge.js' + nl);
    fs.writeFileSync(f, s);
  }
  const b = path.join(CORE, 'meera-bridge.js');
  fs.writeFileSync(b, fs.readFileSync(b, 'utf8').replace(/\r?\n/g, '\r\n'));
  console.log('  ORDER: bridge added');
}
