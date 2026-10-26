import assert from "node:assert/strict";
import { groupChecks, comparisonValue } from "./src/workbench-model.mjs";
const checks = [
  { id: "readme", status: "PASS" }, { id: "python_version", status: "WARN" },
  { id: "data_instructions", status: "FAIL" }, { id: "future_check", status: "UNKNOWN" },
];
assert.deepEqual(groupChecks(checks).flatMap((group) => group.checks), checks);
assert.deepEqual(groupChecks(checks, true).flatMap((group) => group.checks), checks.slice(1));
assert.deepEqual(groupChecks([{ id: "readme", status: "PASS" }], true), []);
assert.equal(groupChecks(checks).at(-1).title, "Other checks");
assert.equal(comparisonValue(0), "0");
assert.equal(comparisonValue(false), "false");
assert.equal(comparisonValue(null), "Not captured");
assert.equal(comparisonValue(""), "");
assert.equal(comparisonValue({ seed: 42 }), '{\n  "seed": 42\n}');
console.log("PASS workbench grouping preserves unknown checks and comparison values preserve zero/false");
