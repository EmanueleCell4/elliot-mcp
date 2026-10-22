import { readFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/test-summary.mjs <tap-file>");
let output = "";
try { output = await readFile(file, "utf8"); } catch {}
const last = (name) => [...output.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, "gm"))].at(-1)?.[1] ?? "unavailable";
process.stdout.write(`## Test results\n\n| Passed | Failed | Skipped | Total |\n|---:|---:|---:|---:|\n| ${last("pass")} | ${last("fail")} | ${last("skipped")} | ${last("tests")} |\n`);
