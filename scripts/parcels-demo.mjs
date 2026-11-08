// Fills Shiply (next day parcels) with demo parcels at every stage, through the real API and the
// seed's demo accounts: a pickup collected and received at Obour, sorted and bagged to the
// Giza and Nasr City hubs, delivered with the receiver's code, one refused and sent back, one
// courier still out, one parcel waiting on a lane and one not picked up yet.
// Usage: SEED_DEMO_PASSWORD=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/parcels-demo.mjs https://<site>
// On your own computer: pnpm db:demo:parcels (reads .env; the admin defaults to SEED_ADMIN_*).
// Only Cairo and Giza are served at launch, so every parcel goes there.
const SITE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
const PW = process.env.SEED_DEMO_PASSWORD;
const ADMIN = {
  email: process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD,
};
if (!PW || !ADMIN.email || !ADMIN.password)
  throw new Error('Set SEED_DEMO_PASSWORD, ADMIN_EMAIL and ADMIN_PASSWORD');

async function session(email, password = PW) {
  const res = await fetch(`${SITE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  return async (path, body, method) => {
    const r = await fetch(`${SITE}/api/parcels${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${path}: ${r.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
}

const NAMES = [
  'Mona Ali',
  'Omar Said',
  'Hana Youssef',
  'Karim Adel',
  'Laila Mostafa',
  'Youssef Nabil',
  'Salma Hassan',
  'Ahmed Fathy',
  'Nour Ibrahim',
  'Tarek Samir',
  'Dina Kamal',
  'Mostafa Reda',
];
let n = 0;
const phone = () => `010${String(10000000 + ++n * 7919 + (Date.now() % 1000)).slice(0, 8)}`;

async function main() {
  const admin = await session(ADMIN.email, ADMIN.password);
  const merchant = await session('merchant@evechantelle.example');
  const sup = await session('staff.obr@shiply.local');
  const inb = await session('inbound.obr@shiply.local');
  const srt = await session('sorting.obr@shiply.local');
  const out = await session('outbound.obr@shiply.local');
  const giz = await session('staff.giz@shiply.local');
  const caie = await session('staff.caie@shiply.local');
  const fm = await session('courier.obr@shiply.local');
  const cGiz = await session('courier.giz@shiply.local');
  const cCaie = await session('courier.caie@shiply.local');

  const hubs = Object.fromEntries((await admin('/admin/hubs')).map((h) => [h.code, h.id]));
  const users = Object.fromEntries((await admin('/admin/users')).map((u) => [u.email, u.id]));
  const locs = await merchant('/reference/locations');
  const area = (gov, name) =>
    locs.find((g) => g.code === gov)?.areas.find((a) => a.nameEn === name)?.id ?? null;
  const make = (gov, areaName, i, cod, size = 'M') =>
    merchant('/merchant/shipments', {
      customerName: NAMES[i % NAMES.length],
      customerPhone: phone(),
      address: `${10 + i} Main Street, ${areaName}`,
      governorateCode: gov,
      areaId: area(gov, areaName),
      size,
      codAmount: cod,
      description: 'Skincare set',
      merchantRef: `EVE-${Date.now() % 100000}-${i}`,
    });
  // The receiver's code, read from the message outbox (no SMS gateway in the demo).
  const codeOf = async (s) => {
    const msgs = await admin('/admin/messages');
    const m = msgs.find((x) => x.template === 'DELIVERY_CODE' && x.body.includes(s.trackingNumber));
    return m?.body.match(/هو (\d{4,6})/)?.[1];
  };

  const gizaAreas = ['Dokki', 'Haram', 'Mohandessin', 'Sheikh Zayed', '6th of October'];
  const giza = [];
  for (let i = 0; i < 5; i++)
    giza.push(await make('EG-GZ', gizaAreas[i], i, (350 + i * 120) * 100));
  const nasrAreas = ['Nasr City', 'Heliopolis', 'New Cairo'];
  const nasr = [];
  for (let i = 0; i < 3; i++)
    nasr.push(await make('EG-C', nasrAreas[i], 7 + i, (250 + i * 10) * 100, 'S'));
  const waitingSort = await make('EG-C', 'Maadi', 11, 19900);
  const notPicked = await make('EG-C', 'Zamalek', 12, 27500);

  // First mile: a pickup at the merchant, collected and received by Obour's inbound team.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const pickup = await merchant('/merchant/pickups', {
    date: today,
    notes: 'Ring the bell at the warehouse door',
  }).catch(async (e) => {
    // One pickup per day: a second run of the demo uses today's.
    if (!String(e.message).includes('duplicate')) throw e;
    const all = await merchant('/merchant/pickups');
    return (Array.isArray(all) ? all : all.items).find((p) => p.date === today);
  });
  await sup(`/hubs/${hubs.OBR}/pickups/${pickup.id}/assign`, {
    courierId: users['courier.obr@shiply.local'],
  });
  const collected = [...giza, ...nasr, waitingSort];
  for (const s of collected)
    await fm(`/courier/pickups/${pickup.id}/collect`, { code: s.trackingNumber });
  await fm(`/courier/pickups/${pickup.id}/finish`, {});
  for (const s of collected) await inb(`/hubs/${hubs.OBR}/inbound`, { code: s.trackingNumber });

  // Sorting puts each parcel on its lane; outbound bags, seals and loads the truck.
  async function dispatch(to, list, { bag: doBag = true } = {}) {
    for (const s of list) await srt(`/hubs/${hubs.OBR}/sort`, { code: s.trackingNumber });
    if (!doBag) return null;
    let bag;
    for (const s of list)
      bag = (await out(`/hubs/${hubs.OBR}/outbound/bag`, { code: s.trackingNumber })).bag;
    await out(`/hubs/${hubs.OBR}/bags/${bag.id}/seal`, {});
    const trip = await out(`/hubs/${hubs.OBR}/trips`, {
      destinationHubId: hubs[to],
      vehicle: 'ABC 1234',
      driverName: 'Sayed',
    });
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
  await dispatch('CAI-S', [waitingSort], { bag: false }); // on its lane, waiting for outbound

  // Giza: the courier checks in, delivers 3, one refused, one stays for tomorrow.
  const photo = Buffer.from('demo check in photo').toString('base64');
  await cGiz('/courier/check-in', { photoBase64: photo, lat: 30.04, lng: 31.21 }).catch(() => null);
  await receive(giz, 'GIZ', gizBag, giza);
  const run = await giz(`/hubs/${hubs.GIZ}/runs`, { courierId: users['courier.giz@shiply.local'] });
  for (const s of giza.slice(0, 4))
    await giz(`/hubs/${hubs.GIZ}/runs/${run.id}/add`, { code: s.trackingNumber });
  await giz(`/hubs/${hubs.GIZ}/runs/${run.id}/start`, {});
  const stops = (await cGiz('/courier/run')).items;
  const stopFor = (s) => stops.find((x) => x.shipment.trackingNumber === s.trackingNumber);
  for (const s of giza.slice(0, 3))
    await cGiz(`/courier/stops/${stopFor(s).id}/deliver`, {
      codCollected: s.codAmount,
      recipient: 'Customer',
      code: await codeOf(s),
    });
  await cGiz(`/courier/stops/${stopFor(giza[3]).id}/fail`, {
    reason: 'REFUSED',
    note: 'Said she did not order it',
  });
  await giz(`/hubs/${hubs.GIZ}/inbound`, { code: giza[3].trackingNumber });
  await giz(`/hubs/${hubs.GIZ}/runs/${run.id}/close`, {
    cashReceived: giza.slice(0, 3).reduce((x, s) => x + s.codAmount, 0),
  });

  // The merchant sends the refused one back to Obour, where it waits on the return shelf.
  await merchant(`/merchant/shipments/${giza[3].id}/decision`, { decision: 'RETURN' });
  const back = (await giz(`/hubs/${hubs.GIZ}/outbound/bag`, { code: giza[3].trackingNumber })).bag;
  await giz(`/hubs/${hubs.GIZ}/bags/${back.id}/seal`, {});
  const tripBack = await giz(`/hubs/${hubs.GIZ}/trips`, {
    destinationHubId: hubs.OBR,
    vehicle: 'Van 12',
  });
  await giz(`/hubs/${hubs.GIZ}/trips/${tripBack.id}/load`, { code: back.code });
  await giz(`/hubs/${hubs.GIZ}/trips/${tripBack.id}/depart`, {});
  await receive(inb, 'OBR', back, [giza[3]]);
  await srt(`/hubs/${hubs.OBR}/sort`, { code: giza[3].trackingNumber });

  // Nasr City: the courier is still out; one delivered, one no answer.
  await cCaie('/courier/check-in', { photoBase64: photo, lat: 30.06, lng: 31.33 }).catch(
    () => null,
  );
  await receive(caie, 'CAI-E', caiBag, nasr);
  const run2 = await caie(`/hubs/${hubs['CAI-E']}/runs`, {
    courierId: users['courier.caie@shiply.local'],
  });
  for (const s of nasr)
    await caie(`/hubs/${hubs['CAI-E']}/runs/${run2.id}/add`, { code: s.trackingNumber });
  await caie(`/hubs/${hubs['CAI-E']}/runs/${run2.id}/start`, {});
  const stops2 = (await cCaie('/courier/run')).items;
  const first = nasr.find((s) => s.trackingNumber === stops2[0].shipment.trackingNumber);
  await cCaie(`/courier/stops/${stops2[0].id}/deliver`, {
    codCollected: stops2[0].shipment.codAmount,
    recipient: 'Customer',
    code: await codeOf(first),
  });
  await cCaie(`/courier/stops/${stops2[1].id}/fail`, { reason: 'NO_ANSWER' });

  console.log(
    `Parcels demo ready. Waiting for pickup: ${notPicked.trackingNumber}. On a lane at Obour: ${waitingSort.trackingNumber}. Return shelf at Obour: ${giza[3].trackingNumber}. Courier out in Nasr City: ${stops2[2].shipment.trackingNumber}.`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
