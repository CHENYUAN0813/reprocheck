# Multi-service plans

Use the same `/api/web/run` endpoint with `caseId: "multi-service"`, a `config`, and explicit execution confirmation. No repository-specific executor is required. Existing npm and reviewed business cases remain compatible.

## First run

1. Start Docker and run `npm run setup:services`.
2. Scan a public GitHub repository. Open Web verification. The draft is derived from npm manifests and supported README Uvicorn commands whose modules exist in the pinned tree. It is a suggestion, not a full README interpreter.
3. Review service directories, commands, ports, dependencies, environment and checks. Use the service editors or advanced JSON/import/export. Confirm before running.
4. Inspect per-service installation, test, build and readiness results, browser API checks, logs and screenshot. Unconfigured tests/builds/browser checks are skipped, not passed.

Import `examples/task-planner-services.json` for the public collaborative task-planner snapshot. It runs React and FastAPI with demo authentication and a disposable SQLite database. Generated random values satisfy startup/signing configuration only; the Gemini value is **not a valid provider credential**. No model calls or real Google authentication are tested.

## Configuration

`services` contains up to four entries. Each specifies `id`, `runtime` (`node` or `python`), `directory`, command argument arrays (`install`, `test`, `build`, `start`), `port`, `readyPath`, `dependsOn`, `env`, and `generatedEnv`. Commands are executed as argument arrays, without host shell interpolation. Empty test/build arrays mean skipped. Dependencies determine startup order; each prerequisite must return a successful HTTP response before its dependent starts. Installation/build are completed before service startup. Tests requiring live dependent services are not supported in this version.

Python services have separate virtual environments. Node.js 24.14.0 and Python 3.12.12 are fixed by the application image. The services share a single container, filesystem and localhost; this is not isolation between mutually untrusted services. Each uses a distinct port. No host directories are mounted and no ports are published. Resources: 2 CPUs/2 GB shared application, 2 CPUs/1 GB browser, ten-minute total timeout. Cancellation, failure and timeout remove application/browser containers. Images remain cached.

`env` is stored with the plan and evidence; **never put credentials in it**. Common secret fields are rejected. `generatedEnv` lists names for ephemeral random values generated each run and redacted from logs/records. These values cannot replace external API credentials.

`browser` is either null for an API-only run or `{service, path, expectedText, requiredApi}`. `requiredApi` contains `{service, path}` entries; each requires the browser itself to observe a successful response from that service during page load. An independent health check does not prove frontend/backend communication. The browser may reach only configured localhost service ports. HTTP readiness and basic browser checks do not verify arbitrary business workflows.

## Boundaries

Public github.com snapshots only; no private credentials enter containers. Git symlinks/submodules and unsupported source paths are rejected. No npm workspaces, separate database containers, GPU, live model providers, persistent application data or internet access during execution. Port/path matching is exact. A nonempty page is not proof of correct behavior; configure expected text and required API responses.

The example is ordinary configuration, not an adapter: another compatible project uses the same runner with a different plan. Plans can be imported/exported; applied plans and history survive page reloads. Execution consent is never restored.

## Regression verification

`npm test` includes service configuration validation. `npm run test:services` executes the public task planner, a second npm repository, a Python-only configuration, cancellation/cleanup, and a deliberately missing browser API condition. These tests use Docker and download dependencies; they do not call a live model provider.
