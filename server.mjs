import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
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

  if (url.pathname !== "/api/scan") return false;

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

    sendJson(response, 200, await scan(input.url, process.env.GITHUB_TOKEN));
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
