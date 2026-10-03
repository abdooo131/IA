"""Synthetic Eve Chantelle store in Shopify bulk JSONL format.

Used for the demo command and the integration test. The data goes through the same loaders as a real sync.
It deliberately contains: cancellations, test and internal orders, returns, a bulk order spike, stockouts,
markdown episodes, a dead product, a duplicate SKU, a variant without SKU, negative stock, a deleted variant
on an old order, a missing unit cost and a variant with no inventory record.
"""
from __future__ import annotations

import datetime as dt
import json
import zlib
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from src.features.calendar import build_calendar

TZ = ZoneInfo("Africa/Cairo")

TYPES = {
    "Bra": {"sizes": ["32A", "32B", "34A", "34B", "34C", "36B", "36C", "38C"],
            "weights": [0.06, 0.1, 0.12, 0.2, 0.14, 0.18, 0.12, 0.08], "price": (450, 900), "code": "BRA"},
    "Panty": {"sizes": ["S", "M", "L", "XL"], "weights": [0.2, 0.35, 0.3, 0.15], "price": (150, 300), "code": "PNT"},
    "Bodysuit": {"sizes": ["S", "M", "L"], "weights": [0.3, 0.42, 0.28], "price": (600, 1100), "code": "BDY"},
    "Lingerie Set": {"sizes": ["S", "M", "L"], "weights": [0.3, 0.4, 0.3], "price": (700, 1300), "code": "SET"},
    "Robe": {"sizes": ["S", "M", "L"], "weights": [0.3, 0.4, 0.3], "price": (500, 900), "code": "ROB"},
}
COLORS = {"BLACK": 1.6, "NUDE": 1.2, "WHITE": 0.9, "RED": 0.7, "NAVY": 0.6}
COLOR_CODES = {"BLACK": "BLK", "NUDE": "NUD", "WHITE": "WHT", "RED": "RED", "NAVY": "NVY"}
COLLECTIONS = {"Bra": ["Everyday Essentials", "Lace Luxe"], "Panty": ["Everyday Essentials", "Lace Luxe"],
               "Bodysuit": ["Lace Luxe", "Bridal"], "Lingerie Set": ["Bridal", "Lace Luxe"], "Robe": ["Sleepwear", "Bridal"]}
EVENT_LIFT = {"ev_ramadan": 0.85, "ev_eid_fitr_pre": 1.8, "ev_eid_adha_pre": 1.4, "ev_white_friday": 2.2,
              "ev_valentines_pre": 1.5, "ev_mothers_day_pre": 1.3, "ev_eid_el_hob_pre": 1.2, "ev_wedding_season": 1.2}
DOW_LIFT = [0.95, 0.95, 1.0, 1.15, 1.2, 1.05, 0.85]  # Monday first. Thursday and Friday peak.
LEAD = {"Elassal": 21, "BOBO": 45}


def _gid(kind, n):
    return f"gid://shopify/{kind}/{n}"


def _money(x):
    return {"shopMoney": {"amount": f"{x:.2f}"}}


def _utc_iso(day: dt.date, minute_of_day: int) -> str:
    local = dt.datetime.combine(day, dt.time(0, 0), tzinfo=TZ) + dt.timedelta(minutes=int(minute_of_day))
    return local.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class _Ids:
    def __init__(self):
        self.n = 1000

    def next(self):
        self.n += 1
        return self.n


