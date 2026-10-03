"""Local dashboard. Run: streamlit run dashboard/app.py
Set EC_DB to point at another warehouse, for example data/demo/demo_warehouse.duckdb."""
from __future__ import annotations

import datetime as dt
import os
import sys
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src import db  # noqa: E402
from src.config import load_settings  # noqa: E402
from src.health.alerts import build_health  # noqa: E402
from src.replenish import po as po_mod  # noqa: E402

BLUE, ORANGE, BAND = "#2a78d6", "#eb6834", "#b7d3f6"

st.set_page_config(page_title="Eve Chantelle Forecasting", layout="wide")
settings = load_settings()
db_path = Path(os.environ.get("EC_DB", settings.path("database")))
if not db_path.is_absolute():
    db_path = ROOT / db_path
if not db_path.exists():
    st.error(f"No warehouse at {db_path}. Run python main.py all (or demo) first.")
    st.stop()


@st.cache_resource
def connection():
    return db.connect(db_path, read_only=True)


con = connection()
latest = db.latest_run(con, "forecast")
if not latest:
    st.error("No forecast run yet. Run python main.py forecast.")
    st.stop()
run_id, as_of = latest


@st.cache_data
def q(sql: str, params: tuple = ()):
    return con.execute(sql, list(params)).df()


@st.cache_data
def replenishment(run_id: str):
    return po_mod.compute_replenishment(con, settings, run_id, as_of)


@st.cache_data
def health(run_id: str):
    hl = build_health(con, settings, run_id, as_of, replenishment(run_id))
    return {k: v for k, v in hl.items()}


page = st.sidebar.radio("Page", ["Overview", "SKU explorer", "Purchase orders", "Health alerts", "Pricing", "Accuracy", "Data issues"])
st.sidebar.caption(f"Forecast {run_id}, data as of {as_of:%d %b %Y}")
repl = replenishment(run_id)
dv = q("SELECT * FROM dim_variant")

if page == "Overview":
    st.title("Overview")
    hl = health(run_id)
    c = st.columns(5)
    c[0].metric("Active SKUs", int(repl.shape[0]))
    c[1].metric("SKUs to reorder", int((repl["order_qty"] > 0).sum()))
    c[2].metric("Reorder value", f"{repl['line_total'].sum():,.0f}")
    c[3].metric("Low stock SKUs", len(hl["low"]))
    c[4].metric("Dead stock value", f"{hl['dead']['stock_value'].sum():,.0f}")
    acc = q("SELECT * FROM accuracy_history WHERE run_id = ?", (run_id,))
    st.subheader("Forecast accuracy, lower WAPE is better")
    st.dataframe(acc[["scope", "model", "wape", "skus"]], hide_index=True)
    w = q("SELECT week_start, sum(mean) units FROM forecasts_weekly WHERE run_id = ? GROUP BY 1 ORDER BY 1", (run_id,))
    st.subheader("Total forecast units per week")
    st.altair_chart(alt.Chart(w).mark_bar(color=BLUE, cornerRadiusTopLeft=4, cornerRadiusTopRight=4).encode(
        x=alt.X("monthdate(week_start):O", title="Week starting"), y=alt.Y("units:Q", title="Units"),
        tooltip=[alt.Tooltip("week_start:T", title="Week"), alt.Tooltip("units:Q", format=",.0f")]), use_container_width=True)

elif page == "SKU explorer":
    st.title("SKU explorer")
    opts = dv[dv["active"]].sort_values(["product_title", "color", "size"])
    labels = (opts["sku"].fillna("NO SKU") + "  " + opts["product_title"] + " " + opts["color"] + " " + opts["size"]).tolist()
    choice = st.selectbox("SKU", range(len(opts)), format_func=lambda i: labels[i])
    vid = opts["variant_id"].iloc[choice]
    sel = q("SELECT * FROM model_selection WHERE run_id = ? AND variant_id = ?", (run_id, vid))
    if len(sel):
        s = sel.iloc[0]
        c = st.columns(4)
        c[0].metric("Model", s["winner"])
        c[1].metric("Backtest WAPE", f"{s['wape']:.2f}" if pd.notna(s["wape"]) else "n a")
        c[2].metric("Demand class", s["demand_class"])
        c[3].metric("Confidence", s["confidence"])
        st.caption(s["confidence_reason"])
    hist = q("""SELECT date_trunc('week', date) AS week, sum(observed_demand) observed, sum(adjusted_demand) adjusted,
                       sum(stockout_flag::INT) stockout_days FROM fact_demand_daily WHERE variant_id = ? GROUP BY 1 ORDER BY 1""", (vid,))
    fc = q("SELECT week_start AS week, mean, p10, p90 FROM forecasts_weekly WHERE run_id = ? AND variant_id = ? ORDER BY 1", (run_id, vid))
    long = hist.melt("week", ["observed", "adjusted"], var_name="series", value_name="units")
    long["series"] = long["series"].map({"observed": "Sold", "adjusted": "Adjusted demand"})
    color = alt.Scale(domain=["Adjusted demand", "Sold"], range=[BLUE, ORANGE])
    lines = alt.Chart(long).mark_line(strokeWidth=2).encode(
        x=alt.X("week:T", title="Week"), y=alt.Y("units:Q", title="Units per week"),
        color=alt.Color("series:N", scale=color, legend=alt.Legend(orient="top", title=None)),
        tooltip=["week:T", "series:N", alt.Tooltip("units:Q", format=".1f")])
    band = alt.Chart(fc).mark_area(color=BAND, opacity=0.6).encode(x="week:T", y="p10:Q", y2="p90:Q",
                                                                 tooltip=["week:T", alt.Tooltip("p10:Q", format=".1f"), alt.Tooltip("p90:Q", format=".1f")])
    mean = alt.Chart(fc).mark_line(color=BLUE, strokeWidth=2, strokeDash=[4, 3]).encode(
        x="week:T", y="mean:Q", tooltip=["week:T", alt.Tooltip("mean:Q", format=".1f", title="Forecast")])
    st.altair_chart((band + lines + mean).interactive(), use_container_width=True)
    st.caption("Shaded band is the p10 to p90 forecast range, the dashed line is the forecast mean.")
    so = hist[hist["stockout_days"] > 0][["week", "stockout_days"]].copy()
    so["week"] = pd.to_datetime(so["week"]).dt.strftime("%d %b %Y")
    st.subheader("Weeks with stockout days")
    st.dataframe(so, hide_index=True)
    r = repl[repl["variant_id"] == vid]
    if len(r):
        st.subheader("Replenishment")
        st.write(r.iloc[0]["reason"])

