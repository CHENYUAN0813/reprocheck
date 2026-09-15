import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { buildDockerInvocation, buildPreflight, buildReplayPreflight, cancelRun, getRun, inspectRuntime, reviewedBenchmark, reviewedTraining, startRun, validateExecutionOptions, verifyOutcome } from "./runner.mjs";
import { getSavedRun } from "./run-store.mjs";
import worker from "./worker.mjs";

const options = validateExecutionOptions({ benchmarkId: reviewedTraining.id });
const report = { repository: reviewedTraining.repository, commit: reviewedTraining.commit,
  workflows: [{ id: "training", title: "Training", steps: [] }, { id: "evaluation", title: "Evaluation", steps: [] }] };
const preflight = buildPreflight(report, "training", { available: true }, "readme", options);
assert.equal(preflight.runnable, true);
assert.equal(buildPreflight(report, "training", { available: true }).runnable, false);
assert.equal(buildPreflight(report, "training", { available: false }, "readme", options).runnable, false);
assert.deepEqual(preflight.automatedSteps.map((step) => step.id), ["install", "prepare-assets", "training-benchmark", "evaluation-benchmark"]);
assert.equal(preflight.benchmark.assets.some((asset) => asset.role === "checkpoint"), false, "Pretrained model must not be a training input");
assert.deepEqual(preflight.benchmark.training.parameters, { bits_per_input: 3, filter_inputs: 2, filter_entries: 128, filter_hashes: 1, num_workers: 1 });
assert.ok(preflight.automatedSteps.every((step) => step.command.length <= 6000));
assert.throws(() => buildPreflight(report, "evaluation", { available: true }, "readme", options), /matching/);
assert.throws(() => buildPreflight({ ...report, commit: "a".repeat(40) }, "training", { available: true }, "readme", options), /pinned/);
assert.throws(() => buildPreflight(report, "training", { available: true }, "readme", { ...options, metricTarget: 0.8 }), /fixed/);
assert.throws(() => buildPreflight(report, "training", { available: true }, "readme", { ...options, quickCommand: "python fake.py" }), /fixed/);
const script = buildDockerInvocation(preflight, "training-unit").at(-1);
assert.ok(script.indexOf("collect environment\n") < script.indexOf("echo ::reprocheck-step::training-benchmark"), "Input/environment gate must precede training");
assert.ok(script.indexOf("collect inputs\n") < script.indexOf("echo ::reprocheck-step::evaluation-benchmark"), "Recheck code inputs before model evaluation");
const evidence = { artifact: { fresh: true, size: 100 }, metric: { value: 0.98 },
  assets: reviewedTraining.assets.map((asset) => ({ ...asset, status: "PASSED", capture: "before-and-after-entry" })),
  referenceEvidence: { ...reviewedTraining.reference, status: "PASSED" },
  trainingCheckpoint: { path: reviewedTraining.training.checkpoint, size: 1, fresh: true, status: "PASSED", base64: "YQ==", sha256: createHash("sha256").update("a").digest("hex") } };
const sample = { status: "SUCCEEDED", benchmark: reviewedTraining, executionOptions: options, steps: [{ id: "evaluation-benchmark" }],
  log: `::reprocheck-step::evaluation-benchmark\npublished-benchmark-ok\n::reprocheck-evidence::${JSON.stringify(evidence)}\n` };
assert.equal(verifyOutcome(sample).status, "VERIFIED");
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace('"fresh":true,"status":"PASSED"', '"fresh":false,"status":"PASSED"') }).status, "FAILED");
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace('"base64":"YQ=="', '"base64":"Yg=="') }).status, "INCOMPLETE", "Download bytes must match the recorded model hash");
const stored = { ...sample, id: "00000000-0000-4000-8000-000000000003", repository: report.repository, commit: report.commit, workflowId: "training", packageIndex: "readme",
  environment: { imageId: `sha256:${"a".repeat(64)}`, python: "3.11.9", capture: "before-entry", unlockedDependencies: [] }, dependencies: ["pip==24.0"],
  steps: preflight.automatedSteps, verification: verifyOutcome(sample), limits: preflight.limits };
