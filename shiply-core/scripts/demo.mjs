// Fills a running Shiply Core with demo parcels at every stage, through the real API.
// Usage: node scripts/demo.mjs [http://localhost:4100]
// Needs the seed's demo accounts (SEED_DEMO_PASSWORD, default demo12345).
const API = process.argv[2] ?? process.env.API_URL ?? 'http://localhost:4100';
const PW = process.env.SEED_DEMO_PASSWORD ?? 'demo12345';
const ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@shiply.local', password: process.env.SEED_ADMIN_PASSWORD ?? 'admin12345' };

async function session(email, password = PW) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return async (path, body, method) => {
    const r = await fetch(`${API}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${path}: ${text}`);
    return text ? JSON.parse(text) : null;
  };
}

const NAMES = ['Mona Ali', 'Omar Said', 'Hana Youssef', 'Karim Adel', 'Laila Mostafa', 'Youssef Nabil', 'Salma Hassan', 'Ahmed Fathy', 'Nour Ibrahim', 'Tarek Samir', 'Dina Kamal', 'Mostafa Reda'];
let n = 0;
const phone = () => `010${String(10000000 + ++n * 7919).slice(0, 8)}`;

async function main() {
  const admin = await session(ADMIN.email, ADMIN.password);
  const merchant = await session('merchant@evechantelle.example');
  const sup = await session('staff.obr@shiply.local');
  const inb = await session('inbound.obr@shiply.local');
  const srt = await session('sorting.obr@shiply.local');
  const out = await session('outbound.obr@shiply.local');
  const alxIn = await session('inbound.alxsf@shiply.local');
  const giz = await session('staff.giz@shiply.local');
  const fm = await session('courier.obr@shiply.local');
  const cGiz = await session('courier.giz@shiply.local');
  const cCaie = await session('courier.caie@shiply.local');
  const caie = await session('staff.caie@shiply.local');

  const hubs = Object.fromEntries((await admin('/admin/hubs')).map((h) => [h.code, h.id]));
  const users = Object.fromEntries((await admin('/admin/users')).map((u) => [u.email, u.id]));
  const locs = await merchant('/reference/locations');
  const area = (gov, name) => locs.find((g) => g.code === gov).areas.find((a) => a.nameEn === name)?.id ?? null;
  const make = (gov, areaName, i, cod, size = 'M') =>
    merchant('/merchant/shipments', {
      customerName: NAMES[i % NAMES.length], customerPhone: phone(), address: `${10 + i} Main Street, ${areaName ?? gov}`,
      governorateCode: gov, areaId: areaName ? area(gov, areaName) : null, size, codAmount: cod, description: 'Skincare set', merchantRef: `EVE-${1000 + i}`,
    });

  const giza = [];
  for (let i = 0; i < 5; i++) giza.push(await make('GIZ', ['Dokki', 'Haram', 'Mohandessin', 'Sheikh Zayed', '6th of October'][i], i, (350 + i * 120) * 100));
  const alexandria = [];
  for (let i = 5; i < 7; i++) alexandria.push(await make('ALX', null, i, (500 + i * 50) * 100, 'L'));
  const nasr = [];
  for (let i = 7; i < 10; i++) nasr.push(await make('CAI', ['Nasr City', 'Heliopolis', 'New Cairo'][i - 7], i, (250 + i * 10) * 100, 'S'));
  const tanta = await make('GHR', null, 10, 45000);
  const waitingSort = await make('CAI', 'Maadi', 11, 19900);
  const notPicked = await make('CAI', 'Zamalek', 12, 27500);

  // First mile: pickup to the nearest facility (Obour), collected and received by inbound
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const pickup = await merchant('/merchant/pickups', { date: today, notes: 'Ring the bell at the warehouse door' });
  await sup(`/hubs/${hubs.OBR}/pickups/${pickup.id}/assign`, { courierId: users['courier.obr@shiply.local'] });
  const collected = [...giza, ...alexandria, ...nasr, tanta, waitingSort];
  for (const s of collected) await fm(`/courier/pickups/${pickup.id}/collect`, { code: s.trackingNumber });
  await fm(`/courier/pickups/${pickup.id}/finish`, {});
  for (const s of collected) await inb(`/hubs/${hubs.OBR}/inbound`, { code: s.trackingNumber });

  // Sorting puts each parcel on its lane; outbound scans each one into a bag, seals, loads the truck
  async function dispatch(to, list, { depart = true, bag: doBag = true } = {}) {
    for (const s of list) await srt(`/hubs/${hubs.OBR}/sort`, { code: s.trackingNumber });
    if (!doBag) return null;
    let bag;
    for (const s of list) bag = (await out(`/hubs/${hubs.OBR}/outbound/bag`, { code: s.trackingNumber })).bag;
    await out(`/hubs/${hubs.OBR}/bags/${bag.id}/seal`, {});
    if (!depart) return bag;
    const trip = await out(`/hubs/${hubs.OBR}/trips`, { destinationHubId: hubs[to], vehicle: 'ABC 1234', driverName: 'Sayed' });
    await out(`/hubs/${hubs.OBR}/trips/${trip.id}/load`, { code: bag.code });
    await out(`/hubs/${hubs.OBR}/trips/${trip.id}/depart`, {});
    return bag;
  }
  async function receive(agent, hub, bag, list) {
    await agent(`/hubs/${hubs[hub]}/receive-bag`, { code: bag.code });
    for (const s of list) await agent(`/hubs/${hubs[hub]}/inbound`, { code: s.trackingNumber });
  }
  const gizBag = await dispatch('GIZ', giza);
  const caiBag = await dispatch('CAI-E', nasr);
  const alxBag = await dispatch('ALXSF', alexandria);
  // Alexandria opens the bag but one parcel is not scanned yet: it shows on the handover check
  await alxIn(`/hubs/${hubs.ALXSF}/receive-bag`, { code: alxBag.code });
  await alxIn(`/hubs/${hubs.ALXSF}/inbound`, { code: alexandria[0].trackingNumber });
  await dispatch('DLT', [tanta], { depart: false }); // bagged and sealed, waiting for the truck
  await dispatch('CAI-S', [waitingSort], { bag: false }); // on lane CAI-S, waiting for outbound

  // Last mile Giza: deliver 3, one refused (on hold), one for tomorrow
  await receive(giz, 'GIZ', gizBag, giza);
  const run = await giz(`/hubs/${hubs.GIZ}/runs`, { courierId: users['courier.giz@shiply.local'] });
  for (const s of giza.slice(0, 4)) await giz(`/hubs/${hubs.GIZ}/runs/${run.id}/add`, { code: s.trackingNumber });
  await giz(`/hubs/${hubs.GIZ}/runs/${run.id}/start`, {});
  const stops = (await cGiz('/courier/run')).items;
  const stopFor = (s) => stops.find((x) => x.shipment.trackingNumber === s.trackingNumber);
  for (const s of giza.slice(0, 3)) await cGiz(`/courier/stops/${stopFor(s).id}/deliver`, { codCollected: s.codAmount, recipient: 'Customer' });
  await cGiz(`/courier/stops/${stopFor(giza[3]).id}/fail`, { reason: 'REFUSED', note: 'Said she did not order it' });
  await giz(`/hubs/${hubs.GIZ}/inbound`, { code: giza[3].trackingNumber });
  await giz(`/hubs/${hubs.GIZ}/runs/${run.id}/close`, { cashReceived: giza.slice(0, 3).reduce((x, s) => x + s.codAmount, 0) });

  // Merchant sends the refused one back: Giza bags it to Obour, inbound receives, sorting puts it on the return shelf
  await merchant(`/merchant/shipments/${giza[3].id}/decision`, { decision: 'RETURN' });
  const back = (await giz(`/hubs/${hubs.GIZ}/outbound/bag`, { code: giza[3].trackingNumber })).bag;
  await giz(`/hubs/${hubs.GIZ}/bags/${back.id}/seal`, {});
  const tripBack = await giz(`/hubs/${hubs.GIZ}/trips`, { destinationHubId: hubs.OBR, vehicle: 'Van 12' });
  await giz(`/hubs/${hubs.GIZ}/trips/${tripBack.id}/load`, { code: back.code });
  await giz(`/hubs/${hubs.GIZ}/trips/${tripBack.id}/depart`, {});
  await receive(inb, 'OBR', back, [giza[3]]);
  await srt(`/hubs/${hubs.OBR}/sort`, { code: giza[3].trackingNumber });

  // Nasr City: courier out now, one delivered, one no answer
  await receive(caie, 'CAI-E', caiBag, nasr);
  const run2 = await caie(`/hubs/${hubs['CAI-E']}/runs`, { courierId: users['courier.caie@shiply.local'] });
  for (const s of nasr) await caie(`/hubs/${hubs['CAI-E']}/runs/${run2.id}/add`, { code: s.trackingNumber });
  await caie(`/hubs/${hubs['CAI-E']}/runs/${run2.id}/start`, {});
  const stops2 = (await cCaie('/courier/run')).items;
  await cCaie(`/courier/stops/${stops2[0].id}/deliver`, { codCollected: stops2[0].shipment.codAmount, recipient: 'Customer' });
  await cCaie(`/courier/stops/${stops2[1].id}/fail`, { reason: 'NO_ANSWER' });

  await money({ admin, merchant, giz, cCaie, hubs });

  console.log(`Demo ready. Waiting for pickup: ${notPicked.trackingNumber}. On a lane at Obour: ${waitingSort.trackingNumber}. Bagged for Tanta: ${tanta.trackingNumber}. Not yet scanned at Alexandria: ${alexandria[1].trackingNumber}. Return shelf: ${giza[3].trackingNumber}.`);
}

