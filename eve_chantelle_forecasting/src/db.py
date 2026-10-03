"""DuckDB warehouse: schema and small helpers."""
from __future__ import annotations

from pathlib import Path

import duckdb
import pandas as pd

SCHEMA = [
    # Raw layer, one row per Shopify object, upserted by id
    """CREATE TABLE IF NOT EXISTS raw_orders (
        order_id VARCHAR PRIMARY KEY, name VARCHAR, created_at TIMESTAMP, processed_at TIMESTAMP,
        updated_at TIMESTAMP, cancelled_at TIMESTAMP, cancel_reason VARCHAR, financial_status VARCHAR,
        fulfillment_status VARCHAR, source_name VARCHAR, tags VARCHAR, discount_codes VARCHAR,
        total_discounts DOUBLE, total_price DOUBLE, is_test BOOLEAN, shipping_city VARCHAR,
        shipping_governorate VARCHAR, customer_id VARCHAR, location_id VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS raw_line_items (
        line_item_id VARCHAR PRIMARY KEY, order_id VARCHAR, variant_id VARCHAR, product_id VARCHAR,
        sku VARCHAR, quantity INTEGER, current_quantity INTEGER, unfulfilled_quantity INTEGER,
        original_unit_price DOUBLE, discounted_unit_price DOUBLE, total_discount DOUBLE)""",
    """CREATE TABLE IF NOT EXISTS raw_refunds (
        refund_line_id VARCHAR PRIMARY KEY, refund_id VARCHAR, order_id VARCHAR, line_item_id VARCHAR,
        quantity INTEGER, restock_type VARCHAR, subtotal DOUBLE, created_at TIMESTAMP)""",
    """CREATE TABLE IF NOT EXISTS raw_products (
        product_id VARCHAR PRIMARY KEY, title VARCHAR, product_type VARCHAR, vendor VARCHAR, tags VARCHAR,
        status VARCHAR, collections VARCHAR, created_at TIMESTAMP, published_at TIMESTAMP, updated_at TIMESTAMP)""",
    """CREATE TABLE IF NOT EXISTS raw_variants (
        variant_id VARCHAR PRIMARY KEY, product_id VARCHAR, sku VARCHAR, title VARCHAR, barcode VARCHAR,
        options_json VARCHAR, price DOUBLE, compare_at_price DOUBLE, inventory_item_id VARCHAR,
        unit_cost DOUBLE, inventory_policy VARCHAR, created_at TIMESTAMP, updated_at TIMESTAMP,
        last_seen_at TIMESTAMP)""",
    """CREATE TABLE IF NOT EXISTS raw_inventory_levels (
        inventory_item_id VARCHAR, location_id VARCHAR, available INTEGER, committed INTEGER,
        incoming INTEGER, on_hand INTEGER, pulled_at TIMESTAMP, PRIMARY KEY (inventory_item_id, location_id))""",
    """CREATE TABLE IF NOT EXISTS raw_locations (
        location_id VARCHAR PRIMARY KEY, name VARCHAR, is_active BOOLEAN)""",
    """CREATE TABLE IF NOT EXISTS sync_state (
        entity VARCHAR PRIMARY KEY, last_synced_at TIMESTAMP, last_run_id VARCHAR)""",
    # Snapshots, written on every sync because Shopify keeps no stock or price history
    """CREATE TABLE IF NOT EXISTS fact_inventory_snapshot (
        date DATE, variant_id VARCHAR, location_id VARCHAR, on_hand INTEGER, available INTEGER,
        committed INTEGER, incoming INTEGER, PRIMARY KEY (date, variant_id, location_id))""",
    """CREATE TABLE IF NOT EXISTS fact_price_history (
        date DATE, variant_id VARCHAR, price DOUBLE, compare_at_price DOUBLE, PRIMARY KEY (date, variant_id))""",
    # Run bookkeeping
    """CREATE TABLE IF NOT EXISTS run_log (
        run_id VARCHAR, command VARCHAR, started_at TIMESTAMP, finished_at TIMESTAMP, status VARCHAR,
        as_of DATE, summary VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS config_proposals (
        run_id VARCHAR, area VARCHAR, current_value VARCHAR, proposed_value VARCHAR, reason VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS cap_log (
        run_id VARCHAR, date DATE, variant_id VARCHAR, original DOUBLE, capped DOUBLE, threshold DOUBLE)""",
    # Model outputs keyed by run
    """CREATE TABLE IF NOT EXISTS forecasts (
        run_id VARCHAR, variant_id VARCHAR, date DATE, model VARCHAR, mean DOUBLE, p10 DOUBLE, p50 DOUBLE, p90 DOUBLE)""",
    """CREATE TABLE IF NOT EXISTS forecasts_weekly (
        run_id VARCHAR, variant_id VARCHAR, week INTEGER, week_start DATE, model VARCHAR,
        mean DOUBLE, p10 DOUBLE, p50 DOUBLE, p90 DOUBLE)""",
    """CREATE TABLE IF NOT EXISTS backtest_results (
        run_id VARCHAR, variant_id VARCHAR, model VARCHAR, horizon INTEGER, folds INTEGER,
        wape DOUBLE, bias DOUBLE, mase DOUBLE, p90_hit_rate DOUBLE, abs_error DOUBLE, actual DOUBLE)""",
    """CREATE TABLE IF NOT EXISTS model_selection (
        run_id VARCHAR, variant_id VARCHAR, demand_class VARCHAR, adi DOUBLE, cv2 DOUBLE, history_days INTEGER,
        winner VARCHAR, wape DOUBLE, bias DOUBLE, mase DOUBLE, p90_hit_rate DOUBLE, folds INTEGER,
        dispersion DOUBLE, confidence VARCHAR, confidence_reason VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS recommendations (
        run_id VARCHAR, variant_id VARCHAR, type VARCHAR, quantity DOUBLE, reason VARCHAR, confidence VARCHAR)""",
    """CREATE TABLE IF NOT EXISTS accuracy_history (
        run_id VARCHAR, as_of DATE, scope VARCHAR, model VARCHAR, wape DOUBLE, bias DOUBLE, skus INTEGER)""",
]


