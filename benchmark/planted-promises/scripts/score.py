"""Score Elliot's recall on the planted mismatches in ground_truth.json."""
import glob
import json

truth = [t for t in json.load(open("/home/claude/elliot-runs/bench/ground_truth.json")) if t["valid"]]
caught = 0
rows = []
for t in truth:
    files = sorted(glob.glob(f"/home/claude/elliot-runs/bench/repos/{t['repo']}/elliot-report/*/claims.json"))
    if not files:
        rows.append(("NO REPORT", t))
        continue
    a = json.load(open(files[-1]))
    hit = None
    for c in a["claims"] + a.get("behaviors", []):
        if c.get("verdict", "FALSE") not in ("FALSE", "PARTIAL"):
            continue
        src = c.get("source") or {}
        near_doc = src.get("file") == t["doc_file"] and abs(src.get("line_start", -99) - t["doc_line"]) <= 5
        near_code = any(e.get("file") == t["code_file"] and abs(e.get("line_start", -99) - t["code_line"]) <= 3 for e in c.get("evidence", []))
        if near_doc or near_code:
            hit = c
            break
    # Did the auditor look at the claim at all (even if it missed the change)?
    looked = any((c.get("source") or {}).get("file") == t["doc_file"] and abs(c["source"]["line_start"] - t["doc_line"]) <= 5 for c in a["claims"])
    caught += bool(hit)
    rows.append(("CAUGHT" if hit else ("MISSED (checked the claim)" if looked else "MISSED (claim not picked)"), t))
for status, t in rows:
    print(f"{status:28} {t['repo'][:28]:28} {t['claim'][:70]}")
print(f"\nrecall: {caught}/{len(truth)} = {caught / len(truth):.0%}")
