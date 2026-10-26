/* Pricing-API / FriBooks.gs — the four inventory workbooks, answered from FabriCrush Inventory (added 2026-10-25).
 *
 * Ravi, 25 Oct: "abhi jo inventory google sheet se aati h usase data na lekar is firebase app se lena h and sab jagah auto
 * karna h". Step 2: every Sellora report that read the Orders Data workbooks (sales analysis, weekly / daily sales, the
 * nightly, research's 30-day sales) or a main workbook's Catalog tab now reads the same rows from fabricrush-inventory,
 * which InvSync.gs keeps fresh. The readers are unchanged: bookOpen_(id) hands back an object that answers the few calls
 * they make — getSheetByName('Orders' | 'CPC Orders' | 'Catalog' | 'CPC Catalog'), getLastRow, getLastColumn,
 * getRange(row, col, n, w).getValues(), getName — with the rows in the sheet's own columns and order:
 *   Orders  : Order ID, Purchase Date/Time (Date), Date ('YYYY-MM-DD' PT), SKU, ASIN, Units, Revenue, Order Status,
 *             Sales Channel, MCF ('MCF' | 'Amazon')         — oldest first, row 1 the header
 *   Catalog : SKU, ASIN, FNSKU, ParentASIN, Title, Brand, ImageURL, Color, Size, Sub Category, UpdatedAt, Listing Type,
 *             Parent Title                                    — the in-app catalogue corrections (catedit) on top
 * Only the months a range covers are read. Any other workbook id still opens as a real spreadsheet.
 */
function friOrdersBrand_(id) { return id === ORDERS_DATA_IDS[0] ? 'SP' : id === ORDERS_DATA_IDS[1] ? 'CPC' : ''; }
function friMainBrand_(id) { return id === RIDHI_SHEET_ID ? 'SP' : id === CPC_SHEET_ID ? 'CPC' : ''; }

/** SpreadsheetApp.openById — the inventory workbooks from FabriCrush Inventory, anything else as it is. */
function bookOpen_(id) {
  var b = friOrdersBrand_(id);
  if (b) return friOrdersBook_(b);
  var m = friMainBrand_(id);
  if (m) return friMainBook_(m);
  return SpreadsheetApp.openById(id);
}

var FRI_BOOK_CACHE = {};
function friOrdersBook_(b) {
  if (FRI_BOOK_CACHE['o' + b]) return FRI_BOOK_CACHE['o' + b];
  var summary = invGet_('idx/ord_' + b) || { months: {} };
  var months = Object.keys(summary.months || {}).filter(function (ym) { return (summary.months[ym] || 0) > 0; }).sort();
  var start = [], total = 0;                     // first data index (0-based) of each month
  months.forEach(function (ym, i) { start[i] = total; total += summary.months[ym] || 0; });
  var loaded = {};
  function monthRows(i) {
    if (loaded[i]) return loaded[i];
    var ym = months[i], rows = invReadSet_('ord', b + '_' + ym, 'ord_' + b + '_' + ym).rows.map(function (r) {
      var pm = Date.parse(r[1]);
      return [r[0], isNaN(pm) ? String(r[1] || '') : new Date(pm), String(r[2] || ''), r[3], r[4], Number(r[5]) || 0, Number(r[6]) || 0,
        r[7] || '', r[8] || '', r[9] === 1 ? 'MCF' : 'Amazon'];
    });
    var want = summary.months[ym] || 0;           // the counts decide the row numbers: pad or cut to them
    while (rows.length < want) rows.push(['', '', '', '', '', 0, 0, '', '', '']);
    if (rows.length > want) rows.length = want;
    loaded[i] = rows;
    return rows;
  }
  var head = ['Order ID', 'Purchase Date/Time', 'Date', 'SKU', 'ASIN', 'Units', 'Revenue', 'Order Status', 'Sales Channel', 'MCF'];
  var sheet = {
    getName: function () { return b === 'CPC' ? 'CPC Orders' : 'Orders'; },
    getLastRow: function () { return total + 1; },
    getLastColumn: function () { return 10; },
    /** The first row (1-based) of the first month on or after 'YYYY-MM-DD' — lets a reader skip the years it does not need. */
    friFirstRow: function (ymd) { var ym = String(ymd).slice(0, 7); for (var i = 0; i < months.length; i++) if (months[i] >= ym) return start[i] + 2; return total + 2; },
    getRange: function (row, col, n, w) {
      n = n || 1; w = w || 1;
      return { getValues: function () {
        var out = [];
        for (var r = row; r < row + n; r++) {
          var line;
          if (r === 1) line = head;
          else {
            var k = r - 2, i = 0;
            while (i + 1 < months.length && start[i + 1] <= k) i++;
            line = (k >= 0 && k < total) ? monthRows(i)[k - start[i]] : ['', '', '', '', '', 0, 0, '', '', ''];
          }
          out.push(line.slice(col - 1, col - 1 + w));
        }
        return out;
      } };
    },
  };
  var book = {
    getName: function () { return 'FabriCrush Inventory · ' + (b === 'CPC' ? 'CPC' : 'Ridhi') + ' orders'; },
    /* each workbook has only its own brand's tab — a reader that tries both names must not count the brand twice */
    getSheetByName: function (name) { return name === (b === 'CPC' ? 'CPC Orders' : 'Orders') ? sheet : null; },
    getSheets: function () { return [sheet]; },
    getSpreadsheetTimeZone: function () { return 'America/Los_Angeles'; },
  };
  FRI_BOOK_CACHE['o' + b] = book;
  return book;
}

function friMainBook_(b) {
  if (FRI_BOOK_CACHE['m' + b]) return FRI_BOOK_CACHE['m' + b];
  var catSheet = null;
  function cat() {
    if (catSheet) return catSheet;
    var rows = invReadSet_('cat', b, 'cat_' + b).rows, edits = invGet_('catedit/' + b) || {};
    var data = [INV_CAT_COLS.slice()].concat(rows.map(function (r) {
      var o = r.slice(), e = edits[r[0]] || {};
      if (e.parent) o[3] = e.parent; if (e.image) o[6] = e.image; if (e.color) o[7] = e.color; if (e.size) o[8] = e.size; if (e.subcat) o[9] = e.subcat;
      return o;
    }));
    catSheet = {
      getName: function () { return b === 'CPC' ? 'CPC Catalog' : 'Catalog'; },
      getLastRow: function () { return data.length; },
      getLastColumn: function () { return INV_CAT_COLS.length; },
      getRange: function (row, col, n, w) {
        n = n || 1; w = w || 1;
        return { getValues: function () {
          var out = [];
          for (var r = row; r < row + n; r++) { var line = data[r - 1] || []; var o = []; for (var c = col - 1; c < col - 1 + w; c++) o.push(line[c] == null ? '' : line[c]); out.push(o); }
          return out;
        } };
      },
    };
    return catSheet;
  }
  var book = {
    getName: function () { return 'FabriCrush Inventory · ' + (b === 'CPC' ? 'CPC' : 'Ridhi'); },
    getSheetByName: function (name) { return name === (b === 'CPC' ? 'CPC Catalog' : 'Catalog') ? cat() : null; },
    getSheets: function () { return [cat()]; },
    getSpreadsheetTimeZone: function () { return 'America/Los_Angeles'; },
  };
  FRI_BOOK_CACHE['m' + b] = book;
  return book;
}
