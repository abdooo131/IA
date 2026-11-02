"""Pixel collector. POST /e/{tenant_id} with an HMAC signed JSON body.

Stores only a hashed session id: no IP, user agent, email or raw session id is kept or logged.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from .. import db, tenants
from .funnel import rollup_funnel  # noqa: F401  (re-exported)

MAX_BODY = 16 * 1024
EVENTS = {"product_viewed", "product_added_to_cart", "checkout_completed", "size_selected", "notify_me"}
PRODUCT_GID = "gid://shopify/Product/"
VARIANT_GID = "gid://shopify/ProductVariant/"


def _norm_id(v, prefix: str) -> str | None:
    """Numeric or GID -> GID, the format stored in products."""
    if v is None or v == "":
        return None
    s = str(v).strip()
    if s.startswith("gid://"):
        s = s.rsplit("/", 1)[-1]
    if not s.isdigit():
        raise ValueError(f"bad id {s!r}")
    return prefix + s


def session_hash(pixel_key: str, session_id: str) -> str:
    return hashlib.sha256(f"{pixel_key}:{session_id}".encode()).hexdigest()


def _parse(body: bytes, pixel_key: str) -> list[tuple]:
    """Body -> pixel_events value tuples (without tenant_id). Raises ValueError when malformed."""
    try:
        d = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise ValueError("malformed json")
    if not isinstance(d, dict):
        raise ValueError("body must be an object")
    event = d.get("event")
    if event not in EVENTS:
        raise ValueError("unknown event")
    sid = d.get("session_id")
    if not isinstance(sid, str) or not sid:
        raise ValueError("session_id required")
    try:
        ts = datetime.fromisoformat(str(d.get("ts")).replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("bad ts")
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    avail = d.get("available")
    if avail is not None and not isinstance(avail, bool):
        raise ValueError("available must be boolean")
    sh = session_hash(pixel_key, sid)
    if event == "checkout_completed":
        items = d.get("line_items")
        if not isinstance(items, list) or not items:
            raise ValueError("line_items required")
        out = []
        for it in items:
            if not isinstance(it, dict):
                raise ValueError("bad line item")
            pid, vid = _norm_id(it.get("product_id"), PRODUCT_GID), _norm_id(it.get("variant_id"), VARIANT_GID)
            if not pid and not vid:
                raise ValueError("line item needs product_id or variant_id")
            out.append((ts, sh, event, pid, vid, None))
        return out
    pid, vid = _norm_id(d.get("product_id"), PRODUCT_GID), _norm_id(d.get("variant_id"), VARIANT_GID)
    if not pid and not vid:
        raise ValueError("product_id or variant_id required")
    if event == "size_selected" and not vid:
        raise ValueError("variant_id required")
    return [(ts, sh, event, pid, vid, avail)]


def _store(connect, tenant_id: int, body: bytes, signature: str | None) -> int:
    conn = connect()
    try:
        try:
            t = tenants.get_tenant(conn, tenant_id)
        except KeyError:
            return 404
        if len(body) > MAX_BODY:
            return 413
        want = hmac.new(t.pixel_key.encode(), body, hashlib.sha256).hexdigest()
        if not signature or not hmac.compare_digest(want, signature.strip().lower()):
            return 401
        try:
            rows = _parse(body, t.pixel_key)
        except ValueError:
            return 400
        for r in rows:
            conn.execute(
                "INSERT INTO pixel_events (tenant_id, ts, session_hash, event, product_id, variant_id, available)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s)", (t.tenant_id, *r))
        conn.commit()
        return 204
    finally:
        conn.close()


def create_app(connect=db.connect) -> FastAPI:
    app = FastAPI(title="pixel collector", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["POST", "OPTIONS"],
                       allow_headers=["Content-Type", "X-Signature"], max_age=86400)

    @app.post("/e/{tenant_id}")
    async def collect(tenant_id: str, request: Request):
        if not tenant_id.isdigit():
            return Response(status_code=404)
        cl = request.headers.get("content-length")
        if cl and cl.isdigit() and int(cl) > MAX_BODY:
            tid = int(tenant_id)
            body = b"x" * (MAX_BODY + 1)  # size known too large; still 404 for unknown tenants
        else:
            tid = int(tenant_id)
            body = await request.body()
        status = await run_in_threadpool(_store, connect, tid, body, request.headers.get("x-signature"))
        return Response(status_code=status)

    return app


_app: FastAPI | None = None


def __getattr__(name: str):
    """`app` is built on first access so importing this module never connects."""
    global _app
    if name == "app":
        if _app is None:
            _app = create_app()
        return _app
    raise AttributeError(name)
