# ASG Planning Desk

Demand forecasting and production planning desk for Ahram Security Group (Ahram, AFM and Sicuro lines).

## Run it locally

Double click `index.html`, or from a terminal:

```
cd asg-planning-desk
open index.html          # Mac
```

No server, packages or Docker needed. Everything runs in the browser.

## Use your own data

Open the **Upload data** tab and add your ERP exports (CSV or Excel). Column names are matched loosely,
so "Item code" or "Quantity" also work.

| File | Required | Columns (bold are required) |
|---|---|---|
| Item list | yes | **sku, product, line, source**, finish, size, unit_cost, price, model |
| Sales history | yes | **date, sku, qty**, status, reason, value |
| Stock on hand | yes | **sku, on_hand**, committed, incoming |
| Factories and suppliers | no | **source, lead_time_days**, type, carton, min_batch, weekly_capacity, confirmed |
| Stockout days | no | **date, sku, days_out** |

* Sales can be order lines, invoices or weekly totals. Rows whose status contains "cancel" count as cancellations, not demand.
* Two years of sales gives seasonality; at least 26 weeks is needed.
* Dates can be `YYYY-MM-DD` or `DD/MM/YYYY`.
* Excel files need an internet connection the first time, to load the Excel reader. CSV works offline.
* Files are read in your browser and never sent anywhere. The last build is remembered in this browser;
  **Switch back to demo data** on the Upload data tab clears it.

`sample-data/` holds the demo data in exactly this format, so you can try the upload with it.

## What is in it

* `engine.js` is the forecasting engine. It turns the uploaded tables into weekly demand, adds back demand lost to
  stockouts, backtests seven models per SKU plus an ensemble (30 and 90 day rate, SES, Croston, SBA, seasonal SES,
  product share), forecasts 16 weeks ahead, and works out reorder points, production and purchase orders, factory load,
  dead stock, overstock, pricing suggestions and data issues.
* `template.html` is the page. Filters by product line, factory, finish and search scope every view; summary tiles open
  the list behind them; every row opens a SKU drawer with its chart and reasoning; tables sort on any column; plan
  quantities can be edited and approved (kept in your browser) and copied as CSV for Excel.
* `generate.py` creates the synthetic demo data (149 SKUs, about 10 million units a year), writes it to `sample-data/`,
  and builds `index.html` from `template.html`, `engine.js` and the demo data. Run `python3 generate.py` after changing
  the template or engine. Change `ANNUAL_UNITS` to rescale the demo.

## What is real and what is not

* Product families and model codes (MI, ME and CY locks and cylinders, padlocks, rim locks, AFM locks, Sicuro handles)
  follow ASG's public catalogues. The handle, hinge and smart lock codes are placeholders.
* In the demo, sales, stock, costs, factory capacities, lead times and carton sizes are synthetic.
  Uploading your own files replaces all of it.
