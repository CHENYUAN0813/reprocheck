import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import {
  buildDockerInvocation,
  buildPreflight,
  cancelRun,
  diagnoseRun,
  getRun,
  inspectRuntime,
  rewritePackageIndex,
  startRun,
  summarizeSteps,
} from "./runner.mjs";
import { scan } from "./scan.mjs";
import worker from "./worker.mjs";

const MAX_BODY_BYTES = 4096;

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let body = "";

  for await (const chunk of request) {
    body += chunk;

    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new Error("Request body is too large");
    }
  }

  return JSON.parse(body);
}

async function handleApi(request, response) {
  const url = new URL(request.url || "/", "http://localhost");
  const runId = url.pathname.match(/^\/api\/runs\/([\w-]+)$/)?.[1];

  if (runId) {
    if (request.method === "GET") {
      const job = getRun(runId);
      sendJson(response, job ? 200 : 404, job ?? { error: "Run not found" });
      return true;
    }
    if (request.method === "DELETE") {
      const job = cancelRun(runId);
      sendJson(response, job ? 200 : 404, job ?? { error: "Running job not found" });
      return true;
    }
    response.setHeader("Allow", "GET, DELETE");
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  if (!["/api/scan", "/api/preflight", "/api/run"].includes(url.pathname)) return false;

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Method not allowed" });
    return true;
  }

  try {
    const input = await readJson(request);

    if (typeof input.url !== "string") {
      throw new Error("A GitHub repository URL is required");
    }

    const report = await scan(input.url, process.env.GITHUB_TOKEN);
    if (url.pathname === "/api/scan") {
      sendJson(response, 200, report);
      return true;
    }
    if (!/^[a-f\d]{40}$/i.test(input.commit ?? "")) {
      throw new Error("The scanned commit is required before execution");
    }
    if (input.commit !== report.commit) {
      sendJson(response, 409, { error: "The repository changed after scanning; scan it again before execution" });
      return true;
    }

    const packageIndex = input.packageIndex ?? "readme";
    if (!["readme", "pypi"].includes(packageIndex)) {
      throw new Error("Package index must be readme or pypi");
    }
    const preflight = buildPreflight(report, input.workflowId, await inspectRuntime(), packageIndex);
    if (url.pathname === "/api/preflight") {
      sendJson(response, 200, preflight);
      return true;
    }
    if (input.confirmUnknownCode !== true) {
      throw new Error("Explicit confirmation is required before running unknown code");
    }
    if (!preflight.runnable) {
      sendJson(response, 409, { error: preflight.runtime.reason ?? "The workflow is not ready", preflight });
      return true;
    }
    sendJson(response, 202, startRun(preflight));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed";
    const status = message.startsWith("GitHub API") ? 502 : 400;
    sendJson(response, status, { error: message });
  }

  return true;
}

async function start() {
  const vite = await createViteServer({
    appType: "spa",
    server: { middlewareMode: true },
  });
  const server = createHttpServer(async (request, response) => {
    if (!(await handleApi(request, response))) {
      vite.middlewares(request, response);
    }
  });
  const port = Number(process.env.PORT) || 5173;

  server.listen(port, "127.0.0.1", () => {
    console.log(`ReproCheck: http://127.0.0.1:${port}/`);
  });
}

async function selfTest() {
  const server = createHttpServer(handleApi);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/a/b" }),
    });
    const result = await response.json();

    assert.equal(response.status, 400);
    assert.match(result.error, /github\.com/i);

    const workerResponse = await worker.fetch(
      new Request("https://reprocheck.test/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/a/b" }),
      }),
      {},
    );

    assert.equal(workerResponse.status, 400);

    const preflight = buildPreflight(
      {
        repository: "owner/repo",
        commit: "a".repeat(40),
        workflows: [{
          id: "quick",
          title: "Quick verification",
          status: "READY",
          steps: [{ id: "run", title: "Run", status: "DOCUMENTED", command: "cd repo && python test.py" }],
        }],
      },
      "quick",
      { available: true, engine: "Docker", version: "1" },
    );
    assert.equal(preflight.runnable, true);
    assert.deepEqual(preflight.automatedSteps.map((step) => step.command), ["cd repo && python test.py"]);
    assert.equal(
      rewritePackageIndex("pip install -r requirements.txt -i https://slow.example/simple", "pypi"),
      "pip install -r requirements.txt --index-url https://pypi.org/simple",
    );
    const dockerArgs = buildDockerInvocation(preflight, "reprocheck-test");
    assert.equal(dockerArgs.includes("--cap-drop"), true);
    assert.equal(dockerArgs.includes("-v"), false);
    assert.equal(dockerArgs.includes("10m"), true);
    assert.match(dockerArgs.at(-1), /git -C \/workspace fetch.*a{40}/);
    assert.match(dockerArgs.at(-1), /python test\.py/);
    assert.doesNotMatch(dockerArgs.at(-1), /cd repo/);
    assert.deepEqual(
      summarizeSteps(
        [{ id: "install", title: "Install" }, { id: "run", title: "Run" }],
        "::reprocheck-step::install\nok\n::reprocheck-step::run\nfailed\n",
        "FAILED",
      ).steps.map((step) => step.status),
      ["PASSED", "FAILED"],
    );
    assert.match(
      diagnoseRun("FAILED", "No module named pytest", { title: "Run" }, 10),
      /pytest.*dependencies/,
    );
    assert.match(
      diagnoseRun("TIMED_OUT", "", { id: "install", title: "Install" }, 10, "readme"),
      /Install exceeded 10 minutes.*official PyPI/,
    );

    const missingRun = await fetch(`http://127.0.0.1:${port}/api/runs/missing`);
    assert.equal(missingRun.status, 404);
    const hostedRun = await worker.fetch(new Request("https://reprocheck.test/api/run"), {});
    assert.equal(hostedRun.status, 501);
    console.log("PASS  API self-test");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  await start();
}
