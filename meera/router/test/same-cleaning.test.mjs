/* The page cleans a question before it leaves (meera/client/src/legacy/guide-ai.js, gaClean) and the router cleans it
 * again (src/redact.js, clean). They must agree: this runs both on the same questions.  node meera-router/test/same-cleaning.test.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { clean } from '../src/redact.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(HERE, '..', '..', 'client', 'src', 'legacy', 'guide-ai.js'), 'utf8');
const a = src.indexOf('function gaClean('), b = src.indexOf('\nfunction gaNames(');
if (a < 0 || b < 0) { console.log('FAIL gaClean not found in guide-ai.js'); process.exit(1); }
const gaClean = new Function(src.slice(a, b) + '\nreturn gaClean;')();

const names = ['Ramesh Kumar', 'Sita', 'Ikram Khan'];
const Q = [
  'Ramesh Kumar ka order SHP-3365 kahan hai, phone 98765 43210',
  'mail a.b@x.com pe bhejo AMZ-15102026-01 aur #RBP7578',
  'GSTIN 27ABCDE1234F1Z5 PAN ABCDE1234F',
  'CPC008-04 ke 50 piece Ikram Khan ko de diye, AWB 123456789',
  'sita ne LEG-17102026-01 pe cutting ki', 'kaise kare 10 20 30 pieces', 'cover days kaise nikalta hai',
  'Ramesh Kumar ko ₹4,500 diye order 1234 ke liye', 'Rs. 1200 ka bill no 77, 500 rupaye, 1200/- pending', 'challan no: 88 ka maal, invoice #312',
];
let fail = 0;
for (const q of Q) { const x = clean(q, names), y = gaClean(q, names); if (x !== y) { fail++; console.log('FAIL differs:\n  router:', x, '\n  page:  ', y); } }
console.log(`same-cleaning: ${Q.length - fail} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
