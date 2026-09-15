"""ReproCheck CPU evaluation fixture, NOT Micrograd's moon/paper benchmark."""
import hashlib
import json
import pathlib
import random

import micrograd.nn
from micrograd.nn import MLP

assert pathlib.Path(micrograd.nn.__file__).resolve().is_relative_to(pathlib.Path("/workspace")), "Use the pinned repository source"


def dataset(seed, count):
    rng = random.Random(seed)
    rows = []
    for index in range(count):
        label = 1 if index % 2 else -1
        rows.append({"x": [label * (0.6 + rng.random()), rng.uniform(-1, 1)], "y": label})
    rng.shuffle(rows)
    return rows


def save_json(name, value):
    pathlib.Path(name).write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
    return hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()


train, test = dataset(101, 32), dataset(202, 48)
assert not {tuple(row["x"]) for row in train} & {tuple(row["x"]) for row in test}
dataset_hash = save_json("evaluation-data.json", {"train": train, "test": test, "generator": "separated-sign-x-v1", "seeds": [101, 202]})
random.seed(7)
model = MLP(2, [4, 1])
initial_accuracy = sum((model(row["x"]).data > 0) == (row["y"] > 0) for row in test) / len(test)
for epoch in range(40):
    loss = sum((1 - row["y"] * model(row["x"])).relu() for row in train) / len(train)
    model.zero_grad()
    loss.backward()
    for parameter in model.parameters():
        parameter.data -= 0.1 * parameter.grad

checkpoint_hash = save_json("evaluation-checkpoint.json", {"architecture": [2, 4, 1], "weights": [p.data for p in model.parameters()], "seed": 7, "epochs": 40, "learning_rate": 0.1})
checkpoint = json.loads(pathlib.Path("evaluation-checkpoint.json").read_text(encoding="utf-8"))
restored = MLP(2, [4, 1])
assert len(restored.parameters()) == len(checkpoint["weights"])
for parameter, value in zip(restored.parameters(), checkpoint["weights"]):
    parameter.data = value
scores = [restored(row["x"]).data for row in test]
accuracy = sum((score > 0) == (row["y"] > 0) for score, row in zip(scores, test)) / len(test)
loss = sum(max(0, 1 - row["y"] * score) for score, row in zip(scores, test)) / len(test)
save_json("evaluation-result.json", {"accuracy": accuracy, "hinge_loss": round(loss, 8), "initial_accuracy": initial_accuracy,
    "train_samples": len(train), "test_samples": len(test), "dataset_sha256": dataset_hash, "checkpoint_sha256": checkpoint_hash,
    "benchmark": "ReproCheck synthetic held-out fixture; reference 1.0 +/- 0.05 is user-defined, not a published benchmark"})
print(f"evaluation-ok accuracy={accuracy:.4f} hinge_loss={loss:.8f} initial_accuracy={initial_accuracy:.4f}")
