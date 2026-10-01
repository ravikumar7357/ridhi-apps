/* ================= ATTENDANCE =================
 *
 * "jitne bhi tailor h mujhe unka attendance register banana h and usme me 1 bande ko assign kar dunga
 * wo daily punch out or punch in kiya karega."
 *
 * ONE ROW PER PERSON PER DAY, and the row is addressed by exactly that: day + person. So the same
 * person cannot be marked twice for a day however many times the button is pressed, from however many
 * phones — the second write lands on the first one's row instead of making another.
 *
 * THE LIST IS THE EMPLOYEE MASTER, not a list of its own. 121 people are already there with their
 * department — 50 of them in Stitching — so nobody is typed in twice and somebody who leaves
 * disappears from both at once.
 *
 * PUNCHING IS NOT THE SAME AS BEING PRESENT. A person can be marked present with times typed in by
 * hand (the register is a day old, the phone was flat); the punch buttons are the quick way, not the
 * only way. And a punch out without a punch in is refused, because the hours it would produce are
 * nonsense and payroll is downstream of this.
 */
let ATT = { rows: null, err: '', busy: false, at: '' };

/** Whoever takes attendance, and any admin. Entering it is all this grants. */
const attCanMark = () => !!(ME.admin || ME.attendMark);
const ATT_NO_MARK = 'Marking attendance needs permission. Ask an admin to switch on '
  + '"Can mark attendance" for your account.';

