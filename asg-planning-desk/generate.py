"""Build the ASG Planning Desk page with demo data.

Generates synthetic raw tables for an Ahram Security Group catalog (Ahram, AFM and
Sicuro lines) at factory scale (about 10 million units a year) and writes them as CSV
files to sample-data/, the same format the page's Upload data tab accepts. Then builds
index.html from template.html and engine.js with the demo tables embedded. All
forecasting runs in the page (engine.js), so demo and uploaded data go through the
same code.

The demo has every factor the engine handles built into it: Egyptian calendar,
price changes and promotions, construction activity with a 6 month lag, dealer,
project and export channels, confirmed orders, lost orders, stockouts with
substitution between sizes, launches and phase outs, dealer stock, factory capacity
and raw materials. Every product line, factory and finish gets SKUs in every state
(make now, running out, overstock, dead, new, phase out and so on) so any filter
shows a full page.

Standard library only. Run:  python3 generate.py   then open index.html
All numbers are synthetic. Model codes follow ASG's public catalogue families;
handle, hinge and smart lock codes are placeholders.
"""
import csv
import datetime as dt
import json
import math
import random
from collections import defaultdict
from pathlib import Path

SEED = 11
WEEKS = 365                   # seven years of weekly history
START = dt.date(2026, 9, 28) - dt.timedelta(weeks=WEEKS - 1)  # Monday of the first history week (7 Oct 2019)
ANNUAL_UNITS = 10_000_000
MARGIN = 1.45
rnd = random.Random(SEED)
D = dt.timedelta

SOURCES = {
    "Factory 1, Locks": dict(kind="factory", lt=14, pack=50, moq=2000),
    "Factory 2, Cylinders and Padlocks": dict(kind="factory", lt=10, pack=100, moq=3000),
    "Factory 3, Hardware": dict(kind="factory", lt=12, pack=100, moq=3000),
    "Sicuro import, Italy": dict(kind="import", lt=75, pack=20, moq=500),
    "Smart lock OEM": dict(kind="import", lt=60, pack=10, moq=200),
}
F1, F2, F3, SC, OEM = list(SOURCES)
FINISH = {"SN": "Satin Nickel", "PB": "Polished Brass", "CP": "Chrome", "AB": "Antique Brass", "BK": "Matt Black", "SS": "Stainless"}

