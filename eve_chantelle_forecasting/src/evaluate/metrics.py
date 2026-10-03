"""Accuracy metrics. Errors are measured on weekly buckets because decisions are weekly.

WAPE   sum of absolute weekly errors over sum of actuals (denominator floored at 1 unit)
bias   (sum of forecast minus sum of actual) over sum of actuals, positive means over forecasting
MASE   mean absolute weekly error over the in sample mean absolute week to week change
p90 hit rate   share of folds where actual lead time demand stayed at or below the p90 forecast
"""
from __future__ import annotations

import warnings

import numpy as np
from scipy import stats


def weekly(M: np.ndarray, n_weeks: int) -> np.ndarray:
    return M[:, : 7 * n_weeks].reshape(M.shape[0], n_weeks, 7).sum(axis=2)


def fold_errors(F: np.ndarray, A: np.ndarray, weeks_v: np.ndarray) -> dict:
    """F and A are (variants, days). weeks_v is the number of weeks each variant is judged on."""
    max_w = int(weeks_v.max())
    Fw, Aw = weekly(F, max_w), weekly(A, max_w)
    mask = np.arange(max_w)[None, :] < weeks_v[:, None]
    return {
        "abs": np.where(mask, np.abs(Fw - Aw), 0).sum(axis=1),
        "act": np.where(mask, Aw, 0).sum(axis=1),
        "fc": np.where(mask, Fw, 0).sum(axis=1),
        "weeks": weeks_v.astype(float),
    }


def naive_scale(Y: np.ndarray, valid: np.ndarray, origin: int, weeks: int = 52) -> np.ndarray:
    lo = max(origin + 1 - 7 * weeks, 0)
    n = (origin + 1 - lo) // 7
    if n < 2:
        return np.full(Y.shape[0], np.nan)
    seg = np.where(valid[:, origin + 1 - 7 * n : origin + 1], Y[:, origin + 1 - 7 * n : origin + 1], np.nan)
    w = seg.reshape(Y.shape[0], n, 7).sum(axis=2)
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return np.nanmean(np.abs(np.diff(w, axis=1)), axis=1)


def summarize(abs_err, act, fc, weeks, scale) -> dict:
    denom = np.maximum(act, 1.0)
    with np.errstate(all="ignore"):
        mase = np.where(scale > 0, (abs_err / np.maximum(weeks, 1)) / scale, np.nan)
    return {"wape": abs_err / denom, "bias": (fc - act) / denom, "mase": mase}


def nb_quantile(mean, var, q):
    """Negative binomial quantile with the given mean and variance, Poisson when variance is not above the mean."""
    mean = np.asarray(mean, dtype=float)
    var = np.asarray(var, dtype=float)
    out = np.zeros(np.broadcast(mean, var).shape)
    m = np.broadcast_to(mean, out.shape)
    vv = np.broadcast_to(var, out.shape)
    pos = m > 1e-9
    over = pos & (vv > m * 1.0001)
    with np.errstate(all="ignore"):
        r = np.where(over, m**2 / np.where(over, vv - m, 1), 1)
        p = np.where(over, r / (r + m), 0.5)
    out[over] = stats.nbinom.ppf(q, r[over], p[over])
    pois = pos & ~over
    out[pois] = stats.poisson.ppf(q, m[pois])
    return out


def demand_variance(mean, dispersion, bias):
    """Noise around the mean (dispersion times mean) plus systematic model error (bias times mean, squared)."""
    return dispersion * mean + (bias * mean) ** 2
