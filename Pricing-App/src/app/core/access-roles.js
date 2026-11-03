/* ================= ACCESS BY ROLE (Ravi, 3 Nov: "replace with this design in the access tab") =================
 *
 * The Access page shows everybody by DEPARTMENT and ROLE — Production / Corporate / Shipping / Other, each role with the people in
 * it — instead of one long table of emails. Nothing about access itself changes: a person's access is still their own record,
 * perms/<email>, saved by the same Grant or update form below (Save access). A role is only a NAMED SET OF BOXES:
 *   · a person whose boxes are exactly a role's is shown in that role;
 *   · anybody else is a SPECIAL CASE — their own boxes, shown apart;
 *   · "+ Add user" and a role's "+ Add person" fill the form with that role's boxes; the admin types the email and saves.
 * The roles are Ravi's role chart (v2, 2 Nov 2026), the same as the prototype page "Access by role". */
const ACR_DEPTS = [
  { key: 'production', name: 'Production', groups: [
    { name: 'Planning (PPC)', roles: [
      { key: 'planner', name: 'Planner', erp: ['ord', 'palloc', 'pack', 'flppc'], rights: ['prodEdit', 'b2bAssign'], cannot: 'Approve vendor requests or rates' },
      { key: 'b2bdesk', name: 'B2B order desk', erp: ['so', 'vreq'], cannot: 'Approve its own sales orders or vendor requests' }] },
    { name: 'Shop floor', roles: [
      { key: 'floor', name: 'Floor supervisor', erp: ['pcut', 'pbase', 'flcut', 'flraw', 'flwip', 'att'], rights: ['prodEdit', 'attendMark'], cannot: 'See pay or rates' },
      { key: 'qc', name: 'QC checker', erp: ['qc', 'qcalt', 'qcret'] }] },
    { name: 'Store', roles: [
      { key: 'fabric', name: 'Fabric storekeeper', erp: ['fab', 'gdesk', 'gdled', 'gdledit', 'rfd', 'fldem'], rights: ['rfdSend'], cannot: 'Approve shrinkage over 5% or extra cloth' },
      { key: 'accstore', name: 'Accessories storekeeper', erp: ['acc', 'flacc'], rights: ['accEntry'], cannot: 'Edit or delete' }] },
    { name: 'Vendors & printers', roles: [
      { key: 'vendordesk', name: 'Vendor desk', erp: ['vord', 'rfd', 'vlog'], rights: ['vlogAccept'], cannot: 'Approve vendor rates' }] }] },
  { key: 'corporate', name: 'Corporate', groups: [
    { name: 'Management', roles: [
      { key: 'director', name: 'Director', sellora: 'all', erp: 'director', rights: ['soApprove', 'vreqApprove', 'rateApprove', 'approve'], limit: 'Not view only: can still enter data where a screen allows it' }] },
    { name: 'Amazon', roles: [
      { key: 'amazonhead', name: 'Amazon head', sellora: 'all', erp: ['repl', 'article', 'target', 'top', 'fba'], rights: ['replProj'] },
      { key: 'listing', name: 'Listing executive', sellora: ['opt', 'img', 'lerr', 'basket', 'health', 'lrules', 'audit', 'bsr', 'new', 'pr'], erp: ['pmdb'], cannot: 'Change the Master Database' },
      { key: 'ads', name: 'Ads executive', sellora: ['sales', 'weekly', 'trends', 'st', 'plc'], limit: 'One brand: tick it in the Advertising card' }] },
    { name: 'Shopify / website', roles: [
      { key: 'shopify', name: 'Shopify executive', erp: ['shop', 'adj', 'shopify'], rights: ['shopAssign'] },
      { key: 'returns', name: 'Returns executive', erp: ['shopret'], cannot: 'See the orders table or production' }] },
    { name: 'HR & accounts', roles: [
      { key: 'hr', name: 'HR executive', erp: ['att'], rights: ['empEdit'], cannot: 'See pay, rates or slips' },
      { key: 'accountant', name: 'Accountant', sellora: ['profit'], erp: ['hr', 'ka'], rights: ['rateApprove'], cannot: 'Add or remove employees' }] },
    { name: 'IT & master data', roles: [
      { key: 'itadmin', name: 'IT admin', admin: true, limit: 'Full Admin, including pay and granting access. Keep to one person' },
      { key: 'masterdata', name: 'Master data keeper', erp: ['pmdb', 'mst'], rights: ['mdbEdit'], cannot: 'Orders, stock or pay' }] }] },
  { key: 'shipping', name: 'Shipping', groups: [
    { name: 'Packing', roles: [{ key: 'packer', name: 'Packer', erp: ['pack'] }] },
    { name: 'Finished goods & FBA', roles: [
      { key: 'fgclerk', name: 'Finished goods clerk', erp: ['fgi'], rights: ['fgiEntry'], cannot: 'Edit or delete' },
      { key: 'fbadispatch', name: 'FBA dispatcher', erp: ['fba', 'fgi'], limit: 'Accepting stays with the Amazon head' }] }] },
  { key: 'other', name: 'Other', groups: [
    { name: 'Outside partners', roles: [{ key: 'vendor', name: 'Printer / vendor', erp: ['vend'], limit: 'Own orders only' }] },
    { name: 'Temporary', roles: [{ key: 'auditor', name: 'Auditor / guest', erp: ['rep'], limit: 'Does not end by itself — remove when the audit is over' }] }] },
];
/* the extra rights a record can hold — the same field names Save access writes */
const ACR_RIGHTS = ['approve', 'replProj', 'soApprove', 'vreqApprove', 'rateApprove', 'rfdApprove', 'rfdSend', 'vlogAccept', 'shopAssign', 'b2bAssign',
  'prodEdit', 'attendMark', 'empEdit', 'fgiEntry', 'fgiEdit', 'accEntry', 'accEdit', 'mdbEdit'];
