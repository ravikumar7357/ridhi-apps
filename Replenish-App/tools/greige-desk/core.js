/* core/util.js -- Small shared helpers: escaping, number and date formatting, ids, lists in words.
 * An ES module. Its imports are worked out from the code by the split script. */

/* ---- small helpers, same names as the app --------------------------------------------------- */

var ESCMAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ESCMAP[c]; });
}
function nf(n) { return Math.round(n || 0).toLocaleString('en-IN'); }
function money(n) {
  return (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/* TODAY AS THE CLOCK ON THE WALL SAYS IT, not as Greenwich does. The date was read off toISOString(),
 * which is UTC: from midnight to half past five in the morning, India time, every entry, PO and
 * "days out" count was stamped with yesterday's date. The date is built from the local calendar now,
 * which is also how every other date in this file is read back (Date.parse of 'YYYY-MM-DDT00:00:00'). */
function lmToday() {
  var d = new Date(), two = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}
function uid() { return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function uniq(list) {
  var seen = {}, out = [];
  list.forEach(function (x) { var k = String(x || '').trim(); if (k && !seen[k]) { seen[k] = 1; out.push(k); } });
  return out;
}

/** Whole days between a written date and today. */
function lmDays(d) {
  if (!d) return null;
  var then = Date.parse(String(d) + 'T00:00:00'), now = Date.parse(lmToday() + 'T00:00:00');
  if (isNaN(then) || isNaN(now)) return null;
  return Math.round((now - then) / 86400000);
}
function daysWord(n) { return n === null ? '' : n === 0 ? 'today' : n === 1 ? '1 day' : n + ' days'; }

/** "A", "A and B", "A, B and C" -- a list the way it would be said out loud. */
function lmList(xs) {
  var a = (xs || []).filter(Boolean);
  if (!a.length) return '';
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

/* ---- every lot, the whole journey on one line ------------------------------------------------ */
var RUPEE = String.fromCharCode(8377);
var DASH = String.fromCharCode(8212);
var MUTED_DASH = '<span class="muted">' + DASH + '</span>';
var r2 = function (x) { return Math.round((x || 0) * 100) / 100; };
/** 13-Aug-26, as the books print a date. */
var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtD(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
  return m ? m[3] + '-' + MON3[parseInt(m[2], 10) - 1] + '-' + m[1].slice(2) : String(d || '');
}
/* THE AMOUNT IN WORDS, in lakhs and crores -- "INR Thirty Six Lakh Twenty Thousand Only" -- because
 * that is the line a mill's accountant reads first and the one a typing slip cannot survive. */
function inrWords(n) {
  n = Math.round((n || 0) * 100) / 100;
  var rupees = Math.floor(n), paise = Math.round((n - rupees) * 100);
  var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven',
    'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  var two = function (x) { return x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''); };
  var three = function (x) {
    var h = Math.floor(x / 100), r = x % 100;
    return (h ? ones[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : '');
  };
  var words = function (x) {
    if (!x) return 'Zero';
    var out = [], cr = Math.floor(x / 10000000); x %= 10000000;
    var lk = Math.floor(x / 100000); x %= 100000;
    var thou = Math.floor(x / 1000); x %= 1000;
    if (cr) out.push(words(cr) + ' Crore');
    if (lk) out.push(two(lk) + ' Lakh');
    if (thou) out.push(two(thou) + ' Thousand');
    if (x) out.push(three(x));
    return out.join(' ');
  };
  return 'INR ' + words(rupees) + (paise ? ' and ' + two(paise) + ' Paise' : '') + ' Only';
}

/* core/vocab.js -- The words of the register: movement types, their signs and labels, PO statuses, GST states, chase thresholds.
 * An ES module. Its imports are worked out from the code by the split script. */

/* ---- the ledger's vocabulary, lifted from the app ------------------------------------------- */

/* Greige in from the mill, out to the processing house, and back as RFD. The two halves of that
 * round trip are separate movements on purpose: what is with the processor is neither greige stock
 * nor RFD stock, and a factory that cannot see that figure cannot chase it. */
var FAB_SIGN = {
  RECEIVE_GREIGE: 1, ISSUE_TO_RFD: -1, RECEIVE_RFD: 1,
  OPENING_RFD: 1, PURCHASE_RFD: 1, ISSUE_TO_CUTTING: -1,
  /* DAMAGE IS A MOVEMENT, NOT A LABEL ON A LOT.
   *
   * A hole, a stain, a bleach burn: the cloth is still in the building but it will never reach a
   * cutting table, so it has to leave the usable stock the same way an issue does -- with a date, a
   * quantity and a reason against the lot it came out of. Written as a flag instead, the stock
   * figure would stay wrong and somebody would promise cloth that cannot be cut. */
  DAMAGE: -1,
};
var FAB_LABEL = {
  RECEIVE_GREIGE: 'Greige received', ISSUE_TO_RFD: 'Greige sent for RFD', RECEIVE_RFD: 'RFD received',
  OPENING_RFD: 'RFD opening stock', PURCHASE_RFD: 'RFD bought (received ready)',
  ISSUE_TO_CUTTING: 'RFD to cutting',
  DAMAGE: 'Damaged \u2014 written off',
};
/* The state a movement leaves the cloth in -- a receipt of RFD makes RFD, whatever the row says. */
var FAB_TXN_STATE = {
  RECEIVE_GREIGE: 'GREIGE', ISSUE_TO_RFD: 'GREIGE', RECEIVE_RFD: 'RFD',
  OPENING_RFD: 'RFD', PURCHASE_RFD: 'RFD', ISSUE_TO_CUTTING: 'RFD',
};
var FAB_STATE_LABEL = { GREIGE: 'Greige', RFD: 'RFD', PRINTED: 'Printed' };

/* Which lots a movement may be written against: you send greige, you receive what is out at a
 * processor, you issue RFD. The pickers are filtered by this and nothing else. */
var FAB_KIND_WANT = { ISSUE_TO_RFD: 'greige', RECEIVE_RFD: 'out', ISSUE_TO_CUTTING: 'rfd',
  DAMAGE: 'any' };

/* A RECEIPT IS THE ONE MOVEMENT THAT CAN BE REFUSED AT THE DOOR.
 *
 * A bale arrives short, or woven at the wrong width, or off shade, and part of it goes straight back
 * on the same vehicle. The challan still says what was sent, and the mill still has to be told what
 * was kept, so both figures are written down -- but only what stayed comes into stock. */
var FAB_CAN_RETURN = { RECEIVE_GREIGE: 1, RECEIVE_RFD: 1, PURCHASE_RFD: 1 };

var GPO_STATUS = {
  open: ['Sent', 'pill-sea'], sent: ['Sent', 'pill-sea'],
  part: ['Part received', 'pill-low'], received: ['Received', 'pill-ok'], closed: ['Closed short', 'pill-ok'], cancelled: ['Cancelled', 'pill-out'],
};


/* HOW LONG IS IT A DAY TOO LONG?
 *
 * Bleaching a lot takes the better part of a week, so a lot still out after seven days is one worth
 * a telephone call. A PO that a mill has had for a week without delivering is the same. These are
 * the only two numbers on this screen that are a judgement rather than a fact, so they are written
 * here, once, and said out loud on the screen itself. */
var CHASE_PROCESSOR_DAYS = 7;
var CHASE_PO_DAYS = 7;

/* ---- the PO dialog -------------------------------------------------------------------------- */

/* THE STATE A GSTIN BELONGS TO is written in its first two digits, so it is read off rather than
 * typed a second time -- 08 is Rajasthan, wherever the number is printed. */
var GST_STATES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura',
  '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
  '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu',
  '34': 'Puducherry', '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh'
};
/* A GSTIN AS THE GST LAW WRITES IT (Ravi, 13 Oct: "it should follow the standard GSTIN format"): 15 characters --
 * a state code, the 10-character PAN (5 letters, 4 digits, a letter), the registration number in that state, the
 * letter Z, and a check character worked out from the first 14. '' when it is right, else what is wrong. */
var GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function gstinCheckChar(g14) {
  var sum = 0;
  for (var i = 0; i < 14; i++) { var v = GSTIN_CHARS.indexOf(g14.charAt(i)) * (i % 2 ? 2 : 1); sum += Math.floor(v / 36) + (v % 36); }
  return GSTIN_CHARS.charAt((36 - (sum % 36)) % 36);
}
function gstinProblem(g) {
  var s = String(g || '').trim().toUpperCase();
  if (!s) return '';
  if (s.length !== 15) return 'A GSTIN has 15 characters; this one has ' + s.length + '.';
  if (!GST_STATES[s.slice(0, 2)] && s.slice(0, 2) !== '97' && s.slice(0, 2) !== '99') return s.slice(0, 2) + ' is not a GST state code (01 to 38).';
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s.slice(2, 12))) return 'Characters 3 to 12 must be the PAN: 5 letters, 4 digits, 1 letter (' + s.slice(2, 12) + ').';
  if (!/^[1-9A-Z]$/.test(s.charAt(12))) return 'Character 13 is the registration number in the state: 1-9 or A-Z.';
  if (s.charAt(13) !== 'Z') return 'Character 14 is always Z.';
  if (gstinCheckChar(s.slice(0, 14)) !== s.charAt(14)) return 'The last character does not check out (it should be ' + gstinCheckChar(s.slice(0, 14)) + '). A character is mistyped.';
  return '';
}
function gstState(g) {
  var c = String(g || '').trim().slice(0, 2), n = GST_STATES[c];
  return n ? n + ', Code : ' + c : '';
}

/* core/register.js -- The register itself: the sample data, loading and saving it, and migrating older saved copies.
 * An ES module. Its imports are worked out from the code by the split script. */
/* =============================================================================================
 * GREIGE -> RFD -> CUTTING, as a model that runs on this machine alone.
 *
 * The live screen reads five registers out of Firebase. This one carries the same rules over the
 * same shapes, with the registers kept in this browser, so the flow can be walked end to end
 * without a sign-in, a network, or any chance of touching live data. Transaction types, field
 * names and function names are the live ones on purpose: what is learnt here reads straight
 * across to Replenish-App/public/index.html.
 *
 * Ravi, 2026-09-26: "m pahle greige fabric purchase karta hu, then greige ko RFD par bhejta hu,
 * RFD se receive hota h then cut pcs / running me printers ko deta hu."
 * ============================================================================================= */

var LM_KEY = 'greige-desk-v4';

/* PIECES (THANS) FOR THE SAMPLE CHALLANS: n pieces adding up to exactly `total` metres, the first
 * `checked` of them measured at the door (a few a little short, the way thans arrive). Seeded, so the
 * sample reads the same every time it is put back. */
function lmRng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function lmPieces(start, n, total, seed, checked, diff) {
  var rnd = lmRng(seed), avg = total / n, out = [], sum = 0, DIFF = diff || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, -0.2];
  var one = function (x) { return Math.round(x * 10) / 10; };
  for (var i = 0; i < n; i++) {
    var m = i < n - 1 ? one(avg + (rnd() - 0.5) * 6) : one(total - sum);
    sum = one(sum + m);
    out.push({ than: String(start + i), m: m, chk: (checked === 'all' || i < checked) ? one(m + DIFF[Math.floor(rnd() * DIFF.length)]) : null });
  }
  return out;
}

/* ---- the registers -------------------------------------------------------------------------- */

var DB = null;                                  /* { mst, fab, gpo } */

/* Sample data that shows every state the screen has to draw: a lot that came back cheaply, one
 * sitting at a processor, one that came back badly, RFD that was already on the floor, and a PO
 * nobody has sent yet. Two processors at 6.8% and 14% is the conversation the loss column is for. */
function lmSample() {
  return {
    mst: [
      { rfd: 'Sheeting 62', greige: 'Greige Sheeting 67',
        warp: '30s', weft: '30s', epi: 76, ppi: 68,
        greigeWidth: 67, rfdWidth: 62, active: true },
      { rfd: 'Cambric 44', greige: 'Greige Cambric 48',
        warp: '40s', weft: '40s', epi: 92, ppi: 88,
        greigeWidth: 48, rfdWidth: 44, active: true },
      { rfd: 'Poplin 58', greige: 'Greige Poplin 63',
        warp: '2/40s', weft: '40s', epi: 110, ppi: 76,
        greigeWidth: 63, rfdWidth: 58, active: true },
      { rfd: 'Rayon 44', greige: 'Greige Rayon 46',
        warp: '30s', weft: '30s', epi: 68, ppi: 68,
        greigeWidth: 46, rfdWidth: 44, active: true },
    ],
    /* The company's own details start empty and are filled in once, in this browser -- see the
     * Company page. Only the series is set, so the next PO carries on from RIDHI/PO/GREIG/003. */
    co: { name: 'RIDHI', addr: '', email: '', gstin: '', iec: '', pan: '', jurisdiction: 'Jaipur',
      poPrefix: 'RIDHI/PO/GREIG/', poNext: 1, rfdPrefix: 'RIDHI/RFD/' },
    /* Who works on this page, and what each may do (Users & access). */
    users: [
      { id: 'u1', name: 'Ravi', role: 'Admin', ledger: 'edit', approve: true, active: true },
      { id: 'u2', name: 'Store team', role: 'Store', ledger: 'view', approve: false, active: true },
      { id: 'u3', name: 'Accounts', role: 'Accounts', ledger: 'none', approve: false, active: true },
    ],
    me: 'u1',
    ven: [
      { name: 'Shri Balaji Mills', kind: 'Supplier', phone: '98290 11223', email: 'sales@balajimills.example', city: 'Bhilwara', active: true },
      { name: 'Maa Textiles', kind: 'Supplier', phone: '98250 44556', email: 'orders@maatextiles.example', city: 'Surat', active: true },
      { name: 'Gayatri Processors', kind: 'RFD Processor', phone: '94140 77889', email: '', city: 'Jaipur', active: true },
      { name: 'Maa Tara Processors', kind: 'RFD Processor', phone: '94140 99001', email: '', city: 'Jaipur', active: true },
    ],
    gpo: [
      { id: 'g1', poNo: 'RIDHI/PO/GREIG/001', date: '2026-09-21', mill: 'Shri Balaji Mills', sent: { at: '2026-09-21' },
        lines: [{ rfd: 'Sheeting 62', greige: 'Greige Sheeting 67', metres: 1200, rate: 58 },
          { rfd: 'Cambric 44', greige: 'Greige Cambric 48', metres: 1000, rate: 44 }] },
      { id: 'g2', poNo: 'RIDHI/PO/GREIG/002', date: '2026-09-28', mill: 'Maa Textiles', sent: { at: '2026-09-28' },
        lines: [{ rfd: 'Poplin 58', greige: 'Greige Poplin 63', metres: 1500, rate: 52 }] },
      { id: 'g3', poNo: 'RIDHI/PO/GREIG/003', date: '2026-10-01', mill: 'Shri Balaji Mills', sent: { at: '2026-10-01' },
        lines: [{ rfd: 'Rayon 44', greige: 'Greige Rayon 46', metres: 900, rate: 71 }] },
    ],
    fab: [
      /* a lot that went the whole way: 1,200 out, 1,118 back -- 6.8% left in the bleach */
      { id: 'f1', chId: 'ch1', date: '2026-09-23', lot: 'LOT-001', fabricType: 'Greige Sheeting 67', txnType: 'RECEIVE_GREIGE', qty: 1200, party: 'Shri Balaji Mills', bill: 'SBM/1187', orderNo: 'RIDHI/PO/GREIG/001',
        lr: '', pieces: lmPieces(2301, 28, 1200, 37, 'all') },
      { id: 'f2', date: '2026-09-24', lot: 'LOT-001', fabricType: 'Greige Sheeting 67', txnType: 'ISSUE_TO_RFD', qty: 1200, party: 'Gayatri Processors', bill: 'RIDHI/RFD/001', orderNo: '' },
      { id: 'f3', date: '2026-09-30', lot: 'LOT-001', fabricType: 'Sheeting 62', txnType: 'RECEIVE_RFD', qty: 1118, party: 'Gayatri Processors', bill: 'GP/R/1187', orderNo: '', final: true, pieces: lmPieces(9101, 26, 1118, 71, 0) },
      { id: 'f4', date: '2026-10-01', lot: 'LOT-001', fabricType: 'Sheeting 62', txnType: 'ISSUE_TO_CUTTING', qty: 620, party: 'Cutting', bill: '', orderNo: '' },
      /* part on the shelf, part at the processor -- the lot nobody could see before */
      { id: 'f5', chId: 'ch2', date: '2026-09-25', lot: 'LOT-002', fabricType: 'Greige Cambric 48', txnType: 'RECEIVE_GREIGE', qty: 800, party: 'Shri Balaji Mills', bill: 'SBM/1203', orderNo: 'RIDHI/PO/GREIG/001',
        lr: '', pieces: lmPieces(2340, 20, 800, 41, 9) },
      { id: 'f6', date: '2026-09-27', lot: 'LOT-002', fabricType: 'Greige Cambric 48', txnType: 'ISSUE_TO_RFD', qty: 500, party: 'Gayatri Processors', bill: 'RIDHI/RFD/002', orderNo: '' },
      /* and a lot that came back 14% lighter -- the same job, a different processor */
      { id: 'f7', chId: 'ch3', date: '2026-09-29', lot: 'LOT-003', fabricType: 'Greige Poplin 63', txnType: 'RECEIVE_GREIGE', qty: 1500, party: 'Maa Textiles', bill: 'MT/CH/412', orderNo: 'RIDHI/PO/GREIG/002',
        lr: 'VRL 558120', pieces: lmPieces(4501, 35, 1500, 11, 'all', [0, 0, 0, 0, 0, 0.1, -0.4, -0.8, -1.5, 0]) },
      { id: 'f8', date: '2026-09-30', lot: 'LOT-003', fabricType: 'Greige Poplin 63', txnType: 'ISSUE_TO_RFD', qty: 1500, party: 'Maa Tara Processors', bill: 'RIDHI/RFD/003', orderNo: '' },
      { id: 'f9', date: '2026-10-02', lot: 'LOT-003', fabricType: 'Poplin 58', txnType: 'RECEIVE_RFD', qty: 1290, party: 'Maa Tara Processors', bill: 'MTP/R/0412', orderNo: '', final: true, pieces: lmPieces(9201, 30, 1290, 83, 0) },
      /* A stain down one edge, found on the table. It is still in the building and it will never be
       * cut, so it comes off the lot. */
      { id: 'f11', date: '2026-10-02', lot: 'LOT-001', fabricType: 'Sheeting 62', txnType: 'DAMAGE', qty: 18, party: '', bill: '', orderNo: '', state: 'RFD', note: 'Oil stain down one selvedge' },
      /* RFD already on the floor the day this started -- its own lot, so it can be issued like any
       * other, and kept apart from "RFD back" so it never makes up a processing loss */
      /* The last of the Cambric on PO/68, in this week -- four thans nobody has measured yet. */
      { id: 'f12', chId: 'ch4', date: '2026-10-10', lot: 'LOT-004', fabricType: 'Greige Cambric 48', txnType: 'RECEIVE_GREIGE', qty: 150, party: 'Shri Balaji Mills', bill: 'SBM/1241', orderNo: 'RIDHI/PO/GREIG/001',
        lr: '', pieces: lmPieces(2360, 4, 150, 53, 0) },
      { id: 'f10', date: '2026-09-22', lot: 'LOT-OPEN-01', fabricType: 'Rayon 44', txnType: 'OPENING_RFD', qty: 400, party: '', bill: '', orderNo: '' },
    ],
  };
}

function lmLoad() {
  try {
    var raw = localStorage.getItem(LM_KEY);
    if (raw) { DB = JSON.parse(raw); if (DB && DB.fab && DB.gpo && DB.mst) { lmMigrate(); return; } }
  } catch (e) { /* a blocked or cleared store is not a reason to show nothing */ }
  DB = lmSample();
}
/* ANYTHING TYPED BEFORE THE COLUMNS WERE CUT STILL OPENS. The warp and weft used to be four boxes
 * (a count and a fold each); they are one box now, written the way a sales note writes it. */
function lmMigrate() {
  if (!DB.users || !DB.users.length) { DB.users = lmSample().users; DB.me = 'u1'; }
  if (DB.co && !DB.co.rfdPrefix) DB.co.rfdPrefix = 'RIDHI/RFD/';
  /* A PO line's description used to repeat the greige; it now says what the greige becomes. */
  (DB.gpo || []).forEach(function (po) { (po.lines || []).forEach(function (l) {
    if (l.desc && poDesc(l.rfd) === l.desc) l.desc = 'RFD ready: ' + l.rfd;
  }); });
  if (!DB.co) {
    DB.co = { name: 'RIDHI', addr: '', email: '', gstin: '', iec: '', pan: '', jurisdiction: 'Jaipur',
      poPrefix: 'RIDHI/PO/GREIG/', poNext: 1, rfdPrefix: 'RIDHI/RFD/' };
  }
  (DB.mst || []).forEach(function (m) {
    if (m.warp == null && (m.warpCount || m.warpFold)) {
      m.warp = ((parseInt(m.warpFold, 10) || 1) > 1 ? m.warpFold + '/' : '') + (m.warpCount || '') + 's';
    }
    if (m.weft == null && (m.weftCount || m.weftFold)) {
      m.weft = ((parseInt(m.weftFold, 10) || 1) > 1 ? m.weftFold + '/' : '') + (m.weftCount || '') + 's';
    }
    delete m.warpCount; delete m.warpFold; delete m.weftCount; delete m.weftFold;
    delete m.weave; delete m.composition; delete m.gsm; delete m.hsn;
  });
  /* THE NAMES WERE ALWAYS THERE, just never written down anywhere you could edit them. A register
   * saved before this screen existed gets one built from the mills and processors already used. */
  if (!DB.ven) {
    var seen = {};
    DB.ven = [];
    (DB.gpo || []).forEach(function (po) {
      var n = String(po.mill || '').trim();
      if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; DB.ven.push({ name: n, kind: 'Supplier', phone: '', email: '', city: '', active: true }); }
    });
    (DB.fab || []).forEach(function (r) {
      var n = String(r.party || '').trim();
      if (!n || n.toLowerCase() === 'cutting' || seen[n.toLowerCase()]) return;
      seen[n.toLowerCase()] = 1;
      DB.ven.push({ name: n, kind: r.txnType === 'RECEIVE_GREIGE' ? 'Supplier' : 'RFD Processor',
        phone: '', email: '', city: '', active: true });
    });
  }
}

