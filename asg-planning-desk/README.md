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

* `generate.py` builds two years of weekly dealer demand for 119 SKUs, adjusts it for stockouts, backtests eight models per SKU
  (30 and 90 day rate, SES, Croston, SBA, TSB, seasonal SES, product share, plus an ensemble), forecasts 16 weeks ahead,
  and works out reorder points, purchase orders, dead stock, overstock and pricing suggestions.
* `template.html` is the page; `generate.py` injects the data into it and writes `index.html`.

## What is real and what is not

* Product families and model codes (MI, ME and CY locks and cylinders, padlocks, rim locks, AFM locks, Sicuro handles) follow ASG's public catalogues.
  The handle, hinge and smart lock codes are placeholders.
* Sales, stock, costs, suppliers, lead times and carton sizes are synthetic. Edit `CATALOG` and `SUPPLIERS` at the top of `generate.py`
  to put in real values, or replace `simulate()` with a loader for real ERP sales history.
