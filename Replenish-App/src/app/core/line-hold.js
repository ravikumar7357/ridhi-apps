/* ==== LINE HOLD ====
 * (Ravi, 26 Nov, after the PPC test run: two screens checked "how many are left?" at the same time, both saved, both were told
 * saved.) Behind the switch lineHold. A screen that is about to save pieces of one order line first holds that line at
 * pt_lineHold/<register>/<line> = { by, form, at }, reads the register again, checks, saves and lets go. One screen at a time.
 * The database's own rule (Sellora's rules) refuses a second screen while the hold is under 5 minutes old; the same test is
 * made here too, so the Test page, which has no rules, behaves alike.
 * ERRORS (one rule): pieces are at stake, so anything that stops the hold being taken fails loudly and nothing is saved.
 * Letting go is the one quiet step: a hold that stays behind frees itself in 5 minutes, and the console says why. */
const LINE_HOLD_MS = 5 * 60 * 1000;
const LINE_HOLD_BUSY = 'Not saved — somebody else is saving this line right now. Press Save again in a moment (if their PC stopped half way, the line frees itself in 5 minutes).';
/** A database key cannot hold . # $ [ ] / — each is written as ~ and its number, so two lines never share a key. */
const lineHoldKey = (orderNo, sku) => (obUC(orderNo) + '__' + obUC(sku)).replace(/[.#$\[\]\/%~]/g, c => '~' + c.charCodeAt(0).toString(16));

/** '' when this form now holds the line, else the sentence to show. */
async function lineHoldTake(path, form) {
  const held = await ptGetFresh(path);
  /* the age is told by the database's clock, so a PC with a wrong clock neither waits too long nor takes a live hold */
  const now = typeof deltaServerNow === 'function' ? await deltaServerNow() : Date.now();
  if (held && held.form !== form && now - held.at < LINE_HOLD_MS) return LINE_HOLD_BUSY;
  const mine = { by: auth.currentUser.email, form, at: { '.sv': 'timestamp' } };   // the database's clock stamps it
  const said = await ptCas(path, held, mine, { quiet: true });
  if (said === 'refused') {
    if (!held) throw new Error('this account may not hold order lines');   // nobody to wait for
    console.warn('[line hold] the database refused ' + path + ', held by another screen');
  }
  return said ? LINE_HOLD_BUSY : '';
}

async function lineHoldLetGo(path, form) {
  try {
    const held = await ptGetFresh(path);
    if (held && held.form === form) await ptCas(path, held, null, { quiet: true });
  } catch (e) { console.warn('[line hold] could not let go of ' + path + ' — it frees itself in 5 minutes:', e); }
}

/** Runs `save` while this form holds the line. line: { register, orderNo, sku, form } — form is the id the entry will be
 *  written under, the same each time Save is pressed again for it. Answers '' when saved, else the sentence to show. */
async function lineHoldRun(line, save) {
  const path = 'pt_lineHold/' + line.register + '/' + lineHoldKey(line.orderNo, line.sku);
  let busy;
  try { busy = await lineHoldTake(path, line.form); } catch (e) {
    console.warn('[line hold] could not hold ' + path + ':', e);
    return 'Nothing was saved — the line could not be held for this save (' + (e.message || e) + '). Check the connection and press Save again.';
  }
  if (busy) return busy;
  try { return await save(); } finally { await lineHoldLetGo(path, line.form); }
}
/* ==== END LINE HOLD ==== */
