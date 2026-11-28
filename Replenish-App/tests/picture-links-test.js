/* PICTURE LINKS (28 Nov): an article whose picture field is not a web link shows the next picture, never a broken one.
 *   node tests/picture-links-test.js        PL_FILE=<broken custom-order-skus.js> runs it against a broken copy. */
const fs = require('fs'), path = require('path');
const FILE = process.env.PL_FILE || path.join(__dirname, '..', 'src', 'app', 'orders', 'custom-order-skus.js');
const src = fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
const part = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + 1); if (a < 0 || b < 0) throw new Error('not found: ' + from); return src.slice(a, b); };
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  PASS ' + name); } else { fail++; console.log('  FAIL ' + name + (extra === undefined ? '' : ' - ' + extra)); } };
const code = part('let _imgOwnMap', '/* B2B PICTURES') + part('let _imgLineMap', '/**\n * The picture at the size');
const make = (mdb, amazon = {}) => new Function('PTG', 'MDBX', 'B2BIMG', 'MDBIMG', 'PTIMG', 'IMG_NONE', 'obUC', 'ptPeek',
  code + '\n;return { ptImgOf, ptImgOwn };')({ mdb, ob: [] }, { custom: [] }, { map: {} }, { map: amazon }, { map: {} }, 'NONE',
  s => String(s || '').trim().toUpperCase(), undefined);
const A = make([{ sku: 'a', imageUrl: '710' }, { sku: 'b', imageUrl: 'https://x.test/p.jpg' }, { sku: 'c', imageUrl: ' data:image/png;base64,AA ' },
  { sku: 'd', imageUrl: 719 }, { sku: 'e', imageUrl: 'https://kommodo.ai/i/abc' }], { A: 'https://amazon.test/a.jpg' });
ok('a number is passed over for the Amazon picture', A.ptImgOf('a') === 'https://amazon.test/a.jpg', A.ptImgOf('a'));
ok('a web link is used', A.ptImgOf('b') === 'https://x.test/p.jpg');
ok('a data picture is used, spaces trimmed', A.ptImgOf('c') === 'data:image/png;base64,AA', A.ptImgOf('c'));
ok('a stored number gives no broken picture', !A.ptImgOf('d'), A.ptImgOf('d'));
ok('a share page is not a picture', !A.ptImgOf('e'), A.ptImgOf('e'));
ok('only real links count as the article\'s own, so the others are still looked up', [...A.ptImgOwn().keys()].join() === 'B,C');
ok('the lookup skips only articles with a real picture', src.includes('const own = ptImgOwn();'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
