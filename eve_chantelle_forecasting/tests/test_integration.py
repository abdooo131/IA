"""Full pipeline on a small synthetic store, checked against the SRD acceptance criteria."""
import datetime as dt
import re

import numpy as np
import pandas as pd
import pytest

from src import db
from src.config import load_settings
from src.fixtures import synthetic
from src.pipeline import App, cmd_forecast, cmd_health, cmd_po, cmd_pricing, cmd_tracker
from src.reports.excel import text_cells


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("pipeline")
    settings = load_settings(overrides={"forecast": {"lightgbm": {"n_estimators": 80}}})
    app = App(settings, db_path=tmp / "w.duckdb", outputs_dir=tmp / "outputs", logs_dir=tmp / "logs")
    con = app.connect()
    fx = synthetic.generate(settings, tmp / "raw", start=dt.date(2025, 3, 1), end=dt.date(2026, 10, 2), n_products=12, seed=3)
    synthetic.load_into(con, settings, fx)
    con.close()
    results = {"forecast": cmd_forecast(app), "po": cmd_po(app), "health": cmd_health(app),
               "pricing": cmd_pricing(app), "tracker": cmd_tracker(app)}
    filtered = cmd_po(app, ["filter", "color", "BLACK", "supplier", "BOBO"])
    return {"app": app, "fx": fx, "res": results, "filtered": filtered, "con": db.connect(app.db_path)}


def test_cancelled_orders_excluded_and_reported(run):
    con = run["con"]
    n = con.execute("SELECT count(DISTINCT order_id) FROM fact_cancellations").fetchone()[0]
    assert n == run["fx"]["n_cancelled_orders"] > 0
    sold = con.execute("SELECT sum(units_gross) FROM fact_sales_daily").fetchone()[0]
    truth = run["fx"]["truth"]["true_units"].sum()
    # Only real sales remain: simulated sales plus the planted 40 unit bulk order. Cancelled, test,
    # internal and deleted variant lines are all out.
    assert sold == truth + 40
    files = [p.name for p in run["app"].written]
    assert any(f.startswith("cancelled_orders_") for f in files)


def test_stockouts_detected_and_adjusted(run):
    con = run["con"]
    so, added = con.execute(
        "SELECT sum(stockout_flag::INT), sum(adjusted_demand - capped_demand) FROM fact_demand_daily"
    ).fetchone()
    assert so > 0 and added > 0
    spike = con.execute("SELECT count(*) FROM cap_log WHERE variant_id = ? AND date = ?",
                        [run["fx"]["spike_variant"], run["fx"]["spike_date"]]).fetchone()[0]
    assert spike >= 1


def test_every_active_sku_has_forecast(run):
    con = run["con"]
    run_id = db.latest_run(con, "forecast")[0]
    active = set(con.execute("SELECT variant_id FROM dim_variant WHERE active").df()["variant_id"])
    sel = con.execute("SELECT * FROM model_selection WHERE run_id = ?", [run_id]).df()
    sel = sel[sel["variant_id"].isin(active)]
    assert set(sel["variant_id"]) == active
    assert sel["winner"].notna().all() and sel["confidence"].isin(["high", "medium", "low"]).all()
    assert sel["wape"].notna().all()
    fc = con.execute("SELECT variant_id, min(p10 <= p50 AND p50 <= p90) ok FROM forecasts WHERE run_id = ? GROUP BY 1",
                     [run_id]).df()
    assert set(fc["variant_id"]) == active and fc["ok"].all()


def test_accuracy_reported_against_baseline(run):
    f = run["res"]["forecast"]
    assert np.isfinite(f["selected_wape"]) and np.isfinite(f["velocity_30_wape"])


def test_po_grouping_pack_and_filters(run):
    path = run["res"]["po"]["file"]
    sheets = pd.read_excel(path, sheet_name=None)
    sup_sheets = [s for s in sheets if s in ("BOBO", "Elassal", "UNASSIGNED")]
    assert sup_sheets
    for s in sup_sheets:
        q = sheets[s]["Quantity"]
        assert (q % 6 == 0).all() and (q >= 6).all()
    assert "Summary" in sheets
    fpath = run["filtered"]["file"]
    assert fpath.endswith("_color_black_supplier_bobo.xlsx")
    fs = pd.read_excel(fpath, sheet_name=None)
    for s in fs:
        if s not in ("Read me", "Summary", "Assumptions", "Not ordered"):
            assert s == "BOBO" and (fs[s]["Color"] == "BLACK").all()


def test_health_pricing_tracker_outputs(run):
    names = {p.name.rsplit("_2", 1)[0] for p in run["app"].written}
    for cat in ("restock_alert", "dead_stock", "overstock", "discrepancy", "cancelled_orders",
                "markdown_recommendation", "markup_recommendation", "merch_tracker", "demand_forecast", "accuracy_report"):
        assert cat in names
    disc = run["con"].execute("SELECT type FROM discrepancies").df()["type"]
    for t in ("duplicate sku", "variant without sku", "negative stock", "broken variant mapping"):
        assert t in set(disc)
    md = [p for p in run["app"].written if p.name.startswith("markdown_recommendation")][0]
    sku_md = pd.read_excel(md, sheet_name="SKU markdowns")
    if "Reason" in sku_md:
        assert sku_md["Reason"].str.contains("What changed").all()


def test_no_hyphens_in_human_output(run):
    bad = []
    for path in run["app"].written:
        for sheet, col, v in text_cells(path):
            if re.search(r"[-‐-—−]", v):
                bad.append((path.name, sheet, col, v))
    assert not bad, bad[:5]
    for log in (run["app"].logs_dir).glob("*.log"):
        for line in log.read_text().splitlines():
            assert not re.search(r"[-‐-—−]", line), line


def test_idempotent_forecast(run):
    app, con = run["app"], run["con"]
    first = db.latest_run(con, "forecast")[0]
    con.close()
    cmd_forecast(app)
    con = db.connect(app.db_path)
    second = db.latest_run(con, "forecast")[0]
    a = con.execute("SELECT variant_id, date, mean, p90 FROM forecasts WHERE run_id = ? ORDER BY 1, 2", [first]).df()
    b = con.execute("SELECT variant_id, date, mean, p90 FROM forecasts WHERE run_id = ? ORDER BY 1, 2", [second]).df()
    pd.testing.assert_frame_equal(a, b)
    run["con"] = con


def test_runs_without_lightgbm(tmp_path, monkeypatch):
    """A Mac without libomp cannot load LightGBM. The forecast must still finish with the other models."""
    from src.models import ml

    monkeypatch.setattr(ml, "lgb", None)
    monkeypatch.setattr(ml, "IMPORT_ERROR", "Library not loaded: libomp.dylib")
    settings = load_settings()
    app = App(settings, db_path=tmp_path / "w.duckdb", outputs_dir=tmp_path / "outputs", logs_dir=tmp_path / "logs")
    con = app.connect()
    fx = synthetic.generate(settings, tmp_path / "raw", start=dt.date(2025, 6, 1), end=dt.date(2026, 10, 2), n_products=5, seed=5)
    synthetic.load_into(con, settings, fx)
    con.close()
    out = cmd_forecast(app)
    assert out["skus"] > 0
    con = db.connect(app.db_path)
    winners = set(con.execute("SELECT winner FROM model_selection").df()["winner"])
    assert not any("lightgbm" in w for w in winners)
    assert "LightGBM could not load" in next((app.logs_dir).glob("*.log")).read_text()
