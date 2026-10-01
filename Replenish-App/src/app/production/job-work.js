/* ---------------- Base Data (issue → receive register) ---------------- */

let PT_BD_KPI = '';     // '' | 'issued' | 'received' | 'rejected' | 'pending' | 'done' | 'open'
const PT_BD_KPI_LABEL = { issued: 'Issued', received: 'Received', rejected: 'Rejected',
  pending: 'Pending pieces', done: 'Completed', open: 'Open' };

async function ensurePbase() {
  /* The 💬 buttons need the employee list to know who has a number, and the templates to compose
   * with. Kicked off here, not awaited: the register must not wait on a nicety. */
  waLoad().catch(() => {});
  if (PT.base === null) await ptLoad('base', 'pt_baseData', renderPbase); else renderPbase();
}

/**
 * Who touched a row: the person who entered it, and the person who changed it afterwards.
 *
 * ENTERING AND EDITING ARE DIFFERENT ACTS. Entering is open to everyone who can reach the register;
 * editing is granted per account, because it moves figures somebody has already counted on. So the
 * cell names the first plainly and marks the second, with the date in the tooltip.
 */
const whoShort = e => String(e || '').split('@')[0] || '';
const whoTouched = r => [String((r && r.addedBy) || ''), String((r && r.lastEditedBy) || '')]
  .map(s => s.trim().toLowerCase()).filter(Boolean);
function whoCell(r) {
  const by = whoShort(r && r.addedBy);
  const ed = String((r && r.lastEditedBy) || '').trim();
  const when = ptIsoDate((r && r.lastEditedAt) || '') || '';
  return `<td style="text-align:left;font-size:12px">${esc(by) || '<span class="muted">—</span>'}`
    + (ed ? `<div class="muted" style="font-size:10px" title="Changed by ${esc(ed)}${when ? ' on ' + esc(when) : ''}">`
        + `edited · ${esc(whoShort(ed))}${when ? ' · ' + esc(when) : ''}</div>` : '')
    + '</td>';
}
/** The people on these rows, for the picker — whoever entered or changed one. */
const whoList = rows => [...new Set((rows || []).flatMap(whoTouched))].sort();

function pbaseFilters() {
  const v = id => ($(id) || {}).value || '';
  return { type: v('pbType'), emp: v('pbEmp'), art: v('pbArt'), sub: v('pbSub'), col: v('pbCol'),
    sz: v('pbSz'), status: v('pbStatus'), q: v('pbQ').trim().toLowerCase(), d1: v('pbD1'), d2: v('pbD2'),
    dBy: v('pbDBy'), who: v('pbWho') };
}

