import { verifyProtocolLock } from "./protocol-lock.mjs";

const unique = (values) => [...new Set(values)];

function claimCell(reference) {
  const parts = reference.label.split(" · ").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return null;
  const seedPart = parts.find((part) => /^seed\s*[=:]/i.test(part));
  const seed = seedPart?.split(/[=:]/, 2)[1]?.trim() || null;
  const metricPart = parts.at(-1);
  const dimensions = parts.slice(0, -1).filter((part) => part !== seedPart);
  if (dimensions.length < 2) return null;
  const [dataset, model] = dimensions;
  return { id: `matrix-${reference.id}`, referenceId: reference.id, dataset, model, seed,
    column: seed ? `${model}[seed=${seed}]` : model, metricKey: reference.metricKey, metricLabel: metricPart,
    target: reference.value, precision: reference.precision ?? null, unit: reference.unit, evidence: reference.evidence };
}

export function buildPaperMatrixDraft(report) {
  const cells = (report.evaluationDraft?.references ?? []).map(claimCell).filter(Boolean);
  const adapters = (report.paperWorkflowDraft?.adapters ?? []).filter((adapter) => adapter.status === "NEEDS_REVIEW");
  const gaps = [];
  if (!cells.length) gaps.push("contextual paper result table with dataset and model labels");
  if (!adapters.length) gaps.push("source-validated paper workflow adapter");
  if (!report.protocolLock) gaps.push("protocol lock");
  return { status: gaps.length ? cells.length ? "BLOCKED" : "NOT_FOUND" : "NEEDS_REVIEW", cells, adapters,
    axes: { datasets: unique(cells.map((cell) => cell.dataset)), models: unique(cells.map((cell) => cell.model)),
      seeds: unique(cells.map((cell) => cell.seed).filter(Boolean)), metrics: unique(cells.map((cell) => cell.metricKey)) },
    gaps, warnings: ["Matrix labels are parsed from README tables; review dataset/model columns and output CSV headers before execution.",
      "Retry reruns the complete source workflow in a fresh container; cross-container checkpoint resume is not inferred."] };
}

export function validatePaperMatrixRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["adapterId", "protocolLockId", "outputFile", "rowKey", "metricTolerance", "confirmed", "acknowledgedGaps"].includes(key))) {
    throw new Error("Paper matrix needs a reviewed configuration");
  }
  if (typeof input.adapterId !== "string" || !/^paper-adapter-\d+$/.test(input.adapterId)
    || typeof input.protocolLockId !== "string" || !/^[a-f\d]{64}$/.test(input.protocolLockId)) throw new Error("Paper matrix source identities are invalid");
  if (typeof input.outputFile !== "string" || !input.outputFile.toLowerCase().endsWith(".csv") || input.outputFile.length > 240
    || /[\\:\r\n\0]/.test(input.outputFile) || input.outputFile.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Paper matrix output must be a relative CSV path without traversal");
  }
  if (typeof input.rowKey !== "string" || !/^[\w -]{1,100}$/.test(input.rowKey)) throw new Error("Paper matrix row key must be a simple CSV column name");
  if (typeof input.metricTolerance !== "number" || !Number.isFinite(input.metricTolerance) || input.metricTolerance < 0) throw new Error("Paper matrix tolerance must be finite and non-negative");
  if (input.confirmed !== true) throw new Error("Paper matrix requires explicit source and output review confirmation");
  const acknowledged = input.acknowledgedGaps;
  if (!Array.isArray(acknowledged) || acknowledged.length > 20 || acknowledged.some((gap) => typeof gap !== "string" || !gap || gap.length > 240 || /[\r\n\0]/.test(gap))) {
    throw new Error("Paper matrix protocol-gap acknowledgement is invalid");
  }
  return { adapterId: input.adapterId, protocolLockId: input.protocolLockId, outputFile: input.outputFile, rowKey: input.rowKey.trim(),
    metricTolerance: input.metricTolerance, confirmed: true, acknowledgedGaps: [...acknowledged].sort() };
}

export function buildPaperMatrixExecution(report, raw) {
  const input = validatePaperMatrixRequest(raw);
  const draft = buildPaperMatrixDraft(report);
  const adapter = draft.adapters.find((item) => item.id === input.adapterId);
  if (!adapter || draft.status !== "NEEDS_REVIEW") throw new Error("Paper matrix has no runnable source-validated adapter");
  const lock = verifyProtocolLock(report, input.protocolLockId);
  if (JSON.stringify(input.acknowledgedGaps) !== JSON.stringify([...lock.gaps].sort())) throw new Error("Every unresolved protocol-lock gap must be acknowledged exactly");
  if (draft.axes.metrics.length !== 1) throw new Error("This matrix runner supports one metric table at a time");
  const identities = draft.cells.map((cell) => `${cell.dataset}\0${cell.column}`);
  if (new Set(identities).size !== identities.length) throw new Error("Matrix cells need unique dataset and output-column pairs");
  return { schemaVersion: 1, adapterId: adapter.id, protocolLockId: lock.lockId, outputFile: input.outputFile,
    rowKey: input.rowKey, metricTolerance: input.metricTolerance, cells: draft.cells,
    acknowledgedGaps: input.acknowledgedGaps, lockStatus: lock.status, adapter };
}
