import assert from "node:assert/strict";
import { buildDockerInvocation, buildPreflight, buildReplayPreflight, compareRuns, createRecipe, rewritePackageIndex, validateExecutionOptions, verifyOutcome } from "./runner.mjs";
import { getSavedRun, listSavedRuns, saveRun } from "./run-store.mjs";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

assert.throws(() => validateExecutionOptions({ outputFile: "../secret.json" }), /relative/);
assert.throws(() => validateExecutionOptions({ outputFile: "/tmp/output.json" }), /relative/);
assert.throws(() => validateExecutionOptions({ metricKey: "accuracy", metricTarget: 0.9 }), /Metric needs/);
assert.throws(() => rewritePackageIndex("pip install numpy && python demo.py", "pypi"), /shell chain/);
assert.equal(rewritePackageIndex("python -m pip install numpy --index-url=https://slow.example/simple", "pypi"), "python -m pip install numpy --index-url https://pypi.org/simple");
const sample = {
  status: "SUCCEEDED", steps: [{ id: "run" }],
  executionOptions: { expectedText: "ok", outputFile: "result.json", metricKey: "accuracy", metricTarget: 0.9 },
  log: '::reprocheck-step::install\nok\n::reprocheck-step::run\nok\n::reprocheck-evidence::{"artifact":{"fresh":true,"size":20},"metric":{"value":0.95}}\n',
};
assert.equal(verifyOutcome(sample).status, "VERIFIED");
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace("run\nok", "run\nwrong") }).status, "FAILED");
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace('"fresh":true', '"fresh":false') }).status, "FAILED");
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace('"value":0.95', '"value":0.5') }).status, "FAILED");
assert.equal(verifyOutcome({ ...sample, status: "FAILED" }).status, "INCOMPLETE");
assert.equal(verifyOutcome({ ...sample, executionOptions: {} }).status, "NOT_CONFIGURED");
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace('"value":0.95', '"value":1e400') }).status, "FAILED");
assert.equal(verifyOutcome({ ...sample, log: '::reprocheck-evidence::{"dependencies":{}}\n' }).status, "INCOMPLETE");
console.log("PASS  output verification self-test");

const evaluationContext = { dataset: "Synthetic held-out fixture", model: "Small CPU model", reference: "User-defined fixture target, not a paper benchmark", assetsInEntry: true };
const evaluationOptions = { ...sample.executionOptions, quickCommand: "python evaluate.py", metricOperator: "eq", metricTarget: 0.9, metricTolerance: 0.05, evaluation: evaluationContext };
assert.equal(verifyOutcome({ ...sample, executionOptions: evaluationOptions }).status, "VERIFIED");
assert.equal(verifyOutcome({ ...sample, executionOptions: { ...evaluationOptions, metricTolerance: 0.049 } }).status, "FAILED");
assert.equal(verifyOutcome({ ...sample, executionOptions: { ...evaluationOptions, metricTarget: 0.95, metricTolerance: 0 } }).status, "VERIFIED");
assert.equal(verifyOutcome({ ...sample, executionOptions: { ...evaluationOptions, metricTarget: 0.9500000000000001, metricTolerance: 0 } }).status, "FAILED");
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace('"value":0.95', '"value":-1.7976931348623157e308'),
  executionOptions: { ...evaluationOptions, metricTarget: Number.MAX_VALUE, metricTolerance: Number.MAX_VALUE } }).status, "FAILED");
assert.throws(() => validateExecutionOptions({ ...evaluationOptions, metricTolerance: -1 }), /non-negative/);
assert.throws(() => validateExecutionOptions({ ...evaluationOptions, metricTolerance: Infinity }), /non-negative/);
assert.throws(() => validateExecutionOptions({ ...evaluationOptions, evaluation: { ...evaluationContext, reference: " " } }), /reference source/);
const evaluationReport = { repository: "owner/repo", commit: "a".repeat(40),
  reproductionPlan: { steps: [{ id: "install", title: "Install", status: "DOCUMENTED", command: "pip install example" }, { id: "data", title: "Data", status: "MISSING" }, { id: "model", title: "Model", status: "MISSING" }] },
  workflows: [{ id: "evaluation", title: "Evaluation", status: "UNAVAILABLE", steps: [] }, { id: "training", title: "Training", steps: [{ id: "train", status: "DOCUMENTED", command: "python train.py" }] }] };