elif page == "Purchase orders":
    st.title("Purchase orders")
    c = st.columns(3)
    sup = c[0].multiselect("Supplier", sorted(repl["supplier"].unique()))
    col = c[1].multiselect("Color", sorted(repl["color"].unique()))
    coll = c[2].multiselect("Collection", sorted(repl["collection"].unique()))
    f = repl[repl["order_qty"] > 0]
    if sup:
        f = f[f["supplier"].isin(sup)]
    if col:
        f = f[f["color"].isin(col)]
    if coll:
        f = f[f["collection"].isin(coll)]
    st.dataframe(f.groupby("supplier").agg(SKUs=("sku", "count"), Units=("order_qty", "sum"), Cost=("line_total", "sum")))
    st.dataframe(f[["supplier", "sku", "product_title", "color", "size", "order_qty", "unit_cost", "line_total",
                    "confidence", "reason", "flags"]], hide_index=True)
    st.caption("Export with: python main.py po filter supplier BOBO color BLACK")

elif page == "Health alerts":
    st.title("Health alerts")
    hl = health(run_id)
    tabs = st.tabs(["Low stock", "Slow", "Dead", "Overstock", "Unfulfilled"])
    tabs[0].dataframe(hl["low"][["sku", "product_title", "color", "size", "days_to_stockout", "revenue_at_risk_per_day", "order_qty", "action"]], hide_index=True)
    tabs[1].dataframe(hl["slow"][["sku", "product_title", "on_hand", "sold_90", "sell_through_90", "stock_value"]], hide_index=True)
    tabs[2].dataframe(hl["dead"][["sku", "product_title", "on_hand", "days_since_last_sale", "stock_value", "cost_basis"]], hide_index=True)
    tabs[3].dataframe(hl["over_by_collection"], hide_index=True)
    tabs[4].dataframe(hl["unfulfilled"], hide_index=True)

elif page == "Pricing":
    st.title("Pricing")
    recs = q("""SELECT r.type, d.sku, d.product_title, d.color, d.size, r.quantity AS percent, r.confidence, r.reason
                FROM recommendations r JOIN dim_variant d USING (variant_id)
                WHERE r.type IN ('markdown', 'markup') AND r.run_id = (SELECT max(run_id) FROM run_log WHERE command = 'pricing' AND status = 'ok')""")
    if recs.empty:
        st.info("Run python main.py pricing to fill this page.")
    for t in ("markdown", "markup"):
        st.subheader(t.title())
        st.dataframe(recs[recs["type"] == t].drop(columns=["type"]), hide_index=True)
    ph = q("""SELECT p.date, d.sku, p.price FROM fact_price_history p JOIN dim_variant d USING (variant_id) ORDER BY 1""")
    st.subheader("Price history snapshots")
    ph["date"] = pd.to_datetime(ph["date"]).dt.strftime("%d %b %Y")
    st.dataframe(ph.tail(500), hide_index=True)

elif page == "Accuracy":
    st.title("Accuracy")
    acc = q("SELECT * FROM accuracy_history ORDER BY as_of")
    cat = acc[acc["scope"].isin(["catalog all folds", "latest fold holdout"])].copy()
    cat["label"] = cat["scope"] + ", " + cat["model"]
    st.altair_chart(alt.Chart(cat).mark_line(point=alt.OverlayMarkDef(size=64), strokeWidth=2).encode(
        x=alt.X("as_of:T", title="Data as of"), y=alt.Y("wape:Q", title="WAPE"),
        color=alt.Color("label:N", legend=alt.Legend(orient="top", title=None),
                        scale=alt.Scale(range=[BLUE, ORANGE, "#1baf7a", "#eda100"])),
        tooltip=["as_of:T", "label:N", alt.Tooltip("wape:Q", format=".3f")]), use_container_width=True)
    sel = q("SELECT * FROM model_selection WHERE run_id = ?", (run_id,))
    st.subheader("Winning models")
    st.dataframe(pd.crosstab(sel["demand_class"], sel["winner"]))
    st.subheader("SKU accuracy")
    st.dataframe(sel.merge(dv[["variant_id", "sku", "product_title"]], on="variant_id")[
        ["sku", "product_title", "demand_class", "winner", "wape", "bias", "p90_hit_rate", "confidence"]], hide_index=True)

elif page == "Data issues":
    st.title("Data issues")
    d = q("SELECT * FROM discrepancies")
    st.dataframe(d.drop(columns=["run_id"]), hide_index=True)
    caps = q("SELECT strftime(c.date, '%d %b %Y') AS date, d.sku, c.original, c.capped, c.threshold FROM cap_log c JOIN dim_variant d USING (variant_id) "
             "WHERE c.run_id = ?", (run_id,))
    st.subheader("Outlier caps this run")
    st.dataframe(caps, hide_index=True)
