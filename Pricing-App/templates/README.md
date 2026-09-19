# Courier & MCF upload templates

The four files here are **byte-for-byte** what Ravi supplied on 2026-08-10. Nothing has been
reformatted, re-saved or "tidied". They are the reference the export is built against, so any change
to them silently changes what the couriers receive — replace them only with a newer file from the
courier, never with a re-saved copy.

| File | Sheet the data goes in | Header row | Columns |
|---|---|---|---|
| `DHL Hybrid.xls` | `Sheet1` | row 1 | 49 |
| `DHL CSV.xls` | `Sheet1` | row 1 | 80 |
| `Fedex.xls` | `Recipient and Invoice Data` | row 1 | 50 |
| `MCF.xls` | `Fulfillment Request` | row 1 | 26 |

The other sheets in each workbook are lookups and user guides — `Country Master`, `UOM`,
`Terms of Trade`, `Registration Number Type`, `StateCodes`, `Data Definitions`, `Example`. They are
not written to, but they are what the dropdowns validate against, so the values the export writes
must match them exactly.

## The part that is easy to get wrong: one shipment is not one row

Three of the four templates repeat the ORDER across several rows when it has more than one
commodity line. The first row carries everything; the continuation rows carry only the item block
and leave every shipment-level cell blank. Writing one flat row per line item instead would create
one shipment per line — several parcels where one was meant.

**DHL Hybrid** — shipment columns `[0]–[32]`, item columns `[33]–[48]`.
Continuation rows fill only `[31] SVP`, `[32] Insured Amount`, then `[33] SNo` onward, with `SNo`
counting 1, 2, 3… inside the shipment. In the sample, shipment 3 spans rows 4–5 and shipment 4
spans rows 6–11.

**DHL CSV** — shipment columns `[0]–[50]`, item columns `[51]–[67]`, then `[68]–[79]` for special
service, e-commerce and consignee tax fields.

**MCF** — the first row of an order carries all 26 columns; each extra SKU adds a row with only
`MerchantFulfillmentOrderID`, `MerchantSKU`, `Quantity`, `MerchantFulfillmentOrderItemID`.

**FedEx** — one row per shipment, and the commodity block is singular: `COMMODITY`, `HS CODE 1`,
`QUANTITY 1`, `UOM1`, `UNIT_VALUE 1`, `UNIT_Weight 1`. There is no visible second commodity slot on
this sheet, so a multi-line order either collapses into one description or uses the
`MPS Dimension` sheet. **Unresolved — ask before building the FedEx export.**

## Where each field comes from

The Shopify Orders tab already holds everything in the first group. The second group is the same on
every shipment and belongs in Settings. The third changes per shipment and nothing in the app knows
it yet.

**From the order** — receiver name, address 1/2/3, city, state, zip, country, phone, email, order
number, contents/description, weight (kg), declared value, quantity, per-unit rate.

**Company constants, seen in the samples** — Registration Number `AD0803210121871`, type `ARN`,
issuer `US`, Business Party Type `DC`, Shipper Reference `08ABIPR0673D1ZN`, Bank AD Code
`63905195000009`, HS Code (Export) `63049249`, Commodity Code (Import) `6302512000`, country of
manufacture `IN`, state `Rajasthan`, district `Jaipur`, IGST 5%, UOM `PCS`, Terms of Trade `DDP`,
Tax Payment Option `Against Bond or Undertaking`, Exporter Using Ecommerce `Yes`, SVP `No`.

**Per-shipment, and NOT yet anywhere in the app** — GST invoice number and date, NonGST invoice
number and date, FedEx invoice number and date, and the FedEx account numbers for
`Bill Shipment To` / `Bill Duties & Taxes To`. The samples show these incrementing by hand
(`262721946`, `262721946A`, `262721946B`…), which means a person is allocating them, not a formula.

## Country and state format, from the samples

The three couriers disagree, so the export cannot use one form:

- DHL Hybrid — `UNITED STATES OF AMERICA` (full name, upper case), state `PA`
- DHL CSV — `United States` (title case), state `AL`
- FedEx — `US` (2-letter), state `NH`
- MCF — `US` (2-letter), state `WA`

Shopify gives a 2-letter country code, so DHL's two forms have to be mapped through the
`Country Master` sheet in each workbook rather than guessed.
