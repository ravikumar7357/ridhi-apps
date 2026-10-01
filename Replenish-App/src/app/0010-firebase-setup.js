import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail,
  sendEmailVerification }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, collectionGroup, addDoc, getDocs, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Same Firebase project as the Sellora app — so the login accounts and the access list
// (perms/{email}) are shared. This app is a separate frontend + its own backend, nothing more.
/* Creating a printer's account, and letting them change their own PIN, both go straight to the
 * identity service: the SDK's createUser would sign the ADMIN out and in as the printer. */
const FB_KEY = "AIzaSyCBHVKB0bXdawmz2dpAncrWonDZjfRjgqM";
const firebaseConfig = {
  apiKey: FB_KEY,
  authDomain: "price-research-48ff3.firebaseapp.com",
  projectId: "price-research-48ff3",
  storageBucket: "price-research-48ff3.firebasestorage.app",
  messagingSenderId: "998139754721",
  appId: "1:998139754721:web:83bc28cd1f7548ab055fa0"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---- India Stock: now UPLOADED by the user in the "India Stock" tab (Firestore repl/indiastock).
// The old read-only pillow-tracker connection was removed — that project's free read quota was the
// reason, and the user maintains this list themselves now.
let INDIA_STOCK = {}, INDIA_LOADED = false;   // sku↑ → qty
let INDIA_ROWS = [], INDIA_AT = null;         // rows + the moment the warehouse workbook was read
let INDIA_CACHED = false;                     // true while showing the last read rather than a fresh one
let FBA_STOCK = {};   // sku↑ → Total Stock + AWD Available + AWD Transit, built from the Replenishment snapshot
// Lead times in days, used to decide whether a month's shortfall can still be reached by sea or must
// fly. Editable in the Replenishment toolbar. Declared UP HERE because that toolbar wiring runs during
// module evaluation — a `let` further down would be in its temporal dead zone and kill the whole script.
// disp = days to actually get ready goods OUT of India (booking, pickup, gate-in). It applies once the
// goods exist — whether that is India stock on hand today or a production run finishing later.
let LEAD = { prod: 45, disp: 3, air: 15, sea: 80 };
function loadLead() {
  try {
    const s = JSON.parse(localStorage.getItem('repl_lead') || 'null');
    if (s) ['prod', 'disp', 'air', 'sea'].forEach(k => { const n = Number(s[k]); if (isFinite(n) && n >= 0) LEAD[k] = n; });
  } catch (e) {}
}

const $ = id => document.getElementById(id);
const nf = v => (v == null || v === '' ? '' : Number(v).toLocaleString('en-US'));
const esc = s => String(s == null ? '' : s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const BRAND_NAME = { SP: 'Ridhi', CPC: 'CPC' };

let API = null;               // { url, key } from Firestore config/replapi
// The PRICE RESEARCH backend, read separately. Shopify is connected only there — this app's own
// Apps Script has no Shopify at all — so the Shopify tab has to go through it.
let PRAPI = null;             // { url, key } from Firestore config/api
let ACCESS_ERR = '';          // set when Firestore DENIES a read — surfaced instead of "no data yet"
let ME = { email: '', admin: false, repl: false, tabs: [], tabsExplicit: false, prodEdit: false, rateApprove: false, fgiEdit: false, fgiEntry: false, empEdit: false, hrEmpOnly: false };
/* 'follow' (Ongoing Purchase Order) and 'india' (India Stock) were dropped on 08 Sep 2026: the
 * first is not wanted, and India stock now comes from the system rather than an uploaded workbook.
 * The PANES and their code are still in this page but unreachable, because what they READ is not
 * theirs alone — poQtyMap() and INDIA_STOCK feed the forecast, the lane decision, Article Review,
 * Create-PO, Top ASIN Status and Replenishment's own India Stock column, and all of those load
 * through ensureRepl/ensureProd, never through these two tabs. */
/* 'prod' (In Production) was dropped on 22 Sep 2026 — Ravi: "remove in production bucket, there is no
 * need now". Its figures still feed Replenishment's In Production column and the forecast, which load
 * through ensureProd; only the screen is gone. */
const REPL_TABS = ['repl', 'article', 'target', 'top', 'shopify', 'pack',
  /* 'cx' (Customer Orders) was dropped on 08 Sep 2026 — its adjustment and production routes were
   * never built, and pt_cxOrders was never written to. Its pane stays in the page, unreachable. */
  /* Quality Control is three jobs, not one: 'qc' is the checks, 'qcalt' is sending rejects out for
   * alteration, 'qcret' is taking them back. One tab, three grants. */
  'pmdb', 'mst', 'att', 'pbase', 'pcut', 'ppress', 'qc', 'qcalt', 'qcret', 'ord', 'so', 'vord', 'vreq', 'rfd', 'vend', 'vlog', 'palloc', 'fgi', 'fba', 'fab', 'acc', 'rep', 'pa', 'ka', 'hr',
  'shop', 'adj', 'shopprod', 'dash'];   // section keys, gated per-user via perms.replTabs — 'dash' is the admins' dashboard
let REPL = { SP: null, CPC: null };   // brand → { rows, at }
let PO = [];                  // purchase orders

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

/* ---------- the sidebar: collapsible groups + a hamburger ---------- */
const NAV_GROUPS = [...document.querySelectorAll('.navgrp')].map(head => ({
  key: head.dataset.grp,
  head,
  sec: $('sec' + head.dataset.grp.charAt(0).toUpperCase() + head.dataset.grp.slice(1)),
  tabs: (head.dataset.tabs || '').split(',').filter(Boolean),
}));
function setGroupOpen(g, open) {
  g.head.classList.toggle('open', open);
  g.head.setAttribute('aria-expanded', String(open));
  g.sec.classList.toggle('open', open);
  /* The mega menu hangs from the bar, not from its heading: the bar can wrap to two rows. */
  if (open && g.sec.classList.contains('navmega') && g.head.getBoundingClientRect)
    g.sec.style.top = Math.round(g.head.getBoundingClientRect().bottom + 7) + 'px';
}
/* A MENU IS NOT A SHAPE TO REMEMBER. A sidebar's open group was worth keeping between visits; a
 * dropdown that opened by itself on load would be a panel over the work nobody asked for. */
function saveGroups() { /* nothing to remember: menus open on a click and close on the next one */ }
/* ONE GROUP OPEN AT A TIME (Ravi, 2026-09-22: "grid bahut lamba h — kam se kam show ho"). Opening a
 * heading folds the others; the group of the screen you are on opens by itself. */
NAV_GROUPS.forEach(g => g.head.onclick = () => {
  const opening = !g.head.classList.contains('open');
  NAV_GROUPS.forEach(x => setGroupOpen(x, x === g ? opening : false));
  saveGroups();
});
/**
 * Say which menu the screen you are on belongs to — and close every menu.
 *
 * On a sidebar this opened the group so its items stayed visible. A menu bar is the other way
 * round: the panel is in front of the work, so it goes as soon as a screen is picked, and the
 * heading is marked instead.
 */
/**
 * The row under the menu, kept only while something is actually in it.
 *
 * A flex row with nothing visible inside is still a margin, and on thirty screens that was thirty
 * empty gaps. Whoever puts something up there — a screen's own line, its own button — gets the row
 * back by having put something in it.
 */
function topbarSync() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  const alive = [...bar.children].some(el => el.id !== 'pageTitle' && el.id !== 'hambBtn'
    && !el.classList.contains('hide') && (el.textContent.trim() || el.querySelector('button:not(.hide)')));
  bar.classList.toggle('hide', !alive);
}

/** The screen named in the address ("#fab"), or '' — only a screen this app has. */
function navHashTab() {
  const h = String((typeof location !== 'undefined' && location.hash) || '').replace(/^#\/?/, '').trim();
  return /^[a-z]+$/.test(h) && (typeof TAB_NAV_IDS === 'undefined' || TAB_NAV_IDS.indexOf(h) >= 0 || h === 'shopprod') ? h : '';
}
/* Every screen key with a menu link — the same list showTab keys its table on. */
const TAB_NAV_IDS = ["repl","article","target","follow","top","india","shopify","prod","pack","att","pmdb","mst","pbase","pcut","ppress","qc","ord","so","vord","vreq","rfd","vend","vlog","cx","palloc","fgi","fba","fab","acc","rep","pa","ka","hr","shop","adj"];

/* A Ctrl/Cmd/Shift click opens the link in a new tab or window; it must not ALSO switch this one. The
 * item's own click handler is on the link, so it is stopped here, on the way down. */
document.querySelector('.side') && document.querySelector('.side').addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a.nav');
  if (a && (e.ctrlKey || e.metaKey || e.shiftKey || e.button > 0)) e.stopPropagation();
}, true);
/* The address changed by hand, or by Back: follow it, once. */
window.addEventListener('hashchange', () => {
  const t = navHashTab();
  if (t && t !== TAB_NOW && ME && ME.tabs && ME.tabs.length) showTab(t);
});

