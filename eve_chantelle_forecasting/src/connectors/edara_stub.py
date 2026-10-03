"""Edara ERP connector interface (out of scope for v1, ready for later).

When built, it should supply unit costs, open supplier POs and received goods. Open POs will feed the
incoming quantity and received goods will confirm real lead times per supplier.
"""
from __future__ import annotations

import pandas as pd


class EdaraConnector:
    def unit_costs(self) -> pd.DataFrame:
        """Columns: sku, unit_cost, currency, valid_from."""
        raise NotImplementedError

    def open_purchase_orders(self) -> pd.DataFrame:
        """Columns: po_number, supplier, sku, quantity, expected_date."""
        raise NotImplementedError

    def received_goods(self) -> pd.DataFrame:
        """Columns: po_number, supplier, sku, quantity, received_date, ordered_date."""
        raise NotImplementedError


class NullEdara(EdaraConnector):
    """Used until the Edara integration exists. Returns empty frames so the pipeline runs unchanged."""

    def unit_costs(self):
        return pd.DataFrame(columns=["sku", "unit_cost", "currency", "valid_from"])

    def open_purchase_orders(self):
        return pd.DataFrame(columns=["po_number", "supplier", "sku", "quantity", "expected_date"])

    def received_goods(self):
        return pd.DataFrame(columns=["po_number", "supplier", "sku", "quantity", "received_date", "ordered_date"])
