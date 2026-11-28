/* THE WEBSITE-HOLD FIGURE, NOTED BY ITSELF ON THE TEST WEBSITE (28 Nov: "Make FBA list" must not send people to Shopify Orders).
 * Missing: noted from the shared copy when Finished Goods opens and before every FBA check; live is unchanged; when it cannot be
 * noted the refusal says why.   node tests/hold-auto-note-test.js      (teeth/teeth-hold-auto-note.js breaks copies) */
const { appFile, whole, cut, NOW, row, store, counts, check: ok } = require('./india-store-harness');
const ORDERS = 'shopify/shopify-orders.js', HOLD = 'inventory/fg-shop-hold.js', FGL = 'inventory/finished-goods.js';
const MISSING = /not known yet/;

/** A store whose website-hold figure is missing. o.testSite: the test website. noting: what the shared copy does when asked. */
function missing(o = {}) {
  const S = store(Object.assign({ web: 0 }, o));
  S.db._shopHold = { releases: {} };
  S.ctx.FGI.set = Object.assign({}, S.ctx.FGI.set, { _shopHold: { releases: {} } });
  S.calls = 0;
  S.ctx.soHoldNoteFromCopy = async () => {
    S.calls++;
    if (o.noteWhy) return o.noteWhy;
    S.db._shopHold = { SP: { at: NOW, skus: {} }, CPC: { at: NOW, skus: {} }, releases: {} };
    return '';
  };
  Object.assign(S.ctx, { renderFgi() { S.drawn = (S.drawn || 0) + 1; }, TAB_NOW: 'fgi' });
  return S;
}
/* the stored hold figure as Finished Goods now holds it */
const known = S => S.run('fgiHoldState().state') === 'ok';

