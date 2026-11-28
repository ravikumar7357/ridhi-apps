/* Read-only check: can the server's key read ERP records and rights for the rules?  node --env-file=.env tools/rules-read-check.ts */
import { Db } from '../src/lib/db.ts';
import { SUPABASE_URL, processEnv } from '../src/lib/env.ts';
import { rulesFromDb } from '../src/erp/door.ts';

const r = rulesFromDb(new Db(SUPABASE_URL, processEnv('SUPABASE_SERVICE_KEY'), 'core'));
const rec: any = await r.getRecord('pt_masters/greigeRfd');
let perms: any = 'error';
try { const p: any = await r.fsDoc!('perms', 'ravi@thefabricrush.com'); perms = p ? { found: true, adminIsTrue: p.admin === true } : { found: false }; }
catch (e) { perms = 'error: ' + String((e as Error).message).slice(0, 120); }
console.log(JSON.stringify({ recordRead: rec && typeof rec === 'object' ? Object.keys(rec).length + ' items' : rec,
  superuserIsAdmin: await r.isAdmin('ravi@thefabricrush.com'), strangerIsAdmin: await r.isAdmin('nobody@example.com'),
  strangerIsVendor: await r.isVendor!('nobody@example.com'), permsDoc: perms }));
