/* ==== DATA METER ====
 * (Step 0 of docs/data-reduction/PLAN.md, 2026-11-05.) Before any step that cuts what the app downloads, we need the
 * real numbers: which screen pulls which register, how many times, how many KB, and how many tabs a person keeps open.
 *
 * With the meter ON, each browser adds up what it reads from the database, by screen and by register (the first part of
 * the path, e.g. pt_orderBook), and saves one small line a day to pt_dataMeter/<day>/<email>/<device>. Nothing a user
 * sees changes. With the meter OFF (the default) every hook below costs one cheap check and does nothing else.
 *
 * THE SWITCH: localStorage dataMeter = '0' is off whatever the flag says; '1' is on; anything else follows the flag
 * config/flags.dataMeter, whose last answer core/auth.js keeps in localStorage dmFlagLast (so the NEXT page load counts
 * from its first read). Always off for a vendor account and in the test harnesses (AUDIT_OFF), as the Delta Sync shadow.
 *
 * HOW A READ IS COUNTED ("how"): plain = a normal read; live-first = the first full copy of a register the live
 * connection brings; live-change = a row that changed later; from-copy = a screen served from the live copy (0 KB);
 * delta-shadow = the Delta Sync background checks. Sizes are the characters of the text received (a Hindi letter counts
 * as one, though it travels as three bytes, so non-English text reads slightly LOW; changed rows read slightly HIGH).
 *
 * NOT COUNTED (named in each daily line, so a missing number is never mistaken for a zero): save-answers (the database
 * echoes back what a save sent), server-clock and connection-flag (a few bytes each), and delta-phase3-copy when Delta
 * Sync phase 3 is switched on.
 *
 * EVERY meter error goes to the console only. Nothing is thrown and nothing is written because of one: a failing
 * meter leaves the read or the save exactly as it was before it existed. */
const DM = { tab: '', day: '', T: {}, rl: 0, ra: 0, rb: 0, pk: 1, dirty: false, started: false, sendSet: false };
const DM_GIVE_UP_DAYS = 7;
const dmWarn = e => { try { console.warn('[data meter]', e); } catch (x) { /* nowhere to say it */ } };
const dmDay = () => new Date().toISOString().slice(0, 10);
const dmLsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const dmLsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { dmWarn(e); } };
const dmLsDel = k => { try { localStorage.removeItem(k); } catch (e) { /* gone already */ } };
function dmKeys(prefix) {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(prefix) === 0) out.push(k); } } catch (e) { /* no storage */ }
  return out;
}
const dmParse = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };

/** On or off. Cheap: a couple of storage reads, no network. */
function dmOn() {
  try {
    const s = localStorage.getItem('dataMeter');
    if (s === '0') return false;
    if (typeof AUDIT === 'undefined' || !AUDIT.on) return false;
    if (typeof spIsVendor === 'function' && spIsVendor()) return false;
    if (s === '1') return true;
    return localStorage.getItem('dmFlagLast') === '1';
  } catch (e) { return false; }
}

