// Regressions for the independent audit of v0.5.0: evidence must come from the audited tree,
// a symlink cannot smuggle outside text in, one finding gets one review, and verify_url does not
// reach local services.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

async function repo() {
  const dir = await mkdtemp(path.join(tmpdir(), "elliot-hard-"));
  process.env.ELLIOT_DIR = path.join(dir, ".elliot");
  const g = (...a) => execFileSync("git", a, { cwd: dir });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  await mkdir(path.join(dir, "src"));
  await writeFile(path.join(dir, "README.md"), "# App\n\nTelemetry is off by default.\n");
  await writeFile(path.join(dir, "src", "config.js"), "export const telemetry = {\n  enabled: true,\n};\n");
  g("add", "."); g("commit", "-qm", "init");
  return dir;
}

const falseClaim = (id) => ({
  audit_id: id, claim: "Telemetry is off by default", source: { file: "README.md", line_start: 3, quote: "Telemetry is off by default." },
  verdict: "FALSE", severity: "high", user_impact: "Users who trust the README have their usage sent.",
  evidence: [{ type: "quote", file: "src/config.js", line_start: 2, quote: "enabled: true," }],
  explanation: "The config turns telemetry on.",
});

test("a symlink that points outside the repository is not evidence", async () => {
  const dir = await repo();
  const outside = await mkdtemp(path.join(tmpdir(), "elliot-outside-"));
  await writeFile(path.join(outside, "secret.txt"), "the outside secret text\n");
  await symlink(path.join(outside, "secret.txt"), path.join(dir, "link.txt"));
  const { checkQuote } = await import("../src/audit.js");
  const r = await checkQuote(dir, { file: "link.txt", line_start: 1, quote: "the outside secret text" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /outside the repository/);
});

test("evidence written after the audit started is refused", async () => {
  const dir = await repo();
  const { startAudit, recordClaim } = await import("../src/audit.js");
  const a = await startAudit({ path: dir, sources: ["README.md"] });
  await writeFile(path.join(dir, "src", "planted.js"), "// enabled: true, planted after the pin\n");
  await assert.rejects(recordClaim(falseClaim(a.id)), /working tree changed after this audit started/);
});

test("untracked files make the tree dirty at start", async () => {
  const dir = await repo();
  await writeFile(path.join(dir, "notes.txt"), "untracked\n");
  const { startAudit } = await import("../src/audit.js");
  assert.equal((await startAudit({ path: dir, sources: ["README.md"] })).dirty, true);
});

test("two concurrent reviews of one finding: exactly one is recorded", async () => {
  const dir = await repo();
  const { startAudit, recordClaim, recordReview } = await import("../src/audit.js");
  const a = await startAudit({ path: dir, sources: ["README.md"] });
  assert.equal((await recordClaim(falseClaim(a.id))).accepted, true);
  const review = (outcome) => recordReview({ audit_id: a.id, finding: "1", outcome, reason: "checked", evidence: [{ type: "quote", file: "src/config.js", line_start: 2, quote: "enabled: true," }] });
  const results = await Promise.allSettled([review("confirm"), review("downgrade")]);
  assert.equal(results.filter((r) => r.status === "fulfilled" && r.value.accepted).length, 1);
  assert.match(results.find((r) => r.status === "rejected").reason.message, /already has a review decision/);
});

test("confirm without evidence is refused", async () => {
  const dir = await repo();
  const { startAudit, recordClaim, recordReview } = await import("../src/audit.js");
  const a = await startAudit({ path: dir, sources: ["README.md"] });
  await recordClaim(falseClaim(a.id));
  const r = await recordReview({ audit_id: a.id, finding: "1", outcome: "confirm", reason: "looks right" });
  assert.equal(r.accepted, false);
  assert.match(r.problems.join(" "), /confirm needs evidence/);
});

test("verify_url refuses loopback, private and metadata addresses", async () => {
  const { checkUrl } = await import("../src/checks/url.js");
  for (const url of ["http://127.0.0.1:1/", "http://localhost/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "http://[::1]/"]) {
    const r = await checkUrl({ url });
    assert.equal(r.verdict, "NOT_VERIFIED", url);
    assert.match(r.reason, /local address|private or local/, url);
  }
});
