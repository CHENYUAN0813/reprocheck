import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildEvaluationDraft } from "./evaluation-config.mjs";
import { experimentDraft, experimentExecutionOptions, MODEL_EXPORT_LIMIT, validateExperiment } from "./experiment-config.mjs";
import { buildDockerInvocation, buildPreflight, buildReplayPreflight, cancelRun, getRun, inspectRuntime, readEvidence, startRun, validateExecutionOptions, verifyOutcome } from "./runner.mjs";
import { getSavedRun } from "./run-store.mjs";

const cases = ["experiment-iris-random-forest.json", "experiment-iris-stratified.json"].map((name) => JSON.parse(readFileSync(new URL(`./examples/${name}`, import.meta.url))));
const source = cases[0];
const report = { repository: source.repository, commit: source.commit, workflows: [{ id: "training", title: "Training", steps: [] }, { id: "evaluation", steps: [] }] };
const options = validateExecutionOptions(source.executionOptions);
const preview = buildPreflight(report, "training", { available: true }, "readme", options);
assert.equal(preview.runnable, true);
assert.deepEqual(preview.automatedSteps.map((step) => step.id), ["install", "train", "evaluate"]);
assert.match(preview.automatedSteps.at(-1).command, /src\/evaluate.py/);
assert.equal(buildPreflight(report, "training", { available: false }, "readme", options).runnable, false);
for (const edit of [{ confirmed: false }, { checkpoint: "../outside.pkl" }, { checkpoint: ".git/config" }, { trainCommand: "python train.py\nunsafe" }, { forged: true }]) {
  assert.throws(() => validateExperiment({ ...options.experiment, ...edit }));
}
assert.throws(() => buildPreflight({ ...report, commit: "a".repeat(40) }, "training", { available: true }, "readme", options), /pinned/);
assert.throws(() => buildPreflight(report, "evaluation", { available: true }, "readme", options), /Training/);
assert.throws(() => validateExecutionOptions({ ...options, outputFile: options.experiment.checkpoint }), /paths must differ/);
assert.throws(() => validateExecutionOptions({ ...options, evaluation: { ...options.evaluation, assetsInEntry: true } }), /separate evaluator/);
assert.throws(() => validateExecutionOptions({ ...options, benchmarkId: "bthowen-iris" }), /mixed/);
assert.throws(() => validateExecutionOptions({ ...options, experiment: { ...options.experiment, capture: { kind: "stdout", label: "Accuracy\nforged", unit: "number" } } }), /capture/);
const script = buildDockerInvocation(preview, "experiment-unit").at(-1);
assert.ok(script.indexOf("collect environment\n") < script.indexOf("echo ::reprocheck-step::train\n"));
assert.ok(script.indexOf("collect checkpoint\n") < script.indexOf("echo ::reprocheck-step::evaluate\n"));
const model = { path: "model.joblib", size: 1, sha256: createHash("sha256").update("a").digest("hex"), base64: "YQ==", fresh: true, status: "PASSED" };
const evidence = { artifact: { fresh: true, size: 20 }, metric: { value: 1 }, trainingCheckpoint: model };
const sample = { status: "SUCCEEDED", executionOptions: options, steps: [{ id: "evaluate" }], log: `::reprocheck-step::evaluate\n::reprocheck-evidence::${JSON.stringify(evidence)}\n` };
assert.equal(verifyOutcome(sample).status, "VERIFIED");
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace('"status":"PASSED"', '"status":"FAILED"') }).status, "FAILED");
assert.equal(readEvidence(sample.log.replace('"base64":"YQ=="', '"base64":"Yg=="')), null);
assert.equal(verifyOutcome({ ...sample, log: sample.log.replace('"value":1', '"value":0.41') }).status, "FAILED");
const archived = { ...sample, id: "00000000-0000-4000-8000-000000000004", repository: report.repository, commit: report.commit, workflowId: "training", packageIndex: "readme",
  environment: { imageId: `sha256:${"a".repeat(64)}`, python: "3.11.9", capture: "before-entry", unlockedDependencies: [] }, dependencies: ["joblib==1.3.2"],
  steps: preview.automatedSteps, limits: preview.limits, verification: verifyOutcome(sample) };
const replay = buildReplayPreflight(archived, { available: true }, true);
assert.ok(replay.automatedSteps.findIndex((step) => step.id === "verify-lock") < replay.automatedSteps.findIndex((step) => step.id === "train"));
assert.deepEqual(replay.executionOptions.experiment, options.experiment);
const draftReport = { ...report, reproductionPlan: { steps: [] }, evaluationDraft: buildEvaluationDraft({ readme: "README.md", readmeText: "", entrypoints: [], files: [
  { path: "train.py", text: 'model.fit(X,y)\njoblib.dump(model, "model.joblib")' },
  { path: "evaluate.py", text: 'if __name__ == "__main__":\n model=joblib.load("model.joblib")\n print("Accuracy:", score)' },
] }) };
const draft = experimentDraft(draftReport);
assert.match(draft.trainCommand, /train.py/);
assert.equal(draft.checkpoint, "model.joblib");
assert.equal(draft.protocol, "", "Do not invent a scientific protocol");
assert.equal(draft.confirmed, false);
assert.throws(() => experimentExecutionOptions({ ...draft, confirmed: true }), /reference value/);
assert.equal(MODEL_EXPORT_LIMIT, 512 * 1024);
console.log("PASS  configurable experiment stages, identity/review gates, capture, new-model checks and replay compatibility");

