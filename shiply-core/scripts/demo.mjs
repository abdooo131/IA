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
  const caie = await session('staff.caie@shiply.local');
  const sort = await session('staff.sort@shiply.local');
  const giz = await session('staff.giz@shiply.local');
  const alx = await session('staff.alx@shiply.local');
  const cCaie = await session('courier.caie@shiply.local');
  const cGiz = await session('courier.giz@shiply.local');

  const hubs = Object.fromEntries((await admin('/admin/hubs')).map((h) => [h.code, h.id]));
  const users = Object.fromEntries((await admin('/admin/users')).map((u) => [u.email, u.id]));
  const locs = await merchant('/reference/locations');
  const area = (gov, name) => locs.find((g) => g.code === gov).areas.find((a) => a.nameEn === name)?.id ?? null;

  const make = (gov, areaName, i, cod, size = 'M') =>
    merchant('/merchant/shipments', {
      customerName: NAMES[i % NAMES.length], customerPhone: phone(), address: `${10 + i} Main Street, ${areaName ?? gov}`,
      governorateCode: gov, areaId: areaName ? area(gov, areaName) : null, size, codAmount: cod, description: 'Skincare set', merchantRef: `EVE-${1000 + i}`,
    });

  // 12 parcels: Giza, Alexandria, Cairo
  const giza = [];
  for (let i = 0; i < 5; i++) giza.push(await make('GIZ', ['Dokki', 'Haram', 'Mohandessin', 'Sheikh Zayed', '6th of October'][i], i, (350 + i * 120) * 100));
  const alexandria = [];
  for (let i = 5; i < 8; i++) alexandria.push(await make('ALX', null, i, (500 + i * 50) * 100, 'L'));
  const local = [];
  for (let i = 8; i < 11; i++) local.push(await make('CAI', ['Nasr City', 'Heliopolis', 'New Cairo'][i - 8], i, (250 + i * 10) * 100, 'S'));
  const waiting = await make('CAI', 'Maadi', 11, 19900);

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
  const pickup = await merchant('/merchant/pickups', { date: today, notes: 'Ring the bell at the warehouse door' });
  await caie(`/hubs/${hubs['CAI-E']}/pickups/${pickup.id}/assign`, { courierId: users['courier.caie@shiply.local'] });
  for (const s of [...giza, ...alexandria, ...local]) await cCaie(`/courier/pickups/${pickup.id}/collect`, { code: s.trackingNumber });
  await cCaie(`/courier/pickups/${pickup.id}/finish`, {});
  for (const s of [...giza, ...alexandria, ...local]) await caie(`/hubs/${hubs['CAI-E']}/inbound`, { code: s.trackingNumber });

  async function haul(from, to, list, staffFrom, staffTo, receive = true) {
    let bag;
    for (const s of list) bag = (await staffFrom(`/hubs/${hubs[from]}/sort`, { code: s.trackingNumber })).bag;
    await staffFrom(`/hubs/${hubs[from]}/bags/${bag.id}/seal`, {});
    const trip = await staffFrom(`/hubs/${hubs[from]}/trips`, { destinationHubId: hubs[to], vehicle: 'ABC 1234', driverName: 'Sayed' });
    await staffFrom(`/hubs/${hubs[from]}/trips/${trip.id}/load`, { code: bag.code });
    await staffFrom(`/hubs/${hubs[from]}/trips/${trip.id}/depart`, {});
    if (receive) await staffTo(`/hubs/${hubs[to]}/receive-bag`, { code: bag.code });
  }

  await haul('CAI-E', 'SORT', [...giza, ...alexandria], caie, sort);
  await haul('SORT', 'GIZ', giza, sort, giz);
  await haul('SORT', 'ALX', alexandria, sort, alx, false); // left on the road overnight

  // Giza: deliver 3, one refused (on hold), one stays for tomorrow
  const run = await giz(`/hubs/${hubs.GIZ}/runs`, { courierId: users['courier.giz@shiply.local'] });
  for (const s of giza.slice(0, 4)) await giz(`/hubs/${hubs.GIZ}/runs/${run.id}/add`, { code: s.trackingNumber });
  await giz(`/hubs/${hubs.GIZ}/runs/${run.id}/start`, {});
  const stops = (await cGiz('/courier/run')).items;
  const stopFor = (s) => stops.find((x) => x.shipment.trackingNumber === s.trackingNumber);
  for (const s of giza.slice(0, 3)) await cGiz(`/courier/stops/${stopFor(s).id}/deliver`, { codCollected: s.codAmount, recipient: 'Customer' });
  await cGiz(`/courier/stops/${stopFor(giza[3]).id}/fail`, { reason: 'REFUSED', note: 'Said she did not order it' });
  await giz(`/hubs/${hubs.GIZ}/inbound`, { code: giza[3].trackingNumber });
  const cash = giza.slice(0, 3).reduce((x, s) => x + s.codAmount, 0);
  await giz(`/hubs/${hubs.GIZ}/runs/${run.id}/close`, { cashReceived: cash });

  // Cairo local: on a run right now, one delivered, one no answer
  const run2 = await caie(`/hubs/${hubs['CAI-E']}/runs`, { courierId: users['courier.caie@shiply.local'] });
  for (const s of local) await caie(`/hubs/${hubs['CAI-E']}/runs/${run2.id}/add`, { code: s.trackingNumber });
  await caie(`/hubs/${hubs['CAI-E']}/runs/${run2.id}/start`, {});
  const stops2 = (await cCaie('/courier/run')).items;
  await cCaie(`/courier/stops/${stops2[0].id}/deliver`, { codCollected: stops2[0].shipment.codAmount, recipient: 'Customer' });
  await cCaie(`/courier/stops/${stops2[1].id}/fail`, { reason: 'NO_ANSWER' });

  console.log(`Demo ready. ${waiting.trackingNumber} is waiting for pickup; Giza run closed; Alexandria bag on the road; Cairo run out now.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
