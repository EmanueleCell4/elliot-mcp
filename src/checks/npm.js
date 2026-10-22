// "I published the package" -> does the npm registry actually have it?

import { Verdict } from "../receipt.js";
import { fetchWithTimeout, describeError } from "../http.js";

const REGISTRY = process.env.ELLIOT_NPM_REGISTRY || "https://registry.npmjs.org";

export async function checkNpm({ name, version, published_after }) {
  const target = version ? `${name}@${version}` : name;
  const url = `${REGISTRY}/${name.startsWith("@") ? "@" + encodeURIComponent(name.slice(1)) : encodeURIComponent(name)}`;
  let res;
  try {
    res = await fetchWithTimeout(url, { headers: { accept: "application/json" } });
  } catch (err) {
    return {
      target,
      verdict: Verdict.INCONCLUSIVE,
      reason: `registry not reachable: ${describeError(err)}`,
      evidence: { registry: REGISTRY, error: describeError(err) },
    };
  }

  if (res.status === 404) {
    return {
      target,
      verdict: Verdict.NOT_VERIFIED,
      reason: `package "${name}" does not exist on the registry`,
      evidence: { registry: REGISTRY, status: 404 },
    };
  }
  if (!res.ok) {
    return {
      target,
      verdict: Verdict.INCONCLUSIVE,
      reason: `registry answered ${res.status}`,
      evidence: { registry: REGISTRY, status: res.status },
    };
  }

  const doc = await res.json();
  const latest = doc["dist-tags"]?.latest ?? null;
  const want = version || latest;
  const exists = Boolean(want && doc.versions?.[want]);
  const publishedAt = want ? doc.time?.[want] ?? null : null;
  const evidence = {
    registry: REGISTRY,
    latest,
    version_checked: want,
    version_exists: exists,
    published_at: publishedAt,
    tarball: exists ? doc.versions[want].dist?.tarball ?? null : null,
  };

  if (!exists) {
    return {
      target,
      verdict: Verdict.NOT_VERIFIED,
      reason: `version ${want} is not on the registry (latest is ${latest})`,
      evidence,
    };
  }
  if (published_after && publishedAt && new Date(publishedAt) < new Date(published_after)) {
    evidence.published_after = published_after;
    return {
      target,
      verdict: Verdict.NOT_VERIFIED,
      reason: `${name}@${want} exists but was published at ${publishedAt}, before ${published_after}`,
      evidence,
    };
  }
  return {
    target,
    verdict: Verdict.VERIFIED,
    reason: `${name}@${want} is on the registry (published ${publishedAt})`,
    evidence,
  };
}
