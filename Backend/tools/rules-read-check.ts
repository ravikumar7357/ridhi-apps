/* Read-only check: can the server's key read ERP records for the rules?  node --env-file=.env tools/rules-read-check.ts */
import { Db } from '../src/lib/db.ts';
import { SUPABASE_URL, processEnv } from '../src/lib/env.ts';
import { rulesFromDb } from '../src/erp/door.ts';

const r = rulesFromDb(new Db(SUPABASE_URL, processEnv('SUPABASE_SERVICE_KEY'), 'core'));
const rec: any = await r.getRecord('pt_masters/greigeRfd');
console.log(JSON.stringify({ recordRead: rec && typeof rec === 'object' ? Object.keys(rec).length + ' items' : rec,
  superuserIsAdmin: await r.isAdmin('ravi@thefabricrush.com'), strangerIsAdmin: await r.isAdmin('nobody@example.com') }));
