"""Database access: connect, migrate, and tenant scoped queries."""
from __future__ import annotations

from importlib import resources
from typing import Any, Mapping

import psycopg
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row

from . import config


def connect(url: str | None = None) -> psycopg.Connection:
    """Open a connection returning dict rows. Caller commits."""
    return psycopg.connect(url or config.database_url(), row_factory=dict_row)


def ensure_database(url: str) -> str:
    """Create the database url names if the server lacks it (via the server's `postgres` database); an existing
    database is left as it is, never wiped. Returns url. Raises psycopg errors when the server is unreachable."""
    name = conninfo_to_dict(url).get("dbname")
    try:
        psycopg.connect(url).close()
        return url
    except psycopg.OperationalError as e:
        if not name or "does not exist" not in str(e):
            raise
    with psycopg.connect(make_conninfo(url, dbname="postgres"), autocommit=True) as admin:
        if admin.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone() is None:
            admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    return url


def _migration_files():
    d = resources.files("engine") / "migrations"
    return sorted((p for p in d.iterdir() if p.name.endswith(".sql")), key=lambda p: p.name)


def migrate(conn: psycopg.Connection) -> list[str]:
    """Apply each migration file once, in filename order. Returns names applied now."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        "name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
    )
    conn.commit()
    done = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations")}
    applied = []
    for f in _migration_files():
        if f.name in done:
            continue
        conn.execute(f.read_text())
        conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (f.name,))
        conn.commit()
        applied.append(f.name)
    return applied


class Scoped:
    """Runs queries for exactly one tenant.

    SQL must reference %(tenant_id)s (so it filters by tenant); the value is
    injected and cannot be overridden by the caller's params.
    """

    def __init__(self, conn: psycopg.Connection, tenant_id: int):
        self.conn = conn
        self.tenant_id = tenant_id

    def _params(self, sql: str, params: Mapping[str, Any] | None) -> dict:
        if "%(tenant_id)s" not in sql:
            raise ValueError("scoped query must filter on %(tenant_id)s")
        p = dict(params or {})
        if "tenant_id" in p and p["tenant_id"] != self.tenant_id:
            raise ValueError("cannot override tenant_id in a scoped query")
        p["tenant_id"] = self.tenant_id
        return p

    def query(self, sql: str, params: Mapping[str, Any] | None = None) -> list[dict]:
        return self.conn.execute(sql, self._params(sql, params)).fetchall()

    def execute(self, sql: str, params: Mapping[str, Any] | None = None) -> None:
        self.conn.execute(sql, self._params(sql, params))


def scoped(conn: psycopg.Connection, tenant) -> Scoped:
    """tenant may be a Tenant or a tenant_id."""
    return Scoped(conn, getattr(tenant, "tenant_id", tenant))
