"""Statistical models through statsforecast: ETS, Croston family, TSB, ADIDA, IMAPA.
Also the product level ETS times size share model used when SKU level signal is too noisy."""
from __future__ import annotations

import os
import warnings

import numpy as np
import pandas as pd

os.environ.setdefault("NIXTLA_ID_AS_COL", "1")

from statsforecast import StatsForecast  # noqa: E402
from statsforecast.models import ADIDA, IMAPA, TSB, AutoETS, CrostonClassic, CrostonSBA  # noqa: E402

STAT_MODELS = ["ets", "ets_damped", "croston", "sba", "tsb", "adida", "imapa"]


def _make(name: str):
    if name == "ets":
        return AutoETS(season_length=7, alias="ets")
    if name == "ets_damped":
        return AutoETS(season_length=7, damped=True, alias="ets_damped")
    if name == "croston":
        return CrostonClassic(alias="croston")
    if name == "sba":
        return CrostonSBA(alias="sba")
    if name == "tsb":
        return TSB(alpha_d=0.1, alpha_p=0.1, alias="tsb")
    if name == "adida":
        return ADIDA(alias="adida")
    if name == "imapa":
        return IMAPA(alias="imapa")
    raise ValueError(name)


def _long(Y: np.ndarray, start_idx: np.ndarray, rows: np.ndarray, origin: int) -> pd.DataFrame:
    ids, ds, ys = [], [], []
    for r in rows:
        s = start_idx[r]
        n = origin - s + 1
        ids.append(np.full(n, r))
        ds.append(np.arange(s, origin + 1))
        ys.append(Y[r, s : origin + 1])
    return pd.DataFrame({"unique_id": np.concatenate(ids), "ds": np.concatenate(ds), "y": np.concatenate(ys)})


def run(
    Y: np.ndarray, start_idx: np.ndarray, rows: np.ndarray, origin: int, H: int, models: list[str], n_jobs: int = 1
) -> dict[str, np.ndarray]:
    """Forecast the given rows with the given models. Returns full height matrices with NaN for rows not run."""
    out = {m: np.full((Y.shape[0], H), np.nan) for m in models}
    rows = np.asarray([r for r in rows if origin - start_idx[r] + 1 >= 14])
    if len(rows) == 0 or not models:
        return out
    sums = np.array([Y[r, start_idx[r] : origin + 1].sum() for r in rows])
    zero_rows = rows[sums <= 0]
    for m in models:
        out[m][zero_rows] = 0.0
    rows = rows[sums > 0]
    if len(rows) == 0:
        return out
    df = _long(Y, start_idx, rows, origin)
    sf = StatsForecast(models=[_make(m) for m in models], freq=1, n_jobs=n_jobs)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fc = sf.forecast(df=df, h=H)
    fc = fc.sort_values(["unique_id", "ds"])
    uid = fc["unique_id"].to_numpy().reshape(-1, H)[:, 0].astype(int)
    for m in models:
        vals = np.clip(fc[m].to_numpy().reshape(-1, H), 0, None)
        out[m][uid] = np.nan_to_num(vals, nan=0.0)
    return out


def product_share(
    Y: np.ndarray, valid: np.ndarray, start_idx: np.ndarray, product_idx: np.ndarray, origin: int, H: int,
    share_window: int = 180, n_jobs: int = 1,
) -> np.ndarray:
    """Product level ETS forecast times the variant's share of the product over the recent window."""
    n_prod = int(product_idx.max()) + 1
    t = Y.shape[1]
    P = np.zeros((n_prod, t))
    np.add.at(P, product_idx, np.where(valid, Y, 0))
    p_start = np.full(n_prod, t)
    np.minimum.at(p_start, product_idx, start_idx)
    rows = np.arange(n_prod)[p_start <= origin - 13]
    p_fc = run(P, p_start, rows, origin, H, ["ets"], n_jobs)["ets"]
    s = max(0, origin - share_window + 1)
    own = np.where(valid[:, s : origin + 1], Y[:, s : origin + 1], 0).sum(axis=1)
    tot = np.zeros(n_prod)
    np.add.at(tot, product_idx, own)
    counts = np.bincount(product_idx, minlength=n_prod)
    share = np.where(tot[product_idx] > 0, own / np.where(tot[product_idx] > 0, tot[product_idx], 1), 1.0 / counts[product_idx])
    out = p_fc[product_idx] * share[:, None]
    has_sibling = counts[product_idx] >= 2
    out[~has_sibling] = np.nan
    out[start_idx > origin] = np.nan
    return out
