---
name: audit
description: Check whether this repository does what its docs claim, with proof from the code. Use when the user asks to audit a repo, verify README/docs promises (privacy, telemetry, security, permissions), or review work an agent says is done. Writes elliot-report/.
---

# Elliot claim audit

1. Call the Elliot tool `elliot_audit_start` with the repository root as `path`.
2. Follow the protocol it returns, submitting every claim with `elliot_record_claim`.
   Elliot checks each citation against the files; fix and resubmit anything it rejects.
3. Call `elliot_audit_finish`. The report is written to `elliot-report/` at the repository root.
4. Reply with the totals, the most important finding and the report path. Nothing else.

If you wrote or changed code in this repository during this session, run the audit in a fresh
subagent that has not seen that work, so the auditor is not the author.
