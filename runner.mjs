import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual, promisify } from "node:util";
import { readFileSync } from "node:fs";
import { getSavedRun, listSavedRuns, saveRun } from "./run-store.mjs";
import { candidateWorkflow, captureMetricCommand, reviewedCandidate } from "./evaluation-config.mjs";
import { MODEL_EXPORT_LIMIT, validateExperiment } from "./experiment-config.mjs";

const execFileAsync = promisify(execFile);
const jobs = new Map();
const LOG_LIMIT = 900_000;
const collector = readFileSync(new URL("./collect-evidence.py", import.meta.url), "utf8");
export const reviewedBenchmark = JSON.parse(readFileSync(new URL("./examples/bthowen-iris.json", import.meta.url), "utf8"));
const trainingProfile = JSON.parse(readFileSync(new URL("./examples/bthowen-training.json", import.meta.url), "utf8"));
export const reviewedTraining = { ...reviewedBenchmark, id: trainingProfile.id, title: trainingProfile.title, model: trainingProfile.model,
  reference: { ...reviewedBenchmark.reference, scope: trainingProfile.scope }, assets: reviewedBenchmark.assets.filter((asset) => asset.role !== "checkpoint"), training: trainingProfile };
const benchmarkSource = readFileSync(new URL("./examples/evaluate-bthowen.py", import.meta.url), "utf8");
const benchmarkCommand = (phase) => `python -c ${shellQuote(`exec(${JSON.stringify(benchmarkSource)})`)} ${phase}`;
const trainingSource = readFileSync(new URL("./examples/train-bthowen.py", import.meta.url), "utf8");
const trainingCommand = () => `python -c ${shellQuote(`exec(${JSON.stringify(trainingSource)})`)}`;

function benchmarkOptions(id = reviewedBenchmark.id) {
  const benchmark = id === reviewedTraining.id ? reviewedTraining : reviewedBenchmark;
  return { benchmarkId: benchmark.id, quickCommand: benchmarkCommand("evaluate"), expectedText: "published-benchmark-ok",
    outputFile: "benchmark-result.json", metricKey: "accuracy", metricOperator: "eq", metricTarget: benchmark.reference.value,
    metricTolerance: benchmark.reference.tolerance, evaluation: { dataset: benchmark.dataset, model: benchmark.model,
      reference: benchmark.reference.url, assetsInEntry: false } };
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export async function inspectRuntime() {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["info", "--format", "{{.ServerVersion}}"],
      { timeout: 5000, windowsHide: true },
    );
    return { available: true, engine: "Docker", version: stdout.trim() };
  } catch (error) {
    return {
      available: false,
      engine: "Docker",
      reason: error?.code === "ENOENT"
        ? "Docker is not installed"
        : "Docker Desktop is not running",
    };
  }
}

export function validateExecutionOptions(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid execution options");
  const benchmarkId = input.benchmarkId ?? null;
  if (benchmarkId !== null && ![reviewedBenchmark.id, reviewedTraining.id].includes(benchmarkId)) throw new Error("Unknown reviewed benchmark");
  if (benchmarkId) input = { ...benchmarkOptions(benchmarkId), ...input };
  const quickCommand = input.quickCommand ?? "";
  if (typeof quickCommand !== "string" || quickCommand.length > 6000 || /[\r\n\0]/.test(quickCommand)) {
    throw new Error("Reviewed command must be a single line of at most 6000 characters");
  }
  const expectedText = input.expectedText ?? "";
  const outputFile = input.outputFile ?? "";
  const metricKey = input.metricKey ?? "";
  const metricOperator = input.metricOperator ?? "gte";
  const metricTarget = input.metricTarget ?? null;
  const metricTolerance = input.metricTolerance ?? 0;
  const evaluation = input.evaluation ?? null;
  const candidateReview = input.candidateReview ?? null;
  const experiment = input.experiment == null ? null : validateExperiment(input.experiment);
  if (experiment && (benchmarkId || candidateReview)) throw new Error("A custom experiment cannot be mixed with a reviewed preset/candidate");
  if (candidateReview !== null && (benchmarkId || typeof candidateReview !== "object" || Array.isArray(candidateReview)
    || Object.keys(candidateReview).some((key) => !["entryId", "referenceId", "outputId", "confirmed", "argumentValues"].includes(key))
    || (candidateReview.argumentValues !== undefined && (!candidateReview.argumentValues || typeof candidateReview.argumentValues !== "object" || Array.isArray(candidateReview.argumentValues)
      || Object.keys(candidateReview.argumentValues).length > 24 || Object.entries(candidateReview.argumentValues).some(([key, value]) => !/^argument-\d+$/.test(key) || typeof value !== "string" || value.length > 240 || /[\r\n\0]/.test(value))))
    || typeof candidateReview.entryId !== "string" || !/^[\w-]{1,80}$/.test(candidateReview.entryId)
    || ["referenceId", "outputId"].some((key) => candidateReview[key] !== null && (typeof candidateReview[key] !== "string" || !/^[\w-]{1,80}$/.test(candidateReview[key])))
    || candidateReview.confirmed !== true)) throw new Error("Generated candidate needs valid source selections and explicit review confirmation");
  if (typeof expectedText !== "string" || expectedText.length > 300 || /\0/.test(expectedText)) throw new Error("Expected text must be at most 300 characters");
  if (typeof outputFile !== "string" || outputFile.length > 240 || /[\\:\r\n\0]/.test(outputFile)
    || (outputFile && outputFile.split("/").some((part) => !part || part === "." || part === ".."))) {
    throw new Error("Output file must be a relative repository path without traversal");
  }
  if (typeof metricKey !== "string" || metricKey.length > 100 || (metricKey && !/^[\w-]+(?:\.[\w-]+)*$/.test(metricKey))) throw new Error("Invalid JSON metric key / CSV column");
  if (!["gte", "lte", "eq"].includes(metricOperator)) throw new Error("Metric operator must be gte, lte or eq");
  if (typeof metricTolerance !== "number" || !Number.isFinite(metricTolerance) || metricTolerance < 0) throw new Error("Metric tolerance must be finite and non-negative");
  if (metricOperator !== "eq" && metricTolerance !== 0) throw new Error("Tolerance applies only to reference matching");
  if ((metricKey || metricTarget !== null) && (!outputFile || !metricKey || typeof metricTarget !== "number" || !Number.isFinite(metricTarget))) {
    throw new Error("Metric needs an output file, JSON key / CSV column and finite numeric target");
  }
  if (evaluation !== null) {
    if (typeof evaluation !== "object" || Array.isArray(evaluation)
      || Object.keys(evaluation).some((key) => !["dataset", "model", "reference", "assetsInEntry"].includes(key))
      || ["dataset", "model", "reference"].some((key) => typeof evaluation[key] !== "string" || !evaluation[key].trim() || evaluation[key].length > 500 || /\0/.test(evaluation[key]))
      || typeof evaluation.assetsInEntry !== "boolean") throw new Error("Evaluation needs dataset, model, reference source and an explicit asset-preparation choice");
  }
  if (experiment && (!quickCommand.trim() || !evaluation || evaluation.assetsInEntry || !metricKey || metricTarget === null || outputFile === experiment.checkpoint)) throw new Error("Experiment needs a separate evaluator, metric output and declared evaluation context; checkpoint and score paths must differ");
  return { ...(benchmarkId ? { benchmarkId } : {}), ...(candidateReview ? { candidateReview: { ...candidateReview } } : {}), ...(experiment ? { experiment } : {}), quickCommand: quickCommand.trim(), expectedText, outputFile, metricKey, metricOperator, metricTarget, metricTolerance,
    evaluation: evaluation ? { dataset: evaluation.dataset.trim(), model: evaluation.model.trim(), reference: evaluation.reference.trim(), assetsInEntry: evaluation.assetsInEntry } : null };
}

