import { loadWorkspace, saveWorkspace, savedReport, savedPage, validRunId } from "./workspace-storage.mjs";
import { useLanguage, LanguageProvider, LanguageSwitcher } from "./language.jsx";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./cinematic.css";
import "./workbench.css";
import { groupChecks, comparisonValue } from "./workbench-model.mjs";
import { RunConsole } from "./RunConsole.jsx";
import { NodeProject } from "./NodeProject.jsx";
import { WebVerification, WebEvidence } from "./WebVerification.jsx";
import cpuEvaluationSource from "../examples/evaluate-micrograd.py?raw";
import { reviewedBenchmarks, reviewedTrainings, reviewedCaseById } from "../examples/reviewed-cases.mjs";
import publishedEvaluationSource from "../examples/evaluate-bthowen.py?raw";
import capacityEvaluationSource from "../examples/evaluate-capacity-probes.py?raw";
import capacityMatrixSource from "../examples/evaluate-capacity-matrix.py?raw";
import trainingSource from "../examples/train-bthowen.py?raw";
import { candidateOptions, candidateWorkflow, suggestCandidate } from "../evaluation-config.mjs";
import { experimentDraft, experimentExecutionOptions, importedExperimentDraft, MODEL_EXPORT_LIMIT } from "../experiment-config.mjs";

const emptyAcceptance = { expectedText: "", outputFile: "", metricKey: "", metricOperator: "gte", metricTarget: "", metricTolerance: "0", dataset: "", model: "", reference: "", assetsInEntry: false };
const cpuEvaluationCommand = `python -c 'exec(${JSON.stringify(cpuEvaluationSource).replaceAll("'", "'\"'\"'")})'`;
const benchmarkSources = { bthowen: publishedEvaluationSource, "capacity-probes": capacityEvaluationSource, "capacity-matrix": capacityMatrixSource };
const benchmarkEvaluationCommand = (benchmark) => `python -c 'exec(${JSON.stringify(benchmarkSources[benchmark.adapter]).replaceAll("'", "'\"'\"'")})' evaluate`;

const exampleParameters = [
  { name: "--epochs", default: "20", file: "train.py", line: 24 },
  { name: "--batch-size", default: "32", file: "train.py", line: 25 },
  { name: "--seed", default: "42", file: "train.py", line: 26 },
];

const exampleReport = {
  repository: "example-lab/vision-baseline",
  commit: "8f30db1c4d73e6d807923a3d2f4c2af06c7a1b91",
  filesScanned: 49,
  status: "NEEDS_WORK",
  summary: { failures: 0, warnings: 2 },
  checks: [
    {
      id: "readme",
      status: "PASS",
      message: "README found: README.md",
      evidence: { file: "README.md" },
      suggestion: null,
    },
    {
      id: "install_command",
      status: "PASS",
      message: "Install command found in README",
      evidence: {
        file: "README.md",
        line: 42,
        text: "pip install -r requirements.txt",
      },
      suggestion: null,
    },
    {
      id: "run_command",
      status: "PASS",
      message: "Run command found in README",
      evidence: {
        file: "README.md",
        line: 58,
        text: "python train.py --config configs/base.yaml",
      },
      suggestion: null,
    },
    {
      id: "data_instructions",
      status: "PASS",
      message: "Dataset instructions found in README",
      evidence: { file: "README.md", line: 73, text: "## Dataset preparation" },
      suggestion: null,
    },
    {
      id: "model_instructions",
      status: "PASS",
      message: "Model or checkpoint instructions found in README",
      evidence: { file: "README.md", line: 91, text: "Download pretrained weights" },
      suggestion: null,
    },
    {
      id: "dependencies",
      status: "PASS",
      message: "Dependencies found: requirements.txt",
      evidence: { file: "requirements.txt" },
      suggestion: null,
    },
    {
      id: "dependency_versions",
      status: "PASS",
      message: "All 12 dependencies are exactly pinned",
      evidence: { file: "requirements.txt" },
      suggestion: null,
    },
    {
      id: "license",
      status: "PASS",
      message: "License found: LICENSE",
      evidence: { file: "LICENSE" },
      suggestion: null,
    },
    {
      id: "tests",
      status: "WARN",
      message: "Test entry not found",
      evidence: null,
      suggestion: "Add a tests directory or Python test file",
    },
    {
      id: "python_version",
      status: "WARN",
      message: "Python version not clearly pinned",
      evidence: null,
      suggestion: "Pin Python with .python-version or runtime.txt",
    },
    {
      id: "random_seed",
      status: "PASS",
      message: "Random seed setup found in code",
      evidence: { file: "train.py", line: 18, text: "setup_seed(42)" },
      suggestion: null,
    },
    {
      id: "experiment_config",
      status: "PASS",
      message: "Reusable experiment configuration found",
      evidence: { file: "configs/base.yaml" },
      suggestion: null,
    },
    {
      id: "continuous_integration",
      status: "PASS",
      message: "Continuous integration found: .github/workflows/ci.yml",
      evidence: { file: ".github/workflows/ci.yml" },
      suggestion: null,
    },
    {
      id: "command_references",
      status: "PASS",
      message: "All 3 command reference(s) exist",
      evidence: { file: "requirements.txt" },
      suggestion: null,
    },
  ],
  experimentParameters: exampleParameters,
  reproductionPlan: {
    status: "INCOMPLETE",
    steps: [
      {
        id: "environment",
        title: "Prepare Python environment",
        status: "MISSING",
        instruction: null,
        evidence: null,
      },
      {
        id: "install",
        title: "Install dependencies",
        status: "DOCUMENTED",
        command: "pip install -r requirements.txt",
        evidence: { file: "README.md", line: 42 },
        references: [{ step: "install", path: "requirements.txt", exists: true }],
      },
      {
        id: "model",
        title: "Get model or checkpoint",
        status: "DOCUMENTED",
        instruction: "Download pretrained weights",
        evidence: { file: "README.md", line: 91 },
      },
      {
        id: "data",
        title: "Get and prepare dataset",
        status: "DOCUMENTED",
        instruction: "Download and prepare the dataset",
        evidence: { file: "README.md", line: 73 },
      },
      {
        id: "run",
        title: "Run the experiment",
        status: "DOCUMENTED",
        command: "python train.py --config configs/base.yaml",
        evidence: { file: "README.md", line: 58 },
        references: [
          { step: "run", path: "train.py", exists: true },
          { step: "run", path: "configs/base.yaml", exists: true },
        ],
        parameters: exampleParameters,
      },
    ],
  },
};

