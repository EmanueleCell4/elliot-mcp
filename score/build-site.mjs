#!/usr/bin/env node
// Builds the static ELLIOT Score site from score records.
//
// Usage: node score/build-site.mjs <data-dir> <out-dir>
//   <data-dir> holds one <owner>__<repo>.json record per scored repository (from compute.mjs).
//   <out-dir>  receives index.html, leaderboard.html, method.html, r/<owner>/<repo>/index.html
//              and badge/<owner>/<repo>.json (a shields.io endpoint).

import { readFileSync, readdirSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.ELLIOT_SCORE_REPO || "EmanueleCell4/elliot-mcp";
const SITE = process.env.ELLIOT_SCORE_SITE || "https://emanuelecell4.github.io/elliot-mcp";
const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const color = (tier) => ({ trusted: "#2EC6F2", solid: "#7FD48A", mixed: "#F2B544", broken: "#FF6B5B" })[tier] || "#8B9099";
const shield = (tier) => ({ trusted: "2EC6F2", solid: "4c1", mixed: "dfb317", broken: "e05d44" })[tier] || "9f9f9f";
const fmt = (s) => (s === null ? "–" : Number.isInteger(s) ? `${s}.0` : String(s));
const day = (iso) => (iso ? String(iso).slice(0, 10) : "");

const CSS = `
:root{--bg:#000;--card:#0D1016;--line:#23272F;--ink:#F4F4F6;--dim:#8B9099;--cyan:#2EC6F2;--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
a{color:var(--cyan);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
header{display:flex;align-items:center;justify-content:space-between;padding:22px 0}
.brand{font-weight:800;letter-spacing:.18em;color:var(--ink);font-size:20px}
nav a{color:var(--dim);margin-left:22px;font-size:15px}
.label{font-family:var(--mono);font-size:13px;letter-spacing:.12em;color:var(--cyan);text-transform:uppercase}
h1{font-size:clamp(40px,7vw,76px);line-height:1.02;margin:14px 0 18px;letter-spacing:-.02em}
h2{font-size:28px;margin:56px 0 16px}
.lead{color:var(--dim);font-size:20px;max-width:640px}
.hero{display:grid;grid-template-columns:1.4fr 1fr;gap:28px;align-items:center;padding:28px 0 8px}
.hero img{width:100%;max-width:360px;justify-self:end;-webkit-mask-image:radial-gradient(circle at 50% 45%,#000 58%,transparent 72%);mask-image:radial-gradient(circle at 50% 45%,#000 58%,transparent 72%)}
form.get{display:flex;gap:10px;margin:28px 0 8px;max-width:640px}
form.get input{flex:1;min-width:0;background:var(--card);border:1px solid var(--line);color:var(--ink);border-radius:12px;padding:15px 16px;font:16px var(--mono)}
form.get button,.btn{background:var(--cyan);color:#001018;border:0;border-radius:12px;padding:15px 20px;font-weight:700;font-size:16px;cursor:pointer;white-space:nowrap}
.hint{color:var(--dim);font-size:14px;min-height:20px}
table{width:100%;border-collapse:collapse;margin-top:8px}
th,td{text-align:left;padding:13px 10px;border-bottom:1px solid var(--line)}
th{font-family:var(--mono);font-size:12px;letter-spacing:.1em;color:var(--dim);font-weight:400;text-transform:uppercase}
td.n{font-family:var(--mono);color:var(--dim);width:44px}
td.s{font-weight:800;font-size:20px;width:90px}
.pill{display:inline-block;font-family:var(--mono);font-size:12px;padding:3px 9px;border-radius:99px;border:1px solid currentColor}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px}
.card b{display:block;font-size:30px}
.card span{color:var(--dim);font-size:14px}
.big{font-size:clamp(96px,18vw,180px);font-weight:800;line-height:1;letter-spacing:-.04em}
.big small{font-size:.3em;color:var(--dim);font-weight:600}
pre{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;overflow:auto;font:13px/1.5 var(--mono);color:var(--ink);white-space:pre-wrap;word-break:break-all}
.row{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
footer{color:var(--dim);font-size:14px;padding:56px 0 40px;border-top:1px solid var(--line);margin-top:64px}
.empty{color:var(--dim);padding:22px 0}
@media (max-width:720px){.hero{grid-template-columns:1fr}.hero img{display:none}.cards{grid-template-columns:1fr}form.get{flex-direction:column}nav a{margin-left:14px}td.n{display:none}}
`;

function page({ title, desc, path, body, ogImage }) {
  const depth = path.split("/").filter(Boolean).length - 1;
  const up = depth > 0 ? "../".repeat(depth) : "./";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(ogImage || SITE + "/assets/og.png")}"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${up}assets/elliot.png"><style>${CSS}</style></head><body><div class="wrap">
<header><a class="brand" href="${up}index.html">ELLIOT</a><nav><a href="${up}leaderboard.html">Leaderboard</a><a href="${up}method.html">Method</a><a href="https://github.com/${REPO}">GitHub</a></nav></header>
${body}
<footer>ELLIOT checks whether software keeps the promises in its own docs. Every score is traced to the exact file and line, challenged by an independent reviewer, and re-checked when the code changes. <a href="${up}method.html">How scores work</a>.</footer>
</div></body></html>`;
}

function rows(records, up, limit) {
  const list = limit ? records.slice(0, limit) : records;
  if (!list.length) return `<p class="empty">No repositories scored yet. Be the first.</p>`;
  return `<table><thead><tr><th>#</th><th>Repository</th><th>Score</th><th>Verdict</th><th>Promises kept</th></tr></thead><tbody>${list
    .map((r, i) => `<tr><td class="n">${i + 1}</td><td><a href="${up}r/${esc(r.repo)}/index.html">${esc(r.repo)}</a></td><td class="s" style="color:${color(r.tier)}">${fmt(r.score)}</td><td><span class="pill" style="color:${color(r.tier)}">${esc(r.tier_label)}</span></td><td>${r.promises_kept}/${r.promises_checked}</td></tr>`)
    .join("")}</tbody></table>`;
}

function homePage(records) {
  const body = `
