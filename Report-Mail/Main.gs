/* ==== ERP REPORT MAIL — READ, BUILD, SEND (Ravi, 17 Nov 2026) ====
 * Runs as ravi@ on a timer every Monday and Thursday around 9 am India time (installReportTimers), reads the ERP
 * database and Shopify, saves the Production and Shipping PDFs to Drive and mails the counts with links to them.
 * REPORT_FOLDER_ID (Script properties) is written by the script itself on its first run.
 *
 * Settings live in this script's Project Settings → Script properties, never in the code:
 *   REPORT_TO        who gets the mail, comma separated (blank = only the account that runs the script)

 * Shopify is read the way the Reports tab's Shopify dispatch report reads it (Ravi, 19 Nov: "don't use Shopify key, we have
 * all data on our Reports tab, it should fetch from that"): through the Pricing script, whose address and key the ERP keeps
 * in Firestore config/api. The script reads them from there as ravi@, the same place the ERP does, so nobody types a key.
 *
 * Error strategy: the database is the report — if it cannot be read, nothing half-made is sent; instead a short mail
 * to the account owner says the report failed and why. Shopify, Drive and the photos are extras: if they fail the
 * report still goes, and the mail says in red what is missing. The report writes nothing to the database (the only
 * write in this script is the reject mail's "mailed" stamp, Rejects.gs).
 */
const RM_DB_URL = 'https://price-research-48ff3-default-rtdb.asia-southeast1.firebasedatabase.app';
const RM_FIRESTORE = 'https://firestore.googleapis.com/v1/projects/price-research-48ff3/databases/(default)/documents/';
const RM_SHOP_NOTES_DOC = 'audit/shoporders';   // the ERP's note per Shopify order (MCF id, carrier)
const RM_PRICING_DOC = 'config/api';           // the Pricing script's address and key, as the ERP's Reports tab reads them
const RM_NODES = { ob: 'pt_orderBook', shopProd: 'pt_shopProd', cut: 'pt_cuttingData', base: 'pt_baseData', press: 'pt_pressInventory', fgi: 'pt_fgiLedger', so: 'pt_salesOrders', alerts: 'pt_orderAlerts' };
const RM_SHOP_DAYS_BACK = 120;   // Shopify orders placed in the last 120 days — the Shopify Dispatch report's window
const RM_IMG_WIDTH = 120;        // photos are fetched small; the PDF shows them at about 42 px
const RM_FETCH_TRIES = 3;

/** The timer's entry point: the days since the last mail. */
function sendErpReport() {
  rmSendReport_('');
}
/**
 * Run by hand: a report counting from last Saturday up to today, sent only to the account that runs it (Ravi, 17 Nov:
 * "make it from Saturday … I have to show it to the boss"). Run on a Saturday it counts that Saturday alone.
 */
