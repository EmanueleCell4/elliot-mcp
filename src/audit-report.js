// Renders a finished claim audit as report.md and a self-contained report.html.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ORDER = { FALSE: 0, PARTIAL: 1, UNVERIFIABLE: 2, VERIFIED: 3 };
const SEV = { high: 0, medium: 1, low: 2 };

function sorted(claims) {
  return [...claims].sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || (SEV[a.severity] ?? 3) - (SEV[b.severity] ?? 3) || Number(a.n) - Number(b.n));
}

const loc = (s) => `${s.file}:${s.line_start}${s.line_end && s.line_end !== s.line_start ? "-" + s.line_end : ""}`;
const evLabel = (e) => (e.type === "absent" ? `searched the code for \`${e.pattern}\`: not found outside docs` : loc(e));

function headline(t) {
  if (!t.claims) return "No claims recorded";
  const broken = t.FALSE + t.PARTIAL;
  if (!broken) return `All ${t.claims} claims checked hold up in the code`;
  return `${broken} of ${t.claims} claims don't fully hold up in the code`;
}

export function renderMarkdown(a) {
  const t = a.totals;
  const lines = [
    `# Elliot claim audit: ${a.project}`,
    "",
    `**${headline(t)}.**`,
    "",
    `Commit \`${a.commit ? a.commit.slice(0, 12) : "uncommitted"}\`${a.dirty ? " (working tree had uncommitted changes)" : ""} · ${a.finished_at.slice(0, 10)} · Elliot ${a.elliot}`,
    "",
    `| Verified | Partial | False | Unverifiable | Undisclosed behaviors | Downgraded by review | Retracted by review | Citations rejected by Elliot |`,
    `|---|---|---|---|---|---|---|---|`,
    `| ${t.VERIFIED} | ${t.PARTIAL} | ${t.FALSE} | ${t.UNVERIFIABLE} | ${t.behaviors} | ${t.downgraded} | ${t.retracted} | ${t.rejected_citations} |`,
    "",
    "Every citation below was checked by Elliot against the file at this commit, and every FALSE, PARTIAL and behavior finding was re-checked by an independent reviewer that had not seen the audit.",
    "",
  ];
  for (const b of a.behaviors || []) {
    lines.push(`## UNDISCLOSED · ${b.severity}: ${b.behavior}`, "", `- User impact: ${b.user_impact}`, `- Docs searched: ${b.docs_searched}`);
    for (const e of b.evidence) lines.push(`- Evidence: \`${loc(e)}\`: \`${String(e.quote).replace(/`/g, "'")}\``);
    if (b.review) lines.push(`- Independent review: ${b.review.outcome}. ${b.review.reason}`);
    lines.push("", `Receipt \`${b.receipt}\``, "");
  }
  for (const c of sorted(a.claims)) {
    lines.push(`## ${c.verdict}${c.severity ? ` · ${c.severity}` : ""}: ${c.claim}`, "");
    lines.push(`- Claimed in \`${loc(c.source)}\`: "${c.source.quote}"`);
    for (const e of c.evidence) lines.push(`- Evidence: ${e.type === "absent" ? evLabel(e) : `\`${loc(e)}\`: \`${String(e.quote).replace(/`/g, "'")}\``}`);
    lines.push("", c.explanation);
    if (c.user_impact) lines.push("", `User impact: ${c.user_impact}`);
    if (c.note) lines.push("", `Note: ${c.note}`);
    if (c.review) lines.push("", `Independent review: ${c.original_verdict ? `downgraded from ${c.original_verdict}` : c.review.outcome}. ${c.review.reason}`);
    lines.push("", `Receipt \`${c.receipt}\``, "");
  }
  if ((a.retracted || []).length) {
    lines.push("## Retracted by the independent review", "");
    for (const r of a.retracted) lines.push(`- ${r.claim || r.behavior}: ${r.review.reason}`);
  }
  return lines.join("\n");
}

