"""Build the ASG Planning Desk page.

Generates a synthetic two year weekly demand history for an Ahram Security Group
catalog (Ahram, AFM and Sicuro lines), adjusts it for stockouts, backtests several
forecasting models per SKU, forecasts 16 weeks ahead, works out reorder points and
purchase orders, and writes index.html from template.html.

Standard library only. Run:  python3 generate.py   then open index.html
Sales, stock, costs, lead times and suppliers are synthetic. Model codes follow
ASG's public catalogue families; handle and smart lock codes are placeholders.
"""
import datetime as dt
import json
import math
import random
from collections import defaultdict
from pathlib import Path

SEED = 7
ASOF = dt.date(2026, 10, 2)
HIST_WEEKS = 105          # two years, the page shows the last 53
SHOW_WEEKS = 53
HORIZON = 16
FOLDS, FOLD_LEN = 4, 8    # backtest: 4 rolling folds of 8 weeks
REVIEW_DAYS = 14          # purchase orders placed every two weeks

rnd = random.Random(SEED)

# Supplier: (lead time days, carton size, minimum order), all placeholders until confirmed
SUPPLIERS = {
    "Ahram Factory, Cairo": (21, 10, 20),
    "AFM Plant": (28, 10, 20),
    "Sicuro import, Italy": (75, 6, 12),
    "Smart lock OEM": (60, 4, 8),
}

FINISH = {"SN": "SATIN NICKEL", "PB": "POLISHED BRASS", "CP": "CHROME", "AB": "ANTIQUE BRASS",
          "BK": "MATT BLACK", "BR": "BRASS", "ST": "HARDENED STEEL", "SS": "STAINLESS"}

