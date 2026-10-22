// Receipts: every check produces one, appended to .elliot/receipts.jsonl.
//
// A local receipt is tamper-evident (it carries a sha256 digest of its own
// canonical content), but it is NOT proof to a third party: whoever runs the
// agent also runs this checker. Third-party proof needs a neutral signer.

import { createHash, randomBytes } from "node:crypto";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import path from "node:path";

export const VERSION = "0.3.0";

export const Verdict = Object.freeze({
  VERIFIED: "VERIFIED",
  NOT_VERIFIED: "NOT_VERIFIED",
  INCONCLUSIVE: "INCONCLUSIVE",
});

export function elliotDir() {
  return process.env.ELLIOT_DIR || path.join(process.cwd(), ".elliot");
}

/** Stable JSON: object keys sorted recursively, so the digest is reproducible. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function digestOf(receipt) {
  const { digest, ...rest } = receipt;
  return "sha256:" + createHash("sha256").update(canonical(rest)).digest("hex");
}

export function makeReceipt({ check, claim, target, verdict, reason, evidence }) {
  const receipt = {
    elliot: VERSION,
    id: "rcpt_" + randomBytes(6).toString("hex"),
    check,
    claim: claim || null,
    target,
    verdict,
    reason,
    evidence,
    checked_at: new Date().toISOString(),
    checker: "local",
  };
  receipt.digest = digestOf(receipt);
  return receipt;
}

export async function saveReceipt(receipt) {
  const dir = elliotDir();
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, "receipts.jsonl"), JSON.stringify(receipt) + "\n");
  return receipt;
}

export async function readReceipts() {
  try {
    const raw = await readFile(path.join(elliotDir(), "receipts.jsonl"), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}
