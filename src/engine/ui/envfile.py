"""The user's env file (default ~/.engine_env): `export NAME="value"` lines the launcher sources.

Tokens typed into the screen are written here (mode 600) and into the running process environment, never into
the database. Lines are updated in place by name; other lines are kept.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

DEFAULT_PATH = Path.home() / ".engine_env"
_LINE = re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$')
_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def env_prefix(store_name: str) -> str:
    """Env var prefix from a store name: 'Eve Chantelle' -> 'EVE_CHANTELLE'."""
    p = re.sub(r"[^A-Z0-9]+", "_", store_name.upper()).strip("_")
    if not p:
        raise ValueError("the store name needs at least one letter or digit")
    return p if not p[0].isdigit() else f"S_{p}"


def token_env_names(store_name: str) -> tuple[str, str]:
    """(Shopify token env var, Meta token env var) for a store."""
    p = env_prefix(store_name)
    return f"{p}_SHOPIFY_TOKEN", f"{p}_META_TOKEN"


def _quote(value: str) -> str:
    if "\n" in value or "\r" in value:
        raise ValueError("a value cannot span lines")
    return '"' + re.sub(r'(["\\$`])', r"\\\1", value) + '"'


def _unquote(raw: str) -> str:
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] == "'":
        return raw[1:-1]
    if len(raw) >= 2 and raw[0] == raw[-1] == '"':
        return re.sub(r'\\(["\\$`])', r"\1", raw[1:-1])
    return raw


def read_env(path: Path) -> dict[str, str]:
    """NAME -> value of the file's assignments (missing file: {})."""
    try:
        text = path.read_text()
    except FileNotFoundError:
        return {}
    out = {}
    for line in text.splitlines():
        m = _LINE.match(line)
        if m and not line.lstrip().startswith("#"):
            out[m.group(1)] = _unquote(m.group(2))
    return out


def write_env(path: Path, values: dict[str, str]) -> None:
    """Set `export NAME="value"` for each name: replace the name's existing line(s), append new ones. The file is
    created with mode 600 and kept at 600."""
    for name in values:
        if not _NAME.match(name):
            raise ValueError(f"not an environment variable name: {name!r}")
    try:
        lines = path.read_text().splitlines()
    except FileNotFoundError:
        lines = []
    done: set[str] = set()
    out = []
    for line in lines:
        m = _LINE.match(line)
        name = m.group(1) if m and not line.lstrip().startswith("#") else None
        if name in values:
            if name not in done:
                out.append(f"export {name}={_quote(values[name])}")
                done.add(name)
            continue
        out.append(line)
    out += [f"export {n}={_quote(v)}" for n, v in values.items() if n not in done]
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)                    # an existing file too, before any secret is written
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(out) + "\n")


def load_into_environ(path: Path) -> list[str]:
    """Set the file's variables that the process environment lacks; returns the names set."""
    added = []
    for name, value in read_env(path).items():
        if name not in os.environ:
            os.environ[name] = value
            added.append(name)
    return added