# (code, name, line, source, finishes, sizes, relative volume, unit cost EGP, season profile, export share)
CATALOG = [
    ("MI-02", "Internal Lock MI-02 Room", "Internal mortise locks", F1, "SN PB AB", "40mm 45mm", 46, 185, "build", .06),
    ("MI-04", "Internal Lock MI-04 Bathroom", "Internal mortise locks", F1, "SN PB AB", "40mm 45mm", 30, 195, "build", .06),
    ("MI-06", "Internal Lock MI-06 Narrow Door", "Internal mortise locks", F1, "SN PB", "25mm 30mm", 12, 210, "build", 0),
    ("MI-08", "Internal Lock MI-08 European Type", "Internal mortise locks", F1, "SN CP BK", "50mm 55mm", 18, 260, "build", .1),
    ("MI-14", "Internal Lock MI-14", "Internal mortise locks", F1, "SN PB", "40mm 45mm", 7, 220, "build", 0),
    ("ME-02", "External Lock ME-02 Deadbolt", "External mortise locks", F1, "SN PB", "85x45 85x50", 20, 340, "build", .05),
    ("ME-06", "External Lock ME-06 Triple Square Deadbolt", "External mortise locks", F1, "SN PB AB", "85x45 85x50", 26, 420, "build", .05),
    ("ME-12", "External Lock ME-12 Sliding Hook Bolt", "External mortise locks", F1, "SN BK", "85x30 85x35", 8, 380, "build", 0),
    ("ME-19", "External Lock ME-19", "External mortise locks", F1, "SN PB CP", "85x45 85x50", 10, 450, "build", 0),
    ("RL-01", "Rim Lock RL-01", "Rim locks", F1, "SN PB BK", "60mm 80mm", 6, 310, "flat", 0),
    ("RL-02", "Rim Lock RL-02 Night Latch", "Rim locks", F1, "SN CP AB", "60mm", 4, 290, "flat", 0),
    ("AFM-ML", "AFM Mortise Lock 54mm Deadbolt, Cylinder, 5 Computer Keys", "AFM locks", F1, "SN PB AB", "85x45 85x50", 24, 365, "build", .08),
    ("AFM-MX", "AFM External Lock Case, no Cylinder", "AFM locks", F1, "SN BK", "85x45 85x50", 15, 240, "build", .08),
    ("CY-01", "Cylinder CY-01 Oval", "Cylinders", F2, "SN PB", "60mm 70mm", 22, 150, "flat", .12),
    ("CY-03", "Euro Cylinder CY-03 Key/Key", "Cylinders", F2, "SN PB CP", "60mm 70mm 80mm", 34, 210, "flat", .12),
    ("CY-07", "Euro Cylinder CY-07 Key/Knob", "Cylinders", F2, "SN PB AB", "60mm 70mm", 16, 245, "flat", .12),
    ("CY-18", "Euro Cylinder CY-18 High Security 6 Pin", "Cylinders", F2, "SN BK", "60mm 70mm 80mm", 11, 520, "flat", .1),
    ("PL-B", "Brass Padlock", "Padlocks", F2, "PB", "30mm 40mm 50mm 60mm", 28, 95, "summer", .15),
    ("PL-S", "Steel Padlock Long Shackle", "Padlocks", F2, "SN BK SS", "40mm 50mm", 14, 130, "summer", .15),
    ("PL-D", "Disc Padlock", "Padlocks", F2, "SS CP", "70mm", 4, 210, "summer", .15),
    ("AFM-H", "AFM Lever Handle on Rose", "AFM handles", F3, "SN PB BK AB", "STD", 19, 210, "build", 0),
    ("AFM-HP", "AFM Lever Handle on Plate", "AFM handles", F3, "SN PB CP SS", "STD", 12, 240, "build", 0),
    ("HG-BB", "Ball Bearing Hinge", "Hinges", F3, "SN PB SS BK", "3in 4in 5in", 60, 48, "build", 0),
    ("SC-H01", "Sicuro Lever Handle H01", "Sicuro handles", SC, "SN CP BK", "STD", 11, 640, "build", 0),
    ("SC-H02", "Sicuro Lever Handle H02", "Sicuro handles", SC, "SN AB PB", "STD", 6, 780, "build", 0),
    ("SC-H03", "Sicuro Lever Handle H03 Modern", "Sicuro handles", SC, "CP BK SS", "STD", 8, 920, "build", 0),
    ("SC-PH", "Sicuro Pull Handle", "Sicuro handles", SC, "SS BK", "300mm 450mm", 4, 1150, "build", 0),
    ("DG-01", "Smart Lock DG-01 Fingerprint and Code", "Digital locks", OEM, "BK SN SS", "STD", 1.2, 5200, "flat", 0),
    ("DG-02", "Smart Lock DG-02 Card and App", "Digital locks", OEM, "BK SN CP", "STD", .8, 7400, "flat", 0),
    ("DG-03", "Smart Lock DG-03 Rim Mounted", "Digital locks", OEM, "BK PB", "STD", .6, 4300, "flat", 0),
]
DEPARTMENT = {"Internal mortise locks": "Locks", "External mortise locks": "Locks", "Rim locks": "Locks", "AFM locks": "Locks",
              "Cylinders": "Cylinders and padlocks", "Padlocks": "Cylinders and padlocks",
              "AFM handles": "Door hardware", "Hinges": "Door hardware", "Sicuro handles": "Door hardware", "Digital locks": "Smart locks"}
# models introduced during the seven years of history (not new any more)
INTRO = {"CY-18": "2020-06-01", "SC-H01": "2020-02-03", "SC-H02": "2020-02-03", "SC-H03": "2021-09-06", "SC-PH": "2022-04-04",
         "DG-01": "2021-03-01", "DG-02": "2022-02-07", "DG-03": "2023-05-08", "AFM-HP": "2021-01-04", "ME-19": "2022-09-05", "PL-D": "2023-03-06"}

# a new model per line: (code, name, line, source, finish, size, volume, cost, profile, launch weeks from now (negative is past), replaces code or None)
LAUNCHES = [
    ("MI-16", "Internal Lock MI-16 Slim", "Internal mortise locks", F1, "SN", "40mm", 9, 230, "build", -12, "MI-14"),
    ("ME-23", "External Lock ME-23 Anti Snap", "External mortise locks", F1, "SN", "85x45", 6, 470, "build", -6, None),
    ("RL-03", "Rim Lock RL-03 Deadlatch", "Rim locks", F1, "SN", "60mm", 3, 320, "flat", 5, None),
    ("AFM-MZ", "AFM Mortise Lock Zinc Body", "AFM locks", F1, "SN", "85x45", 8, 300, "build", -9, None),
    ("CY-28", "Euro Cylinder CY-28 Computer Key", "Cylinders", F2, "SN", "60mm", 9, 330, "flat", -16, None),
    ("PL-L", "Laminated Padlock", "Padlocks", F2, "SS", "50mm", 5, 140, "summer", 3, None),
    ("AFM-HM", "AFM Lever Handle Minimal", "AFM handles", F3, "BK", "STD", 7, 230, "build", -5, None),
    ("HG-FL", "Flag Hinge", "Hinges", F3, "SN", "100mm", 10, 36, "build", -10, None),
    ("SC-H04", "Sicuro Lever Handle H04", "Sicuro handles", SC, "AB", "STD", 4, 880, "build", 6, "SC-H02"),
    ("DG-04", "Smart Lock DG-04 Face Recognition", "Digital locks", OEM, "BK", "STD", .5, 9800, "flat", -8, None),
]

