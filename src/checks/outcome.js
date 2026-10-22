// Run a functional check in a disposable copy with a read/write-restricted OS sandbox.
import { mkdtemp, cp, rm, access, mkdir, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Verdict } from "../receipt.js";

const OMIT = new Set([".elliot", "elliot-report"]);
const MAX_OUTPUT = 1024 * 1024;

async function executablePath(command, cwd) {
  const candidates = command.includes(path.sep)
    ? [path.resolve(cwd, command)]
    : (process.env.PATH || "/usr/bin:/bin").split(path.delimiter).map((dir) => path.join(dir, command));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return { path: candidate, realpath: await realpath(candidate) };
    } catch { /* try next PATH entry */ }
  }
  return null;
}

function profileQuote(value) {
  return '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"') + '"';
}

function macSandboxProfile(temp, executable) {
  const readRoots = new Set([
    "/System", "/usr", "/bin", "/sbin", "/Library/Apple/System/Library",
    path.dirname(executable.path), path.dirname(executable.realpath),
  ]);
  for (const executablePath of [executable.path, executable.realpath]) {
    const parent = path.dirname(executablePath);
    if (["bin", "sbin"].includes(path.basename(parent))) readRoots.add(path.dirname(parent));
  }
  const marker = path.sep + "node_modules" + path.sep;
  const markerAt = executable.realpath.lastIndexOf(marker);
  if (markerAt >= 0) {
    const prefix = executable.realpath.slice(0, markerAt + marker.length);
    const rest = executable.realpath.slice(markerAt + marker.length).split(path.sep);
    const packageParts = rest[0]?.startsWith("@") ? rest.slice(0, 2) : rest.slice(0, 1);
    if (packageParts.length) readRoots.add(path.join(prefix, ...packageParts));
  }
  const reads = [...readRoots].map((p) => "(subpath " + profileQuote(p) + ")").join(" ");
  const execs = [...readRoots].map((p) => "(subpath " + profileQuote(p) + ")").join(" ");
  return "(version 1) (deny default) (allow process-fork) (allow process-exec " + execs +
    ") (allow process-info* (target self)) (allow file-read* " + reads +
    " (literal \"/dev/null\") (literal \"/dev/zero\") (literal \"/dev/random\") (literal \"/dev/urandom\") (subpath " + profileQuote(temp) + ")) (allow file-write* (subpath " +
    profileQuote(temp) + ")) (allow sysctl-read) (allow mach-lookup) (deny network*)";
}

async function addBwrapMounts(args, rootDirs, roBinds) {
  const made = new Set(["/"]);
  const makeParents = async (target) => {
    const parts = target.split(path.sep).filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += "/" + part;
      if (!made.has(current)) { args.push("--dir", current); made.add(current); }
    }
  };
  for (const dir of rootDirs) {
    try { await stat(dir); } catch { continue; }
    await makeParents(dir);
    args.push("--ro-bind", dir, dir);
    made.add(dir);
  }
  for (const dir of roBinds) {
    if (rootDirs.some((root) => dir === root || dir.startsWith(root + path.sep))) continue;
    try { await stat(dir); } catch { continue; }
    await makeParents(dir);
    args.push("--ro-bind", dir, dir);
    made.add(dir);
  }
}

function runSandbox(executable, args, { cwd, env, timeout }) {
  return new Promise((resolve, reject) => {
    let child;
    let timedOut = false;
    let output = { stdout: "", stderr: "" };
    let killTimer;
    let settled = false;
    const signalGroup = (signal) => {
      if (!child?.pid) return;
      try { process.kill(-child.pid, signal); } catch (error) {
        if (error.code !== "ESRCH") { try { child.kill(signal); } catch { /* process already exited */ } }
      }
    };
    const appendTail = (key, chunk) => { output[key] = (output[key] + chunk.toString()).slice(-MAX_OUTPUT); };
    try {
      child = spawn(executable, args, {
        cwd, env, shell: false, windowsHide: true, detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) { reject(error); return; }
    child.stdout.on("data", (chunk) => appendTail("stdout", chunk));
    child.stderr.on("data", (chunk) => appendTail("stderr", chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      reject(Object.assign(error, output));
    });
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      signalGroup("SIGTERM");
      killTimer = setTimeout(() => signalGroup("SIGKILL"), 300);
      killTimer.unref();
    }, timeout);
    timeoutTimer.unref();
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      // The process group inherits the sandbox; kill background descendants too.
      signalGroup("SIGKILL");
      resolve({ code, signal, stdout: output.stdout, stderr: output.stderr, timedOut });
    });
  });
}

