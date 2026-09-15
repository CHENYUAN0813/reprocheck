"""Bounded, container-local observations; not a security attestation."""
import hashlib
import base64
import csv
import importlib.metadata
import json
import platform
import re
import sys
from pathlib import Path

options = json.loads(sys.argv[1])
root = Path("/workspace").resolve()
baseline = Path("/tmp/reprocheck-baseline.json")
environment_file = Path("/tmp/reprocheck-environment.json")
assets_file = Path("/tmp/reprocheck-assets.json")
checkpoint_baseline = Path("/tmp/reprocheck-checkpoint-before.json")


def observe_environment():
    distributions = list(importlib.metadata.distributions())
    return {
        "environment": {"python": platform.python_version(), "platform": platform.platform(),
                        "capture": "before-entry",
                        "unlockedDependencies": sorted(d.metadata["Name"] for d in distributions if d.read_text("direct_url.json"))},
        "dependencies": sorted(f"{d.metadata['Name']}=={d.version}" for d in distributions),
    }


def observe_file(name=None):
    name = name or options.get("outputFile")
    if not name:
        return None
    result = {"path": name, "exists": False, "fresh": False}
    try:
        path = (root / name).resolve()
        if not path.is_relative_to(root):
            raise ValueError("Output path resolves outside the repository")
        if not path.is_file():
            return result
        result.update(exists=True, size=path.stat().st_size)
        if result["size"] > 64 * 1024 * 1024:
            raise ValueError("Output evidence is limited to files up to 64 MB")
        with path.open("rb") as stream:
            result["sha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
        return result
    except Exception as error:
        result["error"] = str(error)
        return result


def observe_benchmark():
    case = options.get("benchmark")
    if not case:
        return None
    assets = []
    for expected in case["assets"]:
        observed = observe_file(expected["path"])
        assets.append({**observed, "role": expected["role"], "expectedSha256": expected["sha256"],
                       "status": "PASSED" if not observed.get("error") and observed.get("sha256") == expected["sha256"] else "FAILED"})
    source = case["reference"]
    reference = {"file": source["file"], "line": source["line"], "url": source["url"], "value": None, "status": "FAILED"}
    try:
        path = (root / source["file"]).resolve()
        if not path.is_relative_to(root) or path.stat().st_size > 1024 * 1024:
            raise ValueError("Reference must be a repository text file up to 1 MB")
        text = path.read_text().splitlines()[source["line"] - 1]
        reference.update(text=text, value=float(text.strip().strip("|").split("|")[-1].strip()))
        if text == source["text"] and reference["value"] == source["value"]:
            reference["status"] = "PASSED"
    except Exception as error:
        reference["error"] = str(error)
    return {"assets": assets, "referenceEvidence": reference}


artifact = observe_file()
if sys.argv[2] == "inputs":
    identities = observe_benchmark()
    if identities and (any(asset["status"] != "PASSED" for asset in identities["assets"]) or identities["referenceEvidence"]["status"] != "PASSED"):
        raise RuntimeError("Reviewed inputs changed after training; evaluation entry was not run")
elif sys.argv[2] == "environment":
    snapshot = observe_environment()
    environment_file.write_text(json.dumps(snapshot), encoding="utf-8")
    # Preparation output is not evidence that the final entry produced anything.
    baseline.write_text(json.dumps(artifact), encoding="utf-8")
    training = (options.get("benchmark") or {}).get("training")
    if training:
        initial = observe_file(training["checkpoint"])
        checkpoint_baseline.write_text(json.dumps(initial))
        if initial["exists"]:
            raise RuntimeError("Reviewed training must start without an existing output checkpoint")
    identities = observe_benchmark()
    if identities:
        assets_file.write_text(json.dumps(identities), encoding="utf-8")
        if any(asset["status"] != "PASSED" for asset in identities["assets"]) or identities["referenceEvidence"]["status"] != "PASSED":
            raise RuntimeError("Reviewed dataset/model/code hash or reference row does not match; training/evaluation entry was not run")
    locked = options.get("lockedEnvironment")
    if locked:
        normalize = lambda items: sorted(re.sub(r"[-_.]+", "-", item.split("==")[0].lower()) + "==" + item.split("==")[1] for item in items)
        if snapshot["environment"]["python"] != locked["python"] or normalize(snapshot["dependencies"]) != normalize(locked["dependencies"]):
            raise RuntimeError("Locked Python/dependency environment does not match the recipe; entry point was not run")
        if snapshot["environment"]["unlockedDependencies"]:
            raise RuntimeError("Direct/local dependency sources cannot be verified by this recipe")
elif sys.argv[2] == "start":
    baseline.write_text(json.dumps(artifact), encoding="utf-8")
else:
    previous = json.loads(baseline.read_text(encoding="utf-8")) if baseline.exists() else None
    if artifact and artifact.get("sha256"):
        artifact["fresh"] = artifact["sha256"] != (previous or {}).get("sha256")
    metric = None
    evaluation_output = None
    if options.get("metricKey"):
        metric = {"key": options["metricKey"], "value": None}
        try:
            if not artifact or not artifact.get("sha256") or artifact["size"] > 1024 * 1024:
                raise ValueError("Metric needs a readable JSON or single-row CSV output file up to 1 MB")
            text = (root / options["outputFile"]).resolve().read_text(encoding="utf-8")
            is_csv = options["outputFile"].lower().endswith(".csv")
            if is_csv:
                import io
                reader = csv.DictReader(io.StringIO(text))
                if not reader.fieldnames or any(not name.strip() for name in reader.fieldnames) or len(set(reader.fieldnames)) != len(reader.fieldnames):
                    raise ValueError("CSV requires a unique header")
                rows = list(reader)
                if len(rows) != 1 or None in rows[0] or any(item is None for item in rows[0].values()):
                    raise ValueError("CSV metric requires exactly one complete data row; choose/aggregate rows explicitly in the entry")
                value = rows[0]
            else:
                value = json.loads(text)
            if options.get("evaluation"):
                evaluation_output = {"data": value} if len(json.dumps(value, allow_nan=False)) <= 8192 else {"data": None, "note": "Evaluation output preview is limited to 8192 characters"}
            if is_csv:
                value = value[options["metricKey"]]
                if not re.fullmatch(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?", value.strip()):
                    raise ValueError("CSV metric must be a numeric cell without implicit unit conversion")
                value = float(value)
            else:
                for key in options["metricKey"].split("."):
                    value = value[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError("Metric is not a number")
            import math
            if not math.isfinite(value):
                raise ValueError("Metric is not finite")
            metric["value"] = value
        except Exception as error:
            metric["error"] = str(error)
    snapshot = json.loads(environment_file.read_text(encoding="utf-8")) if environment_file.exists() else observe_environment()
    if not environment_file.exists():
        snapshot["environment"]["capture"] = "after-failure"
    identities = observe_benchmark()
    if identities:
        before = json.loads(assets_file.read_text()) if assets_file.exists() else None
        for asset in identities["assets"]:
            initial = next((item for item in (before or {}).get("assets", []) if item["path"] == asset["path"]), None)
            asset["capture"] = "before-and-after-entry" if initial else "after-failure"
            if not initial or initial["status"] != "PASSED":
                asset["status"] = "UNKNOWN" if not initial else "FAILED"
        if not before or before["referenceEvidence"]["status"] != "PASSED":
            identities["referenceEvidence"]["status"] = "UNKNOWN" if not before else "FAILED"
    training_checkpoint = None
    training = (options.get("benchmark") or {}).get("training")
    if training:
        training_checkpoint = {**observe_file(training["checkpoint"]), "status": "FAILED"}
        try:
            initial = json.loads(checkpoint_baseline.read_text())
            summary = json.loads(Path("/tmp/reprocheck-training.json").read_text())
            if initial["exists"] or training_checkpoint.get("error") or not 0 < training_checkpoint.get("size", 0) <= 65536:
                raise ValueError("Expected a new, bounded training checkpoint")
            if training_checkpoint.get("sha256") != summary["checkpoint_sha256"]:
                raise ValueError("Trained checkpoint changed during evaluation")
            training_checkpoint.update(fresh=True, status="PASSED", trainingSeconds=summary["seconds"],
                                       base64=base64.b64encode((root / training["checkpoint"]).read_bytes()).decode())
        except Exception as error:
            training_checkpoint["error"] = str(error)
    evidence = {
        **snapshot,
        **(identities or {}),
        "artifact": artifact,
        "metric": metric,
        "evaluationOutput": evaluation_output,
        **({"trainingCheckpoint": training_checkpoint} if training_checkpoint else {}),
    }
    # ponytail: only this reviewed <=64 KiB model is exported; no generic directory/archive export.
    print("\n::reprocheck-evidence::" + json.dumps(evidence, allow_nan=False))
