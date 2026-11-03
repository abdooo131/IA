#!/bin/bash
# Double click in Finder to open the store engine screen in your browser. Close this window (or Ctrl+C) to stop.
cd "$(dirname "$0")/.." || exit 1

pause() {
  echo
  echo "Press Enter to close this window."
  read -r _
}

if [ ! -x .venv/bin/engine ]; then
  echo "The engine is not installed in $(pwd)/.venv yet."
  echo "Open Terminal in this folder ($(pwd)) and run, once:"
  echo
  echo "  python3 -m venv .venv"
  echo "  source .venv/bin/activate"
  echo "  pip install -e ."
  echo
  echo "Then double click Engine.command again."
  pause
  exit 1
fi

source .venv/bin/activate
if [ -f "$HOME/.engine_env" ]; then
  source "$HOME/.engine_env"
fi
engine ui "$@"
status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 130 ]; then     # 130: stopped with Ctrl+C
  echo
  echo "The screen stopped with an error (exit code $status). The message above says why."
  pause
fi
exit "$status"
