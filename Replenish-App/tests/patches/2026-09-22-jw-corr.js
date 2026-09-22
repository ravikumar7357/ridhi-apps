/* Job Work correction requests: wiring. See 2026-09-22-jw-corr-code.js. */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};
const code = fs.readFileSync(__dirname + '/2026-09-22-jw-corr-code.js', 'utf8').split(CR + LF).join(LF);

one(`          <button id="pbApv" class="ghost hide">Deletion requests</button>`,
`          <button id="pbApv" class="ghost hide">Deletion requests</button>
          <button id="pbCorr" class="ghost hide" style="color:#b45309;font-weight:600" title="Changes the floor has asked for, waiting for you">Correction requests</button>`, 'queue button');

one(`<button id="tabPbase" class="nav">Job Work Register</button>`,
`<button id="tabPbase" class="nav">Job Work Register <span id="jwCorrBadge" class="navbadge hide" title="Correction requests waiting for approval" style="background:#b45309"></span></button>`, 'nav badge');

one(`      + \`<td>\${(r.frozen || !ptCanEdit()) ? '<span class="muted">—</span>'
        : \`<button class="ghost" data-bd-edit="\${esc(r.id)}" style="padding:3px 10px;font-size:12px">Edit</button>\`}</td>\``,
`      /* EDIT FOR THOSE WHO MAY, ASK FOR EVERYONE ELSE — and a row with a change waiting says so. */
      + \`<td>\${jwCorrOfRow(r.id) ? '<span class="pill pill-low" title="A change to this entry is waiting for approval">change asked</span>'
        : ptCanEdit() ? (r.frozen ? '<span class="muted">—</span>' : \`<button class="ghost" data-bd-edit="\${esc(r.id)}" style="padding:3px 10px;font-size:12px">Edit</button>\`)
        : jwCanAsk() ? \`<button class="ghost" data-jw-ask="\${esc(r.id)}" style="padding:3px 10px;font-size:12px">Ask to change</button>\`
        : '<span class="muted">—</span>'}</td>\``, 'edit cell');

one(`  if (APV === null && ME.admin) { APV = []; apvLoad(true).then(apvPaint).catch(() => {}); }
  apvPaint();`,
`  if (APV === null && ME.admin) { APV = []; apvLoad(true).then(apvPaint).catch(() => {}); }
  apvPaint();
  if (JWC.rows === null) { JWC.rows = {}; jwCorrLoad().then(() => { if (PT.base) renderPbase(); }).catch(() => {}); }
  jwCorrBadge();`, 'load on the screen');

one(`$('pbApv').onclick = apvOpenDialog;`,
`$('pbApv').onclick = apvOpenDialog;
$('pbTable').addEventListener('click', e => { const b = e.target.closest('[data-jw-ask]'); if (b) jwCorrAskOpen(b.getAttribute('data-jw-ask')); });
` + code, 'the code');

one(`  if (ME.tabs.includes('fgi') && (ME.admin || ME.fgiEdit)) fgiCorrLoad().catch(() => {});`,
`  if (ME.tabs.includes('fgi') && (ME.admin || ME.fgiEdit)) fgiCorrLoad().catch(() => {});
  /* Job Work corrections waiting: the badge is for whoever may answer them. */
  if (ME.tabs.includes('pbase') && ptCanEdit()) jwCorrLoad().catch(() => {});`, 'badge at sign-in');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