let ACR = { view: 'overview', open: '', q: '', addOpen: false };

const acrEsc = s => String(s == null ? '' : s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const acrSellAll = () => TABS.filter(t => !HIDDEN_TABS.includes(t) && !TAB_INHERIT[t]);
const acrErpAll = () => REPL_SECTIONS.map(([k]) => k);
const acrRoles = () => ACR_DEPTS.flatMap(d => d.groups.flatMap(g => g.roles.map(r => Object.assign({ dept: d.key, deptName: d.name, group: g.name }, r))));
/** What a role grants, as sets: { admin, s: Sellora tabs, e: ERP sections, r: rights }. */
function acrRoleAccess(role) {
  if (role.admin) return { admin: true, s: [], e: [], r: [] };
  const s = role.sellora === 'all' ? acrSellAll() : (role.sellora || []).slice();
  const e = role.erp === 'director' ? acrErpAll().filter(k => !['shopprod', 'shopret', 'vend', 'gdappr', 'vpview', 'shpacc', 'fgacc'].includes(k)) : (role.erp || []).slice();
  return { admin: false, s, e, r: (role.rights || []).slice() };
}
/** A person's record as the same sets. The whole Replenishment app (repl with no sections chosen) is no role's: a special case. */
function acrPersonAccess(p) {
  if (p.admin) return { admin: true, s: [], e: [], r: [] };
  const sellOk = acrSellAll(), erpOk = acrErpAll();
  return { admin: false, whole: !!(p.repl && !(p.replTabs || []).length), s: (p.tabs || []).filter(t => sellOk.includes(t)), e: (p.replTabs || []).filter(k => erpOk.includes(k)),
    r: ACR_RIGHTS.filter(k => p[k] === true) };
}
const acrSame = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const acrMatch = (pa, ra) => (pa.admin || ra.admin) ? pa.admin === ra.admin : !pa.whole && acrSame(pa.s, ra.s) && acrSame(pa.e, ra.e) && acrSame(pa.r, ra.r);
/** Everybody on the list, each in the role their boxes match, else a special case. The owner is an admin like any other. */
function acrPlace() {
  const roles = acrRoles(), out = new Map(roles.map(r => [r.key, []])), special = [];
  (ACCESS_ROWS || []).forEach(p => {
    const pa = acrPersonAccess(p), hit = roles.find(r => acrMatch(pa, acrRoleAccess(r)));
    if (hit) out.get(hit.key).push(p); else special.push(p);
  });
  return { roles, by: out, special };
}
function acrPills(a) {
  if (a.admin) return '<span class="acr-pill acr-admin">Everything · Admin</span>';
  if (a.whole) return '<span class="acr-pill">whole Replenishment app</span>';
  const p = [];
  if (a.s.length) p.push(`<span class="acr-pill">${a.s.length} Sellora</span>`);
  if (a.e.length) p.push(`<span class="acr-pill">${a.e.length} Fabricrush</span>`);
  if (a.r.length) p.push(`<span class="acr-pill">${a.r.length} right${a.r.length > 1 ? 's' : ''}</span>`);
  return p.join('') || '<span class="acr-pill">nothing</span>';
}
function acrInitials(email) {
  const parts = String(email).split('@')[0].split(/[._\-\d]+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || '?').slice(0, 2)).toUpperCase();
}
const acrAv = email => `<span class="acr-av acr-c${[...String(email)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 4}" title="${acrEsc(email)}">${acrEsc(acrInitials(email))}</span>`;
function acrPerson(p, roleName) {
  return `<div class="acr-person${ACR.q && p.email.includes(ACR.q) ? ' acr-hit' : ''}">${acrAv(p.email)}<div style="flex:1;min-width:0"><div class="acr-mail">${acrEsc(p.email)}</div>`
    + (roleName ? `<div class="muted" style="font-size:12px">${acrEsc(roleName)}</div>` : '') + `</div>`
    + `<button type="button" class="xbtn" data-acr-edit="${acrEsc(p.email)}">Edit</button> <button type="button" class="xbtn" data-acr-del="${acrEsc(p.email)}">Remove</button></div>`;
}

