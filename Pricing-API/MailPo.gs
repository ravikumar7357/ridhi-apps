/* Pricing-API / MailPo.gs — greige purchase orders sent as PDF mail.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== GREIGE PO BY MAIL =====================
 *
 * The Replenishment app builds the PO page; this turns it into a PDF and sends it from the account
 * this script is deployed as, with the PDF attached. Only a PO can be sent this way: the subject and
 * body are written here, the number must look like a greige PO, at most five addresses, and at most
 * MAILPO_DAILY a day — so the key cannot be used to send anything else from the owner's mailbox.
 */
var MAILPO_DAILY = 40;
function mailPo_(p) {
  var list = function (s) { return String(s || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean); };
  var to = list(p.to), cc = list(p.cc);
  var okMail = function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); };
  if (!to.length) return { ok: false, error: 'No address to send it to.' };
  var bad = to.concat(cc).filter(function (x) { return !okMail(x); });
  if (bad.length) return { ok: false, error: '"' + bad[0] + '" is not an email address.' };
  if (to.length + cc.length > 5) return { ok: false, error: 'Five addresses at most.' };
  var poNo = String(p.poNo || '').trim().toUpperCase();
  if (!/^GPO-\d{6}-[A-Z0-9]{2,4}$/.test(poNo)) return { ok: false, error: 'That is not a greige PO number.' };
  var html = String(p.html || '');
  if (!html || html.length > 300000) return { ok: false, error: 'The PO page is missing or too large.' };
  /* Nothing that runs: the PDF converter ignores scripts, and so should anything reading the mail. */
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  var day = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();
  var used = parseInt(props.getProperty('MAILPO_' + day) || '0', 10) || 0;
  if (used >= MAILPO_DAILY) return { ok: false, error: 'Daily limit of ' + MAILPO_DAILY + ' PO mails reached. Try tomorrow.' };
  var from = String(p.fromName || 'The Fabric Rush').replace(/[\r\n]/g, ' ').slice(0, 80);
  var msg = String(p.message || '').slice(0, 1500);
  var pdf = Utilities.newBlob(html, 'text/html', poNo + '.html').getAs('application/pdf').setName(poNo + '.pdf');
  MailApp.sendEmail({
    to: to.join(','), cc: cc.join(','), name: from,
    subject: 'Purchase Order ' + poNo + ' - ' + from,
    body: 'Dear Sir/Madam,\n\nPlease find attached our Purchase Order ' + poNo + '.\n\n'
      + (msg ? msg + '\n\n' : '') + 'Kindly confirm receipt and the delivery date.\n\nRegards,\n' + from,
    attachments: [pdf],
  });
  props.setProperty('MAILPO_' + day, String(used + 1));
  return { ok: true, sent: to.length + cc.length };
}

/* ===================== BOARD REPORT BY MAIL (23 Nov 2026) =====================
 * The Order Console boards' Report bucket: what is pending at a step / with a printer, as a PDF the page made. Sent from this account with
 * that PDF attached. Only for a signed-in person with rights (writerOf_ — the key alone is in every page's source), only a PDF, five
 * addresses at most, MAILREP_DAILY a day; the subject and the words around the message are written here. */
var MAILREP_DAILY = 80;
function mailReport_(p, who) {
  var list = function (s) { return String(s || '').split(/[,;\s]+/).map(function (x) { return x.trim(); }).filter(Boolean); };
  var to = list(p.to), cc = list(p.cc);
  var okMail = function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); };
  if (!to.length) return { ok: false, error: 'No address to send it to.' };
  var bad = to.concat(cc).filter(function (x) { return !okMail(x); });
  if (bad.length) return { ok: false, error: '"' + bad[0] + '" is not an email address.' };
  if (to.length + cc.length > 5) return { ok: false, error: 'Five addresses at most.' };
  var title = String(p.title || '').replace(/[\r\n]/g, ' ').slice(0, 120).trim();
  if (!title) return { ok: false, error: 'The report has no title.' };
  var b64 = String(p.pdf || '');
  if (!b64 || b64.length > 6000000) return { ok: false, error: 'The PDF is missing or too large.' };
  var bytes = Utilities.base64Decode(b64);
  if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) !== '%PDF-') return { ok: false, error: 'That is not a PDF.' };
  var day = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
  var props = PropertiesService.getScriptProperties();
  var used = parseInt(props.getProperty('MAILREP_' + day) || '0', 10) || 0;
  if (used >= MAILREP_DAILY) return { ok: false, error: 'Daily limit of ' + MAILREP_DAILY + ' report mails reached. Try tomorrow.' };
  var from = String(p.fromName || 'Ridhi Home & Living').replace(/[\r\n]/g, ' ').slice(0, 80);
  var name = String(p.fileName || 'report.pdf').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 120);
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  var msg = String(p.message || '').slice(0, 1500), summary = String(p.summary || '').slice(0, 800);
  MailApp.sendEmail({
    to: to.join(','), cc: cc.join(','), name: from, replyTo: who.email,
    subject: 'Pending report - ' + title,
    body: 'Dear Sir/Madam,\n\nPlease find attached the pending list: ' + title + '.\n\n' + (summary ? summary + '\n\n' : '')
      + (msg ? msg + '\n\n' : '') + 'Regards,\n' + from + '\n(sent by ' + who.email + ')',
    attachments: [Utilities.newBlob(bytes, 'application/pdf', name)],
  });
  props.setProperty('MAILREP_' + day, String(used + 1));
  return { ok: true, sent: to.length + cc.length };
}

/** Run once from the Apps Script editor so Google asks for permission to send mail. */
function authorizeMail() {
  Logger.log('Mail quota left today: ' + MailApp.getRemainingDailyQuota());
}

/** JSON response. Always HTTP 200 â€” the caller reads `ok`, which keeps error text readable in fetch(). */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

