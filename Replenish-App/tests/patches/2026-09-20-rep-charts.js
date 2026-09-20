/* CHARTS ON THE WEEK-ON-WEEK REPORT.
 *
 * "in reporto ko thoda professional banao like pro" — with a Power-BI screen beside it: a 3D pie, a
 * blue gradient, filter rails down both sides.
 *
 * WHAT THAT SCREEN HAS THAT THIS ONE DID NOT is charts: the shape of the thing, read in one look.
 * What it has that this one should NOT copy is a 3D pie chart, in which no human can compare two
 * slices, and a wall of gradient chrome around the data. So: charts, built to the rules, and none of
 * the decoration.
 *
 * THE FORMS, picked by what the reader has to do:
 *   · The weeks: change over time, four to eight buckets — COLUMNS. And because the whole tab is
 *     about one week against the ones before it, this is the EMPHASIS form: last week in the accent,
 *     the earlier weeks in the de-emphasis grey. Not eight colours for one number.
 *   · The articles: compare magnitude across categories — HORIZONTAL BARS, sorted, long names on the
 *     left where they can be read. Every bar the SAME colour: shading them by size would encode the
 *     length twice and burn the only free channel. Top eight, the tail folded into "Other", because
 *     past about seven classes a chart stops being read and the table beside it carries them all.
 *   · Each row: the shape of its four weeks — a SPARKLINE, no axis, no labels. The figures are in the
 *     columns beside it; this is for the shape, and a shape is what a column of numbers cannot show.
 *
 * THE COLOURS WERE COMPUTED, NOT CHOSEN. Accent #4f46e5 with de-emphasis #94a3b8, run through the
 * palette validator on a white surface: monotone lightness, a visible step between them, and the
 * light end at 2.56:1 — the first two greys I tried (#c7d2fe at 1.49:1, #a5b4fc at 1.99:1) failed
 * that floor and are not here. Green and red stay what they already are on this screen: direction.
 *
 * NOTHING IS FETCHED. No chart library, no font, no sprite — the same rule the rest of the page
 * keeps. These are strings of SVG.
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

/* ---- 1. the marks ---- */
one(`/** How a change is written: a percentage where there is one, and the truth where there is not. */`,
`/* ================= THE CHARTS =================
 *
 * Three forms, one hue and a grey. Every number that appears on a chart also appears in the table
 * below it, so nothing is only ever readable as a picture.
 */
const REP_INK = '#4f46e5';        // the week being reported on
const REP_DIM = '#94a3b8';        // the weeks it is being compared against
const REP_RULE = '#e5e8ee';       // one step off the surface, hairline, solid

/** Round to something a person would say: 0, 500, 1,000, 5,000. */
function repNice(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(x => x >= v) || 10 * p;
}

/**
 * THE WEEKS, AS COLUMNS — the emphasis form. Last week carries the accent; the weeks before it are
 * the grey it is being measured against. One series, so no legend: the heading says what is plotted.
 *
 * Only the last column is labelled. A number on every mark is chaos and goes unread; the rest are
 * carried by the axis under them and by the table below.
 */
function repTrendSvg(weeks, totals, labels) {
  const W = 420, H = 150, padL = 44, padR = 10, padT = 16, padB = 26;
  const n = totals.length;
  if (!n) return '';
  const top = repNice(Math.max(...totals, 1));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const band = plotW / n;
  /* Capped at 24, and the leftover of the band is left as air rather than filled. */
  const bw = Math.min(24, band - 10);
  const y = v => padT + plotH - (v / top) * plotH;
  const grid = [0, top / 2, top].map(v =>
    '<line x1="' + padL + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(v).toFixed(1)
    + '" stroke="' + REP_RULE + '" stroke-width="1"/>'
    + '<text x="' + (padL - 7) + '" y="' + (y(v) + 3.5).toFixed(1) + '" text-anchor="end" font-size="9.5" fill="#94a3b8">'
    + esc(nf(Math.round(v))) + '</text>').join('');
  const bars = totals.map((v, i) => {
    const cx = padL + band * i + band / 2;
    const h = Math.max(v > 0 ? 2 : 0, plotH - (y(v) - padT));
    const last = i === n - 1;
    return '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + (padT + plotH - h).toFixed(1) + '" width="' + bw.toFixed(1)
      + '" height="' + h.toFixed(1) + '" rx="4" fill="' + (last ? REP_INK : REP_DIM) + '">'
      + '<title>' + esc(labels[i] + ': ' + nf(Math.round(v)) + ' pieces') + '</title></rect>'
      /* The cap label, on the one column the report is about. */
      + (last && v > 0 ? '<text x="' + cx.toFixed(1) + '" y="' + (padT + plotH - h - 5).toFixed(1)
        + '" text-anchor="middle" font-size="11" font-weight="700" fill="#0f172a">' + esc(nf(Math.round(v))) + '</text>' : '')
      + '<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="9.5" fill="'
      + (last ? '#0f172a' : '#94a3b8') + '"' + (last ? ' font-weight="700"' : '') + '>' + esc(labels[i]) + '</text>';
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" '
    + 'aria-label="Pieces received each week" style="display:block;font-family:inherit">'
    + grid + bars + '</svg>';
}

/**
 * THE ARTICLES, AS BARS. Same colour on every bar: they are categories, not a scale, and shading
 * them by length would say the length twice.
 *
 * Eight, then "Other" — past about seven classes a chart stops being read, and every one of them is
 * in the table below anyway.
 */
function repShareSvg(rows) {
  const keep = rows.filter(r => r.prod > 0).slice(0, 8);
  if (!keep.length) return '';
  const rest = rows.filter(r => r.prod > 0).slice(8).reduce((a, r) => a + r.prod, 0);
  const items = keep.map(r => ({ name: r.art, v: r.prod }))
    .concat(rest > 0 ? [{ name: 'Other', v: rest, other: true }] : []);
  const rowH = 22, padT = 8, padL = 132, padR = 52, W = 420;
  const H = padT * 2 + items.length * rowH;
  const top = Math.max(...items.map(x => x.v), 1);
  const plotW = W - padL - padR;
  const body = items.map((x, i) => {
    const yTop = padT + i * rowH;
    const w = Math.max(2, (x.v / top) * plotW);
    const name = x.name.length > 20 ? x.name.slice(0, 19) + '…' : x.name;
    return '<text x="' + (padL - 8) + '" y="' + (yTop + 13.5) + '" text-anchor="end" font-size="11" fill="'
      + (x.other ? '#94a3b8' : '#334155') + '">' + esc(name) + '<title>' + esc(x.name) + '</title></text>'
      + '<rect x="' + padL + '" y="' + (yTop + 4) + '" width="' + w.toFixed(1) + '" height="14" rx="4" fill="'
      + (x.other ? REP_DIM : REP_INK) + '"><title>' + esc(x.name + ': ' + nf(Math.round(x.v)) + ' pieces') + '</title></rect>'
      /* The value at the tip, outside the bar, where it can never be clipped by its own mark. */
      + '<text x="' + (padL + w + 7).toFixed(1) + '" y="' + (yTop + 15) + '" font-size="10.5" fill="#475569" font-weight="600">'
      + esc(nf(Math.round(x.v))) + '</text>';
  }).join('');
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" '
    + 'aria-label="Pieces received last week by article type" style="display:block;font-family:inherit">'
    + body + '</svg>';
}

/**
 * ONE ROW'S FOUR WEEKS, as a shape. No axis and no labels — the figures are in the columns beside
 * it, and this is here for the thing a column of numbers cannot show.
 */
function repSparkSvg(hist, labels) {
  const n = (hist || []).length;
  if (!n) return '';
  const W = 62, H = 20, top = Math.max(...hist, 1);
  const band = W / n, bw = Math.min(7, band - 2);
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" style="display:block">'
    + hist.map((v, i) => {
      const h = v > 0 ? Math.max(2, (v / top) * (H - 3)) : 0;
      if (!h) return '';
      return '<rect x="' + (band * i + (band - bw) / 2).toFixed(1) + '" y="' + (H - h).toFixed(1)
        + '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="'
        + (i === n - 1 ? REP_INK : REP_DIM) + '"><title>' + esc((labels && labels[i] ? labels[i] + ': ' : '')
        + nf(Math.round(v))) + '</title></rect>';
    }).join('') + '</svg>';
}

/** How a change is written: a percentage where there is one, and the truth where there is not. */`, 'the marks');

fs.writeFileSync(P, s.split(LF).join(CR + LF));
console.log('written');
