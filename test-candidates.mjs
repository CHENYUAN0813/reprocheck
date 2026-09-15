import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildEvaluationDraft, candidateOptions, reviewedCandidate } from "./evaluation-config.mjs";
import { buildDockerInvocation, buildPreflight, buildReplayPreflight, createRecipe, validateExecutionOptions } from "./runner.mjs";

const files = [{ path: "eval.py", text: "iris = load_iris()\ntrain_test_split(X, y, test_size=0.3, random_state=1)\nmodel = LogisticRegression()\nprint('Accuracy: %.4f' % score)" }];
const entrypoints = [{ id: "evaluation-1", command: "$ python eval.py", category: "evaluation", evidence: { file: "README.md", line: 2 }, references: [{ path: "eval.py", exists: true }] },
  { id: "evaluation-2", command: "python eval_other.py", category: "evaluation", evidence: { file: "README.md", line: 6 }, references: [] }];
const readmeText = "## Evaluation\n$ python eval.py\nExpected output:\nAccuracy: 0.91\n## Other dataset\npython eval_other.py\nAccuracy: 0.82";
const draft = buildEvaluationDraft({ readme: "README.md", readmeText, entrypoints, files });
const report = { repository: "owner/repo", commit: "a".repeat(40), evaluationDraft: draft, workflows: [{ id: "evaluation", steps: [] }],
  reproductionPlan: { steps: [{ id: "install", title: "Install", status: "DOCUMENTED", command: "pip install numpy" }, { id: "data", status: "MISSING" }, { id: "model", status: "MISSING" }] } };
const review = { entryId: entrypoints[0].id, referenceId: draft.references[0].id, outputId: draft.outputs[0].id, confirmed: true };
const options = candidateOptions(report, review);
assert.deepEqual(draft.references.map(({ value, entryId }) => [value, entryId]), [[0.91, "evaluation-1"], [0.82, "evaluation-2"]]);
assert.equal(draft.outputs[0].evidence.line, 4);
assert.equal(options.metricTarget, 0.91);
assert.match(options.evaluation.dataset, /random_state=1/);
assert.match(options.evaluation.model, /LogisticRegression/);
assert.ok(options.quickCommand.length < 6000 && !/[\r\n]/.test(options.quickCommand));
assert.match(options.quickCommand, /python eval.py/);
assert.doesNotMatch(options.quickCommand, /0\.91/, "Observed-score adapter must not contain the target");
assert.throws(() => candidateOptions(report, { ...review, referenceId: draft.references[1].id }), /different README command/);
assert.throws(() => candidateOptions(report, { ...review, outputId: "invented" }), /no longer exists/);
assert.throws(() => validateExecutionOptions({ ...options, candidateReview: { ...review, confirmed: false } }), /explicit review/);
assert.throws(() => validateExecutionOptions({ ...options, candidateReview: { ...review, outputId: "../invented" } }), /valid source/);
assert.throws(() => validateExecutionOptions({ ...options, candidateReview: { ...review, forged: true } }), /valid source/);
assert.throws(() => reviewedCandidate(report, { ...review, confirmed: false }, options), /confirm/);
const executable = { ...options, evaluation: { ...options.evaluation, assetsInEntry: true } };
const preview = buildPreflight(report, "evaluation", { available: true }, "readme", executable);
assert.equal(preview.runnable, true);
assert.equal(preview.commandOverride.original, "$ python eval.py");
assert.equal(preview.candidate.reference.evidence.line, 4);
assert.equal(preview.candidate.referenceConditionEdited, false);
assert.equal(buildPreflight(report, "evaluation", { available: true }, "readme", { ...executable, metricTarget: 0 }).candidate.referenceConditionEdited, true);
assert.equal(buildPreflight(report, "evaluation", { available: true }, "readme", { ...executable, metricTolerance: 1 }).candidate.referenceConditionEdited, true);
assert.equal(buildPreflight(report, "evaluation", { available: true }, "readme", options).runnable, false, "Missing asset steps must not silently disappear");
const table = buildEvaluationDraft({ readme: "README.md", readmeText: "| Dataset | Accuracy | Loss |\n| --- | --- | --- |\n| Iris | 98% | 0.1 |\n| Wine | 0.95 | 0.2 |", entrypoints, files });
assert.equal(table.references[0].value, 98);
assert.equal(table.references[0].unit, "percent");
assert.equal(table.references[0].entryId, null, "Table rows cannot silently be linked to a command");
assert.throws(() => candidateOptions({ ...report, evaluationDraft: table }, { ...review, referenceId: table.references[0].id }), /units differ/);
assert.throws(() => candidateOptions({ ...report, evaluationDraft: table }, { ...review, referenceId: table.references[1].id }), /metric types differ/);
const prefixedTable = buildEvaluationDraft({ readme: "README.md", readmeText: "Model | **Test Accuracy**\n--- | ---\nIris | 0.980", entrypoints, files });
assert.equal(prefixedTable.references[0].metricKey, "accuracy");
assert.equal(prefixedTable.references[0].value, 0.98);
assert.equal(prefixedTable.references[0].label, "Iris · Test Accuracy");
const jsonDraft = buildEvaluationDraft({ readme: "README.md", readmeText: "Accuracy usually exceeds 90%", entrypoints,
  files: [{ path: "eval.py", text: 'json.dump({"accuracy":score}, open("results.json","w"))\njson.dump({},open("../escape.json","w"))' }] });