/** Money: bank details, a payout waiting for a second person, a Fawry pay in, a safe deposit, opening balances, an expense. */
async function money({ admin, merchant, giz, cCaie, hubs }) {
  const finance = await session('finance@shiply.local');
  const receipt = { fileName: 'receipt.png', mime: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' };
  const today = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  await merchant('/merchant/bank', { bankName: 'CIB', bankAccountName: 'Eve Chantelle LLC', iban: 'EG380019000500000000263180002' }, 'PUT');
  const merchantId = (await merchant('/auth/me')).merchantId;
  try {
    await admin(`/finance/merchants/${merchantId}/payouts`, {});
  } catch (e) {
    console.log(`No payout yet: ${e.message}`);
  }
  const run = await cCaie('/courier/run');
  const cash = run?.items.filter((i) => i.result === 'DELIVERED').reduce((n, i) => n + i.codCollected, 0) ?? 0;
  if (run && cash > 0) await cCaie('/courier/pay-ins', { amount: cash, reference: 'FWR 4471', runId: run.id, receipt });
  const safe = await giz(`/hubs/${hubs.GIZ}/safe`);
  if (safe.available > 0) await giz(`/hubs/${hubs.GIZ}/safe/deposits`, { amount: safe.available, reference: 'CIB slip 20931', receipt });
  const j = await admin('/finance/journals', { date: today, memo: 'Opening bank balance', lines: [{ account: '1000', debit: 25000000 }, { account: '3000', credit: 25000000 }] });
  await finance(`/finance/journals/${j.id}/approve`, {});
  await admin('/finance/expenses', { date: today, accountCode: '5240', amount: 85000, supplier: 'Wataniya', note: 'Van fuel' });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
