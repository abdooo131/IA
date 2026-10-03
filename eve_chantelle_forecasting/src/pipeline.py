"""Commands: sync, forecast, po, health, pricing, tracker, all, demo. Each prints a plan, logs, and ends in decisions."""
from __future__ import annotations

import datetime as dt
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from src import db
from src.clean.demand import build_clean_layer, resolve_as_of
from src.common import RunContext, fmt_date, no_hyphen, output_path
from src.health.alerts import build_health
from src.models import hierarchy
from src.models.engine import run_forecast
from src.pricing import elasticity as el
from src.pricing import recommendations as rec
from src.replenish import po as po_mod
from src.reports import tracker
from src.reports.excel import write_workbook


class App:
    def __init__(self, settings, db_path=None, outputs_dir=None, logs_dir=None):
        self.settings = settings
        self.db_path = Path(db_path) if db_path else settings.path("database")
        self.outputs_dir = Path(outputs_dir) if outputs_dir else settings.path("outputs_dir")
        self.logs_dir = Path(logs_dir) if logs_dir else settings.path("logs_dir")
        self.written: list[Path] = []

    def context(self, command: str) -> RunContext:
        return RunContext(command, self.settings, self.db_path, self.outputs_dir, self.logs_dir)

    def connect(self):
        return db.connect(self.db_path)

    def write(self, ctx, category, as_of, sheets, summary, suffix=""):
        path = write_workbook(output_path(self.outputs_dir, category, as_of, suffix=suffix), sheets, summary)
        self.written.append(path)
        ctx.info(f"Wrote {path.relative_to(self.outputs_dir.parent) if self.outputs_dir.parent in path.parents else path}")
        return path


def _finish(con, ctx, status, as_of, summary):
    def default(o):
        if isinstance(o, (dt.date, dt.datetime)):
            return o.strftime("%Y %m %d")
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return float(o)
        return str(o)

    db.append(con, "run_log", pd.DataFrame([{
        "run_id": ctx.run_id, "command": ctx.command, "started_at": ctx.started_at, "finished_at": dt.datetime.now(),
        "status": status, "as_of": as_of, "summary": no_hyphen(json.dumps(summary, default=default)),
    }]))
    if ctx.proposals:
        db.append(con, "config_proposals", pd.DataFrame([{
            "run_id": ctx.run_id, "area": p["area"], "current_value": p["current"], "proposed_value": p["proposed"],
            "reason": p["reason"]} for p in ctx.proposals]))
    ctx.info(f"Run {ctx.run_id} {status}. Log at {ctx.logs_dir / (ctx.run_id + '.log')}", echo=False)


def _require_forecast(con):
    latest = db.latest_run(con, "forecast")
    if not latest:
        raise RuntimeError("No forecast yet. Run python main.py forecast first.")
    return latest[0], latest[1]


def _recs(con, ctx, df, vid_col, rtype, qty_col, reason_col, conf_col):
    if df is None or df.empty:
        return
    db.append(con, "recommendations", pd.DataFrame({
        "run_id": ctx.run_id, "variant_id": df[vid_col].to_numpy(), "type": rtype,
        "quantity": df[qty_col].to_numpy() if qty_col else np.nan, "reason": df[reason_col].to_numpy(),
        "confidence": df[conf_col].to_numpy() if conf_col else None,
    }))


# Sync ---------------------------------------------------------------------------------------------


def cmd_sync(app: App) -> dict:
    from src.ingest.sync import get_sync_state, run_sync

    ctx = app.context("sync")
    con = app.connect()
    mode = "incremental since the last sync" if get_sync_state(con, "orders") else "full history (first run)"
    ctx.plan(f"pull Shopify orders, products, variants, inventory and locations, {mode}. "
             "Write raw JSONL to data/raw and daily stock and price snapshots.")
    try:
        summary = run_sync(con, app.settings, ctx)
    except Exception as exc:
        _finish(con, ctx, "failed", None, {"error": str(exc)})
        raise
    ctx.info("Sync done: " + ", ".join(f"{k} {v}" for k, v in summary.items()))
    _finish(con, ctx, "ok", None, summary)
    return summary


