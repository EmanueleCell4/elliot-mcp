// "It's deployed" / "the page is live" -> is the URL actually serving what was claimed?

import { createHash } from "node:crypto";
import { Verdict } from "../receipt.js";
import { fetchWithTimeout, describeError } from "../http.js";

const MAX_BODY = 2 * 1024 * 1024;

export async function checkUrl({ url, expect_status = 200, expect_text }) {
  const started = Date.now();
  let res;
  try {
    res = await fetchWithTimeout(url, { timeoutMs: 15_000 });
  } catch (err) {
    return {
      target: url,
      verdict: Verdict.NOT_VERIFIED,
      reason: `URL not reachable from the checker: ${describeError(err)}`,
      evidence: { url, error: describeError(err) },
    };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const body = buf.subarray(0, MAX_BODY);
  const text = body.toString("utf8");
  const evidence = {
    url,
    final_url: res.url,
    status: res.status,
    expected_status: expect_status,
    content_type: res.headers.get("content-type"),
    bytes: buf.length,
    body_sha256: createHash("sha256").update(body).digest("hex"),
    response_ms: Date.now() - started,
  };

  const problems = [];
  if (res.status !== expect_status) problems.push(`status ${res.status}, expected ${expect_status}`);
  if (expect_text !== undefined) {
    evidence.expected_text = expect_text;
    evidence.text_found = text.includes(expect_text);
    if (!evidence.text_found) problems.push(`expected text not found in the response`);
  }

  return {
    target: url,
    verdict: problems.length ? Verdict.NOT_VERIFIED : Verdict.VERIFIED,
    reason: problems.length
      ? problems.join("; ")
      : `responded ${res.status}${expect_text !== undefined ? " and contains the expected text" : ""}`,
    evidence,
  };
}
