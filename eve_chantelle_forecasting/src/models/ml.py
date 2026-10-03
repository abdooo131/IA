"""Global LightGBM model across all SKUs.

Direct weekly model: one row per (variant, origin, weeks ahead). Features are known at the origin
(rolling demand, same week last year, stockout and promo share, attributes, price position) plus
calendar features of the target week (events, payday, week of year). Weekly predictions are split
into days with the product type day of week profile.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from src.features.calendar import EVENT_TYPES

WEEKS = 16

# LightGBM needs the OpenMP library (libomp). On a Mac without it the import fails; the system then
# runs every other model and says so, instead of stopping.
try:
    import lightgbm as lgb

    IMPORT_ERROR = None
except Exception as exc:  # OSError when libomp is missing, ImportError when the package is missing
    lgb = None
    IMPORT_ERROR = str(exc).splitlines()[0]


def available() -> bool:
    return lgb is not None


class Inputs:
    """Matrices and static attributes the model needs, built once per forecast run."""

    def __init__(self, Y, valid, start_idx, stockout, promo, depth, statics: pd.DataFrame, product_idx, calendar: pd.DataFrame):
        self.Y = Y
        self.valid = valid
        self.start_idx = start_idx
        self.product_idx = product_idx
        self.cal = calendar  # covers history plus the forecast horizon, row index equals day index
        v, t = Y.shape
        z = np.zeros((v, 1))
        self.C = np.concatenate([z, np.cumsum(np.where(valid, Y, 0), axis=1)], axis=1)
        self.CV = np.concatenate([z, np.cumsum(valid, axis=1)], axis=1)
        self.CNZ = np.concatenate([z, np.cumsum(valid & (Y >= 0.5), axis=1)], axis=1)
        self.CS = np.concatenate([z, np.cumsum(stockout & valid, axis=1)], axis=1)
        self.CP = np.concatenate([z, np.cumsum(promo & valid, axis=1)], axis=1)
        self.CD = np.concatenate([z, np.cumsum(np.where(valid, depth, 0), axis=1)], axis=1)
        nz_days = np.where(valid & (Y >= 0.5), np.arange(t)[None, :], -1)
        self.last_sale = np.maximum.accumulate(nz_days, axis=1)
        n_prod = int(product_idx.max()) + 1
        P = np.zeros((n_prod, t))
        np.add.at(P, product_idx, np.where(valid, Y, 0))
        self.CPR = np.concatenate([np.zeros((n_prod, 1)), np.cumsum(P, axis=1)], axis=1)
        self.statics = statics.reset_index(drop=True)
        ev_cols = [f"ev_{e}" for e in EVENT_TYPES] + ["payday", "event_promo"]
        E = calendar[ev_cols].to_numpy(dtype=float)
        self.ev_cols = ev_cols
        self.CE = np.concatenate([np.zeros((1, E.shape[1])), np.cumsum(E, axis=0)], axis=0)
        self.woy = calendar["week_of_year"].to_numpy()
        self.month = calendar["month"].to_numpy()

    def window_mean(self, cum, o, n):
        """Mean over the n days ending at o (inclusive), counting valid days only."""
        lo = max(o + 1 - n, 0)
        days = self.CV[:, o + 1] - self.CV[:, lo]
        with np.errstate(all="ignore"):
            return np.where(days > 0, (cum[:, o + 1] - cum[:, lo]) / days, np.nan)

    def features_at(self, o: int, rows: np.ndarray | None = None) -> pd.DataFrame:
        v = self.Y.shape[0]
        rows = np.arange(v) if rows is None else rows
        base = {
            "r7": self.window_mean(self.C, o, 7),
            "r28": self.window_mean(self.C, o, 28),
            "r91": self.window_mean(self.C, o, 91),
            "r182": self.window_mean(self.C, o, 182),
            "r364": self.window_mean(self.C, o, 364),
            "nz28": self.window_mean(self.CNZ, o, 28),
            "nz91": self.window_mean(self.CNZ, o, 91),
            "so28": self.window_mean(self.CS, o, 28),
            "promo28": self.window_mean(self.CP, o, 28),
            "depth28": self.window_mean(self.CD, o, 28),
            "age": np.clip(o - self.start_idx + 1, 0, 730).astype(float),
            "since_sale": np.where(self.last_sale[:, o] >= 0, np.clip(o - self.last_sale[:, o], 0, 365), 365).astype(float),
        }
        lo = max(o + 1 - 28, 0)
        prod28 = (self.CPR[:, o + 1] - self.CPR[:, lo]) / (o + 1 - lo)
        base["prod_r28"] = prod28[self.product_idx]
        with np.errstate(all="ignore"):
            base["share28"] = np.where(base["prod_r28"] > 0, base["r28"] / base["prod_r28"], np.nan)
        df = pd.DataFrame(base).iloc[rows].reset_index(drop=True)
        st = self.statics.iloc[rows].reset_index(drop=True)
        return pd.concat([df, st], axis=1)

    def target_week_features(self, o: int, h: int) -> dict:
        a, b = o + 7 * (h - 1) + 1, o + 7 * h  # inclusive day range
        feats = {"h": h, "woy": int(self.woy[min(a, len(self.woy) - 1)]), "month": int(self.month[min(a, len(self.month) - 1)])}
        sums = self.CE[min(b + 1, len(self.CE) - 1)] - self.CE[min(a, len(self.CE) - 1)]
        for c, s in zip(self.ev_cols, sums):
            feats[f"wk_{c}"] = float(s)
        return feats

    def last_year_week(self, o: int, h: int) -> np.ndarray:
        a, b = o + 7 * (h - 1) + 1 - 364, o + 7 * h - 364
        if a < 0:
            return np.full(self.Y.shape[0], np.nan)
        days = self.CV[:, b + 1] - self.CV[:, a]
        with np.errstate(all="ignore"):
            return np.where(days >= 7, self.C[:, b + 1] - self.C[:, a], np.nan)

    def block(self, o: int, rows: np.ndarray, with_target: bool, cutoff: int | None = None) -> pd.DataFrame:
        f = self.features_at(o, rows)
        parts = []
        for h in range(1, WEEKS + 1):
            b = o + 7 * h
            if with_target and b > cutoff:
                break
            part = f.copy()
            for k, val in self.target_week_features(o, h).items():
                part[k] = val
            part["ly_week"] = self.last_year_week(o, h)[rows]
            if with_target:
                a = o + 7 * (h - 1) + 1
                part["target"] = self.C[rows, b + 1] - self.C[rows, a]
                part["target_ok"] = self.start_idx[rows] <= a
            part["row"] = rows
            parts.append(part)
        return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()


def _params(cfg: dict) -> dict:
    return {
        "objective": "tweedie",
        "tweedie_variance_power": cfg.get("tweedie_variance_power", 1.2),
        "learning_rate": cfg.get("learning_rate", 0.05),
        "num_leaves": cfg.get("num_leaves", 31),
        "min_child_samples": cfg.get("min_child_samples", 20),
        "feature_fraction": 0.9,
        "bagging_fraction": 0.9,
        "bagging_freq": 1,
        "seed": cfg.get("seed", 42),
        "deterministic": True,
        "force_row_wise": True,
        "num_threads": cfg.get("num_threads", 4),
        "verbose": -1,
    }


def dow_profile(Y, valid, statics: pd.DataFrame, origin: int, cal: pd.DataFrame) -> np.ndarray:
    """Day of week share per variant from its product type over the last 365 days."""
    s = max(0, origin - 364)
    dows = cal["dow"].to_numpy()[s : origin + 1]
    vals = np.where(valid[:, s : origin + 1], Y[:, s : origin + 1], 0)
    groups = statics["product_type_code"].to_numpy()
    prof = np.zeros((Y.shape[0], 7))
    global_prof = np.array([vals[:, dows == d].sum() for d in range(7)])
    global_prof = global_prof / global_prof.sum() if global_prof.sum() > 0 else np.full(7, 1 / 7)
    for g in np.unique(groups):
        m = groups == g
        p = np.array([vals[m][:, dows == d].sum() for d in range(7)])
        prof[m] = p / p.sum() if p.sum() > 20 else global_prof
    return prof


def train_predict(inp: Inputs, origin: int, H: int, rows_predict: np.ndarray, cfg: dict) -> np.ndarray:
    """Train on targets fully observed by origin, forecast H days after origin for rows_predict."""
    step = int(cfg.get("origin_step_days", 14))
    n_weeks = int(cfg.get("training_weeks", 104))
    first = max(origin - 7 * n_weeks, 0)
    v = inp.Y.shape[0]
    blocks = []
    o = origin - 7
    while o >= first:
        rows = np.arange(v)[inp.start_idx <= o - 13]
        if len(rows):
            b = inp.block(o, rows, with_target=True, cutoff=origin)
            if len(b):
                blocks.append(b[b["target_ok"]])
        o -= step
    out = np.full((v, H), np.nan)
    if not blocks:
        return out
    train = pd.concat(blocks, ignore_index=True)
    feat_cols = [c for c in train.columns if c not in ("target", "target_ok", "row")]
    cat_cols = [c for c in feat_cols if c.endswith("_code")]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        ds = lgb.Dataset(train[feat_cols], label=train["target"], categorical_feature=cat_cols, free_raw_data=True)
        model = lgb.train(_params(cfg), ds, num_boost_round=int(cfg.get("n_estimators", 300)))
    rows_predict = np.asarray(rows_predict)
    pred_block = inp.block(origin, rows_predict, with_target=False)
    weekly = np.clip(model.predict(pred_block[feat_cols]), 0, None).reshape(WEEKS, len(rows_predict)).T
    prof = dow_profile(inp.Y, inp.valid, inp.statics, origin, inp.cal)[rows_predict]
    dows = inp.cal["dow"].to_numpy()[origin + 1 : origin + 1 + 7 * WEEKS]
    daily = np.repeat(weekly, 7, axis=1) * prof[:, dows]
    out[rows_predict] = daily[:, :H]
    return out