# Forecast -----------------------------------------------------------------------------------------


def cmd_forecast(app: App) -> dict:
    ctx = app.context("forecast")
    con = app.connect()
    t0 = time.time()
    as_of = resolve_as_of(con, app.settings)
    ctx.plan(f"clean and rebuild demand up to {fmt_date(as_of)}, then backtest and forecast every active SKU.")
    clean = build_clean_layer(con, app.settings, ctx)
    ctx.info(
        f"Cleaning: {clean['orders_cancelled']} cancelled orders kept out of demand, "
        f"{clean['orders_excluded_test_or_internal']} test or internal orders excluded, "
        f"{clean['stockout_days_snapshot'] + clean['stockout_days_inferred'] + clean['stockout_days_current_stock']} "
        f"stockout days adjusted (+{clean['units_added_by_stockout_adjustment']:.0f} units), "
        f"{clean['outlier_caps']} spikes capped, {clean['discrepancies']} discrepancies."
    )
    out = run_forecast(con, app.settings, ctx, as_of)
    sel, cat, data = out["selection"], out["catalog"], out["data"]
    hier = hierarchy.check(data, out["F"], app.settings)

    beats = cat["selected_wape"] < cat["velocity_30_wape"]
    verdict = (
        f"Forecast beats the 30 day velocity baseline: WAPE {cat['selected_wape']:.3f} vs {cat['velocity_30_wape']:.3f}."
        if beats else
        f"Forecast does NOT beat the 30 day velocity baseline: WAPE {cat['selected_wape']:.3f} vs {cat['velocity_30_wape']:.3f}."
    )
    hold = cat["holdout"]
    hold_txt = (f"Honest check on the latest fold (models chosen on older folds): {hold['selected']:.3f} vs "
                f"{hold['velocity_30']:.3f} for velocity." if hold else "Holdout check needs at least 2 folds.")
    ctx.info(verdict + " " + hold_txt)

    _forecast_reports(app, ctx, con, as_of, clean, out, hier, verdict, hold_txt)
    summary = {"as_of": as_of, "skus": len(sel), "selected_wape": cat["selected_wape"],
               "velocity_30_wape": cat["velocity_30_wape"], "holdout": hold, "seconds": round(time.time() - t0, 1),
               **{k: v for k, v in clean.items() if k != "as_of"}}
    _finish(con, ctx, "ok", as_of, summary)
    ctx.info(f"Forecast done in {time.time() - t0:.0f} seconds.")
    return summary


