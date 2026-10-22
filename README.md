# elliot

**Your agent says it's done. Elliot checks.**

Coding agents say "Done ✅" when nothing changed, when the deploy is down, when CI is red.
Elliot is an open-source MCP server that checks those claims against ground truth
(the real files, the real URL, the real GitHub state, the real npm registry) and writes a receipt for every check.

No LLM judges another LLM here. Every check is deterministic: in a claim audit the agent proposes, and Elliot checks every citation it proposes.

<!-- drop the 16:9 video here: drag elliot_16x9.mp4 into the GitHub editor -->

```
❌ NOT_VERIFIED: 0 files changed since the snapshot  [receipt rcpt_3f9a1c2b7d10]
```

## Audit a whole repo: `/elliot-audit`

```bash
npx -y github:EmanueleCell4/elliot-mcp init   # registers Elliot in Claude Code, Cursor and Codex, adds /elliot-audit
```

Then, inside your agent, run `/elliot-audit`. Nothing to open, no dashboard.

1. **Elliot decides what must be checked.** Before the agent reads anything, Elliot scans the docs for risky promises (privacy, telemetry, encryption, access control, "never", "by default") and the code for signals that often contradict them (analytics SDKs, permission bypasses, privileged database clients, secrets written to disk). The audit cannot finish until each one is addressed.
2. **The agent proposes, Elliot verifies.** Every quote the agent cites, from the docs and from the code, is matched against the file at the pinned commit. Every "this does not exist" is searched by Elliot itself with `git grep`. Citations that don't check out are rejected.
3. **Only material findings.** A FALSE or PARTIAL verdict needs `user_impact`: what a user who trusts the docs would get wrong. Risky behaviour the docs never mention is recorded separately as an undisclosed behaviour.
4. **An independent review.** Before the report is written, a fresh subagent that has not seen the audit tries to prove every finding wrong, and confirms, downgrades or retracts it.

The report lands in `elliot-report/<date>-<commit>/` at the repo root: `report.html`, `report.md` and `claims.json`.

### How well it works

Run unattended inside Claude Code on 9 open-source tools from the AI-agent ecosystem (October 2026), then checked by a separate reviewer:

| | Findings reported | Correct | Wrong |
|---|---|---|---|
| Elliot 0.3 | 13 | 12 | 0 |

Each audit took 1 to 3 minutes. It found, among others, a tool that sends users' full AI prompts and responses to a third-party error tracker by default under an option called "anonymousTelemetry" (reported privately to the maintainers), and an app whose docs say the API key is stored encrypted while the code writes it as plain JSON. It still misses some issues, most often missing authorization checks, which it does not look for yet.

## What it checks

| The agent says | Elliot tool | What Elliot actually looks at |
|---|---|---|
| "I fixed / cleaned / refactored the code" | `elliot_snapshot` → `verify_changes` | content hash of every file before and after the task |
| "It's deployed / live" | `verify_url` | HTTP status and the text really served at the URL |
| "PR merged" · "CI is green" · "pushed" | `verify_github` | GitHub API: merge state, check runs, commit existence |
| "Published to npm" | `verify_npm` | the npm registry (version exists, published after a given time) |
| "What did my agent really do today?" | `elliot_report` | your receipts: claims checked, how many held up |
| "The README / security page says X" | `/elliot-audit` → `elliot_audit_start`, `elliot_record_claim`, `elliot_audit_finish` | the cited lines in the docs and the code at a pinned commit, plus Elliot's own searches |

Verdicts are `VERIFIED`, `NOT_VERIFIED` or `INCONCLUSIVE` (Elliot could not confirm, for example GitHub rate limits; it never guesses).

## Install

Node 20+.

**Claude Code**
```bash
claude mcp add elliot -- npx -y github:EmanueleCell4/elliot-mcp
```

**Codex** (`~/.codex/config.toml`)
```toml
[mcp_servers.elliot]
command = "npx"
args = ["-y", "github:EmanueleCell4/elliot-mcp"]
```

**Cursor** (`.cursor/mcp.json`) and any other MCP client
```json
{ "mcpServers": { "elliot": { "command": "npx", "args": ["-y", "github:EmanueleCell4/elliot-mcp"] } } }
```

Optional: `GITHUB_TOKEN` for private repos and higher rate limits.

The server ships instructions that tell the agent to snapshot before a task and to verify before saying "done".
For agents that support skills, add [`skills/elliot/SKILL.md`](skills/elliot/SKILL.md) as well.

## Receipts

Every check is appended to `.elliot/receipts.jsonl` in your project:

```json
{
  "elliot": "0.1.0",
  "id": "rcpt_3f9a1c2b7d10",
  "check": "changes",
  "claim": "Done. Code cleaned 100%.",
  "target": "/Users/you/project",
  "verdict": "NOT_VERIFIED",
  "reason": "0 files changed since the snapshot",
  "evidence": { "files_changed": 0, "added": [], "removed": [], "modified": [] },
  "checked_at": "2026-10-21T10:00:00.000Z",
  "checker": "local",
  "digest": "sha256:…"
}
```

The digest makes a receipt tamper-evident. A local receipt is still produced on your own machine, so it proves
nothing to a third party. Independently signed receipts that anyone can verify by link are on the roadmap.

## Roadmap

- [x] files, URL, GitHub, npm checks with local receipts
- [x] `/elliot-audit`: claim audit of a whole repo with checked citations, report in `elliot-report/`
- [x] risk sweep, undisclosed behaviours, materiality test and independent review
- [ ] authorization checks (unauthenticated handlers, missing ownership checks)
- [ ] verify the agent's own "done" at the end of every task, by running tests and the app
- [ ] hooks that run Elliot automatically when the agent stops (Claude Code, Codex, OpenClaw)
- [ ] more checks: DNS records, Vercel / Netlify / Cloudflare deploys, PyPI, test runs, x402 payments
- [ ] **Agent Honesty Index**: how often each agent / model claims "done" without doing it
- [ ] independently signed receipts with a public verification link

## Develop

```bash
npm install
npm test   # end-to-end: spawns the server over stdio and drives it with the MCP client
```

MIT licensed. Issues and stories of agents lying to you are very welcome.
