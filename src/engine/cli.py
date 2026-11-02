"""Command line interface and the monthly operating cycle.

Every command except `tenant add`, `tenant list` and `cycle --all-tenants` takes --tenant (a tenant id or name).
Commands that need a run (plan, po suggest, decide, report, backtest scoring) use the tenant's latest done run
unless --run names one. The cycle runs every stage except approving, pushing and cancelling POs: nothing
reaches Shopify unapproved (Spec 29); approve and push only happen through `po approve` and `po push`.
"""
from __future__ import annotations

import json
import logging
import math
import time
import traceback
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import Callable, Optional
from zoneinfo import ZoneInfo

import pandas as pd
import typer
from psycopg.types.json import Jsonb

from . import (aggregate, attribution, backtest, calibrate, db, decisions, ingest_meta, ingest_shopify, lineage,
               model, purchasing, tenants)
from .collector.funnel import rollup_funnel
from .customers import _month_range
from .tenants import Tenant

log = logging.getLogger("engine.cli")

connect: Callable = db.connect        # connection factory (DATABASE_URL); tests replace it

CYCLE_STAGES = ("sync_products", "ingest_orders", "ingest_spend", "ingest_landing_sessions", "rollup_funnel",
                "lineage", "run_attribution", "meta_factor", "fit", "score_runs", "run_decisions", "suggest_pos",
                "forward_plan", "rolling_backtest")
INGEST_STAGES = CYCLE_STAGES[:5]
# Optional stages: a failure is recorded as a warning in runs.stages and the run goes on (landing sessions need
# the read_reports scope and ShopifyQL; the funnel only refines views).
OPTIONAL_STAGES = frozenset({"ingest_landing_sessions", "rollup_funnel"})
# Spec 35: month grain for the whole parent chain, week and day grains for products and styles.
FIT_PLAN = tuple(("month", lv) for lv in ("store", "collection", "style", "product")) + tuple(
    (g, lv) for g in ("week", "day") for lv in ("product", "style"))
REPORT_SECTIONS = ("scorecard", "decisions", "lost_sales", "plan", "open_pos", "unmapped_ads", "lineage_pending")
INCREMENTAL_DAYS = 7                  # later runs re-read the last week (late refunds, Meta restatements)
META_HISTORY_MONTHS = 36              # Meta insights do not go back further (37 months documented)
CELL_WIDTH = 48

app = typer.Typer(no_args_is_help=True, add_completion=False,
                  help="Product growth engine: ingest, model, decide, plan and purchase per tenant.")
tenant_app = typer.Typer(no_args_is_help=True, help="Register and list tenants.")
lineage_app = typer.Typer(no_args_is_help=True, help="Variant lineage across split products.")
suppliers_app = typer.Typer(no_args_is_help=True, help="Suppliers, lead times, pack multiples and MOQs.")
po_app = typer.Typer(no_args_is_help=True, help="Purchase orders: suggest, approve, push, sync, cancel.")
app.add_typer(tenant_app, name="tenant")
app.add_typer(lineage_app, name="lineage")
app.add_typer(suppliers_app, name="suppliers")
app.add_typer(po_app, name="po")

TENANT_HELP = "Tenant id or name."


def _tenant_opt():
    return typer.Option(None, "--tenant", help=TENANT_HELP)


def _run_opt():
    return typer.Option(None, "--run", help="Run id (default: the tenant's latest done run).")


@app.callback()
def _main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


# ---------------------------------------------------------------- plumbing

def local_today(t: Tenant) -> date:
    return datetime.now(ZoneInfo(t.timezone)).date()


def previous_month(today: date) -> str:
    """'YYYY-MM' of the last complete month before `today`."""
    return (today.replace(day=1) - timedelta(days=1)).strftime("%Y-%m")


def _fail(msg: str) -> None:
    typer.echo(f"Error: {msg}", err=True)
    raise typer.Exit(1)


@contextmanager
def _session():
    conn = connect()
    try:
        db.migrate(conn)
        yield conn
    finally:
        conn.close()


def resolve_tenant(conn, value: str) -> Tenant:
    """A tenant by id (digits) or by name."""
    row = None
    if value.isdigit() and len(value) <= 18:
        row = conn.execute("SELECT tenant_id FROM tenants WHERE tenant_id = %s", (int(value),)).fetchone()
    if row is None:
        row = conn.execute("SELECT tenant_id FROM tenants WHERE name = %s", (value,)).fetchone()
    if row is None:
        _fail(f"unknown tenant {value!r}")
    return tenants.get_tenant(conn, row["tenant_id"])


@contextmanager
def _tenant_session(value: str | None):
    if not value:
        _fail("--tenant is required (tenant id or name)")
    with _session() as conn:
        yield conn, resolve_tenant(conn, value)


def _plain(x):
    """JSON friendly value: dates as ISO strings, numpy scalars and Decimals as numbers, NaN and inf as None."""
    if isinstance(x, dict):
        return {str(k): _plain(v) for k, v in x.items()}
    if isinstance(x, (list, tuple, set)):
        return [_plain(v) for v in x]
    if isinstance(x, (datetime, date)):
        return x.isoformat()
    if isinstance(x, Decimal) or hasattr(x, "item"):
        x = float(x) if isinstance(x, Decimal) else x.item()
    if isinstance(x, float) and not math.isfinite(x):
        return None
    return x if x is None or isinstance(x, (str, int, float, bool)) else str(x)


# ---------------------------------------------------------------- runs