function EvidenceLink({ report, evidence }) {
  return (
    <a
      href={`https://github.com/${report.repository}/blob/${report.commit}/${evidence.file.split("/").map(encodeURIComponent).join("/")}${evidence.line ? `#L${evidence.line}` : ""}`}
      target="_blank"
      rel="noreferrer"
    >
      <code>
        {evidence.file}
        {evidence.line ? `:${evidence.line}` : ""}
      </code>
    </a>
  );
}

function downloadJson(data, filename) {
  const blobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

const visibleRunLog = (log) => log?.replace(/^::reprocheck-evidence::.*$/gm, "[Structured evidence captured; download execution evidence for complete data.]");

function PaperProvenance({ report }) {
  const { t } = useLanguage();
  const provenance = report.paperProvenance;
  const workflow = report.paperWorkflowDraft;
  if (!provenance) return null;
  const draft = report.evaluationDraft;
  const entry = provenance.candidate && draft.entries.find((item) => item.id === provenance.candidate.entryId);
  const reference = provenance.candidate && draft.references.find((item) => item.id === provenance.candidate.referenceId);
  const output = provenance.candidate && draft.outputs.find((item) => item.id === provenance.candidate.outputId);
  return <section className="runner" aria-labelledby="paper-provenance-title">
    <div className="runner-heading"><div><p className="eyebrow">{t("Paper provenance")}</p><h2 id="paper-provenance-title">{t("Paper source and experiment claim")}</h2>
      <p>{t("Source discovery only. A repository link does not prove that its code reproduces the paper.")}</p></div>
      <span className={`status status-${provenance.status.toLowerCase()}`}>{t(provenance.status.replaceAll("_", " "))}</span></div>
    {provenance.sources.length ? <div className="runner-result"><h3>{t("Paper declarations and scholarly links")}</h3><ul>
      {provenance.sources.map((item) => <li key={item.id}>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a> : item.label} · {item.provider} · <EvidenceLink report={report} evidence={item.evidence} /></li>)}
    </ul></div> : <p className="runner-note">{t("No supported scholarly source was found in the README.")}</p>}
    {provenance.workflowHints?.length > 0 && <div className="runner-result"><h3>{t("Documented paper workflow hints")}</h3><ul>
      {provenance.workflowHints.map((item) => <li key={item.id}><code>{item.command}</code> · <EvidenceLink report={report} evidence={item.evidence} /></li>)}
    </ul><p className="runner-note">{t("These commands are evidence only until ReproCheck can safely associate their inputs and metric outputs.")}</p></div>}
    {workflow?.adapters.length > 0 && <div className="runner-result"><h3>{t("Generated workflow adapters")}</h3>
      {workflow.adapters.map((adapter) => <details key={adapter.id}><summary>{t(adapter.title)} · {t(adapter.status.replaceAll("_", " "))}</summary>
        <ol>{adapter.steps.map((step) => <li key={step.id}><strong>{t(step.role)}</strong> · <code>{step.command}</code> · {t(step.supported ? "source target validated" : "blocked")}</li>)}</ol>
        {adapter.gaps.length > 0 && <p className="runner-note">{t("Missing: ")}{t(adapter.gaps.join("; "))}.</p>}
        <button className="download-button" type="button" onClick={() => downloadJson({ schemaVersion: 1, repository: report.repository, commit: report.commit,
          paperSourceId: provenance.candidate?.sourceId ?? (provenance.sources.length === 1 ? provenance.sources[0]?.id : null), adapter }, `reprocheck-paper-adapter-${adapter.id}.json`)}>{t("Download adapter draft")}</button>
      </details>)}
      {workflow.warnings.map((warning) => <p className="runner-note" key={warning}>{t(warning)}</p>)}
    </div>}
    {provenance.candidate && <div className="runner-result"><h3>{t("Unconfirmed reproduction candidate")}</h3>
      <p><code>{entry.command}</code></p>
      <p className="hint">{t("Metric: ")}{output.metricKey}{t(" · README target: ")}{reference.value} {t(reference.unit)}.</p>
      <p className="runner-note">{t("This pairing is source-backed and unique, but still requires protocol review and explicit confirmation below.")}</p>
    </div>}
    {provenance.gaps.length > 0 && <div className="runner-result"><h3>{t("Still needed")}</h3><ul>{provenance.gaps.map((gap) => <li key={gap}>{t(gap)}</li>)}</ul></div>}
  </section>;
}

function ProtocolLock({ report }) {
  const { t } = useLanguage();
  const lock = report.protocolLock;
  if (!lock) return null;
  return <section className="runner" aria-labelledby="protocol-lock-title">
    <div className="runner-heading"><div><p className="eyebrow">{t("Experiment identity")}</p><h2 id="protocol-lock-title">{t("Protocol lock")}</h2>
      <p>{t("Commit-pinned source, environment declarations, paper claims and asset identities.")}</p></div>
      <span className={`status status-${lock.status.toLowerCase()}`}>{t(lock.status.replaceAll("_", " "))}</span></div>
    <div className="runner-result"><dl className="evaluation-summary">
      <dt>{t("Lock ID")}</dt><dd><code>{lock.lockId}</code></dd>
      <dt>{t("Source files pinned")}</dt><dd>{t(lock.sourceFiles.length)}</dd>
      <dt>{t("Declared paths")}</dt><dd>{t(lock.declaredAssets.length)}</dd>
      <dt>{t("Python")}</dt><dd>{t(lock.environment.python?.value ?? "not exactly pinned")}</dd>
      <dt>{t("Dependencies")}</dt><dd>{t(lock.environment.dependencies?.lockFile ? "lock file" : lock.environment.dependencyLocked ? "exact direct pins" : "not locked")}</dd>
    </dl></div>
    {lock.gaps.length > 0 && <div className="runner-result"><h3>{t("Unresolved lock requirements")}</h3><ul>{lock.gaps.map((gap) => <li key={gap}>{t(gap)}</li>)}</ul></div>}
    <details><summary>{t("Source and asset identities")}</summary><pre className="evaluation-source">{JSON.stringify({ sourceFiles: lock.sourceFiles, declaredAssets: lock.declaredAssets,
      seedEvidence: lock.seedEvidence, parameters: lock.parameters }, null, 2)}</pre></details>
    {lock.warnings.map((warning) => <p className="runner-note" key={warning}>{t(warning)}</p>)}
    <button className="download-button" type="button" onClick={() => downloadJson(lock, `reprocheck-protocol-lock-${report.commit.slice(0, 7)}.json`)}>{t("Download protocol lock")}</button>
  </section>;
}

function PaperMatrix({ report, disabled, onApply }) {
  const { t } = useLanguage();
  const draft = report.paperMatrixDraft;
  const ready = draft?.adapters?.[0];
  const [config, setConfig] = useState({ adapterId: ready?.id ?? "", outputFile: "", rowKey: "dataset", metricTolerance: "0", confirmed: false,
    acknowledgeGaps: report.protocolLock?.gaps.length === 0 });
  if (!draft) return null;
  const update = (field, value) => setConfig((current) => ({ ...current, [field]: value, ...(field === "confirmed" ? {} : { confirmed: false }) }));
  const apply = () => onApply({ adapterId: config.adapterId, protocolLockId: report.protocolLock.lockId, outputFile: config.outputFile.trim(), rowKey: config.rowKey.trim(),
    metricTolerance: Number(config.metricTolerance), confirmed: true, acknowledgedGaps: config.acknowledgeGaps ? report.protocolLock.gaps : [] });
  return <section className="runner" aria-labelledby="paper-matrix-title">
    <div className="runner-heading"><div><p className="eyebrow">{t("Multi-experiment reproduction")}</p><h2 id="paper-matrix-title">{t("Paper result matrix")}</h2>
      <p>{t("Run one reviewed source workflow, then compare every dataset × model × seed cell with the pinned README table.")}</p></div>
      <span className={`status status-${draft.status.toLowerCase()}`}>{t(draft.status.replaceAll("_", " "))}</span></div>
    {draft.cells.length > 0 && <div className="matrix-scroll"><table className="matrix-table"><thead><tr><th>{t("Dataset")}</th><th>{t("Model")}</th><th>{t("Seed")}</th><th>{t("Metric")}</th><th>{t("Paper reference")}</th></tr></thead>
      <tbody>{draft.cells.map((cell) => <tr key={cell.id}><td>{cell.dataset}</td><td>{cell.model}</td><td>{t(cell.seed ?? "—")}</td><td>{cell.metricLabel}</td><td>{cell.target} · {t(cell.unit)}</td></tr>)}</tbody></table></div>}
    {draft.gaps.length > 0 && <p className="runner-note">{t("Blocked by: ")}{t(draft.gaps.join("; "))}.</p>}
    {ready && report.protocolLock && <fieldset className="run-options" disabled={disabled}>
      <legend>{t("Reviewed matrix output contract")}</legend>
      <label>{t("Source workflow adapter")}<select value={config.adapterId} onChange={(event) => update("adapterId", event.target.value)}>{draft.adapters.map((adapter) => <option key={adapter.id} value={adapter.id}>{t(adapter.title)}</option>)}</select></label>
      <label>{t("Produced CSV path")}<input maxLength={240} value={config.outputFile} placeholder={t("results/table1.csv")} onChange={(event) => update("outputFile", event.target.value)} /></label>
      <label>{t("Dataset row-key column")}<input maxLength={100} value={config.rowKey} onChange={(event) => update("rowKey", event.target.value)} /></label>
      <label>{t("Absolute tolerance for every cell")}<input type="number" min="0" step="any" value={config.metricTolerance} onChange={(event) => update("metricTolerance", event.target.value)} /></label>
      {report.protocolLock.gaps.length > 0 && <label className="runner-confirm"><input type="checkbox" checked={config.acknowledgeGaps} onChange={(event) => update("acknowledgeGaps", event.target.checked)} />{t("I reviewed and accept these unresolved lock gaps for this run: ")}{report.protocolLock.gaps.join("; ")}.</label>}
      <label className="runner-confirm"><input type="checkbox" checked={config.confirmed} onChange={(event) => update("confirmed", event.target.checked)} />{t("I reviewed the adapter, CSV row/column labels, paper references and protocol lock. The workflow is untrusted code.")}</label>
      <button type="button" disabled={!config.confirmed || !config.outputFile.trim() || !config.acknowledgeGaps || !Number.isFinite(Number(config.metricTolerance)) || Number(config.metricTolerance) < 0} onClick={apply}>{t("Use matrix in local runner")}</button>
    </fieldset>}
    {draft.warnings.map((warning) => <p className="runner-note" key={warning}>{t(warning)}</p>)}
  </section>;
}

function CandidateConfig({ report, disabled, onApply }) {
  const { t } = useLanguage();
  const draft = report.evaluationDraft;
  const suggested = draft.suggestion ?? suggestCandidate(report);
  function selections(entryId) {
    const related = draft.references.filter((reference) => reference.entryId === entryId);
    const outputs = draft.outputs.filter((output) => output.entryIds.includes(entryId));
    return { entryId, referenceId: related.length === 1 ? related[0].id : draft.references.length === 1 && (!draft.references[0].entryId || draft.references[0].entryId === entryId) ? draft.references[0].id : null,
      outputId: outputs.length === 1 ? outputs[0].id : null, confirmed: false };
  }
  const [review, setReview] = useState(() => suggested ?? selections(draft.entries[0]?.id ?? ""));
  let options;
  let failure;
  if (review.entryId) {
    try { options = candidateOptions(report, review); } catch (error) { failure = error.message; }
  }
  const entry = draft.entries.find((entry) => entry.id === review.entryId);
  const reference = draft.references.find((reference) => reference.id === review.referenceId);
  const output = draft.outputs.find((output) => output.id === review.outputId);
  const missing = options ? [!options.outputFile && "Result capture/output file", !options.metricKey && "Numeric metric key",
    options.metricTarget === null && "Reference value", !options.evaluation.dataset && "Dataset / split", !options.evaluation.model && "Model / checkpoint",
    !options.evaluation.reference && "Reference source"].filter(Boolean) : [];
  return <section className="runner candidate-config" aria-labelledby="candidate-title">
    <div className="runner-heading"><div><p className="eyebrow">{t("Generated configuration · Needs review")}</p><h2 id="candidate-title">{t("Build an Evaluation from this scan")}</h2>
      <p>{t("Choose source-backed candidates, then review or complete the editable form. This does not execute code.")}</p></div></div>
    {suggested && <p className="runner-note">{t("One unambiguous candidate was preselected from a matching README command, source metric and printed output. It is still unconfirmed.")}</p>}
    {draft.entries.length === 0 ? <p className="runner-note">{t("No supported metric-evaluation candidate was found in the sampled Python files. A Quick/Make entry may still be available above. Supply a custom Evaluation below; no command or benchmark is invented.")}</p> : <fieldset className="run-options" disabled={disabled}>
      <legend>{t("Source-backed candidate choices")}</legend>
      <label>{t("Candidate entry")}<select value={review.entryId} onChange={(event) => setReview(selections(event.target.value))}>
        {draft.entries.map((entry) => <option value={entry.id} key={entry.id}>{entry.command}{t(entry.origin ? " · inferred, review arguments" : "")}</option>)}
      </select></label>
      {entry && <p className="evidence"><span>{t("Entry source")}</span><EvidenceLink report={report} evidence={entry.evidence} /></p>}
      {entry?.note && <p className="runner-note">{t(entry.note)}</p>}
      {entry?.arguments?.length > 0 && <details open><summary>{t("Execution arguments · review source and values")}</summary>
        {entry.arguments.map((argument) => <div key={argument.id}>
          <label>{argument.name}{t(argument.required ? " · required" : " · optional")}<input maxLength={240} disabled={!argument.supported}
            value={review.argumentValues?.[argument.id] ?? ""} placeholder={argument.default ?? t("Already in command, or enter a reviewed value")}
            onChange={(event) => setReview((current) => ({ ...current, argumentValues: { ...current.argumentValues, [argument.id]: event.target.value } }))} /></label>
          <p className="hint">{argument.help}{t(!argument.supported && " · Complex action: supply a custom reviewed command instead.")}</p>
          <p className="evidence"><span>{t("Argument source")}</span><EvidenceLink report={report} evidence={argument.evidence} /></p>
        </div>)}
        <p className="hint">{t("Blank preserves the original command/default. Values are shell-quoted, never executed while configuring.")}</p>
      </details>}
      {(draft.paths ?? []).some((path) => path.entryIds.includes(review.entryId)) && <details><summary>{t("Configuration / data / checkpoint paths")}</summary>
        {(draft.paths ?? []).filter((path) => path.entryIds.includes(review.entryId)).map((path, index) => <p key={index} className="hint">{path.path} · {t(path.matches.length ? `Tree matches: ${path.matches.join(", ")}` : "Not found in tree; may need external preparation")} · <EvidenceLink report={report} evidence={path.evidence} /></p>)}
      </details>}
      <label>{t("Result capture")}<select value={review.outputId ?? ""} onChange={(event) => setReview((current) => ({ ...current, outputId: event.target.value || null }))}>
        <option value="">{t("Not selected — complete manually")}</option>
        {draft.outputs.filter((output) => output.entryIds.includes(review.entryId)).map((output) => <option value={output.id} key={output.id}>{output.kind === "stdout" ? `Labelled stdout: ${output.label} · ${output.unit}` : output.kind === "stdout-json" ? `JSON stdout: ${output.metricKey}` : `${output.kind.toUpperCase()}: ${output.path}`}</option>)}
      </select></label>
      {output && <p className="evidence"><span>{t("Output source")}</span><EvidenceLink report={report} evidence={output.evidence} /></p>}
      <label>{t("README reference candidate")}<select value={review.referenceId ?? ""} onChange={(event) => setReview((current) => ({ ...current, referenceId: event.target.value || null }))}>
        <option value="">{t("Not selected — supply a declared target")}</option>
        {draft.references.filter((reference) => !reference.entryId || reference.entryId === review.entryId).map((reference) => <option value={reference.id} key={reference.id}>{reference.label}: {reference.value} · {t(reference.unit)}{t(" · line ")}{reference.evidence.line}</option>)}
      </select></label>
      {reference && <p className="evidence"><span>{t("Reference source")}</span><EvidenceLink report={report} evidence={reference.evidence} /></p>}
      {failure && <p className="runner-error" role="alert">{t(failure)}</p>}
      {options && <>
        <p className="hint">{t("Proposed output: ")}{t(options.outputFile || "missing")}{t(" · metric: ")}{options.metricKey || "missing"}{t(" · reference: ")}{t(options.metricTarget ?? "missing")}{t(" · tolerance: 0.")}</p>
        {missing.length > 0 && <p className="runner-note">{t("Complete in the form: ")}{t(missing.join("; "))}.</p>}
        {["stdout", "stdout-json"].includes(output?.kind) && <p className="hint">{t("A generic adapter runs the original command and records its actual printed score as JSON. It never substitutes the reference value; missing/duplicate scores fail.")}</p>}
        <button type="button" onClick={() => onApply(options)}>{t("Use candidates in Evaluation form")}</button>
      </>}
    </fieldset>}
    <details><summary>{t("Candidate sources and coverage limits")}</summary><pre className="evaluation-source">{JSON.stringify(draft, null, 2)}</pre></details>
    <p className="runner-note">{t("README values may be example output. You must confirm the selected dataset, split, model and metric correspond; they are not automatically verified paper claims.")}</p>
  </section>;
}

function SavedExperimentImport({ disabled, onOpenVersion }) {
  const { t } = useLanguage();
  const [pendingImport, setPendingImport] = useState(null);
  const [error, setError] = useState("");
  async function importConfig(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingImport(null);
    try {
      if (file.size > 32000) throw new Error("Experiment configuration is limited to 32 KB");
      const config = JSON.parse(await file.text());
      const next = importedExperimentDraft(config);
      setPendingImport(next); setError("");
    } catch (failure) { setError(failure.message); }
  }
  return <fieldset className="run-options" disabled={disabled}>
    <legend>{t("Open a saved Training experiment")}</legend>
    <label>{t("Import saved experiment configuration")}<input type="file" accept=".json,application/json" onChange={importConfig} /></label>
    {pendingImport && <div role="status"><p>{t("Saved configuration: ")}<strong>{t(pendingImport.repository)}</strong>{t(" · commit ")}<code>{pendingImport.commit}</code>{t(". Scan this exact version before reviewing commands. No code will run.")}</p>
      <button type="button" onClick={async () => { if (await onOpenVersion(pendingImport)) setPendingImport(null); }}>{t("Scan saved version")}</button>
      <button type="button" onClick={() => setPendingImport(null)}>{t("Cancel import")}</button></div>}
    {error && <p className="runner-error" role="alert">{t(error)}</p>}
  </fieldset>;
}

function SuggestedEntry({ report, disabled, onChoose }) {
  const { t } = useLanguage();
  const entries = report.quickEntries ?? [];
  const [id, setId] = useState(report.recommendedQuickEntryId ?? "");
  const selected = entries.find((entry) => entry.id === id);
  const readme = report.checks.find((check) => check.id === "readme")?.evidence;
  if (report.projectType === 'node') return <NodeProject report={report} />;
  if (report.projectType === 'unknown') return <section className="runner"><h2>{t('Project type not recognized')}</h2><p>{t('Review the repository documentation. No Python experiment requirements or executable workflow were inferred.')}</p></section>;
  return <section className="runner candidate-config" aria-labelledby="suggested-entry-title">
    <h2 id="suggested-entry-title">{t("Start here · check one entry")}</h2>
    <p>{t("Quick checks whether the selected entry executes. It is not full training or metric acceptance. Commands remain untrusted and will not run until you review and confirm. Prerequisites can download large dependencies or datasets; Quick does not mean a small download.")}</p>
    {entries.length ? <>
      <label>{t("Suggested entry")}<select value={id} disabled={disabled} onChange={(event) => setId(event.target.value)}>
        <option value="">{t("Choose an entry — no automatic choice")}</option>
        {entries.map((entry) => <option key={entry.id} value={entry.id}>{t(entry.id === report.recommendedQuickEntryId ? "Recommended · " : "")}{entry.command} · {t(entry.status)}</option>)}
      </select></label>
      {selected && <><p><EvidenceLink report={report} evidence={selected.evidence} /></p>
        <p className="hint">{t(selected.role === "preflight" ? "A source-validated test entry is available; start here before the experiment." : "Review this entry and its prerequisites; Quick does not imply a short or inexpensive run.")}</p>
        <ol>{selected.steps.map((step) => <li key={step.id}>{t(step.title)} · {t(step.status)}{step.command && <pre>{step.command}</pre>}</li>)}</ol>
      </>}
      <button type="button" disabled={disabled || !selected || selected.status === "BLOCKED"} onClick={() => onChoose(selected)}>{t("Review selected entry in Quick")}</button>
      {selected?.status === "BLOCKED" && <p className="runner-note">{t("Some prerequisite targets could not be validated. Review their source before execution.")}</p>}
    </> : <p className="runner-note">{t("No supported entry was automatically validated. Review ")}{readme ? <EvidenceLink report={report} evidence={readme} /> : <a href={`https://github.com/${report.repository}/tree/${report.commit}`} target="_blank" rel="noreferrer">{t("repository source")}</a>}{t(" and the repository's Python scripts")}{report.paperWorkflowDraft?.makefile && <> / <EvidenceLink report={report} evidence={{ file: report.paperWorkflowDraft.makefile }} /></>}{t(". This does not mean the repository has no instructions.")}</p>}
  </section>;
}

function ExperimentConfig({ report, disabled, onApply, onInvalidate, importedDraft }) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(() => importedDraft ?? experimentDraft(report));
  const [error, setError] = useState("");
  useEffect(() => { if (importedDraft) { setDraft(importedDraft); setError(""); } }, [importedDraft]);
  function update(key, value) {
    setDraft((current) => ({ ...current, [key]: value, confirmed: key === "confirmed" ? value : false }));
    setError(""); onInvalidate();
  }
  function apply(download = false) {
    try {
      const options = experimentExecutionOptions({ ...draft, ...(draft.inputs ? { inputs: Object.fromEntries(Object.entries(draft.inputs).map(([stage, paths]) => [stage, paths.map((path) => path.trim()).filter(Boolean)])) } : {}) });
      if (download) downloadJson({ schemaVersion: 1, repository: report.repository, commit: report.commit, workflowId: "training", executionOptions: options }, "reprocheck-experiment.json");
      else onApply(options);
      setError("");
    } catch (failure) { setError(failure.message); }
  }
  const fields = [
    ["title", "Experiment name"], ["installCommand", "Dependency installation · blank explicitly skips installation", 6000],
    ["prepareCommand", "Data preparation · blank means repository/built-in data or preparation inside trainer", 6000],
    ["trainCommand", "Original training command", 6000], ["checkpoint", "New model output path · relative to repository", 240],
    ["evaluationCommand", "Original evaluation command · must load that new model", 6000],
    ["parameters", "Training parameters · describe actual command/config, or not specified"], ["seed", "Actual seed policy · or not specified; this field does not set a seed"],
    ["protocol", "Protocol review · data split, model hand-off and known differences from reference"],
    ["dataset", "Dataset / held-out split"], ["model", "Model / training configuration"], ["reference", "Reference source · pinned source or explicitly user-defined target"],
    ["outputFile", "Evaluation score JSON / single-row CSV path", 240], ["metricKey", "Metric key / CSV column", 100],
  ];
  return <fieldset className="run-options" disabled={disabled}>
    <legend>{t("End-to-end experiment · prepare → train → new model → evaluate")}</legend>
    <p className="hint">{t("Scan-prefilled candidates require review. All commands start at the repository root in the same temporary container; use cd … && where needed. Import only loads fields, never runs code.")}</p>
    {[["01 · Commands & model hand-off", fields.slice(0, 6)], ["02 · Experiment protocol", fields.slice(6, 12)], ["03 · Metric output", fields.slice(12)]].map(([title, entries]) => <section className="config-group" key={title}><h3>{t(title)}</h3>{entries.map(([key, label, limit = 500]) => <label key={key}>{t(label)}<input value={draft[key]} maxLength={limit} onChange={(event) => update(key, event.target.value)} /></label>)}</section>)}
    <p className="hint">{t("Optional required input files: one repository-relative path per line, checked immediately before that stage. Files generated by preparation belong under Training, not Preparation. Existing new-model/output checks remain separate; this does not verify dataset contents.")}</p>
    {[["prepare-data", "Preparation"], ["train", "Training"], ["evaluate", "Evaluation"]].map(([stage, title]) => <label key={stage}>{t(title)}{t(" required inputs (optional) ")}<textarea rows={2} maxLength={4820} value={(draft.inputs?.[stage] ?? []).join("\n")} onChange={(event) => update("inputs", { ...draft.inputs, [stage]: event.target.value.split("\n") })} />
    </label>)}
    <label>{t("Evaluation metric capture")}<select value={draft.capture.kind} onChange={(event) => update("capture", { ...draft.capture, kind: event.target.value })}>
      <option value="file">{t("Original JSON / single-row CSV output")}</option><option value="stdout">{t("One labelled numeric stdout line")}</option><option value="stdout-json">{t("One JSON-object stdout metric line")}</option>
    </select></label>
    {draft.capture.kind === "stdout" && <label>{t("Exact stdout label")}<input value={draft.capture.label} maxLength={80} placeholder={t("Accuracy")} onChange={(event) => update("capture", { ...draft.capture, label: event.target.value })} /></label>}
    <label>{t("Printed metric units")}<select value={draft.capture.unit} onChange={(event) => update("capture", { ...draft.capture, unit: event.target.value })}>
      <option value="number">{t("Number as printed · no conversion")}</option><option value="percent">{t("Percent with % suffix")}</option>
    </select></label>
    <div className="metric-options">
      <label>{t("Condition")}<select value={draft.metricOperator} onChange={(event) => update("metricOperator", event.target.value)}><option value="eq">{t("Match reference (±)")}</option><option value="gte">{t("At least (≥)")}</option><option value="lte">{t("At most (≤)")}</option></select></label>
      <label>{t("Reference value")}<input type="number" step="any" value={draft.metricTarget} onChange={(event) => update("metricTarget", event.target.value)} /></label>
      {draft.metricOperator === "eq" && <label>{t("Absolute tolerance")}<input type="number" min="0" step="any" value={draft.metricTolerance} onChange={(event) => update("metricTolerance", event.target.value)} /></label>}
    </div>
    <p className="runner-note">{t("Requires an absent-before-training model file up to ")}{t(MODEL_EXPORT_LIMIT / 1024)}{t(" KiB. The evaluator must use this file; hashes only show bytes, not prove model use or scientific protocol equivalence. No pretrained fallback, host data upload, GPU or arbitrary paper-protocol inference.")}</p>
    <details><summary>{t("Scanned training/evaluation sources and parameters")}</summary><pre>{JSON.stringify({ training: report.evaluationDraft?.trainingEntries, evaluation: report.evaluationDraft?.entries,
      paths: report.evaluationDraft?.paths, parameters: report.experimentParameters, warnings: report.evaluationDraft?.warnings }, null, 2)}</pre></details>
    <label className="runner-confirm"><input type="checkbox" checked={draft.confirmed} onChange={(event) => update("confirmed", event.target.checked)} />{t("I reviewed every stage, data/split, training parameters/seed, model hand-off and reference. Blank installation/preparation is deliberate. Edits require confirmation again.")}</label>
    {error && <p className="runner-error" role="alert">{t(error)}</p>}
    <div className="recipe-actions"><button type="button" onClick={() => apply()} disabled={!draft.confirmed}>{t("Apply reviewed experiment")}</button>
      <button type="button" className="download-button" onClick={() => apply(true)} disabled={!draft.confirmed}>{t("Download experiment configuration")}</button></div>
  </fieldset>;
}

