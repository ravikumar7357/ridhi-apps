/* ================= WHATSAPP TO THE WORKER =================
 *
 * The production tracker's flow, reproduced. Its own comment describes the channel: "Path C —
 * manual click-to-send via wa.me links. No backend, no API key." A 💬 button per row opens WhatsApp
 * with the message typed out and a person presses Send. There is no API credential in either app or
 * either database, so this is the only channel there is.
 *
 * THE SAME MARKERS, waIssueSentAt / waRecvSentAt on the row, because both tools are pointed at the
 * same database. A row either one has messaged must not be messaged again by the other.
 *
 * The marker is written when the wa.me WINDOW OPENS, which is not proof anything was sent — the old
 * tool has the same limit. It is called "opened" wherever this app has room to say so.
 */
const WA_CUTOFF_DEFAULT = '2026-06-01';
/* The tracker's own wording, used when pt_waTemplates is unset — which it is, so these are the
 * messages that have actually been going out. */
const WA_TPL_DEFAULT = {
  issue: 'Hello {empName}, you have been issued {issuePieces} pieces of {articleType} ({subtype}) — {color} {size} on {issueDate}. SKU: {sku}. — {ridhi}',
  receive: 'Hello {empName}, we have received {receivedPieces} pieces of {articleType} ({subtype}) — {color} {size} from you on {recvDate}. Thank you! — {ridhi}',
};
let WA = { cutoff: null, tpl: null, loaded: false };

function waCutoffMs() {
  const raw = WA.cutoff || WA_CUTOFF_DEFAULT;
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return (m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(WA_CUTOFF_DEFAULT)).getTime();
}
const waTpl = kind => ((WA.tpl && WA.tpl[kind]) || WA_TPL_DEFAULT[kind] || '');

/** A number wa.me can reach. Bare ten digits get 91 — the old tool sends those nowhere. */
function waNum(raw) {
  const s = String(raw == null ? '' : raw).replace(/\D/g, '').replace(/^0+/, '');
  if (s.length === 10) return '91' + s;
  if (s.length >= 11 && s.length <= 15) return s;
  return '';
}
const waEmp = name => {
  const n = String(name || '').trim().toLowerCase();
  return n ? (PTE.emp || []).find(e => e && String(e[1]).trim().toLowerCase() === n) || null : null;
};
const waPhoneOf = name => { const e = waEmp(name); return e ? waNum(e[3]) : ''; };

/** {placeholder} → value, exactly the tracker's map. */
function waSubstitute(tpl, row) {
  const safe = v => (v === null || v === undefined) ? '' : String(v);
  const map = {
    empName: safe(row.empName), sku: safe(row.sku),
    articleType: safe(row.articleType), subtype: safe(row.articleSubtype),
    color: safe(row.color), size: safe(row.size),
    issuePieces: safe(row.issuePieces), issueDate: safe((row.issueDate || '').toString().slice(0, 10)),
    receivedPieces: safe(row.receivedPieces || 0), recvDate: safe((row.receivingDate || '').toString().slice(0, 10)),
    rejectionPieces: safe(row.rejectionPieces || 0), pendingPieces: safe(row.pendingPieces),
    date: new Date().toLocaleDateString('en-GB'), ridhi: 'Ridhi Block Print',
  };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
}
const waMsg = (row, kind) => waSubstitute(waTpl(kind), row);

/**
 * Why this row cannot be messaged, in the words the button will carry — '' when it can. Returning
 * the reason rather than a boolean is what lets a disabled button say what is wrong with it.
 */
function waWhyBlocked(r, kind) {
  if (!r) return 'Row not found';
  if (!waPhoneOf(r.empName)) return 'No WhatsApp number on file for ' + (r.empName || 'this employee');
  if (kind === 'receive' && ptNum(r.receivedPieces) <= 0) return 'Nothing received on this row yet';
  const when = kind === 'issue' ? r.issueDate : r.receivingDate;
  const ms = ptDtMs(when);
  if (!ms) return kind === 'issue' ? 'No issue date' : 'No receiving date';
  if (ms < waCutoffMs()) return 'Dated before the WhatsApp cutoff (' + (WA.cutoff || WA_CUTOFF_DEFAULT) + ')';
  /* THE ONE-SHOT RULE. A sent row is spent for everybody except an admin, who may re-send. */
  const sent = kind === 'issue' ? r.waIssueSentAt : r.waRecvSentAt;
  if (sent && !ME.admin) return 'Already sent — only an admin can re-send';
  return '';
}
const waSent = (r, kind) => !!(kind === 'issue' ? r.waIssueSentAt : r.waRecvSentAt);

