import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { startAudit, recordClaim, reviewPacket, recordReview } from "../src/audit.js";

test("isolated review capabilities are audit-scoped, credential checked and non-replayable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "elliot-review-auth-"));
  const env = { ELLIOT_DIR: process.env.ELLIOT_DIR, ELLIOT_ROLE: process.env.ELLIOT_ROLE, ELLIOT_REVIEW_TOKEN: process.env.ELLIOT_REVIEW_TOKEN };
  try {
    const git = (...args) => execFileSync("git", args, { cwd: root });
    git("init", "-q"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "test");
    await writeFile(path.join(root, "README.md"), "## Claim\nFeature is always enabled.\n");
    git("add", "."); git("commit", "-qm", "fixture");
    process.env.ELLIOT_DIR = path.join(root, ".elliot");
    process.env.ELLIOT_ROLE = "auditor";
    process.env.ELLIOT_REVIEW_TOKEN = "correct-server-secret";

    async function makeAudit() {
      const audit = await startAudit({ path: root, sources: ["README.md"] });
      const recorded = await recordClaim({
        audit_id: audit.id, claim: "Feature is always enabled", source: { file: "README.md", line_start: 2, quote: "Feature is always enabled." },
        verdict: "FALSE", severity: "high", user_impact: "Users expect the feature but the code leaves it off.", evidence: [{ type: "quote", file: "README.md", line_start: 2, quote: "Feature is always enabled." }],
        explanation: "The implementation does not enable this feature.",
      });
      assert.equal(recorded.accepted, true);
      const packet = await reviewPacket({ audit_id: audit.id });
      const capability = packet.prompt.match(/reviewer_token "([^"]+)"/)?.[1];
      assert.ok(capability);
      return { audit, capability };
    }

    const first = await makeAudit();
    const second = await makeAudit();
    const review = { finding: "1", outcome: "confirm", reason: "The supplied checked evidence supports this finding." };

    process.env.ELLIOT_ROLE = "reviewer";
    process.env.ELLIOT_REVIEW_TOKEN = "wrong-server-secret";
    await assert.rejects(recordReview({ ...review, audit_id: first.audit.id, reviewer_token: first.capability }), /server credential does not match/);

    process.env.ELLIOT_REVIEW_TOKEN = "correct-server-secret";
    await assert.rejects(recordReview({ ...review, audit_id: first.audit.id, reviewer_token: second.capability }), /invalid or belongs to another audit/);
    assert.equal((await recordReview({ ...review, audit_id: first.audit.id, reviewer_token: first.capability })).accepted, true);
    await assert.rejects(recordReview({ ...review, audit_id: first.audit.id, reviewer_token: first.capability }), /already has a review decision/);
    assert.equal((await recordReview({ ...review, audit_id: second.audit.id, reviewer_token: second.capability })).accepted, true);
  } finally {
    for (const [key, value] of Object.entries({ ELLIOT_DIR: env.ELLIOT_DIR, ELLIOT_ROLE: env.ELLIOT_ROLE, ELLIOT_REVIEW_TOKEN: env.ELLIOT_REVIEW_TOKEN })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
