"""Reviewed Iris adapter: original evaluation entry, real UCI data.
Run ONLY inside ReproCheck's temporary Docker container, never on the host.
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen

root = Path("/workspace")
case = json.loads(Path("/tmp/reprocheck-benchmark.json").read_text())
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip() == case["commit"]

if sys.argv[1] == "prepare":
    asset = next(a for a in case["assets"] if a["role"] == "dataset")
    with urlopen(asset["url"], timeout=30) as response:
        data = response.read(65537)
    if len(data) > 65536 or hashlib.sha256(data).hexdigest() != asset["sha256"]:
        raise RuntimeError("UCI Iris download does not match the reviewed dataset hash")
    path = root / asset["path"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    patch = case["compatibility"]
    helper = root / patch["file"]
    original = helper.read_bytes()
    if hashlib.sha256(original).hexdigest() != patch["beforeSha256"]:
        raise RuntimeError("Compatibility helper differs from the reviewed original")
    text = original.decode()
    for line in patch["removeLines"]:
        if text.count(line + "\n") != 1:
            raise RuntimeError("Reviewed MNIST-only import patch no longer applies")
        text = text.replace(line + "\n", "")
    expected = next(a["sha256"] for a in case["assets"] if a["path"] == patch["file"])
    if hashlib.sha256(text.encode()).hexdigest() != expected:
        raise RuntimeError("Patched helper hash differs from the reviewed compatibility profile")
    helper.write_text(text)
    print("benchmark-assets-prepared")
elif sys.argv[1] == "evaluate":
    # The collector gates execution on every expected asset hash before this step.
    folder = root / "software_model"
    training = json.loads(Path("/tmp/reprocheck-training.json").read_text()) if case.get("training") else None
    checkpoint = case["training"]["checkpoint"] if training else "software_model/selected_models/iris.pickle.lzma"
    if training and hashlib.sha256((root / checkpoint).read_bytes()).hexdigest() != training["checkpoint_sha256"]:
        raise RuntimeError("Newly trained checkpoint changed before evaluation")
    model_argument = str(Path(checkpoint).relative_to("software_model"))
    result = subprocess.run([sys.executable, "evaluate.py", model_argument, "Iris"],
                            cwd=folder, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print(result.stdout, end="", flush=True)
    result.check_returncode()
    scores = re.findall(r"With bleaching=1, accuracy=(\d+)/(\d+) \([^\n]+", result.stdout)
    if len(scores) != 1:
        raise RuntimeError("Original evaluation did not emit exactly one recognized accuracy")
    correct, total = map(int, scores[0])
    if total != 50 or not 0 <= correct <= total:
        raise RuntimeError("Expected the original 50-sample Iris test split")
    sys.path.insert(0, str(folder))
    import os
    os.chdir(folder)
    from tabular_tools import get_dataset
    train, test = get_dataset("iris")
    if len(train) != 100 or len(test) != total:
        raise RuntimeError("Original Iris split size changed")
    split = {"train": [[x.tolist(), y] for x, y in train], "test": [[x.tolist(), y] for x, y in test]}
    split_hash = hashlib.sha256(json.dumps(split, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    output = {"accuracy": correct / total, "correct": correct, "test_samples": total, "train_samples": len(train),
              "split_seed": 123, "split_sha256": split_hash,
              "entry": f"software_model/evaluate.py {model_argument} Iris",
              "scope": case["reference"]["scope"], "compatibility": case["compatibility"]["note"]}
    if training:
        output["training"] = {key: value for key, value in training.items() if key != "seconds"}
    (root / "benchmark-result.json").write_text(json.dumps(output, sort_keys=True, allow_nan=False))
    print("published-benchmark-ok")
else:
    raise ValueError("Expected prepare or evaluate")
