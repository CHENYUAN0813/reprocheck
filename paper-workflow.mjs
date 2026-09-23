const source = (file, line, text) => ({ file, line, text: text.trim().slice(0, 500) });

function validateHint(hint, makefile, makefileText, filePaths) {
  const make = hint.command.match(/^make\s+([\w.-]+)$/);
  if (make) {
    const target = make[1];
    const exists = !!makefile && new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "m").test(makefileText);
    return { ...hint, kind: "make", target, supported: exists,
      validation: exists ? source(makefile, makefileText.slice(0, makefileText.search(new RegExp(`^${target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "m"))).split(/\r?\n/).length, `${target}:`)
        : { file: makefile || "Makefile", text: exists ? `${target}:` : "Target not found" } };
  }
  const python = hint.command.match(/^(?:\.\/?venv\/bin\/)?python3?\s+([\w./-]+\.py)(?:\s+--[\w-]+(?:=[\w./:+-]+)?)*$/);
  if (python) return { ...hint, kind: "python", script: python[1], supported: filePaths.includes(python[1]),
    validation: { file: python[1], text: filePaths.includes(python[1]) ? "Script found" : "Script not found" } };
  return { ...hint, kind: "unsupported", supported: false, validation: { text: "Only simple Make targets and Python scripts are supported" } };
}

export function buildPaperWorkflowDraft({ provenance, makefile, makefileText = "", filePaths = [] }) {
  const hints = (provenance?.workflowHints ?? []).map((hint) => validateHint(hint, makefile, makefileText, filePaths));
  const test = hints.find((hint) => hint.command === "make test");
  const verify = hints.find((hint) => hint.command === "make verify");
  const runs = hints.filter((hint) => hint !== test && hint !== verify);
  const adapters = runs.map((run, index) => {
    const steps = [test, run, verify].filter(Boolean).map((hint) => {
      const role = hint === test ? "preflight" : hint === verify ? "verify" : "experiment";
      return { id: `${role}-${hint.id}`, role, command: hint.command, evidence: hint.evidence, validation: hint.validation, supported: hint.supported };
    });
    const gaps = [...(!test ? ["preflight command"] : []), ...(!verify ? ["verification command"] : []),
      ...steps.filter((step) => !step.supported).map((step) => `validated ${step.role} command`)];
    return { id: `paper-adapter-${index + 1}`, title: `Paper workflow · ${run.command}`, status: gaps.length ? "BLOCKED" : "NEEDS_REVIEW",
      reviewRequired: true, steps, gaps };
  });
  return { status: adapters.some((adapter) => adapter.status === "NEEDS_REVIEW") ? "NEEDS_REVIEW" : adapters.length ? "BLOCKED" : "NOT_FOUND",
    makefile: makefile || null, adapters, warnings: ["README commands and Make targets are untrusted code and require explicit review before container execution.",
      "A valid target proves only that the command exists, not that its data, model or paper protocol is correct."] };
}
