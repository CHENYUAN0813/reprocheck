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

Start Docker Desktop, scan a repository, choose **Quick verification** or **Evaluation**, and select **Check local runner**. ReproCheck re-scans the pinned commit before allowing execution and shows every command for review. Training execution remains disabled.

After explicit confirmation, commands run in a temporary `python:3.11` container with 2 CPUs, 2 GB of memory, a 10-minute timeout, a 256-process limit, no host filesystem mounts, and no host credentials. Network access remains enabled because public source code, dependencies, and model files may need to be downloaded. Runs can be monitored and cancelled from the page, with per-step status and the exact failure stage.

If dependency installation fails or times out while using a README-provided package index, the run can be retried against official PyPI. The retry keeps the repository commit and dependency declarations unchanged, replaces only pip index options, and records the override in the run result.

### Output verification and execution evidence

Quick verification optionally accepts a **reviewed command** that replaces only an existing detected final entry point. The preview shows the original README command and the effective commands; dependency and model preparation steps remain unchanged. This is useful for non-interactive smoke tests when the detected command starts an interactive demo or needs missing test dependencies.

Before checking the runner, you can specify expected text in the final entry point's output, a new or changed non-empty output file, and a numeric JSON metric condition (at least / at most / match reference with absolute tolerance). Zero tolerance means exact numeric equality; positive tolerance boundaries allow machine-level arithmetic rounding. JSON metric keys use dotted paths such as `evaluation.accuracy`. File paths must stay inside the repository; file evidence is limited to 64 MB and metric JSON files to 1 MB. File freshness is checked against the snapshot immediately before the final entry, so unchanged checkout or preparation files do not satisfy generated-output checks.

**Execution SUCCEEDED** means the commands exited normally. **Configured checks passed** means the supplied output expectations also passed. Neither proves that a paper's benchmark was reproduced; absent expectations are explicitly labelled as not configured.

The downloadable JSON evidence includes the source commit, original/reviewed/effective commands, package-source override, Python and Docker environment, observed image ID when available, installed dependency versions, extracted parameter defaults, output file size/hash, logs, exit code and verification results. Parameter defaults are not a record of actual seed/argument values. Observations are produced inside an untrusted container and are not a security attestation; binary output files are not exported.

Snapshots are atomically saved under `.reprocheck/runs/` on this computer (ignored by Git). **Recent executions** lists the latest 30 records and lets you reopen/download them after a restart. If the server restarts during a run, the saved snapshot is marked **INTERRUPTED** with an unknown final outcome rather than falsely reporting success or failure. Log storage retains the last 200,000 characters; a save failure is displayed so the evidence can still be downloaded from memory.

### Frozen recipes and replay comparisons

A successful Quick or Evaluation run with passing output checks now embeds a **frozen recipe** in its local evidence record. The recipe contains the exact Git commit, observed Docker image ID, default Python version and dependency versions captured **before the entry point**, original/effective commands, resource limits, expectations, baseline file/metric observations, and a SHA-256 fingerprint. Older records without a pre-entry snapshot cannot be frozen; run them again first.