function navOpenFor(tab) {
  const g = NAV_GROUPS.find(x => x.tabs.includes(tab));
  NAV_GROUPS.forEach(x => {
    setGroupOpen(x, false);
    x.head.classList.toggle('here', !!g && x === g);
  });
}
/* A menu closes when something is picked from it, when the page is clicked, and on Escape. */
NAV_GROUPS.forEach(g => g.sec.addEventListener('click', e => {
  if (e.target.closest('.nav')) NAV_GROUPS.forEach(x => setGroupOpen(x, false));
}));
document.addEventListener('click', e => {
  if (e.target.closest('.navgrp') || e.target.closest('.navsec')) return;
  NAV_GROUPS.forEach(x => setGroupOpen(x, false));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') NAV_GROUPS.forEach(x => setGroupOpen(x, false));
});
NAV_GROUPS.forEach(g => setGroupOpen(g, false));
/** Drop a heading whose whole section this account cannot reach. */
function syncNavGroups() {
  const may = t => !ME.tabs || !ME.tabs.length || ME.tabs.includes(t);
  NAV_GROUPS.forEach(g => {
    const dead = !g.tabs.some(may);
    g.head.classList.toggle('hide', dead);
    g.sec.classList.toggle('hide', dead);
  });
}

/* The hamburger hides the sidebar outright on a wide screen and slides it over the page on a narrow
 * one — same button, and the CSS decides which. Only the wide-screen choice is worth remembering. */
