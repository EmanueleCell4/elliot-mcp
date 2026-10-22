import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/index.js");

test("configured reviewer process exposes only the review capability", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "elliot-reviewer-test-"));
  const clients = [];
  try {
    for (const role of ["reviewer", "auditor"]) {
      const client = new Client({ name: `isolation-${role}`, version: "1" });
      clients.push(client);
      await client.connect(new StdioClientTransport({
        command: process.execPath, args: [serverPath], cwd: dir,
        env: { ...process.env, ELLIOT_DIR: path.join(dir, role), ELLIOT_ROLE: role, ELLIOT_REVIEW_TOKEN: "deployment-review-key" },
      }));
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      if (role === "reviewer") assert.deepEqual(names, ["elliot_record_review"]);
      else assert.deepEqual(names.sort(), ["elliot_audit_finish", "elliot_audit_start", "elliot_record_behavior", "elliot_record_claim", "elliot_report", "elliot_review_packet", "elliot_snapshot", "verify_attestation", "verify_changes", "verify_github", "verify_npm", "verify_outcome", "verify_url"]);
    }
  } finally {
    await Promise.all(clients.map((client) => client.close()));
    await rm(dir, { recursive: true, force: true });
  }
});
