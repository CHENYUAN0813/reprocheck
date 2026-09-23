"""Reviewed 15-cell RecSys Table 1 adapter; run only in ReproCheck's temporary container."""
import csv
import json
import os
import subprocess
import sys
from collections import deque
from pathlib import Path

root = Path("/workspace")
case = json.loads(Path("/tmp/reprocheck-benchmark.json").read_text())
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip() == case["commit"]
env = {**os.environ, "PYTHONPATH": str(root / "src"), "PCTM_EVAL_JOBS": "4"}

if sys.argv[1] == "prepare":
    subprocess.run([sys.executable, "scripts/setup_dependency.py"], cwd=root, env=env, check=True)
    subprocess.run([sys.executable, "scripts/prepare_data.py", "--source", "public", "--datasets",
                    "s3_beauty", "s3_sports", "s3_toys", "ml_1m", "ml_20m"], cwd=root, env=env, check=True)
    print("benchmark-assets-prepared")
elif sys.argv[1] == "evaluate":
    process = subprocess.Popen([sys.executable, "scripts/run_deterministic.py"], cwd=root, env=env,
                               text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    tail = deque(maxlen=120)
    for line in process.stdout:
        print(line, end="", flush=True)
        tail.append(line)
    failure = case["compatibility"]["acceptedVerifierFailure"]
    if process.wait() != 0 and failure not in "".join(tail):
        raise RuntimeError("Original deterministic launcher failed before the reviewed compatibility boundary")

    assets = {asset["path"]: asset["sha256"] for asset in case["assets"]}
    dataset_keys = {"Beauty": "beauty", "Sports": "sports", "Toys": "toys", "ML-1M": "ml1m", "ML-20M": "ml20m"}
    data_dirs = {"beauty": "s3_beauty", "sports": "s3_sports", "toys": "s3_toys", "ml1m": "ml_1m", "ml20m": "ml_20m"}
    rows = {}
    for cell in case["matrix"]["cells"]:
        dataset = dataset_keys[cell["dataset"]]
        model = cell["model"].lower()
        result_path = root / "results" / dataset / f"{model}.json"
        if not result_path.is_file():
            raise RuntimeError(f"Missing original result: {result_path.relative_to(root)}")
        result = json.loads(result_path.read_text())
        official = result["official_metrics"]["ndcg@10"]
        independent = result["custom_metrics"]["ndcg10"]
        observed = result["environment"]
        expected_versions = {"numpy": "1.26.4", "pandas": "2.3.3", "scipy": "1.12.0", "rectools": "0.13.0"}
        if abs(official - independent) > 1e-12:
            raise RuntimeError(f"{cell['id']}: official and independent NDCG@10 differ")
        if (round(official, cell["precision"]) != cell["target"] or observed["source_commit"] != case["commit"]
                or observed["source_dirty"] is not False or not observed["python"].startswith("3.10.12 ")
                or observed["torch"] is not None or any(observed[name] != version for name, version in expected_versions.items())):
            raise RuntimeError(f"{cell['id']}: source, environment or Table 1 reference mismatch")
        directory = data_dirs[dataset]
        for split in ("train", "holdout"):
            path = f"data/processed/{directory}/leave_one_out/{split}.csv"
            if result["data"][split]["sha256"] != assets[path]:
                raise RuntimeError(f"{cell['id']}: {split} data hash mismatch")
        rows.setdefault(cell["dataset"], {})[cell["column"].lower()] = official

    output = root / case["matrix"]["outputFile"]
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=[case["matrix"]["rowKey"], "mc", "seqrules", "pctm"])
        writer.writeheader()
        for dataset in dataset_keys:
            writer.writerow({case["matrix"]["rowKey"]: dataset, **rows[dataset]})
    print("published-matrix-ok")
else:
    raise ValueError("Expected prepare or evaluate")
