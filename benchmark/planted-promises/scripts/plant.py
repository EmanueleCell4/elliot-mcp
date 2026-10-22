"""Plant known doc-vs-code mismatches in clean repos to measure Elliot's recall.

For each repo, take VERIFIED claims from its clean audit whose code evidence line holds a literal
(number or boolean) and flip that literal, so the documented claim becomes false. Each mutated repo
is a fresh copy with the mutations committed. ground_truth.json records what was planted.
"""
import glob
import json
import os
import random
import re
import shutil
import subprocess
import sys

SRC = "/home/claude/elliot-runs/r6"
OUT = "/home/claude/elliot-runs/bench/repos"
REPOS = sys.argv[1:] or [
    "anthropics_anthropic-sdk-python", "openai_openai-python", "openai_openai-node",
    "openai_openai-agents-python", "modelcontextprotocol_python-sdk",
    "modelcontextprotocol_typescript-sdk", "vercel_ai", "openai_codex",
]
PER_REPO = 3
DOC = re.compile(r"\.(md|mdx|rst|txt)$", re.I)
NUM = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])")
BOOL = re.compile(r"\b(true|false|True|False)\b")
random.seed(7)


def mutate_line(line):
    m = BOOL.search(line)
    if m:
        flip = {"true": "false", "false": "true", "True": "False", "False": "True"}[m.group(1)]
        return line[: m.start()] + flip + line[m.end():], m.group(1), flip
    for m in NUM.finditer(line):
        v = m.group(1)
        if v in ("0", "1"):  # too often an index or a flag
            continue
        new = str(int(float(v) * 2 + 1)) if "." not in v else str(round(float(v) * 2 + 0.5, 2))
        return line[: m.start()] + new + line[m.end():], v, new
    return None


truth = []
os.makedirs(OUT, exist_ok=True)
for repo in REPOS:
    files = sorted(glob.glob(f"{SRC}/{repo}/elliot-report/*/claims.json"))
    if not files:
        print("no report", repo)
        continue
    audit = json.load(open(files[-1]))
    dst = f"{OUT}/{repo}"
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(f"{SRC}/{repo}", dst, ignore=shutil.ignore_patterns("elliot-report", ".elliot"), symlinks=True)
    cands = []
    for c in audit["claims"]:
        if c["verdict"] != "VERIFIED":
            continue
        for e in c["evidence"]:
            if e.get("type") == "absent" or not e.get("file") or DOC.search(e["file"]):
                continue
            path = f"{dst}/{e['file']}"
            try:
                lines = open(path, encoding="utf8").read().split("\n")
            except Exception:
                continue
            lo, hi = e["line_start"], e.get("line_end") or e["line_start"]
            for ln in range(lo, min(hi, lo + 3) + 1):
                if ln - 1 < len(lines) and mutate_line(lines[ln - 1]):
                    cands.append((c, e["file"], ln))
                    break
            break
    random.shuffle(cands)
    used_files, planted = set(), 0
    for c, f, ln in cands:
        if planted >= PER_REPO or (f, ln) in used_files:
            continue
        path = f"{dst}/{f}"
        lines = open(path, encoding="utf8").read().split("\n")
        res = mutate_line(lines[ln - 1])
        if not res:
            continue
        new_line, old, new = res
        lines[ln - 1] = new_line
        open(path, "w", encoding="utf8").write("\n".join(lines))
        used_files.add((f, ln))
        planted += 1
        truth.append({"repo": repo, "claim": c["claim"], "doc_file": c["source"]["file"], "doc_line": c["source"]["line_start"],
                      "code_file": f, "code_line": ln, "old": old, "new": new})
    subprocess.run(["git", "-C", dst, "-c", "user.name=bench", "-c", "user.email=b@b", "commit", "-qam", "bench mutations"], check=False)
    print(repo, "planted", planted)

json.dump(truth, open("/home/claude/elliot-runs/bench/ground_truth.json", "w"), indent=1)
print("total planted", len(truth))
