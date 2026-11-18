/* ================= PRODUCTION MEETING — PRESENT AS SLIDES =================
 * Ravi, 18 Nov 2026: "ok make a meeting screen refine this is like PPT" — the agenda set in the meeting:
 *   1. Production report card — FBA, B2B, Shopify: overall production, orders delayed, pending orders; status (printing, fabric,
 *      stitching, QC, press, touching, spotting); challenges; initiative
 *   2. People — top 3 performers to recognise, bottom 3 to highlight (average up / down), critical vacancies with HR, people
 *      requirement not yet with HR
 *   3. Machines and tools — stitching, pillow, embroidery machines, cutting
 *   4. IT team — feedback, projects
 * Every figure is read from the same registers the meeting report reads (ordLines, the QC register, shpbStages for the stage counts);
 * what no register knows — challenges, initiatives, HR status, machines, IT — is typed on the slide and saved for the week in
 * pt_meeting/<week>/notes (the same store the report's own notes use). Nothing new is written anywhere else.
 * Opens from "Present" on the meeting report; ← → or the buttons move between slides, Esc closes. */

const MTS_CH = [
  { k: 'FBA', name: 'FBA — Amazon', test: c => c === 'AMZ', color: '#B45309' },
  { k: 'B2B', name: 'B2B', test: c => c === 'B' || c === 'B2B', color: '#2F6FE0' },   // B2B-… order numbers (mtgChan keeps 'B2B')
  { k: 'SHOP', name: 'Shopify', test: c => c === 'SHP' || c === 'ONL' || c === 'SPY', color: '#15803D' },
];
let MTS = { i: 0, slides: [], wk: '' };

/** One channel's card: QC passed this week (and last), orders delayed, pending, and where the open pieces wait. */
function mtsChannel(ch, wk) {
  const from = mtgMs(wk), to = from + 7 * 864e5, today = repWkIso(new Date());
  const ofCh = no => ch.test(mtgChan(no));
  let qc = 0, qcPrev = 0;
  repQcRows().forEach(r => {
    if (!r || !ofCh(r.orderNo || r.order || '')) return;
    const ms = ptDtMs(r.date); if (!ms) return;
    if (ms >= from && ms < to) qc += ptNum(r.ok); else if (ms >= from - 7 * 864e5 && ms < from) qcPrev += ptNum(r.ok);
  });
  const dueIx = (typeof SOX !== 'undefined' && SOX.rows) ? ordDueIndex() : new Map();
  const open = ordLines().filter(l => l.open && ofCh(l.orderNo));
  const orders = new Set(), lateOrders = new Set(); let pend = 0, latePcs = 0;
  open.forEach(l => {
    orders.add(l.orderNo); pend += l.pendingMake || 0;
    const due = l.mto ? l.mtoDue : (dueIx.get(l.orderNo + '|' + l.sku) || '');
    if (due && due < today && (l.pendingMake || 0) > 0) { lateOrders.add(l.orderNo); latePcs += l.pendingMake; }
  });
  let st = null; try { st = shpbStages(open); } catch (e) { st = null; }
  let spot = 0, touch = 0;
  try { qcDeptRows().forEach(x => { if (!x.left || !ofCh(x.c.orderNo || x.c.order || '')) return; if (/spot/i.test(x.dept)) spot += x.left; else if (/touch/i.test(x.dept)) touch += x.left; }); } catch (e) { /* QC not read */ }
  const stages = st ? [['To plan', st.planW], ['At printer', st.prcW], ['Fabric / to cut', st.cutW], ['Stitching (with karigars)', st.issW + st.recW],
    ['QC', st.qcW], ['Spotting', spot], ['Touching', touch], ['Press', st.prsW]] : [];
  return { qc, qcPrev, orders: orders.size, pend, late: lateOrders.size, latePcs, stages };
}

