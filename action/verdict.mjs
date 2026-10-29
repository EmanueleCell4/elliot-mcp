// Deterministic PR status computation. Unknown or incomplete evidence is never a pass.
export function verdictFor(t) {
  if (!t || !Number.isSafeInteger(t.claims) || t.claims < 0) return "inconclusive";
  const fields = ["VERIFIED", "PARTIAL", "FALSE", "UNVERIFIABLE", "behaviors"];
  const n = {};
  for (const f of fields) {
    const value = t[f] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0) return "inconclusive";
    n[f] = value;
  }
  if (t.claims === 0) return n.behaviors ? "findings" : "skipped";
  if (n.VERIFIED + n.PARTIAL + n.FALSE + n.UNVERIFIABLE !== t.claims) return "inconclusive";
  if (n.FALSE || n.PARTIAL || n.behaviors) return "findings";
  if (n.UNVERIFIABLE) return "inconclusive";
  return "pass";
}
