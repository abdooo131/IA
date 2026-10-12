"""Build the ASG Planning Desk page.

Generates a synthetic two year weekly demand history for an Ahram Security Group
catalog (Ahram, AFM and Sicuro lines) at factory scale (about 10 million units a
year), adjusts it for stockouts, backtests several forecasting models per SKU,
forecasts 16 weeks ahead, works out reorder points and production orders, and
writes index.html from template.html.

Standard library only. Run:  python3 generate.py   then open index.html
Sales, stock, costs, capacities and lead times are synthetic. Model codes follow
ASG's public catalogue families; handle, hinge and smart lock codes are placeholders.
"""
import datetime as dt
import json
import math
import random
from collections import defaultdict
from pathlib import Path

SEED = 7
ASOF = dt.date(2026, 10, 2)
ANNUAL_UNITS = 10_000_000  # total units a year across the catalog
HIST_WEEKS = 105           # two years, the page shows the last 53
SHOW_WEEKS = 53
HORIZON = 16
FOLDS, FOLD_LEN = 4, 8     # backtest: 4 rolling folds of 8 weeks
REVIEW_DAYS = 7            # production plan is set every week

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


def std(a):
    m = mean(a)
    return math.sqrt(sum((x - m) ** 2 for x in a) / (len(a) - 1)) if len(a) > 1 else 0.0


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


def adjust(sold, short_days, long_out):
    """Demand after stockout adjustment: scale partial weeks, impute fully dark weeks from recent demand."""
    a = []
    for i, (u, sd) in enumerate(zip(sold, short_days)):
        if sd >= 7 or (sd and u == 0):
            a.append(u if long_out and i > HIST_WEEKS - 30 else mean(a[-8:]) if a else u)
        elif sd:
            a.append(u * 7 / (7 - sd))
        else:
            a.append(float(u))
    return a


# ---------------------------------------------------------------- models
def m_velocity(h, n, w):
    return [mean(h[-w:])] * n


def m_ses(h, n, alpha=.2):
    lvl = mean(h[:8])
    for x in h:
        lvl = alpha * x + (1 - alpha) * lvl
    return [lvl] * n


def m_croston(h, n, alpha=.15, sba=False):
    z = p = None
    gap = 1
    for x in h:
        if x > 0:
            z = x if z is None else alpha * x + (1 - alpha) * z
            p = gap if p is None else alpha * gap + (1 - alpha) * p
            gap = 1
        else:
            gap += 1
    if z is None:
        return [0.0] * n
    return [z / p * ((1 - alpha / 2) if sba else 1)] * n


def m_seasonal(h, n, idx_hist, idx_future):
    """SES on deseasonalized demand, then put the seasonal index back."""
    d = [x / max(i, .3) for x, i in zip(h, idx_hist)]
    return [m_ses(d, 1, .15)[0] * i for i in idx_future[:n]]


def m_share(h, n, line_fc, line_hist):
    share = sum(h[-26:]) / max(1e-9, sum(line_hist[-26:]))
    return [share * x for x in line_fc[:n]]


def classify(h):
    nz = [x for x in h if x > 0]
    if not nz:
        return "lumpy"
    adi = len(h) / len(nz)
    cv2 = (std(nz) / mean(nz)) ** 2 if len(nz) > 1 else 0
    if adi < 1.32:
        return "smooth" if cv2 < .49 else "erratic"
    return "intermittent" if cv2 < .49 else "lumpy"


