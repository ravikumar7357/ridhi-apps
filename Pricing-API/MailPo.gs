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

/** Run once from the Apps Script editor so Google asks for permission to send mail. */
function authorizeMail() {
  Logger.log('Mail quota left today: ' + MailApp.getRemainingDailyQuota());
}

/** JSON response. Always HTTP 200 â€” the caller reads `ok`, which keeps error text readable in fetch(). */
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

