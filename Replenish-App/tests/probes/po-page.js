/* Render the real greige PO page (gpoHtml, cut from the live page) with sample data, to look at. */
const fs = require('fs');
const mod = fs.readFileSync(__dirname + '/../../public/index.html', 'utf8').replace(/\r\n/g, '\n')
  .match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const grab = name => {
  const m = new RegExp('^(?:async )?(?:function ' + name + '\\s*\\(|const ' + name + '\\s*=)', 'm').exec(mod);
  if (!m) throw new Error('not found: ' + name);
  const L = mod.slice(m.index).split('\n'); const o = [L[0]];
  for (let i = 1; i < L.length; i++) { if (/^(?:async )?(?:function |const |let |\/\*|\$\(')/.test(L[i])) break; o.push(L[i]); }
  return o.join('\n');
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = n => Number(n).toLocaleString('en-IN');
const gpoHtml = new Function('esc', 'nf', ['gpoR2', 'gpoLineMoney', 'gpoTotals', 'gpoDmy', 'gpoMoney', 'gpoHtml'].map(grab).join('\n') + '\nreturn gpoHtml;')(esc, nf);
const po = { poNo: 'GPO-260921-01', date: '2026-09-21', deliveryDate: '2026-09-30',
  mill: { name: 'Good Mill (sample)', email: 'mill@example.com', phone: '98xxxxxx00' },
  terms: 'Payment 30 days.\nWidth to be checked on arrival.',
  lines: [{ greige: 'Greige Sheeting 67', rfd: 'Sheeting 62', metres: 1000, rate: 50, gstPct: 5 },
    { greige: 'Greige Cambric 48', rfd: 'Cambric', metres: 500, rate: 42.5, gstPct: 5 }] };
const out = process.argv[2] || 'po.html';
fs.writeFileSync(out, gpoHtml(po, { company: 'The Fabric Rush', address: '(your address)\nJaipur, Rajasthan',
  gstin: '(your GSTIN)', email: 'ravi@thefabricrush.com' }));
console.log('written', out);
