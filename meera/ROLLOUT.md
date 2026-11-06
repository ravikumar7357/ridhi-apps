# Meera v2 — test link, rollout and the router move

## 1. On the test link (preview/meera-v2)

Open the test link twice: once as it is (lazy **off**, Meera inside the page as on live today) and once with
`?meera=lazy` added to the end of the address (lazy **on**, Meera as her own file). Do it on an office computer and on a
phone. Sign in as usual.

| # | Check | Lazy off | Lazy on |
|---|---|---|---|
| 1 | Her round face appears bottom-right (on lazy on, a second or two after the page settles) | ☐ | ☐ |
| 2 | Click the face: menu with Ask Meera / Show me this screen / Helper on-off | ☐ | ☐ |
| 3 | Ask "karigar ko kaam kaise de" — answer with Mere saath kijiye / Karke dikhaiye | ☐ | ☐ |
| 4 | Ask in Hindi "कारीगर को काम कैसे दें" — answer in Hindi | ☐ | ☐ |
| 5 | Ask "who won the cricket match" — "isn't about the ERP" | ☐ | ☐ |
| 6 | Press Karke dikhaiye — the light moves box by box, nothing is saved | ☐ | ☐ |
| 7 | Show me this screen — the walk-round lights the right boxes; Next / Skip work; a click outside ends it | ☐ | ☐ |
| 8 | Press **?** on the keyboard (not in a box) — Ask opens; typing **?** inside the Ask box just types it | ☐ | ☐ |
| 9 | Open a screen you have never opened before — its walk-round starts by itself | ☐ | ☐ |
| 10 | Phone: her face sits above the bottom tabs; the Ask box fits the screen | ☐ | ☐ |
| 11 | The ERP itself: open three or four screens you use every day — they work as on live | ☐ | ☐ |

**What I measure on the test link** (lazy off and on): page download size, when the page is ready, when her face
appears, and the time of the first answer from cold.

**Turn lazy on for one computer for the whole week** (instead of adding `?meera=lazy` each time): open the browser's
console on the ERP page and run `localStorage.setItem('meera.lazy','1')`; to undo: `localStorage.removeItem('meera.lazy')`.

## 1b. Spelling (Phase 2) on the test link — add `?meera=lazy,spell`

| # | Type this in Ask Meera | She should |
|---|---|---|
| 1 | `pakking list kaha hai` | show "Iske results **packing list kaha hai** — kuch aur poochna tha?" above the answer |
| 2 | `kariger ko maaal kaise de` | read it as karigar / maal, answer the job-work issue |
| 3 | `qualty chek kaha hota hai` | read "quality check" |
| 4 | `dispach kaise kare` | read "dispatch" |
| 5 | Press **Jaisa likha waisa khojiye** under any of these | answer again exactly as typed, no "Iske results" line |
| 6 | `truck`, `chai kab aayegi`, a karigar's name, a SKU code, a vendor's name | left exactly as typed (no "Iske results" line) |
| 7 | `अभी कितने बजे हैं` / `what time is it` | the time; `what does Date show` must NOT give today's date |
| 8 | `परसों की हाज़िरी अब भर सकते हैं क्या, टाइम डालना है` | attendance answers, not the time of day |
| 9 | `कारीगर को काम कैसे दे` (Hindi) | the job-work answer, in Hindi |
| 10 | Same questions **without** `,spell` (`?meera=lazy`) | no "Iske results" line anywhere — as today |
| 11 | Phone: the "Iske results" line and its button fit the Ask box | |