# (code, name, product line, supplier, finishes, sizes, base weekly units, unit cost EGP, seasonal profile)
CATALOG = [
    ("MI-02", "Ahram Internal Lock MI-02 Room", "Internal mortise locks", "Ahram Factory, Cairo", "SN PB AB", "40mm 45mm", 46, 185, "build"),
    ("MI-04", "Ahram Internal Lock MI-04 Bathroom", "Internal mortise locks", "Ahram Factory, Cairo", "SN PB AB", "40mm 45mm", 30, 195, "build"),
    ("MI-06", "Ahram Internal Lock MI-06 Narrow Door", "Internal mortise locks", "Ahram Factory, Cairo", "SN PB", "25mm 30mm", 12, 210, "build"),
    ("MI-07", "Ahram Internal Lock MI-07 French Type", "Internal mortise locks", "Ahram Factory, Cairo", "SN PB", "40mm 45mm", 9, 230, "build"),
    ("MI-08", "Ahram Internal Lock MI-08 European Type", "Internal mortise locks", "Ahram Factory, Cairo", "SN CP BK", "50mm 55mm", 18, 260, "build"),
    ("MI-14", "Ahram Internal Lock MI-14", "Internal mortise locks", "Ahram Factory, Cairo", "SN PB", "40mm 45mm", 7, 220, "build"),
    ("ME-02", "Ahram External Lock ME-02 Deadbolt", "External mortise locks", "Ahram Factory, Cairo", "SN PB", "85x45 85x50", 20, 340, "build"),
    ("ME-06", "Ahram External Lock ME-06 Triple Square Deadbolt", "External mortise locks", "Ahram Factory, Cairo", "SN PB AB", "85x45 85x50", 26, 420, "build"),
    ("ME-12", "Ahram External Lock ME-12 Sliding Hook Bolt", "External mortise locks", "Ahram Factory, Cairo", "SN", "85x30 85x35", 8, 380, "build"),
    ("ME-19", "Ahram External Lock ME-19", "External mortise locks", "Ahram Factory, Cairo", "SN PB", "85x45 85x50", 10, 450, "build"),
    ("CY-01", "Ahram Cylinder CY-01 Oval", "Cylinders", "Ahram Factory, Cairo", "SN PB", "60mm 70mm", 22, 150, "flat"),
    ("CY-03", "Ahram Euro Cylinder CY-03 Key/Key", "Cylinders", "Ahram Factory, Cairo", "SN PB CP", "60mm 70mm 80mm 90mm", 34, 210, "flat"),
    ("CY-07", "Ahram Euro Cylinder CY-07 Key/Knob", "Cylinders", "Ahram Factory, Cairo", "SN PB", "60mm 70mm 80mm", 16, 245, "flat"),
    ("CY-18", "Ahram Euro Cylinder CY-18 High Security 6 Pin", "Cylinders", "Ahram Factory, Cairo", "SN BK", "60mm 70mm 80mm", 11, 520, "flat"),
    ("CY-24", "Ahram Euro Cylinder CY-24 Anti Drill", "Cylinders", "Ahram Factory, Cairo", "SN", "60mm 70mm 80mm", 7, 690, "flat"),
    ("PL-B", "Ahram Brass Padlock", "Padlocks", "Ahram Factory, Cairo", "BR", "30mm 40mm 50mm 60mm", 28, 95, "summer"),
    ("PL-S", "Ahram Steel Padlock Long Shackle", "Padlocks", "Ahram Factory, Cairo", "ST", "40mm 50mm 60mm", 14, 130, "summer"),
    ("RL-01", "Ahram Rim Lock RL-01", "Rim locks", "Ahram Factory, Cairo", "SN PB", "60mm 80mm", 6, 310, "flat"),
    ("AFM-ML", "AFM Mortise Lock 54mm Deadbolt with Cylinder, 5 Computer Keys", "AFM locks", "AFM Plant", "SN PB", "85x45 85x50", 24, 365, "build"),
    ("AFM-MX", "AFM External Lock Case, no Cylinder", "AFM locks", "AFM Plant", "SN", "85x45 85x50", 15, 240, "build"),
    ("AFM-H", "AFM Lever Handle on Rose", "AFM handles", "AFM Plant", "SN PB BK", "STD", 19, 210, "build"),
    ("SC-H01", "Sicuro Lever Handle H01", "Sicuro handles", "Sicuro import, Italy", "SN CP BK", "STD", 11, 640, "build"),
    ("SC-H02", "Sicuro Lever Handle H02", "Sicuro handles", "Sicuro import, Italy", "SN AB", "STD", 6, 780, "build"),
    ("SC-H03", "Sicuro Lever Handle H03 Modern", "Sicuro handles", "Sicuro import, Italy", "CP BK", "STD", 8, 920, "build"),
    ("SC-PH", "Sicuro Pull Handle", "Sicuro handles", "Sicuro import, Italy", "SS BK", "300mm 450mm 600mm", 4, 1150, "build"),
    ("HG-BB", "Ahram Ball Bearing Hinge", "Hinges", "Ahram Factory, Cairo", "SN PB SS", "4in 5in", 60, 48, "build"),
    ("DG-01", "Ahram Smart Lock DG-01 Fingerprint and Code", "Digital locks", "Smart lock OEM", "BK", "STD", 5, 5200, "flat"),
    ("DG-02", "Ahram Smart Lock DG-02 Card and App", "Digital locks", "Smart lock OEM", "BK SN", "STD", 3, 7400, "flat"),
]
# Retired lines that still sit in the warehouse (dead stock candidates)
RETIRED = {("MI-14", "PB"), ("RL-01", "PB")}


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
    if d.month == 12 and d.day >= 20 or d.month == 1 and d.day <= 3:
        m *= 1.15  # year end dealer stocking before the January price list
    return m


def poisson(lam):
    if lam <= 0:
        return 0
    if lam > 40:
        return max(0, round(rnd.gauss(lam, math.sqrt(lam))))
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rnd.random()
        if p <= L:
            return k
        k += 1


def mean(a):
    return sum(a) / len(a) if a else 0.0


def std(a):
    m = mean(a)
    return math.sqrt(sum((x - m) ** 2 for x in a) / (len(a) - 1)) if len(a) > 1 else 0.0


