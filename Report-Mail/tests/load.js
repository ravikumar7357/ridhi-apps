/* Loads the Apps Script files into one plain scope for the tests and the sample, the way Apps Script itself joins them. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Every script file, in the order Apps Script would join them. */
const RM_FILES = ['Rules.gs', 'Mail.gs', 'Pdf.gs', 'Printers.gs', 'Main.gs'];
/** fakes: stand-ins for Apps Script services (UrlFetchApp, Utilities …) so the reading code runs without Google. */
function loadReportMail(files, fakes) {
  const ctx = vm.createContext(Object.assign({ console }, fakes || {}));
  (files || RM_FILES).forEach(f => {
    const code = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    vm.runInContext(code.replace(/^const /gm, 'var '), ctx, { filename: f });
  });
  return ctx;
}
module.exports = { loadReportMail };
