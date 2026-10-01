/* ================= PRODUCTION ANALYSIS & KARIGAR ANALYSIS =================
 *
 * Ravi: "mujhe mera production 20000 per week par lekr jana h and is week me jo production hua h wo
 * arround 12000 pcs ka hua h which is very low, to tum ek production analysis tab banao ki meri kami
 * kaha h, m production 20k tak kyo nahi pahucha pa rha hu and kese pahucha sakta hu. And ... karigar
 * ka bhi kar dena jisase apan karigar ka detail check kar sake."
 *
 * PRODUCTION is what came back from the karigars — received pieces in the Job Work Register, dated by
 * the receiving date. The same figure the weekly report uses, so the two screens cannot disagree.
 *
 * Everything here is READ from registers that already exist — Job Work Register, Cutting Data, Press
 * Inventory, the employee list, the rate list and attendance. Nothing is typed in, nothing is saved,
 * except the target itself, which lives in this browser.
 */
let PA = { busy: false, at: '', err: '', pick: '', team: null };
let KA = { pick: '' };
const PA_DAY = 864e5;
const PA_TARGET_KEY = 'paTarget';
function paTarget() {
  let v = 0;
  try { v = parseInt(localStorage.getItem(PA_TARGET_KEY), 10); } catch (e) { /* storage may be blocked */ }
  return v > 0 ? v : 20000;
}
const paIsKarigar = dept => /stitch/i.test(String(dept || ''));
const paN = s => String(s == null ? '' : s).trim().toLowerCase();
const paMedian = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const paQuant = (a, q) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const paWkStartMs = iso => { const p = String(iso).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).getTime(); };
const paDayIso = ms => repWkIso(new Date(ms));

async function ensurePa() {
  if (PA.busy) return;
  const need = !PTG.mdb || !PT.base || !PTE.emp || HR.rate === null || ATT.rows === null || PA.team === null || !KA.levels;
  if (need) {
    PA.busy = true; renderPa(); renderKa();
    try {
      await ptLoadGates();
      if (!PTE.emp) await ptLoadEmp();
      if (HR.rate === null) HR.rate = ptList(await ptGet('pt_rateList')).map(hrRow).filter(x => x.length && x[1]);
      if (ATT.rows === null) { ATT.rows = ptList(await ptGet('pt_attend')); ATT.at = ptStamp(); }
      if (PA.team === null) PA.team = (await ptGet('pt_teamSize')) || {};
      if (!KA.levels) KA.levels = (await ptGet('pt_articleLevel')) || {};
      /* Its own try: a refused read means no targets, never a Karigar screen that will not open. */
      if (!KA.targets) { try { KA.targets = (await ptGet('pt_kaTargets')) || {}; } catch (e) { KA.targets = {}; } }
      /* The delivery log is where printer capacity actually lives. */
      if (!VO.rows) {
        const raw = (await ptGet('pt_vendorOrders')) || {};
        VO.rows = [];
        Object.entries(raw).forEach(([code, orders]) => Object.values(orders || {})
          .forEach(o => { if (o) VO.rows.push(Object.assign({ vendorCode: code }, o)); }));
      }
      PA.err = PTG.err || '';
    } catch (e) { PA.err = e.message || String(e); }
    PA.busy = false; PA.at = ptStamp();
  }
  renderPa(); renderKa();
}
async function paRefresh() {
  PA.busy = true; renderPa(); renderKa();
  try {
    await ptLoadGates(true);
    await ptLoadEmp(true);
    HR.rate = ptList(await ptGet('pt_rateList')).map(hrRow).filter(x => x.length && x[1]);
    ATT.rows = ptList(await ptGet('pt_attend')); ATT.at = ptStamp();
    PA.team = (await ptGet('pt_teamSize')) || {};
    KA.levels = (await ptGet('pt_articleLevel')) || {};
    try { KA.targets = (await ptGet('pt_kaTargets')) || {}; } catch (e) { KA.targets = {}; }
    PA.err = PTG.err || '';
  } catch (e) { PA.err = e.message || String(e); }
  PA.busy = false; PA.at = ptStamp();
  renderPa(); renderKa();
}