assert.equal(jsonDraft.references.length, 0, "Narrative ranges are not exact reference values");
assert.equal(buildEvaluationDraft({ readme: "README.md", readmeText: "Accuracy: 90%-95%\nAccuracy: 0.9 ± 0.1\nExpected Accuracy: 0.9 (unreviewed example)", entrypoints, files }).references.length, 0);
assert.equal(jsonDraft.outputs.length, 1);
assert.equal(jsonDraft.outputs[0].path, "results.json");
const inferred = buildEvaluationDraft({ readme: "README.md", readmeText: "", entrypoints: [], files: [{ path: "tools/evaluate.py", text: 'if __name__ == "__main__":\n    main()' }] });
assert.equal(inferred.entries[0].origin, "inferred-script");
assert.equal(inferred.references.length, 0);
const stored = { id: "00000000-0000-4000-8000-000000000002", status: "SUCCEEDED", verification: { status: "VERIFIED" },
  repository: report.repository, commit: report.commit, workflowId: "evaluation", packageIndex: "readme", executionOptions: executable, candidate: preview.candidate,
  environment: { imageId: `sha256:${"b".repeat(64)}`, python: "3.11.9", capture: "before-entry", unlockedDependencies: [] }, dependencies: ["numpy==1.26.4"],
  steps: [{ id: "evaluation-candidate", title: "Saved adapter", command: "python previous-adapter.py" }], limits: preview.limits };
assert.equal(buildReplayPreflight(stored, { available: true }, true).automatedSteps.at(-1).command, "python previous-adapter.py");
assert.deepEqual(createRecipe(stored).candidate, preview.candidate);
assert.throws(() => createRecipe({ ...stored, candidate: null }), /source context/);
console.log("PASS  generated Evaluation candidates, source association, review gates and archived provenance");

