/* ================= CORE · SETTINGS: the Settings screen, and saving the Access form =================
 * Screens: Settings (settingsCard), opened by the sidebar's Settings button, and the Access card inside
 * it (accessCard, admins only).
 * Does: opens the Settings pane (the toggleSettings handler). For the Access card: warns when the Vendor
 * Portal is ticked together with other sections (accessVendCheck), keeps the counts and that warning
 * current as boxes are ticked, and saves one person's rights to Firestore perms/{email} and to the
 * factory database's copy (the accessSave handler). loadSettings reads settings/default into SET and
 * fills the Settings fields; readSettings reads them back. The Settings fields' own Save button is wired
 * in research/fee-tables.js.
 * Main functions: accessVendCheck, loadSettings, readSettings, and the toggleSettings / accessSave handlers. */

/* ---------- settings ---------- */
// The Settings button: hide every tab pane, show the Settings pane and, for an admin, the Access card freshly loaded.
$('toggleSettings').onclick = () => {
  TABS.forEach(t => {
    $('pane' + capId(t)).classList.add('hide');
    $('tab' + capId(t)).classList.remove('on');
  });
  $('noAccess').classList.add('hide');
  $('settingsCard').classList.remove('hide');
  // The Access panel lives with Settings and only exists for admins.
  $('accessCard').classList.toggle('hide', !ME.admin);
  if (ME.admin) {
    accessTabBoxes();
    loadAccessList();
  }
  $('toggleSettings').classList.add('on');
  $('pageTitle').textContent = 'Settings';
  if (NARROW()) setNavOpen(false, false);
};

/* Two things a vendor grant gets wrong, and both are silent.
 *
 * The first is that ticking the portal does not make an account a VENDOR — that is a separate step,
 * on the Printers screen, and without it the portal has no orders to show and the tab takes itself
 * away again.
 *
 * The second is that any OTHER section ticked alongside it is shown to an outside firm. Replenishment
 * is the one that hurts: it is the planning board, with every SKU, every reorder and the revenue
 * behind them.
 */
// Show or hide the vendor warning under the Access cards, from what is ticked right now.
function accessVendCheck() {
  const el = $('accessVendWarn');
  if (!el) return;
  // --- what is ticked ---
  const ticked = [...$('accessGroups').querySelectorAll('.repltab')].filter(c => c.checked);
  const hasVend = ticked.some(c => c.dataset.rt === 'vend');
  const others = ticked.filter(c => c.dataset.rt !== 'vend');
  const all = $('accessRepl').checked;
  if (!hasVend) {
    el.classList.add('hide');
    el.innerHTML = '';
    return;
  }
  // --- the warning, in up to two parts ---
  const bits = [];
  bits.push('<b>Vendor Portal is ticked.</b> That says this account may OPEN the portal. It does not '
    + 'make it a vendor — that link is made in the Replenishment app under <b>Vendor Orders → '
    + 'Printers</b>, with <b>Set up</b> on that firm’s row. Without it the portal has no orders to '
    + 'show and says so.');
  if (all) {
    bits.push('<b>&ldquo;Replenishment app&rdquo; is also ticked above, which grants every section.</b> '
      + 'If this account belongs to an outside firm, untick it and leave only Vendor Portal below.');
  } else if (others.length) {
    /* ONCE THE ACCOUNT IS A REAL VENDOR, THE OTHER SECTIONS DO NOTHING. Every one of them reads
     * something the database refuses a vendor, so the app shows them the portal alone rather than a
     * row of tabs that can only say "permission denied" with their name on it. */
    bits.push('It is ticked <b>together with '
      + others.map(c => '&ldquo;' + c.parentElement.textContent.trim().split('\n')[0] + '&rdquo;').join(', ')
      + '</b>. Once this account is linked to a firm, <b>those sections will not open for them</b> — '
      + 'every one reads the whole factory\u2019s records, which the database refuses a vendor, so the '
      + 'app shows them the Vendor Portal alone. <b>A printer\u2019s own history is already in the '
      + 'portal</b>, on its &ldquo;What I have sent&rdquo; tab: what they sent, what was accepted, and '
      + 'what was short. Ticking History here does not give them that \u2014 it is the factory\u2019s '
      + 'screen, showing every printer at once.'
      + (others.some(c => c.dataset.rt === 'repl')
        ? ' And Replenishment is the planning board — every SKU, what is running out, and the revenue behind it.'
        : ''));
  }
  el.innerHTML = bits.join('<br><br>');
  el.classList.remove('hide');
}
// Any box on the cards ticked or unticked: refresh the counts and the vendor warning.
$('accessGroups').addEventListener('change', () => {
  accessCounts();
  accessVendCheck();
});
// A change in the Admin / "Replenishment app" boxes at the top of the Access card (accg-top) recounts the cards.
$('accessCard').addEventListener('change', e => {
  if (e.target && e.target.closest && e.target.closest('.accg-top')) accessCounts();
});
// A card's "All" / "None" button ticks or clears every box on that card.
$('accessGroups').addEventListener('click', e => {
  const btn = e.target.closest('.accg-all, .accg-none');
  if (!btn) return;
  const on = btn.classList.contains('accg-all');
  btn.closest('.accg').querySelectorAll('.accg-boxes input').forEach(c => { c.checked = on; });
  accessCounts();
  accessVendCheck();
});
// Ticking "Replenishment app" (every section) changes what the vendor warning has to say.
$('accessRepl').addEventListener('change', accessVendCheck);

