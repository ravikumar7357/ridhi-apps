/* TEETH for tests/store-newdev-test.js: break the New development rules on purpose and the suite must fail every time.
 *   node tests/teeth/teeth-store-newdev.js */
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const APP = path.join(__dirname, '..', '..', 'src', 'app');
const N = 'inventory/fg-store-newdev.js', A = 'inventory/fg-store-alloc.js', H = 'inventory/fg-shop-hold.js',
  LIST = 'inventory/finished-goods.js', AMZ = 'inventory/amazon-listing-status.js', ND = 'orders/vendor-holdings.js';
const breaks = {
  'read with the switch off': [N, 'if (!fgaOn()) return;\n  try { FGA_SALES', 'try { FGA_SALES'],
  'no line is New development': [N, "? 'newDev' : 'rest'", "? 'rest' : 'rest'"],
  'New development stays Custom': [A, 'fgaOpenLines(lines.rest)', 'fgaOpenLines(lines.rest.concat(lines.newDev))'],
  'the line type is ignored': [ND, "const t = (l.orderTypeKey === 'newdev' || l.orderTypeKey === 'regular') ? l.orderTypeKey : head;", 'const t = head;'],
  'closed New development lines count': [A, 'lines.newDev.filter(fgaIsOpen)', 'lines.newDev'],
  'Sea goes by Air': [N, "SEA: 'sea', ", ''],
  'AWD goes by Air': [N, ", AWD: 'awd' }", ' }'],
  'the mode is ignored': [N, "lane: laneOf.get(n.orderNo) || 'air',", "lane: 'air',"],
  'both are added': [N, 'let extra = Math.max(0, fgaLaneSum(repl) - fgaLaneSum(newDev));', 'let extra = fgaLaneSum(repl);'],
  'Replenishment extra is lost': [N, 'out[k] = newDev[k] + more;', 'out[k] = newDev[k];'],
  'extra is not used up': [N, 'extra -= more;\n', '\n'],
  'a column ignores its own New development': [N, 'Math.max(0, repl[k] - newDev[k])', 'repl[k]'],
  'New development is not in the columns': [A, 'fgaJoinLanes(fgaNewDevLanes(sku, book), fgaReplLanes(sku, book, stores))', 'fgaReplLanes(sku, book, stores)'],
  'issues are not taken off': [N, 'shpHoldLeft(lines.map(fgaClaim), ledgerRows)', 'shpHoldLeft(lines.map(fgaClaim), [])'],
  'dispatches are not taken off': [N, 'fgaLessFba(waiting, fgaSentToFba(ledgerRows))', 'waiting'],
  'returned pieces stay sent': [N, 'let left = fbaState(r).open;', 'let left = fgiNum(r.qty);'],
  'named pieces are taken twice': [N, 'left -= pieces;\n      named', 'named'],
  'unnamed pieces are forgotten': [N, 'if (left > 0) loose.push', 'if (false) loose.push'],
  'a dispatch before the order counts': [N, ' && o.on <= d.day)', ')'],
  'the order date itself does not count': [N, 'o.on <= d.day', 'o.on < d.day'],
  'an unnamed piece counts for every order': [N, 'pieces -= met; o.pending -= met;', 'o.pending -= met;'],
  'another SKU counts': [N, 'o.key === d.key && ', ''],
  'an order sent in full stays': [N, 'return left.filter(o => o.pending > 0);', 'return left;'],
  'unlisted goes': [A, 'if (!fgaListingWhy(sku)) return inLanes;', 'return inLanes;'],
  'unlisted blocks Replenishment too': [A, 'return Math.min(inLanes, fgaLaneSum(fgaReplLanes(sku, book, SHP_HOLD_STORES)));', 'return 0;'],
  'inactive is refused': [N, " || st === 'inactive') return '';", ") return '';"],
  'unknown goes': [N, "if (st === 'listed' || st === 'inactive')", "if (st === 'listed' || st === 'inactive' || st === 'unknown')"],
  'an unread listing is trusted': [N, "LST.err ? 'unknown' : lstOf(sku).st", 'lstOf(sku).st'],
  'the refusal says nothing': [A, "(newDev ? ' ' + newDev : '')", "''"],
  'every refusal speaks of the listing': [N, "(fgaBook().newDev.has(shpHoldKey(sku)) ? fgaListingWhy(sku) : '')", 'fgaListingWhy(sku)'],
  'a save does not read the sales orders': [A, 'fgaSalesRead(), lstLoad()]', 'lstLoad()]'],
  'a save does not read the listings': [A, 'fgaSalesRead(), lstLoad()]', 'fgaSalesRead()]'],
  'the last check reads the need only': [H, 'await fgaFiguresReread();\n      const why', 'await fgaNeedReread();\n      const why'],
  'a failed read is silent on screen': [N, 'const fgaSalesWhy = () => (FGA_SALES.err ?', 'const fgaSalesWhy = () => (false ?'],
  'a failed read is silent in the console': [N, "console.warn('India store shares: the sales orders", "String('India store shares: the sales orders"],
  'the list does not say it': [LIST, "const unread = alloc ? fgaSalesWhy() : '';", "const unread = '';"],
  'opening the screen does not read them': [LIST, ", typeof fgaSalesRead === 'function' ? fgaSalesRead() : null]);", ']);'],
  'the figure cannot be pressed': [A, 'return fgaOpensNewDev(r, share) ?', 'return false ?'],
  'every FBA figure can be pressed': [A, "r.alloc[share] > 0 && ((r.newDevLanes || {})[share] || 0) > 0", 'r.alloc[share] > 0 && FGA_LANES.includes(share)'],
  'an empty figure can be pressed': [A, "r.alloc[share] > 0 && ((r.newDevLanes", "((r.newDevLanes"],
  'the press opens nothing': [LIST, 'if (nd) return fgaNewDevOpen(', 'if (nd) return String('],
  'the box lists every column': [N, '.filter(o => o.lane === lane);', ';'],
  'the box hides what was issued': [N, 'fgaNum(o.ordered - o.pending)', "'0'"],
  'the box has no tag': [N, '${esc(o.no)} ${FGA_NEW_DEV_TAG}</td>', '${esc(o.no)}</td>'],
  'an order number is put in as HTML': [N, '<tr><td style="text-align:left">${esc(o.no)}', '<tr><td style="text-align:left">${o.no}'],
  'the box does not say the listing': [N, ' ${fgaListingWhy(s)}`,', '`,'],
  'no tag on the alerts': [AMZ, '${newDevOf(a.sku)}', ''],
  'the tag has no pieces': [N, " · ${nf(o.pending)} pending</div>", '</div>'],
  'tags with the switch off': [N, "if (!fgaOn()) return () => '';", ''],
  'the alerts do not say an unread list': [AMZ, "+ (unread ? ' · ' + unread : '');", ';'],
};
let survived = 0;
const tmp = path.join(os.tmpdir(), 'teeth-store-newdev-' + process.pid + '.js');
for (const [name, [file, from, to]] of Object.entries(breaks)) {
  const src = fs.readFileSync(path.join(APP, file), 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log('  NOT APPLIED ' + name); survived++; continue; }
  fs.writeFileSync(tmp, src.replace(from, () => to));
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'store-newdev-test.js')], { env: Object.assign({}, process.env, { FGA_MUT_FILE: file, FGA_MUT_SRC: tmp }) });
  const caught = run.status !== 0;
  if (!caught) survived++;
  console.log((caught ? '  caught   ' : '  SURVIVED ') + name);
}
fs.rmSync(tmp, { force: true });
console.log('\n' + (Object.keys(breaks).length - survived) + ' of ' + Object.keys(breaks).length + ' broken copies caught');
process.exit(survived ? 1 : 0);
