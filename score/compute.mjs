#!/usr/bin/env node
// ELLIOT Score: turns an Elliot claims.json into a public score record.
//
// Usage: node score/compute.mjs <claims.json> <owner/repo> > record.json
//
// The score measures how many of a project's checkable promises hold up in its own code,
// weighted by how much the broken ones matter:
//   score = 10 * kept / (kept + lost)
//   kept  = claims the code honours (VERIFIED, or a finding the independent reviewer rejected or downgraded)
//   lost  = confirmed findings, weighted by severity: low 1, medium 3, high 6
//
// Disclosure rule: findings are published only as counts by severity, never with details,
// so a public score never reveals an unfixed issue. Details go to the maintainers.

import { readFileSync } from "node:fs";

export const WEIGHTS = { low: 1, medium: 3, high: 6 };
export const MIN_CLAIMS = 5;

export function tier(score) {
  if (score === null) return { id: "insufficient", label: "Not enough promises to score" };
  if (score >= 9) return { id: "trusted", label: "Keeps its word" };
  if (score >= 7) return { id: "solid", label: "Mostly keeps its word" };
  if (score >= 5) return { id: "mixed", label: "Mixed" };
  return { id: "broken", label: "Breaks its promises" };
}

function severityOf(item) {
  const s = (item.review && item.review.severity) || item.severity || "medium";
  return WEIGHTS[s] ? s : "medium";
}

function outcomeOf(item) {
  return item.review ? item.review.outcome : null;
}

export function computeScore(audit, repo) {
  let kept = 0;
  let lost = 0;
  let unverifiable = 0;
  const counts = { low: 0, medium: 0, high: 0 };

  const consider = (item, kind) => {
    const outcome = outcomeOf(item);
    const isFinding = kind === "behavior" || item.verdict === "FALSE" || item.verdict === "PARTIAL";
    if (kind === "claim" && item.verdict === "UNVERIFIABLE") { unverifiable++; return; }
    if (!isFinding || outcome === "reject" || outcome === "downgrade") { if (kind === "claim") kept++; return; }
    if (outcome !== "confirm") return; // unreviewed findings never count either way
    const sev = severityOf(item);
    counts[sev]++;
    lost += WEIGHTS[sev];
  };

  for (const c of audit.claims || []) consider(c, "claim");
  for (const b of audit.behaviors || []) consider(b, "behavior");

  const checked = kept + counts.low + counts.medium + counts.high;
  const score = checked < MIN_CLAIMS ? null : Math.round((100 * kept) / (kept + lost)) / 10;

  return {
    repo,
    commit: audit.commit,
    commit_date: audit.date,
    scored_at: audit.finished_at || new Date().toISOString(),
    elliot_version: audit.elliot,
    score,
    tier: tier(score).id,
    tier_label: tier(score).label,
    promises_checked: checked,
    promises_kept: kept,
    unverifiable,
    findings: counts,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, repo] = process.argv.slice(2);
  if (!file || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo || "")) {
    console.error("usage: node score/compute.mjs <claims.json> <owner/repo>");
    process.exit(2);
  }
  const audit = JSON.parse(readFileSync(file, "utf8"));
  process.stdout.write(JSON.stringify(computeScore(audit, repo), null, 2) + "\n");
}
