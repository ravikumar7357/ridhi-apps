/* THE ALLOCATION IS RAVI'S DECISION, AND THE CAPACITY IS THE FLOOR'S RECORD.
 *
 * "printing allocation me decide karunga ye kiske sath jayega · capacity month yaha history se auto
 * decide hona chahiye me table add kar dunga · group me manual select karunga auto nahi."
 *
 * WHAT WAS WRONG. Every group was handed to whichever printer scored highest, and the score was a
 * guess: does this printer already print this colour, do they hold a block for it. So all three
 * printers came back at 100% on CPC Green, which is not an allocation, it is an arithmetic accident.
 * Who prints what is a relationship — who is trusted with which colour — and that is not in the data.
 *
 * SO THE GROUPS ARE PICKED, one printer at a time, and a group only goes to a printer who has been
 * given it. A group nobody has been given is not quietly handed to somebody; it is reported.
 *
 * AND THE CAPACITY IS MEASURED. The typed figures were badly wrong — Choudhary Hand Block was down
 * as 280 a month and has delivered 1,745 in a month. Measured on the live log:
 *
 *   VND001 RBP-Bagru      3,957 in Sept (part month) on 50 tables
 *   VND002 Choudhary      822 in Aug, 1,745 in Sept, on 24 tables
 *   VND004 A R Textile    1,978 in Sept (part month) on 30 tables
 *
 * THE BEST MONTH, NOT THE AVERAGE. An average measures how much work WE gave them, not what they can
 * do: a month we sent 800 pieces into shows as 800 whatever they could have printed. Capacity is what
 * they have been shown to manage, so it is the best month they have achieved.
 *
 * AND THE MONTH WE ARE IN IS NOT A WHOLE MONTH. Today is the 20th; reading 3,957 as a month's work
 * would under-count a printer by a third. It is scaled to the month it is on course for, and the
 * screen says it is a part month.
 *
 * PER TABLE, SO TABLES MEAN SOMETHING. The measure is pieces per table per month, and the capacity is
 * that times the tables Ravi enters — which is the whole of "me table add kar dunga". A printer with
 * no history of their own borrows the rate of the ones that have, and a brand-new printer with no
 * rate anywhere falls back to a figure that can be typed. Every one of those says which it is.
 */
const fs = require('fs');
const P = 'C:/AMAZON/Amazon Inventory/Replenish-App/public/index.html';
const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
let s = fs.readFileSync(P, 'utf8').split(CR + LF).join(LF);
const one = (a, b, n) => {
  if (s.split(a).length !== 2) throw new Error('anchor not unique (' + (s.split(a).length - 1) + '): ' + n);
  s = s.replace(a, () => b);
  console.log('  ok   ' + n);
};

