"""Build the ASG Planning Desk page with demo data.

Generates synthetic raw tables for an Ahram Security Group catalog (Ahram, AFM and
Sicuro lines) at factory scale (about 10 million units a year): item list, sources,
two years of weekly sales, stockout days, stock on hand and cancelled orders.

It writes them as CSV files to sample-data/ (the same format the page's Data tab
accepts for real uploads) and builds index.html from template.html and engine.js
with the demo tables embedded. All forecasting runs in the page (engine.js), so the
demo and uploaded data go through exactly the same code.

Standard library only. Run:  python3 generate.py   then open index.html
Sales, stock, costs, capacities and lead times are synthetic. Model codes follow
ASG's public catalogue families; handle, hinge and smart lock codes are placeholders.
"""
import csv
import datetime as dt
import json
import math
import random
from collections import defaultdict
from pathlib import Path

SEED = 7
ASOF = dt.date(2026, 10, 2)
ANNUAL_UNITS = 10_000_000  # total units a year across the catalog
HIST_WEEKS = 105           # two years of weekly history

rnd = random.Random(SEED)

# Source: lead time days, carton size, minimum batch, weekly capacity share (None for bought in)
SOURCES = {
    "Factory 1, Locks": dict(lt=14, pack=50, moq=2000, kind="factory"),
    "Factory 2, Cylinders and Padlocks": dict(lt=10, pack=100, moq=3000, kind="factory"),
    "Factory 3, Hardware": dict(lt=12, pack=100, moq=3000, kind="factory"),
    "Sicuro import, Italy": dict(lt=75, pack=20, moq=500, kind="import"),
    "Smart lock OEM": dict(lt=60, pack=10, moq=200, kind="import"),
}

FINISH = {"SN": "Satin Nickel", "PB": "Polished Brass", "CP": "Chrome", "AB": "Antique Brass",
          "BK": "Matt Black", "BR": "Brass", "ST": "Hardened Steel", "SS": "Stainless"}

