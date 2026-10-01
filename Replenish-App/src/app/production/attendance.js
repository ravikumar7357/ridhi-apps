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

