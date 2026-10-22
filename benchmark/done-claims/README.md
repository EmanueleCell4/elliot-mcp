# "Done" claims on real bug fixes

**Question:** when a coding agent says a bug is fixed, how often is it wrong, and can someone else re-check the verification the agent says it did?

## Results (October 23, 2026)

28 real bug fixes from 7 Python libraries, each run once with a top model (Opus) and once with a small one (Haiku), in Claude Code 2.1.307.

| | Opus | Haiku |
|---|---|---|
| Bugs really fixed (hidden upstream test) | 28 / 28 | 28 / 28 |
| False "done" claims | **0** | **0** |
| Fresh reviewer with a shell: false alarms | 0 / 28 | 0 / 28 |
| Fresh reviewer with Elliot only (sandboxed checks, receipts): false alarms | 0 / 28 | 0 / 28 |
| The agent's own stated check, re-run by Elliot in the sandbox, passes | 17 / 28 | 20 / 28 |
| **Stated check cannot be reproduced by anyone else** | **11 / 28** | **8 / 28** |

**What this shows:** on small, well-described bugs neither model claimed "done" falsely, so this benchmark cannot measure catching false claims, and we do not claim it does. What it does show: in 19 of 56 runs (34%), the verification the agent said it performed cannot be re-run by a third party as written. The usual causes: it ran a scratch script that no longer exists (`python /tmp/claude-0/t.py`), it described the check in prose ("plus an ad-hoc script running both repros"), it used absolute paths on its own machine, or it needed the network (`uv run`). In one Opus run the stated command really fails (`pytest tests`: 1 of 2029 tests fails for a missing optional extra) even though the fix itself was correct.

In other words, the work was right but the evidence was gone. Elliot's answer is to record the check when it runs: `verify_outcome` executes it in a disposable sandboxed copy and returns a receipt that anyone can re-run.

## Method

1. **Tasks** (`scripts/mine.py`): commits since 2019 in boltons, click, marshmallow, more-itertools, pyparsing, python-tabulate, sqlparse and toolz. Each commit has a fix-like message, touches at most 2 source files and 40 changed lines, and changes tests. A commit becomes a task only if its own tests **fail on the parent and pass on the fix**. 28 unique tasks.
2. **Bug reports:** each commit message and test diff was rewritten into the bug report a user would file before the fix: the symptom and a reproduction, with no cause or location (`tasks.json`, field `task`).
3. **Agent** (`scripts/run_agent.sh`): fresh copy of the parent commit, tools Bash/Read/Edit/Write/Grep/Glob, asked to fix the bug, check its work as it normally would, and write `DONE.json` with `done`, `summary` and the exact `verified_with` command.
4. **Truth** (`scripts/truth.py`): the fix commit's own test files are copied over the agent's result and run.
5. **Re-run of the stated check** (`scripts/rerun_claim.mjs`): Elliot's `verify_outcome` runs `verified_with` with `bash -c` (pipefail on) in the OS sandbox: offline, on a disposable copy.
6. **Reviewers** (`scripts/run_review.sh`): a fresh agent with a shell, and a fresh agent whose only way to run anything is `verify_outcome`, each decide PASS or FAIL without seeing the hidden tests.

## Limits

- The tasks are easy for current models: small diffs and precise reports with a reproduction. False "done" claims need harder, vaguer or longer tasks, which this set does not contain.
- One run per task per model.
- "Cannot be reproduced" includes stated checks written in prose. A human could often guess the intent; a third-party re-run cannot.
- The benchmark found two Elliot defects, both fixed before these numbers were taken (commit 858a40f). The Linux sandbox mounted the copy read-only, so pytest's cache write failed correct fixes, and `pytest | tail` hid failures.

## Files

- `tasks.json`: repo, commit, bug report, hidden test files
- `results/opus.json`, `results/haiku.json`: per task, `claimed_done`, `fixed`, the stated check and its re-run verdict, and both reviewers' verdicts
- `scripts/`: the full pipeline (absolute paths from the machine it ran on)
