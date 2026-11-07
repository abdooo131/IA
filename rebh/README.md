# Rebh (ربح)

Profit you can count, for online stores that ship cash on delivery.

Rebh reads your store, courier and ad exports and shows what you actually keep from every order. It counts revenue only when a parcel is delivered and paid, charges return trips, courier fees and packaging to the orders that caused them, and compares each ad campaign's real return with what the ad platform reports.

Everything runs in the browser. Files are read on the user's computer and nothing is uploaded.

## Run it

Any static file server works. From this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. The browser needs a server because the scripts are ES modules; opening the file directly will not work.

## Pages

| File | What it is |
|---|---|
| `index.html` | Landing page, English and Arabic |
| `app.html` | The dashboard: Overview, Ads, Products, Delivery, Days, Orders |

`app.html?demo=1` opens the demo store, and `app.html?import=1` opens the file loader.

## Files it reads

Only the orders file is required. Column names are matched loosely, so most exports work as they are. Templates can be downloaded from the file loader.

| File | Key columns |
|---|---|
| Orders | order (or Name), date (or Created at), product, qty, total, status, payment, shipping fee, return fee, campaign, zone (or city) |
| Courier statement | order (or Business Reference), status (or State), shipping fee (or Fees), return fee (or RTO fee), city |
| Ad report | date (or Day), campaign, spend (or Amount spent), reported value (or Purchases conversion value) |
| Product costs | product, cost |

Rows with the same order number are merged into one order. Dates can be `YYYY-MM-DD` or day first `DD/MM/YYYY`.

## How profit is counted

| Order state | Revenue | Costs |
|---|---|---|
| Delivered | the order total | product cost, outbound shipping, packaging, COD or card fee |
| Returned or refused | none | outbound shipping, return trip, packaging |
| On the road | none yet | none yet; shown separately as pending |
| Cancelled | none | none |

Net profit = delivered revenue − those costs − ad spend − fixed expenses for the period (the monthly amount × days shown ÷ 30).

Break even return on ads = 1 ÷ margin after delivery costs. A campaign whose real return is below it loses money.

## Code

| File | Role |
|---|---|
| `js/engine.js` | All profit calculations. Pure functions, no DOM |
| `js/csv.js` | CSV parsing and column matching |
| `js/sample.js` | The seeded demo store |
| `js/app.js` | Dashboard UI |
| `js/landing.js` | Landing page and Arabic text |
| `js/ui.js` | Formatting, theme, storage helpers |

## Tests

```bash
npm test
```

Needs Node 18 or newer. No dependencies to install.
