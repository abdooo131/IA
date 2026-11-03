"""Start the screen: `engine ui [--port 8765] [--demo] [--demo-db URL] [--no-browser]`."""
from __future__ import annotations

import logging
import os
import threading
import webbrowser
from pathlib import Path

import uvicorn

from .. import config, db, tenants
from . import envfile
from .app import UiConfig, create_app

HOST = "127.0.0.1"                       # never 0.0.0.0: the screen is for this computer only
log = logging.getLogger("engine.ui")


def build_demo(url: str) -> None:
    """Wipe the demo database at url (created if missing), install the sample store's fake clients in this
    process and load the store (two monthly cycles)."""
    from .. import demo
    demo.reset_database(url)
    store = demo.DemoStore()
    demo.install(store)
    with db.connect(url) as conn:
        demo.load(conn, store)


def serve(port: int = 8765, demo: bool = False, demo_db: str | None = None, open_browser: bool = True,
          env_file: Path = envfile.DEFAULT_PATH) -> None:
    configured = "DATABASE_URL" in os.environ
    if not demo:
        envfile.load_into_environ(env_file)      # tokens and DATABASE_URL saved by the screen or the launcher
        configured = "DATABASE_URL" in os.environ
        connect = db.connect
    else:
        from .. import demo as demo_mod
        url = demo_db or demo_mod.demo_url(config.database_url())
        print("Building the sample store (made up data), about 20 seconds...", flush=True)
        try:
            build_demo(url)
        except Exception as e:                   # noqa: BLE001
            raise SystemExit(f"Could not build the sample store in {tenants.redact(url)}: {tenants.redact(e)}")
        connect = lambda: db.connect(url)        # noqa: E731
        configured = True
    app = create_app(UiConfig(port=port, connect=connect, demo=demo, env_file=env_file,
                              database_configured=configured))
    address = f"http://{HOST}:{port}"
    print(f"Store engine screen: {address}  (press Ctrl+C to stop)", flush=True)
    if open_browser:
        threading.Timer(1.0, webbrowser.open, args=(address,)).start()
    uvicorn.run(app, host=HOST, port=port, access_log=False, log_level="warning")