const NARROW = () => window.matchMedia('(max-width:900px)').matches;
function setNavOpen(open, remember) {
  $('appView').classList.toggle('navshut', !open);
  $('hambBtn').setAttribute('aria-expanded', String(open));
  if (remember !== false && !NARROW()) {
    try { localStorage.setItem('replNavShut', open ? '0' : '1'); } catch (e) {}
  }
}
$('hambBtn').onclick = () => setNavOpen($('appView').classList.contains('navshut'));
$('navClose').onclick = () => setNavOpen(false);
$('navScrim').onclick = () => setNavOpen(false);
(() => {
  /* ALWAYS OPEN (Ravi, 2026-09-25). The menu is the bar across the top and nothing on screen can bring it
   * back once shut, so it is never shut: not by a "closed" remembered from the old sidebar — which is what
   * hid it on a store account's phone — and not by a narrow screen. The stale memory is cleared. */
  try { localStorage.removeItem('replNavShut'); } catch (e) {}
  setNavOpen(true, false);
})();

/**
 * The only section a vendor can actually use.
 *
 * Everything else reads a node the rules refuse them — History reads every printer's orders, Base
 * Data and the rest read the factory's registers — so granting one produces a screen that can only
 * say "permission denied". Their own work, their own orders and their own delivery history are all
 * in the portal, on its three tabs.
 */
const VENDOR_TABS = ['vend'];

/**
 * Take the sections a vendor cannot use off their screen, and move them somewhere that works.
 *
 * Called once the database has confirmed this sign-in really is a printer. It changes what is on
 * screen, never what is stored.
 */
function vendorOnlyTabs() {
  const keep = (ME.tabs || []).filter(t => VENDOR_TABS.indexOf(t) >= 0);
  ME.tabs = keep.length ? keep : VENDOR_TABS.slice();
  Object.entries(NAV_MAP).forEach(([t, id]) => {
    const el = $(id);
    if (el) el.style.display = ME.tabs.indexOf(t) >= 0 ? '' : 'none';
  });
  /* If they are already reading a refusal on one of those screens, move them off it. */
  if (TAB_NOW && ME.tabs.indexOf(TAB_NOW) < 0) showTab(ME.tabs[0]);
  syncNavGroups();
}

/**
 * Is this sign-in a vendor? Hides the Vendor Portal until it is known to be one.
 *
 * EXCEPT WHEN SOMEBODY DELIBERATELY GRANTED IT. Being allowed to open the portal and being a vendor
 * are two different things: the first is ticked in Sellora, the second is a row written by "Set up"
 * on the Printers screen. An account with the first and not the second used to lose the tab without
 * a word and get bounced to whatever screen came first — which is how a printer ended up looking at
 * the Replenishment planning board. The portal's own message explains this properly; hiding the tab
 * is what stopped anyone reading it.
 */