def new_run(conn, t: Tenant, month: str) -> str:
    now = datetime.now(timezone.utc)
    run_id = f"{month.replace('-', '')}-{now:%Y%m%dT%H%M%S%fZ}"
    conn.execute("INSERT INTO runs (tenant_id, run_id, month, started_at, status) VALUES (%s,%s,%s,%s,'running')",
                 (t.tenant_id, run_id, month, now))
    conn.commit()
    return run_id


def _record_stage(conn, t: Tenant, run_id: str, name: str, info: dict) -> None:
    conn.execute("UPDATE runs SET stages = stages || %s WHERE tenant_id = %s AND run_id = %s",
                 (Jsonb({name: _plain(info)}), t.tenant_id, run_id))
    conn.commit()


def _finish_run(conn, t: Tenant, run_id: str, status: str) -> None:
    conn.execute("UPDATE runs SET status = %s, finished_at = now() WHERE tenant_id = %s AND run_id = %s",
                 (status, t.tenant_id, run_id))
    conn.commit()


def latest_run(conn, t: Tenant) -> dict | None:
    return conn.execute("SELECT run_id, month, status FROM runs WHERE tenant_id = %s AND status = 'done'"
                        " ORDER BY started_at DESC LIMIT 1", (t.tenant_id,)).fetchone()


def _get_run(conn, t: Tenant, run_id: str | None) -> dict:
    if run_id:
        row = conn.execute("SELECT run_id, month, status FROM runs WHERE tenant_id = %s AND run_id = %s",
                           (t.tenant_id, run_id)).fetchone()
        if row is None:
            _fail(f"unknown run {run_id!r} for tenant {t.name}")
        return row
    row = latest_run(conn, t)
    if row is None:
        _fail(f"no done run for tenant {t.name}; run `engine cycle` or `engine fit` first, or pass --run")
    return row


# ---------------------------------------------------------------- windows

def _max_date(conn, t: Tenant, table: str) -> date | None:
    return conn.execute(f"SELECT max(date) AS d FROM {table} WHERE tenant_id = %s", (t.tenant_id,)).fetchone()["d"]


def order_window(conn, t: Tenant, today: date) -> tuple[date, date, bool]:
    """(since, until, full_history). First run (no orders yet): from the store's oldest order; else from a week
    before the last order date. Until is the tenant's local yesterday."""
    until = today - timedelta(days=1)
    last = _max_date(conn, t, "orders")
    if last is None:
        first = ingest_shopify.first_order_date(t)
        return min(first or until, until), until, True
    return min(last - timedelta(days=INCREMENTAL_DAYS), until), until, False


def spend_window(conn, t: Tenant, today: date, history_start: date) -> tuple[date, date, bool]:
    """Same logic on ad_spend_daily; the first run starts at the order history start (Meta keeps ~37 months)."""
    until = today - timedelta(days=1)
    last = _max_date(conn, t, "ad_spend_daily")
    if last is None:
        oldest = (pd.Timestamp(until) - pd.DateOffset(months=META_HISTORY_MONTHS)).date() + timedelta(days=1)
        return min(max(history_start, oldest), until), until, True
    return min(last - timedelta(days=INCREMENTAL_DAYS), until), until, False


def _rollup(conn, t: Tenant, since: date, until: date) -> dict:
    """rollup_funnel for every window day from the tenant's first pixel event on (earlier days have no events)."""
    first = conn.execute("SELECT min((ts AT TIME ZONE %s)::date) AS d FROM pixel_events WHERE tenant_id = %s",
                         (t.timezone, t.tenant_id)).fetchone()["d"]
    n_days = rows = 0
    d = max(since, first) if first else until + timedelta(days=1)
    while d <= until:
        rows += rollup_funnel(conn, t, d)
        n_days += 1
        d += timedelta(days=1)
    return {"since": since, "until": until, "days": n_days, "rows": rows}


def _ingest_stages(conn, t: Tenant, today: date, ctx: dict, since: date | None = None,
                   until: date | None = None) -> list[tuple[str, Callable[[], object]]]:
    """The ingest part of the cycle. ctx collects the window (since, until) for the later stages."""
    def sync():
        return {"variants": ingest_shopify.sync_products(conn, t)}

    def orders():
        s, u, full = order_window(conn, t, today)
        if since is not None or until is not None:      # explicit window (ingest --since/--until)
            s, u, full = since or s, until or u, False
        ctx.update(since=s, until=u, history_start=s)
        return {"since": s, "until": u, "full_history": full, "orders": ingest_shopify.ingest_orders(conn, t, s, u)}

    def spend():
        if since is not None or until is not None:
            s, u, full = ctx["since"], ctx["until"], False
        else:
            oldest = _min_date(conn, t, "orders") or ctx["history_start"]
            s, u, full = spend_window(conn, t, today, oldest)
        ctx["spend_since"] = s
        ad_rows, catalog_rows = ingest_meta.ingest_spend(conn, t, s, u)
        return {"since": s, "until": u, "full_history": full, "ad_rows": ad_rows, "catalog_rows": catalog_rows}

    def landing():
        return {"since": ctx["since"], "until": ctx["until"],
                "rows": ingest_shopify.ingest_landing_sessions(conn, t, ctx["since"], ctx["until"])}

    def funnel():
        return _rollup(conn, t, ctx["since"], ctx["until"])

    return list(zip(INGEST_STAGES, (sync, orders, spend, landing, funnel)))


def _min_date(conn, t: Tenant, table: str) -> date | None:
    return conn.execute(f"SELECT min(date) AS d FROM {table} WHERE tenant_id = %s", (t.tenant_id,)).fetchone()["d"]


def _fit(conn, t: Tenant, run_id: str, plan) -> dict:
    return {f"{lv}/{g}": len(model.fit_all(conn, t, g, lv, run_id)) for g, lv in plan}