def connect(db_path: Path, read_only: bool = False) -> duckdb.DuckDBPyConnection:
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(db_path), read_only=read_only)
    if not read_only:
        for stmt in SCHEMA:
            con.execute(stmt)
    return con


def replace_table(con, name: str, df: pd.DataFrame):
    """Rebuild a derived table from a DataFrame. Used for the clean layer, which is fully rebuilt each run."""
    con.register("_tmp_df", df)
    con.execute(f"CREATE OR REPLACE TABLE {name} AS SELECT * FROM _tmp_df")
    con.unregister("_tmp_df")


def upsert(con, name: str, df: pd.DataFrame, key_cols: list[str]):
    """Delete rows with matching keys, then insert. Column order follows the table."""
    if df is None or df.empty:
        return 0
    cols = [r[0] for r in con.execute(f"DESCRIBE {name}").fetchall()]
    df = df.reindex(columns=cols)
    con.register("_up_df", df)
    cond = " AND ".join(f"t.{k} = s.{k}" for k in key_cols)
    con.execute(f"DELETE FROM {name} t WHERE EXISTS (SELECT 1 FROM _up_df s WHERE {cond})")
    con.execute(f"INSERT INTO {name} SELECT * FROM _up_df")
    con.unregister("_up_df")
    return len(df)


def append(con, name: str, df: pd.DataFrame):
    if df is None or df.empty:
        return 0
    cols = [r[0] for r in con.execute(f"DESCRIBE {name}").fetchall()]
    df = df.reindex(columns=cols)
    con.register("_ap_df", df)
    con.execute(f"INSERT INTO {name} SELECT * FROM _ap_df")
    con.unregister("_ap_df")
    return len(df)


def table_exists(con, name: str) -> bool:
    return bool(
        con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = ?", [name]).fetchone()[0]
    )


def df(con, sql: str, params=None) -> pd.DataFrame:
    return con.execute(sql, params or []).df()


def latest_run(con, command: str) -> tuple[str, object] | None:
    row = con.execute(
        "SELECT run_id, as_of FROM run_log WHERE command = ? AND status = 'ok' ORDER BY finished_at DESC LIMIT 1",
        [command],
    ).fetchone()
    return (row[0], row[1]) if row else None
