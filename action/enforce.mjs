// The composite action is non-blocking by default. Strict mode requires a verified result.
import { fileURLToPath } from "node:url";

export function enforcement(mode, verdict) {
  if (!["report", "strict"].includes(mode)) return { ok: false, message: "Invalid ELLIOT mode: " + mode };
  if (mode === "report") return { ok: true, message: "ELLIOT report-only: " + (verdict || "missing") };
  if (verdict !== "pass") return { ok: false, message: "ELLIOT strict mode rejected " + (verdict || "missing") + ": evidence must be fully verified" };
  return { ok: true, message: "ELLIOT strict mode: all reported claims verified" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = enforcement(process.env.ELLIOT_MODE ?? "report", process.env.ELLIOT_VERDICT ?? "");
  (result.ok ? console.log : console.error)(result.message);
  if (!result.ok) process.exitCode = 1;
}
