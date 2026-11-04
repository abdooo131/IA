# Project skills

Claude Code loads every folder here that holds a `SKILL.md`.

| Skill | What it does | Source (MIT license) |
|---|---|---|
| `tokenomics-dashboard` | Cost and token dashboard for the last N days of Claude Code usage | [aarora79/claude-code-usage-analyzer](https://github.com/aarora79/claude-code-usage-analyzer) (adapted from its own skill) |
| `claude-usage-monitor` | Daily and monthly usage tables, burn rate and plan limits via `claude-monitor` | [contiamo/cc-usage-monitor](https://github.com/contiamo/cc-usage-monitor) (new wrapper skill) |
| `browser-use` | Direct browser control via CDP with browser-harness | [browser-use/browser-use](https://github.com/browser-use/browser-use) `skills/browser-use` |
| `browser-use-open-source` | Reference for the browser-use Python library | `skills/open-source` |
| `browser-use-cloud` | Reference for the Browser Use Cloud API and SDK | `skills/cloud` |
| `browser-use-qa` | QA a site and score it 1 to 5 on a Browser Use cloud browser | `skills/qa` |
| `browser-use-remote` | Control a Browser Use Cloud browser from a sandbox | `skills/remote-browser` |
| `browser-use-x402` | Pay for Browser Use Cloud per request with USDC (x402) | `skills/x402` |

The browser-use skills were copied unchanged except for a `browser-use-` name prefix (so generic names like `qa` and `cloud` do not clash) and matching cross references. The cloud, qa, remote and x402 skills use the paid Browser Use Cloud service and need a `BROWSER_USE_API_KEY` or a funded wallet.

To update the browser-use skills, copy `skills/` from a fresh clone of that repo and reapply the renames.
