/* ================= PRODUCTION FLOW · THE SCREEN =================
 * The bucket buttons across the top (each with how many lines are in it; only the buckets this account may open), and
 * the chosen bucket's list: SKU by SKU, with what that bucket is waiting for and a button to the screen where the work
 * is entered. The lines move on by themselves when that entry is made. */
let FLOW_VIEW = '';

async function ensureFlow() {
  if (!PTG.mdb) { $('flMsg').textContent = 'Reading the order book…'; await ptLoadGates(); }
  await Promise.all([flowLoad(), (typeof ensureVo === 'function' ? ensureVo().catch(() => {}) : null),
    (typeof ensureAcc === 'function' ? ensureAcc().catch(() => {}) : null)]);
  renderFlow();
}

function flowCounts(rows) {
  const n = {}; FLOW_BUCKETS.forEach(b => { n[b[0]] = 0; });
  rows.forEach(({ s, recent }) => { if (n[s.bucket] != null) n[s.bucket]++; if (recent) n.new++; });
  return n;
}
const flowDays = iso => { const d = ptIsoDate(iso); if (!d) return null; return Math.max(0, Math.round((Date.now() - new Date(d + 'T00:00:00').getTime()) / 864e5)); };
const flowLate = iso => iso && iso < dToday();

function renderFlow() {
  const allowed = flowBucketsAllowed();
  if (!allowed.length) { $('flTable').innerHTML = ''; $('flMsg').textContent = 'No bucket of the production flow is given to this account.'; return; }
  if (!allowed.some(b => b[0] === FLOW_VIEW)) FLOW_VIEW = allowed.find(b => b[0] === 'ppc') ? 'ppc' : allowed[0][0];
  const all = flowRows();
  const q = String($('flQ').value || '').trim().toLowerCase(), src = $('flSrc').value;
  const srcs = [...new Set(all.map(x => x.r.src || String(x.r.orderNo).split('-')[0]))].sort();
  ptFillSelect('flSrc', srcs.map(s => [s, s]), 'Every platform');
  const pass = x => (!src || (x.r.src || String(x.r.orderNo).split('-')[0]) === src)
    && (!q || [x.r.orderNo, x.r.sku, x.r.color, x.r.size, x.r.articleSubtype, x.r.articleType].join(' ').toLowerCase().includes(q));
  const shown = all.filter(pass), n = flowCounts(shown);
  $('flBuckets').innerHTML = allowed.map(([k, l, , tip]) => `<button class="fl-b${k === FLOW_VIEW ? ' on' : ''}" data-flb="${k}" title="${esc(tip)}">
      <span class="fl-n">${nf(n[k] || 0)}</span><span>${esc(l)}</span></button>`).join('<span class="fl-arrow">›</span>');
  const rows = FLOW_VIEW === 'new' ? shown.filter(x => x.recent) : shown.filter(x => x.s.bucket === FLOW_VIEW);
  rows.sort((a, b) => String(a.r.orderDate || '').localeCompare(String(b.r.orderDate || '')) || String(a.r.orderNo).localeCompare(String(b.r.orderNo)));
  $('flTable').innerHTML = flowTable(FLOW_VIEW, rows.slice(0, 800));
  const b = FLOW_BUCKETS.find(x => x[0] === FLOW_VIEW);
  $('flMsg').className = FLOW.err ? 'err' : 'muted';
  $('flMsg').textContent = (FLOW.err ? 'Could not read the plans: ' + FLOW.err + ' · ' : '')
    + `${b[1]}: ${nf(rows.length)} line(s) — ${b[3]}` + (rows.length > 800 ? ' · showing the oldest 800' : '')
    + ` · PPC and Demand apply to orders from ${flowFrom()} · TEST VIEW, not on the live app`;
}

const FLOW_GO = { vendor: ['vreq', 'Vendor requests'], fabric: ['vlog', 'History (accept)'], cut: ['pcut', 'Cutting'], raw: ['pbase', 'Job Work (issue)'],
  wip: ['qc', 'QC'], ready: ['fgi', 'Finished Goods'] };

