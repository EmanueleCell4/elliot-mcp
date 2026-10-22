// "I cleaned / fixed / refactored the code" -> did any file actually change?
//
// elliot_snapshot fingerprints the working tree before the task.
// verify_changes compares against it afterwards (or, without a snapshot,
// reports uncommitted changes against HEAD).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Verdict, elliotDir } from "../receipt.js";

const run = promisify(execFile);
const MAX_FILES = 50_000;

async function git(cwd, args) {
  const { stdout } = await run("git", args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}

async function repoRoot(dir) {
  return (await git(dir, ["rev-parse", "--show-toplevel"])).trim();
}

/** sha1 of every tracked + untracked (non-ignored) file, keyed by repo-relative path. */
async function fingerprint(root) {
  const out = await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const files = [...new Set(out.split("\0").filter(Boolean))].filter((f) => !f.startsWith(".elliot/"));
  if (files.length > MAX_FILES) throw new Error(`repository has ${files.length} files; snapshot limit is ${MAX_FILES}`);
  const hashes = {};
  for (const f of files) {
    try {
      hashes[f] = createHash("sha1").update(await readFile(path.join(root, f))).digest("hex");
    } catch {
      hashes[f] = null; // listed by git but deleted on disk
    }
  }
  let head = null;
  try {
    head = (await git(root, ["rev-parse", "HEAD"])).trim();
  } catch {
    /* repo without commits */
  }
  return { head, hashes };
}

function diff(before, after, only) {
  const keep = (f) => !only?.length || only.some((p) => f === p || f.startsWith(p.replace(/\/?$/, "/")));
  const added = [], removed = [], modified = [];
  for (const [f, h] of Object.entries(after)) {
    if (!keep(f)) continue;
    if (!(f in before) || before[f] === null) { if (h !== null) added.push(f); }
    else if (h === null) removed.push(f);
    else if (before[f] !== h) modified.push(f);
  }
  for (const f of Object.keys(before)) if (keep(f) && !(f in after) && before[f] !== null) removed.push(f);
  return { added, removed, modified };
}

export async function snapshot({ path: dir = process.cwd() }) {
  const root = await repoRoot(path.resolve(dir));
  const fp = await fingerprint(root);
  const id = "snap_" + randomBytes(6).toString("hex");
  const store = path.join(elliotDir(), "snapshots");
  await mkdir(store, { recursive: true });
  await writeFile(path.join(store, `${id}.json`), JSON.stringify({ id, root, taken_at: new Date().toISOString(), ...fp }));
  return { snapshot_id: id, root, head: fp.head, files: Object.keys(fp.hashes).length };
}

export async function checkChanges({ path: dir = process.cwd(), snapshot_id, paths }) {
  let root;
  try {
    root = await repoRoot(path.resolve(dir));
  } catch {
    return { target: dir, verdict: Verdict.INCONCLUSIVE, reason: "not a git repository", evidence: { path: dir } };
  }

  if (snapshot_id) {
    let snap;
    try {
      snap = JSON.parse(await readFile(path.join(elliotDir(), "snapshots", `${snapshot_id}.json`), "utf8"));
    } catch {
      return { target: root, verdict: Verdict.INCONCLUSIVE, reason: `snapshot ${snapshot_id} not found`, evidence: {} };
    }
    const now = await fingerprint(root);
    const d = diff(snap.hashes, now.hashes, paths);
    const total = d.added.length + d.removed.length + d.modified.length;
    const evidence = {
      since: snap.taken_at,
      head_before: snap.head,
      head_after: now.head,
      new_commits: snap.head !== now.head,
      files_changed: total,
      added: d.added.slice(0, 200),
      removed: d.removed.slice(0, 200),
      modified: d.modified.slice(0, 200),
      scope: paths?.length ? paths : "whole repository",
    };
    return {
      target: root,
      verdict: total > 0 ? Verdict.VERIFIED : Verdict.NOT_VERIFIED,
      reason: total > 0 ? `${total} file(s) changed since the snapshot` : "0 files changed since the snapshot",
      evidence,
    };
  }

  // No snapshot: uncommitted changes against HEAD.
  const status = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const entries = status.split("\0").filter(Boolean)
    .map((e) => ({ code: e.slice(0, 2), file: e.slice(3) }))
    .filter((e) => !e.file.startsWith(".elliot/"))
    .filter((e) => !paths?.length || paths.some((p) => e.file === p || e.file.startsWith(p.replace(/\/?$/, "/"))));
  const evidence = {
    compared_to: "HEAD (no snapshot given)",
    files_changed: entries.length,
    files: entries.slice(0, 200).map((e) => `${e.code.trim() || "?"} ${e.file}`),
    note: "Without a snapshot, committed work is invisible here. Take elliot_snapshot before the task for a reliable check.",
  };
  return {
    target: root,
    verdict: entries.length > 0 ? Verdict.VERIFIED : Verdict.NOT_VERIFIED,
    reason: entries.length > 0 ? `${entries.length} uncommitted file change(s)` : "0 files changed (working tree is identical to HEAD)",
    evidence,
  };
}
