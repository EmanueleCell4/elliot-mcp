// Claim audit: does the project do what it says it does?
//
// The host agent (Claude Code, Codex, Cursor...) does the reading: it extracts
// claims from the docs and traces them into the code. Elliot never trusts that
// reading. Every citation the agent gives (claim source and evidence) is checked
// deterministically against the files at the pinned commit, and every
// "this is not in the code" is re-run by Elliot itself with git grep.
// A verdict whose evidence does not check out is rejected, not recorded.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { VERSION, makeReceipt, saveReceipt, elliotDir } from "./receipt.js";
import { renderMarkdown, renderHtml, badge } from "./audit-report.js";
import { docCandidates, codeSignals, coverage } from "./risk.js";

const run = promisify(execFile);

export const AUDIT_VERDICTS = ["VERIFIED", "PARTIAL", "FALSE", "UNVERIFIABLE"];
export const SEVERITIES = ["low", "medium", "high"];
const DOC_EXT = /\.(md|mdx|markdown|rst|txt|adoc)$/i;
const SKIP_DOCS = /(^|\/)(CHANGELOG|CHANGES|HISTORY|CONTRIBUTING|CODE_OF_CONDUCT|LICENSE|LICENCE|NOTICE|SECURITY_POLICY|AGENTS|CLAUDE|GEMINI)(\.[a-z]+)?$/i;
const CLAIM_PAGE = /(^|\/)(security|privacy|pricing|trust|compliance|features?|about)(\/page)?\.(tsx|jsx|ts|js|html|vue|svelte|astro|md|mdx)$/i;
const MAX_SOURCES = 80;
const MIN_QUOTE = 8;
const LINE_SLACK = 2;

