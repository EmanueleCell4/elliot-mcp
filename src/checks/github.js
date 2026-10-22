// "PR merged" / "CI is green" / "I pushed the commit" -> what does GitHub actually say?
// Public repos work without a token (60 requests/hour). Set GITHUB_TOKEN for more or for private repos.

import { Verdict } from "../receipt.js";
import { fetchWithTimeout, describeError } from "../http.js";

const API = process.env.ELLIOT_GITHUB_API || "https://api.github.com";

async function gh(pathname) {
  const headers = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetchWithTimeout(API + pathname, { headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body };
}

function inconclusive(target, reason, evidence = {}) {
  return { target, verdict: Verdict.INCONCLUSIVE, reason, evidence };
}

function apiProblem(target, status, body) {
  const msg = body?.message || "";
  let reason = `GitHub answered ${status}`;
  if (status === 401) reason = "GITHUB_TOKEN is invalid or expired";
  else if ((status === 403 || status === 429) && /rate limit/i.test(msg)) reason = "GitHub rate limit reached; set GITHUB_TOKEN to keep checking";
  else if (status === 403) reason = "GitHub refused access (private repo? set GITHUB_TOKEN)";
  return inconclusive(target, reason, { status, message: msg });
}

export async function checkGithub({ repo, check, pr, ref }) {
  const target = `${repo}${pr ? `#${pr}` : ""}${ref ? `@${ref}` : ""}`;
  try {
    if (check === "pr_merged") {
      if (!pr) return inconclusive(target, "pr_merged needs a pr number");
      const { status, body } = await gh(`/repos/${repo}/pulls/${pr}`);
      if (status === 404) return { target, verdict: Verdict.NOT_VERIFIED, reason: `PR #${pr} not found in ${repo}`, evidence: { status } };
      if (status !== 200) return apiProblem(target, status, body);
      const evidence = { state: body.state, merged: body.merged, merged_at: body.merged_at, merge_commit_sha: body.merge_commit_sha, html_url: body.html_url };
      return body.merged
        ? { target, verdict: Verdict.VERIFIED, reason: `PR #${pr} was merged at ${body.merged_at}`, evidence }
        : { target, verdict: Verdict.NOT_VERIFIED, reason: `PR #${pr} is ${body.state} and not merged`, evidence };
    }

    if (check === "commit_exists") {
      if (!ref) return inconclusive(target, "commit_exists needs a ref (sha or branch)");
      const { status, body } = await gh(`/repos/${repo}/commits/${encodeURIComponent(ref)}`);
      if (status === 404 || status === 422) return { target, verdict: Verdict.NOT_VERIFIED, reason: `${ref} does not exist on GitHub in ${repo} (not pushed?)`, evidence: { status } };
      if (status !== 200) return apiProblem(target, status, body);
      return { target, verdict: Verdict.VERIFIED, reason: `${ref} exists on GitHub as ${body.sha.slice(0, 12)}`, evidence: { sha: body.sha, date: body.commit?.committer?.date, message: body.commit?.message?.split("\n")[0], html_url: body.html_url } };
    }

    if (check === "checks_passing") {
      let sha = ref;
      if (pr) {
        const p = await gh(`/repos/${repo}/pulls/${pr}`);
        if (p.status !== 200) return apiProblem(target, p.status, p.body);
        sha = p.body.head.sha;
      }
      if (!sha) return inconclusive(target, "checks_passing needs a pr or a ref");
      const runs = await gh(`/repos/${repo}/commits/${encodeURIComponent(sha)}/check-runs?per_page=100`);
      const combined = await gh(`/repos/${repo}/commits/${encodeURIComponent(sha)}/status`);
      if (runs.status !== 200) return apiProblem(target, runs.status, runs.body);

      const list = runs.body.check_runs || [];
      const pending = list.filter((r) => r.status !== "completed").map((r) => r.name);
      const failed = list.filter((r) => r.status === "completed" && !["success", "neutral", "skipped"].includes(r.conclusion)).map((r) => `${r.name}: ${r.conclusion}`);
      const statusState = combined.status === 200 ? combined.body.state : null;
      const statusCount = combined.status === 200 ? combined.body.total_count : 0;
      const evidence = { sha, check_runs: list.length, pending, failed, commit_status: statusState, commit_status_count: statusCount };

      if (list.length === 0 && statusCount === 0) return { target, verdict: Verdict.NOT_VERIFIED, reason: "no CI checks ran on this commit, so 'CI is green' is not true", evidence };
      if (failed.length || statusState === "failure" || statusState === "error") return { target, verdict: Verdict.NOT_VERIFIED, reason: `failing: ${failed.join(", ") || `commit status ${statusState}`}`, evidence };
      if (pending.length || (statusCount > 0 && statusState === "pending")) return { target, verdict: Verdict.INCONCLUSIVE, reason: `still running: ${pending.join(", ") || "commit status pending"}`, evidence };
      return { target, verdict: Verdict.VERIFIED, reason: `all ${list.length + statusCount} checks passed on ${sha.slice(0, 12)}`, evidence };
    }

    return inconclusive(target, `unknown check "${check}"`);
  } catch (err) {
    return inconclusive(target, `GitHub not reachable: ${describeError(err)}`, { error: describeError(err) });
  }
}
