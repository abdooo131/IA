#!/bin/bash
# Double click in Finder to open the store engine screen in your browser. Close this window (or Ctrl+C) to stop.
cd "$(dirname "$0")/.." || exit 1
if [ -f .venv/bin/activate ]; then
  source .venv/bin/activate
fi
if [ -f "$HOME/.engine_env" ]; then
  source "$HOME/.engine_env"
fi
exec engine ui "$@"