// Opt-in: real public repository entry executes only in the existing bounded Docker runner.
if (process.argv.includes("--docker")) {
  const base = process.env.REPROCHECK_TEST_URL ?? "http://127.0.0.1:5173";
  async function request(path, body) {
    const response = await fetch(`${base}${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const result = await response.json();
    assert.equal(response.ok, true, JSON.stringify(result));
    return result;
  }
  const scanned = await request("/api/scan", { url: "https://github.com/KTS-o7/AIML-Lab" });
  const entry = scanned.evaluationDraft.entries.find((entry) => entry.command.includes("KNNAlgorithm/KNNAlgo.py"));
  const ref = scanned.evaluationDraft.references.find((reference) => reference.entryId === entry.id);
  const output = scanned.evaluationDraft.outputs.find((output) => output.entryIds.includes(entry.id));
  const config = candidateOptions(scanned, { entryId: entry.id, referenceId: ref.id, outputId: output.id, confirmed: true });
  config.evaluation.assetsInEntry = true; // Explicitly reviewed: original script loads built-in Iris and fits its own KNN.
  const input = { url: `https://github.com/${scanned.repository}`, commit: scanned.commit, workflowId: "evaluation", executionOptions: config };
  for (const invalid of [{ ...config, candidateReview: { ...config.candidateReview, confirmed: false } },
    { ...config, candidateReview: { ...config.candidateReview, referenceId: "invented" } }]) {
    const denied = await fetch(`${base}/api/preflight`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, executionOptions: invalid }) });
    assert.equal(denied.status, 400);
  }
  const preflight = await request("/api/preflight", input);
  assert.equal(preflight.runnable, true);
  async function wait(job) {
    const deadline = Date.now() + 660000;
    console.log(`Candidate run ${job.id}`);
    let stage;
    while (job.status === "RUNNING" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      job = await request(`/api/runs/${job.id}`);
      if (job.currentStep?.id !== stage) { stage = job.currentStep?.id; console.log(`Stage: ${stage ?? "setup"}`); }
    }
    if (job.status === "RUNNING") { await fetch(`${base}/api/runs/${job.id}`, { method: "DELETE" }); assert.fail("Bounded candidate test timed out"); }
    assert.equal(job.status, "SUCCEEDED", job.log.slice(-4000));
    assert.equal(job.verification.status, "VERIFIED", JSON.stringify(job.verification));
    console.log(JSON.stringify({ id: job.id, status: job.status, metric: job.metric.value, evaluation: job.evaluation.status, comparison: job.comparison?.status,
      seconds: (Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000 }));
    return job;
  }
  const job = await wait(await request("/api/run", { ...input, confirmUnknownCode: true }));
  assert.equal(job.metric.value, ref.value);
  assert.equal(job.candidate.reference.evidence.text, ref.evidence.text);
  assert.ok(job.recipe, job.recipeUnavailableReason);
  const frozen = await request(`/api/runs/${job.id}/replay-preflight`, {});
  const replay = await wait(await request(`/api/runs/${job.id}/replay`, { confirmUnknownCode: true, recipeFingerprint: frozen.recipe.fingerprint }));
  assert.equal(replay.comparison.status, "SAME", JSON.stringify(replay.comparison));
  assert.ok(replay.comparison.rows.some((row) => row.id === "candidate-sources" && row.status === "SAME"));
  // Controlled fixtures, no host mounts/network: prove observation is independent of target and ambiguity fails.
  const probeReport = structuredClone(report);
  probeReport.evaluationDraft.entries[0].command = `python -c "print('Accuracy: 0.41')"`;
  const observedOptions = candidateOptions(probeReport, review);
  const probe = { ...preflight, executionOptions: observedOptions, automatedSteps: [{ id: "evaluation-candidate", command: observedOptions.quickCommand }] };
  const args = buildDockerInvocation(probe, "reprocheck-candidate-observation-probe");
  args[args.indexOf("--network") + 1] = "none";
  const direct = args.at(-1).replace(/git init -q \/workspace[\s\S]*?collect start/, "mkdir -p /workspace\ncollect start");
  args[args.length - 1] = direct;
  const { stdout } = await promisify(execFile)("docker", args, { timeout: 20000, windowsHide: true });
  assert.match(stdout, /"accuracy":0\.41|"value": 0\.41/);
  probeReport.evaluationDraft.entries[0].command = `python -c "print('Accuracy: 0.41'); print('Accuracy: 0.41')"`;
  const duplicateOptions = candidateOptions(probeReport, review);
  const duplicateArgs = buildDockerInvocation({ ...probe, executionOptions: duplicateOptions,
    automatedSteps: [{ id: "evaluation-candidate", command: duplicateOptions.quickCommand }] }, "reprocheck-candidate-duplicate-probe");
  duplicateArgs[duplicateArgs.indexOf("--network") + 1] = "none";
  duplicateArgs[duplicateArgs.length - 1] = duplicateArgs.at(-1).replace(/git init -q \/workspace[\s\S]*?collect start/, "mkdir -p /workspace\ncollect start");
  await assert.rejects(promisify(execFile)("docker", duplicateArgs, { timeout: 20000, windowsHide: true }), (error) => /duplicate scores are ambiguous/.test(error.stderr + error.stdout));
  for (const url of ["https://github.com/ZSusskind/BTHOWeN", "https://github.com/jingyaogong/minimind"]) {
    const other = await request("/api/scan", { url });
    assert.ok(other.evaluationDraft);
    if (other.repository === "ZSusskind/BTHOWeN") assert.ok(other.evaluationDraft.references.some((reference) => reference.label.startsWith("Iris ·") && reference.value === 0.98));
    console.log(JSON.stringify({ repository: other.repository, commit: other.commit, entries: other.evaluationDraft.entries.length,
      references: other.evaluationDraft.references.length, outputs: other.evaluationDraft.outputs.length, scope: "scan-only; no automatic claim or repository execution" }));
  }
  console.log(`PASS  generic source-derived KNN Evaluation, frozen replay, independent observation and ambiguous-score rejection; baseline ${job.id}`);
}