/* ---- the tally: screen x register x { reads, characters, how } ---- */
const dmReg = node => String(node || '').split('?')[0].split('/').filter(Boolean)[0] || '(root)';
function dmPage() { try { return (typeof TAB_NOW !== 'undefined' && TAB_NOW) || '(start)'; } catch (e) { return '(start)'; } }
function dmInit() {
  if (DM.started) return;
  DM.started = true;
  let tab = '';
  try { tab = sessionStorage.getItem('dmTab') || ''; if (tab && Date.now() - (Number(dmLsGet('dm:hb:' + tab)) || 0) < 75000) tab = ''; /* a duplicated tab: another open tab holds this id */ if (!tab) { tab = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); sessionStorage.setItem('dmTab', tab); } } catch (e) { /* no session storage */ }
  if (!tab) tab = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  DM.tab = tab; DM.day = dmDay();
  /* A reload keeps the tab: carry on from what this tab saved earlier today, and count the reload. */
  const old = dmParse(dmLsGet('dm:t:' + DM.day + ':' + DM.tab));
  if (old && old.pages) { DM.T = old.pages; DM.rl = old.rl || 0; DM.ra = old.ra || 0; DM.rb = old.rb || 0; DM.pk = old.pk || 1; }
  try { const nav = performance.getEntriesByType('navigation')[0]; if (nav && nav.type === 'reload') { DM.rl++; DM.dirty = true;
    /* appv.js tags a reload it caused itself: 'auto' = the app took in a new version on its own, 'bar' = someone clicked the red bar. The tag is read once and removed, so an F5 later is not mistaken for it. */
    let why = ''; try { why = sessionStorage.getItem('appvAuto') || ''; sessionStorage.removeItem('appvAuto'); } catch (e) { /* no session storage */ }
    if (why === 'auto') DM.ra++; else if (why === 'bar') DM.rb++; } } catch (e) { /* not known */ }
  try {
    const tick = setInterval(dmTick, 30000);
    if (tick && typeof tick.unref === 'function') tick.unref();
    if (typeof addEventListener === 'function') addEventListener('pagehide', dmPageHide);
  } catch (e) { dmWarn(e); }
  dmTick();
}
function dmAdd(page, reg, chars, how) {
  const P = DM.T[page] || (DM.T[page] = {});
  const N = P[reg] || (P[reg] = { n: 0, c: 0, how: {} });
  const H = N.how[how] || (N.how[how] = { n: 0, c: 0 });
  N.n++; N.c += chars; H.n++; H.c += chars; DM.dirty = true;
}
/** One read of `node` that came to `chars` characters. Never throws. */
function dmCount(node, chars, how) {
  try {
    if (!dmOn()) return;
    dmInit();
    if (DM.day !== dmDay()) dmRoll();
    dmAdd(dmPage(), dmReg(node), Number(chars) || 0, String(how || 'plain'));
  } catch (e) { dmWarn(e); }
}
/** The page stayed open past midnight: yesterday's figures are saved under yesterday, today starts clean. */
function dmRoll() {
  dmSave(true);
  DM.T = {}; DM.rl = 0; DM.ra = 0; DM.rb = 0; DM.pk = 1; DM.day = dmDay(); DM.dirty = false;
}
function dmSave(force) {
  try {
    if (!DM.started || (!DM.dirty && !force)) return;
    dmLsSet('dm:t:' + DM.day + ':' + DM.tab, JSON.stringify({ v: 1, tab: DM.tab, rl: DM.rl, ra: DM.ra, rb: DM.rb, pk: DM.pk, pages: DM.T }));
    DM.dirty = false;
  } catch (e) { dmWarn(e); }
}
/** Every 30 seconds: say this tab is still open, learn how many are, save the tally if it changed. */
function dmTick() {
  try {
    const now = Date.now();
    dmLsSet('dm:hb:' + DM.tab, String(now));
    let alive = 0;
    dmKeys('dm:hb:').forEach(k => {
      const t = Number(dmLsGet(k)) || 0;
      if (now - t < 75000) alive++; else if (now - t > 24 * 3600 * 1000) dmLsDel(k);
    });
    if (alive > DM.pk) { DM.pk = alive; DM.dirty = true; }
    if (DM.day !== dmDay()) dmRoll();
    dmSave(false);
  } catch (e) { dmWarn(e); }
}
function dmPageHide() { try { dmSave(true); dmLsDel('dm:hb:' + DM.tab); } catch (e) { dmWarn(e); } }
/** A read of a database answer. Meter off: exactly r.json(). On: the same data, with its size counted on the way. */
async function dmJson(r, node, how) {
  let on = false;
  try { on = dmOn() && typeof r.text === 'function'; } catch (e) { on = false; }
  if (!on) return r.json();
  const text = await r.text();
  try { dmCount(node, text.length, how); } catch (e) { dmWarn(e); }
  return JSON.parse(text);
}

/* ---- the live copy: the meter listens to the same register, so no second download ---- */
function dmLiveWatch(node, L) {
  try {
    if (!dmOn() || typeof ptLiveDb !== 'function') return;
    let stop = false, offs = [], ready = false, sized = false;
    const off = () => { stop = true; offs.forEach(f => { try { f(); } catch (e) { /* gone */ } }); offs = []; };
    /* The app dropped or replaced this copy (another account, a refusal): the meter lets go of the register too. */
    const gone = () => { try { return !!L.dead || (typeof PT_LIVE !== 'undefined' && PT_LIVE.get(node) !== L); } catch (e) { return false; } };
    ptLiveDb().then(({ m, db }) => {
      if (stop) return;
      const ref = m.ref(db, node);
      /* A changed row: its key and its whole row. Reads slightly high (the wire carries only the changed part), never low. */
      const row = sn => {
        try {
          if (!ready || stop) return;
          if (gone()) return off();
          dmCount(node, String(sn.key || '').length + String(JSON.stringify(sn.val())).length, 'live-change');
        } catch (e) { dmWarn(e); }
      };
      offs.push(m.onChildAdded(ref, row, () => off()), m.onChildChanged(ref, row, () => off()));
      /* The whole-register listener goes AFTER the row listeners: rows already in the browser then arrive while ready is still false. */
      offs.push(m.onValue(ref, sn => {
        try {
          if (stop) return;
          if (gone()) return off();
          if (sized) return;                 // later changes come through the row listeners above
          sized = true; ready = true;
          /* A moment after it arrives, so the screen is not held up by the counting. */
          setTimeout(() => { try { dmCount(node, String(JSON.stringify(sn.val())).length, 'live-first'); } catch (e) { dmWarn(e); } }, 50);
        } catch (e) { dmWarn(e); }
      }, () => off()));
    }).catch(e => dmWarn(e));
    Promise.resolve(L.first).then(() => {
      const o = L.off;
      if (typeof o === 'function' && !o.dm) { const w = function () { off(); return o.apply(this, arguments); }; w.dm = true; L.off = w; }
    }).catch(e => dmWarn(e));
  } catch (e) { dmWarn(e); }
}

