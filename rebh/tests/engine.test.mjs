import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, orderEconomics, normaliseStatus, STATUS, DEFAULT_SETTINGS } from '../js/engine.js';
import { parseCsv, readOrders, applyCourier, readAds, readCosts, toDate } from '../js/csv.js';
import { sampleData } from '../js/sample.js';

const settings = { ...DEFAULT_SETTINGS, packagingPerOrder: 10, codFeePct: 1, cardFeePct: 2, defaultReturnFee: 40, defaultCostPct: 40, fixedExpenses: 0, productCosts: { Shirt: 300 } };

test('delivered COD order: price minus cost, shipping, packaging and COD fee', () => {
  const e = orderEconomics({ id: '1', product: 'Shirt', qty: 1, total: 1000, status: STATUS.DELIVERED, payment: 'cod', shippingFee: 70 }, settings);
  assert.equal(e.revenue, 1000);
  assert.equal(e.productCost, 300);
  assert.equal(e.paymentFee, 10);
  assert.equal(e.net, 1000 - 300 - 70 - 10 - 10);
});

test('returned order costs both trips and packaging, earns nothing', () => {
  const e = orderEconomics({ id: '2', product: 'Shirt', qty: 1, total: 1000, status: STATUS.RETURNED, shippingFee: 70, returnFee: 35 }, settings);
  assert.equal(e.revenue, 0);
  assert.equal(e.productCost, 0);
  assert.equal(e.net, -(70 + 35 + 10));
});

test('returned order without its own return fee uses the default', () => {
  const e = orderEconomics({ id: '3', product: 'Shirt', total: 1000, status: STATUS.RETURNED, shippingFee: 70, returnFee: '' }, settings);
  assert.equal(e.returnFee, 40);
});

test('unknown product cost falls back to a share of the price', () => {
  const e = orderEconomics({ id: '4', product: 'Hat', qty: 2, total: 600, status: STATUS.DELIVERED, payment: 'card', shippingFee: 0 }, settings);
  assert.equal(e.productCost, 240);
  assert.equal(e.paymentFee, 12);
});

test('in transit and cancelled orders do not touch profit', () => {
  const t = orderEconomics({ id: '5', total: 500, status: STATUS.IN_TRANSIT, shippingFee: 70 }, settings);
  const c = orderEconomics({ id: '6', total: 500, status: STATUS.CANCELLED, shippingFee: 70 }, settings);
  assert.equal(t.net, 0);
  assert.equal(t.pending, true);
  assert.equal(c.net, 0);
});

test('status words from stores and couriers', () => {
  assert.equal(normaliseStatus('Delivered'), STATUS.DELIVERED);
  assert.equal(normaliseStatus('Returned to sender'), STATUS.RETURNED);
  assert.equal(normaliseStatus('RTO'), STATUS.RETURNED);
  assert.equal(normaliseStatus('Customer refused'), STATUS.RETURNED);
  assert.equal(normaliseStatus('Out for delivery'), STATUS.IN_TRANSIT);
  assert.equal(normaliseStatus('Undelivered'), STATUS.IN_TRANSIT);
  assert.equal(normaliseStatus('Cancelled'), STATUS.CANCELLED);
  assert.equal(normaliseStatus(''), STATUS.IN_TRANSIT);
});

test('summary adds up and the money walk lands on net profit', () => {
  const orders = [
    { id: 'a', date: '2026-10-01', product: 'Shirt', qty: 1, total: 1000, status: 'delivered', payment: 'cod', shippingFee: 70, campaign: 'C1' },
    { id: 'b', date: '2026-10-01', product: 'Shirt', qty: 1, total: 1000, status: 'returned', shippingFee: 70, returnFee: 35, campaign: 'C1' },
    { id: 'c', date: '2026-10-02', product: 'Shirt', qty: 1, total: 1000, status: 'in_transit', shippingFee: 70 },
  ];
  const ads = [{ date: '2026-10-01', campaign: 'C1', spend: 200, reportedValue: 2000 }];
  const r = analyse(orders, ads, { ...settings, fixedExpenses: 3000 });
  const s = r.summary;
  assert.equal(s.bookedSales, 3000);
  assert.equal(s.revenue, 1000);
  assert.equal(s.days, 2);
  assert.equal(s.fixed, 200); // 3000 a month, 2 of 30 days
  assert.equal(s.netProfit, 1000 - 300 - 140 - 35 - 20 - 10 - 200 - 200);
  const walk = r.waterfall.filter((w) => !w.total).reduce((t, w) => t + w.value, s.bookedSales);
  assert.ok(Math.abs(walk - s.netProfit) < 0.01, `walk ${walk} vs net ${s.netProfit}`);
  assert.equal(s.returnRate, 0.5);
  assert.equal(r.campaigns[0].reportedRoas, 10);
  assert.equal(r.campaigns[0].trueRoas, 5);
  const dailyNet = r.daily.reduce((t, d) => t + d.net, 0);
  assert.ok(Math.abs(dailyNet - s.netProfit) < 0.01, 'daily rows add up to net profit');
});

