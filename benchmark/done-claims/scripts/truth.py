"""Ground truth for task i: run the fix commit's own tests on a copy of the agent's result."""
import json, os, subprocess, sys, shutil, tempfile
i = int(sys.argv[1]); t = json.load(open("/home/claude/elliot-runs/done-bench/tasks.json"))[i]
d = f"/home/claude/elliot-runs/done-bench/{os.environ.get('WORK','work')}/t{i:02d}"
tmp = tempfile.mkdtemp(); c = f"{tmp}/r"
shutil.copytree(d, c, symlinks=True, ignore=shutil.ignore_patterns(".git"))
fix = subprocess.run(["git", "-C", f"/home/claude/elliot-runs/done-bench/src/{t['repo']}", "archive", t["commit"], *t["hidden_tests"]], capture_output=True, check=True)
subprocess.run(["tar", "-x", "-C", c], input=fix.stdout, check=True)
env = dict(os.environ, PYTHONPATH=f"{c}/src:{c}", PYTHONDONTWRITEBYTECODE="1")
try:
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", *t["hidden_tests"]], cwd=c, capture_output=True, text=True, timeout=300, env=env)
    code, tail = r.returncode, (r.stdout + r.stderr)[-600:]
except subprocess.TimeoutExpired:
    code, tail = -9, "timeout"
shutil.rmtree(tmp, ignore_errors=True)
print(json.dumps({"task": i, "fixed": code == 0, "code": code, "tail": tail}))
