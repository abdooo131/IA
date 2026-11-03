"""The local web screen: a FastAPI app with server rendered pages over the engine.

Safety: the server binds 127.0.0.1 only (server.py). Every request must carry Host 127.0.0.1:<port> or
localhost:<port> (DNS rebinding). Every POST carries the per process random CSRF token (a hidden form field,
compared in constant time) and is refused when an Origin header is present and is not the local origin. Pages
never render a token value; error text goes through tenants.redact. Nothing writes to Shopify except Send to
Shopify of an approved PO (purchasing.push_po), Cancel of an approved or sent PO (purchasing.cancel_po), as in the
CLI; running the cycle never approves or pushes.
"""
from __future__ import annotations

import os
import secrets
import threading
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Callable
from urllib.parse import urlencode

import psycopg
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.datastructures import FormData
from starlette.exceptions import HTTPException as StarletteHTTPException

from .. import attribution, cli, config, db, lineage, purchasing, tenants
from . import envfile, views
from .jobs import Job, Jobs

HERE = Path(__file__).parent
AD_MAP_ROWS = 3                                       # product / share rows of the manual ad map form
SAFE_NEXT = ("/", "/pos", "/run", "/setup", "/plan", "/scorecard", "/lost-sales")


@dataclass
class UiConfig:
    port: int = 8765
    connect: Callable = field(default=db.connect)      # connection factory
    demo: bool = False
    env_file: Path = envfile.DEFAULT_PATH
    default_url: str = config.DEFAULT_DATABASE_URL     # tried when DATABASE_URL is not set (server.database_connect)


class DatabaseDown(Exception):
    pass


class NeedSetup(Exception):
    pass


class ActionError(Exception):
    """A user action failed: shown on the page it came from with this status."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------- app

def create_app(cfg: UiConfig) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.cfg = cfg
    app.state.csrf = secrets.token_urlsafe(32)
    app.state.jobs = Jobs()
    app.state.flash = OrderedDict()
    app.state.reports = {}
    app.state.lock = threading.Lock()
    app.state.migrated = False
    templates = Jinja2Templates(directory=str(HERE / "templates"))
    templates.env.filters.update(money=views.fmt_money, num=views.fmt_num, pct=views.fmt_pct, day=views.fmt_date)
    templates.env.globals.update(flag_label=lambda f: views.FLAG_LABELS.get(f, f.replace("_", " ")),
                                 stage_label=lambda n: views.STAGE_LABELS.get(n, n))
    app.state.templates = templates
    app.mount("/static", StaticFiles(directory=str(HERE / "static")), name="static")

    hosts = {f"127.0.0.1:{cfg.port}", f"localhost:{cfg.port}"}
    origins = {f"http://{h}" for h in hosts}

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.headers.get("host", "") not in hosts:
            return PlainTextResponse("Refused: this screen only answers on its local address.", status_code=400)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin is not None and origin not in origins:
                return PlainTextResponse("Refused: the request came from another site.", status_code=403)
        response = await call_next(request)
        response.headers.update({
            "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; "
                                       "script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
            "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin",
            "Cache-Control": "no-store"})
        return response

    @app.exception_handler(DatabaseDown)
    async def _db_down(request: Request, exc: DatabaseDown):
        return _render(request, "database.html", {"error": str(exc) or None, "default_url": cfg.default_url,
                                                  "using_default": "DATABASE_URL" not in os.environ},
                       status=503, page_ctx=None)

    @app.exception_handler(NeedSetup)
    async def _need_setup(request: Request, exc: NeedSetup):
        return RedirectResponse("/setup", status_code=303)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        return _render(request, "message.html", {"title": "Not done", "message": exc.detail}, status=exc.status_code,
                       page_ctx=None)

    @app.exception_handler(Exception)
    async def _crash(request: Request, exc: Exception):
        msg = tenants.redact(f"{type(exc).__name__}: {exc}")
        return _render(request, "message.html", {"title": "Something went wrong", "message": msg}, status=500,
                       page_ctx=None)

    _routes(app)
    return app


# ---------------------------------------------------------------- request plumbing

def get_conn(request: Request):
    """A connection for the request (migrated once per process); DatabaseDown when the DB is not reachable."""
    st = request.app.state
    try:
        conn = st.cfg.connect()
    except psycopg.Error as e:
        raise DatabaseDown(tenants.redact(e)) from None
    try:
        if not st.migrated:
            with st.lock:
                if not st.migrated:
                    db.migrate(conn)
                    st.migrated = True
        yield conn
    finally:
        conn.close()


async def csrf_form(request: Request) -> FormData:
    form = await request.form()
    token = form.get("csrf")
    if not isinstance(token, str) or not secrets.compare_digest(token.encode(), request.app.state.csrf.encode()):
        raise HTTPException(403, "This form is out of date (the screen was restarted). Reload the page and try again.")
    return form


def _tenant(request: Request, conn, form: FormData | None = None, required: bool = True):
    """(tenants, chosen tenant): ?tenant= or the form's tenant field, then the cookie, then the first tenant."""
    ts = tenants.list_tenants(conn)
    if not ts:
        if required:
            raise NeedSetup()
        return ts, None
    want = (form.get("tenant") if form is not None else None) or request.query_params.get("tenant") \
        or request.cookies.get("tenant")
    chosen = next((t for t in ts if str(t.tenant_id) == str(want)), ts[0])
    return ts, chosen


