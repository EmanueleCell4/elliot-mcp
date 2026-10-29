# Do agent-written pull requests tell the truth?

**Question:** when a coding agent opens a pull request and its description says what the change does — "adds tests for X", "no behaviour change", "all tests pass", "updates the docs" — how often is that not true in the code that was merged?

This is the question Elliot answers on a single pull request. This benchmark asks it at scale, on pull requests that real maintainers already merged.

> **Status: collection built, not yet run.** No results are published here. Nothing below should be quoted as a finding until this file carries a results table and a date.

## Why this matters

Coding agents now open a large share of pull requests, and their descriptions are what a reviewer reads first. A human reviewer checks the diff against the description for a minute, or trusts it. Nobody re-checks the description against the code that was actually merged. If agents are routinely wrong about their own work, the review step is weaker than everyone assumes.

## Method

1. **Sample** (`scripts/collect.mjs`). Public repositories with at least 300 stars, pushed to in the window, ordered by stars. In each, merged pull requests created in the window whose author is a known coding-agent account (Devin, Copilot's SWE agent, Cursor, Codex, Claude) or whose body carries that tool's trailer. A pull request is kept only if its body is long enough to contain checkable claims and it touches at most 40 files. At most two per repository, so one busy project cannot dominate. Every candidate that was dropped is recorded with the reason, in the same file.
2. **Audit.** For each pull request, the repository is cloned at the merge commit and Elliot runs in focused mode with the pull request description as the only claim source: every concrete statement in it becomes a claim, checked against the code. Elliot rejects any citation that is not really at the file and line it quotes.
3. **Independent review.** A separate reviewer process, which never saw the audit and has no repository access, tries to disprove each finding from the checked evidence alone. Only findings that survive are counted.
4. **Hand check.** Every medium and high finding is read by a person against the code before any number is published.

The sampling rule, the agent markers and the thresholds were fixed before any result was seen. They are recorded in the output file next to the sample.

## What will be published

- The rate: share of pull requests with at least one confirmed false or unsupported claim, overall and by kind of claim (tests, behaviour, docs, scope).
- The method, the scripts, the sampling rule and the full list of dropped candidates.
- Aggregate numbers only. Individual repositories and pull requests are **not** named: the point is the state of agent-written pull requests, not a pillory for the maintainers who merged them. Maintainers of any repository in the sample can ask for their own report.

## Limits, in advance

- "Unsupported" is not the same as "wrong". A claim Elliot cannot verify from the code may still be true; it is counted separately from claims the code contradicts.
- Only claims that are checkable from the repository count. "Improves performance" without a number is not checkable and is excluded, not counted as false.
- Merged pull requests only, so this says nothing about what reviewers caught and rejected.
- Repositories with at least 300 stars are not representative of GitHub as a whole. An early probe found that the large majority of agent-signed merged pull requests sit in small personal repositories; this benchmark deliberately looks at maintained projects instead.
- One audit per pull request, with one model.

## Files

- `scripts/collect.mjs` — builds the sample from the public GitHub API.
- `data/sample.json` — the sample, the rule that produced it and every dropped candidate.
- `.github/workflows/benchmark-collect.yml` — runs the collection from the Actions tab.

## Reproducing it

```bash
GITHUB_TOKEN=<a read-only token> node benchmark/agent-pr-claims/scripts/collect.mjs --out sample.json
```

Collection only reads public data and runs no model. The audit step needs an Anthropic API key and costs roughly one to three dollars per pull request.