function flowTable(view, rows) {
  const pic = sku => { const u = typeof ptImgOf === 'function' ? ptImgOf(sku) : ''; return u ? `<img src="${esc(ptImgSrc(u, 34))}" alt="" style="width:34px;height:34px;object-fit:contain;background:#fff;border-radius:5px">` : ''; };
  const base = x => `<td class="frz" style="text-align:left"><a href="#" data-ordj="${esc(x.r.orderNo)}" style="font-weight:600">${esc(x.r.orderNo)}</a>
      <div class="muted" style="font-size:10.5px">${esc(x.r.src || '')} · ${esc(ptIsoDate(x.r.orderDate) || '')} · ${nf(flowDays(x.r.orderDate) || 0)} d</div></td>
    <td style="text-align:left;white-space:nowrap">${pic(x.r.sku)} <b style="font-family:ui-monospace,monospace;vertical-align:top">${esc(x.r.sku)}</b>
      <div class="muted" style="font-size:10.5px">${esc([x.r.articleSubtype || x.r.articleType, x.r.color, x.r.size].filter(Boolean).join(' · '))}</div></td>
    <td class="num"><b>${nf(x.r.qty)}</b></td>`;
  const go = view => FLOW_GO[view] ? `<button class="ghost" data-flgo="${FLOW_GO[view][0]}" style="width:auto;padding:2px 9px;font-size:11.5px">${FLOW_GO[view][1]} →</button>` : '';
  const prog = (d, of) => `<span class="jw-st ${d >= of ? 'done' : d > 0 ? 'prog' : 'pend'}">${nf(d)} / ${nf(of)}</span>`;
  const due = (iso, label) => iso ? `<div class="muted" style="font-size:10.5px${flowLate(iso) ? ';color:#b91c1c;font-weight:600' : ''}">${label} ${esc(iso.slice(5))}${flowLate(iso) ? ' · late' : ''}</div>` : '';
  let head = '', body = '';
  if (view === 'new') {
    head = ['PO', 'SKU', 'Qty', 'Now in'];
    body = rows.map(x => `<tr>${base(x)}<td style="text-align:left">${esc((FLOW_BUCKETS.find(b => b[0] === x.s.bucket) || [, x.s.bucket === 'done' ? 'Done' : x.s.bucket])[1])}</td></tr>`).join('');
  } else if (view === 'ppc') {
    head = ['PO', 'SKU', 'Qty', 'What the plan will hold', ''];
    const seen = new Set();
    body = rows.map(x => { const sg = flowSuggest(x.r), first = !seen.has(x.r.orderNo); seen.add(x.r.orderNo);
      return `<tr>${base(x)}<td style="text-align:left;font-size:12px">${esc(sg.fabric.name || '?')} ${sg.fabric.metres ? nf(sg.fabric.metres) + ' m' : '<b style="color:#b91c1c">metres not known</b>'}
        · ${sg.print.need ? 'printed' : 'not printed'}${sg.acc.length ? ' · ' + sg.acc.map(a => esc(a.code) + '×' + nf(a.qty)).join(', ') : ''}
        ${sg.gaps.length ? `<div style="font-size:10.5px;color:#92400e">${esc(sg.gaps[0])}${sg.gaps.length > 1 ? ' (+' + (sg.gaps.length - 1) + ')' : ''}</div>` : ''}</td>
        <td style="white-space:nowrap">${first ? `<button data-flppc="${esc(x.r.orderNo)}" style="width:auto;padding:3px 10px;font-size:12px">Plan this PO</button>` : ''}
          <button class="ghost" data-flppc="${esc(x.r.orderNo)}" data-sku="${esc(x.r.sku)}" style="width:auto;padding:2px 8px;font-size:11.5px">This line</button></td></tr>`; }).join('');
  } else if (view === 'demand') {
    head = ['PO', 'SKU', 'Qty', 'Fabric', 'Accessories', ''];
    const free = flowAccFree();
    body = rows.map(x => { const p = x.s.plan || {}, fr = x.s.demand && x.s.demand.fabricReady;
      const acc = (p.acc || []).filter(a => a.code && +a.qty > 0);
      const accCell = !acc.length ? '<span class="muted">none</span>' : x.s.res
        ? `<span class="jw-st done">reserved</span> <span class="muted" style="font-size:11px">${acc.map(a => esc(a.code) + '×' + nf(a.qty)).join(', ')}</span>`
        : acc.map(a => { const f = free[accCode(a.code)]; const ok = f && f.free >= a.qty;
            return `<div style="font-size:12px">${esc(a.code)} × ${nf(a.qty)} <span style="color:${ok ? '#166534' : '#b91c1c'};font-weight:600">${f ? nf(Math.max(0, f.free)) + ' free' : 'not on the shelf'}${ok ? '' : ' · short ' + nf(a.qty - Math.max(0, f ? f.free : 0))}</span></div>`; }).join('');
      return `<tr>${base(x)}
        <td style="text-align:left;font-size:12px">${p.fabric ? `${esc(p.fabric.name)} · ${nf(p.fabric.metres)} m` : '—'}<br>
          ${fr ? `<span class="jw-st done">ready</span> <span class="muted" style="font-size:10.5px">${esc(String(fr.by || '').split('@')[0])} ${esc(String(fr.at || '').slice(5, 10))}${fr.note ? ' · ' + esc(fr.note) : ''}</span>`
            : `<button class="ghost" data-flfab="${esc(x.s.key)}" style="width:auto;padding:2px 9px;font-size:11.5px">Mark fabric ready</button>`}</td>
        <td style="text-align:left">${accCell}</td>
        <td>${acc.length ? (x.s.res ? `<button class="ghost" data-flunres="${esc(x.s.key)}" style="width:auto;padding:2px 8px;font-size:11.5px">Release</button>`
            : `<button data-flres="${esc(x.s.key)}" style="width:auto;padding:3px 10px;font-size:12px">Reserve</button>`) : ''}</td></tr>`; }).join('');
  } else if (view === 'vendor') {
    head = ['PO', 'SKU', 'Qty', 'Given to a printer', ''];
    body = rows.map(x => `<tr>${base(x)}<td class="num">${prog(x.s.given, +x.r.qty)}</td><td>${go(view)}</td></tr>`).join('');
  } else if (view === 'fabric') {
    head = ['PO', 'SKU', 'Qty', 'Back and accepted', ''];
    body = rows.map(x => `<tr>${base(x)}<td class="num">${prog(x.s.back, x.s.given || +x.r.qty)}</td><td>${go(view)}</td></tr>`).join('');
  } else if (view === 'cut') {
    head = ['PO', 'SKU', 'Qty', 'Cut', ''];
    body = rows.map(x => `<tr>${base(x)}<td class="num">${prog(x.s.cut, +x.r.qty)}${due(x.s.plan && x.s.plan.dates && x.s.plan.dates.cut, 'plan')}</td><td>${go(view)}</td></tr>`).join('');
  } else if (view === 'raw') {
    head = ['PO', 'SKU', 'Qty', 'In store, to issue', 'Issued', ''];
    body = rows.map(x => { const avail = x.r.cutReq ? x.s.cut : (x.s.printed ? x.s.back : +x.r.qty);
      return `<tr>${base(x)}<td class="num"><b>${nf(Math.max(0, avail - x.s.issued))}</b></td><td class="num">${prog(x.s.issued, +x.r.qty)}</td><td>${go(view)}</td></tr>`; }).join('');
  } else if (view === 'wip') {
    head = ['PO', 'SKU', 'Qty', 'Issued', 'Received', 'QC passed', ''];
    body = rows.map(x => `<tr>${base(x)}<td class="num">${nf(x.s.issued)}</td><td class="num">${nf(x.s.received)}</td>
      <td class="num">${prog(x.s.made, +x.r.qty)}${due(x.s.plan && x.s.plan.dates && x.s.plan.dates.qc, 'plan')}</td><td>${go(view)}</td></tr>`).join('');
  } else if (view === 'ready') {
    head = ['PO', 'SKU', 'Qty', 'Made', 'In India stock', ''];
    body = rows.map(x => `<tr>${base(x)}<td class="num">${nf(x.s.made)}</td><td class="num">${prog(x.s.india, +x.r.qty)}${due(x.s.plan && x.s.plan.dates && x.s.plan.dates.ready, 'plan')}</td>
      <td>${ordIsMto(x.r.orderNo) ? '<button class="ghost" data-flgo="ord" style="width:auto;padding:2px 9px;font-size:11.5px">Order Console (hand over) →</button>' : go(view)}</td></tr>`).join('');
  }
  return '<thead><tr>' + head.map((h, i) => `<th${i === 0 ? ' class="frz" style="text-align:left"' : i === 1 ? ' style="text-align:left"' : ''}>${esc(h)}</th>`).join('') + '</tr></thead><tbody>'
    + (body || `<tr><td colspan="${head.length}" class="muted" style="padding:16px">Nothing in this bucket.</td></tr>`) + '</tbody>';
}

