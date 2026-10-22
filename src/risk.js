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
const TIER_A = /\b(telemetry|analytics (data|events|are|is|collect\w*)|usage (data|tracking|events)|event tracking|tracking (is|data|events)|track(s|ed)? (usage|events)|anonymous|anonymi[sz]ed|opt[- ]?in|opt[- ]?out|consent|personal data|no data|data (never )?leaves|stays? on your (machine|device|computer)|local[- ]only|all data|encrypt\w*|plain ?text|read[- ]only|access control|row[- ]level|\bRLS\b|\bSSO\b|SAML|OIDC|tamper\w*|audit log|sandbox\w*|never (sends?|stores?|shares?|collects?|logs?|uploads?)|stored? (securely|locally))\b/i;
// Tier B: security words that matter when paired with a promise.
const TIER_B = /\b(privacy|api keys?|secrets?|passwords?|credentials?|tokens?|permissions?|authenticat\w*|authori[sz]\w*|isolat\w*|redact\w*|delet\w*)\b/i;
const GUARANTEE = /\b(never|always|by default|defaults? to|automatically|immediately|guarantee\w*|no longer|cannot|can't|only (reads?|local))\b/i;
const SKIP_DOC = /(^|\/)(posts?|news|changelog|releases?|legal|privacy-policy|terms|i18n|translations?)(\/|\.|-)|(^|\/)blog\/\d{4}|(^|\/)v?\d+\.\d+(\.\d+)?\/|(^|\/)\d{4}-\d{2}-\d{2}/i;
const MAX_CANDIDATES = 20;

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
      const score = (a ? 3 : 0) + (b ? 1 : 0) + (g ? 1 : 0);
      if (score < 2) continue;
      if (inFence(lines, i)) continue;
      const risk = a || (b && g) ? "high" : "guarantee";
      found.push({ file: s.file, line: i + 1, text: line.replace(/\s+/g, " ").slice(0, 220), risk, score, rankIdx });
    }
  }
  found.sort((a, b) => b.score - a.score || a.rankIdx - b.rankIdx || a.line - b.line);
  const kept = [];
  for (const c of found) {
    if (kept.some((k) => (k.file === c.file && Math.abs(k.line - c.line) <= 2) || k.text === c.text)) continue;
    kept.push(c);
    if (kept.length >= MAX_CANDIDATES) break;
  }
  return kept.map(({ rankIdx, score, ...c }, i) => ({ id: `c${i + 1}`, ...c }));
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
  return out;
}

/** What the audit has not addressed yet. */
export function coverage(audit, skipped = []) {
  const isSkipped = (pred) => skipped.some(pred);
  const missing = [];
  for (const c of audit.candidates || []) {
    if (c.risk !== "high") continue;
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
