/* ---------- auth ---------- */
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
$('pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });
$('logoutBtn').onclick = () => signOut(auth);

/* The address this app invents for a phone-and-PIN vendor. No mailbox exists for it, so it can never
 * be confirmed. Vendors have no access here at all, but the test is kept identical to the other app
 * so the two cannot drift into disagreeing about who is let in. */
const VF_MADE_UP = '@vendors-tfr.app';
/* An address this app INVENTED from a cellphone: 'p' + ten digits + a domain, built on more than one
 * — @vendors-tfr.app for a vendor, @thefabricrush.com for staff who sign in with a PIN. No mailbox
 * exists behind any of them, so nobody can ever answer one. The shape is what makes it invented. */
const vfInvented = e => /^pd{10}@/.test(String(e || '').trim().toLowerCase());
function vfNeeded(user) {
  if (!user || user.emailVerified) return false;
  const e = String(user.email || '').trim().toLowerCase();
  if (!e || vfInvented(e) || e.indexOf(VF_MADE_UP) >= 0) return false;
  return true;
}

function vfWire() {
  const msg = $('verifyMsg');
  $('verifyOut').onclick = () => signOut(auth);
  $('verifySend').onclick = async () => {
    const u = auth.currentUser; if (!u) return;
    $('verifySend').disabled = true; msg.style.color = ''; msg.textContent = 'Sending…';
    try {
      await sendEmailVerification(u);
      msg.textContent = 'Sent to ' + u.email + '. Open the link, then press "I have confirmed it". '
        + 'Look in the spam folder too — it arrives from Firebase, not from us.';
    } catch (e) {
      msg.style.color = '#b91c1c';
      msg.textContent = /too-many-requests/.test(e.code || '')
        ? 'One has already gone out. Wait a minute, then look again — including in the spam folder.'
        : 'Could not send it: ' + (e.message || e);
    }
    $('verifySend').disabled = false;
  };
  $('verifyAgain').onclick = async () => {
    const u = auth.currentUser; if (!u) return;
    $('verifyAgain').disabled = true; msg.style.color = ''; msg.textContent = 'Checking…';
    try {
      /* Confirming happens in another tab; a reload is what brings the new answer back to this one. */
      await u.reload();
      if (auth.currentUser && auth.currentUser.emailVerified) { location.reload(); return; }
      msg.style.color = '#b91c1c';
      msg.textContent = 'Not confirmed yet. Open the link in the email first — then press this again.';
    } catch (e) { msg.style.color = '#b91c1c'; msg.textContent = 'Could not check: ' + (e.message || e); }
    $('verifyAgain').disabled = false;
  };
}
vfWire();

onAuthStateChanged(auth, async user => {
  $('loginView').classList.toggle('hide', !!user);
  $('appView').classList.toggle('hide', !user);
  if (!user) return;

  // Permissions FIRST — the menu is built from them, and everything below needs to know whether
  // this account is allowed to read it at all.
  await loadMyPerms(user);
  applyPerms();

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
  if (vfBlocked) { ME.tabs = []; applyPerms(); return; }   // nothing loads on the way past

  if (!ME.tabs.length && !ME.admin) return;      // nothing granted: the notice is already showing

  try {
    const c = await getDoc(doc(db, 'config', 'api'));
    // Trim both: a stray space/newline pasted into the Firestore fields is invisible but would
    // break the key match (or the URL) with a confusing "Unauthorized".
    if (c.exists()) { const d = c.data(); API = { url: String(d.url || '').trim(), key: String(d.key || '').trim() }; }
    else { API_ERR = 'the Firestore document config/api does not exist'; showMsg('⚠️ Backend not configured — create the Firestore doc config/api with {url, key}.', true); }
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
  await loadSettings();
});

