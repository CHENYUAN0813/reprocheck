import { scan } from "./scan.mjs";
import { reviewedCaseById } from "./examples/reviewed-cases.mjs";

const MAX_BODY_BYTES = 4096;

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function handleScan(request, env) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  try {
    const body = await request.text();

    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      throw new Error("Request body is too large");
    }

    const input = JSON.parse(body);

    if (typeof input.url !== "string") {
      throw new Error("A GitHub repository URL is required");
    }

    const benchmarkId = input.executionOptions?.benchmarkId ?? null;
    const benchmark = reviewedCaseById.get(benchmarkId);
    if (benchmarkId !== null && !benchmark) throw new Error("Unknown reviewed benchmark");
    if (benchmark && input.pinnedCommit !== undefined && input.pinnedCommit !== benchmark.commit) throw new Error("Conflicting pinned commits");
    return json(await scan(input.url, env.GITHUB_TOKEN, benchmark?.commit ?? input.pinnedCommit));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed";
    return json({ error: message }, message.startsWith("GitHub API") ? 502 : 400);
  }
}

export default {
  fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/scan") return handleScan(request, env);
    if (pathname === "/api/web" || pathname.startsWith("/api/web/") || pathname === "/api/preflight" || pathname === "/api/run" || pathname === "/api/runs" || pathname.startsWith("/api/runs/")) {
      return json({ error: "The Docker runner is available only on the local ReproCheck server" }, 501);
    }
    return env.ASSETS.fetch(request);
  },
};
