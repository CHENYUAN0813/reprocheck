import { buildEvaluationDraft, discoverPaperProvenance, suggestCandidate } from "./evaluation-config.mjs";
import { buildPaperWorkflowDraft } from "./paper-workflow.mjs";
import { buildProtocolLock } from "./protocol-lock.mjs";
import { buildPaperMatrixDraft } from "./paper-matrix.mjs";

function expectEqual(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function parseRepo(input) {
  const url = new URL(input);
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.hostname !== "github.com" || parts.length !== 2) {
    throw new Error("请输入仓库首页地址，例如 https://github.com/owner/repo");
  }

  return {
    owner: parts[0],
    repo: parts[1].replace(/\.git$/, ""),
  };
}

function findMatchingLine(text, pattern) {
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));

  return index === -1
    ? null
    : { line: index + 1, text: lines[index].trim() };
}

function findInstallCommand(text) {
  return findMatchingLine(
    text,
    /\b(?:pip3? install|poetry install|uv sync|conda env create)\b/i,
  );
}

function classifyRunCommand(command, section = "") {
  const direct = command.toLowerCase();
  const context = section.toLowerCase();
  const script = direct.match(/(?:^|\s)([\w./-]+\.py)\b/)?.[1]?.split("/").at(-1) ?? "";
  const scriptCategories = [
    ["preprocess", /preprocess|prepare|tokeniz|dataset|data/],
    ["evaluation", /^(?:eval|evaluate|benchmark|test)/],
    ["training", /train|finetun|pretrain|sft|dpo|grpo|ppo|lora/],
    ["inference", /infer|predict|generate|chat|conversation/],
    ["demo", /demo|web|server|serve|gradio|streamlit/],
  ];
  const categories = [
    ["preprocess", /preprocess|prepare|tokeniz|dataset|\bdata\b|预处理|数据|分词/],
    ["evaluation", /eval|evaluate|benchmark|\btest\b|评估|测评|测试/],
    ["inference", /infer|predict|generate|chat|conversation|推理|对话|聊天|生成/],
    ["demo", /demo|web|server|serve|gradio|streamlit|演示|部署|服务/],
    ["training", /train|finetun|fine[-_ ]?tun|sft|dpo|grpo|ppo|lora|训练|微调/],
  ];

  return scriptCategories.find(([, pattern]) => pattern.test(script))?.[0]
    ?? categories.find(([, pattern]) => pattern.test(context))?.[0]
    ?? categories.find(([, pattern]) => pattern.test(direct))?.[0]
    ?? "other";
}

