"""Benchmarks: seasonal naive and trailing 7, 30 and 90 day velocity (the Stock Agent method)."""
from __future__ import annotations

import numpy as np


def velocity(Y: np.ndarray, valid: np.ndarray, origin: int, window: int, H: int) -> np.ndarray:
    s = max(0, origin - window + 1)
    sl = slice(s, origin + 1)
    days = valid[:, sl].sum(axis=1)
    rate = np.where(days > 0, np.where(valid[:, sl], Y[:, sl], 0).sum(axis=1) / np.maximum(days, 1), 0.0)
    return np.repeat(rate[:, None], H, axis=1)


def seasonal_naive(Y: np.ndarray, valid: np.ndarray, origin: int, H: int, season: int = 7) -> np.ndarray:
    s = max(0, origin - season + 1)
    last = np.where(valid[:, s : origin + 1], Y[:, s : origin + 1], 0.0)
    if last.shape[1] < season:
        last = np.pad(last, ((0, 0), (season - last.shape[1], 0)))
    reps = int(np.ceil(H / season))
    return np.tile(last, (1, reps))[:, :H]


def run(Y, valid, origin, H) -> dict[str, np.ndarray]:
    return {
        "seasonal_naive": seasonal_naive(Y, valid, origin, H),
        "velocity_7": velocity(Y, valid, origin, 7, H),
        "velocity_30": velocity(Y, valid, origin, 30, H),
        "velocity_90": velocity(Y, valid, origin, 90, H),
    }