/**
 * Every person on the employee list, by name: type and department.
 *
 * SOME PEOPLE ARE ON THE LIST TWICE — Vikas Mahawar as a stitching contractor and in the store,
 * Prakash Mahawar stitching and pressing. Keeping only one line made a karigar vanish from the
 * karigars. A stitching line wins; the other role is kept, so a karigar with no stitching all week
 * can be seen to have been pressing instead.
 */
function paRoster() {
  const m = new Map();
  (PTE.emp || []).forEach(e => {
    if (!e || !e[1]) return;
    const k = paN(e[1]), p = { name: String(e[1]).trim(), type: String(e[0] || '').trim(), dept: String(e[2] || '').trim(), also: [] };
    const was = m.get(k);
    if (!was) { m.set(k, p); return; }
    const keepNew = paIsKarigar(p.dept) && !paIsKarigar(was.dept);
    const win = keepNew ? p : was, lose = keepNew ? was : p;
    win.also = [...new Set((was.also || []).concat(lose.dept && lose.dept !== win.dept ? [lose.dept] : []))];
    m.set(k, win);
  });
  return m;
}

/**
 * THE FACTORY'S WEEK RUNS MONDAY TO SUNDAY. Ravi's "6,200 cut this week" is Mon 7 – Sun 13 Sep, and
 * a Sunday-to-Saturday week put that Sunday's 2,366 cut pieces in the next week — so this screen said
 * 3,904 against the 6,270 in Cutting Data. Reports keeps the old tool's Sunday week; this screen asks
 * a different question, in the factory's own terms.
 */
const paWeekStart = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
/** Salaried staff are paid by the month, and their work is not written into the Job Work Register. */
const paIsSalaried = type => /company role/i.test(String(type || ''));

/** Monday-starting weeks that hold any work, oldest first, and the week we are in. */
function paWeeks() {
  const set = new Set();
  const add = s => { const ms = ptDtMs(s); if (ms) set.add(repWkIso(paWeekStart(ms))); };
  (PT.base || []).forEach(r => { if (r) { add(r.issueDate); add(r.receivingDate); } });
  (PT.cut || []).forEach(r => r && add(r.cutDate));
  set.add(repWkIso(paWeekStart(Date.now())));
  return [...set].sort();
}

/** The labour value of pieces, at the rate list's piece rate. 0 where no rate is set. */
function paValue(r, pcs, type) {
  /* The type written on the row is the one payroll pays it at. */
  return pcs * (rateFor(r.articleType, r.articleSubtype, r.size, r.empType || type) || 0);
}

/**
 * Everything about one week, from the registers.
 *
 * Returns the flow (cut → issued → received → pressed), the people (who worked, who got nothing), and
 * the day-by-day picture — including karigar-days on which a karigar had nothing in hand, which is
 * work the factory could have done and did not.
 */
