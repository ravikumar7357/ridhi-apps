/* The Greige Desk's order buckets: the board an order came from is read from its number first (SHP / ONL / Etsy), src only when the number says nothing. */
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(__dirname + '/../src/app/flow/flow-demand.js', 'utf8');
const a = src.indexOf('const FLOW_BOARDS'), b = src.indexOf('function flowRfdCover');
const ctx = {}; vm.createContext(ctx); vm.runInContext(src.slice(a, b) + ';this.f=flowBoardOf;', ctx);
let ok = 0; const eq = (r, want) => { assert.strictEqual(ctx.f(r), want, JSON.stringify(r)); ok++; };
eq({ orderNo: 'SHP-7862' }, 'shp'); eq({ orderNo: 'ONL-0123' }, 'onl'); eq({ orderNo: 'ETSY-55' }, 'onl');
eq({ orderNo: 'AMZ-24112026-01-AIR', src: 'SO' }, 'oth'); eq({ orderNo: 'B2B-9', src: 'SHP' }, 'oth');
eq({ orderNo: 'X-1', src: 'SHP' }, 'shp'); eq({ orderNo: '' }, 'oth');
console.log(ok + ' passed, 0 failed');
