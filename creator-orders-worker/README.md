# Creator orders — Creator Setu → ERP

```
Creator Setu (Netlify server)                       this Worker (Cloudflare)                 ERP
  team presses "Create order in ERP"  ── POST ──▶  key checked → fields checked  ──▶  Firestore creatorOrders/{reference}
  opens the returned url in a new tab  ◀── 200 ──  { ok, reference, url }                 Shopify → Content Creators (#creators)
```

The address and phone travel server to server only. The browser opens the order by its reference
(`https://fabricrush-replenish.web.app/#creators?ref=CGE-12AB34CD`), and the person must be signed in to the ERP.

## The door

```
POST https://creator-orders.erp-9a0.workers.dev/creator-orders
Authorization: Bearer <CREATOR_SETU_SECRET>
Content-Type: application/json
```

The body is the one in the spec (`erp-content-creators-for-umesh.md`, section 2.3). `brand` is `ridhi` or `cotton-print-club`.

| Answer | When |
|---|---|
| `200 { ok: true, reference, url }` | saved, or already there (`already: true`). Sending the same order twice is one order; an order already there is never overwritten. |
| `400 { ok: false, error: "zip is missing" }` | a field is missing or wrong — the message names it |
| `401 { ok: false, error: "unauthorized" }` | wrong or missing key — nothing is read or saved |
| `503 { ok: false, error: … }` | Firestore did not answer — send it again in a minute |

`GET /health` says whether it is set up (`firestore`, `key`), with no data.

Never written to the log: the address, phone or email. Only the reference and why.

## Switching it on (once)

1. **A service account that can write Firestore** — Google Cloud console, project `price-research-48ff3`:
   IAM & Admin → Service Accounts → Create, name `creator-orders`, role **Cloud Datastore User** → Keys → Add key → JSON.
   Keep the file safe; it is the key to the database. Delete the file from the computer once step 3 is done.
2. **The shared key** — Khushi makes a long random key (32+ characters) and gives it to Umesh privately, never in a group.
3. **Cloudflare** (from this folder, signed in with `npx wrangler login` to the erp@ridhihome.com account):
   ```
   npx wrangler secret put CREATOR_SETU_SECRET
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
   npx wrangler deploy
   ```
   For the second one, paste the whole JSON file's contents.
4. **Firestore rules** — the `creatorOrders` rule is in `Pricing-App/firestore.rules`. Deploy them:
   `firebase deploy --only firestore:rules` from `Pricing-App/`.
5. **Check:** `https://creator-orders.erp-9a0.workers.dev/health` shows `"firestore":true,"key":true`.
6. **Tell Khushi:** the address `https://creator-orders.erp-9a0.workers.dev/creator-orders`, that the key is set, and that
   the page link is `https://fabricrush-replenish.web.app/#creators?ref=<reference>`.

## Tests

No internet and no accounts are needed. Google's token door and Firestore are played by a fake.

```
node creator-orders-worker/test/worker.test.mjs
```

## Why it is not part of Meera's router

Meera's router promises it has no key to the ERP's data. This Worker holds one key, for one collection, and does only this.
