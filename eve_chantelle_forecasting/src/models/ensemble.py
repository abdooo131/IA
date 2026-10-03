"""Ensemble: inverse WAPE weighted average of the best models for each demand class."""
from __future__ import annotations

import numpy as np

EXCLUDED = {"ensemble", "similarity"}


def class_weights(results: dict, classes: np.ndarray, candidates: dict, top_n: int) -> dict:
    """results[model] holds 'abs' and 'act' arrays shaped (folds, variants). Returns {class: {model: weight}}."""
    weights = {}
    for cls, models in candidates.items():
        rows = classes == cls
        if not rows.any():
            continue
        scores = []
        for m in models:
            if m in EXCLUDED or m not in results:
                continue
            a = results[m]["abs"][:, rows]
            act = results[m]["act"][:, rows]
            ok = ~np.isnan(a)
            if ok.sum() == 0:
                continue
            wape = np.nansum(a) / max(np.nansum(np.where(ok, act, 0)), 1.0)
            scores.append((wape, models.index(m), m))
        scores.sort()
        chosen = scores[:top_n]
        if len(chosen) < 2:
            continue
        inv = np.array([1.0 / max(w, 1e-6) for w, _, _ in chosen])
        inv = inv / inv.sum()
        weights[cls] = {m: float(w) for (_, _, m), w in zip(chosen, inv)}
    return weights


def combine(forecasts: dict, classes: np.ndarray, weights: dict, shape) -> np.ndarray:
    out = np.full(shape, np.nan)
    for cls, wmap in weights.items():
        rows = np.nonzero(classes == cls)[0]
        if len(rows) == 0:
            continue
        num = np.zeros((len(rows), shape[1]))
        den = np.zeros((len(rows), 1))
        for m, w in wmap.items():
            F = forecasts.get(m)
            if F is None:
                continue
            part = F[rows]
            ok = ~np.isnan(part[:, :1])
            num += np.where(ok, np.nan_to_num(part) * w, 0)
            den += np.where(ok, w, 0)
        res = np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
        out[rows] = res
    return out
