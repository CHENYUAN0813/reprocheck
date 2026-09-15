import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { getSavedRun, listSavedRuns, saveRun } from "./run-store.mjs";

const execFileAsync = promisify(execFile);
const jobs = new Map();
const LOG_LIMIT = 200_000;
const collector = readFileSync(new URL("./collect-evidence.py", import.meta.url), "utf8");

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
  const quickCommand = input.quickCommand ?? "";
  if (typeof quickCommand !== "string" || quickCommand.length > 2000 || /[\r\n\0]/.test(quickCommand)) {
    throw new Error("Quick command must be a single line of at most 2000 characters");
  }
  const expectedText = input.expectedText ?? "";
  const outputFile = input.outputFile ?? "";
  const metricKey = input.metricKey ?? "";
  const metricOperator = input.metricOperator ?? "gte";
  const metricTarget = input.metricTarget ?? null;
  if (typeof expectedText !== "string" || expectedText.length > 300 || /\0/.test(expectedText)) throw new Error("Expected text must be at most 300 characters");
  if (typeof outputFile !== "string" || outputFile.length > 240 || /[\\:\r\n\0]/.test(outputFile)
    || (outputFile && outputFile.split("/").some((part) => !part || part === "." || part === ".."))) {
    throw new Error("Output file must be a relative repository path without traversal");
  }
  if (typeof metricKey !== "string" || metricKey.length > 100 || (metricKey && !/^[\w-]+(?:\.[\w-]+)*$/.test(metricKey))) throw new Error("Invalid JSON metric key");
  if (!["gte", "lte"].includes(metricOperator)) throw new Error("Metric operator must be gte or lte");
  if ((metricKey || metricTarget !== null) && (!outputFile || !metricKey || typeof metricTarget !== "number" || !Number.isFinite(metricTarget))) {
    throw new Error("Metric needs an output file, JSON key and finite numeric target");
  }
  return { quickCommand: quickCommand.trim(), expectedText, outputFile, metricKey, metricOperator, metricTarget };
}

