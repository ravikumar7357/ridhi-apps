/* ================= ACCESS · SHADOW TEST (Ravi, 10 Nov 2026) =================
 *
 * ONLY ON THE TEST ERP AND THE LOCAL PAGE. On the real ERP this file does nothing at all.
 *
 * The ERP keeps deciding access from Firebase, exactly as before. This file only ASKS the new database (Supabase, project
 * "ERP TEST") the same question — "which boxes does this person have?" — compares the two answers and the two times, shows a
 * small line at the bottom of the screen, and records the result in ERP TEST (core.shadow_log) so the access check page can
 * show everybody's results. Nothing in the ERP depends on the answer.
 *
 * The person is the one signed in to the ERP: Supabase checks their Firebase sign-in itself (no second password), and
 * core.my_access() answers for that person only. The key below is ERP TEST's PUBLISHABLE key — the kind meant for browsers;
 * it opens nothing but those two functions.
 *
 * Remove this file (and its line in ORDER, and the 3 lines in core/auth.js) and nothing of it is left.
 */
const ASH = {
  on: typeof window !== 'undefined' && (!!window.__TEST_ERP || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)),
  url: 'https://koxcyzwwbrptauplblpe.supabase.co',
  key: 'sb_publishable_uQ2wIbolOxS6x1BApcedXw_31C55OyD',   // ERP TEST publishable key (made for browsers; opens only my_access + shadow_report)
};
/* The 19 extra rights, as the Access page names them (same keys as the perms record). */
const ASH_RIGHTS = ['approve', 'replProj', 'soApprove', 'vreqApprove', 'rateApprove', 'rfdApprove', 'rfdSend', 'vlogAccept', 'shopAssign',
  'b2bAssign', 'prodEdit', 'attendMark', 'empEdit', 'fgiEntry', 'fgiEdit', 'accEntry', 'accEdit', 'mdbEdit', 'accessView'];
/* ERP screens the new database does not carry on purpose: the admins' own dashboard (admins get everything anyway). */
const ASH_NOT_CARRIED = ['dash'];

/** Firebase's answer, as boxes: the same reading the sign-in above makes (perms.replTabs, the old "whole ERP" switch, the rights). */
function ashFirebaseBoxes(d, email) {
  if (email === 'ravi@thefabricrush.com' || (d && d.admin === true)) return { admin: true, boxes: [] };
  if (!d) return { admin: false, boxes: [] };
  let rt = Array.isArray(d.replTabs) ? d.replTabs.filter(t => REPL_TABS.includes(t)) : [];
  if (!rt.length && d.repl === true) rt = REPL_TABS.filter(k => !['shopprod', 'shopret'].includes(k));
  rt = rt.filter(t => !ASH_NOT_CARRIED.includes(t));
  const boxes = [...rt.map(t => 'erp:' + t), ...ASH_RIGHTS.filter(k => d[k] === true).map(k => 'right:' + k)];
  return { admin: false, boxes: [...new Set(boxes)].sort() };
}

