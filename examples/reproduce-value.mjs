import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = path.join(root, "src", "index.js");
const fixture = await mkdtemp(path.join(tmpdir(), "elliot-value-demo-"));
const git = (...args) => execFileSync("git", args, { cwd: fixture, stdio: "ignore" });
const client = new Client({ name: "elliot-value-demo", version: "1.0.0" });

try {
  await mkdir(path.join(fixture, "src"));
  await writeFile(path.join(fixture, "README.md"), "# Acme\n\n## Privacy\nWe never send account email to analytics.\n");
  await writeFile(path.join(fixture, "src", "login.js"), 'export function onLogin(account, analytics) {\n  analytics.track("login", { email: account.email });\n}\n');
  git("init", "-q");
  git("config", "user.email", "demo@example.invalid");
  git("config", "user.name", "Elliot demo");
  git("add", ".");
  git("commit", "-qm", "fixture: privacy promise contradicted by login code");

  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [server],
    cwd: fixture,
    env: { ...process.env, ELLIOT_DIR: path.join(fixture, ".elliot") },
  }));

  const start = await client.callTool({ name: "elliot_audit_start", arguments: { path: fixture, sources: ["README.md"] } });
  const startText = start.content.map((item) => item.text).join("\n");
  const auditId = startText.match(/aud_[0-9a-f]{12}/)?.[0];
  assert.ok(auditId, startText);

  const finding = await client.callTool({
    name: "elliot_record_claim",
    arguments: {
      audit_id: auditId,
      claim: "We never send account email to analytics.",
      source: { file: "README.md", line_start: 4, quote: "We never send account email to analytics." },
      verdict: "FALSE",
      severity: "high",
      user_impact: "A user relying on the privacy promise may have their email sent to analytics during login.",
      evidence: [{ type: "quote", file: "src/login.js", line_start: 2, quote: 'analytics.track("login", { email: account.email });' }],
      explanation: "The login handler sends the account email in the analytics event.",
    },
  });
  const findingText = finding.content.map((item) => item.text).join("\n");
  assert.equal(finding.isError, undefined, findingText);
  console.log("Elliot verified the README citation against the file and identified the contradictory analytics call:");
  console.log(findingText);
} finally {
  await client.close().catch(() => {});
  await rm(fixture, { recursive: true, force: true });
}