# price changes and promotions: (type, start, end, pct, line or "", name)
EVENTS = [
    ("price", "2020-01-05", "2020-01-05", 5, "", "Price list January 2020"),
    ("price", "2021-01-03", "2021-01-03", 5, "", "Price list January 2021"),
    ("price", "2022-01-02", "2022-01-02", 7, "", "Price list January 2022"),
    ("price", "2022-04-03", "2022-04-03", 10, "", "Price rise after March 2022 devaluation"),
    ("price", "2022-11-06", "2022-11-06", 12, "", "Price rise after October 2022 devaluation"),
    ("price", "2023-01-29", "2023-01-29", 20, "", "Price list 2023 after January devaluation"),
    ("price", "2024-01-07", "2024-01-07", 12, "", "Price list January 2024"),
    ("price", "2024-04-07", "2024-04-07", 25, "", "Price rise after March 2024 devaluation"),
    ("price", "2025-01-05", "2025-01-05", 10, "", "Price list January 2025"),
    ("price", "2026-01-04", "2026-01-04", 12, "", "Price list January 2026"),
    ("price", "2027-01-03", "2027-01-03", 10, "", "Price list January 2027 (announced)"),
    ("promo", "2025-09-14", "2025-09-27", 10, "Cylinders", "Cylinder dealer fortnight"),
    ("promo", "2025-11-02", "2025-11-15", 8, "Internal mortise locks", "Internal lock autumn offer"),
    ("promo", "2026-02-01", "2026-02-14", 10, "Padlocks", "Padlock winter offer"),
    ("promo", "2026-05-03", "2026-05-16", 8, "Hinges", "Hinge spring offer"),
    ("promo", "2026-06-07", "2026-06-20", 10, "AFM locks", "AFM lock offer"),
    ("promo", "2026-08-02", "2026-08-15", 10, "AFM handles", "AFM handle summer offer"),
    ("promo", "2026-04-26", "2026-05-09", 8, "Sicuro handles", "Sicuro showroom days"),
    ("promo", "2025-10-05", "2025-10-18", 8, "External mortise locks", "External lock offer"),
    ("promo", "2025-06-15", "2025-06-28", 8, "Digital locks", "Smart lock summer offer"),
    ("promo", "2025-12-07", "2025-12-13", 8, "Rim locks", "Rim lock offer"),
    ("promo", "2026-11-01", "2026-11-14", 10, "Padlocks", "Padlock autumn offer (planned)"),
    ("promo", "2026-11-15", "2026-11-28", 12, "Sicuro handles", "Sicuro autumn offer (planned)"),
    ("promo", "2026-10-18", "2026-10-31", 8, "Rim locks", "Rim lock offer (planned)"),
    ("promo", "2026-12-06", "2026-12-19", 10, "Digital locks", "Smart lock offer (planned)"),
]
_er = random.Random(3)
for _y in range(2020, 2025):   # earlier promotions, one per line per year
    for _line in ["Cylinders", "Internal mortise locks", "Padlocks", "Hinges", "AFM locks", "AFM handles", "Sicuro handles", "External mortise locks", "Digital locks", "Rim locks"]:
        _m = _er.choice([9, 10, 11]) if _y == 2020 else _er.choice([2, 5, 6, 7, 9, 10, 11])   # no offers during the 2020 lockdown
        _d = dt.date(_y, _m, 1) + dt.timedelta(days=(6 - dt.date(_y, _m, 1).weekday()) + 7 * _er.randint(0, 2))
        EVENTS.append(("promo", _d.isoformat(), (_d + dt.timedelta(days=13)).isoformat(), _er.choice([8, 10]), _line, f"{_line} offer {_y}"))
PROFILE = {"price": {-4: .03, -3: .06, -2: .1, -1: .14, 0: -.12, 1: -.1, 2: -.06, 3: -.03}, "promo": {"during": .25, "post1": -.1, "post2": -.05}}
ELASTICITY = {"build": .6, "flat": .25, "summer": .35}
DEALERS = ["Dealer A", "Dealer B", "Dealer C", "Dealer D", "Dealer E"]

# ---------------------------------------------------------------- calendar, mirrors engine.js
RAMADAN = [("2019-05-06", "2019-06-03"), ("2020-04-24", "2020-05-23"), ("2021-04-13", "2021-05-12"), ("2022-04-02", "2022-05-01"), ("2023-03-23", "2023-04-20"), ("2024-03-11", "2024-04-08"), ("2025-03-01", "2025-03-29"), ("2026-02-18", "2026-03-18"), ("2027-02-08", "2027-03-08")]
EID = [("2019-06-04", "2019-06-07"), ("2019-08-11", "2019-08-15"), ("2020-05-24", "2020-05-27"), ("2020-07-31", "2020-08-04"),
       ("2021-05-13", "2021-05-16"), ("2021-07-20", "2021-07-24"), ("2022-05-02", "2022-05-05"), ("2022-07-09", "2022-07-13"),
       ("2023-04-21", "2023-04-24"), ("2023-06-28", "2023-07-02"), ("2024-04-09", "2024-04-12"), ("2024-06-15", "2024-06-19"), ("2025-03-30", "2025-04-02"), ("2025-06-05", "2025-06-09"),
       ("2026-03-19", "2026-03-22"), ("2026-05-26", "2026-05-30"), ("2027-03-09", "2027-03-12"), ("2027-05-15", "2027-05-19")]
