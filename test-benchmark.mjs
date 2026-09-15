import assert from "node:assert/strict";
import { buildPreflight, buildReplayPreflight, cancelRun, createRecipe, getRun, inspectLockedImage, inspectRuntime, reviewedBenchmark, startRun, validateExecutionOptions, verifyOutcome } from "./runner.mjs";
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
  const base = process.env.REPROCHECK_TEST_URL ?? "http://127.0.0.1:5173";
  async function request(path, body) {
    const response = await fetch(`${base}${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const result = await response.json();
    assert.equal(response.ok, true, JSON.stringify(result));
    return result;
  }
  const scanned = await request("/api/scan", { url: `https://github.com/${reviewedBenchmark.repository}`, executionOptions: { benchmarkId: reviewedBenchmark.id } });
  assert.equal(scanned.commit, reviewedBenchmark.commit);
  async function execute(preflight, route, body) {
    let job = route ? await request(route, body) : startRun(preflight);
    console.log(`Benchmark run ${job.id}`);
    const deadline = Date.now() + 660_000;
    let stage;
    while (job.status === "RUNNING" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      job = route ? await request(`/api/runs/${job.id}`) : getRun(job.id);
      if (stage !== job.currentStep?.id) { stage = job.currentStep?.id; console.log(`Stage: ${stage ?? "container setup"}`); }
    }
    if (job.status === "RUNNING") {
      if (route) await fetch(`${base}/api/runs/${job.id}`, { method: "DELETE" });
      else cancelRun(job.id);
      assert.fail("Benchmark did not terminate within its bounded window");
    }
    console.log(JSON.stringify({ id: job.id, status: job.status, evaluation: job.evaluation?.status, metric: job.metric?.value, comparison: job.comparison?.status,
      seconds: (Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000 }));
    return job;
  }
  const input = { url: `https://github.com/${reviewedBenchmark.repository}`, commit: scanned.commit, workflowId: "evaluation", executionOptions: { benchmarkId: reviewedBenchmark.id } };
  const apiPreview = await request("/api/preflight", input);
  assert.equal(apiPreview.runnable, true);
  const changedTarget = await fetch(`${base}/api/preflight`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, executionOptions: { ...options, metricTarget: 0 } }) });
  assert.equal(changedTarget.status, 400, "New benchmark execution must not accept a modified published target");
  const result = await execute(apiPreview, "/api/run", { ...input, confirmUnknownCode: true });
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
  const replayPreview = await request(`/api/runs/${result.id}/replay-preflight`, {});
  const replayed = await execute(replayPreview, `/api/runs/${result.id}/replay`, { confirmUnknownCode: true, recipeFingerprint: replayPreview.recipe.fingerprint });
  assert.equal(replayed.verification.status, "VERIFIED", JSON.stringify(replayed.verification));
  assert.equal(replayed.comparison.status, "SAME", JSON.stringify(replayed.comparison));
  const wrongAsset = structuredClone(buildPreflight(scanned, "evaluation", runtime, "readme", options));
  wrongAsset.benchmark.assets.find((asset) => asset.role === "checkpoint").sha256 = "0".repeat(64);
  const rejected = await execute(wrongAsset);
  assert.equal(rejected.status, "FAILED");
  assert.equal(rejected.evaluation.status, "INCOMPLETE");
  assert.ok(!rejected.log.includes("::reprocheck-step::evaluation-benchmark\n"), "Mismatched checkpoint must block the pickle/evaluation entry");
  console.log(`PASS  real Iris benchmark 49/50, all asset/source locks, exact replay and checkpoint-mismatch execution gate; baseline ${result.id}`);
}
