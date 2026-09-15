# BTHOWeN / Iris: measured software reproduction case

Observed locally on 2026-09-15. This is one reviewed, real-data software benchmark, not automatic paper certification.

## Source and protocol

- Official paper repository: [ZSusskind/BTHOWeN at 94e33e4ce3e46e8e88a409dcca044e5f7544858d](https://github.com/ZSusskind/BTHOWeN/tree/94e33e4ce3e46e8e88a409dcca044e5f7544858d).
- Reference: [pinned README, Table 3 Iris row](https://github.com/ZSusskind/BTHOWeN/blob/94e33e4ce3e46e8e88a409dcca044e5f7544858d/README.md#L66), test accuracy **0.980**.
- Data: [original UCI Iris download](https://archive.ics.uci.edu/ml/machine-learning-databases/iris/iris.data), 150 rows. Original repository shuffle uses seed 123, with 100 training rows and 50 held-out test rows.
- Model: author's `software_model/selected_models/iris.pickle.lzma`, already trained; no training in this case.
- Entry: unchanged `software_model/evaluate.py`, invoked from its own directory with `selected_models/iris.pickle.lzma Iris`. Original binarization, bleaching=1 and first-label tie handling remain unchanged.

## Measured result

| Observation | Initial run | Frozen replay |
| --- | --- | --- |
| Correct / held-out samples | 49 / 50 | 49 / 50 |
| Accuracy | 0.98 | 0.98 |
| Reference / absolute tolerance | 0.98 / 0 | 0.98 / 0 |
| Dataset/checkpoint/code/reference checks | Passed | Passed |
| Evaluation | MATCHED_REFERENCE | MATCHED_REFERENCE |
| Exact replay comparison | Baseline | SAME |
| Wall time on this computer | 26.582 seconds | 21.669 seconds |

The original program also reported 7/50 ties. Its own first-label tie policy was retained, not replaced by a new metric implementation. Times include source/environment preparation and are not download or inference speed guarantees.

## Recorded identities

| Input/output | SHA-256 |
| --- | --- |
| UCI `iris.data` (4,551 bytes) | `6f608b71a7317216319b4d27b4d9bc84e6abd734eda7872b71a458569e2656c0` |
| Author's Iris checkpoint (664 bytes) | `47847744b61c779a321dc6ea9b3bd5998f0dbba135bfb192a3371ca01de2901e` |
| Original evaluation entry | `ea3209964e8d0d3cb2b247946717cd979be39f13b9d8e219d54783263a78b4e5` |
| Pinned README | `2117b57f15919cc136d7edf18ad1e5dec46a105422844d9c0f55423dbaf61fba` |
| Computed original train/test split | `0559d2b812598e0c6bb7a613950424af09d053e97b6343fd85c97c64c1c05497` |
| Fresh `benchmark-result.json` | `4b2961acae3e3fcb509fcddff185dead210003e7950d1212e15b5761d47cd437` |

All eight required file hashes are listed in `bthowen-iris.json`. The split hash is a locally computed protocol observation, not a hash published by the paper's authors. Full pre-entry installed package versions and host-observed image identity are in each downloadable execution record.

The measured container used Python 3.11.16, Docker Engine 28.3.3 and local image `sha256:8ce0c4b7bad2a0939d3fe311e30f1f12b491b0ba335fe1f2daa1b99894588503`, with ReproCheck's existing 2 CPU / 2 GB / 10 minute limits.

## Explicit compatibility difference and limits

The repository originally targets Python 3.8.10. This reviewed case pins NumPy 1.24.4, Pandas 1.5.3, SciPy 1.10.1, Numba 0.57.1 and Requests 2.28.1 for the existing Python 3.11 runner. It removes only the two unused MNIST `torchvision` imports inside the container, checking both original and patched helper hashes. Iris data/split/binarization/inference code and the evaluation entry are not replaced. No host files or credentials are mounted.

Matching one software accuracy under a disclosed compatible environment does not reproduce training variation, other datasets, RTL hardware, power/area results or the authors' complete original environment. Container-reported observations are not a security attestation. Pickle remains untrusted executable input and is loaded only after hash checks, inside the temporary Docker container.

## Run it and inspect evidence

Start Docker Desktop and `npm run dev`. Choose **Load published Iris benchmark**, then **Check local runner**, review commands/compatibility/source locks, and explicitly confirm unknown-code execution. Download the execution evidence, or review and replay its frozen recipe. Loading the preset does not execute it.

Alternatively, `npm run test:benchmark` runs the opted-in Docker acceptance test: real evaluation, exact replay and an intentionally incorrect checkpoint hash. That negative case must stop before loading the pickle/evaluation entry. Local execution records remain under ignored `.reprocheck/runs/`; they are not committed or uploaded by the test.