def _forecast_reports(app, ctx, con, as_of, clean, out, hier, verdict, hold_txt):
    sel, cat, data = out["selection"], out["catalog"], out["data"]
    dv = con.execute("SELECT * FROM dim_variant").df()
    W = int(app.settings["forecast"]["horizon_weeks"])
    weekly = out["weekly"]
    wide = weekly.pivot(index="variant_id", columns="week", values="mean")
    week_names = {w: f"Week {w} from {as_of + dt.timedelta(days=7 * (w - 1) + 1):%d %b}" for w in range(1, W + 1)}
    wide = wide.rename(columns=week_names).reset_index()
    q = weekly.groupby("variant_id").agg(p10_4w=("p10", lambda s: s.iloc[:4].sum()), p90_4w=("p90", lambda s: s.iloc[:4].sum()))
    info = dv[["variant_id", "sku", "product_title", "color", "size", "collection", "supplier"]]
    fc_sheet = (info.merge(sel[["variant_id", "demand_class", "winner", "wape", "confidence"]], on="variant_id")
                .merge(wide, on="variant_id").merge(q, on="variant_id", how="left"))
    fc_sheet["Total 16 weeks"] = fc_sheet[[c for c in fc_sheet.columns if str(c).startswith("Week ")]].sum(axis=1)
    fc_sheet = fc_sheet.rename(columns={"product_title": "product", "winner": "model", "p10_4w": "next 4 weeks p10 (sum of weekly p10)",
                                        "p90_4w": "next 4 weeks p90 (sum of weekly p90)"})
    mix = pd.crosstab(sel["demand_class"], sel["winner"]).reset_index()
    dem = con.execute(
        """SELECT variant_id, sum(stockout_flag::INT) stockout_days, sum(adjusted_demand - capped_demand) units_added,
                  sum(outlier_capped::INT) capped_days FROM fact_demand_daily WHERE date > ? GROUP BY 1""",
        [as_of - dt.timedelta(days=180)],
    ).df().merge(info, on="variant_id")
    dem = dem[(dem["stockout_days"] > 0) | (dem["capped_days"] > 0)].sort_values("units_added", ascending=False)
    caps = con.execute("SELECT date, variant_id, original, capped, threshold FROM cap_log WHERE run_id = ?", [ctx.run_id]).df()
    caps = caps.merge(info[["variant_id", "sku", "product_title"]], on="variant_id", how="left")
    clean_rows = pd.DataFrame([{"Step": k.replace("_", " "), "Value": v if not isinstance(v, dt.date) else fmt_date(v)}
                               for k, v in clean.items()])
    summary = [
        f"Demand forecast as of {fmt_date(as_of)}, {len(sel)} SKUs, horizon {W} weeks.",
        verdict, hold_txt,
        f"Confidence: {(sel['confidence'] == 'high').sum()} high, {(sel['confidence'] == 'medium').sum()} medium, "
        f"{(sel['confidence'] == 'low').sum()} low.",
        f"Hierarchy: {(hier['flag'] == 'review').sum() if len(hier) else 0} groups where bottom up and top down disagree by "
        f"more than {app.settings['forecast']['hierarchy_divergence_flag']:.0%}.".replace("%", " percent"),
        "Forecasts are stockout adjusted demand, not sales. Cancelled orders are excluded.",
    ]
    app.write(ctx, "demand_forecast", as_of, {
        "SKU forecast": fc_sheet, "Hierarchy check": hier, "Model mix": mix,
        "Stockout and caps 180d": dem, "Outlier caps": caps, "Cleaning log": clean_rows,
    }, summary)

    acc_hist = con.execute("SELECT * FROM accuracy_history ORDER BY as_of, run_id").df()
    by_class = sel.groupby("demand_class").agg(SKUs=("variant_id", "count"), median_wape=("wape", "median"),
                                               median_bias=("bias", "median"), p90_hit_rate=("p90_hit_rate", "mean")).reset_index()
    comp = pd.DataFrame([
        {"Scope": "All folds, per SKU winner", "Selected WAPE": cat["selected_wape"], "Velocity 30 WAPE": cat["velocity_30_wape"],
         "Actual units": cat["actual_units"]},
        *([{"Scope": "Latest fold holdout", "Selected WAPE": cat["holdout"]["selected"],
            "Velocity 30 WAPE": cat["holdout"]["velocity_30"], "Actual units": cat["holdout"]["actual_units"]}] if cat["holdout"] else []),
    ])
    weights = pd.DataFrame([{"Class": c, "Model": m, "Weight": w} for c, d in cat["ensemble_weights"].items() for m, w in d.items()])
    sku_acc = info.merge(sel.drop(columns=["run_id"]), on="variant_id").sort_values("wape", ascending=False)
    proposals = pd.DataFrame(ctx.proposals) if ctx.proposals else pd.DataFrame({"Note": ["No config changes proposed"]})
    app.write(ctx, "accuracy_report", as_of, {
        "Catalog vs baseline": comp, "By class": by_class, "Ensemble weights": weights, "SKU accuracy": sku_acc,
        "Accuracy over time": acc_hist, "Config proposals": proposals,
    }, [
        verdict, hold_txt,
        f"Backtest: {cat['standard_folds']} rolling origin folds, horizon {cat['backtest_horizon_days']} days "
        "(longest supplier lead time plus review period), errors on weekly buckets.",
        "Config proposals are suggestions only. Nothing in config was changed.",
    ])


# Replenishment and the rest -----------------------------------------------------------------------


def _replenishment(app, con, ctx):
    run_id, as_of = _require_forecast(con)
    repl = po_mod.compute_replenishment(con, app.settings, run_id, as_of)
    return run_id, as_of, repl


