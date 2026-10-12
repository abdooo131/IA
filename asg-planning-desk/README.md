# ASG Planning Desk

Demand forecasting and production planning desk for Ahram Security Group (Ahram, AFM and Sicuro lines).

## Run it locally

Double click `index.html`, or on a Mac:

```
open asg-planning-desk/index.html
```

No server, packages or Docker needed. Everything runs in the browser.

## What it does

* **Forecast by month or week.** The Month / Week switch at the top changes every chart and table. Months split into
  weeks (click a month in the Forecast tab or in a SKU's drawer); weeks are cut at month ends so they add up.
  The forecast runs 26 weeks ahead.
* **Merchandise view:** a table with each SKU on the left, its monthly sales side by side, then total sales, stock,
  forecast (next 1, 3 or 6 months) and the order quantity or overstock quantity. Above it, sales per department per
  month with share, change on the year before and a trend line. Choose the last 12 or 24 months or any year, in units
  or EGP; click a department to show only its SKUs; sort by any column; copy as CSV.
* **Tabs:** Overview, Forecast (lines and SKUs by period and channel), Merchandise, Products, Production plan (capacity schedule,
  late orders, raw materials), Stock health, Drivers (everything that moves the forecast), Pricing, Data issues,
  Upload data.
* Filters by product line, factory, finish and search apply to every tab. Every SKU opens a drawer that explains its
  forecast step by step.

## How the forecast is built (engine.js)

1. Weekly dealer demand: shipped plus recorded lost orders; cancelled orders removed.
2. Stockout weeks filled in; demand that moved to sibling sizes (or finishes) while one was out is taken back off them.
3. Price changes and promotions: the buy ahead, dip and promotion lift are measured from past events and removed.
4. Calendar removed: Ramadan, Eid al Fitr, Eid al Adha, public holidays, year end stocking, and each line's yearly shape.
5. Seven models (30 and 90 day rate, SES, damped trend, Croston, SBA, product share) plus an ensemble are backtested
   on 4 windows of 8 weeks; the lowest error wins per SKU.
6. The winner's level is put back through the calendar and any announced price changes or promotions.
7. Construction activity: cement sales lead lock demand by 6 months; each line's elasticity is measured and applied.
   A devaluation of more than 5% in a month is treated as a coming price rise.
8. Dealer stock above or below normal pulls the next 8 weeks down or up.
9. New SKUs borrow their predecessor's demand (or start at 60% of a typical SKU in the line); phase outs stop at their end date.
10. Export run rate and confirmed project and export orders are added on top. One off project orders are never extrapolated.

The plan then uses forecast demand over each source's lead time plus safety stock (service level by ABC and XYZ
class), rounds to cartons and minimum batch, and schedules factory orders most urgent first within weekly capacity.

## Use your own data

Open the **Upload data** tab and add CSV or Excel exports. Column names are matched loosely.

| File | Required | Columns (bold are required) | Switches on |
|---|---|---|---|
| Item list | yes | **sku, product, line, source**, department, finish, size, unit_cost, price, model, launch_date, end_date, replaces | launches and phase outs |
| Sales history | yes | **date, sku, qty**, status (shipped, cancelled, lost), channel (dealer, project, export), reason, value | channels, lost orders, cancellations |
| Stock on hand | yes | **sku, on_hand**, committed, incoming | the plan |
| Factories and suppliers | no | **source, lead_time_days**, type, carton, min_batch, weekly_capacity, confirmed | lead times, batches, schedule |
| Price changes and promotions | no | **type, start, pct**, end, line, sku, name | buy ahead, dips, promotion lift |
| Confirmed future orders | no | **due_date, sku, qty**, channel | project and export orders |
| Market data | no | **month**, cement, usd_egp, cpi | construction lag, devaluations |
| Dealer stock | no | **date, sku, stock, sell_out**, dealer | dealer overstock and understock |
| Stockout days | no | **date, sku, days_out** | lost demand |
| Bill of materials | no | **sku, material, qty_per_unit** | raw material needs |
| Material stock | no | **material, on_hand**, unit, on_order, lead_time_days | material shortages |

* Two years of sales gives seasonality and the construction link; at least 26 weeks is needed.
* Dates can be `YYYY-MM-DD` or `DD/MM/YYYY`. Excel needs an internet connection the first time; CSV works offline.
* Files are read in your browser and never sent anywhere. The last build is remembered in this browser;
  **Switch back to demo data** on the Upload data tab clears it.

`sample-data/` holds the demo data in exactly this format, so you can try the upload with it.

## Files

* `engine.js` is the forecasting and planning engine.
* `template.html` is the page.
* `generate.py` creates the synthetic demo data: seven years of weekly history (October 2019 to September 2026, including
  the 2020 lockdown dip and the 2022 to 2024 devaluations and price rises), 153 SKUs in four departments, about 10 million
  units a year, every factor above built in,
  and every product line, factory and finish in every state so any filter shows a full page), writes `sample-data/`,
  and builds `index.html` from `template.html`, `engine.js` and the demo data. Run `python3 generate.py` after
  changing the template or engine.

## What is real and what is not

* Product families and model codes (MI, ME and CY locks and cylinders, padlocks, rim locks, AFM locks, Sicuro handles)
  follow ASG's public catalogues. Handle, hinge, smart lock and new model codes are placeholders.
* The Egyptian calendar (Ramadan, Eid, public holidays) is real.
* Everything else in the demo is synthetic: sales, stock, costs, capacities, lead times, events, market data, dealers
  and materials. Uploading your own files replaces it.
