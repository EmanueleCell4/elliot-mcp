# Codex Stop hook: ELLIOT verification (experimental)

This opt-in integration checks **claims about uncommitted working-tree changes** by invoking the real ELLIOT MCP `verify_changes` tool. It does not prove test success, behavior, commit creation, push or merge.

## Configure

From a checkout of the ELLIOT repository with `npm ci` completed, use `codex/hooks.example.json` as the basis for an authorized Codex `hooks.json` configuration. Its command `node ./codex/stop-hook.mjs` assumes Codex's working directory is the ELLIOT checkout. When operating on another project, replace the command with an absolute path to the installed ELLIOT hook.

The hook receives Codex's Stop event on standard input, launches ELLIOT's local MCP server, and returns a blocking decision only when an explicit working-tree change claim lacks verification. On a second Stop event with `stop_hook_active=true`, it reports uncertainty instead of continuing a blocking loop.

This is **not** a secure pre-commit or pre-merge gate. GitHub required status checks and fail-closed policies are a separate integration.

## Verification

Run `npm test`. Unit tests cover hook matching, verdict handling, failure behavior, and non-Stop events. The existing `test/e2e.test.js` exercises the real MCP server via stdio. A real Codex CLI trial is still required before claiming compatibility end-to-end.

Do not publish `VERIFIED` for a finished task merely because files changed.
