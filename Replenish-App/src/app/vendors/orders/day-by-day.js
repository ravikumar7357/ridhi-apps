/* ================= WHAT CAME IN, DAY BY DAY =================
 *
 * Every delivery a printer has recorded, laid out by the day it arrived. Ravi, 2026-09-07: "jab
 * vendor mujhe goods bheje to uska days wise logbook banana chahiye".
 *
 * Nothing new is stored for this. Each delivery is already written against its line as
 * { qty, date, by, at } the moment the printer records it in their portal — 176 of them today,
 * adding to exactly what the stored dispatched figures say. This reads them, it does not keep a
 * second copy that could drift.
 *
 * CUT AND RUNNING ARE NEVER ADDED TOGETHER. One is pieces, the other is metres of cloth. A single
 * "total received" across both would be a number with no unit, and this screen already says so
 * about the order list.
 */

/* Dates as they actually are in this data, not as they ought to be.
 *
 * A strict dd/mm/yyyy reader drops 22 of the 176 delivery rows — "31/08//2026" has two slashes and
 * "4/09/2026" has a one-digit day. That is 250 pieces, 7.3% of everything received, and it would
 * have gone missing from the logbook with nothing anywhere saying a row had been skipped. The app
 * writes the strict form itself, so these came in with the data; they are read, not rejected. */
function voDayOf(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];
  const parts = s.split('/').map(x => x.trim()).filter(x => x !== '');
  if (parts.length < 3) return '';
  const d = parseInt(parts[0], 10), m = parseInt(parts[1], 10), y = parseInt(parts[2], 10);
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 1900)) return '';
  return String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/' + y;
}
/** Sortable form of a day-first date. */
const voDayKey = day => { const p = String(day).split('/'); return p.length === 3 ? p[2] + p[1] + p[0] : ''; };

/**
 * The width of a cloth, in metres, read out of its own name — "Sheeting 62" is 62 inches wide.
 * There is nowhere else it is written: the fabricType master carries a code and a description and
 * no width at all, so the name is the only record there is. 914 master rows use a fabric with no
 * number in the name, and those simply cannot be worked out.
 */
function voFabWidthM(fabric) {
  const fed = fabWidthIn(fabric);
  if (fed > 0) return fed * 0.0254;
  const m = String(fabric || '').match(/(\d{2,3})\s*$/);
  const inch = m ? +m[1] : 0;
  return inch > 0 ? inch * 0.0254 : 0;
}

/**
 * The width somebody typed on the Fabric type master, in inches — 0 when nobody has.
 *
 * "Cambric", "Canvas", "Polyester" and six more carry no number in their name, so the old
 * digits-off-the-end rule read them as widthless and quietly dropped 65,466 pieces out of every
 * square-metre figure on the site. The width belongs to the fabric, not to its spelling.
 *
 * Built once per masters object: pafNeed asks this for every open order line.
 */
let FABW_IX = { src: null, map: null };
function fabWidthMap() {
  const src = (PTG.masters || {}).fabricType;
  if (FABW_IX.src === src && FABW_IX.map) return FABW_IX.map;
  const m = new Map();
  ptList(src).forEach(r => {
    const w = parseFloat(r && r.widthIn);
    if (!(w > 0)) return;
    /* Matched on either, because records say the name and forms sometimes carry the code. */
    [r.desc, r.code].forEach(x => { const k = String(x || '').trim().toLowerCase(); if (k) m.set(k, w); });
  });
  FABW_IX = { src, map: m };
  return m;
}
const fabWidthIn = fabric => fabWidthMap().get(String(fabric || '').trim().toLowerCase()) || 0;

/**
 * Square metres of cloth in a quantity — null when it cannot honestly be worked out.
 *
 * A CUT line: consumption is the running metres one piece takes, so pieces × consumption × width.
 * A RUNNING line: the quantity is already metres of cloth, so metres × width.
 */