(async () => {
  console.log('== before any FBA check ==');
  {
    const T = missing({ testSite: true });
    ok('test website: a missing figure is noted, then read', await T.ctx.fgiHoldReread() === '' && T.calls === 1 && known(T));
    ok('…and the refusal is gone', T.run('fgiHoldAgeWhy()') === '');
    const have = store({ testSite: true });
    have.calls = 0; have.ctx.soHoldNoteFromCopy = async () => { have.calls++; return ''; };
    ok('a figure that is there is left alone', await have.ctx.fgiHoldReread() === '' && have.calls === 0);
    const live = missing({});
    ok('live: nothing is noted, as before', await live.ctx.fgiHoldReread() === '' && live.calls === 0 && !known(live) && /Fetch orders/.test(live.run('fgiHoldAgeWhy()')));
    const why = missing({ testSite: true, noteWhy: 'Pieces held for website orders were not noted: UAT mode is off, so the figure cannot be kept on this PC.' });
    ok('it could not be noted: the reading goes on', await why.ctx.fgiHoldReread() === '' && why.calls === 1 && !known(why));
    const said = why.run('fgiHoldAgeWhy()');
    ok('…and the refusal says why, not "open Shopify Orders"', /UAT mode is off/.test(said) && /could not be noted from the shared copy/.test(said) && !/open the Shopify Orders tab/.test(said), said);
  }

  console.log('== when Finished Goods opens ==');
  {
    const T = missing({ testSite: true });
    await T.ctx.fgiHoldNoteOnOpen();
    ok('noted, read back, the list redrawn', T.calls === 1 && known(T) && T.drawn === 1);
    const live = missing({});
    await live.ctx.fgiHoldNoteOnOpen();
    ok('live: nothing', live.calls === 0 && !live.drawn);
    const off = missing({ testSite: true, hold: '0' });
    await off.ctx.fgiHoldNoteOnOpen();
    ok('switch off: nothing', off.calls === 0);
    const fails = missing({ testSite: true, noteWhy: 'x' });
    await fails.ctx.fgiHoldNoteOnOpen();
    ok('could not be noted: nothing redrawn, no error', fails.calls === 1 && !fails.drawn);
    const src = appFile(FGL);
    ok('the stock read calls it, and does not wait for it', /\n\s*if \(typeof fgiHoldNoteOnOpen === 'function'\) fgiHoldNoteOnOpen\(\);/.test(src));
  }

  console.log('== Make FBA list with the figure missing ==');
  {
    const { lists } = require('./hold-auto-note-lists');
    const S = lists({ testSite: true, admin: true });
    const make = () => S.make(2);
    ok('the first list is made, with no visit to Shopify Orders', await make() === '' && S.calls === 1, JSON.stringify(S.open()));
    const N = lists({ testSite: true, admin: true, noteWhy: 'Pieces held for website orders were not noted: this account may not read the shared copy of the orders — ask an admin for the Shopify right' });
    const said = await N.make(2);
    ok('it cannot be noted: nothing is saved and the exact reason is said', /Nothing was saved/.test(said) && /may not read the shared copy/.test(said) && Object.keys(N.open()).length === 0, said);
  }

  console.log('== the test website notes it ==');
  {
    const load = (o = {}) => {
      const log = [];
      const ctx = {
        window: o.uat === undefined ? { __UAT: { on: true } } : { __UAT: { on: o.uat } }, SHOP_STOCK_LOADED: !!o.stock, PTG_ALL: ['ob'],
        loadShopStock: async () => { log.push('stock'); if (o.stockFails) throw new Error('Amazon stock is unreadable'); ctx.SHOP_STOCK_LOADED = true; },
        loadShopIndia: async () => { log.push('india'); }, ptNeed: async () => { log.push('book'); },
        soHoldPublishCopy: async () => { log.push('publish'); return o.publishWhy || ''; }, console,
      };
      const keys = Object.keys(ctx);
      const rules = 'const SO_HOLD_NOT_NOTED = "Pieces held for website orders were not noted: ";\nlet SO_HOLD_NOTING = null;\n';
      const code = rules + cut(appFile(ORDERS), 'function soHoldNoteFromCopy', 'async function soHoldNoteRun') + whole(ORDERS, 'soHoldNoteRun') + '\n;return soHoldNoteFromCopy;';
      return { log, run: new Function(...keys, code)(...keys.map(k => ctx[k])) };
    };
    const a = load();
    ok('stock, India stock and the order book are read first, then the figure noted', await a.run() === '' && a.log.slice(-1)[0] === 'publish' && ['stock', 'india', 'book'].every(s => a.log.includes(s)), a.log.join());
    const seen = load({ stock: true });
    await seen.run();
    ok('Amazon stock already read: not read again', !seen.log.includes('stock'));
    const twice = load();
    await Promise.all([twice.run(), twice.run()]);
    ok('two asks at once: one run', twice.log.filter(s => s === 'publish').length === 1);
    const off = load({ uat: false });
    const why = await off.run();
    ok('UAT mode off: said, and nothing is read or written', /UAT mode is off/.test(why) && off.log.length === 0, why);
    ok('no UAT guard on the page (a test link): tried as normal', await load({ uat: undefined, }).run() === '');
    const bad = await load({ stockFails: true }).run();
    ok('something cannot be read: that is the reason', /Amazon stock is unreadable/.test(bad) && /^Pieces held for website orders were not noted: /.test(bad), bad);
    const pub = await load({ publishWhy: 'Pieces held for website orders were not noted: the shared copy has not been filled for this store' }).run();
    ok('the copy cannot answer: its reason comes back', /not been filled/.test(pub));

    const stockWhy = state => new Function(...Object.keys(state), cut(appFile(ORDERS), 'const soHoldStockWhy', '\n/**') + '\n;return soHoldStockWhy;')(...Object.values(state))();
    const base = { SHOP_INDIA_ERR: '', SHOP_STOCK_DENIED: false, SHOP_STOCK_LOADED: true, SHOP_INDIA_AT: 'x' };
    ok('stock reasons are exact', stockWhy(base) === '' && /India stock could not be read: no signal/.test(stockWhy(Object.assign({}, base, { SHOP_INDIA_ERR: 'no signal' })))
      && /may not read Amazon stock/.test(stockWhy(Object.assign({}, base, { SHOP_STOCK_DENIED: true }))) && /not been read yet/.test(stockWhy(Object.assign({}, base, { SHOP_STOCK_LOADED: false }))));
  }

  const { pass, fail } = counts();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL the suite stopped - ' + e.stack); process.exit(1); });