async function hideVendTabUnlessVendor() {
  const el = $('tabVend');
  if (!el) return;
  // A cellphone-and-PIN sign-in is a vendor by construction — no read needed.
  if (vpOnPin()) { if (!ME.admin) vendorOnlyTabs(); return; }
  el.style.display = 'none';
  try {
    const own = await ptGet('pt_vendorByEmail/' + vpEmailKey(ME.email));
    const isVendor = !!(own && own.code);
    const rule = vendTabRule(isVendor);
    if (rule !== 'no') el.style.display = '';     // 'ask' lets them in, so the pane can explain itself
    else if (VEND_WAS_ON) showTab(ME.tabs[0]);
    /* AND NOTHING ELSE. A staff screen granted to a printer cannot read what it needs, so it can
     * only ever show them a permission error with their name on it. */
    if (isVendor && !ME.admin) vendorOnlyTabs();
  } catch (e) {
    /* Could not tell. Left hidden: a portal that cannot say whose orders it is showing is worse
     * than a missing tab. */
  }
  syncNavGroups();
}
/* Whether the portal was the tab on screen when the check finished — if it was, and this account is
 * not a vendor, it has to be moved off it rather than left looking at an error. */
let VEND_WAS_ON = false;

/** Uncover the app. Safe to call more than once, and called on every way out of the gating. */
function ungate() { try { document.body.classList.remove('gating'); } catch (e) { /* nothing to do */ } }

$('verifyOut').onclick = () => signOut(auth);
$('verifySend').onclick = async () => {
  const u = auth.currentUser; if (!u) return;
  const msg = $('verifyMsg');
  $('verifySend').disabled = true; msg.className = 'muted'; msg.textContent = 'Sending…';
  try {
    await sendEmailVerification(u);
    msg.textContent = 'Sent to ' + u.email + '. Open the link, then press "I have confirmed it". '
      + 'Look in the spam folder too — it arrives from Firebase, not from us.';
  } catch (e) {
    /* Firebase refuses a flood of these, and "nothing happened" would read as a broken button. */
    msg.className = 'err';
    msg.textContent = /too-many-requests/.test(e.code || '')
      ? 'One has already gone out. Wait a minute, then look again — including in the spam folder.'
      : 'Could not send it: ' + (e.message || e);
  }
  $('verifySend').disabled = false;
};
$('verifyAgain').onclick = async () => {
  const u = auth.currentUser; if (!u) return;
  const msg = $('verifyMsg');
  $('verifyAgain').disabled = true; msg.className = 'muted'; msg.textContent = 'Checking…';
  try {
    /* The flag is on the token this page is holding, and confirming happens in a different tab. A
     * reload is the only thing that brings the new answer back. */
    await u.reload();
    if (auth.currentUser && auth.currentUser.emailVerified) { location.reload(); return; }
    msg.className = 'err';
    msg.textContent = 'Not confirmed yet. Open the link in the email first — then press this again.';
  } catch (e) { msg.className = 'err'; msg.textContent = 'Could not check: ' + (e.message || e); }
  $('verifyAgain').disabled = false;
};

/* ---------- tabs ---------- */
/** Every section, and the sidebar button that opens it. One map, used wherever buttons are shown. */
const NAV_MAP = { repl: 'tabRepl', article: 'tabArticle', target: 'tabTarget', follow: 'tabFollow',
  top: 'tabTop', india: 'tabIndia', shopify: 'tabShopify', prod: 'tabProd', pack: 'tabPack',
  pmdb: 'tabPmdb', mst: 'tabMst', pbase: 'tabPbase', pcut: 'tabPcut', ppress: 'tabPpress', qc: 'tabQc',
  ord: 'tabOrd', so: 'tabSo', vord: 'tabVord', vreq: 'tabVreq', rfd: 'tabRfd', vend: 'tabVend', vlog: 'tabVlog', cx: 'tabCx',
  palloc: 'tabPalloc', fgi: 'tabFgi', fba: 'tabFba', fab: 'tabFab', acc: 'tabAcc', rep: 'tabRep', pa: 'tabPa', ka: 'tabKa', att: 'tabAtt', hr: 'tabHr',
  shop: 'tabShop', adj: 'tabAdj' };

/** What is on screen right now — so a check that finishes late knows whether to move anybody. */
let TAB_NOW = '';

