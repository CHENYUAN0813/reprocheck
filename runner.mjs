import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const jobs = new Map();
const LOG_LIMIT = 200_000;

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

export function buildPreflight(report, workflowId, runtime, packageIndex = "readme") {
  const workflow = report.workflows?.find((candidate) => candidate.id === workflowId);
  if (!workflow) throw new Error("A valid reproduction workflow is required");

  const automatedSteps = workflow.steps
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
  const manualSteps = workflow.steps
    .filter((step) =>
      step.instruction
      && !automatedSteps.some((automated) => automated.id === step.id),
    )
    .map(({ id, title, instruction }) => ({ id, title, instruction }));
  const blockers = workflow.steps
    .filter((step) => step.status === "BLOCKED" || (step.status === "MISSING" && step.id !== "environment"))
    .map(({ id, title }) => ({ id, title }));

  return {
    repository: report.repository,
    commit: report.commit,
    workflow: { id: workflow.id, title: workflow.title, status: workflow.status },
    packageIndex,
    runtime,
    runnable: runtime.available && automatedSteps.length > 0 && blockers.length === 0,
    automatedSteps,
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
  if (packageIndex !== "pypi" || !/\bpip3?\s+install\b/i.test(command)) return command;
  const withoutIndexes = command.replace(
    /\s+(?:-i|--index-url|--extra-index-url)(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/gi,
    "",
  );
  return `${withoutIndexes} --index-url https://pypi.org/simple`;
}

export function buildDockerInvocation(preflight, containerName) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(preflight.repository)) throw new Error("Invalid repository identity");
  if (!/^[a-f\d]{40}$/i.test(preflight.commit)) throw new Error("Invalid commit identity");

  const script = [
    "set -eu",
    "git init -q /workspace",
    `git -C /workspace remote add origin https://github.com/${preflight.repository}.git`,
    `git -C /workspace fetch -q --depth 1 origin ${preflight.commit}`,
    "git -C /workspace checkout -q --detach FETCH_HEAD",
    ...preflight.automatedSteps.flatMap((step) => [
      `echo ::reprocheck-step::${step.id.replace(/[^\w.-]/g, "-")}`,
      "cd /workspace",
      rewritePackageIndex(normalizeCommand(step.command, preflight.repository), preflight.packageIndex),
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

function publicJob(job) {
  const progress = summarizeSteps(job.steps, job.log, job.status);
  return {
    id: job.id,
    repository: job.repository,
    commit: job.commit,
    workflowId: job.workflowId,
    packageIndex: job.packageIndex,
    status: job.status,
    log: job.log,
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

export function startRun(preflight) {
  if (preflight.workflow.id !== "quick") throw new Error("Only Quick verification can run in this version");
  if (!preflight.runnable) throw new Error("The selected workflow is not ready to run");

  const id = randomUUID();
  const containerName = `reprocheck-${id}`;
  const job = {
    id,
    containerName,
    repository: preflight.repository,
    commit: preflight.commit,
    workflowId: preflight.workflow.id,
    packageIndex: preflight.packageIndex ?? "readme",
    steps: preflight.automatedSteps.map(({ id, title }) => ({ id, title })),
    timeoutMinutes: preflight.limits.timeoutMinutes,
    status: "RUNNING",
    log: "",
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(id, job);

  const child = spawn("docker", buildDockerInvocation(preflight, containerName), {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const append = (chunk) => {
    job.log = `${job.log}${chunk}`.slice(-LOG_LIMIT);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (error) => {
    if (job.status !== "RUNNING") return;
    append(`${error.message}\n`);
    job.status = "FAILED";
    job.finishedAt = new Date().toISOString();
  });
  child.on("close", (code) => {
    clearTimeout(job.timer);
    if (job.status === "RUNNING") {
      job.status = code === 0 ? "SUCCEEDED" : code === 124 ? "TIMED_OUT" : "FAILED";
    }
    job.exitCode = code;
    job.finishedAt ??= new Date().toISOString();
    // ponytail: completed jobs stay in memory; add persistent storage when this becomes a multi-user service.
  });
  job.timer = setTimeout(() => {
    if (job.status !== "RUNNING") return;
    job.status = "TIMED_OUT";
    job.finishedAt = new Date().toISOString();
    execFile("docker", ["rm", "-f", containerName], { windowsHide: true }, () => {});
  }, preflight.limits.timeoutMinutes * 60_000);

  return publicJob(job);
}

export function getRun(id) {
  return jobs.has(id) ? publicJob(jobs.get(id)) : null;
}

export function cancelRun(id) {
  const job = jobs.get(id);
  if (!job || job.status !== "RUNNING") return null;
  job.status = "CANCELLED";
  job.finishedAt = new Date().toISOString();
  clearTimeout(job.timer);
  execFile("docker", ["rm", "-f", job.containerName], { windowsHide: true }, () => {});
  return publicJob(job);
}
