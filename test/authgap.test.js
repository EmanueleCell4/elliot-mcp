import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { authGaps } from "../src/risk.js";

test("flags the handler that skips the auth check its siblings perform", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "elliot-auth-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  await mkdir(path.join(dir, "src"));
  await writeFile(path.join(dir, "src/ops.ts"), [
    "export const listFiles: ListFiles<void> = async (_args, context) => {",
    "  if (!context.user) throw new HttpError(401);",
    "  return db.file.findMany({ where: { userId: context.user.id } });",
    "};",
    "export const deleteFile: DeleteFile<In> = async (args, context) => {",
    "  if (!context.user) throw new HttpError(401);",
    "  return db.file.delete({ where: { id: args.id, userId: context.user.id } });",
    "};",
    "export const getDownloadUrl: GetDownloadUrl<In> = async (args) => {",
    "  return sign(args.key);",
    "};",
  ].join("\n"));
  const gaps = await authGaps(dir);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].line, 9);
  assert.match(gaps[0].text, /getDownloadUrl/);
});

test("stays quiet when no handler checks the caller", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "elliot-auth-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  await writeFile(path.join(dir, "util.ts"), "export function a(req) { return 1 }\nexport function b(req) { return 2 }\nexport function c(req) { return 3 }\n");
  assert.equal((await authGaps(dir)).length, 0);
});
