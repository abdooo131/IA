"""Run context, logging, plan printing, output naming and the no hyphen rule."""
from __future__ import annotations

import datetime as dt
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

CATEGORIES = (
    "restock_alert",
    "dead_stock",
    "overstock",
    "discrepancy",
    "demand_forecast",
    "purchase_order",
    "markdown_recommendation",
    "markup_recommendation",
    "merch_tracker",
    "cancelled_orders",
    "accuracy_report",
)

# Columns that hold identifiers copied from Shopify. They must stay exact, so they are never rewritten.
EXACT_COLUMNS = {"sku", "barcode", "variant_id", "product_id", "order_id", "order_name", "location_id"}

_HYPHENS = re.compile(r"[-‐‑‒–—−]")


def no_hyphen(text):
    """Replace every hyphen or dash in human text with a space and tidy the spacing."""
    if not isinstance(text, str):
        return text
    out = _HYPHENS.sub(" ", text)
    return re.sub(r" {2,}", " ", out).strip()


def fmt_date(d: dt.date) -> str:
    """Human date without hyphens, example 2026 10 03."""
    return d.strftime("%Y %m %d")


def file_date(d: dt.date) -> str:
    return d.strftime("%Y_%m_%d")


def week_of_month(d: dt.date) -> int:
    return (d.day - 1) // 7 + 1


def output_path(outputs_dir: Path, category: str, as_of: dt.date, ext: str = "xlsx", suffix: str = "") -> Path:
    """outputs/yyyy/mm/week_N/category_yyyy_mm_dd[_suffix].ext"""
    if category not in CATEGORIES:
        raise ValueError(
            f"Category {category} is not in the agreed list. Flag it to Assal before adding a new category."
        )
    folder = Path(outputs_dir) / f"{as_of.year:04d}" / f"{as_of.month:02d}" / f"week_{week_of_month(as_of)}"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{category}_{file_date(as_of)}"
    if suffix:
        clean = re.sub(r"[^a-z0-9]+", "_", suffix.lower()).strip("_")
        name = f"{name}_{clean}"
    return folder / f"{name}.{ext}"


class NoHyphenFormatter(logging.Formatter):
    def format(self, record):
        return no_hyphen(super().format(record))


@dataclass
class RunContext:
    command: str
    settings: object
    db_path: Path
    outputs_dir: Path
    logs_dir: Path
    run_id: str = ""
    started_at: dt.datetime = field(default_factory=dt.datetime.now)
    log: logging.Logger | None = None
    notes: list = field(default_factory=list)
    proposals: list = field(default_factory=list)

    def __post_init__(self):
        if not self.run_id:
            self.run_id = "run_" + self.started_at.strftime("%Y%m%d_%H%M%S_%f")
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.outputs_dir.mkdir(parents=True, exist_ok=True)
        logger = logging.getLogger(self.run_id)
        logger.setLevel(logging.INFO)
        logger.propagate = False
        if not logger.handlers:
            fh = logging.FileHandler(self.logs_dir / f"{self.run_id}.log", encoding="utf8")
            fh.setFormatter(NoHyphenFormatter("%(asctime)s %(levelname)s %(message)s", "%Y/%m/%d %H:%M:%S"))
            logger.addHandler(fh)
        self.log = logger

    def info(self, msg: str, echo: bool = True):
        msg = no_hyphen(msg)
        self.log.info(msg)
        if echo:
            print(msg)

    def warn(self, msg: str, echo: bool = True):
        msg = no_hyphen(msg)
        self.log.warning(msg)
        self.notes.append(msg)
        if echo:
            print("WARNING " + msg)

    def plan(self, text: str):
        """Every run prints a one or two line plan before doing work."""
        self.info("PLAN " + text)

    def propose(self, area: str, current, proposed, reason: str):
        """The system proposes config changes and waits for confirmation. It never edits config itself."""
        item = {
            "area": no_hyphen(area),
            "current": no_hyphen(str(current)),
            "proposed": no_hyphen(str(proposed)),
            "reason": no_hyphen(reason),
        }
        self.proposals.append(item)
        self.info(f"PROPOSAL {item['area']}: change {item['current']} to {item['proposed']} because {item['reason']}")
