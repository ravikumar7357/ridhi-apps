# Fabricrush report mail

Every **Monday and Thursday around 9 am India time** this script mails the company report:

- **Production:** came into production, started, late, stuck, into finished goods
- **Shipping:** shipped, shipped by MCF, pending, ready to dispatch, per channel

The mail gives the counts. The **Production** and **Shipping** PDFs are saved in the Drive folder *Fabricrush reports*, and the mail links to them. With photos they are too big to attach (about 28 MB).

The rules are written at the top of `Rules.gs`. Ravi agreed them on 17 Nov 2026.

## Files

| File | What it holds |
|---|---|
| `Rules.gs` | the counting rules (no reading, no sending) |
| `Mail.gs` | the mail: plain lines, one count per heading, notes, links to the PDFs |
| `Pdf.gs` | the PDF layout (Ravi's order-sheet columns) |
| `Printers.gs` | the printer late alert: which lines are red for more than 2 days, and its mail |
| `Main.gs` | reads the ERP and Shopify, saves the PDFs, sends the mail, sets the timers |
| `appsscript.json` | India time zone and the Google permissions it asks for |
| `tests/report-mail-test.js` | the tests: `node Report-Mail/tests/report-mail-test.js` |
| `tests/make-sample.js` | a sample report from database export files (keep the exports out of the repo) |

## Setting it up (once, signed in as ravi@)

1. Go to <https://script.google.com> → **New project**. Name it `Fabricrush report mail`.
2. **Project Settings** (gear icon) → tick **Show "appsscript.json"**.
3. In the editor, paste each file's contents: `appsscript.json`, then **+ → Script** for `Rules`, `Mail`, `Pdf`, `Printers` and `Main`. Delete the empty `Code.gs`.
4. **Project Settings → Script properties**: nothing to add for Shopify. The script reads the Pricing script's address and key from Firestore `config/api`, where the ERP's Reports tab reads them, so nobody types a key.
   - `REPORT_TO`: leave it **blank** for now, so only you get it. Later: addresses separated by commas.
5. Pick `sendErpReport` in the top bar → **Run**. Allow the permissions it asks for:
   - read the ERP database
   - send mail as you
   - make and see **only its own files** in Drive (not the rest of your Drive)
   - reach Shopify through the Pricing script

   Check the mail and both PDFs. The first run makes the *Fabricrush reports* folder. It is shared quietly with the people on `REPORT_TO`, so they get no "shared with you" mails.
6. When happy, pick `installReportTimers` → **Run**. This sets the Monday and Thursday timers.

## Printer late alert (Tuesday and Friday)

Every **Tuesday and Friday** at about **10 am India time**, the script sends **one mail** for all printers holding cloth **5 or more days** past its due date (red on the Vendor Portal). On top, a summary per delay group (5–7, 8–14, 15–21, 22+ days): printers, designs and cloth. Below, one row per printer with its designs in each delay group; the printer's name opens its late orders in the ERP. A day with no such line sends nothing. The rule is in `Printers.gs`.

- **Who gets it:** the people in `PRINTER_ALERT_TO` (Script properties, comma separated: your purchase / vendor person), plus the account that runs the script. While it is blank, only that account gets it.
- **To try it:** pick `sendPrinterAlerts` → **Run**.
- **To switch it on:** pick `installPrinterAlertTimer` → **Run** once. It also removes any older (daily) timer.
- **To stop it:** **Triggers** → delete the `sendPrinterAlerts` trigger.

## How to stop it

Open the script → **Triggers** (clock icon) → delete the two `sendErpReport` triggers. Nothing else changes, because the script only reads the ERP. The PDFs already made stay in the Drive folder until you delete them.

## Known limits

- **Amazon FBA:** "shipped" and "ready to dispatch" are only as good as the FBA team's *shipped* button. On 17 Nov, 3,228 entries were with the FBA team but not marked shipped, and nothing had been marked since 4 Nov. The mail says so in red.
- **Printers:** printing progress a vendor types on the Vendor Portal challans is not read. A line at a printer can show as stuck when its only news is on a challan.
- **Old Shopify rows** with no piece count count their packs (29 rows on 17 Nov).
