"""Syntetos Boylan demand classification on the stockout adjusted daily series."""
from __future__ import annotations

import numpy as np

# SRD mapping, plus the global LightGBM for intermittent and lumpy SKUs: in the backtest it won about
# a third of those SKUs and lowered holdout WAPE. Override with forecast.class_models in settings.yaml.
CLASS_MODELS = {
    "smooth": ["ets", "lightgbm"],
    "erratic": ["lightgbm", "ets_damped"],
    "intermittent": ["croston", "sba", "tsb", "lightgbm"],
    "lumpy": ["tsb", "adida", "imapa", "lightgbm"],
    "new": ["similarity"],
}


def configure(settings) -> None:
    """Apply forecast.class_models from settings, if present, so the mapping is a config decision."""
    custom = settings.get("forecast", "class_models")
    if custom:
        for cls, models in custom.items():
            CLASS_MODELS[cls] = list(models)
BASELINES = ["seasonal_naive", "velocity_7", "velocity_30", "velocity_90"]
# Fixed priority order, used to break ties so the same data always picks the same model
MODEL_ORDER = [
    "ensemble", "lightgbm", "ets", "ets_damped", "tsb", "sba", "croston", "adida", "imapa", "product_share",
    "similarity", "velocity_30", "velocity_90", "velocity_7", "seasonal_naive",
]


def classify(Y: np.ndarray, start_idx: np.ndarray, origin: int, settings) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return class labels, ADI, CV squared and history length in days, measured at origin over the last 365 days."""
    fc = settings["forecast"]
    adi_cut, cv2_cut = fc["sb_adi_cutoff"], fc["sb_cv2_cutoff"]
    min_hist = fc["min_history_days"]
    v = Y.shape[0]
    labels = np.empty(v, dtype=object)
    adi = np.full(v, np.nan)
    cv2 = np.full(v, np.nan)
    hist = np.maximum(origin - start_idx + 1, 0)
    for i in range(v):
        if hist[i] < min_hist:
            labels[i] = "new"
            continue
        s = max(start_idx[i], origin - 364)
        y = Y[i, s : origin + 1]
        nz = y[y > 0]
        if len(nz) == 0:
            adi[i], cv2[i] = np.inf, 0.0
            labels[i] = "lumpy"
            continue
        # Fractional adjusted values below a tenth of a unit are treated as no demand
        nz = y[y >= 0.1]
        if len(nz) == 0:
            nz = y[y > 0]
        adi[i] = len(y) / len(nz)
        cv2[i] = (nz.std() / nz.mean()) ** 2 if nz.mean() > 0 else 0.0
        if adi[i] < adi_cut:
            labels[i] = "smooth" if cv2[i] < cv2_cut else "erratic"
        else:
            labels[i] = "intermittent" if cv2[i] < cv2_cut else "lumpy"
    return labels, adi, cv2, hist
