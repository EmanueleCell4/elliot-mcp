import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirs = new Set(["node_modules", ".git", ".elliot"]);
const sourceExtensions = new Set([".js", ".mjs", ".cjs"]);
const secretPatterns = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bgsk_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const files = [];

async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory() && ignoredDirs.has(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) await walk(full);
    else if (item.isFile()) files.push(full);
  }
}

await walk(root);

let failed = false;
for (const file of files.filter((item) => sourceExtensions.has(path.extname(item)))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`Syntax error: ${path.relative(root, file)}\n${result.stderr}`);
  }
}

for (const file of files) {
  let content;
  try { content = await readFile(file, "utf8"); } catch { continue; }
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    failed = true;
    process.stderr.write(`Potential hard-coded credential material: ${path.relative(root, file)}\n`);
  }
}

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const server = JSON.parse(await readFile(path.join(root, "server.json"), "utf8"));
if (pkg.version !== server.version || pkg.version !== server.packages?.[0]?.version) {
  failed = true;
  process.stderr.write("Version mismatch between package.json and server.json\n");
}

if (failed) process.exitCode = 1;
else process.stdout.write(`Static checks passed for ${files.length} workspace files.\n`);