DAYOFF = ["01-07", "01-25", "04-25", "05-01", "06-30", "07-23", "10-06"]
NESSIM = ["2019-04-29", "2020-04-20", "2021-05-03", "2022-04-25", "2023-04-17", "2024-05-06", "2025-04-21", "2026-04-13", "2027-05-03"]
P = dt.date.fromisoformat


def overlap(ws, a, b):
    return max(0, (min(ws + D(6), b) - max(ws, a)).days + 1)


def calendar(ws):
    m = 1.0
    we = ws + D(6)
    for a, b in RAMADAN:
        a, b = P(a), P(b)
        if not (we < a or ws > b):
            m *= .72 + .28 * (1 - overlap(ws, a, b) / 7)
            break
    for a, b in EID:
        a, b = P(a), P(b)
        o = overlap(ws, a, b)
        if o:
            m *= 1 - .35 * o / 4
        if 7 <= (a - ws).days <= 13:
            m *= 1.12
    for md in DAYOFF:
        for y in (ws.year, ws.year + 1):
            if ws <= P(f"{y}-{md}") <= we:
                m *= .92
    for d in NESSIM:
        if ws <= P(d) <= we:
            m *= .92
    if (ws.month == 12 and ws.day >= 18) or (ws.month == 1 and ws.day <= 3):
        m *= 1.15
    return m


def season(profile, d):
    doy = d.timetuple().tm_yday
    if profile == "build":
        return 1 + .15 * math.cos(2 * math.pi * (doy - 100) / 182.5)
    if profile == "summer":
        return 1 + .2 * math.cos(2 * math.pi * (doy - 200) / 365)
    return 1.0


def covid(d):
    if dt.date(2020, 3, 16) <= d <= dt.date(2020, 6, 28):
        return .55
    if dt.date(2020, 6, 29) <= d <= dt.date(2020, 9, 27):
        return .82
    return 1.0


def week(i):
    return START + D(7 * i)


def wk_of(d):
    return (P(d) - START).days // 7


# construction activity, monthly cement sales in thousand tons
MONTHS = []
m = dt.date(2019, 1, 1)
while m <= dt.date(2026, 9, 1):
    MONTHS.append(m)
    m = (m + D(32)).replace(day=1)


def cement_at(d):
    t = (d.year - 2019) * 12 + d.month - 1
    covid = .82 if dt.date(2020, 4, 1) <= d <= dt.date(2020, 8, 1) else 1
    return 3500 * (1 + .003 * t) * (1 + .07 * math.sin(2 * math.pi * (t - 3) / 22)) * (1 + .03 * math.cos(2 * math.pi * (d.month - 3) / 12)) * covid


FX_ANCHORS = [("2019-01", 17.9), ("2019-12", 16.1), ("2021-12", 15.7), ("2022-02", 15.7), ("2022-03", 18.3), ("2022-09", 19.5), ("2022-10", 19.8),
              ("2022-11", 24.4), ("2022-12", 24.6), ("2023-01", 29.7), ("2024-02", 30.9), ("2024-03", 47.5), ("2025-06", 50.2), ("2026-09", 50.9)]


def fx_at(d):
    key = d.strftime("%Y-%m")
    for (a, va), (b, vb) in zip(FX_ANCHORS, FX_ANCHORS[1:]):
        if a <= key <= b:
            ma = int(a[:4]) * 12 + int(a[5:]); mb = int(b[:4]) * 12 + int(b[5:]); mk = d.year * 12 + d.month
            return va + (vb - va) * (mk - ma) / max(1, mb - ma)
    return FX_ANCHORS[-1][1]


MACRO = []
cpi = 100.0
for mm in MONTHS:
    fx = fx_at(mm) * rnd.uniform(.997, 1.003)
    cpi = cpi * (1 + (rnd.uniform(.003, .008) if mm.year < 2022 else rnd.uniform(.02, .035) if mm.year < 2025 else rnd.uniform(.01, .02)))
    MACRO.append(dict(month=mm.strftime("%Y-%m"), cement=round(cement_at(mm) * rnd.uniform(.985, 1.015)), usd_egp=round(fx, 2), cpi=round(cpi, 1)))
CEM = {r["month"]: r["cement"] for r in MACRO}


CEM_KEYS = sorted(CEM)
_cl = {}


def cement_lag(d):
    k = (d.year * 12 + d.month - 1) - 6
    if k not in _cl:
        key = min(max(f"{k // 12}-{k % 12 + 1:02d}", CEM_KEYS[0]), CEM_KEYS[-1])
        i = CEM_KEYS.index(key)
        ks = CEM_KEYS[max(0, i - 1):i + 2]
        _cl[k] = sum(CEM[x] for x in ks) / len(ks)
    return _cl[k]


