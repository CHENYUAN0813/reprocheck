const groups = [
  ["Instructions & entry", ["readme", "install_command", "run_command", "command_references"]],
  ["Environment", ["dependencies", "dependency_versions", "python_version"]],
  ["Data & experiment", ["data_instructions", "model_instructions", "random_seed", "experiment_config"]],
  ["Tests & project", ["tests", "continuous_integration", "license"]],
];

export function groupChecks(checks, problemsOnly = false) {
  const result = groups.map(([title]) => ({ title, checks: [] }));
  const other = { title: "Other checks", checks: [] };
  for (const check of checks) {
    if (problemsOnly && check.status === "PASS") continue;
    const index = groups.findIndex(([, ids]) => ids.includes(check.id));
    (index < 0 ? other : result[index]).checks.push(check);
  }
  return [...result, other].filter((group) => group.checks.length);
}

export function comparisonValue(value) {
  if (value === null || value === undefined) return "Not captured";
  return typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
}
