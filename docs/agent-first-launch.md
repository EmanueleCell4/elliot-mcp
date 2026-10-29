# ELLIOT agent-first launch: distribution and activation gates

Goal: get **external agents to perform repeatable, permissioned verification** before changes are accepted. Not repository scoring, fake sign-ups, or installation counts.

## The single initial product

ELLIOT is an independent verifier of coding agents' completion claims. The existing local MCP tools, skill and GitHub Action are the core. Do not build a public score, arena, marketplace, or paid remote API as a prerequisite.

## Where the agent is introduced

1. **Agent runtime**: explicitly enabled skill/plugin. Agent takes a snapshot before edits and verifies claims before reporting DONE.
2. **Pull request**: ELLIOT Action checks statements against the committed code and posts an evidence-based verdict, visible to collaborators.
3. **Repository policy**: an authorized maintainer can eventually require ELLIOT's GitHub status check before merge **only after a fail-closed implementation is independently tested**.

Pre-commit and pre-push local Git hooks are optional convenience checks: they can be bypassed and must not be presented as security controls.

## Release blockers — do not claim a protected pre-merge gate yet

- Current `action/run.sh` emits `verdict=skipped` on a short PR description or missing report. A status check must NOT treat either as a verified pass.
- Current `action/comment.mjs` considers a report without FALSE/PARTIAL findings a pass even if some claims are UNVERIFIABLE. Define explicit policies for unknown evidence.
- Test GitHub fork PRs, secret exposure, malicious repository content/prompt injection, insufficient token permissions and runner failures. Never execute untrusted fork code with privileged credentials.
- A check must bind evidence and verdict to the exact candidate commit SHA, rejecting stale checks after updates.
- Benchmark false positives, false negatives, median time and cost before imposing blocking checks on external teams.

## Distribution without outreach or ad spend

- Publish the existing Action through the official GitHub Marketplace after completing release gates, with a single safe reference workflow.
- Publish and validate the existing Claude Code plugin marketplace instructions.
- Validate and publish ELLIOT's existing MCP package to the official MCP Registry.
- Ship one opt-in runtime integration at a time (first Claude Code; next OpenClaw only after tested), letting an operator enable verification for a fleet. No unauthorized self-installation or automatic posting to third-party repositories.
- Every PR report includes a factual attribution link to the open-source verifier, not promotion or unsolicited comments.

## Measurement: no invented adoption

Daily active external agents = **distinct externally operated agent identities with at least one completed ELLIOT verification on that UTC day**. Requires privacy-respecting opt-in instrumentation or partner reporting and reasonable deduplication.

Track separately: external organizations, externally operated repositories, successfully verified PRs, verified agent identities, repeat agents (D1, D7, D30), failed/inconclusive checks, run cost, and conversions to paid use. Local no-telemetry deployments must be labeled **unmeasured**, not zero or estimated as verified.

## First measurable milestone

One external repository voluntarily enables ELLIOT and completes at least two PR verifications on different commits. Then expand by proving low false-alarm rates and repeat use. No guaranteed adoption target is asserted.

## Business model later

Free self-hosted core, with users covering their own model calls. Only after external retention: managed policy, audit trails and fleet controls. A proposed 30% revenue share is not a live partner program until attributable paid revenues, terms and settlement are implemented.