/**
 * The big tables, and the tab each one belongs to — emptied when that tab is left.
 *
 * EVERY TAB IN HERE MUST REDRAW WHEN IT IS OPENED. showTab calls an ensure* or a render* for each of
 * them on the way in; a prod-test rule checks that, because a tab added here without one would open
 * to a blank table and look broken. The Replenishment screen is deliberately absent: it draws once,
 * at sign-in, and has nothing to draw it again.
 */
const TAB_TABLES = {
  ord: ['odTable'], pbase: ['pbTable'], pcut: ['pcTable'], ppress: ['ppTable'], qc: ['qcTable'],
  fgi: ['fgTable'], fba: ['fbaTable'], vlog: ['vlTable'], so: ['soTable'], pmdb: ['pmTable'],
  acc: ['acTable'], vord: ['voTable'], fab: ['fbTable'], palloc: ['palTable'], mst: ['mstTable'],
};
/** Give the page back the megabyte the screen you just left was holding. */
function tabShed(prev) {
  (TAB_TABLES[prev] || []).forEach(id => { const el = $(id); if (el && el.innerHTML) el.innerHTML = ''; });
}

/** Holds the Shopify view of the order book, but not the order book itself. */
const SHOP_ONLY = () => !!(ME.tabs && ME.tabs.includes('shopprod') && !ME.tabs.includes('ord') && !ME.admin);

