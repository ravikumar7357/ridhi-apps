/* Pricing-API / Notifications.gs — approval notification mails, and two stock-column editor checks.
 * Split out of Code.gs on 2026-10-09 without changing a line. All .gs files share one global
 * scope, so anything here can call anything in another file. Routes: Code.gs doGet / doPost. */

/* ===================== Notifications ===================== */

/**
 * Email the approvers that something is waiting for them. Sent from the account this script runs as.
 *
 * BEST EFFORT ON PURPOSE. The approval queue in the app is the source of truth; this is only a nudge.
 * If the mail scope has not been granted, or the daily quota is spent, this returns the reason and
 * the caller still reports the submission as successful â€” because it was.
 *
 * âš ï¸ Needs the script to be re-authorised once after this scope is added to appsscript.json.
 */
function notifyApproval_(toCsv, subject, body) {
  var to = String(toCsv || '').split(',').map(function (s) { return s.trim(); })
    .filter(function (s) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s); }).slice(0, 20);
  if (!to.length) return { ok: false, error: 'no valid recipients' };
  var subj = String(subject || 'Approval pending').slice(0, 200);
  var text = String(body || '').slice(0, 4000);
  var sent = [], failed = [];
  to.forEach(function (addr) {
    try { MailApp.sendEmail(addr, subj, text); sent.push(addr); }
    catch (e) { failed.push(addr + ': ' + String(e.message || e).slice(0, 120)); }
  });
  if (!sent.length) return { ok: false, error: failed.join(' | ') || 'nothing sent' };
  return { ok: true, sent: sent, failed: failed, quotaLeft: (function () {
    try { return MailApp.getRemainingDailyQuota(); } catch (e) { return null; }
  })() };
}

/**
 * RUN THIS ONCE FROM THE EDITOR to grant the mail permission and prove email actually works.
 *
 * Running it does two jobs: Apps Script asks for the new MailApp scope (accept it), and a real email
 * lands in your inbox â€” so "it is authorised" is something you SEE rather than assume. Read the
 * execution log for the outcome either way.
 */
function testApprovalEmail() {
  var me = Session.getEffectiveUser().getEmail();
  if (!me) { Logger.log('Could not read your email address. Run this from the editor while signed in.'); return; }
  try {
    MailApp.sendEmail(me, 'Amazon Research â€” approval email test',
      'If you are reading this, the backend can send approval notifications.\n\n' +
      'Remaining email quota today: ' + MailApp.getRemainingDailyQuota());
    Logger.log('SENT to ' + me + '. Check your inbox. Remaining quota today: ' + MailApp.getRemainingDailyQuota());
  } catch (e) {
    Logger.log('FAILED: ' + (e.message || e) +
      '\nIf this mentions authorisation, re-run and accept the permission prompt.');
  }
}

/**
 * Editor check: what the stock report ACTUALLY says about one SKU.
 *
 * The whole MCF column rests on one number, and which column that number comes from was wrong once
 * already. This prints every header and every value for a single SKU, so the next disagreement with
 * Seller Central takes one run instead of a deploy per guess. Put a SKU in SKU and press Run.
 */
function stockColsTest() {
  var SKU = '';
  var BRAND = 'SP';
  if (!SKU) { Logger.log('Put a SKU in the SKU variable first, e.g. RQL147-K.'); return; }
  setBrand_(BRAND);
  var r = ageCreate_();
  Logger.log('report requested: %s', JSON.stringify(r).slice(0, 200));
  Logger.log('Now run stockColsPoll() with that reportId once Amazon says DONE.');
}
function stockColsPoll(reportId, sku) {
  var d = agePoll_(reportId);
  if (d.status !== 'done') { Logger.log('status: %s — run again in a minute', d.status); return; }
  Logger.log('the column being used for Available: "%s"', d.availCol || '(none found — falling back)');
  Logger.log('all headers: %s', (d.headers || []).join(' | '));
  var hit = (d.rows || []).filter(function (x) {
    return String(x.sku).toUpperCase() === String(sku || '').toUpperCase();
  })[0];
  Logger.log(hit ? sku + ' → available ' + hit.available + ' (total aged ' + hit.total + ')'
                 : sku + ' is not in the report at all');
}


