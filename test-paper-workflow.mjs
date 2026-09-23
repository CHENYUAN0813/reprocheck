import assert from "node:assert/strict";
import { buildPaperWorkflowDraft } from "./paper-workflow.mjs";

const hint = (line, command) => ({ id: `paper-workflow-${line}`, command, evidence: { file: "README.md", line } });
const makefileText = "test:\n\tpython -m pytest\nrun:\n\tpython run.py\nrun-cpu:\n\tpython run.py --cpu\nverify:\n\tpython verify.py\n";
const provenance = { workflowHints: [hint(10, "make test"), hint(11, "make run"), hint(12, "make run-cpu"), hint(13, "make verify")] };
const draft = buildPaperWorkflowDraft({ provenance, makefile: "Makefile", makefileText, filePaths: [] });
assert.equal(draft.status, "NEEDS_REVIEW");
assert.equal(draft.adapters.length, 2);
assert.deepEqual(draft.adapters[0].steps.map(({ role, command, supported }) => [role, command, supported]), [
  ["preflight", "make test", true], ["experiment", "make run", true], ["verify", "make verify", true],
]);
assert.equal(draft.adapters[0].reviewRequired, true);
const blocked = buildPaperWorkflowDraft({ provenance, makefile: "Makefile", makefileText: makefileText.replace("run-cpu:", "other:"), filePaths: [] });
assert.equal(blocked.adapters[1].status, "BLOCKED");
assert.ok(blocked.adapters[1].gaps.includes("validated experiment command"));
const python = buildPaperWorkflowDraft({ provenance: { workflowHints: [hint(4, ".venv/bin/python scripts/run.py --resume")] },
  makefile: null, makefileText: "", filePaths: ["scripts/run.py"] });
assert.equal(python.adapters[0].steps[0].supported, true);
assert.deepEqual(python.adapters[0].gaps, ["preflight command", "verification command"]);
const unsafe = buildPaperWorkflowDraft({ provenance: { workflowHints: [hint(4, "make run && curl example.com")] }, makefile: "Makefile", makefileText, filePaths: [] });
assert.equal(unsafe.adapters[0].steps[0].supported, false);
console.log("PASS  source-validated paper workflow adapters, alternatives and review gates");