/** Karigars by QC-passed pieces this week, with their average of the four weeks before (up / down). */
function mtsPeople(wk) {
  const from = mtgMs(wk), now = new Map(), before = new Map();
  repQcRows().forEach(r => {
    if (!r || !r.karigar || qaApart(r)) return;
    const ms = ptDtMs(r.date); if (!ms) return;
    if (ms >= from && ms < from + 7 * 864e5) now.set(r.karigar, (now.get(r.karigar) || 0) + ptNum(r.ok));
    else if (ms >= from - 28 * 864e5 && ms < from) before.set(r.karigar, (before.get(r.karigar) || 0) + ptNum(r.ok));
  });
  /* the contractor's team is one name for many people — it is not a person to recognise or highlight */
  const rows = [...now.entries()].filter(([k]) => !/contractor/i.test(k)).map(([k, v]) => ({ k, v, avg: Math.round((before.get(k) || 0) / 4) }));
  rows.sort((a, b) => b.v - a.v);
  return { top: rows.slice(0, 3), bottom: rows.filter(r => r.v > 0).slice(-3).reverse(), n: rows.length };
}

/* ---------- drawing ---------- */
const mtsNum = (v, sub, col) => `<div class="mts-num"><b style="color:${col || 'var(--ink)'}">${v}</b><span>${sub}</span></div>`;
function mtsNote(wk, key, label, rows) {
  const n = (((MTG.meet || {})[wk] || {}).notes || {})[key] || '', can = mtgCanWrite();
  return `<label class="mts-note"><span>${esc(label)}</span><textarea data-mtsnote="${esc(key)}" rows="${rows || 3}" ${can ? '' : 'disabled'} placeholder="${can ? 'Type here — saved for this week' : ''}">${esc(n)}</textarea></label>`;
}
function mtsSlides(wk, brand) {
  const S = (MTG.last && MTG.last.wk === wk) ? MTG.last.S : mtgBuild(wk, brand);
  const range = repWkRange(wk), out = [];
  /* 0 · cover */
  let Q = { ok: 0 }, Qp = { ok: 0 }; try { const f = mtgMs(wk); Q = repQcByWindow(brand, f, f + 7 * 864e5); Qp = repQcByWindow(brand, f - 7 * 864e5, f); } catch (e) { /* */ }
  const tgt = repTarget(), d = Q.ok - Qp.ok;
  out.push({ t: 'Production meeting', html: `<div class="mts-cover"><div class="mts-kick">RIDHI HOME &amp; LIVING</div><h1>Production meeting</h1><div class="mts-range">${esc(range)}</div>
    <div class="mts-row">${mtsNum(nf(Q.ok), 'QC passed this week', '#166534')}${mtsNum((tgt ? Math.round(Q.ok / tgt * 100) : 0) + '%', 'of the ' + nf(tgt) + ' target', Q.ok >= tgt ? '#166534' : 'var(--bad)')}
      ${mtsNum((d >= 0 ? '▲ ' : '▼ ') + nf(Math.abs(d)), 'vs last week (' + nf(Qp.ok) + ')', d >= 0 ? '#166534' : 'var(--bad)')}${mtsNum(nf(Q.rej || 0), 'rejected', 'var(--bad)')}</div>
    <ol class="mts-agenda"><li>Production report card — FBA · B2B · Shopify</li><li>People discussion</li><li>Machines and tools</li><li>IT team — feedback, projects</li><li>Action points</li></ol></div>` });
  /* 1–3 · one slide per channel */
  MTS_CH.forEach(ch => {
    let c; try { c = mtsChannel(ch, wk); } catch (e) { c = null; }
    if (!c) { out.push({ t: ch.name, html: '<div class="err">Could not be worked out.</div>' }); return; }
    const dd = c.qc - c.qcPrev, mx = Math.max(1, ...c.stages.map(s => s[1]));
    out.push({ t: 'Production report card — ' + ch.name, html: `<div class="mts-bar" style="background:${ch.color}"></div>
      <div class="mts-row">${mtsNum(nf(c.qc), 'overall production (QC passed)', '#166534')}${mtsNum((dd >= 0 ? '▲ ' : '▼ ') + nf(Math.abs(dd)), 'vs last week (' + nf(c.qcPrev) + ')', dd >= 0 ? '#166534' : 'var(--bad)')}
        ${mtsNum(nf(c.late), 'orders delayed · ' + nf(c.latePcs) + ' pcs', c.late ? 'var(--bad)' : '#166534')}${mtsNum(nf(c.orders), 'pending orders · ' + nf(c.pend) + ' pcs to make', '')}</div>
      <div class="mts-two"><div><div class="mts-h">Status — where the open pieces are</div>
        ${c.stages.map(([l, v]) => `<div class="mts-st"><span>${esc(l)}</span><i><em style="width:${Math.round(v / mx * 100)}%;background:${ch.color}"></em></i><b>${nf(Math.round(v))}</b></div>`).join('')}</div>
        <div>${mtsNote(wk, 'ch_' + ch.k, 'Challenges — printing, fabric, people', 4)}${mtsNote(wk, 'in_' + ch.k, 'Initiative', 4)}</div></div>` });
  });
  /* 4 · people */
  const P = mtsPeople(wk), arrow = r => r.avg ? (r.v >= r.avg ? `<span style="color:#166534">▲ ${nf(r.v - r.avg)}</span>` : `<span style="color:var(--bad)">▼ ${nf(r.avg - r.v)}</span>`) : '<span class="muted">new</span>';
  const plist = (list, col) => list.length ? list.map((r, i) => `<div class="mts-p"><b style="background:${col}">${i + 1}</b><span>${esc(r.k)}</span><strong>${nf(r.v)} pcs</strong><em>avg ${nf(r.avg)} · ${arrow(r)}</em></div>`).join('') : '<div class="muted">No QC passed with a karigar name this week.</div>';
  let ppl = null; try { ppl = S.people; } catch (e) { ppl = null; }
  out.push({ t: 'People discussion', html: `<div class="mts-two"><div><div class="mts-h">Top 3 — to recognise</div>${plist(P.top, '#15803D')}
      <div class="mts-h" style="margin-top:18px">Bottom 3 — to highlight</div>${plist(P.bottom, '#B91C1C')}
      <div class="muted" style="font-size:12px;margin-top:6px">QC-passed pieces this week · average = the four weeks before · the contractor's team is left out</div></div>
    <div>${mtsNote(wk, 'hr_vacant', 'Critical vacant positions with HR — status', 4)}${mtsNote(wk, 'hr_need', 'People requirement not yet with HR — status', 4)}
      ${ppl && ppl.text ? `<div class="muted" style="font-size:12.5px;margin-top:8px">${esc(ppl.text.replace(/^2\) People: /, 'From the registers: '))}</div>` : ''}</div></div>` });
  /* 5 · machines and tools */
  out.push({ t: 'Machines and tools', html: `<div class="mts-grid4">${[['m_stitch', 'Stitching machine'], ['m_pillow', 'Pillow machine'], ['m_emb', 'Embroidery machine'], ['m_cut', 'Cutting']]
    .map(([k, l]) => mtsNote(wk, k, l, 5)).join('')}</div>` });
  /* 6 · IT team */
  out.push({ t: 'IT team', html: `<div class="mts-two">${mtsNote(wk, 'it_feedback', 'Feedback', 9)}${mtsNote(wk, 'it_projects', 'Projects', 9)}</div>` });
  /* 7 · action points */
  const acts = mtgActions(wk);
  out.push({ t: 'Action points', html: acts.length ? `<table class="mts-tbl"><thead><tr><th>What</th><th>Who</th><th>By</th><th>Status</th></tr></thead><tbody>${acts.map(a =>
      `<tr><td>${esc(a.what)}</td><td>${esc(a.who || '')}</td><td>${esc(a.by ? a.by.split('-').reverse().join('/') : '')}</td><td>${a.status === 'done' ? '<span style="color:#166534">done</span>' : 'open'}</td></tr>`).join('')}</tbody></table>`
    : '<div class="muted">No action points yet — add them on the meeting report.</div>' });
  return out;
}

