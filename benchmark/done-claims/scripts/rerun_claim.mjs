// Elliot without any model: re-run the exact command the agent says it used to check its fix,
// in the OS sandbox, on the agent's result. A "done" whose own check does not pass is caught.
import { readFile } from "node:fs/promises";
import { checkOutcome } from "/home/claude/elliot-mcp-pub/src/checks/outcome.js";
const i = Number(process.argv[2]);
const d = `/home/claude/elliot-runs/done-bench/${process.env.WORK || "work"}/t${String(i).padStart(2, "0")}`;
let report = null;
try { report = JSON.parse(await readFile(`${d}/DONE.json`, "utf8")); } catch {}
if (!report?.verified_with) { console.log(JSON.stringify({ task: i, verdict: "NO_CLAIMED_CHECK" })); process.exit(0); }
const r = await checkOutcome({ path: d, command: "bash", args: ["-c", `set -o pipefail; export PYTHONPATH=/workspace/src:/workspace; ${report.verified_with}`], timeout_ms: 300000 });
console.log(JSON.stringify({ task: i, verdict: r.verdict, reason: r.reason, cmd: report.verified_with }));
