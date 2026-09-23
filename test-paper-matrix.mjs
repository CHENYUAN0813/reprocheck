import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { buildPaperMatrixDraft, buildPaperMatrixExecution } from "./paper-matrix.mjs";

const adapter = { id: "paper-adapter-1", status: "NEEDS_REVIEW", steps: [{ id: "experiment-1", role: "experiment", command: "make run", supported: true }] };
const report = { paperWorkflowDraft: { adapters: [adapter] }, protocolLock: { lockId: "a".repeat(64), status: "INCOMPLETE", gaps: ["exact Python version"] },
  evaluationDraft: { references: [
    { id: "reference-1", label: "Beauty · SASRec · NDCG@10", metricKey: "ndcg_10", value: 0.31, precision: 2, unit: "as printed", evidence: { file: "README.md", line: 20 } },
    { id: "reference-2", label: "Beauty · ESASRec · NDCG@10", metricKey: "ndcg_10", value: 0.34, precision: 2, unit: "as printed", evidence: { file: "README.md", line: 21 } },
    { id: "reference-3", label: "Games · SASRec · NDCG@10", metricKey: "ndcg_10", value: 0.29, precision: 2, unit: "as printed", evidence: { file: "README.md", line: 22 } },
  ] } };
const draft = buildPaperMatrixDraft(report);
assert.equal(draft.status, "NEEDS_REVIEW");
assert.deepEqual(draft.axes, { datasets: ["Beauty", "Games"], models: ["SASRec", "ESASRec"], seeds: [], metrics: ["ndcg_10"] });
const input = { adapterId: adapter.id, protocolLockId: report.protocolLock.lockId, outputFile: "results/table1.csv", rowKey: "dataset",
  metricTolerance: 0.001, confirmed: true, acknowledgedGaps: report.protocolLock.gaps };
const execution = buildPaperMatrixExecution(report, input);
assert.equal(execution.cells.length, 3);
assert.equal(execution.adapter.steps[0].command, "make run");
assert.throws(() => buildPaperMatrixExecution(report, { ...input, acknowledgedGaps: [] }), /gap/);
assert.throws(() => buildPaperMatrixExecution(report, { ...input, outputFile: "../table.csv" }), /relative CSV/);
console.log("PASS  paper result matrices, reviewed adapters and protocol-gap acknowledgement");

if (process.argv.includes("--docker")) {
  const collector = readFileSync(new URL("./collect-evidence.py", import.meta.url), "utf8");
  const probeOptions = { outputFile: "results/table1.csv", paperMatrixExecution: execution };
  const probe = `import json,pathlib,sys\npathlib.Path('/workspace/results').mkdir(parents=True)\ncollector=${JSON.stringify(collector)}\noptions=${JSON.stringify(JSON.stringify(probeOptions))}\nsys.argv=['collector',options,'start'];exec(collector,{})\npathlib.Path('/workspace/results/table1.csv').write_text('dataset,sasrec,esasrec\\nbeauty,0.3104,0.3402\\ngames,0.2896,0.1\\n')\nsys.argv=['collector',options,'finish'];exec(collector,{})`;
  const { stdout } = await promisify(execFile)("docker", ["run", "--rm", "--pull", "never", "--network", "none", "python:3.11", "python", "-c", probe], { timeout: 30_000, windowsHide: true });
  const evidence = JSON.parse(stdout.split("\n").find((line) => line.startsWith("::reprocheck-evidence::")).split("::reprocheck-evidence::")[1]);
  assert.deepEqual(evidence.matrix.summary, { total: 3, matched: 3, outside: 0, missing: 0 });
  assert.equal(evidence.matrix.cells[1].csvColumn, "esasrec");
  assert.equal(evidence.matrix.cells[2].compared, 0.29);
  console.log("PASS  container collector maps CSV labels and compares every rounded paper cell");
}