assert.throws(() => buildPreflight(evaluationReport, "evaluation", { available: true }), /Evaluation requires/);
const evaluationPreview = buildPreflight(evaluationReport, "evaluation", { available: true }, "readme", evaluationOptions);
assert.equal(evaluationPreview.runnable, true);
assert.equal(evaluationPreview.preparationOverride.originalSteps.length, 2);
assert.deepEqual(evaluationPreview.automatedSteps.map((step) => step.id), ["install", "evaluation-reviewed"]);
assert.equal(buildPreflight(evaluationReport, "evaluation", { available: true }, "readme", { ...evaluationOptions, evaluation: { ...evaluationContext, assetsInEntry: false } }).runnable, false);
assert.equal(buildPreflight(evaluationReport, "training", { available: true }).runnable, false);
console.log("PASS  Evaluation execution preview and reference tolerance self-test");

const matrixAdapter = { id: "paper-adapter-1", status: "NEEDS_REVIEW", steps: [
  { id: "setup-1", role: "setup", command: "make setup", supported: true },
  { id: "experiment-2", role: "experiment", command: "make run", supported: true },
  { id: "verify-3", role: "verify", command: "make verify", supported: true },
] };
const matrixReport = { repository: "owner/repo", commit: "a".repeat(40), workflows: [], paperWorkflowDraft: { adapters: [matrixAdapter] },
  protocolLock: { lockId: "d".repeat(64), gaps: [], status: "READY_FOR_REVIEW" }, evaluationDraft: { references: [
    { id: "reference-1", label: "Beauty · SASRec · NDCG@10", metricKey: "ndcg_10", value: 0.31, unit: "as printed", evidence: { file: "README.md", line: 20 } },
    { id: "reference-2", label: "Games · SASRec · NDCG@10", metricKey: "ndcg_10", value: 0.29, unit: "as printed", evidence: { file: "README.md", line: 21 } },
  ] } };
const matrixOptions = { paperMatrix: { adapterId: matrixAdapter.id, protocolLockId: matrixReport.protocolLock.lockId,
  outputFile: "results/table1.csv", rowKey: "dataset", metricTolerance: 0.001, confirmed: true, acknowledgedGaps: [] } };
const matrixPreview = buildPreflight(matrixReport, "paper-matrix", { available: true }, "readme", matrixOptions);
assert.equal(matrixPreview.runnable, true);
assert.deepEqual(matrixPreview.automatedSteps.map((step) => step.command), ["make setup", "make run", "make verify"]);
const matrixEvidence = { artifact: { fresh: true, size: 40 }, matrix: { summary: { total: 2, matched: 2, outside: 0, missing: 0 }, cells: [
  { id: "matrix-reference-1", observed: 0.31, target: 0.31, status: "MATCHED" },
  { id: "matrix-reference-2", observed: 0.29, target: 0.29, status: "MATCHED" },
] } };
const matrixJob = { status: "SUCCEEDED", steps: matrixPreview.automatedSteps, executionOptions: matrixPreview.executionOptions,
  paperMatrix: matrixPreview.paperMatrix, log: `::reprocheck-step::${matrixPreview.automatedSteps.at(-1).id}\n::reprocheck-evidence::${JSON.stringify(matrixEvidence)}\n` };
assert.equal(verifyOutcome(matrixJob).status, "VERIFIED");
assert.equal(verifyOutcome({ ...matrixJob, log: matrixJob.log.replace('"matched":2', '"matched":1').replace('"outside":0', '"outside":1') }).status, "FAILED");
console.log("PASS  reviewed paper matrix preflight and multi-cell verification self-test");