def _run(request: Request, conn, t: tenants.Tenant) -> tuple[list[dict], dict | None]:
    """(recent runs, the run shown: ?run= if it is the tenant's, else the latest done run)."""
    rs = views.runs(conn, t)
    want = request.query_params.get("run")
    chosen = next((r for r in rs if r["run_id"] == want), None) if want else None
    if chosen is None:
        chosen = cli.latest_run(conn, t)
    return rs, chosen


def _report(request: Request, conn, t: tenants.Tenant, run: dict) -> dict:
    """cli.build_report for the run, cached until the next change made through the screen."""
    st = request.app.state
    key = (t.tenant_id, run["run_id"], run["month"])
    if key not in st.reports:
        if len(st.reports) > 20:
            st.reports.clear()
        st.reports[key] = cli.build_report(conn, t, run["run_id"], run["month"])
    return st.reports[key]


def _changed(app) -> None:
    app.state.reports.clear()


def _flash(app, kind: str, text: str) -> str:
    key = secrets.token_urlsafe(8)
    fl = app.state.flash
    fl[key] = (kind, text)
    while len(fl) > 50:
        fl.popitem(last=False)
    return key


def _redirect(app, path: str, t: tenants.Tenant | None, text: str | None = None, kind: str = "ok", **extra):
    q = {"tenant": t.tenant_id} if t is not None else {}
    if text:
        q["flash"] = _flash(app, kind, text)
    q.update(extra)
    return RedirectResponse(f"{path}?{urlencode(q)}" if q else path, status_code=303)


def _render(request: Request, name: str, ctx: dict, status: int = 200, page_ctx: dict | None = None):
    st = request.app.state
    base = {"demo": st.cfg.demo, "csrf": st.csrf, "tenants": [], "tenant": None, "run": None, "runs": [],
            "nav": request.url.path, "flash": None, "error": None, "currency": "", "show_run": False}
    base.update(page_ctx or {})
    key = request.query_params.get("flash")
    if key and key in st.flash:
        base["flash"] = st.flash.pop(key)
    base.update(ctx)
    if base["tenant"] is not None:
        base["currency"] = base["tenant"].currency
    resp = st.templates.TemplateResponse(request, name, base, status_code=status)
    t = base["tenant"]
    if t is not None and request.query_params.get("tenant") == str(t.tenant_id):
        resp.set_cookie("tenant", str(t.tenant_id), httponly=True, samesite="strict")
    return resp