F1, F2, F3, SC, OEM = list(SOURCES)
# (code, name, product line, source, finishes, sizes, relative weekly volume, unit cost EGP, seasonal profile)
CATALOG = [
    ("MI-02", "Internal Lock MI-02 Room", "Internal mortise locks", F1, "SN PB AB", "40mm 45mm", 46, 185, "build"),
    ("MI-04", "Internal Lock MI-04 Bathroom", "Internal mortise locks", F1, "SN PB AB", "40mm 45mm", 30, 195, "build"),
    ("MI-06", "Internal Lock MI-06 Narrow Door", "Internal mortise locks", F1, "SN PB", "25mm 30mm", 12, 210, "build"),
    ("MI-07", "Internal Lock MI-07 French Type", "Internal mortise locks", F1, "SN PB", "40mm 45mm", 9, 230, "build"),
    ("MI-08", "Internal Lock MI-08 European Type", "Internal mortise locks", F1, "SN CP BK", "50mm 55mm", 18, 260, "build"),
    ("MI-14", "Internal Lock MI-14", "Internal mortise locks", F1, "SN PB", "40mm 45mm", 7, 220, "build"),
    ("MI-15", "Internal Lock MI-15", "Internal mortise locks", F1, "SN AB", "40mm 45mm", 6, 225, "build"),
    ("MI-16", "Internal Lock MI-16", "Internal mortise locks", F1, "SN BK", "50mm 55mm", 8, 270, "build"),
    ("ME-02", "External Lock ME-02 Deadbolt", "External mortise locks", F1, "SN PB", "85x45 85x50", 20, 340, "build"),
    ("ME-04", "External Lock ME-04", "External mortise locks", F1, "SN PB", "85x45 85x50", 11, 360, "build"),
    ("ME-06", "External Lock ME-06 Triple Square Deadbolt", "External mortise locks", F1, "SN PB AB", "85x45 85x50", 26, 420, "build"),
    ("ME-09", "External Lock ME-09", "External mortise locks", F1, "SN", "85x45 85x50", 7, 395, "build"),
    ("ME-12", "External Lock ME-12 Sliding Hook Bolt", "External mortise locks", F1, "SN", "85x30 85x35", 8, 380, "build"),
    ("ME-19", "External Lock ME-19", "External mortise locks", F1, "SN PB", "85x45 85x50", 10, 450, "build"),
    ("ME-23", "External Lock ME-23", "External mortise locks", F1, "SN BK", "85x45 85x50", 6, 470, "build"),
    ("RL-01", "Rim Lock RL-01", "Rim locks", F1, "SN PB", "60mm 80mm", 6, 310, "flat"),
    ("RL-02", "Rim Lock RL-02 Night Latch", "Rim locks", F1, "SN", "60mm", 4, 290, "flat"),
    ("AFM-ML", "AFM Mortise Lock 54mm Deadbolt, Cylinder, 5 Computer Keys", "AFM locks", F1, "SN PB", "85x45 85x50", 24, 365, "build"),
    ("AFM-MX", "AFM External Lock Case, no Cylinder", "AFM locks", F1, "SN", "85x45 85x50", 15, 240, "build"),
    ("CY-01", "Cylinder CY-01 Oval", "Cylinders", F2, "SN PB", "60mm 70mm", 22, 150, "flat"),
    ("CY-03", "Euro Cylinder CY-03 Key/Key", "Cylinders", F2, "SN PB CP", "60mm 70mm 80mm 90mm", 34, 210, "flat"),
    ("CY-07", "Euro Cylinder CY-07 Key/Knob", "Cylinders", F2, "SN PB", "60mm 70mm 80mm", 16, 245, "flat"),
    ("CY-14", "Euro Cylinder CY-14 Half", "Cylinders", F2, "SN", "40mm 45mm", 6, 160, "flat"),
    ("CY-18", "Euro Cylinder CY-18 High Security 6 Pin", "Cylinders", F2, "SN BK", "60mm 70mm 80mm", 11, 520, "flat"),
    ("CY-24", "Euro Cylinder CY-24 Anti Drill", "Cylinders", F2, "SN", "60mm 70mm 80mm", 7, 690, "flat"),
    ("CY-28", "Euro Cylinder CY-28 Computer Key", "Cylinders", F2, "SN PB", "60mm 70mm", 9, 330, "flat"),
    ("PL-B", "Brass Padlock", "Padlocks", F2, "BR", "30mm 40mm 50mm 60mm", 28, 95, "summer"),
    ("PL-S", "Steel Padlock Long Shackle", "Padlocks", F2, "ST", "40mm 50mm 60mm", 14, 130, "summer"),
    ("PL-D", "Disc Padlock", "Padlocks", F2, "SS", "70mm", 4, 210, "summer"),
    ("AFM-H", "AFM Lever Handle on Rose", "AFM handles", F3, "SN PB BK", "STD", 19, 210, "build"),
    ("AFM-HP", "AFM Lever Handle on Plate", "AFM handles", F3, "SN PB", "STD", 12, 240, "build"),
    ("HG-BB", "Ball Bearing Hinge", "Hinges", F3, "SN PB SS", "4in 5in", 60, 48, "build"),
    ("HG-FL", "Flag Hinge", "Hinges", F3, "SN", "100mm 120mm", 14, 36, "build"),
    ("SC-H01", "Sicuro Lever Handle H01", "Sicuro handles", SC, "SN CP BK", "STD", 11, 640, "build"),
    ("SC-H02", "Sicuro Lever Handle H02", "Sicuro handles", SC, "SN AB", "STD", 6, 780, "build"),
    ("SC-H03", "Sicuro Lever Handle H03 Modern", "Sicuro handles", SC, "CP BK", "STD", 8, 920, "build"),
    ("SC-PH", "Sicuro Pull Handle", "Sicuro handles", SC, "SS BK", "300mm 450mm 600mm", 4, 1150, "build"),
    ("DG-01", "Smart Lock DG-01 Fingerprint and Code", "Digital locks", OEM, "BK", "STD", 1.2, 5200, "flat"),
    ("DG-02", "Smart Lock DG-02 Card and App", "Digital locks", OEM, "BK SN", "STD", 0.8, 7400, "flat"),
]
# Retired variants that still sit in the warehouse (dead stock candidates)
RETIRED = {("MI-14", "PB"), ("RL-01", "PB"), ("ME-09", "SN")}
# Variants the plant stopped making for months while still on the price list
LONG_OUT = {("MI-15", "AB")}
MARGIN = 1.45  # dealer price = cost x 1.45