function findRunCommands(text) {
  const lines = text.split(/\r?\n/);
  const commands = [];
  const seen = new Set();
  let section = null;
  let inCodeFence = false;

  // ponytail: classify README commands by names and nearby headings; add a Markdown parser when measured accuracy needs nested context.
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*(?:```|~~~)/.test(lines[index])) {
      inCodeFence = !inCodeFence;
      continue;
    }

    const heading = !inCodeFence
      ? lines[index].match(/^\s*#{1,6}\s+(.+?)\s*$/)?.[1]
      : null;
    if (heading) section = heading;

    const text = lines[index].trim();
    const runnable = /^(?:[-*]\s+)?(?:[$>]\s*)?(?:(?:cd|pushd)\s+\S+\s*&&\s*)?(?:python3?(?:\s+-m\s+\S+|\s+\S+\.py\b)|torchrun\s+.*?\.py\b|accelerate\s+launch\s+.*?\.py\b)/i.test(text);
    const placeholder = /(?:^|[/_.-])xxx(?:[/_.-]|$)|<[^>]+>|\{[^}]+\}/i.test(text);
    if (!runnable || placeholder || seen.has(text)) continue;

    commands.push({
      line: index + 1,
      text,
      section,
      category: classifyRunCommand(text, section ?? ""),
    });
    seen.add(text);
    if (commands.length === 60) break;
  }

  return commands;
}

function findRunCommand(text) {
  const command = findRunCommands(text)[0];
  return command ? { line: command.line, text: command.text } : null;
}

function findActionableInstruction(text, subjectPattern) {
  const lines = text.split(/\r?\n/);
  const actionPattern = /\b(?:download|prepare|fetch|place|copy|wget|curl|git clone|huggingface-cli|modelscope)\b|下载|获取|准备|放入|复制/i;
  const commandPattern = /\b(?:wget|curl|git clone|huggingface-cli|modelscope)\b/i;
  const candidates = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) =>
      subjectPattern.test(line) &&
      actionPattern.test(line) &&
      (/^\s*#{1,6}\s+/.test(line) || /https?:\/\/|\[[^\]]+\]\([^)]+\)/.test(line) || commandPattern.test(line)),
    );
  const match = candidates.find(({ line }) =>
    /https?:\/\/|\[[^\]]+\]\([^)]+\)/.test(line) || commandPattern.test(line),
  ) ?? candidates[0];

  return !match
    ? null
    : { line: match.index + 1, text: match.line.trim() };
}

function findDataInstructions(text) {
  return findActionableInstruction(
    text,
    /\b(?:data|dataset)\b|数据(?:集)?/i,
  );
}

function findModelInstructions(text) {
  return findActionableInstruction(
    text,
    /\b(?:model|weights?|checkpoint|pre-?trained)\b|模型|权重|检查点/i,
  );
}

function isLicenseFile(name) {
  return /^(?:licen[cs]e|copying)(?:[.-]|$)/i.test(name);
}

function isTestPath(path) {
  return /(?:^|\/)(?:tests?(?:\/|$)|(?:test_.+|.+_test)\.py$|(?:pytest\.ini|tox\.ini|noxfile\.py)$)/i.test(path);
}

function isDependencyFile(path) {
  const name = path.split("/").at(-1).toLowerCase();
  return (
    /^requirements(?:[-_.].*)?\.txt$/.test(name) ||
    [
      "pyproject.toml",
      "poetry.lock",
      "uv.lock",
      "pipfile",
      "pipfile.lock",
      "environment.yml",
      "environment.yaml",
    ].includes(name)
  );
}

function analyzeDependencyVersions(path, text) {
  const name = path.split("/").at(-1).toLowerCase();

  if (["poetry.lock", "uv.lock", "pipfile.lock"].includes(name)) {
    return { verifiable: true, lockFile: true, total: null, unpinned: [] };
  }

  if (!/^requirements(?:[-_.].*)?\.txt$/.test(name)) {
    return { verifiable: false, lockFile: false, total: null, unpinned: [] };
  }

  const dependencies = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+#.*$/, "").trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("-"));
  const unpinned = dependencies.filter(
    (line) =>
      !/^[A-Za-z0-9_.-]+(?:\[[^\]]+\])?\s*={2,3}\s*[^\s;,*]+(?:\s*;.*)?$/.test(
        line,
      ),
  );

  return {
    verifiable: true,
    lockFile: false,
    total: dependencies.length,
    unpinned,
  };
}

function analyzePythonVersion(path, text) {
  const name = path.split("/").at(-1).toLowerCase();
  let match = null;

  if ([".python-version", "runtime.txt"].includes(name)) {
    match = text.match(/(?:python-)?(\d+\.\d+(?:\.\d+)?)/i);
  } else if (name === "dockerfile") {
    match = text.match(/^\s*FROM\s+python:(\d+\.\d+(?:\.\d+)?)/im);
  } else if (["environment.yml", "environment.yaml"].includes(name)) {
    match = text.match(/^\s*-\s*python\s*=\s*(\d+\.\d+(?:\.\d+)?)/im);
  } else if (name === "pyproject.toml") {
    match = text.match(/^\s*(?:requires-python|python)\s*=\s*["']([^"']+)["']/im);
  }

  if (!match) return null;

  const value = match[1].trim();
  return {
    value,
    exact: /^(?:==)?\d+\.\d+\.\d+(?:[-+][\w.]+)?$/.test(value),
  };
}

function findSeedConfiguration(files) {
  for (const { path, text } of files) {
    const match = findMatchingLine(
      text,
      /\b(?:random\.seed|numpy\.random\.seed|np\.random\.seed|torch(?:\.cuda)?\.manual_seed(?:_all)?|(?:set|setup)_seed)\s*\(|^\s*(?:random_)?seed\s*[:=]/i,
    );

    if (match) return { file: path, ...match };
  }

  return null;
}

function findExperimentConfiguration(paths, files) {
  const configPath = paths.find(
    (path) =>
      /(?:^|\/)(?:configs?|conf)\/.+\.(?:ya?ml|json|toml)$/i.test(path) ||
      /(?:^|\/)(?:config|settings)\.(?:py|ya?ml|json|toml)$/i.test(path),
  );

  if (configPath) return { file: configPath };

  for (const { path, text } of files) {
    const match = findMatchingLine(
      text,
      /\b(?:ArgumentParser\s*\(|add_argument\s*\(|@hydra\.main\s*\()/,
    );
    if (match) return { file: path, ...match };
  }

  return null;
}

function extractExperimentParameters(files) {
  const parameters = [];
  const seen = new Set();

  // ponytail: parse common one-line declarations; use language parsers when multiline/nested coverage is required.
  for (const { path, text } of files) {
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const argumentName = lines[index].match(/\.add_argument\(\s*["'](--[\w-]+)["']/)?.[1];
      const configMatch = /\.py$/i.test(path)
        ? null
        : lines[index].match(/^\s*["']?([A-Za-z_][\w.-]*)["']?\s*[:=]\s*(.+?)\s*,?\s*$/);
      const configName = configMatch?.[1];
      const name = argumentName ?? (
        configName && /(?:epoch|batch|learning[_-]?rate|^lr$|seed|model|data|device|max[_-]?(?:seq|length)|hidden)/i.test(configName)
          ? configName
          : null
      );
      const key = name?.replace(/^--/, "").replaceAll("-", "_");
      if (!name || seen.has(key)) continue;

      const rawDefault = argumentName
        ? lines[index].match(/\bdefault\s*=\s*([^,)]+)/)?.[1].trim() ?? null
        : configMatch[2].replace(/\s+#.*$/, "").replace(/,$/, "").trim();
      parameters.push({
        name,
        default: rawDefault?.replace(/^["']|["']$/g, "") ?? null,
        file: path,
        line: index + 1,
        source: argumentName ? "argparse" : "config",
      });
      seen.add(key);
      if (parameters.length === 12) return parameters;
    }
  }

  return parameters;
}

function extractCommandReferences(command) {
  if (!command) return [];

  const tokens = (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((token) =>
    token.replace(/^['"]|['"]$/g, "").replace(/[;,)]+$/, "").replaceAll("\\", "/"),
  );
  const references = [];
  const add = (path) => {
    const normalized = path?.replace(/^\.\//, "");
    if (normalized && !/^(?:https?:|\$|--?)/i.test(normalized)) references.push(normalized);
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].toLowerCase();

    if (["-r", "--requirement"].includes(token)) add(tokens[index + 1]);
    if (token.startsWith("--requirement=")) add(tokens[index].split("=").slice(1).join("="));
    if (["--config", "--config-file", "--cfg"].includes(token)) add(tokens[index + 1]);
    if (/^--(?:config|config-file|cfg)=/.test(token)) add(tokens[index].split("=").slice(1).join("="));

    const startsPython = /^(?:python3?|torchrun)$/.test(token);
    const startsAccelerate = token === "accelerate" && tokens[index + 1]?.toLowerCase() === "launch";
    if (startsPython || startsAccelerate) {
      const script = tokens.slice(index + 1).find((part) => /\.py$/i.test(part));
      add(script);
    }
  }

  return [...new Set(references)];
}

function validateCommandReferences(commands, filePaths) {
  return commands.flatMap(({ id, command, section }) => {
    const directory = command?.match(/\b(?:cd|pushd)\s+([^\s&]+)\s*&&/i)?.[1]
      ?.replace(/^\.\//, "")
      .replace(/\/$/, "");
    const externalContext = /https?:\/\/github\.com\//i.test(section ?? "");

    return extractCommandReferences(command).map((path) => {
      const directCandidates = [path, directory ? `${directory}/${path}` : null];
      const suffixMatches = filePaths.filter((candidate) => candidate.endsWith(`/${path}`));
      const resolved = directCandidates.find((candidate) => candidate && filePaths.includes(candidate))
        ?? (suffixMatches.length === 1 ? suffixMatches[0] : null);
      return {
        step: id,
        path: resolved ?? path,
        exists: resolved ? true : externalContext ? null : false,
        ...(externalContext && !resolved ? { external: true } : {}),
      };
    });
  });
}

function buildReproductionPlan({
  readme,
  installCommand,
  runCommand,
  dataInstructions,
  modelInstructions,
  pythonVersion,
  pythonVersionResult,
  references,
  parameters,
}) {
  const steps = [
    {
      id: "environment",
      title: "Prepare Python environment",
      status: pythonVersionResult ? "DOCUMENTED" : "MISSING",
      instruction: pythonVersionResult ? `Use Python ${pythonVersionResult.value}` : null,
      evidence: pythonVersionResult ? { file: pythonVersion, text: pythonVersionResult.value } : null,
    },
    {
      id: "install",
      title: "Install dependencies",
      status: installCommand ? "DOCUMENTED" : "MISSING",
      command: installCommand?.text ?? null,
      evidence: installCommand ? { file: readme, ...installCommand } : null,
      references: references.filter((reference) => reference.step === "install"),
    },
    {
      id: "model",
      title: "Get model or checkpoint",
      status: modelInstructions ? "DOCUMENTED" : "MISSING",
      instruction: modelInstructions?.text ?? null,
      evidence: modelInstructions ? { file: readme, ...modelInstructions } : null,
    },
    {
      id: "data",
      title: "Get and prepare dataset",
      status: dataInstructions ? "DOCUMENTED" : "MISSING",
      instruction: dataInstructions?.text ?? null,
      evidence: dataInstructions ? { file: readme, ...dataInstructions } : null,
    },
    {
      id: "run",
      title: "Run the experiment",
      status: runCommand ? "DOCUMENTED" : "MISSING",
      command: runCommand?.text ?? null,
      evidence: runCommand ? { file: readme, ...runCommand } : null,
      references: references.filter((reference) => reference.step === "run"),
      parameters,
    },
  ];
  const missingReferences = references.filter((reference) => reference.exists === false);
  const gaps = [
    ...steps
      .filter((step) => step.status === "MISSING")
      .map((step) => ({ type: "missing_step", step: step.id, message: `${step.title} is not documented` })),
    ...missingReferences.map((reference) => ({
      type: "missing_reference",
      step: reference.step,
      path: reference.path,
      message: `${reference.path} does not exist in the repository`,
    })),
  ];

  return {
    status: missingReferences.length
      ? "BLOCKED"
      : steps.some((step) => step.status === "MISSING")
        ? "INCOMPLETE"
        : "READY",
    gaps,
    steps,
  };
}

function buildWorkflows(reproductionPlan, entrypoints) {
  const entrypointStep = (entrypoint) => ({
    id: entrypoint.id,
    title: `${entrypoint.category[0].toUpperCase()}${entrypoint.category.slice(1)} entry point`,
    status: entrypoint.references.some((reference) => reference.exists === false)
      ? "BLOCKED"
      : "DOCUMENTED",
    command: entrypoint.command,
    evidence: entrypoint.evidence,
    references: entrypoint.references,
    parameters: entrypoint.parameters,
  });
  const create = (id, title, prerequisiteIds, selected) => {
    if (!selected.length) {
      return { id, title, status: "UNAVAILABLE", steps: [] };
    }

    const steps = [
      ...reproductionPlan.steps.filter((step) => prerequisiteIds.includes(step.id)),
      ...selected.map(entrypointStep),
    ];
    return {
      id,
      title,
      status: steps.some((step) => step.status === "BLOCKED")
        ? "BLOCKED"
        : steps.some((step) => step.status === "MISSING")
          ? "INCOMPLETE"
          : "READY",
      steps,
    };
  };
  const quick = [
    entrypoints.find((entrypoint) => entrypoint.category === "inference")
      ?? entrypoints.find((entrypoint) => entrypoint.category === "demo")
      ?? entrypoints.find((entrypoint) => entrypoint.category === "evaluation")
      ?? entrypoints.find((entrypoint) => entrypoint.category === "other")
      ?? entrypoints[0],
  ].filter(Boolean);
  const trainingCandidates = entrypoints.filter((entrypoint) => entrypoint.category === "training");
  const simplest = (candidates) => [...candidates].sort((left, right) => {
    const score = (entrypoint) =>
      (/from_resume|resume/i.test(entrypoint.command) ? 100 : 0)
      + (/\b(?:torchrun|accelerate\s+launch)\b/i.test(entrypoint.command) ? 50 : 0)
      + (entrypoint.references.some((reference) =>
        reference.exists
        && reference.path.includes("/")
        && !entrypoint.command.includes(reference.path)
        && !/\b(?:cd|pushd)\s+\S+\s*&&/i.test(entrypoint.command)
      ) ? 20 : 0)
      + entrypoint.command.length / 1000;
    return score(left) - score(right);
  })[0];
  const training = [
    entrypoints.find((entrypoint) => entrypoint.category === "preprocess"),
    simplest(trainingCandidates.filter((entrypoint) => /pretrain/i.test(entrypoint.command))),
    simplest(trainingCandidates.filter((entrypoint) => /full[_-]?sft|\bsft\b/i.test(entrypoint.command))),
  ].filter(Boolean);
  const fallbackTraining = simplest(trainingCandidates);
  if (!training.length && fallbackTraining) training.push(fallbackTraining);
  const evaluation = [entrypoints.find((entrypoint) => entrypoint.category === "evaluation")].filter(Boolean);
  const quickPrerequisites = [
    "environment",
    "install",
    ...(reproductionPlan.steps.some((step) => step.id === "model" && step.status === "DOCUMENTED") ? ["model"] : []),
  ];

  return [
    create("quick", "Quick verification", quickPrerequisites, quick),
    create("training", "Training", ["environment", "install", "data", "model"], training),
    create("evaluation", "Evaluation", ["environment", "install", "data", "model"], evaluation),
  ];
}

function statusFor(failures, warnings) {
  if (failures > 0) return "BLOCKED";
  if (warnings > 0) return "NEEDS_WORK";
  return "READY_FOR_REVIEW";
}

function strictExitCode(status) {
  return status === "READY_FOR_REVIEW" ? 0 : 1;
}

function standalonePlan(report) {
  return {
    repository: report.repository,
    commit: report.commit,
    ...report.reproductionPlan,
    experimentParameters: report.experimentParameters,
    entrypoints: report.entrypoints,
    workflows: report.workflows,
    evaluationDraft: report.evaluationDraft,
    paperProvenance: report.paperProvenance,
    paperWorkflowDraft: report.paperWorkflowDraft,
    protocolLock: report.protocolLock,
    paperMatrixDraft: report.paperMatrixDraft,
  };
}

function printReport(report) {
  for (const check of report.checks) {
    console.log(`${check.status.padEnd(6)}${check.message}`);
  }

  console.log(`Files scanned: ${report.filesScanned}`);
  console.log(
    `Status: ${report.status} (failures: ${report.summary.failures}, warnings: ${report.summary.warnings})`,
  );
  console.log(`Commit: ${report.commit}`);
}

async function github(path, token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "reprocheck",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com${path}`, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API 请求失败：${response.status}`);
  }

  return response.json();
}

async function readRepositoryFile(base, path, ref, token) {
  if (!path) return "";

  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const file = await github(
    `${base}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    token,
  );

  return file.content
    ? new TextDecoder().decode(
        Uint8Array.from(
          atob(file.content.replace(/\s/g, "")),
          (character) => character.charCodeAt(0),
        ),
      )
    : "";
}

