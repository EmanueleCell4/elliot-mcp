// Turns a focused audit (claims.json) into the pull request comment.
import { readFileSync, writeFileSync } from "node:fs";

const [, , reportPath, outPath] = process.argv;
const a = JSON.parse(readFileSync(reportPath, "utf8"));
const t = a.totals;
const server = process.env.GITHUB_SERVER_URL || "https://github.com";
const repo = process.env.GITHUB_REPOSITORY || "";
const sha = a.commit || "HEAD";
const link = (e) => (e.type === "absent"
  ? `searched for \`${e.pattern}\`: not found`
  : `[\`${e.file}:${e.line_start}\`](${server}/${repo}/blob/${sha}/${e.file}#L${e.line_start}${e.line_end && e.line_end !== e.line_start ? "-L" + e.line_end : ""})`);
const icon = { VERIFIED: "✅", PARTIAL: "🟡", FALSE: "❌", UNVERIFIABLE: "⚪" };
const order = { FALSE: 0, PARTIAL: 1, UNVERIFIABLE: 2, VERIFIED: 3 };
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

const broken = t.FALSE + t.PARTIAL;
const verdict = !t.claims ? "skipped" : broken ? "findings" : "pass";
const head = !t.claims
  ? "Elliot found no checkable claims in this description."
  : broken
    ? `**${broken} of ${t.claims} claims in this description don't fully hold up in the code.**`
    : `**All ${t.claims} claims in this description hold up in the code.**`;

const rows = [...a.claims].sort((x, y) => order[x.verdict] - order[y.verdict]).map((c) =>
  `| ${icon[c.verdict]} ${c.verdict} | ${esc(c.claim)} | ${c.evidence.slice(0, 2).map(link).join("<br>") || "—"} | ${esc(c.verdict === "VERIFIED" ? "" : c.explanation)} |`);

const body = [
  "<!-- elliot-pr-check -->",
  `### Elliot: PR claim check`,
  "",
  head,
  "",
  ...(rows.length ? ["| Verdict | Claim | Proof | Why |", "|---|---|---|---|", ...rows, ""] : []),
  `<sub>Every quote was matched against the file at \`${String(sha).slice(0, 7)}\`, and every "not found" was searched by Elliot itself. Checked by [Elliot](https://github.com/EmanueleCell4/elliot-mcp).</sub>`,
].join("\n");

writeFileSync(outPath, body);
writeFileSync(outPath.replace(/comment\.md$/, "comment.verdict"), verdict);