async function ashCall(fn, token, body) {
  const r = await fetch(ASH.url + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: ASH.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Content-Profile': 'core', 'Accept-Profile': 'core' },
    body: JSON.stringify(body || {}),
  });
  if (!r.ok) throw new Error('ERP TEST answered ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/** Called once after sign-in by core/auth.js with the perms record Firebase gave and how long that took. Never throws. */
async function accessShadow(user, permsDoc, firebaseMs) {
  if (!ASH.on || !user) return;
  if (!ASH.key) { ashShow({ state: 'off', firebaseMs }); return; }
  const email = String(user.email || '').toLowerCase();
  const fb = ashFirebaseBoxes(permsDoc, email);
  let token, rows, supabaseMs = null;
  try {
    token = await user.getIdToken();
    const t0 = performance.now();
    rows = await ashCall('my_access', token);
    supabaseMs = Math.round(performance.now() - t0);
  } catch (e) { ashShow({ state: 'error', firebaseMs, why: e.message }); return; }

  const sbAdmin = rows.some(x => x.is_admin);
  const sb = rows.map(x => x.item_key).filter(k => /^(erp|right):/.test(k)).sort();   // Sellora's screens are not the ERP's
  let missing = [], extra = [];
  if (fb.admin || sbAdmin) { if (fb.admin !== sbAdmin) (fb.admin ? missing : extra).push('admin'); }
  else { missing = fb.boxes.filter(k => !sb.includes(k)); extra = sb.filter(k => !fb.boxes.includes(k)); }
  const matched = !missing.length && !extra.length;
  ashShow({ state: matched ? 'same' : 'differs', firebaseMs, supabaseMs, missing, extra });
  ashCall('shadow_report', token, { p_section: 'access', p_matched: matched, p_firebase_ms: firebaseMs, p_supabase_ms: supabaseMs,
    p_missing: missing, p_extra: extra, p_build: (window.__TEST_ERP && window.__TEST_ERP.sha) || 'local' }).catch(e => console.warn('[shadow] report not saved:', e.message));
  console.info('[shadow] access', matched ? 'same' : 'DIFFERS', { firebaseMs, supabaseMs, missing, extra });
}

/* ================= CHECK EVERYONE (Ravi, 10 Nov) =================
 * For an admin or an Access viewer (the people Firebase lets read everybody's access): every person's access, read LIVE
 * from Firebase (perms/*), against what the new database gives each of them — one list, all at once, saved to ERP TEST.
 * Read only on both sides. Shown as a second small button beside the access line. */
const ASH_NOT_CARRIED_EMPTY = true;   // people with no real box left (only the old production app) are not carried — shown as such, not as a fault

function ashMayCheckAll() { return !!(typeof ME !== 'undefined' && ME && (ME.admin || (ASH_DOC && ASH_DOC.accessView === true))); }

async function ashCheckEveryone() {
  const out = ashPanel('Checking everyone… reading Firebase and the new database');
  try {
    const token = await auth.currentUser.getIdToken();
    const t0 = performance.now();
    const snap = await getDocs(collection(db, 'perms'));
    const firebaseMs = Math.round(performance.now() - t0);
    const fb = {};
    snap.forEach(d => { const email = String(d.id || '').trim().toLowerCase(); if (email.includes('@')) fb[email] = ashFirebaseBoxes(d.data(), email); });

    const t1 = performance.now();
    const rows = await ashCall('access_of_everyone', token);
    const supabaseMs = Math.round(performance.now() - t1);
    const sb = {};
    rows.forEach(r => { const p = sb[r.email] = sb[r.email] || { name: r.name, role: r.role_code, admin: false, boxes: [] };
      if (r.via === 'admin') p.admin = true; else if (/^(erp|right):/.test(r.item_key)) p.boxes.push(r.item_key); });

    const results = [];
    new Set([...Object.keys(fb), ...Object.keys(sb)]).forEach(email => {
      const f = fb[email], s = sb[email];
      let missing = [], extra = [], note = '';
      if (f && !s) {
        if (!f.admin && !f.boxes.length && ASH_NOT_CARRIED_EMPTY) note = 'not carried (no access left)';
        else missing = f.admin ? ['admin'] : f.boxes;
      } else if (!f && s) { note = 'not in Firebase'; extra = s.admin ? ['admin'] : s.boxes; }
      else if (f.admin || s.admin) { if (f.admin !== s.admin) (f.admin ? missing : extra).push('admin'); }
      else { const sbx = s.boxes.sort(); missing = f.boxes.filter(k => !sbx.includes(k)); extra = sbx.filter(k => !f.boxes.includes(k)); }
      results.push({ email, name: s ? s.name : '', role: s ? s.role : '', matched: !missing.length && !extra.length, missing, extra, note });
    });
    results.sort((a, b) => (a.matched - b.matched) || a.email.localeCompare(b.email));

    const bad = results.filter(r => !r.matched).length;
    let saved = '';
    try { const n = await ashCall('shadow_report_everyone', token, { p_results: results.filter(r => !r.note.startsWith('not carried')).map(({ email, matched, missing, extra }) => ({ email, matched, missing, extra })),
      p_firebase_ms: firebaseMs, p_supabase_ms: supabaseMs, p_build: (window.__TEST_ERP && window.__TEST_ERP.sha) || 'local' }); saved = ' · saved ' + n + ' results to ERP TEST'; }
    catch (e) { saved = ' · not saved: ' + e.message; }

    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    out.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap">
        <b style="font-size:15px">${bad ? '✗ ' + bad + ' of ' + results.length + ' differ' : '✓ All ' + results.length + ' people: the new database gives the same access'}</b>
        <span style="color:#555">Firebase ${firebaseMs} ms (everyone) · Supabase ${supabaseMs} ms (everyone)${esc(saved)}</span></div>
      <div style="max-height:60vh;overflow:auto;margin-top:10px"><table style="border-collapse:collapse;width:100%;font-size:12.5px">
      <thead><tr>${['Person', 'Role in the new database', 'Result'].map(h => `<th style="text-align:left;padding:5px 8px;border-bottom:1px solid #ddd">${h}</th>`).join('')}</tr></thead><tbody>` +
      results.map(r => `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(r.name || '')}<div style="color:#666">${esc(r.email)}</div></td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(r.role || '—')}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #eee;color:${r.matched ? '#1d7a4a' : '#b3261e'}">${r.matched ? '✓ same' + (r.note ? ' · ' + esc(r.note) : '') : '✗ ' + esc([r.note, r.missing.length && 'missing: ' + r.missing.join(', '), r.extra.length && 'extra: ' + r.extra.join(', ')].filter(Boolean).join(' · '))}</td></tr>`).join('') +
      '</tbody></table></div>';
  } catch (e) { out.textContent = '! Could not check everyone: ' + e.message; }
}

