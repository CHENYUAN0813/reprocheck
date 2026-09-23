import assert from "node:assert/strict";
import { buildPreflight, buildReplayPreflight, cancelRun, createRecipe, getRun, inspectLockedImage, inspectRuntime, reviewedBenchmark, reviewedBenchmarks, startRun, validateExecutionOptions, verifyOutcome } from "./runner.mjs";
import { getSavedRun } from "./run-store.mjs";
import worker from "./worker.mjs";

const options = validateExecutionOptions({ benchmarkId: reviewedBenchmark.id });
const report = { repository: reviewedBenchmark.repository, commit: reviewedBenchmark.commit,
  workflows: [{ id: "evaluation", title: "Evaluation", status: "UNAVAILABLE", steps: [] }], reproductionPlan: { steps: [] } };
const preview = buildPreflight(report, "evaluation", { available: true }, "readme", options);
assert.equal(preview.runnable, true);
assert.deepEqual(preview.automatedSteps.map((step) => step.id), ["install", "prepare-assets", "evaluation-benchmark"]);
assert.equal(preview.executionOptions.metricTarget, 0.98);
assert.equal(preview.executionOptions.metricTolerance, 0);
assert.ok(preview.automatedSteps.every((step) => step.command.length <= 6000));
for (const benchmark of reviewedBenchmarks) {
  const caseOptions = validateExecutionOptions({ benchmarkId: benchmark.id });
  const caseReport = { ...report, repository: benchmark.repository, commit: benchmark.commit };
  const casePreview = buildPreflight(caseReport, benchmark.matrix ? "paper-matrix" : "evaluation", { available: true }, "readme", caseOptions);
  assert.equal(casePreview.benchmark.datasetName, benchmark.datasetName);
  assert.equal(casePreview.limits.image, benchmark.image);
  assert.ok(casePreview.benchmark.assets.length > 0 && casePreview.benchmark.assets.length <= 40);
  if (benchmark.matrix) {
    assert.equal(casePreview.paperMatrix.cells.length, 15);
    assert.deepEqual(casePreview.limits, { timeoutMinutes: 60, memory: "6 GB", cpus: 4, hostMounts: false, networkAccess: true, image: "python:3.10.12" });
    assert.deepEqual(casePreview.automatedSteps.map((step) => step.id), ["install", "prepare-assets", "evaluation-benchmark"]);
    assert.equal(casePreview.executionOptions.outputFile, "results/table1-cpu.csv");
  } else {
    assert.equal(casePreview.executionOptions.metricTarget, benchmark.reference.value);
    assert.equal(casePreview.executionOptions.metricTolerance, benchmark.reference.tolerance);
  }
  assert.equal(casePreview.benchmark.assets.filter((asset) => asset.role === "checkpoint").length, benchmark.adapter === "bthowen" ? 1 : 0);
}
const matrixBenchmark = reviewedBenchmarks.find((benchmark) => benchmark.matrix);
const matrixOptions = validateExecutionOptions({ benchmarkId: matrixBenchmark.id });
const matrixAssets = matrixBenchmark.assets.map((asset) => ({ ...asset, exists: true, capture: "before-and-after-entry", status: "PASSED" }));
const matrixEvidence = { assets: matrixAssets, referenceEvidence: { ...matrixBenchmark.reference, status: "PASSED" },
  artifact: { fresh: true, size: 400 }, matrix: { summary: { total: 15, matched: 15, outside: 0, missing: 0 }, cells: matrixBenchmark.matrix.cells } };
const matrixSample = { status: "SUCCEEDED", executionOptions: matrixOptions, benchmark: matrixBenchmark, paperMatrix: matrixBenchmark.matrix,
  steps: [{ id: "evaluation-benchmark" }], log: `::reprocheck-step::evaluation-benchmark\npublished-matrix-ok\n::reprocheck-evidence::${JSON.stringify(matrixEvidence)}\n` };
