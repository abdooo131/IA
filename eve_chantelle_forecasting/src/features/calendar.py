"""Egypt specific calendar: events, payday window and distance features."""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from src.config import parse_date

EVENT_TYPES = [
    "ramadan",
    "eid_fitr_pre",
    "eid_fitr",
    "eid_adha_pre",
    "eid_adha",
    "white_friday",
    "valentines_pre",
    "valentines",
    "mothers_day_pre",
    "mothers_day",
    "eid_el_hob_pre",
    "eid_el_hob",
    "wedding_season",
    "back_to_school",
    "campaign",
]

# Events whose distance (days to and from) is a model feature
DISTANCE_EVENTS = ["ramadan", "eid_fitr", "eid_adha", "white_friday", "valentines", "mothers_day"]


def event_days(events_cfg: dict, start: dt.date, end: dt.date) -> pd.DataFrame:
    """One row per (date, event type, promo) inside [start, end]."""
    rows = []

    def add(s: dt.date, e: dt.date, etype: str, name: str, promo: bool):
        d = max(s, start)
        while d <= min(e, end):
            rows.append({"date": d, "type": etype, "name": name, "promo": promo})
            d += dt.timedelta(days=1)

    for ev in (events_cfg.get("dated") or []) + (events_cfg.get("campaigns") or []):
        s, e = parse_date(ev["start"]), parse_date(ev["end"])
        add(s, e, ev["type"], ev["name"], bool(ev.get("promo", False)))
        pre = int(ev.get("pre_days", 0) or 0)
        if pre:
            add(s - dt.timedelta(days=pre), s - dt.timedelta(days=1), ev["type"] + "_pre", ev["name"] + " run up", False)
    for ev in events_cfg.get("recurring") or []:
        for year in range(start.year - 1, end.year + 2):
            try:
                s = dt.date(year, int(ev["month"]), int(ev["day"]))
            except ValueError:
                continue
            e = s + dt.timedelta(days=int(ev.get("duration_days", 1)) - 1)
            add(s, e, ev["type"], ev["name"], bool(ev.get("promo", False)))
            pre = int(ev.get("pre_days", 0) or 0)
            if pre:
                add(s - dt.timedelta(days=pre), s - dt.timedelta(days=1), ev["type"] + "_pre", ev["name"] + " run up", False)
    return pd.DataFrame(rows, columns=["date", "type", "name", "promo"])


def build_calendar(settings, start: dt.date, end: dt.date) -> pd.DataFrame:
    """Daily calendar features from start to end inclusive."""
    dates = pd.date_range(start, end, freq="D")
    cal = pd.DataFrame({"date": dates.date})
    cal["dow"] = dates.dayofweek
    cal["week_of_year"] = dates.isocalendar().week.to_numpy().astype(int)
    cal["month"] = dates.month
    cal["day_of_month"] = dates.day
    days_in_month = dates.days_in_month
    end_n = settings.get("calendar", "payday_days_end_of_month", default=3)
    start_n = settings.get("calendar", "payday_days_start_of_month", default=5)
    cal["payday"] = ((dates.day > days_in_month - end_n) | (dates.day <= start_n)).astype(int)

    ev = event_days(settings.events, start - dt.timedelta(days=400), end + dt.timedelta(days=400))
    for t in EVENT_TYPES:
        days = set(ev.loc[ev["type"] == t, "date"])
        cal[f"ev_{t}"] = cal["date"].map(lambda d: int(d in days))
    promo_days = set(ev.loc[ev["promo"], "date"])
    cal["event_promo"] = cal["date"].map(lambda d: int(d in promo_days))

    cap = settings.get("calendar", "event_distance_cap_days", default=60)
    ords = np.array([d.toordinal() for d in cal["date"]])
    for t in DISTANCE_EVENTS:
        ev_ords = np.array(sorted({d.toordinal() for d in ev.loc[ev["type"] == t, "date"]}))
        if len(ev_ords) == 0:
            cal[f"days_to_{t}"] = cap
            cal[f"days_from_{t}"] = cap
            continue
        idx = np.searchsorted(ev_ords, ords)
        nxt = np.where(idx < len(ev_ords), ev_ords[np.minimum(idx, len(ev_ords) - 1)] - ords, cap)
        idx_prev = np.searchsorted(ev_ords, ords, side="right") - 1
        prv = np.where(idx_prev >= 0, ords - ev_ords[np.maximum(idx_prev, 0)], cap)
        cal[f"days_to_{t}"] = np.clip(nxt, 0, cap)
        cal[f"days_from_{t}"] = np.clip(prv, 0, cap)
    return cal
