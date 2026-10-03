"""Replenishment engine and purchase orders grouped by supplier."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from src.common import no_hyphen
from src.replenish import safety_stock as ss
from src.replenish.position import stock_metrics

FILTER_KEYS = {"color", "collection", "supplier", "product", "product_type", "abc", "sku", "size"}


def load_forecast(con, run_id: str) -> tuple[list[str], np.ndarray]:
    f = con.execute(
        "SELECT variant_id, date, mean FROM forecasts WHERE run_id = ? ORDER BY variant_id, date", [run_id]
    ).df()
    if f.empty:
        return [], np.zeros((0, 0))
    wide = f.pivot(index="variant_id", columns="date", values="mean").fillna(0)
    return list(wide.index), wide.to_numpy()


def compute_replenishment(con, settings, run_id: str, as_of: dt.date) -> pd.DataFrame:
    rcfg = settings["replenishment"]
    review = int(rcfg["review_period_days"])
    cycle = int(rcfg["cycle_cover_days"])
    m = stock_metrics(con, settings, as_of)
    sel = con.execute("SELECT * FROM model_selection WHERE run_id = ?", [run_id]).df()
    vids, F = load_forecast(con, run_id)
    H = F.shape[1]
    fidx = {v: i for i, v in enumerate(vids)}
    m = m[m["variant_id"].isin(fidx) & m["active"]].copy().reset_index(drop=True)
    m = m.merge(sel[["variant_id", "winner", "wape", "bias", "dispersion", "confidence", "confidence_reason",
                     "demand_class"]], on="variant_id", how="left")

    rows = np.array([fidx[v] for v in m["variant_id"]])
    Fm = F[rows] if len(rows) else np.zeros((0, H))
    L = m["lead_time_days"].to_numpy().astype(int)
    prot = np.minimum(L + review, H)
    cyc_end = np.minimum(prot + cycle, H)
    cs = np.concatenate([np.zeros((len(m), 1)), np.cumsum(Fm, axis=1)], axis=1)
    ar = np.arange(len(m))
    m["daily_forecast_30"] = (cs[:, min(30, H)] / min(30, H)) if len(m) else []
    m["lead_time_demand"] = cs[ar, prot]
    m["cycle_demand"] = cs[ar, cyc_end] - cs[ar, prot]
    m["forecast_4w"] = cs[:, min(28, H)]
    m["forecast_8w"] = cs[:, min(56, H)]

    m["abc"] = ss.abc(m["revenue_net_window"].to_numpy(), tuple(rcfg["abc_cutoffs"]))
    m["xyz"] = ss.xyz(m["wape"].to_numpy(dtype=float), tuple(rcfg["xyz_wape_cutoffs"]))
    m["service_level"] = ss.service_level(m["abc"], m["xyz"], rcfg["service_levels"])
    bias = np.minimum(np.abs(m["bias"].fillna(0.3).to_numpy()), settings["forecast"]["bias_cap"])
    phi = m["dispersion"].fillna(1.0).to_numpy()
    rop, safety = ss.reorder_point(m["lead_time_demand"].to_numpy(), phi, bias, m["service_level"].to_numpy())
    m["reorder_point"] = rop
    m["safety_stock"] = safety
    m["target_stock"] = rop + m["cycle_demand"]

    qty, raw, reasons, flags = [], [], [], []
    for _, r in m.iterrows():
        f = []
        if not r["supplier_confirmed"]:
            f.append(f"{r['supplier']} lead time and MOQ not confirmed")
        if r["pack_default_used"]:
            f.append("pack of 6 is the default")
        if not (r["unit_cost"] and r["unit_cost"] > 0):
            f.append("unit cost missing")
        if not r["supplier_known"]:
            f.append("no supplier rule")
        if r["is_long_stockout"]:
            q, rq = 0, 0.0
            reason = (f"Not ordered: out of stock for {int(r['days_out_of_stock_now'])} days while active in Shopify. "
                      "Demand is no longer imputed. Confirm restock or archive the SKU")
        elif r["is_dead"]:
            q, rq = 0, 0.0
            reason = (f"Not ordered: dead stock, {int(r['sold_90'])} units sold in {settings['health']['dead_days']} days "
                      f"with {int(r['on_hand'])} on hand")
        else:
            q, rq = ss.order_quantity(r["position"], r["reorder_point"], r["target_stock"], r["pack_size"], r["moq"])
            sl = int(round(r["service_level"] * 100))
            base = (f"Position {r['position']:.0f} (on hand {r['on_hand']:.0f}, committed {r['committed']:.0f}, "
                    f"incoming {r['incoming']:.0f}) vs reorder point {r['reorder_point']:.0f}: lead time plus review "
                    f"{r['lead_time_days'] + review} days demand {r['lead_time_demand']:.1f} plus safety stock "
                    f"{r['safety_stock']:.1f} at {sl} percent service ({r['abc']}{r['xyz']}).")
            if q > 0:
                cover = q / r["daily_forecast_30"] if r["daily_forecast_30"] > 0 else float("inf")
                cover_txt = f"{cover:.0f} days" if np.isfinite(cover) else "no forecast demand"
                reason = (base + f" Order up to target {r['target_stock']:.0f} needs {rq:.1f}, rounded to {q} "
                          f"(pack {r['pack_size']}, MOQ {r['moq']}). Buys {cover_txt} of cover.")
            else:
                reason = base + " No order needed."
        qty.append(q)
        raw.append(rq)
        reasons.append(no_hyphen(reason))
        flags.append(no_hyphen("; ".join(f)))
    m["order_qty"] = qty
    m["order_qty_raw"] = raw
    m["reason"] = reasons
    m["flags"] = flags
    m["line_total"] = m["order_qty"] * m["unit_cost"].fillna(np.nan)
    with np.errstate(all="ignore"):
        m["days_cover_now"] = np.where(m["daily_forecast_30"] > 0, np.maximum(m["position"], 0) / m["daily_forecast_30"], np.inf)
        m["days_cover_after_order"] = np.where(
            m["daily_forecast_30"] > 0, (np.maximum(m["position"], 0) + m["order_qty"]) / m["daily_forecast_30"], np.inf
        )
    return m


def parse_filters(args: list[str]) -> dict:
    """['color', 'BLACK', 'supplier', 'BOBO'] becomes {'color': ['BLACK'], 'supplier': ['BOBO']}.
    Values may be comma separated lists."""
    if args and args[0].lower() == "filter":
        args = args[1:]
    if len(args) % 2:
        raise ValueError("Filters come in pairs, for example: po filter color BLACK supplier BOBO")
    out = {}
    for k, v in zip(args[0::2], args[1::2]):
        k = k.lower()
        if k not in FILTER_KEYS:
            raise ValueError(f"Unknown filter {k}. Use one of: {', '.join(sorted(FILTER_KEYS))}")
        out.setdefault(k, []).extend([x.strip() for x in v.split(",") if x.strip()])
    return out


def apply_filters(df: pd.DataFrame, filters: dict) -> pd.DataFrame:
    col_map = {"product": "product_title"}
    mask = pd.Series(True, index=df.index)
    for k, vals in filters.items():
        col = col_map.get(k, k)
        wanted = {v.lower() for v in vals}
        mask &= df[col].astype(str).str.lower().isin(wanted)
    return df[mask]


def po_tables(repl: pd.DataFrame) -> dict:
    lines = repl[repl["order_qty"] > 0].copy()
    lines = lines.sort_values(["supplier", "product_title", "color", "size"])
    cols = {
        "supplier": "Supplier", "sku": "SKU", "product_title": "Product", "color": "Color", "size": "Size",
        "collection": "Collection", "order_qty": "Quantity", "unit_cost": "Unit cost", "line_total": "Line total",
        "on_hand": "On hand", "committed": "Committed", "incoming": "Incoming", "reorder_point": "Reorder point",
        "safety_stock": "Safety stock", "target_stock": "Target stock", "days_cover_after_order": "Days cover after order",
        "abc": "ABC", "xyz": "XYZ", "confidence": "Confidence", "reason": "Reason", "flags": "Flags",
    }
    out = {}
    summary = (
        lines.groupby("supplier")
        .agg(SKUs=("sku", "count"), Units=("order_qty", "sum"), Total_cost=("line_total", "sum"),
             Lines_missing_cost=("unit_cost", lambda s: int((s.isna() | (s <= 0)).sum())))
        .reset_index()
        .rename(columns={"supplier": "Supplier", "Total_cost": "Total cost", "Lines_missing_cost": "Lines missing cost"})
    )
    out["Summary"] = summary
    for sup, g in lines.groupby("supplier"):
        out[str(sup)[:31]] = g[list(cols)].rename(columns=cols)
    dead = repl[repl["is_dead"] | repl["is_long_stockout"]]
    if len(dead):
        out["Not ordered"] = dead[["supplier", "sku", "product_title", "color", "size", "on_hand",
                                   "sold_90", "stock_value", "reason"]].rename(columns={
            "supplier": "Supplier", "sku": "SKU", "product_title": "Product", "color": "Color", "size": "Size",
            "on_hand": "On hand", "sold_90": "Sold 90 days", "stock_value": "Stock value", "reason": "Reason"})
    return out
