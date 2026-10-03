# CLAUDE.md: rules for working on the Eve Chantelle forecasting system

Owner: Assal, Elassal Holding. Store: Eve Chantelle, DTC lingerie on Shopify, Cairo. The full spec is the SRD the system was built from; this file keeps its rules alive across sessions.

## Non negotiable rules

1. Every output ends in a decision with a number, not a data dump. Summaries lead with the result, then the key numbers. Keep them short.
2. Accuracy first. Broken data is flagged (discrepancy report, data problem or process problem), never silently smoothed.
3. Same SKU and same data give the same method and the same answer. Model ties break on bias, then the fixed MODEL_ORDER in `src/models/classify.py`. LightGBM runs deterministic with a fixed seed. Keep it that way.
4. Plan before executing: every command prints a one or two line PLAN (what, which SKUs, which window, which output) through `ctx.plan`.
5. No hyphens in any human readable output: reports, labels, log lines, comments, docs. Use spaces or underscores. Dates are written 2026 10 03 or 2026_10_03. `no_hyphen` in `src/common.py` is applied to report text and logs. Only exact Shopify identifiers (SKU, barcode, ids) and code or commands are exempt. The integration test scans every workbook and log for hyphens.
6. The system proposes config changes (`ctx.propose`, stored in config_proposals and the accuracy report) and waits for Assal to confirm. Never edit `config/*.yaml` silently, and never apply a proposal without confirmation.
7. Read only against Shopify. `ShopifyClient.query` refuses every mutation except bulkOperationRunQuery.
8. Never assume supplier lead times, MOQs or pack sizes that are not in `config/suppliers.yaml`. Pack of 6 is the default and is flagged on every PO line that uses it. Unconfirmed suppliers are flagged on every PO.
9. If a Shopify scope or field is missing, stop and say exactly what is needed.
10. File naming: `outputs/yyyy/mm/week_N/category_yyyy_mm_dd.ext`, lowercase, underscores. Categories are fixed in `CATEGORIES` in `src/common.py`: restock_alert, dead_stock, overstock, discrepancy, demand_forecast, purchase_order, markdown_recommendation, markup_recommendation, merch_tracker, cancelled_orders, accuracy_report. Never add a category without flagging it to Assal first.
11. Secrets only in `.env` (never committed). No secrets in code or git.

## Business logic that must not drift

* Cancelled orders are excluded from demand and appear in the cancelled_orders report.
* Test orders, orders tagged test or internal, and zero value orders are excluded.
* Forecasting uses gross demand (returns included). Revenue and margin use net units.
* Stockout days get demand reconstructed from in stock velocity and the size curve share, and are flagged. Only the first `max_impute_days` (90) of a run are filled; longer runs are reported as long stockout and kept off POs.
* Inventory position = on hand minus committed plus incoming. Committed units are already sold.
* Order when position is at or below the reorder point; order up to target (reorder point plus cycle cover); round up to the pack; respect the MOQ. Never order dead stock.
* Service levels by ABC (revenue) and XYZ (backtest WAPE) from settings.
* Forecast accuracy is always reported against the trailing 30 day velocity baseline, plus the honest holdout. If the forecast does not win, say so plainly.
* Every recommendation shows its confidence and its reason (what changed, what happened last time, what is expected now for pricing).

## Known decisions taken during the build (tell Assal if revisiting)

* LightGBM is a candidate for intermittent and lumpy SKUs too, not only smooth and erratic as in the SRD table: in the backtest it won about a third of those SKUs and lowered holdout WAPE. Override with `forecast.class_models` in settings.
* Errors are measured on weekly buckets inside the lead time plus review horizon, because decisions are weekly.
* Slow stock is written into the dead_stock file and the unfulfilled queue into restock_alert, since there is no category for them.
* Filtered POs append the filter after the date in the file name.

## Working on the code

* Entry point `main.py`, commands in `src/pipeline.py`.
* Clean layer is rebuilt in full on every forecast run. Raw tables and snapshots are upserted and never rebuilt.
* `python main.py demo` builds a synthetic store with planted problems and runs everything; use it to check changes without Shopify.
* Tests: `python -m pytest` (unit tests for cleaning, stockouts, pack rounding, safety stock, PO math; integration test on a small synthetic store covering the acceptance criteria). Run them before every commit.
* Build phases in the SRD end with a short summary on real data and Assal's confirmation before moving on.