<section class="hero"><div>
<div class="label">The ELLIOT Score</div>
<h1>Does your software keep its word?</h1>
<p class="lead">Docs promise "secure", "private", "sandboxed". ELLIOT checks every promise against the code, line by line, and gives it a score.</p>
<form class="get" id="get"><input id="url" placeholder="github.com/owner/repo" autocomplete="off" spellcheck="false" aria-label="GitHub repository"><button type="submit">Get the score</button></form>
<div class="hint" id="hint">Public GitHub repositories. Free. Scores are re-checked when the code changes.</div>
</div><img src="assets/elliot.png" alt="ELLIOT, a white robot with glowing cyan eyes and arms crossed"></section>
<h2>Top scores</h2>${rows(records, "./", 10)}
<p><a href="leaderboard.html">Full leaderboard →</a></p>
<h2>How it works</h2>
<div class="cards"><div class="card"><div class="label">01 Read</div><p>Every checkable promise in the README and docs: defaults, limits, telemetry, permissions, sandboxes.</p></div>
<div class="card"><div class="label">02 Prove</div><p>Each promise traced into the code. A quote that isn't really at that file and line is thrown out.</p></div>
<div class="card"><div class="label">03 Challenge</div><p>A second, independent reviewer tries to disprove every finding. Only what survives counts.</p></div></div>
<script>
const known=${JSON.stringify(records.map((r) => r.repo.toLowerCase()))};
document.getElementById("get").addEventListener("submit",e=>{e.preventDefault();
const m=document.getElementById("url").value.trim().replace(/\\.git$/,"").match(/^(?:https?:\\/\\/)?(?:www\\.)?github\\.com\\/([A-Za-z0-9-]+)\\/([A-Za-z0-9._-]+)\\/?$|^([A-Za-z0-9-]+)\\/([A-Za-z0-9._-]+)$/);
const hint=document.getElementById("hint");
if(!m){hint.textContent="Paste a GitHub repository, like github.com/owner/repo.";return}
const repo=(m[1]||m[3])+"/"+(m[2]||m[4]);
if(known.includes(repo.toLowerCase())){location.href="r/"+repo+"/index.html";return}
const u=new URL("https://github.com/${REPO}/issues/new");u.searchParams.set("template","score.yml");u.searchParams.set("title","Score: "+repo);u.searchParams.set("repo","https://github.com/"+repo);
hint.textContent="Opening the request on GitHub. Your score appears here in about 10 minutes.";window.open(u.toString(),"_blank","noopener")});
</script>`;
  return page({ title: "ELLIOT Score: does your software keep its word?", desc: "ELLIOT checks every promise in a project's docs against its code and gives it a score.", path: "index.html", body });
}

function boardPage(records) {
  const body = `<div class="label">Leaderboard</div><h1>Who keeps their word</h1><p class="lead">Every scored repository, highest first. Updated every time a score is re-checked.</p>${rows(records, "./")}`;
  return page({ title: "ELLIOT Leaderboard", desc: "Open-source projects ranked by how many of their documented promises hold up in their code.", path: "leaderboard.html", body });
}

function repoPage(r) {
  const [owner, name] = r.repo.split("/");
  const badgeUrl = `https://img.shields.io/endpoint?url=${encodeURIComponent(`${SITE}/badge/${r.repo}.json`)}`;
  const pageUrl = `${SITE}/r/${r.repo}/`;
  const md = `[![ELLIOT score](${badgeUrl})](${pageUrl})`;
  const f = r.findings;
  const broken = f.low + f.medium + f.high;
  const share = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${r.repo} scored ${fmt(r.score)}/10 on ELLIOT: ${r.promises_kept} of ${r.promises_checked} documented promises hold up in the code.`)}&url=${encodeURIComponent(pageUrl)}`;
  const body = `<div class="label">ELLIOT Score · <a href="https://github.com/${esc(r.repo)}">github.com/${esc(r.repo)}</a></div>
<h1 style="margin-bottom:6px">${esc(name)} <span style="color:var(--dim);font-weight:600">by ${esc(owner)}</span></h1>
<div class="big" style="color:${color(r.tier)}">${fmt(r.score)}<small>/10</small></div>
<p><span class="pill" style="color:${color(r.tier)}">${esc(r.tier_label)}</span></p>
<div class="cards" style="margin-top:28px">
<div class="card"><b>${r.promises_kept}/${r.promises_checked}</b><span>documented promises that hold up in the code</span></div>
<div class="card"><b>${broken}</b><span>broken promises confirmed by an independent reviewer (${f.high} high · ${f.medium} medium · ${f.low} low)</span></div>
<div class="card"><b>${esc(String(r.commit).slice(0, 7))}</b><span>commit checked, ${esc(day(r.scored_at))}</span></div></div>
<p class="lead" style="margin-top:22px">${broken ? "Details of broken promises are shared with the maintainers first and never published while unfixed. When they're fixed, the score is re-checked." : "Every promise ELLIOT could check holds up in the code."}</p>
<h2>Show your score</h2><p><img src="${esc(badgeUrl)}" alt="ELLIOT score badge"></p><pre>${esc(md)}</pre>
<div class="row"><a class="btn" href="${esc(share)}" target="_blank" rel="noopener">Share on X</a><a class="btn ghost" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener">Share on LinkedIn</a><a class="btn ghost" href="https://github.com/${REPO}/issues/new?template=score.yml&title=${encodeURIComponent("Score: " + r.repo)}&repo=${encodeURIComponent("https://github.com/" + r.repo)}" target="_blank" rel="noopener">Request a re-check</a></div>
<p class="hint">Maintainer? Fixed something, or think a finding is wrong? Request a re-check, or write to the contact in <a href="https://github.com/${REPO}/blob/main/SECURITY.md">SECURITY.md</a> for the full report.</p>`;
  return page({ title: `${r.repo}: ELLIOT score ${fmt(r.score)}/10`, desc: `${r.promises_kept} of ${r.promises_checked} documented promises hold up in the code.`, path: `r/${r.repo}/index.html`, body });
}

