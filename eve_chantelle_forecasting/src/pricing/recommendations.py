"""Markdown and markup recommendations with the why: what changed, what happened last time, what is expected."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

from src.common import no_hyphen


def _last_episode(episodes: pd.DataFrame, pid, collection_pids) -> str:
    if episodes.empty:
        return "No past markdown found to compare with."
    own = episodes[episodes["product_id"] == pid].sort_values("start")
    scope = "this product"
    if own.empty:
        own = episodes[episodes["product_id"].isin(collection_pids)].sort_values("start")
        scope = "this collection"
    if own.empty:
        return "No past markdown found to compare with."
    e = own.iloc[-1]
    lift = f"{e['lift']:.1f}x" if e["lift"] and not math.isnan(e["lift"]) else "not measurable"
    return (f"Last markdown on {scope}: {e['depth'] * 100:.0f} percent for {int(e['days'])} days from "
            f"{e['start']:%Y %m %d}, sales went from {e['units_per_day_before']:.2f} to "
            f"{e['units_per_day_during']:.2f} units per day (lift {lift}).")


def markdowns(health: dict, elasticity: pd.DataFrame, episodes: pd.DataFrame, settings) -> pd.DataFrame:
    p = settings["pricing"]
    ladder = sorted(p["markdown_ladder"])
    max_md = p["max_markdown_pct"] / 100
    days = p["clearance_days"]
    r = health["repl"]
    over_ids = set(health["over"]["variant_id"])
    cand = r[r["is_dead"] | r["is_slow"] | r["variant_id"].isin(over_ids)].copy()
    el = elasticity.set_index("product_id") if len(elasticity) else pd.DataFrame()
    coll_pids = r.groupby("collection")["product_id"].apply(set).to_dict()
    rows = []
    for _, x in cand.iterrows():
        e_row = el.loc[x["product_id"]] if x["product_id"] in el.index else None
        e = float(e_row["elasticity"]) if e_row is not None else p["default_elasticity"]
        e_conf = e_row["confidence"] if e_row is not None else "low"
        v0 = max(float(x["daily_forecast_30"]), float(x["sold_90"]) / 90.0, 0.01)
        stock = max(float(x["on_hand"]) - float(x["committed"]), 0)
        if stock <= 0:
            continue
        healthy = 45 * v0
        excess = max(stock - healthy, stock if x["is_dead"] else 0)
        v_needed = v0 + excess / days
        lift_needed = v_needed / v0
        ratio_needed = lift_needed ** (1 / e)
        md_needed = 1 - ratio_needed
        price = float(x["price"] or 0)
        cost = float(x["unit_cost"]) if x["unit_cost"] and x["unit_cost"] > 0 else None
        floor_md = 1 - cost * (1 + p["min_margin"]) / price if cost and price > 0 else max_md
        cap = max(0.0, min(max_md, floor_md))
        allowed = [l / 100 for l in ladder if l / 100 <= cap + 1e-9]
        if not allowed:
            continue
        pick = next((m for m in allowed if m >= md_needed - 1e-9), allowed[-1])
        v_new = v0 * (1 - pick) ** e
        st_now = min(1.0, v0 * days / stock)
        st_new = min(1.0, v_new * days / stock)
        why = "dead stock" if x["is_dead"] else "overstock" if x["variant_id"] in over_ids else "slow stock"
        limit = ""
        if pick < md_needed:
            limit = (f" Full clearance would need about {md_needed * 100:.0f} percent, capped by "
                     f"{'the margin floor' if cap < max_md else 'the maximum markdown'}.")
        reason = (
            f"What changed: {why}, {int(stock)} units on the shelf, selling {v0:.2f} per day, "
            f"{x['days_cover_position']:.0f} days of cover." if np.isfinite(x["days_cover_position"]) else
            f"What changed: {why}, {int(stock)} units on the shelf and no expected demand."
        )
        reason += " " + _last_episode(episodes, x["product_id"], coll_pids.get(x["collection"], set()))
        reason += (f" Expected now: {pick * 100:.0f} percent off with elasticity {e:.2f} ({e_conf} confidence) lifts "
                   f"sales to about {v_new:.2f} per day, sell through in {days} days from {st_now:.0%} to {st_new:.0%}.{limit}")
        rows.append({
            "variant_id": x["variant_id"], "sku": x["sku"], "product_id": x["product_id"], "product_title": x["product_title"],
            "color": x["color"], "size": x["size"], "collection": x["collection"], "status": why,
            "on_hand": x["on_hand"], "stock_value": x["stock_value"], "price": price, "unit_cost": cost,
            "markdown_pct": pick * 100, "new_price": round(price * (1 - pick), 2), "elasticity": e,
            "elasticity_confidence": e_conf, "velocity_now": v0, "velocity_expected": v_new,
            "sell_through_now": st_now, "sell_through_expected": st_new,
            "confidence": "low" if e_conf == "low" or x.get("confidence") == "low" else "medium",
            "reason": no_hyphen(reason.replace("%", " percent")),
        })
    out = pd.DataFrame(rows)
    return out.sort_values("stock_value", ascending=False) if len(out) else out


def markups(health: dict, elasticity: pd.DataFrame, settings) -> pd.DataFrame:
    p = settings["pricing"]
    r = health["repl"]
    type_med = r.groupby("product_type")["daily_forecast_30"].transform("median")
    strong = r["abc"].isin(["A", "B"]) | (r["daily_forecast_30"] > type_med)
    repeated = (r["stockout_share_90"] >= p["markup_min_stockout_share"]) & (r["stockout_episodes_90"] >= p["markup_min_episodes"])
    cand = r[strong & repeated & ~r["is_dead"] & (r["daily_forecast_30"] > 0) & (r["position"] < r["target_stock"])].copy()
    el = elasticity.set_index("product_id") if len(elasticity) else pd.DataFrame()
    steps = sorted(p["markup_steps"])
    rows = []
    for _, x in cand.iterrows():
        e_row = el.loc[x["product_id"]] if x["product_id"] in el.index else None
        e = float(e_row["elasticity"]) if e_row is not None else p["default_elasticity"]
        e_conf = e_row["confidence"] if e_row is not None else "low"
        mu = steps[-1] if abs(e) < 1 else steps[0]
        vol = (1 + mu / 100) ** e - 1
        revenue = (1 + mu / 100) ** (1 + e) - 1
        price = float(x["price"] or 0)
        reason = (
            f"What changed: out of stock {x['stockout_share_90']:.0%} of the last 90 days in {int(x['stockout_episodes_90'])} "
            f"episodes while demand stays strong ({x['abc']} item, {x['daily_forecast_30']:.2f} units per day forecast). "
            f"Expected now: plus {mu} percent with elasticity {e:.2f} ({e_conf} confidence) changes volume by about "
            f"{vol:.0%} and revenue by {revenue:.0%}, which also stretches scarce stock until the next delivery."
        )
        rows.append({
            "variant_id": x["variant_id"], "sku": x["sku"], "product_id": x["product_id"], "product_title": x["product_title"],
            "color": x["color"], "size": x["size"], "collection": x["collection"], "price": price,
            "markup_pct": mu, "new_price": round(price * (1 + mu / 100), 2), "stockout_share_90": x["stockout_share_90"],
            "stockout_episodes_90": x["stockout_episodes_90"], "abc": x["abc"], "elasticity": e,
            "expected_volume_change": vol, "expected_revenue_change": revenue,
            "confidence": "medium" if e_conf in ("high", "medium") else "low",
            "reason": no_hyphen(reason.replace("%", " percent")),
        })
    out = pd.DataFrame(rows)
    return out.sort_values("stockout_share_90", ascending=False) if len(out) else out
