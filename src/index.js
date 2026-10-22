#!/usr/bin/env node
// Elliot: your agent says it's done. Elliot checks.
// An MCP server that verifies an agent's "done" claims against ground truth.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { VERSION, makeReceipt, saveReceipt, readReceipts } from "./receipt.js";
import { checkUrl } from "./checks/url.js";
import { checkNpm } from "./checks/npm.js";
import { checkGithub } from "./checks/github.js";
import { snapshot, checkChanges } from "./checks/changes.js";
import { startAudit, recordClaim, recordBehavior, reviewPacket, recordReview, finishAudit, AUDIT_VERDICTS, SEVERITIES, REVIEW_OUTCOMES } from "./audit.js";
import { AUDIT_PROTOCOL } from "./audit-protocol.js";

if (process.argv[2] === "init") {
  const { runInit } = await import("./init.js");
  process.exitCode = await runInit(process.argv.slice(3));
} else {

const INSTRUCTIONS = `Elliot verifies "done" claims against ground truth, not against the agent's own report.

Rules for the agent:
1. Before starting a task that should modify files, call elliot_snapshot and keep the snapshot_id.
2. Before telling the user a task is done, call the elliot tool that matches the claim:
   - files were changed/fixed/cleaned -> verify_changes (with the snapshot_id)
   - something is deployed or live     -> verify_url
   - a PR is merged / CI is green / a commit is pushed -> verify_github
   - a package is published            -> verify_npm
3. Report Elliot's verdict to the user verbatim with the receipt id. Never say a task is done if the verdict is NOT_VERIFIED; say what Elliot found instead. INCONCLUSIVE means: say you could not confirm it.
4. When the user asks for a claim audit ("/elliot-audit", "audit this repo", "does the code do what the README says"), call elliot_audit_start and follow the protocol it returns. Elliot checks every citation you give it; uncheckable claims are rejected.`;

const server = new McpServer({ name: "elliot", version: VERSION }, { instructions: INSTRUCTIONS });

const claim = z.string().max(500).optional().describe("The claim being checked, in the agent's own words, e.g. 'Deployed the landing page'.");

async function respond(check, input, result) {
  const receipt = await saveReceipt(makeReceipt({ check, claim: input.claim, ...result }));
  const icon = { VERIFIED: "✅", NOT_VERIFIED: "❌", INCONCLUSIVE: "⚠️" }[receipt.verdict];
  return {
    content: [
      { type: "text", text: `${icon} ${receipt.verdict}: ${receipt.reason}  [receipt ${receipt.id}]` },
      { type: "text", text: JSON.stringify(receipt, null, 2) },
    ],
  };
}

const readOnly = { readOnlyHint: true, openWorldHint: true };

server.registerTool(
  "verify_url",
  {
    title: "Verify a URL is live",
    description: "Check that a URL (a deploy, a preview, a page) actually responds with the expected status and, optionally, contains expected text. Use before claiming something is deployed or live.",
    inputSchema: {
      url: z.string().url().describe("The URL that should be live."),
      expect_status: z.number().int().min(100).max(599).optional().describe("Expected HTTP status (default 200)."),
      expect_text: z.string().max(2000).optional().describe("Text that must appear in the response body, e.g. a headline you just shipped."),
      claim,
    },
    annotations: readOnly,
  },
  async (input) => respond("url", input, await checkUrl(input)),
);

server.registerTool(
  "verify_github",
  {
    title: "Verify a GitHub claim",
    description: "Check what GitHub actually says: whether a PR is merged, whether CI checks passed on a PR or commit, or whether a commit/branch was really pushed. Set GITHUB_TOKEN for private repos.",
    inputSchema: {
      repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/).describe("owner/name"),
      check: z.enum(["pr_merged", "checks_passing", "commit_exists"]),
      pr: z.number().int().positive().optional().describe("Pull request number."),
      ref: z.string().max(255).optional().describe("Commit sha or branch name."),
      claim,
    },
    annotations: readOnly,
  },
  async (input) => respond("github", input, await checkGithub(input)),
);

server.registerTool(
  "verify_npm",
  {
    title: "Verify an npm package was published",
    description: "Check the npm registry for a package and version. Use before claiming a package or release was published.",
    inputSchema: {
      name: z.string().min(1).max(214).describe("Package name, e.g. 'zod' or '@scope/pkg'."),
      version: z.string().max(100).optional().describe("Exact version; defaults to the latest dist-tag."),
      published_after: z.string().datetime().optional().describe("ISO time the version must have been published after (proves it is a new publish)."),
      claim,
    },
    annotations: readOnly,
  },
  async (input) => respond("npm", input, await checkNpm(input)),
);

