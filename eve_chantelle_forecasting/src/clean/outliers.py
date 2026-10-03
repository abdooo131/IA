"""Cap single day spikes above median plus k times scaled MAD, unless a promo or event explains them."""
from __future__ import annotations

import numpy as np


def robust_thresholds(obs: np.ndarray, valid: np.ndarray, exclude: np.ndarray, k: float, min_cap: float) -> np.ndarray:
    """Per variant cap threshold computed on valid, non promo days."""
    data = np.where(valid & ~exclude, obs, np.nan)
    with np.errstate(all="ignore"):
        med = np.nanmedian(data, axis=1)
        mad = np.nanmedian(np.abs(data - med[:, None]), axis=1)
        mean = np.nanmean(data, axis=1)
        std = np.nanstd(data, axis=1)
    med = np.nan_to_num(med, nan=0.0)
    mad = np.nan_to_num(mad, nan=0.0)
    # For intermittent SKUs the MAD is zero, which would cap ordinary selling days.
    # Mean plus k standard deviations is a floor for that case; one large spike barely moves it.
    floor = np.nan_to_num(mean + k * std, nan=0.0)
    return np.maximum(np.maximum(med + k * 1.4826 * mad, floor), min_cap)


def cap_outliers(obs: np.ndarray, valid: np.ndarray, promo: np.ndarray, k: float, min_cap: float):
    """Return capped matrix, boolean cap mask and the per variant threshold. Every cap is logged by the caller."""
    thr = robust_thresholds(obs, valid, promo, k, min_cap)
    over = valid & ~promo & (obs > thr[:, None])
    capped = np.where(over, np.floor(thr)[:, None] * np.ones_like(obs), obs)
    return capped, over, thr
