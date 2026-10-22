"""Score the no-Elliot baseline on the same planted mismatches, plus how many of its citations are real."""
import json, os
B = "/home/claude/elliot-runs/bench/repos"
truth = [t for t in json.load(open("/home/claude/elliot-runs/bench/ground_truth.json")) if t["valid"]]
caught = 0
for t in truth:
    try: f = json.load(open(f"{B}/{t['repo']}/baseline-findings.json"))
    except Exception: print("NO OUTPUT", t["repo"]); continue
    hit = any((x.get("doc_file") == t["doc_file"] and abs((x.get("doc_line") or -99) - t["doc_line"]) <= 5)
              or (x.get("code_file") == t["code_file"] and abs((x.get("code_line") or -99) - t["code_line"]) <= 3) for x in f)
    caught += hit
    print(f"{'CAUGHT' if hit else 'MISSED':8} {t['repo'][:28]:28} {t['claim'][:70]}")
print(f"\nbaseline recall: {caught}/{len(truth)} = {caught/len(truth):.0%}")
# Citation validity: does the cited file exist and have that line?
tot = bad = 0
for r in sorted(os.listdir(B)):
    try: f = json.load(open(f"{B}/{r}/baseline-findings.json"))
    except Exception: continue
    for x in f:
        for k in ("doc", "code"):
            p, n = x.get(f"{k}_file"), x.get(f"{k}_line")
            if not p: continue
            tot += 1
            try: ok = isinstance(n, int) and 1 <= n <= len(open(f"{B}/{r}/{p}", encoding="utf8").read().split("\n"))
            except Exception: ok = False
            bad += not ok
print(f"baseline findings: {sum(len(json.load(open(f'{B}/{r}/baseline-findings.json'))) for r in os.listdir(B) if os.path.exists(f'{B}/{r}/baseline-findings.json'))}, citations pointing to a missing file or line: {bad}/{tot}")
