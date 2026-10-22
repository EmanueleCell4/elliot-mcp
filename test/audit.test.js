// End-to-end claim audit: a repo whose README promises things its code does not do.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { runInit } from "../src/init.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "src", "index.js");
let client, repo, auditId;

const README = `# Acme

## Privacy
Telemetry is off by default and never sends your email.

## Configuration
Set \`ACME_TUNNEL=1\` to enable tunnel mode.

Exports are written as CSV.
`;

before(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "elliot-audit-"));
  const g = (...a) => execFileSync("git", a, { cwd: repo });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  await mkdir(path.join(repo, "src"));
  await writeFile(path.join(repo, "README.md"), README);
  await writeFile(path.join(repo, "src", "config.js"), "export const telemetry = {\n  enabled: true,\n};\n");
  await writeFile(path.join(repo, "src", "login.js"), "export function onLogin(user, track) {\n  track('identify', { email: user.email });\n}\n");
  await writeFile(path.join(repo, "src", "export.js"), "export function toCsv(rows) {\n  return rows.map((r) => r.join(',')).join('\\n');\n}\n");
  g("add", "."); g("commit", "-qm", "init");
  client = new Client({ name: "elliot-audit-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [SERVER], cwd: repo, env: { ...process.env, ELLIOT_DIR: path.join(repo, ".elliot") } }));
});

after(async () => {
  await client?.close();
  if (repo) await rm(repo, { recursive: true, force: true });
});

const call = (name, args) => client.callTool({ name, arguments: args });
const text = (r) => r.content.map((c) => c.text).join("\n");

test("start pins the commit, finds claim sources and returns the protocol", async () => {
  const r = await call("elliot_audit_start", { path: repo });
  auditId = text(r).match(/aud_[0-9a-f]{12}/)[0];
  assert.match(text(r), /README\.md \(\d+ lines\)/);
  assert.match(text(r), /elliot_record_claim/);
});