def week_start(i):
    """Monday of history week i (0 is oldest)."""
    last = ASOF - dt.timedelta(days=ASOF.weekday())
    return last - dt.timedelta(weeks=HIST_WEEKS - 1 - i)


def ramadan(d):
    return any(a <= d <= b for a, b in [(dt.date(2025, 3, 1), dt.date(2025, 3, 30)), (dt.date(2026, 2, 18), dt.date(2026, 3, 19)),
                                         (dt.date(2027, 2, 8), dt.date(2027, 3, 9))])


def season(profile, d):
    """Multiplier for a date. Building season peaks spring and autumn, Ramadan slows dealer orders."""
    doy = d.timetuple().tm_yday
    if profile == "build":
        m = 1 + 0.18 * math.cos(2 * math.pi * (doy - 100) / 182.5)
    elif profile == "summer":
        m = 1 + 0.25 * math.cos(2 * math.pi * (doy - 200) / 365)
    else:
        m = 1.0
    if ramadan(d):
        m *= 0.72
    if (d.month == 12 and d.day >= 20) or (d.month == 1 and d.day <= 3):
        m *= 1.15  # year end dealer stocking before the January price list
    return m


def mean(a):
    return sum(a) / len(a) if a else 0.0


def ceil_to(x, step):
    return int(math.ceil(x / step) * step)


# ---------------------------------------------------------------- catalog and history
def build_skus():
    skus, sid = [], 1000
    size_share = {1: [1], 2: [.6, .4], 3: [.45, .35, .2], 4: [.2, .4, .28, .12]}
    for code, name, line, src, fins, sizes, base, cost, prof in CATALOG:
        fins, sizes = fins.split(), sizes.split()
        fshare = [1.0, .55, .3][:len(fins)]
        fshare = [x / sum(fshare) for x in fshare]
        for fi, f in enumerate(fins):
            for zi, z in enumerate(sizes):
                sid += 1
                skus.append(dict(id=str(sid), sku=f"ASG-{code}-{f}-{z.upper()}", code=code, p=name, c=FINISH[f], z=z,
                                 line=line, src=src, rel=base * fshare[fi] * size_share[len(sizes)][zi] * rnd.uniform(.7, 1.3),
                                 prof=prof, cost=round(cost * rnd.uniform(.9, 1.1), 2), retired=(code, f) in RETIRED,
                                 long=(code, f) in LONG_OUT, trend=rnd.uniform(-.2, .3),
                                 noise=rnd.uniform(.12, .3) if base >= 5 else rnd.uniform(.3, .55)))
    scale = ANNUAL_UNITS / 52 / sum(s["rel"] for s in skus)
    for s in skus:
        s["rate"] = s["rel"] * scale
    return skus


def simulate(s):
    """True dealer demand, units shipped and short days per week under a lean make to stock rule."""
    src = SOURCES[s["src"]]
    lt_w = max(1, round(src["lt"] / 7))
    demand = []
    for i in range(HIST_WEEKS):
        lam = s["rate"] * season(s["prof"], week_start(i)) * (1 + s["trend"] * (i - HIST_WEEKS) / HIST_WEEKS)
        if s["retired"] and i > HIST_WEEKS - 32:
            lam = 0
        q = lam * math.exp(rnd.gauss(0, s["noise"]) - s["noise"] ** 2 / 2)
        if lam and rnd.random() < .06:
            q += lam * rnd.uniform(.8, 2.5)  # a project order from a big dealer or contractor
        demand.append(round(q))
    stock = round(s["rate"] * (lt_w + 3))
    pipeline = defaultdict(int)
    sold, short_days = [], []
    for i, q in enumerate(demand):
        stock += pipeline.pop(i, 0)
        dark = s["long"] and i > HIST_WEEKS - 30
        if dark:
            stock = 0
        sell = min(stock, q)
        out = max(1, min(7, round(7 * (1 - sell / q)))) if q > 0 and sell < q else 0
        stock -= sell
        sold.append(sell)
        short_days.append(out)
        on_order = sum(pipeline.values())
        trigger = s["rate"] * (lt_w + 1.5) * rnd.uniform(.85, 1.35)
        if not dark and not (s["retired"] and i > HIST_WEEKS - 45) and stock + on_order < trigger:
            qty = max(src["moq"], ceil_to(s["rate"] * (lt_w + 4), src["pack"]))
            slip = rnd.choice([0, 0, 0, 1, 1, 2]) if src["kind"] == "factory" else rnd.choice([0, 1, 2, 3])
            pipeline[i + lt_w + slip] += qty
    if s["retired"]:
        stock += round(s["rate"] * rnd.uniform(2, 4))  # last batch left on the shelf after the variant was dropped
    elif not s["long"] and rnd.random() < .08:
        stock += ceil_to(s["rate"] * rnd.uniform(16, 30), src["pack"])  # an oversized batch
    s["stock_end"] = stock
    s["incoming"] = sum(pipeline.values())
    s["long_out_days"] = 7 * sum(1 for x in sold[-30:] if x == 0) if s["long"] else 0
    return demand, sold, short_days


