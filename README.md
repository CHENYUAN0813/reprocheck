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

Start Docker Desktop, scan a repository, choose **Quick verification** or **Evaluation**, and select **Check local runner**. **Training** also accepts a confirmed custom end-to-end experiment configuration; **Load Iris training reproduction** retains the separately reviewed fixed real-paper case. ReproCheck re-scans the pinned commit before allowing execution and shows every command for review. Training without either configuration remains disabled.

After explicit confirmation, commands run in a temporary `python:3.11` container with 2 CPUs, 2 GB of memory, a 10-minute timeout, a 256-process limit, no host filesystem mounts, and no host credentials. Network access remains enabled because public source code, dependencies, and model files may need to be downloaded. Runs can be monitored and cancelled from the page, with per-step status and the exact failure stage.

If dependency installation fails or times out while using a README-provided package index, the run can be retried against official PyPI. The retry keeps the repository commit and dependency declarations unchanged, replaces only pip index options, and records the override in the run result.

### Output verification and execution evidence

Quick verification optionally accepts a **reviewed command** that replaces only an existing detected final entry point. The preview shows the original README command and the effective commands; dependency and model preparation steps remain unchanged. This is useful for non-interactive smoke tests when the detected command starts an interactive demo or needs missing test dependencies.

Before checking the runner, you can specify expected text in the final entry point's output, a new or changed non-empty output file, and a numeric JSON or single-row CSV metric condition (at least / at most / match reference with absolute tolerance). Zero tolerance means exact numeric equality; positive tolerance boundaries allow machine-level arithmetic rounding. JSON keys use dotted paths such as `evaluation.accuracy`; CSV uses the exact column name, including dots, and requires a unique non-empty header plus exactly one complete data row. Configurable keys/column names currently accept letters, numbers, underscores, hyphens and separated dots, not spaces. CSV cells must be finite numbers without percent/unit conversion; select or aggregate multi-row results explicitly in the entry. File paths must stay inside the repository; file evidence is limited to 64 MB and metric files to 1 MB. File freshness is checked against the snapshot immediately before the final entry, so unchanged checkout or preparation files do not satisfy generated-output checks.

**Execution SUCCEEDED** means the commands exited normally. **Configured checks passed** means the supplied output expectations also passed. Neither proves that a paper's benchmark was reproduced; absent expectations are explicitly labelled as not configured.

The downloadable JSON evidence includes the source commit, original/reviewed/effective commands, package-source override, Python and Docker environment, observed image ID when available, installed dependency versions, extracted parameter defaults, output file size/hash, logs, exit code and verification results. Parameter defaults are not a record of actual seed/argument values. Observations are produced inside an untrusted container and are not a security attestation. Confirmed custom experiments export one newly trained model file up to 512 KiB; fixed reviewed BTHOWeN checkpoints retain a 64 KiB limit. Model directories and large binaries are not exported.

Snapshots are atomically saved under `.reprocheck/runs/` on this computer (ignored by Git). **Recent executions** lists the latest 30 records and lets you reopen/download them after a restart. If the server restarts during a run, the saved snapshot is marked **INTERRUPTED** with an unknown final outcome rather than falsely reporting success or failure. Log storage retains the last 900,000 characters, including bounded model evidence; a save failure is displayed so the evidence can still be downloaded from memory.

### Frozen recipes and replay comparisons

A successful Quick, Evaluation or configured Training run with passing output checks embeds a **frozen recipe** in its local evidence record. The recipe contains the exact Git commit, observed Docker image ID, default Python version and dependency versions captured **before the entry point** (before training for Training workflows), original/effective commands, resource limits, expectations, baseline file/metric observations, and a SHA-256 fingerprint. Older records without a pre-entry snapshot cannot be frozen; run them again first. A completed training run outside the reference retains its model and evidence, but cannot be frozen as a passing-reference recipe.