assert.equal(verifyOutcome(matrixSample).status, "VERIFIED");
assert.equal(verifyOutcome({ ...matrixSample, log: matrixSample.log.replace('"matched":15', '"matched":14') }).status, "FAILED");
assert.throws(() => validateExecutionOptions({ benchmarkId: "invented" }), /Unknown/);
assert.throws(() => buildPreflight(report, "evaluation", { available: true }, "readme", { ...options, metricTarget: 0 }), /fixed/);
assert.throws(() => buildPreflight(report, "evaluation", { available: true }, "readme", { ...options, quickCommand: "python fake.py" }), /fixed/);
assert.throws(() => buildPreflight({ ...report, commit: "a".repeat(40) }, "evaluation", { available: true }, "readme", options), /pinned/);
assert.throws(() => buildPreflight({ ...report, repository: "other/repository" }, "evaluation", { available: true }, "readme", options), /pinned/);
const assets = reviewedBenchmark.assets.map((asset) => ({ ...asset, exists: true, capture: "before-and-after-entry", status: "PASSED" }));
const referenceEvidence = { ...reviewedBenchmark.reference, status: "PASSED" };
const sample = { status: "SUCCEEDED", executionOptions: options, benchmark: reviewedBenchmark, steps: [{ id: "evaluation-benchmark" }],
  log: `::reprocheck-step::evaluation-benchmark\npublished-benchmark-ok\n::reprocheck-evidence::${JSON.stringify({ assets, referenceEvidence, artifact: { fresh: true, size: 100 }, metric: { value: 0.98 } })}\n` };
assert.equal(verifyOutcome(sample).status, "VERIFIED");
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace(assets[0].sha256, "0".repeat(64)) }).status, "FAILED");
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace('"value":0.98', '"value":0.97') }).status, "FAILED");
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace('"assets":', '"missingAssets":') }).status, "INCOMPLETE");
const stored = { ...sample, id: "00000000-0000-4000-8000-000000000001", repository: report.repository, commit: report.commit, workflowId: "evaluation", packageIndex: "readme",
  environment: { imageId: `sha256:${"a".repeat(64)}`, python: "3.11.9", capture: "before-entry", unlockedDependencies: [] }, dependencies: ["pip==24.0"],
  executionOptions: { ...options, quickCommand: "python previous-reviewed-adapter.py" },
  steps: [{ id: "evaluation-benchmark", title: "Saved entry", command: "python previous-reviewed-adapter.py" }], verification: verifyOutcome(sample), limits: preview.limits };
assert.equal(buildReplayPreflight(stored, { available: true }, true).automatedSteps.at(-1).command, "python previous-reviewed-adapter.py", "Replay must retain the archived adapter, not inject the current preset");
assert.equal(createRecipe(stored).benchmark.assets[0].sha256, assets[0].sha256);
assert.throws(() => createRecipe({ ...stored, benchmark: null }), /asset\/source locks/);
const originalFetch = globalThis.fetch;
let pinnedCommitRequested = false;
try {
  // Unit check only: a moved default branch must not replace the reviewed commit.
  globalThis.fetch = async (url) => {
    if (url.endsWith(`/repos/${report.repository}`)) return Response.json({ default_branch: "newer-branch" });
    assert.ok(url.endsWith(`/commits/${report.commit}`));
    pinnedCommitRequested = true;
    throw new Error("Unit check stops before external requests");
  };
  await worker.fetch(new Request("https://reprocheck.test/api/scan", { method: "POST", body: JSON.stringify({ url: `https://github.com/${report.repository}`, executionOptions: { benchmarkId: reviewedBenchmark.id } }) }), {});
  assert.equal(pinnedCommitRequested, true);
} finally { globalThis.fetch = originalFetch; }
console.log("PASS  reviewed benchmark identity, immutable conditions and evidence gates");

