# Eve Chantelle Demand Forecasting and Replenishment

A local, repeatable system that pulls all history from Shopify, cleans it, forecasts demand per SKU and turns the forecast into decisions: what to reorder, how much, when, from which supplier, what to mark down and what to mark up. It is read only against Shopify.

## Setup

```
cd eve_chantelle_forecasting
pip install -r requirements.txt
cp .env.example .env        # then fill in SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN
```

Shopify custom app (Settings, Apps, Develop apps) with these Admin API read scopes:
read_orders, read_all_orders, read_products, read_inventory, read_locations, read_price_rules, read_discounts, read_returns, read_fulfillments.
read_all_orders is what unlocks orders older than 60 days. The sync checks the scopes first and stops with the exact list of what is missing.

Before the first real purchase order, confirm lead times, MOQs and pack sizes in `config/suppliers.yaml` (they are placeholders and every PO says so until `confirmed: true`).

## Commands

```
python main.py sync              # pull and update Shopify data (full history first, incremental afterwards)
python main.py forecast          # cleaning, backtest, forecast
python main.py po                # purchase orders for every supplier
python main.py po filter color BLACK supplier BOBO
python main.py health            # low, slow, dead, overstock, discrepancies, cancellations, unfulfilled
python main.py pricing           # markdown and markup calls
python main.py tracker           # merchandise tracker (mirch file)
python main.py all               # full pipeline
python main.py demo              # synthetic store, outputs in outputs_demo, nothing touches Shopify
python main.py proposals         # config changes the system suggests (it never applies them)
streamlit run dashboard/app.py   # dashboard; EC_DB=data/demo/demo_warehouse.duckdb for the demo
python -m pytest                 # tests
```

PO filters: color, collection, supplier, product, product_type, abc, size, sku. Values can be comma separated.

Run daily (sync then the rest). The daily inventory snapshot is what makes stockout detection exact over time, because Shopify keeps no stock history.

## Outputs

Folders by date: `outputs/yyyy/mm/week_N/`, files `category_yyyy_mm_dd.xlsx`. Every workbook opens on a Read me sheet that leads with the decision.

| Category | Content |
|---|---|
| demand_forecast | weekly forecast per SKU for 16 weeks with p10 and p90, hierarchy check, model mix, stockout and cap log |
| accuracy_report | catalog WAPE against the 30 day velocity baseline, holdout check, per class, per SKU, over time, config proposals |
| purchase_order | one sheet per supplier, summary, SKUs not ordered (dead or long out of stock) and assumptions |
| restock_alert | SKUs running out within 14 days ranked by revenue at risk, unfulfilled queue |
| dead_stock | dead stock with tied up capital, slow stock |
| overstock | by collection, by product, by SKU |
| discrepancy | each finding labelled data problem or process problem |
| cancelled_orders | totals, top reasons, top SKUs |
| markdown_recommendation | SKU and product markdowns, past markdowns, elasticity per product |
| markup_recommendation | markup candidates with expected volume and revenue change |
| merch_tracker | per SKU and per product tracker with alert status and recommended action |

Filtered POs add the filter after the date, for example `purchase_order_2026_10_03_color_black_supplier_bobo.xlsx`. Slow stock and the unfulfilled queue have no category of their own, so they sit in dead_stock and restock_alert; this is flagged in those files.

## How it works

**Ingestion.** Bulk Operations for orders, products and variants with inventory levels; refund line items through a batched nodes query. Raw JSONL lands in `data/raw/` with the pull date. Orders and products are incremental by updated_at with a one hour overlap. Variants are pulled in full each run so stock and price snapshots cover every SKU. All data lives in `data/warehouse.duckdb`.

**Cleaning.** Cancelled orders never count as demand and go to the cancellations table. Test orders and orders tagged test or internal are excluded, as are zero value orders. Gross units keep returns (for forecasting); net units and refunds drive revenue. Lines whose variant was deleted are matched back by SKU when the SKU is unique, otherwise reported.

**Stockouts.** A day is a stockout when the snapshot shows zero or less available, when the SKU is out now and has not sold since its zero run began, or (before snapshots existed) when a zero sales run is very unlikely at the recent rate while sibling sizes kept selling. Demand on those days is replaced by the SKU's recent in stock velocity blended with the product velocity times the size curve share. Only the first 90 days of a stockout run are filled; an active SKU out longer than that is reported and kept off the PO.

**Promo and outliers.** Promo days are days with discount depth of 15 percent or more, promo events from `config/events.yaml`, or store wide discount days. Spikes above median plus 5 scaled MAD (with a mean plus 5 standard deviations floor for intermittent SKUs) are capped unless a promo explains them. Every cap is logged.

**Forecasting.** Daily forecasts for 16 weeks. Each SKU is classified as smooth, erratic, intermittent, lumpy or new (Syntetos Boylan). Candidates per class: ETS, damped ETS, Croston, SBA, TSB, ADIDA, IMAPA, a global LightGBM model (weekly direct model with calendar, event, lag, last year, price and promo features), product forecast times size share, seasonal naive, 7, 30 and 90 day velocity, and an inverse WAPE ensemble of the two best models per class. New SKUs inherit from the parent product's size curve or from the launch profile of similar SKUs.

**Selection.** Rolling origin backtest with 4 folds, horizon equal to the longest supplier lead time plus the review period, errors on weekly buckets. The lowest WAPE wins per SKU, ties broken by bias then a fixed model order, so the same data always picks the same model. The accuracy report also scores an honest holdout: winners chosen on the older folds, judged on the latest fold only. Confidence (high, medium, low) combines history length, backtest WAPE and demand class and appears next to every recommendation.

**Quantiles.** p10, p50 and p90 come from a negative binomial around the forecast mean, with variance from the SKU's own week to week dispersion plus its backtest bias.

**Replenishment.** Lead time demand covers lead time plus review period. The reorder point is the service level quantile of that demand (95, 90, 85 percent for A, B, C, a little lower for hard to forecast Z items). Target stock is the reorder point plus 30 days of cycle cover. Inventory position is on hand minus committed plus incoming. When the position is at or below the reorder point the order brings it up to target, rounded up to whole packs and at least the MOQ. Dead stock and long stockouts are never ordered.

**Pricing.** Elasticity per product from weekly sales against the realized price index with trend and event controls, falling back to collection, product type, then a default of minus 1.5. Markdowns pick the smallest ladder step that clears the excess within 60 days, capped by the 50 percent maximum and the margin floor, and say what happened in the last markdown. Markups go to strong sellers with repeated stockouts.

**Hierarchy.** SKU forecasts sum to product, color, collection and total. An independent ETS on each group's own history checks them; groups that disagree by more than 25 percent are flagged for review, not silently changed.

## Demo results (synthetic store, not real data)

40 products, 378 SKUs, 27 months, 43k orders: the full pipeline takes about 80 seconds. Selected models WAPE 0.465 against 0.530 for the 30 day velocity baseline across folds, and 0.516 against 0.540 on the honest holdout. A 1,421 SKU store with 154k orders runs end to end in about 4 minutes.

## Not built yet (interfaces ready)

* Edara ERP: `src/connectors/edara_stub.py` defines unit costs, open POs and received goods.
* Meta Ads spend: drop `data/inputs/meta_ads_spend.csv` (date, spend); loaded by `src/connectors/meta_ads_stub.py`, not yet a model feature.
* Physical store: every fact table carries location_id; forecasts aggregate all locations for now.
* Nothing is ever written back to Shopify. The client refuses any mutation except starting a read only bulk export.
