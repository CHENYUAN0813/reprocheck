import { scan } from "./scan.mjs";

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

    return json(await scan(input.url, env.GITHUB_TOKEN));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan failed";
    return json({ error: message }, message.startsWith("GitHub API") ? 502 : 400);
  }
}

export default {
  fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/scan") return handleScan(request, env);
    if (pathname === "/api/preflight" || pathname === "/api/run" || pathname.startsWith("/api/runs/")) {
      return json({ error: "The Docker runner is available only on the local ReproCheck server" }, 501);
    }
    return env.ASSETS.fetch(request);
  },
};
