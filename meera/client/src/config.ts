/* MEERA'S NUMBERS IN ONE PLACE (v2 rebuild, Phase 6, 2 Nov 2026).
 *
 * Every threshold and timing her code runs on. Change one here, rebuild (node meera/client/build.cjs), and run her gate
 * (node meera/tests/gate.cjs): a search number moves her scores, and the gate says whether she got worse.
 * The page joins this file first of hers (Replenish-App/src/app/ORDER), so inside the page and in meera.js alike every
 * other file reads it. */
const MEERA_CONFIG = {
  /* ---- her search (guide-ask.ts gaBankFind / gaAnswer) — set on her test questions, 24–29 Oct ---- */
  topK: 4,                  // how many answers a search returns
  sure: 0.65,               // answer outright at this score or more (word search alone)
  sureMeaning: 0.75,        // …the same with the meaning table (scores run higher)
  near: 0.32,               // offer as "did you mean" from this score
  gap: 0.04,                // the best must be this far ahead of the next to answer outright
  screenFirstMargin: 0.04,  // switch "screenfirst": the open screen's clearly-sure answer wins when at most this far behind another screen's best
  screenFirstNamed: 0.04,   // switch "screenfirst": the same for a screen the question names (tuned 2 Nov on half the screens set)
  ask: 0.5,                 // a close answer worth offering when nothing is sure
  meaningWeight: 0.5,       // how much meaning counts next to the word match
  meaningSkipFillers: true, // filler words ("ko", "hai", "the") left out of a sentence's meaning
  /* ---- spelling (Phase 2): after a correction, answer outright only when clearly sure ---- */
  spellSure: 0.8,
  spellGap: 0.06,
  /* ---- walk-rounds and lessons (guide.ts) ---- */
  strikes: 3,                     // the same mistake this many times → the lesson
  strikeWindowMs: 15 * 60 * 1000, // …inside this long; older strikes are forgotten
  footPx: 300,                    // the bottom of the screen Meera and her bubble stand in
  actMs: 8000,                    // a red line this soon after a click or key is the person's doing
  typeMs: 12,                     // the bubble's words appear a few letters at a time…
  typeStep: 4,                    // …four a tick
  stepOpenMs: 650,                // a step on another screen: wait for that screen to open
  stepAgainMs: 700,               // a step shown again after a moment (Back / Try it)
  stepNextMs: 750,                // a click that does the step: on to the next after this long
  valueCheckMs: 1400,             // a box being filled: looked at again after this long
  ringMs: 20000,                  // the glow round a box after "Try it" / "Fix it now": gone after this long
  fillRetryMs: 600,               // filling a box whose list is still loading: tried again after this long…
  fillGiveUpMs: 30000,            // …for at most this long
  /* ---- waiting for things ---- */
  wordsWaitMs: 4000,      // her meaning table, at most this long before a first answer
  learnedWaitMs: 3000,    // answers admins approved (her router), at most this long
  nudgeIdleMs: 75000,     // "Stuck?" — offered after this long with nothing done on a half-filled form
  readyLineMs: 20000,     // her new look's "Getting ready…" line, never longer than this
  routerWaitMs: 4000,     // a search or a switch read from her router (Phase 5)
};