/** The results panel (one, reused). */
function ashPanel(msg) {
  let p = document.getElementById('ashPanel');
  if (!p) {
    p = document.createElement('div'); p.id = 'ashPanel';
    p.style.cssText = 'position:fixed;left:calc(12px + env(safe-area-inset-left,0px));right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(102px + env(safe-area-inset-bottom,0px));'
      + 'z-index:9999;background:#fff;color:#1b1b1b;border:1px solid rgba(0,0,0,.15);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:14px 16px;font:13px/1.45 system-ui,sans-serif;max-width:900px';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
    close.style.cssText = 'position:absolute;top:8px;right:10px;font:12px system-ui;border:1px solid #ccc;border-radius:6px;background:#fff;padding:3px 8px;cursor:pointer';
    close.onclick = () => p.remove();
    const body = document.createElement('div'); body.id = 'ashPanelBody'; body.style.paddingRight = '56px';
    p.append(close, body); document.body.appendChild(p);
  }
  const body = document.getElementById('ashPanelBody'); body.textContent = msg; return body;
}

/** The small line at the bottom left. Click it to see the details. */
function ashShow(r) {
  let el = document.getElementById('ashLine');
  if (!el) {
    el = document.createElement('button');
    el.id = 'ashLine'; el.type = 'button';
    /* above the test ERP's own "R1 · test ERP" label, which sits in the bottom-left corner */
    el.style.cssText = 'position:fixed;left:calc(12px + env(safe-area-inset-left,0px));bottom:calc(58px + env(safe-area-inset-bottom,0px));z-index:10000;'
      + 'font:12px/1.3 system-ui,sans-serif;padding:7px 11px;border-radius:999px;border:1px solid rgba(0,0,0,.15);cursor:pointer;max-width:calc(100vw - 24px);text-align:left';
    document.body.appendChild(el);
    el.onclick = () => { el.dataset.open = el.dataset.open ? '' : '1'; ashShow(el._r); };
  }
  el._r = r;
  const ms = v => v == null ? '–' : v + ' ms';
  const head = { same: '✓ Access · Supabase gives the same', differs: '✗ Access · Supabase differs', error: '! Access · Supabase not reached', off: 'Access shadow test is off (no key yet)' }[r.state];
  el.style.background = r.state === 'same' ? '#e3f4ea' : r.state === 'differs' ? '#fde4e1' : '#fff4d6';
  el.style.color = '#1b1b1b';
  let text = head + ' · Firebase ' + ms(r.firebaseMs) + (r.state === 'same' || r.state === 'differs' ? ' · Supabase ' + ms(r.supabaseMs) : '');
  if (el.dataset.open) {
    if (r.missing && r.missing.length) text += '\nMissing in Supabase: ' + r.missing.join(', ');
    if (r.extra && r.extra.length) text += '\nExtra in Supabase: ' + r.extra.join(', ');
    if (r.why) text += '\n' + r.why;
  }
  el.textContent = text;
  el.style.whiteSpace = 'pre-line';
  // the "Check everyone" button, beside the line — only for an admin or an Access viewer
  if (ashMayCheckAll() && !document.getElementById('ashAll')) {
    const b = document.createElement('button');
    b.id = 'ashAll'; b.type = 'button'; b.textContent = 'Shadow check · everyone';
    b.style.cssText = 'position:fixed;bottom:calc(58px + env(safe-area-inset-bottom,0px));z-index:10000;font:12px/1.3 system-ui,sans-serif;padding:7px 11px;'
      + 'border-radius:999px;border:1px solid rgba(0,0,0,.2);background:#1b1b1b;color:#fff;cursor:pointer';
    b.onclick = ashCheckEveryone;
    document.body.appendChild(b);
    const place = () => { const r = el.getBoundingClientRect(); b.style.left = Math.round(r.right + 8) + 'px'; };
    place(); new ResizeObserver(place).observe(el);
  }
}
