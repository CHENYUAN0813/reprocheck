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

function isLicenseFile(name) {
  return /^(?:licen[cs]e|copying)(?:[.-]|$)/i.test(name);
}

function isTestPath(path) {
  return /(?:^|\/)(?:tests?(?:\/|$)|(?:test_.+|.+_test)\.py$|(?:pytest\.ini|tox\.ini|noxfile\.py)$)/i.test(path);
}

function statusFor(failures, warnings) {
  if (failures > 0) return "BLOCKED";
  if (warnings > 0) return "NEEDS_WORK";
  return "READY_FOR_REVIEW";
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
  const dependencies = filePaths.find((path) =>
    [
      "requirements.txt",
      "pyproject.toml",
      "poetry.lock",
      "pipfile",
      "environment.yml",
      "environment.yaml",
    ].includes(path.split("/").at(-1).toLowerCase()),
  );
  const pythonVersion = filePaths.find((path) =>
    [".python-version", "runtime.txt"].includes(
      path.split("/").at(-1).toLowerCase(),
    ),
  );
  const license = rootFiles.find(isLicenseFile);
  const tests = paths.find(isTestPath);

  const readmeFile = readme
    ? await github(
        `${base}/contents/${encodeURIComponent(readme)}?ref=${commit.sha}`,
        token,
      )
    : null;

  const readmeText = readmeFile?.content
    ? new TextDecoder().decode(
        Uint8Array.from(
          atob(readmeFile.content.replace(/\s/g, "")),
          (character) => character.charCodeAt(0),
        ),
      )
    : "";
  const installCommand = findInstallCommand(readmeText);
  const runCommand = findRunCommand(readmeText);

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
      status: pythonVersion ? "PASS" : "WARN",
      message: pythonVersion
        ? `Python version found: ${pythonVersion}`
        : "Python version not clearly pinned",
      evidence: pythonVersion ? { file: pythonVersion } : null,
      suggestion: pythonVersion
        ? null
        : "Pin Python with .python-version or runtime.txt",
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

    expectEqual(isLicenseFile("LICENSE.md"), true);
    expectEqual(isLicenseFile("README.md"), false);

    expectEqual(isTestPath("tests"), true);
    expectEqual(isTestPath("src/tests/test_model.py"), true);
    expectEqual(isTestPath("src/test_model.py"), true);
    expectEqual(isTestPath("src/train.py"), false);

    expectEqual(statusFor(1, 0), "BLOCKED");
    expectEqual(statusFor(0, 1), "NEEDS_WORK");
    expectEqual(statusFor(0, 0), "READY_FOR_REVIEW");

    console.log("PASS  self-test");
    return;
  }

  const input = args.find((arg) => !arg.startsWith("--"));

  if (!input) {
    console.error("用法：node scan.mjs https://github.com/owner/repo [--json]");
    process.exitCode = 1;
  } else {
    scan(input, process.env.GITHUB_TOKEN)
      .then((report) => {
        if (args.includes("--json")) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printReport(report);
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
