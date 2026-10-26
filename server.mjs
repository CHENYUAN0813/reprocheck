import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { pathToFileURL } from "node:url";
import { startScanService } from "./scan-service.mjs";
import {
  buildDockerInvocation,
  buildPreflight,
  buildReplayPreflight,
  cancelRun,
  diagnoseRun,
  getRun,
  inspectRuntime,
  inspectLockedImage,
  listRuns,
  rewritePackageIndex,
  reviewedCaseById,
  startRun,
  summarizeSteps,
  validateExecutionOptions,
} from "./runner.mjs";
import { scan } from "./scan.mjs";
import worker from "./worker.mjs";
import { webCase, webCases, webRuntime, validateWebRequest, startWebRun, getWebRun, listWebRuns, cancelWebRun, webScreenshot } from "./web-runner.mjs";

const MAX_BODY_BYTES = 32_000;

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

export async function handleApi(request, response, scanService) {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const localOrigin = `http://${request.headers.host}`;
    let localHost = false;
    try { localHost = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(localOrigin).hostname); } catch {}
    if (!localHost || (request.headers.origin && request.headers.origin !== localOrigin)) {
      sendJson(response, 403, { error: "Local API requests must come from this ReproCheck origin" });
      return true;
    }
  }
  if (url.pathname === '/api/web' || url.pathname === '/api/web/run') {
    try {
      if (url.pathname === '/api/web' && request.method === 'GET') {
        sendJson(response, 200, { case: webCase, cases: webCases, runtime: await webRuntime() });
      } else if (url.pathname === '/api/web/run' && request.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new Error('JSON required');
        const input = await readJson(request);
        validateWebRequest(input);
        const runtime = await webRuntime();
        if (!runtime.available) { sendJson(response, 409, { error: runtime.reason }); return true; }
        if (input.caseId === 'sydney-planner' && !runtime.plannerAvailable) { sendJson(response, 409, { error: 'Run npm run setup:planner before this case' }); return true; }
        sendJson(response, 202, startWebRun(input));
      } else { sendJson(response, 405, { error: 'Method not allowed' }); }
    } catch (error) { sendJson(response, 400, { error: error.message }); }
    return true;
  }
  const screenshotId = url.pathname.match(/^\/api\/web\/runs\/([\w-]+)\/screenshot$/)?.[1];
  if (screenshotId) {
    if (request.method !== 'GET') { sendJson(response, 405, { error: 'Method not allowed' }); return true; }
    const screenshot = webScreenshot(screenshotId, url.searchParams.get('stage'));
    if (!screenshot) sendJson(response, 404, { error: 'Screenshot not available' });
    else { response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(screenshot); }
    return true;
  }
  const recipeRoute = url.pathname.match(/^\/api\/runs\/([\w-]+)\/(recipe|replay-preflight|replay)$/);
  if (recipeRoute) {
    const [, id, action] = recipeRoute;
    const allowedMethod = action === "recipe" ? "GET" : "POST";
    if (request.method !== allowedMethod) {
      response.setHeader("Allow", allowedMethod);
      sendJson(response, 405, { error: "Method not allowed" });
      return true;
    }
    try {
      const baseline = getRun(id);
      if (!baseline) { sendJson(response, 404, { error: "Baseline run not found" }); return true; }
      if (!baseline.recipe) { sendJson(response, 409, { error: baseline.recipeUnavailableReason ?? "This record predates recipe capture; run again" }); return true; }
      if (action === "recipe") {
        if (url.searchParams.get("download") === "1") response.setHeader("Content-Disposition", `attachment; filename="reprocheck-recipe-${id}.json"`);
        sendJson(response, 200, baseline.recipe);
        return true;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) throw new Error("API POST requests must use application/json");
      const input = await readJson(request);
      if (!input || typeof input !== "object" || Array.isArray(input)
        || Object.keys(input).some((key) => !["confirmUnknownCode", "recipeFingerprint"].includes(key))) throw new Error("Replay conditions are frozen; only the recipe fingerprint and execution confirmation are accepted");
      if (action === "replay" && input.confirmUnknownCode !== true) throw new Error("Explicit confirmation is required before replaying unknown code");
      const runtime = await inspectRuntime();
      const imageAvailable = runtime.available && await inspectLockedImage(baseline.recipe.imageId);
      const preflight = buildReplayPreflight(baseline, runtime, imageAvailable);
      if (action === "replay" && input.recipeFingerprint !== preflight.recipe.fingerprint) {
        sendJson(response, 409, { error: "Recipe fingerprint changed or was not reviewed; review the frozen recipe again" });
        return true;
      }
      if (action === "replay-preflight") sendJson(response, 200, preflight);
      else if (!preflight.runnable) sendJson(response, 409, { error: preflight.reason, preflight });
      else sendJson(response, 202, startRun(preflight));
    } catch (error) { sendJson(response, 400, { error: error.message ?? "Unable to prepare the locked recipe" }); }
    return true;
  }
  if (url.pathname === "/api/runs") {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      sendJson(response, 405, { error: "Method not allowed" });
    } else {
      try {
        const runs = new Map(listRuns().map(run => [run.id, run]));
        for (const run of listWebRuns()) runs.set(run.id, { id: run.id, commit: run.commit, repository: run.repository, status: run.status, startedAt: run.startedAt, finishedAt: run.finishedAt, workflowId: run.workflowId, verificationStatus: run.verification.status });
        sendJson(response, 200, { runs: [...runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 30) });
      }
      catch { sendJson(response, 500, { error: "Unable to read local run history" }); }
    }
    return true;
  }
  const runId = url.pathname.match(/^\/api\/runs\/([\w-]+)$/)?.[1];

  if (runId) {
    if (request.method === "GET") {
      try {
        const job = getWebRun(runId) ?? getRun(runId);
        if (job && url.searchParams.get("download") === "1") {
          response.setHeader("Content-Disposition", `attachment; filename="reprocheck-run-${runId}.json"`);
        }
        sendJson(response, job ? 200 : 404, job ?? { error: "Run not found" });
      } catch { sendJson(response, 500, { error: "Unable to read local run evidence" }); }
      return true;
    }
    if (request.method === "DELETE") {
      const job = cancelWebRun(runId) ?? cancelRun(runId);
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
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) {
      throw new Error("API POST requests must use application/json");
    }
    const input = await readJson(request);

    let report;
    if (scanService) {
      const result = await scanService.request(input);
      if (result.status !== 200 || url.pathname === "/api/scan") {
        sendJson(response, result.status, result.body);
        return true;
      }
      report = result.body;
    }

    if (!input || typeof input.url !== "string") {
      throw new Error("A GitHub repository URL is required");
    }

    const executionOptions = validateExecutionOptions(input.executionOptions);

    const pinnedCommit = executionOptions.benchmarkId ? reviewedCaseById.get(executionOptions.benchmarkId).commit : executionOptions.experiment?.commit ?? input.pinnedCommit;
    if (input.pinnedCommit !== undefined && input.pinnedCommit !== pinnedCommit) throw new Error("Conflicting pinned commits");
    // Only the offline legacy API self-test omits the managed FastAPI service.
    if (!scanService) report = await scan(input.url, process.env.GITHUB_TOKEN, pinnedCommit);
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
    const preflight = buildPreflight(report, input.workflowId, await inspectRuntime(), packageIndex, executionOptions);
    if (url.pathname === "/api/preflight") {
      sendJson(response, 200, preflight);
      return true;
    }
    if (input.confirmUnknownCode !== true) {
      throw new Error("Explicit confirmation is required before running unknown code");
    }
    if (!preflight.runnable) {
      sendJson(response, 409, { error: preflight.reason ?? "The workflow is not ready", preflight });
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
  const scanService = await startScanService();
  console.log("Scan backend: FastAPI (Python)");
  let vite;
  try {
    vite = await createViteServer({
      appType: "spa",
      server: { middlewareMode: true },
    });
    const server = createHttpServer(async (request, response) => {
      if (!(await handleApi(request, response, scanService))) {
        vite.middlewares(request, response);
      }
    });
    const port = Number(process.env.PORT) || 5173;
    server.once("error", async (error) => {
      console.error(`Unable to start local server: ${error.code ?? error.message}`);
      await vite.close();
      await scanService.close();
      process.exitCode = 1;
    });
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
      server.close();
      await vite.close();
      await scanService.close();
      process.exit(0);
    });
    server.listen(port, "127.0.0.1", () => {
      console.log(`ReproCheck: http://127.0.0.1:${port}/`);
    });
  } catch (error) {
    await vite?.close();
    await scanService.close();
    throw error;
  }
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
    const crossOrigin = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: "POST", headers: { Origin: "https://other-site.example", "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(crossOrigin.status, 403);
    const plainPost = await fetch(`http://127.0.0.1:${port}/api/run`, { method: "POST", body: "{}" });
    assert.equal(plainPost.status, 400);
    assert.match((await plainPost.json()).error, /application\/json/);
    const invalidTolerance = await fetch(`http://127.0.0.1:${port}/api/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/owner/repo", executionOptions: { metricTolerance: -1 } }),
    });
    assert.equal(invalidTolerance.status, 400);
    assert.match((await invalidTolerance.json()).error, /non-negative/);

    const workerResponse = await worker.fetch(
      new Request("https://reprocheck.test/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/a/b" }),
      }),
      {},
    );

    assert.equal(workerResponse.status, 400);

    const originalFetch = globalThis.fetch;
    try {
      const config = JSON.parse(readFileSync(new URL("./examples/experiment-iris-random-forest.json", import.meta.url)));
      const requested = [];
      globalThis.fetch = async (url, init) => {
        if (String(url).startsWith("http://127.0.0.1:")) return originalFetch(url, init);
        requested.push(String(url));
        if (String(url).includes("/commits/")) return Response.json({ sha: String(url).endsWith(config.commit) ? config.commit : "b".repeat(40), commit: { tree: { sha: "c".repeat(40) } } });
        if (String(url).includes("/git/trees/")) return Response.json({ tree: [], truncated: false });
        return Response.json({ default_branch: "main" });
      };
      for (const endpoint of ["scan", "preflight", "run"]) {
        requested.length = 0;
        const response = await originalFetch(`http://127.0.0.1:${port}/api/${endpoint}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: `https://github.com/${config.repository}`, ...(endpoint === "scan" ? { pinnedCommit: config.commit } : {}), commit: config.commit,
            workflowId: "training", ...(endpoint !== "scan" ? { executionOptions: config.executionOptions } : {}) }),
        });
        const result = await response.json();
        assert.equal(response.status, endpoint === "run" ? 400 : 200, JSON.stringify(result));
        if (endpoint === "run") assert.match(result.error, /Explicit confirmation/);
        else assert.equal(result.commit, config.commit);
        assert.ok(requested.some((url) => url.endsWith(`/commits/${config.commit}`)));
        assert.ok(!requested.some((url) => url.endsWith("/commits/main")));
      }
      for (const pinnedCommit of ["main", "../main", ""]) {
        const response = await originalFetch(`http://127.0.0.1:${port}/api/scan`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: `https://github.com/${config.repository}`, pinnedCommit }),
        });
        assert.equal(response.status, 400);
      }
      const hostedPinned = await worker.fetch(new Request("https://reprocheck.test/api/scan", {
        method: "POST", body: JSON.stringify({ url: `https://github.com/${config.repository}`, pinnedCommit: config.commit }),
      }), {});
      assert.equal((await hostedPinned.json()).commit, config.commit);
      for (const preset of reviewedCaseById.values()) {
        const requested = [];
        globalThis.fetch = async (url) => {
          requested.push(String(url));
          if (String(url).includes("/commits/")) return Response.json({ sha: preset.commit, commit: { tree: { sha: "b".repeat(40) } } });
          if (String(url).includes("/git/trees/")) return Response.json({ tree: [], truncated: false });
          return Response.json({ default_branch: "main" });
        };
        const response = await worker.fetch(new Request("https://reprocheck.test/api/scan", {
          method: "POST", body: JSON.stringify({ url: `https://github.com/${preset.repository}`, executionOptions: { benchmarkId: preset.id } }),
        }), {});
        assert.equal(response.status, 200, preset.id);
        assert.equal((await response.json()).commit, preset.commit, preset.id);
        assert.ok(requested.some((url) => url.endsWith(`/commits/${preset.commit}`)), preset.id);
      }
      globalThis.fetch = async () => { throw new Error("Unknown presets must not fetch"); };
      const unknown = await worker.fetch(new Request("https://reprocheck.test/api/scan", {
        method: "POST", body: JSON.stringify({ url: "https://github.com/owner/repo", executionOptions: { benchmarkId: "unknown" } }),
      }), {});
      assert.equal(unknown.status, 400);
      assert.equal((await unknown.json()).error, "Unknown reviewed benchmark");
    } finally { globalThis.fetch = originalFetch; }
    console.log(`PASS  hosted scan routing for all ${reviewedCaseById.size} reviewed presets and unknown-ID rejection`);

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
    assert.throws(() => validateExecutionOptions({ quickCommand: "python test.py\nrm -rf /workspace" }), /single line/);
    const reviewed = buildPreflight({
      repository: "owner/repo", commit: "a".repeat(40),
      workflows: [{ id: "quick", title: "Quick", status: "READY", steps: [{ id: "run", title: "Run", status: "DOCUMENTED", command: "python test.py" }] }],
    }, "quick", { available: true }, "readme", { quickCommand: "python demo.py" });
    assert.equal(reviewed.automatedSteps.at(-1).command, "python demo.py");
    assert.equal(reviewed.commandOverride.original, "python test.py");
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
    const invalidWeb = await fetch(`http://127.0.0.1:${port}/api/web/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: 'unknown', confirmUnknownCode: true }) });
    assert.equal(invalidWeb.status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/web`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/web`, { headers: { Origin: 'https://untrusted.test' } })).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/web/runs/missing/screenshot`)).status, 404);
    const hostedRun = await worker.fetch(new Request("https://reprocheck.test/api/run"), {});
    assert.equal(hostedRun.status, 501);
    const history = await fetch(`http://127.0.0.1:${port}/api/runs`);
    assert.equal(history.status, 200);
    assert.ok(Array.isArray((await history.json()).runs));
    assert.equal((await worker.fetch(new Request("https://reprocheck.test/api/runs"), {})).status, 501);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/runs/missing/recipe`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/runs/missing/recipe`, { method: "POST" })).status, 405);
    assert.equal((await worker.fetch(new Request("https://reprocheck.test/api/runs/missing/replay"), {})).status, 501);
    console.log("PASS  API self-test");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) {
    await selfTest();
  } else {
    await start();
  }
}