function methodPage() {
  const body = `<div class="label">Method</div><h1>How the score works</h1>
<p class="lead">The ELLIOT Score answers one question: of the promises a project makes in its own docs, how many does its code keep?</p>
<h2>What counts as a promise</h2><p>Anything a user would rely on and the code can confirm: defaults, limits, flags, supported platforms, telemetry and privacy statements, permissions, sandboxes, how secrets are stored. Marketing adjectives don't count; "binds to localhost by default" does.</p>
<h2>How each promise is checked</h2><p>ELLIOT traces each promise into the code at a specific commit. Every citation is checked against the file and line it quotes; anything that isn't really there is rejected. A second, independent reviewer that never saw the audit then tries to disprove every finding, using only the checked evidence. A finding counts only if it survives.</p>
<h2>The formula</h2><pre>score = 10 × kept / (kept + lost)
kept = promises that hold up (including findings the reviewer rejected or judged immaterial)
lost = confirmed broken promises, weighted by severity: low 1 · medium 3 · high 6</pre>
<p>Projects with fewer than 5 checkable promises are not scored.</p>
<h2>What we publish</h2><p>Scores and counts are public. Details of broken promises are not: they go to the maintainers first, and are never published while unfixed. A score can't be bought: paid plans buy speed and private repositories, never a better number.</p>
<h2>Disputes</h2><p>Think a finding is wrong? Request a re-check from the project's page. Scores are re-computed on the new commit, and a reviewer re-reads every disputed finding.</p>`;
  return page({ title: "How the ELLIOT Score works", desc: "The method behind the ELLIOT Score: promises traced into code, challenged by an independent reviewer.", path: "method.html", body });
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

export function build(dataDir, outDir) {
  const records = (existsSync(dataDir) ? readdirSync(dataDir) : [])
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dataDir, f), "utf8")))
    .filter((r) => REPO_RE.test(r.repo || "") && r.score !== undefined)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.promises_checked - a.promises_checked || a.repo.localeCompare(b.repo));

  write(join(outDir, "index.html"), homePage(records));
  write(join(outDir, "leaderboard.html"), boardPage(records));
  write(join(outDir, "method.html"), methodPage());
  write(join(outDir, ".nojekyll"), "");
  for (const r of records) {
    write(join(outDir, "r", r.repo, "index.html"), repoPage(r));
    write(join(outDir, "badge", `${r.repo}.json`), JSON.stringify({ schemaVersion: 1, label: "ELLIOT score", message: r.score === null ? "n/a" : `${fmt(r.score)}/10`, color: shield(r.tier) }));
  }
  write(join(outDir, "scores.json"), JSON.stringify(records.map(({ repo, score, tier, promises_kept, promises_checked, commit, scored_at }) => ({ repo, score, tier, promises_kept, promises_checked, commit, scored_at }))));
  const assets = join(outDir, "assets");
  mkdirSync(assets, { recursive: true });
  copyFileSync(join(HERE, "..", "docs", "assets", "logo-400.png"), join(assets, "elliot.png"));
  copyFileSync(join(HERE, "..", "docs", "assets", "social-preview.png"), join(assets, "og.png"));
  return records.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dataDir, outDir] = process.argv.slice(2);
  if (!dataDir || !outDir) { console.error("usage: node score/build-site.mjs <data-dir> <out-dir>"); process.exit(2); }
  console.log(`built ${build(dataDir, outDir)} score pages into ${outDir}`);
}
