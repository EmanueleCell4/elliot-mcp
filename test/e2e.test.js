// End-to-end: spawn the real server over stdio and drive it with the official MCP client.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { digestOf } from "../src/receipt.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "src", "index.js");

let client, siteUrl, ghUrl, repo, elliotDir;

async function call(name, args) {
  const res = await client.callTool({ name, arguments: args });
  const receipt = res.content[1] ? JSON.parse(res.content[1].text) : null;
  return { line: res.content[0].text, receipt };
}

before(async () => {
  siteUrl = "http://site.test";
  ghUrl = "http://github.test";

  repo = await mkdtemp(path.join(tmpdir(), "elliot-repo-"));
  elliotDir = path.join(repo, ".elliot");
  const g = (...a) => execFileSync("git", a, { cwd: repo });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  await writeFile(path.join(repo, "app.js"), "let  x =1 ;\n");
  g("add", "."); g("commit", "-qm", "init");

  client = new Client({ name: "elliot-test", version: "0.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    cwd: repo,
    env: {
      ...process.env,
      ELLIOT_DIR: elliotDir,
      ELLIOT_GITHUB_API: ghUrl,
      ELLIOT_NPM_REGISTRY: "http://registry.test",
      ELLIOT_TEST_SITE_URL: siteUrl,
      GITHUB_TOKEN: "",
      NODE_OPTIONS: `--import=${path.join(here, "fetch-mock.js")}`,
    },
  }));
});

after(async () => {
  await client?.close();
  if (repo) await rm(repo, { recursive: true, force: true });
});

test("lists the tools and ships agent instructions", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["elliot_audit_finish", "elliot_audit_start", "elliot_record_behavior", "elliot_record_claim", "elliot_record_review", "elliot_report", "elliot_review_packet", "elliot_snapshot", "verify_attestation", "verify_changes", "verify_github", "verify_npm", "verify_outcome", "verify_url"]);
  assert.match(client.getInstructions(), /Never say a task is done if the verdict is NOT_VERIFIED/);
});

test("the 'clean the code' lie: snapshot, nothing changes -> NOT_VERIFIED", async () => {
  const snap = await client.callTool({ name: "elliot_snapshot", arguments: {} });
  const id = JSON.parse(snap.content[1].text).snapshot_id;
  const r = await call("verify_changes", { snapshot_id: id, claim: "Done. Code cleaned 100%." });
  assert.equal(r.receipt.verdict, "NOT_VERIFIED");
  assert.equal(r.receipt.evidence.files_changed, 0);
  assert.match(r.line, /0 files changed/);

  await writeFile(path.join(repo, "app.js"), "let x = 1;\n");
  await writeFile(path.join(repo, "new.js"), "export {};\n");
  const r2 = await call("verify_changes", { snapshot_id: id, claim: "Cleaned app.js" });
  assert.equal(r2.receipt.verdict, "VERIFIED");
  assert.deepEqual(r2.receipt.evidence.modified, ["app.js"]);
  assert.deepEqual(r2.receipt.evidence.added, ["new.js"]);

  const scoped = await call("verify_changes", { snapshot_id: id, paths: ["docs"] });
  assert.equal(scoped.receipt.verdict, "NOT_VERIFIED", "changes outside the requested paths do not count");
});

test("verify_changes without a snapshot compares with HEAD", async () => {
  const r = await call("verify_changes", {});
  assert.equal(r.receipt.verdict, "VERIFIED"); // app.js modified + new.js from previous test
  assert.equal(r.receipt.evidence.files_changed, 2);
});

test("verify_url: live page, wrong text, dead port", async () => {
  assert.equal((await call("verify_url", { url: siteUrl + "/", expect_text: "Elliot checks." })).receipt.verdict, "VERIFIED");
  const wrong = await call("verify_url", { url: siteUrl + "/", expect_text: "Pricing" });
  assert.equal(wrong.receipt.verdict, "NOT_VERIFIED");
  assert.equal(wrong.receipt.evidence.text_found, false);
  assert.equal((await call("verify_url", { url: siteUrl + "/missing" })).receipt.verdict, "NOT_VERIFIED");
  assert.equal((await call("verify_url", { url: "http://127.0.0.1:9/" })).receipt.verdict, "NOT_VERIFIED");
});

test("verify_github against a fake API", async () => {
  assert.equal((await call("verify_github", { repo: "acme/app", check: "pr_merged", pr: 1 })).receipt.verdict, "VERIFIED");
  assert.equal((await call("verify_github", { repo: "acme/app", check: "pr_merged", pr: 2 })).receipt.verdict, "NOT_VERIFIED");
  assert.equal((await call("verify_github", { repo: "acme/app", check: "pr_merged", pr: 9 })).receipt.verdict, "NOT_VERIFIED");
  assert.equal((await call("verify_github", { repo: "acme/app", check: "checks_passing", pr: 1 })).receipt.verdict, "VERIFIED");
  const red = await call("verify_github", { repo: "acme/app", check: "checks_passing", pr: 2 });
  assert.equal(red.receipt.verdict, "NOT_VERIFIED");
  assert.match(red.receipt.reason, /test: failure/);
  assert.equal((await call("verify_github", { repo: "acme/app", check: "checks_passing", ref: "ccc333" })).receipt.verdict, "NOT_VERIFIED", "no CI at all is not green");
  assert.equal((await call("verify_github", { repo: "acme/app", check: "commit_exists", ref: "main" })).receipt.verdict, "VERIFIED");
  assert.equal((await call("verify_github", { repo: "acme/app", check: "commit_exists", ref: "nope" })).receipt.verdict, "NOT_VERIFIED");
});

test("verify_npm against a deterministic local registry", async () => {
  const ok = await call("verify_npm", { name: "zod", version: "4.6.7" });
  assert.equal(ok.receipt.verdict, "VERIFIED");
  assert.equal((await call("verify_npm", { name: "zod", version: "999.0.0" })).receipt.verdict, "NOT_VERIFIED");
  assert.equal((await call("verify_npm", { name: "elliot-this-package-does-not-exist-42" })).receipt.verdict, "NOT_VERIFIED");
  const old = await call("verify_npm", { name: "zod", version: "4.6.7", published_after: "2099-01-01T00:00:00Z" });
  assert.equal(old.receipt.verdict, "NOT_VERIFIED", "an old version is not a new publish");
});

test("receipts are persisted, tamper-evident and summarised", async () => {
  const lines = (await readFile(path.join(elliotDir, "receipts.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.length >= 15);
  for (const r of lines) assert.equal(r.digest, digestOf(r));
  const forged = { ...lines[0], verdict: "VERIFIED" === lines[0].verdict ? "NOT_VERIFIED" : "VERIFIED" };
  assert.notEqual(forged.digest, digestOf(forged));

  const report = await client.callTool({ name: "elliot_report", arguments: {} });
  assert.match(report.content[0].text, new RegExp(`^${lines.length} claims checked: \\d+ verified, \\d+ NOT verified`));
});