CEM_REF = cement_lag(START + D(7 * (WEEKS - 1)))


def event_eff(line, i):
    k = 1.0
    for typ, s, e, pct, ln, _ in EVENTS:
        if ln and ln != line:
            continue
        w0, w1 = wk_of(s), wk_of(e)
        if typ == "price":
            off = i - w0
            if off in PROFILE["price"]:
                k *= 1 + PROFILE["price"][off] * pct / 10
        else:
            if w0 <= i <= w1:
                k *= 1 + PROFILE["promo"]["during"] * pct / 10
            elif i == w1 + 1:
                k *= 1 + PROFILE["promo"]["post1"] * pct / 10
            elif i == w1 + 2:
                k *= 1 + PROFILE["promo"]["post2"] * pct / 10
    return k


def ceil_to(x, step):
    return int(math.ceil(x / step) * step)


# ---------------------------------------------------------------- catalog
def build_skus():
    skus = []
    size_share = {1: [1], 2: [.6, .4], 3: [.45, .35, .2], 4: [.2, .4, .28, .12]}

    def add(code, name, line, src, fins, sizes, base, cost, prof, exp, launch=None, replaces=None):
        fins, sizes = fins.split(), sizes.split()
        fshare = [1.0, .55, .35, .25][:len(fins)]
        fshare = [x / sum(fshare) for x in fshare]
        for fi, f in enumerate(fins):
            for zi, z in enumerate(sizes):
                skus.append(dict(sku=f"ASG-{code}-{f}-{z.upper()}", code=code, p=name, line=line, src=src, c=FINISH[f], fc=f, z=z,
                                 rel=base * fshare[fi] * size_share[len(sizes)][zi] * rnd.uniform(.75, 1.25), cost=round(cost * rnd.uniform(.9, 1.1), 2),
                                 prof=prof, exp=exp, trend=rnd.uniform(-.12, .2), noise=rnd.uniform(.12, .25) if base >= 5 else rnd.uniform(.25, .4),
                                 launch=launch, replaces=replaces, end=None, role="normal", dept=DEPARTMENT[line],
                                 intro=P(INTRO[code]) if code in INTRO else None))
    for row in CATALOG:
        add(*row)
    for code, name, line, src, fins, sizes, base, cost, prof, lw, rep in LAUNCHES:
        add(code, name, line, src, fins, sizes, base, cost, prof, 0, launch=week(WEEKS + lw), replaces=rep)
    scale = ANNUAL_UNITS / 52 / sum(s["rel"] * (1 + s["exp"]) for s in skus if not s["launch"])
    for s in skus:
        s["rate"] = s["rel"] * scale
    return skus


def assign_roles(skus):
    """Give every product line, and every finish, SKUs in each state so any filter shows a full page."""
    old = [s for s in skus if not s["launch"]]
    for s in skus:  # a replaced SKU ends when its successor launches
        s["replaces_sku"] = None
        if s["launch"] and s["replaces"]:
            for o in old:
                if o["code"] == s["replaces"] and o["role"] == "normal":
                    o["end"] = s["launch"]
                    o["role"] = "ended" if s["launch"] <= week(WEEKS) else "phaseout"
                    s["replaces_sku"] = o["sku"]
                    break
    roles = ["over", "make", "low", "dead", "phaseout", "issue_cost", "dealer_hi", "dealer_lo", "make"]
    for line in sorted({s["line"] for s in old}):
        mem = sorted([s for s in old if s["line"] == line and s["role"] == "normal"], key=lambda s: -s["rate"])
        mem[0]["role"] = "short"   # an A item that keeps running short
        rest = mem[1:]
        rnd.shuffle(rest)
        rest.sort(key=lambda s: s["rate"] < 1500)   # keep tiny SKUs for the last roles
        need = list(roles)
        if any(s["role"] == "phaseout" for s in old if s["line"] == line):
            need.remove("phaseout")
        if any(s["role"] == "ended" for s in old if s["line"] == line):
            need.remove("dead")
        for s, r in zip(rest, need):
            s["role"] = r
    for f in FINISH:  # each finish gets every state too
        mem = [s for s in old if s["fc"] == f]
        for want, ok in [("short", {"short"}), ("make", {"make"}), ("low", {"low", "lowinc"}), ("over", {"over"}), ("dead", {"dead", "ended"}),
                         ("phaseout", {"phaseout", "ended"})]:
            if not any(s["role"] in ok for s in mem):
                spare = sorted([s for s in mem if s["role"] in ("normal", "dealer_lo", "dealer_hi")], key=lambda s: -s["rate"])
                if spare:
                    (spare[0] if want == "short" else rnd.choice(spare))["role"] = want
    for line in sorted({s["line"] for s in old}):   # and the finish pass must not leave a line without overstock
        mem = [s for s in old if s["line"] == line]
        if not any(s["role"] == "over" for s in mem):
            spare = [s for s in mem if s["role"] in ("normal", "make", "dealer_lo")]
            rnd.choice(spare)["role"] = "over"
    for s in rnd.sample([s for s in old if s["role"] == "normal" and s["src"] in (F1, F2)], 2):
        s["role"] = "longout"


