/* ================= THE VENDOR MASTER =================
 *
 * Only the two fields that decide whether a printer can be given a login: their email and their
 * cellphone. Everything else on a vendor record — GST, address, category — is left where it is
 * rather than half-copied here, because a second place to edit an address is a second place for it
 * to be wrong.
 *
 * pt_masters.vendor is a KEYED OBJECT (r0…r5), not an array, so a row is written back at its own
 * key. Each field is patched on its own path: writing the whole row would overwrite whatever the
 * production tool changed on it since this screen was opened.
 */
const VM_PLACEHOLDER = '@vendors-tfr.app';
const vmValid = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim().toLowerCase());
/** Valid AND a mailbox that can actually receive a password link. The made-up domain cannot. */
const vmReal = e => vmValid(e) && String(e).trim().toLowerCase().indexOf(VM_PLACEHOLDER) < 0;

/**
 * An address this app INVENTED from a cellphone, rather than one somebody gave us.
 *
 * pinEmails builds 'p' + ten digits + a domain, and it builds it on more than one: @vendors-tfr.app
 * for a vendor, @thefabricrush.com for staff who sign in with a PIN. No mailbox exists behind any of
 * them. The shape is what makes it invented, not the domain — a third domain tomorrow must not
 * quietly lock somebody out — and nobody's real mailbox is called p8385995363.
 */
const vfInvented = e => /^p\d{10}@/.test(String(e || '').trim().toLowerCase());

/**
 * Does this sign-in still have an address to answer?
 *
 * Access is granted by typing an address, so until somebody answers it, it proves only that somebody
 * typed it. The exception is an address we invented: it can never be confirmed, and asking would
 * lock out every phone-and-PIN sign-in at once — five of the people who use the register daily, and
 * every printer.
 */
function vfNeeded(user) {
  if (!user || user.emailVerified) return false;
  const e = String(user.email || '').trim().toLowerCase();
  if (!e || vfInvented(e) || e.indexOf(VM_PLACEHOLDER) >= 0) return false;
  return true;
}

