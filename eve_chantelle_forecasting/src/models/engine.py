"""Forecast engine: classification, backtest, ensemble, model selection, quantiles, confidence, hierarchy."""
from __future__ import annotations

import datetime as dt
from types import SimpleNamespace

import numpy as np
import pandas as pd

from src import db
from src.evaluate import metrics
from src.evaluate.backtest import candidates_for, run_backtest, run_models
from src.features.calendar import build_calendar
from src.models import ensemble, ml
from src.models.classify import CLASS_MODELS, MODEL_ORDER, classify, configure


def load_data(con, settings, as_of: dt.date) -> SimpleNamespace:
    dem = con.execute(
        "SELECT date, variant_id, adjusted_demand, stockout_flag, promo_flag FROM fact_demand_daily"
    ).df()
    dem["date"] = pd.to_datetime(dem["date"]).dt.date
    dv = con.execute("SELECT * FROM dim_variant").df()
    recent_cut = as_of - dt.timedelta(days=365)
    sold_recent = set(dem.loc[(dem["date"] > recent_cut) & (dem["adjusted_demand"] > 0), "variant_id"])
    keep = set(dv.loc[dv["active"], "variant_id"]) | sold_recent
    dem = dem[dem["variant_id"].isin(keep)]
    dv = dv[dv["variant_id"].isin(set(dem["variant_id"]))].sort_values(["product_id", "variant_id"]).reset_index(drop=True)

    dates = pd.date_range(dem["date"].min(), as_of, freq="D").date
    d_index = {d: i for i, d in enumerate(dates)}
    v_index = {v: i for i, v in enumerate(dv["variant_id"])}
    V, T = len(dv), len(dates)
    Y = np.zeros((V, T))
    valid = np.zeros((V, T), dtype=bool)
    stockout = np.zeros((V, T), dtype=bool)
    promo = np.zeros((V, T), dtype=bool)
    vi = dem["variant_id"].map(v_index).to_numpy()
    ti = dem["date"].map(d_index).to_numpy()
    Y[vi, ti] = dem["adjusted_demand"].to_numpy()
    valid[vi, ti] = True
    stockout[vi, ti] = dem["stockout_flag"].to_numpy()
    promo[vi, ti] = dem["promo_flag"].to_numpy()
    start_idx = np.where(valid.any(axis=1), valid.argmax(axis=1), T)

    sales = con.execute(
        "SELECT date, variant_id, sum(revenue_gross) r, sum(list_value) l FROM fact_sales_daily GROUP BY 1, 2"
    ).df()
    sales["date"] = pd.to_datetime(sales["date"]).dt.date
    sales = sales[sales["variant_id"].isin(v_index) & sales["date"].isin(d_index)]
    depth = np.zeros((V, T))
    with np.errstate(all="ignore"):
        dvals = np.where(sales["l"] > 0, 1 - sales["r"] / sales["l"], 0)
    depth[sales["variant_id"].map(v_index).to_numpy(), sales["date"].map(d_index).to_numpy()] = dvals

    product_idx, _ = pd.factorize(dv["product_id"], sort=True)
    statics = pd.DataFrame(index=range(V))
    for col in ("product_type", "collection", "color", "size", "supplier", "price_band"):
        statics[f"{col}_code"] = pd.factorize(dv[col].fillna("NA"), sort=True)[0]
    med = dv.groupby("product_type")["regular_price"].transform("median")
    statics["price_rel"] = (dv["regular_price"] / med.replace(0, np.nan)).fillna(1.0).to_numpy()

    review = int(settings["replenishment"]["review_period_days"])
    eval_days = np.clip(dv["lead_time_days"].to_numpy() + review, 7, settings["forecast"]["horizon_weeks"] * 7)
    return SimpleNamespace(
        settings=settings, dv=dv, dates=dates, Y=Y, valid=valid, stockout=stockout, promo=promo, depth=depth,
        start_idx=start_idx, product_idx=product_idx, statics=statics, eval_days=eval_days, as_of=as_of,
    )


