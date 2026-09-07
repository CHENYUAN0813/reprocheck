import assert from "node:assert/strict";

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

function hasInstallCommand(text) {
  return /\b(?:pip3? install|poetry install|uv sync|conda env create)\b/i.test(text);
}

function hasRunCommand(text) {
  return /^\s*(?:[$>]\s*)?(?:python3?(?:\s+-m\s+\S+|\s+\S+\.py\b)|torchrun\s+\S+|accelerate\s+launch\s+\S+)/im.test(text);
}

async function github(path) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "reprocheck",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(`https://api.github.com${path}`, { headers });

  if (!response.ok) {
    throw new Error(`GitHub API 请求失败：${response.status}`);
  }

  return response.json();
}

async function scan(input) {
  const { owner, repo } = parseRepo(input);
  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const repository = await github(base);
  const [files, commit] = await Promise.all([
    github(`${base}/contents`),
    github(`${base}/commits/${encodeURIComponent(repository.default_branch)}`),
  ]);

  if (!Array.isArray(files)) {
    throw new Error("无法读取仓库根目录");
  }

  const names = files.map((file) => file.name);
  const readme = names.find((name) => /^readme(\.|$)/i.test(name));
  const dependencies = names.find((name) =>
    [
      "requirements.txt",
      "pyproject.toml",
      "poetry.lock",
      "Pipfile",
      "environment.yml",
      "environment.yaml",
    ].includes(name),
  );
  const pythonVersion = names.find((name) =>
    [".python-version", "runtime.txt"].includes(name),
  );

  const readmeFile = readme
    ? await github(
        `${base}/contents/${encodeURIComponent(readme)}?ref=${commit.sha}`,
      )
    : null;

  const readmeText = readmeFile?.content
    ? Buffer.from(readmeFile.content, "base64").toString("utf8")
    : "";

  console.log(readme
    ? `PASS  README found: ${readme}`
    : "FAIL  README not found");

  console.log(
    hasInstallCommand(readmeText)
      ? "PASS  Install command found in README"
      : "WARN  Install command not found in README",
  );

  console.log(
    hasRunCommand(readmeText)
      ? "PASS  Run command found in README"
      : "WARN  Run command not found in README",
  );

  console.log(dependencies
    ? `PASS  Dependencies found: ${dependencies}`
    : "FAIL  Dependencies not found");

  console.log(pythonVersion
    ? `PASS  Python version found: ${pythonVersion}`
    : "WARN  Python version not clearly pinned");

  console.log(`Commit: ${commit.sha}`);
}

if (process.argv[2] === "--self-test") {
  assert.deepEqual(parseRepo("https://github.com/a/b"), {
    owner: "a",
    repo: "b",
  });

  assert.equal(
    hasInstallCommand("pip install -r requirements.txt"),
    true,
  );

  assert.equal(
    hasInstallCommand("This project requires Python"),
    false,
  );

  assert.equal(hasRunCommand("python train.py --epochs 10"), true);
  assert.equal(hasRunCommand("This project requires Python 3.10"), false);

  console.log("PASS  self-test");
} else {
  const input = process.argv[2];

  if (!input) {
    console.error("用法：node scan.mjs https://github.com/owner/repo");
    process.exitCode = 1;
  } else {
    scan(input).catch((error) => {
      console.error(`ERROR ${error.message}`);
      process.exitCode = 1;
    });
  }
}
