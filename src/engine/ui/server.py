"""Start the screen: `engine ui [--port 8765] [--demo] [--demo-db URL] [--no-browser]`."""
from __future__ import annotations

import logging
import os
import socket
import threading
import webbrowser
from pathlib import Path
from typing import Callable

import uvicorn

from .. import config, db, tenants
from . import envfile
from .app import UiConfig, create_app

HOST = "127.0.0.1"                       # never 0.0.0.0: the screen is for this computer only
log = logging.getLogger("engine.ui")


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)   # like uvicorn: a just closed run is not "in use"
        try:
            s.bind((HOST, port))
        except OSError:
            return False
    return True


def database_connect(default_url: str = config.DEFAULT_DATABASE_URL) -> Callable:
    """Connection factory: DATABASE_URL when set (read at each connect, so a URL saved on the Setup page takes
    effect), else the default local database, created on first use if the server lacks it (never wiped)."""
    ensured: set[str] = set()

    def connect():
        url = os.environ.get("DATABASE_URL")
        if url:
            return db.connect(url)
        if default_url not in ensured:
            db.ensure_database(default_url)
            ensured.add(default_url)
        return db.connect(default_url)
    return connect


def build_demo(url: str) -> None:
    """Wipe the demo database at url (created if missing; never the engine's own database or one holding real
    stores), install the sample store's fake clients in this process and load the store (two monthly cycles)."""
    from .. import demo
    demo.reset_database(url)
    store = demo.DemoStore()
    demo.install(store)
    with db.connect(url) as conn:
        demo.load(conn, store)


def serve(port: int = 8765, demo: bool = False, demo_db: str | None = None, open_browser: bool = True,
          env_file: Path = envfile.DEFAULT_PATH) -> None:
    address = f"http://{HOST}:{port}"
    if not port_free(port):
        raise SystemExit(f"Port {port} is already in use: the screen may already be running at {address}"
                         " (open that address), or start it on another port with --port.")
    envfile.load_into_environ(env_file)          # tokens and DATABASE_URL saved by the screen or the launcher
    if demo:
        from .. import demo as demo_mod
        url = demo_db or demo_mod.demo_url(config.database_url())
        print("Building the sample store (made up data), about 20 seconds...", flush=True)
        try:
            build_demo(url)
        except Exception as e:                   # noqa: BLE001
            raise SystemExit(f"Could not build the sample store in {tenants.redact(url)}: {tenants.redact(e)}")
        connect = lambda: db.connect(url)        # noqa: E731
    else:
        connect = database_connect()
    app = create_app(UiConfig(port=port, connect=connect, demo=demo, env_file=env_file))
    print(f"Store engine screen: {address}  (press Ctrl+C to stop)", flush=True)
    if open_browser:
        threading.Timer(1.0, webbrowser.open, args=(address,)).start()
    uvicorn.run(app, host=HOST, port=port, access_log=False, log_level="warning")
