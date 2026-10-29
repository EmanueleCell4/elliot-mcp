#!/usr/bin/env node
// Codex Stop hook: verifies an *uncommitted file-change claim* using the real ELLIOT MCP server.
// This is an opt-in, limited gate; it does not verify tests, committed changes or deployments.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function needsChangeProof(message = "") {
  return /\b(?:I (?:have )?(?:modified|edited|changed|updated)|(?:files?|code) (?:were|was|have been) (?:modified|edited|changed|updated)|(?:modified|edited|changed|updated) (?:the )?(?:files?|code))\b/i.test(message);
}
export function decisionFromVerdict(verdict, active = false) {
  if (verdict === "VERIFIED") return { systemMessage: "ELLIOT observed working-tree changes. This does not establish correctness, test success or committed changes." };
  if (active) return { systemMessage: "ELLIOT could not verify the claimed working-tree changes. State the uncertainty; do not claim they were verified." };
  return { decision: "block", reason: "ELLIOT did not verify claimed working-tree changes. Inspect the diff or correct the completion statement before stopping." };
}
export async function check(payload, makeClient) {
  if (payload.hook_event_name !== "Stop") return {};
  if (!needsChangeProof(payload.last_assistant_message || "")) return {};
  let client;
  try {
    client = await makeClient(payload.cwd);
    const response = await client.callTool({ name: "verify_changes", arguments: { claim: "There are uncommitted file changes in this repository" } });
    if (response.isError) return decisionFromVerdict("INCONCLUSIVE", payload.stop_hook_active);
    const receipt = JSON.parse(response.content.find((part) => part.text?.includes('"verdict"'))?.text || "{}");
    return decisionFromVerdict(receipt.verdict, payload.stop_hook_active);
  } catch {
    return decisionFromVerdict("INCONCLUSIVE", payload.stop_hook_active);
  } finally {
    await client?.close().catch(() => {});
  }
}
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { console.log(JSON.stringify({ systemMessage: "ELLIOT: invalid hook input; no verification was performed." })); process.exit(0); }
  const result = await check(payload, async (cwd) => {
    const client = new Client({ name: "elliot-codex-stop", version: "0.1.0" });
    const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/index.js");
    const transport = new StdioClientTransport({ command: process.execPath, args: [server], cwd, env: { ...process.env, ELLIOT_DIR: path.join(cwd, ".elliot") } });
    await client.connect(transport);
    return client;
  });
  console.log(JSON.stringify(result));
}