function ReportChecks({ report }) {
  const { t, checkText } = useLanguage();
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const groups = groupChecks(report.checks, problemsOnly);
  const visibleChecks = groups.flatMap((group) => group.checks);
  const selected = visibleChecks.find((check) => check.id === selectedId) ?? visibleChecks[0];
  return <div className="audit-workspace">
    <section className="audit-index" aria-label={t("Grouped scan checks")}>
      <div className="audit-index-heading"><h3>{t("Inspection groups")}</h3><label><input type="checkbox" checked={problemsOnly} onChange={(event) => setProblemsOnly(event.target.checked)} />{t(" Problems only")}</label></div>
      {groups.map((group) => <div className="audit-group" key={group.title}><h4>{t(group.title)}<span>{group.checks.length}</span></h4>
        {group.checks.map((check) => <button type="button" className={`audit-check check-${check.status.toLowerCase()}`} aria-pressed={selected?.id === check.id} onClick={() => setSelectedId(check.id)} key={check.id}>
          <span className="check-status">{t(check.status)}</span><span>{checkText(check)}</span><span aria-hidden="true">↗</span>
        </button>)}
      </div>)}
      {!selected && <p className="hint">{t("No checks match this filter. Clear “Problems only” to inspect passed checks.")}</p>}
    </section>
    <section className="audit-evidence" aria-label={t("Selected check evidence")} aria-live="polite">
      {selected ? <><p className="eyebrow">{t("Source evidence · ")}{selected.id}</p><h3>{checkText(selected)}</h3>
        <span className={`evidence-status check-${selected.status.toLowerCase()}`}><span className="check-status">{t(selected.status)}</span></span>
        {selected.evidence ? <p className="evidence"><span>{t("Source")}</span><EvidenceLink report={report} evidence={selected.evidence} /></p> : <p className="hint">{t("No source excerpt captured for this check.")}</p>}
        {selected.evidence?.text && <pre className="evidence-excerpt"><code>{selected.evidence.text}</code></pre>}
        {selected.suggestion && <div className="evidence-action"><p className="eyebrow">{t("Suggested next step")}</p><p>{t(selected.suggestion)}</p></div>}
        <p className="hint">{t("Static finding at the pinned commit. It does not establish that commands execute successfully or reproduce a paper.")}</p>
      </> : <p className="hint">{t("Select a check to inspect its evidence.")}</p>}
    </section>
  </div>;
}

