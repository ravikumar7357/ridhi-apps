# Question categories — what kind of question, and how Meera answers it

**Decided:** 17 Nov 2026 (Ravi: "categorize questions for the ERP… and how Meera should answer that category").
**Files:** `meera/client/src/intent.ts` (the module), `meera/tests/intent-check.cjs` (its check). Joined by the page and
meera.js (ORDER, after config.ts) and **read only by the judge** (switch `judge`, off): it tells the judge the kind and
keeps figures, outside and chat away from any AI. Her own search does not use it yet (step 3 below).

## The problem
Today every question goes through one search with one "sure" bar (0.75). So a "how do I" question can win a "what is"
answer, a "what happens if" question can get a near answer that says something else, and a live figure ("RCN14B ka stock
kitna hai") is searched for in her written answers instead of read from the screen. On questions written the way staff
type (held-back set, 531) she is right 25% of the time and **wrong 35%**.

## Two labels on every question
**Intent** — what kind of answer the person needs. **Area** — which part of the ERP (the same groups as her answer ids).

| Area | Id prefix | Screens |
|---|---|---|
| general | `gn-` | sign-in, PIN, export, filters, phone, Meera herself |
| orders | `or-` | Order console, Sales order, Shopify orders, returns |
| production | `pr-` | Job Work, cutting, press, QC, PPC / Production flow |
| inventory | `in-` | Finished goods, FBA, packing, fabric, accessories |
| planning | `pl-` | Replenishment, Top ASIN, dashboard, targets, reports |
| vendors | `vm-` | Vendor portal, RFD, master database, HR, payouts |

## The 12 intents, and how she answers each

| Intent | Staff ask like | Answer from | She shows | AI |
|---|---|---|---|---|
| **how** | "karigar ko kaam kaise de" | answers + walk-throughs | one line, steps folded, Do it with me | judge |
| **where** | "rfd screen kha milegi" | answers + screens this person can open | the screen, Open button, the box lit | judge |
| **what** | "change asked ka kya matlab" | screen parts, open screen first | one line: what it is, what it is for | judge |
| **error** | "issue nhi ho rha, at most allowed bol rha" | the red line on screen, then answers | quotes the red line, points at the box | judge |
| **status** | "8d laal kyu dikh rha" | answers about colours, words, hidden rows | the rule behind it, what to do | judge |
| **data** | "RCN14B ka stock kitna hai" | the ERP figures this page holds (read only) | the figure, where it comes from, Open | **never** |
| **whatif** | "rate badla to payout badlega?" | checked answers only | exactly what the answer says — never worked out | judge |
| **access** | "password bhul gaya", "screen nahi dikh rahi" | answers + this person's rights | what they can open, who gives the right | judge |
| **fix** | "galti se entry delete ho gyi" | correction answers | the correction steps; deleted or money: ticket at once | judge |
| **flow** | "order shuru se FBA tak kaun si screens" | answers + walk-throughs in order | the screens in order, each with Open | write |
| **outside** | "GST me HSN kaise badle", Flipkart | — | "The ERP does not do this" (+ ticket if business) | **never** |
| **chat** | "hello", "thank you" | a few fixed lines | short hello, "What do you need on the ERP?" | **never** |

**AI — judge:** Groq is shown her top 15–20 answers for this intent and may only pick one by id (or none); she shows
her own checked words. **write:** Groq writes from her notes, marked "please check" (only for flow, which joins several
answers). **never:** no AI at all — a figure must come from the ERP, an outside question gets no made-up answer.

## How the categories make her better
1. **Fewer wrong answers.** A "how" question first looks at "how" answers; a "what is" at parts. Two answers about the
   same screen part stop competing.
2. **A sure bar per kind.** whatif 0.85, data / status / access / fix 0.8, how / error 0.75, where / what 0.7 — starting
   values in `MI_PLAN`, each to be set on the tuning set, never on the held-back sets.
3. **The right source.** data reads the screen (switch "data"), error reads the red line, outside never searches.
4. **Groq gets the intent** in its prompt, and judges only answers of that kind.
5. **Scores per kind.** Her gate can say "where: 80% right, whatif: 40%" — so we know which kind to work on next.

## Next steps (each measured by her gate; live only on Ravi's "live karo")
1. `node meera/tests/intent-check.cjs` passes; then run `miClassify` over her tuning questions and read the confusion
   (which intent was mistaken for which) — add the cues it needs.
2. Tag every answer in `meera-bank.json` with its intent (from its id and its ways of asking; a tool, checked by hand).
3. Behind a new switch `intent`: search the question's intent first, its own sure bar, then the rest.
4. The Groq judge prompt (Phase 2 of the plan) gets the intent and the top answers of that intent.

**Undo:** the module is not used; delete the two files. With the switch (step 3) off, she is exactly as today.
