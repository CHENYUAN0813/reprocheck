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

function findRunCommand(text) {
  return findMatchingLine(
    text,
    /^\s*(?:[$>]\s*)?(?:python3?(?:\s+-m\s+\S+|\s+\S+\.py\b)|torchrun\s+\S+|accelerate\s+launch\s+\S+)/i,
  );
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
  return commands.flatMap(({ id, command }) =>
    extractCommandReferences(command).map((path) => ({
      step: id,
      path,
      exists: filePaths.includes(path),
    })),
  );
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
  const missingReferences = references.filter((reference) => !reference.exists);
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

export async function scan(input, token) {
  const { owner, repo } = parseRepo(input);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const repository = await github(base, token);
  const commit = await github(
    `${base}/commits/${encodeURIComponent(repository.default_branch)}`,
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
  const tests = paths.find(isTestPath);
  const ciWorkflow = filePaths.find((path) =>
    /^\.github\/workflows\/.+\.ya?ml$/i.test(path),
  );
  const [readmeText, dependencyText, pythonVersionText] = await Promise.all([
    readRepositoryFile(base, readme, commit.sha, token),
    readRepositoryFile(base, dependencies, commit.sha, token),
    readRepositoryFile(base, pythonVersion, commit.sha, token),
  ]);
  const installCommand = findInstallCommand(readmeText);
  const runCommand = findRunCommand(readmeText);
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
      { id: "run", command: runCommand?.text },
    ],
    filePaths,
  );
  // ponytail: inspect five likely source files; widen only when API usage and accuracy are measured.
  const codeCandidates = [
    ...new Set([
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
  const missingCommandReferences = commandReferences.filter((reference) => !reference.exists);
  const reproductionPlan = buildReproductionPlan({
    readme,
    installCommand,
    runCommand,
    dataInstructions,
    modelInstructions,
    pythonVersion,
    pythonVersionResult,
    references: commandReferences,
    parameters: experimentParameters,
  });

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
      status: runCommand ? "PASS" : "WARN",
      message: runCommand
        ? "Run command found in README"
        : "Run command not found in README",
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
        : commandReferences.length
          ? "PASS"
          : "WARN",
      message: missingCommandReferences.length
        ? `${missingCommandReferences.length} command reference(s) do not exist in the repository`
        : commandReferences.length
          ? `All ${commandReferences.length} command reference(s) exist`
          : "No local command references could be validated",
      evidence: commandReferences[0] ? { file: commandReferences[0].path } : null,
      suggestion: missingCommandReferences.length
        ? `Fix missing paths: ${missingCommandReferences.map((reference) => reference.path).join(", ")}`
        : commandReferences.length
          ? null
          : "Document commands that reference repository scripts or configuration files",
    },
  ];

  const failures = checks.filter((check) => check.status === "FAIL").length;
  const warnings = checks.filter((check) => check.status === "WARN").length;

  return {
    repository: `${owner}/${repo}`,
    commit: commit.sha,
    filesScanned: filePaths.length,
    status: statusFor(failures, warnings),
    summary: { failures, warnings },
    checks,
    experimentParameters,
    reproductionPlan,
  };
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
      }),
      {
        repository: "a/b",
        commit: "abc",
        status: "READY",
        steps: [],
        experimentParameters: [],
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