Open a saved record, choose **Review frozen recipe**, review its steps and expectations, then explicitly confirm and select **Replay frozen recipe**. Replay fetches the saved commit directly instead of re-scanning the latest branch. It requires the exact image to remain locally available, uses `--pull never`, restores pinned packages from official PyPI with wheels only, and applies pip constraints to the saved preparation commands. It checks the default Python version and the complete installed-version set before allowing the entry point to run. It never silently substitutes a newer image or package version. The reviewed fingerprint must still match when execution starts. Pip constraints limit versions but do not install packages themselves; the separate restore step does that ([pip documentation](https://pip.pypa.io/en/stable/user_guide/#constraints-files)). Docker supports content-addressed image references ([Docker documentation](https://docs.docker.com/engine/containers/run/)).

The new run keeps its own evidence and a comparison with its baseline. **SAME** means the configured observations matched exactly, **DIFFERENT** lists observed differences, and **INCOMPLETE** means execution/checks failed or required observations are missing. Comparisons cover source, image, Python, reported platform, installed versions, saved commands, limits, expectations, expected-text check outcome, output file hash and numeric metric delta. Passing a threshold alone does not imply identical results. Text comparison compares the expected-text check, not entire stdout; numeric metrics use exact equality, without an implicit tolerance. Comparison evidence survives server restarts too.

This version replays local recipes from saved records, not arbitrary uploaded JSON. It supports index packages and the container's default Python entry point; direct/editable/VCS dependencies and alternate environment managers need stronger artifact locks. Version pins are not wheel hashes or a guarantee of identical package binaries/build tools. External datasets/checkpoints, hardware and random state are not automatically frozen. A recipe helps repeat and compare a small experiment; it does not certify full paper reproduction.

### Small CPU Evaluation

Evaluation requires a fresh JSON output file, numeric metric/target, and explicit dataset/split, model/checkpoint and reference-source declarations. Conditions can be thresholds or `reference ± absolute tolerance`; values must use the same units (for example, `0.95` versus `95`). Reports separate command success from **MATCHED_REFERENCE**, **OUTSIDE_REFERENCE** and **INCOMPLETE**. A missing/invalid metric or failed text/file check never counts as a matched reference.

A reviewed Evaluation command may replace the detected final entry or explicitly supply one when the README has no evaluation route. Dependencies remain installed as documented. Separate missing/manual dataset or model preparation blocks execution unless the user explicitly selects that the reviewed entry handles those assets. This choice, original asset instructions, actual commands and declared context are recorded and shown for review; ReproCheck does not silently omit preparation or use host files. A small JSON output preview (up to 8192 characters) is included in downloadable evidence, alongside the final output hash.

**Load CPU evaluation example** scans the actual [Micrograd repository](https://github.com/karpathy/micrograd) and fills a readable, reviewed adapter from `examples/evaluate-micrograd.py`; it does not start a run. The adapter uses the fetched repository's `MLP`, generates a synthetic 32-sample training set and independent 48-sample held-out test set with recorded seeds, trains a `[2,4,1]` model for 40 SGD epochs, saves/reloads its checkpoint, and evaluates held-out accuracy and hinge loss. The JSON also records sample counts and reported dataset/checkpoint hashes. These assets exist only inside the temporary container and are not exported as binary artifacts.

The example's accuracy reference `1.0 ± 0.05` is a **ReproCheck synthetic fixture target**, not Micrograd's moon dataset result or any published paper benchmark. Arbitrary dataset/model/reference descriptions are user declarations, not independently verified sources. Matching the reference within tolerance does not relax frozen replay's exact output-hash/metric comparison: training may produce different checkpoint bytes while reaching the same accuracy. Full paper reproduction, GPU training and automatic benchmark/source matching are not claimed.

### Reviewed real-data benchmark: BTHOWeN / Iris

**Load published Iris benchmark** loads one explicitly reviewed case, not an automatically inferred paper claim. It scans [BTHOWeN at commit 94e33e4](https://github.com/ZSusskind/BTHOWeN/tree/94e33e4ce3e46e8e88a409dcca044e5f7544858d) even if its default branch later advances. Select **Check local runner**, review the compatibility profile and every command, then confirm unknown-code execution to run it locally. Loading the case never starts execution.

The case uses the real [UCI Iris dataset](https://archive.ics.uci.edu/dataset/53/iris), the repository's pretrained Iris checkpoint and its unchanged `software_model/evaluate.py`. Original data loading/shuffling (`random_state=123`), 100/50 train/test split, binarization, bleaching and tie handling are retained. The adapter only prepares assets, invokes the original evaluation as a subprocess and converts its reported accuracy into fresh JSON; it does not train or replace the inference algorithm.

`examples/bthowen-iris.json` records the pinned source, expected dataset/checkpoint/code SHA-256 hashes and the [README Table 3 Iris reference, 0.980](https://github.com/ZSusskind/BTHOWeN/blob/94e33e4ce3e46e8e88a409dcca044e5f7544858d/README.md#L66). Before allowing the evaluation/pickle entry, ReproCheck checks all eight expected file identities and parses the exact reference row. It checks these identities again at completion. Missing/changed assets or a mismatched reference block the entry or fail verification; a normally exiting program alone cannot count as a matched benchmark. The score JSON records the original correct/total counts and a computed train/test split hash. Asset/source checks, the complete preset, original README preparation steps and compatibility changes are included in the downloadable evidence and frozen recipe; replay comparisons include asset hashes and reference-row evidence.

The authors documented Python 3.8.10 and older dependencies. This case uses an explicit Python 3.11 CPU compatibility profile with pinned NumPy/Pandas/SciPy/Numba/Requests versions and wheels from official PyPI. Inside the temporary container it removes exactly two unused MNIST-only `torchvision` imports from `train_swept_models.py`, after verifying the original helper hash; the patched helper hash is also locked. The original `evaluate.py` and Iris computation are unchanged. Original requirements are shown in the scan report, not silently rewritten. This is **software inference under a disclosed compatible environment**, not an unmodified reproduction of the authors' full environment, training, MNIST results or licensed RTL power/area experiments.

The local acceptance run on 2026-09-15 obtained **49/50 = 0.98**, matching the README with zero numeric tolerance. The first run took about 27 seconds and its locked replay about 22 seconds on this computer; exact output, asset hashes and the recorded reference matched (`SAME`). These times are observations, not speed guarantees. See `examples/BTHOWEN-IRIS.md` for the measured case report. Container observations remain untrusted evidence, not a security attestation; asset hashes identify bytes but do not make pickle/code safe. The existing isolated CPU/memory/time limits and explicit confirmation still apply.

## Self-test

`node scan.mjs --self-test`

GitHub Actions runs the self-tests and production build on every push and pull request.

For the opt-in real Docker integration check, start the local server and run `npm run test:docker`. It scans the pinned Micrograd source, executes scalar-autodiff and held-out CPU Evaluation examples, checks checkpoint reload and reference tolerance, reloads evidence in a new process, replays frozen recipes, reports output differences, and checks that deliberately incorrect expectations/references fail. It does not run Micrograd's default pytest suite or reproduce a published benchmark.

For the opt-in published Iris case, run `npm run test:benchmark` with the local server and Docker running. It downloads public source/data and CPU wheels, evaluates the pretrained model, verifies 49/50 and every expected asset/source identity, reloads saved evidence, checks exact frozen replay, and proves a deliberately mismatched checkpoint hash prevents the evaluation/pickle entry. No repository code or pickle runs on the host. Ordinary `npm test` checks the preset identity/immutability/evidence gates without network or Docker.

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
- Quick verification and CPU-limited Evaluation can run only through the local Docker-backed server; Training remains disabled
- Hosted Sites deployments provide static scanning but not Docker execution
- Local run history is single-user JSON storage; interrupted runs cannot recover their final outcome after a server restart
- Official PyPI override supports a single pip install command, not arbitrary compound shell/Poetry/uv installs
- Output checks require explicit expectations; paper metrics and binary artifacts are not automatically inferred or reproduced
- Recipe replay requires the observed local image and index packages available as wheels; downloaded recipe JSON is not an import/execution interface
