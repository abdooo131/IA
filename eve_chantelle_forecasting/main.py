"""Eve Chantelle demand forecasting and replenishment.

python main.py sync              pull and update Shopify data
python main.py forecast          run cleaning, backtest, forecast
python main.py po                generate purchase orders
python main.py po filter color BLACK supplier BOBO
python main.py health            inventory health report
python main.py pricing           markup and markdown report
python main.py tracker           merchandise tracker
python main.py all               full pipeline
python main.py demo              synthetic store into data/demo, outputs into outputs_demo
python main.py proposals         list config changes the system has proposed
"""
from __future__ import annotations

import os
import sys
import traceback

from src.common import no_hyphen
from src.config import load_settings
from src.pipeline import App, cmd_all, cmd_demo, cmd_forecast, cmd_health, cmd_po, cmd_pricing, cmd_sync, cmd_tracker


def main(argv: list[str]) -> int:
    if not argv or argv[0] in ("help", "h"):
        print(__doc__)
        return 0
    cmd, rest = argv[0].lower(), argv[1:]
    settings = load_settings()
    if cmd == "demo":
        root = settings.root
        app = App(settings, db_path=root / "data" / "demo" / "demo_warehouse.duckdb",
                  outputs_dir=root / "outputs_demo", logs_dir=root / "logs")
        try:
            cmd_demo(app)
        except Exception as exc:
            if os.environ.get("EC_DEBUG"):
                traceback.print_exc()
            print("STOPPED " + no_hyphen(str(exc)))
            return 1
        return 0
    app = App(settings)
    try:
        if cmd == "sync":
            cmd_sync(app)
        elif cmd == "forecast":
            cmd_forecast(app)
        elif cmd == "po":
            cmd_po(app, rest)
        elif cmd == "health":
            cmd_health(app)
        elif cmd == "pricing":
            cmd_pricing(app)
        elif cmd == "tracker":
            cmd_tracker(app)
        elif cmd == "all":
            cmd_all(app)
        elif cmd == "proposals":
            con = app.connect()
            df = con.execute("SELECT * FROM config_proposals ORDER BY run_id DESC LIMIT 50").df()
            print("No proposals yet." if df.empty else df.to_string(index=False))
        else:
            print(f"Unknown command {cmd}.")
            print(__doc__)
            return 2
    except Exception as exc:  # show a plain message; set EC_DEBUG=1 for the full traceback
        if os.environ.get("EC_DEBUG"):
            traceback.print_exc()
        print("STOPPED " + no_hyphen(str(exc)))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