def cmd_po(app: App, filter_args: list[str] | None = None) -> dict:
    ctx = app.context("po")
    con = app.connect()
    filters = po_mod.parse_filters(filter_args or [])
    run_id, as_of, _ = None, None, None
    run_id, as_of = _require_forecast(con)
    ftxt = ", ".join(f"{k} {'/'.join(v)}" for k, v in filters.items()) or "all active SKUs"
    ctx.plan(f"purchase orders for {ftxt}, from forecast {run_id} as of {fmt_date(as_of)}, grouped by supplier. "
             "Output purchase_order Excel.")
    _, _, repl = _replenishment(app, con, ctx)
    sub = po_mod.apply_filters(repl, filters)
    tables = po_mod.po_tables(sub)
    s = tables["Summary"]
    lines = sub[sub["order_qty"] > 0]
    review = app.settings["replenishment"]["review_period_days"]
    assumptions = pd.DataFrame([
        {"Item": "Review period days", "Value": review},
        {"Item": "Cycle cover days", "Value": app.settings["replenishment"]["cycle_cover_days"]},
        {"Item": "Inventory position", "Value": "on hand minus committed plus incoming"},
        *[{"Item": f"{sup} lead time days", "Value": f"{g['lead_time_days'].iloc[0]} ({'confirmed' if g['supplier_confirmed'].iloc[0] else 'NOT confirmed'})"}
          for sup, g in sub.groupby("supplier")],
        *[{"Item": f"Service level {a}{x}", "Value": v} for a, d in app.settings["replenishment"]["service_levels"].items() for x, v in d.items()],
    ])
    tables["Assumptions"] = assumptions
    summary = [f"Purchase orders as of {fmt_date(as_of)} for {ftxt}."]
    for _, r in s.iterrows():
        summary.append(f"{r['Supplier']}: {int(r['SKUs'])} SKUs, {int(r['Units'])} units, total cost {r['Total cost']:,.0f}.")
    if s.empty:
        summary.append("No SKU is at or below its reorder point. Nothing to order.")
    if (~sub["supplier_confirmed"]).any():
        summary.append("Lead times and MOQs are config placeholders until confirmed in config/suppliers.yaml.")
    suffix = "_".join(f"{k}_{'_'.join(v)}" for k, v in filters.items())
    path = app.write(ctx, "purchase_order", as_of, tables, summary, suffix=suffix)
    _recs(con, ctx, lines, "variant_id", "reorder", "order_qty", "reason", "confidence")
    _recs(con, ctx, sub[sub["is_dead"] | sub["is_long_stockout"]], "variant_id", "not ordered", None, "reason", "confidence")
    for line in summary[1:]:
        ctx.info(line)
    result = {"as_of": as_of, "lines": int(len(lines)), "units": int(lines["order_qty"].sum()),
              "cost": float(lines["line_total"].sum()), "file": str(path)}
    _finish(con, ctx, "ok", as_of, result)
    return result


