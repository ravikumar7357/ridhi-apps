import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapOrder, noteFacts, orderNumber } from '../src/map.ts';

const money = (a: string) => ({ shopMoney: { amount: a, currencyCode: 'USD' }, presentmentMoney: { amount: a, currencyCode: 'USD' } });

const order = {
  id: 'gid://shopify/Order/9001', name: '#RBP9001', createdAt: '2026-11-20T10:00:00Z', updatedAt: '2026-11-23T10:00:00Z',
  processedAt: '2026-11-20T10:00:00Z', cancelledAt: null, cancelReason: null, test: false,
  displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', tags: ['vip'], sourceName: 'web',
  note: 'Replacement for #RBP8800 — call Mrs Smith on 555-1234. DONE', discountCodes: ['BF10'],
  currencyCode: 'USD', presentmentCurrencyCode: 'USD',
  subtotalPriceSet: money('80.00'), totalDiscountsSet: money('10.00'), totalShippingPriceSet: money('5.00'),
  totalTaxSet: money('0.00'), totalPriceSet: money('75.00'), totalRefundedSet: money('0.00'),
  shippingLine: { title: 'Express' },
  shippingAddress: { city: 'Austin', provinceCode: 'TX', countryCodeV2: 'US' },
  customerJourneySummary: { firstVisit: { landingPage: 'https://shop.example/products/q?utm_source=facebook&utm_campaign=bfcm', referrerUrl: 'https://facebook.com', utmParameters: null } },
  lineItems: { nodes: [{ id: 'gid://shopify/LineItem/1', sku: 'RBP-QLT-01', title: 'Quilt', variantTitle: 'King', quantity: 2,
    currentQuantity: 2, unfulfilledQuantity: 0, originalUnitPriceSet: { shopMoney: { amount: '40.00' } },
    totalDiscountSet: { shopMoney: { amount: '10.00' } }, product: { id: 'gid://shopify/Product/5', productType: 'Quilt' },
    variant: { id: 'gid://shopify/ProductVariant/7' } }] },
  fulfillments: [{ id: 'gid://shopify/Fulfillment/11', status: 'SUCCESS', displayStatus: 'DELIVERED',
    createdAt: '2026-11-21T08:00:00Z', updatedAt: '2026-11-23T09:00:00Z', inTransitAt: null, estimatedDeliveryAt: null,
    deliveredAt: '2026-11-23T09:00:00Z', service: { serviceName: 'Manual' },
    trackingInfo: [{ company: 'DHL Express', number: '1234567890', url: 'https://dhl/x' }],
    fulfillmentLineItems: { nodes: [{ quantity: 2, lineItem: { id: 'gid://shopify/LineItem/1' } }] },
    events: { nodes: [{ id: 'gid://shopify/FulfillmentEvent/111', status: 'DELIVERED', happenedAt: '2026-11-23T09:00:00Z', city: 'Austin', country: 'US' }] } }],
};

test('maps money, lines, parcels and UTMs', () => {
  const m = mapOrder(order) as any;
  assert.equal(m.external_id, 'gid://shopify/Order/9001');
  assert.equal(m.order_number, 9001);
  assert.equal(m.total, 75);
  assert.equal(m.p_total, 75);
  assert.equal(m.utm_source, 'facebook');
  assert.equal(m.utm_campaign, 'bfcm');
  assert.equal(m.ship_country, 'US');
  assert.equal(m.lines[0].unit_price, 40);
  assert.equal(m.lines[0].fulfilled_quantity, 2);
  assert.equal(m.fulfillments[0].carrier_name_raw, 'DHL Express');
  assert.deepEqual(m.fulfillments[0].tracking_numbers, ['1234567890']);
  assert.equal(m.fulfillments[0].lines[0].line_external_id, 'gid://shopify/LineItem/1');
  assert.equal(m.fulfillments[0].events.length, 1);
});

test('never passes on the note text, only the facts', () => {
  const m = mapOrder(order) as any;
  assert.equal(m.is_reship, true);
  assert.equal(m.reship_of_order_name, '#RBP8800');
  assert.equal(m.note_done, true);
  const all = JSON.stringify(m);
  assert.ok(!all.includes('Mrs Smith'), 'note text leaked');
  assert.ok(!all.includes('555-1234'), 'phone from note leaked');
  assert.equal('note' in m.raw, false);
});

test('a cancelled order has nothing left to ship', () => {
  const m = mapOrder({ ...order, cancelledAt: '2026-11-21T00:00:00Z',
    lineItems: { nodes: [{ ...order.lineItems.nodes[0], unfulfilledQuantity: 2 }] } }) as any;
  assert.equal(m.lines[0].fulfilled_quantity, 2);
});

test('helpers', () => {
  assert.equal(orderNumber('#CPC1234'), 1234);
  assert.equal(orderNumber(null), null);
  assert.deepEqual(noteFacts('', ['Reship']), { is_reship: true, reship_of_order_name: null, note_done: false });
  assert.equal(noteFacts('packed. DONE', []).note_done, true);
  assert.equal(noteFacts('not done yet', []).note_done, false);
  assert.equal(noteFacts('UNDONE', []).note_done, false);
});
