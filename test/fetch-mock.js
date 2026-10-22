// Hermetic network responses for the MCP end-to-end suite.
const site = process.env.ELLIOT_TEST_SITE_URL;
const github = process.env.ELLIOT_GITHUB_API;
const registry = process.env.ELLIOT_NPM_REGISTRY;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.origin === site) {
    if (url.pathname === "/") return new Response("<h1>Elliot checks.</h1>", { status: 200, headers: { "content-type": "text/html" } });
    return new Response("nope", { status: 404 });
  }
  if (url.origin === github) {
    const p = url.pathname;
    if (p === "/repos/acme/app/pulls/1") return json({ state: "closed", merged: true, merged_at: "2026-10-20T10:00:00Z", merge_commit_sha: "abc", html_url: "x", head: { sha: "aaa111" } });
    if (p === "/repos/acme/app/pulls/2") return json({ state: "open", merged: false, merged_at: null, head: { sha: "bbb222" } });
    if (p.startsWith("/repos/acme/app/commits/aaa111/check-runs")) return json({ check_runs: [{ name: "test", status: "completed", conclusion: "success" }] });
    if (p.startsWith("/repos/acme/app/commits/bbb222/check-runs")) return json({ check_runs: [{ name: "test", status: "completed", conclusion: "failure" }, { name: "lint", status: "in_progress", conclusion: null }] });
    if (p.startsWith("/repos/acme/app/commits/ccc333/check-runs")) return json({ check_runs: [] });
    if (p.endsWith("/status")) return json({ state: "pending", total_count: 0 });
    if (p === "/repos/acme/app/commits/main") return json({ sha: "aaa111aaa111", commit: { message: "ship it", committer: { date: "2026-10-20T10:00:00Z" } }, html_url: "x" });
    return json({ message: "Not Found" }, 404);
  }
  if (url.origin === registry) {
    if (url.pathname === "/zod") return json({ "dist-tags": { latest: "4.6.7" }, versions: { "4.6.7": { dist: { tarball: "https://registry.test/zod.tgz" } } }, time: { "4.6.7": "2026-10-20T10:00:00Z" } });
    return json({ error: "Not Found" }, 404);
  }
  if (url.hostname === "127.0.0.1" && url.port === "9") throw new TypeError("fetch failed");
  throw new Error("unexpected test network request: " + url.origin + url.pathname);
};
