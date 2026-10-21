import assert from "node:assert/strict";
import { buildPaperWorkflowDraft } from "./paper-workflow.mjs";
import { scan } from "./scan.mjs";
import { buildPreflight, validateExecutionOptions } from "./runner.mjs";

const hint = (line, command) => ({ id: `paper-workflow-${line}`, command, evidence: { file: "README.md", line } });
const makefileText = "setup:\n\tpython -m venv .venv\ndependency:\n\tpip install -r requirements.txt\ndata-public:\n\tpython data.py\ntest:\n\tpython -m pytest\nrun:\n\tpython run.py\nrun-cpu:\n\tpython run.py --cpu\nverify:\n\tpython verify.py\n";
const provenance = { workflowHints: [{ ...hint(7, "make setup"), role: "setup" }, { ...hint(8, "make dependency"), role: "setup" },
  { ...hint(9, "make data-public"), role: "prepare" }, hint(10, "make test"), hint(11, "make run"), hint(12, "make run-cpu"), hint(13, "make verify")] };
const draft = buildPaperWorkflowDraft({ provenance, makefile: "Makefile", makefileText, filePaths: [] });
assert.equal(draft.status, "NEEDS_REVIEW");
assert.equal(draft.adapters.length, 2);
assert.deepEqual(draft.adapters[0].steps.map(({ role, command, supported }) => [role, command, supported]), [
  ["setup", "make setup", true], ["setup", "make dependency", true], ["prepare", "make data-public", true],
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

const originalFetch = globalThis.fetch;
async function scanFixture(files) {
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname;
    if (path.includes("/contents/")) {
      const file = decodeURIComponent(path.split("/contents/")[1]);
      assert.ok(Object.hasOwn(files, file), file);
      return Response.json({ content: Buffer.from(files[file]).toString("base64") });
    }
    if (path.includes("/commits/")) return Response.json({ sha: "a".repeat(40), commit: { tree: { sha: "b".repeat(40) } } });
    if (path.includes("/git/trees/")) return Response.json({ tree: Object.keys(files).map((path) => ({ path, type: "blob", sha: "c".repeat(40) })), truncated: false });
    return Response.json({ default_branch: "main" });
  };
  return scan("https://github.com/example/research");
}
try {
  const files = { "README.md": "# Installation\nmake setup\nmake dependency\n# Prepare data\nmake data-public\n# Reproduce results\nmake test\nmake run\nmake run-cpu\nmake verify\n", "Makefile": makefileText };
  const report = await scanFixture(files);
  for (const id of ["install_command", "run_command", "command_references", "tests"]) assert.equal(report.checks.find((check) => check.id === id).status, "PASS", id);
  assert.equal(report.reproductionPlan.steps.find((step) => step.id === "install").command, "make setup && make dependency");
  assert.ok(!report.reproductionPlan.gaps.some((gap) => ["install", "run"].includes(gap.step)));
  const entry = report.quickEntries.find((entry) => entry.id === report.recommendedQuickEntryId);
  assert.equal(entry.command, "make test");
  assert.equal(report.quickEntries.length, 3);
  assert.throws(() => buildPreflight(report, "quick", { available: true }), /Choose/);
  const preview = buildPreflight(report, "quick", { available: true }, "readme", { quickEntryId: entry.id });
  assert.equal(preview.runnable, true);
  assert.deepEqual(preview.automatedSteps.map((step) => step.command), ["make setup", "make dependency", "make data-public", "make test"]);
  assert.throws(() => buildPreflight(report, "quick", { available: true }, "readme", { quickEntryId: "unknown" }), /Select/);
  assert.throws(() => buildPreflight(report, "training", { available: true }, "readme", { quickEntryId: entry.id }), /Select/);
  assert.throws(() => validateExecutionOptions({ quickEntryId: entry.id, benchmarkId: "bthowen-iris" }), /mixed/);
  const alternatives = await scanFixture({ ...files, "README.md": files["README.md"].replace("make test\n", "") });
  assert.equal(alternatives.recommendedQuickEntryId, null);
  assert.equal(alternatives.quickEntries.length, 2);
  const missing = await scanFixture({ ...files, "Makefile": makefileText.replace("run-cpu:", "other:").replace("setup:", "missing-setup:") });
  assert.ok(!missing.quickEntries.some((entry) => entry.command === "make run-cpu"));
  assert.equal(missing.recommendedQuickEntryId, null);
  assert.equal(buildPreflight(missing, "quick", { available: true }, "readme", { quickEntryId: missing.quickEntries[0].id }).runnable, false);
  const pythonReport = await scanFixture({ "README.md": "# Install\npip install -r requirements.txt\n# Usage\npython run.py\npython other.py\n", "requirements.txt": "numpy==1.26.4", "run.py": "", "other.py": "" });
  assert.equal(pythonReport.quickEntries.length, 2);
  assert.equal(pythonReport.recommendedQuickEntryId, null);
  const pythonPreview = buildPreflight(pythonReport, "quick", { available: true }, "readme", { quickEntryId: pythonReport.quickEntries[1].id });
  assert.equal(pythonPreview.automatedSteps.at(-1).command, "python other.py");
  const unknown = await scanFixture({ "README.md": "# Usage\n./custom-runner\n" });
  assert.equal(unknown.quickEntries.length, 0);
  assert.match(unknown.checks.find((check) => check.id === "run_command").message, /not automatically recognized/);
  const noReadme = await scanFixture({});
  assert.equal(noReadme.quickEntries.length, 0);
  assert.equal(report.summary.warnings, report.checks.filter((check) => check.status === "WARN").length);
} finally { globalThis.fetch = originalFetch; }
console.log("PASS  consistent Python/Make findings, explicit Quick choice, source revalidation and unsupported-entry fallback");