export function buildPreflight(report, workflowId, runtime, packageIndex = "readme", options = {}) {
  const executionOptions = validateExecutionOptions(options);
  const { quickCommand } = executionOptions;
  const experiment = executionOptions.experiment;
  if (experiment && (workflowId !== "training" || experiment.repository !== report.repository || experiment.commit !== report.commit)) throw new Error("Custom experiment requires Training and its reviewed pinned repository/commit");
  if (executionOptions.candidateReview && workflowId !== "evaluation") throw new Error("Generated candidates apply only to Evaluation");
  const candidate = executionOptions.candidateReview ? reviewedCandidate(report, executionOptions.candidateReview, executionOptions) : null;
  let workflow = report.workflows?.find((candidate) => candidate.id === workflowId);
  if (!workflow) throw new Error("A valid reproduction workflow is required");
  if (candidate) workflow = candidateWorkflow(report, candidate.entry);
  const benchmark = executionOptions.benchmarkId ? { ...(executionOptions.benchmarkId === reviewedTraining.id ? reviewedTraining : reviewedBenchmark), originalSteps: report.reproductionPlan?.steps ?? [] } : null;
  const reviewedTrainingRun = workflowId === "training" && (!!benchmark?.training || !!experiment);
  if (benchmark) {
    if (!isDeepStrictEqual(executionOptions, benchmarkOptions(benchmark.id))) throw new Error("Reviewed benchmark commands and reference conditions are fixed; use a custom Evaluation instead");
    if (workflowId !== (benchmark.training ? "training" : "evaluation") || report.repository !== benchmark.repository || report.commit !== benchmark.commit) throw new Error("Reviewed benchmark requires its pinned repository, commit and matching Training/Evaluation workflow");
    workflow = { ...workflow, status: "REVIEWED_BENCHMARK", steps: [
      { id: "install", title: "Install reviewed Python 3.11 CPU compatibility dependencies", status: "DOCUMENTED", command: benchmark.installCommand },
      { id: "prepare-assets", title: "Prepare hash-locked UCI data and explicit compatibility patch", status: "DOCUMENTED", command: benchmarkCommand("prepare") },
      ...(benchmark.training ? [{ id: "training-benchmark", title: "Train original Table 3 Iris model from scratch and save checkpoint", status: "DOCUMENTED", command: trainingCommand() }] : []),
      { id: "evaluation-benchmark", title: benchmark.training ? "Evaluate newly trained checkpoint with the original entry" : "Run original Iris evaluation entry and collect its score", status: "DOCUMENTED", command: benchmarkCommand("evaluate") },
    ] };
  }
  if (experiment) workflow = { id: "training", title: experiment.title, status: "USER_REVIEWED_EXPERIMENT", steps: [
    ...(experiment.installCommand.trim() ? [{ id: "install", title: "Install reviewed experiment dependencies", status: "DOCUMENTED", command: experiment.installCommand }] : []),
    ...(experiment.prepareCommand.trim() ? [{ id: "prepare-data", title: "Prepare experiment data", status: "DOCUMENTED", command: experiment.prepareCommand }] : []),
    { id: "train", title: "Train and save a new model", status: "DOCUMENTED", command: experiment.trainCommand },
    { id: "evaluate", title: "Evaluate the new model", status: "DOCUMENTED", command: captureMetricCommand(normalizeCommand(quickCommand, report.repository), experiment.capture, executionOptions.metricKey, executionOptions.outputFile) },
  ] };
  if (quickCommand && !["quick", "evaluation"].includes(workflowId) && !reviewedTrainingRun) throw new Error("Only Quick and Evaluation support a reviewed command");
  if (workflowId === "evaluation" && (!executionOptions.evaluation || !executionOptions.metricKey || executionOptions.metricTarget === null)) throw new Error("Evaluation requires an output JSON/CSV metric and a declared dataset, model and reference source");
  if (workflowId !== "evaluation" && executionOptions.evaluation && !reviewedTrainingRun) throw new Error("Evaluation context is only accepted for Evaluation workflows");
  const assetsInEntry = executionOptions.evaluation?.assetsInEntry;
  if (assetsInEntry && !quickCommand) throw new Error("Entry-prepared assets require a reviewed Evaluation command");
  const originalSteps = workflowId === "evaluation" && !workflow.steps.length && quickCommand
    ? [...(report.reproductionPlan?.steps ?? []).filter((step) => ["environment", "install", "model", "data"].includes(step.id)),
      { id: "evaluation-reviewed", title: "User-reviewed evaluation entry point", status: "MISSING", command: null }]
    : workflow.steps;
  const entry = originalSteps.at(-1);
  if (quickCommand && !entry) throw new Error("No Quick entry point is available to replace");
  const steps = originalSteps.filter((step) => !assetsInEntry || !["data", "model"].includes(step.id)).map((step) => step === entry && quickCommand && !experiment
    ? { ...step, command: quickCommand, instruction: null, status: "REVIEWED_OVERRIDE" }
    : step);

  const automatedSteps = steps
    .map((step) => ({
      ...step,
      command: step.command ?? (
        /^(?:python3?|pip3?|poetry|uv|conda|modelscope|huggingface-cli|wget|curl|git|bash|sh|\.\/)/i.test(step.instruction ?? "")
          ? step.instruction
          : null
      ),
    }))
    .filter((step) => step.command)
    .map(({ id, title, command }) => ({ id, title, command }));
  const manualSteps = steps
    .filter((step) =>
      step.instruction
      && !automatedSteps.some((automated) => automated.id === step.id),
    )
    .map(({ id, title, instruction }) => ({ id, title, instruction }));
  const blockers = steps
    .filter((step) => step.status === "BLOCKED" || (step.status === "MISSING" && step.id !== "environment"))
    .map(({ id, title }) => ({ id, title }));
  if (workflowId === "evaluation") blockers.push(...manualSteps.filter((step) => step.id !== "environment").map(({ id, title }) => ({ id, title })));

  return {
    repository: report.repository,
    commit: report.commit,
    workflow: { id: workflow.id, title: workflow.title, status: workflow.status },
    packageIndex,
    executionOptions,
    benchmark,
    candidate,
    commandOverride: quickCommand && !benchmark && !experiment ? { original: entry.command, actual: quickCommand, origin: "user-reviewed" } : null,
    runtime,
    preparationOverride: assetsInEntry ? { origin: "user-reviewed", instruction: "Dataset and model preparation are handled by the reviewed entry command", originalSteps: originalSteps.filter((step) => ["data", "model"].includes(step.id)) } : null,
    runnable: (["quick", "evaluation"].includes(workflowId) || reviewedTrainingRun) && runtime.available && automatedSteps.length > 0 && blockers.length === 0,
    reason: !["quick", "evaluation"].includes(workflowId) && !reviewedTrainingRun ? "Training requires a confirmed custom experiment configuration or the reviewed Iris case"
      : !runtime.available ? runtime.reason : blockers.length ? "The workflow has missing or blocked steps"
        : !automatedSteps.length ? "No executable commands were found" : null,
    automatedSteps: automatedSteps.map((step) => ({ ...step,
      effectiveCommand: effectiveCommand(step, report.repository, packageIndex),
    })),
    experimentParameters: report.experimentParameters ?? [],
    manualSteps,
    blockers,
    limits: {
      timeoutMinutes: 10,
      memory: "2 GB",
      cpus: 2,
      hostMounts: false,
      networkAccess: true,
      image: "python:3.11",
    },
  };
}

