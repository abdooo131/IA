# Daily Replenishment Planner

A planning tool for a café chain with a main warehouse, a central kitchen and branches with their own small stores and kitchens.

```
Suppliers → Main WH → Central Kitchen → Branches
                 └──────────────────────→ Branches (raw materials)
```

Each day it answers three questions:

1. **Branch dispatch:** how much of each item to send to each branch
2. **Central kitchen:** how many sandwiches and desserts to make, and which raw materials the kitchen needs from the main WH
3. **Purchasing:** what the main WH should order from each supplier

## Running it

Open `index.html` in a browser. It starts with example data (made up figures) so every screen shows a working plan. Use **Data and settings** to import real exports.

No server or install is needed. Imported files stay in the browser that imported them.

## Files

| File | What it is |
|---|---|
| `engine.js` | The planning logic. Runs in the browser and in Node (`require('./engine.js').plan(data, settings)`). |
| `demo.js` | Example data: 11 branches, 27 raw materials, 17 products, 10 weeks of sales. |
| `index.html` | The screens. The first tab shows the chain: product forecast, recipe breakdown, total raw materials. |
| `templates/*.csv` | One template per import file, with sample rows. |

## Data to import

| Dataset | Required columns | Optional columns |
|---|---|---|
| Branches | code, name | deliveryDays (`daily` or `Sun,Tue,Thu`) |
| Raw materials | code, name | unit, supplier, leadTimeDays, leadTimeSdDays, moq, packSize, transferMultiple, unitCost, shelfLifeDays, orderEveryDays |
| Products | code, madeAt (`CK` or `BRANCH`) | name, price, targetService, minQty |
| Recipes (BOM) | product, item, qty | |
| Sales history | date, branch, product, qty | |
| Stock on hand | location (`MAIN`, `CK` or branch code), item, qty | |
| In transit | location, item, qty | |
| Open purchase orders | item, qty | due |

Common Oracle column names (item number, UOM, subinventory, on hand quantity, need by date and so on) are matched automatically. Dates can be `2026-10-12`, `12/10/2026` or `12-OCT-2026`.

## Method in short

* **Forecast:** same weekday average over the last 8 weeks, recent weeks weighted more.
* **Recipes:** each planned product is multiplied through its BOM. Recipes can have several levels: a component with its own recipe (for example a cream mix) is broken down until only raw materials remain. Semi finished items only need to appear in the BOM, as a parent with their own lines.
* **Fresh products (sold the same day or thrown away):** pushed to branches. Target = (price − recipe cost) ÷ price, so high margin items sell out less often and low margin items are thrown away less often.
* **Branch raw materials:** filled up to expected use until the next delivery plus safety stock, minus stock on hand and in transit. Never more than the shelf life allows.
* **Shortages at the main WH:** the kitchen is served first, then branches share by need, with leftovers going to the branch closest to running out.
* **Purchasing:** reorder point and order up to level per item from network wide use, lead time, days between orders, pack size and minimum order quantity.

The **How it works** tab in the app explains each formula in plain words.

## Next steps

* Correct the forecast for days when a fresh product sold out early (needs sell out time per branch).
* Weekly cycle counts and a theoretical vs actual usage report to keep stock balances accurate.
* Direct connection to Oracle instead of file imports.