/** The two buttons on a row. Always drawn; greyed with the reason when they cannot be used. */
function waCell(r) {
  const one = kind => {
    const why = waWhyBlocked(r, kind);
    const sent = waSent(r, kind);
    const label = (kind === 'issue' ? 'Issue' : 'Recv');
    if (why) return `<span class="muted" title="${esc(why)}" style="font-size:11.5px;padding:3px 6px">${esc(label)}</span>`;
    return `<button class="ghost" data-wa-row="${esc(r.id)}|${kind}" style="padding:3px 8px;font-size:11.5px"`
      + ` title="${sent ? 'Already sent — this will send it again' : 'Open WhatsApp with the message ready'}">`
      + `${sent ? '↻' : '💬'} ${esc(label)}</button>`;
  };
  return '<td style="white-space:nowrap">' + waButtons(r) + '</td>';
}
/** The two WhatsApp buttons on their own, for a cell that holds other actions too. */
function waButtons(r) {
  const one = kind => {
    const why = waWhyBlocked(r, kind);
    const sent = waSent(r, kind);
    const label = (kind === 'issue' ? 'Issue' : 'Recv');
    if (why) return `<span class="muted" title="${esc(why)}" style="font-size:11.5px;padding:3px 6px">${esc(label)}</span>`;
    return `<button class="ghost" data-wa-row="${esc(r.id)}|${kind}" style="padding:3px 8px;font-size:11.5px"`
      + ` title="${sent ? 'Already sent — this will send it again' : 'Open WhatsApp with the message ready'}">`
      + `${sent ? '↻' : '💬'} ${esc(label)}</button>`;
  };
  return one('issue') + ' ' + one('receive');
}

/** Open WhatsApp for one row, then mark it — the tracker's waSend, rule for rule. */
async function waSendRow(id, kind) {
  const r = (PT.base || []).find(x => x && x.id === id);
  if (!r) return;
  /* Checked again here, not only on the button: a page left open while access or a cutoff changes
   * still has the old buttons drawn on it. */
  const why = waWhyBlocked(r, kind);
  if (why) { $('pbMsg').className = 'err'; $('pbMsg').textContent = why + '.'; return; }
  const phone = waPhoneOf(r.empName);
  const url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(waMsg(r, kind));
  /* One named tab, reused, so a morning of sends does not leave a dozen windows open. */
  const win = window.open(url, 'erpWhatsApp');
  /* A blocked pop-up returns null, and then NOTHING is marked — the row stays offered rather than
   * counting as done when no message was ever composed. */
  if (!win) { $('pbMsg').className = 'err';
    $('pbMsg').textContent = 'The browser blocked the WhatsApp window. Allow pop-ups for this site and try again — nothing was marked.'; return; }
  const field = kind === 'issue' ? 'waIssueSentAt' : 'waRecvSentAt';
  const stamp = new Date().toISOString();
  try { await ptPut('pt_baseData/' + id + '/' + field, stamp); }
  catch (e) { $('pbMsg').className = 'err';
    $('pbMsg').textContent = 'WhatsApp opened, but the row could not be marked: ' + (e.message || e); return; }
  PT.base = (PT.base || []).map(x => (x && x.id === id ? Object.assign({}, x, { [field]: stamp }) : x));
  $('pbMsg').className = 'muted';
  $('pbMsg').textContent = `WhatsApp opened for ${r.empName} — press Send there.`;
  renderPbase();
}

/* The 💬 buttons are redrawn with the table, so they are caught by delegation rather than bound. */
$('pbTable').addEventListener('click', e => {
  const b = e.target.closest('[data-wa-row]');
  if (!b) return;
  const [id, kind] = b.getAttribute('data-wa-row').split('|');
  waSendRow(id, kind);
});

/** The templates and the cutoff live in the tracker's own nodes, so both tools say the same thing. */
async function waLoad() {
  if (WA.loaded) return;
  WA.loaded = true;
  if (!PTE.emp) { try { await ptLoadEmp(); } catch (e) { /* the buttons will say there is no number */ } }
  try { const t = await ptGet('pt_waTemplates'); if (t && typeof t === 'object') WA.tpl = t; } catch (e) { /* defaults */ }
  try { const c = await ptGet('pt_whatsappCutoffDate'); if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c)) WA.cutoff = c; } catch (e) { /* default */ }
  renderPbase();
}

/* ---- editing a cutting entry ---- */

/* Row buttons are written with innerHTML, so both tables are handled by delegation. */
$('pbTable').addEventListener('click', e => {
  const b = e.target.closest('[data-bd-edit]'); if (!b) return;
  bdEdit(b.getAttribute('data-bd-edit'));
});
$('pcTable').addEventListener('click', e => {
  const b = e.target.closest('[data-cut-edit]'); if (!b) return;
  cutEdit(b.getAttribute('data-cut-edit'));
});

/* ---- receiving, in the register itself ---- */

/** Add received pieces. Received + rejected can never exceed what was issued. */
function bdApplyRecv(row, addAmt, at) {
  const issued = ptNum(row.issuePieces), rej = ptNum(row.rejectionPieces);
  const add = parseInt(addAmt, 10) || 0;
  if (add <= 0) return { err: 'Enter how many pieces came back.' };
  const newRecv = ptNum(row.receivedPieces) + add;
  if (newRecv + rej > issued)
    return { err: `Cannot add ${add} — received ${newRecv} plus rejected ${rej} would be more than the ${issued} issued.` };
  /* EVERY RECEIPT KEEPS ITS OWN DATE (Ravi, 2026-10-02: "har adhoori receipt par uski apni tareekh lagegi"). The
   * receiving date below is still stamped only when the row completes, and payout still reads that; receipts[] is what
   * the Reports count, so 180 back on Tuesday of 240 issued are in Tuesday's week, the other 60 in theirs. */
  const receipts = (Array.isArray(row.receipts) ? row.receipts : Object.values(row.receipts || {})).filter(Boolean)
    .concat([{ at: at || ptNow(), qty: add }]);
  const next = Object.assign({}, row, { receivedPieces: newRecv, pendingPieces: issued - newRecv - rej, receipts });
  /* THE FIRST RECEIVING DATE STANDS. Re-stamping it here let anybody move a finished row into another
   * payout period just by touching its pieces — which is the one thing only an admin may do, through
   * the date override below. */
  if (next.pendingPieces <= 0) { next.pendingPieces = 0; next.frozen = true; next.receivingDate = row.receivingDate || ptNow(); }
  return { row: next };
}