one(`const palScore = (p, g) => (g.now.has(p.name) ? 4 : 0) + (palGroupBlocks(p.key, g).have > 0 ? 2 : 0);`,
`/* ================= WHAT A PRINTER CAN DO IN A MONTH, FROM WHAT THEY HAVE DONE =================
 *
 * The typed figures were badly wrong — one printer was down as 280 a month against 1,745 delivered
 * in a month. These read the delivery log instead.
 */

/** A delivery date, day-first or ISO, as the month it fell in. */
function palYm(v) {
  const t = String(v == null ? '' : v).trim();
  let m = t.match(/^(\\d{4})-(\\d{2})/);
  if (m) return m[1] + '-' + m[2];
  m = t.match(/^(\\d{1,2})[-\\/.](\\d{1,2})[-\\/.](\\d{4})/);
  return m ? m[3] + '-' + String(m[2]).padStart(2, '0') : '';
}
/** How much of the month we are in has gone — never 0, so nothing is ever divided by nothing. */
function palMonthPart(ym) {
  const now = new Date();
  const here = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  if (ym !== here) return 1;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, now.getDate()) / days;
}

/** Which vendor a printer is, by the code they were linked to or by their name. */
function palVendorOf(p) {
  if (!p) return '';
  const code = String(p.vendorCode || '').trim().toUpperCase();
  if (code) return code;
  const norm = x => String(x || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const want = norm(p.name);
  if (!want) return '';
  const hit = (voAllVendors ? voAllVendors() : []).find(v => norm(v.name) === want || norm(v.code) === want);
  return hit ? String(hit.code || '').toUpperCase() : '';
}

let PAL_DEL_IX = { src: null, n: -1, map: null };
/** Vendor code → month → pieces delivered. Built once per version of the vendor orders. */
function palDelivered() {
  const src = VO.rows || [];
  if (PAL_DEL_IX.map && PAL_DEL_IX.src === src && PAL_DEL_IX.n === src.length) return PAL_DEL_IX.map;
  const map = new Map();
  src.forEach(o => {
    const code = String((o && o.vendorCode) || '').toUpperCase();
    if (!code) return;
    voLines(o || {}).forEach(l => voDels(l || {}).forEach(d => {
      const q = palNum(d && d.qty);
      if (!(q > 0)) return;
      const k = palYm(d.at || d.date || d.on);
      if (!k) return;
      if (!map.has(code)) map.set(code, new Map());
      const m = map.get(code);
      m.set(k, palNum(m.get(k)) + q);
    }));
  });
  PAL_DEL_IX = { src, n: src.length, map };
  return map;
}

/**
 * Pieces per table per month, from the best month this printer has managed.
 *
 * THE BEST MONTH, NOT THE AVERAGE: an average measures how much work we gave them. And the month we
 * are in is scaled up to the month it is on course for, because reading 20 days as 30 under-counts
 * a printer by a third.
 *
 * Tables are today's tables applied to past months — a printer who has just added ten of them will
 * read low until a month has run on the new number. That is the safe direction: it under-promises.
 */
function palRateOf(p) {
  const tables = palNum(p && p.tables);
  const code = palVendorOf(p);
  const months = code ? palDelivered().get(code) : null;
  if (!tables || !months || !months.size) return null;
  let best = 0, bestMonth = '', part = false;
  months.forEach((pcs, ym) => {
    const share = palMonthPart(ym);
    const full = pcs / share;
    if (full > best) { best = full; bestMonth = ym; part = share < 1; }
  });
  if (!(best > 0)) return null;
  return { perTable: best / tables, month: bestMonth, partMonth: part, months: months.size, pcs: best };
}

/** The rate to lend a printer who has no history of their own: what the others manage. */
function palRateShared() {
  const all = palPrinters().map(palRateOf).filter(Boolean).map(r => r.perTable).sort((a, b) => a - b);
  if (!all.length) return 0;
  /* The middle one, not the average — one printer having a spectacular month must not raise
   * everybody else's capacity with it. */
  return all[Math.floor(all.length / 2)];
}

/**
 * WHAT THIS PRINTER CAN DO IN A MONTH, and how we know.
 *
 * Tables times the measured rate. Nothing here is typed unless nothing can be measured at all, and
 * the answer always says which of the three it is, because a capacity nobody can account for is one
 * nobody should plan against.
 */
function palCapacity(p) {
  const tables = palNum(p && p.tables);
  const own = palRateOf(p);
  if (own) return { pcs: Math.round(tables * own.perTable), from: 'own', perTable: own.perTable,
    months: own.months, month: own.month, partMonth: own.partMonth };
  const shared = palRateShared();
  if (tables > 0 && shared > 0) return { pcs: Math.round(tables * shared), from: 'others', perTable: shared, months: 0 };
  return { pcs: Math.round(palNum(p && p.pcsMonth)), from: 'typed', perTable: 0, months: 0 };
}
/** How the capacity was arrived at, for the cell that shows it. */
function palCapWhy(c) {
  if (!c) return '';
  if (c.from === 'own') return 'Their best month' + (c.partMonth ? ' so far, scaled to a full month' : '')
    + ' works out at ' + nf(Math.round(c.perTable)) + ' pieces per table. Over ' + nf(c.months)
    + ' month(s) on record.';
  if (c.from === 'others') return 'No deliveries on record from this printer yet, so the other printers\\u2019 rate of '
    + nf(Math.round(c.perTable)) + ' pieces per table is used.';
  return 'Nothing to measure yet — this is the figure that was typed in.';
}

/** A group only goes to a printer who has been given it. */
const palTakes = (p, g) => (Array.isArray(p && p.groups) ? p.groups : []).indexOf(g.name) >= 0;

const palScore = (p, g) => (g.now.has(p.name) ? 4 : 0) + (palGroupBlocks(p.key, g).have > 0 ? 2 : 0);`, 'capacity from history');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