def cmd_health(app: App) -> dict:
    ctx = app.context("health")
    con = app.connect()
    run_id, as_of = _require_forecast(con)
    ctx.plan(f"inventory health as of {fmt_date(as_of)}: low stock, slow, dead, overstock, discrepancies, "
             "cancellations, unfulfilled queue. Output restock_alert, dead_stock, overstock, discrepancy, cancelled_orders.")
    _, _, repl = _replenishment(app, con, ctx)
    hl = build_health(con, app.settings, run_id, as_of, repl)
    h = app.settings["health"]
    base = ["sku", "product_title", "color", "size", "collection", "supplier"]
    low = hl["low"][base + ["on_hand", "committed", "incoming", "daily_forecast_30", "days_to_stockout", "price",
                            "revenue_at_risk_per_day", "order_qty", "cover_bought_days", "action", "confidence"]]
    app.write(ctx, "restock_alert", as_of, {"Low stock": low, "Unfulfilled queue": hl["unfulfilled"]}, [
        f"{len(low)} SKUs projected to run out within {h['low_stock_days']} days, ranked by revenue at risk per day.",
        f"Revenue at risk per day across them: {hl['low']['revenue_at_risk_per_day'].sum():,.0f}.",
        f"Unfulfilled queue: {int(hl['unfulfilled']['Units'].sum()) if len(hl['unfulfilled']) else 0} committed units reduce available stock.",
    ])
    dead = hl["dead"][base + ["on_hand", "sold_90", "days_since_last_sale", "unit_value", "cost_basis", "stock_value"]]
    slow = hl["slow"][base + ["on_hand", "sold_90", "sell_through_90", "stock_value"]]
    app.write(ctx, "dead_stock", as_of, {"Dead stock": dead, "Slow stock": slow}, [
        f"{len(dead)} dead SKUs (no sales in {h['dead_days']} days) tie up {dead['stock_value'].sum():,.0f} "
        "(unit cost, or price where cost is missing).",
        f"{len(slow)} slow SKUs sell through under {h['slow_sell_through_target']:.0%} in {h['slow_window_days']} days.".replace("%", " percent"),
        "Slow stock sits in this file because there is no slow stock category. Flagged for Assal.",
    ])
    over = hl["over"][base + ["on_hand", "incoming", "daily_forecast_30", "days_cover_position", "excess_units", "excess_value"]]
    app.write(ctx, "overstock", as_of, {"By collection": hl["over_by_collection"], "By product": hl["over_by_product"], "SKUs": over}, [
        f"{len(over)} SKUs hold more than {h['overstock_cover_days']} days of forecast cover, excess value "
        f"{hl['over']['excess_value'].sum():,.0f}.",
    ])
    disc = hl["discrepancies"].drop(columns=["run_id"], errors="ignore")
    app.write(ctx, "discrepancy", as_of, {"Discrepancies": disc}, [
        f"{len(disc)} findings: {int((disc['problem_kind'] == 'data problem').sum())} data problems, "
        f"{int((disc['problem_kind'] == 'process problem').sum())} process problems.",
        "Data problem means Shopify records are wrong or incomplete. Process problem means stock or orders were handled outside the system.",
    ])
    ct = hl["cancel_totals"]
    app.write(ctx, "cancelled_orders", as_of, {"Totals": ct, "Top reasons": hl["cancel_reasons"], "Top SKUs": hl["cancel_top_skus"]}, [
        f"Last 90 days: {int(ct.iloc[0]['Orders'])} cancelled orders, {int(ct.iloc[0]['Units'])} units, value {ct.iloc[0]['Value']:,.0f}.",
        "Cancelled orders never count as demand.",
    ])
    _recs(con, ctx, hl["low"], "variant_id", "low stock", "order_qty", "action", "confidence")
    result = {"as_of": as_of, "low_stock": len(low), "dead": len(dead), "slow": len(slow), "overstock": len(over),
              "discrepancies": len(disc)}
    ctx.info("Health: " + ", ".join(f"{k} {v}" for k, v in result.items() if k != "as_of"))
    _finish(con, ctx, "ok", as_of, result)
    return result


def _pricing_frames(app, con, run_id, as_of, repl):
    hl = build_health(con, app.settings, run_id, as_of, repl)
    els = el.estimate(con, app.settings, as_of)
    eps = el.markdown_episodes(con, as_of)
    md = rec.markdowns(hl, els, eps, app.settings)
    mu = rec.markups(hl, els, app.settings)
    return hl, els, eps, md, mu


