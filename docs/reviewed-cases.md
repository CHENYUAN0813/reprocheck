# Reviewed examples and measured results

[← Project home](../README.md) · [Advanced usage](advanced-usage.md) · [Verification](verification.md) · [Replay](replay.md) · [Testing](testing.md) · [Spotify case](spotify-case.md)

## Reviewed real-data benchmark suite: BTHOWeN

The **Load published Iris/Ecoli/Wine benchmark** buttons load three explicitly reviewed cases from the same paper, not automatically inferred paper claims. They scan [BTHOWeN at commit 94e33e4](https://github.com/ZSusskind/BTHOWeN/tree/94e33e4ce3e46e8e88a409dcca044e5f7544858d) even if its default branch later advances. Select **Check local runner**, review the compatibility profile and every command, then confirm unknown-code execution to run locally. Loading a case never starts execution.

The cases use real UCI Iris, Ecoli and Wine data, the repository's selected pretrained checkpoints and its unchanged `software_model/evaluate.py`. Original loading/shuffling (`random_state=123`), train/test splits, binarization, bleaching and tie handling are retained. One shared adapter prepares the selected case's assets, invokes the original evaluation as a subprocess and converts its reported accuracy into fresh JSON; it does not train or replace the inference algorithm.

`examples/bthowen-iris.json` and `examples/bthowen-paper-cases.json` record the pinned source, per-case dataset/checkpoint SHA-256 hashes and exact README Table 3 rows. Before allowing the evaluation/pickle entry, ReproCheck checks every expected file identity and parses the selected row; it checks them again at completion. Missing/changed assets or a mismatched reference block the entry or fail verification. Score JSON records original correct/total counts and a computed split hash. Wine compares the exact observed `58/59` with the README's three-decimal `0.983` using only `0.0005` rounding tolerance.

The authors documented Python 3.8.10 and older dependencies. These cases use an explicit Python 3.11 CPU compatibility profile with pinned NumPy/Pandas/SciPy/Numba/Requests wheels from official PyPI. Inside the temporary container it removes exactly two unused MNIST-only `torchvision` imports from `train_swept_models.py`, after verifying both original and patched hashes. Original `evaluate.py` and dataset computations are unchanged. This is **software inference under a disclosed compatible environment**, not an unmodified reproduction of the authors' full environment, MNIST results or licensed RTL power/area experiments.

Local acceptance on 2026-09-23 obtained **Iris 49/50 = 0.98**, **Ecoli 98/112 = 0.875** and **Wine 58/59 = 0.9830508…**: all three matched the pinned rows. Each completed in about 21 seconds on this computer; Iris frozen replay was `SAME`, and a deliberately wrong checkpoint hash stopped before evaluation. Times are observations, not guarantees. Container observations remain untrusted evidence, not a security attestation; hashes identify bytes but do not make pickle/code safe.

## Reviewed real-paper training suite: BTHOWeN

The three **Load … training reproduction** buttons select fixed Training profiles from `examples/bthowen-training.json` and `examples/bthowen-paper-cases.json`. Review **Check local runner**, explicitly confirm unknown-code execution, then choose **Run Training reproduction**. Loading a case does not start a run.

The runner invokes the original `train_swept_models.py` parser, `main`, training algorithm and model saver with the selected Table 3 parameters. NumPy seed 42 is explicitly set by the container-only launcher and inherited by Linux fork workers; it is not claimed to be the authors' seed. The trainer uses its own small-dataset validation policy. Each selection runs exactly one configuration, with no test-score search, repeated seeds or pretrained-checkpoint fallback.

The new checkpoint must be absent before training. Its size/hash are recorded after original saving; unchanged original `evaluate.py` evaluates that new file, not a `selected_models` checkpoint. Data/code/reference identities are checked before training, before evaluation and at completion; model bytes must remain unchanged during evaluation. Logs show training and evaluation as separate steps. The report includes actual counts, parameters, seed, training time and model identity.

**Download newly trained model** exports only this reviewed checkpoint, up to 64 KiB, from the saved local evidence. Base64 bytes are validated against size/SHA-256 before being offered. The file remains downloadable after the temporary container is removed or the server restarts. This does not make pickle safe: never load untrusted models on the host. Generic artifact-directory export is not implemented.

Fixed-seed local runs on 2026-09-23 all executed successfully but fell outside the authors' selected-model results: **Iris 48/50 = 0.96** versus `0.98`, **Ecoli 93/112 = 0.83036** versus `0.875`, and **Wine 46/59 = 0.77966** versus `0.983`. The new checkpoints were respectively 688, 1,880 and 1,628 bytes. These honest negative results demonstrate why verifying a selected checkpoint is different from reproducing it with one training run; they are not retried to search for a better seed.

`npm run test:training` opts into real Docker training, model export/persistence, original held-out evaluation, honest reference classification and an incorrect-code-hash case that must stop before training. `npm test` covers the route, fixed parameters/conditions, model freshness, download hash validation and pre-training gates offline.

For the Spotify CPU subset, see the [separate case study](spotify-case.md).
