# Flowmerce app: how to sign in and read data

For the Flowmerce developer. The data lives in Supabase (the Ridhi ERP project), schema **`flowmerce`**.
Flowmerce can only reach that schema; the ERP's own data is not reachable with anything you are given.

## What you get
| Thing | Where it goes |
|---|---|
| Supabase project URL | Flowmerce server config (Render) |
| The **`flowmerce` publishable key** (`sb_publishable_…`) | Flowmerce server config (Render) |
| SQL files `sql/01…17` | the table structure, for reference |

You do **not** get the service role key, a database password or a Supabase dashboard login.

## Sign-in (email + password)
Accounts are created by the owner in Supabase (Authentication → Users), with a role and stores in `flowmerce.member`.
There is no sign-up page.

```js
const sb = createClient(SUPABASE_URL, FLOWMERCE_PUBLISHABLE_KEY, { db: { schema: 'flowmerce' }, auth: { persistSession: false } });
const { data, error } = await sb.auth.signInWithPassword({ email, password });
// data.session.access_token = this person's token (about 1 hour); data.session.refresh_token renews it
```

Keep the tokens on the Flowmerce server (for example in the server-side session). Don't send them to the browser.

## Every request: act as the person
```js
const asPerson = createClient(SUPABASE_URL, FLOWMERCE_PUBLISHABLE_KEY, {
  db: { schema: 'flowmerce' },
  global: { headers: { Authorization: `Bearer ${accessToken}` } },
});
const me = await asPerson.from('my_access').select('*');     // role, stores, sections, can_see_costs
const rows = await asPerson.from('shipment_list').select('*').limit(100);
```
- The database's rules (row-level security) answer **as that person**:
  - only their stores
  - costs hidden unless allowed
  - inactive people see nothing
  - Shopify changes need two people to approve
- The audit log records the person's name automatically.
- To renew an expired token: `sb.auth.refreshSession({ refresh_token })`.
- To change a password: `asPerson.auth.updateUser({ password })` (needs the person's session).

## People list
Use `flowmerce.member` (role `owner` / `admin` / `editor` / `viewer`, `is_active`, `all_stores`, `sections`,
`can_see_costs`) and `flowmerce.member_store`. Don't add a second list (`ops.people` / `seo.users`).
To remove someone, set `is_active = false`; their next request sees nothing.

## Screens
The Shipping screens read the same views as before, now in `flowmerce`: set `SHIPPING_SCHEMA=flowmerce`.