function ExecutionEvidence({ job, onPrepareReplay, replayDisabled }) {
  const { t } = useLanguage();
  const labels = { VERIFIED: "Configured checks passed", FAILED: "Output checks failed", INCOMPLETE: "Verification incomplete",
    NOT_CONFIGURED: "No output checks configured", PENDING: "Waiting for execution" };
  return (
    <div className="execution-evidence">
      <dl className="result-dimensions">
        <div><dt>{t("Process")}</dt><dd>{t(job.status.replaceAll("_", " "))}</dd></div>
        <div><dt>{t("Output checks")}</dt><dd>{t(labels[job.verification?.status] ?? "Not available")}</dd></div>
        <div><dt>{t("Reference acceptance")}</dt><dd>{t(job.evaluation?.status?.replaceAll("_", " ") ?? (job.matrix ? `${job.matrix.summary.matched}/${job.matrix.summary.total} cells matched` : "No evaluation result"))}</dd></div>
        <div><dt>{t("Scope")}</dt><dd>{t("Selected experiment only")}</dd></div>
      </dl>
      <h3>{t("Output verification · ")}{t(labels[job.verification?.status] ?? "Not available")}</h3>
      <p className="hint">{t("Execution success alone does not prove paper reproducibility. These checks validate only the expectations you supplied.")}</p>
      {job.persistenceError && <p className="runner-error" role="alert">{t(job.persistenceError)}{t(" — download the evidence now.")}</p>}
      {job.logTruncated && <p className="runner-note">{t("Only the last 900,000 log characters are retained.")}</p>}
      <details className="verification-details"><summary>{t("Inspect output and input checks (")}{t(job.verification?.checks?.length ?? 0)})</summary><ul className="verification-checks">
        {job.verification?.checks?.map((check) => (
          <li key={check.id}><strong>{t(check.status)}</strong> · {t(check.id)}: <code>{check.expected}</code>
            {check.observed && <details><summary>{t("Inspect captured evidence")}</summary><pre>{JSON.stringify(check.observed, null, 2)}</pre></details>}
          </li>
        ))}
      </ul></details>
      {job.paperMatrix && <div className="run-comparison">
        <h3>{t("Paper matrix · ")}{t(job.matrix ? `${job.matrix.summary.matched}/${job.matrix.summary.total} matched` : "incomplete")}</h3>
        <p className="hint">{t("Observed values come from the fresh CSV produced by the reviewed source workflow. References come from the commit-pinned README table.")}</p>
        {job.matrix?.error && <p className="runner-error">{t(job.matrix.error)}</p>}
        {job.matrix?.cells?.length > 0 && <div className="matrix-scroll"><table className="matrix-table"><thead><tr><th>{t("Dataset")}</th><th>{t("Model")}</th><th>{t("Paper")}</th><th>{t("Observed")}</th><th>{t("Delta")}</th><th>{t("Status")}</th></tr></thead>
          <tbody>{job.matrix.cells.map((cell) => <tr key={cell.id}><td>{cell.dataset}</td><td>{cell.model}{t(cell.seed ? ` · seed ${cell.seed}` : "")}</td><td>{cell.target}</td><td>{cell.observed ?? "—"}{t(cell.compared !== cell.observed && cell.compared != null ? ` → ${cell.compared}` : "")}</td><td>{cell.delta ?? "—"}</td><td>{t(cell.status)}</td></tr>)}</tbody></table></div>}
      </div>}
      {job.evaluation && <div className="run-comparison">
        <h3>{t("Evaluation report · ")}{t(job.evaluation.status.replaceAll("_", " "))}</h3>
        <p className="hint">{t(job.benchmark ? `Reviewed ${job.benchmark.datasetName} software case: input hashes and the pinned README row must pass checks before entry and at completion. This is not full-paper reproduction or a security attestation.` : "Dataset, model and reference source below are user declarations, not independently verified paper claims.")}</p>
        <dl className="evaluation-summary">
          <dt>{t("Dataset / split")}</dt><dd>{job.evaluation.dataset}</dd>
          <dt>{t("Model / checkpoint")}</dt><dd>{job.evaluation.model}</dd>
          <dt>{t("Reference source")}</dt><dd>{job.benchmark ? <a href={job.benchmark.reference.url} target="_blank" rel="noreferrer">{t("Pinned README · Table 3 · ")}{job.benchmark.datasetName}</a> : job.evaluation.reference}</dd>
          <dt>{t("Observed / reference")}</dt><dd>{t(job.evaluation.observedValue ?? "unknown")} / {job.evaluation.referenceValue} · {job.evaluation.metricKey}</dd>
          <dt>{t("Difference / tolerance")}</dt><dd>{t(Number.isFinite(job.evaluation.delta) ? Number(job.evaluation.delta.toPrecision(12)) : "unknown")} / {t(job.evaluation.tolerance)}{t(" · condition ")}{t(job.evaluation.operator)}</dd>
        </dl>
        {job.benchmark && <>
          <p className="runner-note">{t(job.benchmark.compatibility.note)}</p>
          <p className="hint">{t("Scope: ")}{job.benchmark.reference.scope}</p>
          <details><summary>{t("Dataset, checkpoint, code hashes and reference-row evidence")}</summary><pre>{JSON.stringify({ assets: job.assets, reference: job.referenceEvidence }, null, 2)}</pre></details>
        </>}
        {job.benchmark?.training && <>
          <h3>{t("Training from scratch")}</h3>
          <p className="hint">{t("Original repository trainer → newly saved model → original evaluator. No pretrained model fallback and no search for a better test score.")}</p>
          <dl className="evaluation-summary">
            <dt>{t("Paper configuration")}</dt><dd>{JSON.stringify(job.benchmark.training.parameters)}</dd>
            <dt>{t("Run seed / count")}</dt><dd>{t(job.benchmark.training.seed)}{t(" / 1 · our disclosed seed, not an author-provided seed")}</dd>
            <dt>{t("Training time")}</dt><dd>{t(job.trainingCheckpoint?.trainingSeconds ?? "unknown")}{t(" seconds")}</dd>
            <dt>{t("New checkpoint")}</dt><dd>{t(job.trainingCheckpoint?.path ?? "not saved")} · {t(job.trainingCheckpoint?.size ?? 0)}{t(" bytes")}</dd>
            <dt>{t("Checkpoint SHA-256")}</dt><dd>{t(job.trainingCheckpoint?.sha256 ?? "unknown")}</dd>
          </dl>
          {job.trainingCheckpoint?.status === "PASSED" && job.trainingCheckpoint.base64 && <a className="download-button evidence-download"
            href={`data:application/octet-stream;base64,${job.trainingCheckpoint.base64}`} download={`reprocheck-iris-${job.id}.pickle.lzma`}>{t("Download newly trained model")}</a>}
          <p className="runner-note">{t("Pickle models are executable when loaded. This download is data only; do not load an untrusted model on the host.")}</p>
        </>}
        {job.experiment && <>
          <h3>{t("Configured end-to-end experiment")}</h3>
          <dl className="evaluation-summary"><dt>{t("Parameters / seed (declared)")}</dt><dd>{job.experiment.parameters} / {t(job.experiment.seed)}</dd>
            <dt>{t("Protocol review (declared)")}</dt><dd>{job.experiment.protocol}</dd><dt>{t("New checkpoint")}</dt><dd>{t(job.trainingCheckpoint?.path ?? "not saved")} · {t(job.trainingCheckpoint?.size ?? 0)}{t(" bytes")}</dd>
            <dt>{t("Checkpoint SHA-256")}</dt><dd>{t(job.trainingCheckpoint?.sha256 ?? "unknown")}</dd><dt>{t("Training time")}</dt><dd>{t(job.trainingCheckpoint?.trainingSeconds ?? "unknown")}{t(" seconds")}</dd></dl>
          {job.trainingCheckpoint?.status === "PASSED" && job.trainingCheckpoint.base64 && <a className="download-button evidence-download"
            href={`data:application/octet-stream;base64,${job.trainingCheckpoint.base64}`} download={job.trainingCheckpoint.path.split("/").at(-1)}>{t("Download newly trained model")}</a>}
          <p className="runner-note">{t("Model downloads are untrusted data. Never load pickle/joblib or other executable model formats on the host. A matching number does not independently verify the declared protocol.")}</p>
        </>}
        {job.evaluation.output && <details><summary>{t("Reported metrics and asset identifiers")}</summary><pre>{JSON.stringify(job.evaluation.output, null, 2)}</pre></details>}
      </div>}
      {job.candidate && <details><summary>{t("Reviewed scan candidates and manual changes")}</summary><pre>{JSON.stringify(job.candidate, null, 2)}</pre></details>}
      <details>
        <summary>{t("Environment and actual commands")}</summary>
        <pre>{JSON.stringify({ environment: job.environment, limits: job.limits, commandOverride: job.commandOverride,
          commands: job.steps, dependencies: job.dependencies, experimentParameters: job.experimentParameters,
          note: "Extracted parameter defaults are not proof of the values or seeds actually used." }, null, 2)}</pre>
      </details>
      {job.status !== "RUNNING" && (
        <a className="download-button evidence-download" href={`/api/runs/${job.id}?download=1`} download={`reprocheck-run-${job.id}.json`}>{t("Download execution evidence")}</a>
      )}
      {job.recipe && <div className="recipe-actions">
        <a className="download-button evidence-download" href={`/api/runs/${job.id}/recipe?download=1`} download={`reprocheck-recipe-${job.id}.json`}>{t("Download frozen recipe")}</a>
        <button type="button" onClick={() => onPrepareReplay(job.id)} disabled={replayDisabled}>{t("Review frozen recipe")}</button>
      </div>}
      {!job.recipe && job.status === "SUCCEEDED" && <p className="runner-note">{t("Recipe unavailable: ")}{t(job.recipeUnavailableReason ?? "This record predates recipe capture; run again.")}</p>}
      {job.comparison && <div className="run-comparison">
        <h3>{t("Compared with baseline")}</h3>
        <p className="hint">{t("Baseline ")}{t(job.comparison.baselineRunId)}{t(". Differences do not mean acceptance failed; identical results do not prove acceptance passed. Changes alone do not explain their cause.")}</p>
        <p>{t("Current acceptance: ")}<strong>{t(labels[job.verification?.status] ?? "Not available")}</strong>{t(" · execution: ")}{t(job.status)}.</p>
        <p>{t("Metric requirement: ")}{job.executionOptions?.metricKey ? `${job.executionOptions.metricKey} ${job.executionOptions.metricOperator} ${job.executionOptions.metricTarget} (tolerance ${job.executionOptions.metricTolerance ?? 0})` : "No numeric requirement configured"}{t(". See output checks above for individual failures.")}</p>
        {job.comparison.groups ? Object.entries(job.comparison.groups).map(([name, group]) => <p key={name}>{t(name === "inputs" ? "Code, environment and conditions" : "Observed outputs")}: <strong>{t(group.status)}</strong>{t(group.unknownCount > 0 && ` · ${group.unknownCount} unavailable field(s)`)}</p>)
          : <p className="hint">{t("Older record: grouped difference summary was not saved. Inspect individual fields below.")}</p>}
        <div className="comparison-scroll" tabIndex={0} role="region" aria-label={t("Baseline and current values")}>
          <table className="comparison-table"><caption>{t("Recorded differences · baseline versus current run")}</caption>
            <thead><tr><th>{t("Field")}</th><th>{t("Baseline")}</th><th>{t("Current")}</th><th>{t("Difference")}</th></tr></thead>
            <tbody>{job.comparison.rows.map((row) => <tr key={row.id}>
              <th scope="row">{t(row.id)}{row.key && <small>{row.key}</small>}</th>
              {[row.baseline, row.current].map((value, index) => <td key={index}>{value !== null && typeof value === "object"
                ? <details><summary>{t("Inspect recorded values")}</summary><pre>{comparisonValue(value)}</pre></details>
                : <pre>{comparisonValue(value)}</pre>}</td>)}
              <td><strong>{t(row.status)}</strong>{row.delta !== undefined && <small>{t("Delta: ")}{comparisonValue(row.delta)}</small>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </div>}
    </div>
  );
}

function LandingHero() {
  const { t } = useLanguage();
  const [motion, setMotion] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setMotion(!preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  return <section className="cinema-hero" aria-labelledby="workspace-title">
    <div className="cinema-background" aria-hidden="true">
      {motion && !videoFailed && <video autoPlay muted loop playsInline preload="metadata" onError={() => setVideoFailed(true)}
        src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260809_012548_ef22562c-c0ae-4816-ad9d-f8922af4e6a7.mp4" />}
    </div>
    <div className="cinema-copy">
      <p className="capability-pill"><span aria-hidden="true">✳</span>{t(" Public source. Explicit evidence.")}</p>
      <h1 id="workspace-title" tabIndex={-1}><span>{t("Research code.")}</span><span>{t("Verifiable results.")}</span></h1>
      <p className="cinema-description">{t("Inspect a research repository, review its experiment,")}<br className="desktop-break" />{t(" and check the result against a declared reference.")}</p>
      <button className="cinema-cta" type="button" onClick={() => { document.getElementById("repository")?.focus({ preventScroll: true }); document.getElementById("scan-form")?.scrollIntoView({ block: "start" }); }}>{t("Start a scan ")}<span aria-hidden="true">↗</span></button>
      <p className="cinema-caption">{t("Scanning needs no Docker. Execution stays local.")}</p>
    </div>
    <ol className="cinema-stages" aria-label={t("Reproduction workflow")}>
      <li><span aria-hidden="true">01</span><strong>{t("Scan")}</strong><small>{t("Source-linked findings")}</small></li>
      <li><span aria-hidden="true">02</span><strong>{t("Review")}</strong><small>{t("Commands and inputs")}</small></li>
      <li><span aria-hidden="true">03</span><strong>{t("Execute")}</strong><small>{t("Local Docker workflow")}</small></li>
      <li><span aria-hidden="true">04</span><strong>{t("Verify")}</strong><small>{t("Declared reference checks")}</small></li>
    </ol>
    <button className="motion-toggle" type="button" disabled={videoFailed} aria-pressed={motion && !videoFailed} onClick={() => setMotion(!motion)}>{t(videoFailed ? "Static background · video unavailable" : motion ? "Pause background" : "Play background")}</button>
  </section>;
}

function App() {
  const { t } = useLanguage();
  const [restored] = useState(() => loadWorkspace("app"));
  const initialReport = savedReport(restored.report);
  const [page, setPage] = useState(() => savedPage(restored.page, initialReport, restored.runId));
  const [url, setUrl] = useState(() => initialReport ? `https://github.com/${initialReport.repository}` : "");
  const [report, setReport] = useState(() => initialReport ?? exampleReport);
  const [importedDraft, setImportedDraft] = useState(null);
  const [isExample, setIsExample] = useState(() => !initialReport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedWorkflow, setSelectedWorkflow] = useState("quick");
  const [preflight, setPreflight] = useState(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const [runConfirmed, setRunConfirmed] = useState(false);
  const [runJob, setRunJob] = useState(null);
  const [runLoading, setRunLoading] = useState(false);
  const optionsLocked = preflightLoading || runLoading || runJob?.status === "RUNNING";
  const [quickCommand, setQuickCommand] = useState("");
  const [acceptance, setAcceptance] = useState(emptyAcceptance);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState("");
  const [archivedJob, setArchivedJob] = useState(null);
  const [replayPreview, setReplayPreview] = useState(null);
  const [replayConfirmed, setReplayConfirmed] = useState(false);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState("");
  const [restoringRecord, setRestoringRecord] = useState(() => validRunId(restored.page === "run" ? restored.runId : restored.page === "history" ? restored.archivedId : null));
  useEffect(() => {
    if (restoringRecord) return;
    saveWorkspace("app", { page, report: isExample ? null : report, runId: runJob?.id ?? restored.runId,
      archivedId: archivedJob?.id ?? null });
  }, [page, report, isExample, runJob?.id, archivedJob?.id, restoringRecord]);
  useEffect(() => {
    let disposed = false;
    const id = restored.page === 'run' ? restored.runId : restored.page === 'history' ? restored.archivedId : null;
    if (!validRunId(id)) return;
    fetch(`/api/runs/${id}`, { signal: AbortSignal.timeout(15000) }).then(async response => {
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Unable to load the record');
      if (!disposed) { if (restored.page === 'run') setRunJob(value); else setArchivedJob(value); }
    }).catch(failure => { if (!disposed) { setHistoryError(failure.message); setPage('history'); } }).finally(() => { if (!disposed) setRestoringRecord(false); });
    return () => { disposed = true; };
  }, []);
  const executionBusy = loading || preflightLoading || runLoading || replayLoading || runJob?.status === "RUNNING";
  useEffect(() => { if (replayPreview) document.getElementById("recipe-title")?.focus(); }, [replayPreview]);
  useEffect(() => { if (runJob?.id) setPage("run"); }, [runJob?.id]);
  useEffect(() => { document.getElementById("workspace-title")?.focus(); }, [page]);
  useEffect(() => { if (archivedJob) document.getElementById("archived-execution")?.focus(); }, [archivedJob]);
  async function prepareReplay(id) {
    setPage("history");
    setReplayLoading(true);
    setReplayError("");
    setReplayConfirmed(false);
    setReplayPreview(null);
    try {
      const response = await fetch(`/api/runs/${id}/replay-preflight`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to prepare the recipe");
      setReplayPreview(result);
    } catch (failure) { setReplayError(failure.message); }
    finally { setReplayLoading(false); }
  }
  async function startReplay() {
    setRunLoading(true);
    setReplayError("");
    try {
      const response = await fetch(`/api/runs/${replayPreview.replayOf}/replay`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmUnknownCode: true, recipeFingerprint: replayPreview.recipe.fingerprint }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to start replay");
      setRunJob(result);
      setReplayConfirmed(false);
      setRunConfirmed(false);
    } catch (failure) { setReplayError(failure.message); }
    finally { setRunLoading(false); }
  }
  async function refreshHistory() {
    try {
      const response = await fetch("/api/runs");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load history");
      setHistory(result.runs);
      setHistoryError("");
    } catch (historyFailure) { setHistoryError(historyFailure.message); }
  }
  async function openHistory(id) {
    try {
      const response = await fetch(`/api/runs/${id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load the record");
      setArchivedJob(result);
      setHistoryError("");
    } catch (historyFailure) { setHistoryError(historyFailure.message); }
  }
  useEffect(() => { if (runJob?.status !== "RUNNING") void refreshHistory(); }, [runJob?.status]);
  function updateAcceptance(field, value) {
    setAcceptance((current) => ({ ...current, [field]: value, ...(field !== "candidateReview" && current.candidateReview
      ? { candidateReview: { ...current.candidateReview, confirmed: false } } : {}) }));
    setPreflight(null);
    setRunConfirmed(false);
  }
  const selectedReviewedCase = acceptance.benchmarkId ? reviewedCaseById.get(acceptance.benchmarkId) : null;
  const reviewedMatrixWorkflow = selectedWorkflow === "paper-matrix" && selectedReviewedCase?.matrix ? { id: "paper-matrix", title: selectedReviewedCase.title, status: "REVIEWED_BENCHMARK", steps: [
    { id: "install", title: "Install reviewed Python 3.10 CPU dependencies", status: "DOCUMENTED", command: selectedReviewedCase.installCommand },
    { id: "prepare-assets", title: "Prepare five hash-locked public datasets", status: "DOCUMENTED", instruction: "The reviewed adapter runs the authors' public-data setup and preparation entries." },
    { id: "evaluation-benchmark", title: `Run and verify all ${selectedReviewedCase.matrix.cells.length} original CPU result cells`, status: "DOCUMENTED", instruction: "The authors' deterministic launcher computes MC, SeqRules and PCTM on every dataset; ReproCheck verifies each original result and emits a CSV matrix." },
  ] } : null;
  const selectedMatrixAdapter = report.paperMatrixDraft?.adapters.find((adapter) => adapter.id === acceptance.paperMatrix?.adapterId);
  const matrixWorkflow = selectedWorkflow === "paper-matrix" && selectedMatrixAdapter ? { id: "paper-matrix", title: "Paper result matrix", status: "USER_REVIEWED_MATRIX",
    steps: selectedMatrixAdapter.steps.map((step) => ({ ...step, title: `${step.role} · ${step.command}`, status: "USER_REVIEWED" })) } : null;
  const selectedQuickEntry = selectedWorkflow === "quick" && report.quickEntries?.find((entry) => entry.id === acceptance.quickEntryId);
  const activeWorkflow = reviewedMatrixWorkflow ?? matrixWorkflow ?? (selectedQuickEntry ? { id: "quick", title: "Quick verification", status: selectedQuickEntry.status, steps: selectedQuickEntry.steps } : null) ?? report.workflows?.find((workflow) => workflow.id === selectedWorkflow)
    ?? report.workflows?.[0]
    ?? null;
  const selectedCandidate = report.evaluationDraft?.entries.find((entry) => entry.id === acceptance.candidateReview?.entryId);
  const selectedBenchmarkSource = selectedReviewedCase ? benchmarkSources[selectedReviewedCase.adapter] : null;
  const displayedPlan = reviewedMatrixWorkflow ?? matrixWorkflow ?? (acceptance.experiment ? { title: acceptance.experiment.title, status: "USER_REVIEWED_EXPERIMENT", steps: [
    ...(acceptance.experiment.installCommand ? [{ id: "install", title: "Install reviewed dependencies", status: "USER_REVIEWED", command: acceptance.experiment.installCommand }] : []),
    ...(acceptance.experiment.prepareCommand ? [{ id: "prepare-data", title: "Prepare data", status: "USER_REVIEWED", command: acceptance.experiment.prepareCommand }] : []),
    { id: "train", title: "Train and save new model", status: "USER_REVIEWED", command: acceptance.experiment.trainCommand },
    { id: "evaluate", title: "Evaluate new model", status: "USER_REVIEWED", command: quickCommand },
  ] } : selectedReviewedCase?.training ? { title: selectedReviewedCase.title, status: "REVIEWED_TRAINING", steps: [
    { id: "install", title: "Install reviewed CPU dependencies", status: "DOCUMENTED", command: selectedReviewedCase.installCommand },
    { id: "prepare-assets", title: `Prepare hash-locked real UCI ${selectedReviewedCase.datasetName} data`, status: "DOCUMENTED", instruction: "Reviewed adapter downloads UCI data and applies the explicit MNIST-only import compatibility patch. Check the local runner for exact commands." },
    { id: "training-benchmark", title: "Train from scratch and save a new model", status: "DOCUMENTED", command: `cd software_model && python train_swept_models.py ${selectedReviewedCase.training.arguments.join(" ")}`, instruction: `Reviewed launcher sets NumPy seed ${selectedReviewedCase.training.seed} before calling the original trainer. This is the original invocation, not the complete seeded adapter.` },
    { id: "evaluation-benchmark", title: `Evaluate the newly trained model and compare with ${selectedReviewedCase.reference.value}`, status: "DOCUMENTED", instruction: "Original evaluate.py reads the newly trained checkpoint; the adapter records actual held-out accuracy as JSON." },
  ] } : selectedReviewedCase ? { title: selectedReviewedCase.title, status: "REVIEWED_BENCHMARK", steps: [
    { id: "install", title: "Install reviewed dependencies", status: "DOCUMENTED", command: selectedReviewedCase.installCommand },
    { id: "prepare-assets", title: "Prepare reviewed inputs", status: "DOCUMENTED", instruction: selectedReviewedCase.dataset },
    { id: "evaluation-benchmark", title: "Evaluate against the pinned reference", status: "DOCUMENTED", instruction: "The reviewed adapter evaluates the selected model and records fresh metrics. Check the local runner to inspect the effective commands." },
  ] } : selectedCandidate ? candidateWorkflow(report, selectedCandidate) : activeWorkflow ?? report.reproductionPlan);

  function applyCandidate(options) {
    setSelectedWorkflow("evaluation");
    setQuickCommand(options.quickCommand);
    setAcceptance({ ...emptyAcceptance, ...options.evaluation, expectedText: options.expectedText, outputFile: options.outputFile,
      metricKey: options.metricKey, metricOperator: options.metricOperator, metricTarget: options.metricTarget === null ? "" : String(options.metricTarget),
      candidateReview: options.candidateReview });
    setPreflight(null); setRunConfirmed(false); setRunJob(null); setPreflightError("");
    document.getElementById("runner-title")?.focus();
  }

  function chooseQuickEntry(entry) {
    setPage("configure");
    setSelectedWorkflow("quick"); setQuickCommand(""); setAcceptance({ ...emptyAcceptance, quickEntryId: entry.id });
    setPreflight(null); setRunConfirmed(false); setRunJob(null); setPreflightError("");
    document.getElementById("runner-title")?.focus();
  }

  function applyExperiment(options) {
    setSelectedWorkflow("training"); setQuickCommand(options.quickCommand);
    setAcceptance({ ...emptyAcceptance, ...options.evaluation, experiment: options.experiment, outputFile: options.outputFile, metricKey: options.metricKey,
      metricOperator: options.metricOperator, metricTarget: String(options.metricTarget), metricTolerance: String(options.metricTolerance), expectedText: options.expectedText });
    setPreflight(null); setRunConfirmed(false); setRunJob(null); setPreflightError("");
  }

  function applyMatrix(paperMatrix) {
    setSelectedWorkflow("paper-matrix"); setQuickCommand(""); setAcceptance({ ...emptyAcceptance, paperMatrix });
    setPreflight(null); setRunConfirmed(false); setRunJob(null); setPreflightError("");
  }

  function invalidateExperiment() {
    setAcceptance((current) => ({ ...current, experiment: null }));
    setPreflight(null); setRunConfirmed(false);
  }

  const runScan = useCallback(async (targetUrl, benchmarkId, pinnedCommit) => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl, ...(pinnedCommit ? { pinnedCommit } : {}), ...(benchmarkId ? { executionOptions: { benchmarkId } } : {}) }),
      });
      const result = await response.json();

      if (!response.ok) throw new Error(result.error || "Scan failed");

      setReport(result);
      setPage("report");
      setImportedDraft(null);
      setIsExample(false);
      setSelectedWorkflow("quick");
      setPreflight(null);
      setRunConfirmed(false);
      setRunJob(null);
      setQuickCommand("");
      setAcceptance(emptyAcceptance);
      return result;
    } catch (scanError) {
      setError(scanError.message || "Unable to scan this repository");
      throw scanError;
    } finally {
      setLoading(false);
    }
  }, []);

  async function openExperimentVersion(draft) {
    const targetUrl = `https://github.com/${draft.repository}`;
    try {
      const result = await runScan(targetUrl, undefined, draft.commit);
      if (result.repository !== draft.repository || result.commit !== draft.commit) throw new Error("Saved source identity does not match the scan");
      setUrl(targetUrl); setImportedDraft({ ...draft, confirmed: false }); setSelectedWorkflow("training");
      setPage("configure");
      return true;
    } catch (failure) { setError(failure.message); return false; }
  }

  function submit(event) {
    event.preventDefault();
    void runScan(url).catch(() => {});
  }

  async function loadCpuEvaluation() {
    const targetUrl = "https://github.com/karpathy/micrograd";
    setUrl(targetUrl);
    try {
      await runScan(targetUrl);
      setPage("configure");
      setSelectedWorkflow("evaluation");
      setQuickCommand(cpuEvaluationCommand);
      setAcceptance({ ...emptyAcceptance, expectedText: "evaluation-ok", outputFile: "evaluation-result.json", metricKey: "accuracy", metricOperator: "eq", metricTarget: "1", metricTolerance: "0.05",
        dataset: "Synthetic separated-sign-x-v1; train 32 (seed 101), held-out test 48 (seed 202); generated and hashed in entry",
        model: "Micrograd MLP [2,4,1]; seed 7, SGD 40 epochs, lr 0.1; checkpoint saved and reloaded in entry",
        reference: "ReproCheck synthetic fixture target: accuracy 1.0 ± 0.05; NOT Micrograd moon data or a published benchmark", assetsInEntry: true });
    } catch { /* The scan error is already displayed. */ }
  }

  async function loadPublishedBenchmark(benchmarkId) {
    const benchmark = reviewedCaseById.get(benchmarkId);
    const targetUrl = `https://github.com/${benchmark.repository}`;
    setUrl(targetUrl);
    try {
      await runScan(targetUrl, benchmark.id);
      setPage("configure");
      setSelectedWorkflow(benchmark.matrix ? "paper-matrix" : benchmark.training ? "training" : "evaluation");
      setQuickCommand(benchmark.matrix ? "" : benchmarkEvaluationCommand(benchmark));
      setAcceptance(benchmark.matrix ? { ...emptyAcceptance, benchmarkId: benchmark.id } : { ...emptyAcceptance, benchmarkId: benchmark.id,
        expectedText: "published-benchmark-ok", outputFile: "benchmark-result.json", metricKey: benchmark.metricKey ?? "accuracy", metricOperator: "eq",
        metricTarget: String(benchmark.reference.value), metricTolerance: String(benchmark.reference.tolerance), dataset: benchmark.dataset,
        model: benchmark.model, reference: benchmark.reference.url });
    } catch { /* The scan error is already displayed. */ }
  }

  function downloadReport() {
    downloadJson(
      report,
      `reprocheck-${report.repository.replace("/", "-")}-${report.commit.slice(0, 7)}.json`,
    );
  }

  function downloadPlan() {
    downloadJson(
      {
        repository: report.repository,
        commit: report.commit,
        ...displayedPlan,
        experimentParameters: report.experimentParameters,
      },
      `reprocheck-plan-${report.repository.replace("/", "-")}-${report.commit.slice(0, 7)}.json`,
    );
  }

  async function checkPreflight() {
    setPreflightLoading(true);
    setPreflightError("");
    setRunConfirmed(false);
    setRunJob(null);

    try {
      const response = await fetch("/api/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://github.com/${report.repository}`,
          commit: report.commit,
          workflowId: activeWorkflow.id,
          executionOptions: acceptance.benchmarkId ? { benchmarkId: acceptance.benchmarkId } : acceptance.paperMatrix ? { paperMatrix: acceptance.paperMatrix } : { quickCommand, expectedText: acceptance.expectedText, outputFile: acceptance.outputFile, metricKey: acceptance.metricKey,
            metricOperator: acceptance.metricOperator, metricTarget: acceptance.metricTarget === "" ? null : Number(acceptance.metricTarget), metricTolerance: acceptance.metricOperator === "eq" ? Number(acceptance.metricTolerance) : 0,
            ...(acceptance.candidateReview ? { candidateReview: acceptance.candidateReview } : {}),
            ...(acceptance.experiment ? { experiment: acceptance.experiment } : {}),
            ...(acceptance.quickEntryId ? { quickEntryId: acceptance.quickEntryId } : {}),
            evaluation: activeWorkflow.id === "evaluation" || acceptance.experiment ? { dataset: acceptance.dataset, model: acceptance.model, reference: acceptance.reference, assetsInEntry: acceptance.assetsInEntry } : null },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Runner check failed");
      setPreflight(result);
    } catch (runnerError) {
      setPreflightError(runnerError.message || "Unable to check the runner");
    } finally {
      setPreflightLoading(false);
    }
  }

  async function startExecution(packageIndex = "readme", previousJob = null) {
    setRunLoading(true);
    setPreflightError("");

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://github.com/${previousJob?.repository ?? report.repository}`,
          commit: previousJob?.commit ?? report.commit,
          workflowId: previousJob?.workflowId ?? activeWorkflow.id,
          packageIndex,
          executionOptions: previousJob?.executionOptions ?? preflight.executionOptions,
          confirmUnknownCode: true,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to start the run");
      setRunJob(result);
    } catch (runError) {
      setPreflightError(runError.message || "Unable to start the run");
    } finally {
      setRunLoading(false);
    }
  }

  async function cancelExecution() {
    const response = await fetch(`/api/runs/${runJob.id}`, { method: "DELETE" });
    const result = await response.json();
    if (response.ok) setRunJob(result);
  }

  useEffect(() => {
    if (runJob?.status !== "RUNNING") return undefined;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/runs/${runJob.id}`);
        const result = await response.json();
        if (response.ok) {
          setRunJob(result);
        } else if (response.status === 404) {
          setRunJob((current) => ({
            ...current,
            status: "LOST",
            diagnosis: "The local server restarted and lost this run record; the container still has its own timeout.",
          }));
        }
      } catch {
        // Keep the current log visible while a transient poll fails.
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [runJob?.id, runJob?.status]);

  useEffect(() => {
    const context = document.modelContext;

    if (!context?.registerTool) return undefined;

    const lifecycle = new AbortController();

    void Promise.resolve(
      context.registerTool(
        {
          name: "scan_repository",
          title: "Scan repository",
          description: "Scan a public GitHub research repository and show its reproducibility report.",
          inputSchema: {
            type: "object",
            properties: {
              url: { type: "string", format: "uri" },
            },
            required: ["url"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          async execute(input) {
            if (typeof input?.url !== "string") {
              throw new Error("A GitHub repository URL is required");
            }

            setUrl(input.url);
            const result = await runScan(input.url);
            return {
              repository: result.repository,
              status: result.status,
              summary: result.summary,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});

    return () => lifecycle.abort();
  }, [runScan]);

  return (
    <div className={`shell${page === "scan" ? " home-shell" : ""}`}>
      <header className="topbar">
        <a className="brand" href="#scan" onClick={(event) => { event.preventDefault(); setPage("scan"); }} aria-label={t("ReproCheck home")}>
          <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="28" height="28" fill="none"><circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" /><path d="m10 16 4 4 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
          <span>{t("ReproCheck")}</span>
        </a>
        <nav className="workspace-nav" aria-label={t("Workspace")}>
          {[["scan", "Start scan"], ["report", "Scan report"], ["configure", "Experiment"], ["run", "Execution"], ["web", "Web verification"], ["history", "History & comparison"]].map(([id, label]) =>
            <button type="button" key={id} aria-current={page === id ? "page" : undefined} disabled={(id === "configure" && (isExample || ["node", "unknown"].includes(report.projectType))) || (id === "run" && !runJob)} onClick={() => setPage(id)}>{t(label)}{id === "run" && runJob?.status === "RUNNING" && <span className="live-dot" />}</button>)}
        </nav>
        <LanguageSwitcher />
        <span className="mode">{t("Research workbench")}</span>
      </header>

      <main>
        {page === "scan" && <LandingHero />}
        <div className="workspace-heading" hidden={page === "scan"}>
          <div><p className="eyebrow">{t("REPROCHECK / ")}{t(page)}</p><h1 id={page === "scan" ? "scan-workspace-title" : "workspace-title"} tabIndex={-1}>{t({ scan: "From repository to evidence.", report: "Inspect the evidence", configure: report.projectType === "node" ? "Review installation, tasks and services" : "Review your experiment", run: "Execution workspace", web: "Web application verification", history: "Run history & comparison" }[page])}</h1></div>
          {page !== "scan" && <button type="button" className="download-button" onClick={() => setPage("scan")}>{t("New scan")}</button>}
        </div>
        {loading && <p className="source-strip" role="status">{t("Scanning repository and collecting source evidence…")}</p>}
        {error && page !== "scan" && <p className="error" role="alert">{t(error)}</p>}
        {page !== "scan" && page !== "history" && page !== "web" && <div className="source-strip"><span>{t(page !== "run" && isExample ? "DEMO · not a live scan" : "PINNED SOURCE")}</span><strong>{page === "run" ? runJob?.repository : report.repository}</strong><code>{(page === "run" ? runJob?.commit : report.commit)?.slice(0, 12)}</code></div>}
        <div hidden={page !== 'web'}><WebVerification active={page === 'web'} sourceReport={isExample ? null : report} /></div>
        <div className="view-panel home-layout" hidden={page !== "scan"}>
        <section className="scan-panel" id="scan-form" aria-labelledby="scan-title">
          <div>
            <p className="eyebrow">{t("Research repository readiness")}</p>
            <h2 id="scan-title">{t("Check a research repository")}</h2>
            <p className="hint">{t("Find a supported entry, review its inputs, and verify the result against a declared reference.")}</p>
          </div>

          <form onSubmit={submit}>
            <label htmlFor="repository">{t("Public GitHub repository")}</label>
            <div className="input-row">
              <input
                id="repository"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder={t("https://github.com/owner/repository")}
                required
              />
              <button type="submit" disabled={executionBusy}>
                {t(loading ? "Scanning…" : "Scan repository")}
              </button>
            </div>
            <p className="hint">{t("Public repositories only · Results pinned to a commit")}</p>
            <details className="case-picker"><summary>{t("Explore reviewed examples")}</summary><div className="case-grid">
            <button className="download-button" type="button" onClick={loadCpuEvaluation} disabled={executionBusy}>{t("Load CPU evaluation example")}</button>
            <p className="hint">{t("Small synthetic held-out dataset + trained checkpoint. Loads a reviewed command; does not start execution.")}</p>
            {reviewedBenchmarks.map((benchmark) => <div key={benchmark.id}>
              <button className="download-button" type="button" onClick={() => loadPublishedBenchmark(benchmark.id)} disabled={executionBusy}>{t("Load published ")}{benchmark.datasetName}{t(" benchmark")}</button>
              <p className="hint">{benchmark.matrix ? `Reviewed real-data paper matrix: ${benchmark.matrix.cells.length} pinned result cells.` : `Reviewed real-data paper case. Reference: ${benchmark.reference.value} in the pinned README.`}{t(" Does not start execution.")}</p>
            </div>)}
            {reviewedTrainings.map((benchmark) => <div key={benchmark.id}>
              <button className="download-button" type="button" onClick={() => loadPublishedBenchmark(benchmark.id)} disabled={executionBusy}>{t("Load ")}{benchmark.datasetName}{t(" training reproduction")}</button>
              <p className="hint">{t("Train the original paper model once, save a new checkpoint, then evaluate against ")}{benchmark.reference.value}{t(". The reference is a comparison, not a promised result.")}</p>
            </div>)}
            </div></details>
          </form>
          <SavedExperimentImport disabled={executionBusy} onOpenVersion={openExperimentVersion} />

          {error && <p className="error" role="alert">{t(error)}</p>}
        </section>
        <aside className="journey-card">
          <p className="eyebrow">{t("How it works")}</p><h2>{t("A clear path to your first result")}</h2>
          <ol className="journey-steps">
            <li><strong>{t("Scan the source")}</strong><p>{t("Inspect README, Python / Make entries and JavaScript/TypeScript declarations. No Docker required.")}</p></li>
            <li><strong>{t("Review the plan")}</strong><p>{t("Confirm commands, input files, dataset and output expectations before execution.")}</p></li>
            <li><strong>{t("Run in Docker")}</strong><p>{t("Execute the selected workflow locally with explicit resource limits and live logs.")}</p></li>
            <li><strong>{t("Compare the evidence")}</strong><p>{t("Separate process completion, output checks and reference matching. Keep the record for replay.")}</p></li>
          </ol>
          <p className="runner-note">{t("A passing check is not full-paper reproduction. Only the reviewed experiment and declared conditions are verified.")}</p>
          <button type="button" className="download-button" onClick={() => setPage("report")}>{t(isExample ? "Preview a clearly labelled demo report" : "Return to latest report")}</button>
        </aside>
        </div>

        <div className="view-panel" hidden={page !== "report"}>

        {!isExample && !!report.servicePlan?.services?.length && <section className="runner"><h2>{t('Review service startup plan')}</h2><p>{t('Review all detected services together, including their dependencies and API/browser checks. This draft requires confirmation.')}</p><button type="button" onClick={() => setPage('web')}>{t('Review and run web acceptance →')}</button></section>}
        {!isExample && !report.servicePlan?.services?.length && !acceptance.benchmarkId && <SuggestedEntry key={`${report.repository}@${report.commit}`} report={report} disabled={executionBusy} onChoose={chooseQuickEntry} />}
        <section className="report" aria-labelledby="report-title">
          <div className="report-heading">
            <div>
              <div className="report-label">
                <span>{t(isExample ? "Example report" : "Scan report")}</span>
                <span className={`status status-${report.status.toLowerCase()}`}>
                  {t(report.status.replaceAll("_", " "))}
                </span>
              </div>
              <h2 id="report-title">{report.repository}</h2>
              {report.projectType && <p className="hint">{t("Project type")}: {t(({node: "JavaScript / TypeScript", python: "Python", mixed: "Mixed Python + JavaScript/TypeScript", unknown: "Project type not recognized"})[report.projectType])}</p>}
              <p className="commit">{t("Commit ")}{report.commit}</p>
            </div>

            <div className="report-tools">
              <dl className="summary">
                <div>
                  <dt>{t("Files")}</dt>
                  <dd>{report.filesScanned}</dd>
                </div>
                <div>
                  <dt>{t("Blockers")}</dt>
                  <dd>{report.summary.failures}</dd>
                </div>
                <div>
                  <dt>{t("Warnings")}</dt>
                  <dd>{report.summary.warnings}</dd>
                </div>
              </dl>
              {!isExample && (
                <button className="download-button" type="button" onClick={downloadReport}>{t(" Download JSON ")}</button>
              )}
            </div>
          </div>

          <ReportChecks key={`${report.repository}@${report.commit}`} report={report} />
        </section>

        {!isExample && report.paperProvenance && <details className="advanced-evidence"><summary>{t("Paper provenance and protocol lock")}</summary><PaperProvenance report={report} /><ProtocolLock report={report} /></details>}
        {!isExample && report.projectType === 'mixed' && <NodeProject report={report} />}
        {!isExample && (report.servicePlan?.services?.length || report.nodeProject?.packages?.some(pkg => !pkg.error && pkg.installCommand)) && <div className="next-action"><p>{t('Review the service configuration generated from this scan, then run installation, tasks and API/browser checks.')}</p><button type="button" onClick={() => setPage('web')}>{t('Review and run web acceptance →')}</button></div>}
        {!isExample && !['node', 'unknown'].includes(report.projectType) && <div className="next-action"><p>{t("Review the source evidence, then configure the workflow and its acceptance conditions.")}</p><button type="button" onClick={() => setPage('configure')}>{t("Configure experiment →")}</button></div>}
        </div>
        <div className="view-panel configure-layout" hidden={page !== "configure"}>

        {!isExample && report.paperMatrixDraft && !acceptance.benchmarkId && <details className="matrix-options"><summary>{t("Advanced · multi-experiment paper matrix")}</summary><PaperMatrix key={`${report.repository}@${report.commit}`} report={report} disabled={executionBusy} onApply={applyMatrix} /></details>}

        {displayedPlan && (
          <section className="plan" aria-labelledby="plan-title">
            <div className="plan-heading">
              <div>
                <p className="eyebrow">
                  {t(report.workflows ? "Reproduction workflows" : "Reproduction plan")}
                </p>
                <h2 id="plan-title">
                  {t(displayedPlan.title ?? activeWorkflow?.title ?? "From repository to first run")}
                </h2>
                {report.workflows && (
                  <div className="workflow-tabs" role="tablist" aria-label={t("Reproduction workflow")}>
                    {report.workflows.map((workflow) => (
                      <button
                        className={`workflow-tab${workflow.id === activeWorkflow?.id ? " workflow-tab-active" : ""}`}
                        type="button"
                        role="tab"
                        aria-selected={workflow.id === activeWorkflow?.id}
                        disabled={executionBusy}
                        onClick={() => {
                          setSelectedWorkflow(workflow.id);
                          setPreflight(null);
                          setRunConfirmed(false);
                          setRunJob(null);
                          setQuickCommand("");
                          setAcceptance(emptyAcceptance);
                        }}
                        key={workflow.id}
                      >
                        {t(workflow.title)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="plan-actions">
                <span className={`status status-${displayedPlan.status.toLowerCase()}`}>
                  {t(displayedPlan.status)}
                </span>
                {!isExample && (
                  <button className="download-button" type="button" onClick={downloadPlan}>{t(" Download plan ")}</button>
                )}
              </div>
            </div>

            <ol className="plan-steps">
              {displayedPlan.steps.map((step, index) => (
                <li className={`plan-step plan-step-${step.status.toLowerCase()}`} key={step.id}>
                  <span className="step-number">{index + 1}</span>
                  <div>
                    <div className="plan-step-heading">
                      <h3>{t(step.title)}</h3>
                      <span>{t(step.status)}</span>
                    </div>
                    {step.command && <code className="command">{step.command}</code>}
                    {step.instruction && <p className="plan-instruction">{step.instruction}</p>}
                    {step.status === "MISSING" && (
                      <p className="plan-missing">{t("This step was not automatically recognized. Review the source instructions before proceeding.")}</p>
                    )}
                    {step.evidence?.file && (
                      <p className="evidence">
                        <span>{t("Evidence")}</span>
                        <EvidenceLink report={report} evidence={step.evidence} />
                      </p>
                    )}
                    {step.references?.length > 0 && (
                      <div className="plan-tags" aria-label={t("Validated command references")}>
                        {step.references.map((reference) => (
                          <code className={reference.exists === false ? "tag-missing" : "tag-valid"} key={reference.path}>
                            {reference.external ? "External" : reference.exists ? "Found" : "Unknown"} · {reference.path}
                          </code>
                        ))}
                      </div>
                    )}
                    {step.parameters?.length > 0 && (
                      <div className="plan-tags" aria-label={t("Experiment parameters")}>
                        {step.parameters.map((parameter) => (
                          <code key={parameter.name}>
                            {parameter.name}{parameter.default === null ? "" : `=${parameter.default}`}
                          </code>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {displayedPlan.steps.length === 0 && (
                <li className="workflow-empty">{t(activeWorkflow?.id === "quick" && report.quickEntries?.length ? "Choose an entry in Start here above to review it in Quick." : "No matching entry point was automatically recognized. Check the README and source files.")}{t(activeWorkflow?.id === "evaluation" && " You can explicitly supply and review an Evaluation entry below; it is not a discovered README command.")}</li>
              )}
            </ol>
          </section>
        )}

        {!isExample && report.evaluationDraft && !acceptance.benchmarkId && selectedWorkflow !== "paper-matrix" && <CandidateConfig key={`${report.repository}@${report.commit}`} report={report} disabled={executionBusy} onApply={applyCandidate} />}

        {!isExample && activeWorkflow && (
          <section className="runner execution-config" aria-labelledby="runner-title">
            <div className="runner-heading">
              <div>
                <p className="eyebrow">{t("Isolated execution preview")}</p>
                <h2 id="runner-title" tabIndex={-1}>{t("Check before running unknown code")}</h2>
                <p>{t("Re-scan the pinned commit and inspect the local Docker runner.")}</p>
              </div>
              <button type="button" onClick={checkPreflight} disabled={executionBusy || (activeWorkflow.id === "quick" && report.quickEntries?.length > 0 && !acceptance.quickEntryId) || (acceptance.candidateReview && !acceptance.candidateReview.confirmed) || (activeWorkflow.id === "training" && !acceptance.benchmarkId && !acceptance.experiment)}>
                {t(preflightLoading ? "Checking…" : "Check local runner")}
              </button>
            </div>

            {preflightError && <p className="runner-error" role="alert">{t(preflightError)}</p>}
            {activeWorkflow.id === "training" && !acceptance.benchmarkId && <>
              <ExperimentConfig key={`${report.repository}@${report.commit}`} report={report} disabled={executionBusy} onApply={applyExperiment} onInvalidate={invalidateExperiment} importedDraft={importedDraft} />
              <p className="hint" role="status">{t(acceptance.experiment ? "Reviewed experiment applied. Check local runner to inspect every effective command before execution." : "Review and apply an experiment configuration to enable the runner check.")}</p>
            </>}
            {acceptance.benchmarkId && <div className="run-comparison">
              <h3>{selectedReviewedCase.title}</h3>
              <p>{selectedReviewedCase.dataset}</p>
              <p>{selectedReviewedCase.model}</p>
              {selectedReviewedCase.training && <p className="runner-note">{t(selectedReviewedCase.training.scope)}</p>}
              <p><a href={selectedReviewedCase.reference.url} target="_blank" rel="noreferrer">{selectedReviewedCase.matrix ? `Pinned Table 1 source · ${selectedReviewedCase.matrix.cells.length} result cells` : `Pinned reference: ${selectedReviewedCase.metricKey ?? "accuracy"} ${selectedReviewedCase.reference.value} · tolerance ${selectedReviewedCase.reference.tolerance}`}</a></p>
              <p className="hint">{selectedReviewedCase.matrix ? `Fixed output checks: published-matrix-ok · fresh ${selectedReviewedCase.matrix.outputFile} · all ${selectedReviewedCase.matrix.cells.length} cells match at four decimals.` : `Fixed output checks: published-benchmark-ok · fresh benchmark-result.json · ${selectedReviewedCase.metricKey ?? "accuracy"} = ${selectedReviewedCase.reference.value} ± ${selectedReviewedCase.reference.tolerance}.`}</p>
              <p className="runner-note">{t(selectedReviewedCase.compatibility.note)}</p>
              <p className="hint">{t("Commands and expectations are fixed for this reviewed case. Choose another workflow or scan again to return to custom Evaluation.")}</p>
              <details><summary>{t("Review benchmark manifest and adapter source")}</summary><pre className="evaluation-source">{JSON.stringify(selectedReviewedCase, null, 2)}{"\n\n"}{selectedBenchmarkSource}{selectedReviewedCase.training && <>{"\n\n"}{trainingSource}</>}</pre></details>
            </div>}
            {["quick", "evaluation"].includes(activeWorkflow.id) && !acceptance.benchmarkId && (
              <fieldset className="run-options" disabled={optionsLocked}>
                <legend>{t("Entry and output expectations")}</legend>
                <label htmlFor="quick-command">{t("Reviewed ")}{t(activeWorkflow.id === "evaluation" ? "Evaluation" : "Quick")}{t(" command (optional)")}</label>
                <input id="quick-command" value={quickCommand} maxLength={6000}
                  placeholder={t("Leave blank to use the README entry point")}
                  disabled={optionsLocked}
                  onChange={(event) => { setQuickCommand(event.target.value); if (acceptance.candidateReview) updateAcceptance("candidateReview", { ...acceptance.candidateReview, confirmed: false }); setPreflight(null); setRunConfirmed(false); }} />
                <p className="hint">{t("Replaces the final entry point, not dependency installation. Evaluation can use an explicit reviewed entry when none was detected. Review every effective command below.")}</p>
                {quickCommand === cpuEvaluationCommand && <details><summary>{t("Review CPU evaluation example source")}</summary><pre className="evaluation-source">{cpuEvaluationSource}</pre></details>}
                <label htmlFor="expected-text">{t("Expected text in the entry output (optional)")}</label>
                <input id="expected-text" value={acceptance.expectedText} maxLength={300} disabled={optionsLocked}
                  placeholder={t("For example: autodiff-ok")} onChange={(event) => updateAcceptance("expectedText", event.target.value)} />
                <label htmlFor="output-file">{t("Expected new or changed output file (optional)")}</label>
                <input id="output-file" value={acceptance.outputFile} maxLength={240} disabled={optionsLocked}
                  placeholder={t("results/metrics.json — relative to the repository")} onChange={(event) => updateAcceptance("outputFile", event.target.value)} />
                <div className="metric-options">
                  <label>{t("JSON key / CSV column (optional)")}<input value={acceptance.metricKey} maxLength={100} disabled={optionsLocked}
                    placeholder={t("accuracy or evaluation.accuracy")} onChange={(event) => updateAcceptance("metricKey", event.target.value)} /></label>
                  <label>{t("Condition")}<select value={acceptance.metricOperator} disabled={optionsLocked}
                    onChange={(event) => updateAcceptance("metricOperator", event.target.value)}><option value="gte">{t("At least (≥)")}</option><option value="lte">{t("At most (≤)")}</option><option value="eq">{t("Match reference (±)")}</option></select></label>
                  <label>{t("Target")}<input type="number" step="any" value={acceptance.metricTarget} disabled={optionsLocked}
                    onChange={(event) => updateAcceptance("metricTarget", event.target.value)} /></label>
                </div>
                {acceptance.metricOperator === "eq" && <label>{t("Absolute tolerance")}<input type="number" min="0" step="any" value={acceptance.metricTolerance} disabled={optionsLocked}
                  onChange={(event) => updateAcceptance("metricTolerance", event.target.value)} /></label>}
                {activeWorkflow.id === "evaluation" && <>
                  <label>{t("Dataset / evaluation split (required)")}<input value={acceptance.dataset} maxLength={500} disabled={optionsLocked} placeholder={t("Dataset version, held-out split, acquisition path")}
                    onChange={(event) => updateAcceptance("dataset", event.target.value)} /></label>
                  <label>{t("Model / checkpoint (required)")}<input value={acceptance.model} maxLength={500} disabled={optionsLocked} placeholder={t("Architecture, checkpoint version, source")}
                    onChange={(event) => updateAcceptance("model", event.target.value)} /></label>
                  <label>{t("Reference metric source (required)")}<input value={acceptance.reference} maxLength={500} disabled={optionsLocked} placeholder={t("Pinned README/table/paper URL, or explicitly user-defined target")}
                    onChange={(event) => updateAcceptance("reference", event.target.value)} /></label>
                  <label className="runner-confirm"><input type="checkbox" checked={acceptance.assetsInEntry} disabled={optionsLocked}
                    onChange={(event) => updateAcceptance("assetsInEntry", event.target.checked)} />{t("My reviewed entry handles dataset and model preparation; replace separate data/model steps explicitly.")}</label>
                  <p className="hint">{t("Required: a new/changed JSON or single-row CSV file and numeric metric. Units must match the reference; no implicit conversion. Context is user-declared; CPU/2 GB/10 minute limits still apply.")}</p>
                  {acceptance.candidateReview && <label className="runner-confirm"><input type="checkbox" checked={acceptance.candidateReview.confirmed}
                    onChange={(event) => updateAcceptance("candidateReview", { ...acceptance.candidateReview, confirmed: event.target.checked })} />{t("I reviewed the candidate sources, completed missing fields, and confirmed this command, dataset/split, model and reference correspond. Editing any field requires review again.")}</label>}
                </>}
              </fieldset>
            )}
            {preflight && (
              <div className="runner-result" aria-live="polite">
                <div className={`runner-state ${preflight.runtime.available ? "runner-ready" : "runner-unavailable"}`}>
                  <strong>{t(preflight.runtime.available ? "Docker ready" : preflight.runtime.reason)}</strong>
                  <span>{t(preflight.limits.cpus)}{t(" CPUs · ")}{t(preflight.limits.memory)} · {t(preflight.limits.timeoutMinutes)}{t(" minute limit · no host mounts")}</span>
                </div>
                <h3>{t("Automated steps")}</h3>
                {preflight.commandOverride && <p className="runner-note">{t("User-reviewed override · original: ")}{t(preflight.commandOverride.original)}</p>}
                {preflight.preparationOverride && <details><summary>{t("Explicit dataset/model preparation override")}</summary><pre>{JSON.stringify(preflight.preparationOverride, null, 2)}</pre></details>}
                {preflight.benchmark && <details><summary>{t("Reviewed compatibility profile, hash locks and original README steps")}</summary><pre className="evaluation-source">{JSON.stringify(preflight.benchmark, null, 2)}</pre></details>}
                {preflight.candidate && <details><summary>{t("Reviewed generated configuration and manual changes")}</summary><pre className="evaluation-source">{JSON.stringify(preflight.candidate, null, 2)}</pre></details>}
                <ol>
                  {preflight.automatedSteps.map((step) => (
                    <li key={step.id}><span>{t(step.title)}</span>{preflight.executionOptions.experiment?.inputs?.[step.id]?.length > 0 && <p>{t("Required input files: ")}{t(preflight.executionOptions.experiment.inputs[step.id].join(", "))}</p>}<code className="command">{step.effectiveCommand ?? step.command}</code></li>
                  ))}
                </ol>
                {preflight.manualSteps.length > 0 && (
                  <>
                    <h3>{t("Manual preparation")}</h3>
                    <ul>
                      {preflight.manualSteps.map((step) => (
                        <li key={step.id}><span>{t(step.title)}</span><code className="command">{step.instruction}</code></li>
                      ))}
                    </ul>
                  </>
                )}
                <p className="runner-note">{t("Output checks: ")}{t(preflight.executionOptions.expectedText || preflight.executionOptions.outputFile
                  ? [preflight.executionOptions.expectedText && `text: ${preflight.executionOptions.expectedText}`, preflight.executionOptions.outputFile && `new/changed file: ${preflight.executionOptions.outputFile}`,
                    preflight.executionOptions.metricKey && `metric: ${preflight.executionOptions.metricKey} ${preflight.executionOptions.metricOperator === "eq" ? "=" : preflight.executionOptions.metricOperator === "gte" ? ">=" : "<="} ${preflight.executionOptions.metricTarget}${preflight.executionOptions.metricOperator === "eq" ? ` ± ${preflight.executionOptions.metricTolerance}` : ""}`].filter(Boolean).join(" · ")
                  : "none — execution exit code only")}</p>
                <label className="runner-confirm">
                  <input
                    type="checkbox"
                    checked={runConfirmed}
                    disabled={optionsLocked}
                    onChange={(event) => setRunConfirmed(event.target.checked)}
                  />{t(" I understand this runs untrusted code with network access inside a temporary Docker container. ")}</label>
                <button
                  type="button"
                  onClick={() => startExecution("readme")}
                  disabled={!preflight.runnable || !runConfirmed || executionBusy}
                >
                  {t(runLoading ? "Starting…" : activeWorkflow.id === "training" ? "Run Training reproduction" : activeWorkflow.id === "evaluation" ? "Run Evaluation" : activeWorkflow.id === "paper-matrix" ? "Run paper matrix" : "Run Quick verification")}
                </button>
                {!preflight.runnable && (
                  <p className="runner-note">{t(preflight.reason ?? "The workflow is not ready to execute.")}</p>
                )}
              </div>
            )}
          </section>
        )}
        </div>
        <div className="view-panel" hidden={page !== "run"}>
            {runJob && (
              <section className="runner" id="current-execution" tabIndex={-1} aria-label={t("Current execution")}>
              <div className="run-log">
                <div>
                  <strong role="status" aria-live="polite">{t(" Execution ")}{t(runJob.status.replaceAll("_", " "))} · {t(runJob.replayOf ? "Locked recipe" : runJob.packageIndex === "pypi" ? "Official PyPI" : "README package source")}
                  </strong>
                  {runJob.status === "RUNNING" && (
                    <button className="download-button" type="button" onClick={cancelExecution}>{t("Cancel")}</button>
                  )}
                </div>
                <ol className="run-progress">
                  {runJob.steps.map((step) => (
                    <li className={`run-step-${step.status.toLowerCase()}`} key={step.id}>
                      <span>{t(step.status)}</span>{t(step.title)}
                    </li>
                  ))}
                </ol>
                {runJob.failureStep && (
                  <p className="runner-error">{t("Stopped at: ")}{t(runJob.failureStep.title)}</p>
                )}
                {runJob.diagnosis && <p className="run-diagnosis">{runJob.diagnosis}</p>}
                {["FAILED", "TIMED_OUT"].includes(runJob.status) && runJob.workflowId === "paper-matrix" && !runJob.replayOf && (
                  <button type="button" onClick={() => startExecution("readme", runJob)} disabled={executionBusy || !runConfirmed}>{t("Retry complete paper workflow")}</button>
                )}
                {["FAILED", "TIMED_OUT"].includes(runJob.status)
                  && runJob.failureStep?.id === "install"
                  && !runJob.replayOf && runJob.packageIndex === "readme" && (
                    <button type="button" onClick={() => startExecution("pypi", runJob)} disabled={executionBusy || !runConfirmed || !!runJob.replayOf}>
                      {t(runLoading ? "Starting…" : "Retry with official PyPI")}
                    </button>
                )}
                <RunConsole key={runJob.id} text={visibleRunLog(runJob.log)} job={runJob} active={page === "run"} />
                <ExecutionEvidence job={runJob} onPrepareReplay={prepareReplay} replayDisabled={executionBusy} />

              </div>
              </section>
            )}
        </div>
        <div className="view-panel" hidden={page !== "history"}>
        <section className="runner run-history" aria-labelledby="history-title">
          <div className="runner-heading">
            <div><p className="eyebrow">{t("Local evidence archive")}</p><h2 id="history-title">{t("Recent executions")}</h2>
              <p>{t("Records stay on this computer and survive server restarts. They are not uploaded to GitHub.")}</p></div>
            <button className="download-button" type="button" onClick={refreshHistory}>{t("Refresh history")}</button>
          </div>
          {historyError && <p className="runner-note" role="status">{t(historyError)}</p>}
          <p className="hint">{t("Open a saved record to inspect its evidence or review a frozen replay. Replay comparisons separate changed inputs from metric acceptance.")}</p>
          {history.length === 0 && !historyError && <div className="empty-state"><h3>{t("No saved executions yet")}</h3><p>{t("Scan a repository and complete a reviewed run to build your local evidence archive.")}</p><button type="button" className="download-button" onClick={() => setPage("scan")}>{t("Start with a repository")}</button></div>}
          <ul className="history-list">
            {history.map((entry) => <li key={entry.id}>
              <div><strong>{entry.repository}</strong><p className="hint">{t(entry.workflowId ?? "quick")}{t(" · Execution: ")}{t(entry.status)}{t(" · Output checks: ")}{t(entry.verificationStatus)}{entry.evaluationStatus && <>{t(" · Evaluation: ")}{t(entry.evaluationStatus.replaceAll("_", " "))}</>} · {t(entry.commit.startsWith('sha256:') ? 'snapshot' : 'commit')} {entry.commit.replace(/^sha256:/, '').slice(0, 7)} · {t(new Date(entry.startedAt).toLocaleString())}</p></div>
              <button className="download-button" type="button" onClick={() => openHistory(entry.id)}>{t("View record")}</button>
            </li>)}
          </ul>
          {archivedJob && <div className="run-log" id="archived-execution" tabIndex={-1} aria-label={t("Saved execution details")}>
            <div><strong>{t(archivedJob.repository)} · {t(archivedJob.status)}</strong><button className="download-button" type="button" onClick={() => setArchivedJob(null)}>{t("Close record")}</button></div>
            <p className="commit">{t(archivedJob.id)} · {t(archivedJob.kind === 'web' ? 'Source snapshot' : 'Commit')} {t(archivedJob.commit)}</p>
            {archivedJob.diagnosis && <p className="run-diagnosis">{archivedJob.diagnosis}</p>}
            <RunConsole key={archivedJob.id} text={visibleRunLog(archivedJob.log)} job={archivedJob} active={page === "history"} />
            {archivedJob.kind === 'web' ? <WebEvidence job={archivedJob} /> : <ExecutionEvidence job={archivedJob} onPrepareReplay={prepareReplay} replayDisabled={executionBusy} />}

          </div>}
        </section>
        {(replayPreview || replayLoading || replayError) && <section className="runner recipe-preview" aria-labelledby="recipe-title">
          <div className="runner-heading"><div><p className="eyebrow">{t("Frozen reproduction recipe")}</p><h2 id="recipe-title" tabIndex={-1}>{t("Review before replaying")}</h2></div>
            <button className="download-button" type="button" disabled={executionBusy} onClick={() => { setReplayPreview(null); setReplayError(""); setReplayConfirmed(false); }}>{t("Close recipe")}</button></div>
          {replayLoading && <p role="status">{t("Checking the exact local image…")}</p>}
          {replayError && <p className="runner-error" role="alert">{t(replayError)}</p>}
          {replayPreview && <>
            <p>{t(replayPreview.repository)}{t(" · pinned commit ")}{t(replayPreview.commit)}</p>
            <p className="hint">{t("The saved commit is fetched directly; changes to the latest GitHub branch do not change this recipe.")}</p>
            <p className="commit">{t("Image ")}{t(replayPreview.recipe.imageId)}{t(" · Python ")}{t(replayPreview.recipe.python)}</p>
            <p className="hint">{t(replayPreview.limits.cpus)}{t(" CPUs · ")}{t(replayPreview.limits.memory)} · {t(replayPreview.limits.timeoutMinutes)}{t(" minute limit · no host mounts")}</p>
            {replayPreview.benchmark && <>
              <p className="runner-note">{t(replayPreview.benchmark.compatibility.note)}</p>
              <details><summary>{t("Frozen benchmark input hashes and pinned reference")}</summary><pre>{JSON.stringify(replayPreview.benchmark, null, 2)}</pre></details>
            </>}
            {replayPreview.candidate && <details><summary>{t("Frozen reviewed candidate sources")}</summary><pre>{JSON.stringify(replayPreview.candidate, null, 2)}</pre></details>}
            <ol>{replayPreview.automatedSteps.map((step) => <li key={step.id}><strong>{t(step.title)}</strong>{replayPreview.executionOptions.experiment?.inputs?.[step.id]?.length > 0 && <p>{t("Required input files: ")}{t(replayPreview.executionOptions.experiment.inputs[step.id].join(", "))}</p>}<code className="command">{step.command}</code></li>)}</ol>
            <details><summary>{t("Locked dependencies and output expectations")}</summary><pre>{JSON.stringify({ dependencies: replayPreview.recipe.dependencies, expectations: replayPreview.executionOptions }, null, 2)}</pre></details>
            {replayPreview.recipe.warnings.map((warning) => <p className="runner-note" key={warning}>{t(warning)}</p>)}
            {!replayPreview.runnable && <p className="runner-error" role="alert">{t(replayPreview.reason)}</p>}
            <label className="runner-confirm"><input type="checkbox" checked={replayConfirmed} disabled={executionBusy}
              onChange={(event) => setReplayConfirmed(event.target.checked)} />{t("I reviewed this frozen recipe and understand it re-runs untrusted code with network access in a new temporary container.")}</label>
            <button type="button" disabled={!replayPreview.runnable || !replayConfirmed || executionBusy} onClick={startReplay}>{t(runLoading ? "Starting…" : "Replay frozen recipe")}</button>
          </>}
        </section>}
        </div>
      </main>
      <footer className="workspace-footer"><span>{t("ReproCheck · Evidence before conclusions")}</span><span>{t("Python + JavaScript/TypeScript scans · Reviewed local execution")}</span></footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <LanguageProvider><App /></LanguageProvider>
  </StrictMode>,
);
