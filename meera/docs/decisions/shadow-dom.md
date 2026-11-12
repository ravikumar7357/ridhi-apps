# Her own sealed box on the page (Shadow DOM)

**Decided:** 31 Oct 2026 (Phase 3). **Switch:** `design` (needs `lazy`). **File:** `meera/client/src/design.ts`.

**The problem.** Her styles and the ERP's styles shared one page. An ERP style change could reshape her panel, and a
style of hers could, by accident, change an ERP screen.

**What we chose.** With `design` on, her panel, answer card and phone sheet are drawn inside one element of her own
(`#meera-host`) with a sealed inside (Shadow DOM). Styles do not cross in either direction. Her walk-round highlights,
which must sit on the ERP's own boxes, stay outside and are placed so they never cover what they point at.

**Why.** Measured: 0 of 23 ERP styles changed with her new look on; 580 answers identical with `design` off and on;
walk-rounds lit 44 desktop and 35 phone steps, none covered.

**What we gave up.** About 7 KB more in meera.js, and a little care: the ERP's search for an element does not see
inside her box (her own code uses her box's search).

**Undo.** `design` off (the default) — her old look, in the page as before.