function pbaseApply(rows, f, skip) {
  skip = skip || '';
  return rows.filter(r => {
    if (skip !== 'type' && f.type && !ptCi(r.empType, f.type)) return false;
    if (skip !== 'emp' && f.emp && !ptCi(r.empName, f.emp)) return false;
    /* Entered by them OR changed by them — "everything this person touched" is the question. */
    if (skip !== 'who' && f.who && whoTouched(r).indexOf(String(f.who).toLowerCase()) < 0) return false;
    if (skip !== 'art' && f.art && !ptCi(r.articleType, f.art)) return false;
    if (skip !== 'sub' && f.sub && !ptCi(r.articleSubtype, f.sub)) return false;
    if (skip !== 'col' && f.col && !ptCi(r.color, f.col)) return false;
    if (skip !== 'sz' && f.sz && !ptCi(r.size, f.sz)) return false;
    if (skip !== 'q' && f.q) {
      const hay = [r.sku, r.articleType, r.articleSubtype, r.color, r.size, r.empName, r.empType, r.orderNo, r.remarks].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    if (skip !== 'status' && f.status === 'open' && r.frozen) return false;
    if (skip !== 'status' && f.status === 'done' && !r.frozen) return false;
    if (skip !== 'status' && f.status === 'pending' && ptNum(r.pendingPieces) < 1) return false;
    if (skip !== 'date' && (f.d1 || f.d2)) {
      /* Issued, received, or either: a row is in the range when the date it is asked about is. A row
       * nothing has come back on yet has no receiving date, and is never "received" in any range. */
      const lo = f.d1 ? new Date(f.d1 + 'T00:00:00') : null, hi = f.d2 ? new Date(f.d2 + 'T23:59:59') : null;
      const inR = v => { const d = v ? ptDate(v) : null; return !!d && (!lo || d >= lo) && (!hi || d <= hi); };
      const recv = ptNum(r.receivedPieces) + ptNum(r.rejectionPieces) > 0 ? r.receivingDate : '';
      const ok = f.dBy === 'issue' ? inR(r.issueDate) : f.dBy === 'recv' ? inR(recv) : (inR(r.issueDate) || inR(recv));
      if (!ok) return false;
    }
    return true;
  });
}

/* HOW MANY ROWS JOB WORK AND CUTTING DRAW (2026-10-01). Cutting drew every entry — 17,238 cells on 30 Sep and
 * more each day — and Job Work 600 rows, 1.2 MB of HTML. 300 first; "Show more" adds 300. Export, the KPI cards and
 * the totals still count every filtered row. */
const PT_CAP_STEP = 300;
let PB_CAP = PT_CAP_STEP, PC_CAP = PT_CAP_STEP;
const ptMoreBtn = (attr, n, cap) => n > cap
  ? ` <button type="button" ${attr} style="padding:3px 10px;font-size:12px;margin-left:6px">Show ${nf(Math.min(PT_CAP_STEP, n - cap))} more</button>` : '';
function renderPbase() {
  /* Read once, then painted on every draw. The read is not awaited: the register is what this screen
   * is for, and it must not wait on a queue that is usually empty. */
  if (APV === null && ME.admin) { APV = []; apvLoad(true).then(apvPaint).catch(() => {}); }
  apvPaint();
  if (JWC.rows === null) { JWC.rows = {}; jwCorrLoad().then(() => { if (PT.base) renderPbase(); }).catch(() => {}); }
  jwCorrBadge();
  $('pbMore').innerHTML = '';
  if ($('pbArchive')) $('pbArchive').classList.toggle('hide', !(ME.admin && BASE.on));
  if (PT.busy.base) { $('pbMsg').className = 'muted'; $('pbMsg').textContent = 'Reading the production database…'; ptEmpty('pbTable', 'Loading…'); return; }
  if (PT.err.base) {
    $('pbMsg').className = 'err'; $('pbMsg').textContent = 'Could not read it: ' + PT.err.base;
    ptEmpty('pbTable', 'Nothing to show.'); $('pbKpis').innerHTML = ''; return;
  }
  const all = PT.base || [];
  if (!all.length) { $('pbMsg').className = 'muted'; $('pbMsg').textContent = ''; $('pbKpis').innerHTML = ''; ptEmpty('pbTable', 'No issue/receive entries.'); return; }

  const f = pbaseFilters();
  ptFill('pbType', pbaseApply(all, f, 'type').map(r => r.empType), 'All types');
  ptFill('pbEmp', pbaseApply(all, f, 'emp').map(r => r.empName), 'All employees');
  ptFill('pbWho', whoList(pbaseApply(all, f, 'who')), "Anyone's entry");
  ptFill('pbArt', pbaseApply(all, f, 'art').map(r => r.articleType), 'All articles');
  ptFill('pbSub', pbaseApply(all, f, 'sub').map(r => r.articleSubtype), 'All subtypes');
  ptFill('pbCol', pbaseApply(all, f, 'col').map(r => r.color), 'All colors');
  ptFill('pbSz', pbaseApply(all, f, 'sz').map(r => r.size), 'All sizes');

  /* The KPI cards count the FILTERED set, not the set after a card has been clicked — otherwise
   * clicking "Pending" would rewrite every other card to match it and the totals would move under
   * your hand. Only the table narrows. */
  const base = pbaseApply(all, f);
  let rows = base;
  if (PT_BD_KPI === 'open') rows = base.filter(r => !r.frozen);
  else if (PT_BD_KPI === 'done') rows = base.filter(r => r.frozen);
  else if (PT_BD_KPI === 'pending') rows = base.filter(r => ptNum(r.pendingPieces) > 0);
  else if (PT_BD_KPI === 'issued') rows = base.filter(r => ptNum(r.issuePieces) > 0);
  else if (PT_BD_KPI === 'received') rows = base.filter(r => ptNum(r.receivedPieces) > 0);
  else if (PT_BD_KPI === 'rejected') rows = base.filter(r => ptNum(r.rejectionPieces) > 0);

  const sum = fn => base.reduce((s, r) => s + ptNum(fn(r)), 0);
  const tI = sum(r => r.issuePieces), tR = sum(r => r.receivedPieces);
  const tRej = sum(r => r.rejectionPieces), tP = sum(r => r.pendingPieces);
  const done = base.filter(r => r.frozen).length, open = base.filter(r => !r.frozen).length;

  const sel = k => (PT_BD_KPI === k ? ' pt-kpi-on' : '') + '" role="button" tabindex="0" title="'
    + (PT_BD_KPI === k ? 'Showing only these entries. Click again to show all.'
      : k === '' ? 'Show every entry.' : 'Show only the entries with ' + PT_BD_KPI_LABEL[k].toLowerCase() + '.');
  $('pbKpis').innerHTML = jwKpiCards({ sel, base, tI, tR, tRej, tP, done, open });

  rows = [...rows].sort((a, b) => {
    const d = ptDtMs(b.issueDate) - ptDtMs(a.issueDate);
    return d || String(b.id || '').localeCompare(String(a.id || ''));
  });
  PT._pbaseRows = rows;

  /* RAVI'S ORDER, IN FEWER COLUMNS (2026-09-22: "attractive, kuch bhi data kam na ho"). Neighbours that
   * describe one thing share a cell — the karigar and their type; the item's picture, SKU, subtype,
   * colour and size; the status and the day it came back. Nothing is dropped and nothing moves. */
  /* 2026-09-22, second pass: the receipt boxes sit UNDER the Received figure they add to, and the
   * WhatsApp buttons join Edit in one Actions cell. Export is untouched — it builds its own columns. */
  /* Third pass (2026-09-22): pending and rejected said twice — once in Status, once in their own
   * columns — so Status alone carries them; who entered it and the remarks go to the end. */
  /* FIFTH PASS (2026-09-22, Ravi's picture): a tick box to pick rows, the karigar with their initials,
   * the item with its picture, both quantities in pieces, a progress ring, a status that says Pending,
   * In Progress or Completed, and one action with the rest behind ⋯. Who entered it stays at the end. */
  const shown = rows.slice(0, PB_CAP);
  const allOn = shown.length > 0 && shown.every(r => JW_PICK.has(r.id));
  const head = '<thead><tr>' + [`<input type="checkbox" class="jw-pickall" title="Pick every row on screen"${allOn ? ' checked' : ''}>`,
    'Issue Date', 'Karigar', 'Item', 'Qty Issued', 'Qty Received', 'Progress', 'Status', 'Actions', 'Entered by']
    .map((h, i) => `<th${i === 0 ? ' class="jw-ck"' : ([4, 5].indexOf(i) >= 0 ? ' class="num"' : '')}>${h}</th>`).join('') + '</tr></thead>';
  const body = shown.map(jwRow).join('');
  $('pbTable').innerHTML = head + '<tbody>' + body + '</tbody>';
  jwBulkShow();

  $('pbMsg').className = 'muted';
  $('pbMsg').textContent = `${nf(rows.length)} of ${nf(all.length)} entr${all.length === 1 ? 'y' : 'ies'}`
    + (rows.length > PB_CAP ? ` · showing the first ${nf(PB_CAP)} · Export covers all of them` : '')
    + (PT_BD_KPI_LABEL[PT_BD_KPI] ? ' · only entries with ' + PT_BD_KPI_LABEL[PT_BD_KPI] + ' — click the figure again to show all' : '');
  $('pbMore').innerHTML = ptMoreBtn('data-pbmore', rows.length, PB_CAP);
  ptImgFill(shown.map(r => r.sku), false, ptIfTab('pbase', renderPbase));
}

