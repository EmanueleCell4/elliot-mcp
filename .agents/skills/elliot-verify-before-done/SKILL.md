---
name: elliot-verify-before-done
description: Use when Codex has edited files, claims tests passed, is about to commit/push, or is preparing a merge. Independently verify observable results with the ELLIOT MCP tools; never promote unsupported assertions to verified.
---

# ELLIOT for Codex: verify before DONE

ELLIOT checks evidence for claims, not the model's confidence. The host/operator must have installed and authorized the ELLIOT MCP server. If its tools are absent, report verification unavailable; do not install packages or run unapproved tools silently.

1. Before editing, call `elliot_snapshot` and save its snapshot ID.
2. Perform the requested code changes.
3. Before saying a change was made, invoke `verify_changes` with the snapshot ID. Treat missing or stale snapshot evidence as inconclusive.
4. If claiming tests passed, rely on directly observed test-run results with the exact command, exit status and revision. Never equate changed files or a model-authored JSON with passing tests. If files changed after tests, rerun relevant tests.
5. If claiming a commit exists, CI passed or a PR merged, use `verify_github` with the corresponding check; if claiming a deployment or published package, use `verify_url` or `verify_npm` respectively.
6. Report `VERIFIED`, `NOT_VERIFIED` or `INCONCLUSIVE`, with receipt identifiers where available. Explicitly state tests not run and uncovered requirements.
7. Before committing or pushing, summarize what was actually verified. Do not block an operation unless an authorized repository policy requires it.

This skill is advisory. It is **not** a Codex runtime hook or enforced pre-merge gate; GitHub required checks must be separately configured and must fail closed.
