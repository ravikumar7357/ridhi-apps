/* ---------- auth + access ---------- */
$('loginBtn').onclick = async () => {
  $('loginErr').classList.add('hide'); $('loginBtn').disabled = true;
  try { await signInWithEmailAndPassword(auth, $('email').value.trim(), $('pass').value); }
  catch (e) {
    $('loginErr').textContent = /invalid|wrong|not-found/i.test(e.code || '') ? 'Wrong email or password.' : (e.message || String(e));
    $('loginErr').classList.remove('hide');
  }
  $('loginBtn').disabled = false;
};
$('pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });

/* Sets a password by email rather than by somebody handing one out. Firebase deliberately answers the
 * same way whether or not the address has an account, so the message says "if there is an account"
 * rather than claiming one was found — which would be a guess dressed up as a fact. */
$('resetLink').onclick = async () => {
  const em = $('email').value.trim();
  const msg = $('resetMsg');
  msg.classList.remove('hide');
  if (!em) { msg.textContent = 'Type your email address above first, then press this again.'; return; }
  $('resetLink').disabled = true;
  msg.textContent = 'Sending…';
  try {
    await sendPasswordResetEmail(auth, em);
    msg.textContent = 'If there is an account for ' + em + ', a link to set a new password is on its way. Check the spam folder too.';
  } catch (e) {
    msg.textContent = /invalid-email/.test(e.code || '')
      ? 'That does not look like an email address.'
      : 'Could not send it: ' + (e.message || e);
  }
  $('resetLink').disabled = false;
};
$('logoutBtn').onclick = () => signOut(auth);

let AUTH_SEEN = false;
onAuthStateChanged(auth, async user => {
  $('loginView').classList.toggle('hide', !!user);
  $('appView').classList.toggle('hide', !user);
  /* SIGNING OUT WIPES THE PAGE. Everything the last person loaded is still in memory and in the
   * hidden screens; the next person to sign in on this tab must start from nothing. */
  if (!user) { if (AUTH_SEEN) { location.reload(); return; } document.body.classList.remove('gating'); return; }
  AUTH_SEEN = true;
  /* Raised BEFORE the perms read, lowered by ungate() on every path out of the gating — including
   * the no-access one, and including a throw. A cover that can stick is worse than no cover. */
  document.body.classList.add('gating');
  /* NO SCREEN IS SHOWN UNTIL THIS ACCOUNT'S OWN FIRST SCREEN IS CHOSEN — showTab() below opens it.
   * The data loads that come first (config, the Replenishment snapshot) happen behind hidden screens. */
  document.querySelectorAll('[id^="pane"]').forEach(el => el.classList.add('hide'));
  $('pageTitle').textContent = 'Loading…';
  ME = { email: (user.email || '').toLowerCase(), admin: false, repl: false, tabs: [], tabsExplicit: false, projEdit: false, prodEdit: false, rateApprove: false, shopAssign: false, b2bAssign: false,
    accEntry: false, accEdit: false, vlogAccept: false, soApprove: false, mdbEdit: false,
    attendMark: false, vreqApprove: false, rfdApprove: false, rfdSend: false, fgiEdit: false, fgiEntry: false, empEdit: false, hrEmpOnly: false };
  try {
    const s = await getDoc(doc(db, 'perms', ME.email));
    if (s.exists()) { const d = s.data(); ME.admin = d.admin === true; ME.repl = d.repl === true;
      // Per-section access: perms.replTabs = ['repl','follow','top']. Empty but repl=true → all (legacy).
      const rt = Array.isArray(d.replTabs) ? d.replTabs.filter(t => REPL_TABS.includes(t)) : [];
      /* Whether these sections were CHOSEN for this account or inherited as "all of them". A tab that
       * somebody deliberately ticked should explain itself when it cannot work; one that arrived as
       * part of a blanket grant should just not be there. */
      ME.tabsExplicit = rt.length > 0;
      ME.tabs = rt.length ? rt : (ME.repl ? REPL_TABS.slice() : []);
      ME.projEdit = d.replProj === true;     // separate right: may change the monthly projections
      // …and another: may CHANGE a production entry someone has already made. Entering is not editing.
      ME.prodEdit = d.prodEdit === true;
      /* …and another: may make a proposed VENDOR RATE count. A rate prices every order line it
       * matches, so proposing one and approving one are separate rights. */
      ME.rateApprove = d.rateApprove === true;
      /* …and another: may decide WHICH PRINTER a Shopify line goes to. On its own it is the whole
       * job — the person who hands work out does not need to be able to delete an entry or see
       * anybody's pay to do it. */
      ME.shopAssign = d.shopAssign === true;
      ME.b2bAssign = d.b2bAssign === true;
      ME.accEntry = d.accEntry === true;
      ME.accEdit = d.accEdit === true;
      ME.vlogAccept = d.vlogAccept === true;
      ME.soApprove = d.soApprove === true;
      ME.mdbEdit = d.mdbEdit === true;
      /* …and one more: may mark the attendance register. The person who takes attendance every
       * morning needs nothing else, and giving them everything else to do it is how a factory ends
       * up with five admins. */
      ME.attendMark = d.attendMark === true;
      /* …and: may APPROVE a vendor order request, which is what sends work to a vendor. Raising one
       * needs nothing beyond the tab. */
      ME.vreqApprove = d.vreqApprove === true;
      /* Answering an RFD requirement and handing the cloth over are two jobs. The store hands out
       * fabric; whether a printer may have more than the order covers is somebody else's call. */
      ME.rfdApprove = d.rfdApprove === true;
      ME.rfdSend = d.rfdSend === true;
      /* …and: may CHANGE the finished-goods store — make an entry, edit one, delete one or many. The
       * Finished Goods tab without it is view only. */
      ME.fgiEdit = d.fgiEdit === true;
      /* …and a narrower one: may ADD a stock entry — receive, issue, send to FBA — and nothing more. */
      ME.fgiEntry = d.fgiEntry === true;
      /* …and: may add, change and DELETE people on the employee list. It opens the Employee list on
       * its own — pay, rates and slips stay shut unless Finance & HR is granted as well. */
      ME.empEdit = d.empEdit === true; }
  } catch (e) { /* no perms = no access */ }
  /* A perms read that fails leaves ME.tabs empty, which is the correct answer — but the cover still
   * has to come off, or a denied account sits looking at nothing at all. */
  if (ME.empEdit && !ME.tabs.includes('hr')) { ME.tabs = ME.tabs.concat('hr'); ME.hrEmpOnly = true; }
  if (ME.email === 'ravi@thefabricrush.com') ME.admin = true;
  if (ME.admin) { ME.tabs = REPL_TABS.slice(); ME.projEdit = true; ME.prodEdit = true; ME.rateApprove = true; ME.shopAssign = true; ME.b2bAssign = true;
    ME.accEntry = true; ME.accEdit = true; ME.vlogAccept = true; ME.soApprove = true; ME.mdbEdit = true; ME.attendMark = true; ME.vreqApprove = true; ME.rfdApprove = true; ME.rfdSend = true; ME.fgiEdit = true; ME.fgiEntry = true; ME.empEdit = true; ME.hrEmpOnly = false; }

  /* AN UNANSWERED ADDRESS OPENS NOTHING. Emptying the tabs is the whole enforcement: every pane is
   * hidden by the map below and no screen loads, so nothing is read on the way past.
   *
   * An admin is warned instead. The account that grants access must not be the one that cannot get
   * in — a confirmation mail that goes astray would lock the owner out of the only tool that could
   * put it right. */
  const vfWanted = vfNeeded(user);
  const vfBlocked = vfWanted && !ME.admin && ME.tabs.length > 0;
  if (vfBlocked) ME.tabs = [];
  /* Shown to somebody who has access, to somebody who just lost it to this rule, and to an admin.
   * Somebody with no access at all is not shown it: being unconfirmed is not why they cannot get in,
   * and saying so would send them off to fix the wrong thing. */
  const vfShow = vfWanted && (vfBlocked || ME.admin || ME.tabs.length > 0);
  $('verifyBox').classList.toggle('hide', !vfShow);
  if (vfShow) {
    $('verifyWho').textContent = ME.email;
    $('verifyHead').textContent = ME.admin
      ? 'Your own email address is not confirmed'
      : 'Confirm your email address';
  }
  const allowed = ME.tabs.length > 0;

  /* One message, not two: somebody with no access at all is told THAT, because being unconfirmed is
   * not the reason they cannot get in. */
  $('noAccess').classList.toggle('hide', allowed || vfBlocked);
  // EVERY section belongs here. `article` was missing, so its button was never hidden — it sat in the
  // sidebar for accounts that could not open it, and clicking it fell through to showTab's guard,
  // which quietly sends you to your first allowed tab. A button that does nothing reads as a broken
  // app, not as a permission you were never given.
  Object.entries(NAV_MAP).forEach(([t, id]) => { const el = $(id); if (el) el.style.display = ME.tabs.includes(t) ? '' : 'none'; });
  /* The press is gone from the floor (2026-10-05): its screen stays reachable by link for the old entries, never in the menu. */
  if ($('tabPpress')) $('tabPpress').style.display = 'none';
  /* One button, three grants — any of them opens it, and the picker inside decides what it holds. */
  if ($('tabQc')) $('tabQc').style.display = qcViewsAllowed().length ? '' : 'none';

  /* THE VENDOR PORTAL IS THE VENDOR'S OWN SCREEN. To anybody else it can only say "you are not
   * linked to a vendor", which is the broken-button problem the note above this map describes.
   * Hidden until this account is known to BE a vendor — never on "is an admin", because a vendor
   * given a real email address one day must still get their portal. */
  if (ME.tabs.includes('vend')) hideVendTabUnlessVendor();
  /* SHOPIFY-ONLY ACCESS. 'shopprod' opens the Order Console at its Shopify views and nothing else:
   * same screen, same code, but the order book — every AMZ and B2B order the factory has — is not
   * offered and cannot be reached. One pane, so there is no second copy to keep in step; the
   * difference is what the view picker holds. */
  if (SHOP_ONLY()) {
    const b = $('tabOrd');
    /* The name only — setting the whole item's text took its icon and its count with it. */
    if (b) { b.style.display = ''; const t = b.querySelector && b.querySelector('.nav-t'); (t || b).textContent = 'Shopify Orders'; }
    ['book', 'bookdone'].forEach(k => { const o = $('odView') && $('odView').querySelector('option[value="' + k + '"]'); if (o) o.remove(); });
    if ($('odView')) $('odView').value = 'shopsku';
  }
  syncNavGroups();
  /* The sidebar is now telling the truth, so it can be seen. The data loads below take their own
   * time behind it. */
  ungate();
  if (!allowed) { ['paneRepl', 'paneArticle', 'paneTarget', 'paneFollow', 'paneTop', 'paneIndia', 'paneShopify', 'paneProd', 'panePack', 'paneAtt', 'panePmdb', 'paneMst', 'panePbase', 'panePcut', 'panePpress', 'paneQc', 'paneOrd', 'paneSo', 'paneVord', 'paneVend', 'paneVlog', 'paneCx', 'paneFgi', 'paneFab', 'paneAcc', 'paneRep', 'panePa', 'paneKa', 'paneHr', 'paneShop', 'paneAdj'].forEach(p => $(p).classList.add('hide')); $('noAccessWho').textContent = ME.email; $('pageTitle').textContent = ''; return; }
  // Changing the monthly projections is its own right (perms.replProj) — everyone else sees them
  // read-only. Guarded: this is pure cosmetics, and it sits in front of the config + snapshot loads,
  // so it must never be able to abort them. (A throw here once left the whole app with no data while
  // the tabs still rendered, which looked exactly like a permissions problem.)
  try {
    const pb = $('rProj'); if (pb) pb.classList.toggle('hide', !ME.projEdit);
    document.body.classList.toggle('noproj', !ME.projEdit);
  } catch (e) { console.warn('[repl] projection gating skipped:', e); }

  /* The factory sections need NOTHING from this project — the framed tool is on its own project
   * with its own sign-in, and the three read-only views read the factory's database over REST. An
   * account holding only those would otherwise spend its login on reads the rules must refuse, and
   * land on a red "ask an admin for perms.repl" message about a permission it does not need. */
  const FACTORY_TABS = ['dash', 'att', 'pmdb', 'mst', 'pbase', 'pcut', 'ppress', 'qc', 'qcalt', 'qcret', 'ord', 'so', 'vord', 'vreq', 'rfd', 'vend', 'palloc', 'fgi', 'fba', 'fab', 'acc', 'rep', 'pa', 'ka', 'hr',
    /* History and Customer Orders are factory screens too; missing here, a login holding History loaded
     * the Replenishment snapshot at sign-in — a vendor's among them. */
    'vlog', 'cx'];
  const FACTORY_ONLY = ME.tabs.every(t => FACTORY_TABS.includes(t));

  if (!FACTORY_ONLY) try {
    const c = await getDoc(doc(db, 'config', 'replapi'));
    if (c.exists()) { const d = c.data(); API = { url: String(d.url || '').trim(), key: String(d.key || '').trim() }; }
    else rMsg('⚠️ Backend not configured — create Firestore doc config/replapi with {url, key}.', true);
    // Separate, and allowed to fail on its own, so a denial here does not look like the whole app
    // having no backend. India stock and the Shopify tab both depend on it.
    try {
      const p = await getDoc(doc(db, 'config', 'api'));
      if (p.exists()) { const d = p.data(); PRAPI = { url: String(d.url || '').trim(), key: String(d.key || '').trim() }; }
    } catch (e) { PRAPI = null; }
  } catch (e) {
    // Distinguish "the rules said no" from anything else — a denied read here means this account does
    // not satisfy canRepl() in firestore.rules (perms/<email>.repl must be true, or admin), even though
    // the menu was built from replTabs. That mismatch is exactly what this message has to name.
    ACCESS_ERR = /permission|insufficient/i.test(e.code || e.message || '')
      ? `Firestore denied this account (${ME.email}). The tabs come from perms.replTabs, but every READ needs perms.replTabs AND perms.repl = true (or admin). Ask an admin to re-save your access in Sellora → Settings → Access.`
      : 'Could not read config: ' + (e.message || e);
    rMsg(ACCESS_ERR, true);
  }

  // The cached snapshot, which every tab EXCEPT the factory ones is built on.
  if (!FACTORY_ONLY) await ensureReplSlim();
  /* The screen the address names, when this account may open it — a tab opened from a menu link, or a
   * reload. showTab itself sends anything else to the first screen this account has. */
  showTab(navHashTab() || ME.tabs[0]);
  /* Somebody who approves requests is told how many are waiting without having to open the tab. */
  if (ME.tabs.includes('vreq') && vrqCanApprove()) ptGet('pt_vendorOrderReqs')
    .then(v => { if (VRQ.rows === null) VRQ.rows = ptList(v).filter(r => r && r.id); vrqBadge(); }).catch(() => {});
  /* The RFD count needs the orders as well as the decisions, because the requirements live inside
   * the orders — so it is filled when the screen is opened, not on the way in. */
  if (ME.tabs.includes('rfd') && rfdCanApprove() && RFD.decisions === null) ptGet('pt_rfdDecisions')
    .then(v => { if (RFD.decisions === null) RFD.decisions = v || {}; rfdBadge(); }).catch(() => {});
  if (ME.tabs.includes('so') && odrCanAnswer()) odrLoad().catch(() => {});
  if (ME.tabs.includes('fgi') && (ME.admin || ME.fgiEdit)) fgiCorrLoad().catch(() => {});
  /* Job Work corrections waiting: the badge is for whoever may answer them. */
  if (ME.tabs.includes('pbase') && ptCanEdit()) jwCorrLoad().catch(() => {});
  if (ME.tabs.includes('fgi')) ptGet('pt_amzListings').then(idx => { LST.map = lstParse(idx); LST.at = (idx && idx.at) || ''; return lstLoadAlerts(); }).catch(() => {});
  // Background-load POs once so the Follow-ups nav badge shows without opening the tab.
  if (!FACTORY_ONLY) loadPo().then(() => { PO_LOADED = true; updateFollowBadge(); }).catch(() => {});
});