const frozen = { ...sample, id: randomUUID(), repository: "owner/repo", commit: "a".repeat(40), workflowId: "quick", packageIndex: "readme",
  steps: [{ id: "install", title: "Install", command: "pip install example==1.0" }, { id: "run", title: "Run", command: "python demo.py" }],
  environment: { imageId: `sha256:${"b".repeat(64)}`, python: "3.11.9", platform: "Linux-test", capture: "before-entry", unlockedDependencies: [] },
  dependencies: ["example==1.0", "pip==24.0"], artifact: { sha256: "c".repeat(64) }, metric: { value: 0.95 }, verification: verifyOutcome(sample),
  limits: { cpus: 2, memory: "2 GB", timeoutMinutes: 10, hostMounts: false, networkAccess: true, image: "python:3.11" },
};
const recipe = createRecipe(frozen);
const frozenMatrix = { ...frozen, workflowId: "paper-matrix", executionOptions: matrixPreview.executionOptions,
  paperMatrix: matrixPreview.paperMatrix, matrix: matrixEvidence.matrix, verification: verifyOutcome(matrixJob),
  steps: matrixPreview.automatedSteps.map(({ id, title, command }) => ({ id, title, command })) };
assert.equal(createRecipe(frozenMatrix).workflowId, "paper-matrix");
assert.equal(buildReplayPreflight(frozenMatrix, { available: true }, true).paperMatrix.cells.length, 2);
const frozenEvaluation = { ...frozen, workflowId: "evaluation", executionOptions: evaluationOptions, evaluation: { status: "MATCHED_REFERENCE" } };
assert.equal(createRecipe(frozenEvaluation).workflowId, "evaluation");
assert.equal(buildReplayPreflight(frozenEvaluation, { available: true }, true).workflow.id, "evaluation");
assert.match(recipe.fingerprint, /^[a-f\d]{64}$/);
assert.equal(recipe.fingerprint, createRecipe(frozen).fingerprint);
assert.equal(recipe.imageId, frozen.environment.imageId);
assert.deepEqual(recipe.executionOptions, validateExecutionOptions(sample.executionOptions));
assert.throws(() => createRecipe({ ...frozen, status: "FAILED" }), /Pass configured/);
assert.throws(() => createRecipe({ ...frozen, environment: { ...frozen.environment, imageId: "python:3.11" } }), /exact Docker/);
assert.throws(() => createRecipe({ ...frozen, environment: { ...frozen.environment, capture: "after-failure" } }), /pre-entry/);
assert.throws(() => createRecipe({ ...frozen, dependencies: ["pip==24.0\n--index-url evil"] }), /safely restored/);
assert.throws(() => createRecipe({ ...frozen, environment: { ...frozen.environment, unlockedDependencies: ["local-project"] } }), /artifact lock/);
const replayPreview = buildReplayPreflight(frozen, { available: true }, true);
assert.equal(replayPreview.runnable, true);
assert.equal(buildReplayPreflight(frozen, { available: true }, false).runnable, false);
const replayArgs = buildDockerInvocation(replayPreview, "reprocheck-test");
assert.ok(replayArgs.includes(frozen.environment.imageId));
assert.ok(replayArgs.includes("never"));
assert.match(replayArgs.at(-1), /PIP_CONSTRAINT/);
assert.match(replayArgs.at(-1), /example==1\.0/);
assert.equal(compareRuns(frozen, frozen).status, "SAME");
assert.equal(compareRuns(frozen, { ...frozen, artifact: { sha256: "d".repeat(64) }, metric: { value: 0.96 } }).status, "DIFFERENT");
assert.equal(compareRuns(frozen, { ...frozen, status: "FAILED" }).status, "INCOMPLETE");
assert.equal(compareRuns(frozen, { ...frozen, metric: null }).status, "INCOMPLETE");
assert.equal(compareRuns(frozen, { ...frozen, status: "RUNNING" }).status, "PENDING");
console.log("PASS  locked recipe and comparison self-test");