function paWeekFacts(wkIso, nowMs) {
  const from = paWkStartMs(wkIso), to = from + 7 * PA_DAY;
  const now = nowMs || Date.now();
  const roster = paRoster();
  const base = (PT.base || []).filter(Boolean);
  const inWk = ms => ms && ms >= from && ms < to;
  const days = [];
  for (let i = 0; i < 7; i++) days.push({ ms: from + i * PA_DAY, iso: paDayIso(from + i * PA_DAY), cut: 0, issued: 0, received: 0, pressed: 0, present: 0 });
  const dayOf = ms => days[Math.floor((ms - from) / PA_DAY)];

  let received = 0, issued = 0, rejected = 0, cut = 0, pressed = 0, value = 0, noRate = 0, undated = 0;
  const who = new Map();          // name key → { name, received, issued, rejected, value, recvDays:Set }
  const person = r => {
    const k = paN(r.empName);
    if (!who.has(k)) {
      const ro = roster.get(k);
      who.set(k, { key: k, name: ro ? ro.name : String(r.empName || '').trim(), type: ro ? ro.type : String(r.empType || ''),
        dept: ro ? ro.dept : '', received: 0, issued: 0, rejected: 0, value: 0, recvDays: new Set(), turn: [] });
    }
    return who.get(k);
  };
  const turn = [], byArt = {};
  base.forEach(r => {
    const im = ptDtMs(r.issueDate), rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0;
    if (inWk(im)) { const p = ptNum(r.issuePieces); issued += p; dayOf(im).issued += p; person(r).issued += p; }
    const got = ptNum(r.receivedPieces);
    if (got > 0 && !rm && inWk(im)) undated += got;
    if (inWk(rm) && got > 0) {
      const w = person(r), v = paValue(r, got, w.type);
      received += got; dayOf(rm).received += got; w.received += got; w.recvDays.add(paDayIso(rm));
      w.rejected += ptNum(r.rejectionPieces); rejected += ptNum(r.rejectionPieces);
      value += v; w.value += v; if (!v) noRate += got;
      const at = String(r.articleType || '').trim() || '(unknown)';
      byArt[at] = (byArt[at] || 0) + got;
      if (im && rm >= im) { const d = (rm - im) / PA_DAY; turn.push(d); w.turn.push(d); }
    }
  });
  (PT.cut || []).forEach(r => { const ms = r && ptDtMs(r.cutDate); if (inWk(ms)) { const p = ptNum(r.pieces); cut += p; dayOf(ms).cut += p; } });
  (PTG.press || []).forEach(r => { const ms = r && ptDtMs(r.entryDate); if (inWk(ms)) { const p = ptNum(r.pieces); pressed += p; dayOf(ms).pressed += p; } });

  /* THE DAYS THE FACTORY WORKED: any cutting, issue or receipt at all. A day nobody touched the
   * registers is a day off, and is not held against anybody. Days still to come are not counted. */
  const workDays = days.filter(d => d.ms <= now && (d.cut + d.issued + d.received) > 0);

  /* THE KARIGARS: piece-rate people in a stitching department. Company Role stitchers are salaried
   * and nothing they make is written into the Job Work Register — counting them as karigars who
   * "got no work" blamed the floor for people whose output is simply not recorded. */
  const stitchers = [...roster.values()].filter(p => paIsKarigar(p.dept));
  const salaried = stitchers.filter(p => paIsSalaried(p.type));
  const karigars = stitchers.filter(p => !paIsSalaried(p.type));
  const activeKeys = new Set([...who.values()].filter(w => w.issued > 0 || w.received > 0).map(w => w.key));
  const rowsOf = new Map();
  base.forEach(r => { const k = paN(r.empName); (rowsOf.get(k) || rowsOf.set(k, []).get(k)).push(r); });
  /* NOT WORKING IS THREE DIFFERENT THINGS.
   *  · given nothing, though they were working in the weeks before — they need work;
   *  · sitting on pieces from before and returning none — they need a phone call;
   *  · no entry at all in the four weeks before — probably not with the factory any more, and the
   *    list needs cleaning, not the floor. */
  const heldAtStart = p => (rowsOf.get(paN(p.name)) || []).filter(r => {
    const im = ptDtMs(r.issueDate), rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0;
    return im && im < from && (!rm || rm >= from);
  }).reduce((a, r) => a + ptNum(r.issuePieces), 0);
  const recentlyWorked = p => (rowsOf.get(paN(p.name)) || []).some(r => {
    const im = ptDtMs(r.issueDate), rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0;
    return (im >= from - 28 * PA_DAY && im < from) || (rm >= from - 28 * PA_DAY && rm < from);
  });
  const notWorking = karigars.filter(p => !activeKeys.has(paN(p.name))).map(p => Object.assign({}, p, { held: heldAtStart(p) }));
  const stuck = notWorking.filter(p => p.held > 0).sort((a, b) => b.held - a.held);
  const idle = notWorking.filter(p => !p.held && recentlyWorked(p));
  const dormant = notWorking.filter(p => !p.held && !recentlyWorked(p));
  const recvPer = [...who.values()].filter(w => w.received > 0 && paIsKarigar(w.dept) && !paIsSalaried(w.type)).map(w => w.received);
  const med = paMedian(recvPer), p75 = paQuant(recvPer, 0.75);
  const liftMedian = recvPer.filter(v => v < med).reduce((a, v) => a + (med - v), 0);
  const liftP75 = recvPer.filter(v => v < p75).reduce((a, v) => a + (p75 - v), 0);
  const top = [...who.values()].sort((a, b) => b.received - a.received)[0] || null;

  /* ATTENDANCE, where it was marked: who was present on a working day. */
  const att = (ATT.rows || []).filter(a => a && a.day && a.status !== 'A' && paIsKarigar(a.dept || (roster.get(paN(a.empName)) || {}).dept));
  const presentOn = new Map();
  att.forEach(a => { const ms = paWkStartMs(a.day); if (inWk(ms)) { (presentOn.get(a.day) || presentOn.set(a.day, new Set()).get(a.day)).add(paN(a.empName)); dayOf(ms).present++; } });
  const attDays = workDays.filter(d => presentOn.has(d.iso)).length;

  /* EMPTY-HANDED DAYS. For every karigar who worked this week, every working day on which they had
   * nothing issued and not yet returned, and were given nothing that day. Pieces out are counted from
   * the issue date until the row closed. */
  const emptyBy = new Map();
  let emptyDays = 0, presentEmpty = 0;
  karigars.filter(p => activeKeys.has(paN(p.name))).forEach(p => {
    const rows = rowsOf.get(paN(p.name)) || [];
    workDays.forEach(d => {
      const start = d.ms, end = d.ms + PA_DAY;
      const inHand = rows.some(r => { const im = ptDtMs(r.issueDate), rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0; return im && im < start && (!rm || rm >= start); });
      const given = rows.some(r => { const im = ptDtMs(r.issueDate); return im >= start && im < end; });
      if (!inHand && !given) {
        emptyDays++; emptyBy.set(p.name, (emptyBy.get(p.name) || 0) + 1);
        if (presentOn.has(d.iso) && presentOn.get(d.iso).has(paN(p.name))) presentEmpty++;
      }
    });
  });

  /* DAYS WITH WORK AND PEOPLE, PER NAME. A karigar-day is one person on a working day on which the
   * name had pieces in hand or was given some — the nearest thing to "was working" until attendance
   * is marked. A team counts every person in it. */
  who.forEach(w => {
    const rows = rowsOf.get(w.key) || [];
    w.days = workDays.filter(d => rows.some(r => {
      const im = ptDtMs(r.issueDate), rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0;
      return im && im < d.ms + PA_DAY && (!rm || rm >= d.ms);
    })).length;
    w.people = paTeamSize(w.key, from);
    w.personDays = w.people * w.days;
  });
  /* COMPANY CONTRACTORS are whose average a karigar is measured by; external teams are counted
   * separately, each at their own per-person pace. */
  const working = [...who.values()].filter(w => w.received > 0 || w.issued > 0);
  const ccList = working.filter(w => /company contractor/i.test(w.type));
  const ext = working.filter(w => /external contractor/i.test(w.type));
  const ccPcs = ccList.reduce((a, w) => a + w.received, 0);
  const ccPersonDays = ccList.reduce((a, w) => a + w.personDays, 0);
  const ccPeople = ccList.reduce((a, w) => a + w.people, 0);

  /* WORK LEFT WITH KARIGARS at the end of the week, and how much of it is old. */
  const endMs = Math.min(to, now);
  let wip = 0, wipOld = 0;
  base.forEach(r => {
    const im = ptDtMs(r.issueDate), rm = r.receivingDate ? ptDtMs(r.receivingDate) : 0;
    if (!im || im >= endMs || (rm && rm < endMs)) return;
    const p = ptNum(r.issuePieces); wip += p;
    if (endMs - im > 3 * PA_DAY) wipOld += p;
  });

  return {
    wk: wkIso, from, to, days, workDays: workDays.length, received, issued, rejected, cut, pressed, value, noRate, undated,
    people: [...who.values()], karigars: karigars.length, active: karigars.filter(p => activeKeys.has(paN(p.name))).length,
    idle, stuck, dormant, salaried, med, p75, liftMedian, liftP75, top, turnMedian: paMedian(turn), byArt,
    emptyDays, emptyBy: [...emptyBy.entries()].sort((a, b) => b[1] - a[1]), presentEmpty, attDays,
    wip, wipOld, partial: to > now, ccList, ccPcs, ccPersonDays, ccPeople, ext,
  };
}

