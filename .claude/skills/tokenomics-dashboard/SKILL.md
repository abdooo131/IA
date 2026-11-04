---
name: tokenomics-dashboard
description: "Generate a Claude Code tokenomics dashboard (cost and tokens by day, model and token type) for a chosen number of days and present it with a short cost commentary. Ask only for the number of days of history, then fetch usage with ccusage, run claude-code-usage-analyzer, and open the self-contained HTML dashboard. Trigger when the user asks for a tokenomics dashboard, a usage or cost dashboard, a spend review, or 'analyze my last N days of Claude Code usage'."
license: MIT
metadata:
  source: https://github.com/aarora79/claude-code-usage-analyzer
  upstream_author: Amit Arora
---

# Tokenomics Dashboard

Wraps the `claude-usage-analyzer` CLI from https://github.com/aarora79/claude-code-usage-analyzer. It reads local Claude Code usage via `ccusage`, prices every model from the LiteLLM pricing table, and writes a self-contained HTML dashboard plus JSON and Markdown reports.

## The one input: number of days

1. If the user already gave a window ("last 30 days", "past 2 weeks"), use it.
2. Otherwise ask only: "How many days of history should I analyze?" Offer 7, 30 or 90.
3. Before fetching, say: "I will get this data using the ccusage tool." ccusage reads Claude Code's local usage files (`~/.claude/projects`); nothing is uploaded.

Do not ask about paths, formats or models.

## Workflow

### Step 1: Make sure the analyzer is available

Use `$ANALYZER_DIR` if set, otherwise `~/claude-code-usage-analyzer`. If it is not a checkout of the analyzer, clone it:

```bash
ANALYZER_DIR="${ANALYZER_DIR:-$HOME/claude-code-usage-analyzer}"
[ -f "$ANALYZER_DIR/pyproject.toml" ] || git clone --depth 1 https://github.com/aarora79/claude-code-usage-analyzer "$ANALYZER_DIR"
```

Requirements: Python 3.10+, `uv`, Node.js with `npx`, and internet access for LiteLLM pricing. If `uv` is missing, install it with `curl -LsSf https://astral.sh/uv/install.sh | sh`. If `npx` is missing, tell the user and stop.

### Step 2: Compute the start date

`--since` is an inclusive start date in `YYYYMMDD`. For "last N days" use today minus (N minus 1) days. Take today's date from the environment context, never guess it. Tell the user the range.

### Step 3: Run the analyzer

```bash
cd "$ANALYZER_DIR" && uv run claude-usage-analyzer --since <YYYYMMDD> --refresh
```

`--refresh` forces a new ccusage fetch so a stale cache is not reused. Outputs land in `$ANALYZER_DIR/data/output/`:

* `tokenomics-dashboard.html` (self-contained, opens in any browser)
* `claude-usage-report.md`
* `claude-usage-analysis.json`

If ccusage finds no data (for example in a fresh cloud container with no Claude Code history), say so plainly and stop. Never invent numbers.

### Step 4: Read the real numbers

Every figure in the commentary must come from `claude-usage-analysis.json` or the Markdown report. Pull at least: total cost, mean, median and P95 daily cost, cache efficiency, cost split by token type, the primary model and its share, and a monthly projection (mean daily cost times 30). `daily_series` holds per day points; days beyond mean plus or minus 2 sigma are anomalies.

### Step 5: Present

Give the user the dashboard path (copy it into the working directory or scratchpad if they cannot open files elsewhere). Then write a tight commentary:

* **Headline:** total spend and monthly run rate.
* **Cost structure:** cache vs fresh tokens, and whether prompt volume is the real lever.
* **Concentration:** primary model and its share of spend.
* **Anomalies:** days outside the 2 sigma bands and the likely reason.
* **One or two actions** for cost governance.

If the window has few active days, say the statistics are thin.

## Constraints

* One input only: number of days.
* Always say ccusage is the data source before fetching.
* Never fabricate or carry over numbers from an earlier run.
* Do not commit the generated `data/` output.
