# Learning from staff

**Decided:** 1 Nov 2026 (Phase 4). **Switch:** `learn` (needs `lazy`). **Files:** `meera/client/src/learn.ts`, router
`/learn`, `/admin/learn`, weekly workflow `meera-learned.yml`.

**The problem.** We did not know which questions she missed, where staff gave up, or which answers they found wrong.

**What we chose.** With `learn` on she sends her router: questions she could not answer or was not sure of, a 👎 (with
an optional note), a spelling she corrected, and a walk-through someone left halfway. Each is cleaned first and carries
only the person's role, screen and language — never their name or email. An admin page, "Meera's learning", lists them
by kind. Every week a GitHub job turns what an admin approved into new answers and opens a pull request — nothing
reaches her answers without a person approving it.

**Cleaning.** The same cleaning as for the AI (checked to be identical in the browser and the router), plus a net for
names not on any list (a word before "ko", "ke", "ne"… or written with a capital letter). Names travel only as the
cleaning list and are not stored.

**Why.** She improves from real questions, and the privacy test proves nothing personal is kept or sent; it runs before
every deploy.

**What we gave up.** A small request after some answers, and an admin's time to review.

**Undo.** `learn` off (the default): nothing is sent. Stored items can be cleared from the router's `learn` table.