def _cycle_stages(conn, t: Tenant, run_id: str, month: str, today: date,
                  ctx: dict) -> list[tuple[str, Callable[[], object]]]:
    def lineage_stage():
        df = lineage.propose_matches(conn, t)        # proposals only; confirming is the operator's job
        confirmed = int(df["confirmed"].sum()) if len(df) else 0
        return {"proposed": len(df), "auto_confirmed": confirmed, "pending": len(df) - confirmed,
                "styles": lineage.build_styles(conn, t)}

    def attribute():
        s = min(ctx["since"], ctx.get("spend_since", ctx["since"]))
        attribution.run_attribution(conn, t, s, ctx["until"])
        return {"since": s, "until": ctx["until"]}

    def factor():
        return {"month": month, "meta_factor": calibrate.meta_factor(conn, t, month)}

    def score():
        earlier = conn.execute("SELECT run_id FROM runs WHERE tenant_id = %s AND status = 'done' AND run_id <> %s"
                               " ORDER BY started_at", (t.tenant_id, run_id)).fetchall()
        return {r["run_id"]: backtest.score_run(conn, t, r["run_id"]) for r in earlier}

    def decide():
        df = decisions.run_decisions(conn, t, run_id, month)
        return {"month": month, "rows": len(df),
                "by_decision": {k: int(v) for k, v in df["decision"].value_counts().items()} if len(df) else {}}

    def roll():
        return {"grain": "month", "level": "style", "folds": 3,
                "mape": backtest.rolling_backtest(conn, t, "month", "style", 3)}

    return _ingest_stages(conn, t, today, ctx) + [
        ("lineage", lineage_stage),
        ("run_attribution", attribute),
        ("meta_factor", factor),
        ("fit", lambda: _fit(conn, t, run_id, FIT_PLAN)),
        ("score_runs", score),
        ("run_decisions", decide),
        ("suggest_pos", lambda: {"pos": purchasing.suggest_pos(conn, t, run_id)}),
        ("forward_plan", lambda: {"rows": len(decisions.forward_plan(conn, t, run_id))}),
        ("rolling_backtest", roll),
    ]


def _run_stages(conn, t: Tenant, run_id: str | None, stages) -> tuple[bool, str | None]:
    """Run stages in order, logging each (and recording it in runs.stages when run_id is set). Stops at the
    first failure of a required stage; an OPTIONAL_STAGES failure is recorded with status 'warning' and the next
    stage runs. Error text is redacted (no access tokens) before it is logged, stored or returned.
    Returns (ok, failure message)."""
    for seq, (name, fn) in enumerate(stages):
        start = time.monotonic()
        log.info("tenant %s (%s) run %s: %s started", t.tenant_id, t.name, run_id, name)
        try:
            result = fn()
        except Exception as e:                       # noqa: BLE001  a stage failure fails the run, not the CLI
            conn.rollback()
            msg = tenants.redact(f"{type(e).__name__}: {e}", t)
            optional = name in OPTIONAL_STAGES
            log.error("tenant %s (%s) run %s: %s %s: %s\n%s", t.tenant_id, t.name, run_id, name,
                      "failed (optional, continuing)" if optional else "failed", msg,
                      tenants.redact(traceback.format_exc(), t))
            if run_id:
                _safe_record(conn, t, run_id, name, {"seq": seq, "status": "warning" if optional else "failed",
                                                     "error": msg, "seconds": round(time.monotonic() - start, 3)})
            if optional:
                continue
            return False, f"{name}: {msg}"
        secs = round(time.monotonic() - start, 3)
        log.info("tenant %s (%s) run %s: %s done in %.1fs: %s", t.tenant_id, t.name, run_id, name, secs,
                 _summary(result))
        if run_id:
            _record_stage(conn, t, run_id, name, {"seq": seq, "status": "done", "seconds": secs, "result": result})
    return True, None


def _summary(result, limit: int = 500) -> str:
    """Stage result for the log, cut to `limit` characters."""
    text = json.dumps(_plain(result), default=str)
    return text if len(text) <= limit else text[:limit] + "..."


def _safe_record(conn, t: Tenant, run_id: str, name: str, info: dict) -> None:
    """Record a stage failure; best effort (a bookkeeping error is logged, never raised over the stage error)."""
    try:
        _record_stage(conn, t, run_id, name, info)
    except Exception:                                # noqa: BLE001
        conn.rollback()
        log.error("tenant %s run %s: could not record stage %s", t.tenant_id, run_id, name)


def run_cycle(conn, t: Tenant, today: date | None = None) -> tuple[str, bool, str | None]:
    """One tenant's monthly cycle as a recorded run. Never approves, pushes or cancels a PO.

    If anything outside a stage raises (bookkeeping), the run is still marked failed, best effort."""
    today = today or local_today(t)
    month = previous_month(today)
    run_id = new_run(conn, t, month)
    try:
        ok, err = _run_stages(conn, t, run_id, _cycle_stages(conn, t, run_id, month, today, {}))
        _finish_run(conn, t, run_id, "done" if ok else "failed")
    except BaseException:
        _mark_failed(conn, t, run_id)
        raise
    return run_id, ok, err


def _mark_failed(conn, t: Tenant, run_id: str) -> None:
    try:
        conn.rollback()
        _finish_run(conn, t, run_id, "failed")
    except Exception:                                # noqa: BLE001  the connection may be gone; try a new one
        try:
            with connect() as c2:
                _finish_run(c2, t, run_id, "failed")
        except Exception:                            # noqa: BLE001
            log.error("tenant %s run %s: could not mark the run failed", t.tenant_id, run_id)


