// The risk sweep decides what must be audited: an audit cannot finish with risky promises left unaddressed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

test("risky promises and code signals block finishing until addressed", async () => {
  const repo = await mkdtemp(path.join(tmpdir(), "elliot-risk-"));
  process.env.ELLIOT_DIR = path.join(repo, ".elliot");
  const { startAudit, finishAudit, recordClaim, recordReview } = await import("../src/audit.js");
  const g = (...a) => execFileSync("git", a, { cwd: repo });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  await mkdir(path.join(repo, "src"));
  await writeFile(path.join(repo, "README.md"), "# App\n\nAll data stays on your machine. We never send telemetry.\n\nIt has a dark theme.\n");
  await writeFile(path.join(repo, "src", "analytics.js"), "import posthog from 'posthog-js';\nposthog.init('phc_x');\n");
  g("add", "."); g("commit", "-qm", "init");

  const a = await startAudit({ path: repo });
  assert.equal(a.candidates.filter((c) => c.risk === "high").length, 1);
  assert.deepEqual(a.signals.map((s) => s.id), ["telemetry"]);

  const blocked = await finishAudit({ audit_id: a.id });
  assert.equal(blocked.finished, false);
  assert.deepEqual(blocked.missing.map((m) => m.kind).sort(), ["candidate", "signal"]);

  const r = await recordClaim({
    audit_id: a.id, claim: "All data stays on your machine; no telemetry",
    source: { file: "README.md", line_start: 3, quote: "All data stays on your machine." },
    verdict: "FALSE", severity: "high", user_impact: "Users who trust the README have their usage sent to PostHog.",
    evidence: [{ type: "quote", file: "src/analytics.js", line_start: 2, quote: "posthog.init('phc_x');" }],
    explanation: "The app initialises PostHog analytics on start.",
  });
  assert.ok(r.accepted, JSON.stringify(r.problems));
  const unreviewed = await finishAudit({ audit_id: a.id });
  assert.deepEqual(unreviewed.unreviewed, ["1"]);
  await recordReview({ audit_id: a.id, finding: "1", outcome: "confirm", reason: "posthog.init runs on import", evidence: [{ type: "quote", file: "src/analytics.js", line_start: 2, quote: "posthog.init('phc_x');" }] });
  const done = await finishAudit({ audit_id: a.id });
  assert.equal(done.finished, true);
  await rm(repo, { recursive: true, force: true });
});
