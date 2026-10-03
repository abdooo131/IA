"""ABC, XYZ, service levels, reorder point, safety stock and pack rounding."""
from __future__ import annotations

import math

import numpy as np

from src.evaluate.metrics import demand_variance, nb_quantile


def abc(revenue: np.ndarray, cutoffs=(0.8, 0.95)) -> np.ndarray:
    """A covers the first 80 percent of revenue, B the next 15, C the rest (including zero revenue)."""
    revenue = np.nan_to_num(np.asarray(revenue, dtype=float))
    order = np.argsort(-revenue, kind="stable")
    total = revenue.sum()
    out = np.full(len(revenue), "C", dtype=object)
    if total <= 0:
        return out
    cum_before = np.concatenate([[0.0], np.cumsum(revenue[order])[:-1]]) / total
    labels = np.where(cum_before < cutoffs[0], "A", np.where(cum_before < cutoffs[1], "B", "C"))
    labels[revenue[order] <= 0] = "C"
    out[order] = labels
    return out


def xyz(wape: np.ndarray, cutoffs=(0.4, 0.7)) -> np.ndarray:
    """Forecastability from the backtest WAPE. No backtest means Z."""
    w = np.asarray(wape, dtype=float)
    return np.where(np.isnan(w), "Z", np.where(w <= cutoffs[0], "X", np.where(w <= cutoffs[1], "Y", "Z")))


def service_level(abc_cls, xyz_cls, matrix: dict) -> np.ndarray:
    return np.array([float(matrix[a][x]) for a, x in zip(abc_cls, xyz_cls)])


def reorder_point(mean_ltd, dispersion, bias, sl):
    """Reorder point is the service level quantile of lead time demand; safety stock is the excess over the mean."""
    var = demand_variance(np.asarray(mean_ltd, float), np.asarray(dispersion, float), np.asarray(bias, float))
    rop = nb_quantile(mean_ltd, var, sl) if np.ndim(sl) == 0 else np.array(
        [nb_quantile(m, v, s) for m, v, s in zip(np.atleast_1d(mean_ltd), np.atleast_1d(var), np.atleast_1d(sl))]
    ).reshape(np.shape(mean_ltd))
    rop = np.maximum(rop, np.ceil(np.asarray(mean_ltd, float) - 1e-9))
    return rop, rop - np.asarray(mean_ltd, float)


def round_to_pack(qty: float, pack: int, moq: int) -> int:
    """Round up to whole packs and respect the MOQ (itself rounded up to whole packs)."""
    if qty <= 0:
        return 0
    pack = max(int(pack), 1)
    q = math.ceil(qty / pack - 1e-9) * pack
    moq_packs = math.ceil(max(int(moq), 0) / pack - 1e-9) * pack
    return int(max(q, moq_packs))


def order_quantity(position: float, rop: float, target: float, pack: int, moq: int) -> tuple[int, float]:
    """Order up to target when the position is at or below the reorder point. Returns (rounded, raw)."""
    if position > rop:
        return 0, 0.0
    raw = max(target - position, 0.0)
    return round_to_pack(raw, pack, moq), raw
