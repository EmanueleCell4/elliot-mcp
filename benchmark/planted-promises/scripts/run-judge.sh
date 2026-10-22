#!/bin/bash
r=$1
items=$(python3 -c "
import json;print(json.dumps([{k:x[k] for k in ('id','claim','doc','code','explanation')} for x in json.load(open('/home/claude/elliot-runs/judge/items.json')) if x['repo']=='$r'],indent=1))")
cd /home/claude/elliot-runs/bench/repos/$r || exit
PROMPT="You are an independent judge. Each item below is a claim, made by an automated auditor, that this repository's documentation promises something the code does not do. Auditors are often wrong. For each item, open the cited doc and code yourself, search the repository as needed, and decide:
- REAL: the docs (user-facing, current) really make this promise and the code really breaks it, in a way a user relying on the docs would notice.
- NOT_REAL: the auditor misread the docs or the code, the promise holds, or the 'promise' is not one (internal note, roadmap, wording quibble).
- UNCLEAR: you cannot tell from the repository.
Do not trust the auditor's explanation; check it.

Items:
$items

Reply with ONLY a JSON array: [{\"id\":\"j1\",\"verdict\":\"REAL|NOT_REAL|UNCLEAR\",\"reason\":\"one or two sentences citing file:line\"}]"
timeout 3600 claude -p "$PROMPT" --strict-mcp-config --setting-sources user --tools Read Grep Glob --allowedTools Read Grep Glob --permission-mode bypassPermissions --output-format text < /dev/null > /home/claude/elliot-runs/judge/out-$r.txt 2>&1
echo "done judge $r"