function paWeekLabel(iso) {
  const a = new Date(paWkStartMs(iso)), b = new Date(paWkStartMs(iso) + 6 * PA_DAY);
  const f = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return f(a) + ' – ' + f(b);
}

/* ---------- TEAMS: how many people work under one name ----------
 *
 * Ravi: "Pradeep Contractor external contractor h, uske pas 20 bande h ... is week me 25 kareegar
 * uske pas kam karenge" and "Manish Khuswaha, Binod dono partnership me work krte h, wo do karigar ek
 * name me mal jama karte h or lete h." A name in the Job Work Register is not always one person, and
 * a per-karigar average that counts a team of twenty as one karigar is wrong by twenty times.
 *
 * pt_teamSize/<name key> = { name, sizes: [{ n, from: 'YYYY-MM-DD', by, at }] }. A size applies from
 * its date onwards, so when a team grows the weeks before keep the size they really had. A name with
 * no record is one person.
 */
const paTeamKey = s => paN(s).replace(/[.$#\[\]\/]/g, '_');
function paTeamSizes(key) {
  const rec = (PA.team || {})[paTeamKey(key)];
  const list = rec ? (Array.isArray(rec.sizes) ? rec.sizes : Object.values(rec.sizes || {})) : [];
  return list.filter(s => s && /^\d{4}-\d{2}-\d{2}$/.test(String(s.from)) && parseInt(s.n, 10) > 0)
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}
function paTeamSize(key, ms) {
  const day = paDayIso(ms || Date.now());
  const hit = paTeamSizes(key).filter(s => s.from <= day).pop();
  return hit ? parseInt(hit.n, 10) : 1;
}
async function paTeamSave(name, n, from) {
  if (!ptCanEdit()) return PT_NO_EDIT;
  const people = parseInt(n, 10);
  if (!(people >= 1 && people <= 500) || String(people) !== String(n).trim()) return 'How many people work under this name? A whole number, 1 or more.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))) return 'From which date does this apply?';
  const key = paTeamKey(name);
  if (!key) return 'Which name?';
  const sizes = paTeamSizes(key).filter(s => s.from !== from)
    .concat([{ n: people, from, by: ME.email, at: new Date().toISOString() }])
    .sort((a, b) => (a.from < b.from ? -1 : 1));
  const rec = { name: String(name).trim(), sizes };
  try { await ptPut('pt_teamSize/' + key, rec); }
  catch (e) { return 'Not saved: ' + (e.message || e); }
  PA.team = Object.assign({}, PA.team || {}, { [key]: rec });
  renderPa(); renderKa();
  return '';
}
function paTeamOpen(key) {
  const ro = paRoster().get(key);
  const row = (PT.base || []).find(r => r && paN(r.empName) === key);
  const name = ro ? ro.name : (row ? String(row.empName).trim() : key);
  const hist = paTeamSizes(key);
  ptOpenDialog({
    title: 'People working under ' + name,
    subtitle: hist.length ? 'So far: ' + hist.map(s => `${s.n} from ${s.from}`).join(' · ') : 'Counted as one person until now.',
    note: 'Some names are a team — a contractor with his own people, or two karigars who take and return work under one name. '
      + 'Their pieces are shared across this many people when the per-karigar average is worked out. '
      + 'A change applies from the date given, so earlier weeks keep the size they had.',
    fields: [
      { key: 'n', label: 'People', type: 'number', value: paTeamSize(key, Date.now()) },
      { key: 'from', label: 'From', type: 'date', value: repWkIso(paWeekStart(Date.now())) },
    ],
    onSave: v => paTeamSave(name, v.n, v.from),
    saveLabel: 'Save',
  });
}

/**
 * What one karigar makes in a day — company contractors only, the people whose pieces are theirs.
 *
 * Pieces made ÷ karigar-days, where a karigar-day is one person on one working day that had work in
 * hand. From the chosen week, or pooled over the last four weeks up to it.
 */
function paAvgBase(f, basis) {
  if (basis !== '4w') {
    return { avg: f.ccPersonDays ? f.ccPcs / f.ccPersonDays : 0, pcs: f.ccPcs, personDays: f.ccPersonDays, weeks: 1, label: 'this week',
      extPer: new Map(f.ext.map(x => [x.key, x.personDays ? x.received / x.personDays : 0])) };
  }
  const weeks = paWeeks().filter(w => w <= f.wk).slice(-4);
  let pcs = 0, pd = 0;
  const ext = new Map();
  weeks.forEach(w => {
    const t = w === f.wk ? f : paWeekFacts(w);
    pcs += t.ccPcs; pd += t.ccPersonDays;
    t.ext.forEach(x => { const e = ext.get(x.key) || { pcs: 0, pd: 0 }; e.pcs += x.received; e.pd += x.personDays; ext.set(x.key, e); });
  });
  return { avg: pd ? pcs / pd : 0, pcs, personDays: pd, weeks: weeks.length, label: `the last ${weeks.length} week(s)`,
    extPer: new Map([...ext].map(([k, e]) => [k, e.pd ? e.pcs / e.pd : 0])) };
}

/**
 * How many company contractors the target needs — from the per-day average, nothing else.
 *
 *   per karigar a week  = average per karigar per day × 6 working days
 *   external teams make = their people (as of the week after this one) × their own per-person-day × 6
 *   karigars needed     = (target − external teams) ÷ per karigar a week
 */
function paNeed(f, target, base) {
  const W = 6;
  const perWeek = base.avg * W;
  const ext = f.ext.map(x => {
    const per = base.extPer.has(x.key) ? base.extPer.get(x.key) : (x.personDays ? x.received / x.personDays : 0);
    const peopleNext = paTeamSize(x.key, f.to);
    return { key: x.key, name: x.name, per, peopleNext, out: Math.round(peopleNext * per * W) };
  });
  const extOut = ext.reduce((a, x) => a + x.out, 0);
  const fromCC = Math.max(0, target - extOut);
  const need = perWeek > 0 ? Math.ceil(fromCC / perWeek) : 0;
  const have = f.ccPeople;
  return { W, avg: base.avg, perWeek, ext, extOut, fromCC, need, have, diff: need - have,
    perDayToHit: have ? fromCC / (have * W) : 0 };
}

/** The one sentence the week comes down to — in karigars, from the per-day average. */
function paVerdict(f, need, target) {
  const gap = target - f.received;
  const avg = need.avg.toFixed(1);
  if (gap <= 0) {
    return { key: 'reached', head: `${nf(-gap)} above target`,
      why: `${nf(need.have)} company contractor(s) worked; at ${avg} pieces a day ${nf(need.need)} are enough for ${nf(target)}.` };
  }
  if (need.diff > 0) {
    return { key: 'hire', head: `${nf(need.diff)} more karigar(s) needed`,
      why: `One company contractor makes ${avg} pieces a day. ${nf(target)} needs ${nf(need.need)} of them working; ${nf(need.have)} worked this week.`
        + (f.dormant.length ? ` ${nf(f.dormant.length)} contractor(s) on your list have had no work for a month — start with them.` : '') };
  }
  return { key: 'output', head: 'Enough karigars — not enough pieces a day',
    why: `${nf(need.have)} worked and ${nf(need.need)} are enough at ${avg} a day, but this week fell short. To reach ${nf(target)} with them, each needs ${need.perDayToHit.toFixed(1)} a day.` };
}