**Names stay as typed** (karigars, parties, SKUs). Type a name with a letter wrong — a karigar's name missing a letter
("Ramsh ko maal diya"), a party's name ("Shre Printrs ka order"), a SKU with one character changed ("RCN14B ka stock").
How to see it:
- **On screen:** the "Iske results …" line is the only place she shows a question changed. The name must appear there
  exactly as you typed it — never "corrected" into a name, and never any name or SKU you did not type. (An ordinary word
  next to it may be fixed, e.g. "Printrs" → printers: that is a word of her own answers, not the party's name.)
- **Exactly:** open the browser console (F12 → Console) on the test link and type
  `MEERA.understand('Ramsh ko maal diya')` — it shows the text she understood and `changes`, the list of every word
  she changed. A name must never be in `changes`.
- She learns the names only from what this person's screens already have loaded (the karigar list, the master lists);
  they are used only to leave such words alone — never shown, never sent anywhere.

## 1c. The new look (Phase 3) on the test link — add `?meera=lazy,spell,design`

Compare with `?meera=lazy,spell` (today's look) on an office computer and on a phone. Sign in as usual.

| # | Do this | With design on she should |
|---|---|---|
| 1 | Look bottom-right | a small round face; nothing else of hers on the page |
| 2 | Click the face → Ask Meera, at once | a thin "Getting ready… you can type now" line for a moment; typing works meanwhile |
| 3 | Open Ask on a screen showing a red message | "I can see this message on the screen" with the message and a **Help with this** button; under it "Common on <screen>" with 3 questions as rows |
| 4 | Ask `karigar ko kaam kaise de` | a card: "✓ From the ERP guide" + the screen's name, one bold line, **Do it with me** as the one blue button, "Steps and why (6)" folded |
| 5 | Open "Steps and why" | the steps and the why, as before |
| 6 | Click **हिंदी** in the header, ask again | everything in Hindi — buttons, labels, the answer |
| 7 | Back to **English**, ask in Hinglish (`kariger ko maaal kaise de`) | the answer in Hinglish, the buttons in English |
| 8 | Ask something she cannot answer (`GST invoice me HSN code kaise badle`) when AI is on | the AI's answer marked in amber "⚠ Suggested — please check" |
| 9 | Stay idle on a half-filled form with a red line | the "Stuck?" note small, beside her face; the page still works |
| 10 | Open a screen for the first time (or Show me this screen) | first visit: her full figure beside the bubble; "Show me this screen": her round face in the bubble only |
| 11 | Phone: Ask | a sheet from the bottom with a handle; the page above it |
| 12 | Phone: a walk-round | the bubble is a sheet at the bottom; the lit box always above it (or the sheet moves to the top); her round button hidden meanwhile |
| 13 | The ERP itself: three or four screens you use every day, with the look on | buttons, boxes, menus look and work exactly as without it (her styles are sealed in her own box) |

## 2. Rollout on live — each step only on Ravi's "live karo" (order set 29 Oct)

1. **The meera.js cache fix** (and Phase 2 code, switches still off): merge to main. Live behaves as today; nobody has
   lazy or spell. Check after: `/meera/meera.version.json` loads, and `/meera/meera.<version>.js` is kept by the browser.
2. **Lazy on for everyone:** `MEERA_SWITCHES.lazy = true` in `Replenish-App/src/app/core/meera-bridge.js`, push.
   Undo in a minute: back to `false`, push (or one person: `localStorage.setItem('meera.lazy','0')`).
3. **Watch one week:** her face appears for everyone, no "Meera stopped" in the browser console, staff report nothing
   missing, the never-break list by hand once.
4. **Spell on for everyone:** `MEERA_SWITCHES.spell = true`, push. Undo the same way (`'meera.spell'`).
5. Later, on its own "live karo": remove the old in-page Meera (the `@meera/…` lines leave
   `Replenish-App/src/app/ORDER`, her look leaves the page's styles) — the page gets 157 KB lighter (compressed).

## 3. The router move (meera-router/ → meera/router/)

- The router's deploy (`.github/workflows/meera-router.yml`) runs **only on a push to main** that changes
  `meera/router/` — so the first merge of this work to main **redeploys the Worker** "meera-router" at the same address,
  with the same code, settings, database and keys. Test-link pushes never touch it.
- **Ravi is told before that push.** Right after it:
  - health link: https://meera-router.erp-9a0.workers.dev/health — must show `{"ok":true,"groq":true,"workersAi":true,…}`
  - one real "Ask AI" question on live answers or makes a ticket, as before.
- **Roll back** (any one of these):
  - Cloudflare dashboard → Workers & Pages → meera-router → Deployments → the previous version → "Rollback" (a minute,
    no push); or
  - switch the AI off for everyone: `ENABLED = "false"` in `meera/router/wrangler.toml`, push (Meera answers on her own);
  - or empty `GA_AI_URL` in `meera/client/src/legacy/guide-ai.js`, push.

## 4. Her router on Cloudflare's FREE plan (master plan B.1) — approved 2 Nov ("B.1 approved — live karo")

**What went up** (main 90d8b76; deployed BY HAND: GitHub → Actions → "Meera router — test, deploy" → Run workflow, on main):
- the router from `meera/router`, entry `src/free.js` — AI answers (`/ask`) as before (with the better cleaning: amounts and
  short order / invoice numbers taken out too), plus the learning records, the admin page's lists, her switches
  (`/config`) and the weekly export (locked: no `EXPORT_KEY` set). Her search on the server is PARKED
  (`SEARCH = "parked"` in wrangler.toml: off whatever the admin switch says). 58 KB compressed; 0.2–1.3 ms a request.
- the database: 4 new, empty tables (`learn`, `kb`, `config`, `diffs`); the 3 old ones (`usage`, `answers`, `tickets`)
  untouched — their layout is the same. Her answers are NOT loaded into `kb` (nothing reads them while search is parked).
- No secret changes. Nothing changes for staff: every switch in the ERP stays off, so live Meera uses only `/ask`, as before.

**Health check** (no sign-in, no data): https://meera-router.erp-9a0.workers.dev/health →
`{"ok":true,"v":"learn-free-2026-11-02","search":"parked","groq":true,"workersAi":true,…}`. The deploy run checks it
itself. Before 2 Nov it said `{"ok":true,"groq":true,"workersAi":true,"gemini":false}` (no "v").

**Roll back** (seconds, nothing lost):
1. Cloudflare dashboard (erp@ridhihome.com) → Workers & Pages → **meera-router** → **Deployments** (or Versions).
2. Pick the one before 2 Nov (deployed 29 Oct, from main dc3aa15) → **Rollback** → confirm.
3. Check /health shows no `"v"` again. Live Meera keeps asking `/ask`, which the old router has.
4. The 4 new tables can stay (the old router never reads them); learning records kept in them stay for when the new router
   comes back. On GitHub: revert 90d8b76 if the files should go too (the site is not affected either way).

**Next (B.2–B.3):** the admin page ("Meera's learning" + "New on the screens", opening even when the router is down), then
`learn` on for everyone — each on its own "live karo".

## 5. Server search (Phase 5) — PARKED (Ravi, 2 Nov 2026: "I'm not taking Workers Paid for now")

Its search needs 27–53 ms of computer time per question; the free plan allows 10 ms. The code stays (switches `server`
and `serveruse` off for everyone) and is not deployed; everything else on her router fits the free plan. To take it up
again: Workers Paid, then the checks below.


1. `?meera=lazy,server` (side by side): nothing looks different. Ask 10–20 everyday questions. Meera's learning →
   Switches shows how many the server answered the same.
2. `?meera=lazy,serveruse` (answers from the router): the same answers as before. Browser → F12 → Network: no
   meera-bank.json (837 KB) and no meera-words.bin (1.3 MB) — only `backup/<screen>.json` (a few KB) and one `search`
   (~2.6 KB) per question. First answer: under a second once the router is warm.
3. Turn "Search on the server" off in Switches, ask again: she says her server search is not available and still answers.
4. Phone: the same, on mobile data.

