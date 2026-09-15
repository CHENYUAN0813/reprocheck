// Shared browser/server validation: importing a configuration never executes it.
export const MODEL_EXPORT_LIMIT = 512 * 1024;

export function relativeArtifactPath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 240
    && !/[\\:\r\n\0]/.test(value) && !value.startsWith("/")
    && value.split("/").every((part) => part && ![".", "..", ".git"].includes(part));
}

export function validateExperiment(input) {
  const keys = ["repository", "commit", "title", "installCommand", "prepareCommand", "trainCommand", "checkpoint", "parameters", "seed", "protocol", "capture", "confirmed"];
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !keys.includes(key))) throw new Error("Invalid experiment configuration");
  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repository ?? "") || !/^[a-f\d]{40}$/i.test(input.commit ?? "")) throw new Error("Experiment requires a pinned repository and commit");
  for (const key of ["title", "parameters", "seed", "protocol"]) {
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > 500 || /\0/.test(input[key])) throw new Error(`Experiment ${key} must be declared (use 'not specified' where appropriate)`);
  }
  for (const key of ["installCommand", "prepareCommand", "trainCommand"]) {
    if (typeof input[key] !== "string" || input[key].length > 6000 || /[\r\n\0]/.test(input[key]) || (key === "trainCommand" && !input[key].trim())) throw new Error(`Experiment ${key} must be a reviewed single-line command`);
  }
  if (!relativeArtifactPath(input.checkpoint)) throw new Error("Checkpoint must be a relative repository file without traversal");
  const capture = input.capture;
  if (!capture || typeof capture !== "object" || Array.isArray(capture) || Object.keys(capture).some((key) => !["kind", "label", "unit"].includes(key))
    || !["file", "stdout", "stdout-json"].includes(capture.kind)
    || !["number", "percent"].includes(capture.unit) || typeof capture.label !== "string" || capture.label.length > 80 || /[\r\n\0]/.test(capture.label)
    || (capture.kind === "stdout" && !capture.label.trim())) throw new Error("Experiment needs a file/JSON-stdout/labelled-stdout metric capture choice");
  if (input.confirmed !== true) throw new Error("Review and confirm the complete experiment configuration before execution");
  return { ...input, capture: { ...capture }, title: input.title.trim(), checkpoint: input.checkpoint.trim() };
}

export function experimentDraft(report) {
  const training = report.evaluationDraft?.trainingEntries?.[0] ?? report.entrypoints?.find((entry) => entry.category === "training");
  const evaluation = report.evaluationDraft?.entries?.[0];
  const output = report.evaluationDraft?.outputs?.find((item) => item.entryIds.includes(evaluation?.id));
  const reference = report.evaluationDraft?.references?.find((item) => !item.entryId || item.entryId === evaluation?.id);
  const paths = report.evaluationDraft?.paths ?? [];
  const checkpoint = paths.find((item) => item.kind === "checkpoint" && item.entryIds.includes(evaluation?.id));
  return { repository: report.repository, commit: report.commit, title: `${report.repository} · custom experiment`,
    installCommand: report.reproductionPlan?.steps?.find((step) => step.id === "install")?.command ?? "",
    prepareCommand: report.entrypoints?.find((entry) => entry.category === "preprocess")?.command ?? "",
    trainCommand: training?.command ?? "", checkpoint: checkpoint?.path ?? "", parameters: "", seed: "", protocol: "",
    capture: { kind: ["stdout", "stdout-json"].includes(output?.kind) ? output.kind : "file", label: output?.label ?? "", unit: output?.unit === "percent" ? "percent" : "number" }, confirmed: false,
    evaluationCommand: evaluation?.command ?? "", outputFile: ["stdout", "stdout-json"].includes(output?.kind) ? "reprocheck-evaluation.json" : output?.path ?? "",
    metricKey: output?.metricKey ?? reference?.metricKey ?? "", metricTarget: reference ? String(reference.value) : "",
    dataset: report.evaluationDraft?.contexts?.filter((item) => ["dataset", "split"].includes(item.kind) && item.entryIds.includes(evaluation?.id)).map((item) => item.value).join("; ").slice(0, 500) ?? "",
    model: checkpoint ? `New model saved at ${checkpoint.path}; review trainer configuration` : "",
    metricOperator: "eq", metricTolerance: "0", expectedText: "",
    reference: reference ? `https://github.com/${report.repository}/blob/${report.commit}/${reference.evidence.file}#L${reference.evidence.line}` : "" };
}

export function experimentExecutionOptions(draft) {
  const { evaluationCommand, outputFile, metricKey, metricTarget, metricOperator, metricTolerance, expectedText, dataset, model, reference, ...experiment } = draft;
  if (typeof evaluationCommand !== "string" || !evaluationCommand.trim() || evaluationCommand.length > 6000 || /[\r\n\0]/.test(evaluationCommand)) throw new Error("Review a single-line evaluation command");
  if (!relativeArtifactPath(outputFile) || outputFile === experiment.checkpoint) throw new Error("Evaluation needs a separate relative score output path");
  if (typeof metricKey !== "string" || !/^[\w-]+(?:\.[\w-]+)*$/.test(metricKey) || metricKey.length > 100) throw new Error("Declare a metric key / CSV column");
  if (!["eq", "gte", "lte"].includes(metricOperator) || metricTarget == null || String(metricTarget).trim() === "" || !Number.isFinite(Number(metricTarget))
    || metricTolerance == null || String(metricTolerance).trim() === "" || !Number.isFinite(Number(metricTolerance)) || Number(metricTolerance) < 0) throw new Error("Declare a finite reference value and non-negative tolerance");
  for (const [key, value] of Object.entries({ dataset, model, reference })) if (typeof value !== "string" || !value.trim() || value.length > 500 || /\0/.test(value)) throw new Error(`Declare experiment ${key}`);
  return { experiment: validateExperiment(experiment), quickCommand: evaluationCommand, outputFile, metricKey,
    metricTarget: metricTarget === "" ? null : Number(metricTarget), metricOperator, metricTolerance: metricOperator === "eq" ? Number(metricTolerance) : 0,
    expectedText: expectedText ?? "", evaluation: { dataset, model, reference, assetsInEntry: false } };
}
