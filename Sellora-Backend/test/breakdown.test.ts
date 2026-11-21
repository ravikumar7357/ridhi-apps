import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldBreakdown, totals } from '../src/shopbreakdown.ts';

test("Shopify's total sales breakdown: sales on the order's day, refunds on the refund's day", () => {
  const orders = [
    // 20 Nov (Pacific): two items, $10 discount, $5 shipping, $3 tax
    { id: 1, created_at: '2026-11-20T10:00:00-08:00', financial_status: 'partially_refunded', total_discounts: '10.00', total_tax: '3.00',
      line_items: [{ price: '40.00', quantity: 2 }], shipping_lines: [{ price: '5.00', discounted_price: '5.00' }],
      // refunded on 21 Nov: one item ($35 after its share of the discount) with $1.50 tax, and the shipping
      refunds: [{ created_at: '2026-11-21T09:00:00-08:00', refund_line_items: [{ subtotal: '35.00', total_tax: '1.50', quantity: 1 }],
        order_adjustments: [{ kind: 'shipping_refund', amount: '-5.00', tax_amount: '0.00' }] }] },
    // an OLD order (18 Nov, before the window) refunded on 20 Nov: only the refund counts in the window
    { id: 2, created_at: '2026-11-18T10:00:00-08:00', financial_status: 'refunded', total_discounts: '0', total_tax: '0',
      line_items: [{ price: '20.00', quantity: 1 }], shipping_lines: [],
      refunds: [{ created_at: '2026-11-20T12:00:00-08:00', refund_line_items: [{ subtotal: '20.00', total_tax: '0', quantity: 1 }], order_adjustments: [] }] },
    // 21 Nov: placed and cancelled unpaid the same day — a sale and its reversal
    { id: 3, created_at: '2026-11-21T08:00:00-08:00', cancelled_at: '2026-11-21T08:30:00-08:00', financial_status: 'voided', total_discounts: '0', total_tax: '1.00',
      line_items: [{ price: '25.00', quantity: 1 }], shipping_lines: [{ price: '4.00' }], refunds: [] },
    // a test order never counts
    { id: 4, test: true, created_at: '2026-11-21T08:00:00-08:00', total_discounts: '0', total_tax: '0', line_items: [{ price: '999', quantity: 1 }] },
  ];
  const b = foldBreakdown(orders, '2026-11-19');
  assert.deepEqual([...b.keys()].sort(), ['2026-11-20', '2026-11-21']);
  const d20 = b.get('2026-11-20')!, d21 = b.get('2026-11-21')!;
  assert.deepEqual(d20, { orders: 1, gross: 80, discounts: 10, returns: 20, shipping: 5, taxes: 3 });
  assert.deepEqual(totals(d20), { net: 50, total: 58 });
  assert.deepEqual(d21, { orders: 1, gross: 25, discounts: 0, returns: 60, shipping: -5, taxes: -1.5 });
  assert.deepEqual(totals(d21), { net: -35, total: -41.5 });
});
