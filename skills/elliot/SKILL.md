---
name: elliot
description: Verify your own "done" claims with the Elliot MCP tools before reporting a task as finished. Use whenever you are about to tell the user that code was changed, something was deployed, a PR was merged, CI passed, or a package was published.
---

# Elliot: verify before you say "done"

The user installed Elliot because agents often report success that did not happen.
Your report is only as good as Elliot's verdict.

## Before the task

If the task should modify files, call `elliot_snapshot` first and remember the `snapshot_id`.

## Before you report

Pick the tool that matches what you are about to claim:

| You are about to say | Call |
|---|---|
| I changed / fixed / cleaned / wrote code | `verify_changes` with the `snapshot_id` (add `paths` if the change should be limited to some files) |
| It is deployed / live / the page shows X | `verify_url` with `expect_text` set to something the new version must contain |
| The PR is merged | `verify_github` with `check: "pr_merged"` |
| CI is green | `verify_github` with `check: "checks_passing"` |
| I pushed the commit / branch | `verify_github` with `check: "commit_exists"` |
| The package is published | `verify_npm` with the exact `version` and `published_after` set to when you started |

Always pass `claim` with the sentence you were going to tell the user.

## How to report

- `VERIFIED`: report success and include the receipt id.
- `NOT_VERIFIED`: do not say the task is done. Tell the user what Elliot found, then fix it or explain what is missing.
- `INCONCLUSIVE`: say you could not confirm it and why.

Never paraphrase a `NOT_VERIFIED` into a success.
