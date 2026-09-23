import { createHash } from "node:crypto";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function buildProtocolLock({ report, treeEntries = [], readme, makefile, dependencyFile, dependencyVersions,
  pythonVersionFile, pythonVersionResult, seedConfiguration }) {
  const blobs = new Map(treeEntries.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry]));
  const sourcePaths = new Set([readme, makefile, dependencyFile, pythonVersionFile,
    ...(report.entrypoints ?? []).flatMap((entry) => entry.references ?? []).filter((item) => item.exists).map((item) => item.path),
    ...(report.evaluationDraft?.paths ?? []).flatMap((item) => item.matches ?? [])].filter(Boolean));
  const sourceFiles = [...sourcePaths].sort().flatMap((path) => {
    const blob = blobs.get(path);
    return blob ? [{ path, gitBlobSha: blob.sha, size: blob.size }] : [];
  });
  const declaredAssets = (report.evaluationDraft?.paths ?? []).map((item) => ({ kind: item.kind, declaredPath: item.path,
    evidence: item.evidence, matches: item.matches.map((path) => {
      const blob = blobs.get(path);
      return { path, ...(blob ? { gitBlobSha: blob.sha, size: blob.size } : {}) };
    }), status: item.matches.length ? "PINNED_TO_COMMIT" : item.kind === "data-or-output" ? "ROLE_UNRESOLVED" : "MISSING_OR_EXTERNAL" }));
  const dependencyLocked = !!dependencyVersions && (dependencyVersions.lockFile
    || dependencyVersions.verifiable && dependencyVersions.total > 0 && dependencyVersions.unpinned.length === 0);
  const readyAdapters = (report.paperWorkflowDraft?.adapters ?? []).filter((adapter) => adapter.status === "NEEDS_REVIEW");
  const gaps = [];
  if (report.paperProvenance?.sources.length !== 1) gaps.push("one selected paper source");
  if (!readyAdapters.length) gaps.push("source-validated paper workflow adapter");
  if (!pythonVersionResult?.exact) gaps.push("exact Python version");
  if (!dependencyLocked) gaps.push("locked or exactly pinned dependencies");
  if (declaredAssets.some((item) => item.status === "MISSING_OR_EXTERNAL")) gaps.push("missing/external config or checkpoint assets");
  if (declaredAssets.some((item) => item.status === "ROLE_UNRESOLVED")) gaps.push("data/output path role review");
  if (readyAdapters.length && !seedConfiguration) gaps.push("random seed evidence or an explicit deterministic-protocol review");
  const manifest = { schemaVersion: 1, repository: report.repository, commit: report.commit,
    paperSources: report.paperProvenance?.sources ?? [], claims: (report.evaluationDraft?.references ?? []).map(({ id, metricKey, label, value, unit, evidence }) => ({ id, metricKey, label, value, unit, evidence })),
    adapters: readyAdapters, environment: { python: pythonVersionResult ?? null, pythonFile: pythonVersionFile ?? null,
      dependencies: dependencyVersions ?? null, dependencyFile: dependencyFile ?? null, dependencyLocked },
    sourceFiles, declaredAssets, seedEvidence: seedConfiguration ?? null, parameters: report.experimentParameters ?? [] };
  return { ...manifest, lockId: createHash("sha256").update(canonical(manifest)).digest("hex"),
    status: gaps.length ? "INCOMPLETE" : "READY_FOR_REVIEW", gaps,
    warnings: ["Git blob hashes pin repository files to the scanned commit; runtime downloads still need independent SHA-256 identities.",
      "A protocol lock records declared evidence and does not prove that the paper protocol is scientifically equivalent."] };
}

export function verifyProtocolLock(report, lockId) {
  if (!/^[a-f\d]{64}$/.test(lockId) || report.protocolLock?.lockId !== lockId) throw new Error("Protocol lock does not match this scanned report");
  return report.protocolLock;
}