const directory = mkdtempSync(join(tmpdir(), "reprocheck-record-test-"));
try {
  const record = { ...sample, id: randomUUID(), repository: "owner/repo", commit: "a".repeat(40),
    startedAt: new Date().toISOString(), verification: verifyOutcome(sample) };
  saveRun(record, directory);
  assert.deepEqual(getSavedRun(record.id, directory), record);
  saveRun({ ...record, status: "RUNNING" }, directory);
  assert.equal(getSavedRun(record.id, directory).status, "INTERRUPTED");
  assert.equal(getSavedRun(record.id, directory).verification.status, "INCOMPLETE");
  saveRun({ ...record, status: "RUNNING", comparison: { status: "PENDING", baselineRunId: frozen.id, rows: [] } }, directory);
  assert.equal(getSavedRun(record.id, directory).comparison.status, "INCOMPLETE");
  saveRun({ ...record, status: "RUNNING", evaluation: { status: "PENDING" } }, directory);
  assert.equal(getSavedRun(record.id, directory).evaluation.status, "INCOMPLETE");
  assert.equal(getSavedRun("../../secret", directory), null);
  assert.throws(() => saveRun({ id: "../../secret" }, directory), /Invalid/);
  writeFileSync(join(directory, `${randomUUID()}.json`), "null");
  writeFileSync(join(directory, `${randomUUID()}.json`), "{broken");
  assert.equal(listSavedRuns(directory).length, 1);
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log("PASS  persistent run archive self-test");

// Opt-in integration check: executes a reviewed scalar-autodiff example in Docker.
// This is a smoke test, not reproduction of a paper's reported benchmark.
if (process.argv.includes("--docker")) {
  const base = process.env.REPROCHECK_TEST_URL ?? "http://127.0.0.1:5173";
  async function request(path, body) {
    const response = await fetch(`${base}${path}`, body ? {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    } : undefined);
    const result = await response.json();
    assert.equal(response.ok, true, JSON.stringify(result));
    return result;
  }
  const url = "https://github.com/karpathy/micrograd";
  const report = await request("/api/scan", { url });
  const executionOptions = {
    quickCommand: `python -c 'import json, pathlib, micrograd.engine; from micrograd.engine import Value; assert pathlib.Path(micrograd.engine.__file__).resolve().is_relative_to(pathlib.Path("/workspace")); a=Value(-4.0); b=Value(2.0); c=a*b+a; c.backward(); assert (c.data,a.grad,b.grad)==(-12.0,3.0,-4.0); json.dump({"value":c.data,"a_grad":a.grad,"b_grad":b.grad},open("repro-result.json","w")); print("autodiff-ok")'`,
    expectedText: "autodiff-ok", outputFile: "repro-result.json", metricKey: "a_grad", metricTarget: 3,
  };
  const input = { url, commit: report.commit, workflowId: "quick", packageIndex: "pypi", executionOptions };
  const preview = await request("/api/preflight", input);
  assert.equal(preview.runnable, true);
  assert.equal(preview.commandOverride.origin, "user-reviewed");
  async function execute(options, workflowId = "quick") {
    let job = await request("/api/run", { ...input, workflowId, executionOptions: options, confirmUnknownCode: true });
    const deadline = Date.now() + 120_000;
    while (job.status === "RUNNING" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      job = await request(`/api/runs/${job.id}`);
    }
    if (job.status === "RUNNING") {
      await fetch(`${base}/api/runs/${job.id}`, { method: "DELETE" });
      assert.fail("Integration run exceeded its test deadline and was cancelled");
    }
    return job;
  }
  const job = await execute(executionOptions);
  assert.equal(job.status, "SUCCEEDED", job.log);
  assert.match(job.log, /autodiff-ok/);
  assert.equal(job.verification.status, "VERIFIED", JSON.stringify(job.verification));
  assert.equal(job.verification.checks.length, 3);
  assert.equal(job.artifact.fresh, true);
  assert.match(job.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.match(job.environment.python, /^3\.11\./);
  assert.ok(job.dependencies.some((dependency) => dependency.startsWith("micrograd==")));
  console.log(`PASS  Micrograd scalar autodiff smoke test: ${job.id} @ ${job.commit}`);
  const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e",
    `import { getRun } from './runner.mjs'; console.log(JSON.stringify(getRun('${job.id}')));`], { windowsHide: true });
  const reloaded = JSON.parse(stdout);
  assert.equal(reloaded.status, "SUCCEEDED");
  assert.equal(reloaded.verification.status, "VERIFIED");
  assert.equal(reloaded.artifact.sha256, job.artifact.sha256);
  assert.ok((await request("/api/runs")).runs.some((record) => record.id === job.id));
  const attachment = await fetch(`${base}/api/runs/${job.id}?download=1`);
  assert.equal(attachment.status, 200);
  assert.match(attachment.headers.get("content-disposition"), /attachment; filename="reprocheck-run-/);
  assert.equal((await attachment.json()).id, job.id);
  console.log("PASS  completed evidence recovered from a new process");
  assert.equal(job.environment.capture, "before-entry");
  assert.ok(job.recipe, job.recipeUnavailableReason);
  const recipeDownload = await fetch(`${base}/api/runs/${job.id}/recipe?download=1`);
  assert.equal(recipeDownload.status, 200);
  assert.match(recipeDownload.headers.get("content-disposition"), /attachment/);
  const downloadedRecipe = await recipeDownload.json();
  assert.equal(downloadedRecipe.imageId, job.environment.imageId);
  assert.equal(downloadedRecipe.fingerprint, job.recipe.fingerprint);
  const frozenPreview = await request(`/api/runs/${job.id}/replay-preflight`, {});
  assert.equal(frozenPreview.runnable, true);
  const noConfirm = await fetch(`${base}/api/runs/${job.id}/replay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(noConfirm.status, 400);
  const changedRecipe = await fetch(`${base}/api/runs/${job.id}/replay`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmUnknownCode: true, recipeFingerprint: "changed" }) });
  assert.equal(changedRecipe.status, 409);
  const overrideRecipe = await fetch(`${base}/api/runs/${job.id}/replay`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmUnknownCode: true, quickCommand: "python changed.py" }) });
  assert.equal(overrideRecipe.status, 400);
  async function replayRecord(baselineJob) {
    let result = await request(`/api/runs/${baselineJob.id}/replay`, { confirmUnknownCode: true, recipeFingerprint: baselineJob.recipe.fingerprint });
    const deadline = Date.now() + 120_000;
    while (result.status === "RUNNING" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      result = await request(`/api/runs/${result.id}`);
    }
    if (result.status === "RUNNING") {
      await fetch(`${base}/api/runs/${result.id}`, { method: "DELETE" });
      assert.fail("Replay exceeded its test deadline and was cancelled");
    }
    return result;
  }
  const repeated = await replayRecord(job);
  assert.equal(repeated.status, "SUCCEEDED", repeated.log);
  assert.equal(repeated.verification.status, "VERIFIED");
  assert.equal(repeated.replayOf, job.id);
  assert.equal(repeated.environment.imageId, job.environment.imageId);
  assert.deepEqual(repeated.dependencies, job.dependencies);
  assert.equal(repeated.comparison.status, "SAME", JSON.stringify(repeated.comparison));
  assert.ok(repeated.comparison.rows.every((row) => row.status === "SAME"));
  console.log("PASS  frozen source/image/dependencies replay with matching output hash and metric");

  const evaluationSource = readFileSync(new URL("./examples/evaluate-micrograd.py", import.meta.url), "utf8");
  const cpuOptions = { quickCommand: `python -c 'exec(${JSON.stringify(evaluationSource).replaceAll("'", "'\"'\"'")})'`,
    expectedText: "evaluation-ok", outputFile: "evaluation-result.json", metricKey: "accuracy", metricOperator: "eq", metricTarget: 1, metricTolerance: 0.05,
    evaluation: { dataset: "separated-sign-x-v1, 32 train / 48 held-out test, seeds 101/202", model: "Micrograd MLP [2,4,1], seed 7, 40 SGD epochs, saved/reloaded checkpoint",
      reference: "User-defined synthetic fixture target, NOT a published benchmark", assetsInEntry: true } };
  const evaluated = await execute(cpuOptions, "evaluation");
  assert.equal(evaluated.status, "SUCCEEDED", evaluated.log);
  assert.equal(evaluated.evaluation.status, "MATCHED_REFERENCE", JSON.stringify(evaluated.evaluation));
  assert.equal(evaluated.workflowId, "evaluation");
  assert.equal(evaluated.metric.value, 1);
  assert.equal(evaluated.evaluation.output.data.test_samples, 48);
  assert.equal(evaluated.evaluation.output.data.train_samples, 32);
  assert.match(evaluated.evaluation.output.data.dataset_sha256, /^[a-f\d]{64}$/);
  assert.match(evaluated.evaluation.output.data.checkpoint_sha256, /^[a-f\d]{64}$/);
  assert.ok(evaluated.evaluation.output.data.initial_accuracy < evaluated.metric.value);
  assert.equal(evaluated.recipe.workflowId, "evaluation");
  const reevaluated = await replayRecord(evaluated);
  assert.equal(reevaluated.status, "SUCCEEDED", reevaluated.log);
  assert.equal(reevaluated.evaluation.status, "MATCHED_REFERENCE");
  assert.equal(reevaluated.comparison.rows.find((row) => row.id === "metric").status, "SAME");
  const evaluationRecovered = JSON.parse((await promisify(execFile)(process.execPath, ["--input-type=module", "-e",
    `import { getRun } from './runner.mjs'; console.log(JSON.stringify(getRun('${evaluated.id}')));`], { windowsHide: true })).stdout);
  assert.equal(evaluationRecovered.evaluation.output.data.dataset_sha256, evaluated.evaluation.output.data.dataset_sha256);
  assert.equal(evaluationRecovered.evaluation.status, "MATCHED_REFERENCE");
  const wrongReference = await execute({ ...cpuOptions, metricTarget: 0, metricTolerance: 0.05 }, "evaluation");
  assert.equal(wrongReference.status, "SUCCEEDED");
  assert.equal(wrongReference.evaluation.status, "OUTSIDE_REFERENCE");
  assert.equal(wrongReference.verification.status, "FAILED");
  const missingMetric = await execute({ ...cpuOptions, quickCommand: `python -c 'print("evaluation-ok")'` }, "evaluation");
  assert.equal(missingMetric.status, "SUCCEEDED");
  assert.equal(missingMetric.evaluation.status, "INCOMPLETE");
  assert.equal(missingMetric.recipe, null);
  console.log(`PASS  held-out CPU Evaluation and checkpoint reload: accuracy=${evaluated.metric.value}, initial=${evaluated.evaluation.output.data.initial_accuracy}, replay=${reevaluated.comparison.status}`);
  console.log("PASS  Evaluation reference mismatch stays failed; report and asset identifiers survive reload");
  const collector = readFileSync(new URL("./collect-evidence.py", import.meta.url), "utf8");
  await assert.rejects(promisify(execFile)("docker", ["run", "--rm", "--pull", "never", "--cpus", "2", "--memory", "2g",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--network", "none", job.environment.imageId,
    "python", "-c", collector, JSON.stringify({ lockedEnvironment: { python: job.environment.python, dependencies: ["missing-lock-package==1.0"] } }), "environment"],
    { timeout: 15_000, windowsHide: true }), (error) => /Locked Python\/dependency environment does not match/.test(error.stderr));
  console.log("PASS  actual container refuses an inconsistent pre-entry dependency lock");
  const probeOptions = { ...cpuOptions, outputFile: "prepared.json" };
  const preparationProbe = `import json, pathlib, sys\npathlib.Path("/workspace").mkdir(exist_ok=True)\ncollector=${JSON.stringify(collector)}\noptions=${JSON.stringify(JSON.stringify(probeOptions))}\ndef collect(phase):\n    sys.argv=["collector", options, phase]\n    exec(collector, {})\ncollect("start")\npathlib.Path("/workspace/prepared.json").write_text('{"accuracy":1}')\ncollect("environment")\ncollect("finish")\npathlib.Path("/workspace/prepared.json").write_text('{"accuracy":1e400}')\ncollect("finish")`;
  const probe = await promisify(execFile)("docker", ["run", "--rm", "--pull", "never", "--cpus", "2", "--memory", "2g", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges", "--network", "none", job.environment.imageId, "python", "-c", preparationProbe], { timeout: 15_000, windowsHide: true });
  const observations = probe.stdout.split("\n").filter((line) => line.startsWith("::reprocheck-evidence::"));
  assert.equal(observations.length, 2);
  const preparationChecks = verifyOutcome({ ...sample, executionOptions: { ...probeOptions, expectedText: "" }, log: `${observations[0]}\n` });
  assert.equal(preparationChecks.checks.find((check) => check.id === "file").status, "FAILED");
  const nonFiniteChecks = verifyOutcome({ ...sample, executionOptions: { ...probeOptions, expectedText: "" }, log: `${observations[1]}\n` });
  assert.equal(nonFiniteChecks.checks.find((check) => check.id === "metric").status, "FAILED");
  console.log("PASS  preparation-only output and non-finite Evaluation JSON never pass acceptance");
  const recoveredReplay = JSON.parse((await promisify(execFile)(process.execPath, ["--input-type=module", "-e",
    `import { getRun } from './runner.mjs'; console.log(JSON.stringify(getRun('${repeated.id}')));`], { windowsHide: true })).stdout);
  assert.equal(recoveredReplay.comparison.status, "SAME");
  assert.equal(recoveredReplay.recipe.fingerprint, repeated.recipe.fingerprint);

  const varying = await execute({ ...executionOptions, quickCommand: executionOptions.quickCommand.replace('json.dump({"value":c.data', 'import time; json.dump({"nonce":time.time_ns(),"value":c.data') });
  assert.equal(varying.verification.status, "VERIFIED");
  const changedOutput = await replayRecord(varying);
  assert.equal(changedOutput.status, "SUCCEEDED", changedOutput.log);
  assert.equal(changedOutput.verification.status, "VERIFIED");
  assert.equal(changedOutput.comparison.status, "DIFFERENT");
  assert.equal(changedOutput.comparison.rows.find((row) => row.id === "output-hash").status, "DIFFERENT");
  assert.equal(changedOutput.comparison.rows.find((row) => row.id === "metric").status, "SAME");
  console.log("PASS  varying outputs are reported different even when metric expectations pass");
  const incorrect = await execute({ ...executionOptions, expectedText: "wrong-expectation", metricTarget: 4 });
  assert.equal(incorrect.status, "SUCCEEDED");
  assert.equal(incorrect.verification.status, "FAILED");
  assert.equal(incorrect.verification.checks.filter((check) => check.status === "FAILED").length, 2);
  const unchanged = await execute({ ...executionOptions, outputFile: "README.md", metricKey: "", metricTarget: null });
  assert.equal(unchanged.status, "SUCCEEDED");
  assert.equal(unchanged.artifact.fresh, false);
  assert.equal(unchanged.verification.status, "FAILED");
  console.log("PASS  wrong text/metric and unchanged repository files do not pass verification");
  const escaped = await execute({ ...executionOptions, quickCommand: `python -c 'import os; os.symlink("/etc/passwd","escape.json"); print("autodiff-ok")'`,
    outputFile: "escape.json", metricKey: "", metricTarget: null });
  assert.equal(escaped.status, "SUCCEEDED");
  assert.equal(escaped.verification.status, "FAILED");
  assert.match(escaped.artifact.error, /outside the repository/);
  const failed = await execute({ ...executionOptions, quickCommand: `python -c 'raise RuntimeError("expected failure")'` });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.verification.status, "INCOMPLETE");
  assert.ok(failed.verification.checks.every((check) => check.status === "NOT_RUN"));
  assert.match(failed.environment.python, /^3\.11\./);
  console.log("PASS  escaped symlinks are rejected and execution errors stay failed");
}
