// action.yml is what GitHub parses when someone writes `uses: EmanueleCell4/elliot-mcp@vX`.
// If it is not valid YAML, every workflow that uses the Action fails before it runs,
// so these checks exist to keep that file loadable and complete.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(root, "action.yml"), "utf8");

// A minimal YAML reader for the subset action.yml uses: nested block mappings of
// scalars. It is deliberately strict about the one thing that silently breaks the
// file — a plain (unquoted) scalar containing ": ", which YAML reads as a new key.
function parseBlockMapping(text) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  const lines = text.split("\n");
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (line.startsWith("- ")) continue; // sequences: not checked here
    const colon = line.indexOf(":");
    assert.ok(colon > 0, `action.yml:${n + 1} is not a mapping entry: ${line}`);
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (value === "") {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
      continue;
    }
    const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    assert.ok(
      quoted || !/:\s/.test(value),
      `action.yml:${n + 1}: the value of "${key}" contains ": " but is not quoted, which makes the file invalid YAML. Wrap it in double quotes.`,
    );
    parent[key] = quoted ? value.slice(1, -1) : value;
  }
  return root;
}

test("action.yml is valid YAML for GitHub", () => {
  const doc = parseBlockMapping(source);
  assert.equal(typeof doc.name, "string");
  assert.equal(typeof doc.description, "string");
  assert.ok(doc.runs, "action.yml must declare runs");
});

test("action.yml carries the metadata the Marketplace listing needs", () => {
  const doc = parseBlockMapping(source);
  assert.ok(doc.name.length > 0 && doc.name.length <= 80, "name must be present and short enough to list");
  // GitHub refuses a Marketplace listing whose description reaches 125 characters.
  assert.ok(doc.description.length > 0 && doc.description.length < 125, `description must be present and under 125 characters for the Marketplace (currently ${doc.description.length})`);
  assert.ok(doc.branding && doc.branding.icon && doc.branding.color, "the Marketplace listing needs branding.icon and branding.color");
  // GitHub accepts only this set of branding colours.
  assert.ok(["white", "yellow", "blue", "green", "orange", "red", "purple", "gray-dark"].includes(doc.branding.color), `unsupported branding colour: ${doc.branding.color}`);
});

test("every documented input of the Action is declared", () => {
  const doc = parseBlockMapping(source);
  for (const key of ["mode", "anthropic_api_key", "github_token"]) {
    assert.ok(doc.inputs && doc.inputs[key], `action.yml must declare the input ${key}`);
  }
  assert.equal(doc.inputs.mode.default, "report", "the Action must default to the non-blocking report mode");
  assert.equal(doc.inputs.anthropic_api_key.required, "true", "the API key must be declared required");
});
