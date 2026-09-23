import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildEvaluationDraft, candidateCommand, candidateOptions, reviewedCandidate, suggestCandidate } from "./evaluation-config.mjs";
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
assert.deepEqual(suggestCandidate(report), { ...review, confirmed: false });
assert.equal(suggestCandidate({ ...report, evaluationDraft: { ...draft, outputs: [...draft.outputs, { ...draft.outputs[0], id: "duplicate-output" }] } }), null, "Ambiguous candidates must not be guessed");
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
assert.equal(suggestCandidate({ ...report, evaluationDraft: table }), null, "Unassociated table rows must not be auto-selected");
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

const argumentDraft = buildEvaluationDraft({ readme: "README.md", readmeText: "", entrypoints: [], files: [{ path: "evaluate.py", text:
  `parser = ArgumentParser()\nparser.add_argument("checkpoint", help="Model path")\nparser.add_argument(\n "--config", required=True, help="Config file"\n)\nparser.add_argument("--seed", default=42, type=int)\nparser.add_argument("--gpu", action="store_true")\npath = "configs/base.yaml"` }], filePaths: ["evaluate.py", "configs/base.yaml"] });
const argumentEntry = argumentDraft.entries[0];
assert.equal(suggestCandidate({ ...report, evaluationDraft: argumentDraft }), null, "Required arguments must block automatic suggestion");
assert.deepEqual(candidateCommand(argumentEntry).missing, ["checkpoint", "--config"]);
assert.equal(argumentEntry.arguments[1].evidence.line, 3);
assert.equal(argumentEntry.arguments[2].default, "42");
assert.equal(argumentEntry.arguments[3].supported, false);
assert.equal(buildEvaluationDraft({ readme: "README.md", readmeText: "", entrypoints: [], files: [{ path: "evaluate.py", text: 'p = ArgumentParser()\np.add_argument("--pair", nargs=2)' }] }).entries[0].arguments[0].supported, false);
assert.equal(argumentDraft.paths[0].matches[0], "configs/base.yaml");
const argumentValues = { "argument-1": "models/checkpoint 'reviewed'.pth", "argument-2": "configs/base.yaml" };
const argumentConfig = candidateOptions({ ...report, evaluationDraft: argumentDraft }, { entryId: argumentEntry.id, referenceId: null, outputId: null, argumentValues });
assert.match(argumentConfig.quickCommand, /--config 'configs\/base.yaml'/);
assert.deepEqual(reviewedCandidate({ ...report, evaluationDraft: argumentDraft }, { ...argumentConfig.candidateReview, confirmed: true }, argumentConfig).argumentValues, argumentValues);
assert.throws(() => candidateCommand(argumentEntry, { "argument-1": "line\nbreak" }), /invalid/);
assert.throws(() => candidateCommand(argumentEntry, { "argument-99": "invented" }), /Unknown/);
assert.throws(() => candidateCommand(argumentEntry, { "argument-4": "True" }), /unsupported/);
assert.throws(() => candidateCommand({ ...argumentEntry, command: "python -m evaluate" }, argumentValues), /simple Python script/);
assert.throws(() => candidateCommand({ ...argumentEntry, command: "python evaluate.py && echo done" }, argumentValues), /complex commands/);
assert.throws(() => candidateOptions({ ...report, evaluationDraft: argumentDraft }, { entryId: argumentEntry.id }), /Required arguments/);
assert.deepEqual(candidateCommand({ ...argumentEntry, command: "python evaluate.py model.pth --config=base.yaml" }).missing, []);
console.log("PASS  required/positional arguments, multiline declarations, literal asset paths and safe command completion");
const formatDraft = buildEvaluationDraft({ readme: "README.md", readmeText: "Metric | Value\n--- | ---\nAccuracy | 0.98\nF1 score | 0.97", entrypoints,
  files: [{ path: "eval.py", text: `print("Accuracy", score)\nlogging.info("Test accuracy: %.4f", score)\nprint(json.dumps({"accuracy": score}))\njson.dump({"accuracy": score}, open("result.csv", "w"))` }] });