def _page(request: Request, conn, with_run: bool = True) -> dict:
    ts, t = _tenant(request, conn)
    ctx = {"tenants": ts, "tenant": t}
    if with_run:
        ctx["runs"], ctx["run"] = _run(request, conn, t)
        ctx["show_run"] = True
    return ctx


def _error_text(e: Exception, t: tenants.Tenant | None = None) -> str:
    text = str(e) if isinstance(e, (ValueError, KeyError)) else f"{type(e).__name__}: {e}"
    if isinstance(e, KeyError) and e.args:
        text = str(e.args[0])
    return tenants.redact(text, t)


def _action_status(e: Exception) -> int:
    if isinstance(e, KeyError):
        return 404
    if isinstance(e, ValueError):
        return 400
    if isinstance(e, psycopg.Error):
        return 500
    return 502                                       # Shopify, Meta or network


# ---------------------------------------------------------------- routes

def _routes(app: FastAPI) -> None:
    # ------------------------------------------------ overview
    @app.get("/", response_class=HTMLResponse)
    def overview(request: Request, conn=Depends(get_conn)):
        pc = _page(request, conn)
        t, run = pc["tenant"], pc["run"]
        nm = views.names(conn, t)
        ctx = {"cards": views.decision_cards(conn, t, run["run_id"], nm) if run else {},
               "last": views.last_run(conn, t), "waiting": views.waiting(conn, t),
               "job": request.app.state.jobs.get(t.tenant_id)}
        return _render(request, "overview.html", ctx, page_ctx=pc)

    # ------------------------------------------------ lost sales and scorecard
    @app.get("/lost-sales", response_class=HTMLResponse)
    def lost_sales(request: Request, conn=Depends(get_conn)):
        pc = _page(request, conn)
        ctx = {}
        if pc["run"]:
            ctx["lost"] = views.lost_sales(_report(request, conn, pc["tenant"], pc["run"]),
                                           views.names(conn, pc["tenant"]))
        return _render(request, "lost_sales.html", ctx, page_ctx=pc)

    @app.get("/scorecard", response_class=HTMLResponse)
    def scorecard(request: Request, level: str = "style", conn=Depends(get_conn)):
        pc = _page(request, conn)
        level = level if level in ("style", "product") else "style"
        ctx = {"level": level}
        if pc["run"]:
            ctx["card"] = views.scorecard(_report(request, conn, pc["tenant"], pc["run"]),
                                          views.names(conn, pc["tenant"]), level, pc["tenant"])
        return _render(request, "scorecard.html", ctx, page_ctx=pc)

    # ------------------------------------------------ plan
    @app.get("/plan", response_class=HTMLResponse)
    def plan(request: Request, conn=Depends(get_conn)):
        pc = _page(request, conn)
        ctx = {"styles": views.plan(conn, pc["tenant"], pc["run"]["run_id"], views.names(conn, pc["tenant"]))
               if pc["run"] else []}
        return _render(request, "plan.html", ctx, page_ctx=pc)

    # ------------------------------------------------ purchase orders
    @app.get("/pos", response_class=HTMLResponse)
    def pos(request: Request, conn=Depends(get_conn)):
        pc = _page(request, conn)
        return _render(request, "pos.html", {"groups": views.po_groups(conn, pc["tenant"])}, page_ctx=pc)

    def _po_page(request, conn, pc, po_number, confirm=None, error=None, status=200):
        d = views.po_detail(conn, pc["tenant"], po_number, views.names(conn, pc["tenant"]))
        if d is None:
            raise HTTPException(404, f"There is no purchase order {po_number}.")
        return _render(request, "po.html", {**d, "confirm": confirm, "error": error}, status=status, page_ctx=pc)

    @app.get("/pos/{po}", response_class=HTMLResponse)
    def po_page(request: Request, po: str, confirm: str | None = None, conn=Depends(get_conn)):
        pc = _page(request, conn, with_run=False)
        return _po_page(request, conn, pc, po, confirm if confirm in ("push", "cancel") else None)

    def _po_action(request, conn, form, po, action: Callable, done: str):
        ts, t = _tenant(request, conn, form)
        pc = {"tenants": ts, "tenant": t}
        try:
            action(t)
        except Exception as e:                       # noqa: BLE001  shown readably, redacted
            conn.rollback()
            msg = _error_text(e, t)
            if isinstance(e, KeyError) and views.po_detail(conn, t, po, views.names(conn, t)) is None:
                raise HTTPException(404, msg)
            return _po_page(request, conn, pc, po, error=msg, status=_action_status(e))
        _changed(request.app)
        return _redirect(request.app, f"/pos/{po}", t, done)

    @app.post("/pos/{po}/approve")
    def po_approve(request: Request, po: str, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        edits = {}
        for k, v in form.multi_items():
            if k.startswith("qty_"):
                try:
                    edits[k[4:]] = int(str(v).strip())
                except ValueError:
                    edits = None
                    break
        if edits is None:
            ts, t = _tenant(request, conn, form)
            return _po_page(request, conn, {"tenants": ts, "tenant": t}, po,
                            error="Quantities must be whole numbers, 0 or more.", status=400)
        return _po_action(request, conn, form, po, lambda t: purchasing.approve_po(conn, t, po, edits or None),
                          f"Approved {po}. Nothing is sent to Shopify until you press Send to Shopify.")

    @app.post("/pos/{po}/push")
    def po_push(request: Request, po: str, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        if form.get("confirm") != "yes":
            raise HTTPException(400, "Sending to Shopify needs the confirmation step: press Send, then Yes, send.")
        return _po_action(request, conn, form, po, lambda t: purchasing.push_po(conn, t, po),
                          f"Sent {po} to Shopify as an inventory transfer (ready to ship).")

    @app.post("/pos/{po}/cancel")
    def po_cancel(request: Request, po: str, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        if form.get("confirm") != "yes":
            raise HTTPException(400, "Cancelling needs the confirmation step: press Cancel, then Yes, cancel.")
        return _po_action(request, conn, form, po, lambda t: purchasing.cancel_po(conn, t, po), f"Cancelled {po}.")

    @app.post("/pos/sync")
    def po_sync(request: Request, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        return _simple_action(request, conn, form, lambda t: f"{purchasing.sync_receipts(conn, t)} PO lines updated"
                              " from Shopify receipts.", default_next="/pos")

    # ------------------------------------------------ run
    @app.get("/run", response_class=HTMLResponse)
    def run_page(request: Request, conn=Depends(get_conn)):
        pc = _page(request, conn)
        t = pc["tenant"]
        progress = _progress(request.app, conn, t)
        running = progress["job"] is not None and progress["job"]["state"] == "running"
        return _render(request, "run.html", {"progress": progress, "running": running,
                                             "last": views.last_run(conn, t)}, page_ctx=pc)

    @app.get("/api/progress")
    def progress(request: Request, conn=Depends(get_conn)):
        ts, t = _tenant(request, conn, required=False)
        if t is None:
            return JSONResponse({"job": None, "run": None})
        return JSONResponse(_progress(request.app, conn, t))

    @app.post("/run/cycle")
    def run_cycle(request: Request, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        ts, t = _tenant(request, conn, form)
        connect = request.app.state.cfg.connect

        def target(job: Job):
            c = connect()
            try:
                run_id, ok, err = cli.run_cycle(c, t)
            finally:
                c.close()
            _changed(app)
            return ok, (f"run {run_id} done" if ok else f"run {run_id} failed at {err}")

        job, started = request.app.state.jobs.start(t.tenant_id, "cycle", target)
        if not started:
            what = "monthly cycle" if job.kind == "cycle" else "history load of the new store"
            return _redirect(app, "/run", t, f"The {what} is already running; here it is.", "info")
        return _redirect(app, "/run", t, "Monthly cycle started. It never approves or sends a purchase order.")

    @app.post("/run/snapshot")
    def run_snapshot(request: Request, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        return _simple_action(request, conn, form, lambda t: "Stock snapshot: " + cli.take_stock_snapshot(conn, t),
                              default_next="/run")

    def _simple_action(request, conn, form, action, default_next):
        ts, t = _tenant(request, conn, form)
        nxt = form.get("next") if form.get("next") in SAFE_NEXT else default_next
        try:
            text = action(t)
        except Exception as e:                       # noqa: BLE001  shown readably, redacted
            conn.rollback()
            return _redirect(app, nxt, t, _error_text(e, t), "error")
        _changed(request.app)
        return _redirect(app, nxt, t, text)

    # ------------------------------------------------ setup
    @app.get("/setup", response_class=HTMLResponse)
    def setup(request: Request, conn=Depends(get_conn)):
        return _setup_page(request, conn)

    def _setup_page(request, conn, form=None, error=None, status=200, values=None):
        ts, t = _tenant(request, conn, form, required=False)
        ctx = {"tenants": ts, "tenant": t, "error": error, "values": values or {},
               "env_file": str(request.app.state.cfg.env_file), "job": None, "ad_map_rows": AD_MAP_ROWS}
        if t is not None:
            nm = views.names(conn, t)
            today = cli.local_today(t)
            ctx.update(
                suppliers=views.suppliers(conn, t, nm), pending=views.lineage_pending(conn, t, nm),
                unmapped=views.unmapped_ads(conn, t), ad_maps=views.ad_maps(conn, t, nm),
                locations=views.locations(conn, t), promos=views.promo_ranges(views.promo_days(
                    conn, t, today - timedelta(days=60))),
                styles=sorted(nm["style"].items(), key=lambda kv: kv[1]),
                products=sorted(nm["product"].items(), key=lambda kv: kv[1]),
                job=request.app.state.jobs.get(t.tenant_id))
        return _render(request, "setup.html", ctx, status=status)

    def _setup_action(request, conn, form, action: Callable):
        ts, t = _tenant(request, conn, form)
        try:
            text = action(t)
        except Exception as e:                       # noqa: BLE001  shown readably, redacted
            conn.rollback()
            return _setup_page(request, conn, form, error=_error_text(e, t), status=_action_status(e))
        _changed(request.app)
        return _redirect(app, "/setup", t, text)

    @app.post("/setup/supplier")
    def setup_supplier(request: Request, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        def act(t):
            kind, _, ident = str(form.get("target") or "").partition(":")
            return "Saved " + cli.add_supplier(
                conn, t, str(form.get("name") or "").strip(), str(form.get("kind") or ""),
                _int(form, "lead_time", "Lead time"), _int(form, "pack", "Pack", 1), _int(form, "moq", "MOQ", 0),
                style=ident if kind == "style" else None, product=ident if kind == "product" else None)
        return _setup_action(request, conn, form, act)

    @app.post("/setup/lineage/confirm")
    def setup_lineage(request: Request, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        def act(t):
            lineage.confirm(conn, t, str(form.get("old") or ""), str(form.get("new") or ""))
            n = lineage.build_styles(conn, t)
            return f"Colour match confirmed; {n} styles."
        return _setup_action(request, conn, form, act)

    @app.post("/setup/ad-map")
    def setup_ad_map(request: Request, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        def act(t):
            ad_id = str(form.get("ad_id") or "").strip()
            shares = []
            for i in range(1, AD_MAP_ROWS + 1):
                prod = str(form.get(f"product_{i}") or "").strip()
                raw = str(form.get(f"share_{i}") or "").strip()
                if not prod:
                    continue
                try:
                    shares.append((prod, float(raw or "1")))
                except ValueError:
                    raise ValueError(f"share must be a number, got {raw!r}") from None
            got = cli.set_ad_map(conn, t, ad_id, shares)
            span = conn.execute("SELECT min(date) AS lo, max(date) AS hi FROM unmapped_spend_log WHERE tenant_id = %s"
                                " AND ad_id = %s", (t.tenant_id, ad_id)).fetchone()
            note = ""
            if span["lo"] is not None:
                attribution.run_attribution(conn, t, span["lo"], span["hi"])
                note = f" Spend from {span['lo']} to {span['hi']} re-split."
            nm = views.names(conn, t)
            return f"Ad {ad_id}: " + ", ".join(f"{views.entity_name(nm, 'product', p)} {w:.0%}"
                                               for p, w in got.items()) + "." + note
        return _setup_action(request, conn, form, act)

    @app.post("/setup/location")
    def setup_location(request: Request, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        def act(t):
            t2 = tenants.set_main_location(conn, t, str(form.get("location") or "").strip())
            return f"Main location set to {t2.main_location_id}."
        return _setup_action(request, conn, form, act)

    @app.post("/setup/promo")
    def setup_promo(request: Request, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        def act(t):
            try:
                s, e = date.fromisoformat(str(form.get("start"))), date.fromisoformat(str(form.get("end") or
                                                                                         form.get("start")))
            except ValueError:
                raise ValueError("give the first and last day as dates") from None
            off = form.get("off") == "on"
            n = cli.set_promo(conn, t, s, e, off)
            return f"Promo {'cleared' if off else 'set'} for {s} to {e} ({n} days)."
        return _setup_action(request, conn, form, act)

    @app.post("/setup/store")
    def setup_store(request: Request, form: FormData = Depends(csrf_form), conn=Depends(get_conn)):
        cfg = request.app.state.cfg
        values = {k: str(form.get(k) or "").strip() for k in ("name", "shop", "meta_accounts", "po_prefix")}
        if cfg.demo:
            return _setup_page(request, conn, form, error="The sample store cannot connect a real store. Start the"
                               " screen without --demo to connect yours.", status=400, values=values)
        shop_token, meta_token = str(form.get("shopify_token") or "").strip(), str(form.get("meta_token") or "").strip()
        try:
            shop_env, meta_env = envfile.token_env_names(values["name"])
        except ValueError as e:
            return _setup_page(request, conn, form, error=str(e), status=400, values=values)
        accounts = [a for a in values["meta_accounts"].replace(",", " ").split() if a]
        missing = [label for label, v in (("store name", values["name"]), ("shop domain", values["shop"]),
                                          ("Shopify token", shop_token), ("Meta token", meta_token),
                                          ("PO prefix", values["po_prefix"])) if not v]
        if missing:
            return _setup_page(request, conn, form, error="Please fill in: " + ", ".join(missing) + ".", status=400,
                               values=values)
        clash = _store_clash(conn, values["name"], values["shop"], shop_env, meta_env)
        if clash:
            return _setup_page(request, conn, form, error=clash, status=400, values=values)
        # The tokens live only in this process's environment while add_tenant checks them; the env file is
        # written after the store is accepted, and the previous values come back if it is refused.
        previous = {n: os.environ.get(n) for n in (shop_env, meta_env)}
        os.environ[shop_env], os.environ[meta_env] = shop_token, meta_token
        warnings: list[str] = []
        try:
            t = tenants.add_tenant(conn, values["name"], values["shop"], shop_env, meta_env, accounts,
                                   values["po_prefix"], warnings=warnings)
        except Exception as e:                       # noqa: BLE001  HTTP errors included; never echo a token
            conn.rollback()
            msg = str(e) if isinstance(e, ValueError) else f"{type(e).__name__}: {e}"
            msg = tenants.redact(msg, env_names=(shop_env, meta_env))      # while the values are still set
            _restore_env(previous)
            return _setup_page(request, conn, form, error=msg, status=_action_status(e), values=values)
        _changed(request.app)
        try:
            envfile.write_env(cfg.env_file, {shop_env: shop_token, meta_env: meta_token})
            saved = f"Tokens saved in {cfg.env_file} as {shop_env} and {meta_env}."
        except (OSError, ValueError) as e:
            saved = (f"The tokens could not be saved in {cfg.env_file} ({tenants.redact(e, t)}): add {shop_env} and"
                     f" {meta_env} there yourself before the next start.")
        text = f"Connected {t.name} ({t.timezone}, {t.currency}). {saved}"
        if warnings:
            text += " Warning: " + "; ".join(warnings)
        if form.get("skip_history") != "on":
            connect = cfg.connect

            def target(job: Job):
                c = connect()
                try:
                    return cli.ingest_history(c, t, wrap=job.stage_wrapper)
                finally:
                    c.close()
            request.app.state.jobs.start(t.tenant_id, "history", target)
            text += " Loading the full history now (see Run)."
        return _redirect(app, "/setup", t, text)

    @app.post("/setup/database")
    def setup_database(request: Request, form: FormData = Depends(csrf_form)):
        cfg = request.app.state.cfg
        url = str(form.get("database_url") or "").strip()
        if cfg.demo or not url.startswith(("postgresql://", "postgres://")):
            return _render(request, "database.html", {"error": "Give a Postgres URL starting with postgresql://"},
                           status=400)
        envfile.write_env(cfg.env_file, {"DATABASE_URL": url})
        os.environ["DATABASE_URL"] = url
        return RedirectResponse("/", status_code=303)


def _store_clash(conn, name: str, shop: str, shop_env: str, meta_env: str) -> str | None:
    """Why a new store would overwrite a connected one (same name, same shop, or token env var names in use by
    another store), or None."""
    row = conn.execute("SELECT name FROM tenants WHERE lower(name) = lower(%s) OR lower(shop_domain) = lower(%s)"
                       " LIMIT 1", (name, shop)).fetchone()
    if row is not None:
        return f"The store {row['name']} is already connected (same name or shop domain); nothing was changed."
    row = conn.execute("SELECT name, shopify_token_env, meta_token_env FROM tenants WHERE shopify_token_env = ANY(%s)"
                       " OR meta_token_env = ANY(%s) LIMIT 1", ([shop_env, meta_env], [shop_env, meta_env])).fetchone()
    if row is not None:
        return (f"The store {row['name']} already keeps its tokens in {row['shopify_token_env']} and"
                f" {row['meta_token_env']}; choose a store name that gives other names than {shop_env}."
                " Nothing was changed.")
    return None


def _restore_env(previous: dict[str, str | None]) -> None:
    for name, value in previous.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value


def _int(form: FormData, key: str, label: str, default: int | None = None) -> int:
    raw = str(form.get(key) or "").strip()
    if not raw and default is not None:
        return default
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f"{label} must be a whole number") from None


def _progress(app, conn, t: tenants.Tenant) -> dict:
    """The tenant's job (if any) and its latest run with runs.stages (stage, status done/warning/failed, seconds)."""
    job = app.state.jobs.get(t.tenant_id)
    r = conn.execute("SELECT run_id, month, status, started_at, finished_at, stages FROM runs WHERE tenant_id = %s"
                     " ORDER BY started_at DESC LIMIT 1", (t.tenant_id,)).fetchone()
    run = None
    if r is not None and not (job is not None and job.kind == "cycle" and r["started_at"] < job.started_at):
        done = views.stage_rows(r["stages"])
        names = {s["name"] for s in done}
        run = {"run_id": r["run_id"], "month": r["month"], "status": r["status"],
               "started_at": r["started_at"].isoformat(),
               "finished_at": r["finished_at"].isoformat() if r["finished_at"] else None,
               "stages": done, "pending": [{"name": n, "label": views.STAGE_LABELS.get(n, n)}
                                           for n in cli.CYCLE_STAGES if n not in names] if r["status"] == "running"
               else []}
    return {"job": job.public() if job is not None else None, "run": run}