function showTab(which) {
  // 'shopprod' is not a pane of its own — it is the Order Console, opened at its Shopify views.
  if (which === 'shopprod') which = 'ord';
  if (ME.tabs && ME.tabs.length && !ME.tabs.includes(which)
      && !(which === 'ord' && ME.tabs.includes('shopprod'))) which = ME.tabs[0];
  const panes = { dash: 'paneDash', repl: 'paneRepl', article: 'paneArticle', target: 'paneTarget', follow: 'paneFollow', top: 'paneTop', india: 'paneIndia', shopify: 'paneShopify', prod: 'paneProd', pack: 'panePack', att: 'paneAtt', pmdb: 'panePmdb', mst: 'paneMst', pbase: 'panePbase', pcut: 'panePcut', ppress: 'panePpress', qc: 'paneQc', ord: 'paneOrd', so: 'paneSo', vord: 'paneVord', vreq: 'paneVreq', rfd: 'paneRfd', vend: 'paneVend', vlog: 'paneVlog', cx: 'paneCx', palloc: 'panePalloc', fgi: 'paneFgi', fba: 'paneFba', fab: 'paneFab', acc: 'paneAcc', rep: 'paneRep', pa: 'panePa', ka: 'paneKa', hr: 'paneHr', shop: 'paneShop', adj: 'paneAdj' };
  const navs = { dash: 'tabDash', repl: 'tabRepl', article: 'tabArticle', target: 'tabTarget', follow: 'tabFollow', top: 'tabTop', india: 'tabIndia', shopify: 'tabShopify', prod: 'tabProd', pack: 'tabPack', att: 'tabAtt', pmdb: 'tabPmdb', mst: 'tabMst', pbase: 'tabPbase', pcut: 'tabPcut', ppress: 'tabPpress', qc: 'tabQc', ord: 'tabOrd', so: 'tabSo', vord: 'tabVord', vreq: 'tabVreq', rfd: 'tabRfd', vend: 'tabVend', vlog: 'tabVlog', cx: 'tabCx', palloc: 'tabPalloc', fgi: 'tabFgi', fba: 'tabFba', fab: 'tabFab', acc: 'tabAcc', rep: 'tabRep', pa: 'tabPa', ka: 'tabKa', hr: 'tabHr', shop: 'tabShop', adj: 'tabAdj' };
  /* Before anything is shown: hand back what the screen being left was holding. */
  if (TAB_NOW && TAB_NOW !== which) tabShed(TAB_NOW);
  Object.entries(panes).forEach(([k, id]) => $(id).classList.toggle('hide', which !== k));
  Object.entries(navs).forEach(([k, id]) => $(id).classList.toggle('on', which === k));
  if (SHOP_ONLY() && which === 'ord') { $('pageTitle').textContent = 'Shopify Orders'; }
  const TITLES = { dash: 'Dashboard', repl: 'Replenishment', article: 'Article Review', target: 'Revenue Target', follow: 'Ongoing Purchase Order', top: 'Top ASIN Status', india: 'India Stock', shopify: 'Shopify Stock', prod: 'In Production', pack: 'Packing List', plan: 'Action Plan',
    att: 'Attendance', pmdb: 'Master Database', mst: 'Masters', pbase: 'Job Work Register', pcut: 'Cutting Data', ppress: 'Press Inventory', qc: 'Quality Control', ord: 'Order Console', so: 'Sales Orders', vord: 'Vendor Orders', vreq: 'Vendor Order Requests', rfd: 'RFD Requirements', vend: 'Vendor Portal', vlog: 'History — what printers have sent', cx: 'Customer Orders', palloc: 'Printer Allocation', fgi: 'Finished Goods', fba: 'FBA Dispatch', fab: 'Fabric Inventory', acc: 'Accessories', rep: 'Reports', pa: 'Production Analysis', ka: 'Karigar Analysis', hr: 'Finance & HR', shop: 'Shopify Orders', adj: 'Adjustments' };
  $('pageTitle').textContent = TITLES[which] || 'Replenishment';
  /* The line under a title, and the button that starts work, for the screens that have them. */
  const SUBS = { pbase: 'Track job work issued to karigars and manage receipts' };
  if ($('topSub')) { $('topSub').textContent = SUBS[which] || ''; $('topSub').classList.toggle('hide', !SUBS[which]); }
  if ($('bwToggle')) $('bwToggle').classList.toggle('hide', which !== 'pbase');
  VEND_WAS_ON = (which === 'vend');
  TAB_NOW = which;
  /* THE ADDRESS SAYS THE SCREEN, so a link to it — a new tab, a reload — opens here again. Replaced,
   * not pushed: Back is not a list of every tab visited. */
  try { if (location.hash !== '#' + which) history.replaceState(null, '', '#' + which); } catch (e) { /* only the address */ }
  navOpenFor(which);
  /* Nothing left up there on most screens — so there is no row. The ones that put their own line or
   * their own button there keep it. */
  topbarSync();
  /* The screen's name where a name belongs when it is not on the page: the browser tab. */
  try { document.title = ($('pageTitle').textContent || '') + ($('pageTitle').textContent ? ' · ' : '') + 'Ridhi Home & Living'; } catch (e) { /* nothing depends on it */ }
  /* There is no drawer to close any more: the menu is the bar across the top, on every width. */
  if (which === 'dash') ensureDash();
  /* THE REPLENISHMENT SCREENS READ THEIR OWN SNAPSHOT (2026-09-26). Sign-in used to read the full copy and draw the
   * table for them; since it reads only the slim one, a screen that did not ask for its data opened blank — Ravi:
   * "abhi bhi data blank hi show ho rha h". Each one asks here, and draws when it lands. */
  if (which === 'repl') ensureRepl();
  if (which === 'article') ensureReplData().then(renderArticle, renderArticle);
  if (which === 'target') ensureTarget();
  if (which === 'follow') ensureFollow();
  if (which === 'top') ensureReplData().then(ensureTop, ensureTop);
  if (which === 'india') ensureIndia();
  if (which === 'shopify') ensureReplData().then(ensureShopify, ensureShopify);
  if (which === 'prod') ensureProd();
  if (which === 'pack') ensurePack();
  if (which === 'att') ensureAtt();
  if (which === 'pmdb') ensurePmdb();
  if (which === 'mst') ensureMst();
  if (which === 'pbase') ptOpenFresh('pbase', ensurePbase);
  if (which === 'pcut') ptOpenFresh('pcut', ensurePcut);
  if (which === 'ppress') ptOpenFresh('ppress', ensurePpress);
  if (which === 'qc') ensureQc();
  if (which === 'ord') ptOpenFresh('ord', ensureOrd);
  if (which === 'so') ensureSox();
  if (which === 'vord') ensureVo();
  if (which === 'vreq') ensureVrq();
  if (which === 'rfd') ensureRfd();
  if (which === 'vend') ensureVp();
  if (which === 'vlog') ensureVlog();
  if (which === 'cx') ensureCx();
  if (which === 'palloc') ensurePal();
  /* The register is re-read every time the tab is opened — Refresh used to do this, and two people
   * entering stock on the same afternoon have to be able to see each other's work. */
  if (which === 'fgi') { FGI.rows = null; ensureFgi(); }
  if (which === 'fba') { FGI.rows = null; ensureFba(); }
  if (which === 'rep') ensureRep();
  if (which === 'pa' || which === 'ka') ensurePa();
  if (which === 'fab') ensureFab();
  if (which === 'acc') ensureAcc();
  if (which === 'hr') ensureHr();
  if (which === 'shop') ensureShop();
  if (which === 'adj') ensureAdj();
}
$('tabDash').onclick = () => showTab('dash');
$('tabRepl').onclick = () => showTab('repl');
$('tabArticle').onclick = () => showTab('article');
$('tabTarget').onclick = () => showTab('target');
$('tabFollow').onclick = () => showTab('follow');
$('tabTop').onclick = () => showTab('top');
$('tabIndia').onclick = () => showTab('india');
$('tabShopify').onclick = () => showTab('shopify');
$('tabProd').onclick = () => showTab('prod');
$('tabPack').onclick = () => showTab('pack');
$('tabAtt').onclick = () => showTab('att');
$('tabPmdb').onclick = () => showTab('pmdb');
$('tabMst').onclick = () => showTab('mst');
$('tabPbase').onclick = () => showTab('pbase');
$('tabPcut').onclick = () => showTab('pcut');
$('tabPpress').onclick = () => showTab('ppress');
$('tabQc').onclick = () => showTab('qc');
$('tabOrd').onclick = () => showTab('ord');
$('tabSo').onclick = () => showTab('so');
$('tabVord').onclick = () => showTab('vord');
$('tabVreq').onclick = () => showTab('vreq');
$('tabRfd').onclick = () => showTab('rfd');
$('tabVend').onclick = () => showTab('vend');
$('tabVlog').onclick = () => showTab('vlog');
$('tabCx').onclick = () => showTab('cx');
$('tabPalloc').onclick = () => showTab('palloc');
$('tabFgi').onclick = () => showTab('fgi');
$('tabFba').onclick = () => showTab('fba');
$('tabRep').onclick = () => showTab('rep');
$('tabPa').onclick = () => showTab('pa');
$('tabKa').onclick = () => showTab('ka');
$('tabFab').onclick = () => showTab('fab');
$('tabAcc').onclick = () => showTab('acc');
$('tabHr').onclick = () => showTab('hr');
$('tabShop').onclick = () => showTab('shop');
$('tabAdj').onclick = () => showTab('adj');

