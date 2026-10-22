# Planted broken promises: Claude with Elliot vs Claude alone

**Question:** when a repository's code stops doing what its docs promise, does an agent find it, and how often does it raise false alarms? Does Elliot change either number?

## Results (October 22-23, 2026)

Same model, same eight repositories, same planted bugs, same "audit deeply, at least 20 promises" instruction. Two independent runs of each condition.

| | Claude alone | Claude + Elliot |
|---|---|---|
| **Planted-bug recall, both runs** | **28 / 36 (78%)** | **30 / 36 (83%)** |
| Findings reported (both runs) | 61 | 47 |
| Findings judged not real | 13 | 3 |
| **False-alarm rate** | **21%** | **6%** |
| Real problems found that we did not plant | 8 | 5 |
| Citations pointing to a missing file or line | 0 / 122 | (checked by Elliot; rejected citations never reach the report) |

Read it as: Elliot raised about a third as many false alarms per finding and found slightly more planted bugs; Claude alone cast a wider net. The recall gap is 2 bugs over 36 and should not be over-read. One planted bug Elliot did find (a backoff cap documented as 30 s, mutated to 61 s) was then thrown away by Elliot's own reviewer as "immaterial"; the reviewer now treats any documented value that differs from the code as material (commit 3ac73e4).

### Two judges, and why the code had the last word

Every finding that was not a planted bug went to two blind judges: a fresh Claude agent with the repository checked out, and OpenAI Codex with links pinned to the same commits. They disagreed on 16 of 34. We settled each disagreement by reading the cited lines (`results/judge/adjudication.json`). In 9 of them Codex stated something about the code that the code contradicts, for example that `sendReasoning` defaults to false when the source says `sendReasoning = true`, or that an installer has WSL2 checks when it never mentions WSL. A second model is not an independent check unless something re-reads the source, which is the point of Elliot.

Corrections made during review: one planted mutation (auth.rs:46, 30 → 61) had been labelled invalid and is now valid (18 valid plantings, not 17). Codex judged the unmutated upstream code, so its verdict on that one does not apply.

## Method

1. **Repositories:** eight widely used SDKs and agent tools, pinned at these commits (see `repos.txt`):
   anthropic-sdk-python, MCP python-sdk, MCP typescript-sdk, openai/codex, openai-agents-python, openai-node, openai-python and vercel/ai.
2. **Planting** (`scripts/plant.py`): from an earlier clean audit, take promises Elliot had marked VERIFIED whose code evidence holds a number or boolean. Pick three per repo at random (seed 7) and flip the literal (`true`→`false`, `n`→`2n+1`), so the documented promise becomes false. 24 were planted; 18 are valid (the change really breaks the documented behaviour). `ground_truth.json` records each one, and `patches/` has the exact mutation commit for each repo.
3. **Runs:** headless Claude Code 2.1.307 with Read, Grep, Glob and Agent tools. Elliot condition: `scripts/run-elliot.sh` (Elliot MCP server, claim audit protocol). Baseline: `scripts/run-baseline.sh` (no MCP; the agent writes its findings as JSON). Both prompts ask for at least 20 promises in the same categories.
4. **Scoring:** a planted bug is caught if a FALSE or PARTIAL finding cites its doc line (±5) or its code line (±3) (`scripts/score.py`, `scripts/score-baseline.py`).
5. **Blind judge:** every finding that does not match a planted bug was shuffled together with the other system's, stripped of which system produced it, and given to a fresh agent with repository access (`scripts/run-judge.sh`). The judge marked each one REAL, NOT_REAL or UNCLEAR, with a file:line reason. All verdicts are in `results/judge/`.

## Limits (read these before quoting the numbers)

- **Judges are models.** Claude and Codex both judged; disagreements were settled by reading the code, by the author. A third party should re-check `results/judge/adjudication.json`.
- **Planted bugs are simple.** One flipped literal behind a promise Elliot had already checked once. That favours Elliot's claim selection, which saw these promises in the clean audit. Real breakages are more varied.
- **Small sample:** 18 planted bugs, 2 runs, 8 repositories. A 4-point difference per run is 2 bugs.
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