def cmd_pricing(app: App) -> dict:
    ctx = app.context("pricing")
    con = app.connect()
    run_id, as_of = _require_forecast(con)
    ctx.plan(f"price elasticity, markdown and markup calls as of {fmt_date(as_of)}. "
             "Output markdown_recommendation and markup_recommendation.")
    _, _, repl = _replenishment(app, con, ctx)
    hl, els, eps, md, mu = _pricing_frames(app, con, run_id, as_of, repl)
    titles = con.execute("SELECT product_id, title FROM dim_product").df()
    els_out = els.merge(titles, on="product_id", how="left")
    eps_out = eps.merge(titles, on="product_id", how="left") if len(eps) else eps
    prod_md = pd.DataFrame()
    if len(md):
        w = md.assign(_w=np.maximum(md["stock_value"], 1), _wm=md["markdown_pct"] * np.maximum(md["stock_value"], 1))
        prod_md = w.groupby(["collection", "product_title"]).agg(
            SKUs=("sku", "count"), Stock_value=("stock_value", "sum"), _wm=("_wm", "sum"), _w=("_w", "sum")).reset_index()
        prod_md["Markdown percent stock weighted"] = prod_md["_wm"] / prod_md["_w"]
        prod_md = prod_md.drop(columns=["_wm", "_w"])
    app.write(ctx, "markdown_recommendation", as_of, {
        "SKU markdowns": md.drop(columns=["product_id"], errors="ignore"), "By product": prod_md,
        "Past markdowns": eps_out, "Elasticity": els_out,
    }, [
        f"{len(md)} SKUs to mark down, stock value {md['stock_value'].sum() if len(md) else 0:,.0f}.",
        f"Elasticity estimated for {int((els['level'] != 'default').sum()) if len(els) else 0} of {len(els)} products, "
        "the rest use the collection, product type or default value.",
        "Each reason says what changed, what happened last time and what is expected now.",
    ])
    app.write(ctx, "markup_recommendation", as_of, {"SKU markups": mu.drop(columns=["product_id"], errors="ignore")}, [
        f"{len(mu)} markup candidates: repeated stockouts with strong demand.",
    ])
    _recs(con, ctx, md, "variant_id", "markdown", "markdown_pct", "reason", "confidence")
    _recs(con, ctx, mu, "variant_id", "markup", "markup_pct", "reason", "confidence")
    result = {"as_of": as_of, "markdowns": len(md), "markups": len(mu)}
    ctx.info(f"Pricing: {len(md)} markdown calls, {len(mu)} markup calls.")
    _finish(con, ctx, "ok", as_of, result)
    return result


def cmd_tracker(app: App) -> dict:
    ctx = app.context("tracker")
    con = app.connect()
    run_id, as_of = _require_forecast(con)
    ctx.plan(f"merchandise tracker for every active SKU as of {fmt_date(as_of)}. Output merch_tracker Excel.")
    _, _, repl = _replenishment(app, con, ctx)
    hl, _, _, md, mu = _pricing_frames(app, con, run_id, as_of, repl)
    sheets = tracker.build(hl, md, mu, app.settings)
    counts = sheets["Status counts"]
    app.write(ctx, "merch_tracker", as_of, sheets, [
        f"Merchandise tracker as of {fmt_date(as_of)}, {len(sheets['By SKU'])} active SKUs.",
        ", ".join(f"{r['Alert status']} {r['SKUs']}" for _, r in counts.iterrows()),
    ])
    result = {"as_of": as_of, "skus": len(sheets["By SKU"])}
    _finish(con, ctx, "ok", as_of, result)
    return result


def cmd_all(app: App, include_sync: bool = True) -> dict:
    out = {}
    if include_sync:
        out["sync"] = cmd_sync(app)
    out["forecast"] = cmd_forecast(app)
    out["po"] = cmd_po(app)
    out["health"] = cmd_health(app)
    out["pricing"] = cmd_pricing(app)
    out["tracker"] = cmd_tracker(app)
    return out


def cmd_demo(app: App, n_products: int = 40, seed: int = 7) -> dict:
    """Build a synthetic store, load it through the real loaders and run the full pipeline."""
    from src.fixtures import synthetic

    ctx = app.context("demo")
    ctx.plan(f"generate a synthetic store with {n_products} products, load it into {app.db_path}, "
             f"then run forecast, po, health, pricing and tracker into {app.outputs_dir}.")
    if app.db_path.exists():
        app.db_path.unlink()
    con = app.connect()
    fx = synthetic.generate(app.settings, app.db_path.parent / "demo_raw", n_products=n_products, seed=seed)
    loaded = synthetic.load_into(con, app.settings, fx, ctx.run_id)
    ctx.info("Demo store loaded: " + ", ".join(f"{k} {v}" for k, v in loaded.items()))
    _finish(con, ctx, "ok", fx["as_of"], loaded)
    con.close()
    return cmd_all(app, include_sync=False)
