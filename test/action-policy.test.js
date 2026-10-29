import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { verdictFor } from "../action/verdict.mjs";
import { enforcement } from "../action/enforce.mjs";

const record = (changes = {}) => ({ claims: 2, VERIFIED: 2, PARTIAL: 0, FALSE: 0, UNVERIFIABLE: 0, behaviors: 0, ...changes });

test("passing PR must have verified claims", () => {
  assert.equal(verdictFor(record()), "pass");
});
test("unverifiable, missing or contradictory totals never pass", () => {
  assert.equal(verdictFor(record({ VERIFIED: 1, UNVERIFIABLE: 1 })), "inconclusive");
  assert.equal(verdictFor(record({ VERIFIED: 1 })), "inconclusive");
  assert.equal(verdictFor(null), "inconclusive");
});
test("false, partial or undisclosed behaviors are findings", () => {
  assert.equal(verdictFor(record({ VERIFIED: 1, FALSE: 1 })), "findings");
  assert.equal(verdictFor(record({ VERIFIED: 1, PARTIAL: 1 })), "findings");
  assert.equal(verdictFor(record({ behaviors: 1 })), "findings");
});
test("no claims cannot pass strict policy", () => {
  assert.equal(verdictFor(record({ claims: 0, VERIFIED: 0 })), "skipped");
  assert.equal(verdictFor(record({ claims: 0, VERIFIED: 0, behaviors: 1 })), "findings");
  assert.equal(enforcement("strict", "skipped").ok, false);
  assert.equal(enforcement("strict", "inconclusive").ok, false);
  assert.equal(enforcement("strict", "findings").ok, false);
  assert.equal(enforcement("strict", "").ok, false);
  assert.equal(enforcement("strict", "pass").ok, true);
});
test("report-only stays non-blocking; invalid configuration fails", () => {
  assert.equal(enforcement("report", "findings").ok, true);
  assert.equal(enforcement("foo", "pass").ok, false);
});
test("enforcement CLI returns nonzero for strict non-pass", () => {
  const cli = new URL("../action/enforce.mjs", import.meta.url).pathname;
  const base = { ...process.env, ELLIOT_MODE: "strict" };
  assert.equal(spawnSync(process.execPath, [cli], { env: { ...base, ELLIOT_VERDICT: "pass" } }).status, 0);
  assert.equal(spawnSync(process.execPath, [cli], { env: { ...base, ELLIOT_VERDICT: "skipped" } }).status, 1);
});
