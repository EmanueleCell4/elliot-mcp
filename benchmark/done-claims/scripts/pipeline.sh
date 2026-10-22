#!/bin/bash
B=/home/claude/elliot-runs/done-bench; cd $B
n=$(python3 -c "import json;print(len(json.load(open('tasks.json'))))")
seq 0 $((n-1)) | xargs -P 6 -I{} bash tools/run_agent.sh {}
: > results/truth${WORK#work}.jsonl; : > results/rerun${WORK#work}.jsonl
for i in $(seq 0 $((n-1))); do python3 tools/truth.py $i >> results/truth${WORK#work}.jsonl; node tools/rerun_claim.mjs $i >> results/rerun${WORK#work}.jsonl; done
seq 0 $((n-1)) | sed 's/$/ plain/' | xargs -P 6 -L1 bash tools/run_review.sh
seq 0 $((n-1)) | sed 's/$/ elliot/' | xargs -P 6 -L1 bash tools/run_review.sh
echo PIPELINE DONE
