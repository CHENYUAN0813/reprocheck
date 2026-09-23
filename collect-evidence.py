"""Bounded, container-local observations; not a security attestation."""
import hashlib
import base64
import csv
import importlib.metadata
import json
import math
import platform
import re
import sys
import time
from pathlib import Path

options = json.loads(sys.argv[1])
root = Path("/workspace").resolve()
baseline = Path("/tmp/reprocheck-baseline.json")
environment_file = Path("/tmp/reprocheck-environment.json")
assets_file = Path("/tmp/reprocheck-assets.json")
checkpoint_baseline = Path("/tmp/reprocheck-checkpoint-before.json")
experiment = options.get("experiment")
checkpoint_after = Path("/tmp/reprocheck-checkpoint-after.json")
training_started = Path("/tmp/reprocheck-training-started.json")
model_export_limit = 512 * 1024


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
            digest = hashlib.sha256()
            for block in iter(lambda: stream.read(1 << 20), b""):
                digest.update(block)
            result["sha256"] = digest.hexdigest()
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
        cells = [cell.strip() for cell in text.strip().strip("|").split("|")]
        reference.update(text=text, value=float(cells[source.get("valueIndex", -1)]))
        if text == source["text"] and reference["value"] == source["value"]:
            reference["status"] = "PASSED"
    except Exception as error:
        reference["error"] = str(error)
    return {"assets": assets, "referenceEvidence": reference}


artifact = observe_file()
if sys.argv[2] == "checkpoint":
    # Gate evaluation on a newly produced, bounded model. Never delete a preset model.
    initial = json.loads(checkpoint_baseline.read_text())
    observed = observe_file(experiment["checkpoint"])
    if initial["exists"] or observed.get("error") or not 0 < observed.get("size", 0) <= model_export_limit:
        raise RuntimeError("Training must produce a new model file up to 512 KiB before evaluation")
    observed["trainingSeconds"] = time.monotonic() - json.loads(training_started.read_text())
    checkpoint_after.write_text(json.dumps(observed))
    # A score created by training is not proof that evaluation produced a result.
    baseline.write_text(json.dumps(artifact), encoding="utf-8")
elif sys.argv[2] == "inputs":
    identities = observe_benchmark()
    if identities and (any(asset["status"] != "PASSED" for asset in identities["assets"]) or identities["referenceEvidence"]["status"] != "PASSED"):
        raise RuntimeError("Reviewed inputs changed after training; evaluation entry was not run")