# ---------------------------------------------------------------- tables and report

def _cell(v) -> str:
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return ""
    if isinstance(v, (list, tuple, set)):
        return ",".join(str(x) for x in v)
    if isinstance(v, (float, Decimal)):
        return f"{float(v):,.2f}"
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, dict):
        return json.dumps(v, default=str)
    s = str(v)
    return s if len(s) <= CELL_WIDTH else s[:CELL_WIDTH - 1] + "~"


def format_table(df: pd.DataFrame) -> str:
    """Plain text table, one line per row."""
    if df is None or df.empty:
        return "(no rows)"
    cols = [str(c) for c in df.columns]
    cells = [[_cell(v) for v in row] for row in df.itertuples(index=False, name=None)]
    widths = [max(len(c), *(len(r[i]) for r in cells)) for i, c in enumerate(cols)]
    numeric = [all(r[i] == "" or r[i].replace(",", "").replace(".", "", 1).lstrip("-").isdigit() for r in cells)
               for i in range(len(cols))]
    fmt = lambda vals: "  ".join(v.rjust(w) if n else v.ljust(w)            # noqa: E731
                                 for v, w, n in zip(vals, widths, numeric)).rstrip()
    return "\n".join([fmt(cols), "  ".join("-" * w for w in widths)] + [fmt(r) for r in cells])


def _echo_table(title: str, df: pd.DataFrame) -> None:
    typer.echo(f"\n== {title} ({len(df)} rows)")
    typer.echo(format_table(df))


def _frame(rows, columns) -> pd.DataFrame:
    """DataFrame of DB rows with Decimals as floats (object dtype keeps None)."""
    conv = [{c: float(r[c]) if isinstance(r[c], Decimal) else r[c] for c in columns} for r in rows]
    return pd.DataFrame(conv, columns=columns, dtype=object)


def _flat(df: pd.DataFrame) -> pd.DataFrame:
    """Lists (flags) as comma separated text, for CSV and terminal."""
    out = df.copy()
    for c in out.columns:
        out[c] = [",".join(map(str, v)) if isinstance(v, (list, tuple)) else v for v in out[c]]
    return out


def lineage_pending(conn, t: Tenant) -> pd.DataFrame:
    rows = conn.execute(
        "SELECT l.old_variant_id, po.title AS old_title, po.sku AS old_sku, l.new_variant_id, pn.title AS new_title,"
        " pn.sku AS new_sku, l.method, l.candidates, l.effective_date FROM variant_lineage l"
        " LEFT JOIN products po ON po.tenant_id = l.tenant_id AND po.variant_id = l.old_variant_id"
        " LEFT JOIN products pn ON pn.tenant_id = l.tenant_id AND pn.variant_id = l.new_variant_id"
        " WHERE l.tenant_id = %s AND NOT l.confirmed ORDER BY l.old_variant_id, l.new_variant_id",
        (t.tenant_id,)).fetchall()
    return _frame(rows, ["old_variant_id", "old_title", "old_sku", "new_variant_id", "new_title", "new_sku",
                         "method", "candidates", "effective_date"])


PO_COLUMNS = ["po_number", "state", "supplier", "run_id", "created", "lines", "qty_suggested", "qty_approved",
              "qty_received", "transfer_id"]


def _pos(conn, t: Tenant, open_only: bool, state: str | None = None) -> pd.DataFrame:
    rows = conn.execute(
        "SELECT o.po_number, o.state, s.name AS supplier, o.run_id, o.created_at::date AS created,"
        " count(l.variant_id) AS lines, COALESCE(sum(l.qty_suggested), 0) AS qty_suggested,"
        " sum(l.qty_approved) AS qty_approved, COALESCE(sum(l.qty_received), 0) AS qty_received, o.transfer_id"
        " FROM purchase_orders o"
        " LEFT JOIN suppliers s ON s.tenant_id = o.tenant_id AND s.supplier_id = o.supplier_id"
        " LEFT JOIN po_lines l ON l.tenant_id = o.tenant_id AND l.po_number = o.po_number"
        " WHERE o.tenant_id = %(tid)s AND (NOT %(open)s OR o.state NOT IN ('received', 'cancelled'))"
        " AND (%(state)s::text IS NULL OR o.state = %(state)s)"
        " GROUP BY o.po_number, o.state, s.name, o.run_id, o.created_at, o.transfer_id ORDER BY o.po_number",
        {"tid": t.tenant_id, "open": open_only, "state": state}).fetchall()
    return _frame(rows, PO_COLUMNS)


def _unexplained(conn, t: Tenant, data, run_id: str, month: str) -> dict[str, float | None]:
    """Unexplained residual per style for the month (model.decompose with month grain style params)."""
    params = decisions._load_params(conn, t, "style", run_id)
    panel = data.panel("month", "style")
    if not len(panel):
        return {}
    start = _month_range(month)[0]
    out = {}
    for r in panel[panel["period_start"] == start].to_dict("records"):
        p = params.get(r["entity_id"])
        out[r["entity_id"]] = decisions._clean(model.decompose(p, r).get("unexplained")) \
            if p is not None and p.grain == "month" else None
    return out


