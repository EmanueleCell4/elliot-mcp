// Small fetch wrappers with hard timeouts.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const USER_AGENT = "elliot-mcp (+https://github.com/EmanueleCell4/elliot-mcp)";

export async function fetchWithTimeout(url, { timeoutMs = 10_000, headers = {}, ...rest } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      ...rest,
      headers: { "user-agent": USER_AGENT, ...headers },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Addresses a checker must not be pointed at by an untrusted argument: loopback, private
// networks, link-local (cloud metadata lives at 169.254.169.254) and the unspecified address.
function privateAddress(ip) {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const x = ip.toLowerCase();
  return x === "::" || x === "::1" || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("fc") || x.startsWith("fd");
}

async function assertPublic(u) {
  if (process.env.ELLIOT_ALLOW_PRIVATE_URLS === "1") return;
  if (!/^https?:$/.test(u.protocol)) throw new Error(`only http and https URLs are checked, not ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.localhost|metadata\.google\.internal)$/i.test(host)) throw new Error(`${host} is a local address; set ELLIOT_ALLOW_PRIVATE_URLS=1 to check local servers`);
  let addrs = [];
  if (isIP(host)) addrs = [host];
  else { try { addrs = (await lookup(host, { all: true })).map((a) => a.address); } catch { return; /* unresolvable: fetch reports it */ } }
  const bad = addrs.find(privateAddress);
  if (bad) throw new Error(`${host} resolves to a private or local address (${bad}); set ELLIOT_ALLOW_PRIVATE_URLS=1 to check local servers`);
}

/**
 * Fetch an untrusted URL: every redirect hop is checked against private addresses, and one
 * deadline covers connecting, redirects and reading the body, which stops at maxBytes.
 */
export async function fetchCapped(url, { timeoutMs = 15_000, maxBytes = 2 * 1024 * 1024, maxRedirects = 5 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = new URL(url);
    let res;
    for (let hop = 0; ; hop++) {
      await assertPublic(current);
      res = await fetch(current.href, { redirect: "manual", headers: { "user-agent": USER_AGENT }, signal: controller.signal });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        if (hop >= maxRedirects) throw new Error(`more than ${maxRedirects} redirects`);
        await res.body?.cancel().catch(() => {});
        current = new URL(loc, current);
        continue;
      }
      break;
    }
    const chunks = [];
    let bytes = 0, truncated = false;
    if (res.body) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (bytes + value.length > maxBytes) { chunks.push(value.subarray(0, maxBytes - bytes)); bytes = maxBytes; truncated = true; await reader.cancel().catch(() => {}); break; }
        chunks.push(value);
        bytes += value.length;
      }
    }
    return { res, finalUrl: current.href, body: Buffer.concat(chunks), truncated };
  } finally {
    clearTimeout(timer);
  }
}

export function describeError(err) {
  if (err?.name === "AbortError") return "timed out";
  const cause = err?.cause?.code || err?.cause?.message;
  return cause ? `${err.message} (${cause})` : String(err?.message || err);
}