async function vmOpen() {
  if (!PTG.masters) await ptLoadGates();
  if (VO.rows === null) await ensureVo();
  /* EVERY vendor, not only the printers — a filling firm has an address and a phone like anybody
   * else, and hiding it here is why three of the four on the quilt sheet were never entered. */
  const rows = voAllVendors();
  const head = ['Code', 'Vendor', 'Kind', 'Email', 'Cellphone', 'Can sign in?', 'Phone login']
    .map(h => `<th>${h}</th>`).join('');
  const body = rows.map(v => {
    /* Only a login the cache holds for THIS vendor. A row left behind by a different firm under the
     * same code is not this vendor's address, and offering it as a placeholder is how Friends Rui
     * Mattress came to be shown A R Textile Printer's sign-in. */
    const cached = (VO.map && VO.map[v.code]) || {};
    const mine = vpPhone(cached.phone) && vpPhone(cached.phone) === vpPhone(v.phone);
    const mapped = mine ? cached : {};
    const eff = vmReal(v.email) ? v.email : (vmReal(mapped.email) ? mapped.email : (mapped.email || ''));
    return `<tr><td style="font-family:ui-monospace,monospace">${esc(v.code)}</td>`
      + `<td><input data-vm="desc" data-k="${esc(v._key)}" type="text" value="${esc(v.desc || v.name || '')}"`
      + ` placeholder="what this firm is called" style="width:210px"></td>`
      + `<td><select data-vm="category" data-k="${esc(v._key)}" style="width:135px">${
        VENDOR_CATS.map(c => `<option value="${esc(c)}"${String(v.category || '') === c ? ' selected' : ''}>${esc(c)}</option>`).join('')
      }${VENDOR_CATS.indexOf(String(v.category || '')) < 0 && v.category
        ? `<option value="${esc(v.category)}" selected>${esc(v.category)}</option>` : ''}</select></td>`
      + `<td><input data-vm="email" data-k="${esc(v._key)}" type="email" value="${esc(v.email || '')}"`
      + ` placeholder="${esc(mapped.email || 'their own email address')}" style="width:230px"></td>`
      + `<td><input data-vm="phone" data-k="${esc(v._key)}" type="text" value="${esc(v.phone || '')}"`
      + ` placeholder="10 digits" style="width:120px"></td>`
      + `<td>${vmReal(eff) ? '<span class="pill pill-ok">yes</span>'
        : (vmValid(eff) ? '<span class="pill pill-low">only with a PIN</span>'
                        : '<span class="pill pill-out">no</span>')}</td>`
      /* TWO ROADS IN, and a row is offered whichever it has. "Set up" builds a PIN login out of the
       * cellphone; "Link email" points an address you already made in Firebase at this vendor. A
       * vendor with both gets both, because they are two different sign-ins. */
      + `<td>${(() => {
        const why = pinWhyNoLogin(v.code);
        if (why) return `<span class="muted" title="${esc(why)}">no cellphone or address</span>`;
        const bits = [];
        if (vpPhone(v.phone).length >= 10)
          bits.push(`<button class="ghost" data-pin="${esc(v.code)}" style="padding:2px 9px;font-size:12px" title="Builds a phone-and-PIN login from their cellphone.">Set up</button>`);
        if (pinCanLink(v.code))
          bits.push(`<button class="ghost" data-pinlink="${esc(v.code)}" style="padding:2px 9px;font-size:12px" title="Points ${esc(String(v.email || '').trim())} at this vendor. The account must already exist.">Link email</button>`);
        return bits.join(' ');
      })()}</td></tr>`;
  }).join('');
  ptOpenDialog({
    title: 'Vendors · name, kind, email and cellphone',
    subtitle: 'The name is what every screen calls this firm, and correcting it here corrects it '
      + 'everywhere, including the portal they sign in to. The kind says what a firm does, and sets '
      + 'what an order to them is assumed to be for. '
      + 'A login opens the portal, where a vendor sees their own orders and records what they send '
      + 'back — printing or job work alike. It is built on their cellphone.',
    note: 'An email lets a printer set their own password. A cellphone gets them a PIN instead. '
      + 'Either works; both is better.',
    html: `<div class="xlwrap" style="max-height:42vh;border:1px solid var(--line);border-radius:10px">`
      + `<table class="xl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
      + (ME.admin ? `<div class="ptbox" style="margin-top:12px"><div class="ptbox-t">Add a vendor</div>
          <div class="ptgrid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
            <label>Code<input id="vmnCode" type="text" value="${esc(vmNextCode())}"
              style="font-family:ui-monospace,monospace;text-transform:uppercase"></label>
            <label>Name<input id="vmnName" type="text" placeholder="what they are called"></label>
            <label>Kind<select id="vmnCat">${VENDOR_CATS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>
            <label>Cellphone<input id="vmnPhone" type="text" placeholder="10 digits"></label>
            <label>Email<input id="vmnEmail" type="email" placeholder="their own address"></label>
          </div>
          <div class="toolbar" style="margin-top:8px"><button id="vmnAdd">Add this vendor</button>
            <span class="muted" style="font-size:11.5px;flex:1 1 200px">Saved to the vendor master, so the
              production app sees them too. Give them a login from the list above afterwards.</span></div>
        </div>` : ''),
    onSave: ME.admin ? vmSave : null,
    saveLabel: 'Save to the vendor master',
  });
  if ($('vmnAdd')) $('vmnAdd').onclick = async () => {
    $('vmnAdd').disabled = true;
    ptDlgMsg('Adding…');
    try { const err = await vmAddPrinter(); if (err) ptDlgMsg(err, true); }
    catch (e) { ptDlgMsg('Not added: ' + (e.message || e), true); }
    if ($('vmnAdd')) $('vmnAdd').disabled = false;
  };
}

async function vmSave() {
  const rows = voAllVendors();
  const updates = {}, bad = [];
  const now = new Date().toISOString();
  rows.forEach(v => {
    const eEl = document.querySelector(`[data-vm="email"][data-k="${v._key}"]`);
    const pEl = document.querySelector(`[data-vm="phone"][data-k="${v._key}"]`);
    const cEl = document.querySelector(`[data-vm="category"][data-k="${v._key}"]`);
    const nEl = document.querySelector(`[data-vm="desc"][data-k="${v._key}"]`);
    const was = String(v.desc || v.name || '').trim();
    const name = nEl ? String(nEl.value || '').trim() : was;
    /* A NAME IS NOT OPTIONAL. Every screen falls back to the code when it is missing, so an
     * accidentally-cleared box would quietly turn this vendor into VND007 everywhere at once. */
    if (nEl && !name) { bad.push(`${v.code}: a vendor needs a name. Type it, or press Cancel.`); return; }
    if (name !== was) {
      updates['pt_masters/vendor/' + v._key + '/desc'] = name;
      /* The login rows carry a COPY of the name: pt_vendorByEmail is what the vendor portal reads to
       * say whose orders it is showing, and pt_loginDir is the old tool's PIN directory. A rename
       * that stopped at the master would greet the vendor by the typo every time they signed in.
       * Only this vendor's own row is touched — a row left behind by a different firm under the same
       * code is not theirs to rename. */
      const cached = (VO.map && VO.map[v.code]) || {};
      const cph = vpPhone(cached.phone);
      if (cph && cph === vpPhone(v.phone)) {
        updates['pt_vendorMap/' + v.code + '/name'] = name;
        updates['pt_loginDir/' + cph + '/name'] = name;
        if (vmValid(cached.email)) updates['pt_vendorByEmail/' + vpEmailKey(cached.email) + '/name'] = name;
      }
    }
    /* Each field on its own path, so a category changed here does not overwrite an email the old
     * production tool changed a second ago. */
    if (cEl && String(cEl.value || '') !== String(v.category || '')) {
      updates['pt_masters/vendor/' + v._key + '/category'] = String(cEl.value || '');
    }
    const email = eEl ? String(eEl.value || '').trim().toLowerCase() : '';
    const phone = pEl ? vpPhone(pEl.value) : '';
    /* Named by what is IN THE BOX, so a vendor being renamed and mistyped in the same press is told
     * off under the name Ravi is looking at. */
    if (email && !vmValid(email)) { bad.push(`${name || v.code}: "${email}" is not an email address.`); return; }
    if (pEl && String(pEl.value || '').trim() && phone.length < 10)
      bad.push(`${name || v.code}: "${String(pEl.value).trim()}" is not a ten-digit cellphone.`);
    // Each field on its own path, so nothing the production tool changed meanwhile is overwritten.
    if (email !== String(v.email || '').trim().toLowerCase()) {
      updates['pt_masters/vendor/' + v._key + '/email'] = email;
    }
    if (phone !== vpPhone(v.phone)) updates['pt_masters/vendor/' + v._key + '/phone'] = phone;
  });
  if (bad.length) return bad.slice(0, 4).join(' ') + (bad.length > 4 ? ` And ${bad.length - 4} more.` : '');
  if (!Object.keys(updates).length) return 'Nothing was changed.';
  /* Only the master paths carry a vendor key here; pt_vendorMap and the two login rows are keyed by
   * code and email, and stamping modifiedAt onto those would invent a vendor called "vendorMap". */
  const touched = [...new Set(Object.keys(updates)
    .filter(k => k.indexOf('pt_masters/vendor/') === 0).map(k => k.split('/')[2]))];
  touched.forEach(k => {
    updates['pt_masters/vendor/' + k + '/modifiedAt'] = now;
    updates['pt_masters/vendor/' + k + '/modifiedBy'] = ME.email;
  });
  await ptPatch(updates);
  /* The cached master is what every other screen reads, so it moves with the write — EVERY field of
   * it. This moved only email and phone, so a corrected name, or a changed Kind (which now decides
   * what an order to that vendor is assumed to be for), stayed stale until the page was reloaded. */
  PTG.masters.vendor = PTG.masters.vendor || {};
  Object.keys(updates).forEach(p => {
    const bits = p.split('/');                       // pt_masters/vendor/<key>/<field>
    if (bits[0] !== 'pt_masters' || bits[1] !== 'vendor' || bits.length !== 4) return;
    const row = PTG.masters.vendor[bits[2]] || {};
    row[bits[3]] = updates[p];
    PTG.masters.vendor[bits[2]] = row;
  });
  /* And the login cache this app reads, so the portal's name follows without a reload. */
  Object.keys(updates).forEach(p => {
    const m = p.match(/^pt_vendorMap\/([^/]+)\/name$/);
    if (m && VO.map && VO.map[m[1]]) VO.map[m[1]].name = updates[p];
  });
  renderVo();
  const now2 = voVendors();
  const ready = now2.filter(v => vmReal(v.email)).length;
  $('voMsg').className = 'muted';
  $('voMsg').textContent = `Vendor master updated for ${nf(touched.length)} printer(s). `
    + `${nf(ready)} of ${nf(now2.length)} now have a real email address. `
    + 'Press "Vendor access" next to map them, then each one still needs an account in this app.';
  return '';
}

$('voVendors').onclick = () => vmOpen();

/* ================= PHONE + PIN, FOR PRINTERS =================
 *
 * A printer with no email address of their own signs in with their cellphone and a PIN, exactly as
 * they do in the production tool today. Two things about it are worth being plain about.
 *
 * THE PIN *IS* THE ACCOUNT PASSWORD. Six digits is a million combinations — far weaker than a real
 * password, and Firebase throttles by IP without locking an account. It is used here because the
 * blast radius is small and bounded: a printer's account reaches ONE branch of the database, their
 * own orders, and nothing else. It would not be acceptable for a staff account that can read
 * payroll.
 *
 * THE ADDRESS IS DERIVED, NOT LOOKED UP: p<phone>@<domain>. The tool reads pt_loginDir to turn a
 * phone into an email, which means that node has to be readable BEFORE anyone signs in — and it
 * holds every staff member's cellphone too. Deriving it keeps that node shut.
 *
 * TWO DOMAINS, TRIED IN TURN. Printers were set up under @vendors-tfr.app; the factory staff under
 * @thefabricrush.com by the old tool. Only the first was ever tried, so a staff member typing their
 * own number was told their PIN was wrong — it was not, the screen was looking in one place.
 */
const PIN_DOMAIN = '@vendors-tfr.app';
/* Every address a ten-digit number could belong to, in the order they are worth trying. */
const PIN_DOMAINS = [PIN_DOMAIN, '@thefabricrush.com'];
/* Where a NEW printer login is created. One domain: a new account has to land somewhere definite. */
const pinEmail = phone => 'p' + vpPhone(phone) + PIN_DOMAIN;
const pinEmails = phone => PIN_DOMAINS.map(d => 'p' + vpPhone(phone) + d);

/* The PINs people actually pick when nobody stops them. Each one is worth more than the other
 * 999,990 combinations put together to somebody guessing. */
function pinWhyBad(pin, phone) {
  const p = String(pin || '');
  if (!/^\d{6,10}$/.test(p)) return 'A PIN is 6 to 10 digits — nothing else.';
  if (/^(\d)\1+$/.test(p)) return 'Every digit the same is the first thing anyone tries.';
  const asc = '01234567890123456789', desc = '09876543210987654321';
  if (asc.indexOf(p) >= 0 || desc.indexOf(p) >= 0) return 'Digits in order are the second thing anyone tries.';
  if (['123456', '000000', '111111', '121212', '112233', '123123', '654321', '786786'].indexOf(p) >= 0)
    return 'That is one of the most-guessed PINs there is.';
  const ph = vpPhone(phone);
  if (ph && (ph.indexOf(p) >= 0)) return 'Part of your own phone number is not a secret.';
  return '';
}
const pinRandom = () => String(Math.floor(100000 + Math.random() * 900000));

/* ---- signing in ---- */
$('pinBtn').onclick = async () => {
  const msg = $('pinErr');
  const phone = vpPhone($('pinPhone').value);
  const pin = String($('pinPin').value || '');
  const say = m => { msg.textContent = m; msg.classList.remove('hide'); };
  msg.classList.add('hide');
  if (phone.length < 10) return say('Enter your ten-digit cellphone number.');
  if (!/^\d{6,10}$/.test(pin)) return say('Your PIN is 6 to 10 digits.');
  $('pinBtn').disabled = true;
  /* Each candidate address in turn. "No such user" and "wrong PIN" come back as the same code, so a
   * genuinely wrong PIN tries both — which is the price of not reading the directory. Anything that
   * is NOT a credential failure (offline, rate-limited) stops the loop: retrying would only bury the
   * real reason under a second identical error. */
  let err = null;
  for (const email of pinEmails(phone)) {
    try { err = null; await signInWithEmailAndPassword(auth, email, pin); break; }
    catch (e) {
      err = e;
      if (!/user-not-found|invalid-credential|invalid-login|wrong-password/i.test(String(e.code || e.message || ''))) break;
    }
  }
  if (err) {
    const e = err;
    const c = String(e.code || e.message || '');
    say(/user-not-found|invalid-credential|invalid-login|wrong-password/i.test(c)
      /* One message for a wrong number and a wrong PIN, so it cannot be used to find out which
       * numbers have an account. */
      ? 'That cellphone and PIN do not match an account. Ask The Fabric Rush if you have not been set up yet.'
      : (/too-many/i.test(c) ? 'Too many attempts from here. Wait a few minutes and try again.'
                             : (e.message || String(e))));
  }
  $('pinBtn').disabled = false;
};
$('pinPin').addEventListener('keydown', e => { if (e.key === 'Enter') $('pinBtn').click(); });
$('pinToggle').onclick = () => {
  const on = $('pinBox').classList.toggle('hide');
  $('pinToggle').textContent = on ? 'Sign in with cellphone and PIN' : 'Sign in with an email address';
  $('emailBox').classList.toggle('hide', !on);
};

/* ---- the vendor changes their own PIN ---- */
async function pinChange() {
  const cur = String($('pcCur').value || ''), a = String($('pcNew').value || ''), b = String($('pcNew2').value || '');
  if (!cur) return 'Type the PIN you use now.';
  if (a !== b) return 'The two new PINs are not the same.';
  const why = pinWhyBad(a, (ME.email || '').replace(/\D/g, ''));
  if (why) return why;
  if (a === cur) return 'That is the PIN you already have.';
  // Firebase wants a fresh sign-in before it will change a password, so the current PIN is proved first.
  try { await signInWithEmailAndPassword(auth, ME.email, cur); }
  catch (e) { return 'That is not your current PIN.'; }
  const tok = await auth.currentUser.getIdToken();
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:update?key=' + FB_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: tok, password: a, returnSecureToken: true }),
  });
  const d = await r.json();
  if (d.error) return 'Could not change it: ' + (d.error.message || 'unknown error');
  // Recorded so the portal stops asking. Nothing secret is stored — only that it was changed.
  try { await ptPut('pt_vendorPin/' + vpEmailKey(ME.email), { changedAt: new Date().toISOString() }); }
  catch (e) { /* the PIN is changed either way */ }
  VP.pinFresh = true;
  renderVp();
  return '';
}

function pinOpenChange() {
  ptOpenDialog({
    title: 'Change my PIN',
    subtitle: ME.email,
    note: 'Your PIN is your password. Six to ten digits, and not something anyone could guess from '
      + 'your phone number — this is the only thing standing between your orders and anybody else.',
    html: `<div class="ptgrid" style="grid-template-columns:1fr">
      <label>The PIN I use now<input id="pcCur" type="password" inputmode="numeric" autocomplete="current-password"></label>
      <label>My new PIN<input id="pcNew" type="password" inputmode="numeric" autocomplete="new-password"></label>
      <label>Type it again<input id="pcNew2" type="password" inputmode="numeric" autocomplete="new-password"></label>
    </div>`,
    onSave: pinChange,
    saveLabel: 'Change it',
  });
}

/* ---- an admin gives a vendor their phone login ---- */
/**
 * Why this vendor cannot be given a portal login — '' when they can.
 *
 * EVERY KIND OF VENDOR MAY BE GIVEN ONE. The portal shows a vendor their own orders, and orders now
 * go out to filling firms and fabricators as much as to printers — Ravi sends them job work, and an
 * order is how they are told what is coming. A cellphone is the only thing still required, because
 * the login is built on it.
 */
function pinWhyNoLogin(code) {
  const v = voMasterRow(code);
  if (!v) return 'That vendor is not in the vendor master.';
  if (pinRoute(code)) return '';
  return `${v.desc || v.name || code} has neither a ten-digit cellphone nor an email address of their `
    + 'own. A cellphone gets them a PIN login; their own address can be linked to an account you make '
    + 'in Firebase. Add one of the two above.';
}

/**
 * How this vendor can be given a portal, if at all.
 *
 *   'pin'   a cellphone is on record: the login is BUILT here, address and PIN and all
 *   'link'  an address of their own is on record: the account exists already and only has to be
 *           pointed at this vendor
 *
 * Both, when both are there — they are different sign-ins and both are legitimate. This is the gap
 * Ravi fell into: he typed an address onto RBP-Bagru, and the only button on the row built logins
 * out of cellphones, so there was nothing to press.
 */
function pinRoute(code) {
  const v = voMasterRow(code); if (!v) return '';
  if (vpPhone(v.phone).length >= 10) return 'pin';
  return vmReal(v.email) ? 'link' : '';
}
/** Can this vendor's own address be pointed at them? Independent of whether a PIN login exists. */
const pinCanLink = code => { const v = voMasterRow(code); return !!(v && vmReal(v.email)); };

/**
 * Point an address that already has an account at the vendor it belongs to.
 *
 * No account is created: this is for an address you made in Firebase yourself. What was missing is
 * only the answer to "which vendor is this?", which the portal asks on every load.
 */
async function pinLink(code) {
  if (!ME.admin) return 'Only an admin can link a vendor’s login.';
  const v = voMasterRow(code);
  if (!v) return 'That vendor is not in the vendor master.';
  const email = String(v.email || '').trim().toLowerCase();
  if (!vmReal(email)) return `${v.desc || v.name || code} has no email address of their own on the master record.`;
  const name = v.desc || v.name || code;
  const ph = vpPhone(v.phone);
  if (!confirm(`Link ${email} to ${name} (${code})?\n\n`
    + 'They will see that vendor\'s orders, and nothing else in this app — their access is set to the '
    + 'Vendor Portal alone, replacing whatever it is now.\n\n'
    + 'No account is created. This address must already have one.')) return '';

  /* The Vendor Portal, and NOTHING else. A vendor is an outside firm, and any other section ticked
   * for them is something they can read. */
  await setDoc(doc(db, 'perms', email), { admin: false, approve: false, repl: false,
    replTabs: ['vend'], replProj: false, prod: false, tabs: [], brands: [],
    at: serverTimestamp(), by: ME.email });

  /* Added, never swapped: the phone-built key stays where it is, so a PIN login that already works
   * keeps working. A vendor may reach their orders by either road. */
  const patch = { ['pt_vendorByEmail/' + vpEmailKey(email)]: { code, name, phone: ph } };
  patch['pt_vendorMap/' + code] = { email, phone: ph, name };
  if (ph) patch['pt_loginDir/' + ph] = { email, name, updatedAt: new Date().toISOString() };
  await ptPatch(patch);
  VO.map = VO.map || {};
  VO.map[code] = { email, phone: ph, name };
  renderVo();
  $('voMsg').className = 'muted';
  $('voMsg').textContent = `${email} is now ${name}. They see that vendor's orders and nothing else. `
    + 'Ask them to sign out and back in.';
  return '';
}

async function pinGrant(code) {
  if (!ME.admin) return 'Only an admin can set up a vendor’s login.';
  /* Checked here as well as on the button: a page left open while a vendor's cellphone is cleared
   * still has the old button drawn on it. */
  const why = pinWhyNoLogin(code);
  if (why) return why;
  const v = voMasterRow(code);
  const ph = vpPhone(v.phone);
  const email = pinEmail(ph);
  const pin = pinRandom();

  /* The account is created straight against the identity service rather than through the SDK,
   * because the SDK would sign this admin OUT and in as the printer. A raw call leaves the admin's
   * own session exactly where it was. */
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FB_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pin, returnSecureToken: false }),
  });
  const d = await r.json();
  const existed = !!(d.error && /EMAIL_EXISTS/i.test(d.error.message || ''));
  if (d.error && !existed) return 'Could not create the login: ' + (d.error.message || 'unknown error');

  // The Vendor Portal, and NOTHING else. No perms.repl, so this account reads nothing in Firestore.
  await setDoc(doc(db, 'perms', email), { admin: false, approve: false, repl: false,
    replTabs: ['vend'], replProj: false, prod: false, tabs: [], brands: [],
    at: serverTimestamp(), by: ME.email });

  /* desc is what a master row calls a vendor — it has no name field, so v.name was always undefined
   * and every one of these four rows was named after the vendor's own code. */
  const nm = v.desc || v.name || code;
  await ptPatch({
    ['pt_vendorMap/' + code]: { email, phone: ph, name: nm },
    ['pt_loginDir/' + ph]: { email, name: nm, updatedAt: new Date().toISOString() },
    ['pt_vendorByEmail/' + vpEmailKey(email)]: { code, name: nm, phone: ph },
  });
  VO.map[code] = { email, phone: ph, name: nm };
  renderVo();

  $('voMsg').className = 'muted';
  $('voMsg').textContent = existed
    ? `${v.name || code} already had a login on ${ph}. Their access was refreshed, but the PIN was NOT changed — `
      + 'they set that themselves from "Change my PIN" after signing in.'
    : `${v.name || code} can now sign in with ${ph} and the PIN ${pin}. Give them that PIN once, in person or `
      + 'on a call — it is their password. They will be asked to change it the first time they sign in.';
  return '';
}

