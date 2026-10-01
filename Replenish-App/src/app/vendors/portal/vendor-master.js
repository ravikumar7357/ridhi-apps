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

