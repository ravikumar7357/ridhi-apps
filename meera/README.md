# Meera — the ERP's assistant

Meera answers staff questions about the ERP (English, Hindi, Hinglish), walks people through jobs on the real screen,
helps when they are stuck, and asks a free AI only when she is not sure. The full plan for her rebuild is
`C:\AMAZON\handoff\meera-v2-plan-2026-10-29.md`.

## Where she lives

```
meera/
  client/            Meera in the browser
    src/legacy/      her code today (moved from Replenish-App/src/app/core/guide*.js on 29 Oct)
    src/start.ts     the start of meera.js (TypeScript)      src/finish.ts   its end
    meera.css        her look
    build.cjs        builds Replenish-App/public/meera/meera.js + meera.webp (her picture)
  router/            her AI router — a Cloudflare Worker (meera-router.erp-9a0.workers.dev); deploys on its own
  shared/            the contract: what the ERP gives her (bridge.d.ts)
  bank/evals/        her test questions        bank/baseline/   the 29 Oct baseline and 580 golden answers
  tests/             her checks (below)        tools/           one-off scripts of the rebuild
Replenish-App/src/app/core/meera-bridge.js     the ONLY Meera file inside the ERP: the bridge + her switches
```

Her answers, walk-throughs and meaning file are still in `Replenish-App/public/guide/` (meera-bank.json,
meera-walks.json, meera-words.bin); they move to the server in Phase 5.

## Two ways she can run (the "lazy" switch)

- **Off (everyone today):** her files are joined into the ERP's page (`@meera/…` lines in `Replenish-App/src/app/ORDER`)
  and start with it, exactly as before.
- **On:** the page leaves her out of its start and, once loaded and idle, fetches `/meera/meera.js` — the same files in
  one closed box, talking to the ERP only through the bridge. Turn it on for one browser with
  `localStorage['meera.lazy'] = '1'`, for one visit with `?meera=lazy` at the end of the address, or for everyone in
  `MEERA_SWITCHES` (core/meera-bridge.js) — "live karo" first.

## After any change

```
node meera/client/build.cjs                 rebuild meera.js (GitHub checks it with --check)
node Replenish-App/tests/assemble.js        rebuild the page
node meera/tests/never-break.cjs            the never-break list (28 checks; the rest by hand: tests/NEVER-BREAK.md)
node meera/tests/gate.cjs                   no worse than the baseline — scores and 580 golden answers, Meera in the page
node meera/tests/gate.cjs --bundle          the same for meera.js
```

Plus the ERP's own tests (`Replenish-App/tests/*-test.js`). GitHub runs all of this before every deploy; nothing goes
live if Meera got worse. Pushing to `main` deploys the live site — only on Ravi's "live karo".
