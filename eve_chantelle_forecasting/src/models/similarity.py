"""Forecast for SKUs with too little history: inherit from the parent product size curve,
or from the launch profile of similar SKUs (same product type, size and price band)."""
from __future__ import annotations

import numpy as np


def forecast(Y, valid, start_idx, product_idx, statics, origin: int, rows, H: int, min_hist: int) -> np.ndarray:
    v, t = Y.shape
    out = np.full((v, H), np.nan)
    age = origin - start_idx + 1
    mature_now = age >= min_hist
    ptype = statics["product_type_code"].to_numpy()
    size = statics["size_code"].to_numpy()
    band = statics["price_band_code"].to_numpy()
    yv = np.where(valid, Y, 0)

    for r in rows:
        a = age[r]
        if a < 1:
            continue
        p = product_idx[r]
        siblings = (product_idx == p) & mature_now
        if siblings.any():
            # Parent product has history: product velocity times this variant's share
            lo = max(origin - 27, 0)
            prod_rate = yv[product_idx == p, lo : origin + 1].sum() / (origin + 1 - lo)
            s0 = start_idx[r]
            prod_since = yv[product_idx == p, s0 : origin + 1].sum()
            n_var = (product_idx == p).sum()
            share = yv[r, s0 : origin + 1].sum() / prod_since if prod_since >= 10 else 1.0 / n_var
            out[r] = prod_rate * share
            continue
        # Launch profile of peers that already lived through the same ages
        need = a + H
        peers_ok = (age >= need) & (start_idx >= 0)
        for mask in (
            peers_ok & (ptype == ptype[r]) & (size == size[r]) & (band == band[r]),
            peers_ok & (ptype == ptype[r]) & (size == size[r]),
            peers_ok & (ptype == ptype[r]),
            peers_ok,
        ):
            peers = np.nonzero(mask)[0]
            if len(peers) >= 3:
                break
        if len(peers) == 0:
            lo = max(origin - 27, 0)
            out[r] = yv[:, lo : origin + 1].sum() / max(valid[:, lo : origin + 1].sum(), 1)
            continue
        idx = start_idx[peers][:, None] + a + np.arange(H)[None, :]
        idx = np.clip(idx, 0, t - 1)
        prof = yv[peers[:, None], idx].mean(axis=0)
        out[r] = prof
    return out
