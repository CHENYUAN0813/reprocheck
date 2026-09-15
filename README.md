# ReproCheck

ReproCheck checks public Python research repositories for reproducibility problems.

It scans the complete repository file tree at a specific commit and reads the root README.

## Usage

`node scan.mjs https://github.com/owner/repository`

For structured JSON output:

`node scan.mjs https://github.com/owner/repository --json`

For the standalone reproduction plan:

`node scan.mjs https://github.com/owner/repository --plan`

For CI, add `--strict`; the command exits with code 1 when blockers or warnings remain:

`node scan.mjs https://github.com/owner/repository --strict`

Each check includes evidence pinned to the scanned commit and a suggestion when action is needed.
The JSON response also contains experiment parameters extracted from common `argparse` and configuration declarations, plus an ordered `reproductionPlan` with validated command references and explicit gaps.
Discovered entry points are also grouped into quick verification, training, and evaluation workflows. The recommended routes prefer simple, self-contained commands and label scripts from linked external tools separately from missing repository files.

## Web interface

`npm run dev`

Open `http://127.0.0.1:5173`, submit a public GitHub repository URL, and download either the full report or the standalone reproduction plan.

## Local isolated execution

Start Docker Desktop, scan a repository, choose **Quick verification**, and select **Check local runner**. ReproCheck re-scans the pinned commit before allowing execution and shows every command for review.

After explicit confirmation, commands run in a temporary `python:3.11` container with 2 CPUs, 2 GB of memory, a 10-minute timeout, a 256-process limit, no host filesystem mounts, and no host credentials. Network access remains enabled because public source code, dependencies, and model files may need to be downloaded. Runs can be monitored and cancelled from the page, with per-step status and the exact failure stage.

If dependency installation fails or times out while using a README-provided package index, the run can be retried against official PyPI. The retry keeps the repository commit and dependency declarations unchanged, replaces only pip index options, and records the override in the run result.

### Output verification and execution evidence

Quick verification optionally accepts a **reviewed command** that replaces only an existing detected final entry point. The preview shows the original README command and the effective commands; dependency and model preparation steps remain unchanged. This is useful for non-interactive smoke tests when the detected command starts an interactive demo or needs missing test dependencies.

Before checking the runner, you can specify expected text in the final entry point's output, a new or changed non-empty output file, and an optional numeric JSON metric condition (at least / at most). JSON metric keys use dotted paths such as `evaluation.accuracy`. File paths must stay inside the repository; file evidence is limited to 64 MB and metric JSON files to 1 MB. Existing, unchanged repository files do not satisfy generated-output checks.

**Execution SUCCEEDED** means the commands exited normally. **Configured checks passed** means the supplied output expectations also passed. Neither proves that a paper's benchmark was reproduced; absent expectations are explicitly labelled as not configured.

The downloadable JSON evidence includes the source commit, original/reviewed/effective commands, package-source override, Python and Docker environment, observed image ID when available, installed dependency versions, extracted parameter defaults, output file size/hash, logs, exit code and verification results. Parameter defaults are not a record of actual seed/argument values. Observations are produced inside an untrusted container and are not a security attestation; binary output files are not exported.

Snapshots are atomically saved under `.reprocheck/runs/` on this computer (ignored by Git). **Recent executions** lists the latest 30 records and lets you reopen/download them after a restart. If the server restarts during a run, the saved snapshot is marked **INTERRUPTED** with an unknown final outcome rather than falsely reporting success or failure. Log storage retains the last 200,000 characters; a save failure is displayed so the evidence can still be downloaded from memory.

### Frozen recipes and replay comparisons

A successful Quick run with passing output checks now embeds a **frozen recipe** in its local evidence record. The recipe contains the exact Git commit, observed Docker image ID, default Python version and dependency versions captured **before the entry point**, original/effective commands, resource limits, expectations, baseline file/metric observations, and a SHA-256 fingerprint. Older records without a pre-entry snapshot cannot be frozen; run them again first.

Open a saved record, choose **Review frozen recipe**, review its steps and expectations, then explicitly confirm and select **Replay frozen recipe**. Replay fetches the saved commit directly instead of re-scanning the latest branch. It requires the exact image to remain locally available, uses `--pull never`, restores pinned packages from official PyPI with wheels only, and applies pip constraints to the saved preparation commands. It checks the default Python version and the complete installed-version set before allowing the entry point to run. It never silently substitutes a newer image or package version. The reviewed fingerprint must still match when execution starts. Pip constraints limit versions but do not install packages themselves; the separate restore step does that ([pip documentation](https://pip.pypa.io/en/stable/user_guide/#constraints-files)). Docker supports content-addressed image references ([Docker documentation](https://docs.docker.com/engine/containers/run/)).

The new run keeps its own evidence and a comparison with its baseline. **SAME** means the configured observations matched exactly, **DIFFERENT** lists observed differences, and **INCOMPLETE** means execution/checks failed or required observations are missing. Comparisons cover source, image, Python, reported platform, installed versions, saved commands, limits, expectations, expected-text check outcome, output file hash and numeric metric delta. Passing a threshold alone does not imply identical results. Text comparison compares the expected-text check, not entire stdout; numeric metrics use exact equality, without an implicit tolerance. Comparison evidence survives server restarts too.

This version replays local recipes from saved records, not arbitrary uploaded JSON. It supports index packages and the container's default Python entry point; direct/editable/VCS dependencies and alternate environment managers need stronger artifact locks. Version pins are not wheel hashes or a guarantee of identical package binaries/build tools. External datasets/checkpoints, hardware and random state are not automatically frozen. A recipe helps repeat and compare a small experiment; it does not certify full paper reproduction.

## Self-test

`node scan.mjs --self-test`

GitHub Actions runs the self-tests and production build on every push and pull request.

For the opt-in real Docker integration check, start the local server and run `npm run test:docker`. It scans the pinned Micrograd source, executes a reviewed scalar-autodiff example, verifies text/file/gradient evidence, reloads the evidence in a new process, replays the frozen recipe with matching output, reports deliberately varying output as different, and checks that deliberately incorrect expectations fail. It does not run Micrograd's default pytest suite or reproduce a published benchmark.

## Current checks

- README exists
- Dependency file exists
- Dependency versions are exactly pinned or locked
- Python version is pinned
- Install command exists in README
- Runnable README commands are collected and categorized
- Dataset acquisition or preparation is documented
- Model weights or checkpoints are documented
- Random seed setup exists in sampled training or configuration code
- Reusable experiment parameters exist in config files or command-line arguments
- GitHub Actions continuous integration workflow exists
- README commands reference scripts and configuration files that exist
- Every discovered runnable entry point includes its validated local references
- License file exists
- Test entry exists

## Current limitations

- Public GitHub repositories only
- README, the primary dependency file, and up to five likely training/configuration files are analyzed; other files are checked by path
- Only the Quick verification workflow can run, and only through the local Docker-backed server
- Hosted Sites deployments provide static scanning but not Docker execution
- Local run history is single-user JSON storage; interrupted runs cannot recover their final outcome after a server restart
- Official PyPI override supports a single pip install command, not arbitrary compound shell/Poetry/uv installs
- Output checks require explicit expectations; paper metrics and binary artifacts are not automatically inferred or reproduced
- Recipe replay requires the observed local image and index packages available as wheels; downloaded recipe JSON is not an import/execution interface
