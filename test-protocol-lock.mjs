import assert from "node:assert/strict";
import { buildProtocolLock, verifyProtocolLock } from "./protocol-lock.mjs";

const blob = (path, sha) => ({ path, sha: sha.repeat(40).slice(0, 40), size: path.length, type: "blob" });
const report = { repository: "owner/paper", commit: "a".repeat(40),
  entrypoints: [{ references: [{ path: "eval.py", exists: true }] }], experimentParameters: [{ name: "seed", value: "42", file: "eval.py", line: 3 }],
  paperProvenance: { sources: [{ id: "doi:10.1/example", provider: "DOI", url: "https://doi.org/10.1/example", evidence: { file: "README.md", line: 2 } }] },
  paperWorkflowDraft: { adapters: [{ id: "adapter-1", status: "NEEDS_REVIEW", steps: [{ command: "make run" }] }] },
  evaluationDraft: { references: [{ id: "reference-1", metricKey: "accuracy", label: "Iris", value: 0.98, unit: "as printed (no conversion)", evidence: { file: "README.md", line: 20 } }],
    paths: [{ kind: "config", path: "config.json", matches: ["config.json"], evidence: { file: "eval.py", line: 4 } }] } };
const input = { report, treeEntries: [blob("README.md", "1"), blob("Makefile", "2"), blob("requirements.txt", "3"), blob(".python-version", "4"), blob("eval.py", "5"), blob("config.json", "6")],
  readme: "README.md", makefile: "Makefile", dependencyFile: "requirements.txt", dependencyVersions: { verifiable: true, lockFile: false, total: 2, unpinned: [] },
  pythonVersionFile: ".python-version", pythonVersionResult: { exact: true, value: "3.11.9" }, seedConfiguration: { file: "eval.py", line: 3, text: "seed=42" } };
const lock = buildProtocolLock(input);
assert.equal(lock.status, "READY_FOR_REVIEW");
assert.match(lock.lockId, /^[a-f\d]{64}$/);
assert.deepEqual(lock.sourceFiles.map((item) => item.path), [".python-version", "Makefile", "README.md", "config.json", "eval.py", "requirements.txt"]);
assert.equal(buildProtocolLock({ ...input, treeEntries: [...input.treeEntries].reverse() }).lockId, lock.lockId, "Tree order must not change the lock");
assert.notEqual(buildProtocolLock({ ...input, report: { ...report, evaluationDraft: { ...report.evaluationDraft,
  references: [{ ...report.evaluationDraft.references[0], value: 0.97 }] } } }).lockId, lock.lockId, "Claim changes must change the lock");
assert.equal(verifyProtocolLock({ protocolLock: lock }, lock.lockId), lock);
assert.throws(() => verifyProtocolLock({ protocolLock: lock }, "0".repeat(64)), /does not match/);
const incomplete = buildProtocolLock({ ...input, dependencyVersions: { verifiable: true, lockFile: false, total: 1, unpinned: ["numpy"] },
  pythonVersionResult: { exact: false, value: ">=3.10" }, seedConfiguration: null, report: { ...report, evaluationDraft: { ...report.evaluationDraft,
    paths: [{ kind: "checkpoint", path: "model.pt", matches: [], evidence: { file: "eval.py", line: 8 } }] } } });
assert.equal(incomplete.status, "INCOMPLETE");
assert.ok(incomplete.gaps.includes("missing/external config or checkpoint assets"));
console.log("PASS  deterministic protocol locks, source identities and unresolved asset gates");