server.registerTool(
  "elliot_snapshot",
  {
    title: "Snapshot the working tree",
    description: "Fingerprint every tracked and untracked file in the git repository before starting a task, so verify_changes can later prove what really changed.",
    inputSchema: {
      path: z.string().optional().describe("Any path inside the repository (default: the server's working directory)."),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async (input) => {
    const snap = await snapshot(input);
    return { content: [{ type: "text", text: `📸 snapshot ${snap.snapshot_id}: ${snap.files} files at ${snap.head ? snap.head.slice(0, 12) : "no commits"}` }, { type: "text", text: JSON.stringify(snap, null, 2) }] };
  },
);

server.registerTool(
  "verify_changes",
  {
    title: "Verify files actually changed",
    description: "Check whether files really changed, compared with a snapshot taken before the task (or with HEAD if no snapshot is given). Use before claiming code was fixed, cleaned, refactored or written.",
    inputSchema: {
      snapshot_id: z.string().regex(/^snap_[0-9a-f]+$/).optional().describe("Id returned by elliot_snapshot."),
      path: z.string().optional().describe("Any path inside the repository."),
      paths: z.array(z.string()).max(100).optional().describe("Only count changes under these repo-relative paths."),
      claim,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async (input) => respond("changes", input, await checkChanges(input)),
);

server.registerTool(
  "elliot_report",
  {
    title: "Honesty report",
    description: "Summarise recent receipts: how many claims were checked and how many held up. Show this to the user when they ask what the agent really did.",
    inputSchema: { limit: z.number().int().min(1).max(1000).optional().describe("How many recent receipts (default 50).") },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ limit = 50 }) => {
    const all = (await readReceipts()).slice(-limit);
    const count = (v) => all.filter((r) => r.verdict === v).length;
    const v = count("VERIFIED"), n = count("NOT_VERIFIED"), i = count("INCONCLUSIVE");
    const lines = all.slice(-10).reverse().map((r) => `${r.verdict.padEnd(12)} ${r.check.padEnd(8)} ${r.claim || r.target}  (${r.id})`);
    const head = all.length
      ? `${all.length} claims checked: ${v} verified, ${n} NOT verified, ${i} inconclusive.`
      : "No receipts yet.";
    return { content: [{ type: "text", text: [head, ...lines].join("\n") }] };
  },
);

const location = {
  file: z.string().min(1).max(500).describe("Repo-relative path, e.g. 'README.md' or 'src/auth.ts'."),
  line_start: z.number().int().min(1).describe("First line of the quoted text (1-based)."),
  line_end: z.number().int().min(1).optional().describe("Last line of the quoted text, if it spans several lines."),
  quote: z.string().min(8).max(1000).describe("The exact text at those lines, copied from the file (whitespace may differ)."),
};
const quoteEvidence = z.object({ type: z.literal("quote"), ...location });
const absentEvidence = z.object({
  type: z.literal("absent"),
  pattern: z.string().min(3).max(200).describe("A name the claimed feature would need in code (env var, flag, function, route). Elliot searches the repo itself."),
  regex: z.boolean().optional().describe("Treat pattern as an extended regex (default: fixed string)."),
});

server.registerTool(
  "elliot_audit_start",
  {
    title: "Start a claim audit",
    description: "Start auditing whether this repository does what its README, docs and security/pricing pages say. Pins the commit, lists the files that make claims, and returns the protocol to follow.",
    inputSchema: { path: z.string().optional().describe("Any path inside the repository (default: the server's working directory).") },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async (input) => {
    const a = await startAudit(input);
    const head = `🔎 audit ${a.id} on ${a.project} @ ${a.commit ? a.commit.slice(0, 12) : "uncommitted"}${a.dirty ? " (uncommitted changes)" : ""}: ${a.sources.length} files that make claims, ${a.file_count} files in the repo.`;
    const list = a.sources.map((s) => `- ${s.file} (${s.lines} lines)`).join("\n");
    const cands = a.candidates.map((c) => `- ${c.id} [${c.risk}] ${c.file}:${c.line}  ${c.text}`).join("\n");
    const sigs = a.signals.map((s) => `- ${s.id}: ${s.label}, ${s.hit_count} hits in ${s.files.length} files, e.g.\n${s.examples.map((e) => `    ${e.file}:${e.line}  ${e.text}`).join("\n")}`).join("\n");
    const sweep = `Risk sweep (found by Elliot, not by you). The audit cannot finish until every [high] candidate and every code signal is addressed.\n\nDoc candidates:\n${cands || "- none"}\n\nCode signals:\n${sigs || "- none"}`;
    return { content: [{ type: "text", text: `${head}\n\nClaim sources:\n${list || "- none found: read the README and any user-facing pages you can find"}` }, { type: "text", text: sweep }, { type: "text", text: AUDIT_PROTOCOL.replaceAll("{{AUDIT_ID}}", a.id) }] };
  },
);

server.registerTool(
  "elliot_record_claim",
  {
    title: "Record one audited claim",
    description: "Submit one claim with its verdict and evidence. Elliot checks that the claim's source quote is really in the docs at those lines, that every evidence quote is really in the code at those lines, and runs every 'absent' search itself. If anything does not check out the claim is rejected: fix the citation and submit again.",
    inputSchema: {
      audit_id: z.string().regex(/^aud_[0-9a-f]{12}$/),
      claim: z.string().min(5).max(500).describe("The claim, quoted or tightly paraphrased, as a user would read it."),
      source: z.object(location).describe("Where the project makes the claim."),
      verdict: z.enum(AUDIT_VERDICTS).describe("VERIFIED: the code implements it. PARTIAL: implemented with a material gap or narrower than claimed. FALSE: the code contradicts it or the feature does not exist. UNVERIFIABLE: depends on a deployment, contract or service outside the repo."),
      severity: z.enum(SEVERITIES).optional().describe("Required for PARTIAL and FALSE: how much a user relying on the claim is hurt."),
      evidence: z.array(z.discriminatedUnion("type", [quoteEvidence, absentEvidence])).max(8).describe("Code that implements or contradicts the claim. Use type 'absent' when the claimed thing does not exist in code."),
      explanation: z.string().min(10).max(1200).describe("One or two plain sentences: what the code actually does."),
      user_impact: z.string().max(600).optional().describe("Required for PARTIAL and FALSE: what a user who relies on this sentence would get wrong, concretely. If there is no real consequence, use VERIFIED with a note."),
      note: z.string().max(600).optional().describe("For VERIFIED: a minor gap worth mentioning that misleads nobody."),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async (input) => {
    const r = await recordClaim(input);
    if (!r.accepted) return { isError: true, content: [{ type: "text", text: `❌ REJECTED: Elliot could not confirm the citations.\n- ${r.problems.join("\n- ")}\nRe-read the files, fix the line numbers or quotes, and submit again. Do not change the verdict to make it pass.` }] };
    const t = r.totals;
    return { content: [{ type: "text", text: `✅ recorded #${r.entry.n} ${r.entry.verdict} [receipt ${r.entry.receipt}]  ·  so far: ${t.claims} claims, ${t.VERIFIED} verified, ${t.PARTIAL} partial, ${t.FALSE} false, ${t.UNVERIFIABLE} unverifiable, ${t.rejected_citations} rejected citations` }] };
  },
);

server.registerTool(
  "elliot_record_behavior",
  {
    title: "Record undisclosed risky behavior",
    description: "Record something risky the code does that the docs never mention (for example, it sends usage events, stores a key in plain text, or skips permission prompts) and no doc sentence promises otherwise. If a doc sentence does promise otherwise, use elliot_record_claim on that sentence instead. Never attach this to an unrelated sentence.",
    inputSchema: {
      audit_id: z.string().regex(/^aud_[0-9a-f]{12}$/),
      behavior: z.string().min(10).max(500).describe("What the code does, plainly, e.g. 'Sends the user email to PostHog on login'."),
      signal: z.string().optional().describe("The code signal id from the risk sweep that led here, if any."),
      severity: z.enum(SEVERITIES),
      user_impact: z.string().min(20).max(600).describe("Who is affected and how."),
      docs_searched: z.string().min(10).max(400).describe("Where you looked in the docs and found nothing about it."),
      evidence: z.array(quoteEvidence).min(1).max(8).describe("Code that does it."),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async (input) => {
    const r = await recordBehavior(input);
    if (!r.accepted) return { isError: true, content: [{ type: "text", text: `❌ REJECTED:\n- ${r.problems.join("\n- ")}` }] };
    return { content: [{ type: "text", text: `✅ recorded behavior ${r.entry.n} [receipt ${r.entry.receipt}]` }] };
  },
);

server.registerTool(
  "elliot_review_packet",
  {
    title: "Get the independent review packet",
    description: "Returns a self-contained prompt listing every FALSE, PARTIAL and undisclosed-behavior finding that still needs review. Give it to a FRESH subagent that has not seen the audit (in Claude Code, the Agent/Task tool), and let that subagent record its decisions with elliot_record_review. Do not review your own findings.",
    inputSchema: { audit_id: z.string().regex(/^aud_[0-9a-f]{12}$/) },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async (input) => {
    const r = await reviewPacket(input);
    if (!r.pending) return { content: [{ type: "text", text: "Nothing to review: no FALSE, PARTIAL or behavior findings are pending." }] };
    return { content: [{ type: "text", text: `${r.pending} findings need an independent review. Start a fresh subagent and give it exactly the prompt below.` }, { type: "text", text: r.prompt }] };
  },
);

server.registerTool(
  "elliot_record_review",
  {
    title: "Record an independent review decision",
    description: "For the reviewer subagent: confirm, downgrade or reject one finding. Reject needs a code quote showing the claim holds; quotes are checked against the files.",
    inputSchema: {
      audit_id: z.string().regex(/^aud_[0-9a-f]{12}$/),
      finding: z.string().regex(/^(\d+|b\d+)$/).describe("The finding id, e.g. 3 or b1."),
      outcome: z.enum(REVIEW_OUTCOMES).describe("confirm: real and material. downgrade: true but immaterial. reject: the claim actually holds."),
      reason: z.string().min(10).max(800),
      severity: z.enum(SEVERITIES).optional().describe("Corrected severity, when the auditor's is wrong."),
      evidence: z.array(quoteEvidence).max(6).optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async (input) => {
    const r = await recordReview(input);
    if (!r.accepted) return { isError: true, content: [{ type: "text", text: `❌ REJECTED:\n- ${r.problems.join("\n- ")}` }] };
    return { content: [{ type: "text", text: `✅ ${r.finding}: ${r.outcome}. ${r.pending} findings still need review.` }] };
  },
);

server.registerTool(
  "elliot_audit_finish",
  {
    title: "Finish the audit and write the report",
    description: "Close the audit and write report.html, report.md and claims.json into elliot-report/<date>-<commit>/ at the repository root.",
    inputSchema: {
      audit_id: z.string().regex(/^aud_[0-9a-f]{12}$/),
      out_dir: z.string().optional().describe("Override the output folder (relative to the repository root)."),
      skipped: z.array(z.object({
        candidate: z.string().regex(/^c\d+$/).optional().describe("A doc candidate id, e.g. c3."),
        signal: z.string().optional().describe("A code signal id, e.g. telemetry."),
        reason: z.string().min(10).max(300).describe("Why it needs no verdict, e.g. 'describes a third-party product, not this project'."),
      })).max(60).optional().describe("Risk-sweep items you looked at and decided need no claim, each with a reason. They are listed in the report."),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  },
  async (input) => {
    const r = await finishAudit(input);
    if (!r.finished && r.missing) return { isError: true, content: [{ type: "text", text: `⏸ Not finished: ${r.missing.length} risk-sweep items are not addressed yet.\n${r.missing.map((m) => `- ${m.kind === "candidate" ? m.id : "signal " + m.id} ${m.where}: ${m.text}`).join("\n")}\nFor a doc candidate: record a claim whose source is that line, or skip it with a reason. For a code signal: record a claim on the doc sentence that promises something about it, or an elliot_record_behavior if the docs say nothing, or skip it with a reason. Then call elliot_audit_finish again.` }] };
    if (!r.finished) return { isError: true, content: [{ type: "text", text: `⏸ Not finished: ${r.unreviewed.length} findings (${r.unreviewed.join(", ")}) have not been independently reviewed. Call elliot_review_packet, give its prompt to a fresh subagent, and when it has recorded every decision call elliot_audit_finish again with the same skipped list.` }] };
    const t = r.totals;
    return { content: [{ type: "text", text: `📄 Report written to ${r.dir}\n${t.claims} claims: ${t.VERIFIED} verified, ${t.PARTIAL} partial, ${t.FALSE} false, ${t.UNVERIFIABLE} unverifiable. ${t.behaviors} undisclosed behaviors. The independent review downgraded ${t.downgraded} findings to notes and retracted ${t.retracted}. ${t.rejected_citations} citations were rejected and corrected along the way.\nFiles:\n- ${r.files.join("\n- ")}` }] };
  },
);

await server.connect(new StdioServerTransport());
}