/* ---------- backend call ---------- */
/**
 * A read from the Replenishment backend, asked again when Google answers with a web page instead of
 * the data. Only for reads — `tries` stays 1 for anything that writes.
 */
async function apiGetRetry(params, tries, onRetry, timeoutMs) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await apiGet(params, timeoutMs); }
    catch (e) {
      last = e;
      if (!e || !e.transient || i === tries) break;
      if (onRetry) onRetry(i + 1, tries);
      await new Promise(r => setTimeout(r, 2000 * i));
    }
  }
  throw last;
}

async function apiGet(params, timeoutMs) {
  if (!API || !API.url) throw new Error('Backend not configured (Firestore config/replapi).');
  const u = new URL(API.url);
  u.searchParams.set('key', API.key);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
  const transient = msg => Object.assign(new Error(msg), { transient: true });
  let r, text;
  /* A GOOD ANSWER COMES BACK IN ABOUT 20 SECONDS; a lost one hangs for a minute or more before Google
   * gives up with its Page-not-found page. Waiting it out made every retry cost a minute. */
  const ac = timeoutMs ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try { r = await fetch(u, { redirect: 'follow', signal: ac ? ac.signal : undefined }); text = await r.text(); }
  catch (e) { throw transient(ac && ac.signal.aborted ? `No answer from Google within ${Math.round(timeoutMs / 1000)} seconds.` : 'The connection to the backend dropped before the data arrived.'); }
  finally { if (timer) clearTimeout(timer); }
  let d;
  try { d = JSON.parse(text); }
  catch (e) {
    // Apps Script answers with an HTML PAGE instead of JSON in several situations, and the raw
    // "Unexpected token '<'" that JSON.parse throws says nothing useful. Name what actually happened.
    const t = text.slice(0, 9000);
    /* GOOGLE LOST THE ANSWER. The script finished (its Executions log says Completed) but the
     * hand-back link had already gone, and Google serves Drive's "Page not found" page — whose markup
     * contains the word "error", so this used to read as the script crashing. Asking again works. */
    if (r.status === 404 || /unable to open the file|page not found/i.test(t))
      throw transient('Google lost the answer on the way back (the script finished, but a "Page not found" page came instead of the data).');
    if (/accounts\.google\.com|sign ?in|authoriz/i.test(t))
      throw new Error('Google asked to sign in instead of returning data — the Apps Script deployment has lost its “Anyone, even anonymous” access. Re-deploy the backend and check Deploy → Manage deployments → Who has access.');
    if (/too many times|quota|rate limit|try again later/i.test(t))
      throw new Error('Google is throttling the Apps Script backend (too many calls). Wait a few minutes and hit Refresh again.');
    if (/exception|error/i.test(t))
      throw new Error('The backend script threw an error. Open the Apps Script project → Executions to see it.');
    throw transient(`The backend returned a web page, not data (${text.length.toLocaleString()} bytes, HTTP ${r.status}). This is usually a dropped connection on a big pull.`);
  }
  if (!d.ok) throw Object.assign(new Error(d.error || 'Request failed'), { data: d });
  return d;
}

