/* ================= PRODUCTION: WRITING, NOT JUST READING =================
 *
 * The first action moved out of the old tool and into this app: recording a cutting entry.
 *
 * THE GATES ARE THE POINT, not the form. An entry that skips them is worse than no entry at all —
 * it quietly breaks the order cap that stops the factory cutting 300 pieces against a 200-piece
 * order, and everything downstream (what may be issued, what may be pressed) is measured against
 * these same numbers. So all four are ported as they stand in the old tool, with the same
 * arithmetic and the same refusal messages:
 *
 *   1. the SKU must be in the master database
 *   2. an Order ID is compulsory, and ordered − already-cut is a hard cap
 *      (already-cut is NET: pieces cut minus pieces rejected after cutting, so a rejection
 *       re-opens the allowance exactly as it does there)
 *   3. the month must not be frozen
 *   4. article / subtype / colour / size must be known to the masters
 *
 * Written to the SAME database the old tool writes to, in the same shape, with the same id scheme
 * (`cut_<ms>_<rand>`) and the same addedBy/addedAt. Both tools can therefore run side by side while
 * the rest is moved across — there is one set of records, not two.
 */

/* The signed-in user's token rides along on every write. The database this points at today ignores
 * it (its rules are still open); the one in THIS project requires it. Sending it either way is what
 * lets the move be a one-line change rather than a rewrite. */
async function ptAuthQuery() {
  try {
    const u = auth.currentUser;
    if (!u) return '';
    return '?auth=' + encodeURIComponent(await u.getIdToken());
  } catch (e) { return ''; }
}

