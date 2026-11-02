# Lazy loading — Meera as her own file, after the ERP is ready

**Decided:** 29 Oct 2026 (Phase 1). **Switch:** `lazy` (off for everyone). **Built by:** `meera/client/build.cjs`.

**The problem.** Meera's code was joined into the ERP's one big page, so every staff member downloaded and started her
before the ERP itself was usable — about 2.3 MB of her answers and meaning file on every visit, needed or not.

**What we chose.** With `lazy` on, the page leaves her out. Once the ERP has loaded and the computer is idle, it fetches
`/meera/meera.<hash>.js` — the same code, built into one closed file. The file name carries a fingerprint of its
contents, so a new version is never mixed with an old cached one (the 85d82e0 cache fix).

**Why.** The ERP opens sooner and does not depend on her: if her file cannot be fetched she is simply not there, and
the ERP works. Every new behaviour of the rebuild (spelling, new look, learning, server search) lives only in this
file, so the old in-page Meera stays exactly as it was until each switch is approved.

**What we gave up.** For a few seconds after opening the ERP she is not there yet. Two copies of her code exist (in the
page and in meera.js) until the old one is removed — the checks prove both answer the same 580 golden questions.

**Undo.** `lazy: false` in `MEERA_SWITCHES` (the default), or remove `meera.lazy` from the browser's localStorage.