const replaySteps = buildReplayPreflight(stored, { available: true }, true).automatedSteps.map((step) => step.id);
assert.ok(replaySteps.indexOf("verify-lock") < replaySteps.indexOf("training-benchmark"));
const originalFetch = globalThis.fetch;
let requestedPinnedSource = false;
try {
  globalThis.fetch = async (url) => {
    if (url.endsWith(`/repos/${report.repository}`)) return Response.json({ default_branch: "moved-branch" });
    assert.ok(url.endsWith(`/commits/${report.commit}`));
    requestedPinnedSource = true;
    throw new Error("Offline check stops before external data requests");
  };
  await worker.fetch(new Request("https://reprocheck.test/api/scan", { method: "POST", body: JSON.stringify({ url: `https://github.com/${report.repository}`, executionOptions: { benchmarkId: reviewedTraining.id } }) }), {});
  assert.equal(requestedPinnedSource, true);
} finally { globalThis.fetch = originalFetch; }
assert.equal((await worker.fetch(new Request("https://reprocheck.test/api/run", { method: "POST" }), {})).status, 501, "Hosted site must not execute Training");
console.log("PASS  reviewed Training route, paper parameters, no pretrained input, checkpoint freshness and before-training gates");

// Opt-in: network and original training/pickle code execute only in bounded Docker.
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
  const input = { url: `https://github.com/${report.repository}`, commit: report.commit, workflowId: "training", executionOptions: { benchmarkId: reviewedTraining.id } };
  const preview = await request("/api/preflight", input);
  assert.equal(preview.runnable, true);
  async function wait(initial, api = false) {
    let job = initial;
    const deadline = Date.now() + 660_000;
    console.log(`Training run ${job.id}`);
    let stage;
    while (job.status === "RUNNING" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      job = api ? await request(`/api/runs/${job.id}`) : getRun(job.id);
      if (stage !== job.currentStep?.id) { stage = job.currentStep?.id; console.log(`Stage: ${stage ?? "setup"}`); }
    }
    if (job.status === "RUNNING") {
      if (api) await fetch(`${base}/api/runs/${job.id}`, { method: "DELETE" }); else cancelRun(job.id);
      assert.fail("Training exceeded its bounded execution window");
    }
    return job;
  }
  const job = await wait(await request("/api/run", { ...input, confirmUnknownCode: true }), true);
  assert.equal(job.status, "SUCCEEDED", job.log.slice(-5000));
  assert.ok(job.log.includes("Training model") && job.log.includes("training-checkpoint-saved"));
  assert.equal(job.trainingCheckpoint.status, "PASSED");
  assert.equal(job.trainingCheckpoint.fresh, true);
  const modelBytes = Buffer.from(job.trainingCheckpoint.base64, "base64");
  assert.equal(modelBytes.length, job.trainingCheckpoint.size);
  assert.equal(createHash("sha256").update(modelBytes).digest("hex"), job.trainingCheckpoint.sha256);
  assert.notEqual(job.trainingCheckpoint.sha256, reviewedBenchmark.assets.find((asset) => asset.role === "checkpoint").sha256);
  assert.equal(job.evaluation.output.data.training.pretrained_checkpoint_used, false);
  assert.equal(job.evaluation.output.data.train_samples, 100);
  assert.equal(job.evaluation.output.data.test_samples, 50);
  assert.equal(job.metric.value, job.evaluation.output.data.correct / 50);
  assert.equal(job.evaluation.status, job.metric.value === 0.98 ? "MATCHED_REFERENCE" : "OUTSIDE_REFERENCE");
  assert.ok(job.verification.checks.every((check) => check.id === "metric" || check.status === "PASSED"));
  assert.equal(getSavedRun(job.id).trainingCheckpoint.sha256, job.trainingCheckpoint.sha256, "Model download must survive container removal/server restart");
  console.log(JSON.stringify({ id: job.id, metric: job.metric.value, reference: 0.98, evaluation: job.evaluation.status,
    checkpointBytes: modelBytes.length, checkpointSha256: job.trainingCheckpoint.sha256, trainingSeconds: job.trainingCheckpoint.trainingSeconds,
    totalSeconds: (Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000 }));
  const wrongInput = structuredClone(buildPreflight(report, "training", runtime, "readme", options));
  wrongInput.benchmark.assets.find((asset) => asset.role === "inference").sha256 = "0".repeat(64);
  const blocked = await wait(startRun(wrongInput));
  assert.equal(blocked.status, "FAILED");
  assert.ok(!blocked.log.includes("::reprocheck-step::training-benchmark\n"), "Wrong original training code hash must stop training before execution");
  console.log(`PASS  original Iris training → fresh downloadable model → original held-out evaluation; bad code blocked; baseline ${job.id}`);
}
