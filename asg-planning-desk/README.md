# ASG Planning Desk

Demand forecasting and replenishment desk for Ahram Security Group (Ahram, AFM and Sicuro lines).
It is the Eve Chantelle Planning Desk rebuilt with an ASG catalog.

## Run it locally

You only need Python 3. No packages to install and no Docker.

```
cd asg-planning-desk
python3 generate.py            # rebuilds index.html with fresh data
python3 -m http.server 8000    # then open http://localhost:8000
```

You can also double click `index.html` to open it directly in a browser.

## What is in it

* `generate.py` builds two years of weekly dealer demand for 149 SKUs at factory scale (about 10 million units a year),
  adjusts it for stockouts, backtests seven models per SKU plus an ensemble (30 and 90 day rate, SES, Croston, SBA,
  seasonal SES, product share), forecasts 16 weeks ahead, and works out reorder points, production and purchase orders,
  factory load, dead stock, overstock and pricing suggestions. Change `ANNUAL_UNITS` to rescale.
* The page is interactive: filters by product line, factory, finish and search scope every view; summary tiles open the
  list behind them; every row opens a SKU drawer with its chart and reasoning; tables sort on any column; plan
  quantities can be edited and approved (kept in your browser) and copied as CSV for Excel.
* `template.html` is the page; `generate.py` injects the data into it and writes `index.html`.

## What is real and what is not

* Product families and model codes (MI, ME and CY locks and cylinders, padlocks, rim locks, AFM locks, Sicuro handles) follow ASG's public catalogues.
  The handle, hinge and smart lock codes are placeholders.
* Sales, stock, costs, factory capacities, lead times and carton sizes are synthetic. Edit `CATALOG` and `SOURCES` at the top of `generate.py`
  to put in real values, or replace `simulate()` with a loader for real ERP sales history.