function lmSaveDb() { try { localStorage.setItem(LM_KEY, JSON.stringify(DB)); } catch (e) { /* nothing to do */ } }

/** Put the sample registers back -- the Reset button. Done here because this file owns the register. */
function lmResetSample() { DB = lmSample(); lmSaveDb(); }

/* core/stock.js -- The stock rules: fabric names and specs, lot balances, the fabric roll-up, and what the ledger accepts.
 * An ES module. Its imports are worked out from the code by the split script. */
var FAB_SKIP = null;  /* the row every balance leaves out while that is going on */
/* A RECEIPT WAITING FOR APPROVAL (or turned down) is in the ledger but not in the stock. */
function fabCounts(r) { return !(r && r.approval && r.approval.status !== 'approved'); }
function fabQty(r) { return parseFloat(r && r.qty) || 0; }
function fabState(r) {
  return String((r && (FAB_TXN_STATE[r.txnType] || r.state)) || 'PRINTED').trim().toUpperCase();
}

/* ---- the greige / RFD name pair ------------------------------------------------------------- */

/* THE CLOTH IS ORDERED BY ITS GREIGE NAME. Greige comes wider than the RFD it becomes -- the
 * Sheeting 62 on the cutting table is bought as a wider greige -- so each RFD fabric carries the
 * name its greige is bought under. The PO is written in that name; the lot keeps it while it is
 * greige and with the processor; "RFD received" turns it back into the RFD fabric. */
