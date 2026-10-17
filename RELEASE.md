# How a change reaches production

Production is never changed directly. Every change is made on `dev`, checked, reviewed, and only then merged into `main`.

## The two branches

| Branch | What it is | Rule |
|---|---|---|
| `main` | **Production.** Exactly what is live. | No direct pushes. Changes arrive only as a reviewed pull request from `dev` whose checks have passed. |
| `dev` | **Work in progress.** | Every task starts from here on its own branch. |

## Every task, step by step

1. **Start from dev.**
   ```
   git switch dev
   git pull
   git switch -c a-03-signin-parallel
   ```
   Name the branch after the task (the tracker code plus a few words).

2. **Change only `src/`, never `public/` or `dist/`.** Rebuild the page after each change:
   ```
   node Replenish-App/tests/assemble.js
   node Replenish-App/tests/assemble.js --root Pricing-App
   ```

3. **Commit small and often**, one idea per commit, with a message that says what changed and why.

4. **Run the tests.** The automatic checks run on GitHub, but four suites need the database backup that only the original developer's machine has. Run them there before every release:
   ```
   node Replenish-App/tests/prod-test.js
   node Replenish-App/tests/shop-test.js
   node Replenish-App/tests/tabs-test.js
   node Replenish-App/tests/appv-test.js
   ```

5. **Push and open a pull request into `dev`.**
   ```
   git push -u origin a-03-signin-parallel
   ```
   On GitHub: Compare & pull request → base `dev`. The other developer reviews it. GitHub runs the checks. Merge when both are green.

6. **Try it before production.** Every push to `dev` puts both apps on a **preview link** by itself
   (GitHub → Actions → deploy → the run → the links in its log). Open it and use it.
   A preview link still reads and writes the **live database**, so look at screens freely, but only save TEST orders.

7. **Release.** Open a pull request from `dev` into `main` titled with the date and what is in it. After it is merged,
   after 7 pm:
   - **The apps go live from GitHub, never from a computer:** GitHub → Actions → deploy → Run workflow → branch `main`
     → target `live` → Run. The run refuses any branch but `main`, and runs the same checks again first.
   - Apps Script (still from a computer, from `main` only): `clasp push -f`, then `clasp create-deployment -i <the existing deployment id>`
   - Database rules (still from a computer, from `main` only): `node Pricing-App/rules/rules-tool.js deploy`
     (rolls itself back if any account gets a wrong answer)

   **One-time setup for GitHub hosting:** Firebase console → Project settings → Service accounts → create a key for an
   account with the *Firebase Hosting Admin* role → GitHub → Settings → Secrets and variables → Actions → New
   repository secret named `FIREBASE_SERVICE_ACCOUNT`, paste the whole JSON. Then delete the downloaded file.

8. **Check the next morning.** Read the ERP health email: errors, freezes, refused saves, slow screens, backups. Reading production logs never changes production.

## When something goes wrong

- **The app:** Firebase console → Hosting → release history → roll back to the previous release.
- **Apps Script:** Deploy → Manage deployments → edit the deployment → choose the previous version.
- **Database rules:** `node Pricing-App/rules/rules-tool.js rollback <the rules-before-… file it saved>`
- **Data:** `restoreNode(day, path)` in Backup-Script, into the test database first.

Then fix it on `dev` and release again. Never fix it by editing production directly.

## When not to release

- Diwali week, and 23 Nov – 2 Dec around Black Friday.
- Any day the owner is not reachable to approve.
- Friday evening, unless someone will read the health email on Saturday.
