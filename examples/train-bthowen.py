"""Container-only launcher: call original argument parser, training and model saver.
One Table 3 configuration, not a test-score search or pretrained-model fallback.
"""
import hashlib
import json
import os
import sys
import time
from pathlib import Path

root = Path("/workspace")
case = json.loads(Path("/tmp/reprocheck-benchmark.json").read_text())
profile = case["training"]
checkpoint = root / profile["checkpoint"]
if checkpoint.exists():
    raise RuntimeError("Training output must not exist before the original trainer runs")
os.chdir(root / "software_model")
sys.path.insert(0, str(Path.cwd()))
import train_swept_models as trainer

# Linux fork workers inherit this seed. It is our disclosed run seed, not an author seed.
trainer.np.random.seed(profile["seed"])
sys.argv = ["train_swept_models.py", *profile["arguments"]]
started = time.monotonic()
print("Training from scratch: original trainer, one configuration, one worker; seed=42", flush=True)
trainer.main()
if not checkpoint.is_file() or not 0 < checkpoint.stat().st_size <= 65536:
    raise RuntimeError("Original trainer must save a new checkpoint up to 64 KiB")
summary = {"entry": "software_model/train_swept_models.py", "arguments": profile["arguments"],
           "parameters": profile["parameters"], "seed": profile["seed"], "runs": 1,
           "checkpoint": profile["checkpoint"], "checkpoint_sha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
           "seconds": round(time.monotonic() - started, 3), "pretrained_checkpoint_used": False,
           "selection": "One fixed configuration; no test-set search or retries for a better score"}
Path("/tmp/reprocheck-training.json").write_text(json.dumps(summary, allow_nan=False))
print("training-checkpoint-saved", flush=True)
