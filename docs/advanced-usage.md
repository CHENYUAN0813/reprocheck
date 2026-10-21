# Advanced usage

[← Project home](../README.md) · [Advanced usage](advanced-usage.md) · [Verification](verification.md) · [Replay](replay.md) · [Testing](testing.md) · [Spotify case](spotify-case.md)

Run commands below from the repository root. Start with the [installation and Iris walkthrough](../README.md#first-run-scan-only).

## Token setup and troubleshooting

GitHub's anonymous API quota may be exhausted. Optionally set a GitHub token in the **same terminal before starting the server**. In PowerShell:

```powershell
$reproToken = Read-Host "GitHub token" -AsSecureString
$env:GITHUB_TOKEN = [System.Net.NetworkCredential]::new("", $reproToken).Password
npm.cmd run dev
```

Do not put the token in source files, screenshots or Git. This project reads the environment variable; it does not automatically load a `.env` file. A `401` means the supplied credentials were rejected. A `403` may indicate rate limiting or access restrictions; inspect the response before retrying. If `5173` is occupied, stop the previous server with `Ctrl+C` before starting another.

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

### Start with one source-validated entry

After scanning, **Start here · check one entry** lists supported Python scripts and README Make targets whose source exists. A single validated test entry is recommended before experiment entries; otherwise a single available entry is suggested, or multiple alternatives require a choice. Choose **Review selected entry in Quick**, inspect its prerequisites, then **Check local runner**. Neither action executes repository code; the existing execution confirmation is still required. The server revalidates the selected ID against the scan, not commands supplied by the browser.

Make setup/prepare commands are retained in the preview. Quick can still download large dependencies/data and does not promise a cheap run. Target existence does not validate internal Make dependencies, successful execution, metric acceptance or the complete paper protocol. Unrecognized commands are labelled **not automatically recognized**, with source pointers; this is not proof that the repository lacks instructions. Full Training and Evaluation remain separate workflows.

## Local isolated execution

Start Docker Desktop, scan a repository, choose **Quick verification** or **Evaluation**, and select **Check local runner**. **Training** also accepts a confirmed custom end-to-end experiment configuration; the BTHOWeN training buttons retain separately reviewed fixed real-paper cases. ReproCheck re-scans the pinned commit before allowing execution and shows every command for review. Training without either configuration remains disabled.

After explicit confirmation, commands run in a temporary container (default `python:3.11`; reviewed cases may pin another version) with 2 CPUs, 2 GB of memory, a 10-minute timeout, a 256-process limit, no host filesystem mounts, and no host credentials. The reviewed Spotify 15-cell matrix uses its fixed 4 CPU, 6 GB and 60-minute profile. Network access remains enabled because public source code, dependencies, and model files may need to be downloaded. Runs can be monitored and cancelled from the page, with per-step status and the exact failure stage.

If dependency installation fails or times out while using a README-provided package index, the run can be retried against official PyPI. The retry keeps the repository commit and dependency declarations unchanged, replaces only pip index options, and records the override in the run result.

## Scan-generated Evaluation candidates

Normal scans include an `evaluationDraft` without a repository-specific preset. It reuses the bounded five-file source sample to associate runnable README commands (or clearly labelled inferred evaluation/main scripts), literal JSON/CSV outputs, labelled print/logging or JSON stdout metrics, exact numeric README lines/horizontal or metric-value tables, and dataset/model/split declarations. Every candidate carries a pinned file/line. Narrative ranges, arbitrary Python semantics, tables embedded in images and paper protocol equivalence are not inferred.

Literal `argparse` declarations expose positional/required single-value arguments, defaults, help and source lines. Enter reviewed values before applying candidates; missing required arguments block configuration, and values are shell-quoted. Existing source-command arguments are preserved, not silently overwritten. Dynamic parsers, multi-value/flag actions and compound/module commands require a custom reviewed command. Referenced YAML/TOML/JSON configuration files are prioritized within the same sample budget; literal data/config/checkpoint paths show complete-tree matches or explicit absence. A path match does not establish the correct working directory, asset preparation or input hash identity.

On the page, choose **Build an Evaluation from this scan**, select the matching entry/output/reference, then **Use candidates in Evaluation form**. The scan report includes a suggestion when exactly one executable command + source-associated README value + same-type/same-unit output triple exists; the page preselects it but never confirms it. Ambiguous or unassociated choices remain manual. Missing fields remain empty. Review the source and complete/correct dataset, split, model and reference declarations. If the original entry prepares its own data/model, explicitly select that existing preparation override. Confirm candidate correspondence before **Check local runner**; any field edit resets this confirmation. The separate unknown-code execution confirmation is still required. Choosing/loading/reviewing candidates never starts a container.

The generic stdout adapter executes the reviewed command, forwards combined stdout/stderr, and saves its actual printed metric in a fresh `reprocheck-evaluation.json`. It recognizes complete colon/equal/comma-print label lines, default Python logging prefixes and ANSI color, or one complete JSON-object line with the selected literal top-level key. It does not copy the reference into observations. Absent/duplicate scores, duplicate JSON fields, non-finite/non-numeric values, unit changes and entry failures fail rather than guessing. Percent/fraction values are not silently converted. Native JSON/CSV candidates require verification of the correct key/column and repository-relative output path. Choosing a reference explicitly associated with a different README command is rejected.

The local backend regenerates the candidate selections from its scan, rejects unknown source IDs/unconfirmed configurations, and records sources plus manual changes in preflight, execution evidence and frozen recipes. Frozen replay retains the saved source context/commands instead of regenerating a new candidate. Source correspondence is **user-reviewed, not independently verified**: README example output is not necessarily a published paper result, and generic candidates do not acquire the reviewed BTHOWeN cases' dataset/checkpoint hash gates.

## Paper provenance and result claims

Each scan now reports explicit README paper declarations and links to arXiv, DOI, OpenReview, ACL Anthology, PMLR, NeurIPS, ACM or IEEE sources with pinned README evidence. Plain repository/web links are ignored. Title-only declarations such as “official code for …” remain labelled as README declarations rather than upgraded to verified publication links. Multiple sources require selection; ReproCheck does not guess which cited work the repository implements.

Metric-context tables such as “NDCG@10 from Table 1” are extracted into bounded dataset/model/value claim candidates even when model names occupy the table columns. Common ranking metrics and cutoffs are preserved (`NDCG@10` → `ndcg_10`). README commands under reproduction/result sections are shown as workflow hints, but unsupported Make or multiline workflows are evidence only and are not silently enabled for execution. The paper panel lists the exact remaining gaps. A reviewable paper candidate is created only when the paper source and command/output/reference triple are each unique; it remains unconfirmed and is not proof of protocol equivalence.

When a root Makefile exists, ReproCheck validates each documented simple target against its pinned source. `make run`, specialized `make run-*` targets and simple repository Python entries become separate adapter alternatives rather than one accidental sequence; documented `make test` and `make verify` wrap each alternative when present. Unknown targets, compound shell commands and incomplete multiline commands remain blocked. Adapter drafts are downloadable but cannot execute until their inputs, outputs and protocol lock are reviewed.

The scan also produces a deterministic protocol-lock draft. Its SHA-256 lock ID covers the repository/commit, paper source declarations, extracted result claims, validated adapters, exact Python/dependency evidence, Git blob identities for README/Makefile/config/source files, literal asset paths, seed evidence and experiment parameters. Missing checkpoints/configuration, ambiguous data/output paths, unpinned environments and absent seed evidence remain explicit gaps. Git blob identities pin repository content only; runtime downloads still require independent SHA-256 verification. Downloading the lock does not confirm scientific equivalence.

## Configurable end-to-end CPU experiments

### Reopen a saved configuration at its original commit

On the home page, choose **Import saved experiment configuration**, select the exported Training JSON, and review its repository and full commit. Choose **Scan saved version** to fetch that exact revision, even if the default branch has advanced. Cancel leaves the current report unchanged. Invalid or unavailable revisions fail explicitly; they never fall back to the latest branch.

The imported form is unconfirmed. Review every command and expectation, confirm and **Apply reviewed experiment**, then **Check local runner** before confirming execution. Scan, preflight and execution use the same configuration commit and retain repository/commit validation. Importing or scanning does not execute code. Hosted scanning accepts the fixed revision, but execution still requires the local server and Docker.

This restores the source version and declared configuration, not frozen dependencies or external datasets. Use [frozen recipe replay](replay.md) for an existing run's recorded environment constraints.

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

## Source-generated paper matrices

When a README contains a contextual result table, ReproCheck builds a dataset × model × optional-seed matrix from its pinned numeric cells. A runnable matrix requires a source-validated paper adapter, the current protocol-lock ID, an explicitly reviewed CSV output path/row key/tolerance, and exact acknowledgement of any unresolved lock gaps. The adapter now includes validated setup/dependency/data Make targets before test/run/verify when those commands are documented in the relevant README sections.

The temporary Docker run executes one selected source workflow and requires a fresh CSV. Dataset rows and model (or model/seed) columns are compared cell by cell with the README references; the evidence report retains observed values, absolute differences and `MATCHED`, `OUTSIDE_REFERENCE` or `MISSING` status. A failed/timed-out matrix can rerun the same pinned configuration in a fresh container; a successful fully matched run can use the existing frozen-recipe replay. ReproCheck does not infer cross-container checkpoint resume or invent per-cell commands the source repository does not document.

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
- Quick verification, CPU-limited Evaluation, confirmed configuration-driven CPU Training and reviewed paper cases run only through the local Docker-backed server; unconfigured Training and automatic arbitrary-paper reproduction remain disabled
- Hosted Sites deployments provide static scanning but not Docker execution
- Local run history is single-user JSON storage; interrupted runs cannot recover their final outcome after a server restart
- Official PyPI override supports a single pip install command, not arbitrary compound shell/Poetry/uv installs
- Output checks require explicit reviewed expectations; literal metric candidates and declared protocols do not establish paper equivalence. Custom experiments export one newly trained model up to 512 KiB, not large model files/directories
- Recipe replay requires the observed local image and index packages available as wheels; downloaded recipe JSON is not an import/execution interface
- Paper matrices currently accept one metric per CSV table and exact dataset/model column labels; arbitrary multi-metric schemas and checkpoint resume remain explicit future work
