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

## Self-test

`node scan.mjs --self-test`

GitHub Actions runs the self-tests and production build on every push and pull request.

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
- Run records are stored in memory and are lost when the local server restarts; the container-enforced timeout still applies