export function renderHtml(a) {
  const t = a.totals;
  const seg = (k, cls) => (t[k] ? `<span class="seg ${cls}" style="flex:${t[k]}"></span>` : "");
  const items = sorted(a.claims).map((c) => `
<li class="claim">
  <div class="chips"><span class="verdict ${c.verdict.toLowerCase()}">${c.verdict}</span>${c.severity ? `<span class="sev ${c.severity}">severity ${c.severity}</span>` : ""}</div>
  <div class="body">
    <p class="text">${esc(c.claim)}</p>
    <p class="src">Claimed in <code>${esc(loc(c.source))}</code>: &ldquo;${esc(c.source.quote)}&rdquo;</p>
    <p class="why">${esc(c.explanation)}</p>
    ${c.user_impact ? `<p class="why"><strong>User impact:</strong> ${esc(c.user_impact)}</p>` : ""}
    ${c.note ? `<p class="src">Note: ${esc(c.note)}</p>` : ""}
    ${c.review ? `<p class="src">Independent review: ${esc(c.original_verdict ? `downgraded from ${c.original_verdict}` : c.review.outcome)}. ${esc(c.review.reason)}</p>` : ""}
    <ul class="ev">${c.evidence.map((e) => `<li>${e.type === "absent" ? esc(evLabel(e)) : `<code>${esc(loc(e))}</code> <span class="q">${esc(e.quote)}</span>`}</li>`).join("")}</ul>
    <p class="rc">Receipt <code>${esc(c.receipt)}</code></p>
  </div>
</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Elliot audit: ${esc(a.project)}</title>
<style>
:root{--bg:#F5F6F8;--surface:#FFF;--ink:#151922;--muted:#5A6271;--line:#DCE0E6;--v:#1E7757;--p:#A86300;--f:#BF3328;--u:#8A909C;--f-bg:#FBE5E2;--p-bg:#FBEEDB;--v-bg:#E3F2EC;--u-bg:#ECEEF1;
--sans:"IBM Plex Sans","Segoe UI",Roboto,Helvetica,Arial,sans-serif;--mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0E1116;--surface:#151920;--ink:#E6E9EF;--muted:#9AA1AE;--line:#2A303A;--v:#4FC596;--p:#E8A445;--f:#FF6E61;--u:#7C8391;--f-bg:#331714;--p-bg:#2E2210;--v-bg:#13291F;--u-bg:#1E222A;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--sans)}
main{max-width:960px;margin:0 auto;padding:40px max(16px,env(safe-area-inset-left,0px)) 64px;display:grid;gap:28px}
h1{font-size:clamp(26px,4vw,38px);line-height:1.15;margin:0;text-wrap:balance}
.eyebrow{font:12px var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0}
.meta{color:var(--muted);margin:0;font-size:14px}code{font-family:var(--mono);font-size:.86em;overflow-wrap:anywhere}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.stat{background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:12px 14px}
.stat b{display:block;font-size:28px;font-variant-numeric:tabular-nums}.stat span{font-size:13px;color:var(--muted)}
.stat.v b{color:var(--v)}.stat.p b{color:var(--p)}.stat.f b{color:var(--f)}
.bar{display:flex;gap:2px;height:10px;border-radius:2px;overflow:hidden;background:var(--line)}
.seg.v{background:var(--v)}.seg.p{background:var(--p)}.seg.f{background:var(--f)}.seg.u{background:var(--u)}
ol{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:6px}
.claim{display:grid;grid-template-columns:120px 1fr;gap:12px;padding:16px 18px;border-top:1px solid var(--line)}.claim:first-child{border-top:0}
.chips{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.verdict{font:500 11px var(--mono);letter-spacing:.08em;padding:3px 7px;border-radius:3px;border:1px solid currentColor}
.verdict.false{color:var(--f);background:var(--f-bg)}.verdict.partial{color:var(--p);background:var(--p-bg)}.verdict.verified{color:var(--v);background:var(--v-bg)}.verdict.unverifiable{color:var(--u);background:var(--u-bg)}
.sev{font:11px var(--mono);color:var(--muted)}.sev.high{color:var(--f)}
.body{min-width:0;display:grid;gap:4px}.body p{margin:0}.text{font-weight:600}.src,.rc{font-size:13px;color:var(--muted)}
.ev{margin:4px 0 0;padding-left:18px;font-size:13px;display:grid;gap:3px}.q{color:var(--muted);font-family:var(--mono);font-size:12px;overflow-wrap:anywhere}
footer{font-size:13px;color:var(--muted)}
@media (max-width:560px){.claim{grid-template-columns:1fr}.chips{flex-direction:row;align-items:center}}
</style></head><body><main>
<header style="display:grid;gap:10px">
<p class="eyebrow">Elliot claim audit &middot; ${esc(a.finished_at.slice(0, 10))}</p>
<h1>${esc(a.project)}: ${esc(headline(t))}</h1>
<p class="meta">Commit <code>${esc(a.commit ? a.commit.slice(0, 12) : "uncommitted")}</code>${a.dirty ? " (uncommitted changes present)" : ""}${a.remote ? ` &middot; ${esc(a.remote)}` : ""} &middot; Elliot ${esc(a.elliot)}</p>
</header>
<div class="stats">
<div class="stat"><b>${t.claims}</b><span>claims checked</span></div>
<div class="stat v"><b>${t.VERIFIED}</b><span>verified</span></div>
<div class="stat p"><b>${t.PARTIAL}</b><span>partial</span></div>
<div class="stat f"><b>${t.FALSE}</b><span>false</span></div>
<div class="stat f"><b>${t.behaviors}</b><span>undisclosed behaviors</span></div>
<div class="stat"><b>${t.downgraded + t.retracted}</b><span>findings the reviewer downgraded or retracted</span></div>
<div class="stat"><b>${t.rejected_citations}</b><span>citations Elliot rejected</span></div>
</div>
<div class="bar" role="img" aria-label="${t.VERIFIED} verified, ${t.PARTIAL} partial, ${t.FALSE} false, ${t.UNVERIFIABLE} unverifiable">${seg("VERIFIED", "v")}${seg("PARTIAL", "p")}${seg("FALSE", "f")}${seg("UNVERIFIABLE", "u")}</div>
${(a.behaviors || []).length ? `<h2 style="margin:0;font-size:20px">Undisclosed behavior</h2><ol>${a.behaviors.map((b) => `<li class="claim"><div class="chips"><span class="verdict false">UNDISCLOSED</span><span class="sev ${b.severity}">severity ${b.severity}</span></div><div class="body"><p class="text">${esc(b.behavior)}</p><p class="why"><strong>User impact:</strong> ${esc(b.user_impact)}</p><p class="src">Docs searched: ${esc(b.docs_searched)}</p><ul class="ev">${b.evidence.map((e) => `<li><code>${esc(loc(e))}</code> <span class="q">${esc(e.quote)}</span></li>`).join("")}</ul>${b.review ? `<p class="src">Independent review: ${esc(b.review.outcome)}. ${esc(b.review.reason)}</p>` : ""}<p class="rc">Receipt <code>${esc(b.receipt)}</code></p></div></li>`).join("")}</ol><h2 style="margin:0;font-size:20px">Claims</h2>` : ""}
<ol>${items || '<li class="claim"><div></div><div class="body"><p>No claims were recorded.</p></div></li>'}</ol>
<footer>Every quote above was matched by Elliot against the file at this commit, and every &ldquo;not found&rdquo; was searched by Elliot itself. Findings are a static reading of the code, not a run of the software.</footer>
</main></body></html>`;
}