def build_report(conn, t: Tenant, run_id: str, month: str) -> dict[str, pd.DataFrame]:
    """The monthly report: one DataFrame per section of REPORT_SECTIONS."""
    start, end = _month_range(month)
    data = aggregate.TenantData(conn, t)
    cards = [c for c in (decisions.scorecard(conn, t, month, lv, run_id, data=data) for lv in decisions.LEVELS)
             if len(c)]
    score = pd.concat(cards, ignore_index=True) if cards else pd.DataFrame(columns=decisions.SCORECARD_COLUMNS)

    styles = score[score["level"] == "style"] if len(score) else score
    unexplained = _unexplained(conn, t, data, run_id, month)
    lost = pd.DataFrame({
        "entity_id": list(styles["entity_id"]), "true_demand": list(styles["true_demand"]),
        "units": list(styles["units"]), "lost_stock": list(styles["lost_stock"]),
        "lost_price": list(styles["lost_price"]),
        "unexplained": [unexplained.get(e) for e in styles["entity_id"]]}, dtype=object)

    dec = _frame(conn.execute(
        "SELECT level, entity_id, decision, rule, flags FROM decisions WHERE tenant_id = %s AND run_id = %s"
        " AND month = %s ORDER BY level, entity_id", (t.tenant_id, run_id, start)).fetchall(),
        ["level", "entity_id", "decision", "rule", "flags"])
    plan = _frame(conn.execute(
        "SELECT entity_id, month, spend, units, true_demand, revenue, profit, po_number FROM product_plans"
        " WHERE tenant_id = %s AND run_id = %s ORDER BY entity_id, month", (t.tenant_id, run_id)).fetchall(),
        ["entity_id", "month", "spend", "units", "true_demand", "revenue", "profit", "po_number"])
    unmapped = _frame(conn.execute(
        "SELECT account_id, ad_id, ad_name, reason, catalog_product_id, sum(spend) AS spend,"
        " sum(impressions) AS impressions, sum(purchases) AS purchases, min(date) AS first_date,"
        " max(date) AS last_date FROM unmapped_spend_log WHERE tenant_id = %s AND date >= %s AND date < %s"
        " GROUP BY account_id, ad_id, ad_name, reason, catalog_product_id ORDER BY sum(spend) DESC, ad_id",
        (t.tenant_id, start, end)).fetchall(),
        ["account_id", "ad_id", "ad_name", "reason", "catalog_product_id", "spend", "impressions", "purchases",
         "first_date", "last_date"])
    return {"scorecard": _flat(score), "decisions": _flat(dec), "lost_sales": lost, "plan": plan,
            "open_pos": _pos(conn, t, open_only=True), "unmapped_ads": unmapped,
            "lineage_pending": lineage_pending(conn, t)}


SCORECARD_TERMINAL = ["level", "entity_id", "units", "true_demand", "revenue", "spend", "cpm", "poas",
                      "marginal_poas", "paid_cac", "customer_value_12m", "size_availability", "stock_cover_days",
                      "flags"]


# ---------------------------------------------------------------- tenant

@tenant_app.command("add")
def tenant_add(
    name: str = typer.Option(..., "--name", help="Tenant name."),
    shop: str = typer.Option(..., "--shop", help="Shop domain, e.g. store.myshopify.com."),
    shopify_token_env: str = typer.Option(..., "--shopify-token-env", help="Env var holding the Admin API token."),
    meta_token_env: str = typer.Option(..., "--meta-token-env", help="Env var holding the Meta token."),
    meta_account: list[str] = typer.Option([], "--meta-account", help="Meta ad account id (repeatable)."),
    po_prefix: str = typer.Option(..., "--po-prefix", help="Prefix of PO numbers."),
    ingest: bool = typer.Option(True, "--ingest/--no-ingest", help="Ingest the full history now (Spec 15)."),
) -> None:
    """Register a store; timezone and currency are read from Shopify."""
    with _session() as conn:
        warnings: list[str] = []
        try:
            t = tenants.add_tenant(conn, name, shop, shopify_token_env, meta_token_env, meta_account, po_prefix,
                                   warnings=warnings)
        except Exception as e:                       # noqa: BLE001  HTTP errors included; never echo a token
            conn.rollback()
            _fail(tenants.redact(f"{type(e).__name__}: {e}" if not isinstance(e, ValueError) else e))
        typer.echo(f"tenant {t.tenant_id} {t.name}: {t.timezone} {t.currency}, main location {t.main_location_id}"
                   " (change with `engine tenant set-location`)")
        for w in warnings:
            typer.echo(f"warning: {w}", err=True)
        typer.echo(f"pixel key (for the storefront pixel): {t.pixel_key}")
        if ingest:
            ok, err = _run_stages(conn, t, None, _ingest_stages(conn, t, local_today(t), {}))
            if not ok:
                _fail(f"ingest failed at {err}")
            typer.echo("full history ingested")


@tenant_app.command("list")
def tenant_list() -> None:
    """List tenants."""
    with _session() as conn:
        ts = tenants.list_tenants(conn)
    _echo_table("tenants", pd.DataFrame(
        [{"tenant_id": t.tenant_id, "name": t.name, "shop": t.shop_domain, "timezone": t.timezone,
          "currency": t.currency, "po_prefix": t.po_prefix, "meta_accounts": t.meta_account_ids} for t in ts],
        columns=["tenant_id", "name", "shop", "timezone", "currency", "po_prefix", "meta_accounts"]))


# ---------------------------------------------------------------- ingest and stock

@app.command("ingest")
def ingest(tenant: Optional[str] = _tenant_opt(),
           since: Optional[datetime] = typer.Option(None, "--since", formats=["%Y-%m-%d"]),
           until: Optional[datetime] = typer.Option(None, "--until", formats=["%Y-%m-%d"])) -> None:
    """Products, orders, Meta spend, landing sessions and funnel roll-up (default window as in the cycle)."""
    with _tenant_session(tenant) as (conn, t):
        ok, err = _run_stages(conn, t, None, _ingest_stages(conn, t, local_today(t), {},
                                                            since and since.date(), until and until.date()))
        if not ok:
            _fail(f"ingest failed at {err}")
        typer.echo(f"ingest done for {t.name}")