function sendErpReportSinceSaturday() {
  const today = rmIstDay(Date.now());
  rmSendReport_(rmAddDays(today, -((rmWeekday(today) + 1) % 7)), Session.getEffectiveUser().getEmail());
}
/** Read, build and send. fromDay: '' for "since last mail"; to: '' for the people on REPORT_TO. */
function rmSendReport_(fromDay, to) {
  const now = Date.now();
  let data;
  try {
    data = rmReadDatabase_();
  } catch (e) {
    rmMailFailure_('The ERP database could not be read: ' + (e.message || e));
    return;
  }
  const win = fromDay ? rmWindowFrom(fromDay, now) : rmWindow(now);
  data.shop = rmReadShopify_(now, win.fromDay);
  data.meta = rmReadShopMeta_();
  const rep = rmReport(data, now, fromDay);
  const day = rmShowDay(rep.today).replace(/\//g, '-');
  const links = rmSavePdfs_(rep, day);
  MailApp.sendEmail({
    to: to || rmRecipients_(),
    subject: rmMailSubject(rep),
    htmlBody: rmMailHtml(rep, links),
    name: 'Fabricrush ERP',
  });
  console.log('ERP report sent to ' + (to || rmRecipients_()) + ' for ' + rep.win.fromDay + ' – ' + rep.win.lastDay);
}

/**
 * The two PDFs go into the "Fabricrush reports" Drive folder; the mail carries the links. The folder, not each file, is
 * shared with the people on REPORT_TO, quietly (no "shared with you" mail twice a week), and files inside inherit it.
 * Drive is reached through the Advanced Drive service so the script needs only its own files (drive.file), never the
 * rest of Ravi's Drive. Never throws: { Production, Shipping, err } — a PDF that fails is named in red in the mail.
 */
function rmSavePdfs_(rep, day) {
  const out = { err: '' }, problems = [];
  let folderId;
  try { folderId = rmReportFolder_(); } catch (e) { return { err: 'The PDFs could not be saved to Drive: ' + (e.message || e) }; }
  rmShareFolder_(folderId, problems);
  const imgSrc = rmPhotoLoader_(rep);
  [['Production', rmProductionSections(rep)], ['Shipping', rmShippingSections(rep)]].forEach(([title, sections]) => {
    try { out[title] = rmSavePdf_(folderId, title + ' ' + day + '.pdf', rmPdfHtml(title, rep, sections, imgSrc)); }
    catch (e) { problems.push(title + ' PDF not made: ' + (e.message || e)); }
  });
  if (problems.length) { out.err = problems.join(' · '); console.warn(out.err); }
  return out;
}
function rmSavePdf_(folderId, name, html) {
  const pdf = Utilities.newBlob(html, 'text/html', 'report.html').getAs('application/pdf');
  const f = Drive.Files.create({ name, parents: [folderId], mimeType: 'application/pdf' }, pdf, { fields: 'id,webViewLink' });
  return f.webViewLink;
}
/** The Drive folder the reports are kept in, made on the first run and remembered in Script properties. */
function rmReportFolder_() {
  const props = PropertiesService.getScriptProperties(), id = props.getProperty('REPORT_FOLDER_ID');
  if (id) {
    try { Drive.Files.get(id, { fields: 'id,trashed' }); return id; } catch (e) { console.warn('Report folder ' + id + ' is gone; making a new one.'); }
  }
  const f = Drive.Files.create({ name: 'Fabricrush reports', mimeType: 'application/vnd.google-apps.folder' }, null, { fields: 'id' });
  props.setProperties({ REPORT_FOLDER_ID: f.id, REPORT_SHARED_WITH: '' });
  return f.id;
}
/** Shares the folder with anyone on REPORT_TO it is not shared with yet; the list shared with is kept in Script properties. */
function rmShareFolder_(folderId, problems) {
  const props = PropertiesService.getScriptProperties(), me = Session.getEffectiveUser().getEmail();
  const done = String(props.getProperty('REPORT_SHARED_WITH') || '').split(',').filter(Boolean);
  rmRecipients_().split(',').map(s => s.trim().toLowerCase()).filter(e => e && e !== me.toLowerCase() && done.indexOf(e) < 0).forEach(e => {
    try {
      Drive.Permissions.create({ role: 'reader', type: 'user', emailAddress: e }, folderId, { sendNotificationEmail: false });
      done.push(e);
    } catch (err) {
      problems.push('Could not share the reports folder with ' + e + ': ' + (err.message || err));
    }
  });
  props.setProperty('REPORT_SHARED_WITH', done.join(','));
}

/* ---- printer late alert (Printers.gs) ----
 * Tuesday and Friday around 10 am India time (Ravi, 19 Nov: first "only on tuesday and thursday", then "the printer mail should go
 * on tuesday and friday", the days the company report does not go out; it was daily before): one mail
 * listing every printer whose lines are 5 or more days late, to the people on
 * PRINTER_ALERT_TO (Script properties, comma separated) only — not also to the account that runs the script (Ravi, 19 Nov:
 * "remove the mails from me and natanikeshav1603 and send the printer one to these people only"). With PRINTER_ALERT_TO
 * blank it goes to that account only. A day with no such line sends nothing. If the vendor orders cannot be read, the
 * account owner is told (rmMailFailure_) and nothing else is sent. */
const PL_SEND_HOUR = 10;
/** The days the notice goes out, as Apps Script's WeekDay names. */
const PL_SEND_DAYS = ['TUESDAY', 'FRIDAY'];
function sendPrinterAlerts() {
  let vo, vendors, map;
  try { [vo, vendors, map] = rmReadNodes_(['pt_vendorOrders', 'pt_masters/vendor', 'pt_vendorMap']); }
  catch (e) { rmMailFailure_('Printer late alert: the vendor orders could not be read: ' + (e.message || e)); return; }
  const today = rmIstDay(Date.now()), to = rmRecipients_('PRINTER_ALERT_TO');
  const groups = plByPrinter(plLateLines(vo, today), plNames(vendors, map), plPhones(vendors, map));
  if (!groups.length) { console.log('Printer late alert: no printer is more than ' + PL_LATE_AFTER_DAYS + ' days late; nothing sent.'); return; }
  MailApp.sendEmail({ to, subject: plMailSubject(groups, today), htmlBody: plMailHtml(groups, today), name: 'Fabricrush ERP' });
  console.log('Printer late alert: one mail, ' + groups.length + ' printer(s), to ' + to);
}
/** Run once by hand: removes the old printer-alert timers (the daily one too) and sets one for each day in PL_SEND_DAYS. */
function installPrinterAlertTimer() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendPrinterAlerts').forEach(t => ScriptApp.deleteTrigger(t));
  PL_SEND_DAYS.forEach(d =>
    ScriptApp.newTrigger('sendPrinterAlerts').timeBased().onWeekDay(ScriptApp.WeekDay[d]).atHour(PL_SEND_HOUR).nearMinute(0).inTimezone('Asia/Kolkata').create());
  console.log('Timers set: printer late alert on ' + PL_SEND_DAYS.join(' and ').toLowerCase() + ', ' + PL_SEND_HOUR + ' am India time.');
}

