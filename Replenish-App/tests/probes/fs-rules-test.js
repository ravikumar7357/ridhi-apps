/* Play the LIVE firestore.rules source through the Firebase Rules test API with mocked perms docs. */
const fs = require('fs'), https = require('https'), pathm = require('path');
const FTL = 'C:/Users/ravik/AppData/Roaming/npm/node_modules/firebase-tools/lib/';
const PROJ = 'price-research-48ff3';
const src = fs.readFileSync('C:/AMAZON/Amazon Inventory/Pricing-App/firestore.rules', 'utf8');
const DB = `/databases/(default)/documents`;
const who = {
  vendor: { email: 'v@x.com', perms: { admin: false, repl: true, replTabs: ['vend'] } },
  shopOnly: { email: 's@x.com', perms: { admin: false, repl: true, replTabs: ['shop', 'adj', 'shopprod'] } },
  planner: { email: 'p@x.com', perms: { admin: false, repl: true, replTabs: ['shop', 'prod'] } },
  oldGrant: { email: 'o@x.com', perms: { admin: false, repl: true } },
  admin: { email: 'a@x.com', perms: { admin: true } },
  nobody: { email: 'n@x.com', perms: null },
};
const cases = [
  ['vendor', 'get', 'repl/SP', false], ['vendor', 'get', 'replrows/SP_0', false], ['vendor', 'get', 'replslim/SP', true],
  ['vendor', 'get', 'repl/projoverride', false], ['vendor', 'get', 'repl/revtarget', false],
  ['shopOnly', 'get', 'repl/SP', false], ['shopOnly', 'get', 'replrows/CPC_1', false], ['shopOnly', 'get', 'replslimrows/SP_0', true],
  ['shopOnly', 'get', 'repl/prodstatus', true], ['shopOnly', 'update', 'replslim/SP', false],
  ['planner', 'get', 'repl/SP', true], ['planner', 'get', 'replrows/SP_0', true], ['planner', 'update', 'replslimrows/SP_0', true],
  ['planner', 'get', 'repl/revtarget', true],
  ['oldGrant', 'get', 'repl/SP', true], ['admin', 'get', 'replrows/SP_0', true], ['admin', 'update', 'repl/SP', true],
  ['nobody', 'get', 'replslim/SP', false], ['nobody', 'get', 'repl/SP', false],
];
(async () => {
  const cfg = JSON.parse(fs.readFileSync(pathm.join(process.env.USERPROFILE, '.config/configstore/firebase-tools.json'), 'utf8'));
  const tok = await require(FTL + 'auth').getAccessToken(cfg.tokens.refresh_token, []); const at = tok.access_token || tok;
  const testCases = cases.map(([w, method, path, allow]) => {
    const u = who[w]; const pp = `${DB}/perms/${u.email}`;
    return {
      request: { auth: { uid: 'u-' + w, token: { email: u.email } }, method, path: `${DB}/${path}`, time: new Date().toISOString(),
        ...(method === 'update' ? { resource: { data: {} } } : {}) },
      resource: { data: {} },
      functionMocks: [
        { function: 'exists', args: [{ exactValue: pp }], result: { value: !!u.perms } },
        { function: 'exists', args: [{ anyValue: {} }], result: { value: false } },
        { function: 'get', args: [{ exactValue: pp }], result: u.perms ? { value: { data: u.perms } } : { undefined: {} } },
        { function: 'get', args: [{ anyValue: {} }], result: { undefined: {} } },
      ],
      expectation: allow ? 'ALLOW' : 'DENY',
    };
  });
  const body = JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: src }] }, testSuite: { testCases } });
  const res = await new Promise((ok, no) => { const r = https.request(`https://firebaserules.googleapis.com/v1/projects/${PROJ}:test`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json', 'x-goog-user-project': PROJ } },
    x => { let d = ''; x.on('data', c => d += c); x.on('end', () => ok(JSON.parse(d))); }); r.on('error', no); r.write(body); r.end(); });
  if (!res.testResults) { console.log(JSON.stringify(res).slice(0, 800)); process.exit(1); }
  let bad = 0;
  res.testResults.forEach((t, i) => { const [w, m, p, a] = cases[i]; const pass = t.state === 'SUCCESS'; if (!pass) bad++;
    console.log(`  ${pass ? 'ok  ' : 'FAIL'}  ${w.padEnd(9)} ${m.padEnd(6)} ${p.padEnd(22)} expect ${a ? 'ALLOW' : 'DENY '}${pass ? '' : '  ' + JSON.stringify(t.debugMessages || t.errorPosition || '').slice(0, 200)}`); });
  console.log(bad ? bad + ' FAILED' : 'all ' + cases.length + ' as expected'); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