Open a saved record, choose **Review frozen recipe**, review its steps and expectations, then explicitly confirm and select **Replay frozen recipe**. Replay fetches the saved commit directly instead of re-scanning the latest branch. It requires the exact image to remain locally available, uses `--pull never`, restores pinned packages from official PyPI with wheels only, and applies pip constraints to the saved preparation commands. It checks the default Python version and the complete installed-version set before allowing the entry point to run. It never silently substitutes a newer image or package version. The reviewed fingerprint must still match when execution starts. Pip constraints limit versions but do not install packages themselves; the separate restore step does that ([pip documentation](https://pip.pypa.io/en/stable/user_guide/#constraints-files)). Docker supports content-addressed image references ([Docker documentation](https://docs.docker.com/engine/containers/run/)).

The new run keeps its own evidence and a comparison with its baseline. **SAME** means the configured observations matched exactly, **DIFFERENT** lists observed differences, and **INCOMPLETE** means execution/checks failed or required observations are missing. Comparisons cover source, image, Python, reported platform, installed versions, saved commands, limits, expectations, expected-text check outcome, output file hash and numeric metric delta. Passing a threshold alone does not imply identical results. Text comparison compares the expected-text check, not entire stdout; numeric metrics use exact equality, without an implicit tolerance. Comparison evidence survives server restarts too.

This version replays local recipes from saved records, not arbitrary uploaded JSON. It supports index packages and the container's default Python entry point; direct/editable/VCS dependencies and alternate environment managers need stronger artifact locks. Version pins are not wheel hashes or a guarantee of identical package binaries/build tools. External datasets/checkpoints, hardware and random state are not automatically frozen. A recipe helps repeat and compare a small experiment; it does not certify full paper reproduction.

### Scan-generated Evaluation candidates

Normal scans include an `evaluationDraft` without a repository-specific preset. It reuses the bounded five-file source sample to associate runnable README commands (or clearly labelled inferred evaluation/main scripts), literal JSON/CSV outputs, labelled print/logging or JSON stdout metrics, exact numeric README lines/horizontal or metric-value tables, and dataset/model/split declarations. Every candidate carries a pinned file/line. Narrative ranges, arbitrary Python semantics, tables embedded in images and paper protocol equivalence are not inferred.

Literal `argparse` declarations expose positional/required single-value arguments, defaults, help and source lines. Enter reviewed values before applying candidates; missing required arguments block configuration, and values are shell-quoted. Existing source-command arguments are preserved, not silently overwritten. Dynamic parsers, multi-value/flag actions and compound/module commands require a custom reviewed command. Referenced YAML/TOML/JSON configuration files are prioritized within the same sample budget; literal data/config/checkpoint paths show complete-tree matches or explicit absence. A path match does not establish the correct working directory, asset preparation or input hash identity.

On the page, choose **Build an Evaluation from this scan**, select the matching entry/output/reference, then **Use candidates in Evaluation form**. Missing fields remain empty. Review the source and complete/correct dataset, split, model and reference declarations. If the original entry prepares its own data/model, explicitly select that existing preparation override. Confirm candidate correspondence before **Check local runner**; any field edit resets this confirmation. The separate unknown-code execution confirmation is still required. Choosing/loading/reviewing candidates never starts a container.

The generic stdout adapter executes the reviewed command, forwards combined stdout/stderr, and saves its actual printed metric in a fresh `reprocheck-evaluation.json`. It recognizes complete colon/equal/comma-print label lines, default Python logging prefixes and ANSI color, or one complete JSON-object line with the selected literal top-level key. It does not copy the reference into observations. Absent/duplicate scores, duplicate JSON fields, non-finite/non-numeric values, unit changes and entry failures fail rather than guessing. Percent/fraction values are not silently converted. Native JSON/CSV candidates require verification of the correct key/column and repository-relative output path. Choosing a reference explicitly associated with a different README command is rejected.

The local backend regenerates the candidate selections from its scan, rejects unknown source IDs/unconfirmed configurations, and records sources plus manual changes in preflight, execution evidence and frozen recipes. Frozen replay retains the saved source context/commands instead of regenerating a new candidate. Source correspondence is **user-reviewed, not independently verified**: README example output is not necessarily a published paper result, and generic candidates do not acquire the reviewed BTHOWeN cases' dataset/checkpoint hash gates.

`npm run test:candidates` opts into public downloads and the bounded Docker runner. It derives the KNN case in [KTS-o7/AIML-Lab](https://github.com/KTS-o7/AIML-Lab), checks actual observation and frozen replay, and executes the original `main.py` in [ArsPoghosyan/KNN-From-Scratch](https://github.com/ArsPoghosyan/KNN-From-Scratch). The latter uses an explicitly declared comparison target because its README example is associated with another command; selecting that example as a matching command reference is rejected. Controlled no-network Docker probes check logging/comma/ANSI/JSON stdout, CSV, shell-quoted argument completion, independent scores and invalid/ambiguous outputs. BTHOWeN, MiniMind and kelhass KNN are scanned for supported candidates or explicit gaps, not executed by this suite. No new repository-specific execution adapter/preset is added. Ordinary `npm test` covers extraction/review/provenance offline.

Measured locally on 2026-09-15 (coverage depends on the pinned source and five-file sample):

| Repository / pinned commit | Observed candidate coverage / outcome |
| --- | --- |
| `KTS-o7/AIML-Lab` · `0a5250ac2c4610fc354eea3bd645fc253cae4439` | KNN command, stdout label, builtin Iris/split/model declarations and README line 99 extracted; original entry printed `0.9778`, matching the README example with zero tolerance. Frozen replay was `SAME`. This is an educational software example, not a paper benchmark. |
| `ArsPoghosyan/KNN-From-Scratch` · `eb468f49d6f68ceac31e6fb18b0c1ebf6b1b3e4c` | Inferred original `main.py`, builtin Iris, 80/20 split with `random_state=42`, KNN `k=5`, and separate Custom/Sklearn accuracy labels. Actual Custom accuracy was `1.0`; the declared comparison with README example `0.95` reported `OUTSIDE_REFERENCE`, not success by adjusted tolerance. README line 113 belongs to another command and is not independently verified main.py protocol correspondence. |
| `ZSusskind/BTHOWeN` · `94e33e4ce3e46e8e88a409dcca044e5f7544858d` | One inferred evaluation script, required positional `model_fname`/`dset_name`, and 11 table references including Iris `0.98`; no supported output capture in the sample. Generic configuration remains incomplete. The separately reviewed Iris preset again obtained `49/50 = 0.98` and `SAME` replay, with input locks and disclosed compatibility preparation. |
| `kelhass/knn_from_scratch` · `2870d3fbc2b5043f62d1620266d895f24e00b90a` | One entry, four vertical-table references, no supported output capture. The original entry first needs missing private `Prog1data.xlsx`; scan records its absence. Included `data/Iris.xlsx` also does not establish the expected `data/raw/` working path. Not executed or replaced with another dataset. |
| `jingyaogong/minimind` · `7a9137d2e90294df80ce9178b89e82657e19f5a7` | 13 possible entry commands, no exact supported reference value or output capture in the sample. Scan-only; model/data preparation and metric extraction still require explicit review. |

In this phase the AIML KNN run/replay took about 19–20 seconds each, the Ars original entry about 22 seconds, and reviewed Iris run/replay about 23 seconds each. These are observations, not speed guarantees; unpinned packages are recorded, not assumed identical. Negative checks reject unconfirmed/unknown sources, wrong command/reference associations, duplicate scores/JSON fields, booleans and malformed/multi-row/unit-bearing CSV; a probe observed `0.41` independently of a `0.91` target. Iris checkpoint-mismatch and Micrograd runner regressions passed. Local evidence archives remain ignored by Git.

### Small CPU Evaluation

Evaluation requires a fresh JSON or single-row CSV output file, numeric metric/target, and explicit dataset/split, model/checkpoint and reference-source declarations. Conditions can be thresholds or `reference ± absolute tolerance`; values must use the same units (for example, `0.95` versus `95`). Reports separate command success from **MATCHED_REFERENCE**, **OUTSIDE_REFERENCE** and **INCOMPLETE**. A missing/invalid metric or failed text/file check never counts as a matched reference.

A reviewed Evaluation command may replace the detected final entry or explicitly supply one when the README has no evaluation route. Dependencies remain installed as documented. Separate missing/manual dataset or model preparation blocks execution unless the user explicitly selects that the reviewed entry handles those assets. This choice, original asset instructions, actual commands and declared context are recorded and shown for review; ReproCheck does not silently omit preparation or use host files. A small JSON/CSV output preview (up to 8192 characters) is included in downloadable evidence, alongside the final output hash.

**Load CPU evaluation example** scans the actual [Micrograd repository](https://github.com/karpathy/micrograd) and fills a readable, reviewed adapter from `examples/evaluate-micrograd.py`; it does not start a run. The adapter uses the fetched repository's `MLP`, generates a synthetic 32-sample training set and independent 48-sample held-out test set with recorded seeds, trains a `[2,4,1]` model for 40 SGD epochs, saves/reloads its checkpoint, and evaluates held-out accuracy and hinge loss. The JSON also records sample counts and reported dataset/checkpoint hashes. These assets exist only inside the temporary container and are not exported as binary artifacts.

The example's accuracy reference `1.0 ± 0.05` is a **ReproCheck synthetic fixture target**, not Micrograd's moon dataset result or any published paper benchmark. Arbitrary dataset/model/reference descriptions are user declarations, not independently verified sources. Matching the reference within tolerance does not relax frozen replay's exact output-hash/metric comparison: training may produce different checkpoint bytes while reaching the same accuracy. Full paper reproduction, GPU training and automatic benchmark/source matching are not claimed.

### Reviewed real-data benchmark suite: BTHOWeN

The **Load published Iris/Ecoli/Wine benchmark** buttons load three explicitly reviewed cases from the same paper, not automatically inferred paper claims. They scan [BTHOWeN at commit 94e33e4](https://github.com/ZSusskind/BTHOWeN/tree/94e33e4ce3e46e8e88a409dcca044e5f7544858d) even if its default branch later advances. Select **Check local runner**, review the compatibility profile and every command, then confirm unknown-code execution to run locally. Loading a case never starts execution.

The cases use real UCI Iris, Ecoli and Wine data, the repository's selected pretrained checkpoints and its unchanged `software_model/evaluate.py`. Original loading/shuffling (`random_state=123`), train/test splits, binarization, bleaching and tie handling are retained. One shared adapter prepares the selected case's assets, invokes the original evaluation as a subprocess and converts its reported accuracy into fresh JSON; it does not train or replace the inference algorithm.

`examples/bthowen-iris.json` and `examples/bthowen-paper-cases.json` record the pinned source, per-case dataset/checkpoint SHA-256 hashes and exact README Table 3 rows. Before allowing the evaluation/pickle entry, ReproCheck checks every expected file identity and parses the selected row; it checks them again at completion. Missing/changed assets or a mismatched reference block the entry or fail verification. Score JSON records original correct/total counts and a computed split hash. Wine compares the exact observed `58/59` with the README's three-decimal `0.983` using only `0.0005` rounding tolerance.

The authors documented Python 3.8.10 and older dependencies. These cases use an explicit Python 3.11 CPU compatibility profile with pinned NumPy/Pandas/SciPy/Numba/Requests wheels from official PyPI. Inside the temporary container it removes exactly two unused MNIST-only `torchvision` imports from `train_swept_models.py`, after verifying both original and patched hashes. Original `evaluate.py` and dataset computations are unchanged. This is **software inference under a disclosed compatible environment**, not an unmodified reproduction of the authors' full environment, MNIST results or licensed RTL power/area experiments.

Local acceptance on 2026-09-23 obtained **Iris 49/50 = 0.98**, **Ecoli 98/112 = 0.875** and **Wine 58/59 = 0.9830508…**: all three matched the pinned rows. Each completed in about 21 seconds on this computer; Iris frozen replay was `SAME`, and a deliberately wrong checkpoint hash stopped before evaluation. Times are observations, not guarantees. Container observations remain untrusted evidence, not a security attestation; hashes identify bytes but do not make pickle/code safe.

### Reviewed real-paper training suite: BTHOWeN

The three **Load … training reproduction** buttons select fixed Training profiles from `examples/bthowen-training.json` and `examples/bthowen-paper-cases.json`. Review **Check local runner**, explicitly confirm unknown-code execution, then choose **Run Training reproduction**. Loading a case does not start a run.

The runner invokes the original `train_swept_models.py` parser, `main`, training algorithm and model saver with the selected Table 3 parameters. NumPy seed 42 is explicitly set by the container-only launcher and inherited by Linux fork workers; it is not claimed to be the authors' seed. The trainer uses its own small-dataset validation policy. Each selection runs exactly one configuration, with no test-score search, repeated seeds or pretrained-checkpoint fallback.

The new checkpoint must be absent before training. Its size/hash are recorded after original saving; unchanged original `evaluate.py` evaluates that new file, not a `selected_models` checkpoint. Data/code/reference identities are checked before training, before evaluation and at completion; model bytes must remain unchanged during evaluation. Logs show training and evaluation as separate steps. The report includes actual counts, parameters, seed, training time and model identity.

**Download newly trained model** exports only this reviewed checkpoint, up to 64 KiB, from the saved local evidence. Base64 bytes are validated against size/SHA-256 before being offered. The file remains downloadable after the temporary container is removed or the server restarts. This does not make pickle safe: never load untrusted models on the host. Generic artifact-directory export is not implemented.

Fixed-seed local runs on 2026-09-23 all executed successfully but fell outside the authors' selected-model results: **Iris 48/50 = 0.96** versus `0.98`, **Ecoli 93/112 = 0.83036** versus `0.875`, and **Wine 46/59 = 0.77966** versus `0.983`. The new checkpoints were respectively 688, 1,880 and 1,628 bytes. These honest negative results demonstrate why verifying a selected checkpoint is different from reproducing it with one training run; they are not retried to search for a better seed.

`npm run test:training` opts into real Docker training, model export/persistence, original held-out evaluation, honest reference classification and an incorrect-code-hash case that must stop before training. `npm test` covers the route, fixed parameters/conditions, model freshness, download hash validation and pre-training gates offline.

### Configurable end-to-end CPU experiments

The web log replaces the large structured-evidence/Base64 line with a short notice; complete evidence and model bytes remain in the downloadable record.

Scan a supported public Python repository, choose **Training**, review the scan-prefilled fields, and complete missing installation/preparation/training/evaluation commands, new checkpoint path, metric capture, dataset/split, parameters, seed policy, reference and protocol differences. Literal/inferred commands are candidates, not automatically established author protocols. All stages start at `/workspace`, the checked-out repository root; a command needing another working directory must explicitly use `cd directory && ...`. A blank installation or preparation command is deliberately confirmed, not inferred proof that dependencies or data exist. Data may already be in the repository, built into the original loader, or fetched by the reviewed preparation/training command; host file uploads are not supported.

Confirm the full configuration, select **Apply reviewed experiment**, then **Check local runner**. Review every effective command and separately confirm unknown-code execution before **Run Training reproduction**. The generic flow is installation → optional data preparation → original training command → newly produced model gate → original evaluation command. No repository-name dispatch or new repository-specific Python execution adapter is needed. Training remains subject to the existing local CPU/memory/time/network restrictions. This is configuration-driven software execution, not arbitrary automatic full-paper reproduction.

The model path must be a repository-relative file absent immediately before training; a checked-in/prepared pretrained model is rejected rather than deleted or silently reused. After training, a non-empty model up to **512 KiB** must exist before evaluation is allowed. The same bytes must remain at completion, and exported bytes are checked against size/SHA-256 before offering **Download newly trained model**. Model downloads survive container removal and completed-record reload. This proves observed file freshness/identity, **not** that arbitrary evaluator code actually used the file or that untrusted code cannot forge observations; users review the hand-off/protocol, and no host model deserialization occurs. Do not load untrusted pickle/joblib files on the host.

Scores can come from a native JSON/single-row CSV file, exactly one labelled numeric stdout line, or one JSON-object stdout metric line. Stdout capture reuses the generic adapter and records the original evaluator's actual printed score, never the target; output paths are explicit. Score freshness is reset **after training, before evaluation**, so a trainer-produced score followed by a no-op evaluator cannot pass. Metrics, model hash/size, actual stage commands, declared parameters/seed/protocol and known reference differences are retained in the report. Declarations do not secretly modify command arguments or set RNG seeds. Matching a printed score is not scientific protocol verification.

**Download experiment configuration** saves a `schemaVersion: 1`, pinned repository/commit, `workflowId: training` and execution-options envelope. **Import saved experiment configuration** loads it only when both envelope and inner experiment match the current scan. Import never starts execution and always clears confirmation; field edits clear applied configuration/preflight and require review again. A moved default branch requires explicit review of its new commit; local frozen recipes remain the separate interface for replaying an old accepted run. Downloaded frozen recipes are not experiment-import files.

Two public repositories were run on 2026-09-15 using only the JSON configurations below, without changes to their original train/evaluate scripts or a dedicated execution adapter:

- [bantu-4879/mlops_week4_assignment, pinned f8e7466](https://github.com/bantu-4879/mlops_week4_assignment/tree/f8e74667df83abaacbe76ccdd8f316b5b74dbba3): `examples/experiment-iris-random-forest.json` invokes original `src/train.py` and `src/evaluate.py`, built-in Iris, original 120/30 split with `random_state=42` and 100-tree Random Forest. Actual held-out accuracy **1.0** matched the explicitly **user-defined software target**, not a published result. New `model.joblib`: **186,929 bytes**, SHA-256 `f16dc4bdc34d58ea90f8f83c4ec7353b2340da9ab15c72f56b56d7a0b08fd48f`; complete run **13.176 seconds**. Runtime-only pinned dependencies exclude unused DVC/pytest/pandas tools; this choice is disclosed in configuration.
- [Dorsumsellae/ml-pipeline, pinned 40e84fd](https://github.com/Dorsumsellae/ml-pipeline/tree/40e84fd2333cca40614b9e20534b2ba2173a238c): `examples/experiment-iris-stratified.json` invokes original `train.py` and `evaluate.py`, original stratified 120/30 split with `random_state=1` and 200 trees. Actual **printed** accuracy **0.97** matched the [README expected-output example](https://github.com/Dorsumsellae/ml-pipeline/blob/40e84fd2333cca40614b9e20534b2ba2173a238c/README.md#L91) with zero tolerance; the original evaluator rounds to two decimals. New `model.joblib`: **340,193 bytes**, SHA-256 `b51b1f6b3e5296dd94c9a93da4f334863fdb3fd1f30ad42e62d91654d51eb5f4`; complete run **13.332 seconds**. Python 3.11 execution vs README Python 3.12+ and direct-entry dependencies excluding unused PyYAML are disclosed compatibility choices.

These are **educational software pipeline acceptance cases**, not two reproduced papers. Times are local observations, not guarantees. Both cases exercise configuration-driven original training → new saved model → original held-out evaluation → downloadable model/evidence. `npm run test:experiments` additionally checks trainer-only stale scores, evaluator-modified models, absent outputs and pre-existing models; missing/pre-existing model cases must stop before the evaluation entry. Ordinary `npm test` covers configuration/identity/review/capture/model checks and replay ordering offline. Existing reviewed BTHOWeN/Evaluation/Quick regression suites remain in place. No extra application dependency or remote execution service was added.

## Self-test

`node scan.mjs --self-test`

GitHub Actions runs the self-tests and production build on every push and pull request.

For the opt-in real Docker integration check, start the local server and run `npm run test:docker`. It scans the pinned Micrograd source, executes scalar-autodiff and held-out CPU Evaluation examples, checks checkpoint reload and reference tolerance, reloads evidence in a new process, replays frozen recipes, reports output differences, and checks that deliberately incorrect expectations/references fail. It does not run Micrograd's default pytest suite or reproduce a published benchmark.

For the opt-in published suite, run `npm run test:benchmark` with Docker running. It downloads public source/data and CPU wheels, evaluates all three pretrained models, verifies their counts and every expected identity, checks Iris frozen replay, and proves a deliberately mismatched checkpoint hash prevents evaluation. `npm run test:training` trains and evaluates all three fresh models and preserves honest `OUTSIDE_REFERENCE` classifications. No repository code or pickle runs on the host. Ordinary `npm test` checks preset identity/immutability/evidence gates without network or Docker.

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
- README, the primary dependency file, and up to five likely evaluation/training/configuration files are analyzed; other files are checked by path
- Quick verification, CPU-limited Evaluation, confirmed configuration-driven CPU Training and the reviewed BTHOWeN Training cases run only through the local Docker-backed server; unconfigured Training and automatic arbitrary-paper reproduction remain disabled
- Hosted Sites deployments provide static scanning but not Docker execution
- Local run history is single-user JSON storage; interrupted runs cannot recover their final outcome after a server restart
- Official PyPI override supports a single pip install command, not arbitrary compound shell/Poetry/uv installs
- Output checks require explicit reviewed expectations; literal metric candidates and declared protocols do not establish paper equivalence. Custom experiments export one newly trained model up to 512 KiB, not large model files/directories
- Recipe replay requires the observed local image and index packages available as wheels; downloaded recipe JSON is not an import/execution interface
