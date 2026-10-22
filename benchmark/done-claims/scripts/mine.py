"""Mine real bug-fix commits that come with a test: a task is the parent commit plus the commit
message; the hidden test is the commit's own test changes. Keep a task only if the hidden tests
fail on the parent and pass on the fix."""
import json, os, re, subprocess, sys, tempfile, shutil
SRC = "/home/claude/elliot-runs/done-bench/src"
OUT = "/home/claude/elliot-runs/done-bench/candidates.json"
FIX = re.compile(r"\b(fix|fixes|fixed|bug|regression|incorrect|wrong|crash|error)\b", re.I)
TEST = re.compile(r"(^|/)(tests?/|test_[^/]*\.py$|[^/]*_test\.py$)")

def sh(cmd, cwd, timeout=120, env=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)

def export(repo, rev, dst):
    os.makedirs(dst, exist_ok=True)
    a = subprocess.run(["git", "-C", repo, "archive", rev], capture_output=True, check=True)
    subprocess.run(["tar", "-x", "-C", dst], input=a.stdout, check=True)

def run_tests(d, tests):
    env = dict(os.environ, PYTHONPATH=f"{d}/src:{d}", PYTHONDONTWRITEBYTECODE="1")
    try:
        r = sh([sys.executable, "-m", "pytest", "-x", "-q", "-p", "no:cacheprovider", *tests], d, timeout=180, env=env)
        return r.returncode, (r.stdout + r.stderr)[-800:]
    except subprocess.TimeoutExpired:
        return -9, "timeout"

out = json.load(open(OUT)) if os.path.exists(OUT) else []
seen = {(c["repo"], c["commit"]) for c in out}
per_repo = int(sys.argv[1]) if len(sys.argv) > 1 else 5
for name in sorted(os.listdir(SRC)):
    repo = f"{SRC}/{name}"
    log = sh(["git", "log", "--no-merges", "--since=2019-01-01", "--format=%H%x09%s", "-n", "800"], repo).stdout.splitlines()
    kept = sum(1 for c in out if c["repo"] == name)
    for line in log:
        if kept >= per_repo: break
        sha, subj = line.split("\t", 1)
        if (name, sha) in seen or not FIX.search(subj): continue
        stat = sh(["git", "show", "--numstat", "--format=", sha], repo).stdout.split("\n")
        files = [(int(a), int(b), f) for a, b, f in (l.split("\t") for l in stat if l and not l.startswith("-")) ]
        src = [f for a, b, f in files if f.endswith(".py") and not TEST.search(f)]
        tests = [f for a, b, f in files if f.endswith(".py") and TEST.search(f)]
        other = [f for a, b, f in files if not f.endswith(".py") and not re.search(r"\.(md|rst|txt)$|CHANGE|HISTORY", f, re.I)]
        churn = sum(a + b for a, b, f in files if f in src)
        if not src or not tests or other or churn > 40 or len(src) > 2: continue
        tmp = tempfile.mkdtemp()
        try:
            export(repo, sha + "^", f"{tmp}/parent"); export(repo, sha, f"{tmp}/fix")
            existing = [t for t in tests if os.path.exists(f"{tmp}/fix/{t}")]
            if not existing: continue
            for t in existing:  # hidden tests go into the parent tree
                os.makedirs(os.path.dirname(f"{tmp}/parent/{t}") or ".", exist_ok=True)
                shutil.copy(f"{tmp}/fix/{t}", f"{tmp}/parent/{t}")
            rp, op = run_tests(f"{tmp}/parent", existing)
            rf, of = run_tests(f"{tmp}/fix", existing)
            if rp not in (0, -9) and rf == 0 and "ModuleNotFoundError" not in op:
                body = sh(["git", "log", "-1", "--format=%B", sha], repo).stdout.strip()
                out.append({"repo": name, "commit": sha, "subject": subj, "message": body, "src_files": src, "hidden_tests": existing, "churn": churn, "parent_fail_tail": op[-400:]})
                kept += 1
                json.dump(out, open(OUT, "w"), indent=1)
                print("KEEP", name, sha[:8], subj[:70], flush=True)
        except Exception as e:
            pass
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
print("total", len(out))