# ---------------------------------------------------------------- history
def simulate(skus):
    sizes = defaultdict(set)
    for s in skus:
        sizes[s["code"]].add(s["z"])
    groups = defaultdict(list)   # sizes of one model and finish stand in for each other; one size models swap finishes
    for s in skus:
        groups[(s["code"], s["fc"]) if len(sizes[s["code"]]) > 1 else (s["code"],)].append(s)
    for s in skus:
        s.update(dealer=[0] * WEEKS, export=[0] * WEEKS, project=[0] * WEEKS, lost=[0] * WEEKS, short=[0] * WEEKS, demand=[0.0] * WEEKS)
        s["records_lost"] = rnd.random() < .5
        out = set(rnd.sample(range(10, WEEKS - 14), rnd.choice([3, 5, 7]) + (6 if s["src"] == OEM else 0)))  # imports run short more often
        if s["role"] == "short":
            out |= set(rnd.sample(range(WEEKS - 13, WEEKS), rnd.choice([4, 5])))
        if s["role"] == "longout":
            out |= set(range(WEEKS - 26, WEEKS))
        s["out"] = out
    for i in range(WEEKS):
        d = week(i)
        for s in skus:
            if (s["launch"] and d < s["launch"]) or (s["end"] and d >= s["end"]) or (s["intro"] and d < s["intro"]):
                continue
            start = s["launch"] or s["intro"]
            age = (d - start).days // 7 if start else 99
            ramp = [.5, .75, .9][age] if age < 3 else 1
            lam = (s["rate"] * ramp * season(s["prof"], d) * calendar(d) * event_eff(s["line"], i)
                   * (cement_lag(d) / CEM_REF) ** ELASTICITY[s["prof"]] * (1 + s["trend"] * (i - WEEKS) / WEEKS)
                   * 1.04 ** ((i - WEEKS) / 52) * covid(d))
            s["demand"][i] = lam * math.exp(rnd.gauss(0, s["noise"]) - s["noise"] ** 2 / 2)
            if s["exp"]:
                s["export"][i] = round(s["rate"] * s["exp"] * rnd.uniform(.6, 1.4) * (rnd.random() > .1))
            if s["line"] in ("Internal mortise locks", "External mortise locks", "AFM handles", "Hinges", "Digital locks", "Sicuro handles") and rnd.random() < .025:
                s["project"][i] = ceil_to(s["rate"] * rnd.uniform(2, 6), 10)
        for mem in groups.values():   # stockouts, with 40 percent of the unmet demand moving to sibling sizes
            for s in mem:
                q = s["demand"][i]
                if i in s["out"] and q > 0:
                    days = 7 if s["role"] == "longout" else rnd.choice([4, 5, 7]) if s["role"] == "short" else rnd.choice([2, 3, 4, 5, 7])
                    sold = q * (7 - days) / 7
                    unmet = q - sold
                    s["short"][i] = days
                    s["dealer"][i] += round(sold)
                    if s["records_lost"] and s["role"] != "longout":
                        s["lost"][i] = round(unmet)
                    others = [o for o in mem if o is not s and i not in o["out"] and o["demand"][i] > 0]
                    vol = sum(o["rate"] for o in others)
                    for o in others:
                        o["dealer"][i] += round(.45 * unmet * o["rate"] / vol)
                else:
                    s["dealer"][i] += round(q)


def stock_for(s):
    src = SOURCES[s["src"]]
    recent = (sum(s["dealer"][-8:]) + sum(s["export"][-8:]) + sum(s["lost"][-8:])) / 8
    wkly = max(recent, s["rate"] * .3) * 1.1   # size stock from what is selling now, plus a little for the season ahead
    lt_w = (src["lt"] + 7) / 7
    r = s["role"]
    inc = 0
    if s["launch"] and s["launch"] > week(WEEKS):
        return 0, 0, ceil_to(wkly * 3, src["pack"])
    if r == "make":   # below the reorder point but not yet critical
        oh = wkly * (lt_w * rnd.uniform(.75, .95) + 1)
    elif r == "low":
        oh = wkly * rnd.uniform(.6, 1.6)
    elif r == "lowinc":
        oh = wkly * rnd.uniform(.6, 1.6)
        inc = ceil_to(wkly * (lt_w + 3), src["pack"])
    elif r == "over":
        oh = wkly * rnd.uniform(30, 40)
    elif r in ("dead", "ended"):
        oh = s["rate"] * rnd.uniform(2, 5)
    elif r == "longout":
        oh = 0
    elif r == "short":
        oh = wkly * rnd.uniform(.4, 1.2)
        inc = ceil_to(wkly * 2, src["pack"])
    elif r == "phaseout":   # roughly enough to run out at the end date
        oh = wkly * max(2, (s["end"] - week(WEEKS)).days / 7 * rnd.uniform(.7, 1.1)) if s["end"] else wkly * 4
    else:
        oh = wkly * rnd.uniform(lt_w + 2.5, lt_w + 9)
        inc = ceil_to(wkly * rnd.uniform(1, 3), src["pack"]) if rnd.random() < .4 else 0
    cm = round(wkly * rnd.choice([0, .1, .2, .3]))
    return round(oh), cm, inc