# ---------------------------------------------------------------- catalog and history
def build_skus():
    skus, sid = [], 1000
    size_share = {1: [1], 2: [.6, .4], 3: [.45, .35, .2], 4: [.2, .4, .28, .12]}
    for code, name, line, sup, fins, sizes, base, cost, prof in CATALOG:
        fins, sizes = fins.split(), sizes.split()
        fshare = [1.0, .55, .3][:len(fins)]
        fshare = [x / sum(fshare) for x in fshare]
        for fi, f in enumerate(fins):
            for zi, z in enumerate(sizes):
                sid += 2
                rate = base * fshare[fi] * size_share[len(sizes)][zi]
                # lumpy dealer orders: some SKUs are ordered in bursts
                burst = rnd.random() < (0.5 if rate < 4 else 0.2)
                skus.append(dict(id=str(sid), sku=f"ASG-{code}-{f}-{z.upper()}", code=code, p=name, c=FINISH[f], fc=f, z=z,
                                 col=line, sup=sup, rate=rate * rnd.uniform(.7, 1.3), burst=burst, prof=prof,
                                 cost=round(cost * rnd.uniform(.9, 1.1), 2), retired=(code, f) in RETIRED,
                                 trend=rnd.uniform(-.25, .35)))
    return skus


def simulate(s):
    """True demand, units sold and stockout days per week, with a simple (s, S) stock policy."""
    lt_days, pack, moq = SUPPLIERS[s["sup"]]
    lt_w = max(1, round(lt_days / 7))
    demand = []
    for i in range(HIST_WEEKS):
        d = week_start(i)
        lam = s["rate"] * season(s["prof"], d) * (1 + s["trend"] * i / HIST_WEEKS)
        if s["retired"] and i > HIST_WEEKS - 30:
            lam = 0
        if s["burst"]:
            q = poisson(lam * 2) if rnd.random() < 1 / 2 else 0
        else:
            q = poisson(lam)
        demand.append(q)
    # stock policy that sometimes runs dry (planner was using a simple rule)
    stock = round(s["rate"] * 6) + pack
    pipeline = defaultdict(int)
    sold, short_days = [], []
    long_out = rnd.random() < 0.02 and not s["retired"]
    for i, q in enumerate(demand):
        stock += pipeline.pop(i, 0)
        if long_out and i > HIST_WEEKS - 26:
            stock = 0
        sell = min(stock, q)
        out = 0
        if q > 0 and sell < q:
            out = max(1, min(7, round(7 * (1 - sell / q))))
        stock -= sell
        sold.append(sell)
        short_days.append(out)
        on_order = sum(pipeline.values())
        trigger = s["rate"] * (lt_w + 2) * rnd.uniform(.8, 1.4)
        if not (long_out and i > HIST_WEEKS - 26) and not (s["retired"] and i > HIST_WEEKS - 40) and stock + on_order < trigger:
            qty = max(moq, math.ceil(s["rate"] * (lt_w + 6) / pack) * pack)
            pipeline[i + lt_w + rnd.choice([0, 0, 1, 2])] += qty
    s["stock_end"] = stock
    s["incoming"] = sum(v for k, v in pipeline.items())
    s["long_out_days"] = sum(1 for x in sold[-26:] if x == 0) * 7 if long_out else 0
    return demand, sold, short_days


def adjust(sold, short_days, long_out):
    """Demand after stockout adjustment: scale partial weeks, impute fully dark weeks from recent demand."""
    a = []
    for i, (u, sd) in enumerate(zip(sold, short_days)):
        if sd >= 7 or (sd and u == 0):
            prev = [x for x in a[-8:] if x is not None]
            a.append(mean(prev) if prev and not (long_out and i > HIST_WEEKS - 26) else u)
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
    f = z / p * ((1 - alpha / 2) if sba else 1)
    return [f] * n


def m_tsb(h, n, a=.15, b=.1):
    z = mean([x for x in h if x > 0]) if any(h) else 0
    pr = mean([1 if x > 0 else 0 for x in h[:12]])
    for x in h:
        pr = b * (1 if x > 0 else 0) + (1 - b) * pr
        if x > 0:
            z = a * x + (1 - a) * z
    return [z * pr] * n


def m_seasonal(h, n, idx_hist, idx_future):
    """SES on deseasonalized demand, then put the line's seasonal index back."""
    d = [x / max(i, .3) for x, i in zip(h, idx_hist)]
    lvl = m_ses(d, 1, .15)[0]
    return [lvl * i for i in idx_future[:n]]


def m_share(h, n, line_fc, line_hist):
    share = sum(h[-26:]) / max(1e-9, sum(line_hist[-26:]))
    return [share * x for x in line_fc[:n]]


