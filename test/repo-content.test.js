// v0.7.2 shipped with README.md and examples/workflows/elliot-strict.yml truncated
// to zero bytes. Nothing failed: the repository front page and the copy-paste
// workflow were empty for everyone who arrived, and the build stayed green.
// These checks make a file that readers depend on fail the build when it is emptied.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// path -> the smallest size that is still a real document rather than a stub.
const DOCUMENTS = {
  "README.md": 2000,
  "LICENSE": 200,
  "action.yml": 500,
};

for (const [path, minBytes] of Object.entries(DOCUMENTS)) {
  test(`${path} is present and not truncated`, () => {
    let size;
    try {
      size = statSync(join(root, path)).size;
    } catch {
      assert.fail(`${path} is missing; readers and the Marketplace listing depend on it`);
    }
    assert.ok(size >= minBytes, `${path} is ${size} bytes, below the ${minBytes} expected for a complete file`);
  });
}

test("README documents how to use the Action and points at a version that exists", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const refs = [...readme.matchAll(/EmanueleCell4\/elliot-mcp@v([\d.]+)/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, "README must show at least one `uses: EmanueleCell4/elliot-mcp@vX` line");
  for (const ref of refs) {
    assert.equal(ref, pkg.version, `README points at v${ref} but this release is v${pkg.version}`);
  }
});

test("every example workflow is a complete, runnable workflow", () => {
  const dir = join(root, "examples", "workflows");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  assert.ok(files.length > 0, "examples/workflows must contain at least one workflow to copy");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const file of files) {
    const source = readFileSync(join(dir, file), "utf8");
    assert.ok(source.length >= 300, `examples/workflows/${file} is ${source.length} bytes, too short to be a usable workflow`);
    assert.ok(/^name:\s*\S/m.test(source), `examples/workflows/${file} has no name:`);
    assert.ok(/^on:/m.test(source), `examples/workflows/${file} has no on: trigger`);
    assert.ok(/^jobs:/m.test(source), `examples/workflows/${file} has no jobs:`);
    for (const [, ref] of source.matchAll(/EmanueleCell4\/elliot-mcp@v([\d.]+)/g)) {
      assert.equal(ref, pkg.version, `examples/workflows/${file} points at v${ref} but this release is v${pkg.version}`);
    }
  }
});
