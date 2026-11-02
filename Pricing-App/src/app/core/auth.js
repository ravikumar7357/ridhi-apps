/* ================= CORE · AUTH: sign-in, sign-out, email confirmation, and the start of a session =================
 * Screens: the login view (loginView), the "confirm your email address" box at the top of the app view
 * (verifyBox), and the start of every session — the onAuthStateChanged handler at the end is where the
 * app comes to life after sign-in.
 * Does: wires Sign in / Sign out; decides whether a signed-in account must confirm its email address
 * (vfNeeded) and wires that box (vfWire); on every sign-in loads the account's permissions, builds the
 * menu, reads the backend address and key (Firestore config/api) and then the settings.
 * Main functions: vfInvented, vfNeeded, vfWire, and the onAuthStateChanged handler. */

/* ---------- auth ---------- */
// Sign in with the typed email and password. A wrong pair gets one plain sentence; anything else shows
// the raw message from Firebase.
$('loginBtn').onclick = async () => {
  $('loginErr').classList.add('hide');
  $('loginBtn').disabled = true;
  try {
    await signInWithEmailAndPassword(auth, $('email').value.trim(), $('pass').value);
  } catch (e) {
    $('loginErr').textContent = /invalid|wrong|not-found/i.test(e.code || '')
      ? 'Wrong email or password.' : (e.message || String(e));
    $('loginErr').classList.remove('hide');
  }
  $('loginBtn').disabled = false;
};
// Enter in the password box presses Sign in.
$('pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });
// Sign out; onAuthStateChanged below then shows the login view again.
$('logoutBtn').onclick = () => signOut(auth);

/* The address this app invents for a phone-and-PIN vendor. No mailbox exists for it, so it can never
 * be confirmed. Vendors have no access here at all, but the test is kept identical to the other app
 * so the two cannot drift into disagreeing about who is let in. */
const VF_MADE_UP = '@vendors-tfr.app';
/* An address this app INVENTED from a cellphone: 'p' + ten digits + a domain, built on more than one
 * — @vendors-tfr.app for a vendor, @thefabricrush.com for staff who sign in with a PIN. No mailbox
 * exists behind any of them, so nobody can ever answer one. The shape is what makes it invented. */
const vfInvented = e => /^pd{10}@/.test(String(e || '').trim().toLowerCase());
// Must this account still confirm its email address? Not when it is confirmed already, invented, or a vendor's.
function vfNeeded(user) {
  if (!user || user.emailVerified) return false;
  const e = String(user.email || '').trim().toLowerCase();
  if (!e || vfInvented(e) || e.indexOf(VF_MADE_UP) >= 0) return false;
  return true;
}

// Wire the confirm-email box: "Sign out", "Send the email" and "I have confirmed it".
function vfWire() {
  const msg = $('verifyMsg');
  $('verifyOut').onclick = () => signOut(auth);
  // --- send the confirmation email ---
  $('verifySend').onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;
    $('verifySend').disabled = true;
    msg.style.color = '';
    msg.textContent = 'Sending…';
    try {
      await sendEmailVerification(user);
      msg.textContent = 'Sent to ' + user.email + '. Open the link, then press "I have confirmed it". '
        + 'Look in the spam folder too — it arrives from Firebase, not from us.';
    } catch (e) {
      msg.style.color = '#b91c1c';
      msg.textContent = /too-many-requests/.test(e.code || '')
        ? 'One has already gone out. Wait a minute, then look again — including in the spam folder.'
        : 'Could not send it: ' + (e.message || e);
    }
    $('verifySend').disabled = false;
  };
  // --- "I have confirmed it": ask Firebase again, and reload the page once the address is confirmed ---
  $('verifyAgain').onclick = async () => {
    const user = auth.currentUser;
    if (!user) return;
    $('verifyAgain').disabled = true;
    msg.style.color = '';
    msg.textContent = 'Checking…';
    try {
      /* Confirming happens in another tab; a reload is what brings the new answer back to this one. */
      await user.reload();
      if (auth.currentUser && auth.currentUser.emailVerified) { location.reload(); return; }
      msg.style.color = '#b91c1c';
      msg.textContent = 'Not confirmed yet. Open the link in the email first — then press this again.';
    } catch (e) {
      msg.style.color = '#b91c1c';
      msg.textContent = 'Could not check: ' + (e.message || e);
    }
    $('verifyAgain').disabled = false;
  };
}
vfWire();

// Runs at page load with the remembered account, and after every sign-in and sign-out: shows the login
// view or the app view, and on sign-in starts the session — permissions, menu, email check, backend
// address and key, settings.
onAuthStateChanged(auth, async user => {
  $('loginView').classList.toggle('hide', !!user);
  $('appView').classList.toggle('hide', !user);
  if (!user) return;

  // --- permissions and menu ---
  // Permissions FIRST — the menu is built from them, and everything below needs to know whether
  // this account is allowed to read it at all.
  await loadMyPerms(user);
  applyPerms();

  // --- email confirmation ---
  /* AN ADDRESS IS NOT PROOF OF ANYTHING UNTIL SOMEBODY ANSWERS IT. Access here is granted by typing
   * one, so until it has been confirmed it proves only that somebody typed it. An admin is warned
   * rather than stopped: the account that grants access must not be the one that cannot get in. */
  const vfWanted = vfNeeded(user);
  const vfBlocked = vfWanted && !ME.admin && ME.tabs.length > 0;
  const vfShow = vfWanted && (vfBlocked || ME.admin || ME.tabs.length > 0);
  $('verifyBox').classList.toggle('hide', !vfShow);
  if (vfShow) {
    $('verifyWho').textContent = user.email || '';
    $('verifyHead').textContent = ME.admin
      ? 'Your own email address is not confirmed'
      : 'Confirm your email address';
  }
  if (vfBlocked) {   // nothing loads on the way past
    ME.tabs = [];
    applyPerms();
    return;
  }

  if (!ME.tabs.length && !ME.admin) return;      // nothing granted: the notice is already showing

  // --- the backend's address and key: Firestore config/api = { url, key, writeKey } ---
  try {
    const snap = await getDoc(doc(db, 'config', 'api'));
    // Trim both: a stray space/newline pasted into the Firestore fields is invisible but would
    // break the key match (or the URL) with a confusing "Unauthorized".
    if (snap.exists()) {
      const cfg = snap.data();
      API = { url: String(cfg.url || '').trim(), key: String(cfg.key || '').trim(), writeKey: String(cfg.writeKey || '').trim() };
    } else {
      API_ERR = 'the Firestore document config/api does not exist';
      showMsg('⚠️ Backend not configured — create the Firestore doc config/api with {url, key}.', true);
    }
  } catch (e) {
    // KEPT, not just shown. showMsg puts this at the top of the page, and every tab that later
    // fails says only "Backend not configured" — so the one sentence that explains why was on
    // screen for a moment and then scrolled away from the person reading the error.
    API_ERR = e.code === 'permission-denied'
      ? `this account may not read config/api — its perms/${ME.email} document needs one of the`
        + ' tabs that call the backend (shop, sales, plaudit, weekly, trends, deals, health, age, new)'
      : (e.message || String(e));
    showMsg('Could not read config: ' + API_ERR, true);
  }
  // --- settings (core/settings.js): the costing numbers, category fees and size tiers, New Product defaults ---
  await loadSettings();
});