def wape(actual, fc):
    den = sum(actual)
    return sum(abs(a - f) for a, f in zip(actual, fc)) / den if den else (0.0 if sum(fc) < .5 else 5.0)


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
        s["long"] = s["long_out_days"] > 150
        s["adj"] = adjust(s["sold"], s["sd"], s["long"])

    # seasonal index per product line from the adjusted line totals, two years averaged by week of year
    lines = sorted({s["col"] for s in skus})
    line_hist = {l: [sum(s["adj"][i] for s in skus if s["col"] == l) for i in range(HIST_WEEKS)] for l in lines}
    prof_of = {s["col"]: s["prof"] for s in skus}
    fut_dates = [week_start(HIST_WEEKS - 1) + dt.timedelta(weeks=k + 1) for k in range(HORIZON)]

    def idx(line, dates):
        return [season(prof_of[line], d) for d in dates]  # the planner's agreed seasonal calendar
    hist_dates = [week_start(i) for i in range(HIST_WEEKS)]

    def forecasts(h, line, cut, n):
        """All candidate model forecasts using history up to week index cut."""
        hh = h[:cut]
        ih, ifu = idx(line, hist_dates[:cut]), idx(line, hist_dates[cut:cut + n] if cut < HIST_WEEKS else fut_dates[:n])
        lh = line_hist[line][:cut]
        lfc = m_seasonal(lh, n, ih, ifu)
        return {
            "velocity_30": m_velocity(hh, n, 4), "velocity_90": m_velocity(hh, n, 13), "ses": m_ses(hh, n),
            "croston": m_croston(hh, n), "sba": m_croston(hh, n, sba=True), "tsb": m_tsb(hh, n),
            "seasonal_ses": m_seasonal(hh, n, ih, ifu), "product_share": m_share(hh, n, lfc, lh),
        }

    names = list(forecasts(skus[0]["adj"], skus[0]["col"], 60, 2))
    cuts = [HIST_WEEKS - FOLD_LEN * (k + 1) for k in range(FOLDS)][::-1]
    tot = defaultdict(lambda: [0.0, 0.0])          # model -> [abs err, actual] over all folds
    hold = defaultdict(lambda: [0.0, 0.0])         # latest fold, model chosen on older folds
    cls_tot = defaultdict(lambda: [0.0, 0.0, 0])
    scored = 0
    for s in skus:
        h, line = s["adj"], s["col"]
        errs = defaultdict(list)
        per_fold = []
        for c in cuts:
            fc = forecasts(h, line, c, FOLD_LEN)
            act = h[c:c + FOLD_LEN]
            per_fold.append((fc, act))
            for m in names:
                errs[m].append((sum(abs(a - f) for a, f in zip(act, fc[m])), sum(act)))
        def score(m, folds):
            e = sum(errs[m][k][0] for k in folds); a = sum(errs[m][k][1] for k in folds)
            return e / a if a else (0 if e < .5 else 9)
        # selected model plus a simple average of the best three ("ensemble")
        ranked = sorted(names, key=lambda m: score(m, range(FOLDS)))
        ens = ranked[:3]
        for k, (fc, act) in enumerate(per_fold):
            fc["ensemble"] = [mean(v) for v in zip(*(fc[m] for m in ens))]
            errs["ensemble"].append((sum(abs(a - f) for a, f in zip(act, fc["ensemble"])), sum(act)))
        allm = names + ["ensemble"]
        best = min(allm, key=lambda m: score(m, range(FOLDS)))
        best_old = min(allm, key=lambda m: score(m, range(FOLDS - 1)))
        s["model"], s["wape"] = best, round(min(score(best, range(FOLDS)), 5.0), 2)
        s["cls"] = classify(h[-52:])
        # retired and long out SKUs had demand switched off, so they say nothing about model accuracy
        if not (s["retired"] or s["long"]):
            for m in allm:
                tot[m][0] += sum(e for e, _ in errs[m]); tot[m][1] += sum(a for _, a in errs[m])
            hold["selected"][0] += errs[best_old][-1][0]; hold["selected"][1] += errs[best_old][-1][1]
            hold["velocity_30"][0] += errs["velocity_30"][-1][0]; hold["velocity_30"][1] += errs["velocity_30"][-1][1]
            e = sum(x for x, _ in errs[best]); a = sum(y for _, y in errs[best])
            tot["selected"][0] += e; tot["selected"][1] += a
            scored += 1
            cls_tot[s["cls"]][0] += e; cls_tot[s["cls"]][1] += a; cls_tot[s["cls"]][2] += 1
        # residual spread for the p10/p90 band, from the chosen model's backtest errors
        res = [a_ - f_ for fc, act in per_fold for a_, f_ in zip(act, fc[best])]
        s["sigma"] = max(std(res), math.sqrt(max(mean(h[-13:]), .05)))
        full = forecasts(h, line, HIST_WEEKS, HORIZON)
        full["ensemble"] = [mean(v) for v in zip(*(full[m] for m in ens))]
        fm = [max(0.0, x) for x in full[best]]
        if s["long"] or s["retired"]:
            fm = [0.0] * HORIZON
        s["fm"] = fm
        s["fl"] = [max(0.0, x - 1.28 * s["sigma"]) for x in fm]
        s["fh"] = [x + 1.28 * s["sigma"] if not (s["long"] or s["retired"]) else 0.0 for x in fm]

    # ABC on 12 month revenue at cost, XYZ on weekly variability
    rev = sorted(skus, key=lambda s: -sum(s["adj"][-52:]) * s["cost"])
    total = sum(sum(s["adj"][-52:]) * s["cost"] for s in skus)
    run = 0
    for s in rev:
        run += sum(s["adj"][-52:]) * s["cost"]
        s["abc"] = "A" if run <= .8 * total else "B" if run <= .95 * total else "C"
        h = s["adj"][-52:]
        cv = std(h) / mean(h) if mean(h) else 9
        s["xyz"] = "X" if cv < .5 else "Y" if cv < 1 else "Z"
    svc = {"AX": .95, "AY": .95, "AZ": .93, "BX": .90, "BY": .90, "BZ": .88, "CX": .85, "CY": .85, "CZ": .80}
    zval = {.95: 1.645, .93: 1.476, .90: 1.282, .88: 1.175, .85: 1.036, .80: .842}

    # replenishment
    rows = []
    issue_rows = []
    for s in skus:
        lt, pack, moq = SUPPLIERS[s["sup"]]
        oh = s["stock_end"]
        cm = rnd.choice([0] * 6 + [pack // 2, pack])
        if rnd.random() < .015:
            oh = -rnd.randint(1, 4)
            issue_rows.append(dict(type="negative stock", sku=s["sku"], detail=f"On hand {oh} in the ERP", problem_kind="process problem", severity="high"))
        inc = s["incoming"]
        daily = mean(s["fm"][:8]) / 7
        sd_daily = s["sigma"] / math.sqrt(7)
        L = lt + REVIEW_DAYS
        level = svc[s["abc"] + s["xyz"]]
        ss = zval[level] * sd_daily * math.sqrt(L)
        rop = round(daily * L + ss)
        target = round(daily * (L + 30) + ss)
        pos = max(oh, 0) - cm + inc
        f30 = round(daily, 2)
        sold90 = sum(s["sold"][-13:])
        dead = sold90 == 0 and oh > 0 and not s["long"]
        cost = s["cost"]
        if rnd.random() < .02:
            cost = None
            issue_rows.append(dict(type="unit cost missing", sku=s["sku"], detail="No standard cost in the item master; PO value excluded", problem_kind="data problem", severity="medium"))
        if dead:
            q, reason = 0, f"Not ordered: dead stock, 0 units sold in 90 days with {oh} on hand"
        elif s["long"]:
            q, reason = 0, (f"Not ordered: out of stock for {s['long_out_days']} days while still active in the price list. "
                            "Demand is no longer imputed. Confirm restock or discontinue the SKU")
        else:
            head = (f"Position {pos} (on hand {max(oh,0)}, committed {cm}, incoming {inc}) vs reorder point {rop}: lead time plus review "
                    f"{L} days demand {daily*L:.1f} plus safety stock {ss:.1f} at {round(level*100)} percent service ({s['abc']}{s['xyz']}).")
            if pos < rop:
                need = target - pos
                q = max(moq, math.ceil(need / pack) * pack)
                days = (pos + q) / daily if daily else 0
                reason = f"{head} Order up to target {target} needs {need}, rounded to {q} (carton {pack}, MOQ {moq}). Buys {days:.0f} days of cover."
            else:
                q, reason = 0, f"{head} No order needed."
        conf = "high" if s["wape"] < .35 else "medium" if s["wape"] < .8 else "low"
        s.update(oh=oh, cm=cm, inc=inc, rop=rop, pos=pos, q=q, f30=f30, daily=daily, dead=dead, conf=conf, cost_v=cost)
        rows.append(dict(id=s["id"], sku=s["sku"], p=s["p"], c=s["c"], z=s["z"], col=s["col"], sup=s["sup"], oh=oh, inc=inc, cm=cm,
                         f30=f30, q=q, cost=cost, lt=round(q * cost) if cost else None, abc=s["abc"], xyz=s["xyz"], conf=conf,
                         model=s["model"], cls=s["cls"], wape=s["wape"], reason=reason,
                         flags=f"{s['sup']} lead time and MOQ not confirmed" + ("; unit cost missing" if cost is None else ""),
                         rop=float(rop), pos=float(pos), sv=float(round(max(oh, 0) * (cost or 0))), dead=dead, longout=s["long"]))

    # data issues: duplicate SKU codes and missing barcodes, as an ERP would have
    for s in rnd.sample(skus, 4):
        issue_rows.append(dict(type="missing barcode", sku=s["sku"], detail="Variant has no barcode; dealer scanning fails", problem_kind="data problem", severity="low"))
    for s in rnd.sample(skus, 3):
        issue_rows.append(dict(type="stock moved outside ERP", sku=s["sku"], detail="Showroom transfer recorded on paper, counts differ by "
                               f"{rnd.randint(2, 12)} units", problem_kind="process problem", severity="medium"))
    for sup in SUPPLIERS:
        issue_rows.append(dict(type="lead time unconfirmed", sku="all " + sup, detail=f"Using placeholder {SUPPLIERS[sup][0]} days, carton {SUPPLIERS[sup][1]}, MOQ {SUPPLIERS[sup][2]}",
                               problem_kind="data problem", severity="medium"))

    # running out soon
    low = []
    for s in skus:
        if s["daily"] > 0 and not s["dead"] and not s["long"]:
            d = max(s["oh"] - s["cm"], 0) / s["daily"]
            if d <= 14:
                low.append(dict(sku=s["sku"], p=s["p"], c=s["c"], z=s["z"], d=round(d), rr=round(s["daily"] * (s["cost"] * 1.45)),
                                q=s["q"], a=f"Reorder {s['q']} from {s['sup']}" if s["q"] else "Incoming covers it, chase delivery"))
    low.sort(key=lambda r: -r["rr"])
    dead = [dict(sku=s["sku"], p=s["p"], c=s["c"], z=s["z"], oh=s["oh"], v=round(s["oh"] * s["cost"]),
                 ds=7 * next((k for k, x in enumerate(reversed(s["sold"])) if x > 0), HIST_WEEKS)) for s in skus if s["dead"]]
    over = defaultdict(lambda: dict(n=0, u=0, v=0.0))
    for s in skus:
        ex = max(s["oh"], 0) - round(s["daily"] * 120)
        if ex > 0 and not s["dead"]:
            o = over[s["col"]]; o["n"] += 1; o["u"] += ex; o["v"] += ex * s["cost"]
    over = sorted([dict(col=k, n=v["n"], u=v["u"], v=round(v["v"])) for k, v in over.items()], key=lambda r: -r["v"])

    # dealer order cancellations
    price = {s["sku"]: s["cost"] * 1.45 for s in skus}
    reasons = {"Dealer credit hold": .34, "Out of stock at dispatch": .27, "Dealer changed order": .24, "Duplicate order": .15}
    def cancels(days):
        n = round(days / 90 * 64 * rnd.uniform(.9, 1.1))
        units = sum(rnd.choice([10, 10, 20, 20, 30, 50]) for _ in range(n))
        return n, units, round(units * mean(list(price.values())) * .6)
    c90, c365 = cancels(90), cancels(365)
    ct = [dict(Window="last 90 days", Orders=c90[0], Units=c90[1], Value=c90[2]), dict(Window="last 12 months", Orders=c365[0], Units=c365[1], Value=c365[2])]
    cr = [dict(Reason=k, Orders=round(c90[0] * v), Value=round(c90[2] * v)) for k, v in reasons.items()]

    # pricing suggestions
    md, mu = [], []
    for s in skus:
        if s["dead"] or s["long"] or not s["daily"]:
            continue
        cover = max(s["oh"], 0) / s["daily"]
        if cover > 150:
            pct = 5 if cover < 200 else 10 if cover < 300 else 15
            md.append(dict(type="markdown", sku=s["sku"], p=s["p"], c=s["c"], z=s["z"], pct=float(pct), conf=s["conf"], v=s["oh"] * s["cost"],
                           reason=f"What changed: {s['oh']} units on the shelf, selling {s['daily']:.2f} per day, {cover:.0f} days of cover. "
                                  f"Dealer discount of {pct} percent should clear the excess in about 60 days and stays above the margin floor."))
        out_weeks = sum(1 for x in s["sd"][-13:] if x)
        if out_weeks >= 3 and s["abc"] in "AB":
            pct = 3 if out_weeks < 6 else 5
            mu.append(dict(type="markup", sku=s["sku"], p=s["p"], c=s["c"], z=s["z"], pct=float(pct), conf=s["conf"], v=s["daily"],
                           reason=f"What changed: short in {out_weeks} of the last 13 weeks while demand stays strong ({s['abc']} item, "
                                  f"{s['daily']:.2f} units per day forecast). A {pct} percent price list increase protects margin while supply catches up."))
    md = sorted(md, key=lambda r: -r.pop("v"))[:30]
    mu = sorted(mu, key=lambda r: -r.pop("v"))[:30]

    first = HIST_WEEKS - SHOW_WEEKS
    weeks = [week_start(i).strftime("%d %b %y") for i in range(first, HIST_WEEKS)]
    fweeks = [d.strftime("%d %b %y") for d in fut_dates]
    ftot = [round(sum(s["fm"][k] for s in skus)) for k in range(HORIZON)]
    peak = max(range(HORIZON), key=lambda k: ftot[k])
    mix = defaultdict(int)
    for s in skus:
        mix[s["model"]] += 1

    def w(x):
        return round(x[0] / x[1], 4) if x[1] else 0
    acc = [dict(scope="catalog all folds", model="selected", wape=w(tot["selected"]), skus=scored),
           dict(scope="catalog all folds", model="velocity_30", wape=w(tot["velocity_30"]), skus=scored),
           dict(scope="latest fold holdout", model="selected", wape=w(hold["selected"]), skus=scored),
           dict(scope="latest fold holdout", model="velocity_30", wape=w(hold["velocity_30"]), skus=scored)]
    acc += [dict(scope=f"class {k}", model="selected", wape=w(v), skus=v[2]) for k, v in sorted(cls_tot.items())]

    D = dict(
        asof=ASOF.strftime("%d %b %Y"), weeks=weeks, fweeks=fweeks, ftot=ftot, acc=acc, skus=rows,
        H={s["id"]: dict(o=[float(x) for x in s["sold"][first:]], a=[round(x, 1) for x in s["adj"][first:]], s=s["sd"][first:]) for s in skus},
        F={s["id"]: dict(m=[round(x, 1) for x in s["fm"]], l=[round(x, 1) for x in s["fl"]], h=[round(x, 1) for x in s["fh"]]) for s in skus},
        low=low[:40], dead=dead, over=over, disc=issue_rows, ct=ct, cr=cr, md=md, mu=mu,
        mix=dict(sorted(mix.items(), key=lambda kv: -kv[1])),
        ltnote="Lead times are placeholders until confirmed: " + ", ".join(f"{k} {v[0]} days, carton {v[1]}" for k, v in SUPPLIERS.items()) + ".",
        peaknote=(f"Highest week is {fweeks[peak]} at {ftot[peak]:,} units. Demand eases from the autumn building season toward January; "
                  "the late December bump is dealers stocking up before the January price list."),
    )
    here = Path(__file__).parent
    page = (here / "template.html").read_text().replace("__DATA__", json.dumps(D, separators=(",", ":")).replace("</", "<\\/"))
    (here / "index.html").write_text(page)
    print(f"{len(rows)} SKUs, {sum(1 for r in rows if r['q'])} to reorder, forecast WAPE {w(tot['selected']):.3f} vs 30 day rate {w(tot['velocity_30']):.3f}")
    print(f"Wrote {here / 'index.html'}")


if __name__ == "__main__":
    main()