def generate(
    settings,
    out_dir: Path,
    start: dt.date = dt.date(2024, 7, 1),
    end: dt.date = dt.date(2026, 10, 2),
    n_products: int = 40,
    seed: int = 7,
    snapshot_days: int = 60,
) -> dict:
    rng = np.random.default_rng(seed)
    ids = _Ids()
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    sync_day = end + dt.timedelta(days=1)
    stamp = sync_day.strftime("%Y_%m_%d")

    # Catalog ---------------------------------------------------------------------------------------
    type_names = list(TYPES)
    products, variants = [], []
    for p in range(n_products):
        ptype = type_names[p % len(type_names)]
        spec = TYPES[ptype]
        vendor = "Elassal" if p % 3 else "BOBO"
        coll = COLLECTIONS[ptype][(p // len(type_names)) % 2]
        price = float(np.round(rng.uniform(*spec["price"]) / 10) * 10)
        launch = start if p < n_products * 0.8 else start + dt.timedelta(days=int(rng.integers(200, 760)))
        rate = float(rng.lognormal(mean=0.4, sigma=0.7))
        dead_from = end - dt.timedelta(days=150) if p == 5 else None
        if p == 5:
            rate = max(rate, 1.0)
        pid = ids.next()
        n_colors = 3 if p % 4 == 0 else 2
        colors = list(rng.choice(list(COLORS), size=n_colors, replace=False))
        if p % 2 == 0 and "BLACK" not in colors:
            colors[0] = "BLACK"
        products.append({"pid": pid, "title": f"{coll.split()[0]} {ptype} {p + 1:02d}", "type": ptype, "vendor": vendor,
                         "collection": coll, "price": price, "launch": launch, "rate": rate, "dead_from": dead_from,
                         "colors": colors})
        for c in colors:
            for s, w in zip(spec["sizes"], spec["weights"]):
                vid = ids.next()
                variants.append({
                    "vid": vid, "pid": pid, "item": ids.next(), "ptype": ptype, "vendor": vendor, "color": c,
                    "size": s, "price": price, "cost": round(price * float(rng.uniform(0.33, 0.45)), 2),
                    "sku": f"EC_{spec['code']}_{p + 1:03d}_{COLOR_CODES[c]}_{s}",
                    "share": w * COLORS[c] / sum(COLORS[x] for x in colors), "launch": launch,
                    "dead_from": dead_from, "rate": rate, "collection": coll, "abandoned": p == 7,
                })
    vdf = pd.DataFrame(variants)
    n_v = len(vdf)

    # Demand simulation -----------------------------------------------------------------------------
    cal = build_calendar(settings, start, end)
    days = list(cal["date"])
    n_d = len(days)
    season = np.ones(n_d)
    for col, lift in EVENT_LIFT.items():
        season *= np.where(cal[col].to_numpy() == 1, lift, 1.0)
    season *= np.array([DOW_LIFT[d] for d in cal["dow"]])
    season *= np.where(cal["payday"].to_numpy() == 1, 1.12, 1.0)
    trend = 1 + 0.15 * np.arange(n_d) / 365.0

    # Price path per product: White Friday 30 percent off, random markdown episodes, one price rise
    pidx = {p["pid"]: i for i, p in enumerate(products)}
    discount = np.zeros((len(products), n_d))
    wf = cal["ev_white_friday"].to_numpy() == 1
    discount[:, wf] = 0.30
    for i in range(len(products)):
        for _ in range(int(rng.integers(0, 3))):
            s0 = int(rng.integers(30, n_d - 30))
            discount[i, s0 : s0 + 14] = np.maximum(discount[i, s0 : s0 + 14], float(rng.choice([0.15, 0.2, 0.25])))
    price_mult = np.ones((len(products), n_d))
    price_mult[3, n_d // 2 :] = 1.10
    elasticity = -1.8
    lift_price = ((1 - discount) * price_mult) ** elasticity

    var_p = vdf["pid"].map(pidx).to_numpy()
    lam = (vdf["rate"].to_numpy() * vdf["share"].to_numpy())[:, None] * season[None, :] * trend[None, :]
    lam = lam * lift_price[var_p]
    bridal = (vdf["collection"] == "Bridal").to_numpy()
    lam[bridal] *= np.where(cal["ev_wedding_season"].to_numpy() == 1, 1.4, 1.0)[None, :]
    red = (vdf["color"] == "RED").to_numpy()
    lam[red] *= np.where(cal["ev_valentines_pre"].to_numpy() == 1, 2.0, 1.0)[None, :]
    day_ord = np.array([d.toordinal() for d in days])
    launch_ord = np.array([d.toordinal() for d in vdf["launch"]])
    lam[day_ord[None, :] < launch_ord[:, None]] = 0
    for i, df_ in enumerate(vdf["dead_from"]):
        if df_ is not None:
            lam[i, day_ord >= df_.toordinal()] = 0.0
    k = 2.0
    demand = rng.negative_binomial(k, k / (k + lam + 1e-12))

    # Inventory simulation with weekly review, some late or skipped orders to create stockouts
    stock = np.ceil(vdf["rate"].to_numpy() * vdf["share"].to_numpy() * 50 + 6).astype(int)
    stock[launch_ord > start.toordinal()] = 0
    pipeline: list[tuple[int, int, int]] = []  # (arrival day index, variant, qty)
    sales = np.zeros_like(demand)
    stock_eod = np.zeros_like(demand)
    incoming_eod = np.zeros_like(demand)
    base_rate = vdf["rate"].to_numpy() * vdf["share"].to_numpy()
    lead = vdf["vendor"].map(LEAD).to_numpy()
    for t in range(n_d):
        arrived = [p for p in pipeline if p[0] == t]
        for _, v, q in arrived:
            stock[v] += q
        pipeline = [p for p in pipeline if p[0] != t]
        launching = launch_ord == day_ord[t]
        stock[launching] += np.ceil(base_rate[launching] * 45 + 6).astype(int)
        s = np.minimum(demand[:, t], np.maximum(stock, 0))
        sales[:, t] = s
        stock -= s
        if t % 7 == 0:
            on_order = np.zeros(n_v, dtype=int)
            for _, v, q in pipeline:
                on_order[v] += q
            target = base_rate * (lead + 30) * trend[t] * 1.1
            need = target - stock - on_order
            for v in np.nonzero(need > base_rate * 14)[0]:
                dead_from_v = vdf["dead_from"].iat[v]
                if launch_ord[v] > day_ord[t] or (dead_from_v is not None and day_ord[t] >= dead_from_v.toordinal() - 60):
                    continue
                if vdf["abandoned"].iat[v] and t >= n_d - 200:
                    continue
                if rng.random() < 0.25:
                    continue  # skipped or late order, the cause of real stockouts
                q = int(np.ceil(need[v] / 6) * 6)
                pipeline.append((t + int(lead[v] + rng.integers(0, 10)), v, q))
        inc = np.zeros(n_v, dtype=int)
        for _, v, q in pipeline:
            inc[v] += q
        stock_eod[:, t] = stock
        incoming_eod[:, t] = inc

    # Orders ----------------------------------------------------------------------------------------
    order_rows: list[dict] = []
    line_rows: list[dict] = []
    order_no = [1000]

    def add_order(day_i, items, cancelled=False, test=False, tags=(), zero=False, unfulfilled=False):
        oid = ids.next()
        order_no[0] += 1
        day = days[day_i]
        minute = int(rng.integers(9 * 60, 23 * 60))
        ts = _utc_iso(day, minute)
        total, disc_total, lines = 0.0, 0.0, []
        for v, q in items:
            vr = vdf.iloc[v] if v is not None else None
            p_i = pidx[vr["pid"]] if vr is not None else 0
            orig = float(vr["price"] * price_mult[p_i, day_i]) if vr is not None else 400.0
            d = float(discount[p_i, day_i]) if vr is not None else 0.0
            unit = 0.0 if zero else round(orig * (1 - d), 2)
            total += unit * q
            disc_total += (orig - unit) * q
            lid = ids.next()
            lines.append({
                "id": _gid("LineItem", lid), "sku": vr["sku"] if vr is not None else "EC_OLD_DELETED_001",
                "quantity": int(q), "currentQuantity": 0 if cancelled else int(q),
                "unfulfilledQuantity": int(q) if unfulfilled and not cancelled else 0,
                "variant": {"id": _gid("ProductVariant", int(vr["vid"]))} if vr is not None else None,
                "product": {"id": _gid("Product", int(vr["pid"]))} if vr is not None else None,
                "originalUnitPriceSet": _money(orig), "discountedUnitPriceAfterAllDiscountsSet": _money(unit),
                "totalDiscountSet": _money((orig - unit) * q), "__parentId": _gid("Order", oid),
            })
        order = {
            "id": _gid("Order", oid), "name": f"#EC{order_no[0]}", "createdAt": ts, "processedAt": ts, "updatedAt": ts,
            "cancelledAt": _utc_iso(day, minute + 90) if cancelled else None,
            "cancelReason": rng.choice(["CUSTOMER", "INVENTORY", "DECLINED", "OTHER"]) if cancelled else None,
            "displayFinancialStatus": "VOIDED" if cancelled else "PAID",
            "displayFulfillmentStatus": "UNFULFILLED" if unfulfilled or cancelled else "FULFILLED",
            "sourceName": "web", "tags": list(tags), "discountCodes": [], "test": test,
            "totalDiscountsSet": _money(disc_total), "totalPriceSet": _money(total),
            "shippingAddress": {"city": "Cairo", "province": rng.choice(["Cairo", "Giza", "Alexandria"])},
            "customer": {"id": _gid("Customer", int(rng.integers(1, 20000)))}, "refunds": [],
        }
        order_rows.append(order)
        line_rows.extend(lines)
        return order, lines

    all_lines_for_returns = []
    for t in range(n_d):
        pool = []
        for v in np.nonzero(sales[:, t])[0]:
            q = int(sales[v, t])
            while q > 0:
                take = 2 if q >= 2 and rng.random() < 0.15 else 1
                pool.append((int(v), take))
                q -= take
        rng.shuffle(pool)
        unfulfilled = t >= n_d - 2
        i = 0
        while i < len(pool):
            size = int(rng.choice([1, 1, 1, 2, 2, 3]))
            order, lines = add_order(t, pool[i : i + size], unfulfilled=unfulfilled)
            all_lines_for_returns.append((t, order, lines))
            i += size
        # Cancelled orders do not consume stock and must never count as demand
        n_cancel = rng.binomial(max(len(pool), 1), 0.06)
        for _ in range(n_cancel):
            v = int(rng.integers(0, n_v))
            if launch_ord[v] <= day_ord[t]:
                add_order(t, [(v, 1)], cancelled=True)

    # Returns: about 4 percent of lines, refunded 7 to 14 days later
    for t, order, lines in all_lines_for_returns:
        for ln in lines:
            if rng.random() < 0.04 and t < n_d - 15:
                rday = days[t + int(rng.integers(7, 15))]
                unit = float(ln["discountedUnitPriceAfterAllDiscountsSet"]["shopMoney"]["amount"])
                order["refunds"].append({
                    "id": _gid("Refund", ids.next()), "createdAt": _utc_iso(rday, 600),
                    "refundLineItems": {"edges": [{"node": {
                        "quantity": 1, "restockType": "RETURN", "subtotalSet": _money(unit), "lineItem": {"id": ln["id"]}}}]},
                })
                ln["currentQuantity"] = ln["quantity"] - 1
                order["updatedAt"] = _utc_iso(rday, 600)

    top = int(np.argmax(sales.sum(axis=1)))
    spike_day = n_d - 40
    while cal["event_promo"].iat[spike_day] == 1:
        spike_day -= 1
    add_order(spike_day, [(top, 40)], tags=["wholesale"])  # bulk spike that must be capped
    for t in rng.integers(n_d - 300, n_d - 1, size=5):
        add_order(int(t), [(int(rng.integers(0, n_v)), 3)], test=True)
    for t in rng.integers(n_d - 300, n_d - 1, size=3):
        add_order(int(t), [(int(rng.integers(0, n_v)), 2)], tags=["internal"], zero=True)
    add_order(n_d - 500, [(None, 2)])  # old order whose variant was deleted

    # Planted catalog issues
    dup_v, nosku_v, neg_v, noinv_v, nocost_v = 1, 2, 3, 7, 9
    vdf.loc[dup_v, "sku"] = vdf.loc[0, "sku"]
    vdf.loc[nosku_v, "sku"] = None
    vdf.loc[nocost_v, "cost"] = None

    # Write JSONL -----------------------------------------------------------------------------------
    created_iso = _utc_iso(start - dt.timedelta(days=30), 600)
    loc_gid = _gid("Location", 1)
    with open(out_dir / f"products_{stamp}.jsonl", "w") as f:
        for p in products:
            f.write(json.dumps({
                "id": _gid("Product", p["pid"]), "title": p["title"], "productType": p["type"], "vendor": p["vendor"],
                "tags": [p["collection"].lower()], "status": "ACTIVE",
                "createdAt": _utc_iso(p["launch"], 300) if p["launch"] > start else created_iso,
                "publishedAt": _utc_iso(p["launch"], 300), "updatedAt": _utc_iso(end, 600)}) + "\n")
            for coll in (p["collection"], "All"):
                f.write(json.dumps({"id": _gid("Collection", zlib.crc32(coll.encode()) % 100000), "title": coll,
                                    "__parentId": _gid("Product", p["pid"])}) + "\n")
    with open(out_dir / f"variants_{stamp}.jsonl", "w") as f:
        for i, v in vdf.iterrows():
            p_i = pidx[v["pid"]]
            f.write(json.dumps({
                "id": _gid("ProductVariant", int(v["vid"])), "sku": v["sku"], "title": f"{v['color']} / {v['size']}",
                "barcode": None, "price": f"{v['price'] * price_mult[p_i, -1]:.2f}",
                "compareAtPrice": None, "inventoryPolicy": "DENY",
                "createdAt": _utc_iso(v["launch"], 300) if v["launch"] > start else created_iso,
                "updatedAt": _utc_iso(end, 600),
                "selectedOptions": [{"name": "Color", "value": v["color"].title()}, {"name": "Size", "value": v["size"]}],
                "product": {"id": _gid("Product", int(v["pid"]))},
                "inventoryItem": {"id": _gid("InventoryItem", int(v["item"])),
                                  "unitCost": {"amount": f"{v['cost']:.2f}"} if v["cost"] == v["cost"] and v["cost"] is not None else None}}) + "\n")
            if i == noinv_v:
                continue
            committed = int(sales[i, -2:].sum())
            available = int(stock_eod[i, -1]) if i != neg_v else -2
            f.write(json.dumps({
                "id": f"gid://shopify/InventoryLevel/{int(v['item'])}?inventory_item_id={int(v['item'])}",
                "location": {"id": loc_gid},
                "quantities": [{"name": "available", "quantity": available}, {"name": "committed", "quantity": committed},
                               {"name": "incoming", "quantity": int(incoming_eod[i, -1])},
                               {"name": "on_hand", "quantity": available + committed}],
                "__parentId": _gid("ProductVariant", int(v["vid"]))}) + "\n")
    with open(out_dir / f"orders_{stamp}.jsonl", "w") as f:
        for o in order_rows:
            f.write(json.dumps(o) + "\n")
        for ln in line_rows:
            f.write(json.dumps(ln) + "\n")

    # Snapshot history the system would have collected by syncing daily over the last snapshot_days
    snap_rows, price_rows = [], []
    for t in range(max(0, n_d - snapshot_days), n_d):
        for i, v in vdf.iterrows():
            if day_ord[t] < launch_ord[i] or i == noinv_v:
                continue
            p_i = pidx[v["pid"]]
            avail = int(stock_eod[i, t])
            committed = int(sales[i, max(0, t - 1) : t + 1].sum()) if t >= n_d - 2 else 0
            snap_rows.append({"date": days[t], "variant_id": str(int(v["vid"])), "location_id": "1",
                              "on_hand": avail + committed, "available": avail, "committed": committed,
                              "incoming": int(incoming_eod[i, t])})
            price_rows.append({"date": days[t], "variant_id": str(int(v["vid"])),
                               "price": round(v["price"] * price_mult[p_i, t], 2), "compare_at_price": None})
    truth = pd.DataFrame({
        "variant_id": vdf["vid"].astype(int).astype(str), "sku": vdf["sku"], "true_units": sales.sum(axis=1),
        "true_demand": demand.sum(axis=1), "stockout_days": ((stock_eod <= 0) & (day_ord[None, :] >= launch_ord[:, None])).sum(axis=1),
    })
    return {
        "dir": out_dir, "stamp": stamp, "sync_day": sync_day, "as_of": end,
        "locations": [{"id": loc_gid, "name": "Cairo Warehouse", "isActive": True}],
        "snapshots": pd.DataFrame(snap_rows), "prices": pd.DataFrame(price_rows), "truth": truth,
        "spike_variant": str(int(vdf["vid"].iat[top])), "spike_date": days[spike_day],
        "n_cancelled_orders": sum(1 for o in order_rows if o["cancelledAt"]),
    }


def load_into(con, settings, fixture: dict, run_id: str = "demo") -> dict:
    """Push the generated JSONL through the real loaders, then add the snapshot history."""
    from src import db
    from src.ingest import sync

    d, stamp = fixture["dir"], fixture["stamp"]
    pulled_at = pd.Timestamp(dt.datetime.combine(fixture["sync_day"], dt.time(4, 0)))
    summary = {"locations": sync.load_locations(con, fixture["locations"])}
    summary["products"] = sync.load_products(con, sync.read_jsonl(d / f"products_{stamp}.jsonl"))
    db.upsert(con, "fact_inventory_snapshot", fixture["snapshots"], ["date", "variant_id", "location_id"])
    db.upsert(con, "fact_price_history", fixture["prices"], ["date", "variant_id"])
    summary.update(sync.load_variants(con, sync.read_jsonl(d / f"variants_{stamp}.jsonl"), pulled_at, fixture["as_of"]))
    summary.update(sync.load_orders(con, sync.read_jsonl(d / f"orders_{stamp}.jsonl")))
    for entity in ("products", "variants", "orders"):
        sync.set_sync_state(con, entity, pulled_at, run_id)
    return summary
