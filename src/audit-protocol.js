// The protocol returned by elliot_audit_start. The host agent does the reading;
// Elliot checks every citation it submits, and a fresh reviewer re-checks every finding.

export const AUDIT_PROTOCOL = `# Elliot claim audit protocol (audit {{AUDIT_ID}})

Goal: find out whether this project does what it tells its users it does, and whether its code
does risky things its users are never told about.

## 0. Independence
If you wrote or changed code in this repository during this session, hand the audit to a fresh
subagent that has not seen that work (pass it this protocol and the audit id). The auditor must
not be the author.

## 1. Start from the risk sweep
Elliot has listed the riskiest sentences in the docs ([high] candidates) and code signals that
often matter to users (telemetry SDKs, permission bypasses, privileged database clients, secrets
written to disk).
- Every [high] candidate: record a claim whose source is that line, or skip it at the end with a reason.
- Every code signal: open its files and work out what the code really does (what is sent or stored,
  when, with which user data, whether a setting really stops it). Then:
  - if a doc sentence promises something about it, record a claim on THAT sentence;
  - if no doc sentence mentions it and it affects users, record it with elliot_record_behavior;
  - if it is harmless (tests, dev-only, an opt-in feature that is documented), skip it with a reason.
  For an auth_gap signal: open each handler and decide whether it is meant to be public. If it returns or
  changes data that belongs to a user without checking who is calling, that is a finding: a claim on the doc
  sentence that promises access control, or a behavior if the docs say nothing.
  Never attach a signal to a sentence that is about something else.

## 2. Add the other claims users rely on (aim for 12-25 claims in total)
Read README, user docs and product pages (security, privacy, pricing). Pick concrete, checkable
statements: behaviour, security, privacy, data handling, supported platforms or providers, commands,
flags, environment variables, defaults, guarantees. Skip marketing, roadmaps, changelogs, plans and
internal developer docs: they are not promises to users, and Elliot rejects them as sources.

## 3. Trace each claim into the code
Find the code that implements it and read it. Search the whole repository, under other names too,
before deciding something is missing.

Verdicts:
- VERIFIED: the code implements the claim. A small gap that misleads nobody goes in \`note\`.
- PARTIAL: implemented, with a gap that would make a user who relies on the sentence do something wrong.
- FALSE: the code contradicts the claim, or the claimed feature, command, flag or option does not exist.
- UNVERIFIABLE: depends on a deployment, a contract or a service outside the repository.

The materiality test: for PARTIAL and FALSE you must fill \`user_impact\` with what a user who trusts the
sentence would get wrong, concretely. An omission, a sub-second delay, a naming or counting detail is
not a finding: record VERIFIED with a note. Severity: high (security, privacy, data loss, money),
medium (a user relies on it and is misled), low (a real but minor mismatch).

## 4. Submit with Elliot
- elliot_record_claim: source = the doc file and lines with the exact quote; evidence = the code lines,
  each with the exact quote. When the claimed thing does not exist, add {"type": "absent", "pattern":
  "<the name it would need>"}: Elliot runs that search itself.
- elliot_record_behavior: for undisclosed risky behaviour, with code quotes and where you looked in the docs.
If Elliot rejects a submission, re-open the file, fix the lines or the quote, and resubmit.
Never change a verdict just to get it accepted. Do not write exploit code; describe security gaps at a high level.

## 5. Independent review (required)
Call elliot_review_packet. Start a FRESH subagent (Claude Code: the Agent/Task tool) and give it the
returned evidence packet. In isolated mode, connect that subagent only to the reviewer-only MCP server;
the auditor server does not expose elliot_record_review. The reviewer must decide from the checked
evidence packet and record every decision with elliot_record_review. Do not review your own findings.

## 6. Finish
Call elliot_audit_finish with audit_id "{{AUDIT_ID}}", passing in \`skipped\` the sweep items that need no
claim, each with a real reason. If Elliot answers "Not finished", do what it lists and call again.
Then tell the user, in a few lines: the totals, the most important confirmed finding, and the report folder.
`;

// Focused audits check only the claims made in the files the caller named, typically a pull
// request description saved as a file. There is no risk sweep.
export const FOCUSED_PROTOCOL = `# Elliot focused audit protocol (audit {{AUDIT_ID}})

Goal: find out whether the statements in the named source files are true in the code at this commit.
Typical use: the description of a pull request, checked against the code the pull request changes.

## 0. Independence
If you wrote or changed code in this repository during this session, hand the audit to a fresh
subagent that has not seen that work. The auditor must not be the author.

## 1. Pick the claims
Read the source files. Record every concrete, checkable statement about what the code does or now does:
fixes, new behaviour, tests added, flags, defaults, security or data handling, "no behaviour change".
Skip intentions, opinions and plans ("next we will...").

## 2. Trace each claim into the code and record it
Same verdicts and rules as a full audit:
- VERIFIED: the code at this commit does it. Quote the lines that do it.
- PARTIAL: done with a gap that would make a reviewer or user who trusts the sentence do something wrong.
- FALSE: the code contradicts the statement, or the claimed change, test or file is not there.
- UNVERIFIABLE: depends on something outside the repository (a deploy, a CI run, an external service).
PARTIAL and FALSE need \`user_impact\` and a severity. When something claimed is missing, add an
{"type": "absent", "pattern": "<name it would need>"} evidence: Elliot runs that search itself.
Submit each with elliot_record_claim (source = the exact sentence in the source file).

## 3. Independent review (required for any PARTIAL or FALSE)
Call elliot_review_packet and give the evidence packet to a FRESH subagent. In isolated mode, connect
that subagent only to the reviewer-only MCP server, which exposes elliot_record_review.

## 4. Finish
Call elliot_audit_finish with audit_id "{{AUDIT_ID}}". Then report the totals and the most important finding.
`;
