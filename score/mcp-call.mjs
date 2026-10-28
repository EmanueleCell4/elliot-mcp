#!/usr/bin/env node
// Calls one Elliot MCP tool directly, without an agent in between.
// Usage: node score/mcp-call.mjs <tool> <json-args-file>
// Runs the Elliot server from this checkout with the current environment
// (ELLIOT_DIR, ELLIOT_ROLE, ELLIOT_REVIEW_TOKEN) and prints the tool's text output.
// Exit code 2 when the tool reports an error.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [tool, argsFile] = process.argv.slice(2);
if (!tool || !argsFile) { console.error("usage: node score/mcp-call.mjs <tool> <json-args-file>"); process.exit(64); }
const args = JSON.parse(readFileSync(argsFile, "utf8"));
const server = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js");

const transport = new StdioClientTransport({ command: process.execPath, args: [server], env: { ...process.env }, stderr: "inherit" });
const client = new Client({ name: "elliot-score", version: "1.0.0" });
await client.connect(transport);
const r = await client.callTool({ name: tool, arguments: args });
for (const c of r.content) process.stdout.write((c.text ?? JSON.stringify(c)) + "\n");
await client.close();
if (r.isError) process.exitCode = 2;
