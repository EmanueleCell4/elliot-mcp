// `npx elliot-mcp init`: register Elliot in the coding agents found on this machine
// and add an /elliot-audit command to each. Idempotent: running it twice changes nothing.

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const SERVER = { command: "npx", args: ["-y", "github:EmanueleCell4/elliot-mcp"] };

const COMMAND_BODY = `Run an Elliot claim audit of this repository.

1. Call the Elliot tool \`elliot_audit_start\` with the repository root as \`path\`.
2. Follow the protocol it returns, submitting every claim with \`elliot_record_claim\`.
   Elliot checks each citation against the files; fix and resubmit anything it rejects.
3. Call \`elliot_audit_finish\`. The report is written to \`elliot-report/\` at the repository root.
4. Reply with the totals, the most important finding and the report path. If the result includes
   \`readme_badge\`, show it and say the user can paste it in their README. Nothing else.

If you wrote or changed code in this repository during this session, run the audit in a fresh
subagent that has not seen that work, so the auditor is not the author.
$ARGUMENTS`;

const exists = async (p) => access(p).then(() => true, () => false);

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw new Error(`${file} is not valid JSON; fix it or remove it and run init again`);
  }
}

async function mergeMcpJson(file) {
  const cfg = await readJson(file);
  cfg.mcpServers ??= {};
  if (cfg.mcpServers.elliot) return "already registered";
  cfg.mcpServers.elliot = SERVER;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(cfg, null, 2) + "\n");
  return "registered";
}

async function writeOnce(file, body) {
  if (await exists(file)) {
    const current = await readFile(file, "utf8");
    if (current === body) return "already installed";
    return "kept your existing file";
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  return "installed";
}

async function appendCodexToml(file) {
  let toml = "";
  try { toml = await readFile(file, "utf8"); } catch (err) { if (err.code !== "ENOENT") throw err; }
  if (/^\[mcp_servers\.elliot\]/m.test(toml)) return "already registered";
  const block = `${toml && !toml.endsWith("\n") ? "\n" : ""}\n[mcp_servers.elliot]\ncommand = "npx"\nargs = ["-y", "github:EmanueleCell4/elliot-mcp"]\n`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, toml + block);
  return "registered";
}

export async function runInit(argv = [], { cwd = process.cwd(), home = process.env.ELLIOT_INIT_HOME || homedir(), log = console.log } = {}) {
  const want = new Set(argv.filter((a) => a.startsWith("--")).map((a) => a.slice(2)));
  const all = want.has("all");
  const detected = {
    claude: (await exists(path.join(cwd, ".claude"))) || (await exists(path.join(home, ".claude"))),
    cursor: (await exists(path.join(cwd, ".cursor"))) || (await exists(path.join(home, ".cursor"))),
    codex: await exists(path.join(home, ".codex")),
  };
  const pick = (k) => all || want.has(k) || (!["claude", "cursor", "codex"].some((x) => want.has(x)) && detected[k]);
  const targets = ["claude", "cursor", "codex"].filter(pick);

  if (!targets.length) {
    log("No coding agent found. Run `npx elliot-mcp init --claude`, `--cursor`, `--codex` or `--all`.");
    return 1;
  }

  const rows = [];
  if (targets.includes("claude")) {
    rows.push(["Claude Code", "MCP server (.mcp.json)", await mergeMcpJson(path.join(cwd, ".mcp.json"))]);
    rows.push(["Claude Code", "/elliot-audit", await writeOnce(path.join(cwd, ".claude", "commands", "elliot-audit.md"), `---\ndescription: Check whether this repo does what its docs claim. Writes elliot-report/.\n---\n${COMMAND_BODY}\n`)]);
  }
  if (targets.includes("cursor")) {
    rows.push(["Cursor", "MCP server (.cursor/mcp.json)", await mergeMcpJson(path.join(cwd, ".cursor", "mcp.json"))]);
    rows.push(["Cursor", "/elliot-audit", await writeOnce(path.join(cwd, ".cursor", "commands", "elliot-audit.md"), `${COMMAND_BODY.replace("\n$ARGUMENTS", "")}\n`)]);
  }
  if (targets.includes("codex")) {
    rows.push(["Codex", "MCP server (~/.codex/config.toml)", await appendCodexToml(path.join(home, ".codex", "config.toml"))]);
    rows.push(["Codex", "/prompts:elliot-audit", await writeOnce(path.join(home, ".codex", "prompts", "elliot-audit.md"), `---\ndescription: Check whether this repo does what its docs claim. Writes elliot-report/.\n---\n${COMMAND_BODY}\n`)]);
  }

  const w = Math.max(...rows.map((r) => r[0].length));
  log("Elliot is set up:\n");
  for (const [agent, what, status] of rows) log(`  ${agent.padEnd(w)}  ${what.padEnd(34)} ${status}`);
  log("\nRestart your agent, then run /elliot-audit. The report lands in elliot-report/ at the repo root.");
  return 0;
}