/* ---- sign-in: the flag's last answer, and who this is ---- */
function dmSaveFlag(on, type) {
  try { if (!on) { dmLsDel('dmFlagLast'); dmLsDel('dmType'); return; } dmLsSet('dmFlagLast', '1'); if (type) dmLsSet('dmType', type); } catch (e) { dmWarn(e); }
}
/** Called after sign-in: starts counting if on, and sends finished days about 30 seconds later. */
function dmStart() {
  try {
    if (!dmOn()) return;
    dmInit();
    if (DM.sendSet) return;
    DM.sendSet = true;
    const t = setTimeout(dmSendDays, 30000);
    if (t && typeof t.unref === 'function') t.unref();
  } catch (e) { dmWarn(e); }
}

/* ---- the daily line ---- */
const dmEmailKey = e => String(e || '').trim().toLowerCase().replace(/\./g, ',').replace(/[$#\[\]\/]/g, '_');
const dmKb = c => Math.round(c / 1024 * 10) / 10;
function dmNotCounted() {
  const out = ['save-answers', 'server-clock', 'connection-flag'];
  try { if (typeof deltaUseOn === 'function' && deltaUseOn()) out.push('delta-phase3-copy'); } catch (e) { /* not known */ }
  return out;
}
/** The tallies of every tab that day added together, in the shape of the daily line. */
function dmBuildLine(keys, who, type) {
  const pages = {};
  let reloads = 0, reloadsAuto = 0, reloadsBar = 0, peak = 1, tabs = 0;
  keys.forEach(k => {
    const t = dmParse(dmLsGet(k));
    if (!t || !t.pages) return;
    tabs++; reloads += t.rl || 0; reloadsAuto += t.ra || 0; reloadsBar += t.rb || 0; peak = Math.max(peak, t.pk || 1);
    Object.keys(t.pages).forEach(pg => Object.keys(t.pages[pg]).forEach(reg => {
      const s = t.pages[pg][reg];
      const P = pages[pg] || (pages[pg] = {});
      const N = P[reg] || (P[reg] = { n: 0, c: 0, how: {} });
      N.n += s.n || 0; N.c += s.c || 0;
      Object.keys(s.how || {}).forEach(h => { const H = N.how[h] || (N.how[h] = { n: 0, c: 0 }); H.n += s.how[h].n || 0; H.c += s.how[h].c || 0; });
    }));
  });
  Object.keys(pages).forEach(pg => Object.keys(pages[pg]).forEach(reg => {
    const N = pages[pg][reg], how = {};
    Object.keys(N.how).forEach(h => { how[h] = { n: N.how[h].n, kb: dmKb(N.how[h].c) }; });
    pages[pg][reg] = { n: N.n, kb: dmKb(N.c), how };
  }));
  return { v: 1, at: new Date().toISOString(), who, type, tabs, reloads, reloadsAuto, reloadsBar, peakTabs: peak, pages, notCounted: dmNotCounted() };
}
function dmDeviceId() {
  let d = dmLsGet('dmDevice');
  if (!d) { d = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); dmLsSet('dmDevice', d); }
  return d;
}
/** Sends each finished day once. A refused write is tried once more on a LATER day, then given up on; never in a loop. */
async function dmSendDays() {
  try {
    if (!dmOn() || typeof ptAuditWrite !== 'function') return;
    const who = (typeof ME !== 'undefined' && ME && ME.email) || '';
    if (!who) return;
    const today = dmDay();
    const cutoff = new Date(Date.now() - DM_GIVE_UP_DAYS * 86400000).toISOString().slice(0, 10);
    const days = {};
    dmKeys('dm:t:').forEach(k => { const m = /^dm:t:(\d{4}-\d{2}-\d{2}):/.exec(k); if (m) (days[m[1]] = days[m[1]] || []).push(k); });
    for (const day of Object.keys(days).sort()) {
      if (day >= today) continue;                                   // today is still being counted
      if (day < cutoff) { days[day].forEach(dmLsDel); continue; }   // too old: dropped
      if (dmLsGet('dm:sent:' + day)) continue;                      // another tab sent it
      const tr = dmParse(dmLsGet('dm:tried:' + day)) || { n: 0, on: '' };
      if (tr.n >= 2) continue;                                      // tried twice: given up
      if (tr.n === 1 && tr.on === today) continue;                  // the retry is for a later day
      dmLsSet('dm:tried:' + day, JSON.stringify({ n: tr.n + 1, on: today }));   // marked BEFORE the try
      try {
        const line = dmBuildLine(days[day], who, dmLsGet('dmType') || 'office');
        await ptAuditWrite({ ['pt_dataMeter/' + day + '/' + dmEmailKey(who) + '/' + dmDeviceId()]: line });
        dmLsSet('dm:sent:' + day, new Date().toISOString());
        days[day].forEach(dmLsDel);                                 // only after a good save
      } catch (e) { dmWarn(e); }
    }
    /* marks of days that are over the limit no longer matter */
    ['dm:sent:', 'dm:tried:'].forEach(p => dmKeys(p).forEach(k => { if (k.slice(p.length) < cutoff) dmLsDel(k); }));
  } catch (e) { dmWarn(e); }
}
/* ==== END DATA METER ==== */
