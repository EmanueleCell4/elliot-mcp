#!/usr/bin/env node
// Samples merged, agent-authored pull requests from maintained public repositories.
//
// Usage: GITHUB_TOKEN=... node collect.mjs [--out data/sample.json]
//
// Sampling rule, fixed before any result was seen:
//   1. Take public repositories with at least MIN_STARS stars that were pushed to
//      in the window, ordered by stars, up to REPO_LIMIT of them.
//   2. In each, find merged pull requests in the window whose author or body
//      carries one of the agent signatures below.
//   3. Keep a pull request only if its body is long enough to contain checkable
//      claims (MIN_BODY characters) and it changed at most MAX_FILES files.
//   4. Keep at most PER_REPO per repository, so one busy repository cannot
//      dominate the sample.
//
// It writes every candidate it saw and why each was dropped, so the sample can be
// audited and reproduced. It records no personal data beyond the public login of
// the pull request author, which is part of the public record.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error("GITHUB_TOKEN is required (a read-only token is enough)."); process.exit(64); }

const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "benchmark/agent-pr-claims/data/sample.json";
const SINCE = process.env.BM_SINCE || "2026-09-01";
const UNTIL = process.env.BM_UNTIL || "2026-10-28";
const MIN_STARS = Number(process.env.BM_MIN_STARS || 300);
const REPO_LIMIT = Number(process.env.BM_REPO_LIMIT || 300);
const PER_REPO = Number(process.env.BM_PER_REPO || 2);
const MIN_BODY = Number(process.env.BM_MIN_BODY || 200);
const MAX_FILES = Number(process.env.BM_MAX_FILES || 40);
const TARGET = Number(process.env.BM_TARGET || 60);

// Markers that identify a pull request written by a coding agent. Author markers are
// GitHub App accounts; body markers are the trailers those tools add by default.
const AGENT_AUTHORS = ["devin-ai-integration[bot]", "copilot-swe-agent[bot]", "cursor[bot]", "codex[bot]", "claude[bot]"];
const BODY_MARKERS = [
  { re: /Generated with \[?Claude Code/i, agent: "claude-code" },
  { re: /Co-Authored-By:\s*Claude/i, agent: "claude-code" },
  { re: /generated with codex/i, agent: "codex" },
  { re: /\bDevin\b.*\bsession\b|devin\.ai\/sessions/i, agent: "devin" },
  { re: /Generated with \[?Cursor/i, agent: "cursor" },
];

const api = async (path, params = {}) => {
  const url = new URL(path.startsWith("http") ? path : `https://api.github.com${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${TOKEN}`, "User-Agent": "elliot-benchmark" } });
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset") || 0) * 1000;
      const wait = Math.max(2000, Math.min(reset - Date.now() + 1000, 70000));
      if (attempt > 6) throw new Error(`rate limited on ${url.pathname}`);
      process.stderr.write(`rate limited, waiting ${Math.round(wait / 1000)}s\n`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url.pathname}${url.search}`);
    return res.json();
  }
};

function agentOf(pr) {
  const login = pr.user?.login || "";
  if (AGENT_AUTHORS.includes(login)) return login.replace(/\[bot\]$/, "");
  for (const m of BODY_MARKERS) if (m.re.test(pr.body || "")) return m.agent;
  return null;
}

async function popularRepos() {
  const repos = [];
  for (let page = 1; repos.length < REPO_LIMIT && page <= 10; page++) {
    const j = await api("/search/repositories", { q: `stars:>=${MIN_STARS} pushed:>=${SINCE} is:public archived:false`, sort: "stars", order: "desc", per_page: 100, page });
    for (const r of j.items || []) repos.push({ repo: r.full_name, stars: r.stargazers_count, language: r.language });
    if (!j.items || j.items.length < 100) break;
  }
  return repos.slice(0, REPO_LIMIT);
}

async function agentPrsIn(repo) {
  // One search per repository keeps the query inside GitHub's length and operator limits.
  const j = await api("/search/issues", { q: `repo:${repo} is:pr is:merged created:${SINCE}..${UNTIL}`, sort: "created", order: "desc", per_page: 100 });
  return j.items || [];
}

const sample = [];
const dropped = [];
const repos = await popularRepos();
process.stderr.write(`scanning ${repos.length} repositories with >= ${MIN_STARS} stars\n`);

for (const { repo, stars, language } of repos) {
  if (sample.length >= TARGET) break;
  let items;
  try { items = await agentPrsIn(repo); } catch (e) { dropped.push({ repo, reason: `search failed: ${e.message}` }); continue; }
  let kept = 0;
  for (const it of items) {
    if (kept >= PER_REPO || sample.length >= TARGET) break;
    const agent = agentOf(it);
    if (!agent) continue;
    if ((it.body || "").length < MIN_BODY) { dropped.push({ pr: it.html_url, reason: "body too short to contain checkable claims" }); continue; }
    let pr;
    try { pr = await api(`/repos/${repo}/pulls/${it.number}`); } catch (e) { dropped.push({ pr: it.html_url, reason: `fetch failed: ${e.message}` }); continue; }
    if (!pr.merged_at) { dropped.push({ pr: it.html_url, reason: "not merged" }); continue; }
    if (pr.changed_files > MAX_FILES) { dropped.push({ pr: it.html_url, reason: `touches ${pr.changed_files} files (limit ${MAX_FILES})` }); continue; }
    sample.push({
      url: it.html_url, repo, stars, language, number: it.number, agent,
      author: it.user?.login || null, title: it.title, body: it.body,
      merged_at: pr.merged_at, merge_commit_sha: pr.merge_commit_sha, base_sha: pr.base?.sha,
      head_sha: pr.head?.sha, changed_files: pr.changed_files, additions: pr.additions, deletions: pr.deletions,
    });
    kept++;
    process.stderr.write(`+ ${it.html_url} (${agent}, ${stars}*)\n`);
  }
}

const out = {
  collected_at: new Date().toISOString(),
  rule: { since: SINCE, until: UNTIL, min_stars: MIN_STARS, repo_limit: REPO_LIMIT, per_repo: PER_REPO, min_body: MIN_BODY, max_files: MAX_FILES, target: TARGET },
  agent_markers: { authors: AGENT_AUTHORS, body: BODY_MARKERS.map((m) => ({ pattern: String(m.re), agent: m.agent })) },
  repositories_scanned: repos.length,
  sample_size: sample.length,
  by_agent: sample.reduce((a, s) => ({ ...a, [s.agent]: (a[s.agent] || 0) + 1 }), {}),
  sample,
  dropped,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
process.stderr.write(`\n${sample.length} pull requests from ${new Set(sample.map((s) => s.repo)).size} repositories -> ${OUT}\n`);
