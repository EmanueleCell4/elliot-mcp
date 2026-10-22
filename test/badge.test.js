import { test } from "node:test";
import assert from "node:assert/strict";
import { badge, renderMarkdown } from "../src/audit-report.js";

const base = { project: "demo", commit: "abcdef1234567", finished_at: "2026-10-22T10:00:00Z", elliot: "0.3.1", claims: [], behaviors: [], retracted: [] };
const totals = (o) => ({ claims: 6, VERIFIED: 6, PARTIAL: 0, FALSE: 0, UNVERIFIABLE: 0, behaviors: 0, downgraded: 0, retracted: 0, rejected_citations: 0, ...o });

test("badge only for clean audits with enough claims", () => {
  assert.ok(badge({ ...base, totals: totals() }).markdown.includes("img.shields.io"));
  assert.equal(badge({ ...base, totals: totals({ VERIFIED: 5, FALSE: 1 }) }), null);
  assert.equal(badge({ ...base, totals: totals({ VERIFIED: 5, PARTIAL: 1 }) }), null);
  assert.equal(badge({ ...base, totals: totals({ behaviors: 1 }) }), null);
  assert.equal(badge({ ...base, totals: totals({ claims: 3, VERIFIED: 3 }) }), null);
});

test("report includes the badge section only when eligible", () => {
  assert.match(renderMarkdown({ ...base, totals: totals() }), /README badge/);
  assert.doesNotMatch(renderMarkdown({ ...base, totals: totals({ VERIFIED: 5, FALSE: 1 }) }), /README badge/);
});
