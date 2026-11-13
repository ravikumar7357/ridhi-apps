/* DELTA SYNC — tell every browser to download one register again. WRITES (one line). Ravi runs it, nobody else.
 *   node sync-reset.js <register>            e.g. node sync-reset.js pt_orderBook
 * Use it after anything that edited a synced register by hand with no change note (a Firebase console edit, a script that
 * did not go through _noted-write.js): it writes pt_sync/_reset/<register> = server time, which every browser reads as
 * "the copy of this register is out of date" and downloads it whole once. Nothing else is touched.
 * Without a register name it only lists the eight registers. */
const NW = require('./_noted-write.js');

(async () => {
  const reg = process.argv[2];
  if (!reg || !NW.SYNC_NODES.includes(reg)) {
    console.log('usage: node sync-reset.js <register>\nregisters: ' + NW.SYNC_NODES.join(', '));
    process.exit(reg ? 1 : 0);
  }
  const at = await NW.token();
  const w = await NW.call(at, 'PATCH', '', { ['pt_sync/_reset/' + reg]: { '.sv': 'timestamp' } });
  console.log(w.status === 200 ? 'reset noted for ' + reg + ' at ' + new Date(Number(w.j && w.j['pt_sync/_reset/' + reg]) || Date.now()).toISOString()
    : 'FAILED ' + w.status + ' ' + JSON.stringify(w.j).slice(0, 200));
  process.exit(w.status === 200 ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