function fabGreigeOf(rfdFabric) {
  var k = String(rfdFabric || '').trim().toLowerCase();
  var r = (DB.mst || []).filter(function (x) { return String(x.rfd || '').trim().toLowerCase() === k; })[0];
  return r && r.greige ? String(r.greige).trim() : '';
}
/** And back: which RFD fabric a greige name becomes once it is processed. '' when nobody has said. */
function fabRfdOfGreige(greige) {
  var k = String(greige || '').trim().toLowerCase();
  var r = (DB.mst || []).filter(function (x) {
    return x.active !== false && String(x.greige || '').trim().toLowerCase() === k;
  })[0];
  return r ? String(r.rfd || '').trim() : '';
}
/* ---- THE SPEC A MILL IS ACTUALLY GIVEN ------------------------------------------------------ *
 *
 * A greige PO that says only "Sheeting" tells a weaver nothing. A loom is set by the yarn count, the
 * reed and the pick, and the cloth is bought by width, so the fabric type is where all of that
 * belongs -- typed once, carried on to every PO, every lot and every challan.
 *
 * HOW A CLOTH IS WRITTEN DOWN, in the order the trade says it:
 *   warp count x weft count / ends per inch x picks per inch   e.g.  2/40s x 40s / 110 x 76
 * A folded (plied) yarn is written fold-first -- 2/40s is two 40s singles twisted together, which is
 * stronger and smoother than a single 40s and costs more. Ends and picks added together are the
 * thread count bed linen is sold by: 110 + 76 = 186 TC.
 */