/** A key that is safe in the database and says what it is: 2026-09-12__RINKU_KOLI. */
const attNameKey = n => String(n || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
const attId = (day, name) => String(day) + '__' + attNameKey(name);
/** Today, as the date input writes it. */
const attToday = () => { const d = new Date(), p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
/** The clock, as a punch writes it. */
const attNow = () => { const d = new Date(), p = n => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()); };

async function ensureAtt() {
  if (ATT.rows === null) {
    ATT.busy = true; renderAtt();
    if (!PTE.emp) await ptLoadEmp();
    try { ATT.rows = ptList(await ptGet('pt_attend')); ATT.err = ''; }
    catch (e) { ATT.err = e.message || String(e); ATT.rows = ATT.rows || []; }
    ATT.at = ptStamp(); ATT.busy = false;
  } else if (!PTE.emp) { await ptLoadEmp(); }
  if (!$('attDay').value) $('attDay').value = attToday();
  if (!$('attMonth').value) $('attMonth').value = String($('attDay').value || attToday()).slice(0, 7);
  renderAtt();
}

/** Everybody on the employee list: [type, name, department, phone]. */
const attPeople = () => (PTE.emp || []).filter(e => e && String(e[1] || '').trim())
  .map(e => ({ type: String(e[0] || '').trim(), name: String(e[1]).trim(),
    dept: String(e[2] || '').trim(), phone: String(e[3] || '').trim() }))
  .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

/** What is already marked for a day, by person. */
const attOfDay = day => {
  const m = new Map();
  (ATT.rows || []).forEach(r => { if (r && String(r.day) === String(day)) m.set(attNameKey(r.empName), r); });
  return m;
};
/** Hours on a marked row: only once both ends are known. */
const attHours = r => {
  if (!r || !r.inAt || !r.outAt) return null;
  const h = ehHours(r.inAt, r.outAt);
  return h == null ? null : h;
};
const attState = r => !r ? 'none' : (r.status === 'A' ? 'absent' : (r.outAt ? 'out' : (r.inAt ? 'in' : 'none')));

/**
 * Write one person's day.
 *
 * Everything goes through here — the punch buttons, the typed times, marking somebody absent — so
 * there is one place that decides what a valid day looks like.
 */
async function attSave(day, person, patch) {
  if (!attCanMark()) return ATT_NO_MARK;
  const d = String(day || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'Pick the day first.';
  if (!person || !person.name) return 'Who?';
  const id = attId(d, person.name);
  const was = (ATT.rows || []).find(r => r && String(r.id) === id) || null;
  const next = Object.assign({
    id, day: d, empName: person.name, empType: person.type, dept: person.dept,
    inAt: '', outAt: '', status: 'P', remarks: '',
    markedBy: (was && was.markedBy) || ME.email, markedAt: (was && was.markedAt) || new Date().toISOString(),
  }, was || {}, patch, { updatedBy: ME.email, updatedAt: new Date().toISOString() });

  /* A DAY THAT CANNOT HAVE HAPPENED IS NOT SAVED. Payroll reads these hours. */
  if (next.status === 'A') { next.inAt = ''; next.outAt = ''; }
  if (next.outAt && !next.inAt) return 'Punch in first — an out time with no in time is not a day.';
  /* ehHours wraps past midnight — 10:00 to 10:00 is 24 to it, not 0 — so the two times are compared
   * as they are written. HH:MM zero-padded compares as text exactly as it compares as a clock. */
  if (next.inAt && next.outAt && String(next.outAt) <= String(next.inAt))
    return 'The out time has to be after the in time.';

  try { await ptPut('pt_attend/' + id, next); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  ATT.rows = (ATT.rows || []).filter(r => !(r && String(r.id) === id)).concat([Object.assign({ _key: id }, next)]);
  renderAtt();
  return '';
}

const attMsg = (t, bad) => { const m = $('attMsg'); if (m) { m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; } };

/** The button a person is punched in with — the time is the clock's, not typed. */
async function attPunch(name, which) {
  const person = attPeople().find(p => attNameKey(p.name) === attNameKey(name));
  if (!person) return attMsg('That person is not on the employee list any more.', true);
  const day = $('attDay').value;
  const row = attOfDay(day).get(attNameKey(name));
  if (which === 'in' && row && row.inAt) return attMsg(`${person.name} was already punched in at ${row.inAt}.`, true);
  if (which === 'out' && (!row || !row.inAt)) return attMsg(`${person.name} has not been punched in yet.`, true);
  if (which === 'out' && row && row.outAt) return attMsg(`${person.name} was already punched out at ${row.outAt}.`, true);
  const err = await attSave(day, person, which === 'in' ? { inAt: attNow(), status: 'P' } : { outAt: attNow() });
  attMsg(err || `${person.name} punched ${which} at ${attNow()}.`, !!err);
}

/** Absent, or back from absent — one button, because it is one decision. */
async function attAbsent(name, on) {
  const person = attPeople().find(p => attNameKey(p.name) === attNameKey(name));
  if (!person) return;
  const err = await attSave($('attDay').value, person, { status: on ? 'A' : 'P' });
  attMsg(err || `${person.name} marked ${on ? 'absent' : 'present'}.`, !!err);
}

/**
 * The register on screen.
 *
 * ONE LINE PER PERSON, EVERY PERSON — not only the ones already marked. A register that shows who has
 * been punched in cannot answer the question it exists for, which is who has NOT.
 */
function renderAtt() {
  if (ATT.busy) { attMsg('Reading the register\u2026'); ptEmpty('attTable', 'Loading\u2026'); return; }
  if (ATT.err) { attMsg('Could not read it: ' + ATT.err, true); ptEmpty('attTable', 'Nothing to show.'); $('attKpis').innerHTML = ''; return; }

  const people = attPeople();
  ptFill('attDept', people.map(p => p.dept), 'All departments');
  ptFill('attType', people.map(p => p.type), 'All types');

  const dept = $('attDept').value, type = $('attType').value;
  const q = String($('attQ').value || '').trim().toLowerCase();
  const keep = people.filter(p => (!dept || p.dept === dept) && (!type || p.type === type)
    && (!q || p.name.toLowerCase().includes(q)));

  if ($('attView').value === 'month') return renderAttMonth(keep);

  const day = $('attDay').value || attToday();
  const marked = attOfDay(day);
  const st = $('attState').value;
  const rows = keep.map(p => ({ p, r: marked.get(attNameKey(p.name)) || null }))
    .filter(x => !st || attState(x.r) === st);
  ATT.shown = rows; ATT.day = day;

  const inN = rows.filter(x => attState(x.r) === 'in').length;
  const outN = rows.filter(x => attState(x.r) === 'out').length;
  const absN = rows.filter(x => attState(x.r) === 'absent').length;
  const noneN = rows.filter(x => attState(x.r) === 'none').length;
  const hours = rows.reduce((a, x) => a + (attHours(x.r) || 0), 0);
  $('attKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Attendance — ${esc(dShow(day))}</span>
      <span class="kpiwhen">read live${ATT.at ? ' · ' + esc(ATT.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">On the list</div></div>
      <div class="metric"><div class="v" style="color:#166534">${nf(inN + outN)}</div><div class="l">Present</div></div>
      <div class="metric"><div class="v">${nf(inN)}</div><div class="l">Still in</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(absN)}</div><div class="l">Absent</div></div>
      <div class="metric"${noneN ? ' title="Nobody has said whether they came in."' : ''}><div class="v"${noneN ? ' style="color:#7f6000"' : ''}>${nf(noneN)}</div><div class="l">Not marked</div></div>
      <div class="metric"><div class="v">${nf(Math.round(hours * 10) / 10)}</div><div class="l">Hours</div></div>
    </div></div>`;

  const can = attCanMark();
  const head = '<thead><tr>' + ['Name', 'Department', 'Type', 'In', 'Out', 'Hours', 'Status', 'Remarks', can ? 'Punch' : '']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i === 5 ? ' class="num"' : '')}>${esc(h)}</th>`).join('') + '</tr></thead>';
  $('attTable').innerHTML = head + '<tbody>' + rows.map(({ p, r }) => {
    const state = attState(r), h = attHours(r);
    const pill = state === 'absent' ? '<span class="pill pill-out">absent</span>'
      : state === 'out' ? '<span class="pill pill-ok">done</span>'
      : state === 'in' ? '<span class="pill pill-low">in</span>'
      : '<span class="muted">—</span>';
    const k = esc(p.name);
    return '<tr>'
      + `<td class="frz" style="text-align:left">${esc(p.name)}${p.phone ? `<div class="muted" style="font-size:10px">${esc(p.phone)}</div>` : ''}</td>`
      + `<td style="text-align:left">${esc(p.dept)}</td><td style="text-align:left;font-size:12px">${esc(p.type)}</td>`
      + `<td>${can ? `<input data-att-in="${k}" type="time" value="${esc((r && r.inAt) || '')}" style="width:110px">`
          : esc((r && r.inAt) || '') || '<span class="muted">—</span>'}</td>`
      + `<td>${can ? `<input data-att-out="${k}" type="time" value="${esc((r && r.outAt) || '')}" style="width:110px">`
          : esc((r && r.outAt) || '') || '<span class="muted">—</span>'}</td>`
      + `<td class="num"${h ? ' style="font-weight:700"' : ''}>${h == null ? '<span class="muted">—</span>' : nf(h)}</td>`
      + `<td>${pill}</td>`
      + `<td>${can ? `<input data-att-rm="${k}" value="${esc((r && r.remarks) || '')}" placeholder="—" style="width:150px">`
          : esc((r && r.remarks) || '') || '<span class="muted">—</span>'}</td>`
      + (can ? `<td style="white-space:nowrap">`
          + `<button class="ghost" data-att-punch="${k}" data-w="in" style="padding:2px 9px;font-size:12px"${(r && r.inAt) || state === 'absent' ? ' disabled' : ''}>In</button> `
          + `<button class="ghost" data-att-punch="${k}" data-w="out" style="padding:2px 9px;font-size:12px"${!(r && r.inAt) || (r && r.outAt) ? ' disabled' : ''}>Out</button> `
          + `<button class="ghost" data-att-abs="${k}" data-on="${state === 'absent' ? '0' : '1'}" style="padding:2px 9px;font-size:12px;color:var(--bad)">${state === 'absent' ? 'Here' : 'Absent'}</button>`
        + '</td>' : '')
      + '</tr>';
  }).join('') + '</tbody>';

  attMsg(`${nf(rows.length)} of ${nf(people.length)} on the register`
    + (noneN ? ` · ${nf(noneN)} not marked yet` : ' · everybody marked'));
}

/**
 * The month: how many days each person was present, and how many hours that came to.
 *
 * A day counts as present if it is not marked absent and has a punch in — the same rule the day view
 * shows, added up. Hours only count where both ends are known, so a day somebody forgot to punch out
 * shows as a present day with no hours rather than a silent zero.
 */
function renderAttMonth(people) {
  const mon = String($('attMonth').value || attToday().slice(0, 7));
  const rows = (ATT.rows || []).filter(r => r && String(r.day || '').slice(0, 7) === mon);
  const by = new Map();
  people.forEach(p => by.set(attNameKey(p.name), { p, days: 0, hours: 0, absent: 0, noOut: 0 }));
  rows.forEach(r => {
    const g = by.get(attNameKey(r.empName)); if (!g) return;
    if (r.status === 'A') { g.absent++; return; }
    if (!r.inAt) return;
    g.days++;
    const h = attHours(r);
    if (h == null) g.noOut++; else g.hours += h;
  });
  const out = [...by.values()].filter(g => g.days || g.absent);
  ATT.shown = out; ATT.month = mon;

  $('attKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Attendance — ${esc(mon)}</span>
      <span class="kpiwhen">read live${ATT.at ? ' · ' + esc(ATT.at) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(out.length)}</div><div class="l">People marked</div></div>
      <div class="metric"><div class="v">${nf(out.reduce((a, g) => a + g.days, 0))}</div><div class="l">Days present</div></div>
      <div class="metric"><div class="v" style="color:var(--bad)">${nf(out.reduce((a, g) => a + g.absent, 0))}</div><div class="l">Days absent</div></div>
      <div class="metric"><div class="v">${nf(Math.round(out.reduce((a, g) => a + g.hours, 0) * 10) / 10)}</div><div class="l">Hours</div></div>
    </div></div>`;

  const head = '<thead><tr>' + ['Name', 'Department', 'Type', 'Days present', 'Days absent', 'Hours', 'No punch out']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : (i >= 3 ? ' class="num"' : '')}>${esc(h)}</th>`).join('') + '</tr></thead>';
  $('attTable').innerHTML = head + '<tbody>' + out
    .sort((a, b) => b.days - a.days || a.p.name.localeCompare(b.p.name))
    .map(g => '<tr>'
      + `<td class="frz" style="text-align:left">${esc(g.p.name)}</td>`
      + `<td style="text-align:left">${esc(g.p.dept)}</td><td style="text-align:left;font-size:12px">${esc(g.p.type)}</td>`
      + `<td class="num" style="font-weight:700">${nf(g.days)}</td>`
      + `<td class="num"${g.absent ? ' style="color:var(--bad)"' : ''}>${g.absent ? nf(g.absent) : '<span class="muted">—</span>'}</td>`
      + `<td class="num">${nf(Math.round(g.hours * 10) / 10)}</td>`
      + `<td class="num"${g.noOut ? ' style="color:#7f6000"' : ''}>${g.noOut ? nf(g.noOut) : '<span class="muted">—</span>'}</td>`
      + '</tr>').join('') + '</tbody>';
  attMsg(`${nf(out.length)} person(s) marked in ${esc(mon)}`);
}

/* ---- the buttons ---- */
['attDept', 'attType', 'attState', 'attView', 'attDay', 'attMonth'].forEach(id => {
  const el = $(id); if (el) el.addEventListener('change', renderAtt);
});
ptDebounce('attQ', renderAtt);
$('attToday').onclick = () => { $('attDay').value = attToday(); $('attView').value = 'day'; renderAtt(); };
$('attGo').onclick = async () => { ATT.rows = null; await ensureAtt(); };

/* One listener on the table: the rows are redrawn on every change, and a listener per button would
 * be six hundred of them thrown away each time. */
$('attTable').addEventListener('click', async e => {
  const p = e.target.closest('[data-att-punch]');
  if (p) return attPunch(p.getAttribute('data-att-punch'), p.getAttribute('data-w'));
  const a = e.target.closest('[data-att-abs]');
  if (a) return attAbsent(a.getAttribute('data-att-abs'), a.getAttribute('data-on') === '1');
});
/* A TYPED TIME IS AS GOOD AS A PUNCHED ONE. The register is often filled in after the fact. */
$('attTable').addEventListener('change', async e => {
  const el = e.target;
  const name = el.getAttribute && (el.getAttribute('data-att-in') || el.getAttribute('data-att-out') || el.getAttribute('data-att-rm'));
  if (!name) return;
  const person = attPeople().find(x => attNameKey(x.name) === attNameKey(name));
  if (!person) return;
  const patch = el.hasAttribute('data-att-in') ? { inAt: el.value, status: 'P' }
    : el.hasAttribute('data-att-out') ? { outAt: el.value }
    : { remarks: el.value };
  const err = await attSave($('attDay').value, person, patch);
  attMsg(err || `${person.name} saved.`, !!err);
});

$('attExport').onclick = () => {
  if ($('attView').value === 'month') {
    const rows = ATT.shown || [];
    if (!rows.length) return;
    const out = [['Month', 'Name', 'Department', 'Type', 'Days present', 'Days absent', 'Hours', 'No punch out']];
    rows.forEach(g => out.push([ATT.month, g.p.name, g.p.dept, g.p.type, g.days, g.absent,
      Math.round(g.hours * 10) / 10, g.noOut]));
    return ptDownload('attendance-' + ATT.month, out.map(r => r.map(csvCell).join(',')));
  }
  const rows = ATT.shown || [];
  if (!rows.length) return;
  const out = [['Date', 'Name', 'Department', 'Type', 'In', 'Out', 'Hours', 'Status', 'Remarks', 'Marked by']];
  rows.forEach(({ p, r }) => out.push([ATT.day, p.name, p.dept, p.type,
    (r && r.inAt) || '', (r && r.outAt) || '', attHours(r) == null ? '' : attHours(r),
    !r ? 'not marked' : (r.status === 'A' ? 'absent' : 'present'),
    (r && r.remarks) || '', (r && r.updatedBy) || '']));
  ptDownload('attendance-' + ATT.day, out.map(r => r.map(csvCell).join(',')));
};

/* ================= THE PRINTER'S FABRIC CATALOGUE =================
 *
 * One line per colour, base fabric, width and print direction — the cloth a printer is actually sent,
 * with the SKU worked out rather than typed, and a picture from the product it belongs to so the
 * printer can see what they are printing.
 */

/** The shapes on offer. Cambric carries no width or direction; sheeting carries both. */
const FS_BRANDS = [
  { key: 'CPC', name: 'CPC', cambric: 'CPCF', sheeting: 'CPCSF' },
  { key: 'RBP', name: 'Ridhi', cambric: 'RBP', sheeting: 'RBPSF' },
];
const FS_WIDTHS = ['62', '72', '82', '92', '112'];
const FS_DIRS = [['V', 'Vertical'], ['H', 'Horizontal']];
/* Voil (quilt cloth) and canvas, by brand. Only the brands listed here have them. */
/* CPC follows its own quilt SKUs (CPCQ005-Q, CPCQ005-T) as Ridhi's fabric follows RQL (2026-09-22). */
const FS_QUILT = { RBP: { voil: 'RQL', canvas: 'RBP-CANVAS-' }, CPC: { voil: 'CPCQ', canvas: 'CPC-CANVAS-' } };
/* The only voil widths and directions made, and the quilt size letter each is cut for. */
const FS_VOIL = [['92', 'Horizontal', 'T'], ['92', 'Vertical', 'Q'], ['112', 'Horizontal', 'K']];
const FS_SIDES = ['Front', 'Back'];

/** Which brand family a product SKU belongs to — the colour codes are only unique inside one. */
const fsFamily = prefix => (/^CPC/.test(prefix) ? 'CPC' : (/^R/.test(prefix) ? 'RBP' : ''));
/** The colour code inside a product SKU: the letters, then the digits. */
function fsCodeOf(sku) {
  const m = String(sku || '').trim().toUpperCase().match(/^([A-Z]+)(\d{1,4})/);
  if (!m) return null;
  const fam = fsFamily(m[1]);
  return fam ? { family: fam, code: m[2] } : null;
}

/**
 * Every colour code the master database knows, and what colour it means.
 *
 * A CODE CAN DISAGREE WITH ITSELF. 004 is Emerald Green on 82 rows and Agate Green on one; 351 is
 * Dark Salmon Pink on 60 and two other colours on eleven. The commonest wins and the rest are
 * reported, because a catalogue generated from a wrong reading is worse than one that says which
 * lines to look at.
 */
function fsColourCodes() {
  const by = new Map();
  (PTG.mdb || []).forEach(r => {
    const c = fsCodeOf(r && r.sku);
    const col = String((r && r.color) || '').trim();
    if (!c || !col) return;
    const k = c.family + '|' + c.code;
    let g = by.get(k);
    if (!g) g = { family: c.family, code: c.code, colours: new Map(), skus: [] }, by.set(k, g);
    g.colours.set(col, (g.colours.get(col) || 0) + 1);
    if (g.skus.length < 6) g.skus.push(r.sku);
  });
  return [...by.values()].map(g => {
    const sorted = [...g.colours.entries()].sort((a, b) => b[1] - a[1]);
    return {
      family: g.family, code: g.code,
      colour: sorted[0][0], rows: sorted[0][1],
      /* Named so the disagreement can be looked at, not hidden. */
      alsoCalled: sorted.slice(1).map(([c, n]) => c + ' ×' + n),
      skus: g.skus,
    };
  }).sort((a, b) => a.family.localeCompare(b.family)
    || String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));
}

/** The SKU for one line of the catalogue, built the way Ravi's sheet builds it. */
function fsSku(brandKey, code, fabric, dir, side) {
  const b = FS_BRANDS.find(x => x.key === brandKey);
  if (!b || !code) return '';
  if (String(fabric).toUpperCase() === 'CAMBRIC') return b.cambric + code;
  const q = FS_QUILT[brandKey];
  if (/^CANVAS$/i.test(String(fabric).trim())) return q ? q.canvas + code : '';
  if (/^VOIL/i.test(String(fabric).trim())) {
    const w = String(fabric).replace(/[^0-9]/g, '');
    const v = FS_VOIL.find(x => x[0] === w && x[1] === dir);
    const sd = FS_SIDES.find(x => x.toLowerCase() === String(side || '').toLowerCase());
    return q && v && sd ? q.voil + code + '-' + v[2] + '-' + sd : '';
  }
  const w = String(fabric).replace(/[^0-9]/g, '');
  if (!w) return '';
  return b.sheeting + code + '-' + (dir === 'Horizontal' ? 'H' : 'V') + '-' + w;
}

/**
 * The whole catalogue for one colour code: cambric, then every width, each way up.
 *
 * ELEVEN LINES PER COLOUR. Cambric has one — cloth that is not sheeting has no width to print across
 * — and each of the five sheeting widths is printed vertically or horizontally.
 */
function fsLinesFor(brandKey, code, colour) {
  const out = [{ fabric: 'Cambric', width: '', dir: 'Vertical',
    sku: fsSku(brandKey, code, 'Cambric', 'Vertical') }];
  FS_WIDTHS.forEach(w => FS_DIRS.forEach(([, dir]) => {
    out.push({ fabric: 'Sheeting ' + w, width: w, dir, sku: fsSku(brandKey, code, 'Sheeting ' + w, dir) });
  }));
  /* Voil comes as a Front and a Back for each quilt size; canvas is one line, printed vertically. */
  if (FS_QUILT[brandKey]) {
    FS_VOIL.forEach(([w, dir]) => FS_SIDES.forEach(side => {
      out.push({ fabric: 'Voil ' + w, width: w, dir, side, sku: fsSku(brandKey, code, 'Voil ' + w, dir, side) });
    }));
    out.push({ fabric: 'Canvas', width: '', dir: 'Vertical', sku: fsSku(brandKey, code, 'Canvas', 'Vertical') });
  }
  return out.map(l => Object.assign({ brand: brandKey, code, colour }, l));
}

/**
 * A picture for a colour code, taken from a real product in that colour.
 *
 * The printer is not being sent a photograph of cloth — nobody has one. What they need is the design
 * they are printing, and the product photo of anything made in it shows exactly that. The first SKU
 * of that code with a picture on record wins.
 */
function fsImageFor(codeRow) {
  const list = (codeRow && codeRow.skus) || [];
  for (const s of list) { const u = ptImgOf(s); if (u) return { url: u, from: s }; }
  /* Nothing on the six it remembered — look wider before giving up. */
  const c = codeRow && codeRow.code, fam = codeRow && codeRow.family;
  const more = (PTG.mdb || []).filter(r => {
    const k = fsCodeOf(r && r.sku);
    return k && k.code === c && k.family === fam;
  });
  for (const r of more) { const u = ptImgOf(r.sku); if (u) return { url: u, from: r.sku }; }
  return { url: '', from: (more[0] && more[0].sku) || list[0] || '' };
}

/** Every line of the printer's catalogue, for the brands and colours the master database knows. */
function fsRows(filter) {
  const f = filter || {};
  const codes = fsColourCodes();
  const out = [];
  codes.forEach(c => {
    if (f.brand && c.family !== f.brand) return;
    if (f.colour && String(c.colour).toLowerCase() !== String(f.colour).toLowerCase()) return;
    const img = fsImageFor(c);
    fsLinesFor(c.family, c.code, c.colour).forEach(l => {
      if (f.dir && l.dir !== f.dir) return;
      if (f.q) {
        const hay = [l.sku, c.colour, c.code, l.fabric, l.dir].join(' ').toLowerCase();
        if (hay.indexOf(f.q) < 0) return;
      }
      out.push(Object.assign({}, l, { imageUrl: img.url, imageFrom: img.from,
        alsoCalled: c.alsoCalled, brandName: (FS_BRANDS.find(b => b.key === c.family) || {}).name || c.family }));
    });
  });
  /* AND THE ONES ADDED BY HAND (Ravi, 2026-09-25), under the same filters. */
  const built = new Set(out.map(r => r.sku.toUpperCase()));
  fsManual().forEach(r => {
    if (built.has(r.sku)) return;
    if (f.brand && r.brand !== f.brand) return;
    if (f.colour && String(r.colour).toLowerCase() !== String(f.colour).toLowerCase()) return;
    if (f.dir && r.dir !== f.dir) return;
    if (f.q && [r.sku, r.colour, r.code, r.fabric, r.dir, r.note].join(' ').toLowerCase().indexOf(f.q) < 0) return;
    out.push(r);
  });
  return out;
}

/** What one fabric SKU is — the lookup a printing order needs when somebody types a code in. */
function fsOf(sku) {
  const want = String(sku || '').trim().toUpperCase();
  if (!want) return null;
  return fsRows({ q: want.toLowerCase() }).find(r => r.sku.toUpperCase() === want) || null;
}

function renderMdbFabric() {
  const f = {
    brand: $('ptmBrandFs').value, colour: $('ptmCol').value, dir: $('ptmDir').value,
    q: String($('ptmQ').value || '').trim().toLowerCase(),
  };
  const rows = fsRows(f);
  const codes = fsColourCodes();
  const muddled = codes.filter(c => c.alsoCalled.length);
  PTE.fsRows = rows;

  $('ptmKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Fabric for printing</span>
      <span class="kpiwhen">built from the master database · ${nf(codes.length)} colour code(s)</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Fabric SKUs</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => r.code)).size)}</div><div class="l">Colours</div></div>
      <div class="metric"><div class="v">${nf(rows.filter(r => r.imageUrl).length)}</div><div class="l">With a picture</div></div>
      ${muddled.length ? `<div class="metric" title="These codes are used for more than one colour in the master database. The commonest is used here."><div class="v" style="color:#7f6000">${nf(muddled.length)}</div><div class="l">Codes to check</div></div>` : ''}
    </div></div>`;

  const head = '<thead><tr>' + ['Colour code', 'Colour', 'Brand', 'Fabric', 'Print direction', 'SKU', 'Reference']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ''}>${esc(h)}</th>`).join('') + '</tr></thead>';
  $('ptmTable').innerHTML = head + '<tbody>' + rows.slice(0, 600).map(r => '<tr>'
    + `<td class="frz" style="text-align:left;font-family:ui-monospace,monospace">${esc(r.code)}</td>`
    + `<td style="text-align:left">${esc(r.colour)}${r.alsoCalled.length
        ? ` <span class="pill pill-low" title="Also called ${esc(r.alsoCalled.join(', '))} on other rows">check</span>` : ''}</td>`
    + `<td>${esc(r.brandName)}</td>`
    + `<td style="text-align:left">${esc(r.fabric)}${r.side ? ` <span class="muted" style="font-size:11.5px">· ${esc(r.side)}</span>` : ''}</td>`
    + `<td>${esc(r.dir)}</td>`
    + `<td style="text-align:left;font-family:ui-monospace,monospace;font-weight:700">${esc(r.sku)}${r.manual
        ? ` <span class="pill" title="Added by hand${r.note ? ' — ' + esc(r.note) : ''}">added</span>${mdbCanEdit() ? ` <button class="ghost" data-fs-edit="${esc(r.sku)}" style="padding:2px 8px;font-size:11px">Edit</button>` : ''}` : ''}</td>`
    + (r.imageUrl
      ? `<td title="From ${esc(r.imageFrom)}"><img src="${esc(ptImgSrc(r.imageUrl, 38))}" alt="" loading="lazy"
           style="width:38px;height:38px;object-fit:cover;border-radius:6px;border:1px solid var(--line)"></td>`
      : '<td class="muted">—</td>')
    + '</tr>').join('') + '</tbody>';

  $('ptmMsg').className = muddled.length ? 'err' : 'muted';
  $('ptmMsg').textContent = `${nf(rows.length)} fabric SKU(s) · ${nf(codes.length)} colour code(s) · `
    + 'cambric, five sheeting widths each way up, voil (front and back) and canvas'
    + (muddled.length ? ` · ${nf(muddled.length)} code(s) are used for more than one colour in the master database — the commonest is shown, marked "check"` : '');
  /* The pictures come from the products, so ask for the ones that are still unknown. */
  ptImgFill(rows.slice(0, 600).map(r => r.imageFrom).filter(Boolean), false, ptImgPatch);
}