function voSqm(r, qty) {
  const q = parseFloat(qty) || 0;
  if (!(q > 0)) return null;
  if (r.run) {
    const w = voFabWidthM(r.fabric);
    return w ? q * w : null;
  }
  const m = mdbOf(r.sku);
  if (!m) return null;
  /* A TABLECLOTH OR RUNNER IS ITS OWN SIZE (Ravi, 2026-09-29: "square meter looks wrong" — 33 of a 60x90 read
   * 122.13 m², the cloth consumed with its hems and the bolt's spare width, where the piece is 33 × 3.48 = 114.97).
   * Everything else is still the cloth a piece takes: consumption × the fabric's width. The printers' capacity
   * (pafHistory) and the printing need (pafNeed) are read the same way, so the two still measure alike. */
  const a = voSizeSqm(m);
  if (a) return q * a;
  const cons = parseFloat(m.consumption) || 0;
  const w = voFabWidthM(m.fabric);
  if (!cons || !w) return null;
  return q * cons * w;
}
/**
 * A tablecloth's or runner's own size as square metres, for a row with no consumption or no fabric width:
 * "60x90" is 60 × 90 inches, "110 Round" is cut from a 110 × 110 square. Other articles have no such rule — null.
 */
function voSizeSqm(m) {
  if (!m || !/tablecloth|runner/i.test(String(m.articleType || '') + ' ' + String(m.subtype || ''))) return null;
  const z = String(m.size || '').trim();
  const r = z.match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  if (r) return (+r[1]) * (+r[2]) * 0.00064516;
  const d = z.match(/^(\d+(?:\.\d+)?)\s*(?:"|in)?\s*(?:round)?$/i);
  return d && (/round/i.test(z) || /round/i.test(String(m.subtype || ''))) ? (+d[1]) * (+d[1]) * 0.00064516 : null;
}
const voSqmTxt = v => v == null ? '<span class="muted">—</span>' : nf(Math.round(v * 100) / 100);

/** Every recorded delivery, one row each, oldest fields kept as they were written. */
function voLogRows() {
  const out = [];
  (VO.rows || []).forEach(o => {
    const run = voRunning(o);
    voLines(o).forEach((l, li) => {
      voDels(l).forEach((d, di) => {
        const qty = parseFloat(d.qty) || 0;
        if (!qty) return;
        const day = voDayOf(d.date);
        out.push({
          day, key: voDayKey(day), raw: String(d.date || ''),
          /* Enough to find this exact delivery again, and a key of its own for the tick boxes. */
          li, di, del: d, ok: (d.ok && isFinite(parseFloat(d.ok.qty))) ? d.ok : null,
          key2: o.vendorCode + '/' + o.id + '/' + li + '/' + di,
          vendorCode: o.vendorCode, vendor: voName(o.vendorCode),
          orderNo: o.orderNo || o.id, id: o.id, run, unit: run ? 'm' : 'pcs',
          /* PRINTING WORK, from a printer: the firm's kind in the vendor master says printer, and the order — when it
           * names its work — names printing. A filling house's quilts are not printing capacity. */
          printing: /print/i.test(String(voCatOf(o.vendorCode) || '')) && (!o.service || voIsPrinting(o)),
          sku: l.sku || '',
          /* The fabric a RUNNING line is printed on — a cut line's comes off its master row instead. */
          fabric: run ? (l.fabricType || '') : '', colour: l.color || '',
          what: run ? [l.fabricType, l.color, l.printDirection].filter(Boolean).join(' · ')
                    : [l.articleSubtype || l.articleType, l.color, l.size].filter(Boolean).join(' · '),
          qty, by: d.by || '', at: d.at || '',
        });
      });
    });
  });
  return out;
}

/** The logbook, filtered by the toolbar this screen already has. */
function voLogFiltered() {
  const vf = $('voVendor').value, tf = $('voType').value;
  const q = $('voQ').value.trim().toLowerCase();
  return voLogRows().filter(r =>
    (!vf || r.vendorCode === vf)
    && (!tf || (r.run ? 'running' : 'cut') === tf)
    && (!q || [r.vendor, r.orderNo, r.sku, r.what, r.day, r.by].join(' ').toLowerCase().includes(q)));
}

/* renderVoLog is gone: the day-by-day log has its own tab, with its own filters and its own
 * date window. voLogRows(), which reads the deliveries, is shared by both and stays. */

