"""Create the agent's working copy for task i: the parent commit, as its own git repo."""
import json, os, subprocess, sys, shutil
i = int(sys.argv[1]); t = json.load(open("/home/claude/elliot-runs/done-bench/tasks.json"))[i]
d = f"/home/claude/elliot-runs/done-bench/{os.environ.get('WORK','work')}/t{i:02d}"
shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
a = subprocess.run(["git", "-C", f"/home/claude/elliot-runs/done-bench/src/{t['repo']}", "archive", t["commit"] + "^"], capture_output=True, check=True)
subprocess.run(["tar", "-x", "-C", d], input=a.stdout, check=True)
g = lambda *x: subprocess.run(["git", *x], cwd=d, check=True, capture_output=True)
g("init", "-q"); g("add", "-A"); g("-c", "user.name=bench", "-c", "user.email=b@b", "commit", "-qm", "task start")
print(d)
