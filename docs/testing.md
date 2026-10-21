# Testing and first-time-user feedback

[← Project home](../README.md) · [Advanced usage](advanced-usage.md) · [Verification](verification.md) · [Replay](replay.md) · [Testing](testing.md) · [Spotify case](spotify-case.md)

## Before testing

Run commands from the repository root after `npm ci`:

```sh
npm test
npm run build
```

On Windows PowerShell, use `npm.cmd` if needed. These checks do not require Docker or live GitHub access. **Do not run tests alongside an active experiment under `npm run dev`**: tests temporarily modify fixtures and may trigger a server restart. Complete offline tests first, or use `node server.mjs` without file watching for execution.

## Self-test

`node scan.mjs --self-test`

GitHub Actions runs the self-tests and production build on every push and pull request.

For the opt-in real Docker integration check, start the local server and run `npm run test:docker`. It scans the pinned Micrograd source, executes scalar-autodiff and held-out CPU Evaluation examples, checks checkpoint reload and reference tolerance, reloads evidence in a new process, replays frozen recipes, reports output differences, and checks that deliberately incorrect expectations/references fail. It does not run Micrograd's default pytest suite or reproduce a published benchmark.

For the opt-in published suite, run `npm run test:benchmark` with Docker running. It evaluates three BTHOWeN pretrained models plus the Sequential Capacity Probes Beauty/MC cell, verifies their counts and every expected identity, checks Iris frozen replay, and proves a deliberately mismatched checkpoint hash prevents evaluation. The Spotify 15-cell preset is tested offline for fixed identity, limits and evidence gates; its longer real run is started from the reviewed UI preset. `npm run test:training` trains and evaluates all three fresh BTHOWeN models and preserves honest `OUTSIDE_REFERENCE` classifications. No repository code or pickle runs on the host. Ordinary `npm test` checks preset identity/immutability/evidence gates without network or Docker.

## Candidate integration coverage

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

## First-time-user acceptance: pending

Ask a classmate unfamiliar with the project to follow only the [README](../README.md), without advance coaching. They should install dependencies, open the page, load Iris, review and run it, download evidence, and reopen its saved report.

Record the step and wording where they get stuck, whether they can explain execution success versus verification, and which finding actually helps. Fix observed blockers before adding features. Maintainer runs and automated tests do not substitute for this external feedback. Do not share tokens or private information in screenshots/logs.