# ---------------------------------------------------------------- main
def main():
    skus = build_skus()
    for s in skus:
        s["dem"], s["sold"], s["sd"] = simulate(s)
        s["adj"] = adjust(s["sold"], s["sd"], s["long"])

    lines = sorted({s["line"] for s in skus})
    line_hist = {l: [sum(s["adj"][i] for s in skus if s["line"] == l) for i in range(HIST_WEEKS)] for l in lines}
    prof_of = {s["line"]: s["prof"] for s in skus}
    hist_dates = [week_start(i) for i in range(HIST_WEEKS)]
    fut_dates = [hist_dates[-1] + dt.timedelta(weeks=k + 1) for k in range(HORIZON)]

    def idx(line, dates):
        return [season(prof_of[line], d) for d in dates]  # the planners' agreed seasonal calendar

    def forecasts(h, line, cut, n):
        hh = h[:cut]
        ih = idx(line, hist_dates[:cut])
        ifu = idx(line, hist_dates[cut:cut + n] if cut < HIST_WEEKS else fut_dates[:n])
        lh = line_hist[line][:cut]
        return {
            "velocity_30": m_velocity(hh, n, 4), "velocity_90": m_velocity(hh, n, 13), "ses": m_ses(hh, n),
            "croston": m_croston(hh, n), "sba": m_croston(hh, n, sba=True),
            "seasonal_ses": m_seasonal(hh, n, ih, ifu), "product_share": m_share(hh, n, m_seasonal(lh, n, ih, ifu), lh),
        }

    names = list(forecasts(skus[0]["adj"], skus[0]["line"], 60, 2))
    cuts = [HIST_WEEKS - FOLD_LEN * (k + 1) for k in range(FOLDS)][::-1]
    tot = defaultdict(lambda: [0.0, 0.0])
    hold = defaultdict(lambda: [0.0, 0.0])
    by_line = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])  # selected err, actual, baseline err, actual
    for s in skus:
        h, line = s["adj"], s["line"]
        errs = defaultdict(list)
        per_fold = []
        for c in cuts:
            fc = forecasts(h, line, c, FOLD_LEN)
            act = h[c:c + FOLD_LEN]
            per_fold.append((fc, act))
        def add_errs(m):
            errs[m] = [(sum(abs(a - f) for a, f in zip(act, fc[m])), sum(act)) for fc, act in per_fold]
        for m in names:
            add_errs(m)

        def score(m, folds):
            e = sum(errs[m][k][0] for k in folds); a = sum(errs[m][k][1] for k in folds)
            return e / a if a else (0 if e < .5 else 9)
        ens = sorted(names, key=lambda m: score(m, range(FOLDS)))[:3]
        for fc, _ in per_fold:
            fc["ensemble"] = [mean(v) for v in zip(*(fc[m] for m in ens))]
        add_errs("ensemble")
        allm = names + ["ensemble"]
        best = min(allm, key=lambda m: score(m, range(FOLDS)))
        best_old = min(allm, key=lambda m: score(m, range(FOLDS - 1)))
        s["model"], s["wape"] = best, round(min(score(best, range(FOLDS)), 5.0), 3)
        s["cls"] = classify(h[-52:])
        if not (s["retired"] or s["long"]):  # switched off demand says nothing about the models
            for m in ("velocity_30",):
                tot[m][0] += sum(e for e, _ in errs[m]); tot[m][1] += sum(a for _, a in errs[m])
            e = sum(x for x, _ in errs[best]); a = sum(y for _, y in errs[best])
            tot["selected"][0] += e; tot["selected"][1] += a
            hold["selected"][0] += errs[best_old][-1][0]; hold["selected"][1] += errs[best_old][-1][1]
            hold["velocity_30"][0] += errs["velocity_30"][-1][0]; hold["velocity_30"][1] += errs["velocity_30"][-1][1]
            b = by_line[line]; b[0] += e; b[1] += a
            b[2] += sum(x for x, _ in errs["velocity_30"]); b[3] += sum(y for _, y in errs["velocity_30"])
        res = [a_ - f_ for fc, act in per_fold for a_, f_ in zip(act, fc[best])]
        s["sigma"] = max(std(res), .05 * mean(h[-13:]))
        full = forecasts(h, line, HIST_WEEKS, HORIZON)
        full["ensemble"] = [mean(v) for v in zip(*(full[m] for m in ens))]
        fm = [0.0] * HORIZON if s["long"] or s["retired"] else [max(0.0, x) for x in full[best]]
        s["fm"] = fm
        s["fl"] = [max(0.0, x - 1.28 * s["sigma"]) for x in fm]
        s["fh"] = [x + 1.28 * s["sigma"] if x else 0.0 for x in fm]

    # ABC on 12 month value at cost, XYZ on weekly variability
    total = sum(sum(s["adj"][-52:]) * s["cost"] for s in skus)
    run = 0
    for s in sorted(skus, key=lambda s: -sum(s["adj"][-52:]) * s["cost"]):
        run += sum(s["adj"][-52:]) * s["cost"]
        s["abc"] = "A" if run <= .8 * total else "B" if run <= .95 * total else "C"
        h = s["adj"][-52:]
        cv = std(h) / mean(h) if mean(h) else 9
        s["xyz"] = "X" if cv < .25 else "Y" if cv < .5 else "Z"
    svc = {"AX": .97, "AY": .96, "AZ": .95, "BX": .95, "BY": .94, "BZ": .92, "CX": .92, "CY": .90, "CZ": .88}
    zval = {.97: 1.881, .96: 1.751, .95: 1.645, .94: 1.555, .92: 1.405, .90: 1.282, .88: 1.175}

    issues = []
    rows = []
    for s in skus:
        src = SOURCES[s["src"]]
        oh = s["stock_end"]
        cm = round(s["rate"] * rnd.choice([0, 0, .2, .4, .6]))  # dealer orders confirmed, not shipped
        if rnd.random() < .012:
            oh = -rnd.randint(20, 300)
            issues.append(dict(type="Negative stock", sku=s["sku"], id=s["id"], detail=f"ERP shows {oh:,} on hand. Shipments were booked before the production receipt.",
                               kind="process", sev="high"))
        inc = s["incoming"]
        wk = mean(s["fm"][:8])
        daily = wk / 7
        L = src["lt"] + REVIEW_DAYS
        level = svc[s["abc"] + s["xyz"]]
        ss = zval[level] * s["sigma"] * math.sqrt(L / 7)
        rop = round(daily * L + ss)
        target = round(daily * (L + 21) + ss)
        pos = max(oh, 0) - cm + inc
        sold13 = sum(s["sold"][-13:])
        dead = sold13 == 0 and oh > 0
        cost = s["cost"]
        if rnd.random() < .015:
            cost = None
            issues.append(dict(type="Unit cost missing", sku=s["sku"], id=s["id"], detail="No standard cost in the item master, so order value is left out.",
                               kind="data", sev="medium"))
        verb = "Make" if src["kind"] == "factory" else "Buy"
        if dead:
            q, status = 0, "dead"
            reason = f"Not planned. No sales in 13 weeks with {oh:,} pcs on hand. Discontinue or clear with a dealer offer."
        elif s["long"]:
            q, status = 0, "longout"
            reason = (f"Not planned. Out of stock for {s['long_out_days']} days while still on the dealer price list. "
                      "Demand is no longer imputed. Restart production or remove it from the price list.")
        elif not daily:
            q, status = 0, "ok"
            reason = "Not planned. No demand forecast for this SKU, it is retired or has stopped selling."
        else:
            head = (f"Stock position {pos:,} pcs (on hand {max(oh, 0):,}, committed {cm:,}, incoming {inc:,}) against reorder point {rop:,}. "
                    f"Reorder point is {L} days of demand ({daily * L:,.0f}) plus safety stock {ss:,.0f} for {round(level * 100)}% service ({s['abc']}{s['xyz']}).")
            if pos < rop:
                need = target - pos
                q = max(src["moq"], ceil_to(need, src["pack"]))
                status = "make"
                reason = (f"{head} {verb} up to {target:,} needs {need:,}, rounded to {q:,} "
                          f"(cartons of {src['pack']}, minimum batch {src['moq']:,}). Covers {(pos + q) / daily:.0f} days.")
            else:
                q, status = 0, "ok"
                reason = f"{head} Nothing to {verb.lower()} this week."
        free = max(oh, 0) - cm
        days_left = free / daily if daily else None
        if status in ("ok", "make") and daily and free > daily * 120:
            status = "over"
        conf = "high" if s["wape"] < .2 else "medium" if s["wape"] < .4 else "low"
        s.update(oh=oh, daily=daily, dead=dead, status=status, costv=cost, q=q, conf=conf)
        rows.append(dict(id=s["id"], sku=s["sku"], code=s["code"], p=s["p"], c=s["c"], z=s["z"], line=s["line"], src=s["src"],
                         oh=oh, cm=cm, inc=inc, wk=round(wk), rop=rop, tgt=target, pos=pos, q=q, cost=cost,
                         val=round(q * cost) if cost else None, sv=round(max(oh, 0) * (cost or 0)),
                         dl=round(days_left) if days_left is not None else None, abc=s["abc"], xyz=s["xyz"], cls=s["cls"],
                         model=s["model"], wape=s["wape"], conf=conf, status=status, reason=reason,
                         lt=src["lt"], pack=src["pack"], moq=src["moq"], svc=round(level * 100)))

    for s in rnd.sample(skus, 4):
        issues.append(dict(type="Missing barcode", sku=s["sku"], id=s["id"], detail="Variant has no barcode, so dealer scanning fails.", kind="data", sev="low"))
    for s in rnd.sample(skus, 3):
        issues.append(dict(type="Stock moved outside ERP", sku=s["sku"], id=s["id"],
                           detail=f"Transfer to the showroom recorded on paper. Counts differ by {rnd.randint(40, 600):,} pcs.", kind="process", sev="medium"))
    for name, src in SOURCES.items():
        issues.append(dict(type="Lead time not confirmed", sku=name, id=None,
                           detail=f"Using placeholder {src['lt']} days, cartons of {src['pack']}, minimum batch {src['moq']:,}.", kind="data", sev="medium"))

    # weekly capacity per factory: about 15 percent above average demand on that factory
    cap = {}
    for name, src in SOURCES.items():
        if src["kind"] == "factory":
            avg = mean([sum(s["adj"][i] for s in skus if s["src"] == name) for i in range(HIST_WEEKS - 52, HIST_WEEKS)])
            cap[name] = ceil_to(avg * 1.15, 1000)

    # dealer order cancellations
    avg_price = mean([s["cost"] * MARGIN for s in skus if s["daily"]])
    reasons = [("Dealer credit hold", .34), ("Out of stock at dispatch", .27), ("Dealer changed order", .24), ("Duplicate order", .15)]

    def cancels(days):
        n = round(days / 90 * 410 * rnd.uniform(.9, 1.1))
        units = sum(rnd.choice([200, 300, 500, 500, 1000, 2000]) for _ in range(n))
        return n, units, round(units * avg_price)
    c90, c365 = cancels(90), cancels(365)
    cancel = dict(win=[dict(w="Last 90 days", o=c90[0], u=c90[1], v=c90[2]), dict(w="Last 12 months", o=c365[0], u=c365[1], v=c365[2])],
                  why=[dict(r=k, o=round(c90[0] * v), v=round(c90[2] * v)) for k, v in reasons])

    # pricing suggestions
    md, mu = [], []
    for s in skus:
        if s["dead"] or s["long"] or not s["daily"]:
            continue
        cover = max(s["oh"], 0) / s["daily"]
        if cover > 120:
            pct = 5 if cover < 180 else 10 if cover < 260 else 15
            md.append(dict(id=s["id"], pct=pct, v=s["oh"] * s["cost"],
                           why=f"{max(s['oh'], 0):,} pcs on hand, selling {s['daily']:,.0f} a day, {cover:.0f} days of cover. "
                               f"A {pct}% dealer discount should clear the excess in about 60 days and stays above the margin floor."))
        out_weeks = sum(1 for x in s["sd"][-13:] if x)
        if out_weeks >= 2 and s["abc"] in "AB":
            pct = 3 if out_weeks < 4 else 5
            mu.append(dict(id=s["id"], pct=pct, v=s["daily"] * s["cost"],
                           why=f"Short in {out_weeks} of the last 13 weeks while demand holds at {s['daily']:,.0f} a day ({s['abc']} item). "
                               f"A {pct}% price list increase protects margin while supply catches up."))
    md = [{k: v for k, v in r.items() if k != "v"} for r in sorted(md, key=lambda r: -r["v"])[:30]]
    mu = [{k: v for k, v in r.items() if k != "v"} for r in sorted(mu, key=lambda r: -r["v"])[:30]]

    def w(x):
        return round(x[0] / x[1], 4) if x[1] else 0
    first = HIST_WEEKS - SHOW_WEEKS
    D = dict(
        asof=ASOF.isoformat(), annual=ANNUAL_UNITS,
        weeks=[week_start(i).isoformat() for i in range(first, HIST_WEEKS)],
        fweeks=[d.isoformat() for d in fut_dates],
        acc=dict(sel=w(tot["selected"]), base=w(tot["velocity_30"]), hsel=w(hold["selected"]), hbase=w(hold["velocity_30"]),
                 lines=[dict(line=k, sel=round(v[0] / v[1], 4), base=round(v[2] / v[3], 4)) for k, v in sorted(by_line.items()) if v[1]]),
        sources={k: dict(v, cap=cap.get(k)) for k, v in SOURCES.items()},
        skus=rows,
        H={s["id"]: [[round(x) for x in s["sold"][first:]], [round(x) for x in s["adj"][first:]], s["sd"][first:]] for s in skus},
        F={s["id"]: [[round(x) for x in s["fm"]], [round(x) for x in s["fl"]], [round(x) for x in s["fh"]]] for s in skus},
        issues=issues, cancel=cancel, md=md, mu=mu, margin=MARGIN,
    )
    here = Path(__file__).parent
    page = (here / "template.html").read_text().replace("__DATA__", json.dumps(D, separators=(",", ":")).replace("</", "<\\/"))
    (here / "index.html").write_text(page)
    yearly = sum(sum(s["sold"][-52:]) for s in skus)
    print(f"{len(rows)} SKUs, {yearly:,} units shipped last 52 weeks, {sum(1 for r in rows if r['q'])} to make or buy now")
    print(f"Forecast WAPE {w(tot['selected']):.3f} vs 30 day rate {w(tot['velocity_30']):.3f}")
    print(f"Wrote {here / 'index.html'}")


if __name__ == "__main__":
    main()