/* ---- wiring ---- */
$('flBuckets').addEventListener('click', e => { const b = e.target.closest('[data-flb]'); if (!b) return; FLOW_VIEW = b.dataset.flb; renderFlow(); });
$('flQ').addEventListener('input', () => { clearTimeout(FLOW.qt); FLOW.qt = setTimeout(renderFlow, 220); });
$('flSrc').addEventListener('change', renderFlow);
$('flRefresh').onclick = async () => { $('flMsg').textContent = 'Reading again…'; await Promise.all([ptLoadGates(true), flowLoad(true)]); renderFlow(); };
$('flTable').addEventListener('click', async e => {
  const oj = e.target.closest('[data-ordj]');
  if (oj) { e.preventDefault(); try { ordJourney(oj.getAttribute('data-ordj')); } catch (err) { /* the order book is not read yet */ } return; }
  const g = e.target.closest('[data-flgo]'); if (g) { showTab(g.dataset.flgo); return; }
  const pp = e.target.closest('[data-flppc]'); if (pp) { flowPpcOpen(pp.dataset.flppc, pp.dataset.sku || ''); return; }
  const key = (e.target.closest('[data-flfab],[data-flres],[data-flunres]') || {}).dataset;
  if (!key) return;
  const x = flowRows().find(y => y.s.key === (key.flfab || key.flres || key.flunres)); if (!x) return;
  if (key.flfab) return flowFabricOpen(x.r, x.s);
  const err = key.flres ? await flowReserve(x.r, x.s) : await flowUnreserve(x.s);
  $('flMsg').className = err ? 'err' : 'muted';
  if (err) $('flMsg').textContent = err; else renderFlow();
});
/* The menu button shows only where the flow is switched on, and only to an account with a bucket. */
function flowNavShow() { if ($('tabFlow')) $('tabFlow').style.display = FLOW_ON && flowBucketsAllowed().length ? '' : 'none'; }
