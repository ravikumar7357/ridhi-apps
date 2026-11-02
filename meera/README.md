# Meera — the ERP's assistant

Meera answers staff questions about the ERP (English, Hindi, Hinglish), walks people through jobs on the real screen,
helps when they are stuck, and asks a free AI only when she is not sure. The full plan for her rebuild is
`C:\AMAZON\handoff\meera-v2-plan-2026-10-29.md`; why things are built the way they are is in `docs/decisions/`.

## Where she lives

```
meera/
  client/                  Meera in the browser (TypeScript)
    src/start.ts           the start of meera.js                 src/finish.ts   its end
    src/config.ts          EVERY threshold and timing in one place (how sure, how near, how long to wait)
    src/understand.ts      spelling mistakes (Phase 2)           src/design.ts   her new look (Phase 3)
    src/learn.ts           learning from staff (Phase 4)         src/server.ts   search on her router (Phase 5)
    src/legacy/*.ts        her older code (moved from the ERP on 29 Oct; TypeScript since 2 Nov, relaxed rules)
    meera.css, design.css  her look
    build.cjs              builds Replenish-App/public/meera/ (meera.<hash>.js, meera.webp, backup lists)
    tsconfig.json          strict check of the new files     tsconfig.legacy.json   all files together
    eslint.config.mjs      her ESLint rules (eslint.rules.mjs holds them; .prettierrc.json her format)
  router/                  her router — a Cloudflare Worker (meera-router.erp-9a0.workers.dev); deploys on its own
  shared/bridge.d.ts       the contract: everything the ERP gives her, and nothing more
  bank/evals/              her test questions       bank/baseline/   the 29 Oct baseline and 580 golden answers
  tests/                   her checks (below)       tools/           scripts of the rebuild
  docs/decisions/          one page per big choice  ROLLOUT.md       how each switch goes live, and how to undo it
Replenish-App/src/app/core/meera-bridge.js     the ONLY Meera file inside the ERP: the bridge + her switches
```

Her answers, walk-throughs and meaning file are in `Replenish-App/public/guide/` (meera-bank.json, meera-walks.json,
meera-words.bin). With the "serveruse" switch the router searches them instead of the browser.

## Her switches (all OFF for everyone; `MEERA_SWITCHES` in meera-bridge.js)

| switch | what it does | needs |
|---|---|---|
| lazy | she loads as her own file after the ERP is ready, instead of inside the page | — |
| spell | reads spelling mistakes ("karigr", "maaal") and says how she read the question | lazy |
| design | her new look, in her own sealed box (Shadow DOM) | lazy |
| learn | missed / not sure / 👎 / spellings go, cleaned, to her router; "Meera's learning" page for admins | lazy |
| server | her router searches side by side (she still answers as before; differences are kept for an admin) | lazy |
| serveruse | her router's search answers; her own copy is the fallback | lazy, router deployed |

Try one for a single visit with `?meera=lazy,spell` at the end of the address, or for one browser with
`localStorage['meera.spell'] = '1'`. Turning one on for everyone is a change in `MEERA_SWITCHES` — only on Ravi's
"live karo". To undo: set it back to `false` and push, or (one browser) remove the localStorage line.

## After any change

```
node meera/client/build.cjs                 rebuild meera.js (GitHub checks it with --check)
node Replenish-App/tests/assemble.js        rebuild the page
node meera/tests/type-check.cjs             both TypeScript checks
node meera/tools/lint.cjs                   ESLint (0 errors allowed)
node meera/tests/never-break.cjs            the never-break list (30 checks; the rest by hand: tests/NEVER-BREAK.md)
node meera/tests/gate.cjs                   no worse than the baseline — scores and 580 golden answers, Meera in the page
node meera/tests/gate.cjs --bundle          the same for meera.js
node meera/tests/ci-gate.cjs                everything GitHub runs before a deploy, in one go
```

`bash meera/tools/phase6-save.sh` runs the lot and commits only if all pass. GitHub runs the same before every deploy
(`meera/tests/ci-gate.cjs`, from replenish-hosting.yml) and blocks it if Meera got worse; an ERP change that does not
touch her only warns. A meant change to her answers is accepted with `node meera/tests/gate.cjs --accept "why"`.
Pushing to `main` deploys the live site — only on Ravi's "live karo". The test link is the `preview/meera-v2` branch.

## Rules she keeps

- She never changes the ERP: no saving, no deleting, no clicking a save button for anyone.
- She shows only what the person's account can open (the bridge gives her their screens, nothing else).
- Nothing personal leaves the browser: names, phones, order numbers, amounts and emails are cleaned out of every
  question before it reaches the AI or her router (checked by `meera/tools/phase4-privacy.mjs` before every deploy).
- No key or password is ever in her code (the repository is public); the router keeps its keys as Cloudflare secrets.
