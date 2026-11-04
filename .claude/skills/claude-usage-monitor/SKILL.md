---
name: claude-usage-monitor
description: "Check Claude Code token usage, cost, burn rate and session limits with claude-monitor (Claude Code Usage Monitor). Use when the user asks how much of their Claude plan or 5 hour session they have used, wants daily or monthly token and cost tables, wants to know their burn rate or when they will hit the limit, or asks to set up a live usage monitor in their terminal."
license: MIT
metadata:
  source: https://github.com/contiamo/cc-usage-monitor
  upstream: https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor
---

# Claude Usage Monitor

Wraps `claude-monitor` (PyPI package `claude-monitor`, also runnable as `cmonitor` or `ccmonitor`). It reads Claude Code's local usage files (`~/.claude/projects`) and reports tokens, messages, cost and burn rate against plan limits. Nothing is uploaded.

## Choose the mode

| User wants | Mode |
|---|---|
| A snapshot of usage per day or per month | Table view, run by you (below) |
| A live dashboard they keep open while working | Realtime view, run by the user in their own terminal |

### Table views (you run these)

The daily and monthly views print a table and then wait for Ctrl+C, so always wrap them in `timeout` and capture the output:

```bash
timeout 30 uvx claude-monitor --view daily --theme classic 2>&1 | tail -n 80
timeout 30 uvx claude-monitor --view monthly --theme classic 2>&1 | tail -n 80
```

Exit code 124 from `timeout` is expected and means the table printed. If `uvx` is missing, install uv with `curl -LsSf https://astral.sh/uv/install.sh | sh`, or use `pipx run claude-monitor` instead.

If it prints "No Claude data directory found" or "No usage data found", tell the user there is no local Claude Code history on this machine (common in a fresh cloud container) and stop. Never invent numbers.

Summarize from the printed table: total tokens and cost for the period, the busiest day or month, the model mix, and any sharp spikes.

### Realtime view (the user runs this)

The realtime view is a full screen terminal UI that refreshes until Ctrl+C. Do not run it yourself; give the user the command for their own terminal:

```bash
uv tool install claude-monitor
```

```bash
claude-monitor --plan max5
```

## Options worth knowing

* `--plan pro|max5|max20|custom` (default `custom`, which learns limits from the last 8 days using P90)
* `--custom-limit-tokens N` to set an explicit token limit with `--plan custom`
* `--view realtime|daily|monthly`
* `--timezone Europe/London` and `--time-format 12h|24h`
* `--reset-hour H` for a custom daily reset hour
* `--refresh-rate S` (seconds, 1 to 60) and `--refresh-per-second HZ` for the realtime UI
* `--theme light|dark|classic|auto`
* `--clear` to wipe saved settings in `~/.claude-monitor/last_used.json`

Plan limits in the tool (approximate tokens per 5 hour session): Pro 44k, Max5 88k, Max20 220k. Treat these as the tool's estimates, not official numbers.

## Related

For a deeper cost report with an HTML dashboard over a date range, use the `tokenomics-dashboard` skill.
