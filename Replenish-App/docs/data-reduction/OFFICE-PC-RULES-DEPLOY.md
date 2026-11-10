# Office PC — deploy the data-reduction rules

For the office computer (Windows user **ravik**), where `Pricing-App/rules/rules-tool.js` can run (it uses the
firebase-tools installed there). Written 6 Nov 2026. Ravi runs this, or asks Claude Code on that PC to.

**Also works on the other PC (user "User") since 10 Nov 2026:** rules-tool.js now also finds Firebase's library inside the
stand-alone firebase.exe's folder (`%USERPROFILE%\.cache\firebase\tools`). It needs a valid login there first:
`& "C:\Users\User\tools\firebase\firebase.exe" login --reauth --no-localhost` (open the link, Allow, paste the code
back). The Firestore step (5) uses the same exe: `& "C:\Users\User\tools\firebase\firebase.exe" deploy --only firestore:rules --project price-research-48ff3`.

## What goes live

All in branch `preview/badges` (commit "Firebase rules for the data download plan…"):

| Rule | Where | Why |
|---|---|---|
| `pt_dataMeter` — each user writes only their own daily line, admins read, day must be a date | Realtime Database | Step 0: the data meter can save its numbers |
| `.indexOn ['status']` on `pt_vendorOrderReqs`, `pt_obDeleteReqs`, `pt_fgiCorrReqs`, `pt_jwCorrReqs` | Realtime Database | Step 1: sign-in counts ask only for waiting requests. No read/write permission changes. |
| `config/flags` — anyone with an access record may read, nobody may write from the app | Firestore | the on/off switches for the plan (`dataMeter`, `pendingBadges`, later the ticker) |

Nothing in the app changes until the switches are turned on. Both switches stay **off**.

## Steps

1. Clean start — nobody's unsaved work on this PC:
   ```
   git status
   ```
   Must say "nothing to commit, working tree clean". If not: **stop**, show Ravi the list.
2. Get the branch:
   ```
   git fetch origin
   git switch preview/badges
   git log --oneline -3
   ```
   The top two commits are "Sign-in counts download only waiting requests…" and "Firebase rules for the data download plan…".
3. Firebase login still valid? If the next step complains about a token or login: `firebase login --reauth`, then retry.
4. **Realtime Database rules — the safe tool:**
   ```
   cd Pricing-App/rules
   node rules-tool.js deploy
   ```
   It: refreshes `pt_perms` from Firestore → saves today's live rules to `rules-before-<time>.json` → puts the new rules
   → plays every account against them → **puts the old rules back by itself** if a single answer is wrong.
   - Ends with **"DEPLOYED, and database.rules.json now says what is live."** → go on.
   - Ends with **"ROLLED BACK"** or **"FAILED"** → **stop.** Nothing is broken (the old rules are live). Copy the full
     output for Ravi. Do not retry, do not edit anything.
5. **Firestore rules** (only if step 4 said DEPLOYED):
   ```
   cd ..
   firebase deploy --only firestore:rules --project price-research-48ff3
   ```
   Must end with "Deploy complete!". This deploys only `firestore.rules` — not hosting, not database.
6. **Save what the tool changed.** Step 4 rewrote `Pricing-App/database.rules.json` (now = live) and added
   `Pricing-App/rules/rules-before-<time>.json` (the undo copy). Both must be committed, or a later plain
   `firebase deploy` could push the old rules back:
   ```
   git status --short
   git add Pricing-App/database.rules.json Pricing-App/rules/rules-before-*.json
   git commit -m "Rules for the data download plan are live; live copy and undo file saved"
   git push origin preview/badges
   ```
   Only those files. If `git status` shows anything else changed, stop and show Ravi.
7. Back to normal: `git switch main`

## Undo (only if something misbehaves later)

```
cd Pricing-App/rules
node rules-tool.js rollback "<the rules-before-… file from step 4>"
```
then restore `database.rules.json` from that file and commit. Firestore: redeploy `firestore.rules` from `main`.
