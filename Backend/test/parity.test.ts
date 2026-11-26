import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffJson, describe } from '../src/lib/parity.ts';

test('same answers: no differences', () => {
  assert.deepEqual(diffJson({ ok: true, rows: [{ a: 1 }] }, { rows: [{ a: 1 }], ok: true }), []);
});

test('a changed value, a missing key and a different row count are all reported with their path', () => {
  const d = diffJson({ ok: true, n: 2, rows: [{ sku: 'A' }, { sku: 'B' }] }, { ok: true, rows: [{ sku: 'X' }] });
  const paths = d.map(x => x.path);
  assert.ok(paths.includes('n'));
  assert.ok(paths.includes('rows.length'));
  assert.ok(paths.includes('rows[0].sku'));
});

test('ignored fields: by name anywhere, or by path inside every row', () => {
  const a = { ok: true, at: '10:00', rows: [{ sku: 'A', at: 1 }], meta: { at: 'x' } };
  const b = { ok: true, at: '10:05', rows: [{ sku: 'A', at: 2 }], meta: { at: 'y' } };
  assert.deepEqual(diffJson(a, b, { ignore: ['at'] }), []);
  const onlyRows = diffJson(a, b, { ignore: ['rows[].at'] }).map(x => x.path).sort();
  assert.deepEqual(onlyRows, ['at', 'meta.at']);
});

test('money sums may differ by the tolerance and no more', () => {
  assert.deepEqual(diffJson({ s: 100.10 }, { s: 100.1000001 }, { tolerance: 0.001 }), []);
  assert.equal(diffJson({ s: 100.10 }, { s: 100.2 }, { tolerance: 0.001 }).length, 1);
});

test('a type change (number vs text) is a difference, and describe() reads in plain words', () => {
  const d = diffJson({ qty: 5 }, { qty: '5' });
  assert.equal(d.length, 1);
  assert.match(describe(d), /qty: Apps Script 5 {2}→ {2}new "5"/);
  assert.equal(describe([]), 'Same answer.');
});