function normalizeCommand(command, repository) {
  const name = repository.split("/").at(-1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return command.replace(new RegExp(`^\\s*(?:cd|pushd)\\s+(?:\\./)?${name}\\s*&&\\s*`, "i"), "");
}

export function rewritePackageIndex(command, packageIndex) {
  if (packageIndex !== "pypi") return command;
  if (!/^(?:python3?\s+-m\s+)?pip3?\s+install\b/i.test(command.trim())) throw new Error("Official PyPI retry requires a pip install command");
  // ponytail: rewrite a single pip command only; a shell parser is needed before supporting compound install commands.
  if (/[;&|`$]/.test(command.replace(/"[^"]*"|'[^']*'/g, ""))) throw new Error("Official PyPI retry needs a single pip install command, not a shell chain");
  const withoutIndexes = command.replace(
    /\s+(?:-i|--index-url|--extra-index-url)(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/gi,
    "",
  );
  return `${withoutIndexes} --index-url https://pypi.org/simple`;
}

function effectiveCommand(step, repository, packageIndex) {
  const command = normalizeCommand(step.command, repository);
  return step.id === "install" ? rewritePackageIndex(command, packageIndex) : command;
}

function sourceSteps(job) {
  return job.steps.filter((step) => !job.replayOf || !["restore-lock", "verify-lock"].includes(step.id));
}

export function createRecipe(job) {
  if (job.status !== "SUCCEEDED" || job.verification?.status !== "VERIFIED") throw new Error("Pass configured output checks before freezing a recipe");
  if ((!["quick", "evaluation"].includes(job.workflowId) && !(job.workflowId === "training" && (job.benchmark?.training || job.executionOptions?.experiment))) || !/^[\w.-]+\/[\w.-]+$/.test(job.repository) || !/^[a-f\d]{40}$/i.test(job.commit)) throw new Error("Invalid executable source identity");
  if (job.executionOptions?.experiment && (job.executionOptions.experiment.repository !== job.repository || job.executionOptions.experiment.commit !== job.commit)) throw new Error("Experiment source context does not match the saved record");
  if (job.executionOptions?.benchmarkId && (job.benchmark?.id !== job.executionOptions.benchmarkId || job.benchmark.repository !== job.repository
    || job.benchmark.commit !== job.commit)) throw new Error("Reviewed benchmark asset/source locks are missing from the saved record");
  if (job.executionOptions?.candidateReview && (job.candidate?.repository !== job.repository || job.candidate?.commit !== job.commit)) throw new Error("Reviewed candidate source context is missing from the saved record");
  if (!["readme", "pypi"].includes(job.packageIndex)) throw new Error("Invalid saved package source");
  if (!/^sha256:[a-f\d]{64}$/.test(job.environment?.imageId ?? "")) throw new Error("The exact Docker image ID was not observed; run again before freezing");
  if (job.environment?.capture !== "before-entry" || !/^3\.11\.\d+$/.test(job.environment.python ?? "")) throw new Error("A pre-entry Python/dependency snapshot is required; run again");
  if (!Array.isArray(job.environment.unlockedDependencies) || job.environment.unlockedDependencies.length) throw new Error("Direct/local dependency sources need an artifact lock; this version supports index packages only");
  const dependencies = job.dependencies;
  if (!Array.isArray(dependencies) || !dependencies.length || dependencies.length > 500
    || dependencies.some((item) => typeof item !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}==[A-Za-z0-9][A-Za-z0-9.!+_-]{0,100}$/.test(item))) throw new Error("Dependency snapshot cannot be safely restored");
  const names = dependencies.map((item) => item.split("==")[0].toLowerCase().replace(/[-_.]+/g, "-"));
  if (new Set(names).size !== names.length) throw new Error("Duplicate dependency names in snapshot");
  const commands = sourceSteps(job).map(({ id, title, command, originalCommand }) => ({ id, title, command, originalCommand: originalCommand ?? command }));
  if (!commands.length || commands.length > 20 || commands.some((step) => !/^[\w.-]{1,80}$/.test(step.id)
    || typeof step.title !== "string" || typeof step.command !== "string" || !step.command || step.command.length > 6000 || /[\r\n\0]/.test(step.command))) throw new Error("Invalid saved commands");
  if (new Set(commands.map((step) => step.id)).size !== commands.length) throw new Error("Duplicate command IDs");
  if (!/^python3?\s/.test(commands.at(-1).command) || commands.some((step) => /\b(?:conda|poetry|uv|virtualenv)\b|\bpython3?\s+-m\s+venv\b/.test(step.command))) throw new Error("Recipes currently support the container's default Python entry point, not alternate environment managers");
  // ponytail: restore index packages with pip wheels; artifact locks and other environment managers are deferred.
  for (const step of commands.filter((step) => step.id === "install")) rewritePackageIndex(step.command, "pypi");
  if (job.limits?.cpus !== 2 || job.limits.memory !== "2 GB" || job.limits.timeoutMinutes !== 10
    || job.limits.hostMounts !== false || job.limits.networkAccess !== true) throw new Error("Unsupported saved execution limits");
  const recipe = { schemaVersion: 1, baselineRunId: job.id, repository: job.repository, commit: job.commit,
    workflowId: job.workflowId, packageIndex: job.packageIndex, executionOptions: validateExecutionOptions(job.executionOptions),
    commandOverride: job.commandOverride ?? null, preparationOverride: job.preparationOverride ?? null, ...(job.benchmark ? { benchmark: job.benchmark } : {}), ...(job.candidate ? { candidate: job.candidate } : {}), imageId: job.environment.imageId, python: job.environment.python,
    dependencies: [...dependencies].sort(), commands, limits: { ...job.limits, image: job.environment.imageId },
    baselineResults: { artifact: job.artifact ?? null, metric: job.metric ?? null, ...(job.benchmark ? { assets: job.assets, reference: job.referenceEvidence } : {}) },
    warnings: ["Local image ID must still exist on this computer.", "Package versions are pinned, not wheel hashes or build artifacts.",
      "External data/models and randomness are not automatically frozen; equal results are not guaranteed."],
  };
  return { ...recipe, fingerprint: createHash("sha256").update(JSON.stringify(recipe)).digest("hex") };
}

export async function inspectLockedImage(imageId) {
  if (!/^sha256:[a-f\d]{64}$/.test(imageId ?? "")) throw new Error("Invalid locked image ID");
  try {
    const { stdout } = await execFileAsync("docker", ["image", "inspect", "--format", "{{.Id}}", imageId], { timeout: 5000, windowsHide: true });
    return stdout.trim() === imageId;
  } catch { return false; }
}

export function buildReplayPreflight(baseline, runtime, imageAvailable) {
  const recipe = createRecipe(baseline);
  return { repository: recipe.repository, commit: recipe.commit, workflow: { id: recipe.workflowId, title: "Locked recipe replay", status: "FROZEN" },
    packageIndex: recipe.packageIndex, executionOptions: recipe.executionOptions, commandOverride: recipe.commandOverride, preparationOverride: recipe.preparationOverride, benchmark: recipe.benchmark ?? null,
    candidate: recipe.candidate ?? null, runtime, runnable: runtime.available && imageAvailable, reason: !runtime.available ? runtime.reason
      : !imageAvailable ? "The locked image is missing locally; replay will not substitute a newer image" : null,
    recipe, replayOf: baseline.id, baseline: { ...baseline, log: undefined, recipe: undefined, comparison: undefined }, frozenCommands: true, experimentParameters: baseline.experimentParameters ?? [],
    automatedSteps: [
      { id: "restore-lock", title: "Restore pinned dependency versions", command: "python -m pip install --no-deps --only-binary=:all: --index-url https://pypi.org/simple -r /tmp/reprocheck-lock.txt" },
      ...recipe.commands.flatMap((step, index) => [
        ...((recipe.benchmark?.training ? step.id === "training-benchmark" : recipe.executionOptions.experiment ? step.id === "train" : index === recipe.commands.length - 1)
          ? [{ id: "verify-lock", title: "Verify Python and dependency lock", command: "Verify the observed pre-entry environment against the recipe" }] : []),
        step,
      ]),
    ], manualSteps: [], blockers: [], limits: recipe.limits,
  };
}

export function compareRuns(baseline, current) {
  const rows = [];
  function compare(id, before, after, extra = {}) {
    rows.push({ id, baseline: before ?? null, current: after ?? null,
      status: before === undefined || before === null || after === undefined || after === null ? "UNKNOWN"
        : JSON.stringify(before) === JSON.stringify(after) ? "SAME" : "DIFFERENT", ...extra });
  }
  compare("source", `${baseline.repository}@${baseline.commit}`, `${current.repository}@${current.commit}`);
  compare("image", baseline.environment?.imageId, current.environment?.imageId);
  compare("python", baseline.environment?.python, current.environment?.python);
  compare("platform", baseline.environment?.platform, current.environment?.platform);
  const normalize = (items) => items?.map((item) => {
    const [name, version] = item.split("==");
    return `${name.toLowerCase().replace(/[-_.]+/g, "-")}==${version}`;
  }).sort();
  compare("dependencies", normalize(baseline.dependencies), normalize(current.dependencies));
  compare("commands", sourceSteps(baseline).map((step) => step.command), sourceSteps(current).map((step) => step.command));
  compare("expectations", validateExecutionOptions(baseline.executionOptions), validateExecutionOptions(current.executionOptions));
  if (baseline.executionOptions?.experiment) compare("trained-checkpoint", baseline.trainingCheckpoint?.sha256, current.trainingCheckpoint?.sha256);
  if (baseline.candidate) compare("candidate-sources", baseline.candidate, current.candidate);
  compare("limits", baseline.limits && { ...baseline.limits, image: undefined }, current.limits && { ...current.limits, image: undefined });
  if (baseline.executionOptions?.expectedText) compare("text-check", baseline.verification?.checks?.find((check) => check.id === "text")?.status,
    current.verification?.checks?.find((check) => check.id === "text")?.status);
  if (baseline.executionOptions?.outputFile) compare("output-hash", baseline.artifact?.sha256, current.artifact?.sha256);
  if (baseline.executionOptions?.metricKey) {
    const before = baseline.metric?.value, after = current.metric?.value;
    compare("metric", before, after, { key: baseline.executionOptions.metricKey,
      delta: Number.isFinite(before) && Number.isFinite(after) ? after - before : null });
  }
  if (baseline.benchmark) {
    compare("asset-hashes", baseline.assets?.map(({ path, sha256 }) => ({ path, sha256 })), current.assets?.map(({ path, sha256 }) => ({ path, sha256 })));
    compare("reference-source", baseline.referenceEvidence, current.referenceEvidence);
    if (baseline.benchmark.training) compare("trained-checkpoint", baseline.trainingCheckpoint?.sha256, current.trainingCheckpoint?.sha256);
  }
  return { baselineRunId: baseline.id, status: current.status === "RUNNING" ? "PENDING"
    : baseline.status !== "SUCCEEDED" || baseline.verification?.status !== "VERIFIED" || current.status !== "SUCCEEDED" || current.verification?.status !== "VERIFIED" || rows.some((row) => row.status === "UNKNOWN") ? "INCOMPLETE"
      : rows.some((row) => row.status === "DIFFERENT") ? "DIFFERENT" : "SAME", rows };
}

export function buildDockerInvocation(preflight, containerName) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(preflight.repository)) throw new Error("Invalid repository identity");
  if (!/^[a-f\d]{40}$/i.test(preflight.commit)) throw new Error("Invalid commit identity");
  const options = { ...validateExecutionOptions(preflight.executionOptions), ...(preflight.benchmark ? { benchmark: preflight.benchmark } : {}), ...(preflight.recipe ? {
    lockedEnvironment: { python: preflight.recipe.python, dependencies: preflight.recipe.dependencies },
  } : {}) };
  const collectCommand = `python -c ${shellQuote(collector)} ${shellQuote(JSON.stringify(options))}`;

  const script = [
    "set -eu",
    `collect() { ${collectCommand} "$1"; }`,
    "trap 'collect finish' EXIT",
    "git init -q /workspace",
    `git -C /workspace remote add origin https://github.com/${preflight.repository}.git`,
    `git -C /workspace fetch -q --depth 1 origin ${preflight.commit}`,
    "git -C /workspace checkout -q --detach FETCH_HEAD",
    "collect start",
    ...(preflight.benchmark ? [`printf '%s' ${shellQuote(JSON.stringify(preflight.benchmark))} > /tmp/reprocheck-benchmark.json`] : []),
    ...(preflight.recipe ? [
      `printf '%s\\n' ${shellQuote(preflight.recipe.dependencies.join("\n"))} > /tmp/reprocheck-lock.txt`,
      "export PIP_CONSTRAINT=/tmp/reprocheck-lock.txt PIP_ONLY_BINARY=:all:",
    ] : []),
    ...preflight.automatedSteps.flatMap((step) => [
      ...(!preflight.recipe && (preflight.benchmark?.training ? step.id === "training-benchmark" : options.experiment ? step.id === "train" : step === preflight.automatedSteps.at(-1)) ? ["collect environment"] : []),
      ...(options.experiment && step.id === "evaluate" ? ["collect checkpoint"] : []),
      ...(preflight.benchmark?.training && step.id === "evaluation-benchmark" ? ["collect inputs"] : []),
      `echo ::reprocheck-step::${step.id.replace(/[^\w.-]/g, "-")}`,
      "cd /workspace",
      preflight.recipe && step.id === "verify-lock" ? "collect environment"
        : preflight.frozenCommands ? step.command : effectiveCommand(step, preflight.repository, preflight.packageIndex),
    ]),
  ].join("\n");

  return [
    "run",
    "--name", containerName,
    "--rm",
    "--init",
    "--pull", preflight.recipe ? "never" : "missing",
    "--cpus", String(preflight.limits.cpus),
    "--memory", "2g",
    "--pids-limit", "256",
    "--security-opt", "no-new-privileges",
    "--cap-drop", "ALL",
    "--network", "bridge",
    "-e", "PIP_DISABLE_PIP_VERSION_CHECK=1",
    "-e", "PYTHONUNBUFFERED=1",
    preflight.limits.image,
    "timeout", "--signal=TERM", `${preflight.limits.timeoutMinutes}m`,
    "sh", "-lc", script,
  ];
}