assert.deepEqual(formatDraft.references.map((reference) => reference.value), [0.98, 0.97]);
assert.deepEqual(formatDraft.outputs.map((output) => output.kind), ["stdout", "stdout", "stdout-json", "csv"]);
assert.equal(formatDraft.outputs[0].label, "Accuracy");
const formatted = buildEvaluationDraft({ readme: "README.md", readmeText: "", entrypoints, files: [{ path: "eval.py", text: 'print(f"Custom KNN accuracy: {accuracy(y_test, predictions):.4f}")' }] });
assert.equal(formatted.outputs[0].label, "Custom KNN accuracy");
assert.equal(candidateOptions({ ...report, evaluationDraft: formatDraft }, { entryId: entrypoints[0].id, outputId: formatDraft.outputs[2].id, referenceId: formatDraft.references[0].id }).outputFile, "reprocheck-evaluation.json");
console.log("PASS  comma-separated print labels, logging, JSON stdout, CSV candidates and vertical reference tables");

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
  assert.equal(scanned.evaluationDraft.suggestion, null, "Two valid repository entries must remain a user choice");
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
  async function wait(job, requireMatch = true) {
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
    if (requireMatch) assert.equal(job.verification.status, "VERIFIED", JSON.stringify(job.verification));
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
  const pyCommand = (code) => `python -c 'exec(${JSON.stringify(code).replaceAll("'", "'\"'\"'")})'`;
  async function probeCommand(command, options, name) {
    const controlled = { ...preflight, candidate: null, executionOptions: options, automatedSteps: [{ id: "evaluation-candidate", command }] };
    const invocation = buildDockerInvocation(controlled, `reprocheck-format-${name}`);
    invocation[invocation.indexOf("--network") + 1] = "none";
    invocation[invocation.length - 1] = invocation.at(-1).replace(/git init -q \/workspace[\s\S]*?collect start/, "mkdir -p /workspace\ncollect start");
    return promisify(execFile)("docker", invocation, { timeout: 20000, windowsHide: true });
  }
  for (const [name, code, kind] of [
    ["comma", `print("Accuracy", 0.41)`, "stdout"],
    ["logging", `import logging; logging.basicConfig(level=logging.INFO); logging.info("Accuracy: %.2f", 0.41)`, "stdout"],
    ["ansi", `print("\\x1b[32mAccuracy: 0.41\\x1b[0m")`, "stdout"],
    ["json", `import json; print(json.dumps({"accuracy":0.41}))`, "stdout-json"],
  ]) {
    const fixture = structuredClone(report);
    fixture.evaluationDraft.entries[0].command = pyCommand(code);
    fixture.evaluationDraft.outputs[0] = { ...fixture.evaluationDraft.outputs[0], kind };
    const fixtureOptions = candidateOptions(fixture, review);
    const result = await probeCommand(fixtureOptions.quickCommand, fixtureOptions, name);
    assert.match(result.stdout, /"value": 0\.41/);
  }
  for (const [name, text, expected] of [
    ["csv", "accuracy,loss\n0.41,0.2\n", '"value": 0.41'],
    ["csv-rows", "accuracy\n0.41\n0.42\n", "exactly one complete data row"],
    ["csv-header", "accuracy,accuracy\n0.41,0.42\n", "unique header"],
    ["csv-empty-header", ",accuracy\nignored,0.41\n", "unique header"],
    ["csv-unit", "accuracy\n41%\n", "without implicit unit conversion"],
    ["csv-nan", "accuracy\nNaN\n", "numeric cell"],
  ]) {
    const fixtureOptions = { ...config, outputFile: "result.csv", expectedText: "" };
    const result = await probeCommand(pyCommand(`import pathlib; pathlib.Path("result.csv").write_text(${JSON.stringify(text)})`), fixtureOptions, name);
    assert.ok(result.stdout.includes(expected), result.stdout);
  }
  const dottedCsv = await probeCommand(pyCommand('import pathlib; pathlib.Path("result.csv").write_text("test.accuracy\\n0.41\\n")'), { ...config, outputFile: "result.csv", metricKey: "test.accuracy", expectedText: "" }, "csv-dotted-column");
  assert.match(dottedCsv.stdout, /"value": 0\.41/);
  for (const [name, code, expected] of [
    ["duplicate-json", `print('{"accuracy":0.41,"accuracy":0.42}')`, /Duplicate JSON stdout/],
    ["boolean-json", `print('{"accuracy":true}')`, /finite number/],
  ]) {
    const fixture = structuredClone(report);
    fixture.evaluationDraft.entries[0].command = pyCommand(code);
    fixture.evaluationDraft.outputs[0].kind = "stdout-json";
    const fixtureOptions = candidateOptions(fixture, review);
    await assert.rejects(probeCommand(fixtureOptions.quickCommand, fixtureOptions, name), (error) => expected.test(error.stdout + error.stderr));
  }
  const filled = { ...argumentConfig, candidateReview: null, outputFile: "result.json", metricKey: "accuracy", metricTarget: 0.41, evaluation: config.evaluation };
  const argumentFixture = `import argparse,json; p=argparse.ArgumentParser(); p.add_argument("checkpoint"); p.add_argument("--config",required=True); a=p.parse_args(); assert a.checkpoint==${JSON.stringify(argumentValues["argument-1"])}; json.dump({"accuracy":0.41},open("result.json","w"))`;
  const argumentResult = await probeCommand(`${pyCommand(`import pathlib; pathlib.Path("evaluate.py").write_text(${JSON.stringify(argumentFixture)})`)} && ${candidateCommand(argumentEntry, argumentValues).command}`, filled, "quoted-arguments");
  assert.match(argumentResult.stdout, /"value": 0\.41/);
  console.log("PASS  Docker logging/comma/ANSI/JSON capture, single-row CSV and rejection of ambiguous CSV/units; quoted argument values");

  const extra = await request("/api/scan", { url: "https://github.com/ArsPoghosyan/KNN-From-Scratch" });
  const main = extra.evaluationDraft.entries.find((entry) => entry.command.includes("main.py"));
  const customOutput = extra.evaluationDraft.outputs.find((output) => output.entryIds.includes(main.id) && output.label === "Custom KNN accuracy");
  const exampleRef = extra.evaluationDraft.references.find((reference) => reference.value === 0.95);
  assert.throws(() => candidateOptions(extra, { entryId: main.id, outputId: customOutput.id, referenceId: exampleRef.id, confirmed: true }), /different README command/);
  const custom = candidateOptions(extra, { entryId: main.id, outputId: customOutput.id, referenceId: null, confirmed: true });
  custom.metricTarget = exampleRef.value;
  custom.evaluation.reference = `Declared comparison only: https://github.com/${extra.repository}/blob/${extra.commit}/README.md#L${exampleRef.evidence.line}; example belongs to another README command, not verified main.py protocol correspondence`;
  custom.evaluation.assetsInEntry = true;
  const observed = await wait(await request("/api/run", { url: `https://github.com/${extra.repository}`, commit: extra.commit, workflowId: "evaluation", executionOptions: custom, confirmUnknownCode: true }), false);
  assert.equal(observed.evaluation.status, observed.metric.value === exampleRef.value ? "MATCHED_REFERENCE" : "OUTSIDE_REFERENCE");
  assert.ok(Number.isFinite(observed.metric.value));
  assert.equal(observed.candidate.referenceConditionEdited, true);
  console.log(JSON.stringify({ repository: extra.repository, commit: extra.commit, observed: observed.metric.value, reference: exampleRef.value, status: observed.evaluation.status, scope: "original Iris software entry; README example is not independently verified correspondence" }));

  for (const url of ["https://github.com/ZSusskind/BTHOWeN", "https://github.com/jingyaogong/minimind", "https://github.com/kelhass/knn_from_scratch"]) {
    const other = await request("/api/scan", { url });
    assert.ok(other.evaluationDraft);
    if (other.repository === "ZSusskind/BTHOWeN") {
      assert.ok(other.evaluationDraft.references.some((reference) => reference.label.startsWith("Iris ·") && reference.value === 0.98));
      assert.deepEqual(other.evaluationDraft.entries[0].arguments.filter((argument) => argument.required).map((argument) => argument.name), ["model_fname", "dset_name"]);
    }
    if (other.repository === "kelhass/knn_from_scratch") {
      assert.ok(other.evaluationDraft.references.some((reference) => reference.value === 0.98));
      assert.ok(other.evaluationDraft.paths.some((path) => path.path === "Prog1data.xlsx" && path.matches.length === 0));
    }
    console.log(JSON.stringify({ repository: other.repository, commit: other.commit, entries: other.evaluationDraft.entries.length,
      references: other.evaluationDraft.references.length, outputs: other.evaluationDraft.outputs.length, scope: "scan-only; no automatic claim or repository execution" }));
  }
  console.log(`PASS  two real generic CPU entries, frozen replay, argument/format boundary checks and five-repository coverage; baseline ${job.id}`);
}
