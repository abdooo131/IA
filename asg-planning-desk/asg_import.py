"""Convert ASG's challenge workbook into Planning Desk demo data.

Reads ASG_Historical_Demand_Data.xlsx (monthly units by SKU, channel and year, 2023 to
September 2026; dummy figures with ASG's real data structure) and writes
asg-data/asg_demo.json, which generate.py embeds in index.html next to the synthetic demo.
Also writes asg-data/items.csv and asg-data/stock.csv for reference.

The workbook has no stock, prices, product names or factories, so:
  items   product name is family plus SKU code; factory is set from the family
  stock   estimated from the last three months of demand, seeded, labelled as an estimate
  sales   kept monthly in the JSON; the page splits each month across its weeks by day

Standard library only. Run:  python3 asg_import.py path/to/ASG_Historical_Demand_Data.xlsx
"""
import csv
import json
import random
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
START_YEAR, LAST_YEAR, LAST_MONTH = 2023, 2026, 9
MONTHS = (LAST_YEAR - START_YEAR) * 12 + LAST_MONTH
CHANNEL = {"National Distribution": "dealer", "National B2B": "project", "Export": "export"}
FACTORY = {"Door Locks": "Factory 1, Locks", "Smart Locks": "Factory 1, Locks", "Spare Parts & Kits": "Factory 1, Locks",
           "Padlocks": "Factory 2, Cylinders and Padlocks"}
SOURCES = [("Factory 1, Locks", 14, 50, 2000, "yes"), ("Factory 2, Cylinders and Padlocks", 10, 100, 3000, "no"),
           ("Factory 3, Hardware", 12, 100, 3000, "no")]


def read_sheet(path, name):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    sheet = next(s for s in wb.find("m:sheets", NS) if s.get("name") == name)
    target = rels[sheet.get("{%s}id" % NS["r"])].lstrip("/")
    target = target if target.startswith("xl/") else "xl/" + target
    rows = []
    for row in ET.fromstring(z.read(target)).find("m:sheetData", NS):
        vals = {}
        for c in row:
            ref, t, v = c.get("r"), c.get("t"), c.find("m:v", NS)
            col = 0
            for ch in ref:
                if ch.isalpha():
                    col = col * 26 + ord(ch) - 64
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr":
                val = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            elif v is not None:
                f = float(v.text)
                val = int(f) if f.is_integer() else f
            else:
                val = None
            vals[col - 1] = val
        rows.append([vals.get(i) for i in range(max(vals) + 1)] if vals else [])
    return rows


def main(path):
    rows = read_sheet(path, "Sales data")
    head = rows[0]
    ix = {h: i for i, h in enumerate(head)}
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    fam, series, year_tot = {}, defaultdict(lambda: [0] * MONTHS), defaultdict(int)
    for r in rows[1:]:
        if not r or r[ix["SKU ID"]] is None:
            continue
        sku, y, ch = r[ix["SKU ID"]], int(r[ix["Year"]]), CHANNEL[r[ix["Market"]]]
        fam[sku] = r[ix["Family"]]
        s = series[(sku, ch)]
        for m, name in enumerate(months):
            v = r[ix[name]]
            k = (y - START_YEAR) * 12 + m
            if isinstance(v, (int, float)) and v and 0 <= k < MONTHS:
                s[k] += int(v)
                year_tot[y] += int(v)

    rnd = random.Random(23)
    skus = sorted(fam)
    items, stock = [], []
    for sku in skus:
        f = fam[sku]
        items.append(dict(sku=sku, product=f"{f} {sku}", model=sku, department=f, line=f, finish="", size="",
                          source=FACTORY.get(f, "Factory 3, Hardware"), unit_cost="", price="", launch_date="", end_date="", replaces=""))
        tot = [sum(series[(sku, ch)][k] for ch in CHANNEL.values() if (sku, ch) in series) for k in range(MONTHS)]
        last3 = sum(tot[-3:]) / 3
        if last3 > 0:
            r = rnd.random()   # spread of cover so the demo has stockouts, healthy stock and overstock
            cover = rnd.uniform(.05, .4) if r < .22 else rnd.uniform(2.5, 6) if r < .4 else rnd.uniform(.8, 2)
            oh = round(last3 * cover)
        else:
            oh = round(max(tot) * rnd.uniform(.2, 1.5)) if any(tot) and rnd.random() < .35 else 0
        stock.append(dict(sku=sku, on_hand=oh, committed=0, incoming=0))

    src_of, weekly = {it["sku"]: it["source"] for it in items}, defaultdict(float)
    for (sku, ch), s in series.items():
        weekly[src_of[sku]] += sum(s[-3:]) / 13
    sources = [dict(source=n, type="factory", lead_time_days=lt, carton=pk, min_batch=moq,
                    weekly_capacity=int(round(weekly[n] * 1.2, -3)), confirmed=cf) for n, lt, pk, moq, cf in SOURCES]

    keys = sorted(series)
    data = dict(
        note="ASG challenge data: dummy figures supplied by ASG with the structure of its real forecasting data. Stock is estimated.",
        start=f"{START_YEAR}-01", months=MONTHS,
        items=dict(cols=list(items[0]), rows=[list(r.values()) for r in items]),
        stock=dict(cols=list(stock[0]), rows=[list(r.values()) for r in stock]),
        sources=dict(cols=list(sources[0]), rows=[list(r.values()) for r in sources]),
        monthly=dict(sku=[k[0] for k in keys], channel=[k[1] for k in keys], qty=[series[k] for k in keys]))
    out = Path(__file__).parent / "asg-data"
    out.mkdir(exist_ok=True)
    (out / "asg_demo.json").write_text(json.dumps(data, separators=(",", ":")))
    for name, tbl in (("items", items), ("stock", stock), ("sources", sources)):
        with open(out / f"{name}.csv", "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(tbl[0]))
            w.writeheader()
            w.writerows(tbl)
    ch_tot = defaultdict(int)
    for (sku, ch), s in series.items():
        ch_tot[ch] += sum(s)
    print(f"{len(skus)} SKUs, {len(keys)} SKU and channel series, {MONTHS} months")
    print("Units by year:", {y: f"{v / 1e6:.2f} M" for y, v in sorted(year_tot.items())})
    print("Units by channel:", {c: f"{v / 1e6:.2f} M" for c, v in ch_tot.items()})
    print(f"Wrote {out / 'asg_demo.json'} ({(out / 'asg_demo.json').stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "ASG_Historical_Demand_Data.xlsx")
