# Local scanning with FastAPI

The local `POST /api/scan` flow now uses FastAPI for request handling and Python for
GitHub requests, fixed-commit file acquisition, README/dependency/source analysis,
base checks and the reproduction plan. React, the public URL, request fields and
the complete report JSON contract are unchanged.

## Install and start

Use Python 3.11+ (tested on 3.12), alongside the existing Node.js installation.

```sh
python -m venv .venv
```

Windows PowerShell:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
npm.cmd run dev
```

macOS/Linux:

```sh
.venv/bin/python -m pip install -r backend/requirements.txt
npm run dev
```

The Node server selects `.venv` automatically, otherwise `python` on PATH. Set
`REPROCHECK_PYTHON` to an executable path for another Python installation. Set
`GITHUB_TOKEN` in the launching terminal as before; it is passed to the local
Python service through its environment, never the browser or rule subprocess.

Open http://127.0.0.1:5173/. There is still one startup command. FastAPI binds only
to loopback on an automatically allocated port. Node preserves the existing
same-origin gate and forwards only scan requests. FastAPI also checks Host and
Origin, JSON content type, the 32,000-byte body limit and execution options.
GitHub errors remain JSON `{ "error": "..." }` with status 502; validation uses
400. Methods other than POST use 405. Each GitHub request has a 30-second timeout,
and the complete scan has a 180-second deadline.

Stopping the parent closes the Python child's stdin, causing it to shut down.
Backend file edits restart the managed service under `npm run dev`. If startup
fails, install the requirements with the Python executable selected above. If
the scan service exits unexpectedly, requests return 502 rather than silently
falling back to the old scanner; restart the local server.

## Deliberate migration boundary

This is **not an entirely Python backend**. Advanced evaluation candidates,
paper/Make workflow reconciliation, protocol fingerprints, paper matrices and
execution-option validation still use the existing checked-in JavaScript rules.
`backend/report-rules.mjs` receives JSON on stdin and returns JSON, with no shell,
GitHub token or execution of downloaded code. It does not fetch the repository
or invoke the original `scan()` function. This keeps scientific/report decisions
and fingerprint serialization consistent during the first migration slice.

Docker execution, preflight rescanning, histories, cancellation/retry, the CLI,
and hosted `worker.mjs` scanning remain JavaScript. No hosting runtime migration
is included. Native Python scan output is compared against the original scanner
so the existing execution paths can continue consuming the same report format.

## Verify

```sh
npm run test:scan
npm test
npm run build
```

`test:scan` generates deterministic mock GitHub responses and compares **every
report field**, including protocol lock IDs, with the original scanner. Cases
cover empty repositories, Python commands, Make workflows, missing/nested paths,
Chinese instructions, pinned versions, dependency locks and all eight reviewed
presets. It also tests validation, origin checks, upstream errors, incomplete
trees, service startup/shutdown and forwarding through the unchanged local API.
Tests need Python dependencies, but no Docker, token or live GitHub connection.

The shared advanced rules have intentionally not been duplicated in Python.
Porting them later requires keeping these same full-report differential tests.