// Opt-in: original repository code and models run only inside bounded Docker.
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
  async function wait(initial, api = false) {
    let job = initial;
    const deadline = Date.now() + 660000;
    let stage;
    console.log(`Experiment run ${job.id}`);
    while (job.status === "RUNNING" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      job = api ? await request(`/api/runs/${job.id}`) : getRun(job.id);
      if (stage !== job.currentStep?.id) { stage = job.currentStep?.id; console.log(`Stage: ${stage ?? "setup"}`); }
    }
    if (job.status === "RUNNING") {
      if (api) await fetch(`${base}/api/runs/${job.id}`, { method: "DELETE" }); else cancelRun(job.id);
      assert.fail("Experiment exceeded its bounded execution window");
    }
    return job;
  }
  let scanned;
  for (const config of cases) {
    const scan = await request("/api/scan", { url: `https://github.com/${config.repository}` });
    assert.equal(scan.commit, config.commit, "Acceptance config/source advanced; explicitly review the new commit before running");
    const input = { url: `https://github.com/${config.repository}`, commit: config.commit, workflowId: "training", executionOptions: config.executionOptions };
    const preview = await request("/api/preflight", input);
    assert.equal(preview.runnable, true);
    const job = await wait(await request("/api/run", { ...input, confirmUnknownCode: true }), true);
    assert.equal(job.status, "SUCCEEDED", job.log.replace(/^::reprocheck-evidence::.*$/gm, "[evidence omitted]").slice(-4500));
    assert.equal(job.trainingCheckpoint.status, "PASSED");
    assert.equal(job.trainingCheckpoint.fresh, true);
    assert.ok(job.trainingCheckpoint.size > 0 && job.trainingCheckpoint.size <= MODEL_EXPORT_LIMIT);
    assert.equal(createHash("sha256").update(Buffer.from(job.trainingCheckpoint.base64, "base64")).digest("hex"), job.trainingCheckpoint.sha256);
    assert.equal(job.evaluation.status, job.metric.value === config.executionOptions.metricTarget ? "MATCHED_REFERENCE" : "OUTSIDE_REFERENCE");
    assert.ok(job.verification.checks.every((check) => check.id === "metric" || check.status === "PASSED"));
    assert.equal(getSavedRun(job.id).trainingCheckpoint.sha256, job.trainingCheckpoint.sha256);
    assert.equal(job.experiment.repository, config.repository);
    console.log(JSON.stringify({ repository: config.repository, id: job.id, execution: job.status, score: job.metric.value, target: config.executionOptions.metricTarget,
      result: job.evaluation.status, modelBytes: job.trainingCheckpoint.size, modelSha256: job.trainingCheckpoint.sha256,
      seconds: (Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000 }));
    scanned ??= scan;
  }
  // Standard-library safety probes are fixtures, NOT scientific acceptance cases.
  const command = (code) => `python -c '${code.replaceAll("'", "'\"'\"'")}'`;
  const train = command('import json; from pathlib import Path; Path("new-model.bin").write_bytes(b"new"); Path("score.json").write_text(json.dumps(dict(accuracy=1)))');
  const probeOptions = { ...options, quickCommand: command('import json; from pathlib import Path; Path("score.json").write_text(json.dumps(dict(accuracy=0.41)))'),
    outputFile: "score.json", experiment: { ...options.experiment, installCommand: "", trainCommand: train, checkpoint: "new-model.bin", capture: { kind: "file", label: "", unit: "number" } } };
  const probes = [
    ["training-only score", { ...probeOptions, quickCommand: "python -c 'pass'" }, "FAILED"],
    ["modified model", { ...probeOptions, quickCommand: command('import json; from pathlib import Path; Path("new-model.bin").write_bytes(b"changed"); Path("score.json").write_text(json.dumps(dict(accuracy=1)))') }, "FAILED"],
    ["missing model", { ...probeOptions, experiment: { ...probeOptions.experiment, trainCommand: "python -c 'pass'" } }, "FAILED"],
    ["pre-existing model", { ...probeOptions, experiment: { ...probeOptions.experiment, prepareCommand: command('from pathlib import Path; Path("new-model.bin").write_bytes(b"preset")') } }, "FAILED"],
  ];
  for (const [name, configured, expected] of probes) {
    const job = await wait(startRun(buildPreflight(scanned, "training", runtime, "readme", configured)));
    if (["missing model", "pre-existing model"].includes(name)) {
      assert.equal(job.status, "FAILED", job.log.slice(-2500));
      assert.ok(!job.log.includes("::reprocheck-step::evaluate\n"));
    } else {
      assert.equal(job.status, "SUCCEEDED", job.log.slice(-2500));
      assert.equal(job.verification.status, expected);
      assert.equal(job.evaluation.status, "INCOMPLETE");
    }
    console.log(`PASS  safety probe: ${name}`);
  }
  console.log("PASS  two new original training/evaluation repositories, generic model export and negative experiment probes");
}
