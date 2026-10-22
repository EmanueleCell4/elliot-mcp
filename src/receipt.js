// Receipts: every check produces one, appended to .elliot/receipts.jsonl.
//
// A local receipt is tamper-evident (it carries a sha256 digest of its own
// canonical content), but it is NOT proof to a third party: whoever runs the
// agent also runs this checker. Third-party proof needs a neutral signer.

import { createHash, randomBytes, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import path from "node:path";

export const VERSION = "0.4.0";

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
  const { digest, signature, ...rest } = receipt;
  return "sha256:" + createHash("sha256").update(canonical(rest)).digest("hex");
}

function signingPayload(receipt) {
  const { signature, ...unsigned } = receipt;
  const payload = signature
    ? { ...unsigned, signature: { ...signature, value: undefined } }
    : unsigned;
  return Buffer.from(canonical(payload));
}

export function verifyAttestation(receipt, publicKeyPem) {
  try {
    if (!receipt?.signature || receipt.signature.algorithm !== "Ed25519") return { valid: false, reason: "missing Ed25519 signature" };
    if (receipt.digest !== digestOf(receipt)) return { valid: false, reason: "receipt digest does not match its contents" };
    const trusted = typeof publicKeyPem === "string" && publicKeyPem.length > 0;
    const key = createPublicKey(publicKeyPem || receipt.signature.public_key);
    const fingerprint = "sha256:" + createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex");
    if (fingerprint !== receipt.signature.key_id) return { valid: false, signature_valid: false, trusted: false, reason: "public key fingerprint does not match key_id" };
    const signatureValid = verify(null, signingPayload(receipt), key, Buffer.from(receipt.signature.value, "base64"));
    return {
      valid: signatureValid && trusted,
      signature_valid: signatureValid,
      trusted,
      reason: !signatureValid ? "signature is invalid" : trusted ? "signature, digest and explicitly trusted public key are valid" : "signature is valid, but signer identity is untrusted without an explicitly supplied public key",
      key_id: fingerprint,
      signer: receipt.signature.signer,
    };
  } catch (err) { return { valid: false, reason: `invalid attestation: ${err.message}` }; }
}

async function signReceipt(receipt) {
  const keyPath = process.env.ELLIOT_SIGNING_KEY;
  if (!keyPath) return receipt;
  const privateKey = createPrivateKey(await readFile(keyPath));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("ELLIOT_SIGNING_KEY must contain an Ed25519 private key");
  const publicKey = createPublicKey(privateKey);
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const keyId = "sha256:" + createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
  const signed = { ...receipt, signature: { algorithm: "Ed25519", key_id: keyId, signer: process.env.ELLIOT_SIGNER_ID || keyId, public_key: publicPem, value: "" } };
  signed.signature.value = sign(null, signingPayload(signed), privateKey).toString("base64");
  return signed;
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
  receipt = await signReceipt(receipt);
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
