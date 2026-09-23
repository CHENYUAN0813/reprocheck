"""Reviewed RecSys Table 1 adapter; run only in ReproCheck's temporary container."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

root = Path("/workspace")
case = json.loads(Path("/tmp/reprocheck-benchmark.json").read_text())
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip() == case["commit"]
env = {**os.environ, "PYTHONPATH": str(root / "src")}

if sys.argv[1] == "prepare":
    subprocess.run([sys.executable, "scripts/setup_dependency.py"], cwd=root, env=env, check=True)
    subprocess.run([sys.executable, "scripts/prepare_data.py", "--source", "public", "--datasets", "s3_beauty"],
                   cwd=root, env=env, check=True)
    print("benchmark-assets-prepared")
elif sys.argv[1] == "evaluate":
    os.chdir(root)
    sys.path.insert(0, str(root / "src"))
    os.environ["PCTM_EVAL_JOBS"] = "2"
    from capacity_probes.config import DatasetCase, load_table_config
    from capacity_probes.core_runner import run_model
    config = load_table_config(root / "configs/table1.json")
    details = config["datasets"]["beauty"]
    original = run_model("mc", DatasetCase("beauty", details["directory"], details["max_history"]),
                         details.get("mc", {}), root / "data/processed", root / "cache",
                         root / "results", "cpu", int(config["protocol"]["refit_seed"]))
    original_path = root / "results/beauty/mc.json"
    official = original["official_metrics"]["ndcg@10"]
    independent = original["custom_metrics"]["ndcg10"]
    if abs(official - independent) > 1e-12:
        raise RuntimeError("Official and independent NDCG@10 calculations differ")
    observed_environment = original["environment"]
    if observed_environment["source_commit"] != case["commit"] or observed_environment["source_dirty"] is not False:
        raise RuntimeError("Original runner did not observe the reviewed clean source")
    if not observed_environment["python"].startswith("3.10.12 "):
        raise RuntimeError("Original runner did not observe Python 3.10.12")
    if round(official, 4) != case["reference"]["value"]:
        raise RuntimeError("Original NDCG@10 does not match the pinned four-decimal reference")
    output = {
        "ndcg10": official,
        "ndcg10_4dp": round(official, 4),
        "recall10": original["official_metrics"]["recall@10"],
        "held_out_users": original["custom_metrics"]["users"],
        "train_rows": original["data"]["train"]["rows"],
        "train_sha256": original["data"]["train"]["sha256"],
        "holdout_sha256": original["data"]["holdout"]["sha256"],
        "original_result": "results/beauty/mc.json",
        "original_result_sha256": hashlib.sha256(original_path.read_bytes()).hexdigest(),
        "scope": case["reference"]["scope"],
    }
    (root / "benchmark-result.json").write_text(json.dumps(output, sort_keys=True, allow_nan=False))
    print("published-benchmark-ok")
else:
    raise ValueError("Expected prepare or evaluate")