@app.command("snapshot_stock")
def snapshot_stock(tenant: Optional[str] = _tenant_opt()) -> None:
    """Store today's inventory levels; the first snapshot also reconstructs stock history from sales."""
    with _tenant_session(tenant) as (conn, t):
        first = conn.execute("SELECT NOT EXISTS (SELECT 1 FROM stock_daily WHERE tenant_id = %s AND NOT reconstructed)"
                             " AS first", (t.tenant_id,)).fetchone()["first"]
        n = ingest_shopify.snapshot_stock(conn, t, local_today(t))
        typer.echo(f"{n} stock rows for {local_today(t)}")
        earliest = _min_date(conn, t, "sales_lines")
        if first and earliest:
            typer.echo(f"{ingest_shopify.reconstruct_stock(conn, t, earliest)} reconstructed rows back to {earliest}")


# ---------------------------------------------------------------- lineage

@lineage_app.command("propose")
def lineage_propose(tenant: Optional[str] = _tenant_opt()) -> None:
    """Propose variant matches (unique matches auto confirm) and rebuild styles."""
    with _tenant_session(tenant) as (conn, t):
        df = lineage.propose_matches(conn, t)
        styles = lineage.build_styles(conn, t)
        _echo_table("proposed matches", df)
        typer.echo(f"{styles} styles; review pending rows with `engine lineage list`")


@lineage_app.command("confirm")
def lineage_confirm(old: str, new: str, tenant: Optional[str] = _tenant_opt()) -> None:
    """Confirm OLD -> NEW (a proposal or a manual match) and rebuild styles."""
    with _tenant_session(tenant) as (conn, t):
        try:
            lineage.confirm(conn, t, old, new)
        except ValueError as e:
            _fail(str(e))
        typer.echo(f"confirmed {old} -> {new}; {lineage.build_styles(conn, t)} styles")


@lineage_app.command("list")
def lineage_list(tenant: Optional[str] = _tenant_opt()) -> None:
    """Pending (unconfirmed) matches awaiting review."""
    with _tenant_session(tenant) as (conn, t):
        _echo_table("lineage pending review", lineage_pending(conn, t))


# ---------------------------------------------------------------- attribution and model

@app.command("attribute")
def attribute(tenant: Optional[str] = _tenant_opt(),
              since: Optional[datetime] = typer.Option(None, "--since", formats=["%Y-%m-%d"]),
              until: Optional[datetime] = typer.Option(None, "--until", formats=["%Y-%m-%d"])) -> None:
    """Attribute spend to products and credit orders (default: all data up to local yesterday)."""
    with _tenant_session(tenant) as (conn, t):
        u = until.date() if until else local_today(t) - timedelta(days=1)
        s = since.date() if since else min((d for d in (_min_date(conn, t, "orders"),
                                                        _min_date(conn, t, "ad_spend_daily")) if d), default=None)
        if s is None:
            _fail("no orders or spend to attribute; run `engine ingest` first")
        attribution.run_attribution(conn, t, s, u)
        typer.echo(f"attributed {s} .. {u} for {t.name}")


@app.command("fit")
def fit(tenant: Optional[str] = _tenant_opt(),
        grain: Optional[str] = typer.Option(None, "--grain", help="day, week or month (default month)."),
        level: Optional[str] = typer.Option(None, "--level", help="product, style, collection or store (default all)."),
        run: Optional[str] = typer.Option(None, "--run", help="Refit into this run (default: a new run).")) -> None:
    """Fit demand models. Without --run this records a new done run that later commands default to."""
    if grain is not None and grain not in aggregate.GRAINS:
        _fail(f"--grain must be one of {', '.join(aggregate.GRAINS)}")
    if level is not None and level not in aggregate.LEVELS:
        _fail(f"--level must be one of {', '.join(aggregate.LEVELS)}")
    plan = [(grain or "month", lv) for lv in ([level] if level else ("store", "collection", "style", "product"))]
    with _tenant_session(tenant) as (conn, t):
        run_id = _get_run(conn, t, run)["run_id"] if run else new_run(conn, t, previous_month(local_today(t)))
        ok, err = _run_stages(conn, t, run_id, [("fit", lambda: _fit(conn, t, run_id, plan))])
        if not run:
            _finish_run(conn, t, run_id, "done" if ok else "failed")
        if not ok:
            _fail(f"fit failed: {err}")
        n = conn.execute("SELECT params->>'level' AS level, params->>'grain' AS grain, count(*) AS entities"
                         " FROM model_params WHERE tenant_id = %s AND run_id = %s GROUP BY 1, 2 ORDER BY 1, 2",
                         (t.tenant_id, run_id)).fetchall()
        _echo_table(f"fitted params in run {run_id}", _frame(n, ["level", "grain", "entities"]))


@app.command("plan")
def plan(tenant: Optional[str] = _tenant_opt(), run: Optional[str] = _run_opt(),
         months: int = typer.Option(3, "--months")) -> None:
    """Forward plan per style (Spec 34) for the run."""
    with _tenant_session(tenant) as (conn, t):
        r = _get_run(conn, t, run)
        df = decisions.forward_plan(conn, t, r["run_id"], months)
        _echo_table(f"plan for run {r['run_id']}", df.drop(columns=["period_start"]))