// Clear: empty the form.
$('accessClear').onclick = () => fillAccessForm(null);
// Save access: read the form, refuse the obvious mistakes, then write perms/{email} and the factory database's copy.
$('accessSave').onclick = async () => {
  // --- read the form ---
  const email = $('accessEmail').value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    $('accessMsg').textContent = 'Enter a valid email address.';
    return;
  }
  const tabs = [...$('accessGroups').querySelectorAll('[data-tab]')].filter(c => c.checked).map(c => c.dataset.tab);
  const admin = $('accessAdmin').checked;
  const replTabs = [...$('accessGroups').querySelectorAll('.repltab')].filter(c => c.checked).map(c => c.dataset.rt);
  // Only a section that actually reads Firestore turns the flag on. A factory-only grant leaves it
  // off, exactly as the production-tracker accounts were granted by hand.
  const repl = $('accessRepl').checked || replTabs.some(t => !FACTORY_SECTIONS.includes(t));
  const prod = $('accessProd').checked;
  // --- refuse the obvious mistakes ---
  if (!admin && !tabs.length && !repl && !prod && !replTabs.length && !$('accessEmpEdit').checked) {
    $('accessMsg').textContent = 'Tick at least one section, or Admin.';
    return;
  }
  // Losing your own admin rights would leave nobody able to grant them back.
  if (email === ME.email && !admin) {
    $('accessMsg').textContent = 'You cannot remove your own admin rights.';
    return;
  }
  try {
    // --- the extra rights, one checkbox each ---
    // replProj = may CHANGE the monthly projections (everyone with app access can still see them).
    const replProj = $('accessReplProj').checked;
    // prodEdit = may CHANGE an existing production entry. Adding one needs no right beyond the tab.
    const prodEdit = $('accessProdEdit').checked;
    // fgiEdit = may CHANGE finished goods — add, edit, delete, one or many. The tab alone is view only.
    const fgiEdit = $('accessFgiEdit').checked;
    // fgiEntry = may ADD a stock entry (receive, issue, send to FBA) and nothing more.
    const fgiEntry = $('accessFgiEntry').checked;
    /* rateApprove = may make a proposed vendor rate COUNT. Proposing one needs no right beyond the
     * rate list; until it is approved it prices nothing. */
    const rateApprove = $('accessRateApprove').checked;
    /* shopAssign = may give a Shopify line to a printer. The line then appears in that printer's own
     * portal and in nobody else's, which is why it is a grant rather than a convenience. */
    const shopAssign = $('accessShopAssign').checked;
    /* b2bAssign = may give a line in the factory's own order book to a printer. Separate from
     * shopAssign: the two queues are worked by different people, and running the book off the
     * Shopify grant meant handing somebody the Shopify queue to let them do B2B. */
    const b2bAssign = $('accessB2bAssign').checked;
    /* The four places that moved stock or money with nothing in front of them, and the accessories
     * split that mirrors Finished Goods: recording is the daily work, editing is correcting it. */
    const accEntry = $('accessAccEntry').checked;
    const accEdit = $('accessAccEdit').checked;
    const mdbEdit = $('accessMdbEdit').checked;
    const soApprove = $('accessSoApprove').checked;
    const vlogAccept = $('accessVlogAccept').checked;
    /* vreqApprove = may approve a vendor order request, which is what puts work on a vendor's portal. */
    const vreqApprove = $('accessVreqApprove').checked;
    /* rfdApprove = may allow a printer MORE cloth than their order covers. Inside the order nobody
     * is asked, so this right is only ever about the exceptions.
     * rfdSend    = may record cloth actually going out. The store's job, not the approver's. */
    const rfdApprove = $('accessRfdApprove').checked;
    const rfdSend = $('accessRfdSend').checked;
    /* attendMark = may punch people in and out. Reading the register needs only the section. */
    const attendMark = $('accessAttend').checked;
    /* empEdit = may add AND delete employees. On its own it opens the Employee list and nothing else. */
    const empEdit = $('accessEmpEdit').checked;
    // Both ticked means the same as neither, so it is stored as "no restriction" — a saved list of
    // both brands would look like a rule that had been thought about when it is simply the default.
    let brands = [...document.querySelectorAll('.accbrand')].filter(c => c.checked).map(c => c.dataset.br);
    if (brands.length === 2) brands = [];
    // --- save: perms/{email} in Firestore, then the factory database's copy ---
    const rights = {
      admin, approve: $('accessApprove').checked, repl, replTabs, replProj, prodEdit, fgiEdit, fgiEntry, rateApprove,
      shopAssign, b2bAssign, accEntry, accEdit, mdbEdit, soApprove, vlogAccept,
      vreqApprove, rfdApprove, rfdSend, attendMark, empEdit, prod, tabs, brands };
    await setDoc(doc(db, 'perms', email), Object.assign({}, rights, { at: serverTimestamp(), by: ME.email }));
    /* AND THE DATABASE'S COPY. A failure here is said out loud and not swallowed: the screen would
     * show a right the database does not honour, and the person would be refused with no reason. */
    let mirrorErr = '';
    try { await permMirror(email, rights); } catch (e) { mirrorErr = e.message || String(e); }
    // --- say what was saved ---
    const factoryOnly = replTabs.length && !repl;
    $('accessMsg').textContent = `Saved. ${email} ${admin ? 'is an admin.' : 'now has what the list below shows.'}`
      + (factoryOnly ? ' Factory sections only, so this account reads nothing else in Firestore —'
        + ' no replenishment data, no purchase orders, no backend key.' : '')
      + (replTabs.includes('vend') ? ' The Vendor Portal shows that person only their own vendor\u2019s orders.' : '')
      + (brands.length ? ` · ${brands.map(b => BRAND_NAME[b]).join(' and ')} only.` : '');
    if (mirrorErr) $('accessMsg').textContent = 'SAVED HERE, BUT NOT IN THE PRODUCTION DATABASE — ' + mirrorErr
      + '. Until it is, the factory app will refuse ' + email + ' what this screen says they have. Press Save again.';
    fillAccessForm(null);
    loadAccessList();
  } catch (e) {
    $('accessMsg').textContent = 'Could not save: ' + (e.message || e);
  }
};

/* ---------- the Settings fields ---------- */
// Read settings/default over the defaults into SET, then fill the Settings fields, the category and size-tier
// tables and the New Product form's defaults.
async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'default'));
    SET = snap.exists() ? { ...DEFAULTS, ...snap.data() } : { ...DEFAULTS };
  } catch { SET = { ...DEFAULTS }; }
  KEYS.forEach(k => $('s_' + k).value = SET[k]);
  drawCats(SET.cats && SET.cats.length ? SET.cats : DEF_CATS);
  drawTiers(SET.tiers && SET.tiers.length ? SET.tiers : DEF_TIERS);
  fillNewDefaults();
  noteMult();
}
// The Settings fields as a settings object — a field that is not a number falls back to its default — plus the
// category and size-tier tables as drawn.
function readSettings() {
  const settings = {};
  KEYS.forEach(k => {
    const num = parseFloat($('s_' + k).value);
    settings[k] = isNaN(num) ? DEFAULTS[k] : num;
  });
  settings.cats = readCats();
  settings.tiers = readTiers();
  return settings;
}