/* ---- adding a printer who is not in the master at all ----
 *
 * The master is a keyed object whose keys run r0, r1, r2… — one past the highest is the next one.
 * If that pattern ever stops holding, a timestamped key is used instead: a wrong guess would
 * overwrite an existing printer, and a slightly odd key never will.
 */
function vmNextKey() {
  const keys = Object.keys((PTG.masters || {}).vendor || {});
  const ns = keys.map(k => (/^r(\d+)$/.test(k) ? +k.slice(1) : -1));
  if (keys.length && ns.every(n => n >= 0)) return 'r' + (Math.max(...ns) + 1);
  return 'v_' + Date.now().toString(36);
}

/** The next free VND number, counting every vendor in the master, not just the printers. */
function vmNextCode() {
  const all = ptList((PTG.masters || {}).vendor);
  let n = 0;
  all.forEach(v => { const m = String(v.code || '').match(/^VND(\d+)$/i); if (m && +m[1] > n) n = +m[1]; });
  return 'VND' + String(n + 1).padStart(3, '0');
}

async function vmAddPrinter() {
  if (!ME.admin) return 'Only an admin can add a vendor.';
  const code = String($('vmnCode').value || '').trim().toUpperCase();
  const name = String($('vmnName').value || '').trim();
  const phone = vpPhone($('vmnPhone').value);
  const email = String($('vmnEmail').value || '').trim().toLowerCase();
  if (!code) return 'Give the printer a code.';
  if (!/^[A-Z0-9_-]+$/.test(code)) return 'A code is letters, digits, - and _ only — it becomes part of a database key.';
  if (ptList((PTG.masters || {}).vendor).some(v => String(v.code || '').toUpperCase() === code))
    return `${code} is already in the vendor master.`;
  if (!name) return 'Give the printer a name.';
  if (email && !vmValid(email)) return `"${email}" is not an email address.`;
  if (String($('vmnPhone').value || '').trim() && phone.length < 10) return 'A cellphone is ten digits.';
  /* A login is built on one of these two — but only a block printer is ever offered one, so a filling
   * firm or a fabricator may be entered with neither. */
  if (!phone && !email && String(($('vmnCat') || {}).value || 'Printer').trim() === 'Printer') {
    return 'A printer needs a cellphone or an email — one of them is what their portal login is built on.';
  }

  const key = vmNextKey();
  const now = new Date().toISOString();
  const cat = String(($('vmnCat') || {}).value || 'Printer').trim();
  if (VENDOR_CATS.indexOf(cat) < 0) return 'Pick what kind of firm this is.';
  const row = { code, name, phone, email, category: cat, active: true,
    address: '', gstin: '', poc: '', state: '', stateCode: '',
    createdAt: now, createdBy: ME.email, modifiedAt: now, modifiedBy: ME.email };
  await ptPut('pt_masters/vendor/' + key, row);
  PTG.masters.vendor = PTG.masters.vendor || {};
  PTG.masters.vendor[key] = row;
  renderVo();
  await vmOpen();                       // reopened so the new printer is in the list, ready to set up
  ptDlgMsg(`${name} added as ${code}. `
    + (email ? 'They can be given a login on their own email address.'
             : 'Press "Set up" on their row to create a phone login.'));
  return '';
}

