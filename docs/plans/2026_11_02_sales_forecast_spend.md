# Product Growth Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** A multi store Python engine that, for any connected Shopify store and any set of Meta ad accounts, measures spend, CPM, CPA, CAC and profit per product, models demand as traffic × conversion with lost sales split into price and stock causes, suggests purchase orders pushed to Shopify on approval, and decides per product whether to kill, fix, restock or scale, with a 3 month plan.

**Architecture:** Every row belongs to a tenant (one Shopify store plus its ad accounts). The cycle per tenant: ingest (Shopify orders, products, costs, stock, transfers; Meta spend, impressions, purchases; storefront pixel events) → resolve product lineage → attribute spend to products → aggregate → fit traffic, conversion and size curves → calibrate → forecast true demand → suggest POs → approve and push → read receipts → score and decide → backtest. A small FastAPI collector receives pixel events. A CLI drives everything.

**Tech Stack:** Python 3.11, Postgres (Neon), psycopg 3, pandas, numpy, scipy, requests, typer, FastAPI + uvicorn (collector, deployed on Render), pytest.

**Spec:** Section "Spec" below (agreed in chat on 2026 11 02).

## Spec

### A. Tenants and connections
1. A tenant = one Shopify store + zero or more Meta ad accounts + settings. Fields: `tenant_id`, `name`, `shop_domain`, `shopify_token_env` (name of the env var holding that store's Admin API token), `meta_token_env`, `meta_account_ids[]`, `timezone`, `currency`, `po_prefix`, `main_location_id`, `pixel_key` (random secret for the collector).
2. `timezone` and `currency` are read from Shopify shop info on `tenant add`, never hard coded. Ad accounts must match the store currency, or `tenant add` refuses them.
3. Shopify access: a custom app per store with scopes read_orders, read_all_orders, read_products, read_inventory, write_inventory, read_locations, read_customers. Meta access: a system user token with ads_read on the listed accounts.
4. Every table carries `tenant_id`; every query filters by it. One tenant's data never appears in another's output.
5. First tenant: Eve Chantelle, store chantelleve.myshopify.com, ad accounts `496801511811310` and `1222339613363462`.

### B. Product lineage (old multi colour products split into one product per colour)
6. Levels, from small to large: variant (colour + size), colour product, style, collection. A style groups every colour of the same design, across old and new product IDs.
7. `variant_lineage(old_variant_id, new_variant_id, effective_date, method, confirmed)` links an old variant to its replacement, so history continues across the split. Matching order: (a) identical SKU; (b) same normalised base title (title without colour words) + same colour option value (or colour in the new handle) + same size option; (c) manual.
8. Methods (a) and (b) auto confirm only when exactly one candidate matches; otherwise the pair is listed for review. Unmatched variants keep their own history.
9. `styles(style_id, name)` and `product_style(product_id, style_id, colour)`. The old 5 colour product maps to the style; each new colour product maps to the same style with its colour.
10. Sales, stock, spend, views and Meta catalog IDs of old variants are re keyed to the current variant through lineage before any aggregation. Meta catalog `product_id` values of both old and new variants resolve to the current variant.

### C. Spend, CPM, CPA, CAC
11. Spend per product, in priority order: catalog breakdown `product_id`; ad name `PRODUCT_FORMAT_ANGLE` (PRODUCT = Shopify handle); manual map with shares; shared pool split by revenue share that day. Impressions and Meta purchases follow the same split.
12. CPM = spend / impressions × 1000.
13. Order credit for an order containing several products: if the order's ad (from UTM `utm_content` = ad ID, or Meta ad attribution) promotes one product in the order, that product gets credit 1.0; otherwise each product gets line value / order value (an 800 + 200 order gives 0.8 and 0.2).
14. Meta CPA = spend / (Meta purchases × meta_factor). Shopify CPA = spend / sum of order credits. Both are per order, not per unit.
15. New customer = first ever order of a customer, matched by normalised phone (Egyptian numbers to `+20XXXXXXXXXX`), falling back to email, then Shopify customer ID. Full order history is ingested once on `tenant add`.
16. Blended CAC = spend / new customer credits (Spec 13 split applied to first orders). Paid CAC = spend / new customer credits from orders attributed to Meta, × lift factor.
17. Customer value per product: average gross profit over 12 months of customers whose first order credited that product (credit weighted). Cohorts younger than 12 months use observed value scaled by the store's average 12 month / observed ratio at the same age.

### D. Demand model: traffic × conversion, lost sales by cause
18. Storefront pixel: a Shopify custom pixel sends `product_viewed`, `product_added_to_cart`, `checkout_completed` and a theme published custom event `size_selected` (variant ID, available true or false) to the collector, signed with `pixel_key`. A `notify_me` custom event is optional.
19. Per colour product per day: `views` (unique sessions viewing it), `size_views` per variant with availability, `atc`, `orders`.
20. Size curve per style: share of demand per size, from sales in periods where that size was in stock, blended with `size_selected` counts (each source weighted by its sample size).
21. `size_availability` of a colour product in a period = Σ over sizes of size_share × fraction of the period that size was in stock (summed across locations).
22. Equations per colour product, then rolled up:
    * `views = baseline_v + a * ln(1 + adstock_spend) + seasonal`
    * `cr_full = cr_ref * (price / ref_price) ^ e` (conversion with every size in stock; `ref_price` = most common full price in the last 180 days; `e` = price elasticity, fitted per style, clipped to [−6, 0], inherited from parent when there are fewer than 3 price levels)
    * `units = views * cr_full * size_availability`
    * `lost_stock = views * cr_full * (1 − size_availability)`
    * `lost_price = views * (cr_ref − cr_full) * size_availability` (negative means a discount gained units)
    * `true_demand = units + lost_stock`
    Since lost demand has only two causes, the gap between `views * cr_ref` and actual units is fully explained by price and stock; the residual is reported as `unexplained` and should stay small.
23. Adstock decay: day 0.6, week 0.3, month 0.1. Seasonal flags: Ramadan, Eid al Fitr, Eid al Adha, White Friday week, payday (days 25 to 31), promo.
24. Before the pixel has 8 weeks of data, `views` come from Shopify landing page sessions on `/products/<handle>` (ShopifyQL `sessions GROUP BY landing_page_path`) scaled by the store's landing share, flagged `views_estimated`. When views are unavailable the model falls back to `units = size_availability * (baseline + a * ln(1 + adstock) + seasonal)`.
25. Entities with fewer than 12 usable periods inherit `a` and `e` from the parent (colour product → style → collection → store).
26. Calibration: `meta_factor` = Shopify UTM orders / Meta purchases per month, capped [0.2, 1.5]; `lift_factor` per style from tests multiplies `a`.

### E. Purchasing
27. Suppliers: factory or external, lead time days, pack multiple; MOQ per style.
28. Suggestion per variant uses true demand, not sales: `need = true_demand forecast over (lead_time + cover_days) × size_share + safety − available − on_order`, `safety = 1.65 × sd(daily true demand, 90 days) × sqrt(lead_time)`, cover 30 days. Round up to the pack multiple; raise the style total to MOQ by forecast share. KILL styles get nothing.
29. PO states: draft → approved → pushed → partially_received → received, or cancelled. Push = Shopify `inventoryTransferCreate` (no origin, destination = tenant main location, `referenceName` = PO number) then mark ready to ship; idempotent by `referenceName`. Receipts read actual received quantities. Nothing reaches Shopify unapproved.
30. PO number: `{po_prefix}PO{YYYYMM}{NNN}`.
31. Restock lift: units per in stock day in the 14 days after first receipt vs the 14 before.

### F. Scorecard, decisions, plan
32. Monthly scorecard per style and colour product: views, cr, cr_full, size_availability, units, lost_stock, lost_price, true_demand, revenue, gross profit, spend, impressions, CPM, Meta CPA, Shopify CPA, blended CAC, paid CAC, customer value 12m, POAS, marginal POAS, stock cover days, on order, restock lift, meta_factor.
33. Decisions (first match wins), each stored with its rule and numbers:
    * TEST: fewer than 12 usable periods or first sale under 60 days ago (lineage history counts).
    * RESTOCK FIRST: marginal POAS ≥ 1.5 and stock cover days < lead time, or lost_stock > 20% of true_demand.
    * FIX PRICE: lost_price > 20% of true_demand and size_availability ≥ 0.8.
    * SCALE: marginal POAS ≥ 1.5, or (paid CAC ≤ customer value 12m / 1.5 and marginal POAS ≥ 1).
    * KILL: POAS < 1 and marginal POAS < 1 in each of the last 2 months, size_availability ≥ 0.8 in both, and customer value 12m < paid CAC.
    * CUT SPEND: marginal POAS < 1.
    * MAINTAIN: everything else.
    Missing unit cost: POAS is None, SCALE uses ROAS ≥ 3, flagged `missing_cost`.
34. Forward plan per style for 3 months: spend where marginal POAS = 1 (0 for KILL, current for TEST), capped so forecast units ≤ available + on order + suggested POs; forecast units, true demand, revenue, profit; linked PO.
35. Grains day, week, month; horizons 30, 12, 6. Monthly refit; forecasts and decisions stored and scored later.

## Global Constraints

* No store, account, currency or timezone is hard coded; all come from the tenant.
* Secrets live only in env vars named by the tenant row; the DB stores env var names, never tokens.
* All dates are local dates in the tenant timezone.
* Cancelled orders excluded; refunds subtracted on refund date.
* No spend, impression or purchase row is dropped; unmapped goes to the pool and is logged.
* Only Shopify writes allowed: inventory transfer create, mark ready to ship, cancel, for approved POs only.
* Collector rejects events with a bad signature or unknown tenant, and stores no personal data beyond a hashed session ID.

## Review Focus

1. Two tenants in one DB: no query, fit or report leaks rows across tenants. Test in Tasks 1, 6, 13.
2. Split products: a style whose old 5 colour product became 5 products shows one continuous sales line through the split date, with no double counting. Test in Task 3.
3. Stockouts and missing sizes: sales lost to sold out sizes land in `lost_stock`, not in a weaker ad curve or a KILL. Test in Tasks 8 and 12.
4. Partial receipts and double approvals: real received quantities used, one transfer per PO. Test in Task 11.
5. Products with no unit cost, no views yet, or one price level: fallbacks apply and flags show, no NaN or crash. Test in Tasks 8 and 12.

## File Structure

```
pyproject.toml
src/engine/
  config.py  db.py  tenants.py
  migrations/001_core.sql  002_lineage.sql  003_ops.sql  004_funnel.sql
  ingest_shopify.py   orders, customers, products, costs, stock, transfers, landing sessions
  ingest_meta.py      spend, impressions, purchases, catalog breakdown
  lineage.py          variant matching, styles, re keying
  attribution.py      spend, impressions, purchases, order credit
  customers.py        identity, first orders, CAC, customer value
  collector/app.py    FastAPI pixel endpoint
  collector/pixel.js  Shopify custom pixel + theme snippet
  aggregate.py        panels, calendar, size curve, size availability
  model.py            traffic, conversion, price elasticity, fallbacks
  calibrate.py
  planner.py          forecast for a budget, lost demand, saturation
  purchasing.py
  decisions.py        scorecard, rules, forward plan
  backtest.py
  cli.py
tests/   one file per module; conftest.py with test DB, two fixture tenants, recorded API responses
```

---

### Task 1: Core schema and tenants

**Files:** `config.py`, `db.py`, `tenants.py`, `migrations/001_core.sql`, `tests/conftest.py`, `tests/test_tenants.py`, `pyproject.toml`

**Interfaces:**
* Produces: `connect()`, `migrate(conn)` (idempotent, runs all migrations in order); `Tenant` dataclass (Spec 1 fields); `add_tenant(conn, name, shop_domain, shopify_token_env, meta_token_env, meta_account_ids, po_prefix) -> Tenant` (reads timezone, currency and main location from Shopify; validates ad account currencies via Meta; generates `pixel_key`); `get_tenant(conn, tenant_id) -> Tenant`; `list_tenants(conn) -> list[Tenant]`; `shopify_client(t: Tenant)` and `meta_client(t: Tenant)` returning thin authenticated request wrappers.
* Tables: `tenants`, `products(tenant_id, variant_id, product_id, handle, title, colour, size, sku, inventory_item_id, unit_cost NULL, status, created_at)`, `sales_lines(tenant_id, order_id, date, variant_id, qty, line_value, customer_key)`, `orders(tenant_id, order_id, date, customer_key, utm_source, utm_content, total)`, `calendar(tenant_id, date, flags…)`, `model_params`, `forecasts`, `forecast_accuracy`.

* [ ] Step 1: Tests: `test_migrate_idempotent`; `test_add_tenant_reads_tz_currency_from_shop` (fixture shop EET/EGP); `test_add_tenant_rejects_currency_mismatch`; `test_token_never_stored` (no column contains the token value); `test_tenant_isolation_helper` (rows inserted for tenants A and B; `scoped(conn, A)` queries return only A).
* [ ] Step 2: Run `pytest tests/test_tenants.py`, expect FAIL.
* [ ] Step 3: Implement.
* [ ] Step 4: Run, expect PASS.
* [ ] Step 5: Commit `feat: core schema and tenants`.

### Task 2: Shopify ingest

**Files:** `ingest_shopify.py`, `migrations/003_ops.sql` (locations, stock_daily, suppliers, product_suppliers, purchase_orders, po_lines, decisions, product_plans), `tests/test_ingest_shopify.py`

**Interfaces:** `sync_products(conn, t) -> int` (fills colour and size from option names matching colour/color/اللون and size/المقاس, unit cost from `inventoryItem.unitCost`); `ingest_orders(conn, t, since, until) -> int` (orders, lines, UTM, normalised customer key); `snapshot_stock(conn, t, day) -> int`; `reconstruct_stock(conn, t, until) -> int` (backwards from first snapshot, flagged); `ingest_landing_sessions(conn, t, since, until) -> int`; `fetch_transfer(t, transfer_id) -> dict`.

* [ ] Step 1: Tests: `test_cancelled_excluded`; `test_refund_on_refund_date`; `test_local_date_bucketing_uses_tenant_tz`; `test_idempotent`; `test_missing_cost_null`; `test_option_parsing_arabic_and_english`; `test_phone_normalised` (`01012345678`, `+201012345678`, `00201012345678` → same key); `test_stock_reconstruction`; `test_landing_path_to_handle`.
* [ ] Step 2 to 5: Fail, implement (paginated Admin GraphQL; ShopifyQL for landing sessions), pass, commit `feat: shopify ingest`.

### Task 3: Product lineage

**Files:** `lineage.py`, `migrations/002_lineage.sql`, `tests/test_lineage.py`

**Interfaces:** `normalise_title(title: str, colour_words: set[str]) -> str`; `propose_matches(conn, t) -> pd.DataFrame` (old_variant_id, new_variant_id, method, candidates); `confirm(conn, t, old_variant_id, new_variant_id) -> None`; `build_styles(conn, t) -> int`; `current_variant(conn, t) -> dict[str, str]` (any historical variant ID or Meta catalog ID → current variant ID).

* [ ] Step 1: Tests on a fixture of one old product (5 colours × 4 sizes) split into 5 colour products: `test_sku_match_first`; `test_title_colour_size_match`; `test_ambiguous_goes_to_review` (two candidates → not confirmed); `test_unmatched_keeps_history`; `test_styles_group_old_and_new`; `test_continuous_sales_across_split` (style weekly units before and after split equal fixture totals, none counted twice); `test_meta_old_catalog_id_resolves`.
* [ ] Step 2 to 5: Fail, implement, pass, commit `feat: product lineage`.

### Task 4: Meta ingest

**Files:** `ingest_meta.py`, `tests/test_ingest_meta.py`

**Interfaces:** `fetch_ad_insights(t, account_id, since, until)`; `fetch_catalog_insights(t, account_id, since, until)`; `ingest_spend(conn, t, since, until) -> tuple[int, int]`. Tables `ad_spend_daily`, `catalog_spend_daily` (with impressions, purchases) go in `001_core.sql` via this task's migration edit.

* [ ] Step 1: Tests: `test_purchases_from_actions`; `test_impressions_stored`; `test_all_tenant_accounts_ingested`; `test_pagination`; `test_missing_spend_zero`.
* [ ] Step 2 to 5: Fail, implement, pass, commit `feat: meta ingest`.

### Task 5: Attribution and order credit

**Files:** `attribution.py`, `tests/test_attribution.py`

**Interfaces:** `parse_ad_name(name, known_handles) -> str | None`; `attribute_day(conn, t, day) -> pd.DataFrame` (product_id, method, spend, impressions, meta_purchases); `order_credit(order_lines: pd.DataFrame, ad_product: str | None) -> dict[str, float]`; `run_attribution(conn, t, since, until)`.

* [ ] Step 1: Tests: `test_catalog_maps_to_current_variant_via_lineage`; `test_name_convention`; `test_manual_map`; `test_pool_by_revenue_share`; `test_unknown_to_pool_and_logged`; `test_totals_conserved`; `test_credit_value_split` (800 + 200 → 0.8, 0.2); `test_credit_ad_source_wins` (ad promotes the 200 product → 1.0 and 0.0); `test_credit_ad_product_not_in_order_falls_back_to_value_split`.
* [ ] Step 2 to 5: Fail, implement, pass, commit `feat: attribution`.

### Task 6: Customers, CPA, CAC, customer value

**Files:** `customers.py`, `tests/test_customers.py`

**Interfaces:** `first_orders(conn, t) -> pd.DataFrame`; `cac(conn, t, month, level) -> pd.DataFrame` (blended_cac, paid_cac); `cpa(conn, t, month, level) -> pd.DataFrame` (meta_cpa, shopify_cpa); `customer_value(conn, t, level, months=12) -> pd.DataFrame`.

* [ ] Step 1: Tests: `test_guest_and_account_same_phone_is_one_customer`; `test_repeat_orders_not_new`; `test_cac_uses_credit_split`; `test_meta_cpa_applies_meta_factor` (100 purchases, factor 0.8, spend 8000 → 100); `test_cpa_per_order_not_unit`; `test_young_cohort_scaled`; `test_tenants_isolated`.
* [ ] Step 2 to 5: Fail, implement, pass, commit `feat: customers and acquisition cost`.

### Task 7: Pixel and collector

**Files:** `collector/app.py`, `collector/pixel.js`, `migrations/004_funnel.sql` (`pixel_events(tenant_id, ts, session_hash, event, product_id, variant_id, available)`, `funnel_daily(tenant_id, date, product_id, variant_id, views, size_views, size_views_unavailable, atc, orders)`), `tests/test_collector.py`

**Interfaces:** `POST /e/{tenant_id}` (JSON body, header `X-Signature` = HMAC SHA256 of body with `pixel_key`); `rollup_funnel(conn, t, day) -> int`. `pixel.js` subscribes to `product_viewed`, `product_added_to_cart`, `checkout_completed`, and custom `size_selected` / `notify_me`; the theme snippet publishes `size_selected` on variant change with the variant's availability.

* [ ] Step 1: Tests: `test_bad_signature_401`; `test_unknown_tenant_404`; `test_session_hashed_not_raw`; `test_views_unique_per_session_per_day`; `test_unavailable_size_counted`; `test_rollup_maps_old_variant_via_lineage`.
* [ ] Step 2 to 5: Fail, implement, pass, commit `feat: pixel collector`.

### Task 8: Aggregation and demand model

**Files:** `aggregate.py`, `model.py`, `tests/test_aggregate.py`, `tests/test_model.py`

**Interfaces:**
* `build_panel(conn, t, grain, level) -> pd.DataFrame` columns `entity_id, period_start, views, views_estimated, units, revenue, cost, price, ref_price, spend, impressions, adstock, size_availability, flags…`; `size_curve(conn, t, style_id) -> dict[str, float]`; `adstock(spend, decay)`.
* `DemandParams(entity_id, baseline_v, a, cr_ref, e, seasonal, inherited, fallback: bool)`; `fit_entity(df) -> DemandParams | None`; `fit_all(conn, t, grain, level, run_id)`; `predict(p, adstock, price, size_availability, flags) -> dict` with keys `views, cr_full, units, lost_stock, lost_price, true_demand`.

* [ ] Step 1: Tests: `test_adstock_values`; `test_size_curve_ignores_out_of_stock_periods`; `test_size_curve_blends_pixel_by_sample_size`; `test_size_availability` (sizes S 20%, M 40%, L 40%; M out half the period → 0.8); `test_recovers_synthetic_traffic_and_cr` (within 10%); `test_elasticity_recovered_from_price_changes`; `test_single_price_inherits_e`; `test_lost_stock_formula` (views 1000, cr_full 0.02, availability 0.75 → units 15, lost 5); `test_discount_gives_negative_lost_price`; `test_fallback_when_no_views`; `test_unexplained_small_on_synthetic`; `test_tenant_isolated`.
* [ ] Step 2 to 5: Fail, implement (log linear OLS for views; logistic style fit `ln(cr) = ln(cr_ref) + e ln(price/ref_price)` on periods with availability ≥ 0.8; parents fitted first), pass, commit `feat: demand model`.

### Task 9: Calibration and planner

**Files:** `calibrate.py`, `planner.py`, `tests/test_calibrate.py`, `tests/test_planner.py`

**Interfaces:** `meta_factor(conn, t, month)`; `apply_lift(params, conn, t)`; `set_lift(conn, t, style_id, factor, tested_on)`; `forecast(params, budget, price_plan, stock_plan, grain, horizon) -> pd.DataFrame` (views, units, lost_stock, lost_price, true_demand, revenue, profit, roas, poas, marginal_poas); `spend_at_marginal_poas(p, price, unit_cost, size_availability, decay, target=1.0) -> float`.

* [ ] Step 1: Tests: `test_meta_factor_ratio_and_cap`; `test_lift_scales_a`; `test_default_horizons`; `test_zero_budget_baseline`; `test_marginal_poas_decreasing`; `test_spend_at_marginal_one`; `test_lower_availability_lowers_optimal_spend`; `test_missing_cost_uses_roas_3`.
* [ ] Step 2 to 5: Fail, implement, pass, commit `feat: calibration and planner`.

### Task 10: Backtest

**Files:** `backtest.py`, `tests/test_backtest.py`

**Interfaces:** `score_run(conn, t, run_id)`; `rolling_backtest(conn, t, grain, level, folds=3) -> float`.

* [ ] Step 1: Tests: `test_mape_known`; `test_zero_actual_skipped`; `test_never_sees_future`.
* [ ] Step 2 to 5: Fail, implement, pass, commit `feat: backtest`.

### Task 11: Purchasing

**Files:** `purchasing.py`, `tests/test_purchasing.py`

**Interfaces:** `suggest_pos(conn, t, run_id, cover_days=30) -> list[str]`; `approve_po(conn, t, po_number, edits=None)`; `push_po(conn, t, po_number) -> str`; `sync_receipts(conn, t) -> int`; `cancel_po(conn, t, po_number)`; `restock_lift(conn, t, po_number) -> float | None`.

* [ ] Step 1: Tests: `test_need_uses_true_demand_not_sales`; `test_need_split_by_size_curve`; `test_pack_and_moq`; `test_kill_skipped`; `test_one_draft_per_supplier`; `test_po_number_uses_tenant_prefix`; `test_push_requires_approved`; `test_push_idempotent`; `test_partial_receipt`; `test_received_qty_from_shopify`; `test_restock_lift`.
* [ ] Step 2 to 5: Fail, implement (Spec 28 to 31), pass, commit `feat: purchasing`.

### Task 12: Scorecard, decisions, plan

**Files:** `decisions.py`, `tests/test_decisions.py`

**Interfaces:** `scorecard(conn, t, month, level) -> pd.DataFrame` (Spec 32); `decide(row, history, lead_time) -> tuple[str, str]`; `run_decisions(conn, t, run_id, month)`; `forward_plan(conn, t, run_id, months=3)`.

* [ ] Step 1: Tests, one per rule plus: `test_sold_out_sizes_not_kill`; `test_price_problem_is_fix_price`; `test_entry_product_with_high_value_is_scale` (first order POAS 0.8, paid CAC 300, value 12m 600 → SCALE); `test_kill_requires_low_customer_value`; `test_lineage_history_counts_for_test_rule` (new colour product with 2 years of history via lineage is not TEST); `test_missing_cost_flag`; `test_plan_capped_by_stock`.
* [ ] Step 2 to 5: Fail, implement, pass, commit `feat: decisions and plan`.

### Task 13: CLI and cycle

**Files:** `cli.py`, `tests/test_cli.py`

**Interfaces:** every command takes `--tenant`. Commands: `tenant add|list`, `ingest`, `snapshot_stock`, `lineage propose|confirm|list`, `attribute`, `fit`, `plan`, `suppliers add|list`, `po suggest|list|approve|push|sync|cancel`, `decide`, `report` (scorecard, decisions, lost sales by cause, plan, open POs, unmapped ads, lineage pending review; CSV + terminal table), `backtest`, `cycle` (all stages except approve and push; `--all-tenants` loops every tenant).

* [ ] Step 1: Tests: `test_cycle_end_to_end_two_tenants`; `test_cycle_never_pushes`; `test_report_sections`; `test_commands_require_tenant`.
* [ ] Step 2 to 5: Fail, implement with typer, pass, commit `feat: cli and cycle`.

---

## Operating Cycle

Setup per store, once: create the Shopify custom app and Meta system user token, `tenant add`, install the pixel and theme snippet, add suppliers, run `lineage propose` and confirm the review list.

Daily, scheduled: `snapshot_stock`, `po sync`, collector running.

Monthly on the 1st, scheduled: `cycle --all-tenants`, then `report` per tenant.

You, after the report: act on decisions (scale, kill, fix price, restock first), approve and push POs, confirm pending lineage matches, fix unmapped ads. Each quarter: run a lift or on/off test on the top styles and record it.