export async function scan(input, token, pinnedCommit) {
  if (pinnedCommit !== undefined && !/^[a-f\d]{40}$/i.test(pinnedCommit)) throw new Error("Invalid pinned source commit");
  const { owner, repo } = parseRepo(input);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const repository = await github(base, token);
  const commit = await github(
    `${base}/commits/${encodeURIComponent(pinnedCommit ?? repository.default_branch)}`,
    token,
  );
  const tree = await github(
    `${base}/git/trees/${encodeURIComponent(commit.commit.tree.sha)}?recursive=1`,
    token,
  );

  if (!Array.isArray(tree.tree)) {
    throw new Error("无法读取仓库文件树");
  }

  if (tree.truncated) {
    throw new Error("仓库文件树过大，GitHub 返回结果不完整");
  }

  const paths = tree.tree.map((entry) => entry.path);
  const filePaths = tree.tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path);
  const rootFiles = filePaths.filter((path) => !path.includes("/"));
  const readme = rootFiles.find((path) => /^readme(\.|$)/i.test(path));
  const dependencyFiles = filePaths.filter(isDependencyFile);
  const dependencies =
    dependencyFiles.find((path) =>
      ["poetry.lock", "uv.lock", "pipfile.lock"].includes(
        path.split("/").at(-1).toLowerCase(),
      ),
    ) ?? dependencyFiles[0];
  const pythonVersion = [
    ".python-version",
    "runtime.txt",
    "dockerfile",
    "pyproject.toml",
    "environment.yml",
    "environment.yaml",
  ]
    .map((name) =>
      filePaths.find((path) => path.split("/").at(-1).toLowerCase() === name),
    )
    .find(Boolean);
  const license = rootFiles.find(isLicenseFile);
  const makefile = rootFiles.find((path) => /^makefile$/i.test(path));
  const tests = paths.find(isTestPath);
  const ciWorkflow = filePaths.find((path) =>
    /^\.github\/workflows\/.+\.ya?ml$/i.test(path),
  );
  const [readmeText, dependencyText, pythonVersionText, makefileText] = await Promise.all([
    readRepositoryFile(base, readme, commit.sha, token),
    readRepositoryFile(base, dependencies, commit.sha, token),
    readRepositoryFile(base, pythonVersion, commit.sha, token),
    readRepositoryFile(base, makefile, commit.sha, token),
  ]);
  const installCommand = findInstallCommand(readmeText);
  const runCommands = findRunCommands(readmeText);
  const runCommand = runCommands[0]
    ? { line: runCommands[0].line, text: runCommands[0].text }
    : null;
  const entrypointSeeds = runCommands.map((command, index) => ({
    id: `${command.category}-${index + 1}`,
    category: command.category,
    command: command.text,
    section: command.section,
    evidence: { file: readme, line: command.line },
  }));
  const dataInstructions = findDataInstructions(readmeText);
  const modelInstructions = findModelInstructions(readmeText);
  const dependencyVersions = dependencies
    ? analyzeDependencyVersions(dependencies, dependencyText)
    : null;
  const pythonVersionResult = pythonVersion
    ? analyzePythonVersion(pythonVersion, pythonVersionText)
    : null;
  const commandReferences = validateCommandReferences(
    [
      { id: "install", command: installCommand?.text },
      ...entrypointSeeds.map((entrypoint) => ({
        id: entrypoint.id,
        command: entrypoint.command,
        section: entrypoint.section,
      })),
    ],
    filePaths,
  );
  const entrypointsWithReferences = entrypointSeeds.map((entrypoint) => ({
    ...entrypoint,
    references: commandReferences.filter((reference) => reference.step === entrypoint.id),
  }));
  // ponytail: inspect five likely source files; widen only when API usage and accuracy are measured.
  const codeCandidates = [
    ...new Set([
      ...entrypointsWithReferences.filter((entry) => entry.category === "evaluation").flatMap((entry) => entry.references)
        .filter((reference) => reference.exists && /\.py$/i.test(reference.path)).map((reference) => reference.path),
      ...commandReferences.filter((reference) => reference.exists && /\.(?:ya?ml|toml|json)$/i.test(reference.path)).map((reference) => reference.path),
      ...filePaths.filter((path) => /(?:^|\/)(?:eval(?:uate)?|benchmark)[\w-]*\.py$/i.test(path)).slice(0, 2),
      ...commandReferences
        .filter((reference) => reference.exists && /\.(?:py|ya?ml|toml|json)$/i.test(reference.path))
        .map((reference) => reference.path),
      ...filePaths.filter((path) => {
        const name = path.split("/").at(-1);
        return /\.(?:py|ya?ml|toml|json)$/i.test(name) && /(?:seed|train|main|config)/i.test(name);
      }),
    ]),
  ].slice(0, 5);
  const codeFiles = await Promise.all(
    codeCandidates.map(async (path) => ({
      path,
      text: await readRepositoryFile(base, path, commit.sha, token),
    })),
  );
  const seedConfiguration = findSeedConfiguration(codeFiles);
  const experimentConfiguration = findExperimentConfiguration(filePaths, codeFiles);
  const experimentParameters = extractExperimentParameters(codeFiles);
  const entrypoints = entrypointsWithReferences.map((entrypoint) => ({
    ...entrypoint,
    parameters: experimentParameters.filter((parameter) =>
      entrypoint.references.some((reference) => reference.path === parameter.file),
    ),
  }));
  const missingCommandReferences = commandReferences.filter((reference) => reference.exists === false);
  const externalCommandReferences = commandReferences.filter((reference) => reference.external);
  const localCommandReferences = commandReferences.filter((reference) => !reference.external);
  const reproductionPlan = buildReproductionPlan({
    readme,
    installCommand,
    runCommand,
    dataInstructions,
    modelInstructions,
    pythonVersion,
    pythonVersionResult,
    references: [
      ...commandReferences.filter((reference) => reference.step === "install"),
      ...commandReferences
        .filter((reference) => reference.step === entrypoints[0]?.id)
        .map((reference) => ({ ...reference, step: "run" })),
    ],
    parameters: entrypoints[0]?.parameters ?? [],
  });
  const workflows = buildWorkflows(reproductionPlan, entrypoints);
  const evaluationDraft = buildEvaluationDraft({ readme, readmeText, entrypoints, files: codeFiles, filePaths });

  const checks = [
    {
      id: "readme",
      status: readme ? "PASS" : "FAIL",
      message: readme ? `README found: ${readme}` : "README not found",
      evidence: readme ? { file: readme } : null,
      suggestion: readme
        ? null
        : "Add README.md with installation and run instructions",
    },
    {
      id: "install_command",
      status: installCommand ? "PASS" : "WARN",
      message: installCommand
        ? "Install command found in README"
        : "Install command not found in README",
      evidence: installCommand
        ? { file: readme, ...installCommand }
        : null,
      suggestion: installCommand
        ? null
        : "Add a supported installation command to README.md",
    },
    {
      id: "run_command",
      status: runCommands.length ? "PASS" : "WARN",
      message: runCommands.length
        ? `${runCommands.length} runnable command(s) found and categorized`
        : "Runnable command not found in README",
      evidence: runCommand ? { file: readme, ...runCommand } : null,
      suggestion: runCommand
        ? null
        : "Add a Python run command to README.md",
    },
    {
      id: "data_instructions",
      status: dataInstructions ? "PASS" : "WARN",
      message: dataInstructions
        ? "Dataset instructions found in README"
        : "Dataset instructions not found in README",
      evidence: dataInstructions
        ? { file: readme, ...dataInstructions }
        : null,
      suggestion: dataInstructions
        ? null
        : "Document where to get and how to prepare the dataset",
    },
    {
      id: "model_instructions",
      status: modelInstructions ? "PASS" : "WARN",
      message: modelInstructions
        ? "Model or checkpoint instructions found in README"
        : "Model or checkpoint instructions not found in README",
      evidence: modelInstructions
        ? { file: readme, ...modelInstructions }
        : null,
      suggestion: modelInstructions
        ? null
        : "Document pretrained weights or checkpoint generation",
    },
    {
      id: "dependencies",
      status: dependencies ? "PASS" : "FAIL",
      message: dependencies
        ? `Dependencies found: ${dependencies}`
        : "Dependencies not found",
      evidence: dependencies ? { file: dependencies } : null,
      suggestion: dependencies
        ? null
        : "Add requirements.txt or pyproject.toml",
    },
    {
      id: "dependency_versions",
      status:
        dependencyVersions?.verifiable &&
        (dependencyVersions.lockFile ||
          (dependencyVersions.total > 0 && dependencyVersions.unpinned.length === 0))
          ? "PASS"
          : "WARN",
      message: !dependencyVersions
        ? "Dependency versions cannot be checked"
        : dependencyVersions.lockFile
          ? `Dependency lock file found: ${dependencies}`
          : !dependencyVersions.verifiable
            ? `Dependency versions not verified: ${dependencies}`
            : dependencyVersions.total === 0
              ? `No direct dependencies found in ${dependencies}`
              : dependencyVersions.unpinned.length === 0
                ? `All ${dependencyVersions.total} dependencies are exactly pinned`
                : `${dependencyVersions.unpinned.length} of ${dependencyVersions.total} dependencies are not exactly pinned`,
      evidence: dependencies
        ? {
            file: dependencies,
            text: dependencyVersions?.unpinned.length
              ? `Unpinned: ${dependencyVersions.unpinned.slice(0, 3).join(", ")}`
              : dependencyVersions?.lockFile
                ? "Lock file provides resolved dependency versions"
                : null,
          }
        : null,
      suggestion:
        dependencyVersions?.verifiable &&
        (dependencyVersions.lockFile ||
          (dependencyVersions.total > 0 && dependencyVersions.unpinned.length === 0))
          ? null
          : "Pin exact versions or commit a supported lock file",
    },
    {
      id: "license",
      status: license ? "PASS" : "WARN",
      message: license ? `License found: ${license}` : "License not found",
      evidence: license ? { file: license } : null,
      suggestion: license ? null : "Add a LICENSE file",
    },
    {
      id: "tests",
      status: tests ? "PASS" : "WARN",
      message: tests ? `Test entry found: ${tests}` : "Test entry not found",
      evidence: tests ? { file: tests } : null,
      suggestion: tests ? null : "Add a tests directory or Python test file",
    },
    {
      id: "python_version",
      status: pythonVersionResult?.exact ? "PASS" : "WARN",
      message: pythonVersionResult?.exact
        ? `Python version exactly pinned: ${pythonVersionResult.value}`
        : pythonVersionResult
          ? `Python version constraint is not exact: ${pythonVersionResult.value}`
          : "Python version not clearly pinned",
      evidence: pythonVersion
        ? { file: pythonVersion, text: pythonVersionResult?.value ?? null }
        : null,
      suggestion: pythonVersionResult?.exact
        ? null
        : "Pin an exact Python patch version, for example 3.11.9",
    },
    {
      id: "random_seed",
      status: seedConfiguration ? "PASS" : "WARN",
      message: seedConfiguration
        ? "Random seed setup found in code"
        : "Random seed setup not found in sampled code",
      evidence: seedConfiguration,
      suggestion: seedConfiguration
        ? null
        : "Set Python, NumPy, and framework random seeds in the training entry point",
    },
    {
      id: "experiment_config",
      status: experimentConfiguration ? "PASS" : "WARN",
      message: experimentConfiguration
        ? "Reusable experiment configuration found"
        : "Reusable experiment configuration not found",
      evidence: experimentConfiguration,
      suggestion: experimentConfiguration
        ? null
        : "Expose experiment parameters through a config file or command-line arguments",
    },
    {
      id: "continuous_integration",
      status: ciWorkflow ? "PASS" : "WARN",
      message: ciWorkflow
        ? `Continuous integration found: ${ciWorkflow}`
        : "Continuous integration workflow not found",
      evidence: ciWorkflow ? { file: ciWorkflow } : null,
      suggestion: ciWorkflow
        ? null
        : "Add a GitHub Actions workflow that installs dependencies and runs tests",
    },
    {
      id: "command_references",
      status: missingCommandReferences.length
        ? "FAIL"
        : localCommandReferences.length
          ? "PASS"
          : "WARN",
      message: missingCommandReferences.length
        ? `${missingCommandReferences.length} command reference(s) do not exist in the repository`
        : localCommandReferences.length
          ? `All ${localCommandReferences.length} local command reference(s) exist${externalCommandReferences.length ? `; ${externalCommandReferences.length} external reference(s) identified` : ""}`
          : externalCommandReferences.length
            ? `${externalCommandReferences.length} external command reference(s) identified`
            : "No local command references could be validated",
      evidence: localCommandReferences.find((reference) => reference.exists)
        ? { file: localCommandReferences.find((reference) => reference.exists).path }
        : null,
      suggestion: missingCommandReferences.length
        ? `Fix missing paths: ${missingCommandReferences.map((reference) => reference.path).join(", ")}`
        : localCommandReferences.length || externalCommandReferences.length
          ? null
          : "Document commands that reference repository scripts or configuration files",
    },
  ];

  const failures = checks.filter((check) => check.status === "FAIL").length;
  const warnings = checks.filter((check) => check.status === "WARN").length;

  const report = {
    repository: `${owner}/${repo}`,
    commit: commit.sha,
    filesScanned: filePaths.length,
    status: statusFor(failures, warnings),
    summary: { failures, warnings },
    checks,
    experimentParameters,
    entrypoints,
    workflows,
    reproductionPlan,
    evaluationDraft,
  };
  evaluationDraft.suggestion = suggestCandidate(report);
  report.paperProvenance = discoverPaperProvenance({ readme, readmeText, evaluationDraft });
  report.paperWorkflowDraft = buildPaperWorkflowDraft({ provenance: report.paperProvenance, makefile, makefileText, filePaths });
  report.protocolLock = buildProtocolLock({ report, treeEntries: tree.tree, readme, makefile, dependencyFile: dependencies, dependencyVersions,
    pythonVersionFile: pythonVersion, pythonVersionResult, seedConfiguration });
  report.paperMatrixDraft = buildPaperMatrixDraft(report);
  return report;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--self-test")) {
    expectEqual(parseRepo("https://github.com/a/b"), {
      owner: "a",
      repo: "b",
    });

    expectEqual(
      findInstallCommand("Setup\npip install -r requirements.txt"),
      { line: 2, text: "pip install -r requirements.txt" },
    );

    expectEqual(
      findInstallCommand("This project requires Python"),
      null,
    );

    expectEqual(
      findRunCommand("Usage\r\n$ python train.py --epochs 10"),
      { line: 2, text: "$ python train.py --epochs 10" },
    );
    expectEqual(findRunCommand("This project requires Python 3.10"), null);
    expectEqual(
      findRunCommands("## Training\npython train.py --epochs 10\n## Evaluation\npython eval.py"),
      [
        {
          line: 2,
          text: "python train.py --epochs 10",
          section: "Training",
          category: "training",
        },
        {
          line: 4,
          text: "python eval.py",
          section: "Evaluation",
          category: "evaluation",
        },
      ],
    );
    expectEqual(classifyRunCommand("python eval_toolcall.py --weight full_sft", "Tool Calling"), "evaluation");
    expectEqual(findRunCommands("torchrun --nproc_per_node N train_xxx.py"), []);
    expectEqual(findDataInstructions("## Download dataset\nDownload dataset from [files](https://example.com/data)"), {
      line: 2,
      text: "Download dataset from [files](https://example.com/data)",
    });
    expectEqual(findDataInstructions("The dataset contains training examples"), null);
    expectEqual(findDataInstructions("Avoid dataset download confusion"), null);
    expectEqual(findModelInstructions("### 下载模型\nmodelscope download --model lab/base"), {
      line: 2,
      text: "modelscope download --model lab/base",
    });
    expectEqual(findModelInstructions("Use the pretrained checkpoint"), null);

    expectEqual(isLicenseFile("LICENSE.md"), true);
    expectEqual(isLicenseFile("README.md"), false);

    expectEqual(isTestPath("tests"), true);
    expectEqual(isTestPath("src/tests/test_model.py"), true);
    expectEqual(isTestPath("src/test_model.py"), true);
    expectEqual(isTestPath("src/train.py"), false);

    expectEqual(
      findSeedConfiguration([
        { path: "train.py", text: "setup_seed(42)" },
      ]),
      { file: "train.py", line: 1, text: "setup_seed(42)" },
    );
    expectEqual(
      findSeedConfiguration([
        { path: "train.py", text: "Load the training dataset" },
      ]),
      null,
    );
    expectEqual(
      findExperimentConfiguration(
        ["configs/base.yaml"],
        [],
      ),
      { file: "configs/base.yaml" },
    );
    expectEqual(
      findExperimentConfiguration(
        ["train.py"],
        [{ path: "train.py", text: "parser.add_argument('--epochs')" }],
      ),
      { file: "train.py", line: 1, text: "parser.add_argument('--epochs')" },
    );
    expectEqual(
      extractExperimentParameters([
        {
          path: "train.py",
          text: "parser.add_argument('--epochs', default=3, type=int)\nparser.add_argument('--model', default='small')",
        },
      ]),
      [
        { name: "--epochs", default: "3", file: "train.py", line: 1, source: "argparse" },
        { name: "--model", default: "small", file: "train.py", line: 2, source: "argparse" },
      ],
    );
    expectEqual(
      extractExperimentParameters([
        {
          path: "configs/base.yaml",
          text: "epochs: 20\nbatch_size: 32\noptimizer: adamw\nlearning_rate: 0.001",
        },
      ]),
      [
        { name: "epochs", default: "20", file: "configs/base.yaml", line: 1, source: "config" },
        { name: "batch_size", default: "32", file: "configs/base.yaml", line: 2, source: "config" },
        { name: "learning_rate", default: "0.001", file: "configs/base.yaml", line: 4, source: "config" },
      ],
    );
    expectEqual(
      extractCommandReferences("python train.py --config configs/base.yaml"),
      ["train.py", "configs/base.yaml"],
    );
    expectEqual(
      extractCommandReferences("pip install -r requirements.txt"),
      ["requirements.txt"],
    );
    expectEqual(
      validateCommandReferences(
        [{ id: "run", command: "python train.py --config missing.yaml" }],
        ["train.py"],
      ),
      [
        { step: "run", path: "train.py", exists: true },
        { step: "run", path: "missing.yaml", exists: false },
      ],
    );
    expectEqual(
      validateCommandReferences(
        [{ id: "training-1", command: "cd scripts && python train.py" }],
        ["scripts/train.py"],
      ),
      [{ step: "training-1", path: "scripts/train.py", exists: true }],
    );
    expectEqual(
      validateCommandReferences(
        [{ id: "training-1", command: "python train.py" }],
        ["trainer/train.py"],
      ),
      [{ step: "training-1", path: "trainer/train.py", exists: true }],
    );
    expectEqual(
      findRunCommands("# [External](https://github.com/example/tool)\n```bash\n# Run inside the tool directory\npython convert.py model\n```")[0].section,
      "[External](https://github.com/example/tool)",
    );
    expectEqual(
      validateCommandReferences(
        [{
          id: "inference-1",
          command: "python convert.py model",
          section: "[External](https://github.com/example/tool)",
        }],
        [],
      ),
      [{ step: "inference-1", path: "convert.py", exists: null, external: true }],
    );
    const incompletePlan = buildReproductionPlan({
      readme: "README.md",
      installCommand: { line: 1, text: "pip install -r requirements.txt" },
      runCommand: { line: 2, text: "python missing.py" },
      dataInstructions: { line: 3, text: "Download data from https://example.com" },
      modelInstructions: { line: 4, text: "Download model from https://example.com" },
      pythonVersion: null,
      pythonVersionResult: null,
      references: [{ step: "run", path: "missing.py", exists: false }],
      parameters: [],
    });
    expectEqual(incompletePlan.status, "BLOCKED");
    expectEqual(incompletePlan.gaps, [
      {
        type: "missing_step",
        step: "environment",
        message: "Prepare Python environment is not documented",
      },
      {
        type: "missing_reference",
        step: "run",
        path: "missing.py",
        message: "missing.py does not exist in the repository",
      },
    ]);
    const workflows = buildWorkflows(
      {
        steps: [
          { id: "environment", status: "DOCUMENTED" },
          { id: "install", status: "DOCUMENTED" },
          { id: "model", status: "DOCUMENTED" },
          { id: "data", status: "DOCUMENTED" },
        ],
      },
      [
        {
          id: "training-1",
          category: "training",
          command: "python train.py",
          evidence: { file: "README.md", line: 1 },
          references: [{ path: "train.py", exists: true }],
          parameters: [{ name: "--epochs", default: "3" }],
        },
        {
          id: "evaluation-2",
          category: "evaluation",
          command: "python eval.py",
          evidence: { file: "README.md", line: 2 },
          references: [{ path: "eval.py", exists: true }],
          parameters: [],
        },
      ],
    );
    expectEqual(
      workflows.map((workflow) => ({
        id: workflow.id,
        status: workflow.status,
        command: workflow.steps.at(-1)?.command ?? null,
        parameterCount: workflow.steps.at(-1)?.parameters?.length ?? 0,
      })),
      [
        { id: "quick", status: "READY", command: "python eval.py", parameterCount: 0 },
        { id: "training", status: "READY", command: "python train.py", parameterCount: 1 },
        { id: "evaluation", status: "READY", command: "python eval.py", parameterCount: 0 },
      ],
    );
    const preferredWorkflows = buildWorkflows(
      { steps: [] },
      [
        { id: "resume", category: "training", command: "python train_pretrain.py --from_resume 1", references: [], parameters: [] },
        { id: "pretrain", category: "training", command: "cd trainer && python train_pretrain.py", references: [], parameters: [] },
        { id: "sft", category: "training", command: "cd trainer && python train_full_sft.py", references: [], parameters: [] },
        { id: "eval-1", category: "evaluation", command: "python eval.py model", references: [], parameters: [] },
        { id: "eval-2", category: "evaluation", command: "python eval.py other", references: [], parameters: [] },
      ],
    );
    expectEqual(
      preferredWorkflows.find((workflow) => workflow.id === "training").steps.map((step) => step.id),
      ["pretrain", "sft"],
    );
    expectEqual(
      preferredWorkflows.find((workflow) => workflow.id === "evaluation").steps.map((step) => step.id),
      ["eval-1"],
    );
    expectEqual(
      buildWorkflows({ steps: [] }, []).map((workflow) => workflow.status),
      ["UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE"],
    );
    expectEqual(
      buildWorkflows(
        { steps: [{ id: "model", status: "MISSING" }] },
        [{ id: "run", category: "other", command: "python -m pytest", references: [], parameters: [] }],
      ).find((workflow) => workflow.id === "quick").steps.map((step) => step.id),
      ["run"],
    );

    expectEqual(statusFor(1, 0), "BLOCKED");
    expectEqual(statusFor(0, 1), "NEEDS_WORK");
    expectEqual(statusFor(0, 0), "READY_FOR_REVIEW");
    expectEqual(strictExitCode("READY_FOR_REVIEW"), 0);
    expectEqual(strictExitCode("NEEDS_WORK"), 1);
    expectEqual(strictExitCode("BLOCKED"), 1);
    expectEqual(
      standalonePlan({
        repository: "a/b",
        commit: "abc",
        reproductionPlan: { status: "READY", steps: [] },
        experimentParameters: [],
        entrypoints: [],
        workflows: [],
      }),
      {
        repository: "a/b",
        commit: "abc",
        status: "READY",
        steps: [],
        experimentParameters: [],
        entrypoints: [],
        workflows: [],
      },
    );

    expectEqual(
      analyzeDependencyVersions(
        "requirements.txt",
        "numpy==1.26.4\ntorch>=2\n# comment",
      ),
      {
        verifiable: true,
        lockFile: false,
        total: 2,
        unpinned: ["torch>=2"],
      },
    );
    expectEqual(analyzeDependencyVersions("poetry.lock", ""), {
      verifiable: true,
      lockFile: true,
      total: null,
      unpinned: [],
    });
    expectEqual(analyzePythonVersion(".python-version", "3.11.9\n"), {
      value: "3.11.9",
      exact: true,
    });
    expectEqual(
      analyzePythonVersion("pyproject.toml", 'requires-python = ">=3.10"'),
      { value: ">=3.10", exact: false },
    );

    console.log("PASS  self-test");
    return;
  }

  const input = args.find((arg) => !arg.startsWith("--"));

  if (!input) {
    console.error("用法：node scan.mjs https://github.com/owner/repo [--json|--plan] [--strict]");
    process.exitCode = 1;
  } else {
    scan(input, process.env.GITHUB_TOKEN)
      .then((report) => {
        if (args.includes("--plan")) {
          console.log(JSON.stringify(standalonePlan(report), null, 2));
        } else if (args.includes("--json")) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printReport(report);
        }

        if (args.includes("--strict")) {
          process.exitCode = strictExitCode(report.status);
        }
      })
      .catch((error) => {
        console.error(`ERROR ${error.message}`);
        process.exitCode = 1;
      });
  }
}

if (
  typeof process !== "undefined" &&
  process.argv?.[1]?.replaceAll("\\", "/").endsWith("/scan.mjs")
) {
  main();
}