/** The fabric type a name belongs to, whether the name given is the RFD one or the greige one. */
function mstOf(name) {
  var k = String(name || '').trim().toLowerCase();
  if (!k) return null;
  return (DB.mst || []).filter(function (m) {
    return String(m.rfd || '').trim().toLowerCase() === k || String(m.greige || '').trim().toLowerCase() === k;
  })[0] || null;
}
/** The yarn as the trade writes it: 40s single, 2/40s two-fold. A bare number gets its s. */
function mstYarn(v) {
  var t = String(v == null ? '' : v).trim();
  if (!t) return '';
  return /^[0-9/.]+$/.test(t) ? t + 's' : t;
}
/** Warp x weft / EPI x PPI -- how every mill in the country writes a cloth down. */
function mstConstruction(m) {
  if (!m) return '';
  var w = mstYarn(m.warp), f = mstYarn(m.weft);
  var e = parseFloat(m.epi) || 0, p = parseFloat(m.ppi) || 0;
  if (!w && !f && !e && !p) return '';
  return (w || '?') + ' × ' + (f || '?') + ' / ' + (e || '?') + ' × ' + (p || '?');
}
/** Thread count, as bed linen is sold: the ends and the picks in one square inch, added up. */
function mstTC(m) {
  var e = parseFloat(m && m.epi) || 0, p = parseFloat(m && m.ppi) || 0;
  return (e + p) ? (e + p) : null;
}
/* WHY THE GREIGE IS WIDER. Scouring and bleaching pull a cloth in across its width -- commonly 5 to
 * 8 per cent -- so a 62" sheeting has to be woven at 67" to come back usable. This is the figure
 * that decides what width to order, and it is worth watching per processor. */
function mstWidthLoss(m) {
  var g = parseFloat(m && m.greigeWidth) || 0, r = parseFloat(m && m.rfdWidth) || 0;
  if (!g || !r) return null;
  return Math.round(((g - r) / g) * 1000) / 10;
}
/** The one-line spec, for under a fabric's name wherever it is shown. */
function mstSpecLine(m) {
  if (!m) return '';
  var bits = [];
  if (m.greigeWidth) bits.push(m.greigeWidth + '" greige');
  var c = mstConstruction(m); if (c) bits.push(c);
  var tc = mstTC(m); if (tc) bits.push(tc + ' TC');
  return bits.join(' · ');
}

/** The fabrics a PO can be raised for: every active fabric type with a greige name on it. */
function gpoFabrics() {
  return (DB.mst || []).filter(function (r) { return r.active !== false && String(r.greige || '').trim(); });
}

/* ---- where the cloth is, fabric by fabric --------------------------------------------------- *
 *
 * Greige comes in, goes to the processing house, comes back as RFD, and leaves for cutting. Four
 * numbers, and the one that never had a home before is the middle one: cloth WITH the processor is
 * neither greige stock nor RFD stock.
 *
 * PROCESS LOSS IS SHOWN, NOT HIDDEN -- but only once the cloth is back. A lot still out has not
 * lost anything yet, so it counts as "at processor" and nowhere else; the percentage is struck off
 * settled lots alone, which is what makes one processor at 6% and another at 14% a figure worth
 * arguing with instead of an artefact of what happens to be out today. */
function fabFlowRows(rows) {
  var by = {}, order = [];
  /* A lot answers to two names -- its greige one and the RFD name it comes back as -- and the
   * figures belong on one line, under the RFD name, because that is what the cutting table asks
   * for. */
  function line(r) {
    var f = String(r.fabricType || '').trim();
    return fabRfdOfGreige(f) || f;
  }
  function bump(name) {
    var k = name.toUpperCase();
    if (!by[k]) {
      by[k] = { fabricType: name, greigeIn: 0, toRfd: 0, rfdIn: 0, rfdOpen: 0, rfdBuy: 0, rfdOut: 0,
        withProcessor: 0, lossSent: 0, lossBack: 0, dmgGreige: 0, dmgRfd: 0 };
      order.push(k);
    }
    return by[k];
  }
  (rows || []).forEach(function (r) {
    if (!fabCounts(r)) return;
    var n = line(r); if (!n) return;
    var g = bump(n), q = fabQty(r);
    if (r.txnType === 'RECEIVE_GREIGE') g.greigeIn += q;
    else if (r.txnType === 'ISSUE_TO_RFD') g.toRfd += q;
    else if (r.txnType === 'RECEIVE_RFD') g.rfdIn += q;
    else if (r.txnType === 'OPENING_RFD') g.rfdOpen += q;
    else if (r.txnType === 'PURCHASE_RFD') g.rfdBuy += q;
    else if (r.txnType === 'ISSUE_TO_CUTTING') g.rfdOut += q;
    else if (r.txnType === 'DAMAGE') {
      if (fabState(r) === 'GREIGE') g.dmgGreige += q; else g.dmgRfd += q;
    }
  });
  /* WHAT IS STILL OUT AND WHAT WAS LOST ARE BOTH "sent minus back", and only the lot knows which
   * one it is. So both are added up off the lots, never off the fabric totals. */
  fabLots(rows).forEach(function (L) {
    var n = (fabRfdOfGreige(L.fabricType) || L.rfdFabric || L.fabricType || '').toUpperCase();
    if (!by[n]) return;
    by[n].withProcessor += L.withProcessor;
    if (!L.closed) return;
    by[n].lossSent += L.toRfd; by[n].lossBack += L.rfdIn;
  });
  return order.map(function (k) {
    var g = by[k];
    g.greigeLeft = g.greigeIn - g.toRfd - g.dmgGreige;
    g.damaged = g.dmgGreige + g.dmgRfd;
    g.loss = Math.max(0, g.lossSent - g.lossBack);
    g.lossPct = g.lossSent > 0 ? Math.round(((g.lossSent - g.lossBack) / g.lossSent) * 1000) / 10 : null;
    g.rfdLeft = g.rfdOpen + g.rfdBuy + g.rfdIn - g.rfdOut - g.dmgRfd;
    return g;
  }).sort(function (a, b) {
    return (b.greigeIn + b.rfdIn + b.rfdOpen + b.rfdBuy) - (a.greigeIn + a.rfdIn + a.rfdOpen + a.rfdBuy);
  });
}

