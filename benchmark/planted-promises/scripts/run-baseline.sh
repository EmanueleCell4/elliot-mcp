#!/bin/bash
# Same repos, same model, same tools, no Elliot. The agent reports doc-vs-code mismatches as JSON.
d=$1; cd /home/claude/elliot-runs/bench/repos/$d || exit
rm -rf elliot-report .elliot baseline-findings.json baseline-checked.json
PROMPT='Audit this repository: find places where the README or user-facing docs make a concrete, checkable promise (defaults, timeouts, retries, limits, flags, environment variables, supported platforms, security, sandboxing, permissions, telemetry and data handling) that the code does not keep. This is a large, widely used project, so the audit must be deep: check at least 20 promises, trace each one into the code, and search the whole repository before deciding something is missing.

Write your findings to baseline-findings.json at the repository root as a JSON array. Each item: {"claim": "...", "doc_file": "path", "doc_line": N, "code_file": "path", "code_line": N, "verdict": "FALSE" or "PARTIAL", "explanation": "..."}. Include only promises the code breaks. Also write baseline-checked.json: an array of {"doc_file","doc_line","claim"} for every promise you checked. Reply with the number of findings. Nothing else.'
start=$(date +%s)
timeout 5400 claude -p "$PROMPT" --strict-mcp-config --setting-sources user \
  --tools Read Grep Glob Agent Write --allowedTools "Read" "Grep" "Glob" "Agent" "Write" --permission-mode bypassPermissions \
  --output-format text < /dev/null > /home/claude/elliot-runs/benchlogs/baseline-$d.log 2>&1
echo "exit=$? seconds=$(( $(date +%s) - start ))" >> /home/claude/elliot-runs/benchlogs/baseline-$d.log
echo "done baseline $d"
