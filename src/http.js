// Small fetch wrapper with a hard timeout.

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

export function describeError(err) {
  if (err?.name === "AbortError") return "timed out";
  const cause = err?.cause?.code || err?.cause?.message;
  return cause ? `${err.message} (${cause})` : String(err?.message || err);
}
