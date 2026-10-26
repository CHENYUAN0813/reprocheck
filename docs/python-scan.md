# Local scanning with FastAPI

Local `/api/scan`, `/api/preflight` and `/api/run` requests now share FastAPI scanning, using Python for
GitHub requests, fixed-commit file acquisition, README/dependency/source analysis,
checks, reproduction plans, evaluation candidates, paper/Make workflows, protocol
fingerprints and paper matrices. React, the public URL, request fields and
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
same-origin gate and forwards scan inputs from all three routes. For preflight/run,
Node consumes the fresh report and retains commit comparison, execution-option
validation, runtime inspection and explicit execution consent. A scan error or
unavailable Python service is returned as-is; execution cannot fall back to the
old scanner or a cached report. FastAPI also checks Host and
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

Report generation is native Python; it no longer starts Node to enrich each report.
`backend/report.py` composes the report rules in `evaluation_report.py` and
`paper_report.py`, with compatible fingerprint serialization in `report_common.py`.

This is **not an entirely Python backend**. Execution-option validation still
reuses the Docker runner's checked-in JavaScript rules, once before each scan.
`backend/execution-options.mjs` receives JSON on stdin and returns the validated
fixed commit, with no shell, GitHub token or execution of downloaded code.
Keeping this boundary avoids two competing definitions of valid execution options.

Docker execution, histories, cancellation/retry, the CLI,
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

The differential suite also checks Make alternatives, required arguments, metric
reference tables and source ambiguity. It rejects any subprocess launch during
Python report generation. The JavaScript scanner remains the compatibility
reference for CLI and hosted scans; changes to either implementation must keep
these full-report comparisons passing.

### Real Docker acceptance

With Docker Desktop running in Linux-container mode and `GITHUB_TOKEN` set in
the terminal, run:

```sh
npm run test:scan:docker
```

This opt-in test starts its own local Node gateway and managed FastAPI service.
It scans the pinned Iris case, checks execution readiness, starts and cancels
one run, then submits the same configuration as a new run (the existing retry
behavior). Every scan, preflight and run request must go through FastAPI.
The completed run must pass input/source checks, output verification and the
0.98 reference condition, and remain available in saved history and evidence
downloads. Test-owned services close on completion; unfinished test runs are
cancelled on failure. Records remain in `.reprocheck/` for inspection.

This requires network downloads and executes the reviewed third-party case in
Docker. It is separate from `npm test`, and does not retrain Iris or validate all
supported experiments. CLI/cloud scanning and the Docker executor remain JS;
their continued presence is intentional, not an unfinished full-Python migration.

Acceptance on 2026-10-26: the pinned BTHOWeN Iris case passed through the real
FastAPI gateway and Docker runner. Cancellation was recorded as `CANCELLED`;
retry completed as `SUCCEEDED` / `VERIFIED` / `MATCHED_REFERENCE`, with 49/50
correct (0.98). A fresh Node process reopened both records from disk. No test
containers remained running. This is integration evidence for this case, not
a performance benchmark or proof of whole-paper reproduction.

The same acceptance round also reran the existing Docker integration suites:

| Coverage | Result |
| --- | --- |
| Micrograd execution, frozen replay, output and dependency-lock guards | Passed |
| Iris / Ecoli / Wine pretrained evaluation and Spotify Beauty/MC | Matched their configured reference conditions |
| Spotify five-dataset × three-model CPU matrix through FastAPI scan/preflight/run | 15/15 cells matched, no missing/outside cells; 346 seconds |
| Iris / Ecoli / Wine fresh training, exported models and independent evaluation | Execution and evidence checks passed; all three fresh-training scores were outside reference |
| Generic candidates, required arguments, stdout/JSON/CSV capture and replay | Passed; reference mismatches remain visible rather than being relabelled as matches |
| Two configurable training repositories and missing/modified/pre-existing model guards | Passed |
| JS/TypeScript notes and private planner browser acceptance | Cancellation/retry, CRUD, persistence, screenshots and cleanup passed; live Gemini was not requested |

These checks distinguish software correctness from experimental agreement:
`OUTSIDE_REFERENCE` is a recorded experimental result, not a passing reference
claim. Private source, credentials and raw local execution records are not part
of this document or the Git commit.