export function buildPreflight(report, workflowId, runtime, packageIndex = "readme", options = {}) {
  const executionOptions = validateExecutionOptions(options);
  const { quickCommand } = executionOptions;
  const workflow = report.workflows?.find((candidate) => candidate.id === workflowId);
  if (!workflow) throw new Error("A valid reproduction workflow is required");
  if (quickCommand && workflowId !== "quick") throw new Error("Only Quick verification supports a reviewed command");
  const originalSteps = workflow.steps;
  const entry = originalSteps.at(-1);
  if (quickCommand && !entry) throw new Error("No Quick entry point is available to replace");
  const steps = originalSteps.map((step) => step === entry && quickCommand
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

  return {
    repository: report.repository,
    commit: report.commit,
    workflow: { id: workflow.id, title: workflow.title, status: workflow.status },
    packageIndex,
    executionOptions,
    commandOverride: quickCommand ? { original: entry.command, actual: quickCommand, origin: "user-reviewed" } : null,
    runtime,
    runnable: workflowId === "quick" && runtime.available && automatedSteps.length > 0 && blockers.length === 0,
    reason: workflowId !== "quick" ? "Only Quick verification can execute in this version"
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

export function buildDockerInvocation(preflight, containerName) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(preflight.repository)) throw new Error("Invalid repository identity");
  if (!/^[a-f\d]{40}$/i.test(preflight.commit)) throw new Error("Invalid commit identity");
  const options = validateExecutionOptions(preflight.executionOptions);
  const collectCommand = `python -c ${shellQuote(collector)} ${shellQuote(JSON.stringify(options))}`;

  const script = [
    "set -eu",
    `trap ${shellQuote(`${collectCommand} finish`)} EXIT`,
    "git init -q /workspace",
    `git -C /workspace remote add origin https://github.com/${preflight.repository}.git`,
    `git -C /workspace fetch -q --depth 1 origin ${preflight.commit}`,
    "git -C /workspace checkout -q --detach FETCH_HEAD",
    `${collectCommand} start`,
    ...preflight.automatedSteps.flatMap((step) => [
      `echo ::reprocheck-step::${step.id.replace(/[^\w.-]/g, "-")}`,
      "cd /workspace",
      effectiveCommand(step, preflight.repository, preflight.packageIndex),
    ]),
  ].join("\n");

  return [
    "run",
    "--name", containerName,
    "--rm",
    "--init",
    "--pull", "missing",
    "--cpus", String(preflight.limits.cpus),
    "--memory", "2g",
    "--pids-limit", "256",
    "--security-opt", "no-new-privileges",
    "--cap-drop", "ALL",
    "--network", "bridge",
    "-e", "PIP_DISABLE_PIP_VERSION_CHECK=1",
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
  try { return line ? JSON.parse(line) : null; } catch { return null; }
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
    status: !evidence ? "UNKNOWN" : evidence.artifact?.fresh && evidence.artifact?.size > 0 && !evidence.artifact?.error ? "PASSED" : "FAILED",
    observed: evidence?.artifact ?? null,
  });
  if (options.metricKey) checks.push({
    id: "metric", expected: `${options.metricKey} ${options.metricOperator === "gte" ? ">=" : "<="} ${options.metricTarget}`,
    status: !evidence ? "UNKNOWN" : typeof evidence.metric?.value === "number" && !evidence.metric?.error
      && (options.metricOperator === "gte" ? evidence.metric.value >= options.metricTarget : evidence.metric.value <= options.metricTarget) ? "PASSED" : "FAILED",
    observed: evidence?.metric ?? null,
  });
  if (job.status !== "SUCCEEDED") {
    for (const check of checks) check.status = "NOT_RUN";
    return { status: job.status === "RUNNING" ? "PENDING" : checks.length ? "INCOMPLETE" : "NOT_CONFIGURED", checks };
  }
  return { status: !checks.length ? "NOT_CONFIGURED" : checks.some((check) => check.status === "FAILED") ? "FAILED"
    : checks.some((check) => check.status === "UNKNOWN") ? "INCOMPLETE" : "VERIFIED", checks };
}

function publicJob(job) {
  const progress = summarizeSteps(job.steps, job.log, job.status);
  return {
    schemaVersion: 1,
    id: job.id,
    repository: job.repository,
    commit: job.commit,
    workflowId: job.workflowId,
    packageIndex: job.packageIndex,
    executionOptions: job.executionOptions,
    commandOverride: job.commandOverride,
    environment: { image: job.limits.image, imageId: job.imageId ?? null, docker: job.runtime, ...readEvidence(job.log)?.environment },
    dependencies: readEvidence(job.log)?.dependencies ?? [],
    artifact: readEvidence(job.log)?.artifact ?? null,
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
  if (preflight.workflow.id !== "quick") throw new Error("Only Quick verification can run in this version");
  if (!preflight.runnable) throw new Error("The selected workflow is not ready to run");

  const id = randomUUID();
  const containerName = `reprocheck-${id}`;
  const dockerArgs = buildDockerInvocation(preflight, containerName);
  const job = {
    id,
    containerName,
    repository: preflight.repository,
    commit: preflight.commit,
    workflowId: preflight.workflow.id,
    packageIndex: preflight.packageIndex ?? "readme",
    executionOptions: validateExecutionOptions(preflight.executionOptions),
    commandOverride: preflight.commandOverride ?? null,
    experimentParameters: preflight.experimentParameters ?? [],
    limits: preflight.limits,
    runtime: preflight.runtime ?? null,
    steps: preflight.automatedSteps.map(({ id, title, command }) => ({ id, title, originalCommand: command,
      command: effectiveCommand({ id, command }, preflight.repository, preflight.packageIndex),
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
    stdio: ["ignore", "pipe", "pipe"],
  });
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
    .map(({ id, repository, commit, status, startedAt, finishedAt, verification }) => ({
      id, repository, commit, status, startedAt, finishedAt, verificationStatus: verification?.status ?? "NOT_CONFIGURED",
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
