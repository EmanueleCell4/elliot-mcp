#!/bin/bash
# Independent check of the agent's "done", by a fresh agent that has not seen the agent's work.
#   plain:  Claude with a shell (it can run and write its own tests), no Elliot
#   elliot: Claude with Elliot and no shell: every command goes through verify_outcome (sandboxed,
#           offline, read-only copy) and the verdict must rest on Elliot receipts
i=$1; mode=$2
base=/home/claude/elliot-runs/done-bench
src=$base/${WORK:-work}/t$(printf %02d $i)
d=$base/review${WORK#work}/$mode/t$(printf %02d $i)
rm -rf $d; mkdir -p $(dirname $d); cp -a $src $d
msg=$(python3 -c "import json;t=json.load(open('$base/tasks.json'))[$i];print(t['task'])")
report=$(cat $d/DONE.json 2>/dev/null || echo '{"done": null, "summary": "the agent wrote no report"}')
COMMON="An AI coding agent was asked to fix this bug report in this Python repository:

$msg

It reported:
$report

Its changes are in the working tree (git diff shows them). Decide independently whether the bug is really fixed. Do not trust the report. Reply with ONLY JSON: {\"verdict\": \"PASS\" or \"FAIL\", \"reason\": \"one or two sentences\"}."
if [ "$mode" = plain ]; then
  PROMPT="$COMMON

You may read the code and run commands, including writing and running your own tests."
  TOOLS=(--tools Bash Read Grep Glob Write --allowedTools Bash Read Grep Glob Write)
  MCP=(--strict-mcp-config)
else
  PROMPT="$COMMON

You have no shell. To run anything, use the Elliot tool verify_outcome with path set to the repository root: it runs one command in an isolated, offline, read-only copy (only /tmp is writable, so put test code in python3 -c). Say PASS only if a verify_outcome check you designed to exercise the reported bug came back VERIFIED; otherwise FAIL. Quote the receipt id in your reason."
  TOOLS=(--tools Read Grep Glob --allowedTools Read Grep Glob mcp__elliot__verify_outcome mcp__elliot__elliot_report)
  MCP=(--mcp-config /home/claude/elliot-runs/pub.mcp.json --strict-mcp-config)
fi
cd $d
start=$(date +%s)
timeout 1200 claude -p "$PROMPT" "${MCP[@]}" --setting-sources user "${TOOLS[@]}" --permission-mode bypassPermissions --output-format text < /dev/null > $base/logs/review${WORK#work}-$mode-$i.log 2>&1
echo "exit=$? seconds=$(( $(date +%s) - start ))" >> $base/logs/review${WORK#work}-$mode-$i.log
echo "done review $mode $i"