export function summarizeSteps(steps, log, runStatus) {
  const markers = [...log.matchAll(/^::reprocheck-step::([^\r\n]+)/gm)].map((match) => match[1]);
  const currentId = markers.at(-1) ?? null;
  const currentIndex = steps.findIndex((step) => step.id === currentId);
  const summarized = steps.map((step, index) => ({
    ...step,
    status: runStatus === "SUCCEEDED" || index < currentIndex
      ? "PASSED"
      : index === currentIndex
        ? runStatus === "RUNNING" ? "RUNNING" : runStatus
        : "PENDING",
  }));

  return {
    steps: summarized,
    currentStep: summarized[currentIndex] ?? null,
    failureStep: ["FAILED", "TIMED_OUT", "CANCELLED"].includes(runStatus)
      ? summarized[currentIndex] ?? { id: "setup", title: "Container setup", status: runStatus }
      : null,
  };
}

export function diagnoseRun(status, log, failureStep, timeoutMinutes, packageIndex = "readme") {
  if (status === "TIMED_OUT") {
    const retryHint = failureStep?.id === "install" && packageIndex === "readme" ? "retry with official PyPI or " : "";
    return `${failureStep?.title ?? "The run"} exceeded ${timeoutMinutes} minutes; ${retryHint}use a smaller environment.`;
  }
  if (status === "FAILED") {
    const missingModule = log.match(/No module named ['"]?([\w.-]+)/i)?.[1];
    if (missingModule) return `Python module ${missingModule} is missing; add it to the documented dependencies.`;
    return `${failureStep?.title ?? "The run"} exited with an error; inspect the final log lines.`;
  }
  return null;
}

export function readEvidence(log) {
  const line = [...log.matchAll(/^::reprocheck-evidence::([^\r\n]+)/gm)].at(-1)?.[1];
  try {
    const evidence = line ? JSON.parse(line) : null;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
    if (evidence.dependencies !== undefined && (!Array.isArray(evidence.dependencies)
      || evidence.dependencies.length > 500 || evidence.dependencies.some((item) => typeof item !== "string" || item.length > 240))) return null;
    for (const key of ["environment", "artifact", "metric", "evaluationOutput", "trainingCheckpoint"]) {
      if (evidence[key] != null && (typeof evidence[key] !== "object" || Array.isArray(evidence[key]))) return null;
    }
    if (evidence.assets != null && (!Array.isArray(evidence.assets) || evidence.assets.length > 10
      || evidence.assets.some((asset) => !asset || typeof asset !== "object" || Array.isArray(asset)))) return null;
    if (evidence.referenceEvidence != null && (typeof evidence.referenceEvidence !== "object" || Array.isArray(evidence.referenceEvidence))) return null;
    if (evidence.trainingCheckpoint?.base64) {
      const model = evidence.trainingCheckpoint;
      if (typeof model.base64 !== "string" || model.base64.length > Math.ceil(MODEL_EXPORT_LIMIT / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(model.base64)) return null;
      const bytes = Buffer.from(model.base64, "base64");
      if (bytes.length !== model.size || bytes.length > MODEL_EXPORT_LIMIT || bytes.toString("base64") !== model.base64 || createHash("sha256").update(bytes).digest("hex") !== model.sha256) return null;
    }
    return evidence;
  } catch { return null; }
}

function metricMatches(value, options) {
  if (!Number.isFinite(value)) return false;
  if (options.metricOperator === "gte") return value >= options.metricTarget;
  if (options.metricOperator === "lte") return value <= options.metricTarget;
  const delta = Math.abs(value - options.metricTarget);
  return Number.isFinite(delta) && (delta <= options.metricTolerance || options.metricTolerance > 0
    && delta - options.metricTolerance <= Number.EPSILON * Math.max(Math.abs(value), Math.abs(options.metricTarget), options.metricTolerance));
}

export function verifyOutcome(job) {
  const options = validateExecutionOptions(job.executionOptions);
  const checks = [];
  const evidence = readEvidence(job.log);
  const lastStep = job.steps.at(-1)?.id;
  const marker = `::reprocheck-step::${lastStep}\n`;
  const boundary = job.log.lastIndexOf(marker);
  const output = boundary < 0 ? null : job.log.slice(boundary + marker.length).split("::reprocheck-evidence::")[0];
  if (options.expectedText) checks.push({
    id: "text", expected: options.expectedText,
    status: output === null ? "UNKNOWN" : output.includes(options.expectedText) ? "PASSED" : "FAILED",
  });
  if (options.outputFile) checks.push({
    id: "file", expected: options.outputFile,
    status: !evidence ? "UNKNOWN" : evidence.artifact?.fresh === true && Number.isFinite(evidence.artifact?.size) && evidence.artifact.size > 0 && !evidence.artifact?.error ? "PASSED" : "FAILED",
    observed: evidence?.artifact ?? null,
  });
  if (options.metricKey) checks.push({
    id: "metric", expected: `${options.metricKey} ${options.metricOperator === "eq" ? "=" : options.metricOperator === "gte" ? ">=" : "<="} ${options.metricTarget}${options.metricOperator === "eq" ? ` ± ${options.metricTolerance}` : ""}`,
    status: !evidence ? "UNKNOWN" : !evidence.metric?.error && metricMatches(evidence.metric?.value, options) ? "PASSED" : "FAILED",
    observed: evidence?.metric ?? null,
  });
  if (options.experiment) {
    const observed = evidence?.trainingCheckpoint;
    checks.push({ id: "trained-checkpoint", expected: `New ${options.experiment.checkpoint}, saved during training and unchanged during evaluation`,
      status: !observed ? "UNKNOWN" : observed.path === options.experiment.checkpoint && observed.fresh === true && observed.status === "PASSED" && !!observed.base64 ? "PASSED" : "FAILED",
      observed: observed ? { ...observed, base64: undefined } : null });
  }
  if (job.benchmark) {
    if (job.benchmark.training) {
      const observed = evidence?.trainingCheckpoint;
      checks.push({ id: "trained-checkpoint", expected: `New ${job.benchmark.training.checkpoint}, saved by original trainer and unchanged during evaluation`,
        status: !observed ? "UNKNOWN" : observed.path === job.benchmark.training.checkpoint && observed.fresh === true && observed.status === "PASSED" && !!observed.base64 ? "PASSED" : "FAILED", observed: observed ? { ...observed, base64: undefined } : null });
    }
    for (const asset of job.benchmark.assets) {
      const observed = evidence?.assets?.find((item) => item.path === asset.path);
      checks.push({ id: `asset:${asset.role}`, expected: `${asset.path} SHA-256 ${asset.sha256}`,
        status: !observed ? "UNKNOWN" : observed.status === "PASSED" && observed.capture === "before-and-after-entry" && observed.sha256 === asset.sha256 && !observed.error ? "PASSED" : "FAILED", observed: observed ?? null });
    }
    const observed = evidence?.referenceEvidence;
    checks.push({ id: "reference-source", expected: `${job.benchmark.reference.file}:${job.benchmark.reference.line} = ${options.metricTarget}`,
      status: !observed ? "UNKNOWN" : observed.status === "PASSED" && observed.text === job.benchmark.reference.text && observed.value === options.metricTarget ? "PASSED" : "FAILED", observed: observed ?? null });
  }
  if (job.status !== "SUCCEEDED") {
    for (const check of checks) check.status = "NOT_RUN";
    return { status: job.status === "RUNNING" ? "PENDING" : checks.length ? "INCOMPLETE" : "NOT_CONFIGURED", checks };
  }
  return { status: !checks.length ? "NOT_CONFIGURED" : checks.some((check) => check.status === "FAILED") ? "FAILED"
    : checks.some((check) => check.status === "UNKNOWN") ? "INCOMPLETE" : "VERIFIED", checks };
}

function publicJob(job) {
  const progress = summarizeSteps(job.steps, job.log, job.status);
  const evidence = readEvidence(job.log);
  const record = {
    schemaVersion: 1,
    id: job.id,
    repository: job.repository,
    commit: job.commit,
    workflowId: job.workflowId,
    packageIndex: job.packageIndex,
    executionOptions: job.executionOptions,
    benchmark: job.benchmark ?? null,
    candidate: job.candidate ?? null,
    assets: evidence?.assets ?? null,
    referenceEvidence: evidence?.referenceEvidence ?? null,
    trainingCheckpoint: evidence?.trainingCheckpoint ?? null,
    experiment: job.executionOptions?.experiment ?? null,
    commandOverride: job.commandOverride,
    preparationOverride: job.preparationOverride ?? null,
    environment: { ...evidence?.environment, image: job.limits.image, imageId: job.imageId ?? null, docker: job.runtime },
    dependencies: evidence?.dependencies ?? [],
    artifact: evidence?.artifact ?? null,
    metric: evidence?.metric ?? null,
    replayOf: job.replayOf ?? null,
    experimentParameters: job.experimentParameters,
    limits: job.limits,
    verification: verifyOutcome(job),
    status: job.status,
    log: job.log,
    logTruncated: job.logTruncated ?? false,
    persistenceError: job.persistenceError ?? null,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    ...progress,
    diagnosis: diagnoseRun(
      job.status,
      job.log,
      progress.failureStep,
      job.timeoutMinutes,
      job.packageIndex,
    ),
  };
  const options = validateExecutionOptions(job.executionOptions);
  record.evaluation = options.evaluation ? { ...options.evaluation, declaration: job.benchmark ? "reviewed pinned software benchmark; container-observed asset hashes and source row, not a security attestation" : "user-provided, not independently verified", metricKey: options.metricKey,
    operator: options.metricOperator, referenceValue: options.metricTarget, tolerance: options.metricTolerance,
    observedValue: Number.isFinite(record.metric?.value) ? record.metric.value : null,
    delta: Number.isFinite(record.metric?.value) ? record.metric.value - options.metricTarget : null,
    output: evidence?.evaluationOutput ?? null,
    status: job.status === "RUNNING" ? "PENDING" : record.verification.status === "VERIFIED" ? "MATCHED_REFERENCE"
      : job.status === "SUCCEEDED" && Number.isFinite(record.metric?.value) && !record.metric?.error
        && record.verification.checks.every((check) => check.id === "metric" ? check.status === "FAILED" : check.status === "PASSED") ? "OUTSIDE_REFERENCE" : "INCOMPLETE" } : null;
  record.comparison = job.baseline ? compareRuns(job.baseline, record) : null;
  try { record.recipe = createRecipe(record); record.recipeUnavailableReason = null; }
  catch (error) { record.recipe = null; record.recipeUnavailableReason = error.message; }
  return record;
}

function persist(job) {
  try {
    job.persistenceError = null;
    saveRun(publicJob(job));
    job.lastSaved = Date.now();
  } catch (error) {
    job.persistenceError = `Run evidence could not be saved: ${error.message}`;
  }
}

export function startRun(preflight) {
  if (!["quick", "evaluation"].includes(preflight.workflow.id) && !(preflight.workflow.id === "training" && (preflight.benchmark?.training || preflight.executionOptions?.experiment))) throw new Error("Training requires a confirmed experiment or reviewed Iris case");
  if (!preflight.runnable) throw new Error("The selected workflow is not ready to run");

  const id = randomUUID();
  const containerName = `reprocheck-${id}`;
  const dockerArgs = buildDockerInvocation(preflight, containerName);
  // Keep embedded adapters off Windows' 32 KiB process-command-line limit.
  const script = dockerArgs.pop();
  dockerArgs.push('exec sh -lc "$(cat)" </dev/null');
  dockerArgs.splice(1, 0, "-i");
  const job = {
    id,
    containerName,
    repository: preflight.repository,
    commit: preflight.commit,
    workflowId: preflight.workflow.id,
    packageIndex: preflight.packageIndex ?? "readme",
    replayOf: preflight.replayOf ?? null,
    baseline: preflight.baseline ?? null,
    executionOptions: validateExecutionOptions(preflight.executionOptions),
    benchmark: preflight.benchmark ?? null,
    candidate: preflight.candidate ?? null,
    commandOverride: preflight.commandOverride ?? null,
    preparationOverride: preflight.preparationOverride ?? null,
    experimentParameters: preflight.experimentParameters ?? [],
    limits: preflight.limits,
    runtime: preflight.runtime ?? null,
    steps: preflight.automatedSteps.map(({ id, title, command, originalCommand }) => ({ id, title, originalCommand: originalCommand ?? command,
      command: preflight.frozenCommands ? command : effectiveCommand({ id, command }, preflight.repository, preflight.packageIndex),
    })),
    timeoutMinutes: preflight.limits.timeoutMinutes,
    status: "RUNNING",
    log: "",
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  saveRun(publicJob(job));
  job.lastSaved = Date.now();
  jobs.set(id, job);

  const child = spawn("docker", dockerArgs, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {}); // Docker startup failure is reported by error/close below.
  child.stdin.end(script);
  const append = (chunk) => {
    const log = `${job.log}${chunk}`;
    job.logTruncated ||= log.length > LOG_LIMIT;
    job.log = log.slice(-LOG_LIMIT);
    if (!job.inspectStarted && job.log.includes("::reprocheck-step::")) {
      job.inspectStarted = true;
      job.imageInspection = execFileAsync("docker", ["inspect", "--format", "{{.Image}}", containerName], { timeout: 5000, windowsHide: true })
        .then(({ stdout }) => { job.imageId = stdout.trim(); }).catch(() => {});
    }
    if (Date.now() - job.lastSaved > 1000) persist(job);
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (error) => {
    if (job.status !== "RUNNING") return;
    append(`${error.message}\n`);
    job.status = "FAILED";
    job.finishedAt = new Date().toISOString();
    persist(job);
  });
  child.on("close", async (code) => {
    clearTimeout(job.timer);
    await job.imageInspection;
    if (job.status === "RUNNING") {
      job.status = code === 0 ? "SUCCEEDED" : code === 124 ? "TIMED_OUT" : "FAILED";
    }
    job.exitCode = code;
    job.finishedAt ??= new Date().toISOString();
    persist(job);
    if (!job.persistenceError) jobs.delete(id);
  });
  job.timer = setTimeout(() => {
    if (job.status !== "RUNNING") return;
    job.status = "TIMED_OUT";
    job.finishedAt = new Date().toISOString();
    persist(job);
    execFile("docker", ["rm", "-f", containerName], { windowsHide: true }, () => {});
  }, preflight.limits.timeoutMinutes * 60_000);

  return publicJob(job);
}

export function getRun(id) {
  return jobs.has(id) ? publicJob(jobs.get(id)) : getSavedRun(id);
}

export function listRuns() {
  const records = new Map(listSavedRuns().map((job) => [job.id, job]));
  for (const [id, job] of jobs) records.set(id, publicJob(job));
  return [...records.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 30)
    .map(({ id, repository, commit, workflowId, evaluation, status, startedAt, finishedAt, verification }) => ({
      id, repository, commit, workflowId, evaluationStatus: evaluation?.status ?? null, status, startedAt, finishedAt, verificationStatus: verification?.status ?? "NOT_CONFIGURED",
    }));
}

export function cancelRun(id) {
  const job = jobs.get(id);
  if (!job || job.status !== "RUNNING") return null;
  job.status = "CANCELLED";
  job.finishedAt = new Date().toISOString();
  persist(job);
  clearTimeout(job.timer);
  execFile("docker", ["rm", "-f", job.containerName], { windowsHide: true }, () => {});
  return publicJob(job);
}
