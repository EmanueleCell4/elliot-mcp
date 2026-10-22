import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkOutcome } from "../src/checks/outcome.js";

test("outcome verification fails closed when sandbox cannot complete a check", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "elliot-outcome-test-"));
  try {
    const result = await checkOutcome({ path: root, command: process.execPath, args: ["-e", "console.log('OUTCOME_COMMAND_RAN')"] });
    if (result.evidence.os_sandbox === false) {
      assert.equal(result.verdict, "INCONCLUSIVE");
      assert.ok(["not-run", "unverified"].includes(result.evidence.network));
      assert.doesNotMatch(result.evidence.stdout || "", /OUTCOME_COMMAND_RAN/);
    } else {
      assert.equal(result.verdict, "VERIFIED", "sandbox check: " + JSON.stringify({reason: result.reason, code: result.evidence.exit_code, stderr: String(result.evidence.stderr || "").slice(-800)}));
      await assert.rejects(readFile(path.join(root, "OUTCOME_COMMAND_RAN")));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("sandbox denies host file reads/writes and network; timeout terminates child processes", async (t) => {
  const source = await mkdtemp(path.join(tmpdir(), "elliot-outcome-source-"));
  const outside = await mkdtemp(path.join(tmpdir(), "elliot-outcome-outside-"));
  const secret = path.join(outside, "secret.txt");
  const original = path.join(source, "keep.txt");
  let listener;
  try {
    await writeFile(secret, "host-only-secret");
    await writeFile(original, "original");
    await symlink(secret, path.join(source, "host-secret-link"));
    const probe = await checkOutcome({
      path: source, command: process.execPath,
      args: ["-e", "try { require('node:fs').readFileSync(process.argv[1]); process.exit(5) } catch { process.exit(0) }", secret],
    });
    if (probe.evidence.os_sandbox === false) {
      t.skip("sandbox startup or execution aborted; OS isolation not verified");
      return;
    }
    assert.equal(probe.verdict, "VERIFIED", "sandbox check: " + JSON.stringify({reason: probe.reason, code: probe.evidence.exit_code, stderr: String(probe.evidence.stderr || "").slice(-800)}));

    const symlinkProbe = await checkOutcome({
      path: source, command: process.execPath,
      args: ["-e", "try { require('node:fs').readFileSync(process.argv[1]); process.exit(5) } catch { process.exit(0) }", path.join(source, "host-secret-link")],
    });
    assert.equal(symlinkProbe.verdict, "VERIFIED", "a repository symlink must not expose its host target");

    const writeProbe = await checkOutcome({
      path: source, command: process.execPath,
      args: ["-e", "try { require('node:fs').writeFileSync(process.argv[1], 'escaped'); process.exit(6) } catch { process.exit(0) }", original],
    });
    assert.equal(writeProbe.verdict, "VERIFIED", "writes to the original checkout must be denied");
    assert.equal(await readFile(original, "utf8"), "original");

    const net = await import("node:net");
    listener = net.createServer((socket) => socket.end("reachable"));
    await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const port = listener.address().port;
    const networkProbe = await checkOutcome({
      path: source, command: process.execPath,
      args: ["-e", "const n=require('node:net'); const s=n.connect(Number(process.argv[1]),'127.0.0.1',()=>process.exit(7)); s.on('error',()=>process.exit(0)); setTimeout(()=>process.exit(8),800)", String(port)],
    });
    assert.equal(networkProbe.verdict, "VERIFIED", "sandbox must not reach a host loopback listener");

    const childProbe = await checkOutcome({
      path: source, command: process.execPath, timeout_ms: 1000,
      args: ["-e", "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000)"],
    });
    assert.equal(childProbe.verdict, "INCONCLUSIVE");
    assert.equal(childProbe.evidence.process_group_terminated, true);
    const childPid = Number(childProbe.evidence.stdout.trim().split(/\s+/).at(-1));
    if (Number.isInteger(childPid) && childPid > 0) assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" });
  } finally {
    listener?.close();
    await rm(source, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
