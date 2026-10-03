"""Stockout detection and censored demand reconstruction.

Detection sources, strongest first:
  snapshot       daily inventory snapshot shows zero or less available
  current_stock  the variant is out of stock now and has not sold since the run of zero days began
  inferred       before snapshots existed: a zero sales run that is very unlikely at the recent selling rate
                 while sibling variants of the same product kept selling

Adjustment: on stockout days demand is replaced by an estimate from the variant's recent in stock velocity,
blended with the product's share normalized velocity times the variant's size curve share. Only the first
max_impute_days of a run are filled; a SKU out of stock longer than that is flagged instead.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _zero_runs(row: np.ndarray, valid: np.ndarray):
    """Yield (start, end_inclusive) of runs of zero sales on valid days."""
    is_zero = (row == 0) & valid
    t = len(row)
    i = 0
    while i < t:
        if is_zero[i]:
            j = i
            while j + 1 < t and is_zero[j + 1]:
                j += 1
            yield i, j
            i = j + 1
        else:
            i += 1


def detect(
    obs: np.ndarray,
    valid: np.ndarray,
    avail: np.ndarray,
    current_avail: np.ndarray,
    product_idx: np.ndarray,
    cfg: dict,
) -> tuple[np.ndarray, np.ndarray]:
    """Return stockout mask and a source code matrix (0 none, 1 snapshot, 2 current_stock, 3 inferred).

    avail is the snapshot available matrix with NaN where no snapshot exists.
    """
    v_count, t_count = obs.shape
    ffill_days = int(cfg.get("snapshot_forward_fill_days", 7))
    av = pd.DataFrame(avail.T).ffill(limit=ffill_days).to_numpy().T
    filled_only = np.isnan(avail) & ~np.isnan(av)
    covered = ~np.isnan(av) & valid
    snap_out = covered & (av <= 0) & ~(filled_only & (obs > 0))
    source = np.where(snap_out, 1, 0)

    min_run = int(cfg.get("min_zero_run_days", 7))
    p_thr = float(cfg.get("zero_run_probability", 0.01))
    window = int(cfg.get("velocity_window_days", 56))

    # Product totals for the sibling check
    n_prod = int(product_idx.max()) + 1 if len(product_idx) else 0
    prod_sum = np.zeros((n_prod, t_count))
    np.add.at(prod_sum, product_idx, np.where(valid, obs, 0))
    prod_cum = np.concatenate([np.zeros((n_prod, 1)), np.cumsum(prod_sum, axis=1)], axis=1)
    own_cum = np.concatenate([np.zeros((v_count, 1)), np.cumsum(np.where(valid, obs, 0), axis=1)], axis=1)
    valid_cum = np.concatenate([np.zeros((v_count, 1)), np.cumsum(valid, axis=1)], axis=1)

    for v in range(v_count):
        row_valid = valid[v] & ~covered[v]
        if not row_valid.any():
            continue
        for s, e in _zero_runs(obs[v], row_valid):
            length = e - s + 1
            trailing = e == t_count - 1
            if trailing and current_avail[v] <= 0:
                source[v, s : e + 1] = np.where(source[v, s : e + 1] == 0, 2, source[v, s : e + 1])
                continue
            if length < min_run:
                continue
            w0 = max(0, s - window)
            days = valid_cum[v, s] - valid_cum[v, w0]
            if days < 14:
                continue
            rate = (own_cum[v, s] - own_cum[v, w0]) / days
            if rate <= 0 or np.exp(-rate * length) >= p_thr:
                continue
            p = product_idx[v]
            siblings = (prod_cum[p, e + 1] - prod_cum[p, s]) - (own_cum[v, e + 1] - own_cum[v, s])
            if siblings > 0:
                source[v, s : e + 1] = np.where(source[v, s : e + 1] == 0, 3, source[v, s : e + 1])
    stockout = (source > 0) & valid
    return stockout, np.where(valid, source, 0)


def size_shares(
    obs: np.ndarray, valid: np.ndarray, stockout: np.ndarray, product_idx: np.ndarray, window_days: int
) -> np.ndarray:
    """Share of each variant within its product, from in stock selling rates so stockouts do not bias it."""
    t = obs.shape[1]
    sl = slice(max(0, t - window_days), t)
    in_stock = valid[:, sl] & ~stockout[:, sl]
    days = in_stock.sum(axis=1)
    units = np.where(in_stock, obs[:, sl], 0).sum(axis=1)
    rate_recent = np.where(days >= 7, units / np.maximum(days, 1), np.nan)
    in_all = valid & ~stockout
    rate_all = np.where(in_all, obs, 0).sum(axis=1) / np.maximum(in_all.sum(axis=1), 1)
    rate = np.where(np.isnan(rate_recent), rate_all, rate_recent)
    n_prod = int(product_idx.max()) + 1 if len(product_idx) else 0
    tot = np.zeros(n_prod)
    np.add.at(tot, product_idx, rate)
    denom = tot[product_idx]
    counts = np.bincount(product_idx, minlength=n_prod)[product_idx]
    return np.where(denom > 0, rate / np.where(denom > 0, denom, 1), 1.0 / np.maximum(counts, 1))


def adjust(
    obs: np.ndarray,
    valid: np.ndarray,
    stockout: np.ndarray,
    product_idx: np.ndarray,
    shares: np.ndarray,
    cfg: dict,
) -> tuple[np.ndarray, np.ndarray]:
    """Return adjusted demand and the estimate used on stockout days."""
    window = int(cfg.get("velocity_window_days", 56))
    min_in = int(cfg.get("min_in_stock_days", 28))
    in_stock = valid & ~stockout

    own = pd.DataFrame(np.where(in_stock, obs, np.nan).T)
    own_vel = own.rolling(window, min_periods=7).mean().ffill().to_numpy().T
    n_in = own.notna().astype(float).rolling(window, min_periods=1).sum().to_numpy().T

    n_prod = int(product_idx.max()) + 1 if len(product_idx) else 0
    t = obs.shape[1]
    num = np.zeros((n_prod, t))
    den = np.zeros((n_prod, t))
    np.add.at(num, product_idx, np.where(in_stock, obs, 0))
    np.add.at(den, product_idx, np.where(in_stock, shares[:, None], 0))
    p_daily = np.where(den >= 0.05, num / np.where(den > 0, den, 1), np.nan)
    p_vel = pd.DataFrame(p_daily.T).rolling(window, min_periods=7).mean().ffill().to_numpy().T
    prod_est = p_vel[product_idx] * shares[:, None]

    w = np.clip(n_in / max(min_in, 1), 0, 1)
    est = np.where(
        np.isnan(own_vel),
        prod_est,
        np.where(np.isnan(prod_est), own_vel, w * own_vel + (1 - w) * prod_est),
    )
    est = np.nan_to_num(est, nan=0.0)
    # Only the first max_impute_days of a stockout run are filled. After that the SKU is treated as
    # not on sale, otherwise a long forgotten SKU would keep its old velocity forever.
    max_days = int(cfg.get("max_impute_days", 90))
    run = run_lengths(stockout)
    fill = stockout & (run <= max_days)
    adjusted = np.where(fill, np.maximum(obs, est), obs)
    return np.where(valid, adjusted, 0.0), est


def run_lengths(mask: np.ndarray) -> np.ndarray:
    """Day count within the current run of True values, 0 where False."""
    out = np.zeros(mask.shape, dtype=int)
    if mask.shape[1] == 0:
        return out
    out[:, 0] = mask[:, 0]
    for t in range(1, mask.shape[1]):
        out[:, t] = np.where(mask[:, t], out[:, t - 1] + 1, 0)
    return out
