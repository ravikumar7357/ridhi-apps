/* ----- admin: grant and revoke ----- */
let ACCESS_ROWS = [];
$('accessPick').onchange = e => {
  const r = ACCESS_ROWS.find(x => x.email === e.target.value);
  fillAccessForm(r || null);
  if (r) $('accessEmail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};

async function loadAccessList() {
  if (!ME.admin) return;
  const box = $('accessRows');
  box.innerHTML = '<tr><td colspan="4" class="muted">Loading…</td></tr>';
  try {
    /* FROM THE SERVER ONLY (2026-09-25). getDocs falls back to the local cache when Firestore cannot be reached, and
     * an empty cache read as "Nobody has been granted access yet" while 50 people had it. A failed read now lands in
     * the catch below and says so. */
    const snap = await getDocsFromServer(collection(db, 'perms'));
    const rows = [];
    snap.forEach(d => rows.push({ email: d.id, ...d.data() }));
    rows.sort((a, b) => a.email.localeCompare(b.email));
    ACCESS_ROWS = rows;
    const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    /* The same people as the table, in a dropdown. What is being edited stays picked across a reload. */
    const pick = $('accessPick'), was = $('accessEmail').value.trim().toLowerCase();
    pick.innerHTML = '<option value="">— New person (type the email below) —</option>'
      + rows.map(r => `<option value="${esc(r.email)}">${esc(r.email)}${r.admin ? ' · Admin' : ''}</option>`).join('');
    pick.value = rows.some(r => r.email === was) ? was : '';
    box.innerHTML = rows.length ? rows.map(r => `<tr>
        <td>${esc(r.email)}</td>
        <td>${accessSummary(r)}</td>
        <td><button class="xbtn" data-edit-perm="${esc(r.email)}">Edit</button></td>
        <td><button class="xbtn" data-del-perm="${esc(r.email)}">Remove</button></td>
      </tr>`).join('')
      : '<tr><td colspan="4" class="muted">Nobody has been granted access yet.</td></tr>';
    box.querySelectorAll('[data-edit-perm]').forEach(b => b.onclick = () => fillAccessForm(rows.find(r => r.email === b.dataset.editPerm)));
    box.querySelectorAll('[data-del-perm]').forEach(b => b.onclick = async () => {
      const who = b.dataset.delPerm;
      if (who === ME.email) { $('accessMsg').textContent = 'You cannot remove your own access.'; return; }
      await deleteDoc(doc(db, 'perms', who));
      let gone = '';
      try { await permMirror(who, null); } catch (e) { gone = e.message || String(e); }
      $('accessMsg').textContent = `Removed ${who}. They keep their sign-in but can no longer see anything.`
        + (gone ? ' BUT THEIR COPY IN THE PRODUCTION DATABASE IS STILL THERE — ' + gone + '. Remove them again.' : '');
      loadAccessList();
    });
  } catch (e) {
    box.innerHTML = `<tr><td colspan="4" class="err">Could not reach the access list, so it is not shown — nobody's access has changed. `
      + `This usually means Firestore cannot be reached from this network right now; try again in a moment, or from another connection. `
      + `<span class="muted">(${String(e && (e.code || e.message) || e).replace(/[<>&]/g, '')})</span></td></tr>`;
  }
}

/* The FBA Replenishment app's sections. Its own REPL_TABS lives in a DIFFERENT FILE (Replenish-App),
 * and there is no way for one to check the other at runtime — so this list is the thing to update the
 * moment a section is added there. A key here that does not exist there simply never matches; a
 * section there with no key here CANNOT BE GRANTED AT ALL, which is the failure that actually
 * happened: Article Review had no checkbox, so nobody could be given it, and the sidebar button
 * appeared anyway and did nothing when clicked. */
/* The factory sections read the production tracker's own database over REST and need NOTHING from
 * Firestore. That distinction is not cosmetic: perms.repl is what canRepl() checks, and canRepl()
 * grants read AND WRITE on repl/*, replrows/*, po/*, packlist/* and READ of config/api — the Amazon
 * backend key. An outside printer holding only the Vendor Portal must never pick that up on the way
 * past, which is what happened while any ticked section set the flag. */
const FACTORY_SECTIONS = ['pmdb', 'mst', 'pbase', 'pcut', 'ppress', 'qc', 'qcalt', 'qcret', 'ord', 'so', 'vord', 'vreq', 'rfd', 'att',
  'vend', 'cx', 'fgi', 'fba', 'fab', 'acc', 'rep', 'pa', 'ka', 'hr',
  /* History and Printer Allocation were missing, so ticking History alone set perms.repl — and with it
   * the Amazon backend key and the replenishment snapshot. Found 2026-09-21 on a vendor login. */
  'vlog', 'palloc'];

const REPL_SECTIONS = [
  ['repl', 'Replenishment'], ['article', 'Article Review'], ['target', 'Revenue Target'],
  // 'follow' and 'india' were removed from the Replenishment app on 08 Sep 2026. A checkbox for a
  // section that no longer exists grants nothing and only invites the question.
  ['top', 'Top ASIN Status'],
  // 'prod' (In Production) was removed on 22 Sep 2026, for the same reason.
  ['shopify', 'Shopify Stock (reorder)'],
  ['pack', 'Packing List'],
  // Shopify Orders and Adjustments now LIVE in the Replenishment app. Listed here so access to them
  // can still be granted from this screen, which is where all access is granted.
  ['shop', 'Shopify Orders'], ['adj', 'Adjustments'],
  /* THE ORDER CONSOLE, SHOPIFY ONLY. Same screen as 'ord' below, with the factory's own order book
   * neither offered nor reachable — every AMZ and B2B order stays shut. Tick this one OR 'Order
   * Console', not both: with both, the account has the whole book. */
  ['shopprod', 'Order Console — Shopify orders only'],
  ['pmdb', 'Master Database'],
  ['mst', 'Masters (article types, colours, sizes)'], ['pbase', 'Job Work Register'], ['pcut', 'Cutting Data'],
  ['ppress', 'Press Inventory'],
  /* THREE JOBS, THREE GRANTS. Inspecting what came back, sending the rejects out for alteration and
   * taking them back are done by different people; one checkbox meant giving somebody all three to
   * let them do one. Every account that already had Quality Control was given all three, so nobody
   * lost anything in the split. */
  ['qc', 'Quality Control \u2014 record checks'],
  ['qcalt', 'Quality Control \u2014 issue for alteration'],
  ['qcret', 'Quality Control \u2014 receive back from alteration'],
  ['ord', 'Order Console — every order'],
  ['so', 'Sales Orders'],
  ['vord', 'Vendor Orders'],
  /* Raise a request for any vendor — printing, embroidery, filling — and follow it to delivery. It
   * reaches the vendor only once somebody with "Can approve vendor order requests" says yes. */
  ['vreq', 'Vendor Order Requests (raise, and follow the work)'],
  /* What cloth each printer says they need against the order they are printing. Printers raise these
   * in their own portal; anything inside what the order covers is already agreed, and the rest waits
   * for somebody with "Can approve RFD requirements". */
  ['rfd', 'RFD Requirements (what each printer needs in cloth)'],
  ['vend', 'Vendor Portal (the vendor\u2019s own view)'],
  ['vlog', 'History (what printers have sent)'],
  /* Which printer gets which colour: the work each design owes, grouped by colour, against each
   * printer's capacity and the blocks they hold. Editing needs "Can edit production data". */
  ['palloc', 'Printer Allocation (colour groups, capacity and blocks)'],
  /* On its own, view only. Entering, editing and deleting need "Can edit finished goods" below. */
  ['fgi', 'Finished Goods'],
  /* What the store sends to FBA: the FBA team accepts it, ships it, or returns it to the store. */
  ['fba', 'FBA Dispatch (accept, ship or return what the store sent)'],
  ['fab', 'Fabric Inventory'],
  ['acc', 'Accessories'],
  ['rep', 'Reports'],
  ['pa', 'Production Analysis'],
  ['ka', 'Karigar Analysis'],
  ['att', 'Attendance register'],
  ['hr', 'Finance & HR'],
];
/* WHICH CARD EACH SECTION BELONGS TO. `sellora` are this app's tabs, `repl` the Replenishment app's
 * sections. A key listed here that does not exist is skipped; a section that exists and is listed
 * nowhere lands in "Other" — never without a checkbox, which is how a section once became impossible
 * to grant. */
const ACCESS_GROUPS = [
  { key: 'shopify', sellora: ['shop', 'adj'], repl: ['shop', 'adj', 'shopify', 'shopprod'] },
  { key: 'plan', repl: ['repl', 'article', 'target', 'top', 'pack'] },
  /* The same order as the Replenishment app's sidebar, which is the order work moves through the floor. */
  { key: 'prod', repl: ['so', 'ord', 'pcut', 'pbase', 'ppress', 'qc', 'qcalt', 'qcret', 'fgi', 'fba', 'fab', 'acc', 'pmdb', 'mst', 'cx'] },
  { key: 'vendors', repl: ['vreq', 'vord', 'rfd', 'vend', 'vlog', 'palloc'] },
  { key: 'people', repl: ['att', 'hr'] },
  { key: 'reports', repl: ['rep', 'pa', 'ka'] },
  { key: 'sales', sellora: ['sales', 'profit', 'sa', 'plaudit'] },
  { key: 'listing', sellora: ['opt', 'img', 'lerr', 'basket', 'health', 'lrules', 'audit', 'bsr'] },
  { key: 'ads', sellora: ['trends', 'weekly', 'st', 'plc', 'deals'] },
  { key: 'research', sellora: ['new', 'pr', 'link', 'kw'] },
  { key: 'stock', sellora: ['age', 'tiktok', 'carousel', 'ba'] },
  { key: 'other' },
];
function accessTabBoxes() {
  const usable = TABS.filter(t => !HIDDEN_TABS.includes(t));
  const replKeys = REPL_SECTIONS.map(([k]) => k);
  const replLabel = k => (REPL_SECTIONS.find(([x]) => x === k) || [k, k])[1];
  const takenS = new Set(), takenR = new Set();
  ACCESS_GROUPS.forEach(g => {
    const s = (g.sellora || []).filter(t => usable.includes(t) && !takenS.has(t));
    const r = (g.repl || []).filter(k => replKeys.includes(k) && !takenR.has(k));
    s.forEach(t => takenS.add(t)); r.forEach(k => takenR.add(k));
    g.items = s.map(t => ['s', t, TAB_TITLE[t]]).concat(r.map(k => ['r', k, replLabel(k)]));
  });
  const other = ACCESS_GROUPS.find(g => g.key === 'other');
  other.items = other.items.concat(usable.filter(t => !takenS.has(t)).map(t => ['s', t, TAB_TITLE[t]]),
    replKeys.filter(k => !takenR.has(k)).map(k => ['r', k, replLabel(k)]));
  ACCESS_GROUPS.forEach(g => {
    const sec = document.querySelector('#accessGroups [data-accg="' + g.key + '"]');
    if (!sec) return;
    g.title = (sec.querySelector('h4') || {}).textContent || g.key;
    /* The same name in both apps — Shopify Orders, Adjustments — says which app it opens. */
    const twice = l => g.items.filter(i => i[2] === l).length > 1;
    sec.querySelector('.accg-boxes').innerHTML = g.items.map(([kind, k, label]) => {
      const shown = label + (twice(label) ? (kind === 's' ? ' <span class="muted">· Sellora</span>' : ' <span class="muted">· Replenishment app</span>') : '');
      return kind === 's'
        ? `<label class="accg-box"><input type="checkbox" data-tab="${k}"> <span>${shown}</span></label>`
        : `<label class="accg-box"><input type="checkbox" class="repltab" data-rt="${k}"> <span>${shown}</span></label>`;
    }).join('');
  });
  accessCounts();
}
/** Each card's "3 of 6", and a green edge on any card with something granted in it. */
function accessCounts() {
  document.querySelectorAll('#accessGroups .accg').forEach(sec => {
    const boxes = [...sec.querySelectorAll('.accg-boxes input')];
    const on = boxes.filter(c => c.checked).length;
    sec.querySelector('.accg-n').textContent = boxes.length ? on + ' of ' + boxes.length : '';
    sec.classList.toggle('has-on', on > 0 || [...sec.querySelectorAll('.accg-rights input')].some(c => c.checked));
    sec.querySelectorAll('.accg-all,.accg-none').forEach(b => b.classList.toggle('hide', !boxes.length));
  });
}
/** What an account can open, card by card — the same shape as the form it was granted in. */
function accessSummary(r) {
  if (r.admin) return '<b>Admin — everything</b>';
  if (!ACCESS_GROUPS[0].items) accessTabBoxes();
  const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const lines = [];
  if (r.repl && !(r.replTabs || []).length) lines.push('<b>Replenishment app</b>: everything');
  ACCESS_GROUPS.forEach(g => {
    const twice = l => (g.items || []).filter(i => i[2] === l).length > 1;
    const names = (g.items || []).filter(([kind, k]) => (kind === 's' ? (r.tabs || []) : (r.replTabs || [])).includes(k))
      .map(([kind, , l]) => l + (twice(l) ? (kind === 's' ? ' (Sellora)' : ' (Replenishment app)') : ''));
    const rights = [];
    if (g.key === 'shopify' && r.shopAssign) rights.push('assigns printers');
    if (g.key === 'plan' && r.replProj) rights.push('edits projections');
    if (g.key === 'prod' && r.prodEdit) rights.push('edits entries');
    if (g.key === 'prod' && r.b2bAssign) rights.push('assigns printers on the order book');
    if (g.key === 'prod' && r.accEdit) rights.push('edits accessories');
    else if (g.key === 'prod' && r.accEntry) rights.push('records accessory movements');
    if (g.key === 'prod' && r.mdbEdit) rights.push('edits the master database');
    if (g.key === 'prod' && r.soApprove) rights.push('approves sales orders');
    if (g.key === 'vendors' && r.vlogAccept) rights.push('accepts printer deliveries');
    if (g.key === 'prod' && r.fgiEdit) rights.push('edits finished goods');
    else if (g.key === 'prod' && r.fgiEntry) rights.push('adds stock entries');
    if (g.key === 'vendors' && r.rateApprove) rights.push('approves rates');
    if (g.key === 'vendors' && r.vreqApprove) rights.push('approves order requests');
    if (g.key === 'vendors' && r.rfdApprove) rights.push('approves RFD requirements');
    if (g.key === 'vendors' && r.rfdSend) rights.push('marks RFD fabric sent');
    if (g.key === 'people' && r.attendMark) rights.push('marks attendance');
    if (g.key === 'people' && r.empEdit) rights.push('adds and deletes employees');
    if (g.key === 'listing' && r.approve) rights.push('approves documents');
    if (g.key === 'ads' && (r.brands || []).length) rights.push((r.brands || []).map(b => BRAND_NAME[b] || b).join(' + ') + ' only');
    if (g.key === 'other' && r.prod) rights.push('old production app');
    if (names.length || rights.length) {
      lines.push('<b>' + esc(g.title || g.key) + '</b>: ' + esc(names.join(', '))
        + rights.map(x => ' <span class="st st-approved">' + esc(x) + '</span>').join(''));
    }
  });
  return lines.length ? '<div class="accsum">' + lines.join('<br>') + '</div>' : '<span class="muted">nothing</span>';
}
/* The advertising tabs, as one thing. Named here rather than typed into the click handler so the
 * set has somewhere to live when a fifth ad tab arrives. */
const AD_TABS = ['weekly', 'trends', 'st', 'plc'];
$('accessAdOnly').onclick = () => {
  $('accessGroups').querySelectorAll('[data-tab]').forEach(c => { c.checked = AD_TABS.includes(c.dataset.tab); });
  // Admin outranks every tab list there is, so leaving it ticked would hand over the whole app.
  $('accessAdmin').checked = false;
  $('accessGroups').querySelectorAll('.repltab').forEach(c => { c.checked = false; });
  $('accessRepl').checked = false;
  accessCounts();
  $('accessMsg').textContent = 'Advertising tabs ticked, everything else cleared in both apps. Now tick ONE brand in the Advertising card, then Save access.';
};

function fillAccessForm(r) {
  $('accessEmail').value = r?.email || '';
  /* The dropdown follows whoever is in the form, however they got there (Edit button, Clear, pick). */
  if ($('accessPick')) $('accessPick').value = r && ACCESS_ROWS.some(x => x.email === r.email) ? r.email : '';
  $('accessAdmin').checked = !!r?.admin;
  $('accessApprove').checked = !!r?.approve;
  $('accessRepl').checked = !!r?.repl;
  $('accessProd').checked = !!r?.prod;
  $('accessGroups').querySelectorAll('[data-tab]').forEach(c => { c.checked = !!r?.tabs?.includes(c.dataset.tab); });
  $('accessGroups').querySelectorAll('.repltab').forEach(c => { c.checked = !!r?.replTabs?.includes(c.dataset.rt); });
  $('accessReplProj').checked = !!r?.replProj;
  $('accessProdEdit').checked = !!r?.prodEdit;
  $('accessFgiEdit').checked = !!r?.fgiEdit;
  $('accessFgiEntry').checked = !!r?.fgiEntry;
  $('accessRateApprove').checked = !!r?.rateApprove;
  $('accessShopAssign').checked = !!r?.shopAssign;
  $('accessB2bAssign').checked = !!r?.b2bAssign;
  $('accessAccEntry').checked = !!r?.accEntry;
  $('accessAccEdit').checked = !!r?.accEdit;
  $('accessMdbEdit').checked = !!r?.mdbEdit;
  $('accessSoApprove').checked = !!r?.soApprove;
  $('accessVlogAccept').checked = !!r?.vlogAccept;
  $('accessVreqApprove').checked = !!r?.vreqApprove;
  $('accessRfdApprove').checked = !!r?.rfdApprove;
  $('accessRfdSend').checked = !!r?.rfdSend;
  $('accessAttend').checked = !!r?.attendMark;
  $('accessEmpEdit').checked = !!r?.empEdit;
  document.querySelectorAll('.accbrand').forEach(c => { c.checked = !!r?.brands?.includes(c.dataset.br); });
  accessVendCheck();      // loading somebody's existing access shows the same warning as ticking it
  accessCounts();
  $('accessMsg').textContent = '';
}

