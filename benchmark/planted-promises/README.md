# Planted broken promises: Claude with Elliot vs Claude alone

**Question:** when a repository's code stops doing what its docs promise, does an agent find it, and how often does it raise false alarms? Does Elliot change either number?

## Results (October 22, 2026)

Same model, same eight repositories, same planted bugs, same "audit deeply, at least 20 promises" instruction. Two independent runs of each condition.

| | Claude alone | Claude + Elliot |
|---|---|---|
| Planted bugs found, run 1 | 13 / 17 | 15 / 17 |
| Planted bugs found, run 2 | 13 / 17 | 15 / 17 |
| **Planted-bug recall, both runs** | **26 / 34 (76%)** | **30 / 34 (88%)** |
| Findings reported (both runs) | 61 | 47 |
| Findings a blind judge rejected as not real | 13 (+1 unclear) | 3 |
| **False-alarm rate** | **21%** | **6%** |
| Real problems found that we did not plant | 12 | 5 |
| Citations pointing to a missing file or line | 0 / 122 | (checked by Elliot; rejected citations are not reported) |

Read it as: Elliot found more of the planted bugs and raised about a third as many false alarms per finding. Claude alone found more real, unplanted problems, and so cast a wider net. Elliot's claim selection and coverage are the open problem.

## Method

1. **Repositories:** eight widely used SDKs and agent tools, pinned at these commits (see `repos.txt`):
   anthropic-sdk-python, MCP python-sdk, MCP typescript-sdk, openai/codex, openai-agents-python, openai-node, openai-python and vercel/ai.
2. **Planting** (`scripts/plant.py`): from an earlier clean audit, take promises Elliot had marked VERIFIED whose code evidence holds a number or boolean. Pick three per repo at random (seed 7) and flip the literal (`true`→`false`, `n`→`2n+1`), so the documented promise becomes false. 24 were planted; 17 are valid (the change really breaks the documented behaviour). `ground_truth.json` records each one, and `patches/` has the exact mutation commit for each repo.
3. **Runs:** headless Claude Code 2.1.307 with Read, Grep, Glob and Agent tools. Elliot condition: `scripts/run-elliot.sh` (Elliot MCP server, claim audit protocol). Baseline: `scripts/run-baseline.sh` (no MCP; the agent writes its findings as JSON). Both prompts ask for at least 20 promises in the same categories.
4. **Scoring:** a planted bug is caught if a FALSE or PARTIAL finding cites its doc line (±5) or its code line (±3) (`scripts/score.py`, `scripts/score-baseline.py`).
5. **Blind judge:** every finding that does not match a planted bug was shuffled together with the other system's, stripped of which system produced it, and given to a fresh agent with repository access (`scripts/run-judge.sh`). The judge marked each one REAL, NOT_REAL or UNCLEAR, with a file:line reason. All verdicts are in `results/judge/`.

## Limits (read these before quoting the numbers)

- **The judge is also Claude.** Same model family as both auditors. An independent reviewer from another vendor should re-judge `results/judge/*-items.json`.
- **Planted bugs are simple.** One flipped literal behind a promise Elliot had already checked once. That favours Elliot's claim selection, which saw these promises in the clean audit. Real breakages are more varied.
- **Small sample:** 17 planted bugs, 2 runs, 8 repositories. A 4-point difference per run is 2 bugs.
- **Planted-bug recall is not real-world recall.** The 17 unplanted real problems found across both conditions show that both miss things.
- Scripts use absolute paths from the machine they ran on. Adjust the paths, then: clone each repo at its commit, `git am patches/<repo>.patch`, run, score.

## Files

- `repos.txt`: repository, commit, remote
- `ground_truth.json`: planted mutations (doc line, code line, old value, new value, valid)
- `patches/`: the mutation commit per repository
- `results/elliot-run{1,2}/`: Elliot `claims.json` per repository
- `results/baseline-run{1,2}/`: baseline findings per repository
- `results/judge/`: blind-judge inputs and verdicts
- `results/*-score.txt`: scorer output
