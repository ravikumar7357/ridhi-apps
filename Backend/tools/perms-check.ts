/* Read-only: what does the server see for one account's rights?  node --env-file=.env tools/perms-check.ts <email>
 * Prints only yes/no values, never the document. */
import { Db } from '../src/lib/db.ts';
import { SUPABASE_URL, processEnv } from '../src/lib/env.ts';
import { rulesFromDb } from '../src/erp/door.ts';

const email = String(process.argv[2] || '').toLowerCase();
const r = rulesFromDb(new Db(SUPABASE_URL, processEnv('SUPABASE_SERVICE_KEY'), 'core'));
const p: any = await r.fsDoc!('perms', email);
console.log(JSON.stringify({ email, permsDocFound: !!p, admin: p?.admin === true, soApprove: p?.soApprove === true,
  vendor: await r.isVendor!(email), ptPermsAdmin: await r.isAdmin(email) }));