/** Set the rejection count. Same ceiling, same freeze. */
function bdApplyRej(row, val) {
  const issued = ptNum(row.issuePieces), recv = ptNum(row.receivedPieces);
  const rej = parseInt(val, 10) || 0;
  if (rej < 0) return { err: 'Rejection cannot be negative.' };
  if (recv + rej > issued)
    return { err: `Received ${recv} plus rejected ${rej} would be more than the ${issued} issued.` };
  const next = Object.assign({}, row, { rejectionPieces: rej, pendingPieces: issued - recv - rej });
  if (next.pendingPieces <= 0) {
    next.pendingPieces = 0; next.frozen = true;
    next.receivingDate = row.receivingDate || ptNow();
  }
  return { row: next };
}

function ptNow() {
  const p = n => String(n).padStart(2, '0');
  const d = new Date();
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* WHAT TWO PEOPLE CAN BOTH CHANGE ON ONE JOB WORK ROW (2026-10-01). A receipt adds to receivedPieces as this screen
 * last read it and writes the whole row back, so two people receiving on the same issue at once lost one receipt —
 * and receipts are what piece-rate pay is counted from. */
const BD_COUNTED = ['issuePieces', 'receivedPieces', 'rejectionPieces', 'pendingPieces', 'frozen'];
class BdChangedError extends Error {}
async function bdSaveRow(next) {
  const clean = Object.assign({}, next); delete clean._key;
  /* THE ROW IS READ AGAIN JUST BEFORE IT IS WRITTEN. If somebody else's save changed its pieces since this screen
   * read it, nothing is written: the screen takes their version and says so, and the entry is made again on top
   * of it. A read that fails (or finds nothing) keeps the old behaviour — it never blocks a save on its own. */
  const was = (PT.base || []).find(r => r && r.id === next.id);
  let now = null;
  try { now = await ptGet('pt_baseData/' + next.id); } catch (e) { now = null; }
  if (was && now && typeof now === 'object' && Object.keys(now).length
      && BD_COUNTED.some(k => String(now[k] == null ? '' : now[k]) !== String(was[k] == null ? '' : was[k]))) {
    PT.base = (PT.base || []).map(r => (r.id === next.id ? Object.assign({ _key: next.id }, now) : r));
    if (!SP_QUIET) renderPbase();
    throw new BdChangedError(`somebody else saved this row a moment ago (received is now ${nf(ptNum(now.receivedPieces))}, `
      + `pending ${nf(ptNum(now.pendingPieces))}). The screen shows their figures — enter yours again on top of them.`);
  }
  await ptPut('pt_baseData/' + next.id, clean);
  PT.base = (PT.base || []).map(r => (r.id === next.id ? Object.assign({ _key: next.id }, clean) : r));
  if (!SP_QUIET) renderPbase();
}

/* ---- Job Work: the parts of a row, the menu, the picked rows ---- */
const JW_PICK = new Set();
const JW_ICON = {
  doc: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  ok: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
  tick: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m5 12 5 5 9-10"/></svg>',
  open: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  /* The Order Console's own: cutting, a stack of pieces, the press, and the two that mean somebody
   * has to look at something. */
  cut: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 18M8 16.5 20 6"/></svg>',
  box: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>',
  press: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h16v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M7 14V8a3 3 0 0 1 3-3h4"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  alert: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14 6l4 4"/></svg>',
};
const jwPct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/** The seven figures as cards. The number and its name stay in .v and .l, where every reader looks. */
function jwKpiCards(k) {
  /* "All entries" is not a filter, so it never lights up — only a card that narrows the rows does. */
  const card = (key, v, label, icon, tone, sub) => `<div class="jw-kc metric pt-kpi${key ? k.sel(key) : k.sel(key).replace(' pt-kpi-on', '')}" data-kpi="${key}">`
    + `<div class="jw-kt"><div><div class="v">${v}</div><div class="l">${label}${key && PT_BD_KPI === key ? ' ✕' : ''}</div></div>`
    + `<span class="jw-ki ${tone}">${JW_ICON[icon]}</span></div><div class="jw-ks">${sub}</div></div>`;
  return '<div class="jw-kpis">'
    + card('', nf(k.base.length), 'Entries', 'doc', 'blue', PT.at.base ? 'read live · ' + esc(PT.at.base) : 'read live')
    + card('issued', nf(k.tI), 'Issued', 'up', 'blue', 'pieces given out')
    + card('received', nf(k.tR), 'Received', 'ok', 'green', jwPct(k.tR, k.tI) + '% of issued')
    + card('pending', nf(k.tP), 'Pending pieces', 'clock', 'amber', jwPct(k.tP, k.tI) + '% of issued')
    + card('rejected', nf(k.tRej), 'Rejected', 'x', 'red', jwPct(k.tRej, k.tI) + '% of issued')
    + card('done', nf(k.done), 'Completed', 'tick', 'green', jwPct(k.done, k.base.length) + '% of entries')
    + card('open', nf(k.open), 'Open', 'open', 'amber', 'entries still out')
    + '</div>';
}

/** Initials in a circle, the same colour for the same person every time. */
function jwAvatar(name) {
  const n = String(name || '').trim();
  const ini = (n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('') || '?').toUpperCase();
  /* Six colours, picked by the name: the same person is always the same colour, neighbours rarely are. */
  const PAL = [['#e0ecff', '#1d4ed8'], ['#f3e8ff', '#7e22ce'], ['#dcfce7', '#15803d'], ['#ffe4e6', '#be123c'], ['#fef3c7', '#b45309'], ['#e0f2fe', '#0369a1']];
  let h = 7; for (const c of n) h = (h * 131 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = PAL[h % PAL.length];
  return `<span class="jw-av" style="background:${bg};color:${fg}">${esc(ini)}</span>`;
}
/** A ring that fills as the pieces come back (received and rejected both close the row). */
function jwRing(r) {
  const iss = ptNum(r.issuePieces), back = ptNum(r.receivedPieces) + ptNum(r.rejectionPieces);
  const p = iss > 0 ? Math.max(0, Math.min(100, Math.round((back / iss) * 100))) : 0;
  const C = 2 * Math.PI * 14, col = p >= 100 ? '#16a34a' : p > 0 ? '#2563eb' : '#cbd5e1';
  return `<div class="jw-ring"><svg viewBox="0 0 36 36" width="34" height="34"><circle cx="18" cy="18" r="14" fill="none" stroke="#e5e7eb" stroke-width="4"/>`
    + `<circle cx="18" cy="18" r="14" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(C * p / 100).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 18 18)"/></svg>`
    + `<b>${p}%</b></div>`;
}
/** Pending (nothing back), In Progress (some back), Completed (all accounted for). */
function jwStatus(r) {
  const back = ptNum(r.receivedPieces) + ptNum(r.rejectionPieces), rej = ptNum(r.rejectionPieces), pend = ptNum(r.pendingPieces);
  const pill = r.frozen ? `<span class="jw-st done">${JW_ICON.tick} Completed</span>`
    : back > 0 ? `<span class="jw-st prog">↻ In Progress</span>` : `<span class="jw-st pend">${JW_ICON.clock} Pending</span>`;
  return pill + (jwCorrOfRow(r.id) ? '<div class="jw-sub" style="color:#b45309;font-weight:700" title="A change to this entry is waiting for approval">change asked</div>' : '')
    + (!r.frozen && pend > 0 ? `<div class="jw-sub">${nf(pend)} pending</div>` : '')
    + (rej ? `<div class="jw-sub" style="color:var(--bad);font-weight:700">${nf(rej)} rejected</div>` : '')
    + (r.receivingDate ? `<div class="jw-sub" title="Receiving date">${esc(r.receivingDate)}</div>` : '')
    + (r.remarks ? `<div class="jw-sub" style="font-style:italic;white-space:normal;max-width:200px" title="Remarks">${esc(r.remarks)}</div>` : '');
}
/** One row. The Edit / Ask / WhatsApp buttons live in the ⋯ menu, drawn with the row and shown on a click. */
function jwRow(r) {
  const [d, t] = String(r.issueDate || '').split(/,\s*/);
  const menu = [`<button class="jw-mi" data-jw-view="${esc(r.id)}">View details</button>`, jwWaButtons(r)].filter(Boolean).join('');
  /* CORRECTING A ROW IS ON THE ROW, not behind ⋯ (Ravi, 2026-09-22: "entry krne wale se koi mistake ho gya to
   * wo apna correction add kar sake and admin can correct"). Whoever may edit gets Edit on an open row; an
   * admin gets it on a completed one too (the dialog re-opens a row if pieces are left pending); whoever
   * enters rows without that right gets Correction, which goes to an approver. */
  const ask = `<button class="jw-btn jw-fix" data-jw-ask="${esc(r.id)}" title="Wrong SKU, size, karigar, pieces or date? Ask for it to be corrected — an admin approves a SKU or date change">Correction</button>`;
  const fix = jwCorrOfRow(r.id) ? '<button class="jw-btn" disabled title="A change to this entry is waiting for approval">Change asked</button>'
    : ME.admin ? `<button class="jw-btn" data-bd-edit="${esc(r.id)}" title="Correct this entry">Edit</button>`
    /* An editor: Edit on an open row, and Correction always — the SKU and dates are only changed that way. */
    : ptCanEdit() ? (!r.frozen ? `<button class="jw-btn" data-bd-edit="${esc(r.id)}" title="Correct this entry">Edit</button>` : '') + (jwCanAsk() ? ask : '')
    : jwCanAsk() ? ask : '';
  return `<tr${JW_PICK.has(r.id) ? ' class="jw-on"' : ''}>`
    + `<td class="jw-ck"><input type="checkbox" class="jw-pick" data-id="${esc(r.id)}"${JW_PICK.has(r.id) ? ' checked' : ''}></td>`
    + `<td style="text-align:left"><div class="jw-d">${esc(d || '')}</div><div class="jw-t">${esc(t || '')}</div></td>`
    + `<td style="text-align:left"><div class="jw-who">${jwAvatar(r.empName)}<div><div style="font-weight:600">${esc(r.empName)}</div><div class="jw-sub">${esc(r.empType)}</div></div></div></td>`
    + `<td style="text-align:left"><div class="jw-item">${ptImgSpan(r.sku, 42)}<div style="min-width:0">`
    + `<div style="font-weight:600">${esc(r.articleSubtype || r.articleType || '')}</div>`
    + `<div class="jw-sub">${[r.color, r.size].filter(Boolean).map(esc).join(' • ')}</div>`
    + `<div class="jw-sku">${esc(r.sku)}${r.orderNo ? ' · ' + esc(r.orderNo) : ''}</div></div></div></td>`
    + `<td class="num">${nf(ptNum(r.issuePieces))} <span class="jw-u">pcs</span></td>`
    + `<td class="num">${nf(ptNum(r.receivedPieces))} <span class="jw-u">pcs</span></td>`
    + `<td>${jwRing(r)}</td>`
    + `<td style="text-align:left">${jwStatus(r)}</td>`
    + `<td><div class="jw-acts">${r.frozen ? `<button class="jw-btn" data-jw-view="${esc(r.id)}">View</button>`
      : `<button class="jw-btn jw-primary" data-bd-recv="${esc(r.id)}" title="Take in pieces that came back, and any rejects">Receive</button>`}${fix}`
    + `<span class="jw-mwrap"><button class="jw-btn jw-more" data-jw-more="${esc(r.id)}" title="More">⋯</button><div class="jw-menu hide">${menu}</div></span></div></td>`
    + whoCell(r) + '</tr>';
}

/** Everything on one row, read-only. */
function jwView(id) {
  const r = (PT.base || []).find(x => x.id === id);
  if (!r) return;
  const line = (k, v) => (v === '' || v == null ? '' : `<tr><th style="text-align:left;width:40%">${esc(k)}</th><td style="text-align:left">${esc(v)}</td></tr>`);
  ptOpenDialog({
    title: r.articleSubtype || r.sku, subtitle: `${r.sku} · ${r.empName}`,
    html: '<table class="xl"><tbody>' + [
      line('Issue date', r.issueDate), line('Karigar', r.empName), line('Type', r.empType), line('Order', r.orderNo),
      line('SKU', r.sku), line('Item', [r.articleType, r.articleSubtype, r.color, r.size].filter(Boolean).join(' · ')),
      line('Issued', nf(ptNum(r.issuePieces)) + ' pcs'), line('Received', nf(ptNum(r.receivedPieces)) + ' pcs'),
      line('Rejected', nf(ptNum(r.rejectionPieces)) + ' pcs'), line('Pending', nf(ptNum(r.pendingPieces)) + ' pcs'),
      line('Receiving date', r.receivingDate), line('Status', r.frozen ? 'Completed' : 'Open'), line('Remarks', r.remarks),
      line('Entered by', r.addedBy), line('Last changed by', r.lastEditedBy ? r.lastEditedBy + (r.lastEditedAt ? ' · ' + ptIsoDate(r.lastEditedAt) : '') : ''),
      line('WhatsApp — issue', r.waIssueSentAt ? 'sent ' + (ptIsoDate(r.waIssueSentAt) || '') : ''),
      line('WhatsApp — receipt', r.waRecvSentAt ? 'sent ' + (ptIsoDate(r.waRecvSentAt) || '') : ''),
    ].join('') + '</tbody></table>',
  });
}

/** The bar along the bottom while rows are picked. */
function jwBulkShow() {
  let bar = document.getElementById && document.getElementById('jwBulk');
  const pane = $('panePbase');
  if (!bar && pane && typeof document.createElement === 'function') {
    bar = document.createElement('div'); bar.id = 'jwBulk'; bar.className = 'jw-bulk hide';
    bar.innerHTML = '<span class="jw-bn"></span><span style="flex:1"></span>'
      + '<button type="button" class="jw-btn jw-primary" data-jw-bulk="recv">✓ Receive selected</button>'
      + '<button type="button" class="jw-btn" data-jw-bulk="export">&#8615; Export selected</button>'
      + '<button type="button" class="jw-btn" data-jw-bulk="clear" title="Clear the selection">✕</button>';
    pane.appendChild(bar);
    bar.addEventListener('click', e => { const b = e.target.closest('[data-jw-bulk]'); if (b) jwBulk(b.getAttribute('data-jw-bulk')); });
  }
  const live = new Set((PT.base || []).map(r => r.id));
  [...JW_PICK].forEach(id => { if (!live.has(id)) JW_PICK.delete(id); });
  if (!bar) return;
  bar.classList.toggle('hide', !JW_PICK.size);
  const n = bar.querySelector && bar.querySelector('.jw-bn');
  if (n) n.textContent = JW_PICK.size === 1 ? '1 job selected' : nf(JW_PICK.size) + ' jobs selected';
}
/** What the picked rows still have out, if all of it came back good. */
function jwBulkPlan() {
  const rows = (PT.base || []).filter(r => JW_PICK.has(r.id));
  const open = rows.filter(r => !r.frozen && ptNum(r.pendingPieces) > 0);
  return { rows, open, pcs: open.reduce((a, r) => a + ptNum(r.pendingPieces), 0) };
}
async function jwBulkReceive() {
  const plan = jwBulkPlan();
  let done = 0; const bad = [];
  SP_QUIET = true;
  try {
    for (const r of plan.open) {
      const a = bdApplyRecv(r, String(ptNum(r.pendingPieces)));
      if (a.err) { bad.push(r.sku + ': ' + a.err); continue; }
      try { await bdSaveRow(a.row); done++; } catch (e) { bad.push(r.sku + ': ' + (e.message || e)); }
    }
  } finally { SP_QUIET = false; }
  JW_PICK.clear();
  renderPbase();
  return { done, bad };
}
function jwBulk(kind) {
  if (kind === 'clear') { JW_PICK.clear(); renderPbase(); return; }
  if (kind === 'export') {
    const keep = PT._pbaseRows;
    PT._pbaseRows = (PT.base || []).filter(r => JW_PICK.has(r.id));
    try { $('pbExport').onclick(); } finally { PT._pbaseRows = keep; }
    return;
  }
  const plan = jwBulkPlan();
  if (!plan.open.length) { $('pbMsg').className = 'err'; $('pbMsg').textContent = 'Nothing is pending on the rows you picked.'; return; }
  ptOpenDialog({
    title: `Receive ${nf(plan.pcs)} pieces?`,
    subtitle: `${nf(plan.open.length)} open row(s) of the ${nf(plan.rows.length)} picked`,
    note: 'Every piece still out on these rows is taken in as received, good. Rejects are not assumed — use Receive on a row for those.',
    html: '<div style="max-height:40vh;overflow:auto;font-size:12.5px">' + plan.open.map(r => `${esc(r.empName)} — ${esc(r.sku)}: <b>${nf(ptNum(r.pendingPieces))}</b> pcs`).join('<br>') + '</div>',
    saveLabel: 'Receive ' + nf(plan.pcs),
    onSave: async () => {
      const res = await jwBulkReceive();
      $('pbMsg').className = res.bad.length ? 'err' : 'muted';
      $('pbMsg').textContent = `Received on ${nf(res.done)} row(s).` + (res.bad.length ? ' Not done: ' + res.bad.slice(0, 3).join(' · ') : '');
      return '';
    },
  });
}

$('pbTable').addEventListener('click', e => {
  const more = e.target.closest('[data-jw-more]');
  if (more) {
    e.stopPropagation();
    const m = more.parentNode.querySelector('.jw-menu');
    const was = m && !m.classList.contains('hide');
    document.querySelectorAll('#pbTable .jw-menu').forEach(x => x.classList.add('hide'));
    if (m && !was) m.classList.remove('hide');
    return;
  }
  const v = e.target.closest('[data-jw-view]');
  if (v) { jwView(v.getAttribute('data-jw-view')); return; }
  if (e.target.closest('.jw-menu')) document.querySelectorAll('#pbTable .jw-menu').forEach(x => x.classList.add('hide'));
});
$('pbTable').addEventListener('change', e => {
  const one = e.target.closest('.jw-pick'), all = e.target.closest('.jw-pickall');
  if (!one && !all) return;
  if (one) { if (one.checked) JW_PICK.add(one.getAttribute('data-id')); else JW_PICK.delete(one.getAttribute('data-id')); }
  else (PT._pbaseRows || []).slice(0, PB_CAP).forEach(r => { if (all.checked) JW_PICK.add(r.id); else JW_PICK.delete(r.id); });
  renderPbase();
});
(() => { try { if (typeof document.addEventListener === 'function') document.addEventListener('click', e => {
  if (!e.target.closest || !e.target.closest('.jw-mwrap')) document.querySelectorAll('#pbTable .jw-menu').forEach(x => x.classList.add('hide')); }); } catch (e) { /* a test page */ } })();

/** The Received cell: "12 / 39", and a bar — green for what came back, red for what was rejected. */
function jwRecvCell(r) {
  const iss = ptNum(r.issuePieces), rec = ptNum(r.receivedPieces), rej = ptNum(r.rejectionPieces);
  const pct = v => (iss > 0 ? Math.max(0, Math.min(100, Math.round((v / iss) * 100))) : 0);
  return `<td class="num"><div class="jw-rc"><b>${nf(rec)}</b><span> / ${nf(iss)}</span></div>`
    + `<div class="jw-bar" title="${nf(rec)} received${rej ? ' · ' + nf(rej) + ' rejected' : ''} of ${nf(iss)} issued">`
    + `<i style="width:${pct(rec)}%"></i><i class="rej" style="width:${pct(rej)}%"></i></div></td>`;
}
/** Only the WhatsApp notice that can go now — the issue one until something comes back, then the receipt one. */
function jwWaButtons(r) {
  const btn = kind => {
    if (waWhyBlocked(r, kind)) return '';
    const sent = waSent(r, kind);
    return `<button class="jw-mi jw-wa" data-wa-row="${esc(r.id)}|${kind}" title="${sent ? 'Already sent — this sends it again' : 'Open WhatsApp with the message ready'}">`
      + `${sent ? '↻' : '💬'} WhatsApp — ${kind === 'issue' ? 'issue message' : 'receipt message'}</button>`;
  };
  return btn('issue') + btn('receive');
}

/** The Receive form: pieces back now, and the rejects on the row — the same two rules the boxes had. */
function jwRecvOpen(id) {
  const row = (PT.base || []).find(r => r.id === id);
  if (!row) return;
  if (row.frozen) { $('pbMsg').className = 'err'; $('pbMsg').textContent = 'That row is already complete.'; return; }
  const iss = ptNum(row.issuePieces), rec = ptNum(row.receivedPieces), rej = ptNum(row.rejectionPieces), pend = ptNum(row.pendingPieces);
  ptOpenDialog({
    title: 'Receive',
    subtitle: `${obUC(row.sku)} · ${row.empName}`,
    note: `${nf(iss)} issued · ${nf(rec)} received · ${nf(rej)} rejected · ${nf(pend)} still out`,
    fields: [
      { key: 'recv', label: 'Pieces received now (added)', type: 'number', min: 0, value: '' },
      { key: 'rej', label: 'Rejected on this row (total)', type: 'number', min: 0, value: rej || '' },
    ],
    saveLabel: 'Save',
    onSave: async v => {
      const addRecv = String(v.recv || '').trim(), newRej = String(v.rej || '').trim();
      if (!addRecv && (newRej === '' ? 0 : parseInt(newRej, 10)) === rej) return 'Type the pieces that came back, or change the rejects.';
      let next = row;
      if (addRecv) { const a = bdApplyRecv(next, addRecv); if (a.err) return a.err; next = a.row; }
      if (newRej !== '' && parseInt(newRej, 10) !== ptNum(next.rejectionPieces)) {
        if (next.frozen && !row.frozen && parseInt(newRej, 10) > ptNum(next.rejectionPieces)) return 'Received plus rejected would be more than was issued.';
        const b = bdApplyRej(Object.assign({}, next, { frozen: false }), newRej); if (b.err) return b.err; next = b.row;
      }
      try { await bdSaveRow(next); } catch (e) { return 'Not saved: ' + (e.message || e); }
      $('pbMsg').className = 'muted';
      $('pbMsg').textContent = next.frozen ? `${obUC(row.sku)} · ${row.empName}: complete, nothing pending.`
        : `${obUC(row.sku)} · ${row.empName}: ${nf(next.pendingPieces)} still pending.`;
      return '';
    },
  });
}
$('pbTable').addEventListener('click', e => {
  const b = e.target.closest('[data-bd-recv]');
  if (b) jwRecvOpen(b.getAttribute('data-bd-recv'));
});

/* Written with innerHTML, so the handlers are delegated rather than inline — a module's functions
 * are not globals and an onclick attribute would find nothing. */
$('pbTable').addEventListener('change', async e => {
  const el = e.target;
  const kind = el.classList.contains('pt-recv-in') ? 'recv'
    : el.classList.contains('pt-rej-in') ? 'rej' : '';
  if (!kind) return;
  const id = el.getAttribute('data-id');
  const row = (PT.base || []).find(r => r.id === id);
  if (!row) return;
  if (row.frozen) { $('pbMsg').className = 'err'; $('pbMsg').textContent = 'That row is already complete.'; return; }

  const res = kind === 'recv' ? bdApplyRecv(row, el.value) : bdApplyRej(row, el.value);
  if (res.err) {
    $('pbMsg').className = 'err'; $('pbMsg').textContent = res.err;
    el.value = kind === 'recv' ? '' : String(ptNum(row.rejectionPieces) || '');
    return;
  }
  el.disabled = true;
  try {
    await bdSaveRow(res.row);
    $('pbMsg').className = 'muted';
    $('pbMsg').textContent = res.row.frozen
      ? `${obUC(row.sku)} · ${row.empName}: complete, nothing pending.`
      : `${obUC(row.sku)} · ${row.empName}: ${nf(res.row.pendingPieces)} still pending.`;
  } catch (err) {
    $('pbMsg').className = 'err';
    $('pbMsg').textContent = 'Not saved: ' + (err.message || err);
    el.disabled = false;
  }
});
/* ---- Edit Entry: a dialog, the way the production app does it ----
 *
 * Editing belongs in front of the row you clicked, not in the "new entry" form at the top of the
 * page — using one form for both meant a custom entry could not be edited at all: its SKU is not in
 * the master database, so the form declared it unknown and emptied every dropdown.
 *
 * What may be changed here is exactly what the old tool allows: who it was issued to, the three
 * quantities, the remark — and, for an admin only, the SKU and the two dates. Received and rejected
 * are TOTALS, not additions, because that is what the dialog says they are.
 */
let BD_M = null;      // the entry open in the dialog

function bdModalClose() { BD_M = null; $('bdModal').classList.add('hide'); }
function bdModalMsg(t, bad) { const m = $('bdmMsg'); m.textContent = t || ''; m.className = bad ? 'err' : 'muted'; }

const ptIsoDate = v => {
  const ms = ptDtMs(v);
  return ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '';
};

function bdEdit(id) {
  const r = (PT.base || []).find(x => x.id === id);
  if (!r) return;
  if (!ptCanEdit()) { $('pbMsg').className = 'err'; $('pbMsg').textContent = PT_NO_EDIT; return; }
  BD_M = r;
  $('bdmWho').textContent = `SKU: ${r.sku || '—'}  ·  Employee: ${r.empName || '—'}`;
  $('bdmName').value = r.empName || '';
  const types = ptEmpTypes();
  $('bdmType').innerHTML = types.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  if (!types.includes(r.empType) && r.empType)
    $('bdmType').innerHTML = `<option value="${esc(r.empType)}">${esc(r.empType)}</option>` + $('bdmType').innerHTML;
  $('bdmType').value = r.empType || '';
  $('bdmIssue').value = ptNum(r.issuePieces);
  $('bdmRecv').value = ptNum(r.receivedPieces);
  $('bdmRej').value = ptNum(r.rejectionPieces);
  $('bdmRemarks').value = r.remarks || '';
  $('bdmSku').value = r.sku || '';
  $('bdmIssueDate').value = ptIsoDate(r.issueDate);
  $('bdmRecvDate').value = ptIsoDate(r.receivingDate);
  // The SKU and the dates move money and periods, so they are an admin's to change — same rule as there.
  const admin = !!ME.admin;
  $('bdmAdminSku').classList.toggle('hide', !admin);
  $('bdmAdminDates').classList.toggle('hide', !admin);
  /* Somebody who cannot change the dates should still be able to read them — hiding the box left a
   * received row looking as though it had no date at all. */
  $('bdmDatesRead').classList.toggle('hide', admin);
  $('bdmDatesTxt').textContent = `Issued ${r.issueDate || '—'} · received ${r.receivingDate || 'not yet'}`
    + (r.receivingDate ? ' — once a row is received, only an admin can change that date.' : '')
    + ' Wrong SKU or size? Close this and press Correction on the row — an admin approves it.';
  $('bdmDelete').classList.toggle('hide', !admin);
  /* One or the other, never both: an admin deletes, everybody else asks. */
  $('bdmAsk').classList.toggle('hide', admin);
  $('bdmFrozen').classList.toggle('hide', !r.frozen);
  bdModalMsg(r.orderNo ? `Order ${r.orderNo}.` : 'Custom order — no Order ID.');
  $('bdModal').classList.remove('hide');
}

/**
 * The queue: what is waiting, who asked, and why.
 *
 * Each row carries what the entry SAID when it was asked about. A week later the row may have been
 * corrected instead, which is why approving re-reads it rather than trusting this snapshot — but
 * seeing what the asker saw is what makes the decision answerable.
 */
async function apvOpenDialog() {
  if (!ME.admin) return;
  await apvLoad(true);
  const rows = apvOpen().sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const body = rows.map(r => {
    const d = r.data || {};
    const live = (PT.base || []).some(x => x && x.id === r.id);
    return `<tr><td style="text-align:left">${esc(ptIsoDate(r.at) || r.at || '')}`
      + `<div class="muted" style="font-size:11px">${esc(String(r.by || '').split('@')[0])}</div></td>`
      + `<td style="text-align:left;font-size:12px">${esc(d.empName || '')}`
      + `<div class="muted" style="font-family:ui-monospace,monospace;font-size:11px">${esc(d.sku || '')}</div></td>`
      + `<td class="num">${nf(ptNum(d.issuePieces))}</td>`
      + `<td style="text-align:left;font-size:12px">${esc(d.issueDate || '')}${
          d.orderNo ? `<div class="muted" style="font-size:11px">${esc(d.orderNo)}</div>` : ''}</td>`
      + `<td style="text-align:left;font-size:12px;white-space:normal;max-width:240px">${esc(r.why || '') || '<span class="muted">no reason given</span>'}</td>`
      + `<td>${live ? '' : '<span class="pill pill-ok">already gone</span>'}</td>`
      + `<td style="white-space:nowrap">`
        + `<button class="ghost" data-apvy="${esc(apvKey(r))}" style="padding:2px 9px;font-size:12px;color:var(--bad)">Delete it</button> `
        + `<button class="ghost" data-apvn="${esc(apvKey(r))}" style="padding:2px 9px;font-size:12px">Keep it</button>`
      + `</td></tr>`;
  }).join('');
  ptOpenDialog({
    title: 'Deletion requests',
    subtitle: rows.length ? `${nf(rows.length)} waiting` : 'Nothing waiting',
    note: 'Somebody who may correct a production entry but not delete one asked for these. Approving '
      + 'DELETES the entry, and every figure counted off it changes — the order balance, the cutting '
      + 'cap, the weekly report and that person\'s pay. Keeping it simply closes the request.',
    html: rows.length
      ? `<div class="xlwrap" style="max-height:56vh;border:1px solid var(--line);border-radius:10px">
          <table class="xl"><thead><tr>${['Asked', 'Who / SKU', 'Pieces', 'Issued', 'Why', '', '']
            .map((h, i) => `<th${i === 2 ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody></table></div>`
      : '<div class="muted" style="padding:22px;text-align:center">Nothing is waiting to be answered.</div>',
    saveLabel: '',
  });
  const again = async (id, yes) => {
    const err = await apvAnswer(id, yes);
    if (err) return ptDlgMsg(err, true);
    ptDlgClose();
    await apvOpenDialog();
  };
  $('ptDlgBody').querySelectorAll('[data-apvy]').forEach(b => { b.onclick = () => {
    const d = (apvOpen().find(x => apvKey(x) === b.getAttribute('data-apvy')) || {}).data || {};
    if (!confirm(`Delete this entry?\n\n${nf(ptNum(d.issuePieces))} piece(s) of ${d.sku} issued to ${d.empName} on ${d.issueDate}.\n\n`
      + 'This cannot be undone, and every figure counted off this row changes with it.')) return;
    again(b.getAttribute('data-apvy'), true);
  }; });
  $('ptDlgBody').querySelectorAll('[data-apvn]').forEach(b => { b.onclick = () => again(b.getAttribute('data-apvn'), false); });
}

$('pbApv').onclick = apvOpenDialog;
$('pbTable').addEventListener('click', e => { const b = e.target.closest('[data-jw-ask]'); if (b) jwCorrAskOpen(b.getAttribute('data-jw-ask')); });

