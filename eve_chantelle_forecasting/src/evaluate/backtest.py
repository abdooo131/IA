"""Rolling origin backtest. Every model forecasts from the same origins; errors are kept per fold and variant."""
from __future__ import annotations

import numpy as np

from src.evaluate import metrics
from src.models import baselines, ml, similarity, statistical
from src.models.classify import BASELINES, CLASS_MODELS


def candidates_for(cls: str) -> list[str]:
    if cls == "new":
        return ["similarity", "velocity_30"]
    return CLASS_MODELS[cls] + ["product_share"] + BASELINES + ["ensemble"]


def run_models(data, origin: int, H: int, eligible: np.ndarray) -> dict:
    """Forecast every candidate model from one origin for the eligible variants."""
    s = data.settings
    out = {}
    rows = np.nonzero(eligible)[0]
    base = baselines.run(data.Y, data.valid, origin, H)
    for m, F in base.items():
        F = F.copy()
        F[~eligible] = np.nan
        out[m] = F
    n_jobs = int(s.get("forecast", "lightgbm", "num_threads", default=1))
    for cls, models in CLASS_MODELS.items():
        stat = [m for m in models if m in statistical.STAT_MODELS]
        cls_rows = rows[data.classes[rows] == cls]
        if not stat or len(cls_rows) == 0:
            continue
        res = statistical.run(data.Y, data.start_idx, cls_rows, origin, H, stat, n_jobs)
        for m, F in res.items():
            out.setdefault(m, np.full(data.Y.shape, np.nan)[:, :H])
            out[m][cls_rows] = F[cls_rows]
    ml_classes = [c for c, models in CLASS_MODELS.items() if "lightgbm" in models]
    ml_rows = rows[np.isin(data.classes[rows], ml_classes)]
    if len(ml_rows) and ml.available():
        out["lightgbm"] = ml.train_predict(data.ml_inputs, origin, H, ml_rows, s["forecast"]["lightgbm"])
    ps = statistical.product_share(
        data.Y, data.valid, data.start_idx, data.product_idx, origin, H,
        s.get("cleaning", "size_curve_window_days", default=180), n_jobs,
    )
    ps[~eligible] = np.nan
    ps[data.classes == "new"] = np.nan
    out["product_share"] = ps
    new_rows = rows[data.classes[rows] == "new"]
    if len(new_rows):
        out["similarity"] = similarity.forecast(
            data.Y, data.valid, data.start_idx, data.product_idx, data.statics, origin, new_rows, H,
            s["forecast"]["min_history_days"],
        )
    return out


def run_backtest(data, ctx) -> dict:
    """Return per model arrays shaped (folds, variants) for abs, act, fc, weeks, scale, plus fold forecasts."""
    s = data.settings["forecast"]
    T = data.Y.shape[1]
    n_folds = int(s["backtest_folds"])
    step = int(s["fold_step_days"])
    min_train = int(s["min_train_days"])
    weeks_v = np.ceil(data.eval_days / 7).astype(int)
    H_bt = int(7 * weeks_v.max())
    store = {}
    fold_fc = []
    fold_meta = []
    ever = np.zeros(data.Y.shape[0], dtype=bool)
    for k in range(n_folds):
        o = T - 1 - H_bt - k * step
        if o < min_train:
            ctx.warn(f"Fold {k + 1} skipped, not enough history before its origin.")
            continue
        eligible = (o - data.start_idx + 1 >= min_train) & (data.classes != "new")
        ever |= eligible
        fc = run_models(data, o, H_bt, eligible)
        A = np.where(data.valid[:, o + 1 : o + 1 + H_bt], data.Y[:, o + 1 : o + 1 + H_bt], 0)
        scale = metrics.naive_scale(data.Y, data.valid, o)
        fold_fc.append(fc)
        fold_meta.append({"origin": o, "H": H_bt, "A": A, "eligible": eligible})
        n_prev = len(fold_meta) - 1
        for m, F in fc.items():
            ok = ~np.isnan(F[:, 0])
            err = metrics.fold_errors(np.nan_to_num(F), A, weeks_v)
            if m not in store:
                store[m] = {key: [np.full(data.Y.shape[0], np.nan)] * n_prev for key in ("abs", "act", "fc", "weeks", "scale")}
            d = store[m]
            for key in ("abs", "act", "fc", "weeks"):
                d[key].append(np.where(ok, err[key], np.nan))
            d["scale"].append(np.where(ok, scale, np.nan))
        for d in store.values():
            for key in d:
                while len(d[key]) < len(fold_meta):
                    d[key].append(np.full(data.Y.shape[0], np.nan))
        ctx.info(f"Backtest fold {k + 1} of {n_folds} done, origin {data.dates[o]}, {int(eligible.sum())} SKUs", echo=False)

    # Short fold for SKUs too young for any standard fold: origin half way through their life.
    # New SKUs are judged on the similarity model, the others on the velocity baselines.
    short = {}
    young = np.nonzero(~ever)[0]
    ages = T - data.start_idx[young]
    for r, age in zip(young, ages):
        if age < 14 + 7:
            continue
        o = data.start_idx[r] + max(14, age // 2) - 1
        short.setdefault(o, []).append(r)
    keys = ("abs", "act", "fc", "weeks", "scale")
    V = data.Y.shape[0]

    def pad(n):
        for d in store.values():
            for key in keys:
                while len(d[key]) < n:
                    d[key].append(np.full(V, np.nan))

    n_rows = len(fold_meta)
    for o, rows in sorted(short.items()):
        rows = np.array(rows)
        H = 7 * ((T - 1 - o) // 7)
        if H < 7:
            continue
        sim = similarity.forecast(data.Y, data.valid, data.start_idx, data.product_idx, data.statics, o, rows, H,
                                  s["min_history_days"])
        models = {"similarity": sim, **baselines.run(data.Y, data.valid, o, H)}
        is_new = data.classes[rows] == "new"
        A = np.where(data.valid[:, o + 1 : o + 1 + H], data.Y[:, o + 1 : o + 1 + H], 0)
        scale = metrics.naive_scale(data.Y, data.valid, o)
        for m in models:
            store.setdefault(m, {key: [] for key in keys})
        pad(n_rows)
        for m, F in models.items():
            # New SKUs are judged on similarity and velocity_30, older young SKUs on the baselines
            ok = is_new if m in ("similarity", "velocity_30") else ~is_new
            if m == "velocity_30":
                ok = np.ones(len(rows), dtype=bool)
            ok &= ~np.isnan(F[rows, 0])
            err = metrics.fold_errors(np.nan_to_num(F[rows]), A[rows], np.full(len(rows), H // 7))
            row = {key: np.full(V, np.nan) for key in keys}
            for key in ("abs", "act", "fc", "weeks"):
                row[key][rows] = np.where(ok, err[key], np.nan)
            row["scale"][rows] = np.where(ok, scale[rows], np.nan)
            for key in keys:
                store[m][key].append(row[key])
        n_rows += 1
        pad(n_rows)
    pad(n_rows)
    for d in store.values():
        for key in keys:
            d[key] = np.vstack(d[key]) if d[key] else np.full((0, V), np.nan)
    return {"results": store, "fold_fc": fold_fc, "fold_meta": fold_meta, "H_bt": H_bt, "weeks_v": weeks_v,
            "n_standard_folds": len(fold_meta)}