/* ---- and lot by lot, which is how the floor actually talks about it ------------------------- */
/** The register as the balances should see it -- without the row currently being corrected. */
function fabRows() {
  return (DB.fab || []).filter(function (r) { return !FAB_SKIP || r.id !== FAB_SKIP; });
}
function fabLots(rows) {
  var by = {}, order = [];
  (rows || fabRows()).forEach(function (r) {
    if (!fabCounts(r)) return;
    var lot = String(r.lot || '').trim(); if (!lot) return;
    if (!by[lot]) {
      by[lot] = { lot: lot, fabricType: '', rfdFabric: '', mill: '', processor: '', bill: '', date: '',
        poNo: '', greigeIn: 0, toRfd: 0, rfdIn: 0, rfdOpen: 0, rfdBuy: 0, rfdOut: 0,
        dmgGreige: 0, dmgRfd: 0, dmgNotes: [], closed: false, n: 0 };
      order.push(lot);
    }
    var g = by[lot], q = fabQty(r); g.n++;
    if (r.txnType === 'RECEIVE_GREIGE') {
      g.greigeIn += q; g.fabricType = g.fabricType || r.fabricType; g.mill = g.mill || r.party;
      g.bill = g.bill || r.bill; g.date = g.date || r.date; g.poNo = g.poNo || r.orderNo;
    } else if (r.txnType === 'ISSUE_TO_RFD') { g.toRfd += q; g.processor = r.party || g.processor; }
    else if (r.txnType === 'RECEIVE_RFD') {
      g.rfdIn += q; g.rfdFabric = r.fabricType || g.rfdFabric;
      /* THE CHALLAN THAT CLOSES THE LOT. Until one says "that is the lot", sent-minus-back is cloth
       * still sitting at the processor; once one does, the very same figure is the process loss.
       * No register can tell the two apart on its own, so the person receiving it says which. */
      if (r.final !== false) g.closed = true;
    }
    else if (r.txnType === 'OPENING_RFD' || r.txnType === 'PURCHASE_RFD') {
      if (r.txnType === 'OPENING_RFD') g.rfdOpen += q; else g.rfdBuy += q;
      g.fabricType = g.fabricType || r.fabricType; g.rfdFabric = g.rfdFabric || r.fabricType;
      g.date = g.date || r.date; g.mill = g.mill || r.party;
    } else if (r.txnType === 'ISSUE_TO_CUTTING') g.rfdOut += q;
    else if (r.txnType === 'DAMAGE') {
      /* Spoilt greige never becomes RFD; spoilt RFD never reaches the table. Each comes off its
       * own shelf. */
      if (fabState(r) === 'GREIGE') g.dmgGreige += q; else g.dmgRfd += q;
      g.dmgNotes.push(r.note || '');
    }
  });
  return order.map(function (k) {
    var g = by[k];
    g.greigeLeft = g.greigeIn - g.toRfd - g.dmgGreige;
    g.rfdLeft = g.rfdOpen + g.rfdBuy + g.rfdIn - g.rfdOut - g.dmgRfd;
    g.damaged = g.dmgGreige + g.dmgRfd;
    g.dmgWhy = lmList(g.dmgNotes.filter(Boolean));
    /* ONE SUBTRACTION, TWO MEANINGS. Sent minus back is cloth still at the processor while the lot
     * is open, and the process loss the moment it is closed. It is never both, and showing it as
     * both -- which is what happens when the figure is read off the fabric totals -- is how a
     * factory ends up chasing 82 m that were never there. */
    var gap = Math.max(0, g.toRfd - g.rfdIn);
    g.withProcessor = g.closed ? 0 : gap;
    g.loss = g.closed ? gap : 0;
    g.lossPct = g.closed && g.toRfd > 0 ? Math.round((gap / g.toRfd) * 1000) / 10 : null;
    return g;
  }).sort(function (a, b) {
    return String(b.date).localeCompare(String(a.date)) || a.lot.localeCompare(b.lot);
  });
}
function fabLot(lot) {
  var want = String(lot || '').trim();
  return fabLots().filter(function (g) { return g.lot === want; })[0];
}
/** Lots with greige still to send, and lots still out at a processor -- the two pickers. */
function fabLotsFor(kind) {
  var want = FAB_KIND_WANT[kind];
  return fabLots().filter(function (g) {
    if (want === 'greige') return g.greigeLeft > 1e-9;
    if (want === 'out') return g.withProcessor > 1e-9;
    if (want === 'rfd') return g.rfdLeft > 1e-9;
    if (want === 'any') return g.greigeLeft > 1e-9 || g.rfdLeft > 1e-9;
    return true;
  });
}

/* ---- what the ledger will and will not accept ----------------------------------------------- *
 *
 * The same refusals as the live screen, in the same words. Every one of them is a mistake that was
 * made on paper first: one bale received twice against a single lot, more sent for processing than
 * the lot held, cloth issued to cutting that never came back from the processor. */
