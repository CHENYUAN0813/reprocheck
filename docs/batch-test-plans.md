# Offline batch test plans

Use this mode for commands that finish, such as pytest or build checks. Unlike a service plan, it requires no listening port, readiness URL or browser. It reuses the existing local Docker runner, cancellation, cleanup and history. A new repository needs a configuration, not a repository-specific executor.

## Prerequisites

- Local ReproCheck, Git, Docker Desktop running Linux containers, and `python` on the host (Python 3.10+ for the standard-library JUnit parser).
- Either an explicitly reviewed **local Linux image**, or a repository Dockerfile that builds one with the project's dependencies, `sh`, `timeout`, `tar` and `python`. You can now prepare that image from the webpage.
- Public github.com source pinned to a full commit. Symlinks and submodules are rejected. Source archives are limited to 64 MiB.

## Run from the page

1. Scan the repository, then choose **Configure batch or service execution →**. In **Execution mode**, select **Configured batch tests**.
2. Import a plan JSON (examples below), or edit and apply the JSON. Inspect the displayed repository and commit: importing a plan can change the execution target.
3. Choose **Environment preparation**: reuse a local image, or **Build from repository Dockerfile**. For a build, select a discovered Dockerfile or enter its path and build directory. The suggested directory is the Dockerfile's parent; check the upstream instructions because some Dockerfiles require the repository root. Open the fixed-source link and review dependencies. Optional non-secret build arguments are editable in plan JSON.
4. Review commands, environment, working directory, memory, timeout and optional JUnit path. Select **Check environment**. Build mode requires a separate acknowledgement of network access and disk consumption, plus execution consent. Select **Run batch tests**: image preparation appears as a stage before offline tests. Cancel stops the operation; a retry starts fresh and can reuse completed layers.
5. Inspect command exit codes and test counts, expand individual test cases and download the JUnit XML or full execution evidence. Records remain in **History & comparison**.

Applied plans survive refresh and language changes. Execution and image-build consent do not. Export the JSON to retain or share it. A build plan can prepare the image on another machine; a local-image plan still needs that image present. A saved image ID alone is not a downloadable image.

Commands are ordered argument arrays, for example `["python", "-m", "pytest", "testing", "--junitxml=result.xml"]`. They run in the configured repository-relative directory. Shell syntax is not implicitly evaluated; if an upstream shell script is required, explicitly use `bash` and review that script. Environment values are persisted: do not put credentials in the plan or image.

## Image preparation

A build plan sets `image` to an empty string and adds:

```json
"build": {
  "context": "scripts/ci/host-image",
  "dockerfile": "Dockerfile",
  "args": {"DEBIAN_MIRROR": "https://deb.debian.org"}
}
```

Paths refer only to the pinned repository. The Dockerfile path is relative to the context. ReproCheck sends a bounded Git archive to Docker over stdin, never a host checkout, `.git`, SSH agent, mounted host directory or build secret. Build logs join the existing run log. The history records context SHA-256, arguments, cache tag and resulting immutable image ID.

A matching source/configuration cache tag is reused automatically. Base-image tags and remote package sources may change, so a fresh build on another machine is not guaranteed to produce the same image. To deliberately rebuild, remove only that identified cache tag through Docker or change the reviewed plan; this feature does not prune images automatically.

**Builds are networked and use Docker builder resource settings**, not the test container's CPU/memory limits. The plan's total timeout covers fetching, building and tests. Images, package caches and failed-build layers can consume substantial disk space. Windows cancellation terminates the Docker/buildx process tree. No GPU devices or credentials are provided. Building a Dockerfile remains execution of reviewed third-party instructions, not a security certification.

## Isolation and results

**Tests** use a fresh non-root container, read-only image, temporary `/tmp`, no network, no host mounts or devices, dropped capabilities and resource limits. Memory is configurable from 512–8192 MiB, the timeout from 1–30 minutes, and CPU is capped at two. This is local isolation, not a security attestation. Containers are removed after completion/cancellation; images, caches, logs and evidence remain on disk.

- **SUCCEEDED**: the selected commands exited zero.
- **VERIFIED**: a configured, valid JUnit report contains at least one passed test and no failed/error cases, and commands exited zero.
- **INCOMPLETE**: no JUnit check was configured, or the report contains no passed cases (including all-skipped suites).
- **FAILED**: a command failed, the configured report was missing/invalid, or it contained failures/errors.

JUnit is **reported by the tested repository**, not independent proof of correctness. The report must be newly generated rather than a committed source file, regular, non-symlinked, UTF-8 XML and at most 256 KiB. DTDs/entities and inconsistent counts are rejected. Up to 200 cases are displayed; the original XML and its SHA-256 are retained. Console truncation does not truncate this evidence. No result implies full-paper reproduction, hardware compatibility or model quality.

## Examples and checks

- [RhinoForge CPU checks and observed results](rhinoforge-case.md)
- [RhinoForge plan](../examples/rhinoforge-batch.json)
- [iniconfig plan](../examples/iniconfig-batch.json): the same runner and prepared image, different repository/commands; 54 parser tests in the recorded run.

Run `node test-batch.mjs` for configuration/parser tests. `npm run test:batch` builds the RhinoForge environment and runs both repositories plus long-log evidence, nonzero-exit, missing-report, cancellation and retry checks. It reports upstream failures honestly rather than changing their expectations.