// Opt-in: public network downloads and unknown repository/pickle execution ONLY in bounded Docker.
if (process.argv.includes("--docker")) {
  const runtime = await inspectRuntime();
  assert.equal(runtime.available, true, runtime.reason);
  const scanned = report;
  async function execute(preflight) {
    let job = startRun(preflight);
    console.log(`Benchmark run ${job.id}`);
    const deadline = Date.now() + 660_000;
    let stage;
    while (job.status === "RUNNING" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      job = getRun(job.id);
      if (stage !== job.currentStep?.id) { stage = job.currentStep?.id; console.log(`Stage: ${stage ?? "container setup"}`); }
    }
    if (job.status === "RUNNING") {
      cancelRun(job.id);
      assert.fail("Benchmark did not terminate within its bounded window");
    }
    console.log(JSON.stringify({ id: job.id, status: job.status, evaluation: job.evaluation?.status, metric: job.metric?.value, comparison: job.comparison?.status,
      seconds: (Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000 }));
    return job;
  }
  const apiPreview = buildPreflight(scanned, "evaluation", runtime, "readme", options);
  assert.equal(apiPreview.runnable, true);
  assert.throws(() => buildPreflight(scanned, "evaluation", runtime, "readme", { ...options, metricTarget: 0 }), /fixed/);
  const result = await execute(apiPreview);
  assert.equal(result.status, "SUCCEEDED", result.log.slice(-6000));
  assert.equal(result.verification.status, "VERIFIED", JSON.stringify(result.verification));
  assert.equal(result.evaluation.status, "MATCHED_REFERENCE");
  assert.equal(result.metric.value, 0.98);
  assert.equal(result.evaluation.output.data.correct, 49);
  assert.equal(result.evaluation.output.data.test_samples, 50);
  assert.equal(result.evaluation.output.data.train_samples, 100);
  assert.match(result.evaluation.output.data.split_sha256, /^[a-f\d]{64}$/);
  assert.ok(result.assets.every((asset) => asset.status === "PASSED"));
  assert.equal(result.referenceEvidence.status, "PASSED");
  assert.equal(getSavedRun(result.id).evaluation.status, "MATCHED_REFERENCE");
  assert.ok(result.recipe, result.recipeUnavailableReason);
  assert.equal(await inspectLockedImage(result.recipe.imageId), true);
  for (const benchmark of reviewedBenchmarks.slice(1).filter((entry) => !entry.matrix)) {
    const caseOptions = validateExecutionOptions({ benchmarkId: benchmark.id });
    const caseReport = { ...scanned, repository: benchmark.repository, commit: benchmark.commit };
    const caseResult = await execute(buildPreflight(caseReport, "evaluation", runtime, "readme", caseOptions));
    assert.equal(caseResult.status, "SUCCEEDED", caseResult.log.slice(-6000));
    assert.equal(caseResult.verification.status, "VERIFIED", JSON.stringify(caseResult.verification));
    assert.equal(caseResult.evaluation.status, "MATCHED_REFERENCE");
    if (benchmark.split) {
      assert.equal(caseResult.evaluation.output.data.train_samples, benchmark.split.trainSamples);
      assert.equal(caseResult.evaluation.output.data.test_samples, benchmark.split.testSamples);
    } else {
      assert.equal(caseResult.evaluation.output.data.train_rows, 176139);
      assert.equal(caseResult.evaluation.output.data.held_out_users, 22311);
      assert.equal(caseResult.evaluation.output.data.ndcg10_4dp, benchmark.reference.value);
    }
    assert.ok(Math.abs(caseResult.metric.value - benchmark.reference.value) <= benchmark.reference.tolerance);
    assert.ok(caseResult.assets.every((asset) => asset.status === "PASSED"));
  }
  const replayPreview = buildReplayPreflight(getSavedRun(result.id), runtime, true);
  const replayed = await execute(replayPreview);
  assert.equal(replayed.verification.status, "VERIFIED", JSON.stringify(replayed.verification));
  assert.equal(replayed.comparison.status, "SAME", JSON.stringify(replayed.comparison));
  const wrongAsset = structuredClone(buildPreflight(scanned, "evaluation", runtime, "readme", options));
  wrongAsset.benchmark.assets.find((asset) => asset.role === "checkpoint").sha256 = "0".repeat(64);
  const rejected = await execute(wrongAsset);
  assert.equal(rejected.status, "FAILED");
  assert.equal(rejected.evaluation.status, "INCOMPLETE");
  assert.ok(!rejected.log.includes("::reprocheck-step::evaluation-benchmark\n"), "Mismatched checkpoint must block the pickle/evaluation entry");
  console.log(`PASS  reviewed paper benchmarks, all asset/source locks, exact replay and checkpoint-mismatch execution gate; baseline ${result.id}`);
}
