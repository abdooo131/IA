"""Config loading. YAML files are read only, the system never writes them."""
from __future__ import annotations

import copy
import datetime as dt
from dataclasses import dataclass, field
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def parse_date(value) -> dt.date:
    """Accept yyyy_mm_dd, yyyy mm dd, yyyy/mm/dd or ISO dates."""
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    text = str(value).strip()
    for sep in ("_", " ", "/", "-", "."):
        text = text.replace(sep, "|")
    y, m, d = (int(p) for p in text.split("|"))
    return dt.date(y, m, d)


def _deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


@dataclass
class Settings:
    settings: dict
    suppliers: dict
    events: dict
    root: Path = PROJECT_ROOT
    overrides: dict = field(default_factory=dict)

    def __getitem__(self, key):
        return self.settings[key]

    def get(self, *keys, default=None):
        node = self.settings
        for k in keys:
            if not isinstance(node, dict) or k not in node:
                return default
            node = node[k]
        return node

    def path(self, key: str) -> Path:
        p = Path(self.settings["paths"][key])
        return p if p.is_absolute() else self.root / p

    @property
    def api_version(self) -> str:
        return str(self.settings["store"]["api_version"]).replace("_", "-")


def load_settings(config_dir: Path | None = None, overrides: dict | None = None) -> Settings:
    config_dir = Path(config_dir) if config_dir else PROJECT_ROOT / "config"
    with open(config_dir / "settings.yaml") as f:
        settings = yaml.safe_load(f)
    with open(config_dir / "suppliers.yaml") as f:
        suppliers = yaml.safe_load(f)
    with open(config_dir / "events.yaml") as f:
        events = yaml.safe_load(f)
    settings = _deep_merge(settings, overrides or {})
    return Settings(settings=settings, suppliers=suppliers or {}, events=events or {}, overrides=overrides or {})
