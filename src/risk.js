// Risk sweep: Elliot decides what must be audited, not the agent.
//
// Left alone, an auditing agent picks the easy claims and stops early. Before the
// agent reads anything, Elliot scans the docs for sentences that make risky or
// absolute promises, and the code for signals that usually contradict them
// (telemetry SDKs, permission bypasses, privileged database clients, secrets
// written in plain text). The audit cannot finish until each one is addressed.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);

// Tier A: promises about privacy, data, secrets and access. A user is hurt when these are false.
const TIER_A = /\b(telemetry|analytics (data|events|are|is|collect\w*)|usage (data|tracking|events)|event tracking|tracking (is|data|events)|track(s|ed)? (usage|events)|anonymous|anonymi[sz]ed|opt[- ]?in|opt[- ]?out|consent|personal data|no data|data (never )?leaves|stays? on your (machine|device|computer)|local[- ]only|all data|encrypt\w*|plain ?text|read[- ]only|access control|row[- ]level|\bRLS\b|\bSSO\b|SAML|OIDC|tamper\w*|audit log|sandbox\w*|never (sends?|stores?|shares?|collects?|logs?|uploads?)|stored? (securely|locally)|only (you|the owner|authenticated users|logged[- ]in users)|private (by default|to you)|(their|your) own (files|data))\b/i;
// Tier B: security words that matter when paired with a promise.
const TIER_B = /\b(privacy|api keys?|secrets?|passwords?|credentials?|tokens?|permissions?|authenticat\w*|authori[sz]\w*|isolat\w*|redact\w*|delet\w*)\b/i;
const GUARANTEE = /\b(never|always|by default|defaults? to|automatically|immediately|guarantee\w*|no longer|cannot|can't|only (reads?|local))\b/i;
const SKIP_DOC = /(^|\/)(posts?|news|changelog|releases?|legal|privacy-policy|terms|i18n|translations?|ja|zh|zh-cn|zh-tw|ko|es|fr|de|pt|pt-br|ru|it)(\/|\.|-)|(^|\/)blog\/\d{4}|(^|\/)v?\d+\.\d+(\.\d+)?\/|(^|\/)\d{4}-\d{2}-\d{2}/i;
const MAX_CANDIDATES = 20;
// Defaults, limits and requirements: concrete, checkable, and the first thing to drift when code changes.
const DEFAULTISH = /\b(by default|defaults? (to|is)|default(:| value| of)|requires?|minimum|maximum|at (most|least)|up to|timeout|time out|limit(ed)? (to|of)|capped|retries|retry|expires?|tolerance)\b/i;
const CONCRETE = /\b\d+(\.\d+)?\s*(ms|s|sec|secs|seconds?|minutes?|mins?|hours?|days?|kb|mb|gb|kib|mib|%|tokens|bytes|rounds|retries|attempts|requests)\b|`[^`]*\d[^`]*`|`[^`]*\b(true|false|True|False|None|null)\b[^`]*`|\b(Node(\.js)?|Python|Go|Rust)\s*v?\d+/i;
// "By default, `SomeClient` does X" is concrete even without a number: it names the thing.
const NAMED_DEFAULT = /\b(by default|defaults? to)\b.*`[A-Za-z_][\w.]*`|`[A-Za-z_][\w.]*`.*\b(by default|defaults? to)\b/i;
const MAX_DEFAULTS = 20;
const MAX_DEFAULTS_PER_FILE = 2;
// Defaults that decide what an agent or a sandbox may touch matter more than cosmetic ones.
const SENSITIVE_DEFAULT = /\b(environment|env|host|network|sandbox|permission|approv\w*|telemetry|token|secret|credential|auth\w*|trust\w*|isolat\w*|privacy|log(s|ging)?|upload|requires? (node|python|go|rust))/i;

export const SIGNALS = [
  { id: "telemetry", label: "telemetry or analytics SDK, or user identification", re: "posthog|mixpanel|amplitude|segment\\.(io|com)|@sentry/|sentry_sdk|\\$identify|\\.identify\\(|track_event|captureException|google-analytics|gtag\\(" },
  { id: "permission_bypass", label: "permission or sandbox checks turned off", re: "dangerously-skip-permissions|bypassPermissions|--no-sandbox|disableSecurity|allow-all-tools|skip_permissions" },
  { id: "privileged_db", label: "privileged database client that bypasses row-level security", re: "service_role|SERVICE_ROLE_KEY|createAdminClient|supabaseAdmin" },
  { id: "plaintext_secret", label: "secrets or API keys written to disk or storage", re: "(api_?key|apiKey|secret|token|password)[^\\n]{0,80}(writeFile|JSON\\.stringify|localStorage\\.setItem|write_all|fs::write)" },
];

const SKIP_PATH = /(^|\/)(node_modules|vendor|dist|build|\.next|target|coverage|__tests__|tests?|e2e|fixtures|examples?|mocks?)\/|\.(test|spec)\.|\.min\.|(^|\/)(package-lock\.json|bun\.lock|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|NOTICES?(\.\w+)?)$/i;
const DOC_EXT = /\.(md|mdx|markdown|rst|txt|adoc)$/i;

function inFence(lines, i) {
  let open = false;
  for (let k = 0; k < i; k++) if (/^\s*(```|~~~)/.test(lines[k])) open = !open;
  return open;
}

/** Sentences in the docs that make risky or absolute promises, highest risk first. */
export async function docCandidates(root, sources) {
  const found = [];
  for (const [rankIdx, s] of sources.entries()) {
    let text;
    try { text = await readFile(path.join(root, s.file), "utf8"); } catch { continue; }
    const lines = text.split("\n");
    if (SKIP_DOC.test(s.file)) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length < 15 || line.length > 600 || /^#{1,6}\s/.test(line) || /^(import|export)\s/.test(line)) continue;
      const a = TIER_A.test(line), b = TIER_B.test(line), g = GUARANTEE.test(line);
      let score = (a ? 3 : 0) + (b ? 1 : 0) + (g ? 1 : 0);
      const d = DEFAULTISH.test(line) && (CONCRETE.test(line) || NAMED_DEFAULT.test(line));
      if (score < 2 && !d) continue;
      if (inFence(lines, i)) continue;
      const risk = a || (b && g) ? "high" : score >= 2 ? "guarantee" : "default";
      if (risk === "default") score = SENSITIVE_DEFAULT.test(line) ? 1.9 : 1.5;
      found.push({ file: s.file, line: i + 1, text: line.replace(/\s+/g, " ").slice(0, 220), risk, score, rankIdx });
    }
  }
  found.sort((a, b) => b.score - a.score || a.rankIdx - b.rankIdx || a.line - b.line);
  const kept = [];
  let defaults = 0;
  const perFile = new Map();
  for (const c of found) {
    if (kept.some((k) => (k.file === c.file && Math.abs(k.line - c.line) <= 2) || k.text === c.text)) continue;
    if (c.risk === "default") {
      if (defaults >= MAX_DEFAULTS || (perFile.get(c.file) || 0) >= MAX_DEFAULTS_PER_FILE) continue;
      perFile.set(c.file, (perFile.get(c.file) || 0) + 1);
      defaults++;
    } else if (kept.length - defaults >= MAX_CANDIDATES) continue;
    kept.push(c);
  }
  return kept.map(({ rankIdx, score, ...c }, i) => ({ id: `c${i + 1}`, ...c }));
}

// Missing authorization is hard to see one handler at a time and easy to see between siblings:
// in a file where most exported handlers check the caller, the one that doesn't is worth a look.
const AUTH = /context\.user\b|req\.user\b|request\.user\b|ctx\.(session|user|state\.user)\b|getServerSession|\bauth\(\)|currentUser|current_user|requireAuth|requireUser|requireSession|isAuthenticated|is_authenticated|login_required|ensureAuth|session\.user\b|assertOwner|checkPermission|has_perm|permission_required/;
// Only functions that receive a request or a request context are handlers.
const HANDLER_SIG = /\b(req|request|ctx|context|event)\b/;
const NOT_SERVER = /(^|\/)(frontend|client|components?|ui|web\/src|pages\/_|public|static|fake[-_]?\w*|mocks?|stubs?|testing)\//i;
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|py)$/;
const JS_FN = /^export\s+(?:default\s+)?(?:const\s+([A-Za-z_$][\w$]*)|(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?)/;
const PY_ROUTE = /^@(?:\w+\.)?(?:route|get|post|put|patch|delete|api_view|action)\b/;
const PY_FN = /^(?:async\s+)?def\s+([A-Za-z_]\w*)/;
const MAX_AUTH_FILES = 400;

function handlers(text, file) {
  const lines = text.split("\n");
  const starts = [];
  if (file.endsWith(".py")) {
    for (let i = 0; i < lines.length; i++) {
      if (!PY_ROUTE.test(lines[i])) continue;
      let j = i;
      while (j < lines.length && !PY_FN.test(lines[j])) j++;
      if (j < lines.length) { starts.push({ name: lines[j].match(PY_FN)[1], line: j + 1, at: i }); i = j; }
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(JS_FN);
      if (!m) continue;
      // An exported const counts only when it is a function (arrow or function expression within a few lines).
      if (m[1] && !/=>|function\b/.test(lines.slice(i, i + 6).join(" "))) continue;
      starts.push({ name: m[1] || m[2] || "default", line: i + 1, at: i });
    }
  }
  return starts.map((s, k) => ({ ...s, body: lines.slice(s.at, k + 1 < starts.length ? starts[k + 1].at : lines.length).join("\n") }));
}

/** Exported handlers that skip the auth check their siblings in the same file perform. */
export async function authGaps(root) {
  let files = [];
  try {
    files = (await run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 256 * 1024 * 1024 })).stdout.split("\0").filter(Boolean);
  } catch { return []; }
  files = files.filter((f) => CODE_EXT.test(f) && !SKIP_PATH.test(f) && !NOT_SERVER.test(f) && !f.startsWith(".elliot") && !f.startsWith("elliot-report"));
  const hits = [];
  let scanned = 0;
  for (const f of files) {
    if (scanned >= MAX_AUTH_FILES * 10) break;
    let text;
    try { text = await readFile(path.join(root, f), "utf8"); } catch { continue; }
    scanned++;
    if (text.length > 400_000 || !AUTH.test(text)) continue;
    // A handler takes a request or context, or is declared with the same typed shape as its
    // siblings (e.g. `export const getX: GetX<...> = async (args) =>`, which is how a handler that
    // forgot its context parameter looks).
    const typed = (h) => /^export\s+const\s+[\w$]+\s*:\s*[A-Z][\w$]*\s*</.test(h.body);
    const all = handlers(text, f);
    const hs = all.filter((h) => HANDLER_SIG.test(h.body.split("\n").slice(0, 6).join(" ")) || (typed(h) && all.filter(typed).length >= 3));
    if (hs.length < 3) continue;
    const withAuth = hs.filter((h) => AUTH.test(h.body));
    const without = hs.filter((h) => !AUTH.test(h.body));
    if (withAuth.length < 2 || withAuth.length < hs.length / 2 || !without.length) continue;
    for (const h of without) hits.push({ file: f, line: h.line, text: `${h.name}: no auth check, while ${withAuth.length} of ${hs.length} handlers in this file check the caller` });
  }
  return hits;
}

/** Code locations that often contradict privacy and security promises. */
export async function codeSignals(root) {
  const out = [];
  for (const sig of SIGNALS) {
    let stdout = "";
    try {
      stdout = (await run("git", ["grep", "-n", "-I", "-E", "-i", "--untracked", "-e", sig.re, "--", ".", ":(exclude).elliot", ":(exclude)elliot-report"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout;
    } catch (err) {
      if (err.code !== 1) continue;
    }
    const hits = stdout.split("\n").filter(Boolean)
      .map((h) => { const m = h.match(/^([^:]+):(\d+):(.*)$/); return m && { file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 160) }; })
      .filter((h) => h && !SKIP_PATH.test(h.file) && !DOC_EXT.test(h.file));
    if (!hits.length) continue;
    const files = [...new Set(hits.map((h) => h.file))];
    out.push({ id: sig.id, label: sig.label, hit_count: hits.length, files, examples: hits.slice(0, 4) });
  }
  const gaps = await authGaps(root);
  if (gaps.length) {
    out.push({ id: "auth_gap", label: "exported handlers with no authorization check while their sibling handlers have one (check whether each is meant to be public)", hit_count: gaps.length, files: [...new Set(gaps.map((g) => g.file))], examples: gaps.slice(0, 6) });
  }
  return out;
}

/** What the audit has not addressed yet. */
export function coverage(audit, skipped = []) {
  const isSkipped = (pred) => skipped.some(pred);
  const missing = [];
  for (const c of audit.candidates || []) {
    if (c.risk !== "high" && c.risk !== "default") continue;
    const covered = audit.claims.some((cl) => cl.source.file === c.file && Math.abs(cl.source.line_start - c.line) <= 3);
    if (!covered && !isSkipped((s) => s.candidate === c.id)) missing.push({ kind: "candidate", id: c.id, where: `${c.file}:${c.line}`, text: c.text });
  }
  for (const s of audit.signals || []) {
    const cites = (x) => x.evidence.some((e) => e.file && s.files.includes(e.file));
    const covered = audit.claims.some(cites) || (audit.behaviors || []).some(cites);
    if (!covered && !isSkipped((x) => x.signal === s.id)) missing.push({ kind: "signal", id: s.id, where: s.files.slice(0, 3).join(", "), text: s.label });
  }
  return missing;
}
