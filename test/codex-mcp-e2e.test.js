// Exercise the actual Stop hook -> MCP stdio -> verify_changes -> receipt path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { check } from "../codex/stop-hook.mjs";

test("Codex Stop -> real Elliot MCP: unchanged false claim is blocked, actual change is observed", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "elliot-codex-e2e-"));
  const runGit = (...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
  try {
    runGit("init", "-q");
    runGit("config", "user.name", "Test");
    runGit("config", "user.email", "test@example.invalid");
    await writeFile(path.join(cwd, "app.js"), "export const n = 1;\n");
    runGit("add", ".");
    runGit("commit", "-qm", "base");
    const factory = async (dir) => {
      const c = new Client({ name: "codex-hook-e2e", version: "1.0.0" });
      await c.connect(new StdioClientTransport({
        command: process.execPath,
        args: [path.resolve("src/index.js")],
        cwd: dir,
        env: { ...process.env, ELLIOT_DIR: path.join(dir, ".elliot"), GITHUB_TOKEN: "" },
      }));
      return c;
    };
    const payload = { hook_event_name: "Stop", cwd, last_assistant_message: "I modified the code", stop_hook_active: false };
    const missing = await check(payload, factory);
    assert.equal(missing.decision, "block", JSON.stringify(missing));
    await writeFile(path.join(cwd, "app.js"), "export const n = 2;\n");
    const observed = await check(payload, factory);
    assert.equal(observed.decision, undefined);
    assert.match(observed.systemMessage, /observed working-tree changes/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
