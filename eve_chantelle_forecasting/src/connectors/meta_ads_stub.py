"""Optional Meta Ads spend input (out of scope as a live driver in v1).

Drop a CSV at data/inputs/meta_ads_spend.csv with columns date (yyyy_mm_dd or ISO) and spend, optionally
campaign and planned (1 for planned future spend). It is loaded and logged but not yet used as a model
feature, because future spend must be planned for the forecast horizon before it can help.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from src.config import parse_date

FILENAME = "meta_ads_spend.csv"


def load(inputs_dir: Path) -> pd.DataFrame | None:
    path = Path(inputs_dir) / FILENAME
    if not path.exists():
        return None
    df = pd.read_csv(path)
    if not {"date", "spend"} <= set(df.columns):
        raise ValueError(f"{path} needs columns date and spend")
    df["date"] = df["date"].map(parse_date)
    return df
