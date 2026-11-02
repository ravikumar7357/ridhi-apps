# Searching on her router instead of in the browser

**Decided:** 1 Nov 2026 (Phase 5; Ravi: "Workers Paid, build"). **Switches:** `server` (side by side), `serveruse`
(the router answers). **Files:** `meera/client/src/server.ts`, `meera/router/src/search.js`, `search.gen.js`.

**The problem.** To search, every browser downloaded her whole answer bank and meaning file (about 2.3 MB) and worked
through it on the staff member's own computer or phone.

**What we chose.** The same search, built from the same files (`build-search.cjs`, fingerprint-checked), runs on her
Cloudflare router. The browser sends the cleaned question and gets back only the answers to show (about 2.6 KB).

**Safe steps.** First `server`: she answers exactly as before and the router's answer is only compared and kept for an
admin. Then `serveruse`: the router answers. If the router is down she fetches her full own copy and answers as before;
with no internet at all she uses a small backup list kept in the browser.

**Why.** Measured on the test link: all 580 golden answers identical with `serveruse`; downloads 2,278 KB → 36 KB;
answers 27–53 ms once warm. One copy of the search means an improvement reaches everyone at once.

**What we gave up.** She depends on the router (with the fallbacks above), and the router needs Cloudflare Workers
Paid. Only cleaned questions are sent — never names, phones, order numbers, amounts or emails.

**Undo.** `serveruse` off → she searches in the browser again, at once, with nothing to rebuild.