test('sample store produces a believable picture', () => {
  const { orders, ads, productCosts } = sampleData();
  const r = analyse(orders, ads, { ...DEFAULT_SETTINGS, productCosts });
  const s = r.summary;
  assert.equal(s.days, 30);
  assert.ok(s.ordersBooked > 1200 && s.ordersBooked < 2000, `orders ${s.ordersBooked}`);
  assert.ok(s.netProfit > 0 && s.netProfit < s.bookedSales * 0.35, `net ${s.netProfit}`);
  assert.ok(s.trueRoas < s.reportedRoas, 'true ROAS below the reported one');
  assert.ok(s.returnRate > 0.08 && s.returnRate < 0.3, `returns ${s.returnRate}`);
  assert.ok(r.checks.length >= 1);
  const walk = r.waterfall.filter((w) => !w.total).reduce((t, w) => t + w.value, s.bookedSales);
  assert.ok(Math.abs(walk - s.netProfit) < 0.5);
});

test('CSV parser handles quotes, commas inside quotes and a BOM', () => {
  const rows = parseCsv('﻿Name,Total\n"#1,a","1,200"\n"say ""hi""",5\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Name, '#1,a');
  assert.equal(rows[0].Total, '1,200');
  assert.equal(rows[1].Name, 'say "hi"');
});

test('CSV parser detects semicolons and keeps commas in fields', () => {
  const rows = parseCsv('order;product\n1;Shirt, blue\n');
  assert.equal(rows[0].product, 'Shirt, blue');
});

test('store export rows with the same order number merge into one order', () => {
  const rows = parseCsv('Name,Created at,Lineitem name,Lineitem quantity,Lineitem price,Total,Payment Method,Shipping City\n#1001,2026-10-01 12:00:00 +0200,Shirt,1,500,900,Cash on Delivery (COD),Cairo\n#1001,2026-10-01 12:00:00 +0200,Tee,1,400,,,\n#1002,02/10/2026,Tee,2,400,800,Paymob,Giza\n');
  const orders = readOrders(rows);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].qty, 2);
  assert.equal(orders[0].total, 900);
  assert.equal(orders[0].payment, 'cod');
  assert.equal(orders[0].zone, 'Cairo');
  assert.equal(orders[1].payment, 'card');
  assert.equal(orders[1].date, '2026-10-02');
});

test('courier statement updates status and fees', () => {
  const orders = readOrders(parseCsv('order,date,product,total\n#1,2026-10-01,Shirt,500\n#2,2026-10-01,Shirt,500\n'));
  const n = applyCourier(orders, parseCsv('Business Reference,State,Fees,RTO fee\n1,Delivered,65,\n2,Returned to origin,65,30\n9,Delivered,60,\n'));
  assert.equal(n, 2);
  assert.equal(orders[0].status, STATUS.DELIVERED);
  assert.equal(orders[1].status, STATUS.RETURNED);
  assert.equal(orders[1].returnFee, 30);
});

test('ad export and cost sheet', () => {
  const ads = readAds(parseCsv('Day,Campaign name,Amount spent (EGP),Purchases conversion value\n2026-10-01,Retargeting,900,4200\n'));
  assert.deepEqual(ads[0], { date: '2026-10-01', campaign: 'Retargeting', spend: 900, reportedValue: 4200 });
  assert.deepEqual(readCosts(parseCsv('product,cost\nShirt,300\n')), { Shirt: 300 });
  assert.equal(toDate('2026-1-5'), '2026-01-05');
});
