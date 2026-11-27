/* ==== WHY REJECTED ====
 * (Ravi, 27 Nov 2026, switch lineHold) Whoever rejects pieces picks a reason (REJ_REASONS; "Other" needs a short note), and a
 * rejection with a reason is scrap (core/lookups.js). One pair of boxes and one check, used by every form that rejects pieces:
 * the Job Work receive, edit and correction, the QC check forms, alteration and spotting / touching, and the test receive.
 * ERRORS: a missing reason is refused on the form and nothing is saved. Switch off: no boxes, no check, no new reason. */

const rejWhyNeeded = pcs => lineHoldOn() && pcs > 0;
/** The reason in a dialog's values or on a record that carries one; empty when there is none. */
const rejWhyOf = v => ({ why: String((v && v.rejWhy) || '').trim(), note: String((v && v.rejNote) || '').trim() });
/** '' when `pcs` rejected pieces may be saved with this reason, else what to do. */
function rejWhyErr(pcs, reason) {
  if (!rejWhyNeeded(pcs)) return '';
  if (!REJ_REASONS.includes(reason.why)) return `Pick why the ${nf(pcs)} piece(s) were rejected.`;
  if (reason.why === 'Other' && !reason.note) return 'Type a short note saying why — "Other" needs one.';
  return '';
}
/** The reason as a record stores it (rejWhy, rejNote); nothing when no pieces are rejected or no reason was picked. */
function rejWhySaved(pcs, reason) {
  if (!(pcs > 0) || !reason.why) return {};
  return Object.assign({ rejWhy: reason.why }, reason.note ? { rejNote: reason.note } : {});
}
/** A rejection recorded before a reason was asked: it counts as before, and no edit may turn it into scrap (27 Nov). */
const rejWasOld = c => ptNum(c.rejected) > 0 && !c.rejWhy;
/** '' unless an edit would add to such a rejection, or give it a reason. Switch off: ''. */
function rejOldErr(before, rejected, reason) {
  if (!lineHoldOn() || !rejWasOld(before) || !(rejected > ptNum(before.rejected) || reason.why)) return '';
  return `These ${nf(ptNum(before.rejected))} rejected pieces were recorded before a reason was asked and count as before — `
    + 'record any more rejected pieces as a new QC check, with their reason.';
}
/** How many pieces an edited QC check must give a reason for: all it rejects when it rejects more than before, had a reason
 *  or is given one now. A rejection from before reasons were asked may stay without one. */
const rejEditPcs = (before, rejected, reason) => (rejected > ptNum(before.rejected) || before.rejWhy || reason.why ? rejected : 0);
/** An edited QC check carrying this reason, and none when it rejects nothing. Switch off: the check as it is. */
function rejWhyOnEdit(check, reason) {
  if (!lineHoldOn()) return check;
  const next = Object.assign({}, check);
  delete next.rejWhy; delete next.rejNote;
  return Object.assign(next, rejWhySaved(next.rejected, reason));
}

/* ---- the Job Work row's log: rejections/<id> = { at, pcs, why, note?, by } ---- */
/** The log holding no more than `most` pieces: the newest are taken back first. */
function rejLogTrimmed(log, most) {
  const newestFirst = Object.entries(log).sort(([, a], [, b]) => String(b.at).localeCompare(String(a.at)));
  let over = newestFirst.reduce((t, [, x]) => t + ptNum(x.pcs), 0) - most;
  const kept = {};
  newestFirst.forEach(([id, x]) => {
    const back = Math.max(0, Math.min(over, ptNum(x.pcs)));
    over -= back;
    if (ptNum(x.pcs) > back) kept[id] = back ? Object.assign({}, x, { pcs: ptNum(x.pcs) - back }) : x;
  });
  return kept;
}
/** What to lay over a Job Work row whose rejected total becomes `rejected`: its log brought in step, with the newly rejected
 *  pieces added under their reason (reason.by when somebody else is saving it). {} when the row has no log and gets none. */
function rejLogFor(row, rejected, reason) {
  const before = ptNum(row.rejectionPieces), added = rejected - before;
  const log = row.rejections ? rejLogTrimmed(row.rejections, Math.min(before, rejected)) : null;
  if (!rejWhyNeeded(added) || !reason.why) return log ? { rejections: log } : {};
  const id = 'rej_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const line = Object.assign({ at: new Date().toISOString(), pcs: added, why: reason.why, by: reason.by || ME.email || '' },
    reason.note ? { note: reason.note } : {});
  return { rejections: Object.assign({}, log, { [id]: line }) };
}

/* ---- the boxes ---- */
const rejWhyChoices = () => [['', '— pick why rejected —']].concat(REJ_REASONS.map(x => [x, x]));
const rejWhyOptions = () => rejWhyChoices().map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
/** The two boxes of a shared edit dialog (ptOpenDialog), filled from `v`. */
function rejWhyFields(v) {
  if (!lineHoldOn()) return [];
  const had = rejWhyOf(v);
  return [{ key: 'rejWhy', label: 'Why rejected', type: 'select', value: had.why, options: rejWhyChoices() },
    { key: 'rejNote', label: 'Reason note (needed for "Other")', value: had.note }];
}
/** The two boxes of a dialog that writes its own markup: ids <prefix>Why and <prefix>Note. */
function rejWhyHtml(prefix) {
  if (!lineHoldOn()) return '';
  return `<label>Why rejected<select id="${prefix}Why">${rejWhyOptions()}</select></label>`
    + `<label>Reason note (needed for "Other")<input id="${prefix}Note"></label>`;
}
/** A form already on the page: its two boxes (with their labels, where they have one) show only while pieces are being rejected. */
function rejWhyBoxes(prefix, pcs) {
  const list = $(prefix + 'Why'), show = rejWhyNeeded(pcs);
  if (!list) return;
  if (show && !list.innerHTML) list.innerHTML = rejWhyOptions();
  [list, $(prefix + 'Note')].forEach(box => ((box.closest && box.closest('label')) || box).classList.toggle('hide', !show));
}
/** What is typed in a page form's two boxes; empty with the switch off. */
const rejWhyTyped = prefix => rejWhyOf(lineHoldOn() ? { rejWhy: $(prefix + 'Why').value, rejNote: $(prefix + 'Note').value } : null);
/** Empty a page form's two boxes and put them away, for the next entry. */
function rejWhyClear(prefix) {
  [$(prefix + 'Why'), $(prefix + 'Note')].forEach(box => { if (box) box.value = ''; });
  rejWhyBoxes(prefix, 0);
}
/* ==== END WHY REJECTED ==== */