/** The whole page above the Grant or update form. */
function acrRender() {
  const box = $('accRoles'); if (!box || !ME.admin) return;
  const { roles, by, special } = acrPlace(), all = ACCESS_ROWS || [], q = ACR.q;
  const admins = all.filter(p => p.admin).length, inRole = all.length - special.length;
  const deptCount = d => roles.filter(r => r.dept === d.key).reduce((n, r) => n + by.get(r.key).length, 0);
  const nav = (v, label, n, extra) => `<button type="button" class="acr-nav${ACR.view === v ? ' on' : ''}" data-acr-view="${v}">${acrEsc(label)}<span class="acr-n${extra ? ' ' + extra : ''}">${n}</span></button>`;
  const side = `<aside class="acr-side">${nav('overview', 'Overview', all.length)}<div class="acr-lbl">Departments</div>`
    + ACR_DEPTS.map(d => nav('dept:' + d.key, d.name, deptCount(d))).join('')
    + `<div class="acr-sep"></div>${nav('special', 'Special cases', special.length, 'acr-sp')}${nav('people', 'All people', all.length)}`
    + `<div class="acr-note">A role only fills the boxes. Each person's access is still their own record, saved by Save access below.</div></aside>`;

  const roleTable = d => {
    let last = '';
    const rows = roles.filter(r => r.dept === d.key).map(r => {
      const m = by.get(r.key), a = acrRoleAccess(r), open = ACR.open === r.key, hit = q && m.some(p => p.email.includes(q));
      const head = r.group !== last ? `<tr class="acr-grp"><td colspan="4">${acrEsc(r.group)}</td></tr>` : ''; last = r.group;
      return head + `<tr class="acr-row${hit ? ' acr-hit' : ''}${open ? ' on' : ''}" data-acr-role="${r.key}"><td><b>${acrEsc(r.name)}</b>${r.admin ? ' <span class="acr-pill acr-admin">Admin</span>' : ''}${r.limit ? ' <span class="acr-pill acr-limit" title="' + acrEsc(r.limit) + '">Limit</span>' : ''}</td>`
        + `<td>${acrPills(a)}</td><td>${m.length ? m.slice(0, 5).map(p => acrAv(p.email)).join('') + (m.length > 5 ? `<span class="acr-av acr-more">+${m.length - 5}</span>` : '') + ` <span class="muted">${m.length}</span>` : '<span class="muted">No one</span>'}</td>`
        + `<td class="acr-chev">${open ? '▾' : '›'}</td></tr>`
        + (open ? `<tr class="acr-open"><td colspan="4"><div class="acr-detail">`
          + (r.cannot ? `<div class="acr-callout acr-cannot">Cannot: ${acrEsc(r.cannot)}</div>` : '') + (r.limit ? `<div class="acr-callout acr-lim">${acrEsc(r.limit)}</div>` : '')
          + `<div class="acr-what">${acrWhat(a)}</div>`
          + `<div class="acr-sub">Members · ${m.length}</div>` + (m.map(p => acrPerson(p)).join('') || '<div class="muted">No one in this role yet.</div>')
          + `<div style="margin-top:10px"><button type="button" class="ghost" data-acr-addto="${r.key}" style="width:auto">+ Add a person to ${acrEsc(r.name)}</button></div>`
          + `</div></td></tr>` : '');
    }).join('');
    return `<div class="card acr-card"><div class="acr-cardh"><b>${acrEsc(d.name)}</b> <span class="muted">· ${roles.filter(r => r.dept === d.key).length} roles · ${deptCount(d)} people</span></div>`
      + `<table class="acr-t"><thead><tr><th style="width:34%">Role</th><th>Access</th><th>Members</th><th style="width:30px"></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  };
  const placeName = p => { const r = roles.find(x => by.get(x.key).includes(p)); return r ? r.deptName + ' · ' + r.name : 'Special case — own boxes'; };
  let main = '';
  if (ACR.view === 'special') {
    main = `<div class="card acr-card"><div class="acr-cardh"><b>Special cases</b> <span class="muted">· ${special.length} people whose boxes match no role — Edit shows their own boxes</span></div><div style="padding:6px 18px 12px">`
      + (special.filter(p => !q || p.email.includes(q)).map(p => `<div class="acr-person">${acrAv(p.email)}<div style="flex:1;min-width:0"><div class="acr-mail">${acrEsc(p.email)}</div><div>${acrPills(acrPersonAccess(p))}</div></div>`
        + `<button type="button" class="xbtn" data-acr-edit="${acrEsc(p.email)}">Edit</button> <button type="button" class="xbtn" data-acr-del="${acrEsc(p.email)}">Remove</button></div>`).join('') || '<div class="muted" style="padding:10px 0">Nobody.</div>') + '</div></div>';
  } else if (ACR.view === 'people') {
    main = `<div class="card acr-card"><div class="acr-cardh"><b>All people</b> <span class="muted">· ${all.length}</span></div><div style="padding:6px 18px 12px">`
      + all.filter(p => !q || p.email.includes(q)).map(p => acrPerson(p, placeName(p))).join('') + '</div></div>';
  } else {
    const ds = ACR.view.startsWith('dept:') ? ACR_DEPTS.filter(d => 'dept:' + d.key === ACR.view) : ACR_DEPTS;
    main = ds.map(roleTable).join('')
      + (ACR.view === 'overview' && special.length ? `<div class="card acr-card"><div class="acr-cardh"><b>Special cases</b> <span class="muted">· ${special.length} people with their own boxes</span>`
        + `<button type="button" class="ghost" data-acr-view="special" style="width:auto;margin-left:auto">See them</button></div></div>` : '');
  }
  const roleOpts = ACR_DEPTS.map(d => `<optgroup label="${acrEsc(d.name)}">${roles.filter(r => r.dept === d.key).map(r => `<option value="${r.key}">${acrEsc(r.name)}</option>`).join('')}</optgroup>`).join('');
  box.innerHTML = `<div class="acr-top"><div style="flex:1"><div class="muted">Who can open what in Sellora and the Fabricrush ERP — by department and role</div></div>`
    + `<input id="acrQ" type="search" placeholder="Search people by email" value="${acrEsc(q)}" style="width:260px">`
    + `<button type="button" id="acrAdd" style="width:auto">+ Add user</button></div>`
    + (ACR.addOpen ? `<div class="acr-addbox"><label style="margin:0">Start from the role</label><select id="acrAddRole"><option value="">Special case — tick their own boxes</option>${roleOpts}</select>`
      + `<button type="button" id="acrAddGo" style="width:auto">Fill the form</button><span class="muted">then type the email below and press Save access</span></div>` : '')
    + `<div class="acr-stats"><div class="card"><b>${all.length}</b><span>people with access</span></div><div class="card"><b>${inRole}</b><span>in a role</span></div>`
    + `<div class="card"><b class="acr-spc">${special.length}</b><span>special cases — own boxes</span></div><div class="card"><b class="acr-adm">${admins}</b><span>admins</span></div></div>`
    + `<div class="acr-body">${side}<div class="acr-main">${main}</div></div>`;
}
/** What a role's boxes open, in words: the screens of each app and the rights. */
function acrWhat(a) {
  if (a.admin) return '<b>Everything in both apps</b>, and can grant access.';
  const lab = k => (REPL_SECTIONS.find(([x]) => x === k) || [k, k])[1];
  const part = (t, list) => list.length ? `<div><b>${t}</b>: ${acrEsc(list.join(', '))}</div>` : '';
  return part('Sellora', a.s.map(t => TAB_TITLE[t] || t)) + part('Fabricrush ERP', a.e.map(lab)) + part('Extra rights', a.r);
}
/** A role's boxes into the Grant or update form; the email stays for the admin to type. */
function acrFill(roleKey, email) {
  const role = acrRoles().find(r => r.key === roleKey);
  const a = role ? acrRoleAccess(role) : { admin: false, s: [], e: [], r: [] }, rec = { email: email || '', admin: a.admin, tabs: a.s, replTabs: a.e };
  a.r.forEach(k => { rec[k] = true; });
  fillAccessForm(rec);
  $('accessMsg').textContent = role ? `${role.name}'s boxes are ticked — type the email and press Save access.` : 'Tick the boxes this person needs, type the email and press Save access.';
  $('accessEmail').scrollIntoView({ block: 'center', behavior: 'smooth' });
  $('accessEmail').focus();
}

if ($('accRoles') && $('accRoles').addEventListener) {
  $('accRoles').addEventListener('click', e => {
    const t = e.target, at = s => t.closest && t.closest(s);
    const v = at('[data-acr-view]'); if (v) { ACR.view = v.dataset.acrView; ACR.open = ''; acrRender(); return; }
    const ed = at('[data-acr-edit]'); if (ed) { fillAccessForm(ACCESS_ROWS.find(r => r.email === ed.dataset.acrEdit)); $('accessEmail').scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const del = at('[data-acr-del]'); if (del) { accessRemove(del.dataset.acrDel); return; }
    const add = at('[data-acr-addto]'); if (add) { acrFill(add.dataset.acrAddto, ''); return; }
    if (at('#acrAdd')) { ACR.addOpen = !ACR.addOpen; acrRender(); return; }
    if (at('#acrAddGo')) { acrFill($('acrAddRole').value, ''); return; }
    const row = at('[data-acr-role]'); if (row) { ACR.open = ACR.open === row.dataset.acrRole ? '' : row.dataset.acrRole; acrRender(); }
  });
  $('accRoles').addEventListener('input', e => {
    if (e.target.id !== 'acrQ') return;
    ACR.q = e.target.value.trim().toLowerCase(); acrRender();
    const i = $('acrQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  });
}
