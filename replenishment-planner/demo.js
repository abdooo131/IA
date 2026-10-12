/*
 * Example data for the planner. Every figure here is made up for demonstration.
 * buildDemo(endDate) returns sales history up to endDate (YYYY-MM-DD) plus stock balances.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlannerDemo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  var branches = [
    ['BR01', 'Maadi', 'daily', 1.35],
    ['BR02', 'New Cairo Mivida', 'daily', 1.25],
    ['BR03', 'Lake Town', 'daily', 0.9],
    ['BR04', 'Nasr City', 'daily', 1.0],
    ['BR05', 'Mohandessin', 'daily', 1.1],
    ['BR06', 'New Giza', 'daily', 0.85],
    ['BR07', 'Sheikh Zayed', 'daily', 0.95],
    ['BR08', '6th of October', 'daily', 0.8],
    ['BR09', 'Heliopolis', 'daily', 1.05],
    ['BR10', 'Alexandria', 'Sun,Tue,Thu', 1.15],
    ['BR11', 'Mansoura', 'Sun,Tue,Thu', 0.7]
  ];

  // code, name, unit, supplier, lead time, moq, pack, transfer multiple, cost EGP, shelf life
  var items = [
    ['RM001', 'Espresso beans, house blend', 'kg', 'Roastery Co.', 3, 10, 1, 0.5, 950, 60],
    ['RM002', 'Full cream milk', 'L', 'Delta Dairy', 1, 48, 12, 1, 45, 7],
    ['RM003', 'Oat milk', 'L', 'Plant Drinks', 5, 12, 6, 1, 180, 90],
    ['RM004', 'Whipping cream', 'L', 'Delta Dairy', 1, 6, 1, 1, 160, 10],
    ['RM005', 'Mascarpone', 'kg', 'Dairy Imports', 7, 10, 0.5, 0.5, 600, 30],
    ['RM006', 'Ladyfinger biscuits', 'kg', 'Bakery Supplies', 4, 6, 2, 1, 280, 120],
    ['RM007', 'Cocoa powder', 'kg', 'Bakery Supplies', 4, 2, 1, 0.5, 400, 365],
    ['RM008', 'Sugar', 'kg', 'Food Wholesale', 2, 25, 25, 1, 40, 720],
    ['RM009', 'Vanilla syrup', 'L', 'Syrup House', 10, 12, 6, 1, 350, 365],
    ['RM010', 'Caramel syrup', 'L', 'Syrup House', 10, 12, 6, 1, 350, 365],
    ['RM011', 'Chocolate sauce', 'kg', 'Syrup House', 10, 6, 2, 1, 300, 180],
    ['RM012', 'Ciabatta bread', 'pcs', 'City Bakery', 1, 20, 10, 1, 18, 2],
    ['RM013', 'Brioche buns', 'pcs', 'City Bakery', 1, 24, 12, 1, 12, 3],
    ['RM014', 'Turkey slices', 'kg', 'Deli Meats', 2, 5, 1, 0.5, 650, 10],
    ['RM015', 'Cheddar cheese', 'kg', 'Dairy Imports', 3, 5, 1, 0.5, 420, 30],
    ['RM016', 'Halloumi', 'kg', 'Dairy Imports', 3, 5, 1, 0.5, 500, 30],
    ['RM017', 'Tomatoes', 'kg', 'Fresh Produce', 1, 5, 1, 1, 25, 5],
    ['RM018', 'Lettuce', 'kg', 'Fresh Produce', 1, 3, 1, 0.5, 40, 4],
    ['RM019', 'Pesto', 'kg', 'Food Wholesale', 3, 2, 1, 0.5, 450, 20],
    ['RM020', 'Eggs', 'pcs', 'Fresh Produce', 1, 90, 30, 30, 5, 21],
    ['RM021', 'Cup 8oz', 'pcs', 'Pack Pro', 14, 5000, 1000, 50, 2.5, 0],
    ['RM022', 'Cup 12oz', 'pcs', 'Pack Pro', 14, 5000, 1000, 50, 3, 0],
    ['RM023', 'Cup lid', 'pcs', 'Pack Pro', 14, 5000, 1000, 50, 1, 0],
    ['RM024', 'Sandwich box', 'pcs', 'Pack Pro', 14, 2000, 500, 50, 4, 0],
    ['RM025', 'Dessert cup', 'pcs', 'Pack Pro', 14, 2000, 500, 50, 3.5, 0],
    ['RM026', 'Ice', 'kg', 'Ice Factory', 1, 50, 10, 5, 5, 3],
    ['RM027', 'Turkish coffee', 'kg', 'Roastery Co.', 3, 5, 1, 0.5, 500, 90]
  ];

  // code, name, madeAt, price EGP, avg daily units at an average branch, recipe
  var products = [
    ['P101', 'Espresso', 'BRANCH', 55, 20, [['RM001', 0.018], ['RM021', 1]]],
    ['P102', 'Americano', 'BRANCH', 65, 35, [['RM001', 0.018], ['RM022', 1], ['RM023', 1]]],
    ['P103', 'Latte', 'BRANCH', 85, 70, [['RM001', 0.018], ['RM002', 0.22], ['RM022', 1], ['RM023', 1]]],
    ['P104', 'Cappuccino', 'BRANCH', 80, 40, [['RM001', 0.018], ['RM002', 0.16], ['RM021', 1], ['RM023', 1]]],
    ['P105', 'Flat white', 'BRANCH', 85, 15, [['RM001', 0.027], ['RM002', 0.12], ['RM021', 1], ['RM023', 1]]],
    ['P106', 'Vanilla latte', 'BRANCH', 95, 25, [['RM001', 0.018], ['RM002', 0.2], ['RM009', 0.02], ['RM022', 1], ['RM023', 1]]],
    ['P107', 'Caramel macchiato', 'BRANCH', 100, 20, [['RM001', 0.018], ['RM002', 0.2], ['RM010', 0.02], ['RM022', 1], ['RM023', 1]]],
    ['P108', 'Iced latte', 'BRANCH', 90, 45, [['RM001', 0.018], ['RM002', 0.18], ['RM026', 0.15], ['RM022', 1], ['RM023', 1]]],
    ['P109', 'Oat latte', 'BRANCH', 110, 12, [['RM001', 0.018], ['RM003', 0.22], ['RM022', 1], ['RM023', 1]]],
    ['P110', 'Mocha', 'BRANCH', 100, 18, [['RM001', 0.018], ['RM002', 0.2], ['RM011', 0.03], ['RM022', 1], ['RM023', 1]]],
    ['P111', 'Turkish coffee', 'BRANCH', 50, 25, [['RM027', 0.009], ['RM008', 0.005], ['RM021', 1]]],
    ['P112', 'Hot chocolate', 'BRANCH', 85, 10, [['RM007', 0.025], ['RM002', 0.22], ['RM008', 0.01], ['RM022', 1], ['RM023', 1]]],
    ['P201', 'Turkey and cheddar sandwich', 'CK', 175, 18, [['RM013', 1], ['RM014', 0.06], ['RM015', 0.03], ['RM018', 0.015], ['RM017', 0.03], ['RM024', 1]]],
    ['P202', 'Halloumi pesto ciabatta', 'CK', 165, 14, [['RM012', 1], ['RM016', 0.07], ['RM019', 0.02], ['RM017', 0.03], ['RM018', 0.01], ['RM024', 1]]],
    ['P203', 'Egg and cheese brioche', 'CK', 110, 16, [['RM013', 1], ['RM020', 2], ['RM015', 0.025], ['RM024', 1]]],
    ['P204', 'Tiramisu', 'CK', 155, 14, [['RM005', 0.08], ['RM006', 0.04], ['RM004', 0.04], ['RM001', 0.006], ['RM007', 0.003], ['RM008', 0.015], ['RM020', 1], ['RM025', 1]]],
    ['P205', 'Chocolate mousse', 'CK', 130, 9, [['RM011', 0.05], ['RM004', 0.08], ['RM008', 0.01], ['RM020', 1], ['RM025', 1]]]
  ];

  // Egypt weekend is Friday and Saturday. Index = getUTCDay().
  var weekdayFactor = [0.95, 0.9, 0.9, 0.95, 1.15, 1.25, 1.2];

  function buildDemo(endDate, weeks) {
    var r = rng(1980);
    var m = String(endDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    var end = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var days = (weeks || 10) * 7;

    var data = {
      branches: branches.map(function (b) { return { code: b[0], name: b[1], deliveryDays: b[2] }; }),
      items: items.map(function (i) {
        return { code: i[0], name: i[1], unit: i[2], supplier: i[3], leadTimeDays: i[4], moq: i[5], packSize: i[6], transferMultiple: i[7], unitCost: i[8], shelfLifeDays: i[9] };
      }),
      products: products.map(function (p) { return { code: p[0], name: p[1], madeAt: p[2], price: p[3] }; }),
      bom: [],
      sales: [],
      stock: [],
      inTransit: [],
      openPOs: []
    };
    products.forEach(function (p) { p[5].forEach(function (l) { data.bom.push({ product: p[0], item: l[0], qty: l[1] }); }); });

    var useBranch = {}; // branch|item -> total over history
    var useCK = {};
    var useNet = {};
    for (var d = end - (days - 1) * DAY; d <= end; d += DAY) {
      var wf = weekdayFactor[new Date(d).getUTCDay()];
      branches.forEach(function (b) {
        products.forEach(function (p) {
          var mean = p[4] * b[3] * wf * (0.9 + 0.2 * r());
          var noise = (r() + r() + r() - 1.5) * 2 * Math.sqrt(mean) * 1.2;
          var q = Math.max(0, Math.round(mean + noise));
          if (!q) return;
          data.sales.push({ date: new Date(d).toISOString().slice(0, 10), branch: b[0], product: p[0], qty: q });
          p[5].forEach(function (l) {
            var u = q * l[1];
            useNet[l[0]] = (useNet[l[0]] || 0) + u;
            if (p[2] === 'CK') useCK[l[0]] = (useCK[l[0]] || 0) + u;
            else useBranch[b[0] + '|' + l[0]] = (useBranch[b[0] + '|' + l[0]] || 0) + u;
          });
        });
      });
    }

    function round(x, step) { return Math.max(0, Math.round(x / step) * step); }

    items.forEach(function (i) {
      var daily = (useNet[i[0]] || 0) / days;
      var cover = 2 + r() * 14; // days of stock at the main WH
      if (i[9] > 0) cover = Math.min(cover, i[9] * (0.3 + r() * 0.5));
      if (i[0] === 'RM005' || i[0] === 'RM009') cover = 1.5; // a couple of items running low
      if (i[0] === 'RM010') cover = 0.4; // not enough to cover every branch today
      data.stock.push({ location: 'MAIN', item: i[0], qty: round(daily * cover, i[7]) });
      var ck = (useCK[i[0]] || 0) / days;
      if (ck > 0) data.stock.push({ location: 'CK', item: i[0], qty: round(ck * r() * 0.6, i[7]) });
    });
    Object.keys(useBranch).forEach(function (k) {
      var parts = k.split('|');
      var it = items.find(function (i) { return i[0] === parts[1]; });
      var daily = useBranch[k] / days;
      data.stock.push({ location: parts[0], item: parts[1], qty: round(daily * (0.2 + r() * 1.6), it[7]) });
    });
    data.openPOs.push({ item: 'RM022', qty: 5000, due: new Date(end + 4 * DAY).toISOString().slice(0, 10) });
    data.openPOs.push({ item: 'RM001', qty: 20, due: new Date(end + 2 * DAY).toISOString().slice(0, 10) });
    return data;
  }

  return { buildDemo: buildDemo };
});