/** Run once by hand: replaces this script's Monday and Thursday timers with fresh ones at 9 am India time. */
function installReportTimers() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendErpReport').forEach(t => ScriptApp.deleteTrigger(t));
  [ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.THURSDAY].forEach(d =>
    ScriptApp.newTrigger('sendErpReport').timeBased().onWeekDay(d).atHour(9).nearMinute(0).inTimezone('Asia/Kolkata').create());
  console.log('Timers set: Monday and Thursday, 9 am India time.');
}

/** Who gets a mail: the addresses in that Script property (comma separated), else only the account that runs the script. */
function rmRecipients_(property) {
  const list = String(PropertiesService.getScriptProperties().getProperty(property || 'REPORT_TO') || '').trim();
  return list || Session.getEffectiveUser().getEmail();
}
function rmMailFailure_(why) {
  console.error('ERP report not sent: ' + why);
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'Fabricrush report NOT sent', why + '\n\nNothing was sent to the others. Run sendErpReport again from the script editor once this is fixed.');
}

/* ---- reading ---- */

/** Every node the report needs, read in one go as the account that runs the script. Throws when any node fails. */
function rmReadDatabase_() {
  const keys = Object.keys(RM_NODES), vals = rmReadNodes_(keys.map(k => RM_NODES[k])), out = {};
  keys.forEach((k, i) => { out[k] = vals[i]; });
  return out;
}
/** One update of several fields under a database path, in one write (all or nothing). Throws, naming the path, when refused. */
function rmPatchNode_(path, updates) {
  if (typeof sbjPatchList_ === 'function' && sbjPatchList_(path, updates)) return;                        // ERP data first (SupaJob.gs); Firebase gets the copy
  const req = { url: RM_DB_URL + '/' + path + '.json', method: 'patch', contentType: 'application/json', payload: JSON.stringify(updates),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  const res = rmFetchAllWithRetry_([req])[0];
  if (res.getResponseCode() !== 200) throw new Error(path + ' refused the update, answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
}
/** Database paths read in one go, in the order asked ({} for an empty one). Throws, naming the path, when one fails. */
function rmReadNodes_(paths) {
  const sb = typeof sbjReadLists_ === 'function' ? sbjReadLists_(paths) : undefined; if (sb) return sb;              // ERP data first (SupaJob.gs)
  const token = ScriptApp.getOAuthToken();
  const res = rmFetchAllWithRetry_(paths.map(p => ({ url: RM_DB_URL + '/' + p + '.json', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true })));
  return paths.map((p, i) => {
    const code = res[i].getResponseCode();
    if (code !== 200) throw new Error(p + ' answered ' + code + ': ' + res[i].getContentText().slice(0, 200));
    return JSON.parse(res[i].getContentText() || 'null') || {};
  });
}
/**
 * Shopify, both stores, through the Pricing script, without photos (the PDF uses the ERP's own line photos) so the
 * Pricing script stays well inside its time limit. Two small reads per store: every order still open from the last
 * 120 days (pending, ready), and every order changed since the mail's first day (shipped in the window).
 * Never throws: { orders, err }.
 */
function rmReadShopify_(nowMs, fromDay) {
  let api;
  try { api = rmPricingApi_(); } catch (e) { return { orders: [], err: "the Reports tab's Shopify address could not be read (" + (e.message || e) + ')' }; }
  const today = rmIstDay(nowMs), since = new Date(rmMs(fromDay)).toISOString();
  const base = api.url + '?key=' + encodeURIComponent(api.key) + '&shopify=orders&nophoto=1';
  const asks = [];
  ['SP', 'CPC'].forEach(brand => {
    const shop = brand === 'CPC' ? '&shop=CPC' : '';
    asks.push({ brand, url: base + shop + '&open=1&start=' + rmAddDays(today, -RM_SHOP_DAYS_BACK) + '&end=' + today });
    asks.push({ brand, url: base + shop + '&since=' + encodeURIComponent(since) });
  });
  try {
    const res = rmFetchAllWithRetry_(asks.map(a => ({ url: a.url, muteHttpExceptions: true })));
    return rmMergeShopify(asks.map((a, i) => ({ brand: a.brand, text: res[i] ? res[i].getContentText() : '' })));
  } catch (e) {
    return { orders: [], err: String(e.message || e) };
  }
}
/** The Pricing script's answers, one order per store and id (a later answer about the same order wins). */
function rmMergeShopify(answers) {
  const errs = [], byId = new Map();
  answers.forEach(({ brand, text }) => {
    const store = RM_SHOP_STORE[brand];
    let d;
    try { d = JSON.parse(text); } catch (e) { errs.push(store + ': answered with a web page, not data'); return; }
    if (d.error) { errs.push(store + ': ' + d.error); return; }
    if (d.more || d.next) errs.push(store + ': more orders than one read holds, counts may be short');
    (d.orders || []).filter(o => !o.gone).forEach(o => byId.set(brand + '|' + o.id, Object.assign({}, o, { shopBrand: brand })));
  });
  return { orders: [...byId.values()], err: [...new Set(errs)].join(' · ') };
}
/** The Pricing script's { url, key } from Firestore config/api — where the ERP's Reports tab gets them. Throws, naming what is missing. */
function rmPricingApi_() {
  const f = rmReadFirestoreDoc_(RM_PRICING_DOC);
  const url = String((f.url || {}).stringValue || '').trim(), key = String((f.key || {}).stringValue || '').trim();
  if (!url || !key) throw new Error('config/api has no ' + (!url ? 'url' : 'key'));
  return { url, key };
}
/** One Firestore document's fields, read as the account that runs the script. Throws on any answer but 200. */
function rmReadFirestoreDoc_(path) {
  const r = UrlFetchApp.fetch(RM_FIRESTORE + path, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error(path + ' answered ' + r.getResponseCode());
  return JSON.parse(r.getContentText()).fields || {};
}
/** The ERP's own note per Shopify order (the MCF id when it went from Amazon stock). Never throws: {} on failure. */
function rmReadShopMeta_() {
  try {
    const m = ((rmReadFirestoreDoc_(RM_SHOP_NOTES_DOC).m || {}).mapValue || {}).fields || {};
    const out = {};
    Object.keys(m).forEach(id => {
      const f = (m[id].mapValue || {}).fields || {};
      out[id] = { mcfId: (f.mcfId || {}).stringValue || '', carrier: (f.carrier || {}).stringValue || '' };
    });
    return out;
  } catch (e) {
    console.warn('Shopify notes not read: ' + (e.message || e) + '; MCF is judged by carrier only.');
    return {};
  }
}
/**
 * fetchAll, retrying with growing waits while a request is refused for load (429) or by a server error (5xx), or the
 * network itself fails. After the last try a network failure is thrown; a refusal is handed back for the caller to name.
 */
function rmFetchAllWithRetry_(reqs) {
  const res = new Array(reqs.length);
  let todo = reqs.map((r, i) => i), lastErr = null;
  for (let t = 0; t < RM_FETCH_TRIES && todo.length; t++) {
    if (t) Utilities.sleep(2000 * Math.pow(2, t));
    const got = rmFetchAllOnce_(todo.map(i => reqs[i]));
    if (got.err) { lastErr = got.err; continue; }
    got.res.forEach((r, j) => { res[todo[j]] = r; });
    lastErr = null;
    todo = todo.filter(i => { const c = res[i].getResponseCode(); return c === 429 || c >= 500; });
  }
  if (lastErr) throw lastErr;
  return res;
}
function rmFetchAllOnce_(reqs) {
  try { return { res: UrlFetchApp.fetchAll(reqs) }; } catch (e) { console.warn('Network failed, trying again: ' + (e.message || e)); return { err: e }; }
}

/* ---- photos ---- */

/**
 * The PDF maker cannot load pictures from the web, so each photo is fetched once, small, and put in the page itself.
 * A photo that fails just leaves its box empty. Only real web addresses are asked for: one order's photo came from an
 * Excel sheet as "#VALUE!", and a single bad address makes Google refuse the whole batch of 50 (first live run, 19 Nov).
 */
const rmIsPhotoUrl = u => /^https?:\/\/[^\s#]+$/i.test(String(u || '').trim());
function rmPhotoLoader_(rep) {
  const urls = new Set();
  rmProductionSections(rep).concat(rmShippingSections(rep)).forEach(s => s.rows.forEach(r => { if (rmIsPhotoUrl(r.img)) urls.add(r.img); }));
  const list = [...urls], map = new Map();
  for (let i = 0; i < list.length; i += 50) {
    const part = list.slice(i, i + 50);
    let res = [];
    try { res = UrlFetchApp.fetchAll(part.map(u => ({ url: rmSmallPhoto(u), muteHttpExceptions: true }))); } catch (e) { console.warn('Photos skipped: ' + (e.message || e)); continue; }
    res.forEach((r, j) => {
      if (r.getResponseCode() !== 200) return;
      const b = r.getBlob();
      map.set(part[j], 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes()));
    });
  }
  return u => map.get(u) || '';
}
/** Shopify's picture server sends a small copy when asked for a width. */
function rmSmallPhoto(u) {
  if (!/cdn\.shopify\.com|\/cdn\/shop\//.test(u)) return u;
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'width=' + RM_IMG_WIDTH;
}
