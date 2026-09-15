import assert from "node:assert/strict";
import { buildDockerInvocation, buildReplayPreflight, compareRuns, createRecipe, rewritePackageIndex, validateExecutionOptions, verifyOutcome } from "./runner.mjs";
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

const frozen = { ...sample, id: randomUUID(), repository: "owner/repo", commit: "a".repeat(40), workflowId: "quick", packageIndex: "readme",
  steps: [{ id: "install", title: "Install", command: "pip install example==1.0" }, { id: "run", title: "Run", command: "python demo.py" }],
  environment: { imageId: `sha256:${"b".repeat(64)}`, python: "3.11.9", platform: "Linux-test", capture: "before-entry", unlockedDependencies: [] },
  dependencies: ["example==1.0", "pip==24.0"], artifact: { sha256: "c".repeat(64) }, metric: { value: 0.95 }, verification: verifyOutcome(sample),
  limits: { cpus: 2, memory: "2 GB", timeoutMinutes: 10, hostMounts: false, networkAccess: true, image: "python:3.11" },
};
const recipe = createRecipe(frozen);
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
  async function execute(options) {
    let job = await request("/api/run", { ...input, executionOptions: options, confirmUnknownCode: true });
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
  const collector = readFileSync(new URL("./collect-evidence.py", import.meta.url), "utf8");
  await assert.rejects(promisify(execFile)("docker", ["run", "--rm", "--pull", "never", "--cpus", "2", "--memory", "2g",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--network", "none", job.environment.imageId,
    "python", "-c", collector, JSON.stringify({ lockedEnvironment: { python: job.environment.python, dependencies: ["missing-lock-package==1.0"] } }), "environment"],
    { timeout: 15_000, windowsHide: true }), (error) => /Locked Python\/dependency environment does not match/.test(error.stderr));
  console.log("PASS  actual container refuses an inconsistent pre-entry dependency lock");
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
