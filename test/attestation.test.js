import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonical, makeReceipt, saveReceipt, verifyAttestation } from "../src/receipt.js";

test("Ed25519 receipt is tamper-evident, key-pinned and OpenSSL-verifiable", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "elliot-signature-test-"));
  const oldDir = process.env.ELLIOT_DIR, oldKey = process.env.ELLIOT_SIGNING_KEY;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyPath = path.join(dir, "private.pem");
  const publicPath = path.join(dir, "trusted-public.pem");
  const payloadPath = path.join(dir, "payload.json");
  const signaturePath = path.join(dir, "signature.bin");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  await writeFile(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  await writeFile(publicPath, publicPem);
  process.env.ELLIOT_DIR = path.join(dir, "receipts");
  process.env.ELLIOT_SIGNING_KEY = keyPath;
  try {
    const receipt = await saveReceipt(makeReceipt({ check: "test", target: "repo@abc", verdict: "VERIFIED", reason: "passed", evidence: { exit_code: 0 } }));
    const unsignedTrust = verifyAttestation(receipt);
    assert.equal(unsignedTrust.signature_valid, true);
    assert.equal(unsignedTrust.trusted, false);
    assert.equal(unsignedTrust.valid, false, "the embedded key alone must not establish signer identity");
    assert.equal(verifyAttestation(receipt, publicPem).valid, true);
    assert.equal(verifyAttestation({ ...receipt, reason: "forged" }, publicPem).valid, false);
    assert.equal(verifyAttestation({ ...receipt, signature: { ...receipt.signature, signer: "another signer" } }, publicPem).valid, false);

    const replacement = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });
    assert.equal(verifyAttestation(receipt, replacement).valid, false);

    const payload = canonical({ ...receipt, signature: { ...receipt.signature, value: undefined } });
    await writeFile(payloadPath, payload);
    await writeFile(signaturePath, Buffer.from(receipt.signature.value, "base64"));
    try {
      execFileSync("openssl", ["pkeyutl", "-verify", "-pubin", "-inkey", publicPath, "-rawin", "-in", payloadPath, "-sigfile", signaturePath], { stdio: "pipe" });
    } catch (error) {
      if (error.code === "ENOENT") { t.skip("OpenSSL is unavailable"); return; }
      throw error;
    }
  } finally {
    if (oldDir === undefined) delete process.env.ELLIOT_DIR; else process.env.ELLIOT_DIR = oldDir;
    if (oldKey === undefined) delete process.env.ELLIOT_SIGNING_KEY; else process.env.ELLIOT_SIGNING_KEY = oldKey;
    await rm(dir, { recursive: true, force: true });
  }
});
