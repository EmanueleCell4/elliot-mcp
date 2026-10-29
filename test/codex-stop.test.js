import { test } from "node:test";
import assert from "node:assert/strict";
import { needsChangeProof, decisionFromVerdict, check } from "../codex/stop-hook.mjs";

test("only evaluates direct working-tree change claims", () => {
  assert.equal(needsChangeProof("I have modified the files"), true);
  assert.equal(needsChangeProof("I edited the code"), true);
  assert.equal(needsChangeProof("Tests passed"), false);
  assert.equal(needsChangeProof("The PR was merged"), false);
});
test("verified changes do not assert test success", () => {
  assert.match(decisionFromVerdict("VERIFIED").systemMessage, /does not establish correctness/);
});
test("unverified changes block once; no stop-hook loop", () => {
  assert.equal(decisionFromVerdict("NOT_VERIFIED").decision, "block");
  assert.equal(decisionFromVerdict("INCONCLUSIVE", true).decision, undefined);
});
test("calls actual MCP API shape and uses receipt verdict, not prose", async () => {
  let closed = false;
  const fake = {callTool: async ({name}) => {
    assert.equal(name, "verify_changes");
    return { content: [{text: "Looked good"}, {text: JSON.stringify({verdict:"NOT_VERIFIED"})}] };
  }, close: async () => { closed = true; }};
  const result = await check({hook_event_name:"Stop",cwd:".",last_assistant_message:"I modified the code",stop_hook_active:false}, async()=>fake);
  assert.equal(result.decision,"block");
  assert.equal(closed,true);
});
test("non-Stop events do not call verifier", async () => {
  const result = await check({hook_event_name:"SessionEnd",last_assistant_message:"I modified the code"}, async()=>{throw Error("must not run");});
  assert.deepEqual(result,{});
});