function fabEntryCheck(e) {
  var kind = e.txnType, lot = String(e.lot || '').trim(), fabric = String(e.fabric || '').trim();
  var qty = parseFloat(e.qty) || 0;
  var kept = qty - (parseFloat(e.returned) || 0);
  if (!FAB_SIGN[kind]) return 'Pick what kind of movement this is.';
  if (!e.date) return 'Put a date on it.';
  if (!lot) return 'Every movement belongs to a lot. Give it one.';
  if (!fabric) return 'Which cloth?';
  if (qty <= 0) return 'Metres have to be more than nothing.';

  var back = parseFloat(e.returned) || 0;
  if (back) {
    if (!FAB_CAN_RETURN[kind]) return 'Cloth can only be sent back on a receipt.';
    if (back < 0) return 'Returned metres cannot be less than nothing.';
    if (back >= qty) {
      return 'If all ' + nf(qty) + ' m went back, nothing was received \u2014 do not write the entry at all.';
    }
  }

  /* AGAINST A GREIGE PO: it has to be one, still open, and for this cloth. */
  var poNo = String(e.poNo || '').trim().toUpperCase();
  if (kind === 'RECEIVE_GREIGE' && poNo) {
    var po = (DB.gpo || []).filter(function (p) { return String(p.poNo || '').toUpperCase() === poNo; })[0];
    if (!po) return 'There is no greige PO ' + poNo + '.';
    if (gpoStatus(po) === 'cancelled') return 'PO ' + poNo + ' was cancelled.';
    var names = (po.lines || []).map(function (l) { return String(l.greige || '').trim(); });
    var ok = names.filter(function (n) { return n.toLowerCase() === fabric.toLowerCase(); }).length;
    if (!ok) return 'PO ' + poNo + ' is not for ' + fabric + ' — it is for ' + names.join(', ') + '.';
  }

  var g = fabLot(lot);

  if (kind === 'RECEIVE_GREIGE') {
    if (g && g.greigeIn > 0) {
      /* kept, not qty: a part-returned delivery still opens the lot with what stayed. */
      /* g comes from fabRows(), which already leaves out the row being corrected -- so this only
       * ever fires on a genuinely different receipt. */
      return 'Lot ' + lot + ' already has ' + nf(g.greigeIn) + ' m against it. A second receipt into '
        + 'the same lot is how one bale ends up counted twice — open a new lot.';
    }
    if (!fabRfdOfGreige(fabric)) {
      return 'Nobody has said what ' + fabric + ' becomes once it is processed. Masters → fabric '
        + 'type holds the pair; without it, "RFD received" cannot rename the lot.';
    }
  }

  if (kind === 'ISSUE_TO_RFD') {
    if (!g || g.greigeIn <= 0) return 'Lot ' + lot + ' has no greige against it.';
    /* The lot is still greige, so it goes out under its greige name -- typing the RFD name it will
     * come back as is the commonest slip there is. */
    if (fabric.toLowerCase() !== String(g.fabricType).toLowerCase()
      && fabRfdOfGreige(g.fabricType).toLowerCase() === fabric.toLowerCase()) {
      return 'Lot ' + lot + ' is still greige. It goes out as ' + g.fabricType + '; it comes back as ' + fabric + '.';
    }
    if (qty > g.greigeLeft + 1e-9) {
      return 'Only ' + nf(g.greigeLeft) + ' m is left in lot ' + lot + ' (' + nf(g.greigeIn)
        + ' received, ' + nf(g.toRfd) + ' already sent).';
    }
    if (!String(e.party || '').trim()) return 'Which processing house is it going to?';
  }

  if (kind === 'RECEIVE_RFD') {
    if (g && g.closed) {
      return 'Lot ' + lot + ' was closed when the last challan came in. Nothing more is expected '
        + 'back from the processor on it.';
    }
    if (!g || g.withProcessor <= 1e-9) return 'Lot ' + lot + ' has nothing out at a processor.';
    if (qty > g.withProcessor + 1e-9) {
      return 'Only ' + nf(g.withProcessor) + ' m of lot ' + lot + ' is out there. More has come back '
        + 'than went — check the challan.';
    }
    /* GREIGE COMES BACK AS THE RFD FABRIC IT WAS BOUGHT FOR -- Greige Sheeting 67 back as
     * Sheeting 62. Only when Masters says so; a greige with no RFD fabric named keeps what was typed. */
    var becomes = fabRfdOfGreige(g.fabricType);
    if (becomes && becomes.toLowerCase() !== fabric.toLowerCase()) {
      return 'Lot ' + lot + ' was ' + g.fabricType + ', which comes back as ' + becomes + ', not ' + fabric + '.';
    }
  }

  if (kind === 'DAMAGE') {
    if (!g) return 'Lot ' + lot + ' is not in the register.';
    var isGreige = !!fabRfdOfGreige(fabric);
    var have = isGreige ? g.greigeLeft : g.rfdLeft;
    if (have <= 1e-9) {
      return 'Lot ' + lot + ' has no ' + (isGreige ? 'greige' : 'RFD') + ' left to write off.';
    }
    if (qty > have + 1e-9) {
      return 'Lot ' + lot + ' holds ' + nf(have) + ' m of ' + (isGreige ? 'greige' : 'RFD') + '.';
    }
    /* A write-off with no reason on it is a hole in the stock that nobody can answer for later. */
    if (!String(e.remark || '').trim()) return 'Say what is wrong with it \u2014 a write-off needs a reason.';
  }

  if (kind === 'ISSUE_TO_CUTTING') {
    if (!g || g.rfdLeft <= 1e-9) return 'Lot ' + lot + ' has no RFD on the shelf.';
    if (qty > g.rfdLeft + 1e-9) return 'Lot ' + lot + ' holds ' + nf(g.rfdLeft) + ' m of RFD.';
  }
  return '';
}
function fabNextLot() {
  var max = 0;
  (DB.fab || []).forEach(function (r) {
    var m = /^LOT-(\d+)$/i.exec(String(r.lot || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  var n = String(max + 1); while (n.length < 3) n = '0' + n;
  return 'LOT-' + n;
}

/** Leave one row out of every balance while it is being corrected; null puts it back. */
function setFabSkip(id) { FAB_SKIP = id; }

/* core/orders.js -- The purchase-order rules: money, progress, status, numbering, mills and processors, valuation rates.
 * An ES module. Its imports are worked out from the code by the split script. */

/* ---- the purchase orders -------------------------------------------------------------------- *
 *
 * Ravi, 2026-09-21: "greige fabric po generation meaning uska challan bane and m mail kar saku
 * yahi se".
 *
 * Ordered, received and still to come are worked out from the ledger, never typed twice: a
 * "Greige received" entry naming the PO number is what counts as delivered. */
function gpoReceived(po) {
  var no = String((po && po.poNo) || '').trim().toUpperCase(), by = {};
  if (!no) return by;
  (DB.fab || []).forEach(function (r) {
    if (r.txnType !== 'RECEIVE_GREIGE') return;
    if (String(r.orderNo || '').trim().toUpperCase() !== no) return;
    var k = String(r.fabricType || '').trim().toLowerCase();
    by[k] = (by[k] || 0) + fabQty(r);
  });
  return by;
}
/* MONEY ON A PO LINE, THE WAY THE PO ITSELF IS WRITTEN.
 *
 * The purchase order states goods value only -- metres at a rate, less any discount the mill has
 * agreed. Tax is the mill's to charge on its own invoice; putting it on the order as well is how
 * the two documents end up disagreeing. */
function gpoLineMoney(l) {
  var gross = Math.round(((parseFloat(l.metres) || 0) * (parseFloat(l.rate) || 0)) * 100) / 100;
  /* NO DISCOUNT ON A GREIGE PO (Ravi, 13 Oct): metres at the rate, nothing taken off. */
  return { gross: gross, disc: 0, amount: gross, total: gross };
}
function gpoTotals(po) {
  return ((po && po.lines) || []).reduce(function (t, l) {
    var m = gpoLineMoney(l);
    t.metres += parseFloat(l.metres) || 0; t.gross += m.gross; t.disc += m.disc;
    t.amount += m.amount; t.total += m.total;
    return t;
  }, { metres: 0, gross: 0, disc: 0, amount: 0, total: 0 });
}
function gpoProgress(po) {
  var got = gpoReceived(po);
  var lines = ((po && po.lines) || []).map(function (l) {
    var rec = got[String(l.greige || '').trim().toLowerCase()] || 0;
    var ordered = parseFloat(l.metres) || 0;
    return { rfd: l.rfd, greige: l.greige, rate: l.rate, disc: l.disc, desc: l.desc, due: l.due, metres: l.metres,
      ordered: ordered, received: rec, pending: Math.max(0, ordered - rec) };
  });
  var ordered = lines.reduce(function (a, l) { return a + l.ordered; }, 0);
  var received = lines.reduce(function (a, l) { return a + l.received; }, 0);
  return { lines: lines, ordered: ordered, received: received, pending: Math.max(0, ordered - received) };
}
function gpoStatus(po) {
  if (!po) return '';
  if (po.status === 'cancelled') return 'cancelled';
  var p = gpoProgress(po);
  /* THREE STATUSES (Ravi, 13 Oct): Sent, Part received, Received. A PO is sent the day it is raised; one closed
   * by its last challan (or by hand) has received all it ever will. */
  if ((p.ordered > 0 && p.received >= p.ordered - 1e-9) || po.closed) return 'received';
  if (p.received > 0) return 'part';
  return 'sent';
}
/* THE PO NUMBER CARRIES ON ITS OWN SERIES -- RIDHI/PO/GREIG/001, /002, /003 (Ravi, 13 Oct) -- so a PO raised here
 * and one raised in the accounts never share a number. The next is one more than the highest the
 * series has reached, and never lower than the starting point set on the Company page. */
function gpoNewNo() {
  var co = DB.co || {}, pre = co.poPrefix || 'RIDHI/PO/GREIG/', max = 0;
  (DB.gpo || []).forEach(function (p) {
    var no = String(p.poNo || '');
    if (no.toUpperCase().indexOf(pre.toUpperCase()) !== 0) return;
    var n = parseInt(no.slice(pre.length), 10);
    if (!isNaN(n)) max = Math.max(max, n);
  });
  var n = String(Math.max(max + 1, parseInt(co.poNext, 10) || 1));
  while (n.length < 3) n = '0' + n;
  return pre + n;
}
/* OUR RFD CHALLAN NUMBER, IN ITS OWN SERIES LIKE THE PO (Ravi, 13 Oct): RIDHI/RFD/001, /002 ... -- one more than the
 * highest the series has reached. Given by the page, never typed. */
function rfdChNewNo() {
  var pre = (DB.co && DB.co.rfdPrefix) || 'RIDHI/RFD/', max = 0;
  (DB.fab || []).forEach(function (r) {
    if (r.txnType !== 'ISSUE_TO_RFD') return;
    var no = String(r.bill || '');
    if (no.toUpperCase().indexOf(pre.toUpperCase()) !== 0) return;
    var n = parseInt(no.slice(pre.length), 10); if (!isNaN(n)) max = Math.max(max, n);
  });
  var s = String(max + 1); while (s.length < 3) s = '0' + s;
  return pre + s;
}
/* THE NAMES COME OFF THE MASTER FIRST, then off the register.
 *
 * Master data is where a mill is written down; but a name that is already on a PO or a challan has
 * to stay pickable even if nobody has got round to adding it, or switched it off since. Anything
 * else and a correction to an old row becomes impossible. */
function venOfKind(kind) {
  var named = (DB.ven || []).filter(function (v) {
    return v.active !== false && (venKind(v) === kind || v.kind === 'Both');
  }).map(function (v) { return v.name; });
  var used = kind === 'Supplier'
    ? (DB.gpo || []).map(function (p) { return p.mill; })
      .concat((DB.fab || []).filter(function (r) { return r.txnType === 'RECEIVE_GREIGE'; }).map(function (r) { return r.party; }))
    : (DB.fab || []).filter(function (r) {
        return r.txnType === 'ISSUE_TO_RFD' || r.txnType === 'RECEIVE_RFD';
      }).map(function (r) { return r.party; });
  /* A name switched off in the master stays out of the suggestions even if it is on old rows.
   * The rows themselves keep the name they were written with -- it is stored on the row, not looked
   * up -- and the box is free text, so an old row can still be corrected by typing it. */
  var off = {};
  (DB.ven || []).forEach(function (v) {
    if (v.active === false) off[String(v.name || '').trim().toLowerCase()] = 1;
  });
  return uniq(named.concat(used)).filter(function (n) { return !off[n.toLowerCase()]; });
}
/* A SUPPLIER WEAVES OR SELLS THE GREIGE; AN RFD PROCESSOR BLEACHES IT (Ravi, 13 Oct: "mill change to supplier, processor
 * should be just RFD processor"). Names saved before keep working: Mill reads as Supplier, Processor as RFD Processor. */
function venKind(v) { var k = String((v && v.kind) || ''); return k === 'Mill' ? 'Supplier' : k === 'Processor' ? 'RFD Processor' : k; }
function gpoMills() { return venOfKind('Supplier'); }
function lmProcessors() { return venOfKind('RFD Processor'); }
/** How many rows of the register answer to this name -- a vendor on one is not deleted. */
function venUsed(name) {
  var k = String(name || '').trim().toLowerCase();
  if (!k) return 0;
  var n = (DB.fab || []).filter(function (r) { return String(r.party || '').trim().toLowerCase() === k; }).length;
  return n + (DB.gpo || []).filter(function (p) { return String(p.mill || '').trim().toLowerCase() === k; }).length;
}

/* ---- INVENTORY: what is owned, right now ----------------------------------------------------- *
 *
 * The flow screen answers "what happened to this cloth". This one answers the question a stock
 * sheet asks: how much is there, where is it standing, and what did it cost.
 *
 * THREE PLACES, NOT TWO. Cloth in the store is the obvious one. Cloth at the processor is the one
 * that gets forgotten -- it is off the shelf but it is still yours, it is still money, and at any
 * time there is a good deal of it. Both are counted here; only cloth issued to cutting has left.
 */

/** The rate a greige was last bought at, off the POs. null when it has never been ordered here. */
function invRate(greigeName) {
  var k = String(greigeName || '').trim().toLowerCase();
  if (!k) return null;
  var best = null;
  (DB.gpo || []).forEach(function (po) {
    (po.lines || []).forEach(function (l) {
      if (String(l.greige || '').trim().toLowerCase() !== k) return;
      var r = parseFloat(l.rate) || 0; if (!r) return;
      if (!best || String(po.date) >= String(best.date)) best = { date: po.date, rate: r, poNo: po.poNo };
    });
  });
  return best;
}
function venByName(n) {
  var k = String(n || '').trim().toLowerCase();
  return (DB.ven || []).filter(function (v) { return String(v.name || '').trim().toLowerCase() === k; })[0] || null;
}
function poFind(no) { return (DB.gpo || []).filter(function (p) { return p.poNo === no; })[0] || null; }
function poFileName(po) { return String(po.poNo || 'PO').replace(/[\/\\:*?"<>|]+/g, '-') + '.pdf'; }

/* THE DESCRIPTION OF GOODS, as RIDHI writes it on a PO: the quality, the count, the loom width,
 * and "Gray Fabric" -- "Sheeting 30S 67" Gray Fabric". All of it is already in Master data; the
 * line can still be written over by hand for anything unusual (a Voil 120"(Mullmull)). */
function poDesc(rfd) {
  var m = mstOf(rfd); if (!m) return '';
  var base = String(m.rfd || '').replace(/\s*\d+(\.\d+)?\s*$/, '').trim()
    || String(m.greige || '').replace(/^greige\s+/i, '').trim();
  var count = m.warp ? String(mstYarn(m.warp)).toUpperCase() : '';
  var width = m.greigeWidth ? m.greigeWidth + '"' : '';
  return [base, count, width].filter(Boolean).join(' ') + ' Gray Fabric';
}
/* Every line must be for a fabric that has a greige name -- a PO written in the RFD name would send
 * the mill a width it does not weave. */
function gpoCheck(po) {
  if (!po.date) return 'Put a date on the PO.';
  if (!String(po.mill || '').trim()) return 'Which supplier is it on?';
  if (!po.lines.length) return 'A PO with no line is not a PO.';
  for (var i = 0; i < po.lines.length; i++) {
    var l = po.lines[i];
    if (!String(l.greige || '').trim()) {
      return l.rfd + ' has no greige name in Master data, so there is nothing to order it by.';
    }
    if (!(parseFloat(l.metres) > 0)) return 'How many metres of ' + l.greige + '?';
    if (!(parseFloat(l.rate) > 0)) return 'What rate for ' + l.greige + '?';
  }
  return '';
}

/* core/analytics.js -- The figures the dashboard and the stock sheet are drawn from.
 * An ES module. Its imports are worked out from the code by the split script. */

/** The five figures the stage bar carries. */
function ffFacts() {
  var flow = fabFlowRows(DB.fab || []);
  var pend = (DB.gpo || []).filter(function (po) {
    return ['open', 'sent', 'part'].indexOf(gpoStatus(po)) >= 0;
  }).reduce(function (a, po) { return a + gpoProgress(po).pending; }, 0);
  var sum = function (k) { return flow.reduce(function (a, x) { return a + (x[k] || 0); }, 0); };
  return {
    poPending: pend, greige: sum('greigeLeft'), proc: sum('withProcessor'), rfd: sum('rfdLeft'),
    cut: sum('rfdOut'), loss: sum('loss'), lossSent: sum('lossSent'),
    flow: flow, lots: fabLots(DB.fab || []),
  };
}

/* WHAT A DASHBOARD IS FOR.
 *
 * Not the totals -- those are on every other screen. What this answers is: of everything standing
 * still right now, which bit is costing money, and who do I ring about it. Each line is a fact the
 * register already knew and nobody was being shown. */
function dashAlerts() {
  var out = [];

  /* Cloth sitting at a processor is money off the shelf and not yet usable. */
  fabLots(DB.fab || []).forEach(function (g) {
    if (g.withProcessor <= 0.05) return;
    var sent = (DB.fab || []).filter(function (r) {
      return r.lot === g.lot && r.txnType === 'ISSUE_TO_RFD';
    }).map(function (r) { return r.date; }).sort().pop();
    var d = lmDays(sent);
    out.push({
      bad: d !== null && d > CHASE_PROCESSOR_DAYS,
      what: nf(g.withProcessor) + ' m of ' + g.fabricType + ' at ' + (g.processor || 'a processor'),
      who: 'lot ' + g.lot + (d === null ? '' : ', sent ' + daysWord(d) + ' ago'),
      go: 'lots'
    });
  });

  /* A PO the mill has not finished, and a PO nobody has sent. */
  (DB.gpo || []).forEach(function (po) {
    var st = gpoStatus(po); if (st === 'received' || st === 'cancelled' || st === 'closed') return;
    var p = gpoProgress(po), d = lmDays(po.date);
    out.push({ bad: d !== null && d > CHASE_PO_DAYS,
      what: nf(p.pending) + ' m still due on ' + po.poNo,
      who: po.mill + (d === null ? '' : ', ordered ' + daysWord(d) + ' ago'), go: 'po' });
  });

  /* A CHALLAN NOBODY HAS MEASURED, AND THANS THAT CAME IN SHORT. The mill bills what it wrote; the
   * store has what it measured. Both are worth a word before the cloth goes on to be bleached. */
  var byCh = {};
  (DB.fab || []).forEach(function (r) {
    if (r.txnType !== 'RECEIVE_GREIGE' || !r.pieces || !r.pieces.length) return;
    var k = r.chId || r.id, e = byCh[k] || (byCh[k] = { no: r.bill, mill: r.party, n: 0, done: 0, short: 0, m: 0 });
    e.m += fabQty(r);
    r.pieces.forEach(function (p) { e.n++; if (p.chk != null) { e.done++; if (p.chk < p.m - 0.05) e.short += p.m - p.chk; } });
  });
  Object.keys(byCh).forEach(function (k) {
    var e = byCh[k];
    if (e.done < e.n) out.push({ bad: false, tag: 'To check', what: (e.n - e.done) + ' of ' + e.n + ' bales on challan ' + e.no + ' not measured', who: e.mill, go: 'check' });
    /* Short enough to raise with the mill: more than 1 m, and more than 0.3% of what the challan says. */
    if (e.short > Math.max(1, e.m * 0.003)) out.push({ bad: true, tag: 'Short', what: (Math.round(e.short * 10) / 10) + ' m short on challan ' + e.no, who: e.mill + ' billed the challan metres', go: 'check' });
  });

  /* AN RFD RECEIPT THAT SHRANK TOO MUCH waits for someone who may approve it. */
  (DB.fab || []).forEach(function (r) {
    if (r.approval && r.approval.status === 'pending') out.push({ bad: true, tag: 'Approve', what: nf(fabQty(r)) + ' m of RFD on ' + r.lot + ' shrank ' + r.approval.pct + '%', who: r.party + ', waiting for approval', go: 'po' });
  });

  /* A cloth the cutting table cannot be given at all. */
  fabFlowRows(DB.fab || []).forEach(function (e) {
    if (e.rfdLeft > 0.05) return;
    if (e.greigeLeft > 0.05) {
      out.push({ bad: true, what: 'No RFD ' + e.fabricType + ' on the shelf',
        who: nf(e.greigeLeft) + ' m of greige is in the store, ready to send', go: 'lots' });
    } else if (e.withProcessor > 0.05) {
      out.push({ bad: false, what: 'No RFD ' + e.fabricType + ' on the shelf',
        who: nf(e.withProcessor) + ' m is at the processor', go: 'lots' });
    }
  });

  return out.sort(function (a, b) { return (b.bad ? 1 : 0) - (a.bad ? 1 : 0); });
}

/* ONE PROCESSOR AT 7% AND ANOTHER AT 14% IS A CONVERSATION, and it can only be had if somebody puts
 * the two next to each other. The loss column on the fabric table never could: it adds up by cloth,
 * and a cloth goes to whoever has room that week. */
function dashProcessors() {
  var by = {}, order = [];
  fabLots(DB.fab || []).forEach(function (g) {
    var p = String(g.processor || '').trim(); if (!p) return;
    if (!by[p]) {
      by[p] = { name: p, sent: 0, back: 0, lots: 0, outM: 0, outLots: 0, cost: 0, days: 0, timed: 0 };
      order.push(p);
    }
    var e = by[p];
    if (g.withProcessor > 0.05) { e.outM += g.withProcessor; e.outLots++; }
    if (!g.closed) return;
    e.sent += g.toRfd; e.back += g.rfdIn; e.lots++;

    /* WHAT THE GREIGE IN THAT LOT COST. Carried through so the loss can be said in rupees as well
     * as in per cent -- which is the only form anybody acts on. */
    var r = invRate(g.fabricType);
    if (r) e.cost += g.toRfd * r.rate;

    /* HOW LONG THEY KEPT IT: the day the last of it went out to the day it came back. */
    var rows = (DB.fab || []).filter(function (x) { return x.lot === g.lot; });
    var out = rows.filter(function (x) { return x.txnType === 'ISSUE_TO_RFD'; })
      .map(function (x) { return x.date; }).sort().pop();
    var back = rows.filter(function (x) { return x.txnType === 'RECEIVE_RFD'; })
      .map(function (x) { return x.date; }).sort().pop();
    if (out && back) {
      var d = Math.round((Date.parse(back + 'T00:00:00') - Date.parse(out + 'T00:00:00')) / 86400000);
      if (!isNaN(d) && d >= 0) { e.days += d; e.timed++; }
    }
  });
  return order.map(function (k) {
    var e = by[k];
    e.loss = Math.max(0, e.sent - e.back);
    e.lossPct = e.sent > 0 ? Math.round((e.loss / e.sent) * 1000) / 10 : null;
    e.avgDays = e.timed ? Math.round((e.days / e.timed) * 10) / 10 : null;
    /* THE NUMBER THAT DECIDES WHO GETS THE NEXT LOT.
     * Not the loss per cent, and not the rate on the bill -- what one usable metre of RFD actually
     * cost you by the time it came back. Greige spent, divided by RFD received. A cheap house that
     * returns 86% of what it was given is not cheap. */
    e.perMetre = e.back > 0 && e.cost > 0 ? Math.round((e.cost / e.back) * 100) / 100 : null;
    e.baseRate = e.sent > 0 && e.cost > 0 ? Math.round((e.cost / e.sent) * 100) / 100 : null;
    e.lossCost = e.perMetre && e.baseRate ? Math.round((e.perMetre - e.baseRate) * 100) / 100 : null;
    return e;
  }).sort(function (a, b) { return (b.lossPct || 0) - (a.lossPct || 0); });
}

/** Metres and money at each stage of the pipe. */
function dashPipeline() {
  var t = { greige: 0, proc: 0, rfd: 0, greigeV: 0, procV: 0, rfdV: 0,
    /* A VALUE WITH A HOLE IN IT IS WORSE THAN NO VALUE, because it looks complete. Whatever could
     * not be costed is named, and its metres counted, so the figure underneath can be read for what
     * it is: the part of the stock somebody has a rate for. */
    unrated: [], unratedM: 0 };
  fabFlowRows(DB.fab || []).forEach(function (e) {
    var owned = e.greigeLeft + e.withProcessor + e.rfdLeft;
    var r = invRate(fabGreigeOf(e.fabricType));
    var rate = r ? r.rate : 0;
    if (!r && owned > 0.05) { t.unrated.push(e.fabricType); t.unratedM += owned; }
    t.greige += e.greigeLeft; t.proc += e.withProcessor; t.rfd += e.rfdLeft;
    t.greigeV += e.greigeLeft * rate; t.procV += e.withProcessor * rate; t.rfdV += e.rfdLeft * rate;
  });
  t.total = t.greige + t.proc + t.rfd;
  t.totalV = t.greigeV + t.procV + t.rfdV;
  t.valuedM = t.total - t.unratedM;
  return t;
}

/** Fabric by fabric: what is in the store, what is out at a processor, and what it cost. */
function invRows() {
  return fabFlowRows(DB.fab || []).map(function (e) {
    var greigeName = fabGreigeOf(e.fabricType);
    var rate = invRate(greigeName);
    var owned = e.greigeLeft + e.withProcessor + e.rfdLeft;
    return {
      fabric: e.fabricType, greige: greigeName,
      inStoreGreige: e.greigeLeft, atProcessor: e.withProcessor, inStoreRfd: e.rfdLeft,
      owned: owned,
      rate: rate ? rate.rate : null, rateFrom: rate ? rate.poNo : '',
      /* COST, NOT WORTH. It is the greige rate off the last PO -- what the cloth cost to buy. The
       * processing bill is not in this app, so it is not in this figure. */
      value: rate ? owned * rate.rate : null
    };
  }).filter(function (r) { return r.owned > 0.05; });
}
