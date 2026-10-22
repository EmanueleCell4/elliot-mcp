#!/usr/bin/env bash
# Elliot PR claim check: verifies the claims in a pull request description against the code.
set -euo pipefail

if [ "${GITHUB_EVENT_NAME:-}" != "pull_request" ] && [ "${GITHUB_EVENT_NAME:-}" != "pull_request_target" ]; then
  echo "Elliot: this action runs on pull_request events; nothing to do."; echo "verdict=skipped" >> "$GITHUB_OUTPUT"; exit 0
fi

WORK="$GITHUB_WORKSPACE"
PR_DIR="$WORK/.elliot-pr"
mkdir -p "$PR_DIR"
PR_NUMBER=$(jq -r '.pull_request.number' "$GITHUB_EVENT_PATH")
TITLE=$(jq -r '.pull_request.title // ""' "$GITHUB_EVENT_PATH")
BODY=$(jq -r '.pull_request.body // ""' "$GITHUB_EVENT_PATH")
BASE_SHA=$(jq -r '.pull_request.base.sha' "$GITHUB_EVENT_PATH")

if [ "$(printf '%s' "$BODY" | tr -d '[:space:]' | wc -c)" -lt 40 ]; then
  echo "Elliot: the PR description is too short to contain checkable claims."; echo "verdict=skipped" >> "$GITHUB_OUTPUT"; exit 0
fi

printf '# %s\n\n%s\n' "$TITLE" "$BODY" > "$PR_DIR/PR.md"
git -C "$WORK" diff --stat "$BASE_SHA" HEAD > "$PR_DIR/CHANGES.txt" 2>/dev/null || echo "(diff unavailable: check out with fetch-depth: 0)" > "$PR_DIR/CHANGES.txt"

(cd "$ELLIOT_ACTION_PATH" && npm ci --omit=dev --no-audit --no-fund --silent)
if ! claude --version 2>/dev/null | grep -q "^${ELLIOT_CC_VERSION}"; then
  npm install -g --no-audit --no-fund --silent "@anthropic-ai/claude-code@${ELLIOT_CC_VERSION}"
fi

export ELLIOT_DIR="$RUNNER_TEMP/elliot"
cat > "$RUNNER_TEMP/elliot-mcp.json" <<JSON
{"mcpServers":{"elliot":{"command":"node","args":["$ELLIOT_ACTION_PATH/src/index.js"],"env":{"ELLIOT_DIR":"$ELLIOT_DIR"}}}}
JSON

PROMPT="You are checking a pull request. Its title and description are in .elliot-pr/PR.md and the list of changed files is in .elliot-pr/CHANGES.txt (base commit $BASE_SHA; run git diff $BASE_SHA HEAD to see the changes).

1. Call the Elliot tool elliot_audit_start with path \".\" and sources [\".elliot-pr/PR.md\"].
2. Follow the focused protocol it returns: record every concrete claim the description makes about what this change does, checked against the code at HEAD, with elliot_record_claim. Elliot rejects any quote it cannot find.
3. Call elliot_audit_finish with out_dir \".elliot-pr/report\".
Reply with the totals only."

MODEL_ARGS=()
if [ -n "${ELLIOT_MODEL:-}" ]; then MODEL_ARGS=(--model "$ELLIOT_MODEL"); fi

(cd "$WORK" && claude -p "$PROMPT" "${MODEL_ARGS[@]}" \
  --mcp-config "$RUNNER_TEMP/elliot-mcp.json" --strict-mcp-config \
  --tools Read Grep Glob Bash Agent \
  --allowedTools "mcp__elliot__*" Read Grep Glob Agent "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" \
  --permission-mode dontAsk --output-format text < /dev/null) || echo "Elliot: Claude Code exited with an error"

REPORT="$PR_DIR/report/claims.json"
if [ ! -f "$REPORT" ]; then
  echo "Elliot: no report was produced."; echo "verdict=skipped" >> "$GITHUB_OUTPUT"; exit 0
fi

node "$ELLIOT_ACTION_PATH/action/comment.mjs" "$REPORT" "$PR_DIR/comment.md"
VERDICT=$(cat "$PR_DIR/comment.verdict")
echo "verdict=$VERDICT" >> "$GITHUB_OUTPUT"

REPO="$GITHUB_REPOSITORY"
EXISTING=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate --jq '.[] | select(.body | startswith("<!-- elliot-pr-check -->")) | .id' | head -1 || true)
if [ -n "$EXISTING" ]; then
  gh api -X PATCH "repos/$REPO/issues/comments/$EXISTING" -F "body=@$PR_DIR/comment.md" > /dev/null
else
  gh api -X POST "repos/$REPO/issues/$PR_NUMBER/comments" -F "body=@$PR_DIR/comment.md" > /dev/null
fi
echo "Elliot: comment posted ($VERDICT)."
