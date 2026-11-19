/* ==== GOODS REJECTED ON RECEIVE (Ravi, 19 Nov 2026) ====
 * "when the challan person rejects bad printed goods on the Printer's view, the printer must send them again AND Ravi must
 * be informed by bell alert and email". The ERP writes each reject to pt_recvRejects (vendors/portal/printer-receive.js
 * vprReject) and puts it on the admins' bell; this file sends the mail. Every 15 minutes (installRejectAlertTimer) it
 * picks the rejects still pending that were never mailed, sends ONE mail listing them, then stamps each one mailedAt so it
 * is never mailed twice. Nothing new = no mail. An admin marking a reject seen on the bell (status 'seen') before the
 * mail goes means it is not mailed.
 * Who gets it: the people on REJECT_ALERT_TO (Script properties, comma separated); blank = only the account that runs the
 * script, which is Ravi — the same rule as the other two mails (rmRecipients_).
 *
 * Error strategy: a failed read, send or stamp is logged and thrown, so Apps Script's own failure notice reaches the
 * script owner and the next run tries again. The mail goes before the stamp: if stamping fails, the next run mails the
 * same rejects again — a repeat mail is better than a reject nobody hears of. This stamp is the only thing this whole
 * script writes to the database.
 */
const RJ_NODE = 'pt_recvRejects';
const RJ_CHECK_MINUTES = 15;

/** The timer's entry point: mail the new rejects, if any, then stamp them. */
function sendRejectAlerts() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) { console.log('Reject mail: the previous run is still going; this one skips.'); return; }
  try {
    const [rejects] = rmReadNodes_([RJ_NODE]);
    const list = rjToMail(rejects);
    if (!list.length) { console.log('Reject mail: nothing new; nothing sent.'); return; }
    const to = rmRecipients_('REJECT_ALERT_TO');
    MailApp.sendEmail({ to, subject: rjMailSubject(list), htmlBody: rjMailHtml(list), name: 'Fabricrush ERP' });
    rmPatchNode_(RJ_NODE, rjMailedStamp(list, new Date().toISOString()));
    console.log('Reject mail: one mail, ' + list.length + ' reject(s), to ' + to);
  } finally {
    lock.releaseLock();
  }
}
/** Run once by hand: removes any old reject-mail timer and sets one every 15 minutes. */
function installRejectAlertTimer() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendRejectAlerts').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendRejectAlerts').timeBased().everyMinutes(RJ_CHECK_MINUTES).create();
  console.log('Timer set: reject mail checked every ' + RJ_CHECK_MINUTES + ' minutes.');
}

/* ---- rules (plain functions over the data) ---- */

/** The rejects to mail: pending and never mailed, oldest first, each with its id: [{ id, ...record }]. */
function rjToMail(rejects) {
  return Object.entries(rejects || {})
    .filter(([, r]) => r && r.status === 'pending' && !r.mailedAt)
    .map(([id, r]) => Object.assign({ id }, r))
    .sort((a, b) => rmMs(a.at) - rmMs(b.at) || a.id.localeCompare(b.id));
}
/** One database update that stamps every mailed reject: { '<id>/mailedAt': when }. */
function rjMailedStamp(list, isoNow) {
  const out = {};
  list.forEach(r => { out[r.id + '/mailedAt'] = isoNow; });
  return out;
}
/** Pieces and metres rejected, kept apart (never added): { pcs, m }. */
function rjTotals(list) {
  const sum = unit => plRound(list.filter(r => rjUnit(r) === unit).reduce((t, r) => t + (parseFloat(r.qty) || 0), 0));
  return { pcs: sum('pcs'), m: sum('m') };
}
const rjUnit = r => (r.unit === 'm' ? 'm' : 'pcs');
const rjPrinters = list => new Set(list.map(r => r.code || r.printer)).size;
/** "17/11/2026 2:05 pm" in India time, or '' for no date. */
function rjWhen(at) {
  const ms = rmMs(at);
  if (!ms) return '';
  const d = new Date(ms + RM_TZ_MS), h = d.getUTCHours(), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return rmShowDay(rmIstDay(ms)) + ' ' + ((h % 12) || 12) + ':' + mm + ' ' + (h < 12 ? 'am' : 'pm');
}

/* ---- the mail, in the Printer Delay Notice style (Printers.gs) ---- */

const rjMailSubject = list => 'Goods rejected on receive: ' + plPlural(list.length, 'reject') + ' · ' + plPlural(rjPrinters(list), 'printer');
/** The printer's name opens that printer's view in the ERP, where the reject shows. */
const rjPrinterUrl = code => RM_ERP_URL + '#vend?printer=' + encodeURIComponent(code);
function rjMailHtml(list) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:1000px;font-family:Arial,Helvetica,sans-serif;color:#1d2430">'
    + '<tr><td style="background:#1f3b63;padding:14px 20px"><div style="font-size:11px;letter-spacing:2px;color:#c9d6ea">FABRICRUSH · RIDHI HOME &amp; LIVING</div>'
    + '<div style="font-size:18px;font-weight:bold;color:#ffffff;margin-top:4px">Goods Rejected on Receive</div></td></tr>'
    + '<tr><td style="padding:16px 20px 4px;font-size:14px;line-height:1.6">' + plPlural(list.length, 'reject') + ' from ' + plPlural(rjPrinters(list), 'printer')
    + ': <b>' + rmEsc(plCloth(rjTotals(list))) + '</b> not taken in. The printer must send it again; each reject is also on the ERP bell until marked seen.</td></tr>'
    + '<tr><td style="padding:8px 20px">' + rjTable(list) + '</td></tr>'
    + '<tr><td style="padding:14px 20px 4px;font-size:13px;color:#4a5363;line-height:1.6">Regards,<br><b style="color:#1d2430">Fabricrush ERP</b><br>'
    + '<span style="font-size:12px;color:#6b7380">This is an automatic notice; each reject is mailed once.</span></td></tr></table>';
}
/** One row per reject, oldest first. */
function rjTable(list) {
  const head = '<tr>' + ['Printer', 'Order · SKU', 'Item · fabric', 'Rejected', 'Reason', 'Rejected by'].map(t => plTh(t)).join('') + '</tr>';
  const cell = html => '<td style="' + PL_CELL + '">' + html + '</td>';
  const small = text => (text ? '<br><span style="font-size:12px;color:#6b7380">' + rmEsc(text) + '</span>' : '');
  const rows = list.map(r => '<tr>'
    + cell('<a href="' + rmEsc(rjPrinterUrl(r.code || '')) + '" style="color:#1a4fa3;font-weight:bold">' + rmEsc(r.printer || r.code) + '</a>' + small(r.code))
    + cell(rmEsc(r.orderNo) + small(r.sku))
    + cell(rmEsc(r.item || '–') + small(r.fabric))
    + cell('<b style="color:#b3261e;white-space:nowrap">' + rmNf(parseFloat(r.qty) || 0) + ' ' + rjUnit(r) + '</b>')
    + cell(rmEsc(r.reason) + small(r.note))
    + cell(rmEsc(r.by) + small(rjWhen(r.at)))
    + '</tr>').join('');
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">' + head + rows + '</table>';
}