@app.command("decide")
def decide(tenant: Optional[str] = _tenant_opt(), run: Optional[str] = _run_opt(),
           month: Optional[str] = typer.Option(None, "--month", help="YYYY-MM (default: the run's month).")) -> None:
    """Scorecard and decisions for a month, stored under the run."""
    with _tenant_session(tenant) as (conn, t):
        r = _get_run(conn, t, run)
        df = decisions.run_decisions(conn, t, r["run_id"], month or r["month"])
        _echo_table(f"decisions {month or r['month']} (run {r['run_id']})",
                    _flat(df[["level", "entity_id", "decision", "rule", "flags"]]))


@app.command("report")
def report(tenant: Optional[str] = _tenant_opt(), run: Optional[str] = _run_opt(),
           month: Optional[str] = typer.Option(None, "--month", help="YYYY-MM (default: the run's month)."),
           out: Optional[Path] = typer.Option(None, "--out", help="Directory (default ./reports/<tenant_id>/<month>).")
           ) -> None:
    """Print the report sections and write one CSV per section."""
    with _tenant_session(tenant) as (conn, t):
        r = _get_run(conn, t, run)
        m = month or r["month"]
        sections = build_report(conn, t, r["run_id"], m)
    out = out or Path("reports") / str(t.tenant_id) / m
    out.mkdir(parents=True, exist_ok=True)
    typer.echo(f"report {t.name} {m} (run {r['run_id']})")
    for name in REPORT_SECTIONS:
        df = sections[name]
        df.to_csv(out / f"{name}.csv", index=False)
        shown = df[[c for c in SCORECARD_TERMINAL if c in df.columns]] if name == "scorecard" and len(df) else df
        _echo_table(name, shown)
    typer.echo(f"\nCSV files in {out}")


@app.command("backtest")
def backtest_cmd(tenant: Optional[str] = _tenant_opt(),
                 grain: str = typer.Option("month", "--grain"), level: str = typer.Option("style", "--level"),
                 folds: int = typer.Option(3, "--folds"), run: Optional[str] = _run_opt()) -> None:
    """Rolling one-period-ahead backtest, and scoring of the run's stored forecasts."""
    if grain not in aggregate.GRAINS or level not in aggregate.LEVELS:
        _fail(f"--grain in {aggregate.GRAINS}, --level in {aggregate.LEVELS}")
    with _tenant_session(tenant) as (conn, t):
        mape = backtest.rolling_backtest(conn, t, grain, level, folds)
        typer.echo(f"rolling backtest {level}/{grain}, {folds} folds: MAPE {_cell(mape) or 'n/a (nothing scorable)'}")
        r = _get_run(conn, t, run) if run else latest_run(conn, t)
        if r:
            score = backtest.score_run(conn, t, r["run_id"])
            typer.echo(f"run {r['run_id']} forecasts: MAPE {_cell(score) or 'n/a (no complete periods yet)'}")


# ---------------------------------------------------------------- suppliers

def _resolve_product(conn, t: Tenant, value: str) -> str:
    if value.startswith("gid://"):
        return value
    rows = conn.execute("SELECT DISTINCT product_id FROM products WHERE tenant_id = %s AND handle = %s",
                        (t.tenant_id, value)).fetchall()
    if len(rows) != 1:
        _fail(f"unknown product {value!r} (give a product id or handle)")
    return rows[0]["product_id"]


def _resolve_style(conn, t: Tenant, value: str) -> str:
    rows = conn.execute("SELECT style_id FROM styles WHERE tenant_id = %s AND (style_id = %s OR name = %s)",
                        (t.tenant_id, value, value)).fetchall()
    if len(rows) != 1:
        _fail(f"unknown style {value!r} (give a style id or name; run `engine lineage propose` to build styles)")
    return rows[0]["style_id"]


@suppliers_app.command("add")
def suppliers_add(name: str, tenant: Optional[str] = _tenant_opt(),
                  kind: str = typer.Option(..., "--kind", help="factory or external."),
                  lead_time: int = typer.Option(..., "--lead-time", help="Lead time in days."),
                  pack: int = typer.Option(1, "--pack", help="Pack multiple."),
                  moq: int = typer.Option(0, "--moq", help="Minimum order quantity for the style or product."),
                  style: Optional[str] = typer.Option(None, "--style", help="Style this supplier makes."),
                  product: Optional[str] = typer.Option(None, "--product", help="Product this supplier makes.")) -> None:
    """Add or update a supplier, optionally linking it to a style or a product."""
    if kind not in ("factory", "external"):
        _fail("--kind must be factory or external")
    if lead_time < 0 or pack < 1 or moq < 0:
        _fail("--lead-time >= 0, --pack >= 1 and --moq >= 0 are required")
    if style and product:
        _fail("give --style or --product, not both")
    with _tenant_session(tenant) as (conn, t):
        sid = conn.execute(
            "INSERT INTO suppliers (tenant_id, name, kind, lead_time_days, pack_multiple) VALUES (%s,%s,%s,%s,%s)"
            " ON CONFLICT (tenant_id, name) DO UPDATE SET kind = EXCLUDED.kind,"
            " lead_time_days = EXCLUDED.lead_time_days, pack_multiple = EXCLUDED.pack_multiple"
            " RETURNING supplier_id", (t.tenant_id, name, kind, lead_time, pack)).fetchone()["supplier_id"]
        link = ""
        if style or product:
            sty = _resolve_style(conn, t, style) if style else None
            prod = _resolve_product(conn, t, product) if product else None
            conn.execute(
                "INSERT INTO product_suppliers (tenant_id, supplier_id, style_id, product_id, moq) VALUES (%s,%s,%s,%s,%s)"
                " ON CONFLICT (tenant_id, COALESCE(style_id, ''), COALESCE(product_id, ''))"
                " DO UPDATE SET supplier_id = EXCLUDED.supplier_id, moq = EXCLUDED.moq",
                (t.tenant_id, sid, sty, prod, moq))
            link = f" for {sty or prod} (moq {moq})"
        conn.commit()
        typer.echo(f"supplier {sid} {name}{link}")


