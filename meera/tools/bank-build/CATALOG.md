# Meera knows every part — brief for each writer

Ravi: "does Meera know each and every minute detail and every component of the app ... make it advanced". She does not
yet: of 2,548 labelled parts (buttons, columns, boxes, options, hover notes) many are not explained, and of the 251 places
that save data many have no "how do I do this" answer. You fill that in for ONE group of screens.

## Where the truth is — READ ONLY
App (latest GitHub main, what is live): C:\Users\User\AppData\Local\Temp\claude\C--AMAZON\ed699ac6-3b39-4920-a5f4-bfdb7eb0cd75\scratchpad\wt2\Replenish-App\src
(index.html and app/**.js). Each part's `at` is file:line in that src folder. Never run the app, no git, no internet.
Meera's existing answers: C:\Users\User\AppData\Local\Temp\claude\C--AMAZON\1449c853-e041-4bb1-a0f6-a182f8fa015d\scratchpad\bank\EXISTING-IDS.txt
(id | screen | answer). Format and tone rules for full answers: BRIEF.md in that same bank folder — follow it.

## Your input
`in-<group>.json` (this folder): { parts: [{key, kind, label, tab, id, at}], workflows: [{fn, file, at, tab, writes[]}] }.

## Job 1 — every part: one line, what it does or shows
For each part write ONE short line (max ~25 words) in en, hi, hg saying what it does / shows / is for, in plain words,
as the screen uses it. Read the code around `at` (the handler of a button, how a column is computed, what a box takes,
what an option filters, what a hover note explains). Name other parts exactly as the screen does.
- kind button: what pressing it does (and if it saves/sends/deletes, say so, and any permission it needs).
- kind column: what the number/text in it means, and how it is worked out if not obvious.
- kind box: what to type or pick there, and any rule (required, format).
- kind option: what choosing it shows or does.
- kind note: it is already a hover explanation — rewrite it short and plain (or skip if it only repeats the label).
Write `skip: true` for parts not worth a line: bare punctuation, a lone "Cancel"/"Close"/"OK"/"×" (unless special), a
duplicate of another part on the same screen, a placeholder like "— Select —", or a test/preview-only part.
Hinglish uses aap (dabaiye, chuniye, likhiye — never dabao/chuno/likho). Hindi: formal आप, everyday words, part names in English.
Output: `done-<group>-parts.json` (this folder) = [{ "key": "p123", "en": "...", "hi": "...", "hg": "..." } or { "key": "p124", "skip": true }]
— one item for EVERY part key in your input, in any order.

## Job 2 — every workflow: a full answer, unless Meera already has one
For each function in `workflows` (a place that saves data): find which button/screen starts it and what it does. If an
answer in EXISTING-IDS.txt already covers that job properly, list it as covered. Otherwise write a full answer in the
BRIEF.md format (q en≥8 / hi≥6 / hg≥10 ways of asking, a, why, steps with exact labels, sel if one box/button, admin if
admin-only, src) — including: the boxes that must be filled, the rules that stop it (its red messages), who may do it,
and what it changes on other screens. Several functions that are one job (save + its undo helpers) → one answer.
Output: `done-<group>-workflows.js` = `module.exports = [ ...entries ]`, ids prefix `wf-<group>-`,
and `done-<group>-covered.json` = [{ "fn": "...", "file": "...", "by": "existing-id" }].
Prove both JS/JSON files load with node. Do not edit any other file.
Reply with: parts done/skipped, workflows written/covered, and anything in the code that looked like a bug (one line each).
