# Reading spelling mistakes

**Decided:** 30 Oct 2026 (Phase 2). **Switch:** `spell` (needs `lazy`). **File:** `meera/client/src/understand.ts`.

**The problem.** Staff type fast, often in Hinglish on a phone: "karigr ko maaal kaise de". She missed such questions
or picked a wrong answer.

**What we chose.** Before searching, each unknown word is compared with the words she knows (her answers' words and
the ERP's own words) by how it sounds (English and Hindi sound codes) and how many letters differ. A word is replaced
only when one match is clearly best (the bars are in `config.ts`: `spellSure`, `spellGap`). She then says how she read
the question ("I read this as: karigar ko maal kaise de").

**Names are never "corrected".** A word that is close to a karigar, buyer or staff name stays as typed — "Raju" never
becomes "raja". Names are also excluded as targets.

**Why.** Measured on typo sets frozen before the work: set 1 right 83 → 102, held-out set 189 → 225, Hindi set
50 → 53, with wrong answers not rising. Showing how she read it lets staff see a wrong guess at once.

**What we gave up.** A little time per question (a few milliseconds) and a larger meera.js.

**Undo.** `spell` off (the default).
