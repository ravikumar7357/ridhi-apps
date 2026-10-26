# Meera's router — free AI answers for what Meera cannot answer herself

```
Meera (in the ERP page): her own answer first → not sure → "Ask AI" → question cleaned → sent with the ERP sign-in
   ▼
Router (Cloudflare Worker, free): sign-in checked → cleaned again → today's limit (D1)
   → an approved saved answer for this question? → given back, no model
   → Meera's own 3–5 nearest answers (by id) are the only notes
   ├─ Groq → Cloudflare Workers AI → Gemini (only a question with no record in it)
   └─ nothing answers → a ticket (D1) for an admin
Admin: "tickets" in Ask Meera → writes the answer → it joins Meera's own answers in every browser
```

**Off until switched on.** Meera works on her own, as now, until all of the setup below is done.

## What leaves, and what never does

- **Goes to the model:** the question with order numbers, phones, emails, tax numbers and the karigars' names taken out (in the page *and* again in the router), the screen's name, and Meera's own written answers.
- **Never goes to a model:** orders, customers, prices, stock, anything from the ERP's data. The router has no key to the ERP. It cannot read or change it.
- **Gemini** (Google may use free-tier prompts to improve its models) is the last choice, and only gets a question with nothing that looks like a record in it.
- **Who can ask:** only someone signed in to the ERP. Each question carries their Firebase sign-in, checked against Google's keys. The router only answers the ERP's own website.
- **Limits:** 10 AI questions per person per day and 500 for the company (`USER_DAILY`, `COMPANY_DAILY` in `wrangler.toml`). Over the limit, the question becomes a ticket.

## Switching it on (once)

1. **Cloudflare** (free account, cloudflare.com):
   - Workers & Pages → D1 → Create database, name `meera`. Copy its **Database ID** into `wrangler.toml` (`database_id`).
   - My Profile → API Tokens → Create token → "Edit Cloudflare Workers" template; add **D1: Edit**. Keep the token.
   - Note your **Account ID** (right side of the Workers & Pages page).
2. **Groq** (free, console.groq.com) → API Keys → create one.
3. **Gemini** (optional, free, aistudio.google.com) → Get API key.
4. **GitHub** → this repository → Settings → Secrets and variables → Actions → New repository secret, four times:
   `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GROQ_API_KEY`, `GEMINI_API_KEY`.
   The keys never go into the code: this repository is public.
5. In `wrangler.toml` set `ENABLED = "true"`. Check the three model names against Groq's, Cloudflare's and Google's current lists.
6. Push to `main`. GitHub runs the tests, makes the D1 tables and deploys the Worker. Its address appears in the run as `https://meera-router.<your-name>.workers.dev`.
7. Put that address in `Replenish-App/src/app/core/guide-ai.js` (`GA_AI_URL`), then push. Meera now shows **Ask AI** when she is not sure.

**To switch it off:** set `ENABLED = "false"` and push, or empty `GA_AI_URL`.

## Tests

No internet and no accounts are needed. D1 is played by Node's own SQLite, and Google, Groq, Gemini and Workers AI by fakes.

```
node meera-router/test/router.test.mjs        # 38 checks: cleaning, sign-in, the door, fallbacks, limits, tickets, saved answers
node meera-router/test/same-cleaning.test.mjs # the page and the router clean a question the same way
```

## Admins

In Ask Meera, type **tickets**. Open questions are listed, each with a box to answer it. A saved answer:
- is given straight back the next time the same question is asked, with no model and no count;
- joins Meera's own answers in every browser.

Answers that a model wrote wait as "pending" (`GET /admin/answers`). An admin approves them before they join.