def main():
    skus = build_skus()
    for s in skus:
        s["dem"], s["sold"], s["sd"] = simulate(s)
    start = week_start(0)

    items, stock = [], []
    for s in skus:
        cost = None if rnd.random() < .015 else s["cost"]
        items.append(dict(sku=s["sku"], product=s["p"], model=s["code"], line=s["line"], finish=s["c"], size=s["z"],
                          source=s["src"], unit_cost=cost, price=round(s["cost"] * MARGIN, 2)))
        oh = s["stock_end"]
        if rnd.random() < .012:
            oh = -rnd.randint(20, 300)
        stock.append(dict(sku=s["sku"], on_hand=oh, committed=round(s["rate"] * rnd.choice([0, 0, .2, .4, .6])), incoming=s["incoming"]))

    sources = []
    for name, src in SOURCES.items():
        mine = [s for s in skus if s["src"] == name]
        cap = ceil_to(mean([sum(s["dem"][i] for s in mine) for i in range(HIST_WEEKS - 52, HIST_WEEKS)]) * 1.15, 1000) if src["kind"] == "factory" else ""
        sources.append(dict(source=name, type=src["kind"], lead_time_days=src["lt"], carton=src["pack"], min_batch=src["moq"],
                            weekly_capacity=cap, confirmed="no"))

    sales, stockouts = [], []
    for s in skus:
        for i in range(HIST_WEEKS):
            if s["sold"][i]:
                sales.append(dict(week_start=week_start(i).isoformat(), sku=s["sku"], qty=s["sold"][i], status="shipped", reason="", value=""))
            if s["sd"][i]:
                stockouts.append(dict(week_start=week_start(i).isoformat(), sku=s["sku"], days_out=s["sd"][i]))
    reasons = ["Dealer credit hold"] * 34 + ["Out of stock at dispatch"] * 27 + ["Dealer changed order"] * 24 + ["Duplicate order"] * 15
    for _ in range(1600):
        s = rnd.choice(skus)
        i = rnd.randrange(HIST_WEEKS)
        q = rnd.choice([200, 300, 500, 500, 1000, 2000])
        sales.append(dict(week_start=(week_start(i) + dt.timedelta(days=rnd.randrange(6))).isoformat(), sku=s["sku"], qty=q,
                          status="cancelled", reason=rnd.choice(reasons), value=round(q * s["cost"] * MARGIN)))

    here = Path(__file__).parent
    out = here / "sample-data"
    out.mkdir(exist_ok=True)
    for name, rows in [("items", items), ("sources", sources), ("sales", sales), ("stock", stock), ("stockouts", stockouts)]:
        with open(out / f"{name}.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)

    # columnar to keep the page small; the page turns it back into rows
    demo = {k: dict(cols=list(v[0]), rows=[list(r.values()) for r in v])
            for k, v in dict(items=items, sources=sources, sales=sales, stock=stock, stockouts=stockouts).items()}
    page = (here / "template.html").read_text()
    page = page.replace("/*__ENGINE__*/", (here / "engine.js").read_text())
    page = page.replace("__DATA__", json.dumps(demo, separators=(",", ":")).replace("</", "<\\/"))
    (here / "index.html").write_text(page)
    shipped = sum(sum(s["sold"][-52:]) for s in skus)
    print(f"{len(skus)} SKUs, {shipped:,} units shipped in the last 52 weeks")
    print(f"Wrote sample CSVs to {out} and the page to {here / 'index.html'}")


if __name__ == "__main__":
    main()
