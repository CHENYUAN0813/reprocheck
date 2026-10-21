# Spotify: from repository inspection to a 15-cell CPU comparison

## Question

Can a researcher run the deterministic CPU subset of Spotify Research's Sequential Capacity Probes and check each result against its published reference table?

The reviewed source is [spotify-research/sequential-capacity-probes at 705710f](https://github.com/spotify-research/sequential-capacity-probes/tree/705710f78abd613cd8ee139f7435d813eef2f8ab). The comparison covers Beauty, Sports, Toys, MovieLens 1M and MovieLens 20M with MC, SeqRules and PCTM: **15 Table 1 cells**, using full-catalogue NDCG@10.

## What ReproCheck contributes

![Actual Spotify scan: pinned commit, 104 files, seven warnings and source-linked findings](images/spotify-scan.png)

The web scan reports 104 files, zero blockers and seven warnings at this pinned revision. In particular, its basic command checks say installation and runnable commands were not found. The repository uses Make workflows, so these messages expose a detection limit rather than proving that instructions are absent. Review the generated workflow adapters and source links before acting on a warning.

The scan attaches findings and command references to a pinned source revision. The reviewed preset then fixes the environment, data identities, execution entry and reference values. It runs the authors' code in a temporary Docker container and collects a per-cell comparison plus downloadable evidence.

This reduces the work of locating instructions, recording the chosen configuration and manually comparing 15 numbers. We have not yet measured time saved by independent users.

## An actual problem and the human decision

The CPU path computes its results without Torch. However, the upstream deterministic launcher's final global environment verification requires Torch 2.7.1 and raises `ValueError: mc: torch None is not frozen` in the lean CPU environment.

A human reviewed this difference and chose a Python 3.10.12 CPU profile. The adapter accepts that known failure only alongside checks on all 15 original result files, the clean pinned source, exact CPU package versions, dataset hashes, agreement between the original official and independent metrics, and four-decimal reference parity. It does not modify the original model or metric implementations.

This compatibility judgment is specific to the reviewed case. A scan warning alone cannot decide whether an environment difference is scientifically acceptable, whether a dataset split is appropriate, or whether a README result is the right claim to reproduce.

## Repeat the web workflow

Follow the [README installation and Docker instructions](../README.md#larger-example-the-spotify-cpu-case). Use **Load published Spotify CPU matrix benchmark**, then **Check local runner**, review and confirm execution, and select **Run paper matrix**.

The preset is [spotify-cpu-matrix.json](../examples/spotify-cpu-matrix.json); the readable container adapter is [evaluate-capacity-matrix.py](../examples/evaluate-capacity-matrix.py). Inputs are checked before and after the experiment. The runner hashes the resulting CSV and retains observed values, reference values, differences and per-cell statuses.

## Scope and interpretation

### Successful browser acceptance on 2026-10-21

Run `3d8caab1-f514-49da-b218-a86721ba1462` completed through the web interface in **336.53 seconds (5 min 37 sec)**, including installation and data preparation. The page displayed **Execution SUCCEEDED**, **Output verification · Configured checks passed**, and **Paper matrix · 15/15 matched**. The downloaded JSON recorded `SUCCEEDED` and `VERIFIED`, all 26 source/data identity checks passed, and zero missing or outside-reference cells. After a page reload, **Recent executions → View record** reopened the same successful report.

![Actual completed browser run with passing output and matrix checks](images/spotify-web-success.png)

Each value below is the observed NDCG@10 rounded to the paper's four printed decimal places. Every value matched its pinned reference with zero difference at that precision; this is not a claim of exact equality between unrounded measurements and printed values.

| Dataset | MC | SeqRules | PCTM |
| --- | ---: | ---: | ---: |
| Beauty | 0.0492 | 0.0605 | 0.0635 |
| Sports | 0.0251 | 0.0371 | 0.0368 |
| Toys | 0.0548 | 0.0730 | 0.0738 |
| ML-1M | 0.1240 | 0.1505 | 0.1815 |
| ML-20M | 0.1050 | 0.1115 | 0.1431 |

![Actual result matrix showing original observations, rounded comparisons and MATCHED statuses](images/spotify-matrix.png)

The fresh `results/table1-cpu.csv` was 366 bytes, SHA-256 `b4f5e4a246bcf99aaf44af0240bf9e63596ea51bf5a9274df94299b260ab56da`. Execution evidence is downloaded locally, not automatically published. This browser acceptance covers the Spotify preset, preflight, execution, live status, result comparison, evidence download and saved-report reopening. It is not a fresh real-Docker regression of every other preset, cancellation, frozen replay or mobile layout. Offline tests and the production build also passed before the accepted run.

### Browser acceptance on 2026-10-21: blocked by host storage

The actual web flow loaded the pinned preset, checked Docker, accepted execution confirmation and started run `ec8679f2-8cc9-46db-9078-ae34a2e8ba24`. Dependency installation and dataset preparation passed. Logs recorded all 12 model runs for Beauty, Sports, Toys and ML-1M as done, then MovieLens 20M failed with `OSError: [Errno 5] Input/output error`. Docker also reported an I/O error writing its own metadata database.

The host drive holding Docker's virtual disk had about 20 MB free. The page correctly showed **Execution FAILED** and **Verification incomplete**; no fresh 15-cell result matrix was accepted. This attempt does **not** establish a successful end-to-end browser run. The earlier September CPU calculations matched 15/15 references, but they are a separate observation.

Docker's disk was subsequently backed up, checked with SHA-256, and moved through Docker Desktop's disk-image-location setting to a drive with more free space. The original four containers, images and Jenkins volume remained listed after the engine restarted. A follow-up attempt was interrupted by development-server hot reload while offline tests temporarily changed example fixtures; it is not counted as an accepted run. Run these tests before, not during, a live experiment. The next preflight hit GitHub's anonymous API quota. Setting a server-only GitHub token and running the server without file watching allowed the successful browser acceptance reported above. Storage migration and passing offline tests alone were not treated as proof of success.

![Actual browser acceptance failure, showing the failed execution step and incomplete verification](images/spotify-web-incomplete.png)

Before retrying, ensure the drive holding Docker's disk image has substantial free space for dataset copies and caches. Moving the source checkout to another drive alone does not move Docker's storage. Do not repeatedly retry a container while the host disk is full.

- This checks the deterministic CPU subset of one paper. Four other model columns and GPU experiments are outside this acceptance.
- Matching rounded NDCG@10 values is evidence of agreement with those table cells; it is not independent validation of the paper's overall conclusions.
- The preset was manually reviewed. Automatically discovered workflows still require review of inputs, commands, outputs and protocol gaps.
- Container observations and hashes help identify what ran; they are not a security certification. Repository code runs with network access in a temporary container without host mounts or host credentials.

## Feedback we need

Try the workflow and note: which finding changed your next action, which label was unclear, where you got stuck, and how long it took to get a useful report. A failed run with a precise failure stage is useful feedback too. Remove tokens and private information before sharing logs.
