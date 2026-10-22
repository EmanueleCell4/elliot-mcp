#!/bin/bash
d=$1; cd /home/claude/elliot-runs/bench/repos/$d || exit
rm -rf elliot-report baseline-findings.json baseline-checked.json
PROMPT='Run an Elliot claim audit of this repository. This is a large, widely used project, so the audit must be deep.

1. Call the Elliot tool `elliot_audit_start` with the repository root as `path`.
2. Follow the protocol it returns. Record at least 20 claims: concrete, checkable promises from the README and user-facing docs (defaults, timeouts, retries, limits, flags, environment variables, supported platforms and models, security, sandboxing, permissions, telemetry and data handling). Trace each one into the code; search the whole repository before deciding something is missing. For every code signal, open the files and work out what really happens before you skip it.
3. Run the independent review exactly as the protocol says.
4. Call `elliot_audit_finish`. The report is written to `elliot-report/` at the repository root.
5. Reply with the totals, the most important finding and the report path. Nothing else.'
start=$(date +%s)
timeout 5400 claude -p "$PROMPT" --mcp-config /home/claude/elliot-runs/pub.mcp.json --strict-mcp-config --setting-sources user \
  --tools Read Grep Glob Agent --allowedTools "mcp__elliot__*" "Read" "Grep" "Glob" "Agent" --permission-mode bypassPermissions \
  --output-format text < /dev/null > /home/claude/elliot-runs/benchlogs/$d.log 2>&1
echo "exit=$? seconds=$(( $(date +%s) - start ))" >> /home/claude/elliot-runs/benchlogs/$d.log
echo "done $d"
