"""Hierarchy: bottom up sums from SKU to product, color, collection and total, with a top down check.

The top down check fits ETS on each group's own weekly history. Where it disagrees with the bottom up
sum by more than the configured share the group is flagged for review rather than silently adjusted.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
from statsforecast import StatsForecast
from statsforecast.models import AutoETS

LEVELS = {"product": "product_title", "color": "color", "collection": "collection", "total": None}


def _weekly_history(Y, valid, rows, weeks):
    T = Y.shape[1]
    n = min(weeks, T // 7)
    seg = np.where(valid[rows, T - 7 * n :], Y[rows, T - 7 * n :], 0).sum(axis=0)
    return seg.reshape(n, 7).sum(axis=1)


def check(data, F: np.ndarray, settings) -> pd.DataFrame:
    W = int(settings["forecast"]["horizon_weeks"])
    thr = float(settings["forecast"]["hierarchy_divergence_flag"])
    dv = data.dv
    active = dv["active"].to_numpy()
    Fw = F[:, : 7 * W].reshape(F.shape[0], W, 7).sum(axis=2)
    series, meta = [], []
    for level, col in LEVELS.items():
        keys = ["ALL"] if col is None else sorted(dv.loc[active, col].dropna().unique())
        for k in keys:
            rows = np.nonzero(active & ((dv[col] == k).to_numpy() if col else True))[0]
            if len(rows) == 0:
                continue
            hist = _weekly_history(data.Y, data.valid, rows, 104)
            uid = len(meta)
            meta.append({"level": level, "group": k, "skus": len(rows), "bottom_up_16w": float(Fw[rows].sum()),
                         "last_16w_actual": float(hist[-W:].sum())})
            series.append(pd.DataFrame({"unique_id": uid, "ds": np.arange(len(hist)), "y": hist}))
    if not series:
        return pd.DataFrame()
    df = pd.concat(series, ignore_index=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fc = StatsForecast(models=[AutoETS(season_length=1, alias="td")], freq=1, n_jobs=1).forecast(df=df, h=W)
    td = fc.groupby("unique_id")["td"].sum().clip(lower=0)
    out = pd.DataFrame(meta)
    out["top_down_16w"] = out.index.map(td).astype(float)
    with np.errstate(all="ignore"):
        out["divergence"] = (out["bottom_up_16w"] - out["top_down_16w"]) / out["top_down_16w"].where(out["top_down_16w"] > 0)
    out["flag"] = np.where(out["divergence"].abs() > thr, "review", "ok")
    return out