export async function checkOutcome({ path: inputPath = process.cwd(), command, args = [], timeout_ms = 120000 }) {
  const source = path.resolve(inputPath);
  let temp;
  let isolationCommand;
  let sandboxStarted = false;
  try {
    temp = await mkdtemp(path.join(tmpdir(), "elliot-outcome-"));
    const copy = path.join(temp, "repo");
    const scratch = path.join(temp, "scratch");
    const home = path.join(scratch, "home");
    await mkdir(home, { recursive: true });
    await cp(source, copy, { recursive: true, dereference: false, filter: (p) => !OMIT.has(path.basename(p)) });
    const executable = await executablePath(command, copy);
    if (!executable) return { target: source, verdict: Verdict.INCONCLUSIVE, reason: "executable not found: " + command, evidence: { command, args, isolated_copy: true, os_sandbox: false, network: "not-run" } };

    let sandboxArgs;
    let sandboxEnv;
    if (process.platform === "darwin") {
      isolationCommand = "/usr/bin/sandbox-exec";
      sandboxArgs = ["-p", macSandboxProfile(temp, executable), executable.path, ...args];
      sandboxEnv = { PATH: path.dirname(executable.path) + ":/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, TMPDIR: scratch, TEMP: scratch, CI: "1" };
    } else if (process.platform === "linux") {
      isolationCommand = "bwrap";
      const commandDirs = [...new Set([path.dirname(executable.path), path.dirname(executable.realpath)])];
      for (const commandPath of [executable.path, executable.realpath]) {
        const parent = path.dirname(commandPath);
        if (["bin", "sbin"].includes(path.basename(parent))) commandDirs.push(path.dirname(parent));
      }
      const nodeModulesMarker = path.sep + "node_modules" + path.sep;
      const nodeModulesAt = executable.realpath.lastIndexOf(nodeModulesMarker);
      if (nodeModulesAt >= 0) {
        const prefix = executable.realpath.slice(0, nodeModulesAt + nodeModulesMarker.length);
        const packageParts = executable.realpath.slice(nodeModulesAt + nodeModulesMarker.length).split(path.sep);
        commandDirs.push(path.join(prefix, ...packageParts.slice(0, packageParts[0]?.startsWith("@") ? 2 : 1)));
      }
      const bwrapArgs = ["--die-with-parent", "--unshare-all", "--tmpfs", "/", "--dir", "/tmp", "--dir", "/workspace"];
      await addBwrapMounts(bwrapArgs, ["/usr/bin", "/usr/lib", "/usr/lib64", "/usr/share", "/usr/local/bin", "/usr/local/lib", "/etc", "/bin", "/sbin", "/lib", "/lib64"], [...new Set(commandDirs)]);
      bwrapArgs.push("--dir", "/proc", "--dir", "/dev", "--proc", "/proc", "--dev", "/dev", "--bind", scratch, "/tmp", "--ro-bind", copy, "/workspace", "--chdir", "/workspace");
      sandboxArgs = [...bwrapArgs, executable.path, ...args];
      sandboxEnv = { PATH: commandDirs.join(":") + ":/usr/bin:/bin:/usr/sbin:/sbin", HOME: "/tmp/home", TMPDIR: "/tmp", TEMP: "/tmp", CI: "1" };
    } else {
      return { target: source, verdict: Verdict.INCONCLUSIVE, reason: "no supported OS sandbox is available on " + process.platform, evidence: { command, args, isolated_copy: true, os_sandbox: false, network: "not-run" } };
    }
    sandboxStarted = true;
    const result = await runSandbox(isolationCommand, sandboxArgs, { cwd: copy, env: sandboxEnv, timeout: timeout_ms });
    const sandboxStartupFailure = /sandbox_apply: Operation not permitted|^bwrap:/mi.test(result.stderr);
    if (sandboxStartupFailure) {
      return { target: source, verdict: Verdict.INCONCLUSIVE, reason: "OS sandbox setup failed; the functional command was not run", evidence: { command, args, exit_code: result.code, stderr: result.stderr.slice(-12000), isolated_copy: true, os_sandbox: false, network: "not-run" } };
    }
    if (result.timedOut) {
      return { target: source, verdict: Verdict.INCONCLUSIVE, reason: "functional check timed out after " + timeout_ms + "ms", evidence: { command, args, exit_code: result.code, signal: result.signal, stdout: result.stdout.slice(-12000), stderr: result.stderr.slice(-12000), isolated_copy: true, os_sandbox: true, network: "blocked", process_group_terminated: true } };
    }
    if (result.code === null || result.signal) {
      // Some hosts kill the sandbox wrapper before it can report an exit code.
      // We cannot establish either a completed functional check or working isolation.
      return { target: source, verdict: Verdict.INCONCLUSIVE,
        reason: "sandboxed check terminated without a normal exit status (" + (result.signal || "unknown signal") + "); execution and isolation were not verified",
        evidence: { command, args, exit_code: result.code, signal: result.signal, stdout: result.stdout.slice(-12000),
          stderr: result.stderr.slice(-12000), isolated_copy: true, os_sandbox: false,
          network: "unverified", process_group_terminated: true } };
    }
    const verdict = result.code === 0 ? Verdict.VERIFIED : Verdict.NOT_VERIFIED;
    return { target: source, verdict, reason: result.code === 0 ? "functional check exited successfully in an OS-sandboxed disposable repository copy" : "functional check exited with code " + (result.code ?? "unknown"), evidence: { command, args, exit_code: result.code, signal: result.signal, stdout: result.stdout.slice(-12000), stderr: result.stderr.slice(-12000), isolated_copy: true, os_sandbox: true, network: "blocked", process_group_terminated: true } };
  } catch (err) {
    const sandboxUnavailable = /sandbox_apply: Operation not permitted|bwrap:.*(not found|operation not permitted)/i.test(String(err.stderr || ""));
    const missingIsolation = err.code === "ENOENT" && isolationCommand;
    const preparationFailed = !sandboxStarted && !missingIsolation && !sandboxUnavailable;
    return { target: source, verdict: sandboxUnavailable || missingIsolation || preparationFailed ? Verdict.INCONCLUSIVE : Verdict.NOT_VERIFIED,
      reason: sandboxUnavailable ? "the host denied OS sandbox creation; the functional command was not run" : missingIsolation ? "OS sandbox executable is unavailable: " + isolationCommand : preparationFailed ? "could not prepare the isolated copy: " + err.message : "functional check could not start: " + err.message,
      evidence: { command, args, exit_code: err.code ?? null, stdout: String(err.stdout || "").slice(-12000), stderr: String(err.stderr || "").slice(-12000), isolated_copy: Boolean(temp), os_sandbox: !(missingIsolation || sandboxUnavailable || preparationFailed), network: missingIsolation || sandboxUnavailable || preparationFailed ? "not-run" : "blocked" } };
  } finally { if (temp) await rm(temp, { recursive: true, force: true }); }
}