async function git(cwd, args) {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

async function resolveRoot(dir) {
  try {
    return { root: (await git(dir, ["rev-parse", "--show-toplevel"])).trim(), isGit: true };
  } catch {
    return { root: path.resolve(dir), isGit: false };
  }
}

async function headInfo(root) {
  try {
    const commit = (await git(root, ["rev-parse", "HEAD"])).trim();
    const date = (await git(root, ["log", "-1", "--format=%cI"])).trim();
    const dirty = (await git(root, ["status", "--porcelain", "--untracked-files=no"])).trim().length > 0;
    let remote = null;
    try { remote = (await git(root, ["remote", "get-url", "origin"])).trim(); } catch { /* no remote */ }
    return { commit, date, dirty, remote };
  } catch {
    return { commit: null, date: null, dirty: true, remote: null };
  }
}

async function listFiles(root, isGit) {
  if (!isGit) throw new Error("claim audits need a git repository (Elliot pins every finding to a commit)");
  const out = await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return [...new Set(out.split("\0").filter(Boolean))].filter((f) => !f.startsWith(".elliot/") && !f.startsWith("elliot-report/"));
}

function isClaimSource(f) {
  if (/(^|\/)(node_modules|vendor|dist|build|\.next|target)\//.test(f)) return false;
  if (/(^|\/)(test|tests|__tests__|fixtures|examples?)\//i.test(f)) return false;
  if (DOC_EXT.test(f)) return !SKIP_DOCS.test(f);
  return CLAIM_PAGE.test(f);
}

function rank(f) {
  if (/^readme/i.test(path.basename(f)) && !f.includes("/")) return 0;
  if (CLAIM_PAGE.test(f)) return 1;
  if (/(^|\/)docs?\//i.test(f)) return 2;
  if (/^readme/i.test(path.basename(f))) return 3;
  return 4;
}

const auditFile = (id) => path.join(elliotDir(), "audits", `${id}.json`);

async function loadAudit(id) {
  if (!/^aud_[0-9a-f]{12}$/.test(id)) throw new Error(`unknown audit id: ${id}`);
  try {
    return JSON.parse(await readFile(auditFile(id), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") throw new Error(`unknown audit id: ${id} (start one with elliot_audit_start)`);
    throw err;
  }
}

async function saveAudit(a) {
  await mkdir(path.dirname(auditFile(a.id)), { recursive: true });
  await writeFile(auditFile(a.id), JSON.stringify(a, null, 2));
}

export async function startAudit({ path: dir, sources: only, sweep = true } = {}) {
  const { root, isGit } = await resolveRoot(dir || process.cwd());
  const head = await headInfo(root);
  const files = await listFiles(root, isGit);
  const focused = Array.isArray(only) && only.length > 0;
  if (focused) {
    const missingFiles = only.filter((f) => !files.includes(f));
    if (missingFiles.length) throw new Error(`source files not found in the repository: ${missingFiles.join(", ")}`);
  }
  const sources = focused ? only : files.filter(isClaimSource).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, MAX_SOURCES);
  const doSweep = sweep && !focused;
  const withLines = [];
  for (const f of sources) {
    try {
      const text = await readFile(path.join(root, f), "utf8");
      withLines.push({ file: f, lines: text.split("\n").length });
    } catch { /* unreadable, skip */ }
  }
  const audit = {
    elliot: VERSION,
    id: "aud_" + randomBytes(6).toString("hex"),
    root,
    project: path.basename(root),
    ...head,
    started_at: new Date().toISOString(),
    sources: withLines,
    focused,
    candidates: doSweep ? await docCandidates(root, withLines) : [],
    signals: doSweep ? await codeSignals(root) : [],
    file_count: files.length,
    claims: [],
    rejected: [],
    finished_at: null,
  };
  await saveAudit(audit);
  return audit;
}

/** Collapse whitespace and markdown/JSX noise so a quote matches however it was wrapped. */
export function normalize(s) {
  return String(s)
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/[`*_>#|]/g, " ")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function insideRoot(root, file) {
  const abs = path.resolve(root, file);
  const rel = path.relative(root, abs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? abs : null;
}

/** Does `quote` really appear in `file` at (about) lines start..end? */
export async function checkQuote(root, { file, line_start, line_end, quote }) {
  const where = `${file}:${line_start}${line_end && line_end !== line_start ? "-" + line_end : ""}`;
  if (!quote || normalize(quote).length < MIN_QUOTE) return { ok: false, where, reason: `quote must be at least ${MIN_QUOTE} characters of the real text` };
  const abs = insideRoot(root, file);
  if (!abs) return { ok: false, where, reason: "path is outside the repository" };
  let text;
  try {
    if (!(await stat(abs)).isFile()) return { ok: false, where, reason: "not a file" };
    text = await readFile(abs, "utf8");
  } catch {
    return { ok: false, where, reason: "file does not exist" };
  }
  const lines = text.split("\n");
  const end = line_end ?? line_start;
  if (line_start < 1 || end < line_start) return { ok: false, where, reason: "invalid line range" };
  if (line_start > lines.length) return { ok: false, where, reason: `file has only ${lines.length} lines` };
  const lo = Math.max(0, line_start - 1 - LINE_SLACK);
  const hi = Math.min(lines.length, end + LINE_SLACK);
  const q = normalize(quote);
  if (normalize(lines.slice(lo, hi).join("\n")).includes(q)) return { ok: true, where };
  const elsewhere = normalize(text).includes(q);
  return { ok: false, where, reason: elsewhere ? "quote is in the file but not at these lines" : "quote does not appear in the file" };
}

/** Elliot runs the search itself: the pattern must not appear outside docs. */
export async function checkAbsent(root, { pattern, regex = false }, claimFiles = new Set()) {
  if (!pattern || pattern.length < 3) return { ok: false, where: `absent:${pattern}`, reason: "pattern must be at least 3 characters" };
  const args = ["grep", "-n", "-I", "--untracked", regex ? "-E" : "-F", "-e", pattern, "--", ".", ":(exclude).elliot", ":(exclude)elliot-report"];
  let out = "";
  try {
    out = (await run("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch (err) {
    if (err.code === 1) out = ""; // git grep exits 1 when nothing matches
    else return { ok: false, where: `absent:${pattern}`, reason: `search failed: ${err.message}` };
  }
  const hits = out.split("\n").filter(Boolean);
  const codeHits = hits.filter((h) => { const f = h.split(":")[0]; return !DOC_EXT.test(f) && !claimFiles.has(f); });
  const where = `absent:${pattern}`;
  if (codeHits.length) return { ok: false, where, reason: `pattern found in code: ${codeHits.slice(0, 3).join(" | ")}`, hits: codeHits.length };
  return { ok: true, where, doc_hits: hits.length };
}

async function checkEvidence(root, ev, claimFiles) {
  return ev.type === "absent" ? checkAbsent(root, ev, claimFiles) : checkQuote(root, ev);
}

// Files that describe how the project is built, not what it promises its users.
const NON_PROMISE = /(^|\/)(CHANGELOG|CHANGES|HISTORY|AGENTS|CLAUDE|GEMINI|CONTRIBUTING)[^/]*$|(^|\/)(\.taskmaster|\.claude|\.cursor|\.github|\.sinapsi|adrs?|rfcs?|internal|design-docs?)\/|(^|\/)[^/]*(prd|rfc|adr|design|architecture|roadmap)[^/]*\.(md|mdx|txt)$|(^|\/)(src|lib|main|crates|packages\/[^/]+\/src)\/.*\.(md|mdx|txt)$/i;
const MIN_IMPACT = 20;
const isFinding = (c) => c.verdict === "FALSE" || c.verdict === "PARTIAL";

async function checkAll(audit, evidence, extraClaimFiles = []) {
  // Docs and the pages that make claims are where an absent feature is still advertised; they do not count as code.
  const claimFiles = new Set([...audit.sources.map((s) => s.file), ...extraClaimFiles].filter(Boolean));
  const checks = [];
  for (const ev of evidence) checks.push(await checkEvidence(audit.root, ev, claimFiles));
  return checks;
}

async function reject(audit, what, verdict, problems) {
  audit.rejected.push({ claim: what, verdict, problems, at: new Date().toISOString() });
  await saveAudit(audit);
  return { accepted: false, problems };
}

async function receiptFor(audit, check, claim, verdict, reason, evidence) {
  const r = await saveReceipt(makeReceipt({
    check, claim, verdict, reason, evidence,
    target: `${audit.project}@${audit.commit ? audit.commit.slice(0, 7) : "uncommitted"}`,
  }));
  return r.id;
}

export async function recordClaim(input) {
  const audit = await loadAudit(input.audit_id);
  if (audit.finished_at) throw new Error("this audit is finished; start a new one");
  const problems = [];
  if (!AUDIT_VERDICTS.includes(input.verdict)) problems.push(`verdict must be one of ${AUDIT_VERDICTS.join(", ")}`);
  const evidence = input.evidence || [];
  const finding = isFinding(input);
  if (input.verdict !== "UNVERIFIABLE" && evidence.length === 0) problems.push(`${input.verdict} needs at least one piece of evidence from the code`);
  if (finding && !input.severity) problems.push(`${input.verdict} needs a severity (low, medium, high)`);
  if (finding && (!input.user_impact || input.user_impact.trim().length < MIN_IMPACT)) {
    problems.push(`${input.verdict} needs user_impact: what a user who relies on this sentence would get wrong. If you cannot name a real consequence, record it as VERIFIED with a note instead`);
  }
  if (input.verdict === "VERIFIED" && evidence.every((e) => e.type === "absent")) problems.push("VERIFIED needs a quote from the code that implements the claim, not only an absence");
  if (input.source?.file && NON_PROMISE.test(input.source.file)) {
    problems.push(`claim source ${input.source.file} is a changelog, plan or internal developer doc, not a promise to users. Use README, user docs or product pages`);
  }

  const sourceCheck = await checkQuote(audit.root, input.source);
  if (!sourceCheck.ok) problems.push(`claim source ${sourceCheck.where}: ${sourceCheck.reason}`);
  const evidenceChecks = await checkAll(audit, evidence, [input.source?.file]);
  evidenceChecks.forEach((c) => { if (!c.ok) problems.push(`evidence ${c.where}: ${c.reason}`); });
  if (problems.length) return reject(audit, input.claim, input.verdict, problems);

  const entry = {
    n: String(audit.claims.length + 1),
    claim: input.claim,
    verdict: input.verdict,
    severity: finding ? input.severity : null,
    explanation: input.explanation,
    user_impact: finding ? input.user_impact : null,
    note: input.note || null,
    source: input.source,
    evidence: evidence.map((e, i) => ({ ...e, checked: evidenceChecks[i] })),
    review: null,
  };
  entry.receipt = await receiptFor(audit, "claim", input.claim, input.verdict, input.explanation, { audit_id: audit.id, source: input.source, evidence: entry.evidence });
  audit.claims.push(entry);
  await saveAudit(audit);
  return { accepted: true, entry, totals: tally(audit) };
}

/** Risky code behaviour the docs do not mention at all. Not a verdict on any sentence. */
export async function recordBehavior(input) {
  const audit = await loadAudit(input.audit_id);
  if (audit.finished_at) throw new Error("this audit is finished; start a new one");
  audit.behaviors ??= [];
  const problems = [];
  const evidence = input.evidence || [];
  if (!evidence.some((e) => e.type === "quote")) problems.push("a behavior needs at least one quote from the code that does it");
  if (!input.user_impact || input.user_impact.trim().length < MIN_IMPACT) problems.push("a behavior needs user_impact: who is affected and how. If nobody is, skip the signal instead");
  if (!input.docs_searched || input.docs_searched.trim().length < 10) problems.push("say where you looked in the docs and found nothing (docs_searched). If the docs do promise something about it, use elliot_record_claim");
  const checks = await checkAll(audit, evidence);
  checks.forEach((c) => { if (!c.ok) problems.push(`evidence ${c.where}: ${c.reason}`); });
  if (problems.length) return reject(audit, input.behavior, "BEHAVIOR", problems);

  const entry = {
    n: `b${audit.behaviors.length + 1}`,
    behavior: input.behavior,
    signal: input.signal || null,
    severity: input.severity,
    user_impact: input.user_impact,
    docs_searched: input.docs_searched,
    evidence: evidence.map((e, i) => ({ ...e, checked: checks[i] })),
    review: null,
  };
  entry.receipt = await receiptFor(audit, "behavior", input.behavior, "UNDISCLOSED", input.user_impact, { audit_id: audit.id, evidence: entry.evidence });
  audit.behaviors.push(entry);
  await saveAudit(audit);
  return { accepted: true, entry, totals: tally(audit) };
}

function needsReview(audit) {
  return [...audit.claims.filter(isFinding), ...(audit.behaviors || [])].filter((f) => !f.review);
}

function findingText(f) {
  const ev = f.evidence.map((e) => (e.type === "absent" ? `    - Elliot searched the code for "${e.pattern}": not found` : `    - ${e.file}:${e.line_start}${e.line_end && e.line_end !== e.line_start ? "-" + e.line_end : ""}  ${String(e.quote).slice(0, 300)}`)).join("\n");
  if (f.behavior) {
    return `### ${f.n} (undisclosed behavior, severity ${f.severity})\n  Behavior: ${f.behavior}\n  User impact: ${f.user_impact}\n  Docs searched: ${f.docs_searched}\n  Evidence:\n${ev}`;
  }
  return `### ${f.n} (${f.verdict}, severity ${f.severity})\n  Claim: ${f.claim}\n  Claimed in ${f.source.file}:${f.source.line_start}: "${f.source.quote}"\n  Auditor says: ${f.explanation}\n  User impact: ${f.user_impact}\n  Evidence:\n${ev}`;
}

/** Everything a fresh reviewer needs, with no access to the auditor's reasoning beyond what it submitted. */
export async function reviewPacket({ audit_id }) {
  const audit = await loadAudit(audit_id);
  const pending = needsReview(audit);
  const body = pending.map(findingText).join("\n\n");
  const prompt = `You are an independent reviewer for an Elliot audit of the repository at ${audit.root} (commit ${audit.commit ? audit.commit.slice(0, 12) : "uncommitted"}).
You did not do this audit. Your job is to try to prove each finding below WRONG, not to agree with it. Do not modify any file.

For each finding, open the claimed source and the evidence, then search the repository yourself (other names too) and decide:
- confirm: the docs really promise it, the code really contradicts it (or really does the undisclosed thing), and a user relying on the docs would really be misled or harmed.
- downgrade: technically true but immaterial. An omission, a tiny delay or cache, a naming or count detail, an internal or roadmap doc rather than a promise to users, or a real issue attached to a sentence that is itself true.
- reject: the auditor misread the code or the docs, and the claim actually holds. Give at least one code quote that shows it.
Also check the severity: say in the reason if it is too high.

Record every decision with the Elliot tool elliot_record_review (audit_id "${audit.id}", finding = the id after ###). Quotes you give are checked against the files, like the auditor's.

${body}`;
  audit.review_requested_at ??= new Date().toISOString();
  await saveAudit(audit);
  return { pending: pending.length, prompt };
}

export const REVIEW_OUTCOMES = ["confirm", "downgrade", "reject"];

export async function recordReview(input) {
  const audit = await loadAudit(input.audit_id);
  if (audit.finished_at) throw new Error("this audit is finished; start a new one");
  const f = [...audit.claims, ...(audit.behaviors || [])].find((x) => x.n === input.finding);
  const problems = [];
  if (!f) problems.push(`no finding ${input.finding} in this audit`);
  else if (!f.behavior && !isFinding(f)) problems.push(`finding ${input.finding} is ${f.verdict}; only FALSE, PARTIAL and behaviors are reviewed`);
  if (!REVIEW_OUTCOMES.includes(input.outcome)) problems.push(`outcome must be one of ${REVIEW_OUTCOMES.join(", ")}`);
  const evidence = input.evidence || [];
  if (input.outcome === "reject" && !evidence.some((e) => e.type === "quote")) problems.push("reject needs at least one code quote showing the claim holds");
  const checks = await checkAll(audit, evidence);
  checks.forEach((c) => { if (!c.ok) problems.push(`evidence ${c.where}: ${c.reason}`); });
  if (problems.length) return { accepted: false, problems };

  f.review = { outcome: input.outcome, reason: input.reason, severity: input.severity || null, evidence: evidence.map((e, i) => ({ ...e, checked: checks[i] })), at: new Date().toISOString() };
  await saveAudit(audit);
  return { accepted: true, finding: f.n, outcome: input.outcome, pending: needsReview(audit).length };
}

/** Verdicts after review: confirmed findings stand, downgraded ones become notes, rejected ones are retracted. */
export function resolve(audit) {
  const claims = [], notes = [], retracted = [];
  for (const c of audit.claims) {
    if (!isFinding(c) || !c.review) { claims.push(c); continue; }
    if (c.review.outcome === "reject") retracted.push(c);
    else if (c.review.outcome === "downgrade") notes.push({ ...c, original_verdict: c.verdict, verdict: "VERIFIED", note: c.review.reason });
    else claims.push({ ...c, severity: c.review.severity || c.severity });
  }
  const behaviors = [];
  for (const b of audit.behaviors || []) {
    if (b.review?.outcome === "reject") retracted.push(b);
    else if (b.review?.outcome === "downgrade") notes.push({ ...b, note: b.review.reason });
    else behaviors.push({ ...b, severity: b.review?.severity || b.severity });
  }
  return { claims: [...claims, ...notes.filter((n) => !n.behavior)], behaviors, notes, retracted };
}

export function tally(audit) {
  const { claims, behaviors, notes, retracted } = resolve(audit);
  const t = { VERIFIED: 0, PARTIAL: 0, FALSE: 0, UNVERIFIABLE: 0 };
  for (const c of claims) t[c.verdict]++;
  return { claims: claims.length, ...t, behaviors: behaviors.length, downgraded: notes.length, retracted: retracted.length, rejected_citations: audit.rejected.length };
}

export async function finishAudit({ audit_id, out_dir, skipped = [] }) {
  const audit = await loadAudit(audit_id);
  const missing = coverage(audit, skipped);
  if (missing.length) return { finished: false, missing };
  const unreviewed = needsReview(audit);
  if (unreviewed.length) return { finished: false, unreviewed: unreviewed.map((f) => f.n) };
  audit.skipped = skipped;
  audit.finished_at = new Date().toISOString();
  const day = audit.finished_at.slice(0, 10);
  const short = audit.commit ? audit.commit.slice(0, 7) : "uncommitted";
  const dir = out_dir ? path.resolve(audit.root, out_dir) : path.join(audit.root, "elliot-report", `${day}-${short}`);
  await mkdir(dir, { recursive: true });
  const totals = tally(audit);
  const data = { ...audit, ...resolve(audit), raw_claims: audit.claims, totals };
  await writeFile(path.join(dir, "claims.json"), JSON.stringify(data, null, 2));
  await writeFile(path.join(dir, "report.md"), renderMarkdown(data));
  await writeFile(path.join(dir, "report.html"), renderHtml(data));
  await saveAudit(audit);
  const b = badge(data);
  return { finished: true, dir, totals, files: ["report.html", "report.md", "claims.json"].map((f) => path.join(dir, f)), ...(b ? { readme_badge: b.markdown } : {}) };
}