/* ---------------- Cutting Data ---------------- */

async function ensurePcut() { if (PT.cut === null) await ptLoad('cut', 'pt_cuttingData', renderPcut); else renderPcut(); }

function pcutFilters() {
  const v = id => ($(id) || {}).value || '';
  return { art: v('pcArt'), sub: v('pcSub'), col: v('pcCol'), sz: v('pcSz'),
    ord: v('pcOrd'), q: v('pcQ').trim().toLowerCase(), d1: v('pcD1'), d2: v('pcD2'), who: v('pcWho') };
}

function pcutApply(rows, f, skip) {
  skip = skip || '';
  return rows.filter(r => {
    if (skip !== 'art' && f.art && !ptCi(r.articleType, f.art)) return false;
    if (skip !== 'sub' && f.sub && !ptCi(r.articleSubtype, f.sub)) return false;
    if (skip !== 'col' && f.col && !ptCi(r.color, f.col)) return false;
    if (skip !== 'sz' && f.sz && !ptCi(r.size, f.sz)) return false;
    if (skip !== 'ord' && f.ord && !ptCi(r.orderNo, f.ord)) return false;
    if (skip !== 'who' && f.who && whoTouched(r).indexOf(String(f.who).toLowerCase()) < 0) return false;
    if (skip !== 'q' && f.q) {
      const hay = [r.sku, r.articleType, r.articleSubtype, r.color, r.size, r.orderNo, r.fabricWidth].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    if (skip !== 'date' && f.d1) { const d = ptDate(r.cutDate); if (!d || d < new Date(f.d1 + 'T00:00:00')) return false; }
    if (skip !== 'date' && f.d2) { const d = ptDate(r.cutDate); if (!d || d > new Date(f.d2 + 'T23:59:59')) return false; }
    return true;
  });
}

function renderPcut() {
  $('pcMore').innerHTML = '';
  if (PT.busy.cut) { $('pcMsg').className = 'muted'; $('pcMsg').textContent = 'Reading the production database…'; ptEmpty('pcTable', 'Loading…'); return; }
  if (PT.err.cut) {
    $('pcMsg').className = 'err'; $('pcMsg').textContent = 'Could not read it: ' + PT.err.cut;
    ptEmpty('pcTable', 'Nothing to show.'); $('pcKpis').innerHTML = ''; return;
  }
  const all = PT.cut || [];
  if (!all.length) { $('pcMsg').className = 'muted'; $('pcMsg').textContent = ''; $('pcKpis').innerHTML = ''; ptEmpty('pcTable', 'No cutting entries.'); return; }

  const f = pcutFilters();
  ptFill('pcArt', pcutApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('pcSub', pcutApply(all, f, 'sub').map(r => r.articleSubtype), 'All subtypes');
  ptFill('pcCol', pcutApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('pcSz', pcutApply(all, f, 'sz').map(r => r.size), 'All sizes');
  ptFill('pcOrd', pcutApply(all, f, 'ord').map(r => r.orderNo), 'All orders');
  ptFill('pcWho', whoList(pcutApply(all, f, 'who')), "Anyone's entry");

  const rows = pcutApply(all, f).sort((a, b) => {
    const d = ptDtMs(b.cutDate) - ptDtMs(a.cutDate);
    return d || String(b.id || '').localeCompare(String(a.id || ''));
  });
  PT._pcutRows = rows;

  const pieces = rows.reduce((s, r) => s + ptNum(r.pieces), 0);
  $('pcKpis').innerHTML = `<div class="kpi" style="flex-basis:100%">
    <div class="kpihead"><span class="kpiname">Cutting Data</span>
      <span class="kpiwhen">read live${PT.at.cut ? ' · ' + esc(PT.at.cut) : ''}</span></div>
    <div class="metrics">
      <div class="metric"><div class="v">${nf(rows.length)}</div><div class="l">Cut entries</div></div>
      <div class="metric"><div class="v">${nf(pieces)}</div><div class="l">Pieces cut</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => String(r.sku || '').trim().toUpperCase()).filter(Boolean)).size)}</div><div class="l">SKUs</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => String(r.orderNo || '').trim()).filter(Boolean)).size)}</div><div class="l">Orders</div></div>
      <div class="metric"><div class="v">${nf(new Set(rows.map(r => String(r.fabricWidth || '').trim()).filter(Boolean)).size)}</div><div class="l">Fabrics</div></div>
      ${(() => {
        /* COUNTED OVER THE ENTRIES THAT CARRY A FIGURE, and the rest are named rather than averaged
         * in as nought — a waste rate worked out over entries nobody measured is not a waste rate. */
        const meas = rows.filter(r => ptNum(r.fabricUsed) > 0);
        const used = meas.reduce((a, r) => a + ptNum(r.fabricUsed), 0);
        const waste = meas.reduce((a, r) => a + ptNum(r.fabricWaste), 0);
        const pct = used > 0 ? (waste / used) * 100 : 0;
        return `<div class="metric"><div class="v">${used ? nf(Math.round(used)) : '—'}</div><div class="l">Fabric used (m)</div></div>
          <div class="metric"><div class="v"${pct > 10 ? ' style="color:var(--bad)"' : ''}>${waste ? nf(Math.round(waste * 10) / 10) : '—'}</div><div class="l">Waste (m)${
            used ? ' · ' + pct.toFixed(1) + '%' : ''}</div></div>
          <div class="metric"><div class="v"${meas.length < rows.length ? ' style="color:var(--muted)"' : ''}>${nf(meas.length)} / ${nf(rows.length)}</div><div class="l">Entries measured</div></div>`;
      })()}
    </div></div>`;

  const head = '<thead><tr>' + ['Cut Date', 'Order No', 'SKU', 'Image', 'Article', 'Subtype', 'Color', 'Size', 'Fabric', 'Pieces', 'Fabric used (m)', 'Waste (m)', 'Waste width (in)', 'Waste %', 'Remarks', 'Entered by', 'Edit']
    .map((h, i) => `<th${i === 0 ? ' class="frz"' : ([9, 10, 11, 12, 13].indexOf(i) >= 0 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const shown = rows.slice(0, PC_CAP);
  const body = shown.map(r => '<tr>'
    + `<td class="frz" style="text-align:left">${esc(r.cutDate)}</td>`
    + `<td style="text-align:left">${esc(r.orderNo) || '<span class="muted">—</span>'}</td>`
    + `<td style="font-family:ui-monospace,monospace;text-align:left">${esc(r.sku)}</td>`
    + ptImgCell(r.sku)
    + `<td>${esc(r.articleType)}</td><td>${esc(r.articleSubtype)}</td><td>${esc(r.color)}</td><td>${esc(r.size)}</td>`
    + `<td>${esc(r.fabricWidth)}</td><td class="num" style="font-weight:700">${nf(ptNum(r.pieces))}</td>`
    /* MEASURED OR NOT MEASURED. An entry nobody measured shows a dash, never a nought — the two
     * would add up identically and mean opposite things. */
    + (u => `<td class="num">${u > 0 ? nf(u) : '<span class="muted">—</span>'}</td>`)(ptNum(r.fabricUsed))
    + (w => `<td class="num">${w > 0 ? nf(w) : '<span class="muted">—</span>'}</td>`)(ptNum(r.fabricWaste))
    /* HOW WIDE what is left is: wide enough to cut from, or rag. */
    + (x => `<td class="num">${x > 0 ? nf(x) + '"' : '<span class="muted">—</span>'}</td>`)(ptNum(r.fabricWasteWidth))
    + ((u, w) => `<td class="num"${u > 0 && w / u > 0.1 ? ' style="color:var(--bad)"' : ''}>${
        u > 0 && w > 0 ? ((w / u) * 100).toFixed(1) + '%' : '<span class="muted">—</span>'}</td>`)(ptNum(r.fabricUsed), ptNum(r.fabricWaste))
    + `<td style="text-align:left;white-space:normal;max-width:220px">${esc(r.remarks) || '<span class="muted">—</span>'}</td>`
    + whoCell(r)
    + `<td>${ptCanEdit() ? `<button class="ghost" data-cut-edit="${esc(r.id)}" style="padding:3px 10px;font-size:12px">Edit</button>`
      : '<span class="muted">—</span>'}</td></tr>`).join('');
  $('pcTable').innerHTML = head + '<tbody>' + body + '</tbody>';

  $('pcMsg').className = 'muted';
  $('pcMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} cut entr${all.length === 1 ? 'y' : 'ies'}`
    + (rows.length > PC_CAP ? ` · showing the newest ${nf(PC_CAP)} · Export covers all of them` : '');
  $('pcMore').innerHTML = ptMoreBtn('data-pcmore', rows.length, PC_CAP);
  ptImgFill(shown.map(r => r.sku), false, ptIfTab('pcut', renderPcut));
}

/* ---------------- wiring ---------------- */

['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut'].forEach(id => $(id).addEventListener('change', renderPmdb));
['pbType', 'pbEmp', 'pbArt', 'pbSub', 'pbCol', 'pbSz', 'pbStatus', 'pbDBy', 'pbD1', 'pbD2'].forEach(id => $(id).addEventListener('change', renderPbase));
['pcArt', 'pcSub', 'pcCol', 'pcSz', 'pcOrd', 'pcD1', 'pcD2'].forEach(id => $(id).addEventListener('change', renderPcut));
/* The cloth the cut costs follows the pieces and the SKU as they are typed. renderCutFab, NOT
 * renderCutForm: the form rebuilds four dropdowns off the master list, and doing that on every
 * keystroke of a piece count is what made the Job Work form lag. */
['cwPcs', 'cwSku'].forEach(id => { const el = $(id); if (el) el.addEventListener('input', renderCutFab); });
['cwAt', 'cwSub', 'cwCol', 'cwSz'].forEach(id => { const el = $(id); if (el) el.addEventListener('change', renderCutFab); });
/* A figure somebody types wins over the one worked out, until the form is cleared. */
['cwUsed', 'cwWaste', 'cwWasteW'].forEach(id => {
  const el = $(id); if (!el) return;
  el.addEventListener('input', () => { el.dataset.typed = String(el.value).trim() ? '1' : ''; renderCutFab(); });
});

/* Typing a filter would otherwise re-render a 4,500-row table on every keystroke. */
function ptDebounce(id, fn) {
  let t = null;
  $(id).addEventListener('input', () => { clearTimeout(t); t = setTimeout(fn, 220); });
}
ptDebounce('ptmQ', renderPmdb); ptDebounce('pbQ', renderPbase); ptDebounce('pcQ', renderPcut);

$('ptmClear').onclick = () => { ['ptmBrand', 'ptmArt', 'ptmSub', 'ptmCol', 'ptmSz', 'ptmCut', 'ptmQ'].forEach(id => $(id).value = ''); renderPmdb(); };
if ($('audGo')) {
  $('audGo').onclick = () => audLoad();
  $('audView').onchange = () => { if ($('audView').value === 'bin' ? !AUD.bin : !AUD.rows) audLoad(); else audRender(); };
  $('audQ').addEventListener('input', () => audRender());
  $('audBody').addEventListener('click', async e => {
    const b = e.target.closest && e.target.closest('[data-aud-restore]'); if (!b) return;
    const id = b.getAttribute('data-aud-restore');
    const t = (AUD.bin || []).find(x => x._id === id);
    if (!confirm('Put this record back?\n\n' + (t ? audWhat(t.path, t.value) : id))) return;
    b.disabled = true;
    const err = await auditRestore(id);
    if (err) { $('audMsg').className = 'err'; $('audMsg').textContent = err; b.disabled = false; return; }
    if (t) t.restoredAt = new Date().toISOString();
    audRender();
    $('audMsg').className = 'muted'; $('audMsg').textContent = 'Restored. The screen it belongs to shows it after its next refresh.';
  });
}
$('pbMore').addEventListener('click', e => { if (!e.target.closest('[data-pbmore]')) return; PB_CAP += PT_CAP_STEP; renderPbase(); });
$('pcMore').addEventListener('click', e => { if (!e.target.closest('[data-pcmore]')) return; PC_CAP += PT_CAP_STEP; renderPcut(); });
$('pbClear').onclick = () => { ['pbType', 'pbEmp', 'pbWho', 'pbArt', 'pbSub', 'pbCol', 'pbSz', 'pbStatus', 'pbQ', 'pbDBy', 'pbD1', 'pbD2'].forEach(id => $(id).value = ''); PT_BD_KPI = ''; renderPbase(); };
$('pcClear').onclick = () => { ['pcArt', 'pcSub', 'pcCol', 'pcSz', 'pcOrd', 'pcWho', 'pcQ', 'pcD1', 'pcD2'].forEach(id => $(id).value = ''); renderPcut(); };

/* REFRESH READS THE RECIPES TOO (2026-09-25). Ruffle, zip and cloth figures fall back to the recipe; a recipe
 * uploaded after this screen was opened (another tab, another person) was never seen until a full reload. */
async function pmdbRefresh() {
  try { const m = await ptGet('pt_masters'); if (m) { PTG.masters = m; PTG.recipeAt = Date.now(); RECIPE_IX = { src: null, map: null }; } } catch (e) { /* the SKUs still load */ }
  await ptLoad('mdb', 'pt_masterDB', renderPmdb);
  /* ONE ARRAY, TWO NAMES — as ensurePmdb keeps them. A refresh that set only PT.mdb left every other screen on
   * the old rows, and without mdbYnFix the "yes" text rows read differently here than everywhere else. */
  if (!PT.err.mdb && PT.mdb) { PT.mdb = PT.mdb.map(mdbYnFix); PTG.mdb = PT.mdb; renderPmdb(); }
}
$('ptmGo').onclick = () => pmdbRefresh();
$('pbGo').onclick = () => ptLoad('base', 'pt_baseData', renderPbase);
$('pcGo').onclick = () => ptLoad('cut', 'pt_cuttingData', renderPcut);

/* The KPI cards are written with innerHTML, and this file is a module — an inline onclick would be
 * looking for a global that does not exist. Delegated instead. */
function pbKpiClick(e) {
  const el = e.target.closest('.pt-kpi'); if (!el) return;
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  if (e.type === 'keydown') e.preventDefault();
  const k = el.getAttribute('data-kpi') || '';
  PT_BD_KPI = (PT_BD_KPI === k) ? '' : k;
  renderPbase();
}
$('pbKpis').addEventListener('click', pbKpiClick);
$('pbKpis').addEventListener('keydown', pbKpiClick);

$('ptmExport').onclick = () => {
  /* The recipes are their own table and export as themselves — the SKU export would hand back 4,730
   * rows when 319 are on screen. */
  if (($('ptmView') || {}).value === 'recipe') {
    const rows = recipeSheetRows();
    if (rows.length < 2) return;
    ptDownload('recipes', rows.map(r => r.map(csvCell).join(',')));
    return;
  }
  if (($('ptmView') || {}).value === 'skucode') {
    const rows = skcSheetRows();
    if (rows.length < 2) return;
    ptDownload('sku-codes' + (SKC.code ? '-' + SKC.code : ''), rows.map(r => r.map(csvCell).join(',')));
    return;
  }
  const rows = PT._pmdbRows || []; if (!rows.length) return;
  const lines = [['SKU', 'Brand', 'Article', 'Subtype', 'Color', 'Size', 'Fabric', 'Consumption', 'Pack of',
    'Cutting required', 'Zip', 'Zips per piece', 'Zip size', 'Ruffle', 'Ruffle metres', 'Ruffle fabric', 'Piping dori', 'Piping dori metres',
    'Filler fabric', 'Filling qty', 'Valuation price', 'Image', 'ASIN', 'Parent ASIN'].map(csvCell).join(',')];
  const b = v => v ? 'Yes' : 'No';
  rows.forEach(r => lines.push([r.sku, r.brand, r.articleType, r.subtype, r.color, r.size, r.fabric,
    mdbM2(r.consumption), r.packOf, b(r.cuttingRequired),
    b(r.isZip), r.isZip ? mdbZipQty(r) : '', r.isZip ? r.chainLength : '',
    b(r.isRuffle), r.isRuffle ? r.ruffleMeters : '', r.isRuffle ? r.ruffleFabric : '',
    b(r.isPiping), r.isPiping ? r.pipingMeters : '',
    b(r.fillerFabricRequired), r.fillerFabricRequired && r.standardFillingQty != null ? r.standardFillingQty : '',
    r.inventoryValuationPrice == null ? '' : r.inventoryValuationPrice, r.imageUrl || MDBIMG.map[obUC(r.sku)] || '',
    r.asin || '', r.parentAsin || '']
    .map(csvCell).join(',')));
  ptDownload('master-database', lines);
};

$('pbExport').onclick = () => {
  const rows = PT._pbaseRows || []; if (!rows.length) return;
  const lines = [['Issue Date', 'Employee', 'Employment type', 'SKU', 'Article', 'Subtype', 'Color', 'Size',
    'Issued', 'Received', 'Rejected', 'Pending', 'Receiving Date', 'Status', 'Remarks', 'Entered by'].map(csvCell).join(',')];
  rows.forEach(r => lines.push([r.issueDate, r.empName, r.empType, r.sku, r.articleType, r.articleSubtype,
    r.color, r.size, ptNum(r.issuePieces), ptNum(r.receivedPieces), ptNum(r.rejectionPieces), ptNum(r.pendingPieces),
    r.receivingDate, r.frozen ? 'Done' : 'Open', r.remarks, r.addedBy].map(csvCell).join(',')));
  ptDownload('base-data', lines);
};

$('pcExport').onclick = () => {
  const rows = PT._pcutRows || []; if (!rows.length) return;
  const lines = [['Cut Date', 'Order No', 'SKU', 'Article', 'Subtype', 'Color', 'Size', 'Fabric', 'Pieces',
    'Fabric used (m)', 'Waste (m)', 'Waste width (in)', 'Waste %', 'Remarks', 'Entered by'].map(csvCell).join(',')];
  rows.forEach(r => {
    /* Blank where nobody measured, so a spreadsheet cannot average a missing figure as a nought. */
    const u = ptNum(r.fabricUsed), w = ptNum(r.fabricWaste);
    const ww = ptNum(r.fabricWasteWidth);
    lines.push([r.cutDate, r.orderNo, r.sku, r.articleType, r.articleSubtype, r.color, r.size,
      r.fabricWidth, ptNum(r.pieces), u > 0 ? u : '', w > 0 ? w : '', ww > 0 ? ww : '',
      u > 0 && w > 0 ? ((w / u) * 100).toFixed(1) : '', r.remarks, r.addedBy].map(csvCell).join(','));
  });
  ptDownload('cutting-data', lines);
};

