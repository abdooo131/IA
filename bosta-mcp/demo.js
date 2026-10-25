// Offline stand in for the Bosta API, used when BOSTA_DEMO=1.
// Keeps fake cities, deliveries and pickups in memory so Claude can be tried without a Bosta account.
// Everything resets when Claude Desktop restarts.

const STATES = { 10: "Pickup requested", 21: "Picked up", 24: "Received at warehouse", 41: "Out for delivery", 45: "Delivered", 100: "Terminated" };

const cities = [
  { _id: "cairo", name: "Cairo", nameAr: "القاهرة", code: "EG-01" },
  { _id: "giza", name: "Giza", nameAr: "الجيزة", code: "EG-25" },
  { _id: "alexandria", name: "Alexandria", nameAr: "الإسكندرية", code: "EG-02" },
];

const zones = [
  { _id: "nasr-city", name: "Nasr City", cityId: "cairo" },
  { _id: "heliopolis", name: "Heliopolis", cityId: "cairo" },
  { _id: "maadi", name: "Maadi", cityId: "cairo" },
  { _id: "dokki", name: "Dokki", cityId: "giza" },
  { _id: "sheikh-zayed", name: "Sheikh Zayed", cityId: "giza" },
  { _id: "smouha", name: "Smouha", cityId: "alexandria" },
];

let nextTracking = 7100001;
const deliveries = [];
const pickups = [];

function history(...codes) {
  const start = Date.now() - codes.length * 6 * 3600 * 1000;
  return codes.map((code, i) => ({ code, state: STATES[code], time: new Date(start + i * 6 * 3600 * 1000).toISOString() }));
}

function addDelivery(fields, codes = [10]) {
  const trackingNumber = String(nextTracking++);
  const tracking = history(...codes);
  const delivery = {
    _id: `demo_${trackingNumber}`,
    trackingNumber,
    type: 10,
    cod: 0,
    notes: "",
    ...fields,
    state: { code: tracking.at(-1).code, value: tracking.at(-1).state },
    tracking,
    createdAt: tracking[0].time,
  };
  deliveries.unshift(delivery);
  return delivery;
}

addDelivery(
  { cod: 350, businessReference: "ORDER-1001", receiver: { firstName: "Mona", lastName: "Hassan", phone: "01000000001" }, dropOffAddress: { city: "Cairo", zone: "Nasr City", firstLine: "12 Abbas El Akkad St" } },
  [10, 21, 24, 41, 45]
);
addDelivery(
  { cod: 1200, businessReference: "ORDER-1002", receiver: { firstName: "Omar", lastName: "Adel", phone: "01000000002" }, dropOffAddress: { city: "Giza", zone: "Dokki", firstLine: "5 Tahrir St" } },
  [10, 21, 24, 41]
);
addDelivery(
  { cod: 480, businessReference: "ORDER-1003", receiver: { firstName: "Salma", lastName: "Fathy", phone: "01000000003" }, dropOffAddress: { city: "Alexandria", zone: "Smouha", firstLine: "20 Victor Emmanuel Sq" } },
  [10]
);

pickups.push({
  _id: "demo_pickup_1",
  businessLocationId: "demo_location_1",
  scheduledDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  scheduledTimeSlot: "10:00 to 13:00",
  contactPerson: { name: "Warehouse", phone: "01000000000" },
  state: "Requested",
});

function notFound(what) {
  const err = new Error(`Bosta API (demo) failed with 404: ${what} not found`);
  throw err;
}

function findDelivery(id) {
  return deliveries.find((d) => d._id === id || d.trackingNumber === id) || notFound(`Delivery ${id}`);
}

function findPickup(id) {
  return pickups.find((p) => p._id === id) || notFound(`Pickup ${id}`);
}

function paginate(list, page = 1, perPage = 20) {
  const start = (Number(page) - 1) * Number(perPage);
  return { count: list.length, page: Number(page), perPage: Number(perPage), data: list.slice(start, start + Number(perPage)) };
}

export async function demoBosta(method, path, { query = {}, body } = {}) {
  const parts = path.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  const route = `${method} /${parts.map((p, i) => (i > 0 && !["tracking", "zones", "awb"].includes(p) ? ":id" : p)).join("/")}`;
  const id = parts.find((p, i) => i > 0 && !["tracking", "zones", "awb"].includes(p));

  switch (route) {
    case "GET /cities":
      return { data: cities };
    case "GET /zones":
      return { data: zones };
    case "GET /cities/:id/zones":
      return { data: zones.filter((z) => z.cityId === id.toLowerCase()) };

    case "GET /deliveries": {
      const { page, perPage, ...filters } = query;
      const list = deliveries.filter((d) =>
        Object.entries(filters).every(([key, value]) => (key === "state" ? String(d.state.code) === String(value) : String(d[key]) === String(value)))
      );
      return paginate(list, page, perPage);
    }
    case "POST /deliveries":
      return { message: "Delivery created (demo, not a real shipment)", ...addDelivery(body || {}) };
    case "GET /deliveries/:id":
      return findDelivery(id);
    case "GET /deliveries/:id/tracking": {
      const d = findDelivery(id);
      return { trackingNumber: d.trackingNumber, state: d.state, history: d.tracking };
    }
    case "PUT /deliveries/:id":
      return Object.assign(findDelivery(id), body || {});
    case "DELETE /deliveries/:id": {
      const d = findDelivery(id);
      d.tracking.push(...history(100));
      d.state = { code: 100, value: STATES[100] };
      return { message: `Delivery ${d.trackingNumber} terminated (demo)` };
    }
    case "GET /deliveries/awb/:id":
      return { message: `Demo mode: no real airway bill PDF for ${findDelivery(id).trackingNumber}` };

    case "GET /pickups":
      return paginate(pickups, query.pageNumber, query.pageLimit);
    case "POST /pickups": {
      const pickup = { _id: `demo_pickup_${pickups.length + 1}`, state: "Requested", ...(body || {}) };
      pickups.push(pickup);
      return { message: "Pickup scheduled (demo, no courier will come)", ...pickup };
    }
    case "GET /pickups/:id":
      return findPickup(id);
    case "PUT /pickups/:id":
      return Object.assign(findPickup(id), body || {});
    case "DELETE /pickups/:id":
      findPickup(id).state = "Canceled";
      return { message: `Pickup ${id} canceled (demo)` };

    default:
      return notFound(`Demo mode has no endpoint for ${method} ${path}`);
  }
}
