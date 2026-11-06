# The bridge — the one door between the ERP and Meera

**Decided:** 29 Oct 2026 (Phase 1). **File:** `Replenish-App/src/app/core/meera-bridge.js`; contract `meera/shared/bridge.d.ts`.

**The problem.** Before the rebuild Meera's code sat inside the ERP and reached straight into its globals — the user,
the screens, the karigar list. Any ERP change could break her, and any Meera change could, in principle, break the ERP.

**What we chose.** One small file in the ERP, `window.erpMeera`, is the only thing she may use: who is signed in and
which screens their account has, the screen they are on, open a screen, the names to clean out of questions, the ERP's
own words, phone or desktop, and "is this switch on". Her switches live in the same file. Everything else of hers is in
`meera/`.

**Why.** One door is easy to check: what she can see and do is exactly the list in `bridge.d.ts`. There is no call
that saves or deletes, so she cannot change the ERP even by mistake. The ERP team can change any screen without
reading her code, as long as the bridge still answers.

**What we gave up.** Every new thing she needs (for example the read-only data calls of Phase 7) has to be added to the
bridge first, on purpose. That is slower — and is the point.

**Undo.** Not needed on its own: the bridge does nothing unless a switch is on, and with every switch off she runs as
before.