elif sys.argv[2] == "environment":
    snapshot = observe_environment()
    environment_file.write_text(json.dumps(snapshot), encoding="utf-8")
    # Preparation output is not evidence that the final entry produced anything.
    baseline.write_text(json.dumps(artifact), encoding="utf-8")
    training = (options.get("benchmark") or {}).get("training")
    if experiment:
        initial = observe_file(experiment["checkpoint"])
        checkpoint_baseline.write_text(json.dumps(initial))
        training_started.write_text(json.dumps(time.monotonic()))
        if initial["exists"] or initial.get("error"):
            raise RuntimeError("Custom training must start without an existing output checkpoint")
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
    matrix = None
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
            if not math.isfinite(value):
                raise ValueError("Metric is not finite")
            metric["value"] = value
        except Exception as error:
            metric["error"] = str(error)
    matrix_spec = options.get("paperMatrixExecution")
    if matrix_spec:
        matrix = {"cells": [], "summary": {"total": len(matrix_spec["cells"]), "matched": 0, "outside": 0, "missing": 0}}
        try:
            if not artifact or not artifact.get("sha256") or artifact["size"] > 1024 * 1024:
                raise ValueError("Paper matrix needs a readable CSV output file up to 1 MB")
            with (root / matrix_spec["outputFile"]).resolve().open(encoding="utf-8", newline="") as stream:
                reader = csv.DictReader(stream)
                if not reader.fieldnames or any(not name.strip() for name in reader.fieldnames) or len(set(reader.fieldnames)) != len(reader.fieldnames):
                    raise ValueError("Paper matrix CSV requires a unique header")
                if matrix_spec["rowKey"] not in reader.fieldnames:
                    raise ValueError("Paper matrix row-key column is missing")
                rows = list(reader)
            if len(rows) > 10000 or any(None in row or any(value is None for value in row.values()) for row in rows):
                raise ValueError("Paper matrix CSV is incomplete or too large")
            # ponytail: match presentation labels by normalized text, with a unique "rec" abbreviation fallback; expose the matched header in evidence.
            normalize = lambda value: re.sub(r"[^a-z0-9]+", "", value.lower().replace("+", "plus"))
            aliases = lambda value: {normalize(value), normalize(value).replace("rec", "")}
            keyed = {}
            for row in rows:
                key = normalize(row[matrix_spec["rowKey"]].strip())
                if not key or key in keyed:
                    raise ValueError("Paper matrix row keys must be non-empty and unique")
                keyed[key] = row
            numeric = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")
            for expected in matrix_spec["cells"]:
                observed = None
                error = None
                csv_column = None
                try:
                    row = keyed[normalize(expected["dataset"])]
                    candidates = [name for name in reader.fieldnames if name != matrix_spec["rowKey"] and aliases(name) & aliases(expected["column"])]
                    if len(candidates) != 1:
                        raise ValueError("output column has no unique label match")
                    csv_column = candidates[0]
                    raw = row[csv_column].strip()
                    if not numeric.fullmatch(raw):
                        raise ValueError("cell is not a finite number")
                    observed = float(raw)
                    if not math.isfinite(observed):
                        raise ValueError("cell is not finite")
                except Exception as failure:
                    error = str(failure)
                compared = round(observed, expected["precision"]) if observed is not None and expected.get("precision") is not None else observed
                delta = abs(compared - expected["target"]) if compared is not None else None
                tolerance = matrix_spec["metricTolerance"]
                status = "MISSING" if error else "MATCHED" if delta <= tolerance or tolerance > 0 and delta - tolerance <= sys.float_info.epsilon * max(abs(observed), abs(expected["target"]), tolerance) else "OUTSIDE_REFERENCE"
                matrix["summary"]["matched" if status == "MATCHED" else "outside" if status == "OUTSIDE_REFERENCE" else "missing"] += 1
                matrix["cells"].append({**expected, "csvColumn": csv_column, "observed": observed, "compared": compared, "delta": delta, "tolerance": tolerance, "status": status, **({"error": error} if error else {})})
        except Exception as error:
            matrix["error"] = str(error)
            matrix["summary"]["missing"] = matrix["summary"]["total"]
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
    if experiment:
        training_checkpoint = {**observe_file(experiment["checkpoint"]), "status": "FAILED"}
        try:
            initial = json.loads(checkpoint_baseline.read_text())
            trained = json.loads(checkpoint_after.read_text())
            if initial["exists"] or training_checkpoint.get("error") or not 0 < training_checkpoint.get("size", 0) <= model_export_limit:
                raise ValueError("Expected a new model file up to 512 KiB")
            model_bytes = (root / experiment["checkpoint"]).resolve().read_bytes()
            if hashlib.sha256(model_bytes).hexdigest() != trained["sha256"] or len(model_bytes) != trained["size"]:
                raise ValueError("New checkpoint changed during evaluation")
            training_checkpoint.update(fresh=True, status="PASSED", trainingSeconds=trained["trainingSeconds"],
                                       base64=base64.b64encode(model_bytes).decode())
        except Exception as error:
            training_checkpoint["error"] = str(error)
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
        "matrix": matrix,
        "evaluationOutput": evaluation_output,
        **({"trainingCheckpoint": training_checkpoint} if training_checkpoint else {}),
    }
    # ponytail: one <=512 KiB experiment model (reviewed Iris <=64 KiB); directories/large models need streamed artifact storage.
    print("\n::reprocheck-evidence::" + json.dumps(evidence, allow_nan=False))