/* ---- one brand's inventory, in pieces ----
 *
 * The backend used to answer "Refresh from sheet" with the whole brand at once: a minute of work and
 * several MB in one response. Google loses big, slow answers — on 15 Sep it lost every CPC read — and
 * each retry started another minute-long read on top of the last.
 *
 * Now the backend reads the sheet once and keeps the result (repl=meta), and the app collects it a
 * few hundred KB at a time (repl=page). A lost "meta" answer loses no work: asking again finds the read
 * finished, or still running. A lost piece is a two-second request, asked again.
 */
const replSleep = ms => new Promise(r => setTimeout(r, ms));

async function replPull(brand, say) {
  const T0 = Date.now(), LIMIT = 6 * 60 * 1000;
  const secs = () => Math.round((Date.now() - T0) / 1000);
  let fresh = '1', again = false;
  for (;;) {
    let meta = null;
    while (!meta) {
      if (Date.now() - T0 > LIMIT) throw new Error('The sheet read did not finish within 6 minutes. Refresh again in a little while.');
      let d = null;
      try { d = await apiGet({ repl: 'meta', brand, fresh }, 150000); }
      catch (e) {
        if (!e.transient) throw e;
        say(`reading the sheet — Google lost an answer, checking whether the read finished (${secs()} s)…`);
      }
      fresh = '0';                                  // from here on: take the read that is already running
      if (d && !d.building) { meta = d; break; }
      if (d && d.building) say(`reading the sheet (${secs()} s)…`);
      await replSleep(d ? 6000 : 3000);
    }
    try { return await replPieces(brand, meta, say); }
    catch (e) {
      /* The cache let go of the read between "ready" and collecting it. Once, a fresh read; twice is a
       * real problem and is reported. */
      if (e.data && e.data.expired && !again) { again = true; fresh = '1'; continue; }
      throw e;
    }
  }
}

/** Collect a finished read: rows in groups of six pieces, three at a time, then the rest of it. */
async function replPieces(brand, meta, say) {
  const groups = [];
  for (let i = 0; i < meta.rowPieces; i += 6) groups.push([i, Math.min(meta.rowPieces, i + 6)]);
  const got = new Array(groups.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < groups.length) {
      const k = next++;
      const d = await apiGetRetry({ repl: 'page', brand, token: meta.token, kind: 'r', from: groups[k][0], to: groups[k][1] }, 4, null, 60000);
      got[k] = d.rows || [];
      done++;
      say(`collecting the rows (${done} of ${groups.length})…`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const x = await apiGetRetry({ repl: 'page', brand, token: meta.token, kind: 'x', from: 0, to: meta.extraPieces }, 4, null, 60000);
  const rows = [].concat(...got);
  /* A brand with rows missing would look like a complete one with fewer SKUs — refuse it instead. */
  if (rows.length !== meta.n) throw new Error(`Only ${rows.length} of ${meta.n} rows arrived. Refresh again.`);
  return Object.assign(JSON.parse(x.text || '{}'), { rows });
}

/* The Price Research backend. Both the Shopify tab AND India stock come through it: the Shopify
 * connection and the warehouse-workbook access live only in that script, not in this app's own. */
async function prGet(params) {
  if (!PRAPI || !PRAPI.url) {
    throw new Error('No access to the Price Research backend. Its address lives in Firestore '
      + 'config/api, and this account has to be allowed to read it — ask an admin to re-save your access.');
  }
  const u = new URL(PRAPI.url);
  u.searchParams.set('key', PRAPI.key);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, v); });
  const r = await fetch(u, { redirect: 'follow' });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); }
  catch (e) { throw new Error(`The Price Research backend returned a web page, not data (HTTP ${r.status}).`); }
  if (!d.ok) throw new Error(d.error || 'Request failed');
  return d;
}