def dispersion(Y, valid, origin, cap) -> np.ndarray:
    n = min(52, (origin + 1) // 7)
    seg = np.where(valid[:, origin + 1 - 7 * n : origin + 1], Y[:, origin + 1 - 7 * n : origin + 1], np.nan)
    w = seg.reshape(Y.shape[0], n, 7)
    full = ~np.isnan(w).any(axis=2)
    ws = np.where(full, np.nansum(w, axis=2), np.nan)
    with np.errstate(all="ignore"):
        m = np.nanmean(ws, axis=1)
        v = np.nanvar(ws, axis=1)
        phi = np.where(m > 0, v / m, 1.0)
    return np.clip(np.nan_to_num(phi, nan=1.0), 1.0, cap)


def _agg(res: dict, m: str, v: int, folds) -> tuple | None:
    a = res[m]["abs"][folds, v]
    ok = ~np.isnan(a)
    if ok.sum() == 0:
        return None
    act = res[m]["act"][folds, v][ok].sum()
    fc = res[m]["fc"][folds, v][ok].sum()
    absv = a[ok].sum()
    weeks = res[m]["weeks"][folds, v][ok].sum()
    scale = np.nanmean(res[m]["scale"][folds, v][ok]) if np.any(~np.isnan(res[m]["scale"][folds, v][ok])) else np.nan
    denom = max(act, 1.0)
    mase = (absv / max(weeks, 1)) / scale if scale and scale > 0 else np.nan
    return absv / denom, (fc - act) / denom, mase, int(ok.sum()), absv, act


def select(res: dict, classes: np.ndarray, folds) -> list:
    out = []
    for v in range(len(classes)):
        best = None
        for m in candidates_for(classes[v]):
            if m not in res:
                continue
            r = _agg(res, m, v, folds)
            if r is None:
                continue
            key = (round(r[0], 6), round(abs(r[1]), 6), MODEL_ORDER.index(m))
            if best is None or key < best[0]:
                best = (key, m, r)
        out.append(best)
    return out


def confidence(hist, wape, cls, cfg) -> tuple[str, str]:
    pts = 0
    pts += 2 if hist >= cfg["history_days_high"] else 1 if hist >= cfg["history_days_medium"] else 0
    if wape is None or np.isnan(wape):
        w_txt = "no backtest yet"
    else:
        pts += 2 if wape <= cfg["wape_high"] else 1 if wape <= cfg["wape_medium"] else 0
        w_txt = f"backtest WAPE {wape:.2f}"
    pts += {"smooth": 2, "erratic": 1, "intermittent": 1}.get(cls, 0)
    level = "high" if pts >= 5 else "medium" if pts >= 3 else "low"
    return level, f"{hist} days of history, {w_txt}, {cls} demand"


def run_forecast(con, settings, ctx, as_of: dt.date) -> dict:
    fcfg = settings["forecast"]
    configure(settings)
    data = load_data(con, settings, as_of)
    V, T = data.Y.shape
    H_final = int(fcfg["horizon_weeks"]) * 7
    ctx.plan(
        f"forecast {int(data.dv['active'].sum())} active SKUs ({V} modeled), history {data.dates[0]:%Y %m %d} to "
        f"{as_of:%Y %m %d}, horizon {fcfg['horizon_weeks']} weeks, {fcfg['backtest_folds']} backtest folds. "
        "Output demand_forecast and accuracy_report."
    )

    classes, adi, cv2, hist = classify(data.Y, data.start_idx, T - 1, settings)
    data.classes = classes
    data.statics["class_code"] = pd.Series(classes).map(
        {c: i for i, c in enumerate(["smooth", "erratic", "intermittent", "lumpy", "new"])}
    ).to_numpy()
    cal = build_calendar(settings, data.dates[0], as_of + dt.timedelta(days=H_final + 14))
    data.ml_inputs = ml.Inputs(
        data.Y, data.valid, data.start_idx, data.stockout, data.promo, data.depth, data.statics, data.product_idx, cal
    )
    ctx.info("Class mix: " + ", ".join(f"{c} {n}" for c, n in zip(*np.unique(classes, return_counts=True))))

    bt = run_backtest(data, ctx)
    res = bt["results"]
    n_std = bt["n_standard_folds"]
    n_total = next(iter(res.values()))["abs"].shape[0] if res else 0
    weights = ensemble.class_weights(
        res, classes, {c: candidates_for(c) for c in CLASS_MODELS if c != "new"}, int(fcfg["ensemble_top_n"])
    )
    ens = {key: [] for key in ("abs", "act", "fc", "weeks", "scale")}
    for k, (fc, meta) in enumerate(zip(bt["fold_fc"], bt["fold_meta"])):
        E = ensemble.combine(fc, classes, weights, (V, meta["H"]))
        fc["ensemble"] = E
        ok = ~np.isnan(E[:, 0])
        err = metrics.fold_errors(np.nan_to_num(E), meta["A"], bt["weeks_v"])
        for key in ("abs", "act", "fc", "weeks"):
            ens[key].append(np.where(ok, err[key], np.nan))
        ens["scale"].append(np.where(ok, res["velocity_30"]["scale"][k], np.nan))
    for key in ens:
        while len(ens[key]) < n_total:
            ens[key].append(np.full(V, np.nan))
    if n_total:
        res["ensemble"] = {key: np.vstack(val) for key, val in ens.items()}

    all_folds = np.arange(n_total)
    chosen = select(res, classes, all_folds)

    # Honest check: choose on older folds, score on the latest fold only
    holdout = None
    if n_std >= 2:
        chosen_old = select(res, classes, np.arange(1, n_total))
        a_sel = act_sel = a_vel = 0.0
        for v, c in enumerate(chosen_old):
            if c is None or classes[v] == "new":
                continue
            m = c[1]
            a = res[m]["abs"][0, v]
            b = res["velocity_30"]["abs"][0, v]
            if np.isnan(a) or np.isnan(b):
                continue
            a_sel += a
            a_vel += b
            act_sel += res[m]["act"][0, v]
        if act_sel > 0:
            holdout = {"selected": a_sel / act_sel, "velocity_30": a_vel / act_sel, "actual_units": act_sel}

    # Final forecasts from the last day of history
    eligible_final = (T - data.start_idx) >= 1
    final = run_models(data, T - 1, H_final, eligible_final)
    final["ensemble"] = ensemble.combine(final, classes, weights, (V, H_final))

    phi = dispersion(data.Y, data.valid, T - 1, float(fcfg["dispersion_cap"]))
    bias_cap = float(fcfg["bias_cap"])
    rows, bt_rows = [], []
    F = np.zeros((V, H_final))
    win_names = []
    for v in range(V):
        c = chosen[v]
        if c is None:
            winner, wape, bias, mase, folds, absv, act = ("similarity" if classes[v] == "new" else "velocity_30"), np.nan, np.nan, np.nan, 0, np.nan, np.nan
        else:
            winner = c[1]
            wape, bias, mase, folds, absv, act = c[2]
        f = final.get(winner)
        if f is None or np.isnan(f[v, 0]):
            for fb in ("ensemble", "velocity_30", "similarity"):
                if fb in final and not np.isnan(final[fb][v, 0]):
                    winner = winner + " fallback " + fb if c is not None else fb
                    f = final[fb]
                    break
        F[v] = np.nan_to_num(f[v]) if f is not None else 0.0
        win_names.append(winner)
        beta = min(abs(bias), bias_cap) if not np.isnan(bias) else 0.3
        hits = []
        base_m = winner.split(" ")[0]
        if base_m in res:
            for k in range(n_total):
                fs, as_ = res[base_m]["fc"][k, v], res[base_m]["act"][k, v]
                if np.isnan(fs):
                    continue
                q90 = metrics.nb_quantile(fs, metrics.demand_variance(fs, phi[v], beta), 0.9)
                hits.append(float(as_ <= q90))
        p90 = float(np.mean(hits)) if hits else np.nan
        level, reason = confidence(int(hist[v]), wape, classes[v], fcfg["confidence"])
        rows.append({
            "run_id": ctx.run_id, "variant_id": data.dv["variant_id"].iat[v], "demand_class": classes[v],
            "adi": float(adi[v]) if np.isfinite(adi[v]) else None, "cv2": float(cv2[v]) if np.isfinite(cv2[v]) else None,
            "history_days": int(hist[v]), "winner": winner, "wape": wape, "bias": bias, "mase": mase,
            "p90_hit_rate": p90, "folds": folds, "dispersion": float(phi[v]), "confidence": level,
            "confidence_reason": reason,
        })
        for m in candidates_for(classes[v]):
            if m not in res:
                continue
            r = _agg(res, m, v, all_folds)
            if r is None:
                continue
            bt_rows.append({
                "run_id": ctx.run_id, "variant_id": data.dv["variant_id"].iat[v], "model": m,
                "horizon": int(data.eval_days[v]), "folds": r[3], "wape": r[0], "bias": r[1], "mase": r[2],
                "p90_hit_rate": p90 if m == winner else None, "abs_error": r[4], "actual": r[5],
            })
    sel = pd.DataFrame(rows)
    btr = pd.DataFrame(bt_rows)

    # Quantiles: daily and weekly negative binomial around the winner mean
    beta_v = np.where(sel["bias"].notna(), np.minimum(sel["bias"].abs().fillna(0), bias_cap), 0.3)
    var_d = metrics.demand_variance(F, phi[:, None], beta_v[:, None])
    p10 = metrics.nb_quantile(F, var_d, 0.1)
    p50 = metrics.nb_quantile(F, var_d, 0.5)
    p90q = metrics.nb_quantile(F, var_d, 0.9)
    active = data.dv["active"].to_numpy()
    fdates = [as_of + dt.timedelta(days=i + 1) for i in range(H_final)]
    act_rows = np.nonzero(active)[0]
    fc_daily = pd.DataFrame({
        "run_id": ctx.run_id,
        "variant_id": np.repeat(data.dv["variant_id"].to_numpy()[act_rows], H_final),
        "date": np.tile(fdates, len(act_rows)),
        "model": np.repeat(np.array(win_names, dtype=object)[act_rows], H_final),
        "mean": F[act_rows].ravel(), "p10": p10[act_rows].ravel(), "p50": p50[act_rows].ravel(), "p90": p90q[act_rows].ravel(),
    })
    W = int(fcfg["horizon_weeks"])
    Fw = F[:, : 7 * W].reshape(V, W, 7).sum(axis=2)
    var_w = metrics.demand_variance(Fw, phi[:, None], beta_v[:, None])
    fc_weekly = pd.DataFrame({
        "run_id": ctx.run_id,
        "variant_id": np.repeat(data.dv["variant_id"].to_numpy()[act_rows], W),
        "week": np.tile(np.arange(1, W + 1), len(act_rows)),
        "week_start": np.tile([as_of + dt.timedelta(days=7 * i + 1) for i in range(W)], len(act_rows)),
        "model": np.repeat(np.array(win_names, dtype=object)[act_rows], W),
        "mean": Fw[act_rows].ravel(),
        "p10": metrics.nb_quantile(Fw, var_w, 0.1)[act_rows].ravel(),
        "p50": metrics.nb_quantile(Fw, var_w, 0.5)[act_rows].ravel(),
        "p90": metrics.nb_quantile(Fw, var_w, 0.9)[act_rows].ravel(),
    })

    # Catalog comparison against the trailing 30 day velocity baseline, same SKUs and folds
    cmp_rows = [r for r in rows if r["winner"].split(" ")[0] in res and not np.isnan(r["wape"] if r["wape"] is not None else np.nan)]
    vidx = {vid: i for i, vid in enumerate(data.dv["variant_id"])}
    a_sel = a_vel = act_tot = 0.0
    for r in cmp_rows:
        v = vidx[r["variant_id"]]
        rv = _agg(res, "velocity_30", v, all_folds)
        rw = _agg(res, r["winner"].split(" ")[0], v, all_folds)
        if rv is None or rw is None:
            continue
        a_sel += rw[4]
        a_vel += rv[4]
        act_tot += rw[5]
    catalog = {
        "selected_wape": a_sel / act_tot if act_tot else np.nan,
        "velocity_30_wape": a_vel / act_tot if act_tot else np.nan,
        "actual_units": act_tot,
        "holdout": holdout,
        "ensemble_weights": weights,
        "standard_folds": n_std,
        "backtest_horizon_days": bt["H_bt"],
    }
    hist_rows = [
        {"run_id": ctx.run_id, "as_of": as_of, "scope": "catalog all folds", "model": "selected", "wape": catalog["selected_wape"], "bias": None, "skus": len(cmp_rows)},
        {"run_id": ctx.run_id, "as_of": as_of, "scope": "catalog all folds", "model": "velocity_30", "wape": catalog["velocity_30_wape"], "bias": None, "skus": len(cmp_rows)},
    ]
    if holdout:
        hist_rows += [
            {"run_id": ctx.run_id, "as_of": as_of, "scope": "latest fold holdout", "model": "selected", "wape": holdout["selected"], "bias": None, "skus": len(cmp_rows)},
            {"run_id": ctx.run_id, "as_of": as_of, "scope": "latest fold holdout", "model": "velocity_30", "wape": holdout["velocity_30"], "bias": None, "skus": len(cmp_rows)},
        ]
    for cls in np.unique(classes):
        sub = sel[(sel["demand_class"] == cls) & sel["wape"].notna()]
        if len(sub):
            hist_rows.append({"run_id": ctx.run_id, "as_of": as_of, "scope": f"class {cls}", "model": "selected",
                              "wape": float(sub["wape"].median()), "bias": float(sub["bias"].median()), "skus": len(sub)})

    db.append(con, "model_selection", sel)
    db.append(con, "backtest_results", btr)
    db.append(con, "forecasts", fc_daily)
    db.append(con, "forecasts_weekly", fc_weekly)
    db.append(con, "accuracy_history", pd.DataFrame(hist_rows))

    # Proposals: the system suggests rule changes and waits for confirmation
    hit = sel["p90_hit_rate"].dropna()
    if len(hit) and hit.mean() < 0.85:
        ctx.propose("forecast dispersion", "p90 covers actual lead time demand " + f"{hit.mean():.0%} of the time",
                    "raise forecast.bias_cap or the service levels", "p90 should cover about 90 percent of folds")
    if holdout and holdout["selected"] > holdout["velocity_30"]:
        ctx.propose("model selection", "per SKU selection on all candidates",
                    "fewer candidates per class or ensemble only", "selected models lost to the 30 day velocity on the latest fold")
    return {"selection": sel, "catalog": catalog, "data": data, "weekly": fc_weekly, "F": F}
