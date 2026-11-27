# ERP-DB — the R-one ERP database (Supabase)

The SQL that built and runs the ERP's database (project `xkpktnsdmpkwaingvdbd`, Mumbai): saves (`core.rt_save`, `rt_cas`),
reads (`rt_get`, `rt_changes`, `fs_*`), the rights copied from the Firebase rules (`rt_rights*`, `fs_rights`), the sync
engine that fills the typed tables (sales, production, stock, hr, shipping, history), cron jobs, the archive, the checker,
the job doors for Apps Script, and the way back to Firebase (pushBack).

## Where this came from
Copied unchanged on 27 Nov 2026 from `Desktop\Ridhihome\migration\sql` (the only copy until now). The database itself is
the source of truth: several later files patch earlier functions in place, so the LATEST file that touches a function wins.

Left out on purpose (data, not code — they hold staff and vendor emails):
`core_access_people.sql`, `core_control_data.sql`, `ERP_TEST_SETUP_ALL.sql`, `MAIN_SETUP_1.sql`.
No keys are in these files: real keys live in Supabase Vault; job doors store only hashes.

## Rules from now on
- `sql/` is the history as it was. **New changes go in `changes/`**, one file each, numbered: `changes/001_<what>.sql`.
- Every change file says at the top: what it does, how to undo it, and the date it was run on the live database.
- Try a change on a preview link / the test database first. Never run DDL on the live ERP during work hours without a yes.
- Running a file does not happen from GitHub automatically (yet): it is run by hand in the Supabase SQL editor.

## What comes next (roadmap Part 1 · Saving)
1. Server counters for challan / print order / EMB numbers.
2. One all-or-nothing function per multi-save action (first: job-work delete approval).
3. Month and payout locks checked inside `rt_save` (`core.period_locks`, `hr.payout_locks` already exist, empty).
4. Server checks for approvals, deletes and payouts using `core.can`.