BOM = {"Internal mortise locks": [("Steel strip", .32), ("Zinc alloy", .12), ("Springs", 3), ("Cartons", .1)],
       "External mortise locks": [("Steel strip", .55), ("Zinc alloy", .2), ("Springs", 4), ("Cartons", .1)],
       "Rim locks": [("Steel strip", .45), ("Brass rod", .08), ("Cartons", .1)],
       "AFM locks": [("Steel strip", .5), ("Zinc alloy", .18), ("Brass rod", .1), ("Springs", 4), ("Cartons", .1)],
       "Cylinders": [("Brass rod", .22), ("Springs", 6), ("Nickel plating salt", .004), ("Cartons", .05)],
       "Padlocks": [("Brass rod", .18), ("Steel strip", .08), ("Springs", 4), ("Cartons", .05)],
       "AFM handles": [("Zinc alloy", .35), ("Nickel plating salt", .006), ("Cartons", .1)],
       "Hinges": [("Steel strip", .12), ("Nickel plating salt", .002), ("Cartons", .02)],
       "Sicuro handles": [("Cartons", .1)], "Digital locks": [("Electronic module", 1), ("Cartons", .2)]}


def main():
    skus = build_skus()
    assign_roles(skus)
    for s in skus:
        if s["role"] == "dead":           # dropped from the range a while ago, stock left behind
            s["end"] = week(WEEKS - rnd.randint(16, 24))
        if s["role"] == "phaseout" and not s["end"]:
            s["end"] = week(WEEKS + rnd.randint(8, 18))
    simulate(skus)
    now = week(WEEKS)

    items, stock, sales, stockouts, dealers, orders, bom = [], [], [], [], [], [], []
    neg_done = set()
    for s in skus:
        items.append(dict(sku=s["sku"], product=s["p"], model=s["code"], department=s["dept"], line=s["line"], finish=s["c"], size=s["z"], source=s["src"],
                          unit_cost=None if s["role"] == "issue_cost" else s["cost"], price=round(s["cost"] * MARGIN, 2),
                          launch_date=(s["launch"] or s["intro"]).isoformat() if (s["launch"] or s["intro"]) else "", end_date=s["end"].isoformat() if s["end"] else "",
                          replaces=s["replaces_sku"] or ""))
        oh, cm, inc = stock_for(s)
        if s["line"] not in neg_done and s["role"] == "normal" and not s["launch"] and rnd.random() < .5:
            oh = -rnd.randint(20, 300)
            neg_done.add(s["line"])
        stock.append(dict(sku=s["sku"], on_hand=oh, committed=cm, incoming=inc))
        for i in range(WEEKS):
            ws = week(i).isoformat()
            for ch in ("dealer", "export", "project"):
                if s[ch][i]:
                    sales.append(dict(date=ws, sku=s["sku"], qty=s[ch][i], status="shipped", channel=ch, reason="", value=""))
            if s["lost"][i]:
                sales.append(dict(date=ws, sku=s["sku"], qty=s["lost"][i], status="lost", channel="dealer", reason="No stock", value=""))
            if s["short"][i]:
                stockouts.append(dict(date=ws, sku=s["sku"], days_out=s["short"][i]))
        if not (s["launch"] and s["launch"] > now) and s["role"] not in ("dead", "ended", "longout"):
            r = rnd.random()
            idx_now = (1.7 if s["role"] == "dealer_hi" else .55 if s["role"] == "dealer_lo"
                       else rnd.uniform(1.25, 1.6) if r < .12 else rnd.uniform(.6, .8) if r < .24 else rnd.uniform(.94, 1.06))
            for k in range(8):
                f = idx_now if k == 7 else rnd.uniform(.94, 1.06)
                for dl in DEALERS:
                    so = s["rate"] * .08 * rnd.uniform(.8, 1.2)
                    dealers.append(dict(date=week(WEEKS - 8 + k).isoformat(), dealer=dl, sku=s["sku"], stock=round(so * 4 * f), sell_out=round(so)))
        for mat, per in BOM[s["line"]]:
            bom.append(dict(sku=s["sku"], material=mat, qty_per_unit=per))

    for line in sorted({s["line"] for s in skus}):   # confirmed orders in every line
        mem = [s for s in skus if s["line"] == line and s["role"] in ("normal", "make", "over") and not s["launch"]]
        for s in rnd.sample(mem, min(2, len(mem))):
            orders.append(dict(due_date=(now + D(7 * rnd.randint(1, 9) + rnd.randint(0, 4))).isoformat(), sku=s["sku"],
                               qty=ceil_to(s["rate"] * rnd.uniform(2, 5), 10), channel="project"))
        for s in rnd.sample([s for s in mem if s["exp"]], min(2, len([s for s in mem if s["exp"]]))):
            orders.append(dict(due_date=(now + D(7 * rnd.randint(2, 12))).isoformat(), sku=s["sku"],
                               qty=ceil_to(s["rate"] * s["exp"] * rnd.uniform(3, 6), 10), channel="export"))

    reasons = ["Dealer credit hold"] * 34 + ["Out of stock at dispatch"] * 27 + ["Dealer changed order"] * 24 + ["Duplicate order"] * 15
    pool = [s for s in skus if not s["launch"]]
    for _ in range(5000):   # cancelled dealer orders, spread over every line
        s = rnd.choice(pool)
        q = rnd.choice([100, 200, 300, 500, 1000])
        lo = wk_of(s["intro"].isoformat()) if s["intro"] else 0
        sales.append(dict(date=(week(rnd.randrange(max(0, lo), WEEKS)) + D(rnd.randrange(6))).isoformat(), sku=s["sku"], qty=q, status="cancelled", channel="dealer",
                          reason=rnd.choice(reasons), value=round(q * s["cost"] * MARGIN)))

    sources = []
    for name, src in SOURCES.items():
        mine = [s for s in skus if s["src"] == name]
        avg = sum(sum(s["dealer"][-13:]) + sum(s["export"][-13:]) for s in mine) / 13
        sources.append(dict(source=name, type=src["kind"], lead_time_days=src["lt"], carton=src["pack"], min_batch=src["moq"],
                            weekly_capacity=ceil_to(avg * 1.2, 1000) if src["kind"] == "factory" else "", confirmed="yes" if name == F1 else "no"))

    need = defaultdict(float)
    by = {s["sku"]: s for s in skus}
    for b in bom:
        s = by[b["sku"]]
        need[b["material"]] += (sum(s["dealer"][-13:]) + sum(s["export"][-13:])) / 13 * b["qty_per_unit"]
    units = {"Steel strip": "kg", "Zinc alloy": "kg", "Brass rod": "kg", "Springs": "pcs", "Cartons": "pcs", "Nickel plating salt": "kg", "Electronic module": "pcs"}
    lts = {"Steel strip": 30, "Zinc alloy": 45, "Brass rod": 60, "Springs": 21, "Cartons": 10, "Nickel plating salt": 40, "Electronic module": 75}
    cover = {"Brass rod": .15, "Zinc alloy": 1.6}
    materials = [dict(material=m, unit=units[m], on_hand=round(need[m] * cover.get(m, rnd.uniform(4, 9))),
                      on_order=round(need[m] * (3 if m == "Brass rod" else rnd.uniform(0, 4))), lead_time_days=lts[m]) for m in sorted(need)]

    events = [dict(type=t, start=s0, end=e0, pct=p, line=l, sku="", name=n) for t, s0, e0, p, l, n in EVENTS]
    tables = dict(items=items, sources=sources, sales=sales, stock=stock, stockouts=stockouts, events=events, orders=orders,
                  macro=MACRO, dealers=dealers, bom=bom, materials=materials)
    here = Path(__file__).parent
    out = here / "sample-data"
    out.mkdir(exist_ok=True)
    for f in out.glob("*.csv"):
        f.unlink()
    for name, rows in tables.items():
        with open(out / f"{name}.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
    # columnar keeps the page small; shipped and lost sales go as one weekly array per SKU and channel
    demo = {k: dict(cols=list(v[0]), rows=[list(r.values()) for r in v]) for k, v in tables.items() if k != "sales"}
    demo["sales"] = dict(cols=list(sales[0]), rows=[list(r.values()) for r in sales if r["status"] == "cancelled"])
    demo["weekly"] = dict(start=START.isoformat(), skus=[s["sku"] for s in skus],
                          dealer=[s["dealer"] for s in skus], export=[s["export"] for s in skus], project=[s["project"] for s in skus], lost=[s["lost"] for s in skus])
    page = (here / "template.html").read_text()
    page = page.replace("/*__ENGINE__*/", (here / "engine.js").read_text())
    page = page.replace("__DATA__", json.dumps(demo, separators=(",", ":")).replace("</", "<\\/"))
    (here / "index.html").write_text(page)
    shipped = sum(sum(s["dealer"][-52:]) + sum(s["export"][-52:]) + sum(s["project"][-52:]) for s in skus)
    print(f"{len(skus)} SKUs, {shipped:,} units shipped in the last 52 weeks, {len(sales):,} sales rows")
    print(f"Wrote {len(tables)} sample CSVs to {out} and the page to {here / 'index.html'} ({len(page) // 1024} KB)")


if __name__ == "__main__":
    main()