function mtsDraw() {
  const box = document.getElementById('mtsBox'); if (!box) return;
  const n = MTS.slides.length, s = MTS.slides[MTS.i];
  box.querySelector('.mts-slide').innerHTML = `<div class="mts-title"><span>${esc(s.t)}</span><em>${esc(repWkRange(MTS.wk))} · ${MTS.i + 1} / ${n}</em></div><div class="mts-body">${s.html}</div>`;
  box.querySelector('.mts-dots').innerHTML = MTS.slides.map((x, i) => `<button type="button" data-mtsgo="${i}" class="${i === MTS.i ? 'on' : ''}" title="${esc(x.t)}"></button>`).join('');
}
function mtsOpen() {
  const wk = $('repWk').value, brand = $('repBrand').value;
  MTS = { i: 0, slides: mtsSlides(wk, brand), wk };
  let box = document.getElementById('mtsBox');
  if (!box) {
    box = document.createElement('div'); box.id = 'mtsBox';
    box.innerHTML = `<style>
      #mtsBox{position:fixed;inset:0;z-index:9999;background:#E9EDF3;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:18px}
      #mtsBox .mts-slide{width:min(1280px,100%);aspect-ratio:16/9;max-height:calc(100vh - 90px);background:#fff;border-radius:18px;box-shadow:0 10px 40px rgba(23,32,43,.15);padding:30px 40px;overflow:auto;display:flex;flex-direction:column}
      #mtsBox .mts-title{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #E4E7EC;padding-bottom:10px;margin-bottom:18px}
      #mtsBox .mts-title span{font-size:28px;font-weight:800;color:#17202B}#mtsBox .mts-title em{font-style:normal;color:#5B6475;font-size:14px}
      #mtsBox .mts-body{flex:1;min-height:0}
      #mtsBox .mts-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}
      #mtsBox .mts-num{border:1px solid #E4E7EC;border-radius:14px;padding:14px 16px}#mtsBox .mts-num b{display:block;font-size:38px;line-height:1.1;font-variant-numeric:tabular-nums}#mtsBox .mts-num span{color:#5B6475;font-size:14px}
      #mtsBox .mts-two{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:24px}
      #mtsBox .mts-grid4{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
      #mtsBox .mts-h{font-weight:800;font-size:16px;margin-bottom:8px;color:#17202B}
      #mtsBox .mts-st{display:grid;grid-template-columns:190px 1fr 70px;gap:10px;align-items:center;margin:7px 0;font-size:15px}
      #mtsBox .mts-st i{height:14px;background:#F1F3F6;border-radius:7px;overflow:hidden;display:block}#mtsBox .mts-st em{display:block;height:100%;border-radius:7px}#mtsBox .mts-st b{text-align:right;font-variant-numeric:tabular-nums}
      #mtsBox .mts-note{display:block;margin-bottom:12px}#mtsBox .mts-note span{display:block;font-weight:700;font-size:14px;color:#17202B;margin-bottom:4px}
      #mtsBox .mts-note textarea{width:100%;font:inherit;font-size:15px;border:1px solid #D5DCE5;border-radius:10px;padding:8px 10px;resize:vertical;background:#FBFCFD}
      #mtsBox .mts-p{display:grid;grid-template-columns:34px 1fr auto auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #F1F3F6;font-size:16px}
      #mtsBox .mts-p b{color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px}#mtsBox .mts-p em{font-style:normal;color:#5B6475;font-size:13px}
      #mtsBox .mts-cover{display:flex;flex-direction:column;justify-content:center;height:100%}#mtsBox .mts-kick{letter-spacing:.2em;color:#B45309;font-weight:800;font-size:13px}
      #mtsBox .mts-cover h1{font-size:54px;margin:6px 0 2px;color:#17202B}#mtsBox .mts-range{font-size:22px;color:#5B6475;margin-bottom:24px}
      #mtsBox .mts-agenda{font-size:17px;color:#17202B;line-height:1.8;margin:6px 0 0}
      #mtsBox .mts-bar{height:6px;border-radius:3px;margin:-8px 0 16px;width:120px}
      #mtsBox .mts-tbl{width:100%;border-collapse:collapse;font-size:16px}#mtsBox .mts-tbl th{text-align:left;color:#5B6475;font-size:13px;border-bottom:2px solid #E4E7EC;padding:8px}#mtsBox .mts-tbl td{padding:9px 8px;border-bottom:1px solid #F1F3F6}
      #mtsBox .mts-nav{display:flex;gap:10px;align-items:center;margin-top:12px}#mtsBox .mts-nav>button{width:auto;padding:6px 16px}
      #mtsBox .mts-dots{display:flex;gap:6px}#mtsBox .mts-dots button{width:10px;height:10px;padding:0;border-radius:50%;border:0;background:#C7CED8;box-shadow:none}#mtsBox .mts-dots button.on{background:#17202B}
      @media (max-width:800px){#mtsBox .mts-row{grid-template-columns:repeat(2,1fr)}#mtsBox .mts-two,#mtsBox .mts-grid4{grid-template-columns:1fr}#mtsBox .mts-slide{aspect-ratio:auto;padding:18px}}
      </style><div class="mts-slide"></div><div class="mts-nav"><button type="button" class="ghost" data-mtsnav="-1">← Back</button><div class="mts-dots"></div>
      <button type="button" class="ghost" data-mtsnav="1">Next →</button><button type="button" class="ghost" data-mtsnav="fs">Full screen</button><button type="button" class="ghost" data-mtsnav="x">Close (Esc)</button><span id="mtsMsg" class="muted" style="font-size:12px"></span></div>`;
    document.body.appendChild(box);
    box.addEventListener('click', e => {
      const n = e.target.closest('[data-mtsnav]'), g = e.target.closest('[data-mtsgo]');
      if (g) { MTS.i = +g.getAttribute('data-mtsgo'); return mtsDraw(); }
      if (!n) return;
      const v = n.getAttribute('data-mtsnav');
      if (v === 'x') return mtsClose();
      if (v === 'fs') { try { if (document.fullscreenElement) document.exitFullscreen(); else box.requestFullscreen(); } catch (er) { /* not allowed */ } return; }
      MTS.i = Math.max(0, Math.min(MTS.slides.length - 1, MTS.i + (+v))); mtsDraw();
    });
    box.addEventListener('change', async e => {
      const t = e.target; if (!t || t.getAttribute('data-mtsnote') == null) return;
      const err = await mtgSaveNote(MTS.wk, t.getAttribute('data-mtsnote'), t.value).catch(er => 'Not saved: ' + (er.message || er));
      const m = document.getElementById('mtsMsg'); if (m) { m.className = err ? 'err' : 'muted'; m.textContent = err || 'Saved for this week.'; }
    });
  }
  box.style.display = 'flex';
  mtsDraw();
}
function mtsClose() {
  const box = document.getElementById('mtsBox'); if (box) box.style.display = 'none';
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* */ }
  if ($('repView') && $('repView').value === 'mtg') renderMtg();
}
document.addEventListener('keydown', e => {
  const box = document.getElementById('mtsBox'); if (!box || box.style.display === 'none') return;
  if (e.target && /TEXTAREA|INPUT/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); MTS.i = Math.min(MTS.slides.length - 1, MTS.i + 1); mtsDraw(); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); MTS.i = Math.max(0, MTS.i - 1); mtsDraw(); }
  else if (e.key === 'Escape') mtsClose();
});