@suppliers_app.command("list")
def suppliers_list(tenant: Optional[str] = _tenant_opt()) -> None:
    """Suppliers and the styles or products they make."""
    with _tenant_session(tenant) as (conn, t):
        rows = conn.execute(
            "SELECT s.supplier_id, s.name, s.kind, s.lead_time_days, s.pack_multiple, ps.style_id, ps.product_id,"
            " ps.moq FROM suppliers s LEFT JOIN product_suppliers ps"
            " ON ps.tenant_id = s.tenant_id AND ps.supplier_id = s.supplier_id"
            " WHERE s.tenant_id = %s ORDER BY s.name, ps.style_id, ps.product_id", (t.tenant_id,)).fetchall()
        _echo_table("suppliers", _frame(rows, ["supplier_id", "name", "kind", "lead_time_days", "pack_multiple",
                                               "style_id", "product_id", "moq"]))


# ---------------------------------------------------------------- purchase orders

def _parse_edits(edits: list[str]) -> dict[str, int]:
    out = {}
    for e in edits:
        variant, sep, qty = e.rpartition("=")
        if not sep or not variant:
            _fail(f"--edit must be VARIANT=QTY, got {e!r}")
        try:
            out[variant] = int(qty)
        except ValueError:
            _fail(f"--edit quantity must be an integer, got {e!r}")
    return out


def _po_action(tenant: str | None, action: Callable[[object, Tenant], str]) -> None:
    with _tenant_session(tenant) as (conn, t):
        try:
            typer.echo(action(conn, t))
        except (ValueError, KeyError, RuntimeError) as e:
            _fail(str(e))


@po_app.command("suggest")
def po_suggest(tenant: Optional[str] = _tenant_opt(), run: Optional[str] = _run_opt(),
               cover_days: int = typer.Option(30, "--cover-days")) -> None:
    """Draft POs from the run's true demand forecasts (replaces the run's earlier drafts)."""
    with _tenant_session(tenant) as (conn, t):
        r = _get_run(conn, t, run)
        nums = purchasing.suggest_pos(conn, t, r["run_id"], cover_days)
        typer.echo(f"draft POs for run {r['run_id']}: {', '.join(nums) or 'none'}")
        _echo_table("open purchase orders", _pos(conn, t, open_only=True))


@po_app.command("list")
def po_list(tenant: Optional[str] = _tenant_opt(),
            state: Optional[str] = typer.Option(None, "--state", help="Only POs in this state.")) -> None:
    """Purchase orders with line totals."""
    with _tenant_session(tenant) as (conn, t):
        _echo_table("purchase orders", _pos(conn, t, open_only=False, state=state))


@po_app.command("approve")
def po_approve(po: str, tenant: Optional[str] = _tenant_opt(),
               edit: list[str] = typer.Option([], "--edit", help="VARIANT=QTY override (repeatable).")) -> None:
    """Approve a draft PO, optionally editing quantities. Approval is the only way a PO can be pushed."""
    edits = _parse_edits(edit)

    def act(conn, t):
        purchasing.approve_po(conn, t, po, edits or None)
        return f"approved {po}"
    _po_action(tenant, act)


@po_app.command("push")
def po_push(po: str, tenant: Optional[str] = _tenant_opt()) -> None:
    """Push an approved PO to Shopify as an inventory transfer (ready to ship)."""
    _po_action(tenant, lambda conn, t: f"pushed {po}: transfer {purchasing.push_po(conn, t, po)}")


@po_app.command("sync")
def po_sync(tenant: Optional[str] = _tenant_opt()) -> None:
    """Read received quantities of pushed POs from Shopify."""
    _po_action(tenant, lambda conn, t: f"{purchasing.sync_receipts(conn, t)} PO lines updated")


@po_app.command("cancel")
def po_cancel(po: str, tenant: Optional[str] = _tenant_opt()) -> None:
    """Cancel a draft, approved or pushed PO (a pushed PO's transfer is cancelled in Shopify)."""
    def act(conn, t):
        purchasing.cancel_po(conn, t, po)
        return f"cancelled {po}"
    _po_action(tenant, act)


# ---------------------------------------------------------------- cycle

@app.command("cycle")
def cycle(tenant: Optional[str] = _tenant_opt(),
          all_tenants: bool = typer.Option(False, "--all-tenants", help="Run every tenant in turn.")) -> None:
    """The monthly cycle: every stage except approving and pushing POs."""
    if bool(tenant) == all_tenants:
        _fail("give exactly one of --tenant or --all-tenants")
    failed = []
    with _session() as conn:
        targets = tenants.list_tenants(conn) if all_tenants else [resolve_tenant(conn, tenant)]
    for t in targets:                                # a fresh connection per tenant: one tenant's broken
        try:                                         # connection cannot fail the next tenant
            with _session() as conn:
                run_id, ok, err = run_cycle(conn, t)
        except Exception as e:                       # noqa: BLE001  bookkeeping failure: next tenant
            log.error("tenant %s cycle crashed: %s", t.tenant_id,
                      tenants.redact(traceback.format_exc(), t))
            run_id, ok, err = None, False, tenants.redact(f"{type(e).__name__}: {e}", t)
        typer.echo(f"tenant {t.tenant_id} {t.name}: run {run_id} {'done' if ok else 'failed at ' + str(err)}")
        if not ok:
            failed.append(t.name)
    if failed:
        _fail(f"cycle failed for {', '.join(failed)}")