test("a FALSE claim with real citations is accepted", async () => {
  const r = await call("elliot_record_claim", {
    audit_id: auditId,
    claim: "Telemetry is off by default",
    source: { file: "README.md", line_start: 4, quote: "Telemetry is off by default" },
    verdict: "FALSE", severity: "high", user_impact: "A user who turned nothing on still has their usage sent.",
    evidence: [{ type: "quote", file: "src/config.js", line_start: 2, quote: "enabled: true," }],
    explanation: "The default config turns telemetry on.",
  });
  assert.ok(!r.isError, text(r));
  assert.match(text(r), /recorded #1 FALSE/);
});

test("a citation that is not at those lines is rejected", async () => {
  const r = await call("elliot_record_claim", {
    audit_id: auditId,
    claim: "Never sends your email",
    source: { file: "README.md", line_start: 4, quote: "never sends your email" },
    verdict: "FALSE", severity: "high", user_impact: "A user who turned nothing on still has their usage sent.",
    evidence: [{ type: "quote", file: "src/login.js", line_start: 40, quote: "track('identify', { email: user.email })" }],
    explanation: "Login sends the email to analytics.",
  });
  assert.ok(r.isError);
  assert.match(text(r), /file has only \d+ lines/);
});

test("an invented quote is rejected", async () => {
  const r = await call("elliot_record_claim", {
    audit_id: auditId,
    claim: "Never sends your email",
    source: { file: "README.md", line_start: 4, quote: "never sends your email" },
    verdict: "FALSE", severity: "high", user_impact: "A user who turned nothing on still has their usage sent.",
    evidence: [{ type: "quote", file: "src/login.js", line_start: 2, quote: "posthog.identify(user.email)" }],
    explanation: "Login sends the email to analytics.",
  });
  assert.ok(r.isError);
  assert.match(text(r), /quote does not appear in the file/);
});

test("the corrected citation is accepted", async () => {
  const r = await call("elliot_record_claim", {
    audit_id: auditId,
    claim: "Never sends your email",
    source: { file: "README.md", line_start: 4, quote: "never sends your email" },
    verdict: "FALSE", severity: "high", user_impact: "A user who turned nothing on still has their usage sent.",
    evidence: [{ type: "quote", file: "src/login.js", line_start: 2, quote: "track('identify', { email: user.email })" }],
    explanation: "Login sends the user's email to the analytics tracker.",
  });
  assert.ok(!r.isError, text(r));
});

test("Elliot runs absence searches itself", async () => {
  const missing = await call("elliot_record_claim", {
    audit_id: auditId,
    claim: "ACME_TUNNEL enables tunnel mode",
    source: { file: "README.md", line_start: 7, quote: "Set `ACME_TUNNEL=1` to enable tunnel mode." },
    verdict: "FALSE", severity: "low", user_impact: "Setting ACME_TUNNEL=1 silently does nothing.",
    evidence: [{ type: "absent", pattern: "ACME_TUNNEL" }],
    explanation: "Nothing in the code reads ACME_TUNNEL.",
  });
  assert.ok(!missing.isError, text(missing));

  const present = await call("elliot_record_claim", {
    audit_id: auditId,
    claim: "Exports are written as CSV",
    source: { file: "README.md", line_start: 9, quote: "Exports are written as CSV." },
    verdict: "FALSE", severity: "low", user_impact: "Setting ACME_TUNNEL=1 silently does nothing.",
    evidence: [{ type: "absent", pattern: "toCsv" }],
    explanation: "There is no CSV export.",
  });
  assert.ok(present.isError);
  assert.match(text(present), /pattern found in code: src\/export\.js/);
});

test("VERIFIED needs real implementing code", async () => {
  const r = await call("elliot_record_claim", {
    audit_id: auditId,
    claim: "Exports are written as CSV",
    source: { file: "README.md", line_start: 9, quote: "Exports are written as CSV." },
    verdict: "VERIFIED",
    evidence: [{ type: "quote", file: "src/export.js", line_start: 2, quote: "rows.map((r) => r.join(','))" }],
    explanation: "toCsv joins each row with commas.",
  });
  assert.ok(!r.isError, text(r));
});

test("a finding with no real consequence is refused", async () => {
  const r = await call("elliot_record_claim", {
    audit_id: auditId,
    claim: "Exports are written as CSV",
    source: { file: "README.md", line_start: 9, quote: "Exports are written as CSV." },
    verdict: "PARTIAL", severity: "low",
    evidence: [{ type: "quote", file: "src/export.js", line_start: 2, quote: "rows.map((r) => r.join(','))" }],
    explanation: "Values are not quoted.",
  });
  assert.ok(r.isError);
  assert.match(text(r), /needs user_impact/);
});

test("undisclosed behavior is recorded on its own, with checked evidence", async () => {
  const r = await call("elliot_record_behavior", {
    audit_id: auditId,
    behavior: "Login sends the user's email to the analytics tracker",
    signal: "telemetry", severity: "high",
    user_impact: "Users are identified by email in third-party analytics.",
    docs_searched: "README.md privacy section; no mention of identification",
    evidence: [{ type: "quote", file: "src/login.js", line_start: 2, quote: "track('identify', { email: user.email })" }],
  });
  assert.ok(!r.isError, text(r));
  assert.match(text(r), /behavior b1/);
});

test("finish waits for the independent review, then writes the report", async () => {
  const blocked = await call("elliot_audit_finish", { audit_id: auditId });
  assert.ok(blocked.isError);
  assert.match(text(blocked), /not been independently reviewed/);

  const packet = await call("elliot_review_packet", { audit_id: auditId });
  assert.match(text(packet), /try to prove each finding below WRONG/);
  assert.match(text(packet), /### b1 \(undisclosed behavior/);

  const badReject = await call("elliot_record_review", { audit_id: auditId, finding: "3", outcome: "reject", reason: "the claim holds, I think" });
  assert.ok(badReject.isError);
  assert.match(text(badReject), /reject needs at least one code quote/);

  for (const [finding, outcome] of [["1", "confirm"], ["2", "confirm"], ["3", "downgrade"], ["b1", "confirm"]]) {
    const r = await call("elliot_record_review", { audit_id: auditId, finding, outcome, reason: `reviewed ${finding} against the code` });
    assert.ok(!r.isError, text(r));
  }

  const r = await call("elliot_audit_finish", { audit_id: auditId });
  const dir = text(r).match(/Report written to (.+)/)[1].trim();
  assert.ok(dir.startsWith(path.join(repo, "elliot-report")));
  const data = JSON.parse(await readFile(path.join(dir, "claims.json"), "utf8"));
  assert.deepEqual(
    { claims: data.totals.claims, FALSE: data.totals.FALSE, VERIFIED: data.totals.VERIFIED, behaviors: data.totals.behaviors, downgraded: data.totals.downgraded, rejected: data.totals.rejected_citations },
    { claims: 4, FALSE: 2, VERIFIED: 2, behaviors: 1, downgraded: 1, rejected: 4 },
  );
  const html = await readFile(path.join(dir, "report.html"), "utf8");
  assert.match(html, /2 of 4 claims don&#39;t fully hold up|2 of 4 claims don't fully hold up/);
  assert.match(html, /Undisclosed behavior/);
  assert.match(await readFile(path.join(dir, "report.md"), "utf8"), /## FALSE · high: Telemetry is off by default/);
  const rec = await call("elliot_record_claim", { audit_id: auditId, claim: "late claim", source: { file: "README.md", line_start: 9, quote: "Exports are written as CSV." }, verdict: "UNVERIFIABLE", evidence: [], explanation: "after the audit closed" });
  assert.ok(rec.isError);
});

test("init registers Elliot and the /elliot-audit command, idempotently", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "elliot-init-"));
  const home = await mkdtemp(path.join(tmpdir(), "elliot-home-"));
  await mkdir(path.join(cwd, ".claude")); await mkdir(path.join(home, ".codex"));
  await writeFile(path.join(cwd, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
  const out = [];
  assert.equal(await runInit([], { cwd, home, log: (s) => out.push(s) }), 0);
  const mcp = JSON.parse(await readFile(path.join(cwd, ".mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(mcp.mcpServers).sort(), ["elliot", "other"]);
  await access(path.join(cwd, ".claude", "commands", "elliot-audit.md"));
  await access(path.join(home, ".codex", "prompts", "elliot-audit.md"));
  const toml = await readFile(path.join(home, ".codex", "config.toml"), "utf8");
  assert.match(toml, /\[mcp_servers\.elliot\]/);
  await runInit([], { cwd, home, log: () => {} });
  assert.equal((await readFile(path.join(home, ".codex", "config.toml"), "utf8")).match(/mcp_servers\.elliot/g).length, 1);
  await rm(cwd, { recursive: true, force: true }); await rm(home, { recursive: true, force: true });
});
